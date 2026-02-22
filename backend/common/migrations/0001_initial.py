from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="VoiceAsset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("key", models.CharField(db_index=True, max_length=120, unique=True)),
                ("text", models.TextField()),
                ("audio_file", models.FileField(upload_to="voice_assets/")),
                ("hash", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "ordering": ("-created_at", "id"),
                "indexes": [
                    models.Index(fields=["key"], name="common_voice_asset_key_idx"),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="voiceasset",
            constraint=models.UniqueConstraint(fields=("hash",), name="common_voice_asset_hash_unique"),
        ),
    ]
