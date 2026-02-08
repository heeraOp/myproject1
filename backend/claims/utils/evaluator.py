from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction

from tickets.models import Ticket

from claims.models import Claim, Winner
from . import validators


def _normalize_prize_type(prize_type):
    """Normalize prize_type to a consistent uppercase token for mapping."""
    if prize_type is None:
        return ""
    text = str(prize_type).strip().upper()
    return text.replace(" ", "_").replace("-", "_")


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
    tickets = list(game.tickets.filter(status=Ticket.Status.BOOKED).order_by("ticket_number"))

    mapping = {
        "FIRST_HOUSE": validators.validate_full_house,
        "SECOND_HOUSE": validators.validate_full_house,
        "THIRD_HOUSE": validators.validate_full_house,
        "FULL_SHEET": validators.validate_full_house,
        "HALF_SHEET": validators.validate_half_sheet,
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
    channel_layer = get_channel_layer()

    # Use a transaction to keep prize claims consistent.
    with transaction.atomic():
        # Fetch all unclaimed prizes.
        prizes = list(game.prizes.filter(is_claimed=False))

        for prize in prizes:
            winning_ticket = check_prize_condition(prize.prize_type, game)
            if winning_ticket is None:
                continue

            if Winner.objects.filter(game=game, prize__prize_type=prize.prize_type).exists():
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
                continue

            prize.is_claimed = True
            prize.save(update_fields=["is_claimed"])
            Claim.objects.create(game=game, prize=prize, ticket=winning_ticket)

            winner_payload = {
                "prize": prize.prize_type,
                "user_id": winner.user_id,
                "username": winner.username,
                "ticket_id": str(winning_ticket.id),
            }

            async_to_sync(channel_layer.group_send)(
                f"game_{str(game.id)}",
                {
                    "type": "winner_announced",
                    "winner": winner_payload,
                },
            )

            if _normalize_prize_type(prize.prize_type) in ("FULL_HOUSE", "FULL_SHEET"):
                game.status = game.Status.FINISHED
                game.save(update_fields=["status"])
                async_to_sync(channel_layer.group_send)(
                    f"game_{str(game.id)}",
                    {
                        "type": "game_finished",
                    },
                )

            newly_claimed.append(prize)

    return newly_claimed
