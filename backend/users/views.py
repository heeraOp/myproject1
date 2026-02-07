from django.contrib.auth import authenticate, login
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .serializers import UserRegistrationSerializer

class LoginView(APIView):
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


@method_decorator(csrf_exempt, name="dispatch")
class RegistrationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = UserRegistrationSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        user = serializer.save()
        return Response({"username": user.username, "role": user.role})
