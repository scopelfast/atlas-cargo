-- Completa o menu da instalação que já tem Torre (1.x a 4.x e 9.0/9.2/9.3/9.4)
-- e ainda não mostra Campanha, Estoque e os itens 9.1 / 9.5 / 9.6.
-- PostgreSQL, idempotente. Não apaga viagem, cadastro nem usuário.
-- Executar no banco atlas_cargo_prd (pgAdmin ou psql). Depois, sair e entrar de novo.
-- No combo do topo, deixar "Todos os Módulos".

INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
SELECT (SELECT COALESCE(MAX(m."CD_MODULO"), 0) + 1 FROM "MODULO_PRODUTO" m),
  'estoque', 'Gestão de Estoque', 'WMS: recebimento, separação, cargas, expedição e cadastros.', 2, 'S'
WHERE NOT EXISTS (SELECT 1 FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'estoque');

DO $$
DECLARE
  r record;
  novo_id integer;
  mod_id integer;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('3.5.Campanha de Oportunidades', 'campanhas-oportunidades', 'Logística', 'divulga'),
      ('5.0.Painel', 'estoque', 'WMS', 'estoque'),
      ('5.1.Cadastros', 'estoque-cadastros-wms', 'WMS', 'estoque'),
      ('5.2.Recebimento', 'estoque-recebimento', 'WMS', 'estoque'),
      ('5.3.Separação', 'estoque-separacao', 'WMS', 'estoque'),
      ('5.4.Cargas', 'estoque-cargas', 'WMS', 'estoque'),
      ('5.5.Expedição', 'estoque-expedicao', 'WMS', 'estoque'),
      ('5.6.Liberar Expedição', 'wms-expedicao-liberar-divergencia', 'SISTEMA', 'estoque'),
      ('5.7.Liberar Validade', 'wms-recebimento-liberar-validade-min', 'SISTEMA', 'estoque'),
      ('5.8.Baixas / Perdas', 'estoque-baixas', 'WMS', 'estoque'),
      ('5.9.Relatórios', 'estoque-relatorios', 'WMS', 'estoque'),
      ('6.0.Inventário', 'estoque-inventario', 'WMS', 'estoque'),
      ('6.1.Transferências', 'estoque-transferencias', 'WMS', 'estoque'),
      ('6.2.Valor Estoque', 'estoque-valor', 'WMS', 'estoque'),
      ('7.1.Cobrança', 'estoque-cobranca', 'WMS', 'estoque'),
      ('Lib. picking OPL s/ cobertura', 'wms-separacao-liberar-cobertura-picking', 'SISTEMA', 'estoque'),
      ('9.1.Tipo Atividade', 'gerenciar-tipos-atividade', 'SISTEMA', 'geral'),
      ('9.5.Tenants e módulos (SaaS)', 'gerenciar-tenants-saas', 'System', 'geral'),
      ('9.6.Disparo WhatsApp (oportunidades)', 'gerenciar-disparo-whatsapp', 'SISTEMA', 'geral')
    ) AS v(nome, prog, grupo, modulo)
  LOOP
    SELECT m."CD_MODULO" INTO mod_id
    FROM "MODULO_PRODUTO" m
    WHERE m."CODIGO" = r.modulo
    LIMIT 1;

    IF mod_id IS NULL AND r.modulo = 'divulga' THEN
      SELECT m."CD_MODULO" INTO mod_id
      FROM "MODULO_PRODUTO" m
      WHERE m."CODIGO" = 'divulga_cargas_torre'
      LIMIT 1;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM "TIPOATIVIDADE" t
      WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = r.prog
    ) THEN
      SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 INTO novo_id FROM "TIPOATIVIDADE";
      INSERT INTO "TIPOATIVIDADE" (
        "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO"
      ) VALUES (
        novo_id, r.nome, r.prog, 'S', r.grupo, mod_id
      );
    ELSE
      UPDATE "TIPOATIVIDADE" t
      SET "DSTIPOATIVIDADE" = r.nome,
          "FGACTIVE" = 'S',
          "FGGRUPO" = r.grupo,
          "CD_MODULO_PRODUTO" = COALESCE(t."CD_MODULO_PRODUTO", mod_id)
      WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = r.prog;
    END IF;
  END LOOP;

  INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
  SELECT u."SGUSUARIO", t."CDTIPOATIVIDADE", CURRENT_TIMESTAMP, 'SYSTEM', 'menu-faltante'
  FROM "USUARIO" u
  INNER JOIN "TIPOATIVIDADE" t
    ON TRIM(COALESCE(t."DSPROGRAMA", '')) IN (
      'campanhas-oportunidades',
      'estoque', 'estoque-cadastros-wms', 'estoque-recebimento', 'estoque-separacao',
      'estoque-cargas', 'estoque-expedicao', 'estoque-baixas', 'estoque-relatorios',
      'estoque-inventario', 'estoque-transferencias', 'estoque-valor', 'estoque-cobranca',
      'wms-expedicao-liberar-divergencia', 'wms-recebimento-liberar-validade-min',
      'wms-separacao-liberar-cobertura-picking',
      'gerenciar-tipos-atividade', 'gerenciar-tenants-saas', 'gerenciar-disparo-whatsapp'
    )
  WHERE u."FGACTIVE" = 'S'
    AND NOT EXISTS (
      SELECT 1 FROM "USUARIOATIVIDADE" ua
      WHERE ua."SGUSUARIO" = u."SGUSUARIO"
        AND ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
    );
END $$;
