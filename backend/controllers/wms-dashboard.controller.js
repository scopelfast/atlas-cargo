'use strict';

const multer = require('multer');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const svc = require('../services/wms-dashboard-resumo.service');
const valorSvc = require('../services/wms-estoque-valor.service');
const cobrancaSvc = require('../services/wms-cobranca-operacional.service');

const uploadValorRef = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.csv') || n.endsWith('.txt') || n.endsWith('.xlsx') || n.endsWith('.xls')) {
      return cb(null, true);
    }
    cb(new Error('Envie arquivo .csv ou .xlsx.'));
  },
});

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/**
 * GET /api/wms/dashboard/resumo
 * Devolve KPIs agregados do tenant para o painel "Estoque / WMS — visão geral".
 * Cada bloco é tolerante a schema parcial (retorna null em vez de 503).
 */
async function obterResumo(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const resumo = await svc.obterResumoDashboard(tid);
    res.json(resumo);
  } catch (e) {
    console.error('[WMS dashboard] obterResumo:', e);
    res.status(500).json({ error: 'Erro ao gerar resumo do dashboard.' });
  }
}

/**
 * GET /api/wms/dashboard/valor-estoque
 * Dashboard de valor de estoque (R$) — hoje, série diária e picos D/S/Q/M.
 */
async function obterValorEstoque(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dash = await valorSvc.obterDashboardValorEstoque(tid, {
      cdDono: req.query.cdDono,
      dataRef: req.query.dataRef,
      dataIni: req.query.dataIni,
      dataFim: req.query.dataFim,
    });
    res.json(dash);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de valor de estoque ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] obterValorEstoque:', e);
    res.status(500).json({ error: 'Erro ao gerar dashboard de valor de estoque.' });
  }
}

/**
 * GET /api/wms/dashboard/valor-estoque/posicao
 * Posição valorizada detalhada (tempo real).
 */
async function obterPosicaoValorizada(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await valorSvc.calcularPosicaoValorizada(tid, req.query.cdDono);
    res.json(out);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de valor de estoque ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] obterPosicaoValorizada:', e);
    res.status(500).json({ error: 'Erro ao calcular posição valorizada.' });
  }
}

/**
 * GET /api/wms/dashboard/valor-estoque/posicao.csv
 */
async function exportarPosicaoValorizadaCsv(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await valorSvc.calcularPosicaoValorizada(tid, req.query.cdDono);
    let linhas = out.linhas || [];
    if (String(req.query.semPreco || '').toUpperCase() === 'S') {
      linhas = linhas.filter((l) => String(l.FONTE_PRECO) === 'SEM_PRECO');
    }
    const csv = valorSvc.linhasPosicaoParaCsv(linhas);
    const ts = new Date().toISOString().slice(0, 10);
    const sufixo = String(req.query.semPreco || '').toUpperCase() === 'S' ? '_sem_preco' : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="posicao_valorizada${sufixo}_${ts}.csv"`);
    res.send(csv);
  } catch (e) {
    console.error('[WMS dashboard] exportarPosicaoValorizadaCsv:', e);
    res.status(500).json({ error: 'Erro ao exportar CSV.' });
  }
}

/**
 * POST /api/wms/dashboard/valor-estoque/snapshot
 * Gera snapshot de hoje (todos os donos ou um dono).
 */
async function gerarSnapshotValorHoje(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dt = valorSvc.hojeIsoTz();
    const cdDono = req.body?.cdDono != null ? parseInt(req.body.cdDono, 10) : null;
    let gravados = [];
    if (Number.isFinite(cdDono)) {
      gravados.push(await valorSvc.gravarSnapshotDiario(tid, cdDono, dt));
    } else {
      gravados = await valorSvc.executarSnapshotsTenant(tid, dt);
    }
    res.json({ ok: true, dt, gravados });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de valor de estoque ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] gerarSnapshotValorHoje:', e);
    res.status(500).json({ error: 'Erro ao gravar snapshot de valor.' });
  }
}

/**
 * POST /api/wms/dashboard/valor-estoque/snapshot/backfill
 * Gera snapshots diários retroativos (saldo/preço as-of) no mês da referência.
 */
async function gerarBackfillSnapshots(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dataRef = req.body?.dataRef || req.query?.dataRef;
    const periodo = valorSvc.resolverPeriodoBackfill(dataRef);
    if (!periodo || !periodo.dias.length) {
      return res.status(400).json({
        error:
          'Nenhum dia no período. Ajuste «Referência (mês)» — backfill desde 18/05/2026 até hoje dentro do mês.',
      });
    }
    const cdDono = req.body?.cdDono != null ? parseInt(req.body.cdDono, 10) : null;
    const r = await valorSvc.executarBackfillSnapshots(
      tid,
      periodo.dtIni,
      periodo.dtFim,
      Number.isFinite(cdDono) ? cdDono : null
    );
    res.json({
      ok: true,
      dataRef: dataRef || valorSvc.hojeIsoTz(),
      dtIni: periodo.dtIni,
      dtFim: periodo.dtFim,
      dias: periodo.dias.length,
      ...r,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de valor de estoque ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] gerarBackfillSnapshots:', e);
    res.status(500).json({ error: 'Erro ao gerar snapshots retroativos.' });
  }
}

/**
 * POST /api/wms/dashboard/valor-estoque/importar-valor-referencia
 * CSV/XLSX exportado pelo módulo com coluna VLR_UNITARIO ou VALOR_REFERENCIA preenchida.
 */
function importarValorReferenciaPlanilha(req, res) {
  uploadValorRef.single('arquivo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload.' });
    try {
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Envie o arquivo no campo "arquivo".' });
      }
      const nome = (req.file.originalname || '').toLowerCase();
      let brutas;
      if (nome.endsWith('.xlsx') || nome.endsWith('.xls')) {
        const XLSX = require('xlsx');
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        brutas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      } else {
        brutas = valorSvc.parseCsvValorReferencia(req.file.buffer.toString('utf8'));
      }
      const linhas = valorSvc.linhasPlanilhaParaImportValorReferencia(brutas);
      if (!linhas.length) {
        return res.status(422).json({
          error:
            'Nenhuma linha válida. Preencha VLR_UNITARIO (ou VALOR_REFERENCIA) e mantenha CD_DONO + CD_PRODUTO.',
        });
      }
      const dryRun = String(req.query.dryRun || req.body?.dryRun || '').toUpperCase() === 'S';
      const r = await valorSvc.aplicarImportValorReferencia(tid, linhas, { dryRun });
      res.json({ ok: true, ...r });
    } catch (e) {
      if (schemaMissing(e)) {
        return res.status(503).json({
          error:
            'Coluna VALOR_REFERENCIA ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
        });
      }
      console.error('[WMS dashboard] importarValorReferenciaPlanilha:', e);
      res.status(500).json({ error: 'Erro ao importar valores.' });
    }
  });
}

/**
 * GET /api/wms/dashboard/cobranca-operacional
 * Armazenagem (pico snapshots) + expedição (NF expedidas) no período.
 */
async function obterCobrancaOperacional(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dash = await cobrancaSvc.obterDashboardCobrancaOperacional(tid, {
      cdDono: req.query.cdDono,
      dataIni: req.query.dataIni,
      dataFim: req.query.dataFim,
    });
    res.json(dash);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de cobrança ausente. Execute backend/scripts/adicionar_wms_dono_cobranca_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] obterCobrancaOperacional:', e);
    res.status(500).json({ error: 'Erro ao gerar cobrança operacional.' });
  }
}

/**
 * GET /api/wms/dashboard/cobranca-operacional/resumo.csv
 */
async function exportarCobrancaOperacionalResumoCsv(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dash = await cobrancaSvc.obterDashboardCobrancaOperacional(tid, {
      cdDono: req.query.cdDono,
      dataIni: req.query.dataIni,
      dataFim: req.query.dataFim,
    });
    const csv = cobrancaSvc.linhasResumoConsolidadoParaCsv(dash);
    const p = dash.periodo || {};
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cobranca_operacional_${p.dataIni || ''}_${p.dataFim || ''}.csv"`
    );
    res.send(csv);
  } catch (e) {
    console.error('[WMS dashboard] exportarCobrancaOperacionalResumoCsv:', e);
    res.status(500).json({ error: 'Erro ao exportar CSV.' });
  }
}

/**
 * GET /api/wms/dashboard/cobranca-operacional/expedicao.csv
 */
async function exportarCobrancaExpedicaoCsv(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const dash = await cobrancaSvc.obterDashboardCobrancaOperacional(tid, {
      cdDono: req.query.cdDono,
      dataIni: req.query.dataIni,
      dataFim: req.query.dataFim,
    });
    const csv = cobrancaSvc.linhasExpedicaoParaCsv(dash.expedicao && dash.expedicao.linhasNf);
    const p = dash.periodo || {};
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cobranca_expedicao_nf_${p.dataIni || ''}_${p.dataFim || ''}.csv"`
    );
    res.send(csv);
  } catch (e) {
    console.error('[WMS dashboard] exportarCobrancaExpedicaoCsv:', e);
    res.status(500).json({ error: 'Erro ao exportar CSV.' });
  }
}

/**
 * GET /api/wms/dashboard/valor-estoque/auditoria-um
 * Compara total antigo (vUnCom) vs novo (vProd/qtdConvertida).
 */
async function auditarPrecoUm(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const audit = await valorSvc.auditarAjustePrecoUm(tid, req.query.cdDono);
    if (String(req.query.formato || '').toLowerCase() === 'csv') {
      const linhas = [...(audit.topInfladores || []), ...(audit.topSubestimados || [])];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="auditoria_um_valor_estoque.csv"');
      return res.send(valorSvc.linhasAuditoriaUmParaCsv(linhas));
    }
    res.json(audit);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de valor de estoque ausente. Execute backend/scripts/adicionar_wms_estoque_valor_snapshot_postgres.sql.',
      });
    }
    console.error('[WMS dashboard] auditarPrecoUm:', e);
    res.status(500).json({ error: 'Erro na auditoria de UM/preço.' });
  }
}

module.exports = {
  obterResumo,
  obterValorEstoque,
  obterPosicaoValorizada,
  exportarPosicaoValorizadaCsv,
  gerarSnapshotValorHoje,
  gerarBackfillSnapshots,
  auditarPrecoUm,
  importarValorReferenciaPlanilha,
  obterCobrancaOperacional,
  exportarCobrancaOperacionalResumoCsv,
  exportarCobrancaExpedicaoCsv,
};
