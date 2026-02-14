from django.urls import path

from .views import PrizeDetailUpdateView, PrizeListUpdateView, PrizeTypeListView

urlpatterns = [
    path("types/", PrizeTypeListView.as_view(), name="prize-types"),
    path("game/<uuid:game_id>/", PrizeListUpdateView.as_view(), name="game-prizes"),
    path(
        "game/<uuid:game_id>/<str:prize_type>/",
        PrizeDetailUpdateView.as_view(),
        name="game-prize-update",
    ),
]
