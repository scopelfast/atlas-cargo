# Piloto / produção WMS — catálogo OL (CDPRODESTO) e limpeza

**Regra de ouro:** todo **saldo, inventário, OPL, expedição e reserva** usam o produto de **estoque** (`WMS_PRODUTO_DONO`, código = **CDPRODESTO** com máscara do dono).  
Códigos **operacionais** (`CDPRODUTO`, outras UM) ficam em `WMS_PRODUTO_OPERACIONAL` com **VRFATOCONV** / **VRARREDEMPPR**.

---

## 1. Scripts SQL (rodar uma vez no PostgreSQL)

Ordem sugerida:

```text
backend/scripts/adicionar_wms_produto_operacional_postgres.sql
```

(Opcional, se ainda houver códigos sem máscara no cadastro:)

```text
backend/scripts/wms_auditar_codigo_produto_postgres.sql
backend/scripts/wms_normalizar_codigo_produto_postgres.sql
```

**Duplicatas (mesmo SKU com e sem ponto)** — típico após import XML + import OL no **mesmo dono** (repita nos dois donos se importou nos dois):

```text
backend/scripts/wms_unificar_duplicados_produto_postgres.sql        -- só AUDITORIA (não altera banco)
backend/scripts/wms_unificar_duplicados_produto_APLICAR_postgres.sql  -- EXCLUI duplicados (pgAdmin F5)
backend/scripts/adicionar_wms_produto_dono_indice_chave_sku_postgres.sql
```

1. (Opcional) Rode o script de auditoria e revise os SELECTs.
2. Rode **`wms_unificar_duplicados_produto_APLICAR_postgres.sql`** inteiro no pgAdmin → aba **Messages** deve mostrar `EXCLUIR #340, manter #2100` e `Produtos EXCLUÍDOS`.
3. Confirme no SQL final: só uma linha para Farinha Rosca; no Cadastros: **Filtrar** de novo ou Ctrl+F5.
4. Rode o índice de chave SKU.

Imports (XML e OL) e o cadastro manual passam a buscar pelo **mesmo SKU em dígitos**, não só texto igual.

---

## 2. Limpar operação (homologação / recomeçar piloto)

**Não apaga:** dono, armazém, produtos, `WMS_PRODUTO_OPERACIONAL`.

**Apaga agora também:**

- NF-e entrada/saída (Recebimento)
- Liberações de validade no recebimento
- Log do job **Relatório vencimento** (`WMS_RELATORIO_VENCIMENTO_ENVIO`)
- Inventário, movimentos, OPL, cargas, de-para operacional

```text
backend/scripts/wms_limpar_movimento_operacional_postgres.sql
```

Depois: **Ctrl+F5** no navegador e reabrir o módulo Recebimento — a lista de NF-e e o painel de vencimento devem ficar vazios.

---

## 3. Importar catálogo OL (planilha `exportar.xlsx`)

Pré-requisito: dono cadastrado (ex. Nutriville `CD_DONO=2`) com **máscara de código** em Cadastros → Dono do estoque.

Na pasta `backend`:

```powershell
node scripts/wms_import_catalogo_ol.js --arquivo "C:\Users\scope\Downloads\exportar.xlsx" --cd-dono 2 --tenant default
```

Dry-run (não grava):

```powershell
node scripts/wms_import_catalogo_ol.js --arquivo "...\exportar.xlsx" --cd-dono 2 --dry-run
```

Isso carrega:

- **6.375** SKUs de estoque (nível 5, `CDPRODESTO`)
- **6.375** vínculos operacionais (`CDPRODUTO` + fator)

---

## 4. Sequência operacional Nutriville (sua vez)

| # | Ação | Onde |
|---|------|------|
| 1 | Rodar SQL + limpar operação | pgAdmin |
| 2 | Importar catálogo OL | comando acima |
| 3 | Conferir cadastro | Cadastros WMS → Produto (filtro Nutriville) |
| 4 | Inventário inicial | WMS Inventário → importar CSV → **Encerrar** |
| 5 | Conferir saldo | WMS Relatórios → Posição |
| 6 | Recebimento NF-e | Importar XML + de-para fornecedor (cProd) |
| 7 | OPL / picking | Separação (dono + estoque OK). De-para OPL: `backend/scripts/wms_gerar_depara_opl_catalogo_postgres.sql`; espelho teste: `docs/WMS_PILOTO_ESPELHO_OPL_MINIMO.md` |
| 8 | Carga + expedição | Cargas / Expedição com dono — roteiro: `docs/WMS_PILOTO_CICLO_CARGA_NFE_SAIDA.md` + XML `docs/amostras/nfe-saida-piloto-nf13243-minimo.xml` |

**Backlog (após o ciclo):** consulta de disponibilidade/reservas por produto → `docs/WMS_BACKLOG_CONSULTA_DISPONIBILIDADE_PRODUTO.md`

---

## 5. De-para em camadas (como você descreveu)

1. **NF fornecedor** (`cProd` + CNPJ) → `WMS_DEPARA_PRODUTO` → código interno / estoque  
2. **Operacional OL** (`CDPRODUTO` na nota/planilha) → `WMS_PRODUTO_OPERACIONAL` → **CDPRODESTO** + fator  
3. **Movimento** sempre no `CD_PRODUTO` do estoque  

O backend usa `wms-resolver-codigo-estoque.service.js` no **Recebimento** e **Inventário** (demais módulos na sequência).

---

## 6. Reiniciar backend

Após deploy dos arquivos JS/SQL:

```powershell
# reiniciar serviço Node do Atlas
```

---

*Documento alinhado à Fase piloto Nutriville — maio/2026.*
