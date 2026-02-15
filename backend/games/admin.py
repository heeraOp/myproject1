from django.contrib import admin

from .models import Agent, CalledNumber, Game


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "whatsapp_number", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "whatsapp_number")


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "status", "booking_status", "ticket_price", "total_ticket_limit", "agent", "is_active")
    list_filter = ("status", "booking_status", "is_active")
    search_fields = ("id", "name", "agent__name", "agent__whatsapp_number")


@admin.register(CalledNumber)
class CalledNumberAdmin(admin.ModelAdmin):
    list_display = ("game", "number", "called_at")
