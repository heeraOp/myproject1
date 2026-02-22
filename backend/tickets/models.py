import uuid

from django.db import models

from games.models import Game


class Ticket(models.Model):
    class TicketType(models.TextChoices):
        RANDOM = "RANDOM", "Random"
        HALF_SHEET = "HALF_SHEET", "Half Sheet"
        FULL_SHEET = "FULL_SHEET", "Full Sheet"

    class Status(models.TextChoices):
        AVAILABLE = "AVAILABLE", "Available"
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="tickets")
    ticket_number = models.PositiveIntegerField()
    ticket_type = models.CharField(max_length=20, choices=TicketType.choices)
    ticket_data = models.JSONField()
    player_name = models.CharField(max_length=100, null=True, blank=True)
    player_phone = models.CharField(max_length=20, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    requested_by_name = models.CharField(max_length=120, null=True, blank=True)
    requested_by_whatsapp = models.CharField(max_length=20, null=True, blank=True)
    requested_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    booked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["game", "ticket_number"], name="unique_ticket_number_per_game"),
        ]

    def __str__(self) -> str:
        return f"{self.game_id} - {self.ticket_number}"


class Booking(models.Model):
    class BookingType(models.TextChoices):
        RANDOM = "random", "Random"
        HALF_SHEET = "halfsheet", "Half Sheet"
        FULL_SHEET = "fullsheet", "Full Sheet"

    class PaymentStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        CONFIRMED = "CONFIRMED", "Confirmed"
        REJECTED = "REJECTED", "Rejected"

    player = models.CharField(max_length=120)
    booking_type = models.CharField(max_length=20, choices=BookingType.choices)
    ticket_numbers = models.JSONField(default=list)
    ticket_count = models.PositiveIntegerField()
    payment_mode = models.CharField(max_length=120)
    payment_status = models.CharField(
        max_length=20,
        choices=PaymentStatus.choices,
        default=PaymentStatus.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return f"{self.player} - {self.booking_type} ({self.ticket_count})"
