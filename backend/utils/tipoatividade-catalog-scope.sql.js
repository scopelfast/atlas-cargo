'use strict';

/** @type {boolean | undefined} undefined = ainda não consultado */
let _hasTenantCol;
/** @type {Promise<boolean> | null} */
let _hasTenantColPromise = null;

/**
 * Verifica se existe coluna TENANT_ID em TIPOATIVIDADE (migration SaaS).
 * Resultado em cache no processo.
 * @param {import('pg').Pool} pool
 */
async function tipoatividadeHasTenantIdColumn(pool) {
  if (_hasTenantCol !== undefined) return _hasTenantCol;
  if (!_hasTenantColPromise) {
    _hasTenantColPromise = pool
      .query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
           AND LOWER(table_name) = 'tipoatividade'
           AND LOWER(column_name) = 'tenant_id'
         LIMIT 1`
      )
      .then((r) => {
        _hasTenantCol = !!(r.rows && r.rows.length > 0);
        return _hasTenantCol;
      })
      .catch(() => {
        _hasTenantCol = false;
        return false;
      });
  }
  return _hasTenantColPromise;
}

/** Para testes ou após aplicar DDL (forçar nova leitura). */
function resetTipoatividadeTenantColumnCache() {
  _hasTenantCol = undefined;
  _hasTenantColPromise = null;
}

/**
 * Escopo de catálogo TIPOATIVIDADE por usuário:
 * - linha do próprio tenant do usuário; ou
 * - linha do tenant default, se não existir linha com o mesmo CDTIPOATIVIDADE no tenant do usuário.
 *
 * @param {string} tAlias — alias da tabela TIPOATIVIDADE (ex.: t ou "TA")
 * @param {string} uAlias — alias da tabela USUARIO (ex.: u ou "U_TARGET")
 * @param {string} defPlaceholder — placeholder do tenant default (@defTenant ou $3)
 */
function buildTipoRowVisibleFragment(tAlias, uAlias, defPlaceholder) {
  const tidExpr = `COALESCE(NULLIF(TRIM(${uAlias}."TENANT_ID"), ''), ${defPlaceholder})`;
  return `(
  ${tAlias}."TENANT_ID" = ${tidExpr}
  OR (
    ${tAlias}."TENANT_ID" = ${defPlaceholder}
    AND NOT EXISTS (
      SELECT 1 FROM "TIPOATIVIDADE" t_own
      WHERE t_own."CDTIPOATIVIDADE" = ${tAlias}."CDTIPOATIVIDADE"
        AND t_own."TENANT_ID" = ${tidExpr}
    )
  )
)`;
}

function tipoRowVisibleForUserSql(tAlias, uAlias, defPlaceholder) {
  return buildTipoRowVisibleFragment(tAlias, uAlias, defPlaceholder);
}

/**
 * Mesma regra que {@link tipoRowVisibleForUserSql}, mas compatível com banco sem coluna TENANT_ID em TIPOATIVIDADE.
 * Usa o fragmento interno diretamente (evita ReferenceError por ordem/circularidade de módulos).
 * @param {import('pg').Pool} pool
 */
async function tipoRowVisibleForUserClause(pool, tAlias, uAlias, defPlaceholder) {
  const has = await tipoatividadeHasTenantIdColumn(pool);
  if (!has) return 'TRUE';
  return buildTipoRowVisibleFragment(tAlias, uAlias, defPlaceholder);
}

/**
 * Mesma regra, sem JOIN em USUARIO: @tenantAt é o tenant "dono" da lista (ex.: req.tenantId).
 * Estilo SQL Server / conversor pg ([dbo].).
 */
function tipoCatalogVisibleForTenantMs(tAlias, tenantAt, defAt) {
  return `(
  ${tAlias}.[TENANT_ID] = ${tenantAt}
  OR (
    ${tAlias}.[TENANT_ID] = ${defAt}
    AND NOT EXISTS (
      SELECT 1 FROM [dbo].[TIPOATIVIDADE] t_own
      WHERE t_own.[CDTIPOATIVIDADE] = ${tAlias}.[CDTIPOATIVIDADE]
        AND t_own.[TENANT_ID] = ${tenantAt}
    )
  )
)`;
}

/**
 * WHERE de catálogo por tenant sem referenciar TENANT_ID se a coluna não existir.
 * @param {import('pg').Pool} pool
 */
async function tipoCatalogVisibleForTenantClause(pool, tAlias, tenantAt, defAt) {
  const has = await tipoatividadeHasTenantIdColumn(pool);
  if (!has) return 'TRUE';
  return tipoCatalogVisibleForTenantMs(tAlias, tenantAt, defAt);
}

module.exports = {
  tipoRowVisibleForUserSql,
  tipoRowVisibleForUserClause,
  tipoatividadeHasTenantIdColumn,
  resetTipoatividadeTenantColumnCache,
  tipoCatalogVisibleForTenantMs,
  tipoCatalogVisibleForTenantClause,
};
