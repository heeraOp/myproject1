import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import RegexValidator
from django.db import models, transaction


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
    audio_file = models.CharField(max_length=500, blank=True, default="")
    audio_mime_type = models.CharField(max_length=120, blank=True, default="")
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


class LobbyAnnouncement(models.Model):
    lobby = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="lobby_announcements")
    title = models.CharField(max_length=255)
    content = models.TextField()
    version = models.PositiveIntegerField(default=1)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=["lobby"],
                condition=models.Q(is_active=True),
                name="games_single_active_lobby_announcement_per_lobby",
            ),
        ]
        indexes = [
            models.Index(fields=["lobby", "is_active"], name="games_lob_ann_scope_idx"),
        ]

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        reset_acceptance = False

        if self.pk:
            previous = (
                LobbyAnnouncement.objects
                .filter(pk=self.pk)
                .only("title", "content", "version")
                .first()
            )
            if previous is not None:
                content_changed = previous.title != self.title or previous.content != self.content
                if content_changed:
                    self.version = max(int(previous.version or 0) + 1, 1)
                    reset_acceptance = True
                elif not self.version:
                    self.version = max(int(previous.version or 0), 1)
        elif not self.version:
            self.version = 1

        if update_fields is not None:
            next_fields = set(update_fields)
            if "title" in next_fields or "content" in next_fields:
                next_fields.add("version")
            kwargs["update_fields"] = tuple(next_fields)

        with transaction.atomic():
            if self.is_active and self.lobby_id:
                (
                    LobbyAnnouncement.objects
                    .select_for_update()
                    .filter(lobby_id=self.lobby_id, is_active=True)
                    .exclude(pk=self.pk)
                    .update(is_active=False)
                )

            super().save(*args, **kwargs)

            if reset_acceptance:
                self.acceptances.all().delete()

    def __str__(self) -> str:
        return f"{self.lobby_id} announcement v{self.version}"


class LobbyAnnouncementAcceptance(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="lobby_announcement_acceptances",
    )
    lobby = models.ForeignKey(
        Game,
        on_delete=models.CASCADE,
        related_name="lobby_announcement_acceptances",
    )
    announcement = models.ForeignKey(
        LobbyAnnouncement,
        on_delete=models.CASCADE,
        related_name="acceptances",
    )
    accepted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-accepted_at", "-id")
        constraints = [
            models.UniqueConstraint(
                fields=["user", "lobby", "announcement"],
                name="games_lobby_announcement_acceptance_unique",
            ),
        ]
        indexes = [
            models.Index(fields=["user", "lobby"], name="games_lob_acc_usr_lob_idx"),
            models.Index(fields=["lobby", "announcement"], name="games_lob_acc_lob_ann_idx"),
        ]

    def clean(self):
        if (
            self.announcement_id is not None
            and self.lobby_id is not None
            and self.announcement.lobby_id != self.lobby_id
        ):
            raise ValidationError("announcement does not belong to the given lobby.")

    def __str__(self) -> str:
        return f"{self.user_id} accepted {self.announcement_id} for lobby {self.lobby_id}"
