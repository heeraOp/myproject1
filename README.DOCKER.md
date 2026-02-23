# Docker Workflows

This project now has two Docker modes without changing game logic:

- Local development: `docker-compose.dev.yml` (hot reload for backend and frontend).
- VPS hosting: `docker-compose.yml` (production stack with Nginx + Django + Celery + Postgres + Redis).

## Local Development

1. Create local dev env file (optional, defaults are already in compose):

```bash
cp .env.dev.example .env.dev
```

2. Start dev stack:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml up --build
```

3. Access:

- Frontend (Vite): `http://localhost:5173`
- Backend API: `http://localhost:8000/api/`

### Local Recovery (Fix 502 / DB Auth Errors)

If you see `502 Bad Gateway` in frontend and backend logs show
`password authentication failed`, your local Postgres volume was created with older credentials.

Reset local dev state and recreate containers:

```bash
docker compose --env-file .env.dev -f docker-compose.dev.yml down -v
docker compose --env-file .env.dev -f docker-compose.dev.yml up --build
```

Important: for local development, run `docker-compose.dev.yml` (not `docker-compose.yml`).

Dev details:

- Backend runs with `uvicorn --reload`.
- Frontend runs with Vite + proxy (`/api`, `/ws`, `/media`, `/static`).
- Celery worker runs alongside backend so auto-calling/background tasks work.

## VPS Hosting (Production)

1. Prepare production env:

```bash
cp .env.vps.example .env
```

2. Edit `.env` with real values (`DJANGO_SECRET_KEY`, DB credentials, domain hosts/origins).

3. Start production stack:

```bash
docker compose --env-file .env -f docker-compose.yml up -d --build
```

4. Access app on `NGINX_PORT` (default `80`).

Production details:

- Nginx serves frontend build, proxies `/api` and `/ws` to Django ASGI.
- Static/media are shared via Docker volumes.
- Celery worker is included and uses the same Redis broker/database config.

## Migrate Local State To VPS

To move your current local project status (database + media) to VPS:

1. Export local state:

```bash
./scripts/export-local-state.sh
```

2. Copy generated folder (inside `artifacts/`) to VPS:

```bash
scp -r artifacts/state-YYYYMMDD-HHMMSS user@your-vps:/opt/tambola/
```

3. On VPS, restore state into production stack:

```bash
./scripts/restore-vps-state.sh /opt/tambola/state-YYYYMMDD-HHMMSS
```

See `README.HOSTINGER.md` for the full Hostinger VPS workflow.

## Important HTTPS Note For VPS

`DJANGO_ENV=production` enforces secure cookies and HTTPS redirect. Use TLS in front of this stack (or terminate TLS at your edge proxy) and forward `X-Forwarded-Proto: https`.

If you must do a temporary HTTP-only smoke test, set these env vars to `False`:
`DJANGO_ENFORCE_HTTPS`, `DJANGO_FORCE_SECURE_COOKIES`, `DJANGO_ENABLE_HSTS`.

## Useful Commands

```bash
# Follow logs
docker compose -f docker-compose.dev.yml logs -f
docker compose -f docker-compose.yml logs -f

# Stop stacks
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.yml down
```
