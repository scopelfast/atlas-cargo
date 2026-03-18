#!/bin/bash
# Restaurar backup do PostgreSQL (atlas_cargo_prd)
# Se der "arquivo requerido não encontrado", converta CRLF para LF no servidor:
#   sed -i 's/\r$//' restaurar-backup-db.sh
# Uso no servidor Linux:
#   chmod +x restaurar-backup-db.sh
#   ./restaurar-backup-db.sh [caminho-do-arquivo.sql]
#   ou: ./restaurar-backup-db.sh   (usa o .sql mais recente na pasta atual)
#
# Variáveis de ambiente (ou ajuste abaixo):
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DB_NAME="${PGDATABASE:-atlas_cargo_prd}"
DB_USER="${PGUSER:-postgres}"
DB_HOST="${PGHOST:-localhost}"
DB_PORT="${PGPORT:-5432}"

if [ -n "$1" ]; then
  ARQUIVO="$1"
else
  ARQUIVO=$(ls -t atlas_cargo_prd_backup_*.sql 2>/dev/null | head -1)
  if [ -z "$ARQUIVO" ]; then
    echo "Nenhum arquivo atlas_cargo_prd_backup_*.sql encontrado."
    echo "Uso: $0 <caminho-do-backup.sql>"
    exit 1
  fi
  echo "Usando backup mais recente: $ARQUIVO"
fi

if [ ! -f "$ARQUIVO" ]; then
  echo "Arquivo nao encontrado: $ARQUIVO"
  exit 1
fi

# Converter CRLF (Windows) para LF (Unix) - evita "invalid command \N" e "syntax error at or near 1"
sed 's/\r$//' "$ARQUIVO" > "$ARQUIVO.tmp" && mv "$ARQUIVO.tmp" "$ARQUIVO"

echo "=========================================="
echo "  Restaurando banco: $DB_NAME"
echo "  Arquivo: $ARQUIVO"
echo "=========================================="

# Restaurar (psql entende \connect e \. do pg_dump)
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$ARQUIVO"

echo "=========================================="
echo "  Restauração concluída."
echo "=========================================="
