from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from games.models import Agent, Game, GameSettings
from tickets.models import Booking, Ticket


class TicketBookingFlowTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="admin-ticket-tester",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin_user)

        self.agent = Agent.objects.create(
            name="Fallback Agent",
            whatsapp_number="+919111111111",
            is_active=True,
        )

        self.game = Game.objects.create(
            name="Test Tambola",
            status=Game.Status.CREATED,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=20,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            agent=self.agent,
            created_by=self.admin_user,
        )
        GameSettings.objects.create(
            game_name=self.game.name,
            agent_whatsapp_number="+919999999999",
        )

        for ticket_number in range(1, 21):
            Ticket.objects.create(
                game=self.game,
                ticket_number=ticket_number,
                ticket_type=Ticket.TicketType.RANDOM,
                status=Ticket.Status.AVAILABLE,
                ticket_data={
                    "rows": [
                        [1, 2, 3, 4, 5],
                        [6, 7, 8, 9, 10],
                        [11, 12, 13, 14, 15],
                    ]
                },
            )

    def test_admin_random_booking_with_many_tickets_grants_full_sheet_bonus(self):
        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [1, 2, 3, 4, 5, 6, 7],
            "booking_mode": "RANDOM",
            "player_name": "Rahul",
            "player_phone": "9999999999",
        }
        response = self.client.post("/api/tickets/admin/book/", payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["booking_type"], "random")
        self.assertTrue(response.data["eligible_privileges"]["normal_prizes"])
        self.assertTrue(response.data["eligible_privileges"]["full_sheet_bonus"])
        self.assertFalse(response.data["eligible_privileges"]["half_sheet_bonus"])
        self.assertEqual(response.data["requested_ticket_count"], 7)

        confirmed_count = Ticket.objects.filter(
            game=self.game,
            player_phone="9999999999",
            status=Ticket.Status.CONFIRMED,
        ).count()
        self.assertEqual(confirmed_count, 7)

    def test_admin_half_sheet_requires_exact_three_tickets(self):
        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [1, 2],
            "booking_mode": "HALF_SHEET",
            "player_name": "Rita",
            "player_phone": "8888888888",
        }
        response = self.client.post("/api/tickets/admin/book/", payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_admin_csv_duplicate_ticket_numbers_rejected(self):
        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers_csv": "1,2,2",
            "booking_mode": "RANDOM",
            "player_name": "Rita",
            "player_phone": "8888888888",
        }
        response = self.client.post("/api/tickets/admin/book/", payload, format="json")
        self.assertEqual(response.status_code, 400)

    def test_player_bulk_booking_is_atomic_on_conflict(self):
        booked_ticket = Ticket.objects.get(game=self.game, ticket_number=2)
        booked_ticket.status = Ticket.Status.CONFIRMED
        booked_ticket.player_name = "Booked User"
        booked_ticket.player_phone = "7777777777"
        booked_ticket.save(update_fields=["status", "player_name", "player_phone"])

        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [1, 2, 3],
            "booking_type": "halfsheet",
            "player_name": "Player One",
            "whatsapp": "9990001111",
            "payment_mode": "Cheque",
        }
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/tickets/request-booking/", payload, format="json")
        self.assertEqual(response.status_code, 409)

        ticket_one = Ticket.objects.get(game=self.game, ticket_number=1)
        ticket_three = Ticket.objects.get(game=self.game, ticket_number=3)
        self.assertEqual(ticket_one.status, Ticket.Status.AVAILABLE)
        self.assertEqual(ticket_three.status, Ticket.Status.AVAILABLE)

    def test_player_bulk_random_booking_grants_half_sheet_bonus_for_three(self):
        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [8, 9, 10],
            "booking_type": "random",
            "player_name": "Player Two",
            "whatsapp": "9012345678",
            "payment_mode": "Cheque",
        }
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/tickets/request-booking/", payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["booking_type"], "random")
        self.assertTrue(response.data["booking_id"] > 0)
        self.assertEqual(response.data["payment_status"], "PENDING")
        self.assertIn("https://api.whatsapp.com/send?phone=", response.data["whatsapp_redirect_url"])
        self.assertTrue(response.data["eligible_privileges"]["normal_prizes"])
        self.assertTrue(response.data["eligible_privileges"]["half_sheet_bonus"])
        self.assertFalse(response.data["eligible_privileges"]["full_sheet_bonus"])
        self.assertEqual(response.data["requested_ticket_count"], 3)

        pending_count = Ticket.objects.filter(
            game=self.game,
            status=Ticket.Status.PENDING,
            requested_by_whatsapp="9012345678",
        ).count()
        self.assertEqual(pending_count, 3)

        booking = Booking.objects.get(id=response.data["booking_id"])
        self.assertEqual(booking.player, "Player Two")
        self.assertEqual(booking.booking_type, "random")
        self.assertEqual(booking.ticket_count, 3)
        self.assertEqual(booking.payment_mode, "Cheque")

    def test_player_bulk_booking_falls_back_to_game_agent_when_gamesettings_missing(self):
        GameSettings.objects.all().delete()
        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [11, 12, 13],
            "booking_type": "random",
            "player_name": "Player Three",
            "whatsapp": "9012345688",
            "payment_mode": "Cheque",
        }
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/tickets/request-booking/", payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://api.whatsapp.com/send?phone=919111111111", response.data["whatsapp_redirect_url"])

    @override_settings(WHATSAPP_DEFAULT_COUNTRY_CODE="")
    def test_player_bulk_booking_redirect_normalizes_local_10_digit_whatsapp(self):
        self.agent.whatsapp_number = "8837377528"
        self.agent.save(update_fields=["whatsapp_number"])
        settings_row = GameSettings.objects.order_by("-id").first()
        settings_row.agent_whatsapp_number = "8837377528"
        settings_row.save(update_fields=["agent_whatsapp_number"])

        payload = {
            "game_id": str(self.game.id),
            "ticket_numbers": [14, 15, 16],
            "booking_type": "random",
            "player_name": "Player Four",
            "whatsapp": "9012345699",
            "payment_mode": "Cheque",
        }
        self.client.force_authenticate(user=None)
        response = self.client.post("/api/tickets/request-booking/", payload, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("https://api.whatsapp.com/send?phone=918837377528", response.data["whatsapp_redirect_url"])
