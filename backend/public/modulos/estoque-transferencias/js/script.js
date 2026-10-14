(function () {
  'use strict';

  /** ---------- helpers compartilhados (mesmo padrão de outros módulos) ---------- */

  function getAuthHeaders(extra) {
    var headers = Object.assign({}, extra || {});
    var token = localStorage.getItem('token');
    if (token) headers.Authorization = 'Bearer ' + token;
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    var loginAlt = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (loginAlt && !headers['user-login']) headers['user-login'] = loginAlt;
    return headers;
  }

  function api(path, opts) {
    opts = opts || {};
    var headers = getAuthHeaders(opts.headers || {});
    if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    var url = typeof window.corrigirUrl === 'function' ? window.corrigirUrl(path) : path;
    return fetch(url, Object.assign({}, opts, { headers: headers }));
  }

  function showMessage(text, tipo) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, tipo || 'success', document.getElementById('message'));
      return;
    }
    var el = document.getElementById('message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (tipo || '');
    el.style.display = text ? 'block' : 'none';
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtQtd(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (Math.abs(n - Math.round(n)) < 1e-9) return Math.round(n).toLocaleString('pt-BR');
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  }

  function fmtDh(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR'); } catch (_) { return String(v); }
  }

  function fmtData(v) {
    if (v == null || v === '') return '—';
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      var d = String(v.getUTCDate()).padStart(2, '0');
      var m = String(v.getUTCMonth() + 1).padStart(2, '0');
      return d + '/' + m + '/' + v.getUTCFullYear();
    }
    var s = String(v).trim();
    var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[3] + '/' + iso[2] + '/' + iso[1];
    var parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      return (
        String(parsed.getUTCDate()).padStart(2, '0') +
        '/' +
        String(parsed.getUTCMonth() + 1).padStart(2, '0') +
        '/' +
        parsed.getUTCFullYear()
      );
    }
    return s;
  }

  /** Overlay (mesmo padrão Cidades, com double-RAF para o navegador pintar antes do fetch). */
  function showLoadingOverlay(titulo, desc, detalhe) {
    var ov = document.getElementById('loadingOverlay');
    document.getElementById('loadingTitulo').textContent = titulo || 'Carregando…';
    document.getElementById('loadingDesc').textContent = desc || '';
    document.getElementById('loadingDetalhe').textContent = detalhe || '';
    ov.style.display = 'flex';
  }
  function hideLoadingOverlay() {
    var ov = document.getElementById('loadingOverlay');
    ov.style.display = 'none';
  }
  function yieldRender() {
    return new Promise(function (r) {
      requestAnimationFrame(function () { requestAnimationFrame(r); });
    });
  }

  /** ---------- estado e dados ---------- */

  var donosCache = [];
  /** Filtro de status fica do lado cliente: a API só conhece dono/data/limite.
   *  Para evitar duplicar a query no backend, filtramos a lista em memória.
   *  Limite pode ser ajustado se virar problema de volume. */
  var listaAtual = [];

  async function carregarDonos() {
    try {
      var r = await api('/api/wms/donos-estoque');
      if (!r.ok) throw new Error('Falha ao carregar donos.');
      donosCache = await r.json();
      preencherSelectDonos(document.getElementById('filtroDono'), true);
      preencherSelectDonos(document.getElementById('ntDonoOrigem'), false);
      preencherSelectDonos(document.getElementById('ntDonoDestino'), false);
    } catch (e) {
      console.error('[transf] carregarDonos:', e);
    }
  }

  function preencherSelectDonos(sel, incluirTodos) {
    if (!sel) return;
    var html = incluirTodos
      ? '<option value="">Todos</option>'
      : '<option value="">— Selecione —</option>';
    donosCache.forEach(function (d) {
      html += '<option value="' + esc(d.CD_DONO) + '">' +
              esc(d.CD_DONO + ' — ' + (d.NOME || d.CODIGO || '')) +
              '</option>';
    });
    sel.innerHTML = html;
  }

  async function carregarLista() {
    var cdDono = document.getElementById('filtroDono').value;
    var dataInicio = document.getElementById('filtroDataInicio').value;
    var dataFim = document.getElementById('filtroDataFim').value;
    var limite = document.getElementById('filtroLimite').value;

    var qs = [];
    if (cdDono) qs.push('cdDono=' + encodeURIComponent(cdDono));
    if (dataInicio) qs.push('dataInicio=' + encodeURIComponent(dataInicio));
    if (dataFim) qs.push('dataFim=' + encodeURIComponent(dataFim));
    if (limite) qs.push('limite=' + encodeURIComponent(limite));

    showLoadingOverlay('Carregando transferências…', 'Buscando documentos.', qs.join(' · ') || 'Sem filtros');
    await yieldRender();
    try {
      var r = await api('/api/wms/transferencias' + (qs.length ? '?' + qs.join('&') : ''));
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      listaAtual = data.itens || [];
      renderLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao carregar transferências.', 'error');
      listaAtual = [];
      renderLista();
    } finally {
      hideLoadingOverlay();
    }
  }

  function renderLista() {
    var wrapper = document.getElementById('listaWrapper');
    var statusFiltro = document.getElementById('filtroStatus').value;
    var filtradas = statusFiltro
      ? listaAtual.filter(function (t) { return String(t.ST_TRANSFERENCIA).toUpperCase() === statusFiltro; })
      : listaAtual;

    var meta = document.getElementById('listaMeta');
    meta.innerHTML =
      '<strong>' + filtradas.length + '</strong> transferência(s) ' +
      (statusFiltro ? '(' + statusFiltro.toLowerCase() + ')' : '') +
      ' · total bruto: ' + listaAtual.length;

    if (!filtradas.length) {
      wrapper.innerHTML =
        '<div class="vazio-msg"><i class="bx bx-package"></i>' +
        'Nenhuma transferência encontrada com os filtros atuais.' +
        '</div>';
      return;
    }

    var rows = filtradas.map(function (t) {
      var cancelada = String(t.ST_TRANSFERENCIA).toUpperCase() === 'CANCELADA';
      var badge = cancelada
        ? '<span class="badge badge-cancel">CANCELADA</span>'
        : '<span class="badge badge-ok">EFETIVADA</span>';
      var origemTxt = esc(t.CD_DONO_ORIGEM + ' — ' + (t.NM_DONO_ORIGEM || '?'));
      var destinoTxt = esc(t.CD_DONO_DESTINO + ' — ' + (t.NM_DONO_DESTINO || '?'));
      var skuTxt = esc(t.CODIGO_PRODUTO) +
        (t.NM_PRODUTO_SNAPSHOT ? '<br/><small style="color:#64748b">' + esc(t.NM_PRODUTO_SNAPSHOT) + '</small>' : '');
      var loteVal = (t.LOTE || t.VALIDADE)
        ? '<br/><small style="color:#64748b">Lote: ' + esc(t.LOTE || '—') + ' · Val.: ' + esc(fmtData(t.VALIDADE)) + '</small>'
        : '';
      var motivo = t.MOTIVO ? '<br/><small style="color:#64748b" title="' + esc(t.MOTIVO) + '">' +
                              esc(t.MOTIVO.length > 60 ? t.MOTIVO.slice(0, 57) + '…' : t.MOTIVO) +
                              '</small>' : '';

      var btnCancel = cancelada
        ? '<button type="button" class="btn-acao" disabled title="Já cancelada"><i class="bx bx-undo"></i></button>'
        : '<button type="button" class="btn-acao btn-acao-cancel" data-acao="cancelar" data-cd="' + esc(t.CD_TRANSFERENCIA) +
          '" title="Cancelar com estorno"><i class="bx bx-undo"></i></button>';

      return '<tr>' +
        '<td><strong>#' + esc(t.CD_TRANSFERENCIA) + '</strong><br/><small style="color:#64748b">' + esc(fmtDh(t.DH_REGISTRO)) + '</small></td>' +
        '<td>' + origemTxt + '<br/><small style="color:#64748b">→ ' + destinoTxt + '</small>' + motivo + '</td>' +
        '<td>' + skuTxt + loteVal + '</td>' +
        '<td class="num"><strong>' + fmtQtd(t.QTD) + '</strong></td>' +
        '<td>' + badge + (cancelada && t.DH_CANCELAMENTO ? '<br/><small style="color:#64748b">' + esc(fmtDh(t.DH_CANCELAMENTO)) + '</small>' : '') + '</td>' +
        '<td><div class="acoes-celula">' +
          '<button type="button" class="btn-acao" data-acao="comprovante" data-cd="' + esc(t.CD_TRANSFERENCIA) +
          '" title="Comprovante imprimível"><i class="bx bx-printer"></i></button>' +
          btnCancel +
        '</div></td>' +
        '</tr>';
    }).join('');

    wrapper.innerHTML =
      '<table class="wms-transf-tabela">' +
      '<thead><tr>' +
        '<th>#</th>' +
        '<th>Origem → Destino</th>' +
        '<th>Produto</th>' +
        '<th class="num">Qtd</th>' +
        '<th>Status</th>' +
        '<th>Ações</th>' +
      '</tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
      '</table>';
  }

  /** ---------- ações na linha ---------- */

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-acao]');
    if (!btn) return;
    var acao = btn.getAttribute('data-acao');
    var cd = parseInt(btn.getAttribute('data-cd'), 10);
    if (!Number.isFinite(cd)) return;
    if (acao === 'comprovante') abrirComprovante(cd);
    else if (acao === 'cancelar') abrirModalCancelar(cd);
  });

  function abrirComprovante(cd) {
    var url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/wms/transferencias/' + cd + '/comprovante.html') :
               '/api/wms/transferencias/' + cd + '/comprovante.html');
    /** Como o backend exige header `user-login`, abrir direto via window.open
     *  perderia auth. Usamos fetch para baixar o HTML e abrimos um blob. */
    (async function () {
      try {
        showLoadingOverlay('Gerando comprovante…', 'Aguarde.');
        await yieldRender();
        var r = await api('/api/wms/transferencias/' + cd + '/comprovante.html');
        var txt = await r.text();
        if (!r.ok) throw new Error(txt || 'Falha ao gerar comprovante.');
        var blob = new Blob([txt], { type: 'text/html;charset=utf-8' });
        var blobUrl = URL.createObjectURL(blob);
        var w = window.open(blobUrl, '_blank');
        if (!w) showMessage('Bloqueio de popup — autorize para ver o comprovante.', 'error');
      } catch (e) {
        showMessage(e.message || 'Erro ao abrir comprovante.', 'error');
      } finally {
        hideLoadingOverlay();
      }
    })();
  }

  /** ---------- modal cancelar ---------- */

  var cancelCdAtual = null;

  async function abrirModalCancelar(cd) {
    cancelCdAtual = cd;
    var detalheBox = document.getElementById('cancelDetalhe');
    detalheBox.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Carregando…';
    document.getElementById('cancelMotivo').value = '';
    document.getElementById('cancelNegativar').checked = false;
    document.getElementById('modalCancelTransf').hidden = false;

    try {
      var r = await api('/api/wms/transferencias/' + cd);
      var t = await r.json();
      if (!r.ok) throw new Error(t.error || 'Erro ao obter transferência.');
      var nmOrig = esc(t.NM_DONO_ORIGEM || '?');
      var nmDest = esc(t.NM_DONO_DESTINO || '?');
      detalheBox.innerHTML =
        '<div class="transf-cancel-detalhe-grid">' +
        '<div class="transf-cancel-detalhe-item"><span class="lab">Transferência</span><span class="val">#' +
        esc(t.CD_TRANSFERENCIA) +
        '</span></div>' +
        '<div class="transf-cancel-detalhe-item"><span class="lab">Registrada em</span><span class="val">' +
        esc(fmtDh(t.DH_REGISTRO)) +
        '</span></div>' +
        '<div class="transf-cancel-detalhe-item"><span class="lab">Origem (recebe o estorno)</span><span class="val">' +
        esc(t.CD_DONO_ORIGEM + ' — ' + nmOrig) +
        '</span></div>' +
        '<div class="transf-cancel-detalhe-item"><span class="lab">Destino (perde o saldo)</span><span class="val">' +
        esc(t.CD_DONO_DESTINO + ' — ' + nmDest) +
        '</span></div>' +
        '<div class="transf-cancel-detalhe-item transf-cancel-detalhe-item--full"><span class="lab">Produto</span><span class="val">' +
        esc(t.CODIGO_PRODUTO + ' — ' + (t.NM_PRODUTO_SNAPSHOT || '?')) +
        '</span></div>' +
        '<div class="transf-cancel-detalhe-item"><span class="lab">Quantidade estornada</span><span class="val val--qtd">+' +
        fmtQtd(t.QTD) +
        ' → origem</span></div>' +
        '</div>';
      var alerta = document.getElementById('cancelAlertaEstorno');
      if (alerta) {
        alerta.querySelector('div').innerHTML =
          '<strong>Sim — ' +
          fmtQtd(t.QTD) +
          ' voltam para ' +
          nmOrig +
          '.</strong> O estorno gera entrada na origem e saída no destino. Informe o motivo abaixo.';
      }
    } catch (e) {
      detalheBox.innerHTML = '<span style="color:#b91c1c">' + esc(e.message || 'Erro.') + '</span>';
    }
  }

  document.getElementById('btnCancelarVoltar').addEventListener('click', function () {
    document.getElementById('modalCancelTransf').hidden = true;
    cancelCdAtual = null;
  });

  document.getElementById('btnCancelarConfirmar').addEventListener('click', async function () {
    if (!cancelCdAtual) return;
    var motivo = String(document.getElementById('cancelMotivo').value || '').trim();
    if (!motivo) {
      showMessage('Informe o motivo do cancelamento.', 'error');
      document.getElementById('cancelMotivo').focus();
      return;
    }
    var negativar = document.getElementById('cancelNegativar').checked;
    var btn = this;
    btn.disabled = true;
    try {
      var r = await api('/api/wms/transferencias/' + cancelCdAtual + '/cancelar', {
        method: 'POST',
        body: JSON.stringify({ motivoCancel: motivo, permitirNegativar: negativar }),
      });
      var data = await r.json();
      if (!r.ok) {
        var msg = data.err || data.error || ('HTTP ' + r.status);
        /** Se o saldo destino é menor que a qtd, sugere ao usuário reabrir
         *  com permitir negativar. */
        if (r.status === 409 && data.saldoDestino != null && !negativar) {
          msg += '\n\nMarque "Permitir saldo negativo" se realmente quer prosseguir.';
        }
        throw new Error(msg);
      }
      document.getElementById('modalCancelTransf').hidden = true;
      cancelCdAtual = null;
      showMessage('Transferência #' + data.CD_TRANSFERENCIA + ' cancelada · estorno aplicado.', 'success');
      await carregarLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao cancelar transferência.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /** ---------- modal nova transferência (versão completa, sem dep do inventário) ---------- */

  var ntBuscaTimer = null;
  var ntPreviewCache = null;

  function ntSetStatus(msg, tipo) {
    var el = document.getElementById('ntCodigoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color =
      tipo === 'ok' ? '#15803d' :
      tipo === 'erro' ? '#b91c1c' : '';
  }

  function ntAplicarSugestaoValidade(c) {
    if (!c) return;
    var elLote = document.getElementById('ntLote');
    var elVal = document.getElementById('ntValidade');
    if (!elLote || !elVal) return;
    if (c.validadeSugerida && !String(elVal.value || '').trim()) {
      elVal.value = String(c.validadeSugerida).slice(0, 10);
    }
    if (c.loteSugerido && !String(elLote.value || '').trim()) {
      elLote.value = String(c.loteSugerido);
    }
  }

  function ntRenderResumo(c) {
    var box = document.getElementById('ntResumo');
    if (!c) { box.hidden = true; box.innerHTML = ''; return; }
    var clsSaldo = c.saldoOk ? 'transf-preview-ok' : 'transf-preview-erro';
    var icone = c.saldoOk ? '✓' : '✗';
    var html = '';
    html += '<div class="transf-preview-titulo">Pré-validação</div>';
    html += '<div class="transf-preview-linha"><strong>Produto origem:</strong> ' + esc(c.produto.CODIGO) + ' — ' + esc(c.produto.NOME) + '</div>';
    if (c.produtoDestino) {
      html += '<div class="transf-preview-linha"><strong>Produto destino:</strong> ' + esc(c.produtoDestino.CODIGO) + ' — ' + esc(c.produtoDestino.NOME) + '</div>';
    }
    html += '<div class="transf-preview-linha"><strong>De:</strong> ' + esc(c.donoOrigem.CD_DONO + ' — ' + c.donoOrigem.NOME) +
            ' · <strong>Para:</strong> ' + esc(c.donoDestino.CD_DONO + ' — ' + c.donoDestino.NOME) + '</div>';
    html += '<div class="' + clsSaldo + '">' + icone +
            ' Saldo origem: ' + fmtQtd(c.saldoOrigem) +
            ' · Solicitado: ' + fmtQtd(c.qtdSolicitada);
    if (c.saldoOk) html += ' · Saldo após: ' + fmtQtd(c.saldoOrigem - c.qtdSolicitada);
    else html += ' · INSUFICIENTE';
    html += '</div>';
    if (c.validadeSugerida || c.loteSugerido) {
      var fonte =
        c.fonteValidade === 'saldo_lote' ? 'saldo de lote (FEFO)' :
        c.fonteValidade === 'nf' ? 'NF de entrada' : 'cadastro';
      html += '<div class="transf-preview-info">✓ Validade sugerida: <strong>' +
              esc(c.validadeSugerida || '—') + '</strong>' +
              (c.loteSugerido ? ' · Lote: <strong>' + esc(c.loteSugerido) + '</strong>' : '') +
              ' <span style="opacity:.8">(' + esc(fonte) + ')</span></div>';
    } else {
      html += '<div class="transf-preview-aviso">⚠ Sem validade/lote com saldo na origem para sugerir (FEFO).</div>';
    }
    if (c.precisaCadastroDestino) {
      html += '<div class="transf-preview-aviso">' +
              '<strong>⚠ Destino sem cadastro deste SKU.</strong><br/>' +
              'Ao confirmar, o sistema vai criar o cadastro em ' + esc(c.donoDestino.NOME) +
              ' copiando: <em>' + esc(c.cadastroSugerido.CODIGO) + ' — ' + esc(c.cadastroSugerido.NOME) + '</em>.' +
              '</div>';
    } else if (c.produtoDestino) {
      html += '<div class="transf-preview-info">✓ Destino: ' + esc(c.produtoDestino.CODIGO) +
              ' — ' + esc(c.produtoDestino.NOME) + ' (CD_PRODUTO ' + esc(c.produtoDestino.CD_PRODUTO) + ').</div>';
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  /** SKU/código (ex.: 6.03.01.001.LA): só codigo — evita AND com nome=LA e zero resultados. */
  function ntParamBuscaProdutoDono(termo) {
    var t = String(termo || '').trim();
    if (!t) return '';
    if (/[.]/.test(t) || /^\d/.test(t)) {
      return '&codigo=' + encodeURIComponent(t);
    }
    if (/[a-zA-Z]/.test(t)) {
      return '&nome=' + encodeURIComponent(t);
    }
    return '&codigo=' + encodeURIComponent(t);
  }

  async function ntBuscarProdutosOrigem(termo) {
    var cd = parseInt(document.getElementById('ntDonoOrigem').value, 10);
    if (!Number.isFinite(cd)) return [];
    var t = String(termo || '').trim();
    if (!t || t.length < 2) return [];
    var url = '/api/wms/produtos-dono?cdDono=' + cd + '&somenteDono=1&fgactive=S&page=1&pageSize=25';
    url += ntParamBuscaProdutoDono(t);
    try {
      var r = await api(url);
      if (!r.ok) return [];
      var d = await r.json();
      return d.itens || d.rows || d || [];
    } catch (_) { return []; }
  }

  async function ntBuscarProdutosDestino(termo) {
    var cd = parseInt(document.getElementById('ntDonoDestino').value, 10);
    if (!Number.isFinite(cd)) return [];
    var t = String(termo || '').trim();
    if (!t || t.length < 2) return [];
    var url = '/api/wms/produtos-dono?cdDono=' + cd + '&somenteDono=1&fgactive=S&page=1&pageSize=25';
    url += ntParamBuscaProdutoDono(t);
    try {
      var r = await api(url);
      if (!r.ok) return [];
      var d = await r.json();
      return d.itens || d.rows || d || [];
    } catch (_) { return []; }
  }

  function ntAtualizarDatalistDestino(lista) {
    var dl = document.getElementById('ntCodigoDestinoSugestoes');
    if (!dl) return;
    dl.innerHTML = '';
    (lista || []).slice(0, 25).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.CODIGO || '';
      opt.label = (p.NOME || '') + (p.UNIDADE ? ' (' + p.UNIDADE + ')' : '');
      dl.appendChild(opt);
    });
  }

  function ntSetStatusDestino(msg, tipo) {
    var el = document.getElementById('ntCodigoDestinoStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color =
      tipo === 'ok' ? '#15803d' :
      tipo === 'erro' ? '#b91c1c' : '';
  }

  function ntAtualizarDatalist(lista) {
    var dl = document.getElementById('ntCodigoSugestoes');
    dl.innerHTML = '';
    (lista || []).slice(0, 25).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = p.CODIGO || '';
      opt.label = (p.NOME || '') + (p.UNIDADE ? ' (' + p.UNIDADE + ')' : '');
      dl.appendChild(opt);
    });
  }

  function ntResetForm() {
    document.getElementById('ntDonoOrigem').value = '';
    document.getElementById('ntDonoDestino').value = '';
    document.getElementById('ntCodigo').value = '';
    document.getElementById('ntCodigoDestino').value = '';
    document.getElementById('ntLote').value = '';
    document.getElementById('ntValidade').value = '';
    document.getElementById('ntQtd').value = '';
    document.getElementById('ntMotivo').value = '';
    ntSetStatus('');
    ntSetStatusDestino('');
    ntAtualizarDatalist([]);
    ntAtualizarDatalistDestino([]);
    ntRenderResumo(null);
    ntPreviewCache = null;
    document.getElementById('btnNtConfirmar').disabled = true;
  }

  function ntColetarPayload() {
    return {
      cdDonoOrigem: parseInt(document.getElementById('ntDonoOrigem').value, 10),
      cdDonoDestino: parseInt(document.getElementById('ntDonoDestino').value, 10),
      codigoProduto: String(document.getElementById('ntCodigo').value || '').trim(),
      codigoProdutoDestino: String(document.getElementById('ntCodigoDestino').value || '').trim() || null,
      lote: String(document.getElementById('ntLote').value || '').trim() || null,
      validade: String(document.getElementById('ntValidade').value || '').trim() || null,
      qtd: Number(document.getElementById('ntQtd').value),
      motivo: String(document.getElementById('ntMotivo').value || '').trim() || null,
    };
  }

  document.getElementById('btnAbrirNovaTransf').addEventListener('click', function () {
    ntResetForm();
    document.getElementById('modalNovaTransf').hidden = false;
    setTimeout(function () { document.getElementById('ntDonoOrigem').focus(); }, 50);
  });

  document.getElementById('btnNtCancelar').addEventListener('click', function () {
    document.getElementById('modalNovaTransf').hidden = true;
  });

  document.getElementById('ntDonoOrigem').addEventListener('change', function () {
    document.getElementById('ntCodigo').value = '';
    ntAtualizarDatalist([]);
    ntSetStatus('');
    ntPreviewCache = null;
    ntRenderResumo(null);
    document.getElementById('btnNtConfirmar').disabled = true;
  });
  document.getElementById('ntDonoDestino').addEventListener('change', function () {
    document.getElementById('ntCodigoDestino').value = '';
    ntAtualizarDatalistDestino([]);
    ntSetStatusDestino('');
    ntPreviewCache = null;
    ntRenderResumo(null);
    document.getElementById('btnNtConfirmar').disabled = true;
  });

  document.getElementById('ntCodigoDestino').addEventListener('input', function () {
    var v = this.value;
    if (ntBuscaTimer) clearTimeout(ntBuscaTimer);
    ntPreviewCache = null;
    ntRenderResumo(null);
    document.getElementById('btnNtConfirmar').disabled = true;
    ntSetStatusDestino(v && v.length >= 2 ? 'Procurando…' : '');
    ntBuscaTimer = setTimeout(async function () {
      var lista = await ntBuscarProdutosDestino(v);
      ntAtualizarDatalistDestino(lista);
      if (!v) ntSetStatusDestino('');
      else if (!lista.length) ntSetStatusDestino('Nenhum produto encontrado no destino.', 'erro');
      else if (lista.length === 1) ntSetStatusDestino('✓ ' + (lista[0].CODIGO || '') + ' — ' + (lista[0].NOME || ''), 'ok');
      else ntSetStatusDestino(lista.length + ' produtos encontrados no destino.', 'ok');
    }, 250);
  });

  document.getElementById('ntCodigo').addEventListener('input', function () {
    var v = this.value;
    if (ntBuscaTimer) clearTimeout(ntBuscaTimer);
    ntPreviewCache = null;
    ntRenderResumo(null);
    document.getElementById('btnNtConfirmar').disabled = true;
    ntSetStatus(v && v.length >= 2 ? 'Procurando…' : '');
    ntBuscaTimer = setTimeout(async function () {
      var lista = await ntBuscarProdutosOrigem(v);
      ntAtualizarDatalist(lista);
      if (!v) ntSetStatus('');
      else if (!lista.length) ntSetStatus('Nenhum produto encontrado na origem.', 'erro');
      else if (lista.length === 1) ntSetStatus('✓ ' + (lista[0].CODIGO || '') + ' — ' + (lista[0].NOME || ''), 'ok');
      else ntSetStatus(lista.length + ' produtos encontrados.', 'ok');
    }, 250);
  });

  document.getElementById('btnNtPreview').addEventListener('click', async function () {
    var btn = this;
    var btnConfirm = document.getElementById('btnNtConfirmar');
    btnConfirm.disabled = true;
    btn.disabled = true;
    try {
      var r = await api('/api/wms/transferencias/preview', {
        method: 'POST',
        body: JSON.stringify(ntColetarPayload()),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.err || data.error || ('HTTP ' + r.status));
      ntPreviewCache = data;
      ntAplicarSugestaoValidade(data);
      ntRenderResumo(data);
      btnConfirm.disabled = !data.saldoOk;
    } catch (e) {
      ntRenderResumo(null);
      showMessage(e.message || 'Erro na pré-validação.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btnNtConfirmar').addEventListener('click', async function () {
    if (!ntPreviewCache) return;
    var p = ntPreviewCache;
    if (p.precisaCadastroDestino) {
      var ok = window.confirm(
        'O destino "' + p.donoDestino.NOME + '" NÃO TEM este SKU cadastrado.\n\n' +
        'Posso CRIAR o cadastro automaticamente, copiando:\n' +
        '  Código: ' + p.cadastroSugerido.CODIGO + '\n' +
        '  Nome:   ' + p.cadastroSugerido.NOME + '\n' +
        '  Unid.:  ' + (p.cadastroSugerido.UNIDADE || '—') + '\n\n' +
        'Confirmar e efetivar a transferência?'
      );
      if (!ok) return;
    }
    var btn = this;
    btn.disabled = true;
    try {
      var payload = ntColetarPayload();
      payload.autoCadastrarDestino = !!p.precisaCadastroDestino;
      var r = await api('/api/wms/transferencias', { method: 'POST', body: JSON.stringify(payload) });
      var data = await r.json();
      if (!r.ok) throw new Error(data.err || data.error || ('HTTP ' + r.status));
      document.getElementById('modalNovaTransf').hidden = true;
      showMessage('Transferência #' + data.CD_TRANSFERENCIA + ' efetivada · ' +
        fmtQtd(data.QTD) + ' de ' + data.NM_DONO_ORIGEM + ' → ' + data.NM_DONO_DESTINO +
        ' · Saldo origem: ' + fmtQtd(data.saldoOrigemDepois), 'success');
      await carregarLista();
    } catch (e) {
      showMessage(e.message || 'Erro ao confirmar transferência.', 'error');
    } finally {
      btn.disabled = false;
    }
  });

  /** ---------- bindings de filtros ---------- */

  document.getElementById('formFiltros').addEventListener('submit', function (ev) {
    ev.preventDefault();
    carregarLista();
  });

  document.getElementById('btnLimpar').addEventListener('click', function () {
    document.getElementById('filtroDono').value = '';
    document.getElementById('filtroStatus').value = '';
    document.getElementById('filtroDataInicio').value = '';
    document.getElementById('filtroDataFim').value = '';
    document.getElementById('filtroLimite').value = '100';
    carregarLista();
  });

  document.getElementById('filtroStatus').addEventListener('change', renderLista);

  /** ---------- inicialização ---------- */

  (async function init() {
    await carregarDonos();
    await carregarLista();
  })();
})();
