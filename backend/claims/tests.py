from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone

from claims.models import Claim, Prize, Winner
from claims.utils.evaluator import _normalize_prize_type, evaluate_claims_for_game
from games.models import CalledNumber, Game
from tickets.models import Ticket


@override_settings(
    CHANNEL_LAYERS={
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }
)
class EvaluateClaimsForGameTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin = user_model.objects.create_user(
            username="admin",
            password="password123",
            role="ADMIN",
        )

    @staticmethod
    def _ticket_data(number):
        return {
            "rows": [
                [number, None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None, None],
            ]
        }

    def _create_game(self):
        return Game.objects.create(
            name="Test Game",
            status=Game.Status.RUNNING,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=600,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            is_active=False,
            calling_interval=1,
            created_by=self.admin,
        )

    def _create_confirmed_tickets(self, game, owner_name, ticket_numbers):
        for ticket_number in ticket_numbers:
            Ticket.objects.create(
                game=game,
                ticket_number=ticket_number,
                ticket_type=Ticket.TicketType.RANDOM,
                ticket_data=self._ticket_data(ticket_number),
                player_name=owner_name,
                player_phone="+15550000001",
                status=Ticket.Status.CONFIRMED,
            )

    def _seed_called_numbers(self, game, numbers):
        CalledNumber.objects.bulk_create([CalledNumber(game=game, number=value) for value in numbers])

    def test_half_sheet_is_awarded_before_full_sheet(self):
        game = self._create_game()
        # Create full-sheet first to verify evaluator enforces logical award order.
        Prize.objects.create(game=game, prize_type="FULL_SHEET", amount=1000, enabled=True)
        Prize.objects.create(game=game, prize_type="HALF_SHEET", amount=500, enabled=True)
        self._create_confirmed_tickets(game, "Alice", [1, 2, 3, 4, 5, 6])
        self._seed_called_numbers(game, [1, 2, 3, 4, 5, 6])

        newly_claimed = evaluate_claims_for_game(game)

        self.assertEqual(
            [_normalize_prize_type(prize.prize_type) for prize in newly_claimed],
            ["HALF_SHEET", "FULL_SHEET"],
        )
        self.assertEqual(
            list(
                Winner.objects.filter(game=game)
                .order_by("created_at", "id")
                .values_list("prize__prize_type", flat=True)
            ),
            ["HALF_SHEET", "FULL_SHEET"],
        )

    def test_sheet_bonus_prizes_are_awarded_once_per_logical_type(self):
        game = self._create_game()
        Prize.objects.create(game=game, prize_type="HALF_SHEET", amount=500, enabled=True)
        Prize.objects.create(game=game, prize_type="HALF_SHEET_BONUS", amount=500, enabled=True)
        Prize.objects.create(game=game, prize_type="FULL_SHEET", amount=1000, enabled=True)
        Prize.objects.create(game=game, prize_type="FULL_SHEET_BONUS", amount=1000, enabled=True)
        self._create_confirmed_tickets(game, "Alice", [1, 2, 3, 4, 5, 6])
        self._seed_called_numbers(game, [1, 2, 3, 4, 5, 6])

        first_pass = evaluate_claims_for_game(game)
        second_pass = evaluate_claims_for_game(game)

        self.assertEqual(len(first_pass), 2)
        self.assertEqual(len(second_pass), 0)

        winner_keys = [
            _normalize_prize_type(prize_type)
            for prize_type in Winner.objects.filter(game=game).values_list("prize__prize_type", flat=True)
        ]
        self.assertEqual(winner_keys.count("HALF_SHEET"), 1)
        self.assertEqual(winner_keys.count("FULL_SHEET"), 1)
        self.assertEqual(Winner.objects.filter(game=game).count(), 2)
        self.assertEqual(Claim.objects.filter(game=game).count(), 2)

    def test_full_sheet_award_does_not_finish_game_before_all_numbers_are_called(self):
        game = self._create_game()
        Prize.objects.create(game=game, prize_type="FULL_SHEET", amount=1000, enabled=True)
        self._create_confirmed_tickets(game, "Alice", [1, 2, 3, 4, 5, 6])
        self._seed_called_numbers(game, [1, 2, 3, 4, 5, 6])

        newly_claimed = evaluate_claims_for_game(game)
        game.refresh_from_db()

        self.assertEqual(len(newly_claimed), 1)
        self.assertEqual(_normalize_prize_type(newly_claimed[0].prize_type), "FULL_SHEET")
        self.assertEqual(game.status, Game.Status.RUNNING)
