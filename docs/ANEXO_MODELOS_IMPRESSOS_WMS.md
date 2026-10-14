# Anexo — Modelos de impressão (PDFs de referência operacional)

**Origem:** arquivos fornecidos em `OneDrive\Área de Trabalho\` (nomes conforme envio).  
**Uso no Atlas:** especificação de **telas de impressão / relatórios PDF** e de **campos obrigatórios** para o módulo WMS (espelho, romaneio, carga, etiqueta).

---

## 1. Separação por pedido — `modelo separacao pedido 1.pdf` / `... 2.pdf`

**Cabeçalho fixo**

| Elemento | Observação |
|----------|------------|
| Título | **Conferência / Separação** |
| Campos manuais | Data, início, término, **Responsável** (linha para assinatura) |
| Operação | **MANA DO BRASIL S/A - OL** |
| Subtítulo | **PICKING - Romaneio de Separação** + temperatura: **Seco** *ou* **Refrigerado / Congelado** |
| Rota | Código regional (ex.: `[SC-07]`) + descrição de cidades |
| Referência arquivo | Data + nome do espelho `.txt` (ex.: `24/04/2026 \| 30.04 Espelho Separação Mana SC - Lote 05 QUINZENA.txt`) |

**Bloco por cliente (repete por entrega)**

| Campo | Exemplo |
|-------|---------|
| Código + nome cliente | `1141 - BIOSYN` |
| Unidade / Local | `ARAQUARI \| SC` + linha “Local:” (preenchimento manual) |
| Colunas grade | **Código** (formato pontuado `6.03.04.016.20`), **Descrição Produto**, **Quantidade** |
| Entrega | Data **Entregar** (ex.: `30/04/2026`) |
| Pallet | Coluna **Nº Pallet** (vazio no modelo — preenchimento na operação) |

**Rodapé:** data de impressão + numeração de página (`Página X de Y`).

**Diferença 1 vs 2:** o **2** exemplifica romaneio **Refrigerado/Congelado** (outra rota `[SC-02]`) e mistura exemplo de bloco **Seco** em página seguinte — útil para **dois templates** ou um único template com **flag de temperatura**.

---

## 2. Carga programada (consolidado + frio por cliente) — `modelo carga programada separacao 1.pdf` / `... 2.pdf`

### 2.1 Romaneio consolidado (`... 1.pdf`)

| Elemento | Conteúdo |
|----------|----------|
| Contexto | `[] MANA` **Expedição** — **CARREGAMENTO** |
| Título | **PICKING - Romaneio de carga** + identificador da carga (ex.: `Gera 445`) |
| Logística | **Data recebimento**, **Placa** (campo manual) |
| Conferência | Bloco igual ao espelho (data / hora / responsável) |
| Descrição da carga | Ex.: `Araucaria / Ponta Grossa` |
| Tabela **Resfriado / Congelado** | Colunas: **Código**, **Descrição**, **Unid.**, **Volumes**, **Validade**, **F.Conv.** |
| Tabela **Seco** | Mesmas colunas; totais por faixa (**Vol**, **M³**, **kg**) |
| Total geral | Peso total + campo **OBSERVAÇÃO** |
| **Rota ordenada** | Lista numerada com **DEPÓSITO (SAÍDA)** + clientes + **DEPÓSITO (RETORNO)**; coordenadas GPS entre parênteses |
| Algoritmo | Texto fixo: `Metodo: Vizinho Mais Proximo`, **KM Total** |
| **Roteiro WAZE** | Lista simplificada (só nomes + `\|`) para copiar no app |
| Auditoria | Data/hora, **CPD**, **USR**, **ID** |

### 2.2 Romaneio frio por entrega na carga (`... 2.pdf`)

| Elemento | Conteúdo |
|----------|----------|
| Título | **PICKING - Romaneio de carga - Relação de Resfriados e Congelados** + nº carga |
| Por trecho | **Cliente de Entrega** (ex.: `MANA DO BRASIL S.A. - 1109 - RICKLI`), **Local** (UF \| cidade), **Nota** (número NF) |
| Itens | Código, descrição, unidade, volumes; subtotal **X Vol.** por nota/cliente |

**Uso no sistema:** gerar **duas saídas** da mesma carga programada — (A) **consolidado** motorista/rota + mapa e (B) **checklist frio** por NF/cliente para coleta em câmara.

---

## 3. Espelho de nota (descarga NF-e) — `modelo espelho nota 1.pdf` / `... 2.pdf`

### 3.1 Modelo 1 (ex.: **TIROL** — descarga Mana)

| Elemento | Conteúdo |
|----------|----------|
| Topo | **Data recebimento**, **NF-e / Roteiro** (número + filial + endereço), **Placa** |
| Fornecedor / origem | Nome (ex.: **TIROL**) |
| Operação | **PICKING - Romaneio de carga** + **Descarga:** código (ex.: `449`) |
| Grade | **Código** (10 dígitos *sem* pontos, ex.: `6030118320`), **Descrição**, **Unidade**, **Quantidade** |
| Totais | Volumes, M³, **Região**, **Macro**, **KM da base**, peso |
| Fiscal / texto | **Emissão da NF-e**, trechos de **infCpl** (armazém geral, CNPJ vendedor, docnum NF, etc.) |

**Nota:** no PDF extraído aparece typo **“Quatidade”** — no Atlas usar **“Quantidade”**.

### 3.2 Modelo 2 (ex.: **BIOMEDICA** — expedição / descarga)

| Elemento | Conteúdo |
|----------|----------|
| Contexto | **BIOMEDICA Expedição** — **DESCARGA** |
| Grade | Códigos com máscara `000659-9` (formato diferente do modelo 1 — **dois layouts de produto** possíveis) |
| Colunas | **Validade**, **F.Conv.** presentes no cabeçalho da tabela |

**Requisito derivado:** o gerador de espelho precisa de **template por tipo de fornecedor/cadastro** (código numérico simples vs código com hífen).

---

## 4. Etiqueta de pallet — `modelo etiqueta pallet.pdf`

Cada etiqueta concentra **um item de nota** (ou uma linha de recebimento) com rastreio fiscal e estoque.

| Campo (rótulo no modelo) | Exemplo / formato | Uso WMS |
|--------------------------|-------------------|---------|
| Descrição longa | `CREME DE LEITE UHT 15%...` | Texto principal |
| **Nota fiscal** | `553367` | Vínculo ao documento |
| **Volumes** unidade principal \| secundária | `144UN \| 144 UN` | Conversão visual (principal = operação?) |
| Marca / fornecedor | `TIROL` | Origem |
| **Código produto** (dono) | `6.03.01.183.20` | De-para pontuado |
| **Chave NF-e** | 44 dígitos | Barcode Code128 / QR recomendado |
| **Emissão** | Data NF | |
| **CHEGADA** | Data recebimento físico | |
| **VALIDADE** | `13/06/2026` | Lote / perecível |
| **LOTE** | `ÚNICO` ou alfanumérico | |
| **EAN** | `7896294901979` | Barcode EAN13 |
| **Sequencial etiqueta** | `0000788` | Controle interno / reimpressão |
| Nome curto / SKU display | `CREME LEITE TP 1 KG` | Segunda linha comercial |
| **Dono do estoque** | `MANA` | Titular do saldo |

**P1 (modelo etiqueta):** **atendido** para levantamento de campos; falta apenas **definição gráfica** (tamanho mm, fontes, margens) se for impressão térmica vs A4.

---

## 5. Cruzamento com integração OPL (`.txt`)

| Artefato | Relação |
|----------|---------|
| Romaneio separação | Lista **mesmos códigos** que no `.txt` tipo `3` (ex.: `6.03.04.016.20`), porém **pontuados** no PDF vs **sem pontos** no TXT em alguns casos — **normalização** na importação. |
| Carga programada | Agrega vários pedidos + **Nota** por cliente no modelo 2 — amarra **pedido OPL** → **NF saída** → **carga**. |
| Etiqueta | Liga **NF** + **código dono** + **validade/lote** + **EAN** — pós-recebimento conferido. |

---

*Texto extraído dos PDFs via leitura automática; conferir visualmente os originais para margens, logos e campos que possam ser só gráfico.*
