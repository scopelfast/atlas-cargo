'use strict';

/**
 * Rótulo do ponto de entrega / destino em NF-e de saída WMS (alinhado às telas Expedição e Cargas).
 *
 * Prioridade:
 * 1) XNOME_ENTREGA — nome do local de entrega / unidade de destino na operação (quando informado na NF).
 * 2) XNOME_DEST — razão social do destinatário (“local de destino” da nota).
 * 3) Logradouro + número (XLGR_DEST, NRO_DEST) quando nomes vierem vazios.
 * 4) Município / UF mínimo.
 *
 * Aceita chaves em camelCase ou minúsculas (node-pg).
 */
function trimField(v) {
  if (v == null) return '';
  return String(v).trim();
}

function field(row, camel, snake) {
  if (!row) return '';
  const a = trimField(row[camel]);
  if (a) return a;
  return trimField(row[snake]);
}

function nomeEntregaUnidadeOuLocalDestino(row) {
  if (!row) return '';
  let s = field(row, 'XNOME_ENTREGA', 'xnome_entrega');
  if (s) return s;
  s = field(row, 'XNOME_DEST', 'xnome_dest');
  if (s) return s;
  const log = field(row, 'XLGR_DEST', 'xlgr_dest');
  const nro = field(row, 'NRO_DEST', 'nro_dest');
  const end = [log, nro].filter(Boolean).join(', ');
  if (end) return end;
  const mun = field(row, 'XMUN_DEST', 'xmun_dest');
  const uf = field(row, 'UF_DEST', 'uf_dest');
  return [mun, uf].filter(Boolean).join(' / ');
}

/**
 * Cidade e UF do ponto de entrega operacional.
 * Na importação do XML, o bloco &lt;entrega&gt; (quando existe) preenche XMUN_DEST / UF_DEST;
 * não usar município do emitente nem confundir com razão social do destinatário.
 */
function localidadeEntregaNfe(row) {
  return {
    cidade: field(row, 'XMUN_DEST', 'xmun_dest'),
    uf: field(row, 'UF_DEST', 'uf_dest'),
  };
}

/** Nome da unidade / local de entrega (prioriza XNOME_ENTREGA). */
function nomeUnidadeEntregaNfe(row) {
  const ne = field(row, 'XNOME_ENTREGA', 'xnome_entrega');
  if (ne) return ne;
  return field(row, 'XNOME_DEST', 'xnome_dest') || '—';
}

/**
 * Rótulo da combo “NF disponível” (Cargas programadas):
 * UF — Cidade — Unidade de entrega — Número/Série
 */
function labelNfeDisponivelCombo(row) {
  const loc = localidadeEntregaNfe(row);
  const unidade = nomeUnidadeEntregaNfe(row);
  const numero = field(row, 'NUMERO_NF', 'numero_nf') || '?';
  const serie = field(row, 'SERIE', 'serie') || '?';
  const uf = loc.uf || '—';
  const cidade = loc.cidade || '—';
  return [uf, cidade, unidade, `${numero}/${serie}`].join(' — ');
}

function numeroNfOrdenacao(row) {
  const raw = field(row, 'NUMERO_NF', 'numero_nf').replace(/\D/g, '');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Ordenação: UF entrega → cidade entrega → unidade → número NF. */
function compareNfeDisponivelOrdenacao(a, b) {
  const la = localidadeEntregaNfe(a);
  const lb = localidadeEntregaNfe(b);
  const ufA = (la.uf || '').toUpperCase();
  const ufB = (lb.uf || '').toUpperCase();
  if (ufA !== ufB) return ufA.localeCompare(ufB, 'pt');
  const cidA = (la.cidade || '').toUpperCase();
  const cidB = (lb.cidade || '').toUpperCase();
  if (cidA !== cidB) return cidA.localeCompare(cidB, 'pt');
  const unA = nomeUnidadeEntregaNfe(a).toUpperCase();
  const unB = nomeUnidadeEntregaNfe(b).toUpperCase();
  if (unA !== unB) return unA.localeCompare(unB, 'pt');
  const na = numeroNfOrdenacao(a);
  const nb = numeroNfOrdenacao(b);
  if (na !== nb) return na - nb;
  const sa = field(a, 'SERIE', 'serie');
  const sb = field(b, 'SERIE', 'serie');
  return sa.localeCompare(sb, 'pt');
}

/** Uma linha: nome (ou fallback) + sufixo “ — município/UF” quando houver e for distinto do nome. */
function formatDestinoNfeComMunicipio(row) {
  const nome = nomeEntregaUnidadeOuLocalDestino(row);
  const loc = localidadeEntregaNfe(row);
  const city = [loc.cidade, loc.uf].filter(Boolean).join(' / ');
  if (!nome && !city) return '—';
  if (!nome) return city;
  if (!city) return nome;
  if (nome === city) return nome;
  return `${nome} — ${city}`;
}

module.exports = {
  nomeEntregaUnidadeOuLocalDestino,
  localidadeEntregaNfe,
  nomeUnidadeEntregaNfe,
  labelNfeDisponivelCombo,
  compareNfeDisponivelOrdenacao,
  formatDestinoNfeComMunicipio,
};
