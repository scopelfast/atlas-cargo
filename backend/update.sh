
#!/bin/bash
# update.sh — updates code and restarts pm2

set -e

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="atlas-cargo"
START_CMD="pnpm start"   # command used to start the app

echo "==> Pulling latest changes from Git..."
git pull origin main

echo "==> Installing dependencies..."
npm install --frozen-lockfile

echo "==> Restarting application with PM2..."

if pm2 describe "$APP_NAME" > /dev/null; then
  pm2 stop "$APP_NAME"
  pm2 delete "$APP_NAME"
fi
pm2 start npm --name "$APP_NAME" -- start

echo "==> Saving PM2 process list..."
pm2 save

echo "✅ Update complete."
