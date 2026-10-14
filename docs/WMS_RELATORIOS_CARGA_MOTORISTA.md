# WMS — Relatórios da carga para o motorista

Documento de apoio à implementação dos dois impressos operacionais: **resumo agrupado da carga** e **lista de frios (resfriado/congelado) por nota**, alinhados ao modelo de dados atual.

## Entidade central

Tudo gira em torno de **`CD_CARGA`** (`WMS_CARGA_PROGRAMADA`). A expedição (`WMS_EXPEDICAO_CARGA`) é 1:1 com a mesma carga; os relatórios podem ser gerados a partir do mesmo serviço e expostos em **Cargas programadas** e **Expedição**.

## Dados já disponíveis

### Carga

| Campo (tabela) | Uso nos relatórios |
|----------------|-------------------|
| `WMS_CARGA_PROGRAMADA.CD_CARGA` | Chave |
| `NM_DESCRICAO`, `NM_ROTA`, `NM_MOTORISTA`, `PLACA`, `ST_CARGA` | Cabeçalho do romaneio |
| `CD_DONO` | Filtro / dono do estoque |

### Vínculo nota ↔ carga

| Campo | Uso |
|-------|-----|
| `WMS_CARGA_PROGRAMADA_NFE.ORDEM` | Ordem de entrega na rota |
| `WMS_CARGA_PROGRAMADA_NFE.CD_NFE_SAIDA` | FK para a NF |

### NF de saída (cabeçalho + endereço)

Tabela `WMS_NFE_SAIDA` (ver `backend/scripts/wms_carga_programada_postgres.sql`).

| Campo | Resumo agrupado | Lista frios |
|-------|-----------------|-------------|
| `NUMERO_NF`, `SERIE`, `CHAVE_NFE`, `DH_EMISSAO` | Sim | Sim (identificação da NF) |
| `CNPJ_DEST`, `XNOME_DEST` | Sim | Sim |
| `CNPJ_ENTREGA`, `XNOME_ENTREGA` | Sim (priorizar entrega) | Sim |
| `XLGR_DEST`, `NRO_DEST`, `XCPL_DEST`, `XBAIRRO_DEST`, `XMUN_DEST`, `UF_DEST`, `CEP_DEST` | Sim — “local de entrega” | Sim |
| `Q_ITENS` | Resumo | Opcional |
| `LINHAS_JSON` | Agregação de volumes / totais | **Detalhe por linha** |

### Itens (`LINHAS_JSON`)

O XML é parseado em `backend/services/wms-nfe-xml-parse.service.js`. Cada elemento do array costuma trazer (entre outros):

- `nItem`, `cProd`, `xProd`, `NCM`, `CFOP`, `qCom`, `uCom`, `cEAN`, `cEANTrib`

O controller `gerarRomaneioCarga` em `wms-carga.controller.js` já normaliza aliases legados: `codigo`/`cProd`, `descricao`/`xProd`, `quantidade`/`qCom`/`qTrib`, `unidade`/`uCom`.

**API romaneio / resumo**

- **JSON (agregado):** `GET /api/wms/cargas/programadas/:cdCarga/romaneio`  
  Retorno: `carga`, `totais`, `itensConsolidados`, `destinos`, `geradoEm`.
- **HTML (impressão):** `GET /api/wms/cargas/programadas/:cdCarga/romaneio?format=html`  
  Página pronta para `Ctrl+P` / impressão; mesmos dados do JSON (montagem em `wms-carga-relatorio-html.service.js`).

**API frios (HTML)** — mesmo espírito do romaneio **Separação (OPL)** (`buildRomaneioSeparacaoHtml` + `classificarConservacao` + mapa `WMS_PRODUTO_DONO`).

- `GET /api/wms/cargas/programadas/:cdCarga/relatorios/frios`  
  Query string (opcional), alinhada ao OPL:
  - `agruparItens=1|0` — somar quantidade por código na mesma NF (padrão `1`).
  - `folhas=nota|dest|continuo` — `nota` = uma folha por NF; `dest` = uma folha por destino (UF + município + CNPJ entrega); `continuo` = sem quebra.
  - `ordem=unidade,destino,...` — campos válidos: `unidade`, `destino`, `conservacao`, `categoria`, `nome`, `codigo`.
  Itens incluídos se **NCM frio** (`classificarFrioPorNcm`) **ou** cadastro/heurística OPL = refrigerado/congelado (`classificarConservacao` + `PRODUTO_DONO`).

**Layout:** cabeçalho tipo picking (nº da carga, data, placa, caixa Separação/Conferência), blocos **Local / Cliente de entrega / Nota**, tabela Código–Descrição–Uníd.–Volumes, subtotal em Vol., **A4 vertical** (`@page { size: A4 portrait }`).

**UI:** **Imprimir resumo** direto; **Imprimir frios…** abre modal com linhas / folhas / ordenação (Cargas programadas — detalhe; Expedição — carga selecionada).

## 1) Resumo agrupado (todas as notas + locais)

**Objetivo:** uma visão única da carga: quantas NF, totais, destinos com endereço, opcionalmente itens consolidados.

**Fonte recomendada:** reutilizar a lógica de `gerarRomaneioCarga` (ou extrair para serviço compartilhado) e renderizar:

- Cabeçalho: descrição da carga, rota, motorista/placa (carga ou expedição), data de emissão do documento.
- Bloco por destino (ordenar por `ORDEM`, depois nome): CNPJ, razão social, endereço completo (`XLGR_DEST` + `NRO_DEST` + complementos + município/UF/CEP), lista de NF (número/série/chave resumida).
- Tabela opcional: `itensConsolidados` (código, descrição, unidade, quantidade total na carga).

**SQL conceitual (só cabeçalhos + ordem):** já espelhada no `SELECT` de `gerarRomaneioCarga` (`JOIN` carga–NFE–`WMS_NFE_SAIDA` + `ORDER BY j."ORDEM"`).

## 2) Somente frios — detalhe por nota

**Objetivo:** para cada NF da carga, listar só linhas **resfriado** ou **congelado**, com quantidade, unidade, descrição e **local de entrega** (mesmo bloco de endereço do cabeçalho da NF).

**Classificação “frio”:** hoje não há coluna dedicada na tabela; use **NCM** (e opcionalmente texto em `xProd` / regras por CFOP) até existir flag no cadastro de produto.

Exemplo de critério por prefixo NCM (ajustar faixas conforme política fiscal interna):

- **Congelados:** NCM `04` (laticínios congelados), `0203`, `0204`, `0303`, `0304`, `1604`… (validar com fiscal).
- **Resfriados:** `0201`, `0202`, `0206`, `0210`, `0302`, `0305`, `0401`–`0406` parcialmente…

**SQL ilustrativo (PostgreSQL)** — expande itens de todas as NF da carga e filtra por prefixo de NCM (exemplo didático; refine os `LIKE`):

```sql
-- :cd_carga, :tenant
WITH nf_carga AS (
  SELECT j."ORDEM", j."CD_NFE_SAIDA", n.*
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
   WHERE j."CD_CARGA" = :cd_carga::integer
     AND n."TENANT_ID" = :tenant
),
linhas AS (
  SELECT
    c."ORDEM",
    c."NUMERO_NF",
    c."SERIE",
    c."CHAVE_NFE",
    c."XNOME_ENTREGA",
    c."XNOME_DEST",
    c."CNPJ_ENTREGA",
    c."CNPJ_DEST",
    c."XLGR_DEST",
    c."NRO_DEST",
    c."XCPL_DEST",
    c."XBAIRRO_DEST",
    c."XMUN_DEST",
    c."UF_DEST",
    c."CEP_DEST",
    (elem->>'NCM') AS ncm,
    COALESCE(elem->>'cProd', elem->>'codigo') AS codigo,
    COALESCE(elem->>'xProd', elem->>'descricao') AS descricao,
    COALESCE(elem->>'uCom', elem->>'unidade') AS unidade,
    COALESCE(
      NULLIF(trim(elem->>'qCom'), '')::numeric,
      NULLIF(trim(elem->>'quantidade'), '')::numeric,
      0
    ) AS quantidade
  FROM nf_carga c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(c."LINHAS_JSON") = 'array' THEN c."LINHAS_JSON" ELSE '[]'::jsonb END
  ) AS elem
)
SELECT *
  FROM linhas
 WHERE NULLIF(trim(ncm), '') IS NOT NULL
   AND (
     ncm LIKE '0201%' OR ncm LIKE '0202%' OR ncm LIKE '0302%' OR ncm LIKE '0305%'
     OR ncm LIKE '0203%' OR ncm LIKE '0303%' OR ncm LIKE '0304%' OR ncm LIKE '1604%'
     -- acrescente/remova prefixos acordados com o fiscal
   )
 ORDER BY "ORDEM", "NUMERO_NF", codigo;
```

**Observações:**

- Se `LINHAS_JSON` vier como string JSON em algum legado, fazer `::jsonb` no `SELECT`.
- Para **motorista na descarga**, repetir no cabeçalho de cada NF (ou por bloco `ORDEM`) o endereço montado como no front: priorizar `XNOME_ENTREGA` / `CNPJ_ENTREGA` + `XLGR_DEST`…

## Próximos passos de produto

1. ~~HTML imprimível e botões na UI~~ — feito (`wms-carga-relatorio-html.service.js`, rotas e módulos **Cargas programadas** / **Expedição**).
2. Parametrização de NCM/frio em cadastro ou tabela `WMS_NCM_CLASSE` quando quiser sair do heurístico fixo em `classificarFrioPorNcm`.
3. Opcional: PDF no servidor (mesma fonte de dados) ou `window.print()` automático ao abrir a janela.
