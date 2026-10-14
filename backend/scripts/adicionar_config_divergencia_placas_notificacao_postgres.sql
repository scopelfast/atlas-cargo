-- PostgreSQL, idempotente. Chaves de notificação ao registrar divergência de placas (link/app).
-- Configurações do Sistema → aba Mensagens WhatsApp – convocações (API GET/PUT mensagens-convocacao).

INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
SELECT t."TENANT_ID",
       k.chave,
       k.valor,
       k.descricao,
       CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "TENANT_ID" FROM "CONFIGURACAO" WHERE "TENANT_ID" IS NOT NULL AND TRIM("TENANT_ID") <> '') t
CROSS JOIN (VALUES
  ('divergencia_placas_notificar_switch', 'S', 'Notificar contratador por WhatsApp (Switch) ao registrar divergência de placas (S/N). Default S.'),
  ('divergencia_placas_notificar_torre_websocket', 'S', 'Emitir evento WebSocket na torre ao registrar divergência de placas (S/N). Default S.')
) AS k(chave, valor, descricao)
ON CONFLICT ("TENANT_ID", "CHAVE") DO NOTHING;
