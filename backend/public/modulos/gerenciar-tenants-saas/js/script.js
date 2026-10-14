(function () {
  var catalogoModulos = [];
  var planosList = [];

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
      if (name === 'catalogo') loadCatalog();
      if (name === 'planos') loadPlanosPanel();
      if (name === 'clientes') loadClientesPanel();
      if (name === 'override') loadTenantsOverride();
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
      newYes.addEventListener(
        'click',
        function () {
          fechar(true);
        },
        { once: true }
      );
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

  async function loadClientesPanel() {
    showOverlay();
    try {
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
      var html =
        '<table class="estatisticas-table"><thead><tr><th>Tenant</th><th>Nome</th><th>Plano</th><th>Assentos (uso/lim)</th><th>Ovr. assentos</th><th>Sessões torre</th><th>Ovr. sessões</th><th>CD Empresa</th><th>Ações</th></tr></thead><tbody>';
      clientes.forEach(function (c) {
        var tid = c.TENANT_ID || c.tenant_id;
        var nm = (c.NM_CLIENTE || c.nm_cliente || '').replace(/"/g, '&quot;');
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
        var ovrVal =
          ovr != null && ovr !== '' ? String(ovr).replace(/"/g, '&quot;') : '';
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
        var ovrValS =
          ovrS != null && ovrS !== '' ? String(ovrS).replace(/"/g, '&quot;') : '';
        html += '<tr data-tenant="' + String(tid).replace(/"/g, '') + '">';
        html += '<td><code>' + escapeHtml(String(tid)) + '</code></td>';
        html +=
          '<td><input type="text" class="cli-nm form-control" value="' +
          nm +
          '" style="max-width:220px;" /></td>';
        html += '<td><select class="cli-plano form-control" style="width:auto;min-width:140px;">';
        planosList.forEach(function (p) {
          var cd = p.CD_PLANO != null ? p.CD_PLANO : p.cd_plano;
          var pnm = p.NM_PLANO || p.nm_plano;
          html +=
            '<option value="' +
            cd +
            '"' +
            (String(cd) === String(cdp) ? ' selected' : '') +
            '>' +
            escapeHtml(String(pnm)) +
            '</option>';
        });
        html += '</select></td>';
        html += '<td' + usoClass + '>' + escapeHtml(uso) + ' / ' + escapeHtml(limTxt) + '</td>';
        html +=
          '<td><input type="number" class="cli-max-assentos form-control" min="1" max="999999" value="' +
          ovrVal +
          '" style="width:110px;" placeholder="— usa plano" title="Vazio = usa o limite do plano selecionado" /></td>';
        html += '<td' + usoClassS + '>' + escapeHtml(usoS) + ' / ' + escapeHtml(limTxtS) + '</td>';
        html +=
          '<td><input type="number" class="cli-max-sessoes form-control" min="1" max="999999" value="' +
          ovrValS +
          '" style="width:110px;" placeholder="— usa plano" title="Vazio = usa o limite de sessões do plano" /></td>';
        html +=
          '<td><input type="number" class="cli-emp form-control" value="' +
          (emp != null ? emp : '') +
          '" style="width:100px;" placeholder="—" /></td>';
        html += '<td class="saas-catalogo-acoes">';
        html +=
          '<button type="button" class="btn-filtro btn-filtro-aplicar btn-cli-save"><i class="bx bx-save"></i> Salvar</button> ';
        if (String(tid) === 'default') {
          html += '<span class="saas-op-info" style="font-size:13px;" title="Tenant base da instalação">—</span>';
        } else {
          html +=
            '<button type="button" class="btn-filtro saas-btn-excluir btn-cli-del" title="Remover cliente contratante"><i class="bx bx-trash"></i> Excluir</button>';
        }
        html += '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      wrap.innerHTML = html;
      wrap.querySelectorAll('.btn-cli-save').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tr = btn.closest('tr');
          if (!tr) return;
          var tenant = tr.getAttribute('data-tenant');
          var nm = tr.querySelector('.cli-nm');
          var pl = tr.querySelector('.cli-plano');
          var em = tr.querySelector('.cli-emp');
          var mx = tr.querySelector('.cli-max-assentos');
          var mxs = tr.querySelector('.cli-max-sessoes');
          var payload = { nm_cliente: nm && nm.value };
          if (pl && pl.value) payload.cd_plano = parseInt(pl.value, 10);
          if (em && em.value !== '' && em.value != null) payload.cdempresa = parseInt(em.value, 10);
          else payload.cdempresa = null;
          if (mx) {
            var mv = String(mx.value).trim();
            if (mv === '') payload.max_assentos_usuarios_ovr = '';
            else {
              var nOvr = parseInt(mv, 10);
              if (!Number.isFinite(nOvr)) {
                showMsg('msgClientesLista', 'Override máx. usuários: informe um número válido ou deixe vazio.', false);
                return;
              }
              payload.max_assentos_usuarios_ovr = nOvr;
            }
          }
          if (mxs) {
            var mvs = String(mxs.value).trim();
            if (mvs === '') payload.max_sessoes_simultaneas_ovr = '';
            else {
              var nOs = parseInt(mvs, 10);
              if (!Number.isFinite(nOs)) {
                showMsg('msgClientesLista', 'Override sessões: informe um número válido ou deixe vazio.', false);
                return;
              }
              payload.max_sessoes_simultaneas_ovr = nOs;
            }
          }
          saveClienteRow(tenant, payload);
        });
      });
      wrap.querySelectorAll('.btn-cli-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var tr = btn.closest('tr');
          if (!tr) return;
          var tenant = tr.getAttribute('data-tenant');
          if (!tenant || tenant === 'default') return;
          var nmInp = tr.querySelector('.cli-nm');
          var nm = (nmInp && nmInp.value) || tenant;
          saasConfirmModal({
            title: 'Excluir cliente contratante',
            html:
              '<p>Remover o cliente <strong>' +
              escapeHtml(nm) +
              '</strong> (<code>' +
              escapeHtml(tenant) +
              '</code>)?</p><ul style="text-align:left;margin:12px 0;padding-left:1.25rem;line-height:1.5;"><li>Apaga overrides de módulo (<code>SAAS_TENANT_MODULO</code>) deste tenant.</li><li>Não remove usuários nem dados operacionais; apenas o vínculo de licença/plano.</li></ul>',
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

  document.getElementById('btnAddCliente').addEventListener('click', async function () {
    var tid = (document.getElementById('newTenantId') && document.getElementById('newTenantId').value) || '';
    var nm = (document.getElementById('newClienteNm') && document.getElementById('newClienteNm').value) || '';
    var pl = (document.getElementById('newClientePlano') && document.getElementById('newClientePlano').value) || '1';
    var em = document.getElementById('newClienteEmp') && document.getElementById('newClienteEmp').value;
    var mx =
      document.getElementById('newClienteMaxAssentos') &&
      String(document.getElementById('newClienteMaxAssentos').value).trim();
    var mxs =
      document.getElementById('newClienteMaxSessoes') &&
      String(document.getElementById('newClienteMaxSessoes').value).trim();
    showMsg('msgClienteNovo', 'Salvando…', true);
    try {
      var payload = { tenant_id: tid.trim(), nm_cliente: nm.trim(), cd_plano: parseInt(pl, 10) };
      if (em !== '' && em != null) payload.cdempresa = parseInt(em, 10);
      if (mx) {
        var nMx = parseInt(mx, 10);
        if (Number.isFinite(nMx)) payload.max_assentos_usuarios_ovr = nMx;
      }
      if (mxs) {
        var nMxs = parseInt(mxs, 10);
        if (Number.isFinite(nMxs)) payload.max_sessoes_simultaneas_ovr = nMxs;
      }
      var r = await fetch(apiPrefix() + '/api/saas/clientes', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify(payload),
      });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      showMsg('msgClienteNovo', 'Cliente cadastrado.', true);
      if (document.getElementById('newTenantId')) document.getElementById('newTenantId').value = '';
      if (document.getElementById('newClienteNm')) document.getElementById('newClienteNm').value = '';
      if (document.getElementById('newClienteMaxAssentos')) document.getElementById('newClienteMaxAssentos').value = '';
      if (document.getElementById('newClienteMaxSessoes')) document.getElementById('newClienteMaxSessoes').value = '';
      await loadClientesPanel();
    } catch (e) {
      showMsg('msgClienteNovo', e.message || 'Erro', false);
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

  loadCatalog();
})();
