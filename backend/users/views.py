from django.contrib.auth import authenticate, login, logout
from django.middleware.csrf import get_token
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import NotAuthenticated
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import UserRegistrationSerializer


def _is_admin_user(user):
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "role", None) == "ADMIN":
        return True
    return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))

class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        username = request.data.get("username")
        password = request.data.get("password")

        if not username or not password:
            return Response({"success": False, "detail": "Username and password required"}, status=400)

        user = authenticate(request, username=username, password=password)
        if user is None:
            return Response({"success": False, "detail": "Invalid credentials"}, status=400)

        login(request, user)
        return Response({"success": True})


class LogoutView(APIView):
    authentication_classes = [SessionAuthentication]

    def post(self, request):
        logout(request)
        return Response({"success": True})


class RegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        user = serializer.save()
        return Response({"username": user.username, "role": user.role})


class CurrentUserView(APIView):
    authentication_classes = [SessionAuthentication]

    def get(self, request):
        user = request.user
        if not user or not user.is_authenticated:
            raise NotAuthenticated("Authentication credentials were not provided.")

        return Response(
            {
                "id": user.id,
                "username": user.username,
                "role": getattr(user, "role", None),
                "is_staff": bool(getattr(user, "is_staff", False)),
                "is_superuser": bool(getattr(user, "is_superuser", False)),
                "is_admin": _is_admin_user(user),
                "authenticated": True,
            }
        )
