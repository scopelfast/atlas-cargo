'use strict';

/** Catálogo canônico P1 — espelha FIN_PERM_CATALOGO do script SQL. */
const FIN_PERMISSOES = Object.freeze([
  'FIN_CONSULTAR',
  'FIN_CONSULTAR_RELATORIOS',
  'FIN_CONTRATO_CONSULTAR',
  'FIN_CONTRATO_CRIAR',
  'FIN_CONTRATO_EDITAR',
  'FIN_CONTRATO_CANCELAR',
  'FIN_CONTRATO_VERSIONAR',
  'FIN_COBRANCA_CONSULTAR',
  'FIN_COBRANCA_GERAR',
  'FIN_COBRANCA_CANCELAR',
  'FIN_COBRANCA_BAIXAR',
  'FIN_CONFIGURAR',
  'FIN_GERENCIAR_PERMISSOES',
]);

const FIN_PERFIS_BASE = Object.freeze({
  FINANCEIRO_CONSULTA: [
    'FIN_CONSULTAR',
    'FIN_CONSULTAR_RELATORIOS',
    'FIN_CONTRATO_CONSULTAR',
    'FIN_COBRANCA_CONSULTAR',
  ],
  FINANCEIRO_OPERADOR: [
    'FIN_CONSULTAR',
    'FIN_CONSULTAR_RELATORIOS',
    'FIN_CONTRATO_CONSULTAR',
    'FIN_COBRANCA_CONSULTAR',
    'FIN_COBRANCA_GERAR',
    'FIN_COBRANCA_BAIXAR',
  ],
  FINANCEIRO_GESTOR: [
    'FIN_CONSULTAR',
    'FIN_CONSULTAR_RELATORIOS',
    'FIN_CONTRATO_CONSULTAR',
    'FIN_CONTRATO_CRIAR',
    'FIN_CONTRATO_EDITAR',
    'FIN_CONTRATO_CANCELAR',
    'FIN_CONTRATO_VERSIONAR',
    'FIN_COBRANCA_CONSULTAR',
    'FIN_COBRANCA_GERAR',
    'FIN_COBRANCA_CANCELAR',
    'FIN_COBRANCA_BAIXAR',
    'FIN_CONFIGURAR',
  ],
  FINANCEIRO_ADMIN: FIN_PERMISSOES.slice(),
});

const ROTA_PERMISSOES = Object.freeze({
  'GET /resumo': ['FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'],
  'GET /contratos': ['FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'],
  'GET /contratos/vigente': ['FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'],
  'GET /contratos/:id': ['FIN_CONSULTAR', 'FIN_CONTRATO_CONSULTAR'],
  'POST /contratos': ['FIN_CONTRATO_VERSIONAR', 'FIN_CONTRATO_CRIAR'],
  'GET /cobrancas': ['FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR'],
  'GET /cobrancas/:id': ['FIN_CONSULTAR', 'FIN_COBRANCA_CONSULTAR'],
  'POST /cobrancas/:id/baixa': ['FIN_COBRANCA_BAIXAR'],
  'POST /cobrancas/:id/cancelar': ['FIN_COBRANCA_CANCELAR'],
  'GET /fechamentos-uso': ['FIN_CONSULTAR', 'FIN_CONSULTAR_RELATORIOS', 'FIN_COBRANCA_CONSULTAR'],
  'GET /fechamentos-uso/previa': ['FIN_CONSULTAR', 'FIN_CONSULTAR_RELATORIOS', 'FIN_COBRANCA_CONSULTAR'],
  'POST /fechamentos-uso/calcular': ['FIN_COBRANCA_GERAR', 'FIN_CONFIGURAR'],
  'POST /fechamentos-uso/:id/aprovar': ['FIN_CONFIGURAR', 'FIN_COBRANCA_GERAR'],
  'POST /fechamentos-uso/:id/gerar-cobranca': ['FIN_COBRANCA_GERAR'],
});

function isFinPermCode(code) {
  return FIN_PERMISSOES.includes(String(code || '').trim());
}

function normalizeEfeito(o) {
  if (o == null) return '';
  if (typeof o === 'string') return String(o).toUpperCase();
  return String(o.efeito || o.EFEITO || o.efeto || o.EFETO || '').toUpperCase();
}

/**
 * União dos perfis + concessões C − revogações R.
 * @param {string[]} fromProfiles
 * @param {{codigo?:string,CODIGO_PERM?:string,efeito?:string,EFEITO?:string}[]} overrides
 */
function mergeEffective(fromProfiles, overrides) {
  const set = new Set(fromProfiles || []);
  for (const o of overrides || []) {
    const c = String(o.codigo || o.CODIGO_PERM || '').trim();
    const e = normalizeEfeito(o);
    if (!c) continue;
    if (e === 'C') set.add(c);
    else if (e === 'R') set.delete(c);
  }
  return Array.from(set).sort();
}

function canGrantPerms(actorEffective, targetPerms) {
  const actor = new Set(actorEffective || []);
  if (!actor.has('FIN_GERENCIAR_PERMISSOES')) return false;
  for (const p of targetPerms || []) {
    if (!actor.has(p)) return false;
  }
  return true;
}

function canGrantProfile(actorEffective, profileCode, profilePerms) {
  if (!(actorEffective || []).includes('FIN_GERENCIAR_PERMISSOES')) return false;
  return canGrantPerms(actorEffective, profilePerms || FIN_PERFIS_BASE[profileCode] || []);
}

/**
 * Decisão pura do bootstrap da 1ª atribuição FINANCEIRO_ADMIN.
 * @returns {{ok:boolean, code?:string, reason?:string}}
 */
function decideBootstrapAdmin(ctx) {
  const tenantTemAtrib = !!(ctx && ctx.tenantTemAtribuicoes);
  const perfil = String((ctx && ctx.perfil) || '').trim();
  const ator = String((ctx && ctx.ator) || '').trim();
  const alvo = String((ctx && ctx.alvo) || '').trim();
  const actorHasModule = !!(ctx && ctx.actorHasModule);
  const alvoOk = !!(ctx && ctx.alvoNoTenantAtivo);

  if (tenantTemAtrib) {
    return { ok: false, code: 'FIN_BOOTSTRAP_JA_FEITO', reason: 'Tenant já saiu de LEGADO_TRANSICAO.' };
  }
  if (perfil !== 'FINANCEIRO_ADMIN') {
    return { ok: false, code: 'FIN_BOOTSTRAP_SO_ADMIN', reason: 'Bootstrap só aceita FINANCEIRO_ADMIN.' };
  }
  if (!ator || !alvo) {
    return { ok: false, code: 'FIN_BOOTSTRAP_USUARIO', reason: 'Ator e alvo obrigatórios.' };
  }
  if (!actorHasModule) {
    return { ok: false, code: 'FIN_BOOTSTRAP_ATOR', reason: 'Operador sem atlas-pay no tenant.' };
  }
  if (!alvoOk) {
    return { ok: false, code: 'FIN_BOOTSTRAP_ALVO', reason: 'Alvo inexistente, inativo ou de outro tenant.' };
  }
  return { ok: true };
}

/** Isolamento: atribuições de um tenant não vazam para outro (teste de desenho). */
function assertTenantIsolation(rowTenantId, sessionTenantId) {
  return String(rowTenantId || '').trim() === String(sessionTenantId || '').trim();
}

module.exports = {
  FIN_PERMISSOES,
  FIN_PERFIS_BASE,
  ROTA_PERMISSOES,
  isFinPermCode,
  normalizeEfeito,
  mergeEffective,
  canGrantPerms,
  canGrantProfile,
  decideBootstrapAdmin,
  assertTenantIsolation,
};
