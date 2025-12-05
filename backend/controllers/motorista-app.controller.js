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
      const { estado, distanciaMax, freteMin, idmotorista } = req.query;

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
          v.FGRASTREADO,
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
          cont.NRCELULAR AS CONTRATADOR_CELULAR,
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

      // Filtro por classes de frota do motorista
      if (idmotorista) {
        query += ` AND EXISTS (
          SELECT 1 FROM [dbo].[CLASSEFROTA_CG] ccf
          WHERE ccf.CDCADASTRO = @idmotorista
          AND ccf.CDCLASSEFROTA = v.CDCLASSEFROTA
          AND ccf.FGACTIVE = 'S'
        )`;
        params.push({ name: 'idmotorista', value: parseFloat(idmotorista), type: sql.Decimal(15, 0) });
      }

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
  // VIAGENS - Listar viagens em andamento do motorista
  // ==========================================
  listarViagensAndamento: async (req, res) => {
    try {
      const { cdMotorista } = req.params;

      console.log(`🚛 [VIAGENS] Buscando viagens do motorista ${cdMotorista}`);

      const pool = await poolPromise;

      const result = await pool
        .request()
        .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
        .query(`
          SELECT 
            V.IDVIAGEM,
            R.DSROTEIRO AS ROTEIRO,
            V.DTPREVINICIO AS DTCARREGAMENTO,
            V.DTPREVFINAL AS DTDESCARGA,
            S.DSSITUACAOVIAGEM AS SITUACAO,
            T.DSTIPOVIAGEM AS TIPO,
            F.DSCLASSEFROTA AS CLASSE,
            P.RZSOCIAL AS CONTRATADOR,
            P.NRCELULAR AS CELULAR_CONTRATADOR,
            V.VLFRETE AS FRETE,
            V.PESO,
            V.CUBAGEM
          FROM VIAGEMMESTRE V
          INNER JOIN VIAGEMMOTORISTA M ON V.IDVIAGEM = M.IDVIAGEM
          INNER JOIN CADASTROGERAL C ON M.CDMOTORISTA = C.CDCADASTRO
          LEFT JOIN SITUACAOVIAGEM S ON V.CDSITUACAOVIAGEM = S.CDSITUACAOVIAGEM
          LEFT JOIN TIPOVIAGEM T ON V.CDTIPOVIAGEM = T.CDTIPOVIAGEM
          LEFT JOIN CLASSEFROTA F ON V.CDCLASSEFROTA = F.CDCLASSEFROTA
          LEFT JOIN ROTEIRO R ON V.IDROTEIRO = R.IDROTEIRO
          LEFT JOIN CADASTROGERAL P ON V.CDCONTRATADOR = P.CDCADASTRO
          WHERE V.FGSITVIAGEM NOT IN ('C', 'F', 'E')
            AND M.CDMOTORISTA = @cdMotorista
          ORDER BY V.DTPREVINICIO
        `);

      console.log(`✅ [VIAGENS] ${result.recordset.length} viagem(ns) encontrada(s)`);

      res.json(result.recordset);
    } catch (error) {
      console.error('❌ [VIAGENS] Erro:', error);
      res.status(500).json({ error: 'Erro ao buscar viagens' });
    }
  },

  // ==========================================
  // VIAGENS - Detalhes de uma viagem específica
  // ==========================================
  detalhesViagem: async (req, res) => {
    try {
      const { idViagem } = req.params;

      console.log(`🚛 [VIAGEM] Buscando detalhes da viagem ${idViagem}`);

      const pool = await poolPromise;

      const result = await pool
        .request()
        .input('idViagem', sql.Int, idViagem)
        .query(`
          SELECT 
            V.*,
            R.DSROTEIRO,
            S.DSSITUACAOVIAGEM,
            T.DSTIPOVIAGEM,
            F.DSCLASSEFROTA,
            P.RZSOCIAL AS CONTRATADOR,
            P.NRCELULAR AS TELEFONE_CONTRATADOR,
            M.RZSOCIAL AS MOTORISTA
          FROM VIAGEMMESTRE V
          LEFT JOIN ROTEIRO R ON V.IDROTEIRO = R.IDROTEIRO
          LEFT JOIN SITUACAOVIAGEM S ON V.CDSITUACAOVIAGEM = S.CDSITUACAOVIAGEM
          LEFT JOIN TIPOVIAGEM T ON V.CDTIPOVIAGEM = T.CDTIPOVIAGEM
          LEFT JOIN CLASSEFROTA F ON V.CDCLASSEFROTA = F.CDCLASSEFROTA
          LEFT JOIN CADASTROGERAL P ON V.CDCONTRATADOR = P.CDCADASTRO
          LEFT JOIN VIAGEMMOTORISTA VM ON V.IDVIAGEM = VM.IDVIAGEM
          LEFT JOIN CADASTROGERAL M ON VM.CDMOTORISTA = M.CDCADASTRO
          WHERE V.IDVIAGEM = @idViagem
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada' });
      }

      console.log(`✅ [VIAGEM] Detalhes encontrados`);

      res.json(result.recordset[0]);
    } catch (error) {
      console.error('❌ [VIAGEM] Erro:', error);
      res.status(500).json({ error: 'Erro ao buscar detalhes da viagem' });
    }
  },

  // ==========================================
  // MACROS - Listar tipos de ocorrência
  // ==========================================
  listarMacros: async (req, res) => {
    try {
      console.log('📝 [MACROS] Buscando tipos de ocorrência...');

      const pool = await poolPromise;

      // Buscar todas as macros ordenadas
      const result = await pool.request().query(`
        SELECT 
          CDTIPOOCORRENCIA,
          DSTIPOOCORRENCIA,
          CDEDIPADRAO,
          FGSITUACAO,
          SEQ,
          CASE FGSITUACAO
            WHEN 'T' THEN 'TRÂNSITO'
            WHEN 'C' THEN 'CARREGAMENTO'
            WHEN 'D' THEN 'DESCARGA'
            WHEN 'P' THEN 'PARADA'
          END AS SITUACAO_TEXTO
        FROM TIPOOCORRENCIA
        ORDER BY 
          CASE FGSITUACAO 
            WHEN 'T' THEN 1 
            WHEN 'C' THEN 2 
            WHEN 'D' THEN 3 
            WHEN 'P' THEN 4 
          END,
          SEQ,
          CDTIPOOCORRENCIA
      `);

      // Adicionar ícones para cada tipo
      const macrosComIcones = result.recordset.map(macro => {
        let icon = '📝';
        
        // Ícones por tipo de ocorrência
        if (macro.CDTIPOOCORRENCIA === 103) icon = '🚚'; // Viagem - Início
        else if (macro.CDTIPOOCORRENCIA === 104) icon = '🔄'; // Viagem - Reinício
        else if (macro.CDTIPOOCORRENCIA === 151) icon = '📍'; // Carga - Chegada
        else if (macro.CDTIPOOCORRENCIA === 109) icon = '📦'; // Carga - Início
        else if (macro.CDTIPOOCORRENCIA === 110) icon = '✅'; // Carga - Fim
        else if (macro.CDTIPOOCORRENCIA === 159) icon = '📍'; // Descarga - Chegada
        else if (macro.CDTIPOOCORRENCIA === 192) icon = '📤'; // Descarga - Início
        else if (macro.CDTIPOOCORRENCIA === 111) icon = '✅'; // Descarga - Fim
        else if (macro.CDTIPOOCORRENCIA === 105) icon = '🍽️'; // Parada - Alimentação
        else if (macro.CDTIPOOCORRENCIA === 106) icon = '⛽'; // Parada - Abastecimento
        else if (macro.CDTIPOOCORRENCIA === 107) icon = '😴'; // Parada - Descanso
        else if (macro.CDTIPOOCORRENCIA === 26) icon = '🚔'; // Retido - Fiscal
        else if (macro.CDTIPOOCORRENCIA === 58) icon = '🔧'; // Parada - Manutenção
        
        return {
          ...macro,
          icon
        };
      });

      console.log(`✅ [MACROS] ${macrosComIcones.length} macros encontradas`);

      res.json(macrosComIcones);
    } catch (error) {
      console.error('❌ [MACROS] Erro ao listar macros:', error);
      res.status(500).json({ error: 'Erro ao listar macros' });
    }
  },

  // ==========================================
  // MACROS - Validar sequência de ocorrência
  // ==========================================
  validarSequenciaMacro: async (req, res) => {
    try {
      const { idViagem, cdTipoOcorrencia } = req.body;

      console.log(`📝 [VALIDAR] Viagem ${idViagem}, Macro ${cdTipoOcorrencia}`);

      if (!idViagem || !cdTipoOcorrencia) {
        return res.status(400).json({ error: 'idViagem e cdTipoOcorrencia são obrigatórios' });
      }

      const pool = await poolPromise;

      // Usar stored procedure de validação
      const result = await pool
        .request()
        .input('IDVIAGEM', sql.Int, idViagem)
        .input('CDTIPOOCORRENCIA', sql.SmallInt, cdTipoOcorrencia)
        .output('RESULTADO', sql.VarChar(500))
        .output('PERMITEREGISTRAR', sql.Bit)
        .execute('sp_ValidarSequenciaOcorrencia');

      const mensagem = result.output.RESULTADO;
      const valido = result.output.PERMITEREGISTRAR;

      console.log(`${valido ? '✅' : '❌'} [VALIDAR] ${mensagem}`);

      res.json({
        valido: valido,
        mensagem: mensagem
      });
    } catch (error) {
      console.error('❌ [VALIDAR] Erro:', error);
      res.status(500).json({ error: 'Erro ao validar sequência' });
    }
  },

  // ==========================================
  // MACROS - Registrar ocorrência
  // ==========================================
  registrarMacro: async (req, res) => {
    try {
      console.log('📝 [MACRO] Recebendo ocorrência...');
      console.log('📝 [MACRO] Body:', JSON.stringify(req.body, null, 2));

      const {
        idViagem,
        cdMotorista,
        cdTipoOcorrencia,
        latitude,
        longitude,
        altitude,
        precisao,
        velocidade,
        status,
        direcao,
        fotoBase64,
        observacao
      } = req.body;

      // Validações
      if (!idViagem || !cdMotorista || !cdTipoOcorrencia) {
        return res.status(400).json({ 
          error: 'idViagem, cdMotorista e cdTipoOcorrencia são obrigatórios' 
        });
      }

      const pool = await poolPromise;

      // Inserir ocorrência com GPS completo
      await pool
        .request()
        .input('idViagem', sql.Int, idViagem)
        .input('cdTipoOcorrencia', sql.SmallInt, cdTipoOcorrencia)
        .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
        .input('latitude', sql.Decimal(10, 7), latitude || null)
        .input('longitude', sql.Decimal(10, 7), longitude || null)
        .input('precisao', sql.Decimal(10, 2), precisao || null)
        .input('observacao', sql.VarChar(500), observacao || null)
        .input('fotoBase64', sql.Text, fotoBase64 || null)
        .query(`
          INSERT INTO VIAGEMOCORRENCIA (
            IDVIAGEM,
            CDTIPOOCORRENCIA,
            CDMOTORISTA,
            DTOCORRENCIA,
            DSOBSERVACAO,
            LATITUDE,
            LONGITUDE,
            NRPRECISAO,
            DSFOTOBASE64,
            FGSINCRONIZADO,
            DTSINCRONIZACAO
          ) VALUES (
            @idViagem,
            @cdTipoOcorrencia,
            @cdMotorista,
            GETDATE(),
            @observacao,
            @latitude,
            @longitude,
            @precisao,
            @fotoBase64,
            'S',
            GETDATE()
          )
        `);

      // Também registrar na tabela VIAGEMRASTREAMENTO (rastreamento completo)
      const temGPS = latitude && longitude;
      if (temGPS) {
        await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), idViagem)
          .input('cdCadastro', sql.Decimal(15, 0), cdMotorista)
          .input('latitude', sql.Decimal(10, 8), latitude)
          .input('longitude', sql.Decimal(11, 8), longitude)
          .input('velocidade', sql.Decimal(5, 2), velocidade || null)
          .input('precisao', sql.Int, precisao ? Math.round(precisao) : null)
          .input('altitude', sql.Decimal(10, 2), altitude || null)
          .input('status', sql.Char(1), status || 'P')
          .input('direcao', sql.Decimal(5, 2), direcao || null)
          .query(`
            INSERT INTO VIAGEMRASTREAMENTO (
              IDVIAGEM,
              CDCADASTRO,
              LATITUDE,
              LONGITUDE,
              VELOCIDADE,
              PRECISAO,
              ALTITUDE,
              FGSTATUS,
              DIRECAO,
              DHREGISTRO,
              TIPO,
              FONTE,
              VERSAOAPP
            ) VALUES (
              @idViagem,
              @cdCadastro,
              @latitude,
              @longitude,
              @velocidade,
              @precisao,
              @altitude,
              @status,
              @direcao,
              GETDATE(),
              'M',
              'APP',
              '1.0.0'
            )
          `);
        console.log(`   📍 GPS: ${latitude}, ${longitude}`);
      } else {
        console.log(`   📍 GPS: Não fornecido`);
      }

      // Buscar nome da ocorrência
      const tipoResult = await pool
        .request()
        .input('cdTipoOcorrencia', sql.SmallInt, cdTipoOcorrencia)
        .query(`
          SELECT DSTIPOOCORRENCIA 
          FROM TIPOOCORRENCIA 
          WHERE CDTIPOOCORRENCIA = @cdTipoOcorrencia
        `);

      const nomeMacro = tipoResult.recordset[0]?.DSTIPOOCORRENCIA || 'Ocorrência';
      const statusTexto = status === 'P' ? 'Parado' : 'Em Movimento';

      console.log(`✅ [MACRO] ${nomeMacro} registrada!`);
      if (temGPS) {
        console.log(`   🚗 Velocidade: ${velocidade || 0} km/h (${statusTexto})`);
      }
      console.log(`   ${fotoBase64 ? '📸 Com foto' : '📝 Sem foto'}`);

      res.json({
        success: true,
        message: `${nomeMacro} registrada com sucesso`,
        dados: {
          tipo: nomeMacro,
          temFoto: !!fotoBase64,
          temGPS: temGPS,
          velocidade: velocidade,
          status: statusTexto,
        }
      });
    } catch (error) {
      console.error('❌ [MACRO] Erro ao registrar:', error);
      res.status(500).json({ error: 'Erro ao registrar ocorrência' });
    }
  },

  // ==========================================
  // MACROS - Histórico de ocorrências da viagem
  // ==========================================
  historicoMacros: async (req, res) => {
    try {
      const { idViagem } = req.params;

      console.log(`📋 [HISTÓRICO] Buscando macros da viagem ${idViagem}`);

      const pool = await poolPromise;

      const result = await pool
        .request()
        .input('idViagem', sql.Int, idViagem)
        .query(`
          SELECT 
            VO.IDVIAGEM_OCORRENCIA,
            VO.CDTIPOOCORRENCIA,
            T.DSTIPOOCORRENCIA,
            T.FGSITUACAO,
            T.SEQ,
            VO.DTOCORRENCIA,
            VO.DSOBSERVACAO,
            VO.LATITUDE,
            VO.LONGITUDE,
            CASE WHEN VO.DSCAMINHOFOTO IS NOT NULL OR VO.DSFOTOBASE64 IS NOT NULL 
              THEN 'S' ELSE 'N' 
            END AS TEM_FOTO,
            VO.FGSINCRONIZADO
          FROM VIAGEMOCORRENCIA VO
          INNER JOIN TIPOOCORRENCIA T ON VO.CDTIPOOCORRENCIA = T.CDTIPOOCORRENCIA
          WHERE VO.IDVIAGEM = @idViagem
          ORDER BY VO.DTOCORRENCIA DESC
        `);

      console.log(`✅ [HISTÓRICO] ${result.recordset.length} ocorrências encontradas`);

      res.json(result.recordset);
    } catch (error) {
      console.error('❌ [HISTÓRICO] Erro:', error);
      
      // Se a tabela não existe, retornar array vazio ao invés de erro
      if (error.message && error.message.includes('Invalid object name')) {
        console.warn('⚠️ [HISTÓRICO] Tabela VIAGEMOCORRENCIA não existe ainda');
        console.warn('⚠️ Execute o script: backend/scripts/EXECUTAR_TUDO_APP_MOTORISTA.sql');
        return res.json([]);
      }
      
      res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  },

  // ==========================================
  // GPS - Registrar posição GPS
  // ==========================================
  registrarGPS: async (req, res) => {
    try {
      console.log('📍 [GPS] Recebendo posição GPS...');
      console.log('📍 [GPS] Body:', JSON.stringify(req.body, null, 2));

      const {
        cdMotorista,
        idViagem,
        latitude,
        longitude,
        altitude,
        precisao,
        velocidade,
        status,
        direcao,
        tipoEnvio,
        dtPosicao,
      } = req.body;

      // Validações
      if (!cdMotorista) {
        return res.status(400).json({ error: 'cdMotorista é obrigatório' });
      }

      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'latitude e longitude são obrigatórios' });
      }

      const pool = await poolPromise;

      // Se TEM viagem: salvar em VIAGEMRASTREAMENTO
      if (idViagem) {
        await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), idViagem)
          .input('cdCadastro', sql.Decimal(15, 0), cdMotorista)
          .input('latitude', sql.Decimal(10, 8), latitude)
          .input('longitude', sql.Decimal(11, 8), longitude)
          .input('velocidade', sql.Decimal(5, 2), velocidade || null)
          .input('precisao', sql.Int, precisao ? Math.round(precisao) : null)
          .input('altitude', sql.Decimal(10, 2), altitude || null)
          .input('status', sql.Char(1), status || 'P')
          .input('direcao', sql.Decimal(5, 2), direcao || null)
          .input('tipo', sql.Char(1), tipoEnvio || 'M')
          .query(`
            INSERT INTO VIAGEMRASTREAMENTO (
              IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE,
              PRECISAO, ALTITUDE, FGSTATUS, DIRECAO, DHREGISTRO,
              TIPO, FONTE, VERSAOAPP
            ) VALUES (
              @idViagem, @cdCadastro, @latitude, @longitude, @velocidade,
              @precisao, @altitude, @status, @direcao, GETDATE(),
              @tipo, 'APP', '1.0.0'
            )
          `);
        
        console.log(`✅ [GPS] Posição salva em VIAGEMRASTREAMENTO (viagem #${idViagem})`);
      } 
      // Se NÃO tem viagem: salvar em MOTORISTARASTREAMENTO
      else {
        await pool
          .request()
          .input('cdCadastro', sql.Decimal(15, 0), cdMotorista)
          .input('latitude', sql.Decimal(10, 8), latitude)
          .input('longitude', sql.Decimal(11, 8), longitude)
          .input('velocidade', sql.Decimal(5, 2), velocidade || null)
          .input('precisao', sql.Int, precisao ? Math.round(precisao) : null)
          .input('altitude', sql.Decimal(10, 2), altitude || null)
          .input('status', sql.Char(1), status || 'P')
          .input('direcao', sql.Decimal(5, 2), direcao || null)
          .input('tipo', sql.Char(1), tipoEnvio || 'M')
          .query(`
            INSERT INTO MOTORISTARASTREAMENTO (
              CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE,
              PRECISAO, ALTITUDE, FGSTATUS, DIRECAO, DHREGISTRO,
              TIPO, FONTE, VERSAOAPP
            ) VALUES (
              @cdCadastro, @latitude, @longitude, @velocidade,
              @precisao, @altitude, @status, @direcao, GETDATE(),
              @tipo, 'APP', '1.0.0'
            )
          `);
        
        console.log(`✅ [GPS] Posição salva em MOTORISTARASTREAMENTO (sem viagem)`);
      }

      const statusTexto = status === 'P' ? 'Parado' : 'Em Movimento';
      const tipoTexto = tipoEnvio === 'M' ? 'Manual' : 'Automático';

      console.log(`✅ [GPS] ${statusTexto}, ${velocidade || 0} km/h (${tipoTexto})`);

      res.json({
        success: true,
        message: 'Posição GPS registrada com sucesso',
        dados: {
          status: statusTexto,
          velocidade: velocidade ? `${velocidade} km/h` : 'N/A',
          tipo: tipoTexto,
          viagem: idViagem || 'Sem viagem',
        },
      });
    } catch (error) {
      console.error('❌ [GPS] Erro ao registrar posição:', error);
      res.status(500).json({ error: 'Erro ao registrar posição GPS' });
    }
  },

  // ==========================================
  // EVENTO - Registrar evento (parada, etc)
  // ==========================================
  registrarEvento: async (req, res) => {
    try {
      console.log('📝 Recebido evento:', req.body);
      
      const { idviagem, idmotorista, tipo, descricao, latitude, longitude, foto } = req.body;

      if (!idviagem || !tipo || !idmotorista) {
        console.error('❌ Dados faltando:', { idviagem, tipo, idmotorista });
        return res.status(400).json({ 
          error: 'Dados obrigatórios: idviagem, tipo, idmotorista',
          recebido: req.body 
        });
      }

      console.log('✅ Dados OK:', { idviagem, idmotorista, tipo });

      const pool = await poolPromise;
      
      // TODO: Salvar foto se tiver
      // Por enquanto, salvar apenas os dados do evento
      
      const result = await pool
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

      console.log('✅ Evento salvo no banco!');
      
      res.json({ success: true, message: 'Evento registrado com sucesso!' });
    } catch (err) {
      console.error('❌ Erro ao registrar evento:', err);
      res.status(500).json({ 
        error: 'Erro ao registrar evento.',
        detalhes: err.message 
      });
    }
  }
};

module.exports = motoristaAppController;

