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
            c.TXTCONVOCACAO,
            v.DTPREVINICIO,
            v.DTPREVFINAL,
            v.VLFRETE,
            v.DISTANCIAKM,
            r.DSROTEIRO,
            co.NMCIDADE + ' - ' + co.ESTADO AS ORIGEM,
            cd.NMCIDADE + ' - ' + cd.ESTADO AS DESTINO
          FROM [dbo].[CONVOCACAO] c
          INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.IDVIAGEM = v.IDVIAGEM
          LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          WHERE c.CDCADASTRO_MOTORISTA = @idmotorista
          ORDER BY c.DHCONVOCACAO DESC
        `);

      res.json(result.recordset);
    } catch (err) {
      console.error('Erro ao listar convocações:', err);
      res.status(500).json({ error: 'Erro ao buscar convocações.' });
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

