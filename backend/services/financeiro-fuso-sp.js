'use strict';

/**
 * Fuso comercial Atlas Pay (D5): America/Sao_Paulo.
 *
 * Evidência de armazenamento (26/11/2026, atlas_cargo_prd):
 * - Colunas DH_* de FIN_*, CONVOCACAO, VIAGEMMESTRE = timestamp without time zone
 * - Sessão PG local: TimeZone = America/Sao_Paulo
 * - Valores persistidos são horário de parede (naive), não timestamptz UTC
 *
 * Regra: NÃO interpretar strings naive como UTC. Comparações e vencimentos
 * usam civil datetime em America/Sao_Paulo, independente de process.env.TZ.
 *
 * node-pg devolve Date para timestamp without time zone interpretando os dígitos
 * como fuso do processo Node; getFullYear/getHours recuperam os dígitos de parede
 * armazenados. Para "agora", usar Intl no fuso SP (não getters locais do host).
 */

const TZ = 'America/Sao_Paulo';

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatWall(p) {
  return `${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
}

/** Partes de parede a partir de um instante absoluto, forçado em America/Sao_Paulo. */
function spPartsFromInstant(ms) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const map = {};
  for (const part of dtf.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let h = Number(map.hour);
  if (h === 24) h = 0;
  return {
    y: Number(map.year),
    mo: Number(map.month),
    d: Number(map.day),
    h,
    mi: Number(map.minute),
    s: Number(map.second),
  };
}

function nowSpWall(ms) {
  return formatWall(spPartsFromInstant(ms != null ? ms : Date.now()));
}

/**
 * Normaliza string / Date do banco para parede SP `YYYY-MM-DD HH:MM:SS`.
 * Strings: dígitos literais (naive = SP). Date do pg: getters locais = dígitos persistidos.
 */
function toSpWall(input) {
  if (input == null || input === '') return null;
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return formatWall({
      y: input.getFullYear(),
      mo: input.getMonth() + 1,
      d: input.getDate(),
      h: input.getHours(),
      mi: input.getMinutes(),
      s: input.getSeconds(),
    });
  }
  const s = String(input).trim();
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?)?/
  );
  if (!m) return null;
  return formatWall({
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4] || 0),
    mi: Number(m[5] || 0),
    s: Number(m[6] || 0),
  });
}

function parseWallParts(input) {
  const wall = toSpWall(input);
  if (!wall) return null;
  const m = wall.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: Number(m[6]),
  };
}

/**
 * Chave monotônica para ordenar/comparar paredes SP.
 * Usa Date.UTC só como aritmética civil — não afirma que o instante é UTC.
 */
function wallToOrderMs(input) {
  const p = parseWallParts(input);
  if (!p) return null;
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
}

function orderMsToWall(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const x = new Date(ms);
  return formatWall({
    y: x.getUTCFullYear(),
    mo: x.getUTCMonth() + 1,
    d: x.getUTCDate(),
    h: x.getUTCHours(),
    mi: x.getUTCMinutes(),
    s: x.getUTCSeconds(),
  });
}

function diasEntre(a, b) {
  const ta = wallToOrderMs(a);
  const tb = wallToOrderMs(b);
  if (ta == null || tb == null || tb <= ta) return 0;
  return Math.round((tb - ta) / 86400000);
}

/** Soma dias corridos civis preservando horário de parede. */
function addDiasCorridos(tsStr, dias) {
  const p = parseWallParts(tsStr);
  if (!p) return null;
  const n = Number(dias);
  if (!Number.isFinite(n)) return null;
  const ms = Date.UTC(p.y, p.mo - 1, p.d + n, p.h, p.mi, p.s);
  return orderMsToWall(ms);
}

/** Instantâneo de aprovação comercial + vencimento D5 (+10 dias corridos). */
function aprovacaoEVencimento(nowMs) {
  const dhAprovacao = nowSpWall(nowMs);
  const dhVencimento = addDiasCorridos(dhAprovacao, 10);
  return { dhAprovacao, dhVencimento, fuso: TZ };
}

module.exports = {
  TZ,
  nowSpWall,
  toSpWall,
  parseWallParts,
  wallToOrderMs,
  orderMsToWall,
  diasEntre,
  addDiasCorridos,
  aprovacaoEVencimento,
  spPartsFromInstant,
};
