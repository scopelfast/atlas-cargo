-- ============================================================================
-- Remover itens duplicados do menu (TIPOATIVIDADE)
-- Mantém um único registro por programa: o que tem grupo correto (Cadastros,
-- Gestão, System, etc.). Remove os que têm FGGRUPO numérico ("1", "4", "6", "8").
-- Execute no pgAdmin no banco atlas_cargo_prd.
-- Atlas Cargo
-- ============================================================================

-- IDs duplicados a remover (mesmo DSPROGRAMA já existe com ID correto no menu):
--   6 = 4.5.Mapa de Viagem (duplicata; manter 30)
--   7 = 1.1.Cidade (duplicata; manter 20)
--   8 = 6.0.Empresas (duplicata; manter 31)
--   9 = 6.1.Filiais (duplicata; manter 32)
--  15 = 8.0.Tipos de Viagem (duplicata; manter 21)
--  16 = 8.1.Situações de Viagem (duplicata; manter 22)
--  17 = 1.2.Tipo Validade (duplicata; manter 2)
--  18 = 4.1.Alertas (duplicata; manter 40)
--  19 = 4.2.Chat (duplicata; manter 41)

BEGIN;

-- 1) Remover permissões (USUARIOATIVIDADE) dos IDs que serão excluídos
DELETE FROM "USUARIOATIVIDADE"
WHERE "CDTIPOATIVIDADE" IN (6, 7, 8, 9, 15, 16, 17, 18, 19);

-- 2) Remover os registros duplicados de TIPOATIVIDADE
DELETE FROM "TIPOATIVIDADE"
WHERE "CDTIPOATIVIDADE" IN (6, 7, 8, 9, 15, 16, 17, 18, 19);

COMMIT;

-- Conferir: não deve haver mais duplicados por DSPROGRAMA
-- SELECT "DSPROGRAMA", COUNT(*) FROM "TIPOATIVIDADE" WHERE "FGACTIVE" = 'S' GROUP BY "DSPROGRAMA" HAVING COUNT(*) > 1;
