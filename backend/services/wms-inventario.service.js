'use strict';

const { pool } = require('../config/db');
const { listarPosicaoEstoque, enriquecerLinhasPosicaoCadastro } = require('./wms-relatorio-posicao-estoque.service');
const { filtrarLinhasPorGrupoCategoria } = require('./wms-relatorio-filtro-produto.service');
const { resolverProdutoEstoque } = require('./wms-resolver-codigo-estoque.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Mensagem padrão para o operador/TI quando uma operação da Fase 3b
 *  (status de linha, recontagem, tolerância, dividir, edição inline de
 *  lote/validade) bate em uma coluna ausente. Indica EXATAMENTE qual script
 *  rodar — evita o operador ficar travado sem saber o que fazer. */
const MSG_FASE_3B_AUSENTE =
  'Estrutura WMS incompleta — script da Fase 3b ainda não executado. ' +
  'Peça à TI rodar no banco (pgAdmin) o arquivo: ' +
  'backend/scripts/adicionar_status_recontagem_inventario_postgres.sql. ' +
  'Em seguida recarregue a página.';

/** Cache de detecção de colunas opcionais. A Fase 3b adicionou ST_LINHA e
 *  outras colunas em WMS_INVENTARIO_LINHA. Operações como dividir linha
 *  precisam funcionar mesmo se o script Fase 3b ainda não foi executado
 *  (a coluna simplesmente fica fora do INSERT, e o detalhe segue contando
 *  status pelo default 'PENDENTE' em memória). */
const _colCache = new Map();
async function hasColumn(table, column) {
  const key = table + '.' + column;
  if (_colCache.has(key)) return _colCache.get(key);
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = $1 AND column_name = $2
        LIMIT 1`,
      [table, column]
    );
    const exists = r.rowCount > 0;
    _colCache.set(key, exists);
    return exists;
  } catch (_) {
    return false;
  }
}

function normCodigo(v) {
  return String(v || '').trim().slice(0, 128);
}

/** Igual à busca OPL/de-para: ignora pontos, barras e espaços (6010156800 = 6.01.01.568.00). */
function codigoMatchKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
}

function normLote(v) {
  const s = String(v || '').trim();
  return s ? s.slice(0, 60) : '';
}

function normValidade(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  /** Excel/planilha costuma gravar data vazia como 01/01/1900 — tratar como sem validade. */
  if (/^(1900-01-01|01\/01\/1900|1899-12-31|31\/12\/1899)$/i.test(s)) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    if (m[3] === '1900' && m[2] === '01' && m[1] === '01') return '';
    if (m[3] === '1899' && m[2] === '12' && m[1] === '31') return '';
    return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

/** Sugere validade (e lote) a partir do saldo inventário ou última NF encerrada. */
async function sugerirValidadeProduto(client, tenantId, cdDono, cdProduto) {
  const invL = await client.query(
    `SELECT "VALIDADE", "LOTE"
       FROM "WMS_INVENTARIO_SALDO_LOTE"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = $3::integer
        AND "VALIDADE" IS NOT NULL AND "QTD" > 0
      ORDER BY "VALIDADE" ASC
      LIMIT 1`,
    [tenantId, cdDono, cdProduto]
  );
  if (invL.rows[0] && invL.rows[0].VALIDADE) {
    const d = invL.rows[0].VALIDADE;
    const ymd =
      d instanceof Date
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        : String(d).slice(0, 10);
    return { validade: ymd, lote: invL.rows[0].LOTE || null, fonte: 'saldo_lote' };
  }
  const nf = await client.query(
    `SELECT NULLIF(TRIM(elem->>'validade'),'') AS val,
            NULLIF(TRIM(elem->>'lote'),'') AS lote
       FROM "WMS_NFE_ENTRADA" e
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) elem
      WHERE e."TENANT_ID" = $1 AND e."CD_DONO" = $2::integer
        AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
        AND (elem->>'cdProduto') ~ '^[0-9]+$'
        AND (elem->>'cdProduto')::integer = $3::integer
        AND NULLIF(TRIM(elem->>'validade'),'') IS NOT NULL
      ORDER BY NULLIF(TRIM(elem->>'validade'),'') ASC NULLS LAST
      LIMIT 1`,
    [tenantId, cdDono, cdProduto]
  );
  if (nf.rows[0] && nf.rows[0].val) {
    const ymd = normValidade(nf.rows[0].val) || String(nf.rows[0].val).slice(0, 10);
    if (ymd) return { validade: ymd, lote: nf.rows[0].lote || null, fonte: 'nf' };
  }
  return null;
}

/** Resolve produto no inventário e sugere validade mais curta (saldo lote → NF). */
async function sugerirValidadeInventario(tenantId, cdInventario, codigoProduto) {
  const codigo = String(codigoProduto || '').trim();
  if (!codigo) return { err: 'Informe o código do produto.', status: 400 };
  const client = await pool.connect();
  try {
    const cab = await client.query(
      `SELECT "CD_DONO", "ST_INVENTARIO"
         FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2
        LIMIT 1`,
      [cdInventario, tenantId]
    );
    if (!cab.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
    const prod = await mapCodigoParaProduto(client, tenantId, cab.rows[0].CD_DONO, codigo);
    if (!prod) {
      return {
        err: 'Produto não cadastrado para este dono.',
        status: 404,
      };
    }
    const sug = await sugerirValidadeProduto(client, tenantId, cab.rows[0].CD_DONO, prod.CD_PRODUTO);
    return {
      ok: {
        codigo: prod.CODIGO || codigo,
        nome: prod.NOME || null,
        cdProduto: prod.CD_PRODUTO,
        validade: sug ? sug.validade : null,
        lote: sug ? sug.lote : null,
        fonte: sug ? sug.fonte : null,
      },
    };
  } finally {
    client.release();
  }
}

function normFator(v) {
  if (v == null || v === '') return 1;
  const n = Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function linhaChave(codigo, lote, validade) {
  return `${normCodigo(codigo).toLowerCase()}|${normLote(lote).toLowerCase()}|${normValidade(validade) || ''}`;
}

/** Chave de consolidação por SKU no resumo/encerramento (código interno do dono). */
function chaveSkuResumo(ln) {
  const cod = codigoMatchKey(ln.CODIGO_PRODUTO || '');
  if (cod) return `C:${cod}`;
  const cd = ln.CD_PRODUTO != null ? parseInt(ln.CD_PRODUTO, 10) : null;
  if (Number.isFinite(cd)) return `P:${cd}`;
  return null;
}

function parseCsvInventario(text) {
  let raw = String(text || '');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (!lines.length) return { err: 'Arquivo vazio.' };
  const sep = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  const split = (line) => {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = !inQ;
      } else if ((c === sep || c === '\t') && !inQ) {
        out.push(cur.trim());
        cur = '';
      } else cur += c;
    }
    out.push(cur.trim());
    return out;
  };
  const head = split(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim().toUpperCase());
  const idx = (name) => head.indexOf(name);
  const iCod = idx('CODIGO_PRODUTO');
  const iQtd = idx('QTD_CONTADA');
  if (iCod < 0 || iQtd < 0) {
    return { err: 'Cabeçalho inválido. Exija CODIGO_PRODUTO e QTD_CONTADA.' };
  }
  const iLote = idx('LOTE');
  const iVal = idx('VALIDADE');
  const iFat = idx('FATOR_CONVERSAO');
  const iEnd = idx('ENDERECO');
  const iObs = idx('OBSERVACAO');
  const rows = [];
  for (let n = 1; n < lines.length; n++) {
    const cols = split(lines[n]);
    const codigo = normCodigo(cols[iCod]);
    if (!codigo) continue;
    const qtdRaw = String(cols[iQtd] ?? '').trim().replace(',', '.');
    const qtd = qtdRaw === '' ? null : Number(qtdRaw);
    if (qtd != null && (!Number.isFinite(qtd) || qtd < 0)) {
      return { err: `Linha ${n + 1}: QTD_CONTADA inválida.` };
    }
    rows.push({
      codigoProduto: codigo,
      qtdContada: qtd,
      lote: iLote >= 0 ? normLote(cols[iLote]) : '',
      validade: iVal >= 0 ? normValidade(cols[iVal]) || '' : '',
      fatorConversao: iFat >= 0 ? normFator(cols[iFat]) : 1,
      endereco: iEnd >= 0 ? String(cols[iEnd] ?? '').trim().slice(0, 120) : '',
      observacao: iObs >= 0 ? String(cols[iObs] ?? '').trim().slice(0, 255) : '',
    });
  }
  if (!rows.length) return { err: 'Nenhuma linha de produto no arquivo.' };
  return { ok: rows };
}

async function assertDonoTenant(client, tenantId, cdDono) {
  const r = await client.query(
    `SELECT 1 FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2 AND COALESCE("FGACTIVE", 'S') = 'S'`,
    [cdDono, tenantId]
  );
  return r.rowCount > 0;
}

async function mapCodigoParaProduto(client, tenantId, cdDono, codigo) {
  const hit = await resolverProdutoEstoque(client, tenantId, cdDono, normCodigo(codigo), {});
  if (!hit) return null;
  const r = await client.query(
    `SELECT "CD_PRODUTO", "CODIGO", "NOME",
            COALESCE("FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
            COALESCE("FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_DONO"
      WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2
      LIMIT 1`,
    [hit.cdProduto, tenantId]
  );
  return r.rows[0] || null;
}

/** Saldo por SKU (mesma base do relatório posição). */
async function obterSaldoSkuMap(tenantId, cdDono) {
  const { linhas } = await listarPosicaoEstoque(tenantId, cdDono);
  const map = new Map();
  for (const row of linhas || []) {
    const cd = parseInt(row.CD_PRODUTO, 10);
    if (!Number.isFinite(cd)) continue;
    if (!map.has(cd)) {
      map.set(cd, {
        CD_PRODUTO: cd,
        CODIGO_PRODUTO: row.CODIGO_PRODUTO || '',
        NM_PRODUTO: row.NM_PRODUTO || '',
        QTD_SALDO_SKU: Number(row.QTD_SALDO_SKU) || 0,
      });
    }
  }
  return map;
}

/**
 * Saldo SKU por CD_PRODUTO = entradas NF encerradas + movimentos no ledger.
 * Mesma base do relatório Movimentação (sem depender de chave de código nem snapshot).
 */
async function obterSaldoLedgerPorProdutoMap(tenantId, cdDono) {
  const map = new Map();
  try {
    const r = await pool.query(
      `WITH ent AS (
         SELECT (elem->>'cdProduto')::integer AS cd_produto,
                SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric) AS qtd
           FROM "WMS_NFE_ENTRADA" e
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
          WHERE e."TENANT_ID" = $1
            AND e."CD_DONO" = $2::integer
            AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
            AND (elem->>'cdProduto') ~ '^[0-9]+$'
          GROUP BY (elem->>'cdProduto')::integer
       ),
       mov AS (
         SELECT m."CD_PRODUTO" AS cd_produto, SUM(m."QTD")::numeric AS qtd
           FROM "WMS_MOVIMENTO_ESTOQUE" m
          WHERE m."TENANT_ID" = $1
            AND m."CD_DONO" = $2::integer
          GROUP BY m."CD_PRODUTO"
       ),
       u AS (
         SELECT cd_produto, qtd FROM ent WHERE cd_produto IS NOT NULL
         UNION ALL
         SELECT cd_produto, qtd FROM mov WHERE cd_produto IS NOT NULL
       )
       SELECT cd_produto, SUM(qtd)::numeric AS saldo
         FROM u
        GROUP BY cd_produto`,
      [tenantId, cdDono]
    );
    for (const row of r.rows || []) {
      const cd = parseInt(row.cd_produto, 10);
      if (Number.isFinite(cd)) map.set(cd, Number(row.saldo) || 0);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Saldo do sistema para gravar em `QTD_SISTEMA_SNAPSHOT` ao incluir uma linha.
 * Só a **primeira** linha do SKU no inventário recebe o saldo total do ledger
 * (mesma base do relatório de movimentação / posição). Linhas adicionais do
 * mesmo produto (outro lote/validade) ficam com 0 — o front mostra "↑ mesmo SKU".
 */
async function qtdSistemaSnapshotNovaLinhaSku(tenantId, cdDono, cdInventario, cdProduto, client) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS n FROM "WMS_INVENTARIO_LINHA"
      WHERE "CD_INVENTARIO" = $1::integer AND "CD_PRODUTO" = $2::integer`,
    [cdInventario, cdProduto]
  );
  const n = r.rows[0] ? Number(r.rows[0].n) || 0 : 0;
  if (n > 0) return 0;
  const ledgerMap = await obterSaldoLedgerPorProdutoMap(tenantId, cdDono);
  if (ledgerMap.has(cdProduto)) return Number(ledgerMap.get(cdProduto)) || 0;
  const saldoMap = await obterSaldoSkuMap(tenantId, cdDono);
  const sku = saldoMap.get(cdProduto);
  return sku ? Number(sku.QTD_SALDO_SKU) || 0 : 0;
}

/** Corrige linhas sem snapshot quando o SKU ainda não tem saldo gravado em
 *  nenhuma linha (ex.: inclusão MANUAL antiga com snapshot 0). */
function aplicarHealSnapshotSkuSemSaldo(linhas, saldoSku, saldoLedgerPorProduto) {
  const porProduto = new Map();
  for (const ln of linhas || []) {
    const cd = ln.CD_PRODUTO != null ? parseInt(ln.CD_PRODUTO, 10) : NaN;
    if (!Number.isFinite(cd)) continue;
    if (!porProduto.has(cd)) porProduto.set(cd, []);
    porProduto.get(cd).push(ln);
  }
  const fixes = [];
  for (const [cd, grupo] of porProduto) {
    if (grupo.some((g) => Number(g.QTD_SISTEMA_SNAPSHOT) > 0)) continue;
    let saldo = 0;
    if (saldoLedgerPorProduto && saldoLedgerPorProduto.has(cd)) {
      saldo = Number(saldoLedgerPorProduto.get(cd)) || 0;
    } else {
      const sku = saldoSku.get(cd);
      saldo = sku ? Number(sku.QTD_SALDO_SKU) || 0 : 0;
    }
    if (saldo <= 0) continue;
    const alvo = grupo.slice().sort((a, b) => (a.CD_LINHA || 0) - (b.CD_LINHA || 0))[0];
    if (!alvo || Number(alvo.QTD_SISTEMA_SNAPSHOT) !== 0) continue;
    alvo.QTD_SISTEMA_SNAPSHOT = saldo;
    fixes.push({ cdLinha: alvo.CD_LINHA, saldo });
  }
  return fixes;
}

function parseDataIsoConsulta(v) {
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

function exprCodigoNormSql(col) {
  return `REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(LOWER(COALESCE(${col}, '')), '.', ''), ' ', ''), '-', ''), '[^0-9a-z]', '', 'g')`;
}

/**
 * Histórico de linhas de inventário por código, descrição ou # do documento.
 * @returns {{ ok: true, linhas: object[], total: number, limit: number, truncado: boolean } | { err: string, status: number }}
 */
async function consultarItensInventario(tenantId, filtros) {
  filtros = filtros || {};
  const LIMIT = 500;
  const cod = codigoMatchKey(filtros.codigoProduto);
  const desc = String(filtros.descricaoProduto ?? '').trim();
  const cdInv = parseInt(filtros.cdInventario, 10);

  if ((!cod || cod.length < 2) && desc.length < 2 && !Number.isFinite(cdInv)) {
    return {
      err: 'Informe código (mín. 2 caracteres), descrição (mín. 2) ou número do inventário.',
      status: 400,
    };
  }

  const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');
  const colStLinha = temStLinha ? 'l."ST_LINHA"' : `'PENDENTE'::text AS "ST_LINHA"`;

  const params = [tenantId];
  let sql = `
    SELECT
      i."CD_INVENTARIO",
      i."CD_DONO",
      d."NOME" AS "NM_DONO",
      d."MASCARA_CODIGO_PRODUTO",
      i."TP_INVENTARIO",
      i."ST_INVENTARIO",
      i."DH_ABERTURA",
      i."DH_ENCERRAMENTO",
      l."CD_LINHA",
      l."CD_PRODUTO",
      l."CODIGO_PRODUTO",
      p."NOME" AS "NM_PRODUTO",
      p."CODIGO" AS "CODIGO_INTERNO",
      l."LOTE",
      l."VALIDADE",
      l."QTD_SISTEMA_SNAPSHOT",
      l."QTD_CONTADA",
      l."FATOR_CONVERSAO",
      ${colStLinha},
      l."ORIGEM"
    FROM "WMS_INVENTARIO_LINHA" l
    INNER JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
    INNER JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = i."CD_DONO" AND d."TENANT_ID" = i."TENANT_ID"
    LEFT JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = l."CD_PRODUTO"
     AND p."TENANT_ID" = i."TENANT_ID"
     AND p."CD_DONO" = i."CD_DONO"
    WHERE i."TENANT_ID" = $1
  `;

  if (Number.isFinite(cdInv)) {
    params.push(cdInv);
    sql += ` AND i."CD_INVENTARIO" = $${params.length}::integer`;
  }

  if (filtros.cdDono != null && Number.isFinite(parseInt(filtros.cdDono, 10))) {
    params.push(parseInt(filtros.cdDono, 10));
    sql += ` AND i."CD_DONO" = $${params.length}::integer`;
  }

  if (filtros.stInventario) {
    params.push(String(filtros.stInventario).toUpperCase());
    sql += ` AND UPPER(TRIM(i."ST_INVENTARIO")) = $${params.length}`;
  }

  if (filtros.tpInventario) {
    params.push(String(filtros.tpInventario).toUpperCase());
    sql += ` AND UPPER(TRIM(i."TP_INVENTARIO")) = $${params.length}`;
  }

  const dtDe = parseDataIsoConsulta(filtros.dtDe);
  const dtAte = parseDataIsoConsulta(filtros.dtAte);
  if (dtDe) {
    params.push(dtDe);
    sql += ` AND COALESCE(i."DH_ENCERRAMENTO", i."DH_ABERTURA")::date >= $${params.length}::date`;
  }
  if (dtAte) {
    params.push(dtAte);
    sql += ` AND COALESCE(i."DH_ENCERRAMENTO", i."DH_ABERTURA")::date <= $${params.length}::date`;
  }

  if (cod && cod.length >= 2) {
    params.push('%' + cod + '%');
    const pidx = params.length;
    const exprL = exprCodigoNormSql('l."CODIGO_PRODUTO"');
    const exprP = exprCodigoNormSql('p."CODIGO"');
    sql += ` AND (${exprL} LIKE $${pidx} OR ${exprP} LIKE $${pidx})`;
  }

  if (desc.length >= 2) {
    params.push('%' + desc + '%');
    sql += ` AND (p."NOME" ILIKE $${params.length} OR l."CODIGO_PRODUTO" ILIKE $${params.length})`;
  }

  sql += ` ORDER BY COALESCE(i."DH_ENCERRAMENTO", i."DH_ABERTURA") DESC, i."CD_INVENTARIO" DESC, l."CODIGO_PRODUTO", l."CD_LINHA" LIMIT ${LIMIT + 1}`;

  try {
    const r = await pool.query(sql, params);
    const raw = r.rows || [];
    const truncado = raw.length > LIMIT;
    const slice = truncado ? raw.slice(0, LIMIT) : raw;
    const linhas = slice.map((row) => {
      const fat = normFator(row.FATOR_CONVERSAO);
      const contada =
        row.QTD_CONTADA != null && row.QTD_CONTADA !== ''
          ? Number((Number(row.QTD_CONTADA) * fat).toFixed(6))
          : null;
      const sistema = Number(row.QTD_SISTEMA_SNAPSHOT) || 0;
      const ajusteLinha =
        contada != null ? Number((contada - sistema).toFixed(6)) : null;
      return Object.assign({}, row, {
        QTD_CONTADA_CONV: contada,
        QTD_AJUSTE_LINHA: ajusteLinha,
      });
    });
    return { ok: true, linhas, total: linhas.length, limit: LIMIT, truncado };
  } catch (e) {
    if (schemaMissing(e)) {
      return { err: 'Execute backend/scripts/criar_wms_inventario_postgres.sql.', status: 503 };
    }
    throw e;
  }
}

async function listarInventarios(tenantId, filtros) {
  filtros = filtros || {};
  const params = [tenantId];
  let sql = `
    SELECT i."CD_INVENTARIO", i."CD_DONO", d."NOME" AS "NM_DONO", d."CODIGO" AS "CD_DONO_CODIGO",
           i."TP_INVENTARIO", i."ST_INVENTARIO", i."DH_CORTE", i."DH_ABERTURA", i."DH_ENCERRAMENTO",
           i."POLITICA_NAO_CONTADO", i."OBSERVACAO", i."SG_USER",
           (SELECT COUNT(*)::integer FROM "WMS_INVENTARIO_LINHA" l WHERE l."CD_INVENTARIO" = i."CD_INVENTARIO") AS "Q_LINHAS"
      FROM "WMS_INVENTARIO" i
      INNER JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = i."CD_DONO" AND d."TENANT_ID" = i."TENANT_ID"
     WHERE i."TENANT_ID" = $1`;
  if (filtros.cdDono != null && Number.isFinite(filtros.cdDono)) {
    params.push(filtros.cdDono);
    sql += ` AND i."CD_DONO" = $${params.length}::integer`;
  }
  if (filtros.stInventario) {
    params.push(String(filtros.stInventario).toUpperCase());
    sql += ` AND i."ST_INVENTARIO" = $${params.length}`;
  }
  sql += ` ORDER BY i."DH_ABERTURA" DESC, i."CD_INVENTARIO" DESC LIMIT 500`;
  const r = await pool.query(sql, params);
  return r.rows;
}

async function obterInventarioDetalhe(tenantId, cdInventario) {
  const r = await pool.query(
    `SELECT i.*, d."NOME" AS "NM_DONO", d."CODIGO" AS "CD_DONO_CODIGO",
            d."MASCARA_CODIGO_PRODUTO"
       FROM "WMS_INVENTARIO" i
       INNER JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = i."CD_DONO" AND d."TENANT_ID" = i."TENANT_ID"
      WHERE i."CD_INVENTARIO" = $1::integer AND i."TENANT_ID" = $2`,
    [cdInventario, tenantId]
  );
  if (!r.rows.length) return null;
  const cab = r.rows[0];
  const rl = await pool.query(
    `SELECT l.*, p."NOME" AS "NM_PRODUTO"
       FROM "WMS_INVENTARIO_LINHA" l
       LEFT JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO" = l."CD_PRODUTO" AND p."TENANT_ID" = $2 AND p."CD_DONO" = $3::integer
      WHERE l."CD_INVENTARIO" = $1::integer
      ORDER BY l."CODIGO_PRODUTO", l."LOTE" NULLS LAST, l."VALIDADE" NULLS LAST`,
    [cdInventario, tenantId, cab.CD_DONO]
  );
  const saldoSku = await obterSaldoSkuMap(tenantId, cab.CD_DONO);
  const saldoLedgerPorProduto = await obterSaldoLedgerPorProdutoMap(tenantId, cab.CD_DONO);
  const linhas = (rl.rows || []).map((row) => {
    const cd = row.CD_PRODUTO != null ? parseInt(row.CD_PRODUTO, 10) : null;
    const sku = cd != null ? saldoSku.get(cd) : null;
    const qtdLedger =
      cd != null && saldoLedgerPorProduto.has(cd) ? Number(saldoLedgerPorProduto.get(cd)) || 0 : null;
    const qtdSistemaSku = qtdLedger != null ? qtdLedger : sku ? sku.QTD_SALDO_SKU : null;
    const qtdContada = row.QTD_CONTADA != null ? Number(row.QTD_CONTADA) : null;
    const fat = normFator(row.FATOR_CONVERSAO);
    const qtdContadaConv = qtdContada != null ? Number((qtdContada * fat).toFixed(6)) : null;
    return {
      ...row,
      QTD_SALDO_SKU_ATUAL: qtdSistemaSku,
      QTD_CONTADA_CONV: qtdContadaConv,
    };
  });
  const snapshotFixes = aplicarHealSnapshotSkuSemSaldo(linhas, saldoSku, saldoLedgerPorProduto);
  const resumoSku = montarResumoSku(linhas, saldoSku, saldoLedgerPorProduto, cab.POLITICA_NAO_CONTADO);
  /** Métricas Fase 3b (cíclico): contadores por status + tolerância efetiva.
   *
   *  AUTO-HEAL retroativo: inventários antigos podem ter `ST_LINHA` ou
   *  `QTD_SISTEMA_SNAPSHOT` inconsistentes (ex.: linha MANUAL com snapshot 0
   *  mas saldo real no ledger). Recalculamos em memória e persistimos em
   *  background para contadores e tela baterem com o resumo de ajustes. */
  const tolerancia = await obterToleranciaEfetiva(tenantId, cdInventario);
  const contadoresStatus = { PENDENTE: 0, CONTADO: 0, DIVERGENTE: 0, RECONTAR: 0, APROVADO: 0 };
  const statusFixes = [];
  const statusMap = mapearStatusConsolidadoPorSku(linhas, tolerancia, saldoLedgerPorProduto);
  for (const ln of linhas) {
    let st = String(ln.ST_LINHA || 'PENDENTE').toUpperCase();
    if (st !== 'APROVADO' && st !== 'RECONTAR') {
      const cdL = parseInt(ln.CD_LINHA, 10);
      const novo = statusMap.has(cdL)
        ? statusMap.get(cdL)
        : ln.QTD_CONTADA != null && ln.QTD_CONTADA !== ''
          ? calcularStatusLinha(
              {
                QTD_CONTADA: ln.QTD_CONTADA,
                FATOR_CONVERSAO: ln.FATOR_CONVERSAO,
                QTD_SISTEMA_SNAPSHOT: ln.QTD_SISTEMA_SNAPSHOT,
              },
              tolerancia
            )
          : 'PENDENTE';
      if (novo !== st) {
        st = novo;
        ln.ST_LINHA = novo;
        statusFixes.push({ cd: ln.CD_LINHA, novo });
      }
    }
    if (contadoresStatus[st] != null) contadoresStatus[st] += 1;
  }
  /** Persiste auto-heal em background. Não bloqueia a resposta. */
  if (snapshotFixes.length || statusFixes.length) {
    Promise.resolve().then(async () => {
      try {
        const client = await pool.connect();
        try {
          for (const x of snapshotFixes) {
            await client.query(
              `UPDATE "WMS_INVENTARIO_LINHA" SET "QTD_SISTEMA_SNAPSHOT" = $2
                WHERE "CD_LINHA" = $1::integer AND COALESCE("QTD_SISTEMA_SNAPSHOT", 0) = 0`,
              [x.cdLinha, x.saldo]
            );
          }
          for (const x of statusFixes) {
            await client.query(
              `UPDATE "WMS_INVENTARIO_LINHA" SET "ST_LINHA" = $2
                WHERE "CD_LINHA" = $1::integer AND "ST_LINHA" NOT IN ('APROVADO', 'RECONTAR')`,
              [x.cd, x.novo]
            );
          }
        } finally {
          client.release();
        }
      } catch (e) {
        if (!schemaMissing(e)) {
          console.error('[WMS inventario] auto-heal inventário falhou:', e.message);
        }
      }
    });
  }
  let linhasComCadastro = linhas;
  let resumoEnriquecido = resumoSku;
  try {
    linhasComCadastro = await enriquecerLinhasPosicaoCadastro(tenantId, linhas);
    resumoEnriquecido = await enriquecerLinhasPosicaoCadastro(tenantId, resumoSku);
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return {
    cabecalho: cab,
    linhas: linhasComCadastro,
    resumoSku: resumoEnriquecido,
    saldoSkuAtual: [...saldoSku.values()],
    contadoresStatus,
    tolerancia,
  };
}

function montarResumoSku(linhas, saldoSku, saldoLedgerPorProduto, politicaNaoContado) {
  saldoLedgerPorProduto = saldoLedgerPorProduto || new Map();
  /** Consolida por **código do produto** (não só CD_PRODUTO): várias validades /
   *  linhas MANUAL_DIVIDIDA do mesmo SKU devem somar na contada vs. saldo único. */
  const contadaPorChave = new Map();
  const snapshotMaxPorChave = new Map();
  const tinhaSnapshotChave = new Set();
  const metaPorChave = new Map();
  const linhasContagemPorChave = new Map();

  for (const ln of linhas || []) {
    const k = chaveSkuResumo(ln);
    if (!k) continue;
    if (!metaPorChave.has(k)) {
      metaPorChave.set(k, {
        CD_PRODUTO: ln.CD_PRODUTO,
        CODIGO_PRODUTO: ln.CODIGO_PRODUTO || '',
        NM_PRODUTO: ln.NM_PRODUTO || '',
      });
    }
    if (String(ln.ORIGEM) === 'SNAPSHOT') tinhaSnapshotChave.add(k);
    const snap = Number(ln.QTD_SISTEMA_SNAPSHOT);
    if (Number.isFinite(snap)) {
      snapshotMaxPorChave.set(k, Math.max(snapshotMaxPorChave.get(k) || 0, snap));
    }
    if (ln.QTD_CONTADA == null || ln.QTD_CONTADA === '') continue;
    const q = Number((Number(ln.QTD_CONTADA) * normFator(ln.FATOR_CONVERSAO)).toFixed(6));
    contadaPorChave.set(k, Number(((contadaPorChave.get(k) || 0) + q).toFixed(6)));
    linhasContagemPorChave.set(k, (linhasContagemPorChave.get(k) || 0) + 1);
  }

  const saldoPorChave = new Map();
  for (const [cd, sku] of saldoSku.entries()) {
    const cod = codigoMatchKey(sku.CODIGO_PRODUTO || '');
    const k = cod ? `C:${cod}` : `P:${cd}`;
    const q =
      saldoLedgerPorProduto.has(cd)
        ? Number(saldoLedgerPorProduto.get(cd)) || 0
        : Number(sku.QTD_SALDO_SKU) || 0;
    saldoPorChave.set(k, Math.max(saldoPorChave.get(k) || 0, q));
    if (!metaPorChave.has(k)) {
      metaPorChave.set(k, {
        CD_PRODUTO: cd,
        CODIGO_PRODUTO: sku.CODIGO_PRODUTO || '',
        NM_PRODUTO: sku.NM_PRODUTO || '',
      });
    }
  }

  const zerar = String(politicaNaoContado).toUpperCase() === 'ZERAR';
  const resumo = [];
  const chaves = new Set([
    ...contadaPorChave.keys(),
    ...saldoPorChave.keys(),
    ...snapshotMaxPorChave.keys(),
  ]);

  for (const k of chaves) {
    let contada = contadaPorChave.has(k) ? contadaPorChave.get(k) : null;
    if (contada == null && zerar && tinhaSnapshotChave.has(k)) contada = 0;
    if (contada == null) continue;

    const meta = metaPorChave.get(k) || {};
    const cdProd =
      meta.CD_PRODUTO != null && Number.isFinite(parseInt(meta.CD_PRODUTO, 10))
        ? parseInt(meta.CD_PRODUTO, 10)
        : null;

    let sistema = 0;
    if (cdProd != null && saldoLedgerPorProduto.has(cdProd)) {
      sistema = Number(saldoLedgerPorProduto.get(cdProd)) || 0;
    } else {
      const s = saldoPorChave.get(k);
      if (s != null) sistema = Number(s) || 0;
    }

    const snapshotRef = snapshotMaxPorChave.get(k) || 0;
    const divergenciaSnapshot = Math.abs(sistema - snapshotRef) > 1e-6;

    const ajuste = Number((contada - sistema).toFixed(6));

    resumo.push({
      CD_PRODUTO: cdProd,
      CODIGO_PRODUTO: meta.CODIGO_PRODUTO || '',
      NM_PRODUTO: meta.NM_PRODUTO || '',
      QTD_SISTEMA_SKU: sistema,
      QTD_SNAPSHOT_REF: snapshotRef,
      DIVERGENCIA_SNAPSHOT: divergenciaSnapshot,
      QTD_CONTADA_SKU: contada,
      QTD_AJUSTE_SKU: ajuste,
      Q_LINHAS_CONTADAS: linhasContagemPorChave.get(k) || 0,
    });
  }

  return resumo.sort((a, b) => {
    const aa = Math.abs(Number(a.QTD_AJUSTE_SKU) || 0);
    const ab = Math.abs(Number(b.QTD_AJUSTE_SKU) || 0);
    const aZero = aa < 1e-9;
    const bZero = ab < 1e-9;
    if (aZero !== bZero) return aZero ? 1 : -1;
    return String(a.CODIGO_PRODUTO).localeCompare(String(b.CODIGO_PRODUTO));
  });
}

/** Tipos válidos de inventário. CICLICO foi adicionado na Fase 3 — só pode ser
 *  criado via fluxo de "Gerar lista de ciclo" (gera + cria em uma única ação),
 *  para garantir que o critério e a lista sempre estejam alinhados. */
const TIPOS_INVENTARIO_VALIDOS = ['INICIAL', 'GERAL', 'CICLICO'];

/** Statuses por linha do inventário (Fase 3b). */
const STATUS_LINHA_VALIDOS = ['PENDENTE', 'CONTADO', 'DIVERGENTE', 'RECONTAR', 'APROVADO'];

/**
 * Calcula CONTADO/DIVERGENTE a partir de contada vs sistema e tolerância %.
 *   |contada - sistema| / max(|sistema|, 1) <= pct  →  CONTADO
 */
function statusPorDiffContagem(contada, sistema, pctTolerancia) {
  const c = Number(contada);
  const s = Number(sistema) || 0;
  if (!Number.isFinite(c)) return 'PENDENTE';
  const diff = Math.abs(c - s);
  if (diff < 1e-9) return 'CONTADO';
  const base = Math.max(Math.abs(s), 1);
  const pct = (diff / base) * 100;
  const tol = Number(pctTolerancia);
  if (Number.isFinite(tol) && tol >= 0 && pct <= tol) return 'CONTADO';
  return 'DIVERGENTE';
}

/**
 * Calcula o status de uma linha isolada (SKU com uma única linha).
 * Para SKU com várias validades, use `mapearStatusConsolidadoPorSku`.
 *
 * @param {{ QTD_CONTADA: any, FATOR_CONVERSAO: any, QTD_SISTEMA_SNAPSHOT: any }} linha
 * @param {number} pctTolerancia — em pontos percentuais (ex.: 1 = 1%).
 * @returns {'PENDENTE'|'CONTADO'|'DIVERGENTE'}
 */
function calcularStatusLinha(linha, pctTolerancia) {
  if (linha == null) return 'PENDENTE';
  const qContRaw = linha.QTD_CONTADA;
  if (qContRaw == null || qContRaw === '') return 'PENDENTE';
  const fat = normFator(linha.FATOR_CONVERSAO);
  const contada = Number((Number(qContRaw) * fat).toFixed(6));
  const sistema = Number(linha.QTD_SISTEMA_SNAPSHOT) || 0;
  return statusPorDiffContagem(contada, sistema, pctTolerancia);
}

/**
 * Status por SKU: soma das contagens × saldo do produto (ledger ou max snapshot).
 * Várias validades do mesmo código compartilham o mesmo CONTADO/DIVERGENTE.
 * Linhas APROVADO/RECONTAR não são alteradas.
 *
 * @returns {Map<number, 'PENDENTE'|'CONTADO'|'DIVERGENTE'>} CD_LINHA → status
 */
function mapearStatusConsolidadoPorSku(linhas, pctTolerancia, saldoLedgerPorProduto) {
  saldoLedgerPorProduto = saldoLedgerPorProduto || new Map();
  /** @type {Map<string, object[]>} */
  const porSku = new Map();
  for (const ln of linhas || []) {
    const k = chaveSkuResumo(ln);
    if (!k) continue;
    if (!porSku.has(k)) porSku.set(k, []);
    porSku.get(k).push(ln);
  }

  /** @type {Map<number, string>} */
  const out = new Map();

  for (const grupo of porSku.values()) {
    let sistema = 0;
    let temLedger = false;
    for (const ln of grupo) {
      const cd =
        ln.CD_PRODUTO != null && Number.isFinite(parseInt(ln.CD_PRODUTO, 10))
          ? parseInt(ln.CD_PRODUTO, 10)
          : null;
      if (cd != null && saldoLedgerPorProduto.has(cd)) {
        sistema = Number(saldoLedgerPorProduto.get(cd)) || 0;
        temLedger = true;
        break;
      }
    }
    if (!temLedger) {
      let maxSnap = 0;
      for (const ln of grupo) {
        const snap = Number(ln.QTD_SISTEMA_SNAPSHOT);
        if (Number.isFinite(snap)) maxSnap = Math.max(maxSnap, snap);
      }
      if (grupo.length === 1 && Number.isFinite(Number(grupo[0].QTD_SALDO_SKU_ATUAL))) {
        sistema = Number(grupo[0].QTD_SALDO_SKU_ATUAL) || 0;
      } else {
        sistema = maxSnap;
      }
    }

    let somaContada = 0;
    let qComContagem = 0;
    for (const ln of grupo) {
      if (ln.QTD_CONTADA == null || ln.QTD_CONTADA === '') continue;
      const q = Number((Number(ln.QTD_CONTADA) * normFator(ln.FATOR_CONVERSAO)).toFixed(6));
      if (!Number.isFinite(q)) continue;
      somaContada = Number((somaContada + q).toFixed(6));
      qComContagem += 1;
    }

    const stGrupo =
      qComContagem === 0 ? null : statusPorDiffContagem(somaContada, sistema, pctTolerancia);

    for (const ln of grupo) {
      const cdLinha = parseInt(ln.CD_LINHA, 10);
      if (!Number.isFinite(cdLinha)) continue;
      const stAtual = String(ln.ST_LINHA || 'PENDENTE').toUpperCase();
      if (stAtual === 'APROVADO' || stAtual === 'RECONTAR') continue;
      if (ln.QTD_CONTADA == null || ln.QTD_CONTADA === '') {
        out.set(cdLinha, 'PENDENTE');
      } else if (stGrupo) {
        out.set(cdLinha, stGrupo);
      }
    }
  }
  return out;
}

/**
 * Sistema de referência do grupo (ledger se houver, senão max snapshot).
 */
function sistemaReferenciaGrupoSku(grupo, saldoLedgerPorProduto) {
  saldoLedgerPorProduto = saldoLedgerPorProduto || new Map();
  for (const ln of grupo || []) {
    const cd =
      ln.CD_PRODUTO != null && Number.isFinite(parseInt(ln.CD_PRODUTO, 10))
        ? parseInt(ln.CD_PRODUTO, 10)
        : null;
    if (cd != null && saldoLedgerPorProduto.has(cd)) {
      return Number(saldoLedgerPorProduto.get(cd)) || 0;
    }
  }
  let maxSnap = 0;
  for (const ln of grupo || []) {
    const snap = Number(ln.QTD_SISTEMA_SNAPSHOT);
    if (Number.isFinite(snap)) maxSnap = Math.max(maxSnap, snap);
  }
  return maxSnap;
}

/**
 * Tolerância efetiva (%) do inventário: campo PCT_TOLERANCIA, ou fallback
 * para NU_PCT_TOLERANCIA_CICLICO do dono, ou 0 (sem tolerância).
 */
async function obterToleranciaEfetiva(tenantId, cdInventario) {
  try {
    const r = await pool.query(
      `SELECT COALESCE(i."PCT_TOLERANCIA", d."NU_PCT_TOLERANCIA_CICLICO", 0)::numeric AS tol
         FROM "WMS_INVENTARIO" i
         JOIN "WMS_DONO_ESTOQUE" d
           ON d."CD_DONO" = i."CD_DONO" AND d."TENANT_ID" = i."TENANT_ID"
        WHERE i."CD_INVENTARIO" = $1::integer AND i."TENANT_ID" = $2`,
      [cdInventario, tenantId]
    );
    if (!r.rows.length) return 0;
    return Number(r.rows[0].tol) || 0;
  } catch (e) {
    if (schemaMissing(e)) return 0;
    throw e;
  }
}

/**
 * Recalcula `ST_LINHA` consolidando por SKU (soma das validades × saldo do produto).
 * RECONTAR e APROVADO ficam intactos. Chamado após importar CSV, mudar tolerância
 * ou antes do encerramento.
 */
async function recalcularStatusLinhasInventario(client, tenantId, cdInventario) {
  const tol = await obterToleranciaEfetiva(tenantId, cdInventario);
  const cab = await client.query(
    `SELECT "CD_DONO" FROM "WMS_INVENTARIO"
      WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
    [cdInventario, tenantId]
  );
  const cdDono = cab.rows[0] ? cab.rows[0].CD_DONO : null;
  let saldoLedger = new Map();
  if (cdDono != null) {
    try {
      saldoLedger = await obterSaldoLedgerPorProdutoMap(tenantId, cdDono);
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  const r = await client.query(
    `SELECT "CD_LINHA", "CD_PRODUTO", "CODIGO_PRODUTO", "QTD_CONTADA", "FATOR_CONVERSAO",
            "QTD_SISTEMA_SNAPSHOT", "ST_LINHA"
       FROM "WMS_INVENTARIO_LINHA"
      WHERE "CD_INVENTARIO" = $1::integer`,
    [cdInventario]
  );
  const statusMap = mapearStatusConsolidadoPorSku(r.rows || [], tol, saldoLedger);
  let alterados = 0;
  for (const ln of r.rows || []) {
    const stAtual = String(ln.ST_LINHA || 'PENDENTE').toUpperCase();
    if (stAtual === 'RECONTAR' || stAtual === 'APROVADO') continue;
    const cdL = parseInt(ln.CD_LINHA, 10);
    const novo = statusMap.has(cdL)
      ? statusMap.get(cdL)
      : calcularStatusLinha(ln, tol);
    const up = await client.query(
      `UPDATE "WMS_INVENTARIO_LINHA"
          SET "ST_LINHA" = $2
        WHERE "CD_LINHA" = $1::integer AND "ST_LINHA" <> $2
          AND "ST_LINHA" NOT IN ('RECONTAR', 'APROVADO')`,
      [ln.CD_LINHA, novo]
    );
    alterados += up.rowCount || 0;
  }
  return { tol, alterados };
}

async function criarInventario(tenantId, payload, sgUser) {
  const cdDono = parseInt(payload.cdDono ?? payload.CD_DONO, 10);
  if (!Number.isFinite(cdDono)) return { err: 'CD_DONO é obrigatório.', status: 400 };
  const tp = String(payload.tpInventario ?? payload.TP_INVENTARIO ?? 'GERAL').toUpperCase();
  if (!TIPOS_INVENTARIO_VALIDOS.includes(tp)) return { err: 'TP_INVENTARIO inválido.', status: 400 };
  /** Inventário cíclico tem fluxo de criação próprio (gerar lista + criar), que
   *  popula linhas. Bloqueamos criação manual sem lista para evitar inventário
   *  cíclico vazio (que não tem sentido). */
  if (tp === 'CICLICO' && payload.fromGerador !== true) {
    return {
      err: 'Inventário CICLICO deve ser criado via "Gerar lista de ciclo" (informe um critério).',
      status: 400,
    };
  }
  const pol = String(payload.politicaNaoContado ?? payload.POLITICA_NAO_CONTADO ?? 'MANTER').toUpperCase();
  if (!['MANTER', 'ZERAR'].includes(pol)) return { err: 'POLITICA_NAO_CONTADO inválida.', status: 400 };
  /** Em CICLICO a política precisa ser sempre MANTER — só ajustamos o que está
   *  na lista; "ZERAR" zeraria o restante do armazém, contradizendo a ideia
   *  de inventário rotativo por amostra. */
  if (tp === 'CICLICO' && pol !== 'MANTER') {
    return { err: 'Em inventário CICLICO a política deve ser MANTER (apenas SKUs listados são ajustados).', status: 400 };
  }
  const obs = String(payload.observacao ?? payload.OBSERVACAO ?? '').trim().slice(0, 500) || null;
  const criterio = tp === 'CICLICO' && payload.criterio ? String(payload.criterio).toUpperCase().slice(0, 32) : null;
  const client = await pool.connect();
  try {
    if (!(await assertDonoTenant(client, tenantId, cdDono))) {
      return { err: 'Dono do estoque não encontrado.', status: 400 };
    }
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO "WMS_INVENTARIO" (
         "TENANT_ID", "CD_DONO", "TP_INVENTARIO", "ST_INVENTARIO", "DH_CORTE",
         "POLITICA_NAO_CONTADO", "OBSERVACAO", "SG_USER", "CRITERIO_CICLICO"
       ) VALUES ($1, $2::integer, $3, 'EM_CONTAGEM', CURRENT_TIMESTAMP, $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, cdDono, tp, pol, obs, sgUser, criterio]
    );
    await client.query('COMMIT');
    return { ok: ins.rows[0] };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: 'Execute backend/scripts/criar_wms_inventario_postgres.sql + adicionar_tipo_ciclico_inventario_postgres.sql.', status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/** Critérios suportados para gerar lista de inventário cíclico. */
const CRITERIOS_CICLICO_VALIDOS = new Set([
  'ABC',
  'VENCIMENTO',
  'MAIS_ANTIGOS',
  'MAIS_MOVIMENTADOS',
  'ALEATORIO',
  'CONSERVACAO',
]);

/** SKUs cadastrados no dono que batem no filtro de código mas ainda não têm saldo. */
async function buscarSkusCadastroSemSaldoParaCiclo(tenantId, cdDono, codigoFiltro, combinaFn) {
  if (!codigoFiltro) return [];
  try {
    const r = await pool.query(
      `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."TIPO_ARMAZENAGEM",
              COALESCE(p."FG_DESCARTAVEL", 'N') AS "FG_DESCARTAVEL"
         FROM "WMS_PRODUTO_DONO" p
        WHERE p."TENANT_ID" = $1
          AND p."CD_DONO" = $2::integer
          AND COALESCE(p."FGACTIVE", 'S') = 'S'`,
      [tenantId, cdDono]
    );
    return (r.rows || [])
      .filter((row) => combinaFn(row.CODIGO, codigoFiltro))
      .map((row) => ({
        CD_PRODUTO: Number(row.CD_PRODUTO),
        CODIGO_PRODUTO: row.CODIGO,
        NM_PRODUTO: row.NOME,
        TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
        FG_DESCARTAVEL: row.FG_DESCARTAVEL === 'S' ? 'S' : 'N',
        LOTE: '',
        VALIDADE: '',
        QTD_SALDO_SKU: 0,
        QTD_ENTRADA: 0,
        _fromCadastroSemSaldo: true,
      }));
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

/** Mapa CD_PRODUTO → FG_DESCARTAVEL (S/N) do cadastro do dono. */
async function carregarFgDescartavelPorProduto(tenantId, cdDono) {
  const map = new Map();
  try {
    const r = await pool.query(
      `SELECT p."CD_PRODUTO", COALESCE(p."FG_DESCARTAVEL", 'N') AS fg
         FROM "WMS_PRODUTO_DONO" p
        WHERE p."TENANT_ID" = $1
          AND p."CD_DONO" = $2::integer
          AND COALESCE(p."FGACTIVE", 'S') = 'S'`,
      [tenantId, cdDono]
    );
    for (const row of r.rows || []) {
      map.set(Number(row.CD_PRODUTO), row.fg === 'S' ? 'S' : 'N');
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/** Todos os descartáveis cadastrados (FG_DESCARTAVEL=S), inclusive sem saldo. */
async function buscarSkusCadastroDescartaveisParaCiclo(tenantId, cdDono) {
  try {
    const r = await pool.query(
      `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."TIPO_ARMAZENAGEM"
         FROM "WMS_PRODUTO_DONO" p
        WHERE p."TENANT_ID" = $1
          AND p."CD_DONO" = $2::integer
          AND COALESCE(p."FGACTIVE", 'S') = 'S'
          AND COALESCE(p."FG_DESCARTAVEL", 'N') = 'S'`,
      [tenantId, cdDono]
    );
    return (r.rows || []).map((row) => ({
      CD_PRODUTO: Number(row.CD_PRODUTO),
      CODIGO_PRODUTO: row.CODIGO,
      NM_PRODUTO: row.NOME,
      TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
      FG_DESCARTAVEL: 'S',
      LOTE: '',
      VALIDADE: '',
      QTD_SALDO_SKU: 0,
      QTD_ENTRADA: 0,
      _fromCadastroSemSaldo: true,
    }));
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

/** Filtro "DESCART" / "DESCARTAVEL" no modal = flag FG_DESCARTAVEL, não TIPO_ARMAZENAGEM. */
function filtroEhDescartavel(conservacao) {
  const s = String(conservacao || '').trim().toUpperCase();
  if (!s) return false;
  return /^DESCART/.test(s) || s === 'DESCARTAVEL' || s === 'DESCARTÁVEL';
}

function mesclarSkusNoPool(pool, extras) {
  const porCd = new Set(pool.map((r) => Number(r.CD_PRODUTO)));
  let incluidos = 0;
  for (const ex of extras) {
    const cd = Number(ex.CD_PRODUTO);
    if (!porCd.has(cd)) {
      pool.push(ex);
      porCd.add(cd);
      incluidos += 1;
    }
  }
  return incluidos;
}

/**
 * Gera a lista de SKUs (com saldo + lote + validade) para um ciclo de inventário,
 * de acordo com o critério escolhido. NÃO grava nada — é um preview.
 *
 * @param {string|number} tenantId
 * @param {{
 *   cdDono: number,
 *   criterio: 'ABC'|'VENCIMENTO'|'MAIS_ANTIGOS'|'MAIS_MOVIMENTADOS'|'ALEATORIO'|'CONSERVACAO',
 *   limite?: number,             // padrão 50; máx 500
 *   diasJanela?: number,         // padrão 30 (movimentação, vencimento)
 *   conservacao?: string,        // 'REFRIGERADO'|'CONGELADO'|'SECO'|... (substring case-insensitive)
 *   palavraChave?: string,       // substring no NM_PRODUTO (legado: opts.categoria)
 *   grupoProduto?: string,       // igual relatório Saldo: contém em NM_GRUPO
 *   categoriaProduto?: string,   // igual relatório Saldo: contém em NM_CATEGORIA
 *   cdGrupo?: number,            // filtro exato pelo grupo WMS (opcional)
 *   cdCategoria?: number,        // filtro exato pela categoria WMS (opcional)
 * }} opts
 * @returns {Promise<{linhas: object[], info: object}>}
 */
async function gerarListaCiclica(tenantId, opts) {
  opts = opts || {};
  const cdDono = parseInt(opts.cdDono, 10);
  if (!Number.isFinite(cdDono)) return { err: 'CD_DONO é obrigatório.', status: 400 };

  const criterio = String(opts.criterio || '').toUpperCase();
  if (!CRITERIOS_CICLICO_VALIDOS.has(criterio)) {
    return {
      err: `Critério inválido. Use: ${Array.from(CRITERIOS_CICLICO_VALIDOS).join(', ')}.`,
      status: 400,
    };
  }

  let limite = parseInt(opts.limite, 10);
  if (!Number.isFinite(limite) || limite <= 0) limite = 50;
  if (limite > 2000) limite = 2000;

  let diasJanela = parseInt(opts.diasJanela, 10);
  if (!Number.isFinite(diasJanela) || diasJanela <= 0) diasJanela = 30;
  if (diasJanela > 365) diasJanela = 365;

  const conservacao = String(opts.conservacao || '').trim();
  /** Palavra-chave no nome do produto (NM_PRODUTO). Legado: body.categoria. */
  const palavraChaveProduto = String(opts.palavraChave || opts.categoria || '').trim();
  /** Código interno ou numérico OL (ex.: 6310910600 → 6.31.09.106.00). */
  const codigoProduto = String(opts.codigoProduto || opts.codigo || '').trim();
  /** Mesma lógica do relatório Saldo (texto contém no cadastro WMS). */
  const grupoProduto = String(opts.grupoProduto || opts.grupoContem || '').trim();
  const categoriaProduto = String(opts.categoriaProduto || '').trim();
  const cdGrupoFiltro = parseInt(opts.cdGrupo ?? opts.CD_GRUPO, 10);
  const cdCategoriaFiltro = parseInt(opts.cdCategoria ?? opts.CD_CATEGORIA, 10);
  const temFiltroCadastro =
    !!grupoProduto ||
    !!categoriaProduto ||
    (Number.isFinite(cdGrupoFiltro) && cdGrupoFiltro > 0) ||
    (Number.isFinite(cdCategoriaFiltro) && cdCategoriaFiltro > 0);

  function normCodigoBusca(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function codigoProdutoCombina(codigoInterno, filtro) {
    if (!filtro) return true;
    const cod = String(codigoInterno || '').trim();
    const f = String(filtro).trim();
    if (!cod || !f) return false;
    if (cod.toUpperCase().includes(f.toUpperCase())) return true;
    const digF = normCodigoBusca(f);
    const digC = normCodigoBusca(cod);
    if (digF && digC.includes(digF)) return true;
    return false;
  }

  /** Carrega a posição completa do dono (entrada NF + ledger). Por padrão só
   *  SKUs com saldo > 0 entram no ciclo; exceção: filtro explícito de código
   *  inclui o produto cadastrado mesmo com saldo zero (contagem/ajuste pontual). */
  const { linhas: saldo } = await listarPosicaoEstoque(tenantId, cdDono);
  const fgDescPorProduto = await carregarFgDescartavelPorProduto(tenantId, cdDono);
  const skusComSaldo = (saldo || []).filter((r) => {
    const q = Number(r.QTD_SALDO_SKU ?? r.QTD_ENTRADA ?? 0);
    return Number.isFinite(q) && q > 0;
  });

  let poolCandidatos = skusComSaldo.map((r) => ({
    ...r,
    FG_DESCARTAVEL: fgDescPorProduto.get(Number(r.CD_PRODUTO)) || 'N',
  }));
  let incluidosSemSaldo = 0;
  if (codigoProduto) {
    incluidosSemSaldo += mesclarSkusNoPool(
      poolCandidatos,
      await buscarSkusCadastroSemSaldoParaCiclo(tenantId, cdDono, codigoProduto, codigoProdutoCombina)
    );
  }
  if (filtroEhDescartavel(conservacao)) {
    incluidosSemSaldo += mesclarSkusNoPool(
      poolCandidatos,
      await buscarSkusCadastroDescartaveisParaCiclo(tenantId, cdDono)
    );
  }

  /** Grupo/categoria vêm do cadastro WMS (mesmo vínculo dos Cadastros). */
  poolCandidatos = await enriquecerLinhasPosicaoCadastro(tenantId, poolCandidatos);

  function codigoFiltroCombinaLinha(r) {
    return !codigoProduto || codigoProdutoCombina(r.CODIGO_PRODUTO, codigoProduto);
  }

  /** Aplica filtros de conservação/cadastro/palavra-chave/código sobre o saldo. */
  function passaFiltros(r) {
    if (conservacao) {
      if (filtroEhDescartavel(conservacao)) {
        if (String(r.FG_DESCARTAVEL || 'N').toUpperCase() !== 'S') return false;
      } else {
        const tipo = String(r.TIPO_ARMAZENAGEM || '').toUpperCase();
        if (tipo.indexOf(conservacao.toUpperCase()) < 0) return false;
      }
    }
    if (codigoProduto && !codigoProdutoCombina(r.CODIGO_PRODUTO, codigoProduto)) return false;
    if (palavraChaveProduto) {
      const nome = String(r.NM_PRODUTO || '').toUpperCase();
      if (nome.indexOf(palavraChaveProduto.toUpperCase()) < 0) return false;
    }
    const cad = r._cadWms || {};
    if (Number.isFinite(cdCategoriaFiltro) && cdCategoriaFiltro > 0) {
      if (Number(cad.CD_CATEGORIA) !== cdCategoriaFiltro) return false;
    }
    if (Number.isFinite(cdGrupoFiltro) && cdGrupoFiltro > 0) {
      if (Number(cad.CD_GRUPO) !== cdGrupoFiltro) return false;
    }
    return true;
  }
  let candidatos = poolCandidatos.filter(passaFiltros);
  if (grupoProduto || categoriaProduto) {
    candidatos = filtrarLinhasPorGrupoCategoria(candidatos, {
      grupoProduto,
      categoriaProduto,
    });
  }

  /** ABC e MAIS_MOVIMENTADOS precisam do somatório de movimentações nos últimos
   *  X dias. Carregamos a partir do ledger (entradas + saídas absolutas). ABC
   *  rankeia por |giro| e separa em A/B/C; MAIS_MOVIMENTADOS pega o top N
   *  diretamente sem classificação. */
  let movimentosPorProduto = null;
  if (criterio === 'ABC' || criterio === 'MAIS_MOVIMENTADOS') {
    movimentosPorProduto = await carregarMovimentacaoPorProduto(tenantId, cdDono, diasJanela);
  }

  /** Última data de contagem por SKU — usado em MAIS_ANTIGOS. */
  let ultimaContagemPorProduto = null;
  if (criterio === 'MAIS_ANTIGOS') {
    ultimaContagemPorProduto = await carregarUltimaContagemPorProduto(tenantId, cdDono);
  }

  /** Aplica o critério. Cada ramo enriquece `candidatos` com a métrica usada
   *  no ranking (`_score`) e ordena. */
  switch (criterio) {
    case 'ABC':
    case 'MAIS_MOVIMENTADOS':
      candidatos = candidatos
        .map((r) => ({
          ...r,
          _qtdMovs: movimentosPorProduto.get(Number(r.CD_PRODUTO)) || 0,
        }))
        .filter(
          (r) =>
            r._qtdMovs > 0 ||
            (codigoProduto && codigoFiltroCombinaLinha(r))
        )
        .sort((a, b) => b._qtdMovs - a._qtdMovs);
      break;

    case 'VENCIMENTO':
      candidatos = candidatos
        .filter((r) => {
          if (codigoProduto && codigoFiltroCombinaLinha(r) && r._fromCadastroSemSaldo) return true;
          return r.VALIDADE && /^\d{4}-\d{2}-\d{2}$/.test(String(r.VALIDADE).trim());
        })
        .map((r) => {
          const v = String(r.VALIDADE || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
            return { ...r, _diasAteVencer: null };
          }
          const diff = Math.floor((new Date(v).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return { ...r, _diasAteVencer: diff };
        })
        .filter((r) => {
          if (codigoProduto && codigoFiltroCombinaLinha(r) && r._fromCadastroSemSaldo) return true;
          return r._diasAteVencer != null && r._diasAteVencer <= diasJanela;
        })
        .sort((a, b) => {
          if (a._diasAteVencer == null && b._diasAteVencer == null) return 0;
          if (a._diasAteVencer == null) return 1;
          if (b._diasAteVencer == null) return -1;
          return a._diasAteVencer - b._diasAteVencer;
        });
      break;

    case 'MAIS_ANTIGOS':
      candidatos = candidatos
        .map((r) => ({
          ...r,
          _ultimaContagem: ultimaContagemPorProduto.get(Number(r.CD_PRODUTO)) || null,
        }))
        .sort((a, b) => {
          // nulls (nunca contado) primeiro
          if (!a._ultimaContagem && !b._ultimaContagem) return 0;
          if (!a._ultimaContagem) return -1;
          if (!b._ultimaContagem) return 1;
          return new Date(a._ultimaContagem).getTime() - new Date(b._ultimaContagem).getTime();
        });
      break;

    case 'ALEATORIO': {
      // Fisher-Yates shuffle
      const arr = candidatos.slice();
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      candidatos = arr;
      break;
    }

    case 'CONSERVACAO':
      // Aqui o filtro de conservação já foi aplicado; ordenamos só por código.
      candidatos.sort((a, b) =>
        String(a.CODIGO_PRODUTO || '').localeCompare(String(b.CODIGO_PRODUTO || ''))
      );
      break;
  }

  const top = candidatos.slice(0, limite);

  let aviso = null;
  if (!candidatos.length && filtroEhDescartavel(conservacao)) {
    aviso =
      'Nenhum produto com FG_DESCARTAVEL=S no cadastro deste dono. Marque em Cadastros WMS → Produto → Descartável.';
  } else if (!candidatos.length && temFiltroCadastro) {
    aviso =
      'Nenhum SKU com saldo neste dono para o grupo/categoria informado. Confira o cadastro WMS ou amplie o filtro.';
  } else if (!candidatos.length && codigoProduto) {
    aviso =
      'Nenhum SKU com saldo no sistema para este código. Verifique o cadastro do produto no dono ou o critério (ex.: Vencimento exige validade).';
  } else if (incluidosSemSaldo > 0) {
    aviso =
      incluidosSemSaldo === 1
        ? '1 SKU incluído pelo código informado (saldo zero no sistema — contagem gerará ajuste de entrada).'
        : incluidosSemSaldo + ' SKUs incluídos pelo código (saldo zero no sistema).';
  }

  return {
    ok: {
      criterio,
      limite,
      diasJanela,
      filtros: {
        conservacao,
        palavraChaveProduto,
        codigoProduto,
        grupoProduto: grupoProduto || null,
        categoriaProduto: categoriaProduto || null,
        cdGrupo: Number.isFinite(cdGrupoFiltro) && cdGrupoFiltro > 0 ? cdGrupoFiltro : null,
        cdCategoria:
          Number.isFinite(cdCategoriaFiltro) && cdCategoriaFiltro > 0 ? cdCategoriaFiltro : null,
      },
      total: candidatos.length,
      retornados: top.length,
      incluidosSemSaldo,
      aviso,
      linhas: top.map((r) => ({
        CD_PRODUTO: Number(r.CD_PRODUTO),
        CODIGO_PRODUTO: r.CODIGO_PRODUTO,
        NM_PRODUTO: r.NM_PRODUTO,
        TIPO_ARMAZENAGEM: r.TIPO_ARMAZENAGEM || '',
        LOTE: r.LOTE || '',
        VALIDADE: r.VALIDADE || '',
        QTD_SISTEMA: Number(r.QTD_SALDO_SKU ?? r.QTD_ENTRADA ?? 0),
        DIAS_ATE_VENCER: r._diasAteVencer != null ? r._diasAteVencer : null,
        QTD_MOVIMENTOS_JANELA: r._qtdMovs != null ? r._qtdMovs : null,
        DH_ULTIMA_CONTAGEM: r._ultimaContagem || null,
      })),
    },
  };
}

/** Soma |QTD| de WMS_MOVIMENTO_ESTOQUE nos últimos `diasJanela` por CD_PRODUTO,
 *  somando também as entradas via NF-e encerradas no período (para o ABC ficar
 *  fiel ao giro total — entrada + saída). */
async function carregarMovimentacaoPorProduto(tenantId, cdDono, diasJanela) {
  const map = new Map();
  try {
    /** Ledger: cobre saídas (expedição) + ajustes manuais. */
    const r = await pool.query(
      `SELECT m."CD_PRODUTO", SUM(ABS(m."QTD"))::numeric AS qtd
         FROM "WMS_MOVIMENTO_ESTOQUE" m
        WHERE m."TENANT_ID" = $1
          AND m."CD_DONO" = $2::integer
          AND m."DH_REGISTRO" >= NOW() - ($3::int || ' days')::interval
        GROUP BY m."CD_PRODUTO"`,
      [tenantId, cdDono, diasJanela]
    );
    for (const row of r.rows) {
      const cd = parseInt(row.CD_PRODUTO, 10);
      if (Number.isFinite(cd)) map.set(cd, Number(row.qtd) || 0);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  try {
    /** NF-e de entrada encerradas: somar qtdConvertida das linhas com cdProduto numérico. */
    const r2 = await pool.query(
      `SELECT (elem->>'cdProduto')::integer AS cd_produto,
              SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'),''),'0')::numeric) AS qtd
         FROM "WMS_NFE_ENTRADA" e
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO" = $2::integer
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO",''))) = 'ENCERRADA'
          AND COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO")
              >= NOW() - ($3::int || ' days')::interval
          AND (elem->>'cdProduto') ~ '^[0-9]+$'
        GROUP BY (elem->>'cdProduto')::integer`,
      [tenantId, cdDono, diasJanela]
    );
    for (const row of r2.rows) {
      const cd = parseInt(row.cd_produto, 10);
      if (!Number.isFinite(cd)) continue;
      map.set(cd, (map.get(cd) || 0) + (Number(row.qtd) || 0));
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/** Última data em que cada produto apareceu em uma linha de WMS_INVENTARIO (qualquer
 *  tipo, qualquer status), agregando pela DH_ABERTURA do inventário pai. */
async function carregarUltimaContagemPorProduto(tenantId, cdDono) {
  const map = new Map();
  try {
    const r = await pool.query(
      `SELECT l."CD_PRODUTO", MAX(i."DH_ABERTURA") AS dh
         FROM "WMS_INVENTARIO" i
         JOIN "WMS_INVENTARIO_LINHA" l ON l."CD_INVENTARIO" = i."CD_INVENTARIO"
        WHERE i."TENANT_ID" = $1
          AND i."CD_DONO" = $2::integer
          AND l."CD_PRODUTO" IS NOT NULL
          AND l."QTD_CONTADA" IS NOT NULL
        GROUP BY l."CD_PRODUTO"`,
      [tenantId, cdDono]
    );
    for (const row of r.rows) {
      const cd = parseInt(row.CD_PRODUTO, 10);
      if (Number.isFinite(cd)) map.set(cd, row.dh);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Cria um inventário CICLICO e popula as linhas com o resultado de
 * `gerarListaCiclica`. Transação atômica: ou cria tudo, ou nada.
 */
async function criarInventarioCiclicoComLista(tenantId, payload, sgUser) {
  const cdDono = parseInt(payload.cdDono, 10);
  if (!Number.isFinite(cdDono)) return { err: 'CD_DONO é obrigatório.', status: 400 };

  /** Gera a lista PRIMEIRO — se falhar, não cria o inventário vazio. */
  const ger = await gerarListaCiclica(tenantId, payload);
  if (ger.err) return ger;
  const lista = ger.ok.linhas || [];
  if (!lista.length) {
    return { err: 'Nenhum SKU atende ao critério informado.', status: 400 };
  }

  const cria = await criarInventario(
    tenantId,
    {
      cdDono,
      tpInventario: 'CICLICO',
      politicaNaoContado: 'MANTER',
      observacao:
        payload.observacao ||
        `Ciclo ${ger.ok.criterio} (${lista.length} SKUs · janela ${ger.ok.diasJanela}d)`,
      criterio: ger.ok.criterio,
      fromGerador: true,
    },
    sgUser
  );
  if (cria.err) return cria;
  const inv = cria.ok;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of lista) {
      await client.query(
        `INSERT INTO "WMS_INVENTARIO_LINHA" (
           "CD_INVENTARIO", "CD_PRODUTO", "CODIGO_PRODUTO", "LOTE", "VALIDADE",
           "QTD_SISTEMA_SNAPSHOT", "ORIGEM", "OBSERVACAO"
         ) VALUES ($1::integer, $2::integer, $3, $4, $5, $6, 'CICLICO_GERADO', $7)
         ON CONFLICT DO NOTHING`,
        [
          inv.CD_INVENTARIO,
          l.CD_PRODUTO,
          normCodigo(l.CODIGO_PRODUTO),
          normLote(l.LOTE) || null,
          normValidade(l.VALIDADE) || null,
          Number(l.QTD_SISTEMA) || 0,
          [
            ger.ok.criterio,
            l.DIAS_ATE_VENCER != null ? `${l.DIAS_ATE_VENCER}d` : '',
            l.QTD_MOVIMENTOS_JANELA != null ? `mov ${l.QTD_MOVIMENTOS_JANELA}` : '',
          ]
            .filter(Boolean)
            .join(' · ')
            .slice(0, 255),
        ]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }

  return { ok: { ...inv, linhasGeradas: lista.length, criterio: ger.ok.criterio } };
}

async function gerarSnapshotInventario(tenantId, cdInventario, sgUser) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT "CD_DONO", "ST_INVENTARIO" FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId]
    );
    if (!r.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
    const inv = r.rows[0];
    if (String(inv.ST_INVENTARIO).toUpperCase() === 'ENCERRADO') {
      return { err: 'Inventário encerrado.', status: 409 };
    }
    const { linhas } = await listarPosicaoEstoque(tenantId, inv.CD_DONO);
    await client.query('BEGIN');
    await client.query(`DELETE FROM "WMS_INVENTARIO_LINHA" WHERE "CD_INVENTARIO" = $1::integer`, [cdInventario]);
    let n = 0;
    for (const row of linhas || []) {
      const cdProd = parseInt(row.CD_PRODUTO, 10);
      if (!Number.isFinite(cdProd)) continue;
      const codigo = normCodigo(row.CODIGO_PRODUTO);
      const lote = normLote(row.LOTE);
      const val = normValidade(row.VALIDADE) || '';
      const qtdLinha = Number(row.QTD_ENTRADA) || 0;
      if (qtdLinha <= 0 && !codigo) continue;
      await client.query(
        `DELETE FROM "WMS_INVENTARIO_LINHA"
          WHERE "CD_INVENTARIO" = $1::integer
            AND LOWER(TRIM("CODIGO_PRODUTO")) = LOWER(TRIM($2::text))
            AND COALESCE(LOWER(TRIM("LOTE")), '') = COALESCE(LOWER(TRIM($3::text)), '')
            AND COALESCE(TRIM("VALIDADE"), '') = COALESCE(TRIM($4::text), '')`,
        [cdInventario, codigo, lote || '', val || '']
      );
      await client.query(
        `INSERT INTO "WMS_INVENTARIO_LINHA" (
           "CD_INVENTARIO", "CD_PRODUTO", "CODIGO_PRODUTO", "LOTE", "VALIDADE",
           "QTD_SISTEMA_SNAPSHOT", "ORIGEM", "OBSERVACAO"
         ) VALUES ($1::integer, $2::integer, $3, $4, $5, $6, 'SNAPSHOT', $7)`,
        [
          cdInventario,
          cdProd,
          codigo,
          lote || null,
          val || null,
          qtdLinha,
          'Snapshot posição ' + new Date().toISOString().slice(0, 19),
        ]
      );
      n++;
    }
    await client.query(
      `UPDATE "WMS_INVENTARIO" SET "DH_CORTE" = CURRENT_TIMESTAMP, "SG_USER" = COALESCE($3, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId, sgUser]
    );
    await client.query('COMMIT');
    return { ok: { linhasSnapshot: n } };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: 'Estrutura de inventário ausente.', status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

async function importarLinhasInventario(tenantId, cdInventario, rows, sgUser) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT "CD_DONO", "ST_INVENTARIO" FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId]
    );
    if (!r.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
    const inv = r.rows[0];
    const st = String(inv.ST_INVENTARIO).toUpperCase();
    if (st === 'ENCERRADO' || st === 'CANCELADO') return { err: 'Inventário não permite alteração.', status: 409 };
    const erros = [];
    let ok = 0;
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      let row = rows[i];
      const prod = await mapCodigoParaProduto(client, tenantId, inv.CD_DONO, row.codigoProduto);
      if (!prod) {
        erros.push({
          linha: i + 2,
          codigo: row.codigoProduto,
          erro:
            'Produto não cadastrado para este dono (código na planilha deve bater com Cadastros → Produto, com ou sem máscara 6.01.01.568.00).',
          row: { ...row },
          podeCadastrar: true,
        });
        continue;
      }
      const reqLote = String(prod.FG_CONTROLA_LOTE).toUpperCase() === 'S';
      const reqVal = String(prod.FG_CONTROLA_VALIDADE).toUpperCase() === 'S';
      /** Contagem 0 = zerar posição: não exige lote/validade (não há físico a rotular). */
      const qtdImp = Number(row.qtdContada);
      const zerandoEstoque = Number.isFinite(qtdImp) && qtdImp === 0;
      if (reqLote && !row.lote && !zerandoEstoque) {
        erros.push({
          linha: i + 2,
          codigo: row.codigoProduto,
          erro: 'Lote obrigatório.',
          row: { ...row },
          podeCadastrar: false,
        });
        continue;
      }
      if (reqVal && !row.validade && !zerandoEstoque) {
        const sug = await sugerirValidadeProduto(client, tenantId, inv.CD_DONO, prod.CD_PRODUTO);
        if (sug && sug.validade) {
          row = {
            ...row,
            validade: sug.validade,
            lote: row.lote || sug.lote || '',
            observacao:
              (row.observacao ? String(row.observacao) + ' | ' : '') +
              `Validade sugerida (${sug.fonte})`,
          };
        } else {
          erros.push({
            linha: i + 2,
            codigo: row.codigoProduto,
            erro: 'Validade obrigatória (sem histórico de NF/inventário para sugerir).',
            row: { ...row },
            podeCadastrar: false,
          });
          continue;
        }
      }
      const valNorm = normValidade(row.validade);
      if (valNorm === null) {
        erros.push({
          linha: i + 2,
          codigo: row.codigoProduto,
          erro: 'Validade inválida.',
          row: { ...row },
          podeCadastrar: false,
        });
        continue;
      }
      const cod = normCodigo(row.codigoProduto);
      const lote = row.lote || '';
      const val = valNorm || '';
      /** Preserva o snapshot da linha existente (gerado por gerarSnapshotInventario
       *  ou gerarListaCiclica) antes de remover a linha antiga. Sem isso, o
       *  status por linha (Fase 3b) compara contra zero e tudo vira DIVERGENTE. */
      const snapAtual = await client.query(
        `SELECT "QTD_SISTEMA_SNAPSHOT", "NU_RECONTAGENS"
           FROM "WMS_INVENTARIO_LINHA"
          WHERE "CD_INVENTARIO" = $1::integer
            AND LOWER(TRIM("CODIGO_PRODUTO")) = LOWER(TRIM($2::text))
            AND COALESCE(LOWER(TRIM("LOTE")), '') = COALESCE(LOWER(TRIM($3::text)), '')
            AND COALESCE(TRIM("VALIDADE"), '') = COALESCE(TRIM($4::text), '')
          LIMIT 1`,
        [cdInventario, cod, lote, val]
      );
      const snapPrev = snapAtual.rows[0] ? Number(snapAtual.rows[0].QTD_SISTEMA_SNAPSHOT) || 0 : 0;
      const recPrev = snapAtual.rows[0] ? Number(snapAtual.rows[0].NU_RECONTAGENS) || 0 : 0;
      await client.query(
        `DELETE FROM "WMS_INVENTARIO_LINHA"
          WHERE "CD_INVENTARIO" = $1::integer
            AND LOWER(TRIM("CODIGO_PRODUTO")) = LOWER(TRIM($2::text))
            AND COALESCE(LOWER(TRIM("LOTE")), '') = COALESCE(LOWER(TRIM($3::text)), '')
            AND COALESCE(TRIM("VALIDADE"), '') = COALESCE(TRIM($4::text), '')`,
        [cdInventario, cod, lote, val]
      );
      await client.query(
        `INSERT INTO "WMS_INVENTARIO_LINHA" (
           "CD_INVENTARIO", "CD_PRODUTO", "CODIGO_PRODUTO", "LOTE", "VALIDADE",
           "QTD_SISTEMA_SNAPSHOT", "QTD_CONTADA", "FATOR_CONVERSAO", "ORIGEM",
           "ENDERECO", "OBSERVACAO", "NU_RECONTAGENS"
         ) VALUES ($1::integer, $2::integer, $3, $4, $5, $6, $7, $8, 'IMPORT', $9, $10, $11)`,
        [
          cdInventario,
          prod.CD_PRODUTO,
          cod,
          row.lote || null,
          val || null,
          snapPrev,
          row.qtdContada,
          normFator(row.fatorConversao),
          row.endereco || null,
          row.observacao || null,
          recPrev,
        ]
      );
      ok++;
    }
    /** Recalcula ST_LINHA de tudo que não está em RECONTAR/APROVADO (decisão manual). */
    try {
      await recalcularStatusLinhasInventario(client, tenantId, cdInventario);
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
    await client.query(
      `UPDATE "WMS_INVENTARIO" SET "ST_INVENTARIO" = 'CONFERIDO', "SG_USER" = COALESCE($3, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId, sgUser]
    );
    await client.query('COMMIT');
    return { ok: { importadas: ok, erros } };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Marca uma linha para nova contagem (Fase 3b). Apaga QTD_CONTADA, incrementa
 * NU_RECONTAGENS e força ST_LINHA = RECONTAR (não recalculado até o operador
 * importar nova contagem para esta combinação produto+lote+validade).
 */
/**
 * Registra a contagem manual de uma única linha (edição inline na tabela
 * do detalhe). Atualiza `QTD_CONTADA`, recalcula `ST_LINHA` com base na
 * tolerância vigente e retorna `{ stLinha, qtdContada, divergencia }`.
 *
 * Diferenças vs. importarLinhasInventario:
 *  - Não cria linha nova (a linha já existe — exige `CD_LINHA`).
 *  - Não mexe em `QTD_SISTEMA_SNAPSHOT` (preserva o saldo do snapshot).
 *  - Se `qtdContada` for `null`/vazio, limpa a contagem e volta a `PENDENTE`.
 *  - Aceita `0` (perda total contada) — vira CONTADO ou DIVERGENTE.
 *
 * Linhas com `ST_LINHA = APROVADO` NÃO permitem edição direta (supervisor
 * precisa "Recontar" para destravar). RECONTAR aceita digitação normal e
 * volta o status para CONTADO/DIVERGENTE.
 */
async function registrarContagemLinha(tenantId, cdInventario, cdLinha, input, sgUser) {
  /** Compat: 4º arg pode ser só qtdContada (número) ou { qtdContada, lote, validade }. */
  let qtdContada;
  const extras = {};
  let alteraQtd = false;
  if (input != null && typeof input === 'object' && !Array.isArray(input)) {
    if (Object.prototype.hasOwnProperty.call(input, 'qtdContada')) {
      alteraQtd = true;
      qtdContada = input.qtdContada;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'lote')) extras.lote = input.lote;
    if (Object.prototype.hasOwnProperty.call(input, 'validade')) extras.validade = input.validade;
  } else {
    alteraQtd = true;
    qtdContada = input;
  }
  const alteraLoteVal =
    Object.prototype.hasOwnProperty.call(extras, 'lote') ||
    Object.prototype.hasOwnProperty.call(extras, 'validade');
  if (!alteraQtd && !alteraLoteVal) {
    return { err: 'Informe contagem e/ou lote/validade.', status: 400 };
  }

  /** Detecta colunas opcionais (Fase 3b). Mesmo se o cliente não tiver
   *  executado o script de status/tolerância, a edição inline da quantidade
   *  precisa funcionar (gravando apenas QTD_CONTADA). Sem isso, o operador
   *  recebia "Erro ao registrar contagem" sem saber o que fazer. */
  const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');
  const temFgRecontagem = temStLinha && (await hasColumn('WMS_INVENTARIO_LINHA', 'FG_RECONTAGEM'));
  const temSgAprovador = temStLinha && (await hasColumn('WMS_INVENTARIO_LINHA', 'SG_APROVADOR'));
  const temDhAprovacao = temStLinha && (await hasColumn('WMS_INVENTARIO_LINHA', 'DH_APROVACAO'));

  const client = await pool.connect();
  try {
    const sqlSelect = temStLinha
      ? `SELECT i."ST_INVENTARIO", l."ST_LINHA", l."FATOR_CONVERSAO", l."QTD_SISTEMA_SNAPSHOT",
                l."CD_PRODUTO", l."CODIGO_PRODUTO", l."LOTE", l."VALIDADE"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`
      : `SELECT i."ST_INVENTARIO", l."FATOR_CONVERSAO", l."QTD_SISTEMA_SNAPSHOT",
                l."CD_PRODUTO", l."CODIGO_PRODUTO", l."LOTE", l."VALIDADE"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`;
    const r = await client.query(sqlSelect, [cdLinha, cdInventario, tenantId]);
    if (!r.rows.length) return { err: 'Linha não encontrada.', status: 404 };
    const inv = r.rows[0];
    const stInv = String(inv.ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }
    const stLin = String(inv.ST_LINHA || '').toUpperCase();
    if (stLin === 'APROVADO') {
      return { err: 'Linha já aprovada por supervisor. Use "Recontar" para destravar.', status: 409 };
    }

    /** Aceita string ou número. Vazio/null = limpa contagem (volta a PENDENTE). */
    let valor = null;
    if (alteraQtd) {
      if (qtdContada !== null && qtdContada !== undefined && qtdContada !== '') {
        valor = Number(qtdContada);
        if (!Number.isFinite(valor) || valor < 0) {
          return { err: 'Quantidade contada deve ser número ≥ 0 (ou vazio para limpar).', status: 400 };
        }
      }
    }

    const tol = await obterToleranciaEfetiva(tenantId, cdInventario);
    let novoStatus = String(inv.ST_LINHA || 'PENDENTE').toUpperCase();
    if (alteraQtd) {
      novoStatus = 'PENDENTE';
      if (valor != null) {
        /** Placeholder — status definitivo após commit, consolidado por SKU. */
        novoStatus = calcularStatusLinha(
          { QTD_CONTADA: valor, FATOR_CONVERSAO: inv.FATOR_CONVERSAO, QTD_SISTEMA_SNAPSHOT: inv.QTD_SISTEMA_SNAPSHOT },
          tol
        );
      }
    }

    /** UPDATE adaptativo: monta SET apenas com colunas que existem no banco. */
    const sets = [];
    const params = [cdLinha];
    let p = 2;
    if (alteraQtd) {
      sets.push('"QTD_CONTADA" = $' + p);
      params.push(valor);
      p += 1;
      if (temStLinha) {
        sets.push('"ST_LINHA" = $' + p);
        params.push(novoStatus);
        p += 1;
      }
      if (temFgRecontagem) {
        sets.push('"FG_RECONTAGEM" = CASE WHEN "QTD_CONTADA" IS NULL THEN \'N\' ELSE "FG_RECONTAGEM" END');
      }
      if (temSgAprovador) sets.push('"SG_APROVADOR" = NULL');
      if (temDhAprovacao) sets.push('"DH_APROVACAO" = NULL');
    }

    let loteOut = inv.LOTE;
    let validadeOut = inv.VALIDADE;
    if (alteraLoteVal) {
      const resolv = resolverLoteValidadeEdicao(inv, extras);
      if (resolv.err) return { err: resolv.err, status: resolv.status };
      loteOut = resolv.lote;
      validadeOut = resolv.validade;
      const dup = await client.query(
        `SELECT "CD_LINHA" FROM "WMS_INVENTARIO_LINHA"
          WHERE "CD_INVENTARIO" = $1::integer
            AND "CD_LINHA" <> $2::integer
            AND COALESCE("CD_PRODUTO", -1) = COALESCE($3::integer, -1)
            AND COALESCE("LOTE", '') = COALESCE($4, '')
            AND COALESCE("VALIDADE"::text, '') = COALESCE($5, '')
          LIMIT 1`,
        [cdInventario, cdLinha, inv.CD_PRODUTO, loteOut, validadeOut]
      );
      if (dup.rowCount) {
        return {
          err:
            'Já existe outra linha para este produto com o mesmo lote/validade. ' +
            'Para juntar as contagens, exclua/recontagem uma delas ou ajuste para chave diferente.',
          status: 409,
        };
      }
      sets.push('"LOTE" = $' + p);
      params.push(loteOut);
      p += 1;
      sets.push('"VALIDADE" = $' + p);
      params.push(validadeOut);
      p += 1;
    }

    await client.query('BEGIN');
    await client.query(
      'UPDATE "WMS_INVENTARIO_LINHA" SET ' + sets.join(', ') + ' WHERE "CD_LINHA" = $1::integer',
      params
    );
    if (sgUser) {
      await client.query(
        `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer`,
        [cdInventario, sgUser]
      );
    }

    /** Consolida status do SKU inteiro (várias validades) vs ledger. */
    let divergencia = null;
    let sistemaSku = Number(inv.QTD_SISTEMA_SNAPSHOT) || 0;
    if (alteraQtd && temStLinha) {
      const rec = await recalcularStatusLinhasInventario(client, tenantId, cdInventario);
      void rec;
      const stR = await client.query(
        `SELECT "ST_LINHA" FROM "WMS_INVENTARIO_LINHA" WHERE "CD_LINHA" = $1::integer`,
        [cdLinha]
      );
      if (stR.rows[0]) novoStatus = String(stR.rows[0].ST_LINHA || novoStatus).toUpperCase();

      const grupoR = await client.query(
        `SELECT "CD_LINHA", "CD_PRODUTO", "CODIGO_PRODUTO", "QTD_CONTADA", "FATOR_CONVERSAO",
                "QTD_SISTEMA_SNAPSHOT", "ST_LINHA"
           FROM "WMS_INVENTARIO_LINHA"
          WHERE "CD_INVENTARIO" = $1::integer
            AND (
              ( $2::integer IS NOT NULL AND "CD_PRODUTO" = $2::integer )
              OR (
                $3::text IS NOT NULL AND $3::text <> ''
                AND REPLACE(REPLACE(UPPER(TRIM("CODIGO_PRODUTO")), '.', ''), ' ', '')
                  = REPLACE(REPLACE(UPPER(TRIM($3::text)), '.', ''), ' ', '')
              )
            )`,
        [cdInventario, inv.CD_PRODUTO, inv.CODIGO_PRODUTO || null]
      );
      let saldoLedger = new Map();
      try {
        const donoR = await client.query(
          `SELECT "CD_DONO" FROM "WMS_INVENTARIO"
            WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
          [cdInventario, tenantId]
        );
        if (donoR.rows[0]) {
          saldoLedger = await obterSaldoLedgerPorProdutoMap(tenantId, donoR.rows[0].CD_DONO);
        }
      } catch (e) {
        if (!schemaMissing(e)) throw e;
      }
      sistemaSku = sistemaReferenciaGrupoSku(grupoR.rows || [], saldoLedger);
      let soma = 0;
      for (const g of grupoR.rows || []) {
        if (g.QTD_CONTADA == null || g.QTD_CONTADA === '') continue;
        soma = Number((soma + Number(g.QTD_CONTADA) * normFator(g.FATOR_CONVERSAO)).toFixed(6));
      }
      if (valor != null) divergencia = Number((soma - sistemaSku).toFixed(6));
    } else if (valor != null) {
      divergencia = valor - sistemaSku * (Number(inv.FATOR_CONVERSAO) || 1);
    }

    await client.query('COMMIT');

    const ok = {
      stLinha: novoStatus,
      qtdContada: alteraQtd ? valor : undefined,
      divergencia,
      tolerancia: tol,
      sistemaSku,
    };
    if (alteraLoteVal) {
      ok.lote = loteOut;
      ok.validade = validadeOut;
    }
    return { ok };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Normaliza lote/validade vindos do payload de edição inline.
 * @returns {{ ok: true, lote: string|null, validade: string|null } | { err: string, status: number }}
 */
function resolverLoteValidadeEdicao(cur, payload) {
  let lote = cur.LOTE;
  if (Object.prototype.hasOwnProperty.call(payload, 'lote')) {
    const s = payload.lote == null ? '' : String(payload.lote).trim();
    lote = s ? s.slice(0, 60) : null;
  }
  let validade = cur.VALIDADE;
  if (Object.prototype.hasOwnProperty.call(payload, 'validade')) {
    const s = payload.validade == null ? '' : String(payload.validade).trim();
    if (!s) {
      validade = null;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const dt = new Date(s + 'T00:00:00Z');
      if (Number.isNaN(dt.getTime())) {
        return { err: 'Validade inválida — use AAAA-MM-DD (ex.: 2026-12-31).', status: 400 };
      }
      validade = s;
    } else {
      return { err: 'Validade inválida — use AAAA-MM-DD (ex.: 2026-12-31).', status: 400 };
    }
  }
  return { ok: true, lote, validade };
}

/**
 * Atualiza LOTE e/ou VALIDADE de uma linha existente (edição inline na tabela
 * do detalhe). Útil quando o operador conta um SKU em campo e descobre que o
 * snapshot trouxe lote/validade genéricos ou em branco — agora ele consegue
 * preencher direto.
 *
 * Regras:
 * - Inventário precisa estar EM_CONTAGEM/CONFERIDO (não ENCERRADO/CANCELADO).
 * - Linha APROVADO é bloqueada (usar Recontar).
 * - Valida formato de validade (YYYY-MM-DD). Vazio/null = limpa.
 * - Bloqueia se a combinação CD_PRODUTO+LOTE+VALIDADE virar igual à de outra
 *   linha (constraint de unicidade lógica — evita duplicar saldo no encerramento).
 * - Aceita `lote` e `validade` opcionais (parcial): só atualiza o que veio.
 */
async function atualizarLoteValidadeLinha(tenantId, cdInventario, cdLinha, payload, sgUser) {
  /** ST_LINHA é opcional (Fase 3b). Sem ele, ignoramos o bloqueio de
   *  "linha APROVADA" (não tem como saber esse status) e seguimos com o
   *  UPDATE só de LOTE/VALIDADE. Mantém a edição inline funcional no banco
   *  pré-3b. */
  const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');
  const client = await pool.connect();
  try {
    const sqlSelect = temStLinha
      ? `SELECT i."ST_INVENTARIO", l."ST_LINHA", l."CD_PRODUTO", l."LOTE", l."VALIDADE"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`
      : `SELECT i."ST_INVENTARIO", l."CD_PRODUTO", l."LOTE", l."VALIDADE"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`;
    const r = await client.query(sqlSelect, [cdLinha, cdInventario, tenantId]);
    if (!r.rows.length) return { err: 'Linha não encontrada.', status: 404 };
    const cur = r.rows[0];
    const stInv = String(cur.ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }
    if (String(cur.ST_LINHA || '').toUpperCase() === 'APROVADO') {
      return { err: 'Linha aprovada por supervisor. Use "Recontar" para destravar.', status: 409 };
    }

    const resolv = resolverLoteValidadeEdicao(cur, payload);
    if (resolv.err) return { err: resolv.err, status: resolv.status };
    const { lote, validade } = resolv;

    /** Conflito com outra linha do mesmo inventário/produto/lote/validade. */
    const dup = await client.query(
      `SELECT "CD_LINHA" FROM "WMS_INVENTARIO_LINHA"
        WHERE "CD_INVENTARIO" = $1::integer
          AND "CD_LINHA" <> $2::integer
          AND COALESCE("CD_PRODUTO", -1) = COALESCE($3::integer, -1)
          AND COALESCE("LOTE", '') = COALESCE($4, '')
          AND COALESCE("VALIDADE"::text, '') = COALESCE($5, '')
        LIMIT 1`,
      [cdInventario, cdLinha, cur.CD_PRODUTO, lote, validade]
    );
    if (dup.rowCount) {
      return {
        err:
          'Já existe outra linha para este produto com o mesmo lote/validade. ' +
          'Para juntar as contagens, exclua/recontagem uma delas ou ajuste para chave diferente.',
        status: 409,
      };
    }

    await client.query(
      `UPDATE "WMS_INVENTARIO_LINHA"
          SET "LOTE" = $2, "VALIDADE" = $3
        WHERE "CD_LINHA" = $1::integer`,
      [cdLinha, lote, validade]
    );
    if (sgUser) {
      await client.query(
        `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer`,
        [cdInventario, sgUser]
      );
    }
    return { ok: { lote, validade } };
  } catch (e) {
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Cria uma nova linha "irmã" da informada (mesmo CD_PRODUTO/CODIGO_PRODUTO),
 * mas com lote/validade diferentes. Caso de uso: durante a contagem física o
 * operador descobre que um SKU que entrou com validade fictícia (ex.:
 * 31/12/2026) na verdade tem múltiplos lotes/validades reais. Em vez de
 * importar tudo via CSV, ele "divide" a linha pelo botão na tabela.
 *
 * Regras:
 *  - Inventário precisa estar EM_CONTAGEM (não ENCERRADO/CANCELADO).
 *  - Bloqueia se a combinação produto+lote+validade já existe em outra linha
 *    do mesmo inventário (constraint lógica — evita duplicar saldo).
 *  - A nova linha herda CD_PRODUTO, CODIGO_PRODUTO e FATOR_CONVERSAO da
 *    linha base. QTD_SISTEMA_SNAPSHOT = 0 (não veio do snapshot do sistema).
 *  - Se `qtdContada` for informado, já registra a contagem e calcula
 *    ST_LINHA com a tolerância vigente.
 *  - ORIGEM = 'MANUAL_DIVIDIDA' para rastreabilidade.
 */
async function dividirLinhaInventario(tenantId, cdInventario, cdLinha, payload, sgUser) {
  const novoLote = payload.lote != null ? String(payload.lote).trim().slice(0, 60) || null : null;
  let novaValidade = null;
  if (payload.validade != null && String(payload.validade).trim() !== '') {
    const s = String(payload.validade).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { err: 'Validade inválida — use AAAA-MM-DD (ex.: 2026-12-31).', status: 400 };
    }
    novaValidade = s;
  }
  if (!novoLote && !novaValidade) {
    return { err: 'Informe ao menos lote OU validade diferentes da linha original.', status: 400 };
  }
  /** Quantidade contada na nova linha (opcional — pode ficar PENDENTE). */
  let qtdContada = null;
  if (payload.qtdContada != null && payload.qtdContada !== '') {
    qtdContada = Number(payload.qtdContada);
    if (!Number.isFinite(qtdContada) || qtdContada < 0) {
      return { err: 'Quantidade contada deve ser número ≥ 0 (ou vazio).', status: 400 };
    }
  }

  const client = await pool.connect();
  try {
    const base = await client.query(
      `SELECT i."ST_INVENTARIO", l."CD_PRODUTO", l."CODIGO_PRODUTO",
              l."FATOR_CONVERSAO", l."LOTE", l."VALIDADE"
         FROM "WMS_INVENTARIO_LINHA" l
         JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
        WHERE l."CD_LINHA" = $1::integer
          AND l."CD_INVENTARIO" = $2::integer
          AND i."TENANT_ID" = $3
        LIMIT 1`,
      [cdLinha, cdInventario, tenantId]
    );
    if (!base.rows.length) return { err: 'Linha de origem não encontrada.', status: 404 };
    const ln = base.rows[0];
    const stInv = String(ln.ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }

    /** Se um campo não foi informado, mantém o da linha base (o usuário só
     *  está trocando o que mudou). Pelo menos um precisa diferir — checamos
     *  novamente após o fallback. */
    const loteFinal = novoLote !== null ? novoLote : ln.LOTE;
    const validadeFinal = novaValidade !== null ? novaValidade : (ln.VALIDADE ? String(ln.VALIDADE).slice(0, 10) : null);
    const igualLote = String(loteFinal || '') === String(ln.LOTE || '');
    const igualValidade = String(validadeFinal || '') === String(ln.VALIDADE ? String(ln.VALIDADE).slice(0, 10) : '');
    if (igualLote && igualValidade) {
      return { err: 'A nova linha tem o mesmo lote e validade da original. Mude pelo menos um para dividir.', status: 400 };
    }

    /** Verifica conflito com outra linha do mesmo SKU/lote/validade. */
    const dup = await client.query(
      `SELECT "CD_LINHA" FROM "WMS_INVENTARIO_LINHA"
        WHERE "CD_INVENTARIO" = $1::integer
          AND COALESCE("CD_PRODUTO", -1) = COALESCE($2::integer, -1)
          AND COALESCE("LOTE", '') = COALESCE($3, '')
          AND COALESCE("VALIDADE"::text, '') = COALESCE($4, '')
        LIMIT 1`,
      [cdInventario, ln.CD_PRODUTO, loteFinal, validadeFinal]
    );
    if (dup.rowCount) {
      return {
        err: 'Já existe outra linha para este SKU com o mesmo lote/validade. Edite-a no lugar de criar duplicata.',
        status: 409,
      };
    }

    /** Status inicial: PENDENTE se sem contagem, ou calculado pela tolerância. */
    const tol = await obterToleranciaEfetiva(tenantId, cdInventario);
    let stLinha = 'PENDENTE';
    if (qtdContada != null) {
      stLinha = calcularStatusLinha(
        { QTD_CONTADA: qtdContada, FATOR_CONVERSAO: ln.FATOR_CONVERSAO, QTD_SISTEMA_SNAPSHOT: 0 },
        tol
      );
    }

    /** ST_LINHA é coluna da Fase 3b — pode não existir no banco do cliente
     *  se ele ainda não rodou `adicionar_status_recontagem_inventario_postgres.sql`.
     *  Se existir, incluímos no INSERT; senão, omitimos (a divisão continua
     *  funcionando, o status simplesmente fica como o default 'PENDENTE'
     *  via fallback em memória). Resolve o erro "Estrutura WMS incompleta"
     *  quando o cliente está só na Fase 3a. */
    const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');

    await client.query('BEGIN');
    /** Usa ORIGEM='MANUAL' (compatível com CHECK existente) e marca o
     *  "dividida da linha #X" no campo OBSERVACAO para rastreabilidade,
     *  sem precisar migrar o schema da constraint. */
    const sqlInsert = temStLinha
      ? `INSERT INTO "WMS_INVENTARIO_LINHA" (
           "CD_INVENTARIO", "CD_PRODUTO", "CODIGO_PRODUTO", "LOTE", "VALIDADE",
           "QTD_SISTEMA_SNAPSHOT", "QTD_CONTADA", "FATOR_CONVERSAO",
           "ORIGEM", "ST_LINHA", "OBSERVACAO"
         ) VALUES ($1::integer, $2::integer, $3, $4, $5, 0, $6, $7,
                   'MANUAL', $8, $9)
         RETURNING "CD_LINHA"`
      : `INSERT INTO "WMS_INVENTARIO_LINHA" (
           "CD_INVENTARIO", "CD_PRODUTO", "CODIGO_PRODUTO", "LOTE", "VALIDADE",
           "QTD_SISTEMA_SNAPSHOT", "QTD_CONTADA", "FATOR_CONVERSAO",
           "ORIGEM", "OBSERVACAO"
         ) VALUES ($1::integer, $2::integer, $3, $4, $5, 0, $6, $7,
                   'MANUAL', $8)
         RETURNING "CD_LINHA"`;
    const paramsInsert = temStLinha
      ? [
          cdInventario,
          ln.CD_PRODUTO,
          ln.CODIGO_PRODUTO,
          loteFinal || null,
          validadeFinal || null,
          qtdContada,
          ln.FATOR_CONVERSAO || 1,
          stLinha,
          ('DIVIDIDA da linha #' + cdLinha + (sgUser ? ' por ' + sgUser : '')).slice(0, 255),
        ]
      : [
          cdInventario,
          ln.CD_PRODUTO,
          ln.CODIGO_PRODUTO,
          loteFinal || null,
          validadeFinal || null,
          qtdContada,
          ln.FATOR_CONVERSAO || 1,
          ('DIVIDIDA da linha #' + cdLinha + (sgUser ? ' por ' + sgUser : '')).slice(0, 255),
        ];
    const ins = await client.query(sqlInsert, paramsInsert);
    if (sgUser) {
      await client.query(
        `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer`,
        [cdInventario, sgUser]
      );
    }
    await client.query('COMMIT');
    return {
      ok: {
        CD_LINHA: ins.rows[0].CD_LINHA,
        LOTE: loteFinal || null,
        VALIDADE: validadeFinal || null,
        QTD_CONTADA: qtdContada,
        ST_LINHA: temStLinha ? stLinha : 'PENDENTE',
      },
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

async function marcarLinhaRecontagem(tenantId, cdInventario, cdLinha, sgUser) {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT i."ST_INVENTARIO", l."ST_LINHA"
         FROM "WMS_INVENTARIO_LINHA" l
         JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
        WHERE l."CD_LINHA" = $1::integer
          AND l."CD_INVENTARIO" = $2::integer
          AND i."TENANT_ID" = $3
        LIMIT 1`,
      [cdLinha, cdInventario, tenantId]
    );
    if (!r.rows.length) return { err: 'Linha não encontrada.', status: 404 };
    const st = String(r.rows[0].ST_INVENTARIO).toUpperCase();
    if (st === 'ENCERRADO' || st === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE "WMS_INVENTARIO_LINHA"
          SET "QTD_CONTADA" = NULL,
              "ST_LINHA" = 'RECONTAR',
              "FG_RECONTAGEM" = 'S',
              "NU_RECONTAGENS" = COALESCE("NU_RECONTAGENS", 0) + 1,
              "SG_APROVADOR" = NULL,
              "DH_APROVACAO" = NULL
        WHERE "CD_LINHA" = $1::integer`,
      [cdLinha]
    );
    await client.query(
      `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer`,
      [cdInventario, sgUser]
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Supervisor aprova explicitamente uma linha divergente (Fase 3b). Ajuste será
 * gerado normalmente no encerramento, mas a linha não bloqueia mais o encerrar.
 */
async function aprovarLinhaSupervisor(tenantId, cdInventario, cdLinha, sgUser) {
  if (!sgUser) return { err: 'SG do supervisor obrigatório.', status: 400 };
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT i."ST_INVENTARIO", l."ST_LINHA"
         FROM "WMS_INVENTARIO_LINHA" l
         JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
        WHERE l."CD_LINHA" = $1::integer
          AND l."CD_INVENTARIO" = $2::integer
          AND i."TENANT_ID" = $3
        LIMIT 1`,
      [cdLinha, cdInventario, tenantId]
    );
    if (!r.rows.length) return { err: 'Linha não encontrada.', status: 404 };
    const stInv = String(r.rows[0].ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }
    const stLin = String(r.rows[0].ST_LINHA).toUpperCase();
    if (stLin !== 'DIVERGENTE' && stLin !== 'CONTADO') {
      return { err: `Apenas linhas DIVERGENTE/CONTADO podem ser aprovadas (status atual: ${stLin}).`, status: 409 };
    }
    await client.query(
      `UPDATE "WMS_INVENTARIO_LINHA"
          SET "ST_LINHA" = 'APROVADO',
              "SG_APROVADOR" = $2,
              "DH_APROVACAO" = CURRENT_TIMESTAMP
        WHERE "CD_LINHA" = $1::integer`,
      [cdLinha, sgUser.slice(0, 64)]
    );
    return { ok: true };
  } catch (e) {
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/** Define a tolerância (%) do inventário e recalcula status das linhas. */
async function definirToleranciaInventario(tenantId, cdInventario, pct, sgUser) {
  const valor = pct == null || pct === '' ? null : Number(pct);
  if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) {
    return { err: 'Tolerância deve ser número entre 0 e 100 (em %), ou vazio para usar default do dono.', status: 400 };
  }
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT "ST_INVENTARIO" FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId]
    );
    if (!r.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
    const st = String(r.rows[0].ST_INVENTARIO).toUpperCase();
    if (st === 'ENCERRADO' || st === 'CANCELADO') {
      return { err: 'Inventário não permite alteração.', status: 409 };
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE "WMS_INVENTARIO"
          SET "PCT_TOLERANCIA" = $2,
              "SG_USER" = COALESCE($3, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer`,
      [cdInventario, valor, sgUser]
    );
    const rec = await recalcularStatusLinhasInventario(client, tenantId, cdInventario);
    await client.query('COMMIT');
    return { ok: { tolerancia: valor, recalculadas: rec.alterados } };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Grava saldo físico por lote/validade declarado na contagem (Posição / Datas críticas).
 * Substitui linhas anteriores dos SKUs tocados neste inventário.
 */
async function persistirSaldoLoteInventario(client, tenantId, cdInventario, cdDono, sgUser) {
  const lr = await client.query(
    `SELECT l."CD_LINHA", l."CD_PRODUTO", l."LOTE", l."VALIDADE", l."QTD_CONTADA", l."FATOR_CONVERSAO", l."ST_LINHA"
       FROM "WMS_INVENTARIO_LINHA" l
      WHERE l."CD_INVENTARIO" = $1::integer
        AND l."QTD_CONTADA" IS NOT NULL
        AND UPPER(TRIM(COALESCE(l."ST_LINHA", ''))) IN ('CONTADO', 'APROVADO')`,
    [cdInventario]
  );
  const linhasOk = (lr.rows || []).filter((ln) => {
    const q = Number(ln.QTD_CONTADA) * normFator(ln.FATOR_CONVERSAO);
    return Number.isFinite(q) && q > 1e-9;
  });
  if (!linhasOk.length) return { linhas: 0 };

  const prods = [
    ...new Set(
      linhasOk
        .map((ln) => parseInt(ln.CD_PRODUTO, 10))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (!prods.length) return { linhas: 0 };

  await client.query(
    `DELETE FROM "WMS_INVENTARIO_SALDO_LOTE"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" = $2::integer
        AND "CD_PRODUTO" = ANY($3::integer[])`,
    [tenantId, cdDono, prods]
  );

  let n = 0;
  for (const ln of linhasOk) {
    const cdProd = parseInt(ln.CD_PRODUTO, 10);
    if (!Number.isFinite(cdProd)) continue;
    const qtd = Number((Number(ln.QTD_CONTADA) * normFator(ln.FATOR_CONVERSAO)).toFixed(6));
    const lote = normLote(ln.LOTE) || null;
    const val = normValidade(ln.VALIDADE) || null;
    const ins = await client.query(
      `INSERT INTO "WMS_INVENTARIO_SALDO_LOTE"
        ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "LOTE", "VALIDADE", "QTD",
         "REF_CD_INVENTARIO", "REF_CD_LINHA", "SG_USER")
       VALUES ($1, $2::integer, $3::integer, $4, $5::date, $6::numeric, $7::integer, $8::integer, $9)
       ON CONFLICT ("TENANT_ID", "CD_DONO", "CD_PRODUTO", COALESCE("LOTE", ''), COALESCE("VALIDADE", DATE '1970-01-01'))
       DO UPDATE SET
         "QTD" = EXCLUDED."QTD",
         "REF_CD_INVENTARIO" = EXCLUDED."REF_CD_INVENTARIO",
         "REF_CD_LINHA" = EXCLUDED."REF_CD_LINHA",
         "DH_REGISTRO" = CURRENT_TIMESTAMP,
         "SG_USER" = EXCLUDED."SG_USER"`,
      [tenantId, cdDono, cdProd, lote, val, qtd, cdInventario, ln.CD_LINHA, sgUser]
    );
    n += ins.rowCount || 0;
  }
  return { linhas: n };
}

/** Republica saldo lote/validade de inventário já encerrado (backfill / correção). */
async function republicarSaldoLoteInventarioEncerrado(tenantId, cdInventario, sgUser) {
  const r = await pool.query(
    `SELECT "CD_DONO", "ST_INVENTARIO" FROM "WMS_INVENTARIO"
      WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
    [cdInventario, tenantId]
  );
  if (!r.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
  if (String(r.rows[0].ST_INVENTARIO).toUpperCase() !== 'ENCERRADO') {
    return { err: 'Só inventários ENCERRADOS podem ser republicados.', status: 409 };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await persistirSaldoLoteInventario(
      client,
      tenantId,
      cdInventario,
      r.rows[0].CD_DONO,
      sgUser
    );
    await client.query('COMMIT');
    return { ok: out };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return {
        err: 'Estrutura WMS_INVENTARIO_SALDO_LOTE ausente. Execute backend/scripts/adicionar_wms_inventario_saldo_lote_postgres.sql.',
        status: 503,
      };
    }
    throw e;
  } finally {
    client.release();
  }
}

async function encerrarInventario(tenantId, cdInventario, sgUser) {
  const det = await obterInventarioDetalhe(tenantId, cdInventario);
  if (!det) return { err: 'Inventário não encontrado.', status: 404 };
  const cab = det.cabecalho;
  const st = String(cab.ST_INVENTARIO).toUpperCase();
  if (st === 'ENCERRADO') return { err: 'Inventário já encerrado.', status: 409 };
  if (st === 'CANCELADO') return { err: 'Inventário cancelado.', status: 409 };
  /** Fase 3b: em inventário CICLICO, exige que todas as linhas estejam resolvidas
   *  antes do encerramento. DIVERGENTE precisa decisão (RECONTAR ou APROVADO);
   *  RECONTAR precisa nova contagem (CSV reimportado); PENDENTE precisa contagem.
   *  Para GERAL/INICIAL não bloqueamos (compat. com fluxo atual). */
  if (String(cab.TP_INVENTARIO).toUpperCase() === 'CICLICO') {
    const c = det.contadoresStatus || {};
    const bloqueio = [];
    if (c.PENDENTE) bloqueio.push(`${c.PENDENTE} pendente(s)`);
    if (c.DIVERGENTE) bloqueio.push(`${c.DIVERGENTE} divergente(s) sem decisão`);
    if (c.RECONTAR) bloqueio.push(`${c.RECONTAR} aguardando recontagem`);
    if (bloqueio.length) {
      return {
        err:
          'Inventário cíclico tem linhas não resolvidas: ' +
          bloqueio.join(', ') +
          '. Importe nova contagem, marque "Aprovar" (supervisor) ou "Recontar".',
        status: 409,
      };
    }
  }
  const resumo = det.resumoSku || [];
  const temAjusteSku = resumo.some((row) => Math.abs(Number(row.QTD_AJUSTE_SKU) || 0) > 1e-9);
  const temContagemFisica = (det.linhas || []).some((ln) => {
    const stLin = String(ln.ST_LINHA || '').toUpperCase();
    if (!['CONTADO', 'APROVADO'].includes(stLin)) return false;
    if (ln.QTD_CONTADA == null || ln.QTD_CONTADA === '') return false;
    const q = Number(ln.QTD_CONTADA) * normFator(ln.FATOR_CONVERSAO);
    return Number.isFinite(q) && q > 1e-9;
  });
  if (!temAjusteSku && !temContagemFisica) {
    return {
      err: 'Nenhum ajuste ou contagem física a aplicar. Importe a contagem ou revise a política de itens não contados.',
      status: 400,
    };
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT "ST_INVENTARIO" FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2 FOR UPDATE`,
      [cdInventario, tenantId]
    );
    if (!lock.rows.length) {
      await client.query('ROLLBACK');
      return { err: 'Inventário não encontrado.', status: 404 };
    }
    /** Garante que ST_LINHA esteja coerente com QTD_CONTADA antes de fechar
     *  (corrige inventários antigos que ficaram com PENDENTE indevidamente). */
    try {
      await recalcularStatusLinhasInventario(client, tenantId, cdInventario);
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
    let movimentos = 0;
    for (const row of resumo) {
      const qtd = Number(row.QTD_AJUSTE_SKU);
      if (!Number.isFinite(qtd) || Math.abs(qtd) < 1e-9) continue;
      const key = `INV_AJUSTE|I${cdInventario}|P${row.CD_PRODUTO}`.slice(0, 128);
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'INVENTARIO_AJUSTE', $5, $6)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
        [tenantId, cab.CD_DONO, row.CD_PRODUTO, qtd, key, sgUser]
      );
      movimentos += ins.rowCount || 0;
    }
    let saldoLote = { linhas: 0 };
    try {
      saldoLote = await persistirSaldoLoteInventario(
        client,
        tenantId,
        cdInventario,
        cab.CD_DONO,
        sgUser
      );
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
    await client.query(
      `UPDATE "WMS_INVENTARIO"
          SET "ST_INVENTARIO" = 'ENCERRADO', "DH_ENCERRAMENTO" = CURRENT_TIMESTAMP, "SG_USER" = COALESCE($3, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId, sgUser]
    );
    await client.query('COMMIT');
    return { ok: { movimentos, saldoLote, resumo } };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: 'Estrutura WMS incompleta (inventário ou movimento).', status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

async function cancelarInventario(tenantId, cdInventario, sgUser) {
  const r = await pool.query(
    `UPDATE "WMS_INVENTARIO"
        SET "ST_INVENTARIO" = 'CANCELADO', "SG_USER" = COALESCE($3, "SG_USER")
      WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2
        AND "ST_INVENTARIO" NOT IN ('ENCERRADO', 'CANCELADO')
      RETURNING "CD_INVENTARIO"`,
    [cdInventario, tenantId, sgUser]
  );
  if (!r.rowCount) return { err: 'Inventário não encontrado ou já finalizado.', status: 409 };
  return { ok: true };
}

/**
 * Reabre inventário:
 *  - CANCELADO → EM_CONTAGEM (sem mexer no ledger)
 *  - ENCERRADO → estorna INVENTARIO_AJUSTE deste doc, libera as chaves de
 *    idempotência para um novo encerramento, e volta a EM_CONTAGEM
 *
 * Motivo: encerramento indevido (ex.: contagem 0 aprovada) precisa desfazer
 * o saldo sem apagar o histórico — os estornos ficam no ledger.
 */
async function reativarInventario(tenantId, cdInventario, sgUser) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT "CD_INVENTARIO", "CD_DONO", "TP_INVENTARIO", "ST_INVENTARIO"
         FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2
        FOR UPDATE`,
      [cdInventario, tenantId]
    );
    if (!lock.rows.length) {
      await client.query('ROLLBACK');
      return { err: 'Inventário não encontrado.', status: 404 };
    }
    const cab = lock.rows[0];
    const st = String(cab.ST_INVENTARIO || '').toUpperCase();

    if (st === 'CANCELADO') {
      await client.query(
        `UPDATE "WMS_INVENTARIO"
            SET "ST_INVENTARIO" = 'EM_CONTAGEM',
                "DH_ENCERRAMENTO" = NULL,
                "SG_USER" = COALESCE($3, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
        [cdInventario, tenantId, sgUser]
      );
      await client.query('COMMIT');
      return {
        ok: {
          CD_INVENTARIO: cab.CD_INVENTARIO,
          TP_INVENTARIO: cab.TP_INVENTARIO,
          modo: 'CANCELADO',
          estornos: 0,
        },
      };
    }

    if (st !== 'ENCERRADO') {
      await client.query('ROLLBACK');
      return {
        err: 'Só é possível reabrir inventários CANCELADOS ou ENCERRADOS. Status atual: ' + st + '.',
        status: 409,
      };
    }

    const movs = await client.query(
      `SELECT "CD_MOVIMENTO", "CD_PRODUTO", "QTD", "IDEMPOTENCY_KEY"
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "TP_MOVIMENTO" = 'INVENTARIO_AJUSTE'
          AND "IDEMPOTENCY_KEY" LIKE $3`,
      [tenantId, cab.CD_DONO, `INV_AJUSTE|I${cdInventario}|%`]
    );

    let estornos = 0;
    for (const m of movs.rows) {
      const qtdOrig = Number(m.QTD);
      if (!Number.isFinite(qtdOrig) || Math.abs(qtdOrig) < 1e-9) continue;
      const qtdEstorno = -qtdOrig;
      const keyEstorno = `INV_ESTORNO_REABERTURA|I${cdInventario}|P${m.CD_PRODUTO}|M${m.CD_MOVIMENTO}`.slice(
        0,
        128
      );
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
           ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'INVENTARIO_AJUSTE', $5, $6)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING
         RETURNING "CD_MOVIMENTO"`,
        [tenantId, cab.CD_DONO, m.CD_PRODUTO, qtdEstorno, keyEstorno, sgUser]
      );
      if (ins.rowCount) estornos += 1;

      /** Libera a chave original para o próximo encerramento poder gravar de novo. */
      const keyAnulada = `INV_AJUSTE_REABERTO|I${cdInventario}|P${m.CD_PRODUTO}|M${m.CD_MOVIMENTO}`.slice(
        0,
        128
      );
      await client.query(
        `UPDATE "WMS_MOVIMENTO_ESTOQUE"
            SET "IDEMPOTENCY_KEY" = $3
          WHERE "TENANT_ID" = $1 AND "CD_MOVIMENTO" = $2::bigint
            AND "IDEMPOTENCY_KEY" = $4`,
        [tenantId, m.CD_MOVIMENTO, keyAnulada, m.IDEMPOTENCY_KEY]
      );
    }

    /** Remove saldo_lote gerado por este inventário (se houver). */
    try {
      await client.query(
        `DELETE FROM "WMS_INVENTARIO_SALDO_LOTE"
          WHERE "TENANT_ID" = $1 AND "REF_CD_INVENTARIO" = $2::integer`,
        [tenantId, cdInventario]
      );
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }

    await client.query(
      `UPDATE "WMS_INVENTARIO"
          SET "ST_INVENTARIO" = 'EM_CONTAGEM',
              "DH_ENCERRAMENTO" = NULL,
              "SG_USER" = COALESCE($3, "SG_USER")
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2`,
      [cdInventario, tenantId, sgUser]
    );

    await client.query('COMMIT');
    return {
      ok: {
        CD_INVENTARIO: cab.CD_INVENTARIO,
        TP_INVENTARIO: cab.TP_INVENTARIO,
        modo: 'ENCERRADO',
        estornos,
        ajustesOriginais: movs.rows.length,
      },
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return { err: 'Estrutura WMS incompleta para reabrir inventário.', status: 503 };
    }
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Adiciona uma linha NOVA a um inventário existente (manual, fora do
 * snapshot/CSV). Útil quando o operador encontra um SKU em campo que NÃO
 * estava na lista do cíclico ou no snapshot — em vez de criar outro
 * inventário, ele insere a linha no aberto.
 *
 * Regras:
 *  - Inventário precisa estar EM_CONTAGEM ou REVISAO (não ENCERRADO/CANCELADO).
 *  - Produto precisa estar cadastrado no dono (`WMS_PRODUTO_DONO`), com
 *    qualquer forma do código (com/sem máscara) que o resolvedor aceita.
 *  - Lote/Validade opcionais. Se já existir linha com mesma chave SKU+LOTE+
 *    VALIDADE no inventário, retorna erro de duplicidade (use editar/dividir).
 *  - Aceita `qtdContada` opcional — se vazia, linha fica PENDENTE.
 *  - `QTD_SISTEMA_SNAPSHOT` = saldo atual do SKU no ledger, se for a primeira
 *    linha deste produto no inventário; senão 0 (mesma regra do cíclico).
 *  - ORIGEM = 'MANUAL' e OBSERVACAO marca quem adicionou manualmente.
 */
async function adicionarLinhaManualInventario(tenantId, cdInventario, payload, sgUser) {
  const codigo = String(payload.codigoProduto || '').trim();
  if (!codigo) return { err: 'Informe o código do produto.', status: 400 };

  const loteRaw = payload.lote != null ? String(payload.lote).trim().slice(0, 60) || null : null;
  let lote = loteRaw;
  let validade = null;
  if (payload.validade != null && String(payload.validade).trim() !== '') {
    const s = String(payload.validade).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return { err: 'Validade inválida — use AAAA-MM-DD (ex.: 2026-12-31).', status: 400 };
    }
    validade = s;
  }

  let qtdContada = null;
  if (payload.qtdContada != null && payload.qtdContada !== '') {
    qtdContada = Number(payload.qtdContada);
    if (!Number.isFinite(qtdContada) || qtdContada < 0) {
      return { err: 'Quantidade contada deve ser número ≥ 0 (ou vazio).', status: 400 };
    }
  }

  /** ST_LINHA é coluna opcional (Fase 3b). Sem ela, omitimos do INSERT. */
  const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');

  const client = await pool.connect();
  try {
    /** Cabeçalho — pega CD_DONO + ST_INVENTARIO + checagem de tenant. */
    const cab = await client.query(
      `SELECT "CD_INVENTARIO", "CD_DONO", "ST_INVENTARIO"
         FROM "WMS_INVENTARIO"
        WHERE "CD_INVENTARIO" = $1::integer AND "TENANT_ID" = $2
        LIMIT 1`,
      [cdInventario, tenantId]
    );
    if (!cab.rows.length) return { err: 'Inventário não encontrado.', status: 404 };
    const stInv = String(cab.rows[0].ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return { err: 'Inventário em ' + stInv + ' — não permite adicionar linhas.', status: 409 };
    }
    const cdDono = cab.rows[0].CD_DONO;

    /** Resolve o produto no cadastro do dono (aceita código com ou sem
     *  máscara/zeros). Sem cadastro → erro claro instruindo a cadastrar
     *  primeiro em "Cadastros WMS → Produtos do dono". */
    const prod = await mapCodigoParaProduto(client, tenantId, cdDono, codigo);
    if (!prod) {
      return {
        err:
          'Produto "' + codigo + '" não está cadastrado para este dono. ' +
          'Cadastre em "Cadastros WMS → Produtos do dono" e tente novamente.',
        status: 404,
      };
    }

    /** Mesma regra do CSV: se validade vazia, sugere a mais curta (saldo/NF)
     *  *antes* do anti-duplicidade — evita criar linha sem data e outra sugerida. */
    let obsExtra = '';
    if (!validade) {
      const sug = await sugerirValidadeProduto(client, tenantId, cdDono, prod.CD_PRODUTO);
      if (sug && sug.validade) {
        validade = sug.validade;
        if (!lote && sug.lote) lote = String(sug.lote).trim().slice(0, 60) || null;
        obsExtra = ` | Validade sugerida (${sug.fonte})`;
      }
    }

    /** Anti-duplicidade: mesma combinação SKU+LOTE+VALIDADE no inventário
     *  significa que o operador deveria editar a linha existente em vez de
     *  criar outra. */
    const dup = await client.query(
      `SELECT "CD_LINHA" FROM "WMS_INVENTARIO_LINHA"
        WHERE "CD_INVENTARIO" = $1::integer
          AND COALESCE("CD_PRODUTO", -1) = COALESCE($2::integer, -1)
          AND COALESCE("LOTE", '') = COALESCE($3, '')
          AND COALESCE("VALIDADE"::text, '') = COALESCE($4, '')
        LIMIT 1`,
      [cdInventario, prod.CD_PRODUTO, lote, validade]
    );
    if (dup.rowCount) {
      return {
        err:
          'Já existe linha para este SKU/lote/validade no inventário (linha #' +
          dup.rows[0].CD_LINHA + '). Edite-a no lugar de criar duplicata.',
        status: 409,
      };
    }

    const qtdSistema = await qtdSistemaSnapshotNovaLinhaSku(
      tenantId,
      cdDono,
      cdInventario,
      prod.CD_PRODUTO,
      client
    );

    /** Calcula ST_LINHA se a coluna existe e há quantidade. Sem contagem,
     *  vira PENDENTE para o supervisor acompanhar. */
    let stLinha = 'PENDENTE';
    if (temStLinha && qtdContada != null) {
      const tol = await obterToleranciaEfetiva(tenantId, cdInventario);
      stLinha = calcularStatusLinha(
        { QTD_CONTADA: qtdContada, FATOR_CONVERSAO: 1, QTD_SISTEMA_SNAPSHOT: qtdSistema },
        tol
      );
    }

    await client.query('BEGIN');
    const colunas = [
      '"CD_INVENTARIO"', '"CD_PRODUTO"', '"CODIGO_PRODUTO"',
      '"LOTE"', '"VALIDADE"',
      '"QTD_SISTEMA_SNAPSHOT"', '"QTD_CONTADA"', '"FATOR_CONVERSAO"',
      '"ORIGEM"', '"OBSERVACAO"',
    ];
    const valores = ['$1::integer', '$2::integer', '$3', '$4', '$5', '$6', '$7', '1', "'MANUAL'", '$8'];
    const params = [
      cdInventario,
      prod.CD_PRODUTO,
      prod.CODIGO || codigo,
      lote,
      validade,
      qtdSistema,
      qtdContada,
      ('ADICIONADA MANUAL' + (sgUser ? ' por ' + sgUser : '') + obsExtra).slice(0, 255),
    ];
    if (temStLinha) {
      colunas.push('"ST_LINHA"');
      valores.push('$9');
      params.push(stLinha);
    }
    const ins = await client.query(
      'INSERT INTO "WMS_INVENTARIO_LINHA" (' + colunas.join(', ') + ') VALUES (' + valores.join(', ') + ') RETURNING "CD_LINHA"',
      params
    );
    if (sgUser) {
      await client.query(
        `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer`,
        [cdInventario, sgUser]
      );
    }
    await client.query('COMMIT');

    return {
      ok: {
        CD_LINHA: ins.rows[0].CD_LINHA,
        CD_PRODUTO: prod.CD_PRODUTO,
        CODIGO_PRODUTO: prod.CODIGO,
        NOME: prod.NOME,
        LOTE: lote,
        VALIDADE: validade,
        QTD_SISTEMA_SNAPSHOT: qtdSistema,
        QTD_CONTADA: qtdContada,
        ST_LINHA: stLinha,
      },
    };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Exclui uma linha do inventário. Útil para descartar "linhas-fantasma"
 * (ex.: linha cíclica do snapshot com validade fictícia que ficou sem
 * contagem após o operador subdividir em múltiplas validades reais).
 *
 * Regras de segurança:
 *  - Inventário NÃO pode estar ENCERRADO ou CANCELADO (já saiu da janela
 *    operacional).
 *  - Linha NÃO pode estar APROVADA por supervisor (ele já validou; quem
 *    quer remover precisa primeiro "Recontar" para destravar).
 *  - Linha DEVE pertencer ao inventário/tenant informado (isolamento SaaS).
 *  - Mantém auditoria via SG_USER no cabeçalho.
 *
 * Não há soft-delete (não temos coluna FGACTIVE em WMS_INVENTARIO_LINHA),
 * mas como o inventário ainda não foi encerrado o impacto é zero — a
 * linha apenas some da lista e o resumo se reconfigura.
 */
async function excluirLinhaInventario(tenantId, cdInventario, cdLinha, sgUser) {
  /** ST_LINHA é opcional (Fase 3b). Sem ela, ignoramos a checagem "linha
   *  APROVADA" (não há como saber esse status). */
  const temStLinha = await hasColumn('WMS_INVENTARIO_LINHA', 'ST_LINHA');
  const client = await pool.connect();
  try {
    const sqlSelect = temStLinha
      ? `SELECT i."ST_INVENTARIO", l."ST_LINHA", l."CODIGO_PRODUTO",
                l."LOTE", l."VALIDADE", l."QTD_CONTADA"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`
      : `SELECT i."ST_INVENTARIO", l."CODIGO_PRODUTO",
                l."LOTE", l."VALIDADE", l."QTD_CONTADA"
           FROM "WMS_INVENTARIO_LINHA" l
           JOIN "WMS_INVENTARIO" i ON i."CD_INVENTARIO" = l."CD_INVENTARIO"
          WHERE l."CD_LINHA" = $1::integer
            AND l."CD_INVENTARIO" = $2::integer
            AND i."TENANT_ID" = $3
          LIMIT 1`;
    const r = await client.query(sqlSelect, [cdLinha, cdInventario, tenantId]);
    if (!r.rows.length) return { err: 'Linha não encontrada.', status: 404 };

    const cur = r.rows[0];
    const stInv = String(cur.ST_INVENTARIO).toUpperCase();
    if (stInv === 'ENCERRADO' || stInv === 'CANCELADO') {
      return {
        err: 'Inventário em ' + stInv + ' — não permite excluir linhas. Para alterações, reative-o antes.',
        status: 409,
      };
    }
    const stLin = String(cur.ST_LINHA || '').toUpperCase();
    if (stLin === 'APROVADO') {
      return {
        err: 'Linha já aprovada por supervisor. Use "Recontar" para destravar antes de excluir.',
        status: 409,
      };
    }

    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM "WMS_INVENTARIO_LINHA"
        WHERE "CD_LINHA" = $1::integer
          AND "CD_INVENTARIO" = $2::integer`,
      [cdLinha, cdInventario]
    );
    if (sgUser) {
      await client.query(
        `UPDATE "WMS_INVENTARIO" SET "SG_USER" = COALESCE($2, "SG_USER")
          WHERE "CD_INVENTARIO" = $1::integer`,
        [cdInventario, sgUser]
      );
    }
    await client.query('COMMIT');

    return {
      ok: {
        removidas: del.rowCount,
        CD_LINHA: cdLinha,
        CODIGO_PRODUTO: cur.CODIGO_PRODUTO,
        tinhaContagem: cur.QTD_CONTADA != null,
      },
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) return { err: MSG_FASE_3B_AUSENTE, status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  parseCsvInventario,
  consultarItensInventario,
  listarInventarios,
  obterInventarioDetalhe,
  criarInventario,
  gerarSnapshotInventario,
  gerarListaCiclica,
  criarInventarioCiclicoComLista,
  importarLinhasInventario,
  registrarContagemLinha,
  atualizarLoteValidadeLinha,
  dividirLinhaInventario,
  excluirLinhaInventario,
  adicionarLinhaManualInventario,
  sugerirValidadeInventario,
  sugerirValidadeProduto,
  marcarLinhaRecontagem,
  aprovarLinhaSupervisor,
  definirToleranciaInventario,
  encerrarInventario,
  republicarSaldoLoteInventarioEncerrado,
  cancelarInventario,
  reativarInventario,
  linhaChave,
};
