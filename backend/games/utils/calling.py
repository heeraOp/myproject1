import random

from django.db import transaction

from games.models import CalledNumber, Game


def call_next_number(game):
    """
    Randomly call the next number (1-90) for a running game.

    Returns:
        int: the newly called number.

    Raises:
        ValueError: if the game is not in RUNNING state.
        RuntimeError: if all numbers have already been called.
    """
    if game.status != Game.Status.RUNNING:
        raise ValueError("Cannot call numbers unless the game is RUNNING.")

    # Use a transaction to avoid race conditions in concurrent calls.
    with transaction.atomic():
        called = set(game.called_numbers.values_list("number", flat=True))

        remaining = [n for n in range(1, 91) if n not in called]
        if not remaining:
            raise RuntimeError("All numbers have been called.")

        next_number = random.choice(remaining)

        # Persist the newly called number.
        CalledNumber.objects.create(game=game, number=next_number)

    return next_number
