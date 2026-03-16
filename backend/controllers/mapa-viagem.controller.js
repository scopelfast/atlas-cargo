// backend/controllers/mapa-viagem.controller.js
const { poolPromise } = require('../config/db');
const fs = require('fs').promises;
const path = require('path');

// Nome da tabela de rastreamento: preferir VIAGEMRASTREAMENTO (onde estão os dados);
// VIAGEM_RASTREAMENTO costuma estar vazia.
async function detectarTabelaRastreamento(pool) {
  const candidatas = [];
  for (const name of ['viagemrastreamento', 'viagem_rastreamento']) {
    try {
      const r = await pool.query(`
        SELECT schemaname, tablename
        FROM pg_tables
        WHERE schemaname IN ('dbo', 'public') AND LOWER(tablename) = $1
        LIMIT 1
      `, [name]);
      const row = r.rows && r.rows[0];
      if (row) {
        const t = (row.tablename || row.TABLENAME || '').trim();
        const schema = (row.schemaname || row.SCHEMANAME || 'public').trim();
        if (t) candidatas.push({ schema, tablename: t });
      }
    } catch (e) {
      // ignore
    }
  }
  if (candidatas.length === 0) return 'VIAGEMRASTREAMENTO';
  // Se ambas existem, preferir a que tem registros (geralmente VIAGEMRASTREAMENTO)
  for (const { schema, tablename } of candidatas) {
    try {
      const count = await pool.query(
        `SELECT 1 FROM "${schema}"."${tablename}" LIMIT 1`
      );
      if (count.rows && count.rows.length > 0) return tablename;
    } catch (e) {
      // ignore
    }
  }
  return candidatas[0].tablename;
}

const mapaViagemController = {
  // Listar veículos para o mapa (última posição de cada placa)
  listarVeiculos: async (req, res) => {
    try {
      const {
        idViagem, situacaoViagem, tipoViagem, classeFrota, contratador,
        origemEstado, origemCidade, destinoEstado, destinoCidade,
        roteiro, dataInicio, dataFim, rastreado, motoristaConfirmado
      } = req.query;

      const pool = await poolPromise;
      const rastreamentoTable = await detectarTabelaRastreamento(pool);

      // Incluir viagens planejadas (1) até encerradas (14): >= 1 e < 15 para mostrar mais veículos
      const queryBase = `
        WITH [UltimaPosicao] AS (
          SELECT 
            [RV].[IDVIAGEM] AS [VIAGEM],
            [RV].[LATITUDE],
            [RV].[LONGITUDE],
            COALESCE([RV].[DSPOSICAO], '') AS [DSPOSICAO],
            COALESCE([RV].[DHPOSICAO], [RV].[DHREGISTRO]) AS [DHPOSICAO],
            [NM].[RZSOCIAL] AS [NMMOTORISTA],
            [E].[REFEQUIPAMENTO] AS [PLACA],
            [R].[DSROTEIRO],
            [co].[ESTADO] AS [ORIGEM_ESTADO],
            [co].[NMCIDADE] AS [ORIGEM_CIDADE],
            [co].[CDUF] AS [ORIGEM_CDUF],
            [cd].[ESTADO] AS [DESTINO_ESTADO],
            [cd].[NMCIDADE] AS [DESTINO_CIDADE],
            [cd].[CDUF] AS [DESTINO_CDUF],
            ROW_NUMBER() OVER (
              PARTITION BY [RV].[IDVIAGEM]
              ORDER BY COALESCE([RV].[SEQUENCIA], 0) DESC, COALESCE([RV].[DHPOSICAO], [RV].[DHREGISTRO]) DESC
            ) AS [RN]
          FROM [dbo].[${rastreamentoTable}] [RV]
          INNER JOIN [dbo].[VIAGEMMESTRE] [VM] ON [RV].[IDVIAGEM] = [VM].[IDVIAGEM]
          LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] [co] ON [R].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [R].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[VIAGEMMOTORISTA] [M] ON [RV].[IDVIAGEM] = [M].[IDVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] [NM] ON [M].[CDMOTORISTA] = [NM].[CDCADASTRO]
          LEFT JOIN [dbo].[VIAGEMVEICULO] [V] ON [RV].[IDVIAGEM] = [V].[IDVIAGEM]
          LEFT JOIN [dbo].[EQUIPAMENTO] [E] ON [V].[IDEQUIPAMENTO] = [E].[IDEQUIPAMENTO]
          WHERE [VM].[CDSITUACAOVIAGEM] >= 1
            AND [VM].[CDSITUACAOVIAGEM] < 15
            AND [RV].[LATITUDE] IS NOT NULL
            AND [RV].[LONGITUDE] IS NOT NULL
      `;
      let query = queryBase;

      const request = pool.request();

      // Aplicar filtros
      if (idViagem) {
        query += ` AND [VM].[IDVIAGEM] = @IDVIAGEM`;
        request.input('IDVIAGEM', parseInt(idViagem));
      }
      if (situacaoViagem) {
        query += ` AND [VM].[FGSITVIAGEM] = @SITUACAOVIAGEM`;
        request.input('SITUACAOVIAGEM', situacaoViagem);
      }
      if (tipoViagem) {
        query += ` AND [VM].[CDTIPOVIAGEM] = @TIPOVIAGEM`;
        request.input('TIPOVIAGEM', parseInt(tipoViagem));
      }
      if (classeFrota) {
        query += ` AND [VM].[CDCLASSEFROTA] = @CLASSEFROTA`;
        request.input('CLASSEFROTA', parseInt(classeFrota));
      }
      if (contratador) {
        query += ` AND [VM].[CDCONTRATADOR] = @CONTRATADOR`;
        request.input('CONTRATADOR', parseInt(contratador));
      }
      if (roteiro) {
        query += ` AND [VM].[IDROTEIRO] = @ROTEIRO`;
        request.input('ROTEIRO', parseInt(roteiro));
      }
      if (dataInicio) {
        query += ` AND [VM].[DTPREVINICIO] >= @DATAINICIO`;
        request.input('DATAINICIO', dataInicio);
      }
      if (dataFim) {
        query += ` AND [VM].[DTPREVFINAL] <= @DATAFIM`;
        request.input('DATAFIM', dataFim);
      }
      if (rastreado) {
        if (rastreado === 'S') {
          query += ` AND [E].[FGRASTREADO] = 'S'`;
        } else if (rastreado === 'N') {
          query += ` AND ([E].[FGRASTREADO] IS NULL OR [E].[FGRASTREADO] = 'N')`;
        }
      }
      if (motoristaConfirmado === 'S') {
        query += ` AND EXISTS (
          SELECT 1 FROM [dbo].[CONVOCACAO] [C]
          WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM]
          AND [C].[STATUS] = 'CONFIRMADA'
        )`;
      } else if (motoristaConfirmado === 'N') {
        query += ` AND NOT EXISTS (
          SELECT 1 FROM [dbo].[CONVOCACAO] [C]
          WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM]
          AND [C].[STATUS] = 'CONFIRMADA'
        )`;
      }

      if (origemEstado) {
        query += ` AND [co].[CDUF] = @ORIGEMESTADO`;
        request.input('ORIGEMESTADO', parseInt(origemEstado));
      }
      if (origemCidade) {
        query += ` AND [co].[NMCIDADE] LIKE @ORIGEMCIDADE`;
        request.input('ORIGEMCIDADE', `%${origemCidade}%`);
      }
      if (destinoEstado) {
        query += ` AND [cd].[CDUF] = @DESTINOESTADO`;
        request.input('DESTINOESTADO', parseInt(destinoEstado));
      }
      if (destinoCidade) {
        query += ` AND [cd].[NMCIDADE] LIKE @DESTINOCIDADE`;
        request.input('DESTINOCIDADE', `%${destinoCidade}%`);
      }

      query += `
        )
        SELECT 
          [VIAGEM],
          [LATITUDE],
          [LONGITUDE],
          [DSPOSICAO],
          [DHPOSICAO],
          [NMMOTORISTA],
          [PLACA],
          [DSROTEIRO]
        FROM [UltimaPosicao]
        WHERE [RN] = 1
        ORDER BY [PLACA], [DHPOSICAO] DESC
      `;

      let result;
      try {
        result = await request.query(query);
      } catch (err) {
        const colMissing = (err.code === '42703' || (err.message && err.message.includes('column')));
        if (colMissing && rastreamentoTable) {
          console.log('[Mapa Viagem] Query com DHPOSICAO/SEQUENCIA falhou, tentando apenas DHREGISTRO.');
          const req2 = pool.request();
          let fallbackFilters = '';
          if (idViagem) {
            fallbackFilters += ` AND [VM].[IDVIAGEM] = @IDVIAGEM`;
            req2.input('IDVIAGEM', parseInt(idViagem));
          }
          if (situacaoViagem) {
            fallbackFilters += ` AND [VM].[FGSITVIAGEM] = @SITUACAOVIAGEM`;
            req2.input('SITUACAOVIAGEM', situacaoViagem);
          }
          if (tipoViagem) {
            fallbackFilters += ` AND [VM].[CDTIPOVIAGEM] = @TIPOVIAGEM`;
            req2.input('TIPOVIAGEM', parseInt(tipoViagem));
          }
          if (classeFrota) {
            fallbackFilters += ` AND [VM].[CDCLASSEFROTA] = @CLASSEFROTA`;
            req2.input('CLASSEFROTA', parseInt(classeFrota));
          }
          if (contratador) {
            fallbackFilters += ` AND [VM].[CDCONTRATADOR] = @CONTRATADOR`;
            req2.input('CONTRATADOR', parseInt(contratador));
          }
          if (roteiro) {
            fallbackFilters += ` AND [VM].[IDROTEIRO] = @ROTEIRO`;
            req2.input('ROTEIRO', parseInt(roteiro));
          }
          if (dataInicio) {
            fallbackFilters += ` AND [VM].[DTPREVINICIO] >= @DATAINICIO`;
            req2.input('DATAINICIO', dataInicio);
          }
          if (dataFim) {
            fallbackFilters += ` AND [VM].[DTPREVFINAL] <= @DATAFIM`;
            req2.input('DATAFIM', dataFim);
          }
          if (rastreado === 'S') {
            fallbackFilters += ` AND [E].[FGRASTREADO] = 'S'`;
          } else if (rastreado === 'N') {
            fallbackFilters += ` AND ([E].[FGRASTREADO] IS NULL OR [E].[FGRASTREADO] = 'N')`;
          }
          if (motoristaConfirmado === 'S') {
            fallbackFilters += ` AND EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] [C] WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM] AND [C].[STATUS] = 'CONFIRMADA')`;
          } else if (motoristaConfirmado === 'N') {
            fallbackFilters += ` AND NOT EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] [C] WHERE [C].[IDVIAGEM] = [VM].[IDVIAGEM] AND [C].[STATUS] = 'CONFIRMADA')`;
          }
          if (origemEstado) {
            fallbackFilters += ` AND [co].[CDUF] = @ORIGEMESTADO`;
            req2.input('ORIGEMESTADO', parseInt(origemEstado));
          }
          if (origemCidade) {
            fallbackFilters += ` AND [co].[NMCIDADE] LIKE @ORIGEMCIDADE`;
            req2.input('ORIGEMCIDADE', `%${origemCidade}%`);
          }
          if (destinoEstado) {
            fallbackFilters += ` AND [cd].[CDUF] = @DESTINOESTADO`;
            req2.input('DESTINOESTADO', parseInt(destinoEstado));
          }
          if (destinoCidade) {
            fallbackFilters += ` AND [cd].[NMCIDADE] LIKE @DESTINOCIDADE`;
            req2.input('DESTINOCIDADE', `%${destinoCidade}%`);
          }
          const fallbackFull = `
            WITH [UltimaPosicao] AS (
              SELECT 
                [RV].[IDVIAGEM] AS [VIAGEM],
                [RV].[LATITUDE],
                [RV].[LONGITUDE],
                '' AS [DSPOSICAO],
                [RV].[DHREGISTRO] AS [DHPOSICAO],
                [NM].[RZSOCIAL] AS [NMMOTORISTA],
                [E].[REFEQUIPAMENTO] AS [PLACA],
                [R].[DSROTEIRO],
                ROW_NUMBER() OVER (PARTITION BY [RV].[IDVIAGEM] ORDER BY [RV].[DHREGISTRO] DESC) AS [RN]
              FROM [dbo].[${rastreamentoTable}] [RV]
              INNER JOIN [dbo].[VIAGEMMESTRE] [VM] ON [RV].[IDVIAGEM] = [VM].[IDVIAGEM]
              LEFT JOIN [dbo].[ROTEIRO] [R] ON [VM].[IDROTEIRO] = [R].[IDROTEIRO]
              LEFT JOIN [dbo].[CIDADE] [co] ON [R].[CDCIDADEORIGEM] = [co].[CDCIDADE]
              LEFT JOIN [dbo].[CIDADE] [cd] ON [R].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
              LEFT JOIN [dbo].[VIAGEMMOTORISTA] [M] ON [RV].[IDVIAGEM] = [M].[IDVIAGEM]
              LEFT JOIN [dbo].[CADASTROGERAL] [NM] ON [M].[CDMOTORISTA] = [NM].[CDCADASTRO]
              LEFT JOIN [dbo].[VIAGEMVEICULO] [V] ON [RV].[IDVIAGEM] = [V].[IDVIAGEM]
              LEFT JOIN [dbo].[EQUIPAMENTO] [E] ON [V].[IDEQUIPAMENTO] = [E].[IDEQUIPAMENTO]
              WHERE [VM].[CDSITUACAOVIAGEM] >= 1 AND [VM].[CDSITUACAOVIAGEM] < 15
                AND [RV].[LATITUDE] IS NOT NULL AND [RV].[LONGITUDE] IS NOT NULL
                ${fallbackFilters}
            )
            SELECT [VIAGEM], [LATITUDE], [LONGITUDE], [DSPOSICAO], [DHPOSICAO], [NMMOTORISTA], [PLACA], [DSROTEIRO]
            FROM [UltimaPosicao] WHERE [RN] = 1
            ORDER BY [PLACA], [DHPOSICAO] DESC
          `;
          result = await req2.query(fallbackFull);
        } else {
          throw err;
        }
      }

      const veiculos = result.recordset || [];
      const total = veiculos.length;

      console.log(`[Mapa Viagem] Query executada. Total de veículos encontrados: ${total}`);
      if (total > 0) {
        console.log(`[Mapa Viagem] Primeiros 5 IDs de viagem:`, veiculos.slice(0, 5).map(v => v.VIAGEM));
      }

      res.json({
        veiculos: veiculos,
        total: total
      });
    } catch (err) {
      console.error('Erro ao listar veículos:', err);
      res.status(500).json({
        error: 'Erro interno ao listar veículos.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Executar init.sql
  executarInitSQL: async (req, res) => {
    try {
      const sqlPath = path.join(__dirname, '../public/modulos/gerenciar-mapa-viagem/sql/init.sql');
      
      let sqlContent = '';
      try {
        sqlContent = await fs.readFile(sqlPath, 'utf8');
      } catch (fileErr) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql não encontrado (não é obrigatório)',
          executed: false
        });
      }

      if (!sqlContent || !sqlContent.trim()) {
        return res.json({ 
          success: true, 
          message: 'Arquivo init.sql vazio',
          executed: false
        });
      }

      const pool = await poolPromise;
      const result = await pool.request().query(sqlContent);

      res.json({ 
        success: true, 
        message: 'init.sql executado com sucesso',
        executed: true
      });
    } catch (err) {
      console.error('Erro ao executar init.sql:', err);
      
      const errorMessage = err.message || '';
      const isExpectedError = 
        errorMessage.includes('duplicate key') ||
        errorMessage.includes('PRIMARY KEY') ||
        errorMessage.includes('UNIQUE constraint');

      if (isExpectedError) {
        return res.json({ 
          success: true, 
          message: 'init.sql executado (alguns erros esperados foram ignorados)',
          executed: true,
          warning: errorMessage
        });
      }

      res.status(500).json({ 
        error: 'Erro ao executar init.sql',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  }
};

module.exports = mapaViagemController;
