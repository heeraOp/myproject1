from rest_framework import serializers


class AnnouncementCreateSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_message(self, value):
        message = value.strip()
        if not message:
            raise serializers.ValidationError("message is required.")
        return message
