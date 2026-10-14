# Layout TXT — Espelho de separação Mana SC (inferido)

**Origem:** arquivo operacional *“28.04 Espelho Separação Mana SC - Lote 10.txt”* (Mana / Maranata).  
**Fixture no repositório:** `docs/amostras/mana-espelho-separacao-lote10.txt` (mesmo conteúdo, para testes e parser).

**Aviso:** posições e significados abaixo foram **deduzidos** a partir de **uma linha** de cada tipo. A especificação **oficial** (registros tipo **1** e **2** com INICIO/TAM 1-based) está em **`docs/LAYOUT_OPL_TEKNISA_INTEGRACAO_200593.md`** (PDF **200593** / `Integracao_OPL.pdf`). O anexo geral continua em `docs/ANEXO_LAYOUTS_OPL_NFE_AMOSTRAS.md`.

---

## Visão geral

| Linha | 1º caractere “lógico” | Uso |
|-------|------------------------|-----|
| **1** | `1` + CNPJ 14 dígitos (conforme PDF) | Cabeçalho do arquivo; amostra **71** chars = obrigatório até **DATA_ARQ** (sem bloco transportadora). |
| **2** | `2` | Cabeçalho do **pedido / ponto de entrega** (cliente, endereço, UF, bloco numérico com pedido/data, CNPJ destino, telefone). |
| **3** | `3` | **Item** do pedido (descrição, blocos numéricos, código produto OL, quantidade). |

Comprimentos na amostra: linha **1** = **71** caracteres; linha **2** = **540**; linha **3** = **149**.

---

## Linha 1 — cabeçalho do arquivo (71 caracteres)

| Offset (0-based) | Tamanho | Conteúdo (amostra) | Observação |
|------------------|---------|---------------------|------------|
| 0–0 | 1 | `1` | **IDENTIFICADOR** fixo (PDF). |
| 1–14 | 14 | `02143616012668` | **CNPJ_CPF_CLI** (14 dígitos sem separadores; na amostra: substring índices 1–14 da linha). |
| 15–64 | 50 | `MANA DO BRASIL S/A - OL` + espaços | **CLI_NOME** (50). |
| 65–70 | 6 | `270426` | **DATA_ARQ** **DDMMAA** (27/04/2026). |

> **Nota:** A linha completa do PDF tem **285** caracteres (até **CODIGO ESTOQUE**). Esta exportação Mana **corta** após a data (71 chars) — o parser deve aceitar linha curta e tratar o restante como ausente / espaços.

---

## Linha 2 — cabeçalho do pedido / entrega (540 caracteres)

| Offset (0-based) | Tamanho | Conteúdo (amostra) | Observação |
|------------------|---------|---------------------|------------|
| 0 | 1 | `2` | Tipo de registro. |
| 1–6 | 6 | espaços | Reservado / alinhamento. |
| 7–10 | 4 | `5001` | Código do **destino** / cliente (numérico, zeros à esquerda se aplicável). |
| 11–60 | 50 | `SABORVILLE` + espaços | Nome fantasia / ponto de entrega. |
| 61–110 | 50 | `THEONESTO WESTRUPP, 680` + espaços | Logradouro + número. |
| 111–139 | 29 | `AVENTUREIRO` + espaços + `89226340` + espaço | Bairro + **CEP** (8 dígitos) no bloco fixo. |
| 140–166 | 27 | `JOINVILLE` + espaços + `SC` | Cidade (9) + preenchimento + **UF** (2). |
| 167–209 | 43 | `0000061786280426000100000000210000000000000` | Bloco **somente dígitos**. Ver decomposição sugerida abaixo. |
| 210–239 | 30 | espaços | Separador / reservado. |
| 240–263 | 24 | `000000000002143616000147` | **CNPJ do destinatário** com zeros à esquerda (amostra → **02143616000147**). |
| 264–525 | 262 | espaços | Área reservada / filler. |
| 526–534 | 9 | `253586755` | Provável **telefone** / contato (só dígitos na amostra). |
| 535–539 | 5 | espaços | Fim de linha. |

### Decomposição sugerida do bloco **167–209** (43 dígitos)

String na amostra: `0000061786280426000100000000210000000000000`  
Partição **10 + 6 + 12 + 15 = 43** (hipótese; validar com Mana / SUP07910):

| Parte | Dígitos | Valor (amostra) | Hipótese |
|-------|---------|-----------------|----------|
| A | 10 | `0000061786` | Número do **pedido** / referência OL (cruza com sufixo `0061786` na linha 3). |
| B | 6 | `280426` | Data **DDMMAA** ou **AAMMDD** — **confirmar**. |
| C | 12 | `000100000021` | Quantidade ou valor agregado (formato a validar). |
| D | 15 | `0000000000000` | Reservado / totais. |

> Ajuste fino dentro dos **43** dígitos com **mais de um pedido** e com o PDF **SUP07910**.

---

## Linha 3 — item (149 caracteres)

| Offset (0-based) | Tamanho | Conteúdo (amostra) | Observação |
|------------------|---------|---------------------|------------|
| 0 | 1 | `3` | Tipo de registro. |
| 1–10 | 10 | espaços | Sequência de linha / reservado (amostra só com espaços). |
| 11–60 | 50 | `FRANGO CONG MOELA - CX 20 KG` + espaços | Descrição do produto (espelho comercial). |
| 61–97 | 37 | `0001000002100000000000000000000061786` | Bloco numérico (quantidades / valores / vínculo pedido — **detalhar com Mana**). |
| 98–108 | 11 | espaços | Separador fixo. |
| 109–118 | 10 | `6010127260` | **Código produto OL** (árvore do operador / CD), alinhado ao conceito `COD_PRODUTO` Teknisa. |
| 119–128 | 10 | espaços | Reservado / alinhamento. |
| 129–138 | 10 | `0000000001` | **Quantidade** pedida (1 na amostra), zeros à esquerda. |
| 139–148 | 10 | espaços | Fim de linha. |

O sufixo **`0061786`** no bloco **61–97** parece amarrar a linha ao **pedido** visto na linha 2 (`0000061786`), útil para agrupar itens por pedido na importação.

---

## Próximos passos sugeridos

1. Pedir ao Mana **2–3 arquivos** com mesmo layout (vários itens na linha 3, vários pedidos na linha 2) e **mapa oficial** de colunas, se existir.  
2. Cruzar com **SUP07910** e marcar diferenças como **versão de layout** (`mana_sc_v1` vs `teknisa_v1`).  
3. Implementar parser **por offsets** versionados + teste unitário usando `docs/amostras/mana-espelho-separacao-lote10.txt`.

---

*Documento gerado a partir da amostra única; revisar após validação com o fornecedor do layout.*
