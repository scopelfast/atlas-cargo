'use strict';

/**
 * Grupos canônicos (nível 1) — chave estável para menu, permissões e API.
 * FGGRUPO no banco pode variar; aqui normalizamos para uma única chave ASCII.
 */
const GRUPO_POR_CDTIPO = {
  1: 'CADASTROS',
  2: 'CADASTROS',
  20: 'CADASTROS',
  3: 'SISTEMA',
  5: 'SISTEMA',
  31: 'SISTEMA',
  32: 'SISTEMA',
  4: 'GESTAO',
  30: 'GESTAO',
  33: 'GESTAO',
  40: 'GESTAO',
  41: 'GESTAO',
  42: 'GESTAO',
  43: 'GESTAO',
  10: 'EQUIPAMENTOS',
  11: 'EQUIPAMENTOS',
  12: 'EQUIPAMENTOS',
  13: 'EQUIPAMENTOS',
  14: 'EQUIPAMENTOS',
  23: 'EQUIPAMENTOS',
  21: 'LOGISTICA',
  22: 'LOGISTICA',
  24: 'LOGISTICA',
  25: 'LOGISTICA'
};

const ROTULO_GRUPO = {
  CADASTROS: 'Cadastros',
  EQUIPAMENTOS: 'Equipamentos',
  LOGISTICA: 'Logística',
  GESTAO: 'Gestão',
  SISTEMA: 'Sistema',
  WMS: 'WMS',
  OUTROS: 'Outros'
};

const ORDEM_GRUPO = {
  CADASTROS: 10,
  EQUIPAMENTOS: 20,
  LOGISTICA: 30,
  WMS: 35,
  GESTAO: 40,
  SISTEMA: 50,
  OUTROS: 999
};

/** DSPROGRAMA (pasta lógica) — alterações com alto impacto em segurança / menu global */
const PROGRAMAS_SENSIVEIS = new Set([
  'gerenciar-tenants-saas',
  'gerenciar-usuarios',
  'gerenciar-tipos-atividade',
  'gerenciar-configuracoes',
  'gerenciar-disparo-whatsapp',
  'campanhas-oportunidades'
]);

function stripDiacritics(s) {
  return String(s).normalize('NFD').replace(/\p{M}/gu, '');
}

function normalizePrograma(raw) {
  return raw != null ? String(raw).trim().toLowerCase() : '';
}

/**
 * @param {string|null|undefined} fgRaw
 * @returns {string}
 */
function normalizeGrupoPorFgString(fgRaw) {
  if (fgRaw == null) return 'OUTROS';
  const t = String(fgRaw).trim();
  if (!t) return 'OUTROS';
  if (/^\d+$/.test(t)) return 'OUTROS';

  const u = stripDiacritics(t).toUpperCase();
  const compact = u.replace(/[^A-Z0-9]/g, '');

  if (compact.includes('CADASTRO') || u === 'CADASTROS') return 'CADASTROS';
  if (compact.includes('EQUIPAMENTO') || u === 'EQUIPAMENTOS') return 'EQUIPAMENTOS';
  if (
    compact.includes('LOGIST') ||
    compact.includes('VIAGEM') ||
    u.includes('LOGISTICA') ||
    u === 'LOGISTICA' ||
    u.includes('VIAGENS')
  ) {
    return 'LOGISTICA';
  }
  if (compact.includes('GESTAO') || compact.includes('ADMIN') || u === 'GESTAO' || u.includes('GESTAO')) {
    return 'GESTAO';
  }
  if (compact.includes('SYSTEM') || compact.includes('SISTEMA') || u === 'SISTEMA') return 'SISTEMA';
  if (compact === 'WMS' || u.includes('WMS') || compact.includes('ARMAZEM') || compact.includes('ARMAZEN')) {
    return 'WMS';
  }
  return 'OUTROS';
}

/**
 * @param {number|string|null|undefined} id
 * @returns {string}
 */
function normalizeGrupoChaveFromParts(id, fgGrupo, dsPrograma) {
  const n = id != null && id !== '' ? Number(id) : NaN;
  if (Number.isFinite(n) && GRUPO_POR_CDTIPO[n]) {
    return GRUPO_POR_CDTIPO[n];
  }
  return normalizeGrupoPorFgString(fgGrupo);
}

/**
 * Aceita linha TIPOATIVIDADE / menu (chaves MSSQL ou postgres em minúsculo).
 * @param {Record<string, unknown>} row
 */
function enrichTipoAtividadeRow(row) {
  const id = row.CDTIPOATIVIDADE ?? row.cdtipoatividade ?? row.id;
  const fg = row.FGGRUPO ?? row.fggrupo;
  const dsp = row.DSPROGRAMA ?? row.dsprograma ?? '';
  const grupoChave = normalizeGrupoChaveFromParts(id, fg, dsp);
  const sensivel = PROGRAMAS_SENSIVEIS.has(normalizePrograma(dsp));
  const rotulo = ROTULO_GRUPO[grupoChave] || ROTULO_GRUPO.OUTROS;
  const ordem = ORDEM_GRUPO[grupoChave] ?? ORDEM_GRUPO.OUTROS;
  return {
    ...row,
    GRUPO_CHAVE: grupoChave,
    GRUPO_ROTULO: rotulo,
    ORDEM_GRUPO: ordem,
    ATIVIDADE_SENSIVEL: sensivel
  };
}

/** Ordem fixa para ordenar grupos na UI (sidebar / acessos) */
const ORDEM_CHAVES_MENU = [
  'CADASTROS',
  'EQUIPAMENTOS',
  'LOGISTICA',
  'WMS',
  'GESTAO',
  'SISTEMA',
  'OUTROS'
];

module.exports = {
  GRUPO_POR_CDTIPO,
  ROTULO_GRUPO,
  ORDEM_GRUPO,
  PROGRAMAS_SENSIVEIS,
  normalizeGrupoPorFgString,
  normalizeGrupoChaveFromParts,
  enrichTipoAtividadeRow,
  ORDEM_CHAVES_MENU
};
