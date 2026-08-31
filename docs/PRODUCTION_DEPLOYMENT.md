# Production Deployment

This guide targets a clean Debian server, Docker Compose, host Nginx, Certbot, and the initial public hostname:

```txt
support.aviditytechnologies.com
```

## Production Readiness Notes

- Do not commit `.env`, `.env.production`, database dumps, logs, or `storage/local` file contents.
- Production containers bind API and web ports to `127.0.0.1`; only Nginx should be public.
- Uploaded files stay in the Docker volume `app-storage` and are served only through authenticated API endpoints.
- `APP_ENV=production` refuses to start with the default session secret.
- The seed script refuses to seed production with the default administrator password.
- Configure Cloudflare DNS to point `support.aviditytechnologies.com` to the server public IP.

## Server Packages

Install Docker from Docker's official Debian repository and install Nginx/Certbot on the host.

```bash
sudo apt update
sudo apt install -y ca-certificates curl git nginx snapd ufw

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker nginx
```

Install Certbot:

```bash
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf /snap/bin/certbot /usr/bin/certbot
```

## Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Do not expose PostgreSQL, Redis, API port `4000`, or web port `3000` publicly.

## Clone And Configure

```bash
sudo mkdir -p /opt/avidity
sudo chown "$USER":"$USER" /opt/avidity
cd /opt/avidity
git clone https://github.com/Avidity-Technologies-Inc/AvidityOne.git .
cp .env.production.example .env.production
nano .env.production
```

Minimum production values to set:

```env
APP_ENV=production
APP_URL=https://support.aviditytechnologies.com
API_URL=https://support.aviditytechnologies.com/api
NEXT_PUBLIC_API_URL=https://support.aviditytechnologies.com/api
CORS_ORIGINS=https://support.aviditytechnologies.com

POSTGRES_DB=avidity_it_management
POSTGRES_USER=AvidityIT
POSTGRES_PASSWORD=<strong unique database password>

SESSION_SECRET=<at least 32 random characters>
COOKIE_DOMAIN=support.aviditytechnologies.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax

ADMIN_EMAIL=admin@aviditytechnologies.com
ADMIN_PASSWORD=<temporary strong password for first seed only>
```

Generate a session secret:

```bash
openssl rand -base64 48
```

## Build And Start

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api npx prisma migrate deploy --schema prisma/schema.prisma
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api npm run prisma:seed
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

After the first seed, change the admin password through the application as soon as that workflow exists. Until then, use a strong `ADMIN_PASSWORD` and restrict admin access.

## Native Systemd Production Updates

The current native production host uses `/opt/avidity/app`, `.env.production`, and systemd services instead of Docker Compose. Prisma CLI does not load `.env.production` automatically, so run Prisma through `node -r dotenv/config` with `DOTENV_CONFIG_PATH=.env.production`.

Do not use `NODE_OPTIONS="-r dotenv/config"` for `npm run build`; Next.js worker processes reject `-r` in `NODE_OPTIONS`.

```bash
cd /opt/avidity/app
git pull origin main

sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js generate --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && DOTENV_CONFIG_PATH=.env.production node -r dotenv/config ./node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma'
sudo -u avidity bash -lc 'cd /opt/avidity/app && node -e "require(\"dotenv\").config({ path: \".env.production\" }); const { spawnSync } = require(\"node:child_process\"); const result = spawnSync(\"npm\", [\"run\", \"build\"], { stdio: \"inherit\", env: process.env }); process.exit(result.status ?? 1);"'

sudo systemctl restart avidity-api avidity-web
sudo systemctl status avidity-api --no-pager
sudo systemctl status avidity-web --no-pager
```

If a build fails with `EACCES` under `apps/api/dist`, `apps/web/.next`, or package `dist` folders, those artifacts were likely created by `root`. Fix ownership before rebuilding:

```bash
sudo chown -R avidity:avidity /opt/avidity/app/apps/api/dist 2>/dev/null || true
sudo chown -R avidity:avidity /opt/avidity/app/apps/web/.next 2>/dev/null || true
sudo find /opt/avidity/app/packages -type d -name dist -exec chown -R avidity:avidity {} +
```

## Nginx And SSL

Install the bootstrap HTTP config first:

```bash
sudo cp docker/nginx/support.aviditytechnologies.com.bootstrap.conf /etc/nginx/sites-available/support.aviditytechnologies.com
sudo ln -sf /etc/nginx/sites-available/support.aviditytechnologies.com /etc/nginx/sites-enabled/support.aviditytechnologies.com
sudo nginx -t
sudo systemctl reload nginx
```

Request the certificate:

```bash
sudo certbot certonly --webroot -w /var/www/certbot -d support.aviditytechnologies.com
```

Install the final HTTPS reverse-proxy config:

```bash
sudo cp docker/nginx/support.aviditytechnologies.com.conf /etc/nginx/sites-available/support.aviditytechnologies.com
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Verify:

```bash
curl -I https://support.aviditytechnologies.com
curl https://support.aviditytechnologies.com/api/health
```

## Updates

```bash
cd /opt/avidity
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml run --rm api npx prisma migrate deploy --schema prisma/schema.prisma
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f --tail=100 api web
```

## Backups

Database backup:

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > "backup-$(date +%F).sql"
```

Application file storage backup:

```bash
docker run --rm -v avidityitmanagementtool_app-storage:/data -v "$PWD":/backup alpine tar czf /backup/storage-$(date +%F).tar.gz -C /data .
```

Test restore procedures before depending on backups.

## Cloudflare

- DNS: `A support -> server public IP`.
- SSL/TLS mode: use Full (strict) after the Let's Encrypt certificate is installed.
- Keep API/web ports private; Cloudflare should only reach Nginx on ports 80/443.
