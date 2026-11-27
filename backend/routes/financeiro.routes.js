'use strict';

const express = require('express');
const router = express.Router();
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const {
  requireAtlasPay,
  requireFinPerm,
  loginReq,
  ipReq,
} = require('../middleware/financeiro-auth.middleware');
const {
  sessionTenantId,
  dataTenantId,
  resolveFinTenantAlvo,
  listarAgentesOperaveis,
} = require('../utils/financeiro-tenant-alvo');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const fin = require('../services/financeiro-cobranca.service');
const finUso = require('../services/financeiro-fechamento-uso.service');
const finPerm = require('../services/financeiro-permissoes.service');
const finInad = require('../services/financeiro-inadimplencia.service');

router.use(towerAuthAndTenant);
router.use(requireAtlasPay);
router.use(resolveFinTenantAlvo);

function handleErr(res, err) {
  if (err && err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message, code: err.code || null });
  }
  console.error('[atlas-pay]', err);
  return res.status(500).json({ error: 'Erro no módulo financeiro.', details: err && err.message });
}

/**
 * Tenant dos dados (contrato/cobrança/fechamento).
 * Sessão default + X-Atlas-Pay-Tenant → opera o agente escolhido.
 * Permissões FIN_* continuam na sessão (requireFinPerm / requireAtlasPay).
 */
function tid(req) {
  return dataTenantId(req);
}

/** Fechamento de uso (calcular/aprovar/gerar): só a Atlas (login default). Agenciador só consulta. */
function requireSessaoAtlasFechamento(req, res, next) {
  if (String(sessionTenantId(req)).trim() !== String(getDefaultTenantId()).trim()) {
    return res.status(403).json({
      error:
        'Fechamento de uso (calcular, aprovar e gerar cobrança) é operação da Atlas. No login do agenciador você só consulta a fatura.',
      code: 'FIN_FECH_SO_ATLAS',
    });
  }
  return next();
}

router.get('/me/permissoes', async (req, res) => {
  try {
    const data = await finPerm.resumoUsuario(sessionTenantId(req), loginReq(req));
    res.json({
      success: true,
      ...data,
      sessionTenantId: sessionTenantId(req),
      dataTenantId: dataTenantId(req),
      podeOperarAgentes: String(sessionTenantId(req)).trim() === String(getDefaultTenantId()).trim(),
    });
  } catch (e) {
    handleErr(res, e);
  }
});

/** Lista agentes (clientes SaaS) para o seletor — só instalação padrão. */
router.get(
  '/agentes',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR', 'FIN_COBRANCA_CONSULTAR', 'FIN_CONFIGURAR'),
  async (req, res) => {
    try {
      if (String(sessionTenantId(req)).trim() !== String(getDefaultTenantId()).trim()) {
        return res.status(403).json({
          error: 'Somente a Atlas (tenant padrão) lista agentes para operação.',
          code: 'FIN_TENANT_ALVO_NEGADO',
        });
      }
      const agentes = await listarAgentesOperaveis();
      res.json({
        success: true,
        agentes,
        sessionTenantId: sessionTenantId(req),
        dataTenantId: dataTenantId(req),
      });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/resumo',
  requireFinPerm('FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      const querConsolidado =
        String(req.query.consolidado || '') === '1' ||
        String(req.query.consolidado || '').toLowerCase() === 'true';
      if (querConsolidado) {
        if (String(sessionTenantId(req)).trim() !== String(getDefaultTenantId()).trim()) {
          return res.status(403).json({
            error: 'Somente a Atlas (tenant padrão) vê o painel consolidado.',
            code: 'FIN_RESUMO_CONSOLIDADO_NEGADO',
          });
        }
        const data = await fin.resumoConsolidado();
        return res.json({
          success: true,
          ...data,
          inadimplencia: null,
          warning: null,
        });
      }
      const data = await fin.resumoTenant(tid(req));
      let inadimplencia = null;
      let warning = null;
      try {
        inadimplencia = await finInad.avaliarPagador({ tipo: 'TENANT', tenantId: tid(req) });
        warning = finInad.warningFromAvaliacao(inadimplencia);
      } catch (eInad) {
        console.error('[financeiro/resumo] fin-inad fail-open:', eInad);
        inadimplencia = { modo: 'LIBERADO', failOpen: true };
      }
      res.json({ success: true, ...data, inadimplencia, warning });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

/** Dash comercial Atlas — só sessão default. Filtro opcional ?tenant= */
router.get(
  '/dash/atlas',
  requireFinPerm('FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      if (String(sessionTenantId(req)).trim() !== String(getDefaultTenantId()).trim()) {
        return res.status(403).json({
          error: 'Dash Atlas só na instalação padrão.',
          code: 'FIN_DASH_ATLAS_NEGADO',
        });
      }
      const tenantQ = String(req.query.tenant || '').trim();
      const data = await fin.dashAtlas({
        tenantId: tenantQ && tenantQ !== '__all__' ? tenantQ : null,
        limit: req.query.limit,
      });
      res.json({ success: true, ...data });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

/** Meu faturamento — tenant alvo (header) ou da sessão. */
router.get(
  '/dash/meu',
  requireFinPerm('FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      const data = await fin.dashMeuFaturamento(tid(req));
      res.json({ success: true, ...data });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/contratos',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      const rows = await fin.listarContratos(tid(req));
      res.json({ success: true, contratos: rows });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/contratos/vigente',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      const c = await fin.buscarContratoVigente((s, p) => require('../config/db').pool.query(s, p), tid(req));
      if (!c) return res.json({ success: true, contrato: null });
      const full = await fin.obterContrato(tid(req), c.ID);
      res.json({ success: true, contrato: full });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/contratos/:id',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'),
  async (req, res) => {
    try {
      const full = await fin.obterContrato(tid(req), parseInt(req.params.id, 10));
      if (!full) return res.status(404).json({ error: 'Contrato não encontrado.' });
      res.json({ success: true, contrato: full });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/contratos',
  requireFinPerm('FIN_CONTRATO_VERSIONAR', 'FIN_CONTRATO_CRIAR'),
  async (req, res) => {
    try {
      const usuario = loginReq(req);
      const body = Object.assign({}, req.body || {});
      delete body.empresa_id;
      delete body.tenantId;
      delete body.TENANT_ID;
      const atlasSession =
        String(sessionTenantId(req)).trim() === String(getDefaultTenantId()).trim();
      if (!atlasSession) {
        delete body.dhInicio;
        delete body.DH_INICIO;
      }
      const contrato = await fin.publicarContrato(tid(req), body, usuario, {
        permitirInicioRetroativo: atlasSession,
        // Uso da plataforma / regra / inadimplência: só Atlas (default).
        podeEditarUsoPlataforma: atlasSession,
      });
      const ajustou = !!(contrato && contrato.ajusteInicioVigencia);
      if (ajustou) delete contrato.ajusteInicioVigencia;
      res.status(ajustou ? 200 : 201).json({
        success: true,
        contrato,
        ajusteInicioVigencia: ajustou,
      });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/cobrancas',
  requireFinPerm('FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR'),
  async (req, res) => {
    try {
      const rows = await fin.listarCobrancas(tid(req), {
        status: req.query.status,
        modalidade: req.query.modalidade,
        idConvocacao: req.query.idConvocacao,
        q: req.query.q,
        limit: req.query.limit,
      });
      res.json({ success: true, cobrancas: rows });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/cobrancas/:id',
  requireFinPerm('FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR'),
  async (req, res) => {
    try {
      const cob = await fin.obterCobranca(tid(req), parseInt(req.params.id, 10));
      if (!cob) return res.status(404).json({ error: 'Cobrança não encontrada.' });
      res.json({ success: true, cobranca: cob });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/cobrancas/:id/baixa',
  requireFinPerm('FIN_COBRANCA_BAIXAR'),
  async (req, res) => {
    try {
      const usuario = loginReq(req);
      const motivo = (req.body && (req.body.motivo || req.body.MOTIVO)) || '';
      const confirmacao = String((req.body && req.body.confirmacao) || '').trim().toUpperCase();
      if (confirmacao !== 'BAIXAR') {
        return res.status(400).json({
          error: 'Confirme a baixa enviando confirmacao: "BAIXAR".',
          code: 'CONFIRMACAO_OBRIGATORIA',
        });
      }
      const cob = await fin.baixarCobrancaManual(
        tid(req),
        parseInt(req.params.id, 10),
        usuario,
        motivo,
        fin.ipDe(req),
        { sessionTenantId: sessionTenantId(req) }
      );
      res.json({ success: true, cobranca: cob });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/cobrancas/:id/cancelar',
  requireFinPerm('FIN_COBRANCA_CANCELAR'),
  async (req, res) => {
    try {
      const usuario = loginReq(req);
      const motivo = (req.body && (req.body.motivo || req.body.MOTIVO)) || '';
      const origem = (req.body && req.body.origem) || 'TORRE';
      const confirmacao = String((req.body && req.body.confirmacao) || '').trim().toUpperCase();
      if (confirmacao !== 'CANCELAR') {
        return res.status(400).json({
          error: 'Confirme o cancelamento enviando confirmacao: "CANCELAR".',
          code: 'CONFIRMACAO_OBRIGATORIA',
        });
      }
      const cob = await fin.cancelarCobrancaManual(
        tid(req),
        parseInt(req.params.id, 10),
        usuario,
        motivo,
        origem,
        fin.ipDe(req),
        { sessionTenantId: sessionTenantId(req) }
      );
      res.json({ success: true, cobranca: cob });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

// ---------- Fase 3: fechamento uso da plataforma ----------

router.get(
  '/fechamentos-uso',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONSULTAR_RELATORIOS', 'FIN_COBRANCA_CONSULTAR'),
  async (req, res) => {
    try {
      const rows = await finUso.listarFechamentos(tid(req), req.query.limit);
      res.json({ success: true, fechamentos: rows });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/fechamentos-uso/previa',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONSULTAR_RELATORIOS', 'FIN_COBRANCA_CONSULTAR'),
  async (req, res) => {
    try {
      const competencia = finUso.parseCompetencia(req.query.competencia);
      const previa = await finUso.previaEphemera(tid(req), competencia);
      res.json({ success: true, previa });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.get(
  '/fechamentos-uso/:id',
  requireFinPerm('FIN_CONSULTAR', 'FIN_CONSULTAR_RELATORIOS', 'FIN_COBRANCA_CONSULTAR'),
  async (req, res) => {
    try {
      const row = await finUso.obterFechamento(tid(req), req.params.id);
      if (!row) return res.status(404).json({ error: 'Fechamento não encontrado.' });
      res.json({ success: true, fechamento: row });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/fechamentos-uso/calcular',
  requireSessaoAtlasFechamento,
  requireFinPerm('FIN_COBRANCA_GERAR', 'FIN_CONFIGURAR'),
  async (req, res) => {
    try {
      const body = req.body || {};
      delete body.empresa_id;
      delete body.tenantId;
      delete body.TENANT_ID;
      const competencia = finUso.parseCompetencia(body.competencia);
      const fechamento = await finUso.criarOuRecalcular(tid(req), competencia, loginReq(req), ipReq(req));
      res.status(201).json({ success: true, fechamento });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/fechamentos-uso/:id/recalcular',
  requireSessaoAtlasFechamento,
  requireFinPerm('FIN_COBRANCA_GERAR', 'FIN_CONFIGURAR'),
  async (req, res) => {
    try {
      const atual = await finUso.obterFechamento(tid(req), req.params.id);
      if (!atual) return res.status(404).json({ error: 'Fechamento não encontrado.' });
      const fechamento = await finUso.criarOuRecalcular(
        tid(req),
        atual.COMPETENCIA || atual.competencia,
        loginReq(req),
        ipReq(req)
      );
      res.json({ success: true, fechamento });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/fechamentos-uso/:id/aprovar',
  requireSessaoAtlasFechamento,
  requireFinPerm('FIN_CONFIGURAR', 'FIN_COBRANCA_GERAR'),
  async (req, res) => {
    try {
      const confirmacao = (req.body && req.body.confirmacao) || '';
      const fechamento = await finUso.aprovarFechamento(
        tid(req),
        req.params.id,
        loginReq(req),
        ipReq(req),
        confirmacao
      );
      res.json({ success: true, fechamento });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

router.post(
  '/fechamentos-uso/:id/gerar-cobranca',
  requireSessaoAtlasFechamento,
  requireFinPerm('FIN_COBRANCA_GERAR'),
  async (req, res) => {
    try {
      const confirmacao = (req.body && req.body.confirmacao) || '';
      const out = await finUso.gerarCobranca(
        tid(req),
        req.params.id,
        loginReq(req),
        ipReq(req),
        confirmacao
      );
      res.status(out.idempotente ? 200 : 201).json({ success: true, ...out });
    } catch (e) {
      handleErr(res, e);
    }
  }
);

// ---------- Administração de permissões (FIN_GERENCIAR_PERMISSOES) ----------

router.get('/permissoes/catalogo', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const rows = await finPerm.listarCatalogo();
    res.json({ success: true, catalogo: rows });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get('/permissoes/perfis', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const rows = await finPerm.listarPerfis();
    res.json({ success: true, perfis: rows });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get('/permissoes/usuarios', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const users = await finPerm.listarUsuariosTenant(tid(req));
    const out = [];
    for (const u of users) {
      const r = await finPerm.resumoUsuario(tid(req), u.SGUSUARIO);
      out.push({
        login: u.SGUSUARIO,
        nome: u.NMUSUARIO,
        ativo: u.FGACTIVE,
        perfis: r.perfis,
        efetivas: r.efetivas,
        overrides: r.overrides,
        modo: r.modo,
      });
    }
    res.json({ success: true, usuarios: out });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get('/permissoes/usuarios/:login', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const data = await finPerm.resumoUsuario(tid(req), String(req.params.login || '').trim());
    res.json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post('/permissoes/bootstrap-admin', requireAtlasPay, async (req, res) => {
  try {
    const confirmacao = String((req.body && req.body.confirmacao) || '').trim().toUpperCase();
    if (confirmacao !== 'BOOTSTRAP_ADMIN') {
      return res.status(400).json({
        error: 'Envie confirmacao: "BOOTSTRAP_ADMIN".',
        code: 'CONFIRMACAO_OBRIGATORIA',
      });
    }
    const alvo = String((req.body && (req.body.login || req.body.alvo || req.body.SGUSUARIO)) || '').trim();
    const data = await finPerm.bootstrapFinAdmin(tid(req), loginReq(req), alvo, ipReq(req));
    res.status(201).json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post('/permissoes/usuarios/:login/perfis', async (req, res) => {
  try {
    const confirmacao = String((req.body && req.body.confirmacao) || '').trim().toUpperCase();
    const perfil = String((req.body && (req.body.perfil || req.body.CODIGO_PERFIL)) || '').trim();
    const isBootstrap = confirmacao === 'BOOTSTRAP_ADMIN' || (req.body && req.body.bootstrap === true);
    if (isBootstrap) {
      if (perfil && perfil !== 'FINANCEIRO_ADMIN') {
        return res.status(400).json({ error: 'Bootstrap só aceita FINANCEIRO_ADMIN.', code: 'FIN_BOOTSTRAP_SO_ADMIN' });
      }
      const data = await finPerm.bootstrapFinAdmin(
        tid(req),
        loginReq(req),
        String(req.params.login).trim(),
        ipReq(req)
      );
      return res.status(201).json({ success: true, ...data });
    }
    if (confirmacao !== 'CONCEDER') {
      return res.status(400).json({ error: 'Envie confirmacao: "CONCEDER".', code: 'CONFIRMACAO_OBRIGATORIA' });
    }
    // Em STRICT exige FIN_GERENCIAR_PERMISSOES; em legado a 1ª ADMIN usa bootstrap acima
    await finPerm.assertFinPerm(loginReq(req), tid(req), 'FIN_GERENCIAR_PERMISSOES', { ip: ipReq(req) });
    const data = await finPerm.concederPerfil(
      tid(req),
      loginReq(req),
      String(req.params.login).trim(),
      perfil,
      ipReq(req)
    );
    res.status(201).json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.delete('/permissoes/usuarios/:login/perfis/:perfil', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const confirmacao = String((req.body && req.body.confirmacao) || req.query.confirmacao || '').trim().toUpperCase();
    if (confirmacao !== 'REVOGAR') {
      return res.status(400).json({ error: 'Envie confirmacao: "REVOGAR".', code: 'CONFIRMACAO_OBRIGATORIA' });
    }
    const data = await finPerm.revogarPerfil(
      tid(req),
      loginReq(req),
      String(req.params.login).trim(),
      String(req.params.perfil).trim(),
      ipReq(req)
    );
    res.json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.post('/permissoes/usuarios/:login/overrides', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const confirmacao = String((req.body && req.body.confirmacao) || '').trim().toUpperCase();
    if (confirmacao !== 'APLICAR') {
      return res.status(400).json({ error: 'Envie confirmacao: "APLICAR".', code: 'CONFIRMACAO_OBRIGATORIA' });
    }
    const perm = String((req.body && (req.body.permissao || req.body.CODIGO_PERM)) || '').trim();
    const efeito = String((req.body && (req.body.efeito || req.body.efeto)) || '').trim();
    const data = await finPerm.setOverride(
      tid(req),
      loginReq(req),
      String(req.params.login).trim(),
      perm,
      efeito,
      ipReq(req)
    );
    res.status(201).json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.delete('/permissoes/usuarios/:login/overrides/:perm', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const confirmacao = String((req.body && req.body.confirmacao) || req.query.confirmacao || '').trim().toUpperCase();
    if (confirmacao !== 'REVOGAR') {
      return res.status(400).json({ error: 'Envie confirmacao: "REVOGAR".', code: 'CONFIRMACAO_OBRIGATORIA' });
    }
    const data = await finPerm.limparOverride(
      tid(req),
      loginReq(req),
      String(req.params.login).trim(),
      String(req.params.perm).trim(),
      ipReq(req)
    );
    res.json({ success: true, ...data });
  } catch (e) {
    handleErr(res, e);
  }
});

router.get('/permissoes/audit', requireFinPerm('FIN_GERENCIAR_PERMISSOES'), async (req, res) => {
  try {
    const rows = await finPerm.listarAudit(tid(req), req.query.limit);
    res.json({ success: true, eventos: rows });
  } catch (e) {
    handleErr(res, e);
  }
});

module.exports = router;
