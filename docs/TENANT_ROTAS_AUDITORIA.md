# Auditoria de Rotas para SaaS Multi-Tenant (Seguranca)

Inventario inicial de rotas HTTP do backend para priorizar ajustes de isolamento entre tenants.

Escopo deste documento:

- mapear onde ja existe autenticacao;
- identificar superficies de maior risco para vazamento cross-tenant;
- definir ordem de correcao por impacto.

## 1) Mapa de montagem das rotas

Em `backend/app.js`, o backend registra grande parte dos endpoints em `/api` (incluindo aliases como `/api/chat`, `/api/alertas`, `/api/ranking`) e rotas especificas como `/api/motorista`, `/api/logs-acesso`, `/api/mapa-viagem`.

Tambem existe middleware global `getUsuarioLogado` em `/api` e `/cargas/api`, porem ele e **nao bloqueante** (pode deixar `req.user = null`).

## 2) Classificacao de risco (tenant/security)

### Criticidade A (alta prioridade)

Rotas com dados operacionais/sensiveis, ou que hoje dependem de autenticacao parcial:

- `backend/routes/message.routes.js`
  - **Atual (2026-04):** `requireMotoristaOrTowerAuth` + `attachTenantContext` em todas as rotas do modulo;
  - controllers devem manter filtros por `TENANT_ID` nas queries (revisar ao evoluir SQL).
- `backend/routes/viagemmestre.routes.js`
  - concentrador de viagens/convocacoes/webhooks/logs;
  - possui endpoints publicos (`/public/convocacao/...`) e endpoints administrativos na mesma area.
- `backend/routes/motorista-app.routes.js`
  - mistura rotas publicas de login/cadastro com area protegida por `requireMotoristaAuth`.
- `backend/routes/sos.routes.js`
  - possui uma rota de criacao de SOS sem `requireAuth` (`POST /motorista/sos`) e restante protegido.
- `backend/server.js` (Socket.io)
  - conexoes realtime/salas precisam validacao de tenant antes de entrar em sala.

### Criticidade B (media prioridade)

Rotas de configuracao, reputacao e monitoramento:

- `backend/routes/config.routes.js`
- `backend/routes/reputation.routes.js` (usa `requireAuth`, falta ainda escopo tenant em consultas)
- `backend/routes/logs-acesso.routes.js`
- `backend/routes/usuariologacao.routes.js`

### Criticidade C (estrutural, ampla cobertura)

Rotas de cadastros e tabelas mestre em `/api` que, no estado atual, nao evidenciam middleware de autenticacao no proprio arquivo:

- `marcas`, `grupo`, `classefrota`, `tipoviagem`, `situacaoviagem`, `tipoequipamento`,
  `modeloequipamento`, `equipamento`, `mesorregiao`, `cidades`, `roteiros`, `estado`,
  `estados`, `cadastrogeral`, `empresa`, `filial`, `usuario`, `tipoatividade`,
  `tipoocorrencia`, `tipovalidade`, `controlevalidade`, `mapa-viagem`.

Observacao: parte dessas rotas pode depender de controles em controller/SQL, mas para SaaS multi-tenant isso nao e suficiente sem padrao unificado de `tenant_id`.

## 3) Pontos de ajuste imediato (maiores ganhos de seguranca)

### 3.1 Padrao unico de autenticacao + tenant context

Criar middleware central de tenant (ex.: `tenant.middleware.js`) com regras:

- extrair `tenant_id` a partir de token assinado e validar associacao usuario-tenant;
- rejeitar requisicao sem tenant valido para rotas de negocio;
- anexar `req.tenant` e `req.authz` (role/scope).

Aplicar antes dos controllers de negocio em `backend/app.js`.

### 3.2 Endurecer rotas de chat/mensageria

`backend/routes/message.routes.js` deve migrar de `getUsuarioLogado` para autenticacao obrigatoria nas operacoes de leitura/gravação.

Regras minimas:

- listar conversa apenas se pertence ao tenant do usuario;
- upload/transcricao vinculados a tenant e usuario;
- buscar por viagem somente se viagem pertence ao tenant.

### 3.3 Separar publico vs privado em viagens

`backend/routes/viagemmestre.routes.js` hoje mistura muitos contextos.

Ajustes:

- manter endpoints `public/*` em router separado;
- explicitar politica de token/chave publica com expiracao curta;
- rotas administrativas e operacionais sob tenant auth obrigatoria.

### 3.4 Revisar superficie de SOS e motorista

- `backend/routes/sos.routes.js`: validar se `POST /motorista/sos` deve ser publico; se sim, exigir mecanismo assinado vinculado ao tenant.
- `backend/routes/motorista-app.routes.js`: garantir que IDs de motorista/viagem em path sempre batam com `req.user` e `req.tenant`.

### 3.5 Bloquear rotas de init SQL em ambiente produtivo

Foram encontrados multiplos endpoints `executar-init-sql` em rotas de negocio.

**Implementado:** `blockDangerousEndpointsInProduction` (alias `blockExecutarInitSqlInProduction`) em `backend/middleware/security-hardening.middleware.js`, em `app.js` — em `NODE_ENV=production`: **403** para `POST` com `/executar-init-sql` ou `/executar-query`, e `GET` com `/debug-rotas`.

Pendente (opcional): role superadmin + allowlist de IP para ambientes nao-producao; mover execucao para job operacional.

## 4) Matriz de controle por rota (modelo para preenchimento)

Use esta matriz para cada arquivo em `backend/routes`:

| Arquivo | Prefixo | Auth atual | Tenant check atual | Risco | Acao |
|---|---|---|---|---|---|
| `message.routes.js` | `/api/messages` e `/api/chat` | obrigatorio (`requireMotoristaOrTowerAuth`) | `attachTenantContext` + SQL por tenant | Medio | testes IDOR + revisao pontual de queries |
| `viagemmestre.routes.js` | `/api` | heterogeneo | ausente/pontual | Alto | separar publico/privado + tenant em todas queries |
| `motorista-app.routes.js` | `/api/motorista` | misto (`public` + `requireMotoristaAuth`) | **fechado (ver SS7)** | Medio | manter ao adicionar rotas |
| `sos.routes.js` | `/api/sos` | majoritariamente `requireAuth` | parcial | Alto | revisar rota publica e isolamento |
| `config.routes.js` | `/api` | nao explicitado no arquivo | ausente/pontual | Medio | exigir auth/role + tenant para leitura/escrita |
| demais cadastros | `/api` | nao explicitado no arquivo | ausente/pontual | Medio | padronizar tenant query layer |

## 5) Plano de execucao (curto prazo)

1. Implementar `requireTenantAuth` e integrar em `backend/app.js`.
2. Corrigir primeiro: `message`, `viagemmestre`, `motorista-app`, `sos`. *(Motorista: fechado — secao 7; `message`: auth obrigatoria; SOS: revisar pontualmente rota publica.)*
3. Bloquear `executar-init-sql` em producao. *(Feito: middleware global.)*
4. Criar testes de isolamento cross-tenant para 10 rotas criticas.
5. Expandir para cadastros (fase 2), com revisao de SQL por `tenant_id`.

## 6) Criterio de aceite de seguranca

Considerar o backend apto para fase SaaS quando:

- nenhuma rota de negocio processa dados sem `req.tenant` validado;
- nao ha consulta de dados sensiveis sem filtro de tenant (direto ou indireto auditavel);
- testes automatizados cobrem tentativas de acesso entre tenants e falham com 403/404;
- endpoints administrativos perigosos (`executar-init-sql`, similares) nao estao expostos para operacao comum.

Em **producao**, `blockDangerousEndpointsInProduction` bloqueia `executar-init-sql`, `executar-query` e `debug-rotas` (`security-hardening.middleware.js`).

---

## 7) Estado atual (2026-04) — o que ja existe e o que falta

### FECHADO — escopo App Motorista + APIs correlatas (IDOR / tenant)

Este pacote considera **entregue** o endurecimento do `/api/motorista` e rotas auxiliares usadas pelo app e pela torre na mesma sessao JWT.

| Area | O que foi feito |
|------|-----------------|
| Contexto | `attachTenantContext` apos `requireMotoristaAuth`; `tenantIdForRequest` em `backend/utils/tenant-context.js` (inclui `req.user.tenantId`). |
| JWT | `tipo` no payload exposto em `req.user` (`requireMotoristaAuth`, `requireMotoristaOrTowerAuth`) para distinguir motorista vs torre. |
| Viagem | Util `backend/utils/viagem-tenant-access.js`: `assertViagemTenantAccess` — viagem com `TENANT_ID`; motorista so acessa se existir em `VIAGEMMOTORISTA`. Usado em validar macro, historico de macros, posicoes, motorista da viagem, GPS com viagem, macros, eventos, delivery-proof. |
| Perfil / convocacoes / viagens | `assertSameMotorista` + filtros `TENANT_ID` onde aplicavel (iteracoes anteriores). |
| Notificacoes | `assertSameMotorista` + `TENANT_ID` em `CONVERSAS` / `MESSAGES` / `CONVOCACAO` / joins. |
| Alterar senha | `assertSameMotorista` + `CADASTROGERAL.TENANT_ID`. |
| SOS historico (motorista) | ID apenas de `req.user` (sem query override). |
| Delivery proof | Salvar/listar/foto escopados por tenant e, para motorista, por `VIAGEMMOTORISTA`. |
| Endpoints perigosos em producao | `blockDangerousEndpointsInProduction` em `app.js`: 403 em `POST .../executar-init-sql`, `POST .../executar-query`, `GET .../debug-rotas`. |
| Licenca por modulo (SaaS) | `CONFIGURACAO.SAAS_MODULOS_JSON` + `requireTenantModule` em alertas, ranking, SOS, chat, mapa-viagem; `GET /api/configuracoes/saas-modulos`. Ver `docs/SAAS_MODULOS_LICENCA.md`. |

**Fora deste fechamento (aceitavel):** `listarMacros` le `TIPOOCORRENCIA` sem `TENANT_ID` (tabela mestre compartilhada — alinhado a pendencia de cadastros globais abaixo).

### Implementado no codigo (geral SaaS — continua valido)

- **JWT**: login em `auth.controller.js` inclui `tenantId` no payload (origem: `USUARIO.TENANT_ID` ou `DEFAULT_TENANT_ID` / `.env`).
- **HTTP**: `attachTenantContext` em `/api` + `tenant.middleware.js` define `req.tenantId` quando ha usuario autenticado.
- **Torre (dashboard)**: `towerAuthAndTenant` (`requireAuth` + `attachTenantContext`) aplicado na maioria dos routers de CRUD em `backend/routes/*.routes.js`.
- **Configuracao por tenant**: `tenantIdForRequest` + coluna `TENANT_ID` em `CONFIGURACAO` (upserts, leituras).
- **Script SQL**: `backend/scripts/adicionar_tenant_id_fase2_postgres.sql` — coluna `TENANT_ID` em dezenas de tabelas operacionais + indices em `VIAGEMMESTRE`, `CONVOCACAO`, `CADASTROGERAL`, `MESSAGES`.
- **Chaves compostas (scripts separados)**: ex. `configuracao_pk_composta_tenant_postgres.sql`, `driver_reputation_pk_composta_tenant_postgres.sql`.
- **Isolamento em servicos criticos**: ex. `message.controller.js`, `viagemmestre.controller.js` (muitas queries com `TENANT_ID`), `reputation-service.js`, `websocket-torre.service.js` + `socket-tenant.service.js` (salas por tenant).
- **Config — mutacoes protegidas**: `config.routes.js` usa `towerAuthAndTenant` em todos os `PUT`/`POST` que alteram configuracoes (mapa, contexto, app motorista, OpenAI, mensagens, Switch, alertas, identidade) e em `GET /mapa/rota-osrm`; leituras publicas (`GET /contexto`, `GET /configuracoes/*` sem auth) continuam para fluxos que precisam de defaults — revisar se alguma leitura sensivel deve exigir login.
- **Chat (`message.routes.js`)**: autenticacao obrigatoria + `attachTenantContext` (ver secao 2 atualizada).

### Pendencias recomendadas (backlog pos-motorista)

1. **Queries restantes**: revisar controllers que ainda misturam SQL Server e PostgreSQL e garantir `TENANT_ID` em **todas** as leituras/escritas de negocio fora do escopo ja coberto (matriz do plano).
2. **Cadastros mestre globais**: tabelas como `CIDADE`, `PAIS`, `ESTADO`, `TIPOOCORRENCIA` — decisao de produto (compartilhadas vs `TENANT_ID`) + migracao se for por tenant.
3. **Testes automatizados**: testes de isolamento cross-tenant (403/404) nas rotas criticas (checklist em `docs/PLANO_SAAS_MULTITENANT_SEGURANCA.md`).
4. **Producao**: CORS/socket origens fixas; rate limit por tenant; auditoria estruturada com `tenant_id`.
5. **UNIQUE/FK**: completar ajustes onde ainda houver unicidade global incompativel com multi-tenant (ex. documentos por tenant).
6. **Viagemmestre / publicos**: separar e documentar endpoints `public/*` e tokens de convocacao (risco residual Alto na matriz).

---

Ultima atualizacao secao 7: 2026-04 — fechamento escopo motorista documentado.
