# Production Deployment Guide

This assumes a fresh Ubuntu 22.04+ VPS (Hetzner CX22 or similar) with a
domain name you can point DNS at.

## 1. Server setup

```bash
# On the VPS, as root or with sudo
apt update && apt upgrade -y

# Install Docker + Docker Compose plugin
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose-plugin

# Create a non-root user to run things (don't run this as root long-term)
adduser r2ldeploy
usermod -aG docker r2ldeploy
su - r2ldeploy
```

## 2. Firewall

Only 22 (SSH), 80, and 443 should ever be reachable from the internet —
everything else (Postgres, Qdrant, Redis, the API itself) stays internal to
the Docker network, which `deploy/docker-compose.prod.yml` already enforces
by not publishing their ports. Still worth a host firewall as a second layer:

```bash
apt install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## 3. DNS

Point an A record for your domain (e.g. `chatbot.right2lifelanka.org`) at
the VPS's public IP. Caddy needs this resolving correctly *before* it starts,
or Let's Encrypt certificate issuance will fail.

## 4. Deploy the code

```bash
git clone <your-repo-url> r2l-chatbot-backend
cd r2l-chatbot-backend

cp deploy/.env.production.example .env
nano .env   # fill in every REPLACE_WITH_* value — see the comments in that file

nano deploy/Caddyfile   # replace your-domain-here.example.com with the real domain

docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build
```

## 5. Run the migrations and seed the first admin

```bash
docker exec -i r2l_postgres psql -U r2l_user -d r2l_chatbot < src/db/migrations/001_init.sql
docker exec -i r2l_postgres psql -U r2l_user -d r2l_chatbot < src/db/migrations/002_triage_flow.sql

docker exec -it r2l_api node scripts/seedAdmin.js "Your Name" admin@r2l.org "ChooseAStrongPassword123!"
```

## 6. Verify

```bash
curl https://your-domain.example.com/api/health
# -> {"status":"ok",...}  with a valid HTTPS certificate, no warnings
```

## 7. Point Meta's webhooks at the real domain

Same steps as the ngrok testing, but the Callback URL is now:
```
https://your-domain.example.com/webhooks/whatsapp
https://your-domain.example.com/webhooks/messenger
```
No tunnel needed anymore — this URL is permanent as long as the server is up.

## 8. Set up backups

```bash
crontab -e
```
Add:
```
0 2 * * * /home/r2ldeploy/r2l-chatbot-backend/deploy/backup-postgres.sh >> /var/log/r2l-backup.log 2>&1
0 3 * * * /home/r2ldeploy/r2l-chatbot-backend/deploy/backup-qdrant.sh >> /var/log/r2l-backup.log 2>&1
```
See the comments in each script — the Postgres backup matters more (it holds
conversation/client data that can't be regenerated); the Qdrant one is a
convenience since the knowledge base can be re-ingested from source
documents if lost.

**Don't stop here** — a backup that only lives on the same VPS as the live
data doesn't protect against that VPS being lost entirely (disk failure,
account issue, etc.). Sync `/var/backups/r2l-chatbot` to an encrypted
off-server location (e.g. `rclone` to a cloud bucket) on the same cron
schedule, or at minimum weekly.

## 9. Re-upload the knowledge base

The documents you uploaded during local testing don't carry over — they're
only in your local Postgres/Qdrant. Log in to the production API and
re-upload the 25 scenario files the same way you did locally.

## Ongoing

- **WhatsApp access token**: if you switched to a permanent System User
  token (recommended, see `.env.production.example`), it won't expire like
  the 24-hour dev token did. If you're still using the temporary one, replies
  will silently stop working after 24 hours — this is the single most common
  "it worked yesterday" production surprise with the Cloud API.
- **Logs**: `docker compose logs -f api` / `docker compose logs -f worker`
- **Updating**: `git pull && docker compose -f docker-compose.yml -f deploy/docker-compose.prod.yml up -d --build`
