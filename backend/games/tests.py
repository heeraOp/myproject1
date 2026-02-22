from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlsplit

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITestCase

from claims.models import Prize
from games.models import (
    Agent,
    Announcement,
    Game,
    GameSettings,
    LobbyAnnouncement,
    LobbyAnnouncementAcceptance,
)
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


class GameAnnouncementApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="game-announcement-admin",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin_user)
        self.game = Game.objects.create(
            name="Announcement Game",
            status=Game.Status.RUNNING,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=90,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            is_current=True,
            created_by=self.admin_user,
        )

    def tearDown(self):
        for announcement in Announcement.objects.exclude(audio_file=""):
            audio_path = (Path(settings.BASE_DIR) / "media" / announcement.audio_file).resolve()
            if audio_path.exists():
                audio_path.unlink()

            for parent in (audio_path.parent, audio_path.parent.parent):
                if not parent.exists():
                    continue
                if any(parent.iterdir()):
                    continue
                parent.rmdir()

    def test_admin_can_send_text_announcement(self):
        response = self.client.post(
            f"/api/games/{self.game.id}/announce/",
            {"message": "Game resumes in 2 minutes"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["message"], "Game resumes in 2 minutes")
        self.assertIsNone(response.data.get("audio_url"))
        self.assertIsNone(response.data.get("audio_mime_type"))

    def test_admin_can_send_recorded_voice_announcement(self):
        clip_bytes = b"fake-audio-bytes"
        clip = SimpleUploadedFile(
            "announcement.webm",
            clip_bytes,
            content_type="audio/webm",
        )

        response = self.client.post(
            f"/api/games/{self.game.id}/announce/",
            {"audio_clip": clip},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["message"], "Voice announcement")
        self.assertEqual(response.data["audio_mime_type"], "audio/webm")
        audio_url = str(response.data["audio_url"] or "")
        self.assertTrue(audio_url.startswith("http://testserver/api/games/"))

        announcement = Announcement.objects.get(id=response.data["announcement_id"])
        self.assertTrue(bool(announcement.audio_file))
        stored_path = Path(settings.BASE_DIR) / "media" / announcement.audio_file
        self.assertTrue(stored_path.exists())

        audio_path = urlsplit(audio_url).path
        audio_response = self.client.get(audio_path)
        self.assertEqual(audio_response.status_code, 200)
        self.assertEqual(audio_response["Content-Type"], "audio/webm")
        self.assertEqual(b"".join(audio_response.streaming_content), clip_bytes)


class AdminCallNextNumberPauseTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="admin-call-next-pause",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.client.force_authenticate(user=self.admin_user)
        self.game = Game.objects.create(
            name="Call Pause Game",
            status=Game.Status.RUNNING,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=90,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            is_current=True,
            created_by=self.admin_user,
        )

    @patch("games.views.get_winner_announcement_hold_remaining", return_value=4.6)
    def test_call_next_is_blocked_while_winner_announcement_hold_is_active(self, _mock_hold):
        response = self.client.post(f"/api/games/admin/{self.game.id}/call-next/", {}, format="json")
        self.assertEqual(response.status_code, 409)
        self.assertIn("Winner announcement is in progress", str(response.data.get("detail", "")))
        self.assertEqual(response.data.get("retry_after_seconds"), 5)


class LobbyAnnouncementApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="lobby-announcement-admin",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.player_user = user_model.objects.create_user(
            username="lobby-announcement-player",
            password="pass1234",
            role="AGENT",
            is_staff=False,
        )
        self.game = Game.objects.create(
            name="Lobby Announcement Game",
            status=Game.Status.CREATED,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=90,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            is_current=True,
            created_by=self.admin_user,
        )
        self.announcement = LobbyAnnouncement.objects.create(
            lobby=self.game,
            title="Important",
            content="Read and accept before entering lobby.",
            is_active=True,
        )

    def test_announcement_get_requires_authentication(self):
        response = self.client.get(f"/api/lobby/{self.game.id}/announcement/")
        self.assertEqual(response.status_code, 403)

    def test_get_and_accept_flow_for_authenticated_user(self):
        self.client.force_authenticate(user=self.player_user)

        initial = self.client.get(f"/api/lobby/{self.game.id}/announcement/")
        self.assertEqual(initial.status_code, 200)
        self.assertEqual(initial.data["id"], self.announcement.id)
        self.assertEqual(initial.data["title"], "Important")
        self.assertEqual(initial.data["version"], 1)
        self.assertEqual(initial.data["is_accepted"], False)

        accept_first = self.client.post(
            f"/api/lobby/{self.game.id}/announcement/accept/",
            {"announcement_id": self.announcement.id},
            format="json",
        )
        self.assertEqual(accept_first.status_code, 200)
        self.assertEqual(accept_first.data["accepted"], True)
        self.assertEqual(accept_first.data["already_accepted"], False)
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(
                user=self.player_user,
                lobby=self.game,
                announcement=self.announcement,
            ).count(),
            1,
        )

        accept_second = self.client.post(
            f"/api/lobby/{self.game.id}/announcement/accept/",
            {"announcement_id": self.announcement.id},
            format="json",
        )
        self.assertEqual(accept_second.status_code, 200)
        self.assertEqual(accept_second.data["accepted"], True)
        self.assertEqual(accept_second.data["already_accepted"], True)
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(
                user=self.player_user,
                lobby=self.game,
                announcement=self.announcement,
            ).count(),
            1,
        )

        after_accept = self.client.get(f"/api/lobby/{self.game.id}/announcement/")
        self.assertEqual(after_accept.status_code, 200)
        self.assertEqual(after_accept.data["is_accepted"], True)

    def test_get_returns_null_when_no_active_announcement(self):
        self.client.force_authenticate(user=self.player_user)
        self.announcement.is_active = False
        self.announcement.save(update_fields=["is_active"])

        response = self.client.get(f"/api/lobby/{self.game.id}/announcement/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data)

    def test_accept_rejects_non_active_or_wrong_lobby_announcement(self):
        self.client.force_authenticate(user=self.player_user)
        other_game = Game.objects.create(
            name="Other Lobby",
            status=Game.Status.CREATED,
            game_datetime=timezone.now(),
            ticket_price=50,
            agent_commission=0,
            total_ticket_limit=40,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=False,
            is_current=False,
            created_by=self.admin_user,
        )
        other_announcement = LobbyAnnouncement.objects.create(
            lobby=other_game,
            title="Other",
            content="Other lobby announcement",
            is_active=True,
        )

        response = self.client.post(
            f"/api/lobby/{self.game.id}/announcement/accept/",
            {"announcement_id": other_announcement.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(user=self.player_user).count(),
            0,
        )

    def test_editing_announcement_increments_version_and_requires_reacceptance(self):
        self.client.force_authenticate(user=self.player_user)
        self.client.post(
            f"/api/lobby/{self.game.id}/announcement/accept/",
            {"announcement_id": self.announcement.id},
            format="json",
        )
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(
                user=self.player_user,
                lobby=self.game,
                announcement=self.announcement,
            ).count(),
            1,
        )

        self.announcement.content = "Updated content"
        self.announcement.save()
        self.announcement.refresh_from_db()
        self.assertEqual(self.announcement.version, 2)
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(
                user=self.player_user,
                lobby=self.game,
                announcement=self.announcement,
            ).count(),
            0,
        )

        refreshed = self.client.get(f"/api/lobby/{self.game.id}/announcement/")
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(refreshed.data["version"], 2)
        self.assertEqual(refreshed.data["is_accepted"], False)

    def test_only_one_active_announcement_is_kept_per_lobby(self):
        first = self.announcement
        second = LobbyAnnouncement.objects.create(
            lobby=self.game,
            title="Second",
            content="Second active announcement",
            is_active=True,
        )
        first.refresh_from_db()
        second.refresh_from_db()

        self.assertFalse(first.is_active)
        self.assertTrue(second.is_active)


class AdminLobbyAnnouncementManageApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin_user = user_model.objects.create_user(
            username="lobby-announcement-admin-manage",
            password="pass1234",
            role="ADMIN",
            is_staff=True,
        )
        self.player_user = user_model.objects.create_user(
            username="lobby-announcement-admin-manage-player",
            password="pass1234",
            role="AGENT",
            is_staff=False,
        )
        self.game = Game.objects.create(
            name="Lobby Announcement Admin Game",
            status=Game.Status.CREATED,
            game_datetime=timezone.now(),
            ticket_price=100,
            agent_commission=0,
            total_ticket_limit=90,
            booking_status=Game.BookingStatus.OPEN,
            website_status=Game.WebsiteStatus.OPEN,
            active_theme=Game.Theme.DARK,
            is_active=True,
            is_current=True,
            created_by=self.admin_user,
        )
        self.endpoint = f"/api/games/admin/{self.game.id}/lobby-announcement/"

    def test_non_admin_cannot_manage_lobby_announcement(self):
        self.client.force_authenticate(user=self.player_user)
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 403)

    def test_get_returns_null_when_no_active_lobby_announcement(self):
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get(self.endpoint)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data)

    def test_put_creates_and_updates_active_lobby_announcement(self):
        self.client.force_authenticate(user=self.admin_user)

        created = self.client.put(
            self.endpoint,
            {
                "title": "Lobby Terms",
                "content": "Accept these terms before entering the lobby.",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.data["title"], "Lobby Terms")
        self.assertEqual(created.data["version"], 1)
        self.assertEqual(created.data["is_active"], True)

        announcement_id = int(created.data["id"])
        announcement = LobbyAnnouncement.objects.get(id=announcement_id)

        LobbyAnnouncementAcceptance.objects.create(
            user=self.player_user,
            lobby=self.game,
            announcement=announcement,
        )
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(announcement=announcement, user=self.player_user).count(),
            1,
        )

        updated = self.client.put(
            self.endpoint,
            {
                "title": "Lobby Terms",
                "content": "Updated terms text for all players.",
                "is_active": True,
            },
            format="json",
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["id"], announcement_id)
        self.assertEqual(updated.data["version"], 2)
        self.assertEqual(updated.data["is_active"], True)

        announcement.refresh_from_db()
        self.assertEqual(announcement.version, 2)
        self.assertEqual(
            LobbyAnnouncementAcceptance.objects.filter(announcement=announcement, user=self.player_user).count(),
            0,
        )

    def test_put_can_deactivate_active_lobby_announcement(self):
        self.client.force_authenticate(user=self.admin_user)
        LobbyAnnouncement.objects.create(
            lobby=self.game,
            title="Lobby Terms",
            content="Terms",
            is_active=True,
        )

        deactivate = self.client.put(
            self.endpoint,
            {
                "title": "Lobby Terms",
                "content": "Terms",
                "is_active": False,
            },
            format="json",
        )
        self.assertEqual(deactivate.status_code, 200)
        self.assertEqual(deactivate.data["is_active"], False)

        after = self.client.get(self.endpoint)
        self.assertEqual(after.status_code, 200)
        self.assertIsNone(after.data)
