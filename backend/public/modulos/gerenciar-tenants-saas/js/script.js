(function () {
  var catalogoModulos = [];
  var planosList = [];
  var planosPorId = {};
  var planosModulosResumo = {};
  var editandoTenant = null;
  var editandoModulo = null;
  var editandoPlano = null;
  var salvandoCliente = false;
  var salvandoModulo = false;
  var salvandoPlano = false;
  var decidindoPedido = false;
  var clientesPorId = {};
  var catalogoPorCodigo = {};
  var gridCatalogo = null;
  var gridPlanos = null;
  var gridClientes = null;
  var gridPedidos = null;

  /** Só toast (padrão Usuários). Nunca pinta texto verde/vermelho no meio da tela. */
  function toastMsg(text, type) {
    var t = text == null ? '' : String(text).trim();
    if (!t) return;
    if (/…$|\.\.\.$/.test(t) || /^(Salvando|Carregando|Excluindo|Criando|Removendo)/i.test(t)) return;
    var kind =
      type === false || type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'success';
    if (typeof window.showMessage === 'function') {
      window.showMessage(t, kind, false);
      return;
    }
    if (typeof showMessage === 'function') {
      showMessage(t, kind, false);
    }
  }

  function setGridCount(spanId, n) {
    var el = document.getElementById(spanId);
    if (el) el.textContent = String(n) + ' registro(s) encontrado(s)';
  }

  function apiPrefix() {
    var pn = window.location.pathname || '';
    return pn.indexOf('/cargas') !== -1 ? '/cargas' : '';
  }

  function getAuthJsonHeaders() {
    var h = { 'Content-Type': 'application/json' };
    var token = localStorage.getItem('token');
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function showOverlay() {
    var el = document.getElementById('saasLoadingOverlay');
    if (el) el.classList.add('show');
  }

  function hideOverlay() {
    var el = document.getElementById('saasLoadingOverlay');
    if (el) el.classList.remove('show');
  }

  /** Legado: limpa o div e manda feedback só no toast (ignora “Salvando…” etc.). */
  function showMsg(elId, text, ok) {
    var el = document.getElementById(elId);
    if (el) {
      el.style.display = 'none';
      el.textContent = '';
      el.className = 'saas-msg';
    }
    var t = text == null ? '' : String(text).trim();
    if (!t) return;
    if (/…$|\.\.\.$/.test(t) || /^(Salvando|Carregando|Excluindo|Criando|Removendo)/i.test(t)) return;
    toastMsg(t, ok ? 'success' : 'error');
  }

  function tabSwitch(name) {
    document.querySelectorAll('.saas-op-container .tab-btn').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === name);
    });
    document.querySelectorAll('.saas-op-container .tab-content').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  }

  document.querySelectorAll('.saas-op-container .tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-tab');
      tabSwitch(name);
      if (name === 'pedidos') loadPedidos();
      if (name === 'catalogo') loadCatalog();
      if (name === 'planos') loadPlanosPanel();
      if (name === 'clientes') loadClientesPanel();
      if (name === 'override') loadTenantsOverride();
      if (name === 'limpeza') carregarLimpeza();
    });
  });

  function labelModulo(cod) {
    var c = String(cod || '');
    for (var i = 0; i < catalogoModulos.length; i++) {
      var m = catalogoModulos[i];
      var code = m.CODIGO || m.codigo;
      if (String(code) === c) return m.NM_EXIBICAO || m.nm_exibicao || c;
    }
    return c;
  }

  async function loadCatalog() {
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ao carregar catálogo.');
      catalogoModulos = data.modulos || [];
      renderCatalogTable();
    } catch (e) {
      setGridCount('catalogoGridCountText', 0);
      var gCat = document.getElementById('catalogoGrid');
      if (gCat) gCat.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro') + '</p>';
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  function normalizeCatalogoRow(m) {
    var cod = String(m.CODIGO || m.codigo || '');
    return {
      CODIGO: cod,
      NM_EXIBICAO: m.NM_EXIBICAO || m.nm_exibicao || '',
      ORDEM: m.ORDEM != null ? m.ORDEM : m.ordem,
      FGACTIVE: m.FGACTIVE || m.fgactive || 'S',
      _raw: m,
    };
  }

  function initGridCatalogo() {
    if (gridCatalogo || typeof window.GridEditor === 'undefined') return gridCatalogo;
    gridCatalogo = new window.GridEditor({
      container: '#catalogoGrid',
      columns: [
        { field: 'CODIGO', header: 'Código', editable: false, isId: true, width: '140px' },
        { field: 'NM_EXIBICAO', header: 'Nome', editable: false },
        { field: 'ORDEM', header: 'Ordem', editable: false, width: '90px', align: 'right' },
        {
          field: 'FGACTIVE',
          header: 'Ativo',
          editable: false,
          width: '110px',
          format: function (val) {
            return val === 'S' ? '✓ Sim' : '✗ Não';
          },
        },
      ],
      onBeforeEdit: function (id) {
        abrirEdicaoModulo(catalogoPorCodigo[id] || { CODIGO: id });
        return false;
      },
      onDelete: function (id) {
        confirmExcluirModuloCatalogo(id).then(function (ok) {
          if (ok) deleteModuloRow(id);
        });
      },
    });
    return gridCatalogo;
  }

  function renderCatalogTable() {
    catalogoPorCodigo = {};
    var rows = (catalogoModulos || []).map(function (m) {
      var row = normalizeCatalogoRow(m);
      catalogoPorCodigo[row.CODIGO] = m;
      return row;
    });
    setGridCount('catalogoGridCountText', rows.length);
    var wrap = document.getElementById('catalogoGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">Nenhum módulo. Use Novo ou rode o script SQL do catálogo.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    initGridCatalogo();
    gridCatalogo.render(rows);
  }

  function fecharModuloModal() {
    var modal = document.getElementById('saasModuloModal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.style.display = 'none';
    }
  }

  function abrirModuloModal() {
    var modal = document.getElementById('saasModuloModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('is-open');
  }

  function limparFormularioModulo() {
    editandoModulo = null;
    setCampo('modCod', '');
    setCampo('modNm', '');
    setCampo('modOrd', '0');
    setCampo('modFg', 'S');
    var cod = document.getElementById('modCod');
    if (cod) cod.readOnly = false;
    var titulo = document.getElementById('saasModuloModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-plus-circle"></i> Novo módulo';
    showMsg('msgModuloModal', '', true);
  }

  function abrirNovoModulo() {
    limparFormularioModulo();
    abrirModuloModal();
    var foc = document.getElementById('modCod');
    if (foc) foc.focus();
  }

  function abrirEdicaoModulo(m) {
    if (!m) return;
    limparFormularioModulo();
    editandoModulo = String(m.CODIGO || m.codigo || '');
    setCampo('modCod', editandoModulo);
    var cod = document.getElementById('modCod');
    if (cod) cod.readOnly = true;
    setCampo('modNm', m.NM_EXIBICAO || m.nm_exibicao || '');
    setCampo('modOrd', m.ORDEM != null ? m.ORDEM : m.ordem != null ? m.ordem : 0);
    setCampo('modFg', m.FGACTIVE || m.fgactive || 'S');
    var titulo = document.getElementById('saasModuloModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-edit"></i> Editar módulo';
    abrirModuloModal();
    var foc = document.getElementById('modNm');
    if (foc) foc.focus();
  }

  async function salvarModuloDoModal() {
    if (salvandoModulo) return;
    var cod = valorCampo('modCod');
    var nm = valorCampo('modNm');
    var ord = valorCampo('modOrd') || '0';
    var fg = valorCampo('modFg') || 'S';
    if (!cod) {
      showMsg('msgModuloModal', 'Informe o código.', false);
      return;
    }
    if (!nm) {
      showMsg('msgModuloModal', 'Informe o nome na tela.', false);
      return;
    }
    salvandoModulo = true;
    showMsg('msgModuloModal', 'Salvando…', true);
    try {
      if (editandoModulo) {
        await saveModuloRow(editandoModulo, nm, ord, fg);
        fecharModuloModal();
        toastMsg('Módulo atualizado.', 'success');
      } else {
        var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', {
          method: 'POST',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify({ codigo: cod, nm_exibicao: nm, ordem: ord }),
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro');
        if (fg === 'N') {
          await saveModuloRow(cod, nm, ord, 'N');
        } else {
          await loadCatalog();
        }
        fecharModuloModal();
        toastMsg('Módulo cadastrado.', 'success');
      }
    } catch (e) {
      showMsg('msgModuloModal', e.message || 'Erro', false);
    } finally {
      salvandoModulo = false;
    }
  }

  function escapeHtml(s) {
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  /** Modal de confirmação reutilizável (mesmo padrão visual do catálogo). */
  function saasConfirmModal(opts) {
    var modal = document.getElementById('confirmModal');
    var titleEl = document.getElementById('saasConfirmTitulo');
    var modalMessage = document.getElementById('modalMessage');
    var confirmYes = document.getElementById('confirmYes');
    var confirmNo = document.getElementById('confirmNo');
    var plainFallback = opts.plainFallback || '';
    if (!modal || !modalMessage || !confirmYes || !confirmNo || !titleEl) {
      if (typeof window.confirmPadrao === 'function') {
        return window.confirmPadrao(plainFallback || '', {
          title: opts.title || 'Confirmar',
          danger: !opts.confirmClass || /danger/i.test(opts.confirmClass),
          confirmText: 'OK',
          cancelText: 'Cancelar',
        });
      }
      return Promise.resolve(window.confirm(plainFallback || ''));
    }
    titleEl.textContent = opts.title || 'Confirmar';
    modalMessage.innerHTML = opts.html || '';
    var newYes = confirmYes.cloneNode(true);
    var newNo = confirmNo.cloneNode(true);
    newYes.className = opts.confirmClass || 'btn-filtro btn-filtro-danger';
    newYes.innerHTML = opts.confirmHtml != null ? opts.confirmHtml : '<i class="bx bx-check"></i> OK';
    newNo.className = 'btn-filtro btn-filtro-limpar';
    newNo.innerHTML = opts.cancelHtml != null ? opts.cancelHtml : '<i class="bx bx-x"></i> Cancelar';
    newNo.style.display = opts.hideCancel ? 'none' : '';
    if (confirmYes.parentNode) {
      confirmYes.parentNode.replaceChild(newYes, confirmYes);
      confirmNo.parentNode.replaceChild(newNo, confirmNo);
    }
    modal.style.display = 'block';
    return new Promise(function (resolve) {
      function fechar(aceitou) {
        modal.style.display = 'none';
        newNo.style.display = '';
        resolve(aceitou);
      }
      newYes.addEventListener('click', function () {
        if (typeof opts.beforeConfirm !== 'function') {
          fechar(true);
          return;
        }
        Promise.resolve(opts.beforeConfirm()).then(function (ok) {
          if (ok) fechar(true);
        });
      });
      newNo.addEventListener(
        'click',
        function () {
          fechar(false);
        },
        { once: true }
      );
    });
  }

  function confirmExcluirModuloCatalogo(cod) {
    var escCod = escapeHtml(String(cod));
    return saasConfirmModal({
      title: 'Excluir módulo do catálogo',
      html:
        '<p><strong>Excluir o módulo <code>' +
        escCod +
        '</code> do catálogo?</strong></p>' +
        '<ul>' +
        '<li>Sai dos planos e overrides (vínculos automáticos).</li>' +
        '<li>Limpa a chave em Tipos de Atividade, se estiver usando.</li>' +
        '<li>Não desfaz: confirme se nenhuma rota da API ainda exige esta chave.</li>' +
        '</ul>' +
        '<p>Continuar?</p>',
      plainFallback:
        'Excluir o módulo "' +
        cod +
        '" do catálogo? Ver impactos em planos, overrides e Tipos de Atividade.',
      confirmHtml: '<i class="bx bx-trash"></i> Excluir',
      confirmClass: 'btn-filtro btn-filtro-danger',
    });
  }

  async function saveModuloRow(codigo, nm, ord, fg) {
    var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo/' + encodeURIComponent(codigo), {
      method: 'PUT',
      headers: getAuthJsonHeaders(),
      body: JSON.stringify({ nm_exibicao: nm, ordem: ord, fgactive: fg }),
    });
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    await loadCatalog();
    return data;
  }

  async function deleteModuloRow(codigo) {
    toastMsg('Excluindo…', 'warning');
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo/' + encodeURIComponent(codigo), {
        method: 'DELETE',
        headers: getAuthJsonHeaders(),
      });
      var data = {};
      var ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
      if (ct.indexOf('application/json') !== -1) {
        try {
          data = await r.json();
        } catch (parseErr) {
          data = {};
        }
      } else {
        try {
          var txt = await r.text();
          if (txt && txt.indexOf('{') === 0) data = JSON.parse(txt);
        } catch (e2) {
          data = {};
        }
      }
      if (!r.ok) {
        var msg =
          (data && data.error) ||
          (r.status === 409
            ? 'Não foi possível excluir: ainda há referências a este módulo no banco.'
            : r.status === 404
              ? 'Módulo não encontrado.'
              : r.status === 503
                ? 'Estrutura SaaS incompleta no banco de dados.'
                : 'Erro ao excluir (' + r.status + ').');
        throw new Error(msg);
      }
      toastMsg('Módulo excluído do catálogo.', 'success');
      await loadCatalog();
    } catch (e) {
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  var btnNovoModulo = document.getElementById('btnNovoModulo');
  if (btnNovoModulo) {
    btnNovoModulo.addEventListener('click', function () {
      abrirNovoModulo();
    });
  }
  var btnSalvarModulo = document.getElementById('btnSalvarModulo');
  if (btnSalvarModulo) {
    btnSalvarModulo.addEventListener('click', function () {
      salvarModuloDoModal();
    });
  }
  var btnCancelModulo = document.getElementById('btnCancelModulo');
  if (btnCancelModulo) {
    btnCancelModulo.addEventListener('click', function () {
      fecharModuloModal();
    });
  }
  var saasModuloModalX = document.getElementById('saasModuloModalX');
  if (saasModuloModalX) {
    saasModuloModalX.addEventListener('click', function () {
      fecharModuloModal();
    });
  }
  var saasModuloModal = document.getElementById('saasModuloModal');
  if (saasModuloModal) {
    saasModuloModal.addEventListener('click', function (ev) {
      if (ev.target === saasModuloModal) fecharModuloModal();
    });
  }

  function formatLimitePlano(v) {
    return v != null && v !== '' ? String(v) : '∞';
  }

  function syncSelectPlanosCliente() {
    var selN = document.getElementById('newClientePlano');
    if (!selN) return;
    var current = selN.value;
    selN.innerHTML = '';
    if (!planosList.length) {
      selN.innerHTML = '<option value="">Nenhum plano</option>';
      return;
    }
    planosList.forEach(function (p) {
      var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
      var nm = p.NM_PLANO || p.nm_plano || cd;
      var o = document.createElement('option');
      o.value = String(cd);
      o.textContent = nm;
      selN.appendChild(o);
    });
    if (current) {
      try {
        if (selN.querySelector('option[value="' + String(current).replace(/"/g, '') + '"]')) {
          selN.value = current;
        }
      } catch (eSel) { /* ignore */ }
    }
  }

  async function fetchModulosDoPlano(cdPlano) {
    var r = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cdPlano) + '/modulos', {
      headers: getAuthJsonHeaders(),
    });
    var data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ao carregar módulos do plano.');
    return data.modulos || [];
  }

  async function ensureCatalogoModulos() {
    if (catalogoModulos.length) return;
    var r0 = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
    var d0 = await r0.json();
    catalogoModulos = d0.modulos || [];
  }

  function renderPlanoModulosChecks(incluidos) {
    var grid = document.getElementById('planoModulosGrid');
    if (!grid) return;
    incluidos = incluidos || {};
    if (!catalogoModulos.length) {
      grid.innerHTML = '<p class="saas-op-info">Nenhum módulo no catálogo.</p>';
      return;
    }
    grid.innerHTML = catalogoModulos
      .map(function (m) {
        var cod = m.CODIGO || m.codigo;
        var nm = m.NM_EXIBICAO || m.nm_exibicao || cod;
        var on = incluidos[String(cod)] ? ' checked' : '';
        var cattr = String(cod).replace(/"/g, '&quot;');
        return (
          '<label class="saas-modulo-chip">' +
          '<input type="checkbox" data-plano-mod="' +
          cattr +
          '"' +
          on +
          ' />' +
          '<span class="saas-modulo-chip-text">' +
          '<span class="saas-modulo-chip-name">' +
          escapeHtml(String(nm)) +
          '</span>' +
          '<span class="saas-modulo-chip-code">' +
          escapeHtml(String(cod)) +
          '</span></span></label>'
        );
      })
      .join('');
  }

  function codigosModulosMarcados() {
    var codigos = [];
    document.querySelectorAll('#planoModulosGrid input[data-plano-mod]').forEach(function (inp) {
      if (inp.checked) codigos.push(inp.getAttribute('data-plano-mod'));
    });
    return codigos;
  }

  function parseLimiteCampo(raw, label) {
    var t = raw == null ? '' : String(raw).trim();
    if (t === '') return { value: null };
    var n = parseInt(t, 10);
    if (!Number.isFinite(n) || n < 1) {
      return { error: 'Informe um número válido em ' + label + ' ou deixe vazio para ilimitado.' };
    }
    return { value: n };
  }

  function normalizePlanoRow(p) {
    var cd = String(p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano);
    var maxA = p.MAX_ASSENTOS_USUARIOS != null ? p.MAX_ASSENTOS_USUARIOS : p.max_assentos_usuarios;
    var maxS = p.MAX_SESSOES_SIMULTANEAS != null ? p.MAX_SESSOES_SIMULTANEAS : p.max_sessoes_simultaneas;
    var mods = planosModulosResumo[cd] || [];
    return {
      CD_PLANO: cd,
      NM_PLANO: p.NM_PLANO || p.nm_plano || cd,
      DS_PLANO: p.DS_PLANO || p.ds_plano || '',
      MAX_ASSENTOS_LABEL: maxA != null && maxA !== '' ? String(maxA) : '∞',
      MAX_SESSOES_LABEL: maxS != null && maxS !== '' ? String(maxS) : '∞',
      MODULOS_TXT: mods.length ? mods.join(', ') : '—',
      _raw: p,
    };
  }

  function initGridPlanos() {
    if (gridPlanos || typeof window.GridEditor === 'undefined') return gridPlanos;
    gridPlanos = new window.GridEditor({
      container: '#planosGrid',
      columns: [
        { field: 'CD_PLANO', header: 'ID', editable: false, isId: true, hidden: true },
        { field: 'NM_PLANO', header: 'Nome', editable: false },
        { field: 'DS_PLANO', header: 'Descrição', editable: false },
        { field: 'MAX_ASSENTOS_LABEL', header: 'Assentos', editable: false, width: '100px', align: 'right' },
        { field: 'MAX_SESSOES_LABEL', header: 'Sessões', editable: false, width: '100px', align: 'right' },
        { field: 'MODULOS_TXT', header: 'Módulos', editable: false },
      ],
      canDeleteRow: function () {
        return false;
      },
      onBeforeEdit: function (id) {
        var p = planosPorId[String(id)];
        if (p) abrirEdicaoPlano(p);
        return false;
      },
      onDelete: function () {},
    });
    // Evita traço "—" do placeholder de exclusão em GridEditor antigo em cache
    if (gridPlanos && typeof gridPlanos.renderActions === 'function') {
      var _raPlano = gridPlanos.renderActions.bind(gridPlanos);
      gridPlanos.renderActions = function (row, isEditing) {
        return String(_raPlano(row, isEditing) || '').replace(
          /<span class="grid-no-delete"[^>]*>\s*—\s*<\/span>/g,
          ''
        );
      };
    }
    return gridPlanos;
  }

  function renderPlanosTable() {
    planosPorId = {};
    var rows = (planosList || []).map(function (p) {
      var cd = String(p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano);
      planosPorId[cd] = p;
      return normalizePlanoRow(p);
    });
    setGridCount('planosGridCountText', rows.length);
    var wrap = document.getElementById('planosGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">Nenhum plano. Use Novo para cadastrar.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    initGridPlanos();
    gridPlanos.render(rows);
  }

  async function loadPlanosPanel() {
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/planos', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      planosList = data.planos || [];
      syncSelectPlanosCliente();
      planosModulosResumo = {};
      await Promise.all(
        planosList.map(function (p) {
          var cd = String(p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano);
          return fetchModulosDoPlano(cd)
            .then(function (mods) {
              planosModulosResumo[cd] = mods.map(function (row) {
                return row.NM_EXIBICAO || row.nm_exibicao || row.CODIGO_MODULO || row.codigo_modulo;
              });
            })
            .catch(function () {
              planosModulosResumo[cd] = [];
            });
        })
      );
      renderPlanosTable();
    } catch (e) {
      setGridCount('planosGridCountText', 0);
      var wrapPl = document.getElementById('planosGrid');
      if (wrapPl) wrapPl.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro') + '</p>';
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  function fecharPlanoModal() {
    var modal = document.getElementById('saasPlanoModal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.style.display = 'none';
    }
  }

  function abrirPlanoModal() {
    var modal = document.getElementById('saasPlanoModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('is-open');
  }

  function limparFormularioPlano() {
    editandoPlano = null;
    setCampo('planoModalNm', '');
    setCampo('planoModalDs', '');
    setCampo('planoMaxAssentos', '');
    setCampo('planoMaxSessoes', '');
    var titulo = document.getElementById('saasPlanoModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-plus-circle"></i> Novo plano';
    showMsg('msgPlanoModal', '', true);
  }

  async function abrirNovoPlano() {
    limparFormularioPlano();
    await ensureCatalogoModulos();
    renderPlanoModulosChecks({});
    abrirPlanoModal();
    var foc = document.getElementById('planoModalNm');
    if (foc) foc.focus();
  }

  async function abrirEdicaoPlano(p) {
    if (!p) return;
    limparFormularioPlano();
    editandoPlano = String(p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano);
    setCampo('planoModalNm', p.NM_PLANO || p.nm_plano || '');
    setCampo('planoModalDs', p.DS_PLANO || p.ds_plano || '');
    var maxA = p.MAX_ASSENTOS_USUARIOS != null ? p.MAX_ASSENTOS_USUARIOS : p.max_assentos_usuarios;
    var maxS = p.MAX_SESSOES_SIMULTANEAS != null ? p.MAX_SESSOES_SIMULTANEAS : p.max_sessoes_simultaneas;
    setCampo('planoMaxAssentos', maxA != null && maxA !== '' ? maxA : '');
    setCampo('planoMaxSessoes', maxS != null && maxS !== '' ? maxS : '');
    var titulo = document.getElementById('saasPlanoModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-edit"></i> Editar plano';
    showMsg('msgPlanoModal', 'Carregando módulos…', true);
    abrirPlanoModal();
    try {
      await ensureCatalogoModulos();
      var mods = await fetchModulosDoPlano(editandoPlano);
      var incluidos = {};
      mods.forEach(function (row) {
        var c = row.CODIGO_MODULO || row.codigo_modulo;
        if (c) incluidos[String(c)] = true;
      });
      renderPlanoModulosChecks(incluidos);
      showMsg('msgPlanoModal', '', true);
    } catch (e) {
      renderPlanoModulosChecks({});
      showMsg('msgPlanoModal', e.message || 'Erro ao carregar módulos.', false);
    }
    var foc = document.getElementById('planoModalNm');
    if (foc) foc.focus();
  }

  async function salvarPlanoDoModal() {
    if (salvandoPlano) return;
    var nm = valorCampo('planoModalNm');
    var ds = valorCampo('planoModalDs');
    if (!nm) {
      showMsg('msgPlanoModal', 'Informe o nome do plano.', false);
      return;
    }
    var limA = parseLimiteCampo(valorCampo('planoMaxAssentos'), 'assentos');
    if (limA.error) {
      showMsg('msgPlanoModal', limA.error, false);
      return;
    }
    var limS = parseLimiteCampo(valorCampo('planoMaxSessoes'), 'sessões');
    if (limS.error) {
      showMsg('msgPlanoModal', limS.error, false);
      return;
    }
    var codigos = codigosModulosMarcados();
    var eraEdicao = !!editandoPlano;
    salvandoPlano = true;
    showMsg('msgPlanoModal', 'Salvando…', true);
    try {
      var cd = editandoPlano;
      if (cd) {
        var rPut = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd), {
          method: 'PUT',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify({
            nm_plano: nm,
            ds_plano: ds,
            max_assentos_usuarios: limA.value,
            max_sessoes_simultaneas: limS.value,
          }),
        });
        var dPut = await rPut.json();
        if (!rPut.ok) throw new Error(dPut.error || 'Erro ao atualizar plano.');
      } else {
        var rPost = await fetch(apiPrefix() + '/api/saas/planos', {
          method: 'POST',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify({
            nm_plano: nm,
            ds_plano: ds,
            max_assentos_usuarios: limA.value,
            max_sessoes_simultaneas: limS.value,
          }),
        });
        var dPost = await rPost.json();
        if (!rPost.ok) throw new Error(dPost.error || 'Erro ao criar plano.');
        cd = String(
          (dPost.plano && (dPost.plano.CD_PLANO != null ? dPost.plano.CD_PLANO : dPost.plano.cd_plano)) ||
            ''
        );
        if (!cd) throw new Error('Plano criado sem identificador.');
      }
      var rMod = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd) + '/modulos', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ codigos: codigos }),
      });
      var dMod = await rMod.json();
      if (!rMod.ok) throw new Error(dMod.error || 'Erro ao salvar módulos do plano.');
      fecharPlanoModal();
      toastMsg(eraEdicao ? 'Plano atualizado.' : 'Plano cadastrado.', 'success');
      await loadPlanosPanel();
      var tabCli = document.getElementById('tab-clientes');
      if (tabCli && tabCli.classList.contains('active')) await loadClientesPanel();
    } catch (e) {
      showMsg('msgPlanoModal', e.message || 'Erro', false);
    } finally {
      salvandoPlano = false;
    }
  }

  var btnNovoPlano = document.getElementById('btnNovoPlano');
  if (btnNovoPlano) {
    btnNovoPlano.addEventListener('click', function () {
      abrirNovoPlano();
    });
  }
  var btnSalvarPlano = document.getElementById('btnSalvarPlano');
  if (btnSalvarPlano) {
    btnSalvarPlano.addEventListener('click', function () {
      salvarPlanoDoModal();
    });
  }
  var btnCancelPlano = document.getElementById('btnCancelPlano');
  if (btnCancelPlano) {
    btnCancelPlano.addEventListener('click', function () {
      fecharPlanoModal();
    });
  }
  var saasPlanoModalX = document.getElementById('saasPlanoModalX');
  if (saasPlanoModalX) {
    saasPlanoModalX.addEventListener('click', function () {
      fecharPlanoModal();
    });
  }
  var saasPlanoModal = document.getElementById('saasPlanoModal');
  if (saasPlanoModal) {
    saasPlanoModal.addEventListener('click', function (ev) {
      if (ev.target === saasPlanoModal) fecharPlanoModal();
    });
  }
  var btnLimparComposicaoPlano = document.getElementById('btnLimparComposicaoPlano');
  if (btnLimparComposicaoPlano) {
    btnLimparComposicaoPlano.addEventListener('click', function () {
      document.querySelectorAll('#planoModulosGrid input[data-plano-mod]').forEach(function (inp) {
        inp.checked = false;
      });
      showMsg('msgPlanoModal', 'Módulos desmarcados. Use Salvar para gravar.', true);
    });
  }

  function valorCampo(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setCampo(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v == null ? '' : String(v);
  }

  function fecharClienteModal() {
    var modal = document.getElementById('saasClienteModal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.style.display = 'none';
    }
  }

  function abrirClienteModal() {
    var modal = document.getElementById('saasClienteModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('is-open');
  }

  function limparFormularioCliente() {
    editandoTenant = null;
    ['newTenantId', 'newClienteNm', 'newClienteDoc', 'newClienteContato', 'newClienteEmail', 'newClienteDdi', 'newClienteFone', 'newClienteEmp', 'newClienteMaxAssentos', 'newClienteMaxSessoes'].forEach(function (id) {
      setCampo(id, '');
    });
    var tid = document.getElementById('newTenantId');
    if (tid) tid.readOnly = false;
    var titulo = document.getElementById('saasClienteModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-user-plus"></i> Novo cliente';
    var btn = document.getElementById('btnAddCliente');
    if (btn) btn.innerHTML = '<i class="bx bx-save"></i> <span>Salvar</span>';
    var pais = document.getElementById('newClientePais');
    if (pais && pais.querySelector('option[value="BR"]')) pais.value = 'BR';
    setCampo('newClienteDdi', '55');
    showMsg('msgClienteNovo', '', true);
  }

  function abrirNovoCliente() {
    limparFormularioCliente();
    carregarPaisesCliente().then(function () {
      var pais = document.getElementById('newClientePais');
      if (pais && pais.querySelector('option[value="BR"]')) pais.value = 'BR';
      abrirClienteModal();
      var foc = document.getElementById('newTenantId');
      if (foc) foc.focus();
    });
  }

  function abrirEdicaoCliente(c) {
    if (!c) return;
    limparFormularioCliente();
    editandoTenant = String(c.TENANT_ID || c.tenant_id || '');
    setCampo('newTenantId', editandoTenant);
    var tid = document.getElementById('newTenantId');
    if (tid) tid.readOnly = true;
    setCampo('newClienteNm', c.NM_CLIENTE || c.nm_cliente || '');
    setCampo('newClientePais', c.SGPAIS || c.sgpais || 'BR');
    setCampo('newClienteDoc', c.DOCUMENTO || c.documento || '');
    setCampo('newClienteContato', c.NM_CONTATO || c.nm_contato || '');
    setCampo('newClienteEmail', c.EMAIL || c.email || '');
    setCampo('newClienteDdi', c.DDI || c.ddi || '');
    setCampo('newClienteFone', c.TELEFONE || c.telefone || '');
    setCampo('newClientePlano', c.CD_PLANO != null ? c.CD_PLANO : c.cd_plano);
    var emp = c.CDEMPRESA != null ? c.CDEMPRESA : c.cdempresa;
    setCampo('newClienteEmp', emp != null ? emp : '');
    var ovr = c.max_assentos_usuarios_ovr != null ? c.max_assentos_usuarios_ovr : c.MAX_ASSENTOS_USUARIOS_OVR;
    var ovrS = c.max_sessoes_simultaneas_ovr != null ? c.max_sessoes_simultaneas_ovr : c.MAX_SESSOES_SIMULTANEAS_OVR;
    setCampo('newClienteMaxAssentos', ovr != null ? ovr : '');
    setCampo('newClienteMaxSessoes', ovrS != null ? ovrS : '');
    var titulo = document.getElementById('saasClienteModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-edit"></i> Editar cliente';
    carregarPaisesCliente().then(function () {
      setCampo('newClientePais', c.SGPAIS || c.sgpais || 'BR');
      abrirClienteModal();
      var foc = document.getElementById('newClienteNm');
      if (foc) foc.focus();
    });
  }

  function payloadDoFormulario() {
    var mx = valorCampo('newClienteMaxAssentos');
    var mxs = valorCampo('newClienteMaxSessoes');
    var em = valorCampo('newClienteEmp');
    var payload = {
      nm_cliente: valorCampo('newClienteNm'),
      cd_plano: parseInt(valorCampo('newClientePlano') || '1', 10),
      documento: valorCampo('newClienteDoc').replace(/\D/g, ''),
      sgpais: valorCampo('newClientePais'),
      nm_contato: valorCampo('newClienteContato'),
      email: valorCampo('newClienteEmail'),
      ddi: valorCampo('newClienteDdi').replace(/\D/g, ''),
      telefone: valorCampo('newClienteFone').replace(/\D/g, ''),
      cdempresa: em ? parseInt(em, 10) : null,
    };
    if (mx === '') payload.max_assentos_usuarios_ovr = '';
    else {
      var n = parseInt(mx, 10);
      if (!Number.isFinite(n)) return { error: 'Override máx. usuários: informe um número válido ou deixe vazio.' };
      payload.max_assentos_usuarios_ovr = n;
    }
    if (mxs === '') payload.max_sessoes_simultaneas_ovr = '';
    else {
      var ns = parseInt(mxs, 10);
      if (!Number.isFinite(ns)) return { error: 'Override sessões: informe um número válido ou deixe vazio.' };
      payload.max_sessoes_simultaneas_ovr = ns;
    }
    return { payload: payload };
  }

  async function carregarPaisesCliente() {
    var selP = document.getElementById('newClientePais');
    if (!selP || selP.options.length) return;
    var lista = [
      { SGPAIS: 'AR', DSPAIS: 'Argentina', DDI: '54' },
      { SGPAIS: 'BR', DSPAIS: 'Brasil', DDI: '55' },
      { SGPAIS: 'PY', DSPAIS: 'Paraguai', DDI: '595' },
      { SGPAIS: 'UY', DSPAIS: 'Uruguai', DDI: '598' },
    ];
    try {
      var r = await fetch(apiPrefix() + '/api/paises');
      if (r.ok) {
        var data = await r.json();
        if (Array.isArray(data) && data.length) lista = data;
      }
    } catch (e) { /* mantém a lista local */ }
    selP.innerHTML = '';
    lista.forEach(function (p) {
      var o = document.createElement('option');
      o.value = p.SGPAIS || p.sgpais;
      o.textContent = (p.DSPAIS || p.dspais || o.value) + (p.DDI || p.ddi ? ' +' + (p.DDI || p.ddi) : '');
      selP.appendChild(o);
    });
    if (selP.querySelector('option[value="BR"]')) selP.value = 'BR';
  }

  function initGridClientes() {
    if (gridClientes || typeof window.GridEditor === 'undefined') return gridClientes;
    gridClientes = new window.GridEditor({
      container: '#clientesGrid',
      columns: [
        { field: 'TENANT_ID', header: 'Tenant', editable: false, isId: true, width: '140px' },
        { field: 'NM_CLIENTE', header: 'Empresa', editable: false },
        { field: 'CONTATO', header: 'Contato', editable: false },
        { field: 'CELULAR', header: 'Celular', editable: false, width: '160px' },
        { field: 'PLANO', header: 'Plano', editable: false, width: '120px' },
        { field: 'ASSENTOS', header: 'Assentos', editable: false, width: '110px', align: 'right' },
        { field: 'SESSOES', header: 'Sessões', editable: false, width: '110px', align: 'right' },
      ],
      canDeleteRow: function (row) {
        return String(row.TENANT_ID) !== 'default';
      },
      onBeforeEdit: function (id) {
        abrirEdicaoCliente(clientesPorId[String(id)]);
        return false;
      },
      onDelete: function (id) {
        var tid = String(id);
        if (!tid || tid === 'default') return;
        var c = clientesPorId[tid] || {};
        var nm = c.NM_CLIENTE || c.nm_cliente || tid;
        saasConfirmModal({
          title: 'Excluir cliente contratante',
          html:
            '<p>Remover o cliente <strong>' +
            escapeHtml(nm) +
            '</strong> (<code>' +
            escapeHtml(tid) +
            '</code>)?</p><ul style="text-align:left;margin:12px 0;padding-left:1.25rem;line-height:1.5;"><li>Some este identificador por completo: cliente, pedido de acesso, usuários, cadastros, configuração, torre e estoque.</li><li>Cidades, estados e a instalação padrão ficam.</li></ul>',
          plainFallback: 'Excluir cliente contratante ' + tid + '?',
          confirmHtml: '<i class="bx bx-trash"></i> Excluir',
          confirmClass: 'btn-filtro btn-filtro-danger',
        }).then(function (ok) {
          if (ok) deleteClienteRow(tid);
        });
      },
    });
    return gridClientes;
  }

  function normalizeClienteRow(c) {
    var tid = String(c.TENANT_ID || c.tenant_id || '');
    var nomeCheio = c.NM_CLIENTE || c.nm_cliente || tid;
    var cdp = c.CD_PLANO != null ? c.CD_PLANO : c.cd_plano;
    var qtd = c.qtd_usuarios_ativos != null ? c.qtd_usuarios_ativos : c.QTD_USUARIOS_ATIVOS;
    var ovr = c.max_assentos_usuarios_ovr != null ? c.max_assentos_usuarios_ovr : c.MAX_ASSENTOS_USUARIOS_OVR;
    var mpl = c.max_assentos_plano != null ? c.max_assentos_plano : c.MAX_ASSENTOS_USUARIOS_PLANO;
    var eff = ovr != null && ovr !== '' ? ovr : mpl;
    var limTxt = eff != null && eff !== '' ? String(eff) : '∞';
    var uso = qtd != null && qtd !== '' ? String(qtd) : '—';
    var qtdS = c.qtd_sessoes_torre_abertas != null ? c.qtd_sessoes_torre_abertas : c.QTD_SESSOES_TORRE_ABERTAS;
    var ovrS = c.max_sessoes_simultaneas_ovr != null ? c.max_sessoes_simultaneas_ovr : c.MAX_SESSOES_SIMULTANEAS_OVR;
    var mplS = c.max_sessoes_plano != null ? c.max_sessoes_plano : c.MAX_SESSOES_SIMULTANEAS_PLANO;
    var effS = ovrS != null && ovrS !== '' ? ovrS : mplS;
    var limTxtS = effS != null && effS !== '' ? String(effS) : '∞';
    var usoS = qtdS != null && qtdS !== '' ? String(qtdS) : '—';
    var planoNome = c.nm_plano || c.NM_PLANO || '';
    if (!planoNome) {
      planosList.forEach(function (p) {
        var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
        if (String(cd) === String(cdp)) planoNome = p.NM_PLANO || p.nm_plano || '';
      });
    }
    var contato = c.NM_CONTATO || c.nm_contato || '';
    var ddi = c.DDI || c.ddi || '';
    var fone = c.TELEFONE || c.telefone || '';
    var foneTxt = fone ? (ddi ? '+' + ddi + ' ' : '') + fone : '';
    return {
      TENANT_ID: tid,
      NM_CLIENTE: nomeCheio,
      CONTATO: contato || '—',
      CELULAR: foneTxt || '—',
      PLANO: planoNome || '—',
      ASSENTOS: uso + ' / ' + limTxt,
      SESSOES: usoS + ' / ' + limTxtS,
      _raw: c,
    };
  }

  async function loadClientesPanel() {
    showOverlay();
    try {
      await carregarPaisesCliente();
      var r = await fetch(apiPrefix() + '/api/saas/clientes', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      var clientes = data.clientes || [];
      var rp = await fetch(apiPrefix() + '/api/saas/planos', { headers: getAuthJsonHeaders() });
      var dp = await rp.json();
      planosList = dp.planos || [];
      syncSelectPlanosCliente();
      clientesPorId = {};
      var rows = clientes.map(function (c) {
        var row = normalizeClienteRow(c);
        clientesPorId[row.TENANT_ID] = c;
        return row;
      });
      setGridCount('clientesGridCountText', rows.length);
      var wrap = document.getElementById('clientesGrid');
      if (!wrap) return;
      if (!rows.length) {
        wrap.innerHTML = '<p class="empty">Nenhum cliente. Use Novo ou rode o script SQL.</p>';
        return;
      }
      if (typeof window.GridEditor === 'undefined') {
        wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
        return;
      }
      initGridClientes();
      gridClientes.render(rows);
    } catch (e) {
      setGridCount('clientesGridCountText', 0);
      var g = document.getElementById('clientesGrid');
      if (g) g.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro') + '</p>';
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  async function saveClienteRow(tenantId, body) {
    toastMsg('Salvando…', 'warning');
    try {
      var r = await fetch(apiPrefix() + '/api/saas/clientes/' + encodeURIComponent(tenantId), {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify(body),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      toastMsg('Cliente atualizado.', 'success');
      if (typeof showMessage === 'function') showMessage('Cliente atualizado.', 'success');
      await loadClientesPanel();
    } catch (e) {
      toastMsg(e.message || 'Erro', 'error');
    }
  }

  async function deleteClienteRow(tenantId) {
    toastMsg('Excluindo…', 'warning');
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/clientes/' + encodeURIComponent(tenantId), {
        method: 'DELETE',
        headers: getAuthJsonHeaders(),
      });
      var data = {};
      try {
        data = await r.json();
      } catch (pe) {
        data = {};
      }
      if (!r.ok) {
        throw new Error(
          data.error ||
            (r.status === 403
              ? 'Este tenant não pode ser excluído.'
              : r.status === 404
                ? 'Cliente não encontrado.'
                : 'Erro ao excluir (' + r.status + ').')
        );
      }
      toastMsg('Cliente removido.', 'success');
      await loadClientesPanel();
    } catch (e) {
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  var btnNovoCliente = document.getElementById('btnNovoCliente');
  if (btnNovoCliente) {
    btnNovoCliente.addEventListener('click', function () {
      abrirNovoCliente();
    });
  }

  document.getElementById('btnCancelCliente').addEventListener('click', function () {
    limparFormularioCliente();
    fecharClienteModal();
  });

  var btnClienteModalX = document.getElementById('saasClienteModalX');
  if (btnClienteModalX) {
    btnClienteModalX.addEventListener('click', function () {
      limparFormularioCliente();
      fecharClienteModal();
    });
  }

  var saasClienteModal = document.getElementById('saasClienteModal');
  if (saasClienteModal) {
    saasClienteModal.addEventListener('click', function (ev) {
      if (ev.target === saasClienteModal) {
        limparFormularioCliente();
        fecharClienteModal();
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && saasClienteModal.classList.contains('is-open')) {
        limparFormularioCliente();
        fecharClienteModal();
      }
    });
  }

  document.getElementById('btnAddCliente').addEventListener('click', async function () {
    if (salvandoCliente) return;
    var lido = payloadDoFormulario();
    if (lido.error) {
      showMsg('msgClienteNovo', lido.error, false);
      return;
    }
    var payload = lido.payload;
    if (!payload.nm_cliente) {
      showMsg('msgClienteNovo', 'Informe o nome da empresa.', false);
      return;
    }
    var btn = document.getElementById('btnAddCliente');
    salvandoCliente = true;
    if (btn) btn.disabled = true;
    showMsg('msgClienteNovo', 'Salvando…', true);
    try {
      if (editandoTenant) {
        await saveClienteRow(editandoTenant, payload);
        limparFormularioCliente();
        fecharClienteModal();
        toastMsg('Cadastro atualizado.', 'success');
      } else {
        payload.tenant_id = valorCampo('newTenantId');
        if (!payload.tenant_id) throw new Error('Informe o tenant ID.');
        var r = await fetch(apiPrefix() + '/api/saas/clientes', {
          method: 'POST',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify(payload),
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro');
        limparFormularioCliente();
        fecharClienteModal();
        toastMsg('Cliente cadastrado.', 'success');
        await loadClientesPanel();
      }
    } catch (e) {
      showMsg('msgClienteNovo', e.message || 'Erro', false);
    } finally {
      setTimeout(function () {
        salvandoCliente = false;
        if (btn) btn.disabled = false;
      }, 600);
    }
  });

  var gridOverride = null;
  var overridePorTenant = {};
  var editandoOverride = null;

  var gridElOverride = document.getElementById('saasModulosGrid');
  var btnSalvarOverride = document.getElementById('saasBtnSalvar');

  function fecharOverrideModal() {
    var modal = document.getElementById('saasOverrideModal');
    if (modal) {
      modal.classList.remove('is-open');
      modal.style.display = 'none';
    }
    editandoOverride = null;
  }

  function abrirOverrideModal() {
    var modal = document.getElementById('saasOverrideModal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('is-open');
  }

  function renderOverrideCheckboxes(modules) {
    if (!gridElOverride) return;
    var keys = Object.keys(modules || {}).sort();
    if (!keys.length && catalogoModulos.length) {
      keys = catalogoModulos.map(function (m) {
        return m.CODIGO || m.codigo;
      });
    }
    var m = modules || {};
    gridElOverride.innerHTML = keys
      .map(function (k) {
        var on = m[k] !== false;
        var lbl = labelModulo(k);
        return (
          '<label class="saas-modulo-chip">' +
          '<input type="checkbox" data-key="' +
          String(k).replace(/"/g, '&quot;') +
          '" ' +
          (on ? 'checked' : '') +
          ' />' +
          '<span class="saas-modulo-chip-text">' +
          '<span class="saas-modulo-chip-name">' +
          escapeHtml(String(lbl)) +
          '</span>' +
          '<span class="saas-modulo-chip-code">' +
          escapeHtml(String(k)) +
          '</span></span></label>'
        );
      })
      .join('');
  }

  function resumoModulosOverride(modules) {
    var m = modules || {};
    var keys = Object.keys(m);
    if (!keys.length && catalogoModulos.length) {
      keys = catalogoModulos.map(function (x) {
        return x.CODIGO || x.codigo;
      });
    }
    var on = keys.filter(function (k) {
      return m[k] !== false;
    });
    return {
      qtd: on.length,
      total: keys.length,
      txt: on.length ? on.map(labelModulo).join(', ') : 'Nenhum',
    };
  }

  function initGridOverride() {
    if (gridOverride || typeof window.GridEditor === 'undefined') return gridOverride;
    gridOverride = new window.GridEditor({
      container: '#overrideGrid',
      columns: [
        { field: 'TENANT_ID', header: 'Tenant', editable: false, isId: true, width: '160px' },
        { field: 'QTD_MODULOS', header: 'Módulos ON', editable: false, width: '120px', align: 'right' },
        { field: 'MODULOS_TXT', header: 'Módulos ativos', editable: false },
      ],
      canDeleteRow: function () {
        return false;
      },
      onBeforeEdit: function (id) {
        abrirEdicaoOverride(String(id));
        return false;
      },
      onDelete: function () {},
    });
    if (gridOverride && typeof gridOverride.renderActions === 'function') {
      var _raOvr = gridOverride.renderActions.bind(gridOverride);
      gridOverride.renderActions = function (row, isEditing) {
        return String(_raOvr(row, isEditing) || '').replace(
          /<span class="grid-no-delete"[^>]*>\s*—\s*<\/span>/g,
          ''
        );
      };
    }
    return gridOverride;
  }

  function renderOverrideTable(rows) {
    setGridCount('overrideGridCountText', rows.length);
    var wrap = document.getElementById('overrideGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">Nenhum tenant encontrado.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    initGridOverride();
    gridOverride.render(rows);
  }

  async function abrirEdicaoOverride(tenantId) {
    if (!tenantId) return;
    editandoOverride = tenantId;
    setCampo('overrideTenantId', tenantId);
    var titulo = document.getElementById('saasOverrideModalTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-edit"></i> Override · <code>' + escapeHtml(tenantId) + '</code>';
    abrirOverrideModal();
    try {
      if (!catalogoModulos.length) {
        var r0 = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
        var d0 = await r0.json();
        catalogoModulos = d0.modulos || [];
      }
      var cached = overridePorTenant[tenantId];
      if (cached && cached.modules) {
        renderOverrideCheckboxes(cached.modules);
      } else {
        var enc = encodeURIComponent(tenantId);
        var r = await fetch(apiPrefix() + '/api/saas/tenants/' + enc + '/modules', {
          headers: getAuthJsonHeaders(),
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || data.hint || 'Erro ao carregar.');
        overridePorTenant[tenantId] = { tenantId: tenantId, modules: data.modules || {} };
        renderOverrideCheckboxes(data.modules || {});
      }
    } catch (e) {
      toastMsg(e.message || 'Erro', 'error');
      fecharOverrideModal();
    }
  }

  async function loadTenantsOverride() {
    showOverlay();
    try {
      if (!catalogoModulos.length) {
        var r0 = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
        var d0 = await r0.json();
        catalogoModulos = d0.modulos || [];
      }
      var r = await fetch(apiPrefix() + '/api/saas/tenants', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      var tenants = data.tenants || [];
      overridePorTenant = {};
      await Promise.all(
        tenants.map(function (t) {
          var id = t.tenantId != null ? String(t.tenantId) : '';
          if (!id) return Promise.resolve();
          return fetch(apiPrefix() + '/api/saas/tenants/' + encodeURIComponent(id) + '/modules', {
            headers: getAuthJsonHeaders(),
          })
            .then(function (rr) {
              return rr.json().then(function (dd) {
                return { ok: rr.ok, id: id, data: dd };
              });
            })
            .then(function (x) {
              overridePorTenant[x.id] = {
                tenantId: x.id,
                modules: x.ok ? x.data.modules || {} : {},
              };
            })
            .catch(function () {
              overridePorTenant[id] = { tenantId: id, modules: {} };
            });
        })
      );
      var rows = tenants
        .map(function (t) {
          var id = t.tenantId != null ? String(t.tenantId) : '';
          if (!id) return null;
          var res = resumoModulosOverride((overridePorTenant[id] || {}).modules);
          return {
            TENANT_ID: id,
            QTD_MODULOS: res.qtd + ' / ' + res.total,
            MODULOS_TXT: res.txt,
          };
        })
        .filter(Boolean);
      renderOverrideTable(rows);
    } catch (e) {
      setGridCount('overrideGridCountText', 0);
      var wrap = document.getElementById('overrideGrid');
      if (wrap) wrap.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro') + '</p>';
      toastMsg(e.message || 'Erro', 'error');
    } finally {
      hideOverlay();
    }
  }

  async function salvarOverride() {
    var tenantId = editandoOverride || valorCampo('overrideTenantId');
    if (!tenantId) return;
    var modules = {};
    if (gridElOverride) {
      gridElOverride.querySelectorAll('input[type="checkbox"][data-key]').forEach(function (inp) {
        var k = inp.getAttribute('data-key');
        if (k) modules[k] = inp.checked;
      });
    }
    if (btnSalvarOverride) btnSalvarOverride.disabled = true;
    try {
      var enc = encodeURIComponent(tenantId);
      var r = await fetch(apiPrefix() + '/api/saas/tenants/' + enc + '/modules', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ modules: modules }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || data.hint || 'Erro');
      overridePorTenant[tenantId] = { tenantId: tenantId, modules: data.modules || modules };
      toastMsg('Override salvo.', 'success');
      fecharOverrideModal();
      await loadTenantsOverride();
    } catch (e) {
      toastMsg(e.message || 'Erro de rede.', 'error');
    } finally {
      if (btnSalvarOverride) btnSalvarOverride.disabled = false;
    }
  }

  if (btnSalvarOverride) btnSalvarOverride.addEventListener('click', salvarOverride);
  var saasOverrideModalX = document.getElementById('saasOverrideModalX');
  if (saasOverrideModalX) {
    saasOverrideModalX.addEventListener('click', function () {
      fecharOverrideModal();
    });
  }
  var saasOverrideCancel = document.getElementById('saasOverrideCancel');
  if (saasOverrideCancel) {
    saasOverrideCancel.addEventListener('click', function () {
      fecharOverrideModal();
    });
  }
  var saasOverrideModal = document.getElementById('saasOverrideModal');
  if (saasOverrideModal) {
    saasOverrideModal.addEventListener('click', function (ev) {
      if (ev.target === saasOverrideModal) fecharOverrideModal();
    });
  }

  function formatarQuandoPedido(valor) {
    if (!valor) return '';
    var tz = (typeof window.resolveTimezoneInstalacao === 'function')
      ? window.resolveTimezoneInstalacao()
      : 'America/Sao_Paulo';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(valor, 'pt-BR', tz, { dateStyle: 'short', timeStyle: 'short' });
    }
    var d = new Date(valor);
    if (Number.isNaN(d.getTime())) return String(valor).replace('T', ' ').slice(0, 16);
    return d.toLocaleString('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' });
  }

  function rotuloWhatsappPedido(status) {
    if (status === 'ENVIADO') return 'Enviado';
    if (status === 'SEM_CANAL') return 'Canal não configurado';
    if (status === 'SEM_NUMERO') return 'Sem número';
    if (status === 'ERRO') return 'Falhou';
    return '—';
  }

  function formatarDocPedido(p) {
    var pais = String(p.SGPAIS || p.sgpais || '').toUpperCase();
    var d = String(p.DOCUMENTO || p.documento || '').replace(/\D/g, '');
    if (pais === 'BR' && d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    if (pais === 'AR' && d.length === 11) return d.replace(/(\d{2})(\d{8})(\d)/, '$1-$2-$3');
    if ((pais === 'PY' || pais === 'UY') && d.length > 1) return d.slice(0, -1) + '-' + d.slice(-1);
    return p.DOCUMENTO || p.documento || '';
  }

  function formatarFonePedido(p) {
    var ddi = String(p.DDI || p.ddi || '').replace(/\D/g, '');
    var fone = String(p.TELEFONE || p.telefone || '').replace(/\D/g, '');
    if (!fone) return '—';
    if (ddi === '55' && fone.length === 11) {
      return '+55 (' + fone.slice(0, 2) + ') ' + fone.slice(2, 7) + '-' + fone.slice(7);
    }
    return (ddi ? '+' + ddi + ' ' : '') + fone;
  }

  var pedidosPorId = {};

  function linhaDadoPedido(label, valor) {
    return (
      '<div style="display:grid;grid-template-columns:140px 1fr;gap:6px 12px;padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:13px;line-height:1.4">' +
      '<span style="color:#64748b">' +
      escapeHtml(label) +
      '</span>' +
      '<span style="color:#0f172a;word-break:break-word">' +
      (valor != null && String(valor) !== '' ? valor : '—') +
      '</span></div>'
    );
  }

  function htmlDetalhePedido(p) {
    if (!p) return '<p>Pedido não encontrado.</p>';
    var sit = p.SITUACAO || p.situacao || '—';
    var tid = p.TENANT_ID || p.tenant_id || '';
    var idioma = p.IDIOMA || p.idioma || '';
    var pais = String(p.SGPAIS || p.sgpais || '').toUpperCase() || '—';
    var waDet = p.WHATSAPP_DETALHE || p.whatsapp_detalhe || '';
    var avisoDet = p.WHATSAPP_RESP_DETALHE || p.whatsapp_resp_detalhe || '';
    var motivo = p.DS_MOTIVO || p.ds_motivo || '';
    var decisor = p.SGUSER_DECISAO || p.sguser_decisao || '';
    return (
      '<div style="text-align:left;max-height:60vh;overflow:auto;margin:4px 0 8px">' +
      linhaDadoPedido('Empresa', escapeHtml(p.NM_EMPRESA || p.nm_empresa || '')) +
      linhaDadoPedido('Documento', escapeHtml(formatarDocPedido(p) || '—')) +
      linhaDadoPedido('País', escapeHtml(pais)) +
      linhaDadoPedido('Contato', escapeHtml(p.NM_CONTATO || p.nm_contato || '—')) +
      linhaDadoPedido('E-mail', escapeHtml(p.EMAIL || p.email || '—')) +
      linhaDadoPedido('Celular', escapeHtml(formatarFonePedido(p))) +
      linhaDadoPedido('Idioma', escapeHtml(idioma || '—')) +
      linhaDadoPedido('Usuário', '<code>' + escapeHtml(p.SGUSUARIO || p.sgusuario || '—') + '</code>') +
      linhaDadoPedido('Situação', escapeHtml(sit) + (tid ? ' · <code>' + escapeHtml(tid) + '</code>' : '')) +
      (motivo ? linhaDadoPedido('Motivo', escapeHtml(motivo)) : '') +
      linhaDadoPedido('Pedido em', escapeHtml(formatarQuandoPedido(p.DH_PEDIDO || p.dh_pedido || '') || '—')) +
      linhaDadoPedido('Decisão em', escapeHtml(formatarQuandoPedido(p.DH_DECISAO || p.dh_decisao || '') || '—')) +
      (decisor ? linhaDadoPedido('Decidido por', escapeHtml(decisor)) : '') +
      linhaDadoPedido(
        'WhatsApp empresa',
        escapeHtml(rotuloWhatsappPedido(p.WHATSAPP_STATUS || p.whatsapp_status)) +
          (waDet ? ' — ' + escapeHtml(waDet) : '')
      ) +
      linhaDadoPedido(
        'Aviso Atlas',
        escapeHtml(rotuloWhatsappPedido(p.WHATSAPP_RESP_STATUS || p.whatsapp_resp_status)) +
          (avisoDet ? ' — ' + escapeHtml(avisoDet) : '')
      ) +
      '<p style="margin:10px 0 0;font-size:12px;color:#64748b">A senha escolhida no cadastro não é exibida.</p>' +
      '</div>'
    );
  }

  function verDadosPedido(id) {
    var p = pedidosPorId[String(id)];
    if (!p) {
      toastMsg('Pedido não encontrado na lista. Atualize a aba.', 'error');
      return;
    }
    return saasConfirmModal({
      title: 'Dados do pedido',
      html: htmlDetalhePedido(p),
      confirmHtml: '<i class="bx bx-x"></i> Fechar',
      confirmClass: 'btn-filtro btn-filtro-limpar',
      hideCancel: true,
      plainFallback: 'Ver dados do pedido de acesso.',
    });
  }

  function bindPedidosAcoes(container) {
    if (!container) return;
    container.querySelectorAll('.btn-ver-pedido').forEach(function (btn) {
      btn.addEventListener('click', function () {
        verDadosPedido(btn.getAttribute('data-id'));
      });
    });
    container.querySelectorAll('.btn-liberar-pedido').forEach(function (btn) {
      btn.addEventListener('click', function () {
        decidirPedido(btn.getAttribute('data-id'), 'liberar', {
          empresa: btn.getAttribute('data-empresa') || '',
          usuario: btn.getAttribute('data-usuario') || '',
          documento: btn.getAttribute('data-documento') || '',
          email: btn.getAttribute('data-email') || '',
        });
      });
    });
    container.querySelectorAll('.btn-recusar-pedido').forEach(function (btn) {
      btn.addEventListener('click', function () {
        decidirPedido(btn.getAttribute('data-id'), 'recusar');
      });
    });
  }

  function initGridPedidos() {
    if (gridPedidos || typeof window.GridEditor === 'undefined') return gridPedidos;
    gridPedidos = new window.GridEditor({
      container: '#pedidosGrid',
      showActions: false,
      columns: [
        { field: 'ID', header: 'ID', editable: false, isId: true, hidden: true },
        { field: 'EMPRESA', header: 'Empresa', editable: false },
        { field: 'CONTATO', header: 'Contato', editable: false },
        { field: 'WHATSAPP', header: 'WhatsApp', editable: false, width: '110px' },
        { field: 'AVISO', header: 'Aviso', editable: false, width: '110px' },
        { field: 'SITUACAO_TXT', header: 'Situação', editable: false, width: '140px' },
        { field: 'QUANDO', header: 'Quando', editable: false, width: '150px' },
        {
          field: 'ACOES_HTML',
          header: 'Ações',
          editable: false,
          sortable: false,
          width: '200px',
          format: function (val) {
            return val || '';
          },
        },
      ],
      onAfterRender: function () {
        bindPedidosAcoes(document.getElementById('pedidosGrid'));
      },
    });
    return gridPedidos;
  }

  function normalizePedidoRow(p) {
    var id = p.ID != null ? p.ID : p.id;
    var sit = p.SITUACAO || p.situacao || '';
    var tid = p.TENANT_ID || p.tenant_id || '';
    var acoes =
      '<button type="button" class="btn-filtro btn-filtro-limpar btn-sm btn-ver-pedido" data-id="' +
      id +
      '" title="Ver todos os dados"><i class="bx bx-show"></i> Ver</button>';
    if (sit === 'PENDENTE') {
      acoes +=
        ' <button type="button" class="btn-filtro btn-filtro-aplicar btn-sm btn-liberar-pedido" data-id="' +
        id +
        '" data-empresa="' +
        escapeHtml(p.NM_EMPRESA || p.nm_empresa || '') +
        '" data-usuario="' +
        escapeHtml(p.SGUSUARIO || p.sgusuario || '') +
        '" data-documento="' +
        escapeHtml(formatarDocPedido(p)) +
        '" data-email="' +
        escapeHtml(p.EMAIL || p.email || '') +
        '"><i class="bx bx-check"></i> Liberar</button> ' +
        '<button type="button" class="btn-filtro btn-filtro-limpar btn-sm btn-recusar-pedido" data-id="' +
        id +
        '"><i class="bx bx-x"></i> Recusar</button>';
    }
    return {
      ID: String(id),
      EMPRESA: p.NM_EMPRESA || p.nm_empresa || '',
      CONTATO:
        (p.NM_CONTATO || p.nm_contato || '—') +
        (formatarFonePedido(p) !== '—' ? ' · ' + formatarFonePedido(p) : ''),
      WHATSAPP: rotuloWhatsappPedido(p.WHATSAPP_STATUS || p.whatsapp_status),
      AVISO: rotuloWhatsappPedido(p.WHATSAPP_RESP_STATUS || p.whatsapp_resp_status),
      SITUACAO_TXT: sit + (tid ? ' · ' + tid : ''),
      QUANDO: formatarQuandoPedido(p.DH_PEDIDO || p.dh_pedido || ''),
      ACOES_HTML: acoes,
      _raw: p,
    };
  }

  async function loadPedidos() {
    var wrap = document.getElementById('pedidosGrid');
    var count = document.getElementById('pedidoCount');
    if (!wrap) return;
    try {
      var r = await fetch(apiPrefix() + '/api/saas/pedidos-acesso', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ao listar pedidos.');
      var lista = data.pedidos || [];
      var pendentes = lista.filter(function (p) {
        return (p.SITUACAO || p.situacao) === 'PENDENTE';
      }).length;
      if (count) {
        count.hidden = pendentes < 1;
        count.textContent = String(pendentes);
      }
      pedidosPorId = {};
      var rows = lista.map(function (p) {
        var row = normalizePedidoRow(p);
        pedidosPorId[row.ID] = p;
        return row;
      });
      setGridCount('pedidosGridCountText', rows.length);
      if (!rows.length) {
        wrap.innerHTML = '<p class="empty">Nenhuma empresa pediu acesso ainda.</p>';
        return;
      }
      if (typeof window.GridEditor === 'undefined') {
        wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
        return;
      }
      initGridPedidos();
      gridPedidos.render(rows);
    } catch (e) {
      setGridCount('pedidosGridCountText', 0);
      wrap.innerHTML = '<p class="empty">' + escapeHtml(e.message || 'Erro ao carregar pedidos.') + '</p>';
      toastMsg(e.message || 'Erro ao carregar pedidos.', 'error');
    }
  }

  var RUIDO_TENANT = {
    sa: 1, ltda: 1, me: 1, epp: 1, eireli: 1, ss: 1, cia: 1, companhia: 1,
    tecnologia: 1, logistica: 1, transportes: 1, transporte: 1, servicos: 1,
    comercio: 1, comercial: 1, industria: 1, industrial: 1,
    e: 1, de: 1, da: 1, do: 1, das: 1, dos: 1
  };

  function sugerirTenantId(nome) {
    var tokens = String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    var uteis = tokens.filter(function (t) { return !RUIDO_TENANT[t] && t.length > 1; });
    var base = (uteis.length ? uteis : tokens).join('-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/g, '');
    return base || 'empresa';
  }

  function lerTenantIdLiberacao() {
    var campo = document.getElementById('tenantIdLiberacao');
    var erro = document.getElementById('tenantIdLiberacaoErro');
    var id = String(campo && campo.value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/g, '');
    if (campo && id !== campo.value) campo.value = id;
    var ok = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/.test(id) && id !== 'default';
    if (erro) {
      erro.textContent = ok ? '' : (id === 'default'
        ? 'default é da instalação padrão. Escolha outro.'
        : 'Começa com letra, 3 a 32 caracteres, só letras minúsculas, números e hífen.');
    }
    return ok ? id : '';
  }

  async function decidirPedido(id, acao, extra) {
    if (!id || decidindoPedido) return;
    var motivo = '';
    var tenantEscolhido = '';
    extra = extra || {};
    if (acao === 'recusar') {
      var recusou = await saasConfirmModal({
        title: 'Recusar pedido',
        html:
          '<p>A empresa recebe o aviso no WhatsApp.</p>' +
          '<label for="motivoRecusaPedido">Motivo (opcional)</label>' +
          '<textarea id="motivoRecusaPedido" class="form-control" rows="3" maxlength="300"></textarea>',
        confirmHtml: '<i class="bx bx-x"></i> Recusar',
        confirmClass: 'btn-filtro btn-filtro-danger',
        plainFallback: 'Recusar este pedido?',
      });
      if (!recusou) return;
      var campo = document.getElementById('motivoRecusaPedido');
      motivo = campo ? String(campo.value || '').trim() : '';
    } else {
      var sugestao = sugerirTenantId(extra.empresa);
      var liberou = await saasConfirmModal({
        title: 'Liberar empresa',
        html:
          '<p>Confira os dados antes de liberar. O identificador aparece no cabeçalho e na lista de usuários.</p>' +
          '<p><strong>' +
          escapeHtml(extra.empresa || 'Empresa') +
          '</strong></p>' +
          '<p style="font-size:13px;line-height:1.45;color:#475569;margin:0 0 12px">' +
          'Documento: <strong>' +
          escapeHtml(extra.documento || '—') +
          '</strong><br>' +
          'E-mail: <strong>' +
          escapeHtml(extra.email || '—') +
          '</strong><br>' +
          'Usuário: <code>' +
          escapeHtml(extra.usuario || '—') +
          '</code></p>' +
          '<label for="tenantIdLiberacao">Identificador do tenant</label>' +
          '<input id="tenantIdLiberacao" class="form-control" maxlength="32" autocomplete="off" spellcheck="false" value="' + escapeHtml(sugestao) + '">' +
          '<p id="tenantIdLiberacaoErro" style="color:#a94a3c;min-height:1.2em;margin:6px 0 0;"></p>' +
          '<p>A empresa entra com o usuário que escolheu. O celular do pedido recebe o aviso no WhatsApp.</p>',
        confirmHtml: '<i class="bx bx-check"></i> Liberar',
        confirmClass: 'btn-filtro btn-filtro-aplicar',
        plainFallback: 'Liberar esta empresa? Confira o identificador do tenant.',
        beforeConfirm: function () {
          tenantEscolhido = lerTenantIdLiberacao();
          return !!tenantEscolhido;
        },
      });
      if (!liberou || !tenantEscolhido) return;
    }
    decidindoPedido = true;
    try {
      var r = await fetch(apiPrefix() + '/api/saas/pedidos-acesso/' + encodeURIComponent(id) + '/' + acao, {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ motivo: motivo, tenantId: tenantEscolhido })
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Não foi possível decidir o pedido.');
      toastMsg(data.message || 'Pronto.', 'success');
      document.dispatchEvent(new CustomEvent('pedidos-acesso-contador-atualizado'));
      await loadPedidos();
    } catch (e) {
      toastMsg(e.message || 'Erro.', 'error');
    } finally {
      setTimeout(function () { decidindoPedido = false; }, 600);
    }
  }

  var limpandoTeste = false;

  function tabelasLimpezaEscolhidas() {
    return Array.prototype.map.call(
      document.querySelectorAll('#limpezaGrupos input.limpeza-tabela[data-usuario="1"]'),
      function (el) { return el.value; }
    );
  }

  function limpezaPrecisaDe(id) {
    var el = document.querySelector('#limpezaGrupos input.limpeza-tabela[value="' + id + '"]');
    if (!el || !el.dataset.precisa) return [];
    return el.dataset.precisa.split(',').filter(Boolean);
  }

  function expandirLimpeza(ids) {
    var ativo = {};
    ids.forEach(function (id) { ativo[id] = true; });
    var mudou = true;
    while (mudou) {
      mudou = false;
      Object.keys(ativo).forEach(function (id) {
        limpezaPrecisaDe(id).forEach(function (dep) {
          if (!ativo[dep]) {
            ativo[dep] = true;
            mudou = true;
          }
        });
      });
    }
    return ativo;
  }

  function soltarPaisLimpeza(id) {
    document.querySelectorAll('#limpezaGrupos input.limpeza-tabela[data-usuario="1"]').forEach(function (el) {
      if (limpezaPrecisaDe(el.value).indexOf(id) === -1) return;
      el.dataset.usuario = '';
      soltarPaisLimpeza(el.value);
    });
  }

  function aplicarExpansaoLimpeza() {
    var ativo = expandirLimpeza(tabelasLimpezaEscolhidas());
    document.querySelectorAll('#limpezaGrupos input.limpeza-tabela').forEach(function (el) {
      var on = !!ativo[el.value];
      el.checked = on;
      var nota = el.parentNode.querySelector('.limpeza-junto');
      if (nota) nota.style.display = on && el.dataset.usuario !== '1' ? 'inline' : 'none';
    });
    document.querySelectorAll('#limpezaGrupos input.limpeza-bloco').forEach(function (bloco) {
      var doBloco = document.querySelectorAll('#limpezaGrupos input.limpeza-tabela[data-grupo="' + bloco.value + '"]');
      var marcadas = 0;
      doBloco.forEach(function (el) { if (el.checked) marcadas += 1; });
      bloco.checked = doBloco.length > 0 && marcadas === doBloco.length;
      bloco.indeterminate = marcadas > 0 && marcadas < doBloco.length;
    });
  }

  function renderLimpeza(data) {
    var el = document.getElementById('limpezaResultado');
    var countWrap = document.getElementById('limpezaGridCount');
    var countTxt = document.getElementById('limpezaGridCountText');
    if (!el) return;
    var blocos = (data && data.blocos) || [];
    var linhas = [];
    blocos.forEach(function (b) {
      (b.linhas || []).forEach(function (l) {
        linhas.push({
          BLOCO: b.nome || '',
          TABELA: l.nome || '',
          QTD: l.n != null ? l.n : 0,
          JUNTO: l.inclusa ? 'Sim' : 'Não',
        });
      });
    });
    if (countWrap) countWrap.style.display = linhas.length ? '' : 'none';
    if (countTxt) countTxt.textContent = linhas.length + ' registro(s) encontrado(s)';
    if (!linhas.length) {
      el.innerHTML = '<p class="empty">Nada para listar.</p>';
      return;
    }
    var html =
      '<table class="grid-table"><thead><tr>' +
      '<th class="grid-header">Bloco</th><th class="grid-header">Tabela</th>' +
      '<th class="grid-header grid-col-right">Qtd</th><th class="grid-header">Entra junto</th>' +
      '</tr></thead><tbody>';
    linhas.forEach(function (l) {
      html +=
        '<tr class="grid-row">' +
        '<td class="grid-cell"><span class="cell-value">' +
        escapeHtml(l.BLOCO) +
        '</span></td>' +
        '<td class="grid-cell"><span class="cell-value">' +
        escapeHtml(l.TABELA) +
        '</span></td>' +
        '<td class="grid-cell grid-col-right"><span class="cell-value">' +
        escapeHtml(String(l.QTD)) +
        '</span></td>' +
        '<td class="grid-cell"><span class="cell-value">' +
        escapeHtml(l.JUNTO) +
        '</span></td></tr>';
    });
    html += '</tbody></table>';
    el.innerHTML = html;
  }

  async function carregarLimpeza() {
    var sel = document.getElementById('limpezaTenant');
    var box = document.getElementById('limpezaGrupos');
    if (!sel || !box) return;
    try {
      var rc = await fetch(apiPrefix() + '/api/saas/clientes', { headers: getAuthJsonHeaders() });
      var dc = await rc.json();
      if (!rc.ok) throw new Error(dc.error || 'Erro ao listar tenants.');
      var atual = sel.value;
      sel.innerHTML = '';
      (dc.clientes || []).forEach(function (c) {
        var tid = String(c.TENANT_ID || c.tenant_id || '');
        var nome = c.NM_CLIENTE || c.nm_cliente || tid;
        var o = document.createElement('option');
        o.value = tid;
        o.textContent = nome + ' · ' + tid;
        sel.appendChild(o);
      });
      if (atual) sel.value = atual;
      if (!box.querySelector('input.limpeza-tabela')) {
        var rg = await fetch(apiPrefix() + '/api/saas/limpeza-teste/grupos', { headers: getAuthJsonHeaders() });
        var dg = await rg.json();
        if (!rg.ok) throw new Error(dg.error || 'Erro ao listar grupos.');
        box.innerHTML = '';
        (dg.grupos || []).forEach(function (g) {
          var bloco = document.createElement('div');
          bloco.style.marginTop = '12px';
          var cab = document.createElement('label');
          cab.style.display = 'block';
          cab.style.marginBottom = '6px';
          var cbBloco = document.createElement('input');
          cbBloco.type = 'checkbox';
          cbBloco.className = 'limpeza-bloco';
          cbBloco.value = g.id;
          cbBloco.style.marginRight = '8px';
          var strong = document.createElement('strong');
          strong.textContent = g.nome || g.id;
          cab.appendChild(cbBloco);
          cab.appendChild(strong);
          cab.appendChild(document.createTextNode(' — ' + (g.detalhe || '')));
          bloco.appendChild(cab);
          var lista = document.createElement('div');
          lista.style.display = 'grid';
          lista.style.gridTemplateColumns = 'repeat(auto-fill, minmax(240px, 1fr))';
          lista.style.gap = '4px 12px';
          lista.style.margin = '0 0 8px 22px';
          (g.tabelas || []).forEach(function (t) {
            var lab = document.createElement('label');
            lab.style.display = 'block';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'limpeza-tabela';
            cb.value = t.id;
            cb.dataset.grupo = g.id;
            cb.dataset.precisa = (t.precisa || []).join(',');
            cb.style.marginRight = '8px';
            lab.appendChild(cb);
            lab.appendChild(document.createTextNode(t.nome || t.id));
            var nota = document.createElement('span');
            nota.className = 'limpeza-junto';
            nota.style.display = 'none';
            nota.style.marginLeft = '6px';
            nota.style.color = '#e8c36a';
            nota.textContent = 'entra junto';
            lab.appendChild(nota);
            lista.appendChild(lab);
            cb.addEventListener('change', function () {
              if (cb.checked) cb.dataset.usuario = '1';
              else {
                cb.dataset.usuario = '';
                soltarPaisLimpeza(cb.value);
              }
              aplicarExpansaoLimpeza();
            });
          });
          bloco.appendChild(lista);
          box.appendChild(bloco);
          cbBloco.addEventListener('change', function () {
            lista.querySelectorAll('input.limpeza-tabela').forEach(function (el) {
              el.dataset.usuario = cbBloco.checked ? '1' : '';
            });
            if (!cbBloco.checked) {
              lista.querySelectorAll('input.limpeza-tabela').forEach(function (el) {
                soltarPaisLimpeza(el.value);
              });
            }
            aplicarExpansaoLimpeza();
          });
        });
      }
    } catch (e) {
      showMsg('msgLimpeza', e.message || 'Erro.', false);
    }
  }

  var btnLimpezaPrever = document.getElementById('btnLimpezaPrever');
  if (btnLimpezaPrever) {
    btnLimpezaPrever.addEventListener('click', async function () {
      var sel = document.getElementById('limpezaTenant');
      var tabelas = tabelasLimpezaEscolhidas();
      if (!sel || !sel.value) return showMsg('msgLimpeza', 'Escolha o tenant.', false);
      if (!tabelas.length) return showMsg('msgLimpeza', 'Marque ao menos uma tabela.', false);
      showMsg('msgLimpeza', '', true);
      showOverlay();
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      try {
        var r = await fetch(apiPrefix() + '/api/saas/limpeza-teste/prever', {
          method: 'POST',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify({ tenantId: sel.value, tabelas: tabelas })
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Não foi possível contar.');
        renderLimpeza(data);
        var total = (data.blocos || []).reduce(function (s, b) { return s + (b.total || 0); }, 0);
        var juntas = 0;
        (data.blocos || []).forEach(function (b) {
          (b.linhas || []).forEach(function (l) { if (l.inclusa) juntas += l.n; });
        });
        var texto = total ? (total + ' linhas seriam apagadas.') : 'Nada para apagar nesse tenant.';
        if (juntas) texto += ' ' + juntas + ' entram junto porque travam outra tabela marcada.';
        showMsg('msgLimpeza', texto, true);
      } catch (e) {
        showMsg('msgLimpeza', e.message || 'Erro.', false);
      } finally {
        hideOverlay();
      }
    });
  }

  var btnLimpezaExecutar = document.getElementById('btnLimpezaExecutar');
  if (btnLimpezaExecutar) {
    btnLimpezaExecutar.addEventListener('click', async function () {
      if (limpandoTeste) return;
      var sel = document.getElementById('limpezaTenant');
      var conf = document.getElementById('limpezaConfirmacao');
      var tabelas = tabelasLimpezaEscolhidas();
      var tid = sel ? sel.value : '';
      if (!tid) return showMsg('msgLimpeza', 'Escolha o tenant.', false);
      if (!tabelas.length) return showMsg('msgLimpeza', 'Marque ao menos uma tabela.', false);
      if (!conf || conf.value.trim() !== tid) {
        return showMsg('msgLimpeza', 'Digite o identificador ' + tid + ' para confirmar.', false);
      }
      var ok = await saasConfirmModal({
        title: 'Limpar dados de teste',
        html: '<p>Isso apaga os dados marcados do tenant <strong>' + escapeHtml(tid) + '</strong>. Usuários, plano e cidades ficam.</p>',
        confirmHtml: '<i class="bx bx-trash"></i> Limpar',
        confirmClass: 'btn-filtro btn-filtro-danger',
        plainFallback: 'Limpar os dados de teste do tenant ' + tid + '?'
      });
      if (!ok) return;
      limpandoTeste = true;
      showMsg('msgLimpeza', '', true);
      showOverlay();
      await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
      try {
        var r = await fetch(apiPrefix() + '/api/saas/limpeza-teste', {
          method: 'POST',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify({ tenantId: tid, confirmacao: conf.value.trim(), tabelas: tabelas })
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || 'A limpeza não foi feita.');
        renderLimpeza(data);
        conf.value = '';
        showMsg('msgLimpeza', data.message || 'Limpeza feita.', true);
      } catch (e) {
        showMsg('msgLimpeza', e.message || 'Erro.', false);
      } finally {
        hideOverlay();
        setTimeout(function () { limpandoTeste = false; }, 600);
      }
    });
  }

  if (window.AtlasConsulta) {
    var docCliente = document.getElementById('newClienteDoc');
    AtlasConsulta.ligarDocumento(docCliente, function (data) {
      var pais = document.getElementById('newClientePais');
      if (pais && pais.value && pais.value !== 'BR') return;
      if (data.tipo !== 'J') {
        showMsg('msgClienteNovo', data.mensagem || 'CPF válido. O nome da pessoa física não sai em consulta pública.', true);
        return;
      }
      var c = data.campos || {};
      AtlasConsulta.preencher('newClienteNm', c.razaoSocial);
      AtlasConsulta.preencher('newClienteEmail', c.email);
      var ddi = document.getElementById('newClienteDdi');
      if (ddi && !String(ddi.value || '').trim()) ddi.value = '55';
      if (c.celular) AtlasConsulta.preencher('newClienteFone', c.celular);
      showMsg('msgClienteNovo', data.mensagem || 'CNPJ consultado.', true);
    });
  }

  loadPedidos();
})();
