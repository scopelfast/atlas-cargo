// backend/controllers/motorista-app.controller.js
// Controller para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2025
// IMPORTANTE: Integrado com sistema existente (CADASTROGERAL, VIAGEMMESTRE, CONVOCACAO)

const sql = require('mssql');
const { poolPromise } = require('../config/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

const motoristaAppController = {
  // ==========================================
  // AUTH - Login do Motorista
  // ==========================================
  login: async (req, res) => {
    try {
      const { cpf, senha } = req.body;

      if (!cpf || !senha) {
        return res.status(400).json({ error: 'CPF e senha são obrigatórios.' });
      }

      // Limpar CPF
      const cpfLimpo = cpf.replace(/\D/g, '');

      if (cpfLimpo.length !== 11) {
        return res.status(400).json({ error: 'CPF inválido.' });
      }

      const pool = await poolPromise;

      // Buscar motorista em CADASTROGERAL + MOTORISTA_COMPLEMENTO
      const result = await pool
        .request()
        .input('cpf', sql.VarChar(14), cpfLimpo)
        .query(`
          SELECT 
            cg.CDCADASTRO,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.FGACTIVE,
            cg.FGTIPOCADASTRO,
            mc.NRCNH,
            mc.CATEGORIACNH,
            mc.VALIDADECNH,
            mc.STATUSAPROVACAO
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          WHERE cg.CGCCPF = @cpf
            AND cg.FGTIPOCADASTRO = 'M'
            AND cg.FGACTIVE = 'A'
        `);

      if (result.recordset.length === 0) {
        return res.status(401).json({ error: 'Motorista não encontrado ou inativo.' });
      }

      const motorista = result.recordset[0];

      // TODO: Validar senha (quando implementar campo SENHA)
      // Por enquanto, aceitar qualquer senha (DESENVOLVIMENTO)
      // if (!await bcrypt.compare(senha, motorista.SENHA)) {
      //   return res.status(401).json({ error: 'Senha incorreta.' });
      // }

      // Verificar aprovação
      if (motorista.STATUSAPROVACAO === 'R') {
        return res.status(403).json({ error: 'Cadastro rejeitado. Entre em contato com a empresa.' });
      }

      if (motorista.STATUSAPROVACAO === 'P') {
        return res.status(403).json({ error: 'Cadastro pendente de aprovação.' });
      }

      // Gerar token JWT
      const token = jwt.sign(
        {
          id: motorista.CDCADASTRO,
          cpf: motorista.CGCCPF,
          tipo: 'motorista'
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        success: true,
        message: 'Login realizado com sucesso!',
        token,
        motorista: {
          id: motorista.CDCADASTRO,
          nome: motorista.RZSOCIAL,
          cpf: motorista.CGCCPF,
          celular: motorista.NRCELULAR,
          email: motorista.ENDEMAIL,
          cnh: motorista.NRCNH,
          categoria: motorista.CATEGORIACNH,
          validade: motorista.VALIDADECNH,
          aprovado: motorista.STATUSAPROVACAO === 'A'
        }
      });
    } catch (err) {
      console.error('Erro no login do motorista:', err);
      res.status(500).json({ error: 'Erro ao fazer login.' });
    }
  },

  // ==========================================
  // PERFIL - Buscar dados do motorista
  // ==========================================
  perfil: async (req, res) => {
    try {
      const { id } = req.params;

      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT 
            cg.CDCADASTRO,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NMFANTASIA,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.ENDERECO,
            cg.NRENDERECO,
            cg.COMPLEND,
            cg.BAIRRO,
            cg.CEP,
            cg.CDCIDADE,
            c.NMCIDADE,
            c.ESTADO,
            cg.LATITUDE,
            cg.LONGITUDE,
            cg.FGACTIVE,
            mc.NRCNH,
            mc.CATEGORIACNH,
            mc.VALIDADECNH,
            mc.DATAPRIMEIRAHAB,
            mc.FOTOCNH,
            mc.FOTOMOTORISTA,
            mc.STATUSAPROVACAO
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
          WHERE cg.CDCADASTRO = @id
            AND cg.FGTIPOCADASTRO = 'M'
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Motorista não encontrado.' });
      }

      res.json(result.recordset[0]);
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
      res.status(500).json({ error: 'Erro ao buscar perfil.' });
    }
  },

  // ==========================================
  // CADASTRO - Novo motorista (placeholder)
  // ==========================================
  cadastro: async (req, res) => {
    try {
      // TODO: Implementar cadastro completo
      res.json({ 
        success: false, 
        message: 'Cadastro em desenvolvimento. Use o sistema web por enquanto.' 
      });
    } catch (err) {
      console.error('Erro no cadastro:', err);
      res.status(500).json({ error: 'Erro ao cadastrar.' });
    }
  },

  // ==========================================
  // CONVOCAÇÕES - Listar convocações do motorista
  // ==========================================
  minhasConvocacoes: async (req, res) => {
    try {
      const { idmotorista } = req.params;

      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('idmotorista', sql.Decimal(15, 0), parseFloat(idmotorista))
        .query(`
          SELECT 
            c.IDCONVOCACAO,
            c.IDVIAGEM,
            c.STATUS,
            c.DHCONVOCACAO,
            c.DHRESPOSTA,
            c.DHACESSO,
            c.TXTCONVOCACAO,
            c.NRCELULAR,
            c.LATITUDE,
            c.LONGITUDE,
            v.DTPREVINICIO,
            v.DTPREVFINAL,
            v.VLFRETE,
            v.PESO,
            v.CUBAGEM,
            v.DISTANCIAKM,
            v.OBSERV,
            v.CDSITUACAOVIAGEM,
            sv.DSSITUACAOVIAGEM,
            v.CDTIPOVIAGEM,
            tv.DSTIPOVIAGEM,
            v.CDCLASSEFROTA,
            cf.DSCLASSEFROTA,
            r.DSROTEIRO,
            co.NMCIDADE AS ORIGEM_CIDADE,
            co.ESTADO AS ORIGEM_ESTADO,
            cd.NMCIDADE AS DESTINO_CIDADE,
            cd.ESTADO AS DESTINO_ESTADO,
            cont.RZSOCIAL AS CONTRATADOR
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
          LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.CDSITUACAOVIAGEM = sv.CDSITUACAOVIAGEM
          LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.CDTIPOVIAGEM = tv.CDTIPOVIAGEM
          LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.CDCONTRATADOR = cont.CDCADASTRO
          WHERE c.CDCADASTRO_MOTORISTA = @idmotorista
          ORDER BY 
            CASE 
              WHEN c.STATUS = 'PENDENTE' THEN 1
              WHEN c.STATUS = 'ACEITA' THEN 2
              WHEN c.STATUS = 'CONFIRMADA' THEN 3
              ELSE 4
            END,
            c.DHCONVOCACAO DESC
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao listar convocações:', err);
      res.status(500).json({ error: 'Erro ao buscar convocações.' });
    }
  },

  // ==========================================
  // ACEITAR CONVOCAÇÃO
  // ==========================================
  aceitarConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude } = req.body;

      const pool = await poolPromise;
      
      // Atualizar status para ACEITA
      await pool
        .request()
        .input('id', sql.Int, parseInt(id))
        .input('latitude', sql.Float, latitude || null)
        .input('longitude', sql.Float, longitude || null)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET 
            STATUS = 'ACEITA',
            DHRESPOSTA = GETDATE(),
            LATITUDE = COALESCE(@latitude, LATITUDE),
            LONGITUDE = COALESCE(@longitude, LONGITUDE)
          WHERE IDCONVOCACAO = @id
        `);

      res.json({ success: true, message: 'Convocação aceita com sucesso!' });
    } catch (err) {
      console.error('Erro ao aceitar convocação:', err);
      res.status(500).json({ error: 'Erro ao aceitar convocação.' });
    }
  },

  // ==========================================
  // RECUSAR CONVOCAÇÃO
  // ==========================================
  recusarConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const { motivo } = req.body;

      const pool = await poolPromise;
      
      await pool
        .request()
        .input('id', sql.Int, parseInt(id))
        .input('motivo', sql.Int, motivo || null)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET 
            STATUS = 'RECUSADA',
            DHRESPOSTA = GETDATE(),
            CDMOTIVORECUSA = @motivo
          WHERE IDCONVOCACAO = @id
        `);

      res.json({ success: true, message: 'Convocação recusada.' });
    } catch (err) {
      console.error('Erro ao recusar convocação:', err);
      res.status(500).json({ error: 'Erro ao recusar convocação.' });
    }
  },

  // ==========================================
  // GPS - Registrar posição
  // ==========================================
  registrarGPS: async (req, res) => {
    try {
      const { idviagem, latitude, longitude, velocidade, precisao, bateria } = req.body;
      const { idmotorista } = req.user || req.body; // Via token JWT ou body (dev)

      if (!idviagem || !latitude || !longitude) {
        return res.status(400).json({ error: 'Dados obrigatórios: idviagem, latitude, longitude' });
      }

      const pool = await poolPromise;
      await pool
        .request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(idmotorista))
        .input('latitude', sql.Decimal(10, 8), parseFloat(latitude))
        .input('longitude', sql.Decimal(11, 8), parseFloat(longitude))
        .input('velocidade', sql.Decimal(5, 2), velocidade || null)
        .input('precisao', sql.Int, precisao || null)
        .input('bateria', sql.Int, bateria || null)
        .query(`
          INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
            IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, BATERIA, DHREGISTRO, TIPO, FONTE
          )
          VALUES (
            @idviagem, @cdcadastro, @latitude, @longitude, @velocidade, @precisao, @bateria, GETDATE(), 'A', 'APP'
          )
        `);

      res.json({ success: true, message: 'Posição registrada com sucesso!' });
    } catch (err) {
      console.error('Erro ao registrar GPS:', err);
      res.status(500).json({ error: 'Erro ao registrar posição.' });
    }
  },

  // ==========================================
  // CARGAS DISPONÍVEIS - Listar viagens abertas
  // ==========================================
  cargasDisponiveis: async (req, res) => {
    try {
      const { estado, distanciaMax, freteMin } = req.query;

      const pool = await poolPromise;
      let query = `
        SELECT 
          v.IDVIAGEM,
          v.DTPREVINICIO,
          v.DTPREVFINAL,
          v.VLFRETE,
          v.PESO,
          v.CUBAGEM,
          v.DISTANCIAKM,
          v.OBSERV,
          v.CDSITUACAOVIAGEM,
          sv.DSSITUACAOVIAGEM,
          v.CDTIPOVIAGEM,
          tv.DSTIPOVIAGEM,
          v.CDCLASSEFROTA,
          cf.DSCLASSEFROTA,
          r.DSROTEIRO,
          co.NMCIDADE AS ORIGEM_CIDADE,
          co.ESTADO AS ORIGEM_ESTADO,
          cd.NMCIDADE AS DESTINO_CIDADE,
          cd.ESTADO AS DESTINO_ESTADO,
          cont.RZSOCIAL AS CONTRATADOR,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE IDVIAGEM = v.IDVIAGEM) AS TOTAL_CONVOCACOES
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.CDSITUACAOVIAGEM = sv.CDSITUACAOVIAGEM
        LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.CDTIPOVIAGEM = tv.CDTIPOVIAGEM
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.CDCLASSEFROTA = cf.CDCLASSEFROTA
        LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.CDCONTRATADOR = cont.CDCADASTRO
        WHERE v.FGSITVIAGEM = 'D'
          AND v.FGACTIVE = 'S'
          AND NOT EXISTS (
            SELECT 1 FROM [dbo].[CONVOCACAO] 
            WHERE IDVIAGEM = v.IDVIAGEM 
            AND STATUS IN ('CONFIRMADA', 'ACEITA')
          )
      `;

      const params = [];

      if (estado) {
        query += ` AND (co.ESTADO = @estado OR cd.ESTADO = @estado)`;
        params.push({ name: 'estado', value: estado });
      }

      if (distanciaMax) {
        query += ` AND v.DISTANCIAKM <= @distanciaMax`;
        params.push({ name: 'distanciaMax', value: parseFloat(distanciaMax) });
      }

      if (freteMin) {
        query += ` AND v.VLFRETE >= @freteMin`;
        params.push({ name: 'freteMin', value: parseFloat(freteMin) });
      }

      query += ` ORDER BY v.DHINCLUSAO DESC`;

      const request = pool.request();
      params.forEach(p => request.input(p.name, p.value));

      const result = await request.query(query);
      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao listar cargas disponíveis:', err);
      res.status(500).json({ error: 'Erro ao buscar cargas.' });
    }
  },

  // ==========================================
  // ACEITAR CARGA - Cria convocação
  // ==========================================
  aceitarCarga: async (req, res) => {
    try {
      const { idviagem } = req.params;
      const { idmotorista } = req.body;
      const { latitude, longitude } = req.body;

      const pool = await poolPromise;

      // Buscar dados do motorista
      const motorista = await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(idmotorista))
        .query(`
          SELECT NRCELULAR FROM CADASTROGERAL WHERE CDCADASTRO = @id
        `);

      if (motorista.recordset.length === 0) {
        return res.status(404).json({ error: 'Motorista não encontrado.' });
      }

      const celular = motorista.recordset[0].NRCELULAR;

      // Criar convocação
      await pool
        .request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(idmotorista))
        .input('celular', sql.Decimal(15, 0), celular)
        .input('latitude', sql.Float, latitude || null)
        .input('longitude', sql.Float, longitude || null)
        .query(`
          INSERT INTO [dbo].[CONVOCACAO] (
            IDVIAGEM, CDCADASTRO_MOTORISTA, STATUS, DHCONVOCACAO, 
            NRCELULAR, TXTCONVOCACAO, LATITUDE, LONGITUDE, SGUSUARIO_OPERADOR
          )
          VALUES (
            @idviagem, @cdcadastro, 'ACEITA', GETDATE(),
            @celular, 'Carga aceita pelo motorista via APP', @latitude, @longitude, 'APP_MOTORISTA'
          )
        `);

      res.json({ success: true, message: 'Carga aceita com sucesso!' });
    } catch (err) {
      console.error('Erro ao aceitar carga:', err);
      res.status(500).json({ error: 'Erro ao aceitar carga.' });
    }
  },

  // ==========================================
  // EVENTO - Registrar evento (parada, etc)
  // ==========================================
  registrarEvento: async (req, res) => {
    try {
      const { idviagem, tipo, descricao, latitude, longitude } = req.body;
      const { idmotorista } = req.user || req.body;

      if (!idviagem || !tipo) {
        return res.status(400).json({ error: 'Dados obrigatórios: idviagem, tipo' });
      }

      const pool = await poolPromise;
      await pool
        .request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('cdcadastro', sql.Decimal(15, 0), parseFloat(idmotorista))
        .input('tipo', sql.Char(1), tipo)
        .input('descricao', sql.VarChar(500), descricao || null)
        .input('latitude', sql.Decimal(10, 8), latitude || null)
        .input('longitude', sql.Decimal(11, 8), longitude || null)
        .query(`
          INSERT INTO [dbo].[VIAGEM_EVENTO] (
            IDVIAGEM, CDCADASTRO, TIPO, DESCRICAO, LATITUDE, LONGITUDE, DHEVENTO
          )
          VALUES (
            @idviagem, @cdcadastro, @tipo, @descricao, @latitude, @longitude, GETDATE()
          )
        `);

      res.json({ success: true, message: 'Evento registrado com sucesso!' });
    } catch (err) {
      console.error('Erro ao registrar evento:', err);
      res.status(500).json({ error: 'Erro ao registrar evento.' });
    }
  }
};

module.exports = motoristaAppController;

