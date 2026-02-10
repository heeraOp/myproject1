from django.urls import path
from .consumers import GameConsumer

websocket_urlpatterns = [
    # Primary websocket path used by frontend.
    path("ws/games/<uuid:game_id>/", GameConsumer.as_asgi()),
    # Compatibility path for setups that prefix "ws/" at ASGI router level.
    path("games/<uuid:game_id>/", GameConsumer.as_asgi()),
]
