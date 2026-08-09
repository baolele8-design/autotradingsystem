#!/usr/bin/env bash
# Deploy script for VPS root@222.255.181.141:/root/quant-bot
# Usage: bash scripts/deploy.sh [--dry-run]
set -euo pipefail

APP_DIR="/root/quant-bot"
LOG_FILE="$APP_DIR/logs/deploy.log"
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[deploy $(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

cd "$APP_DIR"
log "START dry_run=$DRY_RUN"

# Reset tracked files touched by previous builds (e.g. dist/) so merge never conflicts
git checkout -- . 2>/dev/null || true

git fetch origin main
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)
log "local=$LOCAL_HEAD remote=$REMOTE_HEAD"

if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
  log "ALREADY_UP_TO_DATE nothing to do"
  exit 0
fi

if $DRY_RUN; then
  log "DRY_RUN would merge $LOCAL_HEAD -> $REMOTE_HEAD (ff-only)"
  exit 0
fi

echo "$LOCAL_HEAD" > .deploy-prev-head
git merge --ff-only origin/main
log "MERGED to $REMOTE_HEAD"

npm ci
log "npm ci ok"
npm run check
log "npm run check ok"
npm --prefix local-daemon ci
log "local-daemon ci ok"

pm2 restart main-bot frontend --update-env
log "pm2 restarted main-bot frontend"
log "DONE"
