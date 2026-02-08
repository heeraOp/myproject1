import random
import time
import uuid

import redis
from asgiref.sync import async_to_sync
from celery import shared_task
from channels.layers import get_channel_layer

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
                    game.status = Game.Status.FINISHED
                    game.save(update_fields=["status"])
                    return
                except ValueError:
                    return
                called_numbers = list(game.called_numbers.values_list("number", flat=True))
            else:
                called_list = list(called_attr or [])
                called_set = set(called_list)
                if len(called_set) >= 90:
                    game.status = Game.Status.FINISHED
                    game.save(update_fields=["status"])
                    return

                remaining = [n for n in range(1, 91) if n not in called_set]
                if not remaining:
                    game.status = Game.Status.FINISHED
                    game.save(update_fields=["status"])
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

            interval = game.calling_interval or 1
            redis_client.set(lock_key, lock_value, ex=max(5, int(interval) * 2), xx=True)
            time.sleep(max(1, int(interval)))
    finally:
        current_value = redis_client.get(lock_key)
        if current_value and current_value.decode() == lock_value:
            redis_client.delete(lock_key)
