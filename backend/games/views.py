import logging
import math
import mimetypes
import os
import tempfile
import uuid
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.urls import reverse
from django.utils import timezone
from rest_framework import serializers
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from rest_framework.views import APIView

from common.permissions import IsAdminRole, is_admin_user
from .models import Agent, Announcement, Game, GameSettings
from .serializers import AnnouncementCreateSerializer, GameMetaSerializer, GameRecreateSerializer
from .services.voice_events import (
    GAME_END_VOICE_KEY,
    GAME_END_VOICE_TEXT,
    GAME_START_VOICE_KEY,
    GAME_START_VOICE_TEXT,
    broadcast_game_voice_event,
)
from .services.winner_pause import get_winner_announcement_hold_remaining
from .utils.calling import call_next_number
from .utils.leaderboard import build_live_leaderboard
from .tasks import auto_call_numbers
from claims.models import Claim, Winner, Prize
from claims.utils.evaluator import evaluate_claims_for_game
from claims.serializers import WinnerSerializer
from tickets.models import Ticket
from tickets.serializers import PlayerTicketSerializer, PublicTicketSerializer
from tickets.utils.generator import generate_housie_ticket


logger = logging.getLogger(__name__)


PRIZE_LABEL_OVERRIDES = {
    "HALF_SHEET": "Half Sheet Bonus",
    "FULL_SHEET": "Full Sheet Bonus",
}

PRIZE_RULE_EXPLANATIONS = {
    "EARLY_5": "Any 5 numbers on a confirmed ticket must be called.",
    "QUICK_6": "Any 6 numbers on a confirmed ticket must be called.",
    "QUICK_7": "Any 7 numbers on a confirmed ticket must be called.",
    "TOP_LINE": "All numbers in the top row must be called.",
    "MIDDLE_LINE": "All numbers in the middle row must be called.",
    "BOTTOM_LINE": "All numbers in the bottom row must be called.",
    "BOX": "At least 2 numbers in each row must be called (minimum 6 total).",
    "CORNER": "First and last numbers of top and bottom rows must be called.",
    "STAR": "All corners plus the middle-row center number must be called.",
    "FIRST_HOUSE": "All ticket numbers must be called (full house validation).",
    "SECOND_HOUSE": "All ticket numbers must be called (full house validation).",
    "THIRD_HOUSE": "All ticket numbers must be called (full house validation).",
    "HALF_SHEET": (
        "Player must own at least 3 confirmed tickets in the same player name, and each of those "
        "tickets must have at least one called number."
    ),
    "FULL_SHEET": (
        "Player must own at least 6 confirmed tickets in the same player name, and each of those "
        "tickets must have at least one called number. If a Half Sheet prize is still pending, "
        "Full Sheet is evaluated only after Half Sheet is settled."
    ),
}

DEFAULT_HOW_TO_PLAY = (
    "Numbers are called live.\n"
    "Numbers are marked automatically.\n"
    "Claims will be auto-verified.\n"
    "Sheet bonuses apply based on ticket count.\n"
    "Winners are auto verified and awarded.\n"
    "Prizes will be distributed manually by admin/host.\n"
)


ACTIVE_STATUS_VALUES = {
    Game.Status.ACTIVE,
    Game.Status.BOOKING_OPEN,
    Game.Status.RUNNING,
    Game.Status.PAUSED,
}

ANNOUNCEMENT_AUDIO_DIR = "announcement_audio"
ANNOUNCEMENT_AUDIO_EXTENSION_DEFAULT = ".webm"
ANNOUNCEMENT_AUDIO_EXTENSION_BY_CONTENT_TYPE = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
}
ANNOUNCEMENT_AUDIO_EXTENSIONS = {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".aac", ".mpeg", ".oga"}


def _announcement_media_root() -> Path:
    return Path(settings.BASE_DIR) / "media"


def _resolve_audio_extension(file_name: str, content_type: str) -> str:
    safe_name = str(file_name or "").strip().lower()
    suffix = Path(safe_name).suffix
    if suffix in ANNOUNCEMENT_AUDIO_EXTENSIONS:
        return suffix

    normalized_content_type = str(content_type or "").split(";")[0].strip().lower()
    mapped_extension = ANNOUNCEMENT_AUDIO_EXTENSION_BY_CONTENT_TYPE.get(normalized_content_type)
    if mapped_extension:
        return mapped_extension

    guessed_extension = mimetypes.guess_extension(normalized_content_type, strict=False) or ""
    if guessed_extension in ANNOUNCEMENT_AUDIO_EXTENSIONS:
        return guessed_extension

    return ANNOUNCEMENT_AUDIO_EXTENSION_DEFAULT


def _save_announcement_audio(*, game_id, audio_clip):
    media_root = _announcement_media_root()
    target_dir = media_root / ANNOUNCEMENT_AUDIO_DIR / str(game_id)
    target_dir.mkdir(parents=True, exist_ok=True)

    extension = _resolve_audio_extension(
        file_name=getattr(audio_clip, "name", ""),
        content_type=getattr(audio_clip, "content_type", ""),
    )
    final_name = f"{uuid.uuid4().hex}{extension}"
    final_path = target_dir / final_name
    relative_path = (Path(ANNOUNCEMENT_AUDIO_DIR) / str(game_id) / final_name).as_posix()

    temp_file = tempfile.NamedTemporaryFile(delete=False, dir=str(target_dir), suffix=".tmp")
    try:
        for chunk in audio_clip.chunks():
            temp_file.write(chunk)
        temp_file.close()
        os.replace(temp_file.name, final_path)
    finally:
        if os.path.exists(temp_file.name):
            os.unlink(temp_file.name)

    content_type = str(getattr(audio_clip, "content_type", "") or "").split(";")[0].strip().lower()
    if not content_type.startswith("audio/"):
        content_type = ""

    return relative_path, content_type


def _resolve_announcement_audio_path(relative_path: str):
    if not relative_path:
        return None

    media_root = _announcement_media_root().resolve()
    candidate = (media_root / str(relative_path)).resolve()
    try:
        candidate.relative_to(media_root)
    except ValueError:
        return None

    if not candidate.exists() or not candidate.is_file():
        return None

    return candidate


def _announcement_audio_url(*, request, game_id, announcement_id, audio_file):
    if not audio_file:
        return None
    url = reverse(
        "game-announcement-audio",
        kwargs={"game_id": game_id, "announcement_id": announcement_id},
    )
    return request.build_absolute_uri(url)


def _configured_status():
    """
    Resolve the configured status. If not defined on the model, fall back to CREATED.
    """
    return getattr(Game.Status, "CONFIGURED", Game.Status.CREATED)


def _mark_game_finished_if_numbers_exhausted(game):
    """
    Mark game as FINISHED when all 90 numbers are called and broadcast once.
    Returns True when the game transitioned in this call.
    """
    if game.status == Game.Status.FINISHED:
        return False

    if game.called_numbers.count() < 90:
        return False

    with transaction.atomic():
        locked_game = get_object_or_404(Game.objects.select_for_update(), id=game.id)
        if locked_game.status == Game.Status.FINISHED:
            return False
        if locked_game.called_numbers.count() < 90:
            return False

        locked_game.status = Game.Status.FINISHED
        locked_game.save(update_fields=["status"])

    channel_layer = get_channel_layer()
    try:
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "game_finished",
                "status": "ENDED",
            },
        )
    except Exception as exc:
        logger.warning("Group broadcast failed (game_finished): %s", exc)
    broadcast_game_voice_event(
        game_id=game.id,
        event="game_end",
        voice_key=GAME_END_VOICE_KEY,
        voice_text=GAME_END_VOICE_TEXT,
    )
    return True


def _clear_claim_progress(game):
    """
    Clear winner/claim progress and reopen claimed prizes for a game.
    """
    Claim.objects.filter(game=game).delete()
    Winner.objects.filter(game=game).delete()
    game.prizes.filter(is_claimed=True).update(is_claimed=False)


def _ticket_snapshot_context(game, viewer_phone=None):
    called_numbers = list(game.called_numbers.values_list("number", flat=True))
    context = {
        "called_numbers": called_numbers,
        "called_numbers_set": set(called_numbers),
        "final_immutable": game.status == Game.Status.FINISHED,
    }
    if viewer_phone is not None:
        context["viewer_phone"] = viewer_phone
    return context


def _agent_payload(agent):
    if agent is None:
        return None
    return {
        "id": agent.id,
        "name": agent.name,
        "whatsapp_number": agent.whatsapp_number,
    }


def _normalize_whatsapp(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


def _sync_latest_game_settings(game):
    if game is None:
        return

    game_name = str(getattr(game, "name", "") or "").strip()
    agent = getattr(game, "agent", None)
    agent_whatsapp = str(getattr(agent, "whatsapp_number", "") or "").strip()
    if not game_name or not agent_whatsapp:
        return

    latest = GameSettings.objects.order_by("-id").first()
    if latest is None:
        GameSettings.objects.create(
            game_name=game_name,
            agent_whatsapp_number=agent_whatsapp,
        )
        return

    update_fields = []
    if latest.game_name != game_name:
        latest.game_name = game_name
        update_fields.append("game_name")
    if latest.agent_whatsapp_number != agent_whatsapp:
        latest.agent_whatsapp_number = agent_whatsapp
        update_fields.append("agent_whatsapp_number")
    if update_fields:
        latest.save(update_fields=update_fields)


def _normalize_prize_type_key(value):
    text = str(value or "").strip().upper()
    normalized = text.replace(" ", "_").replace("-", "_")
    if normalized == "HALF_SHEET_BONUS":
        return "HALF_SHEET"
    if normalized == "FULL_SHEET_BONUS":
        return "FULL_SHEET"
    return normalized


def _prize_label_for_type(prize_type, label_map):
    normalized = _normalize_prize_type_key(prize_type)
    if not normalized:
        return "Unknown Prize"
    return (
        PRIZE_LABEL_OVERRIDES.get(normalized)
        or label_map.get(normalized)
        or label_map.get(str(prize_type).strip())
        or normalized.replace("_", " ").title()
    )


def _prize_explanation_for_type(prize_type):
    normalized = _normalize_prize_type_key(prize_type)
    if not normalized:
        return "Prize rule is not available."
    return PRIZE_RULE_EXPLANATIONS.get(
        normalized,
        "Win condition follows admin-configured server-side validation for this prize.",
    )


def _prize_pattern_details_for_game(game):
    label_map = dict(Prize.PrizeType.choices)
    enabled_prizes = list(Prize.objects.filter(game=game, enabled=True).order_by("id"))
    source_types = (
        [prize.prize_type for prize in enabled_prizes]
        if enabled_prizes
        else [choice[0] for choice in Prize.PrizeType.choices]
    )

    details = []
    seen = set()
    for prize_type in source_types:
        normalized = _normalize_prize_type_key(prize_type)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        details.append(
            {
                "prize_type": normalized,
                "label": _prize_label_for_type(prize_type, label_map),
                "explanation": _prize_explanation_for_type(prize_type),
            }
        )
    return details


def _prize_patterns_for_game(game):
    label_map = dict(Prize.PrizeType.choices)
    patterns = []
    seen = set()
    prizes = Prize.objects.filter(game=game, enabled=True).order_by("id")
    for prize in prizes:
        label = _prize_label_for_type(prize.prize_type, label_map)
        if label in seen:
            continue
        seen.add(label)
        patterns.append(label)
    return patterns


def _admin_game_payload(game):
    game_datetime = timezone.localtime(game.game_datetime) if timezone.is_aware(game.game_datetime) else game.game_datetime
    return {
        "id": str(game.id),
        "name": game.name,
        "date": game_datetime.isoformat() if hasattr(game_datetime, "isoformat") else str(game_datetime),
        "status": game.status,
        "calling_interval": game.calling_interval,
        "booking_status": game.booking_status,
        "website_status": game.website_status,
        "total_tickets": game.total_ticket_limit,
        "ticket_price": game.ticket_price,
        "agent_commission": game.agent_commission,
        "agent": _agent_payload(game.agent),
        "active_theme": game.active_theme,
        "is_active": game.is_active,
        "version": int(getattr(game, "version", 1)),
        "is_current": bool(getattr(game, "is_current", False)),
        "recreated_from": str(game.recreated_from_id) if getattr(game, "recreated_from_id", None) else None,
        "recreated_at": timezone.localtime(game.recreated_at).isoformat()
        if getattr(game, "recreated_at", None)
        else None,
        "reason": game.reason or None,
    }


def _get_current_game_queryset():
    return Game.objects.filter(is_current=True)


def _get_current_game():
    return _get_current_game_queryset().first()


def _broadcast_game_update(game, changed_fields):
    if not isinstance(changed_fields, dict) or not changed_fields:
        return

    channel_layer = get_channel_layer()
    try:
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "game_update",
                "data": {
                    "game_id": str(game.id),
                    "changed_fields": changed_fields,
                },
            },
        )
    except Exception as exc:
        logger.warning("Group broadcast failed (game_update): %s", str(exc))


def _broadcast_game_recreated(*, original_game, new_game, reason):
    payload = {
        "old_game_id": str(original_game.id),
        "new_game_id": str(new_game.id),
        "reason": reason,
        "new_game": _admin_game_payload(new_game),
    }
    channel_layer = get_channel_layer()
    target_groups = {
        "global_lobby",
        f"game_{str(original_game.id)}",
        f"game_{str(new_game.id)}",
    }
    for group_name in target_groups:
        try:
            async_to_sync(channel_layer.group_send)(
                group_name,
                {
                    "type": "game_recreated",
                    "data": payload,
                },
            )
        except Exception as exc:
            logger.warning("Group broadcast failed (game_recreated): %s", str(exc))


class AdminGameCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, trim_whitespace=True)
    date = serializers.DateTimeField(default_timezone=timezone.get_default_timezone())
    ticket_price = serializers.IntegerField(min_value=1)
    total_tickets = serializers.IntegerField(min_value=1)
    calling_interval = serializers.IntegerField(min_value=1, required=False)
    agent_commission = serializers.IntegerField(min_value=0, required=False, default=0)
    agent_id = serializers.IntegerField(required=False, allow_null=True)
    booking_status = serializers.ChoiceField(
        choices=Game.BookingStatus.choices,
        required=False,
        default=Game.BookingStatus.OPEN,
    )
    website_status = serializers.ChoiceField(
        choices=Game.WebsiteStatus.choices,
        required=False,
        default=Game.WebsiteStatus.OPEN,
    )
    active_theme = serializers.ChoiceField(
        choices=Game.Theme.choices,
        required=False,
        default=Game.Theme.DARK,
    )

    def validate_date(self, value):
        default_tz = timezone.get_default_timezone()
        if timezone.is_naive(value):
            return timezone.make_aware(value, default_tz)
        return timezone.localtime(value, default_tz)

    def validate_name(self, value):
        name = value.strip()
        if not name:
            raise serializers.ValidationError("name is required.")
        return name

    def validate_agent_id(self, value):
        if value in (None, ""):
            return None
        agent = Agent.objects.filter(id=value, is_active=True).first()
        if agent is None:
            raise serializers.ValidationError("Agent not found or inactive.")
        return agent


class AdminResetCallView(APIView):
    """
    Admin-only endpoint to clear called numbers and claim progress.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset calls while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset calls after game is FINISHED."}, status=400)

            deleted_called, _ = game.called_numbers.all().delete()
            _clear_claim_progress(game)

            if game.status == Game.Status.PAUSED:
                game.status = Game.Status.CREATED
                game.ended_at = None
                game.save(update_fields=["status", "ended_at"])

        return Response({"detail": "Call history reset.", "cleared_called_numbers": deleted_called})


class AdminResetTicketView(APIView):
    """
    Admin-only endpoint to clear ticket assignments.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset tickets while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset tickets after game is FINISHED."}, status=400)

            updated = game.tickets.update(
                player_name=None,
                player_phone=None,
                status=Ticket.Status.AVAILABLE,
                ticket_type=Ticket.TicketType.RANDOM,
                booked_at=None,
            )

            _clear_claim_progress(game)

        return Response({"detail": "Tickets reset.", "updated_tickets": updated})


class AdminResetAgentView(APIView):
    """
    Admin-only endpoint to clear agent/player assignments from tickets.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status == Game.Status.RUNNING:
                return Response({"detail": "Cannot reset agents while game is RUNNING."}, status=400)
            if game.status == Game.Status.FINISHED:
                return Response({"detail": "Cannot reset agents after game is FINISHED."}, status=400)

            updated = game.tickets.update(
                player_name=None,
                player_phone=None,
                status=Ticket.Status.AVAILABLE,
                booked_at=None,
            )

            _clear_claim_progress(game)

        return Response({"detail": "Agent assignments reset.", "updated_tickets": updated})


class AdminStartGameView(APIView):
    """
    Admin-only endpoint to start a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            calling_interval = request.data.get("calling_interval")
            if calling_interval is None:
                return Response({"detail": "calling_interval is required."}, status=400)

            try:
                calling_interval = int(calling_interval)
            except (TypeError, ValueError):
                return Response({"detail": "calling_interval must be an integer (seconds)."}, status=400)

            if calling_interval <= 0:
                return Response({"detail": "calling_interval must be greater than 0."}, status=400)

            if game.status != Game.Status.CREATED:
                return Response(
                    {"detail": "Game can only be started from CREATED status."},
                    status=400,
                )

            if not Prize.objects.filter(game=game, enabled=True).exists():
                return Response(
                    {"detail": "Please configure at least one prize before starting the game."},
                    status=400,
                )

            game.status = Game.Status.RUNNING
            game.calling_interval = calling_interval
            game.save(update_fields=["status", "calling_interval"])

        auto_call_numbers.delay(game.id)
        channel_layer = get_channel_layer()
        try:
            async_to_sync(channel_layer.group_send)(
                f"game_{str(game.id)}",
                {
                    "type": "game_started",
                    "message": "GAME_STARTED",
                    "calling_interval": game.calling_interval,
                },
            )
        except Exception as exc:
            logger.warning("Group broadcast failed (game_started): %s", exc)
        broadcast_game_voice_event(
            game_id=game.id,
            event="game_start",
            voice_key=GAME_START_VOICE_KEY,
            voice_text=GAME_START_VOICE_TEXT,
        )
        _broadcast_game_update(
            game,
            {
                "status": game.status,
                "calling_interval": game.calling_interval,
            },
        )
        return Response({"detail": "Game started."})


class AdminPauseGameView(APIView):
    """
    Admin-only endpoint to pause a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status != Game.Status.RUNNING:
                return Response(
                    {"detail": "Game can only be paused from RUNNING status."},
                    status=400,
                )

            game.status = Game.Status.PAUSED
            game.save(update_fields=["status"])

        _broadcast_game_update(
            game,
            {
                "status": game.status,
            },
        )
        return Response({"detail": "Game paused."})


class AdminResumeGameView(APIView):
    """
    Admin-only endpoint to resume a paused game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        with transaction.atomic():
            game = get_object_or_404(Game.objects.select_for_update(), id=game_id)

            if game.status != Game.Status.PAUSED:
                return Response(
                    {"detail": "Game can only be resumed from PAUSED status."},
                    status=400,
                )

            if not Prize.objects.filter(game=game, enabled=True).exists():
                return Response(
                    {"detail": "Please configure at least one prize before resuming the game."},
                    status=400,
                )

            game.status = Game.Status.RUNNING
            game.save(update_fields=["status"])

        auto_call_numbers.delay(game.id)
        _broadcast_game_update(
            game,
            {
                "status": game.status,
                "calling_interval": game.calling_interval,
            },
        )
        return Response({"detail": "Game resumed."})


class AdminGameThemeView(APIView):
    """
    Admin-only endpoint to set the active theme for a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)
        active_theme = str(request.data.get("active_theme", "")).strip()
        if active_theme not in {choice[0] for choice in Game.Theme.choices}:
            return Response({"detail": "Invalid active_theme."}, status=400)

        game.active_theme = active_theme
        game.save(update_fields=["active_theme"])

        return Response({"active_theme": game.active_theme})


class AdminCallNextNumberView(APIView):
    """
    Admin-only endpoint to call the next random number for a game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        if game.status != Game.Status.RUNNING:
            return Response(
                {"detail": "Numbers can only be called while the game is RUNNING."},
                status=400,
            )

        winner_hold_remaining = get_winner_announcement_hold_remaining(game_id=game.id)
        if winner_hold_remaining > 0:
            return Response(
                {
                    "detail": "Winner announcement is in progress. Number calling is temporarily paused.",
                    "retry_after_seconds": max(1, math.ceil(winner_hold_remaining)),
                },
                status=409,
            )

        try:
            number = call_next_number(game)
        except (ValueError, RuntimeError) as exc:
            _mark_game_finished_if_numbers_exhausted(game)
            return Response({"detail": str(exc)}, status=400)

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "number_called",
                "number": number,
                "called_numbers": called_numbers,
            },
        )

        leaderboard_data = build_live_leaderboard(game, called_numbers)
        async_to_sync(channel_layer.group_send)(
            f"game_{str(game.id)}",
            {
                "type": "leaderboard_update",
                "data": leaderboard_data,
            },
        )

        # Auto-detect winners after each call (server-authoritative).
        evaluate_claims_for_game(game)

        _mark_game_finished_if_numbers_exhausted(game)

        return Response({"number": number})


class AdminGameAnnouncementView(APIView):
    """
    Admin-only endpoint to broadcast announcements to all connected players.
    This communication layer is independent of game lifecycle/calling logic.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)
        serializer = AnnouncementCreateSerializer(data=request.data)
        if not serializer.is_valid():
            first_error_key = next(iter(serializer.errors), None)
            first_error = serializer.errors.get(first_error_key, ["Invalid payload."])[0]
            return Response({"detail": str(first_error)}, status=400)

        message = serializer.validated_data.get("message", "")
        audio_clip = serializer.validated_data.get("audio_clip")

        audio_file = ""
        audio_mime_type = ""
        if audio_clip is not None:
            try:
                audio_file, audio_mime_type = _save_announcement_audio(
                    game_id=game.id,
                    audio_clip=audio_clip,
                )
            except OSError:
                return Response({"detail": "Unable to store announcement audio."}, status=500)

        if not message and audio_file:
            message = "Voice announcement"

        announcement = Announcement.objects.create(
            game=game,
            message=message,
            audio_file=audio_file,
            audio_mime_type=audio_mime_type,
            created_by=request.user if request.user.is_authenticated else None,
            is_active=True,
        )

        audio_url = _announcement_audio_url(
            request=request,
            game_id=game.id,
            announcement_id=announcement.id,
            audio_file=announcement.audio_file,
        )
        payload = {
            "message": announcement.message,
            "timestamp": timezone.localtime(announcement.created_at).isoformat(),
            "game_id": str(game.id),
            "announcement_id": announcement.id,
            "audio_url": audio_url,
            "audio_mime_type": announcement.audio_mime_type or None,
        }

        channel_layer = get_channel_layer()
        try:
            async_to_sync(channel_layer.group_send)(
                f"game_{str(game.id)}",
                {
                    "type": "announcement_broadcast",
                    **payload,
                },
            )
        except Exception as exc:
            logger.warning("Group broadcast failed (announcement_broadcast): %s", exc)

        return Response(payload, status=201)


class GameAnnouncementAudioView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request, game_id, announcement_id):
        announcement = get_object_or_404(
            Announcement.objects.only("id", "game_id", "audio_file", "audio_mime_type", "is_active"),
            id=announcement_id,
            game_id=game_id,
            is_active=True,
        )

        audio_path = _resolve_announcement_audio_path(announcement.audio_file)
        if audio_path is None:
            return Response({"detail": "Announcement audio not found."}, status=404)

        content_type = str(announcement.audio_mime_type or "").strip() or "audio/mpeg"
        return FileResponse(audio_path.open("rb"), content_type=content_type)


class AdminGameListCreateView(APIView):
    """
    Admin-only endpoint to create and list games.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def get(self, request):
        games = Game.objects.all().order_by("-game_datetime", "id")
        return Response([_admin_game_payload(game) for game in games])

    def post(self, request):
        payload = request.data.copy()
        target_game_id = str(payload.get("game_id", "")).strip()
        if "game_id" in payload:
            payload.pop("game_id")
        if not payload.get("date") and payload.get("game_datetime"):
            payload["date"] = payload.get("game_datetime")

        serializer = AdminGameCreateSerializer(data=payload)
        if not serializer.is_valid():
            first_error_key = next(iter(serializer.errors), None)
            first_error = serializer.errors.get(first_error_key, ["Invalid payload."])[0]
            return Response({"detail": str(first_error)}, status=400)

        validated = serializer.validated_data
        name = validated["name"]
        game_datetime = validated["date"]
        ticket_price = validated["ticket_price"]
        total_tickets = validated["total_tickets"]
        calling_interval = validated.get("calling_interval")
        agent_commission = validated["agent_commission"]
        agent = validated.get("agent_id")
        booking_status = validated["booking_status"]
        website_status = validated["website_status"]
        active_theme = validated["active_theme"]
        generated_count = 0

        if target_game_id:
            with transaction.atomic():
                game = get_object_or_404(Game.objects.select_for_update(), id=target_game_id)
                changed_fields = {}
                update_fields = []

                if game.name != name:
                    game.name = name
                    update_fields.append("name")
                    changed_fields["name"] = game.name

                if game.game_datetime != game_datetime:
                    game.game_datetime = game_datetime
                    update_fields.append("game_datetime")
                    changed_fields["date"] = timezone.localtime(game.game_datetime).isoformat()

                if game.ticket_price != ticket_price:
                    game.ticket_price = ticket_price
                    update_fields.append("ticket_price")
                    changed_fields["ticket_price"] = game.ticket_price

                if game.total_ticket_limit != total_tickets:
                    game.total_ticket_limit = total_tickets
                    update_fields.append("total_ticket_limit")
                    changed_fields["total_tickets"] = game.total_ticket_limit

                if calling_interval is not None and game.calling_interval != calling_interval:
                    game.calling_interval = calling_interval
                    update_fields.append("calling_interval")
                    changed_fields["calling_interval"] = game.calling_interval

                if game.agent_commission != agent_commission:
                    game.agent_commission = agent_commission
                    update_fields.append("agent_commission")
                    changed_fields["agent_commission"] = game.agent_commission

                if game.booking_status != booking_status:
                    game.booking_status = booking_status
                    update_fields.append("booking_status")
                    changed_fields["booking_status"] = game.booking_status

                if game.website_status != website_status:
                    game.website_status = website_status
                    update_fields.append("website_status")
                    changed_fields["website_status"] = game.website_status

                next_agent_id = agent.id if agent else None
                if game.agent_id != next_agent_id:
                    game.agent = agent
                    update_fields.append("agent")
                    changed_fields["agent"] = _agent_payload(game.agent)

                if update_fields:
                    game.save(update_fields=update_fields)
                _sync_latest_game_settings(game)

            game_payload = _admin_game_payload(game)
            if changed_fields:
                channel_layer = get_channel_layer()
                try:
                    async_to_sync(channel_layer.group_send)(
                        f"game_{str(game.id)}",
                        {
                            "type": "game_update",
                            "data": {
                                "game_id": str(game.id),
                                "changed_fields": changed_fields,
                            },
                        },
                    )
                except Exception as exc:
                    logger.warning("Group broadcast failed (game_update): %s", str(exc))

            return Response(game_payload)

        with transaction.atomic():
            Game.objects.filter(is_active=True).update(is_active=False)
            Game.objects.filter(is_current=True).update(is_current=False)

            game = Game.objects.create(
                name=name,
                status=Game.Status.CREATED,
                booking_status=booking_status,
                website_status=website_status,
                game_datetime=game_datetime,
                ticket_price=ticket_price,
                agent_commission=agent_commission,
                agent=agent,
                total_ticket_limit=total_tickets,
                calling_interval=calling_interval if calling_interval is not None else 10,
                active_theme=active_theme,
                is_active=True,
                is_current=True,
                created_by=request.user,
            )
            _sync_latest_game_settings(game)

            # Pre-generate all tickets immediately on game setup (avoid lazy generation).
            if not Ticket.objects.filter(game=game).exists():
                tickets = []
                for ticket_number in range(1, total_tickets + 1):
                    ticket_data = generate_housie_ticket()
                    tickets.append(
                        Ticket(
                            game=game,
                            ticket_number=ticket_number,
                            ticket_type=Ticket.TicketType.RANDOM,
                            ticket_data=ticket_data,
                            status=Ticket.Status.AVAILABLE,
                        )
                    )
                Ticket.objects.bulk_create(tickets)
                generated_count = len(tickets)

        game_payload = _admin_game_payload(game)
        channel_layer = get_channel_layer()
        try:
            async_to_sync(channel_layer.group_send)(
                "global_lobby",
                {
                    "type": "new_game_created",
                    "game_id": str(game.id),
                    "name": game.name,
                    "active_theme": game.active_theme,
                    "data": game_payload,
                },
            )
        except Exception as exc:
            logger.warning("Group broadcast failed (new_game_created): %s", str(exc))

        if generated_count > 0:
            try:
                group_name = f"game_{str(game.id)}"
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {
                        "type": "tickets_generated",
                        "data": {
                            "game_id": str(game.id),
                            "total_generated": generated_count,
                        },
                    },
                )
            except Exception as exc:
                logger.warning("Group broadcast failed (tickets_generated): %s", str(exc))

        return Response(game_payload, status=201)


class AdminRecreateGameView(APIView):
    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def post(self, request, game_id):
        serializer = GameRecreateSerializer(data=request.data)
        if not serializer.is_valid():
            first_error_key = next(iter(serializer.errors), None)
            first_error = serializer.errors.get(first_error_key, ["Invalid payload."])[0]
            return Response({"detail": str(first_error)}, status=400)

        reason = serializer.validated_data["reason"]
        updated_fields = serializer.validated_data.get("updated_fields", {})

        with transaction.atomic():
            original_game = get_object_or_404(
                Game.objects.select_for_update().select_related("agent"),
                id=game_id,
            )

            # Prevent concurrent "current game" conflicts during recreation.
            Game.objects.select_for_update().filter(is_current=True)

            has_ticket_bookings = (
                Ticket.objects.select_for_update()
                .filter(game=original_game)
                .exclude(status=Ticket.Status.AVAILABLE)
                .exists()
            )

            is_created = original_game.status == Game.Status.CREATED
            is_active_like = original_game.status in ACTIVE_STATUS_VALUES
            if not is_created and not is_active_like:
                return Response(
                    {"detail": "Game can only be recreated from CREATED or ACTIVE status."},
                    status=400,
                )

            if is_active_like and has_ticket_bookings:
                return Response(
                    {"detail": "Cannot recreate an active game with existing bookings."},
                    status=400,
                )

            date_input = (
                updated_fields.get("date")
                if "date" in updated_fields
                else updated_fields.get("game_datetime", original_game.game_datetime)
            )
            total_tickets_input = (
                updated_fields.get("total_tickets")
                if "total_tickets" in updated_fields
                else updated_fields.get("total_ticket_limit", original_game.total_ticket_limit)
            )
            config_payload = {
                "name": updated_fields.get("name", original_game.name),
                "date": date_input,
                "ticket_price": updated_fields.get("ticket_price", original_game.ticket_price),
                "total_tickets": total_tickets_input,
                "calling_interval": updated_fields.get("calling_interval", original_game.calling_interval),
                "agent_commission": updated_fields.get("agent_commission", original_game.agent_commission),
                "agent_id": updated_fields.get("agent_id", original_game.agent_id),
                "booking_status": updated_fields.get("booking_status", original_game.booking_status),
                "website_status": updated_fields.get("website_status", original_game.website_status),
                "active_theme": updated_fields.get("active_theme", original_game.active_theme),
            }
            config_serializer = AdminGameCreateSerializer(data=config_payload)
            if not config_serializer.is_valid():
                first_error_key = next(iter(config_serializer.errors), None)
                first_error = config_serializer.errors.get(first_error_key, ["Invalid updated_fields."])[0]
                return Response({"detail": str(first_error)}, status=400)
            config = config_serializer.validated_data

            status_value = str(updated_fields.get("status", Game.Status.CREATED)).strip().upper()
            if status_value not in {Game.Status.CREATED, Game.Status.ACTIVE}:
                return Response({"detail": "Recreated game status must be CREATED or ACTIVE."}, status=400)

            now = timezone.now()
            original_game.is_current = False
            original_game.is_active = False
            original_game.status = Game.Status.CANCELLED
            original_game.recreated_at = now
            original_game.recreated_by = request.user
            original_game.reason = reason
            original_game.save(
                update_fields=[
                    "is_current",
                    "is_active",
                    "status",
                    "recreated_at",
                    "recreated_by",
                    "reason",
                ]
            )

            Game.objects.filter(is_current=True).exclude(id=original_game.id).update(
                is_current=False,
                is_active=False,
            )

            new_game = Game.objects.create(
                name=config["name"],
                status=status_value,
                game_datetime=config["date"],
                ticket_price=config["ticket_price"],
                agent_commission=config["agent_commission"],
                total_ticket_limit=config["total_tickets"],
                booking_status=config["booking_status"],
                website_status=config["website_status"],
                active_theme=config["active_theme"],
                calling_interval=config.get("calling_interval") or original_game.calling_interval or 10,
                agent=config.get("agent_id"),
                created_by=request.user,
                is_active=True,
                is_current=True,
                version=int(original_game.version) + 1,
                recreated_from=original_game,
                recreated_at=now,
                recreated_by=request.user,
                reason=reason,
            )
            _sync_latest_game_settings(new_game)

            source_prizes = list(
                Prize.objects.filter(game=original_game).values("prize_type", "amount", "enabled")
            )
            if source_prizes:
                Prize.objects.bulk_create(
                    [
                        Prize(
                            game=new_game,
                            prize_type=entry["prize_type"],
                            amount=entry["amount"],
                            enabled=bool(entry["enabled"]),
                        )
                        for entry in source_prizes
                    ]
                )

            tickets = []
            for ticket_number in range(1, int(new_game.total_ticket_limit) + 1):
                tickets.append(
                    Ticket(
                        game=new_game,
                        ticket_number=ticket_number,
                        ticket_type=Ticket.TicketType.RANDOM,
                        ticket_data=generate_housie_ticket(),
                        status=Ticket.Status.AVAILABLE,
                    )
                )
            Ticket.objects.bulk_create(tickets)

        _broadcast_game_recreated(
            original_game=original_game,
            new_game=new_game,
            reason=reason,
        )
        return Response(_admin_game_payload(new_game), status=201)


class CurrentAdminGameView(APIView):
    """
    Admin-only endpoint to fetch the single active game.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def get(self, request):
        game = _get_current_game()
        if game is None:
            return Response({"detail": "No active game found."}, status=404)
        return Response(_admin_game_payload(game))


class AdminAgentListView(APIView):
    """
    Admin-only endpoint to list active agents for game assignment.
    """

    permission_classes = [IsAdminRole]
    authentication_classes = [SessionAuthentication]

    def _broadcast_agent_update(self, agent):
        changed_fields = {"agent": _agent_payload(agent)}
        channel_layer = get_channel_layer()
        target_games = Game.objects.filter(agent=agent, is_current=True).only("id")
        for game in target_games:
            try:
                async_to_sync(channel_layer.group_send)(
                    f"game_{str(game.id)}",
                    {
                        "type": "game_update",
                        "data": {
                            "game_id": str(game.id),
                            "changed_fields": changed_fields,
                        },
                    },
                )
            except Exception as exc:
                logger.warning("Group broadcast failed (agent_update): %s", str(exc))

    def get(self, request):
        agents = Agent.objects.filter(is_active=True).order_by("name", "id")
        return Response(
            [
                {
                    "id": agent.id,
                    "name": agent.name,
                    "whatsapp_number": agent.whatsapp_number,
                }
                for agent in agents
            ]
        )

    def post(self, request):
        name = str(request.data.get("name", "")).strip()
        whatsapp_number = str(request.data.get("whatsapp_number", "")).strip()

        if not name:
            return Response({"detail": "Agent name is required."}, status=400)
        if not whatsapp_number:
            return Response({"detail": "WhatsApp number is required."}, status=400)

        agent = Agent(name=name, whatsapp_number=whatsapp_number, is_active=True)
        try:
            agent.full_clean()
        except DjangoValidationError as exc:
            message = "; ".join(str(item) for values in exc.message_dict.values() for item in values)
            return Response({"detail": message or "Invalid agent details."}, status=400)

        agent.save()
        return Response(
            {
                "id": agent.id,
                "name": agent.name,
                "whatsapp_number": agent.whatsapp_number,
            },
            status=201,
        )

    def put(self, request):
        raw_agent_id = request.data.get("id")
        if raw_agent_id in (None, ""):
            return Response({"detail": "Agent id is required."}, status=400)

        try:
            agent_id = int(raw_agent_id)
        except (TypeError, ValueError):
            return Response({"detail": "Agent id must be an integer."}, status=400)

        agent = get_object_or_404(Agent, id=agent_id, is_active=True)

        next_name = str(request.data.get("name", agent.name)).strip()
        next_whatsapp_number = str(request.data.get("whatsapp_number", agent.whatsapp_number)).strip()
        if not next_name:
            return Response({"detail": "Agent name is required."}, status=400)
        if not next_whatsapp_number:
            return Response({"detail": "WhatsApp number is required."}, status=400)

        previous_name = agent.name
        previous_whatsapp_number = agent.whatsapp_number
        agent.name = next_name
        agent.whatsapp_number = next_whatsapp_number
        try:
            agent.full_clean()
        except DjangoValidationError as exc:
            message = "; ".join(str(item) for values in exc.message_dict.values() for item in values)
            return Response({"detail": message or "Invalid agent details."}, status=400)

        update_fields = []
        if previous_name != agent.name:
            update_fields.append("name")
        if previous_whatsapp_number != agent.whatsapp_number:
            update_fields.append("whatsapp_number")
        if update_fields:
            agent.save(update_fields=update_fields)
            self._broadcast_agent_update(agent)

        return Response(
            {
                "id": agent.id,
                "name": agent.name,
                "whatsapp_number": agent.whatsapp_number,
            }
        )


class AgentPublicSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    name = serializers.CharField(read_only=True)
    whatsapp_number = serializers.CharField(read_only=True)


class PublicGameSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    name = serializers.CharField(read_only=True)
    date = serializers.DateTimeField(source="game_datetime", read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_price = serializers.IntegerField(read_only=True)
    booking_status = serializers.CharField(read_only=True)
    website_status = serializers.CharField(read_only=True)
    agent = AgentPublicSerializer(read_only=True, allow_null=True)
    active_theme = serializers.CharField(read_only=True)
    is_active = serializers.BooleanField(read_only=True)


class PublicGameListView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        games = Game.objects.filter(
            is_current=True,
            website_status=Game.WebsiteStatus.OPEN,
        ).order_by("game_datetime", "id")
        serializer = PublicGameSerializer(games, many=True)
        return Response(serializer.data)


class LatestPublicGameView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        # Backward-compatible alias that now returns the active game.
        game = _get_current_game()
        if game is None:
            return Response(None)
        serializer = PublicGameSerializer(game)
        return Response(serializer.data)


class CurrentPublicGameView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        game = _get_current_game()
        if game is None:
            return Response(None)
        serializer = PublicGameSerializer(game)
        return Response(serializer.data)


class GameMetaView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        game = _get_current_game_queryset().select_related("agent").first()
        if game is None:
            payload = {
                "game_name": "Tambola Game",
                "ticket_price": 0,
                "is_live": False,
                "agent_name": "",
                "agent_whatsapp": "",
                "payment_mode": "Manual via WhatsApp",
                "how_to_play": DEFAULT_HOW_TO_PLAY,
                "prize_patterns": [],
                "prize_pattern_details": [],
            }
            serializer = GameMetaSerializer(payload)
            return Response(serializer.data)

        game_settings = GameSettings.objects.order_by("-id").first()
        agent_name = ""
        if game.agent is not None:
            agent_name = str(game.agent.name or "").strip()

        agent_whatsapp = ""
        if game_settings is not None:
            agent_whatsapp = _normalize_whatsapp(game_settings.agent_whatsapp_number)
        if not agent_whatsapp and game.agent is not None:
            agent_whatsapp = _normalize_whatsapp(game.agent.whatsapp_number)

        # Always prefer the active game's own name.
        # Use GameSettings only as a fallback when game name is missing.
        game_name = str(game.name or "").strip()
        if not game_name and game_settings is not None:
            configured_name = str(game_settings.game_name or "").strip()
            if configured_name:
                game_name = configured_name
        if not game_name:
            game_name = "Tambola Game"

        payload = {
            "game_name": game_name,
            "ticket_price": int(game.ticket_price),
            "is_live": game.status == Game.Status.RUNNING,
            "agent_name": agent_name,
            "agent_whatsapp": agent_whatsapp,
            "payment_mode": "Manual via WhatsApp",
            "how_to_play": DEFAULT_HOW_TO_PLAY,
            "prize_patterns": _prize_patterns_for_game(game),
            "prize_pattern_details": _prize_pattern_details_for_game(game),
        }
        serializer = GameMetaSerializer(payload)
        return Response(serializer.data)


class PublicSupportSettingsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response(
            {
                "support": {
                    "name": getattr(settings, "SUPPORT_WHATSAPP_NAME", "Support"),
                    "whatsapp_number": getattr(settings, "SUPPORT_WHATSAPP_NUMBER", ""),
                }
            }
        )


class GameStateView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        calling_status = "ON" if game.status == Game.Status.RUNNING else "OFF"

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        winners = (
            Winner.objects.filter(game=game)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )
        won_prizes = []
        for winner in winners:
            won_prizes.append(
                {
                    "prize_type": winner.prize.prize_type,
                    "ticket_number": winner.ticket.ticket_number,
                    "player_name": winner.ticket.player_name,
                }
            )

        return Response(
            {
                "game": {
                    "id": str(game.id),
                    "name": game.name,
                    "status": game.status,
                    "calling_status": calling_status,
                    "calling_interval": game.calling_interval,
                    "booking_status": game.booking_status,
                    "website_status": game.website_status,
                    "agent": _agent_payload(game.agent),
                },
                "called_numbers": called_numbers,
                "won_prizes": won_prizes,
            }
        )


class GameTicketsView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [AllowAny]

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        tickets = Ticket.objects.filter(game=game)
        status_filter = request.query_params.get("status")
        if status_filter:
            status_value = str(status_filter).upper()
            valid_statuses = {choice[0] for choice in Ticket.Status.choices}
            if status_value not in valid_statuses:
                return Response({"detail": "Invalid status filter."}, status=400)
            tickets = tickets.filter(status=status_value)

        tickets = tickets.order_by("ticket_number")
        viewer_phone = request.query_params.get("player_phone")
        serializer_context = _ticket_snapshot_context(game, viewer_phone=viewer_phone)

        if is_admin_user(request.user):
            serializer = PlayerTicketSerializer(
                tickets,
                many=True,
                context=serializer_context,
            )
        else:
            serializer = PublicTicketSerializer(
                tickets,
                many=True,
                context=serializer_context,
            )

        return Response(
            {
                "game": {
                    "id": str(game.id),
                    "name": game.name,
                    "status": game.status,
                },
                "final_immutable": game.status == Game.Status.FINISHED,
                "called_numbers": serializer_context["called_numbers"],
                "tickets": serializer.data,
            }
        )


class GameBusinessSummaryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)

        tickets_qs = game.tickets.all()
        # Total ticket capacity comes from configured game settings.
        total_tickets = game.total_ticket_limit
        tickets_booked = tickets_qs.filter(status=Ticket.Status.CONFIRMED).count()
        fullsheet_booked = tickets_qs.filter(
            ticket_type="FULL_SHEET",
            status=Ticket.Status.CONFIRMED,
        ).count()
        halfsheet_booked = tickets_qs.filter(
            ticket_type="HALF_SHEET",
            status=Ticket.Status.CONFIRMED,
        ).count()
        tickets_left = max(0, total_tickets - tickets_booked)

        total_prize_money = sum(p.amount for p in game.prizes.all())
        total_revenue = tickets_booked * game.ticket_price
        total_profit = total_revenue - total_prize_money

        return Response(
            {
                "total_tickets": total_tickets,
                "tickets_booked": tickets_booked,
                "fullsheet_booked": fullsheet_booked,
                "halfsheet_booked": halfsheet_booked,
                "tickets_left": tickets_left,
                "total_prize_money": total_prize_money,
                "total_revenue": total_revenue,
                "total_profit": total_profit,
                "agent_commission": game.agent_commission,
                "website_status": game.website_status,
            }
        )


class GameSummaryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, game_id):
        game = get_object_or_404(Game, id=game_id)
        game_payload = {
            "id": str(game.id),
            "name": game.name,
            "status": game.status,
            "calling_interval": game.calling_interval,
            "booking_status": game.booking_status,
            "website_status": game.website_status,
            "agent": _agent_payload(game.agent),
            "active_theme": game.active_theme,
            "total_tickets": game.total_ticket_limit,
            "ticket_price": game.ticket_price,
            "agent_commission": game.agent_commission,
        }

        prizes = Prize.objects.filter(game=game).order_by("prize_type", "id")
        prizes_payload = [
            {
                "prize_type": prize.prize_type,
                "amount": prize.amount,
                "enabled": prize.enabled,
                "claimed": prize.is_claimed,
            }
            for prize in prizes
        ]

        winners = (
            Winner.objects.filter(game=game)
            .select_related("prize", "ticket")
            .order_by("created_at", "id")
        )
        winners_payload = WinnerSerializer(winners, many=True).data

        called_numbers = list(game.called_numbers.values_list("number", flat=True))

        return Response(
            {
                "game": game_payload,
                "prizes": prizes_payload,
                "winners": winners_payload,
                "called_numbers": called_numbers,
            }
        )
