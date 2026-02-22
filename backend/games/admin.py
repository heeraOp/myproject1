from django.contrib import admin

from .models import (
    Agent,
    Announcement,
    CalledNumber,
    Game,
    GameSettings,
    LobbyAnnouncement,
    LobbyAnnouncementAcceptance,
)


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


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ("id", "game", "created_at", "is_active")
    list_filter = ("is_active", "created_at")
    search_fields = ("game__id", "game__name", "message")
    readonly_fields = ("created_at",)


@admin.register(LobbyAnnouncement)
class LobbyAnnouncementAdmin(admin.ModelAdmin):
    list_display = ("id", "lobby", "title", "version", "is_active", "updated_at")
    list_filter = ("is_active", "created_at", "updated_at")
    search_fields = ("title", "content", "lobby__id", "lobby__name")
    readonly_fields = ("version", "created_at", "updated_at")
    autocomplete_fields = ("lobby",)


@admin.register(LobbyAnnouncementAcceptance)
class LobbyAnnouncementAcceptanceAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "lobby", "announcement", "accepted_at")
    list_filter = ("accepted_at",)
    search_fields = (
        "user__username",
        "user__email",
        "lobby__id",
        "lobby__name",
        "announcement__title",
    )
    readonly_fields = ("accepted_at",)
    autocomplete_fields = ("user", "lobby", "announcement")
