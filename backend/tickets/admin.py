from django.contrib import admin

from .models import Booking, Ticket


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("ticket_number", "game", "ticket_type", "status", "player_name")
    list_filter = ("ticket_type", "status")
    search_fields = ("ticket_number", "player_name", "player_phone")


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("id", "player", "booking_type", "ticket_count", "payment_mode", "payment_status", "created_at")
    list_filter = ("booking_type", "payment_status")
    search_fields = ("player",)
