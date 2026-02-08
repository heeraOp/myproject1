from rest_framework import serializers


class WinnerSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    prize_type = serializers.CharField(source="prize.prize_type", read_only=True)
    prize_amount = serializers.IntegerField(source="prize.amount", read_only=True)
    ticket_number = serializers.IntegerField(source="ticket.ticket_number", read_only=True)
    player_name = serializers.CharField(source="ticket.player_name", read_only=True, allow_null=True)
    won_at = serializers.DateTimeField(source="created_at", read_only=True)
