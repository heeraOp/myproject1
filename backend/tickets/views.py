from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from games.models import Game

from .models import Ticket
from .serializers import (
    AdminBulkTicketGenerateSerializer,
    AdminTicketBookingSerializer,
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


class IsAdminRole(BasePermission):
    """
    Admin-only permission based on user role or staff/superuser flags.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "role", None) == "ADMIN":
            return True
        return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    Session auth without CSRF enforcement (for API clients like Postman).
    """

    def enforce_csrf(self, request):
        return


@method_decorator(csrf_exempt, name="dispatch")
class AdminTicketBookingView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

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
                .filter(game=game, status=Ticket.Status.OPEN)
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
                if ticket.status != Ticket.Status.OPEN or ticket.player_name or ticket.player_phone:
                    return Response({"detail": f"Ticket {ticket.ticket_number} is already booked."}, status=400)

            now = timezone.now()
            for ticket in tickets:
                ticket.player_name = player_name
                ticket.player_phone = player_phone
                ticket.status = Ticket.Status.BOOKED
                ticket.booked_at = now
                ticket.ticket_type = booking_ticket_type
                ticket.save()

            booked_numbers = [ticket.ticket_number for ticket in tickets]

        # Notify listeners using the existing game websocket group (no personal data).
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "ticket_booked",
                "ticket_numbers": booked_numbers,
            },
        )

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


@method_decorator(csrf_exempt, name="dispatch")
class AdminBulkTicketGenerateView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

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
                        status=Ticket.Status.OPEN,
                    )
                )

            Ticket.objects.bulk_create(tickets)

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
        serializer = PlayerTicketSerializer(tickets, many=True)
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
            context={"viewer_phone": viewer_phone},
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
            context={"viewer_phone": viewer_phone},
        )
        return Response(serializer.data)


class PlayerTicketDetailView(APIView):
    authentication_classes = []

    def get(self, request, game_id, ticket_number):
        try:
            ticket = Ticket.objects.get(game_id=game_id, ticket_number=ticket_number)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket not found."}, status=404)

        serializer = PlayerTicketSerializer(ticket)
        return Response(serializer.data)
