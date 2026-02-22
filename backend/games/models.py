import uuid

from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models


whatsapp_number_validator = RegexValidator(
    regex=r"^\+?[1-9]\d{7,14}$",
    message="Enter a valid WhatsApp number with country code (example: +919876543210).",
)


class Agent(models.Model):
    name = models.CharField(max_length=100)
    whatsapp_number = models.CharField(max_length=20, validators=[whatsapp_number_validator])
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ("name", "id")

    def __str__(self) -> str:
        return f"{self.name} ({self.whatsapp_number})"


class GameSettings(models.Model):
    game_name = models.CharField(max_length=255)
    agent_whatsapp_number = models.CharField(max_length=20, validators=[whatsapp_number_validator])

    class Meta:
        ordering = ("-id",)

    def __str__(self) -> str:
        return f"{self.game_name} ({self.agent_whatsapp_number})"


class Game(models.Model):
    class Status(models.TextChoices):
        CREATED = "CREATED", "Created"
        ACTIVE = "ACTIVE", "Active"
        COMPLETED = "COMPLETED", "Completed"
        CANCELLED = "CANCELLED", "Cancelled"
        # Legacy statuses retained for backward compatibility with existing flows.
        BOOKING_OPEN = "BOOKING_OPEN", "Booking Open"
        RUNNING = "RUNNING", "Running"
        PAUSED = "PAUSED", "Paused"
        FINISHED = "FINISHED", "Finished"

    class BookingStatus(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    class WebsiteStatus(models.TextChoices):
        OPEN = "OPEN", "Open"
        CLOSED = "CLOSED", "Closed"

    class Theme(models.TextChoices):
        DARK = "dark", "Dark"
        LIGHT = "light", "Light"
        FESTIVAL_GOLD = "festival-gold", "Festival Gold"
        FESTIVAL_DIWALI = "festival-diwali", "Festival Diwali"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices)
    game_datetime = models.DateTimeField()
    ticket_price = models.PositiveIntegerField()
    agent_commission = models.PositiveIntegerField(default=0)
    total_ticket_limit = models.PositiveIntegerField()
    booking_status = models.CharField(max_length=10, choices=BookingStatus.choices)
    website_status = models.CharField(max_length=10, choices=WebsiteStatus.choices, default=WebsiteStatus.OPEN)
    active_theme = models.CharField(max_length=20, choices=Theme.choices, default=Theme.DARK)
    is_active = models.BooleanField(default=False)
    version = models.PositiveIntegerField(default=1)
    is_current = models.BooleanField(default=True)
    calling_interval = models.PositiveIntegerField(default=10)
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.SET_NULL, related_name="games")
    recreated_from = models.ForeignKey(
        "self",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="recreated_versions",
    )

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    recreated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="recreated_games",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)
    recreated_at = models.DateTimeField(null=True, blank=True)
    reason = models.TextField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["is_active"],
                condition=models.Q(is_active=True),
                name="unique_active_game",
            ),
            models.UniqueConstraint(
                fields=["is_current"],
                condition=models.Q(
                    is_current=True,
                    status__in=["CREATED", "ACTIVE"],
                ),
                name="unique_current_created_or_active_game",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.id}) - {self.status}"


class CalledNumber(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="called_numbers")
    number = models.IntegerField()
    called_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "number"], name="unique_called_number_per_game"),
        ]

    def __str__(self) -> str:
        return f"{self.game_id} - {self.number}"


class Announcement(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="announcements")
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="game_announcements",
    )
    is_active = models.BooleanField(default=True)

    def __str__(self) -> str:
        return f"{self.game_id} announcement @ {self.created_at.isoformat()}"
