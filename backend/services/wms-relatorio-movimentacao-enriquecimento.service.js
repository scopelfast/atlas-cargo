'use strict';

const { pool } = require('../config/db');
const { carregarBaixaPorMovimentos } = require('./wms-baixa-estoque.service');

function parseDataIso(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normCodigo(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function chaveProduto(r) {
  const dono = r.CD_DONO != null ? String(r.CD_DONO) : '0';
  const prod =
    r.CD_PRODUTO != null && String(r.CD_PRODUTO).trim() !== ''
      ? String(r.CD_PRODUTO)
      : String(r.CODIGO_PRODUTO || '').trim() || '0';
  return `${dono}|${prod}`;
}

function diaAnteriorIso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDocumentoNf(numero, serie) {
  const n = String(numero || '').trim();
  const s = String(serie || '').trim();
  if (!n) return '';
  return s ? `NF ${n} / ${s}` : `NF ${n}`;
}

/** Rótulo amigável para confronto com ERP do dono (sem valores monetários). */
function rotuloTipoMovimento(tp, opts) {
  opts = opts || {};
  if (opts.fgSaldoInicial) return 'Posição inicial';
  if (opts.fgExpedicaoEstornada) return 'Expedição estornada (reabertura)';
  const t = String(tp || '').toUpperCase();
  if (t === 'ENTRADA_RECEBIMENTO') return 'Entrada';
  if (t === 'EXPEDICAO_SAIDA') return 'Saída';
  if (t === 'EXPEDICAO_ESTORNO') return 'Estorno saída';
  if (t === 'EXPEDICAO_LIQUIDA') return 'Expedição (líquido)';
  if (t === 'INVENTARIO_AJUSTE') return 'Ajuste inventário';
  if (t === 'TRANSFERENCIA_SAIDA') return 'Transferência (saída)';
  if (t === 'TRANSFERENCIA_ENTRADA') return 'Transferência (entrada)';
  if (t === 'TRANSFERENCIA_ESTORNO_SAIDA') return 'Estorno transferência (saída)';
  if (t === 'TRANSFERENCIA_ESTORNO_ENTRADA') return 'Estorno transferência (entrada)';
  if (t === 'BAIXA_VENCIDO') return 'Retirada — Produto vencido';
  if (t === 'BAIXA_AVARIA') return 'Retirada — Avaria';
  if (t === 'BAIXA_SEGREGADO') return 'Retirada — Segregado';
  if (t === 'BAIXA_PERDA') return 'Retirada — Perda';
  if (t === 'BAIXA_QUEBRA') return 'Retirada — Quebra';
  if (t === 'BAIXA_RECALL') return 'Retirada — Recall';
  if (t === 'BAIXA_DOACAO') return 'Retirada — Doação';
  if (t === 'BAIXA_AMOSTRA') return 'Retirada — Amostra';
  if (t === 'BAIXA_CONSUMO_INTERNO') return 'Retirada — Consumo interno';
  if (t === 'BAIXA_QUALIDADE') return 'Retirada — Ajuste qualidade';
  if (t === 'BAIXA_FURTO') return 'Retirada — Furto/roubo';
  if (t.endsWith('_ESTORNO')) {
    const base = t.replace(/_ESTORNO$/, '');
    if (base === 'BAIXA_VENCIDO') return 'Estorno — Produto vencido';
    if (base.startsWith('BAIXA_')) return 'Estorno — ' + base.replace(/^BAIXA_/, '').replace(/_/g, ' ').toLowerCase();
    return 'Estorno — ' + base.replace(/_/g, ' ').toLowerCase();
  }
  if (t === 'BAIXA_ESTOQUE') return 'Retirada — Baixa de estoque';
  if (t.startsWith('BAIXA_')) return 'Retirada — ' + t.replace(/^BAIXA_/, '').replace(/_/g, ' ').toLowerCase();
  return t || 'Movimento';
}

function parseCdInventarioIdempotency(key) {
  const m = String(key || '').match(/INV_AJUSTE\|I(\d+)\|/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Para cada CD_PRODUTO, conjunto de chaves normalizadas (código interno + de-para externo).
 */
async function carregarChavesCodigoPorCdProduto(tenantId, cdDono, cdProdutos) {
  const ids = [...new Set((cdProdutos || []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  const mapa = new Map();
  if (!ids.length || !Number.isFinite(cdDono)) return mapa;

  const rPr = await pool.query(
    `SELECT "CD_PRODUTO", TRIM("CODIGO") AS codigo
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = ANY($3::int[])`,
    [tenantId, cdDono, ids]
  );
  const codigosInternos = [];
  for (const row of rPr.rows || []) {
    const cd = parseInt(row.CD_PRODUTO, 10);
    const ck = normCodigo(row.codigo);
    if (!Number.isFinite(cd) || !ck) continue;
    if (!mapa.has(cd)) mapa.set(cd, new Set());
    mapa.get(cd).add(ck);
    codigosInternos.push(String(row.codigo || '').trim().toLowerCase());
  }

  if (codigosInternos.length) {
    try {
      const rDep = await pool.query(
        `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO"
           FROM "WMS_DEPARA_PRODUTO"
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "FGACTIVE" = 'S'
            AND LOWER(TRIM("CODIGO_INTERNO")) = ANY($3::text[])`,
        [tenantId, cdDono, [...new Set(codigosInternos)]]
      );
      const internoParaCd = new Map();
      for (const row of rPr.rows || []) {
        internoParaCd.set(String(row.codigo || '').trim().toLowerCase(), parseInt(row.CD_PRODUTO, 10));
      }
      for (const d of rDep.rows || []) {
        const ex = normCodigo(d.CODIGO_EXTERNO);
        const interno = String(d.CODIGO_INTERNO || '').trim().toLowerCase();
        const cd = internoParaCd.get(interno);
        if (!ex || !Number.isFinite(cd)) continue;
        if (!mapa.has(cd)) mapa.set(cd, new Set());
        mapa.get(cd).add(ex);
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  return mapa;
}

function dedupeParesCargaProduto(pares) {
  const seen = new Set();
  const out = [];
  for (const p of pares || []) {
    const k = `${p.cdCarga}|${p.cdDono}|${p.cdProduto}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * @returns {Map<string, { numeroNf, serie, cdNfeSaida, qtdPositiva }[]>}
 *   chave `${cdCarga}|${cdDono}|${cdProduto}`
 */
async function carregarItensNfSaidaPorCargaProduto(tenantId, pares) {
  const mapa = new Map();
  pares = dedupeParesCargaProduto(pares);
  if (!pares.length) return mapa;

  const cargas = [...new Set(pares.map((p) => p.cdCarga))];
  const produtosPorCargaDono = new Map();
  const porDono = new Map();
  for (const p of pares) {
    const kk = `${p.cdCarga}|${p.cdDono}`;
    if (!produtosPorCargaDono.has(kk)) produtosPorCargaDono.set(kk, new Set());
    produtosPorCargaDono.get(kk).add(p.cdProduto);
    if (!porDono.has(p.cdDono)) porDono.set(p.cdDono, new Set());
    porDono.get(p.cdDono).add(p.cdProduto);
  }

  let rowsNf = [];
  try {
    const r = await pool.query(
      `SELECT j."CD_CARGA"::integer AS cd_carga,
              n."CD_DONO"::integer AS cd_dono,
              n."NUMERO_NF" AS numero_nf,
              n."SERIE" AS serie,
              n."CD_NFE_SAIDA"::integer AS cd_nfe_saida,
              ln.elem AS elem
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE
            WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON"
            ELSE '[]'::jsonb
          END
        ) AS ln(elem)
        WHERE j."CD_CARGA" = ANY($2::int[])
          AND n."TENANT_ID" = $1`,
      [tenantId, cargas]
    );
    rowsNf = r.rows || [];
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    return mapa;
  }

  const chavesPorDonoProd = new Map();
  for (const [cdDono, setProd] of porDono) {
    const mp = await carregarChavesCodigoPorCdProduto(tenantId, cdDono, [...setProd]);
    for (const cdProd of setProd) {
      chavesPorDonoProd.set(`${cdDono}|${cdProd}`, mp.get(cdProd) || new Set());
    }
  }

  const agg = new Map();
  for (const row of rowsNf) {
    const cdCarga = parseInt(row.cd_carga, 10);
    const cdDono = parseInt(row.cd_dono, 10);
    const elem = row.elem || {};
    const cod = normCodigo(elem.cProd || elem.codigo || '');
    const qtd = toNumber(elem.qCom || elem.quantidade || elem.qTrib || 0);
    if (!Number.isFinite(cdCarga) || !Number.isFinite(cdDono) || !cod || qtd <= 0) continue;

    const produtos = produtosPorCargaDono.get(`${cdCarga}|${cdDono}`);
    if (!produtos || !produtos.size) continue;

    let cdProdMatch = null;
    for (const cdProd of produtos) {
      const chaves = chavesPorDonoProd.get(`${cdDono}|${cdProd}`);
      if (chaves && chaves.has(cod)) {
        cdProdMatch = cdProd;
        break;
      }
    }
    if (cdProdMatch == null) continue;

    const k = `${cdCarga}|${cdDono}|${cdProdMatch}`;
    const subK = `${row.numero_nf || ''}|${row.serie || ''}|${row.cd_nfe_saida || ''}`;
    if (!agg.has(k)) agg.set(k, new Map());
    const inner = agg.get(k);
    if (!inner.has(subK)) {
      inner.set(subK, {
        numeroNf: row.numero_nf,
        serie: row.serie,
        cdNfeSaida: row.cd_nfe_saida,
        qtdPositiva: 0,
      });
    }
    inner.get(subK).qtdPositiva = Number((inner.get(subK).qtdPositiva + qtd).toFixed(6));
  }

  for (const [k, inner] of agg) {
    mapa.set(
      k,
      [...inner.values()].sort((a, b) =>
        String(a.numeroNf || '').localeCompare(String(b.numeroNf || ''), 'pt-BR')
      )
    );
  }
  return mapa;
}

async function carregarTransferenciaPorMovimento(tenantId, cdMovimentos) {
  const mapa = new Map();
  const ids = [...new Set((cdMovimentos || []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  if (!ids.length) return mapa;
  try {
    const r = await pool.query(
      `SELECT "CD_TRANSFERENCIA", "REF_CD_MOVIMENTO_SAIDA", "REF_CD_MOVIMENTO_ENTRADA"
         FROM "WMS_TRANSFERENCIA_DONO"
        WHERE "TENANT_ID" = $1
          AND (
            "REF_CD_MOVIMENTO_SAIDA" = ANY($2::bigint[])
            OR "REF_CD_MOVIMENTO_ENTRADA" = ANY($2::bigint[])
          )`,
      [tenantId, ids]
    );
    for (const row of r.rows || []) {
      const cd = row.CD_TRANSFERENCIA;
      if (row.REF_CD_MOVIMENTO_SAIDA != null) {
        mapa.set(String(row.REF_CD_MOVIMENTO_SAIDA), cd);
      }
      if (row.REF_CD_MOVIMENTO_ENTRADA != null) {
        mapa.set(String(row.REF_CD_MOVIMENTO_ENTRADA), cd);
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return mapa;
}

function montarDocumentoLinha(row, ctx) {
  if (row.FG_SALDO_INICIAL) return '—';
  const tp = String(row.TP_MOVIMENTO || '').toUpperCase();

  if (
    row.NUMERO_NF &&
    (tp === 'ENTRADA_RECEBIMENTO' ||
      row.REF_CD_NFE ||
      tp === 'EXPEDICAO_SAIDA' ||
      tp === 'EXPEDICAO_ESTORNO')
  ) {
    return formatDocumentoNf(row.NUMERO_NF, row.SERIE);
  }

  if (tp === 'INVENTARIO_AJUSTE' && row.REF_CD_INVENTARIO) {
    return `Inventário #${row.REF_CD_INVENTARIO}`;
  }

  if (tp.startsWith('TRANSFERENCIA') && row.REF_CD_TRANSFERENCIA) {
    return `Transferência #${row.REF_CD_TRANSFERENCIA}`;
  }

  if (tp.startsWith('BAIXA_') && row.REF_CD_BAIXA) {
    const nr = row.NR_DOCUMENTO_BAIXA || row.REF_CD_BAIXA;
    return `Baixa #${nr}`;
  }

  if (row.REF_CD_CARGA) {
    return `Carga #${row.REF_CD_CARGA} (sem NF no espelho)`;
  }

  if (row.CD_MOVIMENTO) return `Mov. #${row.CD_MOVIMENTO}`;
  return '—';
}

function linhaExpedicaoPorNf(row, it, qtd) {
  return Object.assign({}, row, {
    QTD: Number(qtd.toFixed(6)),
    SENTIDO: qtd < 0 ? 'SAIDA' : qtd > 0 ? 'ENTRADA' : '',
    NUMERO_NF: it.numeroNf,
    SERIE: it.serie,
    REF_CD_NFE_SAIDA: it.cdNfeSaida,
    REF_EXPLOSAO_NF: true,
  });
}

function somaQtdNfGrupo(itens) {
  return (itens || []).reduce((s, it) => s + Number(it.qtdPositiva || 0), 0);
}

/**
 * Quando o saldo líquido do ledger (saídas + estornos) já bate com a soma das NF da carga,
 * exibe só uma linha por nota — evita linhas «sem NF no espelho» por saídas duplicadas corrigidas.
 */
function consolidarExpedicaoQuandoNetConfere(exp, mapaNf) {
  /** @type {Map<string, object[]>} */
  const grupos = new Map();
  const ordemGrupos = [];
  for (const row of exp) {
    const k = `${row.REF_CD_CARGA}|${row.CD_DONO}|${row.CD_PRODUTO}`;
    if (!grupos.has(k)) {
      grupos.set(k, []);
      ordemGrupos.push(k);
    }
    grupos.get(k).push(row);
  }

  const consumidos = new Set();
  const sinteticos = [];

  for (const k of ordemGrupos) {
    const rows = grupos.get(k);
    const itens = mapaNf.get(k) || [];
    if (!itens.length || !rows.length) continue;

    const netLedger = rows.reduce((s, r) => s + (Number(r.QTD) || 0), 0);
    const expectedNet = Number((-somaQtdNfGrupo(itens)).toFixed(6));
    if (Math.abs(Number(netLedger.toFixed(6)) - expectedNet) > 1e-6) continue;

    for (const row of rows) consumidos.add(row);
    const saidas = rows.filter((r) => String(r.TP_MOVIMENTO || '').toUpperCase() === 'EXPEDICAO_SAIDA');
    const base = saidas.length ? saidas[saidas.length - 1] : rows[rows.length - 1];
    for (const it of itens) {
      const q = Number(it.qtdPositiva) || 0;
      if (q < 1e-9) continue;
      sinteticos.push(
        Object.assign({}, linhaExpedicaoPorNf(base, it, -q), {
          TP_MOVIMENTO: 'EXPEDICAO_SAIDA',
        })
      );
    }
  }

  return {
    expRestante: exp.filter((r) => !consumidos.has(r)),
    sinteticos,
  };
}

/**
 * Distribui cada movimento de expedição pelas NF da carga usando a qtd da nota (LINHAS_JSON),
 * sem repetir por movimento duplicado no ledger e sem jogar o total na primeira/última NF.
 */
function explodirLinhasExpedicao(linhas, mapaNf) {
  const outros = [];
  const exp = [];
  for (const row of linhas || []) {
    const tp = String(row.TP_MOVIMENTO || '').toUpperCase();
    if (
      (tp !== 'EXPEDICAO_SAIDA' && tp !== 'EXPEDICAO_ESTORNO') ||
      !row.REF_CD_CARGA ||
      !row.CD_PRODUTO
    ) {
      outros.push(row);
      continue;
    }
    exp.push(row);
  }

  exp.sort((a, b) => {
    const ta = a.DH_MOVIMENTO ? new Date(a.DH_MOVIMENTO).getTime() : 0;
    const tb = b.DH_MOVIMENTO ? new Date(b.DH_MOVIMENTO).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (parseInt(a.CD_MOVIMENTO, 10) || 0) - (parseInt(b.CD_MOVIMENTO, 10) || 0);
  });

  const { expRestante, sinteticos } = consolidarExpedicaoQuandoNetConfere(exp, mapaNf);

  /** @type {Map<string, Map<string, { it: object, jaSaida: number }>>} */
  const estadoPorGrupo = new Map();

  function estadoGrupo(k, itens) {
    if (!estadoPorGrupo.has(k)) {
      const inner = new Map();
      for (const it of itens || []) {
        const subK = `${it.numeroNf}|${it.serie}|${it.cdNfeSaida}`;
        inner.set(subK, { it, jaSaida: 0 });
      }
      estadoPorGrupo.set(k, inner);
    }
    return estadoPorGrupo.get(k);
  }

  const out = [];
  for (const row of expRestante) {
    const k = `${row.REF_CD_CARGA}|${row.CD_DONO}|${row.CD_PRODUTO}`;
    const itens = mapaNf.get(k) || [];
    const qtdMov = Number(row.QTD) || 0;
    if (!itens.length) {
      out.push(row);
      continue;
    }
    const inner = estadoGrupo(k, itens);
    let restante = Math.abs(qtdMov);

    if (qtdMov < -1e-9) {
      for (const st of inner.values()) {
        if (restante < 1e-9) break;
        const cap = Number(st.it.qtdPositiva) - Number(st.jaSaida);
        if (cap < 1e-9) continue;
        const take = Math.min(restante, cap);
        st.jaSaida = Number((st.jaSaida + take).toFixed(6));
        restante = Number((restante - take).toFixed(6));
        out.push(linhaExpedicaoPorNf(row, st.it, -take));
      }
      if (restante > 1e-6) {
        out.push(
          Object.assign({}, row, {
            QTD: Number((-restante).toFixed(6)),
            SENTIDO: 'SAIDA',
            NUMERO_NF: null,
            SERIE: null,
            REF_CD_NFE_SAIDA: null,
            OBS_DOCUMENTO: 'Saída duplicada no ledger (sincronize expedição para corrigir)',
          })
        );
      }
      continue;
    }

    if (qtdMov > 1e-9) {
      const lista = [...inner.values()].filter((st) => st.jaSaida > 1e-9);
      lista.sort((a, b) => b.jaSaida - a.jaSaida);
      for (const st of lista) {
        if (restante < 1e-9) break;
        const give = Math.min(restante, st.jaSaida);
        st.jaSaida = Number((st.jaSaida - give).toFixed(6));
        restante = Number((restante - give).toFixed(6));
        out.push(linhaExpedicaoPorNf(row, st.it, give));
      }
      if (restante > 1e-6) {
        out.push(
          Object.assign({}, row, {
            QTD: Number(restante.toFixed(6)),
            SENTIDO: 'ENTRADA',
            NUMERO_NF: null,
            SERIE: null,
            REF_CD_NFE_SAIDA: null,
            OBS_DOCUMENTO: 'Estorno ledger maior que saídas já alocadas por NF',
          })
        );
      }
      continue;
    }

    out.push(row);
  }

  const todas = [...outros, ...out, ...sinteticos];
  todas.sort((a, b) => {
    const ta = a.DH_MOVIMENTO ? new Date(a.DH_MOVIMENTO).getTime() : 0;
    const tb = b.DH_MOVIMENTO ? new Date(b.DH_MOVIMENTO).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return (parseInt(a.CD_MOVIMENTO, 10) || 0) - (parseInt(b.CD_MOVIMENTO, 10) || 0);
  });
  return todas;
}

function aplicarDocumentosELegendas(linhas, ctx) {
  return (linhas || []).map((row) => {
    const doc = row.OBS_DOCUMENTO
      ? `${montarDocumentoLinha(row, ctx)} — ${row.OBS_DOCUMENTO}`
      : montarDocumentoLinha(row, ctx);
    const tpBaixa =
      row.ROTULO_MOVIMENTO_BAIXA ||
      rotuloTipoMovimento(row.TP_MOVIMENTO, {
        fgSaldoInicial: row.FG_SALDO_INICIAL,
        fgExpedicaoEstornada: row.FG_EXPEDICAO_ESTORNADA,
      });
    return Object.assign({}, row, {
      TIPO_LEGIVEL: tpBaixa,
      DOCUMENTO: doc,
      REF_OPERACAO:
        row.REF_CD_CARGA != null
          ? `Carga ${row.REF_CD_CARGA}`
          : row.REF_CD_INVENTARIO != null
            ? `Inv. ${row.REF_CD_INVENTARIO}`
            : row.REF_CD_TRANSFERENCIA != null
              ? `Transf. ${row.REF_CD_TRANSFERENCIA}`
              : row.REF_CD_BAIXA != null
                ? `Baixa ${row.NR_DOCUMENTO_BAIXA || row.REF_CD_BAIXA}`
                : '',
    });
  });
}

function inserirSaldoAcumulado(linhas, saldoInicialPorChave, comSaldoInicial) {
  const porChave = new Map();
  for (const row of linhas || []) {
    const k = chaveProduto(row);
    if (!porChave.has(k)) porChave.set(k, []);
    porChave.get(k).push(row);
  }

  const resultado = [];
  const chavesOrdenadas = [...porChave.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));

  for (const k of chavesOrdenadas) {
    const grupo = porChave.get(k);
    grupo.sort((a, b) => {
      const ta = a.DH_MOVIMENTO ? new Date(a.DH_MOVIMENTO).getTime() : 0;
      const tb = b.DH_MOVIMENTO ? new Date(b.DH_MOVIMENTO).getTime() : 0;
      if (ta !== tb) return ta - tb;
      return (parseInt(a.CD_MOVIMENTO, 10) || 0) - (parseInt(b.CD_MOVIMENTO, 10) || 0);
    });

    let saldo = comSaldoInicial ? Number(saldoInicialPorChave.get(k) || 0) : 0;
    if (comSaldoInicial) {
      const base = grupo[0];
      resultado.push(
        Object.assign({}, base, {
          DH_MOVIMENTO: null,
          FG_SALDO_INICIAL: true,
          QTD: 0,
          SENTIDO: '',
          TIPO_LEGIVEL: rotuloTipoMovimento(null, { fgSaldoInicial: true }),
          DOCUMENTO: '—',
          QTD_SALDO: Number(saldo.toFixed(6)),
          CD_MOVIMENTO: null,
        })
      );
    }

    for (const row of grupo) {
      saldo = Number((saldo + (Number(row.QTD) || 0)).toFixed(6));
      resultado.push(Object.assign({}, row, { QTD_SALDO: saldo }));
    }
  }
  return resultado;
}

function somarPorChave(linhas) {
  const m = new Map();
  for (const r of linhas || []) {
    if (r.FG_SALDO_INICIAL) continue;
    const k = chaveProduto(r);
    m.set(k, Number(((m.get(k) || 0) + (Number(r.QTD) || 0)).toFixed(6)));
  }
  return m;
}

function normalizarOrdemMovimentacao(v) {
  const s = String(v || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (s === 'numero_nf' || s === 'nf' || s === 'nota' || s === 'num_nf') return 'numero_nf';
  if (s === 'documento' || s === 'doc') return 'documento';
  if (s === 'carga' || s === 'ref_carga' || s === 'operacao') return 'carga';
  if (s === 'tipo' || s === 'tipo_movimento') return 'tipo';
  return 'data';
}

function montarRotuloFiltroOrdem(filtros) {
  const o = normalizarOrdemMovimentacao(filtros?.ordem);
  if (o === 'numero_nf') return 'Número da NF (crescente)';
  if (o === 'documento') return 'Documento (A–Z)';
  if (o === 'carga') return 'Carga WMS, depois NF';
  if (o === 'tipo') return 'Tipo de movimento, depois NF';
  return 'Data/hora (cronológico)';
}

function cmpDataMovimento(a, b) {
  const ta = a.DH_MOVIMENTO ? new Date(a.DH_MOVIMENTO).getTime() : 0;
  const tb = b.DH_MOVIMENTO ? new Date(b.DH_MOVIMENTO).getTime() : 0;
  if (ta !== tb) return ta - tb;
  return (parseInt(a.CD_MOVIMENTO, 10) || 0) - (parseInt(b.CD_MOVIMENTO, 10) || 0);
}

function cmpProdutoMovimento(a, b) {
  return chaveProduto(a).localeCompare(chaveProduto(b), 'pt-BR');
}

function numeroNfSortKey(row) {
  const digits = String(row.NUMERO_NF || '').replace(/\D/g, '');
  if (!digits) return 0n;
  try {
    return BigInt(digits);
  } catch (_) {
    return 0n;
  }
}

function cmpNumeroNf(a, b) {
  const na = numeroNfSortKey(a);
  const nb = numeroNfSortKey(b);
  if (na !== nb) return na < nb ? -1 : 1;
  const sa = String(a.SERIE || '').trim();
  const sb = String(b.SERIE || '').trim();
  if (sa !== sb) return sa.localeCompare(sb, 'pt-BR', { numeric: true });
  const ia = parseInt(String(a.N_ITEM || '').replace(/\D/g, ''), 10) || 0;
  const ib = parseInt(String(b.N_ITEM || '').replace(/\D/g, ''), 10) || 0;
  if (ia !== ib) return ia - ib;
  return cmpDataMovimento(a, b);
}

/**
 * Ordenação final do relatório (após enriquecimento). Mantém produtos agrupados.
 */
function ordenarLinhasMovimentacaoRelatorio(linhas, ordem) {
  ordem = normalizarOrdemMovimentacao(ordem);
  const lista = [...(linhas || [])];
  if (ordem === 'data') {
    lista.sort((a, b) => {
      if (a.FG_SALDO_INICIAL && !b.FG_SALDO_INICIAL) return -1;
      if (!a.FG_SALDO_INICIAL && b.FG_SALDO_INICIAL) return 1;
      const cp = cmpProdutoMovimento(a, b);
      if (cp !== 0) return cp;
      return cmpDataMovimento(a, b);
    });
    return lista;
  }

  lista.sort((a, b) => {
    if (a.FG_SALDO_INICIAL && !b.FG_SALDO_INICIAL) return -1;
    if (!a.FG_SALDO_INICIAL && b.FG_SALDO_INICIAL) return 1;
    const cp = cmpProdutoMovimento(a, b);
    if (cp !== 0) return cp;
    if (ordem === 'numero_nf') return cmpNumeroNf(a, b);
    if (ordem === 'documento') {
      const da = String(a.DOCUMENTO || a.NUMERO_NF || '');
      const db = String(b.DOCUMENTO || b.NUMERO_NF || '');
      const c = da.localeCompare(db, 'pt-BR', { numeric: true });
      if (c !== 0) return c;
      return cmpDataMovimento(a, b);
    }
    if (ordem === 'carga') {
      const ca = parseInt(a.REF_CD_CARGA, 10) || 0;
      const cb = parseInt(b.REF_CD_CARGA, 10) || 0;
      if (ca !== cb) return ca - cb;
      return cmpNumeroNf(a, b);
    }
    if (ordem === 'tipo') {
      const ta = String(a.TIPO_LEGIVEL || a.TP_MOVIMENTO || '');
      const tb = String(b.TIPO_LEGIVEL || b.TP_MOVIMENTO || '');
      const c = ta.localeCompare(tb, 'pt-BR');
      if (c !== 0) return c;
      return cmpNumeroNf(a, b);
    }
    return cmpDataMovimento(a, b);
  });
  return lista;
}

/** Recalcula saldo na ordem exibida (quando não é cronológica). */
function recalcularSaldoNaOrdemExibida(linhas, saldoInicialPorChave, comSaldoInicial) {
  const movs = (linhas || []).filter((r) => !r.FG_SALDO_INICIAL);
  const ordemChaves = [];
  const porChave = new Map();
  for (const row of movs) {
    const k = chaveProduto(row);
    if (!porChave.has(k)) {
      porChave.set(k, []);
      ordemChaves.push(k);
    }
    porChave.get(k).push(row);
  }

  const resultado = [];
  for (const k of ordemChaves) {
    const grupo = porChave.get(k);
    let saldo = comSaldoInicial ? Number(saldoInicialPorChave.get(k) || 0) : 0;
    if (comSaldoInicial && grupo.length) {
      const base = grupo[0];
      resultado.push(
        Object.assign({}, base, {
          DH_MOVIMENTO: null,
          FG_SALDO_INICIAL: true,
          QTD: 0,
          SENTIDO: '',
          TIPO_LEGIVEL: rotuloTipoMovimento(null, { fgSaldoInicial: true }),
          DOCUMENTO: '—',
          QTD_SALDO: Number(saldo.toFixed(6)),
          CD_MOVIMENTO: null,
        })
      );
    }
    for (const row of grupo) {
      saldo = Number((saldo + (Number(row.QTD) || 0)).toFixed(6));
      resultado.push(Object.assign({}, row, { QTD_SALDO: saldo }));
    }
  }
  return resultado;
}

/**
 * Explode expedição por NF, resolve documentos (inventário/transferência) e saldo acumulado.
 * @param {string} tenantId
 * @param {object[]} linhas
 * @param {{ dtDe?: string }} opts
 */
async function enriquecerLinhasMovimentacao(tenantId, linhas, opts) {
  opts = opts || {};
  linhas = linhas || [];

  const paresExp = [];
  const cdMovimentos = [];
  for (const row of linhas) {
    const tp = String(row.TP_MOVIMENTO || '').toUpperCase();
    if ((tp === 'EXPEDICAO_SAIDA' || tp === 'EXPEDICAO_ESTORNO') && row.REF_CD_CARGA && row.CD_PRODUTO) {
      paresExp.push({
        cdCarga: parseInt(row.REF_CD_CARGA, 10),
        cdDono: parseInt(row.CD_DONO, 10),
        cdProduto: parseInt(row.CD_PRODUTO, 10),
      });
    }
    if (row.CD_MOVIMENTO) cdMovimentos.push(row.CD_MOVIMENTO);
  }

  const mapaNf = await carregarItensNfSaidaPorCargaProduto(tenantId, paresExp);
  const mapaTransf = await carregarTransferenciaPorMovimento(tenantId, cdMovimentos);
  const mapaBaixa = await carregarBaixaPorMovimentos(tenantId, cdMovimentos);

  let expandidas = explodirLinhasExpedicao(linhas, mapaNf);

  expandidas = expandidas.map((row) => {
    const tp = String(row.TP_MOVIMENTO || '').toUpperCase();
    const extra = {};
    if (tp === 'INVENTARIO_AJUSTE') {
      const cdInv = parseCdInventarioIdempotency(row.IDEMPOTENCY_KEY);
      if (cdInv) extra.REF_CD_INVENTARIO = cdInv;
    }
    if (tp.startsWith('TRANSFERENCIA') && row.CD_MOVIMENTO) {
      const cdTr = mapaTransf.get(String(row.CD_MOVIMENTO));
      if (cdTr) extra.REF_CD_TRANSFERENCIA = cdTr;
    }
    if (tp.startsWith('BAIXA_') && row.CD_MOVIMENTO) {
      const b = mapaBaixa.get(String(row.CD_MOVIMENTO));
      if (b) {
        extra.REF_CD_BAIXA = b.CD_BAIXA;
        extra.NR_DOCUMENTO_BAIXA = b.NR_DOCUMENTO;
        extra.ROTULO_MOVIMENTO_BAIXA = b.ROTULO_MOVIMENTO;
        if (b.CODIGO_OL) extra.OBS_DOCUMENTO = `OL ${b.CODIGO_OL} — ${b.DS_MOTIVO || ''}`.trim();
      }
    }
    if (row.NUMERO_NF && !row.SERIE && row.REF_CD_NFE) {
      /* série já pode vir do SQL ent */
    }
    return Object.assign({}, row, extra);
  });

  const dtDe = parseDataIso(opts.dtDe);
  let saldoInicialPorChave = opts.saldoInicialPorChave;
  if (dtDe && !saldoInicialPorChave) {
    saldoInicialPorChave = new Map();
  }

  expandidas = aplicarDocumentosELegendas(expandidas, { mapaTransf });
  if (opts.comSaldoAcumulado !== false) {
    expandidas = inserirSaldoAcumulado(
      expandidas,
      saldoInicialPorChave || new Map(),
      !!dtDe
    );
  }

  return expandidas;
}

module.exports = {
  enriquecerLinhasMovimentacao,
  somarPorChave,
  diaAnteriorIso,
  rotuloTipoMovimento,
  formatDocumentoNf,
  chaveProduto,
  normalizarOrdemMovimentacao,
  montarRotuloFiltroOrdem,
  ordenarLinhasMovimentacaoRelatorio,
  recalcularSaldoNaOrdemExibida,
};
