'use strict';

const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { normalizarFiltrosProdutoQuery } = require('../services/wms-relatorio-filtro-produto.service');
const { coletarLinhasShelf, parseShelfOpts } = require('../services/wms-shelf-linhas-coleta.service');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');
const { pool } = require('../config/db');
const {
  listarMotivosBaixa,
  previewBaixaEstoque,
  confirmarBaixaEstoque,
  listarHistoricoBaixas,
  obterBaixaEstoque,
  estornarBaixaEstoque,
} = require('../services/wms-baixa-estoque.service');
const { buildBaixaEstoqueHtml } = require('../services/wms-baixa-estoque-html.service');

function pickFiltrosBaixa(req) {
  const q = { ...(req.query || {}), ...((req.body && typeof req.body === 'object' && req.body) || {}) };
  const prod = normalizarFiltrosProdutoQuery(q);
  return {
    cdDono: q.cdDono != null && String(q.cdDono).trim() !== '' ? q.cdDono : null,
    codigoProduto: prod.codigoProduto,
    descricaoProduto: prod.descricaoProduto,
    conservacao: prod.conservacao,
    grupoProduto: prod.grupoProduto,
    categoriaProduto: prod.categoriaProduto,
    cdGrupo: prod.cdGrupo,
    cdCategoria: prod.cdCategoria,
  };
}

function parseCdMotivo(body) {
  const b = body && typeof body === 'object' ? body : {};
  return b.cdMotivoBaixa != null ? b.cdMotivoBaixa : b.cdMotivo != null ? b.cdMotivo : b.codigoMotivo;
}

async function enriquecerLinhasComProduto(tenantId, cdDono, linhas) {
  const tid = String(tenantId || '').trim();
  const dono = parseInt(cdDono, 10);
  if (!Number.isFinite(dono)) return linhas || [];
  const out = [];
  for (const raw of linhas || []) {
    if (!raw) continue;
    let cdProd = raw.CD_PRODUTO != null ? parseInt(raw.CD_PRODUTO, 10) : parseInt(raw.cdProduto, 10);
    if (Number.isFinite(cdProd)) {
      out.push(Object.assign({}, raw, { CD_PRODUTO: cdProd, CD_DONO: raw.CD_DONO != null ? raw.CD_DONO : dono }));
      continue;
    }
    const cod = String(raw.CODIGO_PRODUTO || raw.codigoProduto || '').trim();
    if (!cod) continue;
    const hit = await resolverProdutoEstoque(pool, tid, dono, cod, {});
    if (!hit || hit.cdProduto == null) continue;
    out.push(
      Object.assign({}, raw, {
        CD_DONO: dono,
        CD_PRODUTO: hit.cdProduto,
        CODIGO_PRODUTO: cod,
        NM_PRODUTO: raw.NM_PRODUTO || hit.nmProduto || hit.NM_PRODUTO || null,
      })
    );
  }
  return out;
}

async function resolverProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = parseInt(req.query.cdDono, 10);
    const codigo = String(req.query.codigo || '').trim();
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Informe o dono do estoque (cdDono).' });
    }
    if (!codigo) {
      return res.status(400).json({ error: 'Informe o código do produto.' });
    }
    const hit = await resolverProdutoEstoque(pool, tid, cdDono, codigo, {});
    if (!hit || hit.cdProduto == null) {
      return res.status(404).json({
        error: 'Produto não encontrado no estoque deste dono. Confira o código e o cadastro.',
      });
    }
    return res.json({
      ok: true,
      cdDono,
      cdProduto: hit.cdProduto,
      codigoProduto: hit.codigoEstoque || codigo,
      codigoInformado: codigo,
      nmProduto: hit.nmProduto || null,
      unidade: hit.unidade || null,
      fgControlaLote: hit.fgControlaLote === 'S' || hit.fgControlaLote === true ? 'S' : 'N',
      fgControlaValidade: hit.fgControlaValidade === 'S' || hit.fgControlaValidade === true ? 'S' : 'N',
      origem: hit.origem || null,
    });
  } catch (e) {
    console.error('[WMS baixas] resolverProduto:', e);
    return res.status(500).json({ error: 'Erro ao resolver produto.' });
  }
}

async function listarMotivos(req, res) {
  try {
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const motivos = await listarMotivosBaixa();
    return res.json({ motivos });
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] listarMotivos:', e);
    return res.status(500).json({ error: 'Erro ao listar motivos de baixa.' });
  }
}

async function listar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const f = pickFiltrosBaixa(req);
    let lim = parseInt(req.query.limit ?? req.query.limite, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 100;
    const out = await listarHistoricoBaixas(tid, {
      cdDono: f.cdDono,
      limit: lim,
      stBaixa: req.query.stBaixa ?? req.query.status,
      dataInicio: req.query.dataInicio ?? req.query.data_inicio,
      dataFim: req.query.dataFim ?? req.query.data_fim,
    });
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] listar:', e);
    return res.status(500).json({ error: 'Erro ao listar baixas.' });
  }
}

async function obter(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await obterBaixaEstoque(tid, req.params.cdBaixa);
    if (!out.ok) return res.status(404).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] obter:', e);
    return res.status(500).json({ error: 'Erro ao obter baixa.' });
  }
}

async function imprimir(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await obterBaixaEstoque(tid, req.params.cdBaixa);
    if (!out.ok) return res.status(404).json(out);
    const geradoEm = new Date().toISOString();
    const html = buildBaixaEstoqueHtml({
      cabecalho: out.cabecalho,
      linhas: out.linhas || [],
      geradoEm,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] imprimir:', e);
    return res.status(500).json({ error: 'Erro ao gerar documento para impressão.' });
  }
}

async function preview(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const cdMotivo = parseCdMotivo(body);
    const f = pickFiltrosBaixa(req);
    const cdDono = body.cdDono != null ? body.cdDono : f.cdDono;
    let linhas = Array.isArray(body.linhas) ? body.linhas : [];
    if (body.importarShelf === true || body.marcarFiltroAtual === true) {
      const opts = parseShelfOpts(body);
      linhas = await coletarLinhasShelf(tid, { ...f, cdDono }, opts);
    }
    linhas = await enriquecerLinhasComProduto(tid, cdDono, linhas);
    const out = await previewBaixaEstoque(tid, cdMotivo, linhas, { cdDonoUnico: cdDono });
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] preview:', e);
    return res.status(500).json({ error: 'Erro ao montar prévia da baixa.' });
  }
}

async function confirmar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const cdMotivo = parseCdMotivo(body);
    const f = pickFiltrosBaixa(req);
    const cdDono = body.cdDono != null ? body.cdDono : f.cdDono;
    let linhas = Array.isArray(body.linhas) ? body.linhas : [];
    if (!linhas.length && (body.importarShelf === true || body.marcarFiltroAtual === true)) {
      const opts = parseShelfOpts(body);
      linhas = await coletarLinhasShelf(tid, { ...f, cdDono }, opts);
    }
    linhas = await enriquecerLinhasComProduto(tid, cdDono, linhas);
    const out = await confirmarBaixaEstoque(tid, sg, {
      cdMotivoBaixa: cdMotivo,
      linhas,
      cdDono,
      observacao: body.observacao,
      marcarApontados: body.marcarApontados === true,
      origem: body.origem || 'MANUAL',
    });
    if (!out.ok) return res.status(400).json(out);
    return res.status(201).json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] confirmar:', e);
    return res.status(500).json({ error: 'Erro ao confirmar baixa de estoque.' });
  }
}

async function importarShelf(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const f = pickFiltrosBaixa(req);
    const cdDono = body.cdDono != null ? body.cdDono : f.cdDono;
    if (!cdDono) return res.status(400).json({ error: 'Informe o dono do estoque.' });
    const opts = parseShelfOpts(body);
    const linhas = await coletarLinhasShelf(tid, { ...f, cdDono }, opts);
    return res.json({ ok: true, linhas, total: linhas.length, cdDono });
  } catch (e) {
    console.error('[WMS baixas] importarShelf:', e);
    return res.status(500).json({ error: 'Erro ao importar linhas do shelf-life.' });
  }
}

async function estornar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const out = await estornarBaixaEstoque(tid, req.params.cdBaixa, sg, {
      observacao: body.observacao ?? body.motivoEstorno,
    });
    if (!out.ok) return res.status(400).json(out);
    return res.json(out);
  } catch (e) {
    if (e && e.code === 'SCHEMA') return res.status(503).json({ error: e.message });
    console.error('[WMS baixas] estornar:', e);
    return res.status(500).json({ error: 'Erro ao estornar baixa.' });
  }
}

module.exports = {
  listarMotivos,
  listar,
  obter,
  imprimir,
  preview,
  confirmar,
  importarShelf,
  estornar,
  resolverProduto,
};
