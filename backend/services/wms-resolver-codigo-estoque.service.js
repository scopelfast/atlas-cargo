'use strict';

const {
  applyProductMask,
  codigoProdutoMatchKey,
  resolveCodigoProdutoDono,
} = require('../utils/wms-codigo-produto-mask');

function tableMissing(err) {
  return err && err.code === '42P01';
}

function mapOperacionalRow(row) {
  const fator = Number(row.FATOR_CONVERSAO);
  const codigoEstoque = String(row.CODIGO_ESTOQUE || row.CODIGO || '').trim();
  return {
    cdProduto: parseInt(row.CD_PRODUTO, 10),
    codigoEstoque,
    codigoOperacional: row.CODIGO_OPERACIONAL,
    fatorConversao: Number.isFinite(fator) && fator > 0 ? fator : 1,
    indiceArred: row.INDICE_ARRED != null ? Number(row.INDICE_ARRED) : null,
    unidade: row.UNIDADE || null,
    nmProduto: row.NM_PRODUTO || null,
    fgControlaLote: row.FG_CONTROLA_LOTE,
    fgControlaValidade: row.FG_CONTROLA_VALIDADE,
    origem: 'OPERACIONAL',
  };
}

/** Ex.: "…-CX 2500UN" → 2500 (capacidade declarada no nome OL). */
function parseVolumeUnFromNome(nome) {
  const m = String(nome || '').match(/(\d+)\s*UN\b/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * CX/FD no espelho com fator 1 no cadastro, mas irmão na árvore OL (mesma família
 * 62111631…) com fator > 1 para o PC base (.00). Ex.: 6211163160 (2 CX) × 25 = 50 PC.
 */
async function aplicarConversaoEmbalagemFamiliaOl(db, tenantId, cdDono, hit) {
  if (!hit || hit.origem !== 'OPERACIONAL' || hit.fatorConversao !== 1) return hit;
  const um = String(hit.unidade || '').trim().toUpperCase();
  if (um !== 'CX' && um !== 'FD') return hit;

  const codOp = codigoProdutoMatchKey(hit.codigoOperacional);
  const codEst = codigoProdutoMatchKey(hit.codigoEstoque);
  // Vínculo identidade (op = estoque, ex. 6030512820 ↔ 6.03.05.128.20): NÃO promover
  // para irmão .00 da família (quebrava conferência / etiqueta ao gravar .20).
  if (codOp && codEst && codOp === codEst) return hit;
  if (!codOp || codOp.length < 8) return hit;
  const famPrefix = codOp.slice(0, 8);

  const r = await db.query(
    `SELECT o."CD_PRODUTO", o."CODIGO_ESTOQUE", o."FATOR_CONVERSAO",
            p."NOME" AS "NM_PRODUTO",
            COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
            COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_OPERACIONAL" o
       INNER JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
      WHERE o."TENANT_ID" = $1
        AND o."CD_DONO" = $2::integer
        AND COALESCE(o."FGACTIVE", 'S') = 'S'
        AND COALESCE(p."FGACTIVE", 'S') = 'S'
        AND o."FATOR_CONVERSAO" > 1
        AND LENGTH(regexp_replace(TRIM(o."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g')) = LENGTH($3::text)
        AND LEFT(regexp_replace(TRIM(o."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g'), 8) = $4
      ORDER BY o."FATOR_CONVERSAO" DESC
      LIMIT 1`,
    [tenantId, cdDono, codOp, famPrefix]
  );
  if (!r.rows[0]) return hit;

  const sib = r.rows[0];
  const cxVol = parseVolumeUnFromNome(hit.nmProduto);
  const pcVol = parseVolumeUnFromNome(sib.NM_PRODUTO);
  let fator = Number(sib.FATOR_CONVERSAO);
  if (cxVol && pcVol && pcVol > 0) {
    const calc = cxVol / pcVol;
    if (Number.isFinite(calc) && calc > 0) fator = calc;
  }
  if (!Number.isFinite(fator) || fator <= 0) return hit;

  return {
    ...hit,
    cdProduto: parseInt(sib.CD_PRODUTO, 10),
    codigoEstoque: String(sib.CODIGO_ESTOQUE || '').trim(),
    fatorConversao: Number(fator.toFixed(6)),
    nmProduto: sib.NM_PRODUTO || hit.nmProduto || null,
    fgControlaLote: sib.FG_CONTROLA_LOTE,
    fgControlaValidade: sib.FG_CONTROLA_VALIDADE,
    conversaoFamiliaOl: true,
  };
}

/** Catálogo OL: código do espelho (ex. caixa .60) → código de estoque + fator (ex. pacote .00 × 25). */
async function buscarVinculoOperacional(db, tenantId, cdDono, codigoTrim, chave, codigoMascarado, chaveMask, modo) {
  let filtro = '';
  let params;
  if (modo === 'operacional') {
    filtro = `(
      LOWER(TRIM(o."CODIGO_OPERACIONAL")) = LOWER(TRIM($3::text))
      OR LOWER(regexp_replace(TRIM(o."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g')) = $4
    )`;
    params = [tenantId, cdDono, codigoTrim, chave];
  } else if (modo === 'estoque_igual') {
    filtro = `(
      LOWER(TRIM(o."CODIGO_ESTOQUE")) = LOWER(TRIM($3::text))
      OR LOWER(regexp_replace(TRIM(o."CODIGO_ESTOQUE"), '[^0-9A-Za-z]', '', 'g')) = $4
    )
    AND LOWER(TRIM(o."CODIGO_OPERACIONAL")) = LOWER(TRIM(o."CODIGO_ESTOQUE"))`;
    params = [tenantId, cdDono, codigoMascarado, chaveMask || chave];
  } else {
    return null;
  }
  const rOp = await db.query(
    `SELECT o."CD_PRODUTO", o."CODIGO_ESTOQUE", o."CODIGO_OPERACIONAL", o."UNIDADE",
            o."FATOR_CONVERSAO", o."INDICE_ARRED",
            p."CODIGO", p."NOME" AS "NM_PRODUTO",
            COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
            COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_OPERACIONAL" o
       INNER JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
      WHERE o."TENANT_ID" = $1 AND o."CD_DONO" = $2::integer
        AND COALESCE(o."FGACTIVE", 'S') = 'S'
        AND COALESCE(p."FGACTIVE", 'S') = 'S'
        AND ${filtro}
      ORDER BY o."FATOR_CONVERSAO" DESC NULLS LAST
      LIMIT 1`,
    params
  );
  return rOp.rows[0] ? mapOperacionalRow(rOp.rows[0]) : null;
}

function mapEstoqueDiretoRow(row, codigoTrim) {
  return {
    cdProduto: parseInt(row.CD_PRODUTO, 10),
    codigoEstoque: row.CODIGO,
    codigoOperacional: codigoTrim,
    fatorConversao: 1,
    indiceArred: null,
    unidade: row.UNIDADE || null,
    nmProduto: row.NM_PRODUTO || row.NOME || null,
    fgControlaLote: row.FG_CONTROLA_LOTE,
    fgControlaValidade: row.FG_CONTROLA_VALIDADE,
    origem: 'ESTOQUE_DIRETO',
  };
}

/**
 * Resolve qualquer código informado (NF, OPL, inventário, operacional) para o produto de ESTOQUE.
 * @returns {Promise<null|{
 *   cdProduto: number,
 *   codigoEstoque: string,
 *   codigoOperacional: string|null,
 *   fatorConversao: number,
 *   indiceArred: number|null,
 *   unidade: string|null,
 *   origem: 'ESTOQUE_DIRETO'|'OPERACIONAL'|'DEPARA_EXTERNO'
 * }>}
 */
async function resolverProdutoEstoque(db, tenantId, cdDono, codigoRaw, opts = {}) {
  const codigoTrim = codigoRaw != null ? String(codigoRaw).trim() : '';
  if (!codigoTrim || !Number.isFinite(cdDono)) return null;

  const codigoMascarado = await resolveCodigoProdutoDono(db, tenantId, cdDono, codigoTrim);
  if (!codigoMascarado) return null;

  const chave = codigoProdutoMatchKey(codigoTrim);
  const chaveMask = codigoProdutoMatchKey(codigoMascarado);

  /** Estoque direto ANTES do operacional: se o operador digitou o código de
   *  produto dono (ex. 6.03.05.128.20), não pode cair na conversão de família OL
   *  que reescreve CX .20 → irmão .00 (recebimento/etiquetas). */
  const rEst = await db.query(
    `SELECT p."CD_PRODUTO", p."CODIGO", p."UNIDADE", p."NOME" AS "NM_PRODUTO",
            COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
            COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_DONO" p
      WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
        AND COALESCE(p."FGACTIVE", 'S') = 'S'
        AND (
          LOWER(TRIM(p."CODIGO")) = LOWER(TRIM($3::text))
          OR LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) = $4
        )
      LIMIT 1`,
    [tenantId, cdDono, codigoMascarado, chaveMask || chave]
  );
  if (rEst.rows[0]) {
    return mapEstoqueDiretoRow(rEst.rows[0], codigoTrim);
  }

  try {
    const opOl = await buscarVinculoOperacional(
      db,
      tenantId,
      cdDono,
      codigoTrim,
      chave,
      codigoMascarado,
      chaveMask,
      'operacional'
    );
    if (opOl) {
      try {
        return await aplicarConversaoEmbalagemFamiliaOl(db, tenantId, cdDono, opOl);
      } catch (e) {
        if (!tableMissing(e)) throw e;
        return opOl;
      }
    }
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }

  try {
    const opBase = await buscarVinculoOperacional(
      db,
      tenantId,
      cdDono,
      codigoTrim,
      chave,
      codigoMascarado,
      chaveMask,
      'estoque_igual'
    );
    if (opBase) return opBase;
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }

  if (opts.codigoExterno) {
    const ext = String(opts.codigoExterno).trim();
    const rDep = await db.query(
      `SELECT d."CODIGO_INTERNO", d."FATOR_CONVERSAO"
         FROM "WMS_DEPARA_PRODUTO" d
        WHERE d."TENANT_ID" = $1 AND d."CD_DONO" = $2::integer
          AND COALESCE(d."FGACTIVE", 'S') = 'S'
          AND LOWER(TRIM(d."CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
        LIMIT 1`,
      [tenantId, cdDono, ext]
    );
    if (rDep.rows[0]) {
      const interno = rDep.rows[0].CODIGO_INTERNO;
      const fatorDep = Number(rDep.rows[0].FATOR_CONVERSAO);
      const nested = await resolverProdutoEstoque(db, tenantId, cdDono, interno, {});
      if (nested) {
        const fMult = Number.isFinite(fatorDep) && fatorDep > 0 ? fatorDep : 1;
        return {
          ...nested,
          fatorConversao: Number((nested.fatorConversao * fMult).toFixed(6)),
          origem: 'DEPARA_EXTERNO',
        };
      }
    }
  }

  return null;
}

/** Mapa código (lower/chave) → linha estoque para conferência em lote. */
async function carregarMapaProdutosEstoque(db, tenantId, cdDono, codigosLista) {
  const map = new Map();
  const unicos = [...new Set((codigosLista || []).map((c) => String(c || '').trim()).filter(Boolean))];
  for (const cod of unicos) {
    const hit = await resolverProdutoEstoque(db, tenantId, cdDono, cod, {});
    if (!hit) continue;
    const cfg = {
      CD_PRODUTO: hit.cdProduto,
      CODIGO: hit.codigoEstoque,
      FG_CONTROLA_LOTE: hit.fgControlaLote,
      FG_CONTROLA_VALIDADE: hit.fgControlaValidade,
      FATOR_CONVERSAO: hit.fatorConversao,
    };
    map.set(String(cod).trim().toLowerCase(), cfg);
    map.set(codigoProdutoMatchKey(cod), cfg);
    map.set(codigoProdutoMatchKey(hit.codigoEstoque), cfg);
    if (hit.codigoOperacional) {
      map.set(codigoProdutoMatchKey(hit.codigoOperacional), cfg);
    }
  }
  return map;
}

function resolverCfgDoMapa(p, mapByKey, cfgById) {
  // Código digitado na tela tem prioridade sobre cdProduto antigo da conferência
  // (ex.: usuário troca 6.21.05.105.60 → .20; o ID antigo não pode sobrescrever).
  const cp = String(p?.codigoProduto ?? '').trim();
  if (cp) {
    const byCode =
      mapByKey.get(cp.toLowerCase()) || mapByKey.get(codigoProdutoMatchKey(cp)) || null;
    if (byCode) return byCode;
  }
  if (p?.cdProduto != null && String(p.cdProduto).trim() !== '') {
    const id = parseInt(p.cdProduto, 10);
    if (Number.isFinite(id) && cfgById && cfgById.has(id)) return cfgById.get(id);
  }
  return null;
}

module.exports = {
  resolverProdutoEstoque,
  carregarMapaProdutosEstoque,
  resolverCfgDoMapa,
  applyProductMask,
  codigoProdutoMatchKey,
};
