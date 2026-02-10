from django.db.models import Sum
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.response import Response
from rest_framework.views import APIView

from claims.models import Prize
from games.models import Game
from tickets.models import Ticket


class IsAdminRole(BasePermission):
    """
    Admin-only permission based on user role or staff/superuser flags.
    """

    def has_permission(self, request, view):
        user = request.user
        if not user or not user.is_authenticated:
            return False
        if getattr(user, "role", None) == "ADMIN":
            return True
        return bool(getattr(user, "is_staff", False) or getattr(user, "is_superuser", False))


class RevenueReportView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsAdminRole]

    def get(self, request):
        games = list(Game.objects.filter(status=Game.Status.FINISHED))
        total_games = len(games)

        total_revenue = 0
        total_prize_money = 0

        for game in games:
            booked = Ticket.objects.filter(game=game, status=Ticket.Status.BOOKED).count()
            total_revenue += booked * game.ticket_price
            prize_total = Prize.objects.filter(game=game).aggregate(total=Sum("amount")).get("total") or 0
            total_prize_money += prize_total

        total_profit = total_revenue - total_prize_money

        return Response(
            {
                "total_games": total_games,
                "total_revenue": total_revenue,
                "total_profit": total_profit,
            }
        )
