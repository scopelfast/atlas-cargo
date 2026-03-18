# Scripts de estrutura do banco para o servidor (pgAdmin)

Scripts nesta pasta que alteram **estrutura** (tabelas, colunas, índices) do PostgreSQL devem ser **executáveis no pgAdmin do servidor** para manter o banco de produção/homologação alinhado ao local.

---

## Convenções

| Convenção | Descrição |
|-----------|-----------|
| **Sufixo `_postgres.sql`** | Scripts para PostgreSQL (servidor e local). Preferir esse sufixo em scripts de estrutura. |
| **Idempotência** | Script deve poder ser executado mais de uma vez sem erro. Usar `IF NOT EXISTS` (via `information_schema` ou `CREATE TABLE IF NOT EXISTS`). |
| **Cabeçalho** | Comentário no topo: nome do script, objetivo, banco alvo (`atlas_cargo_prd`) e como executar. |
| **Um propósito** | Um arquivo = uma alteração lógica (ex.: uma tabela nova, ou um conjunto de colunas relacionadas). |

---

## Exemplo: adicionar colunas (idempotente)

```sql
-- Script: adicionar_xxx_postgres.sql
-- Objetivo: Adicionar colunas X, Y na tabela Z.
-- Executar no pgAdmin: banco atlas_cargo_prd, Query Tool, colar e executar.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'NOME_TABELA' AND column_name = 'NOME_COLUNA'
  ) THEN
    ALTER TABLE "NOME_TABELA" ADD COLUMN "NOME_COLUNA" VARCHAR(100) NULL;
  END IF;
END $$;
```

---

## Exemplo: nova tabela

```sql
-- Script: criar_tabela_xxx_postgres.sql
-- Executar no pgAdmin: atlas_cargo_prd.

CREATE TABLE IF NOT EXISTS "NOME_TABELA" (
  "ID" serial PRIMARY KEY,
  "CAMPO" varchar(50) NULL,
  "DHMAINTENANCE" timestamp NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## Onde achar scripts de referência

- **Adicionar colunas (PostgreSQL):** `adicionar_destino_preferido_motorista_postgres.sql`, `adicionar_aplicavel_para_cadastrogeral.sql`
- **Schema completo:** na raiz do projeto, `script_db_postgres.sql`

---

## Política do projeto

Toda alteração de estrutura feita no banco **local** deve ser documentada aqui. Ver também: `docs/ESTRUTURA_BANCO_DOCUMENTACAO.md`.
