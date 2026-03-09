// backend/controllers/motorista-app.controller.js
// Controller para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2026
// IMPORTANTE: Integrado com sistema existente (CADASTROGERAL, VIAGEMMESTRE, CONVOCACAO)

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const jwt = require('jsonwebtoken');
const { getContexto } = require('../services/contexto.service');
const { validarDocumento, normalizarDocumento } = require('../services/documento.service');

// Normaliza objeto para ter chaves em maiúsculas (PostgreSQL retorna minúsculas; frontend espera ROTEIRO, DTCARREGAMENTO, etc.)
function normalizarChavesViagem(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  const alias = [
    'roteiro', 'dtcarregamento', 'dtdescarga', 'dtprevincio', 'dtprevfinal',
    'idviagem', 'situacao', 'tipo', 'classe', 'contratador', 'celular_contratador',
    'frete', 'peso', 'cubagem', 'origem_cidade', 'origem_estado', 'destino_cidade', 'destino_estado',
    'dsroteiro', 'idroteiro', 'dssituacaoviagem', 'dstipoviagem', 'dsclassefrota'
  ];
  alias.forEach(k => {
    if (out[k] !== undefined && out[k.toUpperCase()] === undefined) out[k.toUpperCase()] = out[k];
  });
  return out;
}
const bcrypt = require('bcrypt');
const axios = require('axios');
const { getReverseGeocodingUrl } = require('../config/nominatim');

// Códigos de recuperação de senha (em memória, válidos 15 min). Em produção: enviar por SMS/email e usar Redis.
const codigosRecuperacao = new Map();

// Função auxiliar para fazer reverse geocoding
async function obterEnderecoPorCoordenadas(latitude, longitude) {
  try {
    console.log(`📍 [GEOCODING] Buscando endereço para: ${latitude}, ${longitude}`);
    const url = getReverseGeocodingUrl(latitude, longitude);
    console.log(`📍 [GEOCODING] URL: ${url}`);
    const response = await axios.get(url, {
      timeout: 5000,
      headers: {
        'User-Agent': 'AtlasCargo-App/2.0'
      }
    });

    if (response.data && response.data.address) {
      const addr = response.data.address;
      
      // Montar endereço formatado
      const partes = [];
      
      if (addr.road || addr.street) {
        partes.push(addr.road || addr.street);
      }
      if (addr.house_number) {
        partes[0] = `${addr.house_number}, ${partes[0] || ''}`.trim();
      }
      if (addr.neighbourhood || addr.suburb) {
        partes.push(addr.neighbourhood || addr.suburb);
      }
      if (addr.city || addr.town || addr.village) {
        partes.push(addr.city || addr.town || addr.village);
      }
      if (addr.state) {
        partes.push(addr.state);
      }
      
      const endereco = partes.length > 0 
        ? partes.join(', ')
        : response.data.display_name || `${latitude}, ${longitude}`;
      
      console.log(`✅ [GEOCODING] Endereço encontrado: ${endereco}`);
      return endereco;
    }
    
    return `${latitude}, ${longitude}`;
  } catch (err) {
    console.warn('⚠️ Erro ao fazer reverse geocoding:', err.message);
    // Em caso de erro, retornar coordenadas
    return `${latitude}, ${longitude}`;
  }
}

const motoristaAppController = {
  // ==========================================
  // AUTH - Login do Motorista
  // ==========================================
  login: async (req, res) => {
    try {
      const { cpf, senha } = req.body;
      const documento = cpf; // campo pode vir como "cpf" no body; tratamos como documento (Fase 1 multimoeda)

      console.log('🔐 [LOGIN] Tentativa de login recebida');
      console.log('📝 [LOGIN] Documento recebido:', documento ? String(documento).replace(/\d(?=\d{4})/g, '*') : 'NULL');

      if (!documento || !senha) {
        console.log('❌ [LOGIN] Documento ou senha não fornecidos');
        return res.status(400).json({ error: 'Documento e senha são obrigatórios.', errorKey: 'login.senhaObrigatoria' });
      }

      const ctx = await getContexto();
      const pais = (ctx && ctx.pais) ? ctx.pais : 'BR';

      const validacao = validarDocumento(pais, 'F', documento);
      if (!validacao.valido) {
        console.log('❌ [LOGIN] Documento inválido:', validacao.mensagem);
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'login.documentoInvalido' });
      }

      let docNormalizado = normalizarDocumento(pais, documento);
      if (pais === 'BR' && docNormalizado.length === 10) {
        docNormalizado = '0' + docNormalizado;
      }
      const docAlternativo = (pais === 'BR' && docNormalizado.length === 11 && docNormalizado.startsWith('0'))
        ? docNormalizado.substring(1)
        : docNormalizado;

      const pool = await poolPromise;

      console.log('🔍 [LOGIN] Buscando motorista com documento:', docNormalizado, docAlternativo !== docNormalizado ? 'ou ' + docAlternativo : '');
      
      let result;
      try {
        result = await pool
          .request()
          .input('doc1', sql.VarChar(14), docNormalizado)
          .input('doc2', sql.VarChar(14), docAlternativo)
          .query(`
          SELECT 
            cg.[CDCADASTRO],
            cg.[CGCCPF],
            cg.[RZSOCIAL],
            cg.[NRCELULAR],
            cg.[ENDEMAIL],
            cg.[FGACTIVE],
            cg.[FGTIPOCADASTRO],
            mc.[NRCNH],
            mc.[CATEGORIACNH],
            mc.[VALIDADECNH],
            mc.[STATUSAPROVACAO],
            mc.[SENHA]
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.[CDCADASTRO] = mc.[CDCADASTRO]
          WHERE (cg.[CGCCPF] = @doc1 OR cg.[CGCCPF] = @doc2)
            AND (cg.[FGMOTORISTA] = 'S' OR (cg.[FGMOTORISTA] IS NULL AND cg.[FGTIPOCADASTRO] = 'M'))
            AND (cg.[FGACTIVE] = 'S' OR cg.[FGACTIVE] = 'A')
        `);
      } catch (err) {
        if (err.code === '42P01') {
          console.warn('❌ [LOGIN] Tabela de cadastro não existe no banco (cadastrogeral/motorista_complemento). Configure o banco para o app motorista.');
          return res.status(503).json({ error: 'Sistema em configuração. Cadastro de motoristas ainda não disponível.', errorKey: 'login.sistemaConfiguracao' });
        }
        throw err;
      }

      console.log('📊 [LOGIN] Resultado da busca:', result.recordset.length, 'registro(s) encontrado(s)');

      if (result.recordset.length === 0) {
        console.log('❌ [LOGIN] Motorista não encontrado ou não atende aos critérios');
        console.log('   - Documento procurado:', docNormalizado, docAlternativo !== docNormalizado ? 'ou ' + docAlternativo : '');
        console.log('   - Critérios: FGTIPOCADASTRO = M, FGACTIVE = A');
        return res.status(401).json({ error: 'Motorista não encontrado ou inativo.', errorKey: 'login.motoristaNaoEncontrado' });
      }

      const motorista = result.recordset[0];
      
      console.log('✅ [LOGIN] Motorista encontrado:', motorista.CDCADASTRO, '-', motorista.RZSOCIAL);
      console.log('📋 [LOGIN] Status:', {
        FGACTIVE: motorista.FGACTIVE,
        FGTIPOCADASTRO: motorista.FGTIPOCADASTRO,
        STATUSAPROVACAO: motorista.STATUSAPROVACAO,
        TEM_SENHA: motorista.SENHA ? 'SIM' : 'NÃO'
      });

      // Validar senha
      // Se não tiver senha definida, aceitar qualquer senha (modo desenvolvimento)
      // Se tiver senha definida, validar com bcrypt
      if (motorista.SENHA) {
        console.log('🔐 [LOGIN] Validando senha com bcrypt...');
        // Senha está definida - validar com bcrypt
        const senhaValida = await bcrypt.compare(senha, motorista.SENHA);
        if (!senhaValida) {
          console.log('❌ [LOGIN] Senha incorreta');
          return res.status(401).json({ error: 'Senha incorreta.', errorKey: 'login.senhaIncorreta' });
        }
        console.log('✅ [LOGIN] Senha válida');
      } else {
        // Senha não definida - aceitar qualquer senha (modo desenvolvimento)
        // TODO: Remover este comportamento quando todos os motoristas tiverem senha
        console.warn(`⚠️  [LOGIN] Motorista ${motorista.CDCADASTRO} (${motorista.CGCCPF}) não tem senha definida. Aceitando qualquer senha.`);
      }

      // Verificar aprovação
      if (motorista.STATUSAPROVACAO === 'R') {
        console.log('❌ [LOGIN] Cadastro rejeitado');
        return res.status(403).json({ error: 'Cadastro rejeitado. Entre em contato com a empresa.', errorKey: 'login.cadastroRejeitado' });
      }

      if (motorista.STATUSAPROVACAO === 'P') {
        console.log('⏳ [LOGIN] Cadastro pendente de aprovação');
        return res.status(403).json({ error: 'Cadastro pendente de aprovação.', errorKey: 'login.cadastroPendente' });
      }
      
      console.log('✅ [LOGIN] Aprovação OK');

      // Verificar se JWT_SECRET está configurado
      if (!process.env.JWT_SECRET) {
        console.error('❌ [LOGIN] JWT_SECRET não configurado no .env');
        return res.status(500).json({ error: 'Erro de configuração do servidor.', errorKey: 'login.erroConfigServidor' });
      }

      // Gerar token JWT
      console.log('🎫 [LOGIN] Gerando token JWT...');
      const token = jwt.sign(
        {
          id: motorista.CDCADASTRO,
          cpf: motorista.CGCCPF,
          tipo: 'motorista'
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      console.log('✅ [LOGIN] Login realizado com sucesso!');
      console.log('👤 [LOGIN] Motorista:', motorista.CDCADASTRO, '-', motorista.RZSOCIAL);

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
      console.error('❌ [LOGIN] Erro no login do motorista:', err);
      console.error('📋 [LOGIN] Stack:', err.stack);
      res.status(500).json({ error: 'Erro ao fazer login.', errorKey: 'login.erroLogin' });
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
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Motorista não encontrado.', errorKey: 'commonErrors.motoristaNaoEncontrado' });
      }

      res.json(result.recordset[0]);
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
      res.status(500).json({ error: 'Erro ao buscar perfil.', errorKey: 'commonErrors.erroBuscarPerfil' });
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
      res.status(500).json({ error: 'Erro ao cadastrar.', errorKey: 'cadastroErrors.erroCadastrar' });
    }
  },

  // ==========================================
  // CONVOCAÇÕES - Listar convocações do motorista
  // ==========================================
  minhasConvocacoes: async (req, res) => {
    try {
      const { idmotorista } = req.params;

      const pool = await poolPromise;
      let query = `
        SELECT 
          c.[IDCONVOCACAO],
          c.[IDVIAGEM],
          c.[STATUS],
          c.[DHCONVOCACAO],
          c.[DHRESPOSTA],
          c.[DHACESSO],
          c.[TXTCONVOCACAO],
          c.[NRCELULAR],
          c.[LATITUDE],
          c.[LONGITUDE],
          v.[DTPREVINICIO],
          v.[DTPREVFINAL],
          v.[VLFRETE],
          COALESCE(v.[MOEDA], 'BRL') AS [MOEDA],
          v.[PESO],
          v.[CUBAGEM],
          v.[DISTANCIAKM],
          v.[OBSERV],
          v.[CDSITUACAOVIAGEM],
          sv.[DSSITUACAOVIAGEM],
          v.[CDTIPOVIAGEM],
          tv.[DSTIPOVIAGEM],
          v.[CDCLASSEFROTA],
          cf.[DSCLASSEFROTA],
          r.[DSROTEIRO],
          co.[NMCIDADE] AS ORIGEM_CIDADE,
          co.[ESTADO] AS ORIGEM_ESTADO,
          cd.[NMCIDADE] AS DESTINO_CIDADE,
          cd.[ESTADO] AS DESTINO_ESTADO,
          cont.[RZSOCIAL] AS CONTRATADOR
        FROM [dbo].[CONVOCACAO] c
        INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.[CDSITUACAOVIAGEM] = sv.[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
        LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.[CDCONTRATADOR] = cont.[CDCADASTRO]
        WHERE c.[CDCADASTRO_MOTORISTA] = @idmotorista
        ORDER BY 
          CASE 
            WHEN c.[STATUS] = 'PENDENTE' THEN 1
            WHEN c.[STATUS] = 'ACEITA' THEN 2
            WHEN c.[STATUS] = 'CONFIRMADA' THEN 3
            ELSE 4
          END,
          c.[DHCONVOCACAO] DESC
      `;

      const result = await pool
        .request()
        .input('idmotorista', sql.Decimal(15, 0), parseFloat(idmotorista))
        .query(query);

      const recordset = (result.recordset || []).map((row) => {
        const r = { ...row };
        const toUpper = {
          origem_cidade: 'ORIGEM_CIDADE', origem_estado: 'ORIGEM_ESTADO',
          destino_cidade: 'DESTINO_CIDADE', destino_estado: 'DESTINO_ESTADO',
          dsroteiro: 'DSROTEIRO'
        };
        Object.keys(toUpper).forEach((k) => {
          if (r[k] !== undefined && r[toUpper[k]] === undefined) r[toUpper[k]] = r[k];
        });
        return r;
      });
      res.json(recordset);
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
            [STATUS] = 'ACEITA',
            [DHRESPOSTA] = CURRENT_TIMESTAMP,
            [LATITUDE] = COALESCE(@latitude, [LATITUDE]),
            [LONGITUDE] = COALESCE(@longitude, [LONGITUDE])
          WHERE [IDCONVOCACAO] = @id
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
            [STATUS] = 'RECUSADA',
            [DHRESPOSTA] = CURRENT_TIMESTAMP,
            [CDMOTIVORECUSA] = @motivo
          WHERE [IDCONVOCACAO] = @id
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
  // ==========================================
  // CARGAS DISPONÍVEIS - Listar viagens abertas para o motorista aceitar
  // Regra: FGSITVIAGEM IN ('D','P') = Preparação ou Programada; FGACTIVE = 'S';
  //        sem convocação CONFIRMADA ou ACEITA (viagem ainda disponível).
  // ==========================================
  cargasDisponiveis: async (req, res) => {
    try {
      const { estado, distanciaMax, freteMin, idmotorista } = req.query;

      const pool = await poolPromise;
      let query = `
        SELECT 
          v.[IDVIAGEM],
          v.[DTPREVINICIO],
          v.[DTPREVFINAL],
          v.[VLFRETE],
          COALESCE(v.[MOEDA], 'BRL') AS [MOEDA],
          v.[PESO],
          v.[CUBAGEM],
          v.[DISTANCIAKM],
          v.[OBSERV],
          v.[FGRASTREADO],
          v.[CDSITUACAOVIAGEM],
          sv.[DSSITUACAOVIAGEM],
          v.[CDTIPOVIAGEM],
          tv.[DSTIPOVIAGEM],
          v.[CDCLASSEFROTA],
          cf.[DSCLASSEFROTA],
          r.[DSROTEIRO],
          co.[NMCIDADE] AS ORIGEM_CIDADE,
          co.[ESTADO] AS ORIGEM_ESTADO,
          cd.[NMCIDADE] AS DESTINO_CIDADE,
          cd.[ESTADO] AS DESTINO_ESTADO,
          cont.[RZSOCIAL] AS CONTRATADOR,
          cont.[NRCELULAR] AS CONTRATADOR_CELULAR,
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] WHERE [IDVIAGEM] = v.[IDVIAGEM]) AS TOTAL_CONVOCACOES
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.[CDSITUACAOVIAGEM] = sv.[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
        LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.[CDCONTRATADOR] = cont.[CDCADASTRO]
        WHERE v.[FGSITVIAGEM] IN ('D', 'P')
          AND v.[FGACTIVE] = 'S'
          AND NOT EXISTS (
            SELECT 1 FROM [dbo].[CONVOCACAO] 
            WHERE [IDVIAGEM] = v.[IDVIAGEM] 
            AND [STATUS] IN ('CONFIRMADA', 'ACEITA')
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
        query += ` AND (co.[ESTADO] = @estado OR cd.[ESTADO] = @estado)`;
        params.push({ name: 'estado', value: estado });
      }

      if (distanciaMax) {
        query += ` AND v.[DISTANCIAKM] <= @distanciaMax`;
        params.push({ name: 'distanciaMax', value: parseFloat(distanciaMax) });
      }

      if (freteMin) {
        query += ` AND v.[VLFRETE] >= @freteMin`;
        params.push({ name: 'freteMin', value: parseFloat(freteMin) });
      }

      query += ` ORDER BY v.[DHINCLUSAO] DESC`;

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

      // Validar e converter cdMotorista
      if (!cdMotorista) {
        console.error('❌ [VIAGENS] ID do motorista não fornecido');
        return res.status(400).json({ error: 'ID do motorista é obrigatório' });
      }

      const cdMotoristaNum = parseFloat(cdMotorista);
      if (isNaN(cdMotoristaNum) || cdMotoristaNum <= 0) {
        console.error('❌ [VIAGENS] ID do motorista inválido:', cdMotorista);
        return res.status(400).json({ error: 'ID do motorista inválido' });
      }

      console.log(`🔍 [VIAGENS] ID convertido: ${cdMotoristaNum} (tipo: ${typeof cdMotoristaNum})`);

      const pool = await poolPromise;
      
      if (!pool) {
        console.error('❌ [VIAGENS] Pool de conexão não disponível');
        return res.status(500).json({ error: 'Erro de conexão com o banco de dados' });
      }

      const request = pool.request();
      request.input('cdMotorista', sql.Decimal(15, 0), cdMotoristaNum);

      const result = await request.query(`
        SELECT 
          [V].[IDVIAGEM],
          [R].[DSROTEIRO] AS ROTEIRO,
          [V].[DTPREVINICIO] AS DTCARREGAMENTO,
          [V].[DTPREVFINAL] AS DTDESCARGA,
          [S].[DSSITUACAOVIAGEM] AS SITUACAO,
          [T].[DSTIPOVIAGEM] AS TIPO,
          [F].[DSCLASSEFROTA] AS CLASSE,
          [P].[RZSOCIAL] AS CONTRATADOR,
          [P].[NRCELULAR] AS CELULAR_CONTRATADOR,
          [V].[VLFRETE] AS FRETE,
          COALESCE([V].[MOEDA], 'BRL') AS [MOEDA],
          [V].[PESO],
          [V].[CUBAGEM],
          [CO_ORIGEM].[NMCIDADE] AS ORIGEM_CIDADE,
          [CO_ORIGEM].[ESTADO] AS ORIGEM_ESTADO,
          0 AS ORIGEM_LATITUDE,
          0 AS ORIGEM_LONGITUDE,
          [CD_DESTINO].[NMCIDADE] AS DESTINO_CIDADE,
          [CD_DESTINO].[ESTADO] AS DESTINO_ESTADO,
          0 AS DESTINO_LATITUDE,
          0 AS DESTINO_LONGITUDE
        FROM [dbo].[VIAGEMMESTRE] [V]
        INNER JOIN [dbo].[VIAGEMMOTORISTA] [M] ON [V].[IDVIAGEM] = [M].[IDVIAGEM]
        INNER JOIN [dbo].[CADASTROGERAL] [C] ON [M].[CDMOTORISTA] = [C].[CDCADASTRO]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [S] ON [V].[CDSITUACAOVIAGEM] = [S].[CDSITUACAOVIAGEM]
        LEFT JOIN [dbo].[TIPOVIAGEM] [T] ON [V].[CDTIPOVIAGEM] = [T].[CDTIPOVIAGEM]
        LEFT JOIN [dbo].[CLASSEFROTA] [F] ON [V].[CDCLASSEFROTA] = [F].[CDCLASSEFROTA]
        LEFT JOIN [dbo].[ROTEIRO] [R] ON [V].[IDROTEIRO] = [R].[IDROTEIRO]
        LEFT JOIN [dbo].[CADASTROGERAL] [P] ON [V].[CDCONTRATADOR] = [P].[CDCADASTRO]
        LEFT JOIN [dbo].[CIDADE] [CO_ORIGEM] ON [R].[CDCIDADEORIGEM] = [CO_ORIGEM].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [CD_DESTINO] ON [R].[CDCIDADEDESTINO] = [CD_DESTINO].[CDCIDADE]
        WHERE [V].[FGSITVIAGEM] NOT IN ('C', 'F', 'E')
          AND [M].[CDMOTORISTA] = @cdMotorista
        ORDER BY [V].[DTPREVINICIO]
      `);

      console.log(`✅ [VIAGENS] ${result.recordset.length} viagem(ns) encontrada(s) para motorista ${cdMotoristaNum}`);

      const viagens = (result.recordset || []).map(normalizarChavesViagem);
      res.json(viagens);
    } catch (error) {
      console.error('❌ [VIAGENS] Erro ao buscar viagens:', error);
      console.error('❌ [VIAGENS] Mensagem:', error.message);
      console.error('❌ [VIAGENS] Stack:', error.stack);
      console.error('❌ [VIAGENS] Parâmetros recebidos:', req.params);
      console.error('❌ [VIAGENS] Tipo do erro:', error.constructor.name);
      
      // Verificar se é erro de SQL
      if (error.originalError) {
        console.error('❌ [VIAGENS] Erro SQL original:', error.originalError.message);
      }

      res.status(500).json({ 
        error: 'Erro ao buscar viagens',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? {
          stack: error.stack,
          originalError: error.originalError?.message
        } : undefined
      });
    }
  },

  // ==========================================
  // VIAGENS - Detalhes de uma viagem específica
  // ==========================================
  detalhesViagem: async (req, res) => {
    try {
      const { idViagem } = req.params;

      console.log(`🚛 [VIAGEM] Buscando detalhes da viagem ${idViagem}`);

      if (!idViagem || isNaN(idViagem)) {
        console.error('❌ [VIAGEM] ID inválido:', idViagem);
        return res.status(400).json({ error: 'ID da viagem inválido' });
      }

      const pool = await poolPromise;

      const result = await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .query(`
          SELECT 
            V.[IDVIAGEM],
            V.[FGSITVIAGEM],
            V.[CDSITUACAOVIAGEM],
            V.[CDTIPOVIAGEM],
            V.[CDCONTRATADOR],
            V.[CDCLASSEFROTA],
            V.[DTPREVINICIO],
            V.[DTPREVFINAL],
            V.[DISTANCIAKM],
            V.[VLFRETE],
            COALESCE(V.[MOEDA], 'BRL') AS [MOEDA],
            V.[PESO],
            V.[CUBAGEM],
            V.[OBSERV],
            V.[FGACTIVE],
            R.[DSROTEIRO],
            R.[IDROTEIRO],
            S.[DSSITUACAOVIAGEM],
            T.[DSTIPOVIAGEM],
            F.[DSCLASSEFROTA],
            P.[RZSOCIAL] AS CONTRATADOR,
            P.[NRCELULAR] AS TELEFONE_CONTRATADOR,
            M.[RZSOCIAL] AS MOTORISTA,
            CO_ORIGEM.[NMCIDADE] AS ORIGEM_CIDADE,
            CO_ORIGEM.[ESTADO] AS ORIGEM_ESTADO,
            0 AS ORIGEM_LATITUDE,
            0 AS ORIGEM_LONGITUDE,
            CD_DESTINO.[NMCIDADE] AS DESTINO_CIDADE,
            CD_DESTINO.[ESTADO] AS DESTINO_ESTADO,
            0 AS DESTINO_LATITUDE,
            0 AS DESTINO_LONGITUDE
          FROM [dbo].[VIAGEMMESTRE] V
          LEFT JOIN [dbo].[ROTEIRO] R ON V.[IDROTEIRO] = R.[IDROTEIRO]
          LEFT JOIN [dbo].[CIDADE] CO_ORIGEM ON R.[CDCIDADEORIGEM] = CO_ORIGEM.[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] CD_DESTINO ON R.[CDCIDADEDESTINO] = CD_DESTINO.[CDCIDADE]
          LEFT JOIN [dbo].[SITUACAOVIAGEM] S ON V.[CDSITUACAOVIAGEM] = S.[CDSITUACAOVIAGEM]
          LEFT JOIN [dbo].[TIPOVIAGEM] T ON V.[CDTIPOVIAGEM] = T.[CDTIPOVIAGEM]
          LEFT JOIN [dbo].[CLASSEFROTA] F ON V.[CDCLASSEFROTA] = F.[CDCLASSEFROTA]
          LEFT JOIN [dbo].[CADASTROGERAL] P ON V.[CDCONTRATADOR] = P.[CDCADASTRO]
          LEFT JOIN [dbo].[VIAGEMMOTORISTA] VM ON V.[IDVIAGEM] = VM.[IDVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] M ON VM.[CDMOTORISTA] = M.[CDCADASTRO]
          WHERE V.[IDVIAGEM] = @idViagem
        `);

      if (result.recordset.length === 0) {
        console.warn(`⚠️ [VIAGEM] Viagem ${idViagem} não encontrada`);
        return res.status(404).json({ error: 'Viagem não encontrada' });
      }

      console.log(`✅ [VIAGEM] Detalhes encontrados para viagem ${idViagem}`);

      const viagem = normalizarChavesViagem(result.recordset[0]);
      
      // Garantir que IDVIAGEM está presente
      if (!viagem.IDVIAGEM && !viagem.idviagem) {
        console.error('❌ [VIAGEM] IDVIAGEM não encontrado na resposta:', viagem);
        return res.status(500).json({ error: 'Dados da viagem inválidos' });
      }
      if (!viagem.IDVIAGEM) viagem.IDVIAGEM = viagem.idviagem;

      res.json(viagem);
    } catch (error) {
      console.error('❌ [VIAGEM] Erro ao buscar detalhes:', error);
      console.error('❌ [VIAGEM] Stack:', error.stack);
      console.error('❌ [VIAGEM] ID recebido:', req.params.idViagem);
      res.status(500).json({ 
        error: 'Erro ao buscar detalhes da viagem',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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
          [CDTIPOOCORRENCIA],
          [DSTIPOOCORRENCIA],
          [CDEDIPADRAO],
          [FGSITUACAO],
          [SEQ],
          CASE [FGSITUACAO]
            WHEN 'T' THEN 'TRÂNSITO'
            WHEN 'C' THEN 'CARREGAMENTO'
            WHEN 'D' THEN 'DESCARGA'
            WHEN 'P' THEN 'PARADA'
          END AS SITUACAO_TEXTO
        FROM [dbo].[TIPOOCORRENCIA]
        ORDER BY 
          CASE [FGSITUACAO]
            WHEN 'T' THEN 1
            WHEN 'C' THEN 2
            WHEN 'D' THEN 3
            WHEN 'P' THEN 4
          END,
          [SEQ],
          [CDTIPOOCORRENCIA]
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
      console.log('📝 [MACRO] Body completo:', JSON.stringify(req.body, null, 2));
      console.log('📝 [MACRO] Headers:', JSON.stringify(req.headers, null, 2));

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
      
      console.log('📝 [MACRO] Campos extraídos:', {
        idViagem,
        cdMotorista,
        cdTipoOcorrencia,
        temGPS: !!(latitude && longitude),
        temFoto: !!fotoBase64
      });

      // Validações detalhadas
      const erros = [];
      
      if (!idViagem) {
        erros.push('idViagem é obrigatório');
      } else if (isNaN(parseFloat(idViagem))) {
        erros.push('idViagem deve ser um número válido');
      }
      
      if (!cdMotorista) {
        erros.push('cdMotorista é obrigatório');
      } else if (isNaN(parseFloat(cdMotorista))) {
        erros.push('cdMotorista deve ser um número válido');
      }
      
      if (!cdTipoOcorrencia) {
        erros.push('cdTipoOcorrencia é obrigatório');
      } else if (isNaN(parseInt(cdTipoOcorrencia))) {
        erros.push('cdTipoOcorrencia deve ser um número válido');
      }
      
      if (erros.length > 0) {
        console.error('❌ [MACRO] Erros de validação:', erros);
        return res.status(400).json({ 
          error: 'Erro de validação',
          details: erros
        });
      }

      const pool = await poolPromise;

      // VALIDAÇÃO DE DUPLICATAS: Verificar se já existe uma ocorrência idêntica nos últimos 5 segundos
      const duplicataCheck = await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .input('cdTipoOcorrencia', sql.SmallInt, parseInt(cdTipoOcorrencia))
        .input('cdMotorista', sql.Decimal(15, 0), parseFloat(cdMotorista))
        .query(`
          SELECT TOP 1 [IDVIAGEM_OCORRENCIA], [DTOCORRENCIA]
          FROM [dbo].[VIAGEMOCORRENCIA]
          WHERE [IDVIAGEM] = @idViagem
            AND [CDTIPOOCORRENCIA] = @cdTipoOcorrencia
            AND [CDMOTORISTA] = @cdMotorista
            AND [DTOCORRENCIA] >= DATEADD(SECOND, -5, GETDATE())
          ORDER BY [DTOCORRENCIA] DESC
        `);

      if (duplicataCheck.recordset.length > 0) {
        const duplicata = duplicataCheck.recordset[0];
        const tempoDecorrido = Math.floor((new Date() - new Date(duplicata.DTOCORRENCIA)) / 1000);
        console.warn(`⚠️ [MACRO] Duplicata detectada! Ocorrência idêntica registrada há ${tempoDecorrido} segundos. ID: ${duplicata.IDVIAGEM_OCORRENCIA}`);
        
        return res.status(409).json({ 
          error: 'Duplicata detectada',
          message: `Esta ocorrência já foi registrada há ${tempoDecorrido} segundo(s). Aguarde alguns segundos antes de tentar novamente.`,
          duplicataId: duplicata.IDVIAGEM_OCORRENCIA,
          tempoDecorrido: tempoDecorrido
        });
      }

      // Inserir ocorrência com GPS completo
      await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .input('cdTipoOcorrencia', sql.SmallInt, parseInt(cdTipoOcorrencia))
        .input('cdMotorista', sql.Decimal(15, 0), parseFloat(cdMotorista))
        .input('latitude', sql.Decimal(10, 7), latitude ? parseFloat(latitude) : null)
        .input('longitude', sql.Decimal(10, 7), longitude ? parseFloat(longitude) : null)
        .input('precisao', sql.Decimal(10, 2), precisao ? parseFloat(precisao) : null)
        .input('observacao', sql.VarChar(500), observacao || null)
        .input('fotoBase64', sql.Text, fotoBase64 || null)
        .query(`
          INSERT INTO [dbo].[VIAGEMOCORRENCIA] (
            [IDVIAGEM],
            [CDTIPOOCORRENCIA],
            [CDMOTORISTA],
            [DTOCORRENCIA],
            [DSOBSERVACAO],
            [LATITUDE],
            [LONGITUDE],
            [NRPRECISAO],
            [DSFOTOBASE64],
            [FGSINCRONIZADO],
            [DTSINCRONIZACAO]
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
        // Usar data atual para DHPOSICAO (data da posição GPS)
        const dataPosicao = new Date();
        
        // Calcular próxima sequência para a viagem
        const seqResult = await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .query(`
            SELECT ISNULL(MAX([SEQUENCIA]), 0) + 1 AS proximaSequencia
            FROM [dbo].[VIAGEMRASTREAMENTO]
            WHERE [IDVIAGEM] = @idViagem
          `);
        
        const proximaSequencia = seqResult.recordset[0]?.proximaSequencia || 1;
        
        // Buscar nome da ocorrência
        const tipoResultTemp = await pool
          .request()
          .input('cdTipoOcorrencia', sql.SmallInt, cdTipoOcorrencia)
          .query(`
            SELECT [DSTIPOOCORRENCIA]
            FROM [dbo].[TIPOOCORRENCIA]
            WHERE [CDTIPOOCORRENCIA] = @cdTipoOcorrencia
          `);
        
        const nomeOcorrencia = tipoResultTemp.recordset[0]?.DSTIPOOCORRENCIA || 'Ocorrência';
        
        // Fazer reverse geocoding para obter endereço
        console.log(`📍 [MACRO] Iniciando geocodificação reversa...`);
        const endereco = await obterEnderecoPorCoordenadas(
          parseFloat(latitude),
          parseFloat(longitude)
        );
        
        const dsPosicao = `Macro: ${nomeOcorrencia} - ${endereco}`;
        console.log(`📍 [MACRO] DSPOSICAO: ${dsPosicao}`);
        
        await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .input('cdCadastro', sql.Decimal(15, 0), parseFloat(cdMotorista))
          .input('latitude', sql.Decimal(10, 8), parseFloat(latitude))
          .input('longitude', sql.Decimal(11, 8), parseFloat(longitude))
          .input('velocidade', sql.Decimal(5, 2), velocidade ? parseFloat(velocidade) : null)
          .input('precisao', sql.Int, precisao ? Math.round(parseFloat(precisao)) : null)
          .input('altitude', sql.Decimal(10, 2), altitude ? parseFloat(altitude) : null)
          .input('status', sql.Char(1), status || 'P')
          .input('direcao', sql.Decimal(5, 2), direcao ? parseFloat(direcao) : null)
          .input('dhPosicao', sql.DateTime, dataPosicao)
          .input('sequencia', sql.Int, proximaSequencia)
          .input('dsPosicao', sql.VarChar(200), dsPosicao)
          .query(`
            INSERT INTO [dbo].[VIAGEMRASTREAMENTO] (
              [IDVIAGEM],
              [CDCADASTRO],
              [LATITUDE],
              [LONGITUDE],
              [VELOCIDADE],
              [PRECISAO],
              [ALTITUDE],
              [FGSTATUS],
              [DIRECAO],
              [DHPOSICAO],
              [DHREGISTRO],
              [TIPO],
              [FONTE],
              [VERSAOAPP],
              [SEQUENCIA],
              [DSPOSICAO]
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
              @dhPosicao,
              GETDATE(),
              'M',
              'APP',
              '1.0.0',
              @sequencia,
              @dsPosicao
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
          SELECT [DSTIPOOCORRENCIA]
          FROM [dbo].[TIPOOCORRENCIA]
          WHERE [CDTIPOOCORRENCIA] = @cdTipoOcorrencia
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
      console.error('❌ [MACRO] Erro ao registrar ocorrência:', error);
      console.error('❌ [MACRO] Stack:', error.stack);
      console.error('❌ [MACRO] Body recebido:', JSON.stringify(req.body, null, 2));
      
      // Retornar mensagem de erro mais detalhada em desenvolvimento
      const mensagemErro = process.env.NODE_ENV === 'development' 
        ? `Erro ao registrar ocorrência: ${error.message}`
        : 'Erro ao registrar ocorrência';
      
      res.status(500).json({ 
        error: mensagemErro,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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
            [VO].[IDVIAGEM_OCORRENCIA],
            [VO].[CDTIPOOCORRENCIA],
            [T].[DSTIPOOCORRENCIA],
            [T].[FGSITUACAO],
            [T].[SEQ],
            [VO].[DTOCORRENCIA],
            [VO].[DSOBSERVACAO],
            [VO].[LATITUDE],
            [VO].[LONGITUDE],
            [VO].[NRPRECISAO],
            [VO].[DSCAMINHOFOTO],
            [VO].[DSFOTOBASE64],
            CASE WHEN [VO].[DSCAMINHOFOTO] IS NOT NULL OR [VO].[DSFOTOBASE64] IS NOT NULL 
              THEN 'S' ELSE 'N' 
            END AS TEM_FOTO,
            [VO].[FGSINCRONIZADO]
          FROM [dbo].[VIAGEMOCORRENCIA] [VO]
          INNER JOIN [dbo].[TIPOOCORRENCIA] [T] ON [VO].[CDTIPOOCORRENCIA] = [T].[CDTIPOOCORRENCIA]
          WHERE [VO].[IDVIAGEM] = @idViagem
          ORDER BY [VO].[DTOCORRENCIA] DESC
        `);

      console.log(`✅ [HISTÓRICO] ${result.recordset.length} ocorrências encontradas`);

      res.json(result.recordset);
    } catch (error) {
      console.error('❌ [HISTÓRICO] Erro:', error);
      
      // Se a tabela não existe, retornar array vazio ao invés de erro
      if (error.message && (error.message.includes('Invalid object name') || error.message.includes('não existe') || error.message.includes('does not exist'))) {
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
      console.log('📍 [GPS] Body completo:', JSON.stringify(req.body, null, 2));
      console.log('📍 [GPS] Headers:', JSON.stringify(req.headers, null, 2));

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
      
      console.log('📍 [GPS] Campos extraídos:', {
        cdMotorista,
        idViagem,
        latitude,
        longitude,
        temGPS: !!(latitude && longitude),
        velocidade,
        status
      });

      // Validações detalhadas
      const erros = [];
      
      if (!cdMotorista) {
        erros.push('cdMotorista é obrigatório');
      } else if (isNaN(parseFloat(cdMotorista))) {
        erros.push('cdMotorista deve ser um número válido');
      }
      
      if (!latitude) {
        erros.push('latitude é obrigatória');
      } else if (isNaN(parseFloat(latitude))) {
        erros.push('latitude deve ser um número válido');
      }
      
      if (!longitude) {
        erros.push('longitude é obrigatória');
      } else if (isNaN(parseFloat(longitude))) {
        erros.push('longitude deve ser um número válido');
      }
      
      if (erros.length > 0) {
        console.error('❌ [GPS] Erros de validação:', erros);
        return res.status(400).json({ 
          error: 'Erro de validação',
          details: erros
        });
      }

      const pool = await poolPromise;

      // Se TEM viagem: salvar em VIAGEMRASTREAMENTO
      if (idViagem) {
        // Usar dtPosicao se fornecido, senão usar data/hora atual
        const dataPosicao = dtPosicao ? new Date(dtPosicao) : new Date();
        
        // Calcular próxima sequência para a viagem ANTES de criar o request
        const seqResult = await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .query(`
            SELECT ISNULL(MAX([SEQUENCIA]), 0) + 1 AS proximaSequencia
            FROM [dbo].[VIAGEMRASTREAMENTO]
            WHERE [IDVIAGEM] = @idViagem
          `);
        
        const proximaSequencia = seqResult.recordset[0]?.proximaSequencia || 1;
        
        // Fazer reverse geocoding para obter endereço
        console.log(`📍 [GPS] Iniciando geocodificação reversa...`);
        const endereco = await obterEnderecoPorCoordenadas(
          parseFloat(latitude),
          parseFloat(longitude)
        );
        
        const tipoTexto = tipoEnvio === 'A' ? 'GPS Automático' : 'GPS Manual';
        const dsPosicao = `${tipoTexto} - ${endereco}`;
        console.log(`📍 [GPS] DSPOSICAO: ${dsPosicao}`);
        
        // Agora criar o request e inserir
        await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .input('cdCadastro', sql.Decimal(15, 0), parseFloat(cdMotorista))
          .input('latitude', sql.Decimal(10, 8), parseFloat(latitude))
          .input('longitude', sql.Decimal(11, 8), parseFloat(longitude))
          .input('velocidade', sql.Decimal(5, 2), velocidade ? parseFloat(velocidade) : null)
          .input('precisao', sql.Int, precisao ? Math.round(parseFloat(precisao)) : null)
          .input('altitude', sql.Decimal(10, 2), altitude ? parseFloat(altitude) : null)
          .input('status', sql.Char(1), status || 'P')
          .input('direcao', sql.Decimal(5, 2), direcao ? parseFloat(direcao) : null)
          .input('tipo', sql.Char(1), tipoEnvio || 'M')
          .input('dhPosicao', sql.DateTime, dataPosicao)
          .input('sequencia', sql.Int, proximaSequencia)
          .input('dsPosicao', sql.VarChar(200), dsPosicao)
          .query(`
            INSERT INTO [dbo].[VIAGEMRASTREAMENTO] (
              [IDVIAGEM], [CDCADASTRO], [LATITUDE], [LONGITUDE], [VELOCIDADE],
              [PRECISAO], [ALTITUDE], [FGSTATUS], [DIRECAO], [DHPOSICAO], [DHREGISTRO],
              [TIPO], [FONTE], [VERSAOAPP], [SEQUENCIA], [DSPOSICAO]
            ) VALUES (
              @idViagem, @cdCadastro, @latitude, @longitude, @velocidade,
              @precisao, @altitude, @status, @direcao, @dhPosicao, GETDATE(),
              @tipo, 'APP', '1.0.0', @sequencia, @dsPosicao
            )
          `);
        
        console.log(`✅ [GPS] Posição salva em VIAGEMRASTREAMENTO (viagem #${idViagem})`);
        
        // Emitir evento WebSocket para Torre de Controle
        try {
          const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
          if (websocketTorre && idViagem) {
            websocketTorre.emitirAtualizacaoGPS(idViagem, {
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude),
              velocidade: velocidade ? parseFloat(velocidade) : null,
              precisao: precisao ? Math.round(precisao) : null,
              altitude: altitude ? parseFloat(altitude) : null,
              direcao: direcao ? parseFloat(direcao) : null,
              timestamp: new Date().toISOString()
            });
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket GPS:', err.message);
        }
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
            INSERT INTO [dbo].[MOTORISTARASTREAMENTO] (
              [CDCADASTRO], [LATITUDE], [LONGITUDE], [VELOCIDADE],
              [PRECISAO], [ALTITUDE], [FGSTATUS], [DIRECAO], [DHREGISTRO],
              [TIPO], [FONTE], [VERSAOAPP]
            ) VALUES (
              @cdCadastro, @latitude, @longitude, @velocidade,
              @precisao, @altitude, @status, @direcao, CURRENT_TIMESTAMP,
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
      console.error('❌ [GPS] Stack:', error.stack);
      console.error('❌ [GPS] Body recebido:', JSON.stringify(req.body, null, 2));
      
      // Retornar mensagem de erro mais detalhada em desenvolvimento
      const mensagemErro = process.env.NODE_ENV === 'development' 
        ? `Erro ao registrar posição GPS: ${error.message}`
        : 'Erro ao registrar posição GPS';
      
      res.status(500).json({ 
        error: mensagemErro,
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
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

      console.log(`🔍 [RASTREAMENTO] Buscando posições para viagem: ${idviagem} (tipo: ${typeof idviagem})`);

      const pool = await poolPromise;

      // Verificar qual tabela existe e obter nome REAL (schema + table) para PostgreSQL
      // pg_tables retorna o nome exato (case-sensitive); evita erro quando tabela é "VIAGEMRASTREAMENTO"
      let tableName = null;
      let tableSchema = null;
      let tableExists = false;
      let realTableRef = null; // identificador já entre aspas para PG, ex: "public"."VIAGEMRASTREAMENTO"

      try {
        const tableCheck = await pool.query(`
          SELECT schemaname, tablename
          FROM pg_tables
          WHERE schemaname IN ('dbo', 'public')
            AND LOWER(tablename) = 'viagemrastreamento'
          LIMIT 1
        `);
        const row = tableCheck.rows?.[0];
        if (row) {
          tableSchema = row.schemaname ?? row.SCHEMANAME;
          const tablename = row.tablename ?? row.TABLENAME;
          tableName = 'VIAGEMRASTREAMENTO';
          tableExists = true;
          realTableRef = `"${tableSchema}"."${tablename}"`;
          console.log(`🔍 [RASTREAMENTO] Tabela encontrada: ${realTableRef}`);
        }
      } catch (err) {
        console.warn('Erro ao verificar tabela de rastreamento:', err.message);
      }

      if (!tableExists) {
        try {
          const tableCheck2 = await pool.query(`
            SELECT schemaname, tablename
            FROM pg_tables
            WHERE schemaname IN ('dbo', 'public')
              AND LOWER(tablename) = 'viagem_rastreamento'
            LIMIT 1
          `);
          const row2 = tableCheck2.rows?.[0];
          if (row2) {
            tableSchema = row2.schemaname ?? row2.SCHEMANAME;
            const tablename2 = row2.tablename ?? row2.TABLENAME;
            tableName = 'VIAGEM_RASTREAMENTO';
            tableExists = true;
            realTableRef = `"${tableSchema}"."${tablename2}"`;
            console.log(`🔍 [RASTREAMENTO] Tabela encontrada: ${realTableRef}`);
          }
        } catch (err) {
          console.warn('Erro ao verificar VIAGEM_RASTREAMENTO:', err.message);
        }
      }

      if (!tableExists || !realTableRef) {
        console.warn('Nenhuma tabela de rastreamento encontrada. Retornando posições vazias.');
        return res.json({
          posicoes: [],
          ultimaPosicaoGeral: null
        });
      }
      
      // DEBUG: Verificar se há registros na tabela antes de fazer a query principal
      // Testar com diferentes tipos de dados para garantir compatibilidade
      try {
        // Teste 1: Com Decimal
        const debugRequest = pool.request();
        debugRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
        const debugResult = await debugRequest.query(`
          SELECT COUNT(*) as total
          FROM ${realTableRef || '[dbo].[VIAGEMRASTREAMENTO]'}
          WHERE [IDVIAGEM] = @idviagem
        `);
        const totalDebug = debugResult.recordset[0].total;
        console.log(`🔍 [DEBUG] Total de registros na tabela VIAGEMRASTREAMENTO para IDVIAGEM = ${idviagem} (Decimal): ${totalDebug}`);
        
        // Teste 2: Com Int (caso o campo seja Int)
        if (totalDebug === 0) {
          try {
            const debugRequest2 = pool.request();
            debugRequest2.input('idviagem', sql.Int, parseInt(idviagem));
            const debugResult2 = await debugRequest2.query(`
              SELECT COUNT(*) as total
              FROM ${realTableRef || '[dbo].[VIAGEMRASTREAMENTO]'}
              WHERE [IDVIAGEM] = @idviagem
            `);
            const totalDebug2 = debugResult2.recordset[0].total;
            console.log(`🔍 [DEBUG] Total de registros na tabela VIAGEMRASTREAMENTO para IDVIAGEM = ${idviagem} (Int): ${totalDebug2}`);
          } catch (err2) {
            console.log(`🔍 [DEBUG] Teste com Int falhou: ${err2.message}`);
          }
        }
        
        // Teste 3: Direto com string (sem parâmetro)
        if (totalDebug === 0) {
          try {
            const debugResult3 = await pool.request().query(`
              SELECT COUNT(*) as total
              FROM ${realTableRef || '[dbo].[VIAGEMRASTREAMENTO]'}
              WHERE [IDVIAGEM] = ${parseFloat(idviagem)}
            `);
            const totalDebug3 = debugResult3.recordset[0].total;
            console.log(`🔍 [DEBUG] Total de registros na tabela VIAGEMRASTREAMENTO para IDVIAGEM = ${idviagem} (direto): ${totalDebug3}`);
          } catch (err3) {
            console.log(`🔍 [DEBUG] Teste direto falhou: ${err3.message}`);
          }
        }
        
        if (totalDebug > 0) {
          // Buscar amostra de registros para verificar estrutura
          const sampleRequest = pool.request();
          sampleRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const sampleResult = await sampleRequest.query(`
            SELECT TOP 3
              [IDVIAGEM],
              [SEQUENCIA],
              [LATITUDE],
              [LONGITUDE],
              [DHPOSICAO],
              [DHREGISTRO],
              [CDCADASTRO]
            FROM ${realTableRef}
            WHERE [IDVIAGEM] = @idviagem
            ORDER BY ISNULL([DHPOSICAO], [DHREGISTRO]) DESC
          `);
          console.log(`🔍 [DEBUG] Amostra de registros:`, JSON.stringify(sampleResult.recordset, null, 2));
        }
      } catch (debugErr) {
        console.error('❌ [DEBUG] Erro ao verificar tabela:', debugErr.message);
        console.error('❌ [DEBUG] Stack:', debugErr.stack);
      }

      // Buscar motorista da viagem (mesmo que não tenha posições GPS)
      let motoristaViagem = null;
      try {
        const motoristaResult = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1
              [vm].[CDMOTORISTA] AS CDCADASTRO,
              [cg].[RZSOCIAL] AS NOME_MOTORISTA,
              [cg].[CGCCPF] AS CPF_MOTORISTA,
              [cg].[NRCELULAR] AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] [vm]
            INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTRO]
            WHERE [vm].[IDVIAGEM] = @idviagem
            ORDER BY [vm].[CDMOTORISTA]
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
                [vm].[CDMOTORISTA] AS CDCADASTRO,
                [cg].[RZSOCIAL] AS NOME_MOTORISTA,
                [cg].[CGCCPF] AS CPF_MOTORISTA,
                [cg].[NRCELULAR] AS CELULAR
              FROM [dbo].[VIAGEMMOTORISTA] [vm]
              INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTROGERAL]
              WHERE [vm].[IDVIAGEM] = @idviagem
              ORDER BY [vm].[CDMOTORISTA]
            `);
          
          if (motoristaResult2.recordset.length > 0) {
            motoristaViagem = motoristaResult2.recordset[0];
          }
        } catch (err2) {
          console.warn('Erro ao buscar motorista (tentativa alternativa):', err2.message);
        }
      }

      // REMOVIDO: Filtro de data que estava excluindo posições válidas
      // Mostrar TODAS as posições GPS da viagem, independente da data
      let dataLimite = null;
      
      // O filtro de data foi removido porque estava causando problemas:
      // - Excluía posições válidas quando a viagem já havia começado
      // - Não mostrava posições mais recentes que a data de início prevista
      // - Causava confusão ao mostrar "0 posições" quando havia dados no banco

      // Buscar posições GPS da viagem - adaptar query conforme a tabela encontrada
      let result;
      
      if (tableName === 'VIAGEMRASTREAMENTO') {
        // Tabela VIAGEMRASTREAMENTO (estrutura do banco existente)
        // Buscar motorista da viagem para fazer JOIN (se a tabela existir)
        let cdMotorista = null;
        try {
          const motoristaViagemQuery = await pool
            .request()
            .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
            .query(`
              SELECT TOP 1 [CDMOTORISTA]
              FROM [dbo].[VIAGEMMOTORISTA]
              WHERE [IDVIAGEM] = @idviagem
            `);
          const rowMotorista = motoristaViagemQuery.recordset?.[0];
          cdMotorista = rowMotorista ? (rowMotorista.CDMOTORISTA ?? rowMotorista.cdmotorista) : null;
        } catch (errMotorista) {
          if (errMotorista.code !== '42P01') console.warn('Erro ao buscar motorista da viagem (continuando sem):', errMotorista.message);
        }
        console.log(`🔍 [RASTREAMENTO] Motorista encontrado: ${cdMotorista ? cdMotorista : 'Nenhum'}`);

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
          ? `AND ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) <= @dataLimite`
          : '';
        
        if (dataLimite) {
          console.log(`🔍 Aplicando filtro: posições com DHPOSICAO/DHREGISTRO <= ${dataLimite.toISOString()}`);
          console.log(`📊 Total de posições antes do filtro será verificado após a query`);
        } else {
          // Log removido
        }
        
        if (cdMotorista) {
          try {
            request.input('cdmotorista', sql.Decimal(15, 0), parseFloat(cdMotorista));
            result = await request.query(`
              SELECT 
                vr.[IDVIAGEM],
                ISNULL(vr.[SEQUENCIA], 0) AS SEQUENCIA,
                vr.[DSPOSICAO],
                CAST(vr.[LATITUDE] AS DECIMAL(10,8)) AS LATITUDE,
                CAST(vr.[LONGITUDE] AS DECIMAL(11,8)) AS LONGITUDE,
                ISNULL(vr.[VELOCIDADE], NULL) AS VELOCIDADE,
                ISNULL(vr.[PRECISAO], 10) AS PRECISAO,
                ISNULL(vr.[BATERIA], NULL) AS BATERIA,
                ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) AS DHREGISTRO,
                ISNULL(vr.[TIPO], 'A') AS TIPO,
                ISNULL(vr.[FONTE], 'RASTER') AS FONTE,
                vr.[FGSTATUS],
                vr.[CDCADASTRO] AS CDCADASTRO,
                cg.[RZSOCIAL] AS NOME_MOTORISTA,
                cg.[CGCCPF] AS CPF_MOTORISTA
              FROM ${realTableRef} vr
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON cg.[CDCADASTRO] = vr.[CDCADASTRO]
              WHERE vr.[IDVIAGEM] = @idviagem
                ${filtroData}
            ORDER BY ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) ASC
            `);
            console.log(`📊 Query VIAGEMRASTREAMENTO executada. Registros encontrados: ${result.recordset.length}`);
          } catch (errJoin) {
            if (errJoin.code === '42703') {
              console.warn('Query com JOIN em CADASTROGERAL falhou (coluna inexistente). Usando query sem motorista.');
              cdMotorista = null;
            } else {
              throw errJoin;
            }
          }
        }
        if (!result) {
          result = await request.query(`
            SELECT 
              vr.[IDVIAGEM],
              ISNULL(vr.[SEQUENCIA], 0) AS SEQUENCIA,
              vr.[DSPOSICAO],
              CAST(vr.[LATITUDE] AS DECIMAL(10,8)) AS LATITUDE,
              CAST(vr.[LONGITUDE] AS DECIMAL(11,8)) AS LONGITUDE,
              ISNULL(vr.[VELOCIDADE], NULL) AS VELOCIDADE,
              ISNULL(vr.[PRECISAO], 10) AS PRECISAO,
              ISNULL(vr.[BATERIA], NULL) AS BATERIA,
              ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) AS DHREGISTRO,
              ISNULL(vr.[TIPO], 'A') AS TIPO,
              ISNULL(vr.[FONTE], 'RASTER') AS FONTE,
              vr.[FGSTATUS],
              ISNULL(vr.[CDCADASTRO], NULL) AS CDCADASTRO,
              NULL AS NOME_MOTORISTA,
              NULL AS CPF_MOTORISTA
            FROM ${realTableRef} vr
            WHERE vr.[IDVIAGEM] = @idviagem
              ${filtroData}
            ORDER BY ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) ASC
          `);
          
          // Log removido
          if (result.recordset.length === 0 && dataLimite) {
            console.warn(`⚠️  Nenhuma posição encontrada com filtro. Verificando total sem filtro...`);
            const testRequest2 = pool.request();
            testRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
            const testResult2 = await testRequest2.query(`
              SELECT COUNT(*) as total 
              FROM ${realTableRef} 
              WHERE [IDVIAGEM] = @idviagem
            `);
            const totalSemFiltro2 = testResult2.recordset[0].total;
            console.log(`📊 Total de posições na tabela (sem filtro): ${totalSemFiltro2}`);
            if (totalSemFiltro2 > 0) {
              const sampleRequest2 = pool.request();
              sampleRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
              const sampleResult2 = await sampleRequest2.query(`
                SELECT TOP 5 
                  ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) AS DATA_POSICAO,
                  vr.[SEQUENCIA]
                FROM ${realTableRef} vr
                WHERE vr.[IDVIAGEM] = @idviagem
                ORDER BY ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) DESC
              `);
              // Logs removidos
            }
          }
          console.log(`📊 Total de registros encontrados (sem motorista): ${result.recordset.length}`);
        }
        } else {
          // Tabela VIAGEM_RASTREAMENTO (estrutura nova)
          try {
            const request2 = pool.request();
            request2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
            
            // REMOVIDO: Filtro de data que estava excluindo posições válidas
            // Mostrar TODAS as posições GPS da viagem
            const filtroData2 = '';
          
          result = await request2.query(`
              SELECT 
                vr.[IDRASTREAMENTO],
                vr.[IDVIAGEM],
                vr.[CDCADASTRO],
                vr.[LATITUDE],
                vr.[LONGITUDE],
                vr.[VELOCIDADE],
                vr.[PRECISAO],
                ISNULL(vr.[BATERIA], NULL) AS BATERIA,
                vr.[DHREGISTRO],
                ISNULL(vr.[TIPO], 'A') AS TIPO,
                ISNULL(vr.[FONTE], 'APP') AS FONTE,
                cg.[RZSOCIAL] AS NOME_MOTORISTA,
                cg.[CGCCPF] AS CPF_MOTORISTA
              FROM ${realTableRef} vr
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON vr.[CDCADASTRO] = cg.[CDCADASTRO]
              WHERE vr.[IDVIAGEM] = @idviagem
                ${filtroData2}
              ORDER BY vr.[DHREGISTRO] ASC
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
            ? `AND vr.[DHREGISTRO] <= @dataLimite`
            : '';
          
          result = await request3.query(`
              SELECT 
                vr.[IDRASTREAMENTO],
                vr.[IDVIAGEM],
                ISNULL(vr.[CDCADASTRO], vr.[CDMOTORISTA]) AS CDCADASTRO,
                vr.[LATITUDE],
                vr.[LONGITUDE],
                vr.[VELOCIDADE],
                vr.[PRECISAO],
                NULL AS BATERIA,
                vr.[DHREGISTRO],
                ISNULL(vr.[TIPO], 'A') AS TIPO,
                'APP' AS FONTE,
                cg.[RZSOCIAL] AS NOME_MOTORISTA,
                cg.[CGCCPF] AS CPF_MOTORISTA
              FROM ${realTableRef} vr
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON (vr.[CDCADASTRO] = cg.[CDCADASTRO] OR vr.[CDMOTORISTA] = cg.[CDCADASTRO])
              WHERE vr.[IDVIAGEM] = @idviagem
                ${filtroData3}
              ORDER BY vr.[DHREGISTRO] ASC
            `);
        }
      }

      // Adicionar informações do motorista e normalizar chaves para maiúsculas (PostgreSQL retorna minúsculas; frontend espera LATITUDE, LONGITUDE, etc.)
      const posicoes = result.recordset.map(pos => {
        const p = { ...pos };
        if (!p.NOME_MOTORISTA && !p.nome_motorista && motoristaViagem) {
          p.NOME_MOTORISTA = motoristaViagem.NOME_MOTORISTA;
          p.CPF_MOTORISTA = motoristaViagem.CPF_MOTORISTA;
        }
        // Garantir chaves em maiúsculas para o frontend (app motorista e gps-visualizacao)
        ['LATITUDE', 'LONGITUDE', 'VELOCIDADE', 'DHREGISTRO', 'DHPOSICAO', 'NOME_MOTORISTA', 'CPF_MOTORISTA', 'IDVIAGEM', 'SEQUENCIA', 'PRECISAO', 'BATERIA', 'TIPO', 'FONTE'].forEach(k => {
          const lower = k.toLowerCase();
          if (p[lower] !== undefined && p[k] === undefined) p[k] = p[lower];
        });
        return p;
      });

      // Buscar a última posição geral (sem filtro de data) para exibir na "Última Atualização"
      let ultimaPosicaoGeral = null;
      try {
        if (tableName === 'VIAGEMRASTREAMENTO') {
          const ultimaPosicaoRequest = pool.request();
          ultimaPosicaoRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const ultimaPosicaoResult = await ultimaPosicaoRequest.query(`
            SELECT TOP 1
              ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) AS DHREGISTRO
            FROM ${realTableRef} vr
            WHERE vr.[IDVIAGEM] = @idviagem
            ORDER BY ISNULL(vr.[DHPOSICAO], vr.[DHREGISTRO]) DESC
          `);
          if (ultimaPosicaoResult.recordset.length > 0) {
            const row = ultimaPosicaoResult.recordset[0];
            ultimaPosicaoGeral = { DHREGISTRO: row.DHREGISTRO ?? row.dhiregistro };
          }
        } else if (tableName === 'VIAGEM_RASTREAMENTO') {
          const ultimaPosicaoRequest2 = pool.request();
          ultimaPosicaoRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const ultimaPosicaoResult2 = await ultimaPosicaoRequest2.query(`
            SELECT TOP 1
              vr.[DHREGISTRO]
            FROM ${realTableRef} vr
            WHERE vr.[IDVIAGEM] = @idviagem
            ORDER BY vr.[DHREGISTRO] DESC
          `);
          if (ultimaPosicaoResult2.recordset.length > 0) {
            const row2 = ultimaPosicaoResult2.recordset[0];
            ultimaPosicaoGeral = { DHREGISTRO: row2.DHREGISTRO ?? row2.dhiregistro };
          }
        }
      } catch (err) {
        console.warn('⚠️  Erro ao buscar última posição geral:', err.message);
        // Continuar sem a última posição geral
      }

      // Sempre retornar array, mesmo se vazio
      if (posicoes.length === 0) {
        console.warn(`⚠️  Nenhuma posição encontrada para a viagem ${idviagem}. Verifique se há registros na tabela VIAGEMRASTREAMENTO.`);
        
        // DEBUG: Verificar novamente se há registros na tabela
        try {
          const finalCheckRequest = pool.request();
          finalCheckRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const finalCheckResult = await finalCheckRequest.query(`
            SELECT COUNT(*) as total
            FROM ${realTableRef}
            WHERE [IDVIAGEM] = @idviagem
          `);
          const totalFinal = finalCheckResult.recordset[0].total;
          console.log(`🔍 [DEBUG FINAL] Total de registros na tabela VIAGEMRASTREAMENTO para IDVIAGEM = ${idviagem}: ${totalFinal}`);
          
          if (totalFinal > 0) {
            console.error(`❌ [ERRO] Há ${totalFinal} registros na tabela, mas a query retornou 0. Verifique a query SQL!`);
          }
        } catch (checkErr) {
          console.error('❌ [DEBUG FINAL] Erro ao verificar:', checkErr.message);
        }
      } else {
        console.log(`✅ ${posicoes.length} posições GPS encontradas para a viagem ${idviagem}`);
      }
      
      // Retornar objeto com posições filtradas e última posição geral
      console.log(`✅ [API] Retornando ${posicoes.length} posições para viagem ${idviagem}`);
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
      
      // Retornar objeto vazio (não array) em caso de erro, para manter formato consistente
      // O frontend já trata array vazio mostrando mensagem apropriada
      console.warn('⚠️ Retornando objeto vazio devido ao erro');
      res.json({
        posicoes: [],
        ultimaPosicaoGeral: null
      });
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
              [vm].[CDMOTORISTA] AS CDCADASTRO,
              [cg].[CDCADASTRO],
              [cg].[RZSOCIAL] AS NOME_MOTORISTA,
              [cg].[CGCCPF] AS CPF_MOTORISTA,
              [cg].[NRCELULAR] AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] [vm]
            INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTRO]
            WHERE [vm].[IDVIAGEM] = @idviagem
            ORDER BY [vm].[CDMOTORISTA]
          `);
      } catch (err) {
        // Tentar com CDCADASTROGERAL se CDCADASTRO não funcionar
        console.warn('Tentando busca alternativa do motorista...', err.message);
        result = await pool
          .request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .query(`
            SELECT TOP 1
              [vm].[CDMOTORISTA] AS CDCADASTRO,
              [cg].[CDCADASTROGERAL] AS CDCADASTRO,
              [cg].[RZSOCIAL] AS NOME_MOTORISTA,
              [cg].[CGCCPF] AS CPF_MOTORISTA,
              [cg].[NRCELULAR] AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] [vm]
            INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTROGERAL]
            WHERE [vm].[IDVIAGEM] = @idviagem
            ORDER BY [vm].[CDMOTORISTA]
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
  },

  // ==========================================
  // RECUPERAR SENHA
  // ==========================================
  recuperarSenha: async (req, res) => {
    try {
      const { identificacao } = req.body; // CPF ou celular

      if (!identificacao) {
        return res.status(400).json({ error: 'CPF ou celular é obrigatório.', errorKey: 'recuperarSenhaErrors.identificacaoObrigatoria' });
      }

      // Limpar identificação (remover caracteres não numéricos)
      const identificacaoLimpa = identificacao.replace(/\D/g, '');

      if (identificacaoLimpa.length < 10) {
        return res.status(400).json({ error: 'CPF ou celular inválido.', errorKey: 'recuperarSenhaErrors.identificacaoInvalida' });
      }

      const pool = await poolPromise;

      // Buscar motorista por CPF ou celular
      let query = '';
      let request = pool.request();

      if (identificacaoLimpa.length === 11) {
        // Provavelmente é CPF
        const cpfLimpo = identificacaoLimpa.length === 10 ? '0' + identificacaoLimpa : identificacaoLimpa;
        const cpfSemZero = cpfLimpo.startsWith('0') ? cpfLimpo.substring(1) : cpfLimpo;
        
        query = `
          SELECT 
            cg.CDCADASTRO,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.FGACTIVE
          FROM [dbo].[CADASTROGERAL] cg
          WHERE (cg.CGCCPF = @cpf1 OR cg.CGCCPF = @cpf2)
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
            AND cg.FGACTIVE = 'A'
        `;
        request.input('cpf1', sql.VarChar(14), cpfLimpo);
        request.input('cpf2', sql.VarChar(14), cpfSemZero);
      } else {
        // Provavelmente é celular
        query = `
          SELECT 
            cg.CDCADASTRO,
            cg.CGCCPF,
            cg.RZSOCIAL,
            cg.NRCELULAR,
            cg.ENDEMAIL,
            cg.FGACTIVE
          FROM [dbo].[CADASTROGERAL] cg
          WHERE cg.NRCELULAR LIKE @celular
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
            AND cg.FGACTIVE = 'A'
        `;
        request.input('celular', sql.VarChar(20), '%' + identificacaoLimpa + '%');
      }

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        // Por segurança, sempre retornar sucesso mesmo que não encontre
        return res.json({
          success: true,
          message: 'Se o CPF ou celular estiver cadastrado, você receberá um código de recuperação por SMS ou email.'
        });
      }

      const motorista = result.recordset[0];

      // Gerar código de 6 dígitos (válido 15 min). Em produção: enviar por SMS/Email.
      const codigo = String(Math.floor(100000 + Math.random() * 900000));
      const cdCadastro = motorista.CDCADASTRO;
      codigosRecuperacao.set(cdCadastro, { codigo, expires: Date.now() + 15 * 60 * 1000 });
      console.log(`📧 [RECUPERAR SENHA] Motorista encontrado: ${cdCadastro} - ${motorista.RZSOCIAL}`);
      console.log(`📧 [RECUPERAR SENHA] Celular: ${motorista.NRCELULAR || 'N/A'}`);
      console.log(`📧 [RECUPERAR SENHA] Email: ${motorista.ENDEMAIL || 'N/A'}`);
      console.log(`📧 [RECUPERAR SENHA] Código (dev): ${codigo}`);

      res.json({
        success: true,
        message: 'Se o CPF ou celular estiver cadastrado, você receberá um código de recuperação por SMS ou email.'
      });
    } catch (err) {
      console.error('❌ [RECUPERAR SENHA] Erro:', err);
      res.status(500).json({ error: 'Erro ao processar solicitação de recuperação de senha.', errorKey: 'recuperarSenhaErrors.erroProcessar' });
    }
  },

  // ==========================================
  // REDEFINIR SENHA (com código recebido após recuperar)
  // ==========================================
  redefinirSenha: async (req, res) => {
    try {
      const { identificacao, codigo, novaSenha } = req.body;

      if (!identificacao || !codigo || !novaSenha) {
        return res.status(400).json({ error: 'Identificação (CPF/celular), código e nova senha são obrigatórios.', errorKey: 'redefinirSenhaErrors.camposObrigatorios' });
      }

      if (novaSenha.length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.', errorKey: 'redefinirSenhaErrors.senhaMinima' });
      }

      const identificacaoLimpa = identificacao.replace(/\D/g, '');
      if (identificacaoLimpa.length < 10) {
        return res.status(400).json({ error: 'CPF ou celular inválido.', errorKey: 'redefinirSenhaErrors.identificacaoInvalida' });
      }

      const pool = await poolPromise;
      let query = '';
      let request = pool.request();

      if (identificacaoLimpa.length === 11) {
        const cpfLimpo = identificacaoLimpa.length === 10 ? '0' + identificacaoLimpa : identificacaoLimpa;
        const cpfSemZero = cpfLimpo.startsWith('0') ? cpfLimpo.substring(1) : cpfLimpo;
        query = `
          SELECT cg.CDCADASTRO FROM [dbo].[CADASTROGERAL] cg
          WHERE (cg.CGCCPF = @cpf1 OR cg.CGCCPF = @cpf2)
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
            AND cg.FGACTIVE = 'A'
        `;
        request.input('cpf1', sql.VarChar(14), cpfLimpo);
        request.input('cpf2', sql.VarChar(14), cpfSemZero);
      } else {
        query = `
          SELECT cg.CDCADASTRO FROM [dbo].[CADASTROGERAL] cg
          WHERE cg.NRCELULAR LIKE @celular
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
            AND cg.FGACTIVE = 'A'
        `;
        request.input('celular', sql.VarChar(20), '%' + identificacaoLimpa + '%');
      }

      const result = await request.query(query);
      if (result.recordset.length === 0) {
        return res.status(400).json({ error: 'Código inválido ou expirado.', errorKey: 'redefinirSenhaErrors.codigoInvalido' });
      }

      const cdCadastro = result.recordset[0].CDCADASTRO;
      const stored = codigosRecuperacao.get(cdCadastro);
      if (!stored || stored.expires < Date.now()) {
        codigosRecuperacao.delete(cdCadastro);
        return res.status(400).json({ error: 'Código inválido ou expirado.', errorKey: 'redefinirSenhaErrors.codigoInvalido' });
      }
      if (stored.codigo !== String(codigo).trim()) {
        return res.status(400).json({ error: 'Código inválido ou expirado.', errorKey: 'redefinirSenhaErrors.codigoInvalido' });
      }

      const senhaHash = await bcrypt.hash(novaSenha, 10);
      await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(cdCadastro))
        .input('senha', sql.NVarChar(255), senhaHash)
        .query(`
          IF EXISTS (SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] WHERE CDCADASTRO = @id)
            UPDATE [dbo].[MOTORISTA_COMPLEMENTO] SET SENHA = @senha WHERE CDCADASTRO = @id
          ELSE
            INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (CDCADASTRO, SENHA) VALUES (@id, @senha)
        `);

      codigosRecuperacao.delete(cdCadastro);
      res.json({ success: true, message: 'Senha redefinida com sucesso.' });
    } catch (err) {
      console.error('❌ [REDEFINIR SENHA] Erro:', err);
      res.status(500).json({ error: 'Erro ao redefinir senha.', errorKey: 'redefinirSenhaErrors.erroRedefinir' });
    }
  },

  // ==========================================
  // ALTERAR SENHA
  // ==========================================
  alterarSenha: async (req, res) => {
    try {
      const { idMotorista, senhaAtual, novaSenha } = req.body;

      if (!idMotorista || !senhaAtual || !novaSenha) {
        return res.status(400).json({ error: 'Dados incompletos para alterar senha', errorKey: 'alterarSenhaErrors.dadosIncompletos' });
      }

      if (novaSenha.length < 6) {
        return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres', errorKey: 'alterarSenhaErrors.senhaMinima' });
      }

      const pool = await poolPromise;

      // Buscar motorista e senha atual
      const result = await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(idMotorista))
        .query(`
          SELECT 
            mc.SENHA,
            cg.CDCADASTRO,
            cg.FGTIPOCADASTRO,
            cg.FGACTIVE
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          WHERE cg.CDCADASTRO = @id
            AND (cg.FGMOTORISTA = 'S' OR (cg.FGMOTORISTA IS NULL AND cg.FGTIPOCADASTRO = 'M'))
            AND cg.FGACTIVE = 'A'
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Motorista não encontrado', errorKey: 'alterarSenhaErrors.motoristaNaoEncontrado' });
      }

      const motorista = result.recordset[0];

      // Validar senha atual
      if (motorista.SENHA) {
        const senhaValida = await bcrypt.compare(senhaAtual, motorista.SENHA);
        if (!senhaValida) {
          return res.status(401).json({ error: 'Senha atual incorreta', errorKey: 'alterarSenhaErrors.senhaAtualIncorreta' });
        }
      } else {
        // Se não tem senha, aceitar qualquer senha como atual (modo desenvolvimento)
        console.warn(`⚠️ Motorista ${idMotorista} não tem senha definida. Aceitando qualquer senha como atual.`);
      }

      // Criptografar nova senha
      const senhaHash = await bcrypt.hash(novaSenha, 10);

      // Atualizar senha
      const updateResult = await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(idMotorista))
        .input('senha', sql.NVarChar(255), senhaHash)
        .query(`
          IF EXISTS (SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] WHERE CDCADASTRO = @id)
            UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
            SET SENHA = @senha
            WHERE CDCADASTRO = @id
          ELSE
            INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (CDCADASTRO, SENHA)
            VALUES (@id, @senha)
        `);

      res.json({
        success: true,
        message: 'Senha alterada com sucesso'
      });
    } catch (err) {
      console.error('Erro ao alterar senha:', err);
      res.status(500).json({ error: 'Erro ao alterar senha', errorKey: 'alterarSenhaErrors.erroAlterar' });
    }
  },

  // ==========================================
  // DEFINIR SENHA (admin/web) - Define ou redefine a senha do app para um motorista
  // ==========================================
  definirSenhaAdmin: async (req, res) => {
    try {
      const { cdCadastro, novaSenha } = req.body;

      if (!cdCadastro || !novaSenha || novaSenha.length < 6) {
        return res.status(400).json({
          success: false,
          error: 'Código do cadastro e nova senha (mín. 6 caracteres) são obrigatórios.'
        });
      }

      const pool = await poolPromise;
      const id = parseFloat(cdCadastro);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'Código do cadastro inválido.' });
      }

      // Verificar se o cadastro é motorista
      const check = await pool
        .request()
        .input('id', sql.Decimal(15, 0), id)
        .query(`
          SELECT [CDCADASTRO], [FGMOTORISTA] FROM [dbo].[CADASTROGERAL]
          WHERE [CDCADASTRO] = @id AND ([FGACTIVE] = 'S' OR [FGACTIVE] = 'A')
        `);

      if (!check.recordset || check.recordset.length === 0) {
        return res.status(404).json({ success: false, error: 'Cadastro não encontrado ou inativo.' });
      }

      const cad = check.recordset[0];
      const get = (row, key) => row[key] != null ? row[key] : row[(key && key.toLowerCase())];
      const ehMotorista = get(cad, 'FGMOTORISTA') === 'S' || get(cad, 'FGMOTORISTA') === true;
      if (!ehMotorista) {
        return res.status(400).json({ success: false, error: 'Este cadastro não é motorista. Marque "Motorista" no Tipo de Cadastro.' });
      }

      const senhaHash = await bcrypt.hash(novaSenha, 10);

      // UPDATE ou INSERT (compatível com PostgreSQL: sem IF EXISTS)
      const upd = await pool
        .request()
        .input('id', sql.Decimal(15, 0), id)
        .input('senha', sql.NVarChar(255), senhaHash)
        .query(`
          UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
          SET [SENHA] = @senha
          WHERE [CDCADASTRO] = @id
        `);
      const updated = (upd.rowsAffected && upd.rowsAffected[0]) > 0;
      if (!updated) {
        await pool
          .request()
          .input('id', sql.Decimal(15, 0), id)
          .input('senha', sql.NVarChar(255), senhaHash)
          .query(`
            INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] ([CDCADASTRO], [SENHA])
            VALUES (@id, @senha)
          `);
      }

      res.json({
        success: true,
        message: 'Senha do app motorista definida com sucesso.'
      });
    } catch (err) {
      console.error('Erro ao definir senha (admin):', err);
      res.status(500).json({ success: false, error: 'Erro ao definir senha.' });
    }
  },

  // ==========================================
  // APROVAR MOTORISTA (admin/web) - Define status de aprovação (P/A/R)
  // ==========================================
  aprovarMotoristaAdmin: async (req, res) => {
    try {
      const { cdCadastro, status } = req.body;
      const statusValido = status === 'A' || status === 'P' || status === 'R';
      if (!cdCadastro || !statusValido) {
        return res.status(400).json({
          success: false,
          error: 'Código do cadastro e status são obrigatórios. Status: A (Aprovado), P (Pendente) ou R (Rejeitado).'
        });
      }

      const pool = await poolPromise;
      const id = parseFloat(cdCadastro);
      if (isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: 'Código do cadastro inválido.' });
      }

      let check;
      try {
        check = await pool
          .request()
          .input('id', sql.Decimal(15, 0), id)
          .query(`
          SELECT [CDCADASTRO], [FGMOTORISTA] FROM [dbo].[CADASTROGERAL]
          WHERE [CDCADASTRO] = @id AND ([FGACTIVE] = 'S' OR [FGACTIVE] = 'A')
        `);
      } catch (err) {
        if (err.code === '42P01') {
          return res.status(503).json({
            success: false,
            error: 'Sistema em configuração. Tabelas de cadastro (cadastrogeral/motorista_complemento) ainda não disponíveis.'
          });
        }
        throw err;
      }

      if (!check.recordset || check.recordset.length === 0) {
        return res.status(404).json({ success: false, error: 'Cadastro não encontrado ou inativo.' });
      }

      const cad = check.recordset[0];
      const get = (row, key) => row[key] != null ? row[key] : row[(key && key.toLowerCase())];
      const ehMotorista = get(cad, 'FGMOTORISTA') === 'S' || get(cad, 'FGMOTORISTA') === true;
      if (!ehMotorista) {
        return res.status(400).json({ success: false, error: 'Este cadastro não é motorista.' });
      }

      try {
        const upd = await pool
          .request()
          .input('id', sql.Decimal(15, 0), id)
          .input('status', sql.VarChar(1), status)
          .query(`
          UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
          SET [STATUSAPROVACAO] = @status
          WHERE [CDCADASTRO] = @id
        `);
        const updated = (upd.rowsAffected && upd.rowsAffected[0]) > 0;
        if (!updated) {
          await pool
            .request()
            .input('id', sql.Decimal(15, 0), id)
            .input('status', sql.VarChar(1), status)
            .query(`
            INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] ([CDCADASTRO], [STATUSAPROVACAO])
            VALUES (@id, @status)
          `);
        }
      } catch (err) {
        if (err.code === '42P01') {
          return res.status(503).json({
            success: false,
            error: 'Sistema em configuração. Tabela motorista_complemento ainda não disponível.'
          });
        }
        throw err;
      }

      const msg = status === 'A' ? 'Motorista aprovado. Pode fazer login no app.'
        : status === 'R' ? 'Motorista marcado como rejeitado.'
        : 'Status definido como pendente.';
      res.json({ success: true, message: msg });
    } catch (err) {
      console.error('Erro ao aprovar motorista (admin):', err);
      res.status(500).json({ success: false, error: 'Erro ao atualizar status de aprovação.' });
    }
  },

  // ==========================================
  // NOTIFICAÇÕES - Notificações recentes do motorista
  // ==========================================
  notificacoesRecentes: async (req, res) => {
    try {
      const { cdMotorista } = req.params;
      const { limit = 10 } = req.query;

      console.log(`🔔 [NOTIFICAÇÕES] Buscando notificações recentes para motorista ${cdMotorista}`);
      console.log('🔔 [NOTIF] v2 — mensagens via ID_CONVERSA + ID_VIAGEM; SOS via CDVIAGEM');

      const pool = await poolPromise;
      const notificacoes = [];

      // 1. Mensagens não lidas do chat (MESSAGES + CONVERSAS: ID_CONVERSA, ID_VIAGEM)
      try {
        console.log('🔔 [NOTIF] Buscando mensagens não lidas para motorista', cdMotorista);
        const mensagensResult = await pool
          .request()
          .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
          .input('limit', sql.Int, parseInt(limit))
          .query(`
            SELECT TOP (@limit)
              m.[ID] AS IDMESSAGE,
              v.[IDVIAGEM],
              m.[CONTENT] AS MENSAGEM,
              m.[SENDER_TYPE],
              m.[SENDER_ID],
              m.[CREATED_AT],
              COALESCE(m.[SENDER_NAME], cg.[RZSOCIAL]) AS REMETENTE,
              r.[DSROTEIRO]
            FROM [dbo].[MESSAGES] m
            INNER JOIN [dbo].[CONVERSAS] c ON m.[ID_CONVERSA] = c.[ID]
            LEFT JOIN [dbo].[CADASTROGERAL] cg ON m.[SENDER_ID] = cg.[CDCADASTRO]
            LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.[ID_VIAGEM] = v.[IDVIAGEM]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
            WHERE c.[ID_MOTORISTA] = @cdMotorista
              AND m.[SENDER_TYPE] = 'OPERADOR'
              AND (m.[READ_BY_RECEIVER] IS NOT TRUE)
            ORDER BY m.[CREATED_AT] DESC
          `);

        console.log('🔔 [NOTIF] Mensagens não lidas:', mensagensResult.recordset.length);
        mensagensResult.recordset.forEach(msg => {
          notificacoes.push({
            tipo: 'chat',
            id: `msg_${msg.IDMESSAGE}`,
            titulo: 'Nova mensagem no chat',
            descricao: msg.MENSAGEM || 'Mensagem do operador',
            remetente: msg.REMETENTE || 'Operador',
            viagem: msg.IDVIAGEM,
            roteiro: msg.DSROTEIRO,
            data: msg.CREATED_AT,
            acao: `chat.html?viagem=${msg.IDVIAGEM}`
          });
        });
      } catch (err) {
        console.warn('⚠️ Erro ao buscar mensagens:', err.message);
        console.warn('⚠️ [NOTIF] Stack mensagens:', err.code, err.detail || '');
      }

      // 2. Convocações pendentes
      try {
        const convocacoesResult = await pool
          .request()
          .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
          .input('limit', sql.Int, parseInt(limit))
          .query(`
            SELECT TOP (@limit)
              c.[IDCONVOCACAO],
              c.[IDVIAGEM],
              c.[TXTCONVOCACAO],
              c.[DHCONVOCACAO],
              c.[STATUS],
              r.[DSROTEIRO]
            FROM [dbo].[CONVOCACAO] c
            LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
            WHERE c.[CDCADASTRO_MOTORISTA] = @cdMotorista
              AND c.[STATUS] IN ('PENDENTE', 'ENVIADA')
            ORDER BY c.[DHCONVOCACAO] DESC
          `);

        const limparTextoNotificacao = (txt) => {
          if (!txt || typeof txt !== 'string') return '';
          return txt
            .replace(/\*+/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/^\s+|\s+$/g, '')
            .substring(0, 280);
        };

        convocacoesResult.recordset.forEach(conv => {
          const textoBruto = conv.TXTCONVOCACAO || 'Você foi convocado para uma viagem';
          notificacoes.push({
            tipo: 'convocacao',
            id: `conv_${conv.IDCONVOCACAO}`,
            titulo: 'Nova convocação',
            descricao: limparTextoNotificacao(textoBruto),
            viagem: conv.IDVIAGEM,
            roteiro: conv.DSROTEIRO,
            status: conv.STATUS,
            data: conv.DHCONVOCACAO,
            acao: `convocacoes.html`
          });
        });
      } catch (err) {
        console.warn('⚠️ Erro ao buscar convocações:', err.message);
      }

      // 3. Alertas SOS não tratados (compatível com CDVIAGEM)
      try {
        console.log('🔔 [NOTIF] Buscando SOS ativos para motorista', cdMotorista);
        let sosResult;
        try {
          sosResult = await pool.request()
            .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
            .input('limit', sql.Int, parseInt(limit))
            .query(`
              SELECT TOP (@limit)
                s.[ID] AS IDSOS,
                s.[CDVIAGEM] AS IDVIAGEM,
                s.[MESSAGE] AS DESCRICAO,
                s.[STATUS],
                s.[CREATED_AT],
                v.[IDVIAGEM],
                r.[DSROTEIRO]
              FROM [dbo].[SOS_ALERTS] s
              LEFT JOIN [dbo].[VIAGEMMESTRE] v ON s.[CDVIAGEM] = v.[IDVIAGEM]
              LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
              WHERE s.[CDMOTORISTA] = @cdMotorista
                AND s.[STATUS] IN ('PENDENTE', 'ABERTO', 'active')
              ORDER BY s.[CREATED_AT] DESC
            `);
        } catch (errSos) {
          console.warn('⚠️ [NOTIF] SOS query principal falhou:', errSos.code, errSos.message);
          if (errSos.code === '42703') {
            // Fallback: mesmo esquema (CDVIAGEM), caso alguma coluna tenha nome diferente
            sosResult = await pool.request()
              .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
              .input('limit', sql.Int, parseInt(limit))
              .query(`
                SELECT TOP (@limit)
                  s.[ID] AS IDSOS,
                  s.[CDVIAGEM] AS IDVIAGEM,
                  s.[MESSAGE] AS DESCRICAO,
                  s.[STATUS],
                  s.[CREATED_AT],
                  v.[IDVIAGEM],
                  r.[DSROTEIRO]
                FROM [dbo].[SOS_ALERTS] s
                LEFT JOIN [dbo].[VIAGEMMESTRE] v ON s.[CDVIAGEM] = v.[IDVIAGEM]
                LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
                WHERE s.[CDMOTORISTA] = @cdMotorista
                  AND s.[STATUS] IN ('PENDENTE', 'ABERTO', 'active')
                ORDER BY s.[CREATED_AT] DESC
              `);
          } else {
            throw errSos;
          }
        }

        console.log('🔔 [NOTIF] SOS ativos:', sosResult.recordset.length);
        sosResult.recordset.forEach(sos => {
          notificacoes.push({
            tipo: 'sos',
            id: `sos_${sos.IDSOS}`,
            titulo: 'Alerta SOS',
            descricao: sos.DESCRICAO || 'Alerta de emergência',
            viagem: sos.IDVIAGEM,
            roteiro: sos.DSROTEIRO,
            status: sos.STATUS,
            data: sos.CREATED_AT,
            acao: `sos.html?viagem=${sos.IDVIAGEM}`
          });
        });
      } catch (err) {
        console.warn('⚠️ Erro ao buscar SOS:', err.message);
        console.warn('⚠️ [NOTIF] Stack SOS:', err.code, err.detail || '');
      }

      // 4. Alertas da viagem
      try {
        const alertasResult = await pool
          .request()
          .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
          .input('limit', sql.Int, parseInt(limit))
          .query(`
            SELECT [a].[ID], [a].[IDVIAGEM], [a].[MESSAGE], [a].[TYPE], [a].[STATUS], [a].[CREATED_AT],
              [v].[IDVIAGEM], [r].[DSROTEIRO]
            FROM [dbo].[ALERTS] [a]
            INNER JOIN [dbo].[VIAGEMMOTORISTA] [vm] ON [a].[IDVIAGEM] = [vm].[IDVIAGEM]
            LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [a].[IDVIAGEM] = [v].[IDVIAGEM]
            LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
            WHERE [vm].[CDMOTORISTA] = @cdMotorista
              AND [a].[STATUS] IN ('PENDENTE', 'ACTIVE')
            ORDER BY [a].[CREATED_AT] DESC
            LIMIT @limit
          `);

        alertasResult.recordset.forEach(alert => {
          notificacoes.push({
            tipo: 'alerta',
            id: `alert_${alert.ID}`,
            titulo: `Alerta: ${alert.TYPE || 'Atenção'}`,
            descricao: alert.MESSAGE || 'Novo alerta na sua viagem',
            viagem: alert.IDVIAGEM,
            roteiro: alert.DSROTEIRO,
            status: alert.STATUS,
            data: alert.CREATED_AT,
            acao: `viagens.html`
          });
        });
      } catch (err) {
        console.warn('⚠️ Erro ao buscar alertas:', err.message);
      }

      // Ordenar por data (mais recente primeiro) e limitar
      notificacoes.sort((a, b) => new Date(b.data) - new Date(a.data));
      const notificacoesLimitadas = notificacoes.slice(0, parseInt(limit));

      console.log(`✅ [NOTIFICAÇÕES] ${notificacoesLimitadas.length} notificação(ões) encontrada(s)`);

      res.json({
        success: true,
        notificacoes: notificacoesLimitadas,
        total: notificacoesLimitadas.length
      });
    } catch (error) {
      console.error('❌ [NOTIFICAÇÕES] Erro:', error);
      res.status(500).json({ 
        success: false,
        error: 'Erro ao buscar notificações',
        notificacoes: []
      });
    }
  }
};

// Configurações públicas do app (telefone suporte, etc.) - sem auth
motoristaAppController.config = (req, res) => {
  try {
    const telefoneSuporte = (process.env.TELEFONE_SUPORTE || '').trim();
    res.json({
      telefoneSuporte,
      nomeApp: process.env.NOME_APP_MOTORISTA || 'Atlas Cargo'
    });
  } catch (err) {
    console.error('Erro ao obter config app motorista:', err);
    res.status(500).json({ error: 'Erro ao obter configurações.' });
  }
};

module.exports = motoristaAppController;

