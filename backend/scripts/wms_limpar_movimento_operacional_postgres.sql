-- WMS - Limpeza de movimento operacional (SEM mexer em cadastros mestre)
-- Escopo: inventario WMS, movimento de estoque, recebimento (NF-e + liberacoes), separacao OPL,
--          crossdocking, cargas programadas, NFs operacionais, de-para, log job vencimento.
-- Nao limpa: WMS_DONO_ESTOQUE, WMS_ARMAZEM, WMS_AREA, WMS_DOCA,
--            WMS_GRUPO_PRODUTO, WMS_CATEGORIA_PRODUTO, WMS_PRODUTO_DONO, WMS_PRODUTO_OPERACIONAL.
-- Sem BEGIN/COMMIT global: um erro nao deixa a sessao em 25P02; apos falha execute ROLLBACK so se tiver aberto transacao manual.
-- Uso:
--   psql ... -f backend/scripts/wms_limpar_movimento_operacional_postgres.sql

-- Inventário WMS (antes do ledger; linhas referenciam cabeçalho).
DO $limpar_inv$
BEGIN
  IF to_regclass('"WMS_INVENTARIO"') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE "WMS_INVENTARIO" RESTART IDENTITY CASCADE';
  END IF;
END
$limpar_inv$;

-- Ledger de movimento (opcional; script adicionar_wms_movimento_estoque_postgres.sql).
DO $limpar_mov$
BEGIN
  IF to_regclass('"WMS_MOVIMENTO_ESTOQUE"') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE "WMS_MOVIMENTO_ESTOQUE" RESTART IDENTITY';
  END IF;
END
$limpar_mov$;

-- OPL + reserva (WMS_RESERVA_ESTOQUE_OPL -> WMS_OPL_ARQUIVO): CASCADE a partir do arquivo esvazia dependentes sem depender de to_regclass na reserva.
DO $limpar_opl_cluster$
BEGIN
  IF to_regclass('"WMS_OPL_ARQUIVO"') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE "WMS_OPL_ARQUIVO" RESTART IDENTITY CASCADE';
  END IF;
END
$limpar_opl_cluster$;

-- Recebimento: liberacoes de validade (sem FK para NFE — limpar antes das NF-e).
DO $limpar_rec_lib$
BEGIN
  IF to_regclass('"WMS_RECEBIMENTO_LIBERACAO_VALIDADE"') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE "WMS_RECEBIMENTO_LIBERACAO_VALIDADE" RESTART IDENTITY';
  END IF;
END
$limpar_rec_lib$;

-- Job relatório vencimento (auditoria na tela Recebimento — não é cadastro).
DO $limpar_venc_log$
BEGIN
  IF to_regclass('"WMS_RELATORIO_VENCIMENTO_ENVIO"') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE "WMS_RELATORIO_VENCIMENTO_ENVIO" RESTART IDENTITY';
  END IF;
END
$limpar_venc_log$;

-- Um TRUNCATE unico: todas as FKs entre estas tabelas (OPL ja limpo acima).
-- Inclui filhas de WMS_CARGA_PROGRAMADA (expedicao, validacao, separacao, rota, NFe x carga) — nao usar DO/to_regclass aqui (search_path).
TRUNCATE TABLE
  "WMS_CROSSDOCK_LOTE_NFE",
  "WMS_CROSSDOCK_LOTE",
  "WMS_CARGA_VALIDACAO_ITEM",
  "WMS_CARGA_VALIDACAO",
  "WMS_SEPARACAO_PEDIDO_ITEM",
  "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA",
  "WMS_EXPEDICAO_CARGA",
  "WMS_CARGA_PROGRAMADA_NFE",
  "WMS_CARGA_ROTA_PARADA",
  "WMS_CARGA_ROTA_OPERACIONAL",
  "WMS_CARGA_PROGRAMADA",
  "WMS_NFE_SAIDA",
  "WMS_NFE_ENTRADA",
  "WMS_DEPARA_PRODUTO"
RESTART IDENTITY;

