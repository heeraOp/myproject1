import hashlib
import logging
import os
import tempfile
from pathlib import Path

from django.conf import settings
from django.db import IntegrityError, transaction

from common.models import VoiceAsset

logger = logging.getLogger(__name__)

ELEVEN_DEFAULT_MODEL_ID = "eleven_turbo_v2"
ELEVEN_DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"


class VoiceGenerationError(Exception):
    """Raised when voice generation fails in a controlled way."""


def normalize_voice_text(value: str) -> str:
    text = " ".join(str(value or "").split())
    return text.strip()


def normalize_voice_key(value: str) -> str:
    key = str(value or "").strip().lower().replace(" ", "_")
    return key


def normalize_voice_hash_salt(value: str) -> str:
    return " ".join(str(value or "").split()).strip()


def build_voice_text_hash(text: str, *, hash_salt: str = "") -> str:
    normalized_text = normalize_voice_text(text)
    normalized_hash_salt = normalize_voice_hash_salt(hash_salt)
    base = normalized_text if not normalized_hash_salt else f"{normalized_text}||{normalized_hash_salt}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _media_root() -> Path:
    configured = getattr(settings, "MEDIA_ROOT", "") or ""
    if configured:
        return Path(configured)
    return Path(settings.BASE_DIR) / "media"


def _voice_relative_path(text_hash: str) -> str:
    return f"voice_assets/{text_hash}.mp3"


def _voice_absolute_path(text_hash: str) -> Path:
    return _media_root() / _voice_relative_path(text_hash)


def _voice_public_url(relative_path: str) -> str:
    media_url = str(getattr(settings, "MEDIA_URL", "/media/") or "/media/")
    if not media_url.endswith("/"):
        media_url = f"{media_url}/"
    normalized_relative_path = str(relative_path or "").replace("\\", "/").lstrip("/")
    return f"{media_url}{normalized_relative_path}"


def _safe_absolute_path_for_relative(relative_path: str):
    normalized = str(relative_path or "").replace("\\", "/").lstrip("/")
    if not normalized:
        return None

    media_root = _media_root().resolve()
    candidate = (media_root / normalized).resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError:
        return None
    return candidate


def _write_audio_file_atomic(target_path: Path, audio_bytes: bytes):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_file = tempfile.NamedTemporaryFile(delete=False, dir=str(target_path.parent), suffix=".tmp")
    try:
        temp_file.write(audio_bytes)
        temp_file.close()
        os.replace(temp_file.name, target_path)
    finally:
        if os.path.exists(temp_file.name):
            os.unlink(temp_file.name)


def _generate_audio_bytes_with_elevenlabs(
    text: str,
    *,
    voice_id: str | None = None,
    model_id: str | None = None,
    voice_settings: dict | None = None,
) -> bytes:
    try:
        import requests
    except ImportError as exc:
        raise VoiceGenerationError("requests library is required for ElevenLabs integration.") from exc

    api_key = str(os.getenv("ELEVEN_API_KEY", "")).strip()
    if not api_key:
        raise VoiceGenerationError("ELEVEN_API_KEY is not configured.")

    resolved_voice_id = str(voice_id or "").strip() or str(
        os.getenv("ELEVEN_VOICE_ID", ELEVEN_DEFAULT_VOICE_ID)
    ).strip() or ELEVEN_DEFAULT_VOICE_ID
    resolved_model_id = str(model_id or "").strip() or str(
        os.getenv("ELEVEN_MODEL_ID", ELEVEN_DEFAULT_MODEL_ID)
    ).strip() or ELEVEN_DEFAULT_MODEL_ID
    endpoint = f"https://api.elevenlabs.io/v1/text-to-speech/{resolved_voice_id}"
    payload = {
        "text": text,
        "model_id": resolved_model_id,
    }
    if isinstance(voice_settings, dict) and voice_settings:
        payload["voice_settings"] = voice_settings
    headers = {
        "xi-api-key": api_key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
    }

    try:
        response = requests.post(
            endpoint,
            json=payload,
            headers=headers,
            timeout=(5, 30),
        )
    except requests.RequestException as exc:
        logger.exception("ElevenLabs request failed for voice hash generation.")
        raise VoiceGenerationError("Voice service unavailable.") from exc

    if response.status_code != 200:
        body_preview = str(response.text or "")[:300]
        logger.error(
            "ElevenLabs generation failed with status=%s body=%s",
            response.status_code,
            body_preview,
        )
        raise VoiceGenerationError("Voice generation failed.")

    audio_bytes = bytes(response.content or b"")
    if not audio_bytes:
        logger.error("ElevenLabs returned empty audio payload.")
        raise VoiceGenerationError("Voice generation returned empty audio.")

    return audio_bytes


def _recover_asset_for_race(*, key: str, text_hash: str):
    asset = VoiceAsset.objects.select_for_update().filter(hash=text_hash).first()
    if asset is not None:
        return asset
    return VoiceAsset.objects.select_for_update().filter(key=key).first()


def get_or_create_voice(
    key: str,
    text: str,
    *,
    hash_salt: str = "",
    voice_id: str | None = None,
    model_id: str | None = None,
    voice_settings: dict | None = None,
) -> str:
    normalized_key = normalize_voice_key(key)
    normalized_text = normalize_voice_text(text)
    normalized_hash_salt = normalize_voice_hash_salt(hash_salt)
    if not normalized_key:
        raise ValueError("key is required.")
    if not normalized_text:
        raise ValueError("text is required.")

    text_hash = build_voice_text_hash(normalized_text, hash_salt=normalized_hash_salt)
    relative_path = _voice_relative_path(text_hash)
    absolute_path = _voice_absolute_path(text_hash)

    with transaction.atomic():
        # 1) Reuse existing DB record by hash when present.
        by_hash = VoiceAsset.objects.select_for_update().filter(hash=text_hash).first()
        if by_hash is not None:
            current_path = _safe_absolute_path_for_relative(by_hash.audio_file.name)
            if current_path and current_path.exists():
                return _voice_public_url(by_hash.audio_file.name)

            if absolute_path.exists():
                if by_hash.audio_file.name != relative_path:
                    by_hash.audio_file.name = relative_path
                    by_hash.save(update_fields=["audio_file"])
                return _voice_public_url(by_hash.audio_file.name)

            by_hash.audio_file.name = relative_path
            by_hash.text = normalized_text
            by_hash.save(update_fields=["audio_file", "text"])
            try:
                audio_bytes = _generate_audio_bytes_with_elevenlabs(
                    normalized_text,
                    voice_id=voice_id,
                    model_id=model_id,
                    voice_settings=voice_settings,
                )
                _write_audio_file_atomic(absolute_path, audio_bytes)
            except OSError as exc:
                logger.exception("Failed to persist generated voice asset file.")
                raise VoiceGenerationError("Unable to store generated voice file.") from exc
            return _voice_public_url(by_hash.audio_file.name)

        # 2) Detect existing file on disk (previously generated) and backfill DB.
        if absolute_path.exists():
            by_key = VoiceAsset.objects.select_for_update().filter(key=normalized_key).first()
            if by_key is not None:
                by_key.text = normalized_text
                by_key.hash = text_hash
                by_key.audio_file.name = relative_path
                by_key.save(update_fields=["text", "hash", "audio_file"])
                return _voice_public_url(by_key.audio_file.name)

            try:
                created = VoiceAsset.objects.create(
                    key=normalized_key,
                    text=normalized_text,
                    hash=text_hash,
                    audio_file=relative_path,
                )
                return _voice_public_url(created.audio_file.name)
            except IntegrityError:
                recovered = _recover_asset_for_race(key=normalized_key, text_hash=text_hash)
                if recovered is None:
                    raise
                return _voice_public_url(recovered.audio_file.name or relative_path)

        # 3) Reserve DB slot first (concurrency protection), then generate once.
        target_asset = VoiceAsset.objects.select_for_update().filter(key=normalized_key).first()
        if target_asset is not None:
            target_asset.text = normalized_text
            target_asset.hash = text_hash
            target_asset.audio_file.name = relative_path
            try:
                target_asset.save(update_fields=["text", "hash", "audio_file"])
            except IntegrityError:
                recovered = _recover_asset_for_race(key=normalized_key, text_hash=text_hash)
                if recovered is None:
                    raise
                return _voice_public_url(recovered.audio_file.name or relative_path)
        else:
            try:
                target_asset = VoiceAsset.objects.create(
                    key=normalized_key,
                    text=normalized_text,
                    hash=text_hash,
                    audio_file=relative_path,
                )
            except IntegrityError:
                recovered = _recover_asset_for_race(key=normalized_key, text_hash=text_hash)
                if recovered is None:
                    raise
                return _voice_public_url(recovered.audio_file.name or relative_path)

        try:
            audio_bytes = _generate_audio_bytes_with_elevenlabs(
                normalized_text,
                voice_id=voice_id,
                model_id=model_id,
                voice_settings=voice_settings,
            )
            _write_audio_file_atomic(absolute_path, audio_bytes)
        except OSError as exc:
            logger.exception("Failed to persist generated voice asset file.")
            raise VoiceGenerationError("Unable to store generated voice file.") from exc

        return _voice_public_url(target_asset.audio_file.name or relative_path)
