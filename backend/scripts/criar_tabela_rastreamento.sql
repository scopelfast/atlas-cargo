-- Script para criar a tabela VIAGEM_RASTREAMENTO
-- Execute este script no SQL Server Management Studio

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_RASTREAMENTO')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_RASTREAMENTO] (
        IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,         -- FK VIAGEMMESTRE
        CDCADASTRO DECIMAL(15,0) NOT NULL,       -- Motorista (FK CADASTROGERAL)
        LATITUDE DECIMAL(10,8) NOT NULL,         -- -29.91780000
        LONGITUDE DECIMAL(11,8) NOT NULL,        -- -51.18360000
        VELOCIDADE DECIMAL(5,2),                 -- km/h
        PRECISAO INT,                            -- Precisão em metros
        BATERIA INT,                             -- % bateria do celular
        DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),
        TIPO CHAR(1) DEFAULT 'A',                -- A=Automático, M=Manual
        FONTE VARCHAR(20) DEFAULT 'APP',         -- APP, WEB, API, TESTE
        VERSAOAPP VARCHAR(20),                   -- Versão do app que enviou
        
        CONSTRAINT FK_RASTREAMENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
            REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        CONSTRAINT FK_RASTREAMENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );
    
    -- Índices para performance (queries por viagem e por data)
    CREATE INDEX IDX_RASTREAMENTO_VIAGEM ON [dbo].[VIAGEM_RASTREAMENTO](IDVIAGEM);
    CREATE INDEX IDX_RASTREAMENTO_DATA ON [dbo].[VIAGEM_RASTREAMENTO](DHREGISTRO DESC);
    CREATE INDEX IDX_RASTREAMENTO_MOTORISTA ON [dbo].[VIAGEM_RASTREAMENTO](CDCADASTRO);
    
    PRINT '✅ Tabela VIAGEM_RASTREAMENTO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela VIAGEM_RASTREAMENTO já existe.';
END
GO

