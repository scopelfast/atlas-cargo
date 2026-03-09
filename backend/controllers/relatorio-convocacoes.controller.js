// backend/controllers/relatorio-convocacoes.controller.js
// Controller para Relatório de Convocações
// Versão: 1.0
// Atlas Cargo

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');

const relatorioController = {
  // Buscar dados do relatório com filtros
  buscarRelatorio: async (req, res) => {
    try {
      const {
        dataInicio,
        dataFim,
        status,
        idViagem,
        idConvocacao,
        motorista,
        viagemConfirmada,
        motivoRecusa,
        contratador
      } = req.query;

      const pool = await poolPromise;

      // Construir query base
      let whereConditions = [];
      
      // Função auxiliar para validar valores
      const isValidValue = (value) => {
        if (!value) return false;
        if (typeof value !== 'string') return false;
        const trimmed = value.trim();
        if (trimmed === '' || trimmed === 'undefined' || trimmed === 'null') return false;
        return true;
      };
      
      // Validar e construir condições WHERE apenas se tiverem valor válido
      if (isValidValue(dataInicio)) {
        whereConditions.push('[conv].[DHCONVOCACAO] >= @dataInicio');
      }
      
      if (isValidValue(dataFim)) {
        whereConditions.push('[conv].[DHCONVOCACAO] <= @dataFim');
      }
      
      if (isValidValue(status)) {
        whereConditions.push('[conv].[STATUS] = @status');
      }
      
      if (isValidValue(idViagem) && !isNaN(idViagem.trim())) {
        whereConditions.push('[conv].[IDVIAGEM] = @idViagem');
      }
      
      if (isValidValue(idConvocacao) && !isNaN(idConvocacao.trim())) {
        whereConditions.push('[conv].[IDCONVOCACAO] = @idConvocacao');
      }
      
      if (isValidValue(motorista)) {
        if (!isNaN(motorista.trim())) {
          whereConditions.push('[conv].[CDCADASTRO_MOTORISTA] = @motoristaId');
        } else {
          whereConditions.push('[cg].[RZSOCIAL] LIKE @motorista');
        }
      }
      
      if (viagemConfirmada && (viagemConfirmada === 'true' || viagemConfirmada === '1')) {
        whereConditions.push('EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] [conv2] WHERE [conv2].[IDVIAGEM] = [conv].[IDVIAGEM] AND [conv2].[STATUS] = \'CONFIRMADA\')');
      } else if (viagemConfirmada && (viagemConfirmada === 'false' || viagemConfirmada === '0')) {
        whereConditions.push('NOT EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] [conv2] WHERE [conv2].[IDVIAGEM] = [conv].[IDVIAGEM] AND [conv2].[STATUS] = \'CONFIRMADA\')');
      }
      
      if (isValidValue(motivoRecusa) && !isNaN(motivoRecusa.trim())) {
        whereConditions.push('[conv].[CDMOTIVORECUSA] = @motivoRecusa');
      }
      
      if (isValidValue(contratador) && !isNaN(contratador.trim())) {
        whereConditions.push('[v].[CDCONTRATADOR] = @contratador');
      }

      const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';

      // Query principal - Lista de convocações (alias conv para evitar problema com [c] no PostgreSQL)
      const queryLista = `
        SELECT 
          [conv].[IDCONVOCACAO],
          [conv].[IDVIAGEM],
          [conv].[CDCADASTRO_MOTORISTA],
          UPPER([cg].[RZSOCIAL]) AS [NOME_MOTORISTA],
          [conv].[NRCELULAR],
          [conv].[STATUS],
          [conv].[CDMOTIVORECUSA],
          [mr].[DSMOTIVO] AS [MOTIVO_RECUSA],
          [conv].[DHCONVOCACAO],
          [conv].[DHRESPOSTA],
          [conv].[DHACESSO],
          [conv].[LATITUDE],
          [conv].[LONGITUDE],
          [v].[IDROTEIRO],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [r].[DSROTEIRO],
          [co].[ESTADO] AS [ORIGEM_ESTADO],
          [co].[NMCIDADE] AS [ORIGEM_CIDADE],
          [cd].[ESTADO] AS [DESTINO_ESTADO],
          [cd].[NMCIDADE] AS [DESTINO_CIDADE],
          [cf].[DSCLASSEFROTA],
          [tv].[DSTIPOVIAGEM],
          UPPER([cg_contratador].[RZSOCIAL]) AS [CONTRATADOR],
          [v].[VLFRETE],
          COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
          CASE 
            WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] [conv2] WHERE [conv2].[IDVIAGEM] = [conv].[IDVIAGEM] AND [conv2].[STATUS] = 'CONFIRMADA')
            THEN 'S' ELSE 'N'
          END AS [VIAGEM_CONFIRMADA]
        FROM [dbo].[CONVOCACAO] [conv]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [conv].[IDVIAGEM] = [v].[IDVIAGEM]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[TIPOVIAGEM] [tv] ON [v].[CDTIPOVIAGEM] = [tv].[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg_contratador] ON [v].[CDCONTRATADOR] = [cg_contratador].[CDCADASTRO]
        LEFT JOIN [dbo].[MOTIVORECUSA] [mr] ON [conv].[CDMOTIVORECUSA] = [mr].[CDMOTIVO]
        ${whereClause}
        ORDER BY [conv].[DHCONVOCACAO] DESC
      `;

      let queryEstatisticas = `
        SELECT 
          COUNT(*) AS [TOTAL],
          COUNT(DISTINCT [conv].[IDVIAGEM]) AS [TOTAL_VIAGENS],
          SUM(CASE WHEN [conv].[STATUS] = 'PENDENTE' THEN 1 ELSE 0 END) AS [PENDENTE],
          SUM(CASE WHEN [conv].[STATUS] = 'ACEITA' THEN 1 ELSE 0 END) AS [ACEITA],
          SUM(CASE WHEN [conv].[STATUS] = 'RECUSADA' THEN 1 ELSE 0 END) AS [RECUSADA],
          SUM(CASE WHEN [conv].[STATUS] = 'CONFIRMADA' THEN 1 ELSE 0 END) AS [CONFIRMADA],
          SUM(CASE WHEN [conv].[STATUS] = 'ACEITA_DESCARTADA' THEN 1 ELSE 0 END) AS [ACEITA_DESCARTADA],
          SUM(CASE WHEN [conv].[DHACESSO] IS NOT NULL THEN 1 ELSE 0 END) AS [COM_ACESSO],
          SUM(CASE WHEN [conv].[DHACESSO] IS NULL THEN 1 ELSE 0 END) AS [SEM_ACESSO],
          SUM(CASE WHEN [conv].[DHRESPOSTA] IS NOT NULL THEN 1 ELSE 0 END) AS [COM_RESPOSTA],
          SUM(CASE WHEN [conv].[DHRESPOSTA] IS NULL THEN 1 ELSE 0 END) AS [SEM_RESPOSTA]
        FROM [dbo].[CONVOCACAO] [conv]
      `;
      
      if ((motorista && isNaN(motorista)) || (contratador && isValidValue(contratador))) {
        let joins = [];
        if (motorista && isNaN(motorista)) {
          joins.push('LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]');
        }
        if (contratador && isValidValue(contratador)) {
          joins.push('LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [conv].[IDVIAGEM] = [v].[IDVIAGEM]');
        }
        if (joins.length > 0) {
          queryEstatisticas = queryEstatisticas.replace(
            'FROM [dbo].[CONVOCACAO] [conv]',
            `FROM [dbo].[CONVOCACAO] [conv] ${joins.join(' ')}`
          );
        }
      }
      
      queryEstatisticas += whereClause;

      let queryEstatisticasPorData = `
        SELECT 
          CAST([conv].[DHCONVOCACAO] AS DATE) AS [DATA],
          COUNT(*) AS [TOTAL],
          SUM(CASE WHEN [conv].[STATUS] = 'PENDENTE' THEN 1 ELSE 0 END) AS [PENDENTE],
          SUM(CASE WHEN [conv].[STATUS] = 'ACEITA' THEN 1 ELSE 0 END) AS [ACEITA],
          SUM(CASE WHEN [conv].[STATUS] = 'RECUSADA' THEN 1 ELSE 0 END) AS [RECUSADA],
          SUM(CASE WHEN [conv].[STATUS] = 'CONFIRMADA' THEN 1 ELSE 0 END) AS [CONFIRMADA]
        FROM [dbo].[CONVOCACAO] [conv]
      `;
      
      if ((motorista && isNaN(motorista)) || (contratador && isValidValue(contratador))) {
        let joins = [];
        if (motorista && isNaN(motorista)) {
          joins.push('LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]');
        }
        if (contratador && isValidValue(contratador)) {
          joins.push('LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [conv].[IDVIAGEM] = [v].[IDVIAGEM]');
        }
        if (joins.length > 0) {
          queryEstatisticasPorData = queryEstatisticasPorData.replace(
            'FROM [dbo].[CONVOCACAO] [conv]',
            `FROM [dbo].[CONVOCACAO] [conv] ${joins.join(' ')}`
          );
        }
      }
      
      queryEstatisticasPorData += `${whereClause}
        GROUP BY CAST([conv].[DHCONVOCACAO] AS DATE)
        ORDER BY [DATA] DESC`;

      // Criar requests separados para cada query
      const requestLista = pool.request();
      const requestEstatisticas = pool.request();
      const requestEstatisticasPorData = pool.request();

      // Aplicar parâmetros em cada request APENAS se forem válidos (mesma lógica do whereClause)
      if (isValidValue(dataInicio)) {
        const dataInicioValue = new Date(dataInicio.trim());
        requestLista.input('dataInicio', sql.DateTime, dataInicioValue);
        requestEstatisticas.input('dataInicio', sql.DateTime, dataInicioValue);
        requestEstatisticasPorData.input('dataInicio', sql.DateTime, dataInicioValue);
      }
      if (isValidValue(dataFim)) {
        const dataFimValue = new Date(dataFim.trim() + ' 23:59:59');
        requestLista.input('dataFim', sql.DateTime, dataFimValue);
        requestEstatisticas.input('dataFim', sql.DateTime, dataFimValue);
        requestEstatisticasPorData.input('dataFim', sql.DateTime, dataFimValue);
      }
      if (isValidValue(status)) {
        const statusValue = status.trim();
        requestLista.input('status', sql.VarChar(50), statusValue);
        requestEstatisticas.input('status', sql.VarChar(50), statusValue);
        requestEstatisticasPorData.input('status', sql.VarChar(50), statusValue);
      }
      if (isValidValue(idViagem) && !isNaN(idViagem.trim())) {
        const idViagemValue = parseInt(idViagem.trim());
        requestLista.input('idViagem', sql.Int, idViagemValue);
        requestEstatisticas.input('idViagem', sql.Int, idViagemValue);
        requestEstatisticasPorData.input('idViagem', sql.Int, idViagemValue);
      }
      if (isValidValue(idConvocacao) && !isNaN(idConvocacao.trim())) {
        const idConvocacaoValue = parseInt(idConvocacao.trim());
        requestLista.input('idConvocacao', sql.Int, idConvocacaoValue);
        requestEstatisticas.input('idConvocacao', sql.Int, idConvocacaoValue);
        requestEstatisticasPorData.input('idConvocacao', sql.Int, idConvocacaoValue);
      }
      if (isValidValue(motorista)) {
        if (!isNaN(motorista.trim())) {
          // Se for número, buscar por ID
          const motoristaIdValue = parseInt(motorista.trim());
          requestLista.input('motoristaId', sql.Int, motoristaIdValue);
          requestEstatisticas.input('motoristaId', sql.Int, motoristaIdValue);
          requestEstatisticasPorData.input('motoristaId', sql.Int, motoristaIdValue);
        } else {
          // Se for texto, buscar por nome
          const motoristaValue = `%${motorista.trim()}%`;
          requestLista.input('motorista', sql.VarChar(200), motoristaValue);
          requestEstatisticas.input('motorista', sql.VarChar(200), motoristaValue);
          requestEstatisticasPorData.input('motorista', sql.VarChar(200), motoristaValue);
        }
      }
      if (isValidValue(motivoRecusa) && !isNaN(motivoRecusa.trim())) {
        const motivoRecusaValue = parseInt(motivoRecusa.trim());
        requestLista.input('motivoRecusa', sql.Int, motivoRecusaValue);
        requestEstatisticas.input('motivoRecusa', sql.Int, motivoRecusaValue);
        requestEstatisticasPorData.input('motivoRecusa', sql.Int, motivoRecusaValue);
      }
      if (isValidValue(contratador) && !isNaN(contratador.trim())) {
        const contratadorValue = parseFloat(contratador.trim());
        requestLista.input('contratador', sql.Decimal(15, 0), contratadorValue);
        requestEstatisticas.input('contratador', sql.Decimal(15, 0), contratadorValue);
        requestEstatisticasPorData.input('contratador', sql.Decimal(15, 0), contratadorValue);
      }

      // Executar queries
      const [listaResult, estatisticasResult, estatisticasPorDataResult] = await Promise.all([
        requestLista.query(queryLista),
        requestEstatisticas.query(queryEstatisticas),
        requestEstatisticasPorData.query(queryEstatisticasPorData)
      ]);

      res.json({
        lista: listaResult.recordset,
        estatisticas: estatisticasResult.recordset[0] || {},
        estatisticasPorData: estatisticasPorDataResult.recordset || []
      });
    } catch (err) {
      console.error('Erro ao buscar relatório de convocações:', err);
      const errorMessage = err.message || 'Erro interno ao buscar relatório.';
      res.status(500).json({ 
        error: errorMessage,
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  },

  // Buscar estatísticas resumidas (PostgreSQL - alias entre aspas para preservar caso)
  buscarEstatisticas: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.query(`
        SELECT 
          COUNT(*)::int AS "TOTAL",
          COUNT(DISTINCT "conv"."IDVIAGEM")::int AS "TOTAL_VIAGENS",
          COALESCE(SUM(CASE WHEN "conv"."STATUS" = 'PENDENTE' THEN 1 ELSE 0 END), 0)::int AS "PENDENTE",
          COALESCE(SUM(CASE WHEN "conv"."STATUS" = 'ACEITA' THEN 1 ELSE 0 END), 0)::int AS "ACEITA",
          COALESCE(SUM(CASE WHEN "conv"."STATUS" = 'RECUSADA' THEN 1 ELSE 0 END), 0)::int AS "RECUSADA",
          COALESCE(SUM(CASE WHEN "conv"."STATUS" = 'CONFIRMADA' THEN 1 ELSE 0 END), 0)::int AS "CONFIRMADA",
          COALESCE(SUM(CASE WHEN "conv"."STATUS" = 'ACEITA_DESCARTADA' THEN 1 ELSE 0 END), 0)::int AS "ACEITA_DESCARTADA",
          COALESCE(SUM(CASE WHEN "conv"."DHACESSO" IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS "COM_ACESSO",
          COALESCE(SUM(CASE WHEN "conv"."DHACESSO" IS NULL THEN 1 ELSE 0 END), 0)::int AS "SEM_ACESSO",
          COALESCE(SUM(CASE WHEN "conv"."DHRESPOSTA" IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS "COM_RESPOSTA",
          COALESCE(SUM(CASE WHEN "conv"."DHRESPOSTA" IS NULL THEN 1 ELSE 0 END), 0)::int AS "SEM_RESPOSTA",
          (COUNT(DISTINCT "conv"."IDVIAGEM") - COUNT(DISTINCT CASE WHEN "conv"."STATUS" = 'CONFIRMADA' THEN "conv"."IDVIAGEM" END))::int AS "VIAGENS_PENDENTES"
        FROM "CONVOCACAO" "conv"
      `);
      res.json(result.rows[0] || {});
    } catch (err) {
      console.error('Erro ao buscar estatísticas:', err);
      res.status(500).json({ error: 'Erro interno ao buscar estatísticas.' });
    }
  }
};

module.exports = relatorioController;

