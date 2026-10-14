'use strict';

const { pool } = require('../config/db');
const {
  carregarContextoCarga,
  carregarContextoOplPedidos,
  enriquecerLinhaContexto,
  agruparLinhasSintetico,
} = require('./wms-relatorio-nf-opl-contexto.service');
const {
  validarCargaProgramada,
  carregarPedidosPorDonoNfCarga,
  schemaMissing,
  isCargaBaixaEstoque,
  carregarMetaCargaProgramada,
} = require('./wms-carga-validacao.service');

const MAX_CARGAS = 120;
/** Sem nº de carga: exige período para não varrer o histórico inteiro. */
const DIAS_PERIODO_MAX = 120;

const TIPOS_SEPARACAO_SEM_NF = new Set(['SEPARADO_SEM_NF', 'NAO_FATURADO_NA_NF']);
const TIPOS_NF_SEM_SEPARACAO = new Set([
  'NAO_SEPARADO_NA_CARGA',
  'PEDIDO_NAO_ENCONTRADO',
  'FALTA_PARA_ATENDER_NF',
]);

const TIPOS_CONFERENCIA_CROSS_PEDIDO = new Set([
  'CONFERENCIA_PEDIDO_CRUZADO',
  'CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF',
  'CONF_XPED_OK',
  'CONF_XPED_QTD',
]);

const CATEGORIA_LABEL = {
  SEPARACAO_SEM_NF: 'No pedido de separação, não na NF',
  NF_SEM_SEPARACAO: 'Na NF, não no pedido de separação (ou falta separar)',
  CONFERENCIA_CROSS_PEDIDO: 'Conferência xPed NF × pedido OPL (mesmo SKU)',
  OUTROS: 'Outras divergências',
};

const TIPO_DIVERGENCIA_LABEL = {
  FALTA_PARA_ATENDER_NF: 'Falta para atender NF',
  NAO_FATURADO_NA_NF: 'Separado a mais (não faturado na NF)',
  NAO_SEPARADO_NA_CARGA: 'Não separado na carga',
  UNIDADE_DIVERGENTE: 'Unidade divergente',
  SEPARADO_SEM_NF: 'Separado sem NF',
  SEM_PEDIDO: 'Sem pedido',
  PEDIDO_NAO_ENCONTRADO: 'Pedido da NF ausente no OPL (xPed ≠ espelho)',
  CONFERENCIA_PEDIDO_CRUZADO: 'Conferência: SKU bate, pedido NF ≠ OPL',
  CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF: 'Conferência: SKU bate, pedidos e qtd diferem',
  CONF_XPED_OK: 'xPed NF ≠ pedido OPL — qtd OK',
  CONF_XPED_QTD: 'xPed NF ≠ pedido OPL — conferir qtd',
};

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

/** Match parcial de código: com/sem máscara (ex.: 6030302020 ≡ 6.03.03.020.20). */
function codigoBateFiltro(codigoLinha, codFiltroNorm) {
  if (!codFiltroNorm) return true;
  const c = normCodigo(codigoLinha);
  if (!c) return false;
  return c.includes(codFiltroNorm);
}

function categoriaRelatorio(tipo) {
  if (TIPOS_CONFERENCIA_CROSS_PEDIDO.has(tipo)) return 'CONFERENCIA_CROSS_PEDIDO';
  if (TIPOS_SEPARACAO_SEM_NF.has(tipo)) return 'SEPARACAO_SEM_NF';
  if (TIPOS_NF_SEM_SEPARACAO.has(tipo)) return 'NF_SEM_SEPARACAO';
  return 'OUTROS';
}

function labelTipo(tipo) {
  return TIPO_DIVERGENCIA_LABEL[tipo] || tipo || '—';
}

function labelCategoria(cat) {
  return CATEGORIA_LABEL[cat] || cat || '—';
}

const FILTRO_TIPO_LABEL = {
  tudo: 'Tudo (separação sem NF + NF sem separação)',
  separacao_sem_nf: 'Só pedido/separação sem NF',
  nf_sem_separacao: 'Só NF sem pedido/separação',
};

function normalizarFiltroTipoDivergencia(raw) {
  const v = String(raw || 'tudo')
    .trim()
    .toLowerCase();
  if (v === 'separacao_sem_nf' || v === 'sep_sem_nf' || v === 'pedido_sem_nf') {
    return 'separacao_sem_nf';
  }
  if (v === 'nf_sem_separacao' || v === 'nf_sem_sep' || v === 'nota_sem_pedido') {
    return 'nf_sem_separacao';
  }
  return 'tudo';
}

function labelFiltroTipoDivergencia(filtro) {
  return FILTRO_TIPO_LABEL[filtro] || FILTRO_TIPO_LABEL.tudo;
}

function passaFiltroCategoria(cat, filtroTipo) {
  if (filtroTipo === 'separacao_sem_nf') return cat === 'SEPARACAO_SEM_NF';
  if (filtroTipo === 'nf_sem_separacao') return cat === 'NF_SEM_SEPARACAO';
  if (filtroTipo === 'conferencia_cross_pedido') return cat === 'CONFERENCIA_CROSS_PEDIDO';
  return (
    cat === 'SEPARACAO_SEM_NF' ||
    cat === 'NF_SEM_SEPARACAO' ||
    cat === 'CONFERENCIA_CROSS_PEDIDO' ||
    cat === 'OUTROS'
  );
}

function resolverDonoPedido(pedidosPorDono, pedidoNorm) {
  if (!pedidoNorm) return null;
  for (const [cdDono, pedidos] of pedidosPorDono.entries()) {
    if (pedidos.has(pedidoNorm)) return cdDono;
  }
  return null;
}

function fmtCsvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtNumCsv(n) {
  if (n == null || n === '') return '0';
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(v).replace('.', ',');
}

async function listarCargasComparativo(tenantId, opts) {
  const where = [`c."TENANT_ID" = $1`];
  const params = [tenantId];

  where.push(`EXISTS (
    SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j
     WHERE j."CD_CARGA" = c."CD_CARGA"
  )`);

  if (opts.cdCarga != null && Number.isFinite(Number(opts.cdCarga))) {
    params.push(Number(opts.cdCarga));
    where.push(`c."CD_CARGA" = $${params.length}::integer`);
  }
  if (opts.dataIni) {
    params.push(opts.dataIni);
    where.push(`c."DH_CRIACAO" >= $${params.length}::date`);
  }
  if (opts.dataFim) {
    params.push(opts.dataFim);
    where.push(`c."DH_CRIACAO" < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (opts.status) {
    params.push(String(opts.status).toUpperCase());
    where.push(`COALESCE(e."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') = $${params.length}`);
  }
  if (opts.cdDono != null && Number.isFinite(Number(opts.cdDono))) {
    params.push(Number(opts.cdDono));
    where.push(`EXISTS (
      SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j
        JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
       WHERE j."CD_CARGA" = c."CD_CARGA"
         AND n."TENANT_ID" = c."TENANT_ID"
         AND n."CD_DONO" = $${params.length}::integer
    )`);
  }

  /** Pré-filtro por código: evita validar 120 cargas quando o operador busca 1 SKU. */
  const codNorm = normCodigo(opts.codigoProduto || '');
  if (codNorm) {
    params.push(codNorm);
    const pCod = `$${params.length}`;
    where.push(`(
      EXISTS (
        SELECT 1
          FROM "WMS_CARGA_PROGRAMADA_NFE" j
          JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = c."TENANT_ID"
          CROSS JOIN LATERAL jsonb_array_elements(
            CASE
              WHEN jsonb_typeof(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) = 'array'
              THEN COALESCE(n."LINHAS_JSON", '[]'::jsonb)
              ELSE '[]'::jsonb
            END
          ) ln
         WHERE j."CD_CARGA" = c."CD_CARGA"
           AND regexp_replace(
                 upper(trim(COALESCE(ln->>'cProd', ln->>'codigo', ''))),
                 '[^0-9A-Z]', '', 'g'
               ) LIKE '%' || ${pCod} || '%'
      )
      OR EXISTS (
        SELECT 1 FROM "WMS_SEPARACAO_PEDIDO_ITEM" s
         WHERE s."TENANT_ID" = c."TENANT_ID"
           AND s."CD_CARGA" = c."CD_CARGA"
           AND regexp_replace(upper(trim(COALESCE(s."COD_PRODUTO", ''))), '[^0-9A-Z]', '', 'g')
               LIKE '%' || ${pCod} || '%'
      )
    )`);
  }

  const sql = `
    SELECT c."CD_CARGA",
           c."NM_DESCRICAO",
           c."ST_CARGA",
           c."DH_CRIACAO",
           COALESCE(e."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') AS "ST_EXPEDICAO"
      FROM "WMS_CARGA_PROGRAMADA" c
      LEFT JOIN "WMS_EXPEDICAO_CARGA" e
        ON e."CD_CARGA" = c."CD_CARGA"
       AND e."TENANT_ID" = c."TENANT_ID"
     WHERE ${where.join(' AND ')}
     ORDER BY c."DH_CRIACAO" DESC, c."CD_CARGA" DESC
     LIMIT $${params.length + 1}`;

  params.push(MAX_CARGAS + 1);
  const r = await pool.query(sql, params);
  return r.rows;
}

/**
 * Garante filtros mínimos para não travar o servidor (validação ao vivo é cara).
 * @returns {{ err?: string }}
 */
function validarFiltrosComparativoNfOpl(opts) {
  const temCarga = opts.cdCarga != null && Number.isFinite(Number(opts.cdCarga));
  if (temCarga) return {};
  if (opts.cdDono == null || !Number.isFinite(Number(opts.cdDono))) {
    return {
      err: 'Selecione o dono do estoque (ou informe o nº da carga). Sem isso o relatório percorre demais cargas e trava.',
    };
  }
  if (!opts.dataIni || !opts.dataFim) {
    return {
      err: 'Informe Data início e Data fim (ou o nº da carga). A validação NF × separação é ao vivo por carga — sem período fica lento demais.',
    };
  }
  const ini = new Date(String(opts.dataIni) + 'T00:00:00');
  const fim = new Date(String(opts.dataFim) + 'T00:00:00');
  if (!Number.isFinite(ini.getTime()) || !Number.isFinite(fim.getTime())) {
    return { err: 'Datas inválidas. Use o formato AAAA-MM-DD.' };
  }
  if (fim < ini) {
    return { err: 'Data fim deve ser maior ou igual à data início.' };
  }
  const dias = Math.floor((fim - ini) / 86400000) + 1;
  if (dias > DIAS_PERIODO_MAX) {
    return {
      err: `Período máximo de ${DIAS_PERIODO_MAX} dias neste relatório (você pediu ${dias}). Reduza o intervalo ou informe o nº da carga.`,
    };
  }
  return {};
}

async function carregarNomesDono(tenantId, cdDonos) {
  const map = new Map();
  if (!cdDonos.length) return map;
  try {
    const r = await pool.query(
      `SELECT d."CD_DONO",
              COALESCE(NULLIF(TRIM(d."NOME"), ''), 'Dono #' || d."CD_DONO"::text) AS "NM_DONO"
         FROM "WMS_DONO_ESTOQUE" d
        WHERE d."TENANT_ID" = $1
          AND d."CD_DONO" = ANY($2::integer[])`,
      [tenantId, cdDonos]
    );
    for (const row of r.rows) {
      map.set(row.CD_DONO, row.NM_DONO);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Compara NF-e × separação OPL em tempo real (validarCargaProgramada, sem persistir).
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {number} [opts.cdCarga]
 * @param {string} [opts.dataIni]
 * @param {string} [opts.dataFim]
 * @param {string} [opts.status]
 * @param {number} [opts.cdDono]
 * @param {string} [opts.exibirCargas] com_divergencia | todas | sem_divergencia
 * @param {string} [opts.codigoProduto]
 * @param {string} [opts.descricaoProduto]
 * @param {string} [opts.modo] analitico | sintetico
 * @param {string} [opts.tipoDivergencia] tudo | separacao_sem_nf | nf_sem_separacao
 */
async function listarComparativoNfOpl(opts) {
  const guard = validarFiltrosComparativoNfOpl(opts);
  if (guard.err) {
    const e = new Error(guard.err);
    e.code = 'FILTRO';
    e.status = 400;
    throw e;
  }

  const tid = opts.tenantId;
  const modo = String(opts.modo || 'analitico').toLowerCase() === 'sintetico' ? 'sintetico' : 'analitico';
  const filtroTipo = normalizarFiltroTipoDivergencia(opts.tipoDivergencia);
  const exibir = String(opts.exibirCargas || 'com_divergencia').toLowerCase();
  const codFiltro = normCodigo(opts.codigoProduto || '');
  const descFiltro = String(opts.descricaoProduto || '')
    .trim()
    .toLowerCase();

  const avisos = [
    'Validação ao vivo: compara espelho OPL/separação com NF-e da carga (não usa histórico persistido).',
  ];
  if (codFiltro) {
    avisos.push(
      `Filtro de código ativo: "${String(opts.codigoProduto || '').trim()}" (compara com/sem máscara, busca parcial). Cargas sem esse item na NF/separação são ignoradas.`
    );
  }
  if (descFiltro) {
    avisos.push(`Filtro de descrição ativo: contém "${String(opts.descricaoProduto || '').trim()}".`);
  }

  let cargas = await listarCargasComparativo(tid, opts);
  if (cargas.length > MAX_CARGAS) {
    avisos.push(
      `Exibindo as ${MAX_CARGAS} cargas mais recentes do filtro. Refine período ou informe o número da carga.`
    );
    cargas = cargas.slice(0, MAX_CARGAS);
  }
  if (!cargas.length) {
    avisos.push(
      'Nenhuma carga encontrada com esses filtros' +
        (codFiltro
          ? ' (código informado não apareceu na NF/separação das cargas do período).'
          : '.')
    );
  }

  const linhas = [];
  const cargasOk = [];
  const resumo = {
    cargasAnalisadas: 0,
    cargasComDivergencia: 0,
    cargasOk: 0,
    separacaoSemNf: 0,
    nfSemSeparacao: 0,
    outros: 0,
  };

  for (const carga of cargas) {
    try {
      const meta = await carregarMetaCargaProgramada(tid, carga.CD_CARGA);
      if (isCargaBaixaEstoque(meta)) continue;

      const valid = await validarCargaProgramada(tid, carga.CD_CARGA, { persist: false });
      resumo.cargasAnalisadas += 1;

      const pedidosPorDono = await carregarPedidosPorDonoNfCarga(tid, carga.CD_CARGA);
      const donoUnico =
        pedidosPorDono.size === 1 ? [...pedidosPorDono.keys()][0] : null;

      const divergencias = (valid.divergencias || []).filter((d) => {
        const cat = categoriaRelatorio(d.tipo);
        if (cat === 'OUTROS' && d.tipo === 'SEM_NFE_CARGA') return false;
        if (codFiltro) {
          const candidatos = [d.codigo, d.codigoEstoque, d.codigoLiteral, d.codigoNf, d.codigoOpl];
          if (!candidatos.some((x) => codigoBateFiltro(x, codFiltro))) return false;
        }
        if (descFiltro) {
          const ds = String(d.descricao || '').toLowerCase();
          if (!ds.includes(descFiltro)) return false;
        }
        return true;
      });

      const linhasCarga = [];
      for (const d of divergencias) {
        const cat = categoriaRelatorio(d.tipo);
        if (!passaFiltroCategoria(cat, filtroTipo)) continue;

        const pedidoNorm = normPedido(d.pedido);
        let cdDonoRow = resolverDonoPedido(pedidosPorDono, pedidoNorm);
        if (cdDonoRow == null && donoUnico != null) cdDonoRow = donoUnico;

        if (opts.cdDono != null && Number.isFinite(Number(opts.cdDono))) {
          if (cdDonoRow != null && cdDonoRow !== Number(opts.cdDono)) continue;
        }

        if (cat === 'SEPARACAO_SEM_NF') resumo.separacaoSemNf += 1;
        else if (cat === 'NF_SEM_SEPARACAO') resumo.nfSemSeparacao += 1;
        else resumo.outros += 1;

        linhasCarga.push({
          CD_CARGA: carga.CD_CARGA,
          NM_DESCRICAO: carga.NM_DESCRICAO,
          ST_CARGA: carga.ST_CARGA,
          ST_EXPEDICAO: carga.ST_EXPEDICAO,
          DH_CRIACAO: carga.DH_CRIACAO,
          CATEGORIA: cat,
          DS_CATEGORIA: labelCategoria(cat),
          TP_DIVERGENCIA: d.tipo,
          DS_TIPO: labelTipo(d.tipo),
          DS_AVISO: d.aviso || '',
          NR_PEDIDO: d.pedido || '',
          NR_PEDIDO_OPL: d.pedidoOpl || '',
          COD_PRODUTO: d.codigo || '',
          DS_PRODUTO: d.descricao || '',
          QTD_SEPARACAO: d.qtdPedido,
          QTD_NF: d.qtdNf,
          QTD_DIF: d.qtdDif,
          UN_SEPARACAO: d.unidadePedido || '',
          UN_NF: d.unidadeNf || '',
          CD_DONO: cdDonoRow,
        });
      }

      const temDiv = linhasCarga.length > 0;
      if (temDiv) resumo.cargasComDivergencia += 1;
      else resumo.cargasOk += 1;

      if (exibir === 'com_divergencia' && !temDiv) continue;
      if (exibir === 'sem_divergencia' && temDiv) continue;

      if (linhasCarga.length) {
        const ctx = await carregarContextoCarga(tid, carga.CD_CARGA);
        const pedidosCtx = linhasCarga.map((x) => normPedido(x.NR_PEDIDO)).filter(Boolean);
        ctx.oplIndex = await carregarContextoOplPedidos(tid, pedidosCtx);
        for (let i = 0; i < linhasCarga.length; i++) {
          linhasCarga[i] = enriquecerLinhaContexto(linhasCarga[i], ctx);
        }
      }

      if (!temDiv && exibir === 'todas') {
        cargasOk.push({
          CD_CARGA: carga.CD_CARGA,
          NM_DESCRICAO: carga.NM_DESCRICAO,
          ST_EXPEDICAO: carga.ST_EXPEDICAO,
          DH_CRIACAO: carga.DH_CRIACAO,
          ITENS_NF: valid.itensNf,
          ITENS_SEPARACAO: valid.itensSeparacao,
        });
      }

      linhas.push(...linhasCarga);
    } catch (e) {
      if (!schemaMissing(e)) {
        avisos.push(`Carga #${carga.CD_CARGA}: não foi possível validar (${e.message || 'erro'}).`);
      }
    }
  }

  const cdDonos = [...new Set(linhas.map((r) => r.CD_DONO).filter((x) => x != null))];
  const nomesDono = await carregarNomesDono(tid, cdDonos);
  for (const row of linhas) {
    if (row.CD_DONO != null) {
      row.NM_DONO = nomesDono.get(row.CD_DONO) || `Dono #${row.CD_DONO}`;
    } else {
      row.NM_DONO = '—';
    }
  }

  linhas.sort((a, b) => {
    const ca = a.CATEGORIA.localeCompare(b.CATEGORIA);
    if (ca !== 0) return ca;
    const la = String(a.DS_LOCAL || '').localeCompare(String(b.DS_LOCAL || ''), 'pt');
    if (la !== 0) return la;
    return (b.CD_CARGA || 0) - (a.CD_CARGA || 0);
  });

  const linhasSintetico = agruparLinhasSintetico(linhas);

  return {
    linhas,
    linhasSintetico,
    modo,
    filtroTipo,
    cargasOk,
    avisos,
    resumo,
    geradoEm: new Date().toISOString(),
  };
}

function linhasParaCsv(linhas) {
  const header = [
    'Carga',
    'Descrição carga',
    'Status expedição',
    'Nota',
    'Local entrega',
    'Cliente entrega',
    'Pedido',
    'Categoria',
    'Tipo divergência',
    'Código produto',
    'Descrição produto',
    'Qtd separação',
    'Qtd NF',
    'Diferença',
    'Un. separação',
    'Un. NF',
    'Dono',
  ].join(';');

  const body = (linhas || [])
    .map((r) =>
      [
        r.CD_CARGA,
        r.NM_DESCRICAO,
        r.ST_EXPEDICAO,
        r.DS_NOTA,
        r.DS_LOCAL,
        r.DS_CLIENTE_ENTREGA,
        r.NR_PEDIDO,
        r.DS_CATEGORIA,
        r.DS_TIPO,
        r.COD_PRODUTO,
        r.DS_PRODUTO,
        fmtNumCsv(r.QTD_SEPARACAO),
        fmtNumCsv(r.QTD_NF),
        fmtNumCsv(r.QTD_DIF),
        r.UN_SEPARACAO,
        r.UN_NF,
        r.NM_DONO,
      ]
        .map(fmtCsvCell)
        .join(';')
    )
    .join('\n');

  return `${header}\n${body}`;
}

function linhasSinteticoParaCsv(grupos) {
  const header = [
    'Carga',
    'Descrição carga',
    'Status expedição',
    'Nota',
    'Local entrega',
    'Cliente entrega',
    'Pedido',
    'Sep. sem NF (linhas)',
    'NF sem sep. (linhas)',
    'Outros',
    'Qtd itens',
    'Itens (resumo)',
    'Dono',
  ].join(';');

  const body = (grupos || [])
    .map((g) =>
      [
        g.CD_CARGA,
        g.NM_DESCRICAO,
        g.ST_EXPEDICAO,
        g.DS_NOTA,
        g.DS_LOCAL,
        g.DS_CLIENTE_ENTREGA,
        g.NR_PEDIDO,
        g.Q_SEP_SEM_NF,
        g.Q_NF_SEM_SEP,
        g.Q_OUTROS,
        g.Q_ITENS,
        g.DS_ITENS,
        g.NM_DONO,
      ]
        .map(fmtCsvCell)
        .join(';')
    )
    .join('\n');

  return `${header}\n${body}`;
}

module.exports = {
  listarComparativoNfOpl,
  linhasParaCsv,
  linhasSinteticoParaCsv,
  labelCategoria,
  labelTipo,
  labelFiltroTipoDivergencia,
  CATEGORIA_LABEL,
};
