'use strict';

const { pool } = require('../config/db');
const { schemaMissing, sqlFiltroPedidosOplNorm } = require('./wms-carga-validacao.service');
const { nomeEntregaUnidadeOuLocalDestino, localidadeEntregaNfe } = require('./wms-nfe-saida-destino-display.service');

function normPedido(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : '';
}

function normCodigo(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function formatCnpj14(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length !== 14) return d || '';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}

function montarLocalEntrega(uf, cidade) {
  const u = String(uf || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const c = String(cidade || '').trim();
  if (u && c) return `${u} | ${c.toUpperCase()}`;
  return u || c || '—';
}

function montarClienteEntregaNf(n) {
  const nome = nomeEntregaUnidadeOuLocalDestino(n);
  const cnpj = formatCnpj14(n.CNPJ_ENTREGA || n.CNPJ_DEST || '');
  if (nome && cnpj) return `${nome} — ${cnpj}`;
  return nome || cnpj || '—';
}

function montarClienteEntregaOpl(p) {
  const cod = String(p.COD_DESTINATARIO || '').trim();
  const raz = String(p.RAZ_SOC_DEST || '').trim();
  const nome = [cod, raz].filter(Boolean).join(' — ');
  return nome || '—';
}

/** Índice NF + OPL por carga para enriquecer linhas do comparativo. */
async function carregarContextoCarga(tenantId, cdCarga) {
  const itemIndex = new Map();
  const pedidoIndex = new Map();

  try {
    const r = await pool.query(
      `SELECT n."NUMERO_NF",
              n."SERIE",
              n."CNPJ_ENTREGA",
              n."CNPJ_DEST",
              n."XNOME_ENTREGA",
              n."XNOME_DEST",
              n."XMUN_DEST",
              n."UF_DEST",
              n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );

    for (const n of r.rows) {
      const numeroNf = n.NUMERO_NF != null ? String(n.NUMERO_NF).trim() : '';
      const loc = localidadeEntregaNfe(n);
      const dsLocal = montarLocalEntrega(loc.uf, loc.cidade);
      const dsCliente = montarClienteEntregaNf(n);
      const linhas = Array.isArray(n.LINHAS_JSON) ? n.LINHAS_JSON : [];

      for (const ln of linhas) {
        const ped = normPedido(ln.xPed || ln.xped || '');
        const cod = normCodigo(ln.cProd || ln.codigo || '');
        if (!ped) continue;

        if (!pedidoIndex.has(ped)) {
          pedidoIndex.set(ped, {
            numerosNf: new Set(),
            dsLocal,
            dsCliente,
          });
        }
        const pe = pedidoIndex.get(ped);
        if (numeroNf) pe.numerosNf.add(numeroNf);

        if (cod) {
          const k = `${ped}|${cod}`;
          if (!itemIndex.has(k)) {
            itemIndex.set(k, { numeroNf, dsLocal, dsCliente });
          }
        }
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }

  return { itemIndex, pedidoIndex, oplIndex: new Map() };
}

async function carregarContextoOplPedidos(tenantId, pedidosNorm) {
  const oplIndex = new Map();
  const lista = [
    ...new Set(
      (pedidosNorm || [])
        .map(normPedido)
        .filter(Boolean)
        .flatMap((p) => {
          const n = parseInt(p, 10);
          return Number.isFinite(n) ? [p, String(n)] : [p];
        })
    ),
  ];
  if (!lista.length) return oplIndex;

  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (p."NUM_PEDIDO")
              p."NUM_PEDIDO",
              p."COD_DESTINATARIO",
              p."RAZ_SOC_DEST",
              p."CIDADE_ENTREGA",
              p."UF_ENTREGA"
         FROM "WMS_OPL_PEDIDO" p
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
        WHERE a."TENANT_ID" = $1
          AND ${sqlFiltroPedidosOplNorm(2)}
        ORDER BY p."NUM_PEDIDO", a."DH_IMPORT" DESC`,
      [tenantId, lista]
    );
    for (const p of r.rows) {
      const ped = normPedido(p.NUM_PEDIDO);
      oplIndex.set(ped, {
        dsLocal: montarLocalEntrega(p.UF_ENTREGA, p.CIDADE_ENTREGA),
        dsCliente: montarClienteEntregaOpl(p),
      });
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return oplIndex;
}

function numerosNfPedido(pedidoIndex, pedNorm) {
  const pe = pedidoIndex.get(pedNorm);
  if (!pe || !pe.numerosNf.size) return '';
  return [...pe.numerosNf].sort((a, b) => parseInt(a, 10) - parseInt(b, 10)).join(', ');
}

/**
 * Enriquece uma linha analítica com Nota, Local e Cliente de entrega.
 */
function enriquecerLinhaContexto(row, ctx) {
  const pedNorm = normPedido(row.NR_PEDIDO);
  const codNorm = normCodigo(row.COD_PRODUTO);
  const item = ctx.itemIndex.get(`${pedNorm}|${codNorm}`);
  const ped = ctx.pedidoIndex.get(pedNorm);
  const opl = ctx.oplIndex.get(pedNorm);

  let dsNota = '—';
  if (item && item.numeroNf) {
    dsNota = item.numeroNf;
  } else if (ped && ped.numerosNf.size) {
    const nums = numerosNfPedido(ctx.pedidoIndex, pedNorm);
    dsNota =
      row.CATEGORIA === 'SEPARACAO_SEM_NF' ? `Pedido na NF ${nums}` : nums;
  }

  let dsLocal = '—';
  let dsCliente = '—';
  if (item) {
    dsLocal = item.dsLocal;
    dsCliente = item.dsCliente;
  } else if (ped) {
    dsLocal = ped.dsLocal;
    dsCliente = ped.dsCliente;
  } else if (opl) {
    dsLocal = opl.dsLocal;
    dsCliente = opl.dsCliente;
  }

  return {
    ...row,
    DS_NOTA: dsNota,
    DS_LOCAL: dsLocal,
    DS_CLIENTE_ENTREGA: dsCliente,
  };
}

function chaveGrupoSintetico(row) {
  return [
    row.CD_CARGA,
    normPedido(row.NR_PEDIDO),
    row.DS_NOTA || '',
    row.DS_LOCAL || '',
    row.DS_CLIENTE_ENTREGA || '',
  ].join('\u001f');
}

/** Agrupa linhas analíticas por entrega (carga + pedido + nota + destino). */
function agruparLinhasSintetico(linhas) {
  const map = new Map();
  for (const row of linhas || []) {
    const k = chaveGrupoSintetico(row);
    if (!map.has(k)) {
      map.set(k, {
        CD_CARGA: row.CD_CARGA,
        NM_DESCRICAO: row.NM_DESCRICAO,
        ST_EXPEDICAO: row.ST_EXPEDICAO,
        DH_CRIACAO: row.DH_CRIACAO,
        NR_PEDIDO: row.NR_PEDIDO,
        DS_NOTA: row.DS_NOTA,
        DS_LOCAL: row.DS_LOCAL,
        DS_CLIENTE_ENTREGA: row.DS_CLIENTE_ENTREGA,
        NM_DONO: row.NM_DONO,
        Q_SEP_SEM_NF: 0,
        Q_NF_SEM_SEP: 0,
        Q_OUTROS: 0,
        itens: [],
      });
    }
    const g = map.get(k);
    if (row.CATEGORIA === 'SEPARACAO_SEM_NF') g.Q_SEP_SEM_NF += 1;
    else if (row.CATEGORIA === 'NF_SEM_SEPARACAO') g.Q_NF_SEM_SEP += 1;
    else g.Q_OUTROS += 1;
    g.itens.push({
      cod: row.COD_PRODUTO,
      desc: row.DS_PRODUTO,
      tipo: row.DS_TIPO,
      cat: row.CATEGORIA,
    });
  }

  return Array.from(map.values())
    .map((g) => {
      const uniq = [];
      const seen = new Set();
      for (const it of g.itens) {
        const sk = `${it.cod}|${it.cat}`;
        if (seen.has(sk)) continue;
        seen.add(sk);
        uniq.push(it);
      }
      const resumoItens = uniq
        .slice(0, 8)
        .map((it) => `${it.cod} ${it.desc}`.trim())
        .join('; ');
      const extra = uniq.length > 8 ? ` (+${uniq.length - 8})` : '';
      return {
        ...g,
        DS_ITENS: resumoItens + extra,
        Q_ITENS: uniq.length,
      };
    })
    .sort((a, b) => (b.CD_CARGA || 0) - (a.CD_CARGA || 0));
}

module.exports = {
  carregarContextoCarga,
  carregarContextoOplPedidos,
  enriquecerLinhaContexto,
  agruparLinhasSintetico,
  montarLocalEntrega,
};
