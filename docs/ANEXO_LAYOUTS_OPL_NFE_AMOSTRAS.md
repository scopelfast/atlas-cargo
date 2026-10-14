# Anexo — Layouts reais (OPL / Teknisa) e NF-e (amostras Sinai)

**Objetivo:** registrar o que foi inferido a partir dos arquivos **fornecidos pelo time** (textos de separação, PDF de especificação, XMLs de entrada e saída), para alimentar implementação futura **sem** versionar no Git conteúdo fiscal sensível (chaves completas, XML integral).

**Fontes analisadas (caminhos locais da máquina de desenvolvimento):**

- Espelhos `.txt`: pasta `Maranata` (Mana / Nutriville, vários lotes).  
- Especificação: `Integracao_OPL.pdf` (solicitação **200593** — integração WMS / exportação OL Teknisa, relatórios **SUP07910.QR2** e retorno **SUP07911.QR2`). Cópia de trabalho: `Maranata\Integracao_OPL.pdf` (OneDrive).  
- **Transcrição estruturada no repositório:** `docs/LAYOUT_OPL_TEKNISA_INTEGRACAO_200593.md` (registros tipo **1** e **2** com INICIO/TAM oficiais; tipo **3** ainda pelo PDF).  
- NF-e: `c:\SGE\Local\XML\Entrada\` (3 arquivos) e `c:\SGE\Local\XML\Saida\` (4 arquivos `*-nfe.xml`).

---

## 1. Arquivo texto “Pedidos do OL – Separação” (layout Teknisa / OPL)

### 1.1 Estrutura em três níveis (oficial no PDF)

| Identificador | Significado |
|---------------|-------------|
| **1** | Cabeçalho do arquivo (uma linha): CNPJ/CPF do cliente Teknisa (exemplo no PDF: empresa código 01), nome do cliente, data/hora (`DATA_ARQ`, formato compacto no exemplo). |
| **2** | Cabeçalho do **pedido** / entrega: destinatário, endereço de entrega, número do pedido (`NUM_PEDIDO` / `USR_NRPEDIDO`), data de entrega, quantidade de itens, valores e pesos agregados, número da NF de saída quando já existir, CNPJ do destino, etc. |
| **3** | Linha de **item**: produto (descrição), quantidades, valores, peso, vínculo ao `NUM_PEDIDO`, código do produto na **árvore do operador logístico** (`COD_PRODUTO`), volumes (`QTDE_VOLUMES`). |

### 1.2 Confirmação nas amostras reais

**Linha tipo 1** (ex.: Mana / Nutriville):

- Primeiro caractere: `1`.  
- Em seguida: **CNPJ de 14 dígitos** do dono operacional (ex.: destino Mana / emitente Nutriville conforme arquivo).  
- Nome abreviado (ex.: `MANA DO BRASIL S/A - OL`, `NUTRIVILLE RESTAURANTE S/A`) em campo alfanumérico preenchido com espaços.  
- Fechamento com **data compacta** `YYMMDD` (ex.: `220426`, `240426` — alinhado ao conceito `DATA_ARQ` do PDF).

**Linha tipo 2** (cabeçalho de pedido por ponto de entrega):

- Inicia com `2`.  
- Contém: código de destino (ex.: `1154`, `6013`), razão/nome fantasia do local, logradouro, bairro, CEP, cidade, UF, bloco numérico longo (pedido, data, totais, NF quando houver), CNPJ do destinatário ao final do registro (ex.: `9059959872` truncado na amostra visual — no parser usar largura fixa conforme spec completa do PDF).

**Linha tipo 3** (item):

- Inicia com `3`.  
- Descrição do produto (ex.: `BACON DEFUMADO - CX 10 KG`).  
- Campos numéricos alinhados à direita com zeros (quantidade, valor unitário/custo, peso, referência ao pedido).  
- **Código interno OL** (ex.: `6010305100`, `6320200100`) — corresponde ao `COD_PRODUTO` da especificação (árvore do operador logístico).  
- Quantidade final (ex.: `0000000002` caixas).

> **Importante:** o PDF define também o fluxo de **retorno** da separação (SUP07911.QR2) e telas de **conciliação** Teknisa × OL — úteis para desenhar a **carga de volta** e conferência no Atlas.

### 1.3 Espelho Mana SC — dicionário posicional (amostra única)

Foi inferido um mapa **campo a campo** (offsets e comprimentos) a partir do arquivo *“28.04 Espelho Separação Mana SC - Lote 10.txt”*, alinhado à mesma ideia de linhas **1 / 2 / 3**. A **linha 1** da amostra (**71** caracteres) coincide com o **prefixo obrigatório** do registro tipo **1** do PDF (**285** caracteres até transportadora + código estoque) — ver `docs/LAYOUT_OPL_TEKNISA_INTEGRACAO_200593.md`.

- **Detalhe da amostra curta:** `docs/LAYOUT_ESPELHO_SEPARACAO_MANA_TXT.md`  
- **Fixture:** `docs/amostras/mana-espelho-separacao-lote10.txt`

**Pendência:** validar com Mana; tipo **3** completo e retorno **SUP07911** a partir do PDF.

---

## 2. NF-e de **entrada** (fornecedor → Mana / CD)

Padrão observado: `nfeProc` / `NFe` / `infNFe`, modelo **55**, `tpNF=1` (saída do emitente = entrada no destino).

**Nós úteis para recebimento no WMS:**

| Caminho (conceitual) | Uso no Atlas |
|----------------------|--------------|
| `emit/CNPJ`, `emit/xNome` | **Fornecedor** (cadastro ou criação na importação). |
| `dest/CNPJ`, `dest/xNome`, `dest/enderDest/*` | **Cliente / filial** destino (Mana Colombo, etc.). |
| `det/prod/cProd` | Código do item na **NF do fornecedor** (de-para para código do dono do estoque). |
| `det/prod/xProd` | Descrição comercial. |
| `det/prod/NCM`, `CEST` (quando houver) | Classificação fiscal / categorização logística. |
| `det/prod/uCom`, `det/prod/qCom`, `det/prod/uTrib`, `det/prod/qTrib` | **Unidade e quantidade** — base para **fator de conversão** quando UOM operacional ≠ NF. |
| `det/prod/xPed` | Pedido de compra (rastreio). |
| `infNFe/@Id` / `protNFe/infProt/chNFe` | Chave da NF (armazenar **hash** ou últimos dígitos na UI se política de privacidade exigir). |
| `transp/vol/*` | Volumes e peso (conferência física / doca). |

**Observação:** exemplos analisados trazem `verProc` de ERP terceiro (ex.: **Senior**); isso não altera o layout da NF-e, apenas a origem do XML.

---

## 3. NF-e de **saída** (Nutriville → filial / ponto de consumo)

Padrão observado: `emit` = Nutriville; `dest` = filial com CNPJ; bloco **`entrega`** com endereço **diferente** do `dest` quando a entrega é em unidade/cozinha específica.

**Nós úteis para expedição / roteirização:**

| Caminho | Uso no Atlas |
|---------|--------------|
| `dest/*` | Tomador / filial fiscal. |
| `entrega/*` (CNPJ, xNome, xLgr, nro, xBairro, cMun, xMun, UF, CEP) | **Ponto de entrega operacional** — confirma o requisito “mesmo CNPJ, endereços variados no XML”. |
| `det/prod/cProd` | Código já na **árvore do operador** (bate com linhas tipo `3` do txt — ex.: `6010156800`). |
| `det/prod/xPed` + `infAdProd` | Número da **ordem de pedido** Teknisa/OPL (ex.: `0000060939`) — chave de amarração pedido ↔ NF ↔ separação. |
| `det/prod/uCom` vs `uTrib` | Exemplo visto: `uCom=CX`, `uTrib=KG` com quantidades — reforça necessidade de **conversão explícita** no cadastro/recebimento. |
| `ide/verProc` | Ex.: `TEK_OPL_6.59.012` — indica geração via stack **Teknisa** (útil para suporte e rastreio de layout). |

---

## 4. Próximos passos técnicos sugeridos

1. **Extrair do PDF** a tabela completa de **posições e larguras** de cada campo nas linhas `1`, `2` e `3` (o texto exportado perde formatação fixa; o layout oficial está no documento SUP07910).  
2. Definir no Atlas um **parser configurável** (posicional vs. delimitado) versionado por **“layout OPL v1”**.  
3. Mapear `COD_PRODUTO` do txt ↔ `cProd` da NF de entrada/saída ↔ **SKU interno** (tabela de-para por `dono do estoque`).  
4. **Não** commitar XMLs completos no repositório; usar fixtures **anonimizadas** em `backend/tests/fixtures/nfe/` quando houver testes automatizados.

---

## 5. Modelos de impressão (PDF)

Os romaneios e a **etiqueta de pallet** usados na operação estão descritos em **`docs/ANEXO_MODELOS_IMPRESSOS_WMS.md`** (espelho picking, carga programada, espelho de nota, etiqueta).

---

*Documento gerado a partir da análise das amostras; revisar com o PDF integral para fechar larguras fixas campo a campo.*
