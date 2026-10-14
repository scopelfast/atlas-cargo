// backend/routes/config.routes.js
// Configurações do sistema (Nominatim, Router, etc.) + contexto multimoeda/multilíngua (Fase 0)
// Atlas Cargo

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const axios = require('axios');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireMotoristaOrTowerAuth } = require('../middleware/auth.middleware');
const { attachTenantContext } = require('../middleware/tenant.middleware');
const { getContexto, invalidateCache } = require('../services/contexto.service');
const alertService = require('../services/alert-service');
const convocacaoMsgTplRoutes = require('../services/convocacao-mensagem-template.service');
const convPlacasDivCfg = require('../services/convocacao-placas-divergencia.service');
const alertMsgTplRoutes = require('../services/alert-mensagem-template.service');
const openaiConfigService = require('../services/openai-config.service');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const sqlCfg = require('../config/mssql-compat');
const { getEntitlementsForTenant } = require('../services/tenant-entitlements.service');
const { fetchRouteMapRaw } = require('../services/mapa-rota-fetch.service');
const switchDisparoOportunidade = require('../services/switch-disparo-oportunidade.service');
const alertNotificationService = require('../services/alert-notification-service');
const { pool: pgPool } = require('../config/db');

const UPSERT_CONFIG_SQL = `
  INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
  VALUES (@tenantId, @chave, @valor, @desc, CURRENT_TIMESTAMP)
  ON CONFLICT ("TENANT_ID", "CHAVE") DO UPDATE SET
    "VALOR" = EXCLUDED."VALOR",
    "DESCRICAO" = EXCLUDED."DESCRICAO",
    "DHMAINTENANCE" = CURRENT_TIMESTAMP
`;

/** Licença SaaS: módulos por tenant (JSON). */
router.get('/configuracoes/saas-modulos', towerAuthAndTenant, async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const modules = await getEntitlementsForTenant(tid);
    res.json({ success: true, modules });
  } catch (err) {
    console.error('Erro ao ler saas-modulos:', err);
    res.status(500).json({ error: 'Erro ao carregar módulos do contrato.' });
  }
});

const CHAVE_NOMINATIM = 'nominatim_server';
const CHAVE_ROUTER = 'router_server';
/** Mesma chave do card Alertas: “minutos sem GPS” — usada no Mapa de Viagem para ícone de posição desatualizada */
const CHAVE_ALERT_OFFLINE_MIN = 'alert_offline_minutos';
const CHAVE_LOGO_RETANGULAR = 'logo_retangular';
const CHAVE_LOGO_QUADRADA = 'logo_quadrada';
const DEFAULT_LOGO_RETANGULAR = 'logoAtlasTransparente.png';
const DEFAULT_LOGO_QUADRADA = 'logoAtlasTransparenteQuadrada.png';

const LOGO_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'img');
const LOGO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

const identidadeLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    try {
      fs.mkdirSync(LOGO_UPLOAD_DIR, { recursive: true });
    } catch (_) { /* ignore */ }
    cb(null, LOGO_UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const tipo = String(req.query.tipo || '').toLowerCase();
    const prefix = tipo === 'quadrada' ? 'logo_quad_' : 'logo_rect_';
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = { '.png': 1, '.jpg': 1, '.jpeg': 1, '.webp': 1 };
    const e = allowed[ext] ? ext : '.png';
    cb(null, prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 10) + e);
  }
});

const identidadeLogoUpload = multer({
  storage: identidadeLogoStorage,
  limits: { fileSize: LOGO_UPLOAD_MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpeg|webp)$/i.test(file.mimetype || '')) return cb(null, true);
    cb(new Error('INVALID_LOGO_MIME'));
  }
});

function handleIdentidadeLogoMulterError(err, req, res, next) {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Arquivo muito grande (máx. 2 MB).' });
    }
    return res.status(400).json({ error: 'Erro no envio do arquivo.' });
  }
  if (err.message === 'INVALID_LOGO_MIME') {
    return res.status(400).json({ error: 'Use PNG, JPEG ou WebP.' });
  }
  return next(err);
}

/**
 * GET /api/mapa/rota-osrm?coords=lon1,lat1;lon2,lat2
 * Proxy server-side para OSRM/OSM.de: evita CORS no navegador.
 * Usa router_server do banco primeiro e mirrors em paralelo (Promise.any) para não esperar ~105s em série.
 */
// Torre ou app motorista (mapas / detalhes-viagem / gps-visualizacao usam o mesmo gateway)
router.get('/mapa/rota-osrm', requireMotoristaOrTowerAuth, attachTenantContext, async (req, res) => {
  const t0 = Date.now();
  try {
    const coords = String(req.query.coords || '').trim();
    // Roteiros com muitos waypoints: string longa; ainda só dígitos, ponto, vírgula e ;
    if (!coords || coords.length > 12000 || !/^[-\d.,;]+$/.test(coords)) {
      return res.status(400).json({ code: 'InvalidArgs', message: 'Parâmetro coords inválido' });
    }
    const winner = await fetchRouteMapRaw(coords, tenantIdForRequest(req));
    if (winner && winner.data) {
      const mc = typeof winner.mirrorCount === 'number' ? winner.mirrorCount : '?';
      console.info(
        `[ROTA-OSRM] OK em ${Date.now() - t0}ms (coords len ${coords.length}, mirrors=${mc}, vencedor=${winner.url}, tempo_vencedor=${winner.elapsedMs}ms)`
      );
      return res.json(winner.data);
    }

    console.warn(`[ROTA-OSRM] 502 após ${Date.now() - t0}ms — nenhum mirror válido`);
    return res.status(502).json({
      code: 'NoRoute',
      message: 'Nenhum servidor de rota respondeu com rota válida',
    });
  } catch (err) {
    console.error('GET /mapa/rota-osrm:', err.message);
    return res.status(500).json({ error: 'Erro ao consultar roteamento' });
  }
});

// GET /api/configuracoes/mapa - Retorna configurações de mapa (Nominatim e Router)
router.get('/configuracoes/mapa', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('k1', CHAVE_NOMINATIM)
      .input('k2', CHAVE_ROUTER)
      .input('k3', CHAVE_ALERT_OFFLINE_MIN)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId
          AND ("CHAVE" = @k1 OR "CHAVE" = @k2 OR "CHAVE" = @k3)
      `);
    const rows = result.recordset || [];
    const nominatim = rows.find(r => (r.CHAVE || r.chave) === CHAVE_NOMINATIM);
    const routerRow = rows.find(r => (r.CHAVE || r.chave) === CHAVE_ROUTER);
    const offlineRow = rows.find(r => (r.CHAVE || r.chave) === CHAVE_ALERT_OFFLINE_MIN);
    let alertOfflineMinutos = 90;
    if (offlineRow) {
      const raw = offlineRow.VALOR != null ? offlineRow.VALOR : offlineRow.valor;
      const n = parseInt(String(raw).trim(), 10);
      if (Number.isFinite(n) && n >= 1 && n <= 1440) alertOfflineMinutos = n;
    }
    res.json({
      nominatimServer: (nominatim && (nominatim.VALOR || nominatim.valor)) || '',
      osrmServer: (routerRow && (routerRow.VALOR || routerRow.valor)) || '',
      alertOfflineMinutos
    });
  } catch (err) {
    console.error('Erro ao listar configurações de mapa:', err);
    // Se a tabela não existir, retornar vazio em vez de 500
    res.json({ nominatimServer: '', osrmServer: '', alertOfflineMinutos: 90 });
  }
});

// PUT /api/configuracoes/mapa - Atualiza configurações de mapa
router.put('/configuracoes/mapa', towerAuthAndTenant, async (req, res) => {
  try {
    const { nominatimServer, osrmServer } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);

    if (nominatimServer != null) {
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', CHAVE_NOMINATIM)
        .input('valor', String(nominatimServer).trim())
        .input('desc', 'Servidor/API Nominatim (geocodificação)')
        .query(UPSERT_CONFIG_SQL);
    }
    if (osrmServer != null) {
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', CHAVE_ROUTER)
        .input('valor', String(osrmServer).trim())
        .input('desc', 'Servidor/API de roteamento (ORS/OSRM)')
        .query(UPSERT_CONFIG_SQL);
    }

    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configurações de mapa:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

// GET /api/configuracoes/identidade - Retorna configurações de identidade visual (logos)
router.get('/configuracoes/identidade', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('k1', CHAVE_LOGO_RETANGULAR)
      .input('k2', CHAVE_LOGO_QUADRADA)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId AND ("CHAVE" = @k1 OR "CHAVE" = @k2)
      `);
    const rows = result.recordset || [];
    const retangular = rows.find(r => (r.CHAVE || r.chave) === CHAVE_LOGO_RETANGULAR);
    const quadrada = rows.find(r => (r.CHAVE || r.chave) === CHAVE_LOGO_QUADRADA);
    res.json({
      logoRetangular: (retangular && (retangular.VALOR || retangular.valor)) || DEFAULT_LOGO_RETANGULAR,
      logoQuadrada: (quadrada && (quadrada.VALOR || quadrada.valor)) || DEFAULT_LOGO_QUADRADA
    });
  } catch (err) {
    console.error('Erro ao listar configurações de identidade:', err);
    res.json({
      logoRetangular: DEFAULT_LOGO_RETANGULAR,
      logoQuadrada: DEFAULT_LOGO_QUADRADA
    });
  }
});

// GET /api/configuracoes/identidade/upload-permissao — torre: se o tenant pode enviar arquivos de logo (só default)
router.get('/configuracoes/identidade/upload-permissao', towerAuthAndTenant, (req, res) => {
  const tid = tenantIdForRequest(req);
  res.json({ canUploadLogos: tid === getDefaultTenantId() });
});

// POST /api/configuracoes/identidade/upload-logo — grava em public/img; apenas tenant DEFAULT_TENANT_ID
router.post(
  '/configuracoes/identidade/upload-logo',
  towerAuthAndTenant,
  (req, res, next) => {
    if (tenantIdForRequest(req) !== getDefaultTenantId()) {
      return res.status(403).json({ error: 'Upload de logos permitido apenas para o tenant padrão da instalação.' });
    }
    next();
  },
  (req, res, next) => {
    identidadeLogoUpload.single('logo')(req, res, (err) => handleIdentidadeLogoMulterError(err, req, res, next));
  },
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
      }
      const tipo = String(req.query.tipo || '').toLowerCase();
      if (tipo !== 'retangular' && tipo !== 'quadrada') {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) { /* ignore */ }
        return res.status(400).json({ error: 'Parâmetro tipo deve ser retangular ou quadrada (?tipo=).' });
      }
      res.json({ success: true, filename: req.file.filename, tipo });
    } catch (err) {
      console.error('Erro upload-logo identidade:', err);
      res.status(500).json({ error: 'Falha ao processar upload.' });
    }
  }
);

// GET /api/contexto - Contexto atual (país, locale, moeda, tipo documento) - Fase 0 multimoeda/multilíngua
// Inclui tenantId e tenantNome (SAAS_CLIENTE_CONTRATANTE) para exibição no dashboard.
router.get('/contexto', async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const contexto = await getContexto(tid);
    let tenantNome = null;
    try {
      const pool = await poolPromise;
      const r = await pool.query(
        `SELECT "NM_CLIENTE" FROM "SAAS_CLIENTE_CONTRATANTE" WHERE "TENANT_ID" = $1 LIMIT 1`,
        [tid]
      );
      const row = r.rows && r.rows[0];
      const nm = row && (row.NM_CLIENTE ?? row.nm_cliente);
      if (nm != null && String(nm).trim() !== '') tenantNome = String(nm).trim();
    } catch (_) {
      /* tabela ausente ou instalação sem SaaS */
    }
    res.json({ ...contexto, tenantId: tid, tenantNome });
  } catch (err) {
    console.error('Erro ao obter contexto:', err);
    const tid = tenantIdForRequest(req);
    res.status(500).json({
      pais: 'BR',
      locale: 'pt-BR',
      moeda: 'BRL',
      tipoDocFisica: 'CPF',
      tipoDocJuridica: 'CNPJ',
      timezone: 'America/Sao_Paulo',
      tenantId: tid,
      tenantNome: null
    });
  }
});

// PUT /api/configuracoes/contexto - Atualiza contexto multipaís (país, moeda, idioma, fuso, tipo doc) - Plano multimoeda
router.put('/configuracoes/contexto', towerAuthAndTenant, async (req, res) => {
  try {
    const { pais, locale, moeda, tipoDocFisica, tipoDocJuridica, timezone } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const upsert = async (chave, valor, desc) => {
      if (valor == null) return;
      const v = String(valor).trim();
      await pool.request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(UPSERT_CONFIG_SQL);
    };
    await upsert('pais_padrao', pais, 'País padrão da instalação');
    await upsert('idioma_padrao', locale, 'Locale padrão');
    await upsert('moeda_padrao', moeda, 'Moeda padrão');
    await upsert('tipo_doc_fisica', tipoDocFisica, 'Tipo documento pessoa física');
    await upsert('tipo_doc_juridica', tipoDocJuridica, 'Tipo documento pessoa jurídica');
    await upsert('timezone', timezone, 'Fuso horário IANA');
    invalidateCache(tid);
    res.json({ success: true, message: 'Contexto salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar contexto:', err);
    res.status(500).json({ error: 'Erro ao salvar contexto. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

const CHAVE_LINK_APP_MOTORISTA = 'link_app_motorista';

// GET /api/configuracoes/app-motorista - Link do aplicativo do motorista (mensagem de confirmação)
router.get('/configuracoes/app-motorista', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('k', CHAVE_LINK_APP_MOTORISTA)
      .query(`
      SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @k
    `);
    const row = result.recordset && result.recordset[0];
    const valor = row && (row.VALOR != null ? row.VALOR : row.valor);
    res.json({ linkAppMotorista: valor != null ? String(valor).trim() : '' });
  } catch (err) {
    console.error('Erro ao buscar link app motorista:', err);
    res.json({ linkAppMotorista: '' });
  }
});

// PUT /api/configuracoes/app-motorista
router.put('/configuracoes/app-motorista', towerAuthAndTenant, async (req, res) => {
  try {
    const { linkAppMotorista } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const v = linkAppMotorista != null ? String(linkAppMotorista).trim() : '';
    await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('chave', CHAVE_LINK_APP_MOTORISTA)
      .input('valor', v)
      .input('desc', 'URL do aplicativo do motorista (exibida na mensagem de confirmação da convocação)')
      .query(UPSERT_CONFIG_SQL);
    res.json({ success: true, message: 'Link do app motorista salvo com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar link app motorista:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração.' });
  }
});

// GET /api/configuracoes/openai — status da chave (mascarada; requer login)
router.get('/configuracoes/openai', towerAuthAndTenant, async (req, res) => {
  try {
    const dbVal = await openaiConfigService.loadOpenAiApiKeyFromDb(tenantIdForRequest(req));
    const envVal = process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim();
    const activeSource = dbVal ? 'database' : envVal ? 'env' : 'none';
    const configured = !!(dbVal || envVal);
    const maskedKey =
      dbVal ? openaiConfigService.maskApiKey(dbVal) : envVal ? openaiConfigService.maskApiKey(envVal) : '';
    res.json({
      configured,
      activeSource,
      maskedKey,
      hasKeyInDatabase: !!dbVal,
    });
  } catch (err) {
    console.error('Erro ao ler configuração OpenAI:', err);
    res.status(500).json({ error: 'Erro ao ler configuração OpenAI.' });
  }
});

// PUT /api/configuracoes/openai — salvar nova chave ou remover do banco (requer login)
router.put('/configuracoes/openai', towerAuthAndTenant, async (req, res) => {
  try {
    const { apiKey, removeFromDatabase } = req.body || {};
    const pool = await poolPromise;

    if (removeFromDatabase === true || removeFromDatabase === 'true') {
      const tid = tenantIdForRequest(req);
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', openaiConfigService.CHAVE_OPENAI_API_KEY)
        .query(`DELETE FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @chave`);
      return res.json({
        success: true,
        message:
          'Chave removida das configurações do sistema. Se existir OPENAI_API_KEY no servidor (.env), ela continuará valendo.',
      });
    }

    const v = apiKey != null ? String(apiKey).trim() : '';
    if (!v) {
      return res.status(400).json({
        error:
          'Informe a nova chave em apiKey ou envie removeFromDatabase: true para apagar a chave salva no banco.',
      });
    }

    const tidPut = tenantIdForRequest(req);
    await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tidPut)
      .input('chave', openaiConfigService.CHAVE_OPENAI_API_KEY)
      .input('valor', v)
      .input('desc', 'Chave da API OpenAI (Whisper) — transcrição de áudio no chat')
      .query(UPSERT_CONFIG_SQL);

    res.json({
      success: true,
      message: 'Chave OpenAI salva. A transcrição de áudio usará esta chave (prioridade sobre o .env).',
    });
  } catch (err) {
    console.error('Erro ao salvar chave OpenAI:', err);
    res.status(500).json({ error: 'Erro ao salvar chave OpenAI.' });
  }
});

async function obterLinkAppMotoristaParaExemplo(pool, tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  let link = (process.env.APP_URL || process.env.PUBLIC_URL || '').toString().trim();
  try {
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('k', CHAVE_LINK_APP_MOTORISTA)
      .query(`
      SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @k
    `);
    const row = result.recordset && result.recordset[0];
    const valor = row && (row.VALOR != null ? row.VALOR : row.valor);
    if (valor != null && String(valor).trim()) link = String(valor).trim();
  } catch (e) {
    /* mantém env */
  }
  return link;
}

// GET /api/configuracoes/mensagens-convocacao — textos WhatsApp (Switch) para convocações (vazio = padrão do sistema)
router.get('/configuracoes/mensagens-convocacao', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const t = await convocacaoMsgTplRoutes.carregarTemplatesConvocacao(pool, tid);
    const linkAppExemplo = await obterLinkAppMotoristaParaExemplo(pool, tid);
    const templatesSugeridos = convocacaoMsgTplRoutes.obterTemplatesSugeridos();
    let divergenciaPlacasNotificarSwitch = 'S';
    let divergenciaPlacasNotificarTorreWebsocket = 'S';
    try {
      const divR = await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId
          AND ("CHAVE" = '${convPlacasDivCfg.CHAVE_DIV_NOTIF_SWITCH}' OR "CHAVE" = '${convPlacasDivCfg.CHAVE_DIV_NOTIF_TORRE_WS}')
      `);
      const divRows = divR.recordset || divR.rows || [];
      for (const row of divRows) {
        const k = row.CHAVE ?? row.chave;
        const v = row.VALOR ?? row.valor;
        if (k === convPlacasDivCfg.CHAVE_DIV_NOTIF_SWITCH) divergenciaPlacasNotificarSwitch = String(v || 'S').trim().toUpperCase().startsWith('N') ? 'N' : 'S';
        if (k === convPlacasDivCfg.CHAVE_DIV_NOTIF_TORRE_WS) divergenciaPlacasNotificarTorreWebsocket = String(v || 'S').trim().toUpperCase().startsWith('N') ? 'N' : 'S';
      }
    } catch (_) {
      /* mantém S */
    }
    res.json({
      disparoCorpo: t[convocacaoMsgTplRoutes.CHAVE_DISPARO] || '',
      confirmacaoSelecionadoCorpo: t[convocacaoMsgTplRoutes.CHAVE_CONF_SELECIONADO] || '',
      confirmacaoNaoSelecionadoCorpo: t[convocacaoMsgTplRoutes.CHAVE_CONF_NAO_SELECIONADO] || '',
      linkAppUsadoNoExemplo: linkAppExemplo,
      divergenciaPlacasNotificarSwitch,
      divergenciaPlacasNotificarTorreWebsocket,
      templatesSugeridos: {
        disparo: templatesSugeridos.disparo,
        confirmacaoSelecionado: templatesSugeridos.confirmacaoSelecionado,
        confirmacaoNaoSelecionado: templatesSugeridos.confirmacaoNaoSelecionado,
      },
    });
  } catch (err) {
    console.error('Erro ao buscar templates de convocação:', err);
    res.status(500).json({ error: 'Erro ao buscar configurações.' });
  }
});

// POST /api/configuracoes/mensagens-convocacao/preview — pré-visualizar template com dados de exemplo
router.post('/configuracoes/mensagens-convocacao/preview', towerAuthAndTenant, async (req, res) => {
  try {
    const { tipo, corpo } = req.body || {};
    if (!['disparo', 'confirmacaoSel', 'confirmacaoNaoSel'].includes(tipo)) {
      return res.status(400).json({ error: 'Informe tipo: disparo, confirmacaoSel ou confirmacaoNaoSel.' });
    }
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const linkApp = await obterLinkAppMotoristaParaExemplo(pool, tid);
    const renderizado = convocacaoMsgTplRoutes.previewComExemplo(tipo, corpo, linkApp);
    res.json({ renderizado });
  } catch (err) {
    console.error('Erro ao pré-visualizar mensagem de convocação:', err);
    res.status(500).json({ error: 'Erro ao gerar pré-visualização.' });
  }
});

// PUT /api/configuracoes/mensagens-convocacao
router.put('/configuracoes/mensagens-convocacao', towerAuthAndTenant, async (req, res) => {
  try {
    const { disparoCorpo, confirmacaoSelecionadoCorpo, confirmacaoNaoSelecionadoCorpo, divergenciaPlacasNotificarSwitch, divergenciaPlacasNotificarTorreWebsocket } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);

    const upsert = async (chave, valor, desc) => {
      const v = valor != null ? String(valor) : '';
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(UPSERT_CONFIG_SQL);
    };

    if (disparoCorpo !== undefined) {
      await upsert(
        convocacaoMsgTplRoutes.CHAVE_DISPARO,
        disparoCorpo,
        'Template WhatsApp: corpo do disparo de convocação (Switch)'
      );
    }
    if (confirmacaoSelecionadoCorpo !== undefined) {
      await upsert(
        convocacaoMsgTplRoutes.CHAVE_CONF_SELECIONADO,
        confirmacaoSelecionadoCorpo,
        'Template WhatsApp: confirmação motorista selecionado'
      );
    }
    if (confirmacaoNaoSelecionadoCorpo !== undefined) {
      await upsert(
        convocacaoMsgTplRoutes.CHAVE_CONF_NAO_SELECIONADO,
        confirmacaoNaoSelecionadoCorpo,
        'Template WhatsApp: aviso não selecionado (ACEITA_DESCARTADA)'
      );
    }

    const normDivSn = (v) => {
      const u = String(v == null ? '' : v).trim().toUpperCase();
      if (u === 'N' || u === 'NAO' || u === 'NÃO' || u === '0' || u === 'FALSE' || u === 'NO') return 'N';
      return 'S';
    };

    if (divergenciaPlacasNotificarSwitch !== undefined) {
      await upsert(
        convPlacasDivCfg.CHAVE_DIV_NOTIF_SWITCH,
        normDivSn(divergenciaPlacasNotificarSwitch),
        'Notificar contratador por WhatsApp (Switch) ao registrar divergência de placas (S/N). Default S.'
      );
    }
    if (divergenciaPlacasNotificarTorreWebsocket !== undefined) {
      await upsert(
        convPlacasDivCfg.CHAVE_DIV_NOTIF_TORRE_WS,
        normDivSn(divergenciaPlacasNotificarTorreWebsocket),
        'Emitir evento WebSocket na torre ao registrar divergência de placas (S/N). Default S.'
      );
    }

    res.json({ success: true, message: 'Mensagens de convocação salvas.' });
  } catch (err) {
    console.error('Erro ao salvar templates de convocação:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

const TIPOS_MSG_ALERTA_API = ['parada', 'atraso', 'eta_prazo', 'offline', 'desvio', 'atraso_inicio', 'excesso_velocidade'];

// GET /api/configuracoes/mensagens-alertas — templates WhatsApp para alertas automáticos (vazio = padrão do sistema)
router.get('/configuracoes/mensagens-alertas', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const t = await alertMsgTplRoutes.carregarTemplatesAlertas(pool, tid);
    res.json({
      paradaCorpo: t[alertMsgTplRoutes.CHAVE_PARADA] || '',
      atrasoCorpo: t[alertMsgTplRoutes.CHAVE_ATRASO] || '',
      etaPrazoCorpo: t[alertMsgTplRoutes.CHAVE_ETA_PRAZO] || '',
      offlineCorpo: t[alertMsgTplRoutes.CHAVE_OFFLINE] || '',
      desvioCorpo: t[alertMsgTplRoutes.CHAVE_DESVIO] || '',
      atrasoInicioCorpo: t[alertMsgTplRoutes.CHAVE_ATRASO_INICIO] || '',
      excessoVelocidadeCorpo: t[alertMsgTplRoutes.CHAVE_EXCESSO_VELOCIDADE] || '',
      templatesSugeridos: alertMsgTplRoutes.obterTemplatesSugeridos(),
    });
  } catch (err) {
    console.error('Erro ao listar mensagens de alerta:', err);
    res.status(500).json({ error: 'Erro ao carregar templates de alertas.' });
  }
});

// POST /api/configuracoes/mensagens-alertas/preview
router.post('/configuracoes/mensagens-alertas/preview', towerAuthAndTenant, async (req, res) => {
  try {
    const { tipo, corpo } = req.body || {};
    if (!TIPOS_MSG_ALERTA_API.includes(tipo)) {
      return res.status(400).json({
        error: 'Informe tipo: parada, atraso, eta_prazo, offline, desvio, atraso_inicio, excesso_velocidade.',
      });
    }
    const renderizado = alertMsgTplRoutes.previewComExemplo(tipo, corpo);
    res.json({ renderizado });
  } catch (err) {
    console.error('Erro ao pré-visualizar mensagem de alerta:', err);
    res.status(500).json({ error: 'Erro ao gerar pré-visualização.' });
  }
});

// PUT /api/configuracoes/mensagens-alertas
router.put('/configuracoes/mensagens-alertas', towerAuthAndTenant, async (req, res) => {
  try {
    const body = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);

    const upsert = async (chave, valor, desc) => {
      const v = valor != null ? String(valor) : '';
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(UPSERT_CONFIG_SQL);
    };

    if (body.paradaCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_PARADA, body.paradaCorpo, 'Template WhatsApp: alerta parada prolongada');
    }
    if (body.atrasoCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_ATRASO, body.atrasoCorpo, 'Template WhatsApp: alerta atraso');
    }
    if (body.etaPrazoCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_ETA_PRAZO, body.etaPrazoCorpo, 'Template WhatsApp: alerta ETA preventivo');
    }
    if (body.offlineCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_OFFLINE, body.offlineCorpo, 'Template WhatsApp: alerta offline');
    }
    if (body.desvioCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_DESVIO, body.desvioCorpo, 'Template WhatsApp: alerta desvio de rota');
    }
    if (body.atrasoInicioCorpo !== undefined) {
      await upsert(alertMsgTplRoutes.CHAVE_ATRASO_INICIO, body.atrasoInicioCorpo, 'Template WhatsApp: alerta atraso para iniciar');
    }
    if (body.excessoVelocidadeCorpo !== undefined) {
      await upsert(
        alertMsgTplRoutes.CHAVE_EXCESSO_VELOCIDADE,
        body.excessoVelocidadeCorpo,
        'Template WhatsApp: alerta excesso de velocidade'
      );
    }

    res.json({ success: true, message: 'Modelos de mensagem de alerta salvos.' });
  } catch (err) {
    console.error('Erro ao salvar templates de alerta:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações.' });
  }
});

// GET /api/configuracoes/switch-digital - Retorna configurações da Switch Digital
router.get('/configuracoes/switch-digital', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .query(`
      SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
      WHERE "TENANT_ID" = @tenantId
        AND "CHAVE" IN (
        'switch_digital_endpoint', 'switch_digital_metodo', 'switch_digital_content_type',
        'switch_digital_token', 'switch_digital_user_id', 'switch_digital_queue_id',
        'switch_digital_send_signature', 'switch_digital_close_ticket'
      )
    `);
    
    const rows = result.recordset || [];
    const config = {
      switchEndpoint: 'https://api.switchdigital.com.br/api/messages/send',
      switchMetodo: 'POST',
      switchContentType: 'application/json',
      switchToken: '',
      switchUserId: '',
      switchQueueId: '',
      switchSendSignature: 'S',
      switchCloseTicket: 'S'
    };

    rows.forEach(r => {
      const chave = r.CHAVE || r.chave;
      const valor = r.VALOR || r.valor;
      if (chave === 'switch_digital_endpoint') config.switchEndpoint = valor;
      if (chave === 'switch_digital_metodo') config.switchMetodo = valor;
      if (chave === 'switch_digital_content_type') config.switchContentType = valor;
      if (chave === 'switch_digital_token') config.switchToken = valor;
      if (chave === 'switch_digital_user_id') config.switchUserId = valor;
      if (chave === 'switch_digital_queue_id') config.switchQueueId = valor;
      if (chave === 'switch_digital_send_signature') config.switchSendSignature = valor;
      if (chave === 'switch_digital_close_ticket') config.switchCloseTicket = valor;
    });

    res.json(config);
  } catch (err) {
    console.error('Erro ao buscar configuracoes da Switch Digital:', err);
    res.status(500).json({ error: 'Erro ao buscar configuracoes' });
  }
});

// PUT /api/configuracoes/switch-digital - Atualiza configurações da Switch Digital
router.put('/configuracoes/switch-digital', towerAuthAndTenant, async (req, res) => {
  try {
    const { switchEndpoint, switchMetodo, switchContentType, switchToken, switchUserId, switchQueueId, switchSendSignature, switchCloseTicket } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);

    const upsert = async (chave, valor, desc) => {
      if (valor == null) return;
      const v = String(valor).trim();
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', chave)
        .input('valor', v)
        .input('desc', desc)
        .query(UPSERT_CONFIG_SQL);
    };

    await upsert('switch_digital_endpoint', switchEndpoint, 'Endpoint da API Switch Digital');
    await upsert('switch_digital_metodo', switchMetodo, 'Método HTTP (POST, GET)');
    await upsert('switch_digital_content_type', switchContentType, 'Content-Type da API');
    await upsert('switch_digital_token', switchToken, 'Token Bearer para API Switch Digital');
    await upsert('switch_digital_user_id', switchUserId, 'ID de Usuário padrão para Switch Digital');
    await upsert('switch_digital_queue_id', switchQueueId, 'ID da Fila padrão para Switch Digital');
    await upsert('switch_digital_send_signature', switchSendSignature, 'Assinar mensagem Switch Digital (S/N)');
    await upsert('switch_digital_close_ticket', switchCloseTicket, 'Encerrar ticket Switch Digital (S/N)');

    res.json({ success: true, message: 'Configurações salvas com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configuracoes Switch Digital:', err);
    res.status(500).json({ error: 'Erro interno ao salvar configurações' });
  }
});

// POST /api/configuracoes/switch-digital/teste - Rota para testar o envio a partir da tela de configuração
router.post('/configuracoes/switch-digital/teste', towerAuthAndTenant, async (req, res) => {
  try {
    const { numero, config } = req.body;
    
    if (!numero || !config || !config.endpoint || !config.token) {
      return res.status(400).json({ success: false, error: 'Número, Endpoint e Token são obrigatórios para o teste.' });
    }

    // Montar o corpo (body) de acordo com o que a Switch Digital espera
    const requestBody = {
      number: numero,
      body: "Olá! Esta é uma mensagem de teste do sistema Atlas Cargo para a integração Switch Digital.",
      sendSignature: config.sendSignature,
      closeTicket: config.closeTicket
    };

    // Só adiciona userId e queueId se estiverem preenchidos e não forem vazios
    if (config.userId && config.userId.trim() !== '') {
      requestBody.userId = config.userId.trim();
    }
    if (config.queueId && config.queueId.trim() !== '') {
      requestBody.queueId = config.queueId.trim();
    }

    // Configurar o fetch nativo do NodeJS
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    console.log(`[Switch Digital Teste] Disparando para: ${config.endpoint} | Metodo: ${config.metodo}`);
    
    const response = await fetch(config.endpoint, {
      method: config.metodo || 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': config.contentType || 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseText);
    } catch (e) {
      responseData = responseText; // Caso a API retorne algo que não é JSON
    }

    if (!response.ok) {
      console.error('[Switch Digital Teste] Falha na API:', response.status, responseData);
      return res.status(response.status).json({ 
        success: false, 
        error: `A API retornou status ${response.status}`, 
        details: responseData 
      });
    }

    res.json({ success: true, apiResponse: responseData });

  } catch (err) {
    console.error('Erro na rota de teste da Switch Digital:', err);
    res.status(500).json({ success: false, error: 'Erro interno no servidor ao tentar conectar com a API', details: err.message });
  }
});

// POST /api/configuracoes/switch-digital/disparo-oportunidade/preview — normaliza telefones e monta prévia (sem enviar)
router.post('/configuracoes/switch-digital/disparo-oportunidade/preview', towerAuthAndTenant, async (req, res) => {
  try {
    const { template, linhasTexto } = req.body || {};
    if (template == null || String(template).trim() === '') {
      return res.status(400).json({ error: 'Informe o texto do modelo (template) da mensagem.' });
    }
    const prev = await switchDisparoOportunidade.preview(pgPool, String(template), String(linhasTexto || ''));
    const validos = prev.linhas.filter((l) => !l.erro && l.telefoneE164).length;
    const invalidos = prev.total - validos;
    res.json({ ...prev, validos, invalidos });
  } catch (err) {
    console.error('[disparo-oportunidade] preview:', err);
    res.status(500).json({ error: 'Erro ao gerar prévia.', details: err.message });
  }
});

// POST /api/configuracoes/switch-digital/disparo-oportunidade/enviar — envia uma mensagem por linha (Switch Digital)
router.post('/configuracoes/switch-digital/disparo-oportunidade/enviar', towerAuthAndTenant, async (req, res) => {
  try {
    const { template, linhasTexto, delayMs, maxLinhas } = req.body || {};
    if (template == null || String(template).trim() === '') {
      return res.status(400).json({ error: 'Informe o texto do modelo (template) da mensagem.' });
    }
    const delay = Math.min(5000, Math.max(200, Number(delayMs) || 650));
    const max = Math.min(2000, Math.max(1, Number(maxLinhas) || 500));
    const tid = tenantIdForRequest(req);
    const { switch: switchCfg } = await alertNotificationService.getConfig(pgPool, tid);
    if (!switchCfg.token || String(switchCfg.token).trim() === '') {
      return res.status(400).json({ error: 'Token Switch Digital não configurado.' });
    }
    const prev = await switchDisparoOportunidade.preview(pgPool, String(template), String(linhasTexto || ''));
    const enviados = [];
    const vistos = new Set();
    let ignoradosDuplicata = 0;
    let apiCalls = 0;
    for (const lin of prev.linhas) {
      if (apiCalls >= max) break;
      if (lin.erro || !lin.telefoneE164) continue;
      if (vistos.has(lin.telefoneE164)) {
        ignoradosDuplicata += 1;
        continue;
      }
      vistos.add(lin.telefoneE164);
      const corpo = switchDisparoOportunidade.aplicarTemplate(String(template), lin.nome);
      const r = await alertNotificationService.sendViaSwitch(switchCfg, lin.telefoneE164, corpo);
      enviados.push({
        nome: lin.nome,
        telefoneE164: lin.telefoneE164,
        ok: r.ok,
        erro: r.error || null,
        statusHttp: r.statusHttp
      });
      apiCalls += 1;
      if (apiCalls < max) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    res.json({
      success: true,
      totalLinhas: prev.total,
      enviadosCount: enviados.filter((e) => e.ok).length,
      falhasCount: enviados.filter((e) => !e.ok).length,
      ignoradosDuplicata,
      limiteMax: max,
      detalhes: enviados
    });
  } catch (err) {
    console.error('[disparo-oportunidade] enviar:', err);
    res.status(500).json({ error: 'Erro ao enviar mensagens.', details: err.message });
  }
});

// GET /api/configuracoes/alertas - Retorna configurações de alertas (chaves alert_* e alert_whatsapp_*)
router.get('/configuracoes/alertas', async (req, res) => {
  try {
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const config = await alertService.getAlertConfig(pool, true, tid);
    const whatsappResult = await pool.query(
      'SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO" WHERE "CHAVE" LIKE $1 AND "TENANT_ID" = $2',
      ['alert_whatsapp%', tid]
    );
    (whatsappResult.rows || []).forEach(r => {
      const k = r.CHAVE || r.chave;
      const v = r.VALOR != null ? r.VALOR : r.valor;
      if (k) config[k] = v != null ? String(v).trim() : '';
    });
    res.json(config);
  } catch (err) {
    console.error('Erro ao buscar configurações de alertas:', err);
    res.json(alertService.ALERT_CONFIG_DEFAULTS || {});
  }
});

// PUT /api/configuracoes/alertas - Atualiza configurações de alertas
router.put('/configuracoes/alertas', towerAuthAndTenant, async (req, res) => {
  try {
    const body = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const defaults = alertService.ALERT_CONFIG_DEFAULTS || {};
    const keys = [
      'alert_offline_minutos', 'alert_parada_velocidade_max', 'alert_parada_minutos_min', 'alert_parada_janela_posicoes', 'alert_parada_raio_metros',
      'alert_desvio_metros', 'alert_desvio_suprimir_quando_parado_ativo', 'alert_atraso_margem_minutos', 'alert_atraso_inicio_margem_minutos', 'alert_excesso_velocidade_kmh', 'alert_excesso_velocidade_janela',
      'alert_job_intervalo_minutos', 'alert_cooldown_minutos', 'alert_whatsapp_reenvio_minutos',
      'alert_heartbeat_ativo', 'alert_heartbeat_intervalo_minutos', 'alert_heartbeat_tipos', 'alert_job_ativo',
      'alert_tipo_parada_ativo', 'alert_tipo_atraso_ativo', 'alert_tipo_eta_prazo_ativo', 'alert_tipo_offline_ativo', 'alert_tipo_desvio_ativo',
      'alert_tipo_atraso_inicio_ativo', 'alert_tipo_excesso_velocidade_ativo', 'alert_tipo_parada_sem_reinicio_ativo',
      'alert_situacoes_viagem', 'alert_fgsitviagem',
      'alert_whatsapp_ativo', 'alert_whatsapp_notificar_motorista', 'alert_whatsapp_notificar_programador', 'alert_whatsapp_notificar_central',
      'alert_whatsapp_celular_central',
      'alert_whatsapp_tipo_parada', 'alert_whatsapp_tipo_atraso', 'alert_whatsapp_tipo_eta_prazo', 'alert_whatsapp_tipo_offline',
      'alert_whatsapp_tipo_desvio', 'alert_whatsapp_tipo_atraso_inicio', 'alert_whatsapp_tipo_excesso_velocidade'
    ];
    const descricoes = {
      alert_offline_minutos: 'Minutos sem posição para alerta offline',
      alert_parada_velocidade_max: 'Velocidade máxima (km/h) considerada parado',
      alert_parada_minutos_min: 'Minutos mínimos parado para gerar alerta',
      alert_parada_janela_posicoes: 'Quantidade de posições na janela (60 min)',
      alert_parada_raio_metros: 'Raio máximo (m) para considerar parado por concentração GPS',
      alert_desvio_metros: 'Distância mínima (m) da rota para alerta de desvio',
      alert_desvio_suprimir_quando_parado_ativo: 'Suprimir alerta de desvio quando veículo estiver parado (S/N)',
      alert_atraso_margem_minutos: 'Margem em minutos para atraso',
      alert_atraso_inicio_margem_minutos: 'Minutos após DTPREVINICIO para considerar atraso ao iniciar',
      alert_excesso_velocidade_kmh: 'Velocidade máxima (km/h) permitida para alerta de excesso',
      alert_excesso_velocidade_janela: 'Quantidade de posições para excesso de velocidade',
      alert_job_intervalo_minutos: 'Intervalo do job de verificação (minutos)',
      alert_cooldown_minutos: 'Cooldown mínimo (min) para repetir o mesmo alerta na mesma viagem',
      alert_whatsapp_reenvio_minutos: 'Cooldown mínimo (min) para reenviar WhatsApp do mesmo tipo/destino',
      alert_heartbeat_ativo: 'Heartbeat de lembrete para alertas pendentes (S/N)',
      alert_heartbeat_intervalo_minutos: 'Intervalo do heartbeat de lembrete (minutos)',
      alert_heartbeat_tipos: 'Tipos com heartbeat (CSV, ex.: PARADA,OFFLINE)',
      alert_job_ativo: 'Job de alertas ativo (S/N)',
      alert_tipo_parada_ativo: 'Gerar alerta parada prolongada (S/N)',
      alert_tipo_atraso_ativo: 'Gerar alerta atraso (S/N)',
      alert_tipo_eta_prazo_ativo: 'Gerar alerta ETA > prazo (S/N)',
      alert_tipo_offline_ativo: 'Gerar alerta offline (S/N)',
      alert_tipo_desvio_ativo: 'Gerar alerta desvio de rota (S/N)',
      alert_tipo_atraso_inicio_ativo: 'Gerar alerta atraso para iniciar viagem (S/N)',
      alert_tipo_excesso_velocidade_ativo: 'Gerar alerta excesso de velocidade (S/N)',
      alert_tipo_parada_sem_reinicio_ativo: 'Gerar alerta deslocamento após macro de parada sem reinício (S/N)',
      alert_situacoes_viagem: 'Códigos de situação que disparam verificação (vírgula)',
      alert_fgsitviagem: 'Códigos FGSITVIAGEM que entram na verificação (ex.: P,T,A,M)',
      alert_whatsapp_ativo: 'Enviar WhatsApp ao gerar alerta (S/N)',
      alert_whatsapp_notificar_motorista: 'Notificar motorista por WhatsApp (S/N)',
      alert_whatsapp_notificar_programador: 'Notificar programador por WhatsApp (S/N)',
      alert_whatsapp_notificar_central: 'Notificar central por WhatsApp (S/N)',
      alert_whatsapp_celular_central: 'Celular da central (DDI+DDD+número) para alertas',
      alert_whatsapp_tipo_parada: 'Enviar WhatsApp para alerta parada prolongada (S/N)',
      alert_whatsapp_tipo_atraso: 'Enviar WhatsApp para alerta atraso (S/N)',
      alert_whatsapp_tipo_eta_prazo: 'Enviar WhatsApp para alerta ETA preventivo (S/N)',
      alert_whatsapp_tipo_offline: 'Enviar WhatsApp para alerta offline (S/N)',
      alert_whatsapp_tipo_desvio: 'Enviar WhatsApp para alerta desvio de rota (S/N)',
      alert_whatsapp_tipo_atraso_inicio: 'Enviar WhatsApp para alerta atraso para iniciar (S/N)',
      alert_whatsapp_tipo_excesso_velocidade: 'Enviar WhatsApp para alerta excesso de velocidade (S/N)'
    };
    for (const chave of keys) {
      if (body[chave] === undefined) continue;
      let valor = body[chave];
      if (typeof defaults[chave] === 'number') {
        const n = parseFloat(valor);
        if (isNaN(n) || n < 0) continue;
        if (chave === 'alert_offline_minutos' && (n < 1 || n > 1440)) continue;
        if (chave === 'alert_parada_velocidade_max' && (n < 0 || n > 50)) continue;
        if (chave === 'alert_parada_minutos_min' && (n < 1 || n > 120)) continue;
        if (chave === 'alert_parada_janela_posicoes' && (n < 2 || n > 200)) continue;
        if (chave === 'alert_parada_raio_metros' && (n < 20 || n > 1000)) continue;
        if (chave === 'alert_desvio_metros' && (n < 100 || n > 5000)) continue;
        if (chave === 'alert_atraso_inicio_margem_minutos' && (n < 0 || n > 120)) continue;
        if (chave === 'alert_excesso_velocidade_kmh' && (n < 60 || n > 200)) continue;
        if (chave === 'alert_excesso_velocidade_janela' && (n < 2 || n > 30)) continue;
        if (chave === 'alert_job_intervalo_minutos' && (n < 1 || n > 60)) continue;
        if (chave === 'alert_cooldown_minutos' && (n < 0 || n > 1440)) continue;
        if (chave === 'alert_whatsapp_reenvio_minutos' && (n < 0 || n > 1440)) continue;
        if (chave === 'alert_heartbeat_intervalo_minutos' && (n < 1 || n > 1440)) continue;
        valor = String(n);
      } else if (chave === 'alert_job_ativo' || chave === 'alert_heartbeat_ativo' || chave === 'alert_desvio_suprimir_quando_parado_ativo' || chave.startsWith('alert_tipo_') || chave === 'alert_whatsapp_ativo' ||
          chave === 'alert_whatsapp_notificar_motorista' || chave === 'alert_whatsapp_notificar_programador' || chave === 'alert_whatsapp_notificar_central' ||
          chave.startsWith('alert_whatsapp_tipo_')) {
        valor = (valor === true || valor === 'S' || valor === 's' || valor === '1') ? 'S' : 'N';
      } else if (chave === 'alert_whatsapp_celular_central') {
        valor = valor != null ? String(valor).trim() : '';
      } else {
        valor = valor != null ? String(valor).trim() : '';
      }
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', chave)
        .input('valor', valor)
        .input('desc', descricoes[chave] || chave)
        .query(UPSERT_CONFIG_SQL);
    }
    try {
      alertService.clearAlertConfigCache(tid);
    } catch (_) { /* ignore */ }

    let jobIntervalReiniciado = false;
    const defTid = getDefaultTenantId();
    if (tid === defTid && body.alert_job_intervalo_minutos !== undefined) {
      const reiniciar = req.app && typeof req.app.get === 'function' ? req.app.get('restartAlertJob') : null;
      if (typeof reiniciar === 'function') {
        try {
          reiniciar();
          jobIntervalReiniciado = true;
        } catch (reErr) {
          console.error('[Alertas] Falha ao reiniciar job após alterar intervalo:', reErr.message);
        }
      }
    }

    const message = jobIntervalReiniciado
      ? 'Configurações salvas. O intervalo do job de alertas foi aplicado imediatamente (sem reinício manual do servidor). Os demais parâmetros passam a valer no próximo ciclo de verificação.'
      : 'Configurações de alertas salvas. O job usará os novos valores na próxima execução.';
    res.json({ success: true, message, jobIntervalReiniciado });
  } catch (err) {
    console.error('Erro ao salvar configurações de alertas:', err);
    res.status(500).json({ error: 'Erro ao salvar configurações. Verifique se a tabela CONFIGURACAO existe.' });
  }
});

// PUT /api/configuracoes/identidade - Atualiza configurações de identidade visual
router.put('/configuracoes/identidade', towerAuthAndTenant, async (req, res) => {
  try {
    const { logoRetangular, logoQuadrada } = req.body || {};
    const pool = await poolPromise;
    const tid = tenantIdForRequest(req);
    const safeName = (v) => (v != null ? String(v).trim().replace(/[^a-zA-Z0-9._-]/g, '') : '');

    if (logoRetangular != null) {
      const val = safeName(logoRetangular) || DEFAULT_LOGO_RETANGULAR;
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', CHAVE_LOGO_RETANGULAR)
        .input('valor', val)
        .input('desc', 'Logo retangular (login, sidebar)')
        .query(UPSERT_CONFIG_SQL);
    }
    if (logoQuadrada != null) {
      const val = safeName(logoQuadrada) || DEFAULT_LOGO_QUADRADA;
      await pool
        .request()
        .input('tenantId', sqlCfg.NVarChar(64), tid)
        .input('chave', CHAVE_LOGO_QUADRADA)
        .input('valor', val)
        .input('desc', 'Logo quadrada (favicon, PWA)')
        .query(UPSERT_CONFIG_SQL);
    }

    res.json({ success: true, message: 'Identidade visual salva com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar configurações de identidade:', err);
    res.status(500).json({ error: 'Erro ao salvar identidade visual. Verifique se a tabela CONFIGURACAO existe no banco.' });
  }
});

module.exports = router;
