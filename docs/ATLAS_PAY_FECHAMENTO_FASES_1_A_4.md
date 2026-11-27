# Atlas Pay — Fechamento das Fases 1 a 4

**Data:** 27/11/2026  
**Ambiente:** `atlas_cargo_prd` local (HML operacional) · `http://localhost:8083/`  
**Veredito:** **Fases 1–4 ENCERRADAS no ambiente local.**  
**Produção externa:** **NÃO AUTORIZADA.**  
**Fase 5 (Pix/gateway):** **NÃO INICIADA.**

---

## 1. Escopo entregue

| Fase | Conteúdo |
| --- | --- |
| 1–2 | Contrato versionado, cobrança CONEXAO na confirmação, baixa/cancelamento manual, eventos append-only |
| P0 | Constraints, imutabilidade de valor, uniques |
| P1 | Permissões FIN_*, STRICT, bootstrap, auditoria |
| P2 | Fechamento dos testes fases 1–2 |
| 3 | Fechamento de uso da plataforma (prévia → calcular → aprovar → gerar), D5 fuso SP |
| 4 | Inadimplência inteligente (ALERTA/BLOQUEIO, gates, fail-open, isolamento) |
| Correções finais | **D-01** remoção de motorista; **D-02** origem desistência |

Fora do escopo: Pix/QR/webhook, estorno bancário, acoplamento estoque 7.1.

---

## 2. Regras comerciais (resumo)

### Conexão
- Aceite **não** gera cobrança.
- Confirmação gera CONEXAO se `FG_REGRA_ATIVA=S` e há componente ativo (mesma TX).
- Cancelamento CONEXAO ABERTA/PAGA (com reversão se PAGA) quando:
  - torre **reativa** convocação CONFIRMADA;
  - **desiste do lote**;
  - **remove motorista** da viagem e existe convocação **CONFIRMADA** desse motorista/viagem/tenant (**D-01**).
- Remoção **sem** CONFIRMADA → sem efeito financeiro.
- Substituição: cancela só a cobrança do motorista removido; o novo só gera cobrança se/quando confirmado.

### Origem do cancelamento (**D-02**)
- Valores HTTP: `TORRE` | `MOTORISTA` (SISTEMA não aceito do browser).
- UI: select na reativação; prompt no desistir lote.

### Uso da plataforma (F3)
- Prévia diagnóstica; exceções bloqueiam aprovação; memória congelada após aprovar; geração explícita e idempotente; beneficiário `default`.

### Inadimplência (F4)
- Sem status `VENCIDA`; 403 só com ABERTA vencida + política BLOQUEIO; ALERTA nunca 403; fail-open com aviso; `default` nunca se bloqueia.

---

## 3. Arquitetura e integrações

```
Viagens / Campanhas / App motorista
        │  gates F4 (aplicarGate)
        ▼
financeiro-inadimplencia.service.js
        │
Confirmação / Reativar / Desistir lote / Remover motorista
        │
financeiro-cobranca.service.js  ←→  FIN_COBRANCA + EVENTO
        │
Fechamento uso → financeiro-fechamento-uso.service.js → FIN_FECHAMENTO_USO*
        │
UI atlas-pay (/api/financeiro/*) + FIN_* (P1)
```

Fuso civil: `financeiro-fuso-sp.js` (`America/Sao_Paulo`).

---

## 4. Testes executados (27/11/2026)

| Suíte | Resultado |
| --- | --- |
| `test_atlas_pay_d01_d02_desistencia.js` | **16 PASS / 0 FAIL** |
| `test_atlas_pay_fases_1_2.js` | **21 PASS / 0 FAIL / 0 SKIP** |
| `test_atlas_pay_p1_permissoes.js` | **23 PASS / 0 FAIL** |
| `test_atlas_pay_fase3_fechamento_uso.js` | **32 PASS / 0 FAIL / 0 SKIP** |
| `test_atlas_pay_fase4_inadimplencia.js` | **29 PASS / 0 FAIL / 0 SKIP** |

**Total automatizado:** 121 PASS / 0 FAIL.

---

## 5. Homologação UI

Script: `docs/atlas_pay_homologacao_ui/_homolog_atlas_pay_ui.mjs`  
Evidências: `docs/atlas_pay_homologacao_ui/evidencias/`  
Resultado: **13/13 OK** (`evidencias/resultado.json`).

| Fluxo UI | Evidência |
| --- | --- |
| Visão geral | `01-visao-geral.png` |
| Contratos + publicar regra N | `02-contratos.png`, `02b-…` (“Versão publicada. Regra ativa = N.”) |
| Fechamento: prévia + calcular | `03-…`, `03b-…`, `03c-…` (COM_EXCECOES com regra N) |
| Controles aprovar/gerar | presentes |
| Cobranças + detalhe/eventos | `04-…`, `04b-…` |
| Baixa / cancelar (controles) | presentes |
| Permissões | `05-permissoes.png` |
| Isolamento GET cobrança inexistente | HTTP 404 |

Mutações financeiras destrutivas (baixa/cancelar em cobrança ABERTA produtiva; aprovar/gerar com regra S) permanecem cobertas pelas suítes API; na UI HML do `default` a regra ficou **N**.

---

## 6. Arquivos alterados neste fechamento

| Arquivo | Mudança |
| --- | --- |
| `backend/services/financeiro-cobranca.service.js` | `cancelarCobrancasConexaoAoRemoverMotorista`, `normalizarOrigemCancelamento` |
| `backend/controllers/viagemmestre.controller.js` | D-01 em `removerMotoristaViagem`; D-02 normalização em reativar/desistir |
| `backend/public/modulos/gerenciar-viagens/js/script.js` | UI `origemDesistencia` |
| `backend/scripts/test_atlas_pay_d01_d02_desistencia.js` | Novo |
| Docs F3, auditoria, ATLAS_PAY, EVOLUCAO | Atualizados |
| `docs/atlas_pay_homologacao_ui/**` | Homologação UI |

---

## 7. Pendências reais

| Item | Status |
| --- | --- |
| Produção externa / deploy | Não autorizado |
| Pix / Fase 5 | Não iniciada (exige sandbox + proposta) |
| Contratos mistos S/N mid-competência | Sem decisão automática (F3) |
| Baixa/cancelar via clique UI em cobrança ABERTA real | Não exercido na homologação (evitado de propósito); coberto por API |

---

## 8. Critérios de encerramento — checklist

- [x] D-01 corrigida e testada  
- [x] D-02 corrigida e testada  
- [x] Suítes anteriores aprovadas  
- [x] Homologação da interface (5 abas) concluída  
- [x] Documentação atualizada  
- [x] Sem regressão nas suítes  

**Veredito final: Fases 1–4 ENCERRADAS no HML local.**
