// backend/routes/equipamento.routes.js
const express = require('express');
const sql = require('mssql');
const router = express.Router();
const { poolPromise } = require('../config/db');

// Função helper para criar rotas de combo
const createComboRoute = (tableName, idField, nameField) => {
  return async (req, res) => {
    try {
      const pool = await poolPromise;
      
      // Construir query com filtro de ativos se a tabela tiver campo FGACTIVE
      let query = `SELECT ${idField}, ${nameField} FROM [dbo].[${tableName}]`;
      
      // Filtrar apenas registros ativos se a tabela tiver campo FGACTIVE
      // TIPOEQUIPAMENTO, GRUPOEQUIPAMENTO, MARCAEQUIPAMENTO, CLASSEFROTA geralmente têm FGACTIVE
      if (tableName === 'TIPOEQUIPAMENTO' || tableName === 'GRUPOEQUIPAMENTO' || 
          tableName === 'MARCAEQUIPAMENTO' || tableName === 'CLASSEFROTA') {
        query += ` WHERE FGACTIVE = 'A' OR FGACTIVE = 'S'`;
      }
      
      query += ` ORDER BY ${nameField}`;
      
      const result = await pool.request().query(query);
      
      if (!result || !result.recordset) {
        return res.status(500).json({ error: `Erro: resultado inválido ao carregar ${tableName}.` });
      }
      
      res.json(result.recordset);
    } catch (err) {
      console.error(`Erro ao carregar ${tableName}:`, err);
      console.error(`Detalhes:`, err.message);
      console.error(`Stack:`, err.stack);
      
      // Retornar erro mais detalhado em desenvolvimento
      const errorResponse = {
        error: `Erro ao carregar ${tableName}.`,
        detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
      };
      
      res.status(500).json(errorResponse);
    }
  };
};

// Listar equipamentos com filtros
router.get('/equipamentos', async (req, res) => {
  try {
    const {
      idequipamento,
      refequipamento,
      cdgrupo,
      cdtipo,
      cdmarca,
      cdmodelo,
      cdclasse,
      fgactive,
      fgtipoatuacao,
      fgtipocarroceria,
      fgrastreado
    } = req.query;

    let query = `
      SELECT 
        e.IDEQUIPAMENTO,
        e.REFEQUIPAMENTO,
        e.DSEQUIPAMENTO,
        e.CDGRUPOEQUIPAMENTO,
        g.DSGRUPOEQUIPAMENTO AS GRUPO_NOME,
        e.CDTIPOEQUIPAMENTO,
        t.DSTIPOEQUIPAMENTO AS TIPO_NOME,
        e.CDMARCAEQUIPAMENTO,
        m.DSMARCAEQUIPAMENTO AS MARCA_NOME,
        e.CDMODELOEQUIPAMENTO,
        mod.DSMODELOEQUIPAMENTO AS MODELO_NOME,
        e.CDCLASSEFROTA,
        c.DSCLASSEFROTA AS CLASSE_NOME,
        e.FGACTIVE,
        e.FGTIPOATUACAO,
        e.FGTIPOCARROCERIA,
        e.NREIXOS,
        e.CAPACIDCARGA,
        e.ANOFABRICA,
        e.ALTURA,
        e.LARGURA,
        e.COMPRIMENTO,
        e.MTCUBICO,
        e.FGRASTREADO
      FROM [dbo].[EQUIPAMENTO] e
      LEFT JOIN [dbo].[GRUPOEQUIPAMENTO] g ON e.CDGRUPOEQUIPAMENTO = g.CDGRUPOEQUIPAMENTO
      LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON e.CDTIPOEQUIPAMENTO = t.CDTIPOEQUIPAMENTO
      LEFT JOIN [dbo].[MARCAEQUIPAMENTO] m ON e.CDMARCAEQUIPAMENTO = m.CDMARCAEQUIPAMENTO
      LEFT JOIN [dbo].[MODELOEQUIPAMENTO] mod ON e.CDMODELOEQUIPAMENTO = mod.CDMODELOEQUIPAMENTO
      LEFT JOIN [dbo].[CLASSEFROTA] c ON e.CDCLASSEFROTA = c.CDCLASSEFROTA
      WHERE 1=1
    `;

    const params = [];

    if (idequipamento) {
      query += ` AND e.IDEQUIPAMENTO = @IDEQUIPAMENTO`;
      params.push({ name: 'IDEQUIPAMENTO', value: parseFloat(idequipamento) });
    }
    if (refequipamento) {
      query += ` AND e.REFEQUIPAMENTO LIKE @REFEQUIPAMENTO`;
      params.push({ name: 'REFEQUIPAMENTO', value: `%${refequipamento}%` });
    }
    if (cdgrupo) {
      query += ` AND e.CDGRUPOEQUIPAMENTO = @CDGRUPO`;
      params.push({ name: 'CDGRUPO', value: cdgrupo });
    }
    if (cdtipo) {
      query += ` AND e.CDTIPOEQUIPAMENTO = @CDTIPO`;
      params.push({ name: 'CDTIPO', value: cdtipo });
    }
    if (cdmarca) {
      query += ` AND e.CDMARCAEQUIPAMENTO = @CDMARCA`;
      params.push({ name: 'CDMARCA', value: cdmarca });
    }
    if (cdmodelo) {
      query += ` AND e.CDMODELOEQUIPAMENTO = @CDMODELO`;
      params.push({ name: 'CDMODELO', value: cdmodelo });
    }
    if (cdclasse) {
      query += ` AND e.CDCLASSEFROTA = @CDCLASSE`;
      params.push({ name: 'CDCLASSE', value: cdclasse });
    }
    if (fgactive) {
      query += ` AND e.FGACTIVE = @FGACTIVE`;
      params.push({ name: 'FGACTIVE', value: fgactive });
    }
    if (fgtipoatuacao) {
      query += ` AND e.FGTIPOATUACAO = @FGTIPOATUACAO`;
      params.push({ name: 'FGTIPOATUACAO', value: fgtipoatuacao });
    }
    if (fgtipocarroceria) {
      query += ` AND e.FGTIPOCARROCERIA = @FGTIPOCARROCERIA`;
      params.push({ name: 'FGTIPOCARROCERIA', value: fgtipocarroceria });
    }
    if (fgrastreado) {
      query += ` AND e.FGRASTREADO = @FGRASTREADO`;
      params.push({ name: 'FGRASTREADO', value: fgrastreado });
    }

    query += ` ORDER BY e.REFEQUIPAMENTO`;

    const pool = await poolPromise;
    const request = pool.request();

    params.forEach(p => {
      request.input(p.name, p.value);
    });

    const result = await request.query(query);
    const equipamentos = result.recordset.map(e => ({
      IDEQUIPAMENTO: e.IDEQUIPAMENTO,
      REFEQUIPAMENTO: e.REFEQUIPAMENTO,
      DSEQUIPAMENTO: e.DSEQUIPAMENTO,
      CDGRUPOEQUIPAMENTO: e.CDGRUPOEQUIPAMENTO,
      GRUPO_NOME: e.GRUPO_NOME || 'Não informado',
      CDTIPOEQUIPAMENTO: e.CDTIPOEQUIPAMENTO,
      TIPO_NOME: e.TIPO_NOME || 'Não informado',
      CDMARCAEQUIPAMENTO: e.CDMARCAEQUIPAMENTO,
      MARCA_NOME: e.MARCA_NOME || 'Não informada',
      CDMODELOEQUIPAMENTO: e.CDMODELOEQUIPAMENTO,
      MODELO_NOME: e.MODELO_NOME || 'Não informado',
      CDCLASSEFROTA: e.CDCLASSEFROTA,
      CLASSE_NOME: e.CLASSE_NOME || 'Não informada',
      FGACTIVE: e.FGACTIVE === 'A' ? 'S' : 'N',
      FGTIPOATUACAO: e.FGTIPOATUACAO,
      FGTIPOCARROCERIA: e.FGTIPOCARROCERIA,
      NREIXOS: e.NREIXOS,
      CAPACIDCARGA: e.CAPACIDCARGA,
      ANOFABRICA: e.ANOFABRICA,
      ALTURA: e.ALTURA,
      LARGURA: e.LARGURA,
      COMPRIMENTO: e.COMPRIMENTO,
      MTCUBICO: e.MTCUBICO,
      FGRASTREADO: e.FGRASTREADO || 'N'
    }));

    res.json(equipamentos);
  } catch (err) {
    console.error('Erro ao listar equipamentos:', err);
    res.status(500).json({ error: 'Erro ao carregar equipamentos.' });
  }
});

// Rotas específicas devem vir ANTES das rotas com parâmetros
// Rota para tipos de equipamento (combo) - deve vir antes de /equipamentos/:id
router.get('/equipamentos/tipos-combo', createComboRoute('TIPOEQUIPAMENTO', 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO'));

// Buscar equipamento por ID
router.get('/equipamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseFloat(id);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idNum)
      .query(`
        SELECT 
          IDEQUIPAMENTO,
          REFEQUIPAMENTO,
          DSEQUIPAMENTO,
          CDGRUPOEQUIPAMENTO,
          CDTIPOEQUIPAMENTO,
          CDMARCAEQUIPAMENTO,
          CDMODELOEQUIPAMENTO,
          CDCLASSEFROTA,
          FGACTIVE,
          FGTIPOATUACAO,
          FGTIPOCARROCERIA,
          NREIXOS,
          CAPACIDCARGA,
          ANOFABRICA,
          ALTURA,
          LARGURA,
          COMPRIMENTO,
          MTCUBICO,
          FGRASTREADO
        FROM [dbo].[EQUIPAMENTO]
        WHERE IDEQUIPAMENTO = @IDEQUIPAMENTO
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Equipamento não encontrado.' });
    }

    const equipamento = result.recordset[0];
    res.json({
      IDEQUIPAMENTO: equipamento.IDEQUIPAMENTO,
      REFEQUIPAMENTO: equipamento.REFEQUIPAMENTO,
      DSEQUIPAMENTO: equipamento.DSEQUIPAMENTO,
      CDGRUPOEQUIPAMENTO: equipamento.CDGRUPOEQUIPAMENTO,
      CDTIPOEQUIPAMENTO: equipamento.CDTIPOEQUIPAMENTO,
      CDMARCAEQUIPAMENTO: equipamento.CDMARCAEQUIPAMENTO,
      CDMODELOEQUIPAMENTO: equipamento.CDMODELOEQUIPAMENTO,
      CDCLASSEFROTA: equipamento.CDCLASSEFROTA,
      FGACTIVE: equipamento.FGACTIVE === 'A' ? 'S' : 'N',
      FGTIPOATUACAO: equipamento.FGTIPOATUACAO,
      FGTIPOCARROCERIA: equipamento.FGTIPOCARROCERIA,
      NREIXOS: equipamento.NREIXOS,
      CAPACIDCARGA: equipamento.CAPACIDCARGA,
      ANOFABRICA: equipamento.ANOFABRICA,
      ALTURA: equipamento.ALTURA,
      LARGURA: equipamento.LARGURA,
      COMPRIMENTO: equipamento.COMPRIMENTO,
      MTCUBICO: equipamento.MTCUBICO,
      FGRASTREADO: equipamento.FGRASTREADO
    });
  } catch (err) {
    console.error('Erro ao buscar equipamento:', err);
    res.status(500).json({ error: 'Erro ao buscar equipamento.' });
  }
});

// Rotas de combo
router.get('/grupos-combo', createComboRoute('GRUPOEQUIPAMENTO', 'CDGRUPOEQUIPAMENTO', 'DSGRUPOEQUIPAMENTO'));
router.get('/tipos-combo', createComboRoute('TIPOEQUIPAMENTO', 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO'));
router.get('/marcas-combo', createComboRoute('MARCAEQUIPAMENTO', 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO'));
router.get('/classes-combo', createComboRoute('CLASSEFROTA', 'CDCLASSEFROTA', 'DSCLASSEFROTA'));

// Modelos por tipo
router.get('/modelos-por-tipo/:tipoId', async (req, res) => {
  try {
    const { tipoId } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDTIPOEQUIPAMENTO', tipoId)
      .query(`
        SELECT CDMODELOEQUIPAMENTO, DSMODELOEQUIPAMENTO
        FROM [dbo].[MODELOEQUIPAMENTO]
        WHERE CDTIPOEQUIPAMENTO = @CDTIPOEQUIPAMENTO
        ORDER BY DSMODELOEQUIPAMENTO
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao carregar modelos por tipo:', err);
    res.status(500).json({ error: 'Erro ao carregar modelos.' });
  }
});

// Modelos por marca
router.get('/modelos-por-marca/:marcaId', async (req, res) => {
  try {
    const { marcaId } = req.params;
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDMARCAEQUIPAMENTO', marcaId)
      .query(`
        SELECT CDMODELOEQUIPAMENTO, DSMODELOEQUIPAMENTO
        FROM [dbo].[MODELOEQUIPAMENTO]
        WHERE CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO
        ORDER BY DSMODELOEQUIPAMENTO
      `);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao carregar modelos por marca:', err);
    res.status(500).json({ error: 'Erro ao carregar modelos.' });
  }
});

// Inserir equipamento
router.post('/equipamentos', async (req, res) => {
  try {
    const {
      REFEQUIPAMENTO, DSEQUIPAMENTO, CDGRUPOEQUIPAMENTO, CDTIPOEQUIPAMENTO,
      CDMARCAEQUIPAMENTO, CDMODELOEQUIPAMENTO, CDCLASSEFROTA, FGTIPOATUACAO,
      FGTIPOCARROCERIA, NREIXOS, CAPACIDCARGA, ANOFABRICA, ALTURA, LARGURA, COMPRIMENTO, MTCUBICO, FGRASTREADO
    } = req.body;

    if (!REFEQUIPAMENTO?.trim()) {
      return res.status(400).json({ error: 'Referência é obrigatória.' });
    }

    const pool = await poolPromise;
    const maxResult = await pool
      .request()
      .query('SELECT ISNULL(MAX(IDEQUIPAMENTO), 0) AS maxId FROM [dbo].[EQUIPAMENTO]');
    const novoId = maxResult.recordset[0].maxId + 1;

    await pool
      .request()
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), novoId)
      .input('REFEQUIPAMENTO', REFEQUIPAMENTO.trim())
      .input('DSEQUIPAMENTO', DSEQUIPAMENTO?.trim() || null)
      .input('CDGRUPOEQUIPAMENTO', CDGRUPOEQUIPAMENTO || null)
      .input('CDTIPOEQUIPAMENTO', CDTIPOEQUIPAMENTO)
      .input('CDMARCAEQUIPAMENTO', CDMARCAEQUIPAMENTO)
      .input('CDMODELOEQUIPAMENTO', CDMODELOEQUIPAMENTO || null)
      .input('CDCLASSEFROTA', CDCLASSEFROTA || null)
      .input('FGTIPOATUACAO', FGTIPOATUACAO)
      .input('FGTIPOCARROCERIA', FGTIPOCARROCERIA)
      .input('NREIXOS', NREIXOS || null)
      .input('CAPACIDCARGA', CAPACIDCARGA || null)
      .input('ANOFABRICA', ANOFABRICA || null)
      .input('ALTURA', ALTURA || null)
      .input('LARGURA', LARGURA || null)
      .input('COMPRIMENTO', COMPRIMENTO || null)
      .input('MTCUBICO', MTCUBICO || null)
      .input('FGRASTREADO', FGRASTREADO || 'N')
      .query(`
        INSERT INTO [dbo].[EQUIPAMENTO] (
          IDEQUIPAMENTO, REFEQUIPAMENTO, DSEQUIPAMENTO, CDGRUPOEQUIPAMENTO,
          CDTIPOEQUIPAMENTO, CDMARCAEQUIPAMENTO, CDMODELOEQUIPAMENTO, CDCLASSEFROTA,
          FGTIPOATUACAO, FGTIPOCARROCERIA, NREIXOS, CAPACIDCARGA, ANOFABRICA,
          ALTURA, LARGURA, COMPRIMENTO, MTCUBICO, FGRASTREADO, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @IDEQUIPAMENTO, @REFEQUIPAMENTO, @DSEQUIPAMENTO, @CDGRUPOEQUIPAMENTO,
          @CDTIPOEQUIPAMENTO, @CDMARCAEQUIPAMENTO, @CDMODELOEQUIPAMENTO, @CDCLASSEFROTA,
          @FGTIPOATUACAO, @FGTIPOCARROCERIA, @NREIXOS, @CAPACIDCARGA, @ANOFABRICA,
          @ALTURA, @LARGURA, @COMPRIMENTO, @MTCUBICO, @FGRASTREADO, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);

    res.status(201).json({ success: true, message: 'Equipamento cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir equipamento:', err);
    res.status(500).json({ error: 'Erro ao cadastrar equipamento.' });
  }
});

// Atualizar equipamento
router.put('/equipamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      REFEQUIPAMENTO, DSEQUIPAMENTO, CDGRUPOEQUIPAMENTO, CDTIPOEQUIPAMENTO,
      CDMARCAEQUIPAMENTO, CDMODELOEQUIPAMENTO, CDCLASSEFROTA, FGACTIVE,
      FGTIPOATUACAO, FGTIPOCARROCERIA, NREIXOS, CAPACIDCARGA, ANOFABRICA, ALTURA, LARGURA, COMPRIMENTO, MTCUBICO, FGRASTREADO
    } = req.body;

    if (!REFEQUIPAMENTO?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const idNumerico = parseFloat(id);
    
    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID do equipamento inválido.' });
    }

    await pool
      .request()
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idNumerico)
      .input('REFEQUIPAMENTO', REFEQUIPAMENTO.trim())
      .input('DSEQUIPAMENTO', DSEQUIPAMENTO?.trim() || null)
      .input('CDGRUPOEQUIPAMENTO', CDGRUPOEQUIPAMENTO || null)
      .input('CDTIPOEQUIPAMENTO', CDTIPOEQUIPAMENTO)
      .input('CDMARCAEQUIPAMENTO', CDMARCAEQUIPAMENTO)
      .input('CDMODELOEQUIPAMENTO', CDMODELOEQUIPAMENTO || null)
      .input('CDCLASSEFROTA', CDCLASSEFROTA || null)
      .input('FGTIPOATUACAO', FGTIPOATUACAO)
      .input('FGTIPOCARROCERIA', FGTIPOCARROCERIA)
      .input('NREIXOS', NREIXOS || null)
      .input('CAPACIDCARGA', CAPACIDCARGA || null)
      .input('ANOFABRICA', ANOFABRICA || null)
      .input('ALTURA', ALTURA || null)
      .input('LARGURA', LARGURA || null)
      .input('COMPRIMENTO', COMPRIMENTO || null)
      .input('MTCUBICO', MTCUBICO || null)
      .input('FGACTIVE', fgactiveDB)
      .input('FGRASTREADO', FGRASTREADO || 'N')
      .query(`
        UPDATE [dbo].[EQUIPAMENTO]
        SET 
          REFEQUIPAMENTO = @REFEQUIPAMENTO,
          DSEQUIPAMENTO = @DSEQUIPAMENTO,
          CDGRUPOEQUIPAMENTO = @CDGRUPOEQUIPAMENTO,
          CDTIPOEQUIPAMENTO = @CDTIPOEQUIPAMENTO,
          CDMARCAEQUIPAMENTO = @CDMARCAEQUIPAMENTO,
          CDMODELOEQUIPAMENTO = @CDMODELOEQUIPAMENTO,
          CDCLASSEFROTA = @CDCLASSEFROTA,
          FGTIPOATUACAO = @FGTIPOATUACAO,
          FGTIPOCARROCERIA = @FGTIPOCARROCERIA,
          NREIXOS = @NREIXOS,
          CAPACIDCARGA = @CAPACIDCARGA,
          ANOFABRICA = @ANOFABRICA,
          ALTURA = @ALTURA,
          LARGURA = @LARGURA,
          COMPRIMENTO = @COMPRIMENTO,
          MTCUBICO = @MTCUBICO,
          FGACTIVE = @FGACTIVE,
          FGRASTREADO = @FGRASTREADO,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE IDEQUIPAMENTO = @IDEQUIPAMENTO
      `);

    res.json({ success: true, message: 'Equipamento atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar equipamento:', err);
    res.status(500).json({ error: 'Erro ao atualizar equipamento.' });
  }
});

// Inativar/Reativar equipamento (exclusão lógica)
router.delete('/equipamentos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    const idNumerico = parseFloat(id);
    
    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID do equipamento inválido.' });
    }

    const pool = await poolPromise;
    
    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idNumerico)
      .query(`SELECT FGACTIVE FROM [dbo].[EQUIPAMENTO] WHERE IDEQUIPAMENTO = @IDEQUIPAMENTO`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Equipamento não encontrado.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Equipamento reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Equipamento desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Equipamento desativado com sucesso!' : 'Equipamento reativado com sucesso!';
    }

    const result = await pool
      .request()
      .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[EQUIPAMENTO]
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE IDEQUIPAMENTO = @IDEQUIPAMENTO
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Equipamento não encontrado.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do equipamento:', err);
    res.status(500).json({ error: 'Erro ao alterar status do equipamento.' });
  }
});

// Executar init.sql do módulo Gerenciar Equipamentos
router.post('/equipamentos/executar-init-sql', async (req, res) => {
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