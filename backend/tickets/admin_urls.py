from django.urls import path

from .views import AdminConfirmBookingView, AdminRejectBookingView


urlpatterns = [
    path("<uuid:ticket_id>/confirm/", AdminConfirmBookingView.as_view(), name="admin-ticket-confirm"),
    path("<uuid:ticket_id>/reject/", AdminRejectBookingView.as_view(), name="admin-ticket-reject"),
]
