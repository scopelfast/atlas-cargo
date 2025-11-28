-- Script para adicionar Relatório de Convocações ao menu
-- Execute este script no banco de dados

-- Inserir na tabela TIPOATIVIDADE
INSERT INTO TIPOATIVIDADE (
    CDTIPOATIVIDADE,
    DSTIPOATIVIDADE,
    FGACTIVE,
    DHMAINTENANCE,
    SGUSER,
    SERVERORIG,
    DSPROGRAMA
) VALUES (
    33,  -- Próximo ID disponível
    '3.5.Relatório Convocações',
    'S',
    GETDATE(),
    'SYSTEM',
    'AppDVcargas',
    'relatorio-convocoes'
);

-- Para dar permissão a um usuário específico, execute:
-- INSERT INTO USUARIOATIVIDADE (SGUSUARIO, CDTIPOATIVIDADE, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG)
-- VALUES ('Admin', 33, 'S', GETDATE(), 'SYSTEM', 'AppDVcargas');

-- Para dar permissão a todos os usuários existentes:
-- INSERT INTO USUARIOATIVIDADE (SGUSUARIO, CDTIPOATIVIDADE, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG)
-- SELECT SGUSUARIO, 33, 'S', GETDATE(), 'SYSTEM', 'AppDVcargas'
-- FROM USUARIO
-- WHERE FGACTIVE = 'S'
-- AND NOT EXISTS (
--     SELECT 1 FROM USUARIOATIVIDADE 
--     WHERE SGUSUARIO = USUARIO.SGUSUARIO AND CDTIPOATIVIDADE = 33
-- );

