from rest_framework.permissions import AllowAny, BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from games.models import Game
from tickets.models import Ticket

from .utils.evaluator import evaluate_claims_for_game
from .models import Winner, Prize, Claim
from .serializers import WinnerSerializer
from . import utils as claim_validators


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

        winners = (
            Winner.objects.filter(game=game, prize__in=newly_claimed)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )

        return Response(WinnerSerializer(winners, many=True).data)


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

        winners = (
            Winner.objects.filter(game=game)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )

        return Response(WinnerSerializer(winners, many=True).data)


class PrizeListUpdateView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]
        if self.request.method == "PUT":
            return [IsAdminRole()]
        return [IsAdminRole()]

    def get(self, request, game_id):
        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        prizes = Prize.objects.filter(game=game).order_by("prize_type", "id")
        data = []
        for prize in prizes:
            data.append(
                {
                    "prize_type": prize.prize_type,
                    "amount": prize.amount,
                    "enabled": prize.enabled,
                    "claimed": prize.is_claimed,
                }
            )
        return Response(data)

    def put(self, request, game_id):
        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        if game.status == Game.Status.RUNNING:
            return Response({"detail": "Cannot update prizes while game is RUNNING."}, status=400)

        payload = request.data
        if not isinstance(payload, list):
            return Response({"detail": "Expected a list of prizes."}, status=400)

        valid_types = {choice[0] for choice in Prize.PrizeType.choices}
        updated = []

        for item in payload:
            prize_type = item.get("prize_type")
            if prize_type not in valid_types:
                return Response({"detail": f"Invalid prize_type: {prize_type}"}, status=400)

            try:
                amount = int(item.get("amount"))
            except (TypeError, ValueError):
                return Response({"detail": f"Invalid amount for {prize_type}"}, status=400)

            enabled = bool(item.get("enabled", True))

            prize, _ = Prize.objects.update_or_create(
                game=game,
                prize_type=prize_type,
                defaults={
                    "amount": amount,
                    "enabled": enabled,
                },
            )
            updated.append(
                {
                    "prize_type": prize.prize_type,
                    "amount": prize.amount,
                    "enabled": prize.enabled,
                    "claimed": prize.is_claimed,
                }
            )

        return Response(updated)


class ClaimSubmitView(APIView):
    def post(self, request):
        game_id = request.data.get("game_id")
        ticket_number = request.data.get("ticket_number")
        prize_type = request.data.get("prize_type")

        if not game_id or ticket_number is None or not prize_type:
            return Response({"detail": "game_id, ticket_number, and prize_type are required."}, status=400)

        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        try:
            ticket_number = int(ticket_number)
        except (TypeError, ValueError):
            return Response({"detail": "ticket_number must be an integer."}, status=400)

        try:
            ticket = Ticket.objects.get(game=game, ticket_number=ticket_number)
        except Ticket.DoesNotExist:
            return Response({"detail": "Ticket not found."}, status=404)

        prize_type = str(prize_type).strip().upper()
        try:
            prize = Prize.objects.get(game=game, prize_type=prize_type)
        except Prize.DoesNotExist:
            return Response({"detail": "Prize not found for this game."}, status=404)

        if prize.is_claimed:
            return Response({"detail": "Prize already claimed."}, status=400)

        if Winner.objects.filter(game=game, prize__prize_type=prize_type).exists():
            return Response({"detail": "Prize already claimed."}, status=400)

        called_numbers = set(game.called_numbers.values_list("number", flat=True))

        def _row_numbers(row):
            return [n for n in row if n is not None]

        def _validate_specific_line(ticket_data, row_index):
            rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
            if not isinstance(rows, list) or len(rows) <= row_index:
                return False
            row = rows[row_index]
            if not isinstance(row, list):
                return False
            numbers = _row_numbers(row)
            return bool(numbers) and all(n in called_numbers for n in numbers)

        def _validate_quick_n(ticket_data, n):
            rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
            if not isinstance(rows, list):
                return False
            count = 0
            for row in rows:
                if not isinstance(row, list):
                    continue
                for number in row:
                    if number is not None and number in called_numbers:
                        count += 1
                        if count >= n:
                            return True
            return False

        validators_map = {
            "FIRST_HOUSE": claim_validators.validators.validate_full_house,
            "SECOND_HOUSE": claim_validators.validators.validate_full_house,
            "THIRD_HOUSE": claim_validators.validators.validate_full_house,
            "FULL_SHEET": claim_validators.validators.validate_full_house,
            "HALF_SHEET": claim_validators.validators.validate_half_sheet,
            "TOP_LINE": lambda data: _validate_specific_line(data, 0),
            "MIDDLE_LINE": lambda data: _validate_specific_line(data, 1),
            "BOTTOM_LINE": lambda data: _validate_specific_line(data, 2),
            "BOX": claim_validators.validators.validate_box,
            "CORNER": claim_validators.validators.validate_corners,
            "STAR": claim_validators.validators.validate_star,
            "EARLY_5": claim_validators.validators.validate_early_5,
            "QUICK_6": lambda data: _validate_quick_n(data, 6),
            "QUICK_7": lambda data: _validate_quick_n(data, 7),
        }

        validator = validators_map.get(prize_type)
        if validator is None:
            return Response({"detail": "Invalid prize_type."}, status=400)

        is_valid = validator(ticket.ticket_data, called_numbers) if callable(validator) and validator in (
            claim_validators.validators.validate_full_house,
            claim_validators.validators.validate_half_sheet,
            claim_validators.validators.validate_box,
            claim_validators.validators.validate_corners,
            claim_validators.validators.validate_star,
            claim_validators.validators.validate_early_5,
        ) else validator(ticket.ticket_data)

        if not is_valid:
            return Response({"detail": "Invalid claim."}, status=400)

        winner, created = Winner.objects.get_or_create(
            game=game,
            prize=prize,
            defaults={
                "ticket": ticket,
                "user_id": None,
                "username": ticket.player_name or "",
            },
        )
        if not created:
            return Response({"detail": "Prize already claimed."}, status=400)

        prize.is_claimed = True
        prize.save(update_fields=["is_claimed"])
        Claim.objects.create(game=game, prize=prize, ticket=ticket)

        winner_payload = WinnerSerializer(winner).data

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "winner_announced",
                "winner": winner_payload,
            },
        )

        return Response({"winner": winner_payload})
