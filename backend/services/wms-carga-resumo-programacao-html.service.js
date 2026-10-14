'use strict';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n, dec) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtMoeda(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtFiltros(f) {
  if (!f || typeof f !== 'object') return '—';
  const parts = [];
  if (f.busca || f.q) parts.push(`Busca: ${esc(f.busca || f.q)}`);
  if (f.stCarga) parts.push(`Status carga: ${esc(f.stCarga)}`);
  if (f.stExpedicao) {
    const st = String(f.stExpedicao).toUpperCase();
    const lbl =
      st === 'NAO_EXPEDIDA' || st === 'NAO_SAIDA' || st === 'PENDENTE_SAIDA'
        ? 'Ainda não saiu (não expedida)'
        : f.stExpedicao;
    parts.push(`Expedição: ${esc(lbl)}`);
  }
  if (f.dhCriacaoDe) parts.push(`Criada de: ${esc(f.dhCriacaoDe)}`);
  if (f.dhCriacaoAte) parts.push(`Criada até: ${esc(f.dhCriacaoAte)}`);
  if (f.dhExpedicaoDe) parts.push(`Saída de: ${esc(f.dhExpedicaoDe)}`);
  if (f.dhExpedicaoAte) parts.push(`Saída até: ${esc(f.dhExpedicaoAte)}`);
  return parts.length ? parts.join(' · ') : 'Nenhum filtro adicional (lista)';
}

/** Agrega linhas (1 por NF) em 1 linha por local de entrega (ENxNome). */
function subtotalLinhas(linhas) {
  const acc = { qtdNfes: 0, qt: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 };
  for (const ln of linhas || []) {
    acc.qtdNfes += 1;
    acc.qt += Number(ln.qt) || 0;
    acc.vlNf += Number(ln.vlNf) || 0;
    acc.pesoProduto += Number(ln.pesoProduto) || 0;
    acc.pesoSeco += Number(ln.pesoSeco) || 0;
    acc.pesoFrio += Number(ln.pesoFrio) || 0;
  }
  return {
    qtdNfes: acc.qtdNfes,
    qt: Number(acc.qt.toFixed(4)),
    vlNf: Number(acc.vlNf.toFixed(2)),
    pesoProduto: Number(acc.pesoProduto.toFixed(3)),
    pesoSeco: Number(acc.pesoSeco.toFixed(3)),
    pesoFrio: Number(acc.pesoFrio.toFixed(3)),
  };
}

function agruparPorPontoEntrega(linhas) {
  const map = new Map();
  for (const ln of linhas || []) {
    const k = String(ln.enxNome || '—').trim() || '—';
    if (!map.has(k)) {
      map.set(k, { enxNome: k, qtdNf: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 });
    }
    const g = map.get(k);
    g.qtdNf += 1;
    g.vlNf += Number(ln.vlNf) || 0;
    g.pesoProduto += Number(ln.pesoProduto) || 0;
    g.pesoSeco += Number(ln.pesoSeco) || 0;
    g.pesoFrio += Number(ln.pesoFrio) || 0;
  }
  return Array.from(map.values())
    .map((g) => ({
      enxNome: g.enxNome,
      qtdNf: g.qtdNf,
      vlNf: Number(g.vlNf.toFixed(2)),
      pesoProduto: Number(g.pesoProduto.toFixed(3)),
      pesoSeco: Number(g.pesoSeco.toFixed(3)),
      pesoFrio: Number(g.pesoFrio.toFixed(3)),
    }))
    .sort((a, b) => a.enxNome.localeCompare(b.enxNome, 'pt-BR'));
}

function fmtPesoCell(n) {
  const x = Number(n);
  return Number.isFinite(x) && x > 0 ? fmtNum(x, 3) : '—';
}

function fmtMunUf(ln) {
  const mun = String(ln.enxMun || '').trim() || '—';
  const uf = String(ln.enxUf || '').trim();
  if (!uf || uf === '—') return mun;
  return `${mun} / ${uf}`;
}

const COLS = 6;

/** Chave interna para NF-e sem match em Cadastro Geral → Endereços de entrega. */
const ROTA_SEM_CADASTRO = '__SEM_CADASTRO__';

function fmtNfIdent(ln) {
  const num = ln.numeroNf != null ? String(ln.numeroNf).trim() : '?';
  const ser = ln.serieNf != null ? String(ln.serieNf).trim() : '';
  return ser ? `NF ${num}/${ser}` : `NF ${num}`;
}

function fmtCep(cep) {
  const d = String(cep || '').replace(/\D/g, '');
  if (d.length === 8) return `${d.slice(0, 5)}-${d.slice(5)}`;
  return d || '—';
}

function fmtEnderecoEntregaLinha(ln) {
  const log = String(ln.enderecoLogradouro || '').trim();
  const nro = String(ln.enderecoNumero || '').trim() || 'S/N';
  const compl = String(ln.enderecoComplemento || '').trim();
  const mun = String(ln.enxMun || '').trim() || '—';
  const uf = String(ln.enxUf || '').trim() || '';
  const cep = fmtCep(ln.enderecoCep);
  let rua = log ? `${log}, ${nro}` : nro;
  if (compl) rua += ` (${compl})`;
  const loc = uf && uf !== '—' ? `${mun} / ${uf}` : mun;
  const cnpj = ln.cnpjEntrega
    ? `CNPJ ${ln.cnpjEntrega.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}`
    : '';
  return [rua, loc, cep !== '—' ? `CEP ${cep}` : '', cnpj].filter(Boolean).join(' · ');
}

function linhasSemCadastro(linhas) {
  return (linhas || []).filter((ln) => ln.nrRotaCad == null);
}

function rowBlk(cls, html) {
  return `<tr class="${cls}"><td colspan="${COLS}" class="blk-cell">${html}</td></tr>`;
}

const TABLE_COLGROUP = `<colgroup>
  <col class="col-entrega" span="1" />
  <col class="col-nf" span="1" />
  <col class="col-valor" span="1" />
  <col class="col-peso-seco" span="1" />
  <col class="col-peso-frio" span="1" />
  <col class="col-peso" span="1" />
</colgroup>`;

function rowTheadDetail() {
  return `<tr class="hdr-detail-cols">
    <th class="col-entrega">Local de entrega (ENxNome)</th>
    <th class="num col-nf">Doc.<br />(NF)</th>
    <th class="num col-valor">Valor</th>
    <th class="num col-peso-seco">Seco<br />(kg)</th>
    <th class="num col-peso-frio">Frio<br />(kg)</th>
    <th class="num col-peso">Peso<br />(kg)</th>
  </tr>`;
}

function rowDetailEntrega(g) {
  return `<tr class="row-detail">
    <td class="col-entrega">${esc(g.enxNome)}</td>
    <td class="num col-nf">${g.qtdNf}</td>
    <td class="num col-valor">${g.vlNf > 0 ? fmtMoeda(g.vlNf) : '—'}</td>
    <td class="num col-peso-seco">${fmtPesoCell(g.pesoSeco)}</td>
    <td class="num col-peso-frio">${fmtPesoCell(g.pesoFrio)}</td>
    <td class="num col-peso">${fmtPesoCell(g.pesoProduto)}</td>
  </tr>`;
}

/** Uma NF-e sem ponto de entrega no Cadastro Geral (detalhe explícito). */
function rowDetailSemCadastro(ln) {
  return `<tr class="row-detail row-sem-cad">
    <td class="col-entrega">
      <div class="sem-cad-nf-titulo"><strong>${esc(fmtNfIdent(ln))}</strong></div>
      <div class="sem-cad-ponto">${esc(ln.enxNome || '—')}</div>
      <div class="sem-cad-endereco">${esc(fmtEnderecoEntregaLinha(ln))}</div>
      <div class="sem-cad-aviso">Não há este endereço de entrega em <strong>Gerenciar Cadastro Geral → Endereços de entrega</strong>. Cadastre o ponto (nome, rota, UF, município, CEP, logradouro, nº e coordenadas) com os dados acima da NF-e.</div>
    </td>
    <td class="num col-nf">1</td>
    <td class="num col-valor">${ln.vlNf > 0 ? fmtMoeda(ln.vlNf) : '—'}</td>
    <td class="num col-peso-seco">${fmtPesoCell(ln.pesoSeco)}</td>
    <td class="num col-peso-frio">${fmtPesoCell(ln.pesoFrio)}</td>
    <td class="num col-peso">${fmtPesoCell(ln.pesoProduto)}</td>
  </tr>`;
}

function htmlListaSemCadastroCompacta(linhas) {
  const lista = linhasSemCadastro(linhas);
  if (!lista.length) return '';
  return `<ul class="exec-sem-cad-list">${lista
    .map(
      (ln) =>
        `<li><strong>${esc(fmtNfIdent(ln))}</strong> — ${esc(ln.enxNome || '—')}<br /><span class="sem-cad-endereco">${esc(fmtEnderecoEntregaLinha(ln))}</span></li>`
    )
    .join('')}</ul>`;
}

function rowSubtotal(label, sub, cls) {
  return `<tr class="${cls}">
    <td class="sub-label col-entrega"><span class="sub-tag">SUBTOTAL</span> ${esc(label)}</td>
    <td class="num sub-val col-nf">${sub.qtdNfes != null ? sub.qtdNfes : 0}</td>
    <td class="num sub-val col-valor">${fmtMoeda(sub.vlNf)}</td>
    <td class="num sub-val col-peso-seco">${fmtPesoCell(sub.pesoSeco)}</td>
    <td class="num sub-val col-peso-frio">${fmtPesoCell(sub.pesoFrio)}</td>
    <td class="num sub-val col-peso">${fmtPesoCell(sub.pesoProduto)}</td>
  </tr>`;
}

/** Agrupa linhas: rota cad. → município/UF. */
function agruparLinhasCarga(linhas) {
  const porRota = new Map();
  for (const ln of linhas || []) {
    const rk =
      ln.nrRotaCad != null && Number.isFinite(Number(ln.nrRotaCad))
        ? String(ln.nrRotaCad)
        : ROTA_SEM_CADASTRO;
    if (!porRota.has(rk)) porRota.set(rk, new Map());
    const porMun = porRota.get(rk);
    const mk = `${String(ln.enxUf || '').trim()}|${String(ln.enxMun || '').trim()}`;
    if (!porMun.has(mk)) porMun.set(mk, []);
    porMun.get(mk).push(ln);
  }
  const rotas = Array.from(porRota.entries()).sort((a, b) => {
    const na = a[0] === ROTA_SEM_CADASTRO ? 99999 : Number(a[0]);
    const nb = b[0] === ROTA_SEM_CADASTRO ? 99999 : Number(b[0]);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return String(a[0]).localeCompare(String(b[0]), 'pt-BR');
  });
  return rotas.map(([rotaKey, porMun]) => {
    const municipios = Array.from(porMun.entries())
      .map(([mk, itens]) => {
        const porEntrega = agruparPorPontoEntrega(itens);
        return {
          label: fmtMunUf(itens[0]),
          itens,
          porEntrega,
          qtdPontos: porEntrega.length,
          subtotal: subtotalLinhas(itens),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    const todas = municipios.flatMap((m) => m.itens);
    const semCadastro = rotaKey === ROTA_SEM_CADASTRO;
    return {
      rotaKey,
      rotaLabel: semCadastro ? 'Sem cadastro' : rotaKey,
      semCadastro,
      municipios,
      subtotal: subtotalLinhas(todas),
    };
  });
}

/** Cabeçalho da carga com totais embutidos no canto direito. */
function rowCargaHeader(carga, sub, rotasBadges) {
  const peso = sub.pesoProduto > 0 ? `${fmtNum(sub.pesoProduto, 3)} kg` : '—';
  const seco = sub.pesoSeco > 0 ? `${fmtNum(sub.pesoSeco, 3)} kg` : '—';
  const frio = sub.pesoFrio > 0 ? `${fmtNum(sub.pesoFrio, 3)} kg` : '—';
  const totaisHtml = `
    <span class="carga-totais">
      <span class="carga-totais-item"><strong>${sub.qtdNfes || 0}</strong> NF-e</span>
      <span class="carga-totais-item"><strong>${fmtMoeda(sub.vlNf)}</strong></span>
      <span class="carga-totais-item carga-totais-seco" title="Seco / ambiente">seco <strong>${seco}</strong></span>
      <span class="carga-totais-item carga-totais-frio" title="Refrigerado / congelado">frio <strong>${frio}</strong></span>
      <span class="carga-totais-item carga-totais-peso"><strong>${peso}</strong></span>
    </span>`;
  return `<tr class="blk-carga"><td colspan="${COLS}" class="blk-cell">
    <div class="carga-header-flex">
      <span class="carga-id">Carga #${esc(carga.id)}</span>
      <span class="carga-desc">${esc(carga.dsCarga || '')}</span>
      <span class="carga-rotas">${rotasBadges}</span>
      ${totaisHtml}
    </div>
  </td></tr>`;
}

function badgesRotasFromGrupos(grupos) {
  if (!grupos || !grupos.length) return '';
  return grupos
    .map((g) => {
      if (g.semCadastro) {
        const n = g.subtotal?.qtdNfes || 0;
        return `<span class="rota-badge rota-badge-sem" title="NF-e sem ponto de entrega em Gerenciar Cadastro Geral → Endereços de entrega">${esc(`Sem cadastro (${n} NF)`)}</span>`;
      }
      return `<span class="rota-badge">${esc(`Rota ${g.rotaLabel}`)}</span>`;
    })
    .join(' ');
}

function buildBodyHierarquico(rotas) {
  let html = '';
  for (const rota of rotas || []) {
    for (const carga of rota.cargas || []) {
      const linhas = carga.linhas || [];
      if (!linhas.length) {
        html += rowBlk(
          'blk-carga',
          `<div class="carga-header-flex"><span class="carga-id">Carga #${esc(carga.id)}</span> <span class="carga-desc">${esc(carga.dsCarga || '')}</span> <em class="carga-vazia">(sem NF vinculada)</em></div>`
        );
        continue;
      }
      const gruposRota = agruparLinhasCarga(linhas);
      const subCarga = carga.subtotal || subtotalLinhas(linhas);
      html += rowCargaHeader(carga, subCarga, badgesRotasFromGrupos(gruposRota));
      const mostrarRotaIntermed = gruposRota.length > 1;
      for (const gr of gruposRota) {
        if (mostrarRotaIntermed || gr.semCadastro) {
          const hdrRota = gr.semCadastro
            ? `<div class="rota-header-flex rota-header-sem-cad"><span><strong>Sem cadastro no Cadastro Geral</strong> — ${gr.subtotal.qtdNfes} NF-e sem ponto em <em>Endereços de entrega</em></span> <span class="rota-totais"><strong>${fmtMoeda(gr.subtotal.vlNf)}</strong> · <strong>${gr.subtotal.pesoProduto > 0 ? fmtNum(gr.subtotal.pesoProduto, 3) + ' kg' : '—'}</strong></span></div>`
            : `<div class="rota-header-flex"><span>Rota cad.: <strong>${esc(gr.rotaLabel)}</strong></span> <span class="rota-totais"><strong>${gr.subtotal.qtdNfes}</strong> NF · <strong>${fmtMoeda(gr.subtotal.vlNf)}</strong> · <strong>${gr.subtotal.pesoProduto > 0 ? fmtNum(gr.subtotal.pesoProduto, 3) + ' kg' : '—'}</strong></span></div>`;
          html += rowBlk(gr.semCadastro ? 'blk-rota blk-rota-sem-cad' : 'blk-rota', hdrRota);
        }
        for (const mun of gr.municipios) {
          const munHdr = `${esc(mun.label)} — <span class="blk-meta">${mun.qtdPontos} ponto(s) · ${mun.subtotal.qtdNfes} NF-e</span>`;
          html += rowBlk('blk-mun', munHdr);
          html += rowTheadDetail();
          if (gr.semCadastro) {
            for (const ln of mun.itens) {
              html += rowDetailSemCadastro(ln);
            }
          } else {
            for (const ent of mun.porEntrega) {
              html += rowDetailEntrega(ent);
            }
          }
          /** Subtotal por município só aparece quando ele tem mais de 1 ponto (senão é redundância). */
          if (mun.qtdPontos > 1) {
            html += rowSubtotal(mun.label, mun.subtotal, 'sub-mun');
          }
        }
      }
      html += rowSubtotal(
        `TOTAL Carga #${carga.id}`,
        subCarga,
        'sub-carga'
      );
    }
  }
  return html;
}

/** Tabela executiva no topo: 1 linha por carga, com rotas usadas, NF, valor, peso. */
function buildExecutivoHtml(rotas) {
  const linhas = [];
  for (const rota of rotas || []) {
    for (const carga of rota.cargas || []) {
      const lns = carga.linhas || [];
      const sub = carga.subtotal || subtotalLinhas(lns);
      const grupos = agruparLinhasCarga(lns);
      const pontos = grupos.reduce(
        (acc, g) => acc + g.municipios.reduce((s, m) => s + m.qtdPontos, 0),
        0
      );
      linhas.push({ carga, sub, grupos, pontos, lns });
    }
  }
  if (!linhas.length) return '';
  let totQt = 0;
  let totV = 0;
  let totP = 0;
  let totSeco = 0;
  let totFrio = 0;
  let totNf = 0;
  let totPontos = 0;
  const rows = linhas
    .map((it) => {
      const sub = it.sub;
      totNf += sub.qtdNfes || 0;
      totV += Number(sub.vlNf) || 0;
      totP += Number(sub.pesoProduto) || 0;
      totSeco += Number(sub.pesoSeco) || 0;
      totFrio += Number(sub.pesoFrio) || 0;
      totQt += Number(sub.qt) || 0;
      totPontos += it.pontos || 0;
      const semCadHtml = htmlListaSemCadastroCompacta(it.lns);
      return `<tr>
        <td class="exec-id">#${esc(it.carga.id)}</td>
        <td class="exec-desc">${esc(it.carga.dsCarga || '')}</td>
        <td class="exec-rotas">${badgesRotasFromGrupos(it.grupos)}${semCadHtml}</td>
        <td class="num">${it.pontos}</td>
        <td class="num"><strong>${sub.qtdNfes || 0}</strong></td>
        <td class="num">${fmtMoeda(sub.vlNf)}</td>
        <td class="num col-peso-seco">${fmtPesoCell(sub.pesoSeco)}</td>
        <td class="num col-peso-frio">${fmtPesoCell(sub.pesoFrio)}</td>
        <td class="num"><strong>${sub.pesoProduto > 0 ? fmtNum(sub.pesoProduto, 3) + ' kg' : '—'}</strong></td>
      </tr>`;
    })
    .join('');
  return `
  <h2 class="exec-title">Resumo executivo · cargas (${linhas.length})</h2>
  <table class="exec-table">
    <colgroup>
      <col class="exec-col-id" />
      <col class="exec-col-desc" />
      <col class="exec-col-rotas" />
      <col class="exec-col-pontos" />
      <col class="exec-col-nf" />
      <col class="exec-col-valor" />
      <col class="exec-col-seco" />
      <col class="exec-col-frio" />
      <col class="exec-col-peso" />
    </colgroup>
    <thead>
      <tr>
        <th>Carga</th>
        <th>Descrição</th>
        <th>Rotas cad.</th>
        <th class="num">Pontos</th>
        <th class="num">NF-e</th>
        <th class="num">Valor</th>
        <th class="num">Seco</th>
        <th class="num">Frio</th>
        <th class="num">Peso</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="exec-total">
        <td colspan="3"><strong>TOTAL GERAL</strong></td>
        <td class="num"><strong>${totPontos}</strong></td>
        <td class="num"><strong>${totNf}</strong></td>
        <td class="num"><strong>${fmtMoeda(totV)}</strong></td>
        <td class="num col-peso-seco"><strong>${fmtPesoCell(totSeco)}</strong></td>
        <td class="num col-peso-frio"><strong>${fmtPesoCell(totFrio)}</strong></td>
        <td class="num"><strong>${fmtNum(totP, 3)} kg</strong></td>
      </tr>
    </tbody>
  </table>
  <p class="peso-legenda-curta"><strong>Seco / Frio / Peso</strong>: mesma regra dos cards ao abrir a carga (Seco kg · Refrig./cong. kg · Peso estimado). Classificação por <code>TIPO_ARMAZENAGEM</code> + NCM + descrição. Peso total = <code>PESO_KG</code> × <code>qCom</code> (ou PesoNF da planilha quando importado).</p>`;
}

function buildResumoProgramacaoHtml(payload) {
  const {
    rotas = [],
    totalGeral,
    geradoEm,
    aviso,
    qtdCargas,
    limiteCargas,
    filtros,
    filtrosEfetivos,
  } = payload;
  const filtrosExibir = filtrosEfetivos || filtros;
  const dh = geradoEm ? new Date(geradoEm).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
  const execHtml = buildExecutivoHtml(rotas);
  const bodyRows = buildBodyHierarquico(rotas);
  const tot = totalGeral || { qt: 0, vlNf: 0, pesoProduto: 0, qtdNfes: 0 };
  if (tot.qtdNfes == null) {
    let n = 0;
    for (const rota of rotas) {
      for (const c of rota.cargas || []) n += (c.linhas || []).length;
    }
    tot.qtdNfes = n;
  }

  const avisoHtml = aviso ? `<p class="aviso">${esc(aviso)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Resumo programação de cargas</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 11px;
      color: #0f172a;
      margin: 12px 14px;
      max-width: 210mm;
    }
    h1 { font-size: 17px; margin: 0 0 6px; }
    .meta { color: #64748b; margin-bottom: 12px; font-size: 10px; line-height: 1.45; }
    .aviso { background: #fffbeb; border: 1px solid #fcd34d; padding: 8px 12px; border-radius: 6px; color: #92400e; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; table-layout: fixed; }
    col.col-entrega { width: 40%; }
    col.col-nf { width: 8%; }
    col.col-valor { width: 16%; }
    col.col-peso-seco { width: 12%; }
    col.col-peso-frio { width: 12%; }
    col.col-peso { width: 12%; }
    .col-peso-seco { color: #854d0e; }
    .col-peso-frio { color: #1d4ed8; }
    .carga-totais-seco strong { color: #fde68a; }
    .carga-totais-frio strong { color: #93c5fd; }
    th, td { border: 1px solid #94a3b8; padding: 4px 6px; text-align: left; vertical-align: top; }
    th.col-entrega, td.col-entrega {
      word-wrap: break-word;
      overflow-wrap: anywhere;
      hyphens: auto;
      padding-right: 10px;
    }
    td.num, th.num {
      text-align: right;
      white-space: nowrap;
      padding-left: 6px;
      padding-right: 8px;
      font-variant-numeric: tabular-nums;
    }
    .blk-cell { border-bottom: none; }
    .blk-meta { font-weight: 500; opacity: 0.9; font-size: 10px; }
    tr.blk-carga td {
      background: #0f172a; color: #f8fafc; font-size: 13px; font-weight: 700;
      border: 2px solid #0f172a; padding: 10px 12px;
    }
    .carga-header-flex {
      display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    }
    .carga-id { font-size: 14px; font-weight: 800; color: #fbbf24; }
    .carga-desc { font-size: 12px; font-weight: 600; flex: 1; min-width: 0; }
    .carga-rotas { display: inline-flex; gap: 4px; flex-wrap: wrap; }
    .carga-totais {
      display: inline-flex; gap: 14px; align-items: center;
      background: rgba(255,255,255,0.10); padding: 6px 12px; border-radius: 6px;
      font-size: 11px; font-weight: 600;
    }
    .carga-totais-item strong { color: #fbbf24; font-size: 12px; }
    .carga-totais-peso strong { color: #4ade80; }
    .carga-vazia { color: #94a3b8; font-style: italic; }
    .rota-badge {
      display: inline-block; background: #fbbf24; color: #0f172a;
      font-size: 10px; font-weight: 800; padding: 2px 8px; border-radius: 4px;
    }
    .rota-badge-sem { background: #b45309; color: #fffbeb; border: 1px solid #92400e; }
    tr.blk-rota-sem-cad td { background: #7c2d12 !important; color: #fff7ed !important; }
    .exec-sem-cad-list {
      margin: 6px 0 0; padding: 0 0 0 16px; font-size: 10px; line-height: 1.45;
      color: #7c2d12; text-align: left; list-style: disc;
    }
    .exec-sem-cad-list li { margin-bottom: 4px; }
    .sem-cad-endereco { font-size: 10px; color: #475569; }
    tr.row-sem-cad td.col-entrega { background: #fff7ed !important; border-left: 4px solid #ea580c !important; }
    .sem-cad-nf-titulo { font-size: 12px; margin-bottom: 2px; }
    .sem-cad-ponto { font-weight: 600; margin-bottom: 2px; }
    .sem-cad-aviso {
      margin-top: 6px; font-size: 10px; color: #9a3412; line-height: 1.35;
      padding: 6px 8px; background: #ffedd5; border-radius: 4px; border: 1px solid #fdba74;
    }
    tr.blk-rota td {
      background: #334155; color: #f1f5f9; font-size: 11px; font-weight: 600;
      border: 1px solid #334155; padding: 6px 10px;
    }
    .rota-header-flex { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .rota-totais { font-size: 11px; opacity: 0.95; }
    .rota-totais strong { color: #fbbf24; }
    tr.blk-mun td {
      background: #e2e8f0; color: #0f172a; font-size: 11px; font-weight: 700;
      border: 1px solid #cbd5e1; padding: 5px 8px;
    }
    /* Tabela executiva no topo */
    h2.exec-title { font-size: 13px; margin: 14px 0 6px; color: #0f172a; }
    table.exec-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; table-layout: fixed; }
    /* Distribuição das 7 colunas (total = 100%):
       Carga (id) curto · Descrição grande (cabe "Rota X - DD/MM/AAAA" sem quebrar) ·
       Rotas cad. (badges) · 4 numéricas (Pontos/NF-e são valores pequenos, ficam estreitas). */
    col.exec-col-id      { width:  5%; }
    col.exec-col-desc    { width: 20%; }
    col.exec-col-rotas   { width: 12%; }
    col.exec-col-pontos  { width:  6%; }
    col.exec-col-nf      { width:  6%; }
    col.exec-col-valor   { width: 13%; }
    col.exec-col-seco    { width: 12%; }
    col.exec-col-frio    { width: 12%; }
    col.exec-col-peso    { width: 14%; }
    table.exec-table th, table.exec-table td {
      border: 1px solid #cbd5e1; padding: 6px 8px; font-size: 11px; vertical-align: middle;
      word-wrap: break-word; overflow-wrap: anywhere;
    }
    table.exec-table th {
      background: #1e293b; color: #f8fafc; font-weight: 700; font-size: 10px;
      letter-spacing: 0.03em; text-transform: uppercase;
    }
    table.exec-table tbody tr:nth-child(even) td { background: #f8fafc; }
    table.exec-table td.exec-id { font-weight: 800; color: #1e40af; text-align: center; padding: 6px 4px; }
    table.exec-table td.exec-desc { line-height: 1.35; }
    table.exec-table td.exec-rotas { line-height: 1.6; }
    table.exec-table td.num {
      text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap;
      padding-left: 4px; padding-right: 8px;
    }
    table.exec-table th.num { padding-left: 4px; padding-right: 8px; }
    tr.exec-total td {
      background: #fbbf24 !important; color: #0f172a !important;
      font-size: 12px; font-weight: 800; border: 2px solid #d97706 !important;
    }
    tr.hdr-detail-cols th {
      background: #e2e8f0; font-weight: 700; font-size: 9px;
      border-bottom: 2px solid #64748b; line-height: 1.2;
    }
    tr.hdr-detail-cols th.col-entrega { font-size: 10px; text-align: left; }
    tr.hdr-detail-cols th.num { font-size: 9px; }
    tr.row-detail td { font-size: 11px; background: #fff; }
    tr.row-detail:nth-child(even) td { background: #f8fafc; }
    tr.sub-mun td {
      background: #dbeafe !important;
      border-top: 3px solid #2563eb !important;
      border-bottom: 3px solid #2563eb !important;
      font-weight: 700; font-size: 11px; padding: 8px 7px;
    }
    tr.sub-rota-cad td {
      background: #bfdbfe !important;
      border-top: 3px solid #1d4ed8 !important;
      font-weight: 700; font-size: 12px; padding: 9px 7px;
    }
    tr.sub-carga td {
      background: #93c5fd !important;
      border-top: 4px solid #1e40af !important;
      font-weight: 800; font-size: 12px; padding: 10px 7px;
    }
    tr.total-geral td {
      background: #0f172a !important; color: #f8fafc !important;
      font-size: 13px; font-weight: 800;
      border: 3px solid #0f172a !important; padding: 11px 8px;
    }
    tr.total-geral td.col-entrega { white-space: normal; }
    tr.total-geral td.num { color: #f8fafc !important; }
    .sub-tag {
      display: inline-block; background: #1e40af; color: #fff;
      font-size: 9px; font-weight: 800; letter-spacing: 0.04em;
      padding: 2px 6px; border-radius: 3px; margin-right: 6px; vertical-align: middle;
    }
    tr.total-geral .sub-tag { background: #fbbf24; color: #0f172a; }
    .sub-label { font-weight: 700; }
    .sub-val { font-weight: 700; }
    .sub-unit { font-weight: 500; font-size: 10px; opacity: 0.85; }
    .peso-legenda-curta {
      font-size: 10px; color: #475569; margin: 6px 0 14px; line-height: 1.45;
    }
    .peso-legenda {
      margin-top: 16px; padding: 10px 12px;
      border: 1px solid #cbd5e1; border-left: 4px solid #2563eb;
      background: #f8fafc; font-size: 10px; line-height: 1.45; color: #334155;
    }
    .peso-legenda ul { margin: 6px 0 0; padding-left: 18px; }
    .peso-legenda li { margin: 4px 0; }
    .meta-detalhe { margin-top: 10px; font-size: 9px; }
    @media print {
      body { margin: 0; max-width: none; }
      .no-print { display: none; }
      tr.blk-carga, tr.blk-rota, tr.blk-mun, tr.sub-mun, tr.sub-rota-cad, tr.sub-carga, tr.total-geral,
      table.exec-table th, table.exec-table tbody tr td, tr.exec-total td, .rota-badge, .carga-totais {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      table.exec-table { page-break-inside: avoid; }
      tr.blk-carga { page-break-before: auto; page-break-after: avoid; }
    }
  </style>
</head>
<body>
  <h1>Resumo programação de cargas</h1>
  <p class="meta">Gerado em ${esc(dh)} · ${qtdCargas || 0} carga(s) · limite ${limiteCargas || 150} · <strong>Impressão A4 vertical</strong><br />
  Filtros: ${fmtFiltros(filtrosExibir)}</p>
  ${avisoHtml}
  ${execHtml}
  <h2 class="exec-title">Detalhe por carga · rota cad. · município · entrega</h2>
  <table>
    ${TABLE_COLGROUP}
    <tbody>
      ${bodyRows || `<tr><td colspan="${COLS}"><em>Sem dados</em></td></tr>`}
      ${rowSubtotal('TOTAL GERAL', tot, 'total-geral')}
    </tbody>
  </table>
  <div class="peso-legenda">
    <strong>Peso (kg) — como ler este relatório</strong>
    <ul>
      <li><strong>Cálculo:</strong> por linha de item, <code>PESO_KG</code> do cadastro WMS × quantidade (<code>qCom</code> do XML). Se a NF tiver peso de planilha (<code>PESO_RESUMO_KG</code> / PesoNF), usa esse valor no total e rateia Seco/Frio pela composição das linhas. Não usa o peso bruto da NF-e (<code>pesoB</code>).</li>
      <li><strong>Seco / Frio:</strong> mesma classificação dos cards ao abrir a carga (<code>TIPO_ARMAZENAGEM</code> + NCM + descrição). Frio = refrigerado + congelado.</li>
      <li><strong>Resumo executivo e «TOTAL Carga #N»:</strong> soma de todas as NF da carga — igual aos cards <strong>Peso estimado / Seco / Refrig.</strong> ao abrir a carga.</li>
      <li><strong>Imprimir resumo ¹</strong> (romaneio de picking): sem filtro de unidade/destino, o «Total geral (carga)» deve coincidir com o peso deste relatório. Com filtro (ex.: um cliente), o total é só daquele destino — menor que o da carga inteira.</li>
    </ul>
  </div>
  <p class="meta meta-detalhe">Por município: <strong>uma linha por local de entrega</strong> (ENxNome), com soma de NF, valor, seco, frio e peso.</p>
  <script>window.onload = function() { window.print(); };</script>
</body>
</html>`;
}

module.exports = { buildResumoProgramacaoHtml };
