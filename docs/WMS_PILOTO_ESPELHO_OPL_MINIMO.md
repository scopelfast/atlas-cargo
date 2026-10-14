# Piloto OPL — De-para em massa + espelho mínimo (NF 13243)

Use este roteiro **depois** do recebimento encerrado e com saldo na **Posição de estoque** (4 SKUs da NF 13243).

---

## Parte A — De-para OPL no PostgreSQL

1. Abra o pgAdmin e conecte no banco do Atlas.
2. Execute o script inteiro (F5):

   `backend/scripts/wms_gerar_depara_opl_catalogo_postgres.sql`

3. Confira no final:
   - `total_depara_ativos` deve subir bastante (milhares, conforme catálogo OL).
   - Os de-paras da NF (`41500`, `466`, `535`, `616001`) podem já existir do recebimento.

**O que o script faz**

| Origem | CODIGO_EXTERNO | CODIGO_INTERNO |
|--------|----------------|----------------|
| `WMS_PRODUTO_OPERACIONAL` | `CODIGO_OPERACIONAL` (ex. `63109100AA`) | `CODIGO_ESTOQUE` mascarado |
| `WMS_PRODUTO_DONO` | código estoque (ex. `6.03.04.102.00`) | o mesmo |
| Chave sem máscara | `6030410200` | `6.03.04.102.00` |

Não duplica: só insere se a chave externa ainda não existir para o dono.

4. No Atlas: **Separação (OPL)** → abra o espelho grande → **Atualizar** / reabra o detalhe.  
   A mensagem *“21 código(s) sem de-para”* deve cair muito (idealmente zero para códigos do catálogo).

> **Atenção:** mesmo com de-para OK, o espelho **nutri 20.05** ainda pede **centenas de unidades** de dezenas de SKUs. Você só tem estoque dos **4 produtos da NF 13243**. Para encerrar **aquele** arquivo inteiro, precisaria inventário com quantidades altas ou muitas entradas. Por isso existe o **espelho mínimo** abaixo.

---

## Parte B — Espelho mínimo (só os 4 itens com saldo)

Arquivo pronto no repositório:

`docs/amostras/espelho-separacao-piloto-nf13243-minimo.txt`

| Cód. OL (10 pos. no TXT) | Produto (estoque) | Qtd pedida | Saldo NF encerrada |
|--------------------------|-------------------|------------|---------------------|
| `6030410200` | CANJICA `6.03.04.102.00` | 30 | 30 |
| `6030113220` | COCO `6.03.01.132.20` | 30 | 30 |
| `6031712120` | COLORAU `6.03.17.121.20` | 50 | 50 |
| `6031021420` | FARINHA `6.03.10.214.20` | 50 | 50 |

### Importar

1. **WMS → Separação** → aba **Estoque** (importar espelho).
2. Dono: **2 — Nutriville**.
3. Arquivo: `docs/amostras/espelho-separacao-piloto-nf13243-minimo.txt` (copie do repositório; salve como **UTF-8**, não UTF-16).
4. **Importar** (nome diferente do espelho grande — não conflita hash).

**Cabeçalho (linha 1):** deve começar com o caractere **`1`** (tipo de registro) + CNPJ 14 dígitos. Por isso a linha começa com `108742760004840` (`1` + `08742760004840`). Se o editor apagar o `1` inicial, a importação falha — use o arquivo do repo sem editar a primeira linha.

### Picking

1. Abra o novo espelho → **Ver linhas**.
2. Simulação deve mostrar **0 sem de-para** e **0 falta de saldo** (se a NF 13243 estiver encerrada).
3. Em cada linha, **Qtd coletada** = qtd pedida (ou use *se diferente* só se testar divergência).
4. **Salvar picking** → **Encerrar picking** (deve concluir sem erro de cobertura).

---

## Parte C — Carga e expedição (fechar o fluxo)

1. **Cargas programadas** — criar/programar carga com o mesmo dono e vínculo ao OPL (conforme seu processo no módulo).
2. **Expedição** — confirmar saída.
3. **Relatórios → Posição de estoque** — conferir **Saída SKU** e **Saldo SKU** zerando ou reduzindo nos 4 produtos.
4. **Demonstrativo (DRE)** — uma linha por produto/dia com saída.

---

## Ordem resumida

```text
SQL de-para  →  Importar espelho mínimo  →  Salvar/encerrar picking
            →  Carga  →  Expedição  →  Posição + DRE
```

Inventário **não** é pré-requisito para este teste; use inventário depois para **posição física** do armazém completo.

---

*Alinhado a `WMS_PILOTO_PRODUCAO_CATALOGO_OL.md` e `WMS_PLANO_TESTES_E2E_QA.md`.*
