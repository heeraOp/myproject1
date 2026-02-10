import random
import time
import uuid

import redis
from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from claims.utils.evaluator import evaluate_claims_for_game
from games.models import Game
from games.utils.calling import call_next_number


@shared_task
def auto_call_numbers(game_id):
    lock_value = str(uuid.uuid4())
    lock_key = f"game_auto_call:{game_id}"
    redis_client = redis.Redis(host="127.0.0.1", port=6379, db=0)

    if not redis_client.set(lock_key, lock_value, nx=True, ex=30):
        return

    channel_layer = get_channel_layer()

    def finish_game_if_needed() -> bool:
        """
        Canonical finish check.
        - Game already marked FINISHED (e.g. by claim evaluator)
        - All 90 numbers exhausted
        Returns True if game should stop.
        """
        transitioned_to_finished = False
        with transaction.atomic():
            current_game = Game.objects.select_for_update().filter(id=game_id).first()
            if current_game is None:
                return True

            if current_game.status == Game.Status.FINISHED:
                return True

            called_attr = getattr(current_game, "called_numbers", None)
            if hasattr(called_attr, "values_list"):
                called_count = called_attr.count()
            else:
                called_count = len(set(called_attr or []))

            if called_count >= 90:
                current_game.status = Game.Status.FINISHED
                current_game.ended_at = timezone.now()
                current_game.save(update_fields=["status", "ended_at"])
                transitioned_to_finished = True

        if transitioned_to_finished:
            async_to_sync(channel_layer.group_send)(
                f"game_{str(game_id)}",
                {
                    "type": "game_finished",
                },
            )
            return True

        return False

    try:
        while True:
            game = Game.objects.filter(id=game_id).first()
            if game is None:
                return

            if game.status != Game.Status.RUNNING:
                return

            called_attr = getattr(game, "called_numbers", None)
            number = None
            called_numbers = []

            if hasattr(called_attr, "values_list"):
                try:
                    number = call_next_number(game)
                except RuntimeError:
                    finish_game_if_needed()
                    return
                except ValueError:
                    return
                called_numbers = list(game.called_numbers.values_list("number", flat=True))
            else:
                called_list = list(called_attr or [])
                called_set = set(called_list)
                if len(called_set) >= 90:
                    finish_game_if_needed()
                    return

                remaining = [n for n in range(1, 91) if n not in called_set]
                if not remaining:
                    finish_game_if_needed()
                    return

                number = random.choice(remaining)
                called_list.append(number)
                game.called_numbers = called_list
                game.save(update_fields=["called_numbers"])
                called_numbers = called_list

            print(f"[auto_call_numbers] game={game_id} number={number}")

            async_to_sync(channel_layer.group_send)(
                f"game_{str(game.id)}",
                {
                    "type": "number_called",
                    "number": number,
                    "called_numbers": called_numbers,
                },
            )

            evaluate_claims_for_game(game)

            # Stop immediately once canonical finish conditions are met.
            if finish_game_if_needed():
                return

            interval = game.calling_interval or 1
            redis_client.set(lock_key, lock_value, ex=max(5, int(interval) * 2), xx=True)
            time.sleep(max(1, int(interval)))
    finally:
        current_value = redis_client.get(lock_key)
        if current_value and current_value.decode() == lock_value:
            redis_client.delete(lock_key)
