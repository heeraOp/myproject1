from django.urls import path

from .views import PrizeListUpdateView

urlpatterns = [
    path("game/<uuid:game_id>/", PrizeListUpdateView.as_view(), name="game-prizes"),
]
