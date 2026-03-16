# Memória: Esforço Atlas Cargo → SaaS

**Guardado em:** 2025-03-06  
**Pedido do usuário:** "Quero que o Atlas Cargo seja, a partir deste momento, SaaS" — estimativa de esforço.

---

## Tamanho do esforço

**Ordem de grandeza: alto — em torno de 4 a 8 meses** (1 dev full-stack), dependendo do nível de isolamento e do escopo da primeira versão.

---

## Resumo por área

| Área | Esforço | Observação |
|------|--------|------------|
| **Multi-tenancy** | **2–4 meses** | Definir “tenant” (ex.: organização); coluna de tenant (ou schema por tenant); garantir que **todas** as consultas/inserts/updates respeitem o tenant. Hoje não há isolamento por tenant; dezenas de rotas/controllers e SQL espalhado. |
| **Auth + tenant** | **2–4 semanas** | Login/signup com contexto de tenant (subdomínio, path ou tenant no body); JWT com `tenant_id`; middleware que exige e injeta tenant em toda requisição. |
| **Ciclo de vida do tenant** | **2–3 semanas** | Cadastro de nova “organização”, primeiro usuário admin, (opcional) dados iniciais. Novas telas/APIs. |
| **Billing/assinatura** | **2–4 semanas** | Integração (ex.: Stripe): planos, checkout, webhooks, (opcional) limite de uso por plano. |
| **Config por tenant** | **1–2 semanas** | Configurações que hoje são globais passarem a ser por tenant (ex.: CONFIGURACAO por tenant). |
| **Testes + segurança + migração** | **1–2 meses** | Revisar vazamento entre tenants, testes E2E, migração dos dados atuais para o modelo multi-tenant. |

---

## Observação

Se **EMPRESA** for reaproveitada como tenant (cada cliente SaaS = uma empresa já existente no modelo) e várias tabelas já tiverem algo como `CDEMPRESA`, o esforço de multi-tenancy pode ser um pouco menor, mas continua grande (padronizar uso de empresa como tenant em todas as rotas e telas).

---

## Estado atual (contexto da estimativa)

- Single-tenant: um banco, um schema, um `.env`.
- Auth: usuário global, JWT sem noção de tenant.
- EMPRESA/FILIAL existem como entidades de negócio (empresas/filiais do cliente), não como fronteira de tenant.
- Controllers/routes com SQL espalhado; sem tenant_id em todas as tabelas.
