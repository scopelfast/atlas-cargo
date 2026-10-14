/**
 * Aplica máscara hierárquica do dono (ex.: 0.00.00.000.00) ao código do produto.
 * Mesma regra do front (estoque-cadastros-wms/js/script.js).
 */

function onlyAlphaNum(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

function applyProductMask(value, mask) {
  const m = String(mask || '').trim().toUpperCase();
  if (!m) return String(value || '').trim();
  const src = onlyAlphaNum(value);
  if (!src) return String(value || '').trim();
  let out = '';
  let p = 0;
  for (let i = 0; i < m.length; i++) {
    const ch = m.charAt(i);
    if (ch === '0' || ch === 'A' || ch === 'X') {
      while (p < src.length) {
        const c = src.charAt(p++);
        const ok =
          (ch === '0' && /[0-9]/.test(c)) ||
          (ch === 'A' && /[A-Z]/.test(c)) ||
          (ch === 'X' && /[0-9A-Z]/.test(c));
        if (ok) {
          out += c;
          break;
        }
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/** Chave para comparar códigos com ou sem máscara. */
function codigoProdutoMatchKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
}

/**
 * @param {import('pg').Pool|import('pg').PoolClient} db
 */
async function resolveCodigoProdutoDono(db, tenantId, cdDono, codigoRaw) {
  const codigo = codigoRaw != null ? String(codigoRaw).trim() : '';
  if (!codigo || codigo.length > 128) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(codigo)) return null;
  const r = await db.query(
    `SELECT NULLIF(TRIM("MASCARA_CODIGO_PRODUTO"), '') AS mask
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer`,
    [tenantId, cdDono]
  );
  const mask = r.rows[0]?.mask || null;
  const masked = applyProductMask(codigo, mask);
  return masked || codigo;
}

module.exports = {
  applyProductMask,
  codigoProdutoMatchKey,
  onlyAlphaNum,
  resolveCodigoProdutoDono,
};
