from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("games", "0011_game_recreate_lifecycle"),
    ]

    operations = [
        migrations.AddField(
            model_name="announcement",
            name="audio_file",
            field=models.CharField(blank=True, default="", max_length=500),
        ),
        migrations.AddField(
            model_name="announcement",
            name="audio_mime_type",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
    ]
