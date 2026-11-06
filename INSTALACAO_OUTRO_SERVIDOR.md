# Instalação em outro servidor (Cursor)

Use este arquivo na **outra máquina** com o Cursor. Peça ao agente:

> Leia `INSTALACAO_OUTRO_SERVIDOR.md` e execute a restauração do Atlas Cargo passo a passo.

Repo: https://github.com/Scopel2022/atlas-cargo  
Dump: `backups/atlas_cargo_prd_20261106.dump` (~28 MB, PostgreSQL custom `-Fc`)  
App: pasta `backend/`

---

## 0) O que NÃO vem no Git

| Item | Onde pegar |
|------|------------|
| `backend/.env` | Copiar da máquina atual (senhas, DB, tokens) |
| Uploads novos (CNH, áudio…) | Copiar `backend/public/uploads` se precisar (USB/SCP) |

**Nunca** commitar `.env` no GitHub.

---

## 1) Pré-requisitos na máquina nova

- Git
- Node.js LTS (18+)
- PostgreSQL 14+ (ideal 16 ou 18), com `pg_restore` / `psql` no PATH  
  Windows típico: `C:\Program Files\PostgreSQL\18\bin\`
- Acesso ao GitHub (`Scopel2022/atlas-cargo` — repo privado: login/credencial necessária)

---

## 2) Clonar o código

```powershell
cd C:\gitHub
git clone https://github.com/Scopel2022/atlas-cargo.git SysScopel
cd SysScopel
git checkout main
git pull
```

No Cursor: abrir a pasta `SysScopel` como workspace.

---

## 3) Criar o banco e restaurar o dump

### 3.1 Criar usuário/banco (ajuste senha)

```powershell
# como superuser postgres (ajuste caminho do psql se precisar)
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE USER atlas WITH PASSWORD 'SUA_SENHA' SUPERUSER;"
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE atlas_cargo_prd OWNER atlas;"
```

Se o banco/usuário já existirem, pule a criação.

### 3.2 Restaurar

```powershell
cd C:\gitHub\SysScopel
$env:PGPASSWORD = "SUA_SENHA"
& "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe" `
  -h localhost -p 5432 -U atlas -d atlas_cargo_prd `
  --no-owner --no-acl --verbose `
  backups\atlas_cargo_prd_20261106.dump
```

Erros de “already exists” em roles/extensions às vezes são ignoráveis se o restore terminar.  
Validar:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U atlas -d atlas_cargo_prd -c "\dt" | Select-Object -First 30
```

Deve listar dezenas de tabelas (`WMS_*`, etc.).

---

## 4) Configurar o `.env`

```powershell
copy backend\.env.example backend\.env
# se não existir .env.example, criar backend\.env manualmente
```

Preencher no mínimo (valores da máquina de origem / servidor novo):

```env
DB_SERVER=localhost
DB_PORT=5432
DB_DATABASE=atlas_cargo_prd
DB_USER=atlas
DB_PASSWORD=SUA_SENHA
```

Copiar demais chaves do `.env` antigo (JWT, WhatsApp, ngrok, etc.) se forem usadas.

---

## 5) Instalar dependências e subir

```powershell
cd C:\gitHub\SysScopel\backend
npm ci
node app.js
```

Abrir o sistema no navegador (porta padrão do `app.js` / `.env`).

---

## 6) Checklist rápido (Cursor pode validar)

- [ ] `git pull` em `main`
- [ ] Dump restaurado; `\dt` mostra tabelas WMS
- [ ] `backend/.env` existe e conecta no Postgres
- [ ] `npm ci` ok
- [ ] `node app.js` sobe sem erro de DB
- [ ] Login na tela funciona
- [ ] (Opcional) pasta `uploads` copiada

Prompt sugerido no Cursor da máquina nova:

```text
Siga INSTALACAO_OUTRO_SERVIDOR.md:
1) confirme clone/pull
2) restaure backups/atlas_cargo_prd_20261106.dump no Postgres local
3) ajude a montar backend/.env (sem inventar segredos — peça os valores)
4) rode npm ci e suba o app
Não commitar .env.
```

---

## 7) Compartilhar / espelhar no GitHub `scopelfast`

O código hoje está em **`Scopel2022/atlas-cargo`**.  
A conta **`scopelfast`** é outra. Para ela ter a mesma cópia:

### Opção A — Novo repositório privado em `scopelfast` (recomendado)

Na máquina que já tem o repo (ou na nova, depois do clone):

1. No GitHub logado como **scopelfast**, criar repo vazio privado, ex.:  
   `https://github.com/scopelfast/atlas-cargo`  
   (sem README, sem .gitignore — repo vazio)

2. Autenticar o Git nessa conta (`gh auth login` ou credencial HTTPS/SSH do scopelfast).

3. Adicionar remote e enviar `main`:

```powershell
cd C:\gitHub\SysScopel
git remote -v
# deve existir: origin → Scopel2022/atlas-cargo

git remote add scopelfast https://github.com/scopelfast/atlas-cargo.git
git push -u scopelfast main
```

Assim:
- `origin` = Scopel2022 (produção/equipe)
- `scopelfast` = espelho na outra conta

Para atualizar os dois no futuro:

```powershell
git push origin main
git push scopelfast main
```

### Opção B — Transferir o repositório (só um dono)

No GitHub → `Scopel2022/atlas-cargo` → **Settings → Transfer ownership** → conta `scopelfast`.  
Só faça se quiser **mover** o repo (não manter nos dois lugares).

### Opção C — Fork

Fork só funciona bem se `scopelfast` tiver permissão de ver o privado `Scopel2022/atlas-cargo`.  
Depois: Fork na UI → clone do fork.

### Atenção

- O dump **já está** no Git (`backups/…`). Quem clonar `scopelfast/atlas-cargo` depois do push já leva o banco.
- `.env` **não** vai — passar por canal seguro (1Password, arquivo criptografado, etc.).
- Repo privado: convide colaboradores em **Settings → Collaborators**.

Prompt no Cursor (máquina atual) para espelhar:

```text
Crie o remote scopelfast apontando para https://github.com/scopelfast/atlas-cargo.git
(assumindo que o repo vazio já existe) e faça git push -u scopelfast main.
Não altere o origin Scopel2022.
```

---

## 8) Atualizar o dump no futuro

Na máquina com o banco bom:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -h localhost -p 5432 -U atlas -d atlas_cargo_prd -Fc `
  -f backups\atlas_cargo_prd_AAAAMMDD.dump --no-owner --no-acl
git add backups\atlas_cargo_prd_AAAAMMDD.dump
git commit -m "Atualiza dump do banco para restore em outro servidor."
git push origin main
git push scopelfast main
```

---

## Resumo em uma frase

Clone `Scopel2022/atlas-cargo` → `pg_restore` do dump em `backups/` → copie `.env` → `npm ci` + `node app.js` → (opcional) espelhe com `git remote add scopelfast` + `git push scopelfast main`.
