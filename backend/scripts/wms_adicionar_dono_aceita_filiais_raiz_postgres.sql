-- Permite que o dono aceite XML de filiais da mesma RAIZ do CNPJ.
-- Antes: import s o exigia CGC exato (14 d gitos). Filial caia em erro.
-- Agora: se FG_ACEITA_FILIAIS_RAIZ = 'S', a valida o tamb m bate quando os
-- 8 primeiros d gitos do emitente do XML conferem com a raiz do CGC do dono.
--
-- Liga por padr o para todos donos com CGC PJ (14 d gitos). CPF (11) fica de fora.
-- Operador pode desligar individualmente em "Cadastro Geral / Dono do Estoque".

BEGIN;

ALTER TABLE "WMS_DONO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "FG_ACEITA_FILIAIS_RAIZ" CHAR(1) NOT NULL DEFAULT 'N';

UPDATE "WMS_DONO_ESTOQUE"
   SET "FG_ACEITA_FILIAIS_RAIZ" = 'S'
 WHERE COALESCE("FG_ACEITA_FILIAIS_RAIZ", 'N') <> 'S'
   AND length(regexp_replace(trim(coalesce("CGC", '')), '[^0-9]', '', 'g')) = 14;

COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."FG_ACEITA_FILIAIS_RAIZ" IS
  'S = aceita XML de qualquer filial da mesma raiz CNPJ (8 primeiros d gitos). N = exige CGC exato.';

SELECT "CD_DONO", "NOME", "CGC", "FG_ACEITA_FILIAIS_RAIZ"
  FROM "WMS_DONO_ESTOQUE"
 ORDER BY "CD_DONO";

COMMIT;
