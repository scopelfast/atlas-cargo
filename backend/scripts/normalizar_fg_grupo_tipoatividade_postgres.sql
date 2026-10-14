-- Normaliza FGGRUPO em TIPOATIVIDADE para as chaves canônicas usadas pelo backend
-- (ver backend/utils/tipo-atividade-grupo.js — GRUPO_POR_CDTIPO).
-- Execução opcional após revisão; não altera CDTIPOATIVIDADE nem permissões.

UPDATE "TIPOATIVIDADE" t
SET "FGGRUPO" = v.chave
FROM (
  VALUES
    (1::smallint, 'CADASTROS'),
    (2::smallint, 'CADASTROS'),
    (20::smallint, 'CADASTROS'),
    (3::smallint, 'SISTEMA'),
    (5::smallint, 'SISTEMA'),
    (31::smallint, 'SISTEMA'),
    (32::smallint, 'SISTEMA'),
    (4::smallint, 'GESTAO'),
    (30::smallint, 'GESTAO'),
    (33::smallint, 'GESTAO'),
    (40::smallint, 'GESTAO'),
    (41::smallint, 'GESTAO'),
    (42::smallint, 'GESTAO'),
    (43::smallint, 'GESTAO'),
    (10::smallint, 'EQUIPAMENTOS'),
    (11::smallint, 'EQUIPAMENTOS'),
    (12::smallint, 'EQUIPAMENTOS'),
    (13::smallint, 'EQUIPAMENTOS'),
    (14::smallint, 'EQUIPAMENTOS'),
    (23::smallint, 'EQUIPAMENTOS'),
    (21::smallint, 'LOGISTICA'),
    (22::smallint, 'LOGISTICA'),
    (24::smallint, 'LOGISTICA'),
    (25::smallint, 'LOGISTICA')
) AS v(id, chave)
WHERE t."CDTIPOATIVIDADE" = v.id;
