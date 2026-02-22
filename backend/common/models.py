from django.db import models


class VoiceAsset(models.Model):
    key = models.CharField(max_length=120, unique=True, db_index=True)
    text = models.TextField()
    audio_file = models.FileField(upload_to="voice_assets/")
    hash = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["hash"], name="common_voice_asset_hash_unique"),
        ]
        indexes = [
            models.Index(fields=["key"], name="common_voice_asset_key_idx"),
        ]
        ordering = ("-created_at", "id")

    def __str__(self) -> str:
        return f"{self.key} ({self.hash[:12]})"
