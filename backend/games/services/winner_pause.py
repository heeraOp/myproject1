import logging
import os
import time

import redis
from django.conf import settings

logger = logging.getLogger(__name__)

WINNER_HOLD_KEY_PREFIX = "game_winner_hold"
DEFAULT_WINNER_ANNOUNCEMENT_HOLD_SECONDS = 7
MIN_WINNER_ANNOUNCEMENT_HOLD_SECONDS = 1


def _redis_client() -> redis.Redis:
    redis_url = str(getattr(settings, "REDIS_URL", "redis://127.0.0.1:6379/0")).strip()
    return redis.from_url(redis_url)


def _winner_hold_key(game_id) -> str:
    return f"{WINNER_HOLD_KEY_PREFIX}:{str(game_id)}"


def _resolve_hold_seconds(override_seconds: int | None = None) -> int:
    if override_seconds is not None:
        try:
            parsed = int(override_seconds)
        except (TypeError, ValueError):
            parsed = DEFAULT_WINNER_ANNOUNCEMENT_HOLD_SECONDS
        return max(MIN_WINNER_ANNOUNCEMENT_HOLD_SECONDS, parsed)

    configured = getattr(settings, "WINNER_ANNOUNCEMENT_HOLD_SECONDS", None)
    if configured is None:
        configured = os.environ.get(
            "WINNER_ANNOUNCEMENT_HOLD_SECONDS",
            DEFAULT_WINNER_ANNOUNCEMENT_HOLD_SECONDS,
        )
    try:
        parsed = int(configured)
    except (TypeError, ValueError):
        parsed = DEFAULT_WINNER_ANNOUNCEMENT_HOLD_SECONDS
    return max(MIN_WINNER_ANNOUNCEMENT_HOLD_SECONDS, parsed)


def _parse_hold_until(raw_value: bytes | str | None) -> float:
    if raw_value in (None, b"", ""):
        return 0.0
    try:
        if isinstance(raw_value, bytes):
            return float(raw_value.decode("utf-8"))
        return float(str(raw_value))
    except (TypeError, ValueError):
        return 0.0


def set_winner_announcement_hold(*, game_id, hold_seconds: int | None = None) -> float:
    """
    Persist/extend a winner announcement hold window for the game.
    Returns remaining hold seconds after update (best-effort).
    """
    key = _winner_hold_key(game_id)
    now_ts = time.time()
    requested_until = now_ts + _resolve_hold_seconds(hold_seconds)

    try:
        client = _redis_client()
        existing_until = _parse_hold_until(client.get(key))
        target_until = max(existing_until, requested_until)
        remaining = max(0.0, target_until - now_ts)
        ttl = max(2, int(remaining) + 2)
        client.set(key, f"{target_until:.3f}", ex=ttl)
        return remaining
    except redis.RedisError as exc:
        logger.warning("Unable to set winner hold for game=%s: %s", game_id, exc)
        return max(0.0, requested_until - now_ts)


def get_winner_announcement_hold_remaining(*, game_id) -> float:
    key = _winner_hold_key(game_id)
    now_ts = time.time()
    try:
        client = _redis_client()
        hold_until = _parse_hold_until(client.get(key))
        remaining = hold_until - now_ts
        if remaining <= 0:
            try:
                client.delete(key)
            except redis.RedisError:
                pass
            return 0.0
        return remaining
    except redis.RedisError as exc:
        logger.warning("Unable to read winner hold for game=%s: %s", game_id, exc)
        return 0.0
