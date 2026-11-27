# Atlas Pay — Fase 4: Proposta técnica (Inadimplência inteligente)

**Data:** 26/11/2026  
**Ambiente de referência:** `atlas_cargo_prd` local / HML operacional  
**Status:** **Proposta para aprovação — sem implementação, sem SQL, sem alteração de P0/P1/P2/Fase 3**

Pré-requisitos assumidos concluídos: Fases 1–2, P0, P1, P2, Fase 3.  
Base de produto já escrita: `docs/PLANO_MODULO_FINANCEIRO.md` (seção “Alerta e bloqueio”).

---

## 0. Veredito de auditoria

| Item | Situação atual |
| --- | --- |
| `FIN_CONTRATO.POLITICA_INADIMPLENCIA` | Existe (`ALERTA` \| `BLOQUEIO`), default `ALERTA` |
| Enforcement operacional | **Ausente** — nenhum gate em aceite, campanha, publicação ou confirmação |
| Status `VENCIDA` | **Não existe** no CHECK (`ABERTA` \| `PAGA` \| `CANCELADA`); vencimento = `DH_VENCIMENTO` |
| Separação pagador | Já modelada: `PAGADOR_TIPO` = `MOTORISTA` \| `TENANT` |
| Isolamento login/estoque/mapa | Sem acoplamento FIN hoje (exceto confirmação ↔ cobrança na mesma TX) |

---

## 1. Mapa dos pontos de integração

### 1.1 Motorista — aceitar ofertas

| Ponto | Evidência |
| --- | --- |
| Aceite de convocação | `POST /api/motorista/aceitar-convocacao/:id` → `motorista-app.controller.js`:`aceitarConvocacao` |
| Aceite de carga | `POST /api/motorista/aceitar-carga/:idviagem` → `aceitarCarga` |
| Lista de ofertas | `GET /api/motorista/convocacoes/:idmotorista` → `minhasConvocacoes` (alerta no app) |

**Gate BLOQUEIO motorista:** recusar novos aceites. **ALERTA:** permitir + toast/banner.

### 1.2 Motorista — campanhas / oportunidades

| Ponto | Evidência |
| --- | --- |
| Interesse público | `POST /api/oportunidades-publicas/:token/interesse` → `oportunidades-campanhas.controller.js`:`publicoInteresse` |
| Detalhe do link | `GET /api/oportunidades-publicas/:token` |

**Gate BLOQUEIO motorista:** bloquear interesse/`ACEITA` via link. Campanha já criada pela torre não é desfeita.

### 1.3 Torre — publicar ofertas

| Ponto | Evidência |
| --- | --- |
| Criar viagem | `POST /api/viagens` → `viagemmestre.controller.js`:`criar` |
| Disparar convocações | `POST /api/convocacoes` → `criarConvocacoes` |
| Campanha | `POST /api/oportunidades-campanhas`, `POST .../:id/disparar` |
| UI | `gerenciar-viagens`, `campanhas-oportunidades` |

**Gate BLOQUEIO tenant:** impedir publicação/disparo novo. Não apaga viagem existente.

### 1.4 Torre — confirmar motoristas

| Ponto | Evidência |
| --- | --- |
| Confirmar | `POST /api/convocacoes/:id/confirmar` → `confirmarConvocacao` |
| Cobrança conexão (já existe) | mesma TX → `criarCobrancaConexaoNaConfirmacao` |

**Gate BLOQUEIO tenant:** antes da TX de confirmação. Viagem já `CONFIRMADA` segue.

### 1.5 Administração / consulta (sem gate de bloqueio operacional)

| Área | Path | Nota |
| --- | --- | --- |
| Atlas Pay | `modulos/atlas-pay/` | Política, lista, baixa, cancelar |
| Mapa / estoque / WMS / auth | respectivos módulos | **Fora do bloqueio** |
| Cobranças API | `GET /api/financeiro/cobrancas`, `/resumo`, `/cobrancas/:id` | Fonte da verdade da dívida |

### 1.6 Diagrama lógico (integração)

```text
                    ┌─────────────────────────────┐
                    │  avaliadorInadimplencia()   │
                    │  (só leitura FIN_COBRANCA +  │
                    │   política do contrato)     │
                    └──────────────┬──────────────┘
           MOTORISTA               │               TENANT
    ┌───────────────┐              │          ┌────────────────┐
    │ aceite app    │              │          │ criar/disparar │
    │ aceite carga  │◄── ALERTA/───┤──ALERTA/─►│ convocação     │
    │ interesse     │   BLOQUEIO   │ BLOQUEIO │ confirmar      │
    │ campanha      │              │          │ campanha       │
    └───────────────┘              │          └────────────────┘
                                   │
                    NÃO entra: login, estoque, mapa,
                    viagem já confirmada, sessão ativa
```

---

## 2. Regras de inadimplência e cálculo de situação

### 2.1 Definições

| Conceito | Regra proposta |
| --- | --- |
| Dívida ativa | `FIN_COBRANCA.STATUS = 'ABERTA'` |
| Vencida (derivada) | `ABERTA` **e** `DH_VENCIMENTO < agora_SP` — **sem novo STATUS** na v1 (evita migration de CHECK) |
| Em aberto (alerta/bloqueio) | Qualquer `ABERTA` do pagador sob política vigente (vencida ou não). Opcional: só vencidas — **decisão a fechar na aprovação** (recomendação: qualquer `ABERTA`, alinhado ao plano “em aberto”) |
| Política | Do **contrato vigente** do tenant da operação (`POLITICA_INADIMPLENCIA`). Default `ALERTA` |
| Situação motorista | Existe ≥1 `ABERTA` com `PAGADOR_TIPO='MOTORISTA'` e `PAGADOR_CDCADASTRO = cdMotorista` |
| Situação tenant | Existe ≥1 `ABERTA` com `PAGADOR_TIPO='TENANT'` e `PAGADOR_TENANT_ID = tenantId` |
| Escopo da dívida motorista | Por cadastro motorista; tipicamente conexão (`MODALIDADE='CONEXAO'`) no tenant da operação |
| Escopo da dívida tenant | Uso plataforma (`USO_PLATAFORMA`) e demais `PAGADOR_TIPO='TENANT'` |

### 2.2 Exceções obrigatórias (não negociáveis nesta proposta)

1. **Não bloquear `default`** por cobrança em que `PAGADOR_TENANT_ID = 'default'` (dívida contra si / beneficiário plataforma).
2. Dívida **motorista** ≠ bloqueio do **agenciador**.
3. Dívida **agenciador** ≠ bloqueio do **motorista**.
4. Política `ALERTA` → **nunca** HTTP de bloqueio operacional; só UI/aviso.
5. Não cancelar viagem confirmada; não derrubar sessão; não apagar cadastro/cobrança.

### 2.3 Função única (novo serviço, sem segundo sistema)

Proposta: `backend/services/financeiro-inadimplencia.service.js`

```text
avaliarPagador({ tipo: 'MOTORISTA'|'TENANT', id, tenantContexto })
  → {
      politica: 'ALERTA'|'BLOQUEIO'|null,  // null = sem contrato / regra N: tratar como sem enforcement
      temDebito: boolean,
      qtdAbertas, qtdVencidas,
      totalCentavosAbertas,
      modo: 'LIBERADO'|'ALERTA'|'BLOQUEADO',
      motivoCode: 'FIN_INADIMPLENTE'|null
    }
```

- Leitura apenas; **sem** tabela de “flag de bloqueio”.
- Reversibilidade = próxima avaliação após `PAGA`/`CANCELADA`.
- Contrato com `FG_REGRA_ATIVA='N'`: **sem enforcement** (só diagnóstico opcional), coerente com Fases 1–3.

---

## 3. Arquitetura de alertas

| Canal | Quem | Onde | Conteúdo |
| --- | --- | --- | --- |
| Toast SysScopel (`showMessage`) | Torre | Após gate ALERTA em publicar/confirmar; Atlas Pay resumo | “Há cobranças em aberto…” |
| Banner no módulo Atlas Pay | Torre | Visão geral / Cobranças | Contagem ABERTA + link filtro |
| Banner/aviso no app motorista | Motorista | Lista de convocações / aceite | Texto curto + não bloqueia se ALERTA |
| Link público campanha | Motorista | Resposta de `publicoInteresse` / detalhe | Mensagem na API JSON (sem `alert()` nativo) |
| WhatsApp | — | **Fora da v1** (plano: “alerta nasce na tela”; Switch numa fase seguinte) |

Códigos de resposta sugeridos (ALERTA não falha a operação):

- Header ou campo `warning: { code: 'FIN_INADIMPLENTE_ALERTA', ... }` no JSON de sucesso; UI mostra toast.

---

## 4. Arquitetura de bloqueio reversível

### 4.1 Comportamento

| Política | Motorista com débito | Tenant com débito |
| --- | --- | --- |
| `ALERTA` | Opera + aviso | Opera + aviso |
| `BLOQUEIO` | HTTP **403** nos gates de aceite/campanha; `code: FIN_INADIMPLENTE_BLOQUEIO` | HTTP **403** em publicar/disparar/confirmar |

### 4.2 O que **não** bloqueia

Login/JWT, mapa, estoque/WMS, consulta de viagens, edição cadastral, viagem já confirmada, usuários já logados (sem logout forçado), tenant `default` na exceção §2.2.

### 4.3 Reversão imediata

Não há cache persistente obrigatório. Após:

- `POST /cobrancas/:id/baixa`
- `POST /cobrancas/:id/cancelar`
- `cancelarCobrancaConexaoNaTransacao` (reativar / desistir lote)

…a próxima chamada a `avaliarPagador` já retorna `LIBERADO`.  
Opcional v1.1: invalidar cache em memória (TTL curto) se houver cache só de performance.

### 4.4 Isolamento de falha

| Contexto | Se `avaliarPagador` / DB FIN falhar |
| --- | --- |
| Aceite, campanha, publicação | **Fail-open com log** + toast “não foi possível verificar situação financeira” **ou** fail-closed só se política BLOQUEIO já conhecida em cache — **recomendação v1: fail-open** (não derruba operação; alinhado a “falha financeira fora da confirmação”) |
| Confirmação | Gate de inadimplência **antes** da TX; falha do avaliador = fail-open + log (não misturar com falha de `criarCobranca*`, que continua rollback) |
| Login / estoque / mapa | **Zero** import do serviço |

Confirmação + geração de cobrança permanece como hoje (TX única).

---

## 5. Matriz de permissões e exceções

| Ação | Quem | Permissão | Gate inadimplência |
| --- | --- | --- | --- |
| Ver cobranças / situação | Torre | `FIN_CONSULTAR` / `FIN_COBRANCA_CONSULTAR` | Não |
| Alterar política ALERTA↔BLOQUEIO | Torre | `FIN_CONTRATO_VERSIONAR` / `FIN_CONFIGURAR` (via publicar contrato) | Não |
| Baixa manual | Torre | `FIN_COBRANCA_BAIXAR` | Não (é a cura) |
| Cancelar cobrança | Torre | `FIN_COBRANCA_CANCELAR` | Não |
| Aceitar oferta / campanha | Motorista | Auth motorista | Sim (pagador MOTORISTA) |
| Publicar / confirmar | Torre | Auth torre + atividades viagem | Sim (pagador TENANT) |
| Bypass “liberar operação inadimplente” | — | **Não criar** na v1 | Exceção só `default` + política ALERTA |

**Não criar** catálogo paralelo `FIN_INADIMPLENCIA_*` na v1 — reutilizar P1 e a política do contrato.

---

## 6. Cenários de teste

### Positivos

1. Contrato `ALERTA` + motorista com `ABERTA` → aceita oferta; UI mostra aviso.
2. Contrato `ALERTA` + tenant com `ABERTA` → publica e confirma; painel mostra aviso.
3. Contrato `BLOQUEIO` + motorista sem débito → aceita normalmente.
4. Contrato `BLOQUEIO` + tenant sem débito → confirma normalmente.
5. Baixa da última `ABERTA` → aceite/publicação liberados na requisição seguinte.
6. Cancelamento (manual ou desistência/reativar) → idem.
7. Tenant `default` com cobrança `PAGADOR_TIPO=TENANT` contra si → **nunca** 403 de bloqueio.
8. Motorista inadimplente → torre do agenciador opera; e o inverso.

### Negativos

9. `BLOQUEIO` + motorista `ABERTA` → `aceitarConvocacao` / `aceitarCarga` / `publicoInteresse` → 403 `FIN_INADIMPLENTE_BLOQUEIO`.
10. `BLOQUEIO` + tenant `ABERTA` → `criarConvocacoes` / `dispararCampanha` / `confirmarConvocacao` → 403.
11. Tentativa de tratar débito motorista como bloqueio de tenant → rejeitada nos testes unitários do avaliador.
12. Política `ALERTA` → nenhum 403 de inadimplência.

### Regressão

13. Aceite sem confirmação **não** gera FIN_* (já P2).
14. Confirmação + cobrança mesma TX (P0/P2).
15. Estoque 7.1 sem acoplamento FIN.
16. Auth login sem import financeiro.
17. Fase 3 fechamento uso / fuso SP / HTTP 403 FIN_* intactos.
18. UI Atlas Pay: erros via `showMessage`, não `alert()`.

---

## 7. Riscos operacionais

| Risco | Mitigação |
| --- | --- |
| Bloquear publicação e parar a torre por engano (`BLOQUEIO` mal configurado) | Default `ALERTA`; versionar contrato com confirmação; docs + UI “reservada → efetiva” |
| Fail-closed derruba operação se FIN cair | Fail-open + log/métrica; nunca no login |
| Confundir vencida com status novo | Só derivar de `DH_VENCIMENTO`; sem alterar CHECK P0 |
| Debito USO (tenant) misturado com CONEXAO (motorista) | Filtro estrito `PAGADOR_TIPO` |
| Bloquear `default` e quebrar plataforma | Exceção explícita no avaliador + teste |
| Sessão “zumbi” após bloqueio | Aceitável: bloqueio é na **ação**, não logout |
| Campanha já disparada + motorista bloqueado no interesse | OK: não desfaz disparo; só impede novo aceite |
| Latência extra nas rotas quentes | Query indexada (`IX_FIN_COB_PAGADOR_MOT` + índice por `PAGADOR_TENANT_ID` se faltar) |

---

## 8. Arquivos que seriam alterados (implementação futura)

### Novos

- `backend/services/financeiro-inadimplencia.service.js`
- `backend/scripts/test_atlas_pay_fase4_inadimplencia.js`
- `docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md` (resultado pós-implementação)

### Backend (gates + wiring)

- `backend/controllers/motorista-app.controller.js` — aceite
- `backend/controllers/oportunidades-campanhas.controller.js` — interesse
- `backend/controllers/viagemmestre.controller.js` — publicar/confirmar (gate; **sem** mudar P0 da TX de cobrança)
- Possível helper fino em `backend/middleware/` só se reduzir duplicação (opcional)

### Frontend

- `backend/public/modulos/atlas-pay/` — banner situação / política efetiva
- `backend/public/modulos/gerenciar-viagens/js/script.js` — toast em 403/alerta
- `backend/public/modulos/campanhas-oportunidades/js/script.js` — idem
- App motorista (páginas de convocação/aceite) — banner ALERTA / mensagem BLOQUEIO
- Link público oportunidades — mensagem JSON amigável

### Docs (na implementação)

- `docs/ATLAS_PAY.md`, `docs/EVOLUCAO_ATLAS_CARGO.md`, `docs/PLANO_MODULO_FINANCEIRO.md`

### Explicitamente **fora** desta fase (salvo decisão nova)

- Scripts P0/P1/P2/Fase 3, constraints existentes, Pix, WhatsApp de cobrança, novo STATUS `VENCIDA`, permissões FIN novas, logout forçado.

---

## 9. Decisões pendentes de aprovação

1. Débito dispara alerta/bloqueio com **qualquer `ABERTA`** ou só **vencida** (`DH_VENCIMENTO`)?  
   **Recomendação:** qualquer `ABERTA` (fiel ao plano “em aberto”).
2. Fail-open vs fail-closed se o avaliador falhar?  
   **Recomendação:** fail-open + log.
3. Contrato `FG_REGRA_ATIVA='N'` ignora política de inadimplência?  
   **Recomendação:** sim (sem enforcement).
4. Escopo motorista: só no `TENANT_ID` da convocação atual, ou global entre tenants?  
   **Recomendação:** no tenant da operação (evita efeito colateral multi-tenant).

---

## 10. Critério de pronto (quando implementar)

- Avaliador único + testes §6 verdes.
- Gates só nos pontos §1; login/estoque/mapa intactos.
- ALERTA sem 403; BLOQUEIO com 403 reversível na baixa/cancelamento.
- Exceção `default` + separação pagadores comprovadas.
- Zero alteração destrutiva em P0/P1/P2/Fase 3.
