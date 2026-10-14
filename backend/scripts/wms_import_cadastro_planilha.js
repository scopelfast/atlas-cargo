#!/usr/bin/env node
'use strict';
/**
 * Atualiza cadastro WMS_PRODUTO_DONO (existente) a partir de pesos_produto.xlsx.
 * Nunca insere produto novo — só UPDATE por CD_PRODUTO.
 *
 * Campos: PESO_KG, TIPO_ARMAZENAGEM (conservação), CD_CATEGORIA, FG_DESCARTAVEL, FG_CONTROLA_VALIDADE.
 * Opcional: NOME (--atualizar-nome).
 *
 * Match seguro (máscara vs só dígitos):
 *   1) Chave alfanumérica igual (dígitos + letras do sufixo .AA)
 *   2) Senão, só dígitos — apenas se existir UM produto no dono com esses dígitos
 *
 * Uso:
 *   node scripts/wms_import_cadastro_planilha.js --arquivo "...\\pesos_produto.xlsx" --dry-run
 *   node scripts/wms_import_cadastro_planilha.js --arquivo "...\\pesos_produto.xlsx"
 *   node scripts/wms_import_cadastro_planilha.js --arquivo "..." --somente-cargas-abertas
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');

const SG_USER = 'IMPORT_PLANILHA_PESO';

const CLASSE_PARA_GRUPO = {
  CARNES: 1,
  DESCARTAVEL: 2,
  BEBIDAS: 3,
  GENEROS: 3,
  BOMBONIERE: 3,
  PANIFICACAO: 3,
  'LIMPEZA - QUIMICOS': 3,
  'LIMPEZA - UTILIDADES': 3,
  DESPESA: 3,
  'MAO OBRA': 3,
};

const CLASSE_SEM_VALIDADE = new Set([
  'LIMPEZA - QUIMICOS',
  'LIMPEZA - UTILIDADES',
  'DESCARTAVEL',
  'DESPESA',
  'MAO OBRA',
]);

const CLASSE_COM_VALIDADE = new Set(['CARNES', 'GENEROS', 'BEBIDAS', 'PANIFICACAO', 'BOMBONIERE']);

function parseArgs() {
  const out = {
    arquivo: '',
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    donos: [1, 2],
    dryRun: false,
    somenteCargasAbertas: false,
    atualizarNome: false,
    logPath: '',
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i].startsWith('--arquivo=')) out.arquivo = argv[i].slice('--arquivo='.length);
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--donos' && argv[i + 1]) {
      out.donos = argv[++i].split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
    } else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--somente-cargas-abertas') out.somenteCargasAbertas = true;
    else if (argv[i] === '--atualizar-nome') out.atualizarNome = true;
    else if (argv[i] === '--log' && argv[i + 1]) out.logPath = argv[++i];
  }
  if (!out.logPath) {
    out.logPath = path.join(
      process.cwd(),
      `wms_import_cadastro_${out.dryRun ? 'dryrun_' : ''}${Date.now()}.json`
    );
  }
  return out;
}

function codDig(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function codChave(v) {
  return String(v ?? '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toLowerCase();
}

function normPeso(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(3)) : null;
}

function mapConservacao(tipo, descricao) {
  const t = String(tipo || '').toLowerCase();
  const d = String(descricao || '').toLowerCase();
  if (t.includes('seco')) return 'SECO';
  if (d.includes('congel') || d.includes('-18') || d.includes(' ultra ')) return 'CONGELADO';
  if (t.includes('resfri') || t.includes('congel')) return 'REFRIGERADO';
  return 'SECO';
}

function mapDescartavel(classe, grupo) {
  const c = String(classe || '').toUpperCase().trim();
  const g = String(grupo || '').toUpperCase();
  if (c === 'DESCARTAVEL' || g.includes('DESCART')) return 'S';
  return 'N';
}

function mapValidade(classe, conservacao) {
  const c = String(classe || '').toUpperCase().trim();
  if (CLASSE_SEM_VALIDADE.has(c)) return 'N';
  if (conservacao === 'REFRIGERADO' || conservacao === 'CONGELADO') return 'S';
  if (CLASSE_COM_VALIDADE.has(c)) return 'S';
  return 'N';
}

function slugCodigoCategoria(classe) {
  return String(classe || 'GERAL')
    .toUpperCase()
    .replace(/[^0-9A-Z]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 20) || 'GERAL';
}

async function carregarDigitosCargasAbertas(client, tenant) {
  const r = await client.query(
    `SELECT DISTINCT regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g') AS d
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = $1
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = $1
      CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
            ) ln
      WHERE NOT EXISTS (
              SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
               WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
                 AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
            )
        AND trim(COALESCE(ln->>'cProd', '')) <> ''`,
    [tenant]
  );
  return new Set(r.rows.map((x) => x.d).filter(Boolean));
}

async function carregarIndiceProdutos(client, tenant, donos) {
  const r = await client.query(
    `SELECT "CD_PRODUTO", "CD_DONO", "CODIGO", "NOME", "PESO_KG",
            regexp_replace(trim("CODIGO"), '[^0-9]', '', 'g') AS dig,
            lower(regexp_replace(trim("CODIGO"), '[^0-9A-Za-z]', '', 'g')) AS chave
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" = ANY($2::int[])
        AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'`,
    [tenant, donos]
  );
  const porDonoChave = new Map();
  const porDonoDig = new Map();
  for (const row of r.rows) {
    const d = row.CD_DONO;
    if (!porDonoChave.has(d)) porDonoChave.set(d, new Map());
    if (!porDonoDig.has(d)) porDonoDig.set(d, new Map());
    porDonoChave.get(d).set(row.chave, row);
    const dig = row.dig;
    if (!porDonoDig.get(d).has(dig)) porDonoDig.set(d, new Map());
    const arr = porDonoDig.get(d).get(dig) || [];
    arr.push(row);
    porDonoDig.get(d).set(dig, arr);
  }
  return { porDonoChave, porDonoDig };
}

async function ensureCategoria(client, tenant, classe, cache) {
  const nome = String(classe || 'Geral').trim().slice(0, 120);
  const key = nome.toUpperCase();
  if (cache.has(key)) return cache.get(key);

  const exist = await client.query(
    `SELECT "CD_CATEGORIA" FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND UPPER(TRIM("NOME")) = UPPER(TRIM($2))
      LIMIT 1`,
    [tenant, nome]
  );
  if (exist.rows[0]) {
    cache.set(key, exist.rows[0].CD_CATEGORIA);
    return exist.rows[0].CD_CATEGORIA;
  }

  const cdGrupo = CLASSE_PARA_GRUPO[key] || 3;
  const codigo = slugCodigoCategoria(nome);
  try {
    const ins = await client.query(
      `INSERT INTO "WMS_CATEGORIA_PRODUTO" ("TENANT_ID", "CD_GRUPO", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "SG_USER")
       VALUES ($1, $2::integer, $3, $4, 0, 'S', $5)
       RETURNING "CD_CATEGORIA"`,
      [tenant, cdGrupo, codigo, nome, SG_USER]
    );
    if (ins.rows[0]) {
      cache.set(key, ins.rows[0].CD_CATEGORIA);
      return ins.rows[0].CD_CATEGORIA;
    }
  } catch (e) {
    if (e.code !== '23505') throw e;
  }
  const again = await client.query(
    `SELECT "CD_CATEGORIA" FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND ("CODIGO" = $2 OR UPPER(TRIM("NOME")) = UPPER(TRIM($3)))
      LIMIT 1`,
    [tenant, codigo, nome]
  );
  const id = again.rows[0]?.CD_CATEGORIA ?? 4;
  cache.set(key, id);
  return id;
}

function resolverProdutos(planRow, porDonoChave, porDonoDig, cdDono) {
  const chavePlan = codChave(planRow.codigoPlan);
  const digPlan = codDig(planRow.codigoPlan);
  const mapChave = porDonoChave.get(cdDono);
  const mapDig = porDonoDig.get(cdDono);
  if (mapChave?.has(chavePlan)) return [mapChave.get(chavePlan)];
  const arr = mapDig?.get(digPlan) || [];
  if (arr.length === 1) return arr;
  return arr.length > 1 ? { ambiguo: arr, dig: digPlan } : [];
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error('Uso: node scripts/wms_import_cadastro_planilha.js --arquivo pesos_produto.xlsx [--dry-run]');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(args.arquivo));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const map = new Map();
  for (const r of rows) {
    const codigoPlan = String(r.CODIGO ?? r.codigo ?? '').trim();
    const d = codDig(codigoPlan);
    if (!d) continue;
    const peso = normPeso(r.PESO ?? r.peso);
    if (peso == null) continue;
    const classe = String(r.CLASSE ?? r.classe ?? '').trim();
    const grupo = String(r.GRUPO ?? r.grupo ?? '').trim();
    const tipo = String(r.TIPO ?? r.tipo ?? '').trim();
    const nome = String(r.DESCRICAO ?? r.descricao ?? '').trim().slice(0, 255);
    const conservacao = mapConservacao(tipo, nome);
    map.set(d, {
      codigoPlan,
      peso,
      nome,
      classe,
      grupo,
      conservacao,
      fgDesc: mapDescartavel(classe, grupo),
      fgVal: mapValidade(classe, conservacao),
    });
  }

  const client = await pool.connect();
  const log = {
    tenant: args.tenant,
    dryRun: args.dryRun,
    somenteCargasAbertas: args.somenteCargasAbertas,
    linhasPlanilha: map.size,
    atualizados: [],
    ignoradosFiltro: 0,
    semProduto: [],
    ambiguos: [],
    erros: [],
  };

  let filtroCargas = null;
  if (args.somenteCargasAbertas) {
    filtroCargas = await carregarDigitosCargasAbertas(client, args.tenant);
    console.log('Filtro cargas abertas:', filtroCargas.size, 'SKUs');
  }

  const { porDonoChave, porDonoDig } = await carregarIndiceProdutos(client, args.tenant, args.donos);
  const cacheCat = new Map();

  try {
    await client.query('BEGIN');

    for (const [digPlan, info] of map.entries()) {
      if (filtroCargas && !filtroCargas.has(digPlan)) {
        log.ignoradosFiltro++;
        continue;
      }

      let cdCategoria = null;
      try {
        cdCategoria = await ensureCategoria(client, args.tenant, info.classe, cacheCat);
      } catch (e) {
        log.erros.push({ dig: digPlan, erro: `categoria: ${e.message}` });
        cdCategoria = 4;
      }

      for (const cdDono of args.donos) {
        const hit = resolverProdutos(info, porDonoChave, porDonoDig, cdDono);
        if (hit && hit.ambiguo) {
          log.ambiguos.push({
            dig: digPlan,
            cdDono,
            qtd: hit.ambiguo.length,
            codigos: hit.ambiguo.map((x) => x.CODIGO),
          });
          continue;
        }
        if (!hit || hit.length === 0) {
          log.semProduto.push({ dig: digPlan, cdDono });
          continue;
        }
        const prod = hit[0];
        const sets = [
          '"PESO_KG" = $1::numeric',
          '"TIPO_ARMAZENAGEM" = $2',
          '"CD_CATEGORIA" = $3::integer',
          '"FG_DESCARTAVEL" = $4',
          '"FG_CONTROLA_VALIDADE" = $5',
          '"DH_MAINTENANCE" = CURRENT_TIMESTAMP',
          '"SG_USER" = $6',
        ];
        const params = [info.peso, info.conservacao, cdCategoria, info.fgDesc, info.fgVal, SG_USER];
        let idx = 7;
        if (args.atualizarNome && info.nome) {
          sets.push(`"NOME" = $${idx}`);
          params.push(info.nome);
          idx++;
        }
        params.push(prod.CD_PRODUTO, args.tenant);
        const sql = `UPDATE "WMS_PRODUTO_DONO"
                        SET ${sets.join(', ')}
                      WHERE "CD_PRODUTO" = $${idx}::integer AND "TENANT_ID" = $${idx + 1}
                      RETURNING "CD_PRODUTO", "CODIGO", "PESO_KG", "TIPO_ARMAZENAGEM", "CD_CATEGORIA"`;

        if (args.dryRun) {
          log.atualizados.push({
            cdProduto: prod.CD_PRODUTO,
            cdDono,
            codigo: prod.CODIGO,
            peso: info.peso,
            conservacao: info.conservacao,
            categoria: cdCategoria,
            fgDesc: info.fgDesc,
            fgVal: info.fgVal,
          });
          continue;
        }
        const res = await client.query(sql, params);
        if (res.rowCount) log.atualizados.push(res.rows[0]);
      }
    }

    if (args.dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  fs.writeFileSync(args.logPath, JSON.stringify(log, null, 2), 'utf8');
  console.log('--- Resumo ---');
  console.log('Planilha (com peso):', map.size);
  console.log('Atualizados:', log.atualizados.length);
  console.log('Sem cadastro no dono:', log.semProduto.length);
  console.log('Ambíguos (não alterados):', log.ambiguos.length);
  console.log('Ignorados (filtro cargas):', log.ignoradosFiltro);
  console.log('Log:', args.logPath);
  console.log(args.dryRun ? 'DRY-RUN — nada gravado.' : 'COMMIT aplicado.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
