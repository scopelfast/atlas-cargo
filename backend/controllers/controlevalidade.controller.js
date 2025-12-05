// Controller para Controle de Validades
const sql = require('mssql');
const { poolPromise } = require('../config/db');

const controleValidadeController = {
  // Listar validades de um cadastro (TODOS os tipos)
  listarPorCadastro: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro } = req.params;
      
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .query(`
          SELECT 
            CV.TPCADASTRO,
            CV.CDCADASTRO,
            CV.SEQUENCIA,
            CV.CDTIPOVALIDADE,
            TV.DSTIPOVALIDADE,
            CV.NRLIBERACAO,
            CV.DTLIBERACAO,
            CV.DTVALIDADE,
            CV.CDCERTIFICADORA,
            CERT.RZSOCIAL AS CERTIFICADORA_NOME,
            CV.DSLIBERACAO,
            CV.FGTIPOLANCTO,
            DATEDIFF(DAY, GETDATE(), CV.DTVALIDADE) AS DIAS_RESTANTES,
            CASE 
              WHEN CV.DTVALIDADE < GETDATE() THEN 'VENCIDA'
              WHEN DATEDIFF(DAY, GETDATE(), CV.DTVALIDADE) <= 30 THEN 'VENCENDO'
              ELSE 'OK'
            END AS STATUS_VALIDADE
          FROM CONTROLEVALIDADE CV
          INNER JOIN TIPOVALIDADE TV ON CV.CDTIPOVALIDADE = TV.CDTIPOVALIDADE
          LEFT JOIN CADASTROGERAL CERT ON CV.CDCERTIFICADORA = CERT.CDCADASTRO
          WHERE CV.CDCADASTRO = @CDCADASTRO
          ORDER BY CV.DTVALIDADE DESC, CV.TPCADASTRO, CV.SEQUENCIA DESC
        `);
      
      res.json(result.recordset);
    } catch (err) {
      console.error('[ERRO] Listar validades:', err);
      res.status(500).json({ error: 'Erro ao listar validades' });
    }
  },

  // Criar validade
  criar: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro } = req.params;
      const { CDTIPOVALIDADE, NRLIBERACAO, DTLIBERACAO, DTVALIDADE, CDCERTIFICADORA, DSLIBERACAO } = req.body;
      
      if (!CDTIPOVALIDADE || !NRLIBERACAO || !DTLIBERACAO || !DTVALIDADE) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos' });
      }
      
      const pool = await poolPromise;
      
      // Gerar próxima sequência
      const seqResult = await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .query(`
          SELECT ISNULL(MAX(SEQUENCIA), 0) + 1 AS NOVASEQUENCIA 
          FROM CONTROLEVALIDADE 
          WHERE TPCADASTRO = @TPCADASTRO AND CDCADASTRO = @CDCADASTRO
        `);
      
      const novaSeq = seqResult.recordset[0].NOVASEQUENCIA;
      
      // Inserir
      await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .input('SEQUENCIA', sql.SmallInt, novaSeq)
        .input('CDTIPOVALIDADE', sql.SmallInt, parseInt(CDTIPOVALIDADE))
        .input('NRLIBERACAO', sql.VarChar(30), NRLIBERACAO)
        .input('DTLIBERACAO', sql.DateTime, new Date(DTLIBERACAO))
        .input('DTVALIDADE', sql.DateTime, new Date(DTVALIDADE))
        .input('CDCERTIFICADORA', sql.Decimal(15, 0), CDCERTIFICADORA ? parseFloat(CDCERTIFICADORA) : null)
        .input('DSLIBERACAO', sql.VarChar(256), DSLIBERACAO || null)
        .input('FGTIPOLANCTO', sql.Char(1), 'M')
        .query(`
          INSERT INTO CONTROLEVALIDADE (
            TPCADASTRO, CDCADASTRO, SEQUENCIA, CDTIPOVALIDADE, NRLIBERACAO,
            DTLIBERACAO, DTVALIDADE, CDCERTIFICADORA, DSLIBERACAO, FGTIPOLANCTO,
            DHMAINTENANCE, SGUSER, SERVERORIG
          ) VALUES (
            @TPCADASTRO, @CDCADASTRO, @SEQUENCIA, @CDTIPOVALIDADE, @NRLIBERACAO,
            @DTLIBERACAO, @DTVALIDADE, @CDCERTIFICADORA, @DSLIBERACAO, @FGTIPOLANCTO,
            GETDATE(), 'SYSTEM', 'AppDVcargas'
          )
        `);
      
      res.status(201).json({ success: true, message: 'Validade cadastrada com sucesso!', sequencia: novaSeq });
    } catch (err) {
      console.error('[ERRO] Criar validade:', err);
      res.status(500).json({ error: 'Erro ao cadastrar validade' });
    }
  },

  // Atualizar validade
  atualizar: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro, sequencia } = req.params;
      const { CDTIPOVALIDADE, NRLIBERACAO, DTLIBERACAO, DTVALIDADE, CDCERTIFICADORA, DSLIBERACAO } = req.body;
      
      const pool = await poolPromise;
      
      await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .input('SEQUENCIA', sql.SmallInt, parseInt(sequencia))
        .input('CDTIPOVALIDADE', sql.SmallInt, parseInt(CDTIPOVALIDADE))
        .input('NRLIBERACAO', sql.VarChar(30), NRLIBERACAO)
        .input('DTLIBERACAO', sql.DateTime, new Date(DTLIBERACAO))
        .input('DTVALIDADE', sql.DateTime, new Date(DTVALIDADE))
        .input('CDCERTIFICADORA', sql.Decimal(15, 0), CDCERTIFICADORA ? parseFloat(CDCERTIFICADORA) : null)
        .input('DSLIBERACAO', sql.VarChar(256), DSLIBERACAO || null)
        .query(`
          UPDATE CONTROLEVALIDADE SET
            CDTIPOVALIDADE = @CDTIPOVALIDADE,
            NRLIBERACAO = @NRLIBERACAO,
            DTLIBERACAO = @DTLIBERACAO,
            DTVALIDADE = @DTVALIDADE,
            CDCERTIFICADORA = @CDCERTIFICADORA,
            DSLIBERACAO = @DSLIBERACAO,
            DHMAINTENANCE = GETDATE(),
            SGUSER = 'SYSTEM'
          WHERE TPCADASTRO = @TPCADASTRO
            AND CDCADASTRO = @CDCADASTRO
            AND SEQUENCIA = @SEQUENCIA
        `);
      
      res.json({ success: true, message: 'Validade atualizada com sucesso!' });
    } catch (err) {
      console.error('[ERRO] Atualizar validade:', err);
      res.status(500).json({ error: 'Erro ao atualizar validade' });
    }
  },

  // Excluir validade
  excluir: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro, sequencia } = req.params;
      
      const pool = await poolPromise;
      
      await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .input('SEQUENCIA', sql.SmallInt, parseInt(sequencia))
        .query(`
          DELETE FROM CONTROLEVALIDADE
          WHERE TPCADASTRO = @TPCADASTRO
            AND CDCADASTRO = @CDCADASTRO
            AND SEQUENCIA = @SEQUENCIA
        `);
      
      res.json({ success: true, message: 'Validade excluída com sucesso!' });
    } catch (err) {
      console.error('[ERRO] Excluir validade:', err);
      res.status(500).json({ error: 'Erro ao excluir validade' });
    }
  },

  // Listar tipos de validade para combo (filtrado por tipo de cadastro)
  listarTiposParaCombo: async (req, res) => {
    try {
      const { tpCadastro } = req.params;
      
      const pool = await poolPromise;
      let query = 'SELECT CDTIPOVALIDADE, DSTIPOVALIDADE, FGEXIGECERTIFICADORA FROM TIPOVALIDADE WHERE 1=1';
      
      // Filtrar por tipo de cadastro
      if (tpCadastro === 'MOT') query += ` AND FGMOTORISTA = 'S'`;
      else if (tpCadastro === 'EQP') query += ` AND FGVEICULO = 'S'`;
      else if (tpCadastro === 'CLI') query += ` AND FGCLIENTE = 'S'`;
      else if (tpCadastro === 'TRA') query += ` AND FGTRANSPORTADOR = 'S'`;
      
      query += ' ORDER BY DSTIPOVALIDADE';
      
      const result = await pool.request().query(query);
      res.json(result.recordset);
    } catch (err) {
      console.error('[ERRO] Listar tipos validade:', err);
      res.status(500).json({ error: 'Erro ao listar tipos' });
    }
  },

  // Buscar certificadoras para combo
  listarCertificadorasCombo: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT CDCADASTRO, RZSOCIAL, FGTIPOCADASTRO
        FROM CADASTROGERAL
        WHERE FGTIPOCADASTRO IN ('C', 'F', 'U', 'T', 'E')
          AND FGACTIVE = 'A'
        ORDER BY RZSOCIAL
      `);
      
      console.log('[CERTIFICADORAS] Encontradas:', result.recordset.length);
      res.json(result.recordset);
    } catch (err) {
      console.error('[ERRO] Listar certificadoras:', err);
      res.status(500).json({ error: 'Erro ao listar certificadoras' });
    }
  }
};

module.exports = controleValidadeController;

