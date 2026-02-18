from django.urls import path

from .views import VoiceCacheView

urlpatterns = [
    path("voice/", VoiceCacheView.as_view(), name="voice-cache"),
]
