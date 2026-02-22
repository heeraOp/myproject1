from rest_framework import serializers

from .models import Ticket


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


def _parse_ticket_numbers_csv(raw_value):
    if raw_value is None:
        return []
    text = str(raw_value).strip()
    if not text:
        return []

    numbers = []
    seen = set()
    for chunk in text.split(","):
        token = chunk.strip()
        if not token:
            continue
        if not token.isdigit():
            raise serializers.ValidationError(
                "ticket_numbers_csv must contain only comma-separated positive integers."
            )
        number = int(token)
        if number < 1:
            raise serializers.ValidationError("Ticket numbers must be positive integers.")
        if number in seen:
            raise serializers.ValidationError("Duplicate ticket numbers are not allowed.")
        seen.add(number)
        numbers.append(number)
    return numbers


def _merge_ticket_numbers(ticket_number=None, ticket_numbers=None, ticket_numbers_csv=None):
    ordered = []
    seen = set()

    def append_number(value):
        if value is None:
            return
        number = int(value)
        if number in seen:
            raise serializers.ValidationError("Duplicate ticket numbers are not allowed.")
        seen.add(number)
        ordered.append(number)

    append_number(ticket_number)
    for value in ticket_numbers or []:
        append_number(value)
    for value in ticket_numbers_csv or []:
        append_number(value)
    return ordered


class AdminTicketBookingSerializer(serializers.Serializer):
    # Allow missing game_id for legacy/admin clients; view will resolve active game.
    game_id = serializers.UUIDField(required=False, allow_null=True)
    ticket_number = serializers.IntegerField(required=False, allow_null=True)
    ticket_numbers = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )
    ticket_numbers_csv = serializers.CharField(required=False, allow_blank=True)
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
        csv_numbers = _parse_ticket_numbers_csv(attrs.get("ticket_numbers_csv"))
        merged_ticket_numbers = _merge_ticket_numbers(
            ticket_number=ticket_number,
            ticket_numbers=ticket_numbers,
            ticket_numbers_csv=csv_numbers,
        )
        attrs["resolved_ticket_numbers"] = merged_ticket_numbers

        if not merged_ticket_numbers:
            raise serializers.ValidationError(
                "At least one ticket number is required (ticket_number, ticket_numbers, or ticket_numbers_csv)."
            )

        if booking_mode == "HALF_SHEET" and len(merged_ticket_numbers) != 3:
            raise serializers.ValidationError("HALF_SHEET booking requires exactly 3 ticket_numbers.")

        if booking_mode == "FULL_SHEET" and len(merged_ticket_numbers) != 6:
            raise serializers.ValidationError("FULL_SHEET booking requires exactly 6 ticket_numbers.")
        return attrs


class AdminTicketAssignmentSerializer(serializers.Serializer):
    player_name = serializers.CharField(max_length=120)
    player_phone = serializers.CharField(max_length=20)

    def validate_player_name(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("player_name is required.")
        return cleaned

    def validate_player_phone(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("player_phone is required.")
        return cleaned


class TicketRequestBookingSerializer(serializers.Serializer):
    player_name = serializers.CharField(max_length=120)
    whatsapp = serializers.CharField(max_length=20)
    payment_mode = serializers.CharField(max_length=120)

    def validate_player_name(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("player_name is required.")
        return cleaned

    def validate_whatsapp(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("whatsapp is required.")
        return cleaned

    def validate_payment_mode(self, value):
        cleaned = value.strip()
        if not cleaned:
            raise serializers.ValidationError("payment_mode is required.")
        return cleaned


class PlayerBulkTicketBookingSerializer(serializers.Serializer):
    game_id = serializers.UUIDField()
    ticket_number = serializers.IntegerField(required=False, allow_null=True)
    ticket_numbers = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        required=False,
        allow_empty=False,
    )
    ticket_numbers_csv = serializers.CharField(required=False, allow_blank=True)
    booking_type = serializers.ChoiceField(
        choices=["random", "halfsheet", "fullsheet"],
        required=False,
        default="random",
    )
    player_name = serializers.CharField(max_length=120)
    whatsapp = serializers.CharField(max_length=20)
    payment_mode = serializers.CharField(max_length=120)

    def validate(self, attrs):
        player_name = str(attrs.get("player_name") or "").strip()
        whatsapp = str(attrs.get("whatsapp") or "").strip()
        payment_mode = str(attrs.get("payment_mode") or "").strip()
        if not player_name or not whatsapp or not payment_mode:
            raise serializers.ValidationError("player_name, whatsapp, and payment_mode are required.")

        ticket_number = attrs.get("ticket_number")
        ticket_numbers = attrs.get("ticket_numbers")
        csv_numbers = _parse_ticket_numbers_csv(attrs.get("ticket_numbers_csv"))
        merged_ticket_numbers = _merge_ticket_numbers(
            ticket_number=ticket_number,
            ticket_numbers=ticket_numbers,
            ticket_numbers_csv=csv_numbers,
        )

        if not merged_ticket_numbers:
            raise serializers.ValidationError(
                "At least one ticket number is required (ticket_number, ticket_numbers, or ticket_numbers_csv)."
            )

        booking_type = attrs.get("booking_type", "random")
        if booking_type == "halfsheet" and len(merged_ticket_numbers) != 3:
            raise serializers.ValidationError("halfsheet booking requires exactly 3 ticket numbers.")
        if booking_type == "fullsheet" and len(merged_ticket_numbers) != 6:
            raise serializers.ValidationError("fullsheet booking requires exactly 6 ticket numbers.")

        attrs["player_name"] = player_name
        attrs["whatsapp"] = whatsapp
        attrs["payment_mode"] = payment_mode
        attrs["resolved_ticket_numbers"] = merged_ticket_numbers
        return attrs


class TicketBookingStatusSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    game_id = serializers.UUIDField(read_only=True)
    ticket_number = serializers.IntegerField(read_only=True)
    ticket_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    player_name = serializers.CharField(read_only=True)
    player_phone = serializers.CharField(read_only=True)
    booked_at = serializers.DateTimeField(read_only=True)
    requested_by_name = serializers.CharField(read_only=True)
    requested_by_whatsapp = serializers.CharField(read_only=True)
    requested_at = serializers.DateTimeField(read_only=True)


class AdminBulkTicketGenerateSerializer(serializers.Serializer):
    game_id = serializers.UUIDField()
    total_tickets = serializers.IntegerField()

    def validate_total_tickets(self, value):
        if value < 1 or value > 1000:
            raise serializers.ValidationError("total_tickets must be between 1 and 1000.")
        return value


class PlayerTicketSerializer(serializers.Serializer):
    id = serializers.UUIDField(read_only=True)
    game_id = serializers.UUIDField(read_only=True)
    ticket_number = serializers.IntegerField(read_only=True)
    ticket_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_data = serializers.JSONField(read_only=True)
    player_name = serializers.CharField(read_only=True)
    # Include assigned contact for admin ticket views.
    player_phone = serializers.CharField(read_only=True)
    requested_by_name = serializers.CharField(read_only=True)
    requested_by_whatsapp = serializers.CharField(read_only=True)
    requested_at = serializers.DateTimeField(read_only=True)
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
    id = serializers.UUIDField(read_only=True)
    game_id = serializers.UUIDField(read_only=True)
    ticket_number = serializers.IntegerField(read_only=True)
    ticket_type = serializers.CharField(read_only=True)
    status = serializers.CharField(read_only=True)
    ticket_data = serializers.JSONField(read_only=True)
    player_name = serializers.SerializerMethodField()
    requested_by_name = serializers.CharField(read_only=True)
    requested_by_whatsapp = serializers.CharField(read_only=True)
    requested_at = serializers.DateTimeField(read_only=True)
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
        # Only expose player name for confirmed tickets to avoid leaking data otherwise.
        if getattr(obj, "status", "") != Ticket.Status.CONFIRMED:
            return None
        viewer_phone = (self.context.get("viewer_phone") or "").strip()
        if viewer_phone and obj.player_phone and obj.player_phone.strip() == viewer_phone:
            return "You"
        return None
