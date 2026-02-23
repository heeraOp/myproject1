# Hostinger VPS Deployment (With Same Local Project State)

This guide deploys the current project to a Hostinger VPS and restores the same local state
(PostgreSQL data + uploaded media).

## 1. Export Current Local State

From your local project root:

```bash
chmod +x scripts/export-local-state.sh scripts/restore-vps-state.sh
./scripts/export-local-state.sh
```

This creates a folder like `artifacts/state-YYYYMMDD-HHMMSS/`.

## 2. Prepare Hostinger VPS

SSH into VPS and install Docker:

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
```

## 3. Deploy Project Code On VPS

```bash
mkdir -p ~/apps
cd ~/apps
git clone <your-repo-url> myproject1
cd myproject1
```

## 4. Configure Production Environment

```bash
cp .env.vps.example .env
```

Edit `.env`:

- `DJANGO_SECRET_KEY`: set a long random secret.
- `POSTGRES_PASSWORD`: set a strong DB password.
- `DJANGO_ALLOWED_HOSTS`: set your domain(s) and/or VPS IP.
- `DJANGO_CORS_ALLOWED_ORIGINS`: set your HTTPS frontend origin(s).
- `DJANGO_CSRF_TRUSTED_ORIGINS`: set same HTTPS origin(s).
- `NGINX_PORT`: usually `80`.
- `ELEVEN_API_KEY`: optional but recommended for premium voice output.

## 5. Start Production Stack

```bash
docker compose --env-file .env -f docker-compose.yml up -d --build
```

## 6. Copy Local State Artifact To VPS

From your local machine:

```bash
scp -r artifacts/state-YYYYMMDD-HHMMSS user@your-vps:~/apps/myproject1/
```

## 7. Restore Same State On VPS

On VPS:

```bash
cd ~/apps/myproject1
chmod +x scripts/export-local-state.sh scripts/restore-vps-state.sh
./scripts/restore-vps-state.sh ~/apps/myproject1/state-YYYYMMDD-HHMMSS
```

## 8. Verify

```bash
docker compose --env-file .env -f docker-compose.yml ps
docker compose --env-file .env -f docker-compose.yml logs --tail=100 backend
docker compose --env-file .env -f docker-compose.yml logs --tail=100 frontend
```

Open:

- App: `http://<vps-ip-or-domain>/`
- Admin: `http://<vps-ip-or-domain>/admin/`

## HTTPS Requirement

Production defaults enforce HTTPS and secure cookies:

- `DJANGO_ENFORCE_HTTPS=True`
- `DJANGO_FORCE_SECURE_COOKIES=True`
- `DJANGO_ENABLE_HSTS=True`

For a short HTTP-only smoke test (not recommended), set these in `.env` and restart:

```env
DJANGO_ENFORCE_HTTPS=False
DJANGO_FORCE_SECURE_COOKIES=False
DJANGO_ENABLE_HSTS=False
DJANGO_SESSION_COOKIE_SECURE=False
DJANGO_CSRF_COOKIE_SECURE=False
DJANGO_SESSION_COOKIE_SAMESITE=Lax
DJANGO_CSRF_COOKIE_SAMESITE=Lax
```

Then:

```bash
docker compose --env-file .env -f docker-compose.yml up -d
```
