from django.contrib import admin

from .models import Agent, CalledNumber, Game, GameSettings


@admin.register(Agent)
class AgentAdmin(admin.ModelAdmin):
    list_display = ("id", "name", "whatsapp_number", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "whatsapp_number")


@admin.register(Game)
class GameAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "status",
        "version",
        "is_current",
        "booking_status",
        "ticket_price",
        "total_ticket_limit",
        "agent",
        "is_active",
    )
    list_filter = ("status", "is_current", "booking_status", "is_active")
    search_fields = ("id", "name", "agent__name", "agent__whatsapp_number")


@admin.register(CalledNumber)
class CalledNumberAdmin(admin.ModelAdmin):
    list_display = ("game", "number", "called_at")


@admin.register(GameSettings)
class GameSettingsAdmin(admin.ModelAdmin):
    list_display = ("id", "game_name", "agent_whatsapp_number")
    search_fields = ("game_name", "agent_whatsapp_number")
