// backend/controllers/viagemmestre.controller.js
// Controller para Gerenciamento de Viagens
// Versão: 1.0
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const sql = require('mssql');
const axios = require('axios');
const { poolPromise } = require('../config/db');

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
          v.IDVIAGEM,
          v.FGSITVIAGEM,
          v.CDSITUACAOVIAGEM,
          s.DSSITUACAOVIAGEM,
          v.CDTIPOVIAGEM,
          t.DSTIPOVIAGEM,
          v.SGUSERINCLUSAO,
          v.DHINCLUSAO,
          v.CDCONTRATADOR,
          cg.RZSOCIAL AS CONTRATADOR_NOME,
          v.FGACTIVE,
          v.CDCLASSEFROTA,
          cf.DSCLASSEFROTA,
          v.DTPREVINICIO,
          v.DTPREVFINAL,
          v.IDROTEIRO,
          r.DSROTEIRO,
          v.DISTANCIAKM,
          v.VLFRETE,
          v.PESO,
          v.CUBAGEM,
          v.OBSERV,
          co.ESTADO AS ORIGEM_ESTADO,
          co.NMCIDADE AS ORIGEM_CIDADE,
          co.CDCIDADE AS ORIGEM_CODIGO,
          cd.ESTADO AS DESTINO_ESTADO,
          cd.NMCIDADE AS DESTINO_CIDADE,
          cd.CDCIDADE AS DESTINO_CODIGO,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM) AS QTD_ACIONADOS,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM AND STATUS IN ('ACEITA', 'ACEITA_DESCARTADA')) AS QTD_ACEITE,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM AND STATUS = 'RECUSADA') AS QTD_RECUSA,
          CASE 
            WHEN EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM AND STATUS = 'CONFIRMADA') THEN 'S'
            ELSE 'N'
          END AS TEM_CONFIRMADO
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON v.CDSITUACAOVIAGEM = s.CDSITUACAOVIAGEM
        LEFT JOIN [dbo].[TIPOVIAGEM] t ON v.CDTIPOVIAGEM = t.CDTIPOVIAGEM
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON v.CDCONTRATADOR = cg.CDCADASTRO
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
        LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE 1=1
      `;

      const params = [];
      if (idViagem) {
        query += ` AND v.IDVIAGEM = @IDVIAGEM`;
        params.push({ name: 'IDVIAGEM', value: parseFloat(idViagem) });
      }
      if (situacaoViagem) {
        query += ` AND v.FGSITVIAGEM = @SITUACAOVIAGEM`;
        params.push({ name: 'SITUACAOVIAGEM', value: situacaoViagem });
      }
      if (tipoViagem) {
        query += ` AND v.CDTIPOVIAGEM = @TIPOVIAGEM`;
        params.push({ name: 'TIPOVIAGEM', value: parseInt(tipoViagem) });
      }
      if (classeFrota) {
        query += ` AND v.CDCLASSEFROTA = @CLASSEFROTA`;
        params.push({ name: 'CLASSEFROTA', value: parseInt(classeFrota) });
      }
      if (contratador) {
        query += ` AND v.CDCONTRATADOR = @CONTRATADOR`;
        params.push({ name: 'CONTRATADOR', value: parseFloat(contratador) });
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
      if (roteiro) {
        query += ` AND v.IDROTEIRO = @ROTEIRO`;
        params.push({ name: 'ROTEIRO', value: parseFloat(roteiro) });
      }
      if (dataInicio) {
        query += ` AND v.DTPREVINICIO >= @DATAINICIO`;
        params.push({ name: 'DATAINICIO', value: new Date(dataInicio) });
      }
      if (dataFim) {
        query += ` AND v.DTPREVFINAL <= @DATAFIM`;
        params.push({ name: 'DATAFIM', value: new Date(dataFim) });
      }
      if (frete) {
        query += ` AND v.VLFRETE = @FRETE`;
        params.push({ name: 'FRETE', value: parseFloat(frete) });
      }
      if (peso) {
        query += ` AND v.PESO = @PESO`;
        params.push({ name: 'PESO', value: parseFloat(peso) });
      }
      if (cubagem) {
        query += ` AND v.CUBAGEM = @CUBAGEM`;
        params.push({ name: 'CUBAGEM', value: parseFloat(cubagem) });
      }
      if (rastreado) {
        query += ` AND v.FGRASTREADO = @RASTREADO`;
        params.push({ name: 'RASTREADO', value: rastreado });
      }
      if (motoristaConfirmado) {
        if (motoristaConfirmado === 'S') {
          query += ` AND EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM AND STATUS = 'CONFIRMADA')`;
        } else if (motoristaConfirmado === 'N') {
          query += ` AND NOT EXISTS (SELECT 1 FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM AND STATUS = 'CONFIRMADA')`;
        }
      }

      query += ` ORDER BY v.IDVIAGEM DESC`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => request.input(p.name, p.value));
      
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
        TEM_CONFIRMADO: v.TEM_CONFIRMADO || 'N'
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
        VLFRETE, PESO, CUBAGEM, OBSERV, FGRASTREADO
      } = req.body;

      // Validações obrigatórias
      if (!FGSITVIAGEM || !CDSITUACAOVIAGEM || !CDTIPOVIAGEM) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

      const pool = await poolPromise;
      
      // Gerar novo ID
      const maxResult = await pool
        .request()
        .query('SELECT ISNULL(MAX(IDVIAGEM), 0) AS maxId FROM [dbo].[VIAGEMMESTRE]');
      const novoId = maxResult.recordset[0].maxId + 1;

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
      request.input('SGUSERINCLUSAO', 'SYSTEM');
      request.input('DHINCLUSAO', new Date());

      await request.query(`
        INSERT INTO [dbo].[VIAGEMMESTRE] (
          IDVIAGEM, FGSITVIAGEM, CDSITUACAOVIAGEM, CDTIPOVIAGEM, CDCONTRATADOR,
          CDCLASSEFROTA, DTPREVINICIO, DTPREVFINAL, IDROTEIRO, DISTANCIAKM,
          VLFRETE, PESO, CUBAGEM, OBSERV, FGRASTREADO, SGUSERINCLUSAO, DHINCLUSAO,
          FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @IDVIAGEM, @FGSITVIAGEM, @CDSITUACAOVIAGEM, @CDTIPOVIAGEM, @CDCONTRATADOR,
          @CDCLASSEFROTA, @DTPREVINICIO, @DTPREVFINAL, @IDROTEIRO, @DISTANCIAKM,
          @VLFRETE, @PESO, @CUBAGEM, @OBSERV, @FGRASTREADO, @SGUSERINCLUSAO, @DHINCLUSAO,
          'A', GETDATE(), 'SYSTEM', 'AppDVcargas'
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
        VLFRETE, PESO, CUBAGEM, OBSERV, FGACTIVE, FGRASTREADO
      } = req.body;

      if (!FGSITVIAGEM || !CDSITUACAOVIAGEM || !CDTIPOVIAGEM || !FGACTIVE) {
        return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
      }

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

      await request.query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET 
          FGSITVIAGEM = @FGSITVIAGEM,
          CDSITUACAOVIAGEM = @CDSITUACAOVIAGEM,
          CDTIPOVIAGEM = @CDTIPOVIAGEM,
          CDCONTRATADOR = @CDCONTRATADOR,
          CDCLASSEFROTA = @CDCLASSEFROTA,
          DTPREVINICIO = @DTPREVINICIO,
          DTPREVFINAL = @DTPREVFINAL,
          IDROTEIRO = @IDROTEIRO,
          DISTANCIAKM = @DISTANCIAKM,
          VLFRETE = @VLFRETE,
          PESO = @PESO,
          CUBAGEM = @CUBAGEM,
          OBSERV = @OBSERV,
          FGACTIVE = @FGACTIVE,
          FGRASTREADO = @FGRASTREADO,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE IDVIAGEM = @IDVIAGEM
      `);

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
            v.IDVIAGEM,
            v.FGSITVIAGEM,
            v.CDSITUACAOVIAGEM,
            v.CDTIPOVIAGEM,
            v.SGUSERINCLUSAO,
            v.DHINCLUSAO,
            v.CDCONTRATADOR,
            v.FGACTIVE,
            v.CDCLASSEFROTA,
            v.DTPREVINICIO,
            v.DTPREVFINAL,
            v.IDROTEIRO,
            v.DISTANCIAKM,
            v.VLFRETE,
            v.PESO,
            v.CUBAGEM,
            v.OBSERV,
            v.FGRASTREADO,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO,
            r.DSROTEIRO,
            co.ESTADO AS ORIGEM_ESTADO,
            co.NMCIDADE AS ORIGEM_CIDADE,
            cd.ESTADO AS DESTINO_ESTADO,
            cd.NMCIDADE AS DESTINO_CIDADE,
            cf.DSCLASSEFROTA,
            tv.DSTIPOVIAGEM,
            cg.RZSOCIAL AS CONTRATADOR_NOME
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
          LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.CDTIPOVIAGEM = tv.CDTIPOVIAGEM
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON v.CDCONTRATADOR = cg.CDCADASTRO
          WHERE v.IDVIAGEM = @IDVIAGEM
        `);
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }
      
      const v = result.recordset[0];
      res.json({
        IDVIAGEM: v.IDVIAGEM,
        FGSITVIAGEM: v.FGSITVIAGEM,
        CDSITUACAOVIAGEM: v.CDSITUACAOVIAGEM,
        CDTIPOVIAGEM: v.CDTIPOVIAGEM,
        DSTIPOVIAGEM: v.DSTIPOVIAGEM,
        SGUSERINCLUSAO: v.SGUSERINCLUSAO,
        DHINCLUSAO: v.DHINCLUSAO,
        CDCONTRATADOR: v.CDCONTRATADOR,
        CONTRATADOR_NOME: v.CONTRATADOR_NOME,
        FGACTIVE: v.FGACTIVE === 'A' ? 'S' : 'N',
        CDCLASSEFROTA: v.CDCLASSEFROTA,
        DSCLASSEFROTA: v.DSCLASSEFROTA,
        DTPREVINICIO: v.DTPREVINICIO,
        DTPREVFINAL: v.DTPREVFINAL,
        IDROTEIRO: v.IDROTEIRO,
        DSROTEIRO: v.DSROTEIRO,
        DISTANCIAKM: v.DISTANCIAKM,
        VLFRETE: v.VLFRETE,
        PESO: v.PESO,
        CUBAGEM: v.CUBAGEM,
        OBSERV: v.OBSERV,
        FGRASTREADO: v.FGRASTREADO || 'N',
        ORIGEM_ESTADO: v.ORIGEM_ESTADO,
        ORIGEM_CIDADE: v.ORIGEM_CIDADE,
        ORIGEM_CODIGO: v.CDCIDADEORIGEM,
        DESTINO_ESTADO: v.DESTINO_ESTADO,
        DESTINO_CIDADE: v.DESTINO_CIDADE,
        DESTINO_CODIGO: v.CDCIDADEDESTINO
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
        SELECT FGACTIVE FROM [dbo].[VIAGEMMESTRE] WHERE IDVIAGEM = @IDVIAGEM
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
      request.input('IDVIAGEM', sql.Decimal(15, 0), idNumerico);
      request.input('FGACTIVE', sql.Char(1), novaSituacao);
      
      const result = await request.query(`
        UPDATE [dbo].[VIAGEMMESTRE]
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
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
        .query('SELECT CDTIPOVIAGEM, DSTIPOVIAGEM FROM [dbo].[TIPOVIAGEM] WHERE FGACTIVE = \'A\' ORDER BY DSTIPOVIAGEM');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar tipos de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar tipos de viagem.' });
    }
  },

  listarSituacoesViagem: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT CDSITUACAOVIAGEM, DSSITUACAOVIAGEM FROM [dbo].[SITUACAOVIAGEM] WHERE FGACTIVE = \'A\' ORDER BY DSSITUACAOVIAGEM');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar situações de viagem:', err);
      res.status(500).json({ error: 'Erro ao carregar situações de viagem.' });
    }
  },

  listarClassesFrota: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT CDCLASSEFROTA, DSCLASSEFROTA FROM [dbo].[CLASSEFROTA] WHERE FGACTIVE = \'A\' ORDER BY DSCLASSEFROTA');
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar classes de frota:', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  listarContratadores: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query(`
          SELECT CDCADASTRO, RZSOCIAL 
          FROM [dbo].[CADASTROGERAL] 
          WHERE FGTIPOCADASTRO = 'O' AND FGACTIVE = 'A' 
          ORDER BY RZSOCIAL
        `);
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao carregar contratadores:', err);
      res.status(500).json({ error: 'Erro ao carregar contratadores.' });
    }
  },

  listarMotivosRecusa: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool
        .request()
        .query('SELECT CDMOTIVO, DSMOTIVO FROM [dbo].[MOTIVORECUSA] WHERE FGACTIVE = \'A\' ORDER BY DSMOTIVO');
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
        .query('SELECT CDMOTIVO, DSMOTIVO FROM [dbo].[MOTIVOREABERTURA] WHERE FGACTIVE = \'A\' ORDER BY DSMOTIVO');
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
        SELECT r.IDROTEIRO, r.DSROTEIRO, r.DISTANCIAKM,
               r.CDCIDADEORIGEM AS ORIGEM_CODIGO,
               co.ESTADO AS ORIGEM_ESTADO, co.NMCIDADE AS ORIGEM_CIDADE,
               r.CDCIDADEDESTINO AS DESTINO_CODIGO,
               cd.ESTADO AS DESTINO_ESTADO, cd.NMCIDADE AS DESTINO_CIDADE
        FROM [dbo].[ROTEIRO] r
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE 1=1
      `;
      
      const params = [];
      if (origem) {
        query += ` AND r.CDCIDADEORIGEM = @ORIGEM`;
        params.push({ name: 'ORIGEM', value: parseInt(origem) });
      }
      if (destino) {
        query += ` AND r.CDCIDADEDESTINO = @DESTINO`;
        params.push({ name: 'DESTINO', value: parseInt(destino) });
      }
      if (roteiro) {
        query += ` AND r.IDROTEIRO = @ROTEIRO`;
        params.push({ name: 'ROTEIRO', value: parseInt(roteiro) });
      }
      
      query += ` ORDER BY r.IDROTEIRO`;

      const pool = await poolPromise;
      const request = pool.request();
      params.forEach(p => request.input(p.name, p.value));
      
      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
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
        .query('SELECT CDCIDADE, NMCIDADE FROM [dbo].[CIDADE] WHERE ESTADO = @ESTADO AND FGACTIVE = \'A\' ORDER BY NMCIDADE');
      res.json(result.recordset);
    } catch (err) {
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
          v.IDVIAGEM,
          v.FGSITVIAGEM,
          v.CDSITUACAOVIAGEM,
          s.DSSITUACAOVIAGEM,
          v.CDTIPOVIAGEM,
          t.DSTIPOVIAGEM,
          v.CDCONTRATADOR,
          cg.RZSOCIAL AS CONTRATADOR_NOME,
          v.CDCLASSEFROTA,
          cf.DSCLASSEFROTA,
          v.FGRASTREADO,
          v.DTPREVINICIO,
          v.DTPREVFINAL,
          v.VLFRETE,
          co.ESTADO AS ORIGEM_ESTADO,
          co.NMCIDADE AS ORIGEM_CIDADE,
          co.CDCIDADE AS ORIGEM_CODIGO,
          co.CDMICROREGIAO AS ORIGEM_MICROREGIAO,
          cd.ESTADO AS DESTINO_ESTADO,
          cd.NMCIDADE AS DESTINO_CIDADE,
          cd.CDCIDADE AS DESTINO_CODIGO,
          cd.CDMICROREGIAO AS DESTINO_MICROREGIAO
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] s ON v.CDSITUACAOVIAGEM = s.CDSITUACAOVIAGEM
        LEFT JOIN [dbo].[TIPOVIAGEM] t ON v.CDTIPOVIAGEM = t.CDTIPOVIAGEM
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON v.CDCONTRATADOR = cg.CDCADASTRO
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
        LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE v.FGACTIVE = 'A'
          AND v.FGSITVIAGEM IN ('P', 'D') -- Programada ou Preparação
          AND NOT EXISTS (
            SELECT 1 
            FROM [dbo].[CONVOCACAO] c 
            WHERE c.IDVIAGEM = v.IDVIAGEM 
              AND c.STATUS IN ('ACEITA', 'CONFIRMADA')
          )
        ORDER BY v.DTPREVINICIO DESC
      `;
      
      const result = await pool.request().query(query);
      res.json(result.recordset);
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
      
      // Primeiro, buscar os dados da viagem
      const viagemResult = await pool
        .request()
        .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
        .query(`
          SELECT 
            v.CDCLASSEFROTA,
            v.FGRASTREADO,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO
          FROM [dbo].[VIAGEMMESTRE] v
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          WHERE v.IDVIAGEM = @IDVIAGEM
        `);

      if (viagemResult.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const viagem = viagemResult.recordset[0];
      const { CDCLASSEFROTA, FGRASTREADO, CDCIDADEORIGEM, CDCIDADEDESTINO } = viagem;

      // Buscar micro-regiões das cidades de origem e destino
      const cidadesResult = await pool
        .request()
        .input('ORIGEM', CDCIDADEORIGEM || null)
        .input('DESTINO', CDCIDADEDESTINO || null)
        .query(`
          SELECT 
            CDCIDADE,
            CDMICROREGIAO,
            NMCIDADE,
            ESTADO
          FROM [dbo].[CIDADE]
          WHERE CDCIDADE IN (@ORIGEM, @DESTINO)
        `);

      const microregioes = cidadesResult.recordset.map(c => c.CDMICROREGIAO).filter(m => m);

      // Buscar motoristas que têm a classe de frota cadastrada na tabela CLASSEFROTA_CG
      // A relação entre motoristas e classes de frota está na tabela CLASSEFROTA_CG, não em EQUIPAMENTO
      
      let query = `
        SELECT DISTINCT
          cg.CDCADASTRO AS CDCADASTRO_MOTORISTA,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          cg.NRCELULAR AS CELULAR,
          cg.ENDEMAIL AS EMAIL,
          cg.CDTRANSPORTADOR,
          t.RZSOCIAL AS TRANSPORTADOR_NOME,
          c.CDCIDADE,
          c.NMCIDADE AS CIDADE_NOME,
          c.ESTADO AS CIDADE_ESTADO,
          c.CDMICROREGIAO,
          cfcg.CDCLASSEFROTA,
          cf.DSCLASSEFROTA AS CLASSE_FROTA_NOME,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] conv 
              WHERE conv.CDCADASTRO_MOTORISTA = cg.CDCADASTRO 
                AND conv.IDVIAGEM = @IDVIAGEM
            ) THEN 1 
            ELSE 0 
          END AS FOI_ACIONADO
        FROM [dbo].[CADASTROGERAL] cg
        INNER JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
        INNER JOIN [dbo].[CLASSEFROTA_CG] cfcg ON cg.CDCADASTRO = cfcg.CDCADASTRO
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON cfcg.CDCLASSEFROTA = cf.CDCLASSEFROTA
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
        WHERE cg.FGTIPOCADASTRO = 'M'
          AND cg.FGACTIVE = 'A'
          AND cfcg.FGACTIVE = 'S'
          AND cfcg.CDCLASSEFROTA = @CDCLASSEFROTA
      `;

      const request = pool.request();
      // Adicionar IDVIAGEM para o JOIN com CONVOCACAO
      request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
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
        query += ` AND ISNULL(cg.FGRASTREADO, 'N') = 'S'`;
      }

      // Filtro de localização (micro-região ou cidade)
      let temFiltroLocalizacao = false;
      
      if (microregioes.length > 0) {
        // Buscar por micro-região
        const microParams = microregioes.map((_, i) => {
          const paramName = `MICRO${i}`;
          request.input(paramName, sql.SmallInt, microregioes[i]);
          return `@${paramName}`;
        });
        query += ` AND c.CDMICROREGIAO IN (${microParams.join(', ')})`;
        temFiltroLocalizacao = true;
      }
      
      // Se não há micro-região, buscar por cidade de origem ou destino
      if (!temFiltroLocalizacao) {
        if (CDCIDADEORIGEM && CDCIDADEDESTINO) {
          query += ` AND (c.CDCIDADE = @CIDADE_ORIGEM OR c.CDCIDADE = @CIDADE_DESTINO)`;
          request.input('CIDADE_ORIGEM', sql.Decimal(15, 0), CDCIDADEORIGEM);
          request.input('CIDADE_DESTINO', sql.Decimal(15, 0), CDCIDADEDESTINO);
          temFiltroLocalizacao = true;
        } else if (CDCIDADEORIGEM) {
          query += ` AND c.CDCIDADE = @CIDADE_ORIGEM`;
          request.input('CIDADE_ORIGEM', sql.Decimal(15, 0), CDCIDADEORIGEM);
          temFiltroLocalizacao = true;
        } else if (CDCIDADEDESTINO) {
          query += ` AND c.CDCIDADE = @CIDADE_DESTINO`;
          request.input('CIDADE_DESTINO', sql.Decimal(15, 0), CDCIDADEDESTINO);
          temFiltroLocalizacao = true;
        }
      }
      
      // Se não há filtro de localização, não retornar resultados
      if (!temFiltroLocalizacao) {
        query += ` AND 1=0`;
      }

      query += ` ORDER BY cg.RZSOCIAL, cfcg.CDCLASSEFROTA`;

      // Verificações de diagnóstico
      // Verificar motoristas na micro-região
      const diagMotoristasMicro = await pool.request().query(`
        SELECT COUNT(*) AS TOTAL
        FROM [dbo].[CADASTROGERAL] cg
        INNER JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
        WHERE cg.FGTIPOCADASTRO = 'M'
          AND cg.FGACTIVE = 'A'
          AND c.CDMICROREGIAO IN (${microregioes.join(', ')})
      `);
      
      const result = await request.query(query);
      
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao buscar motoristas compatíveis:', err);
      res.status(500).json({ error: 'Erro ao buscar motoristas compatíveis.' });
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
          SELECT SGUSUARIO
          FROM [dbo].[USUARIO]
          WHERE SGUSUARIO = @SGUSUARIO
            AND (FGACTIVE = 'A' OR FGACTIVE = 'S')
        `);
      
      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível criar convocações.' });
      }

      const usuarioOperador = userLogin;
      
      // Buscar próximo ID de convocação
      const maxResult = await pool
        .request()
        .query('SELECT ISNULL(MAX(IDCONVOCACAO), 0) AS maxId FROM [dbo].[CONVOCACAO]');
      let proximoId = maxResult.recordset[0].maxId + 1;

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
              IDCONVOCACAO,
              NRCELULAR,
              TXTCONVOCACAO,
              LINKCONVOCACAO,
              STATUS
            FROM [dbo].[CONVOCACAO]
            WHERE IDVIAGEM = @IDVIAGEM
              AND CDCADASTRO_MOTORISTA = @CDCADASTRO_MOTORISTA
            ORDER BY DHCONVOCACAO DESC
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
        
        // Não existe - criar nova convocação
        const request = pool.request()
          .input('IDCONVOCACAO', sql.Int, proximoId)
          .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
          .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), CDCADASTRO_MOTORISTA)
          .input('STATUS', sql.VarChar(20), 'PENDENTE')
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), usuarioOperador);
        
        // Adicionar campos opcionais se fornecidos
        let camposInsert = 'IDCONVOCACAO, IDVIAGEM, CDCADASTRO_MOTORISTA, STATUS, DHCONVOCACAO, SGUSUARIO_OPERADOR, DHMAINTENANCE, SGUSER, SERVERORIG';
        let valoresInsert = '@IDCONVOCACAO, @IDVIAGEM, @CDCADASTRO_MOTORISTA, @STATUS, GETDATE(), @SGUSUARIO_OPERADOR, GETDATE(), \'SYSTEM\', \'AppDVcargas\'';
        
        if (NRCELULAR !== undefined && NRCELULAR !== null) {
          camposInsert += ', NRCELULAR';
          valoresInsert += ', @NRCELULAR';
          request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
        }
        
        if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null) {
          camposInsert += ', TXTCONVOCACAO';
          valoresInsert += ', @TXTCONVOCACAO';
          request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
        }
        
        if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null) {
          camposInsert += ', LINKCONVOCACAO';
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
          c.IDCONVOCACAO,
          c.IDVIAGEM,
          c.CDCADASTRO_MOTORISTA,
          c.STATUS,
          c.DHCONVOCACAO,
          c.DHACESSO,
          c.DHRESPOSTA,
          c.SGUSUARIO_OPERADOR,
          c.LATITUDE,
          c.LONGITUDE,
          c.CDMOTIVORECUSA,
          mr.DSMOTIVO AS MOTIVO_RECUSA,
          c.CDMOTIVOREABERTURA,
          mra.DSMOTIVO AS MOTIVO_REABERTURA,
          v.IDROTEIRO,
          v.CDCLASSEFROTA,
          v.DTPREVINICIO,
          v.DTPREVFINAL,
          v.FGRASTREADO,
          v.VLFRETE,
          v.PESO,
          v.CUBAGEM,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          cg.NRCELULAR AS CELULAR_MOTORISTA,
          cf.DSCLASSEFROTA,
          r.CDCIDADEORIGEM,
          r.CDCIDADEDESTINO,
          r.DSROTEIRO,
          co.NMCIDADE AS ORIGEM_CIDADE,
          co.ESTADO AS ORIGEM_ESTADO,
          cd.NMCIDADE AS DESTINO_CIDADE,
          cd.ESTADO AS DESTINO_ESTADO,
          CASE 
            WHEN EXISTS (
              SELECT 1 
              FROM [dbo].[CONVOCACAO] c2 
              WHERE c2.IDVIAGEM = c.IDVIAGEM 
                AND c2.STATUS = 'CONFIRMADA'
                AND c2.IDCONVOCACAO != c.IDCONVOCACAO
            ) THEN 1 
            ELSE 0 
          END AS VIAGEM_JA_CONFIRMADA
        FROM [dbo].[CONVOCACAO] c
        INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
        INNER JOIN [dbo].[CADASTROGERAL] cg ON c.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
        LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN [dbo].[MOTIVORECUSA] mr ON c.CDMOTIVORECUSA = mr.CDMOTIVO
          LEFT JOIN [dbo].[MOTIVOREABERTURA] mra ON c.CDMOTIVOREABERTURA = mra.CDMOTIVO
          WHERE 1=1
      `;

      const request = pool.request();

      if (idViagem) {
        query += ` AND c.IDVIAGEM = @IDVIAGEM`;
        request.input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(idViagem));
      }

      if (status) {
        query += ` AND c.STATUS = @STATUS`;
        request.input('STATUS', sql.VarChar(20), status);
      }

      if (cdcadastroMotorista) {
        query += ` AND c.CDCADASTRO_MOTORISTA = @CDCADASTRO_MOTORISTA`;
        request.input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), parseFloat(cdcadastroMotorista));
      }

      query += ` ORDER BY c.DHCONVOCACAO DESC`;

      const result = await request.query(query);
      res.json(result.recordset);
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
            c.IDCONVOCACAO,
            c.IDVIAGEM,
            c.CDCADASTRO_MOTORISTA,
            c.STATUS,
            c.DHCONVOCACAO,
            c.DHRESPOSTA,
            c.SGUSUARIO_OPERADOR,
            v.CDCLASSEFROTA,
            v.DTPREVINICIO,
            v.DTPREVFINAL,
            v.FGRASTREADO,
            v.OBSERV,
            cg.RZSOCIAL AS NOME_MOTORISTA,
            cg.NRCELULAR AS CELULAR_MOTORISTA,
            cf.DSCLASSEFROTA,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO,
            co.NMCIDADE AS ORIGEM_CIDADE,
            co.ESTADO AS ORIGEM_ESTADO,
            cd.NMCIDADE AS DESTINO_CIDADE,
            cd.ESTADO AS DESTINO_ESTADO
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
          INNER JOIN [dbo].[CADASTROGERAL] cg ON c.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          WHERE c.IDCONVOCACAO = @IDCONVOCACAO
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
      
      if (NRCELULAR !== undefined && NRCELULAR !== null) {
        updates.push('NRCELULAR = @NRCELULAR');
        request.input('NRCELULAR', sql.VarChar(20), NRCELULAR);
      }
      
      if (TXTCONVOCACAO !== undefined && TXTCONVOCACAO !== null) {
        updates.push('TXTCONVOCACAO = @TXTCONVOCACAO');
        request.input('TXTCONVOCACAO', sql.NVarChar(sql.MAX), TXTCONVOCACAO);
      }
      
      if (LINKCONVOCACAO !== undefined && LINKCONVOCACAO !== null) {
        updates.push('LINKCONVOCACAO = @LINKCONVOCACAO');
        request.input('LINKCONVOCACAO', sql.VarChar(500), LINKCONVOCACAO);
      }
      
      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar foi informado.' });
      }
      
      updates.push('DHMAINTENANCE = GETDATE()');
      
      await request.query(`
        UPDATE [dbo].[CONVOCACAO]
        SET ${updates.join(', ')}
        WHERE IDCONVOCACAO = @IDCONVOCACAO
      `);
      
      res.json({ 
        success: true, 
        message: 'Convocação atualizada com sucesso!' 
      });
    } catch (err) {
      console.error('Erro ao atualizar convocação:', err);
      res.status(500).json({ 
        error: 'Erro ao atualizar convocação.',
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

      const pool = await poolPromise;
      await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .input('STATUS', sql.VarChar(20), status)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET STATUS = @STATUS,
              DHRESPOSTA = CASE WHEN @STATUS IN ('ACEITA', 'RECUSADA') THEN GETDATE() ELSE DHRESPOSTA END,
              DHMAINTENANCE = GETDATE(),
              SGUSER = 'SYSTEM'
          WHERE IDCONVOCACAO = @IDCONVOCACAO
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
      const userLogin = req.headers['user-login'];
      
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
          SELECT SGUSUARIO
          FROM [dbo].[USUARIO]
          WHERE SGUSUARIO = @SGUSUARIO
            AND (FGACTIVE = 'A' OR FGACTIVE = 'S')
        `);
      
      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível confirmar convocações.' });
      }
      
      // Primeiro, buscar a convocação para obter o IDVIAGEM
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT IDCONVOCACAO, IDVIAGEM, STATUS
          FROM [dbo].[CONVOCACAO]
          WHERE IDCONVOCACAO = @IDCONVOCACAO
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
          SELECT IDCONVOCACAO
          FROM [dbo].[CONVOCACAO]
          WHERE IDVIAGEM = @IDVIAGEM
            AND STATUS = 'CONFIRMADA'
            AND IDCONVOCACAO != @IDCONVOCACAO
        `);
      
      if (confirmadaResult.recordset.length > 0) {
        return res.status(400).json({ 
          error: 'Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.' 
        });
      }
      
      // Iniciar transação para garantir atomicidade (após todas as validações)
      transaction = new sql.Transaction(pool);
      await transaction.begin();
      console.log(`[CONFIRMAR] Transação iniciada para convocação ${id}`);
      
      try {
        // 1. Confirmar a convocação selecionada
        const request1 = new sql.Request(transaction);
        await request1
          .input('IDCONVOCACAO_CONFIRM', sql.Int, parseInt(id))
          .input('SGUSUARIO_OPERADOR_CONFIRM', sql.VarChar(50), userLogin)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET STATUS = 'CONFIRMADA',
                DHRESPOSTA = GETDATE(),
                SGUSUARIO_OPERADOR = @SGUSUARIO_OPERADOR_CONFIRM,
                DHMAINTENANCE = GETDATE(),
                SGUSER = 'SYSTEM'
            WHERE IDCONVOCACAO = @IDCONVOCACAO_CONFIRM
          `);
        
        // 2. NÃO recusar convocações PENDENTES automaticamente
        // Apenas manter como PENDENTE - não alterar status de quem não respondeu
        // Isso preserva o histórico correto: só marca como RECUSADA se o motorista realmente recusou
        
        // 3. Marcar outras convocações ACEITAS como DESCARTADAS (mantém histórico de aceite)
        const request3 = new sql.Request(transaction);
        await request3
          .input('IDVIAGEM_DESCARTAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_EXCLUIR_DESC', sql.Int, parseInt(id))
          .input('SGUSUARIO_OPERADOR_DESC', sql.VarChar(50), userLogin)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET STATUS = 'ACEITA_DESCARTADA',
                SGUSUARIO_OPERADOR = @SGUSUARIO_OPERADOR_DESC,
                DHMAINTENANCE = GETDATE(),
                SGUSER = 'SYSTEM'
            WHERE IDVIAGEM = @IDVIAGEM_DESCARTAR
              AND IDCONVOCACAO != @IDCONVOCACAO_EXCLUIR_DESC
              AND STATUS = 'ACEITA'
          `);
        
        await transaction.commit();
        console.log(`[CONFIRMAR] Transação commitada com sucesso para convocação ${id}`);
        
        // Buscar dados do motorista confirmado para enviar WhatsApp
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .query(`
            SELECT 
              cg.RZSOCIAL AS NOME_MOTORISTA,
              cg.NRCELULAR,
              v.IDVIAGEM,
              v.DTPREVINICIO,
              v.DTPREVFINAL,
              v.CDCONTRATADOR,
              co.NMCIDADE AS ORIGEM_CIDADE,
              co.ESTADO AS ORIGEM_ESTADO,
              cd.NMCIDADE AS DESTINO_CIDADE,
              cd.ESTADO AS DESTINO_ESTADO,
              r.DSROTEIRO,
              contratador.RZSOCIAL AS CONTRATADOR_NOME,
              contratador.NRCELULAR AS CONTRATADOR_CELULAR
            FROM [dbo].[CONVOCACAO] c
            INNER JOIN [dbo].[CADASTROGERAL] cg ON c.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
            INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
            LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
            LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
            LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
            LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.CDCONTRATADOR = contratador.CDCADASTRO
            WHERE c.IDCONVOCACAO = @IDCONVOCACAO_MOT
          `);
        
        // Contar quantas foram afetadas para mensagem
        const countAceitasDescartadas = await pool
          .request()
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE IDVIAGEM = @IDVIAGEM_COUNT
              AND IDCONVOCACAO != @IDCONVOCACAO_COUNT
              AND STATUS = 'ACEITA_DESCARTADA'
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
                // SQL Server retorna no formato: 2025-11-21T10:39:24.123Z ou 2025-11-21 10:39:24.123
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
          mensagemConfirmacao: textoMensagem || null, // Mensagem formatada para envio via WaboxApp
          motorista: motorista ? {
            nome: motorista.NOME_MOTORISTA,
            celular: motorista.NRCELULAR
          } : null
        });
      } catch (err) {
        console.error(`[CONFIRMAR] Erro na transação para convocação ${id}:`, err);
        if (transaction) {
          await transaction.rollback().catch(rollbackErr => {
            console.error(`[CONFIRMAR] Erro ao fazer rollback:`, rollbackErr);
          });
        }
        throw err;
      }
    } catch (err) {
      if (transaction) {
        await transaction.rollback().catch(() => {
          // Ignorar erro se já foi feito rollback
        });
      }
      console.error(`[CONFIRMAR] Erro ao confirmar convocação ${id}:`, err);
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
      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT 
            c.IDCONVOCACAO,
            c.IDVIAGEM,
            c.STATUS,
            c.DHCONVOCACAO,
            c.DHACESSO,
            v.CDCLASSEFROTA,
            v.DTPREVINICIO,
            v.DTPREVFINAL,
            v.FGRASTREADO,
            v.OBSERV,
            v.VLFRETE,
            v.PESO,
            v.CUBAGEM,
            cg.RZSOCIAL AS NOME_MOTORISTA,
            cg.NRCELULAR,
            cf.DSCLASSEFROTA,
            r.CDCIDADEORIGEM,
            r.CDCIDADEDESTINO,
            co.NMCIDADE AS ORIGEM_CIDADE,
            co.ESTADO AS ORIGEM_ESTADO,
            cd.NMCIDADE AS DESTINO_CIDADE,
            cd.ESTADO AS DESTINO_ESTADO,
            tv.DSTIPOVIAGEM,
            v.CDCONTRATADOR,
            contratador.RZSOCIAL AS CONTRATADOR_NOME,
            contratador.NRCELULAR AS CONTRATADOR_CELULAR,
            r.DSROTEIRO,
            CASE 
              WHEN EXISTS (
                SELECT 1 
                FROM [dbo].[CONVOCACAO] c2 
                WHERE c2.IDVIAGEM = c.IDVIAGEM 
                  AND c2.STATUS = 'CONFIRMADA'
                  AND c2.IDCONVOCACAO != c.IDCONVOCACAO
              ) THEN 1 
              ELSE 0 
            END AS VIAGEM_JA_CONFIRMADA
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
          INNER JOIN [dbo].[CADASTROGERAL] cg ON c.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.CDTIPOVIAGEM = tv.CDTIPOVIAGEM
          LEFT JOIN [dbo].[CADASTROGERAL] contratador ON v.CDCONTRATADOR = contratador.CDCADASTRO 
            AND contratador.FGACTIVE = 'A'
          WHERE c.IDCONVOCACAO = @IDCONVOCACAO
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
              SELECT RZSOCIAL, NRCELULAR, FGACTIVE 
              FROM [dbo].[CADASTROGERAL] 
              WHERE CDCADASTRO = @CDCONTRATADOR AND FGACTIVE = 'A'
            `);
          
          // Se não encontrou ativo, buscar qualquer um (para debug)
          if (contratadorResult.recordset.length === 0) {
            contratadorResult = await pool
              .request()
              .input('CDCONTRATADOR', sql.Decimal(15, 0), parseFloat(convocacao.CDCONTRATADOR))
              .query(`
                SELECT RZSOCIAL, NRCELULAR, FGACTIVE 
                FROM [dbo].[CADASTROGERAL] 
                WHERE CDCADASTRO = @CDCONTRATADOR
              `);
            
            if (contratadorResult.recordset.length > 0) {
              console.log('[DEBUG CONTRATADOR] Contratador encontrado mas INATIVO. FGACTIVE:', contratadorResult.recordset[0].FGACTIVE);
            }
          }
          
          if (contratadorResult.recordset.length > 0) {
            const contratador = contratadorResult.recordset[0];
            convocacao.CONTRATADOR_NOME = contratador.RZSOCIAL;
            convocacao.CONTRATADOR_CELULAR = contratador.NRCELULAR;
            console.log('[DEBUG CONTRATADOR] Contratador encontrado via query separada:', contratador.RZSOCIAL, '| Celular:', contratador.NRCELULAR);
          } else {
            console.log('[DEBUG CONTRATADOR] Contratador NÃO EXISTE na tabela CADASTROGERAL. CDCONTRATADOR:', convocacao.CDCONTRATADOR);
          }
        } catch (err) {
          console.error('[DEBUG CONTRATADOR] Erro ao buscar contratador separadamente:', err);
        }
      } else if (convocacao.CONTRATADOR_NOME) {
        console.log('[DEBUG CONTRATADOR] Contratador encontrado via JOIN:', convocacao.CONTRATADOR_NOME, '| Celular:', convocacao.CONTRATADOR_CELULAR || 'Não informado');
      }

      res.json(convocacao);
    } catch (err) {
      console.error('Erro ao buscar convocação pública:', err);
      res.status(500).json({ error: 'Erro ao buscar convocação.' });
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
        SET DHACESSO = CASE WHEN DHACESSO IS NULL THEN GETDATE() ELSE DHACESSO END,
            DHMAINTENANCE = GETDATE(),
            SGUSER = 'MOTORISTA'
      `;
      
      const request = pool.request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id));
      
      // Adicionar campos de geolocalização se fornecidos
      if (latitude !== undefined && latitude !== null && longitude !== undefined && longitude !== null) {
        query += `, LATITUDE = @LATITUDE, LONGITUDE = @LONGITUDE`;
        request.input('LATITUDE', sql.Float, parseFloat(latitude));
        request.input('LONGITUDE', sql.Float, parseFloat(longitude));
      }
      
      query += ` WHERE IDCONVOCACAO = @IDCONVOCACAO`;
      
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
        SET LATITUDE = @LATITUDE,
            LONGITUDE = @LONGITUDE,
            DHMAINTENANCE = GETDATE(),
            SGUSER = 'MOTORISTA'
        WHERE IDCONVOCACAO = @IDCONVOCACAO
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
          SELECT SGUSUARIO
          FROM [dbo].[USUARIO]
          WHERE SGUSUARIO = @SGUSUARIO
            AND (FGACTIVE = 'A' OR FGACTIVE = 'S')
        `);
      
      if (usuarioResult.recordset.length === 0) {
        return res.status(403).json({ error: 'Usuário não encontrado ou inativo. Não é possível reativar convocações.' });
      }
      
      // Buscar a convocação
      const convocacaoResult = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT IDCONVOCACAO, IDVIAGEM, STATUS
          FROM [dbo].[CONVOCACAO]
          WHERE IDCONVOCACAO = @IDCONVOCACAO
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
      transaction = new sql.Transaction(pool);
      await transaction.begin();
      console.log(`[REATIVAR] Transação iniciada para convocação ${id}`);
      
      try {
        // 1. Buscar dados do motorista para o histórico
        const motoristaResult = await pool
          .request()
          .input('IDCONVOCACAO_MOT', sql.Int, parseInt(id))
          .query(`
            SELECT CDCADASTRO_MOTORISTA
            FROM [dbo].[CONVOCACAO]
            WHERE IDCONVOCACAO = @IDCONVOCACAO_MOT
          `);
        
        const motorista = motoristaResult.recordset[0];
        
        // 2. Registrar histórico de reabertura (apenas para CONFIRMADA)
        if (convocacao.STATUS === 'CONFIRMADA' && motorista) {
          const requestHist = new sql.Request(transaction);
          await requestHist
            .input('IDCONVOCACAO_HIST', sql.Int, parseInt(id))
            .input('IDVIAGEM_HIST', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('CDCADASTRO_MOTORISTA_HIST', sql.Decimal(15, 0), motorista.CDCADASTRO_MOTORISTA)
            .input('STATUS_ANTERIOR_HIST', sql.VarChar(20), convocacao.STATUS)
            .input('CDMOTIVOREABERTURA_HIST', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_HIST', sql.VarChar(50), userLogin)
            .query(`
              INSERT INTO [dbo].[HISTORICOREABERTURA] (
                IDCONVOCACAO, IDVIAGEM, CDCADASTRO_MOTORISTA, STATUS_ANTERIOR,
                CDMOTIVOREABERTURA, DHRABERTURA, SGUSUARIO_OPERADOR,
                FGACTIVE, DHINCLUSAO, SGUSERINCLUSAO, SERVERORIG
              )
              VALUES (
                @IDCONVOCACAO_HIST, @IDVIAGEM_HIST, @CDCADASTRO_MOTORISTA_HIST, @STATUS_ANTERIOR_HIST,
                @CDMOTIVOREABERTURA_HIST, GETDATE(), @SGUSUARIO_OPERADOR_HIST,
                'A', GETDATE(), @SGUSUARIO_OPERADOR_HIST, 'AppDVcargas'
              )
            `);
        }
        
        // 3. Reativar a convocação CONFIRMADA (mudar status para ACEITA)
        const request1 = new sql.Request(transaction);
        await request1
          .input('IDCONVOCACAO_REATIVAR', sql.Int, parseInt(id))
          .input('CDMOTIVOREABERTURA', sql.Int, parseInt(motivoReabertura))
          .input('SGUSUARIO_OPERADOR', sql.VarChar(50), userLogin)
          .query(`
            UPDATE [dbo].[CONVOCACAO]
            SET STATUS = 'ACEITA',
                CDMOTIVOREABERTURA = @CDMOTIVOREABERTURA,
                SGUSUARIO_OPERADOR = @SGUSUARIO_OPERADOR,
                DHMAINTENANCE = GETDATE(),
                SGUSER = 'SYSTEM'
            WHERE IDCONVOCACAO = @IDCONVOCACAO_REATIVAR
          `);
        
        // 4. Contar quantas convocações ACEITA_DESCARTADA serão reativadas
        const countRequest = new sql.Request(transaction);
        const countResult = await countRequest
          .input('IDVIAGEM_COUNT', sql.Decimal(15, 0), convocacao.IDVIAGEM)
          .input('IDCONVOCACAO_COUNT', sql.Int, parseInt(id))
          .query(`
            SELECT COUNT(*) AS TOTAL
            FROM [dbo].[CONVOCACAO]
            WHERE IDVIAGEM = @IDVIAGEM_COUNT
              AND IDCONVOCACAO != @IDCONVOCACAO_COUNT
              AND STATUS = 'ACEITA_DESCARTADA'
          `);
        
        const totalReativadas = countResult.recordset[0]?.TOTAL || 0;
        
        // 5. Reativar automaticamente as outras convocações ACEITA_DESCARTADA da mesma viagem
        if (totalReativadas > 0) {
          const request2 = new sql.Request(transaction);
          await request2
            .input('IDVIAGEM_REATIVAR', sql.Decimal(15, 0), convocacao.IDVIAGEM)
            .input('IDCONVOCACAO_EXCLUIR', sql.Int, parseInt(id))
            .input('CDMOTIVOREABERTURA_AUTO', sql.Int, parseInt(motivoReabertura))
            .input('SGUSUARIO_OPERADOR_AUTO', sql.VarChar(50), userLogin)
            .query(`
              UPDATE [dbo].[CONVOCACAO]
              SET STATUS = 'ACEITA',
                  CDMOTIVOREABERTURA = @CDMOTIVOREABERTURA_AUTO,
                  SGUSUARIO_OPERADOR = @SGUSUARIO_OPERADOR_AUTO,
                  DHMAINTENANCE = GETDATE(),
                  SGUSER = 'SYSTEM'
              WHERE IDVIAGEM = @IDVIAGEM_REATIVAR
                AND IDCONVOCACAO != @IDCONVOCACAO_EXCLUIR
                AND STATUS = 'ACEITA_DESCARTADA'
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
      
      const result = await pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(id))
        .query(`
          SELECT 
            h.IDHISTORICO,
            h.IDCONVOCACAO,
            h.IDVIAGEM,
            h.CDCADASTRO_MOTORISTA,
            cg.RZSOCIAL AS NOME_MOTORISTA,
            h.STATUS_ANTERIOR,
            h.CDMOTIVOREABERTURA,
            mr.DSMOTIVO AS MOTIVO_REABERTURA,
            h.DHRABERTURA,
            h.SGUSUARIO_OPERADOR,
            h.OBSERVACAO
          FROM [dbo].[HISTORICOREABERTURA] h
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON h.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[MOTIVOREABERTURA] mr ON h.CDMOTIVOREABERTURA = mr.CDMOTIVO
          WHERE h.IDCONVOCACAO = @IDCONVOCACAO
            AND h.FGACTIVE = 'A'
          ORDER BY h.DHRABERTURA DESC
        `);
      
      res.json(result.recordset);
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
      
      query += ` WHERE IDCONVOCACAO = @IDCONVOCACAO AND STATUS = 'PENDENTE'`;
      
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
      
      for (const comando of comandos) {
        const cmdLimpo = comando.trim();
        if (!cmdLimpo) continue;
        
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
  // ENVIO AUTOMÁTICO VIA WABOXAPP (NOVO - ISOLADO)
  // ============================================================================
  // Esta função é totalmente isolada e não interfere no sistema atual
  // Só funciona se WABOXAPP_ENABLED=true no .env
  // ============================================================================
  
  // Verificar se WaboxApp está configurado (endpoint de verificação)
  verificarWaboxAppConfigurado: async (req, res) => {
    try {
      // Log removido para evitar poluição do console em verificações rotineiras
      // Este endpoint é chamado frequentemente para verificar disponibilidade
      
      const waboxappEnabled = process.env.WABOXAPP_ENABLED === 'true';
      const waboxappToken = process.env.WABOXAPP_TOKEN;
      const waboxappUid = process.env.WABOXAPP_UID;

      // Logs de debug removidos - apenas logar em caso de erro

      if (!waboxappEnabled || !waboxappToken || !waboxappUid) {
        const detalhes = [];
        if (!waboxappEnabled) detalhes.push('WABOXAPP_ENABLED não está como "true"');
        if (!waboxappToken) detalhes.push('WABOXAPP_TOKEN não está definido');
        if (!waboxappUid) detalhes.push('WABOXAPP_UID não está definido');
        
        return res.json({ 
          configurado: false,
          message: 'WaboxApp não está configurado ou está desabilitado.',
          detalhes: detalhes,
          debug: {
            enabled: waboxappEnabled,
            hasToken: !!waboxappToken,
            hasUid: !!waboxappUid,
            enabledValue: process.env.WABOXAPP_ENABLED
          }
        });
      }

      return res.json({ 
        configurado: true,
        message: 'WaboxApp está configurado e pronto para uso.'
      });
    } catch (err) {
      console.error('[WABOXAPP] Erro ao verificar configuração:', err);
      return res.json({ 
        configurado: false,
        message: 'Erro ao verificar configuração do WaboxApp.',
        erro: err.message
      });
    }
  },

  enviarWhatsAppAutomatico: async (req, res) => {
    try {
      console.log('[WABOXAPP] ========================================');
      console.log('[WABOXAPP] Requisição recebida:', req.body);
      
      // Verificar se está habilitado
      const waboxappEnabled = process.env.WABOXAPP_ENABLED === 'true';
      const waboxappToken = process.env.WABOXAPP_TOKEN;
      const waboxappUid = process.env.WABOXAPP_UID;

      console.log('[WABOXAPP] Configuração:', {
        enabled: waboxappEnabled,
        hasToken: !!waboxappToken,
        hasUid: !!waboxappUid,
        tokenLength: waboxappToken ? waboxappToken.length : 0,
        uid: waboxappUid
      });

      if (!waboxappEnabled || !waboxappToken || !waboxappUid) {
        console.warn('[WABOXAPP] ⚠️ Configuração incompleta ou desabilitada');
        return res.status(503).json({ 
          error: 'Envio automático via Waboxapp não está configurado ou está desabilitado.',
          message: 'Configure WABOXAPP_ENABLED, WABOXAPP_TOKEN e WABOXAPP_UID no arquivo .env',
          fallback: 'Use o método manual (botão "Abrir Todos") que continua funcionando normalmente.'
        });
      }

      let { idsConvocacoes, textoPersonalizado } = req.body;
      console.log('[WABOXAPP] IDs recebidos:', idsConvocacoes);
      console.log('[WABOXAPP] Texto personalizado fornecido:', textoPersonalizado ? 'Sim' : 'Não');

      if (!idsConvocacoes) {
        return res.status(400).json({ 
          error: 'Campo "idsConvocacoes" não foi informado.',
          details: 'O corpo da requisição deve conter um array "idsConvocacoes" com os IDs das convocações.'
        });
      }

      if (!Array.isArray(idsConvocacoes)) {
        return res.status(400).json({ 
          error: 'Campo "idsConvocacoes" deve ser um array.',
          received: typeof idsConvocacoes,
          value: idsConvocacoes
        });
      }

      // Filtrar IDs inválidos (0, null, undefined, NaN) para verificação de disponibilidade
      const idsValidos = idsConvocacoes.filter(id => id && id !== 0 && !isNaN(parseInt(id)) && parseInt(id) > 0);
      
      if (idsValidos.length === 0) {
        // Se não há IDs válidos, pode ser uma verificação de disponibilidade
        // Retornar 400 mas com configured: true para indicar que o serviço está configurado
        console.log('[WABOXAPP] Verificação de disponibilidade: retornando configured: true');
        return res.status(400).json({ 
          success: false,
          error: 'É necessário informar pelo menos um ID de convocação válido.',
          received: idsConvocacoes,
          configured: true // Indica que está configurado, só precisa de dados válidos
        });
      }

      // Usar apenas os IDs válidos
      idsConvocacoes = idsValidos;

      const pool = await poolPromise;
      const resultados = [];
      const erros = [];

      // Verificar se a tabela LOG_ENVIO_WHATSAPP existe
      try {
        const tabelaExiste = await pool.request().query(`
          SELECT COUNT(*) AS TOTAL
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LOG_ENVIO_WHATSAPP'
        `);
        
        if (tabelaExiste.recordset[0].TOTAL === 0) {
          console.warn('[WABOXAPP] ⚠️ Tabela LOG_ENVIO_WHATSAPP não existe. Execute o script criar_tabela_log_envio_whatsapp.sql');
        }
      } catch (err) {
        console.warn('[WABOXAPP] ⚠️ Erro ao verificar tabela LOG_ENVIO_WHATSAPP:', err.message);
      }

      // Buscar dados das convocações
      for (const idConvocacao of idsConvocacoes) {
        try {
          console.log(`[WABOXAPP] Processando convocação ${idConvocacao}...`);
          
          // Buscar convocação com dados completos
          const convocacaoResult = await pool
            .request()
            .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao))
            .query(`
              SELECT 
                c.IDCONVOCACAO,
                c.IDVIAGEM,
                c.CDCADASTRO_MOTORISTA,
                c.NRCELULAR,
                c.TXTCONVOCACAO,
                c.LINKCONVOCACAO,
                c.STATUS,
                cg.RZSOCIAL AS NOME_MOTORISTA
              FROM [dbo].[CONVOCACAO] c
              INNER JOIN [dbo].[CADASTROGERAL] cg ON c.CDCADASTRO_MOTORISTA = cg.CDCADASTRO
              WHERE c.IDCONVOCACAO = @IDCONVOCACAO
            `);

          if (convocacaoResult.recordset.length === 0) {
            console.warn(`[WABOXAPP] Convocação ${idConvocacao} não encontrada`);
            erros.push({
              idConvocacao,
              erro: 'Convocação não encontrada'
            });
            continue;
          }

          const convocacao = convocacaoResult.recordset[0];
          console.log(`[WABOXAPP] Convocação ${idConvocacao} encontrada: ${convocacao.NOME_MOTORISTA}`);

          // Se não tem celular na convocação, buscar no CADASTROGERAL
          let celularParaEnvio = convocacao.NRCELULAR ? String(convocacao.NRCELULAR).trim() : null;
          if (!celularParaEnvio || celularParaEnvio === '') {
            console.log(`[WABOXAPP] Convocação ${idConvocacao} sem celular, buscando no CADASTROGERAL...`);
            const motoristaResult = await pool
              .request()
              .input('CDCADASTRO', sql.Decimal(15, 0), convocacao.CDCADASTRO_MOTORISTA)
              .query(`
                SELECT NRCELULAR
                FROM [dbo].[CADASTROGERAL]
                WHERE CDCADASTRO = @CDCADASTRO
              `);
            
            if (motoristaResult.recordset.length > 0 && motoristaResult.recordset[0].NRCELULAR) {
              celularParaEnvio = String(motoristaResult.recordset[0].NRCELULAR).trim();
              console.log(`[WABOXAPP] Celular encontrado no CADASTROGERAL: ${celularParaEnvio}`);
            }
          }

          // Se foi fornecido texto personalizado (ex: mensagem de confirmação), usar ele
          // Caso contrário, usar o texto da convocação ou gerar texto básico
          let textoParaEnvio = null;
          
          if (textoPersonalizado && typeof textoPersonalizado === 'string' && textoPersonalizado.trim() !== '') {
            // Usar texto personalizado fornecido (ex: mensagem de confirmação)
            textoParaEnvio = textoPersonalizado.trim();
            console.log(`[WABOXAPP] Usando texto personalizado fornecido: ${textoParaEnvio.substring(0, 100)}...`);
          } else {
            // Usar texto da convocação ou gerar texto básico
            textoParaEnvio = convocacao.TXTCONVOCACAO ? String(convocacao.TXTCONVOCACAO).trim() : null;
            if (!textoParaEnvio || textoParaEnvio === '') {
              console.log(`[WABOXAPP] Convocação ${idConvocacao} sem texto, gerando texto básico...`);
              const urlBase = process.env.PUBLIC_URL || 'http://localhost:3000';
              const linkConvocacao = `${urlBase}/convocacao/${idConvocacao}`;
              // Mensagem personalizada para cada motorista
              const nomeMotorista = convocacao.NOME_MOTORISTA || 'Motorista';
              textoParaEnvio = `Olá *${nomeMotorista.toUpperCase()}*! Você foi convocado para uma viagem.\n\n🔗 Acesse o link para mais detalhes:\n\n${linkConvocacao}`;
              console.log(`[WABOXAPP] Texto gerado: ${textoParaEnvio.substring(0, 100)}...`);
            }
          }

          // Validar se tem celular e texto após tentar buscar/gerar
          if (!celularParaEnvio || celularParaEnvio === '' || !textoParaEnvio || textoParaEnvio === '') {
            console.warn(`[WABOXAPP] Convocação ${idConvocacao} sem celular ou texto após tentativas:`, {
              temCelular: !!celularParaEnvio && celularParaEnvio !== '',
              temTexto: !!textoParaEnvio && textoParaEnvio !== ''
            });
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              erro: 'Convocação sem celular ou texto de convocação (não foi possível buscar/gerar)'
            });
            continue;
          }

          // Limpar número de celular (remover caracteres não numéricos)
          const celularOriginal = celularParaEnvio.toString().trim();
          const celularLimpo = celularOriginal.replace(/\D/g, '');
          
          console.log(`[WABOXAPP] ========================================`);
          console.log(`[WABOXAPP] PROCESSANDO NÚMERO:`);
          console.log(`[WABOXAPP]   Original: "${celularOriginal}"`);
          console.log(`[WABOXAPP]   Limpo: "${celularLimpo}" (${celularLimpo.length} dígitos)`);
          
          // Validar número antes de formatar (deve ter pelo menos 10 dígitos)
          if (celularLimpo.length < 10) {
            console.error(`[WABOXAPP] ❌ Número muito curto: ${celularLimpo} (${celularLimpo.length} dígitos, mínimo: 10)`);
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              celular: celularParaEnvio || convocacao.NRCELULAR,
              erro: `Número de celular muito curto (${celularLimpo.length} dígitos, mínimo: 10)`
            });
            continue;
          }
          
          // Adicionar código do país se não tiver
          let numeroFormatado = celularLimpo;
          const tinhaCodigoPais = numeroFormatado.startsWith('55');
          
          if (!tinhaCodigoPais) {
            // Remover zero inicial se houver (formato antigo: 041999598887)
            if (numeroFormatado.startsWith('0') && numeroFormatado.length === 11) {
              numeroFormatado = numeroFormatado.substring(1);
              console.log(`[WABOXAPP]   Removido zero inicial: ${numeroFormatado}`);
            }
            numeroFormatado = '55' + numeroFormatado;
            console.log(`[WABOXAPP]   Adicionado código do país: ${numeroFormatado}`);
          } else {
            console.log(`[WABOXAPP]   Já tinha código do país: ${numeroFormatado}`);
          }

          // Validar número final (deve ter exatamente 13 dígitos: 55 + DDD (2) + número (9 ou 8))
          // Formato esperado: 55 + DDD (2 dígitos) + número (8 ou 9 dígitos) = 12 ou 13 dígitos
          console.log(`[WABOXAPP]   Número formatado: ${numeroFormatado} (${numeroFormatado.length} dígitos)`);
          
          if (numeroFormatado.length < 12 || numeroFormatado.length > 13) {
            console.error(`[WABOXAPP] ❌ Número inválido após formatação: ${numeroFormatado} (tamanho: ${numeroFormatado.length}, esperado: 12-13)`);
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              celular: celularParaEnvio || convocacao.NRCELULAR,
              erro: `Número de celular inválido após formatação (tamanho: ${numeroFormatado.length}, esperado: 12-13 dígitos)`
            });
            continue;
          }

          // Verificar se o número não começa com 55 seguido de DDD válido (11-99)
          const ddd = numeroFormatado.substring(2, 4);
          const dddNum = parseInt(ddd, 10);
          const numeroSemDDD = numeroFormatado.substring(4);
          
          console.log(`[WABOXAPP]   DDD: ${ddd} (${dddNum})`);
          console.log(`[WABOXAPP]   Número sem DDD: ${numeroSemDDD} (${numeroSemDDD.length} dígitos)`);
          
          if (isNaN(dddNum) || dddNum < 11 || dddNum > 99) {
            console.error(`[WABOXAPP] ❌ DDD inválido: ${ddd} (número completo: ${numeroFormatado})`);
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              celular: celularParaEnvio || convocacao.NRCELULAR,
              erro: `DDD inválido: ${ddd}`
            });
            continue;
          }
          
          // Validar se o número tem 8 ou 9 dígitos após o DDD
          if (numeroSemDDD.length < 8 || numeroSemDDD.length > 9) {
            console.error(`[WABOXAPP] ❌ Número de telefone inválido: ${numeroSemDDD} (${numeroSemDDD.length} dígitos, esperado: 8-9)`);
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              celular: celularParaEnvio || convocacao.NRCELULAR,
              erro: `Número de telefone inválido após DDD (${numeroSemDDD.length} dígitos, esperado: 8-9)`
            });
            continue;
          }
          
          console.log(`[WABOXAPP] ✅ Número validado com sucesso: ${numeroFormatado}`);

          // NOTA: A API do WaboxApp não possui endpoint público para verificar status
          // Vamos assumir que está conectado e confiar na resposta da API de envio
          // Se a mensagem não chegar, o problema será identificado pelo usuário
          let whatsappConectado = null; // null = não verificado (API não suporta)
          console.log(`[WABOXAPP] ⚠️ Não é possível verificar status da conexão via API.`);
          console.log(`[WABOXAPP] ⚠️ Verifique manualmente no painel do WaboxApp se o número está conectado.`);

          // Enviar via Waboxapp API
          const textoMensagem = textoParaEnvio;
          const textoEncoded = encodeURIComponent(textoMensagem);
          
          // IMPORTANTE: Verificar se o número de destino não é o mesmo do UID (não pode enviar para si mesmo)
          if (numeroFormatado === waboxappUid) {
            console.error(`[WABOXAPP] ❌ ERRO: Número de destino é o mesmo do UID (não pode enviar para si mesmo)`);
            erros.push({
              idConvocacao,
              nomeMotorista: convocacao.NOME_MOTORISTA,
              celular: celularParaEnvio || convocacao.NRCELULAR,
              erro: 'Número de destino é o mesmo do número que envia (UID). Verifique o cadastro do motorista.'
            });
            continue;
          }
          
          // URL da API do WaboxApp - formato: https://www.waboxapp.com/api/send/chat?token=TOKEN&uid=UID&to=NUMERO&text=TEXTO
          const waboxappUrl = `https://www.waboxapp.com/api/send/chat?token=${waboxappToken}&uid=${waboxappUid}&to=${numeroFormatado}&text=${textoEncoded}`;
          
          console.log(`[WABOXAPP] ========================================`);
          console.log(`[WABOXAPP] PREPARANDO ENVIO:`);
          console.log(`[WABOXAPP]   Motorista: ${convocacao.NOME_MOTORISTA}`);
          console.log(`[WABOXAPP]   Número de destino: ${numeroFormatado}`);
          console.log(`[WABOXAPP]   Número que envia (UID): ${waboxappUid}`);
          console.log(`[WABOXAPP]   Tamanho do texto: ${textoMensagem.length} caracteres`);
          console.log(`[WABOXAPP]   Token: ${waboxappToken ? waboxappToken.substring(0, 10) + '...' + waboxappToken.substring(waboxappToken.length - 5) : 'N/A'}`);
          console.log(`[WABOXAPP] ⚠️ IMPORTANTE: Se a mensagem não chegar, verifique no painel do WaboxApp se o WhatsApp está conectado!`);
          
          let tentativas = 0;
          let sucesso = false;
          let mensagemErro = null;
          let idRespostaApi = null;

          // Retry até 3 tentativas
          while (tentativas < 3 && !sucesso) {
            try {
              console.log(`[WABOXAPP] Tentativa ${tentativas + 1} de 3...`);
              console.log(`[WABOXAPP] URL completa (sem texto): https://www.waboxapp.com/api/send/chat?token=${waboxappToken}&uid=${waboxappUid}&to=${numeroFormatado}&text=[${textoMensagem.length} caracteres]`);
              
              // WaboxApp - requisição GET simples (sem headers customizados que podem causar problemas)
              const response = await axios.get(waboxappUrl, {
                timeout: 30000
              });

              console.log(`[WABOXAPP] Status HTTP: ${response.status}`);
              console.log(`[WABOXAPP] Headers da resposta:`, response.headers);
              console.log(`[WABOXAPP] Resposta completa da API:`, JSON.stringify(response.data, null, 2));

              // Verificar status HTTP primeiro
              if (response.status !== 200) {
                mensagemErro = `Status HTTP ${response.status}: ${response.statusText || 'Erro desconhecido'}`;
                console.warn(`[WABOXAPP] ❌ Status HTTP inválido:`, mensagemErro);
                if (response.data) {
                  console.warn(`[WABOXAPP] Dados do erro:`, response.data);
                }
                // Continuar para próxima tentativa
                tentativas++;
                continue;
              }

              // A API do Waboxapp pode retornar diferentes formatos de sucesso:
              // { success: true, custom_uid: '...' }
              // { sent: true, id: '...' }
              // { success: 1, custom_uid: '...' }
              // { sent: 1, id: '...' }
              // { status: 'sent', id: '...' }
              // { status: 'success', custom_uid: '...' }
              const data = response.data || {};
              
              // Verificar múltiplos formatos de sucesso
              const isSuccess = data.success === true || data.success === 1 || 
                               data.sent === true || data.sent === 1 ||
                               (data.status && (data.status === 'sent' || data.status === 'success' || data.status === 'ok')) ||
                               (data.result && data.result === 'success') ||
                               (data.ok === true || data.ok === 1);
              
              if (isSuccess) {
                sucesso = true;
                idRespostaApi = data.custom_uid || data.id || data.message_id || data.uid || null;
                console.log(`[WABOXAPP] ✅ API retornou sucesso!`);
                console.log(`[WABOXAPP]   ID da mensagem: ${idRespostaApi}`);
                console.log(`[WABOXAPP]   Resposta completa:`, JSON.stringify(data, null, 2));
                
                // AVISO: Mesmo com sucesso da API, verificar se há avisos
                if (data.warning || data.warning_message) {
                  console.warn(`[WABOXAPP] ⚠️ AVISO da API:`, data.warning || data.warning_message);
                }
                
                // Verificar se há informações sobre o status real da mensagem
                if (data.status) {
                  console.log(`[WABOXAPP]   Status da mensagem: ${data.status}`);
                }
                
                // IMPORTANTE: Verificar se há campos que indicam problema
                if (data.error || data.error_message || data.failed) {
                  console.error(`[WABOXAPP] ❌ ERRO na resposta mesmo com success=true:`, data.error || data.error_message || data.failed);
                  sucesso = false;
                  mensagemErro = data.error || data.error_message || 'Erro na API mesmo com success=true';
                } else {
                  // CRÍTICO: Aviso importante sobre verificação manual
                  console.warn(`[WABOXAPP] ⚠️⚠️⚠️ ATENÇÃO CRÍTICA ⚠️⚠️⚠️`);
                  console.warn(`[WABOXAPP] A API retornou sucesso, MAS isso NÃO garante que a mensagem foi entregue!`);
                  console.warn(`[WABOXAPP] Se o destinatário não recebeu a mensagem:`);
                  console.warn(`[WABOXAPP]   1. TESTE MANUAL: Acesse o painel do WaboxApp → Desenvolvedores`);
                  console.warn(`[WABOXAPP]      Envie manualmente para ${numeroFormatado} e veja se funciona`);
                  console.warn(`[WABOXAPP]   2. Verifique se o número ${numeroFormatado} tem WhatsApp instalado`);
                  console.warn(`[WABOXAPP]   3. Verifique se o número ${numeroFormatado} não bloqueou ${waboxappUid}`);
                  console.warn(`[WABOXAPP]   4. Verifique no painel se o número ${waboxappUid} está CONECTADO (status verde)`);
                  console.warn(`[WABOXAPP]   5. Verifique se há créditos disponíveis na conta`);
                  console.warn(`[WABOXAPP]   6. CONTATE O SUPORTE DO WABOXAPP se o teste manual também não funcionar`);
                }
                
                break;
              } else {
                // Verificar se há mensagem de erro específica
                mensagemErro = data.error || data.message || data.error_message || data.msg ||
                              (data.status === 'error' ? 'Erro na API' : 
                               data.status === 'failed' ? 'Falha no envio' :
                               'Resposta inválida da API');
                console.warn(`[WABOXAPP] ❌ Erro na resposta:`, mensagemErro);
                console.warn(`[WABOXAPP] Dados completos da resposta:`, JSON.stringify(data, null, 2));
                
                // Se o erro for definitivo (ex: número inválido, token inválido), não tentar novamente
                const erroDefinitivo = mensagemErro.toLowerCase().includes('invalid') ||
                                      mensagemErro.toLowerCase().includes('token') ||
                                      mensagemErro.toLowerCase().includes('unauthorized') ||
                                      mensagemErro.toLowerCase().includes('forbidden') ||
                                      (data.error_code && [401, 403, 400].includes(parseInt(data.error_code)));
                
                if (erroDefinitivo) {
                  console.error(`[WABOXAPP] ⚠️ Erro definitivo detectado, não tentando novamente`);
                  break; // Sair do loop de tentativas
                }
              }
            } catch (apiError) {
              // Tratamento detalhado de erros
              if (apiError.response) {
                // A requisição foi feita e o servidor respondeu com um status de erro
                mensagemErro = apiError.response.data?.error || 
                              apiError.response.data?.message || 
                              apiError.response.data?.error_message ||
                              `Erro HTTP ${apiError.response.status}: ${apiError.response.statusText}`;
                console.error(`[WABOXAPP] ❌ Erro HTTP na tentativa ${tentativas + 1}:`, {
                  status: apiError.response.status,
                  statusText: apiError.response.statusText,
                  data: apiError.response.data,
                  message: mensagemErro
                });
              } else if (apiError.request) {
                // A requisição foi feita mas não houve resposta
                mensagemErro = 'Sem resposta do servidor WaboxApp (timeout ou servidor offline)';
                console.error(`[WABOXAPP] ❌ Timeout/Offline na tentativa ${tentativas + 1}:`, {
                  message: apiError.message,
                  code: apiError.code
                });
              } else {
                // Erro ao configurar a requisição
                mensagemErro = apiError.message || 'Erro ao configurar requisição';
                console.error(`[WABOXAPP] ❌ Erro de configuração na tentativa ${tentativas + 1}:`, {
                  message: apiError.message,
                  stack: apiError.stack
                });
              }
              
              // Aguardar antes de tentar novamente (backoff exponencial)
              if (tentativas < 2) {
                const delay = (tentativas + 1) * 2000; // 2s, 4s
                console.log(`[WABOXAPP] Aguardando ${delay}ms antes da próxima tentativa...`);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            tentativas++;
          }
          
          if (!sucesso) {
            console.error(`[WABOXAPP] ❌ Falha após ${tentativas} tentativa(s): ${mensagemErro}`);
          }

          // Registrar no log
          const statusEnvio = sucesso ? 'ENVIADO' : 'ERRO';
          const dhEnvio = sucesso ? new Date() : null;
          const dhRespostaApi = sucesso ? new Date() : null;

          try {
            await pool
              .request()
              .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao))
              .input('NRCELULAR', sql.VarChar(20), String(celularParaEnvio || ''))
              .input('STATUS_ENVIO', sql.VarChar(20), statusEnvio)
              .input('MENSAGEM_ERRO', sql.NVarChar(500), mensagemErro)
              .input('DHENVIO', sql.DateTime, dhEnvio)
              .input('DHRESPOSTA_API', sql.DateTime, dhRespostaApi)
              .input('IDRESPOSTA_API', sql.VarChar(100), idRespostaApi)
              .input('TENTATIVAS', sql.Int, tentativas)
              .query(`
                INSERT INTO [dbo].[LOG_ENVIO_WHATSAPP] (
                  IDCONVOCACAO, NRCELULAR, STATUS_ENVIO, MENSAGEM_ERRO,
                  DHENVIO, DHRESPOSTA_API, IDRESPOSTA_API, TENTATIVAS,
                  DHMAINTENANCE, SGUSER, SERVERORIG
                )
                VALUES (
                  @IDCONVOCACAO, @NRCELULAR, @STATUS_ENVIO, @MENSAGEM_ERRO,
                  @DHENVIO, @DHRESPOSTA_API, @IDRESPOSTA_API, @TENTATIVAS,
                  GETDATE(), 'SYSTEM', 'AppDVcargas'
                )
              `);
            console.log(`[WABOXAPP] Log registrado com sucesso para convocação ${idConvocacao}`);
          } catch (logError) {
            // Se a tabela não existir ainda, apenas loga o erro mas não falha
            console.error(`[WABOXAPP] ⚠️ Erro ao registrar log (tabela pode não existir ainda):`, logError.message);
            console.error(`[WABOXAPP] ⚠️ Detalhes do erro:`, logError);
          }

          // Adicionar avisos importantes ao resultado
          const avisos = [];
          // Sempre adicionar aviso para verificar no painel, já que não podemos verificar via API
          if (sucesso) {
            avisos.push('API retornou sucesso. Se a mensagem não chegou, verifique no painel do WaboxApp se o WhatsApp está conectado.');
          }

          resultados.push({
            idConvocacao,
            nomeMotorista: convocacao.NOME_MOTORISTA,
            celular: celularParaEnvio || convocacao.NRCELULAR,
            celularFormatado: numeroFormatado,
            status: statusEnvio,
            tentativas,
            mensagemErro: mensagemErro || null,
            idRespostaApi,
            observacao: 'Status da conexão não pode ser verificado via API - verifique no painel do WaboxApp',
            avisos: avisos.length > 0 ? avisos : null
          });

        } catch (err) {
          console.error(`Erro ao processar convocação ${idConvocacao}:`, err);
          erros.push({
            idConvocacao,
            erro: err.message || 'Erro desconhecido'
          });
        }
      }

      const sucessos = resultados.filter(r => r.status === 'ENVIADO').length;
      const falhas = resultados.filter(r => r.status === 'ERRO').length;
      const comAvisos = resultados.filter(r => r.avisos && r.avisos.length > 0).length;

      // Mensagem com avisos importantes
      let mensagemFinal = `${sucessos} mensagem(ns) enviada(s) com sucesso. ${falhas} falha(s). ${erros.length} erro(s) de validação.`;
      if (comAvisos > 0) {
        mensagemFinal += ` ⚠️ ${comAvisos} mensagem(ns) com avisos - verifique se o WhatsApp está conectado!`;
      }

      res.json({
        success: true,
        message: mensagemFinal,
        resultados,
        erros,
        resumo: {
          total: idsConvocacoes.length,
          sucessos,
          falhas,
          errosValidacao: erros.length,
          comAvisos: comAvisos
        },
        avisosImportantes: comAvisos > 0 ? [
          'Algumas mensagens foram marcadas como enviadas, mas o WhatsApp pode não estar conectado.',
          'Verifique no painel do WaboxApp se o número está conectado ao WhatsApp.',
          'Acesse: /api/convocacoes/diagnostico-waboxapp para diagnóstico completo.'
        ] : null
      });

    } catch (err) {
      console.error('Erro ao enviar WhatsApp automático:', err);
      res.status(500).json({ 
        error: 'Erro ao processar envio automático.',
        message: err.message,
        fallback: 'Use o método manual (botão "Abrir Todos") que continua funcionando normalmente.'
      });
    }
  },

  // ============================================================================
  // TESTE DE ENVIO WABOXAPP
  // ============================================================================
  testarWaboxApp: async (req, res) => {
    try {
      const { numero, mensagem } = req.body;
      
      if (!numero || !mensagem) {
        return res.status(400).json({ 
          error: 'Número e mensagem são obrigatórios',
          exemplo: {
            numero: '41999887766',
            mensagem: 'Mensagem de teste'
          }
        });
      }

      const waboxappEnabled = process.env.WABOXAPP_ENABLED === 'true';
      const waboxappToken = process.env.WABOXAPP_TOKEN;
      const waboxappUid = process.env.WABOXAPP_UID;

      if (!waboxappEnabled || !waboxappToken || !waboxappUid) {
        return res.status(503).json({ 
          error: 'WaboxApp não está configurado',
          configurado: false
        });
      }

      // Limpar e formatar número
      const celularLimpo = numero.toString().replace(/\D/g, '');
      let numeroFormatado = celularLimpo;
      if (!numeroFormatado.startsWith('55')) {
        if (numeroFormatado.startsWith('0')) {
          numeroFormatado = numeroFormatado.substring(1);
        }
        numeroFormatado = '55' + numeroFormatado;
      }

      if (numeroFormatado.length < 12 || numeroFormatado.length > 13) {
        return res.status(400).json({ 
          error: 'Número inválido',
          numeroRecebido: numero,
          numeroFormatado: numeroFormatado,
          tamanho: numeroFormatado.length
        });
      }

      const textoEncoded = encodeURIComponent(mensagem);
      const waboxappUrl = `https://www.waboxapp.com/api/send/chat?token=${waboxappToken}&uid=${waboxappUid}&to=${numeroFormatado}&text=${textoEncoded}`;

      console.log('[TESTE WABOXAPP] Enviando mensagem de teste...');
      console.log('[TESTE WABOXAPP] URL:', waboxappUrl.substring(0, 150) + '...');

      const response = await axios.get(waboxappUrl, {
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        validateStatus: () => true
      });

      console.log('[TESTE WABOXAPP] Status:', response.status);
      console.log('[TESTE WABOXAPP] Resposta:', JSON.stringify(response.data, null, 2));

      const data = response.data || {};
      const isSuccess = data.success === true || data.success === 1 || 
                       data.sent === true || data.sent === 1 ||
                       (data.status && (data.status === 'sent' || data.status === 'success'));

      if (isSuccess) {
        res.json({
          success: true,
          message: 'Mensagem de teste enviada com sucesso!',
          numeroFormatado: numeroFormatado,
          respostaApi: data
        });
      } else {
        res.status(400).json({
          success: false,
          error: data.error || data.message || 'Erro ao enviar mensagem',
          status: response.status,
          respostaApi: data
        });
      }

    } catch (err) {
      console.error('[TESTE WABOXAPP] Erro:', err);
      res.status(500).json({
        success: false,
        error: err.message,
        detalhes: err.response?.data || err.message
      });
    }
  },

  // ============================================================================
  // DIAGNÓSTICO COMPLETO DO WABOXAPP
  // ============================================================================
  diagnosticoWaboxApp: async (req, res) => {
    try {
      const waboxappEnabled = process.env.WABOXAPP_ENABLED === 'true';
      const waboxappToken = process.env.WABOXAPP_TOKEN;
      const waboxappUid = process.env.WABOXAPP_UID;

      const diagnostico = {
        configuracao: {
          habilitado: waboxappEnabled,
          tokenPresente: !!waboxappToken,
          tokenLength: waboxappToken ? waboxappToken.length : 0,
          uidPresente: !!waboxappUid,
          uid: waboxappUid || 'não definido',
          configurado: waboxappEnabled && !!waboxappToken && !!waboxappUid
        },
        statusConexao: null,
        testeEnvio: null,
        erros: []
      };

      if (!diagnostico.configuracao.configurado) {
        return res.json({
          ...diagnostico,
          mensagem: 'WaboxApp não está configurado corretamente'
        });
      }

      // 1. Verificar status da conexão do WhatsApp
      // NOTA: A API do WaboxApp pode não ter endpoint de status público
      // Vamos tentar verificar através de um teste de envio ou verificar no painel
      diagnostico.statusConexao = {
        observacao: 'A API do WaboxApp não possui endpoint público para verificar status da conexão.',
        recomendacao: 'Verifique manualmente no painel do WaboxApp (https://www.waboxapp.com) se o número está conectado ao WhatsApp.',
        urlPainel: 'https://www.waboxapp.com'
      };

      // 3. Teste de envio (opcional - apenas se número fornecido)
      const { numeroTeste } = req.query;
      if (numeroTeste) {
        try {
          console.log('[DIAGNOSTICO] Testando envio para:', numeroTeste);
          
          // Limpar e formatar número
          const celularLimpo = numeroTeste.toString().replace(/\D/g, '');
          let numeroFormatado = celularLimpo;
          if (!numeroFormatado.startsWith('55')) {
            if (numeroFormatado.startsWith('0')) {
              numeroFormatado = numeroFormatado.substring(1);
            }
            numeroFormatado = '55' + numeroFormatado;
          }

          if (numeroFormatado === waboxappUid) {
            diagnostico.testeEnvio = {
              erro: 'Número de teste não pode ser o mesmo do UID (não pode enviar para si mesmo)',
              numeroFormatado: numeroFormatado,
              uid: waboxappUid
            };
          } else {
            const mensagemTeste = `Teste de envio automático - ${new Date().toLocaleString('pt-BR')}`;
            const textoEncoded = encodeURIComponent(mensagemTeste);
            const testUrl = `https://www.waboxapp.com/api/send/chat?token=${waboxappToken}&uid=${waboxappUid}&to=${numeroFormatado}&text=${textoEncoded}`;

            const testResponse = await axios.get(testUrl, {
              timeout: 30000,
              validateStatus: () => true
            });

            const testData = testResponse.data || {};
            const isSuccess = testData.success === true || testData.success === 1 || 
                             testData.sent === true || testData.sent === 1 ||
                             (testData.status && (testData.status === 'sent' || testData.status === 'success'));

            diagnostico.testeEnvio = {
              numeroFormatado: numeroFormatado,
              statusHttp: testResponse.status,
              sucesso: isSuccess,
              respostaApi: testData,
              mensagem: isSuccess ? 'Mensagem de teste enviada com sucesso (verifique se chegou)' : 'Falha no envio da mensagem de teste'
            };

            console.log('[DIAGNOSTICO] Resultado do teste:', diagnostico.testeEnvio);
          }
        } catch (testError) {
          diagnostico.testeEnvio = {
            erro: testError.message,
            detalhes: testError.response?.data || testError.message
          };
          console.error('[DIAGNOSTICO] Erro no teste de envio:', testError);
        }
      }

      // Resumo e recomendações
      const recomendacoes = [];
      
      // Sempre recomendar verificar no painel, já que não temos como verificar via API
      recomendacoes.push({
        nivel: 'IMPORTANTE',
        problema: 'Verificar conexão do WhatsApp no painel',
        solucao: 'Acesse https://www.waboxapp.com → Meus telefones → Verifique se o número está conectado (status verde). Se não estiver, escaneie o QR Code novamente.'
      });

      if (diagnostico.testeEnvio && !diagnostico.testeEnvio.sucesso) {
        recomendacoes.push({
          nivel: 'ALTO',
          problema: 'Falha no teste de envio',
          solucao: 'Verifique se o número de destino está correto e se está registrado no WhatsApp. Verifique também se há créditos disponíveis na conta.'
        });
      }

      if (diagnostico.configuracao.uid && diagnostico.testeEnvio?.numeroFormatado === diagnostico.configuracao.uid) {
        recomendacoes.push({
          nivel: 'ALTO',
          problema: 'Número de destino é o mesmo do UID',
          solucao: 'O número que envia (UID) não pode ser o mesmo do número que recebe. Verifique o cadastro do motorista.'
        });
      }

      if (recomendacoes.length === 0 && diagnostico.statusConexao?.conectado) {
        recomendacoes.push({
          nivel: 'INFO',
          mensagem: 'Tudo parece estar configurado corretamente. Se as mensagens não estão chegando, verifique: 1) Se o número de destino está correto, 2) Se o destinatário tem WhatsApp instalado, 3) Se há bloqueios ou restrições.'
        });
      }

      res.json({
        ...diagnostico,
        recomendacoes,
        timestamp: new Date().toISOString()
      });

    } catch (err) {
      console.error('[DIAGNOSTICO] Erro geral:', err);
      res.status(500).json({
        error: 'Erro ao executar diagnóstico',
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    }
  },

  // ============================================================================
  // MONITORAMENTO DE USO DE MENSAGENS - WABOXAPP
  // ============================================================================
  verificarStatusMensagens: async (req, res) => {
    try {
      const pool = await poolPromise;

      // Verificar se a tabela existe
      const tabelaExiste = await pool.request().query(`
        SELECT COUNT(*) AS TOTAL
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'LOG_ENVIO_WHATSAPP'
      `);

      if (tabelaExiste.recordset[0].TOTAL === 0) {
        return res.json({
          tabelaExiste: false,
          mensagem: 'Tabela de log ainda não foi criada. Execute o script SQL primeiro.',
          mensagensEnviadas: 0,
          limiteGratuito: 100,
          porcentagemUsada: 0,
          alerta: null
        });
      }

      // Contar mensagens enviadas no mês atual
      const hoje = new Date();
      const primeiroDiaMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0, 23, 59, 59);

      const resultado = await pool.request()
        .input('DATA_INICIO', sql.DateTime, primeiroDiaMes)
        .input('DATA_FIM', sql.DateTime, ultimoDiaMes)
        .query(`
          SELECT 
            COUNT(*) AS TOTAL_ENVIADAS,
            COUNT(CASE WHEN STATUS_ENVIO = 'ENVIADO' THEN 1 END) AS ENVIADAS_SUCESSO,
            COUNT(CASE WHEN STATUS_ENVIO = 'ERRO' THEN 1 END) AS ENVIADAS_ERRO
          FROM [dbo].[LOG_ENVIO_WHATSAPP]
          WHERE DHENVIO >= @DATA_INICIO AND DHENVIO <= @DATA_FIM
        `);

      const mensagensEnviadas = resultado.recordset[0].TOTAL_ENVIADAS || 0;
      const mensagensSucesso = resultado.recordset[0].ENVIADAS_SUCESSO || 0;
      const mensagensErro = resultado.recordset[0].ENVIADAS_ERRO || 0;

      // Limites dos planos (em ordem crescente)
      const limites = {
        gratuito: 100,
        basico: 1000,
        intermediario: 10000,
        avancado: 25000
      };

      // Determinar qual plano está sendo usado (assumindo gratuito por padrão)
      // Você pode ajustar isso baseado na configuração do usuário
      const limiteAtual = limites.gratuito; // Por padrão, assume plano gratuito
      const porcentagemUsada = (mensagensEnviadas / limiteAtual) * 100;

      // Gerar alertas
      let alerta = null;
      if (mensagensEnviadas >= limiteAtual) {
        alerta = {
          nivel: 'CRITICO',
          mensagem: `⚠️ LIMITE ATINGIDO! Você já enviou ${mensagensEnviadas} mensagens este mês. O plano gratuito permite apenas ${limiteAtual} mensagens. Considere fazer upgrade ou usar o método manual.`,
          cor: 'red'
        };
      } else if (porcentagemUsada >= 90) {
        alerta = {
          nivel: 'ALTO',
          mensagem: `⚠️ ATENÇÃO! Você já usou ${mensagensEnviadas} de ${limiteAtual} mensagens (${porcentagemUsada.toFixed(1)}%). Restam apenas ${limiteAtual - mensagensEnviadas} mensagens gratuitas.`,
          cor: 'orange'
        };
      } else if (porcentagemUsada >= 80) {
        alerta = {
          nivel: 'MEDIO',
          mensagem: `ℹ️ Você já usou ${mensagensEnviadas} de ${limiteAtual} mensagens (${porcentagemUsada.toFixed(1)}%). Restam ${limiteAtual - mensagensEnviadas} mensagens gratuitas.`,
          cor: 'yellow'
        };
      }

      res.json({
        tabelaExiste: true,
        mensagensEnviadas,
        mensagensSucesso,
        mensagensErro,
        limiteGratuito: limiteAtual,
        mensagensRestantes: Math.max(0, limiteAtual - mensagensEnviadas),
        porcentagemUsada: parseFloat(porcentagemUsada.toFixed(2)),
        periodo: {
          inicio: primeiroDiaMes.toISOString().split('T')[0],
          fim: ultimoDiaMes.toISOString().split('T')[0],
          mes: hoje.toLocaleString('pt-BR', { month: 'long', year: 'numeric' })
        },
        alerta,
        recomendacao: mensagensEnviadas >= limiteAtual 
          ? 'Considere fazer upgrade para um plano pago ou usar o método manual (botão "Abrir Todos").'
          : null
      });

    } catch (err) {
      console.error('Erro ao verificar status de mensagens:', err);
      res.status(500).json({
        error: 'Erro ao verificar status de mensagens.',
        message: err.message
      });
    }
  },

  // ============================================================================
  // MÉTODOS PARA GERENCIAR VEÍCULO DA VIAGEM
  // ============================================================================

  // Buscar equipamento por placa ou código
  buscarEquipamento: async (req, res) => {
    try {
      const { placa, codigo } = req.query;
      
      if (!placa && !codigo) {
        return res.status(400).json({ error: 'Informe a placa ou o código do equipamento.' });
      }

      const pool = await poolPromise;
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

      const request = pool.request();
      if (placa) {
        query += ` AND UPPER(e.REFEQUIPAMENTO) = UPPER(@PLACA)`;
        request.input('PLACA', sql.VarChar(20), placa.toUpperCase().trim());
      }
      if (codigo) {
        query += ` AND e.IDEQUIPAMENTO = @CODIGO`;
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
            vv.IDVIAGEM,
            vv.IDEQUIPAMENTO,
            vv.REFEQUIPAMENTO,
            vv.TPEQUIPAMENTO,
            e.DSEQUIPAMENTO,
            e.FGACTIVE,
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
          FROM [dbo].[VIAGEMVEICULO] vv
          INNER JOIN [dbo].[EQUIPAMENTO] e ON vv.IDEQUIPAMENTO = e.IDEQUIPAMENTO
          LEFT JOIN [dbo].[GRUPOEQUIPAMENTO] g ON e.CDGRUPOEQUIPAMENTO = g.CDGRUPOEQUIPAMENTO
          LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON e.CDTIPOEQUIPAMENTO = t.CDTIPOEQUIPAMENTO
          LEFT JOIN [dbo].[MARCAEQUIPAMENTO] m ON e.CDMARCAEQUIPAMENTO = m.CDMARCAEQUIPAMENTO
          LEFT JOIN [dbo].[MODELOEQUIPAMENTO] mod ON e.CDMODELOEQUIPAMENTO = mod.CDMODELOEQUIPAMENTO
          LEFT JOIN [dbo].[CLASSEFROTA] c ON e.CDCLASSEFROTA = c.CDCLASSEFROTA
          WHERE vv.IDVIAGEM = @IDVIAGEM
          ORDER BY vv.IDEQUIPAMENTO
        `);

      // Retornar lista (pode estar vazia - isso é normal)
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
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Verificar se já existe esta combinação específica (IDVIAGEM + IDEQUIPAMENTO)
        const checkRequest = new sql.Request(transaction);
        const checkResult = await checkRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
          .query('SELECT COUNT(*) AS COUNT FROM [dbo].[VIAGEMVEICULO] WHERE IDVIAGEM = @IDVIAGEM AND IDEQUIPAMENTO = @IDEQUIPAMENTO');

        if (checkResult.recordset[0].COUNT > 0) {
          // Atualizar combinação específica
          const updateRequest = new sql.Request(transaction);
          await updateRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .query(`
              UPDATE [dbo].[VIAGEMVEICULO]
              SET REFEQUIPAMENTO = @REFEQUIPAMENTO,
                  TPEQUIPAMENTO = @TPEQUIPAMENTO,
                  DHMAINTENANCE = GETDATE(),
                  SGUSER = 'SYSTEM',
                  SERVERORIG = 'AppDVcargas'
              WHERE IDVIAGEM = @IDVIAGEM AND IDEQUIPAMENTO = @IDEQUIPAMENTO
            `);
        } else {
          // Inserir nova combinação
          const insertRequest = new sql.Request(transaction);
          await insertRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), parseFloat(id))
            .input('IDEQUIPAMENTO', sql.Decimal(15, 0), parseFloat(idequipamento))
            .input('REFEQUIPAMENTO', sql.VarChar(20), refequipamento.toUpperCase().trim())
            .input('TPEQUIPAMENTO', sql.Char(2), tpequipamento.toUpperCase().trim())
            .query(`
              INSERT INTO [dbo].[VIAGEMVEICULO] (IDVIAGEM, IDEQUIPAMENTO, REFEQUIPAMENTO, TPEQUIPAMENTO, DHMAINTENANCE, SGUSER, SERVERORIG)
              VALUES (@IDVIAGEM, @IDEQUIPAMENTO, @REFEQUIPAMENTO, @TPEQUIPAMENTO, GETDATE(), 'SYSTEM', 'AppDVcargas')
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
          cg.CDCADASTRO AS CDCADASTROGERAL,
          cg.CGCCPF,
          cg.RZSOCIAL,
          cg.NMFANTASIA,
          cg.FGFISICAJURIDICA,
          cg.FGTIPOCADASTRO,
          cg.FGRASTREADO,
          cg.FGACTIVE,
          cg.CDTRANSPORTADOR,
          t.RZSOCIAL AS TRANSPORTADOR_NOME,
          cg.CEP,
          cg.CDCIDADE,
          c.ESTADO AS CIDADE_ESTADO,
          c.NMCIDADE AS CIDADE_NOME,
          cg.ENDERECO,
          cg.NRENDERECO,
          cg.COMPLEND,
          cg.BAIRRO,
          cg.NRCELULAR,
          cg.ENDEMAIL,
          cg.LATITUDE,
          cg.LONGITUDE
        FROM [dbo].[CADASTROGERAL] cg
        LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
        LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
        WHERE 1=1
      `;

      const request = pool.request();
      if (cpf) {
        const cpfLimpo = cpf.replace(/[^\d]+/g, '');
        query += ` AND cg.CGCCPF = @CPF`;
        request.input('CPF', sql.VarChar(14), cpfLimpo);
      }
      if (nome) {
        query += ` AND (cg.RZSOCIAL LIKE @NOME OR cg.NMFANTASIA LIKE @NOME)`;
        request.input('NOME', sql.VarChar(100), `%${nome}%`);
      }
      if (codigo) {
        query += ` AND cg.CDCADASTRO = @CODIGO`;
        request.input('CODIGO', sql.Decimal(15, 0), parseFloat(codigo));
      }

      const result = await request.query(query);
      
      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Cadastro não encontrado.' });
      }

      if (result.recordset.length > 1 && (cpf || codigo)) {
        return res.json(result.recordset[0]);
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
            vm.IDVIAGEM,
            vm.CDMOTORISTA,
            cg.CDCADASTRO AS CDCADASTROGERAL,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NMFANTASIA,
            cg.FGFISICAJURIDICA,
            cg.FGTIPOCADASTRO,
            cg.FGRASTREADO,
            cg.FGACTIVE,
            cg.CDTRANSPORTADOR,
            t.RZSOCIAL AS TRANSPORTADOR_NOME,
            cg.CEP,
            cg.CDCIDADE,
            c.ESTADO AS CIDADE_ESTADO,
            c.NMCIDADE AS CIDADE_NOME,
            cg.ENDERECO,
            cg.NRENDERECO,
            cg.COMPLEND,
            cg.BAIRRO,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.LATITUDE,
            cg.LONGITUDE
          FROM [dbo].[VIAGEMMOTORISTA] vm
          INNER JOIN [dbo].[CADASTROGERAL] cg ON vm.CDMOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
          LEFT JOIN [dbo].[CADASTROGERAL] t ON cg.CDTRANSPORTADOR = t.CDCADASTRO
          WHERE vm.IDVIAGEM = @IDVIAGEM
          ORDER BY vm.CDMOTORISTA
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
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Verificar se já existe esta combinação específica (IDVIAGEM + CDMOTORISTA)
        const checkRequest = new sql.Request(transaction);
        const checkResult = await checkRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .query('SELECT COUNT(*) AS COUNT FROM [dbo].[VIAGEMMOTORISTA] WHERE IDVIAGEM = @IDVIAGEM AND CDMOTORISTA = @CDMOTORISTA');

        if (checkResult.recordset[0].COUNT > 0) {
          // Combinação já existe - apenas atualizar timestamp
          const updateRequest = new sql.Request(transaction);
          await updateRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
            .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
            .query(`
              UPDATE [dbo].[VIAGEMMOTORISTA]
              SET DHMAINTENANCE = GETDATE(),
                  SGUSER = 'SYSTEM',
                  SERVERORIG = 'AppDVcargas'
              WHERE IDVIAGEM = @IDVIAGEM AND CDMOTORISTA = @CDMOTORISTA
            `);
        } else {
          // Inserir nova combinação
          const insertRequest = new sql.Request(transaction);
          await insertRequest
            .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
            .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
            .query(`
              INSERT INTO [dbo].[VIAGEMMOTORISTA] (IDVIAGEM, CDMOTORISTA, DHMAINTENANCE, SGUSER, SERVERORIG)
              VALUES (@IDVIAGEM, @CDMOTORISTA, GETDATE(), 'SYSTEM', 'AppDVcargas')
            `);
        }

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
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = new sql.Request(transaction);
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('IDEQUIPAMENTO', sql.Decimal(15, 0), idequipamentoNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMVEICULO]
            WHERE IDVIAGEM = @IDVIAGEM AND IDEQUIPAMENTO = @IDEQUIPAMENTO
          `);

        if (result.rowsAffected[0] === 0) {
          await transaction.rollback();
          return res.status(404).json({ error: 'Veículo não encontrado para esta viagem.' });
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
      const transaction = new sql.Transaction(pool);

      await transaction.begin();

      try {
        const deleteRequest = new sql.Request(transaction);
        const result = await deleteRequest
          .input('IDVIAGEM', sql.Decimal(15, 0), idNum)
          .input('CDMOTORISTA', sql.Decimal(15, 0), cdmotoristaNum)
          .query(`
            DELETE FROM [dbo].[VIAGEMMOTORISTA]
            WHERE IDVIAGEM = @IDVIAGEM AND CDMOTORISTA = @CDMOTORISTA
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
  }
};

module.exports = viagemController;