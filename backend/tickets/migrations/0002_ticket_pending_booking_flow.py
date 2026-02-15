from django.db import migrations, models


def forwards_status_mapping(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.filter(status="OPEN").update(status="AVAILABLE")
    Ticket.objects.filter(status="BOOKED").update(status="CONFIRMED")


def backwards_status_mapping(apps, schema_editor):
    Ticket = apps.get_model("tickets", "Ticket")
    Ticket.objects.filter(status="CONFIRMED").update(status="BOOKED")
    Ticket.objects.filter(status="AVAILABLE").update(status="OPEN")
    Ticket.objects.filter(status="PENDING").update(status="OPEN")


class Migration(migrations.Migration):

    dependencies = [
        ("tickets", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="ticket",
            name="requested_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="ticket",
            name="requested_by_name",
            field=models.CharField(blank=True, max_length=120, null=True),
        ),
        migrations.AddField(
            model_name="ticket",
            name="requested_by_whatsapp",
            field=models.CharField(blank=True, max_length=20, null=True),
        ),
        migrations.AlterField(
            model_name="ticket",
            name="status",
            field=models.CharField(
                choices=[
                    ("AVAILABLE", "Available"),
                    ("PENDING", "Pending"),
                    ("CONFIRMED", "Confirmed"),
                ],
                default="AVAILABLE",
                max_length=20,
            ),
        ),
        migrations.RunPython(forwards_status_mapping, backwards_status_mapping),
    ]
