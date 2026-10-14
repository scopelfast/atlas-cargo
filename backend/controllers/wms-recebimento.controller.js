'use strict';

const multer = require('multer');
const { pool } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const {
  carregarMapaProdutosEstoque,
  resolverCfgDoMapa,
  resolverProdutoEstoque,
} = require('../services/wms-resolver-codigo-estoque.service');
const { parseNfeXml } = require('../services/wms-nfe-xml-parse.service');
const {
  validarAutorizadorComSenha,
  usuarioTemPrograma,
} = require('../utils/wms-supervisor-auth');
const {
  listarRelatorioVencimentoPorRecebimentoEncerrado,
  linhasParaCsv,
} = require('../services/wms-relatorio-vencimento.service');
const {
  listarHistoricoEnvioRelatorioVencimento,
} = require('../services/wms-relatorio-vencimento-envio-log.service');
const {
  listarPosicaoEstoque,
  linhasParaCsv: linhasPosicaoParaCsv,
  montarRotuloFiltroDono,
} = require('../services/wms-relatorio-posicao-estoque.service');
const { buildPosicaoEstoqueHtml } = require('../services/wms-relatorio-posicao-estoque-html.service');
const {
  buscarSugestoesProdutoRecebimento,
} = require('../services/wms-produto-sugestao-recebimento.service');
const {
  montarLinhasExportItensRecebimento,
  linhasItensParaCsvBody,
  csvCell: csvCellItens,
} = require('../services/wms-recebimento-export-itens.service');

const PROGRAMA_LIBERAR_VALIDADE_MIN = 'wms-recebimento-liberar-validade-min';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.xml')) return cb(null, true);
    cb(new Error('Apenas arquivos .xml são aceitos.'));
  },
});

function tableMissing(err) {
  return err && err.code === '42P01';
}

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

async function assertDonoTenant(tenantId, cdDono) {
  if (cdDono == null || cdDono === '') return true;
  const n = parseInt(cdDono, 10);
  if (!Number.isFinite(n)) return false;
  const r = await pool.query(
    `SELECT 1 FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
    [n, tenantId]
  );
  return r.rows.length > 0;
}

async function resolveDonoByDestinatarioCnpj(tenantId, cnpjDest) {
  const cnpj = normDocFiscal(cnpjDest);
  if (!cnpj || cnpj.length !== 14) {
    return { status: 'sem-cnpj', cdDono: null, dono: null };
  }
  const r = await pool.query(
    `SELECT "CD_DONO", "CODIGO", "NOME", "CGC"
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "FGACTIVE" = 'S'
        AND TRIM(COALESCE("CGC", '')) = $2
      ORDER BY "CD_DONO"`,
    [tenantId, cnpj]
  );
  if (!r.rows.length) return { status: 'nao-encontrado', cdDono: null, dono: null, cnpj };
  if (r.rows.length > 1) return { status: 'ambiguo', cdDono: null, dono: null, cnpj, matches: r.rows };
  const dono = r.rows[0];
  return {
    status: 'ok',
    cdDono: parseInt(dono.CD_DONO, 10),
    dono,
    cnpj,
  };
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function digits(v) {
  return v != null ? String(v).replace(/\D/g, '') : '';
}

function chaveNfe44(v) {
  const d = digits(v);
  return d.length >= 44 ? d.slice(-44) : d.length === 44 ? d : null;
}

/** Busca NF-e de entrada já importada (trim em CHAVE_NFE CHAR(44)). */
async function buscarNfeEntradaPorChave(tenantId, chaveRaw) {
  const ch44 = chaveNfe44(chaveRaw);
  if (!ch44) return null;
  const r = await pool.query(
    `SELECT "CD_NFE", "TENANT_ID", "CD_DONO", trim("CHAVE_NFE") AS "CHAVE_NFE",
            "NUMERO_NF", "SERIE", "DH_IMPORTACAO", "FG_CONFERIDO", "ST_RECEBIMENTO"
       FROM "WMS_NFE_ENTRADA"
      WHERE "TENANT_ID" = $1 AND trim("CHAVE_NFE") = $2
      LIMIT 1`,
    [tenantId, ch44]
  );
  return r.rows[0] || null;
}

/** CPF (até 11 dígitos) ou CNPJ (12–14): completa zeros à esquerda para gravar sem perder o 1º dígito. */
function normDocFiscal(v) {
  const x = digits(v);
  if (!x) return null;
  if (x.length <= 11) return x.padStart(11, '0').slice(-11);
  if (x.length > 14) return x.slice(-14);
  return x.padStart(14, '0');
}

function yn(v, def) {
  if (v == null || v === '') return def;
  const c = String(v).trim().toUpperCase().charAt(0);
  if (c === 'S' || c === 'Y' || c === '1') return 'S';
  if (c === 'N' || c === '0') return 'N';
  return def;
}

function normalizeStorageType(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['SECO', 'REFRIGERADO', 'CONGELADO'].includes(s)) return s;
  return null;
}

function normCodigoInterno(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.length > 128) return null;
  return /^[A-Za-z0-9._-]+$/.test(s) ? s : null;
}

function normCodigoExterno(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.length > 64) return null;
  return s;
}

/** Chaves para casar com UK LOWER(TRIM(codigo_externo)) + equivalência numérica (00123 vs 123). */
function deparaLookupKeysFromCProd(cProd) {
  const raw = normCodigoExterno(cProd);
  if (!raw) return [];
  const keys = new Set([raw.toLowerCase()]);
  if (/^\d+$/.test(raw)) keys.add(String(parseInt(raw, 10)).toLowerCase());
  return [...keys];
}

function buildDeparaHitMap(rows) {
  const by = new Map();
  for (const d of rows || []) {
    const ex = String(d.CODIGO_EXTERNO ?? d.codigo_externo ?? '').trim();
    if (!ex) continue;
    const k = ex.toLowerCase();
    by.set(k, d);
    if (/^\d+$/.test(ex)) by.set(String(parseInt(ex, 10)).toLowerCase(), d);
  }
  return by;
}

function hitDeparaFromMap(byMap, cProd) {
  for (const k of deparaLookupKeysFromCProd(cProd)) {
    if (byMap.has(k)) return byMap.get(k);
  }
  return null;
}

/** Fator informado na conferência: permite 0 (= ainda sem conversão na tela; no cálculo trata-se como 1). */
function normFator(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function toBool(v) {
  if (v === true || v === 1) return true;
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return s === '1' || s === 's' || s === 'sim' || s === 'y' || s === 'yes' || s === 'true';
}

const DEFAULT_MIN_DIAS_VALID_RECEB = 90;

async function obterDiasMinValidadeRecebimentoDono(tenantId, cdDono) {
  const r = await pool.query(
    `SELECT "NU_DIAS_MIN_VALID_RECEB" FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
    [cdDono, tenantId]
  );
  if (!r.rows.length) return DEFAULT_MIN_DIAS_VALID_RECEB;
  const raw = r.rows[0].NU_DIAS_MIN_VALID_RECEB ?? r.rows[0].nu_dias_min_valid_receb;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MIN_DIAS_VALID_RECEB;
  return Math.min(n, 1095);
}

function parseDataValidadeConferencia(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const parts = s.split('-').map((x) => parseInt(x, 10));
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

/** Dias corridos entre hoje (UTC, só data) e a data de validade (≥ 0 se vence hoje ou depois). */
function diasCorridosAteValidade(validadeUtcDate) {
  const now = new Date();
  const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const t1 = Date.UTC(
    validadeUtcDate.getUTCFullYear(),
    validadeUtcDate.getUTCMonth(),
    validadeUtcDate.getUTCDate()
  );
  return Math.round((t1 - t0) / 86400000);
}

function normCodigoProdutoKey(v) {
  return String(v || '').trim().toLowerCase();
}

function itemTemDadosConferencia(p) {
  const qtdRaw = String(p?.qtdRecebida ?? '').trim().replace(',', '.');
  const qtd = qtdRaw !== '' ? Number(qtdRaw) : null;
  return !!(
    String(p?.codigoProduto ?? '').trim() ||
    (p?.cdProduto != null && String(p.cdProduto).trim() !== '') ||
    String(p?.lote ?? '').trim() ||
    String(p?.validade ?? '').trim() ||
    (qtd != null && !Number.isNaN(qtd)) ||
    String(p?.observacao ?? '').trim()
  );
}

/** Para ENCERRAR a NF-e exigimos que toda linha da conferência com produto
 *  resolvido tenha `qtdRecebida` explicitamente preenchida (mesmo que 0).
 *  Sem isso o `qtdConvertida` fica null/0 e a entrada não soma no estoque
 *  (caso clássico: NF-e "encerrada em branco" — operador clicou Encerrar
 *  sem digitar nada na coluna "Qtd recebida"). Aceitar 0 cobre o caso
 *  legítimo de "item recusado / não recebido fisicamente" sem deixar
 *  null passar despercebido.
 *
 *  Retorna [] se está tudo OK ou a lista de pendências:
 *    [{ nItem, codigoProduto, motivo }]
 */
function identificarItensSemQtdRecebida(payload) {
  const lista = Array.isArray(payload) ? payload : [];
  const pendencias = [];
  for (const p of lista) {
    const temProduto =
      String(p?.codigoProduto ?? '').trim() !== '' ||
      (p?.cdProduto != null && String(p.cdProduto).trim() !== '');
    if (!temProduto) continue;
    const qtd = p?.qtdRecebida;
    const naoPreenchida =
      qtd == null ||
      qtd === '' ||
      (typeof qtd === 'number' && Number.isNaN(qtd));
    if (naoPreenchida) {
      pendencias.push({
        nItem: p?.nItem != null ? String(p.nItem) : '?',
        codigoProduto: String(p?.codigoProduto ?? '').trim() || (p?.cdProduto != null ? String(p.cdProduto) : '?'),
        motivo: 'Qtd recebida vazia',
      });
    }
  }
  return pendencias;
}

async function carregarMapaCfgProdutosConferencia(tid, cdDono, itens) {
  const codigos = [];
  const ids = new Set();
  for (const it of itens || []) {
    const cp = String(it?.codigoProduto ?? '').trim();
    if (cp) codigos.push(cp);
    const id =
      it?.cdProduto != null && String(it.cdProduto).trim() !== '' ? parseInt(it.cdProduto, 10) : null;
    if (Number.isFinite(id)) ids.add(id);
  }
  const byCodigoLower = await carregarMapaProdutosEstoque(pool, tid, cdDono, codigos);
  const cfgById = new Map();
  if (ids.size) {
    const r2 = await pool.query(
      `SELECT "CD_PRODUTO", "CODIGO", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE"
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = ANY($3::int[])
          AND COALESCE("FGACTIVE", 'S') = 'S'`,
      [tid, cdDono, Array.from(ids)]
    );
    for (const row of r2.rows || []) {
      cfgById.set(parseInt(row.CD_PRODUTO, 10), row);
    }
  }
  return { byCodigoLower, cfgById };
}

function resolverCfgProdutoItem(p, maps) {
  return resolverCfgDoMapa(p, maps.byCodigoLower, maps.cfgById);
}

async function resolverCfgProdutoItemCompleto(db, tid, cdDono, p, maps) {
  let cfg = resolverCfgProdutoItem(p, maps);
  if (cfg) return cfg;
  const cp = String(p?.codigoProduto ?? '').trim();
  if (!cp) return null;
  const hit = await resolverProdutoEstoque(db, tid, cdDono, cp, {
    codigoExterno: p?.codigoExterno || null,
  });
  if (!hit) return null;
  return {
    CD_PRODUTO: hit.cdProduto,
    CODIGO: hit.codigoEstoque,
    FG_CONTROLA_LOTE: hit.fgControlaLote,
    FG_CONTROLA_VALIDADE: hit.fgControlaValidade,
    FATOR_CONVERSAO: hit.fatorConversao,
  };
}

function itemTemQuantidadeRecebida(p) {
  const qtdRaw = String(p?.qtdRecebida ?? '').trim().replace(',', '.');
  let qtd = qtdRaw !== '' ? Number(qtdRaw) : NaN;
  if (!Number.isFinite(qtd) || qtd <= 0) {
    const qc = Number(p?.qtdConvertida);
    qtd = Number.isFinite(qc) ? qc : 0;
  }
  return qtd > 0;
}

function validarRequisitosLoteValidadeItem(p, cfg, nItem) {
  const cod = String(p?.codigoProduto ?? '').trim();
  if (!cfg) {
    if (cod) {
      return {
        ok: false,
        status: 400,
        error: `Item ${nItem}: produto "${cod}" não encontrado no cadastro do dono da NF.`,
      };
    }
    return { ok: true };
  }
  const recebeu = itemTemQuantidadeRecebida(p);
  const reqLote = String(cfg.FG_CONTROLA_LOTE ?? cfg.fg_controla_lote ?? '').toUpperCase() === 'S';
  const reqVal =
    String(cfg.FG_CONTROLA_VALIDADE ?? cfg.fg_controla_validade ?? '').toUpperCase() === 'S';
  if (reqLote && recebeu && !String(p?.lote ?? '').trim()) {
    return { ok: false, status: 400, error: `Item ${nItem}: lote é obrigatório para este produto.` };
  }
  if (reqVal && recebeu && !String(p?.validade ?? '').trim()) {
    return {
      ok: false,
      status: 400,
      error: `Item ${nItem}: validade é obrigatória para este produto (quantidade recebida > 0).`,
    };
  }
  return { ok: true };
}

async function validarItensConferenciaComCadastro(tid, cdDono, itens) {
  const conferidos = (itens || []).filter(itemTemDadosConferencia);
  if (!conferidos.length) return { ok: true, maps: null };
  const maps = await carregarMapaCfgProdutosConferencia(tid, cdDono, conferidos);
  for (const p of conferidos) {
    const nItem = String(p?.nItem ?? '').trim() || '?';
    let cfg = resolverCfgProdutoItem(p, maps);
    if (!cfg) {
      cfg = await resolverCfgProdutoItemCompleto(pool, tid, cdDono, p, maps);
    }
    const vr = validarRequisitosLoteValidadeItem(p, cfg, nItem);
    if (!vr.ok) return { ...vr, maps };
  }
  return { ok: true, maps };
}

function validarValidadeMinimaDonoItem({ nItem, validadeRaw, diasMinDono }) {
  const vdRaw = String(validadeRaw || '').trim();
  if (!vdRaw) return { ok: true };
  const vd = parseDataValidadeConferencia(vdRaw);
  if (!vd) {
    return {
      ok: false,
      status: 400,
      error: `Item ${nItem}: data de validade inválida (${vdRaw}). Use AAAA-MM-DD ou DD/MM/AAAA.`,
    };
  }
  const dias = diasCorridosAteValidade(vd);
  if (dias < diasMinDono) {
    return {
      ok: false,
      status: 409,
      error: `Item ${nItem}: a validade informada corresponde a ${dias} dia(s) até o vencimento; o dono do estoque exige no mínimo ${diasMinDono} dia(s). Ajuste a data ou o parâmetro em Cadastros WMS > Dono do estoque.`,
    };
  }
  return { ok: true };
}

function parseConferenciaJsonArmazenada(v) {
  if (v == null) return [];
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t || t === 'null') return [];
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p : [];
    } catch (_) {
      return [];
    }
  }
  return Array.isArray(v) ? v : [];
}

/** Reaponta CONFERENCIA_JSON para outro dono (de-para + código interno no cadastro novo). */
async function remapearConferenciaParaNovoDono(tid, cdDonoNovo, linhasJson, conferenciaJson) {
  const linhasArr = Array.isArray(linhasJson) ? linhasJson : [];
  const confArr = parseConferenciaJsonArmazenada(conferenciaJson);
  if (!confArr.length) {
    return { conferencia: [], naoResolvidos: [], remapeados: 0 };
  }
  const linhasPorN = new Map(linhasArr.map((l) => [String(l.nItem || ''), l]));
  const externosLowerKeys = Array.from(
    new Set(linhasArr.flatMap((l) => deparaLookupKeysFromCProd(l?.cProd)))
  );
  let byExterno = new Map();
  if (externosLowerKeys.length) {
    const rDep = await pool.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
      [tid, cdDonoNovo, externosLowerKeys]
    );
    byExterno = buildDeparaHitMap(rDep.rows || []);
  }
  const draft = confArr.map((item) => {
    const nItem = String(item.nItem || '');
    const linha = linhasPorN.get(nItem) || {};
    const codigoExterno = normCodigoExterno(item.codigoExterno || linha.cProd);
    const hitDepara = codigoExterno ? hitDeparaFromMap(byExterno, linha.cProd || codigoExterno) : null;
    const novo = { ...item, cdProduto: null };
    novo.codigoExterno = codigoExterno || novo.codigoExterno || null;
    if (hitDepara?.CODIGO_INTERNO) {
      novo.codigoProduto = String(hitDepara.CODIGO_INTERNO).trim();
      const fDep = normFator(hitDepara.FATOR_CONVERSAO);
      if (fDep != null && fDep > 0) novo.fatorConversao = fDep;
    }
    return novo;
  });
  const maps = await carregarMapaCfgProdutosConferencia(tid, cdDonoNovo, draft);
  const remapped = [];
  const naoResolvidos = [];
  let remapeados = 0;
  for (const novo of draft) {
    if (itemTemDadosConferencia(novo)) {
      const cfg = await resolverCfgProdutoItemCompleto(pool, tid, cdDonoNovo, novo, maps);
      if (cfg) {
        novo.cdProduto = parseInt(cfg.CD_PRODUTO, 10);
        novo.codigoProduto = String(cfg.CODIGO || novo.codigoProduto || '').trim();
        if (
          (novo.fatorConversao == null || Number(novo.fatorConversao) === 0) &&
          cfg.FATOR_CONVERSAO != null &&
          Number(cfg.FATOR_CONVERSAO) > 0
        ) {
          novo.fatorConversao = Number(cfg.FATOR_CONVERSAO);
        }
        remapeados++;
      } else if (String(novo.codigoProduto || '').trim()) {
        naoResolvidos.push({
          nItem: novo.nItem,
          codigoProduto: novo.codigoProduto,
          codigoExterno: novo.codigoExterno,
        });
      }
    }
    const fMult = normFator(novo.fatorConversao);
    const fatorMult = fMult === 0 || fMult == null ? 1 : fMult;
    const qtd = novo.qtdRecebida != null ? Number(novo.qtdRecebida) : null;
    if (qtd != null && !Number.isNaN(qtd)) {
      novo.qtdConvertida = Number((qtd * fatorMult).toFixed(6));
    }
    remapped.push(novo);
  }
  return { conferencia: remapped, naoResolvidos, remapeados };
}

async function trocarDonoDocumento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const novoDonoRaw = req.body?.CD_DONO ?? req.body?.cdDono;
    const novoDono = parseInt(novoDonoRaw, 10);
    if (!Number.isFinite(novoDono)) {
      return res.status(400).json({ error: 'Informe o novo dono do estoque (CD_DONO).' });
    }
    const okDono = await assertDonoTenant(tid, novoDono);
    if (!okDono) return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
    const force = toBool(req.body?.force ?? req.body?.forcar);

    const rDoc = await pool.query(
      `SELECT e."CD_NFE", e."CD_DONO", e."LINHAS_JSON", e."CONFERENCIA_JSON",
              COALESCE(NULLIF(TRIM(e."ST_RECEBIMENTO"), ''), 'ABERTA') AS "ST_RECEBIMENTO",
              e."CNPJ_DEST", d."NOME" AS "NM_DONO_ATUAL", d."CODIGO" AS "COD_DONO_ATUAL"
         FROM "WMS_NFE_ENTRADA" e
         LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = e."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"
        WHERE e."CD_NFE" = $1::integer AND e."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!rDoc.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    const doc = rDoc.rows[0];
    const st = String(doc.ST_RECEBIMENTO || '').toUpperCase();
    if (st === 'ENCERRADA') {
      return res.status(409).json({
        error: 'NF-e encerrada. Reabra o recebimento antes de trocar o dono do estoque.',
      });
    }
    const donoAtual = doc.CD_DONO != null ? parseInt(doc.CD_DONO, 10) : null;
    if (Number.isFinite(donoAtual) && donoAtual === novoDono) {
      return res.status(400).json({ error: 'O documento já está vinculado a este dono do estoque.' });
    }

    const { conferencia, naoResolvidos, remapeados } = await remapearConferenciaParaNovoDono(
      tid,
      novoDono,
      doc.LINHAS_JSON,
      doc.CONFERENCIA_JSON
    );
    if (naoResolvidos.length && !force) {
      return res.status(409).json({
        error:
          naoResolvidos.length +
          ' item(ns) da conferência não foram encontrados no cadastro do novo dono. Revise de-para/códigos ou confirme a troca para ajustar manualmente depois.',
        naoResolvidos,
        cdDonoNovo: novoDono,
        requerConfirmacao: true,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rUp = await client.query(
        `UPDATE "WMS_NFE_ENTRADA"
            SET "CD_DONO" = $3::integer,
                "CONFERENCIA_JSON" = $4::jsonb,
                "SG_USER" = $5
          WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2
          RETURNING "CD_NFE", "CD_DONO", "ST_RECEBIMENTO"`,
        [cd, tid, novoDono, JSON.stringify(conferencia), sg]
      );
      if (!rUp.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Documento não encontrado.' });
      }
      try {
        await client.query(
          `UPDATE "WMS_RECEBIMENTO_LIBERACAO_VALIDADE"
              SET "CD_DONO" = $3::integer
            WHERE "TENANT_ID" = $1 AND "CD_NFE" = $2::integer`,
          [tid, cd, novoDono]
        );
      } catch (libE) {
        if (!schemaMissing(libE)) throw libE;
      }
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw e;
    } finally {
      client.release();
    }

    const rNovo = await pool.query(
      `SELECT "CD_DONO", "CODIGO", "NOME", "CGC" FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
      [novoDono, tid]
    );
    const novoMeta = rNovo.rows[0] || {};
    const avisoDest =
      doc.CNPJ_DEST && novoMeta.CGC
        ? digits(doc.CNPJ_DEST) === digits(novoMeta.CGC)
          ? null
          : 'Atenção: o CNPJ do destinatário da NF-e não coincide com o CGC cadastrado do novo dono.'
        : null;

    return res.json({
      ok: true,
      cdNfe: cd,
      cdDonoAnterior: donoAtual,
      cdDonoNovo: novoDono,
      donoNovo: {
        CD_DONO: novoDono,
        CODIGO: novoMeta.CODIGO || null,
        NOME: novoMeta.NOME || null,
      },
      itensRemapeados: remapeados,
      naoResolvidos,
      avisoDest,
      mensagem:
        'Dono do estoque alterado. A conferência foi reapontada para o cadastro do novo dono (quantidades, lotes e validades preservados).',
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] trocarDonoDocumento:', e);
    return res.status(500).json({ error: 'Erro ao trocar dono do estoque nesta NF-e.' });
  }
}

/** Chave estável item+validade para comparar falhas atuais com liberações anteriores. */
function chaveFalhaValidadeMin(f) {
  const nItem = f && f.nItem != null ? String(f.nItem).trim() : '';
  const vdRaw = String(f && f.validade != null ? f.validade : '').trim();
  const vd = parseDataValidadeConferencia(vdRaw);
  const iso = vd
    ? vd.toISOString().slice(0, 10)
    : vdRaw.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
  return `${nItem}|${iso}`;
}

function extrairFalhasDeJsonArmazenado(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [raw];
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function conjuntoChavesFalhasValidadeMin(falhas) {
  const s = new Set();
  for (const f of falhas || []) {
    const k = chaveFalhaValidadeMin(f);
    if (k && k !== '|') s.add(k);
  }
  return s;
}

/**
 * Itens/validades já liberados nesta NF (mesma política de dias) não exigem nova senha.
 * No encerrar, considera liberações de CONFERENCIA e de ENCERRAR.
 */
async function falhasCobertasPorLiberacaoAnterior(tid, cdNfe, tpAcao, diasMinPolitica, falhasAtuais) {
  const atuais = conjuntoChavesFalhasValidadeMin(falhasAtuais);
  if (!atuais.size) return true;
  const tiposAcao =
    String(tpAcao || '').toUpperCase() === 'ENCERRAR'
      ? ['ENCERRAR', 'CONFERENCIA']
      : ['CONFERENCIA'];
  try {
    const r = await pool.query(
      `SELECT "FALHAS_JSON"
         FROM "WMS_RECEBIMENTO_LIBERACAO_VALIDADE"
        WHERE "TENANT_ID" = $1
          AND "CD_NFE" = $2::integer
          AND "TP_ACAO" = ANY($3::text[])
          AND "NU_DIAS_MIN_POLITICA" = $4::integer`,
      [tid, cdNfe, tiposAcao, diasMinPolitica]
    );
    const liberado = new Set();
    for (const row of r.rows) {
      for (const f of extrairFalhasDeJsonArmazenado(row.FALHAS_JSON)) {
        liberado.add(chaveFalhaValidadeMin(f));
      }
    }
    for (const k of atuais) {
      if (!liberado.has(k)) return false;
    }
    return liberado.size > 0;
  } catch (e) {
    if (schemaMissing(e)) return false;
    throw e;
  }
}

async function gravarLiberacaoValidadeRecebimento(client, params) {
  const {
    tenantId,
    cdNfe,
    cdDono,
    tpAcao,
    nuDiasMin,
    falhasMin,
    justificativa,
    sgOperador,
    autorizador,
  } = params;
  await client.query(
    `INSERT INTO "WMS_RECEBIMENTO_LIBERACAO_VALIDADE"
      ("TENANT_ID","CD_NFE","CD_DONO","TP_ACAO","NU_DIAS_MIN_POLITICA","FALHAS_JSON","JUSTIFICATIVA","SG_USER_OPERADOR","AUTORIZADO_LOGIN","AUTORIZADO_NOME")
     VALUES ($1,$2::integer,$3::integer,$4::text,$5::integer,$6::jsonb,$7::text,$8::text,$9::text,$10::text)`,
    [
      tenantId,
      cdNfe,
      cdDono,
      tpAcao,
      nuDiasMin,
      JSON.stringify(falhasMin || []),
      justificativa,
      sgOperador,
      autorizador.login,
      autorizador.nome,
    ]
  );
}

/**
 * Se há falhas de política (409), ou retorna 422 sem override, ou valida supervisor e retorna metadados para gravar log.
 */
async function executarOverridePoliticaValidadeMin(
  req,
  res,
  tid,
  cdDono,
  cdNfe,
  diasMinPolitica,
  falhasMin,
  tpAcao
) {
  if (!falhasMin.length) return { ok: true };
  const ignorar =
    toBool(req.body?.ignorarPoliticaValidadeMin) || toBool(req.body?.ignorar_politica_validade_min);
  if (!ignorar) {
    const jaCoberto = await falhasCobertasPorLiberacaoAnterior(
      tid,
      cdNfe,
      tpAcao || 'CONFERENCIA',
      diasMinPolitica,
      falhasMin
    );
    if (jaCoberto) return { ok: true };
    res.status(422).json({
      error:
        'Validade informada abaixo do mínimo configurado para o dono do estoque. Ajuste as datas ou use liberação de supervisor.',
      errorKey: 'wms.recebimento.validadeAbaixoMinimo',
      falhasValidadeMin: falhasMin,
      diasMinPolitica,
      cdDono,
    });
    return { ok: false };
  }
  const justificativa = String(
    req.body?.justificativaBloqueio ?? req.body?.justificativa_bloqueio ?? ''
  )
    .trim()
    .slice(0, 1000);
  if (!justificativa) {
    res.status(400).json({
      error: 'Para ignorar a política de validade mínima informe justificativaBloqueio.',
      errorKey: 'wms.recebimento.justificativaObrigatoria',
    });
    return { ok: false };
  }
  const autorizadoLogin = String(req.body?.autorizadoLogin ?? req.body?.autorizado_login ?? '')
    .trim()
    .slice(0, 50);
  const autorizadoSenha = String(req.body?.autorizadoSenha ?? req.body?.autorizado_senha ?? '');
  const auth = await validarAutorizadorComSenha(autorizadoLogin, autorizadoSenha, tid);
  if (!auth.ok) {
    res.status(401).json({ error: auth.error, errorKey: 'wms.recebimento.autorizadorInvalido' });
    return { ok: false };
  }
  const pode = await usuarioTemPrograma(auth.usuario.login, tid, PROGRAMA_LIBERAR_VALIDADE_MIN);
  if (!pode) {
    res.status(403).json({
      error: 'Sem permissão para liberar recebimento com validade abaixo do mínimo do dono.',
      errorKey: 'wms.recebimento.semPermissaoLiberacao',
      programaNecessario: PROGRAMA_LIBERAR_VALIDADE_MIN,
    });
    return { ok: false };
  }
  return { ok: true, justificativa, autorizador: auth.usuario, falhasMin };
}

async function inferStorageDefaults(client, tenantId, cdDono) {
  const r = await client.query(
    `SELECT "TIPO_ARMAZENAGEM", "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE"
     FROM "WMS_PRODUTO_DONO"
     WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
     ORDER BY "DH_MAINTENANCE" DESC
     LIMIT 1`,
    [tenantId, cdDono]
  );
  const row = r.rows?.[0] || {};
  return {
    tipo: normalizeStorageType(row.TIPO_ARMAZENAGEM ?? row.tipo_armazenagem) || 'SECO',
    fgDesc: yn(row.FG_DESCARTAVEL ?? row.fg_descartavel, 'N'),
    fgLote: yn(row.FG_CONTROLA_LOTE ?? row.fg_controla_lote, 'N'),
    fgVal: yn(row.FG_CONTROLA_VALIDADE ?? row.fg_controla_validade, 'N'),
  };
}

async function upsertProdutosFromNfe(client, tenantId, cdDono, linhas, sgUser) {
  const defaults = await inferStorageDefaults(client, tenantId, cdDono);
  const resumo = { total: 0, inseridos: 0, atualizados: 0, ignorados: 0 };
  const sqlUpdate = `
    UPDATE "WMS_PRODUTO_DONO"
       SET "NOME" = CASE WHEN $4::text IS NOT NULL AND $4::text <> '' THEN $4::text ELSE "NOME" END,
           "UNIDADE" = COALESCE(NULLIF($5::text, ''), "UNIDADE"),
           "CODIGO_BARRAS" = COALESCE(NULLIF($6::text, ''), "CODIGO_BARRAS"),
           "NCM" = COALESCE(NULLIF($7::text, ''), "NCM"),
           "ORIGEM_CADASTRO" = 'NF_ENTRADA_AUTO',
           "FG_FORNECEDOR_REF" = 'S',
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
    ) VALUES (
      $1, $2::integer, $3, $4, $5, $6, $7, $8, 'NF_ENTRADA_AUTO', 'S', $9, $10, $11, 'S', $12
    )
    RETURNING "CD_PRODUTO"
  `;
  for (const l of linhas || []) {
    const codigo = (l.cProd != null ? String(l.cProd).trim() : '').slice(0, 128);
    const nome = (l.xProd != null ? String(l.xProd).trim() : '').slice(0, 200);
    if (!codigo || !nome) {
      resumo.ignorados++;
      continue;
    }
    const unidade = (l.uCom != null ? String(l.uCom).trim() : '').slice(0, 10) || null;
    const ncm = digits(l.NCM).slice(0, 8) || null;
    const codBarras = (digits(l.cEAN) || digits(l.cEANTrib) || '').slice(0, 32) || null;
    const params = [tenantId, cdDono, codigo, nome, unidade, codBarras, ncm, sgUser];
    const rUp = await client.query(sqlUpdate, params);
    if (rUp.rowCount > 0) {
      resumo.atualizados++;
      continue;
    }
    try {
      await client.query(sqlInsert, [
        tenantId,
        cdDono,
        codigo,
        nome,
        unidade,
        codBarras,
        ncm,
        defaults.tipo,
        defaults.fgDesc,
        defaults.fgLote,
        defaults.fgVal,
        sgUser,
      ]);
      resumo.inseridos++;
    } catch (e) {
      if (e.code === '23505') {
        await client.query(sqlUpdate, params);
        resumo.atualizados++;
      } else {
        throw e;
      }
    }
  }
  resumo.total = resumo.inseridos + resumo.atualizados + resumo.ignorados;
  return resumo;
}

const uploadMiddleware = upload.single('arquivo');

function importarXml(req, res) {
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Falha no upload.' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'Envie o arquivo XML no campo "arquivo".' });
    }
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    let cdDono = req.body.CD_DONO ?? req.body.cd_dono;
    if (cdDono === '' || cdDono === undefined) cdDono = null;
    else cdDono = parseInt(cdDono, 10);
    if (cdDono != null && !Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'CD_DONO inválido.' });
    }
    if (cdDono != null) {
      const ok = await assertDonoTenant(tid, cdDono);
      if (!ok) return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
    }
    let xmlStr;
    try {
      xmlStr = req.file.buffer.toString('utf8');
    } catch (e) {
      return res.status(400).json({ error: 'Não foi possível ler o XML.' });
    }
    const parsed = parseNfeXml(xmlStr);
    if (parsed.err) {
      return res.status(422).json({ error: parsed.err });
    }
    const d = parsed.ok;
    let donoOrigem = 'manual';
    let donoInferido = null;
    if (cdDono == null) {
      const infer = await resolveDonoByDestinatarioCnpj(tid, d.cnpj_dest);
      if (infer.status === 'ok') {
        cdDono = infer.cdDono;
        donoOrigem = 'destinatario-cnpj';
        donoInferido = infer.dono;
      } else if (infer.status === 'ambiguo') {
        return res.status(409).json({
          error:
            'Destinatário da NF-e corresponde a mais de um dono do estoque ativo com o mesmo CNPJ. Selecione o dono manualmente na importação.',
        });
      } else {
        donoOrigem = infer.status;
      }
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(
        `INSERT INTO "WMS_NFE_ENTRADA" (
          "TENANT_ID", "CD_DONO", "CHAVE_NFE", "NUMERO_NF", "SERIE", "DH_EMISSAO",
          "CNPJ_EMITENTE", "XNOME_EMIT", "CNPJ_DEST", "XNOME_DEST", "Q_ITENS", "LINHAS_JSON", "SG_USER"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        RETURNING "CD_NFE", "CHAVE_NFE", "NUMERO_NF", "SERIE", "Q_ITENS", "DH_IMPORTACAO"`,
        [
          tid,
          cdDono,
          d.chave,
          d.numero_nf || null,
          d.serie || null,
          d.dh_emissao,
          d.cnpj_emitente || null,
          d.xnome_emit || null,
          d.cnpj_dest || null,
          d.xnome_dest || null,
          d.q_itens,
          JSON.stringify(d.linhas_json),
          sg,
        ]
      );
      let produtos = null;
      if (cdDono != null) {
        produtos = await upsertProdutosFromNfe(client, tid, cdDono, d.linhas_json, sg);
      }
      await client.query('COMMIT');
      res.status(201).json({
        ...r.rows[0],
        produtosImportados: produtos,
        donoOrigem,
        donoVinculado:
          cdDono != null
            ? {
                CD_DONO: cdDono,
                CODIGO: donoInferido ? donoInferido.CODIGO : null,
                NOME: donoInferido ? donoInferido.NOME : null,
              }
            : null,
        avisoProdutos:
          cdDono == null
            ? 'Não foi possível vincular automaticamente pelo CNPJ do destinatário; importe novamente selecionando o dono do estoque para habilitar auto-cadastro.'
            : null,
      });
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      if (schemaMissing(e)) {
        return res.status(503).json({
          error:
            'Estrutura WMS de recebimento/produto desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql e backend/scripts/wms_produtos_dono_postgres.sql.',
        });
      }
      if (e.code === '23505') {
        const existente = await buscarNfeEntradaPorChave(tid, d.chave);
        return res.status(409).json({
          error: 'Esta NF-e (chave) já foi importada para este tenant.',
          existing: existente,
          hint: existente
            ? `Registro CD_NFE ${existente.CD_NFE}. Use a chave nos filtros (deixe dono e datas em branco) ou abra pelo grid.`
            : 'A chave já existe no banco; filtre pela chave completa (44 dígitos) sem restringir o dono.',
        });
      }
      if (e.code === '23503') {
        return res.status(400).json({ error: 'Referência inválida (dono do estoque).' });
      }
      console.error('[WMS recebimento] importar:', e);
      res.status(500).json({ error: 'Erro ao gravar importação.' });
    } finally {
      client.release();
    }
  });
}

/** yyyy-mm-dd para filtro SQL; inválido retorna null. */
function parseDateFilterYmd(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Data de recebimento físico (body: dtRecebimento / dataRecebimento). */
function parseDtRecebimentoBody(body, opts) {
  const obrigatoria = !!(opts && opts.obrigatoria);
  const raw =
    body?.dtRecebimento ??
    body?.DT_RECEBIMENTO ??
    body?.dataRecebimento ??
    body?.data_recebimento;
  if (raw == null || String(raw).trim() === '') {
    if (obrigatoria) {
      return { ok: false, status: 400, error: 'Informe a data de recebimento (mercadoria na doca).' };
    }
    return { ok: true, value: null };
  }
  let iso = null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s;
  else {
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10);
      const y = parseInt(m[3], 10);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }
  if (!iso) {
    return {
      ok: false,
      status: 400,
      error: 'Data de recebimento inválida. Use o formato AAAA-MM-DD ou DD/MM/AAAA.',
    };
  }
  const hoje = new Date();
  const hojeYmd = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
  if (iso > hojeYmd) {
    return { ok: false, status: 400, error: 'Data de recebimento não pode ser futura.' };
  }
  return { ok: true, value: iso };
}

/** Monta SELECT/WHERE da listagem e exportação (mesmos filtros da tela). */
function montarSqlListarDocumentosRecebimento(query, tid, opts) {
  const limit = opts && opts.limit != null ? opts.limit : 500;
  const alias = opts && opts.joinDono ? 'e' : '';
  const col = (name) => (alias ? `${alias}."${name}"` : `"${name}"`);
  const { cdDono, chave, numero, dtRecebDe, dtRecebAte, statusFarol } = query || {};
  const chDigits = chave != null ? digits(chave) : '';
  const chaveExata = chDigits.length === 44 ? chDigits.slice(-44) : null;
  const rawFarol = statusFarol != null ? String(statusFarol).trim().toLowerCase() : '';
  const farol =
    rawFarol === '' ? '' : ['verde', 'amarelo', 'vermelho'].includes(rawFarol) ? rawFarol : null;
  if (rawFarol && farol == null) {
    return {
      ok: false,
      status: 400,
      error: 'Parâmetro statusFarol inválido. Use verde, amarelo ou vermelho (ou omita para listar todas).',
    };
  }
  const selDono = opts && opts.joinDono ? `, d."CODIGO" AS "DONO_CODIGO", d."NOME" AS "DONO_NOME"` : '';
  const selJson =
    opts && opts.includeJson
      ? `, ${col('LINHAS_JSON')}, ${col('CONFERENCIA_JSON')}`
      : '';
  const fromDono =
    opts && opts.joinDono
      ? ` FROM "WMS_NFE_ENTRADA" e
      LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = e."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"`
      : ` FROM "WMS_NFE_ENTRADA"`;
  let sql = `
      SELECT ${col('CD_NFE')}, ${col('TENANT_ID')}, ${col('CD_DONO')}, trim(${col('CHAVE_NFE')}) AS "CHAVE_NFE", ${col('NUMERO_NF')}, ${col('SERIE')}, ${col('DH_EMISSAO')},
             ${col('CNPJ_EMITENTE')}, ${col('XNOME_EMIT')}, ${col('CNPJ_DEST')}, ${col('XNOME_DEST')}, ${col('Q_ITENS')}, ${col('FG_CONFERIDO')}, ${col('DH_CONFERENCIA')},
             ${col('NM_CONFERENTE')}, ${col('DT_RECEBIMENTO')}, ${col('DH_IMPORTACAO')}, ${col('SG_USER')}, ${col('ST_RECEBIMENTO')}, ${col('DH_ENCERRAMENTO')}, ${col('DH_REABERTURA')}${selDono}${selJson}
      ${fromDono}
      WHERE ${col('TENANT_ID')} = $1`;
  const p = [tid];
  let i = 2;
  if (chaveExata) {
    sql += ` AND trim(${col('CHAVE_NFE')}) = $${i}`;
    p.push(chaveExata);
    i++;
  } else {
    if (cdDono != null && String(cdDono).trim() !== '') {
      const cdDonoNum = parseInt(cdDono, 10);
      if (Number.isFinite(cdDonoNum)) {
        sql += ` AND ${col('CD_DONO')} = $${i}::integer`;
        p.push(cdDonoNum);
        i++;
      }
    }
    if (chDigits.length > 0) {
      sql += ` AND trim(${col('CHAVE_NFE')}) LIKE $${i}`;
      p.push('%' + chDigits + '%');
      i++;
    }
    if (numero) {
      sql += ` AND ${col('NUMERO_NF')} LIKE $${i}`;
      p.push('%' + String(numero).trim() + '%');
      i++;
    }
    const dDe = parseDateFilterYmd(dtRecebDe);
    const dAte = parseDateFilterYmd(dtRecebAte);
    if (dDe && dAte && dDe > dAte) {
      return { ok: false, status: 400, error: 'Data inicial não pode ser maior que a data final.' };
    }
    if (dDe) {
      sql += ` AND (COALESCE(${col('DT_RECEBIMENTO')}, ${col('DH_CONFERENCIA')}, ${col('DH_IMPORTACAO')}))::date >= $${i}::date`;
      p.push(dDe);
      i++;
    }
    if (dAte) {
      sql += ` AND (COALESCE(${col('DT_RECEBIMENTO')}, ${col('DH_CONFERENCIA')}, ${col('DH_IMPORTACAO')}))::date <= $${i}::date`;
      p.push(dAte);
      i++;
    }
    if (farol === 'vermelho') {
      sql += ` AND UPPER(TRIM(COALESCE(${col('ST_RECEBIMENTO')}, ''))) = 'ENCERRADA'`;
    } else if (farol === 'verde') {
      sql += ` AND UPPER(TRIM(COALESCE(${col('ST_RECEBIMENTO')}, ''))) <> 'ENCERRADA'`;
      sql += ` AND UPPER(TRIM(COALESCE(${col('FG_CONFERIDO')}, 'N'))) <> 'S'`;
    } else if (farol === 'amarelo') {
      sql += ` AND UPPER(TRIM(COALESCE(${col('ST_RECEBIMENTO')}, ''))) <> 'ENCERRADA'`;
      sql += ` AND UPPER(TRIM(COALESCE(${col('FG_CONFERIDO')}, 'N'))) = 'S'`;
    }
  }
  sql += ` ORDER BY ${col('DH_IMPORTACAO')} DESC LIMIT ${Math.max(1, Math.min(parseInt(limit, 10) || 500, 10000))}`;
  return { ok: true, sql, params: p };
}

function csvCellReceb(v) {
  const s = v == null ? '' : String(v);
  if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatDataBrFromIsoYmd(v) {
  const s = v == null ? '' : String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatDhBrReceb(iso) {
  if (iso == null || String(iso).trim() === '') return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    pad(d.getDate()) +
    '/' +
    pad(d.getMonth() + 1) +
    '/' +
    d.getFullYear() +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds())
  );
}

function farolLabelExportReceb(row) {
  if (String(row.ST_RECEBIMENTO || '').toUpperCase().trim() === 'ENCERRADA') {
    return 'Vermelho — recebimento encerrado';
  }
  if (String(row.FG_CONFERIDO || 'N').toUpperCase().trim() === 'S') {
    return 'Amarelo — conferência gravada, aberta';
  }
  return 'Verde — só importada';
}

async function listarDocumentos(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const built = montarSqlListarDocumentosRecebimento(req.query, tid, { limit: 500 });
    if (!built.ok) return res.status(built.status).json({ error: built.error });
    const r = await pool.query(built.sql, built.params);
    res.json(r.rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] listar:', e);
    res.status(500).json({ error: 'Erro ao listar documentos.' });
  }
}

async function exportarDocumentosRecebimento(req, res) {
  try {
    const formato = String(req.query.formato || 'csv').trim().toLowerCase();
    const formatoItens = formato === 'csv-itens' || formato === 'itens' || formato === 'csv_itens';
    if (formato !== 'csv' && !formatoItens) {
      return res.status(400).json({
        error: 'Formato não suportado. Use formato=csv (cabeçalho NF) ou formato=csv-itens (uma linha por item).',
      });
    }
    const tid = tenantIdForRequest(req);
    const built = montarSqlListarDocumentosRecebimento(req.query, tid, {
      limit: 10000,
      joinDono: true,
      includeJson: formatoItens,
    });
    if (!built.ok) return res.status(built.status).json({ error: built.error });
    const r = await pool.query(built.sql, built.params);
    const rows = r.rows || [];
    if (formatoItens) {
      const linhasItens = await montarLinhasExportItensRecebimento(rows, tid);
      const agora = formatDhBrReceb(new Date().toISOString());
      const meta = [
        `Gerado em;${csvCellItens(agora)}`,
        `Total NF-e;${rows.length}`,
        `Total linhas (itens);${linhasItens.length}`,
        'Separador colunas; ponto-e-vírgula (;)',
        'Separador decimal quantidades; vírgula (,)',
        '',
      ].join('\n');
      const { hdr, body } = linhasItensParaCsvBody(linhasItens);
      const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="wms-recebimento-entrada-itens-${ymd}.csv"`
      );
      return res.send(`\uFEFF${meta}\n${hdr}\n${body}`);
    }
    const hdr =
      'ID;Chave NF-e;Número NF;Série;CD Dono;Dono código;Dono nome;Emitente;CNPJ emitente;Destinatário;CNPJ destinatário;Qtd itens;Situação farol;Conferência gravada;Conferente;Status recebimento;Data recebimento;Data importação;Data conferência;Data encerramento;Usuário importação';
    const linhas = rows.map((row) => {
      const conf =
        String(row.FG_CONFERIDO || 'N').toUpperCase().trim() === 'S' ? 'Sim' : 'Não';
      return [
        row.CD_NFE,
        row.CHAVE_NFE,
        row.NUMERO_NF,
        row.SERIE,
        row.CD_DONO,
        row.DONO_CODIGO,
        row.DONO_NOME,
        row.XNOME_EMIT,
        row.CNPJ_EMITENTE,
        row.XNOME_DEST,
        row.CNPJ_DEST,
        row.Q_ITENS,
        farolLabelExportReceb(row),
        conf,
        row.NM_CONFERENTE,
        row.ST_RECEBIMENTO,
        row.DT_RECEBIMENTO ? formatDataBrFromIsoYmd(row.DT_RECEBIMENTO) : '',
        formatDhBrReceb(row.DH_IMPORTACAO),
        formatDhBrReceb(row.DH_CONFERENCIA),
        formatDhBrReceb(row.DH_ENCERRAMENTO),
        row.SG_USER,
      ]
        .map(csvCellReceb)
        .join(';');
    });
    const agora = formatDhBrReceb(new Date().toISOString());
    const meta = `Gerado em;${csvCellReceb(agora)}\nTotal registros;${rows.length}\n\n`;
    const csvBody = meta + hdr + '\n' + linhas.join('\n');
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wms-recebimento-nf-${ymd}.csv"`);
    return res.send(`\uFEFF${csvBody}`);
  } catch (e) {
    if (schemaMissing(e)) {
      const hint =
        e && String(e.message || '').includes('WMS_PRODUTO_DONO')
          ? ' Execute backend/scripts/wms_produtos_dono_postgres.sql e wms_depara_produto_postgres.sql.'
          : e && String(e.message || '').includes('WMS_DEPARA')
            ? ' Execute backend/scripts/wms_depara_produto_postgres.sql.'
            : '';
      console.error('[WMS recebimento] exportar schema:', e.message || e);
      return res.status(503).json({
        error:
          'Estrutura WMS incompleta para exportação.' +
          hint +
          ' Se a tabela WMS_NFE_ENTRADA já existe, execute wms_nfe_entrada_postgres.sql apenas se faltar coluna de conferência.',
      });
    }
    console.error('[WMS recebimento] exportar:', e);
    res.status(500).json({ error: 'Erro ao exportar lista de NF-e.' });
  }
}

async function buscarDocumentoPorChave(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const ch44 = chaveNfe44(req.params.chave || req.query.chave);
    if (!ch44) {
      return res.status(400).json({ error: 'Informe a chave da NF-e com 44 dígitos.' });
    }
    const row = await buscarNfeEntradaPorChave(tid, ch44);
    if (!row) {
      return res.status(404).json({
        error: 'NF-e não encontrada neste tenant. Confira a chave ou importe o XML.',
        chave: ch44,
      });
    }
    res.json(row);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] buscarDocumentoPorChave:', e);
    res.status(500).json({ error: 'Erro ao buscar NF-e pela chave.' });
  }
}

async function buscarDocumento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await pool.query(
      `SELECT e.*,
              d."NU_DIAS_MIN_VALID_RECEB" AS "NU_DIAS_MIN_VALID_RECEB_DONO",
              d."NU_DIAS_REL_VENCIMENTO" AS "NU_DIAS_REL_VENCIMENTO_DONO",
              d."MASCARA_CODIGO_PRODUTO" AS "MASCARA_CODIGO_PRODUTO_DONO"
         FROM "WMS_NFE_ENTRADA" e
         LEFT JOIN "WMS_DONO_ESTOQUE" d
           ON d."TENANT_ID" = e."TENANT_ID" AND d."CD_DONO" = e."CD_DONO"
        WHERE e."CD_NFE" = $1::integer AND e."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    const row = r.rows[0];
    let permissaoLiberarValidadeMinReceb = false;
    const sgDoc = getSgUser(req);
    if (sgDoc) {
      try {
        permissaoLiberarValidadeMinReceb = await usuarioTemPrograma(
          sgDoc,
          tid,
          PROGRAMA_LIBERAR_VALIDADE_MIN
        );
      } catch (_) {
        permissaoLiberarValidadeMinReceb = false;
      }
    }
    row.permissaoLiberarValidadeMinReceb = permissaoLiberarValidadeMinReceb;
    row.liberacoesValidadeMin = [];
    try {
      const rLib = await pool.query(
        `SELECT "CD_LIBERACAO","DH_LIBERACAO","TP_ACAO","NU_DIAS_MIN_POLITICA","FALHAS_JSON",
                "JUSTIFICATIVA","SG_USER_OPERADOR","AUTORIZADO_LOGIN","AUTORIZADO_NOME"
           FROM "WMS_RECEBIMENTO_LIBERACAO_VALIDADE"
          WHERE "TENANT_ID" = $1 AND "CD_NFE" = $2::integer
          ORDER BY "DH_LIBERACAO" DESC, "CD_LIBERACAO" DESC`,
        [tid, cd]
      );
      row.liberacoesValidadeMin = rLib.rows;
    } catch (libE) {
      if (!schemaMissing(libE)) throw libE;
    }
    res.json(row);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    res.status(500).json({ error: 'Erro ao buscar documento.' });
  }
}

async function listarRelatorioVencimentoRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = req.query.cdDono != null && String(req.query.cdDono).trim() !== '' ? req.query.cdDono : null;
    const formato = String(req.query.formato || '').trim().toLowerCase();
    const { rows, avisos } = await listarRelatorioVencimentoPorRecebimentoEncerrado(tid, cdDono);
    if (formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="wms-relatorio-vencimento-recebimento.csv"'
      );
      return res.send(`\uFEFF${linhasParaCsv(rows)}`);
    }
    return res.json({
      linhas: rows,
      avisos,
      total: rows.length,
      geradoEm: new Date().toISOString(),
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') {
      return res.status(503).json({ error: e.message });
    }
    console.error('[WMS recebimento] listarRelatorioVencimentoRecebimento:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de vencimento.' });
  }
}

async function listarRelatorioPosicaoEstoqueRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = req.query.cdDono != null && String(req.query.cdDono).trim() !== '' ? req.query.cdDono : null;
    const formato = String(req.query.formato || '').trim().toLowerCase();
    const { linhas, avisos } = await listarPosicaoEstoque(tid, cdDono);
    const filtroDonoLabel = montarRotuloFiltroDono(cdDono, linhas);
    const geradoEm = new Date().toISOString();
    if (formato === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="wms-posicao-estoque.csv"'
      );
      return res.send(`\uFEFF${linhasPosicaoParaCsv(linhas)}`);
    }
    if (formato === 'html') {
      const html = buildPosicaoEstoqueHtml({
        linhas,
        avisos,
        geradoEm,
        filtroDonoLabel,
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    return res.json({
      linhas,
      avisos,
      total: linhas.length,
      geradoEm,
      filtroDono: cdDono,
      filtroDonoLabel,
    });
  } catch (e) {
    if (e && e.code === 'SCHEMA') {
      return res.status(503).json({ error: e.message });
    }
    console.error('[WMS recebimento] listarRelatorioPosicaoEstoqueRecebimento:', e);
    return res.status(500).json({ error: 'Erro ao gerar relatório de posição de estoque.' });
  }
}

async function listarHistoricoRelatorioVencimentoEnvios(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    let lim = parseInt(req.query.limit, 10);
    if (!Number.isFinite(lim) || lim < 1) lim = 50;
    if (lim > 200) lim = 200;
    const out = await listarHistoricoEnvioRelatorioVencimento(pool, tid, lim);
    return res.json({ envios: out.rows, aviso: out.aviso || null });
  } catch (e) {
    console.error('[WMS recebimento] listarHistoricoRelatorioVencimentoEnvios:', e);
    return res.status(500).json({ error: 'Erro ao listar histórico de envios.' });
  }
}

async function excluirDocumento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const rSt = await pool.query(
      `SELECT "ST_RECEBIMENTO" FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!rSt.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    const stRec = String(rSt.rows[0].ST_RECEBIMENTO || rSt.rows[0].st_recebimento || '')
      .trim()
      .toUpperCase();
    if (stRec === 'ENCERRADA') {
      return res.status(409).json({
        error:
          'Não é possível excluir: o recebimento desta NF-e está encerrado (controle de estoque / auditoria). Reabra o recebimento informando o motivo se for indispensável remover o registro.',
      });
    }
    const rDel = await pool.query(
      `DELETE FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2 RETURNING "CD_NFE"`,
      [cd, tid]
    );
    if (!rDel.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    return res.json({ ok: true, cdNfe: rDel.rows[0].CD_NFE });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    if (e && e.code === '23503') {
      return res.status(409).json({ error: 'Não foi possível excluir: documento referenciado em outro registro.' });
    }
    console.error('[WMS recebimento] excluirDocumento:', e);
    return res.status(500).json({ error: 'Erro ao excluir documento.' });
  }
}

/** Monta payload de conferência a partir dos itens enviados pelo cliente (salvar / encerrar). */
async function montarPayloadConferenciaItens(tid, cdDono, linhas, itens, sg) {
  const linhasArr = Array.isArray(linhas) ? linhas : [];
  const itensArr = Array.isArray(itens) ? itens : [];
  const itensPorN = new Map(linhasArr.map((l) => [String(l.nItem || ''), l]));
  const externosLowerKeys = Array.from(
    new Set(linhasArr.flatMap((l) => deparaLookupKeysFromCProd(l?.cProd)))
  );
  let byExterno = new Map();
  if (externosLowerKeys.length) {
    const rDep = await pool.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
      [tid, cdDono, externosLowerKeys]
    );
    byExterno = buildDeparaHitMap(rDep.rows || []);
  }
  const payload = [];
  const deparaUpsertReq = [];
  let conferidos = 0;
  for (const it of itensArr) {
    const nItem = String(it?.nItem ?? '').trim();
    if (!nItem || !itensPorN.has(nItem)) continue;
    const linha = itensPorN.get(nItem) || {};
    const codigoExterno = normCodigoExterno(linha.cProd);
    const hitDepara = codigoExterno ? hitDeparaFromMap(byExterno, linha.cProd) : null;
    let codigoProduto = String(it?.codigoProduto ?? '').trim();
    if (!codigoProduto && hitDepara?.CODIGO_INTERNO) codigoProduto = String(hitDepara.CODIGO_INTERNO).trim();
    const cdProduto =
      it?.cdProduto != null && String(it.cdProduto).trim() !== '' ? parseInt(it.cdProduto, 10) : null;
    const lote = String(it?.lote ?? '').trim().slice(0, 60);
    const validadeRaw = String(it?.validade ?? '').trim();
    const qtdRaw = String(it?.qtdRecebida ?? '').trim().replace(',', '.');
    const qtd = qtdRaw !== '' ? Number(qtdRaw) : null;
    const fator = normFator(it?.fatorConversao) ?? normFator(hitDepara?.FATOR_CONVERSAO) ?? 0;
    const fatorMult = fator === 0 ? 1 : fator;
    const qtdConvertida =
      qtd != null && !Number.isNaN(qtd) ? Number((qtd * fatorMult).toFixed(6)) : null;
    const salvarDepara = toBool(it?.salvarDepara);
    const obs = String(it?.observacao ?? '').trim().slice(0, 255);
    if (!codigoProduto && !cdProduto && !lote && !validadeRaw && (qtd == null || Number.isNaN(qtd)) && !obs) {
      continue;
    }
    if (!codigoProduto && !cdProduto) {
      return { ok: false, status: 400, error: `Item ${nItem}: informe produto do dono.` };
    }
    if (qtd != null && (Number.isNaN(qtd) || qtd < 0)) {
      return { ok: false, status: 400, error: `Item ${nItem}: quantidade inválida.` };
    }
    if (!Number.isFinite(fator) || fator < 0) {
      return { ok: false, status: 400, error: `Item ${nItem}: fator de conversão inválido.` };
    }
    const validade = validadeRaw || null;
    payload.push({
      nItem,
      cdProduto: Number.isFinite(cdProduto) ? cdProduto : null,
      codigoExterno: codigoExterno || null,
      codigoProduto: codigoProduto || null,
      fatorConversao: fator,
      qtdConvertida,
      lote: lote || null,
      validade,
      qtdRecebida: qtd,
      observacao: obs || null,
    });
    if (salvarDepara && codigoExterno && codigoProduto && fator > 0) {
      deparaUpsertReq.push({ codigoExterno, codigoProduto, fator });
    }
    conferidos++;
  }
  return { ok: true, payload, conferidos, deparaUpsertReq };
}

async function salvarConferencia(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const itens = Array.isArray(req.body?.itens) ? req.body.itens : null;
    if (!itens) return res.status(400).json({ error: 'Payload inválido. Envie itens.' });

    const rDoc = await pool.query(
      `SELECT "CD_DONO", "LINHAS_JSON", "ST_RECEBIMENTO" FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!rDoc.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    const doc = rDoc.rows[0];
    const stRecebimento = String(doc.ST_RECEBIMENTO || '').toUpperCase();
    if (stRecebimento === 'ENCERRADA') {
      return res.status(409).json({ error: 'NF-e encerrada. Reabra para permitir alterações.' });
    }
    const cdDono = doc.CD_DONO ?? doc.cd_dono;
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Documento sem dono do estoque. Reimporte com dono selecionado.' });
    }
    const linhas = Array.isArray(doc.LINHAS_JSON) ? doc.LINHAS_JSON : [];
    const montado = await montarPayloadConferenciaItens(tid, cdDono, linhas, itens, sg);
    if (!montado.ok) return res.status(montado.status || 400).json({ error: montado.error });
    const { payload, conferidos, deparaUpsertReq } = montado;
    let liberacaoOverride = null;

    if (payload.length) {
      const vrCad = await validarItensConferenciaComCadastro(tid, cdDono, payload);
      if (!vrCad.ok) {
        return res.status(vrCad.status || 400).json({ error: vrCad.error });
      }
      const maps = vrCad.maps;
      if (maps) {
        for (const p of payload) {
          if (!itemTemDadosConferencia(p)) continue;
          const cfg = await resolverCfgProdutoItemCompleto(pool, tid, cdDono, p, maps);
          if (!cfg) {
            if (p.codigoProduto) {
              return res.status(400).json({
                error: `Produto não encontrado para o dono: ${p.codigoProduto} (informe CDPRODESTO / estoque ou cadastre vínculo operacional na planilha OL).`,
              });
            }
            continue;
          }
          p.cdProduto = parseInt(cfg.CD_PRODUTO, 10);
          p.codigoProduto = String(cfg.CODIGO || p.codigoProduto || '').trim() || p.codigoProduto;
          if (
            (p.fatorConversao == null || Number(p.fatorConversao) === 0) &&
            cfg.FATOR_CONVERSAO != null &&
            Number(cfg.FATOR_CONVERSAO) > 0
          ) {
            p.fatorConversao = Number(cfg.FATOR_CONVERSAO);
            const qtd = p.qtdRecebida != null ? Number(p.qtdRecebida) : null;
            if (qtd != null && !Number.isNaN(qtd)) {
              p.qtdConvertida = Number((qtd * p.fatorConversao).toFixed(6));
            }
          }
        }
      }
      let diasMinDono = DEFAULT_MIN_DIAS_VALID_RECEB;
      try {
        diasMinDono = await obterDiasMinValidadeRecebimentoDono(tid, cdDono);
      } catch (e) {
        if (schemaMissing(e)) {
          return res.status(503).json({
            error:
              'Cadastro de dono desatualizado. Execute backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
          });
        }
        throw e;
      }
      const falhasMin = [];
      for (const p of payload) {
        const vr = validarValidadeMinimaDonoItem({
          nItem: p.nItem,
          validadeRaw: p.validade,
          diasMinDono,
        });
        if (!vr.ok && vr.status === 400) return res.status(400).json({ error: vr.error });
        if (!vr.ok && vr.status === 409) {
          falhasMin.push({
            nItem: p.nItem,
            validade: p.validade,
            mensagem: vr.error,
          });
        }
      }
      if (falhasMin.length) {
        const ov = await executarOverridePoliticaValidadeMin(
          req,
          res,
          tid,
          cdDono,
          cd,
          diasMinDono,
          falhasMin,
          'CONFERENCIA'
        );
        if (!ov.ok) return;
        if (ov.autorizador) {
          liberacaoOverride = {
            falhasMin,
            justificativa: ov.justificativa,
            autorizador: ov.autorizador,
            nuDiasMin: diasMinDono,
          };
        }
      }
    }

    const fgConferido = conferidos > 0 ? 'S' : 'N';
    const rawNm = req.body?.nmConferente ?? req.body?.NM_CONFERENTE;
    const nmConf =
      rawNm != null && String(rawNm).trim() !== '' ? String(rawNm).trim().slice(0, 120) : null;
    const dtRec = parseDtRecebimentoBody(req.body, { obrigatoria: false });
    if (!dtRec.ok) return res.status(dtRec.status || 400).json({ error: dtRec.error });
    let deparaResumo = { inseridos: 0, atualizados: 0 };
    if (deparaUpsertReq.length) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const uniq = new Map();
        deparaUpsertReq.forEach((d) => {
          uniq.set(d.codigoExterno, d);
        });
        for (const d of uniq.values()) {
          const hitDep = await resolverProdutoEstoque(client, tid, cdDono, d.codigoProduto, {
            codigoExterno: d.codigoExterno,
          });
          if (hitDep) d.codigoProduto = hitDep.codigoEstoque;
          const rUp = await client.query(
            `UPDATE "WMS_DEPARA_PRODUTO"
                SET "CODIGO_INTERNO" = $4::text,
                    "FATOR_CONVERSAO" = $5::numeric,
                    "FGACTIVE" = 'S',
                    "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                    "SG_USER" = $6::text
              WHERE "TENANT_ID" = $1
                AND "CD_DONO" = $2::integer
                AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))`,
            [tid, cdDono, d.codigoExterno, d.codigoProduto, d.fator, sg]
          );
          if (rUp.rowCount > 0) {
            deparaResumo.atualizados++;
            continue;
          }
          await client.query(
            `INSERT INTO "WMS_DEPARA_PRODUTO"
              ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE", "SG_USER")
             VALUES ($1, $2::integer, $3::text, $4::text, $5::numeric, 'S', $6::text)`,
            [tid, cdDono, d.codigoExterno, d.codigoProduto, d.fator, sg]
          );
          deparaResumo.inseridos++;
        }
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        throw e;
      } finally {
        client.release();
      }
    }
    const clientConf = await pool.connect();
    try {
      await clientConf.query('BEGIN');
      const rUp = await clientConf.query(
        `UPDATE "WMS_NFE_ENTRADA"
         SET "CONFERENCIA_JSON" = $3::jsonb,
             "FG_CONFERIDO" = $4::char(1),
             "DH_CONFERENCIA" = CASE WHEN $4::char(1) = 'S'::char(1) THEN CURRENT_TIMESTAMP ELSE NULL END,
             "SG_USER_CONFERENCIA" = $5::text,
             "NM_CONFERENTE" = $6::text,
             "DT_RECEBIMENTO" = COALESCE($7::date, "DT_RECEBIMENTO")
       WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2
       RETURNING "CD_NFE", "FG_CONFERIDO", "DH_CONFERENCIA", "NM_CONFERENTE", "DT_RECEBIMENTO"`,
        [cd, tid, JSON.stringify(payload), fgConferido, sg, nmConf, dtRec.value]
      );
      if (liberacaoOverride && liberacaoOverride.autorizador) {
        try {
          await gravarLiberacaoValidadeRecebimento(clientConf, {
            tenantId: tid,
            cdNfe: cd,
            cdDono,
            tpAcao: 'CONFERENCIA',
            nuDiasMin: liberacaoOverride.nuDiasMin,
            falhasMin: liberacaoOverride.falhasMin,
            justificativa: liberacaoOverride.justificativa,
            sgOperador: sg,
            autorizador: liberacaoOverride.autorizador,
          });
        } catch (insE) {
          if (!schemaMissing(insE)) throw insE;
        }
      }
      await clientConf.query('COMMIT');
      res.json({
        ok: true,
        conferencia: rUp.rows?.[0] || null,
        itensConferidos: payload.length,
        depara: deparaResumo,
      });
    } catch (eUp) {
      try {
        await clientConf.query('ROLLBACK');
      } catch (_) {}
      throw eUp;
    } finally {
      clientConf.release();
    }
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura WMS desatualizada para conferência. Execute backend/scripts/wms_nfe_entrada_postgres.sql, backend/scripts/wms_produtos_dono_postgres.sql, backend/scripts/wms_depara_produto_postgres.sql e, se faltar política no dono, backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] salvarConferencia:', e);
    res.status(500).json({ error: 'Erro ao salvar conferência.' });
  }
}

async function encerrarRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });

    const rawNmEnc = req.body?.nmConferente ?? req.body?.NM_CONFERENTE;
    const nmConfEnc =
      rawNmEnc != null && String(rawNmEnc).trim() !== '' ? String(rawNmEnc).trim().slice(0, 120) : null;
    if (!nmConfEnc) {
      return res.status(400).json({
        error: 'Informe o nome do conferente antes de encerrar a NF-e.',
      });
    }
    const dtRecEnc = parseDtRecebimentoBody(req.body, { obrigatoria: true });
    if (!dtRecEnc.ok) return res.status(dtRecEnc.status || 400).json({ error: dtRecEnc.error });

    const rPre = await pool.query(
      `SELECT "CD_DONO", "LINHAS_JSON", "CONFERENCIA_JSON",
              COALESCE(NULLIF(TRIM("ST_RECEBIMENTO"), ''), 'ABERTA') AS "ST_RECEBIMENTO"
         FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!rPre.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
    const docPre = rPre.rows[0];
    const stPre = String(docPre.ST_RECEBIMENTO || docPre.st_recebimento || '').toUpperCase();
    if (stPre === 'ENCERRADA') {
      return res.status(409).json({ error: 'NF-e já está encerrada.' });
    }
    const cdDonoRaw = docPre.CD_DONO ?? docPre.cd_dono;
    const cdDonoEnc = typeof cdDonoRaw === 'number' ? cdDonoRaw : parseInt(cdDonoRaw, 10);
    if (!Number.isFinite(cdDonoEnc)) {
      return res.status(400).json({ error: 'Documento sem dono do estoque. Não é possível encerrar.' });
    }

    const linhasEnc = Array.isArray(docPre.LINHAS_JSON) ? docPre.LINHAS_JSON : [];
    const itensBody = Array.isArray(req.body?.itens) ? req.body.itens : null;
    let payloadEnc = [];
    let deparaUpsertEnc = [];
    if (itensBody) {
      const montadoEnc = await montarPayloadConferenciaItens(tid, cdDonoEnc, linhasEnc, itensBody, sg);
      if (!montadoEnc.ok) return res.status(montadoEnc.status || 400).json({ error: montadoEnc.error });
      payloadEnc = montadoEnc.payload;
      deparaUpsertEnc = montadoEnc.deparaUpsertReq || [];
    } else {
      payloadEnc = parseConferenciaJsonArmazenada(
        docPre.CONFERENCIA_JSON ?? docPre.conferencia_json
      ).filter(itemTemDadosConferencia);
    }
    if (!payloadEnc.length) {
      return res.status(400).json({
        error:
          'Nenhum item conferido. Preencha produto, quantidade e validade (quando exigida) na tela antes de encerrar.',
      });
    }

    /** Trava anti-"NF encerrada em branco" (caso PIPOCA DOCE): se o operador
     *  associou produto mas esqueceu a Qtd recebida, o ENCERRAR é barrado.
     *  Aceita 0 explícito (operador confirma "não recebi este item"). */
    const semQtd = identificarItensSemQtdRecebida(payloadEnc);
    if (semQtd.length) {
      const amostra = semQtd
        .slice(0, 5)
        .map((p) => 'item ' + p.nItem + ' (' + p.codigoProduto + ')')
        .join(', ');
      const sufixo = semQtd.length > 5 ? ' e mais ' + (semQtd.length - 5) : '';
      return res.status(400).json({
        error:
          'Não é possível encerrar a NF-e: ' +
          semQtd.length +
          ' item(ns) sem "Qtd recebida" preenchida — ' +
          amostra +
          sufixo +
          '. Digite a quantidade conferida (use 0 para confirmar que NÃO recebeu o item). Salvar conferência em branco ainda é permitido; o bloqueio é só no encerramento.',
        itensSemQtdRecebida: semQtd,
      });
    }

    const vrCadEnc = await validarItensConferenciaComCadastro(tid, cdDonoEnc, payloadEnc);
    if (!vrCadEnc.ok) {
      return res.status(vrCadEnc.status || 400).json({ error: vrCadEnc.error });
    }
    const mapsEnc = vrCadEnc.maps;
    if (mapsEnc) {
      for (const p of payloadEnc) {
        if (!itemTemDadosConferencia(p)) continue;
        const cfg = await resolverCfgProdutoItemCompleto(pool, tid, cdDonoEnc, p, mapsEnc);
        if (!cfg) {
          if (p.codigoProduto) {
            return res.status(400).json({
              error: `Produto não encontrado para o dono: ${p.codigoProduto} (informe CDPRODESTO / estoque ou cadastre vínculo operacional na planilha OL).`,
            });
          }
          continue;
        }
        p.cdProduto = parseInt(cfg.CD_PRODUTO, 10);
        p.codigoProduto = String(cfg.CODIGO || p.codigoProduto || '').trim() || p.codigoProduto;
        if (
          (p.fatorConversao == null || Number(p.fatorConversao) === 0) &&
          cfg.FATOR_CONVERSAO != null &&
          Number(cfg.FATOR_CONVERSAO) > 0
        ) {
          p.fatorConversao = Number(cfg.FATOR_CONVERSAO);
          const qtd = p.qtdRecebida != null ? Number(p.qtdRecebida) : null;
          if (qtd != null && !Number.isNaN(qtd)) {
            p.qtdConvertida = Number((qtd * p.fatorConversao).toFixed(6));
          }
        }
      }
    }

    let diasMinDonoEnc = DEFAULT_MIN_DIAS_VALID_RECEB;
    try {
      diasMinDonoEnc = await obterDiasMinValidadeRecebimentoDono(tid, cdDonoEnc);
    } catch (e) {
      if (schemaMissing(e)) {
        return res.status(503).json({
          error:
            'Cadastro de dono desatualizado. Execute backend/scripts/adicionar_wms_dono_politica_validade_postgres.sql.',
        });
      }
      throw e;
    }
    const falhasMinEnc = [];
    for (const item of payloadEnc) {
      const nItem = item?.nItem != null ? String(item.nItem) : '?';
      const vr = validarValidadeMinimaDonoItem({
        nItem,
        validadeRaw: item?.validade,
        diasMinDono: diasMinDonoEnc,
      });
      if (!vr.ok && vr.status === 400) return res.status(400).json({ error: vr.error });
      if (!vr.ok && vr.status === 409) {
        falhasMinEnc.push({
          nItem,
          validade: item?.validade,
          mensagem: vr.error,
        });
      }
    }
    let liberacaoEnc = null;
    if (falhasMinEnc.length) {
      const ov = await executarOverridePoliticaValidadeMin(
        req,
        res,
        tid,
        cdDonoEnc,
        cd,
        diasMinDonoEnc,
        falhasMinEnc,
        'ENCERRAR'
      );
      if (!ov.ok) return;
      if (ov.autorizador) {
        liberacaoEnc = {
          falhasMin: falhasMinEnc,
          justificativa: ov.justificativa,
          autorizador: ov.autorizador,
          nuDiasMin: diasMinDonoEnc,
        };
      }
    }

    const fgConferidoEnc = payloadEnc.length > 0 ? 'S' : 'N';
    const clientEnc = await pool.connect();
    try {
      await clientEnc.query('BEGIN');
      if (deparaUpsertEnc.length) {
        const uniqDep = new Map();
        deparaUpsertEnc.forEach((d) => {
          uniqDep.set(d.codigoExterno, d);
        });
        for (const d of uniqDep.values()) {
          const hitDepEnc = await resolverProdutoEstoque(clientEnc, tid, cdDonoEnc, d.codigoProduto, {
            codigoExterno: d.codigoExterno,
          });
          if (hitDepEnc) d.codigoProduto = hitDepEnc.codigoEstoque;
          const rUpDep = await clientEnc.query(
            `UPDATE "WMS_DEPARA_PRODUTO"
                SET "CODIGO_INTERNO" = $4::text,
                    "FATOR_CONVERSAO" = $5::numeric,
                    "FGACTIVE" = 'S',
                    "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                    "SG_USER" = $6::text
              WHERE "TENANT_ID" = $1
                AND "CD_DONO" = $2::integer
                AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))`,
            [tid, cdDonoEnc, d.codigoExterno, d.codigoProduto, d.fator, sg]
          );
          if (rUpDep.rowCount > 0) continue;
          await clientEnc.query(
            `INSERT INTO "WMS_DEPARA_PRODUTO"
              ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE", "SG_USER")
             VALUES ($1, $2::integer, $3::text, $4::text, $5::numeric, 'S', $6::text)`,
            [tid, cdDonoEnc, d.codigoExterno, d.codigoProduto, d.fator, sg]
          );
        }
      }
      await clientEnc.query(
        `UPDATE "WMS_NFE_ENTRADA"
         SET "CONFERENCIA_JSON" = $3::jsonb,
             "FG_CONFERIDO" = $4::char(1),
             "DH_CONFERENCIA" = CASE WHEN $4::char(1) = 'S'::char(1) THEN CURRENT_TIMESTAMP ELSE NULL END,
             "SG_USER_CONFERENCIA" = $5::text,
             "NM_CONFERENTE" = $6::text,
             "DT_RECEBIMENTO" = $7::date
       WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
        [cd, tid, JSON.stringify(payloadEnc), fgConferidoEnc, sg, nmConfEnc, dtRecEnc.value]
      );
      /** Preserva a data do PRIMEIRO encerramento (DH_PRIMEIRO_ENCERRAMENTO).
       *  Sem isso, cada reabertura + reencerramento sobrescreve a data e o
       *  relatório de Movimentação "anda no tempo". O COALESCE garante:
       *    - 1ª vez: copia o CURRENT_TIMESTAMP.
       *    - Reaberturas seguintes: mantém o valor original.
       *  Se a coluna não existir (schema antigo), o try/catch abaixo
       *  cai num fallback sem ela. */
      let r;
      try {
        r = await clientEnc.query(
          `UPDATE "WMS_NFE_ENTRADA"
            SET "ST_RECEBIMENTO" = 'ENCERRADA',
                "DH_ENCERRAMENTO" = CURRENT_TIMESTAMP,
                "DH_PRIMEIRO_ENCERRAMENTO" = COALESCE("DH_PRIMEIRO_ENCERRAMENTO", CURRENT_TIMESTAMP),
                "SG_USER_ENCERRAMENTO" = $3::text
          WHERE "CD_NFE" = $1::integer
            AND "TENANT_ID" = $2
            AND COALESCE("ST_RECEBIMENTO", 'ABERTA') <> 'ENCERRADA'
        RETURNING "CD_NFE", "ST_RECEBIMENTO", "DH_ENCERRAMENTO", "DH_PRIMEIRO_ENCERRAMENTO", "DT_RECEBIMENTO"`,
          [cd, tid, sg]
        );
      } catch (errCol) {
        if (errCol && errCol.code === '42703') {
          /** Schema antigo sem DH_PRIMEIRO_ENCERRAMENTO — funciona com o
           *  comportamento antigo. Operador deve rodar
           *  `adicionar_dh_primeiro_encerramento_nfe_postgres.sql`. */
          r = await clientEnc.query(
            `UPDATE "WMS_NFE_ENTRADA"
              SET "ST_RECEBIMENTO" = 'ENCERRADA',
                  "DH_ENCERRAMENTO" = CURRENT_TIMESTAMP,
                  "SG_USER_ENCERRAMENTO" = $3::text
            WHERE "CD_NFE" = $1::integer
              AND "TENANT_ID" = $2
              AND COALESCE("ST_RECEBIMENTO", 'ABERTA') <> 'ENCERRADA'
          RETURNING "CD_NFE", "ST_RECEBIMENTO", "DH_ENCERRAMENTO", "DT_RECEBIMENTO"`,
            [cd, tid, sg]
          );
        } else {
          throw errCol;
        }
      }
      if (!r.rows.length) {
        await clientEnc.query('ROLLBACK');
        const chk = await pool.query(
          `SELECT "CD_NFE", "ST_RECEBIMENTO" FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
          [cd, tid]
        );
        if (!chk.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
        return res.status(409).json({ error: 'NF-e já está encerrada.' });
      }
      if (liberacaoEnc && liberacaoEnc.autorizador) {
        try {
          await gravarLiberacaoValidadeRecebimento(clientEnc, {
            tenantId: tid,
            cdNfe: cd,
            cdDono: cdDonoEnc,
            tpAcao: 'ENCERRAR',
            nuDiasMin: liberacaoEnc.nuDiasMin,
            falhasMin: liberacaoEnc.falhasMin,
            justificativa: liberacaoEnc.justificativa,
            sgOperador: sg,
            autorizador: liberacaoEnc.autorizador,
          });
        } catch (insE) {
          if (!schemaMissing(insE)) throw insE;
        }
      }
      await clientEnc.query('COMMIT');
      return res.json({ ok: true, documento: r.rows[0] });
    } catch (eEnc) {
      try {
        await clientEnc.query('ROLLBACK');
      } catch (_) {}
      throw eEnc;
    } finally {
      clientEnc.release();
    }
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] encerrarRecebimento:', e);
    return res.status(500).json({ error: 'Erro ao encerrar recebimento.' });
  }
}

async function reabrirRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdNfe, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const motivo = String(req.body?.motivo || '').trim().slice(0, 255);
    if (!motivo) return res.status(400).json({ error: 'Informe o motivo da reabertura.' });

    const r = await pool.query(
      `UPDATE "WMS_NFE_ENTRADA"
          SET "ST_RECEBIMENTO" = 'REABERTA',
              "DH_REABERTURA" = CURRENT_TIMESTAMP,
              "SG_USER_REABERTURA" = $3::text,
              "DS_MOTIVO_REABERTURA" = $4::text
        WHERE "CD_NFE" = $1::integer
          AND "TENANT_ID" = $2
          AND COALESCE("ST_RECEBIMENTO", 'ABERTA') = 'ENCERRADA'
      RETURNING "CD_NFE", "ST_RECEBIMENTO", "DH_REABERTURA", "DS_MOTIVO_REABERTURA"`,
      [cd, tid, sg, motivo]
    );
    if (!r.rows.length) {
      const chk = await pool.query(
        `SELECT "CD_NFE", "ST_RECEBIMENTO" FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE" = $1::integer AND "TENANT_ID" = $2`,
        [cd, tid]
      );
      if (!chk.rows.length) return res.status(404).json({ error: 'Documento não encontrado.' });
      return res.status(409).json({ error: 'Apenas NF-e encerrada pode ser reaberta.' });
    }
    return res.json({ ok: true, documento: r.rows[0] });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de recebimento desatualizada. Execute backend/scripts/wms_nfe_entrada_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] reabrirRecebimento:', e);
    return res.status(500).json({ error: 'Erro ao reabrir recebimento.' });
  }
}

async function criarLoteCrossdock(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const codigo = String(req.body?.codigo || '').trim().slice(0, 40);
    const nome = String(req.body?.nome || '').trim().slice(0, 120) || null;
    const observacao = String(req.body?.observacao || '').trim().slice(0, 255) || null;
    const dhJanela = req.body?.dhJanelaExpedicao ? new Date(req.body.dhJanelaExpedicao) : null;
    if (!codigo) return res.status(400).json({ error: 'Informe o código do lote.' });
    if (dhJanela && Number.isNaN(dhJanela.getTime())) {
      return res.status(400).json({ error: 'Data/hora da previsão operacional inválida.' });
    }
    const r = await pool.query(
      `INSERT INTO "WMS_CROSSDOCK_LOTE"
         ("TENANT_ID", "CODIGO", "NOME", "FASE", "DH_JANELA_EXPEDICAO", "OBSERVACAO", "FGACTIVE", "SG_USER")
       VALUES ($1, $2::text, $3::text, 'RECEBIMENTO', $4::timestamptz, $5::text, 'S', $6::text)
       RETURNING "CD_LOTE", "CODIGO", "NOME", "FASE", "DH_JANELA_EXPEDICAO", "OBSERVACAO", "DH_CRIACAO"`,
      [tid, codigo, nome, dhJanela, observacao, sg]
    );
    return res.status(201).json({ ok: true, lote: r.rows[0] });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Já existe lote com este código.' });
    }
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de crossdocking desatualizada. Execute backend/scripts/wms_crossdocking_lotes_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] criarLoteCrossdock:', e);
    return res.status(500).json({ error: 'Erro ao criar lote crossdocking.' });
  }
}

async function listarLotesCrossdock(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const fase = String(req.query?.fase || '').trim().toUpperCase();
    const codigo = String(req.query?.codigo || '').trim();
    let sql = `
      SELECT l."CD_LOTE", l."CODIGO", l."NOME", l."FASE", l."DH_JANELA_EXPEDICAO", l."OBSERVACAO", l."DH_CRIACAO",
             COUNT(n."CD_NFE")::integer AS "Q_NFES"
      FROM "WMS_CROSSDOCK_LOTE" l
      LEFT JOIN "WMS_CROSSDOCK_LOTE_NFE" n
        ON n."TENANT_ID" = l."TENANT_ID" AND n."CD_LOTE" = l."CD_LOTE"
      WHERE l."TENANT_ID" = $1 AND l."FGACTIVE" = 'S'`;
    const p = [tid];
    let i = 2;
    if (fase) {
      sql += ` AND l."FASE" = $${i}`;
      p.push(fase);
      i++;
    }
    if (codigo) {
      sql += ` AND l."CODIGO" ILIKE $${i}`;
      p.push(`%${codigo}%`);
      i++;
    }
    sql += ` GROUP BY l."CD_LOTE" ORDER BY l."DH_CRIACAO" DESC LIMIT 500`;
    const r = await pool.query(sql, p);
    return res.json(r.rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de crossdocking desatualizada. Execute backend/scripts/wms_crossdocking_lotes_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] listarLotesCrossdock:', e);
    return res.status(500).json({ error: 'Erro ao listar lotes crossdocking.' });
  }
}

/** Aceita CD_NFE (número) ou chave NF-e (44 dígitos, com ou sem prefixo NFe). */
async function resolverCdNfesParaVinculo(tenantId, rawList) {
  const chaves = [];
  const ids = [];
  const vistoChave = new Set();
  const vistoId = new Set();
  for (const item of rawList || []) {
    const s0 = String(item ?? '').trim();
    if (!s0) continue;
    const sans = s0.replace(/^NFe/i, '').replace(/\s/g, '');
    const d = digits(sans);
    if (d.length === 44) {
      if (!vistoChave.has(d)) {
        vistoChave.add(d);
        chaves.push(d);
      }
      continue;
    }
    const n = parseInt(sans, 10);
    if (Number.isFinite(n) && n > 0 && !vistoId.has(n)) {
      vistoId.add(n);
      ids.push(n);
    }
  }
  const cdSet = new Map();
  if (ids.length) {
    const r = await pool.query(
      `SELECT "CD_NFE" FROM "WMS_NFE_ENTRADA" WHERE "TENANT_ID" = $1 AND "CD_NFE" = ANY($2::int[])`,
      [tenantId, ids]
    );
    for (const row of r.rows || []) cdSet.set(parseInt(row.CD_NFE, 10), true);
  }
  const foundChaves = new Set();
  if (chaves.length) {
    const r2 = await pool.query(
      `SELECT "CD_NFE", trim("CHAVE_NFE"::text) AS ck
         FROM "WMS_NFE_ENTRADA"
        WHERE "TENANT_ID" = $1
          AND regexp_replace(trim("CHAVE_NFE"::text), '\\D', '', 'g') = ANY($2::text[])`,
      [tenantId, chaves]
    );
    for (const row of r2.rows || []) {
      const ck = digits(row.ck);
      if (ck) foundChaves.add(ck);
      cdSet.set(parseInt(row.CD_NFE, 10), true);
    }
  }
  const cdNfes = [...cdSet.keys()];
  const faltId = ids.filter((x) => !cdSet.has(x));
  const faltChave = chaves.filter((c) => !foundChaves.has(c));
  return { cdNfes, faltId, faltChave };
}

async function vincularNfesLote(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdLote = parseInt(req.params.cdLote, 10);
    if (!Number.isFinite(cdLote)) return res.status(400).json({ error: 'Lote inválido.' });
    const cdNfesRaw = Array.isArray(req.body?.cdNfes) ? req.body.cdNfes : [];
    const { cdNfes, faltId, faltChave } = await resolverCdNfesParaVinculo(tid, cdNfesRaw);
    if (faltId.length || faltChave.length) {
      const partes = [];
      if (faltId.length) partes.push(`CD_NFE não encontrado(s): ${faltId.join(', ')}`);
      if (faltChave.length) partes.push(`Chave não encontrada(s): ${faltChave.join(', ')}`);
      return res.status(400).json({ error: partes.join(' ') });
    }
    if (!cdNfes.length) {
      return res.status(400).json({
        error:
          'Informe ao menos uma NF-e para vincular (CD_NFE numérico ou chave de 44 dígitos, com ou sem prefixo NFe).',
      });
    }

    const rLote = await pool.query(
      `SELECT "CD_LOTE", "FASE" FROM "WMS_CROSSDOCK_LOTE" WHERE "CD_LOTE" = $1::integer AND "TENANT_ID" = $2 AND "FGACTIVE" = 'S'`,
      [cdLote, tid]
    );
    if (!rLote.rows.length) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (String(rLote.rows[0].FASE || '').toUpperCase() === 'ENCERRADO') {
      return res.status(409).json({ error: 'Lote encerrado não permite novos vínculos.' });
    }

    const rNfe = await pool.query(
      `SELECT "CD_NFE" FROM "WMS_NFE_ENTRADA" WHERE "TENANT_ID" = $1 AND "CD_NFE" = ANY($2::int[])`,
      [tid, cdNfes]
    );
    const existentes = new Set((rNfe.rows || []).map((x) => parseInt(x.CD_NFE, 10)));
    const faltantes = cdNfes.filter((x) => !existentes.has(x));
    if (faltantes.length) {
      return res.status(400).json({ error: `NF-e não encontrada(s): ${faltantes.join(', ')}` });
    }

    let inseridos = 0;
    for (const cdNfe of cdNfes) {
      const rIns = await pool.query(
        `INSERT INTO "WMS_CROSSDOCK_LOTE_NFE" ("CD_LOTE", "CD_NFE", "TENANT_ID", "SG_USER")
         VALUES ($1::integer, $2::integer, $3, $4::text)
         ON CONFLICT ("CD_LOTE", "CD_NFE") DO NOTHING`,
        [cdLote, cdNfe, tid, sg]
      );
      inseridos += rIns.rowCount || 0;
    }
    return res.json({ ok: true, cdLote, vinculados: inseridos, solicitados: cdNfes.length });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de crossdocking desatualizada. Execute backend/scripts/wms_crossdocking_lotes_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] vincularNfesLote:', e);
    return res.status(500).json({ error: 'Erro ao vincular NF-e no lote.' });
  }
}

async function mudarFaseLote(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdLote = parseInt(req.params.cdLote, 10);
    if (!Number.isFinite(cdLote)) return res.status(400).json({ error: 'Lote inválido.' });
    const fase = String(req.body?.fase || '').trim().toUpperCase();
    const permitidas = new Set(['RECEBIMENTO', 'SEPARACAO', 'PRE_EMBARQUE', 'EMBARCADO', 'ENCERRADO']);
    if (!permitidas.has(fase)) return res.status(400).json({ error: 'Fase inválida.' });

    const r = await pool.query(
      `UPDATE "WMS_CROSSDOCK_LOTE"
          SET "FASE" = $3::text,
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $4::text
        WHERE "CD_LOTE" = $1::integer AND "TENANT_ID" = $2 AND "FGACTIVE" = 'S'
      RETURNING "CD_LOTE", "CODIGO", "FASE", "DH_MAINTENANCE"`,
      [cdLote, tid, fase, sg]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Lote não encontrado.' });
    return res.json({ ok: true, lote: r.rows[0] });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura de crossdocking desatualizada. Execute backend/scripts/wms_crossdocking_lotes_postgres.sql.',
      });
    }
    console.error('[WMS recebimento] mudarFaseLote:', e);
    return res.status(500).json({ error: 'Erro ao mudar fase do lote.' });
  }
}

async function resolverCodigoEstoqueRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = parseInt(req.query.cdDono, 10);
    const codigo = String(req.query.codigo || '').trim();
    const cProd = String(req.query.cProd || '').trim();
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Parâmetro cdDono é obrigatório.' });
    }
    if (!codigo && !cProd) {
      return res.status(400).json({ error: 'Informe codigo e/ou cProd.' });
    }
    const hit = await resolverProdutoEstoque(pool, tid, cdDono, codigo || cProd, {
      codigoExterno: cProd || null,
    });
    if (!hit) {
      return res.status(404).json({
        error:
          'Não encontrado no catálogo de estoque nem no vínculo operacional (OL). Confira import exportar.xlsx e de-para NF.',
      });
    }
    return res.json({
      cdProduto: hit.cdProduto,
      codigoEstoque: hit.codigoEstoque,
      codigoOperacional: hit.codigoOperacional,
      fatorConversao: hit.fatorConversao,
      origem: hit.origem,
    });
  } catch (e) {
    console.error('[WMS recebimento] resolverCodigo:', e);
    return res.status(500).json({ error: 'Erro ao resolver código.' });
  }
}

async function buscarProdutosSugestaoRecebimento(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = parseInt(req.query.cdDono, 10);
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Parâmetro cdDono é obrigatório.' });
    }
    const okDono = await assertDonoTenant(tid, cdDono);
    if (!okDono) return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
    const rows = await buscarSugestoesProdutoRecebimento(pool, tid, cdDono, {
      q: req.query.q,
      cProd: req.query.cProd,
      xProd: req.query.xProd,
      limit: req.query.limit,
    });
    return res.json(rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS desatualizada. Execute os scripts de produtos/operacional do dono.',
      });
    }
    console.error('[WMS recebimento] buscarProdutosSugestao:', e);
    return res.status(500).json({ error: 'Erro ao buscar produtos para conferência.' });
  }
}

module.exports = {
  importarXml,
  resolverCodigoEstoqueRecebimento,
  buscarProdutosSugestaoRecebimento,
  listarDocumentos,
  exportarDocumentosRecebimento,
  listarRelatorioVencimentoRecebimento,
  listarRelatorioPosicaoEstoqueRecebimento,
  listarHistoricoRelatorioVencimentoEnvios,
  buscarDocumentoPorChave,
  buscarDocumento,
  excluirDocumento,
  trocarDonoDocumento,
  salvarConferencia,
  encerrarRecebimento,
  reabrirRecebimento,
  criarLoteCrossdock,
  listarLotesCrossdock,
  vincularNfesLote,
  mudarFaseLote,
};
