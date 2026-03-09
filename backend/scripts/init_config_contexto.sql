-- Inserir chaves de contexto multimoeda/multilíngua na CONFIGURACAO (Fase 0)
-- Execute uma vez; não altera valores já existentes (usa ON CONFLICT para segurança).
-- Atlas Cargo - Plano Multimoeda/Multilíngua

INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
VALUES
  ('pais_padrao',     'BR',    'País padrão da instalação (BR, PY, AR, UY...)',           CURRENT_TIMESTAMP),
  ('idioma_padrao',   'pt-BR', 'Locale padrão (pt-BR, es-PY, es-AR...)',                 CURRENT_TIMESTAMP),
  ('moeda_padrao',    'BRL',   'Moeda padrão (BRL, PYG, ARS, UYU...)',                     CURRENT_TIMESTAMP),
  ('tipo_doc_fisica', 'CPF',   'Tipo de documento pessoa física (CPF, CI, DNI...)',        CURRENT_TIMESTAMP),
  ('tipo_doc_juridica','CNPJ', 'Tipo de documento pessoa jurídica (CNPJ, RUC, CUIT...)',  CURRENT_TIMESTAMP),
  ('timezone',        'America/Sao_Paulo', 'Fuso horário IANA (ex.: America/Sao_Paulo, America/Asuncion)', CURRENT_TIMESTAMP)
ON CONFLICT ("CHAVE") DO NOTHING;
