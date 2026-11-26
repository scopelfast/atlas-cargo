'use strict';

const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { criarPedido } = require('../services/pedido-acesso.service');
const { consultarDocumento, digitos } = require('../services/consulta-publica.service');

const janelaMs = 15 * 60 * 1000;
const maxPorJanela = 8;
const maxConsultaPorJanela = 30;
const porIp = new Map();
const consultaPorIp = new Map();

function limitadoEm(mapa, ip, max) {
  const agora = Date.now();
  const lista = (mapa.get(ip) || []).filter((t) => agora - t < janelaMs);
  if (lista.length >= max) {
    mapa.set(ip, lista);
    return true;
  }
  lista.push(agora);
  mapa.set(ip, lista);
  return false;
}

function limitado(ip) {
  return limitadoEm(porIp, ip, maxPorJanela);
}

router.post('/pedido-acesso', async (req, res) => {
  try {
    const ip = req.ip || 'local';
    if (limitado(ip)) {
      return res.status(429).json({ error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    }
    const pool = await poolPromise;
    const out = await criarPedido(pool, req.body || {});
    if (out.error) return res.status(out.status).json({ error: out.error, code: out.code || null });
    const avisou = out.whatsapp === 'ENVIADO';
    res.status(201).json({
      success: true,
      whatsapp: avisou ? 'ENVIADO' : 'PENDENTE',
      message: avisou
        ? 'Pedido enviado. Avisamos este celular no WhatsApp. A empresa aguarda liberação.'
        : 'Pedido enviado. A empresa fica aguardando liberação.',
    });
  } catch (err) {
    console.error('[pedido-acesso]', err);
    res.status(500).json({ error: 'Não foi possível registrar o pedido.' });
  }
});

router.get('/consulta-cnpj/:doc', async (req, res) => {
  try {
    const ip = req.ip || 'local';
    if (limitadoEm(consultaPorIp, ip, maxConsultaPorJanela)) {
      return res.status(429).json({ error: 'Muitas consultas. Espere alguns minutos e tente de novo.' });
    }
    if (digitos(req.params.doc).length !== 14) {
      return res.status(422).json({ error: 'Informe o CNPJ com 14 dígitos.' });
    }
    const pool = await poolPromise;
    const out = await consultarDocumento(pool, req.params.doc);
    res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[consulta-cnpj]', err.message);
    res.status(500).json({ error: 'Não foi possível consultar o CNPJ.' });
  }
});

module.exports = router;
