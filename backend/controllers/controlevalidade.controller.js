// Controller para Controle de Validades
const sql = require('../config/mssql-compat');
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { getSgUser } = require('../utils/audit');

const controleValidadeController = {
  // Listar validades de um cadastro (TODOS os tipos)
  listarPorCadastro: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro } = req.params;
      
      const pool = await poolPromise;
      // Query em PostgreSQL nativo (aliases em minúsculo para evitar erro "faltando entrada para tabela CV")
      const result = await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .query(`
          SELECT 
            cv."TPCADASTRO",
            cv."CDCADASTRO",
            cv."SEQUENCIA",
            cv."CDTIPOVALIDADE",
            tv."DSTIPOVALIDADE",
            cv."NRLIBERACAO",
            cv."DTLIBERACAO",
            cv."DTVALIDADE",
            cv."CDCERTIFICADORA",
            cert."RZSOCIAL" AS "CERTIFICADORA_NOME",
            cv."DSLIBERACAO",
            cv."FGTIPOLANCTO",
            cv."FGATIVO",
            cv."SGUSER" AS "SGUSER_LIBERACAO",
            cv."SGUSER_REMOVIDO",
            cv."DHREMOVIDO",
            ((cv."DTVALIDADE")::date - CURRENT_DATE) AS "DIAS_RESTANTES",
            CASE 
              WHEN cv."DTVALIDADE" < CURRENT_TIMESTAMP THEN 'VENCIDA'
              WHEN ((cv."DTVALIDADE")::date - CURRENT_DATE) <= 30 THEN 'VENCENDO'
              ELSE 'OK'
            END AS "STATUS_VALIDADE"
          FROM "CONTROLEVALIDADE" cv
          INNER JOIN "TIPOVALIDADE" tv ON cv."CDTIPOVALIDADE" = tv."CDTIPOVALIDADE"
          LEFT JOIN "CADASTROGERAL" cert ON cv."CDCERTIFICADORA" = cert."CDCADASTRO"
          WHERE cv."TPCADASTRO" = @TPCADASTRO AND cv."CDCADASTRO" = @CDCADASTRO
          ORDER BY cv."FGATIVO" DESC NULLS FIRST, cv."DTVALIDADE" DESC, cv."TPCADASTRO", cv."SEQUENCIA" DESC
        `);
      
      const rows = result.recordset || [];
      // Deduplicar: mesmo tipo, número, datas e certificadora = mesma validade (evita duplicados no modal "Validades do Motorista")
      const list = Array.isArray(rows) ? rows : [];
      const seen = new Map();
      for (const row of list) {
        const dtLib = row.DTLIBERACAO && (typeof row.DTLIBERACAO.toISOString === 'function') ? row.DTLIBERACAO.toISOString() : String(row.DTLIBERACAO);
        const dtVal = row.DTVALIDADE && (typeof row.DTVALIDADE.toISOString === 'function') ? row.DTVALIDADE.toISOString() : String(row.DTVALIDADE);
        const key = `${row.CDTIPOVALIDADE}|${row.NRLIBERACAO}|${dtLib}|${dtVal}|${row.CDCERTIFICADORA ?? ''}`;
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, row);
          continue;
        }
        const rowAtivo = row.FGATIVO === 'S' || row.FGATIVO === true;
        const existingAtivo = existing.FGATIVO === 'S' || existing.FGATIVO === true;
        if (rowAtivo && !existingAtivo) {
          seen.set(key, row);
        } else if (!rowAtivo && existingAtivo) {
          // manter existing
        } else if (Number(row.SEQUENCIA) > Number(existing.SEQUENCIA)) {
          seen.set(key, row);
        }
      }
      res.json(Array.from(seen.values()));
    } catch (err) {
      console.error('[ERRO] Listar validades:', err);
      res.status(500).json({ error: 'Erro ao listar validades', detail: err.message });
    }
  },

  // Criar validade
  criar: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro } = req.params;
      const { CDTIPOVALIDADE, NRLIBERACAO, DTLIBERACAO, DTVALIDADE, CDCERTIFICADORA, DSLIBERACAO, SGUSER: bodySGUSER } = req.body;
      const sgUserLiberacao = bodySGUSER || getSgUser(req);
      if (!sgUserLiberacao) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

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
          SELECT COALESCE(MAX([SEQUENCIA]), 0) + 1 AS [NOVASEQUENCIA]
          FROM [dbo].[CONTROLEVALIDADE]
          WHERE [TPCADASTRO] = @TPCADASTRO AND [CDCADASTRO] = @CDCADASTRO
        `);
      
      const novaSeq = getFirstNumericValue(seqResult.recordset, 1);
      
      // Inserir (FGATIVO S = ativa; SGUSER = quem liberou — histórico para seguro)
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
        .input('SGUSER', sql.VarChar(50), sgUserLiberacao)
        .query(`
          INSERT INTO "CONTROLEVALIDADE" (
            "TPCADASTRO", "CDCADASTRO", "SEQUENCIA", "CDTIPOVALIDADE", "NRLIBERACAO",
            "DTLIBERACAO", "DTVALIDADE", "CDCERTIFICADORA", "DSLIBERACAO", "FGTIPOLANCTO",
            "FGATIVO", "DHMAINTENANCE", "SGUSER"
          ) VALUES (
            @TPCADASTRO, @CDCADASTRO, @SEQUENCIA, @CDTIPOVALIDADE, @NRLIBERACAO,
            @DTLIBERACAO, @DTVALIDADE, @CDCERTIFICADORA, @DSLIBERACAO, @FGTIPOLANCTO,
            'S', CURRENT_TIMESTAMP, @SGUSER
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

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

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
        .input('sgUser', sql.VarChar(50), sgUser)
        .query(`
          UPDATE [dbo].[CONTROLEVALIDADE] SET
            [CDTIPOVALIDADE] = @CDTIPOVALIDADE,
            [NRLIBERACAO] = @NRLIBERACAO,
            [DTLIBERACAO] = @DTLIBERACAO,
            [DTVALIDADE] = @DTVALIDADE,
            [CDCERTIFICADORA] = @CDCERTIFICADORA,
            [DSLIBERACAO] = @DSLIBERACAO,
            [DHMAINTENANCE] = GETDATE(),
            [SGUSER] = @sgUser
          WHERE [TPCADASTRO] = @TPCADASTRO
            AND [CDCADASTRO] = @CDCADASTRO
            AND [SEQUENCIA] = @SEQUENCIA
        `);
      
      res.json({ success: true, message: 'Validade atualizada com sucesso!' });
    } catch (err) {
      console.error('[ERRO] Atualizar validade:', err);
      res.status(500).json({ error: 'Erro ao atualizar validade' });
    }
  },

  // Desativar validade (soft delete — não excluir; histórico para seguro)
  excluir: async (req, res) => {
    try {
      const { tpCadastro, cdCadastro, sequencia } = req.params;
      const usuario = (req.body && req.body.usuario) || getSgUser(req);
      if (!usuario) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;

      await pool
        .request()
        .input('TPCADASTRO', sql.VarChar, tpCadastro)
        .input('CDCADASTRO', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .input('SEQUENCIA', sql.SmallInt, parseInt(sequencia))
        .input('SGUSER_REMOVIDO', sql.VarChar(50), usuario)
        .query(`
          UPDATE "CONTROLEVALIDADE" SET
            "FGATIVO" = 'N',
            "SGUSER_REMOVIDO" = @SGUSER_REMOVIDO,
            "DHREMOVIDO" = CURRENT_TIMESTAMP
          WHERE "TPCADASTRO" = @TPCADASTRO
            AND "CDCADASTRO" = @CDCADASTRO
            AND "SEQUENCIA" = @SEQUENCIA
        `);

      res.json({ success: true, message: 'Validade desativada. Registro mantido para histórico.' });
    } catch (err) {
      console.error('[ERRO] Desativar validade:', err);
      res.status(500).json({ error: 'Erro ao desativar validade' });
    }
  },

  // Listar tipos de validade para combo (filtrado por tipo de cadastro)
  listarTiposParaCombo: async (req, res) => {
    try {
      const { tpCadastro } = req.params;
      
      const pool = await poolPromise;
      let query = 'SELECT [CDTIPOVALIDADE], [DSTIPOVALIDADE], [FGEXIGECERTIFICADORA] FROM [dbo].[TIPOVALIDADE] WHERE 1=1';
      
      // Filtrar por tipo de cadastro
      if (tpCadastro === 'MOT') query += ` AND [FGMOTORISTA] = 'S'`;
      else if (tpCadastro === 'EQP') query += ` AND [FGVEICULO] = 'S'`;
      else if (tpCadastro === 'CLI') query += ` AND [FGCLIENTE] = 'S'`;
      else if (tpCadastro === 'TRA') query += ` AND [FGTRANSPORTADOR] = 'S'`;
      
      query += ' ORDER BY [DSTIPOVALIDADE]';
      
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
        SELECT "CDCADASTRO", "RZSOCIAL", "FGTIPOCADASTRO"
        FROM "CADASTROGERAL"
        WHERE ("FGCERTIFICADORA" = 'S' OR ("FGCERTIFICADORA" IS NULL AND "FGTIPOCADASTRO" IN ('C', 'F', 'U', 'T', 'E')))
          AND "FGACTIVE" = 'A'
        ORDER BY "RZSOCIAL"
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

