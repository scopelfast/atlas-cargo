'use strict';

/**
 * Cadastro automático a partir da revisão do espelho OPL.
 * Cria cadastro principal (WMS_PRODUTO_DONO no código de estoque) e de-para OPL → estoque
 * quando o catálogo operacional OL (WMS_PRODUTO_OPERACIONAL) já define o vínculo.
 */

const { pool } = require('../config/db');
const { resolveCodigoProdutoDono } = require('../utils/wms-codigo-produto-mask');
const { resolverProdutoEstoque } = require('./wms-resolver-codigo-estoque.service');
const {
  chaveCanonicaDigitosOl,
  mascaraCodigoOl,
  classificarConservacaoDetalhe,
  digitosCodigoOl,
  expandirChavesDigitosCodigoOl,
} = require('./wms-opl-relatorio-romaneio.service');
const { auditarCadastroProdutosEspelhoOpl } = require('./wms-opl-auditoria-cadastro-import.service');
const {
  carregarMapaProdutosDonoPorDigitos,
  prepararConsultaDigitosOl,
} = require('./wms-produto-mapa-codigo.service');
const { resolverFgControlaValidadeProduto } = require('./wms-controla-validade-grupo.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function deparaLookupKeysFromCodigoOl(cod) {
  const raw = String(cod != null ? cod : '').trim();
  if (!raw) return [];
  const keys = new Set([raw.toLowerCase()]);
  const dig = digitosCodigoOl(raw);
  if (dig) keys.add(dig.toLowerCase());
  const mask = mascaraCodigoOl(raw);
  if (mask) keys.add(mask.toLowerCase());
  for (const v of expandirChavesDigitosCodigoOl(dig || raw)) {
    if (v) keys.add(String(v).toLowerCase());
  }
  return [...keys];
}

function normTipoArmazenagem(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'SECO' || t === 'REFRIGERADO' || t === 'CONGELADO') return t;
  if (t === 'FRIO' || t === 'RESFRIADO') return 'REFRIGERADO';
  return null;
}

function inferirTipoArmazenagem(descricao, inferidoRomaneio) {
  const fromRom = normTipoArmazenagem(inferidoRomaneio);
  if (fromRom && fromRom !== 'SECO') return fromRom;
  const det = classificarConservacaoDetalhe(descricao, null);
  if (det.bucket === 'REFRIG_CONG') {
    return det.frioTipo === 'CONGELADO' ? 'CONGELADO' : 'REFRIGERADO';
  }
  return 'SECO';
}

async function carregarImportacaoCompleta(tenantId, cdOplArquivo) {
  const rA = await pool.query(
    `SELECT * FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
    [cdOplArquivo, tenantId]
  );
  if (!rA.rows.length) return null;
  const rP = await pool.query(
    `SELECT * FROM "WMS_OPL_PEDIDO" WHERE "CD_OPL_ARQUIVO" = $1::integer ORDER BY "SEQ_PEDIDO"`,
    [cdOplArquivo]
  );
  const pedidos = [];
  for (const row of rP.rows) {
    const rI = await pool.query(
      `SELECT * FROM "WMS_OPL_ITEM" WHERE "CD_OPL_PEDIDO" = $1::integer ORDER BY "SEQ_ITEM"`,
      [row.CD_OPL_PEDIDO]
    );
    pedidos.push({ ...row, itens: rI.rows });
  }
  return { arquivo: rA.rows[0], pedidos };
}

async function nomeDonoEstoque(tenantId, cdDono) {
  const r = await pool.query(
    `SELECT "NOME" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer`,
    [tenantId, cdDono]
  );
  return r.rows[0]?.NOME ? String(r.rows[0].NOME).trim() : '';
}

async function carregarCadastroEmOutrosDonos(tenantId, cdDonoEspelho, digitosList) {
  const { uniq, allQuery, toCanonical } = prepararConsultaDigitosOl(digitosList);
  if (!uniq.length || !allQuery.length || cdDonoEspelho == null) return {};
  try {
    const r = await pool.query(
      `SELECT regexp_replace(trim(pr."CODIGO"), '[^0-9]', '', 'g') AS d,
              pr."CD_DONO", pr."CD_PRODUTO", pr."CODIGO", pr."NOME", pr."UNIDADE",
              pr."CODIGO_BARRAS", pr."NCM", pr."PESO_KG", pr."TIPO_ARMAZENAGEM", pr."CD_CATEGORIA",
              pr."FG_DESCARTAVEL", pr."FG_CONTROLA_LOTE", pr."FG_CONTROLA_VALIDADE",
              o."NOME" AS "NM_DONO"
         FROM "WMS_PRODUTO_DONO" pr
         JOIN "WMS_DONO_ESTOQUE" o
           ON o."TENANT_ID" = pr."TENANT_ID" AND o."CD_DONO" = pr."CD_DONO"
        WHERE pr."TENANT_ID" = $1
          AND pr."FGACTIVE" = 'S'
          AND pr."CD_DONO" IS DISTINCT FROM $2::integer
          AND regexp_replace(trim(pr."CODIGO"), '[^0-9]', '', 'g') = ANY($3::text[])
        ORDER BY d, pr."CD_DONO"`,
      [tenantId, cdDonoEspelho, allQuery]
    );
    const out = {};
    for (const row of r.rows) {
      if (!row.d) continue;
      const d = String(row.d);
      let canonical = toCanonical.get(d);
      if (!canonical) {
        for (const u of uniq) {
          if (expandirChavesDigitosCodigoOl(u).includes(d)) {
            canonical = chaveCanonicaDigitosOl(u) || u;
            break;
          }
        }
      }
      if (!canonical) continue;
      if (!out[canonical]) out[canonical] = [];
      const dup = out[canonical].some((x) => x.cdDono === row.CD_DONO);
      if (!dup) {
        out[canonical].push({
          cdDono: row.CD_DONO,
          nmDono: row.NM_DONO || '',
          produto: row,
        });
      }
    }
    return out;
  } catch (e) {
    if (schemaMissing(e)) return {};
    throw e;
  }
}

/** Enriquece mapa de cadastro considerando operacional + de-para (como cobertura/picking). */
async function carregarMapaProdutosDonoResolvidoOpl(tenantId, cdDono, data) {
  const digitos = [];
  const codigosOl = [];
  for (const p of data.pedidos || []) {
    for (const it of p.itens || []) {
      const cod = String(it.COD_PRODUTO_OL ?? it.codProdutoOl ?? '').trim();
      if (!cod) continue;
      codigosOl.push(cod);
      const d = chaveCanonicaDigitosOl(cod);
      if (d) digitos.push(d);
    }
  }
  const mapa = await carregarMapaProdutosDonoPorDigitos(tenantId, cdDono, [...new Set(digitos)]);
  for (const cod of [...new Set(codigosOl)]) {
    const dkey = chaveCanonicaDigitosOl(cod);
    if (!dkey || mapa[dkey]) continue;
    try {
      const hit = await resolverProdutoEstoque(pool, tenantId, cdDono, cod, { codigoExterno: cod });
      if (!hit) continue;
      const r = await pool.query(
        `SELECT p."TIPO_ARMAZENAGEM", p."NCM", p."CODIGO", p."CD_PRODUTO",
                c."NOME" AS "NM_CATEGORIA", g."NOME" AS "NM_GRUPO", p."PESO_KG"
           FROM "WMS_PRODUTO_DONO" p
           LEFT JOIN "WMS_CATEGORIA_PRODUTO" c ON c."CD_CATEGORIA" = p."CD_CATEGORIA" AND c."TENANT_ID" = p."TENANT_ID"
           LEFT JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = p."TENANT_ID"
          WHERE p."CD_PRODUTO" = $1::integer AND p."TENANT_ID" = $2`,
        [hit.cdProduto, tenantId]
      );
      if (r.rows[0]) {
        mapa[dkey] = {
          TIPO_ARMAZENAGEM: r.rows[0].TIPO_ARMAZENAGEM,
          NCM: r.rows[0].NCM,
          CODIGO: r.rows[0].CODIGO,
          CD_PRODUTO: r.rows[0].CD_PRODUTO,
          NM_CATEGORIA: r.rows[0].NM_CATEGORIA,
          NM_GRUPO: r.rows[0].NM_GRUPO,
          PESO_KG: r.rows[0].PESO_KG,
          _resolvidoVia: hit.origem,
        };
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  return mapa;
}

async function auditarCadastroEspelhoOpl(tenantId, cdDono, data) {
  const digitos = [];
  for (const p of data.pedidos || []) {
    for (const it of p.itens || []) {
      const d = chaveCanonicaDigitosOl(it.COD_PRODUTO_OL ?? it.codProdutoOl);
      if (d) digitos.push(d);
    }
  }
  const produtoPorDigitos = await carregarMapaProdutosDonoResolvidoOpl(tenantId, cdDono, data);
  const digitosSemNoDono = [...new Set(digitos)].filter((d) => !produtoPorDigitos[d]);
  const porDigitosOutrosDonos = digitosSemNoDono.length
    ? await carregarCadastroEmOutrosDonos(tenantId, cdDono, digitosSemNoDono)
    : {};
  const nmDonoEspelho = await nomeDonoEstoque(tenantId, cdDono);
  return auditarCadastroProdutosEspelhoOpl(data, produtoPorDigitos, {
    cdDonoEspelho: cdDono,
    nmDonoEspelho,
    porDigitosOutrosDonos: Object.fromEntries(
      Object.entries(porDigitosOutrosDonos).map(([k, v]) => [
        k,
        v.map((x) => ({ cdDono: x.cdDono, nmDono: x.nmDono })),
      ])
    ),
  });
}

async function buscarOperacionalPorCodigoOl(client, tenantId, cdDono, codigoOl) {
  const keys = deparaLookupKeysFromCodigoOl(codigoOl);
  if (!keys.length) return null;
  try {
    const r = await client.query(
      `SELECT o."CD_OPERACIONAL", o."CD_PRODUTO", o."CODIGO_OPERACIONAL", o."CODIGO_ESTOQUE",
              o."FATOR_CONVERSAO", o."UNIDADE", o."INDICE_ARRED",
              p."CODIGO" AS "CODIGO_PRODUTO", p."NOME" AS "NOME_PRODUTO",
              p."TIPO_ARMAZENAGEM", p."NCM", p."PESO_KG", p."CD_CATEGORIA",
              p."UNIDADE" AS "UNIDADE_PRODUTO"
         FROM "WMS_PRODUTO_OPERACIONAL" o
         LEFT JOIN "WMS_PRODUTO_DONO" p
           ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
        WHERE o."TENANT_ID" = $1 AND o."CD_DONO" = $2::integer
          AND COALESCE(o."FGACTIVE", 'S') = 'S'
          AND LOWER(TRIM(o."CODIGO_OPERACIONAL")) = ANY($3::text[])
        ORDER BY o."CD_OPERACIONAL"
        LIMIT 1`,
      [tenantId, cdDono, keys]
    );
    return r.rows[0] || null;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

async function buscarProdutoPorCodigo(client, tenantId, cdDono, codigoRaw) {
  const codigo = await resolveCodigoProdutoDono(client, tenantId, cdDono, codigoRaw);
  if (!codigo) return null;
  const r = await client.query(
    `SELECT * FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
        AND (
          LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
          OR LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g'))
             = LOWER(regexp_replace(TRIM($3::text), '[^0-9A-Za-z]', '', 'g'))
        )
        AND COALESCE("FGACTIVE", 'S') = 'S'
      LIMIT 1`,
    [tenantId, cdDono, codigo]
  );
  return r.rows[0] || null;
}

async function deparaExiste(client, tenantId, cdDono, codigoExterno) {
  const keys = deparaLookupKeysFromCodigoOl(codigoExterno);
  if (!keys.length) return false;
  try {
    const r = await client.query(
      `SELECT 1 FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
          AND COALESCE("FGACTIVE", 'S') = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])
        LIMIT 1`,
      [tenantId, cdDono, keys]
    );
    return r.rows.length > 0;
  } catch (e) {
    if (schemaMissing(e)) return false;
    throw e;
  }
}

async function buscarProdutoOutroDonoPorDigitos(client, tenantId, cdDonoEspelho, digitos) {
  const outros = await carregarCadastroEmOutrosDonos(tenantId, cdDonoEspelho, [digitos]);
  const lista = outros[digitos] || outros[chaveCanonicaDigitosOl(digitos)] || [];
  return lista[0] || null;
}

function montarPlanoOperacional(item, op, prodEstoque, codigoEstoqueMask) {
  const passos = [];
  const tipoArm = inferirTipoArmazenagem(item.descricao, item.inferidoRomaneio);
  const fator = Number(op.FATOR_CONVERSAO) > 0 ? Number(op.FATOR_CONVERSAO) : 1;
  const codigoExterno = String(op.CODIGO_OPERACIONAL || item.codigoOl).trim();

  if (!prodEstoque) {
    passos.push({
      acao: 'CRIAR_PRODUTO',
      codigo: codigoEstoqueMask,
      nome: op.NOME_PRODUTO || item.descricao || codigoEstoqueMask,
      unidade: op.UNIDADE_PRODUTO || op.UNIDADE || 'UN',
      tipoArmazenagem: op.TIPO_ARMAZENAGEM || tipoArm,
      ncm: op.NCM || null,
      pesoKg: op.PESO_KG != null ? Number(op.PESO_KG) : null,
      cdCategoria: op.CD_CATEGORIA || null,
      origemCadastro: 'IMPORT_OL',
      observacao: 'Cadastro principal (estoque) — espelho OPL',
    });
  }

  passos.push({
    acao: 'CRIAR_DEPARA',
    codigoExterno,
    codigoInterno: codigoEstoqueMask,
    fatorConversao: fator,
    observacao: 'De-para OPL → estoque (catálogo operacional OL)',
    jaExiste: false,
  });

  if (prodEstoque && !String(prodEstoque.TIPO_ARMAZENAGEM || '').trim()) {
    passos.push({
      acao: 'ATUALIZAR_CONSERVACAO',
      codigo: codigoEstoqueMask,
      cdProduto: prodEstoque.CD_PRODUTO,
      tipoArmazenagem: tipoArm,
    });
  }

  return {
    codigoOpl: item.codigoOl,
    codigoMascara: item.codigoMascara || mascaraCodigoOl(item.codigoOl),
    descricao: item.descricao,
    codigoEstoque: codigoEstoqueMask,
    controleEstoque: codigoEstoqueMask,
    fatorConversao: fator,
    origemPlano: 'OPERACIONAL_OL',
    passos,
    aplicavel: true,
    resumo: `OPL ${item.codigoMascara || item.codigoOl} → estoque ${codigoEstoqueMask} (fator ${fator})`,
  };
}

async function buscarEstoqueIrmaoPorPrefixoOl(client, tenantId, cdDono, codigoOl) {
  const dig = digitosCodigoOl(codigoOl);
  if (!dig || dig.length < 8) return null;
  const prefix = dig.slice(0, -2);
  try {
    const r = await client.query(
      `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."UNIDADE", p."NCM", p."PESO_KG",
              p."TIPO_ARMAZENAGEM", p."CD_CATEGORIA",
              regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') AS d
         FROM "WMS_PRODUTO_DONO" p
        WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
          AND COALESCE(p."FGACTIVE", 'S') = 'S'
          AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') LIKE $3
          AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') <> $4
        ORDER BY
          CASE WHEN regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') LIKE $5 THEN 0 ELSE 1 END,
          p."CODIGO"
        LIMIT 5`,
      [tenantId, cdDono, `${prefix}%`, dig, `${prefix}40`]
    );
    const best =
      r.rows.find((row) => String(row.d || '').endsWith('40')) ||
      r.rows.find((row) => String(row.d || '').endsWith('00')) ||
      r.rows[0];
    if (!best) return null;
    let fator = 1;
    try {
      const ro = await client.query(
        `SELECT o."FATOR_CONVERSAO"
           FROM "WMS_PRODUTO_OPERACIONAL" o
          WHERE o."TENANT_ID" = $1 AND o."CD_DONO" = $2::integer
            AND LOWER(TRIM(o."CODIGO_OPERACIONAL")) = ANY($3::text[])
          LIMIT 1`,
        [tenantId, cdDono, deparaLookupKeysFromCodigoOl(codigoOl)]
      );
      if (ro.rows[0]) {
        const f = Number(ro.rows[0].FATOR_CONVERSAO);
        if (Number.isFinite(f) && f > 0) fator = f;
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
    return { produto: best, codigoEstoque: best.CODIGO, fator, origemHeuristica: true };
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

async function planificarItem(client, tenantId, cdDono, item, categoria) {
  const digitos = item.digitos || chaveCanonicaDigitosOl(item.codigoOl);
  const op = await buscarOperacionalPorCodigoOl(client, tenantId, cdDono, item.codigoOl);

  if (op && op.CODIGO_ESTOQUE) {
    const codigoEstoqueMask = await resolveCodigoProdutoDono(
      client,
      tenantId,
      cdDono,
      String(op.CODIGO_ESTOQUE).trim()
    );
    let prodEstoque = await buscarProdutoPorCodigo(client, tenantId, cdDono, codigoEstoqueMask);
    if (!prodEstoque && op.CD_PRODUTO) {
      const r = await client.query(
        `SELECT * FROM "WMS_PRODUTO_DONO"
          WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2 AND COALESCE("FGACTIVE", 'S') = 'S'`,
        [op.CD_PRODUTO, tenantId]
      );
      prodEstoque = r.rows[0] || null;
    }
    const plano = montarPlanoOperacional(item, op, prodEstoque, codigoEstoqueMask);
    const depPasso = plano.passos.find((p) => p.acao === 'CRIAR_DEPARA');
    if (depPasso && (await deparaExiste(client, tenantId, cdDono, depPasso.codigoExterno))) {
      depPasso.jaExiste = true;
      depPasso.observacao = 'De-para já cadastrado — nenhuma ação necessária';
    }
    if (!plano.passos.some((p) => p.acao === 'CRIAR_PRODUTO') && plano.passos.every((p) => p.jaExiste || p.acao === 'ATUALIZAR_CONSERVACAO')) {
      if (!plano.passos.some((p) => p.acao === 'ATUALIZAR_CONSERVACAO')) {
        plano.aplicavel = false;
        plano.resumo = `Já resolvido: estoque ${codigoEstoqueMask} + de-para OPL`;
      }
    }
    return plano;
  }

  if (categoria === 'sem_cadastro') {
    const irmao = await buscarEstoqueIrmaoPorPrefixoOl(client, tenantId, cdDono, item.codigoOl);
    if (irmao && irmao.produto) {
      const codigoEstoqueMask = await resolveCodigoProdutoDono(
        client,
        tenantId,
        cdDono,
        String(irmao.codigoEstoque).trim()
      );
      const passos = [
        {
          acao: 'CRIAR_DEPARA',
          codigoExterno: String(item.codigoOl).trim(),
          codigoInterno: codigoEstoqueMask,
          fatorConversao: irmao.fator || 1,
          observacao: irmao.origemHeuristica
            ? 'De-para OPL → estoque (código irmão no cadastro — ex. .42 → .40)'
            : 'De-para OPL → estoque',
          jaExiste: false,
        },
      ];
      if (await deparaExiste(client, tenantId, cdDono, item.codigoOl)) {
        passos[0].jaExiste = true;
      }
      return {
        codigoOpl: item.codigoOl,
        codigoMascara: item.codigoMascara || mascaraCodigoOl(item.codigoOl),
        descricao: item.descricao,
        codigoEstoque: codigoEstoqueMask,
        controleEstoque: codigoEstoqueMask,
        fatorConversao: irmao.fator || 1,
        origemPlano: 'ESTOQUE_IRMAO',
        passos,
        aplicavel: !passos[0].jaExiste,
        resumo: `OPL ${item.codigoMascara || item.codigoOl} → estoque ${codigoEstoqueMask} (controle de saldo)`,
      };
    }
  }

  if (categoria === 'cadastrado_outro_dono' && item.cadastroOutrosDonos?.length) {
    const hit = await buscarProdutoOutroDonoPorDigitos(client, tenantId, cdDono, digitos);
    if (hit && hit.produto) {
      const p = hit.produto;
      const codigoMask = await resolveCodigoProdutoDono(client, tenantId, cdDono, p.CODIGO);
      const tipoArm = inferirTipoArmazenagem(item.descricao, item.inferidoRomaneio);
      const passos = [
        {
          acao: 'CRIAR_PRODUTO',
          codigo: codigoMask,
          nome: p.NOME || item.descricao,
          unidade: p.UNIDADE || 'UN',
          tipoArmazenagem: p.TIPO_ARMAZENAGEM || tipoArm,
          ncm: p.NCM,
          pesoKg: p.PESO_KG,
          cdCategoria: p.CD_CATEGORIA,
          origemCadastro: 'IMPORT_OL',
          observacao: `Copiado do dono ${hit.nmDono} (${hit.cdDono})`,
        },
        {
          acao: 'CRIAR_DEPARA',
          codigoExterno: String(item.codigoOl).trim(),
          codigoInterno: codigoMask,
          fatorConversao: 1,
          observacao: 'De-para identidade OPL → estoque (cópia de outro dono)',
        },
      ];
      return {
        codigoOpl: item.codigoOl,
        descricao: item.descricao,
        codigoEstoque: codigoMask,
        controleEstoque: codigoMask,
        origemPlano: 'COPIA_OUTRO_DONO',
        passos,
        aplicavel: true,
        resumo: `Copiar cadastro de ${hit.nmDono} → ${codigoMask}`,
      };
    }
  }

  if (categoria === 'sem_conservacao') {
    const prod = await buscarProdutoPorCodigo(client, tenantId, cdDono, item.codigoMascara || item.codigoOl);
    if (prod) {
      const tipoArm = inferirTipoArmazenagem(item.descricao, item.inferidoRomaneio);
      return {
        codigoOpl: item.codigoOl,
        descricao: item.descricao,
        codigoEstoque: prod.CODIGO,
        controleEstoque: prod.CODIGO,
        origemPlano: 'CONSERVACAO',
        passos: [
          {
            acao: 'ATUALIZAR_CONSERVACAO',
            cdProduto: prod.CD_PRODUTO,
            codigo: prod.CODIGO,
            tipoArmazenagem: tipoArm,
          },
        ],
        aplicavel: true,
        resumo: `Definir conservação ${tipoArm} em ${prod.CODIGO}`,
      };
    }
  }

  return {
    codigoOpl: item.codigoOl,
    descricao: item.descricao,
    codigoEstoque: null,
    controleEstoque: null,
    origemPlano: 'SEM_FONTE',
    passos: [],
    aplicavel: false,
    resumo: 'Sem catálogo operacional OL — cadastre manualmente ou importe o catálogo.',
  };
}

async function simularCadastroAutomaticoOpl(tenantId, cdOplArquivo) {
  const data = await carregarImportacaoCompleta(tenantId, cdOplArquivo);
  if (!data) return { err: 'Importação não encontrada.', status: 404 };
  const cdDono = data.arquivo?.CD_DONO;
  if (cdDono == null || !Number.isFinite(Number(cdDono))) {
    return { err: 'Espelho sem dono associado.', status: 400 };
  }
  const auditoriaAntes = await auditarCadastroEspelhoOpl(tenantId, cdDono, data);
  const client = await pool.connect();
  try {
    const itens = [];
    const grupos = [
      ['sem_cadastro', auditoriaAntes.itens?.sem_cadastro],
      ['cadastrado_outro_dono', auditoriaAntes.itens?.cadastrado_outro_dono],
      ['sem_conservacao', auditoriaAntes.itens?.sem_conservacao],
    ];
    for (const [cat, lista] of grupos) {
      for (const item of lista || []) {
        itens.push({ ...(await planificarItem(client, tenantId, cdDono, item, cat)), categoria: cat });
      }
    }
    const aplicaveis = itens.filter((i) => i.aplicavel && i.passos.length);
    const resumo = {
      totalAnalisados: itens.length,
      aplicaveis: aplicaveis.length,
      ignorados: itens.length - aplicaveis.length,
      criarProduto: aplicaveis.reduce(
        (n, i) => n + i.passos.filter((p) => p.acao === 'CRIAR_PRODUTO').length,
        0
      ),
      criarDepara: aplicaveis.reduce(
        (n, i) => n + i.passos.filter((p) => p.acao === 'CRIAR_DEPARA' && !p.jaExiste).length,
        0
      ),
      atualizarConservacao: aplicaveis.reduce(
        (n, i) => n + i.passos.filter((p) => p.acao === 'ATUALIZAR_CONSERVACAO').length,
        0
      ),
    };
    return {
      ok: true,
      cdOplArquivo,
      cdDono,
      nmDono: await nomeDonoEstoque(tenantId, cdDono),
      resumo,
      itens,
      auditoriaAntes,
      mensagem:
        aplicaveis.length === 0
          ? 'Nenhum cadastro automático disponível para os alertas atuais.'
          : `${aplicaveis.length} item(ns) prontos — confira cadastro principal (estoque) e de-para antes de aplicar.`,
    };
  } finally {
    client.release();
  }
}

async function executarPasso(client, tenantId, cdDono, passo, sgUser) {
  if (passo.acao === 'CRIAR_PRODUTO') {
    const dup = await buscarProdutoPorCodigo(client, tenantId, cdDono, passo.codigo);
    if (dup) return { acao: passo.acao, codigo: passo.codigo, status: 'ja_existia', cdProduto: dup.CD_PRODUTO };
    const fgVal = await resolverFgControlaValidadeProduto(client, {
      tenantId,
      cdCategoria: passo.cdCategoria,
      codigoProduto: passo.codigo,
      fgInformado: 'N',
    });
    const r = await client.query(
      `INSERT INTO "WMS_PRODUTO_DONO" (
         "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "NCM", "PESO_KG",
         "TIPO_ARMAZENAGEM", "CD_CATEGORIA", "ORIGEM_CADASTRO", "FG_FORNECEDOR_REF",
         "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE", "FGACTIVE", "SG_USER"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'N', 'N', 'N', $12, 'S', $11)
       RETURNING "CD_PRODUTO", "CODIGO"`,
      [
        tenantId,
        cdDono,
        passo.codigo,
        passo.nome,
        passo.unidade || 'UN',
        passo.ncm,
        passo.pesoKg,
        passo.tipoArmazenagem || 'SECO',
        passo.cdCategoria,
        passo.origemCadastro || 'IMPORT_OL',
        sgUser,
        fgVal,
      ]
    );
    return { acao: passo.acao, codigo: passo.codigo, status: 'criado', cdProduto: r.rows[0].CD_PRODUTO };
  }

  if (passo.acao === 'CRIAR_DEPARA') {
    if (passo.jaExiste) return { acao: passo.acao, codigoExterno: passo.codigoExterno, status: 'ja_existia' };
    if (await deparaExiste(client, tenantId, cdDono, passo.codigoExterno)) {
      return { acao: passo.acao, codigoExterno: passo.codigoExterno, status: 'ja_existia' };
    }
    const interno = await resolveCodigoProdutoDono(client, tenantId, cdDono, passo.codigoInterno);
    const r = await client.query(
      `INSERT INTO "WMS_DEPARA_PRODUTO" (
         "TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO",
         "OBSERVACAO", "FGACTIVE", "SG_USER"
       ) VALUES ($1, $2, $3, $4, $5, $6, 'S', $7)
       RETURNING "CD_DEPARA"`,
      [
        tenantId,
        cdDono,
        String(passo.codigoExterno).trim(),
        interno,
        passo.fatorConversao || 1,
        passo.observacao || 'Cadastro automático — espelho OPL',
        sgUser,
      ]
    );
    return {
      acao: passo.acao,
      codigoExterno: passo.codigoExterno,
      codigoInterno: interno,
      status: 'criado',
      cdDepara: r.rows[0].CD_DEPARA,
    };
  }

  if (passo.acao === 'ATUALIZAR_CONSERVACAO') {
    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "TIPO_ARMAZENAGEM" = $3, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $4
        WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2`,
      [passo.cdProduto, tenantId, passo.tipoArmazenagem, sgUser]
    );
    return { acao: passo.acao, codigo: passo.codigo, status: 'atualizado', tipo: passo.tipoArmazenagem };
  }

  return { acao: passo.acao, status: 'ignorado' };
}

async function aplicarCadastroAutomaticoOpl(tenantId, cdOplArquivo, sgUser, opts = {}) {
  const sim = await simularCadastroAutomaticoOpl(tenantId, cdOplArquivo);
  if (sim.err) return sim;
  const codigosFiltro = opts.codigos ? new Set(opts.codigos.map((c) => String(c).trim())) : null;
  const aplicaveis = (sim.itens || []).filter(
    (i) =>
      i.aplicavel &&
      i.passos.length &&
      (!codigosFiltro || codigosFiltro.has(String(i.codigoOpl).trim()))
  );
  if (!aplicaveis.length) {
    return { ok: true, aplicados: 0, resultados: [], auditoriaDepois: sim.auditoriaAntes, mensagem: 'Nada a aplicar.' };
  }

  const client = await pool.connect();
  const resultados = [];
  try {
    await client.query('BEGIN');
    for (const item of aplicaveis) {
      const itemRes = { codigoOpl: item.codigoOpl, codigoEstoque: item.codigoEstoque, passos: [] };
      for (const passo of item.passos) {
        if (passo.jaExiste) continue;
        itemRes.passos.push(await executarPasso(client, tenantId, sim.cdDono, passo, sgUser));
      }
      resultados.push(itemRes);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[WMS OPL] aplicarCadastroAutomaticoOpl:', e);
    return { err: e.message || 'Erro ao aplicar cadastro automático.', status: 500 };
  } finally {
    client.release();
  }

  const data = await carregarImportacaoCompleta(tenantId, cdOplArquivo);
  const auditoriaDepois = await auditarCadastroEspelhoOpl(tenantId, sim.cdDono, data);
  return {
    ok: true,
    aplicados: resultados.length,
    resultados,
    auditoriaDepois,
    resumo: sim.resumo,
    mensagem: `Cadastro automático aplicado em ${resultados.length} item(ns). Revise a auditoria.`,
  };
}

module.exports = {
  auditarCadastroEspelhoOpl,
  simularCadastroAutomaticoOpl,
  aplicarCadastroAutomaticoOpl,
  carregarMapaProdutosDonoResolvidoOpl,
};
