// backend/routes/roteiros.routes.js
// Gerenciar Roteiros - API
// Versão: 1.3
// Atlas Cargo
// Data: 2026-01-13
// Última atualização: Adicionado suporte ao campo RESUMOROTA

const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');
const axios = require('axios');
const { getReverseGeocodingUrl } = require('../config/nominatim');

// Mapeamento de nomes de estados para UF
const ESTADOS_PARA_UF = {
  'Acre': 'AC',
  'Alagoas': 'AL',
  'Amapá': 'AP',
  'Amazonas': 'AM',
  'Bahia': 'BA',
  'Ceará': 'CE',
  'Distrito Federal': 'DF',
  'Espírito Santo': 'ES',
  'Goiás': 'GO',
  'Maranhão': 'MA',
  'Mato Grosso': 'MT',
  'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG',
  'Pará': 'PA',
  'Paraíba': 'PB',
  'Paraná': 'PR',
  'Pernambuco': 'PE',
  'Piauí': 'PI',
  'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS',
  'Rondônia': 'RO',
  'Roraima': 'RR',
  'Santa Catarina': 'SC',
  'São Paulo': 'SP',
  'Sergipe': 'SE',
  'Tocantins': 'TO'
};

// Função para converter nome de estado para UF
function converterEstadoParaUF(estado) {
  if (!estado) return '';
  
  // Se já é uma UF (2 letras), retornar como está
  if (estado.length === 2 && /^[A-Z]{2}$/i.test(estado)) {
    return estado.toUpperCase();
  }
  
  // Buscar no mapeamento
  const estadoNormalizado = estado.trim();
  const uf = ESTADOS_PARA_UF[estadoNormalizado];
  
  if (uf) {
    return uf;
  }
  
  // Tentar busca case-insensitive
  for (const [nome, sigla] of Object.entries(ESTADOS_PARA_UF)) {
    if (nome.toLowerCase() === estadoNormalizado.toLowerCase()) {
      return sigla;
    }
  }
  
  // Se não encontrou, retornar o original (pode ser uma UF não mapeada)
  return estado;
}

// Helper: PostgreSQL retorna colunas em minúsculas; ler com qualquer casing
function getRow(r, key) {
  if (r[key] !== undefined && r[key] !== null) return r[key];
  const lower = key.toLowerCase();
  if (r[lower] !== undefined && r[lower] !== null) return r[lower];
  return r[key];
}

// Função para formatar cidade com UF (converte nome de estado para UF se necessário)
function formatarCidadeComUF(cidade, estado) {
  if (!cidade) return '';
  
  // Limpar cidade primeiro: remover vírgulas, pontos e estados que possam estar no nome
  let cidadeLimpa = cidade.trim()
    .replace(/,\s*[A-Z]{2}$/i, '') // Remove ",SP", ",MG", etc do final
    .replace(/\.\s*[A-Z]{2}$/i, '') // Remove ".SP", ".MG", etc do final
    .replace(/\s+[A-Z]{2}$/i, '') // Remove " SP", " MG", etc do final
    .replace(/,\s*[A-Za-z\s]+$/i, '') // Remove vírgulas e texto após
    .trim();
  
  // Se a cidade já vem no formato "Cidade/Estado", converter o estado para UF
  if (cidadeLimpa.includes('/')) {
    const partes = cidadeLimpa.split('/');
    const nomeCidade = partes[0].trim();
    const estadoNome = partes[1]?.trim() || estado;
    const uf = converterEstadoParaUF(estadoNome);
    return uf ? `${nomeCidade}/${uf}` : nomeCidade;
  }
  
  // Se não tem estado na cidade, usar o estado fornecido
  const uf = converterEstadoParaUF(estado);
  return uf ? `${cidadeLimpa}/${uf}` : cidadeLimpa;
}

// Listar roteiros com filtros
router.get('/roteiros', async (req, res) => {
  try {
    const { 
      codigo, 
      descricao, 
      origemPais, origemEstado, origemCidade, 
      destinoPais, destinoEstado, destinoCidade 
    } = req.query;
    
    // Verificar se a tabela tem campo FGACTIVE
    const pool = await poolPromise;
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    let query = `
      SELECT 
        [r].[IDROTEIRO],
        [r].[DSROTEIRO],
        [r].[DISTANCIAKM],
        [r].[CDCIDADEORIGEM],
        [co].[CDPAIS] AS ORIGEM_CDPAIS,
        [co].[ESTADO] AS ORIGEM_ESTADO,
        [co].[NMCIDADE] AS ORIGEM_CIDADE,
        [r].[CDCIDADEDESTINO],
        [cd].[CDPAIS] AS DESTINO_CDPAIS,
        [cd].[ESTADO] AS DESTINO_ESTADO,
        [cd].[NMCIDADE] AS DESTINO_CIDADE,
        [r].[RESUMOROTA]
    `;
    
    if (temFGACTIVE) {
      query += `, COALESCE([r].[FGACTIVE], 'S') AS FGACTIVE`;
    } else {
      query += `, 'S' AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
      LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
      WHERE 1=1
    `;

    const params = [];
    if (codigo) {
      query += ` AND [r].[IDROTEIRO] = @CODIGO`;
      params.push({ name: 'CODIGO', value: codigo });
    }
    if (descricao) {
      query += ` AND [r].[DSROTEIRO] LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (origemPais) {
      query += ` AND [co].[CDPAIS] = @ORIGEM_PAIS`;
      params.push({ name: 'ORIGEM_PAIS', value: origemPais });
    }
    if (origemEstado) {
      query += ` AND [co].[ESTADO] = @ORIGEM_ESTADO`;
      params.push({ name: 'ORIGEM_ESTADO', value: origemEstado });
    }
    if (origemCidade) {
      query += ` AND [co].[NMCIDADE] LIKE @ORIGEM_CIDADE`;
      params.push({ name: 'ORIGEM_CIDADE', value: `%${origemCidade}%` });
    }
    if (destinoPais) {
      query += ` AND [cd].[CDPAIS] = @DESTINO_PAIS`;
      params.push({ name: 'DESTINO_PAIS', value: destinoPais });
    }
    if (destinoEstado) {
      query += ` AND [cd].[ESTADO] = @DESTINO_ESTADO`;
      params.push({ name: 'DESTINO_ESTADO', value: destinoEstado });
    }
    if (destinoCidade) {
      query += ` AND [cd].[NMCIDADE] LIKE @DESTINO_CIDADE`;
      params.push({ name: 'DESTINO_CIDADE', value: `%${destinoCidade}%` });
    }

    query += ` ORDER BY [r].[IDROTEIRO]`;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const roteiros = result.recordset.map(r => {
      const roteiro = {
        IDROTEIRO: getRow(r, 'IDROTEIRO'),
        DSROTEIRO: getRow(r, 'DSROTEIRO'),
        DISTANCIAKM: getRow(r, 'DISTANCIAKM'),
        CDCIDADEORIGEM: getRow(r, 'CDCIDADEORIGEM'),
        ORIGEM_CDPAIS: getRow(r, 'ORIGEM_CDPAIS'),
        ORIGEM_ESTADO: getRow(r, 'ORIGEM_ESTADO') || '',
        ORIGEM_CIDADE: getRow(r, 'ORIGEM_CIDADE') || '',
        CDCIDADEDESTINO: getRow(r, 'CDCIDADEDESTINO'),
        DESTINO_CDPAIS: getRow(r, 'DESTINO_CDPAIS'),
        DESTINO_ESTADO: getRow(r, 'DESTINO_ESTADO') || '',
        DESTINO_CIDADE: getRow(r, 'DESTINO_CIDADE') || '',
        RESUMOROTA: getRow(r, 'RESUMOROTA') || null
      };
      
      if (temFGACTIVE && (r.FGACTIVE !== undefined || r.fgactive !== undefined)) {
        roteiro.FGACTIVE = r.FGACTIVE ?? r.fgactive;
      } else {
        roteiro.FGACTIVE = 'S';
      }
      
      return roteiro;
    });
    
    res.json(roteiros);
  } catch (err) {
    console.error('Erro ao listar roteiros:', err);
    res.status(500).json({ error: 'Erro ao carregar roteiros.' });
  }
});

// Buscar roteiro por ID
router.get('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    
    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    let     query = `
      SELECT 
        [r].[IDROTEIRO],
        [r].[DSROTEIRO],
        [r].[DISTANCIAKM],
        [r].[CDCIDADEORIGEM],
        [co].[CDPAIS] AS ORIGEM_CDPAIS,
        [co].[ESTADO] AS ORIGEM_ESTADO,
        [co].[NMCIDADE] AS ORIGEM_CIDADE,
        [r].[CDCIDADEDESTINO],
        [cd].[CDPAIS] AS DESTINO_CDPAIS,
        [cd].[ESTADO] AS DESTINO_ESTADO,
        [cd].[NMCIDADE] AS DESTINO_CIDADE,
        [r].[RESUMOROTA]
    `;
    
    if (temFGACTIVE) {
      query += `, COALESCE([r].[FGACTIVE], 'S') AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
      LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
      WHERE [r].[IDROTEIRO] = @IDROTEIRO
    `;
    
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(query);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    
    const r = result.recordset[0];
    const responseData = {
      IDROTEIRO: getRow(r, 'IDROTEIRO'),
      DSROTEIRO: getRow(r, 'DSROTEIRO'),
      DISTANCIAKM: getRow(r, 'DISTANCIAKM'),
      CDCIDADEORIGEM: getRow(r, 'CDCIDADEORIGEM'),
      ORIGEM_CDPAIS: getRow(r, 'ORIGEM_CDPAIS'),
      ORIGEM_ESTADO: getRow(r, 'ORIGEM_ESTADO') || '',
      ORIGEM_CIDADE: getRow(r, 'ORIGEM_CIDADE') || '',
      CDCIDADEDESTINO: getRow(r, 'CDCIDADEDESTINO'),
      DESTINO_CDPAIS: getRow(r, 'DESTINO_CDPAIS'),
      DESTINO_ESTADO: getRow(r, 'DESTINO_ESTADO') || '',
      DESTINO_CIDADE: getRow(r, 'DESTINO_CIDADE') || '',
      RESUMOROTA: getRow(r, 'RESUMOROTA') || null
    };
    
    if (temFGACTIVE && (r.FGACTIVE !== undefined || r.fgactive !== undefined)) {
      responseData.FGACTIVE = r.FGACTIVE ?? r.fgactive;
    } else {
      responseData.FGACTIVE = 'S';
    }
    
    res.json(responseData);
  } catch (err) {
    console.error('Erro ao buscar roteiro:', err);
    res.status(500).json({ error: 'Erro ao carregar roteiro.' });
  }
});

// Inserir novo roteiro
router.post('/roteiros', async (req, res) => {
  try {
    const { 
      DSROTEIRO, 
      CDCIDADEORIGEM, 
      CDCIDADEDESTINO, 
      DISTANCIAKM,
      RESUMOROTA
    } = req.body;
    
    if (!DSROTEIRO?.trim() || !CDCIDADEORIGEM || !CDCIDADEDESTINO) {
      return res.status(400).json({ error: 'Descrição, Origem e Destino são obrigatórios.' });
    }

    const pool = await poolPromise;
    const maxResult = await pool
      .request()
      .query('SELECT COALESCE(MAX([IDROTEIRO]), 0) + 1 AS [maxId] FROM [dbo].[ROTEIRO]');
    const novoId = getFirstNumericValue(maxResult.recordset, 1);

    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    // Verificar se a tabela tem campo RESUMOROTA
    const checkResumoColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'RESUMOROTA'
      `);
    
    const temRESUMOROTA = checkResumoColumn.recordset.length > 0;
    
    let query = `
      INSERT INTO [dbo].[ROTEIRO] (
        [IDROTEIRO], [DSROTEIRO], [CDCIDADEORIGEM], [CDCIDADEDESTINO], [DISTANCIAKM],
    `;
    
    if (temRESUMOROTA && RESUMOROTA) {
      query += `[RESUMOROTA],`;
    }
    
    if (temFGACTIVE) {
      query += `[FGACTIVE],`;
    }
    
    query += `
        [DHMAINTENANCE], [SGUSER], [SERVERORIG]
      )
      VALUES (@IDROTEIRO, @DSROTEIRO, @CDCIDADEORIGEM, @CDCIDADEDESTINO, @DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA) {
      query += `@RESUMOROTA,`;
    }
    
    if (temFGACTIVE) {
      query += `'S',`;
    }
    
    query += `GETDATE(), 'SYSTEM', 'AppDVcargas')
    `;

    const request = pool.request()
      .input('IDROTEIRO', sql.Decimal(15, 0), novoId)
      .input('DSROTEIRO', DSROTEIRO.trim())
      .input('CDCIDADEORIGEM', sql.Int, CDCIDADEORIGEM)
      .input('CDCIDADEDESTINO', sql.Int, CDCIDADEDESTINO)
      .input('DISTANCIAKM', DISTANCIAKM ? parseFloat(DISTANCIAKM) : null);
    
    if (temRESUMOROTA && RESUMOROTA) {
      request.input('RESUMOROTA', sql.NVarChar(sql.MAX), RESUMOROTA.trim());
    }
    
    await request.query(query);

    res.status(201).json({ success: true, message: 'Roteiro cadastrado com sucesso!', IDROTEIRO: novoId });
  } catch (err) {
    console.error('Erro ao inserir roteiro:', err);
    res.status(500).json({ error: 'Erro ao cadastrar roteiro.' });
  }
});

// Atualizar roteiro
router.put('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      DSROTEIRO, 
      CDCIDADEORIGEM, 
      CDCIDADEDESTINO, 
      DISTANCIAKM,
      RESUMOROTA,
      FGACTIVE
    } = req.body;

    if (!DSROTEIRO?.trim() || !CDCIDADEORIGEM || !CDCIDADEDESTINO) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const idNumerico = parseFloat(id);

    // Verificar se a tabela tem campo FGACTIVE e RESUMOROTA
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME IN ('FGACTIVE', 'RESUMOROTA')
      `);
    
    const temFGACTIVE = checkColumn.recordset.some(r => r.COLUMN_NAME === 'FGACTIVE');
    const temRESUMOROTA = checkColumn.recordset.some(r => r.COLUMN_NAME === 'RESUMOROTA');
    
    let query = `
      UPDATE [dbo].[ROTEIRO]
      SET 
        [DSROTEIRO] = @DSROTEIRO,
        [CDCIDADEORIGEM] = @CDCIDADEORIGEM,
        [CDCIDADEDESTINO] = @CDCIDADEDESTINO,
        [DISTANCIAKM] = @DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA !== undefined) {
      query += `[RESUMOROTA] = @RESUMOROTA,`;
    }
    
    if (temFGACTIVE && FGACTIVE) {
      query += `[FGACTIVE] = @FGACTIVE,`;
    }
    
    query += `
        [DHMAINTENANCE] = GETDATE(),
        [SGUSER] = 'SYSTEM',
        [SERVERORIG] = 'AppDVcargas'
      WHERE [IDROTEIRO] = @IDROTEIRO
    `;

    const request = pool.request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
      .input('DSROTEIRO', DSROTEIRO.trim())
      .input('CDCIDADEORIGEM', sql.Int, CDCIDADEORIGEM)
      .input('CDCIDADEDESTINO', sql.Int, CDCIDADEDESTINO)
      .input('DISTANCIAKM', DISTANCIAKM ? parseFloat(DISTANCIAKM) : null);
    
    if (temRESUMOROTA && RESUMOROTA !== undefined) {
      request.input('RESUMOROTA', sql.NVarChar(sql.MAX), RESUMOROTA ? RESUMOROTA.trim() : null);
    }
    
    if (temFGACTIVE && FGACTIVE) {
      request.input('FGACTIVE', sql.Char(1), FGACTIVE);
    }
    
    await request.query(query);

    res.json({ success: true, message: 'Roteiro atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar roteiro:', err);
    res.status(500).json({ error: 'Erro ao atualizar roteiro.' });
  }
});

// Excluir/Desativar roteiro (soft delete)
router.delete('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query; // 'activate' ou 'deactivate'
    const idNumerico = parseFloat(id);
    
    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    
    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    if (temFGACTIVE) {
      // Soft delete: atualizar FGACTIVE
      const novoStatus = action === 'activate' ? 'S' : 'N';
      const mensagem = action === 'activate' 
        ? 'Roteiro reativado com sucesso.' 
        : 'Roteiro desativado com sucesso.';
      
      await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
        .input('FGACTIVE', sql.Char(1), novoStatus)
        .query(`
          UPDATE [dbo].[ROTEIRO]
          SET [FGACTIVE] = @FGACTIVE,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = 'SYSTEM',
              [SERVERORIG] = 'AppDVcargas'
          WHERE [IDROTEIRO] = @IDROTEIRO
        `);

      res.json({ success: true, message: mensagem });
    } else {
      // Se não tiver FGACTIVE, fazer DELETE físico (comportamento antigo)
      await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
        .query(`
          DELETE FROM [dbo].[ROTEIRO]
          WHERE [IDROTEIRO] = @IDROTEIRO
        `);

      res.json({ success: true, message: 'Roteiro excluído com sucesso.' });
    }
  } catch (err) {
    console.error('Erro ao excluir roteiro:', err);
    res.status(500).json({ error: 'Erro ao excluir roteiro.' });
  }
});

// ============================================================================
// ROTAS PARA PONTOS DE ROTEIRO
// ============================================================================

// Listar pontos de um roteiro
router.get('/roteiros/:id/pontos', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(`
        SELECT 
          [IDROTEIRO],
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [CDPAISPASSAGEM],
          [ESTADOPASSAGEM],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO
        ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar pontos:', err);
    res.status(500).json({ error: 'Erro ao carregar pontos do roteiro.' });
  }
});

// Buscar um ponto específico
router.get('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .input('SEQUENCIA', sql.SmallInt, parseInt(sequencia))
      .query(`
        SELECT 
          [IDROTEIRO],
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [CDPAISPASSAGEM],
          [ESTADOPASSAGEM],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Ponto não encontrado.' });
    }
    
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Erro ao buscar ponto:', err);
    res.status(500).json({ error: 'Erro ao carregar ponto.' });
  }
});

// Criar novo ponto
router.post('/roteiros/:id/pontos', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      SEQUENCIA,
      ORDEM,
      DSLOCAL,
      DSPOSICAO,
      LATITUDE,
      LONGITUDE,
      TPLOCAL,
      KMENTREPONTOS,
      CDPAISPASSAGEM,
      ESTADOPASSAGEM
    } = req.body;
    
    if (!DSLOCAL?.trim() || !DSPOSICAO?.trim() || !ORDEM) {
      return res.status(400).json({ error: 'Local, Posição e Ordem são obrigatórios.' });
    }
    
    const pool = await poolPromise;
    const idRoteiro = parseFloat(id);
    
    // Se SEQUENCIA não foi informada, gerar automaticamente
    let sequenciaFinal = SEQUENCIA;
    if (!sequenciaFinal) {
      const maxSeqResult = await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
        .query('SELECT COALESCE(MAX([SEQUENCIA]), 0) + 1 AS [maxSeq] FROM [dbo].[ROTEIROPONTOS] WHERE [IDROTEIRO] = @IDROTEIRO');
      sequenciaFinal = getFirstNumericValue(maxSeqResult.recordset, 1);
    }
    
    // Truncar valores para não exceder tamanhos das colunas
    const dslocalTruncado = DSLOCAL ? DSLOCAL.trim().substring(0, 100) : '';
    const dsposicaoTruncado = DSPOSICAO ? DSPOSICAO.trim().substring(0, 100) : '';
    const tplocalTruncado = TPLOCAL ? TPLOCAL.trim().toUpperCase().substring(0, 2) : null;
    const estadopassagemTruncado = ESTADOPASSAGEM ? ESTADOPASSAGEM.trim().toUpperCase().substring(0, 3) : null;
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, sequenciaFinal)
      .input('ORDEM', sql.SmallInt, parseInt(ORDEM))
      .input('DSLOCAL', dslocalTruncado)
      .input('DSPOSICAO', dsposicaoTruncado)
      .input('LATITUDE', LATITUDE ? parseFloat(LATITUDE) : null)
      .input('LONGITUDE', LONGITUDE ? parseFloat(LONGITUDE) : null)
      .input('TPLOCAL', tplocalTruncado)
      .input('KMENTREPONTOS', KMENTREPONTOS ? parseFloat(KMENTREPONTOS) : null)
      .input('CDPAISPASSAGEM', CDPAISPASSAGEM ? parseInt(CDPAISPASSAGEM) : null)
      .input('ESTADOPASSAGEM', estadopassagemTruncado)
      .query(`
        INSERT INTO [dbo].[ROTEIROPONTOS] (
          [IDROTEIRO], [SEQUENCIA], [ORDEM], [DSLOCAL], [DSPOSICAO],
          [LATITUDE], [LONGITUDE], [TPLOCAL], [KMENTREPONTOS],
          [CDPAISPASSAGEM], [ESTADOPASSAGEM],
          [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @IDROTEIRO, @SEQUENCIA, @ORDEM, @DSLOCAL, @DSPOSICAO,
          @LATITUDE, @LONGITUDE, @TPLOCAL, @KMENTREPONTOS,
          @CDPAISPASSAGEM, @ESTADOPASSAGEM,
          GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);
    
    res.status(201).json({ success: true, message: 'Ponto cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir ponto:', err);
    if (err.number === 2627) { // Violation of PRIMARY KEY constraint
      return res.status(400).json({ error: 'Já existe um ponto com esta sequência para este roteiro.' });
    }
    res.status(500).json({ error: 'Erro ao cadastrar ponto.' });
  }
});

// Atualizar ponto
router.put('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const {
      ORDEM,
      DSLOCAL,
      DSPOSICAO,
      LATITUDE,
      LONGITUDE,
      TPLOCAL,
      KMENTREPONTOS,
      CDPAISPASSAGEM,
      ESTADOPASSAGEM
    } = req.body;
    
    if (!DSLOCAL?.trim() || !DSPOSICAO?.trim() || !ORDEM) {
      return res.status(400).json({ error: 'Local, Posição e Ordem são obrigatórios.' });
    }
    
    const pool = await poolPromise;
    const idRoteiro = parseFloat(id);
    const seqNum = parseInt(sequencia);
    
    // Truncar valores para não exceder tamanhos das colunas
    const dslocalTruncado = DSLOCAL ? DSLOCAL.trim().substring(0, 100) : '';
    const dsposicaoTruncado = DSPOSICAO ? DSPOSICAO.trim().substring(0, 100) : '';
    const tplocalTruncado = TPLOCAL ? TPLOCAL.trim().toUpperCase().substring(0, 2) : null;
    const estadopassagemTruncado = ESTADOPASSAGEM ? ESTADOPASSAGEM.trim().toUpperCase().substring(0, 3) : null;
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, seqNum)
      .input('ORDEM', sql.SmallInt, parseInt(ORDEM))
      .input('DSLOCAL', dslocalTruncado)
      .input('DSPOSICAO', dsposicaoTruncado)
      .input('LATITUDE', LATITUDE ? parseFloat(LATITUDE) : null)
      .input('LONGITUDE', LONGITUDE ? parseFloat(LONGITUDE) : null)
      .input('TPLOCAL', tplocalTruncado)
      .input('KMENTREPONTOS', KMENTREPONTOS ? parseFloat(KMENTREPONTOS) : null)
      .input('CDPAISPASSAGEM', CDPAISPASSAGEM ? parseInt(CDPAISPASSAGEM) : null)
      .input('ESTADOPASSAGEM', estadopassagemTruncado)
      .query(`
        UPDATE [dbo].[ROTEIROPONTOS]
        SET 
          [ORDEM] = @ORDEM,
          [DSLOCAL] = @DSLOCAL,
          [DSPOSICAO] = @DSPOSICAO,
          [LATITUDE] = @LATITUDE,
          [LONGITUDE] = @LONGITUDE,
          [TPLOCAL] = @TPLOCAL,
          [KMENTREPONTOS] = @KMENTREPONTOS,
          [CDPAISPASSAGEM] = @CDPAISPASSAGEM,
          [ESTADOPASSAGEM] = @ESTADOPASSAGEM,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    res.json({ success: true, message: 'Ponto atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar ponto:', err);
    res.status(500).json({ error: 'Erro ao atualizar ponto.' });
  }
});

// Excluir ponto
router.delete('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const pool = await poolPromise;
    const idRoteiro = parseFloat(id);
    const seqNum = parseInt(sequencia);
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, seqNum)
      .query(`
        DELETE FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    res.json({ success: true, message: 'Ponto excluído com sucesso.' });
  } catch (err) {
    console.error('Erro ao excluir ponto:', err);
    res.status(500).json({ error: 'Erro ao excluir ponto.' });
  }
});

// Executar init.sql do módulo Gerenciar Roteiros
router.post('/roteiros/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
    // Permite: SELECT, EXEC, EXECUTE, UPDATE, INSERT, DELETE (com cuidado)
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    // Verificar comandos bloqueados
    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ 
          error: `Comando não permitido: ${cmd}.` 
        });
      }
    }

    const { poolPromise } = require('../config/db');
    const pool = await poolPromise;
    
    // Dividir por GO se houver múltiplos comandos
    const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    
    const resultados = [];
    
    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;
      
      try {
        // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
        const request = pool.request();
        // mssql usa requestTimeout (em milissegundos)
        request.timeout = 120000; // 120 segundos (2 minutos) para comandos grandes
        const result = await request.query(cmdLimpo);
        
        // Se retornou dados (SELECT), incluir no resultado
        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({
            tipo: 'SELECT',
            rows: rows,
            rowCount: rows.length
          });
        } else {
          // Comando executado sem retorno (EXEC, UPDATE, etc)
          resultados.push({
            tipo: 'EXEC',
            message: 'Comando executado com sucesso.',
            rowsAffected: result.rowsAffected || [0]
          });
        }
      } catch (cmdErr) {
        // Se um comando falhar, continuar com os próximos mas registrar o erro
        let mensagemErro = cmdErr.message;
        
        // Melhorar mensagem de timeout
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
          detalhes: {
            nome: cmdErr.name,
            codigo: cmdErr.code,
            numero: cmdErr.number
          }
        });
      }
    }

    res.json({
      success: true,
      resultados: resultados,
      totalComandos: comandos.length
    });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    // Garantir que a resposta seja enviada antes de encerrar
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.',
        detalhes: err.message 
      });
    }
  }
});

// Gerar resumo da rota automaticamente
router.post('/roteiros/:id/gerar-resumo', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    
    // 1. Buscar roteiro para obter cidades de origem e destino
    const roteiroResult = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(`
        SELECT 
          [r].[CDCIDADEORIGEM],
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [r].[CDCIDADEDESTINO],
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[ESTADO] AS DESTINO_ESTADO
        FROM [dbo].[ROTEIRO] r
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [r].[IDROTEIRO] = @IDROTEIRO
      `);
    
    const roteiro = roteiroResult.recordset[0];
    const cidadeOrigemReal = roteiro?.ORIGEM_CIDADE || null;
    const estadoOrigemReal = roteiro?.ORIGEM_ESTADO || null;
    const cidadeDestinoReal = roteiro?.DESTINO_CIDADE || null;
    const estadoDestinoReal = roteiro?.DESTINO_ESTADO || null;
    
    // 2. Buscar pontos do roteiro
    const pontosResult = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(`
        SELECT 
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [ESTADOPASSAGEM]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO
          AND [LATITUDE] IS NOT NULL
          AND [LONGITUDE] IS NOT NULL
        ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);
    
    // Converter recordset para array JavaScript padrão
    const pontos = Array.from(pontosResult.recordset);
    
    if (pontos.length < 2) {
      return res.status(400).json({ 
        error: 'É necessário ter pelo menos 2 pontos com coordenadas para gerar o resumo.' 
      });
    }
    
    // 3. Obter nomes reais das cidades dos pontos
    // Identificar origem e destino pela ordem (primeiro = origem, último = destino)
    const primeiroPonto = pontos[0];
    const ultimoPonto = pontos[pontos.length - 1];
    
    for (let i = 0; i < pontos.length; i++) {
      const ponto = pontos[i];
      const isPrimeiro = i === 0;
      const isUltimo = i === pontos.length - 1;
      
      // Se for o primeiro ponto (origem), usar nome real da cidade da tabela
      if (isPrimeiro && cidadeOrigemReal) {
        ponto.NMCIDADE_REAL = cidadeOrigemReal;
        ponto.ESTADO_REAL = estadoOrigemReal;
        console.log(`[Resumo] Ponto origem: ${cidadeOrigemReal}/${estadoOrigemReal}`);
      }
      // Se for o último ponto (destino), usar nome real da cidade da tabela
      else if (isUltimo && cidadeDestinoReal) {
        ponto.NMCIDADE_REAL = cidadeDestinoReal;
        ponto.ESTADO_REAL = estadoDestinoReal;
        console.log(`[Resumo] Ponto destino: ${cidadeDestinoReal}/${estadoDestinoReal}`);
      }
      // Para todos os outros pontos (intermediários), buscar nome real usando Nominatim
      else {
        try {
          // Aguardar para respeitar rate limit (reduzido para ser mais rápido)
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
          const nominatimUrl = getReverseGeocodingUrl(ponto.LATITUDE, ponto.LONGITUDE);
          const nomResponse = await axios.get(nominatimUrl, {
            headers: { 
              'User-Agent': 'AtlasCargo/2.0' 
            },
                    timeout: 5000
          });
          
          const info = nomResponse.data;
          const cidade = info.address?.city || 
                        info.address?.town || 
                        info.address?.village || 
                        info.address?.municipality ||
                        info.address?.county || 
                        null;
          const estado = info.address?.state || 
                       info.address?.state_code || 
                       ponto.ESTADOPASSAGEM || 
                       '';
          
          if (cidade && cidade.trim() && cidade !== '') {
            // Limpar cidade: remover vírgulas, pontos e estados que possam estar no nome
            let cidadeLimpa = cidade.trim()
              .replace(/,\s*[A-Z]{2}$/i, '') // Remove ",SP", ",MG", etc do final
              .replace(/\.\s*[A-Z]{2}$/i, '') // Remove ".SP", ".MG", etc do final
              .replace(/\s+[A-Z]{2}$/i, '') // Remove " SP", " MG", etc do final
              .replace(/,\s*[A-Za-z\s]+$/i, '') // Remove vírgulas e texto após
              .trim();
            
            ponto.NMCIDADE_REAL = cidadeLimpa;
            ponto.ESTADO_REAL = estado || ponto.ESTADOPASSAGEM || '';
          } else {
            // Se Nominatim não retornou cidade, usar DSPOSICAO se disponível, senão DSLOCAL
            ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL;
            ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
          }
        } catch (nomErr) {
          // Se falhar, usar DSPOSICAO se disponível, senão DSLOCAL
          console.warn(`[Resumo Rota] Erro ao buscar cidade real para ponto ${i} (${ponto.DSLOCAL}):`, nomErr.message);
          ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL;
          ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
        }
      }
      
      // Garantir que sempre tenha um nome (fallback final)
      if (!ponto.NMCIDADE_REAL || ponto.NMCIDADE_REAL.trim() === '') {
        ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL || 'Cidade não identificada';
      }
      if (!ponto.ESTADO_REAL || ponto.ESTADO_REAL.trim() === '') {
        ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
      }
    }
    
    // 4. Montar coordenadas para OSRM (usar LONGITUDE, LATITUDE na ordem correta)
    // Validar coordenadas antes de montar
    const pontosValidos = pontos.filter(p => {
      const lat = parseFloat(p.LATITUDE);
      const lon = parseFloat(p.LONGITUDE);
      return !isNaN(lat) && !isNaN(lon) && 
             lat >= -90 && lat <= 90 && 
             lon >= -180 && lon <= 180;
    });
    
    if (pontosValidos.length < 2) {
      return res.status(400).json({ 
        error: 'É necessário ter pelo menos 2 pontos com coordenadas válidas para gerar o resumo.' 
      });
    }
    
    // Ordenar pontos por ORDEM para garantir ordem correta na rota
    const pontosOrdenados = [...pontosValidos].sort((a, b) => {
      const ordemA = parseFloat(a.ORDEM) || 0;
      const ordemB = parseFloat(b.ORDEM) || 0;
      return ordemA - ordemB;
    });
    
    const coords = pontosOrdenados.map(p => `${parseFloat(p.LONGITUDE)},${parseFloat(p.LATITUDE)}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${coords}?overview=full&geometries=geojson&steps=true`;
    
    // 5. Buscar rota do OSRM
    let osrmResponse;
    try {
      osrmResponse = await axios.get(osrmUrl, { timeout: 30000 });
    } catch (osrmErr) {
      console.error('[Resumo Rota] Erro ao buscar rota do OSRM:', osrmErr.message);
      return res.status(500).json({ 
        error: 'Erro ao conectar com o serviço de roteamento. Tente novamente mais tarde.' 
      });
    }
    
    const rotaData = osrmResponse.data;
    
    if (rotaData.code !== 'Ok' || !rotaData.routes || rotaData.routes.length === 0) {
      console.error('[Resumo Rota] OSRM retornou erro:', rotaData.code, rotaData.message);
      return res.status(400).json({ 
        error: 'Não foi possível calcular a rota. Verifique as coordenadas dos pontos.' 
      });
    }
    
    const route = rotaData.routes[0];
    const distanciaTotal = (route.distance / 1000).toFixed(2);
    const tempoEstimado = Math.round(route.duration / 3600); // em horas
    
    // 6. Identificar pontos principais (usando nomes reais)
    // Usar pontos ordenados para identificar origem e destino
    // Identificar origem e destino: primeiro por TPLOCAL, depois por ORDEM
    let pontoOrigem = pontosOrdenados.find(p => p.TPLOCAL === 'O' || p.TPLOCAL === 'Origem');
    let pontoDestino = pontosOrdenados.find(p => p.TPLOCAL === 'D' || p.TPLOCAL === 'Destino');
    
    // Se não encontrou por TPLOCAL, usar primeiro e último ponto por ORDEM
    if (!pontoOrigem) {
      // Primeiro ponto por ORDEM (menor ORDEM)
      pontoOrigem = pontosOrdenados[0];
    }
    if (!pontoDestino) {
      // Último ponto por ORDEM (maior ORDEM)
      pontoDestino = pontosOrdenados[pontosOrdenados.length - 1];
    }
    
    // Usar pontosOrdenados daqui em diante
    // O recordset do SQL Server pode não ser um array padrão, então vamos usar pontosOrdenados diretamente
    // Criar uma nova referência para os pontos ordenados
    const pontosParaProcessar = pontosOrdenados;
    
    // Filtrar pontos intermediários: excluir origem e destino identificados
    const pontosIntermediarios = pontosParaProcessar.filter(p => {
      const isOrigem = (p.SEQUENCIA === pontoOrigem.SEQUENCIA) || 
                       (p.ORDEM === pontoOrigem.ORDEM && pontoOrigem.ORDEM !== null && p.ORDEM === pontoOrigem.ORDEM);
      const isDestino = (p.SEQUENCIA === pontoDestino.SEQUENCIA) || 
                        (p.ORDEM === pontoDestino.ORDEM && pontoDestino.ORDEM !== null && p.ORDEM === pontoDestino.ORDEM);
      return !isOrigem && !isDestino;
    });
    
    // 7. Processar legs para obter informações de rodovias e cidades por trecho
    const trechosDetalhados = [];
    const todasRodovias = new Set();
    const todasCidades = new Set();
    
    // Adicionar cidades reais dos pontos à lista de cidades de referência
    pontos.forEach(p => {
      if (p.NMCIDADE_REAL && p.NMCIDADE_REAL.trim()) {
        todasCidades.add(p.NMCIDADE_REAL.trim());
      }
    });
    
    if (route.legs && route.legs.length > 0) {
      // Garantir que temos legs suficientes para os pontos
      const numLegs = Math.min(route.legs.length, pontos.length - 1);
      
      for (let legIndex = 0; legIndex < numLegs; legIndex++) {
        const leg = route.legs[legIndex];
        const pontoOrigemTrecho = pontos[legIndex];
        const pontoDestinoTrecho = pontos[legIndex + 1];
        
        // Validar que os pontos existem
        if (!pontoOrigemTrecho || !pontoDestinoTrecho) {
          console.warn(`[Resumo Rota] Ponto origem ou destino não encontrado para leg ${legIndex}`);
          continue;
        }
        
        const rodoviasTrecho = new Set();
        const cidadesTrecho = new Set();
        const instrucoesTrecho = [];
        
        // Processar steps do leg para extrair rodovias (na ordem da rota)
        const rodoviasTrechoOrdenadas = [];
        if (leg.steps && leg.steps.length > 0) {
          for (const step of leg.steps) {
            // Extrair rodovias do step - OSRM pode retornar em vários campos
            const refs = [];
            
            // Tentar step.ref (string ou array) - mais confiável
            if (step.ref) {
              if (Array.isArray(step.ref)) {
                refs.push(...step.ref);
              } else {
                refs.push(step.ref);
              }
            }
            
            // Tentar step.name (pode conter rodovia)
            if (step.name) {
              if (Array.isArray(step.name)) {
                refs.push(...step.name);
              } else {
                refs.push(step.name);
              }
            }
            
            // Tentar step.maneuver.ref
            if (step.maneuver && step.maneuver.ref) {
              if (Array.isArray(step.maneuver.ref)) {
                refs.push(...step.maneuver.ref);
              } else {
                refs.push(step.maneuver.ref);
              }
            }
            
            // Processar todas as referências encontradas
            for (const ref of refs) {
              if (!ref || typeof ref !== 'string') continue;
              
              // Padrões: "BR-101", "BR 101", "101" (assumindo BR se não especificado), "SC-280", etc.
              let rodoviaMatch = ref.match(/^(BR|SC|PR|RS|SP|RJ|MG|ES|BA|SE|AL|PE|PB|RN|CE|PI|MA|PA|AP|AM|RR|AC|RO|MT|MS|GO|DF|TO)[-\s]?(\d+)/i);
              
              // Se não encontrou prefixo, tentar apenas número (assumir BR)
              if (!rodoviaMatch && /^\d+$/.test(ref.trim())) {
                rodoviaMatch = ['', 'BR', ref.trim()];
              }
              
              if (rodoviaMatch) {
                const rodoviaFormatada = `${rodoviaMatch[1].toUpperCase()}-${rodoviaMatch[2]}`;
                // Adicionar na ordem (evitar duplicatas consecutivas)
                if (rodoviasTrechoOrdenadas.length === 0 || 
                    rodoviasTrechoOrdenadas[rodoviasTrechoOrdenadas.length - 1] !== rodoviaFormatada) {
                  rodoviasTrechoOrdenadas.push(rodoviaFormatada);
                }
                rodoviasTrecho.add(rodoviaFormatada);
                todasRodovias.add(rodoviaFormatada);
              }
            }
          }
        }
        
        // Extrair cidades dos steps usando Nominatim (buscar mais cidades para rotas longas)
        if (leg.steps && leg.steps.length > 0) {
          const stepsParaProcessar = [];
          const totalSteps = leg.steps.length;
          const distanciaTrecho = leg.distance / 1000;
          
          // Para rotas longas (>500km), buscar mais cidades (até 8)
          // Para rotas médias (200-500km), buscar 6-8 cidades
          // Para rotas curtas (<200km), buscar 4-5 cidades
          const numCidadesDesejadas = distanciaTrecho > 500 ? 8 : (distanciaTrecho > 200 ? 6 : 5);
          
          // Selecionar steps estratégicos distribuídos uniformemente ao longo da rota
          // Não incluir primeiro e último step (já são origem e destino)
          const stepsIntermediarios = totalSteps - 2; // Excluir primeiro e último
          
          if (stepsIntermediarios > 0) {
            // Distribuir steps uniformemente ao longo da rota
            // Processar apenas o número necessário de steps (não exagerar)
            const numStepsParaProcessar = Math.min(numCidadesDesejadas, stepsIntermediarios);
            
            // Distribuição uniforme simples
            for (let i = 0; i < numStepsParaProcessar; i++) {
              // Calcular posição distribuída uniformemente
              const posicao = Math.floor(1 + (i / Math.max(1, numStepsParaProcessar - 1)) * stepsIntermediarios);
              if (posicao >= 1 && posicao < totalSteps - 1) {
                // Evitar duplicatas
                const jaExiste = stepsParaProcessar.some(s => s.index === posicao);
                if (!jaExiste) {
                  stepsParaProcessar.push({ step: leg.steps[posicao], index: posicao });
                }
              }
            }
            
            // Adicionar apenas alguns steps extras em pontos estratégicos (quartis)
            if (totalSteps > 8) {
              const quartil1 = Math.floor(totalSteps * 0.25);
              const quartil2 = Math.floor(totalSteps * 0.5);
              const quartil3 = Math.floor(totalSteps * 0.75);
              
              [quartil1, quartil2, quartil3].forEach(q => {
                if (q > 0 && q < totalSteps - 1) {
                  const jaExiste = stepsParaProcessar.some(s => s.index === q);
                  if (!jaExiste && stepsParaProcessar.length < numCidadesDesejadas + 3) {
                    stepsParaProcessar.push({ step: leg.steps[q], index: q });
                  }
                }
              });
            }
          }
          
          // Se ainda não conseguiu steps suficientes, adicionar o meio
          if (stepsParaProcessar.length < 3 && totalSteps > 3) {
            const meio = Math.floor(totalSteps / 2);
            if (meio > 0 && meio < totalSteps - 1) {
              const jaExiste = stepsParaProcessar.some(s => s.index === meio);
              if (!jaExiste) {
                stepsParaProcessar.push({ step: leg.steps[meio], index: meio });
              }
            }
          }
          
          // Processar steps selecionados em paralelo (com limite de concorrência)
          const promisesNominatim = [];
          const maxConcorrencia = 3; // Reduzir concorrência para evitar rate limit (429)
          
          // Processar todos os steps selecionados (não limitar pelo numCidadesDesejadas aqui)
          // Ordenar por índice para processar na ordem da rota
          stepsParaProcessar.sort((a, b) => a.index - b.index);
          
          for (let idx = 0; idx < stepsParaProcessar.length; idx++) {
            const { step } = stepsParaProcessar[idx];
            
            if (step.maneuver && step.maneuver.location) {
              const [lon, lat] = step.maneuver.location;
              
              // Criar promise para processar esta cidade
              const promise = (async () => {
                try {
                  // Delay escalonado para evitar rate limit do Nominatim
                  // Aumentar delay entre grupos para evitar 429
                  if (idx > 0 && idx % maxConcorrencia === 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Aumentar para 2 segundos
                  }
                  
                  // Delay adicional antes de cada requisição para evitar sobrecarga
                  if (idx > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500)); // 500ms entre cada requisição
                  }
                  
                  const nominatimUrl = getReverseGeocodingUrl(lat, lon);
                  const nomResponse = await axios.get(nominatimUrl, {
                    headers: { 
                      'User-Agent': 'AtlasCargo/2.0' 
                    },
                    timeout: 10000 // Aumentar timeout para 10 segundos
                  });
                  
                  const info = nomResponse.data;
                  
                  // Tentar múltiplos campos para encontrar o nome da cidade (prioridade)
                  let cidade = info.address?.city || 
                              info.address?.town || 
                              info.address?.village || 
                              info.address?.municipality ||
                              info.address?.county || '';
                  
                  // Limpar cidade: remover vírgulas, pontos e estados que possam estar no nome
                  if (cidade) {
                    cidade = cidade.trim()
                      .replace(/,\s*[A-Z]{2}$/i, '') // Remove ",SP", ",MG", etc do final
                      .replace(/\.\s*[A-Z]{2}$/i, '') // Remove ".SP", ".MG", etc do final
                      .replace(/\s+[A-Z]{2}$/i, '') // Remove " SP", " MG", etc do final
                      .replace(/,\s*[A-Za-z\s]+$/i, '') // Remove vírgulas e texto após
                      .trim();
                  }
                  
                  // Tentar múltiplos campos para encontrar o estado
                  const estadoNome = info.address?.state || 
                                    info.address?.state_code || 
                                    '';
                  
                  // Verificar se encontrou uma cidade válida
                  if (cidade && cidade.trim().length > 2) {
                    // Ignorar apenas nomes genéricos óbvios
                    const cidadeLower = cidade.toLowerCase().trim();
                    const ignorar = ['brasil', 'brazil', 'unknown', 'desconhecido'];
                    if (ignorar.includes(cidadeLower)) {
                      return null;
                    }
                    
                    // Converter nome de estado para UF e formatar cidade
                    const cidadeCompleta = formatarCidadeComUF(cidade.trim(), estadoNome);
                    return cidadeCompleta; // Retornar para processar depois
                  }
                  
                  return null;
                } catch (nomErr) {
                  // Continuar mesmo se Nominatim falhar
                  console.warn(`[Resumo Rota] Erro ao buscar cidade do Nominatim:`, nomErr.message);
                  return null;
                }
              })();
              
              promisesNominatim.push(promise);
            }
          }
          
          // Aguardar todas as promises e processar resultados
          const resultados = await Promise.all(promisesNominatim);
          
          // Função auxiliar simples para comparar cidades (só nome, case-insensitive)
          const nomeCidade = (cidade) => {
            if (!cidade) return '';
            return cidade.split('/')[0].trim().toLowerCase();
          };
          
          let cidadesAdicionadas = 0;
          for (const cidadeCompleta of resultados) {
            if (cidadeCompleta && cidadeCompleta.trim() && cidadeCompleta.trim().length > 2) {
              // Adicionar todas as cidades únicas (sem duplicatas exatas)
              const nomeCidadeAtual = nomeCidade(cidadeCompleta);
              const jaExiste = Array.from(cidadesTrecho).some(c => 
                nomeCidade(c) === nomeCidadeAtual
              );
              
              if (!jaExiste) {
                cidadesTrecho.add(cidadeCompleta);
                todasCidades.add(cidadeCompleta);
                cidadesAdicionadas++;
              }
            }
          }
          
          // Log para debug
          if (cidadesAdicionadas === 0 && promisesNominatim.length > 0) {
            console.warn(`[Resumo Rota] ⚠️ Nenhuma cidade adicionada para trecho de ${distanciaTrecho.toFixed(1)}km. Processados: ${promisesNominatim.length} steps, Resultados válidos: ${resultados.filter(r => r && r.trim()).length}`);
          } else if (cidadesAdicionadas > 0) {
            console.log(`[Resumo Rota] ✅ ${cidadesAdicionadas} cidades adicionadas para trecho de ${distanciaTrecho.toFixed(1)}km: ${Array.from(cidadesTrecho).slice(0, 5).join(', ')}${cidadesTrecho.size > 5 ? '...' : ''}`);
          }
          
          // Extrair instrução importante (apenas primeira) de qualquer step
          if (leg.steps && leg.steps.length > 0) {
            for (const step of leg.steps) {
              if (step.maneuver && step.maneuver.instruction && instrucoesTrecho.length === 0) {
                instrucoesTrecho.push(step.maneuver.instruction);
                break;
              }
            }
          }
        }
        
        // Usar rodovias ordenadas (primeiras 3 principais do trecho)
        const rodoviasPrincipaisTrecho = rodoviasTrechoOrdenadas
          .filter((r, i, arr) => arr.indexOf(r) === i) // Remover duplicatas
          .slice(0, 3);
        
        trechosDetalhados.push({
          pontoOrigem: pontoOrigemTrecho,
          pontoDestino: pontoDestinoTrecho,
          distancia: leg.distance / 1000,
          rodovias: rodoviasPrincipaisTrecho.length > 0 ? rodoviasPrincipaisTrecho : Array.from(rodoviasTrecho).slice(0, 3),
          cidades: Array.from(cidadesTrecho),
          instrucoes: instrucoesTrecho
        });
      }
    }
    
    // 8. Montar resumo formatado seguindo o padrão do exemplo
    // Usar texto simples em vez de emojis para evitar problemas de encoding no banco
    let resumoTexto = `[] Resumo da Rota – Roteiro #${id}\n`;
    
    // Lista de pontos (origem, passagens/paradas, destino) - usando nomes reais
    const nomeOrigem = pontoOrigem.NMCIDADE_REAL || pontoOrigem.DSLOCAL;
    const estadoOrigem = pontoOrigem.ESTADO_REAL || pontoOrigem.ESTADOPASSAGEM || '';
    resumoTexto += `Início (Origem): ${formatarCidadeComUF(nomeOrigem, estadoOrigem)}\n`;
    
    // Filtrar apenas pontos intermediários reais (já filtrado acima, mas garantir)
    const pontosIntermediariosReais = pontosIntermediarios;
    
    if (pontosIntermediariosReais.length > 0) {
      pontosIntermediariosReais.forEach(p => {
        const tipoTexto = p.TPLOCAL === 'P' ? 'Passagem' : 'Parada';
        const nomeCidade = p.NMCIDADE_REAL || p.DSLOCAL;
        const estadoCidade = p.ESTADO_REAL || p.ESTADOPASSAGEM || '';
        resumoTexto += `${tipoTexto}: ${formatarCidadeComUF(nomeCidade, estadoCidade)}\n`;
      });
    }
    
    const nomeDestino = pontoDestino.NMCIDADE_REAL || pontoDestino.DSLOCAL;
    const estadoDestino = pontoDestino.ESTADO_REAL || pontoDestino.ESTADOPASSAGEM || '';
    resumoTexto += `Destino (Final): ${formatarCidadeComUF(nomeDestino, estadoDestino)}\n\n`;
    
    // Orientações de percurso
    resumoTexto += `[] Orientações de percurso\n`;
    
    // Processar cada trecho detalhadamente
    for (let i = 0; i < trechosDetalhados.length; i++) {
      const trecho = trechosDetalhados[i];
      const pontoAtual = trecho.pontoOrigem;
      const proximoPonto = trecho.pontoDestino;
      const distanciaTrecho = trecho.distancia || proximoPonto.KMENTREPONTOS || 0;
      
      // Usar nomes reais das cidades com UF
      const nomeAtual = pontoAtual.NMCIDADE_REAL || pontoAtual.DSLOCAL;
      const estadoAtual = pontoAtual.ESTADO_REAL || pontoAtual.ESTADOPASSAGEM || '';
      const nomeProximo = proximoPonto.NMCIDADE_REAL || proximoPonto.DSLOCAL;
      const estadoProximo = proximoPonto.ESTADO_REAL || proximoPonto.ESTADOPASSAGEM || '';
      
      resumoTexto += `Trecho ${formatarCidadeComUF(nomeAtual, estadoAtual)} -> ${formatarCidadeComUF(nomeProximo, estadoProximo)} (~ ${Math.round(distanciaTrecho)} km)\n`;
      
      // Adicionar instruções de rodovias de forma mais detalhada
      if (trecho.rodovias.length > 0) {
        const rodoviasFormatadas = trecho.rodovias.slice(0, 5);
        
        if (i === 0) {
          // Primeiro trecho: instrução de saída detalhada
          if (rodoviasFormatadas.length >= 2) {
            // Se houver múltiplas rodovias, mostrar conexão
            // Pegar primeira cidade intermediária que não seja a origem
            const primeiraCidadeIntermediaria = trecho.cidades && trecho.cidades.length > 0
              ? trecho.cidades.find(c => {
                  if (!c) return false;
                  const cidadeNome = c.split('/')[0].trim().toLowerCase();
                  return cidadeNome !== nomeAtual.split('/')[0].trim().toLowerCase();
                }) || trecho.cidades[0]
              : null;
            
            if (primeiraCidadeIntermediaria) {
              resumoTexto += `Seguir pela ${rodoviasFormatadas[0]} até ${primeiraCidadeIntermediaria}.\n`;
            } else {
              resumoTexto += `Seguir pela ${rodoviasFormatadas[0]}.\n`;
            }
            resumoTexto += `Entrar na ${rodoviasFormatadas[1]} em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
          } else {
            resumoTexto += `Pela ${rodoviasFormatadas[0]}, em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
          }
        } else {
          // Trechos seguintes
          if (rodoviasFormatadas.length >= 2) {
            resumoTexto += `Continuar pela ${rodoviasFormatadas[0]}, depois pegar a ${rodoviasFormatadas[1]}.\n`;
          } else if (rodoviasFormatadas.length === 1) {
            resumoTexto += `Seguir pela ${rodoviasFormatadas[0]}.\n`;
          }
        }
      } else {
        // Se não encontrou rodovias, usar descrição genérica
        resumoTexto += `Seguir pela rota principal em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
      }
      
      // Adicionar cidades de referência (cidades intermediárias encontradas pelo Nominatim)
      // Não incluir origem e destino do trecho, apenas cidades intermediárias
      if (trecho.cidades && Array.isArray(trecho.cidades) && trecho.cidades.length > 0) {
        // Simplificar: só remover se for EXATAMENTE igual (case-insensitive, sem estado)
        const nomeAtualSemEstado = nomeAtual.split('/')[0].trim().toLowerCase();
        const nomeProximoSemEstado = nomeProximo.split('/')[0].trim().toLowerCase();
        
        const cidadesFormatadas = trecho.cidades
          .filter(c => {
            if (!c || !c.trim() || c.trim().length < 3) return false;
            
            const cSemEstado = c.split('/')[0].trim().toLowerCase();
            
            // Remover apenas se for EXATAMENTE igual (case-insensitive)
            return cSemEstado !== nomeAtualSemEstado && 
                   cSemEstado !== nomeProximoSemEstado;
          })
          .slice(0, 20); // Até 20 cidades intermediárias
        
        // SEMPRE mostrar "Passa por..." se houver pelo menos uma cidade válida
        if (cidadesFormatadas.length > 0) {
          resumoTexto += `Passa por ${cidadesFormatadas.join(', ')}.\n`;
        } else {
          // Debug: verificar por que as cidades foram filtradas
          console.log(`[Resumo Rota] ⚠️ Trecho ${nomeAtual} -> ${nomeProximo}: ${trecho.cidades.length} cidades coletadas, mas todas foram filtradas. Cidades:`, trecho.cidades);
        }
      } else {
        // Debug: verificar por que não há cidades
        console.log(`[Resumo Rota] ⚠️ Trecho ${nomeAtual} -> ${nomeProximo}: sem cidades. trecho.cidades =`, trecho.cidades);
      }
      
      resumoTexto += `Chegada em ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n\n`;
    }
    
    // Pontos importantes
    resumoTexto += `[] Pontos importantes\n`;
    resumoTexto += `Distância total: ${distanciaTotal} km.\n`;
    resumoTexto += `Tempo estimado de viagem: ${tempoEstimado}–${tempoEstimado + 2} horas (dependendo de tráfego e paradas).\n`;
    
    // 7. Salvar resumo no banco
    const checkResumoColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'RESUMOROTA'
      `);
    
    const temRESUMOROTA = checkResumoColumn.recordset.length > 0;
    
    if (temRESUMOROTA) {
      await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
        .input('RESUMOROTA', sql.NVarChar(sql.MAX), resumoTexto)
        .query(`
          UPDATE [dbo].[ROTEIRO]
          SET [RESUMOROTA] = @RESUMOROTA,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = 'SYSTEM',
              [SERVERORIG] = 'AppDVcargas'
          WHERE [IDROTEIRO] = @IDROTEIRO
        `);
    }
    
    res.json({
      success: true,
      resumo: resumoTexto,
      distanciaTotal: parseFloat(distanciaTotal),
      tempoEstimado: tempoEstimado,
      pontosProcessados: pontosParaProcessar.length
    });
    
  } catch (err) {
    console.error('Erro ao gerar resumo da rota:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Erro ao gerar resumo da rota.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;