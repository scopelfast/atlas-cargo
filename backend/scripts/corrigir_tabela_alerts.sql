-- Script para corrigir tipo de dados da coluna CDMOTORISTA na tabela ALERTS
-- Corrige incompatibilidade com CADASTROGERAL.CDCADASTRO
-- Data: 2025-01-16

-- Verificar se tabela existe mas com tipo errado
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') AND type in (N'U'))
BEGIN
    -- Verificar se coluna existe com tipo errado (INT)
    IF EXISTS (
        SELECT * 
        FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
          AND name = 'CDMOTORISTA'
          AND system_type_id = 56 -- INT
    )
    BEGIN
        PRINT '⚠️ Corrigindo tipo de dados da coluna CDMOTORISTA...';
        
        -- Remover foreign key se existir
        IF EXISTS (
            SELECT * 
            FROM sys.foreign_keys 
            WHERE parent_object_id = OBJECT_ID(N'[dbo].[ALERTS]')
              AND name LIKE 'FK%CDMOTORISTA%'
        )
        BEGIN
            DECLARE @fkName NVARCHAR(128);
            SELECT @fkName = name 
            FROM sys.foreign_keys 
            WHERE parent_object_id = OBJECT_ID(N'[dbo].[ALERTS]')
              AND name LIKE 'FK%CDMOTORISTA%';
            
            EXEC('ALTER TABLE [dbo].[ALERTS] DROP CONSTRAINT [' + @fkName + ']');
            PRINT '✅ Foreign key removida: ' + @fkName;
        END;
        
        -- Alterar tipo da coluna
        ALTER TABLE [dbo].[ALERTS]
        ALTER COLUMN CDMOTORISTA DECIMAL(15,0) NULL;
        
        PRINT '✅ Tipo da coluna CDMOTORISTA alterado para DECIMAL(15,0)';
        
        -- Recriar foreign key
        ALTER TABLE [dbo].[ALERTS]
        ADD CONSTRAINT FK_ALERTS_CDMOTORISTA_CADASTROGERAL
        FOREIGN KEY (CDMOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO);
        
        PRINT '✅ Foreign key recriada com sucesso!';
    END
    ELSE
    BEGIN
        PRINT '✅ Coluna CDMOTORISTA já está com o tipo correto (DECIMAL(15,0))';
    END
END
ELSE
BEGIN
    PRINT '⚠️ Tabela ALERTS não existe. Execute primeiro: criar_tabela_alerts.sql';
END
GO
