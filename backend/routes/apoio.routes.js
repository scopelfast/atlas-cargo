'use strict';

const express = require('express');
const router = express.Router();
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const {
  requireMotoristaAuth,
  requireMotoristaOrTowerAuth,
} = require('../middleware/auth.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { poolPromise } = require('../config/db');
const apoio = require('../services/apoio-whatsapp.service');

function loginPainel(req) {
  const u = req.user || {};
  const h = req.headers || {};
  return String(h['user-login'] || u.login || u.SGUSUARIO || u.email || '').trim();
}

function loginMotorista(req) {
  const u = req.user || {};
  return String(u.login || u.SGUSUARIO || u.cdcadastro || u.cdCadastro || u.id || '').trim();
}

/** Status do canal (sem expor número completo). */
router.get('/status', requireMotoristaOrTowerAuth, async (req, res) => {
  try {
    const pool = await poolPromise;
    const st = await apoio.destinoEstaConfigurado(pool);
    res.json({
      success: true,
      destinoConfigurado: st.ok,
      destinoMascara: st.mascara,
      tiposAjuda: apoio.TIPOS_AJUDA,
    });
  } catch (e) {
    console.error('[apoio status]', e);
    res.status(500).json({ error: 'Erro ao consultar status do canal.' });
  }
});

router.post('/suporte', towerAuthAndTenant, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'PAINEL',
      tenantOrigem: tenantIdForRequest(req),
      usuario: loginPainel(req),
      assunto: body.assunto,
      descricao: body.descricao || body.mensagem,
      pagina: body.pagina || body.modulo,
      req,
    });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.message, code: r.code });
    res.json({ success: true, message: r.message, deduplicado: !!r.deduplicado });
  } catch (e) {
    console.error('[apoio suporte]', e);
    res.status(500).json({ success: false, error: 'Erro ao enviar suporte.' });
  }
});

router.post('/apoio', towerAuthAndTenant, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await apoio.enviarPedido({
      tipo: 'APOIO',
      origem: 'PAINEL',
      tenantOrigem: tenantIdForRequest(req),
      usuario: loginPainel(req),
      tipoAjuda: body.tipoAjuda || body.tipo,
      descricao: body.descricao || body.mensagem,
      pagina: body.pagina || body.modulo,
      req,
    });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.message, code: r.code });
    res.json({ success: true, message: r.message, deduplicado: !!r.deduplicado });
  } catch (e) {
    console.error('[apoio operacional]', e);
    res.status(500).json({ success: false, error: 'Erro ao enviar pedido de apoio.' });
  }
});

router.post('/motorista/suporte', requireMotoristaAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await apoio.enviarPedido({
      tipo: 'SUPORTE',
      origem: 'MOTORISTA',
      tenantOrigem: tenantIdForRequest(req),
      usuario: loginMotorista(req),
      assunto: body.assunto,
      descricao: body.descricao || body.mensagem,
      pagina: body.pagina || 'motorista/configuracoes',
      req,
    });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.message, code: r.code });
    res.json({ success: true, message: r.message, deduplicado: !!r.deduplicado });
  } catch (e) {
    console.error('[apoio mot suporte]', e);
    res.status(500).json({ success: false, error: 'Erro ao enviar suporte.' });
  }
});

router.post('/motorista/apoio', requireMotoristaAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const r = await apoio.enviarPedido({
      tipo: 'APOIO',
      origem: 'MOTORISTA',
      tenantOrigem: tenantIdForRequest(req),
      usuario: loginMotorista(req),
      tipoAjuda: body.tipoAjuda || body.tipo,
      descricao: body.descricao || body.mensagem,
      pagina: body.pagina || 'motorista/configuracoes',
      req,
    });
    if (!r.ok) return res.status(r.status || 400).json({ success: false, error: r.message, code: r.code });
    res.json({ success: true, message: r.message, deduplicado: !!r.deduplicado });
  } catch (e) {
    console.error('[apoio mot apoio]', e);
    res.status(500).json({ success: false, error: 'Erro ao enviar pedido de apoio.' });
  }
});

router.get('/log', towerAuthAndTenant, async (req, res) => {
  try {
    if (tenantIdForRequest(req) !== getDefaultTenantId()) {
      return res.status(403).json({ error: 'Só o tenant padrão consulta o log de suporte/apoio.' });
    }
    const pool = await poolPromise;
    const itens = await apoio.listarLog(pool, req.query || {});
    res.json({ success: true, itens });
  } catch (e) {
    console.error('[apoio log]', e);
    res.status(500).json({ error: 'Erro ao listar log.' });
  }
});

module.exports = router;
