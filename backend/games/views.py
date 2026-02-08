from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils.dateparse import parse_datetime
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

from .models import Game
from .utils.calling import call_next_number
from .tasks import auto_call_numbers
from claims.models import Winner, Prize
from claims.serializers import WinnerSerializer


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


def _configured_status():
    """
    Resolve the configured status. If not defined on the model, fall back to CREATED.
    """
    return getattr(Game.Status, "CONFIGURED", Game.Status.CREATED)


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

            game.status = Game.Status.RUNNING
            game.save(update_fields=["status"])

        auto_call_numbers.delay(game.id)
        return Response({"detail": "Game resumed."})


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
            return Response({"detail": str(exc)}, status=400)

        return Response({"number": number})


@method_decorator(csrf_exempt, name="dispatch")
class AdminGameListCreateView(APIView):
    """
    Admin-only endpoint to create and list games.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [CsrfExemptSessionAuthentication]

    def get(self, request):
        games = Game.objects.all().order_by("-game_datetime", "id")
        data = []
        for game in games:
            data.append(
                {
                    "id": str(game.id),
                    "date": game.game_datetime,
                    "status": game.status,
                    "total_tickets": game.total_ticket_limit,
                    "ticket_price": game.ticket_price,
                }
            )
        return Response(data)

    def post(self, request):
        game_datetime_raw = request.data.get("date") or request.data.get("game_datetime")
        if not game_datetime_raw:
            return Response({"detail": "date is required."}, status=400)

        game_datetime = parse_datetime(str(game_datetime_raw))
        if game_datetime is None:
            return Response({"detail": "date must be an ISO 8601 datetime string."}, status=400)

        if timezone.is_naive(game_datetime):
            game_datetime = timezone.make_aware(game_datetime, timezone.get_current_timezone())

        try:
            ticket_price = int(request.data.get("ticket_price"))
        except (TypeError, ValueError):
            return Response({"detail": "ticket_price must be an integer."}, status=400)

        try:
            total_tickets = int(request.data.get("total_tickets"))
        except (TypeError, ValueError):
            return Response({"detail": "total_tickets must be an integer."}, status=400)

        if ticket_price <= 0:
            return Response({"detail": "ticket_price must be greater than 0."}, status=400)
        if total_tickets <= 0:
            return Response({"detail": "total_tickets must be greater than 0."}, status=400)

        game = Game.objects.create(
            status=Game.Status.CREATED,
            booking_status=Game.BookingStatus.OPEN,
            game_datetime=game_datetime,
            ticket_price=ticket_price,
            total_ticket_limit=total_tickets,
            created_by=request.user,
        )

        return Response(
            {
                "id": str(game.id),
                "date": game.game_datetime,
                "status": game.status,
                "total_tickets": game.total_ticket_limit,
                "ticket_price": game.ticket_price,
            },
            status=201,
        )


class PublicGameSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    date = serializers.DateTimeField(source="game_datetime", read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_price = serializers.IntegerField(read_only=True)
    booking_status = serializers.CharField(read_only=True)


class PublicGameListView(APIView):
    authentication_classes = []

    def get(self, request):
        games = Game.objects.filter(
            status__in=[Game.Status.CREATED, Game.Status.RUNNING, Game.Status.PAUSED],
        ).order_by("game_datetime", "id")
        serializer = PublicGameSerializer(games, many=True)
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
                },
                "called_numbers": called_numbers,
                "won_prizes": won_prizes,
            }
        )


class GameBusinessSummaryView(APIView):
    authentication_classes = []

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        tickets_qs = game.tickets.all()
        total_tickets = tickets_qs.count()
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
