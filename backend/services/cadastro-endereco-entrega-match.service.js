'use strict';

const {
  buildChaveImport,
  normalizeNumeroEntregaMatch,
} = require('./cadastro-endereco-entrega-import.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');

/** Expressão SQL: número de entrega normalizado (tabela CADASTRO_ENDERECO_ENTREGA alias e). */
const SQL_NUMERO_ENTREGA_NORM = `COALESCE(NULLIF(regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        upper(regexp_replace(trim(coalesce(e."NUMERO", '')), '[[:space:]]+', '', 'g')),
        '^(S/N|SN|-|\\.)$', 'SN', 'i'
      ),
      '^N\\.', '', 'i'
    ),
    '^N[°º]', '', 'i'
  ),
  '[^A-Z0-9]', '', 'g'
), ''), 'SN')`;

const SQL_CGCCPF_14 = `right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14)`;

const SQL_DS_PONTO_NORM = `regexp_replace(
  upper(
    translate(
      trim(coalesce(e."DS_PONTO_ENTREGA", '')),
      'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝŸàáâãäåæçèéêëìíîïðñòóôõöøùúûüýÿ',
      'AAAAAAACEEEEIIIIDNOOOOOOUUUUYYaaaaaaaceeeeiiiidnoooooouuuuyy'
    )
  ),
  '[^A-Z0-9]', '', 'g'
)`;

function cnpj14Pad(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!d) return '';
  return d.length > 14 ? d.slice(-14) : d.padStart(14, '0');
}

function cepDigitos8(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d ? d.slice(0, 8) : '';
}

function normLogradouroSqlCompare(col) {
  return `regexp_replace(upper(trim(coalesce(${col}, ''))), '[^A-Z0-9]', '', 'g')`;
}

/** Nome do ponto sem pontuação/espaços (NF × cadastro). */
function normNomePontoMatch(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Vários pontos no mesmo endereço físico: escolhe pelo nome da NF (DS_PONTO_ENTREGA).
 * @returns {object[]|null} uma linha, ou null se continuar ambíguo
 */
function disambiguarPorNomePonto(rows, dsPonto) {
  if (!rows || rows.length <= 1) return rows;
  const want = String(dsPonto || '').trim();
  if (!want) return rows;
  const wantUp = want.toUpperCase();
  const wantNorm = normNomePontoMatch(want);
  let exact = rows.filter((r) => String(r.DS_PONTO_ENTREGA || '').trim().toUpperCase() === wantUp);
  if (exact.length === 1) return exact;
  exact = rows.filter((r) => normNomePontoMatch(r.DS_PONTO_ENTREGA) === wantNorm);
  if (exact.length === 1) return exact;

  const codWant = extrairCodigoDestinatarioCadastro(want);
  if (codWant) {
    const byCod = rows.filter(
      (r) => extrairCodigoDestinatarioCadastro(r.DS_PONTO_ENTREGA) === codWant
    );
    if (byCod.length === 1) return byCod;
    if (byCod.length > 1) {
      const tokens = wantUp
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^A-Z0-9]+/)
        .filter((t) => t.length >= 4 && t !== codWant && !/^\d+$/.test(t));
      if (tokens.length) {
        let bestScore = -1;
        const scored = byCod.map((r) => {
          const ds = normNomePontoMatch(r.DS_PONTO_ENTREGA);
          const score = tokens.reduce((acc, t) => acc + (ds.includes(t) ? 1 : 0), 0);
          return { r, score };
        });
        for (const s of scored) if (s.score > bestScore) bestScore = s.score;
        if (bestScore > 0) {
          const tied = scored.filter((s) => s.score === bestScore).map((s) => s.r);
          if (tied.length === 1) return tied;
        }
      }
    }
  }
  return rows;
}

/** Tokens úteis do complemento da NF (ex.: «ANEXO EMPRESA INTERPRINT» → INTERPRINT). */
function tokensComplementoMatch(complemento) {
  const norm = normNomePontoMatch(complemento);
  if (!norm || norm.length < 4) return [];
  const stop = new Set(['ANEXO', 'EMPRESA', 'SALA', 'LOJA', 'CD', 'DEPOSITO', 'GALPAO']);
  const out = [];
  const re = /[A-Z0-9]{4,}/g;
  let m;
  while ((m = re.exec(norm))) {
    if (!stop.has(m[0])) out.push(m[0]);
  }
  if (!out.length && norm.length >= 4) out.push(norm);
  return [...new Set(out)];
}

/** Quando o nome da NF é só a razão social, usa complemento × DS_PONTO_ENTREGA. */
function disambiguarPorComplemento(rows, complemento) {
  if (!rows || rows.length <= 1) return rows;
  const tokens = tokensComplementoMatch(complemento);
  if (!tokens.length) return rows;
  let cand = rows.filter((r) => {
    const ds = normNomePontoMatch(r.DS_PONTO_ENTREGA);
    return tokens.some((t) => ds.includes(t));
  });
  if (cand.length === 1) return cand;
  if (cand.length > 1) {
    const coded = cand.filter((r) => /\d{3,5}/.test(String(r.DS_PONTO_ENTREGA || '')));
    if (coded.length === 1) return coded;
  }
  return cand.length ? cand : rows;
}

/** «Rota 93 - São José…» → 93 (romaneio / resumo programação). */
function extrairNrRotaDescricaoCarga(descricaoOuCarga) {
  const desc =
    typeof descricaoOuCarga === 'string'
      ? descricaoOuCarga
      : String((descricaoOuCarga && descricaoOuCarga.NM_DESCRICAO) || '').trim();
  if (!desc) return null;
  const m = desc.match(/\brota\s*#?\s*(\d{1,3})\b/i);
  return m ? Number(m[1]) : null;
}

function buildBaseFromCnpj(tenantId) {
  return `
    FROM "CADASTRO_ENDERECO_ENTREGA" e
    JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
   WHERE e."TENANT_ID" = $1
     AND e."FGACTIVE" = 'A'
     AND cg."FGACTIVE" = 'A'
     AND cg."FGFISICAJURIDICA" = 'J'
     AND (${SQL_CGCCPF_14}) = $2
     AND (cg."TENANT_ID" = $1 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')`;
}

function buildBaseFromCdCliente(tenantId) {
  return `
    FROM "CADASTRO_ENDERECO_ENTREGA" e
    JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
   WHERE e."TENANT_ID" = $1
     AND e."FGACTIVE" = 'A'
     AND cg."FGACTIVE" = 'A'
     AND cg."FGFISICAJURIDICA" = 'J'
     AND e."CD_CLIENTE" = $2
     AND (cg."TENANT_ID" = $1 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')`;
}

/**
 * CD_CLIENTE e CNPJ matriz do dono do estoque da carga (ex.: Mana).
 */
/**
 * Resolve o CDCADASTRO (PJ) onde ficam os endereços de entrega do dono WMS.
 * CGC do dono pode ser filial (emitente); pontos costumam estar na matriz (mesma raiz CNPJ).
 * @returns {Promise<{ cdCliente: number|null, cnpj14: string|null }>}
 */
async function resolveCdClienteDonoPorCdDono(pool, tenantId, cdDono) {
  const cd = parseInt(cdDono, 10);
  if (!Number.isFinite(cd)) return { cdCliente: null, cnpj14: null };
  try {
    const r = await pool.query(
      `SELECT "CGC" FROM "WMS_DONO_ESTOQUE"
        WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tenantId]
    );
    const cgcDono = cnpj14Pad(r.rows[0]?.CGC);
    if (cgcDono.length !== 14) return { cdCliente: null, cnpj14: null };

    const cgExact = await pool.query(
      `SELECT cg."CDCADASTRO", (${SQL_CGCCPF_14}) AS cnpj14
         FROM "CADASTROGERAL" cg
        WHERE (cg."TENANT_ID" = $1 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
          AND (${SQL_CGCCPF_14}) = $2
          AND cg."FGFISICAJURIDICA" = 'J'
          AND cg."FGACTIVE" = 'A'
        ORDER BY cg."CDCADASTRO"
        LIMIT 1`,
      [tenantId, cgcDono]
    );
    if (cgExact.rows[0]?.CDCADASTRO != null) {
      return {
        cdCliente: Number(cgExact.rows[0].CDCADASTRO),
        cnpj14: cnpj14Pad(cgExact.rows[0].cnpj14) || cgcDono,
      };
    }

    const raiz = cgcDono.slice(0, 8);
    const cgRaiz = await pool.query(
      `SELECT cg."CDCADASTRO",
              (${SQL_CGCCPF_14}) AS cnpj14,
              count(e."CD_ENDERECO_ENTREGA")::integer AS n_pts
         FROM "CADASTROGERAL" cg
         LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
           ON e."CD_CLIENTE" = cg."CDCADASTRO"
          AND e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
        WHERE (cg."TENANT_ID" = $1 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
          AND cg."FGFISICAJURIDICA" = 'J'
          AND cg."FGACTIVE" = 'A'
          AND left(${SQL_CGCCPF_14}, 8) = $2
        GROUP BY cg."CDCADASTRO", (${SQL_CGCCPF_14})
        ORDER BY n_pts DESC, cg."CDCADASTRO"
        LIMIT 1`,
      [tenantId, raiz]
    );
    if (cgRaiz.rows[0]?.CDCADASTRO != null) {
      return {
        cdCliente: Number(cgRaiz.rows[0].CDCADASTRO),
        cnpj14: cnpj14Pad(cgRaiz.rows[0].cnpj14) || cgcDono,
      };
    }
    return { cdCliente: null, cnpj14: cgcDono };
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return { cdCliente: null, cnpj14: null };
    throw e;
  }
}

async function resolveCdClienteDonoDaCarga(pool, tenantId, cdCarga) {
  const cd = parseInt(cdCarga, 10);
  if (!Number.isFinite(cd)) return { cdCliente: null, cnpj14: null };
  try {
    const r = await pool.query(
      `SELECT c."CD_DONO", d."CGC"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = c."CD_DONO" AND d."TENANT_ID" = c."TENANT_ID"
        WHERE c."CD_CARGA" = $1 AND c."TENANT_ID" = $2`,
      [cd, tenantId]
    );
    const cdDono = r.rows[0]?.CD_DONO != null ? Number(r.rows[0].CD_DONO) : null;
    if (cdDono != null && Number.isFinite(cdDono)) {
      const viaDono = await resolveCdClienteDonoPorCdDono(pool, tenantId, cdDono);
      if (viaDono.cdCliente != null) return viaDono;
    }
    const cnpj14 = cnpj14Pad(r.rows[0]?.CGC);
    let cdCliente = null;
    if (cdCliente == null) {
      const fb = await pool.query(
        `SELECT cg."CDCADASTRO", count(DISTINCT nf.cnpj_14)::integer AS n
           FROM (
             SELECT right(lpad(regexp_replace(trim(coalesce(n."CNPJ_ENTREGA", n."CNPJ_DEST", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14
               FROM "WMS_CARGA_PROGRAMADA_NFE" j
               JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
              WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
           ) nf
           JOIN "CADASTROGERAL" cg
             ON (${SQL_CGCCPF_14.replace(/cg\./g, 'cg.')}) = nf.cnpj_14
            AND cg."FGACTIVE" = 'A'
            AND cg."FGFISICAJURIDICA" = 'J'
            AND (cg."TENANT_ID" = $2 OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
          GROUP BY cg."CDCADASTRO"
          ORDER BY n DESC
          LIMIT 1`,
        [cd, tenantId]
      );
      if (fb.rows[0]?.CDCADASTRO != null) cdCliente = Number(fb.rows[0].CDCADASTRO);
    }
    return { cdCliente, cnpj14: cnpj14.length === 14 ? cnpj14 : null };
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return { cdCliente: null, cnpj14: null };
    throw e;
  }
}

/**
 * Resolve ponto de entrega (coordenadas) para parada WMS a partir da NF-e.
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {{ cnpjEntrega: string, nmEntrega?: string, uf?: string, municipio?: string, cep?: string, logradouro?: string, numero?: string, cdClienteDono?: number|null, cnpjDonoMatriz?: string|null }} p
 * @returns {Promise<{ cdEndereco: number|null, lat: number|null, lon: number|null, matchStatus: string, matchVia?: string }>}
 */
async function buscarEnderecoEntregaParaParada(pool, tenantId, p) {
  const cnpj14 = cnpj14Pad(p.cnpjEntrega);
  const uf = String(p.uf || '').trim().toUpperCase().slice(0, 2);
  const logr = String(p.logradouro || '').trim();
  const numero = String(p.numero == null ? '' : p.numero).trim() || 'S/N';
  const cep8 = cepDigitos8(p.cep);
  const dsPonto = String(p.nmEntrega || '').trim() || 'PONTO';
  const complemento = String(p.complemento || '').trim();
  const numMatch = normalizeNumeroEntregaMatch(numero);
  const dsNorm = normNomePontoMatch(dsPonto);
  const cdClienteDono =
    p.cdClienteDono != null && Number.isFinite(Number(p.cdClienteDono)) ? Number(p.cdClienteDono) : null;
  const cnpjDonoMatriz = cnpj14Pad(p.cnpjDonoMatriz || '');

  if (!cnpj14 || cnpj14.length !== 14 || !logr || !uf) {
    return { cdEndereco: null, lat: null, lon: null, matchStatus: 'PENDENTE', matchVia: 'DADOS_INCOMPLETOS' };
  }

  const rowToHit = (row, via) => {
    const lat = row.LATITUDE != null ? Number(row.LATITUDE) : null;
    const lon = row.LONGITUDE != null ? Number(row.LONGITUDE) : null;
    const ok = Number.isFinite(lat) && Number.isFinite(lon);
    return {
      cdEndereco: row.CD_ENDERECO_ENTREGA,
      lat: ok ? lat : null,
      lon: ok ? lon : null,
      matchStatus: ok ? 'OK' : 'PENDENTE',
      matchVia: ok ? via : 'SEM_COORDENADAS',
    };
  };

  const selCols = `e."CD_ENDERECO_ENTREGA", e."DS_PONTO_ENTREGA", e."LATITUDE", e."LONGITUDE", e."NR_ROTA"`;

  const pick = (rows, via) => {
    if (!rows || !rows.length) return null;
    let list = rows;
    if (list.length > 1) {
      const narrowed = disambiguarPorNomePonto(list, dsPonto);
      if (narrowed && narrowed.length === 1) list = narrowed;
    }
    if (list.length > 1 && complemento) {
      const narrowed = disambiguarPorComplemento(list, complemento);
      if (narrowed && narrowed.length === 1) list = narrowed;
    }
    if (list.length > 1) {
      const nrUn = nrRotaUnanimeNasLinhas(list);
      if (nrUn != null) return rowToHit(list[0], via);
      return { cdEndereco: null, lat: null, lon: null, matchStatus: 'AMBIGUO', matchVia: via };
    }
    return rowToHit(list[0], via);
  };

  const runPasses = async (baseFrom, scopeKey, cnpjChave, opts = {}) => {
    const { ignoreCepOnNome = false, allowNomeSemNumero = false } = opts;
    const chaveImp = buildChaveImport(tenantId, cnpjChave, dsPonto, logr, numero, cep8 || p.cep);
    let r = await pool.query(
      `SELECT ${selCols} ${baseFrom}
         AND e."CHAVE_IMPORT" = $3
       LIMIT 3`,
      [tenantId, scopeKey, chaveImp]
    );
    let hit = pick(r.rows, 'CHAVE_IMPORT');
    if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;

    // Com ignoreCepOnNome o SQL não referencia $5 — não passar cep8 (senão PG: 5 params / 4 placeholders).
    const cepClause = ignoreCepOnNome
      ? 'TRUE'
      : `(
         $5::text = ''
         OR regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $5
       )`;
    const paramsNome = ignoreCepOnNome
      ? [tenantId, scopeKey, dsPonto, numMatch]
      : [tenantId, scopeKey, dsPonto, numMatch, cep8];

    r = await pool.query(
      `SELECT ${selCols} ${baseFrom}
         AND upper(trim(coalesce(e."DS_PONTO_ENTREGA", ''))) = upper(trim($3::text))
         AND (${SQL_NUMERO_ENTREGA_NORM}) = $4::text
         AND ${cepClause}
       LIMIT 3`,
      paramsNome
    );
    hit = pick(r.rows, 'NOME_PONTO');
    if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;

    if (dsNorm) {
      const paramsNorm = ignoreCepOnNome
        ? [tenantId, scopeKey, dsNorm, numMatch]
        : [tenantId, scopeKey, dsNorm, numMatch, cep8];
      r = await pool.query(
        `SELECT ${selCols} ${baseFrom}
           AND ${SQL_DS_PONTO_NORM} = $3::text
           AND (${SQL_NUMERO_ENTREGA_NORM}) = $4::text
           AND ${cepClause}
         LIMIT 3`,
        paramsNorm
      );
      hit = pick(r.rows, 'NOME_PONTO_NORM');
      if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;
    }

    if (allowNomeSemNumero && dsNorm) {
      r = await pool.query(
        `SELECT ${selCols} ${baseFrom}
           AND ${SQL_DS_PONTO_NORM} = $3::text
         LIMIT 5`,
        [tenantId, scopeKey, dsNorm]
      );
      hit = pick(r.rows, 'NOME_PONTO_DONO');
      if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;
      if (hit && hit.matchStatus === 'AMBIGUO') return hit;
    }

    if (cep8) {
      r = await pool.query(
        `SELECT ${selCols} ${baseFrom}
           AND upper(trim(coalesce(e."UF_ENTREGA", ''))) = upper(trim($3::text))
           AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $4
           AND ${normLogradouroSqlCompare('e."LOGRADOURO"')} = ${normLogradouroSqlCompare('$5::text')}
           AND (${SQL_NUMERO_ENTREGA_NORM}) = $6::text
         LIMIT 5`,
        [tenantId, scopeKey, uf, cep8, logr, numMatch]
      );
      hit = pick(r.rows, 'ENDERECO');
      if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;
      if (hit && hit.matchStatus === 'AMBIGUO') return hit;
    }

    return hit;
  };

  let hit = await runPasses(buildBaseFromCnpj(tenantId), cnpj14, cnpj14, {
    ignoreCepOnNome: false,
    allowNomeSemNumero: false,
  });
  if (hit && (hit.matchStatus === 'OK' || hit.matchVia === 'SEM_COORDENADAS')) return hit;
  if (hit && hit.matchStatus === 'AMBIGUO') return hit;

  if (cdClienteDono) {
    const cnpjChaveDono = cnpjDonoMatriz.length === 14 ? cnpjDonoMatriz : cnpj14;
    hit = await runPasses(buildBaseFromCdCliente(tenantId), cdClienteDono, cnpjChaveDono, {
      ignoreCepOnNome: true,
      allowNomeSemNumero: true,
    });
    if (hit && hit.matchStatus === 'OK') {
      return { ...hit, matchVia: `${hit.matchVia}_DONO` };
    }
    if (hit && (hit.matchVia === 'SEM_COORDENADAS' || hit.matchStatus === 'AMBIGUO')) {
      return hit.matchStatus === 'AMBIGUO'
        ? hit
        : { ...hit, matchVia: `${hit.matchVia}_DONO` };
    }
  }

  return { cdEndereco: null, lat: null, lon: null, matchStatus: 'PENDENTE', matchVia: 'NAO_ENCONTRADO' };
}

/** Mapa CHAVE_IMPORT → NR_ROTA (cadastro endereços de entrega) para CNPJs informados. */
async function carregarMapaNrRotaPorChaveImport(pool, tenantId, cnpjs14) {
  const uniq = [...new Set((cnpjs14 || []).map((c) => cnpj14Pad(c)).filter((c) => c.length === 14))];
  if (!uniq.length) return new Map();
  try {
    const r = await pool.query(
      `SELECT e."CHAVE_IMPORT", e."NR_ROTA"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
         JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
        WHERE e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
          AND cg."FGACTIVE" = 'A'
          AND (${SQL_CGCCPF_14}) = ANY($2::text[])
          AND e."CHAVE_IMPORT" IS NOT NULL
          AND trim(coalesce(e."CHAVE_IMPORT", '')) <> ''`,
      [tenantId, uniq]
    );
    const map = new Map();
    for (const row of r.rows || []) {
      const ch = String(row.CHAVE_IMPORT || '').trim();
      if (!ch || row.NR_ROTA == null) continue;
      const nr = Number(row.NR_ROTA);
      if (Number.isFinite(nr)) map.set(ch, nr);
    }
    return map;
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return new Map();
    throw e;
  }
}

/** NR_ROTA do cadastro quando a NF bate com um ponto de entrega (mesma chave da importação). */
function resolveNrRotaCadastroNf(tenantId, n, mapaChaveImport, indiceCodDest) {
  const cnpj = cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST);
  if (cnpj.length !== 14) return null;
  const nome = nomeEntregaUnidadeOuLocalDestino(n);
  if (mapaChaveImport && mapaChaveImport.size) {
    const logr = String(n.XLGR_DEST || '').trim();
    const nro = String(n.NRO_DEST == null ? '' : n.NRO_DEST).trim() || 'S/N';
    const cep = cepDigitos8(n.CEP_DEST);
    const chave = buildChaveImport(tenantId, cnpj, nome, logr, nro, cep);
    if (mapaChaveImport.has(chave)) return mapaChaveImport.get(chave);
  }
  /** Fallback: chave exata costuma falhar quando XML traz "21" e cadastro traz "S/N",
   *  ou quando logradouro tem pontuação diferente. Cai no código do destinatário no nome
   *  do ponto ("MANA DO BRASIL S.A. - 1002 - KRONA ACESSORIOS" → 1002). */
  if (indiceCodDest && indiceCodDest.size) {
    const cod = extrairCodigoDestinatarioCadastro(nome);
    if (cod && indiceCodDest.has(cod)) {
      const nr = indiceCodDest.get(cod);
      if (nr != null && Number.isFinite(Number(nr))) return Number(nr);
    }
  }
  return null;
}

/** Se todas as linhas tiverem o mesmo NR_ROTA, devolve esse número (duplicatas no cadastro). */
function nrRotaUnanimeNasLinhas(rows) {
  if (!rows || !rows.length) return null;
  const rotas = [
    ...new Set(
      rows
        .map((row) => (row.NR_ROTA != null ? Number(row.NR_ROTA) : NaN))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (rotas.length === 1) return rotas[0];
  return null;
}

function nmEntregaOpl(pedido) {
  const cod = String(pedido.COD_DESTINATARIO != null ? pedido.COD_DESTINATARIO : '').trim();
  const raz = String(pedido.RAZ_SOC_DEST != null ? pedido.RAZ_SOC_DEST : '').trim();
  if (cod && raz) return `${cod} ${raz}`;
  return raz || 'PONTO';
}

/** Chave estável do destinatário OPL (igual romaneio de separação). */
function chaveDestinatarioOpl(p) {
  const cod = String(p.COD_DESTINATARIO != null ? p.COD_DESTINATARIO : '').trim();
  const cnpj = String(p.CNPJ_DEST != null ? p.CNPJ_DEST : '').replace(/\D/g, '');
  if (cod) return `C:${cod}`;
  if (cnpj) return `J:${cnpj}`;
  return `R:${String(p.RAZ_SOC_DEST || '').trim()}|${String(p.CIDADE_ENTREGA || '').trim()}|${String(p.UF_ENTREGA || '').trim()}`;
}

/** CEP do pedido OPL (campo CEP ou 8 dígitos colados no fim de ENDE_ENTREGA). */
function cepOplPedido(p) {
  let c = cepDigitos8(p.CEP_ENTREGA);
  if (c) return c;
  const m = String(p.ENDE_ENTREGA != null ? p.ENDE_ENTREGA : '').match(/(\d{8})\s*$/);
  return m ? m[1] : '';
}

/** Remove CEP colado no fim da linha de endereço OPL. */
function endeOplSemCepColado(ende, cep8) {
  let s = String(ende != null ? ende : '').trim();
  if (cep8 && s.endsWith(cep8)) s = s.slice(0, -cep8.length).trim();
  return s;
}

/** Extrai número do endereço OPL (linha única de 50 pos.; não confundir CEP de 8 dígitos). */
function extrairNumeroEnderecoOpl(ende, cep8) {
  let s = endeOplSemCepColado(ende, cep8);
  if (!s) return 'S/N';
  const km = s.match(/\bKM\s*(\d+[A-Za-z0-9/-]*)/i);
  if (km) return `KM${km[1].replace(/\s+/g, '')}`;
  const aposVirgula = s.match(/,\s*(\d+[A-Za-z0-9/-]*)/);
  if (aposVirgula) {
    const n = aposVirgula[1].trim();
    if (n.length !== 8 || n !== cep8) return n;
  }
  const fim = s.match(/(\d{1,7}[A-Za-z0-9/-]*)\s*$/);
  if (fim) {
    const n = fim[1].trim();
    if (n.length !== 8 || n !== cep8) return n;
  }
  return 'S/N';
}

function logradouroOplSemNumero(ende, numero) {
  let s = String(ende != null ? ende : '').trim();
  const n = String(numero || '').trim();
  if (n && n !== 'S/N') {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`,?\\s*${esc}\\s*$`, 'i'), '').trim();
  }
  return s || String(ende != null ? ende : '').trim();
}

/** NR_ROTA via CHAVE_IMPORT (pedido OPL tipo 2). */
function resolveNrRotaCadastroOpl(tenantId, p, mapaChaveImport) {
  if (!mapaChaveImport || !mapaChaveImport.size) return null;
  const cnpj = cnpj14Pad(p.CNPJ_DEST);
  if (cnpj.length !== 14) return null;
  const nome = String(p.RAZ_SOC_DEST || '').trim() || 'PONTO';
  const cep = cepOplPedido(p);
  const endeLimpo = endeOplSemCepColado(p.ENDE_ENTREGA, cep);
  const numero = extrairNumeroEnderecoOpl(p.ENDE_ENTREGA, cep);
  const logr = logradouroOplSemNumero(endeLimpo, numero);
  const chaves = [
    buildChaveImport(tenantId, cnpj, nome, logr, numero, cep || p.CEP_ENTREGA),
    buildChaveImport(tenantId, cnpj, nome, endeLimpo, 'S/N', cep || p.CEP_ENTREGA),
    buildChaveImport(tenantId, cnpj, nome, String(p.ENDE_ENTREGA || '').trim(), 'S/N', cep || p.CEP_ENTREGA),
  ];
  const cod = String(p.COD_DESTINATARIO || '').trim();
  if (cod) {
    chaves.push(buildChaveImport(tenantId, cnpj, `${cod} ${nome}`.trim(), logr, numero, cep || p.CEP_ENTREGA));
    chaves.push(buildChaveImport(tenantId, cnpj, `${cod} — ${nome}`.trim(), logr, numero, cep || p.CEP_ENTREGA));
  }
  for (const ch of chaves) {
    if (mapaChaveImport.has(ch)) return mapaChaveImport.get(ch);
  }
  return null;
}

/**
 * Fallback: mesmo CNPJ + CEP (+ UF), desambigua por nome/código destinatário OPL.
 */
async function nrRotaFallbackCnpjCepNomeOpl(pool, tenantId, pedido) {
  const cnpj = cnpj14Pad(pedido.CNPJ_DEST);
  if (cnpj.length !== 14) return null;
  const cep = cepOplPedido(pedido);
  const uf = String(pedido.UF_ENTREGA || '').trim().toUpperCase().slice(0, 2);
  const nomeNorm = normNomePontoMatch(pedido.RAZ_SOC_DEST);
  const cod = String(pedido.COD_DESTINATARIO || '').trim();
  let sql = `
    SELECT e."NR_ROTA", e."DS_PONTO_ENTREGA"
      FROM "CADASTRO_ENDERECO_ENTREGA" e
      JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
     WHERE e."TENANT_ID" = $1
       AND e."FGACTIVE" = 'A'
       AND cg."FGACTIVE" = 'A'
       AND (${SQL_CGCCPF_14}) = $2
       AND e."NR_ROTA" IS NOT NULL`;
  const params = [tenantId, cnpj];
  let i = 3;
  if (cep) {
    sql += ` AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $${i}`;
    params.push(cep);
    i++;
  }
  if (uf) {
    sql += ` AND upper(trim(coalesce(e."UF_ENTREGA", ''))) = $${i}`;
    params.push(uf);
    i++;
  }
  sql += ' ORDER BY e."NR_ROTA", e."CD_ENDERECO_ENTREGA" LIMIT 20';
  let r;
  try {
    r = await pool.query(sql, params);
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
  const rows = (r.rows || []).filter((row) => row.NR_ROTA != null);
  if (!rows.length) return null;
  const unanime = nrRotaUnanimeNasLinhas(rows);
  if (unanime != null) return unanime;

  const byNomeCod = rows.filter((row) => {
    const ds = String(row.DS_PONTO_ENTREGA || '').toUpperCase();
    const dsNorm = normNomePontoMatch(row.DS_PONTO_ENTREGA);
    if (cod && ds.includes(cod)) return true;
    if (nomeNorm && (dsNorm.includes(nomeNorm) || nomeNorm.includes(dsNorm))) return true;
    if (nomeNorm && ds.includes(String(pedido.RAZ_SOC_DEST || '').trim().toUpperCase())) return true;
    return false;
  });
  const unanimeNc = nrRotaUnanimeNasLinhas(byNomeCod);
  if (unanimeNc != null) return unanimeNc;
  if (byNomeCod.length === 1) return Number(byNomeCod[0].NR_ROTA);

  const byNomeOnly = rows.filter((row) => {
    const dsNorm = normNomePontoMatch(row.DS_PONTO_ENTREGA);
    return nomeNorm && dsNorm && (dsNorm.includes(nomeNorm) || nomeNorm.includes(dsNorm));
  });
  const unanimeN = nrRotaUnanimeNasLinhas(byNomeOnly);
  if (unanimeN != null) return unanimeN;
  if (byNomeOnly.length === 1) return Number(byNomeOnly[0].NR_ROTA);

  return null;
}

/** Match por CNPJ + CEP + logradouro/número (campos separados no cadastro; OPL em ENDE_ENTREGA). */
async function nrRotaPorLogradouroOpl(pool, tenantId, pedido) {
  const cnpj = cnpj14Pad(pedido.CNPJ_DEST);
  if (cnpj.length !== 14) return null;
  const cep = cepOplPedido(pedido);
  const numero = extrairNumeroEnderecoOpl(pedido.ENDE_ENTREGA, cep);
  const logr = logradouroOplSemNumero(endeOplSemCepColado(pedido.ENDE_ENTREGA, cep), numero);
  if (!logr) return null;
  const numMatch = normalizeNumeroEntregaMatch(numero);
  let sql = `
    SELECT e."NR_ROTA", e."DS_PONTO_ENTREGA"
      FROM "CADASTRO_ENDERECO_ENTREGA" e
      JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
     WHERE e."TENANT_ID" = $1
       AND e."FGACTIVE" = 'A'
       AND cg."FGACTIVE" = 'A'
       AND (${SQL_CGCCPF_14}) = $2
       AND e."NR_ROTA" IS NOT NULL
       AND (${SQL_NUMERO_ENTREGA_NORM}) = $3
       AND ${normLogradouroSqlCompare('e."LOGRADOURO"')} = ${normLogradouroSqlCompare('$4::text')}`;
  const params = [tenantId, cnpj, numMatch, logr];
  let i = 5;
  if (cep) {
    sql += ` AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $${i}`;
    params.push(cep);
    i++;
  }
  sql += ' LIMIT 10';
  try {
    const r = await pool.query(sql, params);
    return nrRotaUnanimeNasLinhas(r.rows || []);
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

/** Tenta CHAVE_IMPORT usando nomes de ponto já cadastrados (ex.: MANA ... 1140 - IRANI). */
async function nrRotaPorChavesCadastroCnpj(pool, tenantId, pedido, mapaChaveImport) {
  const cnpj = cnpj14Pad(pedido.CNPJ_DEST);
  if (cnpj.length !== 14 || !mapaChaveImport || !mapaChaveImport.size) return null;
  const cep = cepOplPedido(pedido);
  const numero = extrairNumeroEnderecoOpl(pedido.ENDE_ENTREGA, cep);
  const logr = logradouroOplSemNumero(endeOplSemCepColado(pedido.ENDE_ENTREGA, cep), numero);
  const cod = String(pedido.COD_DESTINATARIO || '').trim();
  try {
    const r = await pool.query(
      `SELECT e."DS_PONTO_ENTREGA", e."LOGRADOURO", e."NUMERO", e."CEP", e."NR_ROTA"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
         JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
        WHERE e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
          AND cg."FGACTIVE" = 'A'
          AND (${SQL_CGCCPF_14}) = $2
          AND e."NR_ROTA" IS NOT NULL
          AND ($3 = '' OR upper(coalesce(e."DS_PONTO_ENTREGA", '')) LIKE '%' || upper($3) || '%')`,
      [tenantId, cnpj, cod]
    );
    for (const row of r.rows || []) {
      const ponto = String(row.DS_PONTO_ENTREGA || '').trim();
      const ch = buildChaveImport(
        tenantId,
        cnpj,
        ponto,
        String(row.LOGRADOURO || logr).trim(),
        row.NUMERO != null ? String(row.NUMERO) : numero,
        cep || row.CEP
      );
      if (mapaChaveImport.has(ch)) return mapaChaveImport.get(ch);
      const ch2 = buildChaveImport(tenantId, cnpj, ponto, logr, numero, cep || row.CEP);
      if (mapaChaveImport.has(ch2)) return mapaChaveImport.get(ch2);
    }
    return nrRotaUnanimeNasLinhas(r.rows || []);
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

async function nrRotaPorCdEndereco(pool, tenantId, cdEndereco) {
  if (cdEndereco == null || !Number.isFinite(Number(cdEndereco))) return null;
  try {
    const r = await pool.query(
      `SELECT e."NR_ROTA"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
        WHERE e."TENANT_ID" = $1
          AND e."CD_ENDERECO_ENTREGA" = $2::integer
          AND e."FGACTIVE" = 'A'
        LIMIT 1`,
      [tenantId, cdEndereco]
    );
    if (!r.rows.length || r.rows[0].NR_ROTA == null) return null;
    const nr = Number(r.rows[0].NR_ROTA);
    return Number.isFinite(nr) ? nr : null;
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

/**
 * NR_ROTA quando há mais de um ponto no mesmo endereço físico (duplicatas no cadastro).
 * Usa rota unânime, complemento da NF e/ou rota da carga programada.
 */
async function nrRotaPorEnderecoFisico(pool, tenantId, p, opts = {}) {
  const { nrRotaHint = null, allowedNrRotas = null } = opts;
  const cnpj14 = cnpj14Pad(p.cnpjEntrega);
  const uf = String(p.uf || '').trim().toUpperCase().slice(0, 2);
  const logr = String(p.logradouro || '').trim();
  const numero = String(p.numero == null ? '' : p.numero).trim() || 'S/N';
  const cep8 = cepDigitos8(p.cep);
  const numMatch = normalizeNumeroEntregaMatch(numero);
  const dsPonto = String(p.nmEntrega || '').trim();
  const complemento = String(p.complemento || '').trim();

  if (!cnpj14 || cnpj14.length !== 14 || !logr || !uf || !cep8) return null;

  try {
    const r = await pool.query(
      `SELECT e."CD_ENDERECO_ENTREGA", e."DS_PONTO_ENTREGA", e."NR_ROTA"
         ${buildBaseFromCnpj(tenantId)}
         AND upper(trim(coalesce(e."UF_ENTREGA", ''))) = upper(trim($3::text))
         AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $4
         AND ${normLogradouroSqlCompare('e."LOGRADOURO"')} = ${normLogradouroSqlCompare('$5::text')}
         AND (${SQL_NUMERO_ENTREGA_NORM}) = $6::text
       ORDER BY e."CD_ENDERECO_ENTREGA"`,
      [tenantId, cnpj14, uf, cep8, logr, numMatch]
    );
    let rows = r.rows || [];
    if (!rows.length) return null;

    let list = disambiguarPorNomePonto(rows, dsPonto);
    if (list && list.length === 1) rows = list;
    else if (list && list.length > 1) rows = list;

    if (rows.length > 1 && complemento) {
      const narrowed = disambiguarPorComplemento(rows, complemento);
      if (narrowed && narrowed.length >= 1) rows = narrowed;
    }

    const filterAllowed = (arr) => {
      if (!allowedNrRotas || !allowedNrRotas.length) return arr;
      const set = new Set(allowedNrRotas.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
      return arr.filter((row) => set.has(Number(row.NR_ROTA)));
    };

    let nrUn = nrRotaUnanimeNasLinhas(filterAllowed(rows));
    if (nrUn != null) return nrUn;

    const hint =
      nrRotaHint != null && Number.isFinite(Number(nrRotaHint)) ? Number(nrRotaHint) : null;
    if (hint != null) {
      const byHint = rows.filter((row) => Number(row.NR_ROTA) === hint);
      nrUn = nrRotaUnanimeNasLinhas(byHint);
      if (nrUn != null) return nrUn;
      if (byHint.length === 1) return hint;
    }

    return null;
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

/**
 * NR_ROTA do cadastro de endereços para um pedido OPL (espelho separação).
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {object} pedido
 * @param {Map<string, number>} [mapaChaveImport]
 */
async function resolverNrRotaPedidoOpl(pool, tenantId, pedido, mapaChaveImport) {
  const mapa = mapaChaveImport || new Map();
  let fromChave = resolveNrRotaCadastroOpl(tenantId, pedido, mapa);
  if (fromChave == null) {
    fromChave = await nrRotaPorChavesCadastroCnpj(pool, tenantId, pedido, mapa);
  }
  if (fromChave != null) return fromChave;

  const nrLog = await nrRotaPorLogradouroOpl(pool, tenantId, pedido);
  if (nrLog != null) return nrLog;

  const cep = cepOplPedido(pedido);
  const endeLimpo = endeOplSemCepColado(pedido.ENDE_ENTREGA, cep);
  const numero = extrairNumeroEnderecoOpl(pedido.ENDE_ENTREGA, cep);
  const logr = logradouroOplSemNumero(endeLimpo, numero);
  const hit = await buscarEnderecoEntregaParaParada(pool, tenantId, {
    cnpjEntrega: pedido.CNPJ_DEST,
    nmEntrega: nmEntregaOpl(pedido),
    uf: pedido.UF_ENTREGA,
    municipio: pedido.CIDADE_ENTREGA,
    cep: cep || pedido.CEP_ENTREGA,
    logradouro: logr || endeLimpo,
    numero,
  });
  if (hit.cdEndereco) {
    const nr = await nrRotaPorCdEndereco(pool, tenantId, hit.cdEndereco);
    if (nr != null) return nr;
  }
  if (endeLimpo && (logr !== endeLimpo || numero === 'S/N')) {
    const hit2 = await buscarEnderecoEntregaParaParada(pool, tenantId, {
      cnpjEntrega: pedido.CNPJ_DEST,
      nmEntrega: pedido.RAZ_SOC_DEST,
      uf: pedido.UF_ENTREGA,
      municipio: pedido.CIDADE_ENTREGA,
      cep: cep || pedido.CEP_ENTREGA,
      logradouro: endeLimpo,
      numero: 'S/N',
    });
    if (hit2.cdEndereco) {
      const nr2 = await nrRotaPorCdEndereco(pool, tenantId, hit2.cdEndereco);
      if (nr2 != null) return nr2;
    }
  }
  let nrFb = await nrRotaFallbackCnpjCepNomeOpl(pool, tenantId, pedido);
  if (nrFb != null) return nrFb;
  return nrRotaPorCepRazaoOpl(pool, tenantId, pedido);
}

/** Separador de trechos no nome do ponto (hífen, en-dash ou em-dash). */
const RE_SEP_PONTO_ENTREGA = '[-\u2013\u2014]';

/** Extrai código destinatário Mana do nome do ponto (ex.: "… - 1140 - IRANI" → 1140). */
function extrairCodigoDestinatarioCadastro(dsPonto) {
  const s = String(dsPonto != null ? dsPonto : '');
  const sep = RE_SEP_PONTO_ENTREGA;
  const entre = new RegExp(`${sep}\\s*(\\d{3,5})\\s*${sep}`);
  const m = s.match(entre);
  if (m) return m[1].trim();
  const fim = new RegExp(`${sep}\\s*(\\d{3,5})\\s*$`);
  const m2 = s.match(fim);
  return m2 ? m2[1].trim() : '';
}

/**
 * Índice rápido: código destinatário OPL (3–5 dígitos no DS_PONTO_ENTREGA) → NR_ROTA.
 * @returns {Promise<Map<string, number|null>>}
 */
async function carregarIndiceRotaPorCodigoDestinatario(pool, tenantId) {
  try {
    const r = await pool.query(
      `SELECT e."NR_ROTA", e."DS_PONTO_ENTREGA"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
        WHERE e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
          AND e."NR_ROTA" IS NOT NULL`,
      [tenantId]
    );
    /** @type {Map<string, Set<number>>} */
    const porCod = new Map();
    for (const row of r.rows || []) {
      const cod = extrairCodigoDestinatarioCadastro(row.DS_PONTO_ENTREGA);
      if (!cod) continue;
      const nr = Number(row.NR_ROTA);
      if (!Number.isFinite(nr)) continue;
      if (!porCod.has(cod)) porCod.set(cod, new Set());
      porCod.get(cod).add(nr);
    }
    const out = new Map();
    for (const [cod, set] of porCod) {
      out.set(cod, set.size === 1 ? [...set][0] : null);
    }
    return out;
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return new Map();
    throw e;
  }
}

/** CEP + trecho da razão social no nome do ponto (quando código não está no cadastro). */
async function nrRotaPorCepRazaoOpl(pool, tenantId, pedido) {
  const cep = cepOplPedido(pedido);
  const raz = String(pedido.RAZ_SOC_DEST != null ? pedido.RAZ_SOC_DEST : '').trim();
  const razNorm = normNomePontoMatch(raz);
  if (!cep || !razNorm || razNorm.length < 4) return null;
  try {
    const r = await pool.query(
      `SELECT e."NR_ROTA", e."DS_PONTO_ENTREGA"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
        WHERE e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
          AND e."NR_ROTA" IS NOT NULL
          AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $2
          AND (
            ${SQL_DS_PONTO_NORM} LIKE '%' || $3::text || '%'
            OR upper(coalesce(e."DS_PONTO_ENTREGA", '')) LIKE '%' || upper($4::text) || '%'
          )
        LIMIT 15`,
      [tenantId, cep, razNorm, raz.slice(0, 40)]
    );
    return nrRotaUnanimeNasLinhas(r.rows || []);
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) return null;
    throw e;
  }
}

/**
 * Mapa chave destinatário OPL → NR_ROTA (para romaneio / conferência).
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {object[]} pedidos
 * @returns {Promise<Map<string, number|null>>}
 */
async function carregarNrRotaPorPedidosOpl(pool, tenantId, pedidos) {
  const uniq = new Map();
  for (const p of pedidos || []) {
    const k = chaveDestinatarioOpl(p);
    if (!uniq.has(k)) uniq.set(k, p);
  }
  const indiceCod = await carregarIndiceRotaPorCodigoDestinatario(pool, tenantId);
  const cnpjs = [...uniq.values()].map((p) => p.CNPJ_DEST);
  const mapaChave = await carregarMapaNrRotaPorChaveImport(pool, tenantId, cnpjs);
  const out = new Map();
  for (const [k, p] of uniq) {
    try {
      const cod = String(p.COD_DESTINATARIO != null ? p.COD_DESTINATARIO : '').trim();
      if (cod && indiceCod.has(cod)) {
        const nrIdx = indiceCod.get(cod);
        if (nrIdx != null && Number.isFinite(Number(nrIdx))) {
          out.set(k, Number(nrIdx));
          continue;
        }
      }
      let nr = await resolverNrRotaPedidoOpl(pool, tenantId, p, mapaChave);
      if (nr == null) nr = await nrRotaPorCepRazaoOpl(pool, tenantId, p);
      out.set(k, nr);
    } catch (_) {
      out.set(k, null);
    }
  }
  return out;
}

/**
 * NR_ROTA para NF-e de saída: chave import / código no nome → match por endereço (CNPJ+CEP+logradouro+nº).
 * Corrige falsos «sem cadastro» quando o XML traz só a razão social (ex.: MANA DO BRASIL S.A.)
 * e o ponto no cadastro tem código (ex.: «1149 - CONSIGAZ»).
 */
async function resolverNrRotaNfSaida(pool, tenantId, n, mapaChaveImport, indiceCodDest, opts = {}) {
  const nrChave = resolveNrRotaCadastroNf(tenantId, n, mapaChaveImport, indiceCodDest);
  if (nrChave != null) return { nrRota: nrChave, matchVia: 'CHAVE_OU_COD' };

  const cnpj = cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST);
  if (cnpj.length !== 14) return { nrRota: null, matchVia: 'CNPJ_INVALIDO' };

  const nome = nomeEntregaUnidadeOuLocalDestino(n);
  const logr = String(n.XLGR_DEST || '').trim();
  const nro = String(n.NRO_DEST == null ? '' : n.NRO_DEST).trim() || 'S/N';
  const cep = cepDigitos8(n.CEP_DEST);
  const complemento = String(n.XCPL_DEST || '').trim();

  const hit = await buscarEnderecoEntregaParaParada(pool, tenantId, {
    cnpjEntrega: cnpj,
    nmEntrega: nome,
    uf: n.UF_DEST,
    municipio: n.XMUN_DEST,
    cep,
    logradouro: logr,
    numero: nro,
    complemento,
  });

  if (hit.cdEndereco) {
    const nr = await nrRotaPorCdEndereco(pool, tenantId, hit.cdEndereco);
    if (nr != null) return { nrRota: nr, matchVia: hit.matchVia || 'ENDERECO' };
  }

  const nrEnd = await nrRotaPorEnderecoFisico(
    pool,
    tenantId,
    {
      cnpjEntrega: cnpj,
      nmEntrega: nome,
      uf: n.UF_DEST,
      cep,
      logradouro: logr,
      numero: nro,
      complemento,
    },
    opts
  );
  if (nrEnd != null) return { nrRota: nrEnd, matchVia: 'ENDERECO_DESAMB' };

  if (hit.matchStatus === 'AMBIGUO') {
    return { nrRota: null, matchVia: 'AMBIGUO' };
  }

  return { nrRota: null, matchVia: hit.matchVia || 'NAO_ENCONTRADO' };
}

module.exports = {
  buscarEnderecoEntregaParaParada,
  resolveCdClienteDonoDaCarga,
  resolveCdClienteDonoPorCdDono,
  carregarMapaNrRotaPorChaveImport,
  resolveNrRotaCadastroNf,
  resolverNrRotaNfSaida,
  extrairNrRotaDescricaoCarga,
  nrRotaPorEnderecoFisico,
  normNomePontoMatch,
  chaveDestinatarioOpl,
  resolveNrRotaCadastroOpl,
  resolverNrRotaPedidoOpl,
  carregarNrRotaPorPedidosOpl,
  carregarIndiceRotaPorCodigoDestinatario,
  extrairCodigoDestinatarioCadastro,
  cnpj14Pad,
  SQL_NUMERO_ENTREGA_NORM,
};
