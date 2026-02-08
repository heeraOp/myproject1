from django.urls import path

from .views import (
    AdminCallNextNumberView,
    AdminPauseGameView,
    AdminResumeGameView,
    AdminStartGameView,
)

urlpatterns = [
    path("admin/<uuid:game_id>/start/", AdminStartGameView.as_view(), name="admin-game-start"),
    path("admin/<uuid:game_id>/pause/", AdminPauseGameView.as_view(), name="admin-game-pause"),
    path("admin/<uuid:game_id>/resume/", AdminResumeGameView.as_view(), name="admin-game-resume"),
    path("admin/<uuid:game_id>/call-next/", AdminCallNextNumberView.as_view(), name="admin-game-call-next"),
]
