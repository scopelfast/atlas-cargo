-- Script para criar tabela de Comprovantes de Entrega (POD - Proof of Delivery)
-- Sistema de comprovação com foto, assinatura e geolocalização
-- Data: 2025-01-16

-- Tabela principal de comprovantes de entrega
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DELIVERY_PROOFS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[DELIVERY_PROOFS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        CDMOTORISTA DECIMAL(15,0) NULL, -- FK para CADASTROGERAL (mesmo tipo que CDCADASTRO)
        PHOTO_DATA VARBINARY(MAX) NULL, -- Foto da entrega (base64 ou binário)
        PHOTO_NAME NVARCHAR(255) NULL, -- Nome do arquivo da foto
        SIGNATURE_DATA NVARCHAR(MAX) NULL, -- SVG da assinatura digital
        RECEIVER_NAME NVARCHAR(255) NULL, -- Nome do recebedor
        RECEIVER_DOCUMENT NVARCHAR(50) NULL, -- CPF/RG do recebedor
        OBSERVATIONS NVARCHAR(500) NULL, -- Observações do motorista
        PROOF_LOCATION GEOGRAPHY NULL, -- Coordenadas do local (Point)
        LATITUDE DECIMAL(10,8) NULL, -- Latitude (backup)
        LONGITUDE DECIMAL(11,8) NULL, -- Longitude (backup)
        RECORDED_AT DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        SYNCED BIT DEFAULT 0 NOT NULL, -- Se já foi sincronizado
        CREATED_BY NVARCHAR(50) NULL, -- Fonte: 'APP', 'WEB', etc
        FOREIGN KEY (IDVIAGEM) REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        FOREIGN KEY (CDMOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );

    -- Índices para performance
    CREATE INDEX IX_DELIVERY_PROOFS_VIAGEM ON [dbo].[DELIVERY_PROOFS](IDVIAGEM);
    CREATE INDEX IX_DELIVERY_PROOFS_SYNCED ON [dbo].[DELIVERY_PROOFS](SYNCED, RECORDED_AT);
    CREATE INDEX IX_DELIVERY_PROOFS_MOTORISTA ON [dbo].[DELIVERY_PROOFS](CDMOTORISTA, RECORDED_AT);

    PRINT '✅ Tabela DELIVERY_PROOFS criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela DELIVERY_PROOFS já existe.';
END
GO
