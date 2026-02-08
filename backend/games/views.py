from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
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
