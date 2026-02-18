from django.urls import path

from .views import (
    AdminConfirmBookingView,
    AdminRejectBookingView,
    AdminReleaseTicketView,
    AdminUpdateTicketView,
)


urlpatterns = [
    path("<uuid:ticket_id>/confirm/", AdminConfirmBookingView.as_view(), name="admin-ticket-confirm"),
    path("<uuid:ticket_id>/reject/", AdminRejectBookingView.as_view(), name="admin-ticket-reject"),
    path("<uuid:ticket_id>/update/", AdminUpdateTicketView.as_view(), name="admin-ticket-update"),
    path("<uuid:ticket_id>/release/", AdminReleaseTicketView.as_view(), name="admin-ticket-release"),
]
