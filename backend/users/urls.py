from django.urls import path

from .views import CsrfTokenView, CurrentUserView, LoginView, LogoutView, RegistrationView

urlpatterns = [
    path("csrf/", CsrfTokenView.as_view(), name="csrf-token"),
    path("me/", CurrentUserView.as_view(), name="current-user"),
    path("login/", LoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("register/", RegistrationView.as_view(), name="register"),
]
