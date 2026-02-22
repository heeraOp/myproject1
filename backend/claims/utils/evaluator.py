from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from tickets.models import Ticket
from games.services.voice_events import broadcast_winner_prize_voice_event
from games.services.winner_pause import set_winner_announcement_hold

from claims.models import Claim, Winner
from claims.serializers import WinnerSerializer
from . import validators


_OWNER_PLACEHOLDERS = {"", "-", "--", "na", "n/a", "none", "null", "unsold"}
_SHEET_BONUS_PRIORITY = {
    "HALF_SHEET": 0,
    "FULL_SHEET": 1,
}


def _normalize_prize_type(prize_type):
    """Normalize prize_type to a consistent uppercase token for mapping."""
    if prize_type is None:
        return ""
    text = str(prize_type).strip().upper()
    normalized = text.replace(" ", "_").replace("-", "_")
    if normalized == "HALF_SHEET_BONUS":
        return "HALF_SHEET"
    if normalized == "FULL_SHEET_BONUS":
        return "FULL_SHEET"
    return normalized


def _normalize_owner_value(value):
    text = str(value or "").strip().lower()
    if text in _OWNER_PLACEHOLDERS:
        return ""
    return " ".join(text.split())


def _ticket_owner_key(ticket):
    name = _normalize_owner_value(ticket.player_name)
    if name:
        return ("name", name)
    return None


def _ticket_has_marked_number(ticket_data, called_numbers):
    rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
    if not isinstance(rows, list):
        return False
    for row in rows:
        if not isinstance(row, list):
            continue
        for number in row:
            if number is not None and number in called_numbers:
                return True
    return False


def _sheet_bonus_winning_ticket(prize_key, game, called_numbers):
    required_ticket_count = 3 if prize_key == "HALF_SHEET" else 6
    tickets = list(
        Ticket.objects.filter(game_id=game.id, status=Ticket.Status.CONFIRMED)
        .only("id", "game_id", "ticket_number", "ticket_data", "player_name", "player_phone")
        .order_by("ticket_number")
    )

    owner_groups = {}
    for ticket in tickets:
        owner_key = _ticket_owner_key(ticket)
        if owner_key is None:
            continue
        owner_groups.setdefault(owner_key, []).append(ticket)

    qualifying_winners = []
    for owner_tickets in owner_groups.values():
        if len(owner_tickets) < required_ticket_count:
            continue
        if not all(_ticket_has_marked_number(ticket.ticket_data, called_numbers) for ticket in owner_tickets):
            continue
        qualifying_winners.append(min(owner_tickets, key=lambda item: item.ticket_number))

    if not qualifying_winners:
        return None
    return min(qualifying_winners, key=lambda item: item.ticket_number)


def _sheet_bonus_ticket_is_eligible(prize_key, game, called_numbers, ticket):
    owner_key = _ticket_owner_key(ticket)
    if owner_key is None:
        return False

    required_ticket_count = 3 if prize_key == "HALF_SHEET" else 6
    tickets = list(
        Ticket.objects.filter(game_id=game.id, status=Ticket.Status.CONFIRMED)
        .only("ticket_number", "ticket_data", "player_name", "player_phone")
        .order_by("ticket_number")
    )
    owner_tickets = [item for item in tickets if _ticket_owner_key(item) == owner_key]
    if len(owner_tickets) < required_ticket_count:
        return False
    return all(_ticket_has_marked_number(item.ticket_data, called_numbers) for item in owner_tickets)


def _claim_order_key(prize):
    prize_key = _normalize_prize_type(prize.prize_type)
    return (_SHEET_BONUS_PRIORITY.get(prize_key, 2), prize.id)


def _has_pending_half_sheet_bonus(prizes, claimed_prize_keys):
    if "HALF_SHEET" in claimed_prize_keys:
        return False

    for prize in prizes:
        if prize.is_claimed:
            continue
        if _normalize_prize_type(prize.prize_type) == "HALF_SHEET":
            return True
    return False


def _row_numbers(row):
    return [n for n in row if n is not None]


def _validate_specific_line(ticket_data, called_numbers, row_index):
    rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
    if not isinstance(rows, list) or len(rows) <= row_index:
        return False
    row = rows[row_index]
    if not isinstance(row, list):
        return False
    numbers = _row_numbers(row)
    return bool(numbers) and all(n in called_numbers for n in numbers)


def _validate_quick_n(ticket_data, called_numbers, n):
    rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
    if not isinstance(rows, list):
        return False
    count = 0
    for row in rows:
        if not isinstance(row, list):
            continue
        for number in row:
            if number is not None and number in called_numbers:
                count += 1
                if count >= n:
                    return True
    return False


def check_prize_condition(prize_type, game):
    """
    Check if any ticket satisfies the prize condition.
    Returns the winning ticket if found, otherwise None.
    """
    prize_key = _normalize_prize_type(prize_type)

    called_numbers = set(game.called_numbers.values_list("number", flat=True))
    tickets = list(
        Ticket.objects.filter(game_id=game.id, status=Ticket.Status.CONFIRMED).order_by("ticket_number")
    )

    if prize_key in ("HALF_SHEET", "FULL_SHEET"):
        return _sheet_bonus_winning_ticket(prize_key, game, called_numbers)

    mapping = {
        "FIRST_HOUSE": validators.validate_full_house,
        "SECOND_HOUSE": validators.validate_full_house,
        "THIRD_HOUSE": validators.validate_full_house,
        "TOP_LINE": lambda data, called: _validate_specific_line(data, called, 0),
        "MIDDLE_LINE": lambda data, called: _validate_specific_line(data, called, 1),
        "BOTTOM_LINE": lambda data, called: _validate_specific_line(data, called, 2),
        "BOX": validators.validate_box,
        "CORNER": validators.validate_corners,
        "STAR": validators.validate_star,
        "EARLY_5": validators.validate_early_5,
        "QUICK_6": lambda data, called: _validate_quick_n(data, called, 6),
        "QUICK_7": lambda data, called: _validate_quick_n(data, called, 7),
    }

    validator = mapping.get(prize_key)
    if validator is None:
        return None

    for ticket in tickets:
        if validator(ticket.ticket_data, called_numbers):
            return ticket

    return None


def evaluate_claims_for_game(game):
    """
    Evaluate all unclaimed prizes for a game using server-side validation.

    Returns:
        list of prizes that were newly claimed during this evaluation.
    """
    newly_claimed = []

    # Use a transaction + row locks to keep prize claims consistent under concurrency.
    with transaction.atomic():
        # Fetch and lock enabled prizes to keep ordering and dedupe decisions consistent.
        prizes = list(game.prizes.select_for_update().filter(enabled=True))
        unclaimed_prizes = sorted((prize for prize in prizes if not prize.is_claimed), key=_claim_order_key)
        claimed_prize_keys = {
            _normalize_prize_type(prize_type)
            for prize_type in Winner.objects.filter(game=game).values_list("prize__prize_type", flat=True)
        }

        for prize in unclaimed_prizes:
            prize_key = _normalize_prize_type(prize.prize_type)
            if prize_key in claimed_prize_keys:
                continue

            if prize_key == "FULL_SHEET" and _has_pending_half_sheet_bonus(prizes, claimed_prize_keys):
                continue

            winning_ticket = check_prize_condition(prize.prize_type, game)
            if winning_ticket is None:
                continue

            if prize_key in ("HALF_SHEET", "FULL_SHEET"):
                called_numbers = set(game.called_numbers.values_list("number", flat=True))
                if not _sheet_bonus_ticket_is_eligible(prize_key, game, called_numbers, winning_ticket):
                    continue

            winner, created = Winner.objects.get_or_create(
                game=game,
                prize=prize,
                defaults={
                    "ticket": winning_ticket,
                    "user_id": None,
                    "username": winning_ticket.player_name or "",
                },
            )
            if not created:
                claimed_prize_keys.add(prize_key)
                continue

            print("===== WINNER PIPELINE START =====")
            print("Game ID at validation:", game.id)
            print("Prize ID:", prize.id)
            print("Winner saved:", winner.id)
            print("Winner game:", winner.game.id)

            prize.is_claimed = True
            prize.save(update_fields=["is_claimed"])
            claim = Claim.objects.create(game=game, prize=prize, ticket=winning_ticket)
            print("Claim ID:", claim.id)
            claimed_prize_keys.add(prize_key)

            winner_payload = WinnerSerializer(winner).data
            set_winner_announcement_hold(game_id=game.id)

            try:
                channel_layer = get_channel_layer()
                group_name = f"game_{game.id}"
                print("Broadcast group:", group_name)
                async_to_sync(channel_layer.group_send)(
                    f"game_{str(game.id)}",
                    {
                        "type": "winner_announced",
                        "winner": winner_payload,
                    },
                )
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {
                        "type": "winner_broadcast",
                        "winner_id": str(winner.id),
                        "ticket_id": str(winner.ticket.id),
                        "prize_id": str(winner.prize.id),
                        "prize_name": getattr(winner.prize, "name", winner.prize.prize_type),
                        "winner_name": winner.username or winner.ticket.player_name or "",
                        "timestamp": timezone.now().isoformat(),
                    },
                )
                async_to_sync(channel_layer.group_send)(
                    group_name,
                    {
                        "type": "winner_announcement",
                        "winner_name": winner.username or winner.ticket.player_name or "Player",
                        "prize_type": winner.prize.prize_type,
                    },
                )
                broadcast_winner_prize_voice_event(
                    game_id=game.id,
                    prize_name=getattr(winner.prize, "name", ""),
                    prize_type=winner.prize.prize_type,
                )
                print("Winner broadcast SUCCESS")
            except Exception as e:
                print("Winner broadcast FAILED:", str(e))
            print("===== WINNER PIPELINE END =====")

            newly_claimed.append(prize)

    return newly_claimed
