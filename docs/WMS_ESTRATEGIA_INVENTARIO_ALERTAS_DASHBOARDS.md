# WMS — Estratégia: inventário em SI, validade, separação, exceções e dashboards

**Status:** documento vivo — **MVP do recorte “inventário lógico SI” encerrado** (ver §0); evoluções de lote/FEFO e dashboard denso ficam para **Fase 2+**.  
**Relaciona com:** `docs/PLANO_ESTOQUE_TERCEIROS_E_CROSSDOCKING_ATLAS_CARGO.md`, `docs/RF_WMS_ATLAS_v1.md`, `docs/WMS_RECEBIMENTO_WEB_LISTA_E_MOBILE_CONFERENCIA.md`, **`docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md`** (processo e planilha — menu `estoque-inventario`).

**Fora do escopo imediato (acordo atual):** mobile de doca, crossdocking em lote (UI).

---

## 0. Encerramento do MVP (este ciclo)

**Entregue:** políticas no dono (`WMS_DONO_ESTOQUE`) + recebimento com validade mínima, liberação por supervisor e log; relatório de vencimento (API, CSV na UI, job com e-mail opcional e auditoria de envio); separação OPL com simulação (incl. recebimentos abertos opcional), reserva ao concluir picking, baixa da reserva e registro de saída em `WMS_MOVIMENTO_ESTOQUE` na confirmação de saída da expedição (transação única); saldo de referência da simulação/reserva = entradas encerradas + movimentos; hub Estoque/WMS na tela inicial (`DASHBOARD_MODULE_HUB_DEFS`); reset operacional com `backend/scripts/wms_limpar_movimento_operacional_postgres.sql` (OPL + reserva via `CASCADE`, carga e anexos no mesmo `TRUNCATE`).

**Plano de testes E2E / demonstração / matriz (a–g):** `docs/WMS_PLANO_TESTES_E2E_QA.md` + script somente leitura `backend/scripts/wms-qa-snapshot-readonly.js`.

**“Cadê relatórios / dashboard?” (guia de telas):** `docs/WMS_ONDE_RELATORIOS_E_DASHBOARD.md` — hub na **home** do dashboard; CSV vencimento na aba **Filtros** do módulo **Recebimento**.

**Fase 2+ (não exigido para dar este MVP como concluído):** saldo e movimento **por lote** + FEFO/FIFO; relatório de vencimento alimentado por esse saldo (hoje ainda é MVP em cima de `CONFERENCIA_JSON`, §4); pipeline refletido na **reserva** (além da leitura na simulação); camada genérica de exceções (§6); widgets/KPIs por módulo no dashboard (§7); decisões do checklist §9 (UOM canônica, nascimento do saldo por lote).

---

## 1. Objetivo

Garantir **integridade de saldo** (entradas com fator, saídas sem negativo), **visibilidade de vencimento** (relatório diário ao dono + alertas na operação), **antecipação de falta** na separação (OPL), **reserva** quando o modelo de dados permitir, e **exceções auditáveis** (liberação + log). Em paralelo, evoluir o **dashboard** conforme o módulo de produto selecionado no menu.

---

## 2. Fonte da verdade e camadas

| Camada | Papel |
|--------|--------|
| **Política (dono)** | Parâmetros numéricos e flags que todas as telas/jobs consultam (ex.: horizonte do relatório de vencimento; mínimo de dias de vida útil na entrada). |
| **Mestre (produto dono)** | Perecível, controla lote/validade, conservação — orienta obrigatoriedade de campos. |
| **Operacional (lote + quantidade)** | Validade e quantidade **por posição/documento**; base para FEFO/FIFO quando P3 do plano estiver fechado. |
| **Movimento** | Toda alteração de saldo passa por registro idempotente onde possível; nunca “sumir” quantidade sem trilha. **MVP:** tabela `WMS_MOVIMENTO_ESTOQUE` (append-only); saída `EXPEDICAO_SAIDA` na confirmação de saída da carga (QTD negativa por `CD_PRODUTO`, chave idempotente por carga+produto). Saldo usado na simulação OPL e na reserva = entradas encerradas + soma dos movimentos. Script: `adicionar_wms_movimento_estoque_postgres.sql`. |

**Regra de ouro:** validações críticas no **backend**; UI só antecipa e educa.

---

## 3. Parâmetros no dono do estoque (implementação iniciada)

Colunas em `WMS_DONO_ESTOQUE` (script idempotente `backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql`):

| Coluna | Significado | Default sugerido |
|--------|-------------|------------------|
| `NU_DIAS_REL_VENCIMENTO` | Janela do **relatório diário** “produtos vencendo em até N dias” enviado ao cliente (dono). | 60 |
| `NU_DIAS_MIN_VALID_RECEB` | **Recebimento:** bloquear conclusão de linha/NF se a validade informada for anterior a *hoje + N dias* (até existir fluxo de liberação). | 90 |

*Limites técnicos:* 1–1095 dias (ajustável se negócio pedir).

**Feito na API:** `NU_DIAS_MIN_VALID_RECEB` é aplicado em `salvarConferencia` e em `encerrarRecebimento` (itens com validade preenchida na `CONFERENCIA_JSON`). O detalhe da NF (`GET …/documentos/:id`) devolve `NU_DIAS_MIN_VALID_RECEB_DONO` e `NU_DIAS_REL_VENCIMENTO_DONO` via join no dono (hint na tela de conferência).

**Liberação (supervisor):** com `ignorarPoliticaValidadeMin` + `justificativaBloqueio` + `autorizadoLogin` + `autorizadoSenha`, o usuário autorizador deve ter o programa `wms-recebimento-liberar-validade-min` (script `adicionar_permissao_liberar_validade_min_recebimento_postgres.sql`). Grava em `WMS_RECEBIMENTO_LIBERACAO_VALIDADE` (`TP_ACAO` = `CONFERENCIA` ou `ENCERRAR`). Resposta **422** quando falta override.

**Relatório vencimento (MVP):** `GET /api/wms/recebimento/relatorio-vencimento` (JSON) e `?formato=csv` (download). Usa `NU_DIAS_REL_VENCIMENTO` do dono e apenas NF-e **encerradas** + `CONFERENCIA_JSON` (ver aviso na resposta). Botão na aba Filtros do módulo Recebimento.

**Próximo passo (Fase 2+):** §0 — lote/FEFO, vencimento por saldo de lote, reserva × pipeline, exceções genéricas, widgets. **MVP (fechado):** ledger `WMS_MOVIMENTO_ESTOQUE` na expedição + saldo líquido na simulação/reserva; baixa em `WMS_RESERVA_ESTOQUE_OPL` na mesma transação; hub Estoque/WMS em `dashboard.js`.

**Job relatório vencimento:** agendado no processo Node (`jobs/wms-relatorio-vencimento-job.js`, inicia com `server.js` / `server-https.js`) ou execução pontual `npm run wms:vencimento-once` no cron. Por tenant com `WMS_DONO_ESTOQUE` ativo, gera o mesmo conjunto da API; se houver linhas e SMTP + `WMS_VENCIMENTO_JOB_EMAIL_TO` estiverem configurados, anexa CSV (UTF-8 BOM). Grava auditoria em `WMS_RELATORIO_VENCIMENTO_ENVIO` (script `adicionar_wms_relatorio_vencimento_envio_log_postgres.sql`). Variáveis: ver `backend/.env.example` (`WMS_VENCIMENTO_JOB_*`, `SMTP_*`). Desative o agendamento interno com `WMS_VENCIMENTO_JOB_ATIVO=N`.

---

## 4. Relatório diário de vencimento (dono)

1. **Query** sobre saldo por SKU + lote + `DT_VALIDADE` (ou campo equivalente quando o modelo de saldo existir), filtrando `DT_VALIDADE <= hoje + NU_DIAS_REL_VENCIMENTO` e quantidade &gt; 0.  
2. **Job** por tenant: implementado com a query atual (recebimento encerrado + `CONFERENCIA_JSON`); CSV por e-mail se SMTP configurado; intervalo configurável (padrão 24 h); log em `WMS_RELATORIO_VENCIMENTO_ENVIO`.  
3. **Histórico na UI:** módulo Recebimento, aba Filtros — bloco “Relatório vencimento — envios automáticos”; `GET /api/wms/recebimento/relatorio-vencimento-envios`.

---

## 5. Separação (OPL): alerta + possíveis faltas + reserva

**Fase A (sem reserva):** na importação ou ao abrir detalhe, **simulação** de cobertura (demanda convertida × saldo disponível); lista de **possíveis faltas**; flag no cabeçalho. Não bloqueia (remessa pode chegar no mesmo dia). **Implementado (MVP):** `GET …/opl/importacoes/:cd` inclui `simulacaoEstoque` (de-para + saldo de NF-e encerradas com `cdProduto` na conferência). **Reservas:** o saldo usado na comparação **desconta** `WMS_RESERVA_ESTOQUE_OPL` de **outros** espelhos (não o `CD_OPL_ARQUIVO` atual); resposta com `descontaReservasOutrosEspelhos`, e por linha `reservaOutrosEspelhos` / `saldoDisponivelAposReservasOutros` quando aplicável.

**Fase B (“incluir pipeline”):** considerar também conferências em NF-e de recebimento **ainda não encerradas** (`ST_RECEBIMENTO` ≠ `ENCERRADA`). Default conservador = desligado. **Implementado:** query `?incluirRecebimentosAbertos=1` (ou `incluir_recebimentos_abertos`) + checkbox no detalhe da importação (módulo Separação); o JSON de `simulacaoEstoque` traz `incluirRecebimentosAbertos`, e por linha `saldoRecebimentosAbertos` / `saldoEstimadoUsado` quando a opção está ativa.

**Fase C (reserva) — MVP:** ao **concluir o picking** (último `PUT` em que todos os itens passam a ter `QT_COLETADA`), grava-se `WMS_RESERVA_ESTOQUE_OPL` por `CD_PRODUTO` (soma das coletadas mapeadas por de-para). Saldo de referência = mesma base da simulação (**NF-e encerradas**); soma das reservas de **outros** espelhos + picking atual não pode exceder esse saldo — caso contrário **409** `RESERVA_CONFLITO` e o save é revertido. Itens sem de-para não entram na reserva (aviso opcional na resposta). Script: `adicionar_wms_reserva_opl_picking_postgres.sql`. Exclusão do espelho remove reservas em cascata. Na **expedição**, ao confirmar saída da carga, as linhas de reserva do `CD_OPL_ARQUIVO` inferido pelos pedidos das NF-e da carga são removidas na mesma transação (`liberarReservasOplPorCargaExpedida`).

---

## 6. Exceções: furar regra com governança

- Papéis: operador vs **supervisor** (ou dupla confirmação).  
- Registro: `tipo`, `cd_dono`, `referência`, `regra`, `valor_solicitado`, `justificativa`, `login_supervisor`, `dh`, `payload_hash` opcional.  
- Reutilizar o **padrão** já usado em liberação de divergência de expedição como referência de UX e persistência.

---

## 7. Dashboard por “Módulo de produto”

- **Registro de widgets** por chave de módulo (`estoque`, `estoque-recebimento`, `estoque-separacao`, …): KPIs, alertas, atalhos.  
- **Hub Estoque:** resumo só dos submódulos permitidos ao usuário.  
- **Modo “todos os módulos”:** dashboard composto com limite de densidade e agrupamento por área (WMS / Frota / …).

Implementação: em `dashboard.js` existe o mapa **`DASHBOARD_MODULE_HUB_DEFS`** e a função **`showWelcomeScreen`**, que lê o **módulo de produto** selecionado (`sessionStorage` `atlasProductModuleCodigo` ou `#productModuleSelect`). Se o código for **`estoque`**, a home central mostra **KPIs WMS** (contagens via APIs de recebimento, OPL, cargas e expedição), alerta de cargas a expedir, **acesso rápido** aos submódulos permitidos e dica do relatório CSV de vencimento; ao trocar o módulo no seletor, o menu e a **home** recarregam. Se o código for **`divulga_cargas_torre`** (ou `divulga` legado, normalizado para a mesma home — Torre Logística), a home mostra **KPIs de viagens/convocações** (mesmo endpoint do relatório) + **acesso rápido** (hub `divulga_cargas_torre` em `DASHBOARD_MODULE_HUB_DEFS`). Módulo **`base`**: mantém a visão viagens/convocações + bloco opcional Estoque. Outros códigos: mensagem genérica até haver painel dedicado. Novos módulos: estender ramos em `showWelcomeScreen` + `DASHBOARD_MODULE_HUB_DEFS` + i18n `web.dashboard.*` em `motorista/locales/*.json`.

---

## 7.1 Backlog UX — consulta por produto (reserva / disponível)

Após piloto **carga + NF saída + expedição**: tela ou API para SKU (dono + código) com saldo, reserva total, disponível e detalhe **espelho OPL → pedido → destino**. Ver `docs/WMS_BACKLOG_CONSULTA_DISPONIBILIDADE_PRODUTO.md`.

**Programação de entregas (peso / veículo / seco-frio):** Fase 1 — `GET …/resumo-logistico` + card em Cargas programadas. Roadmap completo: `docs/WMS_BACKLOG_PROGRAMACAO_ENTREGAS_CAPACIDADE.md`.

---

## 8. Roadmap sugerido (ordem)

1. **Dono — políticas** (este incremento): colunas + API + UI cadastro.  
2. **Recebimento:** validar `NU_DIAS_MIN_VALID_RECEB` + endpoint de liberação + log.  
3. **Relatório vencimento:** query + export na UI + job (Node/cron) com e-mail opcional.  
4. **OPL:** simulação + lista de faltas.  
5. **Reserva + movimento (MVP — concluído):** DDL reserva + picking + baixa reserva na expedição + ledger `WMS_MOVIMENTO_ESTOQUE` (saída por NF-e da carga). **Evoluções (Fase 2+):** lote, fila, pipeline na reserva.  
6. **Dashboards** modulares — **iniciado:** hub Estoque/WMS na tela inicial (`showWelcomeScreen`).

---

## 9. Checklist — portões para Fase 2 (saldo por lote / movimento rico)

- [ ] UOM canônica por SKU no dono está definida para movimento?  
- [ ] Onde nasce o “saldo por lote” após recebimento encerrado?  
- [x] Picking OPL (MVP reserva): grava `WMS_RESERVA_ESTOQUE_OPL` ao encerrar; saldo de referência da reserva/simulação inclui movimentos (saídas expedidas).
- [x] Expedição: ao confirmar saída, `DELETE` das reservas do `CD_OPL_ARQUIVO` resolvido pelos pedidos das NF-e da carga + `INSERT` em `WMS_MOVIMENTO_ESTOQUE` (idempotente), mesma transação que `WMS_EXPEDICAO_CARGA`.

*Atualizar este checklist quando o ERD de lote/UOM avançar; o MVP atual não depende destes itens marcados.*

---

*Última atualização: encerramento explícito do MVP (§0); limpeza operacional WMS no script `wms_limpar_movimento_operacional_postgres.sql`.*
