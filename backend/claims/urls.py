from django.urls import path

from .views import AdminEvaluateClaimsView, GameWinnersView, PrizeListUpdateView, ClaimSubmitView

urlpatterns = [
    path("admin/evaluate/", AdminEvaluateClaimsView.as_view(), name="admin-claims-evaluate"),
    path("submit/", ClaimSubmitView.as_view(), name="claim-submit"),
    path("game/<uuid:game_id>/winners/", GameWinnersView.as_view(), name="game-winners"),
]
