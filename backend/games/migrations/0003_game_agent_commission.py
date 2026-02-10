from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("games", "0002_game_calling_interval"),
    ]

    operations = [
        migrations.AddField(
            model_name="game",
            name="agent_commission",
            field=models.PositiveIntegerField(default=0),
        ),
    ]
