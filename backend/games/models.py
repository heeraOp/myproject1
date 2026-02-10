import uuid

from django.conf import settings
from django.db import models


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

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices)
    game_datetime = models.DateTimeField()
    ticket_price = models.PositiveIntegerField()
    agent_commission = models.PositiveIntegerField(default=0)
    total_ticket_limit = models.PositiveIntegerField()
    booking_status = models.CharField(max_length=10, choices=BookingStatus.choices)
    website_status = models.CharField(max_length=10, choices=WebsiteStatus.choices, default=WebsiteStatus.OPEN)
    calling_interval = models.PositiveIntegerField(default=10)

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)

    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    ended_at = models.DateTimeField(null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.id} - {self.status}"


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
