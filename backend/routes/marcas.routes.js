// backend/routes/marcas.routes.js
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

// Listar marcas (query nativa PostgreSQL para evitar problema de capitalização)
router.get('/marcas', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tenantId];
    let next = 2;
    let where = `("TENANT_ID" = $1 OR "TENANT_ID" = 'default')`;
    if (codigo) {
      const n = parseInt(codigo, 10);
      if (!isNaN(n) && n > 0) {
        where += ` AND "CDMARCAEQUIPAMENTO" = $${next}`;
        params.push(n);
        next++;
      }
    }
    if (descricao && String(descricao).trim()) {
      where += ` AND "DSMARCAEQUIPAMENTO" ILIKE $${next}`;
      params.push(`%${String(descricao).trim()}%`);
      next++;
    }
    if (situacao === 'S') {
      where += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S')`;
    } else if (situacao === 'N') {
      where += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
    }
    const result = await pool.query(`
      SELECT "CDMARCAEQUIPAMENTO", "DSMARCAEQUIPAMENTO", "FGACTIVE"
      FROM "MARCAEQUIPAMENTO"
      WHERE ${where}
      ORDER BY "DSMARCAEQUIPAMENTO"
    `, params);
    const rows = result.rows || [];
    const marcas = rows.map(r => {
      const fg = r.FGACTIVE ?? r.fgactive;
      const ativo = fg === 'A' || fg === 'S';
      return {
        CDMARCAEQUIPAMENTO: r.CDMARCAEQUIPAMENTO ?? r.cdmarcaequipamento,
        DSMARCAEQUIPAMENTO: r.DSMARCAEQUIPAMENTO ?? r.dsmarcaequipamento,
        FGACTIVE: ativo ? 'S' : 'N'
      };
    });
    res.json(marcas);
  } catch (err) {
    if (err.code === '42P01') {
      return res.json([]);
    }
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
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT "CDMARCAEQUIPAMENTO", "DSMARCAEQUIPAMENTO", "FGACTIVE"
       FROM "MARCAEQUIPAMENTO"
       WHERE "CDMARCAEQUIPAMENTO" = $1
         AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Marca não encontrada.' });
    }

    const marca = rows[0];
    const get = (r, k) => r[k] != null ? r[k] : r[k && k.toLowerCase()];
    const fg = get(marca, 'FGACTIVE');
    const ativo = fg === 'A' || fg === 'S';
    res.json({
      CDMARCAEQUIPAMENTO: get(marca, 'CDMARCAEQUIPAMENTO'),
      DSMARCAEQUIPAMENTO: get(marca, 'DSMARCAEQUIPAMENTO'),
      FGACTIVE: ativo ? 'S' : 'N'
    });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabela de marcas ainda não disponível.' });
    }
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
    const tenantId = tenantIdForRequest(req);
    const descricao = DSMARCAEQUIPAMENTO.trim();

    // Evitar duplicata por descrição no mesmo tenant (case-insensitive)
    const existente = await pool.query(
      `SELECT 1 FROM "MARCAEQUIPAMENTO"
       WHERE UPPER(TRIM("DSMARCAEQUIPAMENTO")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2
       LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma marca com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () => {
      const r = await pool.query('SELECT COALESCE(MAX("CDMARCAEQUIPAMENTO"), 0) + 1 AS "maxId" FROM "MARCAEQUIPAMENTO"');
      const row = r.rows && r.rows[0] ? r.rows[0] : {};
      const v = row.maxId ?? row.maxid;
      return typeof v === 'number' ? v : parseInt(v, 10) || 1;
    };
    let novoId = await getProximoId();
    try {
      await pool.query(
        `INSERT INTO "MARCAEQUIPAMENTO" ("CDMARCAEQUIPAMENTO", "DSMARCAEQUIPAMENTO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
         VALUES ($1, $2, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', $3)`,
        [novoId, descricao, tenantId]
      );
    } catch (e) {
      if (String(e.code) === '23505') {
        novoId = await getProximoId();
        await pool.query(
          `INSERT INTO "MARCAEQUIPAMENTO" ("CDMARCAEQUIPAMENTO", "DSMARCAEQUIPAMENTO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
           VALUES ($1, $2, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', $3)`,
          [novoId, descricao, tenantId]
        );
      } else throw e;
    }
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
    const tenantId = tenantIdForRequest(req);
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    // Evitar duplicata: outra marca do mesmo tenant (código diferente) com a mesma descrição
    const existente = await pool.query(
      `SELECT 1 FROM "MARCAEQUIPAMENTO"
       WHERE UPPER(TRIM("DSMARCAEQUIPAMENTO")) = UPPER(TRIM($1))
         AND "CDMARCAEQUIPAMENTO" != $2
         AND "TENANT_ID" = $3
       LIMIT 1`,
      [DSMARCAEQUIPAMENTO.trim(), idNum, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outra marca com esta descrição. Não é permitido duplicar.' });
    }

    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    const upd = await pool.query(
      `UPDATE "MARCAEQUIPAMENTO"
       SET "DSMARCAEQUIPAMENTO" = $1, "FGACTIVE" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDMARCAEQUIPAMENTO" = $3 AND "TENANT_ID" = $4`,
      [DSMARCAEQUIPAMENTO.trim(), fgactiveDB, idNum, tenantId]
    );

    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Marca não encontrada ou não pode ser alterada (catálogo compartilhado).' });
    }

    res.json({ success: true, message: 'Marca de equipamento atualizada com sucesso!' });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabela de marcas ainda não disponível.' });
    }
    console.error('Erro ao atualizar marca de equipamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar marca.' });
  }
});

// Inativar/Reativar marca (desativação, não exclusão física)
router.delete('/marcas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);

    const checkResult = await pool.query(
      `SELECT "FGACTIVE" FROM "MARCAEQUIPAMENTO" WHERE "CDMARCAEQUIPAMENTO" = $1 AND "TENANT_ID" = $2`,
      [idNum, tenantId]
    );

    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Marca de equipamento não encontrada.' });
    }

    const statusAtual = checkResult.rows[0].FGACTIVE ?? checkResult.rows[0].fgactive;
    const estaAtivo = statusAtual === 'A' || statusAtual === 'S';

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

    const updateResult = await pool.query(
      `UPDATE "MARCAEQUIPAMENTO"
       SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDMARCAEQUIPAMENTO" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNum, tenantId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Marca de equipamento não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabela de marcas ainda não disponível.' });
    }
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