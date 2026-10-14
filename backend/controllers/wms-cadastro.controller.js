'use strict';

const { XMLParser } = require('fast-xml-parser');
const multer = require('multer');
const { pool } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { resolveCodigoProdutoDono, codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');
const categoriaSug = require('../services/wms-categoria-sugestao.service');
const { listarHistoricoJobCategoria } = require('../services/wms-categoria-sugestao-log.service');
const { executarCicloCategoriaAltaConfianca } = require('../jobs/wms-categoria-sugestao-job');
const olClass = require('../services/wms-import-ol-classificacao.service');
const { parseOlXlsxBuffer } = require('../utils/wms-ol-xlsx');
const prodOp = require('../services/wms-produto-operacional.service');
const {
  resolverFgControlaValidadeProduto,
  aplicarFgControlaValidade,
} = require('../services/wms-controla-validade-grupo.service');

const MAX_XML_IMPORT_FILES = 2000;
const uploadProdutosXml = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: MAX_XML_IMPORT_FILES,
    fieldSize: 2 * 1024 * 1024,
  },
}).fields([
  { name: 'arquivos', maxCount: MAX_XML_IMPORT_FILES },
  { name: 'files', maxCount: MAX_XML_IMPORT_FILES },
]);

const uploadOlXlsx = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 28 * 1024 * 1024, files: 1 },
}).single('arquivo');

function multerFilesToArray(req) {
  const raw = req.files;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  const out = [];
  if (raw.arquivos) out.push(...raw.arquivos);
  if (raw.files) out.push(...raw.files);
  return out;
}

function mensagemErroMulterProdutosXml(err) {
  const code = err && err.code;
  if (code === 'LIMIT_FILE_COUNT') {
    return `Limite de arquivos por requisição excedido (máx. ${MAX_XML_IMPORT_FILES} XML). Divida a pasta em lotes menores.`;
  }
  if (code === 'LIMIT_FILE_SIZE') {
    return 'Um ou mais arquivos excedem 12 MB (limite por XML).';
  }
  if (code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Campo de upload inesperado. Envie os XML no campo padrão do formulário (nome do campo: arquivos).';
  }
  return err.message || 'Falha no upload dos XMLs.';
}

function tableMissing(err) {
  return err && err.code === '42P01';
}

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const DONO_DIAS_REL_VENC_PADRAO = 60;
const DONO_DIAS_MIN_VALID_RECEB_PADRAO = 90;
const DONO_DIAS_MIN = 1;
const DONO_DIAS_MAX = 1095;

/** Dias de política no dono (relatório de vencimento / mínimo na entrada). */
function parseDiasDonoPolitica(raw, defVal, label) {
  if (raw == null || raw === '') return defVal;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < DONO_DIAS_MIN || n > DONO_DIAS_MAX) {
    const err = new Error(`${label}: informe um número entre ${DONO_DIAS_MIN} e ${DONO_DIAS_MAX} dias.`);
    err.code = 'VALID';
    throw err;
  }
  return n;
}

function normCodigo(v) {
  const s = v != null ? String(v).trim() : '';
  if (!s) return '';
  if (s.length > 32) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s;
}

/** Código no XML/fornecedor (até 64 caracteres, sem controle rígido de charset). */
function normCodigoExterno(v) {
  const s = v != null ? String(v).trim() : '';
  if (!s || s.length > 64) return null;
  return s;
}

/** Código interno do dono (máscara hierárquica com pontos — até 128 caracteres). */
function normCodigoInterno(v) {
  const s = v != null ? String(v).trim() : '';
  if (!s || s.length > 128) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(s)) return null;
  return s;
}

/**
 * Filtro "contém" em coluna de código: aceita máscara com pontos ou só dígitos/letras (ex. 60301 → 6.03.01.132.20).
 * @returns {{ sql: string, params: unknown[], nextIndex: number }}
 */
function appendSqlFiltroCodigoContem(sql, params, colExpr, codigoRaw, paramIndex) {
  const raw = String(codigoRaw || '').trim();
  if (!raw) return { sql, params, nextIndex: paramIndex };
  const dig = codigoProdutoMatchKey(raw);
  const likeLit = `%${raw}%`;
  if (dig) {
    sql += ` AND (
      UPPER(TRIM(${colExpr})) LIKE UPPER($${paramIndex})
      OR LOWER(regexp_replace(TRIM(${colExpr}), '[^0-9A-Za-z]', '', 'g')) LIKE $${paramIndex + 1}
    )`;
    params.push(likeLit, `%${dig}%`);
    return { sql, params, nextIndex: paramIndex + 2 };
  }
  sql += ` AND UPPER(TRIM(${colExpr})) LIKE UPPER($${paramIndex})`;
  params.push(likeLit);
  return { sql, params, nextIndex: paramIndex + 1 };
}

/** Filtro de código no grid de produto do dono (estoque + operacional, com ou sem pontos). */
function appendSqlFiltroCodigoProdutoDono(sql, params, codigoRaw, paramIndex) {
  const raw = String(codigoRaw || '').trim();
  if (!raw) return { sql, params, nextIndex: paramIndex };
  const dig = codigoProdutoMatchKey(raw);
  if (!dig) {
    return appendSqlFiltroCodigoContem(sql, params, 'p."CODIGO"', raw, paramIndex);
  }
  const likeLit = `%${raw}%`;
  const digLike = `%${dig}%`;
  sql += ` AND (
    UPPER(TRIM(p."CODIGO")) LIKE UPPER($${paramIndex})
    OR LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) LIKE $${paramIndex + 1}
    OR EXISTS (
      SELECT 1 FROM "WMS_PRODUTO_OPERACIONAL" op
       WHERE op."TENANT_ID" = p."TENANT_ID"
         AND op."CD_PRODUTO" = p."CD_PRODUTO"
         AND COALESCE(op."FGACTIVE", 'S') = 'S'
         AND (
           UPPER(TRIM(op."CODIGO_OPERACIONAL")) LIKE UPPER($${paramIndex})
           OR UPPER(TRIM(op."CODIGO_ESTOQUE")) LIKE UPPER($${paramIndex})
           OR LOWER(regexp_replace(TRIM(op."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g')) LIKE $${paramIndex + 1}
           OR LOWER(regexp_replace(TRIM(op."CODIGO_ESTOQUE"), '[^0-9A-Za-z]', '', 'g')) LIKE $${paramIndex + 1}
         )
    )
  )`;
  params.push(likeLit, digLike);
  return { sql, params, nextIndex: paramIndex + 2 };
}

/** Mesmo SKU lógico (com ou sem máscara/pontos no CODIGO). */
async function buscarConflitoSkuProdutoDono(db, tid, cdDono, codigo, excludeCdProduto) {
  const params = [tid, cdDono, codigo];
  let sql = `
    SELECT "CD_PRODUTO", "NOME", "CODIGO"
      FROM "WMS_PRODUTO_DONO"
     WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
       AND (
         LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
         OR LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g'))
            = LOWER(regexp_replace(TRIM($3::text), '[^0-9A-Za-z]', '', 'g'))
       )`;
  if (Number.isFinite(excludeCdProduto)) {
    sql += ` AND "CD_PRODUTO" <> $4::integer`;
    params.push(excludeCdProduto);
  }
  sql += ' ORDER BY "CD_PRODUTO" LIMIT 2';
  const r = await db.query(sql, params);
  return r.rows || [];
}

function respostaSkuDuplicado(cdSolicitado, cdDono, codigo, rows) {
  const outros = rows
    .map((row) => {
      const idDup = row.CD_PRODUTO ?? row.cd_produto;
      const nmDup = row.NOME ?? row.nome;
      const codDup = row.CODIGO ?? row.codigo;
      return `#${idDup} "${codDup}" (${nmDup != null && String(nmDup).trim() !== '' ? String(nmDup) : '?'})`;
    })
    .join(', ');
  const idPrimeiro = rows[0].CD_PRODUTO ?? rows[0].cd_produto;
  const nmConflito = rows[0].NOME ?? rows[0].nome ?? '';
  return {
    status: 409,
    body: {
      error:
        `Duplicidade de SKU: você está salvando o produto #${cdSolicitado}, mas o dono ${cdDono} e o código "${codigo}" ` +
        `(mesmos dígitos com ou sem máscara) já estão no cadastro ${outros}. Só pode existir um. ` +
        `Abra e edite o #${idPrimeiro}; não crie outro registro com o mesmo SKU.`,
      codigoErro: 'WMS_SKU_DUPLICADO',
      cdProdutoSolicitado: cdSolicitado,
      cdProdutoConflito: idPrimeiro,
      nomeProdutoConflito: nmConflito,
    },
  };
}

function normFator(v) {
  if (v === undefined || v === null || v === '') return 1;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function normCgc(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 0) return null;
  if (d.length > 14) return null;
  return d;
}

function normDocFiscal(v) {
  const d = normCgc(v);
  if (!d) return null;
  if (d.length <= 11) return d.padStart(11, '0').slice(-11);
  return d.padStart(14, '0').slice(-14);
}

function normMask(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (s.length > 40) return null;
  if (!/^[0-9A-Za-z#._-]+$/.test(s)) return null;
  return s;
}

function normNcm(v) {
  if (v == null || String(v).trim() === '') return null;
  const d = String(v).replace(/\D/g, '');
  if (d.length === 0) return null;
  if (d.length > 8) return null;
  return d;
}

function normPesoKg(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normValorReferencia(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function normTipoArmazenagem(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['SECO', 'REFRIGERADO', 'CONGELADO'].includes(s)) return s;
  return null;
}

async function listarSugestoesCategoriaProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDonoRaw = req.query.cdDono;
    const cdDono = cdDonoRaw != null && String(cdDonoRaw).trim() !== '' ? parseInt(cdDonoRaw, 10) : null;
    if (cdDonoRaw != null && String(cdDonoRaw).trim() !== '' && !Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'cdDono inválido.' });
    }
    if (cdDono != null) {
      const okDono = await assertDonoTenant(pool, tid, cdDono);
      if (!okDono) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    }
    const out = await categoriaSug.listarSugestoesCategoria(pool, {
      tenantId: tid,
      modo: req.query.modo,
      cdDono,
      tipoArmazenagem: req.query.tipoArmazenagem ?? req.query.tipo_armazenagem,
      limit: req.query.limit,
    });
    res.json(out);
  } catch (err) {
    if (err.code === 'VALID') return res.status(400).json({ error: err.message });
    if (err.code === 'TIMEOUT') return res.status(504).json({ error: err.message });
    if (schemaMissing(err) || categoriaSug.schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos/categorias desatualizada. Execute os scripts WMS de cadastro no banco.',
      });
    }
    console.error('[WMS] listarSugestoesCategoriaProduto:', err);
    res.status(500).json({ error: 'Erro ao listar sugestões de categoria.' });
  }
}

async function aplicarSugestoesCategoriaProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const itens = Array.isArray(req.body && req.body.itens) ? req.body.itens : [];
    if (!itens.length) {
      return res.status(400).json({ error: 'Envie ao menos um item para aplicar (cdProduto + cdCategoria).' });
    }
    const out = await categoriaSug.aplicarItensCategoria(pool, { tenantId: tid, itens, sgUser: sg });
    res.json({ ok: true, ...out });
  } catch (err) {
    if (schemaMissing(err) || categoriaSug.schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos/categorias desatualizada. Execute os scripts WMS de cadastro no banco.',
      });
    }
    console.error('[WMS] aplicarSugestoesCategoriaProduto:', err);
    res.status(500).json({ error: 'Erro ao aplicar sugestões de categoria.' });
  }
}

async function executarJobCategoriaSugestaoProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req) || 'JOB_CATEGORIA_MANUAL';
    const dryRun =
      req.body?.dryRun === true ||
      req.query.dryRun === '1' ||
      String(req.body?.dryRun || req.query.dryRun || '').toUpperCase() === 'S';
    const cdDonoRaw = req.body?.cdDono ?? req.query.cdDono;
    if (cdDonoRaw != null && String(cdDonoRaw).trim() !== '') {
      const n = parseInt(String(cdDonoRaw), 10);
      if (!Number.isFinite(n)) return res.status(400).json({ error: 'cdDono inválido.' });
      const okDono = await assertDonoTenant(pool, tid, n);
      if (!okDono) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
      const out = await categoriaSug.aplicarCategoriaAltaConfiancaEmLote(pool, {
        tenantId: tid,
        cdDono: n,
        sgUser: sg,
        dryRun,
      });
      try {
        const { registrarExecucaoJobCategoria } = require('../services/wms-categoria-sugestao-log.service');
        await registrarExecucaoJobCategoria(pool, {
          tenantId: tid,
          cdDono: n,
          candidatos: out.candidatos,
          atualizados: out.atualizados,
          dryRun,
          dsDetalhe: dryRun ? 'Simulação manual (API)' : 'Aplicação manual alta confiança (API)',
          resumoJson: { porConservacao: out.porConservacao || {} },
        });
      } catch (_) {}
      return res.json({ ok: true, cdDono: n, ...out });
    }
    const out = await executarCicloCategoriaAltaConfianca({ tenantId: tid, dryRun });
    res.json({ ok: true, ...out });
  } catch (err) {
    if (schemaMissing(err) || categoriaSug.schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos/categorias desatualizada. Execute os scripts WMS de cadastro no banco.',
      });
    }
    console.error('[WMS] executarJobCategoriaSugestaoProduto:', err);
    res.status(500).json({ error: 'Erro ao executar job de categoria.' });
  }
}

async function listarLogJobCategoriaSugestaoProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const out = await listarHistoricoJobCategoria(pool, tid, req.query.limit);
    res.json(out);
  } catch (err) {
    console.error('[WMS] listarLogJobCategoriaSugestaoProduto:', err);
    res.status(500).json({ error: 'Erro ao listar histórico do job de categoria.' });
  }
}

async function listarPendenciasCadastroProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDonoRaw = req.query.cdDono;
    const cdDono = cdDonoRaw != null && String(cdDonoRaw).trim() !== '' ? parseInt(cdDonoRaw, 10) : null;
    if (cdDonoRaw != null && String(cdDonoRaw).trim() !== '' && !Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'cdDono inválido.' });
    }
    const out = await olClass.listarPendenciasCadastro(pool, {
      tenantId: tid,
      cdDono,
      tipo: req.query.tipo,
      limit: req.query.limit,
    });
    res.json(out);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({ error: 'Tabelas WMS não encontradas.' });
    }
    console.error('[WMS] listarPendenciasCadastroProduto:', err);
    res.status(500).json({ error: 'Erro ao listar pendências de cadastro.' });
  }
}

function middlewareUploadOlXlsx(req, res, next) {
  uploadOlXlsx(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Falha no upload da planilha OL.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Envie a planilha exportar.xlsx no campo arquivo.' });
    }
    next();
  });
}

async function simularClassificacaoOlProduto(req, res) {
  try {
    const rows = parseOlXlsxBuffer(req.file.buffer);
    const { preview, resumo } = olClass.prepararPreviewClassificacaoOl(rows);
    const lim = Math.min(3000, Math.max(1, parseInt(req.query.limit, 10) || 1500));
    const truncado = preview.length > lim;
    res.json({
      resumo,
      totalPreview: preview.length,
      truncado,
      rows: truncado ? preview.slice(0, lim) : preview,
    });
  } catch (err) {
    console.error('[WMS] simularClassificacaoOlProduto:', err);
    res.status(500).json({ error: 'Erro ao simular classificação OL.' });
  }
}

async function aplicarClassificacaoOlProduto(req, res) {
  const client = await pool.connect();
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });

    const rows = parseOlXlsxBuffer(req.file.buffer);
    let somenteCodigosKeys = null;
    const aplicarTodos =
      req.body?.aplicarTodos === true ||
      String(req.body?.aplicarTodos || '').toUpperCase() === 'S' ||
      String(req.body?.aplicarTodos || '') === '1';

    if (!aplicarTodos) {
      let raw = req.body?.codigosEstoque;
      if (typeof raw === 'string') {
        try {
          raw = JSON.parse(raw);
        } catch (_) {
          raw = raw.split(/[,;\s]+/).filter(Boolean);
        }
      }
      const arr = Array.isArray(raw) ? raw : [];
      if (!arr.length) {
        return res.status(400).json({
          error: 'Marque itens na revisão ou envie aplicarTodos=S.',
        });
      }
      somenteCodigosKeys = new Set(arr.map((c) => codigoProdutoMatchKey(c)).filter(Boolean));
    }

    await client.query('BEGIN');
    const out = await olClass.importarClassificacaoOl(client, {
      tenantId: tid,
      rows,
      sgUser: sg,
      somenteCodigosKeys,
    });
    await client.query('COMMIT');

    const pend = await olClass.listarPendenciasCadastro(pool, { tenantId: tid, limit: 1 });
    res.json({ ok: true, classificacao: out.stats, pendencias: pend.resumo });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error('[WMS] aplicarClassificacaoOlProduto:', err);
    res.status(500).json({ error: 'Erro ao aplicar classificação OL.' });
  } finally {
    client.release();
  }
}

function yn(v, def) {
  if (v == null || v === '') return def;
  const c = String(v).trim().toUpperCase().charAt(0);
  if (c === 'S' || c === 'Y' || c === '1') return 'S';
  if (c === 'N' || c === '0') return 'N';
  return def;
}

function digits(v) {
  return v != null ? String(v).replace(/\D/g, '') : '';
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function extractInfNfe(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const proc = parsed.nfeProc || parsed.NFeProc;
  const nfe = (proc && (proc.NFe || proc.nfe)) || parsed.NFe || parsed.nfe;
  if (!nfe || typeof nfe !== 'object') return null;
  const inf = nfe.infNFe || nfe.InfNFe;
  return inf && typeof inf === 'object' ? inf : null;
}

function parseProdutosFromXml(xmlString) {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      trimValues: true,
    });
    const parsed = parser.parse(xmlString);
    const inf = extractInfNfe(parsed);
    if (!inf) return { err: 'XML não reconhecido como NF-e (infNFe ausente).' };
    const emit = inf.emit || {};
    const cnpjEmitente = normDocFiscal(emit.CNPJ || emit.CPF);
    const xnomeEmitente = emit.xNome != null ? String(emit.xNome).trim().slice(0, 255) : '';
    const dets = asArray(inf.det);
    const itens = [];
    for (const det of dets) {
      const prod = det?.prod || {};
      const codigo = prod.cProd != null ? String(prod.cProd).trim() : '';
      const nome = prod.xProd != null ? String(prod.xProd).trim() : '';
      if (!codigo || !nome) continue;
      itens.push({
        codigo: codigo.slice(0, 128),
        nome: nome.slice(0, 200),
        unidade: (prod.uCom != null ? String(prod.uCom).trim() : '').slice(0, 10) || null,
        codBarras: (digits(prod.cEAN) || digits(prod.cEANTrib) || '').slice(0, 32) || null,
        ncm: digits(prod.NCM).slice(0, 8) || null,
      });
    }
    return { ok: { itens, cnpj_emitente: cnpjEmitente, xnome_emitente: xnomeEmitente } };
  } catch (e) {
    return { err: 'XML inválido ou corrompido.' };
  }
}

async function resolveDonoByCgc(client, tenantId, cgcRaw) {
  const cgc = normDocFiscal(cgcRaw);
  if (!cgc || cgc.length !== 14) return { status: 'sem-cnpj', cdDono: null, dono: null };
  const r = await client.query(
    `SELECT "CD_DONO", "CODIGO", "NOME", "CGC"
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "FGACTIVE" = 'S'
        AND LPAD(TRIM(COALESCE("CGC", '')), 14, '0') = $2
      ORDER BY "CD_DONO"`,
    [tenantId, cgc]
  );
  if (!r.rows.length) return { status: 'nao-encontrado', cdDono: null, dono: null, cgc };
  if (r.rows.length > 1) return { status: 'ambiguo', cdDono: null, dono: null, cgc, matches: r.rows };
  return {
    status: 'ok',
    cdDono: parseInt(r.rows[0].CD_DONO, 10),
    dono: r.rows[0],
    cgc,
  };
}

async function assertDonoTenant(client, tenantId, cdDono) {
  const r = await client.query(
    `SELECT 1 FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
    [cdDono, tenantId]
  );
  return r.rows.length > 0;
}

async function assertArmazemTenant(client, tenantId, cdArmazem) {
  const r = await client.query(
    `SELECT 1 FROM "WMS_ARMAZEM" WHERE "CD_ARMAZEM" = $1::integer AND "TENANT_ID" = $2`,
    [cdArmazem, tenantId]
  );
  return r.rows.length > 0;
}

async function assertGrupoTenant(client, tenantId, cdGrupo) {
  const r = await client.query(
    `SELECT 1 FROM "WMS_GRUPO_PRODUTO" WHERE "CD_GRUPO" = $1::integer AND "TENANT_ID" = $2`,
    [cdGrupo, tenantId]
  );
  return r.rows.length > 0;
}

async function assertCategoriaTenant(client, tenantId, cdCategoria) {
  const r = await client.query(
    `SELECT 1 FROM "WMS_CATEGORIA_PRODUTO" WHERE "CD_CATEGORIA" = $1::integer AND "TENANT_ID" = $2`,
    [cdCategoria, tenantId]
  );
  return r.rows.length > 0;
}

// ---------- Donos ----------

async function listarDonos(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { codigo, nome, fgactive } = req.query;
    let sql = `
      SELECT "CD_DONO", "TENANT_ID", "CODIGO", "NOME", "CGC", "MASCARA_CODIGO_PRODUTO", "FGACTIVE",
             "NU_DIAS_REL_VENCIMENTO", "NU_DIAS_MIN_VALID_RECEB", "PCT_COBRANCA_ESTOQUE",
             "PCT_COBRANCA_EXPEDICAO",
             "DH_MAINTENANCE", "SG_USER"
      FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1`;
    const p = [tid];
    let i = 2;
    if (codigo) {
      sql += ` AND UPPER(TRIM("CODIGO")) LIKE UPPER($${i})`;
      p.push(`%${String(codigo).trim()}%`);
      i++;
    }
    if (nome) {
      sql += ` AND UPPER("NOME") LIKE UPPER($${i})`;
      p.push(`%${String(nome).trim()}%`);
      i++;
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sql += ` AND "FGACTIVE" = $${i}`;
      p.push(fgactive);
    }
    sql += ` ORDER BY "NOME", "CODIGO"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err) || schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabelas WMS desatualizadas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql e, em seguida, backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
      });
    }
    console.error('[WMS] listarDonos:', err);
    res.status(500).json({ error: 'Erro ao listar donos do estoque.' });
  }
}

async function criarDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido (use até 32 caracteres: letras, números, ponto, hífen, sublinhado).' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const cgc = normCgc(req.body.CGC ?? req.body.cgc);
    const mask = normMask(req.body.MASCARA_CODIGO_PRODUTO ?? req.body.mascara_codigo_produto);
    if ((req.body.MASCARA_CODIGO_PRODUTO ?? req.body.mascara_codigo_produto) && !mask) {
      return res.status(400).json({ error: 'Máscara de código do produto inválida.' });
    }
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    let diasRel;
    let diasMinVal;
    try {
      diasRel = parseDiasDonoPolitica(
        req.body.NU_DIAS_REL_VENCIMENTO ?? req.body.nu_dias_rel_vencimento,
        DONO_DIAS_REL_VENC_PADRAO,
        'Dias para relatório de vencimento'
      );
      diasMinVal = parseDiasDonoPolitica(
        req.body.NU_DIAS_MIN_VALID_RECEB ?? req.body.nu_dias_min_valid_receb,
        DONO_DIAS_MIN_VALID_RECEB_PADRAO,
        'Dias mínimos de validade no recebimento'
      );
    } catch (e) {
      if (e && e.code === 'VALID') return res.status(400).json({ error: e.message });
      throw e;
    }
    const pctRaw = req.body.PCT_COBRANCA_ESTOQUE ?? req.body.pct_cobranca_estoque;
    let pctCob = null;
    if (pctRaw != null && String(pctRaw).trim() !== '') {
      pctCob = Number(String(pctRaw).trim().replace(',', '.'));
      if (!Number.isFinite(pctCob) || pctCob < 0 || pctCob > 100) {
        return res.status(400).json({ error: '% cobrança sobre estoque: informe entre 0 e 100.' });
      }
    }
    const pctExpRaw = req.body.PCT_COBRANCA_EXPEDICAO ?? req.body.pct_cobranca_expedicao;
    let pctCobExp = null;
    if (pctExpRaw != null && String(pctExpRaw).trim() !== '') {
      pctCobExp = Number(String(pctExpRaw).trim().replace(',', '.'));
      if (!Number.isFinite(pctCobExp) || pctCobExp < 0 || pctCobExp > 100) {
        return res.status(400).json({ error: '% cobrança sobre expedição: informe entre 0 e 100.' });
      }
    }
    const r = await pool.query(
      `INSERT INTO "WMS_DONO_ESTOQUE" (
          "TENANT_ID", "CODIGO", "NOME", "CGC", "MASCARA_CODIGO_PRODUTO", "FGACTIVE",
          "NU_DIAS_REL_VENCIMENTO", "NU_DIAS_MIN_VALID_RECEB", "PCT_COBRANCA_ESTOQUE",
          "PCT_COBRANCA_EXPEDICAO", "SG_USER"
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING "CD_DONO", "TENANT_ID", "CODIGO", "NOME", "CGC", "MASCARA_CODIGO_PRODUTO", "FGACTIVE",
                 "NU_DIAS_REL_VENCIMENTO", "NU_DIAS_MIN_VALID_RECEB", "PCT_COBRANCA_ESTOQUE",
                 "PCT_COBRANCA_EXPEDICAO",
                 "DH_MAINTENANCE", "SG_USER"`,
      [tid, codigo, nome, cgc, mask, fg, diasRel, diasMinVal, pctCob, pctCobExp, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err) || schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabelas WMS desatualizadas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql e backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe dono com este código neste tenant.' });
    }
    console.error('[WMS] criarDono:', err);
    res.status(500).json({ error: 'Erro ao criar dono do estoque.' });
  }
}

async function atualizarDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdDono, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const cgc = normCgc(req.body.CGC ?? req.body.cgc);
    const mask = normMask(req.body.MASCARA_CODIGO_PRODUTO ?? req.body.mascara_codigo_produto);
    if ((req.body.MASCARA_CODIGO_PRODUTO ?? req.body.mascara_codigo_produto) && !mask) {
      return res.status(400).json({ error: 'Máscara de código do produto inválida.' });
    }
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    let diasRel;
    let diasMinVal;
    try {
      diasRel = parseDiasDonoPolitica(
        req.body.NU_DIAS_REL_VENCIMENTO ?? req.body.nu_dias_rel_vencimento,
        DONO_DIAS_REL_VENC_PADRAO,
        'Dias para relatório de vencimento'
      );
      diasMinVal = parseDiasDonoPolitica(
        req.body.NU_DIAS_MIN_VALID_RECEB ?? req.body.nu_dias_min_valid_receb,
        DONO_DIAS_MIN_VALID_RECEB_PADRAO,
        'Dias mínimos de validade no recebimento'
      );
    } catch (e) {
      if (e && e.code === 'VALID') return res.status(400).json({ error: e.message });
      throw e;
    }
    const pctRaw = req.body.PCT_COBRANCA_ESTOQUE ?? req.body.pct_cobranca_estoque;
    let pctCob = null;
    if (pctRaw != null && String(pctRaw).trim() !== '') {
      pctCob = Number(String(pctRaw).trim().replace(',', '.'));
      if (!Number.isFinite(pctCob) || pctCob < 0 || pctCob > 100) {
        return res.status(400).json({ error: '% cobrança sobre estoque: informe entre 0 e 100.' });
      }
    }
    const pctExpRaw = req.body.PCT_COBRANCA_EXPEDICAO ?? req.body.pct_cobranca_expedicao;
    let pctCobExp = null;
    if (pctExpRaw != null && String(pctExpRaw).trim() !== '') {
      pctCobExp = Number(String(pctExpRaw).trim().replace(',', '.'));
      if (!Number.isFinite(pctCobExp) || pctCobExp < 0 || pctCobExp > 100) {
        return res.status(400).json({ error: '% cobrança sobre expedição: informe entre 0 e 100.' });
      }
    }
    const r = await pool.query(
      `UPDATE "WMS_DONO_ESTOQUE"
       SET "CODIGO" = $3, "NOME" = $4, "CGC" = $5, "MASCARA_CODIGO_PRODUTO" = $6, "FGACTIVE" = $7,
           "NU_DIAS_REL_VENCIMENTO" = $9, "NU_DIAS_MIN_VALID_RECEB" = $10, "PCT_COBRANCA_ESTOQUE" = $11,
           "PCT_COBRANCA_EXPEDICAO" = $12,
           "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $8
       WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2
       RETURNING "CD_DONO", "TENANT_ID", "CODIGO", "NOME", "CGC", "MASCARA_CODIGO_PRODUTO", "FGACTIVE",
                 "NU_DIAS_REL_VENCIMENTO", "NU_DIAS_MIN_VALID_RECEB", "PCT_COBRANCA_ESTOQUE",
                 "PCT_COBRANCA_EXPEDICAO",
                 "DH_MAINTENANCE", "SG_USER"`,
      [cd, tid, codigo, nome, cgc, mask, fg, sg, diasRel, diasMinVal, pctCob, pctCobExp]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Dono não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err) || schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabelas WMS desatualizadas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql e backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe dono com este código neste tenant.' });
    }
    console.error('[WMS] atualizarDono:', err);
    res.status(500).json({ error: 'Erro ao atualizar dono do estoque.' });
  }
}

// ---------- Armazéns ----------

async function listarArmazens(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = req.query.cdDono != null && String(req.query.cdDono).trim() !== '' ? parseInt(req.query.cdDono, 10) : null;
    let sql = `
      SELECT a."CD_ARMAZEM", a."TENANT_ID", a."CD_DONO", a."CODIGO", a."NOME", a."FGACTIVE", a."DH_MAINTENANCE", a."SG_USER",
             d."NOME" AS "NM_DONO", d."CODIGO" AS "CD_DONO_CODIGO"
      FROM "WMS_ARMAZEM" a
      INNER JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = a."CD_DONO" AND d."TENANT_ID" = a."TENANT_ID"
      WHERE a."TENANT_ID" = $1`;
    const p = [tid];
    if (cdDono != null && Number.isFinite(cdDono)) {
      sql += ` AND a."CD_DONO" = $2::integer`;
      p.push(cdDono);
    }
    sql += ` ORDER BY d."NOME", a."NOME"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    console.error('[WMS] listarArmazens:', err);
    res.status(500).json({ error: 'Erro ao listar armazéns.' });
  }
}

async function criarArmazem(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const ok = await assertDonoTenant(pool, tid, cdDono);
    if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_ARMAZEM" ("TENANT_ID", "CD_DONO", "CODIGO", "NOME", "FGACTIVE", "SG_USER")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tid, cdDono, codigo, nome, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe armazém com este código para este dono.' });
    }
    console.error('[WMS] criarArmazem:', err);
    res.status(500).json({ error: 'Erro ao criar armazém.' });
  }
}

async function atualizarArmazem(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdArmazem, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const okDono = await assertDonoTenant(pool, tid, cdDono);
    if (!okDono) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_ARMAZEM"
       SET "CD_DONO" = $3, "CODIGO" = $4, "NOME" = $5, "FGACTIVE" = $6, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $7
       WHERE "CD_ARMAZEM" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, cdDono, codigo, nome, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Armazém não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe armazém com este código para este dono.' });
    }
    console.error('[WMS] atualizarArmazem:', err);
    res.status(500).json({ error: 'Erro ao atualizar armazém.' });
  }
}

// ---------- Áreas ----------

async function listarAreas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdArm = req.query.cdArmazem != null && String(req.query.cdArmazem).trim() !== '' ? parseInt(req.query.cdArmazem, 10) : null;
    let sql = `
      SELECT ar."CD_AREA", ar."TENANT_ID", ar."CD_ARMAZEM", ar."CODIGO", ar."NOME", ar."FGACTIVE", ar."DH_MAINTENANCE", ar."SG_USER",
             a."NOME" AS "NM_ARMAZEM", a."CODIGO" AS "CD_ARMAZEM_CODIGO"
      FROM "WMS_AREA" ar
      INNER JOIN "WMS_ARMAZEM" a ON a."CD_ARMAZEM" = ar."CD_ARMAZEM" AND a."TENANT_ID" = ar."TENANT_ID"
      WHERE ar."TENANT_ID" = $1`;
    const p = [tid];
    if (cdArm != null && Number.isFinite(cdArm)) {
      sql += ` AND ar."CD_ARMAZEM" = $2::integer`;
      p.push(cdArm);
    }
    sql += ` ORDER BY a."NOME", ar."NOME"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    console.error('[WMS] listarAreas:', err);
    res.status(500).json({ error: 'Erro ao listar áreas.' });
  }
}

async function criarArea(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArm = parseInt(req.body.CD_ARMAZEM ?? req.body.cd_armazem, 10);
    if (!Number.isFinite(cdArm)) return res.status(400).json({ error: 'Armazém (CD_ARMAZEM) é obrigatório.' });
    const ok = await assertArmazemTenant(pool, tid, cdArm);
    if (!ok) return res.status(400).json({ error: 'Armazém não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_AREA" ("TENANT_ID", "CD_ARMAZEM", "CODIGO", "NOME", "FGACTIVE", "SG_USER")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tid, cdArm, codigo, nome, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe área com este código neste armazém.' });
    }
    console.error('[WMS] criarArea:', err);
    res.status(500).json({ error: 'Erro ao criar área.' });
  }
}

async function atualizarArea(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdArea, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdArm = parseInt(req.body.CD_ARMAZEM ?? req.body.cd_armazem, 10);
    if (!Number.isFinite(cdArm)) return res.status(400).json({ error: 'Armazém (CD_ARMAZEM) é obrigatório.' });
    const ok = await assertArmazemTenant(pool, tid, cdArm);
    if (!ok) return res.status(400).json({ error: 'Armazém não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_AREA"
       SET "CD_ARMAZEM" = $3, "CODIGO" = $4, "NOME" = $5, "FGACTIVE" = $6, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $7
       WHERE "CD_AREA" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, cdArm, codigo, nome, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Área não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe área com este código neste armazém.' });
    }
    console.error('[WMS] atualizarArea:', err);
    res.status(500).json({ error: 'Erro ao atualizar área.' });
  }
}

// ---------- Docas ----------

async function listarDocas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdArm = req.query.cdArmazem != null && String(req.query.cdArmazem).trim() !== '' ? parseInt(req.query.cdArmazem, 10) : null;
    let sql = `
      SELECT d."CD_DOCA", d."TENANT_ID", d."CD_ARMAZEM", d."CODIGO", d."NOME", d."FG_RECEBE", d."FG_EXPEDE", d."FGACTIVE",
             d."DH_MAINTENANCE", d."SG_USER",
             a."NOME" AS "NM_ARMAZEM", a."CODIGO" AS "CD_ARMAZEM_CODIGO"
      FROM "WMS_DOCA" d
      INNER JOIN "WMS_ARMAZEM" a ON a."CD_ARMAZEM" = d."CD_ARMAZEM" AND a."TENANT_ID" = d."TENANT_ID"
      WHERE d."TENANT_ID" = $1`;
    const p = [tid];
    if (cdArm != null && Number.isFinite(cdArm)) {
      sql += ` AND d."CD_ARMAZEM" = $2::integer`;
      p.push(cdArm);
    }
    sql += ` ORDER BY a."NOME", d."NOME"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    console.error('[WMS] listarDocas:', err);
    res.status(500).json({ error: 'Erro ao listar docas.' });
  }
}

async function criarDoca(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArm = parseInt(req.body.CD_ARMAZEM ?? req.body.cd_armazem, 10);
    if (!Number.isFinite(cdArm)) return res.status(400).json({ error: 'Armazém (CD_ARMAZEM) é obrigatório.' });
    const ok = await assertArmazemTenant(pool, tid, cdArm);
    if (!ok) return res.status(400).json({ error: 'Armazém não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fgR = yn(req.body.FG_RECEBE ?? req.body.fg_recebe, 'S');
    const fgE = yn(req.body.FG_EXPEDE ?? req.body.fg_expede, 'S');
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_DOCA" ("TENANT_ID", "CD_ARMAZEM", "CODIGO", "NOME", "FG_RECEBE", "FG_EXPEDE", "FGACTIVE", "SG_USER")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [tid, cdArm, codigo, nome, fgR, fgE, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe doca com este código neste armazém.' });
    }
    console.error('[WMS] criarDoca:', err);
    res.status(500).json({ error: 'Erro ao criar doca.' });
  }
}

// ---------- Grupo/Categoria de produto ----------

async function listarGruposProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { codigo, nome, fgactive } = req.query;
    let sql = `
      SELECT "CD_GRUPO", "TENANT_ID", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "DH_MAINTENANCE", "SG_USER"
      FROM "WMS_GRUPO_PRODUTO"
      WHERE "TENANT_ID" = $1`;
    const p = [tid];
    let i = 2;
    if (codigo) {
      sql += ` AND UPPER(TRIM("CODIGO")) LIKE UPPER($${i})`;
      p.push(`%${String(codigo).trim()}%`);
      i++;
    }
    if (nome) {
      sql += ` AND UPPER("NOME") LIKE UPPER($${i})`;
      p.push(`%${String(nome).trim()}%`);
      i++;
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sql += ` AND "FGACTIVE" = $${i}`;
      p.push(fgactive);
      i++;
    }
    sql += ` ORDER BY "ORDEM", "NOME", "CODIGO"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    console.error('[WMS] listarGruposProduto:', err);
    res.status(500).json({ error: 'Erro ao listar grupos de produto.' });
  }
}

async function criarGrupoProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim().slice(0, 120) : '';
    const ordem = Number.isFinite(parseInt(req.body.ORDEM ?? req.body.ordem, 10))
      ? parseInt(req.body.ORDEM ?? req.body.ordem, 10)
      : 0;
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_GRUPO_PRODUTO" ("TENANT_ID", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "SG_USER")
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tid, codigo, nome, ordem, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe grupo com este código.' });
    console.error('[WMS] criarGrupoProduto:', err);
    res.status(500).json({ error: 'Erro ao criar grupo de produto.' });
  }
}

async function atualizarGrupoProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdGrupo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim().slice(0, 120) : '';
    const ordem = Number.isFinite(parseInt(req.body.ORDEM ?? req.body.ordem, 10))
      ? parseInt(req.body.ORDEM ?? req.body.ordem, 10)
      : 0;
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_GRUPO_PRODUTO"
       SET "CODIGO" = $3, "NOME" = $4, "ORDEM" = $5, "FGACTIVE" = $6,
           "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $7
       WHERE "CD_GRUPO" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, codigo, nome, ordem, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Grupo não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe grupo com este código.' });
    console.error('[WMS] atualizarGrupoProduto:', err);
    res.status(500).json({ error: 'Erro ao atualizar grupo de produto.' });
  }
}

async function listarCategoriasProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { cdGrupo, codigo, nome, fgactive } = req.query;
    let sql = `
      SELECT c."CD_CATEGORIA", c."TENANT_ID", c."CD_GRUPO", c."CODIGO", c."NOME", c."ORDEM", c."FGACTIVE",
             c."DH_MAINTENANCE", c."SG_USER",
             g."NOME" AS "NM_GRUPO", g."CODIGO" AS "CD_GRUPO_CODIGO"
      FROM "WMS_CATEGORIA_PRODUTO" c
      INNER JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1`;
    const p = [tid];
    let i = 2;
    if (cdGrupo != null && String(cdGrupo).trim() !== '') {
      sql += ` AND c."CD_GRUPO" = $${i}::integer`;
      p.push(parseInt(cdGrupo, 10));
      i++;
    }
    if (codigo) {
      sql += ` AND UPPER(TRIM(c."CODIGO")) LIKE UPPER($${i})`;
      p.push(`%${String(codigo).trim()}%`);
      i++;
    }
    if (nome) {
      sql += ` AND UPPER(c."NOME") LIKE UPPER($${i})`;
      p.push(`%${String(nome).trim()}%`);
      i++;
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sql += ` AND c."FGACTIVE" = $${i}`;
      p.push(fgactive);
      i++;
    }
    sql += ` ORDER BY g."ORDEM", g."NOME", c."ORDEM", c."NOME", c."CODIGO"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    console.error('[WMS] listarCategoriasProduto:', err);
    res.status(500).json({ error: 'Erro ao listar categorias de produto.' });
  }
}

async function criarCategoriaProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdGrupo = parseInt(req.body.CD_GRUPO ?? req.body.cd_grupo, 10);
    if (!Number.isFinite(cdGrupo)) return res.status(400).json({ error: 'Grupo (CD_GRUPO) é obrigatório.' });
    const okGrupo = await assertGrupoTenant(pool, tid, cdGrupo);
    if (!okGrupo) return res.status(400).json({ error: 'Grupo não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim().slice(0, 120) : '';
    const ordem = Number.isFinite(parseInt(req.body.ORDEM ?? req.body.ordem, 10))
      ? parseInt(req.body.ORDEM ?? req.body.ordem, 10)
      : 0;
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_CATEGORIA_PRODUTO" ("TENANT_ID", "CD_GRUPO", "CODIGO", "NOME", "ORDEM", "FGACTIVE", "SG_USER")
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [tid, cdGrupo, codigo, nome, ordem, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe categoria com este código neste grupo.' });
    console.error('[WMS] criarCategoriaProduto:', err);
    res.status(500).json({ error: 'Erro ao criar categoria de produto.' });
  }
}

async function atualizarCategoriaProduto(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCategoria, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdGrupo = parseInt(req.body.CD_GRUPO ?? req.body.cd_grupo, 10);
    if (!Number.isFinite(cdGrupo)) return res.status(400).json({ error: 'Grupo (CD_GRUPO) é obrigatório.' });
    const okGrupo = await assertGrupoTenant(pool, tid, cdGrupo);
    if (!okGrupo) return res.status(400).json({ error: 'Grupo não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim().slice(0, 120) : '';
    const ordem = Number.isFinite(parseInt(req.body.ORDEM ?? req.body.ordem, 10))
      ? parseInt(req.body.ORDEM ?? req.body.ordem, 10)
      : 0;
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_CATEGORIA_PRODUTO"
       SET "CD_GRUPO" = $3, "CODIGO" = $4, "NOME" = $5, "ORDEM" = $6, "FGACTIVE" = $7,
           "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $8
       WHERE "CD_CATEGORIA" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, cdGrupo, codigo, nome, ordem, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Categoria não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de grupo/categoria não encontrada. Execute backend/scripts/wms_cadastros_mestre_postgres.sql.',
      });
    }
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe categoria com este código neste grupo.' });
    console.error('[WMS] atualizarCategoriaProduto:', err);
    res.status(500).json({ error: 'Erro ao atualizar categoria de produto.' });
  }
}

// ---------- Produto (cadastro mestre por dono) ----------

async function listarProdutosDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { cdDono, cdCategoria, codigo, nome, fgactive, fgDescartavel } = req.query;
    const cdProdutoRaw = req.query.cdProduto ?? req.query.cd_produto;
    const cdProduto =
      cdProdutoRaw != null && String(cdProdutoRaw).trim() !== '' ? parseInt(String(cdProdutoRaw), 10) : null;
    if (cdProdutoRaw != null && String(cdProdutoRaw).trim() !== '' && !Number.isFinite(cdProduto)) {
      return res.status(400).json({ error: 'Parâmetro cdProduto inválido.' });
    }
    const pesoStatusRaw = req.query.pesoStatus ?? req.query.peso_status;
    const pesoStatus = pesoStatusRaw != null ? String(pesoStatusRaw).trim().toLowerCase() : '';
    const tipoArmRaw = req.query.tipoArmazenagem ?? req.query.tipo_armazenagem;
    const tipoArmazenagem =
      tipoArmRaw != null && String(tipoArmRaw).trim() !== '' ? normTipoArmazenagem(tipoArmRaw) : null;
    if (tipoArmRaw != null && String(tipoArmRaw).trim() !== '' && !tipoArmazenagem) {
      return res.status(400).json({
        error: 'Parâmetro tipoArmazenagem inválido. Use SECO, REFRIGERADO ou CONGELADO.',
      });
    }
    const somenteDono =
      req.query.somenteDono === '1' || req.query.somenteDono === 'true' || req.query.somente_dono === '1';
    const mostrarFornecedor =
      req.query.mostrarFornecedor === '1' || req.query.mostrarFornecedor === 'true' || req.query.mostrar_fornecedor === '1';
    let cdDonoObrigatorio = null;
    if (somenteDono) {
      const nDono = parseInt(cdDono, 10);
      if (cdDono == null || String(cdDono).trim() === '' || !Number.isFinite(nDono)) {
        return res.status(400).json({ error: 'Parâmetro cdDono é obrigatório para listar apenas produtos do dono do estoque.' });
      }
      cdDonoObrigatorio = nDono;
    }
    let sql = `
      SELECT p."CD_PRODUTO", p."TENANT_ID", p."CD_DONO", p."CODIGO", p."NOME", p."UNIDADE", p."CODIGO_BARRAS", p."NCM", p."PESO_KG",
             p."VALOR_REFERENCIA", p."TIPO_ARMAZENAGEM", p."CD_CATEGORIA", p."ORIGEM_CADASTRO", p."FG_FORNECEDOR_REF",
             p."FG_DESCARTAVEL", p."FG_CONTROLA_LOTE", p."FG_CONTROLA_VALIDADE",
             p."FGACTIVE", p."DH_MAINTENANCE", p."SG_USER",
             o."NOME" AS "NM_DONO", o."CODIGO" AS "CD_DONO_CODIGO", o."MASCARA_CODIGO_PRODUTO",
             c."NOME" AS "NM_CATEGORIA", c."CODIGO" AS "CD_CATEGORIA_CODIGO", g."NOME" AS "NM_GRUPO"
      FROM "WMS_PRODUTO_DONO" p
      INNER JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
      LEFT JOIN "WMS_CATEGORIA_PRODUTO" c ON c."CD_CATEGORIA" = p."CD_CATEGORIA" AND c."TENANT_ID" = p."TENANT_ID"
      LEFT JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
      WHERE p."TENANT_ID" = $1`;
    let params = [tid];
    let i = 2;
    if (cdProduto != null) {
      sql += ` AND p."CD_PRODUTO" = $${i}::integer`;
      params.push(cdProduto);
      i++;
    }
    if (cdDonoObrigatorio != null) {
      sql += ` AND p."CD_DONO" = $${i}::integer`;
      params.push(cdDonoObrigatorio);
      i++;
    } else if (cdDono != null && String(cdDono).trim() !== '') {
      sql += ` AND p."CD_DONO" = $${i}::integer`;
      params.push(parseInt(cdDono, 10));
      i++;
    }
    if (codigo) {
      const fCod = appendSqlFiltroCodigoProdutoDono(sql, params, codigo, i);
      sql = fCod.sql;
      params = fCod.params;
      i = fCod.nextIndex;
    }
    if (nome) {
      sql += ` AND UPPER(p."NOME") LIKE UPPER($${i})`;
      params.push(`%${String(nome).trim()}%`);
      i++;
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sql += ` AND p."FGACTIVE" = $${i}`;
      params.push(fgactive);
      i++;
    }
    if (tipoArmazenagem) {
      sql += ` AND UPPER(COALESCE(p."TIPO_ARMAZENAGEM", '')) = UPPER($${i})`;
      params.push(String(tipoArmazenagem).trim());
      i++;
    }
    if (fgDescartavel === 'S' || fgDescartavel === 'N') {
      sql += ` AND p."FG_DESCARTAVEL" = $${i}`;
      params.push(fgDescartavel);
      i++;
    }
    if (cdCategoria != null && String(cdCategoria).trim() !== '') {
      sql += ` AND p."CD_CATEGORIA" = $${i}::integer`;
      params.push(parseInt(cdCategoria, 10));
      i++;
    }
    if (pesoStatus === 'sem') {
      sql += ` AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)`;
    } else if (pesoStatus === 'com') {
      sql += ` AND p."PESO_KG" IS NOT NULL AND p."PESO_KG" > 0`;
    }
    if (!mostrarFornecedor) {
      sql += ` AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'`;
    }
    const limitN = 500;
    sql += ` ORDER BY o."NOME", p."NOME", p."CODIGO" LIMIT ${limitN + 1}`;
    const r = await pool.query(sql, params);
    const rows = r.rows || [];
    if (rows.length > limitN) {
      return res.json({
        rows: rows.slice(0, limitN),
        truncated: true,
        limit: limitN,
        aviso: `Exibindo os primeiros ${limitN} produtos. Filtre por dono e/ou código/nome para refinar.`,
      });
    }
    res.json(rows);
  } catch (err) {
    if (schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
      });
    }
    console.error('[WMS] listarProdutosDono:', err.message || err);
    res.status(500).json({ error: 'Erro ao listar produtos do dono.' });
  }
}

/** Uma linha de produto (mesmo shape do grid / listar) para abrir edição por CD_PRODUTO. */
async function obterProdutoDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdProduto, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await pool.query(
      `SELECT p."CD_PRODUTO", p."TENANT_ID", p."CD_DONO", p."CODIGO", p."NOME", p."UNIDADE", p."CODIGO_BARRAS", p."NCM", p."PESO_KG",
             p."VALOR_REFERENCIA", p."TIPO_ARMAZENAGEM", p."CD_CATEGORIA", p."ORIGEM_CADASTRO", p."FG_FORNECEDOR_REF",
             p."FG_DESCARTAVEL", p."FG_CONTROLA_LOTE", p."FG_CONTROLA_VALIDADE",
             p."FGACTIVE", p."DH_MAINTENANCE", p."SG_USER",
             o."NOME" AS "NM_DONO", o."CODIGO" AS "CD_DONO_CODIGO", o."MASCARA_CODIGO_PRODUTO",
             c."NOME" AS "NM_CATEGORIA", c."CODIGO" AS "CD_CATEGORIA_CODIGO", g."NOME" AS "NM_GRUPO"
       FROM "WMS_PRODUTO_DONO" p
       INNER JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
       LEFT JOIN "WMS_CATEGORIA_PRODUTO" c ON c."CD_CATEGORIA" = p."CD_CATEGORIA" AND c."TENANT_ID" = p."TENANT_ID"
       LEFT JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
       WHERE p."CD_PRODUTO" = $1::integer AND p."TENANT_ID" = $2
       LIMIT 1`,
      [cd, tid]
    );
    if (!r.rows || r.rows.length === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
      });
    }
    console.error('[WMS] obterProdutoDono:', err);
    res.status(500).json({ error: 'Erro ao carregar produto do dono.' });
  }
}

async function criarProdutoDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    const cdCategoriaRaw = req.body.CD_CATEGORIA ?? req.body.cd_categoria;
    const cdCategoria =
      cdCategoriaRaw != null && String(cdCategoriaRaw).trim() !== '' ? parseInt(String(cdCategoriaRaw), 10) : null;
    if (cdCategoria != null && !Number.isFinite(cdCategoria)) return res.status(400).json({ error: 'Categoria inválida.' });
    if (cdCategoria != null) {
      const okCat = await assertCategoriaTenant(pool, tid, cdCategoria);
      if (!okCat) return res.status(400).json({ error: 'Categoria não encontrada para este tenant.' });
    }
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const ok = await assertDonoTenant(pool, tid, cdDono);
    if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const codigoRaw = normCodigoInterno(req.body.CODIGO ?? req.body.codigo);
    if (!codigoRaw) return res.status(400).json({ error: 'Código inválido (até 128 caracteres: letras, números, ponto, hífen, sublinhado).' });
    const codigo = await resolveCodigoProdutoDono(pool, tid, cdDono, codigoRaw);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    const unidade =
      req.body.UNIDADE != null || req.body.unidade != null ? String(req.body.UNIDADE ?? req.body.unidade).trim().slice(0, 10) : '';
    const codBarrasRaw =
      req.body.CODIGO_BARRAS != null || req.body.codigo_barras != null
        ? String(req.body.CODIGO_BARRAS ?? req.body.codigo_barras).trim()
        : '';
    const codBarras = codBarrasRaw ? codBarrasRaw.slice(0, 32) : null;
    const ncm = normNcm(req.body.NCM ?? req.body.ncm);
    if ((req.body.NCM ?? req.body.ncm) && !ncm) return res.status(400).json({ error: 'NCM inválido (até 8 dígitos).' });
    const pesoKg = normPesoKg(req.body.PESO_KG ?? req.body.peso_kg);
    if ((req.body.PESO_KG ?? req.body.peso_kg) != null && String(req.body.PESO_KG ?? req.body.peso_kg).trim() !== '' && pesoKg == null) {
      return res.status(400).json({ error: 'Peso (kg) inválido. Informe número maior ou igual a zero.' });
    }
    const valorRef = normValorReferencia(req.body.VALOR_REFERENCIA ?? req.body.valor_referencia);
    if (
      (req.body.VALOR_REFERENCIA ?? req.body.valor_referencia) != null &&
      String(req.body.VALOR_REFERENCIA ?? req.body.valor_referencia).trim() !== '' &&
      valorRef == null
    ) {
      return res.status(400).json({ error: 'Valor referência (R$) inválido. Informe número maior ou igual a zero.' });
    }
    const tipoArmazenagem = normTipoArmazenagem(req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem);
    if ((req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem) && !tipoArmazenagem) {
      return res.status(400).json({ error: 'Tipo de armazenagem inválido (SECO/REFRIGERADO/CONGELADO).' });
    }
    const fgDesc = yn(req.body.FG_DESCARTAVEL ?? req.body.fg_descartavel, 'N');
    const fgLote = yn(req.body.FG_CONTROLA_LOTE ?? req.body.fg_controla_lote, 'N');
    const fgValInformado = yn(req.body.FG_CONTROLA_VALIDADE ?? req.body.fg_controla_validade, 'N');
    const fgVal = await resolverFgControlaValidadeProduto(pool, {
      tenantId: tid,
      cdCategoria,
      codigoProduto: codigo,
      fgInformado: fgValInformado,
    });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const origemCadastro = 'MANUAL';
    const fgFornecedorRef = 'N';
    const dupCriar = await buscarConflitoSkuProdutoDono(pool, tid, cdDono, codigo, null);
    if (dupCriar.length > 0) {
      const resp = respostaSkuDuplicado('(novo)', cdDono, codigo, dupCriar);
      return res.status(resp.status).json(resp.body);
    }
    const r = await pool.query(
      `INSERT INTO "WMS_PRODUTO_DONO" (
        "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "CODIGO_BARRAS", "NCM", "PESO_KG", "VALOR_REFERENCIA", "TIPO_ARMAZENAGEM",
        "CD_CATEGORIA", "ORIGEM_CADASTRO", "FG_FORNECEDOR_REF",
        "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE", "FGACTIVE", "SG_USER"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        tid,
        cdDono,
        codigo,
        nome,
        unidade || null,
        codBarras,
        ncm,
        pesoKg,
        valorRef,
        tipoArmazenagem,
        cdCategoria,
        origemCadastro,
        fgFornecedorRef,
        fgDesc,
        fgLote,
        fgVal,
        fg,
        sg,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe produto com este código para este dono.' });
    }
    console.error('[WMS] criarProdutoDono:', err);
    res.status(500).json({ error: 'Erro ao criar produto do dono.' });
  }
}

async function atualizarProdutoDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdProduto, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    const cdCategoriaRaw = req.body.CD_CATEGORIA ?? req.body.cd_categoria;
    const cdCategoria =
      cdCategoriaRaw != null && String(cdCategoriaRaw).trim() !== '' ? parseInt(String(cdCategoriaRaw), 10) : null;
    if (cdCategoria != null && !Number.isFinite(cdCategoria)) return res.status(400).json({ error: 'Categoria inválida.' });
    if (cdCategoria != null) {
      const okCat = await assertCategoriaTenant(pool, tid, cdCategoria);
      if (!okCat) return res.status(400).json({ error: 'Categoria não encontrada para este tenant.' });
    }
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const ok = await assertDonoTenant(pool, tid, cdDono);
    if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const codigoRaw = normCodigoInterno(req.body.CODIGO ?? req.body.codigo);
    if (!codigoRaw) return res.status(400).json({ error: 'Código inválido.' });
    const codigo = await resolveCodigoProdutoDono(pool, tid, cdDono, codigoRaw);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    const unidade =
      req.body.UNIDADE != null || req.body.unidade != null ? String(req.body.UNIDADE ?? req.body.unidade).trim().slice(0, 10) : '';
    const codBarrasRaw =
      req.body.CODIGO_BARRAS != null || req.body.codigo_barras != null
        ? String(req.body.CODIGO_BARRAS ?? req.body.codigo_barras).trim()
        : '';
    const codBarras = codBarrasRaw ? codBarrasRaw.slice(0, 32) : null;
    const ncm = normNcm(req.body.NCM ?? req.body.ncm);
    if ((req.body.NCM ?? req.body.ncm) && !ncm) return res.status(400).json({ error: 'NCM inválido (até 8 dígitos).' });
    const pesoKg = normPesoKg(req.body.PESO_KG ?? req.body.peso_kg);
    if ((req.body.PESO_KG ?? req.body.peso_kg) != null && String(req.body.PESO_KG ?? req.body.peso_kg).trim() !== '' && pesoKg == null) {
      return res.status(400).json({ error: 'Peso (kg) inválido. Informe número maior ou igual a zero.' });
    }
    const valorRef = normValorReferencia(req.body.VALOR_REFERENCIA ?? req.body.valor_referencia);
    if (
      (req.body.VALOR_REFERENCIA ?? req.body.valor_referencia) != null &&
      String(req.body.VALOR_REFERENCIA ?? req.body.valor_referencia).trim() !== '' &&
      valorRef == null
    ) {
      return res.status(400).json({ error: 'Valor referência (R$) inválido. Informe número maior ou igual a zero.' });
    }
    const tipoArmazenagem = normTipoArmazenagem(req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem);
    if ((req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem) && !tipoArmazenagem) {
      return res.status(400).json({ error: 'Tipo de armazenagem inválido (SECO/REFRIGERADO/CONGELADO).' });
    }
    const fgDesc = yn(req.body.FG_DESCARTAVEL ?? req.body.fg_descartavel, 'N');
    const fgLote = yn(req.body.FG_CONTROLA_LOTE ?? req.body.fg_controla_lote, 'N');
    const fgValInformado = yn(req.body.FG_CONTROLA_VALIDADE ?? req.body.fg_controla_validade, 'N');
    const fgVal = await resolverFgControlaValidadeProduto(pool, {
      tenantId: tid,
      cdCategoria,
      codigoProduto: codigo,
      fgInformado: fgValInformado,
    });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const origemCadastro = req.body.ORIGEM_CADASTRO ?? req.body.origem_cadastro ?? 'MANUAL';
    const origemNorm = ['MANUAL', 'IMPORT_XML_PRODUTO', 'NF_ENTRADA_AUTO'].includes(String(origemCadastro))
      ? String(origemCadastro)
      : 'MANUAL';
    const fgFornecedorRef = yn(req.body.FG_FORNECEDOR_REF ?? req.body.fg_fornecedor_ref, 'N');

    // ID canônico do SKU (com/sem máscara): se o # da URL sumiu ou for clone do mesmo código, grava no sobrevivente.
    let cdEfetivo = cd;
    const existe = await pool.query(
      `SELECT "CD_PRODUTO", "CODIGO" FROM "WMS_PRODUTO_DONO"
        WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    const dupRows = await buscarConflitoSkuProdutoDono(pool, tid, cdDono, codigo, cd);
    if (existe.rowCount === 0) {
      const porSku = await buscarConflitoSkuProdutoDono(pool, tid, cdDono, codigo, null);
      if (!porSku.length) return res.status(404).json({ error: 'Produto não encontrado.' });
      cdEfetivo = Number(porSku[0].CD_PRODUTO ?? porSku[0].cd_produto);
    } else if (dupRows.length > 0) {
      // Mesmo SKU lógico em outro # (ex.: clone só dígitos) — aplica a edição no cadastro canônico.
      const idCanon = Number(dupRows[0].CD_PRODUTO ?? dupRows[0].cd_produto);
      if (Number.isFinite(idCanon) && idCanon !== cd) {
        cdEfetivo = idCanon;
      } else {
        const resp = respostaSkuDuplicado(cd, cdDono, codigo, dupRows);
        return res.status(resp.status).json(resp.body);
      }
    }

    const r = await pool.query(
      `UPDATE "WMS_PRODUTO_DONO"
       SET "CD_DONO" = $3, "CODIGO" = $4, "NOME" = $5, "UNIDADE" = $6, "CODIGO_BARRAS" = $7, "NCM" = $8,
           "PESO_KG" = $9, "VALOR_REFERENCIA" = $10, "TIPO_ARMAZENAGEM" = $11, "CD_CATEGORIA" = $12, "ORIGEM_CADASTRO" = $13, "FG_FORNECEDOR_REF" = $14,
           "FG_DESCARTAVEL" = $15, "FG_CONTROLA_LOTE" = $16, "FG_CONTROLA_VALIDADE" = $17,
           "FGACTIVE" = $18, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $19
       WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [
        cdEfetivo,
        tid,
        cdDono,
        codigo,
        nome,
        unidade || null,
        codBarras,
        ncm,
        pesoKg,
        valorRef,
        tipoArmazenagem,
        cdCategoria,
        origemNorm,
        fgFornecedorRef,
        fgDesc,
        fgLote,
        fgVal,
        fg,
        sg,
      ]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe produto com este código para este dono.' });
    }
    console.error('[WMS] atualizarProdutoDono:', err);
    res.status(500).json({ error: 'Erro ao atualizar produto do dono.' });
  }
}

/** Ajuste rápido de categoria e/ou conservação (pendências de cadastro na tela). */
async function patchCadastroOperacionalProdutoDono(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdProduto, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });

    const hasCat = req.body.CD_CATEGORIA !== undefined || req.body.cd_categoria !== undefined;
    const hasCons = req.body.TIPO_ARMAZENAGEM !== undefined || req.body.tipo_armazenagem !== undefined;
    if (!hasCat && !hasCons) {
      return res.status(400).json({ error: 'Informe categoria e/ou conservação para atualizar.' });
    }

    const sets = [];
    const params = [cd, tid];
    let i = 3;

    if (hasCat) {
      const cdCategoriaRaw = req.body.CD_CATEGORIA ?? req.body.cd_categoria;
      const cdCategoria =
        cdCategoriaRaw != null && String(cdCategoriaRaw).trim() !== '' ? parseInt(String(cdCategoriaRaw), 10) : null;
      if (cdCategoria != null && !Number.isFinite(cdCategoria)) {
        return res.status(400).json({ error: 'Categoria inválida.' });
      }
      if (cdCategoria != null) {
        const okCat = await assertCategoriaTenant(pool, tid, cdCategoria);
        if (!okCat) return res.status(400).json({ error: 'Categoria não encontrada para este tenant.' });
      }
      sets.push(`"CD_CATEGORIA" = $${i}`);
      params.push(cdCategoria);
      i++;
    }

    if (hasCons) {
      const tipoArmazenagem = normTipoArmazenagem(req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem);
      if ((req.body.TIPO_ARMAZENAGEM ?? req.body.tipo_armazenagem) && !tipoArmazenagem) {
        return res.status(400).json({ error: 'Tipo de armazenagem inválido (SECO/REFRIGERADO/CONGELADO).' });
      }
      sets.push(`"TIPO_ARMAZENAGEM" = $${i}`);
      params.push(tipoArmazenagem);
      i++;
    }

    sets.push(`"DH_MAINTENANCE" = CURRENT_TIMESTAMP`, `"SG_USER" = $${i}`);
    params.push(sg);
    i++;

    const r = await pool.query(
      `UPDATE "WMS_PRODUTO_DONO"
       SET ${sets.join(', ')}
       WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2
         AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'
       RETURNING "CD_PRODUTO", "CD_DONO", "CODIGO", "NOME", "TIPO_ARMAZENAGEM", "CD_CATEGORIA"`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Produto não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (schemaMissing(err)) {
      return res.status(503).json({
        error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
      });
    }
    console.error('[WMS] patchCadastroOperacionalProdutoDono:', err);
    res.status(500).json({ error: 'Erro ao atualizar cadastro operacional do produto.' });
  }
}

function importarProdutosXml(req, res) {
  uploadProdutosXml(req, res, async (err) => {
    if (err) {
      console.warn('[WMS] importarProdutosXml multer:', err && err.code, err && err.message);
      return res.status(400).json({ error: mensagemErroMulterProdutosXml(err) });
    }
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDonoReqRaw = req.body.CD_DONO ?? req.body.cd_dono;
    const cdDonoReq =
      cdDonoReqRaw != null && String(cdDonoReqRaw).trim() !== '' ? parseInt(String(cdDonoReqRaw), 10) : null;
    if (cdDonoReq != null && !Number.isFinite(cdDonoReq)) {
      return res.status(400).json({ error: 'Dono do estoque (CD_DONO) inválido.' });
    }
    if (cdDonoReq != null) {
      const okDono = await assertDonoTenant(pool, tid, cdDonoReq);
      if (!okDono) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    }
    const files = multerFilesToArray(req);
    if (!files.length) {
      return res.status(400).json({
        error:
          'Nenhum arquivo recebido. Envie um ou mais XML no campo "arquivos" (multipart). Se usou outro cliente/API, use o mesmo nome de campo que o formulário da Torre.',
      });
    }

    const stats = {
      arquivos: files.length,
      arquivosComDonoAutomatico: 0,
      itensLidos: 0,
      inseridos: 0,
      atualizados: 0,
      ignorados: 0,
      erros: 0,
    };
    const erros = [];
    const sqlUpdate = `
      UPDATE "WMS_PRODUTO_DONO"
         SET "NOME" = CASE WHEN $4::text IS NOT NULL AND $4::text <> '' THEN $4::text ELSE "NOME" END,
             "UNIDADE" = COALESCE(NULLIF($5::text, ''), "UNIDADE"),
             "CODIGO_BARRAS" = COALESCE(NULLIF($6::text, ''), "CODIGO_BARRAS"),
             "NCM" = COALESCE(NULLIF($7::text, ''), "NCM"),
             "ORIGEM_CADASTRO" = 'IMPORT_XML_PRODUTO',
             "FG_FORNECEDOR_REF" = 'N',
             "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
             "SG_USER" = $8::text
       WHERE "TENANT_ID" = $1
         AND "CD_DONO" = $2::integer
         AND (
           LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
           OR LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g'))
              = LOWER(regexp_replace(TRIM($3::text), '[^0-9A-Za-z]', '', 'g'))
         )
       RETURNING "CD_PRODUTO"
    `;
    const sqlInsert = `
      INSERT INTO "WMS_PRODUTO_DONO" (
        "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "CODIGO_BARRAS", "NCM", "TIPO_ARMAZENAGEM",
        "ORIGEM_CADASTRO", "FG_FORNECEDOR_REF",
        "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE", "FGACTIVE", "SG_USER"
      ) VALUES ($1, $2::integer, $3, $4, $5, $6, $7, 'SECO', 'IMPORT_XML_PRODUTO', 'N', 'N', 'N', $9, 'S', $8)
      RETURNING "CD_PRODUTO"
    `;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of files) {
        const nome = String(f.originalname || 'arquivo.xml');
        if (!nome.toLowerCase().endsWith('.xml')) {
          stats.ignorados++;
          continue;
        }
        let xml;
        try {
          xml = f.buffer.toString('utf8');
        } catch (_) {
          stats.erros++;
          erros.push({ arquivo: nome, erro: 'Falha ao ler arquivo.' });
          continue;
        }
        const parsed = parseProdutosFromXml(xml);
        if (parsed.err) {
          stats.erros++;
          erros.push({ arquivo: nome, erro: parsed.err });
          continue;
        }
        const parsedOk = parsed.ok || {};
        const itens = Array.isArray(parsedOk.itens) ? parsedOk.itens : [];
        let cdDonoEfetivo = cdDonoReq;
        if (!Number.isFinite(cdDonoEfetivo)) {
          const infer = await resolveDonoByCgc(client, tid, parsedOk.cnpj_emitente);
          if (infer.status === 'ok') {
            cdDonoEfetivo = infer.cdDono;
            stats.arquivosComDonoAutomatico++;
          } else if (infer.status === 'ambiguo') {
            stats.erros++;
            erros.push({
              arquivo: nome,
              erro: 'Emitente da NF-e corresponde a mais de um dono ativo com o mesmo CNPJ. Selecione o dono manualmente.',
            });
            continue;
          } else {
            stats.erros++;
            erros.push({
              arquivo: nome,
              erro: 'Não foi possível identificar o dono pelo CNPJ do emitente. Selecione o dono manualmente.',
            });
            continue;
          }
        }
        for (const item of itens) {
          if (!item.codigo || !item.nome) {
            stats.ignorados++;
            continue;
          }
          stats.itensLidos++;
          const codigoItem = await resolveCodigoProdutoDono(client, tid, cdDonoEfetivo, item.codigo);
          if (!codigoItem) {
            stats.ignorados++;
            continue;
          }
          const params = [tid, cdDonoEfetivo, codigoItem, item.nome, item.unidade, item.codBarras, item.ncm, sg];
          const rUp = await client.query(sqlUpdate, params);
          if (rUp.rowCount > 0) {
            stats.atualizados++;
            continue;
          }
          try {
            const fgValImport = aplicarFgControlaValidade('N', { codigoProduto: codigoItem });
            await client.query(sqlInsert, [...params, fgValImport]);
            stats.inseridos++;
          } catch (e2) {
            if (e2.code === '23505') {
              await client.query(sqlUpdate, params);
              stats.atualizados++;
            } else {
              throw e2;
            }
          }
        }
      }
      await client.query('COMMIT');
      res.json({ ok: true, resumo: stats, erros: erros.slice(0, 50) });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      if (schemaMissing(e)) {
        return res.status(503).json({
          error: 'Estrutura de produtos do dono desatualizada. Execute backend/scripts/wms_produtos_dono_postgres.sql.',
        });
      }
      console.error('[WMS] importarProdutosXml:', e);
      res.status(500).json({ error: 'Erro ao importar produtos por XML.' });
    } finally {
      client.release();
    }
  });
}

// ---------- De-para produto ----------

async function listarDepara(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { cdDono, codigoExterno, codigoInterno, fgactive } = req.query;
    let sql = `
      SELECT d."CD_DEPARA", d."TENANT_ID", d."CD_DONO", d."CODIGO_EXTERNO", d."CODIGO_INTERNO",
             d."FATOR_CONVERSAO", d."OBSERVACAO", d."FGACTIVE", d."DH_MAINTENANCE", d."SG_USER",
             o."NOME" AS "NM_DONO", o."CODIGO" AS "CD_DONO_CODIGO"
      FROM "WMS_DEPARA_PRODUTO" d
      INNER JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = d."CD_DONO" AND o."TENANT_ID" = d."TENANT_ID"
      WHERE d."TENANT_ID" = $1`;
    let p = [tid];
    let i = 2;
    if (cdDono != null && String(cdDono).trim() !== '') {
      sql += ` AND d."CD_DONO" = $${i}::integer`;
      p.push(parseInt(cdDono, 10));
      i++;
    }
    if (codigoExterno) {
      const fExt = appendSqlFiltroCodigoContem(sql, p, 'd."CODIGO_EXTERNO"', codigoExterno, i);
      sql = fExt.sql;
      p = fExt.params;
      i = fExt.nextIndex;
    }
    if (codigoInterno) {
      const fInt = appendSqlFiltroCodigoContem(sql, p, 'd."CODIGO_INTERNO"', codigoInterno, i);
      sql = fInt.sql;
      p = fInt.params;
      i = fInt.nextIndex;
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sql += ` AND d."FGACTIVE" = $${i}`;
      p.push(fgactive);
      i++;
    }
    sql += ` ORDER BY o."NOME", d."CODIGO_EXTERNO"`;
    const r = await pool.query(sql, p);
    res.json(r.rows);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabela WMS_DEPARA_PRODUTO não encontrada. Execute backend/scripts/wms_depara_produto_postgres.sql.',
      });
    }
    console.error('[WMS] listarDepara:', err);
    res.status(500).json({ error: 'Erro ao listar de-para.' });
  }
}

async function criarDepara(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const ok = await assertDonoTenant(pool, tid, cdDono);
    if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const ext = normCodigoExterno(req.body.CODIGO_EXTERNO ?? req.body.codigo_externo);
    const interno = normCodigoInterno(req.body.CODIGO_INTERNO ?? req.body.codigo_interno);
    if (!ext) return res.status(400).json({ error: 'Código externo inválido (até 64 caracteres).' });
    if (!interno) {
      return res.status(400).json({
        error: 'Código interno inválido (até 128 caracteres: letras, números, ponto, hífen, sublinhado).',
      });
    }
    const fator = normFator(req.body.FATOR_CONVERSAO ?? req.body.fator_conversao);
    if (fator == null) return res.status(400).json({ error: 'Fator de conversão deve ser um número maior que zero.' });
    const obs =
      req.body.OBSERVACAO != null || req.body.observacao != null
        ? String(req.body.OBSERVACAO ?? req.body.observacao).trim().slice(0, 255) || null
        : null;
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `INSERT INTO "WMS_DEPARA_PRODUTO" (
        "TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "OBSERVACAO", "FGACTIVE", "SG_USER"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [tid, cdDono, ext, interno, fator, obs, fg, sg]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabela WMS_DEPARA_PRODUTO não encontrada. Execute backend/scripts/wms_depara_produto_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe de-para com este código externo para este dono.' });
    }
    console.error('[WMS] criarDepara:', err);
    res.status(500).json({ error: 'Erro ao criar de-para.' });
  }
}

async function atualizarDepara(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdDepara, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdDono = parseInt(req.body.CD_DONO ?? req.body.cd_dono, 10);
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'Dono do estoque (CD_DONO) é obrigatório.' });
    const ok = await assertDonoTenant(pool, tid, cdDono);
    if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    const ext = normCodigoExterno(req.body.CODIGO_EXTERNO ?? req.body.codigo_externo);
    const interno = normCodigoInterno(req.body.CODIGO_INTERNO ?? req.body.codigo_interno);
    if (!ext) return res.status(400).json({ error: 'Código externo inválido.' });
    if (!interno) return res.status(400).json({ error: 'Código interno inválido.' });
    const fator = normFator(req.body.FATOR_CONVERSAO ?? req.body.fator_conversao);
    if (fator == null) return res.status(400).json({ error: 'Fator de conversão deve ser um número maior que zero.' });
    const obs =
      req.body.OBSERVACAO != null || req.body.observacao != null
        ? String(req.body.OBSERVACAO ?? req.body.observacao).trim().slice(0, 255) || null
        : null;
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
       SET "CD_DONO" = $3, "CODIGO_EXTERNO" = $4, "CODIGO_INTERNO" = $5, "FATOR_CONVERSAO" = $6,
           "OBSERVACAO" = $7, "FGACTIVE" = $8, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $9
       WHERE "CD_DEPARA" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, cdDono, ext, interno, fator, obs, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'De-para não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabela WMS_DEPARA_PRODUTO não encontrada. Execute backend/scripts/wms_depara_produto_postgres.sql.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe de-para com este código externo para este dono.' });
    }
    console.error('[WMS] atualizarDepara:', err);
    res.status(500).json({ error: 'Erro ao atualizar de-para.' });
  }
}

async function atualizarDoca(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdDoca, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cdArm = parseInt(req.body.CD_ARMAZEM ?? req.body.cd_armazem, 10);
    if (!Number.isFinite(cdArm)) return res.status(400).json({ error: 'Armazém (CD_ARMAZEM) é obrigatório.' });
    const ok = await assertArmazemTenant(pool, tid, cdArm);
    if (!ok) return res.status(400).json({ error: 'Armazém não encontrado para este tenant.' });
    const codigo = normCodigo(req.body.CODIGO ?? req.body.codigo);
    const nome = req.body.NOME != null ? String(req.body.NOME).trim() : '';
    if (!codigo) return res.status(400).json({ error: 'Código inválido.' });
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const fgR = yn(req.body.FG_RECEBE ?? req.body.fg_recebe, 'S');
    const fgE = yn(req.body.FG_EXPEDE ?? req.body.fg_expede, 'S');
    const fg = yn(req.body.FGACTIVE ?? req.body.fgactive, 'S');
    const r = await pool.query(
      `UPDATE "WMS_DOCA"
       SET "CD_ARMAZEM" = $3, "CODIGO" = $4, "NOME" = $5, "FG_RECEBE" = $6, "FG_EXPEDE" = $7, "FGACTIVE" = $8,
           "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $9
       WHERE "CD_DOCA" = $1::integer AND "TENANT_ID" = $2
       RETURNING *`,
      [cd, tid, cdArm, codigo, nome, fgR, fgE, fg, sg]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Doca não encontrada.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (tableMissing(err)) {
      return res.status(503).json({
        error: 'Tabelas WMS não encontradas. Execute backend/scripts/wms_cadastros_mestre_postgres.sql no banco.',
      });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe doca com este código neste armazém.' });
    }
    console.error('[WMS] atualizarDoca:', err);
    res.status(500).json({ error: 'Erro ao atualizar doca.' });
  }
}

// ---------- Catálogo operacional OL (WMS_PRODUTO_OPERACIONAL) ----------

async function listarProdutosOperacionais(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const rows = await prodOp.listarProdutosOperacionais(tid, {
      cdDono: req.query.cdDono,
      codigoOperacional: req.query.codigoOperacional || req.query.codigoOl,
      codigoEstoque: req.query.codigoEstoque,
      nome: req.query.nome,
      fgactive: req.query.fgactive,
      semUnidade: req.query.semUnidade === '1' || req.query.semUnidade === 'true',
    });
    const cdDono =
      req.query.cdDono != null && String(req.query.cdDono).trim() !== ''
        ? parseInt(req.query.cdDono, 10)
        : null;
    const semUnidadeTotal = await prodOp.contarSemUnidade(
      tid,
      Number.isFinite(cdDono) ? cdDono : null
    );
    res.json({ rows, resumo: { semUnidadeTotal } });
  } catch (err) {
    if (prodOp.schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabela WMS_PRODUTO_OPERACIONAL não encontrada. Execute backend/scripts/adicionar_wms_produto_operacional_postgres.sql.',
      });
    }
    console.error('[WMS] listarProdutosOperacionais:', err);
    res.status(500).json({ error: 'Erro ao listar catálogo operacional OL.' });
  }
}

async function atualizarProdutoOperacional(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdOperacional, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });

    const unidade =
      req.body.UNIDADE != null || req.body.unidade != null
        ? prodOp.normUnidade(req.body.UNIDADE ?? req.body.unidade)
        : undefined;
    if (req.body.UNIDADE != null || req.body.unidade != null) {
      if (!unidade) return res.status(400).json({ error: 'Unidade operacional inválida (até 10 caracteres).' });
    }

    const fatorRaw = req.body.FATOR_CONVERSAO ?? req.body.fator_conversao;
    const fator = fatorRaw != null && fatorRaw !== '' ? normFator(fatorRaw) : undefined;
    if (fatorRaw != null && fatorRaw !== '' && fator == null) {
      return res.status(400).json({ error: 'Fator de conversão deve ser um número maior que zero.' });
    }

    const fg =
      req.body.FGACTIVE != null || req.body.fgactive != null
        ? yn(req.body.FGACTIVE ?? req.body.fgactive, 'S')
        : undefined;

    const sets = [];
    const params = [cd, tid];
    let pi = 3;
    if (unidade !== undefined) {
      sets.push(`"UNIDADE" = $${pi}`);
      params.push(unidade);
      pi++;
    }
    if (fator !== undefined) {
      sets.push(`"FATOR_CONVERSAO" = $${pi}`);
      params.push(fator);
      pi++;
    }
    if (fg !== undefined) {
      sets.push(`"FGACTIVE" = $${pi}`);
      params.push(fg);
      pi++;
    }
    if (!sets.length) return res.status(400).json({ error: 'Nenhum campo para atualizar.' });

    sets.push(`"DH_MAINTENANCE" = CURRENT_TIMESTAMP`, `"SG_USER" = $${pi}`);
    params.push(sg);

    const r = await pool.query(
      `UPDATE "WMS_PRODUTO_OPERACIONAL"
          SET ${sets.join(', ')}
        WHERE "CD_OPERACIONAL" = $1::integer AND "TENANT_ID" = $2
        RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Vínculo operacional não encontrado.' });
    res.json(r.rows[0]);
  } catch (err) {
    if (prodOp.schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabela WMS_PRODUTO_OPERACIONAL não encontrada. Execute backend/scripts/adicionar_wms_produto_operacional_postgres.sql.',
      });
    }
    console.error('[WMS] atualizarProdutoOperacional:', err);
    res.status(500).json({ error: 'Erro ao atualizar catálogo operacional OL.' });
  }
}

async function preencherUnidadesOperacionaisFaltantes(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDonoRaw = req.body.CD_DONO ?? req.body.cd_dono ?? req.query.cdDono;
    const cdDono =
      cdDonoRaw != null && String(cdDonoRaw).trim() !== '' ? parseInt(cdDonoRaw, 10) : null;
    if (cdDono != null && !Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Dono inválido.' });
    }
    if (cdDono != null) {
      const ok = await assertDonoTenant(pool, tid, cdDono);
      if (!ok) return res.status(400).json({ error: 'Dono não encontrado para este tenant.' });
    }
    const dryRun = req.body.dryRun === true || req.query.dryRun === '1' || req.query.dryRun === 'true';
    const resultado = await prodOp.preencherUnidadesFaltantes(tid, { cdDono, dryRun, sgUser: sg });
    res.json(resultado);
  } catch (err) {
    if (prodOp.schemaMissing(err)) {
      return res.status(503).json({
        error:
          'Tabela WMS_PRODUTO_OPERACIONAL não encontrada. Execute backend/scripts/adicionar_wms_produto_operacional_postgres.sql.',
      });
    }
    console.error('[WMS] preencherUnidadesOperacionaisFaltantes:', err);
    res.status(500).json({ error: 'Erro ao preencher unidades operacionais faltantes.' });
  }
}

module.exports = {
  listarDonos,
  criarDono,
  atualizarDono,
  listarArmazens,
  criarArmazem,
  atualizarArmazem,
  listarAreas,
  criarArea,
  atualizarArea,
  listarDocas,
  criarDoca,
  atualizarDoca,
  listarGruposProduto,
  criarGrupoProduto,
  atualizarGrupoProduto,
  listarCategoriasProduto,
  criarCategoriaProduto,
  atualizarCategoriaProduto,
  listarProdutosDono,
  obterProdutoDono,
  listarSugestoesCategoriaProduto,
  aplicarSugestoesCategoriaProduto,
  executarJobCategoriaSugestaoProduto,
  listarLogJobCategoriaSugestaoProduto,
  listarPendenciasCadastroProduto,
  middlewareUploadOlXlsx,
  simularClassificacaoOlProduto,
  aplicarClassificacaoOlProduto,
  criarProdutoDono,
  atualizarProdutoDono,
  patchCadastroOperacionalProdutoDono,
  importarProdutosXml,
  listarDepara,
  criarDepara,
  atualizarDepara,
  listarProdutosOperacionais,
  atualizarProdutoOperacional,
  preencherUnidadesOperacionaisFaltantes,
};
