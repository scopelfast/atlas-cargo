'use strict';

const { pool } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const {
  validarCargaProgramada,
  persistirValidacao,
  carregarSnapshotValidacao,
  listarSanacoesValidacao,
  separarDivergenciasEConferencias,
} = require('../services/wms-carga-validacao.service');
const {
  validarEstoqueOplParaExpedicao,
  anexarValidacaoEstoqueNaCarga,
} = require('../services/wms-carga-estoque-expedicao.service');
const {
  validarAutorizadorComSenha,
  usuarioTemPrograma,
} = require('../utils/wms-supervisor-auth');
const {
  liberarReservasOplPorCargaExpedida,
  reaplicarReservasOplCargaReaberta,
} = require('../services/wms-opl-reserva-picking.service');
const {
  registrarSaidaExpedicaoCarga,
  estornarSaidaExpedicaoCarga,
  sincronizarMovimentosExpedicaoSaidaCarga,
  sincronizarMovimentosExpedicaoSaidaTodasCargas,
} = require('../services/wms-movimento-estoque.service');
const { sincronizarDonoUnicoNaCargaSeAplicavel } = require('../services/wms-carga-dono-carga.service');
const {
  buildDivergenciasExpedicaoHtml,
  buildDivergenciasExpedicaoCsv,
  buildDivergenciasExpedicaoSkuCsv,
} = require('../services/wms-expedicao-divergencias-html.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Cache curto da validação pesada (evita reprocessar a cada clique na mesma carga). */
const validacaoExpedicaoCache = new Map();
const VALIDACAO_EXP_CACHE_MS = 180_000;

function chaveCacheValidacaoExp(tid, cdCarga) {
  return `${tid}:${cdCarga}`;
}

function invalidarCacheValidacaoExp(tid, cdCarga) {
  if (cdCarga != null) validacaoExpedicaoCache.delete(chaveCacheValidacaoExp(tid, cdCarga));
}

async function montarValidacaoExpedicaoCarga(tid, cd, cargaRow, { usarCache = true } = {}) {
  const cacheKey = chaveCacheValidacaoExp(tid, cd);
  if (usarCache) {
    const hit = validacaoExpedicaoCache.get(cacheKey);
    if (hit && Date.now() - hit.t < VALIDACAO_EXP_CACHE_MS) {
      return { ...hit.v };
    }
  }

  const stExp = String(cargaRow?.ST_EXPEDICAO || 'PRONTA_EXPEDICAO').toUpperCase();
  const [estRes, valRes] = await Promise.allSettled([
    validarEstoqueOplParaExpedicao(tid, cd).catch((e) => {
      if (schemaMissing(e)) return null;
      throw e;
    }),
    validarCargaProgramada(tid, cd, { persist: false }).catch((e) => {
      if (schemaMissing(e)) return null;
      throw e;
    }),
  ]);

  let validacaoEstoque = null;
  if (estRes.status === 'fulfilled') {
    validacaoEstoque = estRes.value;
    if (validacaoEstoque && stExp === 'EXPEDIDA') {
      validacaoEstoque = { ...validacaoEstoque, cargaExpedida: true };
    }
  } else if (!schemaMissing(estRes.reason)) {
    throw estRes.reason;
  }

  let validacao = null;
  if (valRes.status === 'fulfilled') {
    validacao = valRes.value;
    if (validacao && validacaoEstoque) {
      validacao = anexarValidacaoEstoqueNaCarga(validacao, validacaoEstoque);
    }
  } else if (!schemaMissing(valRes.reason)) {
    throw valRes.reason;
  }

  if (validacao && stExp === 'EXPEDIDA') {
    try {
      const snap = await carregarSnapshotValidacao(tid, cd, ['SAIDA', 'INICIO_EXPEDICAO', 'VALIDACAO']);
      const sanacoes = await listarSanacoesValidacao(tid, cd, 10);
      if (snap) {
        const payload = snap.cabecalho.PAYLOAD_JSON;
        let divergenciasSnap = [];
        if (payload && Array.isArray(payload.divergencias)) {
          divergenciasSnap = payload.divergencias;
        } else {
          divergenciasSnap = (snap.itens || []).map((it) => ({
            tipo: it.TP_DIVERGENCIA,
            severidade: it.SEVERIDADE,
            pedido: it.NR_PEDIDO,
            codigo: it.COD_PRODUTO,
            descricao: it.DS_PRODUTO,
            unidadePedido: it.UNIDADE_PEDIDO,
            unidadeNf: it.UNIDADE_NF,
            qtdPedido: it.QTD_PEDIDO,
            qtdNf: it.QTD_NF,
            qtdDif: it.QTD_DIF,
          }));
        }
        const sep = separarDivergenciasEConferencias(divergenciasSnap);
        validacao = {
          ...validacao,
          snapshotSaida: {
            momento: snap.cabecalho.TP_MOMENTO || 'VALIDACAO',
            geradoEm: snap.cabecalho.GERADO_EM,
            cdValidacao: snap.cabecalho.CD_VALIDACAO,
            status: snap.cabecalho.ST_VALIDACAO,
            divergencias: sep.divergencias,
            contadores: {
              faltas: snap.cabecalho.QT_FALTAS,
              sobras: snap.cabecalho.QT_SOBRAS,
              inversoes: snap.cabecalho.QT_INVERSOES,
              semPedido: snap.cabecalho.QT_SEM_PEDIDO,
              semNf: snap.cabecalho.QT_SEM_NF,
            },
          },
          sanacoes: sanacoes.map((s) => ({
            cdValidacao: s.CD_VALIDACAO,
            geradoEm: s.GERADO_EM,
            sgUser: s.SG_USER,
            dsEvento: s.DS_EVENTO,
            payload: s.PAYLOAD_JSON,
          })),
          // Painel de carga expedida: mostra o que valia na saída (auditoria).
          divergencias: sep.divergencias,
          status: snap.cabecalho.ST_VALIDACAO,
          fonteSnapshot: true,
          validacaoAoVivo: {
            status: validacao.status,
            divergencias: validacao.divergencias,
            contadores: validacao.contadores,
          },
        };
      } else if (sanacoes.length) {
        validacao = {
          ...validacao,
          sanacoes: sanacoes.map((s) => ({
            cdValidacao: s.CD_VALIDACAO,
            geradoEm: s.GERADO_EM,
            sgUser: s.SG_USER,
            dsEvento: s.DS_EVENTO,
            payload: s.PAYLOAD_JSON,
          })),
        };
      }
    } catch (eSnap) {
      if (!schemaMissing(eSnap) && !(eSnap && eSnap.code === '42703')) {
        console.warn('[WMS expedicao] snapshot/sanacao:', eSnap.message || eSnap);
      }
    }
  }

  const resultado = { validacaoEstoque, validacao };
  if (usarCache) {
    validacaoExpedicaoCache.set(cacheKey, { t: Date.now(), v: resultado });
  }
  return resultado;
}

function respostaBloqueioEstoque(estoque) {
  const bloqueios = (estoque && estoque.bloqueios) || [];
  const msg =
    bloqueios.map((b) => b.mensagem).filter(Boolean).join(' ') ||
    'Bloqueio de estoque: reserva OPL, dono ou picking incompleto.';
  return {
    error: msg,
    code: 'BLOQUEIO_ESTOQUE',
    errorKey: 'wms.expedicao.bloqueioEstoque',
    validacaoEstoque: estoque,
    bloqueios,
  };
}

function resumirDivergencias(validacao, limite = 5) {
  const itens = Array.isArray(validacao?.divergencias) ? validacao.divergencias : [];
  return itens.slice(0, limite).map((d) => ({
    tipo: d.tipo,
    pedido: d.pedido || null,
    codigo: d.codigo || null,
    descricao: d.descricao || null,
    qtdPedido: d.qtdPedido,
    qtdNf: d.qtdNf,
    qtdDif: d.qtdDif,
  }));
}

/** Valida supervisor + justificativa para liberar expedição com pendências (NF e/ou estoque/OPL). */
async function validarAutorizacaoLiberacaoExpedicao({
  forcarComDivergencia,
  justificativaBloqueio,
  autorizadoLogin,
  autorizadoSenha,
  tenantId,
}) {
  if (!forcarComDivergencia) {
    return { ok: true, autorizador: null };
  }
  if (!justificativaBloqueio || justificativaBloqueio.length < 10) {
    return {
      ok: false,
      status: 400,
      body: {
        error:
          'Para liberar com pendências, informe justificativaBloqueio (mínimo 10 caracteres).',
        errorKey: 'wms.expedicao.justificativaObrigatoria',
      },
    };
  }
  if (!autorizadoLogin) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Para liberar com pendências, informe o usuário autorizador.',
        errorKey: 'wms.expedicao.autorizadoLoginObrigatorio',
      },
    };
  }
  const autorizador = await validarAutorizadorComSenha(
    autorizadoLogin,
    autorizadoSenha,
    tenantId
  );
  if (!autorizador.ok) {
    return {
      ok: false,
      status: 401,
      body: {
        error: autorizador.error,
        errorKey: 'wms.expedicao.autorizadorInvalido',
      },
    };
  }
  const pode = await usuarioPodeLiberarDivergencia(autorizador.usuario.login, tenantId);
  if (!pode) {
    return {
      ok: false,
      status: 403,
      body: {
        error: 'Sem permissão para liberar expedição com divergência.',
        errorKey: 'wms.expedicao.semPermissaoLiberacao',
        programaNecessario: PROGRAMA_LIBERAR_DIVERGENCIA,
      },
    };
  }
  return { ok: true, autorizador };
}

function parseLiberacaoTemBypassEstoque(divergenciasJson) {
  if (divergenciasJson == null || divergenciasJson === '') return false;
  let obj = divergenciasJson;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch (_) {
      return false;
    }
  }
  if (obj && obj.liberadoComEstoquePendente === true) return true;
  if (obj && Array.isArray(obj.bloqueiosEstoque) && obj.bloqueiosEstoque.length > 0) return true;
  /** Liberações antigas/mistas (só NF) também autorizam avançar a expedição. */
  if (obj && obj.liberadoComNfPendente === true) return true;
  if (obj && Array.isArray(obj.divergenciasNf) && obj.divergenciasNf.length > 0) return true;
  return false;
}

async function cargaTemBypassEstoqueAprovado(tid, cd) {
  try {
    const r = await pool.query(
      `SELECT "CD_LIBERACAO", "DIVERGENCIAS_JSON"
         FROM "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA"
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2
        ORDER BY "DH_LIBERACAO" DESC
        LIMIT 10`,
      [cd, tid]
    );
    const rows = r.rows || [];
    if (!rows.length) return false;
    /** Qualquer liberação de supervisor na carga autoriza confirmar saída com estoque/OPL pendente. */
    if (rows.some((row) => parseLiberacaoTemBypassEstoque(row.DIVERGENCIAS_JSON))) return true;
    return true;
  } catch (e) {
    if (schemaMissing(e)) return false;
    throw e;
  }
}

const PROGRAMA_LIBERAR_DIVERGENCIA = 'wms-expedicao-liberar-divergencia';
const PROGRAMA_REABRIR_EXPEDICAO = 'wms-expedicao-reabrir';

async function usuarioPodeLiberarDivergencia(login, tenantId) {
  return usuarioTemPrograma(login, tenantId, PROGRAMA_LIBERAR_DIVERGENCIA);
}

async function usuarioPodeReabrirExpedicao(login, tenantId) {
  if (await usuarioTemPrograma(login, tenantId, PROGRAMA_REABRIR_EXPEDICAO)) return true;
  return usuarioPodeLiberarDivergencia(login, tenantId);
}

async function listarCargas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const st = String(req.query.status || '').trim().toUpperCase();
    const where = [`c."TENANT_ID" = $1`];
    const params = [tid];
    if (st) {
      params.push(st);
      where.push(`COALESCE(e."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') = $${params.length}`);
    }
    const r = await pool.query(
      `SELECT c."CD_CARGA", c."NM_DESCRICAO", c."ST_CARGA", c."DH_CRIACAO",
              COALESCE(x.q_nfes, 0)::integer AS "Q_NFES",
              e."ST_EXPEDICAO", e."DH_INICIO", e."DH_SAIDA", e."NM_CONFERENTE", e."NM_MOTORISTA", e."PLACA"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN (
           SELECT "CD_CARGA", COUNT(*)::integer AS q_nfes
             FROM "WMS_CARGA_PROGRAMADA_NFE"
            GROUP BY "CD_CARGA"
         ) x ON x."CD_CARGA" = c."CD_CARGA"
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e
           ON e."CD_CARGA" = c."CD_CARGA"
          AND e."TENANT_ID" = c."TENANT_ID"
        WHERE ${where.join(' AND ')}
        ORDER BY c."DH_CRIACAO" DESC
        LIMIT 300`,
      params
    );
    res.json(r.rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] listarCargas:', e);
    res.status(500).json({ error: 'Erro ao listar cargas para expedição.' });
  }
}

async function detalharCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await pool.query(
      `SELECT c.*,
              e."ST_EXPEDICAO", e."DH_INICIO", e."DH_SAIDA", e."NM_CONFERENTE", e."OBS",
              e."NM_MOTORISTA" AS "NM_MOTORISTA_EXPEDICAO",
              e."PLACA" AS "PLACA_EXPEDICAO"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e
           ON e."CD_CARGA" = c."CD_CARGA"
          AND e."TENANT_ID" = c."TENANT_ID"
        WHERE c."CD_CARGA" = $1::integer
          AND c."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Carga não encontrada.' });
    const cargaRow = r.rows[0];
    const exM = cargaRow.NM_MOTORISTA_EXPEDICAO != null ? String(cargaRow.NM_MOTORISTA_EXPEDICAO).trim() : '';
    const exP = cargaRow.PLACA_EXPEDICAO != null ? String(cargaRow.PLACA_EXPEDICAO).trim() : '';
    if (exM) cargaRow.NM_MOTORISTA = exM;
    if (exP) cargaRow.PLACA = exP;
    delete cargaRow.NM_MOTORISTA_EXPEDICAO;
    delete cargaRow.PLACA_EXPEDICAO;
    const rN = await pool.query(
      `SELECT j."ORDEM", n."CD_NFE_SAIDA", n."CD_DONO", n."CHAVE_NFE", n."NUMERO_NF", n."SERIE", n."DH_EMISSAO",
              n."XNOME_ENTREGA", n."XNOME_DEST", n."CNPJ_ENTREGA", n."CNPJ_DEST",
              n."XLGR_DEST", n."NRO_DEST", n."XMUN_DEST", n."UF_DEST", n."Q_ITENS", n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2
        ORDER BY j."ORDEM", n."CD_NFE_SAIDA"`,
      [cd, tid]
    );
    let donosCarga = [];
    try {
      const rD = await pool.query(
        `SELECT DISTINCT n."CD_DONO",
                COALESCE(NULLIF(TRIM(d."NOME"), ''), 'Dono #' || n."CD_DONO"::text) AS "NM_DONO",
                NULLIF(TRIM(d."MASCARA_CODIGO_PRODUTO"), '') AS "MASCARA_CODIGO_PRODUTO"
           FROM "WMS_CARGA_PROGRAMADA_NFE" j
           JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = n."TENANT_ID"
          WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
            AND n."CD_DONO" IS NOT NULL
       ORDER BY "NM_DONO", n."CD_DONO"`,
        [cd, tid]
      );
      donosCarga = rD.rows;
    } catch (e2) {
      if (!schemaMissing(e2)) throw e2;
    }
    let liberacoesDivergencia = [];
    try {
      const rL = await pool.query(
        `SELECT "CD_LIBERACAO","DH_LIBERACAO","SG_USER","AUTORIZADO_POR","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","DIVERGENCIAS_JSON"
           FROM "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA"
          WHERE "CD_CARGA" = $1::integer
            AND "TENANT_ID" = $2
       ORDER BY "DH_LIBERACAO" DESC, "CD_LIBERACAO" DESC
          LIMIT 20`,
        [cd, tid]
      );
      liberacoesDivergencia = rL.rows;
    } catch (e3) {
      if (!schemaMissing(e3)) throw e3;
    }
    const permissaoLiberacaoDivergencia = await usuarioPodeLiberarDivergencia(sg, tid);
    const permissaoReabrirExpedicao = await usuarioPodeReabrirExpedicao(sg, tid);
    const rapido = String(req.query.rapido || '') === '1';
    let validacaoEstoque = null;
    let validacao = null;
    if (!rapido) {
      const val = await montarValidacaoExpedicaoCarga(tid, cd, cargaRow);
      validacaoEstoque = val.validacaoEstoque;
      validacao = val.validacao;
    }
    res.json({
      carga: cargaRow,
      nfes: rN.rows,
      donosCarga,
      permissaoLiberacaoDivergencia,
      permissaoReabrirExpedicao,
      liberacoesDivergencia,
      expedicaoLiberadaComEstoquePendente:
        liberacoesDivergencia.length > 0 ||
        liberacoesDivergencia.some((row) => parseLiberacaoTemBypassEstoque(row.DIVERGENCIAS_JSON)),
      validacaoEstoque,
      validacao,
      validacaoPendente: rapido,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] detalharCarga:', e.message || e, e.stack);
    res.status(500).json({
      error: 'Erro ao detalhar carga para expedição.',
      detalhe: process.env.NODE_ENV !== 'production' ? String(e.message || e) : undefined,
    });
  }
}

/** Validação NF × OPL e estoque (carrega após o detalhe rápido). */
async function detalharValidacaoCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const r = await pool.query(
      `SELECT COALESCE(e."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') AS "ST_EXPEDICAO"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e
           ON e."CD_CARGA" = c."CD_CARGA"
          AND e."TENANT_ID" = c."TENANT_ID"
        WHERE c."CD_CARGA" = $1::integer
          AND c."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Carga não encontrada.' });
    const refresh = String(req.query.refresh || '') === '1';
    if (refresh) invalidarCacheValidacaoExp(tid, cd);
    const { validacaoEstoque, validacao } = await montarValidacaoExpedicaoCarga(
      tid,
      cd,
      r.rows[0],
      { usarCache: !refresh }
    );
    return res.json({ validacao, validacaoEstoque });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] detalharValidacaoCarga:', e.message || e, e.stack);
    return res.status(500).json({ error: 'Erro ao validar carga para expedição.' });
  }
}

async function iniciarExpedicao(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cd = parseInt(req.params.cdCarga, 10);
  if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
  const conf = String(req.body.NM_CONFERENTE || req.body.nmConferente || '').trim().slice(0, 120);
  const motorista = String(req.body.NM_MOTORISTA || req.body.nmMotorista || '').trim().slice(0, 120);
  const placa = String(req.body.PLACA || req.body.placa || '').trim().toUpperCase().slice(0, 10);
  if (!conf) {
    return res.status(400).json({ error: 'Informe o conferente para iniciar a expedição.' });
  }
  if (!motorista) {
    return res.status(400).json({ error: 'Informe o motorista para iniciar a expedição.' });
  }
  if (!placa) {
    return res.status(400).json({ error: 'Informe a placa para iniciar a expedição.' });
  }
  const forcarComDivergencia =
    req.body?.forcarComDivergencia === true ||
    req.body?.forcarComDivergencia === 'true' ||
    req.body?.forcar_com_divergencia === true ||
    req.body?.forcar_com_divergencia === 'true';
  const justificativaBloqueio = String(
    req.body?.justificativaBloqueio ?? req.body?.justificativa_bloqueio ?? ''
  )
    .trim()
    .slice(0, 1000);
  const autorizadoLogin = String(req.body?.autorizadoLogin ?? req.body?.autorizado_login ?? '')
    .trim()
    .slice(0, 50);
  const autorizadoSenha = String(req.body?.autorizadoSenha ?? req.body?.autorizado_senha ?? '');
  let validacao;
  try {
    validacao = await validarCargaProgramada(tid, cd, {
      persist: true,
      sgUser: sg,
      momento: 'INICIO_EXPEDICAO',
    });
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    return res.status(503).json({
      error:
        'Estrutura de validação/separação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
    });
  }
  try {
    await sincronizarDonoUnicoNaCargaSeAplicavel(tid, cd);
  } catch (eSync) {
    if (!schemaMissing(eSync)) throw eSync;
  }
  let estoque;
  try {
    estoque = await validarEstoqueOplParaExpedicao(tid, cd);
  } catch (eEst) {
    if (!schemaMissing(eEst)) throw eEst;
    return res.status(503).json({
      error: 'Estrutura WMS de estoque/OPL ausente para validar expedição.',
    });
  }
  if (!estoque.ok && !forcarComDivergencia) {
    return res.status(409).json(respostaBloqueioEstoque(estoque));
  }

  const divsNf = (validacao.divergencias || []).filter(
    (d) =>
      !d.bloqueioEstoque && String(d.severidade || 'BLOQUEIO').toUpperCase() !== 'AVISO'
  );
  const podeExpedirNf = divsNf.length === 0;
  const podeExpedirEstoque = estoque.ok;
  const bloqueioTotal = !podeExpedirNf || !podeExpedirEstoque;

  if (!podeExpedirNf && !forcarComDivergencia) {
    const exemplos = resumirDivergencias({ divergencias: divsNf }, 3);
    return res.status(422).json({
      error: 'Carga com divergências de validação. Corrija antes de iniciar a expedição.',
      errorKey: 'wms.expedicao.divergenciaBloqueante',
      resumo: {
        status: validacao.status,
        contadores: validacao.contadores,
        exemplos,
      },
      validacao,
    });
  }

  let autorizador = null;
  if (bloqueioTotal && forcarComDivergencia) {
    const auth = await validarAutorizacaoLiberacaoExpedicao({
      forcarComDivergencia,
      justificativaBloqueio,
      autorizadoLogin,
      autorizadoSenha,
      tenantId: tid,
    });
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }
    autorizador = auth.autorizador;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chk = await client.query(
      `SELECT 1 FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!chk.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carga não encontrada.' });
    }
    const exAtual = await client.query(
      `SELECT "ST_EXPEDICAO" FROM "WMS_EXPEDICAO_CARGA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (exAtual.rowCount) {
      const st = String(exAtual.rows[0].ST_EXPEDICAO || '').toUpperCase();
      if (st === 'EXPEDIDA') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Esta carga já foi expedida. Não é possível iniciar a expedição novamente.',
        });
      }
      if (st === 'EM_EXPEDICAO') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Expedição já em andamento. Use "Confirmar saída" quando a carga estiver pronta para sair.',
        });
      }
    }
    const r = await client.query(
      `INSERT INTO "WMS_EXPEDICAO_CARGA" ("CD_CARGA", "TENANT_ID", "ST_EXPEDICAO", "DH_INICIO", "NM_CONFERENTE", "NM_MOTORISTA", "PLACA", "SG_USER")
       VALUES ($1::integer, $2, 'EM_EXPEDICAO', CURRENT_TIMESTAMP, $3, $4, $5, $6)
       ON CONFLICT ("CD_CARGA") DO UPDATE
         SET "ST_EXPEDICAO" = 'EM_EXPEDICAO',
             "DH_INICIO" = COALESCE("WMS_EXPEDICAO_CARGA"."DH_INICIO", CURRENT_TIMESTAMP),
             "NM_CONFERENTE" = COALESCE(NULLIF(EXCLUDED."NM_CONFERENTE", ''), "WMS_EXPEDICAO_CARGA"."NM_CONFERENTE"),
             "NM_MOTORISTA" = COALESCE(NULLIF(EXCLUDED."NM_MOTORISTA", ''), "WMS_EXPEDICAO_CARGA"."NM_MOTORISTA"),
             "PLACA" = COALESCE(NULLIF(EXCLUDED."PLACA", ''), "WMS_EXPEDICAO_CARGA"."PLACA"),
             "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
             "SG_USER" = EXCLUDED."SG_USER"
       RETURNING *`,
      [cd, tid, conf, motorista, placa, sg]
    );
    if (bloqueioTotal && forcarComDivergencia) {
      const detalhesNf = resumirDivergencias({ divergencias: divsNf }, 10);
      const bloqueiosEst = (estoque.bloqueios || []).map((b) => ({
        code: b.code,
        mensagem: b.mensagem,
      }));
      const autorizadoNome = autorizador && autorizador.usuario ? autorizador.usuario.nome : autorizadoLogin;
      const autorizadoRef = autorizador && autorizador.usuario ? autorizador.usuario.login : autorizadoLogin;
      const obs = `Liberado com pendencias por ${autorizadoNome} (${autorizadoRef}). Justificativa: ${justificativaBloqueio}. NF: ${JSON.stringify(detalhesNf)}. Estoque/OPL: ${JSON.stringify(bloqueiosEst)}`;
      await client.query(
        `UPDATE "WMS_EXPEDICAO_CARGA"
            SET "OBS" = COALESCE(NULLIF(TRIM(COALESCE("OBS", '')), '' ) || E'\n', '') || $3
          WHERE "CD_CARGA" = $1::integer
            AND "TENANT_ID" = $2`,
        [cd, tid, obs]
      );
      try {
        await client.query(
          `INSERT INTO "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA"
            ("CD_CARGA","TENANT_ID","SG_USER","AUTORIZADO_POR","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","DIVERGENCIAS_JSON")
           VALUES ($1::integer,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            cd,
            tid,
            sg,
            autorizadoNome,
            autorizadoRef,
            autorizadoNome,
            justificativaBloqueio,
            JSON.stringify({
              divergenciasNf: validacao.divergencias || [],
              bloqueiosEstoque: estoque.bloqueios || [],
              liberadoComEstoquePendente: !podeExpedirEstoque,
              liberadoComNfPendente: !podeExpedirNf,
            }),
          ]
        );
      } catch (eIns) {
        if (!schemaMissing(eIns)) throw eIns;
      }
    }
    await client.query(
      `UPDATE "WMS_CARGA_PROGRAMADA"
          SET "ST_CARGA" = 'EM_EXPEDICAO',
              "SG_USER" = $3,
              "NM_MOTORISTA" = COALESCE(NULLIF(TRIM($4::text), ''), "NM_MOTORISTA"),
              "PLACA" = COALESCE(NULLIF(TRIM($5::text), ''), "PLACA")
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2`,
      [cd, tid, sg, motorista, placa]
    );
    await client.query('COMMIT');
    res.json(r.rows[0]);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] iniciarExpedicao:', e);
    res.status(500).json({ error: 'Erro ao iniciar expedição.' });
  } finally {
    client.release();
  }
}

async function confirmarSaida(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cd = parseInt(req.params.cdCarga, 10);
  if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
  try {
    await sincronizarDonoUnicoNaCargaSeAplicavel(tid, cd);
  } catch (eSync) {
    if (!schemaMissing(eSync)) throw eSync;
  }
  let estoqueSaida;
  try {
    estoqueSaida = await validarEstoqueOplParaExpedicao(tid, cd);
  } catch (eEst) {
    if (!schemaMissing(eEst)) throw eEst;
    return res.status(503).json({
      error: 'Estrutura WMS de estoque/OPL ausente para confirmar saída.',
    });
  }

  let validacaoSaida = null;
  try {
    validacaoSaida = await validarCargaProgramada(tid, cd, { persist: false, sgUser: sg });
  } catch (eVal) {
    if (!schemaMissing(eVal)) throw eVal;
    return res.status(503).json({
      error:
        'Estrutura de validação/separação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
    });
  }

  const forcarComDivergencia =
    req.body?.forcarComDivergencia === true ||
    req.body?.forcarComDivergencia === 'true' ||
    req.body?.forcar_com_divergencia === true ||
    req.body?.forcar_com_divergencia === 'true';
  const justificativaBloqueio = String(
    req.body?.justificativaBloqueio ?? req.body?.justificativa_bloqueio ?? ''
  )
    .trim()
    .slice(0, 1000);
  const autorizadoLogin = String(req.body?.autorizadoLogin ?? req.body?.autorizado_login ?? '')
    .trim()
    .slice(0, 50);
  const autorizadoSenha = String(req.body?.autorizadoSenha ?? req.body?.autorizado_senha ?? '');

  const divsNf = (validacaoSaida.divergencias || []).filter(
    (d) =>
      !d.bloqueioEstoque && String(d.severidade || 'BLOQUEIO').toUpperCase() !== 'AVISO'
  );
  const nfBloqueada = divsNf.length > 0;
  const estoqueBloqueado = !estoqueSaida.ok;

  let liberacaoExistente = false;
  if (nfBloqueada || estoqueBloqueado) {
    liberacaoExistente = await cargaTemBypassEstoqueAprovado(tid, cd);
  }

  let autorizador = null;
  const precisaAuth = (nfBloqueada || estoqueBloqueado) && !liberacaoExistente;
  if (precisaAuth) {
    if (!forcarComDivergencia) {
      if (nfBloqueada) {
        const exemplos = resumirDivergencias({ divergencias: divsNf }, 3);
        return res.status(422).json({
          error:
            'Carga com divergências NF × OPL. Corrija ou libere com autorização de supervisor antes de confirmar a saída.',
          errorKey: 'wms.expedicao.divergenciaBloqueanteSaida',
          resumo: {
            status: validacaoSaida.status,
            contadores: validacaoSaida.contadores,
            exemplos,
          },
          validacao: validacaoSaida,
          validacaoEstoque: estoqueSaida,
        });
      }
      return res.status(409).json(respostaBloqueioEstoque(estoqueSaida));
    }
    const auth = await validarAutorizacaoLiberacaoExpedicao({
      forcarComDivergencia,
      justificativaBloqueio,
      autorizadoLogin,
      autorizadoSenha,
      tenantId: tid,
    });
    if (!auth.ok) {
      return res.status(auth.status).json(auth.body);
    }
    autorizador = auth.autorizador;
  }

  const confirmouComEstoquePendente = estoqueBloqueado;
  const confirmouComNfPendente = nfBloqueada;
  const motorista = String(req.body.NM_MOTORISTA || req.body.nmMotorista || '').trim().slice(0, 120);
  const placa = String(req.body.PLACA || req.body.placa || '').trim().toUpperCase().slice(0, 10);
  const confBody = String(req.body.NM_CONFERENTE || req.body.nmConferente || '').trim().slice(0, 120);
  const obs = String(req.body.OBS || req.body.obs || '').trim().slice(0, 2000);
  if (!motorista) return res.status(400).json({ error: 'Informe o motorista para confirmar a saída.' });
  if (!placa) return res.status(400).json({ error: 'Informe a placa para confirmar a saída.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chk = await client.query(
      `SELECT c."CD_CARGA",
              COALESCE((SELECT COUNT(*)::integer FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_CARGA" = c."CD_CARGA"), 0) AS q
         FROM "WMS_CARGA_PROGRAMADA" c
        WHERE c."CD_CARGA" = $1::integer
          AND c."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!chk.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carga não encontrada.' });
    }
    if (Number(chk.rows[0].q || 0) <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A carga não possui NF-e vinculada para expedir.' });
    }
    const exSaida = await client.query(
      `SELECT "ST_EXPEDICAO", "NM_CONFERENTE" FROM "WMS_EXPEDICAO_CARGA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (exSaida.rowCount && String(exSaida.rows[0].ST_EXPEDICAO || '').toUpperCase() === 'EXPEDIDA') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Saída já confirmada para esta carga.' });
    }
    const confGravado = String((exSaida.rows[0] && exSaida.rows[0].NM_CONFERENTE) || '').trim();
    const conferente = confBody || confGravado;
    if (!conferente) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Informe o conferente para confirmar a saída.' });
    }
    const r = await client.query(
      `INSERT INTO "WMS_EXPEDICAO_CARGA"
        ("CD_CARGA", "TENANT_ID", "ST_EXPEDICAO", "DH_INICIO", "DH_SAIDA", "NM_CONFERENTE", "NM_MOTORISTA", "PLACA", "OBS", "SG_USER")
       VALUES ($1::integer, $2, 'EXPEDIDA', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $3, $4, $5, $6, $7)
       ON CONFLICT ("CD_CARGA") DO UPDATE
         SET "ST_EXPEDICAO" = 'EXPEDIDA',
             "DH_INICIO" = COALESCE("WMS_EXPEDICAO_CARGA"."DH_INICIO", CURRENT_TIMESTAMP),
             "DH_SAIDA" = CURRENT_TIMESTAMP,
             "NM_CONFERENTE" = COALESCE(NULLIF(EXCLUDED."NM_CONFERENTE", ''), "WMS_EXPEDICAO_CARGA"."NM_CONFERENTE"),
             "NM_MOTORISTA" = EXCLUDED."NM_MOTORISTA",
             "PLACA" = EXCLUDED."PLACA",
             "OBS" = COALESCE(NULLIF(EXCLUDED."OBS", ''), "WMS_EXPEDICAO_CARGA"."OBS"),
             "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
             "SG_USER" = EXCLUDED."SG_USER"
       RETURNING *`,
      [cd, tid, conferente, motorista, placa, obs || null, sg]
    );
    await client.query(
      `UPDATE "WMS_CARGA_PROGRAMADA"
          SET "ST_CARGA" = 'EXPEDIDA',
              "NM_MOTORISTA" = $3,
              "PLACA" = $4,
              "SG_USER" = $5
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2`,
      [cd, tid, motorista, placa, sg]
    );
    const libRes = await liberarReservasOplPorCargaExpedida(client, tid, cd);
    await registrarSaidaExpedicaoCarga(client, tid, cd, sg, {
      cdOplArquivo: libRes.cdOplArquivo != null ? libRes.cdOplArquivo : null,
      cdOplArquivos: Array.isArray(libRes.cdOplArquivos) ? libRes.cdOplArquivos : null,
    });
    if (confirmouComEstoquePendente || confirmouComNfPendente) {
      const obsBypass = confirmouComNfPendente
        ? 'Saída confirmada com divergência NF×OPL (autorização de liberação).'
        : 'Saída confirmada com estoque/OPL pendente (autorização prévia de liberação).';
      await client.query(
        `UPDATE "WMS_EXPEDICAO_CARGA"
            SET "OBS" = COALESCE(NULLIF(TRIM(COALESCE("OBS", '')), '' ) || E'\n', '') || $3
          WHERE "CD_CARGA" = $1::integer
            AND "TENANT_ID" = $2`,
        [cd, tid, obsBypass]
      );
    }
    if (autorizador && forcarComDivergencia && precisaAuth) {
      const autorizadoNome =
        autorizador && autorizador.usuario ? autorizador.usuario.nome : autorizadoLogin;
      const autorizadoRef =
        autorizador && autorizador.usuario ? autorizador.usuario.login : autorizadoLogin;
      try {
        await client.query(
          `INSERT INTO "WMS_EXPEDICAO_LIBERACAO_DIVERGENCIA"
            ("CD_CARGA","TENANT_ID","SG_USER","AUTORIZADO_POR","AUTORIZADO_LOGIN","AUTORIZADO_NOME","JUSTIFICATIVA","DIVERGENCIAS_JSON")
           VALUES ($1::integer,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
          [
            cd,
            tid,
            sg,
            autorizadoNome,
            autorizadoRef,
            autorizadoNome,
            justificativaBloqueio,
            JSON.stringify({
              momento: 'SAIDA',
              divergenciasNf: validacaoSaida.divergencias || [],
              bloqueiosEstoque: estoqueSaida.bloqueios || [],
              liberadoComEstoquePendente: confirmouComEstoquePendente,
              liberadoComNfPendente: confirmouComNfPendente,
            }),
          ]
        );
      } catch (eIns) {
        if (!schemaMissing(eIns)) throw eIns;
      }
    }
    await client.query('COMMIT');

    try {
      const sep = separarDivergenciasEConferencias(validacaoSaida.divergencias || []);
      await persistirValidacao(
        tid,
        cd,
        sg,
        {
          ...validacaoSaida,
          divergencias: sep.divergencias,
          conferenciasCrossPedido:
            validacaoSaida.conferenciasCrossPedido || sep.conferenciasCrossPedido || [],
        },
        [...sep.divergencias, ...(validacaoSaida.conferenciasCrossPedido || sep.conferenciasCrossPedido || [])],
        {
          momento: 'SAIDA',
          dsEvento: 'Snapshot na confirmação de saída',
          payload: {
            status: validacaoSaida.status,
            contadores: validacaoSaida.contadores,
            divergencias: sep.divergencias,
            conferenciasCrossPedido:
              validacaoSaida.conferenciasCrossPedido || sep.conferenciasCrossPedido || [],
            momento: 'SAIDA',
            liberadoComNfPendente: confirmouComNfPendente,
            liberadoComEstoquePendente: confirmouComEstoquePendente,
          },
        }
      );
    } catch (eSnap) {
      if (!schemaMissing(eSnap)) {
        console.warn('[WMS expedicao] snapshot SAIDA:', eSnap.message || eSnap);
      }
    }
    invalidarCacheValidacaoExp(tid, cd);
    res.json(r.rows[0]);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] confirmarSaida:', e);
    res.status(500).json({ error: 'Erro ao confirmar saída da expedição.' });
  } finally {
    client.release();
  }
}

/**
 * Repara ledger de saída para carga já expedida (ex.: 2ª confirmação após reabrir não gravou por idempotência antiga).
 */
async function sincronizarMovimentosLedger(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cd = parseInt(req.params.cdCarga, 10);
  if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exR = await client.query(
      `SELECT "ST_EXPEDICAO" FROM "WMS_EXPEDICAO_CARGA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!exR.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carga sem expedição registrada.' });
    }
    if (String(exR.rows[0].ST_EXPEDICAO || '').toUpperCase() !== 'EXPEDIDA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Sincronização só se aplica a cargas com saída confirmada (Expedida).',
      });
    }
    const sync = await sincronizarMovimentosExpedicaoSaidaCarga(client, tid, cd, sg, {});
    await client.query('COMMIT');
    res.json({
      ok: true,
      registrosInseridos: sync.registros || 0,
      mensagem:
        sync.registros > 0
          ? `Inserido(s) ${sync.registros} movimento(s) de saída faltante(s) no estoque.`
          : 'Ledger já está alinhado com a demanda da carga.',
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS_MOVIMENTO_ESTOQUE ausente. Execute o script de movimento de estoque.',
      });
    }
    console.error('[WMS expedicao] sincronizarMovimentosLedger:', e);
    res.status(500).json({ error: 'Erro ao sincronizar movimentos de expedição.' });
  } finally {
    client.release();
  }
}

/** Diagnóstico: cargas expedidas com produtos sem saída líquida correta no ledger. */
async function diagnosticoMovimentosLedger(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });

  const client = await pool.connect();
  try {
    const r = await sincronizarMovimentosExpedicaoSaidaTodasCargas(client, tid, sg, {
      dryRun: true,
      incluirDetalhes: true,
      maxDetalhes: 1000,
    });
    res.json({
      ok: true,
      mensagem:
        r.cargasComPendencia > 0
          ? `${r.cargasComPendencia} carga(s) expedida(s) com saída(s) faltante(s) no estoque — use POST sincronizar-movimentos-todas para reparar.`
          : 'Nenhuma pendência: ledger alinhado com todas as cargas expedidas.',
      ...r,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS_MOVIMENTO_ESTOQUE ausente.',
      });
    }
    console.error('[WMS expedicao] diagnosticoMovimentosLedger:', e);
    res.status(500).json({ error: 'Erro no diagnóstico de movimentos.' });
  } finally {
    client.release();
  }
}

/** Repara TODAS as cargas expedidas do tenant (todos os itens/NF afetados pelo bug de idempotência). */
async function sincronizarMovimentosLedgerTodas(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await sincronizarMovimentosExpedicaoSaidaTodasCargas(client, tid, sg, {
      dryRun: false,
      incluirDetalhes: true,
      maxDetalhes: 500,
    });
    await client.query('COMMIT');
    res.json({
      ok: true,
      mensagem:
        r.registrosInseridos > 0
          ? `Reparo concluído: ${r.registrosInseridos} movimento(s) inserido(s) em ${r.cargasReparadas} carga(s).`
          : 'Nenhum movimento faltante — ledger já estava correto.',
      ...r,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS_MOVIMENTO_ESTOQUE ausente.',
      });
    }
    console.error('[WMS expedicao] sincronizarMovimentosLedgerTodas:', e);
    res.status(500).json({ error: 'Erro ao sincronizar movimentos de expedição em massa.' });
  } finally {
    client.release();
  }
}

/** Coleta os filtros (querystring) usados pelos relatórios de divergências. */
function lerFiltrosDivergencias(req) {
  const cdCargaRaw = req.params && req.params.cdCarga != null ? req.params.cdCarga : null;
  const cdCarga = cdCargaRaw != null ? parseInt(cdCargaRaw, 10) : null;
  const cdDonoRaw = req.query.cdDono || req.query.cd_dono;
  const cdDono = cdDonoRaw != null && cdDonoRaw !== '' ? parseInt(cdDonoRaw, 10) : null;
  const nmDono = String(req.query.nmDono || req.query.nm_dono || '').trim() || null;
  const exibirCargas = String(req.query.exibirCargas || req.query.exibir_cargas || '').trim() || null;
  return {
    tenantId: tenantIdForRequest(req),
    cdCarga: Number.isFinite(cdCarga) ? cdCarga : null,
    dataIni: String(req.query.dataIni || req.query.data_ini || '').trim() || null,
    dataFim: String(req.query.dataFim || req.query.data_fim || '').trim() || null,
    conferente: String(req.query.conferente || '').trim() || null,
    status: String(req.query.status || '').trim().toUpperCase() || null,
    cdDono: Number.isFinite(cdDono) ? cdDono : null,
    nmDono,
    exibirCargas,
  };
}

/**
 * Reabre carga já expedida (ex.: veículo voltou — embarcar em outro caminhão).
 * Estorna movimento de estoque, recria reservas OPL e volta status para EM_EXPEDICAO.
 */
async function reabrirExpedicao(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cd = parseInt(req.params.cdCarga, 10);
  if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });

  const justificativa = String(
    req.body?.justificativa ?? req.body?.justificativaBloqueio ?? req.body?.justificativa_bloqueio ?? ''
  )
    .trim()
    .slice(0, 1000);
  if (!justificativa) {
    return res.status(400).json({
      error: 'Informe a justificativa para reabrir a expedição (obrigatório para auditoria).',
      errorKey: 'wms.expedicao.reabrirJustificativaObrigatoria',
    });
  }
  const autorizadoLogin = String(req.body?.autorizadoLogin ?? req.body?.autorizado_login ?? '')
    .trim()
    .slice(0, 50);
  const autorizadoSenha = String(req.body?.autorizadoSenha ?? req.body?.autorizado_senha ?? '');
  if (!autorizadoLogin) {
    return res.status(400).json({
      error: 'Informe o usuário autorizador.',
      errorKey: 'wms.expedicao.autorizadoLoginObrigatorio',
    });
  }
  const autorizador = await validarAutorizadorComSenha(autorizadoLogin, autorizadoSenha, tid);
  if (!autorizador.ok) {
    return res.status(401).json({
      error: autorizador.error,
      errorKey: 'wms.expedicao.autorizadorInvalido',
    });
  }
  const pode = await usuarioPodeReabrirExpedicao(autorizador.usuario.login, tid);
  if (!pode) {
    return res.status(403).json({
      error:
        'Sem permissão para reabrir expedição. Necessário programa wms-expedicao-reabrir ou wms-expedicao-liberar-divergencia.',
      errorKey: 'wms.expedicao.semPermissaoReabrir',
      programasNecessarios: [PROGRAMA_REABRIR_EXPEDICAO, PROGRAMA_LIBERAR_DIVERGENCIA],
    });
  }
  const autorizadoNome =
    autorizador && autorizador.usuario ? autorizador.usuario.nome : autorizadoLogin;
  const autorizadoRef =
    autorizador && autorizador.usuario ? autorizador.usuario.login : autorizadoLogin;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const exR = await client.query(
      `SELECT "ST_EXPEDICAO", "DH_SAIDA", "NM_MOTORISTA", "PLACA"
         FROM "WMS_EXPEDICAO_CARGA"
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!exR.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Carga sem registro de expedição. Use «Iniciar expedição» em vez de reabrir.',
      });
    }
    const st = String(exR.rows[0].ST_EXPEDICAO || '').toUpperCase();
    if (st !== 'EXPEDIDA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:
          st === 'EM_EXPEDICAO'
            ? 'A carga já está em expedição (saída ainda não confirmada). Ajuste motorista/placa e use «Confirmar saída».'
            : 'Só é possível reabrir cargas com status Expedida.',
      });
    }

    const estorno = await estornarSaidaExpedicaoCarga(client, tid, cd, sg);

    const obsLinha =
      `Reabertura expedição em ${new Date().toISOString()} por ${autorizadoNome} (${autorizadoRef}). Operador: ${sg}. Justificativa: ${justificativa}. Saída anterior: motorista ${exR.rows[0].NM_MOTORISTA || '—'}, placa ${exR.rows[0].PLACA || '—'}, DH_SAIDA ${exR.rows[0].DH_SAIDA || '—'}. Estorno mov.: ${estorno.registros || 0}.`;
    const r = await client.query(
      `UPDATE "WMS_EXPEDICAO_CARGA"
          SET "ST_EXPEDICAO" = 'EM_EXPEDICAO',
              "DH_SAIDA" = NULL,
              "OBS" = COALESCE(NULLIF(TRIM(COALESCE("OBS", '')), ''), '') || CASE WHEN TRIM(COALESCE("OBS", '')) <> '' THEN E'\n' ELSE '' END || $3,
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $4
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2
        RETURNING *`,
      [cd, tid, obsLinha, sg]
    );
    await client.query(
      `UPDATE "WMS_CARGA_PROGRAMADA"
          SET "ST_CARGA" = 'EM_EXPEDICAO',
              "SG_USER" = $3
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2`,
      [cd, tid, sg]
    );

    let reservasResult = { registros: 0, espelhos: 0, avisos: [] };
    try {
      reservasResult = await reaplicarReservasOplCargaReaberta(client, tid, cd, sg, {
        ignorarSaldoInsuficiente: true,
      });
    } catch (eRes) {
      const msgRes =
        (eRes && eRes.message) || 'Falha ao recriar reservas OPL; status da carga já voltou para Em expedição.';
      reservasResult.avisos = [msgRes];
      console.warn('[WMS expedicao] reabrir reservas OPL carga', cd, eRes.message || eRes);
    }

    await client.query('COMMIT');
    const avisosReserva = Array.isArray(reservasResult.avisos) ? reservasResult.avisos.filter(Boolean) : [];
    let mensagem =
      'Expedição reaberta. Informe o novo motorista e a placa, depois confirme a saída novamente.';
    if (avisosReserva.length) {
      mensagem += ' Avisos de reserva OPL: ' + avisosReserva.join(' ');
    }
    res.json({
      ok: true,
      expedicao: r.rows[0],
      estornoMovimentos: estorno.registros || 0,
      espelhosReprocessados: reservasResult.espelhos || 0,
      reservasRecriadas: reservasResult.registros || 0,
      avisosReserva: avisosReserva.length ? avisosReserva : undefined,
      mensagem,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição/estoque ausente.',
      });
    }
    console.error('[WMS expedicao] reabrirExpedicao:', e);
    res.status(500).json({ error: e.message || 'Erro ao reabrir expedição da carga.' });
  } finally {
    client.release();
  }
}

async function relatorioDivergenciasCargaHtml(req, res) {
  try {
    const filtros = lerFiltrosDivergencias(req);
    if (!Number.isFinite(filtros.cdCarga)) {
      return res.status(400).json({ error: 'Código da carga inválido.' });
    }
    const html = await buildDivergenciasExpedicaoHtml(filtros);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de validação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] relatorioDivergenciasCargaHtml:', e);
    res.status(500).json({ error: 'Erro ao gerar relatório de divergências da carga.' });
  }
}

async function relatorioDivergenciasConsolidadoHtml(req, res) {
  try {
    const filtros = lerFiltrosDivergencias(req);
    filtros.cdCarga = null; // ignora cdCarga no consolidado
    const html = await buildDivergenciasExpedicaoHtml(filtros);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de validação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] relatorioDivergenciasConsolidadoHtml:', e);
    res.status(500).json({ error: 'Erro ao gerar relatório consolidado de divergências.' });
  }
}

async function relatorioDivergenciasCsv(req, res) {
  try {
    const filtros = lerFiltrosDivergencias(req);
    const csv = await buildDivergenciasExpedicaoCsv(filtros);
    const escopo = filtros.cdCarga ? `carga_${filtros.cdCarga}` : 'consolidado';
    const ts = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="divergencias_expedicao_${escopo}_${ts}.csv"`
    );
    res.send(csv);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de validação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] relatorioDivergenciasCsv:', e);
    res.status(500).json({ error: 'Erro ao gerar CSV de divergências.' });
  }
}

/** CSV agregado por SKU — uma linha por código de produto (cruza com saldo contábil). */
async function relatorioDivergenciasSkuCsv(req, res) {
  try {
    const filtros = lerFiltrosDivergencias(req);
    const csv = await buildDivergenciasExpedicaoSkuCsv(filtros);
    const escopo = filtros.cdCarga ? `carga_${filtros.cdCarga}` : 'consolidado';
    const ts = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="divergencias_expedicao_por_sku_${escopo}_${ts}.csv"`
    );
    res.send(csv);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de validação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] relatorioDivergenciasSkuCsv:', e);
    res.status(500).json({ error: 'Erro ao gerar CSV consolidado por SKU.' });
  }
}

/**
 * Devolve carga «Em expedição» (saída ainda não confirmada) para montagem em Cargas Programadas
 * (incluir/remover NF-e, rota, paradas). Não estorna estoque — só libera programação.
 */
async function voltarMontagemExpedicao(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cd = parseInt(req.params.cdCarga, 10);
  if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
  const motivo = String(req.body?.motivo ?? req.body?.justificativa ?? '').trim().slice(0, 500);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const chk = await client.query(
      `SELECT c."CD_CARGA", e."ST_EXPEDICAO"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e
           ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
        WHERE c."CD_CARGA" = $1::integer AND c."TENANT_ID" = $2`,
      [cd, tid]
    );
    if (!chk.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carga não encontrada.' });
    }
    const stEx = String(chk.rows[0].ST_EXPEDICAO || 'PRONTA_EXPEDICAO').toUpperCase();
    if (stEx === 'EXPEDIDA') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:
          'Carga já expedida (saída confirmada). Use «Reabrir expedição» na Expedição antes de voltar à montagem.',
      });
    }
    if (stEx !== 'EM_EXPEDICAO') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error:
          stEx === 'PRONTA_EXPEDICAO'
            ? 'A carga já está liberada para montagem (expedição não iniciada ou já devolvida).'
            : 'Só é possível voltar à montagem com expedição em andamento (sem saída confirmada).',
      });
    }

    const obsLinha = `Devolvida à montagem em ${new Date().toISOString()} por ${sg}.${motivo ? ` Motivo: ${motivo}.` : ''}`;
    await client.query(
      `UPDATE "WMS_EXPEDICAO_CARGA"
          SET "ST_EXPEDICAO" = 'PRONTA_EXPEDICAO',
              "OBS" = COALESCE(NULLIF(TRIM(COALESCE("OBS", '')), ''), '') || CASE WHEN TRIM(COALESCE("OBS", '')) <> '' THEN E'\n' ELSE '' END || $3,
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $4
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid, obsLinha, sg]
    );
    await client.query(
      `UPDATE "WMS_CARGA_PROGRAMADA"
          SET "ST_CARGA" = 'RASCUNHO',
              "SG_USER" = $3
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tid, sg]
    );
    await client.query('COMMIT');
    res.json({
      ok: true,
      CD_CARGA: cd,
      ST_EXPEDICAO: 'PRONTA_EXPEDICAO',
      ST_CARGA: 'RASCUNHO',
      mensagem:
        'Carga liberada para montagem. Abra Cargas Programadas (#' +
        cd +
        ') para incluir ou remover NF-e. Depois volte à Expedição para iniciar novamente.',
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de expedição ausente. Execute backend/scripts/wms_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS expedicao] voltarMontagemExpedicao:', e);
    res.status(500).json({ error: 'Erro ao devolver carga à montagem.' });
  } finally {
    client.release();
  }
}

module.exports = {
  listarCargas,
  detalharCarga,
  detalharValidacaoCarga,
  iniciarExpedicao,
  confirmarSaida,
  sincronizarMovimentosLedger,
  diagnosticoMovimentosLedger,
  sincronizarMovimentosLedgerTodas,
  reabrirExpedicao,
  voltarMontagemExpedicao,
  relatorioDivergenciasCargaHtml,
  relatorioDivergenciasConsolidadoHtml,
  relatorioDivergenciasCsv,
  relatorioDivergenciasSkuCsv,
};

