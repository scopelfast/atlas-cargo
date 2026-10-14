# Registro — Conferência em lote Uberlândia (NF Nutriville)

**Data da gravação:** 22/07/2026  
**Tenant:** `default`  
**Dono do estoque:** `2` — Nutriville  
**Ação:** apenas **Salvar conferência** (não houve Encerrar)  
**Conferente gravado:** `Uberlândia / planilha LISTA CONFERENCIA NUTRI`  
**Data de recebimento (doca):** `2026-07-06`  
**Usuário técnico no banco:** `SCRIPT_UBERLANDIA` (`SG_USER_CONFERENCIA`)

## Objetivo

Dar entrada operacional nas 10 NF-e que estavam só importadas, preenchendo **quantidade recebida** e **validade** com base na planilha de conferência física, **sem ultrapassar** a quantidade de cada item na NF, para o usuário revisar NF a NF e só então encerrar.

## Fontes usadas

| Fonte | Caminho / conteúdo |
|--------|---------------------|
| Itens das NF (export WMS) | `c:\Users\scope\Downloads\wms-recebimento-entrada-itens-20260722.csv` (264 linhas / 10 NF) |
| Conferência física | `c:\Users\scope\OneDrive\Área de Trabalho\LISTA CONFERENCIA NUTRI - UBERLANDIA.xlsx` — aba **RELAÇÃO** (qtd Total + validade); aba **LISTA CONFERENCIA** só para reforçar **validade mais curta** quando havia mais de uma |
| Script | `backend/scripts/wms-conferir-uberlandia-lote.js` |

## NF-e afetadas (CD_NFE → número)

| CD_NFE | Número NF | Chave (final) | Itens com qtd &gt; 0 | Qtd recebida (soma) | Qtd NF (soma) |
|--------|-----------|---------------|---------------------|---------------------|---------------|
| 241 | 246 | …000246…08156 | 1 | 1 | 1 |
| 242 | 247 | …000247…08161 | 44 | 8.222 | 10.185 |
| 243 | 248 | …000248…08177 | 48 | 5.768 | 21.355 |
| 244 | 251 | …000251…08229 | **0** | 0 | 1 |
| 245 | 252 | …000252…08234 | **0** | 0 | 19 |
| 246 | 253 | …000253…08240 | 7 | 40 | 9.011 |
| 247 | 254 | …000254…08255 | 4 | 39 | 779 |
| 248 | 255 | …000255…08260 | 2 | 5 | 70 |
| 249 | 256 | …000256…08276 | 25 | 1.256 | 20.557 |
| 250 | 257 | …000257…08281 | 7 | 300 | 1.104 |

Todas ficaram com `FG_CONFERIDO = 'S'` e `DT_RECEBIMENTO = 2026-07-06`.

## Regras aplicadas (importante para auditoria de estoque)

1. **Cruzamento** por código de produto (dígitos / código estoque resolvido via de-para + cadastro do dono 2).
2. **Quantidade recebida** = `min(qtd do item na NF, saldo ainda disponível do Total da RELAÇÃO)` para aquele código.
3. Distribuição do Total da planilha: NF em ordem de **número crescente** (246 → 257), consumindo o saldo da planilha.
4. **Nunca** gravou quantidade acima da linha da NF.
5. **Validade** = da RELAÇÃO; se a LISTA tinha outra data para o mesmo código, ficou a **mais curta**.
6. Item da NF **sem** código correspondente (ou sem saldo) na RELAÇÃO → **`qtdRecebida = 0`** (e sem validade).  
   - Significado: “não entrou / não conferido na planilha”, **não** é baixa de estoque.  
   - No **Encerrar**, só entra no ledger o que tiver **qtd &gt; 0**.
7. **Não** foi feito Encerrar nesta operação.
8. ~**78** linhas de item ficaram com 0 por falta de match na planilha.  
9. ~**77** códigos da planilha sobraram (não alocados nestas 10 NF — outro documento ou código com sufixo diferente, ex. `.041.00` na planilha vs `.041.20` na NF).  
10. ~**20** linhas com validade **&lt; 90 dias** (política do dono) foram **gravadas mesmo assim**; o **Encerrar** exigirá liberação de supervisor.

## Encerramento (baixar estoque) — 23/07/2026

**Ação:** `ST_RECEBIMENTO = ENCERRADA` nas 10 NF (script `backend/scripts/wms-encerrar-uberlandia-lote.js`).  
**NF 246** já estava encerrada antes deste passo.

### Correções no encerrar

- Front do Recebimento: validade/lote **só obrigatórios se qtd &gt; 0** (antes bloqueava Encerrar no item 1 com qtd 0).
- Azeite `6.03.17.045.20`: planilha tinha texto inválido `31/11/27` → gravado **`2027-11-30`** (último dia válido de novembro) nas linhas com qtd &gt; 0 (NF 247 itens 12–13; NF 257 item 9).
- Validades &lt; 90 dias: registradas em `WMS_RECEBIMENTO_LIBERACAO_VALIDADE` (`TP_ACAO=ENCERRAR`, operador `SCRIPT_UBERLANDIA`).

### Lembrete para análise de furo

Estoque de entrada destas NF passa a contar nos relatórios de Posição **após ENCERRADA**, só nas linhas com **qtdRecebida &gt; 0**. Zeros não entram no saldo.


## Se houver divergência de estoque depois

Passar para análise com:

- `CD_NFE` / número / chave  
- Código produto (NF e dono)  
- Qtd NF × qtd conferida × o que o físico/planilha diziam  
- Se já **encerrou** e quando  
- Trecho do relatório Posição / Movimentação do SKU  

Conferir neste registro se a linha foi **0 de propósito** (sem planilha) ou se houve **match errado de código** / validade.

## Comando (reexecução só se necessário)

```bash
cd backend
node scripts/wms-conferir-uberlandia-lote.js --dry-run   # só simula
node scripts/wms-conferir-uberlandia-lote.js             # grava de novo (sobrescreve CONFERENCIA_JSON)
```

**Atenção:** rodar de novo **sem** dry-run sobrescreve a conferência atual dessas chaves com a mesma lógica da planilha da época.
