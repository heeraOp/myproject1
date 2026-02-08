from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from games.models import Game

from .utils.evaluator import evaluate_claims_for_game


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


def _serialize_prize(prize):
    """
    Minimal, safe serialization for newly claimed prizes.
    Avoids exposing any validation logic.
    """
    data = {"id": str(getattr(prize, "id", ""))}
    if hasattr(prize, "prize_type"):
        data["prize_type"] = prize.prize_type
    if hasattr(prize, "claimed_by_ticket_id"):
        data["claimed_by_ticket_id"] = (
            str(prize.claimed_by_ticket_id) if prize.claimed_by_ticket_id else None
        )
    if hasattr(prize, "claimed_by_ticket") and prize.claimed_by_ticket:
        data["claimed_by_ticket_number"] = prize.claimed_by_ticket.ticket_number
    if hasattr(prize, "claimed_at"):
        data["claimed_at"] = prize.claimed_at
    return data


class AdminEvaluateClaimsView(APIView):
    """
    Admin-only endpoint to evaluate claims for a game.
    """

    permission_classes = [IsAdminRole]

    def post(self, request):
        game_id = request.data.get("game_id")
        if not game_id:
            return Response({"detail": "game_id is required."}, status=400)

        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        # Server-side evaluation only; no prize type accepted from frontend.
        newly_claimed = evaluate_claims_for_game(game)

        return Response([_serialize_prize(prize) for prize in newly_claimed])


class GameWinnersView(APIView):
    """
    Public endpoint to list winners (claimed prizes) for a game.
    """

    permission_classes = [AllowAny]

    def get(self, request, game_id):
        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        # Return only claimed prizes (winners) in a stable order.
        winners = (
            game.prizes.filter(claimed_by_ticket__isnull=False)
            .select_related("claimed_by_ticket")
            .order_by("claimed_at", "id")
        )

        return Response([_serialize_prize(prize) for prize in winners])
