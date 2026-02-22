from rest_framework import serializers

from .models import LobbyAnnouncement


class AnnouncementCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, trim_whitespace=True, required=False, allow_blank=True)
    audio_clip = serializers.FileField(required=False, allow_null=True)

    MAX_AUDIO_BYTES = 6 * 1024 * 1024
    _ALLOWED_AUDIO_EXTENSIONS = {".webm", ".ogg", ".mp3", ".wav", ".m4a", ".aac", ".mpeg"}

    def validate_audio_clip(self, value):
        if value is None:
            return None

        content_type = str(getattr(value, "content_type", "") or "").strip().lower()
        file_name = str(getattr(value, "name", "") or "").strip().lower()
        file_size = int(getattr(value, "size", 0) or 0)

        if file_size <= 0:
            raise serializers.ValidationError("audio_clip is empty.")
        if file_size > self.MAX_AUDIO_BYTES:
            raise serializers.ValidationError("audio_clip exceeds 6 MB.")

        has_audio_content_type = content_type.startswith("audio/")
        has_audio_extension = any(file_name.endswith(ext) for ext in self._ALLOWED_AUDIO_EXTENSIONS)
        if not has_audio_content_type and not has_audio_extension:
            raise serializers.ValidationError("audio_clip must be a valid audio file.")

        return value

    def validate(self, attrs):
        message = str(attrs.get("message", "") or "").strip()
        audio_clip = attrs.get("audio_clip")
        if not message and not audio_clip:
            raise serializers.ValidationError("Provide message text or an audio_clip.")
        attrs["message"] = message
        return attrs


class GameMetaSerializer(serializers.Serializer):
    game_name = serializers.CharField(read_only=True)
    ticket_price = serializers.IntegerField(read_only=True)
    is_live = serializers.BooleanField(read_only=True)
    agent_name = serializers.CharField(read_only=True)
    agent_whatsapp = serializers.CharField(read_only=True)
    payment_mode = serializers.CharField(read_only=True)
    how_to_play = serializers.CharField(read_only=True)
    prize_patterns = serializers.ListField(child=serializers.CharField(), read_only=True)
    prize_pattern_details = serializers.ListField(child=serializers.DictField(), read_only=True)


class GameRecreateSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)
    updated_fields = serializers.DictField(required=False, default=dict)

    _allowed_update_keys = {
        "name",
        "date",
        "game_datetime",
        "total_tickets",
        "total_ticket_limit",
        "ticket_price",
        "calling_interval",
        "agent_commission",
        "agent_id",
        "booking_status",
        "website_status",
        "active_theme",
        "status",
    }

    def validate_reason(self, value):
        reason = str(value or "").strip()
        if not reason:
            raise serializers.ValidationError("reason is required.")
        return reason

    def validate_updated_fields(self, value):
        if value is None:
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("updated_fields must be an object.")

        normalized = {}
        for raw_key, field_value in value.items():
            key = str(raw_key or "").strip()
            if key not in self._allowed_update_keys:
                raise serializers.ValidationError(f"Unsupported field in updated_fields: {key}")
            normalized[key] = field_value
        return normalized


class LobbyAnnouncementSerializer(serializers.ModelSerializer):
    is_accepted = serializers.BooleanField(read_only=True)

    class Meta:
        model = LobbyAnnouncement
        fields = ("id", "title", "content", "version", "is_accepted")
        read_only_fields = fields


class LobbyAnnouncementAcceptSerializer(serializers.Serializer):
    announcement_id = serializers.IntegerField(min_value=1)


class LobbyAnnouncementAdminSerializer(serializers.ModelSerializer):
    class Meta:
        model = LobbyAnnouncement
        fields = ("id", "lobby", "title", "content", "version", "is_active", "created_at", "updated_at")
        read_only_fields = ("id", "lobby", "version", "created_at", "updated_at")


class LobbyAnnouncementAdminUpsertSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, trim_whitespace=True)
    content = serializers.CharField(max_length=10000, trim_whitespace=True)
    is_active = serializers.BooleanField(required=False, default=True)

    def validate_title(self, value):
        normalized = str(value or "").strip()
        if not normalized:
            raise serializers.ValidationError("title is required.")
        return normalized

    def validate_content(self, value):
        normalized = str(value or "").strip()
        if not normalized:
            raise serializers.ValidationError("content is required.")
        return normalized
