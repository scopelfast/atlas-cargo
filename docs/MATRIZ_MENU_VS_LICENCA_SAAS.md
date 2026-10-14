# Matriz: menu (`DSPROGRAMA`) × licença SaaS (`SAAS_MODULO.CODIGO`)

Esboço para alinhar **permissão de tela** (Tipos de Atividade + Usuário) com **contrato por tenant** (planos / overrides).  
**Estado atual do código:** só algumas rotas usam `requireTenantModule` — as demais telas dependem só de RBAC até alguém amarrar rota a chave.

---

## 1. Onde a licença é exigida hoje (backend)

| Chave `SAAS_MODULO` / middleware | Arquivo de rotas | Observação |
|----------------------------------|------------------|------------|
| `alertas` | `alert.routes.js` | `router.use(requireTenantModule('alertas'))` |
| `chat` | `message.routes.js` | Idem (`chat`) |
| `ranking` | `reputation.routes.js` | Idem (`ranking`) |
| `sos` | `sos.routes.js` | Idem (`sos`) |
| `mapa_viagem` | `mapa-viagem.routes.js` | Idem (`mapa_viagem`) — **chave com underscore** |

Chaves conhecidas pelo serviço (fallback legado em `tenant-entitlements.service.js`):  
`alertas`, `ranking`, `sos`, `chat`, `mapa_viagem` — somadas às linhas ativas de `SAAS_MODULO`.

---

## 2. Matriz sugerida: `DSPROGRAMA` → chave de licença + prioridade comercial

**Prioridade comercial** (sugestão para roadmap de licenciamento): **Alta** = diferencial / uso diário do cliente; **Média** = operação e cadastros de apoio; **Baixa** = governança da conta ou plataforma (costuma ser “tudo ou nada” no contrato, não upsell por módulo).

Onde a chave está “—”, hoje **não** há `requireTenantModule`; a tela segue só **usuário × tipo de atividade**.

| Prioridade | `DSPROGRAMA` | Chave `SAAS_MODULO` | Proteção API hoje |
|------------|--------------|---------------------|-------------------|
| Alta | `alertas` | `alertas` | Sim |
| Alta | `chat` | `chat` | Sim |
| Alta | `ranking` | `ranking` | Sim |
| Alta | `sos` | `sos` | Sim |
| Alta | `gerenciar-mapa-viagem` | `mapa_viagem` | Sim (pasta ≠ chave: use underscore na licença) |
| Alta | `relatorio-convocacoes` | **`convocacoes`** | Sim — `requireTenantModule('convocacoes')` em `relatorio-convocacoes.routes.js`; coluna `TIPOATIVIDADE.CODIGO_MODULO_LICENCA` + filtro de menu/API |
| Alta | `gerenciar-viagens` | *(opcional futuro, ex.: `viagens`)* | Não |
| Média | `gerenciar-cadastro-geral` | — | Não |
| Média | `gerenciar-estados` | — | Não |
| Média | `gerenciar-mesorregiao` | — | Não |
| Média | `gerenciar-cidades` | — | Não |
| Média | `gerenciar-tipos-validade` | — | Não |
| Média | `gerenciar-equipamentos` | — | Não |
| Média | `gerenciar-marcas` | — | Não |
| Média | `gerenciar-tipos-equipamento` | — | Não |
| Média | `gerenciar-modelos-equipamento` | — | Não |
| Média | `gerenciar-grupos` | — | Não |
| Média | `gerenciar-classes-frota` | — | Não |
| Média | `gerenciar-tipos-viagem` | — | Não |
| Média | `gerenciar-situacoes-viagem` | — | Não |
| Média | `gerenciar-roteiros` | — | Não |
| Média | `gerenciar-tipo-ocorrencia` | — | Não |
| Baixa | `gerenciar-usuarios` | — | Não |
| Baixa | `gerenciar-tipos-atividade` | — | Não |
| Baixa | `gerenciar-empresas` | — | Não |
| Baixa | `gerenciar-filiais` | — | Não |
| Baixa | `gerenciar-configuracoes` | — | Não |
| Baixa | `gerenciar-logs-acesso` | — | Não |
| Baixa (plataforma) | `gerenciar-tenants-saas` | — | Não: `/api/saas/*` = **`requireSaaSAdmin`**, não linha de `SAAS_MODULO` do tenant cliente |

**Regra prática:**  
- **Chave de licença** = o que entra em `SAAS_PLANO_MODULO` / override e o que `isModuleEnabledForTenant` consulta.  
- **`DSPROGRAMA`** = o que o dashboard carrega em `/modulos/{programa}/index.html` e o que você marca em **Acessos**.  
- **`TIPOATIVIDADE.CODIGO_MODULO_LICENCA`** (nullable) = quando preenchido com uma chave de `SAAS_MODULO`, o item **não aparece** no menu nem em `GET /api/atividades` para usuários cujo tenant não tenha o módulo (operador **SaaS admin** continua vendo tudo para suporte). Script: `backend/scripts/tipoatividade_codigo_modulo_licenca_postgres.sql`.

---

## 3. Painel “Operação SaaS” vs licença do cliente

| Conceito | O que é |
|----------|---------|
| Ver o menu **Tenants e módulos (SaaS)** | Usuário precisa da atividade com `DSPROGRAMA = gerenciar-tenants-saas` |
| Chamar **API** de cadastro de planos / clientes | Mesmo critério: `requireSaaSAdmin` (vínculo usuario–atividade acima) |
| O **tenant cliente** ter Alertas no plano | `SAAS_MODULO` + plano / override; usuários **desse** tenant não “compram” pelo mesmo critério do admin |

Ou seja: **operar SaaS** é permissão de **usuário interno**; **usar Alertas no dia a dia** é **licença do tenant** + usuário com atividade `alertas`.

---

## 4. Próximos passos (se quiser fechar o produto)

1. Cadastrar em `SAAS_MODULO` apenas chaves que existem em rota ou vão existir.  
2. Para cada nova chave, decidir o `DSPROGRAMA` equivalente e (opcional) esconder item de menu se `getEntitlementsForTenant` vier falso — hoje o front pode consultar config que já espelha módulos.  
3. Rotas sem `requireTenantModule` continuam **abertas por tenant** do ponto de vista de licença: o isolamento é `tenant_id` nas queries, não o plano.

A chave **`convocacoes`** está no catálogo (`saas_estrutura_*` / script de migração), no plano Completo, com `requireTenantModule` nas rotas do relatório e vínculo sugerido em `TIPOATIVIDADE` via `CODIGO_MODULO_LICENCA`.

---

## 5. Cadastro de usuário, tenant e “master”

### Implementado (API + Gerenciar Usuários)

| Item | Comportamento |
|------|----------------|
| **`GET /api/usuarios/contexto`** | Retorna `{ saasAdmin, tenantId }` — `saasAdmin` = usuário tem atividade `gerenciar-tenants-saas`. |
| **Listagem / grid** | Inclui **`TENANT_ID`**. Quem **não** é SaaS admin só vê usuários do **mesmo tenant** do JWT. |
| **Criar / editar usuário** | **SaaS admin:** select de tenants (`default` + `GET /api/saas/clientes`). **Demais:** campo somente leitura com o tenant do próprio login; novos usuários recebem esse `TENANT_ID` no servidor. |
| **Acessos, empresas, filiais, status** | Mesmo isolamento: só SaaS admin ou usuário do **mesmo tenant** que o alvo. |
| **Atualizar `TENANT_ID`** | Só enviado/processado quando o solicitante é **SaaS admin**. |

“**Master**” do cliente continua sendo **política + conjunto de atividades**; não há flag “administrador do tenant” no banco.

### Backlog opcional

1. Papel explícito (`FG_PERFIL` / tabela de papéis) restringindo quais atividades um “admin tenant” pode conceder.  
2. Provisionamento automático ao criar cliente em Operação SaaS (usuário inicial + atividades mínimas).
