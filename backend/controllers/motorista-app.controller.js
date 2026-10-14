// backend/controllers/motorista-app.controller.js
// Controller para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2026
// IMPORTANTE: Integrado com sistema existente (CADASTROGERAL, VIAGEMMESTRE, CONVOCACAO)

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const jwt = require('jsonwebtoken');
const { setCurrentToken } = require('../motorista-session');
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
const alertService = require('../services/alert-service');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { assertViagemTenantAccess } = require('../utils/viagem-tenant-access');
const {
  resolveViagemRastreamentoPg,
  vrDhOrdSql,
  insertGpsViagemRastreamento,
} = require('../services/viagem-rastreamento-pg.service');
const { normalizarPlacaBrasil } = require('../utils/placa-util');
const {
  sqlPlacasEsperadasPorViagemMotoristaParams,
  sqlDsClasseConjuntoPorViagemMotoristaParams,
  sqlCoalescePlacasEsperadasConvocacaoComSnapshot,
  sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot,
} = require('../helpers/convocacao-placas-esperadas.sql');
const {
  gravarDivergenciaPlacasSomente,
  notificarDivergenciaPlacasContratador,
} = require('../services/convocacao-placas-divergencia.service');

/** Coluna NRCNH no PostgreSQL costuma ser varchar(11): só dígitos, no máx. 11 (Brasil). */
function normalizarNrcnhMotoristaDb(nrRaw, paisDoc) {
  const t = String(nrRaw || '').trim();
  if (!t) return null;
  const p = String(paisDoc || 'BR').toUpperCase().slice(0, 2);
  if (p === 'BR') {
    const d = t.replace(/\D/g, '');
    return d.length > 0 ? d.slice(0, 11) : null;
  }
  const compact = t.replace(/\s/g, '');
  return compact.length > 0 ? compact.slice(0, 11) : null;
}

/** CDCADASTRO do motorista autenticado (JWT). */
function getMotoristaCadastroId(req) {
  const id = req.user && (req.user.cdcadastro ?? req.user.id);
  if (id == null || id === '') return NaN;
  const n = parseFloat(id);
  return Number.isFinite(n) ? n : NaN;
}

/** Evita IDOR: parâmetro de rota deve ser o mesmo motorista do token. */
function assertSameMotorista(req, res, paramId) {
  const self = getMotoristaCadastroId(req);
  const other = parseFloat(paramId);
  if (!Number.isFinite(self) || !Number.isFinite(other) || self !== other) {
    res.status(403).json({ error: 'Acesso negado.', errorKey: 'commonErrors.acessoNegado' });
    return false;
  }
  return true;
}

/** Desfaz cadastro de motorista recém-criado (ordem respeitando FKs). */
async function rollbackCadastroMotorista(pool, novoId) {
  const id = Number(novoId);
  if (!Number.isFinite(id)) return;
  const stmts = [
    ['DELETE FROM "MOTORISTA_VEICULO" WHERE "CDCADASTRO" = $1::bigint', [id]],
    ['DELETE FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1::bigint', [id]],
    ['DELETE FROM "CLASSEFROTA_CG" WHERE "CDCADASTRO" = $1::bigint', [id]],
    ['DELETE FROM "MOTORISTA_COMPLEMENTO" WHERE "CDCADASTRO" = $1::bigint', [id]],
    ['DELETE FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1::bigint', [id]],
  ];
  for (const [q, p] of stmts) {
    try {
      await pool.query(q, p);
    } catch (_) {
      /* best effort */
    }
  }
}

/**
 * Insert ou update de veículo (mesma semântica de criarVeiculoMotorista), sem enviar resposta HTTP.
 */
async function persistVeiculoMotoristaInterno(pool, opts) {
  const pathMod = require('path');
  const fs = require('fs');
  const {
    cdcadastro,
    tenantId,
    placaNormalizada,
    renavam,
    papel,
    cdClasseFrota,
    cdTipoEquipamento,
    crlvMulterFile,
    sguser,
    serverOrig,
  } = opts;
  const id = Number(cdcadastro);
  const tid = String(tenantId != null && String(tenantId).trim() !== '' ? tenantId : getDefaultTenantId()).trim();
  const norm = placaNormalizada;
  const cdTipo = cdTipoEquipamento == null || cdTipoEquipamento === '' ? null : cdTipoEquipamento;

  let fotoCrlv = null;
  if (crlvMulterFile && crlvMulterFile.path) {
    const nomeArquivo = `mv_${id}_${Date.now()}${pathMod.extname(crlvMulterFile.originalname) || '.jpg'}`;
    const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'veiculos');
    fs.mkdirSync(dir, { recursive: true });
    const dest = pathMod.join(dir, nomeArquivo);
    try {
      fs.renameSync(crlvMulterFile.path, dest);
      fotoCrlv = '/uploads/veiculos/' + nomeArquivo;
    } catch (e) {
      try {
        fs.unlinkSync(crlvMulterFile.path);
      } catch (_) {}
      const err = new Error('CRLV_SAVE');
      err.code = 'CRLV_SAVE';
      throw err;
    }
  }

  const exist = await pool.query(
    `SELECT mv."IDVEICULOMOTORISTA"
     FROM "MOTORISTA_VEICULO" mv
     INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
     WHERE mv."CDCADASTRO" = $1::numeric
       AND mv."PLACA_NORMALIZADA" = $2
       AND (mv."TENANT_ID" = $3 OR (mv."TENANT_ID" IS NULL AND cg."TENANT_ID" = $3))
       AND COALESCE(mv."FGACTIVE", 'S') = 'S'`,
    [id, norm, tid]
  );

  const sg = sguser || 'APP_MOTORISTA';
  const srv = serverOrig || 'AppMotorista';
  if (exist.rows && exist.rows.length > 0) {
    const idv = exist.rows[0].IDVEICULOMOTORISTA ?? exist.rows[0].idveiculomotorista;
    await pool.query(
      `UPDATE "MOTORISTA_VEICULO" SET
         "PLACA" = $1,
         "PLACA_NORMALIZADA" = $1,
         "RENAVAM" = $2,
         "CDTIPOEQUIPAMENTO" = $3,
         "CDCLASSEFROTA" = $4,
         "PAPEL_CONJUNTO" = $5,
         "FOTOCRLV" = COALESCE($6, "FOTOCRLV"),
         "STATUSAPROVACAO" = 'P',
         "MOTIVOREPROVACAO" = NULL,
         "DHMAINTENANCE" = CURRENT_TIMESTAMP,
         "SGUSER" = $7,
         "TENANT_ID" = COALESCE("TENANT_ID", $8::varchar)
       WHERE "IDVEICULOMOTORISTA" = $9::int`,
      [norm, renavam, cdTipo, cdClasseFrota, papel, fotoCrlv, sg, tid, idv]
    );
    return;
  }

  await pool.query(
    `INSERT INTO "MOTORISTA_VEICULO" (
      "CDCADASTRO", "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDTIPOEQUIPAMENTO", "CDCLASSEFROTA",
      "PAPEL_CONJUNTO", "FOTOCRLV", "TENANT_ID", "STATUSAPROVACAO", "FGACTIVE",
      "SGUSER", "SERVERORIG"
    ) VALUES (
      $1::numeric, $2, $3, $4, $5, $6,
      $7, $8, $9, 'P', 'S',
      $10, $11
    )`,
    [id, norm, norm, renavam, cdTipo, cdClasseFrota, papel, fotoCrlv, tid, sg, srv]
  );
}

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

/** Perfil completo (mesmo SELECT de GET perfil) para tenant com coluna TENANT_ID ou legado sem coluna. */
async function loadPerfilMotoristaApp(pool, id, tenantId) {
  const idNum = parseFloat(id);
  if (!Number.isFinite(idNum)) return null;
  const tid = tenantId != null ? String(tenantId).trim() : '';

  // PostgreSQL: identificadores entre aspas (cadastro não usa minúsculas implícitas em cg.CDCADASTRO).
  const sqlComTenant = `
    SELECT
      cg."CDCADASTRO",
      cg."CGCCPF",
      cg."RZSOCIAL",
      cg."NRCELULAR",
      cg."ENDEMAIL",
      cg."ENDERECO",
      cg."NRENDERECO",
      cg."COMPLEND",
      cg."BAIRRO",
      cg."CEP",
      cg."CDCIDADE",
      c."NMCIDADE",
      c."ESTADO",
      cg."LATITUDE",
      cg."LONGITUDE",
      cg."FGACTIVE",
      mc."NRCNH",
      mc."CATEGORIACNH",
      mc."VALIDADECNH",
      mc."FOTOCNH",
      mc."FOTOCNH_VERSO",
      mc."FOTO_COMPROVANTE_ENDERECO",
      mc."STATUSAPROVACAO"
    FROM "CADASTROGERAL" cg
    LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
    LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
    WHERE cg."CDCADASTRO" = $1
      AND (cg."FGMOTORISTA" = 'S' OR (cg."FGMOTORISTA" IS NULL AND cg."FGTIPOCADASTRO" = 'M'))
      AND cg."TENANT_ID" = $2
  `;
  const sqlSemTenant = `
    SELECT
      cg."CDCADASTRO",
      cg."CGCCPF",
      cg."RZSOCIAL",
      cg."NRCELULAR",
      cg."ENDEMAIL",
      cg."ENDERECO",
      cg."NRENDERECO",
      cg."COMPLEND",
      cg."BAIRRO",
      cg."CEP",
      cg."CDCIDADE",
      c."NMCIDADE",
      c."ESTADO",
      cg."LATITUDE",
      cg."LONGITUDE",
      cg."FGACTIVE",
      mc."NRCNH",
      mc."CATEGORIACNH",
      mc."VALIDADECNH",
      mc."FOTOCNH",
      mc."FOTOCNH_VERSO",
      mc."FOTO_COMPROVANTE_ENDERECO",
      mc."STATUSAPROVACAO"
    FROM "CADASTROGERAL" cg
    LEFT JOIN "MOTORISTA_COMPLEMENTO" mc ON cg."CDCADASTRO" = mc."CDCADASTRO"
    LEFT JOIN "CIDADE" c ON cg."CDCIDADE" = c."CDCIDADE"
    WHERE cg."CDCADASTRO" = $1
      AND (cg."FGMOTORISTA" = 'S' OR (cg."FGMOTORISTA" IS NULL AND cg."FGTIPOCADASTRO" = 'M'))
  `;

  let sqlRun = tid !== '' ? sqlComTenant : sqlSemTenant;
  let paramsRun = tid !== '' ? [idNum, tid] : [idNum];
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const result = await pool.query(sqlRun, paramsRun);
      return (result.rows && result.rows[0]) || null;
    } catch (err) {
      const msg = String((err && err.message) || '');
      if (err.code === '42703' && /tenant_id/i.test(msg) && tid !== '') {
        sqlRun = sqlSemTenant;
        paramsRun = [idNum];
        continue;
      }
      if (err.code === '42703' && /foto_comprovante_endereco/i.test(msg)) {
        sqlRun = sqlRun.replace(/\s*,\s*mc\."FOTO_COMPROVANTE_ENDERECO"\s*/gi, ' ');
        continue;
      }
      if (err.code === '42703' && /foto_cnh_verso/i.test(msg)) {
        sqlRun = sqlRun.replace(/\s*,\s*mc\."FOTOCNH_VERSO"\s*/gi, ' ');
        continue;
      }
      throw err;
    }
  }
  return null;
}

function parseValidadeCnhPerfil(raw) {
  const v = String(raw || '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return v.split('/').reverse().join('-');
  return null;
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

      const ctx = await getContexto(tenantIdForRequest(req));
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
      const sqlMotoristaComTenant = `
          SELECT 
            cg.[CDCADASTRO],
            cg.[CGCCPF],
            cg.[RZSOCIAL],
            cg.[NRCELULAR],
            cg.[ENDEMAIL],
            cg.[FGACTIVE],
            cg.[FGTIPOCADASTRO],
            cg.[TENANT_ID],
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
        `;
      const sqlMotoristaSemTenant = `
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
        `;
      try {
        try {
          result = await pool
            .request()
            .input('doc1', sql.VarChar(14), docNormalizado)
            .input('doc2', sql.VarChar(14), docAlternativo)
            .query(sqlMotoristaComTenant);
        } catch (errCol) {
          if (errCol.code === '42703') {
            result = await pool
              .request()
              .input('doc1', sql.VarChar(14), docNormalizado)
              .input('doc2', sql.VarChar(14), docAlternativo)
              .query(sqlMotoristaSemTenant);
          } else {
            throw errCol;
          }
        }
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
      const rawMt = motorista.TENANT_ID ?? motorista.tenant_id;
      const tenantId =
        rawMt != null && String(rawMt).trim() !== '' ? String(rawMt).trim() : getDefaultTenantId();
      const token = jwt.sign(
        {
          id: motorista.CDCADASTRO,
          cpf: motorista.CGCCPF,
          tipo: 'motorista',
          tenantId,
        },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const motoristaId = motorista.CDCADASTRO;
      setCurrentToken(motoristaId, token);
      console.log('✅ [LOGIN] Login realizado com sucesso! CDCADASTRO=%s', motoristaId);
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
      if (!assertSameMotorista(req, res, id)) return;

      const pool = await poolPromise;
      const row = await loadPerfilMotoristaApp(pool, parseFloat(id), tenantIdForRequest(req));
      if (!row) {
        return res.status(404).json({ error: 'Motorista não encontrado.', errorKey: 'commonErrors.motoristaNaoEncontrado' });
      }

      res.json(row);
    } catch (err) {
      console.error('Erro ao buscar perfil:', err);
      res.status(500).json({ error: 'Erro ao buscar perfil.', errorKey: 'commonErrors.erroBuscarPerfil' });
    }
  },

  /** GET /api/motorista/perfil — mesmo payload de GET /perfil/:id, usando só o JWT. */
  perfilMe: async (req, res) => {
    try {
      const id = getMotoristaCadastroId(req);
      if (!Number.isFinite(id)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const pool = await poolPromise;
      const row = await loadPerfilMotoristaApp(pool, id, tenantIdForRequest(req));
      if (!row) {
        return res.status(404).json({ error: 'Motorista não encontrado.', errorKey: 'commonErrors.motoristaNaoEncontrado' });
      }
      res.json(row);
    } catch (err) {
      console.error('Erro ao buscar perfil (me):', err);
      res.status(500).json({ error: 'Erro ao buscar perfil.', errorKey: 'commonErrors.erroBuscarPerfil' });
    }
  },

  /**
   * PUT /api/motorista/perfil ou PUT /api/motorista/perfil/:id
   * FormData: nome, ddi, ddd, celular, email, endereco, nrendereco, complend, bairro, cep, cdcidade,
   * nrCnh, categoriaCnh, validadeCnh; arquivos opcionais documento (frente), documentoVerso (verso).
   * Alteração de CNH / validade / categoria ou nova foto → STATUSAPROVACAO = P (reanálise na torre).
   */
  atualizarPerfil: async (req, res) => {
    try {
      const paramId = req.params && req.params.id;
      let idNum = paramId != null && String(paramId).trim() !== '' ? parseFloat(paramId) : getMotoristaCadastroId(req);
      if (!Number.isFinite(idNum)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      if (paramId != null && String(paramId).trim() !== '') {
        if (!assertSameMotorista(req, res, paramId)) return;
      }

      const body = req.body || {};
      const nome = (body.nome || body.rzsocial || '').trim();
      if (!nome || nome.length < 2) {
        return res.status(400).json({ error: 'Nome é obrigatório.', errorKey: 'perfil.nomeObrigatorio' });
      }

      const ddi = String(body.ddi || '55').replace(/\D/g, '');
      const ddd = String(body.ddd || '').replace(/\D/g, '');
      const numero = String(body.celular || body.numero || '').replace(/\D/g, '');
      const celularE164 = ddi + (ddd && ddi === '55' ? ddd : '') + numero;
      if (!ddi || numero.length < 8) {
        return res.status(400).json({ error: 'Celular obrigatório com DDI e número válido.', errorKey: 'cadastro.celularObrigatorio' });
      }

      const email = (body.email || body.endemail || '').trim() || null;
      const endereco = (body.endereco || '').trim();
      const complend = (body.complend || '').trim() || null;
      const bairro = (body.bairro || '').trim();
      let nrendereco = body.nrendereco;
      if (nrendereco === '' || nrendereco == null) nrendereco = 0;
      else {
        const n = parseInt(String(nrendereco).replace(/\D/g, ''), 10);
        nrendereco = Number.isFinite(n) ? n : 0;
      }

      const cepDigits = String(body.cep || '').replace(/\D/g, '');
      const cepVal = cepDigits ? parseInt(cepDigits, 10) : null;

      let cdcidade = body.cdcidade;
      if (cdcidade === '' || cdcidade == null) cdcidade = null;
      else {
        const c = parseInt(String(cdcidade), 10);
        cdcidade = Number.isFinite(c) ? c : null;
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const current = await loadPerfilMotoristaApp(pool, idNum, tid);
      if (!current) {
        return res.status(404).json({ error: 'Motorista não encontrado.', errorKey: 'commonErrors.motoristaNaoEncontrado' });
      }

      const getc = (row, k) => (row[k] != null ? row[k] : row[k && k.toLowerCase()]);
      const paisMot = String(
        getc(current, 'PAIS') || body.paisDocumento || body.pais || 'BR'
      )
        .toUpperCase()
        .slice(0, 2);
      const nrCnhRaw = (body.nrCnh || body.cnh || '').trim() || null;
      const nrCnh = normalizarNrcnhMotoristaDb(nrCnhRaw, paisMot);
      const categoriaCnh = (body.categoriaCnh || body.categoria || '').trim().slice(0, 5) || null;
      const validadeCnhParsed = parseValidadeCnhPerfil(body.validadeCnh || body.validade);

      const oldNr = String(getc(current, 'NRCNH') || '').trim();
      const oldNrNorm = normalizarNrcnhMotoristaDb(oldNr, paisMot) || '';
      const oldCat = String(getc(current, 'CATEGORIACNH') || '').trim();
      const oldValRaw = getc(current, 'VALIDADECNH');
      let oldValStr = '';
      if (oldValRaw) {
        oldValStr =
          typeof oldValRaw === 'string'
            ? oldValRaw.slice(0, 10)
            : new Date(oldValRaw).toISOString().slice(0, 10);
      }
      const oldStatus = String(getc(current, 'STATUSAPROVACAO') || 'P').trim().toUpperCase().slice(0, 1);

      const docArr = (req.files && req.files.documento) || [];
      const docVersoArr = (req.files && req.files.documentoVerso) || [];
      const compArr = (req.files && req.files.comprovanteEndereco) || [];
      const docFit = docArr[0];
      const docVersoFit = docVersoArr[0];
      const compFit = compArr[0];
      let needsReapproval = !!(docFit && docFit.path) || !!(docVersoFit && docVersoFit.path);
      const valStr = validadeCnhParsed || '';
      if (!needsReapproval) {
        if ((nrCnh || '') !== oldNrNorm) needsReapproval = true;
        if ((categoriaCnh || '') !== (oldCat || '')) needsReapproval = true;
        if (valStr !== oldValStr) needsReapproval = true;
      }

      const validadeCnhFinal =
        validadeCnhParsed != null && validadeCnhParsed !== '' ? validadeCnhParsed : oldValStr || null;

      let fotoCnhPath = getc(current, 'FOTOCNH') || null;
      if (docFit && docFit.path) {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeArquivo = `${idNum}_cnh_${Date.now()}${pathMod.extname(docFit.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        fs.mkdirSync(dir, { recursive: true });
        const dest = pathMod.join(dir, nomeArquivo);
        try {
          fs.renameSync(docFit.path, dest);
          fotoCnhPath = '/uploads/motoristas/' + nomeArquivo;
        } catch (e) {
          try {
            fs.unlinkSync(docFit.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar foto do documento.', errorKey: 'cadastro.uploadErro' });
        }
      }

      let fotoCnhVersoPath = getc(current, 'FOTOCNH_VERSO') || getc(current, 'foto_cnh_verso') || null;
      if (docVersoFit && docVersoFit.path) {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeArquivo = `${idNum}_cnh_verso_${Date.now()}${pathMod.extname(docVersoFit.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        fs.mkdirSync(dir, { recursive: true });
        const dest = pathMod.join(dir, nomeArquivo);
        try {
          fs.renameSync(docVersoFit.path, dest);
          fotoCnhVersoPath = '/uploads/motoristas/' + nomeArquivo;
        } catch (e) {
          try {
            fs.unlinkSync(docVersoFit.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar foto do verso da CNH.', errorKey: 'cadastro.uploadErro' });
        }
      }

      const oldComp = String(getc(current, 'FOTO_COMPROVANTE_ENDERECO') || getc(current, 'foto_comprovante_endereco') || '').trim();
      let fotoCompPath = oldComp || null;
      if (compFit && compFit.path) {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeArquivo = `${idNum}_comprovante_${Date.now()}${pathMod.extname(compFit.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        fs.mkdirSync(dir, { recursive: true });
        const dest = pathMod.join(dir, nomeArquivo);
        try {
          fs.renameSync(compFit.path, dest);
          fotoCompPath = '/uploads/motoristas/' + nomeArquivo;
          needsReapproval = true;
        } catch (e) {
          try {
            fs.unlinkSync(compFit.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar comprovante de endereço.', errorKey: 'cadastro.uploadErro' });
        }
      }

      const rqCg = pool.request().input('id', sql.Decimal(15, 0), idNum).input('tid', sql.NVarChar(64), tid);
      rqCg.input('rz', sql.NVarChar(200), nome);
      rqCg.input('cel', sql.NVarChar(40), celularE164);
      rqCg.input('endemail', sql.NVarChar(200), email);
      rqCg.input('endereco', sql.NVarChar(200), endereco || '');
      rqCg.input('nrend', sql.Int, nrendereco);
      rqCg.input('compl', sql.NVarChar(120), complend);
      rqCg.input('bairro', sql.NVarChar(60), bairro || '');
      rqCg.input('cep', sql.Int, cepVal == null || !Number.isFinite(cepVal) ? null : cepVal);
      rqCg.input('cdcid', sql.Int, cdcidade == null ? null : cdcidade);

      let updCg;
      try {
        updCg = await rqCg.query(`
          UPDATE [dbo].[CADASTROGERAL]
          SET
            [RZSOCIAL] = @rz,
            [NMFANTASIA] = @rz,
            [NRCELULAR] = @cel,
            [ENDEMAIL] = @endemail,
            [ENDERECO] = @endereco,
            [NRENDERECO] = @nrend,
            [COMPLEND] = @compl,
            [BAIRRO] = @bairro,
            [CEP] = @cep,
            [CDCIDADE] = @cdcid,
            [DHMAINTENANCE] = CURRENT_TIMESTAMP,
            [SGUSER] = 'APP_MOTORISTA'
          WHERE [CDCADASTRO] = @id
            AND (COALESCE([FGMOTORISTA], '') = 'S' OR (COALESCE([FGMOTORISTA], '') = '' AND [FGTIPOCADASTRO] = 'M'))
            AND [TENANT_ID] = @tid
        `);
      } catch (errUpd) {
        if (errUpd.code !== '42703') throw errUpd;
        const rqCgLegacy = pool
          .request()
          .input('id', sql.Decimal(15, 0), idNum)
          .input('rz', sql.NVarChar(200), nome)
          .input('cel', sql.NVarChar(40), celularE164)
          .input('endemail', sql.NVarChar(200), email)
          .input('endereco', sql.NVarChar(200), endereco || '')
          .input('nrend', sql.Int, nrendereco)
          .input('compl', sql.NVarChar(120), complend)
          .input('bairro', sql.NVarChar(60), bairro || '')
          .input('cep', sql.Int, cepVal == null || !Number.isFinite(cepVal) ? null : cepVal)
          .input('cdcid', sql.Int, cdcidade == null ? null : cdcidade);
        updCg = await rqCgLegacy.query(`
          UPDATE [dbo].[CADASTROGERAL]
          SET
            [RZSOCIAL] = @rz,
            [NMFANTASIA] = @rz,
            [NRCELULAR] = @cel,
            [ENDEMAIL] = @endemail,
            [ENDERECO] = @endereco,
            [NRENDERECO] = @nrend,
            [COMPLEND] = @compl,
            [BAIRRO] = @bairro,
            [CEP] = @cep,
            [CDCIDADE] = @cdcid,
            [DHMAINTENANCE] = CURRENT_TIMESTAMP,
            [SGUSER] = 'APP_MOTORISTA'
          WHERE [CDCADASTRO] = @id
            AND (COALESCE([FGMOTORISTA], '') = 'S' OR (COALESCE([FGMOTORISTA], '') = '' AND [FGTIPOCADASTRO] = 'M'))
        `);
      }

      const affectedCg = updCg.rowsAffected && updCg.rowsAffected[0];
      if (!affectedCg) {
        return res.status(404).json({ error: 'Motorista não encontrado ou sem permissão para atualizar.', errorKey: 'commonErrors.motoristaNaoEncontrado' });
      }

      const statusMc = needsReapproval ? 'P' : oldStatus;
      const rqMc = pool
        .request()
        .input('id', sql.Decimal(15, 0), idNum)
        .input('nr', sql.NVarChar(20), nrCnh)
        .input('cat', sql.NVarChar(10), categoriaCnh)
        .input('val', sql.NVarChar(30), validadeCnhFinal || '')
        .input('foto', sql.NVarChar(500), fotoCnhPath)
        .input(
          'fotoverso',
          sql.NVarChar(500),
          fotoCnhVersoPath != null ? String(fotoCnhVersoPath) : ''
        )
        .input('fotocomp', sql.NVarChar(500), fotoCompPath != null ? String(fotoCompPath) : '')
        .input('st', sql.VarChar(1), statusMc);

      let updMcSql = `
        UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
        SET
          [NRCNH] = @nr,
          [CATEGORIACNH] = @cat,
          [VALIDADECNH] = CASE WHEN TRIM(COALESCE(@val, '')) = '' THEN NULL ELSE CAST(@val AS DATE) END,
          [FOTOCNH] = @foto,
          [FOTOCNH_VERSO] = NULLIF(LTRIM(RTRIM(@fotoverso)), ''),
          [FOTO_COMPROVANTE_ENDERECO] = NULLIF(LTRIM(RTRIM(@fotocomp)), ''),
          [STATUSAPROVACAO] = @st,
          [DHMAINTENANCE] = CURRENT_TIMESTAMP,
          [SGUSER] = 'APP_MOTORISTA'
        WHERE [CDCADASTRO] = @id
      `;

      const insMcSqlFullWithVerso = `
              INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
                [CDCADASTRO], [NRCNH], [CATEGORIACNH], [VALIDADECNH], [FOTOCNH], [FOTOCNH_VERSO], [FOTO_COMPROVANTE_ENDERECO], [STATUSAPROVACAO], [SGUSER], [SERVERORIG]
              ) VALUES (
                @id, @nr, @cat,
                CASE WHEN TRIM(COALESCE(@val, '')) = '' THEN NULL ELSE CAST(@val AS DATE) END,
                @foto, NULLIF(LTRIM(RTRIM(@fotoverso)), ''), NULLIF(LTRIM(RTRIM(@fotocomp)), ''), @st, 'APP_MOTORISTA', 'AppMotorista'
              )`;

      const insMcSqlFull = `
              INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
                [CDCADASTRO], [NRCNH], [CATEGORIACNH], [VALIDADECNH], [FOTOCNH], [FOTO_COMPROVANTE_ENDERECO], [STATUSAPROVACAO], [SGUSER], [SERVERORIG]
              ) VALUES (
                @id, @nr, @cat,
                CASE WHEN TRIM(COALESCE(@val, '')) = '' THEN NULL ELSE CAST(@val AS DATE) END,
                @foto, NULLIF(LTRIM(RTRIM(@fotocomp)), ''), @st, 'APP_MOTORISTA', 'AppMotorista'
              )`;
      const insMcSqlLegacy = `
              INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
                [CDCADASTRO], [NRCNH], [CATEGORIACNH], [VALIDADECNH], [FOTOCNH], [STATUSAPROVACAO], [SGUSER], [SERVERORIG]
              ) VALUES (
                @id, @nr, @cat,
                CASE WHEN TRIM(COALESCE(@val, '')) = '' THEN NULL ELSE CAST(@val AS DATE) END,
                @foto, @st, 'APP_MOTORISTA', 'AppMotorista'
              )`;
      const updMcSqlLegacy = updMcSql.replace(
        /\s*,\s*\[FOTO_COMPROVANTE_ENDERECO\]\s*=\s*NULLIF\s*\(\s*LTRIM\s*\(\s*RTRIM\s*\(\s*@fotocomp\s*\)\s*\)\s*,\s*''\s*\)\s*/,
        ' '
      );
      const updMcSqlNoVerso = updMcSql.replace(
        /\s*,\s*\[FOTOCNH_VERSO\]\s*=\s*NULLIF\s*\(\s*LTRIM\s*\(\s*RTRIM\s*\(\s*@fotoverso\s*\)\s*\)\s*,\s*''\s*\)\s*/,
        ' '
      );

      try {
        const updMc = await rqMc.query(updMcSql);
        const affMc = updMc.rowsAffected && updMc.rowsAffected[0];
        if (!affMc) {
          try {
            await pool
              .request()
              .input('id', sql.Decimal(15, 0), idNum)
              .input('nr', sql.NVarChar(20), nrCnh)
              .input('cat', sql.NVarChar(10), categoriaCnh)
              .input('val', sql.NVarChar(30), validadeCnhFinal || '')
              .input('foto', sql.NVarChar(500), fotoCnhPath)
              .input('fotoverso', sql.NVarChar(500), fotoCnhVersoPath != null ? String(fotoCnhVersoPath) : '')
              .input('fotocomp', sql.NVarChar(500), fotoCompPath != null ? String(fotoCompPath) : '')
              .input('st', sql.VarChar(1), statusMc)
              .query(insMcSqlFullWithVerso);
          } catch (eIns) {
            if (eIns.code === '42703' && /foto_cnh_verso/i.test(String(eIns.message || ''))) {
              await pool
                .request()
                .input('id', sql.Decimal(15, 0), idNum)
                .input('nr', sql.NVarChar(20), nrCnh)
                .input('cat', sql.NVarChar(10), categoriaCnh)
                .input('val', sql.NVarChar(30), validadeCnhFinal || '')
                .input('foto', sql.NVarChar(500), fotoCnhPath)
                .input('fotocomp', sql.NVarChar(500), fotoCompPath != null ? String(fotoCompPath) : '')
                .input('st', sql.VarChar(1), statusMc)
                .query(insMcSqlFull);
            } else if (eIns.code === '42703' && /foto_comprovante_endereco/i.test(String(eIns.message || ''))) {
              await pool
                .request()
                .input('id', sql.Decimal(15, 0), idNum)
                .input('nr', sql.NVarChar(20), nrCnh)
                .input('cat', sql.NVarChar(10), categoriaCnh)
                .input('val', sql.NVarChar(30), validadeCnhFinal || '')
                .input('foto', sql.NVarChar(500), fotoCnhPath)
                .input('st', sql.VarChar(1), statusMc)
                .query(insMcSqlLegacy);
            } else throw eIns;
          }
        }
      } catch (errMc) {
        if (errMc.code === '23505') {
          return res.status(400).json({
            error: 'Número de CNH já vinculado a outro cadastro.',
            errorKey: 'perfil.cnhDuplicada',
          });
        }
        if (errMc.code === '42703' && /foto_cnh_verso/i.test(String(errMc.message || ''))) {
          const rqNv = pool
            .request()
            .input('id', sql.Decimal(15, 0), idNum)
            .input('nr', sql.NVarChar(20), nrCnh)
            .input('cat', sql.NVarChar(10), categoriaCnh)
            .input('val', sql.NVarChar(30), validadeCnhFinal || '')
            .input('foto', sql.NVarChar(500), fotoCnhPath)
            .input('fotocomp', sql.NVarChar(500), fotoCompPath != null ? String(fotoCompPath) : '')
            .input('st', sql.VarChar(1), statusMc);
          const updNv = await rqNv.query(updMcSqlNoVerso);
          const affNv = updNv.rowsAffected && updNv.rowsAffected[0];
          if (!affNv) {
            try {
              await pool
                .request()
                .input('id', sql.Decimal(15, 0), idNum)
                .input('nr', sql.NVarChar(20), nrCnh)
                .input('cat', sql.NVarChar(10), categoriaCnh)
                .input('val', sql.NVarChar(30), validadeCnhFinal || '')
                .input('foto', sql.NVarChar(500), fotoCnhPath)
                .input('fotocomp', sql.NVarChar(500), fotoCompPath != null ? String(fotoCompPath) : '')
                .input('st', sql.VarChar(1), statusMc)
                .query(insMcSqlFull);
            } catch (eInsNv) {
              if (eInsNv.code === '42703' && /foto_comprovante_endereco/i.test(String(eInsNv.message || ''))) {
                await pool
                  .request()
                  .input('id', sql.Decimal(15, 0), idNum)
                  .input('nr', sql.NVarChar(20), nrCnh)
                  .input('cat', sql.NVarChar(10), categoriaCnh)
                  .input('val', sql.NVarChar(30), validadeCnhFinal || '')
                  .input('foto', sql.NVarChar(500), fotoCnhPath)
                  .input('st', sql.VarChar(1), statusMc)
                  .query(insMcSqlLegacy);
              } else throw eInsNv;
            }
          }
        } else if (errMc.code === '42703' && /foto_comprovante_endereco/i.test(String(errMc.message || ''))) {
          const rqMc2 = pool
            .request()
            .input('id', sql.Decimal(15, 0), idNum)
            .input('nr', sql.NVarChar(20), nrCnh)
            .input('cat', sql.NVarChar(10), categoriaCnh)
            .input('val', sql.NVarChar(30), validadeCnhFinal || '')
            .input('foto', sql.NVarChar(500), fotoCnhPath)
            .input(
              'fotoverso',
              sql.NVarChar(500),
              fotoCnhVersoPath != null ? String(fotoCnhVersoPath) : ''
            )
            .input('st', sql.VarChar(1), statusMc);
          const updMc2 = await rqMc2.query(updMcSqlLegacy);
          const aff2 = updMc2.rowsAffected && updMc2.rowsAffected[0];
          if (!aff2) {
            await pool
              .request()
              .input('id', sql.Decimal(15, 0), idNum)
              .input('nr', sql.NVarChar(20), nrCnh)
              .input('cat', sql.NVarChar(10), categoriaCnh)
              .input('val', sql.NVarChar(30), validadeCnhFinal || '')
              .input('foto', sql.NVarChar(500), fotoCnhPath)
              .input('st', sql.VarChar(1), statusMc)
              .query(insMcSqlLegacy);
          }
        } else throw errMc;
      }

      const fresh = await loadPerfilMotoristaApp(pool, idNum, tid);
      res.json({
        success: true,
        message: needsReapproval
          ? 'Dados salvos. CNH, comprovante de endereço ou documento serão analisados novamente pela empresa antes de concluir a liberação.'
          : 'Perfil atualizado com sucesso.',
        errorKey: needsReapproval ? 'perfil.salvoPendenteRevisao' : 'perfil.salvoOk',
        perfil: fresh,
        pendenteReanalise: !!needsReapproval,
      });
    } catch (err) {
      console.error('Erro ao atualizar perfil:', err);
      res.status(500).json({ error: 'Erro ao atualizar perfil.', errorKey: 'perfil.erroAtualizar' });
    }
  },

  // ==========================================
  // VEÍCULOS DO MOTORISTA (app) — Fase B
  // ==========================================
  listarVeiculosMotorista: async (req, res) => {
    try {
      const id = getMotoristaCadastroId(req);
      if (!Number.isFinite(id)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);
      const pool = await poolPromise;
      const qPlain = `SELECT mv.* FROM "MOTORISTA_VEICULO" mv
           INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
           WHERE mv."CDCADASTRO" = $1::numeric
             AND (mv."TENANT_ID" = $2 OR (mv."TENANT_ID" IS NULL AND cg."TENANT_ID" = $2))
             AND COALESCE(mv."FGACTIVE", 'S') = 'S'
           ORDER BY mv."IDVEICULOMOTORISTA" DESC`;
      const qRich = `SELECT mv.*, cf."DSCLASSEFROTA" AS "ds_classe_frota" FROM "MOTORISTA_VEICULO" mv
           INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
           LEFT JOIN "CLASSEFROTA" cf ON cf."CDCLASSEFROTA" = mv."CDCLASSEFROTA"
             AND (cf."TENANT_ID" = $2 OR cf."TENANT_ID" = 'default' OR cf."TENANT_ID" IS NULL)
           WHERE mv."CDCADASTRO" = $1::numeric
             AND (mv."TENANT_ID" = $2 OR (mv."TENANT_ID" IS NULL AND cg."TENANT_ID" = $2))
             AND COALESCE(mv."FGACTIVE", 'S') = 'S'
           ORDER BY mv."IDVEICULOMOTORISTA" DESC`;
      try {
        let r;
        try {
          r = await pool.query(qRich, [id, tid]);
        } catch (e) {
          if (e.code === '42703') r = await pool.query(qPlain, [id, tid]);
          else throw e;
        }
        return res.json(r.rows || []);
      } catch (e) {
        if (e.code === '42703') {
          const r2 = await pool.query(
            `SELECT * FROM "MOTORISTA_VEICULO"
             WHERE "CDCADASTRO" = $1::numeric AND COALESCE("FGACTIVE", 'S') = 'S'
             ORDER BY "IDVEICULOMOTORISTA" DESC`,
            [id]
          );
          return res.json(r2.rows || []);
        }
        throw e;
      }
    } catch (err) {
      if (err.code === '42P01' || err.code === '42703') {
        return res.status(503).json({
          error:
            'Tabela ou colunas de veículo não disponíveis. Execute backend/scripts/adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql.',
          errorKey: 'veiculos.schemaPendente',
        });
      }
      console.error('Erro ao listar veículos do motorista:', err);
      res.status(500).json({ error: 'Erro ao listar veículos.', errorKey: 'veiculos.erroListar' });
    }
  },

  criarVeiculoMotorista: async (req, res) => {
    try {
      const id = getMotoristaCadastroId(req);
      if (!Number.isFinite(id)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);
      const body = req.body || {};
      const placaRaw = (body.placa || '').trim();
      const norm = normalizarPlacaBrasil(placaRaw);
      if (!norm) {
        return res.status(400).json({ error: 'Placa inválida (informe 7 caracteres: antiga ou Mercosul).', errorKey: 'veiculos.placaInvalida' });
      }
      const renavam = (body.renavam || '').replace(/\D/g, '').slice(0, 11) || null;
      const papel = (body.papelConjunto || body.papel || '').trim().slice(0, 20) || null;
      let cdTipo = body.cdTipoEquipamento ?? body.CDTIPOEquipamento;
      if (cdTipo === '' || cdTipo === undefined) cdTipo = null;
      else {
        const n = parseInt(String(cdTipo), 10);
        cdTipo = Number.isFinite(n) ? n : null;
      }

      let cdClasseFrota = body.cdClasseFrota ?? body.CDCLASSEFROTA;
      if (cdClasseFrota === '' || cdClasseFrota === undefined) cdClasseFrota = null;
      else {
        const nc = parseInt(String(cdClasseFrota), 10);
        cdClasseFrota = Number.isFinite(nc) && nc > 0 ? nc : null;
      }
      if (!cdClasseFrota) {
        return res.status(400).json({
          error: 'Escolha a classe de frota na lista (não digite — selecione uma opção).',
          errorKey: 'veiculos.classeObrigatoria',
        });
      }

      let fotoCrlv = null;
      if (req.file && req.file.path) {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeArquivo = `mv_${id}_${Date.now()}${pathMod.extname(req.file.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'veiculos');
        fs.mkdirSync(dir, { recursive: true });
        const dest = pathMod.join(dir, nomeArquivo);
        try {
          fs.renameSync(req.file.path, dest);
          fotoCrlv = '/uploads/veiculos/' + nomeArquivo;
        } catch (e) {
          try {
            fs.unlinkSync(req.file.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar CRLV.', errorKey: 'veiculos.uploadErro' });
        }
      }

      const pool = await poolPromise;

      const exist = await pool.query(
        `SELECT mv."IDVEICULOMOTORISTA"
         FROM "MOTORISTA_VEICULO" mv
         INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
         WHERE mv."CDCADASTRO" = $1::numeric
           AND mv."PLACA_NORMALIZADA" = $2
           AND (mv."TENANT_ID" = $3 OR (mv."TENANT_ID" IS NULL AND cg."TENANT_ID" = $3))
           AND COALESCE(mv."FGACTIVE", 'S') = 'S'`,
        [id, norm, tid]
      );

      const sg = 'APP_MOTORISTA';
      if (exist.rows && exist.rows.length > 0) {
        const idv = exist.rows[0].IDVEICULOMOTORISTA ?? exist.rows[0].idveiculomotorista;
        await pool.query(
          `UPDATE "MOTORISTA_VEICULO" SET
             "PLACA" = $1,
             "PLACA_NORMALIZADA" = $1,
             "RENAVAM" = $2,
             "CDTIPOEQUIPAMENTO" = $3,
             "CDCLASSEFROTA" = $4,
             "PAPEL_CONJUNTO" = $5,
             "FOTOCRLV" = COALESCE($6, "FOTOCRLV"),
             "STATUSAPROVACAO" = 'P',
             "MOTIVOREPROVACAO" = NULL,
             "DHMAINTENANCE" = CURRENT_TIMESTAMP,
             "SGUSER" = $7,
             "TENANT_ID" = COALESCE("TENANT_ID", $8::varchar)
           WHERE "IDVEICULOMOTORISTA" = $9::int`,
          [norm, renavam, cdTipo, cdClasseFrota, papel, fotoCrlv, sg, tid, idv]
        );
        const rUp = await pool.query(`SELECT * FROM "MOTORISTA_VEICULO" WHERE "IDVEICULOMOTORISTA" = $1::int`, [idv]);
        return res.json({
          success: true,
          message: 'Veículo atualizado e enviado novamente para análise.',
          veiculo: (rUp.rows && rUp.rows[0]) || null,
        });
      }

      const ins = await pool.query(
        `INSERT INTO "MOTORISTA_VEICULO" (
          "CDCADASTRO", "PLACA", "PLACA_NORMALIZADA", "RENAVAM", "CDTIPOEQUIPAMENTO", "CDCLASSEFROTA",
          "PAPEL_CONJUNTO", "FOTOCRLV", "TENANT_ID", "STATUSAPROVACAO", "FGACTIVE",
          "SGUSER", "SERVERORIG"
        ) VALUES (
          $1::numeric, $2, $3, $4, $5, $6,
          $7, $8, $9, 'P', 'S',
          $10, 'AppMotorista'
        )
        RETURNING *`,
        [id, norm, norm, renavam, cdTipo, cdClasseFrota, papel, fotoCrlv, tid, sg]
      );

      const row = ins.rows && ins.rows[0];
      return res.status(201).json({
        success: true,
        message: 'Veículo cadastrado. Aguarde a análise da empresa.',
        veiculo: row,
      });
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Esta placa já está cadastrada para outro registro ativo.',
          errorKey: 'veiculos.placaDuplicada',
        });
      }
      if (err.code === '42703' || err.code === '23502') {
        return res.status(503).json({
          error:
            'Estrutura de veículos não atualizada no banco. Execute adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql e, se o erro citar CDCLASSEFROTA, adicionar_motorista_veiculo_cdclassefrota_postgres.sql (pasta backend/scripts).',
          errorKey: 'veiculos.schemaPendente',
        });
      }
      console.error('Erro ao criar veículo do motorista:', err);
      res.status(500).json({ error: 'Erro ao cadastrar veículo.', errorKey: 'veiculos.erroSalvar' });
    }
  },

  // ==========================================
  // CADASTRO - Novo motorista (app na rua)
  // Recebe FormData: ddi, celular (ou ddd+numero), nome, paisDocumento, tipoDocumento, numeroDocumento,
  // nrCnh, categoriaCnh, validadeCnh, senha, documento (frente CNH, opcional), documentoVerso (verso, opcional), comprovanteEndereco (obrigatório),
  // veiculos (JSON array: placa, cdClasseFrota, renavam, papel) + arquivos opcionais veiculoCrlv_0 … veiculoCrlv_14.
  // Cadastro fica inativo (FGACTIVE I) e pendente (STATUSAPROVACAO P) até completar/validar no Gerenciar Cadastro Geral.
  // ==========================================
  cadastro: async (req, res) => {
    try {
      const body = req.body || {};
      const ddi = String(body.ddi || '').replace(/\D/g, '');
      const ddd = String(body.ddd || '').replace(/\D/g, '');
      const numero = String(body.celular || body.numero || '').replace(/\D/g, '');
      const nome = (body.nome || '').trim();
      const paisDocumento = (body.paisDocumento || body.pais || 'BR').toUpperCase().slice(0, 2);
      const tipoDocumento = (body.tipoDocumento || (paisDocumento === 'BR' ? 'CPF' : 'CI')).toUpperCase();
      const numeroDocumento = String(body.numeroDocumento || body.cpf || '').replace(/\D/g, '');
      const senha = body.senha || '';
      const nrCnh = (body.nrCnh || body.cnh || '').trim();
      const nrCnhDb = normalizarNrcnhMotoristaDb(nrCnh, paisDocumento);
      const categoriaCnh = (body.categoriaCnh || body.categoria || '').trim().slice(0, 5);
      const validadeCnh = (body.validadeCnh || body.validade || '').trim();
      const email = (body.email || '').trim() || null;
      const fgRastreado = (body.fgRastreado || body.rastreado || 'N').toString().toUpperCase().slice(0, 1) === 'S' ? 'S' : 'N';
      let locaisPreferidos = [];
      try {
        if (body.locaisPreferidos && typeof body.locaisPreferidos === 'string') locaisPreferidos = JSON.parse(body.locaisPreferidos);
        else if (Array.isArray(body.locaisPreferidos)) locaisPreferidos = body.locaisPreferidos;
      } catch (e) { locaisPreferidos = []; }
      let classesFrota = [];
      try {
        if (body.classesFrota && typeof body.classesFrota === 'string') classesFrota = JSON.parse(body.classesFrota);
        else if (Array.isArray(body.classesFrota)) classesFrota = body.classesFrota;
      } catch (e) { classesFrota = []; }
      let veiculosBody = [];
      try {
        if (body.veiculos && typeof body.veiculos === 'string') veiculosBody = JSON.parse(body.veiculos);
        else if (Array.isArray(body.veiculos)) veiculosBody = body.veiculos;
      } catch (e) {
        veiculosBody = [];
      }

      const docArr = (req.files && req.files.documento) || [];
      const docVersoArr = (req.files && req.files.documentoVerso) || [];
      const compArr = (req.files && req.files.comprovanteEndereco) || [];
      const docFile = docArr[0];
      const docVersoFile = docVersoArr[0];
      const compFile = compArr[0];
      if (!compFile || !compFile.path) {
        return res.status(400).json({
          error:
            'Envie uma foto do comprovante de endereço (conta de luz, água, gás ou correspondência com seu nome e endereço).',
          errorKey: 'cadastro.comprovanteEnderecoObrigatorio',
        });
      }
      if (!Array.isArray(classesFrota) || classesFrota.length < 1) {
        return res.status(400).json({
          error: 'Marque ao menos uma classe de frota na lista (toque nas caixinhas — não precisa digitar).',
          errorKey: 'cadastro.classeFrotaObrigatoria',
        });
      }
      if (!Array.isArray(veiculosBody) || veiculosBody.length < 1) {
        return res.status(400).json({
          error: 'Inclua ao menos um veículo (placa e classe de frota) neste cadastro.',
          errorKey: 'cadastro.veiculosObrigatorioMin1',
        });
      }
      if (veiculosBody.length > 15) {
        return res.status(400).json({
          error: 'No máximo 15 veículos por cadastro.',
          errorKey: 'cadastro.veiculosLimiteExcedido',
        });
      }
      const veiculosSan = [];
      const placasCadastroSet = new Set();
      for (let vi = 0; vi < veiculosBody.length; vi++) {
        const v = veiculosBody[vi] || {};
        const norm = normalizarPlacaBrasil(String(v.placa || '').trim());
        if (!norm) {
          return res.status(400).json({
            error: `Placa inválida no veículo ${vi + 1}. Use 7 caracteres (padrão antigo ou Mercosul).`,
            errorKey: 'veiculos.placaInvalida',
          });
        }
        if (placasCadastroSet.has(norm)) {
          return res.status(400).json({
            error: 'Há placas repetidas na lista de veículos.',
            errorKey: 'cadastro.veiculosPlacaDuplicadaLista',
          });
        }
        placasCadastroSet.add(norm);
        const nc = parseInt(v.cdClasseFrota ?? v.CDCLASSEFROTA, 10);
        if (!Number.isFinite(nc) || nc < 1) {
          return res.status(400).json({
            error: `Escolha a classe de frota no veículo ${vi + 1}.`,
            errorKey: 'veiculos.classeObrigatoria',
          });
        }
        const renavamV = String(v.renavam || '').replace(/\D/g, '').slice(0, 11) || null;
        const papelV = (v.papelConjunto || v.papel || 'CAVALO').toString().trim().slice(0, 20) || 'CAVALO';
        veiculosSan.push({ norm, renavam: renavamV, papel: papelV, cdClasseFrota: nc });
      }

      if (!ddi || numero.length < 8) {
        return res.status(400).json({ error: 'Celular obrigatório com DDI e número válido.', errorKey: 'cadastro.celularObrigatorio' });
      }
      if (!nome || nome.length < 2) {
        return res.status(400).json({ error: 'Nome do motorista é obrigatório.', errorKey: 'cadastro.nomeObrigatorio' });
      }
      if (!numeroDocumento || numeroDocumento.length < 5) {
        return res.status(400).json({ error: 'Documento (CPF/CI) é obrigatório.', errorKey: 'cadastro.documentoObrigatorio' });
      }
      if (!senha || senha.length < 6) {
        return res.status(400).json({ error: 'Senha obrigatória com no mínimo 6 caracteres.', errorKey: 'cadastro.senhaObrigatoria' });
      }

      const tipoDoc = tipoDocumento === 'CPF' || paisDocumento === 'BR' ? 'F' : 'CI';
      const validacao = validarDocumento(paisDocumento, tipoDoc, numeroDocumento);
      if (!validacao.valido) {
        return res.status(400).json({ error: validacao.mensagem || 'Documento inválido.', errorKey: 'cadastro.documentoInvalido' });
      }

      let numeroDocNormalizado = normalizarDocumento(paisDocumento, numeroDocumento);
      if (paisDocumento === 'BR' && tipoDoc === 'F' && numeroDocNormalizado.length === 10) {
        numeroDocNormalizado = '0' + numeroDocNormalizado;
      }

      const celularE164 = ddi + (ddd && paisDocumento === 'BR' ? ddd : '') + numero;
      if (celularE164.length < 10) {
        return res.status(400).json({ error: 'Número de celular inválido.', errorKey: 'cadastro.celularInvalido' });
      }

      const pool = await poolPromise;

      const checkDup = await pool.query(
        'SELECT "CDCADASTRO" FROM "CADASTROGERAL" WHERE "CGCCPF" = $1',
        [numeroDocNormalizado]
      );
      if ((checkDup.rows || []).length > 0) {
        return res.status(400).json({ error: 'Já existe um cadastro com este documento.', errorKey: 'cadastro.documentoDuplicado' });
      }

      const maxRes = await pool.query(
        'SELECT COALESCE(MAX("CDCADASTRO")::numeric, 0) AS "maxId" FROM "CADASTROGERAL"'
      );
      const novoId = Number((maxRes.rows || [])[0]?.maxId ?? 0) + 1;

      const senhaHash = await bcrypt.hash(senha, 10);

      let fotoDocPath = null;
      if (docFile && docFile.path) {
        const pathMod = require('path');
        const nomeArquivo = `${novoId}_documento${pathMod.extname(docFile.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        const fs = require('fs');
        fs.mkdirSync(dir, { recursive: true });
        const dest = pathMod.join(dir, nomeArquivo);
        try {
          fs.renameSync(docFile.path, dest);
          fotoDocPath = '/uploads/motoristas/' + nomeArquivo;
        } catch (e) {
          try {
            fs.unlinkSync(docFile.path);
          } catch (_) {}
        }
      }

      let fotoVersoPath = null;
      if (docVersoFile && docVersoFile.path) {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeV = `${novoId}_cnh_verso${pathMod.extname(docVersoFile.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        fs.mkdirSync(dir, { recursive: true });
        const destV = pathMod.join(dir, nomeV);
        try {
          fs.renameSync(docVersoFile.path, destV);
          fotoVersoPath = '/uploads/motoristas/' + nomeV;
        } catch (e) {
          try {
            fs.unlinkSync(docVersoFile.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar foto do verso da CNH.', errorKey: 'cadastro.uploadErro' });
        }
      }

      let fotoCompPath = null;
      {
        const pathMod = require('path');
        const fs = require('fs');
        const nomeComp = `${novoId}_comprovante_endereco${pathMod.extname(compFile.originalname) || '.jpg'}`;
        const dir = pathMod.join(__dirname, '..', 'public', 'uploads', 'motoristas');
        fs.mkdirSync(dir, { recursive: true });
        const destComp = pathMod.join(dir, nomeComp);
        try {
          fs.renameSync(compFile.path, destComp);
          fotoCompPath = '/uploads/motoristas/' + nomeComp;
        } catch (e) {
          try {
            fs.unlinkSync(compFile.path);
          } catch (_) {}
          return res.status(400).json({ error: 'Erro ao salvar comprovante de endereço.', errorKey: 'cadastro.uploadErro' });
        }
      }

      await pool.query(
        `INSERT INTO "CADASTROGERAL" (
          "CDCADASTRO", "CGCCPF", "RZSOCIAL", "NMFANTASIA", "FGFISICAJURIDICA",
          "ENDERECO", "NRENDERECO", "COMPLEND", "BAIRRO",
          "NRCELULAR", "ENDEMAIL", "FGACTIVE", "FGTIPOCADASTRO", "FGMOTORISTA",
          "FGOPERADOR", "FGPROGRAMADOR", "FGTRANSPORTADOR", "FGAGENTE", "FGGRUPO", "FGCERTIFICADORA", "FGUNIDADENEGOCIO",
          "FGRASTREADO", "PAIS", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
        ) VALUES ($1::bigint, $2::text, $3::text, $4::text, 'F', '', 0, NULL, '', $5::text, $6::text, 'I', 'M', 'S', 'N', 'N', 'N', 'N', 'N', 'N', 'N', $7::text, $8::text, CURRENT_TIMESTAMP, 'APP_MOTORISTA', 'AppMotorista')`,
        [
          novoId, numeroDocNormalizado, nome, nome, celularE164, email || null, fgRastreado, (paisDocumento && paisDocumento !== 'BR') ? paisDocumento : null
        ]
      );

      const validadeDate = validadeCnh && /^\d{4}-\d{2}-\d{2}$/.test(validadeCnh)
        ? validadeCnh
        : (validadeCnh && /^\d{2}\/\d{2}\/\d{4}$/.test(validadeCnh))
          ? validadeCnh.split('/').reverse().join('-')
          : null;

      const colsComp = ['"CDCADASTRO"', '"NRCNH"', '"CATEGORIACNH"', '"VALIDADECNH"', '"STATUSAPROVACAO"', '"SENHA"'];
      const valsComp = ['$1::bigint', '$2::text', '$3::text', '$4::date', '$5::text', '$6::text'];
      const paramsComp = [novoId, nrCnhDb, categoriaCnh || null, validadeDate, 'P', senhaHash];

      let nextParam = 7;
      if (fotoDocPath) {
        colsComp.push('"FOTOCNH"');
        valsComp.push(`$${nextParam}::text`);
        paramsComp.push(fotoDocPath);
        nextParam++;
      }
      if (fotoVersoPath) {
        colsComp.push('"FOTOCNH_VERSO"');
        valsComp.push(`$${nextParam}::text`);
        paramsComp.push(fotoVersoPath);
        nextParam++;
      }
      if (fotoCompPath) {
        colsComp.push('"FOTO_COMPROVANTE_ENDERECO"');
        valsComp.push(`$${nextParam}::text`);
        paramsComp.push(fotoCompPath);
        nextParam++;
      }

      try {
        await pool.query(
          `INSERT INTO "MOTORISTA_COMPLEMENTO" (${colsComp.join(', ')}) VALUES (${valsComp.join(', ')})`,
          paramsComp
        );
      } catch (eIns) {
        try {
          await pool.query('DELETE FROM "CADASTROGERAL" WHERE "CDCADASTRO" = $1::bigint', [novoId]);
        } catch (_) {}
        if (eIns.code === '42703' && /foto_comprovante_endereco/i.test(String(eIns.message || ''))) {
          return res.status(503).json({
            error:
              'Execute no banco: backend/scripts/adicionar_motorista_comprovante_endereco_postgres.sql (coluna de comprovante de endereço).',
            errorKey: 'cadastro.schemaComprovante',
          });
        }
        if (eIns.code === '42703' && /foto_cnh_verso/i.test(String(eIns.message || ''))) {
          return res.status(503).json({
            error:
              'Execute no banco: backend/scripts/adicionar_motorista_cnh_verso_postgres.sql (coluna do verso da CNH).',
            errorKey: 'cadastro.schemaCnhVerso',
          });
        }
        if (eIns.code === '22001') {
          return res.status(400).json({
            error:
              'Algum texto enviado excede o tamanho permitido no banco. Número da CNH (Brasil): use até 11 dígitos.',
            errorKey: 'cadastro.campoTextoMuitoLongo',
          });
        }
        throw eIns;
      }

      // Locais preferidos (CADASTRO_LOCAL_PREFERIDO)
      if (locaisPreferidos.length > 0) {
        const seqResult = await pool.query(
          `SELECT COALESCE(MAX("SEQUENCIA"), 0) AS "maxSeq" FROM "CADASTRO_LOCAL_PREFERIDO" WHERE "CDCADASTRO" = $1`,
          [novoId]
        );
        let nextSeq = ((seqResult.rows || [])[0]?.maxSeq ?? 0) + 1;
        for (const loc of locaisPreferidos) {
          const tipo = (loc.TIPO && String(loc.TIPO).toUpperCase().trim()) === 'D' ? 'D' : 'E';
          const pais = (loc.PAIS && String(loc.PAIS).trim()) ? String(loc.PAIS).trim().toUpperCase().substring(0, 2) : null;
          if (!pais) continue;
          const cduf = loc.CDUF != null && loc.CDUF !== '' ? parseInt(loc.CDUF, 10) : null;
          const cdm = loc.CDMESOREGIAO != null && loc.CDMESOREGIAO !== '' ? parseInt(loc.CDMESOREGIAO, 10) : null;
          await pool.query(
            `INSERT INTO "CADASTRO_LOCAL_PREFERIDO" ("CDCADASTRO", "SEQUENCIA", "TIPO", "PAIS", "CDUF", "CDMESOREGIAO", "SGUSER")
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [novoId, nextSeq, tipo, pais, isNaN(cduf) ? null : cduf, isNaN(cdm) ? null : cdm, 'APP_MOTORISTA']
          );
          nextSeq++;
        }
      }

      // Classes de frota (CLASSEFROTA_CG)
      if (classesFrota.length > 0) {
        for (const cdClasse of classesFrota) {
          const idClasse = parseInt(cdClasse, 10);
          if (isNaN(idClasse)) continue;
          try {
            await pool.query(
              `INSERT INTO "CLASSEFROTA_CG" ("CDCADASTRO", "CDCLASSEFROTA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
               VALUES ($1, $2, 'S', CURRENT_TIMESTAMP, 'APP_MOTORISTA', 'AppMotorista')`,
              [novoId, idClasse]
            );
          } catch (errClasse) {
            if (errClasse.code !== '23505') console.warn('Erro ao inserir classe frota:', errClasse.message);
          }
        }
      }

      const tidCad = tenantIdForRequest(req);
      try {
        for (let i = 0; i < veiculosSan.length; i++) {
          const vs = veiculosSan[i];
          const arr = (req.files && req.files[`veiculoCrlv_${i}`]) || [];
          const crlvF = arr[0] || null;
          await persistVeiculoMotoristaInterno(pool, {
            cdcadastro: novoId,
            tenantId: tidCad,
            placaNormalizada: vs.norm,
            renavam: vs.renavam,
            papel: vs.papel,
            cdClasseFrota: vs.cdClasseFrota,
            cdTipoEquipamento: null,
            crlvMulterFile: crlvF,
            sguser: 'APP_MOTORISTA_CADASTRO',
            serverOrig: 'AppMotoristaCadastro',
          });
        }
      } catch (veErr) {
        console.error('Erro ao gravar veículos no cadastro:', veErr);
        await rollbackCadastroMotorista(pool, novoId);
        if (veErr.code === '23505') {
          return res.status(409).json({
            error: 'Uma das placas já está cadastrada no sistema para outro motorista.',
            errorKey: 'veiculos.placaDuplicada',
          });
        }
        if (veErr.code === 'CRLV_SAVE') {
          return res.status(400).json({
            error: 'Erro ao salvar foto do CRLV de um veículo.',
            errorKey: 'veiculos.uploadErro',
          });
        }
        if (veErr.code === '42P01' || veErr.code === '42703' || veErr.code === '23502') {
          return res.status(503).json({
            error:
              'Estrutura de veículos não atualizada no banco. Execute backend/scripts/adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql (e CDCLASSEFROTA se necessário).',
            errorKey: 'veiculos.schemaPendente',
          });
        }
        return res.status(500).json({
          error: 'Erro ao salvar veículos junto com o cadastro. Tente novamente.',
          errorKey: 'cadastro.erroVeiculosPosMotorista',
        });
      }

      console.log('✅ [CADASTRO] Motorista criado:', novoId, nome, '- Pendente de aprovação (com', veiculosSan.length, 'veículo(s))');
      res.status(201).json({
        success: true,
        message:
          'Cadastro e veículos enviados com sucesso. Aguarde a validação e liberação pelo administrador.',
        CDCADASTRO: novoId,
        veiculos: veiculosSan.length,
      });
    } catch (err) {
      console.error('Erro no cadastro:', err);
      res.status(500).json({ error: 'Erro ao cadastrar. Tente novamente.', errorKey: 'cadastroErrors.erroCadastrar' });
    }
  },

  // Combo de classes de frota (PostgreSQL) para a tela de cadastro do app
  listarClassesFrotaCombo: async (req, res) => {
    try {
      const pool = await poolPromise;
      const tenantId = tenantIdForRequest(req);
      const result = await pool.query(
        `SELECT "CDCLASSEFROTA", "DSCLASSEFROTA" FROM "CLASSEFROTA"
         WHERE ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S')
           AND ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
         ORDER BY "DSCLASSEFROTA"`,
        [tenantId]
      );
      const rows = (result.rows || []).map(r => ({
        CDCLASSEFROTA: r.CDCLASSEFROTA ?? r.cdclassefrota,
        DSCLASSEFROTA: r.DSCLASSEFROTA ?? r.dsclassefrota
      }));
      res.json(rows);
    } catch (err) {
      if (err.code === '42P01') return res.json([]);
      console.error('Erro ao listar classes de frota (combo):', err);
      res.status(500).json({ error: 'Erro ao carregar classes de frota.' });
    }
  },

  // ==========================================
  // CONVOCAÇÕES - Listar convocações do motorista
  // ==========================================
  minhasConvocacoes: async (req, res) => {
    try {
      const { idmotorista } = req.params;
      if (!assertSameMotorista(req, res, idmotorista)) return;

      const pool = await poolPromise;
      // Uma linha por viagem: evita "zona" com várias CONVOCACAO duplicadas (ex.: campanhas antigas).
      // Por viagem, prioriza o registro "melhor": CONFIRMADA > ACEITA > PENDENTE > demais.
      let query = `
        SELECT * FROM (
        SELECT DISTINCT ON (c.[IDVIAGEM])
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
          c.[FGCONFIRMACAOPLACAS],
          c.[TXTPLACASDIVERGENCIA],
          c.[DHCONFIRMACAOPLACAS],
          (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
          (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO],
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
        INNER JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[TENANT_ID] = v.[TENANT_ID]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.[CDSITUACAOVIAGEM] = sv.[CDSITUACAOVIAGEM]
          AND (sv.[TENANT_ID] = @tenantId OR sv.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
          AND (tv.[TENANT_ID] = @tenantId OR tv.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
          AND (cf.[TENANT_ID] = v.[TENANT_ID] OR cf.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
          AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.[CDCONTRATADOR] = cont.[CDCADASTRO] AND cont.[TENANT_ID] = v.[TENANT_ID]
        WHERE c.[CDCADASTRO_MOTORISTA] = @idmotorista
          AND v.[TENANT_ID] = @tenantId
        ORDER BY 
          c.[IDVIAGEM],
          CASE 
            WHEN c.[STATUS] = 'CONFIRMADA' THEN 1
            WHEN c.[STATUS] = 'ACEITA' THEN 2
            WHEN c.[STATUS] = 'PENDENTE' THEN 3
            ELSE 4
          END,
          c.[DHCONVOCACAO] DESC,
          c.[IDCONVOCACAO] DESC
        ) conv_um_por_viagem
        ORDER BY 
          CASE 
            WHEN conv_um_por_viagem.[STATUS] = 'PENDENTE' THEN 1
            WHEN conv_um_por_viagem.[STATUS] = 'ACEITA' THEN 2
            WHEN conv_um_por_viagem.[STATUS] = 'CONFIRMADA' THEN 3
            ELSE 4
          END,
          conv_um_por_viagem.[DHCONVOCACAO] DESC
      `;

      const result = await pool
        .request()
        .input('idmotorista', sql.Decimal(15, 0), parseFloat(idmotorista))
        .input('tenantId', sql.NVarChar(64), tenantIdForRequest(req))
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
      if (err.code === '42703') {
        return res.status(503).json({
          error: 'Base sem colunas de confirmação de placas na convocação. Execute o script SQL de migração.',
          errorKey: 'convocacao.listaConvocacoesSchemaPendente',
        });
      }
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
      const idMot = getMotoristaCadastroId(req);
      if (!Number.isFinite(idMot)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);

      let placasObrigatorias = false;
      let placasEsperadasGate = '';
      let conjuntoClasseGate = '';
      try {
        const pre = await pool
          .request()
          .input('id', sql.Int, parseInt(id, 10))
          .input('mot', sql.Decimal(15, 0), idMot)
          .input('tenantId', sql.NVarChar(64), tid)
          .query(`
            SELECT
              UPPER(TRIM(COALESCE(c.[STATUS], ''))) AS [STATUS],
              c.[FGCONFIRMACAOPLACAS] AS [FG],
              (${sqlCoalescePlacasEsperadasConvocacaoComSnapshot()}) AS [PLACASESPERADAS],
              (${sqlCoalesceDsClasseConjuntoConvocacaoComSnapshot()}) AS [DSCLASSEFROTA_CONJUNTO]
            FROM [dbo].[CONVOCACAO] AS c
            WHERE c.[IDCONVOCACAO] = @id
              AND c.[CDCADASTRO_MOTORISTA] = @mot
              AND c.[TENANT_ID] = @tenantId
          `);
        const preRow = pre.recordset && pre.recordset[0];
        if (!preRow) {
          return res.status(404).json({ error: 'Convocação não encontrada ou sem permissão.' });
        }
        const stPre = String(preRow.STATUS ?? preRow.status ?? '').trim();
        if (stPre === 'CONFIRMADA' || stPre === 'ACEITA_DESCARTADA') {
          return res.status(409).json({
            error:
              'Esta convocação já foi definida pela torre (confirmada ou não selecionada). Atualize a lista no app.',
            errorKey: 'convocacao.definidaNaTorre',
            statusAtual: stPre,
          });
        }
        placasEsperadasGate = String(preRow.PLACASESPERADAS ?? preRow.placasesperadas ?? '').trim();
        conjuntoClasseGate = String(
          preRow.DSCLASSEFROTA_CONJUNTO ?? preRow.dsclassefrota_conjunto ?? ''
        ).trim();
        const fgPre = String(preRow.FG ?? preRow.fgconfirmacaoplacas ?? '').trim().toUpperCase();
        if (stPre === 'PENDENTE' && fgPre === 'D') {
          return res.status(422).json({
            error:
              'Não é possível aceitar: já foi registrada divergência de placas. Aguarde o alinhamento pela transportadora ou recuse a convocação.',
            errorKey: 'convocacao.aceiteBloqueadoDivergenciaPlacas',
            divergenciaRegistrada: true,
            aceiteBloqueadoDivergenciaPlacas: true,
          });
        }
        placasObrigatorias =
          stPre === 'PENDENTE' &&
          (placasEsperadasGate.length > 0 || conjuntoClasseGate.length > 0) &&
          !fgPre;
      } catch (preErr) {
        if (preErr.code === '42703') {
          return res.status(503).json({
            error: 'Base sem colunas de confirmação de placas. Execute o script SQL de migração.',
            errorKey: 'convocacao.confirmacaoPlacasSchemaPendente',
          });
        }
        throw preErr;
      }
      if (placasObrigatorias) {
        return res.status(422).json({
          error: 'Confirme as placas e/ou o conjunto (classe) da viagem antes de aceitar.',
          errorKey: 'convocacao.confirmarPlacasObrigatorio',
          precisaConfirmarPlacas: true,
          placasEsperadas: placasEsperadasGate,
          classeConjuntoEsperada: conjuntoClasseGate,
        });
      }

      // Atualizar status para ACEITA — só se a convocação for deste motorista e tenant
      const upd = await pool
        .request()
        .input('id', sql.Int, parseInt(id, 10))
        .input('mot', sql.Decimal(15, 0), idMot)
        .input('tenantId', sql.NVarChar(64), tid)
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
            AND [CDCADASTRO_MOTORISTA] = @mot
            AND [TENANT_ID] = @tenantId
            AND UPPER(TRIM(COALESCE([STATUS],''))) NOT IN ('CONFIRMADA', 'ACEITA_DESCARTADA')
        `);

      let affected = upd.rowsAffected && upd.rowsAffected[0];
      if (!affected) {
        const chk = await pool
          .request()
          .input('id', sql.Int, parseInt(id, 10))
          .input('mot', sql.Decimal(15, 0), idMot)
          .input('tenantId', sql.NVarChar(64), tid)
          .query(`
            SELECT UPPER(TRIM(COALESCE([STATUS],''))) AS [STATUS]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDCONVOCACAO] = @id
              AND [CDCADASTRO_MOTORISTA] = @mot
              AND [TENANT_ID] = @tenantId
          `);
        const row = chk.recordset && chk.recordset[0];
        if (!row) {
          return res.status(404).json({ error: 'Convocação não encontrada ou sem permissão.' });
        }
        const st = String(row.STATUS ?? row.status ?? '').trim();
        if (st === 'CONFIRMADA' || st === 'ACEITA_DESCARTADA') {
          return res.status(409).json({
            error:
              'Esta convocação já foi definida pela torre (confirmada ou não selecionada). Atualize a lista no app.',
            errorKey: 'convocacao.definidaNaTorre',
            statusAtual: st
          });
        }
        return res.status(409).json({ error: 'Não foi possível aceitar esta convocação agora. Atualize e tente novamente.' });
      }

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
      const idMot = getMotoristaCadastroId(req);
      if (!Number.isFinite(idMot)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);

      const upd = await pool
        .request()
        .input('id', sql.Int, parseInt(id, 10))
        .input('mot', sql.Decimal(15, 0), idMot)
        .input('tenantId', sql.NVarChar(64), tid)
        .input('motivo', sql.Int, motivo || null)
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET 
            [STATUS] = 'RECUSADA',
            [DHRESPOSTA] = CURRENT_TIMESTAMP,
            [CDMOTIVORECUSA] = @motivo
          WHERE [IDCONVOCACAO] = @id
            AND [CDCADASTRO_MOTORISTA] = @mot
            AND [TENANT_ID] = @tenantId
            AND UPPER(TRIM(COALESCE([STATUS],''))) NOT IN ('CONFIRMADA', 'ACEITA_DESCARTADA')
        `);

      let affected = upd.rowsAffected && upd.rowsAffected[0];
      if (!affected) {
        const chk = await pool
          .request()
          .input('id', sql.Int, parseInt(id, 10))
          .input('mot', sql.Decimal(15, 0), idMot)
          .input('tenantId', sql.NVarChar(64), tid)
          .query(`
            SELECT UPPER(TRIM(COALESCE([STATUS],''))) AS [STATUS]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDCONVOCACAO] = @id
              AND [CDCADASTRO_MOTORISTA] = @mot
              AND [TENANT_ID] = @tenantId
          `);
        const row = chk.recordset && chk.recordset[0];
        if (!row) {
          return res.status(404).json({ error: 'Convocação não encontrada ou sem permissão.' });
        }
        const st = String(row.STATUS ?? row.status ?? '').trim();
        if (st === 'CONFIRMADA' || st === 'ACEITA_DESCARTADA') {
          return res.status(409).json({
            error:
              'Esta convocação já foi definida pela torre (confirmada ou não selecionada). Atualize a lista no app.',
            errorKey: 'convocacao.definidaNaTorre',
            statusAtual: st
          });
        }
        return res.status(409).json({ error: 'Não foi possível recusar esta convocação agora. Atualize e tente novamente.' });
      }

      res.json({ success: true, message: 'Convocação recusada.' });
    } catch (err) {
      console.error('Erro ao recusar convocação:', err);
      res.status(500).json({ error: 'Erro ao recusar convocação.' });
    }
  },

  // ==========================================
  // CONVOCAÇÃO — confirmação de placas (VIAGEMVEICULO) antes / além do aceite
  // ==========================================
  confirmarPlacasConvocacao: async (req, res) => {
    try {
      const { id } = req.params;
      const modoRaw = (req.body && req.body.modo) || '';
      const modo = String(modoRaw).trim().toUpperCase();
      if (modo !== 'CONFIRMA' && modo !== 'DIVERGE') {
        return res.status(400).json({
          error: 'Informe modo CONFIRMA ou DIVERGE.',
          errorKey: 'convocacao.modoConfirmacaoPlacasInvalido',
        });
      }

      const pool = await poolPromise;
      const idMot = getMotoristaCadastroId(req);
      if (!Number.isFinite(idMot)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);
      const idConv = parseInt(id, 10);

      if (modo === 'DIVERGE') {
        const texto = String((req.body && req.body.texto) || '').trim().slice(0, 2000);
        if (!texto) {
          return res.status(400).json({
            error: 'Informe a descrição da divergência das placas.',
            errorKey: 'convocacao.textoDivergenciaPlacasObrigatorio',
          });
        }
        let vlFretePropApp = null;
        const rVo = req.body && (req.body.vlFretePropostoMotorista ?? req.body.valorFretePropostoMotorista);
        if (rVo !== undefined && rVo !== null && String(rVo).trim() !== '') {
          let s = String(rVo).trim().replace(/\s/g, '').replace(/[^\d.,-]/g, '');
          if (/,/.test(s) && /\./.test(s)) s = s.replace(/\./g, '').replace(',', '.');
          else if (/,/.test(s)) s = s.replace(',', '.');
          const n = parseFloat(s);
          if (Number.isFinite(n) && n >= 0 && n <= 999999999.99) vlFretePropApp = Math.round(n * 100) / 100;
        }
        let nomeMotorista = '';
        try {
          const nm = await pool
            .request()
            .input('id', sql.Int, idConv)
            .input('mot', sql.Decimal(15, 0), idMot)
            .input('tenantId', sql.NVarChar(64), tid)
            .query(`
              SELECT upper(TRIM(COALESCE(cg.[RZSOCIAL], ''))) AS [NM]
              FROM [dbo].[CONVOCACAO] c
              INNER JOIN [dbo].[CADASTROGERAL] cg ON c.[CDCADASTRO_MOTORISTA] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
              WHERE c.[IDCONVOCACAO] = @id AND c.[CDCADASTRO_MOTORISTA] = @mot AND c.[TENANT_ID] = @tenantId
            `);
          const rowNm = nm.recordset && nm.recordset[0];
          nomeMotorista = rowNm ? String(rowNm.NM ?? rowNm.nm ?? '').trim() : '';
        } catch (_) {
          nomeMotorista = '';
        }
        let nGrav = 0;
        try {
          nGrav = await gravarDivergenciaPlacasSomente(pool, {
            idConvocacao: idConv,
            tenantId: tid,
            texto,
            cdCadastroMotorista: idMot,
            sgUserGravacao: 'MOTORISTA',
            vlFretePropostoMotorista: vlFretePropApp,
          });
          if (nGrav > 0) {
            await notificarDivergenciaPlacasContratador(pool, req, {
              idConvocacao: idConv,
              tenantId: tid,
              textoDivergencia: texto,
              nomeMotorista,
            });
          }
        } catch (divErr) {
          console.error('[CONFIRMAR PLACAS APP] divergência:', divErr);
          return res.status(500).json({ error: 'Não foi possível registrar a divergência. Tente novamente.' });
        }
        if (!nGrav) {
          const chk = await pool
            .request()
            .input('id', sql.Int, idConv)
            .input('mot', sql.Decimal(15, 0), idMot)
            .input('tenantId', sql.NVarChar(64), tid)
            .query(`
              SELECT UPPER(TRIM(COALESCE([STATUS], ''))) AS [STATUS]
              FROM [dbo].[CONVOCACAO]
              WHERE [IDCONVOCACAO] = @id
                AND [CDCADASTRO_MOTORISTA] = @mot
                AND [TENANT_ID] = @tenantId
            `);
          const row = chk.recordset && chk.recordset[0];
          if (!row) {
            return res.status(404).json({ error: 'Convocação não encontrada ou sem permissão.' });
          }
          const st = String(row.STATUS ?? row.status ?? '').trim();
          if (st !== 'PENDENTE') {
            return res.status(409).json({
              error: 'Só é possível registrar divergência em convocação pendente.',
              errorKey: 'convocacao.confirmacaoPlacasStatusInvalido',
              statusAtual: st,
            });
          }
          return res.status(409).json({ error: 'Não foi possível registrar agora. Atualize e tente novamente.' });
        }
        return res.json({
          success: true,
          FGCONFIRMACAOPLACAS: 'D',
          aceiteBloqueadoDivergenciaPlacas: true,
          divergenciaRegistrada: true,
        });
      }

      const upd = await pool
        .request()
        .input('id', sql.Int, idConv)
        .input('mot', sql.Decimal(15, 0), idMot)
        .input('tenantId', sql.NVarChar(64), tid)
        .input('fg', sql.NVarChar(1), 'C')
        .input('txt', sql.NVarChar(4000), '')
        .query(`
          UPDATE [dbo].[CONVOCACAO]
          SET
            [FGCONFIRMACAOPLACAS] = @fg,
            [TXTPLACASDIVERGENCIA] = NULL,
            [DHCONFIRMACAOPLACAS] = CURRENT_TIMESTAMP
          WHERE [IDCONVOCACAO] = @id
            AND [CDCADASTRO_MOTORISTA] = @mot
            AND [TENANT_ID] = @tenantId
            AND UPPER(TRIM(COALESCE([STATUS], ''))) = 'PENDENTE'
        `);

      const affected = upd.rowsAffected && upd.rowsAffected[0];
      if (!affected) {
        const chk = await pool
          .request()
          .input('id', sql.Int, idConv)
          .input('mot', sql.Decimal(15, 0), idMot)
          .input('tenantId', sql.NVarChar(64), tid)
          .query(`
            SELECT UPPER(TRIM(COALESCE([STATUS], ''))) AS [STATUS]
            FROM [dbo].[CONVOCACAO]
            WHERE [IDCONVOCACAO] = @id
              AND [CDCADASTRO_MOTORISTA] = @mot
              AND [TENANT_ID] = @tenantId
          `);
        const row = chk.recordset && chk.recordset[0];
        if (!row) {
          return res.status(404).json({ error: 'Convocação não encontrada ou sem permissão.' });
        }
        const st = String(row.STATUS ?? row.status ?? '').trim();
        if (st !== 'PENDENTE') {
          return res.status(409).json({
            error: 'Só é possível registrar confirmação de placas em convocação pendente.',
            errorKey: 'convocacao.confirmacaoPlacasStatusInvalido',
            statusAtual: st,
          });
        }
        return res.status(409).json({ error: 'Não foi possível registrar agora. Atualize e tente novamente.' });
      }

      res.json({ success: true, FGCONFIRMACAOPLACAS: 'C' });
    } catch (err) {
      if (err.code === '42703') {
        return res.status(503).json({
          error: 'Base sem colunas de confirmação de placas. Execute o script SQL de migração.',
          errorKey: 'convocacao.confirmacaoPlacasSchemaPendente',
        });
      }
      console.error('Erro ao confirmar placas da convocação:', err);
      res.status(500).json({ error: 'Erro ao registrar confirmação de placas.' });
    }
  },

  // ==========================================
  // GPS - Registrar posição
  // ==========================================
  // ==========================================
  // CARGAS DISPONÍVEIS - Listar viagens abertas para o motorista aceitar
  // Regra: Preparação ou Programada; FGACTIVE ativo ('A' ou 'S');
  // Compatibilidade: algumas bases usam FGSITVIAGEM legado ('D','P'), outras variam e dependem do texto da situação.
  //        sem convocação CONFIRMADA ou ACEITA (viagem ainda disponível).
  //        Nota: viagens criadas pelo Gerenciar Viagens gravam FGACTIVE = 'A'.
  // ==========================================
  cargasDisponiveis: async (req, res) => {
    try {
      const { estado, distanciaMax, freteMin, idmotorista, pais, regiao } = req.query;

      const idMotNum = getMotoristaCadastroId(req);
      if (!Number.isFinite(idMotNum)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      if (idmotorista != null && String(idmotorista).trim() !== '' && parseFloat(idmotorista) !== idMotNum) {
        return res.status(403).json({ error: 'Acesso negado.', errorKey: 'commonErrors.acessoNegado' });
      }

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
          (SELECT COUNT(*) FROM [dbo].[CONVOCACAO] cx WHERE cx.[IDVIAGEM] = v.[IDVIAGEM] AND cx.[TENANT_ID] = v.[TENANT_ID]) AS TOTAL_CONVOCACOES
        FROM [dbo].[VIAGEMMESTRE] v
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.[CDSITUACAOVIAGEM] = sv.[CDSITUACAOVIAGEM]
          AND (sv.[TENANT_ID] = @tenantId OR sv.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] tv ON v.[CDTIPOVIAGEM] = tv.[CDTIPOVIAGEM]
          AND (tv.[TENANT_ID] = @tenantId OR tv.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] cf ON v.[CDCLASSEFROTA] = cf.[CDCLASSEFROTA]
          AND (cf.[TENANT_ID] = v.[TENANT_ID] OR cf.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
          AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] co ON r.[CDCIDADEORIGEM] = co.[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON r.[CDCIDADEDESTINO] = cd.[CDCIDADE]
        LEFT JOIN [dbo].[PAIS] po ON co.[CDPAIS] = po.[CDPAIS]
        LEFT JOIN [dbo].[PAIS] pd ON cd.[CDPAIS] = pd.[CDPAIS]
        LEFT JOIN [dbo].[CADASTROGERAL] cont ON v.[CDCONTRATADOR] = cont.[CDCADASTRO] AND cont.[TENANT_ID] = v.[TENANT_ID]
        WHERE (
            v.[FGSITVIAGEM] IN ('D', 'P')
            OR UPPER(COALESCE(sv.[DSSITUACAOVIAGEM], '')) LIKE '%PREPAR%'
            OR UPPER(COALESCE(sv.[DSSITUACAOVIAGEM], '')) LIKE '%PROGRAM%'
          )
          AND (v.[FGACTIVE] = 'S' OR v.[FGACTIVE] = 'A')
          AND NOT EXISTS (
            SELECT 1 FROM [dbo].[CONVOCACAO] cx
            WHERE cx.[IDVIAGEM] = v.[IDVIAGEM]
            AND cx.[TENANT_ID] = v.[TENANT_ID]
            AND cx.[STATUS] IN ('CONFIRMADA', 'ACEITA')
          )
          AND v.[TENANT_ID] = @tenantId
      `;

      const params = [{ name: 'tenantId', value: tenantIdForRequest(req) }];

      if (estado) {
        query += ` AND (co.[ESTADO] = @estado OR cd.[ESTADO] = @estado)`;
        params.push({ name: 'estado', value: estado });
      }

      if (pais && String(pais).trim() !== '') {
        const paisSigla = String(pais).trim().toUpperCase().substring(0, 2);
        query += ` AND (po.[SGPAIS] = @pais OR pd.[SGPAIS] = @pais)`;
        params.push({ name: 'pais', value: paisSigla });
      }

      if (regiao != null && String(regiao).trim() !== '') {
        const regiaoVal = isNaN(Number(regiao)) ? regiao : Number(regiao);
        query += ` AND (co.[CDMESOREGIAO] = @regiao OR cd.[CDMESOREGIAO] = @regiao)`;
        params.push({ name: 'regiao', value: regiaoVal });
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

      let recordset = (await request.query(query)).recordset || [];

      // POD_ACEITAR: motorista só pode aceitar se tiver a classe de frota da viagem (evita subquery complexa no PG)
      if (recordset.length > 0 && idMotNum != null) {
        let idsCompativeis = [];
        try {
          const comp = await pool.request()
            .input('idmotorista', idMotNum)
            .query(`
              SELECT v.[IDVIAGEM]
              FROM [dbo].[VIAGEMMESTRE] v
              LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.[CDSITUACAOVIAGEM] = sv.[CDSITUACAOVIAGEM]
                AND (sv.[TENANT_ID] = v.[TENANT_ID] OR sv.[TENANT_ID] = 'default')
              INNER JOIN [dbo].[CLASSEFROTA_CG] ccf
                ON ccf.[CDCADASTRO] = @idmotorista AND ccf.[CDCLASSEFROTA] = v.[CDCLASSEFROTA]
                AND (ccf.[FGACTIVE] = 'S' OR ccf.[FGACTIVE] = 'A')
              WHERE (
                  v.[FGSITVIAGEM] IN ('D', 'P')
                  OR UPPER(COALESCE(sv.[DSSITUACAOVIAGEM], '')) LIKE '%PREPAR%'
                  OR UPPER(COALESCE(sv.[DSSITUACAOVIAGEM], '')) LIKE '%PROGRAM%'
                )
                AND (v.[FGACTIVE] = 'S' OR v.[FGACTIVE] = 'A')
            `);
          idsCompativeis = (comp.recordset || []).map(r => r.IDVIAGEM ?? r.idviagem);
        } catch (errClasse) {
          console.warn('Cargas: não foi possível verificar classes (CLASSEFROTA_CG); POD_ACEITAR = 0 para todos.', errClasse.message);
        }
        const setCompativeis = new Set(idsCompativeis.map(String));
        recordset = recordset.map(r => ({
          ...r,
          POD_ACEITAR: setCompativeis.has(String(r.IDVIAGEM ?? r.idviagem)) ? 1 : 0
        }));
      } else {
        recordset = recordset.map(r => ({ ...r, POD_ACEITAR: 0 }));
      }

      res.json(recordset);
    } catch (err) {
      console.error('Erro ao listar cargas disponíveis:', err);
      res.status(500).json({ error: 'Erro ao buscar cargas.', detalhe: process.env.NODE_ENV !== 'production' ? err.message : undefined });
    }
  },

  // ==========================================
  // ACEITAR CARGA - Cria convocação
  // ==========================================
  aceitarCarga: async (req, res) => {
    try {
      const { idviagem } = req.params;
      const { latitude, longitude } = req.body;

      const pool = await poolPromise;
      const idMotNum = getMotoristaCadastroId(req);
      if (!Number.isFinite(idMotNum)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }

      // Buscar dados do motorista e da viagem (classe de frota)
      const [motorista, viagem] = await Promise.all([
        pool.request().input('id', sql.Decimal(15, 0), idMotNum)
          .query(`SELECT NRCELULAR FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @id`),
        pool.request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .input('tid', sql.NVarChar(64), tenantIdForRequest(req))
          .query(`SELECT [CDCLASSEFROTA] FROM [dbo].[VIAGEMMESTRE] WHERE [IDVIAGEM] = @idviagem AND [TENANT_ID] = @tid`)
      ]);

      if (motorista.recordset.length === 0) {
        return res.status(404).json({ error: 'Motorista não encontrado.' });
      }
      if (viagem.recordset.length === 0) {
        return res.status(404).json({ error: 'Viagem não encontrada.' });
      }

      const cdClasseFrota = viagem.recordset[0].CDCLASSEFROTA ?? viagem.recordset[0].cdclassefrota;
      if (cdClasseFrota != null) {
        const compat = await pool.request()
          .input('id', sql.Decimal(15, 0), idMotNum)
          .input('classe', cdClasseFrota)
          .query(`
            SELECT 1 FROM [dbo].[CLASSEFROTA_CG]
            WHERE [CDCADASTRO] = @id AND [CDCLASSEFROTA] = @classe
            AND ([FGACTIVE] = 'S' OR [FGACTIVE] = 'A')
          `);
        if (!compat.recordset || compat.recordset.length === 0) {
          return res.status(400).json({
            error: 'Você não possui a classe de frota necessária para esta viagem. Não é possível aceitar esta carga.'
          });
        }
      }

      const celular = motorista.recordset[0].NRCELULAR;

      // Criar convocação
      await pool
        .request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('cdcadastro', sql.Decimal(15, 0), idMotNum)
        .input('celular', sql.Decimal(15, 0), celular)
        .input('latitude', sql.Float, latitude || null)
        .input('longitude', sql.Float, longitude || null)
        .input('TENANT_ID', tenantIdForRequest(req))
        .query(`
          INSERT INTO [dbo].[CONVOCACAO] (
            IDVIAGEM, CDCADASTRO_MOTORISTA, STATUS, DHCONVOCACAO,
            NRCELULAR, TXTCONVOCACAO, LATITUDE, LONGITUDE, SGUSUARIO_OPERADOR, TENANT_ID,
            TXT_PLACAS_SNAPSHOT, TXT_CLASSES_CONJ_SNAPSHOT
          )
          VALUES (
            @idviagem, @cdcadastro, 'ACEITA', GETDATE(),
            @celular, 'Carga aceita pelo motorista via APP', @latitude, @longitude, 'APP_MOTORISTA', @TENANT_ID,
            (${sqlPlacasEsperadasPorViagemMotoristaParams({ tenant: '@TENANT_ID', viagem: '@idviagem', motorista: '@cdcadastro' })}),
            (${sqlDsClasseConjuntoPorViagemMotoristaParams({ tenant: '@TENANT_ID', viagem: '@idviagem', motorista: '@cdcadastro' })})
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

      if (!assertSameMotorista(req, res, cdMotorista)) return;

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
      request.input('TENANT_ID', tenantIdForRequest(req));

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
        INNER JOIN [dbo].[CADASTROGERAL] [C] ON [M].[CDMOTORISTA] = [C].[CDCADASTRO] AND [C].[TENANT_ID] = [V].[TENANT_ID]
        LEFT JOIN [dbo].[SITUACAOVIAGEM] [S] ON [V].[CDSITUACAOVIAGEM] = [S].[CDSITUACAOVIAGEM]
          AND ([S].[TENANT_ID] = [V].[TENANT_ID] OR [S].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[TIPOVIAGEM] [T] ON [V].[CDTIPOVIAGEM] = [T].[CDTIPOVIAGEM]
          AND ([T].[TENANT_ID] = @TENANT_ID OR [T].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CLASSEFROTA] [F] ON [V].[CDCLASSEFROTA] = [F].[CDCLASSEFROTA]
          AND ([F].[TENANT_ID] = [V].[TENANT_ID] OR [F].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[ROTEIRO] [R] ON [V].[IDROTEIRO] = [R].[IDROTEIRO]
          AND ([R].[TENANT_ID] = @TENANT_ID OR [R].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CADASTROGERAL] [P] ON [V].[CDCONTRATADOR] = [P].[CDCADASTRO] AND [P].[TENANT_ID] = [V].[TENANT_ID]
        LEFT JOIN [dbo].[CIDADE] [CO_ORIGEM] ON [R].[CDCIDADEORIGEM] = [CO_ORIGEM].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [CD_DESTINO] ON [R].[CDCIDADEDESTINO] = [CD_DESTINO].[CDCIDADE]
        WHERE [V].[FGSITVIAGEM] NOT IN ('C', 'F', 'E')
          AND [M].[CDMOTORISTA] = @cdMotorista
          AND [V].[TENANT_ID] = @TENANT_ID
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
      const cdMot = getMotoristaCadastroId(req);
      if (!Number.isFinite(cdMot)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      const tid = tenantIdForRequest(req);

      const result = await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .input('cdMot', sql.Decimal(15, 0), cdMot)
        .input('tid', sql.NVarChar(64), tid)
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
            AND (R.[TENANT_ID] = @tid OR R.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] CO_ORIGEM ON R.[CDCIDADEORIGEM] = CO_ORIGEM.[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] CD_DESTINO ON R.[CDCIDADEDESTINO] = CD_DESTINO.[CDCIDADE]
          LEFT JOIN [dbo].[SITUACAOVIAGEM] S ON V.[CDSITUACAOVIAGEM] = S.[CDSITUACAOVIAGEM]
            AND (S.[TENANT_ID] = V.[TENANT_ID] OR S.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[TIPOVIAGEM] T ON V.[CDTIPOVIAGEM] = T.[CDTIPOVIAGEM]
            AND (T.[TENANT_ID] = @tid OR T.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CLASSEFROTA] F ON V.[CDCLASSEFROTA] = F.[CDCLASSEFROTA]
            AND (F.[TENANT_ID] = V.[TENANT_ID] OR F.[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CADASTROGERAL] P ON V.[CDCONTRATADOR] = P.[CDCADASTRO] AND P.[TENANT_ID] = V.[TENANT_ID]
          INNER JOIN [dbo].[VIAGEMMOTORISTA] VM ON V.[IDVIAGEM] = VM.[IDVIAGEM] AND VM.[CDMOTORISTA] = @cdMot
          LEFT JOIN [dbo].[CADASTROGERAL] M ON VM.[CDMOTORISTA] = M.[CDCADASTRO] AND M.[TENANT_ID] = V.[TENANT_ID]
          WHERE V.[IDVIAGEM] = @idViagem AND V.[TENANT_ID] = @tid
        `);

      if (result.recordset.length === 0) {
        console.warn(`⚠️ [VIAGEM] Viagem ${idViagem} não encontrada ou não atribuída a este motorista`);
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
      const tid = tenantIdForRequest(req);

      const result = await pool.query(
        `
        SELECT 
          "CDTIPOOCORRENCIA",
          "DSTIPOOCORRENCIA",
          "CDEDIPADRAO",
          "FGSITUACAO",
          "SEQ",
          CASE "FGSITUACAO"
            WHEN 'T' THEN 'TRÂNSITO'
            WHEN 'C' THEN 'CARREGAMENTO'
            WHEN 'D' THEN 'DESCARGA'
            WHEN 'P' THEN 'PARADA'
          END AS "SITUACAO_TEXTO"
        FROM "TIPOOCORRENCIA"
        WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
        ORDER BY 
          CASE "FGSITUACAO"
            WHEN 'T' THEN 1
            WHEN 'C' THEN 2
            WHEN 'D' THEN 3
            WHEN 'P' THEN 4
            ELSE 5
          END,
          "SEQ",
          "CDTIPOOCORRENCIA"
      `,
        [tid]
      );

      const rows = result.rows || [];

      // Ícones por FGSITUACAO + SEQ (compatível com códigos 1-14 e antigos)
      const getIcon = (m) => {
        const s = (m.FGSITUACAO || m.fgsituacao || '').toUpperCase();
        const seq = m.SEQ != null ? m.SEQ : m.seq;
        if (s === 'T') return seq === 2 ? '🔄' : '🚚';  // Reinício vs Início
        if (s === 'F') return '🏁';
        if (s === 'C') return seq === 1 ? '📍' : seq === 2 ? '📦' : '✅';  // Chegada / Início / Fim
        if (s === 'D') return seq === 1 ? '📍' : seq === 2 ? '📤' : '✅';  // Chegada / Início / Fim
        if (s === 'P') {
          const desc = (m.DSTIPOOCORRENCIA || m.dstipocorrencia || '').toLowerCase();
          if (desc.includes('abastecimento')) return '⛽';
          if (desc.includes('alimentação') || desc.includes('banheiro')) return '🍽️';
          if (desc.includes('manutenção')) return '🔧';
          if (desc.includes('fiscal') || desc.includes('polícia') || desc.includes('retido')) return '🚔';
          if (desc.includes('descanso') || desc.includes('pernoite')) return '😴';
          return '⏸️';
        }
        return '📝';
      };

      const macrosComIcones = rows.map((macro) => ({
        ...macro,
        icon: getIcon(macro)
      }));

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

      if (!(await assertViagemTenantAccess(req, res, idViagem))) return;

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
        observacao,
        dtoCorrencia,
        occurredAt
      } = req.body;

      /** Data/hora do evento no aparelho (ISO). Evita todas as macros com o mesmo GETDATE() no sync e alinha fuso ao motorista. */
      function parseDtoOcorrenciaCliente(raw) {
        if (raw == null || raw === '') return null;
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return null;
        const now = Date.now();
        if (d.getTime() > now + 5 * 60 * 1000) return null;
        if (d.getTime() < now - 90 * 24 * 60 * 60 * 1000) return null;
        return d;
      }
      const dtoOcorrenciaCliente = parseDtoOcorrenciaCliente(dtoCorrencia ?? occurredAt);
      
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

      if (!assertSameMotorista(req, res, cdMotorista)) return;

      const pool = await poolPromise;
      const tidMacro = tenantIdForRequest(req);

      // Regra: motorista pode registrar macros enquanto a viagem não estiver Finalizada (F) ou Final de rota (E).
      // Permitido: A (Aprovada), T (Em trânsito), P (Programada), M (Emissão docs), C (Carregamento/No embarcador), D (Descarga).
      const situacaoViagemCheck = await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .input('tenantId', sql.NVarChar(64), tidMacro)
        .query(`
          SELECT [FGSITVIAGEM] FROM [dbo].[VIAGEMMESTRE]
          WHERE [IDVIAGEM] = @idViagem AND [TENANT_ID] = @tenantId
        `);
      if (!situacaoViagemCheck.recordset?.length) {
        return res.status(404).json({ error: 'Viagem não encontrada.', errorKey: 'commonErrors.naoEncontrado' });
      }
      const fgSitViagem = situacaoViagemCheck.recordset[0]?.FGSITVIAGEM ?? situacaoViagemCheck.recordset[0]?.fgsitviagem;
      const fgNorm = fgSitViagem != null ? String(fgSitViagem).trim().toUpperCase() : '';
      const fgBloqueio = ['F', 'E'].includes(fgNorm); // F=Finalizada, E=Final de rota
      const fgPermitido = fgNorm && !fgBloqueio;
      if (!fgPermitido) {
        console.warn(`⚠️ [MACRO] Viagem ${idViagem} com FGSITVIAGEM="${fgSitViagem}" — não permitido registrar macros (viagem finalizada ou final de rota).`);
        return res.status(403).json({
          error: 'Situação da viagem não permite registrar macros',
          message: 'Não é permitido registrar macros quando a viagem está finalizada ou em final de rota.'
        });
      }

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

      const tipoPermitido = await pool
        .request()
        .input('cd', sql.SmallInt, parseInt(cdTipoOcorrencia, 10))
        .input('tid', sql.NVarChar(64), tidMacro)
        .query(`
          SELECT 1 FROM [dbo].[TIPOOCORRENCIA]
          WHERE [CDTIPOOCORRENCIA] = @cd
            AND ([TENANT_ID] = @tid OR [TENANT_ID] = 'default')
            AND (COALESCE([FGACTIVE], 'A') IN ('A', 'S', 'T'))
        `);
      if (!tipoPermitido.recordset || tipoPermitido.recordset.length === 0) {
        return res.status(400).json({ error: 'Tipo de ocorrência inválido ou indisponível para este cliente.' });
      }

      // Inserir ocorrência com GPS completo
      await pool
        .request()
        .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
        .input('cdTipoOcorrencia', sql.SmallInt, parseInt(cdTipoOcorrencia))
        .input('cdMotorista', sql.Decimal(15, 0), parseFloat(cdMotorista))
        .input('dtoOcorrencia', sql.DateTime, dtoOcorrenciaCliente)
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
            COALESCE(@dtoOcorrencia, CURRENT_TIMESTAMP),
            @observacao,
            @latitude,
            @longitude,
            @precisao,
            @fotoBase64,
            'S',
            CURRENT_TIMESTAMP
          )
        `);

      // Atualizar situação da viagem (Gerenciar Viagens) conforme TIPOOCORRENCIA.CDSITUACAOVIAGEM
      const situacaoResult = await pool
        .request()
        .input('cdTipoOcorrencia', sql.SmallInt, parseInt(cdTipoOcorrencia))
        .input('tid', sql.NVarChar(64), tidMacro)
        .query(`
          SELECT [CDSITUACAOVIAGEM]
          FROM [dbo].[TIPOOCORRENCIA]
          WHERE [CDTIPOOCORRENCIA] = @cdTipoOcorrencia
            AND ([TENANT_ID] = @tid OR [TENANT_ID] = 'default')
        `);
      const cdSituacaoViagem = situacaoResult.recordset[0]?.CDSITUACAOVIAGEM ?? situacaoResult.recordset[0]?.cdsituacaoviagem;
      if (cdSituacaoViagem != null) {
        await pool
          .request()
          .input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem))
          .input('tenantId', sql.NVarChar(64), tidMacro)
          .input('CDSITUACAOVIAGEM', sql.SmallInt, cdSituacaoViagem)
          .query(`
            UPDATE [dbo].[VIAGEMMESTRE]
            SET [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM,
                [FGSITVIAGEM] = COALESCE(
                  (SELECT [FGSITVIAGEM] FROM [dbo].[SITUACAOVIAGEM] WHERE [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM),
                  [FGSITVIAGEM]
                )
            WHERE [IDVIAGEM] = @idViagem AND [TENANT_ID] = @tenantId
          `);
        console.log(`   📌 Situação da viagem atualizada: CDSITUACAOVIAGEM=${cdSituacaoViagem} (FGSITVIAGEM via SITUACAOVIAGEM)`);
      }

      const tipoResult = await pool
        .request()
        .input('cdTipoOcorrencia', sql.SmallInt, cdTipoOcorrencia)
        .input('tid', sql.NVarChar(64), tidMacro)
        .query(`
          SELECT [DSTIPOOCORRENCIA]
          FROM [dbo].[TIPOOCORRENCIA]
          WHERE [CDTIPOOCORRENCIA] = @cdTipoOcorrencia
            AND ([TENANT_ID] = @tid OR [TENANT_ID] = 'default')
        `);

      const nomeMacro = tipoResult.recordset[0]?.DSTIPOOCORRENCIA || 'Ocorrência';

      // Também registrar na tabela VIAGEMRASTREAMENTO (rastreamento completo; colunas conforme PG real)
      const temGPS = latitude && longitude;
      if (temGPS) {
        const dataPosicao = dtoOcorrenciaCliente ? new Date(dtoOcorrenciaCliente.getTime()) : new Date();
        console.log(`📍 [MACRO] Iniciando geocodificação reversa...`);
        const endereco = await obterEnderecoPorCoordenadas(
          parseFloat(latitude),
          parseFloat(longitude)
        );
        const dsPosicao = `Macro: ${nomeMacro} - ${endereco}`;
        console.log(`📍 [MACRO] DSPOSICAO: ${dsPosicao}`);
        const velMacro =
          velocidade !== undefined && velocidade !== null && String(velocidade).trim() !== ''
            ? parseFloat(velocidade)
            : null;
        await insertGpsViagemRastreamento(pool, {
          tenantId: tidMacro,
          idViagem: parseFloat(idViagem),
          cdCadastro: parseFloat(cdMotorista),
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          velocidade: velMacro,
          precisao: precisao ? Math.round(parseFloat(precisao)) : null,
          altitude: altitude ? parseFloat(altitude) : null,
          fgstatus: status || 'P',
          direcao: direcao ? parseFloat(direcao) : null,
          tipo: 'M',
          dsPosicao,
          versaoApp: '1.0.0',
          dataPosicao,
        });
        console.log(`   📍 GPS: ${latitude}, ${longitude}`);
      } else {
        console.log(`   📍 GPS: Não fornecido`);
      }

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

      if (!(await assertViagemTenantAccess(req, res, idViagem))) return;

      const pool = await poolPromise;
      const tidHist = tenantIdForRequest(req);

      const result = await pool
        .request()
        .input('idViagem', sql.Int, idViagem)
        .input('tid', sql.NVarChar(64), tidHist)
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
            AND ([T].[TENANT_ID] = @tid OR [T].[TENANT_ID] = 'default')
          WHERE [VO].[IDVIAGEM] = @idViagem
          ORDER BY [VO].[DTOCORRENCIA] DESC, [VO].[IDVIAGEM_OCORRENCIA] DESC
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
        cdMotorista: cdMotoristaBody,
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
      const statusNormalizado = String(status || '').trim().toUpperCase();
      const velocidadeInformada = velocidade !== undefined && velocidade !== null && String(velocidade).trim() !== '';
      let velocidadeNormalizada = velocidadeInformada ? parseFloat(velocidade) : null;
      if (!Number.isFinite(velocidadeNormalizada)) velocidadeNormalizada = null;
      if (velocidadeNormalizada === null && statusNormalizado === 'P') {
        // App às vezes envia status "Parado" sem velocidade.
        // Para telemetria/alertas, normalizamos para 0 km/h.
        velocidadeNormalizada = 0;
      }
      const origemVelocidade = (tipoEnvio === 'A' ? 'automatica' : 'manual');
      
      console.log('📍 [GPS] Campos extraídos:', {
        cdMotorista: cdMotoristaBody,
        idViagem,
        latitude,
        longitude,
        temGPS: !!(latitude && longitude),
        velocidade,
        status
      });
      console.log(`📍 [GPS] velocidade normalizada: ${velocidadeNormalizada ?? 'null'} (origem=${origemVelocidade})`);

      // Validações detalhadas
      const erros = [];
      
      if (!cdMotoristaBody) {
        erros.push('cdMotorista é obrigatório');
      } else if (isNaN(parseFloat(cdMotoristaBody))) {
        erros.push('cdMotorista deve ser um número válido');
      }
      
      const latNum = parseFloat(latitude);
      const lngNum = parseFloat(longitude);
      if (latitude === undefined || latitude === null || String(latitude).trim() === '') {
        erros.push('latitude é obrigatória');
      } else if (!Number.isFinite(latNum)) {
        erros.push('latitude deve ser um número válido');
      }
      if (longitude === undefined || longitude === null || String(longitude).trim() === '') {
        erros.push('longitude é obrigatória');
      } else if (!Number.isFinite(lngNum)) {
        erros.push('longitude deve ser um número válido');
      }
      
      if (erros.length > 0) {
        console.error('❌ [GPS] Erros de validação:', erros);
        return res.status(400).json({ 
          error: 'Erro de validação',
          details: erros
        });
      }

      const cdMotoristaToken = getMotoristaCadastroId(req);
      if (!Number.isFinite(cdMotoristaToken)) {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }
      if (cdMotoristaBody != null && parseFloat(cdMotoristaBody) !== cdMotoristaToken) {
        return res.status(403).json({ error: 'Acesso negado.', errorKey: 'commonErrors.acessoNegado' });
      }
      const cdMotorista = cdMotoristaToken;

      const pool = await poolPromise;
      const tidGps = tenantIdForRequest(req);

      // Se TEM viagem: salvar em VIAGEMRASTREAMENTO (mesma regra de GET /posicoes: motorista deve estar em VIAGEMMOTORISTA)
      if (idViagem) {
        if (!(await assertViagemTenantAccess(req, res, idViagem))) return;

        const dataPosicao = dtPosicao ? new Date(dtPosicao) : new Date();

        console.log(`📍 [GPS] Iniciando geocodificação reversa...`);
        const endereco = await obterEnderecoPorCoordenadas(
          parseFloat(latitude),
          parseFloat(longitude)
        );

        const tipoTexto = tipoEnvio === 'A' ? 'GPS Automático' : 'GPS Manual';
        const dsPosicao = `${tipoTexto} - ${endereco}`;
        console.log(`📍 [GPS] DSPOSICAO: ${dsPosicao}`);

        await insertGpsViagemRastreamento(pool, {
          tenantId: tidGps,
          idViagem: parseFloat(idViagem),
          cdCadastro: cdMotorista,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          velocidade: velocidadeNormalizada,
          precisao: precisao ? Math.round(parseFloat(precisao)) : null,
          altitude: altitude ? parseFloat(altitude) : null,
          fgstatus: status || 'P',
          direcao: direcao ? parseFloat(direcao) : null,
          tipo: tipoEnvio || 'M',
          dsPosicao,
          versaoApp: '1.0.0',
          dataPosicao,
        });

        console.log(`✅ [GPS] Posição salva em VIAGEMRASTREAMENTO (viagem #${idViagem})`);
        
        // Emitir evento WebSocket para Torre de Controle
        try {
          const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
          if (websocketTorre && idViagem) {
            websocketTorre.emitirAtualizacaoGPS(idViagem, {
              latitude: parseFloat(latitude),
              longitude: parseFloat(longitude),
              velocidade: velocidadeNormalizada,
              precisao: precisao ? Math.round(precisao) : null,
              altitude: altitude ? parseFloat(altitude) : null,
              direcao: direcao ? parseFloat(direcao) : null,
              timestamp: new Date().toISOString()
            });
          }

          // Reavaliar alertas imediatamente após novo GPS da viagem (não esperar ciclo de 5 minutos)
          if (idViagem) {
            const alertas = await alertService.verificarAlertas(parseInt(idViagem, 10));
            if (Array.isArray(alertas) && alertas.length > 0 && websocketTorre) {
              alertas.forEach((alerta) => websocketTorre.emitirNovoAlerta(alerta));
              console.log(`🚨 [GPS] ${alertas.length} alerta(s) emitido(s) em tempo real para viagem ${idViagem}`);
            } else {
              console.log(`ℹ️ [GPS] Nenhum alerta novo após reavaliação imediata da viagem ${idViagem}`);
            }
          }
        } catch (err) {
          console.warn('⚠️ Erro ao processar WebSocket/alertas pós-GPS:', err.message);
        }
      } 
      // Se NÃO tem viagem: salvar em MOTORISTARASTREAMENTO
      else {
        await pool
          .request()
          .input('cdCadastro', sql.Decimal(15, 0), cdMotorista)
          .input('latitude', sql.Decimal(10, 8), latitude)
          .input('longitude', sql.Decimal(11, 8), longitude)
          .input('velocidade', sql.Decimal(5, 2), velocidadeNormalizada)
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

      console.log(`✅ [GPS] ${statusTexto}, ${velocidadeNormalizada ?? 0} km/h (${tipoTexto})`);

      res.json({
        success: true,
        message: 'Posição GPS registrada com sucesso',
        dados: {
          status: statusTexto,
          velocidade: velocidadeInformada ? `${velocidadeNormalizada} km/h` : 'N/A',
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

      if (!assertSameMotorista(req, res, idmotorista)) return;

      console.log('✅ Dados OK:', { idviagem, idmotorista, tipo });

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const existeViagem = await pool
        .request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          SELECT 1 AS ok
          FROM [dbo].[VIAGEMMESTRE]
          WHERE [IDVIAGEM] = @idviagem AND [TENANT_ID] = @tenantId
        `);
      if (!existeViagem.recordset?.length) {
        return res.status(404).json({ error: 'Viagem não encontrada.', errorKey: 'commonErrors.naoEncontrado' });
      }
      
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

      if (!(await assertViagemTenantAccess(req, res, idviagem))) return;

      console.log(`🔍 [RASTREAMENTO] Buscando posições para viagem: ${idviagem} (tipo: ${typeof idviagem})`);

      const pool = await poolPromise;
      const tidRast = tenantIdForRequest(req);

      let tableName = null;
      let tableExists = false;
      let realTableRef = null;
      let rastCtx = null;
      try {
        rastCtx = await resolveViagemRastreamentoPg(pool);
        if (rastCtx.found) {
          tableExists = true;
          realTableRef = rastCtx.fromSql;
          tableName = 'VIAGEMRASTREAMENTO';
          console.log(`🔍 [RASTREAMENTO] Tabela encontrada: ${realTableRef}`);
        }
      } catch (err) {
        console.warn('Erro ao resolver tabela de rastreamento:', err.message);
      }

      if (!tableExists || !realTableRef || !rastCtx) {
        console.warn('Nenhuma tabela de rastreamento encontrada. Retornando posições vazias.');
        return res.json({
          posicoes: [],
          ultimaPosicaoGeral: null
        });
      }

      const colsR = rastCtx.cols;
      const dhOrdVr = vrDhOrdSql(colsR);
      if (!colsR.idv || !colsR.lat || !colsR.lon || !dhOrdVr) {
        console.warn('[RASTREAMENTO] Colunas id/lat/lon/data não mapeadas nesta tabela.');
        return res.json({
          posicoes: [],
          ultimaPosicaoGeral: null
        });
      }

      const colSeq = colsR.seq ? `COALESCE(vr.${colsR.seq}::numeric, 0)` : '0';
      const colDsp = colsR.dsp ? `vr.${colsR.dsp}` : 'NULL';
      const colVel = colsR.vel ? `vr.${colsR.vel}` : 'NULL';
      const colPrec = colsR.prec ? `COALESCE(vr.${colsR.prec}::numeric, 10)` : '10';
      const colBat = colsR.bat ? `vr.${colsR.bat}` : 'NULL';
      const colTipo = colsR.tipo ? `COALESCE(vr.${colsR.tipo}::text, 'A')` : `'A'`;
      const colFonte = colsR.fonte ? `COALESCE(vr.${colsR.fonte}::text, 'RASTER')` : `'RASTER'`;
      const colFg = colsR.fgstatus ? `vr.${colsR.fgstatus}` : 'NULL';
      const colCdSel = colsR.cdcad ? `vr.${colsR.cdcad} AS CDCADASTRO` : 'NULL AS CDCADASTRO';
      
      // DEBUG: Verificar se há registros na tabela antes de fazer a query principal
      // Testar com diferentes tipos de dados para garantir compatibilidade
      try {
        // Teste 1: Com Decimal
        const debugRequest = pool.request();
        debugRequest.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
        const debugResult = await debugRequest.query(`
          SELECT COUNT(*) as total
          FROM ${realTableRef || '[dbo].[VIAGEMRASTREAMENTO]'}
          WHERE ${colsR.idv} = @idviagem
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
              WHERE ${colsR.idv} = @idviagem
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
              WHERE ${colsR.idv} = ${parseFloat(idviagem)}
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
            SELECT
              vr.${colsR.idv},
              ${colSeq} AS SEQUENCIA,
              CAST(vr.${colsR.lat} AS DECIMAL(10,8)) AS LATITUDE,
              CAST(vr.${colsR.lon} AS DECIMAL(11,8)) AS LONGITUDE,
              ${dhOrdVr} AS DH_ORD
              ${colsR.cdcad ? `, vr.${colsR.cdcad} AS CDCADASTRO` : ''}
            FROM ${realTableRef} vr
            WHERE vr.${colsR.idv} = @idviagem
            ORDER BY ${dhOrdVr} DESC
            LIMIT 3
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
          .input('tidRast', sql.NVarChar(64), tidRast)
          .query(`
            SELECT TOP 1
              [vm].[CDMOTORISTA] AS CDCADASTRO,
              [cg].[RZSOCIAL] AS NOME_MOTORISTA,
              [cg].[CGCCPF] AS CPF_MOTORISTA,
              [cg].[NRCELULAR] AS CELULAR
            FROM [dbo].[VIAGEMMOTORISTA] [vm]
            INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [vm].[IDVIAGEM] = [v].[IDVIAGEM] AND [v].[TENANT_ID] = @tidRast
            INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
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
            .input('tidRast', sql.NVarChar(64), tidRast)
            .query(`
              SELECT TOP 1
                [vm].[CDMOTORISTA] AS CDCADASTRO,
                [cg].[RZSOCIAL] AS NOME_MOTORISTA,
                [cg].[CGCCPF] AS CPF_MOTORISTA,
                [cg].[NRCELULAR] AS CELULAR
              FROM [dbo].[VIAGEMMOTORISTA] [vm]
              INNER JOIN [dbo].[VIAGEMMESTRE] [v] ON [vm].[IDVIAGEM] = [v].[IDVIAGEM] AND [v].[TENANT_ID] = @tidRast
              INNER JOIN [dbo].[CADASTROGERAL] [cg] ON [vm].[CDMOTORISTA] = [cg].[CDCADASTROGERAL] AND [cg].[TENANT_ID] = [v].[TENANT_ID]
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
        // Listagem só por IDVIAGEM. assertViagemTenantAccess já garantiu acesso; JOIN com VIAGEMMESTRE/TENANT
        // zerava o resultado em PostgreSQL quando TENANT_ID do JWT ≠ da viagem. Nomes vêm de motoristaViagem abaixo.
        const request = pool.request();
        request.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
        if (dataLimite) {
          request.input('dataLimite', sql.DateTime, dataLimite);
        }
        const filtroData = dataLimite ? `AND ${dhOrdVr} <= @dataLimite` : '';
        if (dataLimite) {
          console.log(`🔍 Aplicando filtro: posições com DHPOSICAO/DHREGISTRO <= ${dataLimite.toISOString()}`);
        }
        result = await request.query(`
            SELECT 
              vr.${colsR.idv} AS IDVIAGEM,
              ${colSeq} AS SEQUENCIA,
              ${colDsp} AS DSPOSICAO,
              CAST(vr.${colsR.lat} AS DECIMAL(10,8)) AS LATITUDE,
              CAST(vr.${colsR.lon} AS DECIMAL(11,8)) AS LONGITUDE,
              ${colVel} AS VELOCIDADE,
              ${colPrec} AS PRECISAO,
              ${colBat} AS BATERIA,
              ${dhOrdVr} AS DHREGISTRO,
              ${colTipo} AS TIPO,
              ${colFonte} AS FONTE,
              ${colFg} AS FGSTATUS,
              ${colCdSel},
              NULL AS NOME_MOTORISTA,
              NULL AS CPF_MOTORISTA
            FROM ${realTableRef} vr
            WHERE vr.${colsR.idv} = @idviagem
              ${filtroData}
            ORDER BY ${dhOrdVr} ASC
          `);
        console.log(`📊 [RASTREAMENTO] Lista direta ${realTableRef} viagem ${idviagem}: ${result.recordset.length} registro(s)`);
        if (result.recordset.length === 0 && dataLimite) {
          console.warn(`⚠️  Nenhuma posição encontrada com filtro. Verificando total sem filtro...`);
          const testRequest2 = pool.request();
          testRequest2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          const testResult2 = await testRequest2.query(`
              SELECT COUNT(*) as total 
              FROM ${realTableRef} vr
              WHERE vr.${colsR.idv} = @idviagem
            `);
          const totalSemFiltro2 = testResult2.recordset[0].total;
          console.log(`📊 Total de posições na tabela (sem filtro): ${totalSemFiltro2}`);
        }
        } else {
          // Tabela VIAGEM_RASTREAMENTO (estrutura nova)
          try {
            const request2 = pool.request();
            request2.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
            request2.input('tidRast', sql.NVarChar(64), tidRast);
            
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
              INNER JOIN [dbo].[VIAGEMMESTRE] v ON vr.[IDVIAGEM] = v.[IDVIAGEM] AND v.[TENANT_ID] = @tidRast
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON vr.[CDCADASTRO] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = v.[TENANT_ID]
              WHERE vr.[IDVIAGEM] = @idviagem
                ${filtroData2}
              ORDER BY vr.[DHREGISTRO] ASC
            `);
        } catch (err) {
          console.warn('Tentando com estrutura alternativa...', err.message);
          const request3 = pool.request();
          request3.input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem));
          request3.input('tidRast', sql.NVarChar(64), tidRast);
          
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
              INNER JOIN [dbo].[VIAGEMMESTRE] v ON vr.[IDVIAGEM] = v.[IDVIAGEM] AND v.[TENANT_ID] = @tidRast
              LEFT JOIN [dbo].[CADASTROGERAL] cg ON (vr.[CDCADASTRO] = cg.[CDCADASTRO] OR vr.[CDMOTORISTA] = cg.[CDCADASTRO])
                AND cg.[TENANT_ID] = v.[TENANT_ID]
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
              ${dhOrdVr} AS DHREGISTRO
            FROM ${realTableRef} vr
            WHERE vr.${colsR.idv} = @idviagem
            ORDER BY ${dhOrdVr} DESC
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
            FROM ${realTableRef} vr
            WHERE vr.${colsR.idv} = @idviagem
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

      if (!(await assertViagemTenantAccess(req, res, idviagem))) return;

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

      if (!assertSameMotorista(req, res, idMotorista)) return;

      const pool = await poolPromise;
      const tidSenha = tenantIdForRequest(req);

      // Buscar motorista e senha atual
      const result = await pool
        .request()
        .input('id', sql.Decimal(15, 0), parseFloat(idMotorista))
        .input('tenantId', sql.NVarChar(64), tidSenha)
        .query(`
          SELECT 
            mc.SENHA,
            cg.CDCADASTRO,
            cg.FGTIPOCADASTRO,
            cg.FGACTIVE
          FROM [dbo].[CADASTROGERAL] cg
          LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
          WHERE cg.CDCADASTRO = @id
            AND cg.[TENANT_ID] = @tenantId
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

      if (!assertSameMotorista(req, res, cdMotorista)) return;

      const tid = tenantIdForRequest(req);

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
          .input('tenantId', sql.NVarChar(64), tid)
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
            LEFT JOIN [dbo].[CADASTROGERAL] cg ON m.[SENDER_ID] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
            LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.[ID_VIAGEM] = v.[IDVIAGEM] AND c.[TENANT_ID] = v.[TENANT_ID]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
              AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
            WHERE c.[ID_MOTORISTA] = @cdMotorista
              AND c.[TENANT_ID] = @tenantId
              AND m.[TENANT_ID] = @tenantId
              AND v.[TENANT_ID] = @tenantId
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
          .input('tenantId', sql.NVarChar(64), tid)
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
            LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.[IDVIAGEM] = v.[IDVIAGEM] AND c.[TENANT_ID] = v.[TENANT_ID]
            LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
              AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
            WHERE c.[CDCADASTRO_MOTORISTA] = @cdMotorista
              AND c.[TENANT_ID] = @tenantId
              AND v.[TENANT_ID] = @tenantId
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
            .input('tenantId', sql.NVarChar(64), tid)
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
              LEFT JOIN [dbo].[VIAGEMMESTRE] v ON s.[CDVIAGEM] = v.[IDVIAGEM] AND s.[TENANT_ID] = v.[TENANT_ID]
              LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
                AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
              WHERE s.[CDMOTORISTA] = @cdMotorista
                AND (s.[CDVIAGEM] IS NULL OR v.[TENANT_ID] = @tenantId)
                AND s.[STATUS] IN ('PENDENTE', 'ABERTO', 'active')
              ORDER BY s.[CREATED_AT] DESC
            `);
        } catch (errSos) {
          console.warn('⚠️ [NOTIF] SOS query principal falhou:', errSos.code, errSos.message);
          if (errSos.code === '42703') {
            // Fallback: mesmo esquema (CDVIAGEM), caso alguma coluna tenha nome diferente
            sosResult = await pool.request()
              .input('cdMotorista', sql.Decimal(15, 0), cdMotorista)
              .input('tenantId', sql.NVarChar(64), tid)
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
                LEFT JOIN [dbo].[VIAGEMMESTRE] v ON s.[CDVIAGEM] = v.[IDVIAGEM] AND s.[TENANT_ID] = v.[TENANT_ID]
                LEFT JOIN [dbo].[ROTEIRO] r ON v.[IDROTEIRO] = r.[IDROTEIRO]
                  AND (r.[TENANT_ID] = @tenantId OR r.[TENANT_ID] = 'default')
                WHERE s.[CDMOTORISTA] = @cdMotorista
                  AND (s.[CDVIAGEM] IS NULL OR v.[TENANT_ID] = @tenantId)
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
          .input('tenantId', sql.NVarChar(64), tid)
          .input('limit', sql.Int, parseInt(limit))
          .query(`
            SELECT [a].[ID], [a].[IDVIAGEM], [a].[MESSAGE], [a].[TYPE], [a].[STATUS], [a].[CREATED_AT],
              [v].[IDVIAGEM], [r].[DSROTEIRO]
            FROM [dbo].[ALERTS] [a]
            INNER JOIN [dbo].[VIAGEMMOTORISTA] [vm] ON [a].[IDVIAGEM] = [vm].[IDVIAGEM]
            LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [a].[IDVIAGEM] = [v].[IDVIAGEM] AND [v].[TENANT_ID] = @tenantId
            LEFT JOIN [dbo].[ROTEIRO] [r] ON [v].[IDROTEIRO] = [r].[IDROTEIRO]
              AND ([r].[TENANT_ID] = [v].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
            WHERE [vm].[CDMOTORISTA] = @cdMotorista
              AND [v].[TENANT_ID] = @tenantId
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

