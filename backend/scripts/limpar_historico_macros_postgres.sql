-- =============================================
-- Limpar histórico de macros para teste (PostgreSQL)
-- Apaga registros de VIAGEMOCORRENCIA (ocorrências já registradas).
-- NÃO apaga TIPOOCORRENCIA (tipos de macro 1-14).
-- =============================================

-- Opção 1: Limpar TUDO (todas as viagens)
TRUNCATE TABLE "VIAGEMOCORRENCIA" RESTART IDENTITY;

-- Opção 2: Limpar só de uma viagem (descomente e ajuste o ID)
-- DELETE FROM "VIAGEMOCORRENCIA" WHERE "IDVIAGEM" = 1;

-- Opção 3: Se a tabela tiver nome em minúsculas no seu banco:
-- TRUNCATE TABLE viagemocorrencia RESTART IDENTITY;
