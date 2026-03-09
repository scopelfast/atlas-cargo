-- Query SQL utilizada para exportação de Cadastros Gerais para Excel
-- Esta query inclui todos os dados principais e das tabelas auxiliares

SELECT 
  -- Dados principais do cadastro
  cg.CDCADASTRO AS 'Código',
  cg.CGCCPF AS 'CPF/CNPJ',
  cg.RZSOCIAL AS 'Razão Social',
  cg.NMFANTASIA AS 'Nome Fantasia',
  CASE cg.FGFISICAJURIDICA 
    WHEN 'F' THEN 'Física'
    WHEN 'J' THEN 'Jurídica'
    ELSE 'Não informado'
  END AS 'Tipo Pessoa',
  CASE cg.FGTIPOCADASTRO
    WHEN 'O' THEN 'Operador do Sistema'
    WHEN 'M' THEN 'Motorista'
    WHEN 'A' THEN 'Agente'
    WHEN 'G' THEN 'Grupo de Divulgação'
    WHEN 'T' THEN 'Transportador'
    WHEN 'C' THEN 'Certificadora'
    WHEN 'U' THEN 'Unidade de Negócio'
    ELSE 'Não informado'
  END AS 'Tipo Cadastro',
  CASE cg.FGRASTREADO
    WHEN 'S' THEN 'Sim'
    WHEN 'N' THEN 'Não'
    ELSE 'Não informado'
  END AS 'Possui Veículo Rastreado',
  CASE cg.FGACTIVE
    WHEN 'A' THEN 'Ativo'
    WHEN 'I' THEN 'Inativo'
    ELSE 'Não informado'
  END AS 'Situação',
  
  -- Dados de endereço
  cg.CEP AS 'CEP',
  cg.ENDERECO AS 'Endereço',
  cg.NRENDERECO AS 'Número',
  cg.COMPLEND AS 'Complemento',
  cg.BAIRRO AS 'Bairro',
  
  -- Dados da cidade (tabela auxiliar CIDADE)
  c.ESTADO AS 'Estado',
  c.NMCIDADE AS 'Cidade',
  c.CDCIDADE AS 'Código Cidade',
  
  -- Dados de contato
  cg.NRCELULAR AS 'Celular',
  cg.ENDEMAIL AS 'Email',
  
  -- Dados de localização
  cg.LATITUDE AS 'Latitude',
  cg.LONGITUDE AS 'Longitude',
  
  -- Dados do transportador (tabela auxiliar CADASTROGERAL - Transportador)
  cg.CDTRANSPORTADOR AS 'Código Transportador',
  t.RZSOCIAL AS 'Nome Transportador',
  t.CGCCPF AS 'CPF/CNPJ Transportador',
  t.NRCELULAR AS 'Celular Transportador',
  t.ENDEMAIL AS 'Email Transportador',
  
  -- Dados de manutenção
  cg.DHMAINTENANCE AS 'Data Manutenção',
  cg.SGUSER AS 'Usuário',
  cg.SERVERORIG AS 'Servidor Origem'
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
WHERE 1=1
  -- Os filtros são aplicados dinamicamente conforme os parâmetros da requisição
ORDER BY cg.RZSOCIAL;

-- Tabelas auxiliares incluídas:
-- 1. CIDADE (c) - Dados de estado, cidade e código da cidade
-- 2. CADASTROGERAL (t) - Dados do transportador quando o cadastro é motorista

-- Campos exportados:
-- - Todos os campos principais da tabela CADASTROGERAL
-- - Dados formatados (Tipo Pessoa, Tipo Cadastro, Situação, etc.)
-- - Dados da cidade (Estado, Nome da Cidade, Código)
-- - Dados do transportador (quando aplicável)
-- - Dados de manutenção (Data, Usuário, Servidor)
