from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from claims.models import Prize
from games.models import Agent, Game, GameSettings
from tickets.models import Ticket


class GameMetaApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="game-meta-admin",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.agent = Agent.objects.create(
            name="Rahul",
            whatsapp_number="+919876543210",
            is_active=True,
        )
        self.game = Game.objects.create(
            name="Sunday Mega Housie",
            status=Game.Status.RUNNING,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=120,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            agent=self.agent,
            created_by=self.admin_user,
        )
        GameSettings.objects.create(
            game_name="Sunday Mega Housie",
            agent_whatsapp_number="+919999888777",
        )
        Prize.objects.create(game=self.game, prize_type=Prize.PrizeType.EARLY_5, amount=500, enabled=True)
        Prize.objects.create(game=self.game, prize_type=Prize.PrizeType.TOP_LINE, amount=500, enabled=True)
        Prize.objects.create(game=self.game, prize_type=Prize.PrizeType.HALF_SHEET, amount=500, enabled=True)
        Prize.objects.create(game=self.game, prize_type=Prize.PrizeType.FULL_SHEET, amount=500, enabled=True)
        Prize.objects.create(game=self.game, prize_type=Prize.PrizeType.BOTTOM_LINE, amount=500, enabled=False)

    def test_returns_game_meta_payload(self):
        response = self.client.get("/api/game/meta/")
        self.assertEqual(response.status_code, 200)

        self.assertEqual(response.data["game_name"], "Sunday Mega Housie")
        self.assertEqual(response.data["ticket_price"], 100)
        self.assertTrue(response.data["is_live"])
        self.assertEqual(response.data["agent_name"], "Rahul")
        self.assertEqual(response.data["agent_whatsapp"], "919999888777")
        self.assertEqual(response.data["payment_mode"], "Manual via WhatsApp")
        self.assertIn("Numbers are called live.", response.data["how_to_play"])
        self.assertEqual(
            response.data["prize_patterns"],
            ["Early 5", "Top Line", "Half Sheet Bonus", "Full Sheet Bonus"],
        )
        self.assertTrue(isinstance(response.data["prize_pattern_details"], list))
        self.assertEqual(
            [entry["label"] for entry in response.data["prize_pattern_details"]],
            ["Early 5", "Top Line", "Half Sheet Bonus", "Full Sheet Bonus"],
        )
        self.assertIn(
            "Any 5 numbers on a confirmed ticket must be called.",
            [entry["explanation"] for entry in response.data["prize_pattern_details"]],
        )

    def test_returns_supported_prize_explanations_when_no_prizes_enabled(self):
        Prize.objects.filter(game=self.game).update(enabled=False)
        response = self.client.get("/api/game/meta/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["prize_patterns"], [])
        self.assertEqual(
            len(response.data["prize_pattern_details"]),
            len(Prize.PrizeType.choices),
        )

    def test_returns_404_when_no_active_game(self):
        Game.objects.filter(id=self.game.id).update(is_active=False, is_current=False)
        response = self.client.get("/api/game/meta/")
        self.assertEqual(response.status_code, 404)


class GameRecreateApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="game-recreate-admin",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin_user)
        self.agent = Agent.objects.create(
            name="Rahul",
            whatsapp_number="+919876543210",
            is_active=True,
        )
        self.game = Game.objects.create(
            name="Bad Config Game",
            status=Game.Status.CREATED,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=10,
            total_ticket_limit=30,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            is_current=True,
            version=1,
            agent=self.agent,
            created_by=self.admin_user,
        )

    def test_recreate_game_creates_new_version_and_cancels_old(self):
        payload = {
            "reason": "Correction needed",
            "updated_fields": {
                "name": "Corrected Game Name",
                "ticket_price": 120,
            },
        }
        response = self.client.post(f"/api/admin/game/{self.game.id}/recreate/", payload, format="json")
        self.assertEqual(response.status_code, 201)

        self.game.refresh_from_db()
        self.assertEqual(self.game.status, Game.Status.CANCELLED)
        self.assertFalse(self.game.is_current)
        self.assertFalse(self.game.is_active)
        self.assertEqual(self.game.reason, "Correction needed")

        recreated = Game.objects.get(id=response.data["id"])
        self.assertEqual(recreated.version, 2)
        self.assertTrue(recreated.is_current)
        self.assertTrue(recreated.is_active)
        self.assertEqual(recreated.recreated_from_id, self.game.id)
        self.assertEqual(recreated.name, "Corrected Game Name")
        self.assertEqual(recreated.ticket_price, 120)

    def test_recreate_active_game_with_bookings_is_blocked(self):
        self.game.status = Game.Status.ACTIVE
        self.game.save(update_fields=["status"])
        Ticket.objects.create(
            game=self.game,
            ticket_number=1,
            ticket_type=Ticket.TicketType.RANDOM,
            ticket_data={"rows": [[1, 2, 3], [4, 5, 6], [7, 8, 9]]},
            status=Ticket.Status.CONFIRMED,
            player_name="Booked Player",
            player_phone="9999999999",
        )
        payload = {
            "reason": "Need correction",
            "updated_fields": {},
        }
        response = self.client.post(f"/api/admin/game/{self.game.id}/recreate/", payload, format="json")
        self.assertEqual(response.status_code, 400)
