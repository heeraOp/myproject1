from rest_framework import serializers


class AnnouncementCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_message(self, value):
        message = value.strip()
        if not message:
            raise serializers.ValidationError("message is required.")
        return message


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
