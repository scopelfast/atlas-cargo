-- =============================================
-- Popular TIPOOCORRENCIA (PostgreSQL)
-- Execute no banco Atlas Cargo. Use ON CONFLICT para poder rodar mais de uma vez.
-- =============================================

INSERT INTO "TIPOOCORRENCIA" (
  "CDTIPOOCORRENCIA",
  "DSTIPOOCORRENCIA",
  "CDEDIPADRAO",
  "FGSITUACAO",
  "SEQ",
  "DTCADASTRO",
  "DTALTERACAO",
  "CDCADASTRO",
  "CDALTERACAO",
  "FGACTIVE",
  "DHMAINTENANCE",
  "SGUSER",
  "SERVERORIG"
) VALUES
  (26,  'Retido - Posto Fiscal/Polícia',     '26', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (58,  'Parada - Manutenção',               '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (103, 'Viagem - Início',                   '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (104, 'Viagem - Reinício',                 '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (105, 'Parada - Alimentação/Banheiro',     '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (106, 'Parada - Abastecimento',            '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (107, 'Parada - Descanso/Pernoite',        '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (109, 'Carga - Início',                    '99', 'C', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (110, 'Carga - Fim',                      '99', 'C', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (111, 'Descarga - Fim',                    '99', 'D', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (151, 'Carga - Chegada',                   '99', 'C', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (159, 'Descarga - Chegada',                '99', 'D', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (192, 'Descarga - Início',                 '99', 'D', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT ("CDTIPOOCORRENCIA") DO UPDATE SET
  "DSTIPOOCORRENCIA" = EXCLUDED."DSTIPOOCORRENCIA",
  "CDEDIPADRAO"       = EXCLUDED."CDEDIPADRAO",
  "FGSITUACAO"        = EXCLUDED."FGSITUACAO",
  "SEQ"               = EXCLUDED."SEQ",
  "DTCADASTRO"        = EXCLUDED."DTCADASTRO";

-- Se a tabela no seu banco estiver em minúsculas (tipocorrencia), use o script abaixo em vez do acima:
/*
INSERT INTO tipocorrencia (
  cdtipocorrencia, dstipocorrencia, cdedipadrao, fgsituacao, seq, dtcadastro,
  dtalteracao, cdcadastro, cdalteracao, fgactive, dhmaintenance, sguser, serverorig
) VALUES
  (26,  'Retido - Posto Fiscal/Polícia',     '26', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (58,  'Parada - Manutenção',               '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (103, 'Viagem - Início',                   '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (104, 'Viagem - Reinício',                 '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (105, 'Parada - Alimentação/Banheiro',     '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (106, 'Parada - Abastecimento',            '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (107, 'Parada - Descanso/Pernoite',        '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (109, 'Carga - Início',                    '99', 'C', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (110, 'Carga - Fim',                      '99', 'C', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (111, 'Descarga - Fim',                    '99', 'D', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (151, 'Carga - Chegada',                   '99', 'C', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (159, 'Descarga - Chegada',                '99', 'D', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (192, 'Descarga - Início',                 '99', 'D', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT (cdtipocorrencia) DO UPDATE SET
  dstipocorrencia = EXCLUDED.dstipocorrencia,
  cdedipadrao     = EXCLUDED.cdedipadrao,
  fgsituacao      = EXCLUDED.fgsituacao,
  seq             = EXCLUDED.seq,
  dtcadastro      = EXCLUDED.dtcadastro;
*/
