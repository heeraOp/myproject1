from collections import defaultdict

from tickets.models import Ticket


def _ticket_numbers(ticket_data):
    if not isinstance(ticket_data, dict):
        return []
    rows = ticket_data.get("rows")
    if not isinstance(rows, list):
        return []

    values = []
    for row in rows:
        if not isinstance(row, list):
            continue
        for cell in row:
            if isinstance(cell, int):
                values.append(cell)
    return values


def build_live_leaderboard(game, called_numbers):
    called_set = set(called_numbers or [])

    grouped = defaultdict(
        lambda: {
            "user_id": "",
            "username": "Player",
            "total_marked": 0,
            "total_slots": 0,
            "tickets_with_mark": 0,
        }
    )

    tickets = (
        Ticket.objects.filter(game=game, status=Ticket.Status.CONFIRMED)
        .only("id", "player_name", "player_phone", "ticket_data")
        .order_by("id")
    )

    for ticket in tickets:
        player_name = (ticket.player_name or "").strip() or "Player"
        player_phone = (ticket.player_phone or "").strip()
        user_id = player_phone or f"ticket:{ticket.id}"

        stat = grouped[user_id]
        stat["user_id"] = user_id
        stat["username"] = player_name

        numbers = _ticket_numbers(ticket.ticket_data)
        if not numbers:
            continue

        marked_count = sum(1 for value in numbers if value in called_set)
        stat["total_marked"] += marked_count
        stat["total_slots"] += len(numbers)
        if marked_count > 0:
            stat["tickets_with_mark"] += 1

    leaderboard = []
    for stat in grouped.values():
        remaining_for_full_house = max(0, stat["total_slots"] - stat["total_marked"])
        remaining_for_half_seat = max(0, 3 - stat["tickets_with_mark"])
        leaderboard.append(
            {
                "user_id": stat["user_id"],
                "username": stat["username"],
                "total_marked": stat["total_marked"],
                "remaining_for_full_house": remaining_for_full_house,
                "remaining_for_half_seat": remaining_for_half_seat,
            }
        )

    leaderboard.sort(
        key=lambda row: (
            -row["total_marked"],
            row["remaining_for_full_house"],
            row["remaining_for_half_seat"],
            row["username"].lower(),
        )
    )

    return leaderboard[:5]
