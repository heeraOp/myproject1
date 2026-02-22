from urllib.parse import quote

from django.db import transaction
from django.utils import timezone
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated, PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from games.models import Game, GameSettings

from .models import Booking, Ticket
from .serializers import (
    AdminBulkTicketGenerateSerializer,
    AdminTicketAssignmentSerializer,
    AdminTicketBookingSerializer,
    PlayerBulkTicketBookingSerializer,
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


def _to_booking_type(booking_mode):
    mapping = {
        "RANDOM": "random",
        "HALF_SHEET": "halfsheet",
        "FULL_SHEET": "fullsheet",
    }
    return mapping.get(str(booking_mode).upper(), "random")


def _to_booking_mode(booking_type):
    mapping = {
        "random": "RANDOM",
        "halfsheet": "HALF_SHEET",
        "fullsheet": "FULL_SHEET",
    }
    return mapping.get(str(booking_type).strip().lower(), "RANDOM")


def _ticket_type_for_booking_mode(booking_mode):
    normalized = str(booking_mode).upper()
    if normalized == "HALF_SHEET":
        return Ticket.TicketType.HALF_SHEET
    if normalized == "FULL_SHEET":
        return Ticket.TicketType.FULL_SHEET
    return Ticket.TicketType.RANDOM


def _expected_ticket_count(booking_mode):
    normalized = str(booking_mode).upper()
    if normalized == "HALF_SHEET":
        return 3
    if normalized == "FULL_SHEET":
        return 6
    return None


def _validate_ticket_count_or_message(booking_mode, ticket_numbers):
    expected = _expected_ticket_count(booking_mode)
    if expected is None:
        return None
    if len(ticket_numbers) != expected:
        return f"{booking_mode} booking requires exactly {expected} tickets."
    return None


def _resolve_privileges(booking_mode, ticket_count):
    normalized = str(booking_mode).upper()
    count = max(0, int(ticket_count))
    if normalized == "RANDOM":
        if count >= 6:
            return {
                "normal_prizes": True,
                "half_sheet_bonus": False,
                "full_sheet_bonus": True,
            }
        if count >= 3:
            return {
                "normal_prizes": True,
                "half_sheet_bonus": True,
                "full_sheet_bonus": False,
            }
        return {
            "normal_prizes": True,
            "half_sheet_bonus": False,
            "full_sheet_bonus": False,
        }
    if normalized == "HALF_SHEET":
        if count != 3:
            raise ValueError("HALF_SHEET requires exactly 3 tickets.")
        return {
            "normal_prizes": True,
            "half_sheet_bonus": True,
            "full_sheet_bonus": False,
        }
    if normalized == "FULL_SHEET":
        if count != 6:
            raise ValueError("FULL_SHEET requires exactly 6 tickets.")
        return {
            "normal_prizes": True,
            "half_sheet_bonus": False,
            "full_sheet_bonus": True,
        }
    return {
        "normal_prizes": True,
        "half_sheet_bonus": False,
        "full_sheet_bonus": False,
    }


def _count_player_tickets(game, *, player_name, player_phone, include_pending=False):
    normalized_phone = str(player_phone or "").strip()
    normalized_name = str(player_name or "").strip()

    confirmed_qs = Ticket.objects.filter(game=game, status=Ticket.Status.CONFIRMED)
    if normalized_phone:
        confirmed_qs = confirmed_qs.filter(player_phone=normalized_phone)
    elif normalized_name:
        confirmed_qs = confirmed_qs.filter(player_name__iexact=normalized_name)
    confirmed_count = confirmed_qs.count()

    if not include_pending:
        return confirmed_count

    pending_qs = Ticket.objects.filter(game=game, status=Ticket.Status.PENDING)
    if normalized_phone:
        pending_qs = pending_qs.filter(requested_by_whatsapp=normalized_phone)
    elif normalized_name:
        pending_qs = pending_qs.filter(requested_by_name__iexact=normalized_name)
    return confirmed_count + pending_qs.count()


def _build_booking_response_payload(
    *,
    booking_mode,
    ticket_numbers,
    player_name,
    privilege_ticket_count,
    booking_record=None,
    whatsapp_redirect_url=None,
):
    booking_type = _to_booking_type(booking_mode)
    normalized_mode = str(booking_mode).upper()
    effective_count = (
        int(privilege_ticket_count)
        if normalized_mode == "RANDOM"
        else len(ticket_numbers)
    )
    privileges = _resolve_privileges(
        booking_mode,
        effective_count,
    )
    payload = {
        "player_name": player_name,
        "booking_type": booking_type,
        "ticket_numbers": ticket_numbers,
        "ticket_count": int(effective_count),
        "requested_ticket_count": len(ticket_numbers),
        "eligible_privileges": privileges,
    }
    if booking_record is not None:
        payload["booking_id"] = int(booking_record.id)
        payload["payment_status"] = booking_record.payment_status
    if whatsapp_redirect_url:
        payload["whatsapp_redirect_url"] = whatsapp_redirect_url
    return payload


def _normalize_whatsapp_digits(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _build_whatsapp_redirect_url(*, game, player_name, booking_type, ticket_numbers, ticket_count):
    settings = GameSettings.objects.order_by("-id").first()

    # Prefer the selected game's name; fallback to settings if missing.
    game_name = str(getattr(game, "name", "") or "").strip()
    if not game_name:
        game_name = str(getattr(settings, "game_name", "") or "").strip()
    if not game_name:
        game_name = "Tambola Game"

    whatsapp_digits = _normalize_whatsapp_digits(getattr(settings, "agent_whatsapp_number", ""))
    if not whatsapp_digits and getattr(game, "agent", None) is not None:
        whatsapp_digits = _normalize_whatsapp_digits(getattr(game.agent, "whatsapp_number", ""))
    if not whatsapp_digits:
        return ""

    ticket_numbers_text = ",".join(str(number) for number in ticket_numbers)
    message = (
        "Hello Admin,\n"
        f"I have booked tickets for {game_name}.\n"
        f"Player Name: {player_name}\n"
        f"Booking Type: {booking_type}\n"
        f"Ticket Count: {ticket_count}\n"
        f"Ticket Numbers: {ticket_numbers_text}\n"
        "Please confirm my payment."
    )
    return f"https://wa.me/{whatsapp_digits}?text={quote(message, safe='')}"


def _create_booking_record(*, game, player_name, booking_mode, ticket_numbers, payment_mode):
    booking_type = _to_booking_type(booking_mode)
    ticket_count = len(ticket_numbers)
    booking_record = Booking.objects.create(
        player=player_name,
        booking_type=booking_type,
        ticket_numbers=ticket_numbers,
        ticket_count=ticket_count,
        payment_mode=payment_mode,
        payment_status=Booking.PaymentStatus.PENDING,
    )
    whatsapp_redirect_url = _build_whatsapp_redirect_url(
        game=game,
        player_name=player_name,
        booking_type=booking_type,
        ticket_numbers=ticket_numbers,
        ticket_count=ticket_count,
    )
    return booking_record, whatsapp_redirect_url


def _broadcast_booking_update(game, booking_payload):
    channel_layer = get_channel_layer()
    group_name = f"game_{str(game.id)}"
    payload = {
        "game_id": str(game.id),
        "player_name": booking_payload.get("player_name", ""),
        "booking_type": booking_payload.get("booking_type"),
        "ticket_numbers": booking_payload.get("ticket_numbers", []),
        "ticket_count": booking_payload.get("ticket_count", 0),
        "privilege_flags": booking_payload.get("eligible_privileges", {}),
        "eligible_privileges": booking_payload.get("eligible_privileges", {}),
    }
    try:
        async_to_sync(channel_layer.group_send)(
            group_name,
            {
                "type": "booking_update",
                "data": payload,
            },
        )
    except Exception as exc:
        print("Group broadcast failed (booking_update):", str(exc))


def _deduct_wallet_if_available(*, game, player_phone, ticket_count):
    """
    Optional wallet integration hook.
    If a wallet adapter exists, use it; otherwise keep booking flow backward-compatible.
    """
    total_amount = int(game.ticket_price) * int(ticket_count)
    response = {
        "wallet_deducted": False,
        "wallet_amount": total_amount,
    }
    try:
        from common.wallet import InsufficientWalletBalance, deduct_wallet_amount
    except Exception:
        return response

    try:
        deduct_wallet_amount(
            phone=str(player_phone or "").strip(),
            amount=total_amount,
            metadata={
                "game_id": str(game.id),
                "ticket_count": int(ticket_count),
            },
        )
        response["wallet_deducted"] = True
        return response
    except InsufficientWalletBalance as exc:
        raise ValueError(str(exc) or "Insufficient wallet balance.")


class AdminTicketBookingView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request):
        serializer = AdminTicketBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data.get("game_id")
        selected_numbers = list(serializer.validated_data.get("resolved_ticket_numbers") or [])
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

        booking_ticket_type = _ticket_type_for_booking_mode(booking_mode)
        wallet_details = {"wallet_deducted": False, "wallet_amount": 0}
        booked_tickets = []
        booking_payload = {}
        with transaction.atomic():
            locked_game = Game.objects.select_for_update().get(id=game.id)
            if locked_game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if locked_game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)

            validation_error = _validate_ticket_count_or_message(booking_mode, selected_numbers)
            if validation_error:
                return Response({"detail": validation_error}, status=400)

            tickets = list(
                Ticket.objects.select_for_update()
                .filter(game=locked_game, ticket_number__in=selected_numbers)
                .order_by("ticket_number")
            )
            if len(tickets) != len(selected_numbers):
                existing = {ticket.ticket_number for ticket in tickets}
                missing = [number for number in selected_numbers if number not in existing]
                return Response(
                    {"detail": "One or more ticket numbers do not exist in this game.", "missing_ticket_numbers": missing},
                    status=404,
                )

            conflicts = []
            for ticket in tickets:
                if ticket.status != Ticket.Status.AVAILABLE or ticket.player_name or ticket.player_phone:
                    conflicts.append(ticket.ticket_number)
            if conflicts:
                return Response(
                    {"detail": "One or more tickets are already booked.", "conflict_ticket_numbers": conflicts},
                    status=409,
                )

            try:
                wallet_details = _deduct_wallet_if_available(
                    game=locked_game,
                    player_phone=player_phone,
                    ticket_count=len(selected_numbers),
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)

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
            Ticket.objects.bulk_update(
                tickets,
                [
                    "player_name",
                    "player_phone",
                    "status",
                    "booked_at",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                    "ticket_type",
                ],
            )

            privilege_ticket_count = _count_player_tickets(
                locked_game,
                player_name=player_name,
                player_phone=player_phone,
                include_pending=False,
            )
            booking_payload = _build_booking_response_payload(
                booking_mode=booking_mode,
                ticket_numbers=[ticket.ticket_number for ticket in tickets],
                player_name=player_name,
                privilege_ticket_count=privilege_ticket_count,
            )
            booked_tickets = tickets

        for ticket in booked_tickets:
            _broadcast_ticket_booked(game, ticket)
        _broadcast_booking_update(game, booking_payload)

        try:
            # Build plain dicts to avoid any serializer wrapper references.
            booked_payloads = [dict(_ticket_payload(ticket)) for ticket in booked_tickets]
            first_booked = dict(booked_payloads[0]) if booked_payloads else {}
            response_payload = {
                **first_booked,
                **booking_payload,
                **wallet_details,
                "booked_tickets": [dict(item) for item in booked_payloads],
                "total_booked": len(booked_payloads),
            }
            return Response(response_payload)
        except Exception as exc:
            # Booking is already committed; never fail the API response because of payload shaping.
            print("Admin booking response build failed:", str(exc))
            fallback_payload = {
                **booking_payload,
                **wallet_details,
                "booked_tickets": [],
                "total_booked": len(booked_tickets),
            }
            return Response(fallback_payload)


class TicketRequestBookingView(APIView):
    authentication_classes = []

    def post(self, request, ticket_id):
        serializer = TicketRequestBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        wallet_details = {"wallet_deducted": False, "wallet_amount": 0}
        booking_payload = {}
        booking_record = None
        whatsapp_redirect_url = ""
        with transaction.atomic():
            try:
                ticket = (
                    Ticket.objects.select_for_update()
                    .select_related("game")
                    .get(id=ticket_id)
                )
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            game = Game.objects.select_for_update().get(id=ticket.game.id)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)
            if ticket.status != Ticket.Status.AVAILABLE:
                return Response({"detail": "Ticket is not available for booking request."}, status=409)

            player_name = serializer.validated_data["player_name"]
            player_phone = serializer.validated_data["whatsapp"]
            payment_mode = serializer.validated_data["payment_mode"]
            try:
                wallet_details = _deduct_wallet_if_available(
                    game=game,
                    player_phone=player_phone,
                    ticket_count=1,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)

            try:
                booking_record, whatsapp_redirect_url = _create_booking_record(
                    game=game,
                    player_name=player_name,
                    booking_mode="RANDOM",
                    ticket_numbers=[ticket.ticket_number],
                    payment_mode=payment_mode,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)

            ticket.status = Ticket.Status.PENDING
            ticket.requested_by_name = player_name
            ticket.requested_by_whatsapp = player_phone
            ticket.requested_at = timezone.now()
            ticket.ticket_type = Ticket.TicketType.RANDOM
            ticket.save(
                update_fields=[
                    "status",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                    "ticket_type",
                ]
            )

            privilege_ticket_count = _count_player_tickets(
                game,
                player_name=player_name,
                player_phone=player_phone,
                include_pending=True,
            )
            booking_payload = _build_booking_response_payload(
                booking_mode="RANDOM",
                ticket_numbers=[ticket.ticket_number],
                player_name=player_name,
                privilege_ticket_count=privilege_ticket_count,
                booking_record=booking_record,
                whatsapp_redirect_url=whatsapp_redirect_url,
            )

        _broadcast_ticket_booked(game, ticket)
        _broadcast_booking_update(game, booking_payload)

        payload = _ticket_payload(ticket)
        payload.update(booking_payload)
        payload.update(wallet_details)
        return Response(payload)


class PlayerBulkTicketBookingView(APIView):
    authentication_classes = []

    def post(self, request):
        serializer = PlayerBulkTicketBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data["game_id"]
        selected_numbers = list(serializer.validated_data.get("resolved_ticket_numbers") or [])
        booking_mode = _to_booking_mode(serializer.validated_data.get("booking_type", "random"))
        player_name = serializer.validated_data["player_name"]
        player_phone = serializer.validated_data["whatsapp"]
        payment_mode = serializer.validated_data["payment_mode"]

        wallet_details = {"wallet_deducted": False, "wallet_amount": 0}
        requested_tickets = []
        booking_payload = {}
        booking_record = None
        whatsapp_redirect_url = ""

        with transaction.atomic():
            try:
                game = Game.objects.select_for_update().get(id=game_id)
            except Game.DoesNotExist:
                return Response({"detail": "Game not found."}, status=404)

            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot modify tickets after game is FINISHED."}, status=400)
            if game.booking_status != Game.BookingStatus.OPEN:
                return Response({"detail": "Ticket booking is closed for this game."}, status=400)

            validation_error = _validate_ticket_count_or_message(booking_mode, selected_numbers)
            if validation_error:
                return Response({"detail": validation_error}, status=400)

            tickets = list(
                Ticket.objects.select_for_update()
                .filter(game=game, ticket_number__in=selected_numbers)
                .order_by("ticket_number")
            )
            if len(tickets) != len(selected_numbers):
                existing = {ticket.ticket_number for ticket in tickets}
                missing = [number for number in selected_numbers if number not in existing]
                return Response(
                    {"detail": "One or more ticket numbers do not exist in this game.", "missing_ticket_numbers": missing},
                    status=404,
                )

            conflicts = [ticket.ticket_number for ticket in tickets if ticket.status != Ticket.Status.AVAILABLE]
            if conflicts:
                return Response(
                    {"detail": "One or more tickets are already booked.", "conflict_ticket_numbers": conflicts},
                    status=409,
                )

            try:
                wallet_details = _deduct_wallet_if_available(
                    game=game,
                    player_phone=player_phone,
                    ticket_count=len(selected_numbers),
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)

            now = timezone.now()
            ticket_type = _ticket_type_for_booking_mode(booking_mode)
            booked_numbers = [ticket.ticket_number for ticket in tickets]

            try:
                booking_record, whatsapp_redirect_url = _create_booking_record(
                    game=game,
                    player_name=player_name,
                    booking_mode=booking_mode,
                    ticket_numbers=booked_numbers,
                    payment_mode=payment_mode,
                )
            except ValueError as exc:
                return Response({"detail": str(exc)}, status=400)

            for ticket in tickets:
                ticket.status = Ticket.Status.PENDING
                ticket.player_name = None
                ticket.player_phone = None
                ticket.booked_at = None
                ticket.requested_by_name = player_name
                ticket.requested_by_whatsapp = player_phone
                ticket.requested_at = now
                ticket.ticket_type = ticket_type
            Ticket.objects.bulk_update(
                tickets,
                [
                    "status",
                    "player_name",
                    "player_phone",
                    "booked_at",
                    "requested_by_name",
                    "requested_by_whatsapp",
                    "requested_at",
                    "ticket_type",
                ],
            )

            privilege_ticket_count = _count_player_tickets(
                game,
                player_name=player_name,
                player_phone=player_phone,
                include_pending=True,
            )
            booking_payload = _build_booking_response_payload(
                booking_mode=booking_mode,
                ticket_numbers=booked_numbers,
                player_name=player_name,
                privilege_ticket_count=privilege_ticket_count,
                booking_record=booking_record,
                whatsapp_redirect_url=whatsapp_redirect_url,
            )
            requested_tickets = tickets

        for ticket in requested_tickets:
            _broadcast_ticket_booked(game, ticket)
        _broadcast_booking_update(game, booking_payload)

        payload = {
            **booking_payload,
            **wallet_details,
            "requested_tickets": [_ticket_payload(ticket) for ticket in requested_tickets],
        }
        return Response(payload)


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
        booking_payload = _build_booking_response_payload(
            booking_mode=ticket.ticket_type,
            ticket_numbers=[ticket.ticket_number],
            player_name=ticket.player_name or ticket.requested_by_name or "Player",
            privilege_ticket_count=_count_player_tickets(
                ticket.game,
                player_name=ticket.player_name or ticket.requested_by_name or "",
                player_phone=ticket.player_phone or ticket.requested_by_whatsapp or "",
                include_pending=False,
            ),
        )
        _broadcast_booking_update(ticket.game, booking_payload)

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
        booking_payload = _build_booking_response_payload(
            booking_mode=ticket.ticket_type,
            ticket_numbers=[ticket.ticket_number],
            player_name=ticket.player_name or "Player",
            privilege_ticket_count=_count_player_tickets(
                game,
                player_name=ticket.player_name or "",
                player_phone=ticket.player_phone or "",
                include_pending=False,
            ),
        )
        _broadcast_booking_update(game, booking_payload)
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
