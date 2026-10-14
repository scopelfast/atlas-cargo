# WMS — Inventário (Fase 1) — Roteiro de teste enxuto

**Objetivo:** validar snapshot, importação CSV, encerramento com `INVENTARIO_AJUSTE` e impacto no relatório de posição.  
**Pré-requisitos:** `criar_wms_inventario_postgres.sql` aplicado; menu `estoque-inventario` no perfil; ≥ 1 dono e produtos cadastrados.

**Reset entre ciclos (homologação):** `backend/scripts/wms_limpar_movimento_operacional_postgres.sql`  
**Modelo CSV:** aba *Planilha modelo* em **WMS — Inventário** ou `GET /api/wms/inventario/planilha-modelo.csv`

---

## Cenário 1 — Carga inicial (sem snapshot)

| Item | Detalhe |
|------|---------|
| **Objetivo** | Subir saldo do zero só por inventário |
| **Passos** | 1) Inventário → **Novo** → tipo **Inicial**, política **Manter** · 2) **Não** gerar snapshot · 3) Importar CSV com 2–3 produtos e `QTD_CONTADA` > 0 · 4) Conferir resumo (ajuste = contado) · 5) **Encerrar** |
| **Esperado** | Status `ENCERRADO`; `movimentos` > 0 na resposta; **Relatórios → Posição** mostra saldo ≈ contado (por SKU) |

---

## Cenário 2 — Inventário geral com snapshot

| Item | Detalhe |
|------|---------|
| **Objetivo** | Ajustar só a diferença entre sistema e contagem |
| **Pré** | Ter saldo no sistema (ex.: 1 NF encerrada no Recebimento **ou** cenário 1 já rodado) |
| **Passos** | 1) Novo inventário tipo **Geral** · 2) **Gerar snapshot** · 3) Importar CSV com quantidades **diferentes** do sistema em 1 produto · 4) Resumo: `QTD_AJUSTE_SKU` = contado − sistema · 5) Encerrar |
| **Esperado** | Só produtos com divergência geram movimento; saldo final bate com contado (tolerância arredondamento) |

---

## Cenário 3 — Política “Manter” (item não contado)

| Item | Detalhe |
|------|---------|
| **Objetivo** | Produto no snapshot sem linha na planilha **não** zera |
| **Passos** | 1) Geral + snapshot com vários SKUs · 2) Importar CSV **omitindo** um produto que apareceu no snapshot · 3) Encerrar |
| **Esperado** | Produto omitido **fora** do resumo de ajustes; saldo dele **inalterado** |

---

## Cenário 4 — Política “Zerar” (supervisor)

| Item | Detalhe |
|------|---------|
| **Objetivo** | Produto no snapshot sem contagem → ajuste negativo até zero |
| **Passos** | 1) Novo inventário política **Zerar** · 2) Snapshot · 3) Importar CSV **sem** um produto presente no snapshot · 4) Resumo deve listar ajuste negativo para o SKU omitido · 5) Encerrar |
| **Esperado** | Saldo do SKU omitido → 0 (se era > 0 antes) |

---

## Cenário 5 — Validações e idempotência

| Item | Detalhe |
|------|---------|
| **5a CSV inválido** | Cabeçalho sem `CODIGO_PRODUTO` / `QTD_CONTADA` → mensagem 422 |
| **5b Produto inexistente** | Código não cadastrado no dono → linha em `erros` na importação, não quebra o lote |
| **5c Lote/validade** | Produto com `FG_CONTROLA_LOTE`/`VALIDADE` = S sem preencher colunas → erro na linha |
| **5d Encerrar 2×** | Segundo **Encerrar** no mesmo doc → 409 “já encerrado”; movimentos não duplicam (`IDEMPOTENCY_KEY`) |
| **5e Cancelar** | Inventário aberto → **Cancelar doc.** → status `CANCELADO`; encerrar deve falhar |

---

## Checklist rápido pós-teste

- [ ] `WMS_INVENTARIO` / `WMS_INVENTARIO_LINHA` com linhas coerentes  
- [ ] `WMS_MOVIMENTO_ESTOQUE` com `TP_MOVIMENTO = INVENTARIO_AJUSTE`  
- [ ] Posição de estoque e movimentação batem com o esperado  
- [ ] Manual operador (aba no módulo) legível para a equipe  

---

## Fase 2 (não testar neste roteiro)

Ajuste e saldo **por lote/validade** — evolução futura; hoje o encerramento agrega por **SKU**.

---

*Relacionado:* `docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md`, `docs/WMS_INVENTARIO_MANUAL_OPERADOR.md`, `docs/WMS_PLANO_TESTES_E2E_QA.md`
