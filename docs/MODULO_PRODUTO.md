# Módulos de produto (menu por produto vendido)

## Ideia

- **Plano / contrato** (futuro billing) define o que o cliente comprou.
- **Módulo de produto** (`MODULO_PRODUTO`) agrupa as **funções** do menu (`TIPOATIVIDADE` / `DSPROGRAMA`).
- O usuário continua com **permissões** via `USUARIOATIVIDADE`.

Hoje o catálogo inclui **Torre Logística** (`codigo`: `divulga_cargas_torre`; em instalações antigas pode existir também `divulga`, exibido no painel como o mesmo produto). Novos produtos = novas linhas em `MODULO_PRODUTO` + atividades vinculadas a `CD_MODULO_PRODUTO`.

## Banco

Script: `backend/scripts/modulo_produto_torre_postgres.sql`

- Tabela `MODULO_PRODUTO` (CD_MODULO, CODIGO, NOME, …).
- Coluna `TIPOATIVIDADE.CD_MODULO_PRODUTO` → FK para `MODULO_PRODUTO`.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/menu/modulos` | Módulos em que o usuário tem ao menos uma atividade (header `user-login`). |
| GET | `/api/menu/user-menu?modulo=codigo` | Menu filtrado ao módulo (mesmo header). Sem `modulo` = todas as atividades (legado). |

Se a migração não foi aplicada, `/modulos` retorna `modulos: []` e `legado: true`; o menu usa a query antiga.

## Dashboard

- Sidebar: seletor de módulo quando há **mais de um** módulo disponível.
- Um só módulo: seletor oculto; o filtro ainda usa o código desse módulo.
- Escolha persistida em `sessionStorage` (`atlasProductModuleCodigo`).

## Próximos passos (venda)

- Novo módulo: `INSERT` em `MODULO_PRODUTO`, marcar `TIPOATIVIDADE` do novo produto com `CD_MODULO_PRODUTO` correspondente.
- Amarrar **plano** → módulos (tabela ou extensão de `SAAS_MODULOS_JSON` / billing).
