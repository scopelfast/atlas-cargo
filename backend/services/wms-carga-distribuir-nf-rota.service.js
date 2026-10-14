'use strict';

const { pool } = require('../config/db');
const { buildWhereCargasProgramadas } = require('./wms-carga-programada-filtro.service');
const {
  carregarMapaNrRotaPorChaveImport,
  carregarIndiceRotaPorCodigoDestinatario,
  resolveNrRotaCadastroNf,
  resolverNrRotaNfSaida,
} = require('./cadastro-endereco-entrega-match.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');
const { sincronizarDonoUnicoNaCargaSeAplicavel } = require('./wms-carga-dono-carga.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function cnpj14Pad(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  if (!d) return '';
  return d.length > 14 ? d.slice(-14) : d.padStart(14, '0');
}

function parseOptionalInt(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function isoDateParts(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function anoReferenciaCarga(carga) {
  const dh = carga && carga.DH_CRIACAO;
  if (dh) {
    const d = dh instanceof Date ? dh : new Date(dh);
    if (!Number.isNaN(d.getTime())) return d.getUTCFullYear();
  }
  return new Date().getFullYear();
}

/**
 * Data de programação na descrição.
 * Exemplos: "Rota 1 - 30/06", "ROTA 4 - 13/08 - CRICIUMA", "ROTA 3 - 13/08 RIO DO SUL".
 * Não confundir "ROTA 08" com dia/mês; se DD/MM/AA inválido (ex. 08-13/08), tenta DD/MM seguinte.
 */
function parseDataProgramacaoCarga(carga) {
  const desc = String((carga && carga.NM_DESCRICAO) || '').trim();
  if (!desc) return null;
  const anoRef = anoReferenciaCarga(carga);

  const fullRe = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g;
  let m;
  while ((m = fullRe.exec(desc)) !== null) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    const iso = isoDateParts(y, mo, d);
    if (iso) return iso;
  }

  // DD/MM sem ano (após " - " ou no meio da descrição, inclusive antes de " - CIDADE")
  const dmRe = /(\d{1,2})[/.](\d{1,2})(?!\d)/g;
  const candidatos = [];
  while ((m = dmRe.exec(desc)) !== null) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const iso = isoDateParts(anoRef, mo, d);
    if (!iso) continue;
    const before = desc.slice(Math.max(0, m.index - 3), m.index);
    const score = /[-–]\s*$/.test(before) ? 2 : 1;
    candidatos.push({ iso, score, idx: m.index });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return candidatos[0].iso;
}

function dateOnlyIso(v) {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * DH_SAIDA vem do XML (ide.dSaiEnt) — não é registro de expedição WMS.
 * Compatível com a programação da carga quando:
 * - mesma data, ou
 * - saída anterior (backlog / NF retirada da montagem antes de expedir) → pode ir em dia posterior.
 * Bloqueia só NF com saída *futura* em relação à data da carga.
 */
function nfCompativelDataCarga(nf, dataProgramacao) {
  if (!dataProgramacao) return true;
  const dh = dateOnlyIso(nf.DH_SAIDA);
  if (dh == null) return false;
  return dh <= dataProgramacao;
}

/** NR_ROTA da carga: CD_ROTA, NM_ROTA numérico ou "Rota N" na descrição. */
function parseNrRotaCarga(carga) {
  if (!carga) return null;
  if (carga.CD_ROTA != null && Number.isFinite(Number(carga.CD_ROTA))) {
    return Number(carga.CD_ROTA);
  }
  const nmRota = String(carga.NM_ROTA || '').trim();
  if (/^\d{1,3}$/.test(nmRota)) return Number(nmRota);
  const desc = String(carga.NM_DESCRICAO || '').trim();
  const m = desc.match(/\brota\s*#?\s*(\d{1,3})\b/i);
  if (m) return Number(m[1]);
  return null;
}

function expedicaoBloqueiaProgramacao(st) {
  const s = String(st || '').toUpperCase();
  return s === 'EM_EXPEDICAO' || s === 'EXPEDIDA';
}

async function cargaProgramacaoEditavel(tenantId, cdCarga, cacheExp) {
  const cd = parseInt(cdCarga, 10);
  if (!Number.isFinite(cd)) return { ok: false, error: 'Carga inválida.' };
  if (cacheExp.has(cd)) return cacheExp.get(cd);
  let out = { ok: true };
  try {
    const r = await pool.query(
      `SELECT "ST_EXPEDICAO" FROM "WMS_EXPEDICAO_CARGA"
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cd, tenantId]
    );
    if (r.rowCount) {
      const st = String(r.rows[0].ST_EXPEDICAO || '').toUpperCase();
      if (expedicaoBloqueiaProgramacao(st)) {
        out = {
          ok: false,
          error:
            st === 'EXPEDIDA'
              ? 'Carga já expedida.'
              : 'Expedição em andamento — programação bloqueada.',
        };
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  cacheExp.set(cd, out);
  return out;
}

async function listarCargasAlvo(tenantId, query) {
  const q = { ...query, stCarga: query.stCarga || 'RASCUNHO' };
  const { where, params } = buildWhereCargasProgramadas(tenantId, q, {
    applyStExpedicao: !!String(query.stExpedicao || '').trim(),
  });
  const wc = `WHERE ${where.join(' AND ')}`;
  const sql = `
    SELECT c."CD_CARGA", c."NM_DESCRICAO", c."CD_ROTA", c."NM_ROTA", c."ST_CARGA", c."CD_DONO",
           c."DH_CRIACAO",
           COALESCE(x.q, 0)::integer AS "Q_NFES"
      FROM "WMS_CARGA_PROGRAMADA" c
      LEFT JOIN (
        SELECT "CD_CARGA", COUNT(*)::integer AS q
          FROM "WMS_CARGA_PROGRAMADA_NFE"
         GROUP BY "CD_CARGA"
      ) x ON x."CD_CARGA" = c."CD_CARGA"
     ${wc}
     ORDER BY c."CD_CARGA" ASC`;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

async function listarNfesDisponiveis(tenantId, query) {
  const limite = Math.min(3000, Math.max(1, parseInt(query.limite, 10) || 2000));
  const cdDono = parseOptionalInt(query.cdDono ?? query.CD_DONO);
  const params = [tenantId];
  let extra = '';
  if (cdDono != null) {
    params.push(cdDono);
    extra += ` AND n."CD_DONO" = $${params.length}::integer`;
  }
  const dhSaidaDe = String(query.dhSaidaDe ?? query.dataSaidaDe ?? '').trim();
  const dhSaidaAte = String(query.dhSaidaAte ?? query.dataSaidaAte ?? '').trim();
  if (dhSaidaDe) {
    params.push(dhSaidaDe);
    extra += ` AND n."DH_SAIDA" >= $${params.length}::date`;
  }
  if (dhSaidaAte) {
    params.push(dhSaidaAte);
    extra += ` AND n."DH_SAIDA" < ($${params.length}::date + INTERVAL '1 day')`;
  }
  params.push(limite);
  const sql = `
    SELECT n.*
      FROM "WMS_NFE_SAIDA" n
     WHERE n."TENANT_ID" = $1
       AND NOT EXISTS (
         SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j
          WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
       )
       ${extra}
     ORDER BY n."DH_IMPORTACAO" DESC
     LIMIT $${params.length}::integer`;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

function fmtNfIdent(n) {
  const num = n.NUMERO_NF != null ? String(n.NUMERO_NF).trim() : '?';
  const ser = n.SERIE != null ? String(n.SERIE).trim() : '';
  return ser ? `${num}/${ser}` : num;
}

function resumoNf(n, nrRota) {
  return {
    CD_NFE_SAIDA: n.CD_NFE_SAIDA,
    NUMERO_NF: n.NUMERO_NF,
    SERIE: n.SERIE,
    ident: fmtNfIdent(n),
    NR_ROTA: nrRota,
    destino: nomeEntregaUnidadeOuLocalDestino(n) || '—',
    municipio: String(n.XMUN_DEST || '').trim() || '—',
    uf: String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2) || '—',
    CD_DONO: n.CD_DONO,
  };
}

/**
 * Monta plano de distribuição NF disponíveis → cargas por NR_ROTA cadastrada.
 * @returns {Promise<object>}
 */
async function montarPlanoDistribuicaoNfPorRota(tenantId, query) {
  const cargasRaw = await listarCargasAlvo(tenantId, query);
  const cacheExp = new Map();
  const cargasIgnoradas = [];
  const cargasElegiveis = [];

  for (const c of cargasRaw) {
    if (String(c.ST_CARGA || '').toUpperCase() !== 'RASCUNHO') {
      cargasIgnoradas.push({
        CD_CARGA: c.CD_CARGA,
        NM_DESCRICAO: c.NM_DESCRICAO,
        motivo: 'Montagem não está em RASCUNHO.',
      });
      continue;
    }
    const lock = await cargaProgramacaoEditavel(tenantId, c.CD_CARGA, cacheExp);
    if (!lock.ok) {
      cargasIgnoradas.push({
        CD_CARGA: c.CD_CARGA,
        NM_DESCRICAO: c.NM_DESCRICAO,
        motivo: lock.error,
      });
      continue;
    }
    const nr = parseNrRotaCarga(c);
    if (nr == null) {
      cargasIgnoradas.push({
        CD_CARGA: c.CD_CARGA,
        NM_DESCRICAO: c.NM_DESCRICAO,
        motivo: 'Não foi possível identificar NR_ROTA (use CD_ROTA ou descrição "Rota N").',
      });
      continue;
    }
    const dataProgramacao = parseDataProgramacaoCarga(c);
    cargasElegiveis.push({ ...c, NR_ROTA: nr, DATA_PROGRAMACAO: dataProgramacao });
  }

  /** @type {Map<number, object[]>} */
  const cargasPorRota = new Map();
  const rotasDuplicadas = [];
  for (const c of cargasElegiveis) {
    const nr = c.NR_ROTA;
    if (!cargasPorRota.has(nr)) cargasPorRota.set(nr, []);
    cargasPorRota.get(nr).push(c);
  }
  for (const [nr, lista] of cargasPorRota) {
    if (lista.length > 1) {
      rotasDuplicadas.push({
        NR_ROTA: nr,
        cargas: lista.map((c) => ({
          CD_CARGA: c.CD_CARGA,
          NM_DESCRICAO: c.NM_DESCRICAO,
        })),
      });
    }
  }

  const nfes = await listarNfesDisponiveis(tenantId, query);
  const cnpjs = nfes.map((n) => cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST)).filter((c) => c.length === 14);
  const mapaNrRota = await carregarMapaNrRotaPorChaveImport(pool, tenantId, cnpjs);
  const indiceRotaPorCod = await carregarIndiceRotaPorCodigoDestinatario(pool, tenantId);

  const rotasElegiveis = [
    ...new Set(cargasElegiveis.map((c) => parseNrRotaCarga(c)).filter((n) => n != null && Number.isFinite(n))),
  ];

  const semRota = [];
  const semCarga = [];
  const semDataCompativel = [];
  /** @type {Map<number, { carga: object, nfes: object[] }>} */
  const porCarga = new Map();

  const datasProgramacaoCargas = [
    ...new Set(cargasElegiveis.map((c) => c.DATA_PROGRAMACAO).filter(Boolean)),
  ];
  const exigeDataNf = datasProgramacaoCargas.length > 0;

  for (const n of nfes) {
    const { nrRota } = await resolverNrRotaNfSaida(pool, tenantId, n, mapaNrRota, indiceRotaPorCod, {
      allowedNrRotas: rotasElegiveis,
    });
    const resumo = resumoNf(n, nrRota);
    resumo.DH_SAIDA = n.DH_SAIDA;
    if (nrRota == null) {
      semRota.push(resumo);
      continue;
    }
    const listaCargas = cargasPorRota.get(nrRota);
    if (!listaCargas || listaCargas.length !== 1) {
      semCarga.push({
        ...resumo,
        motivo:
          !listaCargas || !listaCargas.length
            ? `Nenhuma carga em rascunho para a rota ${nrRota} (filtros atuais).`
            : `Mais de uma carga para a rota ${nrRota} — resolva o conflito antes.`,
      });
      continue;
    }
    const carga = listaCargas[0];
    // Se a carga alvo não tem data parseada mas o lote filtrado tem uma única data, herda.
    let dataProg = carga.DATA_PROGRAMACAO;
    if (!dataProg && datasProgramacaoCargas.length === 1) {
      dataProg = datasProgramacaoCargas[0];
    }
    if (dataProg && !nfCompativelDataCarga(n, dataProg)) {
      const dhNf = dateOnlyIso(n.DH_SAIDA);
      semDataCompativel.push({
        ...resumo,
        motivo:
          dhNf == null
            ? `NF sem data de saída no XML; programação da carga é ${dataProg}.`
            : `Data saída XML (${dhNf}) é posterior à programação da carga (${dataProg}).`,
        DATA_CARGA: dataProg,
      });
      continue;
    }
    if (!dataProg && exigeDataNf) {
      semDataCompativel.push({
        ...resumo,
        motivo:
          'Carga alvo sem data na descrição (ex.: ROTA N - DD/MM); outras cargas do lote têm programação.',
      });
      continue;
    }
    const cd = carga.CD_CARGA;
    if (!porCarga.has(cd)) {
      porCarga.set(cd, {
        CD_CARGA: cd,
        NM_DESCRICAO: carga.NM_DESCRICAO,
        NR_ROTA: nrRota,
        DATA_PROGRAMACAO: dataProg || carga.DATA_PROGRAMACAO,
        Q_NFES_ATUAL: Number(carga.Q_NFES || 0),
        nfes: [],
      });
    }
    porCarga.get(cd).nfes.push(resumo);
  }

  const porCargaArr = [...porCarga.values()].sort((a, b) => a.NR_ROTA - b.NR_ROTA);
  let qDistribuir = 0;
  for (const bloco of porCargaArr) qDistribuir += bloco.nfes.length;

  return {
    geradoEm: new Date().toISOString(),
    filtros: {
      stCarga: query.stCarga || 'RASCUNHO',
      stExpedicao: query.stExpedicao || '',
      busca: query.busca || query.q || '',
      cdDono: parseOptionalInt(query.cdDono ?? query.CD_DONO),
      dhSaidaDe: query.dhSaidaDe || query.dataSaidaDe || '',
      dhSaidaAte: query.dhSaidaAte || query.dataSaidaAte || '',
    },
    totais: {
      nfDisponiveis: nfes.length,
      nfDistribuir: qDistribuir,
      nfSemRota: semRota.length,
      nfSemCarga: semCarga.length,
      nfSemDataCompativel: semDataCompativel.length,
      cargasAlvo: cargasElegiveis.length,
      cargasComNf: porCargaArr.length,
      rotasDuplicadas: rotasDuplicadas.length,
      cargasIgnoradas: cargasIgnoradas.length,
    },
    datasProgramacaoCargas,
    porCarga: porCargaArr,
    semRota: semRota.slice(0, 200),
    semCarga: semCarga.slice(0, 200),
    semDataCompativel: semDataCompativel.slice(0, 200),
    rotasDuplicadas,
    cargasIgnoradas,
    podeAplicar: qDistribuir > 0 && rotasDuplicadas.length === 0,
    aviso:
      rotasDuplicadas.length > 0
        ? 'Há rotas com mais de uma carga — nenhuma NF será vinculada até resolver os conflitos.'
        : qDistribuir === 0
          ? semDataCompativel.length > 0
            ? (() => {
                const soSemDataDesc = semDataCompativel.every((x) =>
                  String(x.motivo || '').includes('sem data na descrição')
                );
                if (soSemDataDesc) {
                  return 'Há NF na rota, mas a carga alvo não tem data parseável na descrição (use ROTA N - DD/MM).';
                }
                return 'Há NF na rota, mas a data de saída do XML é posterior à programação da carga (ou está vazia). Confira DH_SAIDA × data na descrição.';
              })()
            : 'Nenhuma NF disponível pôde ser associada às cargas filtradas.'
          : exigeDataNf
            ? `Entram NF-e sem carga com saída XML no dia da programação (${datasProgramacaoCargas.join(', ')}) ou anterior (backlog / retirada antes da expedição). Notas já em outra carga não entram.`
            : null,
  };
}

/**
 * Aplica o plano (recomputa para evitar corrida).
 * @returns {Promise<object>}
 */
async function aplicarDistribuicaoNfPorRota(tenantId, sgUser, query) {
  const plano = await montarPlanoDistribuicaoNfPorRota(tenantId, query);
  if (!plano.podeAplicar) {
    return {
      ok: false,
      err: plano.aviso || 'Nada a distribuir.',
      plano,
    };
  }

  const client = await pool.connect();
  const vinculadas = [];
  const erros = [];
  const cargasAfetadas = new Set();

  try {
    await client.query('BEGIN');

    for (const bloco of plano.porCarga) {
      const cdCarga = bloco.CD_CARGA;
      const lock = await cargaProgramacaoEditavel(tenantId, cdCarga, new Map());
      if (!lock.ok) {
        erros.push({ CD_CARGA: cdCarga, error: lock.error });
        continue;
      }

      const maxR = await client.query(
        `SELECT COALESCE(MAX("ORDEM"), 0)::integer AS m
           FROM "WMS_CARGA_PROGRAMADA_NFE"
          WHERE "CD_CARGA" = $1::integer`,
        [cdCarga]
      );
      let ordem = Number(maxR.rows[0].m || 0);

      for (const nf of bloco.nfes) {
        const cdNfe = parseInt(nf.CD_NFE_SAIDA, 10);
        if (!Number.isFinite(cdNfe)) continue;
        try {
          const chk = await client.query(
            `SELECT 1 FROM "WMS_NFE_SAIDA" n
              WHERE n."CD_NFE_SAIDA" = $1::integer AND n."TENANT_ID" = $2
                AND NOT EXISTS (
                  SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j
                   WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
                )`,
            [cdNfe, tenantId]
          );
          if (!chk.rowCount) {
            erros.push({
              CD_NFE_SAIDA: cdNfe,
              ident: nf.ident,
              error: 'NF já vinculada ou indisponível.',
            });
            continue;
          }
          ordem += 1;
          await client.query(
            `INSERT INTO "WMS_CARGA_PROGRAMADA_NFE" ("CD_CARGA", "CD_NFE_SAIDA", "ORDEM", "SG_USER")
             VALUES ($1::integer, $2::integer, $3::integer, $4)`,
            [cdCarga, cdNfe, ordem, sgUser]
          );
          vinculadas.push({ CD_CARGA: cdCarga, CD_NFE_SAIDA: cdNfe, ident: nf.ident, NR_ROTA: bloco.NR_ROTA });
          cargasAfetadas.add(cdCarga);

          if (bloco.NR_ROTA != null) {
            await client.query(
              `UPDATE "WMS_CARGA_PROGRAMADA"
                  SET "CD_ROTA" = $1::integer
                WHERE "CD_CARGA" = $2::integer
                  AND "TENANT_ID" = $3
                  AND "CD_ROTA" IS NULL`,
              [bloco.NR_ROTA, cdCarga, tenantId]
            );
          }
        } catch (e) {
          if (e && e.code === '23505') {
            erros.push({ CD_NFE_SAIDA: cdNfe, ident: nf.ident, error: 'NF já em outra carga.' });
          } else {
            throw e;
          }
        }
      }
    }

    for (const cd of cargasAfetadas) {
      await sincronizarDonoUnicoNaCargaSeAplicavel(tenantId, cd, client);
    }

    await client.query('COMMIT');

    return {
      ok: true,
      vinculadas: vinculadas.length,
      detalhe: vinculadas,
      erros,
      cargasAfetadas: [...cargasAfetadas],
      plano,
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  parseNrRotaCarga,
  parseDataProgramacaoCarga,
  nfCompativelDataCarga,
  montarPlanoDistribuicaoNfPorRota,
  aplicarDistribuicaoNfPorRota,
};
