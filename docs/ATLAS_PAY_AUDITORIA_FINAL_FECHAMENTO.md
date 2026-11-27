# Atlas Pay — Auditoria final de fechamento (Fases 1–4)

**Data:** 27/11/2026  
**Projeto:** `C:\atlas-cargo`  
**Ambiente:** `atlas_cargo_prd` local (HML operacional) · `http://localhost:8083/`  
**Escopo original:** auditoria somente leitura.  

### Adendo de fechamento (27/11/2026 — tarde)

D-01 e D-02 foram **corrigidos e testados**; homologação UI Playwright das 5 abas **13/13**; suítes F1–4 + D-01/D-02 verdes. Documento de encerramento: `docs/ATLAS_PAY_FECHAMENTO_FASES_1_A_4.md`.  
Veredito atualizado: Fases 1–4 **ENCERRADAS no HML local**. Produção externa e Pix (F5) permanecem fora.

---

## 1. Veredito executivo

| Escopo | Veredito técnico local | Impeditivo para declarar F1–4 “encerradas” em produção? |
| --- | --- | --- |
| Fases 1–2 + P0/P1/P2 | **Concluídas e comprovadas** por testes automatizados | Produção externa ainda **não autorizada** |
| Fase 3 (fechamento de uso) | **Concluída** (serviço + API + UI + testes + homologação UI) | Produção externa não autorizada |
| Fase 4 (inadimplência) | **Concluída e validada tecnicamente no ambiente local** | Idem |
| Cancelamento CONEXAO (reativar / desistir lote / **remoção motorista CONFIRMADA**) | **Comprovado** (D-01 corrigido) | — |
| Origem desistência TORRE/MOTORISTA | **Comprovado** (D-02 corrigido) | — |
| Fase 5 (Pix/gateway) | **Não iniciada** | Conta sandbox + desenho aprovado |

**Conclusão (atualizada):** Fases 1–4 **ENCERRADAS no HML local**. Planejar F5 é permitido; implementar Pix exige condições da seção 9 / documento de fechamento.

---

## 2. O que está concluído e comprovado

### 2.1 Fases 1–2 + P0/P1/P2

| Item | Evidência |
| --- | --- |
| DDL `FIN_*`, menu `atlas-pay`, cálculo fixo/%/misto | `test_atlas_pay_fases_1_2.js` |
| Regra `N` não gera cobrança; regra `S` gera CONEXAO na confirmação | Serviço `criarCobrancaConexaoNaConfirmacao` + testes |
| Aceite **não** gera cobrança; só `confirmarConvocacao` | Static + runtime no teste P2 |
| Duplicidade ABERTA bloqueada | Unique / `COBRANCA_DUPLICADA` |
| Baixa manual → `PAGA` + evento `BAIXA_MANUAL` | Serviço + teste |
| Cancelamento após paga → `REVERSAO_BAIXA` + `CANCELADA` | Serviço + teste |
| Isolamento por tenant em `obterCobranca` | Teste P2 |
| Estoque 7.1 sem acoplamento Atlas Pay | Teste P2 |
| P1 STRICT, bootstrap, EFEITO, rotas baixa/cancelar | `test_atlas_pay_p1_permissoes.js` **23/0** |
| P0 constraints ativos no local | Docs `ATLAS_PAY.md` / resultado P0 |

### 2.2 Cancelamento CONEXAO — caminhos oficiais

| Cenário comercial | Implementação | Comprovado |
| --- | --- | --- |
| Torre “desiste” via **reativar** convocação `CONFIRMADA` | `viagemmestre.controller.js` → `reativarConvocacao` chama `cancelarCobrancaConexaoNaTransacao` na mesma TX | Sim (código + mensagem `cobrancasCanceladas`) |
| Desistência de **lote** (filha) | `desistirLote` chama o mesmo cancelamento na TX | Sim — teste P2 “Lote filha / desistirLote cancela cobrança” |
| Reversão se cobrança já estava `PAGA` | Evento `REVERSAO_BAIXA` + limpa campos de baixa + `CANCELADA` | Sim — teste “Reversão + cancelamento após baixa” |
| Nova confirmação após reativar | Novo ciclo / nova cobrança | Modelo + docs; gera na próxima confirmação se regra S |

Serviço central: `backend/services/financeiro-cobranca.service.js` (`cancelarCobrancaConexaoNaTransacao`, ~L388–451).

### 2.3 Fase 3 — fluxo completo (backend)

| Etapa | Status | Evidência |
| --- | --- | --- |
| Prévia de uso | OK | `GET /fechamentos-uso/previa` + UI + testes |
| Exceções (frete inválido, lacuna contrato) | OK | Status `COM_EXCECOES`; testes VLFRETE / lacuna |
| Aprovação | OK | `confirmacao: "APROVAR"`; HTTP 403 sem FIN_* |
| Memória congelada | OK | Aprovado/cobrado imutável; recálculo bloqueado |
| Geração idempotente | OK | Unique ciclo USO + retorno `idempotente`; concorrência |
| Consulta / rastreabilidade | OK | Lista/detalhe + `FIN_FECHAMENTO_USO_EVENTO` append-only |
| D5 fuso `America/Sao_Paulo` | OK | `financeiro-fuso-sp.js` + teste multi-TZ |
| Beneficiário `default` / pagador TENANT | OK | Testes F3 |

### 2.4 Fase 4 — fluxo completo (backend)

| Etapa | Status | Evidência |
| --- | --- | --- |
| Avaliação ABERTA não vencida / vencida × ALERTA/BLOQUEIO | OK | `financeiro-inadimplencia.service.js` + F4 |
| Avisos (`FIN_INADIMPLENTE_ALERTA`) | OK | Warning JSON + banner resumo |
| Bloqueio 403 só vencida+BLOQUEIO | OK | Testes 4 / 4b |
| Exceções `default`, regra N, PAGA/CANCELADA | OK | Testes 5–6, 11–12 |
| Isolamento MOTORISTA ↔ TENANT / por tenant | OK | Testes 9a/9b/10 |
| Fail-open + warning | OK | Teste 13 `FIN_INAD_FAIL_OPEN` |
| Gates nas 6 rotas | OK | Teste 14e + HTTP 403 |

### 2.5 UI Atlas Pay (existência e ações)

Arquivos: `backend/public/modulos/atlas-pay/index.html` + `js/script.js`.

| Aba | Capacidade observada no código |
| --- | --- |
| Visão geral | KPIs (`/resumo`), contrato vigente, banner inadimplência/`warning` |
| Contratos | Listar/publicar versão, política, `FG_REGRA_ATIVA`, componentes |
| Fechamento de uso | Prévia, calcular, recalcular, aprovar, gerar cobrança, lista, detalhe, exceções vazias (“Nenhuma exceção”) |
| Cobranças | Filtros q/status, detalhe, eventos, baixa, cancelar |
| Permissões | Aba condicionada a permissão de gestão; perfis, overrides, bootstrap, audit |

Estados vazios: tabela fechamentos “Nenhum fechamento”; exceções “Nenhuma exceção”. Confirmações críticas usam `window.confirm` (não só `showMessage`).

---

## 3. O que está parcialmente concluído

| Item | O que falta |
| --- | --- |
| Homologação **operacional pela interface** | Não há suíte E2E/Playwright de UI Atlas Pay; validação foi API/serviço + inspeção de código/capturas |
| Origem `MOTORISTA` no cancelamento | Backend aceita `origemDesistencia` em reativar/desistir-lote; **UI de Viagens não envia** o campo (sempre default `TORRE`) — ver defeito D-02 |
| Linguagem do plano comercial vs. código | `PLANO_MODULO_FINANCEIRO.md` fala “torre desiste / motorista desiste” de forma genérica; implementação efetiva é **reativar** e **desistir lote**, não “remover motorista” |
| Doc Fase 3 desatualizada | `ATLAS_PAY_FASE3_FECHAMENTO_USO.md` ainda cita “bloqueio por inadimplência: fases seguintes” — F4 já fechada |
| Contratos mistos S/N na mesma competência (F3) | Documentado como sem decisão automática |
| App motorista + gates F4 | Backend + testes HTTP; exercício visual autenticado do motorista **não** foi revalidado nesta auditoria |
| Produção externa | Checklist / autorização pendente (`ATLAS_PAY.md`) |

---

## 4. O que está pendente

| Pendência | Tipo | Bloqueia planejamento F5? | Bloqueia ligar regra S em tenant real? |
| --- | --- | --- | --- |
| Conta sandbox gateway / Pix | Externa | Não (planejar sim) | N/A (F5) |
| Autorização deploy produção | Processo | Não | Sim (qualquer go-live) |
| E2E UI Atlas Pay + Viagens (baixa, cancelar, fechamento, gates toast) | Qualidade | Não | Recomendado |
| Fechar lacuna remover motorista ↔ cobrança (D-01) | Produto | Não | **Recomendado como pré-requisito** |
| UI origem desistência MOTORISTA (D-02) | Rastreabilidade | Não | Desejável |
| Decisão contratos mistos S/N na competência | Comercial | Não | Só se usar mid-month change |
| WhatsApp/Switch configurado para operação real | Externa | Não | Operação de convocação |

---

## 5. Defeitos / lacunas encontrados (com referência)

### D-01 — Remover motorista da viagem não cancela cobrança CONEXAO — **CORRIGIDO**

- **Correção:** `removerMotoristaViagem` cancela CONEXAO ABERTA/PAGA na mesma TX quando existe convocação `CONFIRMADA` do motorista/viagem/tenant (`cancelarCobrancasConexaoAoRemoverMotorista`).  
- **Regra:** remoção sem CONFIRMADA → sem efeito financeiro; substituição cancela só do removido.  
- **Teste:** `test_atlas_pay_d01_d02_desistencia.js` — 16/0.

### D-02 — UI não propaga `origemDesistencia=MOTORISTA` — **CORRIGIDO**

- **Correção:** UI reativar (select) e desistir lote (prompt) enviam `origemDesistencia`; backend `normalizarOrigemCancelamento(..., { permitirSistema: false })`.  
- **Teste:** suíte D-01/D-02.

### D-03 — Motorista não cancela cobrança pelo app após `CONFIRMADA`

- **Severidade:** informativa / alinhamento documental.  
- **Arquivo:** `motorista-app.controller.js` — `recusarConvocacao` rejeita status `CONFIRMADA` / `ACEITA_DESCARTADA`; **sem** hook financeiro.  
- **Caminho real:** torre registra desistência via reativar/desistir-lote (com origem pretendida MOTORISTA).  
- Coerente com “torre opera a desistência”, mas o plano comercial fala “ele desiste da carga” sem detalhar o intermediário.

### D-04 — Doc Fase 3 desatualizada quanto à inadimplência

- **Arquivo:** `docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md` L96.  
- **Correção:** apenas documental (fora desta auditoria).

### Não são defeitos

- Pix ausente: escopo Fase 5.  
- Ranking / módulos frota manutenção: fora do Atlas Pay.  
- Fail-open F4: comportamento contratado.

---

## 6. Testes executados nesta auditoria (27/11/2026)

Comando (somente leitura operacional; fixtures de teste com limpeza/cancelamento append-only, sem migration):

```powershell
cd C:\atlas-cargo\backend
node scripts/test_atlas_pay_fases_1_2.js
node scripts/test_atlas_pay_p1_permissoes.js
node scripts/test_atlas_pay_fase3_fechamento_uso.js
node scripts/test_atlas_pay_fase4_inadimplencia.js
```

| Suíte | Resultado |
| --- | --- |
| `test_atlas_pay_fases_1_2.js` | **21 PASS / 0 FAIL / 0 SKIP** |
| `test_atlas_pay_p1_permissoes.js` | **23 PASS / 0 FAIL** |
| `test_atlas_pay_fase3_fechamento_uso.js` | **32 PASS / 0 FAIL / 0 SKIP** |
| `test_atlas_pay_fase4_inadimplencia.js` | **29 PASS / 0 FAIL / 0 SKIP** |

**Total desta rodada:** 105 PASS / 0 FAIL.

---

## 7. Cenários operacionais ainda não validados pela interface

| Cenário | Coberto por teste API/serviço? | Coberto por UI E2E? |
| --- | --- | --- |
| Publicar contrato / ligar regra S na tela | Parcial (serviço) | Não |
| Confirmar convocação com regra S e ver cobrança na aba Cobranças | Parcial (serviço + TX) | Não |
| Reativar e ver cobrança CANCELADA + eventos | Parcial (serviço) | Não |
| Desistir lote e refletir no Atlas Pay | Sim (P2 + rollback) | Não |
| Remover motorista sem reativar (órfão) | Não | Não |
| Baixa / cancelar manual na UI (confirm + toast) | Sim (API/P1) | Não |
| Fluxo F3 prévia→calcular→aprovar→gerar na UI | Sim (serviço) | Não |
| Banner F4 / toast 403 em Viagens e Campanhas | Parcial (HTTP handlers nos testes F4) | Não |
| Permissões: bootstrap, override, anti-elevação na UI | Sim (P1 unitário) | Não |
| Motorista: aceite bloqueado/alerta com sessão real | Parcial (HTTP gate) | Não |
| Isolamento tenant na UI (tentar ID alheio) | Sim (API) | Não |
| Dark mode / estados vazios Atlas Pay | Captura inventário telas | N/A funcional |

---

## 8. Pendências de configuração externa

| Item | Observação |
| --- | --- |
| Gateway Pix / Asaas (ou equivalente) sandbox | Obrigatório para **implementar** F5; não para fechar F1–4 |
| Credenciais produção gateway | Só após sandbox estável |
| Switch Digital / WhatsApp | Independente do financeiro; necessário para operação real de convocação |
| `PUBLIC_URL` / DNS | Links públicos de convocação |
| Autorização explícita de deploy / produção externa | Checklist P0 item 11 ainda ☐ |
| Conta OpenAI (transcrição chat) | Fora do Atlas Pay |

---

## 9. Critérios objetivos para declarar Fases 1–4 encerradas

### 9.1 Encerramento técnico local (já atendido nesta auditoria)

- [x] Suítes P2 + P1 + F3 + F4 verdes na mesma data  
- [x] Cobrança CONEXAO só na confirmação; aceite sem FIN  
- [x] Cancelamento oficial em reativar + desistir lote  
- [x] Baixa / cancelamento manual / eventos append-only  
- [x] Fechamento de uso: prévia, exceções, aprovação, memória imutável, geração idempotente  
- [x] Inadimplência: regra definitiva vencimento×política, gates, fail-open, isolamento, default  
- [x] Sem Pix no escopo F1–4  
- [x] Regra `default` restaura `FG_REGRA_ATIVA=N` após testes  

### 9.2 Encerramento operacional (ainda aberto — não bloqueia planejamento F5)

- [ ] Checklist UI em tenant de homologação com regra S **temporária** e dados fixture (confirmar → reativar → ver cancelamento)  
- [ ] Decisão explícita sobre D-01 (corrigir remoção de motorista **ou** documentar que só reativar/desistir-lote cancelam)  
- [ ] Opcional: UI `origemDesistencia` (D-02)  
- [ ] Atualizar frase residual na doc F3 (D-04)  
- [ ] Autorização de produção externa (separada do “encerrado técnico”)

---

## 10. Condições necessárias para iniciar a Fase 5 (Pix)

1. **Escopo F1–4 aceito** como encerrado técnico local (este documento).  
2. **Decisão comercial** sobre D-01 (lacuna remover motorista) antes de ligar regra S em cliente real.  
3. **Conta sandbox** do gateway + chaves fora do Git (`.env`).  
4. **Desenho F5** aprovado: criação de QR/cobrança Pix na `FIN_COBRANCA`, webhook idempotente, reconciliação com baixa manual, sem quebrar P0 append-only.  
5. **Não** reabrir P0–F4 nem migrations desnecessárias; script idempotente novo se houver coluna.  
6. **Ambiente:** continuar em HML local até autorização de produção.  
7. **Testes:** nova suíte `test_atlas_pay_fase5_*.js` + regressão F1–4 obrigatória.  

Planejar F5 **pode** começar agora. Implementar F5 **não** deve começar sem itens 3–4 (e preferencialmente 2).

---

## 11. Matriz de coerência docs × backend × UI

| Tema | Docs | Backend | UI | Coerência |
| --- | --- | --- | --- | --- |
| Cobrança na confirmação | OK | OK | Indireta (Viagens) | Alta |
| Cancelar em reativar / desistir lote | OK (`ATLAS_PAY.md`) | OK | Botões existem | Alta |
| Cancelar em “desiste” genérico / remover motorista | Plano amplo | Lacuna D-01 | Remover ≠ cancelar | **Parcial** |
| Baixa / cancelar manual | OK | OK + FIN_* | OK (confirm) | Alta |
| Eventos append-only | OK | OK | Detalhe cobrança | Alta |
| Fechamento uso F3 | OK | OK | Aba completa | Alta |
| Inadimplência F4 | OK (doc F4) | OK | Banner + toasts gates | Alta (E2E visual parcial) |
| Pix | Fora / F5 | Ausente | Ausente | Esperado |

---

## 12. Referências de código e documentação

| Artefato | Caminho |
| --- | --- |
| Cobrança CONEXAO | `backend/services/financeiro-cobranca.service.js` |
| Fechamento uso | `backend/services/financeiro-fechamento-uso.service.js` |
| Fuso SP | `backend/services/financeiro-fuso-sp.js` |
| Inadimplência | `backend/services/financeiro-inadimplencia.service.js` |
| Hooks viagem | `backend/controllers/viagemmestre.controller.js` |
| Rotas FIN | `backend/routes/financeiro.routes.js` |
| UI | `backend/public/modulos/atlas-pay/` |
| Docs | `docs/ATLAS_PAY.md`, `PLANO_MODULO_FINANCEIRO.md`, `ATLAS_PAY_FASE3_*.md`, `ATLAS_PAY_FASE4_*.md`, `ATLAS_PAY_P1_PERMISSOES.md` |

---

## 13. Resposta direta: há pendência impeditiva para iniciar a Fase 5?

- **Para planejar / redigir proposta da Fase 5:** **Não.**  
- **Para implementar Pix em código:** **Sim — dependências externas e de escopo** (sandbox gateway + desenho aprovado), não regressão técnica das Fases 1–4.  
- **Para ligar regra financeira S em operação real:** tratar **D-01** (e homologação UI) antes, independentemente do Pix.
