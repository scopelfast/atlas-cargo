// Painel de viagens do mapa: catálogo de colunas, layout por usuário e enriquecimento da grade.

const PARADO_ATE_KMH = 5;
const RAIO_PONTO_KM = 15;
const PAINEL = 'mapa-viagem';
const GPS_INCERTO_MS = 90 * 60 * 1000;
const FOLGA_RISCO_MS = 60 * 60 * 1000;

const CATALOGO = [
  { key: 'viagem', label: 'Viagem', grupo: 'Viagem' },
  { key: 'placa', label: 'Placa', grupo: 'Viagem' },
  { key: 'motorista', label: 'Motorista', grupo: 'Viagem' },
  { key: 'situacao', label: 'Situação', grupo: 'Viagem' },
  { key: 'prazo', label: 'Prazo', grupo: 'Operação' },
  { key: 'tipo', label: 'Tipo', grupo: 'Viagem' },
  { key: 'origem', label: 'Origem', grupo: 'Rota' },
  { key: 'destino', label: 'Destino', grupo: 'Rota' },
  { key: 'roteiro', label: 'Roteiro', grupo: 'Rota' },
  { key: 'movimento', label: 'Movimento', grupo: 'Posição' },
  { key: 'velocidade', label: 'Última velocidade', grupo: 'Posição' },
  { key: 'dhPosicao', label: 'Última posição', grupo: 'Posição' },
  { key: 'posicao', label: 'Local da posição', grupo: 'Posição' },
  { key: 'noMapa', label: 'No mapa', grupo: 'Posição' },
  { key: 'macro', label: 'Última macro', grupo: 'Operação' },
  { key: 'dhMacro', label: 'Hora da macro', grupo: 'Operação' },
  { key: 'alerta', label: 'Alerta em aberto', grupo: 'Pendências' },
  { key: 'sos', label: 'SOS em aberto', grupo: 'Pendências' },
  { key: 'mensagem', label: 'Mensagem sem leitura', grupo: 'Pendências' },
  { key: 'proximoPonto', label: 'Próximo ponto', grupo: 'Rota' },
  { key: 'tipoProximo', label: 'Tipo do próximo ponto', grupo: 'Rota' },
  { key: 'kmProximo', label: 'Km próx. ponto', grupo: 'Rota' },
  { key: 'kmRodado', label: 'Km rodado', grupo: 'Rota' },
  { key: 'kmFalta', label: 'Km faltante', grupo: 'Rota' },
  { key: 'kmTotal', label: 'Km do roteiro', grupo: 'Rota' }
];

const CHAVES = new Set(CATALOGO.map((c) => c.key));
const SORT_EXTRAS = new Set(['pendencias']);

const VISIVEIS_PADRAO = [
  'viagem', 'placa', 'motorista', 'situacao', 'prazo', 'movimento', 'velocidade',
  'alerta', 'sos', 'mensagem', 'proximoPonto', 'kmProximo', 'kmRodado', 'kmFalta',
  'macro', 'dhPosicao'
];

function layoutPadrao() {
  return {
    version: 1,
    order: CATALOGO.map((c) => c.key),
    visible: Object.fromEntries(CATALOGO.map((c) => [c.key, VISIVEIS_PADRAO.includes(c.key)])),
    sort: { key: 'pendencias', dir: 'desc' }
  };
}

function normalizarLayout(raw) {
  const base = layoutPadrao();
  if (!raw || typeof raw !== 'object') return base;
  const orderIn = Array.isArray(raw.order) ? raw.order : [];
  const order = [];
  orderIn.forEach((k) => {
    const key = String(k || '');
    if (CHAVES.has(key) && !order.includes(key)) order.push(key);
  });
  CATALOGO.forEach((c) => {
    if (order.includes(c.key)) return;
    if (c.key === 'prazo') {
      const depois = order.indexOf('situacao');
      if (depois >= 0) order.splice(depois + 1, 0, c.key);
      else order.push(c.key);
      return;
    }
    order.push(c.key);
  });
  const visible = { ...base.visible };
  if (raw.visible && typeof raw.visible === 'object') {
    CATALOGO.forEach((c) => {
      if (typeof raw.visible[c.key] === 'boolean') visible[c.key] = raw.visible[c.key];
    });
  }
  if (!order.some((k) => visible[k])) {
    VISIVEIS_PADRAO.forEach((k) => { visible[k] = true; });
  }
  let sortKey = raw.sort && raw.sort.key != null ? String(raw.sort.key) : base.sort.key;
  if (!CHAVES.has(sortKey) && !SORT_EXTRAS.has(sortKey)) sortKey = base.sort.key;
  const dir = raw.sort && String(raw.sort.dir).toLowerCase() === 'asc' ? 'asc' : 'desc';
  return { version: 1, order, visible, sort: { key: sortKey, dir } };
}

async function garantirTabela(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuario_painel_layout (
      tenant_id varchar(64) NOT NULL,
      usuario_id varchar(80) NOT NULL,
      painel varchar(40) NOT NULL,
      layout_json text NOT NULL,
      atualizado_em timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (tenant_id, usuario_id, painel)
    )
  `);
}

async function lerLayout(pool, tenantId, usuarioId) {
  await garantirTabela(pool);
  const r = await pool.query(
    `SELECT layout_json FROM usuario_painel_layout
     WHERE tenant_id = $1 AND usuario_id = $2 AND painel = $3`,
    [tenantId, usuarioId, PAINEL]
  );
  const raw = r.rows && r.rows[0] && r.rows[0].layout_json;
  if (!raw) return layoutPadrao();
  try {
    return normalizarLayout(JSON.parse(raw));
  } catch (_) {
    return layoutPadrao();
  }
}

async function salvarLayout(pool, tenantId, usuarioId, layout) {
  await garantirTabela(pool);
  const limpo = normalizarLayout(layout);
  await pool.query(
    `INSERT INTO usuario_painel_layout (tenant_id, usuario_id, painel, layout_json, atualizado_em)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (tenant_id, usuario_id, painel)
     DO UPDATE SET layout_json = EXCLUDED.layout_json, atualizado_em = CURRENT_TIMESTAMP`,
    [tenantId, usuarioId, PAINEL, JSON.stringify(limpo)]
  );
  return limpo;
}

function pick(row, ...keys) {
  if (!row) return null;
  for (const k of keys) {
    if (row[k] != null && row[k] !== '') return row[k];
    const lower = String(k).toLowerCase();
    if (row[lower] != null && row[lower] !== '') return row[lower];
  }
  return null;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function qi(name) {
  const s = String(name || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return null;
  return '"' + s + '"';
}

function idsSql(ids) {
  return ids.filter((n) => Number.isInteger(n) && n > 0).join(',');
}

async function q(pool, sql, tenantId) {
  const request = pool.request();
  if (tenantId != null) request.input('tid', tenantId);
  const result = await request.query(sql);
  return result.recordset || [];
}

function rotuloTipoPonto(tp) {
  const k = String(tp || '').trim().toUpperCase();
  if (k === 'O') return 'Origem';
  if (k === 'D') return 'Destino';
  if (k === 'R') return 'Parada';
  if (k === 'P') return 'Passagem';
  return k || '';
}

function hav(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function round1(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10) / 10;
}

async function rotaOsrm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    const j = await r.json();
    const route = j && j.routes && j.routes[0];
    const metros = route && route.distance;
    const segundos = route && route.duration;
    return {
      km: Number.isFinite(metros) ? metros / 1000 : null,
      segundos: Number.isFinite(segundos) ? segundos : null
    };
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fmtCompromisso(data) {
  if (!(data instanceof Date) || Number.isNaN(data.getTime())) return '';
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function pontoPorTipo(pontos, tipo) {
  const lista = (pontos || [])
    .map((p) => ({
      lat: num(p.lat),
      lon: num(p.lon),
      tipo: String(p.tipo || '').trim().toUpperCase(),
      ordem: num(p.ordem) || 0,
      seq: num(p.seq) || 0
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => a.ordem - b.ordem || a.seq - b.seq);
  if (!lista.length) return null;
  if (tipo === 'D') {
    for (let i = lista.length - 1; i >= 0; i--) {
      if (lista[i].tipo === 'D') return lista[i];
    }
    return lista[lista.length - 1];
  }
  return lista.find((p) => p.tipo === 'O') || lista[0];
}

function classificarPrazo({ agoraMs, limite, durationSec, noPonto, posicaoMs, fase, concluido }) {
  const nome = fase === 'descarga' ? 'Descarga' : 'Carregamento';
  const vazio = { prazo: 'sem', prazoTexto: 'Sem estimativa', prazoDetalhe: '' };
  if (concluido) {
    return {
      prazo: 'no_prazo',
      prazoTexto: 'No prazo',
      prazoDetalhe: fase === 'descarga' ? 'Descarga concluída' : 'Carregamento concluído'
    };
  }
  if (!(limite instanceof Date) || Number.isNaN(limite.getTime())) {
    return { ...vazio, prazoDetalhe: `Sem previsão de ${nome.toLowerCase()}` };
  }
  const previsto = fmtCompromisso(limite);
  if (noPonto) {
    return {
      prazo: 'no_prazo',
      prazoTexto: 'No prazo',
      prazoDetalhe: `${nome} · já no ponto · previsto ${previsto}`
    };
  }
  const prazoPassou = limite.getTime() < agoraMs;
  if (durationSec == null || !Number.isFinite(durationSec)) {
    if (prazoPassou) {
      return {
        prazo: 'atrasada',
        prazoTexto: 'Atrasada',
        prazoDetalhe: `${nome} previsto ${previsto} já passou e o veículo não está no ponto`
      };
    }
    return { ...vazio, prazoDetalhe: `Tempo de rota até o ${nome.toLowerCase()} indisponível` };
  }
  const chegadaMs = agoraMs + durationSec * 1000;
  const chegada = fmtCompromisso(new Date(chegadaMs));
  const detalhe = `${nome} até ${previsto} · chegada estimada ${chegada}`;
  const stale = posicaoMs == null || (agoraMs - posicaoMs) > GPS_INCERTO_MS;
  if (prazoPassou) {
    return { prazo: 'atrasada', prazoTexto: 'Atrasada', prazoDetalhe: detalhe };
  }
  if (chegadaMs > limite.getTime()) {
    return { prazo: 'atraso', prazoTexto: 'Atraso provável', prazoDetalhe: detalhe };
  }
  if (stale) {
    return {
      prazo: 'incerta',
      prazoTexto: 'Estimativa incerta',
      prazoDetalhe: `${detalhe} · posição com mais de 90 min`
    };
  }
  if (limite.getTime() - chegadaMs < FOLGA_RISCO_MS) {
    return { prazo: 'risco', prazoTexto: 'Risco de atraso', prazoDetalhe: detalhe };
  }
  return { prazo: 'no_prazo', prazoTexto: 'No prazo', prazoDetalhe: detalhe };
}

function projetarSegmento(a, b, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const rad = Math.PI / 180;
  const cos = Math.cos(lat * rad);
  const ax = a.lon * rad * cos * 6371;
  const ay = a.lat * rad * 6371;
  const bx = b.lon * rad * cos * 6371;
  const by = b.lat * rad * 6371;
  const px = lon * rad * cos * 6371;
  const py = lat * rad * 6371;
  const abx = bx - ax;
  const aby = by - ay;
  const ab2 = abx * abx + aby * aby;
  let t = ab2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / ab2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + abx * t;
  const qy = ay + aby * t;
  return { frac: t, dist: Math.hypot(px - qx, py - qy) };
}

function progressoRota(pontos, posicoes, lat, lon, distInformada) {
  const comCoord = (pontos || [])
    .map((p) => ({
      ordem: num(p.ordem) || 0,
      seq: num(p.seq) || 0,
      nome: p.nome ? String(p.nome) : '',
      tipo: p.tipo ? String(p.tipo) : '',
      lat: num(p.lat),
      lon: num(p.lon),
      kmEntre: num(p.kmEntre)
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .sort((a, b) => a.ordem - b.ordem || a.seq - b.seq);

  let total = num(distInformada);
  if (!(total > 0)) total = null;
  if (comCoord.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return {
      kmTotal: total != null ? round1(total) : null,
      kmRodado: null,
      kmFalta: total != null ? round1(total) : null,
      kmProximo: null,
      proximoNome: null,
      proximoTipo: null
    };
  }

  const seg = [];
  let soma = 0;
  for (let i = 0; i < comCoord.length - 1; i++) {
    const informado = comCoord[i + 1].kmEntre;
    const km = informado > 0
      ? informado
      : hav(comCoord[i].lat, comCoord[i].lon, comCoord[i + 1].lat, comCoord[i + 1].lon);
    seg.push(km);
    soma += km;
  }
  if (!(total > 0)) total = soma;

  const visitas = [];
  (posicoes || []).forEach((p) => {
    const pla = num(p && (p.lat != null ? p.lat : p.latitude));
    const plo = num(p && (p.lon != null ? p.lon : p.longitude));
    if (Number.isFinite(pla) && Number.isFinite(plo)) visitas.push({ lat: pla, lon: plo });
  });
  if (Number.isFinite(lat) && Number.isFinite(lon)) visitas.push({ lat, lon });

  function chegou(ponto) {
    return visitas.some((v) => hav(v.lat, v.lon, ponto.lat, ponto.lon) <= RAIO_PONTO_KM);
  }

  let ultimo = -1;
  for (let i = 0; i < comCoord.length; i++) {
    if (chegou(comCoord[i])) ultimo = i;
    else break;
  }

  function somaSeg(inicio, fim) {
    let s = 0;
    for (let i = inicio; i < fim && i < seg.length; i++) s += seg[i] || 0;
    return s;
  }

  if (ultimo >= comCoord.length - 1) {
    const dest = comCoord[comCoord.length - 1];
    return {
      kmTotal: round1(total),
      kmRodado: round1(total),
      kmFalta: 0,
      kmProximo: 0,
      kmTrechosDepois: 0,
      abertoForaDoTrecho: false,
      proximoLat: dest.lat,
      proximoLon: dest.lon,
      proximoNome: dest.nome || null,
      proximoTipo: rotuloTipoPonto(dest.tipo)
    };
  }

  const nextIdx = ultimo < 0 ? 0 : ultimo + 1;
  const next = comCoord[nextIdx];
  const kmDepois = somaSeg(nextIdx, seg.length);
  let rodado = 0;
  let kmNoTrecho = null;
  let abertoFora = true;
  if (ultimo >= 0) {
    rodado = somaSeg(0, ultimo);
    const proj = projetarSegmento(comCoord[ultimo], next, lat, lon);
    if (proj && proj.dist <= RAIO_PONTO_KM) {
      abertoFora = false;
      rodado += (seg[ultimo] || 0) * proj.frac;
      kmNoTrecho = (seg[ultimo] || 0) * (1 - proj.frac);
    }
  }
  if (total > 0 && rodado > total) rodado = total;
  const kmProximoHav = Number.isFinite(lat) ? hav(lat, lon, next.lat, next.lon) : null;
  return {
    kmTotal: round1(total),
    kmRodado: round1(rodado),
    kmFalta: null,
    kmProximo: kmNoTrecho != null ? round1(kmNoTrecho) : (kmProximoHav != null ? round1(kmProximoHav) : null),
    kmTrechosDepois: round1(kmDepois),
    abertoForaDoTrecho: abertoFora,
    proximoLat: next.lat,
    proximoLon: next.lon,
    proximoNome: next.nome || null,
    proximoTipo: rotuloTipoPonto(next.tipo)
  };
}

async function mapaContagem(pool, sql, ids, tenantId) {
  if (!ids.length) return new Map();
  try {
    const rows = await q(pool, sql.replace('__IDS__', idsSql(ids)), tenantId);
    const map = new Map();
    rows.forEach((r) => {
      const id = num(pick(r, 'IDVIAGEM'));
      const qtd = num(pick(r, 'QTD')) || 0;
      if (id) map.set(id, qtd);
    });
    return map;
  } catch (err) {
    console.warn('[Mapa painel]', err.message);
    return new Map();
  }
}

async function enriquecer(pool, viagens, rast, tenantId) {
  const base = (viagens || []).slice(0, 300);
  const ids = base.map((v) => parseInt(pick(v, 'IDVIAGEM'), 10)).filter((n) => Number.isInteger(n) && n > 0);
  const gps = new Map();
  const trilha = new Map();
  const conv = new Map();
  const macros = new Map();
  const pontosPorRoteiro = new Map();

  if (ids.length && rast && rast.table && rast.idCol && rast.lat && rast.lon) {
    const schema = qi(rast.schema || 'public');
    const table = qi(rast.table);
    const idCol = qi(rast.idCol);
    const lat = qi(rast.lat);
    const lon = qi(rast.lon);
    const vel = rast.vel ? qi(rast.vel) : null;
    const dhP = rast.dhPosicao ? qi(rast.dhPosicao) : null;
    const dhR = rast.dhRegistro ? qi(rast.dhRegistro) : null;
    const ds = rast.dsPosicao ? qi(rast.dsPosicao) : null;
    if (schema && table && idCol && lat && lon && (dhP || dhR)) {
      const dhExpr = dhP && dhR ? `COALESCE(rv.${dhP}, rv.${dhR})` : `rv.${dhP || dhR}`;
      const sql = `
        SELECT DISTINCT ON (rv.${idCol})
          rv.${idCol} AS idviagem,
          rv.${lat} AS latitude,
          rv.${lon} AS longitude,
          ${vel ? `rv.${vel}` : 'NULL'} AS velocidade,
          ${dhExpr} AS dhposicao,
          ${ds ? `rv.${ds}` : `''`} AS dsposicao
        FROM ${schema}.${table} rv
        WHERE rv.${idCol} = ANY($1::int[])
          AND rv.${lat} IS NOT NULL AND rv.${lon} IS NOT NULL
          AND ${dhExpr} >= COALESCE(
            (SELECT v."DHINCLUSAO" FROM "VIAGEMMESTRE" v WHERE v."IDVIAGEM" = rv.${idCol}),
            ${dhExpr}
          )
        ORDER BY rv.${idCol}, ${dhExpr} DESC NULLS LAST
      `;
      try {
        const r = await pool.query(sql, [ids]);
        (r.rows || []).forEach((row) => {
          const id = num(pick(row, 'idviagem'));
          if (id) gps.set(id, row);
        });
      } catch (err) {
        console.warn('[Mapa painel] GPS:', err.message);
      }
      try {
        const rTrilha = await pool.query(`
          SELECT rv.${idCol} AS idviagem, rv.${lat} AS latitude, rv.${lon} AS longitude
          FROM ${schema}.${table} rv
          WHERE rv.${idCol} = ANY($1::int[])
            AND rv.${lat} IS NOT NULL AND rv.${lon} IS NOT NULL
            AND ${dhExpr} >= COALESCE(
              (SELECT v."DHINCLUSAO" FROM "VIAGEMMESTRE" v WHERE v."IDVIAGEM" = rv.${idCol}),
              ${dhExpr}
            )
        `, [ids]);
        (rTrilha.rows || []).forEach((row) => {
          const id = num(pick(row, 'idviagem'));
          const pla = num(pick(row, 'latitude'));
          const plo = num(pick(row, 'longitude'));
          if (!id || !Number.isFinite(pla) || !Number.isFinite(plo)) return;
          if (!trilha.has(id)) trilha.set(id, []);
          trilha.get(id).push({ lat: pla, lon: plo });
        });
      } catch (err) {
        console.warn('[Mapa painel] trilha:', err.message);
      }
    }
  }

  if (ids.length) {
    const lista = idsSql(ids);
    try {
      const rows = await q(pool, `
        SELECT DISTINCT ON ([C].[IDVIAGEM])
          [C].[IDVIAGEM],
          [C].[LATITUDE],
          [C].[LONGITUDE],
          [C].[DH_LOCALIZACAO_MOTORISTA] AS [DHPOSICAO]
        FROM [dbo].[CONVOCACAO] [C]
        WHERE [C].[IDVIAGEM] IN (${lista})
          AND [C].[LATITUDE] IS NOT NULL AND [C].[LONGITUDE] IS NOT NULL
        ORDER BY [C].[IDVIAGEM], [C].[DH_LOCALIZACAO_MOTORISTA] DESC NULLS LAST
      `);
      rows.forEach((row) => {
        const id = num(pick(row, 'IDVIAGEM'));
        if (id) conv.set(id, row);
      });
    } catch (err) {
      console.warn('[Mapa painel] convocação:', err.message);
    }

    try {
      const rows = await q(pool, `
        SELECT DISTINCT ON ([VO].[IDVIAGEM])
          [VO].[IDVIAGEM],
          COALESCE([T].[DSTIPOOCORRENCIA], '') AS [MACRO],
          [VO].[DTOCORRENCIA] AS [DHMACRO],
          CASE WHEN EXISTS (
            SELECT 1
            FROM [dbo].[VIAGEMOCORRENCIA] [V2]
            INNER JOIN [dbo].[TIPOOCORRENCIA] [T2]
              ON [V2].[CDTIPOOCORRENCIA] = [T2].[CDTIPOOCORRENCIA]
            WHERE [V2].[IDVIAGEM] = [VO].[IDVIAGEM]
              AND UPPER(TRIM(COALESCE([T2].[FGSITUACAO], ''))) = 'C'
              AND COALESCE([T2].[SEQ], 0) = 3
          ) THEN 1 ELSE 0 END AS [CARGA_OK],
          CASE WHEN EXISTS (
            SELECT 1
            FROM [dbo].[VIAGEMOCORRENCIA] [V3]
            INNER JOIN [dbo].[TIPOOCORRENCIA] [T3]
              ON [V3].[CDTIPOOCORRENCIA] = [T3].[CDTIPOOCORRENCIA]
            WHERE [V3].[IDVIAGEM] = [VO].[IDVIAGEM]
              AND UPPER(TRIM(COALESCE([T3].[FGSITUACAO], ''))) = 'D'
              AND COALESCE([T3].[SEQ], 0) = 3
          ) THEN 1 ELSE 0 END AS [DESCARGA_OK]
        FROM [dbo].[VIAGEMOCORRENCIA] [VO]
        LEFT JOIN [dbo].[TIPOOCORRENCIA] [T]
          ON [VO].[CDTIPOOCORRENCIA] = [T].[CDTIPOOCORRENCIA]
        WHERE [VO].[IDVIAGEM] IN (${lista})
        ORDER BY [VO].[IDVIAGEM], [VO].[DTOCORRENCIA] DESC NULLS LAST
      `);
      rows.forEach((row) => {
        const id = num(pick(row, 'IDVIAGEM'));
        if (id) macros.set(id, row);
      });
    } catch (err) {
      console.warn('[Mapa painel] macro:', err.message);
    }

    const roteiros = [...new Set(base.map((v) => parseInt(pick(v, 'IDROTEIRO'), 10)).filter((n) => n > 0))];
    if (roteiros.length) {
      try {
        const rows = await q(pool, `
          SELECT [P].[IDROTEIRO], [P].[ORDEM], [P].[SEQUENCIA], [P].[DSLOCAL], [P].[TPLOCAL],
                 [P].[LATITUDE], [P].[LONGITUDE], [P].[KMENTREPONTOS]
          FROM [dbo].[ROTEIROPONTOS] [P]
          WHERE [P].[IDROTEIRO] IN (${idsSql(roteiros)})
        `);
        rows.forEach((row) => {
          const idr = num(pick(row, 'IDROTEIRO'));
          if (!idr) return;
          if (!pontosPorRoteiro.has(idr)) pontosPorRoteiro.set(idr, []);
          pontosPorRoteiro.get(idr).push({
            ordem: pick(row, 'ORDEM'),
            seq: pick(row, 'SEQUENCIA'),
            nome: pick(row, 'DSLOCAL'),
            tipo: pick(row, 'TPLOCAL'),
            lat: pick(row, 'LATITUDE'),
            lon: pick(row, 'LONGITUDE'),
            kmEntre: pick(row, 'KMENTREPONTOS')
          });
        });
      } catch (err) {
        console.warn('[Mapa painel] roteiro:', err.message);
      }
    }
  }

  const alertas = await mapaContagem(pool, `
    SELECT [alrt].[IDVIAGEM] AS [IDVIAGEM], COUNT(*) AS [QTD]
    FROM [dbo].[ALERTS] [alrt]
    WHERE [alrt].[IDVIAGEM] IN (__IDS__)
      AND (COALESCE([alrt].[TENANT_ID], 'default') = @tid OR COALESCE([alrt].[TENANT_ID], 'default') = 'default')
      AND UPPER(COALESCE([alrt].[STATUS], 'PENDENTE')) NOT IN ('TRATADO', 'CANCELADO')
    GROUP BY [alrt].[IDVIAGEM]
  `, ids, tenantId);

  const sos = await mapaContagem(pool, `
    SELECT [sa].[CDVIAGEM] AS [IDVIAGEM], COUNT(*) AS [QTD]
    FROM [dbo].[SOS_ALERTS] [sa]
    WHERE [sa].[CDVIAGEM] IN (__IDS__)
      AND (COALESCE([sa].[TENANT_ID], 'default') = @tid OR COALESCE([sa].[TENANT_ID], 'default') = 'default')
      AND LOWER(COALESCE([sa].[STATUS], 'active')) NOT IN ('resolved', 'cancelled')
    GROUP BY [sa].[CDVIAGEM]
  `, ids, tenantId);

  const msgs = await mapaContagem(pool, `
    SELECT [c].[ID_VIAGEM] AS [IDVIAGEM], SUM(COALESCE([c].[MENSAGENS_NAO_LIDAS], 0)) AS [QTD]
    FROM [dbo].[CONVERSAS] [c]
    WHERE [c].[ID_VIAGEM] IN (__IDS__)
      AND (COALESCE([c].[TENANT_ID], 'default') = @tid OR COALESCE([c].[TENANT_ID], 'default') = 'default')
    GROUP BY [c].[ID_VIAGEM]
  `, ids, tenantId);

  const rotuloSit = {
    A: 'Aprovada', C: 'Cancelada', D: 'Preparação', E: 'Final de rota',
    F: 'Finalizada', M: 'Emissão documentos', P: 'Programada', T: 'Em trânsito'
  };

  return Promise.all(base.map(async (v) => {
    const id = num(pick(v, 'IDVIAGEM'));
    const g = gps.get(id);
    const c = conv.get(id);
    const fonte = g ? 'gps' : (c ? 'convocacao' : null);
    const pos = g || c || {};
    const lat = num(pick(pos, 'latitude', 'LATITUDE'));
    const lon = num(pick(pos, 'longitude', 'LONGITUDE'));
    const vel = g ? num(pick(g, 'velocidade', 'VELOCIDADE')) : null;
    let movimento = 'sem_posicao';
    if (fonte === 'gps') {
      if (vel == null) movimento = 'sem_velocidade';
      else if (vel <= PARADO_ATE_KMH) movimento = 'parado';
      else movimento = 'rodando';
    } else if (fonte === 'convocacao') {
      movimento = 'sem_telemetria';
    }
    const origemCidade = pick(v, 'ORIGEM_CIDADE');
    const origemUf = pick(v, 'ORIGEM_UF');
    const destCidade = pick(v, 'DESTINO_CIDADE');
    const destUf = pick(v, 'DESTINO_UF');
    const fg = String(pick(v, 'FGSITVIAGEM') || '').trim().toUpperCase();
    const dist = num(pick(v, 'DIST_VIAGEM')) || num(pick(v, 'DIST_ROTEIRO'));
    const idRoteiro = num(pick(v, 'IDROTEIRO'));
    const visitas = (trilha.get(id) || []).slice();
    if (c) {
      visitas.push({
        lat: num(pick(c, 'LATITUDE', 'latitude')),
        lon: num(pick(c, 'LONGITUDE', 'longitude'))
      });
    }
    const prog = progressoRota(pontosPorRoteiro.get(idRoteiro) || [], visitas, lat, lon, dist);
    let kmProximo = prog.kmProximo;
    let segundosProximo = null;
    if (prog.abertoForaDoTrecho && Number.isFinite(lat) && Number.isFinite(prog.proximoLat)) {
      const estrada = await rotaOsrm(lat, lon, prog.proximoLat, prog.proximoLon);
      if (estrada && estrada.km != null) kmProximo = round1(estrada.km);
      if (estrada && estrada.segundos != null) segundosProximo = estrada.segundos;
    }
    const kmFalta = round1((kmProximo || 0) + (prog.kmTrechosDepois || 0));
    const macro = macros.get(id);
    const cargaOk = macro && Number(pick(macro, 'CARGA_OK')) === 1;
    const descargaOk = macro && Number(pick(macro, 'DESCARGA_OK')) === 1;
    const fase = cargaOk ? 'descarga' : 'carregamento';
    const pontosRota = pontosPorRoteiro.get(idRoteiro) || [];
    const alvo = pontoPorTipo(pontosRota, fase === 'descarga' ? 'D' : 'O');
    const agoraMs = Date.now();
    const limiteRaw = fase === 'descarga' ? pick(v, 'DTPREVFINAL') : pick(v, 'DTPREVINICIO');
    const limite = limiteRaw ? new Date(limiteRaw) : null;
    const posicaoRaw = pick(pos, 'dhposicao', 'DHPOSICAO');
    const posicaoMs = posicaoRaw ? new Date(posicaoRaw).getTime() : null;
    const noPonto = !!(alvo && Number.isFinite(lat) && hav(lat, lon, alvo.lat, alvo.lon) <= RAIO_PONTO_KM);
    let durationSec = null;
    if (alvo && Number.isFinite(lat) && !noPonto && !descargaOk) {
      const mesmoProximo = Number.isFinite(prog.proximoLat)
        && Math.abs(prog.proximoLat - alvo.lat) < 0.0001
        && Math.abs(prog.proximoLon - alvo.lon) < 0.0001;
      if (mesmoProximo && segundosProximo != null) durationSec = segundosProximo;
      else {
        const ateAlvo = await rotaOsrm(lat, lon, alvo.lat, alvo.lon);
        if (ateAlvo && ateAlvo.segundos != null) durationSec = ateAlvo.segundos;
      }
    }
    const prazo = classificarPrazo({
      agoraMs,
      limite,
      durationSec,
      noPonto,
      posicaoMs: Number.isFinite(posicaoMs) ? posicaoMs : null,
      fase,
      concluido: descargaOk
    });
    const nAlerta = alertas.get(id) || 0;
    const nSos = sos.get(id) || 0;
    const nMsg = msgs.get(id) || 0;
    const noMapa = fonte === 'gps' ? 'GPS' : fonte === 'convocacao' ? 'Convocação' : 'Sem posição';
    return {
      id,
      viagem: id,
      placa: pick(v, 'PLACA') || '',
      motorista: pick(v, 'NMMOTORISTA') || '',
      situacao: rotuloSit[fg] || fg || '',
      fgsit: fg,
      prazo: prazo.prazo,
      prazoTexto: prazo.prazoTexto,
      prazoDetalhe: prazo.prazoDetalhe,
      tipo: pick(v, 'DSTIPOVIAGEM') || '',
      origem: [origemCidade, origemUf].filter(Boolean).join(' / '),
      destino: [destCidade, destUf].filter(Boolean).join(' / '),
      roteiro: pick(v, 'DSROTEIRO') || '',
      movimento,
      velocidade: vel,
      dhPosicao: pick(pos, 'dhposicao', 'DHPOSICAO'),
      posicao: g ? (pick(g, 'dsposicao', 'DSPOSICAO') || '') : (fonte === 'convocacao' ? 'Posição enviada na convocação' : ''),
      noMapa,
      latitude: lat,
      longitude: lon,
      macro: macro ? (pick(macro, 'MACRO') || '') : '',
      dhMacro: macro ? pick(macro, 'DHMACRO') : null,
      alerta: nAlerta,
      sos: nSos,
      mensagem: nMsg,
      pendencias: (nSos > 0 ? 100 : 0) + (nAlerta > 0 ? 10 : 0) + (nMsg > 0 ? 1 : 0),
      proximoPonto: prog.proximoNome || '',
      tipoProximo: prog.proximoTipo || '',
      kmProximo,
      kmRodado: prog.kmRodado,
      kmFalta,
      kmTotal: prog.kmTotal
    };
  }));
}

module.exports = {
  CATALOGO,
  PARADO_ATE_KMH,
  layoutPadrao,
  normalizarLayout,
  lerLayout,
  salvarLayout,
  enriquecer,
  classificarPrazo
};
