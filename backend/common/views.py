import logging
import os
from pathlib import Path

from django.conf import settings
from django.http import FileResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from common.services import VoiceGenerationError, build_voice_text_hash, get_or_create_voice

logger = logging.getLogger(__name__)

MAX_VOICE_TEXT_LENGTH = 500
DEFAULT_VOICE_TYPE = "normal"
DEFAULT_ELEVEN_MODEL_ID = "eleven_turbo_v2"
VOICE_TYPE_VALUES = {
    "normal",
    "savage",
    "funny",
    "dramatic",
    "female_shout",
}
VOICE_TYPE_DEFAULT_IDS = {
    "normal": "EXAVITQu4vr4xnSDxMaL",
    "savage": "pNInz6obpgDQGcFmaJgB",
    "funny": "TxGEqnHWrfWFTfGW9XjX",
    "dramatic": "onwK4e9ZLuTAKqWW03F9",
    "female_shout": "21m00Tcm4TlvDq8ikWAM",
}


def _normalize_voice_type(value: str) -> str:
    normalized = str(value or "").strip().lower().replace(" ", "_")
    if normalized in VOICE_TYPE_VALUES:
        return normalized
    return DEFAULT_VOICE_TYPE


def _normalize_key_fragment(value: str) -> str:
    lowered = str(value or "").strip().lower().replace(" ", "_").replace("-", "_")
    normalized = "".join(char for char in lowered if char.isalnum() or char == "_").strip("_")
    return normalized[:120]


def _media_root() -> Path:
    configured = str(getattr(settings, "MEDIA_ROOT", "") or "").strip()
    if configured:
        return Path(configured)
    return Path(settings.BASE_DIR) / "media"


def _resolve_voice_profile(voice_type: str) -> tuple[str, str, str, str]:
    safe_voice_type = _normalize_voice_type(voice_type)
    upper = safe_voice_type.upper()

    configured_voice_id = str(os.getenv(f"ELEVEN_VOICE_ID_{upper}", "")).strip()
    fallback_voice_id = str(os.getenv("ELEVEN_VOICE_ID", "")).strip()
    default_voice_id = VOICE_TYPE_DEFAULT_IDS.get(safe_voice_type, VOICE_TYPE_DEFAULT_IDS[DEFAULT_VOICE_TYPE])
    voice_id = configured_voice_id or fallback_voice_id or default_voice_id

    configured_model_id = str(os.getenv(f"ELEVEN_MODEL_ID_{upper}", "")).strip()
    fallback_model_id = str(os.getenv("ELEVEN_MODEL_ID", "")).strip()
    model_id = configured_model_id or fallback_model_id or DEFAULT_ELEVEN_MODEL_ID

    hash_salt = f"voice_type={safe_voice_type}|voice_id={voice_id}|model_id={model_id}"
    return safe_voice_type, voice_id, model_id, hash_salt


class VoiceCacheView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        raw_text = str(request.query_params.get("text", "")).strip()
        if not raw_text:
            return Response({"detail": "text is required."}, status=400)

        normalized_text = " ".join(raw_text.split()).strip()
        if not normalized_text:
            return Response({"detail": "text is required."}, status=400)
        text = normalized_text[:MAX_VOICE_TEXT_LENGTH]

        voice_type = _normalize_voice_type(request.query_params.get("voice_type", DEFAULT_VOICE_TYPE))
        voice_type, voice_id, model_id, hash_salt = _resolve_voice_profile(voice_type)
        text_hash = build_voice_text_hash(text, hash_salt=hash_salt)
        requested_key = _normalize_key_fragment(request.query_params.get("key", ""))
        voice_key = requested_key or f"voice_{voice_type}_{text_hash[:32]}"

        try:
            get_or_create_voice(
                voice_key,
                text,
                hash_salt=hash_salt,
                voice_id=voice_id,
                model_id=model_id,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=400)
        except VoiceGenerationError as exc:
            return Response({"detail": str(exc)}, status=503)
        except Exception as exc:
            logger.exception("Unexpected error while creating voice asset key=%s: %s", voice_key, exc)
            return Response({"detail": "Unable to generate voice."}, status=500)

        relative_path = Path("voice_assets") / f"{text_hash}.mp3"
        absolute_path = _media_root() / relative_path
        if not absolute_path.exists():
            logger.error("Voice asset file missing after generation key=%s hash=%s", voice_key, text_hash)
            return Response({"detail": "Voice asset missing."}, status=500)

        response = FileResponse(absolute_path.open("rb"), content_type="audio/mpeg")
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        return response
