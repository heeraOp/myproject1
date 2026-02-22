import logging

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer

from common.services import VoiceGenerationError, get_or_create_voice

logger = logging.getLogger(__name__)

GAME_START_VOICE_KEY = "game_start"
GAME_END_VOICE_KEY = "game_end"

GAME_START_VOICE_TEXT = (
    "The game is about to start. Players get ready. Today is your lucky day."
)
GAME_END_VOICE_TEXT = "The game has ended. Congratulations to all winners."

_PRIZE_LABEL_OVERRIDES = {
    "HALF_SHEET": "Half Sheet Bonus",
    "FULL_SHEET": "Full Sheet Bonus",
}


def _normalize_prize_token(value: str) -> str:
    token = str(value or "").strip().upper().replace(" ", "_").replace("-", "_")
    if token == "HALF_SHEET_BONUS":
        return "HALF_SHEET"
    if token == "FULL_SHEET_BONUS":
        return "FULL_SHEET"
    return token


def _humanize_prize_label(prize_name: str = "", prize_type: str = "") -> str:
    direct_label = str(prize_name or "").strip()
    if direct_label:
        return direct_label

    normalized = _normalize_prize_token(prize_type)
    if not normalized:
        return "Prize"
    return _PRIZE_LABEL_OVERRIDES.get(normalized, normalized.replace("_", " ").title())


def _prize_key_fragment(prize_name: str = "", prize_type: str = "") -> str:
    normalized = _normalize_prize_token(prize_type)
    if normalized:
        return normalized.lower()

    label = str(prize_name or "").strip().lower().replace(" ", "_").replace("-", "_")
    if label:
        return "".join(ch for ch in label if ch.isalnum() or ch == "_").strip("_") or "generic"
    return "generic"


def build_winner_prize_voice_key(prize_name: str = "", prize_type: str = "") -> str:
    return f"winner_prize_{_prize_key_fragment(prize_name=prize_name, prize_type=prize_type)}"


def build_winner_prize_voice_text(prize_name: str = "", prize_type: str = "") -> str:
    prize_label = _humanize_prize_label(prize_name=prize_name, prize_type=prize_type)
    return f"Congratulations players. {prize_label} prize has been won."


def broadcast_game_voice_event(*, game_id, event: str, voice_key: str, voice_text: str):
    safe_game_id = str(game_id)
    safe_event = str(event or "").strip()
    if not safe_game_id or not safe_event:
        return None

    try:
        audio_url = get_or_create_voice(voice_key, voice_text)
    except (VoiceGenerationError, ValueError) as exc:
        logger.warning(
            "Voice asset unavailable for event=%s game=%s key=%s: %s",
            safe_event,
            safe_game_id,
            voice_key,
            exc,
        )
        return None
    except Exception as exc:
        logger.exception(
            "Unexpected voice asset failure for event=%s game=%s key=%s: %s",
            safe_event,
            safe_game_id,
            voice_key,
            exc,
        )
        return None

    channel_layer = get_channel_layer()
    try:
        async_to_sync(channel_layer.group_send)(
            f"game_{safe_game_id}",
            {
                "type": "voice_event",
                "event": safe_event,
                "audio_url": audio_url,
            },
        )
    except Exception as exc:
        logger.warning(
            "Group broadcast failed (voice_event) event=%s game=%s: %s",
            safe_event,
            safe_game_id,
            exc,
        )
        return None

    return audio_url


def broadcast_winner_prize_voice_event(*, game_id, prize_name: str = "", prize_type: str = ""):
    return broadcast_game_voice_event(
        game_id=game_id,
        event="winner_prize",
        voice_key=build_winner_prize_voice_key(prize_name=prize_name, prize_type=prize_type),
        voice_text=build_winner_prize_voice_text(prize_name=prize_name, prize_type=prize_type),
    )
