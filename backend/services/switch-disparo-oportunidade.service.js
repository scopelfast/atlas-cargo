'use strict';

/**
 * Disparo simples de WhatsApp (Switch Digital) para lista colada:
 * template com {{nome}} e linhas "telefone|nome|UF|cidade" (UF/cidade opcionais para inferir DDD).
 */

/** DDD “principal” por UF (capital / maior volume) — fallback quando não há cidade na linha ou não achamos na base. */
const DDD_POR_UF = {
  AC: '68',
  AL: '82',
  AM: '92',
  AP: '96',
  BA: '71',
  CE: '85',
  DF: '61',
  ES: '27',
  GO: '62',
  MA: '98',
  MG: '31',
  MS: '67',
  MT: '65',
  PA: '91',
  PB: '83',
  PE: '81',
  PI: '86',
  PR: '41',
  RJ: '21',
  RN: '84',
  RO: '69',
  RR: '95',
  RS: '51',
  SC: '48',
  SE: '79',
  SP: '11',
  TO: '63'
};

function stripDiacritics(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function apenasDigitos(s) {
  return String(s || '').replace(/\D/g, '');
}

function trimLeadingZeros(d) {
  let x = d;
  while (x.length > 1 && x[0] === '0') x = x.slice(1);
  return x;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} uf2
 * @param {string} cidadeNome
 * @returns {Promise<string|null>}
 */
async function buscarDddPorCidade(pool, uf2, cidadeNome) {
  const uf = String(uf2 || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cid = stripDiacritics(String(cidadeNome || '').trim()).toUpperCase();
  if (!uf || uf.length !== 2 || !cid || !pool) return null;
  try {
    const r = await pool.query(
      `SELECT TRIM(m."DDD")::text AS ddd
       FROM "CIDADE" c
       LEFT JOIN "MUNICIPIO" m ON m."CodigoIBGE" = c."CDMUNICIPIO"
       WHERE TRIM(c."ESTADO") LIKE $1 || '%'
         AND UPPER(REGEXP_REPLACE(TRIM(c."NMCIDADE"), '\\s+', ' ', 'g')) = $2
       LIMIT 1`,
      [uf, cid.replace(/\s+/g, ' ')]
    );
    const row = r.rows && r.rows[0];
    const d = row && row.ddd != null ? String(row.ddd).replace(/\D/g, '') : '';
    return d.length === 2 ? d : null;
  } catch (_) {
    return null;
  }
}

function dddPorUf(uf2) {
  const u = String(uf2 || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return DDD_POR_UF[u] || null;
}

/**
 * @param {string} linha
 * @returns {{ telefoneRaw: string, nome: string, uf: string, cidade: string }|null}
 */
function parseLinha(linha) {
  const line = String(linha || '').trim();
  if (!line || line.startsWith('#')) return null;
  const parts = line.split('|').map((p) => p.trim());
  if (parts.length < 2) return null;
  const telefoneRaw = parts[0];
  const nome = parts[1] || 'Motorista';
  const uf = (parts[2] || '').trim().toUpperCase().slice(0, 2);
  const cidade = parts.length > 3 ? parts.slice(3).join('|').trim() : '';
  return { telefoneRaw, nome, uf, cidade };
}

/**
 * @param {import('pg').Pool|null} pool
 * @param {{ telefoneRaw: string, nome: string, uf: string, cidade: string }} parsed
 * @returns {Promise<{ e164: string|null, erro: string|null, aviso: string|null, dddFonte: string }>}
 */
async function normalizarTelefoneBr(parsed, pool) {
  let d = trimLeadingZeros(apenasDigitos(parsed.telefoneRaw));
  if (!d) return { e164: null, erro: 'Telefone vazio', aviso: null, dddFonte: '—' };

  while (d.startsWith('55') && d.length > 13) {
    d = d.slice(2);
  }

  if (d.startsWith('55')) {
    if (d.length >= 12 && d.length <= 13) {
      const resto = d.slice(2);
      const movel = resto.length === 11 && resto[2] === '9';
      return {
        e164: d,
        erro: null,
        aviso: movel ? null : 'Número pode ser fixo (8 dígitos locais); WhatsApp costuma exigir celular.',
        dddFonte: 'entrada'
      };
    }
    return { e164: null, erro: `Formato inválido com DDI 55 (${d.length} dígitos)`, aviso: null, dddFonte: 'entrada' };
  }

  if (d.length === 11) {
    return { e164: `55${d}`, erro: null, aviso: null, dddFonte: 'entrada' };
  }

  if (d.length === 10) {
    return {
      e164: `55${d}`,
      erro: null,
      aviso: '10 dígitos: pode ser fixo; confira se o WhatsApp entrega.',
      dddFonte: 'entrada'
    };
  }

  if (d.length === 9 && d[0] === '9') {
    let ddd = null;
    let fonte = 'nenhum';
    if (pool && parsed.uf && parsed.cidade) {
      ddd = await buscarDddPorCidade(pool, parsed.uf, parsed.cidade);
      if (ddd) fonte = 'cidade';
    }
    if (!ddd && parsed.uf) {
      ddd = dddPorUf(parsed.uf);
      if (ddd) fonte = 'uf';
    }
    if (!ddd) {
      return {
        e164: null,
        erro: 'Faltam DDD: informe UF (e preferencialmente cidade) na linha após o nome.',
        aviso: null,
        dddFonte: 'nenhum'
      };
    }
    return { e164: `55${ddd}${d}`, erro: null, aviso: `DDD ${ddd} inferido (${fonte}). Confirme o número.`, dddFonte: fonte };
  }

  if (d.length === 8) {
    let ddd = null;
    let fonte = 'nenhum';
    if (pool && parsed.uf && parsed.cidade) {
      ddd = await buscarDddPorCidade(pool, parsed.uf, parsed.cidade);
      if (ddd) fonte = 'cidade';
    }
    if (!ddd && parsed.uf) {
      ddd = dddPorUf(parsed.uf);
      if (ddd) fonte = 'uf';
    }
    if (!ddd) {
      return {
        e164: null,
        erro: '8 dígitos sem DDD: informe UF (e cidade) na linha.',
        aviso: null,
        dddFonte: 'nenhum'
      };
    }
    return {
      e164: `55${ddd}${d}`,
      erro: null,
      aviso: `DDD ${ddd} inferido (${fonte}); parece fixo — WhatsApp pode falhar.`,
      dddFonte: fonte
    };
  }

  return {
    e164: null,
    erro: `Não foi possível interpretar o telefone (${d.length} dígitos após limpeza).`,
    aviso: null,
    dddFonte: 'nenhum'
  };
}

function aplicarTemplate(template, nome) {
  const n = String(nome || '').trim() || 'Motorista';
  let out = String(template || '');
  out = out.replace(/\{\{\s*nome\s*\}\}/gi, n);
  out = out.replace(/\{\{\s*motorista\s*\}\}/gi, n);
  return out;
}

function parseBlocoLinhas(texto) {
  const linhas = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = [];
  for (const l of linhas) {
    const p = parseLinha(l);
    if (p) parsed.push(p);
  }
  return parsed;
}

/**
 * @param {import('pg').Pool|null} pool
 * @param {string} template
 * @param {string} textoLinhas
 */
async function preview(pool, template, textoLinhas) {
  const itens = parseBlocoLinhas(textoLinhas);
  const out = [];
  for (const p of itens) {
    const norm = await normalizarTelefoneBr(p, pool);
    const corpo = norm.erro ? '' : aplicarTemplate(template, p.nome);
    out.push({
      nome: p.nome,
      uf: p.uf || '',
      cidade: p.cidade || '',
      telefoneOriginal: p.telefoneRaw,
      telefoneE164: norm.e164,
      dddFonte: norm.dddFonte,
      aviso: norm.aviso,
      erro: norm.erro,
      previewCorpo: corpo
    });
  }
  return { total: itens.length, linhas: out };
}

module.exports = {
  parseLinha,
  parseBlocoLinhas,
  normalizarTelefoneBr,
  aplicarTemplate,
  preview,
  buscarDddPorCidade,
  DDD_POR_UF
};
