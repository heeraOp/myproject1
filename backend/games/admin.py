from django.contrib import admin

from .models import CalledNumber, Game


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("id", "status", "booking_status", "ticket_price", "total_ticket_limit")
    list_filter = ("status", "booking_status")


@admin.register(CalledNumber)
class CalledNumberAdmin(admin.ModelAdmin):
    list_display = ("game", "number", "called_at")
