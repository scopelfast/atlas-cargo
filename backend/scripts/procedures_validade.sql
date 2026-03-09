-- =============================================
-- Procedures para TIPOVALIDADE e CONTROLEVALIDADE
-- =============================================

USE ATLAS_CARGO_PRD;
GO

-- =============================================
-- Procedure: SP_INSERIR_TIPOVALIDADE
-- =============================================
IF OBJECT_ID('SP_INSERIR_TIPOVALIDADE', 'P') IS NOT NULL
    DROP PROCEDURE SP_INSERIR_TIPOVALIDADE;
GO

CREATE PROCEDURE SP_INSERIR_TIPOVALIDADE
    @CDTIPOVALIDADE SMALLINT OUTPUT,
    @DSTIPOVALIDADE VARCHAR(40),
    @FGVEICULO CHAR(1) = 'N',
    @FGMOTORISTA CHAR(1) = 'N',
    @FGTRANSPORTADOR CHAR(1) = 'N',
    @FGCLIENTE CHAR(1) = 'N',
    @FGFORNECEDOR CHAR(1) = 'N',
    @FGEXIGECERTIFICADORA CHAR(1) = 'N',
    @SGUSER VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Gerar próximo código se não fornecido
        IF @CDTIPOVALIDADE IS NULL OR @CDTIPOVALIDADE = 0
        BEGIN
            SELECT @CDTIPOVALIDADE = ISNULL(MAX(CDTIPOVALIDADE), 0) + 1
            FROM TIPOVALIDADE;
        END
        
        -- Inserir registro
        INSERT INTO TIPOVALIDADE (
            CDTIPOVALIDADE,
            DSTIPOVALIDADE,
            FGVEICULO,
            FGMOTORISTA,
            FGTRANSPORTADOR,
            FGCLIENTE,
            FGFORNECEDOR,
            FGEXIGECERTIFICADORA,
            DHMAINTENANCE,
            SGUSER,
            SERVERORIG
        ) VALUES (
            @CDTIPOVALIDADE,
            @DSTIPOVALIDADE,
            @FGVEICULO,
            @FGMOTORISTA,
            @FGTRANSPORTADOR,
            @FGCLIENTE,
            @FGFORNECEDOR,
            @FGEXIGECERTIFICADORA,
            GETDATE(),
            @SGUSER,
            @@SERVERNAME
        );
        
        RETURN 0; -- Sucesso
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
        RETURN -1; -- Erro
    END CATCH
END
GO

-- =============================================
-- Procedure: SP_ATUALIZAR_TIPOVALIDADE
-- =============================================
IF OBJECT_ID('SP_ATUALIZAR_TIPOVALIDADE', 'P') IS NOT NULL
    DROP PROCEDURE SP_ATUALIZAR_TIPOVALIDADE;
GO

CREATE PROCEDURE SP_ATUALIZAR_TIPOVALIDADE
    @CDTIPOVALIDADE SMALLINT,
    @DSTIPOVALIDADE VARCHAR(40),
    @FGVEICULO CHAR(1),
    @FGMOTORISTA CHAR(1),
    @FGTRANSPORTADOR CHAR(1),
    @FGCLIENTE CHAR(1),
    @FGFORNECEDOR CHAR(1),
    @FGEXIGECERTIFICADORA CHAR(1),
    @SGUSER VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        UPDATE TIPOVALIDADE
        SET 
            DSTIPOVALIDADE = @DSTIPOVALIDADE,
            FGVEICULO = @FGVEICULO,
            FGMOTORISTA = @FGMOTORISTA,
            FGTRANSPORTADOR = @FGTRANSPORTADOR,
            FGCLIENTE = @FGCLIENTE,
            FGFORNECEDOR = @FGFORNECEDOR,
            FGEXIGECERTIFICADORA = @FGEXIGECERTIFICADORA,
            DHMAINTENANCE = GETDATE(),
            SGUSER = @SGUSER
        WHERE CDTIPOVALIDADE = @CDTIPOVALIDADE;
        
        IF @@ROWCOUNT = 0
            RAISERROR('Tipo de Validade não encontrado', 16, 1);
        
        RETURN 0; -- Sucesso
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
        RETURN -1; -- Erro
    END CATCH
END
GO

-- =============================================
-- Procedure: SP_EXCLUIR_TIPOVALIDADE
-- =============================================
IF OBJECT_ID('SP_EXCLUIR_TIPOVALIDADE', 'P') IS NOT NULL
    DROP PROCEDURE SP_EXCLUIR_TIPOVALIDADE;
GO

CREATE PROCEDURE SP_EXCLUIR_TIPOVALIDADE
    @CDTIPOVALIDADE SMALLINT
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- Verificar se existem validades associadas
        IF EXISTS (SELECT 1 FROM CONTROLEVALIDADE WHERE CDTIPOVALIDADE = @CDTIPOVALIDADE)
        BEGIN
            RAISERROR('Não é possível excluir. Existem validades associadas a este tipo.', 16, 1);
            RETURN -1;
        END
        
        DELETE FROM TIPOVALIDADE
        WHERE CDTIPOVALIDADE = @CDTIPOVALIDADE;
        
        IF @@ROWCOUNT = 0
            RAISERROR('Tipo de Validade não encontrado', 16, 1);
        
        RETURN 0; -- Sucesso
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        RAISERROR(@ErrorMessage, 16, 1);
        RETURN -1; -- Erro
    END CATCH
END
GO

PRINT '========================================';
PRINT '✅ Procedures criadas com sucesso!';
PRINT '========================================';
GO

