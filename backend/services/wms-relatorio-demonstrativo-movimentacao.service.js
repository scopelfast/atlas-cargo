'use strict';

const {
  listarMovimentacaoItens,
  AVISOS_PADRAO,
  parseDataIso,
} = require('./wms-relatorio-movimentacao.service');
const { filtrarLinhasPorProduto } = require('./wms-relatorio-filtro-produto.service');

const AVISOS_DRE = [
  ...AVISOS_PADRAO,
  'Demonstrativo agrupado por dono e produto (código — descrição). Lote e validade não aparecem; lançamentos do mesmo produto no dono entram na mesma tabela.',
  'Colunas Entrada e Saída resumidas por dia: várias NF-e ou linhas da mesma NF no mesmo dia somam numa única linha de data.',
  'Saldo é acumulado cronológico (por dia) dentro de cada produto.',
  'Com data inicial no filtro de período, a primeira linha de cada produto é o saldo inicial (movimentos anteriores à data de início).',
];

function labelProduto(r) {
  const cod = String(r.CODIGO_PRODUTO || '').trim();
  const desc = String(r.NM_PRODUTO || '').trim();
  return cod && desc ? `${cod} — ${desc}` : cod || desc || '—';
}

function chaveProduto(r) {
  const dono = r.CD_DONO != null ? String(r.CD_DONO) : '0';
  const prod =
    r.CD_PRODUTO != null && String(r.CD_PRODUTO).trim() !== ''
      ? String(r.CD_PRODUTO)
      : String(r.CODIGO_PRODUTO || '').trim() || '0';
  return `${dono}|${prod}`;
}

function labelDono(r) {
  if (r.CD_DONO != null && r.NM_DONO) return `${r.CD_DONO} — ${r.NM_DONO}`;
  return String(r.CD_DONO != null ? r.CD_DONO : '—');
}

function formatDataBr(iso) {
  if (!iso) return '';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('pt-BR');
}

/** Chave do dia (YYYY-MM-DD local) para agrupar lançamentos do mesmo produto na mesma data. */
function dayKeyFromDh(dh) {
  if (!dh) return '';
  const d = new Date(String(dh));
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function diaAnteriorIso(iso) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function somarSaldoInicialPorProduto(linhas) {
  const map = new Map();
  (linhas || []).forEach((r) => {
    const k = chaveProduto(r);
    map.set(k, Number(((map.get(k) || 0) + (Number(r.QTD) || 0)).toFixed(6)));
  });
  return map;
}

/**
 * Monta estrutura dono → produto → linhas (DATA, Entrada, Saída, Saldo).
 */
function montarGruposDemonstrativo(linhasMov, saldoInicialPorChave, comSaldoInicial) {
  saldoInicialPorChave = saldoInicialPorChave || new Map();
  comSaldoInicial = comSaldoInicial === true;
  const porDono = new Map();

  const ordenadas = [...(linhasMov || [])]
    .filter((r) => !r.FG_SALDO_INICIAL)
    .sort((a, b) => new Date(a.DH_MOVIMENTO).getTime() - new Date(b.DH_MOVIMENTO).getTime());

  ordenadas.forEach((r) => {
    const kDono = r.CD_DONO != null ? String(r.CD_DONO) : '0';
    if (!porDono.has(kDono)) {
      porDono.set(kDono, {
        CD_DONO: r.CD_DONO,
        NM_DONO: r.NM_DONO,
        LABEL_DONO: labelDono(r),
        produtos: new Map(),
      });
    }
    const dono = porDono.get(kDono);
    const kProd = chaveProduto(r);
    if (!dono.produtos.has(kProd)) {
      dono.produtos.set(kProd, {
        CD_PRODUTO: r.CD_PRODUTO,
        CODIGO_PRODUTO: r.CODIGO_PRODUTO,
        NM_PRODUTO: r.NM_PRODUTO,
        LABEL_PRODUTO: labelProduto(r),
        linhas: [],
        _saldo: saldoInicialPorChave.get(kProd) || 0,
        _saldoInicialInserido: false,
      });
    }
    const prod = dono.produtos.get(kProd);
    const qtd = Number(r.QTD) || 0;
    const entrada = qtd > 0 ? Number(qtd.toFixed(6)) : 0;
    const saida = qtd < 0 ? Number(Math.abs(qtd).toFixed(6)) : 0;

    if (comSaldoInicial && !prod._saldoInicialInserido) {
      const saldoIni = Number((saldoInicialPorChave.get(kProd) || 0).toFixed(6));
      prod.linhas.push({
        DATA_LABEL: 'Saldo inicial',
        DH_MOVIMENTO: null,
        FG_SALDO_INICIAL: true,
        QTD_ENTRADA: 0,
        QTD_SAIDA: 0,
        QTD_SALDO: saldoIni,
      });
      prod._saldo = saldoIni;
      prod._saldoInicialInserido = true;
    }

    prod._saldo = Number((prod._saldo + qtd).toFixed(6));
    const dayKey = dayKeyFromDh(r.DH_MOVIMENTO);
    const ultima = prod.linhas.length ? prod.linhas[prod.linhas.length - 1] : null;
    if (ultima && !ultima.FG_SALDO_INICIAL && ultima._dayKey && dayKey && ultima._dayKey === dayKey) {
      ultima.QTD_ENTRADA = Number((ultima.QTD_ENTRADA + entrada).toFixed(6));
      ultima.QTD_SAIDA = Number((ultima.QTD_SAIDA + saida).toFixed(6));
      ultima.QTD_SALDO = prod._saldo;
      if (!ultima.DH_MOVIMENTO || new Date(r.DH_MOVIMENTO).getTime() > new Date(ultima.DH_MOVIMENTO).getTime()) {
        ultima.DH_MOVIMENTO = r.DH_MOVIMENTO;
      }
    } else {
      prod.linhas.push({
        DATA_LABEL: formatDataBr(r.DH_MOVIMENTO),
        DH_MOVIMENTO: r.DH_MOVIMENTO,
        FG_SALDO_INICIAL: false,
        _dayKey: dayKey,
        QTD_ENTRADA: entrada,
        QTD_SAIDA: saida,
        QTD_SALDO: prod._saldo,
      });
    }
  });

  // Produto só com saldo inicial (sem movimento no período) — opcional; omitir se saldo 0
  saldoInicialPorChave.forEach((saldoIni, kProd) => {
    if (!ordenadas.some((r) => chaveProduto(r) === kProd)) return;
    // já tratado acima ao processar movimentos
  });

  const grupos = Array.from(porDono.entries())
    .sort((a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0))
    .map(([, dono]) => ({
      CD_DONO: dono.CD_DONO,
      NM_DONO: dono.NM_DONO,
      LABEL_DONO: dono.LABEL_DONO,
      produtos: Array.from(dono.produtos.values())
        .sort((a, b) => String(a.LABEL_PRODUTO).localeCompare(String(b.LABEL_PRODUTO), 'pt-BR'))
        .map((p) => ({
          CD_PRODUTO: p.CD_PRODUTO,
          LABEL_PRODUTO: p.LABEL_PRODUTO,
          linhas: p.linhas.map((ln) => {
            const { _dayKey, ...rest } = ln;
            return rest;
          }),
        })),
    }));

  let totalLinhas = 0;
  grupos.forEach((g) => {
    g.produtos.forEach((p) => {
      totalLinhas += p.linhas.length;
    });
  });

  return { grupos, totalLinhas };
}

async function listarDemonstrativoMovimentacao(tenantId, filtros) {
  filtros = filtros || {};
  const dtDe = parseDataIso(filtros.dtDe);

  const { linhas: linhasBrutas, avisos: avisosMov } = await listarMovimentacaoItens(tenantId, filtros, {
    comSaldoAcumulado: false,
  });
  const linhas = filtrarLinhasPorProduto(linhasBrutas, filtros);

  let saldoInicialPorChave = new Map();
  if (dtDe) {
    const dtAteAntes = diaAnteriorIso(dtDe);
    const { linhas: linhasAntes } = await listarMovimentacaoItens(
      tenantId,
      {
        cdDono: filtros.cdDono,
        dtDe: null,
        dtAte: dtAteAntes,
        codigoProduto: filtros.codigoProduto,
        descricaoProduto: filtros.descricaoProduto,
      },
      { comSaldoAcumulado: false }
    );
    const antesFiltradas = filtrarLinhasPorProduto(linhasAntes, filtros);
    saldoInicialPorChave = somarSaldoInicialPorProduto(antesFiltradas);
  }

  const { grupos, totalLinhas } = montarGruposDemonstrativo(
    linhas,
    saldoInicialPorChave,
    !!dtDe
  );

  return {
    grupos,
    totalLinhas,
    avisos: [...AVISOS_DRE, ...(avisosMov || []).filter((a) => !AVISOS_PADRAO.includes(a))],
  };
}

function flattenGruposParaCsv(grupos) {
  const rows = [];
  (grupos || []).forEach((g) => {
    g.produtos.forEach((p) => {
      p.linhas.forEach((ln) => {
        rows.push({
          DONO: g.LABEL_DONO,
          PRODUTO: p.LABEL_PRODUTO,
          DATA: ln.DATA_LABEL,
          ENTRADA: ln.QTD_ENTRADA,
          SAIDA: ln.QTD_SAIDA,
          SALDO: ln.QTD_SALDO,
        });
      });
    });
  });
  return rows;
}

function linhasParaCsv(grupos) {
  const rows = flattenGruposParaCsv(grupos);
  const cols = ['DONO', 'PRODUTO', 'DATA', 'ENTRADA', 'SAIDA', 'SALDO'];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = rows.map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `${head}\n${body}`;
}

function contarDonosGrupos(grupos) {
  return (grupos || []).length;
}

module.exports = {
  listarDemonstrativoMovimentacao,
  linhasParaCsv,
  montarGruposDemonstrativo,
  contarDonosGrupos,
};
