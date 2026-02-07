from django.db import transaction
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework.response import Response
from rest_framework.views import APIView

from games.models import Game

from .models import Ticket
from .serializers import AdminBulkTicketGenerateSerializer, AdminTicketBookingSerializer
from .utils.generator import generate_housie_ticket


@method_decorator(csrf_exempt, name="dispatch")
class AdminTicketBookingView(APIView):
    authentication_classes = []
    def post(self, request):
        serializer = AdminTicketBookingSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data["game_id"]
        ticket_number = serializer.validated_data["ticket_number"]
        player_name = serializer.validated_data["player_name"]
        player_phone = serializer.validated_data["player_phone"]

        try:
            game = Game.objects.get(id=game_id)
        except Game.DoesNotExist:
            return Response({"detail": "Game not found."}, status=404)

        if game.booking_status != Game.BookingStatus.OPEN:
            return Response({"detail": "Ticket booking is closed for this game."}, status=400)

        with transaction.atomic():
            try:
                ticket = Ticket.objects.select_for_update().get(game=game, ticket_number=ticket_number)
            except Ticket.DoesNotExist:
                return Response({"detail": "Ticket not found."}, status=404)

            if ticket.status != Ticket.Status.OPEN:
                return Response({"detail": "Ticket is already booked."}, status=400)

            if ticket.player_name or ticket.player_phone:
                return Response({"detail": "Ticket is already assigned."}, status=400)

            ticket.player_name = player_name
            ticket.player_phone = player_phone
            ticket.status = Ticket.Status.BOOKED
            ticket.booked_at = timezone.now()
            ticket.save()

        return Response(
            {
                "id": str(ticket.id),
                "game_id": str(ticket.game_id),
                "ticket_number": ticket.ticket_number,
                "ticket_type": ticket.ticket_type,
                "status": ticket.status,
                "player_name": ticket.player_name,
                "player_phone": ticket.player_phone,
                "booked_at": ticket.booked_at,
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class AdminBulkTicketGenerateView(APIView):
    authentication_classes = []

    def post(self, request):
        serializer = AdminBulkTicketGenerateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=400)

        game_id = serializer.validated_data["game_id"]
        total_tickets = serializer.validated_data["total_tickets"]

        with transaction.atomic():
            try:
                game = Game.objects.select_for_update().get(id=game_id)
            except Game.DoesNotExist:
                return Response({"detail": "Game not found."}, status=404)

            if game.status not in (Game.Status.CREATED, Game.Status.BOOKING_OPEN):
                return Response({"detail": "Tickets can only be generated before or during booking."}, status=400)

            if Ticket.objects.filter(game=game).exists():
                return Response({"detail": "Tickets already exist for this game."}, status=400)

            tickets = []
            for ticket_number in range(1, total_tickets + 1):
                ticket_data = generate_housie_ticket()
                tickets.append(
                    Ticket(
                        game=game,
                        ticket_number=ticket_number,
                        ticket_type=Ticket.TicketType.RANDOM,
                        ticket_data=ticket_data,
                        status=Ticket.Status.OPEN,
                    )
                )

            Ticket.objects.bulk_create(tickets)

        return Response({"total_generated": total_tickets})
