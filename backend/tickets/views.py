from django.db import transaction
from django.utils import timezone
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from games.models import Game

from .models import Ticket
from .serializers import (
    AdminBulkTicketGenerateSerializer,
    AdminTicketAssignmentSerializer,
    AdminTicketBookingSerializer,
    TicketBookingStatusSerializer,
    TicketRequestBookingSerializer,
    PublicTicketSerializer,
    PlayerTicketSerializer,
)
from .utils.generator import generate_housie_ticket


def _pick_contiguous_block(open_numbers, required_count):
    """
    Pick the first contiguous block of size `required_count`.
    Returns [] if no contiguous block exists.
    """
    if required_count <= 1:
        return open_numbers[:1]
    if len(open_numbers) < required_count:
        return []

    for start_index in range(0, len(open_numbers) - required_count + 1):
        block = open_numbers[start_index : start_index + required_count]
        if all(block[idx] + 1 == block[idx + 1] for idx in range(required_count - 1)):
            return block
    return []


def _pick_best_open_ticket_numbers(open_numbers, booking_mode, required_count):
    """
    Smart auto-allocation strategy:
    - RANDOM: first available open ticket (stable and race-safe).
    - HALF/FULL: prefer contiguous ticket blocks for sheet-style booking.
      fallback: earliest available open tickets.
    """
    if len(open_numbers) < required_count:
        return []

    if booking_mode == "RANDOM":
        return open_numbers[:1]

    contiguous = _pick_contiguous_block(open_numbers, required_count)
    if contiguous:
        return contiguous

    return open_numbers[:required_count]


def _ticket_read_context(game, viewer_phone=None):
    called_numbers = list(game.called_numbers.values_list("number", flat=True))
    context = {
        "called_numbers": called_numbers,
        "called_numbers_set": set(called_numbers),
        "final_immutable": game.status == Game.Status.FINISHED,
    }
    if viewer_phone is not None:
        context["viewer_phone"] = viewer_phone
    return context


class IsAdminRole(BasePermission):
    """
    Admin-only permission based on user role or staff/superuser flags.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            raise NotAuthenticated("Authentication credentials were not provided.")
        if getattr(user, "role", None) == "ADMIN":
            return True
        if bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False)):
            return True
        raise PermissionDenied("You do not have permission to perform this action.")


def _ticket_payload(ticket):
    return TicketBookingStatusSerializer(ticket).data


def _broadcast_ticket_booked(game, ticket):
    channel_layer = get_channel_layer()
    group_name = f"game_{str(game.id)}"
    payload = {
        "game_id": str(game.id),
        "ticket_id": str(ticket.id),
        "ticket_number": ticket.ticket_number,
        "status": ticket.status,
        "player_name": ticket.player_name or ticket.requested_by_name or "",
    }
    try:
        print("Ticket booked:", payload)
        print("Group broadcast:", group_name)
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": "ticket_booked",
                "data": payload,
            },
        )
    except Exception as exc:
        print("Group broadcast failed (ticket_booked):", str(exc))


def _broadcast_tickets_generated(game, total_generated):
    channel_layer = get_channel_layer()
    group_name = f"game_{str(game.id)}"
    payload = {
        "game_id": str(game.id),
        "total_generated": int(total_generated),
    }
    try:
        print("Ticket generated:", payload)
        print("Group broadcast:", group_name)
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": "tickets_generated",
                "data": payload,
            },
        )
    except Exception as exc:
        print("Group broadcast failed (tickets_generated):", str(exc))


class AdminTicketBookingView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request):
        serializer = AdminTicketBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data.get("game_id")
        ticket_number = serializer.validated_data.get("ticket_number")
        ticket_numbers = serializer.validated_data.get("ticket_numbers") or []
        booking_mode = serializer.validated_data.get("booking_mode", "RANDOM")
        player_name = serializer.validated_data["player_name"]
        player_phone = serializer.validated_data["player_phone"]

        if game_id:
            try:
                game = Game.objects.get(id=game_id)
            except Game.DoesNotExist:
                return Response({"detail": "Game not found."}, status=404)
        else:
            # Fallback to the most recent game that is open for booking.
            game = Game.objects.filter(booking_status=Game.BookingStatus.OPEN).order_by(
                "-game_datetime", "id"
            ).first()
            if game is None:
                return Response({"detail": "No booking-open game found."}, status=404)

        if game.status == Game.Status.FINISHED:
            return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)

        if game.booking_status != Game.BookingStatus.OPEN:
            return Response({"detail": "Ticket booking is closed for this game."}, status=400)

        required_count = 1
        booking_ticket_type = Ticket.TicketType.RANDOM
        if booking_mode == "HALF_SHEET":
            required_count = 3
            booking_ticket_type = Ticket.TicketType.HALF_SHEET
        elif booking_mode == "FULL_SHEET":
            required_count = 6
            booking_ticket_type = Ticket.TicketType.FULL_SHEET

        if ticket_numbers:
            selected_numbers = sorted(set(ticket_numbers))
        elif ticket_number is not None:
            selected_numbers = [ticket_number]
        else:
            selected_numbers = []

        with transaction.atomic():
            open_numbers = list(
                Ticket.objects.select_for_update()
                .filter(game=game, status=Ticket.Status.AVAILABLE)
                .order_by("ticket_number")
                .values_list("ticket_number", flat=True)
            )

            if not selected_numbers:
                selected_numbers = _pick_best_open_ticket_numbers(
                    open_numbers=open_numbers,
                    booking_mode=booking_mode,
                    required_count=required_count,
                )
            if not selected_numbers:
                return Response({"detail": "No tickets available for booking."}, status=400)

            if len(open_numbers) < required_count:
                return Response({"detail": "Not enough open tickets available."}, status=400)

            if booking_mode == "RANDOM" and len(selected_numbers) != 1:
                return Response({"detail": "RANDOM booking requires exactly one ticket."}, status=400)

            if booking_mode != "RANDOM" and len(selected_numbers) != required_count:
                return Response(
                    {"detail": f"{booking_mode} booking requires {required_count} tickets."},
                    status=400,
                )

            tickets = list(
                Ticket.objects.select_for_update()
                .filter(game=game, ticket_number__in=selected_numbers)
                .order_by("ticket_number")
            )
            if len(tickets) != len(selected_numbers):
                return Response({"detail": "One or more tickets not found."}, status=404)

            for ticket in tickets:
                if ticket.status != Ticket.Status.AVAILABLE or ticket.player_name or ticket.player_phone:
                    return Response({"detail": f"Ticket {ticket.ticket_number} is already booked."}, status=400)

            now = timezone.now()
            for ticket in tickets:
                ticket.player_name = player_name
                ticket.player_phone = player_phone
                ticket.status = Ticket.Status.CONFIRMED
                ticket.booked_at = now
                ticket.requested_by_name = None
                ticket.requested_by_whatsapp = None
                ticket.requested_at = None
                ticket.ticket_type = booking_ticket_type
                ticket.save()

        for ticket in tickets:
            _broadcast_ticket_booked(game, ticket)

        booked_payloads = [
            {
                "id": str(ticket.id),
                "game_id": str(ticket.game_id),
                "ticket_number": ticket.ticket_number,
                "ticket_type": ticket.ticket_type,
                "status": ticket.status,
                "player_name": ticket.player_name,
                "player_phone": ticket.player_phone,
                "booked_at": ticket.booked_at,
            }
            for ticket in tickets
        ]

        primary = booked_payloads[0]
        primary["booked_tickets"] = booked_payloads
        primary["total_booked"] = len(booked_payloads)
        return Response(primary)


class TicketRequestBookingView(APIView):
    authentication_classes = []

    def post(self, request, ticket_id):
        serializer = TicketRequestBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        with transaction.atomic():
            try:
                ticket = (
                    Ticket.objects.select_for_update()
                    .select_related("game")
                    .get(id=ticket_id)
                )
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            game = ticket.game
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)
            if ticket.status != Ticket.Status.AVAILABLE:
                return Response({"detail": "Ticket is not available for booking request."}, status=400)

            ticket.status = Ticket.Status.PENDING
            ticket.requested_by_name = serializer.validated_data["player_name"]
            ticket.requested_by_whatsapp = serializer.validated_data["whatsapp"]
            ticket.requested_at = timezone.now()
            ticket.save(
                update_fields=[
                    "status",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                ]
            )

        _broadcast_ticket_booked(game, ticket)
        return Response(_ticket_payload(ticket))


class AdminConfirmBookingView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, ticket_id):
        with transaction.atomic():
            try:
                ticket = (
                    Ticket.objects.select_for_update()
                    .select_related("game")
                    .get(id=ticket_id)
                )
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            if ticket.status != Ticket.Status.PENDING:
                return Response({"detail": "Only pending tickets can be confirmed."}, status=400)

            ticket.status = Ticket.Status.CONFIRMED
            ticket.player_name = ticket.requested_by_name
            ticket.player_phone = ticket.requested_by_whatsapp
            ticket.booked_at = timezone.now()
            ticket.save(update_fields=["status", "player_name", "player_phone", "booked_at"])

        _broadcast_ticket_booked(ticket.game, ticket)

        return Response(_ticket_payload(ticket))


class AdminRejectBookingView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, ticket_id):
        with transaction.atomic():
            try:
                ticket = Ticket.objects.select_for_update().get(id=ticket_id)
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            if ticket.status != Ticket.Status.PENDING:
                return Response({"detail": "Only pending tickets can be rejected."}, status=400)

            ticket.status = Ticket.Status.AVAILABLE
            ticket.player_name = None
            ticket.player_phone = None
            ticket.booked_at = None
            ticket.requested_by_name = None
            ticket.requested_by_whatsapp = None
            ticket.requested_at = None
            ticket.save(
                update_fields=[
                    "status",
                    "player_name",
                    "player_phone",
                    "booked_at",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                ]
            )

        return Response(_ticket_payload(ticket))


class AdminUpdateTicketView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, ticket_id):
        serializer = AdminTicketAssignmentSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        with transaction.atomic():
            try:
                ticket = (
                    Ticket.objects.select_for_update()
                    .select_related("game")
                    .get(id=ticket_id)
                )
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            game = ticket.game
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)
            if ticket.status == Ticket.Status.AVAILABLE:
                return Response({"detail": "Only booked or pending tickets can be modified."}, status=400)

            update_fields = [
                "status",
                "player_name",
                "player_phone",
                "requested_by_name",
                "requested_by_whatsapp",
                "requested_at",
            ]
            ticket.status = Ticket.Status.CONFIRMED
            ticket.player_name = serializer.validated_data["player_name"]
            ticket.player_phone = serializer.validated_data["player_phone"]
            ticket.requested_by_name = None
            ticket.requested_by_whatsapp = None
            ticket.requested_at = None
            if ticket.booked_at is None:
                ticket.booked_at = timezone.now()
                update_fields.append("booked_at")
            ticket.save(update_fields=update_fields)

        _broadcast_ticket_booked(game, ticket)
        return Response(_ticket_payload(ticket))


class AdminReleaseTicketView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, ticket_id):
        with transaction.atomic():
            try:
                ticket = (
                    Ticket.objects.select_for_update()
                    .select_related("game")
                    .get(id=ticket_id)
                )
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            game = ticket.game
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)

            ticket.status = Ticket.Status.AVAILABLE
            ticket.player_name = None
            ticket.player_phone = None
            ticket.booked_at = None
            ticket.requested_by_name = None
            ticket.requested_by_whatsapp = None
            ticket.requested_at = None
            ticket.ticket_type = Ticket.TicketType.RANDOM
            ticket.save(
                update_fields=[
                    "status",
                    "player_name",
                    "player_phone",
                    "booked_at",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                    "ticket_type",
                ]
            )

        _broadcast_ticket_booked(game, ticket)
        return Response(_ticket_payload(ticket))


class AdminBulkTicketGenerateView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request):
        serializer = AdminBulkTicketGenerateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data["game_id"]
        total_tickets = serializer.validated_data["total_tickets"]

        with transaction.atomic():
            try:
                game = Game.objects.select_for_update().get(id=game_id)
            except Game.DoesNotExist:
                return Response({"detail": "Game not found."}, status=404)

            if game.status not in (Game.Status.CREATED, Game.Status.BOOKING_OPEN):
                return Response({"detail": "Tickets can only be generated before or during booking."}, status=400)

            if Ticket.objects.filter(game=game).exists():
                return Response({"detail": "Tickets already exist for this game."}, status=400)

            tickets = []
            for ticket_number in range(1, total_tickets + 1):
                ticket_data = generate_housie_ticket()
                tickets.append(
                    Ticket(
                        game=game,
                        ticket_number=ticket_number,
                        ticket_type=Ticket.TicketType.RANDOM,
                        ticket_data=ticket_data,
                        status=Ticket.Status.AVAILABLE,
                    )
                )

            Ticket.objects.bulk_create(tickets)
            generated_count = len(tickets)

        _broadcast_tickets_generated(game, generated_count)

        return Response({"total_generated": total_tickets})


class PlayerTicketListView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        tickets = Ticket.objects.filter(game=game)
        status_filter = request.query_params.get("status")
        if status_filter:
            status_value = str(status_filter).upper()
            valid_statuses = {choice[0] for choice in Ticket.Status.choices}
            if status_value not in valid_statuses:
                return Response({"detail": "Invalid status filter."}, status=400)
            tickets = tickets.filter(status=status_value)

        tickets = tickets.order_by("ticket_number")
        serializer = PlayerTicketSerializer(
            tickets,
            many=True,
            context=_ticket_read_context(game),
        )
        return Response(serializer.data)


class PublicTicketListView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        tickets = Ticket.objects.filter(game=game).order_by("ticket_number")
        # Only mark ownership for the requesting player; never expose others.
        viewer_phone = request.query_params.get("player_phone")
        serializer = PublicTicketSerializer(
            tickets,
            many=True,
            context=_ticket_read_context(game, viewer_phone=viewer_phone),
        )
        return Response(serializer.data)


class PublicLatestTicketListView(APIView):
    authentication_classes = []

    def get(self, request):
        # Public side must only see tickets for the latest created game.
        game = Game.objects.order_by("-created_at", "-id").first()
        if game is None:
            return Response({"detail": "Game not found."}, status=404)

        tickets = Ticket.objects.filter(game=game).order_by("ticket_number")
        viewer_phone = request.query_params.get("player_phone")
        serializer = PublicTicketSerializer(
            tickets,
            many=True,
            context=_ticket_read_context(game, viewer_phone=viewer_phone),
        )
        return Response(serializer.data)


class PlayerTicketDetailView(APIView):
    authentication_classes = []

    def get(self, request, game_id, ticket_number):
        try:
            ticket = Ticket.objects.get(game_id=game_id, ticket_number=ticket_number)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket not found."}, status=404)

        serializer = PlayerTicketSerializer(ticket, context=_ticket_read_context(ticket.game))
        return Response(serializer.data)
