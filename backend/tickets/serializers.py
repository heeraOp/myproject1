from rest_framework import serializers


class AdminTicketBookingSerializer(serializers.Serializer):
    game_id = serializers.UUIDField()
    ticket_number = serializers.IntegerField()
    player_name = serializers.CharField()
    player_phone = serializers.CharField()

    def validate(self, attrs):
        if not attrs.get("player_name") or not attrs.get("player_phone"):
            raise serializers.ValidationError("player_name and player_phone are required.")
        return attrs


class AdminBulkTicketGenerateSerializer(serializers.Serializer):
    game_id = serializers.UUIDField()
    total_tickets = serializers.IntegerField()

    def validate_total_tickets(self, value):
        if value < 1 or value > 1000:
            raise serializers.ValidationError("total_tickets must be between 1 and 1000.")
        return value


class PlayerTicketSerializer(serializers.Serializer):
    ticket_number = serializers.IntegerField(read_only=True)
    ticket_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_data = serializers.JSONField(read_only=True)
    player_name = serializers.CharField(read_only=True)
