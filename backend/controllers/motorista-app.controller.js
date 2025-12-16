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
      let cpfLimpo = cpf.replace(/\D/g, '');

      // Validar tamanho (aceita 10 ou 11 dígitos)
      if (cpfLimpo.length < 10 || cpfLimpo.length > 11) {
        return res.status(400).json({ error: 'CPF inválido. Deve ter 10 ou 11 dígitos.' });
      }

      // Se tiver 10 dígitos, adicionar zero à esquerda
      if (cpfLimpo.length === 10) {
        cpfLimpo = '0' + cpfLimpo;
      }

      const pool = await poolPromise;

      // Buscar motorista em CADASTROGERAL + MOTORISTA_COMPLEMENTO
      // Tentar com e sem zero à esquerda (para compatibilidade)
      const cpfSemZero = cpfLimpo.startsWith('0') ? cpfLimpo.substring(1) : cpfLimpo;
      
      const result = await pool
        .request()
        .input('cpf1', sql.VarChar(14), cpfLimpo)  // Com zero à esquerda (11 dígitos)
        .input('cpf2', sql.VarChar(14), cpfSemZero) // Sem zero à esquerda (10 dígitos)
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
            mc.STATUSAPROVACAO,
            mc.SENHA
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          WHERE (cg.CGCCPF = @cpf1 OR cg.CGCCPF = @cpf2)
            AND cg.FGTIPOCADASTRO = 'M'
            AND cg.FGACTIVE = 'A'
        `);

      if (result.recordset.length === 0) {
        return res.status(401).json({ error: 'Motorista não encontrado ou inativo.' });
      }

      const motorista = result.recordset[0];

      // Validar senha
      // Se não tiver senha definida, aceitar qualquer senha (modo desenvolvimento)
      // Se tiver senha definida, validar com bcrypt
      if (motorista.SENHA) {
        // Senha está definida - validar com bcrypt
        const senhaValida = await bcrypt.compare(senha, motorista.SENHA);
        if (!senhaValida) {
          return res.status(401).json({ error: 'Senha incorreta.' });
        }
      } else {
        // Senha não definida - aceitar qualquer senha (modo desenvolvimento)
        // TODO: Remover este comportamento quando todos os motoristas tiverem senha
        console.warn(`⚠️  Motorista ${motorista.CDCADASTRO} (${motorista.CGCCPF}) não tem senha definida. Aceitando qualquer senha.`);
      }

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

      // Filtro por classes de frota do motorista - COMENTADO para trazer todas as cargas
      // if (idmotorista) {
      //   query += ` AND EXISTS (
      //     SELECT 1 FROM [dbo].[CLASSEFROTA_CG] ccf
      //     WHERE ccf.CDCADASTRO = @idmotorista
      //     AND ccf.CDCLASSEFROTA = v.CDCLASSEFROTA
      //     AND ccf.FGACTIVE = 'S'
      //   )`;
      //   params.push({ name: 'idmotorista', value: parseFloat(idmotorista), type: sql.Decimal(15, 0) });
      // }

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
        // Usar dtPosicao se fornecido, senão usar data/hora atual
        const dataPosicao = dtPosicao ? new Date(dtPosicao) : new Date();
        
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
          .input('dhPosicao', sql.DateTime, dataPosicao)
          .query(`
            INSERT INTO VIAGEMRASTREAMENTO (
              IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE,
              PRECISAO, ALTITUDE, FGSTATUS, DIRECAO, DHPOSICAO, DHREGISTRO,
              TIPO, FONTE, VERSAOAPP
            ) VALUES (
              @idViagem, @cdCadastro, @latitude, @longitude, @velocidade,
              @precisao, @altitude, @status, @direcao, @dhPosicao, GETDATE(),
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
  },

  // ==========================================
  // RASTREAMENTO - Buscar posições GPS da viagem
  // ==========================================
  buscarPosicoesViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;

      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório.' });
      }

      const pool = await poolPromise;

      // Buscar motorista da viagem (mesmo que não tenha posições GPS)
      let motoristaViagem = null;
      try {
        const motoristaResult = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1
              vm.CDMOTORISTA AS CDCADASTRO,
              cg.RZSOCIAL AS NOME_MOTORISTA,
              cg.CGCCPF AS CPF_MOTORISTA,
              cg.NRCELULAR AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] vm
            INNER JOIN [dbo].[CADASTROGERAL] cg ON vm.CDMOTORISTA = cg.CDCADASTRO
            WHERE vm.IDVIAGEM = @idviagem
            ORDER BY vm.CDMOTORISTA
          `);
        
        if (motoristaResult.recordset.length > 0) {
          motoristaViagem = motoristaResult.recordset[0];
        }
      } catch (err) {
        console.warn('Erro ao buscar motorista da viagem:', err.message);
        // Tentar com CDCADASTROGERAL se CDCADASTRO não funcionar
        try {
          const motoristaResult2 = await pool
            .request()
            .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
            .query(`
              SELECT TOP 1
                vm.CDMOTORISTA AS CDCADASTRO,
                cg.RZSOCIAL AS NOME_MOTORISTA,
                cg.CGCCPF AS CPF_MOTORISTA,
                cg.NRCELULAR AS CELULAR
              FROM [dbo].[VIAGEMMOTORISTA] vm
              INNER JOIN [dbo].[CADASTROGERAL] cg ON vm.CDMOTORISTA = cg.CDCADASTROGERAL
              WHERE vm.IDVIAGEM = @idviagem
              ORDER BY vm.CDMOTORISTA
            `);
          
          if (motoristaResult2.recordset.length > 0) {
            motoristaViagem = motoristaResult2.recordset[0];
          }
        } catch (err2) {
          console.warn('Erro ao buscar motorista (tentativa alternativa):', err2.message);
        }
      }

      // Verificar qual tabela existe: VIAGEMRASTREAMENTO (sem underscore) ou VIAGEM_RASTREAMENTO (com underscore)
      let tableName = null;
      let tableExists = false;
      
      // Tentar primeiro VIAGEMRASTREAMENTO (tabela existente no banco)
      try {
        const tableCheck1 = await pool
          .request()
          .query(`
            SELECT COUNT(*) as existe
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEMRASTREAMENTO'
          `);
        
        if (tableCheck1.recordset[0].existe > 0) {
          tableName = 'VIAGEMRASTREAMENTO';
          tableExists = true;
          console.log('✅ Usando tabela: VIAGEMRASTREAMENTO');
        }
      } catch (err) {
        console.warn('Erro ao verificar VIAGEMRASTREAMENTO:', err.message);
      }

      // Se não encontrou, tentar VIAGEM_RASTREAMENTO (com underscore)
      if (!tableExists) {
        try {
          const tableCheck2 = await pool
            .request()
            .query(`
              SELECT COUNT(*) as existe
              FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO'
            `);
          
          if (tableCheck2.recordset[0].existe > 0) {
            tableName = 'VIAGEM_RASTREAMENTO';
            tableExists = true;
            console.log('✅ Usando tabela: VIAGEM_RASTREAMENTO');
          }
        } catch (err) {
          console.warn('Erro ao verificar VIAGEM_RASTREAMENTO:', err.message);
        }
      }

      if (!tableExists) {
        console.warn('Nenhuma tabela de rastreamento encontrada. Retornando array vazio.');
        if (motoristaViagem) {
          return res.json([]);
        }
        return res.status(404).json({ error: 'Tabela de rastreamento não encontrada.' });
      }

      // Buscar data de início prevista da viagem para filtrar posições (2 horas antes)
      let dataLimite = null;
      try {
        const viagemResult = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT DTPREVINICIO
            FROM [dbo].[VIAGEMMESTRE]
            WHERE IDVIAGEM = @idviagem
          `);
        
        if (viagemResult.recordset.length > 0 && viagemResult.recordset[0].DTPREVINICIO) {
          const dataInicio = new Date(viagemResult.recordset[0].DTPREVINICIO);
          // Filtrar posições até 2 horas ANTES da data de início prevista
          // Exemplo: se início é 15/12/2025 05:00, mostrar apenas posições até 15/12/2025 03:00
          dataLimite = new Date(dataInicio.getTime() - (2 * 60 * 60 * 1000));
          console.log(`📅 Data início prevista: ${dataInicio.toISOString()}`);
          console.log(`📅 Data limite (2h antes): ${dataLimite.toISOString()}`);
          console.log(`📅 Filtrando posições com DHPOSICAO/DHREGISTRO <= ${dataLimite.toISOString()}`);
        } else {
          console.log('⚠️  Data de início prevista não encontrada. Mostrando todas as posições.');
        }
      } catch (err) {
        console.warn('⚠️  Erro ao buscar data de início prevista:', err.message);
        console.warn('⚠️  Continuando sem filtro de data - mostrando todas as posições');
        // Continuar sem filtro de data se não conseguir buscar
      }

      // Buscar posições GPS da viagem - adaptar query conforme a tabela encontrada
      let result;
      
      if (tableName === 'VIAGEMRASTREAMENTO') {
        // Tabela VIAGEMRASTREAMENTO (estrutura do banco existente)
        // Buscar motorista da viagem para fazer JOIN
        const motoristaViagemQuery = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1 CDMOTORISTA
            FROM [dbo].[VIAGEMMOTORISTA]
            WHERE IDVIAGEM = @idviagem
          `);
        
        const cdMotorista = motoristaViagemQuery.recordset.length > 0 
          ? motoristaViagemQuery.recordset[0].CDMOTORISTA 
          : null;

        const request = pool.request();
        request.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
        
        // Adicionar filtro de data limite se disponível
        if (dataLimite) {
          request.input('dataLimite', sql.DateTime, dataLimite);
        }
        
        // Usar DHPOSICAO se existir, senão usar DHREGISTRO
        // LATITUDE e LONGITUDE podem ser float ou decimal
        // Filtrar apenas posições até 2 horas antes da data de início prevista
        // IMPORTANTE: Usar DHPOSICAO (data da posição GPS) para comparação, não DHREGISTRO (data de inserção)
        const filtroData = dataLimite 
          ? `AND ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) <= @dataLimite`
          : '';
        
        if (dataLimite) {
          console.log(`🔍 Aplicando filtro: posições com DHPOSICAO/DHREGISTRO <= ${dataLimite.toISOString()}`);
          console.log(`📊 Total de posições antes do filtro será verificado após a query`);
        } else {
          console.log(`📊 Sem filtro de data - mostrando todas as posições`);
        }
        
        if (cdMotorista) {
          request.input('cdmotorista', sql.Decimal(15, 0), parseFloat(cdMotorista));
          result = await request.query(`
            SELECT 
              vr.IDVIAGEM,
              ISNULL(vr.SEQUENCIA, 0) AS SEQUENCIA,
              vr.DSPOSICAO,
              CAST(vr.LATITUDE AS DECIMAL(10,8)) AS LATITUDE,
              CAST(vr.LONGITUDE AS DECIMAL(11,8)) AS LONGITUDE,
              ISNULL(vr.VELOCIDADE, NULL) AS VELOCIDADE,
              ISNULL(vr.PRECISAO, 10) AS PRECISAO,
              ISNULL(vr.BATERIA, NULL) AS BATERIA,
              ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) AS DHREGISTRO,
              ISNULL(vr.TIPO, 'A') AS TIPO,
              ISNULL(vr.FONTE, 'RASTER') AS FONTE,
              vr.FGSTATUS,
              @cdmotorista AS CDCADASTRO,
              cg.RZSOCIAL AS NOME_MOTORISTA,
              cg.CGCCPF AS CPF_MOTORISTA
            FROM [dbo].[VIAGEMRASTREAMENTO] vr
            LEFT JOIN [dbo].[CADASTROGERAL] cg ON cg.CDCADASTRO = @cdmotorista
            WHERE vr.IDVIAGEM = @idviagem
              ${filtroData}
            ORDER BY ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) ASC
          `);
          
          console.log(`📊 Query VIAGEMRASTREAMENTO executada. Filtro: ${filtroData || 'NENHUM'}. Registros encontrados: ${result.recordset.length}`);
          if (result.recordset.length === 0 && dataLimite) {
            console.warn(`⚠️  Nenhuma posição encontrada com filtro. Verificando total sem filtro...`);
            // Testar sem filtro para debug
            const testRequest = pool.request();
            testRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
            const testResult = await testRequest.query(`
              SELECT COUNT(*) as total 
              FROM [dbo].[VIAGEMRASTREAMENTO] 
              WHERE IDVIAGEM = @idviagem
            `);
            const totalSemFiltro = testResult.recordset[0].total;
            console.log(`📊 Total de posições na tabela (sem filtro): ${totalSemFiltro}`);
            if (totalSemFiltro > 0) {
              // Verificar algumas posições para ver as datas
              const sampleRequest = pool.request();
              sampleRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
              const sampleResult = await sampleRequest.query(`
                SELECT TOP 5 
                  ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) AS DATA_POSICAO,
                  vr.SEQUENCIA
                FROM [dbo].[VIAGEMRASTREAMENTO] vr
                WHERE vr.IDVIAGEM = @idviagem
                ORDER BY ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) DESC
              `);
              console.log(`📅 Últimas 5 posições (mais recentes):`, sampleResult.recordset);
              console.log(`📅 Data limite do filtro: ${dataLimite.toISOString()}`);
            }
          }
        } else {
          result = await request.query(`
            SELECT 
              vr.IDVIAGEM,
              ISNULL(vr.SEQUENCIA, 0) AS SEQUENCIA,
              vr.DSPOSICAO,
              CAST(vr.LATITUDE AS DECIMAL(10,8)) AS LATITUDE,
              CAST(vr.LONGITUDE AS DECIMAL(11,8)) AS LONGITUDE,
              ISNULL(vr.VELOCIDADE, NULL) AS VELOCIDADE,
              ISNULL(vr.PRECISAO, 10) AS PRECISAO,
              ISNULL(vr.BATERIA, NULL) AS BATERIA,
              ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) AS DHREGISTRO,
              ISNULL(vr.TIPO, 'A') AS TIPO,
              ISNULL(vr.FONTE, 'RASTER') AS FONTE,
              vr.FGSTATUS,
              ISNULL(vr.CDCADASTRO, NULL) AS CDCADASTRO,
              NULL AS NOME_MOTORISTA,
              NULL AS CPF_MOTORISTA
            FROM [dbo].[VIAGEMRASTREAMENTO] vr
            WHERE vr.IDVIAGEM = @idviagem
              ${filtroData}
            ORDER BY ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) ASC
          `);
          
          console.log(`📊 Query executada para VIAGEMRASTREAMENTO (sem motorista). Filtro: ${filtroData || 'NENHUM'}. Registros encontrados: ${result.recordset.length}`);
          if (result.recordset.length === 0 && dataLimite) {
            console.warn(`⚠️  Nenhuma posição encontrada com filtro. Verificando total sem filtro...`);
            const testRequest2 = pool.request();
            testRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
            const testResult2 = await testRequest2.query(`
              SELECT COUNT(*) as total 
              FROM [dbo].[VIAGEMRASTREAMENTO] 
              WHERE IDVIAGEM = @idviagem
            `);
            const totalSemFiltro2 = testResult2.recordset[0].total;
            console.log(`📊 Total de posições na tabela (sem filtro): ${totalSemFiltro2}`);
            if (totalSemFiltro2 > 0) {
              const sampleRequest2 = pool.request();
              sampleRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
              const sampleResult2 = await sampleRequest2.query(`
                SELECT TOP 5 
                  ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) AS DATA_POSICAO,
                  vr.SEQUENCIA
                FROM [dbo].[VIAGEMRASTREAMENTO] vr
                WHERE vr.IDVIAGEM = @idviagem
                ORDER BY ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) DESC
              `);
              console.log(`📅 Últimas 5 posições (mais recentes):`, sampleResult2.recordset);
              console.log(`📅 Data limite do filtro: ${dataLimite.toISOString()}`);
            }
          }
          console.log(`📊 Total de registros encontrados: ${result.recordset.length}`);
        }
      } else {
        // Tabela VIAGEM_RASTREAMENTO (estrutura nova)
        try {
          const request2 = pool.request();
          request2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          
          // Adicionar filtro de data limite se disponível
          if (dataLimite) {
            request2.input('dataLimite', sql.DateTime, dataLimite);
          }
          
          // Filtrar apenas posições até 2 horas antes da data de início prevista
          const filtroData2 = dataLimite 
            ? `AND vr.DHREGISTRO <= @dataLimite`
            : '';
          
          result = await request2.query(`
              SELECT 
                vr.IDRASTREAMENTO,
                vr.IDVIAGEM,
                vr.CDCADASTRO,
                vr.LATITUDE,
                vr.LONGITUDE,
                vr.VELOCIDADE,
                vr.PRECISAO,
                ISNULL(vr.BATERIA, NULL) AS BATERIA,
                vr.DHREGISTRO,
                ISNULL(vr.TIPO, 'A') AS TIPO,
                ISNULL(vr.FONTE, 'APP') AS FONTE,
                cg.RZSOCIAL AS NOME_MOTORISTA,
                cg.CGCCPF AS CPF_MOTORISTA
              FROM [dbo].[VIAGEM_RASTREAMENTO] vr
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON vr.CDCADASTRO = cg.CDCADASTRO
              WHERE vr.IDVIAGEM = @idviagem
                ${filtroData2}
              ORDER BY vr.DHREGISTRO ASC
            `);
        } catch (err) {
          console.warn('Tentando com estrutura alternativa...', err.message);
          const request3 = pool.request();
          request3.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          
          // Adicionar filtro de data limite se disponível
          if (dataLimite) {
            request3.input('dataLimite', sql.DateTime, dataLimite);
          }
          
          // Filtrar apenas posições até 2 horas antes da data de início prevista
          const filtroData3 = dataLimite 
            ? `AND vr.DHREGISTRO <= @dataLimite`
            : '';
          
          result = await request3.query(`
              SELECT 
                vr.IDRASTREAMENTO,
                vr.IDVIAGEM,
                ISNULL(vr.CDCADASTRO, vr.CDMOTORISTA) AS CDCADASTRO,
                vr.LATITUDE,
                vr.LONGITUDE,
                vr.VELOCIDADE,
                vr.PRECISAO,
                NULL AS BATERIA,
                vr.DHREGISTRO,
                ISNULL(vr.TIPO, 'A') AS TIPO,
                'APP' AS FONTE,
                cg.RZSOCIAL AS NOME_MOTORISTA,
                cg.CGCCPF AS CPF_MOTORISTA
              FROM [dbo].[VIAGEM_RASTREAMENTO] vr
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON (vr.CDCADASTRO = cg.CDCADASTRO OR vr.CDMOTORISTA = cg.CDCADASTRO)
              WHERE vr.IDVIAGEM = @idviagem
                ${filtroData3}
              ORDER BY vr.DHREGISTRO ASC
            `);
        }
      }

      // Adicionar informações do motorista nas posições (se não vier do JOIN)
      const posicoes = result.recordset.map(pos => {
        if (!pos.NOME_MOTORISTA && motoristaViagem) {
          pos.NOME_MOTORISTA = motoristaViagem.NOME_MOTORISTA;
          pos.CPF_MOTORISTA = motoristaViagem.CPF_MOTORISTA;
        }
        return pos;
      });

      // Buscar a última posição geral (sem filtro de data) para exibir na "Última Atualização"
      let ultimaPosicaoGeral = null;
      try {
        if (tableName === 'VIAGEMRASTREAMENTO') {
          const ultimaPosicaoRequest = pool.request();
          ultimaPosicaoRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const ultimaPosicaoResult = await ultimaPosicaoRequest.query(`
            SELECT TOP 1
              FORMAT(ISNULL(vr.DHPOSICAO, vr.DHREGISTRO), 'yyyy-MM-ddTHH:mm:ss') AS DHREGISTRO
            FROM [dbo].[VIAGEMRASTREAMENTO] vr
            WHERE vr.IDVIAGEM = @idviagem
            ORDER BY ISNULL(vr.DHPOSICAO, vr.DHREGISTRO) DESC
          `);
          if (ultimaPosicaoResult.recordset.length > 0) {
            // A data já vem formatada como string no horário local do servidor SQL
            ultimaPosicaoGeral = {
              DHREGISTRO: ultimaPosicaoResult.recordset[0].DHREGISTRO
            };
          }
        } else if (tableName === 'VIAGEM_RASTREAMENTO') {
          const ultimaPosicaoRequest2 = pool.request();
          ultimaPosicaoRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const ultimaPosicaoResult2 = await ultimaPosicaoRequest2.query(`
            SELECT TOP 1
              FORMAT(vr.DHREGISTRO, 'yyyy-MM-ddTHH:mm:ss') AS DHREGISTRO
            FROM [dbo].[VIAGEM_RASTREAMENTO] vr
            WHERE vr.IDVIAGEM = @idviagem
            ORDER BY vr.DHREGISTRO DESC
          `);
          if (ultimaPosicaoResult2.recordset.length > 0) {
            // A data já vem formatada como string no horário local do servidor SQL
            ultimaPosicaoGeral = {
              DHREGISTRO: ultimaPosicaoResult2.recordset[0].DHREGISTRO
            };
          }
        }
      } catch (err) {
        console.warn('⚠️  Erro ao buscar última posição geral:', err.message);
        // Continuar sem a última posição geral
      }

      // Sempre retornar array, mesmo se vazio
      console.log(`✅ Retornando ${posicoes.length} posições para viagem ${idviagem}`);
      if (posicoes.length === 0 && dataLimite) {
        console.warn(`⚠️  Nenhuma posição encontrada. Verifique se o filtro de data (até ${dataLimite.toISOString()}) não está muito restritivo.`);
      }
      
      // Retornar objeto com posições filtradas e última posição geral
      res.json({
        posicoes: posicoes,
        ultimaPosicaoGeral: ultimaPosicaoGeral
      });
    } catch (err) {
      console.error('❌ Erro ao buscar posições da viagem:', err);
      console.error('Detalhes do erro:', {
        message: err.message,
        code: err.code,
        number: err.number,
        originalError: err.originalError,
        stack: err.stack
      });
      
      // Retornar array vazio em caso de erro, para não quebrar o frontend
      // O frontend já trata array vazio mostrando mensagem apropriada
      console.warn('⚠️ Retornando array vazio devido ao erro');
      res.json([]);
    }
  },

  // ==========================================
  // RASTREAMENTO - Buscar motorista da viagem
  // ==========================================
  buscarMotoristaViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;

      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório.' });
      }

      const pool = await poolPromise;

      let result;
      try {
        result = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1
              vm.CDMOTORISTA AS CDCADASTRO,
              cg.CDCADASTRO,
              cg.RZSOCIAL AS NOME_MOTORISTA,
              cg.CGCCPF AS CPF_MOTORISTA,
              cg.NRCELULAR AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] vm
            INNER JOIN [dbo].[CADASTROGERAL] cg ON vm.CDMOTORISTA = cg.CDCADASTRO
            WHERE vm.IDVIAGEM = @idviagem
            ORDER BY vm.CDMOTORISTA
          `);
      } catch (err) {
        // Tentar com CDCADASTROGERAL se CDCADASTRO não funcionar
        console.warn('Tentando busca alternativa do motorista...', err.message);
        result = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1
              vm.CDMOTORISTA AS CDCADASTRO,
              cg.CDCADASTROGERAL AS CDCADASTRO,
              cg.RZSOCIAL AS NOME_MOTORISTA,
              cg.CGCCPF AS CPF_MOTORISTA,
              cg.NRCELULAR AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] vm
            INNER JOIN [dbo].[CADASTROGERAL] cg ON vm.CDMOTORISTA = cg.CDCADASTROGERAL
            WHERE vm.IDVIAGEM = @idviagem
            ORDER BY vm.CDMOTORISTA
          `);
      }

      if (result.recordset.length > 0) {
        res.json(result.recordset[0]);
      } else {
        res.json(null);
      }
    } catch (err) {
      console.error('Erro ao buscar motorista da viagem:', err);
      res.status(500).json({ error: 'Erro ao buscar motorista da viagem.' });
    }
  }
};

module.exports = motoristaAppController;

