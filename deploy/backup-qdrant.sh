#!/usr/bin/env bash
# Daily Qdrant snapshot with 14-day retention, via cron:
#   0 3 * * * /path/to/r2l-chatbot-backend/deploy/backup-qdrant.sh >> /var/log/r2l-backup.log 2>&1
#
# Note: the knowledge base (Qdrant) is fully reconstructible by re-ingesting
# your source documents, so this backup matters less than the Postgres one
# (which holds conversation history and client data that can't be
# regenerated). Still worth keeping so a bad ingestion run or accidental
# deletion doesn't mean re-uploading and re-embedding everything from
# scratch.

set -euo pipefail

BACKUP_DIR="/var/backups/r2l-chatbot/qdrant"
RETENTION_DAYS=14
COLLECTION="r2l_knowledge_base"
QDRANT_URL="http://localhost:6333" # adjust if Qdrant isn't published to the host in prod — see note below

mkdir -p "$BACKUP_DIR"

# Trigger a snapshot inside Qdrant, then copy it out
SNAPSHOT_NAME=$(curl -s -X POST "$QDRANT_URL/collections/$COLLECTION/snapshots" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)

if [ -z "$SNAPSHOT_NAME" ]; then
  echo "[$(date)] Failed to create Qdrant snapshot" >&2
  exit 1
fi

docker cp "r2l_qdrant:/qdrant/storage/collections/$COLLECTION/snapshots/$SNAPSHOT_NAME" \
  "$BACKUP_DIR/$SNAPSHOT_NAME"

find "$BACKUP_DIR" -name "*.snapshot" -mtime "+$RETENTION_DAYS" -delete

echo "[$(date)] Qdrant snapshot saved: $SNAPSHOT_NAME"

# NOTE: in the production compose overlay, Qdrant's port isn't published to
# the host (see deploy/docker-compose.prod.yml). Either run this script
# inside the Docker network (e.g. as a one-off container on the same
# network), or temporarily expose 6333 to localhost only for backup runs.
