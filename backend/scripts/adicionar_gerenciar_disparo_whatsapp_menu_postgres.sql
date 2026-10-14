-- Módulo: disparo em massa WhatsApp (Switch Digital) — oportunidades / captação
-- PostgreSQL. Idempotente. Pasta: /modulos/gerenciar-disparo-whatsapp/index.html
--
-- Depois de rodar:
--   1) Gerenciar Usuário → vincule o novo CDTIPOATIVIDADE ao perfil, ou
--   2) INSERT em USUARIOATIVIDADE (SGUSUARIO, CDTIPOATIVIDADE).

INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE",
  "DSTIPOATIVIDADE",
  "DSPROGRAMA",
  "FGACTIVE",
  "FGGRUPO",
  "CD_MODULO_PRODUTO"
)
SELECT
  (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  '9.5.Disparo WhatsApp (oportunidades)',
  'gerenciar-disparo-whatsapp',
  'S',
  'GESTAO',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'gerenciar-disparo-whatsapp'
);

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'gerenciar-disparo-whatsapp'
  AND t."CD_MODULO_PRODUTO" IS NULL;
