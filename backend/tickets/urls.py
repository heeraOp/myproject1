from django.urls import path

from .views import AdminBulkTicketGenerateView, AdminTicketBookingView

urlpatterns = [
    path("admin/book/", AdminTicketBookingView.as_view(), name="admin-ticket-book"),
    path("admin/generate/", AdminBulkTicketGenerateView.as_view(), name="admin-ticket-generate"),
]
