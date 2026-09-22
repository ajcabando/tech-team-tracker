# Production deployment (Ubuntu + Docker + HTTPS)

This guide deploys the platform on a fresh Ubuntu server (`tracker.example.com`) behind a
reverse proxy with HTTPS. Replace `tracker.example.com` with your own domain.

## 1. Server preparation

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git ufw

# Docker Engine + Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out/in for this to take effect
docker compose version
```

Basic firewall — only SSH and the web ports:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

PostgreSQL is **not** published to the host by `docker-compose.yml`, so no database port is exposed.

## 2. Deploy the application

```bash
sudo mkdir -p /opt/tracker && sudo chown "$USER" /opt/tracker
git clone <your-fork-url> /opt/tracker
cd /opt/tracker
cp .env.example .env
```

Edit `.env` and set, at minimum:

```dotenv
POSTGRES_PASSWORD=<strong-random-password>
DATABASE_URL=postgresql://tracker:<strong-random-password>@postgres:5432/tracker?schema=public
JWT_SECRET=<openssl rand -base64 48>
JWT_REFRESH_SECRET=<openssl rand -base64 48>
CORS_ORIGIN=https://tracker.example.com
VITE_API_URL=
NODE_ENV=production
```

Generate secrets with `openssl rand -base64 48`.

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:5789/health
```

The backend applies database migrations automatically on start.

## 3. Reverse proxy and HTTPS

Install nginx and Certbot on the host, then proxy `tracker.example.com` to the dashboard on
`127.0.0.1:5788`. The dashboard container already proxies `/api` and `/health` to the backend
on the private Docker network, so one TLS vhost is enough.

```nginx
# /etc/nginx/sites-available/tracker
server {
    listen 80;
    server_name tracker.example.com;

    location / {
        proxy_pass http://127.0.0.1:5788;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Live updates use Server-Sent Events; do not buffer them.
        proxy_buffering off;
        proxy_read_timeout 24h;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tracker /etc/nginx/sites-enabled/tracker
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d tracker.example.com     # obtains the certificate and adds TLS
```

Certbot installs a renewal timer automatically; verify with `sudo certbot renew --dry-run`.

If you bind `API_PORT` to the host for phones on your LAN, restrict it to your office network:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 5789 proto tcp
```

Phones on mobile data should reach the API through the HTTPS domain, not a LAN IP.

## 4. Updates

```bash
cd /opt/tracker
git pull
docker compose build
docker compose up -d
docker compose logs -f backend
```

Migrations run automatically. Take a backup before updating (see [BACKUP.md](BACKUP.md)).

## 5. Rollback

```bash
cd /opt/tracker
git log --oneline -10            # find the previous good commit
git checkout <commit>
docker compose up -d --build
```

Database migrations are forward-only. If a release added a migration, restore the matching
backup before running the older build.

## 6. Logs and monitoring

```bash
docker compose logs -f backend        # API requests, auth, pairing, GPS sync, trip processing
docker compose logs -f postgres
docker compose ps                     # health status per service
curl -fsS https://tracker.example.com/health
```

Useful checks:

- `GET /health` — API plus database status, version, uptime, live subscribers
- `GET /health/database` — database reachability only
- `GET /health/version` — build version

For deeper monitoring, scrape `/health` with Uptime Kuma, Better Stack, or a systemd timer, and
alert on non-200. Configure a disk-usage alert: GPS history grows with fleet size.

## 7. Operational notes

- **Retention:** Settings → Data retention controls how long raw GPS, trips, and audit logs are
  kept. A background job applies the windows daily. Confirm your retention matches company policy.
- **Device pairing:** after deployment, sign in, create an organization/technician, and generate a
  pairing code. Point the Android app at `https://tracker.example.com`.
- **Android release builds:** sign with your own keystore; never commit keystores. See
  [../android](../android).
- **Scaling:** the stack is single-node by default. For multiple backend replicas, move the SSE
  event bus and rate limiter to Redis and run PostgreSQL separately with regular backups.
