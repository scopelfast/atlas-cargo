# Documentação da estrutura do banco (local ↔ servidor)

**Objetivo:** Manter o banco do servidor (pgAdmin) alinhado ao banco local. Toda alteração de estrutura feita localmente deve ser documentada em um script SQL executável no servidor.

---

## Regra

- **Qualquer alteração na estrutura do banco** (novas tabelas, colunas, índices, constraints, tipos) feita no ambiente local **deve ser documentada** em um arquivo `.sql` em `backend/scripts/`.
- Esse script deve ser **executável no pgAdmin (ou psql) do servidor**, para evitar que o servidor fique desatualizado e gere erros (ex.: 500 em Cadastro Geral por tabela/coluna inexistente).

---

## Onde colocar os scripts

| Tipo de alteração | Local do script | Nome sugerido |
|-------------------|-----------------|---------------|
| Nova tabela | `backend/scripts/` | `criar_tabela_<nome>_postgres.sql` |
| Novas colunas em tabela existente | `backend/scripts/` | `adicionar_<descricao>_postgres.sql` |
| Índices, FKs, comentários | `backend/scripts/` | `adicionar_<descricao>_postgres.sql` ou junto ao script da tabela |
| Schema completo (referência) | raiz do projeto | `script_db_postgres.sql` (atualizar quando houver mudança estrutural relevante) |

---

## Boas práticas dos scripts

1. **Idempotência:** o script pode ser rodado mais de uma vez sem erro (use `CREATE TABLE IF NOT EXISTS`, `DO $$ ... IF NOT EXISTS (information_schema) ... THEN ALTER TABLE ... END IF; END $$;`).
2. **Target:** PostgreSQL (sintaxe pg), para rodar no pgAdmin do servidor.
3. **Cabeçalho:** no topo do arquivo, comentário com nome do script, objetivo e como executar (ex.: "Executar no banco atlas_cargo_prd no pgAdmin").
4. **Um propósito por arquivo:** um script = uma alteração lógica (uma tabela, um conjunto de colunas relacionadas).

Detalhes e exemplos: ver `backend/scripts/README_ESTRUTURA_BANCO_SERVIDOR.md`.

---

## Fluxo recomendado

1. No **local:** alterar o banco (pgAdmin ou migração) e testar o sistema.
2. **Documentar:** criar ou atualizar o script em `backend/scripts/` que reproduz essa alteração.
3. No **servidor:** após deploy do código, rodar o(s) script(s) no pgAdmin (ou psql) no banco `atlas_cargo_prd`.
4. Opcional: manter `script_db_postgres.sql` atualizado como referência do schema completo.

---

## Erro 500 em GET /api/cadastros-gerais

Se a tela "Gerenciar Cadastro Geral" retornar 500 ao carregar ou filtrar, em geral falta a **coluna PAIS** na tabela **CADASTROGERAL**. No servidor, executar no pgAdmin (banco `atlas_cargo_prd`):

- **Script rápido:** `backend/scripts/fix_500_cadastros_gerais_postgres.sql`
- **Script completo (todos os ajustes):** `backend/scripts/ajustes_postgres_20260301_a_hoje.sql` (já inclui PAIS e suprime NOTICEs com `SET client_min_messages = WARNING`).

## Referência rápida

- Schema base PostgreSQL: `script_db_postgres.sql` (raiz).
- Scripts incrementais: `backend/scripts/*.sql` (especialmente os que têm `_postgres.sql` no nome).
- Regra para o assistente de código: `.cursor/rules/estrutura-banco-documentar.mdc`.
