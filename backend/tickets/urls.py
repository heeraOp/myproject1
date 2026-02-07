from django.urls import path

from .views import AdminTicketBookingView

urlpatterns = [
    path("admin/book/", AdminTicketBookingView.as_view(), name="admin-ticket-book"),
]
