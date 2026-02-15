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


class Game(models.Model):
    class Status(models.TextChoices):
        CREATED = "CREATED", "Created"
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
    calling_interval = models.PositiveIntegerField(default=10)
    agent = models.ForeignKey(Agent, null=True, blank=True, on_delete=models.SET_NULL, related_name="games")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["is_active"],
                condition=models.Q(is_active=True),
                name="unique_active_game",
            )
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
