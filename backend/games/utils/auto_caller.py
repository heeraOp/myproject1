import threading
import time

from django.db import transaction

from games.models import Game
from games.utils.calling import call_next_number


def _auto_call_loop(game_id):
    """
    Background loop that calls numbers while the game is RUNNING.
    Exits cleanly when the game is PAUSED or FINISHED.
    """
    while True:
        game = Game.objects.filter(id=game_id).first()
        if game is None:
            return

        if game.status != Game.Status.RUNNING:
            return

        try:
            # Guard against concurrent auto-caller threads.
            with transaction.atomic():
                call_next_number(game)
        except RuntimeError:
            # All numbers exhausted; exit cleanly.
            return
        except ValueError:
            # Game no longer runnable; exit cleanly.
            return

        interval = game.calling_interval or 1
        time.sleep(max(1, int(interval)))


def start_auto_calling(game_id):
    """
    Start automatic number calling in the background.
    This function must not block the HTTP request thread.
    """
    thread = threading.Thread(target=_auto_call_loop, args=(game_id,), daemon=True)
    thread.start()
