from rest_framework import serializers

from .models import User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "username", "email", "role")
        read_only_fields = ("id", "role")


class UserRegistrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("username", "password", "email", "role")
        extra_kwargs = {"password": {"write_only": True}}

    def create(self, validated_data):
        role = validated_data.get("role") or User.Role.ADMIN
        user = User(
            username=validated_data["username"],
            email=validated_data.get("email", ""),
            role=role,
        )
        user.set_password(validated_data["password"])
        user.save()
        return user
