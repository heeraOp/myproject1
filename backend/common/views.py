import json
import os
import re
import tempfile
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from rest_framework.response import Response
from rest_framework.views import APIView

ELEVEN_MODEL_ID = "eleven_turbo_v2"
VOICE_MAP = {
    "normal": "EXAVITQu4vr4xnSDxMaL",
    "savage": "pNInz6obpgDQGcFmaJgB",
    "funny": "TxGEqnHWrfWFTfGW9XjX",
    "dramatic": "onwK4e9ZLuTAKqWW03F9",
}


def sanitize_text_filename(text: str) -> str:
    normalized = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode("ascii")
    normalized = normalized.lower().strip()
    normalized = re.sub(r"\s+", "_", normalized)
    normalized = re.sub(r"[^a-z0-9_]", "", normalized)
    normalized = re.sub(r"_+", "_", normalized).strip("_")
    if not normalized:
        normalized = "voice"
    return normalized[:80]


class VoiceCacheView(APIView):
    authentication_classes = []

    def get(self, request):
        raw_text = str(request.query_params.get("text", "")).strip()
        if not raw_text:
            return Response({"detail": "text is required."}, status=400)

        text = raw_text[:240]
        raw_voice_type = str(request.query_params.get("voice_type", "normal")).strip().lower()
        voice_type = raw_voice_type if raw_voice_type in VOICE_MAP else "normal"
        voice_id = VOICE_MAP[voice_type]
        eleven_tts_url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"

        safe_name = sanitize_text_filename(text)
        file_name = f"{voice_type}_{safe_name}.mp3"

        cache_dir = Path(settings.BASE_DIR) / "media" / "voice_cache"
        cache_dir.mkdir(parents=True, exist_ok=True)
        audio_path = cache_dir / file_name

        if audio_path.exists():
            return FileResponse(audio_path.open("rb"), content_type="audio/mpeg")

        eleven_api_key = os.getenv("ELEVEN_API_KEY", "").strip()
        if not eleven_api_key:
            return Response({"detail": "Voice service is not configured."}, status=503)

        payload = json.dumps(
            {
                "text": text,
                "model_id": ELEVEN_MODEL_ID,
            }
        ).encode("utf-8")
        request_obj = urllib.request.Request(
            eleven_tts_url,
            data=payload,
            method="POST",
            headers={
                "xi-api-key": eleven_api_key,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
        )

        try:
            with urllib.request.urlopen(request_obj, timeout=20) as response:
                if response.status != 200:
                    return Response({"detail": "Unable to generate voice."}, status=502)
                audio_bytes = response.read()
                if not audio_bytes:
                    return Response({"detail": "Voice generation returned empty audio."}, status=502)
        except urllib.error.HTTPError:
            return Response({"detail": "Unable to generate voice."}, status=502)
        except urllib.error.URLError:
            return Response({"detail": "Voice service unavailable."}, status=503)
        except Exception:
            return Response({"detail": "Voice generation failed."}, status=500)

        temp_file = tempfile.NamedTemporaryFile(delete=False, dir=str(cache_dir), suffix=".tmp")
        try:
            temp_file.write(audio_bytes)
            temp_file.close()
            os.replace(temp_file.name, audio_path)
        finally:
            if os.path.exists(temp_file.name):
                os.unlink(temp_file.name)

        return FileResponse(audio_path.open("rb"), content_type="audio/mpeg")
