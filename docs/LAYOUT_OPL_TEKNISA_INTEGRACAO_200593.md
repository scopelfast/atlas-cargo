# Layout OPL / espelho separação — Integração WMS (solicitação **200593**)

**Fonte:** `Integracao_OPL.pdf` (Teknisa — integração com software WMS; relatórios **SUP07910.QR2** / retorno **SUP07911.QR2**).  
**Convenção:** posições **INICIO** e **TAM** no documento original são **1-based** (primeiro caractere da linha = posição 1). Para implementação em código, usar **offset 0-based = INICIO − 1**.

**Repetição de campos nos anexos:** trechos do PDF repetem blocos (ex.: transportadora / redespacho) para facilitar a leitura no papel — no arquivo real cada campo aparece **uma vez** na posição indicada.

---

## Registro tipo **1** — cabeçalho do arquivo

**Regra:** a linha deve começar com o caractere fixo **`1`**.  
**Comprimento total da linha (campos obrigatórios + opcionais até CODIGO ESTOQUE):** **285** caracteres (posição final 277 + TAM 9 − 1).

| NOME DO CAMPO | TP | INICIO | TAM | DESCRIÇÃO resumida | OBRIG. |
|---------------|----|--------|-----|-------------------|--------|
| IDENTIFICADOR | A | 1 | 1 | Fixo `1` | SIM |
| CNPJ_CPF_CLI | A | 2 | 14 | CGC do cliente (sem separadores) | SIM |
| CLI_NOME | A | 16 | 50 | Razão social | SIM |
| DATA_ARQ | A | 66 | 6 | Data geração do arquivo **DDMMAA** | SIM |
| ID_UTENSILIOS | A | 72 | 1 | Utensílios: `S`/`N`; vazio = `N` | NÃO |
| CNPJ_CPF_TRANSP | A | 73 | 14 | CNPJ transportadora | NÃO |
| RAZ_SOCIAL_TRANSP | A | 87 | 50 | Razão social transportadora | NÃO |
| ENDERECO_TRANSP | A | 137 | 50 | Endereço transportadora | NÃO |
| CIDADE_TRANSP | A | 187 | 30 | Cidade transportadora | NÃO |
| ESTADO_TRANSP | A | 217 | 2 | UF transportadora | NÃO |
| BAIRRO_TRANSP | A | 219 | 30 | Bairro transportadora | NÃO |
| CEP_TRANSP | A | 249 | 8 | CEP transportadora | NÃO |
| IE_TRANSP | A | 257 | 20 | Inscrição estadual transportadora | NÃO |
| CODIGO ESTOQUE | A | 277 | 9 | COD_EMP + COD_FIL + estoque | NÃO |

**Vazio:** campos não obrigatórios preencher com **espaços** quando ausentes (conforme PDF).

---

## Registro tipo **2** — cabeçalho pedido / NF

**Comprimento total da linha (último campo conhecido):** **848** caracteres (COD_AUTORIZACAO inicia em **819**, TAM **30**).

### Bloco inicial (destino + pedido + pesos + NF)

| NOME DO CAMPO | TP | INICIO | TAM | DEC | DESCRIÇÃO resumida | OBRIG. |
|---------------|----|--------|-----|-----|-------------------|--------|
| IDENTIFICADOR | A | 1 | 1 | | Fixo `2` | SIM |
| COD_DESTINATARIO | A | 2 | 10 | | Código destinatário (loja/unidade) | BRANCO |
| RAZ_SOC_DESTINATARIO | A | 12 | 50 | | Razão social destinatário | SIM |
| ENDE_ENTREGA | A | 62 | 50 | | Endereço entrega | SIM |
| BAIRRO_ENTREGA | A | 112 | 20 | | Bairro | SIM |
| CEP_ENTREGA | A | 132 | 9 | | CEP (ex.: 20123001) | SIM |
| CIDADE_ENTREGA | A | 141 | 25 | | Cidade | SIM |
| ESTADO_ENTREGA | A | 166 | 2 | | UF | SIM |
| NUM_PEDIDO | A | 168 | 10 | | Nº pedido cliente | SIM |
| DATA_PEDIDO | A | 178 | 6 | | **DDMMAA** | SIM |
| QTDE_ITENS | N | 184 | 4 | | Qtd itens (ex.: 0125) | SIM |
| VLR_TOT_PRODUTOS | N | 188 | 13 | 2 | Valor total produtos | SIM |
| PESO_LIQ_PEDIDO | N | 201 | 10 | 3 | Peso líquido | SIM |
| NUM_NF | A | 211 | 10 | | Número NF (*obrigatório 2º envio*) | ESPAÇOS |
| SIF | A | 221 | 10 | | SIF | NÃO |
| NUM_CARGA | A | 231 | 10 | | Número carga | NÃO |
| PESO_BRT_PEDIDO | N | 241 | 10 | 3 | Peso bruto | SIM |
| CNPJ_CPF_DEST | A | 251 | 14 | | CNPJ/CPF destinatário | SIM |
| SERIE_NF | A | 265 | 3 | | Série NF (*obrigatório 2º envio*) | ESPAÇOS |
| DATA_NF | A | 268 | 8 | | Emissão NF **DDMMAAAA** | ESPAÇOS |
| DATA_ENTREGA | A | 276 | 8 | | Programação entrega **DDMMAAAA** | SIM |
| HORA_ENTREGA1 | A | 284 | 5 | | Início janela **HH:MM** | NÃO |
| HORA_ENTREGA2 | A | 289 | 5 | | Fim janela **HH:MM** | NÃO |
| HORA_ENTREGA3 | A | 294 | 5 | | (*continuação janelas*) | NÃO |
| HORA_ENTREGA4 | A | 299 | 5 | | | NÃO |

### Bloco valores / frete / redespacho (transcrição visual do anexo)

Entre **304** e **351** constam quatro valores numéricos (12 posições, 2 decimais), obrigatórios no **2º envio** (conforme cores do PDF): **VALOR_ICMS**, **VALOR_IPI**, **VALOR_ICMS_ST**, **VALOR_TOT_NF** — posições exatas **304–315**, **316–327**, **328–339**, **340–351** (hipótese contígua; **validar no PDF**).

| NOME DO CAMPO | TP | INICIO | TAM | DESCRIÇÃO resumida |
|---------------|----|--------|-----|-------------------|
| TIPO_FRETE | A | 352 | 1 | `C` CIF / `F` FOB / `R` redespacho |
| CNPJ_REDEBP | A | 353 | 14 | CNPJ redespacho |
| RAZ_SOC_REDEBP | A | 367 | 50 | Razão redespacho |
| ENDE_REDEBP | A | 417 | 50 | Endereço redespacho |
| CEP_REDEBP | A | 467 | 8 | CEP redespacho |
| CIDADE_REDEBP | A | 475 | 30 | Cidade redespacho |
| BAIRRO_REDEBP | A | 505 | 20 | Bairro redespacho |
| ESTADO_REDEBP | A | 525 | 2 | UF redespacho |
| INSCR_EST_DEST | A | 527 | 14 | IE destino (`ISENTO` se isento) |
| INSCR_EST_REDEBP | A | 541 | 14 | IE redespacho |
| CHAVE_NFE | A | 555 | 44 | Chave NF-e (*obrigatório 2º envio* se CT-e) |
| QTDE_VOLUMES_NF | A | 599 | 6 | Volumes NF (zeros à esquerda) |
| CNPJ_CPF_TRANSP | A | 605 | 14 | CNPJ transportadora |
| RAZ_SOCIAL_TRANSP | A | 619 | 50 | Razão transportadora |
| FONE_DESTINO | A | 669 | 50 | Telefone destino |
| EMAIL_DESTINO | A | 719 | 100 | E-mail destino |
| COD_AUTORIZACAO | A | 819 | 30 | Código autorização transporte |

---

## Registro tipo **3** — linha de item

O PDF original contém a tabela completa do tipo `3` (produto, quantidades, `COD_PRODUTO`, volumes, etc.). **Não reproduzida aqui linha a linha** — usar o **mesmo PDF** como fonte da verdade; o projeto mantém inferência parcial em `docs/LAYOUT_ESPELHO_SEPARACAO_MANA_TXT.md` (amostra curta) até congelar `layout_opl_v1`.

---

## Arquivos curtos (ex.: Mana — 71 / 540 / 149 caracteres)

Alguns exports contêm **apenas o prefixo** da especificação (ex.: cabeçalho tipo 1 com **71** caracteres = campos até **DATA_ARQ**, sem transportadora). O parser deve aceitar **linha mais curta** que o máximo teórico, tratando ausência como **espaços** ou *trim* controlado.

---

## O que ainda falta para “fechar o ponto”

| Item | Situação |
|------|----------|
| Dicionário tipo **3** completo no repositório | Pendente: extrair tabela do PDF (ou anexar página como referência interna). |
| **Registro retorno** SUP07911 | Para implementação de carga de volta / conciliação. |
| **Fixtures** de teste | Manter amostras anonimizadas em `docs/amostras/` + testes unitários de *slice*. |
| **Versão de layout** | Campo/config `layout_opl_mana_sc_v1` vs `teknisa_285_848` após validar com operação. |

Com o **PDF** + esta transcrição + amostra Mana, já é possível iniciar o **parser posicional** e marcar campos “a confirmar” com testes de regressão quando chegarem novos arquivos.

### Implementação Atlas (MVP)

- **DDL:** `backend/scripts/wms_separacao_opl_postgres.sql` (executar no PostgreSQL do tenant).  
- **API:** `POST /api/wms/separacao/opl/importar` (multipart `arquivo` + opcional `CD_DONO`), `GET /api/wms/separacao/opl/importacoes` (filtros opcionais: `codDest`, `nomeDest`, `cidade`, `uf`, `numPedido`, `nmArquivo` — restringem a arquivos com pedido destino correspondente), `GET .../importacoes/:cdOplArquivo`, `DELETE .../importacoes/:cdOplArquivo`, `PUT .../importacoes/:cdOplArquivo/picking` (body `{ "itens": [{ "cdOplItem", "qtColetada" }] }`).  
- **Romaneio impressão:** `GET .../importacoes/:cdOplArquivo/romaneio?conservacao=todos|refri|seco&agruparItens=0|1&folhas=dest|continuo` — HTML (agrupa por destinatário; conservação prioriza `WMS_PRODUTO_DONO.TIPO_ARMAZENAGEM` + categoria por match de código só-dígitos e `CD_DONO` do espelho quando houver; fallback heurística na descrição). Serviço: `backend/services/wms-opl-relatorio-romaneio.service.js`.  
- **Parser:** `backend/services/wms-opl-parser.service.js` (linha tipo **3** com offsets **0-based** Mana; tipos **1** e **2** com campos **1-based** PDF).  
- **Torre:** módulo `estoque-separacao` — importar `.txt`, listar, abrir detalhe, informar **qtd coletada** e salvar; botão **Gerar romaneio** na aba Detalhe.

---

*Documento alinhado aos anexos enviados (cabeçalho arquivo, tipo 2 e continuação). Ajustar numeração se o PDF oficial divergir em revisão posterior.*
