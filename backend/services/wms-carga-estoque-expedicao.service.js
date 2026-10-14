'use strict';

const { pool } = require('../config/db');
const {
  carregarItensNfCarga,
  carregarItensSeparacao,
  carregarSeparacaoOplPorPedidosNfMulti,
  carregarCdsDonoCarga,
  carregarPedidosPorDonoNfCarga,
  carregarDemandaCodigoSemPedidoPorDonoNfCarga,
  carregarDemandaCodigoPorDonoNfCarga,
  isCargaBaixaEstoque,
  carregarMetaCargaProgramada,
  schemaMissing,
  sqlFiltroPedidosOplNorm,
  normPedido,
} = require('./wms-carga-validacao.service');
const { listarReservasPorOplArquivo } = require('./wms-opl-reserva-picking.service');
const {
  agregarQtdPorCdProdutoCodigosExternos,
  saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos,
} = require('./wms-opl-cobertura-estoque.service');

function executorOuPool(executor) {
  return executor && typeof executor.query === 'function' ? executor : pool;
}

function labelDono(cdDono, nmDono) {
  if (nmDono) return `${cdDono} (${nmDono})`;
  return String(cdDono);
}

async function carregarNomeDono(tenantId, cdDono, executor) {
  try {
    const r = await executorOuPool(executor).query(
      `SELECT "NOME" FROM "WMS_DONO_ESTOQUE"
        WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2
        LIMIT 1`,
      [cdDono, tenantId]
    );
    return r.rowCount ? String(r.rows[0].NOME || '').trim() : '';
  } catch (e) {
    if (schemaMissing(e)) return '';
    throw e;
  }
}

async function validarPickingEReservasOpl(tenantId, cdOpl, bloqueios, ctxLabel) {
  const q = ctxLabel.executor;
  const prefix = ctxLabel.prefix || '';
  const pedidosFilter = Array.isArray(ctxLabel.pedidosFilter)
    ? ctxLabel.pedidosFilter.filter(Boolean)
    : null;
  let pickingTotal = 0;
  let pickingCom = 0;
  try {
    const params = [cdOpl, tenantId];
    let filtroPedidos = '';
    if (pedidosFilter && pedidosFilter.length) {
      params.push(pedidosFilter.map((p) => normPedido(p)).filter(Boolean));
      filtroPedidos = ` AND ${sqlFiltroPedidosOplNorm(params.length)}`;
    }
    const rPick = await q.query(
      `SELECT COUNT(i."CD_OPL_ITEM")::int AS tot,
              COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_pick
         FROM "WMS_OPL_ITEM" i
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $2
        WHERE a."CD_OPL_ARQUIVO" = $1::integer${filtroPedidos}`,
      params
    );
    pickingTotal = Number(rPick.rows[0]?.tot) || 0;
    pickingCom = Number(rPick.rows[0]?.com_pick) || 0;
    if (pickingTotal > 0 && pickingCom < pickingTotal) {
      const escopo =
        pedidosFilter && pedidosFilter.length
          ? ` (itens dos pedidos da carga: ${pickingCom}/${pickingTotal})`
          : ` (${pickingCom}/${pickingTotal} itens)`;
      bloqueios.push({
        code: 'PICKING_OPL_INCOMPLETO',
        mensagem: `${prefix}Picking OPL incompleto no espelho #${cdOpl}${escopo}. Conclua o picking antes de expedir.`,
      });
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }

  let qtdReservas = 0;
  try {
    const reservas = await listarReservasPorOplArquivo(q, tenantId, cdOpl);
    qtdReservas = reservas.length;
    if (!qtdReservas) {
      bloqueios.push({
        code: 'SEM_RESERVA_OPL',
        mensagem: `${prefix}Sem reserva de estoque no espelho OPL #${cdOpl}. Na Expedição use «Aplicar reservas OPL #${cdOpl}». Se der cobertura insuficiente, preencha Liberação por supervisor (justificativa + senha) e clique de novo em Aplicar reservas — ou corrija inventário/recebimento.`,
      });
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    bloqueios.push({
      code: 'SEM_RESERVA_OPL',
      mensagem: `${prefix}Não foi possível verificar reservas OPL #${cdOpl}.`,
    });
  }

  return {
    pickingTotal,
    pickingCom,
    qtdReservas,
    pickingCompleto: pickingTotal > 0 && pickingCom >= pickingTotal,
  };
}

async function carregarMetaEspelhoOpl(tenantId, cdOpl, executor) {
  try {
    const rA = await executorOuPool(executor).query(
      `SELECT "CD_DONO", "NM_ARQUIVO" FROM "WMS_OPL_ARQUIVO"
        WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdOpl, tenantId]
    );
    if (!rA.rowCount) return { CD_DONO: null, NM_ARQUIVO: '' };
    const raw = rA.rows[0].CD_DONO;
    const cdDono = raw != null ? parseInt(String(raw), 10) : NaN;
    return {
      CD_DONO: Number.isFinite(cdDono) ? cdDono : null,
      NM_ARQUIVO: String(rA.rows[0].NM_ARQUIVO || '').trim(),
    };
  } catch (e) {
    if (schemaMissing(e)) return { CD_DONO: null, NM_ARQUIVO: '' };
    throw e;
  }
}

/**
 * Picking e reserva nos espelhos que de fato atendem a carga (regra multi-OPL da validação NF),
 * não no espelho com maior contagem de pedidos em comum (que pode estar parcial).
 */
async function validarEspelhosOplAtivosPorPedidos(tenantId, cdDono, pedidos, bloqueios, ctx) {
  const q = ctx.executor;
  const prefixDono = ctx.prefixDono || '';
  const pedidosLista = [...new Set((pedidos || []).filter(Boolean))];
  if (!pedidosLista.length) {
    return { espelhosOpl: [], cdsOpl: [], origemSeparacao: null };
  }

  const oplMulti = await carregarSeparacaoOplPorPedidosNfMulti(tenantId, pedidosLista, {
    cdsDonoCarga: [cdDono],
    executor: q,
  });
  const ativos = Array.isArray(oplMulti.espelhosAtivos) ? oplMulti.espelhosAtivos : [];
  if (!ativos.length) {
    if (!oplMulti.itens.length) {
      bloqueios.push({
        code: 'ESPELHO_OPL_NAO_ENCONTRADO',
        mensagem: `${prefixDono}Nenhum espelho OPL cobre os pedidos das NF-e. Importe/conclua o OPL em Separação.`,
      });
    }
    return { espelhosOpl: [], cdsOpl: [], origemSeparacao: oplMulti.origem };
  }

  const espelhosOpl = [];
  const multiEspelho = ativos.length > 1;

  for (const at of ativos) {
    const cdOpl = at.CD_OPL_ARQUIVO;
    const meta = await carregarMetaEspelhoOpl(tenantId, cdOpl, q);
    if (meta.CD_DONO != null && meta.CD_DONO !== cdDono) {
      bloqueios.push({
        code: 'DONO_OPL_DIVERGENTE',
        mensagem: `${prefixDono}Espelho OPL #${cdOpl} está com outro dono do estoque.`,
      });
      continue;
    }
    if (meta.CD_DONO == null) {
      bloqueios.push({
        code: 'SEM_DONO_OPL',
        mensagem: `${prefixDono}Espelho OPL #${cdOpl} sem dono do estoque. Em Separação → Associar dono.`,
      });
    }

    const pickRes = await validarPickingEReservasOpl(tenantId, cdOpl, bloqueios, {
      executor: q,
      prefix: multiEspelho ? `${prefixDono}Espelho #${cdOpl} — ` : prefixDono,
      pedidosFilter: at.pedidos,
    });

    espelhosOpl.push({
      CD_OPL_ARQUIVO: cdOpl,
      NM_ARQUIVO: meta.NM_ARQUIVO,
      CD_DONO: cdDono,
      NM_DONO: ctx.nmDono || '',
      qMatchPedidos: at.pedidos.length,
      qPedidosNf: pedidosLista.length,
      qItensCarga: at.qItens,
      ...pickRes,
    });
  }

  const cdsOpl = espelhosOpl.map((e) => e.CD_OPL_ARQUIVO);
  const origemSeparacao =
    oplMulti.origem ||
    (cdsOpl.length ? { tipo: 'OPL_ARQUIVOS', CD_OPL_ARQUIVOS: cdsOpl } : null);

  return { espelhosOpl, cdsOpl, origemSeparacao };
}

/**
 * Valida saldo vs demanda agregada (Map codigo→qtd) para expedição sem OPL.
 */
async function validarEstoqueDemandaNfMapa(tenantId, cdDono, demandDono, bloqueios, ctx, origemTipo) {
  const q = executorOuPool(ctx.executor);
  const prefix = ctx.prefixDono || '';
  if (!demandDono || !demandDono.size) {
    return { qSkus: 0, origem: null };
  }

  const demandRows = [...demandDono.entries()].map(([cod_ol, qtd]) => ({ cod_ol, qtd }));
  const { byCd, itensSemMapeamento } = await agregarQtdPorCdProdutoCodigosExternos(
    q,
    tenantId,
    cdDono,
    demandRows
  );

  if (itensSemMapeamento > 0) {
    bloqueios.push({
      code: 'SEM_DEPARA_NF',
      mensagem: `${prefix}${itensSemMapeamento} código(s) da NF sem de-para/cadastro no dono.`,
    });
  }

  if (!ctx.skipSaldoCheck) {
    const saldo = await saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos(tenantId, cdDono, q);
    for (const [cdProd, qtdDem] of byCd) {
      const need = Math.abs(Number(qtdDem) || 0);
      if (need < 1e-9) continue;
      const have = Number(saldo.get(cdProd) || 0);
      if (need > have + 1e-6) {
        bloqueios.push({
          code: 'SALDO_INSUFICIENTE_NF',
          mensagem: `${prefix}Produto CD ${cdProd}: demanda NF ${need}, saldo ${Number(have.toFixed(3))}.`,
        });
      }
    }
  }

  return {
    qSkus: byCd.size,
    origem: { tipo: origemTipo, CD_DONO: cdDono },
  };
}

async function validarEstoqueDemandaNfSemPedido(tenantId, cdCarga, cdDono, bloqueios, ctx) {
  const q = ctx.executor;
  const porDono = await carregarDemandaCodigoSemPedidoPorDonoNfCarga(tenantId, cdCarga, q);
  const r = await validarEstoqueDemandaNfMapa(
    tenantId,
    cdDono,
    porDono.get(cdDono),
    bloqueios,
    ctx,
    'NFE_SEM_PEDIDO'
  );
  return {
    ok: bloqueios.length === 0,
    qSkus: r.qSkus,
    origem: r.origem ? Object.assign({ CD_CARGA: cdCarga }, r.origem) : null,
  };
}

async function validarEstoqueBaixaPorNf(tenantId, cdCarga, uniqDonos, bloqueios, ctx) {
  const q = ctx.executor;
  const porDono = await carregarDemandaCodigoPorDonoNfCarga(tenantId, cdCarga, q);
  let totalSkus = 0;
  for (const cdDono of uniqDonos) {
    const nmDono = await carregarNomeDono(tenantId, cdDono, q);
    const r = await validarEstoqueDemandaNfMapa(
      tenantId,
      cdDono,
      porDono.get(cdDono),
      bloqueios,
      {
        executor: q,
        prefixDono: `Baixa — ${labelDono(cdDono, nmDono)} — `,
        skipSaldoCheck: true,
      },
      'BAIXA_ESTOQUE'
    );
    totalSkus += r.qSkus;
  }
  return { qSkus: totalSkus };
}

/**
 * Travas de estoque para expedição: dono/OPL, picking 100%, reserva OPL gravada.
 * Suporta carga com NF-e de mais de um dono (Mana + Nutriville na mesma saída).
 * Linhas NF **sem xPed** dispensam OPL e usam trava de saldo direto na NF.
 */
async function validarEstoqueOplParaExpedicao(tenantId, cdCarga, executor) {
  const bloqueios = [];
  const q = executorOuPool(executor);

  const metaCarga = await carregarMetaCargaProgramada(tenantId, cdCarga, q);
  if (!metaCarga) {
    return {
      ok: false,
      bloqueios: [{ code: 'CARGA_NAO_ENCONTRADA', mensagem: 'Carga não encontrada.' }],
    };
  }

  let cdDonoCarga = metaCarga.CD_DONO != null ? parseInt(String(metaCarga.CD_DONO), 10) : NaN;
  if (!Number.isFinite(cdDonoCarga)) cdDonoCarga = null;

  const itensNf = await carregarItensNfCarga(tenantId, cdCarga, q);
  const temItensSemPedido = itensNf.some((i) => !i.pedido);
  if (!itensNf.length) {
    bloqueios.push({
      code: 'SEM_NFE_CARGA',
      mensagem: 'A carga não possui NF-e vinculada para validar estoque.',
    });
    return { ok: false, bloqueios, cdDonoCarga, origemSeparacao: null, espelhoOpl: null };
  }

  const donosNf = await carregarCdsDonoCarga(tenantId, cdCarga, q);
  const uniqDonos = [...new Set(donosNf)].sort((a, b) => a - b);
  if (!uniqDonos.length) {
    bloqueios.push({
      code: 'SEM_DONO_NF',
      mensagem:
        'As NF-e da carga não têm dono do estoque (CD_DONO). Corrija o cabeçalho das notas na importação.',
    });
    return { ok: false, bloqueios, cdDonoCarga, origemSeparacao: null, espelhoOpl: null };
  }

  if (cdDonoCarga == null && uniqDonos.length === 1) {
    cdDonoCarga = uniqDonos[0];
  }

  /** Baixa de estoque: saída direta pela NF, sem OPL/picking/reserva. */
  if (isCargaBaixaEstoque(metaCarga)) {
    await validarEstoqueBaixaPorNf(tenantId, cdCarga, uniqDonos, bloqueios, { executor: q });
    return {
      ok: bloqueios.length === 0,
      bloqueios,
      cdDonoCarga,
      cdsDonoNf: uniqDonos,
      multiDono: uniqDonos.length > 1,
      origemSeparacao: { tipo: 'BAIXA_ESTOQUE', CD_CARGA: cdCarga },
      espelhoOpl: null,
      espelhosOpl: [],
      modoExpedicaoBaixaEstoque: true,
      modoExpedicaoSemPedido: true,
    };
  }

  let origemSeparacao = null;
  const itensSep = await carregarItensSeparacao(tenantId, cdCarga, q);
  if (itensSep.length) {
    origemSeparacao = { tipo: 'CARGA', CD_CARGA: cdCarga };
    if (uniqDonos.length > 1) {
      bloqueios.push({
        code: 'SEPARACAO_CARGA_MULTI_DONO',
        mensagem:
          'Carga com vários donos nas NF-e não pode usar separação física única na carga. Use espelhos OPL por dono.',
      });
    }
    return {
      ok: bloqueios.length === 0,
      bloqueios,
      cdDonoCarga,
      cdsDonoNf: uniqDonos,
      multiDono: uniqDonos.length > 1,
      origemSeparacao,
      espelhoOpl: null,
      espelhosOpl: [],
    };
  }

  /** Vários donos nas NF-e: valida um espelho OPL por dono (não exige CD_DONO único no cabeçalho). */
  if (uniqDonos.length > 1) {
    const pedidosPorDono = await carregarPedidosPorDonoNfCarga(tenantId, cdCarga, q);
    const espelhosOpl = [];
    const cdsOpl = [];
    let modoExpedicaoSemPedido = false;
    let origemSemPedido = null;

    for (const cdDono of uniqDonos) {
      const pedidos = [...(pedidosPorDono.get(cdDono) || [])];
      const nmDono = await carregarNomeDono(tenantId, cdDono, q);
      const rotulo = labelDono(cdDono, nmDono);

      if (temItensSemPedido) {
        const rSem = await validarEstoqueDemandaNfSemPedido(tenantId, cdCarga, cdDono, bloqueios, {
          executor: q,
          prefixDono: `Dono ${rotulo} — `,
        });
        if (rSem.qSkus > 0) {
          modoExpedicaoSemPedido = true;
          origemSemPedido = rSem.origem;
        }
      }

      if (!pedidos.length) continue;

      const resDono = await validarEspelhosOplAtivosPorPedidos(tenantId, cdDono, pedidos, bloqueios, {
        executor: q,
        prefixDono: `Dono ${rotulo} — `,
        nmDono,
      });
      for (const esp of resDono.espelhosOpl) {
        espelhosOpl.push(esp);
      }
      for (const cd of resDono.cdsOpl) {
        if (!cdsOpl.includes(cd)) cdsOpl.push(cd);
      }
    }

    origemSeparacao = cdsOpl.length
      ? { tipo: 'OPL_ARQUIVOS_POR_DONO', CD_OPL_ARQUIVOS: cdsOpl }
      : origemSemPedido || (modoExpedicaoSemPedido ? { tipo: 'NFE_SEM_PEDIDO', CD_CARGA: cdCarga } : null);

    return {
      ok: bloqueios.length === 0,
      bloqueios,
      cdDonoCarga,
      cdsDonoNf: uniqDonos,
      multiDono: true,
      origemSeparacao,
      espelhoOpl: espelhosOpl[0] || null,
      espelhosOpl,
      modoExpedicaoSemPedido,
    };
  }

  /** Um único dono nas NF-e (fluxo clássico). */
  const cdDonoUnico = uniqDonos[0];
  const pedidosNf = [...new Set(itensNf.map((x) => x.pedido).filter(Boolean))];

  if (cdDonoCarga != null && cdDonoCarga !== cdDonoUnico) {
    const nmCarga = await carregarNomeDono(tenantId, cdDonoCarga, q);
    const nmNf = await carregarNomeDono(tenantId, cdDonoUnico, q);
    bloqueios.push({
      code: 'DONO_CARGA_NF_DIVERGENTE',
      mensagem: `Dono da carga (${labelDono(cdDonoCarga, nmCarga)}) difere do dono das NF-e (${labelDono(cdDonoUnico, nmNf)}). Em Cargas programadas → detalhe da carga #${cdCarga} → altere «Dono do estoque da carga» para o mesmo das NF ou use «Alinhar às NF» (ou deixe em branco).`,
      cdDonoCarga,
      cdDonoNf: cdDonoUnico,
      cdCarga,
    });
  }

  let modoExpedicaoSemPedido = false;
  let origemSemPedido = null;
  if (temItensSemPedido) {
    const rSem = await validarEstoqueDemandaNfSemPedido(tenantId, cdCarga, cdDonoUnico, bloqueios, {
      executor: q,
      prefixDono: '',
    });
    if (rSem.qSkus > 0) {
      modoExpedicaoSemPedido = true;
      origemSemPedido = rSem.origem;
    }
  }

  if (!pedidosNf.length) {
    return {
      ok: bloqueios.length === 0,
      bloqueios,
      cdDonoCarga: cdDonoCarga ?? cdDonoUnico,
      cdsDonoNf: uniqDonos,
      multiDono: false,
      origemSeparacao: origemSemPedido || { tipo: 'NFE_SEM_PEDIDO', CD_CARGA: cdCarga },
      espelhoOpl: null,
      espelhosOpl: [],
      modoExpedicaoSemPedido: true,
    };
  }

  const resUnico = await validarEspelhosOplAtivosPorPedidos(tenantId, cdDonoUnico, pedidosNf, bloqueios, {
    executor: q,
    prefixDono: '',
  });
  origemSeparacao =
    resUnico.origemSeparacao ||
    origemSemPedido ||
    (modoExpedicaoSemPedido ? { tipo: 'NFE_SEM_PEDIDO', CD_CARGA: cdCarga } : null);

  if (!resUnico.espelhosOpl.length && !modoExpedicaoSemPedido) {
    return {
      ok: bloqueios.length === 0,
      bloqueios,
      cdDonoCarga: cdDonoCarga ?? cdDonoUnico,
      cdsDonoNf: uniqDonos,
      multiDono: false,
      origemSeparacao,
      espelhoOpl: null,
      espelhosOpl: [],
      modoExpedicaoSemPedido: false,
    };
  }

  return {
    ok: bloqueios.length === 0,
    bloqueios,
    cdDonoCarga: cdDonoCarga ?? cdDonoUnico,
    cdsDonoNf: uniqDonos,
    multiDono: false,
    origemSeparacao,
    espelhoOpl: resUnico.espelhosOpl[0] || null,
    espelhosOpl: resUnico.espelhosOpl,
    modoExpedicaoSemPedido,
  };
}

function anexarValidacaoEstoqueNaCarga(validacao, validacaoEstoque) {
  if (!validacao) return validacao;
  const divs = Array.isArray(validacao.divergencias) ? [...validacao.divergencias] : [];
  for (const b of (validacaoEstoque && validacaoEstoque.bloqueios) || []) {
    divs.push({
      tipo: b.code || 'BLOQUEIO_ESTOQUE',
      severidade: 'BLOQUEIO',
      pedido: '',
      codigo: '',
      descricao: b.mensagem || '',
      unidadePedido: null,
      unidadeNf: null,
      qtdPedido: 0,
      qtdNf: 0,
      qtdDif: 0,
      bloqueioEstoque: true,
    });
  }
  validacao.divergencias = divs;
  validacao.validacaoEstoque = validacaoEstoque || null;
  validacao.podeExpedirEstoque = !!(validacaoEstoque && validacaoEstoque.ok);
  validacao.podeExpedir = !!validacao.podeExpedir && validacao.podeExpedirEstoque;
  if (!validacao.podeExpedirEstoque) validacao.status = 'BLOQUEIO';
  return validacao;
}

module.exports = {
  validarEstoqueOplParaExpedicao,
  anexarValidacaoEstoqueNaCarga,
  isCargaBaixaEstoque,
};
