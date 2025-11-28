-- Script para corrigir o nome do programa do relatório de convocações
-- O diretório está como 'relatorio-convocacoes' (com 's'), então vamos atualizar o banco

UPDATE TIPOATIVIDADE
SET DSPROGRAMA = 'relatorio-convocacoes',
    DHMAINTENANCE = GETDATE()
WHERE CDTIPOATIVIDADE = 33
  AND DSPROGRAMA = 'relatorio-convocoes';

-- Verificar se foi atualizado
SELECT CDTIPOATIVIDADE, DSTIPOATIVIDADE, DSPROGRAMA
FROM TIPOATIVIDADE
WHERE CDTIPOATIVIDADE = 33;

