from django.urls import path

from .views import (
    AdminBulkTicketGenerateView,
    AdminTicketBookingView,
    PublicLatestTicketListView,
    PublicTicketListView,
    PlayerTicketDetailView,
    PlayerTicketListView,
)

urlpatterns = [
    path("admin/book/", AdminTicketBookingView.as_view(), name="admin-ticket-book"),
    path("admin/generate/", AdminBulkTicketGenerateView.as_view(), name="admin-ticket-generate"),
    path("public/latest/", PublicLatestTicketListView.as_view(), name="public-ticket-latest"),
    path("game/<uuid:game_id>/public/", PublicTicketListView.as_view(), name="public-ticket-list"),
    path("game/<uuid:game_id>/", PlayerTicketListView.as_view(), name="player-ticket-list"),
    path(
        "game/<uuid:game_id>/<int:ticket_number>/",
        PlayerTicketDetailView.as_view(),
        name="player-ticket-detail",
    ),
]
