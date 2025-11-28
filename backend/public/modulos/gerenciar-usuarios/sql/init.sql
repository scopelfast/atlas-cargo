-- ============================================
-- Arquivo de Inicialização - Gerenciar Usuários
-- ============================================
-- Este arquivo é executado automaticamente ao abrir o módulo "Gerenciar Usuários"
-- VOCÊ PODE EDITAR ESTE ARQUIVO LIVREMENTE
-- ============================================

-- Migração de dados de USUARIO de INTEGRA_PRD para DIVULGACARGA_PRD
-- Sincroniza: Todos os usuários do sistema

USE [DIVULGACARGA_PRD];

GO

SET NOCOUNT ON;

GO

/******************************************************************************************
 * 1. USUARIO - Migração de todos os usuários
 ******************************************************************************************/

MERGE INTO [dbo].[USUARIO] AS TARGET
USING (
    SELECT DISTINCT
        SGUSUARIO,
        UPPER(NMUSUARIO) as NMUSUARIO,
        ENDEMAIL,
        CDCADASTRO,
        NULL AS SENHA,
        ISNULL(FGACTIVE, 'S') AS FGACTIVE,
        ISNULL(DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
        UPPER(ISNULL(SGUSER, 'SYSTEM')) AS SGUSER,
        ISNULL(SERVERORIG, 'AppDVcargas') AS SERVERORIG
    FROM [INTEGRA_PRD].[dbo].[USUARIO]
    WHERE SGUSUARIO IS NOT NULL
      AND NMUSUARIO IS NOT NULL
      AND FGACTIVE = 'A'
) AS SOURCE
ON TARGET.SGUSUARIO = SOURCE.SGUSUARIO
WHEN MATCHED THEN
    UPDATE SET
        NMUSUARIO = SOURCE.NMUSUARIO,
        ENDEMAIL = SOURCE.ENDEMAIL,
        CDCADASTRO = SOURCE.CDCADASTRO,
        SENHA = SOURCE.SENHA,
        FGACTIVE = SOURCE.FGACTIVE,
        DHMAINTENANCE = SOURCE.DHMAINTENANCE,
        SGUSER = SOURCE.SGUSER,
        SERVERORIG = SOURCE.SERVERORIG
WHEN NOT MATCHED BY TARGET THEN
    INSERT (
        SGUSUARIO,
        NMUSUARIO,
        ENDEMAIL,
        CDCADASTRO,
        SENHA,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    )
    VALUES (
        SOURCE.SGUSUARIO,
        SOURCE.NMUSUARIO,
        SOURCE.ENDEMAIL,
        SOURCE.CDCADASTRO,
        SOURCE.SENHA,
        SOURCE.FGACTIVE,
        SOURCE.DHMAINTENANCE,
        SOURCE.SGUSER,
        SOURCE.SERVERORIG
    );

PRINT '   ✓ Migração de USUARIO concluída.';
GO

PRINT 'Inicialização do módulo Gerenciar Usuários concluída.';
GO
