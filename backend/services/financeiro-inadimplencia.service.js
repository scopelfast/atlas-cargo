'use strict';

/**
 * Atlas Pay Fase 4 — avaliador de inadimplência (somente leitura).
 * Sem flag/tabela de bloqueio. Reversão = próxima avaliação após PAGA/CANCELADA.
 */

const { pool } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { buscarContratoVigente } = require('./financeiro-cobranca.service');
const fusoSp = require('./financeiro-fuso-sp');

const CODE_BLOQUEIO = 'FIN_INADIMPLENTE_BLOQUEIO';
const CODE_ALERTA = 'FIN_INADIMPLENTE_ALERTA';
const CODE_FAIL_OPEN = 'FIN_INAD_FAIL_OPEN';
const MSG_FAIL_OPEN =
  'Não foi possível verificar a situação financeira no momento. A operação foi liberada; tente novamente ou consulte o Atlas Pay.';

function liberadoBase(extra) {
  return Object.assign(
    {
      politica: null,
      fgRegraAtiva: null,
      qtdAbertas: 0,
      qtdVencidas: 0,
      totalCentavosAbertas: 0,
      totalCentavosVencidas: 0,
      modo: 'LIBERADO',
      code: null,
      motivo: null,
      failOpen: false,
      fuso: fusoSp.TZ,
      agoraSp: null,
    },
    extra || {}
  );
}

function isVencida(dhVencimento, agoraWall) {
  if (dhVencimento == null || dhVencimento === '') return false;
  const wall = fusoSp.toSpWall(dhVencimento);
  if (!wall) return false;
  return fusoSp.wallToOrderMs(wall) < fusoSp.wallToOrderMs(agoraWall);
}

function montarMotivo(av) {
  const isTenant = String(av.tipoPagador || '').toUpperCase() === 'TENANT';
  const valorVenc = (Number(av.totalCentavosVencidas) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  const valorAbertas = (Number(av.totalCentavosAbertas) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
  if (av.modo === 'BLOQUEADO') {
    if (isTenant) {
      return (
        `Operação bloqueada: há ${av.qtdVencidas} fatura(s) de uso vencida(s) com a Atlas (${valorVenc}). ` +
        'Quite com a Atlas; a baixa no sistema é registrada pela instalação padrão.'
      );
    }
    return (
      `Operação bloqueada: há ${av.qtdVencidas} cobrança(s) vencida(s) ` +
      `(${valorVenc}). ` +
      'Regularize no Atlas Pay (baixa ou cancelamento) para liberar.'
    );
  }
  if (av.modo === 'ALERTA') {
    const vencPart =
      av.qtdVencidas > 0
        ? ` Destas, ${av.qtdVencidas} vencida(s).`
        : '';
    if (isTenant) {
      return (
        `Há ${av.qtdAbertas} fatura(s) de uso em aberto com a Atlas (${valorAbertas}).` +
        vencPart +
        ' Acompanhe em Cobranças / Fatura de uso — a baixa é da Atlas após o pagamento.'
      );
    }
    return (
      `Há ${av.qtdAbertas} cobrança(s) em aberto ` +
      `(${valorAbertas}).` +
      vencPart +
      ' Regularize no Atlas Pay quando possível.'
    );
  }
  return null;
}

/**
 * Avalia pagador MOTORISTA ou TENANT no tenant da operação.
 * @param {{ tipo: 'MOTORISTA'|'TENANT', tenantId: string, cdCadastro?: number|string, nowMs?: number, q?: function }} opts
 */
async function avaliarPagador(opts) {
  const tipo = String((opts && opts.tipo) || '').toUpperCase();
  const tenantId = String((opts && opts.tenantId) || '').trim();
  const agoraWall = fusoSp.nowSpWall(opts && opts.nowMs);
  const q = (opts && opts.q) || ((sql, params) => pool.query(sql, params));

  if (!tenantId || (tipo !== 'MOTORISTA' && tipo !== 'TENANT')) {
    return liberadoBase({ agoraSp: agoraWall, motivo: 'Parâmetros inválidos — liberado.' });
  }

  let contrato = null;
  try {
    contrato = await buscarContratoVigente(q, tenantId);
  } catch (e) {
    console.error('[fin-inad] falha contrato vigente (fail-open):', e && e.message ? e.message : e);
    return liberadoBase({
      agoraSp: agoraWall,
      failOpen: true,
      code: CODE_FAIL_OPEN,
      motivo: MSG_FAIL_OPEN,
    });
  }

  const fgRegra = contrato ? String(contrato.FG_REGRA_ATIVA || 'N').toUpperCase() : 'N';
  const politica = contrato
    ? String(contrato.POLITICA_INADIMPLENCIA || 'ALERTA').toUpperCase() === 'BLOQUEIO'
      ? 'BLOQUEIO'
      : 'ALERTA'
    : null;

  if (!contrato || fgRegra !== 'S') {
    return liberadoBase({
      agoraSp: agoraWall,
      politica,
      fgRegraAtiva: fgRegra,
      motivo: 'Regra financeira desligada ou sem contrato — sem enforcement.',
    });
  }

  let rows = [];
  try {
    if (tipo === 'MOTORISTA') {
      const cd = Number(opts.cdCadastro);
      if (!Number.isFinite(cd)) {
        return liberadoBase({
          agoraSp: agoraWall,
          politica,
          fgRegraAtiva: fgRegra,
          motivo: 'Motorista inválido — liberado.',
        });
      }
      // Escopo: só no tenant da operação; só pagador MOTORISTA
      const r = await q(
        `SELECT c."ID", c."VALOR_CENTAVOS", c."DH_VENCIMENTO", c."STATUS", c."MODALIDADE"
           FROM "FIN_COBRANCA" c
          WHERE c."TENANT_ID" = $1
            AND c."PAGADOR_TIPO" = 'MOTORISTA'
            AND c."PAGADOR_CDCADASTRO" = $2
            AND c."STATUS" = 'ABERTA'`,
        [tenantId, cd]
      );
      rows = r.rows || [];
    } else {
      // TENANT: dívida do agenciador (PAGADOR_TENANT_ID); não mistura MOTORISTA
      const r = await q(
        `SELECT c."ID", c."VALOR_CENTAVOS", c."DH_VENCIMENTO", c."STATUS", c."MODALIDADE",
                c."PAGADOR_TENANT_ID", c."TENANT_ID"
           FROM "FIN_COBRANCA" c
          WHERE c."PAGADOR_TIPO" = 'TENANT'
            AND c."PAGADOR_TENANT_ID" = $1
            AND c."STATUS" = 'ABERTA'`,
        [tenantId]
      );
      rows = r.rows || [];
    }
  } catch (e) {
    console.error('[fin-inad] falha consulta cobranças (fail-open):', e && e.message ? e.message : e);
    return liberadoBase({
      agoraSp: agoraWall,
      politica,
      fgRegraAtiva: fgRegra,
      failOpen: true,
      code: CODE_FAIL_OPEN,
      motivo: MSG_FAIL_OPEN,
    });
  }

  let qtdAbertas = 0;
  let qtdVencidas = 0;
  let totalCentavosAbertas = 0;
  let totalCentavosVencidas = 0;
  for (const row of rows) {
    const cent = Number(row.VALOR_CENTAVOS != null ? row.VALOR_CENTAVOS : row.valor_centavos) || 0;
    qtdAbertas += 1;
    totalCentavosAbertas += cent;
    if (isVencida(row.DH_VENCIMENTO != null ? row.DH_VENCIMENTO : row.dh_vencimento, agoraWall)) {
      qtdVencidas += 1;
      totalCentavosVencidas += cent;
    }
  }

  const av = {
    politica,
    fgRegraAtiva: fgRegra,
    qtdAbertas,
    qtdVencidas,
    totalCentavosAbertas,
    totalCentavosVencidas,
    modo: 'LIBERADO',
    code: null,
    motivo: null,
    failOpen: false,
    fuso: fusoSp.TZ,
    agoraSp: agoraWall,
    tipoPagador: tipo,
    tenantId,
  };

  if (qtdAbertas <= 0) {
    av.motivo = 'Sem cobranças em aberto.';
    return av;
  }

  // Default: nunca BLOQUEIO por dívida contra si
  const isDefaultTenant =
    tipo === 'TENANT' && tenantId === getDefaultTenantId();

  if (politica === 'BLOQUEIO' && qtdVencidas > 0 && !isDefaultTenant) {
    av.modo = 'BLOQUEADO';
    av.code = CODE_BLOQUEIO;
    av.motivo = montarMotivo(av);
    return av;
  }

  // Qualquer ABERTA → ALERTA (inclusive BLOQUEIO sem vencida, e default com vencida)
  av.modo = 'ALERTA';
  av.code = CODE_ALERTA;
  av.motivo = montarMotivo(av);
  if (isDefaultTenant && politica === 'BLOQUEIO' && qtdVencidas > 0) {
    av.motivo =
      'Tenant default: cobrança vencida gera apenas alerta (bloqueio contra si mesmo é proibido). ' +
      av.motivo;
  }
  return av;
}

function warningFromAvaliacao(av) {
  if (!av) return null;
  if (av.failOpen) {
    return {
      code: CODE_FAIL_OPEN,
      message: av.motivo || MSG_FAIL_OPEN,
      failOpen: true,
      politica: av.politica,
      qtdAbertas: av.qtdAbertas,
      qtdVencidas: av.qtdVencidas,
      totalCentavosAbertas: av.totalCentavosAbertas,
      totalCentavosVencidas: av.totalCentavosVencidas,
    };
  }
  if (av.modo !== 'ALERTA') return null;
  return {
    code: CODE_ALERTA,
    message: av.motivo,
    politica: av.politica,
    qtdAbertas: av.qtdAbertas,
    qtdVencidas: av.qtdVencidas,
    totalCentavosAbertas: av.totalCentavosAbertas,
    totalCentavosVencidas: av.totalCentavosVencidas,
  };
}

function erroBloqueio(av) {
  const e = new Error((av && av.motivo) || 'Operação bloqueada por inadimplência.');
  e.statusCode = 403;
  e.code = CODE_BLOQUEIO;
  e.avaliacao = av;
  return e;
}

/**
 * Aplica gate: BLOQUEADO → throw 403; ALERTA → warning; falha → fail-open.
 * @returns {Promise<{ avaliacao: object, warning: object|null, failOpen: boolean }>}
 */
async function aplicarGate(opts) {
  try {
    const avaliacao = await avaliarPagador(opts);
    if (avaliacao.modo === 'BLOQUEADO') throw erroBloqueio(avaliacao);
    return {
      avaliacao,
      warning: warningFromAvaliacao(avaliacao),
      failOpen: !!avaliacao.failOpen,
    };
  } catch (e) {
    if (e && e.statusCode === 403 && e.code === CODE_BLOQUEIO) throw e;
    console.error('[fin-inad] aplicarGate fail-open:', e && e.message ? e.message : e);
    const avaliacao = liberadoBase({
      failOpen: true,
      code: CODE_FAIL_OPEN,
      motivo: MSG_FAIL_OPEN,
      agoraSp: fusoSp.nowSpWall(),
    });
    return {
      avaliacao,
      warning: warningFromAvaliacao(avaliacao),
      failOpen: true,
    };
  }
}

function anexarWarning(payload, warning) {
  if (!warning) return payload;
  const out = payload && typeof payload === 'object' ? Object.assign({}, payload) : { success: true };
  out.warning = warning;
  return out;
}

module.exports = {
  CODE_BLOQUEIO,
  CODE_ALERTA,
  CODE_FAIL_OPEN,
  MSG_FAIL_OPEN,
  avaliarPagador,
  aplicarGate,
  warningFromAvaliacao,
  erroBloqueio,
  anexarWarning,
  isVencida,
  liberadoBase,
};
