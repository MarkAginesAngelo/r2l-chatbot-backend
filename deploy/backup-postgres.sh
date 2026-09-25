#!/usr/bin/env bash
# Daily Postgres backup with 14-day retention. Run this via cron on the VPS
# (not inside the container, so it survives container restarts/rebuilds):
#
#   crontab -e
#   0 2 * * * /path/to/r2l-chatbot-backend/deploy/backup-postgres.sh >> /var/log/r2l-backup.log 2>&1
#
# Given what this database holds (torture reports, domestic violence
# disclosures, exact victim identities), treat these backup files as
# sensitive as the live database — the BACKUP_DIR below should NOT be
# world-readable, and should itself be backed up somewhere encrypted
# (e.g. rclone to an encrypted cloud bucket) rather than left only on
# the same VPS as the live data.

set -euo pipefail

BACKUP_DIR="/var/backups/r2l-chatbot"
RETENTION_DAYS=14
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
CONTAINER_NAME="r2l_postgres"
DB_USER="r2l_user"
DB_NAME="r2l_chatbot"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom \
  > "$BACKUP_DIR/r2l-chatbot-$TIMESTAMP.dump"

chmod 600 "$BACKUP_DIR/r2l-chatbot-$TIMESTAMP.dump"

# Delete backups older than the retention window
find "$BACKUP_DIR" -name "r2l-chatbot-*.dump" -mtime "+$RETENTION_DAYS" -delete

echo "[$(date)] Backup complete: r2l-chatbot-$TIMESTAMP.dump"

# To restore:
#   docker exec -i r2l_postgres pg_restore -U r2l_user -d r2l_chatbot --clean < backup-file.dump
