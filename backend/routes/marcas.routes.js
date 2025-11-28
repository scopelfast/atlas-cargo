// backend/routes/marcas.routes.js
const express = require('express');
const sql = require('mssql');
const router = express.Router();
const { poolPromise } = require('../config/db');

// Listar marcas
router.get('/marcas', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(`
        SELECT 
          CDMARCAEQUIPAMENTO AS id,
          DSMARCAEQUIPAMENTO AS nome,
          FGACTIVE AS ativo
        FROM MARCAEQUIPAMENTO
        ORDER BY DSMARCAEQUIPAMENTO
      `);
    const marcas = result.recordset.map(m => ({
      CDMARCAEQUIPAMENTO: m.id,
      DSMARCAEQUIPAMENTO: m.nome,
      FGACTIVE: m.ativo === 'A' ? 'S' : 'N'
    }));
    res.json(marcas);
  } catch (err) {
    console.error('Erro ao listar marcas de equipamento:', err);
    res.status(500).json({ error: 'Erro ao carregar marcas.' });
  }
});

// Buscar marca por ID
router.get('/marcas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', idNum)
      .query(`
        SELECT 
          CDMARCAEQUIPAMENTO,
          DSMARCAEQUIPAMENTO,
          FGACTIVE
        FROM MARCAEQUIPAMENTO
        WHERE CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Marca não encontrada.' });
    }

    const marca = result.recordset[0];
    res.json({
      CDMARCAEQUIPAMENTO: marca.CDMARCAEQUIPAMENTO,
      DSMARCAEQUIPAMENTO: marca.DSMARCAEQUIPAMENTO,
      FGACTIVE: marca.FGACTIVE === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar marca:', err);
    res.status(500).json({ error: 'Erro ao buscar marca.' });
  }
});

// Inserir
router.post('/marcas', async (req, res) => {
  try {
    const { DSMARCAEQUIPAMENTO } = req.body;
    if (!DSMARCAEQUIPAMENTO?.trim()) {
      return res.status(400).json({ error: 'Nome da marca de equipamento é obrigatório.' });
    }

    const pool = await poolPromise;
    const maxResult = await pool
      .request()
      .query('SELECT ISNULL(MAX(CDMARCAEQUIPAMENTO), 0) AS maxId FROM MARCAEQUIPAMENTO');
    const novoId = maxResult.recordset[0].maxId + 1;

    await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', novoId)
      .input('DSMARCAEQUIPAMENTO', DSMARCAEQUIPAMENTO.trim())
      .query(`
        INSERT INTO MARCAEQUIPAMENTO (CDMARCAEQUIPAMENTO, DSMARCAEQUIPAMENTO, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG)
        VALUES (@CDMARCAEQUIPAMENTO, @DSMARCAEQUIPAMENTO, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')
      `);

    res.status(201).json({ success: true, message: 'Marca de equipamento cadastrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir marca:', err);
    res.status(500).json({ error: 'Erro ao cadastrar marca de equipamento.' });
  }
});

// Atualizar
router.put('/marcas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSMARCAEQUIPAMENTO, FGACTIVE } = req.body;

    if (!DSMARCAEQUIPAMENTO?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', id)
      .input('DSMARCAEQUIPAMENTO', DSMARCAEQUIPAMENTO.trim())
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE MARCAEQUIPAMENTO 
        SET 
          DSMARCAEQUIPAMENTO = @DSMARCAEQUIPAMENTO,
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO
      `);

    res.json({ success: true, message: 'Marca de equipamento atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar marca de equipamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar marca.' });
  }
});

// Inativar/Reativar marca (desativação, não exclusão física)
router.delete('/marcas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    
    // Validar e converter ID para número
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    
    const pool = await poolPromise;

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', idNum)
      .query(`SELECT FGACTIVE FROM MARCAEQUIPAMENTO WHERE CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Marca de equipamento não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Marca de equipamento reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Marca de equipamento desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Marca de equipamento desativada com sucesso!' : 'Marca de equipamento reativada com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', idNum)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE MARCAEQUIPAMENTO 
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Marca de equipamento não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da marca:', err);
    res.status(500).json({ error: 'Erro ao alterar status da marca de equipamento.' });
  }
});

// Executar init.sql
router.post('/marcas/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
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
        request.timeout = 120000; // 120 segundos (2 minutos)
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
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200),
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
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.' 
      });
    }
  }
});

module.exports = router;