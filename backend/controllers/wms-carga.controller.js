'use strict';

const multer = require('multer');
const crypto = require('crypto');
const { pool, getFirstNumericValue } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { parseNfeXml, normDocFiscal } = require('../services/wms-nfe-xml-parse.service');
const {
  fetchRouteMapRaw,
  normalizeRawToResumoShape,
  fetchTripRawByCoords,
} = require('../services/mapa-rota-fetch.service');
const { normalizeNumeroEntregaMatch } = require('../services/cadastro-endereco-entrega-import.service');
const {
  provisionarEnderecoEntregaDaNf,
  vincularEnderecoEntregaNf,
} = require('../services/cadastro-endereco-entrega-provision.service');
const {
  buscarEnderecoEntregaParaParada,
  resolveCdClienteDonoDaCarga,
} = require('../services/cadastro-endereco-entrega-match.service');
const {
  buildRomaneioResumoHtml,
  buildRomaneioResumoPickingHtml,
  buildRomaneioCargaFriosOplHtml,
  collectDigitosCargaNfe,
  filtrarNfRowsPorUnidades,
  filtrarNfRowsPorDestinos,
} = require('../services/wms-carga-relatorio-html.service');
const {
  carregarMapaProdutosDonoPorDigitos,
} = require('../services/wms-produto-mapa-codigo.service');

/** Lista de query params (vírgula/ponto-e-vírgula ou repetição do param). */
function lerListaQueryParam(req, name) {
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
const { validarCargaProgramada } = require('../services/wms-carga-validacao.service');
const {
  validarEstoqueOplParaExpedicao,
  anexarValidacaoEstoqueNaCarga,
} = require('../services/wms-carga-estoque-expedicao.service');
const { obterOuCriarRoteiroFromWmsRotaOperacional } = require('../services/wms-roteiro-from-rota-operacional.service');
const {
  nomeEntregaUnidadeOuLocalDestino,
  compareNfeDisponivelOrdenacao,
} = require('../services/wms-nfe-saida-destino-display.service');
const { montarResumoLogisticoCarga, chaveDestinoNf } = require('../services/wms-carga-resumo-logistico.service');
const {
  montarResumoProgramacaoCargas,
  agregarPesosConservacaoPorCargas,
} = require('../services/wms-carga-resumo-programacao.service');
const { buildResumoProgramacaoHtml } = require('../services/wms-carga-resumo-programacao-html.service');
const {
  listarNfExportacaoCargas,
  montarCsvNfCargas,
  listarNfExportacaoImportadas,
  montarCsvNfImportadas,
} = require('../services/wms-carga-export-nf-csv.service');
const { buildWhereNfesSaida, CARGAS_TXT_SQL } = require('../services/wms-nfe-saida-filtro.service');
const { sincronizarDonoUnicoNaCargaSeAplicavel } = require('../services/wms-carga-dono-carga.service');
const { buildWhereCargasProgramadas } = require('../services/wms-carga-programada-filtro.service');
const {
  montarPlanoDistribuicaoNfPorRota,
  aplicarDistribuicaoNfPorRota,
} = require('../services/wms-carga-distribuir-nf-rota.service');

function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Comprimento do tour origem → paradas → (opcional) retorno, em km linha reta. */
function tourLengthHaversineKm(originLat, originLon, stops, roundtrip) {
  let total = 0;
  let la = Number(originLat);
  let lo = Number(originLon);
  for (const s of stops || []) {
    const sla = Number(s.LATITUDE);
    const slo = Number(s.LONGITUDE);
    if (!Number.isFinite(sla) || !Number.isFinite(slo)) continue;
    total += haversineKm(la, lo, sla, slo);
    la = sla;
    lo = slo;
  }
  if (roundtrip) total += haversineKm(la, lo, Number(originLat), Number(originLon));
  return total;
}

function nnFromPoint(curLat, curLon, stops) {
  const remaining = (stops || []).slice();
  const ordered = [];
  let la = Number(curLat);
  let lo = Number(curLon);
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const sla = Number(remaining[i].LATITUDE);
      const slo = Number(remaining[i].LONGITUDE);
      if (!Number.isFinite(sla) || !Number.isFinite(slo)) continue;
      const d = haversineKm(la, lo, sla, slo);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const next = remaining.splice(bestI, 1)[0];
    ordered.push(next);
    const nLat = Number(next.LATITUDE);
    const nLon = Number(next.LONGITUDE);
    if (Number.isFinite(nLat) && Number.isFinite(nLon)) {
      la = nLat;
      lo = nLon;
    }
  }
  return ordered;
}

/**
 * 2-opt clássico sobre a sequência (linha reta). Remove cruzamentos óbvios.
 */
function twoOptImprove(originLat, originLon, stops, roundtrip) {
  const arr = (stops || []).slice();
  if (arr.length < 4) return arr;
  let improved = true;
  let guard = 0;
  while (improved && guard < 80) {
    improved = false;
    guard += 1;
    const base = tourLengthHaversineKm(originLat, originLon, arr, roundtrip);
    for (let i = 0; i < arr.length - 1; i++) {
      for (let k = i + 1; k < arr.length; k++) {
        const cand = arr.slice(0, i).concat(arr.slice(i, k + 1).reverse(), arr.slice(k + 1));
        const len = tourLengthHaversineKm(originLat, originLon, cand, roundtrip);
        if (len + 1e-6 < base) {
          for (let t = 0; t < arr.length; t++) arr[t] = cand[t];
          improved = true;
          break;
        }
      }
      if (improved) break;
    }
  }
  return arr;
}

/**
 * Otimização local: agrupa por município (termina a cidade antes de ir à próxima),
 * NN dentro do cluster e entre clusters, depois 2-opt.
 * Evita o zig-zag SJP↔Paranaguá que a Trip pública do OSRM às vezes devolve.
 */
function otimizarParadasNearestNeighbor(originLat, originLon, stops, roundtrip) {
  const list = (stops || []).slice();
  if (list.length <= 1) return list;

  const byMun = new Map();
  for (const s of list) {
    const uf = String(s.UF || '')
      .trim()
      .toUpperCase();
    const mun = String(s.NM_MUNICIPIO || '')
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const key = `${uf}|${mun || '_SEM_'}`;
    if (!byMun.has(key)) byMun.set(key, []);
    byMun.get(key).push(s);
  }

  const clusters = [];
  for (const [, pts] of byMun) {
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (const p of pts) {
      const la = Number(p.LATITUDE);
      const lo = Number(p.LONGITUDE);
      if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
      sumLat += la;
      sumLon += lo;
      n += 1;
    }
    clusters.push({
      pts,
      clat: n ? sumLat / n : Number(originLat),
      clon: n ? sumLon / n : Number(originLon),
    });
  }

  const remaining = clusters.slice();
  const ordered = [];
  let curLat = Number(originLat);
  let curLon = Number(originLon);
  while (remaining.length) {
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(curLat, curLon, remaining[i].clat, remaining[i].clon);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const cluster = remaining.splice(bestI, 1)[0];
    const within = nnFromPoint(curLat, curLon, cluster.pts);
    for (const s of within) {
      ordered.push(s);
      const la = Number(s.LATITUDE);
      const lo = Number(s.LONGITUDE);
      if (Number.isFinite(la) && Number.isFinite(lo)) {
        curLat = la;
        curLon = lo;
      }
    }
  }

  return twoOptImprove(originLat, originLon, ordered, roundtrip !== false);
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const n = (file.originalname || '').toLowerCase();
    if (n.endsWith('.xml')) return cb(null, true);
    cb(new Error('Apenas arquivos .xml são aceitos.'));
  },
});

const uploadSeparacao = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
});

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function onlyDigitsLocal(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

/** Expressão SQL equivalente a normalizeNumeroEntregaMatch(e."NUMERO") (PostgreSQL). */
const SQL_NUMERO_ENTREGA_NORM = `COALESCE(NULLIF(regexp_replace(
  regexp_replace(
    regexp_replace(
      regexp_replace(
        upper(regexp_replace(trim(coalesce(e."NUMERO", '')), '[[:space:]]+', '', 'g')),
        '^(S/N|SN|-|\\.)$', 'SN', 'i'
      ),
      '^N\\.', '', 'i'
    ),
    '^N[°º]', '', 'i'
  ),
  '[^A-Z0-9]', '', 'g'
), ''), 'SN')`;

function sha256Short(s, n = 24) {
  return crypto.createHash('sha256').update(String(s || ''), 'utf8').digest('hex').slice(0, n);
}

function parseLatLonLocal(raw) {
  const t = String(raw || '').trim();
  if (!t) return { lat: null, lon: null, erro: 'Coordenadas vazias.' };
  const parts = t.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { lat: null, lon: null, erro: 'Use latitude, longitude (vírgula).' };
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { lat: null, lon: null, erro: 'Latitude/longitude inválida.' };
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return { lat: null, lon: null, erro: 'Coordenadas fora da faixa válida.' };
  return { lat, lon, erro: null };
}

function osrmExtractMetrics(data) {
  try {
    const r0 = data && data.routes && data.routes[0] ? data.routes[0] : null;
    if (!r0) return { distM: null, durS: null };
    let distM = r0.distance != null && Number.isFinite(Number(r0.distance)) ? Math.round(Number(r0.distance)) : null;
    let durS = r0.duration != null && Number.isFinite(Number(r0.duration)) ? Math.round(Number(r0.duration)) : null;
    if (r0.legs && Array.isArray(r0.legs) && r0.legs.length) {
      const ld = r0.legs.reduce((s, leg) => s + (Number(leg && leg.distance) || 0), 0);
      const lt = r0.legs.reduce((s, leg) => s + (Number(leg && leg.duration) || 0), 0);
      if (distM == null || !Number.isFinite(distM) || distM <= 0) distM = ld > 0 ? Math.round(ld) : distM;
      if (durS == null || !Number.isFinite(durS) || durS <= 0) durS = lt > 0 ? Math.round(lt) : durS;
    }
    return { distM, durS };
  } catch (_) {
    return { distM: null, durS: null };
  }
}

async function assertCargaTenant(tenantId, cdCarga) {
  const r = await pool.query(
    `SELECT "CD_CARGA" FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
    [cdCarga, tenantId]
  );
  return r.rows.length > 0;
}

/** Expedição iniciada ou encerrada: não alterar NF-e na carga, rota salva, importação de separação na carga, descrição, viagem rascunho, validação persistida. */
function expedicaoBloqueiaProgramacao(st) {
  const s = String(st || '').toUpperCase();
  return s === 'EM_EXPEDICAO' || s === 'EXPEDIDA';
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function assertCargaProgramacaoEditavel(tenantId, cdCarga) {
  try {
    const r = await pool.query(
      `SELECT "ST_EXPEDICAO" FROM "WMS_EXPEDICAO_CARGA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    if (!r.rowCount) return { ok: true };
    const st = String(r.rows[0].ST_EXPEDICAO || r.rows[0].st_expedicao || '').toUpperCase();
    if (!expedicaoBloqueiaProgramacao(st)) return { ok: true };
    if (st === 'EXPEDIDA') {
      return {
        ok: false,
        error:
          'Carga já expedida: a programação (NF-e, rota salva, separação na carga, descrição) não pode ser alterada. Use os relatórios para consulta.',
      };
    }
    return {
      ok: false,
      error:
        'Expedição em andamento: a programação desta carga está bloqueada. Imprimir romaneio/resumo é permitido; alterar NF, rota ou dados de montagem não.',
    };
  } catch (e) {
    if (schemaMissing(e)) return { ok: true };
    throw e;
  }
}

async function montarParadasOperacionaisNfes(tenantId, cdCarga) {
  const donoCliente = await resolveCdClienteDonoDaCarga(pool, tenantId, cdCarga);
  const rN = await pool.query(
    `SELECT j."ORDEM", j."CD_NFE_SAIDA", n.*
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
      ORDER BY j."ORDEM", j."CD_NFE_SAIDA"`,
    [cdCarga, tenantId]
  );
  const rows = rN.rows || [];

  /** @type {Map<string, any>} */
  const grupos = new Map();
  for (const n of rows) {
    const cnpjEntrega = onlyDigitsLocal(n.CNPJ_ENTREGA || n.CNPJ_DEST || '');
    const uf = String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2);
    const mun = String(n.XMUN_DEST || '').trim();
    const cep = onlyDigitsLocal(n.CEP_DEST || '');
    const logr = String(n.XLGR_DEST || '').trim();
    let nroRaw = String(n.NRO_DEST == null ? '' : n.NRO_DEST).trim();
    if (nroRaw === '.' || nroRaw === '-') nroRaw = '';
    const nro = nroRaw || 'S/N';
    const nroNorm = normalizeNumeroEntregaMatch(nro);
    const nome = nomeEntregaUnidadeOuLocalDestino(n);
    const chave = String(n.CHAVE_NFE || '').trim();
    const gk = sha256Short(`${tenantId}|${cnpjEntrega}|${uf}|${mun}|${cep}|${logr}|${nroNorm}|${nome}`);
    if (!grupos.has(gk)) {
      grupos.set(gk, {
        nfes: [],
        ORDEM_MIN: n.ORDEM,
        CNPJ_ENTREGA: cnpjEntrega || null,
        NM_ENTREGA: nome || null,
        UF: uf || null,
        NM_MUNICIPIO: mun || null,
        CEP: cep || null,
        LOGRADOURO: logr || null,
        NUMERO: nro,
      });
    }
    const g = grupos.get(gk);
    g.nfes.push({ CD_NFE_SAIDA: n.CD_NFE_SAIDA, CHAVE_NFE: chave, ORDEM: n.ORDEM });
    const om = Number(g.ORDEM_MIN);
    const on = Number(n.ORDEM);
    if (Number.isFinite(on) && (!Number.isFinite(om) || on < om)) g.ORDEM_MIN = n.ORDEM;
  }

  const paradas = [];
  let idx = 1;
  for (const [, g] of grupos) {
    let cdEnd = null;
    let lat = null;
    let lon = null;
    let matchStatus = 'PENDENTE';
    let matchVia = null;

    if (g.CNPJ_ENTREGA && g.CNPJ_ENTREGA.length === 14 && g.LOGRADOURO && g.UF && g.NM_MUNICIPIO) {
      const hit = await buscarEnderecoEntregaParaParada(pool, tenantId, {
        cnpjEntrega: g.CNPJ_ENTREGA,
        nmEntrega: g.NM_ENTREGA,
        uf: g.UF,
        municipio: g.NM_MUNICIPIO,
        cep: g.CEP,
        logradouro: g.LOGRADOURO,
        numero: g.NUMERO,
        cdClienteDono: donoCliente.cdCliente,
        cnpjDonoMatriz: donoCliente.cnpj14,
      });
      cdEnd = hit.cdEndereco;
      lat = hit.lat;
      lon = hit.lon;
      matchStatus = hit.matchStatus;
      matchVia = hit.matchVia;
    }

    paradas.push({
      ORDEM: idx++,
      ORDEM_NF: g.ORDEM_MIN,
      nfes: g.nfes,
      CNPJ_ENTREGA: g.CNPJ_ENTREGA,
      NM_ENTREGA: g.NM_ENTREGA,
      UF: g.UF,
      NM_MUNICIPIO: g.NM_MUNICIPIO,
      CEP: g.CEP,
      LOGRADOURO: g.LOGRADOURO,
      NUMERO: g.NUMERO,
      LATITUDE: lat,
      LONGITUDE: lon,
      CD_ENDERECO_ENTREGA: cdEnd,
      MATCH_STATUS: matchStatus,
      MATCH_VIA: matchVia,
    });
  }

  paradas.sort((a, b) => {
    const ao = Number(a.ORDEM_NF);
    const bo = Number(b.ORDEM_NF);
    if (Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo) return ao - bo;
    return a.ORDEM - b.ORDEM;
  });
  for (let i = 0; i < paradas.length; i++) paradas[i].ORDEM = i + 1;

  return { paradas, qNfes: rows.length, qParadas: paradas.length };
}

async function planejarParadasCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    if (!(await assertCargaTenant(tid, cd))) return res.status(404).json({ error: 'Carga não encontrada.' });
    const lockP = await assertCargaProgramacaoEditavel(tid, cd);
    if (!lockP.ok) return res.status(400).json({ error: lockP.error });
    const out = await montarParadasOperacionaisNfes(tid, cd);
    res.json(out);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura ausente para planejamento. Execute backend/scripts/adicionar_wms_carga_rota_operacional_postgres.sql (e tabela de endereços, se necessário).',
      });
    }
    console.error('[WMS carga] planejarParadasCarga:', e);
    res.status(500).json({ error: 'Erro ao planejar paradas.' });
  }
}

async function listarUnidadesEmbarqueWms(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const r = await pool.query(
      `SELECT cg."CDCADASTRO", cg."RZSOCIAL", cg."NMFANTASIA", cg."LATITUDE", cg."LONGITUDE"
         FROM "CADASTROGERAL" cg
        WHERE cg."TENANT_ID" = $1
          AND cg."FGACTIVE" = 'A'
          AND cg."FGUNIDADENEGOCIO" = 'S'
        ORDER BY COALESCE(NULLIF(trim(cg."NMFANTASIA"), ''), trim(cg."RZSOCIAL")) ASC NULLS LAST,
                 cg."CDCADASTRO" ASC`,
      [tid]
    );
    res.json({ unidades: r.rows || [] });
  } catch (e) {
    console.error('[WMS carga] listarUnidadesEmbarqueWms:', e);
    res.status(500).json({ error: 'Erro ao listar unidades de embarque.' });
  }
}

async function calcularSalvarRotaOperacionalCarga(req, res) {
  const client = await pool.connect();
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    if (!(await assertCargaTenant(tid, cd))) return res.status(404).json({ error: 'Carga não encontrada.' });
    const lockR = await assertCargaProgramacaoEditavel(tid, cd);
    if (!lockR.ok) return res.status(400).json({ error: lockR.error });

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let originLabel = body.originLabel != null ? String(body.originLabel).trim().slice(0, 200) : '';
    const retorna = String(body.returnToStart ?? body.RETORNA_ORIGEM ?? 'S').toUpperCase() === 'N' ? 'N' : 'S';

    const cdEmbRaw = body.cdCadastroEmbarque ?? body.CD_CADASTRO_EMBARQUE;
    let cdCadastroEmbarque = null;
    if (cdEmbRaw != null && String(cdEmbRaw).trim() !== '') {
      const n = parseInt(String(cdEmbRaw), 10);
      if (Number.isFinite(n) && n > 0) cdCadastroEmbarque = n;
    }

    let geo;
    if (cdCadastroEmbarque != null) {
      const u = await pool.query(
        `SELECT cg."RZSOCIAL", cg."NMFANTASIA", cg."LATITUDE", cg."LONGITUDE"
           FROM "CADASTROGERAL" cg
          WHERE cg."TENANT_ID" = $1 AND cg."CDCADASTRO" = $2::numeric
            AND cg."FGUNIDADENEGOCIO" = 'S' AND cg."FGACTIVE" = 'A'
          LIMIT 1`,
        [tid, cdCadastroEmbarque]
      );
      if (!u.rows.length) {
        return res.status(404).json({
          error: 'Unidade de negócio não encontrada, inativa ou sem perfil UN para este tenant.',
        });
      }
      const row = u.rows[0];
      const lat = Number(row.LATITUDE ?? row.latitude);
      const lon = Number(row.LONGITUDE ?? row.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return res.status(400).json({
          error:
            'A unidade selecionada não possui latitude/longitude no cadastro. Georreferencie em Gerenciar Cadastro Geral ou use coordenadas manuais.',
        });
      }
      geo = { lat, lon, erro: null };
      if (!originLabel) {
        originLabel =
          String(row.NMFANTASIA || row.nmfantasia || '')
            .trim()
            .slice(0, 200) ||
          String(row.RZSOCIAL || row.rzsocial || '')
            .trim()
            .slice(0, 200);
      }
    } else {
      geo = parseLatLonLocal(body.originCoordenadas ?? body.ORIGEM_COORDENADAS ?? body.originLatLon);
      if (geo.erro) return res.status(400).json({ error: `Origem: ${geo.erro}` });
    }

    const planned = await montarParadasOperacionaisNfes(tid, cd);
    const stops = planned.paradas || [];
    const faltantes = stops.filter((s) => !Number.isFinite(s.LATITUDE) || !Number.isFinite(s.LONGITUDE));
    if (faltantes.length) {
      return res.status(409).json({
        error:
          'Existem paradas sem coordenadas resolvíveis (match com endereço de entrega). Ajuste o cadastro de pontos ou informe coordenadas manualmente na próxima versão.',
        paradasPendentes: faltantes.map((x) => ({
          ORDEM: x.ORDEM,
          CNPJ_ENTREGA: x.CNPJ_ENTREGA,
          NM_ENTREGA: x.NM_ENTREGA,
          UF: x.UF,
          NM_MUNICIPIO: x.NM_MUNICIPIO,
          MATCH_STATUS: x.MATCH_STATUS,
        })),
      });
    }

    /** Trip API: 1 ponto de origem + N paradas; OSRM faz TSP nos intermediários e (se roundtrip) volta. */
    const tripParts = [`${geo.lon},${geo.lat}`];
    for (const s of stops) {
      tripParts.push(`${Number(s.LONGITUDE)},${Number(s.LATITUDE)}`);
    }
    const tripCoordsStr = tripParts.join(';');
    const roundtrip = retorna === 'S';

    /** Sempre calcula heurística local (cluster município + NN + 2-opt). Trip pública costuma zig-zag entre cidades. */
    const localOrder = otimizarParadasNearestNeighbor(geo.lat, geo.lon, stops, roundtrip);
    const localLenKm = tourLengthHaversineKm(geo.lat, geo.lon, localOrder, roundtrip);

    let trip = null;
    try {
      trip = await fetchTripRawByCoords(tripCoordsStr, tid, { roundtrip });
    } catch (err) {
      console.warn('[ROTA-TRIP] tentativa abortada:', err && err.message);
    }

    let tripOrder = null;
    let tripLenKm = Infinity;
    if (trip && trip.data) {
      const originalOrder = trip.optimizedOrder || [];
      if (originalOrder.length === stops.length + 1) {
        const reord = [];
        for (const idx of originalOrder) {
          if (idx === 0) continue;
          const stop = stops[idx - 1];
          if (stop) reord.push(stop);
        }
        if (reord.length === stops.length) {
          tripOrder = reord;
          tripLenKm = tourLengthHaversineKm(geo.lat, geo.lon, tripOrder, roundtrip);
        }
      }
    }

    /** Aceita Trip só se a linha reta for claramente melhor que a heurística local (≥2%). */
    const tripMelhor = tripOrder && Number.isFinite(tripLenKm) && tripLenKm < localLenKm * 0.98;
    let stopsOrdenados = tripMelhor ? tripOrder : localOrder;
    let usouOtimizacao = !!tripMelhor;
    if (tripOrder && !tripMelhor) {
      console.warn(
        `[ROTA-TRIP] ordem descartada (reta ${tripLenKm.toFixed(1)} km ≥ local ${localLenKm.toFixed(1)} km) — usando cluster/NN`
      );
    }

    /** Sempre Route na sequência escolhida (métricas de estrada batem com as paradas salvas). */
    const parts = [`${geo.lon},${geo.lat}`];
    for (const s of stopsOrdenados) {
      parts.push(`${Number(s.LONGITUDE)},${Number(s.LATITUDE)}`);
    }
    if (roundtrip) parts.push(`${geo.lon},${geo.lat}`);
    const coordsStr = parts.join(';');
    const winner = await fetchRouteMapRaw(coordsStr, tid);
    let data = winner && winner.data ? winner.data : null;
    if (!data) return res.status(502).json({ error: 'Falha ao calcular rota (OSRM/ORS).' });
    const normalized = normalizeRawToResumoShape(data);
    if (normalized) data = normalized;
    const metrics = osrmExtractMetrics(data);

    await client.query('BEGIN');
    const vRow = await client.query(
      `SELECT COALESCE(MAX("VERSAO"), 0)::integer + 1 AS v
         FROM "WMS_CARGA_ROTA_OPERACIONAL"
        WHERE "TENANT_ID" = $1 AND "CD_CARGA" = $2::integer`,
      [tid, cd]
    );
    const versao = vRow.rows[0].v || 1;
    const ins = await client.query(
      `INSERT INTO "WMS_CARGA_ROTA_OPERACIONAL" (
        "TENANT_ID","CD_CARGA","VERSAO","ST_ROTA",
        "ORIGEM_LAT","ORIGEM_LON","ORIGEM_LABEL","RETORNA_ORIGEM",
        "DISTANCIA_M","DURACAO_S","COORDS_OSRM","OSRM_JSON","ERRO_TEXTO","SG_USER",
        "CD_CADASTRO_EMBARQUE"
      ) VALUES ($1,$2,$3,'CALCULADA',$4,$5,$6,$7,$8,$9,$10,$11::jsonb,NULL,$12,$13)
      RETURNING *`,
      [
        tid,
        cd,
        versao,
        geo.lat,
        geo.lon,
        originLabel || null,
        retorna,
        metrics.distM,
        metrics.durS,
        coordsStr,
        JSON.stringify(data),
        sg,
        cdCadastroEmbarque != null ? cdCadastroEmbarque : null,
      ]
    );
    const ro = ins.rows[0];

    let ordemSalva = 1;
    for (const s of stopsOrdenados) {
      const n0 = Array.isArray(s.nfes) && s.nfes.length ? s.nfes[0] : null;
      await client.query(
        `INSERT INTO "WMS_CARGA_ROTA_PARADA" (
          "TENANT_ID","CD_ROTA_OPER","ORDEM","CD_NFE_SAIDA","CHAVE_NFE",
          "CNPJ_ENTREGA","NM_ENTREGA","UF","NM_MUNICIPIO","CEP","LOGRADOURO","NUMERO",
          "LATITUDE","LONGITUDE","CD_END_ENTREGA","MATCH_STATUS"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [
          tid,
          ro.CD_ROTA_OPER,
          ordemSalva,
          n0 && n0.CD_NFE_SAIDA != null ? parseInt(n0.CD_NFE_SAIDA, 10) : null,
          n0 && n0.CHAVE_NFE ? String(n0.CHAVE_NFE).slice(0, 60) : null,
          s.CNPJ_ENTREGA,
          s.NM_ENTREGA,
          s.UF,
          s.NM_MUNICIPIO,
          s.CEP,
          s.LOGRADOURO,
          s.NUMERO,
          s.LATITUDE,
          s.LONGITUDE,
          s.CD_ENDERECO_ENTREGA != null ? parseInt(String(s.CD_ENDERECO_ENTREGA), 10) : null,
          s.MATCH_STATUS || 'PENDENTE',
        ]
      );
      s.ORDEM = ordemSalva;
      ordemSalva += 1;
    }

    await client.query('COMMIT');
    res.status(201).json({
      rota: ro,
      paradas: stopsOrdenados,
      coords: coordsStr,
      distanciaM: metrics.distM,
      duracaoS: metrics.durS,
      otimizacao: usouOtimizacao ? 'TSP_OSRM' : 'CLUSTER_NN',
      tourRetaKm: Math.round(tourLengthHaversineKm(geo.lat, geo.lon, stopsOrdenados, roundtrip) * 10) / 10,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Tabelas de rota operacional ausentes. Execute backend/scripts/adicionar_wms_carga_rota_operacional_postgres.sql.',
      });
    }
    console.error('[WMS carga] calcularSalvarRotaOperacionalCarga:', e);
    res.status(500).json({ error: 'Erro ao calcular/salvar rota operacional.' });
  } finally {
    client.release();
  }
}

async function obterUltimaRotaOperacionalCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    if (!(await assertCargaTenant(tid, cd))) return res.status(404).json({ error: 'Carga não encontrada.' });
    const r0 = await pool.query(
      `SELECT * FROM "WMS_CARGA_ROTA_OPERACIONAL"
        WHERE "TENANT_ID" = $1 AND "CD_CARGA" = $2::integer
        ORDER BY "VERSAO" DESC, "CD_ROTA_OPER" DESC
        LIMIT 1`,
      [tid, cd]
    );
    if (!r0.rows.length) return res.json({ rota: null, paradas: [] });
    const ro = r0.rows[0];
    const idvRota = ro.IDVIAGEM != null ? Number(ro.IDVIAGEM) : null;
    if (Number.isFinite(idvRota) && idvRota > 0) {
      try {
        const vs = await pool.query(
          `SELECT "FGSITVIAGEM" FROM "VIAGEMMESTRE"
            WHERE "TENANT_ID" = $1 AND "IDVIAGEM" = $2::numeric LIMIT 1`,
          [tid, idvRota]
        );
        const fs = String(vs.rows[0]?.FGSITVIAGEM ?? vs.rows[0]?.fgsitviagem ?? '')
          .toUpperCase()
          .trim();
        if (fs === 'C') {
          ro.IDVIAGEM_HISTORICO_CANCELADA = idvRota;
          ro.IDVIAGEM = null;
        }
      } catch (_) {
        /* ignora se VIAGEMMESTRE indisponível */
      }
    }
    const rp = await pool.query(
      `SELECT * FROM "WMS_CARGA_ROTA_PARADA"
        WHERE "TENANT_ID" = $1 AND "CD_ROTA_OPER" = $2::bigint
        ORDER BY "ORDEM" ASC, "CD_ROTA_PARADA" ASC`,
      [tid, ro.CD_ROTA_OPER]
    );
    res.json({ rota: ro, paradas: rp.rows || [] });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Tabelas de rota operacional ausentes. Execute backend/scripts/adicionar_wms_carga_rota_operacional_postgres.sql.',
      });
    }
    console.error('[WMS carga] obterUltimaRotaOperacionalCarga:', e);
    res.status(500).json({ error: 'Erro ao buscar rota operacional.' });
  }
}

function linkViagemWmsSchemaMissing(err) {
  return err && err.code === '42703' && /WMS_CD_CARGA|WMS_CD_ROTA_OPER|"IDVIAGEM"/i.test(String(err.message || ''));
}

/** Defaults para viagem criada a partir da carga (tipo + situação compatíveis com FGSITVIAGEM). */
async function obterDefaultsViagemRascunho(tenantId) {
  const rTipo = await pool.query(
    `SELECT "CDTIPOVIAGEM" FROM "TIPOVIAGEM"
      WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
      ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDTIPOVIAGEM" ASC
      LIMIT 1`,
    [tenantId]
  );
  const cdTipo =
    rTipo.rows[0] && rTipo.rows[0].CDTIPOVIAGEM != null ? parseInt(String(rTipo.rows[0].CDTIPOVIAGEM), 10) : null;
  let rSit = { rows: [] };
  try {
    rSit = await pool.query(
      `SELECT "CDSITUACAOVIAGEM", "FGSITVIAGEM" FROM "SITUACAOVIAGEM"
        WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
          AND "FGSITVIAGEM" = 'P'
        ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDSITUACAOVIAGEM" ASC
        LIMIT 1`,
      [tenantId]
    );
  } catch (_) {
    rSit = { rows: [] };
  }
  if (!rSit.rows.length) {
    try {
      rSit = await pool.query(
        `SELECT "CDSITUACAOVIAGEM", "FGSITVIAGEM" FROM "SITUACAOVIAGEM"
          WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
          ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDSITUACAOVIAGEM" ASC
          LIMIT 1`,
        [tenantId]
      );
    } catch (_) {
      try {
        rSit = await pool.query(
          `SELECT "CDSITUACAOVIAGEM" FROM "SITUACAOVIAGEM"
            WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')
            ORDER BY CASE WHEN "TENANT_ID" = $1 THEN 0 ELSE 1 END, "CDSITUACAOVIAGEM" ASC
            LIMIT 1`,
          [tenantId]
        );
      } catch (e2) {
        rSit = { rows: [] };
      }
    }
  }
  const cdSit =
    rSit.rows[0] && rSit.rows[0].CDSITUACAOVIAGEM != null ? parseInt(String(rSit.rows[0].CDSITUACAOVIAGEM), 10) : null;
  const fgSit =
    rSit.rows[0] && rSit.rows[0].FGSITVIAGEM != null
      ? String(rSit.rows[0].FGSITVIAGEM).trim().slice(0, 1)
      : 'P';
  return { cdTipo, cdSit, fgSit };
}

/**
 * Cria registro em VIAGEMMESTRE (rascunho) a partir da última rota operacional calculada da carga,
 * grava vínculo WMS e aponta IDVIAGEM na rota salva.
 */
async function criarViagemRascunhoDeCarga(req, res) {
  const client = await pool.connect();
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    if (!(await assertCargaTenant(tid, cd))) return res.status(404).json({ error: 'Carga não encontrada.' });
    const lockV = await assertCargaProgramacaoEditavel(tid, cd);
    if (!lockV.ok) return res.status(400).json({ error: lockV.error });

    let rBloq;
    try {
      rBloq = await client.query(
        `SELECT v."IDVIAGEM"
           FROM "VIAGEMMESTRE" v
          WHERE v."TENANT_ID" = $1
            AND (v."FGACTIVE" = 'A' OR v."FGACTIVE" = 'S')
            AND COALESCE(upper(trim(v."FGSITVIAGEM"::text)), '') <> 'C'
            AND (
                  v."WMS_CD_CARGA" = $2::integer
               OR EXISTS (
                    SELECT 1 FROM "WMS_CARGA_ROTA_OPERACIONAL" ro
                     WHERE ro."TENANT_ID" = v."TENANT_ID"
                       AND ro."CD_CARGA" = $2::integer
                       AND ro."IDVIAGEM" IS NOT NULL
                       AND ro."IDVIAGEM" = v."IDVIAGEM"
                  )
                )
          LIMIT 1`,
        [tid, cd]
      );
    } catch (eB) {
      if (linkViagemWmsSchemaMissing(eB)) {
        return res.status(503).json({
          error:
            'Vínculo viagem ↔ carga WMS não está disponível neste banco. Peça ao administrador para aplicar os scripts de atualização.',
        });
      }
      throw eB;
    }
    if (rBloq.rows.length) {
      const idB = Number(rBloq.rows[0].IDVIAGEM ?? rBloq.rows[0].idviagem);
      return res.status(409).json({
        error:
          'Já existe viagem nº ' +
          idB +
          ' vinculada a esta carga. Cancele-a em Gerenciar Viagens (situação Cancelada) para gerar outra.',
        IDVIAGEM: idB,
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    let dtIni = body.DTPREVINICIO ? new Date(body.DTPREVINICIO) : new Date();
    let dtFin = body.DTPREVFINAL ? new Date(body.DTPREVFINAL) : new Date(Date.now() + 86400000 * 2);
    if (Number.isNaN(dtIni.getTime())) dtIni = new Date();
    if (Number.isNaN(dtFin.getTime())) dtFin = new Date(Date.now() + 86400000 * 2);
    const fgrast =
      body.FGRASTREADO != null && String(body.FGRASTREADO).trim() !== ''
        ? String(body.FGRASTREADO).trim().slice(0, 1).toUpperCase()
        : 'N';
    const fgrastOk = fgrast === 'S' ? 'S' : 'N';

    const rRo = await client.query(
      `SELECT * FROM "WMS_CARGA_ROTA_OPERACIONAL"
        WHERE "TENANT_ID" = $1 AND "CD_CARGA" = $2::integer AND "ST_ROTA" = 'CALCULADA'
        ORDER BY "VERSAO" DESC, "CD_ROTA_OPER" DESC
        LIMIT 1`,
      [tid, cd]
    );
    if (!rRo.rows.length) {
      return res.status(409).json({
        error: 'Calcule e salve a rota operacional (OSRM) antes de gerar a viagem.',
      });
    }
    const rota = rRo.rows[0];
    const idvNaRota = rota.IDVIAGEM != null ? Number(rota.IDVIAGEM) : null;
    if (Number.isFinite(idvNaRota) && idvNaRota > 0) {
      const vNaRota = await client.query(
        `SELECT "FGSITVIAGEM" FROM "VIAGEMMESTRE"
          WHERE "TENANT_ID" = $1 AND "IDVIAGEM" = $2::numeric LIMIT 1`,
        [tid, idvNaRota]
      );
      const fsR = String(vNaRota.rows[0]?.FGSITVIAGEM ?? vNaRota.rows[0]?.fgsitviagem ?? '')
        .toUpperCase()
        .trim();
      if (fsR !== 'C') {
        return res.status(409).json({
          error:
            'Esta versão da rota já está vinculada à viagem nº ' +
            idvNaRota +
            '. Cancele-a em Gerenciar Viagens para gerar outra.',
          IDVIAGEM: idvNaRota,
          CD_ROTA_OPER: Number(rota.CD_ROTA_OPER),
        });
      }
    }

    const rCarga = await client.query(
      `SELECT * FROM "WMS_CARGA_PROGRAMADA" WHERE "TENANT_ID" = $1 AND "CD_CARGA" = $2::integer`,
      [tid, cd]
    );
    const carga = rCarga.rows[0] || {};
    const defs = await obterDefaultsViagemRascunho(tid);
    if (!defs.cdTipo || !defs.cdSit) {
      return res.status(503).json({
        error:
          'Cadastre ao menos um tipo de viagem (TIPOVIAGEM) e uma situação de viagem (SITUACAOVIAGEM) para o tenant.',
      });
    }

    const maxR = await pool.query('SELECT COALESCE(MAX("IDVIAGEM"), 0) + 1 AS nid FROM "VIAGEMMESTRE"');
    const novoId = getFirstNumericValue(maxR.rows, 1);
    const distM = rota.DISTANCIA_M != null ? Number(rota.DISTANCIA_M) : null;
    const distKm = distM != null && Number.isFinite(distM) && distM > 0 ? Math.round((distM / 1000) * 10000) / 10000 : null;
    let cdContr = carga.CD_DONO != null ? parseInt(String(carga.CD_DONO), 10) : null;
    if (Number.isFinite(cdContr)) {
      const rCad = await client.query(
        `SELECT 1 FROM "CADASTROGERAL"
          WHERE "CDCADASTRO" = $1::numeric AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')
          LIMIT 1`,
        [cdContr, tid]
      );
      if (!rCad.rows.length) {
        cdContr = null;
      }
    } else {
      cdContr = null;
    }
    const cdRotaOper = parseInt(String(rota.CD_ROTA_OPER), 10);
    const versao = rota.VERSAO != null ? String(rota.VERSAO) : '';
    const nmDesc = String(carga.NM_DESCRICAO || '').trim().slice(0, 180);
    const observ = `[WMS] Carga #${cd} · Rota oper. v${versao} (CD_ROTA_OPER=${cdRotaOper})${nmDesc ? ` · ${nmDesc}` : ''}`;

    await client.query('BEGIN');

    const rPar = await client.query(
      `SELECT * FROM "WMS_CARGA_ROTA_PARADA"
        WHERE "TENANT_ID" = $1 AND "CD_ROTA_OPER" = $2::bigint
        ORDER BY "ORDEM" ASC, "CD_ROTA_PARADA" ASC`,
      [tid, cdRotaOper]
    );

    let idRot;
    let roteiroReutilizado = false;
    let roteiroMensagem = '';
    try {
      const roteiroOut = await obterOuCriarRoteiroFromWmsRotaOperacional(client, {
        tenantId: tid,
        sgUser: sg,
        cdCarga: cd,
        rota,
        paradas: rPar.rows || [],
      });
      idRot = roteiroOut.idRot;
      roteiroReutilizado = !!roteiroOut.reused;
      roteiroMensagem = roteiroOut.roteiroMensagem || '';
    } catch (re) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
      const msg = re && re.message ? String(re.message) : 'Erro ao montar roteiro.';
      console.error('[WMS carga] gerar viagem / roteiro:', re);
      if (
        msg.includes('CIDADE') ||
        msg.includes('paradas') ||
        msg.includes('transação') ||
        msg.includes('transaction')
      ) {
        return res.status(400).json({
          error:
            msg.includes('transação') || msg.includes('transaction')
              ? 'Falha ao montar o roteiro (transação interrompida). Reinicie o backend se acabou de atualizar o código e tente Gerar viagem de novo.'
              : msg,
        });
      }
      throw re;
    }

    await client.query(
      `INSERT INTO "VIAGEMMESTRE" (
        "IDVIAGEM", "FGSITVIAGEM", "CDSITUACAOVIAGEM", "CDTIPOVIAGEM", "CDCONTRATADOR",
        "CDCLASSEFROTA", "DTPREVINICIO", "DTPREVFINAL", "IDROTEIRO", "DISTANCIAKM",
        "VLFRETE", "PESO", "CUBAGEM", "OBSERV", "FGRASTREADO", "MOEDA", "SGUSERINCLUSAO", "DHINCLUSAO",
        "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID",
        "WMS_CD_CARGA", "WMS_CD_ROTA_OPER"
      ) VALUES (
        $1, $2, $3, $4, $5,
        NULL, $6, $7, $8, $9,
        NULL, NULL, NULL, $10, $11, $12, $13, CURRENT_TIMESTAMP,
        'A', CURRENT_TIMESTAMP, $13, 'AppDVcargas', $14,
        $15::integer, $16::bigint
      )`,
      [
        novoId,
        defs.fgSit,
        defs.cdSit,
        defs.cdTipo,
        Number.isFinite(cdContr) ? cdContr : null,
        dtIni,
        dtFin,
        idRot,
        distKm,
        observ.slice(0, 2048),
        fgrastOk,
        'BRL',
        sg,
        tid,
        cd,
        cdRotaOper,
      ]
    );

    await client.query(
      `UPDATE "WMS_CARGA_ROTA_OPERACIONAL"
          SET "IDVIAGEM" = $1::bigint,
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP
        WHERE "CD_ROTA_OPER" = $2::bigint AND "TENANT_ID" = $3`,
      [novoId, cdRotaOper, tid]
    );

    await client.query('COMMIT');

    const msgViagem =
      'Viagem rascunho criada a partir da rota operacional WMS.' +
      (roteiroMensagem ? ' ' + roteiroMensagem : '');
    res.status(201).json({
      success: true,
      message: msgViagem,
      IDVIAGEM: novoId,
      IDROTEIRO: idRot,
      roteiroReutilizado,
      roteiroMensagem: roteiroMensagem || undefined,
      CD_ROTA_OPER: cdRotaOper,
      WMS_CD_CARGA: cd,
      abrirModulo: { programa: 'gerenciar-viagens', idViagem: novoId },
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (linkViagemWmsSchemaMissing(e)) {
      return res.status(503).json({
        error:
          'Execute backend/scripts/adicionar_viagem_mestre_wms_carga_link_postgres.sql no PostgreSQL para habilitar o vínculo viagem ↔ carga.',
      });
    }
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura ausente. Verifique scripts WMS (carga/rota operacional) e o link com VIAGEMMESTRE.',
      });
    }
    if (e && e.code === '23503') {
      return res.status(400).json({
        error:
          'Violação de vínculo ao gravar a viagem (ex.: contratador ou roteiro inexistente no cadastro esperado). Detalhe: ' +
          (e.detail || e.message || ''),
      });
    }
    console.error('[WMS carga] criarViagemRascunhoDeCarga:', e);
    res.status(500).json({ error: e.message || 'Erro ao gerar viagem a partir da carga.' });
  } finally {
    client.release();
  }
}

/** Nomes para romaneio resumo (quebra por dono). */
async function carregarNomesDonosEstoque(tenantId, cds) {
  const uniq = [...new Set((cds || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return {};
  try {
    const r = await pool.query(
      `SELECT "CD_DONO",
              COALESCE(NULLIF(TRIM("NOME"), ''), 'Dono #' || "CD_DONO"::text) AS "NM_DONO"
         FROM "WMS_DONO_ESTOQUE"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = ANY($2::int[])`,
      [tenantId, uniq]
    );
    const out = {};
    for (const row of r.rows) {
      const k = Number(row.CD_DONO);
      out[k] = String(row.NM_DONO || '').trim() || `Dono #${k}`;
    }
    return out;
  } catch (e) {
    if (schemaMissing(e)) return {};
    throw e;
  }
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

/** Compara CGC do dono com CNPJ/CPF já normalizado (14 ou 11 dígitos). */
const SQL_CGC_DONO_EQ = `right(lpad(regexp_replace(trim(coalesce("CGC", '')), '[^0-9]', '', 'g'), 14, '0'), 14)`;
/** Raiz CNPJ (8 primeiros dígitos) do CGC do dono — usado quando FG_ACEITA_FILIAIS_RAIZ = 'S'. */
const SQL_CGC_DONO_RAIZ = `left(${SQL_CGC_DONO_EQ}, 8)`;

/** Detecção em runtime: a coluna FG_ACEITA_FILIAIS_RAIZ existe? (script SQL opcional). */
let _cacheFlagFiliaisColuna = null;
async function existeColunaAceitaFiliaisRaiz() {
  if (_cacheFlagFiliaisColuna !== null) return _cacheFlagFiliaisColuna;
  try {
    const r = await pool.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_name = 'WMS_DONO_ESTOQUE'
          AND column_name = 'FG_ACEITA_FILIAIS_RAIZ'
        LIMIT 1`
    );
    _cacheFlagFiliaisColuna = r.rows.length > 0;
  } catch (e) {
    _cacheFlagFiliaisColuna = false;
  }
  return _cacheFlagFiliaisColuna;
}

/** Cláusula de match: CGC exato sempre, e mesma raiz CNPJ se a flag estiver habilitada e a coluna existir. */
function buildClausulaMatchCgc(paramIndex, comFlagFiliais) {
  if (!comFlagFiliais) return `${SQL_CGC_DONO_EQ} = $${paramIndex}`;
  return (
    `(${SQL_CGC_DONO_EQ} = $${paramIndex}` +
    ` OR (COALESCE("FG_ACEITA_FILIAIS_RAIZ", 'N') = 'S'` +
    ` AND length($${paramIndex}) = 14` +
    ` AND length(regexp_replace(trim(coalesce("CGC", '')), '[^0-9]', '', 'g')) = 14` +
    ` AND ${SQL_CGC_DONO_RAIZ} = left($${paramIndex}, 8)))`
  );
}

async function resolveDonoByEmitenteCnpj(tenantId, cnpjEmit) {
  const cnpj = normDocFiscal(cnpjEmit);
  if (!cnpj || cnpj.length !== 14) {
    return { status: 'sem-cnpj', cdDono: null, dono: null };
  }
  const temFlag = await existeColunaAceitaFiliaisRaiz();
  const r = await pool.query(
    `SELECT "CD_DONO", "CODIGO", "NOME", "CGC"
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "FGACTIVE" = 'S'
        AND ${buildClausulaMatchCgc(2, temFlag)}
      ORDER BY ${SQL_CGC_DONO_EQ} = $2 DESC, "CD_DONO"`,
    [tenantId, cnpj]
  );
  if (!r.rows.length) return { status: 'nao-encontrado', cdDono: null, dono: null, cnpj };
  // Match exato vem primeiro pela ORDER BY; se houver, é o escolhido.
  const dono = r.rows[0];
  return {
    status: 'ok',
    cdDono: parseInt(dono.CD_DONO, 10),
    dono,
    cnpj,
  };
}

async function emitenteEhDono(tenantId, cdDono, cnpjEmit) {
  const cnpj = normDocFiscal(cnpjEmit);
  if (!cnpj || !Number.isFinite(cdDono)) return false;
  const len = cnpj.length;
  if (len !== 11 && len !== 14) return false;
  const temFlag = await existeColunaAceitaFiliaisRaiz();
  const r = await pool.query(
    `SELECT 1 FROM "WMS_DONO_ESTOQUE"
      WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2
        AND ${buildClausulaMatchCgc(3, temFlag)}`,
    [cdDono, tenantId, cnpj]
  );
  return r.rows.length > 0;
}

async function mensagemEmitenteNaoConfereDono(tenantId, cdDono, cnpjEmitXml) {
  const emit = normDocFiscal(cnpjEmitXml) || '(ausente no XML)';
  const temFlag = await existeColunaAceitaFiliaisRaiz();
  const colsExtra = temFlag
    ? `, COALESCE("FG_ACEITA_FILIAIS_RAIZ", 'N') AS "FG_ACEITA_FILIAIS_RAIZ"`
    : `, 'N'::char(1) AS "FG_ACEITA_FILIAIS_RAIZ"`;
  const r = await pool.query(
    `SELECT "NOME", "CGC", ${SQL_CGC_DONO_EQ} AS cgc_norm ${colsExtra}
       FROM "WMS_DONO_ESTOQUE"
      WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
    [cdDono, tenantId]
  );
  const row = r.rows[0];
  const cad = row ? row.cgc_norm || normDocFiscal(row.CGC) || '(sem CGC)' : '(dono não encontrado)';
  const nm = row ? String(row.NOME || '').trim() || `Dono #${cdDono}` : `Dono #${cdDono}`;
  const aceitaRaiz = row ? String(row.FG_ACEITA_FILIAIS_RAIZ).toUpperCase() === 'S' : false;
  let sufixo = ' Ajuste o CGC do dono ou importe XMLs do CNPJ cadastrado.';
  if (temFlag) {
    sufixo = aceitaRaiz
      ? ' O dono aceita filiais da mesma raiz CNPJ, mas a raiz do emitente também não bate.'
      : ' Para aceitar filiais da mesma raiz CNPJ, ligue a opção "Aceitar filiais" no cadastro do dono ou ajuste o CGC.';
  }
  return (
    `CNPJ/CPF do emitente da NF (${emit}) não coincide com o CGC cadastrado no dono "${nm}" (#${cdDono}: ${cad}).` +
    sufixo
  );
}

const uploadMiddleware = upload.fields([
  { name: 'arquivo', maxCount: 1 },
  { name: 'arquivos', maxCount: 500 },
]);

function parseOptionalInt(v) {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : NaN;
}

function normPlaca(v) {
  if (v == null) return null;
  const x = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return x || null;
}

function parseEspelhoSeparacaoTxt(txt) {
  const linhas = String(txt || '').split(/\r?\n/);
  const itens = [];
  let pedidoAtual = '';
  for (const raw of linhas) {
    const line = String(raw || '');
    if (!line.trim()) continue;
    const tipo = line.trim().charAt(0);
    if (tipo === '2') {
      const mPed = line.match(/[A-Z]{2}(\d{10})\d{6}/);
      if (mPed) pedidoAtual = mPed[1];
      continue;
    }
    if (tipo !== '3') continue;
    const mItem = line.match(/^3\s+(.*?)\s+\d{8,}\s+([0-9A-Z]{8,10})\s+(\d{10})\s*$/);
    if (!mItem) continue;
    const descricao = String(mItem[1] || '').trim();
    const codigo = String(mItem[2] || '').trim().toUpperCase();
    const qtd = Number(String(mItem[3] || '0').replace(/^0+/, '') || '0');
    if (!pedidoAtual || !codigo || !Number.isFinite(qtd)) continue;
    itens.push({
      NR_PEDIDO: pedidoAtual,
      COD_PRODUTO: codigo,
      DS_PRODUTO: descricao || null,
      UNIDADE: null,
      QTD_SEPARADA: qtd,
    });
  }
  return itens;
}

async function importarNfeSaidaXml(req, res) {
  uploadMiddleware(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Falha no upload.' });
    }
    const files = []
      .concat((req.files && req.files.arquivo) || [])
      .concat((req.files && req.files.arquivos) || []);
    if (!files.length) return res.status(400).json({ error: 'Envie XML no campo "arquivo" ou "arquivos".' });
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
    const sucessos = [];
    const erros = [];
    for (const file of files) {
      const nome = file.originalname || 'arquivo.xml';
      try {
        const xmlStr = file.buffer.toString('utf8');
        const parsed = parseNfeXml(xmlStr);
        if (parsed.err) throw new Error(parsed.err);
        const d = parsed.ok;
        let cdDonoFinal = cdDono;
        let donoOrigem = cdDonoFinal == null ? 'auto' : 'manual';
        let donoInferido = null;
        if (cdDonoFinal == null) {
          const infer = await resolveDonoByEmitenteCnpj(tid, d.cnpj_emitente);
          if (infer.status === 'ok') {
            cdDonoFinal = infer.cdDono;
            donoOrigem = 'emitente-cnpj';
            donoInferido = infer.dono;
          } else if (infer.status === 'ambiguo') {
            throw new Error(
              'Emitente da NF-e corresponde a mais de um dono ativo com o mesmo CNPJ. Selecione o dono manualmente.'
            );
          } else {
            throw new Error(
              'Defina o dono do estoque (emitente da NF de saída deve ser o dono). Selecione CD_DONO ou ajuste CGC do dono.'
            );
          }
        }
        const okEmit = await emitenteEhDono(tid, cdDonoFinal, d.cnpj_emitente);
        if (!okEmit) {
          throw new Error(await mensagemEmitenteNaoConfereDono(tid, cdDonoFinal, d.cnpj_emitente));
        }
        const baseParams = [
          tid,
          cdDonoFinal,
          d.chave,
          d.numero_nf || null,
          d.serie || null,
          d.dh_emissao,
          d.dh_saida || null,
          d.cnpj_emitente || null,
          d.xnome_emit || null,
          d.xmun_emit || null,
          d.uf_emit || null,
          d.cnpj_dest || null,
          d.xnome_dest || null,
          d.cnpj_entrega || null,
          d.xnome_entrega || null,
          d.xlgr_dest || null,
          d.nro_dest || null,
          d.xcpl_dest || null,
          d.xbairro_dest || null,
          d.xmun_dest || null,
          d.uf_dest || null,
          d.cep_dest || null,
          d.q_itens,
          JSON.stringify(d.linhas_json),
          sg,
        ];
        const vnfTotal =
          d.vnf_total != null && Number.isFinite(Number(d.vnf_total)) ? Number(d.vnf_total) : null;
        const paramsComDh = baseParams;
        const paramsSemDh = baseParams.slice(0, 6).concat(baseParams.slice(7));
        let r;
        try {
          r = await pool.query(
            `INSERT INTO "WMS_NFE_SAIDA" (
              "TENANT_ID", "CD_DONO", "CHAVE_NFE", "NUMERO_NF", "SERIE", "DH_EMISSAO", "DH_SAIDA",
              "CNPJ_EMITENTE", "XNOME_EMIT", "XMUN_EMIT", "UF_EMIT", "CNPJ_DEST", "XNOME_DEST",
              "CNPJ_ENTREGA", "XNOME_ENTREGA",
              "XLGR_DEST", "NRO_DEST", "XCPL_DEST", "XBAIRRO_DEST", "XMUN_DEST", "UF_DEST", "CEP_DEST",
              "Q_ITENS", "LINHAS_JSON", "SG_USER", "VNF_TOTAL"
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25, $26)
            ON CONFLICT ("TENANT_ID", "CHAVE_NFE") DO UPDATE SET
              "CD_DONO" = EXCLUDED."CD_DONO",
              "NUMERO_NF" = EXCLUDED."NUMERO_NF",
              "SERIE" = EXCLUDED."SERIE",
              "DH_EMISSAO" = EXCLUDED."DH_EMISSAO",
              "DH_SAIDA" = EXCLUDED."DH_SAIDA",
              "CNPJ_EMITENTE" = EXCLUDED."CNPJ_EMITENTE",
              "XNOME_EMIT" = EXCLUDED."XNOME_EMIT",
              "XMUN_EMIT" = EXCLUDED."XMUN_EMIT",
              "UF_EMIT" = EXCLUDED."UF_EMIT",
              "CNPJ_DEST" = EXCLUDED."CNPJ_DEST",
              "XNOME_DEST" = EXCLUDED."XNOME_DEST",
              "CNPJ_ENTREGA" = EXCLUDED."CNPJ_ENTREGA",
              "XNOME_ENTREGA" = EXCLUDED."XNOME_ENTREGA",
              "XLGR_DEST" = EXCLUDED."XLGR_DEST",
              "NRO_DEST" = EXCLUDED."NRO_DEST",
              "XCPL_DEST" = EXCLUDED."XCPL_DEST",
              "XBAIRRO_DEST" = EXCLUDED."XBAIRRO_DEST",
              "XMUN_DEST" = EXCLUDED."XMUN_DEST",
              "UF_DEST" = EXCLUDED."UF_DEST",
              "CEP_DEST" = EXCLUDED."CEP_DEST",
              "Q_ITENS" = EXCLUDED."Q_ITENS",
              "LINHAS_JSON" = EXCLUDED."LINHAS_JSON",
              "SG_USER" = EXCLUDED."SG_USER",
              "VNF_TOTAL" = EXCLUDED."VNF_TOTAL"
            RETURNING "CD_NFE_SAIDA", "CHAVE_NFE", "NUMERO_NF", "SERIE", "Q_ITENS", "DH_IMPORTACAO"`,
            [...paramsComDh, vnfTotal]
          );
        } catch (insErr) {
          if (insErr.code !== '42703') throw insErr;
          try {
            r = await pool.query(
              `INSERT INTO "WMS_NFE_SAIDA" (
                "TENANT_ID", "CD_DONO", "CHAVE_NFE", "NUMERO_NF", "SERIE", "DH_EMISSAO", "DH_SAIDA",
                "CNPJ_EMITENTE", "XNOME_EMIT", "XMUN_EMIT", "UF_EMIT", "CNPJ_DEST", "XNOME_DEST",
                "CNPJ_ENTREGA", "XNOME_ENTREGA",
                "XLGR_DEST", "NRO_DEST", "XCPL_DEST", "XBAIRRO_DEST", "XMUN_DEST", "UF_DEST", "CEP_DEST",
                "Q_ITENS", "LINHAS_JSON", "SG_USER"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb, $25)
              ON CONFLICT ("TENANT_ID", "CHAVE_NFE") DO UPDATE SET
                "CD_DONO" = EXCLUDED."CD_DONO",
                "NUMERO_NF" = EXCLUDED."NUMERO_NF",
                "SERIE" = EXCLUDED."SERIE",
                "DH_EMISSAO" = EXCLUDED."DH_EMISSAO",
                "DH_SAIDA" = EXCLUDED."DH_SAIDA",
                "CNPJ_EMITENTE" = EXCLUDED."CNPJ_EMITENTE",
                "XNOME_EMIT" = EXCLUDED."XNOME_EMIT",
                "XMUN_EMIT" = EXCLUDED."XMUN_EMIT",
                "UF_EMIT" = EXCLUDED."UF_EMIT",
                "CNPJ_DEST" = EXCLUDED."CNPJ_DEST",
                "XNOME_DEST" = EXCLUDED."XNOME_DEST",
                "CNPJ_ENTREGA" = EXCLUDED."CNPJ_ENTREGA",
                "XNOME_ENTREGA" = EXCLUDED."XNOME_ENTREGA",
                "XLGR_DEST" = EXCLUDED."XLGR_DEST",
                "NRO_DEST" = EXCLUDED."NRO_DEST",
                "XCPL_DEST" = EXCLUDED."XCPL_DEST",
                "XBAIRRO_DEST" = EXCLUDED."XBAIRRO_DEST",
                "XMUN_DEST" = EXCLUDED."XMUN_DEST",
                "UF_DEST" = EXCLUDED."UF_DEST",
                "CEP_DEST" = EXCLUDED."CEP_DEST",
                "Q_ITENS" = EXCLUDED."Q_ITENS",
                "LINHAS_JSON" = EXCLUDED."LINHAS_JSON",
                "SG_USER" = EXCLUDED."SG_USER"
              RETURNING "CD_NFE_SAIDA", "CHAVE_NFE", "NUMERO_NF", "SERIE", "Q_ITENS", "DH_IMPORTACAO"`,
              paramsComDh
            );
          } catch (insErr2) {
            if (insErr2.code !== '42703') throw insErr2;
            r = await pool.query(
              `INSERT INTO "WMS_NFE_SAIDA" (
                "TENANT_ID", "CD_DONO", "CHAVE_NFE", "NUMERO_NF", "SERIE", "DH_EMISSAO",
                "CNPJ_EMITENTE", "XNOME_EMIT", "XMUN_EMIT", "UF_EMIT", "CNPJ_DEST", "XNOME_DEST",
                "CNPJ_ENTREGA", "XNOME_ENTREGA",
                "XLGR_DEST", "NRO_DEST", "XCPL_DEST", "XBAIRRO_DEST", "XMUN_DEST", "UF_DEST", "CEP_DEST",
                "Q_ITENS", "LINHAS_JSON", "SG_USER"
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24)
              ON CONFLICT ("TENANT_ID", "CHAVE_NFE") DO UPDATE SET
                "CD_DONO" = EXCLUDED."CD_DONO",
                "NUMERO_NF" = EXCLUDED."NUMERO_NF",
                "SERIE" = EXCLUDED."SERIE",
                "DH_EMISSAO" = EXCLUDED."DH_EMISSAO",
                "CNPJ_EMITENTE" = EXCLUDED."CNPJ_EMITENTE",
                "XNOME_EMIT" = EXCLUDED."XNOME_EMIT",
                "XMUN_EMIT" = EXCLUDED."XMUN_EMIT",
                "UF_EMIT" = EXCLUDED."UF_EMIT",
                "CNPJ_DEST" = EXCLUDED."CNPJ_DEST",
                "XNOME_DEST" = EXCLUDED."XNOME_DEST",
                "CNPJ_ENTREGA" = EXCLUDED."CNPJ_ENTREGA",
                "XNOME_ENTREGA" = EXCLUDED."XNOME_ENTREGA",
                "XLGR_DEST" = EXCLUDED."XLGR_DEST",
                "NRO_DEST" = EXCLUDED."NRO_DEST",
                "XCPL_DEST" = EXCLUDED."XCPL_DEST",
                "XBAIRRO_DEST" = EXCLUDED."XBAIRRO_DEST",
                "XMUN_DEST" = EXCLUDED."XMUN_DEST",
                "UF_DEST" = EXCLUDED."UF_DEST",
                "CEP_DEST" = EXCLUDED."CEP_DEST",
                "Q_ITENS" = EXCLUDED."Q_ITENS",
                "LINHAS_JSON" = EXCLUDED."LINHAS_JSON",
                "SG_USER" = EXCLUDED."SG_USER"
              RETURNING "CD_NFE_SAIDA", "CHAVE_NFE", "NUMERO_NF", "SERIE", "Q_ITENS", "DH_IMPORTACAO"`,
              paramsSemDh
            );
          }
        }
        const rowNf = r.rows[0];
        let enderecoEntrega = null;
        try {
          enderecoEntrega = await provisionarEnderecoEntregaDaNf(
            pool,
            tid,
            { ...d, CD_DONO: cdDonoFinal },
            sg
          );
          if (enderecoEntrega && enderecoEntrega.cdEndereco != null) {
            await vincularEnderecoEntregaNf(pool, tid, rowNf.CD_NFE_SAIDA, enderecoEntrega.cdEndereco);
          }
        } catch (provErr) {
          console.error('[WMS carga] provisionarEnderecoEntregaDaNf:', provErr);
          enderecoEntrega = {
            status: 'ERRO',
            mensagem: provErr.message || 'Falha ao provisionar endereço de entrega.',
            cdEndereco: null,
            linkCompletar: null,
            pendencias: [],
          };
        }
        sucessos.push({
          arquivo: nome,
          ...rowNf,
          donoOrigem,
          donoVinculado:
            cdDonoFinal != null
              ? {
                  CD_DONO: cdDonoFinal,
                  CODIGO: donoInferido ? donoInferido.CODIGO : null,
                  NOME: donoInferido ? donoInferido.NOME : null,
                }
              : null,
          enderecoEntrega,
        });
      } catch (e) {
        if (schemaMissing(e)) {
          return res.status(503).json({
            error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
          });
        } else {
          erros.push({ arquivo: nome, error: e.message || 'Erro ao importar XML.' });
        }
      }
    }
    if (!sucessos.length) {
      return res.status(200).json({
        ok: false,
        totalArquivos: files.length,
        importados: 0,
        comErro: erros.length,
        sucessos: [],
        erros,
        mensagem: 'Nenhum XML novo foi importado (verifique os erros por arquivo).',
      });
    }
    if (files.length === 1 && !erros.length) return res.status(201).json(sucessos[0]);
    return res.status(200).json({
      ok: true,
      totalArquivos: files.length,
      importados: sucessos.length,
      comErro: erros.length,
      sucessos,
      erros,
    });
  });
}

async function listarNfesSaida(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const { where, params } = buildWhereNfesSaida(tid, req.query);
    const sqlComEndereco = `SELECT n.*,
              EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS "EM_CARGA",
              ${CARGAS_TXT_SQL} AS "CARGAS_TXT",
              e."ST_COMPLETUDE" AS "EE_ST_COMPLETUDE",
              e."CD_CLIENTE" AS "EE_CD_CLIENTE",
              e."NR_ROTA" AS "EE_NR_ROTA",
              n."CD_ENDERECO_ENTREGA"
         FROM "WMS_NFE_SAIDA" n
         LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
           ON e."CD_ENDERECO_ENTREGA" = n."CD_ENDERECO_ENTREGA"
          AND e."TENANT_ID" = n."TENANT_ID"
          AND e."FGACTIVE" = 'A'
        WHERE ${where.join(' AND ')}
        ORDER BY n."DH_IMPORTACAO" DESC
        LIMIT 500`;
    const sqlLegado = `SELECT n.*,
              EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS "EM_CARGA",
              ${CARGAS_TXT_SQL} AS "CARGAS_TXT"
         FROM "WMS_NFE_SAIDA" n
        WHERE ${where.join(' AND ')}
        ORDER BY n."DH_IMPORTACAO" DESC
        LIMIT 500`;
    let r;
    try {
      r = await pool.query(sqlComEndereco, params);
    } catch (e) {
      if (e && e.code === '42703') r = await pool.query(sqlLegado, params);
      else throw e;
    }
    res.json(r.rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] listarNfesSaida:', e);
    res.status(500).json({ error: 'Erro ao listar NF-e de saída.' });
  }
}

async function buscarNfeSaida(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdNfe = parseInt(req.params.cdNfeSaida, 10);
    if (!Number.isFinite(cdNfe)) return res.status(400).json({ error: 'Código da NF inválido.' });
    const r = await pool.query(
      `SELECT n.*,
              EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS "EM_CARGA"
         FROM "WMS_NFE_SAIDA" n
        WHERE n."TENANT_ID" = $1 AND n."CD_NFE_SAIDA" = $2::integer`,
      [tid, cdNfe]
    );
    if (!r.rows.length) return res.status(404).json({ error: 'NF-e não encontrada.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] buscarNfeSaida:', e);
    res.status(500).json({ error: 'Erro ao buscar detalhe da NF-e.' });
  }
}

async function listarNfesSaidaDisponiveis(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const r = await pool.query(
      `SELECT n.*
         FROM "WMS_NFE_SAIDA" n
        WHERE n."TENANT_ID" = $1
          AND NOT EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA")
        LIMIT 500`,
      [tid]
    );
    const rows = (r.rows || []).slice().sort(compareNfeDisponivelOrdenacao);
    res.json(rows);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] listarNfesSaidaDisponiveis:', e);
    res.status(500).json({ error: 'Erro ao listar NF-e disponíveis.' });
  }
}

/** Exclui importação de NF-e de saída (somente se não estiver em carga / expedição). */
async function excluirNfeSaida(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cdNfe = parseInt(req.params.cdNfeSaida, 10);
    if (!Number.isFinite(cdNfe)) return res.status(400).json({ error: 'Código inválido.' });

    const rLink = await pool.query(
      `SELECT j."CD_CARGA",
              COALESCE(ex."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') AS "ST_EXPEDICAO"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = $2
         LEFT JOIN "WMS_EXPEDICAO_CARGA" ex
           ON ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
        WHERE j."CD_NFE_SAIDA" = $1::integer
        LIMIT 1`,
      [cdNfe, tid]
    );
    if (rLink.rowCount) {
      const stEx = String(rLink.rows[0].ST_EXPEDICAO || '').toUpperCase();
      if (stEx === 'EM_EXPEDICAO' || stEx === 'EXPEDIDA') {
        return res.status(409).json({
          error:
            'NF vinculada a carga com expedição em andamento ou já expedida. Não é possível excluir a importação.',
        });
      }
      return res.status(409).json({
        error: `Remova a NF da carga #${rLink.rows[0].CD_CARGA} antes de excluir a importação.`,
      });
    }

    const rDel = await pool.query(
      `DELETE FROM "WMS_NFE_SAIDA"
        WHERE "CD_NFE_SAIDA" = $1::integer
          AND "TENANT_ID" = $2
        RETURNING "CD_NFE_SAIDA", "NUMERO_NF", "SERIE"`,
      [cdNfe, tid]
    );
    if (!rDel.rowCount) return res.status(404).json({ error: 'NF-e não encontrada.' });
    res.json({ ok: true, ...rDel.rows[0] });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    if (e && e.code === '23503') {
      return res.status(409).json({
        error: 'Não foi possível excluir: a NF-e ainda é referenciada em outro registro do WMS.',
      });
    }
    console.error('[WMS carga] excluirNfeSaida:', e);
    res.status(500).json({ error: 'Erro ao excluir importação da NF-e.' });
  }
}

function trimQuery(v) {
  if (v == null) return '';
  const s = String(v).trim();
  return s;
}

/**
 * Lista cargas programadas com filtros e paginação.
 * Resposta: { items, total, page, pageSize }.
 * Query: stCarga, dhCriacaoDe, dhCriacaoAte, dhExpedicaoDe, dhExpedicaoAte (YYYY-MM-DD; saída = DH_SAIDA),
 * busca (ID exato ou trecho da descrição), numeroNf, serie, idViagem,
 * stExpedicao (SEM_REGISTRO | PRONTA_EXPEDICAO | EM_EXPEDICAO | EXPEDIDA | NAO_EXPEDIDA), page, pageSize.
 */
async function listarCargas(req, res) {
  const tid = tenantIdForRequest(req);
  const stCarga = trimQuery(req.query.stCarga ?? req.query.statusCarga).toUpperCase();
  const stExpedicao = trimQuery(req.query.stExpedicao ?? req.query.st_expedicao).toUpperCase();
  const dhDe = trimQuery(req.query.dhCriacaoDe);
  const dhAte = trimQuery(req.query.dhCriacaoAte);
  const buscaRaw = trimQuery(req.query.busca ?? req.query.q);
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(5, parseInt(req.query.pageSize, 10) || 50));
  const offset = (page - 1) * pageSize;

  const buildWhere = (applyExpedicaoFilter) =>
    buildWhereCargasProgramadas(
      tid,
      {
        stCarga,
        stExpedicao: applyExpedicaoFilter ? stExpedicao : '',
        dhCriacaoDe: dhDe,
        dhCriacaoAte: dhAte,
        dhExpedicaoDe: trimQuery(req.query.dhExpedicaoDe ?? req.query.dh_expedicao_de),
        dhExpedicaoAte: trimQuery(req.query.dhExpedicaoAte ?? req.query.dh_expedicao_ate),
        busca: buscaRaw,
        numeroNf: trimQuery(req.query.numeroNf ?? req.query.numero_nf ?? req.query.nuNf),
        serie: trimQuery(req.query.serie ?? req.query.nuSerie),
        idViagem: trimQuery(req.query.idViagem ?? req.query.id_viagem ?? req.query.wmsIdViagem),
      },
      { applyStExpedicao: applyExpedicaoFilter }
    );

  /** Sempre que a tabela existir: espelha o módulo Expedição (sem linha = PRONTA_EXPEDICAO). */
  const stExpSelectComTabela = `COALESCE((
    SELECT exs."ST_EXPEDICAO"
      FROM "WMS_EXPEDICAO_CARGA" exs
     WHERE exs."CD_CARGA" = c."CD_CARGA"
       AND exs."TENANT_ID" = c."TENANT_ID"
     LIMIT 1
  ), 'PRONTA_EXPEDICAO')`;

  const dhInicioExpedicaoSql = `(
    SELECT exi."DH_INICIO"
      FROM "WMS_EXPEDICAO_CARGA" exi
     WHERE exi."CD_CARGA" = c."CD_CARGA"
       AND exi."TENANT_ID" = c."TENANT_ID"
     LIMIT 1
  )`;

  const run = async (includeExpedicaoColumn) => {
    const { where, params } = buildWhere(Boolean(stExpedicao));
    const wc = `WHERE ${where.join(' AND ')}`;
    const baseFrom = `
        FROM "WMS_CARGA_PROGRAMADA" c
        LEFT JOIN (
           SELECT "CD_CARGA", COUNT(*)::integer AS q
             FROM "WMS_CARGA_PROGRAMADA_NFE"
            GROUP BY "CD_CARGA"
         ) x ON x."CD_CARGA" = c."CD_CARGA"`;
    const countSql = `SELECT COUNT(*)::integer AS n ${baseFrom} ${wc}`;
    const stCol = includeExpedicaoColumn ? stExpSelectComTabela : `NULL::varchar`;
    const dhIniCol = includeExpedicaoColumn ? dhInicioExpedicaoSql : `NULL::timestamptz`;
    const idViagemRotaSql = `(
      SELECT ro."IDVIAGEM"
        FROM "WMS_CARGA_ROTA_OPERACIONAL" ro
        INNER JOIN "VIAGEMMESTRE" v ON v."IDVIAGEM" = ro."IDVIAGEM" AND v."TENANT_ID" = ro."TENANT_ID"
       WHERE ro."TENANT_ID" = c."TENANT_ID"
         AND ro."CD_CARGA" = c."CD_CARGA"
         AND ro."ST_ROTA" = 'CALCULADA'
         AND ro."IDVIAGEM" IS NOT NULL
         AND (v."FGACTIVE" = 'A' OR v."FGACTIVE" = 'S')
         AND COALESCE(upper(trim(v."FGSITVIAGEM"::text)), '') <> 'C'
       ORDER BY ro."VERSAO" DESC, ro."CD_ROTA_OPER" DESC
       LIMIT 1
    )`;
    const dataSql =
      `SELECT c.*, COALESCE(x.q, 0)::integer AS "Q_NFES", ${stCol} AS "ST_EXPEDICAO", ${dhIniCol} AS "DH_INICIO_EXPEDICAO", ${idViagemRotaSql} AS "WMS_IDVIAGEM_ROTA" ` +
      `${baseFrom} ${wc} ORDER BY c."DH_CRIACAO" DESC LIMIT $${params.length + 1}::integer OFFSET $${params.length + 2}::integer`;
    const countR = await pool.query(countSql, params);
    const total = Number(countR.rows[0].n || 0);
    const dataR = await pool.query(dataSql, [...params, pageSize, offset]);
    for (const row of dataR.rows) {
      row.ST_CARGA_PROGRAMADA = row.ST_CARGA;
      const ex = String(row.ST_EXPEDICAO || '').toUpperCase();
      if (ex === 'EXPEDIDA' || ex === 'EM_EXPEDICAO') {
        row.ST_CARGA = ex;
      }
    }
    return { total, rows: dataR.rows };
  };

  try {
    let result;
    try {
      result = await run(true);
    } catch (e) {
      if (schemaMissing(e)) {
        result = await run(false);
      } else {
        throw e;
      }
    }
    try {
      const ids = (result.rows || []).map((r) => r.CD_CARGA);
      const pesos = await agregarPesosConservacaoPorCargas(tid, ids);
      for (const row of result.rows || []) {
        const p = pesos.get(Number(row.CD_CARGA)) || pesos.get(row.CD_CARGA);
        row.PESO_KG = p ? p.pesoProduto : 0;
        row.PESO_KG_SECO = p ? p.pesoSeco : 0;
        row.PESO_KG_FRIO = p ? p.pesoFrio : 0;
      }
    } catch (ePeso) {
      console.warn('[WMS carga] listarCargas pesos:', ePeso && ePeso.message ? ePeso.message : ePeso);
      for (const row of result.rows || []) {
        row.PESO_KG = row.PESO_KG != null ? row.PESO_KG : 0;
        row.PESO_KG_SECO = row.PESO_KG_SECO != null ? row.PESO_KG_SECO : 0;
        row.PESO_KG_FRIO = row.PESO_KG_FRIO != null ? row.PESO_KG_FRIO : 0;
      }
    }
    res.json({
      items: result.rows,
      total: result.total,
      page,
      pageSize,
    });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] listarCargas:', e);
    res.status(500).json({ error: 'Erro ao listar cargas programadas.' });
  }
}

async function criarCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDonoRaw = req.body.CD_DONO ?? req.body.cd_dono;
    let cdDono = null;
    if (cdDonoRaw != null && String(cdDonoRaw).trim() !== '') {
      cdDono = parseOptionalInt(cdDonoRaw);
      if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'CD_DONO inválido.' });
      const ok = await assertDonoTenant(tid, cdDono);
      if (!ok) return res.status(400).json({ error: 'Dono do estoque não encontrado para este tenant.' });
    }
    const cdRota = parseOptionalInt(req.body.CD_ROTA ?? req.body.cdRota ?? req.body.rota);
    if (cdRota != null && !Number.isFinite(cdRota)) {
      return res.status(400).json({ error: 'CD_ROTA inválido.' });
    }
    const nmRota =
      req.body.NM_ROTA != null
        ? String(req.body.NM_ROTA).trim().slice(0, 120)
        : req.body.nmRota != null
          ? String(req.body.nmRota).trim().slice(0, 120)
          : '';
    const nm =
      req.body.NM_DESCRICAO != null
        ? String(req.body.NM_DESCRICAO).trim().slice(0, 200)
        : req.body.nmDescricao != null
          ? String(req.body.nmDescricao).trim().slice(0, 200)
          : '';
    if (!nm) return res.status(400).json({ error: 'Descrição da carga é obrigatória.' });
    const obs = req.body.OBS != null ? String(req.body.OBS).trim().slice(0, 2000) : null;
    const transportadoraDoc =
      req.body.TRANSPORTADORA_DOC != null
        ? normDocFiscal(req.body.TRANSPORTADORA_DOC)
        : req.body.transportadoraDoc != null
          ? normDocFiscal(req.body.transportadoraDoc)
          : null;
    const nmMotorista =
      req.body.NM_MOTORISTA != null
        ? String(req.body.NM_MOTORISTA).trim().slice(0, 120)
        : req.body.nmMotorista != null
          ? String(req.body.nmMotorista).trim().slice(0, 120)
          : '';
    const placa = normPlaca(req.body.PLACA ?? req.body.placa);
    const r = await pool.query(
      `INSERT INTO "WMS_CARGA_PROGRAMADA"
        ("TENANT_ID", "CD_DONO", "CD_ROTA", "NM_ROTA", "NM_DESCRICAO", "TRANSPORTADORA_DOC", "NM_MOTORISTA", "PLACA", "ST_CARGA", "SG_USER", "OBS")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'RASCUNHO', $9, $10)
       RETURNING *`,
      [tid, cdDono, cdRota, nmRota || null, nm || null, transportadoraDoc || null, nmMotorista || null, placa, sg, obs]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] criarCarga:', e);
    res.status(500).json({ error: 'Erro ao criar carga programada.' });
  }
}

async function atualizarCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cdCarga)) return res.status(400).json({ error: 'Código da carga inválido.' });
    const lock = await assertCargaProgramacaoEditavel(tid, cdCarga);
    if (!lock.ok) return res.status(400).json({ error: lock.error });

    const rCur = await pool.query(
      `SELECT "NM_DESCRICAO", "CD_DONO"
         FROM "WMS_CARGA_PROGRAMADA"
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdCarga, tid]
    );
    if (!rCur.rowCount) return res.status(404).json({ error: 'Carga não encontrada.' });

    const hasDesc =
      Object.prototype.hasOwnProperty.call(req.body, 'NM_DESCRICAO') ||
      Object.prototype.hasOwnProperty.call(req.body, 'nmDescricao');
    const hasDono =
      Object.prototype.hasOwnProperty.call(req.body, 'CD_DONO') ||
      Object.prototype.hasOwnProperty.call(req.body, 'cd_dono');

    let nm = rCur.rows[0].NM_DESCRICAO != null ? String(rCur.rows[0].NM_DESCRICAO).trim() : '';
    if (hasDesc) {
      nm =
        req.body.NM_DESCRICAO != null
          ? String(req.body.NM_DESCRICAO).trim().slice(0, 200)
          : String(req.body.nmDescricao).trim().slice(0, 200);
    }
    if (!nm) return res.status(400).json({ error: 'Descrição da carga é obrigatória.' });

    let cdDono =
      rCur.rows[0].CD_DONO != null && Number.isFinite(Number(rCur.rows[0].CD_DONO))
        ? Number(rCur.rows[0].CD_DONO)
        : null;
    if (hasDono) {
      const raw = req.body.CD_DONO !== undefined ? req.body.CD_DONO : req.body.cd_dono;
      if (raw === null || raw === undefined || raw === '') {
        cdDono = null;
      } else {
        const n = parseInt(String(raw), 10);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'CD_DONO inválido.' });
        const rD = await pool.query(
          `SELECT 1 FROM "WMS_DONO_ESTOQUE" WHERE "CD_DONO" = $1::integer AND "TENANT_ID" = $2`,
          [n, tid]
        );
        if (!rD.rowCount) return res.status(400).json({ error: 'Dono do estoque não encontrado.' });
        cdDono = n;
      }
    }

    const r = await pool.query(
      `UPDATE "WMS_CARGA_PROGRAMADA"
          SET "NM_DESCRICAO" = $3,
              "CD_DONO" = $4,
              "SG_USER" = $5
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2
      RETURNING *`,
      [cdCarga, tid, nm, cdDono, sg]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Carga não encontrada.' });
    res.json(r.rows[0]);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] atualizarCarga:', e);
    res.status(500).json({ error: 'Erro ao atualizar carga programada.' });
  }
}

/** GET — prévia: NF disponíveis → cargas por NR_ROTA (cadastro endereços de entrega). */
async function previewDistribuirNfPorRota(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await montarPlanoDistribuicaoNfPorRota(tid, req.query || {});
    res.json(out);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] previewDistribuirNfPorRota:', e);
    res.status(500).json({ error: 'Erro ao montar prévia de distribuição.' });
  }
}

/** POST — aplica distribuição (recomputa o plano no momento da gravação). */
async function aplicarDistribuirNfPorRotaHandler(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const q = { ...(req.query || {}), ...(req.body || {}) };
    const out = await aplicarDistribuicaoNfPorRota(tid, sg, q);
    if (!out.ok) return res.status(400).json({ error: out.err, plano: out.plano });
    res.json(out);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] aplicarDistribuirNfPorRota:', e);
    res.status(500).json({ error: 'Erro ao distribuir NF-e nas cargas.' });
  }
}

async function mesclarCargas(req, res) {
  const tid = tenantIdForRequest(req);
  const sg = getSgUser(req);
  if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
  const cdDestino = parseInt(req.body.CD_CARGA_DESTINO ?? req.body.cdCargaDestino, 10);
  const cdOrigem = parseInt(req.body.CD_CARGA_ORIGEM ?? req.body.cdCargaOrigem, 10);
  if (!Number.isFinite(cdDestino) || !Number.isFinite(cdOrigem)) {
    return res.status(400).json({ error: 'Informe CD_CARGA_DESTINO e CD_CARGA_ORIGEM.' });
  }
  if (cdDestino === cdOrigem) {
    return res.status(400).json({ error: 'Origem e destino não podem ser a mesma carga.' });
  }
  const modoDescricao = String(req.body.modoDescricao ?? req.body.descricaoMesclagem ?? 'manter_destino')
    .trim()
    .toLowerCase();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const first = Math.min(cdOrigem, cdDestino);
    const second = Math.max(cdOrigem, cdDestino);
    const r1 = await client.query(
      `SELECT * FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2 FOR UPDATE`,
      [first, tid]
    );
    const r2 = await client.query(
      `SELECT * FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2 FOR UPDATE`,
      [second, tid]
    );
    const map = new Map();
    for (const row of r1.rows) map.set(row.CD_CARGA, row);
    for (const row of r2.rows) map.set(row.CD_CARGA, row);
    const origem = map.get(cdOrigem);
    const destino = map.get(cdDestino);
    if (!origem || !destino) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Carga não encontrada.' });
    }
    if (String(origem.ST_CARGA || '').toUpperCase() !== 'RASCUNHO' || String(destino.ST_CARGA || '').toUpperCase() !== 'RASCUNHO') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Só é possível mesclar cargas em RASCUNHO.' });
    }

    try {
      const expR = await client.query(
        `SELECT "CD_CARGA", "ST_EXPEDICAO"
           FROM "WMS_EXPEDICAO_CARGA"
          WHERE "TENANT_ID" = $1
            AND "CD_CARGA" = ANY($2::int[])`,
        [tid, [cdOrigem, cdDestino]]
      );
      for (const row of expR.rows) {
        const st = String(row.ST_EXPEDICAO || '').toUpperCase();
        if (st === 'EM_EXPEDICAO' || st === 'EXPEDIDA') {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Não é possível mesclar: uma das cargas já está em expedição ou foi expedida.',
          });
        }
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }

    const cntO = await client.query(
      `SELECT COUNT(*)::integer AS c FROM "WMS_CARGA_PROGRAMADA_NFE" WHERE "CD_CARGA" = $1::integer`,
      [cdOrigem]
    );
    const nMovidas = Number(cntO.rows[0].c || 0);
    if (nMovidas <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'A carga de origem não possui NF-e para mesclar.' });
    }

    await client.query(
      `UPDATE "WMS_CARGA_PROGRAMADA_NFE" SET "CD_CARGA" = $1::integer WHERE "CD_CARGA" = $2::integer`,
      [cdDestino, cdOrigem]
    );

    await client.query(
      `WITH ranked AS (
         SELECT "CD_NFE_SAIDA",
                ROW_NUMBER() OVER (
                  ORDER BY "ORDEM" ASC NULLS LAST, "DH_INCLUSAO" ASC NULLS LAST, "CD_NFE_SAIDA" ASC
                ) AS rn
           FROM "WMS_CARGA_PROGRAMADA_NFE"
          WHERE "CD_CARGA" = $1::integer
       )
       UPDATE "WMS_CARGA_PROGRAMADA_NFE" j
          SET "ORDEM" = ranked.rn
         FROM ranked
        WHERE j."CD_CARGA" = $1::integer
          AND j."CD_NFE_SAIDA" = ranked."CD_NFE_SAIDA"`,
      [cdDestino]
    );

    if (modoDescricao === 'concatenar') {
      const d1 = String(destino.NM_DESCRICAO || '').trim();
      const d2 = String(origem.NM_DESCRICAO || '').trim();
      const merged = [d1, d2].filter(Boolean).join(' + ').slice(0, 200);
      if (merged) {
        await client.query(
          `UPDATE "WMS_CARGA_PROGRAMADA"
              SET "NM_DESCRICAO" = $3, "SG_USER" = $4
            WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
          [cdDestino, tid, merged, sg]
        );
      }
    }

    await client.query(
      `DELETE FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdOrigem, tid]
    );

    await client.query('COMMIT');

    const rFinal = await pool.query(
      `SELECT c.*, COALESCE(x.q, 0)::integer AS "Q_NFES"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN (
           SELECT "CD_CARGA", COUNT(*)::integer AS q
             FROM "WMS_CARGA_PROGRAMADA_NFE"
            GROUP BY "CD_CARGA"
         ) x ON x."CD_CARGA" = c."CD_CARGA"
        WHERE c."CD_CARGA" = $1::integer AND c."TENANT_ID" = $2`,
      [cdDestino, tid]
    );
    res.json({
      ok: true,
      CD_CARGA_DESTINO: cdDestino,
      CD_CARGA_ORIGEM_REMOVIDA: cdOrigem,
      NF_MOVidas: nMovidas,
      carga: rFinal.rows[0] || null,
    });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] mesclarCargas:', e);
    res.status(500).json({ error: 'Erro ao mesclar cargas.' });
  } finally {
    client.release();
  }
}

async function excluirCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cdCarga)) return res.status(400).json({ error: 'Código da carga inválido.' });
    const chk = await pool.query(
      `SELECT c."CD_CARGA", c."ST_CARGA",
              COALESCE((
                SELECT COUNT(*)::integer
                  FROM "WMS_CARGA_PROGRAMADA_NFE" j
                 WHERE j."CD_CARGA" = c."CD_CARGA"
              ), 0) AS q_nfes
         FROM "WMS_CARGA_PROGRAMADA" c
        WHERE c."CD_CARGA" = $1::integer
          AND c."TENANT_ID" = $2`,
      [cdCarga, tid]
    );
    if (!chk.rowCount) return res.status(404).json({ error: 'Carga não encontrada.' });
    const row = chk.rows[0];
    try {
      const expR = await pool.query(
        `SELECT "ST_EXPEDICAO" FROM "WMS_EXPEDICAO_CARGA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
        [cdCarga, tid]
      );
      if (expR.rowCount) {
        const stEx = String(expR.rows[0].ST_EXPEDICAO || '').toUpperCase();
        if (stEx === 'EM_EXPEDICAO' || stEx === 'EXPEDIDA') {
          return res.status(400).json({
            error: 'Não é possível excluir: a carga está em expedição ou já foi expedida.',
          });
        }
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
    if (String(row.ST_CARGA || '').toUpperCase() !== 'RASCUNHO') {
      return res.status(400).json({ error: 'Somente cargas em RASCUNHO podem ser excluídas.' });
    }
    if (Number(row.q_nfes || 0) > 0) {
      return res.status(400).json({ error: 'Remova as NF-e da carga antes de excluir.' });
    }
    await pool.query(
      `DELETE FROM "WMS_CARGA_PROGRAMADA"
        WHERE "CD_CARGA" = $1::integer
          AND "TENANT_ID" = $2`,
      [cdCarga, tid]
    );
    res.json({ ok: true, CD_CARGA: cdCarga });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] excluirCarga:', e);
    res.status(500).json({ error: 'Erro ao excluir carga programada.' });
  }
}

/** Parse LINHAS_JSON tolerando string ou array. */
function linhasJsonArray(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/**
 * Cabeçalho da carga com expedição (quando a tabela existir).
 */
async function buscarCargaCabecalhoRelatorio(tenantId, cdCarga) {
  try {
    const r = await pool.query(
      `SELECT c.*,
              e."ST_EXPEDICAO", e."DH_INICIO", e."DH_SAIDA", e."NM_CONFERENTE",
              e."NM_MOTORISTA" AS "NM_MOTORISTA_EXPEDICAO",
              e."PLACA" AS "PLACA_EXPEDICAO"
         FROM "WMS_CARGA_PROGRAMADA" c
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e
           ON e."CD_CARGA" = c."CD_CARGA"
          AND e."TENANT_ID" = c."TENANT_ID"
        WHERE c."CD_CARGA" = $1::integer
          AND c."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const exM = row.NM_MOTORISTA_EXPEDICAO != null ? String(row.NM_MOTORISTA_EXPEDICAO).trim() : '';
    const exP = row.PLACA_EXPEDICAO != null ? String(row.PLACA_EXPEDICAO).trim() : '';
    if (exM) row.NM_MOTORISTA = exM;
    if (exP) row.PLACA = exP;
    delete row.NM_MOTORISTA_EXPEDICAO;
    delete row.PLACA_EXPEDICAO;
    return row;
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    const r2 = await pool.query(
      `SELECT * FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    return r2.rows[0] || null;
  }
}

async function montarPayloadRomaneio(tenantId, cdCarga) {
  const cargaRow = await buscarCargaCabecalhoRelatorio(tenantId, cdCarga);
  if (!cargaRow) return null;
  const rN = await pool.query(
    `SELECT j."ORDEM", n.*
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
      ORDER BY j."ORDEM", n."CD_NFE_SAIDA"`,
    [cdCarga, tenantId]
  );
  const destinos = new Map();
  const totais = { nfes: 0, itensDistintos: 0, volumes: 0 };
  const itensCarga = new Map();
  for (const n of rN.rows) {
    totais.nfes += 1;
    const destinoKey = `${n.CNPJ_DEST || ''}|${(n.XNOME_DEST || '').trim()}|${n.NUMERO_NF || ''}`;
    if (!destinos.has(destinoKey)) {
      destinos.set(destinoKey, {
        cnpjDest: n.CNPJ_DEST || null,
        nomeDest: n.XNOME_DEST || null,
        numeroNf: n.NUMERO_NF || null,
        serie: n.SERIE || null,
        chaveNfe: n.CHAVE_NFE,
        ordem: n.ORDEM || null,
        itens: [],
        volumes: 0,
      });
    }
    const grupo = destinos.get(destinoKey);
    const linhas = linhasJsonArray(n.LINHAS_JSON);
    for (const linha of linhas) {
      const codigo = (linha.codigo || linha.cProd || '').toString().trim();
      const descricao = (linha.descricao || linha.xProd || '').toString().trim();
      const unidade = (linha.unidade || linha.uCom || '').toString().trim();
      const q = Number(linha.quantidade || linha.qCom || linha.qTrib || 0);
      if (!q || !Number.isFinite(q)) continue;
      grupo.itens.push({ codigo: codigo || null, descricao: descricao || null, unidade: unidade || null, quantidade: q });
      grupo.volumes += q;
      const itemKey = `${codigo}|${descricao}|${unidade}`;
      const atual = itensCarga.get(itemKey) || {
        codigo: codigo || null,
        descricao: descricao || null,
        unidade: unidade || null,
        quantidade: 0,
      };
      atual.quantidade += q;
      itensCarga.set(itemKey, atual);
    }
  }
  totais.itensDistintos = itensCarga.size;
  totais.volumes = Array.from(itensCarga.values()).reduce((acc, i) => acc + (i.quantidade || 0), 0);
  const destinosOrdenados = Array.from(destinos.values()).sort((a, b) => {
    const oa = Number.isFinite(a.ordem) ? a.ordem : 999999;
    const ob = Number.isFinite(b.ordem) ? b.ordem : 999999;
    if (oa !== ob) return oa - ob;
    return (a.nomeDest || '').localeCompare(b.nomeDest || '', 'pt-BR');
  });
  const geradoEm = new Date().toISOString();
  return {
    carga: cargaRow,
    totais,
    itensConsolidados: Array.from(itensCarga.values()).sort((a, b) =>
      (a.descricao || '').localeCompare(b.descricao || '', 'pt-BR')
    ),
    destinos: destinosOrdenados,
    geradoEm,
  };
}

async function gerarRomaneioCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const fmt = String(req.query.format || req.query.fmt || '').toLowerCase();
    const payload = await montarPayloadRomaneio(tid, cd);
    if (!payload) return res.status(404).json({ error: 'Carga não encontrada.' });
    if (fmt === 'html' || fmt === 'print') {
      const rN = await pool.query(
        `SELECT j."ORDEM", n.*
           FROM "WMS_CARGA_PROGRAMADA_NFE" j
           JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
          WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
          ORDER BY j."ORDEM", n."CD_NFE_SAIDA"`,
        [cd, tid]
      );
      let nfRowsRom = rN.rows;
      const cdDonoFiltro = parseInt(req.query.cdDono ?? req.query.cd_dono, 10);
      if (Number.isFinite(cdDonoFiltro) && cdDonoFiltro > 0) {
        nfRowsRom = nfRowsRom.filter((n) => Number(n.CD_DONO) === cdDonoFiltro);
      }
      const unidadesFiltro = lerListaQueryParam(req, 'unidades');
      if (unidadesFiltro.length) {
        nfRowsRom = filtrarNfRowsPorUnidades(nfRowsRom, unidadesFiltro);
      }
      const destinosFiltro = lerListaQueryParam(req, 'destinos');
      if (destinosFiltro.length) {
        nfRowsRom = filtrarNfRowsPorDestinos(nfRowsRom, destinosFiltro);
      }
      const codigosFiltro = lerListaQueryParam(req, 'codigos');
      const agruparItens = req.query.agruparItens !== '0' && req.query.agruparItens !== 'false';
      const ordemCamposValidos = new Set(['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo']);
      const ordem = String(req.query.ordem || '')
        .split(',')
        .map((x) => String(x || '').trim().toLowerCase())
        .filter((x, idx, arr) => x && ordemCamposValidos.has(x) && arr.indexOf(x) === idx);
      const conservacaoRaw = String(req.query.conservacao || 'todos').toLowerCase();
      const conservacao = conservacaoRaw === 'refri' || conservacaoRaw === 'seco' ? conservacaoRaw : 'todos';
      const folhasRaw = String(req.query.folhas || 'dono').toLowerCase();
      const folhasValid = new Set(['nota', 'dest', 'endereco', 'continuo', 'dono']);
      const folhas = folhasValid.has(folhasRaw) ? folhasRaw : 'dono';
      const digitos = collectDigitosCargaNfe(nfRowsRom);
      const setDonoNf = new Set();
      for (const n of nfRowsRom) {
        if (n.CD_DONO != null && n.CD_DONO !== '' && Number.isFinite(Number(n.CD_DONO))) {
          setDonoNf.add(Number(n.CD_DONO));
        }
      }
      let cdDonoMapa = null;
      if (setDonoNf.size > 1) cdDonoMapa = null;
      else if (setDonoNf.size === 1) cdDonoMapa = [...setDonoNf][0];
      else if (payload.carga.CD_DONO != null && Number.isFinite(Number(payload.carga.CD_DONO))) {
        cdDonoMapa = Number(payload.carga.CD_DONO);
      }
      let produtoPorDigitos = {};
      try {
        produtoPorDigitos = await carregarMapaProdutosDonoPorDigitos(tid, cdDonoMapa, digitos);
      } catch (e2) {
        if (!schemaMissing(e2)) console.warn('[WMS carga] resumo picking cadastro produto:', e2.message || e2);
        produtoPorDigitos = {};
      }
      const cdsNome = [...setDonoNf];
      if (payload.carga.CD_DONO != null && Number.isFinite(Number(payload.carga.CD_DONO))) {
        cdsNome.push(Number(payload.carga.CD_DONO));
      }
      const donoNomes = await carregarNomesDonosEstoque(tid, cdsNome);
      const html = buildRomaneioResumoPickingHtml({
        carga: payload.carga,
        nfRows: nfRowsRom,
        produtoPorDigitos,
        donoNomes,
        opts: {
          conservacao,
          agruparItens,
          ordem,
          folhas,
          filtrosUnidades: unidadesFiltro,
          filtrosDestinos: destinosFiltro,
          filtrosCodigos: codigosFiltro,
        },
        geradoEm: payload.geradoEm,
      });
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }
    res.json(payload);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] gerarRomaneioCarga:', e);
    res.status(500).json({ error: 'Erro ao gerar romaneio da carga.' });
  }
}

async function relatorioFriosCargaHtml(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    const cargaRow = await buscarCargaCabecalhoRelatorio(tid, cd);
    if (!cargaRow) return res.status(404).json({ error: 'Carga não encontrada.' });
    const rN = await pool.query(
      `SELECT j."ORDEM", n.*
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
        ORDER BY j."ORDEM", n."CD_NFE_SAIDA"`,
      [cd, tid]
    );
    let nfRowsFrios = rN.rows;
    const cdDonoFiltroFrios = parseInt(req.query.cdDono ?? req.query.cd_dono, 10);
    if (Number.isFinite(cdDonoFiltroFrios) && cdDonoFiltroFrios > 0) {
      nfRowsFrios = nfRowsFrios.filter((n) => Number(n.CD_DONO) === cdDonoFiltroFrios);
    }
    const unidadesFiltroFrios = lerListaQueryParam(req, 'unidades');
    if (unidadesFiltroFrios.length) {
      nfRowsFrios = filtrarNfRowsPorUnidades(nfRowsFrios, unidadesFiltroFrios);
    }
    const destinosFiltroFrios = lerListaQueryParam(req, 'destinos');
    if (destinosFiltroFrios.length) {
      nfRowsFrios = filtrarNfRowsPorDestinos(nfRowsFrios, destinosFiltroFrios);
    }
    const codigosFiltroFrios = lerListaQueryParam(req, 'codigos');
    const agruparItens = req.query.agruparItens !== '0' && req.query.agruparItens !== 'false';
    const folhasRaw = String(req.query.folhas || 'nota').toLowerCase();
    const folhasValidFrios = new Set(['nota', 'dest', 'endereco', 'continuo']);
    const folhas = folhasValidFrios.has(folhasRaw) ? folhasRaw : 'nota';
    const conservacaoRawFrios = String(req.query.conservacao || 'todos').toLowerCase();
    const conservacaoFrios =
      conservacaoRawFrios === 'refri' || conservacaoRawFrios === 'seco' ? conservacaoRawFrios : 'todos';
    const ordemCamposValidos = new Set(['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo']);
    const ordem = String(req.query.ordem || '')
      .split(',')
      .map((x) => String(x || '').trim().toLowerCase())
      .filter((x, idx, arr) => x && ordemCamposValidos.has(x) && arr.indexOf(x) === idx);
    const digitos = collectDigitosCargaNfe(nfRowsFrios);
    const setDonoNfFrios = new Set();
    for (const n of nfRowsFrios) {
      if (n.CD_DONO != null && n.CD_DONO !== '' && Number.isFinite(Number(n.CD_DONO))) {
        setDonoNfFrios.add(Number(n.CD_DONO));
      }
    }
    let cdDonoMapaFrios = null;
    if (setDonoNfFrios.size > 1) cdDonoMapaFrios = null;
    else if (setDonoNfFrios.size === 1) cdDonoMapaFrios = [...setDonoNfFrios][0];
    else if (cargaRow.CD_DONO != null && Number.isFinite(Number(cargaRow.CD_DONO))) {
      cdDonoMapaFrios = Number(cargaRow.CD_DONO);
    }
    let produtoPorDigitos = {};
    try {
      produtoPorDigitos = await carregarMapaProdutosDonoPorDigitos(tid, cdDonoMapaFrios, digitos);
    } catch (e2) {
      if (!schemaMissing(e2)) console.warn('[WMS carga] frios cadastro produto:', e2.message || e2);
      produtoPorDigitos = {};
    }
    const geradoEm = new Date().toISOString();
    const html = buildRomaneioCargaFriosOplHtml({
      carga: cargaRow,
      nfRows: nfRowsFrios,
      produtoPorDigitos,
      opts: {
        conservacao: conservacaoFrios,
        agruparItens,
        folhas,
        ordem,
        filtrosUnidades: unidadesFiltroFrios,
        filtrosDestinos: destinosFiltroFrios,
        filtrosCodigos: codigosFiltroFrios,
      },
      geradoEm,
    });
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] relatorioFriosCargaHtml:', e);
    res.status(500).json({ error: 'Erro ao gerar relatório de frios.' });
  }
}

async function buscarCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    let rC;
    try {
      rC = await pool.query(
        `SELECT c.*, e."ST_EXPEDICAO"
           FROM "WMS_CARGA_PROGRAMADA" c
           LEFT JOIN "WMS_EXPEDICAO_CARGA" e
             ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
          WHERE c."CD_CARGA" = $1::integer AND c."TENANT_ID" = $2`,
        [cd, tid]
      );
    } catch (e) {
      if (!schemaMissing(e)) throw e;
      rC = await pool.query(
        `SELECT * FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
        [cd, tid]
      );
    }
    if (!rC.rows.length) return res.status(404).json({ error: 'Carga não encontrada.' });
    const cargaRow = rC.rows[0];
    cargaRow.ST_CARGA_PROGRAMADA = cargaRow.ST_CARGA;
    const ex = String(cargaRow.ST_EXPEDICAO || '').toUpperCase();
    if (ex === 'EXPEDIDA' || ex === 'EM_EXPEDICAO') {
      cargaRow.ST_CARGA = ex;
    }
    const rN = await pool.query(
      `SELECT j."ORDEM", j."DH_INCLUSAO", n.*
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
        ORDER BY j."ORDEM", j."CD_NFE_SAIDA"`,
      [cd, tid]
    );
    let donosCarga = [];
    try {
      const rD = await pool.query(
        `SELECT DISTINCT n."CD_DONO",
                COALESCE(NULLIF(TRIM(d."NOME"), ''), 'Dono #' || n."CD_DONO"::text) AS "NM_DONO"
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
    res.json({ carga: cargaRow, nfes: rN.rows, donosCarga });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] buscarCarga:', e);
    res.status(500).json({ error: 'Erro ao buscar carga.' });
  }
}

async function adicionarNfeCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    const cdNfe = parseInt(req.body.cdNfeSaida ?? req.body.CD_NFE_SAIDA, 10);
    if (!Number.isFinite(cdCarga) || !Number.isFinite(cdNfe)) {
      return res.status(400).json({ error: 'Informe cdCarga na URL e cdNfeSaida no corpo.' });
    }
    const chk = await pool.query(
      `SELECT 1 FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdCarga, tid]
    );
    if (!chk.rows.length) return res.status(404).json({ error: 'Carga não encontrada.' });
    const lockN = await assertCargaProgramacaoEditavel(tid, cdCarga);
    if (!lockN.ok) return res.status(400).json({ error: lockN.error });
    const nfe = await pool.query(
      `SELECT "CD_NFE_SAIDA" FROM "WMS_NFE_SAIDA" WHERE "CD_NFE_SAIDA" = $1::integer AND "TENANT_ID" = $2`,
      [cdNfe, tid]
    );
    if (!nfe.rows.length) return res.status(404).json({ error: 'NF de saída não encontrada.' });
    const maxR = await pool.query(
      `SELECT COALESCE(MAX("ORDEM"), 0)::integer AS m FROM "WMS_CARGA_PROGRAMADA_NFE" WHERE "CD_CARGA" = $1::integer`,
      [cdCarga]
    );
    const ordem = (maxR.rows[0].m || 0) + 1;
    await pool.query(
      `INSERT INTO "WMS_CARGA_PROGRAMADA_NFE" ("CD_CARGA", "CD_NFE_SAIDA", "ORDEM", "SG_USER")
       VALUES ($1::integer, $2::integer, $3::integer, $4)`,
      [cdCarga, cdNfe, ordem, sg]
    );
    await sincronizarDonoUnicoNaCargaSeAplicavel(tid, cdCarga);
    res.status(201).json({ ok: true, CD_CARGA: cdCarga, CD_NFE_SAIDA: cdNfe, ORDEM: ordem });
  } catch (e) {
    if (e && e.code === '23505') {
      return res.status(409).json({ error: 'Esta NF já está vinculada a outra carga programada.' });
    }
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] adicionarNfeCarga:', e);
    res.status(500).json({ error: 'Erro ao vincular NF à carga.' });
  }
}

async function importarSeparacaoCarga(req, res) {
  uploadSeparacao.single('arquivo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Falha no upload.' });
    try {
      const tid = tenantIdForRequest(req);
      const sg = getSgUser(req);
      if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
      const cdCarga = parseInt(req.params.cdCarga, 10);
      if (!Number.isFinite(cdCarga)) return res.status(400).json({ error: 'Código da carga inválido.' });
      const lockSep = await assertCargaProgramacaoEditavel(tid, cdCarga);
      if (!lockSep.ok) return res.status(400).json({ error: lockSep.error });
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: 'Envie o espelho no campo "arquivo".' });
      }
      const txt = req.file.buffer.toString('utf8');
      const itens = parseEspelhoSeparacaoTxt(txt);
      if (!itens.length) {
        return res.status(400).json({ error: 'Não foi possível extrair itens do espelho de separação.' });
      }
      await pool.query(
        `DELETE FROM "WMS_SEPARACAO_PEDIDO_ITEM"
          WHERE "TENANT_ID" = $1
            AND "CD_CARGA" = $2::integer`,
        [tid, cdCarga]
      );
      for (const it of itens) {
        await pool.query(
          `INSERT INTO "WMS_SEPARACAO_PEDIDO_ITEM"
            ("TENANT_ID","CD_CARGA","NR_PEDIDO","COD_PRODUTO","DS_PRODUTO","UNIDADE","QTD_SEPARADA","ORIGEM_ARQUIVO","SG_USER")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            tid,
            cdCarga,
            it.NR_PEDIDO,
            it.COD_PRODUTO,
            it.DS_PRODUTO,
            it.UNIDADE,
            it.QTD_SEPARADA,
            req.file.originalname || null,
            sg,
          ]
        );
      }
      const validacao = await validarCargaProgramada(tid, cdCarga, { persist: true, sgUser: sg });
      try {
        const estoque = await validarEstoqueOplParaExpedicao(tid, cdCarga);
        anexarValidacaoEstoqueNaCarga(validacao, estoque);
      } catch (eEst) {
        if (!schemaMissing(eEst)) throw eEst;
      }
      return res.status(201).json({
        ok: true,
        itensImportados: itens.length,
        validacao,
      });
    } catch (e) {
      if (schemaMissing(e)) {
        return res.status(503).json({
          error:
            'Estrutura de validação/separação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
        });
      }
      console.error('[WMS carga] importarSeparacaoCarga:', e);
      return res.status(500).json({ error: 'Erro ao importar espelho de separação.' });
    }
  });
}

async function validarCargaProgramadaController(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cdCarga)) return res.status(400).json({ error: 'Código da carga inválido.' });
    const persist = String(req.query.persist || '1') !== '0';
    if (persist) {
      const lockVd = await assertCargaProgramacaoEditavel(tid, cdCarga);
      if (!lockVd.ok) return res.status(400).json({ error: lockVd.error });
    }
    const validacao = await validarCargaProgramada(tid, cdCarga, { persist, sgUser: sg });
    try {
      const estoque = await validarEstoqueOplParaExpedicao(tid, cdCarga);
      anexarValidacaoEstoqueNaCarga(validacao, estoque);
    } catch (eEst) {
      if (!schemaMissing(eEst)) throw eEst;
    }
    res.json(validacao);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de validação/separação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS carga] validarCargaProgramadaController:', e);
    res.status(500).json({ error: 'Erro ao validar carga programada.' });
  }
}

/**
 * Revalida uma carga **forçando a persistência**, mesmo se a carga já estiver
 * EXPEDIDA. Usado quando uma correção retroativa precisa atualizar o relatório de
 * divergências (ex.: ajuste no algoritmo de match OPL). Não altera dados da
 * programação — apenas reescreve `WMS_CARGA_VALIDACAO` e `WMS_CARGA_VALIDACAO_ITEM`.
 */
async function revalidarCargaProgramadaController(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cdCarga)) return res.status(400).json({ error: 'Código da carga inválido.' });
    /** Diferente do `validar`, NÃO chama `assertCargaProgramacaoEditavel` — a
     *  intenção aqui é justamente atualizar a validação de cargas já expedidas. */
    const validacao = await validarCargaProgramada(tid, cdCarga, { persist: true, sgUser: sg });
    try {
      const estoque = await validarEstoqueOplParaExpedicao(tid, cdCarga);
      anexarValidacaoEstoqueNaCarga(validacao, estoque);
    } catch (eEst) {
      if (!schemaMissing(eEst)) throw eEst;
    }
    res.json(validacao);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error:
          'Estrutura de validação/separação ausente. Execute backend/scripts/adicionar_validacao_carga_expedicao_postgres.sql.',
      });
    }
    console.error('[WMS carga] revalidarCargaProgramadaController:', e);
    res.status(500).json({ error: 'Erro ao revalidar carga.' });
  }
}

async function removerNfeCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cdCarga = parseInt(req.params.cdCarga, 10);
    const cdNfe = parseInt(req.params.cdNfeSaida, 10);
    if (!Number.isFinite(cdCarga) || !Number.isFinite(cdNfe)) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }
    const lockRm = await assertCargaProgramacaoEditavel(tid, cdCarga);
    if (!lockRm.ok) return res.status(400).json({ error: lockRm.error });
    const r = await pool.query(
      `DELETE FROM "WMS_CARGA_PROGRAMADA_NFE" j
        USING "WMS_CARGA_PROGRAMADA" c
       WHERE j."CD_CARGA" = c."CD_CARGA"
         AND j."CD_CARGA" = $1::integer
         AND j."CD_NFE_SAIDA" = $2::integer
         AND c."TENANT_ID" = $3
       RETURNING j."CD_CARGA"`,
      [cdCarga, cdNfe, tid]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Vínculo não encontrado.' });
    res.json({ ok: true });
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] removerNfeCarga:', e);
    res.status(500).json({ error: 'Erro ao remover NF da carga.' });
  }
}

async function reordenarOrdemNfesCarga(client, cdCarga) {
  await client.query(
    `WITH ranked AS (
       SELECT "CD_NFE_SAIDA",
              ROW_NUMBER() OVER (
                ORDER BY "ORDEM" ASC NULLS LAST, "DH_INCLUSAO" ASC NULLS LAST, "CD_NFE_SAIDA" ASC
              ) AS rn
         FROM "WMS_CARGA_PROGRAMADA_NFE"
        WHERE "CD_CARGA" = $1::integer
     )
     UPDATE "WMS_CARGA_PROGRAMADA_NFE" j
        SET "ORDEM" = ranked.rn
       FROM ranked
      WHERE j."CD_CARGA" = $1::integer
        AND j."CD_NFE_SAIDA" = ranked."CD_NFE_SAIDA"`,
    [cdCarga]
  );
}

/**
 * Move todas as NF-e de um ponto de entrega (chaveDestino) desta carga para outra.
 * Mantém ORDEM relativa; renumera ordem nas duas cargas. Não altera expedição.
 */
async function transferirDestinoParaCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdOrigem = parseInt(req.params.cdCarga, 10);
    const cdDestino = parseInt(req.body.cdCargaDestino ?? req.body.CD_CARGA_DESTINO, 10);
    const chaveDestino = trimQuery(req.body.chaveDestino ?? req.body.chave_destino);
    if (!Number.isFinite(cdOrigem) || !Number.isFinite(cdDestino)) {
      return res.status(400).json({ error: 'Informe cdCargaDestino no corpo.' });
    }
    if (!chaveDestino) {
      return res.status(400).json({ error: 'Informe chaveDestino (ponto de entrega).' });
    }
    if (cdOrigem === cdDestino) {
      return res.status(400).json({ error: 'Escolha outra carga de destino.' });
    }
    const lockO = await assertCargaProgramacaoEditavel(tid, cdOrigem);
    if (!lockO.ok) return res.status(400).json({ error: lockO.error });
    const lockD = await assertCargaProgramacaoEditavel(tid, cdDestino);
    if (!lockD.ok) return res.status(400).json({ error: lockD.error });

    const rN = await pool.query(
      `SELECT n.*
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2`,
      [cdOrigem, tid]
    );
    const ids = [];
    for (const n of rN.rows || []) {
      if (chaveDestinoNf(n) === chaveDestino) ids.push(Number(n.CD_NFE_SAIDA));
    }
    if (!ids.length) {
      return res.status(404).json({ error: 'Nenhuma NF-e deste ponto de entrega nesta carga.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const chkD = await client.query(
        `SELECT 1 FROM "WMS_CARGA_PROGRAMADA" WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
        [cdDestino, tid]
      );
      if (!chkD.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Carga de destino não encontrada.' });
      }
      await client.query(
        `UPDATE "WMS_CARGA_PROGRAMADA_NFE"
            SET "CD_CARGA" = $1::integer
          WHERE "CD_CARGA" = $2::integer
            AND "CD_NFE_SAIDA" = ANY($3::integer[])`,
        [cdDestino, cdOrigem, ids]
      );
      await reordenarOrdemNfesCarga(client, cdOrigem);
      await reordenarOrdemNfesCarga(client, cdDestino);
      await client.query('COMMIT');
      res.json({
        ok: true,
        cdCargaOrigem: cdOrigem,
        cdCargaDestino: cdDestino,
        chaveDestino,
        qtdNfesMovidas: ids.length,
        cdNfes: ids,
      });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] transferirDestinoParaCarga:', e);
    res.status(500).json({ error: 'Erro ao transferir NF-e por destino.' });
  }
}

async function resumoLogisticoCarga(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const cd = parseInt(req.params.cdCarga, 10);
    if (!Number.isFinite(cd)) return res.status(400).json({ error: 'Código inválido.' });
    if (!(await assertCargaTenant(tid, cd))) return res.status(404).json({ error: 'Carga não encontrada.' });
    const out = await montarResumoLogisticoCarga(tid, cd);
    if (!out) return res.status(404).json({ error: 'Carga não encontrada.' });
    res.json(out);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] resumoLogisticoCarga:', e);
    res.status(500).json({ error: 'Erro ao montar resumo logístico da carga.' });
  }
}

/** Resumo consolidado (planilha Valores): filtros iguais à lista de cargas; HTML imprimível ou JSON. */
async function resumoProgramacaoCargas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const fmt = String(req.query.format || req.query.fmt || 'html').toLowerCase();
    const out = await montarResumoProgramacaoCargas(tid, req.query);
    if (out && out.err === 'schema') {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    if (fmt === 'json') return res.json(out);
    const html = buildResumoProgramacaoHtml({
      ...out,
      geradoEm: new Date().toISOString(),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] resumoProgramacaoCargas:', e);
    res.status(500).json({ error: 'Erro ao gerar resumo de programação.' });
  }
}

/** CSV: uma linha por NF das cargas filtradas (conciliação). */
async function exportarNfCargasCsv(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await listarNfExportacaoCargas(tid, req.query);
    if (out && out.err === 'schema') {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    const csvBody = montarCsvNfCargas(out.rows, { truncado: out.truncado });
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wms-cargas-nf-${ymd}.csv"`);
    return res.send(`\uFEFF${csvBody}`);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] exportarNfCargasCsv:', e);
    res.status(500).json({ error: 'Erro ao exportar NF das cargas.' });
  }
}

/** CSV: NF-e importadas (aba Filtros), com coluna de carga(s). */
async function exportarNfesSaidaCsv(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    if (!getSgUser(req)) return res.status(401).json({ error: 'Não autorizado.' });
    const out = await listarNfExportacaoImportadas(tid, req.query);
    if (out && out.err === 'schema') {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    const csvBody = montarCsvNfImportadas(out.rows, { truncado: out.truncado });
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wms-nf-importadas-${ymd}.csv"`);
    return res.send(`\uFEFF${csvBody}`);
  } catch (e) {
    if (schemaMissing(e)) {
      return res.status(503).json({
        error: 'Estrutura WMS de cargas ausente. Execute backend/scripts/wms_carga_programada_postgres.sql.',
      });
    }
    console.error('[WMS carga] exportarNfesSaidaCsv:', e);
    res.status(500).json({ error: 'Erro ao exportar NF importadas.' });
  }
}

module.exports = {
  importarNfeSaidaXml,
  listarNfesSaida,
  buscarNfeSaida,
  listarNfesSaidaDisponiveis,
  excluirNfeSaida,
  listarCargas,
  criarCarga,
  mesclarCargas,
  previewDistribuirNfPorRota,
  aplicarDistribuirNfPorRotaHandler,
  atualizarCarga,
  excluirCarga,
  buscarCarga,
  gerarRomaneioCarga,
  relatorioFriosCargaHtml,
  adicionarNfeCarga,
  removerNfeCarga,
  transferirDestinoParaCarga,
  importarSeparacaoCarga,
  validarCargaProgramadaController,
  revalidarCargaProgramadaController,
  planejarParadasCarga,
  calcularSalvarRotaOperacionalCarga,
  obterUltimaRotaOperacionalCarga,
  criarViagemRascunhoDeCarga,
  listarUnidadesEmbarqueWms,
  resumoLogisticoCarga,
  resumoProgramacaoCargas,
  exportarNfCargasCsv,
  exportarNfesSaidaCsv,
};
