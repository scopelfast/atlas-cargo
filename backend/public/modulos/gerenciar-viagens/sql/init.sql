-- ============================================
-- Executar Sincronização via Stored Procedure
-- IMPORTANTE: Ordem de execução respeita dependências de chaves estrangeiras
-- ============================================
-- 1. Primeiro: Tabelas base sem dependências
EXEC [dbo].[SP_INTGRACAO_TIPOVALIDADE]; -- OK (deve vir antes de TIPOVIAGEM)
EXEC [dbo].[SP_INTGRACAO_VALIDADE]; -- OK (CORRIGIDA: agora filtra apenas CDTIPOVALIDADE válidos)
EXEC [dbo].[SP_INTGRACAO_CERTIFICADORA]; -- OK

-- 2. Tabelas de configuração
EXEC [dbo].[SP_INTGRACAO_TIPOVIAGEM]; -- OK (agora pode referenciar TIPOVALIDADE)
EXEC [dbo].[SP_INTGRACAO_SITUACAOVIAGEM]; -- OK
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA]; -- OK

-- 3. Tabelas de equipamentos (ordem: Tipo -> Grupo -> Marca -> Modelo -> Equipamento)
EXEC [dbo].[SP_INTGRACAO_TIPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_GRUPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MARCAEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MODELOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_EQUIPAMENTO]; -- OK

-- 4. Tabelas de pessoas/empresas
EXEC [dbo].[SP_INTGRACAO_CONTRATADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_MOTORISTA_COM_TRANSPORTADOR]; -- OK

-- 5. Tabelas de roteiros
EXEC [dbo].[SP_INTGRACAO_ROTEIRO]; -- OK
EXEC [dbo].[SP_INTGRACAO_ROTEIROPONTOS]; -- OK

-- 6. Tabelas de viagens (ordem: Mestre -> Veículo -> Motorista)
EXEC [dbo].[SP_INTGRACAO_VIAGEMMESTRE]; -- OK
EXEC [dbo].[SP_INTGRACAO_VIAGEMVEICULO]; -- OK   
EXEC [dbo].[SP_INTGRACAO_VIAGEMMOTORISTA]; -- OK

-- 7. Atualizações e desativações (devem vir por último)
-- EXEC [dbo].[SP_ATUALIZACAO_VIAGEMMESTRE]; -- OK
EXEC [dbo].[SP_DESATIVAR_VIAGENS_COM_MOTORISTA]; -- OK
EXEC [dbo].[SP_DESATIVAR_VIAGENS_COM_VEICULO]; -- OK
GO
