-- Query SQL utilizada para exportação de Equipamentos para Excel
-- Esta query inclui todos os dados principais e das tabelas auxiliares

SELECT 
  e.IDEQUIPAMENTO AS 'ID do Equipamento',
  e.REFEQUIPAMENTO AS 'Placa/Referência',
  e.DSEQUIPAMENTO AS 'Descrição',
  e.CDGRUPOEQUIPAMENTO AS 'Código Grupo',
  g.DSGRUPOEQUIPAMENTO AS 'Grupo de Equipamento',
  e.CDTIPOEQUIPAMENTO AS 'Código Tipo',
  t.DSTIPOEQUIPAMENTO AS 'Tipo de Equipamento',
  e.CDMARCAEQUIPAMENTO AS 'Código Marca',
  m.DSMARCAEQUIPAMENTO AS 'Marca',
  e.CDMODELOEQUIPAMENTO AS 'Código Modelo',
  mod.DSMODELOEQUIPAMENTO AS 'Modelo',
  e.CDCLASSEFROTA AS 'Código Classe',
  c.DSCLASSEFROTA AS 'Classe de Frota',
  CASE e.FGACTIVE
    WHEN 'A' THEN 'Ativo'
    WHEN 'I' THEN 'Inativo'
    ELSE 'Não informado'
  END AS 'Situação',
  CASE e.FGTIPOATUACAO
    WHEN 'A' THEN 'A - Agregado'
    WHEN 'F' THEN 'F - Frota Própria'
    WHEN 'P' THEN 'P - Parceiro (Terceiro Fiel)'
    WHEN 'T' THEN 'T - Terceiro'
    ELSE 'Não informado'
  END AS 'Tipo de Atuação',
  CASE e.FGTIPOCARROCERIA
    WHEN '01' THEN '01 - Baú'
    WHEN '02' THEN '02 - Frigorífico'
    WHEN '03' THEN '03 - Tanque'
    WHEN '04' THEN '04 - Basculante (caçamba)'
    WHEN '05' THEN '05 - Prancha'
    WHEN '06' THEN '06 - Cegonha'
    WHEN '07' THEN '07 - Silo/Basculante'
    WHEN '08' THEN '08 - Transporte de toras'
    WHEN '09' THEN '09 - Contêiner/carroc. aberta'
    WHEN '10' THEN '10 - Não Aplicável'
    WHEN '11' THEN '11 - Sider'
    ELSE 'Não informado'
  END AS 'Tipo de Carroceria',
  e.NREIXOS AS 'Número de Eixos',
  e.CAPACIDCARGA AS 'Capacidade de Carga (ton)',
  e.ANOFABRICA AS 'Ano de Fabricação',
  e.ALTURA AS 'Altura (m)',
  e.LARGURA AS 'Largura (m)',
  e.COMPRIMENTO AS 'Comprimento (m)',
  e.MTCUBICO AS 'M³ Cúbico',
  CASE e.FGRASTREADO
    WHEN 'S' THEN 'Sim'
    WHEN 'N' THEN 'Não'
    ELSE 'Não informado'
  END AS 'Veículo Rastreado'
FROM [dbo].[EQUIPAMENTO] e
LEFT JOIN [dbo].[GRUPOEQUIPAMENTO] g ON e.CDGRUPOEQUIPAMENTO = g.CDGRUPOEQUIPAMENTO
LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON e.CDTIPOEQUIPAMENTO = t.CDTIPOEQUIPAMENTO
LEFT JOIN [dbo].[MARCAEQUIPAMENTO] m ON e.CDMARCAEQUIPAMENTO = m.CDMARCAEQUIPAMENTO
LEFT JOIN [dbo].[MODELOEQUIPAMENTO] mod ON e.CDMODELOEQUIPAMENTO = mod.CDMODELOEQUIPAMENTO
LEFT JOIN [dbo].[CLASSEFROTA] c ON e.CDCLASSEFROTA = c.CDCLASSEFROTA
WHERE 1=1
  -- Os filtros são aplicados dinamicamente conforme os parâmetros da requisição
ORDER BY e.REFEQUIPAMENTO;

-- Tabelas auxiliares incluídas:
-- 1. GRUPOEQUIPAMENTO (g) - Dados do grupo de equipamento
-- 2. TIPOEQUIPAMENTO (t) - Dados do tipo de equipamento
-- 3. MARCAEQUIPAMENTO (m) - Dados da marca
-- 4. MODELEQUIPAMENTO (mod) - Dados do modelo
-- 5. CLASSEFROTA (c) - Dados da classe de frota

-- Campos exportados:
-- - Todos os campos principais da tabela EQUIPAMENTO
-- - Dados formatados (Situação, Tipo de Atuação, Tipo de Carroceria, Veículo Rastreado)
-- - Dados das tabelas auxiliares (Grupo, Tipo, Marca, Modelo, Classe)
-- - Dados técnicos (Eixos, Capacidade, Dimensões, etc.)
