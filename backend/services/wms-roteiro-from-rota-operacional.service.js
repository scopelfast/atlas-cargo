'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { getFirstNumericValue } = require('../config/db');
const { getReverseGeocodingUrl } = require('../config/nominatim');

/**
 * @param {unknown} n
 * @returns {string}
 */
function roundCoord(n) {
  const x = n != null ? Number(n) : NaN;
  if (!Number.isFinite(x)) return 'n';
  return String(Math.round(x * 1e6) / 1e6);
}

/** Arredondamento mais grosseiro só para a assinatura de reuso (evita roteiro novo por drift de GPS/OSRM entre versões). */
function roundCoordAssinatura(n, casasDecimais) {
  const d = casasDecimais != null ? Number(casasDecimais) : 3;
  const m = 10 ** (Number.isFinite(d) && d >= 0 && d <= 8 ? Math.floor(d) : 3);
  const x = n != null ? Number(n) : NaN;
  if (!Number.isFinite(x)) return 'n';
  return String(Math.round(x * m) / m);
}

/**
 * @param {unknown} s
 * @param {number} max
 */
function normUpper(s, max) {
  return String(s || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .slice(0, max);
}

/**
 * Assinatura estável da rota WMS (embarque + ordem das paradas + retorno).
 * Não inclui CD_ROTA_OPER nem versão, para reaproveitar roteiro entre cargas iguais.
 * v3: sem rótulo livre NM_ENTREGA na assinatura (evita novo roteiro a cada viagem com mesmo trajeto).
 * v4: embarque por CDCADASTRO da unidade (CD_CADASTRO_EMBARQUE) → token emb:cg:id (estável); senão emb:lat,lon.
 *
 * @param {string} tenantId
 * @param {object} rota — linha WMS_CARGA_ROTA_OPERACIONAL
 * @param {object[]} rows — WMS_CARGA_ROTA_PARADA ordenadas
 * @returns {string} SHA-256 hex (64 chars)
 */
function buildAssinaturaWmsRotaHash(tenantId, rota, rows) {
  const tid = String(tenantId || 'default').trim() || 'default';
  const ret = String(rota.RETORNA_ORIGEM || 'S').toUpperCase().slice(0, 1) === 'N' ? 'N' : 'S';
  const cdEmbRaw = rota.CD_CADASTRO_EMBARQUE ?? rota.cd_cadastro_embarque;
  const cdEmb = cdEmbRaw != null && String(cdEmbRaw).trim() !== '' ? parseInt(String(cdEmbRaw), 10) : NaN;
  const embToken =
    Number.isFinite(cdEmb) && cdEmb > 0
      ? `emb:cg:${cdEmb}`
      : `emb:${roundCoordAssinatura(rota.ORIGEM_LAT, 3)},${roundCoordAssinatura(rota.ORIGEM_LON, 3)}`;
  const lines = [
    'wms-rota-sig-v4',
    `t:${tid}`,
    `ret:${ret}`,
    embToken,
  ];
  for (const p of rows) {
    const o = Number(p.ORDEM) || 0;
    const lat = roundCoordAssinatura(p.LATITUDE, 3);
    const lon = roundCoordAssinatura(p.LONGITUDE, 3);
    const uf = normUpper(p.UF, 2);
    const mun = normUpper(p.NM_MUNICIPIO, 120);
    const cep = String(p.CEP || '')
      .replace(/\D/g, '')
      .slice(0, 8);
    const cdEnd =
      p.CD_END_ENTREGA != null && String(p.CD_END_ENTREGA).trim() !== ''
        ? String(parseInt(String(p.CD_END_ENTREGA), 10))
        : '';
    const cnpj = String(p.CNPJ_ENTREGA || '')
      .replace(/\D/g, '')
      .slice(0, 14);
    lines.push(`p:${o}|${lat}|${lon}|${uf}|${mun}|${cep}|e:${cdEnd}|${cnpj}`);
  }
  return crypto.createHash('sha256').update(lines.join('\n'), 'utf8').digest('hex');
}

/**
 * Executa fn dentro de SAVEPOINT para que erro SQL (ex.: coluna ausente) não aborte a transação externa.
 * @template T
 * @param {import('pg').PoolClient} client
 * @param {string} nome
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withSavepoint(client, nome, fn) {
  const sp = String(nome || 'sp')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 48) || 'sp_tmp';
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const out = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return out;
  } catch (e) {
    try {
      await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    } catch (_) {}
    throw e;
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @returns {Promise<boolean>}
 */
async function roteiroPossuiColunaSigWms(client) {
  try {
    return await withSavepoint(client, 'sp_sig_wms', async () => {
      await client.query('SELECT "SIG_WMS_ROTA" FROM "ROTEIRO" WHERE FALSE');
      return true;
    });
  } catch (e) {
    if (e && e.code === '42703') return false;
    throw e;
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {string} uf
 * @param {string} nmMun
 * @returns {Promise<number|null>}
 */
async function resolverCidadeId(client, uf, nmMun) {
  const u = String(uf || '').trim().toUpperCase().slice(0, 2);
  const m = String(nmMun || '').trim();
  if (!u || !m) return null;
  const r = await client.query(
    `SELECT c."CDCIDADE"
       FROM "CIDADE" c
      WHERE upper(trim(c."ESTADO")) = $1::text
        AND trim(c."NMCIDADE") ILIKE trim($2::text)
      ORDER BY length(trim(c."NMCIDADE")) ASC, c."CDCIDADE" ASC
      LIMIT 1`,
    [u, m]
  );
  if (!r.rows.length) return null;
  const v = r.rows[0].CDCIDADE ?? r.rows[0].cdcidade;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

/** Cidade do cadastro de embarque (unidade de negócio), se houver. */
async function resolverCidadeIdDoCadastro(client, cdCadastro) {
  const id = cdCadastro != null ? parseInt(String(cdCadastro), 10) : NaN;
  if (!Number.isFinite(id) || id <= 0) return null;
  let lat = null;
  let lon = null;
  try {
    const fromCad = await withSavepoint(client, 'sp_cid_cad', async () => {
      const r = await client.query(
        `SELECT cg."CDCIDADE", cg."LATITUDE", cg."LONGITUDE"
           FROM "CADASTROGERAL" cg
          WHERE cg."CDCADASTRO" = $1
          LIMIT 1`,
        [id]
      );
      if (!r.rows.length) return null;
      const row = r.rows[0];
      const v = row.CDCIDADE ?? row.cdcidade;
      const n = parseInt(String(v), 10);
      if (Number.isFinite(n) && n > 0) return n;
      lat = row.LATITUDE ?? row.latitude;
      lon = row.LONGITUDE ?? row.longitude;
      return null;
    });
    if (fromCad) return fromCad;
  } catch (e) {
    if (e && (e.code === '42P01' || e.code === '42703')) {
      /* sem coluna — tenta só coords da rota depois */
    } else {
      throw e;
    }
  }
  // Cadastro sem CDCIDADE: resolve pelo GPS do próprio CD (evita cair no município da 1ª NF).
  return resolverCidadeIdPorCoord(client, lat, lon);
}

/**
 * Extrai município/UF do JSON do Nominatim.
 * @param {object} address
 * @returns {{ uf: string, nmMun: string }|null}
 */
function municipioUfFromNominatimAddress(address) {
  if (!address || typeof address !== 'object') return null;
  const nmMun = String(
    address.city ||
      address.town ||
      address.municipality ||
      address.village ||
      address.suburb ||
      address.county ||
      ''
  ).trim();
  let uf = String(address.state_code || '').trim().toUpperCase().slice(0, 2);
  if (!uf) {
    const st = String(address.state || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    const ufMap = {
      parana: 'PR',
      'sao paulo': 'SP',
      'santa catarina': 'SC',
      'rio grande do sul': 'RS',
      'rio de janeiro': 'RJ',
      'minas gerais': 'MG',
      'mato grosso do sul': 'MS',
      'mato grosso': 'MT',
      goias: 'GO',
      bahia: 'BA',
    };
    uf = ufMap[st] || '';
  }
  if (!nmMun || !uf) return null;
  return { uf, nmMun };
}

/**
 * Cidade pelas coordenadas do embarque.
 * A tabela CIDADE do legado não tem LAT/LON — usa reverse geocode (Nominatim) → NMCIDADE/UF.
 */
async function resolverCidadeIdPorCoord(client, lat, lon) {
  const la = lat != null ? Number(lat) : NaN;
  const lo = lon != null ? Number(lon) : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  // Tentativa legado (se alguém adicionar LAT/LON em CIDADE no futuro).
  try {
    const byCol = await withSavepoint(client, 'sp_cid_coord_tbl', async () => {
      const r = await client.query(
        `SELECT c."CDCIDADE"
           FROM "CIDADE" c
          WHERE c."LATITUDE" IS NOT NULL AND c."LONGITUDE" IS NOT NULL
          ORDER BY (POWER(COALESCE(c."LATITUDE", 0) - $1::float8, 2)
                  + POWER(COALESCE(c."LONGITUDE", 0) - $2::float8, 2)) ASC
          LIMIT 1`,
        [la, lo]
      );
      if (!r.rows.length) return null;
      const v = r.rows[0].CDCIDADE ?? r.rows[0].cdcidade;
      const n = parseInt(String(v), 10);
      return Number.isFinite(n) ? n : null;
    });
    if (byCol) return byCol;
  } catch (e) {
    if (e && e.code !== '42703' && e.code !== '42P01') throw e;
  }

  try {
    const url = getReverseGeocodingUrl(la, lo) + '&zoom=10';
    const { data, status } = await axios.get(url, {
      timeout: 12000,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'AtlasCargo-WMS/1.0 (roteiro embarque; contato: suporte)',
        Accept: 'application/json',
      },
    });
    if (status < 200 || status >= 300 || !data) return null;
    const parsed = municipioUfFromNominatimAddress(data.address || {});
    if (!parsed) return null;
    return resolverCidadeId(client, parsed.uf, parsed.nmMun);
  } catch (e) {
    console.warn('[WMS roteiro] reverse geocode embarque falhou:', e && e.message ? e.message : e);
    return null;
  }
}

/**
 * @param {import('pg').PoolClient} client
 * @param {object} p
 * @returns {Promise<number>}
 */
async function inserirRoteiroCabecalho(client, p) {
  const {
    idRot,
    ds,
    idCdOrig,
    idCdDest,
    distKm,
    tenantId,
    sgUser,
    assinatura,
    comColunaSig,
  } = p;

  if (comColunaSig && assinatura) {
    try {
      await withSavepoint(client, 'sp_ins_rot_sig', async () => {
        await client.query(
          `INSERT INTO "ROTEIRO" (
            "IDROTEIRO","DSROTEIRO","CDCIDADEORIGEM","CDCIDADEDESTINO","DISTANCIAKM","FGACTIVE",
            "TENANT_ID","DHMAINTENANCE","SGUSER","SERVERORIG","SIG_WMS_ROTA"
          ) VALUES ($1,$2,$3,$4,$5,'S',$6,CURRENT_TIMESTAMP,$7,'AppDVcargas',$8)`,
          [idRot, ds, idCdOrig, idCdDest, distKm, tenantId, sgUser, assinatura]
        );
      });
      return idRot;
    } catch (e) {
      if (e && e.code === '42703') {
        /* coluna ausente — seguir insert legado sem assinatura */
      } else {
        throw e;
      }
    }
  }

  try {
    await withSavepoint(client, 'sp_ins_rot_fg', async () => {
      await client.query(
        `INSERT INTO "ROTEIRO" (
          "IDROTEIRO","DSROTEIRO","CDCIDADEORIGEM","CDCIDADEDESTINO","DISTANCIAKM","FGACTIVE",
          "TENANT_ID","DHMAINTENANCE","SGUSER","SERVERORIG"
        ) VALUES ($1,$2,$3,$4,$5,'S',$6,CURRENT_TIMESTAMP,$7,'AppDVcargas')`,
        [idRot, ds, idCdOrig, idCdDest, distKm, tenantId, sgUser]
      );
    });
  } catch (e) {
    if (e && e.code === '42703') {
      await client.query(
        `INSERT INTO "ROTEIRO" (
          "IDROTEIRO","DSROTEIRO","CDCIDADEORIGEM","CDCIDADEDESTINO","DISTANCIAKM",
          "TENANT_ID","DHMAINTENANCE","SGUSER","SERVERORIG"
        ) VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,$7,'AppDVcargas')`,
        [idRot, ds, idCdOrig, idCdDest, distKm, tenantId, sgUser]
      );
    } else {
      throw e;
    }
  }

  if (comColunaSig && assinatura) {
    try {
      await withSavepoint(client, 'sp_upd_sig', async () => {
        await client.query(`UPDATE "ROTEIRO" SET "SIG_WMS_ROTA" = $2 WHERE "IDROTEIRO" = $1`, [idRot, assinatura]);
      });
    } catch (ue) {
      if (ue && ue.code !== '42703') throw ue;
    }
  }

  return idRot;
}

/**
 * Busca roteiro existente pela assinatura ou cria cabeçalho + ROTEIROPONTOS.
 * Reuso “agressivo”: mesma assinatura → mesmo IDROTEIRO (várias viagens). Evita duplicar cadastro;
 * edição manual do roteiro altera a forma da rota só para viagens futuras se a assinatura mudar.
 *
 * @param {import('pg').PoolClient} client
 * @param {{ tenantId: string, sgUser: string, cdCarga: number, rota: object, paradas: object[] }} opts
 * @returns {Promise<{ idRot: number, reused: boolean, roteiroMensagem: string, assinatura: string|null }>}
 */
async function obterOuCriarRoteiroFromWmsRotaOperacional(client, opts) {
  const { tenantId, sgUser, cdCarga, rota, paradas } = opts;
  const rows = (paradas || [])
    .slice()
    .sort((a, b) => {
      const oa = Number(a.ORDEM) || 0;
      const ob = Number(b.ORDEM) || 0;
      if (oa !== ob) return oa - ob;
      const ca = Number(a.CD_ROTA_PARADA) || 0;
      const cb = Number(b.CD_ROTA_PARADA) || 0;
      return ca - cb;
    });
  if (!rows.length) {
    throw new Error('Rota operacional sem paradas salvas; calcule a rota novamente.');
  }

  const comColunaSig = await roteiroPossuiColunaSigWms(client);
  const assinatura = comColunaSig ? buildAssinaturaWmsRotaHash(tenantId, rota, rows) : null;

  if (comColunaSig && assinatura) {
    const exist = await client.query(
      `SELECT "IDROTEIRO" FROM "ROTEIRO" WHERE "TENANT_ID" = $1 AND "SIG_WMS_ROTA" = $2 LIMIT 1`,
      [tenantId, assinatura]
    );
    if (exist.rows.length) {
      const idRot = Number(exist.rows[0].IDROTEIRO ?? exist.rows[0].idroteiro);
      return {
        idRot,
        reused: true,
        assinatura,
        roteiroMensagem: `Roteiro #${idRot} reutilizado (mesma sequência de paradas OSRM).`,
      };
    }
  }

  const first = rows[0];
  const last = rows[rows.length - 1];
  const retornaCab = String(rota.RETORNA_ORIGEM || 'S').toUpperCase().slice(0, 1) !== 'N';
  const cdEmbRaw = rota.CD_CADASTRO_EMBARQUE ?? rota.cd_cadastro_embarque;

  /** Embarque (CD) = origem do cabeçalho; se retorna ao CD, destino = mesma cidade (rota circular). */
  let idCdEmb = await resolverCidadeIdDoCadastro(client, cdEmbRaw);
  if (!idCdEmb) {
    idCdEmb = await resolverCidadeIdPorCoord(client, rota.ORIGEM_LAT, rota.ORIGEM_LON);
  }
  let idCdOrig = idCdEmb || (await resolverCidadeId(client, first.UF, first.NM_MUNICIPIO));
  let idCdDest = retornaCab
    ? idCdOrig
    : (await resolverCidadeId(client, last.UF, last.NM_MUNICIPIO)) || idCdOrig;
  if (!idCdOrig) idCdOrig = idCdDest;
  if (!idCdDest) idCdDest = idCdOrig;
  if (!idCdOrig) {
    throw new Error(
      'Não foi possível resolver CDCIDADE para o município da NF/embarque (tabela CIDADE). Ajuste o cadastro de cidades ou o nome/UF vindo da NF.'
    );
  }

  const mr = await client.query('SELECT COALESCE(MAX("IDROTEIRO"), 0) + 1 AS nid FROM "ROTEIRO"');
  let idRot = getFirstNumericValue(mr.rows, 1);

  const versao = rota.VERSAO != null ? String(rota.VERSAO) : '';
  /* DSROTEIRO costuma ser VARCHAR(60) no legado Atlas */
  const ds = `WMS · Carga #${cdCarga} · rota v${versao}`.slice(0, 60);
  const distM = rota.DISTANCIA_M != null ? Number(rota.DISTANCIA_M) : null;
  const distKm =
    distM != null && Number.isFinite(distM) && distM > 0 ? Math.round((distM / 1000) * 10000) / 10000 : null;

  try {
    await inserirRoteiroCabecalho(client, {
      idRot,
      ds,
      idCdOrig,
      idCdDest,
      distKm,
      tenantId,
      sgUser,
      assinatura,
      comColunaSig,
    });
  } catch (e) {
    /* Violação única (tenant+sig) ou PK: tentar reaproveitar roteiro já gravado na corrida. */
    if (e && e.code === '23505' && comColunaSig && assinatura) {
      const r2 = await client.query(
        `SELECT "IDROTEIRO" FROM "ROTEIRO" WHERE "TENANT_ID" = $1 AND "SIG_WMS_ROTA" = $2 LIMIT 1`,
        [tenantId, assinatura]
      );
      if (r2.rows.length) {
        const idReuso = Number(r2.rows[0].IDROTEIRO ?? r2.rows[0].idroteiro);
        return {
          idRot: idReuso,
          reused: true,
          assinatura,
          roteiroMensagem: `Roteiro #${idReuso} reutilizado (mesma assinatura; outra gravação concluiu antes).`,
        };
      }
    }
    throw e;
  }

  const retorna = String(rota.RETORNA_ORIGEM || 'S').toUpperCase() === 'S';
  const embLat = rota.ORIGEM_LAT != null ? Number(rota.ORIGEM_LAT) : null;
  const embLon = rota.ORIGEM_LON != null ? Number(rota.ORIGEM_LON) : null;
  const embLabel = (rota.ORIGEM_LABEL && String(rota.ORIGEM_LABEL).trim()) || 'Embarque';
  const embPos =
    embLat != null && embLon != null && Number.isFinite(embLat) && Number.isFinite(embLon)
      ? `Embarque (${embLat.toFixed(4)}, ${embLon.toFixed(4)})`.slice(0, 100)
      : 'Embarque';

  /** @type {{ sequencia: number, ordem: number, DSLOCAL: string, DSPOSICAO: string, lat: number|null, lon: number|null, TPLOCAL: string, UF: string|null }[]} */
  const pontos = [];

  let seq = 0;
  const pushPonto = (ordem, row) => {
    seq += 1;
    pontos.push({ sequencia: seq, ordem, ...row });
  };

  pushPonto(1, {
    DSLOCAL: embLabel.slice(0, 100),
    DSPOSICAO: embPos,
    lat: embLat,
    lon: embLon,
    TPLOCAL: 'O',
    UF: rows[0].UF ? String(rows[0].UF).trim().slice(0, 3) : null,
  });

  rows.forEach((p, idx) => {
    const lat = p.LATITUDE != null ? Number(p.LATITUDE) : null;
    const lon = p.LONGITUDE != null ? Number(p.LONGITUDE) : null;
    const nm = String(p.NM_ENTREGA || `Parada ${idx + 1}`).trim().slice(0, 100);
    const mun = String(p.NM_MUNICIPIO || '').trim();
    const uf = String(p.UF || '').trim().slice(0, 3);
    const pos = mun && uf ? `${mun}/${uf}`.slice(0, 100) : (uf || 'BR').slice(0, 100);
    const isLast = idx === rows.length - 1;
    const tpl = isLast && !retorna ? 'D' : 'P';
    const ordem = 10 * (idx + 1);
    pushPonto(ordem, {
      DSLOCAL: nm,
      DSPOSICAO: pos,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      TPLOCAL: tpl,
      UF: uf || null,
    });
  });

  if (retorna && embLat != null && embLon != null && Number.isFinite(embLat) && Number.isFinite(embLon)) {
    /** Sempre depois da última parada (antes: ORDEM=100 fixo colidia com 10*idx e ficava no meio). */
    pushPonto(10 * (rows.length + 1), {
      DSLOCAL: 'Retorno embarque'.slice(0, 100),
      DSPOSICAO: embPos,
      lat: embLat,
      lon: embLon,
      TPLOCAL: 'D',
      UF: rows[0].UF ? String(rows[0].UF).trim().slice(0, 3) : null,
    });
  } else if (retorna && (!Number.isFinite(embLat) || !Number.isFinite(embLon))) {
    pushPonto(10 * (rows.length + 1), {
      DSLOCAL: 'Retorno embarque'.slice(0, 100),
      DSPOSICAO: embPos,
      lat: rows[0].LATITUDE != null ? Number(rows[0].LATITUDE) : null,
      lon: rows[0].LONGITUDE != null ? Number(rows[0].LONGITUDE) : null,
      TPLOCAL: 'D',
      UF: rows[0].UF ? String(rows[0].UF).trim().slice(0, 3) : null,
    });
  }

  for (const pt of pontos) {
    await client.query(
      `INSERT INTO "ROTEIROPONTOS" (
        "IDROTEIRO","SEQUENCIA","ORDEM","DSLOCAL","DSPOSICAO",
        "LATITUDE","LONGITUDE","TPLOCAL","KMENTREPONTOS","CDPAISPASSAGEM","ESTADOPASSAGEM",
        "DHMAINTENANCE","SGUSER","SERVERORIG"
      ) VALUES (
        $1::numeric,$2::smallint,$3::smallint,$4,$5,
        $6,$7,$8,NULL,NULL,$9,
        CURRENT_TIMESTAMP,$10,'AppDVcargas'
      )`,
      [
        idRot,
        pt.sequencia,
        pt.ordem,
        String(pt.DSLOCAL || '').slice(0, 100),
        String(pt.DSPOSICAO || '').slice(0, 100),
        pt.lat,
        pt.lon,
        String(pt.TPLOCAL || 'P').toUpperCase().slice(0, 2),
        pt.UF || null,
        sgUser,
      ]
    );
  }

  return {
    idRot,
    reused: false,
    assinatura,
    roteiroMensagem: `Roteiro #${idRot} criado para atender esta demanda.`,
  };
}

/** @deprecated use obterOuCriarRoteiroFromWmsRotaOperacional — mantido para compat. */
async function criarRoteiroFromWmsRotaOperacional(client, opts) {
  const r = await obterOuCriarRoteiroFromWmsRotaOperacional(client, opts);
  return r.idRot;
}

module.exports = {
  obterOuCriarRoteiroFromWmsRotaOperacional,
  criarRoteiroFromWmsRotaOperacional,
  resolverCidadeId,
  buildAssinaturaWmsRotaHash,
};
