'use strict';

/**
 * WMS — HTML imprimível da Auditoria de Saúde do Estoque.
 *
 * Recebe o objeto produzido por `wms-auditoria-saude.service.js` e renderiza
 * uma página A4 com 5 blocos:
 *   A) SKUs com saldo só de movimento (sem NF encerrada).
 *   B) SKUs com saldo SKU negativo.
 *   C) NF-e abertas há muito tempo (não encerradas).
 *   D) NF-e encerradas com itens da conferência inválidos
 *      (cdProduto vazio OU qtdConvertida zero) — caso típico de NF
 *      "encerrada em branco" como a PIPOCA DOCE.
 *   E) Cadastros duplicados no mesmo dono (mesma chave de código OL, vários CD_PRODUTO).
 *
 * Cada linha "SKU" tem botão de lupa que abre o diagnóstico (mesma
 * estrutura do relatório de Posição). Cada linha "NF" tem link direto
 * para o módulo Recebimento WMS.
 */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtQtd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

function fmtDh(v) {
  if (!v) return '—';
  try {
    return esc(new Date(v).toLocaleString('pt-BR'));
  } catch (e) {
    return esc(String(v));
  }
}

function labelDono(cd, nm) {
  const c = cd != null ? String(cd) : '';
  const n = nm ? String(nm).trim() : '';
  if (c && n) return c + ' — ' + n;
  return n || c || '—';
}

/** A) Tabela de SKUs com saldo só de movimento. */
function tabelaSoMov(linhas) {
  if (!linhas || !linhas.length) {
    return '<p class="ok">Nenhum SKU com saldo só de movimento. <span>(Toda NF encerrada está somando.)</span></p>';
  }
  const rows = linhas
    .map((r) => {
      const btn =
        r.CD_DONO != null && r.CODIGO_PRODUTO
          ? '<button type="button" class="btn-diag btn-diag-alerta" data-cddono="' +
            esc(r.CD_DONO) +
            '" data-codigo="' +
            esc(r.CODIGO_PRODUTO) +
            '" title="Diagnosticar este SKU">🔍</button>'
          : '';
      return (
        '<tr>' +
        '<td>' + esc(labelDono(r.CD_DONO, r.NM_DONO)) + '</td>' +
        '<td>' + esc(r.CODIGO_PRODUTO || '—') + ' ' + btn + '</td>' +
        '<td>' + esc(r.NM_PRODUTO || '—') + '</td>' +
        '<td>' + esc(r.TIPO_ARMAZENAGEM || '—') + '</td>' +
        '<td class="num">' + fmtQtd(r.QTD_ENTRADA_NF_ENCERRADA) + '</td>' +
        '<td class="num">' + fmtQtd(r.QTD_MOVIMENTOS) + '</td>' +
        '<td class="num"><strong>' + fmtQtd(r.QTD_SALDO_SKU) + '</strong></td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table><thead><tr>' +
    '<th>Dono</th><th>Código</th><th>Descrição</th><th>Conservação</th>' +
    '<th class="num">NF enc.</th><th class="num">Mov.</th><th class="num">Saldo</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/** B) Tabela de SKUs com saldo SKU negativo. */
function tabelaNeg(linhas) {
  if (!linhas || !linhas.length) {
    return '<p class="ok">Nenhum SKU com saldo negativo. <span>(Sistema consistente em saídas × entradas.)</span></p>';
  }
  const rows = linhas
    .map((r) => {
      const btn =
        r.CD_DONO != null && r.CODIGO_PRODUTO
          ? '<button type="button" class="btn-diag btn-diag-alerta" data-cddono="' +
            esc(r.CD_DONO) +
            '" data-codigo="' +
            esc(r.CODIGO_PRODUTO) +
            '" title="Diagnosticar este SKU">🔍</button>'
          : '';
      return (
        '<tr>' +
        '<td>' + esc(labelDono(r.CD_DONO, r.NM_DONO)) + '</td>' +
        '<td>' + esc(r.CODIGO_PRODUTO || '—') + ' ' + btn + '</td>' +
        '<td>' + esc(r.NM_PRODUTO || '—') + '</td>' +
        '<td class="num">' + fmtQtd(r.QTD_ENTRADA_NF_ENCERRADA) + '</td>' +
        '<td class="num">' + fmtQtd(r.QTD_MOVIMENTOS) + '</td>' +
        '<td class="num neg"><strong>' + fmtQtd(r.QTD_SALDO_SKU) + '</strong></td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table><thead><tr>' +
    '<th>Dono</th><th>Código</th><th>Descrição</th>' +
    '<th class="num">NF enc.</th><th class="num">Mov.</th><th class="num">Saldo</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/** C) Tabela de NF-e abertas. */
function tabelaAbertas(linhas, diasCorte) {
  if (!linhas || !linhas.length) {
    return (
      '<p class="ok">Nenhuma NF-e aberta há mais de ' +
      diasCorte +
      ' dia(s). <span>(Recebimentos em dia.)</span></p>'
    );
  }
  const rows = linhas
    .map((r) => {
      return (
        '<tr>' +
        '<td>' + esc(labelDono(r.CD_DONO, r.NM_DONO)) + '</td>' +
        '<td>' + esc(r.NU_NF || '—') + ' / ' + esc(r.NU_SERIE || '—') + '</td>' +
        '<td>' + esc(r.ST_RECEBIMENTO || '—') + '</td>' +
        '<td>' + fmtDh(r.DH_RECEBIMENTO) + '</td>' +
        '<td class="num"><strong>' + esc(r.DIAS_ABERTA != null ? String(r.DIAS_ABERTA) : '—') + '</strong></td>' +
        '<td class="num">' + esc(r.QTD_LINHAS_JSON != null ? String(r.QTD_LINHAS_JSON) : '—') + '</td>' +
        '<td class="num">' + esc(r.QTD_LINHAS_CONF != null ? String(r.QTD_LINHAS_CONF) : '—') + '</td>' +
        '<td>#' + esc(r.CD_NFE_ENTRADA) + '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table><thead><tr>' +
    '<th>Dono</th><th>NF / Série</th><th>Status</th><th>Início conf.</th>' +
    '<th class="num">Dias aberta</th><th class="num">Linhas XML</th><th class="num">Linhas conf.</th>' +
    '<th>CD NFE</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/** Agrupa as linhas inválidas por NF para a UI mostrar "NF-e encerrada em
 *  branco" — quando TODOS os itens caíram em SEM_CD_PRODUTO ou QTD_ZERO. */
function agruparConfInvalidasPorNf(linhas) {
  const byNf = new Map();
  (linhas || []).forEach((r) => {
    const k = String(r.CD_NFE_ENTRADA);
    if (!byNf.has(k)) {
      byNf.set(k, {
        CD_NFE_ENTRADA: r.CD_NFE_ENTRADA,
        CD_DONO: r.CD_DONO,
        NM_DONO: r.NM_DONO,
        NU_NF: r.NU_NF,
        NU_SERIE: r.NU_SERIE,
        DH_RECEBIMENTO: r.DH_RECEBIMENTO,
        itensProblema: 0,
        semCdProduto: 0,
        qtdZero: 0,
        amostraItens: [],
      });
    }
    const acc = byNf.get(k);
    acc.itensProblema += 1;
    if (r.diagnostico === 'SEM_CD_PRODUTO') acc.semCdProduto += 1;
    if (r.diagnostico === 'QTD_ZERO') acc.qtdZero += 1;
    if (acc.amostraItens.length < 5) {
      acc.amostraItens.push(r);
    }
  });
  return Array.from(byNf.values()).sort((a, b) => {
    return (b.itensProblema || 0) - (a.itensProblema || 0);
  });
}

/** D) Tabela de NF-e encerradas com conferência inválida (agrupada por NF). */
function tabelaConfInvalidas(linhas) {
  const grupos = agruparConfInvalidasPorNf(linhas);
  if (!grupos.length) {
    return (
      '<p class="ok">Nenhuma NF-e encerrada com itens inválidos. ' +
      '<span>(Toda conferência tem cdProduto e qtdConvertida válidos.)</span></p>'
    );
  }
  const rows = grupos
    .map((g) => {
      const amostra = g.amostraItens
        .map((it) => {
          return (
            '<li><code>' +
            esc(it.codigoProduto || '?') +
            '</code> — ' +
            esc(it.diagnostico || '?') +
            ' (qtdRec=' +
            esc(it.qtdRecebida) +
            ', fator=' +
            esc(it.fatorConversao) +
            ', qtdConv=' +
            esc(it.qtdConvertida) +
            ', cdProd=' +
            esc(it.cdProdutoRaw) +
            ')</li>'
          );
        })
        .join('');
      return (
        '<tr>' +
        '<td>' + esc(labelDono(g.CD_DONO, g.NM_DONO)) + '</td>' +
        '<td>' + esc(g.NU_NF || '—') + ' / ' + esc(g.NU_SERIE || '—') + '</td>' +
        '<td>' + fmtDh(g.DH_RECEBIMENTO) + '</td>' +
        '<td class="num"><strong>' + esc(String(g.itensProblema)) + '</strong></td>' +
        '<td class="num">' + esc(String(g.qtdZero)) + '</td>' +
        '<td class="num">' + esc(String(g.semCdProduto)) + '</td>' +
        '<td>#' + esc(g.CD_NFE_ENTRADA) + '<ul class="amostra">' + amostra + '</ul></td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table><thead><tr>' +
    '<th>Dono</th><th>NF / Série</th><th>Encerrada em</th>' +
    '<th class="num">Itens c/ problema</th>' +
    '<th class="num">Qtd = 0</th>' +
    '<th class="num">Sem cdProduto</th>' +
    '<th>NF + amostra</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/** F) Tabela de reservas OPL órfãs (espelhos cujas cargas já saíram). */
function tabelaReservasOrfas(linhas) {
  if (!linhas || !linhas.length) {
    return '<p class="ok">Nenhuma reserva OPL órfã encontrada. <span>(Trava de cobertura sem reservas duplicadas.)</span></p>';
  }
  const rows = linhas
    .map((r) => {
      return (
        '<tr>' +
        '<td>' + esc(labelDono(r.CD_DONO, r.NM_DONO)) + '</td>' +
        '<td>#' + esc(r.CD_OPL_ARQUIVO) + '</td>' +
        '<td>' + esc(r.NM_ARQUIVO || '—') + '</td>' +
        '<td>' + fmtDh(r.DH_IMPORT) + '</td>' +
        '<td class="num">' + esc(String(r.qtdLinhas || 0)) + '</td>' +
        '<td class="num"><strong>' + fmtQtd(r.qtdTotal) + '</strong></td>' +
        '<td class="num">' + esc(String(r.qtdCargasExpedidas || 0)) + ' / ' + esc(String(r.qtdCargas || 0)) + '</td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<div style="margin-bottom:10px;padding:10px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0;font-size:9.5pt;">' +
    '<strong>O que é "órfã":</strong> espelho OPL cujo picking foi encerrado, mas <strong>todas as cargas vinculadas já foram expedidas</strong>. A reserva deveria ter sido liberada automaticamente. Ela está descontando duas vezes da trava de cobertura. ' +
    'Para limpar com segurança, clique em <strong>"Limpar reservas órfãs"</strong> (botão acima — só apaga as órfãs, deixa as ativas).' +
    '</div>' +
    '<table><thead><tr>' +
    '<th>Dono</th><th>CD espelho</th><th>Arquivo</th><th>Importado em</th>' +
    '<th class="num">Linhas</th><th class="num">Qtd total reservada</th>' +
    '<th class="num">Cargas expedidas / total</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/** E) Tabela de cadastros duplicados (mesma chave de código, vários CD_PRODUTO). */
function tabelaDuplicados(linhas) {
  if (!linhas || !linhas.length) {
    return (
      '<p class="ok">Nenhum cadastro duplicado por código encontrado. <span>' +
      '(Produtos com o mesmo nome e códigos OL diferentes não são duplicata — ex.: variantes Treleso.)</span></p>'
    );
  }
  const rows = linhas
    .map((r) => {
      return (
        '<tr>' +
        '<td>' + esc(labelDono(r.CD_DONO, r.NM_DONO)) + '</td>' +
        '<td><code>' + esc(r.CHAVE_CODIGO || '—') + '</code></td>' +
        '<td>' + esc(r.CD_PRODUTO) + '</td>' +
        '<td>' + esc(r.CODIGO_PRODUTO || '—') + '</td>' +
        '<td>' + esc(r.NM_PRODUTO || '—') + '</td>' +
        '<td>' + esc(r.UNIDADE || '—') + '</td>' +
        '<td class="num"><strong>' + esc(String(r.QTD_DUPLICATAS)) + '</strong></td>' +
        '</tr>'
      );
    })
    .join('');
  return (
    '<table><thead><tr>' +
    '<th>Dono</th><th>Chave código (dígitos)</th>' +
    '<th>CD_PRODUTO</th><th>Código cadastro</th><th>Nome</th><th>UN</th>' +
    '<th class="num">Qtd no grupo</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table>'
  );
}

/**
 * @param {{
 *   geradoEm?: string,
 *   filtroDonoLabel?: string,
 *   dados: {
 *     diasNfAbertaCorte: number,
 *     resumo: { skusSoMovimento: number, skusSaldoNegativo: number, nfsAbertasAntigas: number, itensConferenciaInvalidos: number, cadastrosDuplicados: number },
 *     skusSoMovimento: any[], skusSaldoNegativo: any[],
 *     nfsAbertasAntigas: any[], itensConferenciaInvalidos: any[], cadastrosDuplicados: any[],
 *   }
 * }} payload
 */
function buildAuditoriaSaudeHtml({ geradoEm, filtroDonoLabel, cdDonoFiltro, diasFiltro, dados }) {
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const filtroTxt = esc(filtroDonoLabel || 'Todos os donos do tenant');
  const r = dados && dados.resumo ? dados.resumo : {};
  const diasCorte = dados && dados.diasNfAbertaCorte ? dados.diasNfAbertaCorte : 7;
  /** Evita `</script>` e `<` quebrando o bloco &lt;script&gt; no document.write. */
  const auditMetaJson = JSON.stringify({
    cdDono: cdDonoFiltro != null && cdDonoFiltro !== '' ? String(cdDonoFiltro) : '',
    dias: Number.isFinite(Number(diasFiltro)) && Number(diasFiltro) > 0 ? Number(diasFiltro) : diasCorte,
  }).replace(/</g, '\\u003c');
  const total =
    (r.skusSoMovimento || 0) +
    (r.skusSaldoNegativo || 0) +
    (r.nfsAbertasAntigas || 0) +
    (r.itensConferenciaInvalidos || 0) +
    (r.cadastrosDuplicados || 0) +
    (r.reservasOrfasEspelhos || 0);
  const qtdOrfasEspelhos = r.reservasOrfasEspelhos || 0;
  const btnLimparOrfasHtml =
    qtdOrfasEspelhos > 0
      ? `<button type="button" class="btn-limpar-orfas" id="btnLimparReservasOrfas">🧹 Limpar reservas órfãs (${esc(String(qtdOrfasEspelhos))} espelho(s))</button>`
      : '';
  const blocoOrfasWrapClass = qtdOrfasEspelhos > 0 ? 'h2-orfas-wrap' : 'h2-orfas-wrap h2-orfas-wrap-ok';
  const blocoOrfasH2Class = qtdOrfasEspelhos > 0 ? 'crit' : 'ok';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Auditoria de Saúde do Estoque — WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding-bottom: 56px; }
h1 { font-size: 16pt; margin: 0 0 4px; }
h2 { font-size: 12pt; margin: 18px 0 8px; padding: 6px 10px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
h2.crit { border-left-color: #b91c1c; background: #fee2e2; }
h2.warn { border-left-color: #f59e0b; background: #fef3c7; }
h2.info { border-left-color: #0ea5e9; background: #e0f2fe; }
.meta { font-size: 9.5pt; line-height: 1.45; color: #334155; margin-bottom: 10px; }
.cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; margin: 10px 0 16px; }
.card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; text-align: center; }
.card .lab { font-size: 8.2pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
.card .val { font-size: 18pt; font-weight: 700; color: #0f172a; margin-top: 2px; }
.card.crit .val { color: #b91c1c; }
.card.crit { background: #fee2e2; border-color: #fca5a5; }
.card.warn .val { color: #92400e; }
.card.warn { background: #fef3c7; border-color: #fbbf24; }
.card.ok .val { color: #15803d; }
.card.ok { background: #dcfce7; border-color: #86efac; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; font-size: 9.5pt; }
th { background: #f1f5f9; font-size: 9pt; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.neg { color: #b91c1c; }
.ok { color: #15803d; font-weight: 600; margin: 6px 0 16px; }
.ok span { color: #64748b; font-weight: 400; }
.amostra { margin: 4px 0 0 16px; padding: 0; font-size: 8.5pt; color: #475569; }
.amostra code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 8.5pt; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
.btn-diag { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; margin-left: 4px; border: 1px solid #cbd5e1; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 11pt; vertical-align: middle; line-height: 1; }
.btn-diag:hover { background: #e2e8f0; border-color: #94a3b8; }
.btn-diag-alerta { background: #fef3c7; border-color: #fbbf24; }
.btn-diag-alerta:hover { background: #fde68a; }
.diag-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: none; align-items: center; justify-content: center; z-index: 50; padding: 16px; box-sizing: border-box; }
.diag-overlay[data-open="1"] { display: flex; }
.diag-modal { background: #fff; border-radius: 10px; max-width: 880px; width: 100%; max-height: 92vh; overflow-y: auto; padding: 22px 26px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-family: inherit; font-size: 10.5pt; color: #0f172a; }
.diag-modal h2 { font-size: 16pt; margin: 0 0 6px; padding: 0; background: transparent; border: none; }
.diag-modal h3 { font-size: 11pt; margin: 16px 0 6px; padding: 6px 10px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.diag-modal table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9.5pt; }
.diag-modal th, .diag-modal td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
.diag-modal th { background: #f1f5f9; font-size: 9pt; }
.diag-causa-erro { color: #b91c1c; font-weight: 600; }
.diag-causa-ok { color: #15803d; font-weight: 600; }
.diag-acao { border-left: 4px solid #f59e0b; padding: 8px 12px; background: #fef3c7; margin-bottom: 8px; border-radius: 0 6px 6px 0; }
.diag-acao.ok { border-color: #10b981; background: #d1fae5; }
.diag-acao-codigo { font-size: 9pt; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.4px; }
.diag-acao.ok .diag-acao-codigo { color: #065f46; }
.diag-modal .resumo-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; }
.diag-modal .resumo-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; text-align: center; }
.diag-modal .resumo-card .lab { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
.diag-modal .resumo-card .val { font-size: 14pt; font-weight: 700; color: #0f172a; }
.diag-fechar { float: right; background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; }
.diag-fechar:hover { background: #cbd5e1; }
.h2-orfas-wrap { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 18px 0 8px; padding: 6px 10px; background: #fee2e2; border-left: 4px solid #b91c1c; }
.h2-orfas-wrap-ok { background: #ecfdf5; border-left-color: #10b981; }
.h2-orfas-wrap h2 { margin: 0; padding: 0; background: transparent; border: none; flex: 1 1 auto; min-width: 200px; }
.btn-limpar-orfas { padding: 6px 14px; background: #dc2626; color: #fff; border: none; border-radius: 5px; font-size: 9pt; cursor: pointer; font-weight: 600; flex-shrink: 0; }
.btn-limpar-orfas:disabled { opacity: 0.65; cursor: wait; }
.audit-status { display: none; position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 100002; max-width: 92%; padding: 12px 18px; border-radius: 8px; font-size: 10pt; font-weight: 600; box-shadow: 0 8px 24px rgba(0,0,0,0.18); }
.audit-status[data-show="1"] { display: block; }
.audit-status.ok { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.audit-status.err { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.audit-status.info { background: #e0f2fe; color: #075985; border: 1px solid #7dd3fc; }
.audit-confirm-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: none; align-items: center; justify-content: center; z-index: 100001; padding: 16px; box-sizing: border-box; }
.audit-confirm-overlay[data-open="1"] { display: flex; }
.audit-confirm-box { background: #fff; border-radius: 10px; max-width: 480px; width: 100%; padding: 20px 22px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-size: 10.5pt; }
.audit-confirm-box h3 { margin: 0 0 10px; font-size: 13pt; color: #0f172a; }
.audit-confirm-box p { margin: 0 0 16px; line-height: 1.5; color: #334155; white-space: pre-wrap; }
.audit-confirm-actions { display: flex; gap: 10px; justify-content: flex-end; }
.audit-confirm-actions button { padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; border: none; font-size: 10pt; }
.audit-confirm-cancel { background: #e2e8f0; color: #334155; }
.audit-confirm-ok { background: #dc2626; color: #fff; }
@media print { .toolbar, .btn-diag, .diag-overlay, .audit-status, .audit-confirm-overlay, .btn-limpar-orfas { display: none !important; } body { padding-bottom: 0; } h2 { break-after: avoid; } }
</style>
</head>
<body>
<h1>Auditoria de Saúde do Estoque (WMS)</h1>
<p class="meta">
  <strong>Impresso em:</strong> ${dhBr}<br/>
  <strong>Filtro dono:</strong> ${filtroTxt}<br/>
  <strong>Corte de "NF aberta antiga":</strong> mais de ${esc(String(diasCorte))} dia(s)<br/>
  <strong>Total de alertas encontrados:</strong> <strong>${esc(String(total))}</strong>
</p>

<div class="cards">
  <div class="card ${r.skusSoMovimento ? 'warn' : 'ok'}">
    <div class="lab">SKUs (só mov.)</div>
    <div class="val">${esc(String(r.skusSoMovimento || 0))}</div>
  </div>
  <div class="card ${r.skusSaldoNegativo ? 'crit' : 'ok'}">
    <div class="lab">Saldo negativo</div>
    <div class="val">${esc(String(r.skusSaldoNegativo || 0))}</div>
  </div>
  <div class="card ${r.nfsAbertasAntigas ? 'warn' : 'ok'}">
    <div class="lab">NF-e abertas &gt; ${esc(String(diasCorte))}d</div>
    <div class="val">${esc(String(r.nfsAbertasAntigas || 0))}</div>
  </div>
  <div class="card ${r.itensConferenciaInvalidos ? 'crit' : 'ok'}">
    <div class="lab">Conferência inválida</div>
    <div class="val">${esc(String(r.itensConferenciaInvalidos || 0))}</div>
  </div>
  <div class="card ${r.cadastrosDuplicados ? 'warn' : 'ok'}">
    <div class="lab">Cadastros duplicados</div>
    <div class="val">${esc(String(r.cadastrosDuplicados || 0))}</div>
  </div>
  <div class="card ${r.reservasOrfasEspelhos ? 'crit' : 'ok'}">
    <div class="lab">Reservas OPL órfãs</div>
    <div class="val">${esc(String(r.reservasOrfasEspelhos || 0))}</div>
  </div>
</div>

<h2 class="crit">D) NF-e encerradas com itens da conferência INVÁLIDOS <span style="font-size:9pt;font-weight:400;color:#64748b">(qtdConvertida = 0 ou cdProduto vazio — NF "encerrada em branco")</span></h2>
${tabelaConfInvalidas(dados.itensConferenciaInvalidos)}

<h2 class="warn">A) SKUs com saldo só de movimento <span style="font-size:9pt;font-weight:400;color:#64748b">(posição existe mas NF encerrada NÃO soma — caso PIPOCA DOCE)</span></h2>
${tabelaSoMov(dados.skusSoMovimento)}

<h2 class="crit">B) SKUs com saldo SKU NEGATIVO <span style="font-size:9pt;font-weight:400;color:#64748b">(saiu mais do que entrou)</span></h2>
${tabelaNeg(dados.skusSaldoNegativo)}

<h2 class="warn">C) NF-e abertas há mais de ${esc(String(diasCorte))} dia(s) <span style="font-size:9pt;font-weight:400;color:#64748b">(não somam até encerrar)</span></h2>
${tabelaAbertas(dados.nfsAbertasAntigas, diasCorte)}

<div class="${blocoOrfasWrapClass}" id="blocoReservasOrfas">
  <h2 class="${blocoOrfasH2Class}">F) Reservas OPL órfãs <span style="font-size:9pt;font-weight:400;color:#64748b">(espelhos cujas cargas já saíram mas a reserva ficou pendurada — descontam duas vezes da trava)</span></h2>
  ${btnLimparOrfasHtml}
</div>
<div id="secReservasOrfas">${tabelaReservasOrfas(dados.reservasOrfas)}</div>

<h2 class="info">E) Cadastros duplicados no mesmo dono <span style="font-size:9pt;font-weight:400;color:#64748b">(mesma chave de código OL em mais de um CD_PRODUTO — ex.: 6031021420 e 6.03.10.214.20)</span></h2>
${tabelaDuplicados(dados.cadastrosDuplicados)}

<div id="auditStatus" class="audit-status" role="status" aria-live="polite"></div>

<div class="audit-confirm-overlay" id="auditConfirmOverlay" data-open="0">
  <div class="audit-confirm-box" role="dialog" aria-modal="true" aria-labelledby="auditConfirmTitle">
    <h3 id="auditConfirmTitle">Limpar reservas órfãs</h3>
    <p id="auditConfirmMessage"></p>
    <div class="audit-confirm-actions">
      <button type="button" class="audit-confirm-cancel" id="auditConfirmCancel">Cancelar</button>
      <button type="button" class="audit-confirm-ok" id="auditConfirmOk">Limpar reservas órfãs</button>
    </div>
  </div>
</div>

<div class="toolbar">
  <button type="button" id="wmsPrintBtn">Imprimir / PDF</button>
  <button type="button" id="wmsCloseBtn">Fechar</button>
</div>

<div class="diag-overlay" id="diagOverlay">
  <div class="diag-modal">
    <button type="button" class="diag-fechar" id="diagClose">Fechar ✕</button>
    <h2 id="diagTitulo">Diagnóstico do SKU</h2>
    <div id="diagConteudo">Carregando…</div>
  </div>
</div>

<script>
(function () {
  var AUDIT_META = ${auditMetaJson};

  function authHeaders() {
    var h = {};
    var token = localStorage.getItem('token');
    if (token) h.Authorization = 'Bearer ' + token;
    try {
      var u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u && (u.login || u.SGUSUARIO)) h['user-login'] = u.login || u.SGUSUARIO;
    } catch (e) {}
    var loginAlt = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (loginAlt && !h['user-login']) h['user-login'] = loginAlt;
    if (!h['user-login']) {
      try {
        if (window.opener && window.opener.localStorage) {
          var t2 = window.opener.localStorage.getItem('token');
          if (t2 && !h.Authorization) h.Authorization = 'Bearer ' + t2;
          var u2 = JSON.parse(window.opener.localStorage.getItem('user') || '{}');
          if (u2 && (u2.login || u2.SGUSUARIO)) h['user-login'] = u2.login || u2.SGUSUARIO;
        }
      } catch (e2) {}
    }
    return h;
  }

  function apiUrl(path) {
    if (!path) return path;
    try {
      if (window.opener && typeof window.opener.corrigirUrl === 'function') {
        return window.opener.corrigirUrl(path);
      }
    } catch (e) {}
    if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) return path;
    var clean = path.charAt(0) === '/' ? path : '/' + path;
    if (clean.indexOf('/api/') === 0) {
      try {
        var pn = (window.opener && window.opener.location && window.opener.location.pathname) || '';
        if (pn.indexOf('/cargas') !== -1) {
          return window.opener.location.origin + '/cargas' + clean;
        }
      } catch (e2) {}
      return window.location.origin + clean;
    }
    return clean;
  }

  function auditQueryString() {
    var qs = [];
    if (AUDIT_META && AUDIT_META.cdDono) qs.push('cdDono=' + encodeURIComponent(AUDIT_META.cdDono));
    if (AUDIT_META && AUDIT_META.dias) qs.push('dias=' + encodeURIComponent(String(AUDIT_META.dias)));
    return qs.length ? '?' + qs.join('&') : '';
  }

  function notifyDashboard(msg, tipo) {
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.showMessage === 'function') {
        window.opener.showMessage(msg, tipo || 'info');
      }
    } catch (e) {}
  }

  function showAuditStatus(msg, tipo) {
    var el = document.getElementById('auditStatus');
    if (el) {
      el.textContent = msg || '';
      el.className = 'audit-status ' + (tipo || 'info');
      el.setAttribute('data-show', msg ? '1' : '0');
      if (msg) {
        clearTimeout(showAuditStatus._t);
        showAuditStatus._t = setTimeout(function () {
          el.setAttribute('data-show', '0');
        }, tipo === 'err' ? 12000 : 8000);
      }
    }
    if (msg) notifyDashboard(msg, tipo);
    try { window.focus(); } catch (e2) {}
  }

  /** Confirmação SEMPRE nesta janela (nunca no dashboard atrás do popup). */
  function confirmLimparOrfas(msg) {
    return new Promise(function (resolve) {
      var ov = document.getElementById('auditConfirmOverlay');
      var msgEl = document.getElementById('auditConfirmMessage');
      var okBtn = document.getElementById('auditConfirmOk');
      var cancelBtn = document.getElementById('auditConfirmCancel');
      if (!ov || !msgEl || !okBtn || !cancelBtn) {
        resolve(window.confirm(msg));
        return;
      }
      try { window.focus(); } catch (e0) {}
      msgEl.textContent = msg;
      ov.setAttribute('data-open', '1');
      function fechar(ok) {
        ov.setAttribute('data-open', '0');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        ov.removeEventListener('click', onBackdrop);
        document.removeEventListener('keydown', onKey);
        resolve(ok);
      }
      function onOk() { fechar(true); }
      function onCancel() { fechar(false); }
      function onBackdrop(ev) { if (ev.target === ov) fechar(false); }
      function onKey(ev) {
        if (ev.key === 'Escape') fechar(false);
      }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      ov.addEventListener('click', onBackdrop);
      document.addEventListener('keydown', onKey);
    });
  }

  /** POST na janela do dashboard (opener) para não abortar se o operador fechar o relatório. */
  function postLimparOrfas() {
    var basePath = '/api/wms/reservas-opl/limpar-orfas';
    var qs = auditQueryString();
    var headers = authHeaders();
    headers['Content-Type'] = 'application/json';
    var opts = { method: 'POST', headers: headers, body: '{}' };
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.fetch === 'function') {
        var urlOpener =
          typeof window.opener.corrigirUrl === 'function'
            ? window.opener.corrigirUrl(basePath) + qs
            : window.opener.location.origin + basePath + qs;
        return window.opener.fetch(urlOpener, opts);
      }
    } catch (e) {}
    return fetch(apiUrl(basePath) + qs, opts);
  }

  function fetchAuditoriaHtml() {
    var basePath = '/api/wms/auditoria-saude.html';
    var qs = auditQueryString();
    var headers = authHeaders();
    try {
      if (window.opener && !window.opener.closed && typeof window.opener.fetch === 'function') {
        var urlOpener =
          typeof window.opener.corrigirUrl === 'function'
            ? window.opener.corrigirUrl(basePath) + qs
            : window.opener.location.origin + basePath + qs;
        return window.opener.fetch(urlOpener, { headers: headers });
      }
    } catch (e) {}
    return fetch(apiUrl(basePath) + qs, { headers: headers });
  }

  function regerarAuditoria() {
    showAuditStatus('Atualizando relatório…', 'info');
    return fetchAuditoriaHtml()
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error(t || r.statusText || 'Falha ao regerar');
          });
        }
        return r.text();
      })
      .then(function (html) {
        document.open();
        document.write(html);
        document.close();
      })
      .catch(function (e) {
        showAuditStatus('Relatório desatualizado — regenere em Relatórios WMS. (' + String(e.message || e) + ')', 'err');
      });
  }
  function esc(s) {
    if (s == null) return '—';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtQ(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  }
  function fmtDh(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR'); } catch (e) { return String(v); }
  }
  function classeCausa(code) { return code === 'OK' ? 'diag-causa-ok' : 'diag-causa-erro'; }

  function renderResumo(d) {
    var html = '';
    html += '<div style="font-size:10pt; color:#475569; margin-bottom:8px;">';
    html += 'Dono: <strong>' + esc(d.cdDono + ' — ' + (d.nmDono || '?')) + '</strong>';
    html += ' · Código: <strong>' + esc(d.codigoConsultado) + '</strong>';
    if (d.cadastro) html += ' (CD_PRODUTO ' + esc(d.cadastro.CD_PRODUTO) + ' — ' + esc(d.cadastro.NOME) + ')';
    html += '</div>';
    if (d.causas && d.causas.length) {
      html += '<div style="margin-bottom:8px;"><strong>Causas detectadas:</strong> ';
      html += d.causas.map(function (c) { return '<span class="diag-causa-erro">' + esc(c) + '</span>'; }).join(', ');
      html += '</div>';
    }
    if (d.resumo) {
      html += '<div class="resumo-cards">' +
        '<div class="resumo-card"><div class="lab">NF encerrada</div><div class="val">' + fmtQ(d.resumo.qtdEntradaNfEncerrada) + '</div></div>' +
        '<div class="resumo-card"><div class="lab">Movimentos (ledger)</div><div class="val">' + fmtQ(d.resumo.qtdMovimentos) + '</div></div>' +
        '<div class="resumo-card"><div class="lab">Saldo SKU</div><div class="val">' + fmtQ(d.resumo.qtdSaldoSku) + '</div></div>' +
      '</div>';
    }
    return html;
  }
  function renderAcoes(acoes) {
    if (!acoes || !acoes.length) return '';
    var html = '<h3>Ações sugeridas</h3>';
    acoes.forEach(function (a) {
      var cls = a.codigo === 'NADA_A_FAZER' ? 'ok' : '';
      html += '<div class="diag-acao ' + cls + '">';
      html += '<div class="diag-acao-codigo">' + esc(a.codigo) + '</div>';
      html += '<div>' + esc(a.texto) + '</div>';
      html += '</div>';
    });
    return html;
  }
  function renderNfs(titulo, nfs) {
    if (!nfs || !nfs.length) return '';
    var html = '<h3>' + esc(titulo) + ' (' + nfs.length + ')</h3><table><thead><tr>' +
      '<th>NF</th><th>Série</th><th>Status</th><th>Recebido em</th><th class="num">Linhas XML</th><th class="num">Linhas conf.</th>' +
      '</tr></thead><tbody>';
    nfs.forEach(function (n) {
      html += '<tr><td>' + esc(n.NU_NF) + '</td><td>' + esc(n.NU_SERIE) + '</td>' +
        '<td>' + esc(n.ST_RECEBIMENTO) + '</td><td>' + fmtDh(n.DH_RECEBIMENTO) + '</td>' +
        '<td class="num">' + esc(n.qtd_linhas_nfe) + '</td><td class="num">' + esc(n.qtd_linhas_conf) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  function renderConferencia(conferencias) {
    if (!conferencias || !conferencias.length) return '';
    var html = '<h3>Linhas da conferência (' + conferencias.length + ')</h3><table><thead><tr>' +
      '<th>NF</th><th>nItem</th><th>codigoProduto</th><th>cdProduto</th>' +
      '<th class="num">qtdRec</th><th class="num">fator</th><th class="num">qtdConv</th>' +
      '<th>Diagnóstico</th></tr></thead><tbody>';
    conferencias.forEach(function (c) {
      var d = c.diagnostico || {};
      html += '<tr><td>' + esc(c.NU_NF) + '</td><td>' + esc(c.nItem) + '</td>' +
        '<td>' + esc(c.codigoProduto) + '</td><td>' + esc(c.cdProdutoRaw) + '</td>' +
        '<td class="num">' + fmtQ(c.qtdRecebida) + '</td><td class="num">' + fmtQ(c.fatorConversao) + '</td>' +
        '<td class="num">' + fmtQ(c.qtdConvertida) + '</td>' +
        '<td class="' + classeCausa(d.code) + '">' + esc(d.code) + ' — ' + esc(d.txt) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  function renderMovimentos(mv) {
    if (!mv || !mv.length) return '';
    var html = '<h3>Movimentos (' + mv.length + ', mais recentes primeiro)</h3><table><thead><tr>' +
      '<th>CD_MOVIMENTO</th><th>Data</th><th>Tipo</th><th class="num">Qtd</th>' +
      '<th>Ref. carga</th><th>Ref. OPL</th><th>User</th></tr></thead><tbody>';
    mv.forEach(function (m) {
      html += '<tr><td>' + esc(m.CD_MOVIMENTO) + '</td><td>' + fmtDh(m.DH_REGISTRO) + '</td>' +
        '<td>' + esc(m.TP_MOVIMENTO) + '</td><td class="num">' + fmtQ(m.QTD) + '</td>' +
        '<td>' + esc(m.REF_CD_CARGA) + '</td><td>' + esc(m.REF_CD_OPL_ARQUIVO) + '</td>' +
        '<td>' + esc(m.SG_USER) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }
  function renderNfsAmpliadas(d) {
    var html = '';
    if (d.nfsOutrosDonos && d.nfsOutrosDonos.length) {
      html += '<h3>NF-e em OUTROS donos do mesmo tenant (' + d.nfsOutrosDonos.length + ')</h3><table><thead><tr>' +
        '<th>Dono</th><th>NF</th><th>Série</th><th>Status</th><th>Receb. em</th>' +
        '</tr></thead><tbody>';
      d.nfsOutrosDonos.forEach(function (n) {
        html += '<tr><td>' + esc(n.CD_DONO + ' — ' + (n.NM_DONO || '?')) + '</td>' +
          '<td>' + esc(n.NU_NF) + '</td><td>' + esc(n.NU_SERIE) + '</td>' +
          '<td>' + esc(n.ST_RECEBIMENTO) + '</td><td>' + fmtDh(n.DH_RECEBIMENTO) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if (d.nfsPorNome && d.nfsPorNome.length) {
      var kws = (d.palavrasChaveUsadas || []).join(' + ');
      html += '<h3>NF-e do dono com NOME parecido mas sem o código <span style="font-size:9pt;color:#64748b">(palavras-chave: ' + esc(kws) + ')</span></h3><table><thead><tr>' +
        '<th>NF</th><th>Série</th><th>Status</th><th>Receb. em</th>' +
        '</tr></thead><tbody>';
      d.nfsPorNome.forEach(function (n) {
        html += '<tr><td>' + esc(n.NU_NF) + '</td><td>' + esc(n.NU_SERIE) + '</td>' +
          '<td>' + esc(n.ST_RECEBIMENTO) + '</td><td>' + fmtDh(n.DH_RECEBIMENTO) + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    return html;
  }
  function renderReservasOpl(rsv) {
    if (!rsv || !rsv.reservas || !rsv.reservas.length) return '';
    var totalOrfa = (rsv.totais && rsv.totais.totalOrfas) || 0;
    var totalAtiva = (rsv.totais && rsv.totais.totalAtivas) || 0;
    var titulo = totalOrfa > 0
      ? 'Reservas OPL — ' + rsv.reservas.filter(function (r) { return r.classificacao === "ORFA"; }).length + ' ESPELHO(S) ÓRFÃO(S)'
      : 'Reservas OPL (ativas, sem órfãs)';
    var rows = rsv.reservas.map(function (r) {
      var cls = r.classificacao === 'ORFA' ? 'diag-causa-erro' : '';
      return '<tr>' +
        '<td>#' + esc(r.CD_OPL_ARQUIVO) + '</td>' +
        '<td>' + esc(r.NM_ARQUIVO || '—') + '</td>' +
        '<td>' + fmtDh(r.DH_IMPORT) + '</td>' +
        '<td class="num">' + fmtQ(r.QTD_RESERVADA) + '</td>' +
        '<td class="num">' + esc(r.qtdCargasExpedidas || 0) + ' / ' + esc(r.qtdCargas || 0) + '</td>' +
        '<td class="' + cls + '"><strong>' + esc(r.classificacao) + '</strong></td>' +
        '</tr>';
    }).join('');
    return '<h3>' + esc(titulo) + '</h3>' +
      '<p style="font-size:9.5pt; color:#475569; margin:0 0 6px;">Total ativo: <strong>' + fmtQ(totalAtiva) + '</strong> · Total órfão: <strong style="color:#dc2626">' + fmtQ(totalOrfa) + '</strong></p>' +
      '<table><thead><tr><th>CD espelho</th><th>Arquivo</th><th>Importado em</th><th class="num">Qtd</th><th class="num">Expedidas / Total</th><th>Classificação</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderCadastrosDuplicados(d) {
    if (!d.cadastrosDuplicados || !d.cadastrosDuplicados.length) return '';
    var html = '<h3>Cadastros DUPLICADOS (mesma chave de código) — ' + d.cadastrosDuplicados.length + ' linha(s)</h3><table><thead><tr>' +
      '<th>CD_PRODUTO</th><th>Código</th><th>Nome</th><th>UN</th><th>Ativo</th>' +
      '</tr></thead><tbody>';
    d.cadastrosDuplicados.forEach(function (p) {
      html += '<tr><td>' + esc(p.CD_PRODUTO != null ? p.CD_PRODUTO : p.cd_produto) + '</td><td>' + esc(p.CODIGO || p.codigo) + '</td>' +
        '<td>' + esc(p.NOME || p.nome) + '</td><td>' + esc(p.UNIDADE || p.unidade) + '</td>' +
        '<td>' + esc(p.FGACTIVE || p.fgactive) + '</td></tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function abrirDiagnostico(cdDono, codigo) {
    var overlay = document.getElementById('diagOverlay');
    var conteudo = document.getElementById('diagConteudo');
    overlay.setAttribute('data-open', '1');
    conteudo.innerHTML = 'Carregando diagnóstico…';
    var url = apiUrl('/api/wms/diagnostico-sku?cdDono=' + encodeURIComponent(cdDono) + '&codigo=' + encodeURIComponent(codigo));
    fetch(url, { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { conteudo.innerHTML = '<p style="color:#b91c1c;">Erro: ' + esc(res.j && res.j.error || 'Falha ao consultar.') + '</p>'; return; }
        var d = res.j;
        var html = renderResumo(d);
        html += renderAcoes(d.acoes);
        html += renderNfs('NF-e abertas mencionando o código', d.nfsAbertas);
        html += renderNfs('NF-e encerradas mencionando o código', d.nfsEncerradas);
        html += renderConferencia(d.conferencias);
        html += renderNfsAmpliadas(d);
        html += renderCadastrosDuplicados(d);
        html += renderReservasOpl(d.reservasOpl);
        html += renderMovimentos(d.movimentos);
        conteudo.innerHTML = html;
      })
      .catch(function (e) { conteudo.innerHTML = '<p style="color:#b91c1c;">Erro de rede: ' + esc(String(e)) + '</p>'; });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('.btn-diag');
    if (btn) {
      var cdDono = btn.getAttribute('data-cddono');
      var codigo = btn.getAttribute('data-codigo');
      if (cdDono && codigo) abrirDiagnostico(cdDono, codigo);
    }
  });
  var diagClose = document.getElementById('diagClose');
  var diagOverlay = document.getElementById('diagOverlay');
  if (diagClose && diagOverlay) {
    diagClose.addEventListener('click', function () { diagOverlay.setAttribute('data-open', '0'); });
    diagOverlay.addEventListener('click', function (ev) {
      if (ev.target === diagOverlay) diagOverlay.setAttribute('data-open', '0');
    });
  }
  var wmsPrintBtn = document.getElementById('wmsPrintBtn');
  if (wmsPrintBtn) wmsPrintBtn.addEventListener('click', function () { window.print(); });
  var wmsCloseBtn = document.getElementById('wmsCloseBtn');
  if (wmsCloseBtn) wmsCloseBtn.addEventListener('click', function () { window.close(); });

  /** Limpa reservas OPL órfãs (só as cujo espelho tem TODAS as cargas expedidas). */
  var btnLimp = document.getElementById('btnLimparReservasOrfas');
  if (btnLimp) {
    btnLimp.addEventListener('click', function () {
      var msgConfirm =
        'Vai liberar TODAS as reservas órfãs listadas neste relatório (espelhos cujas cargas já foram expedidas).\\n\\n' +
        'Esta operação é segura: deixa as reservas legítimas em paz.\\n\\n' +
        'Continuar?';
      confirmLimparOrfas(msgConfirm).then(function (ok) {
        if (!ok) return;
        if (!authHeaders()['user-login']) {
          showAuditStatus('Sessão sem usuário — gere a auditoria de novo pelo dashboard (login expirado).', 'err');
          return;
        }
        btnLimp.disabled = true;
        var txtOrig = btnLimp.textContent;
        btnLimp.textContent = 'Limpando…';
        showAuditStatus('Limpando reservas órfãs… aguarde.', 'info');
        postLimparOrfas()
          .then(function (r) {
            return r.text().then(function (t) {
              var j = {};
              try { j = t ? JSON.parse(t) : {}; } catch (e) {}
              return { ok: r.ok, j: j, status: r.status };
            });
          })
          .then(function (res) {
            if (!res.ok) {
              showAuditStatus('Erro: ' + (res.j && res.j.error || 'falha ao limpar (HTTP ' + res.status + ').'), 'err');
              return;
            }
            var lib = res.j.liberadas || 0;
            var esp = res.j.espelhos || 0;
            if (lib === 0) {
              showAuditStatus('Nenhuma reserva órfã encontrada para limpar (já estava limpo ou critério mudou).', 'info');
              return regerarAuditoria();
            }
            showAuditStatus('Limpeza concluída: ' + lib + ' reserva(s), ' + esp + ' espelho(s). Atualizando…', 'ok');
            return regerarAuditoria();
          })
          .catch(function (e) {
            showAuditStatus('Erro de rede: ' + String(e.message || e), 'err');
          })
          .finally(function () {
            btnLimp.disabled = false;
            btnLimp.textContent = txtOrig;
          });
      });
    });
  }
})();
</script>
</body>
</html>`;
}

module.exports = { buildAuditoriaSaudeHtml };
