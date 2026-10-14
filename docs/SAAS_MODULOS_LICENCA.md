# Licença de módulos por tenant (SaaS)

## O que é

Cada **cliente** (`TENANT_ID`) pode ter um subconjunto de módulos contratados. O backend **obriga** isso nas APIs: se o módulo estiver desligado no contrato, as rotas daquele módulo respondem **403** (`errorKey: saas.moduloNaoDisponivel`).

Isso é **independente** das permissões por usuário (`USUARIOATIVIDADE` / menu): primeiro o contrato do tenant permite o módulo; depois o usuário precisa ter atividade liberada.

## Onde fica gravado

Tabela `CONFIGURACAO`, chave fixa **`SAAS_MODULOS_JSON`**, valor JSON por tenant.

Exemplo:

```json
{
  "alertas": true,
  "ranking": false,
  "sos": true,
  "chat": true,
  "mapa_viagem": true
}
```

- Chave **omitida** ou linha **inexistente** → tratado como **habilitado** (comportamento legado).
- Chave explícita **`false`** → módulo desligado.

Script inicial: `backend/scripts/init_saas_modulos_config_postgres.sql`.

## Módulos (chaves)

| Chave          | Rotas protegidas (resumo)        |
|----------------|----------------------------------|
| `alertas`      | `/api/alerts`, `/api/alertas`    |
| `ranking`      | `/api/reputation`, `/api/ranking` |
| `sos`          | `/api/sos` (exceto `POST …/motorista/sos` legado sem JWT) |
| `chat`         | `/api/messages`, `/api/chat`     |
| `mapa_viagem`  | `/api/mapa-viagem`               |

## Código

- Serviço: `backend/services/tenant-entitlements.service.js` (cache ~60s por tenant).
- Middleware: `requireTenantModule('chave')` em `backend/middleware/tenant-module.middleware.js`.
- Leitura para o dashboard: `GET /api/configuracoes/saas-modulos` (JWT torre + tenant).

## Venda / operação

- **Onboarding**: após criar o tenant, inserir ou atualizar `CONFIGURACAO` com `SAAS_MODULOS_JSON` conforme o plano vendido.
- **Alteração de plano**: atualizar o JSON e aguardar até 60s (cache) ou reiniciar o processo Node.

Futuro opcional: painel interno “superadmin”, integração com billing, ou `PUT` restrito por papel.
