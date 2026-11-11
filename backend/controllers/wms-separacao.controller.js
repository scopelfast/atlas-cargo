'use strict';

const crypto = require('crypto');
const multer = require('multer');
const { pool } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { parseOplText } = require('../services/wms-opl-parser.service');
const {
  buildRomaneioSeparacaoHtml,
  digitosCodigoOl,
  expandirChavesDigitosCodigoOl,
  chaveCanonicaDigitosOl,
  montarOpcoesFiltroRomaneioEspelho,
} = require('../services/wms-opl-relatorio-romaneio.service');
const { carregarNrRotaPorPedidosOpl } = require('../services/cadastro-endereco-entrega-match.service');
const {
  simularCoberturaOplArquivo,
  validarCoberturaEncerramentoPicking,
  montarCsvCoberturaOpl,
} = require('../services/wms-opl-cobertura-estoque.service');
const { validarAutorizadorComSenha, usuarioTemPrograma } = require('../utils/wms-supervisor-auth');

const PROGRAMA_LIBERAR_COBERTURA_PICKING = 'wms-separacao-liberar-cobertura-picking';
const SQL_EXPR_XPED_NF = `LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', ln->>'xped', '')), '[^0-9]', '', 'g'), 10, '0')`;
const {
  aplicarReservasAoConcluirPickingOpl,
  listarReservasPorOplArquivo,
  removerReservasOplArquivo,
} = require('../services/wms-opl-reserva-picking.service');
const { obterStatusCicloOpl } = require('../services/wms-opl-ciclo-status.service');
const { corrigirPickingIndevidoOpl } = require('../services/wms-opl-corrigir-picking-indevido.service');
const {
  auditarCadastroEspelhoOpl,
  simularCadastroAutomaticoOpl,
  aplicarCadastroAutomaticoOpl,
} = require('../services/wms-opl-cadastro-automatico.service');
const { registrarSanacoesAposImportOpl } = require('../services/wms-carga-validacao.service');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');
const {
  carregarMapaProdutosDonoPorDigitos,
  prepararConsultaDigitosOl,
} = require('../services/wms-produto-mapa-codigo.service');
const { montarProgramacaoAntecipadaOpl } = require('../services/wms-opl-programacao-antecipada.service');
const {
  parseIdsArquivos,
  validarPedidosEntreArquivos,
  validarPedidosContraHistorico,
  linhasValidacaoParaCsv,
  buildValidacaoPedidosHtml,
  schemaMissing: schemaMissingValidPed,
} = require('../services/wms-opl-validar-pedidos-arquivos.service');
const {
  buildProgramacaoAntecipadaHtml,
  buildProgramacaoListagemGeralHtml,
} = require('../services/wms-opl-programacao-antecipada-html.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.txt')) return cb(null, true);
    cb(new Error('Apenas arquivos .txt são aceitos.'));
  },
});

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function hashBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Corrige nome de arquivo UTF-8 enviado como Latin-1 (ex.: SeparaÃ§Ã£o → Separação). */
function fixMultipartFilename(name) {
  if (name == null || typeof name !== 'string') return 'espelho.txt';
  const s = name.slice(0, 255);
  if (/Ã.|Â./.test(s)) {
    try {
      const fixed = Buffer.from(s, 'latin1').toString('utf8');
      if (fixed && fixed.length && !/\uFFFD/.test(fixed)) return fixed.slice(0, 255);
    } catch (_) {}
  }
  return s;
}

function trimQuery(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

async function usuarioPodeLiberarCoberturaPicking(login, tenantId) {
  if (await usuarioTemPrograma(login, tenantId, PROGRAMA_LIBERAR_COBERTURA_PICKING)) return true;
  return usuarioTemPrograma(login, tenantId, 'wms-expedicao-liberar-divergencia');
}

/**
 * Valida supervisor + justificativa e grava histórico (se tabela existir).
 * @returns {Promise<{ ok: true, autorizador: object } | { ok: false, status: number, error: string, code?: string }>}
 */
async function processarLiberacaoCoberturaPicking(req, tenantId, cdOplArquivo, cdDono, sgOperador, trxOpts) {
  const db = (trxOpts && trxOpts.db) || pool;
  const flag =
    req.body &&
    (req.body.liberarCoberturaInsuficiente === true ||
      req.body.liberar_cobertura === true ||
      req.body.liberarCobertura === true);
  if (!flag) return null;

  const autorizadoLogin = String(req.body.autorizadoLogin ?? req.body.autorizado_login ?? '').trim();
  const autorizadoSenha = String(req.body.autorizadoSenha ?? req.body.autorizado_senha ?? '');
  const justificativa = String(
    req.body.justificativaLiberacao ?? req.body.justificativa_liberacao ?? req.body.justificativa ?? ''
  ).trim();
  if (!justificativa || justificativa.length < 10) {
    return {
      ok: false,
      status: 400,
      error: 'Informe justificativa da liberação (mínimo 10 caracteres).',
      code: 'JUSTIFICATIVA',
    };
  }
  const auth = await validarAutorizadorComSenha(autorizadoLogin, autorizadoSenha, tenantId);
  if (!auth.ok) {
    return { ok: false, status: 401, error: auth.error || 'Autorização inválida.', code: 'AUTH' };
  }
  const pode = await usuarioPodeLiberarCoberturaPicking(auth.usuario.login, tenantId);
  if (!pode) {
    return {
      ok: false,
      status: 403,
      error: 'Usuário autorizador sem permissão para liberar cobertura de picking OPL.',
      code: 'SEM_PERMISSAO',
      programaNecessario: PROGRAMA_LIBERAR_COBERTURA_PICKING,
    };
  }
  const incluirAbertos =
    req.body && (req.body.incluirRecebimentosAbertos === true || req.body.incluirRecebimentosAbertos === '1');
  let resumoJson = null;
  try {
    const sim = await simularCoberturaOplArquivo(tenantId, cdOplArquivo, {
      incluirRecebimentosAbertos: incluirAbertos,
    });
    if (sim.ok) {
      const probs = (sim.linhas || []).filter(
        (L) => L.semDepara || (L.possivelFalta != null && L.possivelFalta > 1e-9)
      );
      resumoJson = {
        agregado: sim.agregado,
        linhasProblema: probs.slice(0, 80),
        incluirRecebimentosAbertos: incluirAbertos,
      };
    }
  } catch (_) {}

  try {
    await db.query(
      `INSERT INTO "WMS_OPL_LIBERACAO_COBERTURA"
        ("CD_OPL_ARQUIVO","TENANT_ID","CD_DONO","SG_USER","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","INCLUIU_RECEB_ABERTOS","RESUMO_JSON")
       VALUES ($1::integer,$2,$3::integer,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        cdOplArquivo,
        tenantId,
        Number.isFinite(cdDono) ? cdDono : null,
        sgOperador,
        auth.usuario.login,
        auth.usuario.nome || auth.usuario.login,
        justificativa,
        incluirAbertos ? 'S' : 'N',
        resumoJson ? JSON.stringify(resumoJson) : null,
      ]
    );
  } catch (eIns) {
    if (!schemaMissing(eIns)) throw eIns;
  }

  return {
    ok: true,
    autorizador: auth.usuario,
    justificativa,
    resumoJson,
  };
}

function queryBool(v) {
  if (v == null || v === '') return false;
  if (v === true || v === 1) return true;
  const s = String(v).trim().toLowerCase();
  return ['1', 's', 'y', 'sim', 'true', 'yes'].includes(s);
}

function collectDigitosProdutosOpl(data) {
  const s = new Set();
  for (const p of data.pedidos || []) {
    for (const it of p.itens || []) {
      const cod = it.COD_PRODUTO_OL ?? it.codProdutoOl;
      const d = chaveCanonicaDigitosOl(cod);
      if (d) s.add(d);
    }
  }
  return Array.from(s);
}

/** Produto com mesmo código OL em outro CD_DONO (causa falsa «sem cadastro» na auditoria). */
async function carregarCadastroEmOutrosDonos(tenantId, cdDonoEspelho, digitosList) {
  const { uniq, allQuery, toCanonical } = prepararConsultaDigitosOl(digitosList);
  if (!uniq.length || !allQuery.length) return {};
  const cdDonoParam =
    cdDonoEspelho != null && cdDonoEspelho !== '' && Number.isFinite(Number(cdDonoEspelho))
      ? Number(cdDonoEspelho)
      : null;
  if (cdDonoParam == null) return {};
  try {
    const r = await pool.query(
      `SELECT regexp_replace(trim(pr."CODIGO"), '[^0-9]', '', 'g') AS d,
              pr."CD_DONO",
              o."NOME" AS "NM_DONO"
         FROM "WMS_PRODUTO_DONO" pr
         JOIN "WMS_DONO_ESTOQUE" o
           ON o."TENANT_ID" = pr."TENANT_ID" AND o."CD_DONO" = pr."CD_DONO"
        WHERE pr."TENANT_ID" = $1
          AND pr."FGACTIVE" = 'S'
          AND pr."CD_DONO" IS DISTINCT FROM $2::integer
          AND regexp_replace(trim(pr."CODIGO"), '[^0-9]', '', 'g') = ANY($3::text[])
        ORDER BY d, pr."CD_DONO"`,
      [tenantId, cdDonoParam, allQuery]
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
      const dup = out[canonical].some(
        (x) => x.cdDono === row.CD_DONO && x.nmDono === (row.NM_DONO || '')
      );
      if (!dup) out[canonical].push({ cdDono: row.CD_DONO, nmDono: row.NM_DONO || '' });
    }
    return out;
  } catch (e) {
    if (schemaMissing(e)) return {};
    throw e;
  }
}

async function nomeDonoEstoque(tenantId, cdDono) {
  if (cdDono == null || !Number.isFinite(Number(cdDono))) return '';
  const r = await pool.query(
    `SELECT "NOME" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer`,
    [tenantId, Number(cdDono)]
  );
  return r.rows[0]?.NOME ? String(r.rows[0].NOME).trim() : '';
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

async function importarOplTxt(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const buf = req.file && req.file.buffer;
  if (!buf || !buf.length) return res.status(400).json({ error: 'Envie um arquivo .txt (campo arquivo).' });
  const nome = fixMultipartFilename(String(req.file.originalname || 'espelho.txt'));
  if (req.body == null || req.body.CD_DONO == null || String(req.body.CD_DONO).trim() === '') {
    return res.status(400).json({
      error:
        'Dono do estoque (CD_DONO) é obrigatório na importação do espelho. Sem dono não há simulação de saldo, reserva nem trava de cobertura ao encerrar o picking.',
      code: 'CD_DONO_OBRIGATORIO',
    });
  }
  const cdDono = parseInt(req.body.CD_DONO, 10);
  if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'CD_DONO inválido.' });
  if (!(await assertDonoTenant(tid, cdDono))) {
    return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
  }
  const text = buf.toString('utf8');
  let parsed;
  try {
    parsed = parseOplText(text);
  } catch (e) {
    const msg = e && e.message ? e.message : 'Erro ao interpretar arquivo.';
    return res.status(400).json({ error: msg });
  }
  const h = hashBuffer(buf);
  const client = await pool.connect();
  try {
    const dup = await client.query(
      `SELECT "CD_OPL_ARQUIVO", "NM_ARQUIVO", "DATA_ARQ", "DH_IMPORT", "Q_PEDIDOS", "Q_ITENS"
         FROM "WMS_OPL_ARQUIVO"
        WHERE "TENANT_ID" = $1 AND "HASH_CONTEUDO" = $2`,
      [tid, h]
    );
    if (dup.rows.length) {
      const ex = dup.rows[0];
      const novoPed = parsed.arquivo.qPedidos;
      const novoIt = parsed.arquivo.qItens;
      const exPed = ex.Q_PEDIDOS;
      const exIt = ex.Q_ITENS;
      return res.status(409).json({
        error:
          'Arquivo byte a byte igual ao espelho #' +
          ex.CD_OPL_ARQUIVO +
          ' («' +
          String(ex.NM_ARQUIVO || '').trim() +
          '»). Seu arquivo: ' +
          novoPed +
          ' pedidos / ' +
          novoIt +
          ' itens' +
          (parsed.arquivo.dataArq ? ' · data no arquivo ' + parsed.arquivo.dataArq : '') +
          '. Já importado: ' +
          exPed +
          ' pedidos / ' +
          exIt +
          ' itens' +
          (ex.DATA_ARQ ? ' · data ' + ex.DATA_ARQ : '') +
          '.',
        code: 'OPL_CONTEUDO_DUPLICADO',
        cdOplArquivo: ex.CD_OPL_ARQUIVO,
        nmArquivoExistente: ex.NM_ARQUIVO,
        dhImport: ex.DH_IMPORT,
        resumoNovo: {
          pedidos: novoPed,
          itens: novoIt,
          dataArq: parsed.arquivo.dataArq || null,
          nmArquivo: nome,
        },
        resumoExistente: {
          pedidos: exPed,
          itens: exIt,
          dataArq: ex.DATA_ARQ || null,
        },
      });
    }
    await client.query('BEGIN');
    const rArq = await client.query(
      `INSERT INTO "WMS_OPL_ARQUIVO"
        ("TENANT_ID", "CD_DONO", "NM_ARQUIVO", "HASH_CONTEUDO", "LINHA1_RAW", "IDENT_TIPO1", "CNPJ_CPF_CLI", "CLI_NOME", "DATA_ARQ", "SG_USER", "Q_PEDIDOS", "Q_ITENS")
       VALUES ($1, $2::integer, $3, $4, $5, $6, $7, $8, $9, $10, $11::integer, $12::integer)
       RETURNING "CD_OPL_ARQUIVO"`,
      [
        tid,
        cdDono,
        nome,
        h,
        parsed.arquivo.raw,
        parsed.arquivo.ident,
        parsed.arquivo.cnpjCpfCli || null,
        parsed.arquivo.cliNome || null,
        parsed.arquivo.dataArq || null,
        sg,
        parsed.arquivo.qPedidos,
        parsed.arquivo.qItens,
      ]
    );
    const cdArq = rArq.rows[0].CD_OPL_ARQUIVO;
    for (const p of parsed.pedidos) {
      const rPed = await client.query(
        `INSERT INTO "WMS_OPL_PEDIDO"
          ("CD_OPL_ARQUIVO", "SEQ_PEDIDO", "LINHA2_RAW", "COD_DESTINATARIO", "RAZ_SOC_DEST", "ENDE_ENTREGA", "BAIRRO_ENTREGA", "CEP_ENTREGA", "CIDADE_ENTREGA", "UF_ENTREGA", "NUM_PEDIDO", "DATA_PEDIDO", "CNPJ_DEST", "FONE_DEST", "DADOS_JSON")
         VALUES ($1::integer, $2::integer, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)
         RETURNING "CD_OPL_PEDIDO"`,
        [
          cdArq,
          p.seqPedido,
          p.raw,
          p.codDestinatario || null,
          p.razSocDest || null,
          p.endeEntrega || null,
          p.bairroEntrega || null,
          p.cepEntrega || null,
          p.cidadeEntrega || null,
          p.ufEntrega || null,
          p.numPedido || null,
          p.dataPedido || null,
          p.cnpjDest || null,
          p.foneDest || null,
          JSON.stringify(p.dadosJson || {}),
        ]
      );
      const cdPed = rPed.rows[0].CD_OPL_PEDIDO;
      for (const it of p.itens || []) {
        await client.query(
          `INSERT INTO "WMS_OPL_ITEM"
            ("CD_OPL_PEDIDO", "SEQ_ITEM", "LINHA3_RAW", "DESCRICAO", "COD_PRODUTO_OL", "QT_PEDIDA", "REF_PEDIDO_LINK", "DADOS_JSON")
           VALUES ($1::integer, $2::integer, $3, $4, $5, $6::numeric, $7, $8::jsonb)`,
          [
            cdPed,
            it.seqItem,
            it.raw,
            it.descricao || null,
            it.codProdutoOl || null,
            it.qtPedida,
            it.refPedidoLink || null,
            JSON.stringify(it.dadosJson || {}),
          ]
        );
      }
    }
    await client.query('COMMIT');
    let auditoriaCadastro = null;
    try {
      auditoriaCadastro = await auditarCadastroEspelhoOpl(tid, cdDono, parsed);
      if (auditoriaCadastro?.resumo?.semCadastro > 0) {
        const fix = await aplicarCadastroAutomaticoOpl(tid, cdArq, sg, {});
        if (fix.ok && fix.auditoriaDepois) auditoriaCadastro = fix.auditoriaDepois;
      }
    } catch (eAud) {
      console.warn('[WMS separação] auditoria cadastro pós-importação:', eAud.message || eAud);
    }
    let sanacoesExpedicao = null;
    try {
      sanacoesExpedicao = await registrarSanacoesAposImportOpl(tid, cdArq, sg, { nmArquivo: nome });
      if (sanacoesExpedicao && sanacoesExpedicao.sanacoes > 0) {
        console.log(
          `[WMS separação] sanção pós-OPL #${cdArq}: ${sanacoesExpedicao.sanacoes} carga(s)`,
          sanacoesExpedicao.cargas.map((c) => c.cdCarga).join(',')
        );
      }
    } catch (eSan) {
      console.warn('[WMS separação] sanção pós-importação OPL:', eSan.message || eSan);
    }
    return res.status(201).json({
      ok: true,
      cdOplArquivo: cdArq,
      resumo: {
        pedidos: parsed.arquivo.qPedidos,
        itens: parsed.arquivo.qItens,
      },
      auditoriaCadastro,
      sanacoesExpedicao,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Arquivo duplicado (conteúdo já importado).' });
    }
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] importarOplTxt:', e);
    return res.status(500).json({ error: 'Erro ao gravar importação OPL.' });
  } finally {
    client.release();
  }
}

async function listarImportacoes(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const codDest = trimQuery(req.query.codDest ?? req.query.cod_destinatario);
    const nomeDest = trimQuery(req.query.nomeDest ?? req.query.razaoDest);
    const cidade = trimQuery(req.query.cidade);
    const uf = trimQuery(req.query.uf);
    const numPedido = trimQuery(req.query.numPedido ?? req.query.num_pedido);
    const nmArquivo = trimQuery(req.query.nmArquivo ?? req.query.arquivo);

    const hasPedidoFiltro = !!(codDest || nomeDest || cidade || uf || numPedido);

    const params = [tid];
    let i = 2;
    let sql = `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CLI_NOME", a."DATA_ARQ", a."DH_IMPORT", a."Q_PEDIDOS", a."Q_ITENS", a."ST_IMPORT", a."CD_DONO",
         (SELECT COUNT(*)::int FROM "WMS_OPL_PEDIDO" p2
            JOIN "WMS_OPL_ITEM" i2 ON i2."CD_OPL_PEDIDO" = p2."CD_OPL_PEDIDO"
           WHERE p2."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
             AND i2."QT_COLETADA" IS NOT NULL) AS "Q_ITENS_COM_PICKING",
         (SELECT COUNT(*)::int FROM "WMS_OPL_PEDIDO" p3
            JOIN "WMS_OPL_ITEM" i3 ON i3."CD_OPL_PEDIDO" = p3."CD_OPL_PEDIDO"
           WHERE p3."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
             AND i3."QT_COLETADA" IS NOT NULL
             AND i3."QT_COLETADA" IS DISTINCT FROM i3."QT_PEDIDA") AS "Q_ITENS_DIVERGENTES",
         (SELECT COUNT(DISTINCT c."CD_CARGA")::int
            FROM "WMS_CARGA_PROGRAMADA" c
            JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
            JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
            JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln ON true
            JOIN "WMS_OPL_PEDIDO" p4 ON p4."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
              AND LPAD(regexp_replace(trim(COALESCE(p4."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') = ${SQL_EXPR_XPED_NF}
           WHERE c."TENANT_ID" = a."TENANT_ID"
             AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
             AND trim(COALESCE(ln->>'xPed', ln->>'xped', '')) <> ''
         ) AS "Q_CARGAS_MONTAGEM",
         EXISTS (
           SELECT 1 FROM "WMS_RESERVA_ESTOQUE_OPL" r
            WHERE r."TENANT_ID" = a."TENANT_ID" AND r."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
         ) AS "TEM_RESERVA"
         FROM "WMS_OPL_ARQUIVO" a
        WHERE a."TENANT_ID" = $1`;

    if (nmArquivo) {
      sql += ` AND a."NM_ARQUIVO" ILIKE $${i}`;
      params.push(`%${nmArquivo}%`);
      i += 1;
    }

    if (hasPedidoFiltro) {
      sql += ` AND EXISTS (
        SELECT 1 FROM "WMS_OPL_PEDIDO" p
         WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"`;
      if (codDest) {
        sql += ` AND TRIM(COALESCE(p."COD_DESTINATARIO", '')) ILIKE $${i}`;
        params.push(`%${codDest}%`);
        i += 1;
      }
      if (nomeDest) {
        sql += ` AND UPPER(COALESCE(p."RAZ_SOC_DEST", '')) LIKE UPPER($${i})`;
        params.push(`%${nomeDest}%`);
        i += 1;
      }
      if (cidade) {
        sql += ` AND UPPER(COALESCE(p."CIDADE_ENTREGA", '')) LIKE UPPER($${i})`;
        params.push(`%${cidade}%`);
        i += 1;
      }
      if (uf) {
        sql += ` AND UPPER(TRIM(COALESCE(p."UF_ENTREGA", ''))) = UPPER($${i})`;
        params.push(uf.slice(0, 2));
        i += 1;
      }
      if (numPedido) {
        sql += ` AND TRIM(COALESCE(p."NUM_PEDIDO", '')) ILIKE $${i}`;
        params.push(`%${numPedido}%`);
        i += 1;
      }
      sql += ')';
    }

    sql += ` ORDER BY a."DH_IMPORT" DESC LIMIT 200`;

    const r = await pool.query(sql, params);
    res.json(r.rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] listar:', e);
    res.status(500).json({ error: 'Erro ao listar importações.' });
  }
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

async function buscarImportacao(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const data = await carregarImportacaoCompleta(tid, cd);
    if (!data) return res.status(404).json({ error: 'Importação não encontrada.' });
    let simulacaoEstoque = null;
    const incluirRecAbertos = queryBool(
      req.query.incluirRecebimentosAbertos ?? req.query.incluir_recebimentos_abertos
    );
    try {
      simulacaoEstoque = await simularCoberturaOplArquivo(tid, cd, {
        incluirRecebimentosAbertos: incluirRecAbertos,
      });
    } catch (eSim) {
      if (!schemaMissing(eSim)) console.warn('[WMS separação] simulação cobertura:', eSim.message || eSim);
      simulacaoEstoque = { ok: false, erro: 'Não foi possível calcular a simulação de estoque.', linhas: [], agregado: {} };
    }
    let reservaEstoque = null;
    try {
      const linhas = await listarReservasPorOplArquivo(pool, tid, cd);
      reservaEstoque = { linhas, total: linhas.length };
    } catch (eRes) {
      if (!schemaMissing(eRes)) console.warn('[WMS separação] listar reserva OPL:', eRes.message || eRes);
    }
    let statusCiclo = null;
    try {
      statusCiclo = await obterStatusCicloOpl(tid, cd);
    } catch (eCiclo) {
      if (!schemaMissing(eCiclo)) console.warn('[WMS separação] status ciclo OPL:', eCiclo.message || eCiclo);
      statusCiclo = { expedicaoSaidaConfirmada: false, dhSaidaExpedicao: null, cdCargaExpedicao: null, qtdMovimentosSaida: 0 };
    }
    let permissaoLiberacaoCobertura = false;
    try {
      const sg = getSgUser(req);
      if (sg) permissaoLiberacaoCobertura = await usuarioPodeLiberarCoberturaPicking(sg, tid);
    } catch (_) {}
    let historicoLiberacaoCobertura = [];
    try {
      const rLib = await pool.query(
        `SELECT "DH_LIBERACAO", "SG_USER", "AUTORIZADO_LOGIN", "AUTORIZADO_NOME", "JUSTIFICATIVA", "INCLUIU_RECEB_ABERTOS"
           FROM "WMS_OPL_LIBERACAO_COBERTURA"
          WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer
          ORDER BY "DH_LIBERACAO" DESC
          LIMIT 20`,
        [tid, cd]
      );
      historicoLiberacaoCobertura = rLib.rows || [];
    } catch (eLib) {
      if (!schemaMissing(eLib)) console.warn('[WMS separação] histórico liberação:', eLib.message || eLib);
    }
    let opcoesFiltroRomaneio = { conservacoes: [], grupos: [], categorias: [] };
    try {
      const digitos = collectDigitosProdutosOpl(data);
      const produtoPorDigitos = await carregarMapaProdutosDonoPorDigitos(
        tid,
        data.arquivo && data.arquivo.CD_DONO,
        digitos
      );
      opcoesFiltroRomaneio = montarOpcoesFiltroRomaneioEspelho(data.pedidos, produtoPorDigitos);
    } catch (eOp) {
      if (!schemaMissing(eOp)) console.warn('[WMS separação] opções filtro romaneio:', eOp.message || eOp);
    }
    res.json({
      ...data,
      simulacaoEstoque,
      reservaEstoque,
      statusCiclo,
      permissaoLiberacaoCobertura,
      programaLiberacaoCobertura: PROGRAMA_LIBERAR_COBERTURA_PICKING,
      historicoLiberacaoCobertura,
      opcoesFiltroRomaneio,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    res.status(500).json({ error: 'Erro ao buscar importação.' });
  }
}

/**
 * GET …/romaneio?conservacao=todos|seco|refrigerado|congelado|refri&agruparItens=1&folhas=dest|continuo|geral
 *   &separadores=auto|nao|sim|faixas_cons|conservacao|cons_grupo|cons_grupo_cat&colunaCad=0|1
 * HTML para conferência / separação (impressão).
 * folhas=geral → listagem consolidada de produtos (estilo Resumo de picking das Cargas).
 */
async function romaneioSeparacaoHtml(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const data = await carregarImportacaoCompleta(tid, cd);
    if (!data) return res.status(404).json({ error: 'Importação não encontrada.' });
    const c = (req.query.conservacao || 'todos').toLowerCase();
    const conservacaoValidos = new Set(['todos', 'refri', 'seco', 'refrigerado', 'congelado']);
    const conservacao = conservacaoValidos.has(c) ? c : 'todos';
    const agruparItens = req.query.agruparItens === '1' || req.query.agruparItens === 'true';
    const folhasRaw = String(req.query.folhas || 'dest').toLowerCase();
    const modoFolhas = ['dest', 'continuo', 'geral'].includes(folhasRaw) ? folhasRaw : 'dest';
    const folhasPorDestinatario = modoFolhas === 'dest';
    const ordemCamposValidos = new Set([
      'unidade',
      'destino',
      'conservacao',
      'grupo',
      'subcategoria',
      'categoria',
      'classe',
      'nome',
      'codigo',
    ]);
    const ordem = String(req.query.ordem || '')
      .split(',')
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x, idx, arr) => x && ordemCamposValidos.has(x) && arr.indexOf(x) === idx);
    const digitos = collectDigitosProdutosOpl(data);
    let produtoPorDigitos = {};
    try {
      produtoPorDigitos = await carregarMapaProdutosDonoPorDigitos(
        tid,
        data.arquivo && data.arquivo.CD_DONO,
        digitos
      );
    } catch (e2) {
      if (!schemaMissing(e2)) console.warn('[WMS separação] romaneio cadastro produto:', e2.message || e2);
      produtoPorDigitos = {};
    }
    const carimboConferencia =
      req.query.carimboConferencia !== '0' &&
      req.query.carimboConferencia !== 'false' &&
      req.query.carimbo !== '0';
    const sepRaw = String(req.query.separadores || req.query.separadoresGrupo || 'auto').toLowerCase();
    const sepValidos = new Set([
      'auto',
      'nao',
      'sim',
      'faixas_cons',
      'faixas',
      'cons_faixas',
      'conservacao',
      'cons',
      'cons_grupo',
      'conservacao_grupo',
      'cons_grupo_cat',
      'conservacao_grupo_categoria',
    ]);
    const separadoresGrupo = sepValidos.has(sepRaw) ? sepRaw : 'auto';
    let exibirColunaCad;
    if (req.query.colunaCad != null || req.query.exibirColunaCad != null) {
      const v = String(req.query.colunaCad ?? req.query.exibirColunaCad).toLowerCase();
      exibirColunaCad = v === '1' || v === 'true' || v === 'sim';
    }
    /** Filtros opcionais para impressão específica (uma carga, alguns pedidos, etc.).
     *  Todos aceitam lista separada por vírgula ou repetição do param. */
    function lerListaParam(name) {
      const raw = req.query[name];
      if (raw == null) return [];
      const arr = Array.isArray(raw) ? raw : [raw];
      const out = [];
      for (const v of arr) {
        for (const x of String(v).split(/[,;]/)) {
          const t = x.trim();
          if (t) out.push(t);
        }
      }
      return out;
    }
    const filtros = {
      destinatarios: lerListaParam('destinatarios'),
      pedidos: lerListaParam('pedidos'),
      unidades: lerListaParam('unidades'),
      codigoOl: String(req.query.codigoOl || '').trim(),
      conservacoes: lerListaParam('conservacoes'),
      grupos: lerListaParam('grupos'),
      categorias: lerListaParam('categorias'),
    };
    let nrRotaPorChave = new Map();
    try {
      nrRotaPorChave = await carregarNrRotaPorPedidosOpl(pool, tid, data.pedidos);
    } catch (eRota) {
      if (!schemaMissing(eRota)) console.warn('[WMS separação] romaneio NR_ROTA:', eRota.message || eRota);
      nrRotaPorChave = new Map();
    }
    const html = buildRomaneioSeparacaoHtml(data, {
      conservacao,
      agruparItens,
      folhasPorDestinatario,
      modoFolhas,
      produtoPorDigitos,
      ordem,
      carimboConferencia,
      nrRotaPorChave,
      filtros,
      separadoresGrupo,
      exibirColunaCad,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] romaneioSeparacaoHtml:', e);
    res.status(500).json({ error: 'Erro ao gerar romaneio.' });
  }
}

async function excluirImportacao(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const bloq = await pool.query(
      `SELECT 1
         FROM "WMS_OPL_PEDIDO" p
         JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
        WHERE a."CD_OPL_ARQUIVO" = $1::integer
          AND a."TENANT_ID" = $2
          AND i."QT_COLETADA" IS NOT NULL
        LIMIT 1`,
      [cd, tid]
    );
    if (bloq.rows.length) {
      return res.status(400).json({
        error:
          'Não é possível excluir: já existe picking gravado nesta importação. Zerar as quantidades coletadas nos itens (ou ajustar) antes de remover, se for o caso.',
      });
    }
    const r = await pool.query(
      `DELETE FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2 RETURNING "CD_OPL_ARQUIVO"`,
      [cd, tid]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Importação não encontrada.' });
    res.json({ ok: true, cdOplArquivo: r.rows[0].CD_OPL_ARQUIVO });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    res.status(500).json({ error: 'Erro ao excluir importação.' });
  }
}

/**
 * Substitui item do picking: zera a linha original (SUBSTITUIDO) e cria linha nova
 * no mesmo pedido com o SKU/qtd do produto enviado (tipoLinha SUBSTITUTO).
 * POST /wms/separacao/opl/importacoes/:cdOplArquivo/itens/:cdOplItem/substituir
 */
async function substituirItemPicking(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cdArq = parseInt(req.params.cdOplArquivo, 10);
  const cdItemOrigem = parseInt(req.params.cdOplItem, 10);
  if (!Number.isFinite(cdArq) || !Number.isFinite(cdItemOrigem)) {
    return res.status(400).json({ error: 'Código de arquivo ou item inválido.' });
  }
  const codigoOl = String(req.body?.codigoOl ?? req.body?.CODIGO_OL ?? req.body?.codigo ?? '')
    .trim()
    .slice(0, 80);
  const qtRaw = req.body?.qtColetada ?? req.body?.QT_COLETADA ?? req.body?.qtd;
  const qtColetada =
    qtRaw != null && String(qtRaw).trim() !== ''
      ? parseFloat(String(qtRaw).replace(',', '.'))
      : NaN;
  const observacao = String(req.body?.observacao ?? req.body?.OBS ?? '')
    .trim()
    .slice(0, 500);
  const descBody = String(req.body?.descricao ?? req.body?.DESCRICAO ?? '')
    .trim()
    .slice(0, 255);

  if (!codigoOl) {
    return res.status(400).json({ error: 'Informe codigoOl do produto substituto.' });
  }
  if (!Number.isFinite(qtColetada) || qtColetada <= 0) {
    return res.status(400).json({
      error: 'Informe qtColetada do substituto (maior que zero).',
      code: 'QT_INVALIDA',
    });
  }

  try {
    const arqR = await pool.query(
      `SELECT "CD_OPL_ARQUIVO", "CD_DONO", "NM_ARQUIVO"
         FROM "WMS_OPL_ARQUIVO"
        WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdArq, tid]
    );
    if (!arqR.rowCount) return res.status(404).json({ error: 'Importação não encontrada.' });
    const cdDono = parseInt(String(arqR.rows[0].CD_DONO), 10);
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({
        error: 'Espelho sem dono do estoque. Associe o dono antes de substituir itens.',
        code: 'SEM_DONO',
      });
    }

    try {
      const ciclo = await obterStatusCicloOpl(tid, cdArq);
      if (ciclo.expedicaoSaidaConfirmada) {
        return res.status(409).json({
          error:
            'Esta importação já teve saída confirmada na expedição. Não é possível substituir itens.',
          code: 'CICLO_ENCERRADO',
          statusCiclo: ciclo,
        });
      }
    } catch (eCiclo) {
      if (!schemaMissing(eCiclo)) throw eCiclo;
    }

    let temReserva = false;
    try {
      const rRes = await pool.query(
        `SELECT 1 FROM "WMS_RESERVA_ESTOQUE_OPL"
          WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer
          LIMIT 1`,
        [tid, cdArq]
      );
      temReserva = rRes.rowCount > 0;
    } catch (eRes) {
      if (!schemaMissing(eRes)) throw eRes;
    }
    if (temReserva) {
      return res.status(409).json({
        error:
          'Há reserva de estoque neste espelho. Use «Reabrir picking» antes de substituir itens.',
        code: 'RESERVA_ATIVA',
      });
    }

    const hit = await resolverProdutoEstoque(pool, tid, cdDono, codigoOl, {
      codigoExterno: codigoOl,
    });
    if (!hit || !(hit.codigoEstoque || hit.CODIGO)) {
      return res.status(400).json({
        error:
          'Produto substituto não encontrado no dono do espelho (cadastro/de-para). Informe um código válido.',
        code: 'PRODUTO_NAO_RESOLVIDO',
        codigoOl,
        cdDono,
      });
    }
    const codigoInterno = String(hit.codigoEstoque || hit.CODIGO).trim();
    const descricao =
      descBody ||
      String(hit.nmProduto || hit.NM_PRODUTO || hit.NOME || hit.DESCRICAO || codigoInterno)
        .trim()
        .slice(0, 255);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const origR = await client.query(
        `SELECT i."CD_OPL_ITEM", i."CD_OPL_PEDIDO", i."SEQ_ITEM", i."COD_PRODUTO_OL", i."DESCRICAO",
                i."QT_PEDIDA", i."QT_COLETADA", i."DADOS_JSON"
           FROM "WMS_OPL_ITEM" i
           JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
           JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $3
          WHERE i."CD_OPL_ITEM" = $1::integer
            AND a."CD_OPL_ARQUIVO" = $2::integer
          FOR UPDATE OF i`,
        [cdItemOrigem, cdArq, tid]
      );
      if (!origR.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Item não encontrado neste espelho.' });
      }
      const orig = origR.rows[0];
      let dadosOrig =
        typeof orig.DADOS_JSON === 'string'
          ? JSON.parse(orig.DADOS_JSON || '{}')
          : orig.DADOS_JSON && typeof orig.DADOS_JSON === 'object'
            ? { ...orig.DADOS_JSON }
            : {};
      const tipoLinha = String(dadosOrig.tipoLinha || '').toUpperCase();
      if (tipoLinha === 'SUBSTITUTO') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Não é possível substituir uma linha que já é produto substituto.',
          code: 'LINHA_SUBSTITUTO',
        });
      }
      if (
        String(dadosOrig.motivoDiverg || '').toUpperCase() === 'SUBSTITUIDO' ||
        dadosOrig.cdItemSubstituto != null
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Este item já foi substituído. Reabra o picking ou edite a linha Extra.',
          code: 'JA_SUBSTITUIDO',
          cdItemSubstituto: dadosOrig.cdItemSubstituto || null,
        });
      }

      const seqR = await client.query(
        `SELECT COALESCE(MAX("SEQ_ITEM"), 0)::int + 1 AS prox
           FROM "WMS_OPL_ITEM"
          WHERE "CD_OPL_PEDIDO" = $1::integer`,
        [orig.CD_OPL_PEDIDO]
      );
      const seqNovo = seqR.rows[0].prox;
      const linhaRaw = `SUBST|${orig.CD_OPL_ITEM}|${codigoInterno}|${qtColetada}`;

      const ins = await client.query(
        `INSERT INTO "WMS_OPL_ITEM"
          ("CD_OPL_PEDIDO", "SEQ_ITEM", "LINHA3_RAW", "DESCRICAO", "COD_PRODUTO_OL",
           "QT_PEDIDA", "QT_COLETADA", "REF_PEDIDO_LINK", "DADOS_JSON")
         VALUES ($1::integer, $2::integer, $3, $4, $5, $6::numeric, $7::numeric, $8, $9::jsonb)
         RETURNING *`,
        [
          orig.CD_OPL_PEDIDO,
          seqNovo,
          linhaRaw.slice(0, 500),
          descricao,
          codigoInterno,
          qtColetada,
          qtColetada,
          null,
          JSON.stringify({
            tipoLinha: 'SUBSTITUTO',
            cdItemOrigem: orig.CD_OPL_ITEM,
            codigoOlOrigem: orig.COD_PRODUTO_OL || null,
            descricaoOrigem: orig.DESCRICAO || null,
            observacao: observacao || null,
            sgUser: sg,
            dhSubstituicao: new Date().toISOString(),
          }),
        ]
      );
      const itemSub = ins.rows[0];

      dadosOrig.motivoDiverg = 'SUBSTITUIDO';
      dadosOrig.cdItemSubstituto = itemSub.CD_OPL_ITEM;
      dadosOrig.codigoOlSubstituto = codigoInterno;
      dadosOrig.qtSubstituto = qtColetada;
      if (observacao) dadosOrig.observacaoSubstituicao = observacao;
      dadosOrig.sgUserSubstituicao = sg;
      dadosOrig.dhSubstituicao = new Date().toISOString();

      const upOrig = await client.query(
        `UPDATE "WMS_OPL_ITEM"
            SET "QT_COLETADA" = 0,
                "DADOS_JSON" = $2::jsonb
          WHERE "CD_OPL_ITEM" = $1::integer
          RETURNING *`,
        [orig.CD_OPL_ITEM, JSON.stringify(dadosOrig)]
      );

      await client.query('COMMIT');
      return res.status(201).json({
        ok: true,
        itemOrigem: upOrig.rows[0],
        itemSubstituto: itemSub,
        mensagem: `Item substituído: ${orig.COD_PRODUTO_OL || '—'} → ${codigoInterno} (qtd ${qtColetada}).`,
      });
    } catch (eTx) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw eTx;
    } finally {
      client.release();
    }
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Conflito de sequência do item no pedido. Tente novamente.' });
    }
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] substituirItemPicking:', e);
    return res.status(500).json({ error: 'Erro ao substituir item do picking.' });
  }
}

async function salvarPicking(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArq = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cdArq)) return res.status(400).json({ error: 'Código de arquivo inválido.' });
    const chk = await pool.query(
      `SELECT 1 FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdArq, tid]
    );
    if (!chk.rows.length) return res.status(404).json({ error: 'Importação não encontrada.' });
    try {
      const ciclo = await obterStatusCicloOpl(tid, cdArq);
      const posExpedicao =
        req.body &&
        (req.body.posExpedicao === true ||
          req.body.posExpedicao === '1' ||
          req.body.somenteHistorico === true ||
          req.body.somenteHistorico === '1');
      if (ciclo.expedicaoSaidaConfirmada && !posExpedicao) {
        return res.status(409).json({
          error:
            'Esta importação já teve saída confirmada na expedição. Para só registrar o picking no espelho (sem reserva/estoque), use «Registrar picking pós-expedição».',
          code: 'CICLO_ENCERRADO',
          statusCiclo: ciclo,
          permiteRegistroHistorico: true,
        });
      }
      req._oplCicloEncerrado = !!ciclo.expedicaoSaidaConfirmada;
      req._oplPosExpedicao = !!(ciclo.expedicaoSaidaConfirmada && posExpedicao);
    } catch (eCiclo) {
      if (!schemaMissing(eCiclo)) throw eCiclo;
    }
    const rDono0 = await pool.query(
      `SELECT "CD_DONO" FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdArq, tid]
    );
    const rawD0 = rDono0.rows[0]?.CD_DONO ?? rDono0.rows[0]?.cd_dono;
    const cdDonoEsp = typeof rawD0 === 'number' ? rawD0 : parseInt(rawD0, 10);
    const posExpedicao = !!req._oplPosExpedicao;
    if (!Number.isFinite(cdDonoEsp) && !posExpedicao) {
      return res.status(400).json({
        error:
          'Espelho sem dono do estoque. Associe o dono antes de gravar picking (aba detalhe → Associar dono).',
        code: 'SEM_DONO',
      });
    }
    const rPick = await pool.query(
      `SELECT COUNT(i."CD_OPL_ITEM")::int AS tot,
              COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_pick
         FROM "WMS_OPL_ITEM" i
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $2
        WHERE a."CD_OPL_ARQUIVO" = $1::integer`,
      [cdArq, tid]
    );
    const totIt = Number(rPick.rows[0]?.tot) || 0;
    const comPick = Number(rPick.rows[0]?.com_pick) || 0;
    let temReserva = false;
    try {
      const rRes = await pool.query(
        `SELECT 1 FROM "WMS_RESERVA_ESTOQUE_OPL"
          WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer
          LIMIT 1`,
        [tid, cdArq]
      );
      temReserva = rRes.rowCount > 0;
    } catch (eRes) {
      if (!schemaMissing(eRes)) throw eRes;
    }
    if (totIt > 0 && comPick >= totIt && temReserva) {
      return res.status(409).json({
        error:
          'Não é possível alterar o picking: todos os itens desta importação já têm quantidade coletada gravada e já existe reserva de estoque. A separação neste espelho está encerrada para edição.',
      });
    }
    if (posExpedicao && totIt > 0 && comPick >= totIt) {
      return res.status(409).json({
        error: 'Picking já está concluído neste espelho (todos os itens com quantidade coletada).',
        code: 'PICKING_JA_CONCLUIDO',
      });
    }
    let itens = Array.isArray(req.body?.itens) ? req.body.itens : null;
    // Pós-expedição: se não enviou itens, preenche pendentes com qtd pedida (registro histórico).
    if (posExpedicao && (!itens || !itens.length)) {
      const pend = await pool.query(
        `SELECT i."CD_OPL_ITEM", i."QT_PEDIDA"
           FROM "WMS_OPL_ITEM" i
           JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
           JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $2
          WHERE a."CD_OPL_ARQUIVO" = $1::integer
            AND i."QT_COLETADA" IS NULL`,
        [cdArq, tid]
      );
      itens = pend.rows.map((row) => ({
        cdOplItem: row.CD_OPL_ITEM,
        qtColetada: row.QT_PEDIDA,
        explicito: true,
      }));
    }
    if (!itens || !itens.length) {
      return res.status(400).json({
        error:
          'Envie itens: [{ "cdOplItem", "qtColetada", "explicito": true }, ...]. Na tela, campo em branco = conferido igual à qtd pedida.',
        code: 'SEM_ITENS',
      });
    }
    for (const it of itens) {
      if (it.explicito !== true && it.EXPLICITO !== true) {
        return res.status(400).json({
          error:
            'Cada item do lote deve vir com explicito: true (linha incluída no Salvar picking). Campo em branco na UI envia qtColetada = qtd pedida.',
          code: 'PICKING_NAO_EXPLICITO',
        });
      }
    }
    const pendentesAntes = Math.max(0, totIt - comPick);
    const confirmarEncerramento =
      req.body &&
      (req.body.confirmarEncerramentoEspelho === true || req.body.confirmarEncerramentoEspelho === '1');
    if (!posExpedicao && pendentesAntes > 0 && itens.length >= pendentesAntes && !confirmarEncerramento) {
      return res.status(400).json({
        error:
          'Esta gravação encerra o picking em todos os itens pendentes do espelho. Confirme após conferência física (confirmarEncerramentoEspelho: true).',
        code: 'CONFIRMAR_ENCERRAMENTO',
        pendentes: pendentesAntes,
        enviados: itens.length,
      });
    }
    const client = await pool.connect();
    let atualizados = 0;
    let reservaPayload = null;
    try {
      await client.query('BEGIN');
      for (const it of itens) {
        const cdItem = parseInt(it.cdOplItem ?? it.CD_OPL_ITEM, 10);
        const q = it.qtColetada != null ? it.qtColetada : it.QT_COLETADA;
        if (!Number.isFinite(cdItem)) continue;
        const qt = q != null && String(q).trim() !== '' ? parseFloat(String(q).replace(',', '.')) : null;
        if (qt != null && !Number.isFinite(qt)) {
          const err = new Error(`Quantidade inválida para item ${cdItem}.`);
          err.code = 'VALID';
          throw err;
        }
        let motivoRaw = it.motivoDiverg != null ? it.motivoDiverg : it.MOTIVO_DIVERG;
        if (motivoRaw === undefined) motivoRaw = null;
        let motivo =
          motivoRaw == null || String(motivoRaw).trim() === ''
            ? null
            : String(motivoRaw).trim().toUpperCase().slice(0, 40);
        if (motivo === 'CANCELADO_CLIENTE' && !(qt != null && Math.abs(qt) < 1e-9)) {
          motivo = null;
        }
        if (motivo === 'SUBSTITUIDO' && !(qt != null && Math.abs(qt) < 1e-9)) {
          motivo = null;
        }
        if (qt != null && Math.abs(qt) >= 1e-9 && (motivo === 'CANCELADO_CLIENTE' || motivo === 'SUBSTITUIDO')) {
          motivo = null;
        }
        let rUp;
        try {
          rUp = await client.query(
            `UPDATE "WMS_OPL_ITEM" i
                SET "QT_COLETADA" = $2::numeric,
                    "DADOS_JSON" = CASE
                      WHEN $5::text IS NULL THEN
                        COALESCE(i."DADOS_JSON", '{}'::jsonb) - 'motivoDiverg'
                      ELSE
                        COALESCE(i."DADOS_JSON", '{}'::jsonb)
                          || jsonb_build_object('motivoDiverg', $5::text)
                    END
              WHERE i."CD_OPL_ITEM" = $1::integer
                AND EXISTS (
                  SELECT 1 FROM "WMS_OPL_PEDIDO" p
                  JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
                 WHERE p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
                   AND a."TENANT_ID" = $3
                   AND a."CD_OPL_ARQUIVO" = $4::integer
                )
             RETURNING i."CD_OPL_ITEM"`,
            [cdItem, qt, tid, cdArq, motivo]
          );
        } catch (eUp) {
          /** Schema antigo sem DADOS_JSON no item — grava só a quantidade. */
          if (eUp && (eUp.code === '42703' || eUp.code === '42P01')) {
            rUp = await client.query(
              `UPDATE "WMS_OPL_ITEM" i
                  SET "QT_COLETADA" = $2::numeric
                WHERE i."CD_OPL_ITEM" = $1::integer
                  AND EXISTS (
                    SELECT 1 FROM "WMS_OPL_PEDIDO" p
                    JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
                   WHERE p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
                     AND a."TENANT_ID" = $3
                     AND a."CD_OPL_ARQUIVO" = $4::integer
                  )
               RETURNING i."CD_OPL_ITEM"`,
              [cdItem, qt, tid, cdArq]
            );
          } else {
            throw eUp;
          }
        }
        if (rUp.rowCount) atualizados += rUp.rowCount;
      }
      const rAfter = await client.query(
        `SELECT COUNT(i."CD_OPL_ITEM")::int AS tot,
                COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_pick
           FROM "WMS_OPL_ITEM" i
           JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
           JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $2
          WHERE a."CD_OPL_ARQUIVO" = $1::integer`,
        [cdArq, tid]
      );
      const totAfter = Number(rAfter.rows[0]?.tot) || 0;
      const comAfter = Number(rAfter.rows[0]?.com_pick) || 0;
      // Pós-expedição: só histórico de coleta — estoque já saiu na carga; não reserva de novo.
      if (!posExpedicao && totAfter > 0 && comAfter >= totAfter) {
        const incluirAbertos =
          req.body && (req.body.incluirRecebimentosAbertos === true || req.body.incluirRecebimentosAbertos === '1');
        let valOpts = { incluirRecebimentosAbertos: incluirAbertos };
        const lib = await processarLiberacaoCoberturaPicking(req, tid, cdArq, cdDonoEsp, sg, { db: client });
        if (lib && lib.ok === false) {
          const err = new Error(lib.error);
          err.code = lib.code || 'LIBERACAO';
          err.httpStatus = lib.status;
          throw err;
        }
        const comLiberacao = !!(lib && lib.ok);
        if (comLiberacao) {
          valOpts = {
            incluirRecebimentosAbertos: incluirAbertos,
            ignorarTravaCobertura: true,
            autorizadorLogin: lib.autorizador.login,
            motivoLiberacao: lib.justificativa,
          };
        }
        const val = await validarCoberturaEncerramentoPicking(tid, cdArq, valOpts);
        if (!val.ok) {
          const err = new Error(val.error || 'Cobertura de estoque insuficiente.');
          err.code = val.code || 'COBERTURA_INSUFICIENTE';
          err.detalhes = {
            agregado: val.agregado,
            linhasProblema: val.linhasProblema,
            avisos: val.avisos,
          };
          throw err;
        }
        reservaPayload = await aplicarReservasAoConcluirPickingOpl(client, tid, cdArq, cdDonoEsp, sg, {
          ignorarSaldoInsuficiente: comLiberacao,
        });
      }
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      if (e && e.code === 'VALID') return res.status(400).json({ error: e.message });
      if (e && e.code === 'RESERVA_CONFLITO') {
        return res.status(409).json({ error: e.message, code: 'RESERVA_CONFLITO' });
      }
      if (e && (e.code === 'COBERTURA_INSUFICIENTE' || e.code === 'SEM_DONO')) {
        return res.status(409).json({
          error: e.message,
          code: e.code,
          detalhes: e.detalhes || null,
        });
      }
      if (e && (e.code === 'AUTH' || e.code === 'SEM_PERMISSAO' || e.code === 'JUSTIFICATIVA' || e.code === 'LIBERACAO')) {
        const st =
          e.code === 'SEM_PERMISSAO' ? 403 : e.code === 'AUTH' ? 401 : e.httpStatus || 400;
        return res.status(st).json({
          error: e.message,
          code: e.code,
          programaNecessario: e.code === 'SEM_PERMISSAO' ? PROGRAMA_LIBERAR_COBERTURA_PICKING : undefined,
        });
      }
      throw e;
    } finally {
      client.release();
    }
    res.json({
      ok: true,
      itensAtualizados: atualizados,
      reservaEstoque: reservaPayload,
      posExpedicao: !!posExpedicao,
      aviso: posExpedicao
        ? 'Picking registrado só no espelho (pós-expedição). Estoque/reservas não foram alterados.'
        : undefined,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] salvarPicking:', e);
    res.status(500).json({ error: 'Erro ao salvar picking.' });
  }
}

async function atualizarDonoEspelho(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArq = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cdArq)) return res.status(400).json({ error: 'Código de arquivo inválido.' });
    const cdDono = parseInt(req.body?.CD_DONO ?? req.body?.cd_dono, 10);
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'CD_DONO é obrigatório.' });
    if (!(await assertDonoTenant(tid, cdDono))) {
      return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
    }
    const r = await pool.query(
      `UPDATE "WMS_OPL_ARQUIVO"
          SET "CD_DONO" = $3::integer, "SG_USER" = COALESCE($4, "SG_USER")
        WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2
        RETURNING "CD_OPL_ARQUIVO", "CD_DONO"`,
      [cdArq, tid, cdDono, sg]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'Importação não encontrada.' });
    res.json({ ok: true, cdOplArquivo: r.rows[0].CD_OPL_ARQUIVO, CD_DONO: r.rows[0].CD_DONO });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] atualizarDonoEspelho:', e);
    res.status(500).json({ error: 'Erro ao associar dono ao espelho.' });
  }
}

/** Picking já encerrado sem reserva (ex.: importação antiga sem CD_DONO). */
async function aplicarReservasEspelho(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArq = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cdArq)) return res.status(400).json({ error: 'Código de arquivo inválido.' });
    try {
      const ciclo = await obterStatusCicloOpl(tid, cdArq);
      if (ciclo.expedicaoSaidaConfirmada) {
        return res.status(409).json({
          error:
            'Saída já confirmada na expedição. As reservas deste espelho foram baixadas; não é possível aplicar reserva novamente.',
          code: 'CICLO_ENCERRADO',
          statusCiclo: ciclo,
        });
      }
    } catch (eCiclo) {
      if (!schemaMissing(eCiclo)) throw eCiclo;
    }
    const rDono = await pool.query(
      `SELECT "CD_DONO" FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdArq, tid]
    );
    if (!rDono.rows.length) return res.status(404).json({ error: 'Importação não encontrada.' });
    const rawD = rDono.rows[0]?.CD_DONO ?? rDono.rows[0]?.cd_dono;
    const cdDono = typeof rawD === 'number' ? rawD : parseInt(rawD, 10);
    if (!Number.isFinite(cdDono)) {
      return res.status(400).json({ error: 'Associe o dono do estoque antes de aplicar reservas.', code: 'SEM_DONO' });
    }
    const rPick = await pool.query(
      `SELECT COUNT(i."CD_OPL_ITEM")::int AS tot,
              COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_pick
         FROM "WMS_OPL_ITEM" i
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $2
        WHERE a."CD_OPL_ARQUIVO" = $1::integer`,
      [cdArq, tid]
    );
    const tot = Number(rPick.rows[0]?.tot) || 0;
    const com = Number(rPick.rows[0]?.com_pick) || 0;
    if (tot <= 0 || com < tot) {
      return res.status(409).json({
        error: 'Reserva retroativa só após picking concluído em todos os itens.',
        code: 'PICKING_INCOMPLETO',
      });
    }
    const incluirAbertos =
      req.body && (req.body.incluirRecebimentosAbertos === true || req.body.incluirRecebimentosAbertos === '1');
    let valOpts = { incluirRecebimentosAbertos: incluirAbertos };
    const client = await pool.connect();
    let reservaPayload;
    let comLiberacao = false;
    try {
      await client.query('BEGIN');
      const lib = await processarLiberacaoCoberturaPicking(req, tid, cdArq, cdDono, sg, { db: client });
      if (lib && lib.ok === false) {
        await client.query('ROLLBACK');
        return res.status(lib.status || 400).json({
          error: lib.error,
          code: lib.code,
          programaNecessario: lib.programaNecessario,
        });
      }
      comLiberacao = !!(lib && lib.ok);
      if (comLiberacao) {
        valOpts = {
          incluirRecebimentosAbertos: incluirAbertos,
          ignorarTravaCobertura: true,
          autorizadorLogin: lib.autorizador.login,
          motivoLiberacao: lib.justificativa,
        };
      }
      const val = await validarCoberturaEncerramentoPicking(tid, cdArq, valOpts);
      if (!val.ok) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: val.error,
          code: val.code,
          detalhes: {
            agregado: val.agregado,
            linhasProblema: val.linhasProblema,
            avisos: val.avisos,
          },
        });
      }
      reservaPayload = await aplicarReservasAoConcluirPickingOpl(client, tid, cdArq, cdDono, sg, {
        ignorarSaldoInsuficiente: comLiberacao,
      });
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      if (e && e.code === 'RESERVA_CONFLITO') {
        return res.status(409).json({ error: e.message, code: 'RESERVA_CONFLITO' });
      }
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, reservaEstoque: reservaPayload });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] aplicarReservasEspelho:', e);
    res.status(500).json({ error: 'Erro ao aplicar reservas do espelho.' });
  }
}

async function exportarCoberturaEstoqueOpl(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const formato = String(req.query.formato || 'csv').trim().toLowerCase();
    if (formato !== 'csv') return res.status(400).json({ error: 'Use formato=csv.' });
    const incluirAbertos = queryBool(
      req.query.incluirRecebimentosAbertos ?? req.query.incluir_recebimentos_abertos
    );
    const somenteProblemas = req.query.somenteProblemas !== '0' && req.query.todos !== '1';
    const sim = await simularCoberturaOplArquivo(tid, cd, { incluirRecebimentosAbertos: incluirAbertos });
    if (!sim.ok) return res.status(400).json({ error: sim.erro || 'Simulação indisponível.' });
    const rNm = await pool.query(
      `SELECT "NM_ARQUIVO" FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    const nm = rNm.rows[0]?.NM_ARQUIVO || `opl-${cd}`;
    const csvBody = montarCsvCoberturaOpl(sim, { somenteProblemas, nmArquivo: nm });
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sufixo = somenteProblemas ? 'conferencia-fisica' : 'cobertura-completa';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="wms-opl-${sufixo}-${cd}-${ymd}.csv"`
    );
    return res.send(`\uFEFF${csvBody}`);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] exportarCobertura:', e);
    res.status(500).json({ error: 'Erro ao exportar lista de cobertura.' });
  }
}

async function auditoriaCadastroImportacao(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const data = await carregarImportacaoCompleta(tid, cd);
    if (!data) return res.status(404).json({ error: 'Importação não encontrada.' });
    const cdDono = data.arquivo && data.arquivo.CD_DONO;
    let auditoriaCadastro = await auditarCadastroEspelhoOpl(tid, cdDono, { pedidos: data.pedidos });
    const autoAplicar =
      queryBool(req.query.autoAplicar ?? req.query.auto_aplicar) !== false &&
      auditoriaCadastro?.resumo?.semCadastro > 0;
    if (autoAplicar && sg) {
      const fix = await aplicarCadastroAutomaticoOpl(tid, cd, sg, {});
      if (fix.ok && fix.auditoriaDepois) auditoriaCadastro = fix.auditoriaDepois;
    }
    return res.json({ ok: true, cdOplArquivo: cd, auditoriaCadastro, cadastroAutoAplicado: autoAplicar });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] auditoriaCadastroImportacao:', e);
    res.status(500).json({ error: 'Erro ao auditar cadastro do espelho.' });
  }
}

/** GET — prévia do cadastro automático (cadastro principal + de-para) para conferência. */
async function previewCadastroAutomaticoOpl(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await simularCadastroAutomaticoOpl(tid, cd);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    return res.json(r);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] previewCadastroAutomaticoOpl:', e);
    res.status(500).json({ error: 'Erro ao simular cadastro automático.' });
  }
}

/** POST — aplica cadastro automático após conferência na prévia. */
async function aplicarCadastroAutomaticoOplHandler(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const codigos = Array.isArray(req.body?.codigos) ? req.body.codigos : undefined;
    const r = await aplicarCadastroAutomaticoOpl(tid, cd, sg, { codigos });
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    return res.json(r);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] aplicarCadastroAutomaticoOpl:', e);
    res.status(500).json({ error: 'Erro ao aplicar cadastro automático.' });
  }
}

/** Query ?detalharDestinos=1 — inclui unidades de destino por rota no HTML de impressão (padrão: só totais por rota). */
function parseDetalharDestinosQuery(q) {
  const v = q.detalharDestinos ?? q.expandirDestinos ?? q.detalheDestinos;
  if (v == null || v === '') return false;
  const s = String(v).toLowerCase().trim();
  if (['1', 'true', 'sim', 's', 'yes', 'on'].includes(s)) return true;
  if (['0', 'false', 'nao', 'não', 'n', 'no', 'off'].includes(s)) return false;
  return false;
}

/**
 * POST /wms/separacao/opl/importacoes/:cdOplArquivo/reabrir-picking
 * Supervisor: remove reserva do espelho, mantém QT_COLETADA e libera edição.
 * Após correção, o operador deve Salvar picking de novo (reaplica reservas).
 */
async function reabrirPickingHandler(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdArq = parseInt(req.params.cdOplArquivo, 10);
    if (!Number.isFinite(cdArq) || cdArq <= 0) {
      return res.status(400).json({ error: 'Código de importação inválido.' });
    }

    const justificativa = String(
      req.body?.justificativaLiberacao ??
        req.body?.justificativa_liberacao ??
        req.body?.justificativa ??
        ''
    ).trim();
    if (!justificativa || justificativa.length < 10) {
      return res.status(400).json({
        error: 'Informe justificativa para reabrir o picking (mínimo 10 caracteres).',
        code: 'JUSTIFICATIVA',
      });
    }
    const autorizadoLogin = String(req.body?.autorizadoLogin ?? req.body?.autorizado_login ?? '').trim();
    const autorizadoSenha = String(req.body?.autorizadoSenha ?? req.body?.autorizado_senha ?? '');
    if (!autorizadoLogin) {
      return res.status(400).json({ error: 'Informe o usuário autorizador.', code: 'AUTH' });
    }
    const auth = await validarAutorizadorComSenha(autorizadoLogin, autorizadoSenha, tid);
    if (!auth.ok) {
      return res.status(401).json({ error: auth.error || 'Autorização inválida.', code: 'AUTH' });
    }
    const pode = await usuarioPodeLiberarCoberturaPicking(auth.usuario.login, tid);
    if (!pode) {
      return res.status(403).json({
        error:
          'Usuário autorizador sem permissão para reabrir picking OPL. Necessário programa wms-separacao-liberar-cobertura-picking.',
        code: 'SEM_PERMISSAO',
        programaNecessario: PROGRAMA_LIBERAR_COBERTURA_PICKING,
      });
    }

    const rArq = await pool.query(
      `SELECT "CD_OPL_ARQUIVO", "CD_DONO", "NM_ARQUIVO"
         FROM "WMS_OPL_ARQUIVO"
        WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdArq, tid]
    );
    if (!rArq.rowCount) {
      return res.status(404).json({ error: 'Importação OPL não encontrada.' });
    }
    const rawDono = rArq.rows[0].CD_DONO ?? rArq.rows[0].cd_dono;
    const cdDono = typeof rawDono === 'number' ? rawDono : parseInt(rawDono, 10);

    let ciclo;
    try {
      ciclo = await obterStatusCicloOpl(tid, cdArq, pool);
    } catch (eCiclo) {
      if (!schemaMissing(eCiclo)) throw eCiclo;
      ciclo = { expedicaoSaidaConfirmada: false };
    }
    if (ciclo && ciclo.expedicaoSaidaConfirmada) {
      return res.status(409).json({
        error:
          'Não é possível reabrir o picking: a saída já foi confirmada na expedição. Use o fluxo de reabrir expedição se precisar estornar a carga.',
        code: 'CICLO_ENCERRADO',
        statusCiclo: ciclo,
      });
    }

    let reservasAntes = [];
    try {
      reservasAntes = await listarReservasPorOplArquivo(pool, tid, cdArq);
    } catch (eRes) {
      if (!schemaMissing(eRes)) throw eRes;
    }
    if (!reservasAntes.length) {
      return res.status(400).json({
        error:
          'Não há reserva ativa neste espelho. A edição do picking já está liberada (ou o picking ainda não foi concluído com reserva).',
        code: 'SEM_RESERVA',
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rem = await removerReservasOplArquivo(client, tid, cdArq);
      const resumoJson = {
        acao: 'REABRIR_PICKING',
        reservasRemovidas: rem.removidos,
        skus: reservasAntes.map((r) => ({
          cdProduto: r.CD_PRODUTO ?? r.cd_produto,
          qtd: r.QTD_RESERVADA ?? r.qtd_reservada,
        })),
      };
      try {
        await client.query(
          `INSERT INTO "WMS_OPL_LIBERACAO_COBERTURA"
            ("CD_OPL_ARQUIVO","TENANT_ID","CD_DONO","SG_USER","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","INCLUIU_RECEB_ABERTOS","RESUMO_JSON")
           VALUES ($1::integer,$2,$3::integer,$4,$5,$6,$7,'N',$8::jsonb)`,
          [
            cdArq,
            tid,
            Number.isFinite(cdDono) ? cdDono : null,
            sg,
            auth.usuario.login,
            auth.usuario.nome || auth.usuario.login,
            `[REABRIR_PICKING] ${justificativa}`,
            JSON.stringify(resumoJson),
          ]
        );
      } catch (eIns) {
        if (!schemaMissing(eIns)) throw eIns;
      }
      await client.query('COMMIT');
      return res.json({
        ok: true,
        cdOplArquivo: cdArq,
        reservasRemovidas: rem.removidos,
        autorizador: { login: auth.usuario.login, nome: auth.usuario.nome || auth.usuario.login },
        mensagem:
          'Picking reaberto: reservas removidas. Corrija as quantidades e use «Salvar picking» para gravar de novo e reaplicar as reservas.',
      });
    } catch (eTx) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      throw eTx;
    } finally {
      client.release();
    }
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] reabrirPicking:', e);
    res.status(500).json({ error: e.message || 'Erro ao reabrir picking.' });
  }
}

/**
 * POST /wms/separacao/opl/corrigir-picking-indevido
 * Migração única: zera QT_COLETADA onde = QT_PEDIDA e remove reservas OPL fantasmas.
 * Exige permissão wms-separacao-liberar-cobertura-picking (supervisor).
 */
async function corrigirPickingIndevidoHandler(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const login = String(req.body?.autorizadoLogin || sg || '').trim();
    if (!(await usuarioPodeLiberarCoberturaPicking(login, tid))) {
      return res.status(403).json({
        error: 'Sem permissão. Necessário programa wms-separacao-liberar-cobertura-picking.',
        programaNecessario: PROGRAMA_LIBERAR_COBERTURA_PICKING,
      });
    }
    const desde = trimQuery(req.body?.desde) || '2026-05-18';
    const dryRun = req.body?.dryRun === true || req.body?.dryRun === '1';
    const resumo = await corrigirPickingIndevidoOpl(tid, {
      desde,
      dryRun,
      removerReservas: req.body?.removerReservas !== false && req.body?.removerReservas !== '0',
    });
    return res.json(resumo);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] corrigirPickingIndevido:', e);
    res.status(500).json({ error: e.message || 'Erro ao corrigir picking indevido.' });
  }
}

/** GET /wms/separacao/opl/programacao-antecipada — peso/volume estimado por data de entrega (antes da NF-e). */
async function programacaoAntecipadaOpl(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const q = req.query || {};
    const r = await montarProgramacaoAntecipadaOpl(tid, q);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    const fmt = String(q.formato || q.format || '').toLowerCase();
    if (fmt === 'html') {
      const tipo = String(q.tipo || q.tipoRelatorio || q.relatorio || 'resumo')
        .toLowerCase()
        .trim();
      const detalharDestinos = parseDetalharDestinosQuery(q);
      const cRaw = String(q.conservacao || 'todos').toLowerCase().trim();
      const conservacaoValidos = new Set(['todos', 'refri', 'seco', 'refrigerado', 'congelado']);
      const conservacao = conservacaoValidos.has(cRaw) ? cRaw : 'todos';
      const html =
        tipo === 'geral' || tipo === 'listagem' || tipo === 'produtos'
          ? buildProgramacaoListagemGeralHtml({ ...r, conservacao })
          : buildProgramacaoAntecipadaHtml({ ...r, detalharDestinos, conservacao });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    res.json(r);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] programacaoAntecipadaOpl:', e);
    res.status(500).json({ error: 'Erro ao montar programação antecipada.' });
  }
}

async function validarPedidosEntreArquivosHandler(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });

    const ids = parseIdsArquivos(
      req.query.cdOplArquivos ?? req.query.ids ?? req.body?.cdOplArquivos ?? req.body?.ids
    );
    const modo = String(req.query.modo || req.body?.modo || 'entre').trim().toLowerCase();
    const formato = String(req.query.formato || 'json').trim().toLowerCase();

    const resultado =
      modo === 'historico' || modo === 'contra-historico'
        ? await validarPedidosContraHistorico(tid, ids)
        : await validarPedidosEntreArquivos(tid, ids);

    if (formato === 'csv') {
      const csv = linhasValidacaoParaCsv(resultado);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="validacao-pedidos-opl-${resultado.modo.toLowerCase()}.csv"`
      );
      return res.send('\uFEFF' + csv);
    }
    if (formato === 'html') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(buildValidacaoPedidosHtml(resultado));
    }
    return res.json(resultado);
  } catch (e) {
    if (e && e.code === 'VALID') return res.status(400).json({ error: e.message });
    if (schemaMissing(e) || schemaMissingValidPed(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de separação ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.',
      });
    }
    console.error('[WMS separação] validarPedidosEntreArquivos:', e);
    return res.status(500).json({ error: 'Erro ao validar pedidos entre arquivos OPL.' });
  }
}

module.exports = {
  uploadOpl: upload.single('arquivo'),
  importarOplTxt,
  listarImportacoes,
  buscarImportacao,
  programacaoAntecipadaOpl,
  auditoriaCadastroImportacao,
  previewCadastroAutomaticoOpl,
  aplicarCadastroAutomaticoOplHandler,
  exportarCoberturaEstoqueOpl,
  romaneioSeparacaoHtml,
  excluirImportacao,
  salvarPicking,
  substituirItemPicking,
  atualizarDonoEspelho,
  aplicarReservasEspelho,
  reabrirPickingHandler,
  corrigirPickingIndevidoHandler,
  validarPedidosEntreArquivosHandler,
};
