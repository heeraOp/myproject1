from django.contrib import admin

from .models import VoiceAsset


@admin.register(VoiceAsset)
class VoiceAssetAdmin(admin.ModelAdmin):
    list_display = ("id", "key", "hash", "created_at")
    search_fields = ("key", "hash", "text")
    readonly_fields = ("created_at",)
