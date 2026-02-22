from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsAdminRole, is_admin_user
from games.models import Game, LobbyAnnouncement, LobbyAnnouncementAcceptance
from games.serializers import (
    LobbyAnnouncementAcceptSerializer,
    LobbyAnnouncementAdminSerializer,
    LobbyAnnouncementAdminUpsertSerializer,
    LobbyAnnouncementSerializer,
)


def _resolve_lobby_for_user(*, user, lobby_id):
    base_queryset = Game.objects.filter(id=lobby_id)
    if is_admin_user(user):
        return get_object_or_404(base_queryset)
    # Non-admin users are limited to current lobby links only.
    return get_object_or_404(base_queryset.filter(is_current=True))


class LobbyAnnouncementView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, lobby_id):
        lobby = _resolve_lobby_for_user(user=request.user, lobby_id=lobby_id)
        announcement = (
            LobbyAnnouncement.objects
            .filter(lobby=lobby, is_active=True)
            .order_by("-updated_at", "-id")
            .first()
        )
        if announcement is None:
            return Response(None, status=200)

        is_accepted = LobbyAnnouncementAcceptance.objects.filter(
            user=request.user,
            lobby=lobby,
            announcement=announcement,
        ).exists()

        payload = LobbyAnnouncementSerializer(
            announcement,
            context={"request": request},
        ).data
        payload["is_accepted"] = bool(is_accepted)
        return Response(payload, status=200)


class LobbyAnnouncementAcceptView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request, lobby_id):
        serializer = LobbyAnnouncementAcceptSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        lobby = _resolve_lobby_for_user(user=request.user, lobby_id=lobby_id)
        announcement_id = int(serializer.validated_data["announcement_id"])

        with transaction.atomic():
            active_announcement = (
                LobbyAnnouncement.objects
                .select_for_update()
                .filter(lobby=lobby, is_active=True)
                .order_by("-updated_at", "-id")
                .first()
            )
            if active_announcement is None:
                return Response({"detail": "No active announcement for this lobby."}, status=404)

            if active_announcement.id != announcement_id:
                return Response({"detail": "announcement_id is not active for this lobby."}, status=400)

            try:
                _, created = LobbyAnnouncementAcceptance.objects.get_or_create(
                    user=request.user,
                    lobby=lobby,
                    announcement=active_announcement,
                )
            except IntegrityError:
                created = False

        return Response(
            {
                "success": True,
                "announcement_id": active_announcement.id,
                "accepted": True,
                "already_accepted": not created,
            },
            status=200,
        )


class AdminLobbyAnnouncementManageView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAdminRole]

    def get(self, request, game_id):
        lobby = get_object_or_404(Game.objects.filter(id=game_id))
        announcement = (
            LobbyAnnouncement.objects
            .filter(lobby=lobby, is_active=True)
            .order_by("-updated_at", "-id")
            .first()
        )
        if announcement is None:
            return Response(None, status=200)
        payload = LobbyAnnouncementAdminSerializer(
            announcement,
            context={"request": request},
        ).data
        return Response(payload, status=200)

    def put(self, request, game_id):
        serializer = LobbyAnnouncementAdminUpsertSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        title = serializer.validated_data["title"]
        content = serializer.validated_data["content"]
        is_active = bool(serializer.validated_data.get("is_active", True))

        with transaction.atomic():
            lobby = get_object_or_404(Game.objects.select_for_update().filter(id=game_id))
            current = (
                LobbyAnnouncement.objects
                .select_for_update()
                .filter(lobby=lobby, is_active=True)
                .order_by("-updated_at", "-id")
                .first()
            )

            if not is_active:
                if current is None:
                    return Response({"detail": "No active announcement for this lobby."}, status=404)
                current.is_active = False
                current.save(update_fields=["is_active", "updated_at"])
                payload = LobbyAnnouncementAdminSerializer(current, context={"request": request}).data
                return Response(payload, status=200)

            if current is not None:
                current.title = title
                current.content = content
                current.is_active = True
                current.save()
                payload = LobbyAnnouncementAdminSerializer(current, context={"request": request}).data
                return Response(payload, status=200)

            try:
                created = LobbyAnnouncement.objects.create(
                    lobby=lobby,
                    title=title,
                    content=content,
                    is_active=True,
                )
            except IntegrityError:
                # Another worker created an active row concurrently. Reuse and update it.
                created = (
                    LobbyAnnouncement.objects
                    .select_for_update()
                    .filter(lobby=lobby, is_active=True)
                    .order_by("-updated_at", "-id")
                    .first()
                )
                if created is None:
                    raise
                created.title = title
                created.content = content
                created.is_active = True
                created.save()

            payload = LobbyAnnouncementAdminSerializer(created, context={"request": request}).data
            return Response(payload, status=200)
