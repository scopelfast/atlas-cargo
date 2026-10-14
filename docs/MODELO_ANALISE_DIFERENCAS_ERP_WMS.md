# Modelo de análise — Diferenças de estoque ERP × WMS

Use este modelo quando colar o **relatório total de diferenças**.  
Preencha o bloco **Entrada** (ou anexe PDF/Excel/CSV). A análise seguirá a seção **Roteiro**.

---

## Entrada (cole aqui / anexe arquivos)

```
Data do relatório: ____/____/________
Período coberto: ____/____/________ a ____/____/________
Filial / dono: [ ] Mana (1)  [ ] Nutriville (2)  [ ] Ambos  [ ] Outro: ________
Origem ERP: (ex.: Movimentação Analítico OL / Mana / Nutri)
Origem WMS: (ex.: Relatório Movimentação itens Atlas)
Critério do “total”: [ ] saldo final qty  [ ] R$  [ ] ambos
Arquivos anexos:
  - ERP: _________________________________
  - WMS: _________________________________
  - Outro: _______________________________
```

### Grade consolidada (preferencial)

Cole no formato abaixo (CSV ou tabela). Uma linha por SKU × dono.

| Dono | Código | Descrição | Saldo ERP | Saldo WMS | Dif (ERP−WMS) | Observação |
|------|--------|-----------|----------:|----------:|--------------:|------------|
|      |        |           |           |           |               |            |

Se o relatório já vier com colunas diferentes, **não reformate** — cole como está e indique o significado de cada coluna.

---

## Classificação padrão da diferença

Para cada SKU com `|Dif| > 0`, classificar em **uma** causa principal (ou composição):

| Código | Causa | Sintoma típico | Onde confirmar no Atlas |
|--------|--------|----------------|-------------------------|
| **T-OUT** | Transferência saída não lançada no WMS | ERP baixou (SNF/transf); WMS saldo maior | Transferências Estoque + ledger origem |
| **T-IN** | Transferência entrada não lançada no WMS | ERP entrou; WMS saldo menor / negativo | Transferências + ledger destino |
| **NF-IN** | Compra/entrada NF não no saldo WMS | ERP tem Entrada 01; WMS sem linha ou NF aberta/sem mapear | Recebimento (ST, dono, `cdProduto`, `qtdConvertida`) |
| **NF-OUT** | Saída fiscal/expedição divergente | Totais de NF saída ≠ cargas/expedição | Expedição + `WMS_MOVIMENTO_ESTOQUE` |
| **INV** | Inventário/ajuste só de um lado | Ajuste/retirada vencido no ERP sem espelho WMS (ou vice-versa) | Inventário + movimentos `INVENTARIO_AJUSTE` |
| **MAP** | De-para / dono / fator errado | Qtd convertida ≠ ERP; produto errado | Conferência NF + cadastro produto |
| **CORTE** | Relatório WMS truncado / filtro | PDF WMS “para” no meio do período; saldo impresso ≠ ledger | Reimprimir sem limite; conferir ledger direto |
| **OK-COMP** | Diferenças que se compensam | Docs/datas diferentes, mesmo efeito líquido ~0 | Timeline lado a lado |
| **OUTRO** | A investigar | — | — |

---

## Roteiro de análise (o agente segue isto)

1. **Totais**
   - Soma Dif (ERP−WMS) geral e por dono (Mana / Nutri).
   - Top N SKUs por `|Dif|` (qty e, se houver, R$).

2. **Sanidade do relatório**
   - Mesmo período, mesma UM, mesmo código (com/sem pontos).
   - Detectar **CORTE** (WMS impresso incompleto vs banco).

3. **Por SKU (top diferenças)**
   - Ancorar data em que ERP e WMS **ainda batiam**.
   - Listar movimentos ERP e WMS **depois** desse ponto.
   - Fechar equação:  
     `Saldo_WMS + lacunas_WMS − extras_WMS ≈ Saldo_ERP`  
     (ex.: falta T-OUT −200 ⇒ WMS = ERP + 200).

4. **Pares Mana ↔ Nutri**
   - Transferências SNF / doc comum (ex.: `189149849`): saída Mana + entrada Nutri.
   - Se um lado falta no WMS, o outro costuma faltar também.

5. **Parecer**
   - Tabela: SKU | Dif | Causa(s) | Docs | Ação sugerida | Prioridade (P1/P2/P3).
   - Separar: **corrigir estoque agora** vs **melhorar processo/relatório**.

---

## Parecer (modelo de saída)

```
### Resumo executivo
- Período: …
- Donos: …
- Σ |Dif| qty: … | Σ Dif líquida: …
- SKUs com diferença: …
- Achado principal: …

### Top diferenças
| # | Dono | Código | Dif (ERP−WMS) | Causa | Doc(s) | Ação |
|---|------|--------|--------------:|-------|--------|------|
| 1 |      |        |               |       |        |      |

### Ações recomendadas
1. …
2. …

### Observações / limitações do relatório
- …
```

---

## Checklist rápido (antes de mandar o relatório)

- [ ] Período explícito (de/até) e data de emissão
- [ ] Dono(s) identificados (Mana / Nutri)
- [ ] Código + descrição do produto
- [ ] Saldo ERP e saldo WMS **na mesma UM**
- [ ] Diferença = ERP − WMS (ou dizer se for o inverso)
- [ ] Se possível: arquivo ERP + arquivo WMS (não só o consolidado)
- [ ] Destacar se o WMS foi filtrado por código parcial (ex.: `6030401200`)

---

## Referência recente (exemplo já validado)

SKU `6.03.04.012.00` — ARROZ BRANCO 1 kg:

| Dono | ERP | WMS real | Gap | Causa |
|------|----:|---------:|----:|-------|
| Mana | 1.949 | 2.149 | WMS +200 | **T-OUT** ausente: SNF **189149849** −200 |
| Nutri | 124 | −76 | WMS −200 | **T-IN** ausente: mesma **189149849** +200 |

Equação: transferência única não lançada no WMS explica o par Mana/Nutri.
