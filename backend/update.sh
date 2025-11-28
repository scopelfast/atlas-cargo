#!/bin/bash
# update.sh — atualiza o repositório e reconstrói os containers via docker-compose

set -e  # sai se algum comando falhar

# Caminho da sua aplicação — ajuste se necessário
APP_DIR="/caminho/para/seu/projeto"
cd "$APP_DIR"

echo "==> Pulling latest changes from Git..."
git pull origin main   # ou branch que você usa

echo "==> Rebuilding and restarting containers..."
docker-compose up -d --build --force-recreate

echo "==> Clean up unused images..."
docker image prune -f

echo "✅ Update complete."

