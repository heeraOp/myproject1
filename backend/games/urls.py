from django.urls import path

from .views import (
    AdminCallNextNumberView,
    AdminGameListCreateView,
    AdminPauseGameView,
    AdminResumeGameView,
    AdminStartGameView,
    GameBusinessSummaryView,
    GameStateView,
    GameSummaryView,
    PublicGameListView,
)

urlpatterns = [
    path("", AdminGameListCreateView.as_view(), name="admin-game-list-create"),
    path("public/", PublicGameListView.as_view(), name="public-game-list"),
    path("<uuid:game_id>/state/", GameStateView.as_view(), name="game-state"),
    path("<uuid:game_id>/summary/", GameSummaryView.as_view(), name="game-summary"),
    path("<uuid:game_id>/business-summary/", GameBusinessSummaryView.as_view(), name="game-business-summary"),
    path("admin/<uuid:game_id>/start/", AdminStartGameView.as_view(), name="admin-game-start"),
    path("admin/<uuid:game_id>/pause/", AdminPauseGameView.as_view(), name="admin-game-pause"),
    path("admin/<uuid:game_id>/resume/", AdminResumeGameView.as_view(), name="admin-game-resume"),
    path("admin/<uuid:game_id>/call-next/", AdminCallNextNumberView.as_view(), name="admin-game-call-next"),
]
