import json

from channels.generic.websocket import AsyncWebsocketConsumer


class GameConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.game_id = str(self.scope["url_route"]["kwargs"]["game_id"])
        self.group_name = f"game_{self.game_id}"
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
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

    async def game_finished(self, event):
        await self.send(
            text_data=json.dumps(
                {
                    "type": "game.finished",
                }
            )
        )

    async def ticket_booked(self, event):
        """
        Ticket booking updates (no personal data). Clients can refetch tickets safely.
        """
        await self.send(
            text_data=json.dumps(
                {
                    "type": "ticket.booked",
                    "ticket_numbers": event.get("ticket_numbers", []),
                }
            )
        )
