import tempfile
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase, override_settings

from common.models import VoiceAsset
from common.services.voice_assets import build_voice_text_hash, get_or_create_voice


class VoiceAssetServiceTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            MEDIA_ROOT=self.temp_dir.name,
            MEDIA_URL="/media/",
        )
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        self.temp_dir.cleanup()

    def test_build_voice_text_hash_is_stable_for_same_text(self):
        first = build_voice_text_hash("The game has ended.")
        second = build_voice_text_hash("The game has ended.")
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)

    def test_reuses_existing_database_voice_asset_without_api_call(self):
        text = "The game is about to start. Players get ready."
        text_hash = build_voice_text_hash(text)
        relative_path = f"voice_assets/{text_hash}.mp3"
        absolute_path = Path(settings.MEDIA_ROOT) / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(b"cached-audio")

        VoiceAsset.objects.create(
            key="game_start",
            text=text,
            hash=text_hash,
            audio_file=relative_path,
        )

        with patch("common.services.voice_assets._generate_audio_bytes_with_elevenlabs") as mock_generate:
            audio_url = get_or_create_voice("game_start", text)

        self.assertEqual(audio_url, f"/media/{relative_path}")
        mock_generate.assert_not_called()
        self.assertEqual(VoiceAsset.objects.count(), 1)

    def test_backfills_database_from_existing_hash_file(self):
        text = "The game has ended. Congratulations to the winner."
        text_hash = build_voice_text_hash(text)
        relative_path = f"voice_assets/{text_hash}.mp3"
        absolute_path = Path(settings.MEDIA_ROOT) / relative_path
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        absolute_path.write_bytes(b"existing-media-audio")

        self.assertEqual(VoiceAsset.objects.count(), 0)
        with patch("common.services.voice_assets._generate_audio_bytes_with_elevenlabs") as mock_generate:
            audio_url = get_or_create_voice("game_end", text)

        self.assertEqual(audio_url, f"/media/{relative_path}")
        mock_generate.assert_not_called()
        asset = VoiceAsset.objects.get(hash=text_hash)
        self.assertEqual(asset.key, "game_end")
        self.assertEqual(asset.audio_file.name, relative_path)

    def test_generates_once_for_new_text_and_reuses_on_next_call(self):
        text = "Future reusable announcement text."
        text_hash = build_voice_text_hash(text)
        relative_path = f"voice_assets/{text_hash}.mp3"
        absolute_path = Path(settings.MEDIA_ROOT) / relative_path

        with patch(
            "common.services.voice_assets._generate_audio_bytes_with_elevenlabs",
            return_value=b"generated-once-audio",
        ) as mock_generate:
            first_url = get_or_create_voice("future_announcement", text)
            second_url = get_or_create_voice("future_announcement", text)

        self.assertEqual(first_url, f"/media/{relative_path}")
        self.assertEqual(second_url, f"/media/{relative_path}")
        self.assertTrue(absolute_path.exists())
        self.assertEqual(absolute_path.read_bytes(), b"generated-once-audio")
        self.assertEqual(mock_generate.call_count, 1)


class VoiceCacheViewTests(TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(
            MEDIA_ROOT=self.temp_dir.name,
            MEDIA_URL="/media/",
        )
        self.settings_override.enable()

    def tearDown(self):
        self.settings_override.disable()
        self.temp_dir.cleanup()

    def _read_stream(self, response):
        return b"".join(response.streaming_content)

    def test_voice_endpoint_reuses_generated_asset_for_same_text(self):
        text = "Number 42. Winnie the pooh!"

        with patch(
            "common.services.voice_assets._generate_audio_bytes_with_elevenlabs",
            return_value=b"endpoint-generated-audio",
        ) as mock_generate:
            first = self.client.get("/api/voice/", {"text": text, "voice_type": "dramatic"})
            second = self.client.get("/api/voice/", {"text": text, "voice_type": "dramatic"})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(self._read_stream(first), b"endpoint-generated-audio")
        self.assertEqual(self._read_stream(second), b"endpoint-generated-audio")
        created_asset = VoiceAsset.objects.get()
        absolute_path = Path(settings.MEDIA_ROOT) / created_asset.audio_file.name
        self.assertTrue(absolute_path.exists())
        self.assertEqual(mock_generate.call_count, 1)
        self.assertEqual(VoiceAsset.objects.count(), 1)

    def test_voice_endpoint_generates_distinct_cached_assets_per_voice_type(self):
        text = "Number 5. Man alive!"

        with patch(
            "common.services.voice_assets._generate_audio_bytes_with_elevenlabs",
            side_effect=[b"normal-audio", b"dramatic-audio"],
        ) as mock_generate:
            normal_first = self.client.get("/api/voice/", {"text": text, "voice_type": "normal"})
            dramatic_first = self.client.get("/api/voice/", {"text": text, "voice_type": "dramatic"})
            normal_second = self.client.get("/api/voice/", {"text": text, "voice_type": "normal"})
            dramatic_second = self.client.get("/api/voice/", {"text": text, "voice_type": "dramatic"})

        self.assertEqual(normal_first.status_code, 200)
        self.assertEqual(dramatic_first.status_code, 200)
        self.assertEqual(normal_second.status_code, 200)
        self.assertEqual(dramatic_second.status_code, 200)
        self.assertEqual(self._read_stream(normal_first), b"normal-audio")
        self.assertEqual(self._read_stream(normal_second), b"normal-audio")
        self.assertEqual(self._read_stream(dramatic_first), b"dramatic-audio")
        self.assertEqual(self._read_stream(dramatic_second), b"dramatic-audio")
        self.assertEqual(mock_generate.call_count, 2)
        self.assertEqual(VoiceAsset.objects.count(), 2)
