# Plano SaaS Multi-Tenant — Foco em segurança (SysScopel)

Documento de **planejamento** para evolução do SysScopel em direção a **SaaS multi-tenant**, com ênfase em **isolamento de dados** e **superfície de ataque**. Não substitui análise de ameaças formal; serve para alinhar **o quê** e **onde** mexer no código e no banco.

---

## 1. Objetivo de segurança (o que “total” significa na prática)

Em multi-tenant, o risco número 1 é **IDOR / vazamento entre tenants** (usuário ou integração acessar dados de outro cliente).

**Meta técnica:**

- Toda leitura/gravação de dados de negócio deve ser **inequivocamente limitada** ao `tenant_id` autorizado.
- O `tenant_id` **não** pode ser apenas “confiança no cliente” (header/query); deve vir de **sessão/JWT assinado** ou resolução servidor-side (subdomínio + validação).
- Rotas administrativas globais (se existirem) devem ser **separadas** e protegidas com papéis explícitos.

---

## 2. Panorama do código atual (pontos de atenção)

Com base na estrutura do repositório:

| Área | Onde | Observação para SaaS |
|------|------|----------------------|
| Entrada HTTP | `backend/app.js` | `getUsuarioLogado` em `/api` e `/cargas/api` — JWT opcional em muitos fluxos; precisa evoluir para **contexto de tenant** sempre que houver dado sensível. |
| Autenticação | `backend/middleware/auth.middleware.js` | `requireAuth`, `requireMotoristaAuth`, token também via `x-token` / `query.token` — em SaaS, revisar **transporte do token** (preferir só `Authorization` em APIs). |
| Rotas | `backend/routes/*.routes.js` | Cobertura **heterogênea**: algumas rotas usam `requireAuth`, outras só `getUsuarioLogado` — risco de endpoint “esquecido” sem tenant. |
| Motorista | `backend/routes/motorista-app.routes.js` | Sessão ativa (`requireMotoristaAuth`) — ao multi-tenant, motorista/viagem precisa amarrar **tenant** + **política de escopo** (qual frota/empresa). |
| Tempo real | `backend/server.js` | Socket.io com `cors.origin: "*"` — em produção SaaS, **CORS/origem** e **autenticação de socket** por tenant/sala precisam ser endurecidos. |
| Serviços | `backend/services/*.js` | Lógica de negócio e jobs — maior risco de esquecer `WHERE tenant_id = ?` se o isolamento não for centralizado. |
| Front dashboard | `backend/public/modulos/**` | Chamadas à API precisam assumir **tenant no token** ou **host/subdomínio**; evitar IDs manipuláveis só no front. |
| Scripts SQL | `backend/scripts/`, `script_db_postgres.sql` | Toda mudança estrutural deve ser **idempotente** e documentada (ver regra do projeto em `.cursor/rules/estrutura-banco-documentar.mdc`). |

---

## 3. Maiores ajustes (por impacto)

### 3.1 Banco de dados — **maior esforço e maior risco se mal feito**

**O quê:** modelo **shared database + `tenant_id`** (recomendado para começar) ou evolução para schema/DB por tenant depois.

**Onde:**

- Migrações em `backend/scripts/` (novos scripts `adicionar_*_postgres.sql` / `criar_tabela_*_postgres.sql`).
- Tabelas de negócio que hoje não têm escopo explícito de “organização cliente” precisam de coluna `tenant_id` (ou vínculo indireto **100% garantido** por FK + índice).

**Segurança:**

- `UNIQUE` e `FOREIGN KEY` devem considerar `tenant_id` onde fizer sentido (evitar colisão de códigos entre tenants).
- Índices: `(tenant_id, ...)` nas consultas mais frequentes.
- Job de migração: dados legados → tenant **default** controlado (não “adivinhar” tenant).

---

### 3.2 Camada de acesso — **segundo maior impacto**

**O quê:** um **único lugar** que define o tenant da requisição e políticas (ativo, suspenso, plano).

**Onde (sugestão de desenho):**

- Novo middleware: `backend/middleware/tenant.middleware.js` (nome ilustrativo).
- Ajuste em `backend/middleware/auth.middleware.js` para incluir no JWT claims: `tenant_id`, `role`, `jti` (se necessário).
- `backend/app.js`: ordem dos middlewares — **depois** de autenticação, **antes** dos controllers.

**Regras:**

- **Nunca** aceitar `tenant_id` só do body/query sem validar contra o usuário logado (exceto fluxos de super-admin com auditoria).

---

### 3.3 Controllers e services — **maior superfície de bugs**

**O quê:** hoje a lógica está espalhada em `backend/controllers/*.controller.js` e `backend/services/*.js`. Em multi-tenant, o padrão “cada dev lembra do WHERE” **não escala**.

**Estratégias (escolher uma e padronizar):**

1. **Repositório / query helper** que exige `tenant_id` em todas as queries SQL.
2. **Wrappers** de pool/query que injetam `tenant_id` automaticamente (cuidado com SQL dinâmico e raw queries).
3. **Revisão sistemática** rota a rota + testes de regressão de isolamento.

**Onde:** praticamente todos os controllers que tocam PostgreSQL; priorizar módulos com dados sensíveis: viagens, motoristas, chat, alertas, SOS, configurações.

---

### 3.4 WebSocket / eventos em tempo real — **alto risco de vazamento**

**O quê:** salas (`join-viagem`, etc.) precisam validar que o `idviagem` pertence ao **mesmo tenant** do socket.

**Onde:**

- `backend/server.js` (handlers `io.on('connection')` e serviços associados, ex.: `backend/services/websocket-torre.service.js` se usado).
- Autenticação de socket: token na conexão + mesma origem CORS restrita em produção.

---

### 3.5 App motorista e APIs públicas — **superfície ampliada**

**O quê:** fluxos mobile/offline e uploads podem contornar pressupostos do dashboard.

**Onde:**

- `backend/routes/motorista-app.routes.js`, `backend/public/motorista/**`.
- Garantir que motorista só acesse viagens/dados do **tenant** correto (e que tokens não sejam reutilizáveis entre ambientes sem `aud`/`iss` claros, se evoluir o JWT).

---

### 3.6 Front-end (dashboard e módulos) — **consistência e UX**

**O quê:** exibir tenant ativo, bloquear ações quando plano/limites excedidos, não confiar em IDs vindos da URL sem checagem no backend.

**Onde:**

- `backend/public/dashboard.html`, `backend/public/js/dashboard.js`, `backend/public/modulos/**/js/script.js`.

---

## 4. Checklist de segurança multi-tenant (mínimo viável)

- [ ] **Tenant resolution** server-side (JWT claim validado ou subdomínio + lookup).
- [ ] **Todas** as queries de negócio com escopo `tenant_id` (ou equivalente auditável).
- [ ] **Testes automatizados** tentando acessar recurso de outro tenant (matriz de rotas críticas).
- [ ] **Autorização** por papel (owner/admin/operador) **dentro** do tenant.
- [ ] **Auditoria**: log estruturado com `tenant_id`, `user_id`, ação, entidade, IP (LGPD + incident response).
- [ ] **Rate limit** por IP e por tenant em APIs sensíveis.
- [ ] **Segredos**: rotação de `JWT_SECRET`, sem fallback fraco em produção (revisar `server.js` e política de env).
- [ ] **CORS/Socket.io**: origens explícitas em produção; evitar `*`.
- [ ] **Uploads / arquivos**: path e URL não vazam arquivos de outro tenant.
- [ ] **Backups e exclusão**: procedimento de delete tenant (LGPD).

---

## 5. Ordem sugerida de implementação (reduz risco)

1. **Modelo de dados** + migração segura + tenant default para legado.  
2. **JWT + middleware de tenant** + testes de token.  
3. **Endurecer rotas** (padronizar `requireAuth` + tenant onde aplicável).  
4. **Refatorar services** prioritários (viagens, motorista, mensagens, alertas).  
5. **WebSocket** com validação de tenant na entrada da sala.  
6. **Hardening** CORS, rate limit, auditoria, observabilidade.

---

## 6. Entregáveis recomendados (documentação viva)

| Entregável | Finalidade |
|------------|------------|
| Este arquivo (`docs/PLANO_SAAS_MULTITENANT_SEGURANCA.md`) | Visão e prioridades. |
| `docs/TENANT_MODELAGEM.md` (a criar) | DER lógico: entidades `tenants`, usuários, assinaturas, limites. |
| `docs/TENANT_ROTAS_AUDITORIA.md` (a criar) | Inventário rota a rota: auth atual, dados tocados, risco, status. |
| Scripts em `backend/scripts/` | Migrações idempotentes alinhadas à política do servidor. |

---

## 7. Próximo passo prático no repositório

1. Definir **uma** estratégia inicial: **shared DB + `tenant_id`** (recomendado).  
2. Listar **20–30 tabelas** mais críticas e mapear onde entra `tenant_id` direto ou via FK.  
3. Implementar **middleware + claim JWT** antes de refatorar centenas de queries.  
4. Criar **testes de isolamento** para as 10 rotas mais sensíveis (primeiro falha, depois corrige).

---

*Última atualização: planejamento inicial baseado na estrutura do repositório SysScopel (`backend/app.js`, `backend/middleware/auth.middleware.js`, `backend/server.js`). Ajustar conforme decisões de produto (subdomínio vs path, billing, LGPD).*
