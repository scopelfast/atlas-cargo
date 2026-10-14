'use strict';

/**
 * Regra de FG_CONTROLA_VALIDADE por Grupo (cadastro WMS).
 * 601–607 (alimentos) → S | 621/631/632/651/652 (não alimento) → N
 * Fallback pelo prefixo do código interno (6.01.* ↔ 601, etc.).
 */

const GRUPOS_OBRIGATORIO_S = new Set(['601', '602', '603', '604', '605', '606', '607']);
const GRUPOS_OBRIGATORIO_N = new Set(['621', '631', '632', '651', '652']);

/** Prefixo do SKU (6.XX) → código do grupo no cadastro (6XX). */
const PREFIXO_PARA_GRUPO = {
  '01': '601',
  '02': '602',
  '03': '603',
  '04': '604',
  '05': '605',
  '06': '606',
  '07': '607',
  '21': '621',
  '31': '631',
  '32': '632',
  '51': '651',
  '52': '652',
};

function normalizarCodigoGrupo(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  // Aceita 601, 6.01, 06.01, etc.
  const soDigitos = s.replace(/\D/g, '');
  if (soDigitos.length >= 3) return soDigitos.slice(0, 3);
  if (soDigitos.length === 2) {
    // 01 → tentar mapear via prefixo
    return PREFIXO_PARA_GRUPO[soDigitos] || soDigitos;
  }
  return soDigitos;
}

function grupoCodigoFromSku(codigoProduto) {
  const m = String(codigoProduto || '').trim().match(/^6\.(\d{2})\./);
  if (!m) return '';
  return PREFIXO_PARA_GRUPO[m[1]] || '';
}

/**
 * @param {string} codigoGrupo - ex. '603'
 * @returns {'S'|'N'|null} null = sem regra (respeitar informado)
 */
function fgValidadePorCodigoGrupo(codigoGrupo) {
  const g = normalizarCodigoGrupo(codigoGrupo);
  if (!g) return null;
  if (GRUPOS_OBRIGATORIO_S.has(g)) return 'S';
  if (GRUPOS_OBRIGATORIO_N.has(g)) return 'N';
  return null;
}

/**
 * Resolve FG a partir do grupo do cadastro e/ou do código do SKU.
 * @returns {'S'|'N'|null}
 */
function fgValidadePorGrupoOuSku({ codigoGrupo, codigoProduto } = {}) {
  const porGrupo = fgValidadePorCodigoGrupo(codigoGrupo);
  if (porGrupo) return porGrupo;
  return fgValidadePorCodigoGrupo(grupoCodigoFromSku(codigoProduto));
}

/**
 * Aplica a regra: se houver grupo conhecido, força; senão mantém o informado.
 * @param {string} fgInformado
 * @param {{ codigoGrupo?: string, codigoProduto?: string }} ctx
 * @returns {'S'|'N'}
 */
function aplicarFgControlaValidade(fgInformado, ctx = {}) {
  const regra = fgValidadePorGrupoOuSku(ctx);
  if (regra === 'S' || regra === 'N') return regra;
  const v = String(fgInformado == null ? 'N' : fgInformado).trim().toUpperCase();
  return v === 'S' ? 'S' : 'N';
}

/**
 * Busca código do grupo via CD_CATEGORIA.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {string} tenantId
 * @param {number|null} cdCategoria
 * @returns {Promise<string>}
 */
async function buscarCodigoGrupoPorCategoria(db, tenantId, cdCategoria) {
  if (cdCategoria == null || !Number.isFinite(Number(cdCategoria))) return '';
  const r = await db.query(
    `SELECT g."CODIGO"
       FROM "WMS_CATEGORIA_PRODUTO" c
       INNER JOIN "WMS_GRUPO_PRODUTO" g
         ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
      WHERE c."CD_CATEGORIA" = $1::integer AND c."TENANT_ID" = $2`,
    [cdCategoria, tenantId]
  );
  return r.rows[0] ? String(r.rows[0].CODIGO || '').trim() : '';
}

/**
 * Resolve FG final para create/update de produto.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ tenantId: string, cdCategoria?: number|null, codigoProduto?: string, fgInformado?: string }} opts
 */
async function resolverFgControlaValidadeProduto(db, opts) {
  const codigoGrupo = await buscarCodigoGrupoPorCategoria(db, opts.tenantId, opts.cdCategoria);
  return aplicarFgControlaValidade(opts.fgInformado, {
    codigoGrupo,
    codigoProduto: opts.codigoProduto,
  });
}

module.exports = {
  GRUPOS_OBRIGATORIO_S,
  GRUPOS_OBRIGATORIO_N,
  PREFIXO_PARA_GRUPO,
  normalizarCodigoGrupo,
  grupoCodigoFromSku,
  fgValidadePorCodigoGrupo,
  fgValidadePorGrupoOuSku,
  aplicarFgControlaValidade,
  buscarCodigoGrupoPorCategoria,
  resolverFgControlaValidadeProduto,
};
