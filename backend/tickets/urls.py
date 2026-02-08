from django.urls import path

from .views import (
    AdminBulkTicketGenerateView,
    AdminTicketBookingView,
    PlayerTicketDetailView,
    PlayerTicketListView,
)

urlpatterns = [
    path("admin/book/", AdminTicketBookingView.as_view(), name="admin-ticket-book"),
    path("admin/generate/", AdminBulkTicketGenerateView.as_view(), name="admin-ticket-generate"),
    path("game/<uuid:game_id>/", PlayerTicketListView.as_view(), name="player-ticket-list"),
    path(
        "game/<uuid:game_id>/<int:ticket_number>/",
        PlayerTicketDetailView.as_view(),
        name="player-ticket-detail",
    ),
]
