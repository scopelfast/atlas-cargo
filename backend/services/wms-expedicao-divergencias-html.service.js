'use strict';

/**
 * Relatório de Divergências de Expedição (HTML + CSV).
 *
 * Fontes de dados:
 *   - WMS_CARGA_PROGRAMADA / WMS_EXPEDICAO_CARGA: dados da carga e da expedição
 *   - WMS_CARGA_VALIDACAO + WMS_CARGA_VALIDACAO_ITEM: divergências detectadas
 *     entre NF-e (saída fiscal) e separação (saída física).
 *   - WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA: liberações com supervisor (auditoria).
 *
 * Objetivo: dar ao fiscal/contábil uma visão clara do que SAIU FISICAMENTE da
 * separação versus o que SAIU FISCALMENTE na NF-e, e quem autorizou eventuais
 * diferenças.
 */

const { pool } = require('../config/db');
const { applyProductMask } = require('../utils/wms-codigo-produto-mask');
const {
  enriquecerAvisosOplDivergenciasPorCargaMap,
  validarCargaProgramada,
  separarDivergenciasEConferencias,
} = require('./wms-carga-validacao.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Formata código com máscara do dono (preferência) ou padrão 0.00.00.000.XX (10 chars).
 * Evita o agrupamento 2-a-2 (60.10.14.28.20) usado por engano no front antigo.
 */
function mascaraCodigoOl(cod, maskDono) {
  const original = String(cod != null ? cod : '').trim();
  if (!original) return '';
  const mask = String(maskDono || '').trim();
  if (mask) {
    const fmt = applyProductMask(original, mask);
    if (fmt) return fmt;
  }
  const raw = original.replace(/[^0-9A-Za-z]/g, '');
  if (raw.length !== 10) return original;
  return `${raw[0]}.${raw.slice(1, 3)}.${raw.slice(3, 5)}.${raw.slice(5, 8)}.${raw.slice(8, 10)}`;
}

function maskDeDonos(donos) {
  for (const d of donos || []) {
    const mk = String(d?.MASCARA_CODIGO_PRODUTO || '').trim();
    if (mk) return mk;
  }
  return '';
}

function maskPrimeiroDonoNosDados(dados) {
  const mapa = dados?.donosPorCarga;
  if (!mapa || typeof mapa.values !== 'function') return '';
  for (const donos of mapa.values()) {
    const mk = maskDeDonos(donos);
    if (mk) return mk;
  }
  return '';
}

/** Rótulo amigável para tipo de divergência (igual ao gerado por validarCargaProgramada). */
const TIPO_DIVERGENCIA_LABEL = {
  EMBALAGEM_DIVERGENTE_NF_OPL: 'Embalagem NF × OPL divergente',
  FALTA_PARA_ATENDER_NF: 'Falta para atender NF',
  NAO_FATURADO_NA_NF: 'Não faturado na NF (sobra)',
  NAO_SEPARADO_NA_CARGA: 'Não separado na carga',
  UNIDADE_DIVERGENTE: 'Unidade divergente',
  SEPARADO_SEM_NF: 'Separado sem NF',
  SEM_PEDIDO: 'Sem pedido',
  PEDIDO_NAO_ENCONTRADO: 'Pedido da NF ausente no OPL (xPed ≠ espelho)',
  CONFERENCIA_PEDIDO_CRUZADO: 'Conferência: SKU bate, pedido NF ≠ OPL',
  CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF: 'Conferência: SKU bate, pedidos e qtd diferem',
  CONF_XPED_OK: 'xPed NF ≠ pedido OPL — qtd OK',
  CONF_XPED_QTD: 'xPed NF ≠ pedido OPL — conferir qtd',
  CONF_NET_CLIENTE_SKU: 'Soma NF = OPL por cliente+SKU (xPeds distintos)',
};

/** Rótulo curto para coluna Tipo (PDF/tabela) — texto longo vai na Obs. */
const TIPO_DIVERGENCIA_LABEL_CURTO = {
  EMBALAGEM_DIVERGENTE_NF_OPL: 'Embalagem NF×OPL',
  FALTA_PARA_ATENDER_NF: 'Falta p/ NF',
  NAO_FATURADO_NA_NF: 'Sobra (não na NF)',
  NAO_SEPARADO_NA_CARGA: 'Não separado',
  UNIDADE_DIVERGENTE: 'Unidade ≠',
  SEPARADO_SEM_NF: 'Sep. sem NF',
  SEM_PEDIDO: 'Sem pedido',
  PEDIDO_NAO_ENCONTRADO: 'xPed ≠ OPL',
  CONFERENCIA_PEDIDO_CRUZADO: 'xPed ≠ OPL',
  CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF: 'xPed ≠ OPL + qtd',
  CONF_XPED_OK: 'xPed ≠ OPL (qtd OK)',
  CONF_XPED_QTD: 'xPed ≠ OPL (qtd)',
  CONF_NET_CLIENTE_SKU: 'Net cliente+SKU',
};

function labelTipo(tipo) {
  return TIPO_DIVERGENCIA_LABEL[tipo] || tipo || '—';
}

function labelTipoCurto(tipo) {
  return TIPO_DIVERGENCIA_LABEL_CURTO[tipo] || labelTipo(tipo);
}

function fmtNumber(n, casas = 4) {
  if (n == null || n === '') return '0';
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const fixed = v.toFixed(casas);
  return fixed.replace(/\.?0+$/, '').replace('.', ',') || '0';
}

function fmtDataHora(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return String(dt);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
  } catch (_) {
    return String(dt);
  }
}

function fmtData(dt) {
  if (!dt) return '—';
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return String(dt);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch (_) {
    return String(dt);
  }
}

/** Normaliza código (igual a wms-carga-validacao.service para casar com itens persistidos). */
function normCodigo(v) {
  return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();
}

/** Normaliza pedido (igual a wms-carga-validacao.service: dígitos, padding 10). */
function normPedido(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : '';
}

function parseNum(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Carrega o conjunto de divergências para o relatório.
 * @param {Object} opts
 * @param {string} opts.tenantId
 * @param {number} [opts.cdCarga] - se informado, restringe a uma carga
 * @param {string} [opts.dataIni] - 'YYYY-MM-DD' (filtro por DH_CRIACAO da carga)
 * @param {string} [opts.dataFim] - 'YYYY-MM-DD'
 * @param {string} [opts.conferente] - filtro parcial (ILIKE) por nome do conferente
 * @param {string} [opts.status] - 'EM_EXPEDICAO' | 'EXPEDIDA' | 'PRONTA_EXPEDICAO'
 * @param {number} [opts.cdDono] - filtra apenas cargas com NF-e do dono informado
 */
async function carregarDivergencias(opts) {
  const tid = opts.tenantId;
  const where = [`c."TENANT_ID" = $1`];
  const params = [tid];

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
  if (opts.conferente) {
    params.push(`%${String(opts.conferente).trim()}%`);
    where.push(`COALESCE(e."NM_CONFERENTE", '') ILIKE $${params.length}`);
  }
  if (opts.status) {
    params.push(String(opts.status).toUpperCase());
    where.push(`COALESCE(e."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') = $${params.length}`);
  }
  /** Filtro por dono: só inclui cargas que possuam ao menos 1 NF do dono escolhido. */
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

  /** Cargas (com expedição) que entram no relatório. */
  const cargasSql = `
    SELECT c."CD_CARGA",
           c."NM_DESCRICAO",
           c."ST_CARGA",
           c."DH_CRIACAO",
           e."ST_EXPEDICAO",
           e."DH_INICIO",
           e."DH_SAIDA",
           e."NM_CONFERENTE",
           e."NM_MOTORISTA",
           e."PLACA",
           e."OBS"
      FROM "WMS_CARGA_PROGRAMADA" c
      LEFT JOIN "WMS_EXPEDICAO_CARGA" e
        ON e."CD_CARGA" = c."CD_CARGA"
       AND e."TENANT_ID" = c."TENANT_ID"
     WHERE ${where.join(' AND ')}
     ORDER BY c."DH_CRIACAO" DESC, c."CD_CARGA" DESC
     LIMIT 500`;
  const rCargas = await pool.query(cargasSql, params);
  const cargas = rCargas.rows;
  if (!cargas.length) {
    return {
      cargas: [],
      divergenciasPorCarga: new Map(),
      liberacoesPorCarga: new Map(),
      donosPorCarga: new Map(),
      precosPorCarga: new Map(),
      contextoNfPorCarga: new Map(),
    };
  }

  const cdCargas = cargas.map((c) => c.CD_CARGA);

  /** Donos por carga (uma carga pode ter NF-e de mais de um dono). */
  const donosPorCarga = new Map();
  try {
    const rD = await pool.query(
      `SELECT DISTINCT n."CD_DONO", j."CD_CARGA",
              COALESCE(NULLIF(TRIM(d."NOME"), ''), 'Dono #' || n."CD_DONO"::text) AS "NM_DONO",
              NULLIF(TRIM(d."MASCARA_CODIGO_PRODUTO"), '') AS "MASCARA_CODIGO_PRODUTO"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
    LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = n."TENANT_ID"
        WHERE j."CD_CARGA" = ANY($1::integer[])
          AND n."TENANT_ID" = $2
          AND n."CD_DONO" IS NOT NULL`,
      [cdCargas, tid]
    );
    for (const row of rD.rows) {
      const arr = donosPorCarga.get(row.CD_CARGA) || [];
      arr.push({
        CD_DONO: row.CD_DONO,
        NM_DONO: row.NM_DONO,
        MASCARA_CODIGO_PRODUTO: row.MASCARA_CODIGO_PRODUTO || null,
      });
      donosPorCarga.set(row.CD_CARGA, arr);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }

  /** Carrega LINHAS_JSON das NFs para preço unitário e contexto (nº NF / destino) por (carga, pedido, codigo). */
  const precosPorCarga = new Map();
  const contextoNfPorCarga = new Map();
  try {
    const rL = await pool.query(
      `SELECT j."CD_CARGA", n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE",
              n."XNOME_DEST", n."XNOME_ENTREGA", n."XMUN_DEST", n."UF_DEST",
              n."LINHAS_JSON", e."DS_PONTO_ENTREGA"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
         LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
           ON e."CD_ENDERECO_ENTREGA" = n."CD_ENDERECO_ENTREGA"
          AND e."TENANT_ID" = n."TENANT_ID"
        WHERE j."CD_CARGA" = ANY($1::integer[])
          AND n."TENANT_ID" = $2`,
      [cdCargas, tid]
    );
    for (const row of rL.rows) {
      const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
      let mapa = precosPorCarga.get(row.CD_CARGA);
      if (!mapa) {
        mapa = new Map();
        precosPorCarga.set(row.CD_CARGA, mapa);
      }
      let mapaCtx = contextoNfPorCarga.get(row.CD_CARGA);
      if (!mapaCtx) {
        mapaCtx = new Map();
        contextoNfPorCarga.set(row.CD_CARGA, mapaCtx);
      }
      const numeroNf = String(row.NUMERO_NF != null ? row.NUMERO_NF : '').trim();
      const serieNf = String(row.SERIE != null ? row.SERIE : '').trim();
      const nfLabel = numeroNf ? (serieNf ? `${numeroNf}/${serieNf}` : numeroNf) : '';
      const nomeDest = String(row.XNOME_ENTREGA || row.XNOME_DEST || '').trim();
      const pontoEntrega = String(row.DS_PONTO_ENTREGA || '').trim();
      const mun = String(row.XMUN_DEST || '').trim();
      const uf = String(row.UF_DEST || '').trim();
      const local = [mun, uf].filter(Boolean).join('/');
      const principalDest = pontoEntrega || nomeDest;
      const destino =
        principalDest && local ? `${principalDest} · ${local}` : principalDest || local || '';
      const ctxBase = {
        NUMERO_NF: numeroNf,
        SERIE: serieNf,
        NF_LABEL: nfLabel,
        DESTINO: destino,
        CD_NFE_SAIDA: row.CD_NFE_SAIDA != null ? Number(row.CD_NFE_SAIDA) : null,
      };
      for (const ln of linhas) {
        const codigo = normCodigo(ln.cProd || ln.codigo || '');
        const pedido = normPedido(ln.xPed || ln.xped || '');
        if (codigo) {
          const k1 = `${pedido}|${codigo}`;
          if (!mapaCtx.has(k1)) mapaCtx.set(k1, ctxBase);
          const k2 = `|${codigo}`;
          if (!mapaCtx.has(k2)) mapaCtx.set(k2, ctxBase);
        }
        const vUn = parseNum(ln.vUnCom || ln.vunCom || ln.vunCom);
        const vProd = parseNum(ln.vProd || 0);
        const qCom = parseNum(ln.qCom || ln.quantidade || 0);
        if (!codigo) continue;
        /** Preço unitário: vUnCom se disponível, senão vProd / qCom como fallback. */
        let preco = vUn;
        if (!preco && qCom > 0 && vProd > 0) preco = vProd / qCom;
        if (!preco) continue;
        /** Chaves: pedido+codigo (preciso) e só codigo (fallback quando pedido não bate). */
        const k1 = `${pedido}|${codigo}`;
        if (!mapa.has(k1)) mapa.set(k1, preco);
        const k2 = `|${codigo}`;
        if (!mapa.has(k2)) mapa.set(k2, preco);
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    /** Fallback sem endereço de entrega. */
    try {
      const rL2 = await pool.query(
        `SELECT j."CD_CARGA", n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE",
                n."XNOME_DEST", n."XNOME_ENTREGA", n."XMUN_DEST", n."UF_DEST",
                n."LINHAS_JSON"
           FROM "WMS_CARGA_PROGRAMADA_NFE" j
           JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
          WHERE j."CD_CARGA" = ANY($1::integer[])
            AND n."TENANT_ID" = $2`,
        [cdCargas, tid]
      );
      for (const row of rL2.rows) {
        const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
        let mapa = precosPorCarga.get(row.CD_CARGA);
        if (!mapa) {
          mapa = new Map();
          precosPorCarga.set(row.CD_CARGA, mapa);
        }
        let mapaCtx = contextoNfPorCarga.get(row.CD_CARGA);
        if (!mapaCtx) {
          mapaCtx = new Map();
          contextoNfPorCarga.set(row.CD_CARGA, mapaCtx);
        }
        const numeroNf = String(row.NUMERO_NF != null ? row.NUMERO_NF : '').trim();
        const serieNf = String(row.SERIE != null ? row.SERIE : '').trim();
        const nfLabel = numeroNf ? (serieNf ? `${numeroNf}/${serieNf}` : numeroNf) : '';
        const nomeDest = String(row.XNOME_ENTREGA || row.XNOME_DEST || '').trim();
        const mun = String(row.XMUN_DEST || '').trim();
        const uf = String(row.UF_DEST || '').trim();
        const local = [mun, uf].filter(Boolean).join('/');
        const destino = nomeDest && local ? `${nomeDest} · ${local}` : nomeDest || local || '';
        const ctxBase = {
          NUMERO_NF: numeroNf,
          SERIE: serieNf,
          NF_LABEL: nfLabel,
          DESTINO: destino,
          CD_NFE_SAIDA: row.CD_NFE_SAIDA != null ? Number(row.CD_NFE_SAIDA) : null,
        };
        for (const ln of linhas) {
          const codigo = normCodigo(ln.cProd || ln.codigo || '');
          const pedido = normPedido(ln.xPed || ln.xped || '');
          if (codigo) {
            const k1 = `${pedido}|${codigo}`;
            if (!mapaCtx.has(k1)) mapaCtx.set(k1, ctxBase);
            const k2 = `|${codigo}`;
            if (!mapaCtx.has(k2)) mapaCtx.set(k2, ctxBase);
          }
          const vUn = parseNum(ln.vUnCom || ln.vunCom || ln.vunCom);
          const vProd = parseNum(ln.vProd || 0);
          const qCom = parseNum(ln.qCom || ln.quantidade || 0);
          if (!codigo) continue;
          let preco = vUn;
          if (!preco && qCom > 0 && vProd > 0) preco = vProd / qCom;
          if (!preco) continue;
          const k1 = `${pedido}|${codigo}`;
          if (!mapa.has(k1)) mapa.set(k1, preco);
          const k2 = `|${codigo}`;
          if (!mapa.has(k2)) mapa.set(k2, preco);
        }
      }
    } catch (e2) {
      if (!schemaMissing(e2)) throw e2;
    }
  }

  /** Prefer snapshot SAIDA (auditoria); ignora SANACAO como “última validação”. */
  const divsSql = `
    WITH ult AS (
      SELECT DISTINCT ON ("CD_CARGA") "CD_VALIDACAO", "CD_CARGA", "ST_VALIDACAO",
             "QT_FALTAS","QT_SOBRAS","QT_INVERSOES","QT_SEM_PEDIDO","QT_SEM_NF","GERADO_EM",
             COALESCE("TP_MOMENTO", 'VALIDACAO') AS "TP_MOMENTO"
        FROM "WMS_CARGA_VALIDACAO"
       WHERE "TENANT_ID" = $1
         AND "CD_CARGA" = ANY($2::integer[])
         AND COALESCE("TP_MOMENTO", 'VALIDACAO') <> 'SANACAO'
       ORDER BY "CD_CARGA",
                CASE COALESCE("TP_MOMENTO", 'VALIDACAO')
                  WHEN 'SAIDA' THEN 0
                  WHEN 'INICIO_EXPEDICAO' THEN 1
                  ELSE 2
                END,
                "GERADO_EM" DESC, "CD_VALIDACAO" DESC
    )
    SELECT u."CD_CARGA",
           u."CD_VALIDACAO",
           u."ST_VALIDACAO",
           u."QT_FALTAS",
           u."QT_SOBRAS",
           u."QT_INVERSOES",
           u."QT_SEM_PEDIDO",
           u."QT_SEM_NF",
           u."GERADO_EM",
           u."TP_MOMENTO",
           i."NR_PEDIDO",
           i."COD_PRODUTO",
           i."DS_PRODUTO",
           i."UNIDADE_PEDIDO",
           i."UNIDADE_NF",
           i."QTD_PEDIDO",
           i."QTD_NF",
           i."QTD_DIF",
           i."TP_DIVERGENCIA",
           i."SEVERIDADE"
      FROM ult u
      LEFT JOIN "WMS_CARGA_VALIDACAO_ITEM" i ON i."CD_VALIDACAO" = u."CD_VALIDACAO"
     ORDER BY u."CD_CARGA",
              i."TP_DIVERGENCIA",
              i."NR_PEDIDO",
              i."COD_PRODUTO"`;

  const divsSqlLegacy = `
    WITH ult AS (
      SELECT DISTINCT ON ("CD_CARGA") "CD_VALIDACAO", "CD_CARGA", "ST_VALIDACAO",
             "QT_FALTAS","QT_SOBRAS","QT_INVERSOES","QT_SEM_PEDIDO","QT_SEM_NF","GERADO_EM"
        FROM "WMS_CARGA_VALIDACAO"
       WHERE "TENANT_ID" = $1
         AND "CD_CARGA" = ANY($2::integer[])
       ORDER BY "CD_CARGA", "GERADO_EM" DESC, "CD_VALIDACAO" DESC
    )
    SELECT u."CD_CARGA",
           u."CD_VALIDACAO",
           u."ST_VALIDACAO",
           u."QT_FALTAS",
           u."QT_SOBRAS",
           u."QT_INVERSOES",
           u."QT_SEM_PEDIDO",
           u."QT_SEM_NF",
           u."GERADO_EM",
           i."NR_PEDIDO",
           i."COD_PRODUTO",
           i."DS_PRODUTO",
           i."UNIDADE_PEDIDO",
           i."UNIDADE_NF",
           i."QTD_PEDIDO",
           i."QTD_NF",
           i."QTD_DIF",
           i."TP_DIVERGENCIA",
           i."SEVERIDADE"
      FROM ult u
      LEFT JOIN "WMS_CARGA_VALIDACAO_ITEM" i ON i."CD_VALIDACAO" = u."CD_VALIDACAO"
     ORDER BY u."CD_CARGA",
              i."TP_DIVERGENCIA",
              i."NR_PEDIDO",
              i."COD_PRODUTO"`;

  let divsRows = [];
  try {
    const r = await pool.query(divsSql, [tid, cdCargas]);
    divsRows = r.rows;
  } catch (e) {
    if (e && e.code === '42703') {
      try {
        const r2 = await pool.query(divsSqlLegacy, [tid, cdCargas]);
        divsRows = r2.rows;
      } catch (e2) {
        if (!schemaMissing(e2)) throw e2;
      }
    } else if (!schemaMissing(e)) {
      throw e;
    }
  }

  const divergenciasPorCarga = new Map();
  for (const r of divsRows) {
    const arr = divergenciasPorCarga.get(r.CD_CARGA) || {
      cabecalho: {
        CD_VALIDACAO: r.CD_VALIDACAO,
        ST_VALIDACAO: r.ST_VALIDACAO,
        QT_FALTAS: r.QT_FALTAS,
        QT_SOBRAS: r.QT_SOBRAS,
        QT_INVERSOES: r.QT_INVERSOES,
        QT_SEM_PEDIDO: r.QT_SEM_PEDIDO,
        QT_SEM_NF: r.QT_SEM_NF,
        GERADO_EM: r.GERADO_EM,
        TP_MOMENTO: r.TP_MOMENTO || 'VALIDACAO',
        fonteSnapshot: true,
      },
      itens: [],
    };
    if (r.TP_DIVERGENCIA) {
      /** Procura o preço unitário no mapa de preços da carga (pedido+codigo, com fallback só codigo). */
      const mapaPreco = precosPorCarga.get(r.CD_CARGA);
      const codNorm = normCodigo(r.COD_PRODUTO);
      const pedNorm = normPedido(r.NR_PEDIDO);
      let valorUnitario = 0;
      if (mapaPreco) {
        valorUnitario = mapaPreco.get(`${pedNorm}|${codNorm}`) || mapaPreco.get(`|${codNorm}`) || 0;
      }
      const qtdDif = Number(r.QTD_DIF || 0);
      /** Impacto financeiro: |qtd_dif| × valor unitário. Positivo = R$ envolvido na divergência. */
      const valorDif = valorUnitario > 0 ? Math.abs(qtdDif) * valorUnitario : 0;
      arr.itens.push({
        NR_PEDIDO: r.NR_PEDIDO,
        COD_PRODUTO: r.COD_PRODUTO,
        DS_PRODUTO: r.DS_PRODUTO,
        UNIDADE_PEDIDO: r.UNIDADE_PEDIDO,
        UNIDADE_NF: r.UNIDADE_NF,
        QTD_PEDIDO: r.QTD_PEDIDO,
        QTD_NF: r.QTD_NF,
        QTD_DIF: r.QTD_DIF,
        VALOR_UNITARIO: valorUnitario,
        VALOR_DIFERENCA: valorDif,
        TP_DIVERGENCIA: r.TP_DIVERGENCIA,
        SEVERIDADE: r.SEVERIDADE,
      });
      aplicarContextoNfItem(arr.itens[arr.itens.length - 1], contextoNfPorCarga.get(r.CD_CARGA));
    }
    divergenciasPorCarga.set(r.CD_CARGA, arr);
  }

  let liberacoesRows = [];
  try {
    const r = await pool.query(
      `SELECT "CD_CARGA","DH_LIBERACAO","SG_USER","AUTORIZADO_POR","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","DIVERGENCIAS_JSON"
         FROM "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA"
        WHERE "TENANT_ID" = $1
          AND "CD_CARGA" = ANY($2::integer[])
        ORDER BY "CD_CARGA", "DH_LIBERACAO" DESC`,
      [tid, cdCargas]
    );
    liberacoesRows = r.rows;
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  const liberacoesPorCarga = new Map();
  for (const r of liberacoesRows) {
    const arr = liberacoesPorCarga.get(r.CD_CARGA) || [];
    arr.push(r);
    liberacoesPorCarga.set(r.CD_CARGA, arr);
  }

  await preencherDivergenciasAoVivoSeAusente(
    tid,
    cargas,
    divergenciasPorCarga,
    precosPorCarga,
    contextoNfPorCarga
  );
  await enriquecerAvisosOplDivergenciasPorCargaMap(tid, divergenciasPorCarga);

  return {
    cargas,
    divergenciasPorCarga,
    liberacoesPorCarga,
    donosPorCarga,
    precosPorCarga,
    contextoNfPorCarga,
  };
}

function aplicarPrecoItemDivergencia(it, mapaPreco) {
  if (!mapaPreco) return;
  if (it.TP_DIVERGENCIA === 'EMBALAGEM_DIVERGENTE_NF_OPL' || it.SEM_IMPACTO_MONETARIO) {
    it.VALOR_UNITARIO = 0;
    it.VALOR_DIFERENCA = 0;
    return;
  }
  const codNorm = normCodigo(it.COD_PRODUTO);
  const pedNorm = normPedido(it.NR_PEDIDO);
  const valorUnitario = mapaPreco.get(`${pedNorm}|${codNorm}`) || mapaPreco.get(`|${codNorm}`) || 0;
  const qtdDif = Number(it.QTD_DIF || 0);
  it.VALOR_UNITARIO = valorUnitario;
  it.VALOR_DIFERENCA = valorUnitario > 0 ? Math.abs(qtdDif) * valorUnitario : 0;
}

function aplicarContextoNfItem(it, mapaCtx) {
  if (!it || !mapaCtx) return;
  if (it.NF_LABEL && it.DESTINO) return;
  const pedNorm = normPedido(it.NR_PEDIDO);
  const codNorm = normCodigo(it.COD_PRODUTO);
  const ctx = mapaCtx.get(`${pedNorm}|${codNorm}`) || mapaCtx.get(`|${codNorm}`);
  if (!ctx) return;
  if (!it.NF_LABEL) {
    it.NF_LABEL = ctx.NF_LABEL || '';
    it.NUMERO_NF = ctx.NUMERO_NF || '';
    it.SERIE = ctx.SERIE || '';
  }
  if (!it.DESTINO) it.DESTINO = ctx.DESTINO || '';
  if (it.CD_NFE_SAIDA == null) it.CD_NFE_SAIDA = ctx.CD_NFE_SAIDA;
}

function mapItemDivergenciaLive(d) {
  return {
    NR_PEDIDO: d.pedido ?? d.NR_PEDIDO,
    COD_PRODUTO: d.codigo ?? d.COD_PRODUTO,
    DS_PRODUTO: d.descricao ?? d.DS_PRODUTO,
    UNIDADE_PEDIDO: d.unidadePedido ?? d.UNIDADE_PEDIDO,
    UNIDADE_NF: d.unidadeNf ?? d.UNIDADE_NF,
    QTD_PEDIDO: d.qtdPedido ?? d.QTD_PEDIDO,
    QTD_NF: d.qtdNf ?? d.QTD_NF,
    QTD_DIF: d.qtdDif ?? d.QTD_DIF,
    TP_DIVERGENCIA: d.tipo ?? d.TP_DIVERGENCIA,
    SEVERIDADE: d.severidade ?? d.SEVERIDADE,
    DS_AVISO: d.aviso ?? d.DS_AVISO,
    SEM_IMPACTO_MONETARIO: d.semImpactoMonetario ?? d.SEM_IMPACTO_MONETARIO,
    QTD_DIF_ESTOQUE: d.qtdDifEstoque ?? d.QTD_DIF_ESTOQUE,
    NF_LABEL: d.nfLabel || d.NF_LABEL || '',
    NUMERO_NF: d.numeroNf || d.NUMERO_NF || '',
    SERIE: d.serieNf || d.SERIE || '',
    DESTINO: d.destino || d.DESTINO || '',
    CD_NFE_SAIDA: d.cdNfeSaida ?? d.CD_NFE_SAIDA ?? null,
    VALOR_UNITARIO: 0,
    VALOR_DIFERENCA: 0,
  };
}

function mapConferenciaCrossPedidoLive(c) {
  return {
    TP_DIVERGENCIA: c.tipo || c.TP_DIVERGENCIA,
    NR_PEDIDO: c.pedido || c.NR_PEDIDO,
    NR_PEDIDO_OPL: c.pedidoOpl || c.NR_PEDIDO_OPL,
    PEDIDOS_OPL_ALT: c.pedidosOplAlternativos || c.PEDIDOS_OPL_ALT || [],
    COD_PRODUTO: c.codigo || c.COD_PRODUTO,
    DS_PRODUTO: c.descricao || c.DS_PRODUTO,
    UNIDADE_PEDIDO: c.unidadePedido || c.UNIDADE_PEDIDO,
    UNIDADE_NF: c.unidadeNf || c.UNIDADE_NF,
    QTD_PEDIDO: c.qtdPedido ?? c.QTD_PEDIDO,
    QTD_NF: c.qtdNf ?? c.QTD_NF,
    QTD_DIF: c.qtdDif ?? c.QTD_DIF,
    DS_AVISO: c.aviso || c.DS_AVISO,
    SITUACAO: c.situacao || c.SITUACAO,
    RECONCILIADO: c.reconciliado ?? c.RECONCILIADO,
    COD_DESTINATARIO_OPL: c.codDestinatarioOpl || c.COD_DESTINATARIO_OPL,
    CD_OPL_ARQUIVO: c.cdOplArquivo ?? c.CD_OPL_ARQUIVO ?? null,
    NF_LABEL: c.nfLabel || c.NF_LABEL || '',
    DESTINO: c.destino || c.DESTINO || '',
  };
}

/**
 * Painel de expedição valida NF × OPL ao vivo. Relatório:
 * - Carga EXPEDIDA com snapshot gravado: preserva histórico (não “cura” com OPL posterior).
 * - Demais: recalcula ao vivo para alinhar com a tela.
 */
async function preencherDivergenciasAoVivoSeAusente(
  tenantId,
  cargas,
  divergenciasPorCarga,
  precosPorCarga,
  contextoNfPorCarga
) {
  for (const carga of cargas) {
    const cd = carga.CD_CARGA;
    const stExp = String(carga.ST_EXPEDICAO || '').toUpperCase();
    const existente = divergenciasPorCarga.get(cd);
    if (stExp === 'EXPEDIDA' && existente && existente.cabecalho) {
      existente.cabecalho.fonteSnapshot = true;
      existente.cabecalho.fonteAoVivo = false;
      continue;
    }
    try {
      const fresh = await validarCargaProgramada(tenantId, cd, { persist: false });
      const sep = separarDivergenciasEConferencias(fresh.divergencias || []);
      const conferencias =
        fresh.conferenciasCrossPedido && fresh.conferenciasCrossPedido.length
          ? fresh.conferenciasCrossPedido
          : sep.conferenciasCrossPedido;
      if (!sep.divergencias.length && !conferencias.length) {
        if (!(stExp === 'EXPEDIDA' && existente)) {
          divergenciasPorCarga.delete(cd);
        }
        continue;
      }

      const mapaPreco = precosPorCarga.get(cd);
      const mapaCtx = contextoNfPorCarga && contextoNfPorCarga.get(cd);
      const itens = sep.divergencias.map((d) => {
        const it = mapItemDivergenciaLive(d);
        aplicarPrecoItemDivergencia(it, mapaPreco);
        aplicarContextoNfItem(it, mapaCtx);
        return it;
      });
      const cont = fresh.contadores || {};
      divergenciasPorCarga.set(cd, {
        cabecalho: {
          CD_VALIDACAO: null,
          ST_VALIDACAO: fresh.status,
          QT_FALTAS: cont.faltas ?? 0,
          QT_SOBRAS: cont.sobras ?? 0,
          QT_INVERSOES: cont.inversoes ?? 0,
          QT_SEM_PEDIDO: cont.semPedido ?? 0,
          QT_SEM_NF: cont.semNf ?? 0,
          GERADO_EM: new Date(),
          fonteAoVivo: true,
        },
        itens,
        conferenciasCrossPedido: conferencias.map((c) => {
          const it = mapConferenciaCrossPedidoLive(c);
          aplicarContextoNfItem(it, mapaCtx);
          return it;
        }),
      });
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
}

/**
 * Agrega divergências por SKU (COD_PRODUTO) em todo o conjunto.
 * Visão contábil: OPL (de-para xPed / soma mesmo cliente) × NF por código.
 * Quando há conferência xPed para o mesmo pedido+SKU, usa as qtds da conferência
 * (não a linha "Sep=0 no xPed da NF", que é outra métrica).
 */
function agregarPorSku({ cargas, divergenciasPorCarga }) {
  const agg = new Map();

  function ensureEntry(cod, it) {
    const entry = agg.get(cod) || {
      COD_PRODUTO: cod,
      DS_PRODUTO: it?.DS_PRODUTO || it?.descricao || '',
      UNIDADE: it?.UNIDADE_PEDIDO || it?.UNIDADE_NF || it?.unidadeNf || '',
      qtdPedidoTotal: 0,
      qtdNfTotal: 0,
      qtdDifTotal: 0,
      valorDifTotal: 0,
      qtdOcorrencias: 0,
      cargasEnvolvidas: new Set(),
      tiposEnvolvidos: new Set(),
      somenteXpeds: true,
    };
    if (!entry.DS_PRODUTO && (it?.DS_PRODUTO || it?.descricao)) {
      entry.DS_PRODUTO = String(it.DS_PRODUTO || it.descricao).trim();
    }
    if (!entry.UNIDADE && (it?.UNIDADE_NF || it?.UNIDADE_PEDIDO || it?.unidadeNf)) {
      entry.UNIDADE = String(it.UNIDADE_NF || it.UNIDADE_PEDIDO || it.unidadeNf).trim();
    }
    return entry;
  }

  for (const carga of cargas) {
    const dv = divergenciasPorCarga.get(carga.CD_CARGA);
    if (!dv) continue;

    const confPorCod = new Map();
    const confKeys = new Set();
    for (const it of dv.conferenciasCrossPedido || []) {
      const cod = it.COD_PRODUTO || '—';
      const k = `${it.NR_PEDIDO || ''}|${it.COD_PRODUTO || ''}`;
      confKeys.add(k);
      const meta = confPorCod.get(cod) || {
        qtdOpl: 0,
        qtdNf: 0,
        tipos: new Set(),
        dsProduto: '',
        unidade: '',
        valorUnit: 0,
      };
      meta.qtdOpl += Number(it.QTD_PEDIDO || 0);
      meta.qtdNf += Number(it.QTD_NF || 0);
      if (it.TP_DIVERGENCIA) meta.tipos.add(it.TP_DIVERGENCIA);
      if (!meta.dsProduto && it.DS_PRODUTO) meta.dsProduto = String(it.DS_PRODUTO).trim();
      if (!meta.unidade && (it.UNIDADE_NF || it.UNIDADE_PEDIDO)) {
        meta.unidade = String(it.UNIDADE_NF || it.UNIDADE_PEDIDO).trim();
      }
      confPorCod.set(cod, meta);
    }

    /** Preço unitário vindo das linhas bloqueantes (mesmo SKU), para impacto da conferência. */
    const precoPorCod = new Map();
    for (const it of dv.itens || []) {
      const cod = it.COD_PRODUTO || '—';
      const vu = Number(it.VALOR_UNITARIO || 0);
      if (vu > 0 && !precoPorCod.has(cod)) precoPorCod.set(cod, vu);
    }

    for (const it of dv.itens || []) {
      const tipo = String(it.TP_DIVERGENCIA || '').toUpperCase();
      const k = `${it.NR_PEDIDO || ''}|${it.COD_PRODUTO || ''}`;
      /** Mesmo fato já explicado na conferência xPed — não soma Sep=0 como falta de estoque. */
      if (tipo === 'PEDIDO_NAO_ENCONTRADO' && confKeys.has(k)) continue;

      const cod = it.COD_PRODUTO || '—';
      const entry = ensureEntry(cod, it);
      entry.qtdPedidoTotal += Number(it.QTD_PEDIDO || 0);
      entry.qtdNfTotal += Number(it.QTD_NF || 0);
      entry.qtdDifTotal += Number(it.QTD_DIF || 0);
      entry.valorDifTotal += Number(it.VALOR_DIFERENCA || 0);
      entry.qtdOcorrencias += 1;
      entry.cargasEnvolvidas.add(carga.CD_CARGA);
      if (it.TP_DIVERGENCIA) entry.tiposEnvolvidos.add(it.TP_DIVERGENCIA);
      if (tipo !== 'PEDIDO_NAO_ENCONTRADO' || String(it.SEVERIDADE || '').toUpperCase() !== 'AVISO') {
        entry.somenteXpeds = false;
      }
      agg.set(cod, entry);
    }

    for (const [cod, meta] of confPorCod.entries()) {
      const entry = ensureEntry(cod, {
        COD_PRODUTO: cod,
        DS_PRODUTO: meta.dsProduto,
        UNIDADE_NF: meta.unidade,
      });
      const jaTemBloqueio = entry.qtdOcorrencias > 0 && !entry.somenteXpeds;
      const difConf = Number((meta.qtdNf - meta.qtdOpl).toFixed(4));
      const vu = precoPorCod.get(cod) || 0;
      const valorConf = vu > 0 ? Math.abs(difConf) * vu : 0;
      if (!jaTemBloqueio) {
        entry.qtdPedidoTotal = meta.qtdOpl;
        entry.qtdNfTotal = meta.qtdNf;
        entry.qtdDifTotal = difConf;
        entry.valorDifTotal = valorConf;
        entry.qtdOcorrencias = Math.max(entry.qtdOcorrencias, 1);
      } else if (!entry.qtdPedidoTotal && meta.qtdOpl > 0) {
        entry.qtdPedidoTotal += meta.qtdOpl;
      }
      entry.cargasEnvolvidas.add(carga.CD_CARGA);
      for (const t of meta.tipos) entry.tiposEnvolvidos.add(t);
      agg.set(cod, entry);
    }
  }

  return Array.from(agg.values())
    .filter((e) => e.qtdOcorrencias > 0 || e.tiposEnvolvidos.size > 0)
    .map((e) => ({
      ...e,
      cargasEnvolvidas: Array.from(e.cargasEnvolvidas).sort((a, b) => a - b),
      tiposEnvolvidos: Array.from(e.tiposEnvolvidos),
    }))
    .sort((a, b) => Math.abs(b.valorDifTotal) - Math.abs(a.valorDifTotal) || b.qtdOcorrencias - a.qtdOcorrencias);
}

/** Painel resumo: totais NF × OPL batem, só xPed divergente (ex.: uniformes Lote 05). */
function buildPainelInteligenciaXpeds(dados) {
  const skus = agregarPorSku(dados);
  const xpedsOk = skus.filter(
    (s) =>
      s.tiposEnvolvidos.some((t) => t === 'CONF_XPED_OK') &&
      Math.abs(Number(s.qtdDifTotal || 0)) < 1e-4 &&
      Number(s.qtdNfTotal || 0) > 0
  );
  if (!xpedsOk.length) return '';

  const temBloqueioNoFiltro = (dados.cargas || []).some((c) => {
    const dv = dados.divergenciasPorCarga.get(c.CD_CARGA);
    return contarItensBloqueantesDv(dv) > 0;
  });

  const linhas = xpedsOk
    .map((s) => {
      const dif = Number(s.qtdDifTotal || 0);
      const ok = Math.abs(dif) < 1e-4;
      const mask = maskPrimeiroDonoNosDados(dados);
      return `
      <tr>
        <td class="cod"><strong>${esc(mascaraCodigoOl(s.COD_PRODUTO, mask))}</strong></td>
        <td class="desc">${esc(s.DS_PRODUTO || '—')}</td>
        <td class="num">${esc(fmtNumber(s.qtdPedidoTotal))}</td>
        <td class="num">${esc(fmtNumber(s.qtdNfTotal))}</td>
        <td class="num ${ok ? 'dif-zero' : 'dif-pos'}">${ok ? '0 ✓' : `${dif > 0 ? '+' : ''}${esc(fmtNumber(dif))}`}</td>
        <td><span class="badge-tipo badge-conf_xped_ok">Totais OK — só xPed</span></td>
        <td class="cargas-list">${s.cargasEnvolvidas.map((c) => `<span class="badge-carga">#${esc(c)}</span>`).join(' ')}</td>
      </tr>`;
    })
    .join('');

  return `
  <div class="painel-inteligencia-xped" style="margin:0 0 20px;padding:14px 16px;border:1px solid #6ee7b7;border-radius:8px;background:#ecfdf5;">
    <h2 class="sec-tit" style="margin:0 0 8px;color:#065f46;font-size:12pt;">
      <i class="bx bx-check-shield"></i> Mercadoria conferida — divergência só de xPed
    </h2>
    <p class="sec-sub" style="margin:0 0 12px;color:#047857;font-size:9.5pt;">
      A soma <strong>NF-e × OPL (espelho)</strong> fecha por SKU na tabela abaixo — divergência só de <strong>xPed</strong>, não de quantidade.
      ${temBloqueioNoFiltro ? '<br><strong style="color:#b45309">Atenção:</strong> outro(s) item(ns) no filtro têm divergência bloqueante (ver consolidado vermelho e detalhamento da carga).' : 'Use a tabela azul em cada carga para o de-para pedido NF → pedido OPL.'}
    </p>
    <table class="tbl-sku tbl-xped-ok">
      <thead>
        <tr>
          <th>Código</th>
          <th>Descrição</th>
          <th class="num">Σ Qtd OPL</th>
          <th class="num">Σ Qtd NF-e</th>
          <th class="num">Diferença</th>
          <th>Situação</th>
          <th>Cargas</th>
        </tr>
      </thead>
      <tbody>${linhas}</tbody>
    </table>
  </div>`;
}

function contarItensBloqueantesDv(dv) {
  if (!dv || !Array.isArray(dv.itens)) return 0;
  return dv.itens.filter((it) => String(it.SEVERIDADE || 'BLOQUEIO').toUpperCase() !== 'AVISO').length;
}

/** Modo de listagem no detalhamento por carga (relatório consolidado). */
function parseModoExibirCargas(opts) {
  if (opts.cdCarga != null && Number.isFinite(Number(opts.cdCarga))) {
    return 'todas';
  }
  const raw = String(opts.exibirCargas || opts.modoExibir || '').trim().toLowerCase();
  if (raw === 'todas' || raw === 'all') return 'todas';
  if (raw === 'sem_divergencia' || raw === 'sem') return 'sem_divergencia';
  return 'com_divergencia';
}

function labelModoExibirCargas(modo) {
  if (modo === 'todas') return 'Todas as cargas';
  if (modo === 'sem_divergencia') return 'Só sem divergência';
  return 'Só com divergência';
}

/** Carga com itens divergentes ou liberação de supervisor. */
function cargaTemDivergenciaRelevante(cdCarga, divergenciasPorCarga, liberacoesPorCarga) {
  const dv = divergenciasPorCarga.get(cdCarga);
  const libs = liberacoesPorCarga.get(cdCarga) || [];
  const conf = (dv && dv.conferenciasCrossPedido) || [];
  return !!(dv && dv.itens.length) || conf.length > 0 || libs.length > 0;
}

function filtrarCargasParaExibicao(dados, opts) {
  const modo = parseModoExibirCargas(opts);
  const { cargas, divergenciasPorCarga, liberacoesPorCarga } = dados;
  const filtradas = cargas.filter((c) => {
    const tem = cargaTemDivergenciaRelevante(c.CD_CARGA, divergenciasPorCarga, liberacoesPorCarga);
    if (modo === 'todas') return true;
    if (modo === 'sem_divergencia') return !tem;
    return tem;
  });
  return { ...dados, cargas: filtradas, modoExibir: modo, cargasTotalPeriodo: cargas.length };
}

function tituloFiltros(opts) {
  const partes = [];
  if (opts.cdCarga != null) {
    partes.push(`Carga #${opts.cdCarga}`);
  } else {
    if (opts.dataIni && opts.dataFim) {
      partes.push(`Período ${fmtData(opts.dataIni)} a ${fmtData(opts.dataFim)}`);
    } else if (opts.dataIni) {
      partes.push(`A partir de ${fmtData(opts.dataIni)}`);
    } else if (opts.dataFim) {
      partes.push(`Até ${fmtData(opts.dataFim)}`);
    } else {
      partes.push('Todas as cargas');
    }
  }
  if (opts.conferente) partes.push(`Conferente: ${opts.conferente}`);
  if (opts.status) partes.push(`Status: ${opts.status}`);
  if (opts.cdDono != null && Number.isFinite(Number(opts.cdDono))) {
    partes.push(opts.nmDono ? `Dono: ${opts.nmDono}` : `Dono: #${opts.cdDono}`);
  }
  if (!opts.cdCarga) {
    partes.push(`Exibir: ${labelModoExibirCargas(parseModoExibirCargas(opts))}`);
  }
  return partes.join(' · ');
}

function fmtMoeda(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return 'R$ 0,00';
  return (
    'R$ ' +
    v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

/** Gera o HTML imprimível do relatório de divergências de expedição. */
async function buildDivergenciasExpedicaoHtml(opts) {
  const dadosBrutos = await carregarDivergencias(opts);
  const dadosExibir = filtrarCargasParaExibicao(dadosBrutos, opts);
  const {
    cargas: cargasDetalhe,
    divergenciasPorCarga,
    liberacoesPorCarga,
    donosPorCarga,
    modoExibir,
    cargasTotalPeriodo,
  } = dadosExibir;
  const totaisGerais = {
    cargas: cargasTotalPeriodo,
    cargasExibidas: cargasDetalhe.length,
    cargasComDivergencia: 0,
    cargasComBloqueio: 0,
    cargasLiberadas: 0,
    itensDivergentes: 0,
    faltas: 0,
    sobras: 0,
    inversoes: 0,
    semPedido: 0,
    semNf: 0,
    valorDifTotal: 0,
    itensConferenciaXpeds: 0,
  };

  for (const carga of dadosBrutos.cargas) {
    const dv = divergenciasPorCarga.get(carga.CD_CARGA);
    const libs = liberacoesPorCarga.get(carga.CD_CARGA) || [];
    const conf = (dv && dv.conferenciasCrossPedido) || [];
    if (conf.length) totaisGerais.itensConferenciaXpeds += conf.length;
    const bloq = contarItensBloqueantesDv(dv);
    const temConf = conf.length > 0;
    if (bloq > 0) {
      totaisGerais.cargasComBloqueio += 1;
      totaisGerais.cargasComDivergencia += 1;
      totaisGerais.itensDivergentes += bloq;
      totaisGerais.faltas += Number(dv.cabecalho.QT_FALTAS || 0);
      totaisGerais.sobras += Number(dv.cabecalho.QT_SOBRAS || 0);
      totaisGerais.inversoes += Number(dv.cabecalho.QT_INVERSOES || 0);
      totaisGerais.semPedido += Number(dv.cabecalho.QT_SEM_PEDIDO || 0);
      totaisGerais.semNf += Number(dv.cabecalho.QT_SEM_NF || 0);
      for (const it of dv.itens) {
        if (String(it.SEVERIDADE || 'BLOQUEIO').toUpperCase() === 'AVISO') continue;
        const tipo = String(it.TP_DIVERGENCIA || '').toUpperCase();
        const k = `${it.NR_PEDIDO || ''}|${it.COD_PRODUTO || ''}`;
        const confMatch = conf.find((c) => `${c.NR_PEDIDO || ''}|${c.COD_PRODUTO || ''}` === k);
        if (tipo === 'PEDIDO_NAO_ENCONTRADO' && confMatch) {
          /** Impacto pelo de-para (qtd OPL sugerida × NF), não pelo Sep=0 do xPed ausente. */
          const difConf = Math.abs(Number(confMatch.QTD_DIF || 0));
          const vu = Number(it.VALOR_UNITARIO || 0);
          totaisGerais.valorDifTotal += vu > 0 ? difConf * vu : 0;
        } else {
          totaisGerais.valorDifTotal += Number(it.VALOR_DIFERENCA || 0);
        }
      }
    } else if (temConf || (dv && dv.itens.length)) {
      totaisGerais.cargasComDivergencia += 1;
    }
    if (libs.length) totaisGerais.cargasLiberadas += 1;
  }

  const blocos = cargasDetalhe.map((carga) => {
    const dv = divergenciasPorCarga.get(carga.CD_CARGA);
    const libs = liberacoesPorCarga.get(carga.CD_CARGA) || [];
    const donos = donosPorCarga.get(carga.CD_CARGA) || [];
    return { carga, dv, libs, donos };
  });

  const linhasBlocos = blocos
    .map(({ carga, dv, libs, donos }) => {
      const donosTxt = donos.length
        ? donos.map((d) => `<span class="dono-chip">${esc(d.NM_DONO)}</span>`).join(' ')
        : '<span class="hint">—</span>';
      const cab = `
        <div class="bloco-carga">
          <div class="bloco-carga-head">
            <div>
              <span class="bloco-carga-num">Carga #${esc(carga.CD_CARGA)}</span>
              <span class="bloco-carga-desc">${esc(carga.NM_DESCRICAO || '—')}</span>
            </div>
            <div class="bloco-carga-status status-${esc(String(carga.ST_EXPEDICAO || 'PRONTA_EXPEDICAO').toLowerCase())}">${esc(carga.ST_EXPEDICAO || 'PRONTA_EXPEDICAO')}</div>
          </div>
          <div class="bloco-carga-info">
            <div><span class="lbl">Criada:</span> ${esc(fmtDataHora(carga.DH_CRIACAO))}</div>
            <div><span class="lbl">Início exp.:</span> ${esc(fmtDataHora(carga.DH_INICIO))}</div>
            <div><span class="lbl">Saída:</span> ${esc(fmtDataHora(carga.DH_SAIDA))}</div>
            <div><span class="lbl">Conferente:</span> ${esc(carga.NM_CONFERENTE || '—')}</div>
            <div><span class="lbl">Motorista:</span> ${esc(carga.NM_MOTORISTA || '—')}</div>
            <div><span class="lbl">Placa:</span> ${esc(carga.PLACA || '—')}</div>
          </div>
          <div class="bloco-carga-donos"><span class="lbl">Dono(s) do estoque:</span> ${donosTxt}</div>
      `;
      let tabela = '';
      const conferencias = (dv && dv.conferenciasCrossPedido) || [];
      if (dv && (dv.itens.length || conferencias.length)) {
        let valorBlocoTotal = 0;
        const maskCarga = maskDeDonos(donos);
        const ORDEM_TIPO = [
          'FALTA_PARA_ATENDER_NF',
          'NAO_SEPARADO_NA_CARGA',
          'NAO_FATURADO_NA_NF',
          'SEPARADO_SEM_NF',
          'EMBALAGEM_DIVERGENTE_NF_OPL',
          'UNIDADE_DIVERGENTE',
          'SEM_PEDIDO',
          'PEDIDO_NAO_ENCONTRADO',
          'CONF_XPED_QTD',
          'CONF_XPED_OK',
          'CONF_NET_CLIENTE_SKU',
        ];
        const itensPorTipo = new Map();
        for (const it of dv.itens) {
          const tp = String(it.TP_DIVERGENCIA || 'OUTRO').toUpperCase();
          if (!itensPorTipo.has(tp)) itensPorTipo.set(tp, []);
          itensPorTipo.get(tp).push(it);
        }
        const tiposOrdenados = [...itensPorTipo.keys()].sort((a, b) => {
          const ia = ORDEM_TIPO.indexOf(a);
          const ib = ORDEM_TIPO.indexOf(b);
          if (ia < 0 && ib < 0) return a.localeCompare(b);
          if (ia < 0) return 1;
          if (ib < 0) return -1;
          return ia - ib;
        });
        const linhasItens = tiposOrdenados
          .map((tp) => {
            const grupo = itensPorTipo.get(tp) || [];
            const tipoCls = tp.toLowerCase();
            const cabTipo = `
            <tbody class="item-pair">
            <tr class="tr-tipo-sep">
              <td colspan="8">
                <span class="lista-grp-bullet">▌</span>
                ${esc(labelTipo(tp))}
                <span class="tipo-sep-count">${grupo.length} item(ns)</span>
              </td>
            </tr>
            </tbody>`;
            const linhasGrupo = grupo
              .map((it) => {
                const dif = Number(it.QTD_DIF || 0);
                const difEstoque = Number(it.QTD_DIF_ESTOQUE);
                const difTxt =
                  it.TP_DIVERGENCIA === 'EMBALAGEM_DIVERGENTE_NF_OPL' &&
                  Number.isFinite(difEstoque) &&
                  Math.abs(difEstoque) > 1e-4
                    ? `0 (${difEstoque > 0 ? '+' : ''}${fmtNumber(difEstoque)} est.)`
                    : `${dif > 0 ? '+' : ''}${fmtNumber(dif)}`;
                const difCls = dif < 0 ? 'dif-neg' : dif > 0 ? 'dif-pos' : '';
                const vUn = Number(it.VALOR_UNITARIO || 0);
                let vDif = Number(it.VALOR_DIFERENCA || 0);
                const kIt = `${it.NR_PEDIDO || ''}|${it.COD_PRODUTO || ''}`;
                const confIt = conferencias.find(
                  (c) => `${c.NR_PEDIDO || ''}|${c.COD_PRODUTO || ''}` === kIt
                );
                if (
                  String(it.TP_DIVERGENCIA || '').toUpperCase() === 'PEDIDO_NAO_ENCONTRADO' &&
                  confIt &&
                  vUn > 0
                ) {
                  vDif = Math.abs(Number(confIt.QTD_DIF || 0)) * vUn;
                }
                valorBlocoTotal += vDif;
                const aviso = String(it.DS_AVISO || '').trim();
                const nfLab = String(it.NF_LABEL || '').trim();
                const destLab = String(it.DESTINO || '').trim();
                const ctxParts = [];
                if (nfLab) ctxParts.push(`<strong>NF</strong> ${esc(nfLab)}`);
                if (destLab) ctxParts.push(`<strong>Destino / unidade</strong> ${esc(destLab)}`);
                const ctxRow = ctxParts.length
                  ? `<tr class="tr-ctx"><td colspan="8">${ctxParts.join('<span class="ctx-sep">·</span>')}</td></tr>`
                  : '';
                const obsRow = aviso
                  ? `<tr class="tr-obs"><td colspan="8"><span class="obs-lbl">Obs.</span>${esc(aviso)}</td></tr>`
                  : '';
                return `
            <tbody class="item-pair">
            <tr class="tr-dados tipo-${esc(tipoCls)}">
              <td>${esc(it.NR_PEDIDO || '—')}</td>
              <td class="cod">${it.COD_PRODUTO ? esc(mascaraCodigoOl(it.COD_PRODUTO, maskCarga)) : '—'}</td>
              <td class="desc">${esc(it.DS_PRODUTO || '—')}</td>
              <td class="num">${esc(fmtNumber(it.QTD_PEDIDO))} ${esc(it.UNIDADE_PEDIDO || '')}</td>
              <td class="num">${esc(fmtNumber(it.QTD_NF))} ${esc(it.UNIDADE_NF || '')}</td>
              <td class="num ${esc(difCls)}">${esc(difTxt)}</td>
              <td class="num">${vUn > 0 ? esc(fmtMoeda(vUn)) : '<span class="hint">—</span>'}</td>
              <td class="num val-dif">${vDif > 0 ? esc(fmtMoeda(vDif)) : '<span class="hint">—</span>'}</td>
            </tr>
            ${ctxRow}
            ${obsRow}
            </tbody>`;
              })
              .join('');
            return cabTipo + linhasGrupo;
          })
          .join('');
        const linhasConferencias = conferencias
          .map((it) => {
            const situ = String(it.SITUACAO || it.DS_SITUACAO || '').trim();
            const sug = String(it.DS_AVISO || '').trim();
            const sitCls =
              situ.indexOf('CONFERE') >= 0 || situ.indexOf('QTD OK') >= 0
                ? 'badge-ok'
                : situ.indexOf('CLIENTE') >= 0
                  ? 'badge-warn'
                  : 'badge-warn';
            const oplTxt =
              it.NR_PEDIDO_OPL +
              (Array.isArray(it.PEDIDOS_OPL_ALT) && it.PEDIDOS_OPL_ALT.length > 1
                ? ` (+${it.PEDIDOS_OPL_ALT.length - 1})`
                : '');
            const nfLab = String(it.NF_LABEL || '').trim();
            const destLab = String(it.DESTINO || '').trim();
            const ctxParts = [];
            if (nfLab) ctxParts.push(`<strong>NF</strong> ${esc(nfLab)}`);
            if (destLab) ctxParts.push(`<strong>Destino / unidade</strong> ${esc(destLab)}`);
            const ctxRow = ctxParts.length
              ? `<tr class="tr-ctx"><td colspan="7">${ctxParts.join('<span class="ctx-sep">·</span>')}</td></tr>`
              : '';
            const obsRow = sug
              ? `<tr class="tr-obs"><td colspan="7"><span class="obs-lbl">O que fazer</span>${esc(sug)}</td></tr>`
              : '';
            return `
            <tbody class="item-pair">
            <tr class="tr-dados tipo-conferencia">
              <td>${esc(it.NR_PEDIDO || '—')}</td>
              <td>${esc(oplTxt || '—')}</td>
              <td class="cod">${it.COD_PRODUTO ? esc(mascaraCodigoOl(it.COD_PRODUTO, maskCarga)) : '—'}</td>
              <td class="desc">${esc(it.DS_PRODUTO || '—')}</td>
              <td class="num">${esc(fmtNumber(it.QTD_NF))} ${esc(it.UNIDADE_NF || '')}</td>
              <td class="num">${esc(fmtNumber(it.QTD_PEDIDO))} ${esc(it.UNIDADE_PEDIDO || '')}</td>
              <td><span class="${sitCls}">${esc(situ || '—')}</span></td>
            </tr>
            ${ctxRow}
            ${obsRow}
            </tbody>`;
          })
          .join('');
        const blocoConferencias = conferencias.length
          ? `
          <div class="bloco-conferencia-cross" style="margin-top:16px;padding:12px;border:1px solid #93c5fd;border-radius:8px;background:#eff6ff;">
            <div style="font-weight:700;color:#1e40af;margin-bottom:8px;">
              ▌ A conferir: xPed da NF ≠ pedido OPL — ${conferencias.length} item(ns) da NF
            </div>
            <p class="hint" style="margin:0 0 10px;font-size:9pt;color:#1e3a8a;">
              Uma linha por item da nota. <strong>Não é divergência bloqueante.</strong> Compare com o romaneio por NF (cliente/unidade).
            </p>
            <table class="tbl-itens tbl-conferencia">
              <thead>
                <tr>
                  <th>xPed NF</th>
                  <th>Pedido OPL sugerido</th>
                  <th>Código</th>
                  <th>Produto</th>
                  <th class="num">Qtd NF</th>
                  <th class="num">Qtd OPL</th>
                  <th>Situação</th>
                </tr>
              </thead>
              ${linhasConferencias}
            </table>
          </div>`
          : '';
        const blocoOk =
          !dv.itens.length && conferencias.length
            ? `<div class="sem-divergencia" style="background:#ecfdf5;border-color:#6ee7b7;color:#065f46;"><i class="bx bx-check-circle"></i> Sem divergência bloqueante nesta carga.</div>`
            : '';
        const blocoMisto =
          dv.itens.length && conferencias.length
            ? `<div class="hint" style="margin:0 0 12px;padding:10px 12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;color:#92400e;font-size:9pt;">
                <strong>Duas leituras do mesmo caso:</strong>
                (1) tabela vermelha = por <em>pedido da NF</em> (xPed ausente no OPL — “qtd sep.” 0 nesse número);
                (2) tabela azul = de-para com o(s) pedido(s) OPL onde o SKU está. Use a azul para conferir quantidade física; a vermelha bloqueia até corrigir xPed ou liberar.
              </div>`
            : '';
        tabela = dv.itens.length
          ? `
          <div class="totais-carga">
            <span class="tot-lbl">Total itens divergentes:</span> <strong>${dv.itens.length}</strong>
            <span class="sep">·</span>
            Faltas: <strong>${Number(dv.cabecalho.QT_FALTAS || 0)}</strong>
            <span class="sep">·</span>
            Sobras: <strong>${Number(dv.cabecalho.QT_SOBRAS || 0)}</strong>
            <span class="sep">·</span>
            Não separado: <strong>${Number(dv.cabecalho.QT_INVERSOES || 0)}</strong>
            <span class="sep">·</span>
            Sem pedido/PN: <strong>${Number(dv.cabecalho.QT_SEM_PEDIDO || 0)}</strong>
            <span class="sep">·</span>
            Separado sem NF: <strong>${Number(dv.cabecalho.QT_SEM_NF || 0)}</strong>
            <span class="sep">·</span>
            <strong class="val-dif">Impacto: ${esc(fmtMoeda(valorBlocoTotal))}</strong>
            <span class="sep">·</span>
            <span class="hint">Validado em: ${esc(fmtDataHora(dv.cabecalho.GERADO_EM))}${
              dv.cabecalho.fonteAoVivo
                ? ' · ao vivo (use Re-validar na expedição para gravar histórico)'
                : dv.cabecalho.TP_MOMENTO === 'SAIDA'
                  ? ' · snapshot na saída (auditoria)'
                  : dv.cabecalho.fonteSnapshot
                    ? ' · snapshot gravado'
                    : ''
            }</span>
          </div>
          <table class="tbl-itens">
            <thead>
              <tr>
                <th>Pedido NF</th>
                <th>Código</th>
                <th>Descrição</th>
                <th class="num">Qtd no xPed</th>
                <th class="num">Qtd NF-e</th>
                <th class="num">Diferença</th>
                <th class="num">Vl. unit. (NF)</th>
                <th class="num">Vl. diferença</th>
              </tr>
            </thead>
            ${linhasItens}
          </table>
        `
          : '';
        tabela = `${blocoOk}${blocoMisto}${tabela}${blocoConferencias}`;
      } else {
        tabela = `<div class="sem-divergencia"><i class="bx bx-check-circle"></i> Sem divergências para esta carga.</div>`;
      }

      let bloqueioLib = '';
      if (libs.length) {
        const linhasLib = libs
          .map(
            (l) => `
          <div class="lib-item">
            <div class="lib-head">
              <strong>${esc(fmtDataHora(l.DH_LIBERACAO))}</strong>
              · Autorizado por <strong>${esc(l.AUTORIZADO_NOME || l.AUTORIZADO_POR || '—')}</strong>
              (${esc(l.AUTORIZADO_LOGIN || '—')})
              · Operador: ${esc(l.SG_USER || '—')}
            </div>
            <div class="lib-just">"${esc(l.JUSTIFICATIVA || '')}"</div>
          </div>`
          )
          .join('');
        bloqueioLib = `
          <div class="bloco-liberacoes">
            <div class="lib-tit"><i class="bx bx-shield-quarter"></i> Liberações por supervisor (com divergência)</div>
            ${linhasLib}
          </div>`;
      }

      return cab + tabela + bloqueioLib + '</div>';
    })
    .join('\n');

  const fmtPct = (a, b) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : '0%');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Relatório de Divergências — Expedição</title>
  <link href="https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css" rel="stylesheet" />
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      margin: 0;
      padding: 12px 16px;
      color: #0f172a;
      font-size: 10pt;
      background: #f1f5f9;
      line-height: 1.35;
    }
    .print-tip {
      position: sticky; top: 8px; z-index: 50; max-width: 277mm; margin: 0 auto 12px;
      background: #ecfdf5; border: 1px solid #10b981; color: #064e3b;
      padding: 10px 14px; border-radius: 8px; font-size: 10pt; line-height: 1.45;
    }
    .print-tip kbd { background: #fff; border: 1px solid #10b981; border-bottom-width: 2px; border-radius: 4px; padding: 1px 6px; font-size: 9pt; }
    .print-tip-print-btn { background: #10b981; color: #fff; border: 0; border-radius: 4px; padding: 4px 12px; font-size: 9pt; cursor: pointer; margin-left: 8px; font-weight: 600; }
    .print-tip-print-btn:hover { background: #059669; }
    .print-tip-close { float: right; background: transparent; border: 0; color: #064e3b; font-size: 14pt; cursor: pointer; padding: 0 4px; }
    @media print {
      .print-tip { display: none !important; }
      body { background: #fff; padding: 0; margin: 0; font-size: 10pt; }
      .relatorio-wrap {
        max-width: none !important;
        width: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
        border-radius: 0 !important;
      }
    }

    .relatorio-wrap {
      max-width: 277mm;
      width: 100%;
      margin: 0 auto;
      background: #fff;
      padding: 14px 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      border-radius: 8px;
    }
    .rel-head { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 12px; }
    .rel-head h1 { margin: 0; font-size: 15pt; font-weight: 700; }
    .rel-head .sub { margin-top: 4px; font-size: 9.5pt; color: #475569; }
    .rel-head .filtros { margin-top: 3px; font-size: 9.5pt; color: #1e293b; }

    .resumo-geral {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; margin: 10px 0 14px;
    }
    .resumo-card {
      background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px 10px;
    }
    .resumo-card .num { font-size: 14pt; font-weight: 700; color: #0f172a; }
    .resumo-card .lbl { font-size: 8pt; color: #64748b; text-transform: uppercase; letter-spacing: .02em; line-height: 1.25; }
    .resumo-card.alert { background: #fef3c7; border-color: #f59e0b; }
    .resumo-card.alert .num { color: #b45309; }
    .resumo-card.danger { background: #fee2e2; border-color: #ef4444; }
    .resumo-card.danger .num { color: #991b1b; }

    .bloco-carga {
      border: 1px solid #cbd5e1; border-radius: 8px; padding: 12px;
      margin-bottom: 14px; background: #fff;
      break-inside: auto; page-break-inside: auto;
    }
    .bloco-carga-head {
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 8px;
      break-after: avoid; page-break-after: avoid;
    }
    .bloco-carga-num { font-weight: 700; font-size: 12pt; color: #1e3a8a; }
    .bloco-carga-desc { margin-left: 8px; color: #475569; font-size: 10pt; }
    .bloco-carga-status {
      font-size: 9pt; font-weight: 700; padding: 3px 10px; border-radius: 12px;
      background: #e2e8f0; color: #0f172a;
    }
    .bloco-carga-status.status-em_expedicao { background: #fef3c7; color: #92400e; }
    .bloco-carga-status.status-expedida { background: #d1fae5; color: #065f46; }
    .bloco-carga-status.status-pronta_expedicao { background: #dbeafe; color: #1e40af; }
    .bloco-carga-info {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; font-size: 9.5pt;
      margin-bottom: 8px;
    }
    .bloco-carga-info .lbl { color: #64748b; }
    .totais-carga { background: #f1f5f9; padding: 6px 10px; border-radius: 4px; font-size: 9.5pt; margin: 6px 0; }
    .totais-carga .tot-lbl { color: #64748b; }
    .totais-carga .sep { color: #cbd5e1; margin: 0 4px; }
    .totais-carga .hint { color: #64748b; font-style: italic; }

    .tbl-itens { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 4px; font-size: 9.5pt; }
    .tbl-itens th, .tbl-itens td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; word-wrap: break-word; }
    .tbl-itens th { background: #e2e8f0; text-align: left; font-weight: 700; font-size: 9pt; }
    .tbl-itens .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tbl-itens .cod { font-family: 'Consolas', 'Courier New', monospace; white-space: nowrap; }
    .tbl-itens .desc { overflow-wrap: anywhere; }
    .tbl-itens .dif-neg { color: #b91c1c; font-weight: 700; }
    .tbl-itens .dif-pos { color: #b45309; font-weight: 700; }
    .tbl-itens tbody.item-pair { page-break-inside: avoid; break-inside: avoid; }
    .lista-grp-bullet { color: #1d4ed8; margin-right: 4px; font-weight: 700; }
    .tbl-itens tr.tr-tipo-sep td {
      background: #eff6ff !important;
      border-top: 2px solid #93c5fd;
      padding: 7px 10px;
      font-weight: 700;
      font-size: 10pt;
      color: #1e3a8a;
      vertical-align: middle;
    }
    .tbl-itens tr.tr-tipo-sep .tipo-sep-count {
      margin-left: 10px;
      font-weight: 600;
      font-size: 9pt;
      color: #475569;
    }
    .tbl-itens tr.tr-ctx td {
      background: #f8fafc;
      color: #334155;
      font-size: 9pt;
      line-height: 1.4;
      border-top: 0;
      padding: 4px 10px 6px;
    }
    .tbl-itens tr.tr-ctx .ctx-sep {
      display: inline-block;
      margin: 0 8px;
      color: #94a3b8;
      font-weight: 700;
    }
    .tbl-itens tr.tr-ctx strong {
      color: #1e40af;
      font-weight: 700;
      margin-right: 4px;
      text-transform: uppercase;
      font-size: 8pt;
      letter-spacing: .02em;
    }
    .tbl-itens.tbl-conferencia tr.tr-ctx td { background: #f0f7ff; }
    .tbl-itens tr.tr-obs td {
      background: #f1f5f9;
      color: #334155;
      font-size: 9.5pt;
      line-height: 1.45;
      border-top: 0;
      padding: 7px 10px 8px;
    }
    .tbl-itens tr.tr-obs .obs-lbl {
      display: inline-block;
      font-weight: 700;
      color: #1e40af;
      margin-right: 6px;
      text-transform: uppercase;
      font-size: 8.5pt;
      letter-spacing: .03em;
    }
    .tbl-itens.tbl-conferencia tr.tr-obs td { background: #eff6ff; border-color: #bfdbfe; }
    .tbl-itens.tbl-conferencia tr.tr-obs .obs-lbl { color: #1d4ed8; }

    .badge-tipo {
      display: inline-block;
      font-size: 8.5pt; padding: 2px 7px; border-radius: 10px; font-weight: 600;
      background: #e2e8f0; color: #0f172a; line-height: 1.25; white-space: normal;
    }
    .badge-falta_para_atender_nf { background: #fee2e2; color: #991b1b; }
    .badge-nao_faturado_na_nf { background: #fed7aa; color: #9a3412; }
    .badge-embalagem_divergente_nf_opl { background: #e0e7ff; color: #3730a3; }
    .badge-nao_separado_na_carga { background: #fecaca; color: #7f1d1d; }
    .badge-unidade_divergente { background: #fef9c3; color: #854d0e; }
    .badge-separado_sem_nf { background: #ddd6fe; color: #5b21b6; }
    .badge-sem_pedido, .badge-pedido_nao_encontrado { background: #cffafe; color: #155e75; }

    .sem-divergencia {
      background: #d1fae5; color: #065f46; padding: 8px 12px; border-radius: 6px;
      font-size: 11pt; display: flex; align-items: center; gap: 6px;
    }
    .sem-divergencia i { font-size: 16pt; }

    .bloco-liberacoes {
      margin-top: 10px; padding: 8px 10px; background: #fffbeb; border: 1px solid #f59e0b; border-radius: 6px;
    }
    .lib-tit { font-weight: 700; font-size: 11pt; color: #92400e; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
    .lib-item { font-size: 10.5pt; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px dashed #fde68a; }
    .lib-item:last-child { border-bottom: 0; margin-bottom: 0; padding-bottom: 0; }
    .lib-head { color: #1e293b; }
    .lib-just { color: #475569; margin-left: 12px; margin-top: 2px; font-style: italic; }

    .footer-rel {
      margin-top: 18px; border-top: 1px solid #cbd5e1; padding-top: 8px; font-size: 9.5pt; color: #64748b;
      display: flex; justify-content: space-between;
    }

    /* Donos por carga */
    .bloco-carga-donos {
      margin-top: 6px; font-size: 10.5pt; padding-top: 6px; border-top: 1px dashed #e2e8f0;
    }
    .bloco-carga-donos .lbl { color: #64748b; }
    .dono-chip {
      display: inline-block; background: #dbeafe; color: #1e3a8a;
      padding: 2px 8px; border-radius: 10px; font-weight: 600; font-size: 10pt; margin-left: 4px;
    }

    /* Coluna de impacto monetário */
    .val-dif { color: #b91c1c; font-weight: 700; }
    .resumo-card-valor {
      background: #fef3c7; border-color: #f59e0b;
    }
    .resumo-card-valor .num { color: #b45309; font-size: 15pt; }
    .resumo-card-valor.danger { background: #fee2e2; border-color: #ef4444; }
    .resumo-card-valor.danger .num { color: #991b1b; }

    /* Título de seção (SKU, detalhamento) */
    h2.sec-tit {
      font-size: 12pt; margin: 18px 0 6px; padding-bottom: 4px; color: #0f172a;
      border-bottom: 2px solid #cbd5e1; display: flex; align-items: center; gap: 6px;
      break-after: avoid; page-break-after: avoid;
    }
    .sec-sub { font-size: 9.5pt; color: #475569; margin: 0 0 10px; line-height: 1.45; }
    /* Título + 1º bloco da carga não se separam entre páginas */
    .sec-detalhamento {
      break-before: page; page-break-before: always;
    }
    .sec-detalhamento > .sec-tit {
      margin-top: 0;
      break-after: avoid; page-break-after: avoid;
    }
    .sec-detalhamento > .bloco-carga:first-of-type,
    .sec-detalhamento > .sem-divergencia {
      break-before: avoid; page-break-before: avoid;
    }

    /* Tabela consolidada por SKU */
    .tbl-sku { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin-bottom: 14px; }
    .tbl-sku th, .tbl-sku td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; }
    .tbl-sku th {
      background: #0f172a; color: #f1f5f9; text-align: left; font-weight: 700; font-size: 8.5pt;
      letter-spacing: 0.02em; text-transform: uppercase;
    }
    .tbl-sku tbody tr:nth-child(even) td { background: #f8fafc; }
    .tbl-sku .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tbl-sku .cod { font-family: 'Consolas', 'Courier New', monospace; white-space: nowrap; }
    .tbl-sku .dif-neg { color: #b91c1c; font-weight: 700; }
    .tbl-sku .dif-pos { color: #b45309; font-weight: 700; }
    .tbl-sku .cargas-list { line-height: 1.7; }
    .tbl-sku tr.sku-tipo-sep td {
      background: #eff6ff !important;
      font-weight: 700;
      font-size: 9.5pt;
      color: #1e3a8a;
      border-top: 2px solid #93c5fd;
      padding: 7px 10px;
    }
    .tbl-sku tr.sku-tipo-sep .tipo-sep-count {
      margin-left: 10px;
      font-weight: 600;
      font-size: 9pt;
      color: #475569;
      text-transform: none;
      letter-spacing: 0;
    }
    .badge-carga {
      display: inline-block; background: #1e40af; color: #fff;
      padding: 1px 7px; border-radius: 8px; font-size: 8pt; font-weight: 700; margin-right: 2px;
    }

    @media print {
      .bloco-carga { box-shadow: none; }
      .resumo-card { border: 1px solid #94a3b8; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .badge-tipo, .bloco-carga-status, .sem-divergencia, .bloco-liberacoes, .totais-carga,
      .dono-chip, .resumo-card-valor, .tbl-sku th, .badge-carga, .tbl-itens tr.tr-obs td,
      .tbl-itens tr.tr-ctx td, .tbl-itens tr.tr-tipo-sep td, .tbl-sku tr.sku-tipo-sep td {
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
      .tbl-sku { page-break-inside: avoid; break-inside: avoid; }
      .tbl-itens tbody.item-pair { page-break-inside: avoid; break-inside: avoid; }
      .sec-detalhamento {
        break-before: page; page-break-before: always;
      }
      h2.sec-tit, .sec-detalhamento > .sec-tit {
        break-after: avoid; page-break-after: avoid;
      }
      .sec-detalhamento > .bloco-carga:first-of-type,
      .sec-detalhamento > .sem-divergencia {
        break-before: avoid; page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
<div class="print-tip" id="relPrintTip">
  <button type="button" class="print-tip-close" aria-label="Fechar" onclick="document.getElementById('relPrintTip').style.display='none'">×</button>
  <strong>Impressão:</strong> o relatório sai em <strong>A4 paisagem</strong>. Em <kbd>Ctrl</kbd>+<kbd>P</kbd> confirme orientação Paisagem e margens <strong>Padrão</strong> ou Mínimas.
  <button type="button" class="print-tip-print-btn" onclick="window.print()">Imprimir agora</button>
</div>

<div class="relatorio-wrap">
  <div class="rel-head">
    <h1><i class="bx bx-error-circle" style="color:#ef4444"></i> Relatório de Divergências — Expedição</h1>
    <div class="sub">Comparativo <strong>NF-e × separação OPL</strong>. <strong>Vermelho</strong> = bloqueia. <strong>Azul</strong> = só conferir se o xPed da NF está no pedido certo do espelho.</div>
    <div class="filtros"><strong>Filtros:</strong> ${esc(tituloFiltros(opts))} · Gerado em ${esc(fmtDataHora(new Date()))}</div>
  </div>

  <div class="resumo-geral">
    <div class="resumo-card">
      <div class="num">${totaisGerais.cargas}</div>
      <div class="lbl">Cargas no período</div>
    </div>
    <div class="resumo-card" style="${totaisGerais.itensConferenciaXpeds > 0 ? 'background:#eff6ff;border-color:#93c5fd' : ''}">
      <div class="num" style="${totaisGerais.itensConferenciaXpeds > 0 ? 'color:#1d4ed8' : ''}">${totaisGerais.itensConferenciaXpeds}</div>
      <div class="lbl">Itens p/ conferir xPed <small class="hint">(não bloqueia)</small></div>
    </div>
    <div class="resumo-card ${totaisGerais.cargasComBloqueio > 0 ? 'alert' : totaisGerais.itensConferenciaXpeds > 0 ? '' : ''}" style="${totaisGerais.cargasComBloqueio > 0 ? '' : totaisGerais.cargasComBloqueio === 0 && totaisGerais.itensConferenciaXpeds > 0 ? 'background:#ecfdf5;border-color:#6ee7b7' : ''}">
      <div class="num" style="${totaisGerais.cargasComBloqueio > 0 ? 'color:#b91c1c' : totaisGerais.cargasComBloqueio === 0 && totaisGerais.itensConferenciaXpeds > 0 ? 'color:#047857' : ''}">${totaisGerais.cargasComBloqueio} <small style="font-size:9pt;color:#64748b">(${fmtPct(totaisGerais.cargasComBloqueio, totaisGerais.cargas)})</small></div>
      <div class="lbl">Com divergência bloqueante</div>
    </div>
    <div class="resumo-card ${totaisGerais.cargasLiberadas > 0 ? 'danger' : ''}">
      <div class="num">${totaisGerais.cargasLiberadas}</div>
      <div class="lbl">Liberadas pelo supervisor</div>
    </div>
    <div class="resumo-card ${totaisGerais.itensDivergentes > 0 ? 'alert' : ''}">
      <div class="num">${totaisGerais.itensDivergentes}</div>
      <div class="lbl">Itens divergentes (bloqueio)</div>
    </div>
    <div class="resumo-card ${totaisGerais.faltas > 0 ? 'danger' : ''}">
      <div class="num">${totaisGerais.faltas}</div>
      <div class="lbl">Faltas (NF &gt; sep.)</div>
    </div>
    <div class="resumo-card ${totaisGerais.sobras > 0 ? 'alert' : ''}">
      <div class="num">${totaisGerais.sobras}</div>
      <div class="lbl">Sobras (sep. &gt; NF)</div>
    </div>
    <div class="resumo-card resumo-card-valor ${totaisGerais.valorDifTotal > 0 ? 'danger' : ''}" style="grid-column: span 7;">
      <div class="num">${esc(fmtMoeda(totaisGerais.valorDifTotal))}</div>
      <div class="lbl">Impacto monetário total (qtd × Vl.unit NF) <small class="hint">— estimativa quando há valor unitário na NF-e</small></div>
    </div>
  </div>
  ${
    totaisGerais.cargasComBloqueio === 0 && totaisGerais.itensConferenciaXpeds > 0
      ? `<p class="sec-sub" style="margin:-8px 0 16px;padding:10px 14px;background:#ecfdf5;border:1px solid #6ee7b7;border-radius:8px;color:#065f46;font-size:9.5pt;">
          <strong>Sem bloqueio neste filtro.</strong>
          ${totaisGerais.itensConferenciaXpeds} linha(s) da NF com xPed diferente do pedido no espelho OPL — mercadoria e quantidades conferem; use o de-para abaixo.
        </p>`
      : ''
  }

  ${buildPainelInteligenciaXpeds(dadosBrutos)}

  ${buildSecaoSku(dadosBrutos)}

  <section class="sec-detalhamento">
  <h2 class="sec-tit"><i class="bx bx-detail"></i> Detalhamento por carga${modoExibir !== 'todas' ? ` <small style="font-weight:400;color:#64748b">(${esc(labelModoExibirCargas(modoExibir))})</small>` : ''}</h2>
  ${
    linhasBlocos ||
    (modoExibir === 'com_divergencia' && totaisGerais.cargas > 0
      ? `<div class="sem-divergencia"><i class='bx bx-check-circle'></i> Nenhuma carga com divergência entre as ${totaisGerais.cargas} analisadas no período.</div>`
      : modoExibir === 'sem_divergencia' && totaisGerais.cargas > 0
        ? `<div class="sem-divergencia"><i class='bx bx-info-circle'></i> Todas as ${totaisGerais.cargas} cargas do período possuem divergência ou liberação registrada.</div>`
        : '<div class="sem-divergencia"><i class=\'bx bx-check-circle\'></i> Nenhuma carga encontrada com os filtros informados.</div>')
  }
  </section>

  <div class="footer-rel">
    <span>SysScopel · WMS · Divergências de Expedição</span>
    <span>${esc(fmtDataHora(new Date()))}</span>
  </div>
</div>
</body>
</html>`;
}

/** Bloco HTML do consolidado por SKU (cruza com saldo contábil). */
function buildSecaoSku(dados) {
  const skus = agregarPorSku(dados);
  const mask = maskPrimeiroDonoNosDados(dados);
  const skusImpacto = skus.filter(
    (s) => Math.abs(Number(s.qtdDifTotal || 0)) > 1e-4 || Number(s.valorDifTotal || 0) > 0
  );
  if (!skusImpacto.length) return '';
  const totalImpacto = skusImpacto.reduce((acc, s) => acc + Math.abs(s.valorDifTotal), 0);
  const top = skusImpacto.slice(0, 80);
  const ORDEM_TIPO_SKU = [
    'FALTA_PARA_ATENDER_NF',
    'NAO_SEPARADO_NA_CARGA',
    'NAO_FATURADO_NA_NF',
    'SEPARADO_SEM_NF',
    'EMBALAGEM_DIVERGENTE_NF_OPL',
    'UNIDADE_DIVERGENTE',
    'SEM_PEDIDO',
    'PEDIDO_NAO_ENCONTRADO',
    'CONF_XPED_QTD',
    'CONF_XPED_OK',
    'CONF_NET_CLIENTE_SKU',
  ];
  function tipoPrincipalSku(s) {
    const tipos = (s.tiposEnvolvidos || []).map((t) => String(t || '').toUpperCase());
    if (!tipos.length) return 'OUTRO';
    let best = tipos[0];
    let bestIdx = 999;
    for (const t of tipos) {
      const i = ORDEM_TIPO_SKU.indexOf(t);
      if (i >= 0 && i < bestIdx) {
        bestIdx = i;
        best = t;
      }
    }
    return best;
  }
  const porTipo = new Map();
  for (const s of top) {
    const tp = tipoPrincipalSku(s);
    if (!porTipo.has(tp)) porTipo.set(tp, []);
    porTipo.get(tp).push(s);
  }
  const tiposOrdenados = [...porTipo.keys()].sort((a, b) => {
    const ia = ORDEM_TIPO_SKU.indexOf(a);
    const ib = ORDEM_TIPO_SKU.indexOf(b);
    if (ia < 0 && ib < 0) return a.localeCompare(b);
    if (ia < 0) return 1;
    if (ib < 0) return -1;
    return ia - ib;
  });
  let idxGlobal = 0;
  const linhasSku = tiposOrdenados
    .map((tp) => {
      const grupo = porTipo.get(tp) || [];
      const cab = `
      <tr class="sku-tipo-sep">
        <td colspan="9">
          <span class="lista-grp-bullet">▌</span>
          ${esc(labelTipo(tp))}
          <span class="tipo-sep-count">${grupo.length} SKU(s)</span>
        </td>
      </tr>`;
      const rows = grupo
        .map((s) => {
          idxGlobal += 1;
          const dif = Number(s.qtdDifTotal || 0);
          const difCls = dif < 0 ? 'dif-neg' : dif > 0 ? 'dif-pos' : '';
          return `
      <tr>
        <td class="num">${idxGlobal}</td>
        <td class="cod"><strong>${esc(mascaraCodigoOl(s.COD_PRODUTO, mask))}</strong></td>
        <td class="desc">${esc(s.DS_PRODUTO || '—')}</td>
        <td class="num">${esc(fmtNumber(s.qtdPedidoTotal))} ${esc(s.UNIDADE || '')}</td>
        <td class="num">${esc(fmtNumber(s.qtdNfTotal))} ${esc(s.UNIDADE || '')}</td>
        <td class="num ${esc(difCls)}">${dif > 0 ? '+' : ''}${esc(fmtNumber(dif))}</td>
        <td class="num val-dif">${s.valorDifTotal > 0 ? esc(fmtMoeda(s.valorDifTotal)) : '<span class="hint">—</span>'}</td>
        <td class="num">${s.qtdOcorrencias}</td>
        <td class="cargas-list">${s.cargasEnvolvidas.map((c) => `<span class="badge-carga">#${esc(c)}</span>`).join(' ')}</td>
      </tr>`;
        })
        .join('');
      return cab + rows;
    })
    .join('');
  const aviso = skusImpacto.length > top.length
    ? `<p class="hint" style="margin:6px 0 0;font-size:9pt">Exibindo top ${top.length} de ${skusImpacto.length} SKUs com diferença real (ordenados por maior impacto). SKUs só com xPed divergente aparecem no painel verde acima.</p>`
    : '';
  return `
  <h2 class="sec-tit"><i class="bx bx-cube"></i> Consolidado por SKU — cruzamento com saldo contábil</h2>
  <p class="sec-sub">
    Visão por <strong>código de produto</strong> (de-para xPed / soma OPL no mesmo cliente) — não confundir com a linha
    “qtd no xPed = 0” do detalhe. Use <strong>Diferença total</strong> para ajuste de saldo e <strong>Impacto (R$)</strong> para priorizar.
    <strong>Total impacto:</strong> ${esc(fmtMoeda(totalImpacto))}.
  </p>
  <table class="tbl-sku">
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Código</th>
        <th>Descrição</th>
        <th class="num">Σ Qtd Separada</th>
        <th class="num">Σ Qtd NF-e</th>
        <th class="num">Diferença total</th>
        <th class="num">Impacto (R$)</th>
        <th class="num">Ocorr.</th>
        <th>Cargas envolvidas</th>
      </tr>
    </thead>
    <tbody>${linhasSku}</tbody>
  </table>
  ${aviso}`;
}

/** Gera CSV (compatível Excel BR) com todas as divergências. */
async function buildDivergenciasExpedicaoCsv(opts) {
  const dadosBrutos = await carregarDivergencias(opts);
  const { cargas, divergenciasPorCarga, liberacoesPorCarga, donosPorCarga, modoExibir } =
    filtrarCargasParaExibicao(dadosBrutos, opts);
  const cabecalho = [
    'CD_CARGA',
    'DESCRICAO_CARGA',
    'STATUS_EXPEDICAO',
    'DH_CRIACAO',
    'DH_INICIO',
    'DH_SAIDA',
    'CONFERENTE',
    'MOTORISTA',
    'PLACA',
    'DONOS_ESTOQUE',
    'TIPO_DIVERGENCIA',
    'PEDIDO',
    'NF',
    'DESTINO',
    'COD_PRODUTO',
    'DESCRICAO_PRODUTO',
    'OBSERVACAO_OPL',
    'QTD_SEPARADA',
    'UNID_SEPARADA',
    'QTD_NFE',
    'UNID_NFE',
    'DIFERENCA',
    'VALOR_UNIT_NFE',
    'VALOR_DIFERENCA',
    'SEVERIDADE',
    'LIBERADO_POR',
    'JUSTIFICATIVA',
  ];

  /** Escape de CSV para Excel BR (separador ; / aspas). */
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  const linhas = [cabecalho.map(csvCell).join(';')];

  for (const carga of cargas) {
    const dv = divergenciasPorCarga.get(carga.CD_CARGA);
    const libs = liberacoesPorCarga.get(carga.CD_CARGA) || [];
    const donos = (donosPorCarga.get(carga.CD_CARGA) || [])
      .map((d) => d.NM_DONO)
      .filter(Boolean)
      .join(' | ');
    const libTxt = libs
      .map((l) => `${l.AUTORIZADO_NOME || l.AUTORIZADO_POR || ''} (${l.AUTORIZADO_LOGIN || ''})`)
      .filter(Boolean)
      .join(' | ');
    const justTxt = libs.map((l) => l.JUSTIFICATIVA || '').filter(Boolean).join(' | ');

    if (!dv || !dv.itens.length) {
      if (modoExibir === 'com_divergencia') continue;
      linhas.push(
        [
          carga.CD_CARGA,
          carga.NM_DESCRICAO || '',
          carga.ST_EXPEDICAO || carga.ST_CARGA || '',
          fmtDataHora(carga.DH_CRIACAO),
          fmtDataHora(carga.DH_INICIO),
          fmtDataHora(carga.DH_SAIDA),
          carga.NM_CONFERENTE || '',
          carga.NM_MOTORISTA || '',
          carga.PLACA || '',
          donos,
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          libTxt,
          justTxt,
        ]
          .map(csvCell)
          .join(';')
      );
      continue;
    }

    for (const it of dv.itens) {
      linhas.push(
        [
          carga.CD_CARGA,
          carga.NM_DESCRICAO || '',
          carga.ST_EXPEDICAO || carga.ST_CARGA || '',
          fmtDataHora(carga.DH_CRIACAO),
          fmtDataHora(carga.DH_INICIO),
          fmtDataHora(carga.DH_SAIDA),
          carga.NM_CONFERENTE || '',
          carga.NM_MOTORISTA || '',
          carga.PLACA || '',
          donos,
          labelTipo(it.TP_DIVERGENCIA),
          it.NR_PEDIDO || '',
          it.NF_LABEL || '',
          it.DESTINO || '',
          it.COD_PRODUTO || '',
          it.DS_PRODUTO || '',
          it.DS_AVISO || '',
          fmtNumber(it.QTD_PEDIDO),
          it.UNIDADE_PEDIDO || '',
          fmtNumber(it.QTD_NF),
          it.UNIDADE_NF || '',
          fmtNumber(it.QTD_DIF),
          fmtNumber(it.VALOR_UNITARIO, 4),
          fmtNumber(it.VALOR_DIFERENCA, 2),
          it.SEVERIDADE || '',
          libTxt,
          justTxt,
        ]
          .map(csvCell)
          .join(';')
      );
    }
    for (const it of dv.conferenciasCrossPedido || []) {
      linhas.push(
        [
          carga.CD_CARGA,
          carga.NM_DESCRICAO || '',
          carga.ST_EXPEDICAO || carga.ST_CARGA || '',
          fmtDataHora(carga.DH_CRIACAO),
          fmtDataHora(carga.DH_INICIO),
          fmtDataHora(carga.DH_SAIDA),
          carga.NM_CONFERENTE || '',
          carga.NM_MOTORISTA || '',
          carga.PLACA || '',
          donos,
          labelTipo(it.TP_DIVERGENCIA),
          it.NR_PEDIDO || '',
          it.NF_LABEL || '',
          it.DESTINO || '',
          it.COD_PRODUTO || '',
          it.DS_PRODUTO || '',
          it.DS_AVISO || '',
          fmtNumber(it.QTD_PEDIDO),
          it.UNIDADE_PEDIDO || '',
          fmtNumber(it.QTD_NF),
          it.UNIDADE_NF || '',
          fmtNumber(it.QTD_DIF),
          '',
          '',
          'AVISO',
          libTxt,
          [it.NR_PEDIDO_OPL ? `OPL:${it.NR_PEDIDO_OPL}` : '', justTxt].filter(Boolean).join(' | '),
        ]
          .map(csvCell)
          .join(';')
      );
    }
  }

  /** BOM UTF-8 para Excel-BR reconhecer o encoding. */
  return '\uFEFF' + linhas.join('\r\n');
}

/** Gera CSV agregando por SKU (cruza com saldo contábil). */
async function buildDivergenciasExpedicaoSkuCsv(opts) {
  const dados = await carregarDivergencias(opts);
  const skus = agregarPorSku(dados);
  const cabecalho = [
    'COD_PRODUTO',
    'DESCRICAO_PRODUTO',
    'UNIDADE',
    'QTD_SEPARADA_TOTAL',
    'QTD_NFE_TOTAL',
    'DIFERENCA_TOTAL',
    'VALOR_DIFERENCA_TOTAL',
    'OCORRENCIAS',
    'CARGAS_ENVOLVIDAS',
    'TIPOS_DIVERGENCIA',
  ];
  function csvCell(v) {
    if (v == null) return '';
    let s = String(v);
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  }
  const linhas = [cabecalho.map(csvCell).join(';')];
  for (const s of skus) {
    linhas.push(
      [
        s.COD_PRODUTO,
        s.DS_PRODUTO,
        s.UNIDADE,
        fmtNumber(s.qtdPedidoTotal),
        fmtNumber(s.qtdNfTotal),
        fmtNumber(s.qtdDifTotal),
        fmtNumber(s.valorDifTotal, 2),
        s.qtdOcorrencias,
        s.cargasEnvolvidas.map((c) => '#' + c).join(' | '),
        s.tiposEnvolvidos.map(labelTipo).join(' | '),
      ]
        .map(csvCell)
        .join(';')
    );
  }
  return '\uFEFF' + linhas.join('\r\n');
}

module.exports = {
  buildDivergenciasExpedicaoHtml,
  buildDivergenciasExpedicaoCsv,
  buildDivergenciasExpedicaoSkuCsv,
  agregarPorSku,
  carregarDivergencias,
  schemaMissing,
};
