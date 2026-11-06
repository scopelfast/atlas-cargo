# Restore do banco Atlas Cargo

**Guia completo (Cursor / outro servidor / espelho scopelfast):**  
veja na raiz do repo → [`INSTALACAO_OUTRO_SERVIDOR.md`](../INSTALACAO_OUTRO_SERVIDOR.md)

Dump gerado em **06/11/2026** a partir de `atlas_cargo_prd` (PostgreSQL, formato custom `-Fc`).

## Pré-requisitos no servidor novo

- PostgreSQL 14+ (preferível 16/18)
- Node.js LTS
- Arquivo `backend/.env` (não vai no Git — copiar do servidor atual e ajustar host/senha)

## Restaurar o dump

```bash
# criar banco vazio
createdb -U postgres atlas_cargo_prd

# restaurar
pg_restore -h localhost -U postgres -d atlas_cargo_prd --no-owner --no-acl backups/atlas_cargo_prd_20261106.dump
```

Windows (PowerShell), com `psql`/`pg_restore` no PATH ou em `C:\Program Files\PostgreSQL\*\bin\`:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" -h localhost -U postgres -d atlas_cargo_prd --no-owner --no-acl backups\atlas_cargo_prd_20261106.dump
```

## App

```bash
cd backend
npm ci
# criar backend/.env com DB_* e demais chaves
node app.js
```

## O que NÃO está neste dump/commit

- `backend/.env` (segredos)
- uploads novos de CNH/áudio/comprovantes (dados pessoais) — copiar pasta `backend/public/uploads` à parte se precisar
