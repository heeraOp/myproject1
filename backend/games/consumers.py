import json

from channels.generic.websocket import AsyncWebsocketConsumer


class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.game_id = str(self.scope["url_route"]["kwargs"]["game_id"])
        self.group_name = f"game_{self.game_id}"
        self.global_group_name = "global_lobby"
        print("Consumer CONNECTED")
        print("Joining group:", self.global_group_name)
        print("Joining group:", self.group_name)
        await self.channel_layer.group_add(self.global_group_name, self.channel_name)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(self.global_group_name, self.channel_name)
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def number_called(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "number.called",
                    "number": event["number"],
                    "called_numbers": event["called_numbers"],
                }
            )
        )

    async def game_started(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game.started",
                    "message": event.get("message"),
                    "calling_interval": event.get("calling_interval"),
                }
            )
        )

    async def winner_announced(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "winner.announced",
                    "winner": event.get("winner"),
                }
            )
        )

    async def winner_broadcast(self, event):
        print("Consumer received winner event:", event)
        await self.send(
            text_data=json.dumps(
                {
                    "type": "winner",
                    "winner_id": event["winner_id"],
                    "ticket_id": event["ticket_id"],
                    "prize_id": event["prize_id"],
                    "prize_name": event["prize_name"],
                    "winner_name": event["winner_name"],
                    "timestamp": event["timestamp"],
                }
            )
        )

    async def game_finished(self, event):
        payload = {
            "type": "game.finished",
        }
        status = event.get("status")
        if isinstance(status, str) and status:
            payload["status"] = status
        await self.send(
            text_data=json.dumps(
                payload
            )
        )

    async def ticket_booked(self, event):
        print("Consumer received ticket_booked event:", event)
        payload = event.get("data", {})
        await self.send(
            text_data=json.dumps(
                {
                    "type": "ticket_booked",
                    "data": payload,
                }
            )
        )

    async def tickets_generated(self, event):
        print("Consumer received tickets_generated event:", event)
        payload = event.get("data", {})
        await self.send(
            text_data=json.dumps(
                {
                    "type": "tickets_generated",
                    "data": payload,
                }
            )
        )

    async def new_game_created(self, event):
        print("Consumer received new_game_created event:", event)
        payload = event.get("data", {})
        await self.send(
            text_data=json.dumps(
                {
                    "type": "new_game_created",
                    "game_id": event.get("game_id") or payload.get("id"),
                    "name": event.get("name") or payload.get("name"),
                    "active_theme": event.get("active_theme") or payload.get("active_theme"),
                    "data": payload,
                }
            )
        )

    async def game_update(self, event):
        payload = event.get("data", {})
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game_update",
                    "data": payload,
                }
            )
        )

    async def leaderboard_update(self, event):
        payload = event.get("data", [])
        await self.send(
            text_data=json.dumps(
                {
                    "type": "LEADERBOARD_UPDATE",
                    "data": payload,
                }
            )
        )

    async def winner_announcement(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "WINNER_ANNOUNCEMENT",
                    "winner_name": event.get("winner_name", ""),
                    "prize_type": event.get("prize_type", ""),
                }
            )
        )

    async def announcement_broadcast(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "announcement",
                    "message": event.get("message"),
                    "timestamp": event.get("timestamp"),
                    "game_id": event.get("game_id"),
                    "announcement_id": event.get("announcement_id"),
                }
            )
        )
