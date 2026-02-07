from django.contrib import admin

from .models import Ticket


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = ("ticket_number", "game", "ticket_type", "status", "player_name")
    list_filter = ("ticket_type", "status")
    search_fields = ("ticket_number", "player_name", "player_phone")
