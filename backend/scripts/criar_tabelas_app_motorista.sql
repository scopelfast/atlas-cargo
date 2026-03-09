/*
=============================================================================
Script: Criar Tabelas para APP do Motorista
Descrição: Tabelas complementares integradas com sistema existente
Data: 02/01/2026
Autor: Atlas Cargo

IMPORTANTE: Este script NÃO altera tabelas existentes!
            Apenas ADICIONA novas tabelas complementares.
=============================================================================
*/

USE [ATLAS_CARGO_PRD]
GO

-- ========================================
-- 1. MOTORISTA_COMPLEMENTO
-- Dados complementares de CNH e aprovação
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MOTORISTA_COMPLEMENTO')
BEGIN
    CREATE TABLE [dbo].[MOTORISTA_COMPLEMENTO] (
        CDCADASTRO DECIMAL(15,0) PRIMARY KEY,    -- FK para CADASTROGERAL (mesmo tipo!)
        NRCNH VARCHAR(11) UNIQUE,                -- Número da CNH (11 dígitos)
        CATEGORIACNH VARCHAR(5),                 -- A, B, AB, C, D, E, AC, AD, AE
        VALIDADECNH DATE,                        -- Data de validade
        DATAPRIMEIRAHAB DATE,                    -- Data da primeira habilitação
        RGMOTORISTA VARCHAR(20),                 -- RG do motorista
        NOMEMAE VARCHAR(100),                    -- Nome da mãe (CNH)
        LOCALEMISSAO VARCHAR(50),                -- Cidade/Estado emissão CNH
        DATAEMISSAO DATE,                        -- Data de emissão CNH
        FOTOCNH VARCHAR(500),                    -- Caminho da foto da CNH
        FOTOMOTORISTA VARCHAR(500),              -- Caminho da selfie
        STATUSAPROVACAO CHAR(1) DEFAULT 'P',     -- P=Pendente, A=Aprovado, R=Rejeitado
        DHAPROVACAO DATETIME,                    -- Data/hora aprovação
        APROVADOPOR INT,                         -- FK para USUARIO (quem aprovou)
        MOTIVOREPROVACAO VARCHAR(500),           -- Motivo se rejeitado
        DHCADASTRO DATETIME DEFAULT GETDATE(),   -- Data/hora do cadastro no app
        DHMAINTENANCE DATETIME,
        SGUSER VARCHAR(50),
        SERVERORIG VARCHAR(50) DEFAULT 'AppMotorista',
        
        CONSTRAINT FK_MOTORISTA_COMPL_CADASTRO FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );
    
    PRINT '✅ Tabela MOTORISTA_COMPLEMENTO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela MOTORISTA_COMPLEMENTO já existe.';
END
GO

-- ========================================
-- 2. MOTORISTA_VEICULO
-- Veículos cadastrados pelo motorista
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'MOTORISTA_VEICULO')
BEGIN
    CREATE TABLE [dbo].[MOTORISTA_VEICULO] (
        IDVEICULOMOTORISTA INT IDENTITY(1,1) PRIMARY KEY,
        CDCADASTRO DECIMAL(15,0) NOT NULL,       -- Motorista (FK CADASTROGERAL - mesmo tipo!)
        PLACA VARCHAR(10) NOT NULL,              -- ABC-1234 ou ABC1D34 (Mercosul)
        RENAVAM VARCHAR(11),                     -- RENAVAM (11 dígitos)
        CDTIPOEQUIPAMENTO SMALLINT,              -- FK TIPOEQUIPAMENTO
        MARCAMODELO VARCHAR(100),                -- Ex: VOLVO FH 540
        ANOFABRICACAO INT,                       -- 2020
        ANOMODELO INT,                           -- 2021
        COR VARCHAR(30),                         -- BRANCA
        COMBUSTIVEL VARCHAR(20),                 -- DIESEL
        CHASSI VARCHAR(30),                      -- Número do chassi
        CAPACIDADEKG DECIMAL(10,2),              -- Capacidade em KG
        CAPACIDADEM3 DECIMAL(10,3),              -- Capacidade em M³
        FOTOVEICULO VARCHAR(500),                -- Foto do veículo
        FOTOCRLV VARCHAR(500),                   -- Foto do CRLV
        FGPRINCIPAL CHAR(1) DEFAULT 'N',         -- S=Principal, N=Secundário
        FGACTIVE CHAR(1) DEFAULT 'S',            -- S=Ativo, N=Inativo
        DHCADASTRO DATETIME DEFAULT GETDATE(),
        DHMAINTENANCE DATETIME,
        SGUSER VARCHAR(50),
        SERVERORIG VARCHAR(50) DEFAULT 'AppMotorista',
        
        CONSTRAINT FK_VEICULO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO),
        CONSTRAINT FK_VEICULO_TIPO FOREIGN KEY (CDTIPOEQUIPAMENTO) 
            REFERENCES [dbo].[TIPOEQUIPAMENTO](CDTIPOEQUIPAMENTO)
    );
    
    -- Índices para performance
    CREATE INDEX IDX_VEICULO_MOTORISTA ON [dbo].[MOTORISTA_VEICULO](CDCADASTRO);
    CREATE INDEX IDX_VEICULO_PLACA ON [dbo].[MOTORISTA_VEICULO](PLACA);
    
    PRINT '✅ Tabela MOTORISTA_VEICULO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela MOTORISTA_VEICULO já existe.';
END
GO

-- ========================================
-- 3. VIAGEM_RASTREAMENTO
-- Posições GPS do motorista em tempo real
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_RASTREAMENTO')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_RASTREAMENTO] (
        IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,         -- FK VIAGEMMESTRE
        CDCADASTRO DECIMAL(15,0) NOT NULL,       -- Motorista (FK CADASTROGERAL - mesmo tipo!)
        LATITUDE DECIMAL(10,8) NOT NULL,         -- -25.42847234
        LONGITUDE DECIMAL(11,8) NOT NULL,        -- -49.27339123
        VELOCIDADE DECIMAL(5,2),                 -- km/h
        PRECISAO INT,                            -- Precisão em metros
        BATERIA INT,                             -- % bateria do celular
        DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),
        TIPO CHAR(1) DEFAULT 'A',                -- A=Automático, M=Manual
        FONTE VARCHAR(20) DEFAULT 'APP',         -- APP, WEB, API
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

-- ========================================
-- 4. VIAGEM_EVENTO
-- Eventos durante a viagem (paradas, fotos, problemas)
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_EVENTO')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_EVENTO] (
        IDEVENTO INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        CDCADASTRO DECIMAL(15,0) NOT NULL,       -- Motorista (FK CADASTROGERAL - mesmo tipo!)
        TIPO CHAR(1) NOT NULL,                   -- P=Parada, A=Abast, R=Refeição, M=Mecânico, I=Imprevisto, C=Coleta, E=Entrega
        DESCRICAO VARCHAR(500),                  -- Descrição do evento
        LATITUDE DECIMAL(10,8),                  -- Onde aconteceu
        LONGITUDE DECIMAL(11,8),
        DHEVENTO DATETIME NOT NULL DEFAULT GETDATE(),
        FOTO VARCHAR(500),                       -- Caminho da foto (se tiver)
        DHMAINTENANCE DATETIME,
        
        CONSTRAINT FK_EVENTO_VIAGEM FOREIGN KEY (IDVIAGEM) 
            REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        CONSTRAINT FK_EVENTO_MOTORISTA FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );
    
    -- Índices
    CREATE INDEX IDX_EVENTO_VIAGEM ON [dbo].[VIAGEM_EVENTO](IDVIAGEM);
    CREATE INDEX IDX_EVENTO_DATA ON [dbo].[VIAGEM_EVENTO](DHEVENTO DESC);
    
    PRINT '✅ Tabela VIAGEM_EVENTO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela VIAGEM_EVENTO já existe.';
END
GO

-- ========================================
-- 5. VIAGEM_COMPROVANTE
-- Comprovantes de coleta e entrega
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_COMPROVANTE')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_COMPROVANTE] (
        IDCOMPROVANTE INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        TIPO CHAR(1) NOT NULL,                   -- C=Coleta, E=Entrega
        NOMERECEBEDOR VARCHAR(100),              -- Quem recebeu
        CPFRECEBEDOR VARCHAR(14),                -- CPF de quem recebeu
        RGRECEBEDOR VARCHAR(20),                 -- RG de quem recebeu
        DHENTREGA DATETIME NOT NULL,             -- Quando foi entregue
        ASSINATURA VARCHAR(MAX),                 -- Base64 da assinatura digital
        FOTO VARCHAR(500),                       -- Foto do comprovante
        OBSERVACAO VARCHAR(500),                 -- Observações
        LATITUDE DECIMAL(10,8),                  -- Onde foi entregue
        LONGITUDE DECIMAL(11,8),
        DHMAINTENANCE DATETIME DEFAULT GETDATE(),
        
        CONSTRAINT FK_COMPROVANTE_VIAGEM FOREIGN KEY (IDVIAGEM) 
            REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM)
    );
    
    -- Índices
    CREATE INDEX IDX_COMPROVANTE_VIAGEM ON [dbo].[VIAGEM_COMPROVANTE](IDVIAGEM);
    CREATE INDEX IDX_COMPROVANTE_TIPO ON [dbo].[VIAGEM_COMPROVANTE](TIPO);
    
    PRINT '✅ Tabela VIAGEM_COMPROVANTE criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela VIAGEM_COMPROVANTE já existe.';
END
GO

-- ========================================
-- 6. VIAGEM_CHAT (Opcional - para depois)
-- Chat entre motorista e operador
-- ========================================

IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'VIAGEM_CHAT')
BEGIN
    CREATE TABLE [dbo].[VIAGEM_CHAT] (
        IDMENSAGEM INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        CDCADASTRO DECIMAL(15,0),                -- Motorista (FK CADASTROGERAL - mesmo tipo!)
        SGUSUARIO VARCHAR(50),                   -- Operador (se enviou) - CORRIGIDO!
        TIPO CHAR(1) NOT NULL,                   -- M=Motorista, O=Operador
        MENSAGEM VARCHAR(1000) NOT NULL,
        DHENVIO DATETIME NOT NULL DEFAULT GETDATE(),
        DHLEITURA DATETIME,                      -- Quando foi lido
        
        CONSTRAINT FK_CHAT_VIAGEM FOREIGN KEY (IDVIAGEM) 
            REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        CONSTRAINT FK_CHAT_MOTORISTA FOREIGN KEY (CDCADASTRO) 
            REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO),
        CONSTRAINT FK_CHAT_USUARIO FOREIGN KEY (SGUSUARIO) 
            REFERENCES [dbo].[USUARIO](SGUSUARIO)
    );
    
    CREATE INDEX IDX_CHAT_VIAGEM ON [dbo].[VIAGEM_CHAT](IDVIAGEM);
    CREATE INDEX IDX_CHAT_DATA ON [dbo].[VIAGEM_CHAT](DHENVIO DESC);
    
    PRINT '✅ Tabela VIAGEM_CHAT criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela VIAGEM_CHAT já existe.';
END
GO

-- ========================================
-- 7. Criar pasta para uploads (informativo)
-- ========================================

PRINT '';
PRINT '=========================================';
PRINT '  ✅ TABELAS CRIADAS COM SUCESSO!';
PRINT '=========================================';
PRINT '';
PRINT 'Tabelas criadas:';
PRINT '  1. MOTORISTA_COMPLEMENTO';
PRINT '  2. MOTORISTA_VEICULO';
PRINT '  3. VIAGEM_RASTREAMENTO';
PRINT '  4. VIAGEM_EVENTO';
PRINT '  5. VIAGEM_COMPROVANTE';
PRINT '  6. VIAGEM_CHAT';
PRINT '';
PRINT 'Próximos passos:';
PRINT '  1. Criar pasta: backend/public/uploads/motoristas/';
PRINT '  2. Criar pasta: backend/public/uploads/veiculos/';
PRINT '  3. Criar pasta: backend/public/uploads/eventos/';
PRINT '  4. Criar pasta: backend/public/uploads/comprovantes/';
PRINT '  5. Criar controller: motorista-app.controller.js';
PRINT '  6. Criar routes: motorista-app.routes.js';
PRINT '';
PRINT '⚠️  IMPORTANTE: Nenhuma tabela existente foi alterada!';
PRINT '    O sistema atual continua funcionando normalmente.';
PRINT '';
GO

-- ========================================
-- 8. Testes básicos (opcional)
-- ========================================

-- Testar inserção em MOTORISTA_COMPLEMENTO
/*
INSERT INTO MOTORISTA_COMPLEMENTO (
    CDCADASTRO, NRCNH, CATEGORIACNH, VALIDADECNH, STATUSAPROVACAO
)
VALUES (
    35174,  -- Usar um CDCADASTRO existente de motorista
    '12345678901',
    'AB',
    '2030-12-31',
    'P'
);

SELECT * FROM MOTORISTA_COMPLEMENTO;
*/

-- Testar JOIN com CADASTROGERAL
/*
SELECT 
    cg.CDCADASTRO,
    cg.RZSOCIAL,
    cg.NRCELULAR,
    mc.NRCNH,
    mc.CATEGORIACNH,
    mc.VALIDADECNH,
    mc.STATUSAPROVACAO
FROM CADASTROGERAL cg
LEFT JOIN MOTORISTA_COMPLEMENTO mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.FGTIPOCADASTRO = 'M'  -- Apenas motoristas
ORDER BY cg.RZSOCIAL;
*/

