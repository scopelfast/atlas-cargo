-- =============================================
-- OPCIONAL: Adiciona colunas ORIGEM_PAIS e DESTINO_PAIS na tabela VIAGEMMESTRE (SQL Server)
-- Só execute se precisar persistir país na viagem sem roteiro.
-- No fluxo normal, origem/destino vêm do ROTEIRO (viagem.IDROTEIRO -> ROTEIRO -> CIDADE -> PAIS).
-- Executar UMA VEZ apenas se sua regra de negócio exigir país na viagem sem roteiro.
-- =============================================

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMMESTRE]') AND name = 'ORIGEM_PAIS')
BEGIN
  ALTER TABLE [dbo].[VIAGEMMESTRE] ADD [ORIGEM_PAIS] VARCHAR(10) NULL;
  PRINT 'Coluna ORIGEM_PAIS adicionada em VIAGEMMESTRE.';
END
ELSE
  PRINT 'Coluna ORIGEM_PAIS já existe em VIAGEMMESTRE.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMMESTRE]') AND name = 'DESTINO_PAIS')
BEGIN
  ALTER TABLE [dbo].[VIAGEMMESTRE] ADD [DESTINO_PAIS] VARCHAR(10) NULL;
  PRINT 'Coluna DESTINO_PAIS adicionada em VIAGEMMESTRE.';
END
ELSE
  PRINT 'Coluna DESTINO_PAIS já existe em VIAGEMMESTRE.';

GO
