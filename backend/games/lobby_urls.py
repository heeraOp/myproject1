from django.urls import path

from .lobby_announcement_views import LobbyAnnouncementAcceptView, LobbyAnnouncementView

urlpatterns = [
    path("<uuid:lobby_id>/announcement/", LobbyAnnouncementView.as_view(), name="lobby-announcement"),
    path(
        "<uuid:lobby_id>/announcement/accept/",
        LobbyAnnouncementAcceptView.as_view(),
        name="lobby-announcement-accept",
    ),
]
