from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from rest_framework.views import APIView

from .models import Game, Announcement
from .serializers import AnnouncementCreateSerializer
from .utils.calling import call_next_number
from .tasks import auto_call_numbers
from claims.models import Claim, Winner, Prize
from claims.utils.evaluator import evaluate_claims_for_game
from claims.serializers import WinnerSerializer
from tickets.models import Ticket
from tickets.serializers import PlayerTicketSerializer, PublicTicketSerializer
from tickets.utils.generator import generate_housie_ticket


def _is_admin_user(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "role", None) == "ADMIN":
        return True
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


class IsAdminRole(BasePermission):
    """
    Admin-only permission based on user role or staff/superuser flags.
    """

    def has_permission(self, request, view):
        return _is_admin_user(request.user)


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    Session auth without CSRF enforcement (for API clients like Postman).
    """

    def enforce_csrf(self, request):
        return


def _configured_status():
    """
    Resolve the configured status. If not defined on the model, fall back to CREATED.
    """
    return getattr(Game.Status, "CONFIGURED", Game.Status.CREATED)


def _mark_game_finished_if_numbers_exhausted(game):
    """
    Mark game as FINISHED when all 90 numbers are called and broadcast once.
    Returns True when the game transitioned in this call.
    """
    if game.status == Game.Status.FINISHED:
        return False

    if game.called_numbers.count() < 90:
        return False

    with transaction.atomic():
        locked_game = get_object_or_404(Game.objects.select_for_update(), id=game.id)
        if locked_game.status == Game.Status.FINISHED:
            return False
        if locked_game.called_numbers.count() < 90:
            return False

        locked_game.status = Game.Status.FINISHED
        locked_game.ended_at = timezone.now()
        locked_game.save(update_fields=["status", "ended_at"])

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"game_{str(game.id)}",
        {
            "type": "game_finished",
        },
    )
    return True


def _clear_claim_progress(game):
    """
    Clear winner/claim progress and reopen claimed prizes for a game.
    """
    Claim.objects.filter(game=game).delete()
    Winner.objects.filter(game=game).delete()
    game.prizes.filter(is_claimed=True).update(is_claimed=False)


def _ticket_snapshot_context(game, viewer_phone=None):
    called_numbers = list(game.called_numbers.values_list("number", flat=True))
    context = {
        "called_numbers": called_numbers,
        "called_numbers_set": set(called_numbers),
        "final_immutable": game.status == Game.Status.FINISHED,
    }
    if viewer_phone is not None:
        context["viewer_phone"] = viewer_phone
    return context


def _admin_game_payload(game):
    return {
        "id": str(game.id),
        "date": game.game_datetime,
        "status": game.status,
        "booking_status": game.booking_status,
        "website_status": game.website_status,
        "total_tickets": game.total_ticket_limit,
        "ticket_price": game.ticket_price,
        "agent_commission": game.agent_commission,
        "active_theme": game.active_theme,
        "is_active": game.is_active,
    }


class AdminGameCreateSerializer(serializers.Serializer):
    date = serializers.DateTimeField(default_timezone=timezone.get_default_timezone())
    ticket_price = serializers.IntegerField(min_value=1)
    total_tickets = serializers.IntegerField(min_value=1)
    agent_commission = serializers.IntegerField(min_value=0, required=False, default=0)
    booking_status = serializers.ChoiceField(
        choices=Game.BookingStatus.choices,
        required=False,
        default=Game.BookingStatus.OPEN,
    )
    website_status = serializers.ChoiceField(
        choices=Game.WebsiteStatus.choices,
        required=False,
        default=Game.WebsiteStatus.OPEN,
    )
    active_theme = serializers.ChoiceField(
        choices=Game.Theme.choices,
        required=False,
        default=Game.Theme.DARK,
    )

    def validate_date(self, value):
        default_tz = timezone.get_default_timezone()
        if timezone.is_naive(value):
            return timezone.make_aware(value, default_tz)
        return timezone.localtime(value, default_tz)


@method_decorator(csrf_exempt, name="dispatch")
class AdminResetCallView(APIView):
    """
    Admin-only endpoint to clear called numbers and claim progress.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset calls while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset calls after game is FINISHED."}, status=400)

            deleted_called, _ = game.called_numbers.all().delete()
            _clear_claim_progress(game)

            if game.status == Game.Status.PAUSED:
                game.status = Game.Status.CREATED
                game.ended_at = None
                game.save(update_fields=["status", "ended_at"])

        return Response({"detail": "Call history reset.", "cleared_called_numbers": deleted_called})


@method_decorator(csrf_exempt, name="dispatch")
class AdminResetTicketView(APIView):
    """
    Admin-only endpoint to clear ticket assignments.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset tickets while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset tickets after game is FINISHED."}, status=400)

            updated = game.tickets.update(
                player_name=None,
                player_phone=None,
                status=Ticket.Status.OPEN,
                ticket_type=Ticket.TicketType.RANDOM,
                booked_at=None,
            )

            _clear_claim_progress(game)

        return Response({"detail": "Tickets reset.", "updated_tickets": updated})


@method_decorator(csrf_exempt, name="dispatch")
class AdminResetAgentView(APIView):
    """
    Admin-only endpoint to clear agent/player assignments from tickets.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset agents while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset agents after game is FINISHED."}, status=400)

            updated = game.tickets.update(
                player_name=None,
                player_phone=None,
                status=Ticket.Status.OPEN,
                booked_at=None,
            )

            _clear_claim_progress(game)

        return Response({"detail": "Agent assignments reset.", "updated_tickets": updated})


@method_decorator(csrf_exempt, name="dispatch")
class AdminStartGameView(APIView):
    """
    Admin-only endpoint to start a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            calling_interval = request.data.get("calling_interval")
            if calling_interval is None:
                return Response({"detail": "calling_interval is required."}, status=400)

            try:
                calling_interval = int(calling_interval)
            except (TypeError, ValueError):
                return Response({"detail": "calling_interval must be an integer (seconds)."}, status=400)

            if calling_interval <= 0:
                return Response({"detail": "calling_interval must be greater than 0."}, status=400)

            if game.status != Game.Status.CREATED:
                return Response(
                    {"detail": "Game can only be started from CREATED status."},
                    status=400,
                )

            if not Prize.objects.filter(game=game, enabled=True).exists():
                return Response(
                    {"detail": "Please configure at least one prize before starting the game."},
                    status=400,
                )

            game.status = Game.Status.RUNNING
            game.calling_interval = calling_interval
            game.save(update_fields=["status", "calling_interval"])

        auto_call_numbers.delay(game.id)
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "game_started",
                "message": "GAME_STARTED",
                "calling_interval": game.calling_interval,
            },
        )
        return Response({"detail": "Game started."})


@method_decorator(csrf_exempt, name="dispatch")
class AdminPauseGameView(APIView):
    """
    Admin-only endpoint to pause a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status != Game.Status.RUNNING:
                return Response(
                    {"detail": "Game can only be paused from RUNNING status."},
                    status=400,
                )

            game.status = Game.Status.PAUSED
            game.save(update_fields=["status"])
            return Response({"detail": "Game paused."})


@method_decorator(csrf_exempt, name="dispatch")
class AdminResumeGameView(APIView):
    """
    Admin-only endpoint to resume a paused game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status != Game.Status.PAUSED:
                return Response(
                    {"detail": "Game can only be resumed from PAUSED status."},
                    status=400,
                )

            if not Prize.objects.filter(game=game, enabled=True).exists():
                return Response(
                    {"detail": "Please configure at least one prize before resuming the game."},
                    status=400,
                )

            game.status = Game.Status.RUNNING
            game.save(update_fields=["status"])

        auto_call_numbers.delay(game.id)
        return Response({"detail": "Game resumed."})


@method_decorator(csrf_exempt, name="dispatch")
class AdminGameThemeView(APIView):
    """
    Admin-only endpoint to set the active theme for a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)
        active_theme = str(request.data.get("active_theme", "")).strip()
        if active_theme not in {choice[0] for choice in Game.Theme.choices}:
            return Response({"detail": "Invalid active_theme."}, status=400)

        game.active_theme = active_theme
        game.save(update_fields=["active_theme"])

        return Response({"active_theme": game.active_theme})


@method_decorator(csrf_exempt, name="dispatch")
class AdminCallNextNumberView(APIView):
    """
    Admin-only endpoint to call the next random number for a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        if game.status != Game.Status.RUNNING:
            return Response(
                {"detail": "Numbers can only be called while the game is RUNNING."},
                status=400,
            )

        try:
            number = call_next_number(game)
        except (ValueError, RuntimeError) as exc:
            _mark_game_finished_if_numbers_exhausted(game)
            return Response({"detail": str(exc)}, status=400)

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "number_called",
                "number": number,
                "called_numbers": called_numbers,
            },
        )

        # Auto-detect winners after each call (server-authoritative).
        evaluate_claims_for_game(game)

        _mark_game_finished_if_numbers_exhausted(game)

        return Response({"number": number})


@method_decorator(csrf_exempt, name="dispatch")
class AdminGameAnnouncementView(APIView):
    """
    Admin-only endpoint to broadcast announcements to all connected players.
    This communication layer is independent of game lifecycle/calling logic.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)
        serializer = AnnouncementCreateSerializer(data=request.data)
        if not serializer.is_valid():
            first_error_key = next(iter(serializer.errors), None)
            first_error = serializer.errors.get(first_error_key, ["Invalid payload."])[0]
            return Response({"detail": str(first_error)}, status=400)

        message = serializer.validated_data["message"]
        announcement = Announcement.objects.create(
            game=game,
            message=message,
            created_by=request.user if request.user.is_authenticated else None,
            is_active=True,
        )

        payload = {
            "message": announcement.message,
            "timestamp": timezone.localtime(announcement.created_at).isoformat(),
            "game_id": str(game.id),
            "announcement_id": announcement.id,
        }

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "announcement_broadcast",
                **payload,
            },
        )

        return Response(payload, status=201)


@method_decorator(csrf_exempt, name="dispatch")
class AdminGameListCreateView(APIView):
    """
    Admin-only endpoint to create and list games.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def get(self, request):
        games = Game.objects.all().order_by("-game_datetime", "id")
        return Response([_admin_game_payload(game) for game in games])

    def post(self, request):
        payload = request.data.copy()
        if not payload.get("date") and payload.get("game_datetime"):
            payload["date"] = payload.get("game_datetime")

        serializer = AdminGameCreateSerializer(data=payload)
        if not serializer.is_valid():
            first_error_key = next(iter(serializer.errors), None)
            first_error = serializer.errors.get(first_error_key, ["Invalid payload."])[0]
            return Response({"detail": str(first_error)}, status=400)

        validated = serializer.validated_data
        game_datetime = validated["date"]
        ticket_price = validated["ticket_price"]
        total_tickets = validated["total_tickets"]
        agent_commission = validated["agent_commission"]
        booking_status = validated["booking_status"]
        website_status = validated["website_status"]
        active_theme = validated["active_theme"]

        with transaction.atomic():
            Game.objects.filter(is_active=True).update(is_active=False)

            game = Game.objects.create(
                status=Game.Status.CREATED,
                booking_status=booking_status,
                website_status=website_status,
                game_datetime=game_datetime,
                ticket_price=ticket_price,
                agent_commission=agent_commission,
                total_ticket_limit=total_tickets,
                active_theme=active_theme,
                is_active=True,
                created_by=request.user,
            )

            # Pre-generate all tickets immediately on game setup (avoid lazy generation).
            if not Ticket.objects.filter(game=game).exists():
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

        return Response(_admin_game_payload(game), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class CurrentAdminGameView(APIView):
    """
    Admin-only endpoint to fetch the single active game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def get(self, request):
        game = Game.objects.filter(is_active=True).first()
        if game is None:
            return Response({"detail": "No active game found."}, status=404)
        return Response(_admin_game_payload(game))


class PublicGameSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    date = serializers.DateTimeField(source="game_datetime", read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_price = serializers.IntegerField(read_only=True)
    booking_status = serializers.CharField(read_only=True)
    website_status = serializers.CharField(read_only=True)
    active_theme = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)


class PublicGameListView(APIView):
    authentication_classes = []

    def get(self, request):
        games = Game.objects.filter(
            status__in=[Game.Status.CREATED, Game.Status.RUNNING, Game.Status.PAUSED],
            website_status=Game.WebsiteStatus.OPEN,
        ).order_by("game_datetime", "id")
        serializer = PublicGameSerializer(games, many=True)
        return Response(serializer.data)


class LatestPublicGameView(APIView):
    authentication_classes = []

    def get(self, request):
        # Backward-compatible alias that now returns the active game.
        game = Game.objects.filter(is_active=True).first()
        if game is None:
            return Response({"detail": "No active game found."}, status=404)
        serializer = PublicGameSerializer(game)
        return Response(serializer.data)


class CurrentPublicGameView(APIView):
    authentication_classes = []

    def get(self, request):
        game = Game.objects.filter(is_active=True).first()
        if game is None:
            return Response({"detail": "No active game found."}, status=404)
        serializer = PublicGameSerializer(game)
        return Response(serializer.data)


class GameStateView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        calling_status = "ON" if game.status == Game.Status.RUNNING else "OFF"

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        winners = (
            Winner.objects.filter(game=game)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )
        won_prizes = []
        for winner in winners:
            won_prizes.append(
                {
                    "prize_type": winner.prize.prize_type,
                    "ticket_number": winner.ticket.ticket_number,
                    "player_name": winner.ticket.player_name,
                }
            )

        return Response(
            {
                "game": {
                    "id": str(game.id),
                    "status": game.status,
                    "calling_status": calling_status,
                    "calling_interval": game.calling_interval,
                    "booking_status": game.booking_status,
                    "website_status": game.website_status,
                },
                "called_numbers": called_numbers,
                "won_prizes": won_prizes,
            }
        )


class GameTicketsView(APIView):
    authentication_classes = [SessionAuthentication]

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        tickets = Ticket.objects.filter(game=game)
        status_filter = request.query_params.get("status")
        if status_filter:
            status_value = str(status_filter).upper()
            valid_statuses = {choice[0] for choice in Ticket.Status.choices}
            if status_value not in valid_statuses:
                return Response({"detail": "Invalid status filter."}, status=400)
            tickets = tickets.filter(status=status_value)

        tickets = tickets.order_by("ticket_number")
        viewer_phone = request.query_params.get("player_phone")
        serializer_context = _ticket_snapshot_context(game, viewer_phone=viewer_phone)

        if _is_admin_user(request.user):
            serializer = PlayerTicketSerializer(
                tickets,
                many=True,
                context=serializer_context,
            )
        else:
            serializer = PublicTicketSerializer(
                tickets,
                many=True,
                context=serializer_context,
            )

        return Response(
            {
                "game": {
                    "id": str(game.id),
                    "status": game.status,
                },
                "final_immutable": game.status == Game.Status.FINISHED,
                "called_numbers": serializer_context["called_numbers"],
                "tickets": serializer.data,
            }
        )


class GameBusinessSummaryView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        tickets_qs = game.tickets.all()
        # Total ticket capacity comes from configured game settings.
        total_tickets = game.total_ticket_limit
        tickets_booked = tickets_qs.filter(status="BOOKED").count()
        fullsheet_booked = tickets_qs.filter(ticket_type="FULL_SHEET", status="BOOKED").count()
        halfsheet_booked = tickets_qs.filter(ticket_type="HALF_SHEET", status="BOOKED").count()
        tickets_left = max(0, total_tickets - tickets_booked)

        total_prize_money = sum(p.amount for p in game.prizes.all())
        total_revenue = tickets_booked * game.ticket_price
        total_profit = total_revenue - total_prize_money

        return Response(
            {
                "total_tickets": total_tickets,
                "tickets_booked": tickets_booked,
                "fullsheet_booked": fullsheet_booked,
                "halfsheet_booked": halfsheet_booked,
                "tickets_left": tickets_left,
                "total_prize_money": total_prize_money,
                "total_revenue": total_revenue,
                "total_profit": total_profit,
                "agent_commission": game.agent_commission,
                "website_status": game.website_status,
            }
        )


class GameSummaryView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        game_payload = {
            "id": str(game.id),
            "status": game.status,
            "calling_interval": game.calling_interval,
            "booking_status": game.booking_status,
            "website_status": game.website_status,
            "active_theme": game.active_theme,
            "total_tickets": game.total_ticket_limit,
            "ticket_price": game.ticket_price,
            "agent_commission": game.agent_commission,
        }

        prizes = Prize.objects.filter(game=game).order_by("prize_type", "id")
        prizes_payload = [
            {
                "prize_type": prize.prize_type,
                "amount": prize.amount,
                "enabled": prize.enabled,
                "claimed": prize.is_claimed,
            }
            for prize in prizes
        ]

        winners = (
            Winner.objects.filter(game=game)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )
        winners_payload = WinnerSerializer(winners, many=True).data

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        return Response(
            {
                "game": game_payload,
                "prizes": prizes_payload,
                "winners": winners_payload,
                "called_numbers": called_numbers,
            }
        )
