from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("games", "0004_game_website_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="game",
            name="active_theme",
            field=models.CharField(
                choices=[
                    ("dark", "Dark"),
                    ("light", "Light"),
                    ("festival-gold", "Festival Gold"),
                    ("festival-diwali", "Festival Diwali"),
                ],
                default="dark",
                max_length=20,
            ),
        ),
    ]
