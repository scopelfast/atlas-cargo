'use strict';

const { codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');
const { indexarPlanilhaOl, ancestraisOl, nomeCategoriaWms, nomeCategoriaWmsNv3, nivelOl } =
  require('../utils/wms-ol-arvore');
const {
  montarMapaConservacaoClasseGrupo,
  resolverConservacaoProdutoOl,
} = require('../utils/wms-conservacao-ol');

/**
 * @typedef {Object} ClassificacaoEstoque
 * @property {number} cdCategoria
 * @property {string} tipoArmazenagem
 * @property {string} origemConservacao
 * @property {string} codigoOlNv4
 * @property {string} codigoEstoqueRaw
 */

async function upsertGrupoOl(client, tenantId, codigoOl, nome, ordem, sgUser, dryRun) {
  const codigo = String(codigoOl).trim().slice(0, 32);
  const nomeG = String(nome || codigo).trim().slice(0, 120);
  if (dryRun) return -1;
  const ex = await client.query(
    `SELECT "CD_GRUPO" FROM "WMS_GRUPO_PRODUTO"
      WHERE "TENANT_ID" = $1 AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($2::text))
      LIMIT 1`,
    [tenantId, codigo]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_GRUPO_PRODUTO"
          SET "NOME" = $2, "ORDEM" = $3, "FGACTIVE" = 'S',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $4
        WHERE "CD_GRUPO" = $1::integer`,
      [ex.rows[0].CD_GRUPO, nomeG, ordem, sgUser]
    );
    return parseInt(ex.rows[0].CD_GRUPO, 10);
  }
  const ins = await client.query(
    `INSERT INTO "WMS_GRUPO_PRODUTO" ("TENANT_ID", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "SG_USER")
     VALUES ($1, $2, $3, $4, 'S', $5)
     RETURNING "CD_GRUPO"`,
    [tenantId, codigo, nomeG, ordem, sgUser]
  );
  return parseInt(ins.rows[0].CD_GRUPO, 10);
}

async function upsertCategoriaOl(client, tenantId, cdGrupo, codigoOl, nome, ordem, sgUser, dryRun) {
  const codigo = String(codigoOl).trim().slice(0, 32);
  const nomeC = String(nome || codigo).trim().slice(0, 120);
  if (dryRun) return -1;
  const ex = await client.query(
    `SELECT "CD_CATEGORIA" FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND "CD_GRUPO" = $2::integer
        AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
      LIMIT 1`,
    [tenantId, cdGrupo, codigo]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_CATEGORIA_PRODUTO"
          SET "NOME" = $2, "ORDEM" = $3, "FGACTIVE" = 'S',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $4
        WHERE "CD_CATEGORIA" = $1::integer`,
      [ex.rows[0].CD_CATEGORIA, nomeC, ordem, sgUser]
    );
    return parseInt(ex.rows[0].CD_CATEGORIA, 10);
  }
  const ins = await client.query(
    `INSERT INTO "WMS_CATEGORIA_PRODUTO"
       ("TENANT_ID", "CD_GRUPO", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "SG_USER")
     VALUES ($1, $2::integer, $3, $4, $5, 'S', $6)
     RETURNING "CD_CATEGORIA"`,
    [tenantId, cdGrupo, codigo, nomeC, ordem, sgUser]
  );
  return parseInt(ins.rows[0].CD_CATEGORIA, 10);
}

/**
 * Atualiza categoria + conservação em todos os donos com o mesmo código de estoque (catálogo compartilhado).
 */
async function aplicarClassificacaoEmTodosDonos(client, tenantId, codigoEstoqueRaw, cdCategoria, tipoArm, sgUser, dryRun) {
  const key = codigoProdutoMatchKey(codigoEstoqueRaw);
  if (!key || dryRun) return 0;
  const r = await client.query(
    `UPDATE "WMS_PRODUTO_DONO" p
        SET "CD_CATEGORIA" = $3::integer,
            "TIPO_ARMAZENAGEM" = $4::text,
            "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
            "SG_USER" = $5::text
      WHERE p."TENANT_ID" = $1
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
        AND LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) = $2`,
    [tenantId, key, cdCategoria, tipoArm, sgUser]
  );
  return r.rowCount || 0;
}

/**
 * Importa hierarquia OL → Grupo (nv2) + Categoria (nv4) e mapa estoque → classificação.
 * @param {import('pg').PoolClient} client
 * @param {{ tenantId: string, rows: object[], dryRun?: boolean, sgUser?: string }} opts
 */
async function importarClassificacaoOl(client, opts) {
  const tenantId = String(opts.tenantId || '').trim();
  const rows = Array.isArray(opts.rows) ? opts.rows : [];
  const dryRun = !!opts.dryRun;
  const sgUser = String(opts.sgUser || 'import_ol_classificacao').slice(0, 32);

  const index = indexarPlanilhaOl(rows);
  const mapaClasseGrupo = montarMapaConservacaoClasseGrupo(rows);

  const stats = {
    gruposNovos: 0,
    gruposAtualizados: 0,
    categoriasNovas: 0,
    categoriasAtualizadas: 0,
    produtosMapeados: 0,
    linhasEstoqueAtualizadas: 0,
    conservacao: { SECO: 0, REFRIGERADO: 0, CONGELADO: 0 },
    semNv3: 0,
    semNv4: 0,
    erros: 0,
  };

  const grupoCache = new Map();
  const categoriaCache = new Map();
  /** @type {Map<string, ClassificacaoEstoque>} */
  const mapaEstoque = new Map();

  let ordemGrupo = 0;
  for (const node of index.byLevel[2] || []) {
    try {
      let existia = false;
      if (!dryRun) {
        const ex = await client.query(
          `SELECT 1 FROM "WMS_GRUPO_PRODUTO"
            WHERE "TENANT_ID" = $1 AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($2::text)) LIMIT 1`,
          [tenantId, node.cod]
        );
        existia = ex.rowCount > 0;
      }
      const cdGrupo = await upsertGrupoOl(
        client,
        tenantId,
        node.cod,
        node.nome,
        ordemGrupo++,
        sgUser,
        dryRun
      );
      grupoCache.set(node.cod, cdGrupo);
      if (existia) stats.gruposAtualizados++;
      else stats.gruposNovos++;
    } catch (e) {
      stats.erros++;
      if (stats.erros <= 3) console.error('[OL class] grupo', node.cod, e.message);
    }
  }

  let ordemCat = 0;
  /** Categorias no nv3 (grupo OL) — evita milhares de famílias nv4 em WMS_CATEGORIA_PRODUTO. */
  for (const node of index.byLevel[3] || []) {
    try {
      const anc = ancestraisOl(node.cod, index);
      if (!anc.n2) {
        stats.semNv3++;
        continue;
      }
      let cdGrupo = grupoCache.get(anc.n2.cod);
      if ((!cdGrupo || cdGrupo < 0) && !dryRun) {
        cdGrupo = await upsertGrupoOl(client, tenantId, anc.n2.cod, anc.n2.nome, 0, sgUser, false);
        grupoCache.set(anc.n2.cod, cdGrupo);
      }
      if (!dryRun && (!cdGrupo || cdGrupo < 0)) continue;

      const nomeCat = nomeCategoriaWmsNv3({ n2: anc.n2, n3: node });
      const cacheKey = anc.n2.cod + '|' + node.cod;
      let existia = false;
      if (!dryRun) {
        const cdG = grupoCache.get(anc.n2.cod);
        const ex = await client.query(
          `SELECT 1 FROM "WMS_CATEGORIA_PRODUTO"
            WHERE "TENANT_ID" = $1 AND "CD_GRUPO" = $2::integer
              AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text)) LIMIT 1`,
          [tenantId, cdG, node.cod]
        );
        existia = ex.rowCount > 0;
      }
      const cdCat = await upsertCategoriaOl(
        client,
        tenantId,
        cdGrupo,
        node.cod,
        nomeCat,
        ordemCat++,
        sgUser,
        dryRun
      );
      categoriaCache.set(cacheKey, cdCat);
      if (existia) stats.categoriasAtualizadas++;
      else stats.categoriasNovas++;
    } catch (e) {
      stats.erros++;
      if (stats.erros <= 3) console.error('[OL class] categoria', node.cod, e.message);
    }
  }

  for (const node of index.byLevel[5] || []) {
    const codEsto = String(node.row.CDPRODESTO || '').trim();
    const codOp = String(node.row.CDPRODUTO || '').trim();
    if (!codEsto) {
      stats.semNv4++;
      continue;
    }
    try {
      const anc = ancestraisOl(codOp, index);
      if (!anc.n3) {
        stats.semNv3++;
        stats.semNv4++;
        continue;
      }
      const cacheKey = (anc.n2 && anc.n2.cod) + '|' + anc.n3.cod;
      const cdCategoria = categoriaCache.get(cacheKey);
      if (!dryRun && (!cdCategoria || cdCategoria < 0)) continue;

      const { tipo, origem } = resolverConservacaoProdutoOl({
        nomeProduto: node.nome,
        ancestrais: {
          n2: anc.n2 && anc.n2.row,
          n3: anc.n3 && anc.n3.row,
          n4: anc.n4 && anc.n4.row,
        },
        mapaClasseGrupo,
      });

      const key = codigoProdutoMatchKey(codEsto);
      mapaEstoque.set(key, {
        cdCategoria: cdCategoria > 0 ? cdCategoria : 0,
        tipoArmazenagem: tipo,
        origemConservacao: origem,
        codigoOlNv3: anc.n3.cod,
        codigoOlNv4: anc.n4 ? anc.n4.cod : '',
        codigoEstoqueRaw: codEsto,
      });
      stats.conservacao[tipo] = (stats.conservacao[tipo] || 0) + 1;
      stats.produtosMapeados++;
    } catch (e) {
      stats.erros++;
    }
  }

  const filtroKeys = opts.somenteCodigosKeys || null;

  for (const info of mapaEstoque.values()) {
    const key = codigoProdutoMatchKey(info.codigoEstoqueRaw);
    if (filtroKeys && !filtroKeys.has(key)) continue;
    try {
      const n = await aplicarClassificacaoEmTodosDonos(
        client,
        tenantId,
        info.codigoEstoqueRaw,
        info.cdCategoria,
        info.tipoArmazenagem,
        sgUser,
        dryRun
      );
      stats.linhasEstoqueAtualizadas += n;
    } catch (e) {
      stats.erros++;
    }
  }

  return { stats, mapaEstoque, mapaClasseGrupo };
}

/**
 * Pré-visualização em memória (planilha OL) — categoria + conservação inferidas.
 */
function prepararPreviewClassificacaoOl(rows) {
  const index = indexarPlanilhaOl(rows);
  const mapaClasseGrupo = montarMapaConservacaoClasseGrupo(rows);
  const preview = [];
  const resumo = {
    totalNv5: 0,
    mapeaveis: 0,
    semNv3: 0,
    semNv4: 0,
    conservacao: { SECO: 0, REFRIGERADO: 0, CONGELADO: 0 },
  };

  for (const node of index.byLevel[5] || []) {
    resumo.totalNv5++;
    const codEsto = String(node.row.CDPRODESTO || '').trim();
    const codOp = String(node.cod || '').trim();
    if (!codEsto || !codOp) {
      resumo.semNv3++;
      continue;
    }
    const anc = ancestraisOl(codOp, index);
    if (!anc.n3) {
      resumo.semNv3++;
      continue;
    }
    const nomeCat = nomeCategoriaWmsNv3(anc);
    const { tipo, origem } = resolverConservacaoProdutoOl({
      nomeProduto: node.nome,
      ancestrais: {
        n2: anc.n2 && anc.n2.row,
        n3: anc.n3 && anc.n3.row,
        n4: anc.n4 && anc.n4.row,
      },
      mapaClasseGrupo,
    });
    resumo.mapeaveis++;
    resumo.conservacao[tipo] = (resumo.conservacao[tipo] || 0) + 1;
    preview.push({
      codigoEstoque: codEsto,
      codigoOl: codOp,
      nomeProduto: node.nome,
      classeOl: anc.n2 ? anc.n2.nome : '',
      codClasseOl: anc.n2 ? anc.n2.cod : '',
      grupoOl: anc.n3 ? anc.n3.nome : '',
      codGrupoOl: anc.n3 ? anc.n3.cod : '',
      familiaOl: anc.n4 ? anc.n4.nome : '',
      codFamiliaOl: anc.n4 ? anc.n4.cod : '',
      nomeCategoriaWms: nomeCat,
      tipoArmazenagem: tipo,
      origemConservacao: origem,
    });
  }

  return { preview, resumo };
}

async function listarPendenciasCadastro(db, opts) {
  const tenantId = String(opts.tenantId || '').trim();
  const lim = Math.min(2000, Math.max(1, parseInt(opts.limit, 10) || 500));
  const cdDono =
    opts.cdDono != null && String(opts.cdDono).trim() !== '' ? parseInt(String(opts.cdDono), 10) : null;
  const tipo = String(opts.tipo || 'pendente').trim().toLowerCase();

  const params = [tenantId];
  let i = 2;
  const filtroOperacional = `COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N' AND COALESCE(TRIM(UPPER(p."FGACTIVE")), 'S') = 'S'`;
  let filtro = ` AND ${filtroOperacional}`;
  if (tipo === 'sem_categoria') {
    filtro += ` AND p."CD_CATEGORIA" IS NULL`;
  } else if (tipo === 'sem_conservacao') {
    filtro += ` AND COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = ''`;
  } else {
    filtro += ` AND (p."CD_CATEGORIA" IS NULL OR COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = '')`;
  }
  if (cdDono != null) {
    filtro += ` AND p."CD_DONO" = $${i}::integer`;
    params.push(cdDono);
    i++;
  }
  params.push(lim);

  const r = await db.query(
    `SELECT
       p."CD_PRODUTO" AS "CD_PRODUTO",
       p."CD_DONO" AS "CD_DONO",
       o."NOME" AS "NM_DONO",
       p."CODIGO" AS "CODIGO",
       p."NOME" AS "NOME",
       p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
       p."CD_CATEGORIA" AS "CD_CATEGORIA",
       c."CODIGO" AS "CODIGO_CATEGORIA",
       c."NOME" AS "NM_CATEGORIA",
       g."NOME" AS "NM_GRUPO",
       CASE
         WHEN p."CD_CATEGORIA" IS NULL AND COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = '' THEN 'sem_categoria_e_conservacao'
         WHEN p."CD_CATEGORIA" IS NULL THEN 'sem_categoria'
         ELSE 'sem_conservacao'
       END AS "MOTIVO_PENDENCIA"
     FROM "WMS_PRODUTO_DONO" p
     INNER JOIN "WMS_DONO_ESTOQUE" o
       ON o."TENANT_ID" = p."TENANT_ID" AND o."CD_DONO" = p."CD_DONO"
     LEFT JOIN "WMS_CATEGORIA_PRODUTO" c
       ON c."TENANT_ID" = p."TENANT_ID" AND c."CD_CATEGORIA" = p."CD_CATEGORIA"
     LEFT JOIN "WMS_GRUPO_PRODUTO" g
       ON g."TENANT_ID" = c."TENANT_ID" AND g."CD_GRUPO" = c."CD_GRUPO"
     WHERE p."TENANT_ID" = $1
       ${filtro}
     ORDER BY p."CD_DONO", p."CODIGO"
     LIMIT $${i}::integer`,
    params
  );

  const rTot = await db.query(
    `SELECT
       COUNT(*)::integer AS total_produtos,
       COUNT(*) FILTER (WHERE ${filtroOperacional})::integer AS total_operacional,
       COUNT(*) FILTER (
         WHERE ${filtroOperacional} AND p."CD_CATEGORIA" IS NULL
       )::integer AS sem_categoria,
       COUNT(*) FILTER (
         WHERE ${filtroOperacional}
           AND COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = ''
       )::integer AS sem_conservacao,
       COUNT(*) FILTER (
         WHERE ${filtroOperacional}
           AND (p."CD_CATEGORIA" IS NULL OR COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = '')
       )::integer AS pendente
     FROM "WMS_PRODUTO_DONO" p
     WHERE p."TENANT_ID" = $1`,
    [tenantId]
  );

  return { rows: r.rows || [], resumo: rTot.rows[0] || {} };
}

async function listarDonosAtivos(client, tenantId) {
  const r = await client.query(
    `SELECT "CD_DONO" AS "CD_DONO", "NOME" AS "NOME"
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND COALESCE(TRIM(UPPER("FGACTIVE")), 'S') = 'S'
      ORDER BY "CD_DONO"`,
    [tenantId]
  );
  return r.rows || [];
}

module.exports = {
  importarClassificacaoOl,
  aplicarClassificacaoEmTodosDonos,
  prepararPreviewClassificacaoOl,
  listarPendenciasCadastro,
  listarDonosAtivos,
  upsertGrupoOl,
  upsertCategoriaOl,
};
