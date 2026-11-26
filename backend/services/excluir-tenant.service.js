'use strict';

const { listarGrupos, executarLimpeza, ajustarSequencias } = require('./limpeza-teste.service');

const NOME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function idsOperacao() {
  const ids = [];
  listarGrupos().forEach((g) => g.tabelas.forEach((t) => ids.push(t.id)));
  return ids;
}

async function tabelasDoTenant(client) {
  const r = await client.query(`
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND t.table_type = 'BASE TABLE'
       AND c.column_name IN ('TENANT_ID', 'tenant_id')
  `);
  const map = new Map();
  for (const row of r.rows) {
    if (!NOME.test(row.table_name) || !NOME.test(row.column_name)) continue;
    if (!map.has(row.table_name)) map.set(row.table_name, row.column_name);
  }
  return map;
}

async function chavesEstrangeiras(client) {
  const r = await client.query(`
    SELECT con.oid::text AS oid,
           cf.relname AS filho,
           af.attname AS col_filho,
           af.attnotnull AS filho_obrigatorio,
           cp.relname AS pai,
           ap.attname AS col_pai
      FROM pg_constraint con
      JOIN pg_class cf ON cf.oid = con.conrelid
      JOIN pg_class cp ON cp.oid = con.confrelid
      JOIN pg_namespace nf ON nf.oid = cf.relnamespace
      JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS fk(attnum, ord) ON true
      JOIN pg_attribute af ON af.attrelid = cf.oid AND af.attnum = fk.attnum
      JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS pk(attnum, ord) ON pk.ord = fk.ord
      JOIN pg_attribute ap ON ap.attrelid = cp.oid AND ap.attnum = pk.attnum
     WHERE con.contype = 'f' AND nf.nspname = 'public'
  `);
  const grupos = new Map();
  for (const row of r.rows) {
    if (!grupos.has(row.oid)) grupos.set(row.oid, []);
    grupos.get(row.oid).push(row);
  }
  return [...grupos.values()];
}

function ordemExclusao(tabelas, gruposFk) {
  const nomes = [...tabelas.keys()];
  const filhosDe = new Map(nomes.map((n) => [n, new Set()]));
  for (const cols of gruposFk) {
    const row = cols[0];
    if (!row || !tabelas.has(row.filho) || !tabelas.has(row.pai) || row.filho === row.pai) continue;
    filhosDe.get(row.pai).add(row.filho);
  }
  const ordem = [];
  const rest = new Set(nomes);
  let mudou = true;
  while (rest.size && mudou) {
    mudou = false;
    for (const nome of [...rest]) {
      const pendentes = [...filhosDe.get(nome)].filter((d) => rest.has(d));
      if (pendentes.length === 0) {
        ordem.push(nome);
        rest.delete(nome);
        mudou = true;
      }
    }
  }
  for (const nome of rest) ordem.push(nome);
  return ordem;
}

const VINCULOS_USUARIO = new Set([
  'USUARIOATIVIDADE',
  'USUARIOEMPRESA',
  'USUARIOFILIAL',
  'USUARIOLOGACAO',
  'USUARIOLOGACESSO',
]);

async function apagarDependentes(client, tenantId, tabelas, gruposFk) {
  for (const cols of gruposFk) {
    if (cols.length !== 1) continue;
    const row = cols[0];
    if (!tabelas.has(row.pai)) continue;
    if (![row.filho, row.col_filho, row.col_pai, row.pai].every((n) => NOME.test(n))) continue;
    const colPai = tabelas.get(row.pai);
    const colFilho = tabelas.get(row.filho);
    const vinculo = VINCULOS_USUARIO.has(row.filho);
    if (!row.filho_obrigatorio && !vinculo) continue;
    const filtro = vinculo || !colFilho
      ? ''
      : `AND (f."${colFilho}" IS NULL OR TRIM(f."${colFilho}"::text) = '' OR TRIM(f."${colFilho}"::text) = $1)`;
    await client.query(
      `DELETE FROM "${row.filho}" f
        WHERE f."${row.col_filho}" IN (
          SELECT p."${row.col_pai}" FROM "${row.pai}" p WHERE TRIM(p."${colPai}"::text) = $1
        )
        ${filtro}`,
      [tenantId]
    );
  }
}

async function soltarReferencias(client, tenantId, tabelas, gruposFk) {
  for (const cols of gruposFk) {
    if (cols.length !== 1) continue;
    const row = cols[0];
    if (row.filho_obrigatorio) continue;
    if (!tabelas.has(row.pai)) continue;
    if (![row.filho, row.col_filho, row.col_pai, row.pai].every((n) => NOME.test(n))) continue;
    const colPai = tabelas.get(row.pai);
    const colFilho = tabelas.get(row.filho);
    const filtroFilho = colFilho
      ? `AND TRIM(f."${colFilho}"::text) IS DISTINCT FROM $1`
      : '';
    await client.query(
      `UPDATE "${row.filho}" f
          SET "${row.col_filho}" = NULL
        WHERE f."${row.col_filho}" IN (
          SELECT p."${row.col_pai}" FROM "${row.pai}" p WHERE TRIM(p."${colPai}"::text) = $1
        )
        ${filtroFilho}`,
      [tenantId]
    );
  }
}

async function excluirTenantCompleto(pool, tenantId) {
  const tid = String(tenantId || '').trim();
  if (!tid) {
    const err = new Error('Informe o tenant.');
    err.status = 400;
    throw err;
  }
  if (tid.toLowerCase() === 'default') {
    const err = new Error('A instalação padrão não pode ser excluída.');
    err.status = 403;
    throw err;
  }

  await executarLimpeza(pool, tid, idsOperacao());

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tabelas = await tabelasDoTenant(client);
    const gruposFk = await chavesEstrangeiras(client);
    await soltarReferencias(client, tid, tabelas, gruposFk);
    await apagarDependentes(client, tid, tabelas, gruposFk);
    const ordem = ordemExclusao(tabelas, gruposFk);
    const apagados = [];
    for (const tabela of ordem) {
      const coluna = tabelas.get(tabela);
      const r = await client.query(
        `DELETE FROM "${tabela}" WHERE TRIM("${coluna}"::text) = $1`,
        [tid]
      );
      if (r.rowCount) apagados.push({ tabela, n: r.rowCount });
    }
    await client.query('COMMIT');
    try {
      await ajustarSequencias(client, apagados.map((a) => a.tabela));
    } catch (e) {
      /* as linhas já saíram */
    }
    return { tenantId: tid, apagados };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* já desfeito */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { excluirTenantCompleto };
