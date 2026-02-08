from django.urls import path

from .views import AdminEvaluateClaimsView, GameWinnersView

urlpatterns = [
    path("admin/evaluate/", AdminEvaluateClaimsView.as_view(), name="admin-claims-evaluate"),
    path("game/<uuid:game_id>/winners/", GameWinnersView.as_view(), name="game-winners"),
]
