from rest_framework import serializers


def _ticket_numbers_in_order(ticket_data):
    rows = ticket_data.get("rows") if isinstance(ticket_data, dict) else []
    if not isinstance(rows, list):
        return []

    numbers = []
    for row in rows:
        if not isinstance(row, list):
            continue
        for value in row:
            if isinstance(value, int):
                numbers.append(value)
    return numbers


def _called_numbers_set(context):
    numbers = context.get("called_numbers")
    if isinstance(numbers, list):
        return {value for value in numbers if isinstance(value, int)}

    numbers_set = context.get("called_numbers_set")
    if isinstance(numbers_set, set):
        return {value for value in numbers_set if isinstance(value, int)}

    return set()


class AdminTicketBookingSerializer(serializers.Serializer):
    # Allow missing game_id for legacy/admin clients; view will resolve active game.
    game_id = serializers.UUIDField(required=False, allow_null=True)
    ticket_number = serializers.IntegerField(required=False, allow_null=True)
    ticket_numbers = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )
    booking_mode = serializers.ChoiceField(
        choices=["RANDOM", "HALF_SHEET", "FULL_SHEET"],
        required=False,
        default="RANDOM",
    )
    player_name = serializers.CharField()
    player_phone = serializers.CharField()

    def validate(self, attrs):
        if not attrs.get("player_name") or not attrs.get("player_phone"):
            raise serializers.ValidationError("player_name and player_phone are required.")

        booking_mode = attrs.get("booking_mode", "RANDOM")
        ticket_number = attrs.get("ticket_number")
        ticket_numbers = attrs.get("ticket_numbers")

        if booking_mode == "RANDOM" and ticket_number is None and not ticket_numbers:
            raise serializers.ValidationError(
                "ticket_number (or ticket_numbers) is required for RANDOM booking."
            )

        if booking_mode == "HALF_SHEET" and ticket_numbers and len(ticket_numbers) != 3:
            raise serializers.ValidationError("HALF_SHEET booking requires exactly 3 ticket_numbers.")

        if booking_mode == "FULL_SHEET" and ticket_numbers and len(ticket_numbers) != 6:
            raise serializers.ValidationError("FULL_SHEET booking requires exactly 6 ticket_numbers.")
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
    # Include assigned contact for admin ticket views.
    player_phone = serializers.CharField(read_only=True)
    marked_numbers = serializers.SerializerMethodField()
    final_immutable = serializers.SerializerMethodField()

    def get_marked_numbers(self, obj):
        called_set = _called_numbers_set(self.context)
        if not called_set:
            return []

        return [value for value in _ticket_numbers_in_order(obj.ticket_data) if value in called_set]

    def get_final_immutable(self, obj):
        if "final_immutable" in self.context:
            return bool(self.context.get("final_immutable"))
        return getattr(obj.game, "status", "") == "FINISHED"


class PublicTicketSerializer(serializers.Serializer):
    ticket_number = serializers.IntegerField(read_only=True)
    ticket_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_data = serializers.JSONField(read_only=True)
    player_name = serializers.SerializerMethodField()
    marked_numbers = serializers.SerializerMethodField()
    final_immutable = serializers.SerializerMethodField()

    def get_marked_numbers(self, obj):
        called_set = _called_numbers_set(self.context)
        if not called_set:
            return []

        return [value for value in _ticket_numbers_in_order(obj.ticket_data) if value in called_set]

    def get_final_immutable(self, obj):
        if "final_immutable" in self.context:
            return bool(self.context.get("final_immutable"))
        return getattr(obj.game, "status", "") == "FINISHED"

    def get_player_name(self, obj):
        """
        Only reveal ownership for the requesting player (by phone).
        Never expose other players' personal data.
        """
        # Only expose player name for booked tickets to avoid leaking data on OPEN tickets.
        if getattr(obj, "status", "") != "BOOKED":
            return None
        viewer_phone = (self.context.get("viewer_phone") or "").strip()
        if viewer_phone and obj.player_phone and obj.player_phone.strip() == viewer_phone:
            return "You"
        return None
