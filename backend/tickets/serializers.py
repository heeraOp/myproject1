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
