(function () {
  var API_MAP = {
    saldo: 'posicao-estoque',
    movimentacao: 'movimentacao',
    'demonstrativo-movimentacao': 'demonstrativo-movimentacao',
    'separacao-opl': 'separacao-opl',
    'shelf-life': 'shelf-life',
  };

  var LS_WMS_REL_DONO = 'wmsRel_filtro_cdDono';
  var LS_WMS_REL_FILTROS_COLL = 'wmsRel_filtrosCollapsed';

  function getDonoMasterEl() {
    return document.getElementById('filtro_cd_dono');
  }

  function lerDonoPersistido() {
    try {
      return localStorage.getItem(LS_WMS_REL_DONO) || '';
    } catch (e) {
      return '';
    }
  }

  function persistirDono(valor) {
    try {
      var v = String(valor || '').trim();
      if (v) localStorage.setItem(LS_WMS_REL_DONO, v);
      else localStorage.removeItem(LS_WMS_REL_DONO);
    } catch (e) {}
  }

  function aplicarDonoEmSelect(sel, valor, opts) {
    if (!sel) return;
    opts = opts || {};
    var v = String(valor || '').trim();
    if (v && !sel.querySelector('option[value="' + v.replace(/"/g, '\\"') + '"]')) return;
    if (!opts.silent) sel.dataset.wmsRelSyncing = '1';
    sel.value = v;
    if (!opts.silent) delete sel.dataset.wmsRelSyncing;
  }

  /** Sincroniza dono entre barra fixa e abas NF×OPL / Divergências. */
  function sincronizarDonoNasAbas(origemId) {
    var master = getDonoMasterEl();
    if (!master) return;
    var valor = String(master.value || '').trim();
    if (origemId === 'nfOplCdDono') {
      var nf = document.getElementById('nfOplCdDono');
      valor = nf && String(nf.value || '').trim() !== '' ? String(nf.value).trim() : valor;
      aplicarDonoEmSelect(master, valor);
    } else if (origemId === 'divergExpCdDono') {
      var dv = document.getElementById('divergExpCdDono');
      valor = dv && String(dv.value || '').trim() !== '' ? String(dv.value).trim() : valor;
      aplicarDonoEmSelect(master, valor);
    } else {
      aplicarDonoEmSelect(document.getElementById('nfOplCdDono'), valor, { silent: true });
      aplicarDonoEmSelect(document.getElementById('divergExpCdDono'), valor, { silent: true });
    }
    persistirDono(valor);
    atualizarResumoDonoBar();
  }

  function atualizarResumoDonoBar() {
    var sel = getDonoMasterEl();
    var resumo = document.getElementById('wmsRelDonoResumo');
    if (!resumo) return;
    if (!sel || String(sel.value || '').trim() === '') {
      resumo.textContent = 'Nenhum dono selecionado — relatórios podem incluir todos os donos.';
      resumo.classList.add('is-empty');
      return;
    }
    var op = sel.options[sel.selectedIndex];
    resumo.textContent = op ? 'Ativo: ' + op.textContent : 'Dono #' + sel.value;
    resumo.classList.remove('is-empty');
  }

  function atualizarResumoFiltrosColapsados() {
    var box = document.getElementById('wmsRelFiltrosResumo');
    if (!box) return;
    var chips = [];
    var cod = document.getElementById('filtro_codigo_produto');
    var desc = document.getElementById('filtro_descricao_produto');
    var grp = document.getElementById('filtro_cd_grupo');
    var cat = document.getElementById('filtro_cd_categoria');
    if (cod && String(cod.value || '').trim()) chips.push({ k: 'Cód.', v: cod.value.trim() });
    if (desc && String(desc.value || '').trim()) chips.push({ k: 'Desc.', v: desc.value.trim() });
    if (grp && String(grp.value || '').trim()) {
      var og = grp.options[grp.selectedIndex];
      chips.push({ k: 'Grupo', v: og ? og.textContent : grp.value });
    }
    if (cat && String(cat.value || '').trim()) {
      var oc = cat.options[cat.selectedIndex];
      chips.push({ k: 'Cat.', v: oc ? oc.textContent : cat.value });
    }
    var cons = lerConservacaoSelecionada();
    if (cons.length) chips.push({ k: 'Cons.', v: cons.join(', ') });
    var de = document.getElementById('filtro_dt_de');
    var ate = document.getElementById('filtro_dt_ate');
    if (de && de.value) chips.push({ k: 'De', v: de.value });
    if (ate && ate.value) chips.push({ k: 'Até', v: ate.value });
    box.innerHTML = chips
      .map(function (c) {
        return '<span class="wms-rel-filtro-chip" title="' + esc(c.k + ': ' + c.v) + '">' + esc(c.k + ': ' + c.v) + '</span>';
      })
      .join('');
  }

  function setFiltrosComunsCollapsed(collapsed, persist) {
    var body = document.getElementById('wmsRelFiltrosBody');
    var btn = document.getElementById('btnToggleFiltrosComuns');
    var icon = document.getElementById('wmsRelFiltrosToggleIcon');
    var label = document.getElementById('wmsRelFiltrosToggleLabel');
    if (body) body.classList.toggle('is-collapsed', !!collapsed);
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (icon) icon.className = collapsed ? 'bx bx-chevron-down' : 'bx bx-chevron-up';
    if (label) label.textContent = collapsed ? 'Expandir' : 'Recolher';
    if (persist !== false) {
      try {
        localStorage.setItem(LS_WMS_REL_FILTROS_COLL, collapsed ? '1' : '0');
      } catch (e) {}
    }
    atualizarResumoFiltrosColapsados();
  }

  function toggleFiltrosComuns() {
    var body = document.getElementById('wmsRelFiltrosBody');
    var collapsed = body ? body.classList.contains('is-collapsed') : false;
    setFiltrosComunsCollapsed(!collapsed);
  }

  function initFiltrosComunsUi() {
    var collapsed = false;
    try {
      collapsed = localStorage.getItem(LS_WMS_REL_FILTROS_COLL) === '1';
    } catch (e) {}
    setFiltrosComunsCollapsed(collapsed, false);
    atualizarResumoDonoBar();
    atualizarResumoFiltrosColapsados();
    var master = getDonoMasterEl();
    if (master) {
      master.addEventListener('change', function () {
        sincronizarDonoNasAbas('filtro_cd_dono');
      });
    }
    ['nfOplCdDono', 'divergExpCdDono'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', function () {
        if (el.dataset.wmsRelSyncing === '1') return;
        sincronizarDonoNasAbas(id);
      });
    });
    [
      'filtro_codigo_produto',
      'filtro_descricao_produto',
      'filtro_cd_grupo',
      'filtro_cd_categoria',
      'filtro_dt_de',
      'filtro_dt_ate',
    ].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', atualizarResumoFiltrosColapsados);
      el.addEventListener('change', atualizarResumoFiltrosColapsados);
    });
  }

  function fillRelGrupoSelect(done) {
    var sel = document.getElementById('filtro_cd_grupo');
    if (!sel) {
      if (typeof done === 'function') done();
      return;
    }
    var keep = sel.value;
    var oLoad = document.createElement('option');
    oLoad.value = '';
    oLoad.textContent = 'Carregando grupos…';
    if (sel.options.length <= 1) {
      sel.innerHTML = '';
      sel.appendChild(oLoad);
    }
    fetch(corrigirUrl('/api/wms/grupos-produto?fgactive=S'), {
      headers: getAuthHeaders(),
      credentials: 'same-origin',
    })
      .then(lerJsonResposta)
      .then(function (rows) {
        if (!Array.isArray(rows)) {
          if (rows && Array.isArray(rows.data)) rows = rows.data;
          else if (rows && Array.isArray(rows.rows)) rows = rows.rows;
          else throw new Error('Resposta inválida de grupos.');
        }
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todos';
        sel.appendChild(o0);
        rows.forEach(function (g) {
          var o = document.createElement('option');
          o.value = String(g.CD_GRUPO);
          o.textContent = (g.CODIGO ? g.CODIGO + ' — ' : '') + (g.NOME || '');
          sel.appendChild(o);
        });
        if (keep && Array.prototype.some.call(sel.options, function (x) { return x.value === keep; })) {
          sel.value = keep;
        }
        if (typeof done === 'function') done();
      })
      .catch(function (err) {
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todos (falha ao carregar)';
        sel.appendChild(o0);
        console.warn('[WMS relatorios] grupos:', err);
        if (typeof showMessage === 'function') {
          showMessage('Não foi possível carregar o combo de Grupo: ' + (err.message || err), 'error');
        }
        if (typeof done === 'function') done();
      });
  }

  function fillRelCategoriaSelect(done) {
    var sel = document.getElementById('filtro_cd_categoria');
    if (!sel) {
      if (typeof done === 'function') done();
      return;
    }
    var keep = sel.value;
    var cdGrupo = (document.getElementById('filtro_cd_grupo') || {}).value || '';
    var q = new URLSearchParams({ fgactive: 'S' });
    if (cdGrupo) q.append('cdGrupo', String(cdGrupo));
    fetch(corrigirUrl('/api/wms/categorias-produto?' + q.toString()), {
      headers: getAuthHeaders(),
      credentials: 'same-origin',
    })
      .then(lerJsonResposta)
      .then(function (rows) {
        if (!Array.isArray(rows)) {
          if (rows && Array.isArray(rows.data)) rows = rows.data;
          else if (rows && Array.isArray(rows.rows)) rows = rows.rows;
          else throw new Error('Resposta inválida de categorias.');
        }
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todas';
        sel.appendChild(o0);
        rows.forEach(function (c) {
          var o = document.createElement('option');
          o.value = String(c.CD_CATEGORIA);
          var grp = c.NM_GRUPO ? ' (' + c.NM_GRUPO + ')' : '';
          o.textContent = (c.CODIGO || '') + ' — ' + (c.NOME || '') + grp;
          sel.appendChild(o);
        });
        if (keep && Array.prototype.some.call(sel.options, function (x) { return x.value === keep; })) {
          sel.value = keep;
        } else {
          sel.value = '';
        }
        if (typeof done === 'function') done();
      })
      .catch(function (err) {
        sel.innerHTML = '';
        var o0 = document.createElement('option');
        o0.value = '';
        o0.textContent = 'Todas (falha ao carregar)';
        sel.appendChild(o0);
        console.warn('[WMS relatorios] categorias:', err);
        if (typeof done === 'function') done();
      });
  }

  function iniciarCombosGrupoCategoriaRel() {
    fillRelGrupoSelect(function () {
      fillRelCategoriaSelect();
    });
    var selG = document.getElementById('filtro_cd_grupo');
    if (selG && !selG._relBound) {
      selG._relBound = true;
      selG.addEventListener('change', function () {
        fillRelCategoriaSelect(function () {
          atualizarResumoFiltrosColapsados();
        });
      });
    }
  }

  function getAuthHeaders() {
    var h = {};
    var t = localStorage.getItem('token');
    if (t) h.Authorization = 'Bearer ' + t;
    try {
      var user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) h['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    var u = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (u) h['user-login'] = h['user-login'] || u;
    return h;
  }

  /** Evita overlay preso se a API demorar ou o navegador travar no document.write. */
  function fetchRelatorioComTimeout(url, ms) {
    ms = ms || 120000;
    if (typeof AbortController === 'undefined') {
      return fetch(url, { headers: getAuthHeaders() });
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () {
      ctrl.abort();
    }, ms);
    return fetch(url, { headers: getAuthHeaders(), signal: ctrl.signal }).finally(function () {
      clearTimeout(timer);
    });
  }

  function lerErroResposta(r) {
    return r.text().then(function (t) {
      throw new Error(mensagemDeCorpoHttp(r, t));
    });
  }

  /** Corpo HTML (SPA/login) no lugar de JSON — mensagem clara, sem "Unexpected token <". */
  function mensagemDeCorpoHttp(r, t) {
    var raw = String(t == null ? '' : t).trim();
    if (!raw || raw.charAt(0) === '<') {
      if (r.status === 401 || r.status === 403) return 'Sessão expirada ou sem permissão. Faça login de novo.';
      if (r.status === 404) return 'Endpoint não encontrado. Reinicie o serviço Node para carregar as rotas novas.';
      return 'A API devolveu uma página HTML em vez de JSON (HTTP ' + r.status + '). Reinicie o serviço se acabou de atualizar o sistema.';
    }
    try {
      var j = JSON.parse(raw);
      if (j && (j.error || j.message)) {
        var m = j.error || j.message;
        if (j.path) m += ' — ' + j.path;
        return m;
      }
    } catch (e) {}
    return (raw.length > 180 ? raw.slice(0, 180) + '…' : raw) || r.statusText || 'Erro HTTP ' + r.status;
  }

  function lerJsonResposta(r) {
    return r.text().then(function (t) {
      var raw = String(t == null ? '' : t).trim();
      if (!raw || raw.charAt(0) === '<') {
        throw new Error(mensagemDeCorpoHttp(r, t));
      }
      var j;
      try {
        j = JSON.parse(raw);
      } catch (e) {
        throw new Error(mensagemDeCorpoHttp(r, t));
      }
      if (!r.ok) {
        var msg = (j && (j.error || j.message)) || 'HTTP ' + r.status;
        if (j && j.path) msg += ' — ' + j.path;
        throw new Error(msg);
      }
      return j;
    });
  }

  /** extra de queryFiltros() vem como "&a=1&b=2" (ou ""). Evita .../rota&a=1 (404). */
  function urlComQuery(path, extra) {
    var base = corrigirUrl(path);
    var ex = String(extra || '');
    if (!ex) return base;
    if (ex.charAt(0) === '?') return base + ex;
    if (ex.charAt(0) === '&') {
      return base.indexOf('?') >= 0 ? base + ex : base + '?' + ex.slice(1);
    }
    return base.indexOf('?') >= 0 ? base + '&' + ex : base + '?' + ex;
  }

  function corrigirUrl(path) {
    if (typeof window.corrigirUrl === 'function') return window.corrigirUrl(path);
    return path;
  }

  function showMessage(text, type) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type, document.getElementById('message'));
      return;
    }
    var el = document.getElementById('message');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'message ' + (type || '');
    el.style.display = text ? 'block' : 'none';
  }

  function rootRelatorios() {
    return document.querySelector('.wms-rel-container');
  }

  /** Busca elemento do módulo (container, contentArea ou document). */
  function elementoModulo(id) {
    var root = rootRelatorios();
    if (root) {
      var noRoot = root.querySelector('#' + id);
      if (noRoot) return noRoot;
    }
    var area = document.getElementById('contentArea');
    if (area) {
      var noArea = area.querySelector('#' + id);
      if (noArea) return noArea;
    }
    return document.getElementById(id);
  }

  /** Remove overlay/modal órfãos no body (ficam após sair do módulo e bloqueiam cliques). */
  function limparResiduosModulo() {
    document.querySelectorAll('body > #loadingOverlay, body > #confirmModal').forEach(function (el) {
      el.remove();
    });
    var o = elementoModulo('loadingOverlay');
    if (o) o.style.display = 'none';
    var m = elementoModulo('confirmModal');
    if (m) m.style.display = 'none';
  }

  function showLoadingOverlay(titulo, texto, det) {
    var o = elementoModulo('loadingOverlay');
    if (!o) return;
    var a = o.querySelector('#loadingTitle') || document.getElementById('loadingTitle');
    var b = o.querySelector('#loadingText') || document.getElementById('loadingText');
    var c = o.querySelector('#loadingDetalhe') || document.getElementById('loadingDetalhe');
    if (a) a.textContent = titulo || 'Carregando';
    if (b) b.textContent = texto || 'Aguarde...';
    if (c) c.textContent = det || '';
    o.style.display = 'flex';
  }

  function hideLoadingOverlay() {
    document.querySelectorAll('#loadingOverlay').forEach(function (o) {
      o.style.display = 'none';
    });
  }

  /** Mesmo padrão do Gerenciar Cadastro Geral (#confirmModal + modulos.css). */
  function getModalElements() {
    if (typeof window.getConfirmModalElements === 'function') {
      return window.getConfirmModalElements({ rootId: 'contentArea' });
    }
    var modalEl = elementoModulo('confirmModal');
    return {
      modalEl: modalEl,
      modalMessage: modalEl ? modalEl.querySelector('#modalMessage') : null,
      confirmYes: modalEl ? modalEl.querySelector('#confirmYes') : null,
      confirmNo: modalEl ? modalEl.querySelector('#confirmNo') : null,
    };
  }

  function confirmarAcaoRelatorio(msg, extra) {
    extra = extra || {};
    return new Promise(function (resolve) {
      var els = getModalElements();
      var modalEl = els.modalEl;
      var modalMessage = els.modalMessage;
      var confirmYes = els.confirmYes;
      var confirmNo = els.confirmNo;
      if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
        if (typeof window.confirmPadrao === 'function') {
          window.confirmPadrao(msg || '', {
            title: extra.titulo || 'Confirmar ação',
            danger: !!extra.okDanger,
            confirmText: extra.okLabel || 'Continuar',
            cancelText: 'Cancelar',
          }).then(function (ok) { resolve(!!ok); });
        } else {
          resolve(!!window.confirm(msg || ''));
        }
        return;
      }
      modalMessage.textContent = msg || 'Confirmar ação?';
      modalMessage.style.whiteSpace = 'pre-line';
      confirmYes.className =
        extra.okDanger === true ? 'btn-filtro btn-filtro-danger' : 'btn-filtro btn-filtro-aplicar';
      confirmYes.innerHTML = "<i class='bx bx-check'></i> " + (extra.okLabel || 'Continuar');
      confirmNo.className = 'btn-filtro btn-filtro-limpar';
      confirmNo.innerHTML = "<i class='bx bx-x'></i> Cancelar";
      confirmYes.onclick = function () {
        modalEl.style.display = 'none';
        resolve(true);
      };
      confirmNo.onclick = function () {
        modalEl.style.display = 'none';
        resolve(false);
      };
      if (modalEl.parentNode !== document.body) document.body.appendChild(modalEl);
      modalEl.style.display = 'block';
      modalEl.style.zIndex = '99999';
    });
  }

  function abaRelatorioAtiva() {
    var btn = document.querySelector('.wms-rel-container .tab-btn.active');
    return btn ? String(btn.getAttribute('data-tab') || '') : 'saldo';
  }

  function lerOrdemSaldo() {
    var out = [];
    ['filtro_saldo_ord1', 'filtro_saldo_ord2', 'filtro_saldo_ord3'].forEach(function (id) {
      var el = document.getElementById(id);
      var v = el && String(el.value || '').trim();
      if (v) out.push(v);
    });
    return out;
  }

  function queryFiltros() {
    var q = [];
    var d = document.getElementById('filtro_cd_dono');
    if (d && String(d.value || '').trim() !== '') {
      q.push('cdDono=' + encodeURIComponent(String(d.value).trim()));
    }
    var tab = abaRelatorioAtiva();
    if (tab === 'mov' || tab === 'dre' || tab === 'separacao') {
      var de = document.getElementById('filtro_dt_de');
      var ate = document.getElementById('filtro_dt_ate');
      if (de && de.value) q.push('dtDe=' + encodeURIComponent(de.value));
      if (ate && ate.value) q.push('dtAte=' + encodeURIComponent(ate.value));
    }
    /** Aba "Movimentação" tem um select adicional de sentido (entradas/saídas). */
    if (tab === 'mov') {
      var sent = document.getElementById('filtro_sentido_mov');
      if (sent && String(sent.value || '').trim() !== '') {
        q.push('sentido=' + encodeURIComponent(String(sent.value).trim()));
      }
      var ordem = document.getElementById('filtro_ordem_mov');
      if (ordem && String(ordem.value || '').trim() !== '') {
        q.push('ordem=' + encodeURIComponent(String(ordem.value).trim()));
      }
    }
    if (tab === 'separacao') {
      var sitSep = document.getElementById('filtro_situacao_sep');
      if (sitSep && String(sitSep.value || '').trim() !== '') {
        q.push('situacaoPicking=' + encodeURIComponent(String(sitSep.value).trim()));
      }
      var espSep = document.getElementById('filtro_sep_espelho');
      if (espSep && String(espSep.value || '').trim() !== '') {
        q.push('espelho=' + encodeURIComponent(String(espSep.value).trim()));
      }
      var cdOplSep = document.getElementById('filtro_sep_cd_opl');
      if (cdOplSep && String(cdOplSep.value || '').trim() !== '') {
        q.push('cdOplArquivo=' + encodeURIComponent(String(cdOplSep.value).trim()));
      }
      var pedSep = document.getElementById('filtro_sep_pedido');
      if (pedSep && String(pedSep.value || '').trim() !== '') {
        q.push('numPedido=' + encodeURIComponent(String(pedSep.value).trim()));
      }
      var destSep = document.getElementById('filtro_sep_destino');
      if (destSep && String(destSep.value || '').trim() !== '') {
        q.push('destino=' + encodeURIComponent(String(destSep.value).trim()));
      }
      var tipoPerSep = document.getElementById('filtro_sep_tipo_periodo');
      if (tipoPerSep && String(tipoPerSep.value || '').trim() !== '' && tipoPerSep.value !== 'importacao') {
        q.push('tipoPeriodo=' + encodeURIComponent(String(tipoPerSep.value).trim()));
      }
    }
    if (tab === 'saldo') {
      var sepSaldo = document.getElementById('filtro_saldo_separadores');
      if (sepSaldo && String(sepSaldo.value || '').trim() !== '' && sepSaldo.value !== 'nao') {
        q.push('separadores=' + encodeURIComponent(String(sepSaldo.value).trim()));
      }
      var ordSaldo = lerOrdemSaldo();
      if (ordSaldo.length) {
        q.push('ordem=' + encodeURIComponent(ordSaldo.join(',')));
      }
      var inclZero = document.getElementById('filtro_saldo_incluir_zerados');
      if (inclZero && inclZero.checked) {
        q.push('incluirZerados=1');
      }
    }
    var cod = document.getElementById('filtro_codigo_produto');
    var desc = document.getElementById('filtro_descricao_produto');
    var grp = document.getElementById('filtro_cd_grupo');
    var cat = document.getElementById('filtro_cd_categoria');
    if (cod && String(cod.value || '').trim() !== '') {
      q.push('codigoProduto=' + encodeURIComponent(String(cod.value).trim()));
    }
    if (desc && String(desc.value || '').trim() !== '') {
      q.push('descricaoProduto=' + encodeURIComponent(String(desc.value).trim()));
    }
    if (grp && String(grp.value || '').trim() !== '') {
      q.push('cdGrupo=' + encodeURIComponent(String(grp.value).trim()));
    }
    if (cat && String(cat.value || '').trim() !== '') {
      q.push('cdCategoria=' + encodeURIComponent(String(cat.value).trim()));
    }
    var cons = lerConservacaoSelecionada();
    if (cons.length) {
      q.push('conservacao=' + encodeURIComponent(cons.join(',')));
    }
    return q.length ? '&' + q.join('&') : '';
  }

  function lerConservacaoSelecionada() {
    var out = [];
    var grid = document.getElementById('wmsRelConservacaoGrid');
    if (!grid) return out;
    grid.querySelectorAll('input[type="checkbox"][name="cons"]').forEach(function (cb) {
      if (cb.checked && cb.value) out.push(cb.value);
    });
    return out;
  }

  function refreshConservacaoChips() {
    var grid = document.getElementById('wmsRelConservacaoGrid');
    if (!grid) return;
    var total = 0;
    var marcados = 0;
    grid.querySelectorAll('.wms-rel-cons-chip').forEach(function (chip) {
      var cb = chip.querySelector('input[type="checkbox"]');
      var on = !!(cb && cb.checked);
      chip.classList.toggle('is-active', on);
      total += 1;
      if (on) marcados += 1;
    });
    var btn = document.getElementById('btnConsTodos');
    if (btn) {
      if (marcados >= total) {
        btn.textContent = 'Limpar marcação';
        btn.dataset.acao = 'limpar';
      } else {
        btn.textContent = 'Marcar todos';
        btn.dataset.acao = 'todos';
      }
    }
  }

  function alternarMarcarTodosConservacao() {
    var btn = document.getElementById('btnConsTodos');
    var marcar = !btn || btn.dataset.acao !== 'limpar';
    document
      .querySelectorAll('#wmsRelConservacaoGrid input[type="checkbox"][name="cons"]')
      .forEach(function (cb) {
        cb.checked = marcar;
      });
    refreshConservacaoChips();
  }

  function limparFiltrosRelatorio() {
    var cod = document.getElementById('filtro_codigo_produto');
    var desc = document.getElementById('filtro_descricao_produto');
    var grp = document.getElementById('filtro_cd_grupo');
    var cat = document.getElementById('filtro_cd_categoria');
    var de = document.getElementById('filtro_dt_de');
    var ate = document.getElementById('filtro_dt_ate');
    if (cod) cod.value = '';
    if (desc) desc.value = '';
    if (grp) grp.value = '';
    if (cat) {
      cat.value = '';
      fillRelCategoriaSelect();
    }
    if (de) de.value = '';
    if (ate) ate.value = '';
    var sentMov = document.getElementById('filtro_sentido_mov');
    var ordemMov = document.getElementById('filtro_ordem_mov');
    var sitSep = document.getElementById('filtro_situacao_sep');
    if (sentMov) sentMov.value = '';
    if (ordemMov) ordemMov.value = '';
    if (sitSep) sitSep.value = '';
    var espSep = document.getElementById('filtro_sep_espelho');
    var cdOplSep = document.getElementById('filtro_sep_cd_opl');
    var pedSep = document.getElementById('filtro_sep_pedido');
    var destSep = document.getElementById('filtro_sep_destino');
    var tipoPerSep = document.getElementById('filtro_sep_tipo_periodo');
    if (espSep) espSep.value = '';
    if (cdOplSep) cdOplSep.value = '';
    if (pedSep) pedSep.value = '';
    if (destSep) destSep.value = '';
    if (tipoPerSep) tipoPerSep.value = 'importacao';
    var sepSaldo = document.getElementById('filtro_saldo_separadores');
    if (sepSaldo) sepSaldo.value = 'cons_grupo_cat';
    var ord1 = document.getElementById('filtro_saldo_ord1');
    var ord2 = document.getElementById('filtro_saldo_ord2');
    var ord3 = document.getElementById('filtro_saldo_ord3');
    if (ord1) ord1.value = 'conservacao';
    if (ord2) ord2.value = 'grupo';
    if (ord3) ord3.value = 'subcategoria';
    var inclZ = document.getElementById('filtro_saldo_incluir_zerados');
    if (inclZ) inclZ.checked = false;
    var shelfData = document.getElementById('filtro_shelf_data_referencia');
    var shelfHor = document.getElementById('filtro_shelf_horizonte_dias');
    var shelfAp = document.getElementById('filtro_shelf_apontado');
    if (shelfData) shelfData.value = '';
    if (shelfHor) shelfHor.value = '';
    if (shelfAp) shelfAp.value = 'todos';
    document
      .querySelectorAll('#wmsRelConservacaoGrid input[type="checkbox"][name="cons"]')
      .forEach(function (cb) {
        cb.checked = false;
      });
    refreshConservacaoChips();
    atualizarResumoFiltrosColapsados();
    showMessage('Filtros de produto limpos (dono mantido).', 'success');
  }

  function exigirDonoSePossivel() {
    var d = document.getElementById('filtro_cd_dono');
    if (d && String(d.value || '').trim() !== '') return Promise.resolve(true);
    return confirmarAcaoRelatorio(
      'Nenhum dono selecionado.\n\nO relatório pode incluir TODOS os donos do tenant. Para um único armazém/cliente, selecione o dono nos filtros.',
      { okLabel: 'Continuar', okDanger: false }
    );
  }

  function gerarRelatorio(relKey, fmt, opts) {
    opts = opts || {};
    var path = API_MAP[relKey] || relKey;
    return exigirDonoSePossivel().then(function (ok) {
      if (!ok) return;
      var extra = queryFiltros();
      if (opts.modo) extra += '&modo=' + encodeURIComponent(String(opts.modo));
      if (opts.somenteVencidos) extra += '&somenteVencidos=1';
      if (opts.etqModo) extra += '&etqModo=' + encodeURIComponent(String(opts.etqModo));
      if (opts.etqQtd != null) extra += '&etqQtd=' + encodeURIComponent(String(opts.etqQtd));
      if (relKey === 'shelf-life') {
        var dataRefEl = document.getElementById('filtro_shelf_data_referencia');
        var dataRefVal = dataRefEl && dataRefEl.value ? String(dataRefEl.value).trim() : '';
        if (dataRefVal && /^\d{4}-\d{2}-\d{2}$/.test(dataRefVal)) {
          extra += '&dataReferencia=' + encodeURIComponent(dataRefVal);
        }
        var horEl = document.getElementById('filtro_shelf_horizonte_dias');
        var horVal = horEl && horEl.value ? parseInt(String(horEl.value).trim(), 10) : NaN;
        if (Number.isFinite(horVal) && horVal >= 1 && horVal <= 1095) {
          extra += '&horizonteDias=' + encodeURIComponent(String(horVal));
        }
        var apEl = document.getElementById('filtro_shelf_apontado');
        var apVal = apEl && apEl.value ? String(apEl.value).trim() : 'todos';
        if (apVal && apVal !== 'todos') {
          extra += '&apontado=' + encodeURIComponent(apVal);
        }
      }
      if (relKey === 'conversao-embalagem') {
        var origEl = document.getElementById('filtro_conv_origem');
        var origVal = origEl && origEl.value ? String(origEl.value).trim() : 'todos';
        extra += '&origem=' + encodeURIComponent(origVal || 'todos');
      }
      var u = urlComQuery('/api/wms/relatorios/' + path + '?formato=' + encodeURIComponent(fmt), extra);
      showLoadingOverlay('Relatório', 'Gerando...', path);
      var botoesRel = document.querySelectorAll('.wms-rel-container [data-rel][data-fmt], #btnEtiquetasSaldo');
      botoesRel.forEach(function (b) {
        b.disabled = true;
      });
      return fetchRelatorioComTimeout(u)
        .then(function (r) {
          if (!r.ok) return lerErroResposta(r);
          if (fmt === 'html' || fmt === 'etiquetas') return r.text();
          return r.blob();
        })
        .then(function (payload) {
          hideLoadingOverlay();
          if (fmt === 'html' || fmt === 'etiquetas') {
            var w = window.open('', '_blank');
            if (!w) {
              showMessage('Permita pop-up para abrir o relatório.', 'error');
              return;
            }
            try {
              w.document.open();
              w.document.write(payload);
              w.document.close();
            } catch (err) {
              showMessage((err && err.message) || 'Erro ao montar a janela de impressão.', 'error');
              return;
            }
            showMessage(fmt === 'etiquetas' ? 'Etiquetas abertas para impressão.' : 'Relatório aberto para impressão.', 'success');
            return;
          }
          var url = URL.createObjectURL(payload);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'wms-' + path.replace(/\//g, '-') + '.csv';
          a.click();
          URL.revokeObjectURL(url);
          showMessage('Download iniciado.', 'success');
        })
        .catch(function (e) {
          hideLoadingOverlay();
          var msg = (e && e.message) || 'Erro ao gerar relatório.';
          if (e && e.name === 'AbortError') {
            msg =
              'Tempo esgotado ao gerar o relatório. Informe dono + período ou código do produto para reduzir o volume.';
          }
          showMessage(msg, 'error');
        })
        .finally(function () {
          hideLoadingOverlay();
          botoesRel.forEach(function (b) {
            b.disabled = false;
          });
        });
    });
  }

  function perguntarModoEtiquetasSaldo() {
    return new Promise(function (resolve) {
      var modal = document.getElementById('modalEtqSaldo');
      var btnOk = document.getElementById('modalEtqSaldoContinuar');
      var btnNo = document.getElementById('modalEtqSaldoCancelar');
      var wrapFixo = document.getElementById('etqSaldoFixoWrap');
      var inpFixo = document.getElementById('etqSaldoQtdFixa');
      if (!modal || !btnOk || !btnNo) {
        resolve({ modo: 'linha', qtdFixa: 1 });
        return;
      }
      var radios = modal.querySelectorAll('input[name="etqModoSaldo"]');
      if (radios.length) radios[0].checked = true;
      if (inpFixo) inpFixo.value = '2';
      function syncWrap() {
        var el = modal.querySelector('input[name="etqModoSaldo"]:checked');
        var isFixo = el && el.value === 'fixo';
        if (wrapFixo) {
          wrapFixo.classList.toggle('ativo', !!isFixo);
          wrapFixo.setAttribute('aria-hidden', isFixo ? 'false' : 'true');
        }
        if (inpFixo) inpFixo.disabled = !isFixo;
      }
      function onRadio() {
        syncWrap();
      }
      function fechar(val) {
        modal.style.display = 'none';
        radios.forEach(function (r) {
          r.removeEventListener('change', onRadio);
        });
        btnOk.removeEventListener('click', onOk);
        btnNo.removeEventListener('click', onNo);
        resolve(val);
      }
      function onOk() {
        var el = modal.querySelector('input[name="etqModoSaldo"]:checked');
        var modo = el ? el.value : 'linha';
        var qtd = 1;
        if (modo === 'fixo') {
          qtd = inpFixo ? parseInt(String(inpFixo.value || '').trim(), 10) : 1;
          if (!Number.isFinite(qtd) || qtd < 1) {
            showMessage('Informe de 1 a 500 etiquetas por linha.', 'error');
            return;
          }
          if (qtd > 500) qtd = 500;
        }
        fechar({ modo: modo, qtdFixa: qtd });
      }
      function onNo() {
        fechar(null);
      }
      radios.forEach(function (r) {
        r.addEventListener('change', onRadio);
      });
      syncWrap();
      btnOk.addEventListener('click', onOk);
      btnNo.addEventListener('click', onNo);
      modal.style.display = 'flex';
    });
  }

  function gerarEtiquetasSaldo() {
    perguntarModoEtiquetasSaldo().then(function (escolha) {
      if (!escolha) return;
      gerarRelatorio('saldo', 'etiquetas', {
        etqModo: escolha.modo,
        etqQtd: escolha.qtdFixa,
      });
    });
  }

  function carregarDonos() {
    return fetch(corrigirUrl('/api/wms/donos-estoque'), { headers: getAuthHeaders() })
      .then(lerJsonResposta)
      .then(function (rows) {
        var list = Array.isArray(rows) ? rows : [];
        var cur = lerDonoPersistido();
        /** Popular o select de dono dos filtros comuns. */
        var sel = document.getElementById('filtro_cd_dono');
        if (sel) {
          if (sel.value) cur = sel.value;
          sel.innerHTML = '<option value="">— Selecione —</option>';
          list.forEach(function (d) {
            var o = document.createElement('option');
            o.value = String(d.CD_DONO);
            o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
            sel.appendChild(o);
          });
          if (cur) sel.value = cur;
          sincronizarDonoNasAbas('filtro_cd_dono');
        }
        /** Popular o select de dono da aba "Divergências de Expedição" (opcional). */
        var selDiv = document.getElementById('divergExpCdDono');
        if (selDiv) {
          var curDiv = selDiv.value;
          selDiv.innerHTML = '<option value="">— Todos —</option>';
          list.forEach(function (d) {
            var o = document.createElement('option');
            o.value = String(d.CD_DONO);
            o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
            o.setAttribute('data-nome', d.NOME || '');
            selDiv.appendChild(o);
          });
          if (curDiv) selDiv.value = curDiv;
          else if (cur) selDiv.value = cur;
        }
        /** Popular o select de dono da aba "NF × Separação". */
        var selNfOpl = document.getElementById('nfOplCdDono');
        if (selNfOpl) {
          var curNf = selNfOpl.value;
          selNfOpl.innerHTML = '<option value="">— Todos —</option>';
          list.forEach(function (d) {
            var o = document.createElement('option');
            o.value = String(d.CD_DONO);
            o.textContent = (d.CODIGO || '') + ' — ' + (d.NOME || '');
            o.setAttribute('data-nome', d.NOME || '');
            selNfOpl.appendChild(o);
          });
          if (curNf) selNfOpl.value = curNf;
          else if (cur) selNfOpl.value = cur;
        }
      })
      .catch(function (err) {
        console.warn('[WMS relatorios] donos:', err);
        if (typeof showMessage === 'function') {
          showMessage((err && err.message) || 'Erro ao carregar donos.', 'error');
        }
      });
  }

  function carregarHistoricoEnvios() {
    return fetch(corrigirUrl('/api/wms/relatorios/shelf-life/envios?limit=50'), {
      headers: getAuthHeaders(),
    })
      .then(lerJsonResposta)
      .then(function (j) {
        var body = document.getElementById('wmsRelEnviosBody');
        if (!body) return;
        var list = (j && j.envios) || [];
        if (!list.length) {
          body.innerHTML =
            '<tr><td colspan="5">' +
            esc(j && j.aviso ? j.aviso : 'Nenhum envio registrado.') +
            '</td></tr>';
          return;
        }
        body.innerHTML = list
          .map(function (e) {
            return (
              '<tr><td>' +
              esc(e.DH_ENVIO || '') +
              '</td><td>' +
              esc(e.NU_LINHAS != null ? e.NU_LINHAS : '') +
              '</td><td>' +
              esc(e.ST_EMAIL || '') +
              '</td><td>' +
              esc(e.FG_ANEXO_CSV || '') +
              '</td><td>' +
              esc(e.DETALHE || e.MESSAGE_ID || '') +
              '</td></tr>'
            );
          })
          .join('');
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao carregar histórico.', 'error');
      });
  }

  function queryShelfApontadoExtra() {
    var extra = queryFiltros();
    extra += '&modo=saldo';
    var dataRefEl = document.getElementById('filtro_shelf_data_referencia');
    var dataRefVal = dataRefEl && dataRefEl.value ? String(dataRefEl.value).trim() : '';
    if (dataRefVal && /^\d{4}-\d{2}-\d{2}$/.test(dataRefVal)) {
      extra += '&dataReferencia=' + encodeURIComponent(dataRefVal);
    }
    var horEl = document.getElementById('filtro_shelf_horizonte_dias');
    var horVal = horEl && horEl.value ? parseInt(String(horEl.value).trim(), 10) : NaN;
    if (Number.isFinite(horVal) && horVal >= 1 && horVal <= 1095) {
      extra += '&horizonteDias=' + encodeURIComponent(String(horVal));
    }
    var apEl = document.getElementById('filtro_shelf_apontado');
    var apVal = apEl && apEl.value ? String(apEl.value).trim() : 'todos';
    extra += '&apontado=' + encodeURIComponent(apVal || 'todos');
    return extra;
  }

  function formatDhApontado(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('pt-BR');
  }

  function formatValidadeApontado(iso) {
    var s = String(iso || '').trim();
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[3] + '/' + m[2] + '/' + m[1];
    return s;
  }

  function carregarListaApontados() {
    var extra = queryFiltros();
    return fetch(urlComQuery('/api/wms/relatorios/shelf-life/apontados?limit=200', extra), {
      headers: getAuthHeaders(),
    })
      .then(lerJsonResposta)
      .then(function (j) {
        var body = document.getElementById('wmsRelApontadosBody');
        if (!body) return;
        var list = (j && j.apontados) || [];
        if (!list.length) {
          body.innerHTML =
            '<tr><td colspan="8">' +
            esc(j && j.aviso ? j.aviso : 'Nenhuma linha apontada.') +
            '</td></tr>';
          return;
        }
        body.innerHTML = list
          .map(function (e) {
            var id = e.CD_APONTADO != null ? e.CD_APONTADO : '';
            var dono = (e.NM_DONO || '') + (e.CD_DONO != null ? ' (' + e.CD_DONO + ')' : '');
            return (
              '<tr>' +
              '<td>' +
              esc(formatDhApontado(e.DH_APONTADO)) +
              '</td><td>' +
              esc(dono) +
              '</td><td>' +
              esc(e.CODIGO_PRODUTO || '') +
              (e.NM_PRODUTO ? '<br/><span style="color:#64748b;font-size:11px;">' + esc(e.NM_PRODUTO) + '</span>' : '') +
              '</td><td>' +
              esc(e.LOTE || '—') +
              '</td><td>' +
              esc(formatValidadeApontado(e.VALIDADE)) +
              '</td><td>' +
              esc(e.SG_USER || '') +
              '</td><td>' +
              esc(e.ORIGEM || '') +
              '</td><td>' +
              '<button type="button" class="btn-filtro btn-filtro-limpar btn-desapontar-shelf" data-id="' +
              esc(String(id)) +
              '"><i class="bx bx-undo"></i> Desmarcar</button>' +
              '</td></tr>'
            );
          })
          .join('');
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao carregar apontados.', 'error');
      });
  }

  function marcarApontadosShelf() {
    return exigirDonoSePossivel().then(function (ok) {
      if (!ok) return;
      var apEl = document.getElementById('filtro_shelf_apontado');
      var apVal = apEl && apEl.value ? String(apEl.value).trim() : 'todos';
      var msg =
        apVal === 'nao'
          ? 'Marcar como apontadas as linhas atuais (só as ainda não apontadas, com os filtros da tela)?'
          : 'Marcar como apontadas as linhas da consulta atual (mesmos filtros + horizonte)?';
      return confirmarAcaoRelatorio(msg, {
        titulo: 'Marcar apontados',
        okLabel: 'Marcar',
        okDanger: false,
      }).then(function (ok2) {
        if (!ok2) return;
        showLoadingOverlay('Apontados', 'Gravando...', 'shelf-apontados');
        var extra = queryShelfApontadoExtra();
        return fetch(urlComQuery('/api/wms/relatorios/shelf-life/apontados', extra), {
          method: 'POST',
          headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
          body: JSON.stringify({ marcarFiltroAtual: true, modo: 'saldo' }),
        })
          .then(lerJsonResposta)
          .then(function (j) {
            var n = (j && j.marcadas) || 0;
            var ja = (j && j.jaAtivas) || 0;
            showMessage(
              'Apontadas: ' + n + (ja ? ' · já estavam: ' + ja : '') + '.',
              'success'
            );
            return carregarListaApontados();
          })
          .catch(function (err) {
            showMessage((err && err.message) || 'Erro ao marcar apontados.', 'error');
          })
          .finally(hideLoadingOverlay);
      });
    });
  }

  function desmarcarApontadoShelf(cd) {
    var id = parseInt(cd, 10);
    if (!Number.isFinite(id) || id <= 0) return;
    return confirmarAcaoRelatorio('Desmarcar esta linha? Ela volta a aparecer em «Só não apontados».', {
      titulo: 'Desmarcar',
      okLabel: 'Desmarcar',
      okDanger: true,
    }).then(function (ok) {
      if (!ok) return;
      return fetch(corrigirUrl('/api/wms/relatorios/shelf-life/apontados/desmarcar'), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()),
        body: JSON.stringify({ ids: [id] }),
      })
        .then(lerJsonResposta)
        .then(function () {
          showMessage('Linha desmarcada.', 'success');
          return carregarListaApontados();
        })
        .catch(function (err) {
          showMessage((err && err.message) || 'Erro ao desmarcar.', 'error');
        });
    });
  }

  function irParaModuloBaixas(payload) {
    try {
      if (payload) sessionStorage.setItem('wmsBaixaShelfImport', JSON.stringify(payload));
    } catch (e) {}
    if (window.parent && typeof window.parent.loadModuleContent === 'function') {
      window.parent.loadModuleContent('estoque-baixas');
    } else {
      showMessage('Abra pelo menu Gestão Estoque → Baixas / Perdas.', 'error');
    }
  }

  function montarPayloadShelfParaBaixa() {
    var donoEl = document.getElementById('filtro_cd_dono');
    var cdDono = donoEl && donoEl.value ? String(donoEl.value).trim() : '';
    if (!cdDono) return null;
    var apEl = document.getElementById('filtro_shelf_apontado');
    var dataRefEl = document.getElementById('filtro_shelf_data_referencia');
    var horEl = document.getElementById('filtro_shelf_horizonte_dias');
    return {
      cdDono: cdDono,
      modo: 'cobranca',
      somenteVencidos: true,
      apontado: apEl && apEl.value ? apEl.value : 'nao',
      dataReferencia: dataRefEl && dataRefEl.value ? dataRefEl.value : '',
      horizonteDias: horEl && horEl.value ? horEl.value : '',
      marcarApontados: true,
      autoImport: true,
    };
  }

  function irBaixaComShelfAtual() {
    var payload = montarPayloadShelfParaBaixa();
    if (!payload) {
      showMessage('Selecione o dono do estoque nos filtros antes de lançar a baixa.', 'error');
      return;
    }
    irParaModuloBaixas(payload);
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function showTab(tab) {
    var root = rootRelatorios();
    if (!root) return;
    root.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    root.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + tab);
    });
    var wrap = root.querySelector('#wmsRelPeriodoWrap');
    if (wrap) {
      var showPeriodo = tab === 'mov' || tab === 'dre' || tab === 'separacao';
      wrap.classList.toggle('visivel', showPeriodo);
      wrap.hidden = !showPeriodo;
      if (!showPeriodo) {
        var de = document.getElementById('filtro_dt_de');
        var ate = document.getElementById('filtro_dt_ate');
        if (de) de.value = '';
        if (ate) ate.value = '';
      }
    }
    /** Abas NF×OPL e Divergências usam filtros próprios; painel de produto fica oculto. */
    var filtrosBox = root.querySelector('#wmsRelFiltrosBox');
    var isDivergExp = tab === 'divergExp';
    var isNfOpl = tab === 'nfOpl';
    var isDemanda = tab === 'demanda';
    if (filtrosBox) filtrosBox.classList.toggle('is-hidden-tab', isDivergExp || isNfOpl || isDemanda);
    sincronizarDonoNasAbas('filtro_cd_dono');
    atualizarResumoFiltrosColapsados();
    if (tab === 'shelf') {
      carregarHistoricoEnvios();
      carregarListaApontados();
    }
    if (isDemanda) {
      prepararDemandaDia();
    }
  }

  /** Coleta filtros próprios do relatório de Divergências de Expedição. */
  function queryFiltrosDivergExp() {
    var partes = [];
    var dtIni = document.getElementById('divergExpDtIni');
    var dtFim = document.getElementById('divergExpDtFim');
    var conf = document.getElementById('divergExpConferente');
    var st = document.getElementById('divergExpStatus');
    var dono = document.getElementById('divergExpCdDono');
    var donoMaster = document.getElementById('filtro_cd_dono');
    var cdDonoVal =
      (donoMaster && String(donoMaster.value || '').trim() !== '' ? donoMaster.value : '') ||
      (dono && dono.value ? dono.value : '');
    var exibir = document.getElementById('divergExpExibir');
    if (dtIni && dtIni.value) partes.push('dataIni=' + encodeURIComponent(dtIni.value));
    if (dtFim && dtFim.value) partes.push('dataFim=' + encodeURIComponent(dtFim.value));
    if (conf && String(conf.value || '').trim() !== '') {
      partes.push('conferente=' + encodeURIComponent(String(conf.value).trim()));
    }
    if (st && st.value) partes.push('status=' + encodeURIComponent(st.value));
    if (exibir && exibir.value) partes.push('exibirCargas=' + encodeURIComponent(exibir.value));
    if (cdDonoVal) {
      partes.push('cdDono=' + encodeURIComponent(cdDonoVal));
      /** Nome do dono é só pra exibir no cabeçalho do relatório (rótulo). */
      var op =
        (donoMaster && donoMaster.value === cdDonoVal && donoMaster.options[donoMaster.selectedIndex]) ||
        (dono && dono.options[dono.selectedIndex]);
      var nome = op && op.getAttribute('data-nome');
      if (!nome && op) nome = op.textContent;
      if (nome) partes.push('nmDono=' + encodeURIComponent(nome));
    }
    return partes.length ? '?' + partes.join('&') : '';
  }

  /** Coleta filtros da aba NF × Separação. */
  function queryFiltrosNfOpl(fmt) {
    var partes = [];
    if (fmt === 'csv') partes.push('formato=csv');
    else if (fmt === 'html') partes.push('formato=html');
    var cdCarga = document.getElementById('nfOplCdCarga');
    var dtIni = document.getElementById('nfOplDtIni');
    var dtFim = document.getElementById('nfOplDtFim');
    var dono = document.getElementById('nfOplCdDono');
    var donoMaster = document.getElementById('filtro_cd_dono');
    var cdDonoVal =
      (donoMaster && String(donoMaster.value || '').trim() !== '' ? donoMaster.value : '') ||
      (dono && dono.value ? dono.value : '');
    var st = document.getElementById('nfOplStatus');
    var exibir = document.getElementById('nfOplExibir');
    var cod = document.getElementById('nfOplCodigo');
    var codMaster = document.getElementById('filtro_codigo_produto');
    var desc = document.getElementById('nfOplDescricao');
    var descMaster = document.getElementById('filtro_descricao_produto');
    var modo = document.getElementById('nfOplModo');
    var tipoDiv = document.getElementById('nfOplTipoDiv');
    if (cdCarga && String(cdCarga.value || '').trim() !== '') {
      partes.push('cdCarga=' + encodeURIComponent(String(cdCarga.value).trim()));
    }
    if (dtIni && dtIni.value) partes.push('dataIni=' + encodeURIComponent(dtIni.value));
    if (dtFim && dtFim.value) partes.push('dataFim=' + encodeURIComponent(dtFim.value));
    if (st && st.value) partes.push('status=' + encodeURIComponent(st.value));
    if (exibir && exibir.value) partes.push('exibirCargas=' + encodeURIComponent(exibir.value));
    var codVal =
      (cod && String(cod.value || '').trim()) ||
      (codMaster && String(codMaster.value || '').trim()) ||
      '';
    if (codVal) {
      partes.push('codigoProduto=' + encodeURIComponent(codVal));
    }
    var descVal =
      (desc && String(desc.value || '').trim()) ||
      (descMaster && String(descMaster.value || '').trim()) ||
      '';
    if (descVal) {
      partes.push('descricaoProduto=' + encodeURIComponent(descVal));
    }
    if (modo && modo.value) partes.push('modo=' + encodeURIComponent(modo.value));
    if (tipoDiv && tipoDiv.value) partes.push('tipoDivergencia=' + encodeURIComponent(tipoDiv.value));
    if (cdDonoVal) {
      partes.push('cdDono=' + encodeURIComponent(cdDonoVal));
      var op =
        (donoMaster && donoMaster.value === cdDonoVal && donoMaster.options[donoMaster.selectedIndex]) ||
        (dono && dono.options[dono.selectedIndex]);
      var nome = op && op.getAttribute('data-nome');
      if (!nome && op) nome = op.textContent;
      if (nome) partes.push('nmDono=' + encodeURIComponent(nome));
    }
    return partes.length ? '?' + partes.join('&') : '';
  }

  /** Gera comparativo NF × separação OPL. fmt: html | csv */
  function gerarRelatorioNfOpl(fmt) {
    var isHtml = fmt === 'html';
    var donoMaster = document.getElementById('filtro_cd_dono');
    var cdCargaEl = document.getElementById('nfOplCdCarga');
    var dtIniEl = document.getElementById('nfOplDtIni');
    var dtFimEl = document.getElementById('nfOplDtFim');
    var temCarga = cdCargaEl && String(cdCargaEl.value || '').trim() !== '';
    var temDono = donoMaster && String(donoMaster.value || '').trim() !== '';
    var temPeriodo =
      dtIniEl &&
      dtFimEl &&
      String(dtIniEl.value || '').trim() !== '' &&
      String(dtFimEl.value || '').trim() !== '';
    if (!temCarga && !temDono) {
      showMessage(
        'Selecione o dono do estoque (ou informe o nº da carga). Sem isso o relatório trava validando dezenas de cargas.',
        'error'
      );
      return Promise.resolve();
    }
    if (!temCarga && !temPeriodo) {
      showMessage(
        'Informe Data início e Data fim (ou o nº da carga). A comparação é ao vivo por carga — sem período fica lento demais.',
        'error'
      );
      return Promise.resolve();
    }
    var endpoint = corrigirUrl('/api/wms/relatorios/comparativo-nf-opl') + queryFiltrosNfOpl(fmt);
    var downloadName =
      (fmt === 'csv' && document.getElementById('nfOplModo') && document.getElementById('nfOplModo').value === 'sintetico'
        ? 'comparativo_nf_separacao_sintetico_'
        : 'comparativo_nf_separacao_analitico_') +
      new Date().toISOString().slice(0, 10) +
      '.csv';
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer =
      ctrl &&
      setTimeout(function () {
        try {
          ctrl.abort();
        } catch (_) {}
      }, 90000);
    showLoadingOverlay(
      'Relatório',
      'Comparando NF × separação...',
      'Validação ao vivo — use dono + período (ou nº da carga)'
    );
    return fetch(endpoint, { headers: getAuthHeaders(), signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = t || r.statusText || 'Erro ao gerar relatório.';
            try {
              var j = JSON.parse(t);
              if (j && j.error) msg = j.error;
            } catch (_) {}
            throw new Error(msg);
          });
        }
        return isHtml ? r.text() : r.blob();
      })
      .then(function (payload) {
        if (!isHtml) {
          var u = URL.createObjectURL(payload);
          var a = document.createElement('a');
          a.href = u;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(u);
            a.remove();
          }, 200);
          showMessage('CSV exportado (abra no Excel).', 'success');
          return;
        }
        var w = window.open('', '_blank');
        if (!w) {
          showMessage('Permita pop-up para abrir o relatório.', 'error');
          return;
        }
        w.document.open();
        w.document.write(payload);
        w.document.close();
        showMessage('Comparativo aberto — trate primeiro itens "NF sem separação".', 'success');
      })
      .catch(function (e) {
        var msg = (e && e.message) || 'Erro ao gerar comparativo NF × separação.';
        if (e && e.name === 'AbortError') {
          msg =
            'Tempo esgotado (90s). Reduza o período, selecione o dono e/ou filtre por código/nº da carga.';
        }
        showMessage(msg, 'error');
      })
      .finally(function () {
        if (timer) clearTimeout(timer);
        hideLoadingOverlay();
      });
  }

  /** Gera o relatório consolidado de divergências.
   *  fmt: 'html' (visualizar) | 'csv' (detalhado por divergência) | 'sku' (consolidado por SKU). */
  function gerarRelatorioDivergExp(fmt) {
    var endpoint, downloadName, isHtml = false;
    if (fmt === 'sku') {
      endpoint = '/api/wms/expedicao/relatorio-divergencias-sku.csv';
      downloadName = 'divergencias_expedicao_por_sku_' + new Date().toISOString().slice(0, 10) + '.csv';
    } else if (fmt === 'csv') {
      endpoint = '/api/wms/expedicao/relatorio-divergencias.csv';
      downloadName = 'divergencias_expedicao_consolidado_' + new Date().toISOString().slice(0, 10) + '.csv';
    } else {
      endpoint = '/api/wms/expedicao/relatorio-divergencias';
      isHtml = true;
    }
    var url = corrigirUrl(endpoint) + queryFiltrosDivergExp();
    showLoadingOverlay('Relatório', 'Gerando divergências...', 'expedição');
    return fetch(url, { headers: getAuthHeaders() })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = t || r.statusText || 'Erro ao gerar relatório.';
            try {
              var j = JSON.parse(t);
              if (j && j.error) msg = j.error;
            } catch (_) {}
            throw new Error(msg);
          });
        }
        return isHtml ? r.text() : r.blob();
      })
      .then(function (payload) {
        if (!isHtml) {
          var u = URL.createObjectURL(payload);
          var a = document.createElement('a');
          a.href = u;
          a.download = downloadName;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(u);
            a.remove();
          }, 200);
          showMessage('CSV exportado.', 'success');
          return;
        }
        var w = window.open('', '_blank');
        if (!w) {
          showMessage('Permita pop-up para abrir o relatório.', 'error');
          return;
        }
        w.document.open();
        w.document.write(payload);
        w.document.close();
        showMessage('Relatório aberto para impressão.', 'success');
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao gerar relatório de divergências.', 'error');
      })
      .finally(hideLoadingOverlay);
  }

  /** Auditoria de saúde — varre o tenant inteiro (ou um dono) e abre um HTML
   *  imprimível com todas as NF-e encerradas em branco, SKUs "só mov.",
   *  saldos negativos, NF-e abandonadas e cadastros duplicados.
   *
   *  Dono é OPCIONAL: ausente = tenant inteiro (modo "varredura geral").
   *  Recomendado quando o usuário suspeita que tem várias NFs furadas. */
  function gerarAuditoriaSaude() {
    var sel = document.getElementById('filtro_cd_dono');
    var cdDono = sel && sel.value ? sel.value : '';
    var diasEl = document.getElementById('filtro_saude_dias');
    var dias = diasEl && diasEl.value ? parseInt(diasEl.value, 10) : 7;
    var qs = [];
    if (cdDono) qs.push('cdDono=' + encodeURIComponent(cdDono));
    if (Number.isFinite(dias) && dias > 0) qs.push('dias=' + dias);
    var u = corrigirUrl('/api/wms/auditoria-saude.html') + (qs.length ? '?' + qs.join('&') : '');
    showLoadingOverlay('Auditoria', 'Varrendo o tenant...', 'NFs encerradas, SKUs, cadastros duplicados.');
    return fetch(u, { headers: getAuthHeaders() })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            throw new Error(t || r.statusText);
          });
        }
        return r.text();
      })
      .then(function (html) {
        var w = window.open('', '_blank');
        if (!w) {
          showMessage('Permita pop-up para abrir a auditoria.', 'error');
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        showMessage('Auditoria gerada. Confira os blocos vermelhos primeiro.', 'success');
      })
      .catch(function (e) {
        showMessage((e && e.message) || 'Erro ao gerar auditoria.', 'error');
      })
      .finally(function () {
        hideLoadingOverlay();
      });
  }

  function isoHojeMais(dias) {
    var d = new Date();
    d.setDate(d.getDate() + dias);
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function prepararDemandaDia() {
    var de = document.getElementById('demandaDtDe');
    var ate = document.getElementById('demandaDtAte');
    if (de && !de.value) de.value = isoHojeMais(0);
    if (ate && !ate.value) ate.value = isoHojeMais(6);
    if (!prepararDemandaDia.rotasOk) {
      prepararDemandaDia.rotasOk = true;
      carregarRotasDemanda();
    }
  }

  function carregarRotasDemanda() {
    var sel = document.getElementById('demandaRota');
    if (!sel) return;
    fetch(corrigirUrl('/api/wms/relatorios/demanda-dia/rotas'), { headers: getAuthHeaders() })
      .then(lerJsonResposta)
      .then(function (data) {
        var atual = sel.value;
        var rotas = data && Array.isArray(data.rotas) ? data.rotas : [];
        sel.innerHTML = '<option value="">Todas</option><option value="sem">Sem rota</option>';
        rotas.forEach(function (nr) {
          var o = document.createElement('option');
          o.value = String(nr);
          o.textContent = 'Rota ' + nr;
          sel.appendChild(o);
        });
        if (atual) sel.value = atual;
      })
      .catch(function () {});
  }

  function queryDemandaDia() {
    var de = document.getElementById('demandaDtDe');
    var ate = document.getElementById('demandaDtAte');
    var sit = document.getElementById('demandaSituacao');
    var rota = document.getElementById('demandaRota');
    var dono = document.getElementById('filtro_cd_dono');
    if (!de || !de.value || !ate || !ate.value) {
      throw new Error('Informe o período da data de entrega.');
    }
    var partes = [
      'dtDe=' + encodeURIComponent(de.value),
      'dtAte=' + encodeURIComponent(ate.value),
    ];
    if (sit && sit.value) partes.push('situacao=' + encodeURIComponent(sit.value));
    if (rota && String(rota.value || '').trim() !== '') {
      partes.push('nrRota=' + encodeURIComponent(String(rota.value).trim()));
    }
    if (dono && String(dono.value || '').trim() !== '') {
      partes.push('cdDono=' + encodeURIComponent(String(dono.value).trim()));
    }
    return partes.join('&');
  }

  function fmtKgDemanda(n) {
    if (n == null || n === '') return '—';
    var x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' kg';
  }

  function fmtBrlDemanda(n) {
    if (n == null || n === '') return '—';
    var x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtKmDemanda(n) {
    if (n == null || n === '') return '—';
    var x = Number(n);
    if (!Number.isFinite(x)) return '—';
    return x.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km';
  }

  function renderDemandaDia(data) {
    var box = document.getElementById('demandaDiaResultado');
    if (!box) return;
    var dias = (data && data.dias) || [];
    var tot = (data && data.totais) || {};
    var html = '';
    if (data && data.filtros && data.filtros.periodoLabel) {
      html += '<p class="hint">Período ' + esc(data.filtros.periodoLabel) +
        ' · ' + esc(data.filtros.situacaoLabel || '') +
        ' · ' + esc(data.filtros.rotaLabel || '') +
        ' · ' + esc(data.filtros.donoLabel || '') + '</p>';
    }
    html += '<div class="wms-demanda-kpis">';
    html += '<span><strong>' + esc(tot.dias != null ? tot.dias : dias.length) + '</strong> dias</span>';
    html += '<span><strong>' + esc(tot.cargas != null ? tot.cargas : 0) + '</strong> cargas</span>';
    html += '<span><strong>' + esc(tot.entregas != null ? tot.entregas : 0) + '</strong> entregas</span>';
    html += '<span>Peso frio <strong>' + fmtKgDemanda(tot.pesoFrio) + '</strong></span>';
    html += '<span>Receita <strong>' + fmtBrlDemanda(tot.receita) + '</strong></span>';
    html += '</div>';
    if (tot.leitura && tot.leitura.texto) {
      html += '<p class="wms-demanda-abertura ' + esc(tot.leitura.tom) + '">' + esc(tot.leitura.texto) + '</p>';
    }
    if (data && data.avisos && data.avisos.length) {
      html += '<ul class="wms-demanda-avisos">';
      data.avisos.forEach(function (a) {
        html += '<li>' + esc(a) + '</li>';
      });
      html += '</ul>';
    }
    if (!dias.length) {
      html += '<p class="hint">Nenhuma carga com entrega nesse recorte.</p>';
      box.innerHTML = html;
      return;
    }
    html += '<div class="wms-demanda-wrap"><table class="wms-demanda-table"><thead><tr>';
    html += '<th>Data</th><th class="num">Carga</th><th>Situação</th><th>Rotas</th>';
    html += '<th class="num">Entregas</th><th class="num">Km</th>';
    html += '<th class="num">Peso frio</th><th class="num">Peso seco</th><th class="num">Peso total</th>';
    html += '<th class="num">Nota frio</th><th class="num">Nota seco</th><th class="num">Nota total</th>';
    html += '<th class="num">Receita</th>';
    html += '</tr></thead><tbody>';
    dias.forEach(function (dia) {
      (dia.cargas || []).forEach(function (c) {
        html += '<tr>';
        html += '<td>' + esc(dia.dataBr) + '</td>';
        html += '<td class="num">' + esc(c.cdCarga) + '</td>';
        html += '<td>' + esc(c.situacao) + '</td>';
        html += '<td>' + esc(c.rotasTexto);
        if (c.leitura && c.leitura.texto) {
          html += '<div class="wms-demanda-parte ' + esc(c.leitura.tom) + '">' + esc(c.leitura.texto) + '</div>';
        }
        html += '</td>';
        html += '<td class="num">' + esc(c.entregas) + '</td>';
        html += '<td class="num">' + fmtKmDemanda(c.km) + '</td>';
        html += '<td class="num">' + fmtKgDemanda(c.pesoFrio) + '</td>';
        html += '<td class="num">' + fmtKgDemanda(c.pesoSeco) + '</td>';
        html += '<td class="num">' + fmtKgDemanda(c.pesoTotal) + '</td>';
        html += '<td class="num">' + fmtBrlDemanda(c.valorFrio) + '</td>';
        html += '<td class="num">' + fmtBrlDemanda(c.valorSeco) + '</td>';
        html += '<td class="num">' + fmtBrlDemanda(c.valorTotal) + '</td>';
        html += '<td class="num">' + fmtBrlDemanda(c.receita) + '</td>';
        html += '</tr>';
      });
      var t = dia.total || {};
      var rotasTxt = (t.qtdRotas || 0) + ((t.qtdRotas || 0) === 1 ? ' rota' : ' rotas');
      html += '<tr class="total">';
      html += '<td>Total ' + esc(dia.dataBr) + '</td>';
      html += '<td>' + esc((t.qtdCargas || 0) + ' cargas') + '</td>';
      html += '<td></td>';
      html += '<td>' + esc(rotasTxt) + '</td>';
      html += '<td class="num">' + esc(t.entregas || 0) + '</td>';
      html += '<td class="num">' + fmtKmDemanda(t.km) + '</td>';
      html += '<td class="num">' + fmtKgDemanda(t.pesoFrio) + '</td>';
      html += '<td class="num">' + fmtKgDemanda(t.pesoSeco) + '</td>';
      html += '<td class="num">' + fmtKgDemanda(t.pesoTotal) + '</td>';
      html += '<td class="num">' + fmtBrlDemanda(t.valorFrio) + '</td>';
      html += '<td class="num">' + fmtBrlDemanda(t.valorSeco) + '</td>';
      html += '<td class="num">' + fmtBrlDemanda(t.valorTotal) + '</td>';
      html += '<td class="num">' + fmtBrlDemanda(t.receita) + '</td>';
      html += '</tr>';
      if (dia.leitura && dia.leitura.texto) {
        html += '<tr class="leitura ' + esc(dia.leitura.tom) + '"><td colspan="13">' + esc(dia.leitura.texto) + '</td></tr>';
      }
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
  }

  function consultarDemandaDia() {
    var extra;
    try {
      extra = queryDemandaDia();
    } catch (err) {
      showMessage(err.message, 'error');
      return;
    }
    exigirDonoSePossivel().then(function (ok) {
      if (!ok) return;
      var u = urlComQuery('/api/wms/relatorios/demanda-dia', extra);
      showLoadingOverlay('Demanda do dia', 'Consultando...', 'Cargas por data de entrega');
      fetchRelatorioComTimeout(u)
        .then(lerJsonResposta)
        .then(function (data) {
          hideLoadingOverlay();
          renderDemandaDia(data);
          showMessage('Demanda do dia atualizada.', 'success');
        })
        .catch(function (e) {
          hideLoadingOverlay();
          showMessage((e && e.message) || 'Erro ao consultar a demanda do dia.', 'error');
        });
    });
  }

  function exportarDemandaDia(fmt) {
    var extra;
    try {
      extra = queryDemandaDia();
    } catch (err) {
      showMessage(err.message, 'error');
      return;
    }
    exigirDonoSePossivel().then(function (ok) {
      if (!ok) return;
      var u = urlComQuery('/api/wms/relatorios/demanda-dia?formato=' + encodeURIComponent(fmt), extra);
      showLoadingOverlay('Demanda do dia', fmt === 'csv' ? 'Exportando...' : 'Gerando...', fmt);
      fetchRelatorioComTimeout(u)
        .then(function (r) {
          if (!r.ok) return lerErroResposta(r);
          if (fmt === 'html') return r.text();
          return r.blob();
        })
        .then(function (payload) {
          hideLoadingOverlay();
          if (fmt === 'html') {
            var w = window.open('', '_blank');
            if (!w) {
              showMessage('Permita pop-up para abrir o relatório.', 'error');
              return;
            }
            w.document.open();
            w.document.write(payload);
            w.document.close();
            showMessage('Relatório aberto para impressão.', 'success');
            return;
          }
          var url = URL.createObjectURL(payload);
          var a = document.createElement('a');
          a.href = url;
          a.download = 'wms-demanda-dia.csv';
          a.click();
          URL.revokeObjectURL(url);
          showMessage('Download iniciado.', 'success');
        })
        .catch(function (e) {
          hideLoadingOverlay();
          showMessage((e && e.message) || 'Erro ao exportar a demanda do dia.', 'error');
        });
    });
  }

  function bindEventosModulo(root) {
    if (!root || root.dataset.wmsRelBound === '1') return;
    root.dataset.wmsRelBound = '1';
    root.addEventListener('click', function (e) {
      var tabBtn = e.target.closest('.tab-btn');
      if (tabBtn && root.contains(tabBtn)) {
        showTab(tabBtn.getAttribute('data-tab'));
        return;
      }
      if (e.target.closest('#btnDemandaConsultar')) {
        consultarDemandaDia();
        return;
      }
      if (e.target.closest('#btnDemandaCsv')) {
        exportarDemandaDia('csv');
        return;
      }
      if (e.target.closest('#btnDemandaHtml')) {
        exportarDemandaDia('html');
        return;
      }
      var relBtn = e.target.closest('[data-rel][data-fmt]');
      if (relBtn && root.contains(relBtn)) {
        var relKey = relBtn.getAttribute('data-rel');
        if (relKey === 'auditoria-saude') {
          gerarAuditoriaSaude();
        } else {
          gerarRelatorio(relKey, relBtn.getAttribute('data-fmt'), {
            modo: relBtn.getAttribute('data-modo') || '',
            somenteVencidos: relBtn.getAttribute('data-somente-vencidos') === '1',
          });
        }
        return;
      }
      if (e.target.closest('#btnAtualizarEnviosShelf')) {
        carregarHistoricoEnvios();
        return;
      }
      if (e.target.closest('#btnAtualizarApontadosShelf')) {
        carregarListaApontados();
        return;
      }
      if (e.target.closest('#btnMarcarApontadosShelf')) {
        marcarApontadosShelf();
        return;
      }
      if (e.target.closest('#btnIrModuloBaixas')) {
        irParaModuloBaixas();
        return;
      }
      if (e.target.closest('#btnIrBaixaComShelf')) {
        irBaixaComShelfAtual();
        return;
      }
      var btnDes = e.target.closest('.btn-desapontar-shelf');
      if (btnDes && root.contains(btnDes)) {
        desmarcarApontadoShelf(btnDes.getAttribute('data-id'));
        return;
      }
      if (e.target.closest('#btnConsTodos')) {
        alternarMarcarTodosConservacao();
        return;
      }
      if (e.target.closest('#btnToggleFiltrosComuns')) {
        toggleFiltrosComuns();
        return;
      }
      if (e.target.closest('#btnLimparFiltrosRel')) {
        limparFiltrosRelatorio();
        return;
      }
      if (e.target.closest('#btnEtiquetasSaldo')) {
        gerarEtiquetasSaldo();
        return;
      }
      if (e.target.closest('#btnGerarNfOplHtml')) {
        gerarRelatorioNfOpl('html');
        return;
      }
      if (e.target.closest('#btnGerarNfOplCsv')) {
        gerarRelatorioNfOpl('csv');
        return;
      }
      if (e.target.closest('#btnGerarDivergExpHtml')) {
        gerarRelatorioDivergExp('html');
        return;
      }
      if (e.target.closest('#btnGerarDivergExpCsv')) {
        gerarRelatorioDivergExp('csv');
        return;
      }
      if (e.target.closest('#btnGerarDivergExpSkuCsv')) {
        gerarRelatorioDivergExp('sku');
        return;
      }
    });
    root.addEventListener('change', function (e) {
      if (e.target.matches('#wmsRelConservacaoGrid input[type="checkbox"]')) {
        refreshConservacaoChips();
        atualizarResumoFiltrosColapsados();
      }
    });
  }

  function init() {
    limparResiduosModulo();
    var root = rootRelatorios();
    if (!root) return;
    bindEventosModulo(root);
    refreshConservacaoChips();
    initFiltrosComunsUi();
    carregarDonos();
    showTab('saldo');
    /** Combos Grupo/Categoria: carrega a lista do cadastro WMS (mesmo das Cadastros). */
    setTimeout(function () {
      iniciarCombosGrupoCategoriaRel();
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
