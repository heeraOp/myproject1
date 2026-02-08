from django.db import models

from games.models import Game
from tickets.models import Ticket


class Prize(models.Model):
    class PrizeType(models.TextChoices):
        FIRST_HOUSE = "FIRST_HOUSE", "First House"
        SECOND_HOUSE = "SECOND_HOUSE", "Second House"
        THIRD_HOUSE = "THIRD_HOUSE", "Third House"
        FULL_SHEET = "FULL_SHEET", "Full Sheet"
        HALF_SHEET = "HALF_SHEET", "Half Sheet"
        TOP_LINE = "TOP_LINE", "Top Line"
        MIDDLE_LINE = "MIDDLE_LINE", "Middle Line"
        BOTTOM_LINE = "BOTTOM_LINE", "Bottom Line"
        BOX = "BOX", "Box"
        CORNER = "CORNER", "Corner"
        STAR = "STAR", "Star"
        EARLY_5 = "EARLY_5", "Early 5"
        QUICK_6 = "QUICK_6", "Quick 6"
        QUICK_7 = "QUICK_7", "Quick 7"

    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="prizes")
    prize_type = models.CharField(max_length=20, choices=PrizeType.choices)
    amount = models.PositiveIntegerField()
    is_claimed = models.BooleanField(default=False)

    def __str__(self) -> str:
        return f"{self.game_id} - {self.prize_type}"


class Claim(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="claims")
    prize = models.ForeignKey(Prize, on_delete=models.CASCADE, related_name="claims")
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="claims")
    claimed_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.game_id} - {self.prize_id} - {self.ticket_id}"


class Winner(models.Model):
    game = models.ForeignKey(Game, on_delete=models.CASCADE, related_name="winners")
    prize = models.OneToOneField(Prize, on_delete=models.CASCADE, related_name="winner")
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="wins")
    user_id = models.CharField(max_length=36, null=True, blank=True)
    username = models.CharField(max_length=100, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.game_id} - {self.prize_id} - {self.ticket_id}"
