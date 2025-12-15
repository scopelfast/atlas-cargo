// backend/routes/roteiros.routes.js
// Gerenciar Roteiros - API
// Versão: 1.3
// Autor: Sistema DivulgaCarga
// Data: 2025-01-13
// Última atualização: Adicionado suporte ao campo RESUMOROTA

const express = require('express');
const sql = require('mssql');
const router = express.Router();
const { poolPromise } = require('../config/db');

// Listar roteiros com filtros
router.get('/roteiros', async (req, res) => {
  try {
    const { 
      codigo, 
      descricao, 
      origemEstado, origemCidade, 
      destinoEstado, destinoCidade 
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
        r.IDROTEIRO,
        r.DSROTEIRO,
        r.DISTANCIAKM,
        r.CDCIDADEORIGEM,
        co.ESTADO AS ORIGEM_ESTADO,
        co.NMCIDADE AS ORIGEM_CIDADE,
        r.CDCIDADEDESTINO,
        cd.ESTADO AS DESTINO_ESTADO,
        cd.NMCIDADE AS DESTINO_CIDADE,
        r.RESUMOROTA
    `;
    
    if (temFGACTIVE) {
      query += `, ISNULL(r.FGACTIVE, 'S') AS FGACTIVE`;
    } else {
      query += `, 'S' AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
      LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
      WHERE 1=1
    `;

    const params = [];
    if (codigo) {
      query += ` AND r.IDROTEIRO = @CODIGO`;
      params.push({ name: 'CODIGO', value: codigo });
    }
    if (descricao) {
      query += ` AND r.DSROTEIRO LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (origemEstado) {
      query += ` AND co.ESTADO = @ORIGEM_ESTADO`;
      params.push({ name: 'ORIGEM_ESTADO', value: origemEstado });
    }
    if (origemCidade) {
      query += ` AND co.NMCIDADE LIKE @ORIGEM_CIDADE`;
      params.push({ name: 'ORIGEM_CIDADE', value: `%${origemCidade}%` });
    }
    if (destinoEstado) {
      query += ` AND cd.ESTADO = @DESTINO_ESTADO`;
      params.push({ name: 'DESTINO_ESTADO', value: destinoEstado });
    }
    if (destinoCidade) {
      query += ` AND cd.NMCIDADE LIKE @DESTINO_CIDADE`;
      params.push({ name: 'DESTINO_CIDADE', value: `%${destinoCidade}%` });
    }

    query += ` ORDER BY r.IDROTEIRO`;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const roteiros = result.recordset.map(r => {
      const roteiro = {
        IDROTEIRO: r.IDROTEIRO,
        DSROTEIRO: r.DSROTEIRO,
        DISTANCIAKM: r.DISTANCIAKM,
        CDCIDADEORIGEM: r.CDCIDADEORIGEM,
        ORIGEM_ESTADO: r.ORIGEM_ESTADO,
        ORIGEM_CIDADE: r.ORIGEM_CIDADE,
        CDCIDADEDESTINO: r.CDCIDADEDESTINO,
        DESTINO_ESTADO: r.DESTINO_ESTADO,
        DESTINO_CIDADE: r.DESTINO_CIDADE,
        RESUMOROTA: r.RESUMOROTA || null
      };
      
      // Adicionar FGACTIVE se existir no resultado
      if (temFGACTIVE && r.FGACTIVE !== undefined) {
        roteiro.FGACTIVE = r.FGACTIVE;
      } else {
        roteiro.FGACTIVE = 'S'; // Default se não existir o campo
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
    
    let query = `
      SELECT 
        r.IDROTEIRO,
        r.DSROTEIRO,
        r.DISTANCIAKM,
        r.CDCIDADEORIGEM,
        co.ESTADO AS ORIGEM_ESTADO,
        co.NMCIDADE AS ORIGEM_CIDADE,
        r.CDCIDADEDESTINO,
        cd.ESTADO AS DESTINO_ESTADO,
        cd.NMCIDADE AS DESTINO_CIDADE,
        r.RESUMOROTA
    `;
    
    if (temFGACTIVE) {
      query += `, ISNULL(r.FGACTIVE, 'S') AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
      LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
      WHERE r.IDROTEIRO = @IDROTEIRO
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
      IDROTEIRO: r.IDROTEIRO,
      DSROTEIRO: r.DSROTEIRO,
      DISTANCIAKM: r.DISTANCIAKM,
      CDCIDADEORIGEM: r.CDCIDADEORIGEM,
      ORIGEM_ESTADO: r.ORIGEM_ESTADO,
      ORIGEM_CIDADE: r.ORIGEM_CIDADE,
      CDCIDADEDESTINO: r.CDCIDADEDESTINO,
      DESTINO_ESTADO: r.DESTINO_ESTADO,
      DESTINO_CIDADE: r.DESTINO_CIDADE,
      RESUMOROTA: r.RESUMOROTA || null
    };
    
    if (temFGACTIVE && r.FGACTIVE !== undefined) {
      responseData.FGACTIVE = r.FGACTIVE;
    } else {
      responseData.FGACTIVE = 'S'; // Default se não existir o campo
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
      .query('SELECT ISNULL(MAX(IDROTEIRO), 0) AS maxId FROM [dbo].[ROTEIRO]');
    const novoId = maxResult.recordset[0].maxId + 1;

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
        IDROTEIRO, DSROTEIRO, CDCIDADEORIGEM, CDCIDADEDESTINO, DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA) {
      query += `RESUMOROTA,`;
    }
    
    if (temFGACTIVE) {
      query += `FGACTIVE,`;
    }
    
    query += `
        DHMAINTENANCE, SGUSER, SERVERORIG
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

    res.status(201).json({ success: true, message: 'Roteiro cadastrado com sucesso!' });
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
        DSROTEIRO = @DSROTEIRO,
        CDCIDADEORIGEM = @CDCIDADEORIGEM,
        CDCIDADEDESTINO = @CDCIDADEDESTINO,
        DISTANCIAKM = @DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA !== undefined) {
      query += `RESUMOROTA = @RESUMOROTA,`;
    }
    
    if (temFGACTIVE && FGACTIVE) {
      query += `FGACTIVE = @FGACTIVE,`;
    }
    
    query += `
        DHMAINTENANCE = GETDATE(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
      WHERE IDROTEIRO = @IDROTEIRO
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
          SET FGACTIVE = @FGACTIVE,
              DHMAINTENANCE = GETDATE(),
              SGUSER = 'SYSTEM',
              SERVERORIG = 'AppDVcargas'
          WHERE IDROTEIRO = @IDROTEIRO
        `);

      res.json({ success: true, message: mensagem });
    } else {
      // Se não tiver FGACTIVE, fazer DELETE físico (comportamento antigo)
      await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
        .query(`
          DELETE FROM [dbo].[ROTEIRO]
          WHERE IDROTEIRO = @IDROTEIRO
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
          IDROTEIRO,
          SEQUENCIA,
          ORDEM,
          DSLOCAL,
          DSPOSICAO,
          LATITUDE,
          LONGITUDE,
          TPLOCAL,
          KMENTREPONTOS,
          CDPAISPASSAGEM,
          ESTADOPASSAGEM,
          DHMAINTENANCE,
          SGUSER,
          SERVERORIG
        FROM [dbo].[ROTEIROPONTOS]
        WHERE IDROTEIRO = @IDROTEIRO
        ORDER BY ORDEM ASC, SEQUENCIA ASC
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
          IDROTEIRO,
          SEQUENCIA,
          ORDEM,
          DSLOCAL,
          DSPOSICAO,
          LATITUDE,
          LONGITUDE,
          TPLOCAL,
          KMENTREPONTOS,
          CDPAISPASSAGEM,
          ESTADOPASSAGEM,
          DHMAINTENANCE,
          SGUSER,
          SERVERORIG
        FROM [dbo].[ROTEIROPONTOS]
        WHERE IDROTEIRO = @IDROTEIRO AND SEQUENCIA = @SEQUENCIA
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
        .query('SELECT ISNULL(MAX(SEQUENCIA), 0) AS maxSeq FROM [dbo].[ROTEIROPONTOS] WHERE IDROTEIRO = @IDROTEIRO');
      sequenciaFinal = maxSeqResult.recordset[0].maxSeq + 1;
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
          IDROTEIRO, SEQUENCIA, ORDEM, DSLOCAL, DSPOSICAO,
          LATITUDE, LONGITUDE, TPLOCAL, KMENTREPONTOS,
          CDPAISPASSAGEM, ESTADOPASSAGEM,
          DHMAINTENANCE, SGUSER, SERVERORIG
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
          ORDEM = @ORDEM,
          DSLOCAL = @DSLOCAL,
          DSPOSICAO = @DSPOSICAO,
          LATITUDE = @LATITUDE,
          LONGITUDE = @LONGITUDE,
          TPLOCAL = @TPLOCAL,
          KMENTREPONTOS = @KMENTREPONTOS,
          CDPAISPASSAGEM = @CDPAISPASSAGEM,
          ESTADOPASSAGEM = @ESTADOPASSAGEM,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE IDROTEIRO = @IDROTEIRO AND SEQUENCIA = @SEQUENCIA
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
        WHERE IDROTEIRO = @IDROTEIRO AND SEQUENCIA = @SEQUENCIA
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

module.exports = router;