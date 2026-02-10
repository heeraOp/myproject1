from django.urls import path

from .views import CsrfTokenView, LoginView, RegistrationView

urlpatterns = [
    path("csrf/", CsrfTokenView.as_view(), name="csrf-token"),
    path("login/", LoginView.as_view(), name="login"),
    path("register/", RegistrationView.as_view(), name="register"),
]
