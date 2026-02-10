from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("games", "0003_game_agent_commission"),
    ]

    operations = [
        migrations.AddField(
            model_name="game",
            name="website_status",
            field=models.CharField(
                choices=[("OPEN", "Open"), ("CLOSED", "Closed")],
                default="OPEN",
                max_length=10,
            ),
        ),
    ]
