(function () {
  var catalogoModulos = [];
  var planosList = [];
  var editandoTenant = null;
  var salvandoCliente = false;
  var decidindoPedido = false;
  var clientesPorId = {};

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

  function showMsg(elId, text, ok) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.style.display = text ? 'block' : 'none';
    el.textContent = text || '';
    el.className = 'saas-msg ' + (ok ? 'ok' : 'err');
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
      document.getElementById('tableCatalogoWrap').innerHTML =
        '<p class="saas-msg err">' + (e.message || 'Erro') + '</p>';
    } finally {
      hideOverlay();
    }
  }

  function renderCatalogTable() {
    var wrap = document.getElementById('tableCatalogoWrap');
    if (!wrap) return;
    if (!catalogoModulos.length) {
      wrap.innerHTML = '<p class="saas-op-info">Nenhum módulo. Rode o script SQL ou cadastre acima.</p>';
      return;
    }
    var html =
      '<table class="estatisticas-table"><thead><tr><th>Código</th><th>Nome</th><th>Ordem</th><th>Ativo</th><th>Ações</th></tr></thead><tbody>';
    catalogoModulos.forEach(function (m) {
      var cod = m.CODIGO || m.codigo;
      var nm = (m.NM_EXIBICAO || m.nm_exibicao || '').replace(/"/g, '&quot;');
      var ord = m.ORDEM != null ? m.ORDEM : m.ordem;
      var fg = m.FGACTIVE || m.fgactive || 'S';
      html += '<tr data-cod="' + String(cod).replace(/"/g, '') + '">';
      html += '<td><code>' + escapeHtml(String(cod)) + '</code></td>';
      html +=
        '<td><input type="text" class="inp-nm form-control" value="' +
        nm +
        '" style="max-width:280px;" /></td>';
      html +=
        '<td><input type="number" class="inp-ord form-control" value="' +
        ord +
        '" style="width:88px;" /></td>';
      html += '<td><select class="sel-fg form-control" style="width:auto;min-width:88px;">';
      html += '<option value="S"' + (fg === 'S' ? ' selected' : '') + '>Sim</option>';
      html += '<option value="N"' + (fg === 'N' ? ' selected' : '') + '>Não</option>';
      html += '</select></td>';
      html +=
        '<td class="saas-catalogo-acoes"><button type="button" class="btn-filtro btn-filtro-aplicar btn-save-row"><i class="bx bx-save"></i> Salvar</button> ';
      html +=
        '<button type="button" class="btn-filtro saas-btn-excluir btn-del-modulo" title="Remover do catálogo"><i class="bx bx-trash"></i> Excluir</button></td>';
      html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.btn-save-row').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        if (!tr) return;
        var cod = tr.getAttribute('data-cod');
        var nm = tr.querySelector('.inp-nm');
        var ord = tr.querySelector('.inp-ord');
        var fg = tr.querySelector('.sel-fg');
        saveModuloRow(cod, nm && nm.value, ord && ord.value, fg && fg.value);
      });
    });
    wrap.querySelectorAll('.btn-del-modulo').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tr = btn.closest('tr');
        if (!tr) return;
        var cod = tr.getAttribute('data-cod');
        confirmExcluirModuloCatalogo(cod).then(function (ok) {
          if (ok) deleteModuloRow(cod);
        });
      });
    });
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
    newNo.innerHTML = '<i class="bx bx-x"></i> Cancelar';
    if (confirmYes.parentNode) {
      confirmYes.parentNode.replaceChild(newYes, confirmYes);
      confirmNo.parentNode.replaceChild(newNo, confirmNo);
    }
    modal.style.display = 'block';
    return new Promise(function (resolve) {
      function fechar(aceitou) {
        modal.style.display = 'none';
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
    showMsg('msgCatalogo', 'Salvando…', true);
    try {
      var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo/' + encodeURIComponent(codigo), {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ nm_exibicao: nm, ordem: ord, fgactive: fg }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgCatalogo', 'Salvo.', true);
      await loadCatalog();
    } catch (e) {
      showMsg('msgCatalogo', e.message || 'Erro', false);
    }
  }

  async function deleteModuloRow(codigo) {
    showMsg('msgCatalogo', 'Excluindo…', true);
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
      showMsg('msgCatalogo', 'Módulo excluído do catálogo.', true);
      await loadCatalog();
    } catch (e) {
      showMsg('msgCatalogo', e.message || 'Erro', false);
    } finally {
      hideOverlay();
    }
  }

  document.getElementById('btnAddModulo').addEventListener('click', async function () {
    var cod = (document.getElementById('newCod') && document.getElementById('newCod').value) || '';
    var nm = (document.getElementById('newNm') && document.getElementById('newNm').value) || '';
    var ord = (document.getElementById('newOrd') && document.getElementById('newOrd').value) || '0';
    showMsg('msgCatalogo', 'Salvando…', true);
    try {
      var r = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ codigo: cod.trim(), nm_exibicao: nm.trim(), ordem: ord }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgCatalogo', 'Módulo cadastrado.', true);
      if (document.getElementById('newCod')) document.getElementById('newCod').value = '';
      if (document.getElementById('newNm')) document.getElementById('newNm').value = '';
      await loadCatalog();
    } catch (e) {
      showMsg('msgCatalogo', e.message || 'Erro', false);
    }
  });

  async function loadPlanosPanel() {
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/planos', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      planosList = data.planos || [];
      var sel = document.getElementById('selPlano');
      var selN = document.getElementById('newClientePlano');
      [sel, selN].forEach(function (s) {
        if (!s) return;
        s.innerHTML = '';
        if (!planosList.length) {
          s.innerHTML = '<option value="">Nenhum plano</option>';
          return;
        }
        planosList.forEach(function (p) {
          var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
          var nm = p.NM_PLANO || p.nm_plano || cd;
          var o = document.createElement('option');
          o.value = String(cd);
          o.textContent = nm;
          s.appendChild(o);
        });
      });
      if (sel && sel.options.length && !sel.value) sel.selectedIndex = 0;
      if (document.getElementById('selPlano')) {
        document.getElementById('selPlano').onchange = function () {
          loadPlanoModulos(this.value);
        };
        await loadPlanoModulos(sel.value);
      }
    } catch (e) {
      showMsg('msgPlano', e.message || 'Erro', false);
    } finally {
      hideOverlay();
    }
  }

  function syncPlanoAssentosField(cdPlano) {
    var inp = document.getElementById('planoMaxAssentos');
    if (!inp) return;
    if (!cdPlano) {
      inp.value = '';
      return;
    }
    var maxV = null;
    for (var i = 0; i < planosList.length; i++) {
      var p = planosList[i];
      var c = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
      if (String(c) === String(cdPlano)) {
        maxV = p.MAX_ASSENTOS_USUARIOS != null ? p.MAX_ASSENTOS_USUARIOS : p.max_assentos_usuarios;
        break;
      }
    }
    inp.value = maxV != null && maxV !== '' ? String(maxV) : '';
  }

  function syncPlanoSessoesField(cdPlano) {
    var inp = document.getElementById('planoMaxSessoes');
    if (!inp) return;
    if (!cdPlano) {
      inp.value = '';
      return;
    }
    var maxV = null;
    for (var j = 0; j < planosList.length; j++) {
      var p2 = planosList[j];
      var c2 = p2.CD_PLANO != null ? p2.CD_PLANO : p2.cd_plano;
      if (String(c2) === String(cdPlano)) {
        maxV =
          p2.MAX_SESSOES_SIMULTANEAS != null ? p2.MAX_SESSOES_SIMULTANEAS : p2.max_sessoes_simultaneas;
        break;
      }
    }
    inp.value = maxV != null && maxV !== '' ? String(maxV) : '';
  }

  async function loadPlanoModulos(cdPlano) {
    var grid = document.getElementById('planoModulosGrid');
    syncPlanoAssentosField(cdPlano);
    syncPlanoSessoesField(cdPlano);
    if (!grid || !cdPlano) {
      if (grid) grid.innerHTML = '<p class="saas-op-info">Selecione um plano.</p>';
      return;
    }
    if (!catalogoModulos.length) {
      var r0 = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
      var d0 = await r0.json();
      catalogoModulos = d0.modulos || [];
    }
    var r = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cdPlano) + '/modulos', {
      headers: getAuthJsonHeaders(),
    });
    var data = await r.json();
    var incluidos = {};
    (data.modulos || []).forEach(function (row) {
      var c = row.CODIGO_MODULO || row.codigo_modulo;
      if (c) incluidos[String(c)] = true;
    });
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

  var btnSavePlanoAssentos = document.getElementById('btnSavePlanoAssentos');
  if (btnSavePlanoAssentos) {
    btnSavePlanoAssentos.addEventListener('click', async function () {
      var sel = document.getElementById('selPlano');
      var cd = sel && sel.value;
      if (!cd) {
        showMsg('msgPlano', 'Selecione um plano.', false);
        return;
      }
      var inp = document.getElementById('planoMaxAssentos');
      var raw = inp ? String(inp.value).trim() : '';
      showMsg('msgPlano', 'Salvando…', true);
      try {
        var body = {};
        if (raw === '') body.max_assentos_usuarios = null;
        else {
          var n = parseInt(raw, 10);
          if (!Number.isFinite(n)) {
            showMsg('msgPlano', 'Informe um número válido ou deixe vazio para ilimitado.', false);
            return;
          }
          body.max_assentos_usuarios = n;
        }
        var r = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd), {
          method: 'PUT',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify(body),
        });
        var data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Erro');
        showMsg('msgPlano', 'Limite do plano salvo.', true);
        if (data.plano) {
          var pr = data.plano;
          var cdKey = pr.CD_PLANO != null ? pr.CD_PLANO : pr.cd_plano;
          planosList = planosList.map(function (p) {
            var c = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
            if (String(c) !== String(cdKey)) return p;
            return Object.assign({}, p, pr);
          });
          syncPlanoAssentosField(cd);
        } else {
          await loadPlanosPanel();
        }
        var tabCli = document.getElementById('tab-clientes');
        if (tabCli && tabCli.classList.contains('active')) await loadClientesPanel();
      } catch (e) {
        showMsg('msgPlano', e.message || 'Erro', false);
      }
    });
  }

  var btnSavePlanoSessoes = document.getElementById('btnSavePlanoSessoes');
  if (btnSavePlanoSessoes) {
    btnSavePlanoSessoes.addEventListener('click', async function () {
      var sel = document.getElementById('selPlano');
      var cd = sel && sel.value;
      if (!cd) {
        showMsg('msgPlano', 'Selecione um plano.', false);
        return;
      }
      var inp = document.getElementById('planoMaxSessoes');
      var raw = inp ? String(inp.value).trim() : '';
      showMsg('msgPlano', 'Salvando…', true);
      try {
        var bodyS = {};
        if (raw === '') bodyS.max_sessoes_simultaneas = null;
        else {
          var ns = parseInt(raw, 10);
          if (!Number.isFinite(ns)) {
            showMsg('msgPlano', 'Informe um número válido ou deixe vazio para ilimitado.', false);
            return;
          }
          bodyS.max_sessoes_simultaneas = ns;
        }
        var r2 = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd), {
          method: 'PUT',
          headers: getAuthJsonHeaders(),
          body: JSON.stringify(bodyS),
        });
        var data2 = await r2.json();
        if (!r2.ok) throw new Error(data2.error || 'Erro');
        showMsg('msgPlano', 'Limite de sessões salvo.', true);
        if (data2.plano) {
          var pr2 = data2.plano;
          var cdKey2 = pr2.CD_PLANO != null ? pr2.CD_PLANO : pr2.cd_plano;
          planosList = planosList.map(function (p) {
            var cx = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
            if (String(cx) !== String(cdKey2)) return p;
            return Object.assign({}, p, pr2);
          });
          syncPlanoSessoesField(cd);
        } else {
          await loadPlanosPanel();
        }
        var tabCli2 = document.getElementById('tab-clientes');
        if (tabCli2 && tabCli2.classList.contains('active')) await loadClientesPanel();
      } catch (e) {
        showMsg('msgPlano', e.message || 'Erro', false);
      }
    });
  }

  document.getElementById('btnSavePlanoMods').addEventListener('click', async function () {
    var sel = document.getElementById('selPlano');
    var cd = sel && sel.value;
    if (!cd) return;
    var codigos = [];
    document.querySelectorAll('#planoModulosGrid input[data-plano-mod]').forEach(function (inp) {
      if (inp.checked) codigos.push(inp.getAttribute('data-plano-mod'));
    });
    showMsg('msgPlano', 'Salvando…', true);
    try {
      var r = await fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd) + '/modulos', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ codigos: codigos }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgPlano', 'Plano atualizado.', true);
    } catch (e) {
      showMsg('msgPlano', e.message || 'Erro', false);
    }
  });

  document.getElementById('btnLimparComposicaoPlano').addEventListener('click', function () {
    var sel = document.getElementById('selPlano');
    var cd = sel && sel.value;
    if (!cd) {
      showMsg('msgPlano', 'Selecione um plano.', false);
      return;
    }
    var nmPlano = '';
    planosList.forEach(function (p) {
      var c = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
      if (String(c) === String(cd)) nmPlano = p.NM_PLANO || p.nm_plano || String(cd);
    });
    saasConfirmModal({
      title: 'Limpar composição do plano',
      html:
        '<p>Remover <strong>todos</strong> os módulos do plano <strong>' +
        escapeHtml(nmPlano) +
        '</strong> (<code>' +
        escapeHtml(String(cd)) +
        '</code>)?</p><p style="margin-top:12px;">Nenhum módulo ficará associado a este plano até você marcar de novo e usar <strong>Salvar plano</strong>. Clientes já vinculados ao plano deixam de herdar módulos por ele.</p>',
      plainFallback: 'Limpar todos os módulos deste plano?',
      confirmHtml: '<i class="bx bx-eraser"></i> Limpar composição',
      confirmClass: 'btn-filtro btn-filtro-danger',
    }).then(function (ok) {
      if (!ok) return;
      showOverlay();
      showMsg('msgPlano', 'Removendo…', true);
      fetch(apiPrefix() + '/api/saas/planos/' + encodeURIComponent(cd) + '/modulos', {
        method: 'DELETE',
        headers: getAuthJsonHeaders(),
      })
        .then(function (r) {
          return r.json().then(function (data) {
            return { r: r, data: data };
          });
        })
        .then(function (x) {
          if (!x.r.ok) throw new Error((x.data && x.data.error) || 'Erro');
          showMsg('msgPlano', 'Composição removida.', true);
          return loadPlanoModulos(cd);
        })
        .catch(function (e) {
          showMsg('msgPlano', e.message || 'Erro', false);
        })
        .finally(function () {
          hideOverlay();
        });
    });
  });

  document.getElementById('btnAddPlano').addEventListener('click', async function () {
    var nm = (document.getElementById('newPlanoNm') && document.getElementById('newPlanoNm').value) || '';
    var ds = (document.getElementById('newPlanoDs') && document.getElementById('newPlanoDs').value) || '';
    showMsg('msgPlanoNovo', 'Criando…', true);
    try {
      var r = await fetch(apiPrefix() + '/api/saas/planos', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ nm_plano: nm.trim(), ds_plano: ds.trim() }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgPlanoNovo', 'Plano criado.', true);
      if (document.getElementById('newPlanoNm')) document.getElementById('newPlanoNm').value = '';
      await loadPlanosPanel();
    } catch (e) {
      showMsg('msgPlanoNovo', e.message || 'Erro', false);
    }
  });

  function valorCampo(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function setCampo(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v == null ? '' : String(v);
  }

  function limparFormularioCliente() {
    editandoTenant = null;
    ['newTenantId', 'newClienteNm', 'newClienteDoc', 'newClienteContato', 'newClienteEmail', 'newClienteDdi', 'newClienteFone', 'newClienteEmp', 'newClienteMaxAssentos', 'newClienteMaxSessoes'].forEach(function (id) {
      setCampo(id, '');
    });
    var tid = document.getElementById('newTenantId');
    if (tid) tid.readOnly = false;
    var titulo = document.getElementById('clienteFormTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-user-plus"></i> Novo cliente';
    var btn = document.getElementById('btnAddCliente');
    if (btn) btn.innerHTML = '<i class="bx bx-plus"></i> <span>Cadastrar cliente</span>';
    var cancel = document.getElementById('btnCancelCliente');
    if (cancel) cancel.hidden = true;
    var pais = document.getElementById('newClientePais');
    if (pais && pais.querySelector('option[value="BR"]')) pais.value = 'BR';
  }

  function abrirEdicaoCliente(c) {
    if (!c) return;
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
    var titulo = document.getElementById('clienteFormTitulo');
    if (titulo) titulo.innerHTML = '<i class="bx bx-edit"></i> Editar cadastro';
    var btn = document.getElementById('btnAddCliente');
    if (btn) btn.innerHTML = '<i class="bx bx-save"></i> <span>Salvar cadastro</span>';
    var cancel = document.getElementById('btnCancelCliente');
    if (cancel) cancel.hidden = false;
    if (titulo && titulo.scrollIntoView) titulo.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      var wrap = document.getElementById('tableClientesWrap');
      var selN = document.getElementById('newClientePlano');
      if (selN) {
        selN.innerHTML = '';
        planosList.forEach(function (p) {
          var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
          var nm = p.NM_PLANO || p.nm_plano;
          var o = document.createElement('option');
          o.value = String(cd);
          o.textContent = nm;
          selN.appendChild(o);
        });
      }
      if (!clientes.length) {
        wrap.innerHTML = '<p class="saas-op-info">Nenhum cliente. Cadastre acima ou rode o script SQL.</p>';
        hideOverlay();
        return;
      }
      clientesPorId = {};
      var html = '<div class="cliente-lista">';
      clientes.forEach(function (c) {
        var tid = String(c.TENANT_ID || c.tenant_id || '');
        clientesPorId[tid] = c;
        var nomeCheio = c.NM_CLIENTE || c.nm_cliente || tid;
        var cdp = c.CD_PLANO != null ? c.CD_PLANO : c.cd_plano;
        var emp = c.CDEMPRESA != null ? c.CDEMPRESA : c.cdempresa;
        var qtd = c.qtd_usuarios_ativos != null ? c.qtd_usuarios_ativos : c.QTD_USUARIOS_ATIVOS;
        var ovr = c.max_assentos_usuarios_ovr != null ? c.max_assentos_usuarios_ovr : c.MAX_ASSENTOS_USUARIOS_OVR;
        var mpl = c.max_assentos_plano != null ? c.max_assentos_plano : c.MAX_ASSENTOS_USUARIOS_PLANO;
        var eff = ovr != null && ovr !== '' ? ovr : mpl;
        var limTxt = eff != null && eff !== '' ? String(eff) : '∞';
        var uso = qtd != null && qtd !== '' ? String(qtd) : '—';
        var usoClass = '';
        if (eff != null && eff !== '' && qtd != null && Number(qtd) > Number(eff)) usoClass = ' style="color:#b45309;font-weight:600;" title="Acima do limite (usuários já ativos)"';
        var qtdS =
          c.qtd_sessoes_torre_abertas != null ? c.qtd_sessoes_torre_abertas : c.QTD_SESSOES_TORRE_ABERTAS;
        var ovrS =
          c.max_sessoes_simultaneas_ovr != null ? c.max_sessoes_simultaneas_ovr : c.MAX_SESSOES_SIMULTANEAS_OVR;
        var mplS = c.max_sessoes_plano != null ? c.max_sessoes_plano : c.MAX_SESSOES_SIMULTANEAS_PLANO;
        var effS = ovrS != null && ovrS !== '' ? ovrS : mplS;
        var limTxtS = effS != null && effS !== '' ? String(effS) : '∞';
        var usoS = qtdS != null && qtdS !== '' ? String(qtdS) : '—';
        var usoClassS = '';
        if (effS != null && effS !== '' && qtdS != null && Number(qtdS) > Number(effS)) {
          usoClassS =
            ' style="color:#b45309;font-weight:600;" title="Acima do limite de sessões (faça logout em outro acesso ou aguarde TTL)"';
        }
        var planoNome = c.nm_plano || c.NM_PLANO || '';
        if (!planoNome) {
          planosList.forEach(function (p) {
            var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
            if (String(cd) === String(cdp)) planoNome = p.NM_PLANO || p.nm_plano || '';
          });
        }
        var doc = c.DOCUMENTO || c.documento || '';
        var contato = c.NM_CONTATO || c.nm_contato || '';
        var email = c.EMAIL || c.email || '';
        var ddi = c.DDI || c.ddi || '';
        var fone = c.TELEFONE || c.telefone || '';
        var foneTxt = fone ? (ddi ? '+' + ddi + ' ' : '') + fone : '';
        var login = c.SGUSUARIO || c.sgusuario || '';
        function item(rotulo, valor, extra) {
          return '<div><dt>' + rotulo + '</dt><dd' + (extra || '') + '>' + escapeHtml(valor || '—') + '</dd></div>';
        }
        html += '<article class="cliente-card" data-tenant="' + escapeHtml(tid) + '">';
        html += '<div class="cliente-card-topo"><div><strong>' + escapeHtml(nomeCheio) + '</strong><code>' + escapeHtml(tid) + '</code></div>';
        html += '<div class="cliente-card-acoes">';
        html += '<button type="button" class="btn-filtro btn-filtro-aplicar btn-cli-edit"><i class="bx bx-edit"></i> Editar</button>';
        if (tid === 'default') {
          html += '<span class="saas-op-info" title="Tenant base da instalação">Base</span>';
        } else {
          html += '<button type="button" class="btn-filtro saas-btn-excluir btn-cli-del" title="Remover cliente contratante"><i class="bx bx-trash"></i> Excluir</button>';
        }
        html += '</div></div><dl class="cliente-dados">';
        html += item('Documento', doc);
        html += item('Contato', contato);
        html += item('E-mail', email);
        html += item('Celular', foneTxt);
        html += item('Usuário de acesso', login);
        html += item('Plano', planoNome);
        html += item('Assentos', uso + ' / ' + limTxt, usoClass);
        html += item('Sessões da torre', usoS + ' / ' + limTxtS, usoClassS);
        html += item('CD empresa', emp != null && emp !== '' ? String(emp) : '');
        html += '</dl></article>';
      });
      html += '</div>';
      wrap.innerHTML = html;
      wrap.querySelectorAll('.btn-cli-edit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var card = btn.closest('.cliente-card');
          if (!card) return;
          abrirEdicaoCliente(clientesPorId[card.getAttribute('data-tenant')]);
        });
      });
      wrap.querySelectorAll('.btn-cli-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var card = btn.closest('.cliente-card');
          if (!card) return;
          var tenant = card.getAttribute('data-tenant');
          if (!tenant || tenant === 'default') return;
          var nomeEl = card.querySelector('strong');
          var nm = (nomeEl && nomeEl.textContent) || tenant;
          saasConfirmModal({
            title: 'Excluir cliente contratante',
            html:
              '<p>Remover o cliente <strong>' +
              escapeHtml(nm) +
              '</strong> (<code>' +
              escapeHtml(tenant) +
              '</code>)?</p><ul style="text-align:left;margin:12px 0;padding-left:1.25rem;line-height:1.5;"><li>Some este identificador por completo: cliente, pedido de acesso, usuários, cadastros, configuração, torre e estoque.</li><li>Cidades, estados e a instalação padrão ficam.</li></ul>',
            plainFallback: 'Excluir cliente contratante ' + tenant + '?',
            confirmHtml: '<i class="bx bx-trash"></i> Excluir',
            confirmClass: 'btn-filtro btn-filtro-danger',
          }).then(function (ok) {
            if (ok) deleteClienteRow(tenant);
          });
        });
      });
    } catch (e) {
      document.getElementById('tableClientesWrap').innerHTML =
        '<p class="saas-msg err">' + (e.message || 'Erro') + '</p>';
    } finally {
      hideOverlay();
    }
  }

  async function saveClienteRow(tenantId, body) {
    showMsg('msgClientesLista', 'Salvando…', true);
    try {
      var r = await fetch(apiPrefix() + '/api/saas/clientes/' + encodeURIComponent(tenantId), {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify(body),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgClientesLista', 'Cliente atualizado.', true);
      if (typeof showMessage === 'function') showMessage('Cliente atualizado.', 'success');
      await loadClientesPanel();
    } catch (e) {
      showMsg('msgClientesLista', e.message || 'Erro', false);
    }
  }

  async function deleteClienteRow(tenantId) {
    showMsg('msgClientesLista', 'Excluindo…', true);
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
      showMsg('msgClientesLista', 'Cliente removido.', true);
      await loadClientesPanel();
    } catch (e) {
      showMsg('msgClientesLista', e.message || 'Erro', false);
    } finally {
      hideOverlay();
    }
  }

  document.getElementById('btnCancelCliente').addEventListener('click', function () {
    limparFormularioCliente();
    showMsg('msgClienteNovo', '', true);
  });

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
        showMsg('msgClienteNovo', 'Cadastro atualizado.', true);
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
        showMsg('msgClienteNovo', 'Cliente cadastrado.', true);
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

  var sel = document.getElementById('saasTenantSelect');
  var grid = document.getElementById('saasModulosGrid');
  var card = document.getElementById('saasModulosCard');
  var btnSalvar = document.getElementById('saasBtnSalvar');
  var msg = document.getElementById('saasMsg');

  function showOverrideMsg(text, ok) {
    if (!msg) return;
    msg.style.display = text ? 'block' : 'none';
    msg.textContent = text || '';
    msg.className = 'saas-msg ' + (ok ? 'ok' : 'err');
  }

  function renderOverrideCheckboxes(modules) {
    if (!grid) return;
    var keys = Object.keys(modules || {}).sort();
    if (!keys.length && catalogoModulos.length) {
      keys = catalogoModulos.map(function (m) {
        return m.CODIGO || m.codigo;
      });
    }
    var m = modules || {};
    grid.innerHTML = keys
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
    if (card) card.style.display = 'block';
    if (btnSalvar) btnSalvar.disabled = false;
  }

  async function loadTenantsOverride() {
    if (!catalogoModulos.length) {
      var r0 = await fetch(apiPrefix() + '/api/saas/modulos-catalogo', { headers: getAuthJsonHeaders() });
      var d0 = await r0.json();
      catalogoModulos = d0.modulos || [];
    }
    showOverlay();
    try {
      var r = await fetch(apiPrefix() + '/api/saas/tenants', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      var tenants = data.tenants || [];
      if (!sel) return;
      sel.innerHTML = '';
      if (!tenants.length) {
        sel.innerHTML = '<option value="">Nenhum tenant</option>';
        hideOverlay();
        return;
      }
      tenants.forEach(function (t) {
        var id = t.tenantId != null ? String(t.tenantId) : '';
        var opt = document.createElement('option');
        opt.value = id;
        opt.textContent = id || '(vazio)';
        sel.appendChild(opt);
      });
      sel.selectedIndex = 0;
      await loadModulesForTenant(sel.value);
    } catch (e) {
      showOverrideMsg(e.message || 'Erro', false);
    } finally {
      hideOverlay();
    }
  }

  async function loadModulesForTenant(tenantId) {
    showOverrideMsg('', true);
    if (!tenantId) {
      if (card) card.style.display = 'none';
      return;
    }
    var enc = encodeURIComponent(tenantId);
    var r = await fetch(apiPrefix() + '/api/saas/tenants/' + enc + '/modules', { headers: getAuthJsonHeaders() });
    var data = await r.json();
    if (!r.ok) {
      showOverrideMsg(data.error || data.hint || 'Erro ao carregar.', false);
      if (card) card.style.display = 'none';
      return;
    }
    renderOverrideCheckboxes(data.modules);
  }

  async function salvarOverride() {
    var tenantId = sel && sel.value;
    if (!tenantId) return;
    var modules = {};
    if (grid) {
      grid.querySelectorAll('input[type="checkbox"][data-key]').forEach(function (inp) {
        var k = inp.getAttribute('data-key');
        if (k) modules[k] = inp.checked;
      });
    }
    showOverrideMsg('Salvando…', true);
    if (btnSalvar) btnSalvar.disabled = true;
    try {
      var enc = encodeURIComponent(tenantId);
      var r = await fetch(apiPrefix() + '/api/saas/tenants/' + enc + '/modules', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ modules: modules }),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || data.hint || 'Erro');
      showOverrideMsg('Salvo.', true);
    } catch (e) {
      showOverrideMsg(e.message || 'Erro de rede.', false);
    } finally {
      if (btnSalvar) btnSalvar.disabled = false;
    }
  }

  if (sel) {
    sel.addEventListener('change', function () {
      loadModulesForTenant(sel.value);
    });
  }
  if (btnSalvar) btnSalvar.addEventListener('click', salvarOverride);

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

  async function loadPedidos() {
    var wrap = document.getElementById('tablePedidosWrap');
    var msg = document.getElementById('msgPedidos');
    var count = document.getElementById('pedidoCount');
    if (!wrap) return;
    try {
      var r = await fetch(apiPrefix() + '/api/saas/pedidos-acesso', { headers: getAuthJsonHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ao listar pedidos.');
      var lista = data.pedidos || [];
      var pendentes = lista.filter(function (p) { return (p.SITUACAO || p.situacao) === 'PENDENTE'; }).length;
      if (count) {
        count.hidden = pendentes < 1;
        count.textContent = String(pendentes);
      }
      if (!lista.length) {
        wrap.innerHTML = '<p class="saas-op-info">Nenhuma empresa pediu acesso ainda.</p>';
        return;
      }
      var html = '<table class="estatisticas-table"><thead><tr><th>Empresa</th><th>Documento</th><th>Contato</th><th>E-mail</th><th>Usuário</th><th>WhatsApp</th><th>Aviso ao responsável</th><th>Situação</th><th>Quando</th><th></th></tr></thead><tbody>';
      lista.forEach(function (p) {
        var id = p.ID != null ? p.ID : p.id;
        var sit = p.SITUACAO || p.situacao || '';
        var quando = formatarQuandoPedido(p.DH_PEDIDO || p.dh_pedido || '');
        html += '<tr>';
        html += '<td>' + escapeHtml(p.NM_EMPRESA || p.nm_empresa || '') + '</td>';
        html += '<td>' + escapeHtml(formatarDocPedido(p)) + '</td>';
        html += '<td>' + escapeHtml(p.NM_CONTATO || p.nm_contato || '') + '<br>' + escapeHtml(formatarFonePedido(p)) + '</td>';
        html += '<td>' + escapeHtml(p.EMAIL || p.email || '') + '</td>';
        html += '<td><code>' + escapeHtml(p.SGUSUARIO || p.sgusuario || '') + '</code></td>';
        html += '<td title="' + escapeHtml(p.WHATSAPP_DETALHE || p.whatsapp_detalhe || '') + '">' + escapeHtml(rotuloWhatsappPedido(p.WHATSAPP_STATUS || p.whatsapp_status)) + '</td>';
        html += '<td title="' + escapeHtml(p.WHATSAPP_RESP_DETALHE || p.whatsapp_resp_detalhe || '') + '">' + escapeHtml(rotuloWhatsappPedido(p.WHATSAPP_RESP_STATUS || p.whatsapp_resp_status)) + '</td>';
        html += '<td>' + escapeHtml(sit) + (p.TENANT_ID || p.tenant_id ? '<br><code>' + escapeHtml(p.TENANT_ID || p.tenant_id) + '</code>' : '') + '</td>';
        html += '<td>' + escapeHtml(quando) + '</td>';
        html += '<td>';
        if (sit === 'PENDENTE') {
          html += '<button type="button" class="btn-filtro btn-filtro-aplicar btn-liberar-pedido" data-id="' + id + '" data-empresa="' + escapeHtml(p.NM_EMPRESA || p.nm_empresa || '') + '" data-usuario="' + escapeHtml(p.SGUSUARIO || p.sgusuario || '') + '">Liberar</button> ';
          html += '<button type="button" class="btn-filtro btn-filtro-limpar btn-recusar-pedido" data-id="' + id + '">Recusar</button>';
        }
        html += '</td></tr>';
      });
      html += '</tbody></table>';
      wrap.innerHTML = html;
      wrap.querySelectorAll('.btn-liberar-pedido').forEach(function (btn) {
        btn.addEventListener('click', function () {
          decidirPedido(btn.getAttribute('data-id'), 'liberar', {
            empresa: btn.getAttribute('data-empresa') || '',
            usuario: btn.getAttribute('data-usuario') || '',
          });
        });
      });
      wrap.querySelectorAll('.btn-recusar-pedido').forEach(function (btn) {
        btn.addEventListener('click', function () { decidirPedido(btn.getAttribute('data-id'), 'recusar'); });
      });
      if (msg) msg.style.display = 'none';
    } catch (e) {
      wrap.innerHTML = '';
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = e.message || 'Erro ao carregar pedidos.';
      }
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
          '<p>Confira o identificador antes de liberar. Ele aparece no cabeçalho e na lista de usuários.</p>' +
          '<p><strong>' + escapeHtml(extra.empresa || 'Empresa') + '</strong> · usuário <code>' + escapeHtml(extra.usuario || '') + '</code></p>' +
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
    var msg = document.getElementById('msgPedidos');
    decidindoPedido = true;
    try {
      var r = await fetch(apiPrefix() + '/api/saas/pedidos-acesso/' + encodeURIComponent(id) + '/' + acao, {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ motivo: motivo, tenantId: tenantEscolhido })
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Não foi possível decidir o pedido.');
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = data.message || 'Pronto.';
      }
      document.dispatchEvent(new CustomEvent('pedidos-acesso-contador-atualizado'));
      await loadPedidos();
    } catch (e) {
      if (msg) {
        msg.style.display = 'block';
        msg.textContent = e.message || 'Erro.';
      }
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
    if (!el) return;
    var blocos = (data && data.blocos) || [];
    if (!blocos.length) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = blocos.map(function (b) {
      var itens = (b.linhas || []).map(function (l) {
        var extra = l.inclusa ? ' <span style="color:#e8c36a;">(entra junto)</span>' : '';
        return '<li>' + escapeHtml(l.nome) + ': ' + l.n + extra + '</li>';
      }).join('');
      return '<p><strong>' + escapeHtml(b.nome) + '</strong>: ' + b.total + '</p>' +
        (itens ? '<ul style="margin:0 0 12px 18px;">' + itens + '</ul>' : '');
    }).join('');
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
