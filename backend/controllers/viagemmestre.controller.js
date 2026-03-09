// backend/controllers/viagemmestre.controller.js
// Controller para Gerenciamento de Viagens
// Versão: 1.0
// Atlas Cargo
// Data: 2026-04-05

const sql = require('../config/mssql-compat');
const axios = require('axios');
const { poolPromise, getFirstNumericValue, createTransaction } = require('../config/db');
const { getSgUser } = require('../utils/audit');

// Constantes
const SITUACAO_VIAGEM = {
  'A': 'Aprovada',
  'C': 'Cancelada',
  'D': 'Preparação',
  'E': 'Final de rota',
  'F': 'Viagem finalizada',
  'M': 'Emissão documentos',
  'P': 'Programada',
  'T': 'Em trânsito'
};

// Controller methods
const viagemController = {
  // Listar viagens com filtros
  listar: async (req, res) => {
    try {
      const {
        idViagem, situacaoViagem, tipoViagem, classeFrota, contratador,
        origemEstado, origemCidade, destinoEstado, destinoCidade,
        roteiro, dataInicio, dataFim, frete, peso, cubagem, rastreado, motoristaConfirmado
      } = req.query;

      let query = `
        SELECT 
          [v].[IDVIAGEM],
          [v].[FGSITVIAGEM],
          [v].[CDSITUACAOVIAGEM],
          [s].[DSSITUACAOVIAGEM],
          [v].[CDTIPOVIAGEM],
          [t].[DSTIPOVIAGEM],
          [v].[SGUSERINCLUSAO],
          [v].[DHINCLUSAO],
          [v].[CDCONTRATADOR],
          upper(isnull(nullif(ltrim(rtrim([cg].[RZSOCIAL])), ''), ltrim(rtrim([cg].[NMFANTASIA])))) AS CONTRATADOR_NOME,
          [v].[FGACTIVE],
          [v].[CDCLASSEFROTA],
          [cf].[DSCLASSEFROTA],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[IDROTEIRO],
          [r].[DSROTEIRO],
          [v].[DISTANCIAKM],
          [v].[VLFRETE],
          COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
          [v].[PESO],
          [v].[CUBAGEM],
          [v].[OBSERV],
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[CDCIDADE] AS ORIGEM_CODIGO,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[CDCIDADE] AS DESTINO_CODIGO,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM]) AS QTD_ACIONADOS,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] IN ('ACEITA', 'ACEITA_DESCARTADA')) AS QTD_ACEITE,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] = 'RECUSADA') AS QTD_RECUSA,
          CASE 
            WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] = 'CONFIRMADA') THEN 'S'
            ELSE 'N'
          END AS TEM_CONFIRMADO,
          (SELECT COUNT(*) FROM [dbo].[DELIVERY_PROOFS] WHERE [IDVIAGEM] = [v].[IDVIAGEM]) AS QTD_COMPROVANTES
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] t ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE 1=1
      `;

      const params = [];
      if (idViagem) {
        query += ` AND [v].[IDVIAGEM] = @IDVIAGEM`;
        params.push({ name: 'IDVIAGEM', value: parseFloat(idViagem) });
      }
      if (situacaoViagem) {
        query += ` AND [v].[FGSITVIAGEM] = @SITUACAOVIAGEM`;
        params.push({ name: 'SITUACAOVIAGEM', value: situacaoViagem });
      }
      if (tipoViagem) {
        query += ` AND [v].[CDTIPOVIAGEM] = @TIPOVIAGEM`;
        params.push({ name: 'TIPOVIAGEM', value: parseInt(tipoViagem) });
      }
      if (classeFrota) {
        query += ` AND [v].[CDCLASSEFROTA] = @CLASSEFROTA`;
        params.push({ name: 'CLASSEFROTA', value: parseInt(classeFrota) });
      }
      if (contratador) {
        query += ` AND [v].[CDCONTRATADOR] = @CONTRATADOR`;
        params.push({ name: 'CONTRATADOR', value: parseFloat(contratador) });
      }
      if (origemEstado) {
        query += ` AND [co].[ESTADO] = @ORIGEM_ESTADO`;
        params.push({ name: 'ORIGEM_ESTADO', value: origemEstado });
      }
      if (origemCidade) {
        query += ` AND [co].[NMCIDADE] LIKE @ORIGEM_CIDADE`;
        params.push({ name: 'ORIGEM_CIDADE', value: `%${origemCidade}%` });
      }
      if (destinoEstado) {
        query += ` AND [cd].[ESTADO] = @DESTINO_ESTADO`;
        params.push({ name: 'DESTINO_ESTADO', value: destinoEstado });
      }
      if (destinoCidade) {
        query += ` AND [cd].[NMCIDADE] LIKE @DESTINO_CIDADE`;
        params.push({ name: 'DESTINO_CIDADE', value: `%${destinoCidade}%` });
      }
      if (roteiro) {
        query += ` AND [v].[IDROTEIRO] = @ROTEIRO`;
        params.push({ name: 'ROTEIRO', value: parseFloat(roteiro) });
      }
      if (dataInicio) {
        query += ` AND [v].[DTPREVINICIO] >= @DATAINICIO`;
        params.push({ name: 'DATAINICIO', value: new Date(dataInicio) });
      }
      if (dataFim) {
        query += ` AND [v].[DTPREVFINAL] <= @DATAFIM`;
        params.push({ name: 'DATAFIM', value: new Date(dataFim) });
      }
      if (frete) {
        query += ` AND [v].[VLFRETE] = @FRETE`;
        params.push({ name: 'FRETE', value: parseFloat(frete) });
      }
      if (peso) {
        query += ` AND [v].[PESO] = @PESO`;
        params.push({ name: 'PESO', value: parseFloat(peso) });
      }
      if (cubagem) {
        query += ` AND [v].[CUBAGEM] = @CUBAGEM`;
        params.push({ name: 'CUBAGEM', value: parseFloat(cubagem) });
      }
      if (rastreado) {
        query += ` AND [v].[FGRASTREADO] = @RASTREADO`;
        params.push({ name: 'RASTREADO', value: rastreado });
      }
      if (motoristaConfirmado) {
        if (motoristaConfirmado === 'S') {
          query += ` AND EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] = 'CONFIRMADA')`;
        } else if (motoristaConfirmado === 'N') {
          query += ` AND NOT EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] = 'CONFIRMADA')`;
        }
      }

      query += ` ORDER BY [v].[IDVIAGEM] DESC`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => {
        // Proteção: garantir que o valor não seja um objeto
        let valor = p.value;
        if (typeof valor === 'object' && valor !== null && !(valor instanceof Date)) {
          console.error(`[LISTAR VIAGENS] ⚠️ AVISO: Parâmetro ${p.name} é um objeto! Convertendo para string.`, valor);
          valor = JSON.stringify(valor);
        }
        request.input(p.name, valor);
      });

      const result = await request.query(query);
      const viagens = result.recordset.map(v => ({
        IDVIAGEM: v.IDVIAGEM,
        FGSITVIAGEM: v.FGSITVIAGEM,
        FGSITVIAGEM_NOME: SITUACAO_VIAGEM[v.FGSITVIAGEM] || v.FGSITVIAGEM,
        CDSITUACAOVIAGEM: v.CDSITUACAOVIAGEM,
        DSSITUACAOVIAGEM: v.DSSITUACAOVIAGEM || 'Não informado',
        CDTIPOVIAGEM: v.CDTIPOVIAGEM,
        DSTIPOVIAGEM: v.DSTIPOVIAGEM || 'Não informado',
        SGUSERINCLUSAO: v.SGUSERINCLUSAO || 'Não informado',
        DHINCLUSAO: v.DHINCLUSAO,
        CDCONTRATADOR: v.CDCONTRATADOR,
        CONTRATADOR_NOME: v.CONTRATADOR_NOME || 'Não informado',
        FGACTIVE: v.FGACTIVE === 'A' ? 'S' : 'N',
        CDCLASSEFROTA: v.CDCLASSEFROTA,
        DSCLASSEFROTA: v.DSCLASSEFROTA || 'Não informado',
        DTPREVINICIO: v.DTPREVINICIO,
        DTPREVFINAL: v.DTPREVFINAL,
        IDROTEIRO: v.IDROTEIRO,
        DSROTEIRO: v.DSROTEIRO || 'Não informado',
        DISTANCIAKM: v.DISTANCIAKM,
        VLFRETE: v.VLFRETE,
        PESO: v.PESO,
        CUBAGEM: v.CUBAGEM,
        OBSERV: v.OBSERV || 'Não informado',
        ORIGEM_ESTADO: v.ORIGEM_ESTADO || 'Não informado',
        ORIGEM_CIDADE: v.ORIGEM_CIDADE || 'Não informado',
        ORIGEM_CODIGO: v.ORIGEM_CODIGO,
        DESTINO_ESTADO: v.DESTINO_ESTADO || 'Não informado',
        DESTINO_CIDADE: v.DESTINO_CIDADE || 'Não informado',
        DESTINO_CODIGO: v.DESTINO_CODIGO,
        QTD_ACIONADOS: v.QTD_ACIONADOS || 0,
        QTD_ACEITE: v.QTD_ACEITE || 0,
        QTD_RECUSA: v.QTD_RECUSA || 0,
        TEM_CONFIRMADO: v.TEM_CONFIRMADO || 'N',
        QTD_COMPROVANTES: (v.QTD_COMPROVANTES ?? v.qtd_comprovantes ?? 0),
        TEM_COMPROVANTE: ((v.QTD_COMPROVANTES ?? v.qtd_comprovantes ?? 0) > 0) ? 'S' : 'N'
      }));

      res.json(viagens);
    } catch (err) {
      console.error('Erro ao listar viagens:', err);
      res.status(500).json({ error: 'Erro ao carregar viagens.' });
    }
  },

  // Criar nova viagem
  criar: async (req, res) => {
    try {
      const {
        FGSITVIAGEM, CDSITUACAOVIAGEM, CDTIPOVIAGEM, CDCONTRATADOR,
        CDCLASSEFROTA, DTPREVINICIO, DTPREVFINAL, IDROTEIRO, DISTANCIAKM,
        VLFRETE, PESO, CUBAGEM, OBSERV, FGRASTREADO, MOEDA
      } = req.body;

      // Validações obrigatórias
      if (!FGSITVIAGEM || !CDSITUACAOVIAGEM || !CDTIPOVIAGEM) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

      const pool = await poolPromise;

      // Usuário que grava o registro: sempre o logado (req.user do JWT ou header user-login)
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      // Gerar novo ID
      const maxResult = await pool
        .request()
        .query('SELECT COALESCE(MAX([IDVIAGEM]), 0) + 1 AS [maxId] FROM [dbo].[VIAGEMMESTRE]');
      const novoId = getFirstNumericValue(maxResult.recordset, 1);

      // Inserir viagem
      const request = pool.request();
      request.input('IDVIAGEM', sql.Decimal(15, 0), novoId);
      request.input('FGSITVIAGEM', FGSITVIAGEM);
      request.input('CDSITUACAOVIAGEM', sql.SmallInt, CDSITUACAOVIAGEM);
      request.input('CDTIPOVIAGEM', sql.Int, CDTIPOVIAGEM);
      request.input('CDCONTRATADOR', CDCONTRATADOR ? sql.Decimal(15, 0) : sql.VarChar, CDCONTRATADOR || null);
      request.input('CDCLASSEFROTA', CDCLASSEFROTA ? sql.SmallInt : sql.VarChar, CDCLASSEFROTA || null);
      request.input('DTPREVINICIO', DTPREVINICIO ? sql.SmallDateTime : sql.VarChar, DTPREVINICIO || null);
      request.input('DTPREVFINAL', DTPREVFINAL ? sql.SmallDateTime : sql.VarChar, DTPREVFINAL || null);
      request.input('IDROTEIRO', IDROTEIRO ? sql.Decimal(15, 0) : sql.VarChar, IDROTEIRO || null);
      request.input('DISTANCIAKM', DISTANCIAKM ? sql.Decimal(15, 4) : sql.VarChar, DISTANCIAKM || null);
      request.input('VLFRETE', VLFRETE ? sql.Decimal(15, 4) : sql.VarChar, VLFRETE || null);
      request.input('PESO', PESO ? sql.Decimal(15, 4) : sql.VarChar, PESO || null);
      request.input('CUBAGEM', CUBAGEM ? sql.Decimal(15, 4) : sql.VarChar, CUBAGEM || null);
      request.input('OBSERV', OBSERV?.trim() || null);
      request.input('FGRASTREADO', FGRASTREADO || 'N');
      request.input('MOEDA', (MOEDA && String(MOEDA).trim().substring(0, 3)) || 'BRL');
      request.input('SGUSERINCLUSAO', sgUser);
      request.input('DHINCLUSAO', new Date());

      await request.query(`
        INSERT INTO [dbo].[VIAGEMMESTRE] (
          [IDVIAGEM], [FGSITVIAGEM], [CDSITUACAOVIAGEM], [CDTIPOVIAGEM], [CDCONTRATADOR],
          [CDCLASSEFROTA], [DTPREVINICIO], [DTPREVFINAL], [IDROTEIRO], [DISTANCIAKM],
          [VLFRETE], [PESO], [CUBAGEM], [OBSERV], [FGRASTREADO], [MOEDA], [SGUSERINCLUSAO], [DHINCLUSAO],
          [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @IDVIAGEM, @FGSITVIAGEM, @CDSITUACAOVIAGEM, @CDTIPOVIAGEM, @CDCONTRATADOR,
          @CDCLASSEFROTA, @DTPREVINICIO, @DTPREVFINAL, @IDROTEIRO, @DISTANCIAKM,
          @VLFRETE, @PESO, @CUBAGEM, @OBSERV, @FGRASTREADO, @MOEDA, @SGUSERINCLUSAO, @DHINCLUSAO,
          'A', GETDATE(), @SGUSERINCLUSAO, 'AppDVcargas'
        )
      `);

      res.status(201).json({
        success: true,
        message: 'Viagem cadastrada com sucesso!',
        IDVIAGEM: novoId
      });
    } catch (err) {
      console.error('Erro ao inserir viagem:', err);
      res.status(500).json({ error: 'Erro ao cadastrar viagem.' });
    }
  },

  // Atualizar viagem
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const {
        FGSITVIAGEM, CDSITUACAOVIAGEM, CDTIPOVIAGEM, CDCONTRATADOR,
        CDCLASSEFROTA, DTPREVINICIO, DTPREVFINAL, IDROTEIRO, DISTANCIAKM,
        VLFRETE, PESO, CUBAGEM, OBSERV, FGACTIVE, FGRASTREADO, MOEDA
      } = req.body;

      if (!FGSITVIAGEM || !CDSITUACAOVIAGEM || !CDTIPOVIAGEM || !FGACTIVE) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

      const sgUserUpd = getSgUser(req);
      if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      const idNumerico = parseFloat(id);

      const request = pool.request();
      request.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);
      request.input('FGSITVIAGEM', FGSITVIAGEM);
      request.input('CDSITUACAOVIAGEM', sql.SmallInt, CDSITUACAOVIAGEM);
      request.input('CDTIPOVIAGEM', sql.Int, CDTIPOVIAGEM);
      request.input('CDCONTRATADOR', CDCONTRATADOR ? sql.Decimal(15, 0) : sql.VarChar, CDCONTRATADOR || null);
      request.input('CDCLASSEFROTA', CDCLASSEFROTA ? sql.SmallInt : sql.VarChar, CDCLASSEFROTA || null);
      request.input('DTPREVINICIO', DTPREVINICIO ? sql.SmallDateTime : sql.VarChar, DTPREVINICIO || null);
      request.input('DTPREVFINAL', DTPREVFINAL ? sql.SmallDateTime : sql.VarChar, DTPREVFINAL || null);
      request.input('IDROTEIRO', IDROTEIRO ? sql.Decimal(15, 0) : sql.VarChar, IDROTEIRO || null);
      request.input('DISTANCIAKM', DISTANCIAKM ? sql.Decimal(15, 4) : sql.VarChar, DISTANCIAKM || null);
      request.input('VLFRETE', VLFRETE ? sql.Decimal(15, 4) : sql.VarChar, VLFRETE || null);
      request.input('PESO', PESO ? sql.Decimal(15, 4) : sql.VarChar, PESO || null);
      request.input('CUBAGEM', CUBAGEM ? sql.Decimal(15, 4) : sql.VarChar, CUBAGEM || null);
      request.input('OBSERV', OBSERV?.trim() || null);
      request.input('FGACTIVE', FGACTIVE === 'S' ? 'A' : 'I');
      request.input('FGRASTREADO', FGRASTREADO || 'N');
      request.input('MOEDA', (MOEDA != null && MOEDA !== '') ? String(MOEDA).trim().substring(0, 3) : null);
      request.input('sgUser', sql.VarChar(50), sgUserUpd);

      await request.query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET 
          [FGSITVIAGEM] = @FGSITVIAGEM,
          [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM,
          [CDTIPOVIAGEM] = @CDTIPOVIAGEM,
          [CDCONTRATADOR] = @CDCONTRATADOR,
          [CDCLASSEFROTA] = @CDCLASSEFROTA,
          [DTPREVINICIO] = @DTPREVINICIO,
          [DTPREVFINAL] = @DTPREVFINAL,
          [IDROTEIRO] = @IDROTEIRO,
          [DISTANCIAKM] = @DISTANCIAKM,
          [VLFRETE] = @VLFRETE,
          [PESO] = @PESO,
          [CUBAGEM] = @CUBAGEM,
          [OBSERV] = @OBSERV,
          [FGACTIVE] = @FGACTIVE,
          [FGRASTREADO] = @FGRASTREADO,
          [MOEDA] = COALESCE(@MOEDA, [MOEDA], 'BRL'),
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @sgUser,
          [SERVERORIG] = 'AppDVcargas'
        WHERE [IDVIAGEM] = @IDVIAGEM
      `);

      // Emitir evento WebSocket para atualização de viagem
      try {
        const websocketTorre = req.app.get('websocketTorre');
        if (websocketTorre) {
          // Buscar dados atualizados da viagem
          const viagemAtualizada = await pool
            .request()
            .input('IDVIAGEM', sql.Decimal(15, 0), idNumerico)
            .query(`
              SELECT 
                [v].[IDVIAGEM],
                [v].[FGSITVIAGEM],
                [v].[CDSITUACAOVIAGEM],
                [s].[DSSITUACAOVIAGEM],
                [v].[CDTIPOVIAGEM],
                [t].[DSTIPOVIAGEM],
                [v].[FGACTIVE],
                [v].[CDCLASSEFROTA],
                [cf].[DSCLASSEFROTA],
                [v].[DTPREVINICIO],
                [v].[DTPREVFINAL],
                [v].[IDROTEIRO],
                [r].[DSROTEIRO],
            [v].[DISTANCIAKM],
            [v].[VLFRETE],
            COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
            [v].[PESO],
            [v].[CUBAGEM],
            [v].[OBSERV],
                [co].[ESTADO] AS ORIGEM_ESTADO,
                [co].[NMCIDADE] AS ORIGEM_CIDADE,
                [cd].[ESTADO] AS DESTINO_ESTADO,
                [cd].[NMCIDADE] AS DESTINO_CIDADE,
                CASE 
                  WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = [v].[IDVIAGEM] AND [STATUS] = 'CONFIRMADA') THEN 'S'
                  ELSE 'N'
                END AS TEM_CONFIRMADO
              FROM [dbo].[VIAGEMMESTRE] v
              LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
              LEFT JOIN [dbo].[TIPOVIAGEM] t ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
              LEFT JOIN [dbo].[CLASSEFROTA] cf ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
              LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
              LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
              LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
              WHERE [v].[IDVIAGEM] = @IDVIAGEM
            `);

          if (viagemAtualizada.recordset && viagemAtualizada.recordset[0]) {
            const dadosViagem = viagemAtualizada.recordset[0];
            websocketTorre.emitirAtualizacaoViagem(idNumerico, dadosViagem);
          }
        }
      } catch (wsError) {
        // Não interromper resposta se WebSocket falhar
        console.warn('⚠️ Erro ao emitir evento WebSocket de atualização de viagem:', wsError.message);
      }

      res.json({ success: true, message: 'Viagem atualizada com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar viagem:', err);
      res.status(500).json({ error: 'Erro ao atualizar viagem.' });
    }
  },

  // Buscar viagem por ID
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            [v].[IDVIAGEM],
            [v].[FGSITVIAGEM],
            [v].[CDSITUACAOVIAGEM],
            [v].[CDTIPOVIAGEM],
            [v].[SGUSERINCLUSAO],
            [v].[DHINCLUSAO],
            [v].[CDCONTRATADOR],
            [v].[FGACTIVE],
            [v].[CDCLASSEFROTA],
            [v].[DTPREVINICIO],
            [v].[DTPREVFINAL],
            [v].[IDROTEIRO],
            [v].[DISTANCIAKM],
            [v].[VLFRETE],
            COALESCE([v].[MOEDA], 'BRL') AS [MOEDA],
            [v].[PESO],
            [v].[CUBAGEM],
            [v].[OBSERV],
            [v].[FGRASTREADO],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO],
            [r].[DSROTEIRO],
            [co].[ESTADO] AS ORIGEM_ESTADO,
            [co].[NMCIDADE] AS ORIGEM_CIDADE,
            [cd].[ESTADO] AS DESTINO_ESTADO,
            [cd].[NMCIDADE] AS DESTINO_CIDADE,
            [cf].[DSCLASSEFROTA],
            [tv].[DSTIPOVIAGEM],
            upper(COALESCE(NULLIF(TRIM([cg].[RZSOCIAL]), ''), TRIM([cg].[NMFANTASIA]))) AS CONTRATADOR_NOME
          FROM [dbo].[VIAGEMMESTRE] [v]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
          LEFT JOIN [dbo].[TIPOVIAGEM] [tv] ON [v].[CDTIPOVIAGEM] = [tv].[CDTIPOVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO]
          WHERE [v].[IDVIAGEM] = @IDVIAGEM
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const v = result.recordset[0];
      // PostgreSQL retorna colunas em minúsculas; aceitar ambos os formatos
      const get = (obj, ...keys) => {
        for (const k of keys) {
          if (obj[k] !== undefined && obj[k] !== null) return obj[k];
          const lower = k.toLowerCase();
          if (obj[lower] !== undefined && obj[lower] !== null) return obj[lower];
        }
        return undefined;
      };
      res.json({
        IDVIAGEM: v.IDVIAGEM ?? v.idviagem,
        FGSITVIAGEM: v.FGSITVIAGEM ?? v.fgsitviagem,
        CDSITUACAOVIAGEM: v.CDSITUACAOVIAGEM ?? v.cdsituacaoviagem,
        CDTIPOVIAGEM: v.CDTIPOVIAGEM ?? v.cdtipoviagem,
        DSTIPOVIAGEM: v.DSTIPOVIAGEM ?? v.dstipoviagem,
        SGUSERINCLUSAO: v.SGUSERINCLUSAO ?? v.sguserinclusao,
        DHINCLUSAO: v.DHINCLUSAO ?? v.dhinclusao,
        CDCONTRATADOR: v.CDCONTRATADOR ?? v.cdcontratador,
        CONTRATADOR_NOME: v.CONTRATADOR_NOME ?? v.contratador_nome,
        FGACTIVE: (v.FGACTIVE ?? v.fgactive) === 'A' ? 'S' : 'N',
        CDCLASSEFROTA: v.CDCLASSEFROTA ?? v.cdclassefrota,
        DSCLASSEFROTA: v.DSCLASSEFROTA ?? v.dsclassefrota,
        DTPREVINICIO: v.DTPREVINICIO ?? v.dtprevinicio,
        DTPREVFINAL: v.DTPREVFINAL ?? v.dtprevfinal,
        IDROTEIRO: v.IDROTEIRO ?? v.idroteiro,
        DSROTEIRO: v.DSROTEIRO ?? v.dsroteiro,
        DISTANCIAKM: v.DISTANCIAKM ?? v.distanciakm,
        VLFRETE: v.VLFRETE ?? v.vlfrete,
        MOEDA: (v.MOEDA ?? v.moeda) || 'BRL',
        PESO: v.PESO ?? v.peso,
        CUBAGEM: v.CUBAGEM ?? v.cubagem,
        OBSERV: v.OBSERV ?? v.observ,
        FGRASTREADO: (v.FGRASTREADO ?? v.fgrastreado) || 'N',
        ORIGEM_ESTADO: get(v, 'ORIGEM_ESTADO'),
        ORIGEM_CIDADE: get(v, 'ORIGEM_CIDADE'),
        ORIGEM_CODIGO: v.CDCIDADEORIGEM ?? v.cdcidadeorigem,
        DESTINO_ESTADO: get(v, 'DESTINO_ESTADO'),
        DESTINO_CIDADE: get(v, 'DESTINO_CIDADE'),
        DESTINO_CODIGO: v.CDCIDADEDESTINO ?? v.cdcidadedestino
      });
    } catch (err) {
      console.error('Erro ao buscar viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar viagem.' });
    }
  },

  // Excluir viagem (lógica)
  excluir: async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.query;
      const pool = await poolPromise;

      // Validação do ID
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      const idNumerico = parseFloat(id);
      if (isNaN(idNumerico) || idNumerico <= 0) {
        return res.status(400).json({ error: 'ID inválido.' });
      }

      // Verificar status atual
      const checkRequest = pool.request();
      checkRequest.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);

      const checkResult = await checkRequest.query(`
        SELECT [FGACTIVE] FROM [dbo].[VIAGEMMESTRE] WHERE [IDVIAGEM] = @IDVIAGEM
      `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const statusAtual = checkResult.recordset[0].FGACTIVE;
      const estaAtivo = statusAtual === 'A';

      // Determinar nova situação
      let novaSituacao, mensagem;
      if (action === 'activate') {
        novaSituacao = 'A';
        mensagem = 'Viagem reativada com sucesso!';
      } else if (action === 'deactivate') {
        novaSituacao = 'I';
        mensagem = 'Viagem desativada com sucesso!';
      } else {
        novaSituacao = estaAtivo ? 'I' : 'A';
        mensagem = estaAtivo ? 'Viagem desativada com sucesso!' : 'Viagem reativada com sucesso!';
      }

      const request = pool.request();
      const sgUserStatus = getSgUser(req);
      if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      request.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);
      request.input('FGACTIVE', sql.Char(1), novaSituacao);
      request.input('sgUser', sql.VarChar(50), sgUserStatus);

      const result = await request.query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = @sgUser,
          SERVERORIG = 'AppDVcargas'
        WHERE IDVIAGEM = @IDVIAGEM
      `);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
    } catch (err) {
      console.error('Erro ao alterar status da viagem:', err);
      res.status(500).json({ error: 'Erro ao alterar status da viagem.' });
    }
  },

  // Listar combos
  listarTiposViagem: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDTIPOVIAGEM], [DSTIPOVIAGEM] FROM [dbo].[TIPOVIAGEM] WHERE [FGACTIVE] = \'A\' ORDER BY [DSTIPOVIAGEM]');
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar tipos de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar tipos de viagem.' });
    }
  },

  listarSituacoesViagem: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDSITUACAOVIAGEM], [DSSITUACAOVIAGEM] FROM [dbo].[SITUACAOVIAGEM] WHERE [FGACTIVE] = \'A\' ORDER BY [DSSITUACAOVIAGEM]');
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar situações de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar situações de viagem.' });
    }
  },

  listarClassesFrota: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDCLASSEFROTA], [DSCLASSEFROTA] FROM [dbo].[CLASSEFROTA] WHERE [FGACTIVE] = \'A\' ORDER BY [DSCLASSEFROTA]');
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar classes de frota:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  listarContratadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const { apenasComConvocacoes } = req.query;

      const normalizarLinha = (row) => ({
        CDCADASTRO: row.CDCADASTRO ?? row.cdcadastro,
        RZSOCIAL: (row.RZSOCIAL ?? row.rzsocial ?? '').toString()
      });

      const runQueryPrincipal = async () => {
        if (apenasComConvocacoes === 'true') {
          const result = await pool.request().query(`
            SELECT DISTINCT 
              cg."CDCADASTRO", 
              upper(cg."RZSOCIAL") AS "RZSOCIAL"  
            FROM "CADASTROGERAL" cg
            INNER JOIN "VIAGEMMESTRE" v ON cg."CDCADASTRO" = v."CDCONTRATADOR"
            INNER JOIN "CONVOCACAO" c ON v."IDVIAGEM" = c."IDVIAGEM"
            WHERE (cg."FGPROGRAMADOR" = 'S' OR (cg."FGPROGRAMADOR" IS NULL AND cg."FGTIPOCADASTRO" = 'O'))
              AND cg."FGACTIVE" = 'A'
            ORDER BY upper(cg."RZSOCIAL")
          `);
          return (result.recordset || []).map(normalizarLinha);
        }
        const result = await pool.request().query(`
          SELECT "CDCADASTRO", upper("RZSOCIAL") AS "RZSOCIAL" 
          FROM "CADASTROGERAL" 
          WHERE ("FGPROGRAMADOR" = 'S' OR ("FGPROGRAMADOR" IS NULL AND "FGTIPOCADASTRO" = 'O'))
            AND "FGACTIVE" = 'A' 
          ORDER BY "RZSOCIAL"
        `);
        return (result.recordset || []).map(normalizarLinha);
      };

      const runQueryLegado = async () => {
        const result = await pool.request().query(`
          SELECT "CDCADASTRO", upper("RZSOCIAL") AS "RZSOCIAL" 
          FROM "CADASTROGERAL" 
          WHERE "FGTIPOCADASTRO" = 'O' AND "FGACTIVE" = 'A' 
          ORDER BY "RZSOCIAL"
        `);
        return (result.recordset || []).map(normalizarLinha);
      };

      let rows;
      try {
        rows = await runQueryPrincipal();
      } catch (err) {
        const msg = (err.message || '').toLowerCase();
        if (msg.includes('fgprogramador') || msg.includes('column') && msg.includes('does not exist')) {
          rows = await runQueryLegado();
        } else {
          throw err;
        }
      }

      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar contratadores:', err);
      res.status(500).json({ error: 'Erro ao carregar contratadores.' });
    }
  },

  listarMotivosRecusa: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDMOTIVO], [DSMOTIVO] FROM [dbo].[MOTIVORECUSA] WHERE [FGACTIVE] = \'A\' ORDER BY [DSMOTIVO]');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar motivos de recusa:', err);
      res.status(500).json({ error: 'Erro ao carregar motivos de recusa.' });
    }
  },

  listarMotivosReabertura: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT [CDMOTIVO], [DSMOTIVO] FROM [dbo].[MOTIVOREABERTURA] WHERE [FGACTIVE] = \'A\' ORDER BY [DSMOTIVO]');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar motivos de reabertura:', err);
      res.status(500).json({ error: 'Erro ao carregar motivos de reabertura.' });
    }
  },

  listarRoteiros: async (req, res) => {
    try {
      const { origem, destino, roteiro } = req.query;
      let query = `
        SELECT [r].[IDROTEIRO], [r].[DSROTEIRO], [r].[DISTANCIAKM],
               [r].[CDCIDADEORIGEM] AS ORIGEM_CODIGO,
               [co].[ESTADO] AS ORIGEM_ESTADO, [co].[NMCIDADE] AS ORIGEM_CIDADE,
               [r].[CDCIDADEDESTINO] AS DESTINO_CODIGO,
               [cd].[ESTADO] AS DESTINO_ESTADO, [cd].[NMCIDADE] AS DESTINO_CIDADE
        FROM [dbo].[ROTEIRO] r
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE 1=1
      `;

      const params = [];
      if (origem) {
        query += ` AND [r].[CDCIDADEORIGEM] = @ORIGEM`;
        params.push({ name: 'ORIGEM', value: parseInt(origem) });
      }
      if (destino) {
        query += ` AND [r].[CDCIDADEDESTINO] = @DESTINO`;
        params.push({ name: 'DESTINO', value: parseInt(destino) });
      }
      if (roteiro) {
        query += ` AND [r].[IDROTEIRO] = @ROTEIRO`;
        params.push({ name: 'ROTEIRO', value: parseInt(roteiro) });
      }

      query += ` ORDER BY [r].[IDROTEIRO]`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => {
        // Proteção: garantir que o valor não seja um objeto
        let valor = p.value;
        if (typeof valor === 'object' && valor !== null && !(valor instanceof Date)) {
          console.error(`[BUSCAR VIAGEM] ⚠️ AVISO: Parâmetro ${p.name} é um objeto! Convertendo para string.`, valor);
          valor = JSON.stringify(valor);
        }
        request.input(p.name, valor);
      });

      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar roteiros:', err);
      res.status(500).json({ error: 'Erro ao carregar roteiros.' });
    }
  },

  listarEstadosBrasil: (req, res) => {
    const ESTADOS_BRASIL = [
      { uf: "AC", nome: "Acre" },
      { uf: "AL", nome: "Alagoas" },
      { uf: "AP", nome: "Amapá" },
      { uf: "AM", nome: "Amazonas" },
      { uf: "BA", nome: "Bahia" },
      { uf: "CE", nome: "Ceará" },
      { uf: "DF", nome: "Distrito Federal" },
      { uf: "ES", nome: "Espírito Santo" },
      { uf: "GO", nome: "Goiás" },
      { uf: "MA", nome: "Maranhão" },
      { uf: "MT", nome: "Mato Grosso" },
      { uf: "MS", nome: "Mato Grosso do Sul" },
      { uf: "MG", nome: "Minas Gerais" },
      { uf: "PA", nome: "Pará" },
      { uf: "PB", nome: "Paraíba" },
      { uf: "PR", nome: "Paraná" },
      { uf: "PE", nome: "Pernambuco" },
      { uf: "PI", nome: "Piauí" },
      { uf: "RJ", nome: "Rio de Janeiro" },
      { uf: "RN", nome: "Rio Grande do Norte" },
      { uf: "RS", nome: "Rio Grande do Sul" },
      { uf: "RO", nome: "Rondônia" },
      { uf: "RR", nome: "Roraima" },
      { uf: "SC", nome: "Santa Catarina" },
      { uf: "SP", nome: "São Paulo" },
      { uf: "SE", nome: "Sergipe" },
      { uf: "TO", nome: "Tocantins" }
    ];
    res.json(ESTADOS_BRASIL);
  },

  listarCidadesPorEstado: async (req, res) => {
    try {
      const { estado } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('ESTADO', estado)
        .query('SELECT [CDCIDADE], [NMCIDADE] FROM [dbo].[CIDADE] WHERE [ESTADO] = @ESTADO AND [FGACTIVE] = \'A\' ORDER BY [NMCIDADE]');
      res.json(result.recordset);
    } catch (err) {
      if (err.code === '42P01') {
        return res.json([]);
      }
      console.error('Erro ao carregar cidades por estado:', err);
      res.status(500).json({ error: 'Erro ao carregar cidades.' });
    }
  },

  // Listar viagens com pendências de contratação (sem veículos atribuídos)
  listarViagensPendentes: async (req, res) => {
    try {
      const pool = await poolPromise;
      const query = `
        SELECT 
          [v].[IDVIAGEM],
          [v].[FGSITVIAGEM],
          [v].[CDSITUACAOVIAGEM],
          [s].[DSSITUACAOVIAGEM],
          [v].[CDTIPOVIAGEM],
          [t].[DSTIPOVIAGEM],
          [v].[CDCONTRATADOR],
          upper([cg].[RZSOCIAL]) AS CONTRATADOR_NOME,
          [v].[CDCLASSEFROTA],
          [cf].[DSCLASSEFROTA],
          [v].[FGRASTREADO],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[VLFRETE],
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[CDCIDADE] AS ORIGEM_CODIGO,
          [co].[CDMICROREGIAO] AS ORIGEM_MICROREGIAO,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[CDCIDADE] AS DESTINO_CODIGO,
          [cd].[CDMICROREGIAO] AS DESTINO_MICROREGIAO
        FROM [dbo].[VIAGEMMESTRE] [v]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [s] ON [v].[CDSITUACAOVIAGEM] = [s].[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] [t] ON [v].[CDTIPOVIAGEM] = [t].[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [v].[CDCONTRATADOR] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [v].[FGACTIVE] = 'A'
          AND [v].[FGSITVIAGEM] IN ('P', 'D')
          AND NOT EXISTS (
            SELECT 1 
            FROM [dbo].[CONVOCACAO] [c] 
            WHERE [c].[IDVIAGEM] = [v].[IDVIAGEM] 
              AND [c].[STATUS] IN ('ACEITA', 'CONFIRMADA')
          )
        ORDER BY [v].[DTPREVINICIO] DESC
      `;

      const result = await pool.request().query(query);
      // Normalizar chaves para o frontend (PostgreSQL pode retornar minúsculas)
      const get = (row, ...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null) return row[k];
          const lower = k.toLowerCase();
          if (row[lower] !== undefined && row[lower] !== null) return row[lower];
        }
        return undefined;
      };
      const rows = (result.recordset || []).map(row => ({
        ...row,
        IDVIAGEM: row.IDVIAGEM ?? row.idviagem,
        ORIGEM_ESTADO: get(row, 'ORIGEM_ESTADO'),
        ORIGEM_CIDADE: get(row, 'ORIGEM_CIDADE'),
        DESTINO_ESTADO: get(row, 'DESTINO_ESTADO'),
        DESTINO_CIDADE: get(row, 'DESTINO_CIDADE'),
        DSCLASSEFROTA: row.DSCLASSEFROTA ?? row.dsclassefrota
      }));
      res.json(rows);
    } catch (err) {
      console.error('Erro ao listar viagens pendentes:', err);
      res.status(500).json({ error: 'Erro ao carregar viagens pendentes.' });
    }
  },

  // Buscar motoristas compatíveis com uma viagem
  buscarMotoristasCompatíveis: async (req, res) => {
    try {
      const { idViagem } = req.params;

      if (!idViagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório.' });
      }

      const pool = await poolPromise;

      // Primeiro, buscar os dados da viagem (incluindo contratador)
      const viagemResult = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            [v].[CDCLASSEFROTA],
            [v].[FGRASTREADO],
            [v].[IDROTEIRO],
            [v].[CDCONTRATADOR],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO]
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
          WHERE [v].[IDVIAGEM] = @IDVIAGEM
        `);

      if (viagemResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const viagem = viagemResult.recordset[0];
      const { CDCLASSEFROTA, FGRASTREADO, CDCIDADEORIGEM, CDCIDADEDESTINO, IDROTEIRO, CDCONTRATADOR } = viagem;

      // Buscar micro-regiões E ESTADOS das cidades de origem e destino
      const cidadesResult = await pool
        .request()
        .input('ORIGEM', CDCIDADEORIGEM || null)
        .input('DESTINO', CDCIDADEDESTINO || null)
        .query(`
          SELECT 
            [CDCIDADE],
            [CDMICROREGIAO],
            [CDUF],
            [NMCIDADE],
            [ESTADO]
          FROM [dbo].[CIDADE]
          WHERE [CDCIDADE] IN (@ORIGEM, @DESTINO)
        `);

      const microregioes = cidadesResult.recordset.map(c => ({
        cduf: c.CDUF,
        microregiao: c.CDMICROREGIAO
      })).filter(m => m.microregiao);

      // Buscar motoristas que têm a classe de frota cadastrada na tabela CLASSEFROTA_CG
      // A relação entre motoristas e classes de frota está na tabela CLASSEFROTA_CG, não em EQUIPAMENTO

      let query = `
        SELECT DISTINCT
          [cg].[CDCADASTRO] AS CDCADASTRO_MOTORISTA,
          [cg].[RZSOCIAL] AS NOME_MOTORISTA,
          [cg].[NRCELULAR] AS CELULAR,
          [cg].[ENDEMAIL] AS EMAIL,
          [cg].[CDTRANSPORTADOR],
          [t].[RZSOCIAL] AS TRANSPORTADOR_NOME,
          [t].[NRCELULAR] AS TRANSPORTADOR_CELULAR,
          [c].[CDCIDADE],
          [c].[NMCIDADE] AS CIDADE_NOME,
          [c].[ESTADO] AS CIDADE_ESTADO,
          [c].[CDMICROREGIAO],
          [mr].[DSMICROREGIAO] AS MICROREGIAO_NOME,
          [cfcg].[CDCLASSEFROTA],
          [cf].[DSCLASSEFROTA] AS CLASSE_FROTA_NOME,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] conv 
              WHERE [conv].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO] 
                AND [conv].[IDVIAGEM] = @IDVIAGEM
            ) THEN 1 
            ELSE 0 
          END AS FOI_ACIONADO,
          (
            SELECT COUNT(*) 
            FROM [dbo].[VIAGEMMESTRE] v 
            INNER JOIN [dbo].[VIAGEMMOTORISTA] m ON [v].[IDVIAGEM] = [m].[IDVIAGEM] 
            WHERE [m].[CDMOTORISTA] = [cg].[CDCADASTRO]
          ) AS QTVIAGENS,
          (
            SELECT COUNT(*) 
            FROM [dbo].[VIAGEMMESTRE] v2 
            INNER JOIN [dbo].[VIAGEMMOTORISTA] m2 ON [v2].[IDVIAGEM] = [m2].[IDVIAGEM] 
            WHERE [m2].[CDMOTORISTA] = [cg].[CDCADASTRO]
              AND (@IDROTEIRO = 0 OR [v2].[IDROTEIRO] = @IDROTEIRO)
          ) AS QTVIAGENS_NESTA_ROTA
        FROM [dbo].[CADASTROGERAL] [cg]
        INNER JOIN [dbo].[CIDADE] [c] ON [cg].[CDCIDADE] = [c].[CDCIDADE]
        LEFT JOIN [dbo].[MICROREGIAO] [mr] ON [c].[CDUF] = [mr].[CDUF] AND [c].[CDMICROREGIAO] = [mr].[CDMICROREGIAO]
        INNER JOIN [dbo].[CLASSEFROTA_CG] [cfcg] ON [cg].[CDCADASTRO] = [cfcg].[CDCADASTRO]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [cfcg].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[CADASTROGERAL] [t] ON [cg].[CDTRANSPORTADOR] = [t].[CDCADASTRO]
        LEFT JOIN [dbo].[EMPRESA] [e] ON CAST([t].[CGCCPF] AS TEXT) = CAST([e].[CGCMATRIZ] AS TEXT)
        WHERE (
          [cg].[FGTIPOCADASTRO] IN ('M','A','G','T')
          OR [cg].[FGMOTORISTA] = 'S'
          OR ([cg].[FGMOTORISTA] IS NULL AND [cg].[FGTIPOCADASTRO] = 'M')
          OR COALESCE([cg].[FGAGENTE], 'N') = 'S'
          OR COALESCE([cg].[FGGRUPO], 'N') = 'S'
          OR COALESCE([cg].[FGTRANSPORTADOR], 'N') = 'S'
        )
          AND [cg].[FGACTIVE] = 'A'
          AND [cfcg].[FGACTIVE] = 'S'
          AND [cfcg].[CDCLASSEFROTA] = @CDCLASSEFROTA
      `;

      const request = pool.request();
      // Adicionar IDVIAGEM para o JOIN com CONVOCACAO
      request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      
      // Adicionar IDROTEIRO para buscar motoristas experientes nesta rota (0 = não filtrar por rota)
      request.input('IDROTEIRO', sql.Int, IDROTEIRO ? parseInt(IDROTEIRO) : 0);

      // A classe de frota na tabela CLASSEFROTA_CG parece ser SmallInt, não Decimal
      if (CDCLASSEFROTA) {
        const classeFrotaNum = parseInt(CDCLASSEFROTA);
        request.input('CDCLASSEFROTA', sql.SmallInt, classeFrotaNum);
      } else {
        return res.status(400).json({ error: 'Classe de frota não informada na viagem.' });
      }

      // Aplicar filtros comuns
      // Filtro de rastreado
      if (FGRASTREADO === 'S') {
        query += ` AND COALESCE([cg].[FGRASTREADO], 'N') = 'S'`;
      }

      // Regra de negócio: compatíveis são listados apenas por TIPO + CLASSE FROTA + RASTREADO.
      // Localização (cidade/micro-região) NÃO é critério obrigatório para aparecer na lista.
      // Assim, todos que têm a classe da viagem e atendem rastreado (se exigido) são listados.

      // Ordenar por: Experiência na rota DESC → Experiência geral DESC → Nome
      query += ` ORDER BY QTVIAGENS_NESTA_ROTA DESC, QTVIAGENS DESC, [cg].[RZSOCIAL]`;

      // Verificações de diagnóstico
      // Verificar motoristas na micro-região (apenas se houver micro-regiões)
      if (microregioes.length > 0) {
        try {
          // Extrair apenas os valores numéricos de microregiao
          const valoresMicro = microregioes.map(m => {
            const valor = typeof m === 'object' && m !== null ? m.microregiao : m;
            return typeof valor === 'number' ? valor : parseInt(valor) || 0;
          }).filter(v => v > 0);

          if (valoresMicro.length > 0) {
            const diagMotoristasMicro = await pool.request().query(`
              SELECT COUNT(*) AS TOTAL
              FROM [dbo].[CADASTROGERAL] [cg]
              INNER JOIN [dbo].[CIDADE] [c] ON [cg].[CDCIDADE] = [c].[CDCIDADE]
              WHERE ( [cg].[FGTIPOCADASTRO] IN ('M','A','G','T') OR ( [cg].[FGMOTORISTA] = 'S' OR ([cg].[FGMOTORISTA] IS NULL AND [cg].[FGTIPOCADASTRO] = 'M') ) OR COALESCE([cg].[FGAGENTE], 'N') = 'S' OR COALESCE([cg].[FGGRUPO], 'N') = 'S' OR COALESCE([cg].[FGTRANSPORTADOR], 'N') = 'S' )
                AND [cg].[FGACTIVE] = 'A'
                AND [c].[CDMICROREGIAO] IN (${valoresMicro.join(', ')})
            `);
          }
        } catch (diagErr) {
          // Ignorar erros de diagnóstico, não são críticos
          console.warn('Erro na query de diagnóstico (não crítico):', diagErr.message);
        }
      }

      // Logs de debug removidos

      const result = await request.query(query);
      const raw = result.recordset || [];

      // Normalizar chaves: PostgreSQL devolve em minúsculas; frontend espera MAIÚSCULAS_COM_UNDERSCORE
      const recordset = raw.map(row => {
        const get = (key) => (row[key] != null ? row[key] : row[key.toLowerCase()]);
        return {
          CDCADASTRO_MOTORISTA: get('CDCADASTRO_MOTORISTA'),
          NOME_MOTORISTA: get('NOME_MOTORISTA'),
          CELULAR: get('CELULAR'),
          EMAIL: get('EMAIL'),
          CDTRANSPORTADOR: get('CDTRANSPORTADOR'),
          TRANSPORTADOR_NOME: get('TRANSPORTADOR_NOME'),
          TRANSPORTADOR_CELULAR: get('TRANSPORTADOR_CELULAR'),
          CDCIDADE: get('CDCIDADE'),
          CIDADE_NOME: get('CIDADE_NOME'),
          CIDADE_ESTADO: get('CIDADE_ESTADO'),
          CDMICROREGIAO: get('CDMICROREGIAO'),
          MICROREGIAO_NOME: get('MICROREGIAO_NOME'),
          CDCLASSEFROTA: get('CDCLASSEFROTA'),
          CLASSE_FROTA_NOME: get('CLASSE_FROTA_NOME'),
          FOI_ACIONADO: get('FOI_ACIONADO'),
          QTVIAGENS: get('QTVIAGENS'),
          QTVIAGENS_NESTA_ROTA: get('QTVIAGENS_NESTA_ROTA'),
        };
      });

      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Compatíveis] Viagem ${idViagem}: ${recordset.length} registro(s) retornado(s).`);
      }

      res.json(recordset);
    } catch (err) {
      console.error('Erro ao buscar motoristas compatíveis:', err);
      console.error('Stack trace:', err.stack);
      if (err.message) console.error('Mensagem do erro:', err.message);
      if (err.originalError && err.originalError.message) console.error('Erro original:', err.originalError.message);
      res.status(500).json({ 
        error: 'Erro ao buscar motoristas compatíveis.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Criar convocações para motoristas selecionados
  criarConvocacoes: async (req, res) => {
    try {
      const { idViagem, motoristas } = req.body;

      if (!idViagem || !motoristas || !Array.isArray(motoristas) || motoristas.length === 0) {
        return res.status(400).json({ error: 'Dados inválidos. É necessário informar a viagem e pelo menos um motorista.' });
      }

      // Obter login do usuário logado do header
      const userLogin = req.headers['user-login'];

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para criar convocações.' });
      }

      // Validar se o usuário existe e está ativo
      const pool = await poolPromise;
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível criar convocações.' });
      }

      const usuarioOperador = userLogin;

      // Buscar próximo ID de convocação
      const maxResult = await pool
        .request()
        .query('SELECT COALESCE(MAX([IDCONVOCACAO]), 0) + 1 AS [maxId] FROM [dbo].[CONVOCACAO]');
      let proximoId = getFirstNumericValue(maxResult.recordset, 1);

      // Inserir convocações (verificando duplicatas)
      const convocacoes = [];
      for (const motorista of motoristas) {
        const {
          CDCADASTRO_MOTORISTA,
          NRCELULAR,
          TXTCONVOCACAO,
          LINKCONVOCACAO
        } = motorista;

        // Verificar se já existe convocação para este motorista e viagem
        const verificarDuplicata = await pool
          .request()
          .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
          .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), CDCADASTRO_MOTORISTA)
          .query(`
            SELECT TOP 1 
              [IDCONVOCACAO],
              [NRCELULAR],
              [TXTCONVOCACAO],
              [LINKCONVOCACAO],
              [STATUS]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM
              AND [CDCADASTRO_MOTORISTA] = @CDCADASTRO_MOTORISTA
            ORDER BY [DHCONVOCACAO] DESC
          `);

        if (verificarDuplicata.recordset.length > 0) {
          // Já existe convocação - reutilizar a existente
          const convocacaoExistente = verificarDuplicata.recordset[0];
          convocacoes.push({
            IDCONVOCACAO: convocacaoExistente.IDCONVOCACAO,
            IDVIAGEM: idViagem,
            CDCADASTRO_MOTORISTA,
            NRCELULAR: convocacaoExistente.NRCELULAR || NRCELULAR || null,
            TXTCONVOCACAO: convocacaoExistente.TXTCONVOCACAO || TXTCONVOCACAO || null,
            LINKCONVOCACAO: convocacaoExistente.LINKCONVOCACAO || LINKCONVOCACAO || null,
            STATUS: convocacaoExistente.STATUS,
            REUTILIZADA: true
          });
          continue; // Pular criação de nova convocação
        }

        // Não existe - criar nova convocação (colunas entre colchetes para PostgreSQL)
        const request = pool.request()
          .input('IDCONVOCACAO', sql.Int, proximoId)
          .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
          .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), CDCADASTRO_MOTORISTA)
          .input('STATUS', sql.VarChar(20), 'PENDENTE')
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), usuarioOperador);

        // Adicionar campos opcionais se fornecidos (colunas entre colchetes para db.js → "COL" no PG)
        let camposInsert = '[IDCONVOCACAO], [IDVIAGEM], [CDCADASTRO_MOTORISTA], [STATUS], [DHCONVOCACAO], [SGUSUARIO_OPERADOR], [DHMAINTENANCE], [SGUSER], [SERVERORIG]';
        let valoresInsert = '@IDCONVOCACAO, @IDVIAGEM, @CDCADASTRO_MOTORISTA, @STATUS, GETDATE(), @SGUSUARIO_OPERADOR, GETDATE(), \'SYSTEM\', \'AppDVcargas\'';

        if (NRCELULAR !== undefined && NRCELULAR !== null) {
          camposInsert += ', [NRCELULAR]';
          valoresInsert += ', @NRCELULAR';
          request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
        }

        if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null) {
          camposInsert += ', [TXTCONVOCACAO]';
          valoresInsert += ', @TXTCONVOCACAO';
          request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
        }

        if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null) {
          camposInsert += ', [LINKCONVOCACAO]';
          valoresInsert += ', @LINKCONVOCACAO';
          request.input('LINKCONVOCACAO', sql.VarChar(500), LINKCONVOCACAO);
        }

        await request.query(`
          INSERT INTO [dbo].[CONVOCACAO] (${camposInsert})
          VALUES (${valoresInsert})
        `);

        convocacoes.push({
          IDCONVOCACAO: proximoId,
          IDVIAGEM: idViagem,
          CDCADASTRO_MOTORISTA,
          NRCELULAR: NRCELULAR || null,
          TXTCONVOCACAO: TXTCONVOCACAO || null,
          LINKCONVOCACAO: LINKCONVOCACAO || null,
          REUTILIZADA: false
        });

        proximoId++;
      }

      const novas = convocacoes.filter(c => !c.REUTILIZADA).length;
      const reutilizadas = convocacoes.filter(c => c.REUTILIZADA).length;

      let mensagem = '';
      if (novas > 0 && reutilizadas > 0) {
        mensagem = `${novas} convocação(ões) criada(s) e ${reutilizadas} reutilizada(s) (evitando duplicatas).`;
      } else if (novas > 0) {
        mensagem = `${novas} convocação(ões) criada(s) com sucesso!`;
      } else if (reutilizadas > 0) {
        mensagem = `${reutilizadas} convocação(ões) reutilizada(s) (já existiam no banco).`;
      }

      res.status(201).json({
        success: true,
        message: mensagem,
        convocacoes,
        novas,
        reutilizadas
      });
    } catch (err) {
      console.error('Erro ao criar convocações:', err);
      console.error('Detalhes do erro:', {
        message: err.message,
        code: err.code,
        originalError: err.originalError?.message,
        lineNumber: err.originalError?.info?.lineNumber
      });
      res.status(500).json({
        error: 'Erro ao criar convocações.',
        details: err.message
      });
    }
  },

  // Listar convocações com filtros
  listarConvocacoes: async (req, res) => {
    try {
      const { idViagem, status, cdcadastroMotorista } = req.query;
      const pool = await poolPromise;
      let query = `
        SELECT 
          [c].[IDCONVOCACAO],
          [c].[IDVIAGEM],
          [c].[CDCADASTRO_MOTORISTA],
          [c].[STATUS],
          [c].[DHCONVOCACAO],
          [c].[DHACESSO],
          [c].[DHRESPOSTA],
          [c].[SGUSUARIO_OPERADOR],
          [c].[LATITUDE],
          [c].[LONGITUDE],
          [c].[CDMOTIVORECUSA],
          [mr].[DSMOTIVO] AS MOTIVO_RECUSA,
          [c].[CDMOTIVOREABERTURA],
          [mra].[DSMOTIVO] AS MOTIVO_REABERTURA,
          [v].[IDROTEIRO],
          [v].[CDCLASSEFROTA],
          [v].[DTPREVINICIO],
          [v].[DTPREVFINAL],
          [v].[FGRASTREADO],
          [v].[VLFRETE],
          [v].[PESO],
          [v].[CUBAGEM],
          upper([cg].[RZSOCIAL]) AS NOME_MOTORISTA,
          [cg].[NRCELULAR] AS CELULAR_MOTORISTA,
          [cf].[DSCLASSEFROTA],
          [r].[CDCIDADEORIGEM],
          [r].[CDCIDADEDESTINO],
          [r].[DSROTEIRO],
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[ESTADO] AS DESTINO_ESTADO,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] [c2] 
              WHERE [c2].[IDVIAGEM] = [c].[IDVIAGEM] 
                AND [c2].[STATUS] = 'CONFIRMADA'
                AND [c2].[IDCONVOCACAO] != [c].[IDCONVOCACAO]
            ) THEN 1 
            ELSE 0 
          END AS VIAGEM_JA_CONFIRMADA
        FROM [dbo].[CONVOCACAO] [c]
        INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [c].[IDVIAGEM] = [v].[IDVIAGEM]
        INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [c].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[MOTIVORECUSA] [mr] ON [c].[CDMOTIVORECUSA] = [mr].[CDMOTIVO]
          LEFT JOIN [dbo].[MOTIVOREABERTURA] [mra] ON [c].[CDMOTIVOREABERTURA] = [mra].[CDMOTIVO]
          WHERE 1=1
      `;

      const request = pool.request();

      if (idViagem) {
        query += ` AND [c].[IDVIAGEM] = @IDVIAGEM`;
        request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      }

      if (status) {
        query += ` AND [c].[STATUS] = @STATUS`;
        request.input('STATUS', sql.VarChar(20), status);
      }

      if (cdcadastroMotorista) {
        query += ` AND [c].[CDCADASTRO_MOTORISTA] = @CDCADASTRO_MOTORISTA`;
        request.input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), parseFloat(cdcadastroMotorista));
      }

      query += ` ORDER BY [c].[DHCONVOCACAO] DESC`;

      const result = await request.query(query);
      // Normalizar chaves para maiúsculas (PostgreSQL retorna minúsculas em aliases sem aspas)
      const recordset = (result.recordset || []).map((row) => {
        const r = { ...row };
        const map = {
          nome_motorista: 'NOME_MOTORISTA',
          celular_motorista: 'CELULAR_MOTORISTA',
          dsmotivo_recusa: 'MOTIVO_RECUSA',
          dsmotivo_reabertura: 'MOTIVO_REABERTURA',
          dsclassefrota: 'DSCLASSEFROTA',
          dsroteiro: 'DSROTEIRO',
          origem_cidade: 'ORIGEM_CIDADE',
          origem_estado: 'ORIGEM_ESTADO',
          destino_cidade: 'DESTINO_CIDADE',
          destino_estado: 'DESTINO_ESTADO',
          viagem_ja_confirmada: 'VIAGEM_JA_CONFIRMADA',
          idviagem: 'IDVIAGEM',
          idroteiro: 'IDROTEIRO',
          cdcadastro_motorista: 'CDCADASTRO_MOTORISTA',
        };
        Object.keys(map).forEach((k) => {
          if (r[k] !== undefined && r[map[k]] === undefined) r[map[k]] = r[k];
        });
        return r;
      });
      res.json(recordset);
    } catch (err) {
      console.error('Erro ao listar convocações:', err);
      res.status(500).json({ error: 'Erro ao listar convocações.' });
    }
  },

  // Buscar convocação por ID (para gerenciamento)
  buscarConvocacaoPorId: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT 
            [c].[IDCONVOCACAO],
            [c].[IDVIAGEM],
            [c].[CDCADASTRO_MOTORISTA],
            [c].[STATUS],
            [c].[DHCONVOCACAO],
            [c].[DHRESPOSTA],
            [c].[SGUSUARIO_OPERADOR],
            [c].[DHENVIOMETA],
            [v].[CDCLASSEFROTA],
            [v].[DTPREVINICIO],
            [v].[DTPREVFINAL],
            [v].[FGRASTREADO],
            [v].[OBSERV],
            upper([cg].[RZSOCIAL]) AS NOME_MOTORISTA,
            [cg].[NRCELULAR] AS CELULAR_MOTORISTA,
            [cf].[DSCLASSEFROTA],
            [r].[CDCIDADEORIGEM],
            [r].[CDCIDADEDESTINO],
            [co].[NMCIDADE] AS ORIGEM_CIDADE,
            [co].[ESTADO] AS ORIGEM_ESTADO,
            [cd].[NMCIDADE] AS DESTINO_CIDADE,
            [cd].[ESTADO] AS DESTINO_ESTADO
          FROM [dbo].[CONVOCACAO] [c]
          INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [c].[IDVIAGEM] = [v].[IDVIAGEM]
          INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [c].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]
          LEFT JOIN [dbo].[CLASSEFROTA] [cf] ON [v].[CDCLASSEFROTA] = [cf].[CDCLASSEFROTA]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          WHERE [c].[IDCONVOCACAO] = @IDCONVOCACAO
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      res.json(result.recordset[0]);
    } catch (err) {
      console.error('Erro ao buscar convocação:', err);
      res.status(500).json({ error: 'Erro ao buscar convocação.' });
    }
  },

  // Atualizar convocação com texto e link
  atualizarConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { NRCELULAR, TXTCONVOCACAO, LINKCONVOCACAO } = req.body;

      if (!id) {
        return res.status(400).json({ error: 'ID da convocação não informado.' });
      }

      const pool = await poolPromise;
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id));

      let updates = [];

      if (NRCELULAR !== undefined && NRCELULAR !== null && NRCELULAR !== '') {
        updates.push('[NRCELULAR] = @NRCELULAR');
        request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
      }

      if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null && TXTCONVOCACAO !== '') {
        updates.push('[TXTCONVOCACAO] = @TXTCONVOCACAO');
        request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
      }

      if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null && LINKCONVOCACAO !== '') {
        updates.push('[LINKCONVOCACAO] = @LINKCONVOCACAO');
        request.input('LINKCONVOCACAO', sql.VarChar(500), LINKCONVOCACAO);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar foi informado.' });
      }

      updates.push('[DHMAINTENANCE] = GETDATE()');

      const query = `
        UPDATE [dbo].[CONVOCACAO]
        SET ${updates.join(', ')}
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `;

      const result = await request.query(query);

      res.json({
        success: true,
        message: 'Convocação atualizada com sucesso!',
        rowsAffected: result.rowsAffected[0]
      });
    } catch (err) {
      console.error('[ATUALIZAR CONVOCACAO] Erro ao atualizar convocação:', err);
      res.status(500).json({
        error: 'Erro ao atualizar convocação.',
        details: err.message
      });
    }
  },

  // Atualizar campo DHENVIOMETA após envio para webhook
  atualizarEnvioMeta: async (req, res) => {
    try {
      const { id } = req.params;

      if (!id) {
        return res.status(400).json({ error: 'ID da convocação não informado.' });
      }

      const pool = await poolPromise;

      await pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET [DHENVIOMETA] = GETDATE(),
              [DHMAINTENANCE] = GETDATE()
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `);

      res.json({
        success: true,
        message: 'Campo DHENVIOMETA atualizado com sucesso!'
      });
    } catch (err) {
      console.error('[ATUALIZAR ENVIO META] Erro ao atualizar DHENVIOMETA:', err);
      res.status(500).json({
        error: 'Erro ao atualizar DHENVIOMETA.',
        details: err.message
      });
    }
  },

  // Atualizar status da convocação
  atualizarStatusConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório.' });
      }

      const sgUserConv = getSgUser(req);
      if (!sgUserConv) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('STATUS', sql.VarChar(20), status)
        .input('sgUser', sql.VarChar(50), sgUserConv)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET [STATUS] = @STATUS,
              [DHRESPOSTA] = CASE WHEN @STATUS IN ('ACEITA', 'RECUSADA') THEN GETDATE() ELSE [DHRESPOSTA] END,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = @sgUser
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `);

      res.json({ success: true, message: 'Status da convocação atualizado com sucesso!' });
    } catch (err) {
      console.error('Erro ao atualizar status da convocação:', err);
      res.status(500).json({ error: 'Erro ao atualizar status da convocação.' });
    }
  },

  // Confirmar convocação (muda para CONFIRMADA e recusa todas as outras da mesma viagem)
  confirmarConvocacao: async (req, res) => {
    let transaction = null;
    try {
      const { id } = req.params;
      const userLogin = req.headers['user-login'] || (req.user && (req.user.login || req.user.SGUSUARIO));
      const sgUserConfirm = getSgUser(req);
      if (!sgUserConfirm) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      console.log(`[CONFIRMAR] Iniciando confirmação da convocação ${id} pelo usuário ${userLogin}`);

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para confirmar convocações.' });
      }

      const pool = await poolPromise;

      // Validar usuário existe e está ativo
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível confirmar convocações.' });
      }

      // Primeiro, buscar a convocação para obter o IDVIAGEM
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `);

      if (convocacaoResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = convocacaoResult.recordset[0];

      // Validar se a convocação está ACEITA
      if (convocacao.STATUS !== 'ACEITA') {
        return res.status(400).json({
          error: 'Apenas convocações com status ACEITA podem ser confirmadas.'
        });
      }

      // Verificar se já existe outra convocação CONFIRMADA para a mesma viagem
      const confirmadaResult = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), convocacao.IDVIAGEM)
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT [IDCONVOCACAO]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDVIAGEM] = @IDVIAGEM
            AND [STATUS] = 'CONFIRMADA'
            AND [IDCONVOCACAO] != @IDCONVOCACAO
        `);

      if (confirmadaResult.recordset.length > 0) {
        return res.status(400).json({
          error: 'Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.'
        });
      }

      // Iniciar transação para garantir atomicidade (após todas as validações)
      transaction = await createTransaction(pool);
      await transaction.begin();
      console.log(`[CONFIRMAR] Transação iniciada para convocação ${id}`);

      try {
        // 1. Confirmar a convocação selecionada
        const request1 = transaction.request();
        await request1
          .input('IDCONVOCACAO_CONFIRM', sql.Int, parseInt(id))
          .input('SGUSUARIO_OPERADOR_CONFIRM', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserConfirm)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'CONFIRMADA',
                [DHRESPOSTA] = GETDATE(),
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_CONFIRM,
                [DHMAINTENANCE] = GETDATE(),
                [SGUSER] = @sgUser
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_CONFIRM
          `);

        // 2. NÃO recusar convocações PENDENTES automaticamente
        // Apenas manter como PENDENTE - não alterar status de quem não respondeu
        // Isso preserva o histórico correto: só marca como RECUSADA se o motorista realmente recusou

        // 3. Marcar outras convocações ACEITAS como DESCARTADAS (mantém histórico de aceite)
        const request3 = transaction.request();
        await request3
          .input('IDVIAGEM_DESCARTAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_EXCLUIR_DESC', sql.Int, parseInt(id))
          .input('SGUSUARIO_OPERADOR_DESC', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserConfirm)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'ACEITA_DESCARTADA',
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_DESC,
                [DHMAINTENANCE] = GETDATE(),
                [SGUSER] = @sgUser
            WHERE [IDVIAGEM] = @IDVIAGEM_DESCARTAR
              AND [IDCONVOCACAO] != @IDCONVOCACAO_EXCLUIR_DESC
              AND [STATUS] = 'ACEITA'
          `);

        await transaction.commit();
        console.log(`[CONFIRMAR] Transação commitada com sucesso para convocação ${id}`);

        // Emitir evento WebSocket para atualização de viagem (motorista atribuído)
        try {
          const websocketTorre = req.app.get('websocketTorre');
          if (websocketTorre && convocacao.IDVIAGEM) {
            // Buscar dados atualizados da viagem com motorista confirmado
            const viagemAtualizada = await pool
              .request()
              .input('IDVIAGEM', sql.Decimal(15, 0), convocacao.IDVIAGEM)
              .query(`
                SELECT 
                  v.[IDVIAGEM],
                  v.[FGSITVIAGEM],
                  v.[CDSITUACAOVIAGEM],
                  s.[DSSITUACAOVIAGEM],
                  v.[CDTIPOVIAGEM],
                  t.[DSTIPOVIAGEM],
                  v.[FGACTIVE],
                  v.[CDCLASSEFROTA],
                  cf.[DSCLASSEFROTA],
                  v.[DTPREVINICIO],
                  v.[DTPREVFINAL],
                  v.[IDROTEIRO],
                  r.[DSROTEIRO],
                  v.[DISTANCIAKM],
                  v.[VLFRETE],
                  co.[ESTADO] AS ORIGEM_ESTADO,
                  co.[NMCIDADE] AS ORIGEM_CIDADE,
                  cd.[ESTADO] AS DESTINO_ESTADO,
                  cd.[NMCIDADE] AS DESTINO_CIDADE,
                  cg.[CDCADASTRO] AS CDMOTORISTA,
                  upper(cg.[RZSOCIAL]) AS MOTORISTA_NOME,
                  cg.[NRCELULAR] AS MOTORISTA_CELULAR,
                  'S' AS TEM_CONFIRMADO
                FROM [dbo].[VIAGEMMESTRE] v
                LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON v.[CDSITUACAOVIAGEM] = s.[CDSITUACAOVIAGEM]
                LEFT JOIN [dbo].[TIPOVIAGEM] t ON v.[CDTIPOVIAGEM] = t.[CDTIPOVIAGEM]
                LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
                LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
                LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
                LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
                LEFT JOIN [dbo].[CONVOCACAO] c ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[STATUS] = 'CONFIRMADA'
                LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO]
                WHERE v.[IDVIAGEM] = @IDVIAGEM
              `);

            if (viagemAtualizada.recordset && viagemAtualizada.recordset[0]) {
              const dadosViagem = viagemAtualizada.recordset[0];
              websocketTorre.emitirAtualizacaoViagem(convocacao.IDVIAGEM, dadosViagem);
              console.log(`📡 Evento WebSocket emitido: viagem ${convocacao.IDVIAGEM} atualizada (motorista confirmado)`);
            }
          }
        } catch (wsError) {
          // Não interromper resposta se WebSocket falhar
          console.warn('⚠️ Erro ao emitir evento WebSocket de confirmação:', wsError.message);
        }

        // Buscar dados do motorista confirmado para enviar WhatsApp
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .query(`
            SELECT 
              upper(cg.[RZSOCIAL]) AS NOME_MOTORISTA,
              cg.[NRCELULAR],
              v.[IDVIAGEM],
              v.[DTPREVINICIO],
              v.[DTPREVFINAL],
              v.[CDCONTRATADOR],
              co.[NMCIDADE] AS ORIGEM_CIDADE,
              co.[ESTADO] AS ORIGEM_ESTADO,
              cd.[NMCIDADE] AS DESTINO_CIDADE,
              cd.[ESTADO] AS DESTINO_ESTADO,
              r.[DSROTEIRO],
              upper(contratador.[RZSOCIAL]) AS CONTRATADOR_NOME,
              contratador.[NRCELULAR] AS CONTRATADOR_CELULAR
            FROM [dbo].[CONVOCACAO] c
            INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO]
            INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
            LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
            LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
            LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.[CDCONTRATADOR] = contratador.[CDCADASTRO]
            WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO_MOT
          `);

        // Contar quantas foram afetadas para mensagem
        const countAceitasDescartadas = await pool
          .request()
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM_COUNT
              AND [IDCONVOCACAO] != @IDCONVOCACAO_COUNT
              AND [STATUS] = 'ACEITA_DESCARTADA'
          `);

        let mensagem = `Convocação ${id} confirmada com sucesso!`;
        const aceitasDescartadas = countAceitasDescartadas.recordset[0]?.TOTAL || 0;

        if (aceitasDescartadas > 0) {
          mensagem += `\n\n${aceitasDescartadas} convocação(ões) ACEITA(S) marcada(s) como "Não Selecionada" (histórico preservado).`;
        }

        // Nota: Convocações PENDENTE permanecem como PENDENTE para preservar o histórico correto
        // Apenas convocações realmente RECUSADAS pelo motorista ficam como RECUSADA

        // Preparar dados para envio de WhatsApp (será feito no frontend)
        const motorista = motoristaResult.recordset[0];
        let whatsappLink = null;
        let textoMensagem = null; // Inicializar variável

        if (motorista && motorista.NRCELULAR) {
          const celularFormatado = motorista.NRCELULAR.toString().replace(/\D/g, '');
          if (celularFormatado.length >= 10) {
            // Formatar datas (SQL Server retorna como string ISO)
            const formatarDataHora = (dataHora) => {
              if (!dataHora) return 'Não informado';

              try {
                // SQL Server retorna no formato: 2026-11-21T10:39:24.123Z ou 2026-11-21 10:39:24.123
                let dataStr = String(dataHora).replace('Z', '').replace('T', ' ');
                const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):?(\d{2})?/);

                if (match) {
                  const [, year, month, day, hour, minute] = match;
                  // Formatar manualmente para evitar problemas de timezone
                  return `${day}/${month}/${year} ${hour}:${minute}`;
                }

                // Fallback: extrair componentes UTC e tratar como local (sem conversão de fuso)
                const d = new Date(dataHora);
                if (isNaN(d.getTime())) return 'Data inválida';

                // Extrair componentes UTC e tratar como local (sem conversão de fuso)
                const ano = d.getUTCFullYear();
                const mes = d.getUTCMonth();
                const dia = d.getUTCDate();
                const hora = d.getUTCHours();
                const minuto = d.getUTCMinutes();

                // Formatar manualmente para pt-BR
                const diaStr = String(dia).padStart(2, '0');
                const mesStr = String(mes + 1).padStart(2, '0');
                const anoStr = ano;
                const horaStr = String(hora).padStart(2, '0');
                const minutoStr = String(minuto).padStart(2, '0');

                return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
              } catch (err) {
                return 'Data inválida';
              }
            };

            // Formatar telefone do contratador
            const formatarTelefone = (telefone) => {
              if (!telefone) return null;
              const tel = telefone.toString().replace(/\D/g, '');
              if (tel.length === 11) {
                return `(${tel.substring(0, 2)}) ${tel.substring(2, 7)}-${tel.substring(7)}`;
              } else if (tel.length === 10) {
                return `(${tel.substring(0, 2)}) ${tel.substring(2, 6)}-${tel.substring(6)}`;
              }
              return telefone.toString();
            };

            const contratadorNome = motorista.CONTRATADOR_NOME || null;
            const contratadorCelular = motorista.CONTRATADOR_CELULAR ? formatarTelefone(motorista.CONTRATADOR_CELULAR) : null;
            const contratadorCelularWhatsApp = motorista.CONTRATADOR_CELULAR ? motorista.CONTRATADOR_CELULAR.toString().replace(/\D/g, '') : null;

            // Mensagem de confirmação padronizada
            const nomeMotorista = motorista.NOME_MOTORISTA || 'Motorista';
            let textoMensagem = `🎉 *PARABÉNS! Você foi selecionado!*\n\n` +
              `Olá *${nomeMotorista.toUpperCase()}*,\n\n` +
              `Temos uma ótima notícia! Você foi *SELECIONADO* para realizar a viagem:\n\n` +
              `🆔 *ID da Viagem:* ${motorista.IDVIAGEM}\n` +
              `🗺️ *Rota:* ${motorista.DSROTEIRO || `${motorista.ORIGEM_CIDADE}/${motorista.ORIGEM_ESTADO} → ${motorista.DESTINO_CIDADE}/${motorista.DESTINO_ESTADO}`}\n` +
              `📅 *Carregamento:* ${formatarDataHora(motorista.DTPREVINICIO)}\n` +
              `📅 *Descarga:* ${formatarDataHora(motorista.DTPREVFINAL)}\n\n` +
              `✅ *Sua convocação foi CONFIRMADA!*\n\n` +
              `Por favor, entre em contato conosco para os próximos passos.\n\n`;

            // Adicionar contato do contratador se disponível
            if (contratadorNome || contratadorCelular) {
              textoMensagem += `📞 *Entre em Contato:*\n`;
              if (contratadorNome) {
                textoMensagem += `*${contratadorNome}*\n`;
              }
              if (contratadorCelular) {
                textoMensagem += `📱 ${contratadorCelular}\n`;
              }
              textoMensagem += `\n`;
            }

            textoMensagem += `Aguardamos seu retorno! 🚛`;

            whatsappLink = `https://wa.me/55${celularFormatado}?text=${encodeURIComponent(textoMensagem)}`;
          }
        }

        // Garantir que textoMensagem está definido
        if (!textoMensagem && motorista && motorista.NRCELULAR) {
          // Se não foi criado mas tem celular, criar mensagem básica
          const nomeMotorista = motorista.NOME_MOTORISTA || 'Motorista';
          textoMensagem = `🎉 *PARABÉNS! Você foi selecionado!*\n\n` +
            `Olá *${nomeMotorista.toUpperCase()}*,\n\n` +
            `Temos uma ótima notícia! Você foi *SELECIONADO* para realizar a viagem:\n\n` +
            `🆔 *ID da Viagem:* ${motorista.IDVIAGEM}\n\n` +
            `✅ *Sua convocação foi CONFIRMADA!*\n\n` +
            `Por favor, entre em contato conosco para os próximos passos.\n\n` +
            `Aguardamos seu retorno! 🚛`;
        }

        res.json({
          success: true,
          message: mensagem,
          whatsappLink: whatsappLink,
          mensagemConfirmacao: textoMensagem || null,
          motorista: motorista ? {
            nome: motorista.NOME_MOTORISTA,
            celular: motorista.NRCELULAR
          } : null
        });
      } catch (err) {
        const idConv = req.params && req.params.id;
        console.error(`[CONFIRMAR] Erro na transação para convocação ${idConv}:`, err);
        if (transaction) {
          await transaction.rollback().catch(rollbackErr => {
            console.error(`[CONFIRMAR] Erro ao fazer rollback:`, rollbackErr);
          });
        }
        throw err;
      }
    } catch (err) {
      const idConv = req.params && req.params.id;
      if (transaction) {
        await transaction.rollback().catch(() => {
          // Ignorar erro se já foi feito rollback
        });
      }
      console.error(`[CONFIRMAR] Erro ao confirmar convocação ${idConv}:`, err);
      console.error(`[CONFIRMAR] Stack trace:`, err.stack);
      res.status(500).json({
        error: 'Erro ao confirmar convocação.',
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  },

  // Buscar convocação pública (para motorista acessar)
  buscarConvocacaoPublica: async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`[CONVOCACAO PUBLICA] Buscando convocação ID: ${id}`);

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({ error: 'ID de convocação inválido.' });
      }

      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT 
            c.[IDCONVOCACAO],
            c.[IDVIAGEM],
            c.[STATUS],
            c.[DHCONVOCACAO],
            c.[DHACESSO],
            v.[CDCLASSEFROTA],
            v.[DTPREVINICIO],
            v.[DTPREVFINAL],
            v.[FGRASTREADO],
            v.[OBSERV],
            v.[VLFRETE],
            v.[PESO],
            v.[CUBAGEM],
            upper(cg.[RZSOCIAL]) AS NOME_MOTORISTA,
            cg.[NRCELULAR],
            cf.[DSCLASSEFROTA],
            r.[CDCIDADEORIGEM],
            r.[CDCIDADEDESTINO],
            co.[NMCIDADE] AS ORIGEM_CIDADE,
            co.[ESTADO] AS ORIGEM_ESTADO,
            cd.[NMCIDADE] AS DESTINO_CIDADE,
            cd.[ESTADO] AS DESTINO_ESTADO,
            tv.[DSTIPOVIAGEM],
            v.[CDCONTRATADOR],
            upper(contratador.[RZSOCIAL]) AS CONTRATADOR_NOME,
            contratador.[NRCELULAR] AS CONTRATADOR_CELULAR,
            r.[DSROTEIRO],
            CASE 
              WHEN EXISTS (
                SELECT 1 
                FROM [dbo].[CONVOCACAO] c2 
                WHERE c2.[IDVIAGEM] = c.[IDVIAGEM] 
                  AND c2.[STATUS] = 'CONFIRMADA'
                  AND c2.[IDCONVOCACAO] != c.[IDCONVOCACAO]
              ) THEN 1 
              ELSE 0 
            END AS VIAGEM_JA_CONFIRMADA
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM]
          INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO]
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
          LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
          LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.[CDCONTRATADOR] = contratador.[CDCADASTRO] 
            AND contratador.[FGACTIVE] = 'A'
          WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = result.recordset[0];

      // Debug: Se o contratador não foi encontrado no JOIN, tentar buscar diretamente
      // Isso pode acontecer se o contratador estiver inativo ou se houver algum problema no JOIN
      if (!convocacao.CONTRATADOR_NOME && convocacao.CDCONTRATADOR) {
        console.log('[DEBUG CONTRATADOR] Contratador não encontrado no JOIN. CDCONTRATADOR:', convocacao.CDCONTRATADOR);
        // Tentar buscar o contratador diretamente (primeiro ativo, depois qualquer um para debug)
        try {
          // Primeiro tentar buscar apenas ativos
          let contratadorResult = await pool
            .request()
            .input('CDCONTRATADOR', sql.Decimal(15, 0), parseFloat(convocacao.CDCONTRATADOR))
            .query(`
              SELECT upper([RZSOCIAL]) AS [RZSOCIAL], [NRCELULAR], [FGACTIVE]
              FROM [dbo].[CADASTROGERAL]
              WHERE [CDCADASTRO] = @CDCONTRATADOR AND [FGACTIVE] = 'A'
            `);

          // Se não encontrou ativo, buscar qualquer um (para debug)
          if (contratadorResult.recordset.length === 0) {
            contratadorResult = await pool
              .request()
              .input('CDCONTRATADOR', sql.Decimal(15, 0), parseFloat(convocacao.CDCONTRATADOR))
              .query(`
                SELECT upper([RZSOCIAL]) AS [RZSOCIAL], [NRCELULAR], [FGACTIVE]
                FROM [dbo].[CADASTROGERAL]
                WHERE [CDCADASTRO] = @CDCONTRATADOR
              `);

            if (contratadorResult.recordset.length > 0) {
              // Log de debug removido
            }
          }

          if (contratadorResult.recordset.length > 0) {
            const contratador = contratadorResult.recordset[0];
            convocacao.CONTRATADOR_NOME = contratador.RZSOCIAL;
            convocacao.CONTRATADOR_CELULAR = contratador.NRCELULAR;
            // Log de debug removido
          } else {
            // Log de debug removido
          }
        } catch (err) {
          console.error('[DEBUG CONTRATADOR] Erro ao buscar contratador separadamente:', err);
        }
      } else if (convocacao.CONTRATADOR_NOME) {
        // Log de debug removido
      }

      console.log(`[CONVOCACAO PUBLICA] Convocação encontrada: ID ${id}, Status: ${convocacao.STATUS}`);
      res.json(convocacao);
    } catch (err) {
      console.error(`[CONVOCACAO PUBLICA] Erro ao buscar convocação ID ${req.params.id}:`, err);
      console.error('[CONVOCACAO PUBLICA] Stack trace:', err.stack);
      res.status(500).json({
        error: 'Erro ao buscar convocação.',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Registrar acesso à convocação (quando motorista abre o link)
  // DHACESSO é atualizado quando o motorista acessa o link (primeiro acesso)
  // DHRESPOSTA é atualizado apenas quando o motorista responde (aceita/recusa)
  // LATITUDE e LONGITUDE são atualizados com a localização do motorista
  registrarAcessoConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;
      const pool = await poolPromise;

      console.log(`[REGISTRAR ACESSO] ID Convocação: ${id}, Lat: ${latitude}, Long: ${longitude}`);

      // Construir query dinamicamente para incluir geolocalização se fornecida
      let query = `
        UPDATE [dbo].[CONVOCACAO]
        SET [DHACESSO] = CASE WHEN [DHACESSO] IS NULL THEN CURRENT_TIMESTAMP ELSE [DHACESSO] END,
            [DHMAINTENANCE] = CURRENT_TIMESTAMP,
            [SGUSER] = 'MOTORISTA'
      `;

      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id));

      // Adicionar campos de geolocalização se fornecidos
      if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
        query += `, [LATITUDE] = @LATITUDE, [LONGITUDE] = @LONGITUDE`;
        request.input('LATITUDE', sql.Float, parseFloat(latitude));
        request.input('LONGITUDE', sql.Float, parseFloat(longitude));
      }

      query += ` WHERE [IDCONVOCACAO] = @IDCONVOCACAO`;

      const result = await request.query(query);

      console.log(`[REGISTRAR ACESSO] Linhas afetadas: ${result.rowsAffected[0]}`);

      res.json({
        success: true,
        message: 'Acesso registrado com sucesso',
        idConvocacao: parseInt(id)
      });
    } catch (error) {
      console.error('[REGISTRAR ACESSO] Erro:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao registrar acesso',
        error: error.message
      });
    }
  },

  // Atualizar localização da convocação (manual)
  atualizarLocalizacaoConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;
      const pool = await poolPromise;

      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'Latitude e longitude são obrigatórios'
        });
      }

      console.log(`[ATUALIZAR LOCALIZAÇÃO] ID Convocação: ${id}, Lat: ${latitude}, Long: ${longitude}`);

      const query = `
        UPDATE [dbo].[CONVOCACAO]
        SET [LATITUDE] = @LATITUDE,
            [LONGITUDE] = @LONGITUDE,
            [DHMAINTENANCE] = GETDATE(),
            [SGUSER] = 'MOTORISTA'
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `;

      const result = await pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('LATITUDE', sql.Float, parseFloat(latitude))
        .input('LONGITUDE', sql.Float, parseFloat(longitude))
        .query(query);

      console.log(`[ATUALIZAR LOCALIZAÇÃO] Linhas afetadas: ${result.rowsAffected[0]}`);

      if (result.rowsAffected[0] === 0) {
        return res.status(404).json({
          success: false,
          message: 'Convocação não encontrada'
        });
      }

      res.json({
        success: true,
        message: 'Localização atualizada com sucesso',
        idConvocacao: parseInt(id),
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude)
      });
    } catch (error) {
      console.error('[ATUALIZAR LOCALIZAÇÃO] Erro:', error);
      res.status(500).json({
        success: false,
        message: 'Erro ao atualizar localização',
        error: error.message
      });
    }
  },

  // Reativar convocação (reverter CONFIRMADA ou ACEITA_DESCARTADA para ACEITA)
  reativarConvocacao: async (req, res) => {
    let transaction = null;
    try {
      const { id } = req.params;
      const { motivoReabertura } = req.body;
      const userLogin = req.headers['user-login'];
      const sgUserReativar = getSgUser(req);
      if (!sgUserReativar) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      console.log(`[REATIVAR] Iniciando reativação da convocação ${id} pelo usuário ${userLogin}`);

      if (!userLogin) {
        return res.status(400).json({ error: 'Login do usuário não fornecido. É necessário estar autenticado para reativar convocações.' });
      }

      if (!motivoReabertura) {
        return res.status(400).json({ error: 'Motivo da reabertura é obrigatório.' });
      }

      const pool = await poolPromise;

      // Validar usuário existe e está ativo
      const usuarioResult = await pool
        .request()
        .input('SGUSUARIO', sql.VarChar(50), userLogin)
        .query(`
          SELECT [SGUSUARIO]
          FROM [dbo].[USUARIO]
          WHERE [SGUSUARIO] = @SGUSUARIO
            AND ([FGACTIVE] = 'A' OR [FGACTIVE] = 'S')
        `);

      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível reativar convocações.' });
      }

      // Buscar a convocação
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT [IDCONVOCACAO], [IDVIAGEM], [STATUS]
          FROM [dbo].[CONVOCACAO]
          WHERE [IDCONVOCACAO] = @IDCONVOCACAO
        `);

      if (convocacaoResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const convocacao = convocacaoResult.recordset[0];

      // Validar se a convocação pode ser reativada (deve estar CONFIRMADA)
      // As ACEITA_DESCARTADA serão atualizadas automaticamente
      if (convocacao.STATUS !== 'CONFIRMADA') {
        return res.status(400).json({
          error: `Apenas convocações com status CONFIRMADA podem ser reativadas. Status atual: ${convocacao.STATUS}`
        });
      }

      // Validar se o motivo existe
      const motivoResult = await pool
        .request()
        .input('CDMOTIVO', sql.Int, parseInt(motivoReabertura))
        .query(`
          SELECT CDMOTIVO, DSMOTIVO
          FROM [dbo].[MOTIVOREABERTURA]
          WHERE CDMOTIVO = @CDMOTIVO AND FGACTIVE = 'A'
        `);

      if (motivoResult.recordset.length === 0) {
        return res.status(400).json({ error: 'Motivo de reabertura inválido ou inativo.' });
      }

      // Iniciar transação
      transaction = await createTransaction(pool);
      await transaction.begin();
      console.log(`[REATIVAR] Transação iniciada para convocação ${id}`);

      try {
        // 1. Buscar dados do motorista para o histórico
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .query(`
            SELECT [CDCADASTRO_MOTORISTA]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_MOT
          `);

        const motorista = motoristaResult.recordset[0];

        // 2. Registrar histórico de reabertura (apenas para CONFIRMADA)
        if (convocacao.STATUS === 'CONFIRMADA' && motorista) {
          const requestHist = transaction.request();
          await requestHist
            .input('IDCONVOCACAO_HIST', sql.Int, parseInt(id))
            .input('IDVIAGEM_HIST', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('CDCADASTRO_MOTORISTA_HIST', sql.Decimal(15, 0), motorista.CDCADASTRO_MOTORISTA)
            .input('STATUS_ANTERIOR_HIST', sql.VarChar(20), convocacao.STATUS)
            .input('CDMOTIVOREABERTURA_HIST', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_HIST', sql.VarChar(50), userLogin)
            .query(`
              INSERT INTO [dbo].[HISTORICOREABERTURA] (
                [IDCONVOCACAO], [IDVIAGEM], [CDCADASTRO_MOTORISTA], [STATUS_ANTERIOR],
                [CDMOTIVOREABERTURA], [DHRABERTURA], [SGUSUARIO_OPERADOR],
                [FGACTIVE], [DHINCLUSAO], [SGUSERINCLUSAO], [SERVERORIG]
              )
              VALUES (
                @IDCONVOCACAO_HIST, @IDVIAGEM_HIST, @CDCADASTRO_MOTORISTA_HIST, @STATUS_ANTERIOR_HIST,
                @CDMOTIVOREABERTURA_HIST, GETDATE(), @SGUSUARIO_OPERADOR_HIST,
                'A', GETDATE(), @SGUSUARIO_OPERADOR_HIST, 'AppDVcargas'
              )
            `);
        }

        // 3. Reativar a convocação CONFIRMADA (mudar status para ACEITA)
        const request1 = transaction.request();
        await request1
          .input('IDCONVOCACAO_REATIVAR', sql.Int, parseInt(id))
          .input('CDMOTIVOREABERTURA', sql.Int, parseInt(motivoReabertura))
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), userLogin)
          .input('sgUser', sql.VarChar(50), sgUserReativar)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET [STATUS] = 'ACEITA',
                [CDMOTIVOREABERTURA] = @CDMOTIVOREABERTURA,
                [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR,
                [DHMAINTENANCE] = GETDATE(),
                [SGUSER] = @sgUser
            WHERE [IDCONVOCACAO] = @IDCONVOCACAO_REATIVAR
          `);

        // 4. Contar quantas convocações ACEITA_DESCARTADA serão reativadas
        const countRequest = transaction.request();
        const countResult = await countRequest
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE [IDVIAGEM] = @IDVIAGEM_COUNT
              AND [IDCONVOCACAO] != @IDCONVOCACAO_COUNT
              AND [STATUS] = 'ACEITA_DESCARTADA'
          `);

        const totalReativadas = countResult.recordset[0]?.TOTAL || 0;

        // 5. Reativar automaticamente as outras convocações ACEITA_DESCARTADA da mesma viagem
        if (totalReativadas > 0) {
          const request2 = transaction.request();
          await request2
            .input('IDVIAGEM_REATIVAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('IDCONVOCACAO_EXCLUIR', sql.Int, parseInt(id))
            .input('CDMOTIVOREABERTURA_AUTO', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_AUTO', sql.VarChar(50), userLogin)
            .input('sgUser', sql.VarChar(50), sgUserReativar)
            .query(`
              UPDATE [dbo].[CONVOCACAO]
              SET [STATUS] = 'ACEITA',
                  [CDMOTIVOREABERTURA] = @CDMOTIVOREABERTURA_AUTO,
                  [SGUSUARIO_OPERADOR] = @SGUSUARIO_OPERADOR_AUTO,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser
              WHERE [IDVIAGEM] = @IDVIAGEM_REATIVAR
                AND [IDCONVOCACAO] != @IDCONVOCACAO_EXCLUIR
                AND [STATUS] = 'ACEITA_DESCARTADA'
            `);
        }

        await transaction.commit();
        console.log(`[REATIVAR] Transação commitada com sucesso para convocação ${id}`);

        const motivo = motivoResult.recordset[0];

        let mensagem = `Convocação ${id} reativada com sucesso. Motivo: ${motivo.DSMOTIVO}`;
        if (totalReativadas > 0) {
          mensagem += `\n\n${totalReativadas} convocação(ões) ACEITA (Não Selecionada) também foram reativada(s) automaticamente.`;
        }

        res.json({
          success: true,
          message: mensagem,
          statusAnterior: convocacao.STATUS,
          statusNovo: 'ACEITA',
          motivo: motivo.DSMOTIVO,
          motivoCodigo: motivo.CDMOTIVO,
          idViagem: convocacao.IDVIAGEM,
          totalReativadas: totalReativadas
        });

      } catch (err) {
        if (transaction) {
          await transaction.rollback();
          console.log(`[REATIVAR] Transação revertida para convocação ${id}`);
        }
        throw err;
      }

    } catch (err) {
      console.error('[REATIVAR] Erro ao reativar convocação:', err);
      res.status(500).json({
        error: 'Erro ao reativar convocação.',
        details: err.message
      });
    }
  },

  // Listar histórico de reabertura de uma convocação
  listarHistoricoReabertura: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;
      const reqParam = pool.request().input('IDCONVOCACAO', sql.Int, parseInt(id));

      const queryUpper = `
        SELECT 
          [h].[IDHISTORICO],
          [h].[IDCONVOCACAO],
          [h].[IDVIAGEM],
          [h].[CDCADASTRO_MOTORISTA],
          upper([cg].[RZSOCIAL]) AS [NOME_MOTORISTA],
          [h].[STATUS_ANTERIOR],
          [h].[CDMOTIVOREABERTURA],
          [mr].[DSMOTIVO] AS [MOTIVO_REABERTURA],
          [h].[DHRABERTURA],
          [h].[SGUSUARIO_OPERADOR],
          [h].[OBSERVACAO]
        FROM [dbo].[HISTORICOREABERTURA] [h]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [h].[CDCADASTRO_MOTORISTA] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[MOTIVOREABERTURA] [mr] ON [h].[CDMOTIVOREABERTURA] = [mr].[CDMOTIVO]
        WHERE [h].[IDCONVOCACAO] = @IDCONVOCACAO
          AND [h].[FGACTIVE] = 'A'
        ORDER BY [h].[DHRABERTURA] DESC
      `;
      const queryLower = `
        SELECT 
          [h].[idhistorico],
          [h].[idconvocacao],
          [h].[idviagem],
          [h].[cdcadastro_motorista],
          upper([cg].[rzsocial]) AS [NOME_MOTORISTA],
          [h].[status_anterior],
          [h].[cdmotivoreabertura],
          [mr].[dsmotivo] AS [MOTIVO_REABERTURA],
          [h].[dhrabertura],
          [h].[sgusuario_operador],
          [h].[observacao]
        FROM [dbo].[HISTORICOREABERTURA] [h]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [h].[cdcadastro_motorista] = [cg].[cdcadastro]
        LEFT JOIN [dbo].[MOTIVOREABERTURA] [mr] ON [h].[cdmotivoreabertura] = [mr].[cdmotivo]
        WHERE [h].[idconvocacao] = @IDCONVOCACAO
          AND [h].[fgactive] = 'A'
        ORDER BY [h].[dhrabertura] DESC
      `;

      let result;
      try {
        result = await reqParam.query(queryUpper);
      } catch (errUpper) {
        if (errUpper.code === '42703' && /coluna.*não existe|column.*does not exist/i.test(String(errUpper.message))) {
          result = await pool.request().input('IDCONVOCACAO', sql.Int, parseInt(id)).query(queryLower);
        } else {
          throw errUpper;
        }
      }

      const toUpper = {
        idhistorico: 'IDHISTORICO', idconvocacao: 'IDCONVOCACAO', idviagem: 'IDVIAGEM',
        cdcadastro_motorista: 'CDCADASTRO_MOTORISTA', status_anterior: 'STATUS_ANTERIOR',
        cdmotivoreabertura: 'CDMOTIVOREABERTURA', dhrabertura: 'DHRABERTURA',
        sgusuario_operador: 'SGUSUARIO_OPERADOR', observacao: 'OBSERVACAO',
        nome_motorista: 'NOME_MOTORISTA', motivo_reabertura: 'MOTIVO_REABERTURA'
      };
      const recordset = (result.recordset || []).map((row) => {
        const r = { ...row };
        Object.keys(toUpper).forEach((k) => {
          if (r[k] !== undefined && r[toUpper[k]] === undefined) r[toUpper[k]] = r[k];
        });
        return r;
      });
      res.json(recordset);
    } catch (err) {
      console.error('Erro ao buscar histórico de reabertura:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico de reabertura.' });
    }
  },

  // Motorista responder convocação (aceitar/recusar)
  // LATITUDE e LONGITUDE são atualizados com a localização do motorista no momento da resposta
  responderConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, latitude, longitude, motivoRecusa } = req.body;

      if (!status || !['ACEITA', 'RECUSADA'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido. Use ACEITA ou RECUSADA.' });
      }

      // Se for recusa, o motivo é obrigatório
      if (status === 'RECUSADA' && (!motivoRecusa || motivoRecusa === '')) {
        return res.status(400).json({ error: 'Motivo da recusa é obrigatório.' });
      }

      const pool = await poolPromise;

      // Construir query dinamicamente para incluir geolocalização e motivo se fornecidos
      let query = `
        UPDATE [dbo].[CONVOCACAO]
        SET STATUS = @STATUS,
            DHRESPOSTA = GETDATE(),
            DHACESSO = CASE WHEN DHACESSO IS NULL THEN GETDATE() ELSE DHACESSO END,
            DHMAINTENANCE = GETDATE(),
            SGUSER = 'MOTORISTA'
      `;

      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('STATUS', sql.VarChar(20), status);

      // Adicionar campo de motivo se for recusa
      if (status === 'RECUSADA' && motivoRecusa) {
        query += `, CDMOTIVORECUSA = @CDMOTIVORECUSA`;
        request.input('CDMOTIVORECUSA', sql.Int, parseInt(motivoRecusa));
      }

      // Adicionar campos de geolocalização se fornecidos
      // Atualizar sempre que houver nova localização (pode ter mudado desde o acesso)
      if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
        query += `, LATITUDE = @LATITUDE, LONGITUDE = @LONGITUDE`;
        request.input('LATITUDE', sql.Float, parseFloat(latitude));
        request.input('LONGITUDE', sql.Float, parseFloat(longitude));
      }

      query += ` WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [STATUS] = 'PENDENTE'`;

      await request.query(query);

      res.json({
        success: true,
        message: status === 'ACEITA' ? 'Convocação aceita com sucesso!' : 'Convocação recusada.'
      });
    } catch (err) {
      console.error('Erro ao responder convocação:', err);
      res.status(500).json({ error: 'Erro ao responder convocação.' });
    }
  },

  // Obter URL pública para links de convocação
  obterUrlPublica: async (req, res) => {
    try {
      // Tentar obter da variável de ambiente primeiro
      let publicUrl = process.env.PUBLIC_URL || process.env.APP_URL;

      // Se não tiver configurado, usar o host da requisição
      if (!publicUrl) {
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:3000';
        publicUrl = `${protocol}://${host}`;

        // Se for localhost, tentar detectar IP local para desenvolvimento
        if (host.includes('localhost') || host.includes('127.0.0.1')) {
          // Em desenvolvimento, retornar localhost (não funcionará no celular)
          // Mas avisar que precisa configurar PUBLIC_URL
          return res.json({
            url: publicUrl,
            warning: 'Usando localhost. Para funcionar no celular, configure a variável de ambiente PUBLIC_URL com o IP ou domínio público do servidor.'
          });
        }
      }

      res.json({ url: publicUrl });
    } catch (err) {
      console.error('Erro ao obter URL pública:', err);
      // Fallback para localhost
      res.json({ url: 'http://localhost:3000' });
    }
  },

  // Executar query SQL personalizada (apenas SELECT para segurança)
  executarQuery: async (req, res) => {
    try {
      const { query } = req.body;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'Query SQL é obrigatória.' });
      }

      // Remover espaços em branco e converter para maiúsculas para verificação
      const queryUpper = query.trim().toUpperCase();

      // Bloquear comandos perigosos (apenas permitir SELECT)
      const comandosBloqueados = [
        'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'ALTER',
        'CREATE', 'EXEC', 'EXECUTE', 'SP_', 'XP_', '--', '/*', '*/'
      ];

      // Verificar se a query começa com SELECT
      if (!queryUpper.startsWith('SELECT')) {
        return res.status(400).json({
          error: 'Apenas queries SELECT são permitidas por segurança.'
        });
      }

      // Verificar comandos bloqueados
      for (const cmd of comandosBloqueados) {
        if (queryUpper.includes(cmd)) {
          return res.status(400).json({
            error: `Comando não permitido: ${cmd}. Apenas queries SELECT são permitidas.`
          });
        }
      }

      const pool = await poolPromise;
      const result = await pool.request().query(query);

      // Converter resultados para formato JSON simples
      const rows = result.recordset.map(row => {
        const obj = {};
        for (const key in row) {
          obj[key] = row[key];
        }
        return obj;
      });

      res.json({
        success: true,
        rows: rows,
        rowCount: rows.length,
        columns: rows.length > 0 ? Object.keys(rows[0]) : []
      });
    } catch (err) {
      console.error('Erro ao executar query:', err);
      res.status(500).json({
        error: 'Erro ao executar query SQL.',
        message: err.message,
        details: err.originalError ? err.originalError.message : null
      });
    }
  },

  // Executar SQL de inicialização (permite procedures e comandos mais amplos)
  // Este endpoint é usado para executar o arquivo init.sql automaticamente
  executarInitSQL: async (req, res) => {
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
      const totalComandos = comandos.length;

      // Extrair nomes das procedures para log de progresso
      const extrairNomeProcedure = (cmd) => {
        const match = cmd.trim().toUpperCase().match(/EXEC(?:UTE)?\s+(?:\[DBO\]\.)?\[?(\w+)\]?/);
        return match ? match[1] : null;
      };

      for (let i = 0; i < comandos.length; i++) {
        const comando = comandos[i];
        const cmdLimpo = comando.trim();
        if (!cmdLimpo) continue;

        // Extrair nome da procedure se for EXEC
        const nomeProcedure = extrairNomeProcedure(cmdLimpo);
        const progresso = `[${i + 1}/${totalComandos}]`;
        
        try {
          // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
          const request = pool.request();
          // mssql usa requestTimeout (em milissegundos)
          // Aumentar para 10 minutos (600 segundos) para scripts grandes
          request.timeout = 600000; // 600 segundos (10 minutos) para comandos grandes

          // Executar comando
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
          let mensagemErro = cmdErr.message || cmdErr.originalError?.message || String(cmdErr);

          // Verificar se é erro de truncamento (pode ser ignorado se a procedure já faz truncamento)
          const isTruncamento = mensagemErro.toLowerCase().includes('truncated') ||
            mensagemErro.toLowerCase().includes('truncados') ||
            mensagemErro.toLowerCase().includes('string or binary data would be truncated');

          // Melhorar mensagem de timeout
          if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
            mensagemErro = `Timeout: Comando demorou mais de 10 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
          }

          // Se for erro de truncamento, verificar se o comando é EXEC de uma stored procedure
          // Se for, pode ser que a procedure precise ser atualizada ou o erro é esperado
          const isExecProcedure = cmdLimpo.trim().toUpperCase().startsWith('EXEC') ||
            cmdLimpo.trim().toUpperCase().startsWith('EXECUTE');

          resultados.push({
            tipo: isTruncamento && isExecProcedure ? 'AVISO' : 'ERRO', // Truncamento em procedures = aviso
            error: mensagemErro,
            mensagem: mensagemErro, // Adicionar campo mensagem para compatibilidade
            comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
            detalhes: {
              nome: cmdErr.name,
              codigo: cmdErr.code,
              numero: cmdErr.number,
              isTruncamento: isTruncamento,
              isExecProcedure: isExecProcedure
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
          message: err.message,
          details: err.originalError ? err.originalError.message : null
        });
      }
    }
  },

  // ============================================================================
  // MÉTODOS PARA GERENCIAR VEÍCULO DA VIAGEM
  // ============================================================================

  // Buscar equipamento por placa ou código (notação [coluna] para PostgreSQL preservar maiúsculas)
  buscarEquipamento: async (req, res) => {
    try {
      const { placa, codigo } = req.query;

      if (!placa && !codigo) {
        return res.status(400).json({ error: 'Informe a placa ou o código do equipamento.' });
      }

      const pool = await poolPromise;
      let query = `
        SELECT 
          e.[IDEQUIPAMENTO],
          e.[REFEQUIPAMENTO],
          e.[DSEQUIPAMENTO],
          NULL AS [CDGRUPOEQUIPAMENTO],
          NULL AS [GRUPO_NOME],
          e.[CDTIPOEQUIPAMENTO],
          t.[DSTIPOEQUIPAMENTO] AS [TIPO_NOME],
          e.[CDMARCAEQUIPAMENTO],
          m.[DSMARCAEQUIPAMENTO] AS [MARCA_NOME],
          e.[CDMODELOEQUIPAMENTO],
          mod.[DSMODELOEQUIPAMENTO] AS [MODELO_NOME],
          e.[CDCLASSEFROTA],
          c.[DSCLASSEFROTA] AS [CLASSE_NOME],
          e.[FGACTIVE],
          e.[FGTIPOATUACAO],
          e.[FGTIPOCARROCERIA],
          e.[NREIXOS],
          e.[CAPACIDCARGA],
          e.[ANOFABRICA],
          e.[ALTURA],
          e.[LARGURA],
          e.[COMPRIMENTO],
          e.[MTCUBICO],
          e.[FGRASTREADO]
        FROM [dbo].[EQUIPAMENTO] e
        LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON e.[CDTIPOEQUIPAMENTO] = t.[CDTIPOEQUIPAMENTO]
        LEFT JOIN [dbo].[MARCAEQUIPAMENTO] m ON e.[CDMARCAEQUIPAMENTO] = m.[CDMARCAEQUIPAMENTO]
        LEFT JOIN [dbo].[MODELOEQUIPAMENTO] mod ON e.[CDMODELOEQUIPAMENTO] = mod.[CDMODELOEQUIPAMENTO]
        LEFT JOIN [dbo].[CLASSEFROTA] c ON e.[CDCLASSEFROTA] = c.[CDCLASSEFROTA]
        WHERE 1=1
      `;

      const request = pool.request();
      if (placa) {
        query += ` AND UPPER(e.[REFEQUIPAMENTO]) = UPPER(@PLACA)`;
        request.input('PLACA', sql.VarChar(20), placa.toUpperCase().trim());
      }
      if (codigo) {
        query += ` AND e.[IDEQUIPAMENTO] = @CODIGO`;
        request.input('CODIGO', sql.Decimal(15, 0), parseFloat(codigo));
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Equipamento não encontrado.' });
      }

      res.json(result.recordset[0]);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      res.status(500).json({ error: 'Erro ao buscar equipamento.' });
    }
  },

  // Buscar veículos da viagem (retorna LISTA - pode ter múltiplos veículos)
  buscarVeiculoViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;

      const result = await pool.request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            [vv].[IDVIAGEM],
            [vv].[IDEQUIPAMENTO],
            [vv].[REFEQUIPAMENTO],
            [vv].[TPEQUIPAMENTO],
            [e].[DSEQUIPAMENTO],
            [e].[FGACTIVE],
            NULL AS [CDGRUPOEQUIPAMENTO],
            NULL AS [GRUPO_NOME],
            [e].[CDTIPOEQUIPAMENTO],
            [t].[DSTIPOEQUIPAMENTO] AS [TIPO_NOME],
            [e].[CDMARCAEQUIPAMENTO],
            [m].[DSMARCAEQUIPAMENTO] AS [MARCA_NOME],
            [e].[CDMODELOEQUIPAMENTO],
            [mod].[DSMODELOEQUIPAMENTO] AS [MODELO_NOME],
            [e].[CDCLASSEFROTA],
            [c].[DSCLASSEFROTA] AS [CLASSE_NOME],
            [e].[FGTIPOATUACAO],
            [e].[FGTIPOCARROCERIA],
            [e].[NREIXOS],
            [e].[CAPACIDCARGA],
            [e].[ANOFABRICA],
            [e].[ALTURA],
            [e].[LARGURA],
            [e].[COMPRIMENTO],
            [e].[MTCUBICO],
            [e].[FGRASTREADO]
          FROM [dbo].[VIAGEMVEICULO] [vv]
          INNER JOIN [dbo].[EQUIPAMENTO] [e] ON [vv].[IDEQUIPAMENTO] = [e].[IDEQUIPAMENTO]
          LEFT JOIN [dbo].[TIPOEQUIPAMENTO] [t] ON [e].[CDTIPOEQUIPAMENTO] = [t].[CDTIPOEQUIPAMENTO]
          LEFT JOIN [dbo].[MARCAEQUIPAMENTO] [m] ON [e].[CDMARCAEQUIPAMENTO] = [m].[CDMARCAEQUIPAMENTO]
          LEFT JOIN [dbo].[MODELOEQUIPAMENTO] [mod] ON [e].[CDMODELOEQUIPAMENTO] = [mod].[CDMODELOEQUIPAMENTO]
          LEFT JOIN [dbo].[CLASSEFROTA] [c] ON [e].[CDCLASSEFROTA] = [c].[CDCLASSEFROTA]
          WHERE [vv].[IDVIAGEM] = @IDVIAGEM
          ORDER BY [vv].[IDEQUIPAMENTO]
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar veículos da viagem:', err);
      res.status(500).json({ error: 'Erro ao buscar veículos da viagem.' });
    }
  },

  // Salvar veículo na viagem (permite múltiplos veículos - verifica combinação específica)
  salvarVeiculoViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const { idequipamento, refequipamento, tpequipamento } = req.body;

      if (!idequipamento || !refequipamento || !tpequipamento) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);
      await transaction.begin();

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      try {
        // Verificar se já existe esta combinação específica (IDVIAGEM + IDEQUIPAMENTO)
        const checkRequest = transaction.request();
        const checkResult = await checkRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
          .query('SELECT COUNT(*) AS [COUNT] FROM [dbo].[VIAGEMVEICULO] WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO');

        if (getFirstNumericValue(checkResult.recordset, 0) > 0) {
          // Atualizar combinação específica
          const updateRequest = transaction.request();
          await updateRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              UPDATE [dbo].[VIAGEMVEICULO]
              SET [REFEQUIPAMENTO] = @REFEQUIPAMENTO,
                  [TPEQUIPAMENTO] = @TPEQUIPAMENTO,
                  [DHMAINTENANCE] = GETDATE(),
                  [SGUSER] = @sgUser,
                  [SERVERORIG] = 'AppDVcargas'
              WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO
            `);
        } else {
          // Inserir nova combinação
          const insertRequest = transaction.request();
          await insertRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .input('sgUser', sql.VarChar(50), sgUser)
            .query(`
              INSERT INTO [dbo].[VIAGEMVEICULO] ([IDVIAGEM], [IDEQUIPAMENTO], [REFEQUIPAMENTO], [TPEQUIPAMENTO], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
              VALUES (@IDVIAGEM, @IDEQUIPAMENTO, @REFEQUIPAMENTO, @TPEQUIPAMENTO, GETDATE(), @sgUser, 'AppDVcargas')
            `);
        }

        await transaction.commit();
        res.json({ success: true, message: 'Veículo salvo com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao salvar veículo da viagem:', err);
      res.status(500).json({ error: 'Erro ao salvar veículo da viagem.' });
    }
  },

  // ============================================================================
  // MÉTODOS PARA GERENCIAR MOTORISTA DA VIAGEM
  // ============================================================================

  // Buscar cadastro geral por CPF, nome ou código
  buscarCadastroGeral: async (req, res) => {
    try {
      const { cpf, nome, codigo } = req.query;

      if (!cpf && !nome && !codigo) {
        return res.status(400).json({ error: 'Informe o CPF, nome ou código do cadastro.' });
      }

      const pool = await poolPromise;
      let query = `
        SELECT 
          cg.[CDCADASTRO] AS [CDCADASTROGERAL],
          cg.[CGCCPF] AS [CGCCPF],
          upper(cg.[RZSOCIAL]) AS [RZSOCIAL],
          cg.[NMFANTASIA] AS [NMFANTASIA],
          cg.[FGFISICAJURIDICA] AS [FGFISICAJURIDICA],
          cg.[FGTIPOCADASTRO] AS [FGTIPOCADASTRO],
          cg.[FGRASTREADO] AS [FGRASTREADO],
          cg.[FGACTIVE] AS [FGACTIVE],
          cg.[CDTRANSPORTADOR] AS [CDTRANSPORTADOR],
          upper(t.[RZSOCIAL]) AS [TRANSPORTADOR_NOME],
          cg.[CEP] AS [CEP],
          c.[ESTADO] AS [CIDADE_ESTADO],
          c.[NMCIDADE] AS [CIDADE_NOME],
          cg.[CDCIDADE] AS [CDCIDADE],
          cg.[ENDERECO] AS [ENDERECO],
          cg.[NRENDERECO] AS [NRENDERECO],
          cg.[COMPLEND] AS [COMPLEND],
          cg.[BAIRRO] AS [BAIRRO],
          cg.[NRCELULAR] AS [NRCELULAR],
          cg.[ENDEMAIL] AS [ENDEMAIL],
          cg.[LATITUDE] AS [LATITUDE],
          cg.[LONGITUDE] AS [LONGITUDE]
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[CIDADE] c ON cg.[CDCIDADE] = c.[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.[CDTRANSPORTADOR] = t.[CDCADASTRO]
        WHERE 1=1
      `;

      const request = pool.request();
      if (cpf) {
        const cpfLimpo = cpf.replace(/[^\d]+/g, '');
        query += ` AND cg.[CGCCPF] = @CPF`;
        request.input('CPF', sql.VarChar(14), cpfLimpo);
      }
      if (nome) {
        query += ` AND (cg.[RZSOCIAL] LIKE @NOME OR cg.[NMFANTASIA] LIKE @NOME)`;
        request.input('NOME', sql.VarChar(100), `%${nome}%`);
      }
      if (codigo) {
        query += ` AND cg.[CDCADASTRO] = @CODIGO`;
        request.input('CODIGO', sql.Decimal(15, 0), parseFloat(codigo));
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar cadastro geral:', err);
      res.status(500).json({ error: 'Erro ao buscar cadastro geral.' });
    }
  },

  // Buscar motoristas da viagem (retorna LISTA - pode ter múltiplos motoristas)
  buscarMotoristaViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const pool = await poolPromise;

      const result = await pool.request()
        .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            [vm].[IDVIAGEM],
            [vm].[CDMOTORISTA],
            [cg].[CDCADASTRO] AS CDCADASTROGERAL,
            [cg].[CGCCPF],
            [cg].[RZSOCIAL],
            [cg].[NMFANTASIA],
            [cg].[FGFISICAJURIDICA],
            [cg].[FGTIPOCADASTRO],
            [cg].[FGRASTREADO],
            [cg].[FGACTIVE],
            [cg].[CDTRANSPORTADOR],
            upper([t].[RZSOCIAL]) AS TRANSPORTADOR_NOME,
            [cg].[CEP],
            NULL AS CIDADE_ESTADO,
            NULL AS CIDADE_NOME,
            [cg].[ENDERECO],
            [cg].[NRENDERECO],
            [cg].[COMPLEND],
            [cg].[BAIRRO],
            [cg].[NRCELULAR],
            [cg].[ENDEMAIL],
            [cg].[LATITUDE],
            [cg].[LONGITUDE]
          FROM [dbo].[VIAGEMMOTORISTA] [vm]
          INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTRO]
          LEFT JOIN [dbo].[CADASTROGERAL] [t] ON [cg].[CDTRANSPORTADOR] = [t].[CDCADASTRO]
          WHERE [vm].[IDVIAGEM] = @IDVIAGEM
          ORDER BY [vm].[CDMOTORISTA]
        `);

      // Retornar lista (pode estar vazia - isso é normal)
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar motoristas da viagem:', err);
      res.status(500).json({ error: 'Erro ao buscar motoristas da viagem.' });
    }
  },

  // Salvar motorista na viagem
  salvarMotoristaViagem: async (req, res) => {
    try {
      const { id } = req.params;
      const { cdmotorista } = req.body;

      if (!cdmotorista) {
        return res.status(400).json({ error: 'Código do motorista é obrigatório.' });
      }

      // Validar se são números válidos
      const idNum = parseFloat(id);
      const cdmotoristaNum = parseFloat(cdmotorista);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
        return res.status(400).json({ error: 'Código do motorista inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);
      await transaction.begin();

      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
      try {
        // Upsert: inserir ou atualizar (evita erro de chave duplicada e condição de corrida)
        const upsertRequest = transaction.request();
        await upsertRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .input('sgUser', sql.VarChar(50), sgUser)
          .query(`
            INSERT INTO [dbo].[VIAGEMMOTORISTA] ([IDVIAGEM], [CDMOTORISTA], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
            VALUES (@IDVIAGEM, @CDMOTORISTA, GETDATE(), @sgUser, 'AppDVcargas')
            ON CONFLICT ([IDVIAGEM], [CDMOTORISTA]) DO UPDATE SET
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = @sgUser,
              [SERVERORIG] = 'AppDVcargas'
          `);

        await transaction.commit();
        res.json({ success: true, message: 'Motorista salvo com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        console.error('Erro na transação ao salvar motorista:', err);
        console.error('Stack:', err.stack);
        throw err;
      }
    } catch (err) {
      console.error('Erro ao salvar motorista da viagem:', err);
      console.error('Detalhes:', err.message);
      console.error('Stack:', err.stack);
      res.status(500).json({
        error: 'Erro ao salvar motorista da viagem.',
        detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  },

  // Remover veículo específico da viagem
  removerVeiculoViagem: async (req, res) => {
    try {
      const { id, idequipamento } = req.params;

      if (!idequipamento) {
        return res.status(400).json({ error: 'ID do equipamento é obrigatório.' });
      }

      const idNum = parseFloat(id);
      const idequipamentoNum = parseFloat(idequipamento);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(idequipamentoNum) || idequipamentoNum <= 0) {
        return res.status(400).json({ error: 'ID do equipamento inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = transaction.request();
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idequipamentoNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMVEICULO]
            WHERE [IDVIAGEM] = @IDVIAGEM AND [IDEQUIPAMENTO] = @IDEQUIPAMENTO
          `);

        if (result.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Veículo não encontrado nesta viagem.' });
        }

        await transaction.commit();
        res.json({ success: true, message: 'Veículo removido com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao remover veículo da viagem:', err);
      res.status(500).json({ error: 'Erro ao remover veículo da viagem.' });
    }
  },

  // Remover motorista específico da viagem
  removerMotoristaViagem: async (req, res) => {
    try {
      const { id, cdmotorista } = req.params;

      if (!cdmotorista) {
        return res.status(400).json({ error: 'Código do motorista é obrigatório.' });
      }

      const idNum = parseFloat(id);
      const cdmotoristaNum = parseFloat(cdmotorista);

      if (isNaN(idNum) || idNum <= 0) {
        return res.status(400).json({ error: 'ID da viagem inválido.' });
      }

      if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
        return res.status(400).json({ error: 'Código do motorista inválido.' });
      }

      const pool = await poolPromise;
      const transaction = await createTransaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = transaction.request();
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMMOTORISTA]
            WHERE [IDVIAGEM] = @IDVIAGEM AND [CDMOTORISTA] = @CDMOTORISTA
          `);

        if (result.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Motorista não encontrado para esta viagem.' });
        }

        await transaction.commit();
        res.json({ success: true, message: 'Motorista removido com sucesso!' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao remover motorista da viagem:', err);
      res.status(500).json({ error: 'Erro ao remover motorista da viagem.' });
    }
  },

  // ========== LOGS WEBHOOK META ==========

  // Salvar log do webhook Meta
  salvarLogWebhookMeta: async (req, res) => {
    try {
      const { IDCONVOCACAO, tipo, titulo, mensagem, detalhes, status_http, tempo_resposta } = req.body;

      if (!IDCONVOCACAO || !tipo) {
        return res.status(400).json({ error: 'IDCONVOCACAO e tipo são obrigatórios.' });
      }

      // Mostrar logs no terminal do servidor para envio e resposta (apenas uma vez)
      if (tipo === 'envio' && detalhes) {
        const detalhesObj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
        // Extrair contador da mensagem se disponível
        const mensagemMatch = mensagem ? mensagem.match(/\[(\d+)\/(\d+)\]/) : null;
        const contador = mensagemMatch ? `[${mensagemMatch[1]}/${mensagemMatch[2]}]` : '';

        console.log('========================================');
        console.log(`[WEBHOOK ENVIO] 📤 ${contador} ENVIANDO CONVOCAÇÃO`.trim());
        console.log(`[WEBHOOK ENVIO] Timestamp: ${detalhesObj.timestamp || new Date().toISOString()}`);
        console.log(`[WEBHOOK ENVIO] ID Convocação: ${IDCONVOCACAO}`);
        console.log(`[WEBHOOK ENVIO] URL: ${detalhesObj.url || 'https://ia.riochat.com.br/webhook/aviso-rota-integra'}`);
        console.log(`[WEBHOOK ENVIO] Método: ${detalhesObj.metodo || 'POST'}`);
        console.log(`[WEBHOOK ENVIO] Headers:`, detalhesObj.headers || { 'Content-Type': 'application/json' });
        console.log(`[WEBHOOK ENVIO] Body completo:`, JSON.stringify(detalhesObj.body || {}, null, 2));
        console.log('========================================');
      } else if (tipo === 'resposta' && detalhes) {
        const detalhesObj = typeof detalhes === 'string' ? JSON.parse(detalhes) : detalhes;
        // Extrair contador da mensagem se disponível
        const mensagemMatch = mensagem ? mensagem.match(/\[(\d+)\/(\d+)\]/) : null;
        const contador = mensagemMatch ? `[${mensagemMatch[1]}/${mensagemMatch[2]}]` : '';

        console.log(`[WEBHOOK RESPOSTA] 📥 ${contador} RESPOSTA RECEBIDA`.trim());
        console.log(`[WEBHOOK RESPOSTA] Timestamp: ${detalhesObj.timestamp || new Date().toISOString()}`);
        console.log(`[WEBHOOK RESPOSTA] ID Convocação: ${IDCONVOCACAO}`);
        console.log(`[WEBHOOK RESPOSTA] Status: ${detalhesObj.status || status_http} ${detalhesObj.statusText || ''}`);
        console.log(`[WEBHOOK RESPOSTA] Tempo de resposta: ${detalhesObj.tempoResposta || tempo_resposta || 'N/A'}`);
        console.log(`[WEBHOOK RESPOSTA] Headers:`, JSON.stringify(detalhesObj.headers || {}, null, 2));
        if (detalhesObj.body) {
          if (typeof detalhesObj.body === 'object') {
            console.log(`[WEBHOOK RESPOSTA] Body (JSON):`, JSON.stringify(detalhesObj.body, null, 2));
          } else {
            console.log(`[WEBHOOK RESPOSTA] Body (Texto):`, detalhesObj.body);
          }
        }
        console.log('');
      }

      // Garantir que detalhes seja uma string JSON válida
      let detalhesJson = null;
      if (detalhes) {
        if (typeof detalhes === 'string') {
          try {
            JSON.parse(detalhes);
            detalhesJson = detalhes;
          } catch (e) {
            detalhesJson = JSON.stringify(detalhes);
          }
        } else {
          detalhesJson = JSON.stringify(detalhes);
        }
      }

      const sgUserLog = getSgUser(req);
      if (!sgUserLog) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

      const pool = await poolPromise;
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO))
        .input('TIPO', sql.VarChar(20), tipo)
        .input('TITULO', sql.NVarChar(200), titulo || null)
        .input('MENSAGEM', sql.NVarChar(sql.MAX), mensagem || null)
        .input('DETALHES', sql.NVarChar(sql.MAX), detalhesJson)
        .input('STATUS_HTTP', sql.Int, status_http || null)
        .input('TEMPO_RESPOSTA', sql.Int, tempo_resposta || null)
        .input('sgUser', sql.VarChar(50), sgUserLog);

      await request.query(`
        INSERT INTO [dbo].[LOGSWEBHOOKMETA] 
          (IDCONVOCACAO, TIPO, TITULO, MENSAGEM, DETALHES, STATUS_HTTP, TEMPO_RESPOSTA, DHLOG, DHMAINTENANCE, SGUSER, SERVERORIG)
        VALUES 
          (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, GETDATE(), GETDATE(), @sgUser, 'AppDVcargas')
      `);

      res.json({ success: true, message: 'Log salvo com sucesso!' });
    } catch (err) {
      console.error('[LOGS WEBHOOK META] Erro ao salvar log:', err.message);
      res.status(500).json({ error: 'Erro ao salvar log.', details: err.message });
    }
  },

  // Listar logs do webhook Meta
  listarLogsWebhookMeta: async (req, res) => {
    try {
      const { limite = 100, idConvocacao, idViagem } = req.query;

      const pool = await poolPromise;
      let query = `
        SELECT 
          [l].[IDLOG],
          [l].[IDCONVOCACAO],
          [l].[TIPO],
          [l].[TITULO],
          [l].[MENSAGEM],
          [l].[DETALHES],
          [l].[STATUS_HTTP],
          [l].[TEMPO_RESPOSTA],
          [l].[DHLOG]
        FROM [dbo].[LOGSWEBHOOKMETA] [l]
        WHERE 1=1
      `;

      const request = pool.request();

      if (idConvocacao) {
        query += ` AND [l].[IDCONVOCACAO] = @IDCONVOCACAO`;
        request.input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao));
      }

      // Filtrar por ID da viagem através das convocações
      if (idViagem) {
        query += ` AND [l].[IDCONVOCACAO] IN (
          SELECT [IDCONVOCACAO] 
          FROM [dbo].[CONVOCACAO] 
          WHERE [IDVIAGEM] = @IDVIAGEM
        )`;
        request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      }

      query += ` ORDER BY [l].[DHLOG] DESC LIMIT @LIMITE`;
      request.input('LIMITE', sql.Int, parseInt(limite));

      const result = await request.query(query);

      // Parse dos detalhes JSON
      const logs = result.recordset.map(log => {
        let detalhesParsed = null;
        try {
          if (log.DETALHES) {
            if (typeof log.DETALHES === 'string') {
              detalhesParsed = JSON.parse(log.DETALHES);
            } else {
              detalhesParsed = log.DETALHES;
            }
          }
        } catch (e) {
          // Se falhar o parse, manter como string ou null
          detalhesParsed = log.DETALHES;
        }

        return {
          ...log,
          detalhes: detalhesParsed,
          timestamp: log.DHLOG ? log.DHLOG.toISOString() : null
        };
      });

      res.json(logs);
    } catch (err) {
      console.error('[LOGS WEBHOOK META] Erro ao listar logs:', err);
      console.error('[LOGS WEBHOOK META] Stack trace:', err.stack);
      res.status(500).json({ error: 'Erro ao listar logs.', details: err.message });
    }
  },

  // ========== WEBHOOK CALLBACK META ==========

  // Receber retorno do webhook Meta (callback)
  receberRetornoWebhookMeta: async (req, res) => {
    const inicioProcessamento = Date.now();

    // Log apenas os dados recebidos (formato limpo)
    const dadosRecebidos = {
      IDCONVOCACAO: req.body.IDCONVOCACAO || null,
      LATITUDE: req.body.LATITUDE || null,
      LONGITUDE: req.body.LONGITUDE || null,
      CDMOTIVORECUSA: req.body.CDMOTIVORECUSA || null
    };

    console.log('\n========================================');
    console.log('[WEBHOOK RETORNO] 📥 DADOS RECEBIDOS DA META');
    console.log(JSON.stringify(dadosRecebidos, null, 2));
    console.log('========================================\n');

    try {
      const { IDCONVOCACAO, LATITUDE, LONGITUDE, CDMOTIVORECUSA, STATUS } = req.body;

      if (!IDCONVOCACAO) {
        return res.status(400).json({ error: 'IDCONVOCACAO é obrigatório.' });
      }

      const pool = await poolPromise;
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO));

      // Verificar se a convocação existe e obter STATUS atual
      const checkResult = await request.query(`
        SELECT [IDCONVOCACAO], [STATUS] FROM [dbo].[CONVOCACAO] WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `);

      if (checkResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Convocação não encontrada.' });
      }

      const statusAtual = checkResult.recordset[0].STATUS;

      // Determinar STATUS baseado nos dados recebidos
      // Se CDMOTIVORECUSA foi enviado, significa que foi RECUSADA
      // Se não tem CDMOTIVORECUSA mas tem localização, pode ser ACEITA
      // Se STATUS foi enviado explicitamente, usar esse valor
      let novoStatus = null;

      if (STATUS) {
        // Se STATUS foi enviado explicitamente, usar esse valor
        novoStatus = STATUS.toUpperCase();
      } else if (CDMOTIVORECUSA !== undefined && CDMOTIVORECUSA !== null && CDMOTIVORECUSA !== '') {
        // Se tem motivo de recusa, status é RECUSADA
        novoStatus = 'RECUSADA';
      } else if (LATITUDE !== undefined && LONGITUDE !== undefined &&
        LATITUDE !== null && LONGITUDE !== null &&
        LATITUDE !== '' && LONGITUDE !== '') {
        // Se tem localização mas não tem motivo de recusa, pode ser ACEITA
        // Mas só atualiza se ainda estiver PENDENTE
        if (statusAtual === 'PENDENTE') {
          novoStatus = 'ACEITA';
        }
      }

      // Montar query de atualização dinamicamente
      let updateFields = [];
      const updateRequest = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO));

      // Sempre atualizar DHRESPOSTA quando houver retorno (colunas entre colchetes para PostgreSQL)
      updateFields.push('[DHRESPOSTA] = GETDATE()');

      // Atualizar STATUS se determinado
      if (novoStatus) {
        updateFields.push('[STATUS] = @STATUS');
        updateRequest.input('STATUS', sql.VarChar(20), novoStatus);
      }

      if (LATITUDE !== undefined && LATITUDE !== null && LATITUDE !== '') {
        updateFields.push('[LATITUDE] = @LATITUDE');
        updateRequest.input('LATITUDE', sql.Decimal(18, 15), parseFloat(LATITUDE));
      }

      if (LONGITUDE !== undefined && LONGITUDE !== null && LONGITUDE !== '') {
        updateFields.push('[LONGITUDE] = @LONGITUDE');
        updateRequest.input('LONGITUDE', sql.Decimal(18, 15), parseFloat(LONGITUDE));
      }

      if (CDMOTIVORECUSA !== undefined && CDMOTIVORECUSA !== null && CDMOTIVORECUSA !== '') {
        updateFields.push('[CDMOTIVORECUSA] = @CDMOTIVORECUSA');
        updateRequest.input('CDMOTIVORECUSA', sql.Int, parseInt(CDMOTIVORECUSA));
      }

      // Adicionar campos de manutenção
      updateFields.push('[DHMAINTENANCE] = GETDATE()');
      updateFields.push('[SGUSER] = \'DESKRIO\'');

      const updateQuery = `
        UPDATE [dbo].[CONVOCACAO]
        SET ${updateFields.join(', ')}
        WHERE [IDCONVOCACAO] = @IDCONVOCACAO
      `;

      const result = await updateRequest.query(updateQuery);

      // Salvar log do callback (webhook não tem usuário logado; usa primeiro usuário do banco para FK)
      try {
        const firstUserResult = await pool.request().query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] ORDER BY [SGUSUARIO] LIMIT 1');
        const logSgUser = (firstUserResult.recordset && firstUserResult.recordset[0] && (firstUserResult.recordset[0].SGUSUARIO || firstUserResult.recordset[0].sgusuario)) || null;
        if (logSgUser) {
          const logRequest = pool.request()
            .input('IDCONVOCACAO', sql.Int, parseInt(IDCONVOCACAO))
            .input('TIPO', sql.VarChar(20), 'callback')
            .input('TITULO', sql.NVarChar(200), `Callback - Convocação ${IDCONVOCACAO}`)
            .input('MENSAGEM', sql.NVarChar(sql.MAX), `Callback recebido: ${novoStatus || 'sem alteração de status'}${CDMOTIVORECUSA ? ` | Motivo Recusa: ${CDMOTIVORECUSA}` : ''}${LATITUDE && LONGITUDE ? ' | Com localização' : ''}`)
            .input('DETALHES', sql.NVarChar(sql.MAX), JSON.stringify(dadosRecebidos))
            .input('STATUS_HTTP', sql.Int, 200)
            .input('TEMPO_RESPOSTA', sql.Int, Date.now() - inicioProcessamento)
            .input('sgUser', sql.VarChar(50), logSgUser);

          await logRequest.query(`
            INSERT INTO [dbo].[LOGSWEBHOOKMETA] 
              (IDCONVOCACAO, TIPO, TITULO, MENSAGEM, DETALHES, STATUS_HTTP, TEMPO_RESPOSTA, DHLOG, DHMAINTENANCE, SGUSER, SERVERORIG)
            VALUES 
              (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, GETDATE(), GETDATE(), @sgUser, 'AppDVcargas')
          `);
        }
      } catch (logErr) {
        console.error('[WEBHOOK RETORNO] Erro ao salvar log do callback:', logErr.message);
        // Não falhar a requisição se o log não for salvo
      }

      res.json({
        success: true,
        message: 'Dados recebidos e atualizados com sucesso!',
        camposAtualizados: {
          STATUS: novoStatus || 'não alterado',
          DHRESPOSTA: 'atualizado',
          LATITUDE: LATITUDE !== undefined ? 'atualizado' : 'não fornecido',
          LONGITUDE: LONGITUDE !== undefined ? 'atualizado' : 'não fornecido',
          CDMOTIVORECUSA: CDMOTIVORECUSA !== undefined ? 'atualizado' : 'não fornecido',
          DHMAINTENANCE: 'atualizado',
          SGUSER: 'DESKRIO'
        }
      });
    } catch (err) {
      console.error(`[WEBHOOK RETORNO] ❌ Erro ao processar retorno:`, err.message);
      res.status(500).json({ error: 'Erro ao processar retorno do webhook.', details: err.message });
    }
  },

  // Buscar histórico de viagens por roteiro
  buscarHistoricoRoteiro: async (req, res) => {
    try {
      const { idRoteiro } = req.query;

      if (!idRoteiro) {
        return res.status(400).json({ error: 'ID do Roteiro é obrigatório' });
      }

      const pool = await poolPromise;

      // Query principal para buscar as viagens do roteiro
      const viagensQuery = `
        SELECT 
          [VM].[IDVIAGEM],
          [TV].[DSTIPOVIAGEM],
          [SV].[DSSITUACAOVIAGEM],
          [CF].[DSCLASSEFROTA],
          [CF].[CDCLASSEFROTA],
          UPPER([CT].[RZSOCIAL]) AS CONTRATADOR,
          [CT].[NRCELULAR] AS CELCONTRATADOR,
          [VM].[DTPREVINICIO],
          [VM].[VLFRETE],
          [VM].[PESO],
          [VM].[FGRASTREADO],
          (SELECT UPPER([M].[RZSOCIAL])
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           INNER JOIN [dbo].[CADASTROGERAL] [M] ON [V].[CDMOTORISTA] = [M].[CDCADASTRO]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS MOTORISTA,
          (SELECT [M].[NRCELULAR]
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           INNER JOIN [dbo].[CADASTROGERAL] [M] ON [V].[CDMOTORISTA] = [M].[CDCADASTRO]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS CELMOTORISTA,
          (SELECT [V].[CDMOTORISTA]
           FROM [dbo].[VIAGEMMOTORISTA] [V]
           WHERE [V].[IDVIAGEM] = [VM].[IDVIAGEM] LIMIT 1) AS CDMOTORISTA
        FROM [dbo].[VIAGEMMESTRE] [VM]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [SV] ON [VM].[CDSITUACAOVIAGEM] = [SV].[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] [TV] ON [VM].[CDTIPOVIAGEM] = [TV].[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CLASSEFROTA] [CF] ON [VM].[CDCLASSEFROTA] = [CF].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[CADASTROGERAL] [CT] ON [VM].[CDCONTRATADOR] = [CT].[CDCADASTRO]
        WHERE [VM].[IDROTEIRO] = @IDROTEIRO
        ORDER BY [VM].[DTPREVINICIO] DESC, [VM].[IDVIAGEM]
      `;

      const request = pool.request();
      request.input('IDROTEIRO', sql.Int, parseInt(idRoteiro));
      const result = await request.query(viagensQuery);

      // Query para resumo por classe de frota
      const resumoQuery = `
        SELECT 
          [CF].[CDCLASSEFROTA],
          [CF].[DSCLASSEFROTA],
          COUNT(*) AS QUANTIDADE,
          MIN(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MINIMO,
          MAX(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MAXIMO,
          AVG(CASE WHEN [VM].[VLFRETE] >= 1 THEN [VM].[VLFRETE] ELSE NULL END) AS VALOR_MEDIO,
          SUM([VM].[PESO]) AS PESO_TOTAL
        FROM [dbo].[VIAGEMMESTRE] [VM]
        LEFT JOIN [dbo].[CLASSEFROTA] [CF] ON [VM].[CDCLASSEFROTA] = [CF].[CDCLASSEFROTA]
        WHERE [VM].[IDROTEIRO] = @IDROTEIRO
        GROUP BY [CF].[CDCLASSEFROTA], [CF].[DSCLASSEFROTA]
        ORDER BY [CF].[DSCLASSEFROTA]
      `;

      const resumoRequest = pool.request();
      resumoRequest.input('IDROTEIRO', sql.Int, parseInt(idRoteiro));
      const resumoResult = await resumoRequest.query(resumoQuery);

      // Formatar resumo (compatível com SQL Server maiúsculas e PostgreSQL minúsculas)
      const get = (row, ...keys) => {
        for (const k of keys) {
          if (row[k] !== undefined && row[k] !== null) return row[k];
          const lower = k.toLowerCase();
          if (row[lower] !== undefined && row[lower] !== null) return row[lower];
        }
        return undefined;
      };
      const resumo = resumoResult.recordset.map(item => {
        const qtd = get(item, 'QUANTIDADE') ?? 0;
        const vMin = get(item, 'VALOR_MINIMO');
        const vMax = get(item, 'VALOR_MAXIMO');
        const vMed = get(item, 'VALOR_MEDIO');
        const pTotal = get(item, 'PESO_TOTAL');
        return {
          classefrota: get(item, 'DSCLASSEFROTA') || 'Não Informada',
          quantidade: Number(qtd),
          valorMinimo: vMin != null ? parseFloat(vMin).toFixed(2) : '0.00',
          valorMaximo: vMax != null ? parseFloat(vMax).toFixed(2) : '0.00',
          valorMedio: vMed != null ? parseFloat(vMed).toFixed(2) : '0.00',
          pesoTotal: pTotal != null ? parseFloat(pTotal).toFixed(2) : '0.00'
        };
      });

      // Formatar viagens (compatível com SQL Server maiúsculas e PostgreSQL minúsculas)
      const viagens = result.recordset.map(viagem => {
        const v = (key, def) => (viagem[key] ?? viagem[key?.toLowerCase?.()] ?? def);
        return {
          idViagem: v('IDVIAGEM', null),
          tipoViagem: v('DSTIPOVIAGEM', null),
          situacaoViagem: v('DSSITUACAOVIAGEM', null),
          classeFrota: v('DSCLASSEFROTA', null),
          contratador: v('CONTRATADOR', null),
          celContratador: v('CELCONTRATADOR', null),
          dtPrevInicio: v('DTPREVINICIO', null),
          vlFrete: v('VLFRETE', 0) != null ? parseFloat(v('VLFRETE', 0)).toFixed(2) : '0.00',
          peso: v('PESO', 0) != null ? parseFloat(v('PESO', 0)).toFixed(2) : '0.00',
          rastreado: (v('FGRASTREADO', '') === 'S' || v('FGRASTREADO', '') === 's') ? 'Sim' : 'Não',
          motorista: v('MOTORISTA', null) || 'Não Informado',
          celMotorista: v('CELMOTORISTA', null),
          cdMotorista: v('CDMOTORISTA', null)
        };
      });

      res.json({
        success: true,
        totalRegistros: viagens.length,
        viagens: viagens,
        resumo: resumo
      });

    } catch (err) {
      console.error('[ERRO] Buscar histórico roteiro:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico do roteiro', details: err.message });
    }
  }
};

module.exports = viagemController;
