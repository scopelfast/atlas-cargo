(function () {
  'use strict';

  var STORAGE_AGENTE = 'atlasPayTenantAlvo';
  var sessionTenantId = 'default';
  var dataTenantId = 'default';
  var TENANT_TODOS = '__all__';
  var podeOperarAgentes = false;
  var agentesCache = [];

  function lerUserLocal() {
    try {
      return JSON.parse(localStorage.getItem('user') || '{}') || {};
    } catch (e) {
      return {};
    }
  }

  function authHeaders(opts) {
    var o = opts || {};
    var h = { 'Content-Type': 'application/json', Accept: 'application/json' };
    try {
      var t = localStorage.getItem('token') || localStorage.getItem('atlasToken');
      var u = lerUserLocal();
      if (t) h.Authorization = 'Bearer ' + t;
      if (u && (u.login || u.SGUSUARIO)) h['user-login'] = u.login || u.SGUSUARIO;
      if (!o.semTenantAlvo && podeOperarAgentes && dataTenantId && String(dataTenantId) !== TENANT_TODOS) {
        h['X-Atlas-Pay-Tenant'] = String(dataTenantId);
      }
    } catch (e2) {}
    return h;
  }

  /** Padrão Usuários: só toast no topo (3º arg false = não pintar #message / faixa no meio). */
  function notify(text, type) {
    var msg = text == null ? '' : String(text).trim();
    if (!msg) return;
    var kind = type === 'info' ? 'success' : type || 'success';
    if (typeof window.showMessage === 'function') {
      window.showMessage(msg, kind, false);
      return;
    }
    if (typeof showMessage === 'function') {
      showMessage(msg, kind, false);
    }
  }

  function clearInlineMsg(el) {
    if (!el) return;
    el.className = '';
    el.textContent = '';
  }

  var gridCobrancas = null;
  var gridFechamentos = null;
  var gridContratos = null;
  var gridPermUsers = null;
  var gridPermAudit = null;
  var cobrancasPorId = {};
  var fechamentosPorId = {};
  var contratosPorId = {};

  function setGridCount(spanId, n) {
    var el = document.getElementById(spanId);
    if (el) el.textContent = String(n) + ' registro(s) encontrado(s)';
  }

  function ensureGrid(containerSel, existing, factory) {
    if (existing) return existing;
    if (typeof window.GridEditor === 'undefined') return null;
    return factory();
  }

  /** Confirmação padrão do sistema (confirmPadrao) — nunca window.confirm. */
  function confirmAp(message, opts) {
    var o = opts || {};
    if (typeof window.confirmPadrao === 'function') {
      return window.confirmPadrao(String(message || ''), {
        title: o.title || 'Confirmar ação',
        confirmText: o.confirmText || 'Confirmar',
        cancelText: o.cancelText || 'Cancelar',
        danger: !!o.danger,
      });
    }
    return Promise.resolve(window.confirm(String(message || '')));
  }

  function showLoadingOverlay() {
    var o = document.getElementById('loadingOverlay');
    if (o) o.style.display = 'flex';
  }
  function hideLoadingOverlay() {
    var o = document.getElementById('loadingOverlay');
    if (o) o.style.display = 'none';
  }

  async function api(path, opts) {
    showLoadingOverlay();
    await new Promise(function (r) {
      requestAnimationFrame(function () {
        requestAnimationFrame(r);
      });
    });
    try {
      var o = opts || {};
      var headers = authHeaders({ semTenantAlvo: !!o.semTenantAlvo });
      if (o.headers) {
        Object.keys(o.headers).forEach(function (k) {
          headers[k] = o.headers[k];
        });
      }
      var fetchOpts = Object.assign({}, o, { headers: headers });
      delete fetchOpts.semTenantAlvo;
      var res = await fetch('/api/financeiro' + path, fetchOpts);
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) {
        var err = new Error(data.error || res.statusText || 'Erro');
        err.status = res.status;
        err.code = data.code;
        throw err;
      }
      return data;
    } finally {
      hideLoadingOverlay();
    }
  }

  function nomeTenantPorId(tenantId) {
    var id = String(tenantId || '').trim();
    if (!id) return '';
    var nome = id;
    agentesCache.forEach(function (a) {
      var tid = String(a.tenant_id || a.TENANT_ID || '');
      if (tid === id) nome = a.nm_cliente || a.NM_CLIENTE || id;
    });
    return String(nome);
  }

  function rotuloTenant(tenantId) {
    var id = String(tenantId || '').trim();
    if (!id) return '—';
    var nome = nomeTenantPorId(id);
    if (nome === id) return id;
    return nome + ' (' + id + ')';
  }

  function rotuloAgenteOperando() {
    if (String(dataTenantId) === TENANT_TODOS) return 'Todos os tenants (painel Atlas)';
    return rotuloTenant(dataTenantId || sessionTenantId || 'default');
  }

  /** Pagador da cobrança: motorista (cadastro) ou tenant (uso da plataforma). */
  function rotuloPagadorCob(c) {
    if (!c) return '—';
    if (String(c.PAGADOR_TIPO || '').toUpperCase() === 'TENANT') {
      return rotuloTenant(c.PAGADOR_TENANT_ID || c.TENANT_ID);
    }
    return dash(c.PAGADOR_NOME || c.PAGADOR_CDCADASTRO);
  }

  function rotuloBeneficiarioCob(c) {
    if (!c) return '—';
    var tid = c.BENEFICIARIO_TENANT_ID;
    if (!tid) return '—';
    if (String(tid) === 'default') return 'Atlas (default)';
    return rotuloTenant(tid);
  }

  function atualizarLabelAgente() {
    var el = document.getElementById('apAgenteAtual');
    if (!el) return;
    if (!podeOperarAgentes) {
      el.textContent = '';
      return;
    }
    el.innerHTML =
      'Operando agora: <strong>' +
      String(rotuloAgenteOperando())
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;') +
      '</strong>';
  }

  async function carregarSeletorAgentes() {
    var bar = document.getElementById('apAgenteBar');
    var sel = document.getElementById('apAgenteSelect');
    var hostContrato = document.getElementById('apAgenteHostContrato');
    if (!bar || !sel) return;
    if (!podeOperarAgentes) {
      bar.style.display = 'none';
      if (hostContrato) hostContrato.style.display = 'none';
      return;
    }
    bar.style.display = '';
    if (hostContrato) hostContrato.style.display = '';
    try {
      var data = await api('/agentes', { semTenantAlvo: true });
      agentesCache = data.agentes || [];
      var saved = '';
      try {
        saved = sessionStorage.getItem(STORAGE_AGENTE) || '';
      } catch (e) {}
      /* Dono Atlas: painel padrão = todos (quem me deve). */
      if (!saved || saved === sessionTenantId) saved = TENANT_TODOS;
      sel.innerHTML = '';
      var optAll = document.createElement('option');
      optAll.value = TENANT_TODOS;
      optAll.textContent = 'Todos os tenants (painel Atlas)';
      sel.appendChild(optAll);
      if (!agentesCache.length) {
        var optSolo = document.createElement('option');
        optSolo.value = sessionTenantId;
        optSolo.textContent = sessionTenantId + ' (sem clientes SaaS)';
        sel.appendChild(optSolo);
      } else {
        agentesCache.forEach(function (a) {
          var id = String(a.tenant_id || a.TENANT_ID || '');
          var nm = a.nm_cliente || a.NM_CLIENTE || id;
          var opt = document.createElement('option');
          opt.value = id;
          opt.textContent = nm + ' — ' + id;
          sel.appendChild(opt);
        });
      }
      var ids = agentesCache.map(function (a) {
        return String(a.tenant_id || a.TENANT_ID || '');
      });
      ids.push(TENANT_TODOS);
      if (ids.indexOf(String(saved)) === -1) saved = TENANT_TODOS;
      sel.value = saved;
      dataTenantId = sel.value || sessionTenantId;
      try {
        sessionStorage.setItem(STORAGE_AGENTE, dataTenantId);
      } catch (e2) {}
      atualizarLabelAgente();
      if (!sel._apBound) {
        sel._apBound = true;
        sel.addEventListener('change', function () {
          dataTenantId = sel.value || sessionTenantId;
          try {
            sessionStorage.setItem(STORAGE_AGENTE, dataTenantId);
          } catch (e3) {}
          atualizarLabelAgente();
          recarregarAposTrocaAgente().catch(function (err) {
            notify(err.message || 'Falha ao carregar o agente.', 'error');
          });
        });
      }
    } catch (e) {
      bar.style.display = 'none';
      if (hostContrato) hostContrato.style.display = 'none';
      notify(e.message || 'Não foi possível listar agentes.', 'error');
    }
  }

  async function recarregarAposTrocaAgente() {
    gridCobrancas = null;
    gridFechamentos = null;
    gridContratos = null;
    gridPermUsers = null;
    gridPermAudit = null;
    cobrancasPorId = {};
    fechamentosPorId = {};
    contratosPorId = {};
    if (hasPerm('FIN_CONSULTAR') || hasPerm('FIN_COBRANCA_CONSULTAR') || hasPerm('FIN_CONTRATO_CONSULTAR') || mePerms.length) {
      await loadResumo();
      await loadContratos();
      await loadCobrancas();
    }
    var active = document.querySelector('.atlas-pay-container .tabs .tab-btn.active');
    var tab = active ? active.getAttribute('data-tab') : 'resumo';
    if (tab === 'fechamento') {
      if (typeof aplicarUiFechamentoUso === 'function') aplicarUiFechamentoUso();
      if (typeof loadFechamentos === 'function') await loadFechamentos();
    }
    if (tab === 'permissoes' && typeof loadPermAdmin === 'function') {
      await loadPermAdmin();
    }
    if (tab === 'dash-atlas' && typeof loadDashAtlas === 'function') {
      await loadDashAtlas();
    }
    if (tab === 'dash-tenant' && typeof loadDashMeu === 'function') {
      await loadDashMeu();
    }
  }

  function fmtBRL(centavos) {
    var c = Number(centavos) || 0;
    return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /** Valores já em reais (ex.: base % / VLFRETE), não centavos. */
  function fmtReais(reais) {
    var n = Number(reais) || 0;
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function fmtQuando(v) {
    if (!v) return '—';
    if (typeof formatarDataHoraComFuso === 'function') return formatarDataHoraComFuso(v);
    return String(v);
  }

  var COB_STATUS_LABEL = {
    ABERTA: 'Aberta',
    PAGA: 'Paga',
    CANCELADA: 'Cancelada',
  };

  function labelStatusCob(st) {
    var s = String(st || '').toUpperCase();
    return COB_STATUS_LABEL[s] || s || '—';
  }

  function badgeStatus(st) {
    var s = String(st || '').toUpperCase();
    return '<span class="ap-badge ' + s.toLowerCase() + '">' + labelStatusCob(s) + '</span>';
  }

  function dash(v) {
    if (v == null || v === '' || v === 'null' || v === 'undefined') return '—';
    return String(v);
  }

  function labelTipoComp(t) {
    var s = String(t || '').toUpperCase();
    if (s === 'FIXO') return 'Valor fixo';
    if (s === 'PERCENTUAL') return '% do frete';
    if (s === 'POR_CARGA_ANUNCIADA') return 'Por anúncio';
    return s || '—';
  }

  function fmtCompLinha(c) {
    var tipo = String(c.TIPO || c.tipo || '').toUpperCase();
    if (tipo === 'FIXO' || tipo === 'POR_CARGA_ANUNCIADA') {
      var v = c.VALOR_CENTAVOS != null ? c.VALOR_CENTAVOS : c.valorCentavos;
      return labelTipoComp(tipo) + ': ' + fmtBRL(v);
    }
    if (tipo === 'PERCENTUAL') {
      var p = c.PERCENTUAL != null ? c.PERCENTUAL : c.percentual;
      return labelTipoComp(tipo) + ': ' + p + '%';
    }
    return labelTipoComp(tipo);
  }

  /** Aceita "100", "100,5", "1.000,50", "R$ 100,00" → centavos inteiros. */
  function parseBRLToCentavos(str) {
    var s = String(str == null ? '' : str)
      .trim()
      .replace(/[R$\s]/gi, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else if ((s.match(/\./g) || []).length > 1) {
      s = s.replace(/\./g, '');
    }
    var n = Number(s);
    if (!Number.isFinite(n) || n < 0) return NaN;
    return Math.round(n * 100 + Number.EPSILON);
  }

  function formatCentavosToBRLInput(centavos) {
    var c = Number(centavos);
    if (!Number.isFinite(c)) return '';
    return (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function parsePercentualInput(str) {
    var s = String(str == null ? '' : str)
      .trim()
      .replace(/%/g, '')
      .replace(',', '.');
    if (!s) return NaN;
    var n = Number(s);
    if (!Number.isFinite(n) || n < 0 || n > 100) return NaN;
    return n;
  }

  function syncCompCampo(wrap) {
    var tipo = wrap.querySelector('.ap-tipo').value;
    var lab = wrap.querySelector('.ap-comp-valor-lab');
    var inp = wrap.querySelector('.ap-comp-valor');
    var hint = wrap.querySelector('.ap-comp-hint');
    if (!inp || !lab || !hint) return;

    if (tipo === 'PERCENTUAL') {
      lab.textContent = '% do frete';
      inp.setAttribute('inputmode', 'decimal');
      inp.placeholder = 'ex. 2,5';
      var pct = parsePercentualInput(inp.value);
      hint.textContent = Number.isFinite(pct)
        ? 'Será cobrado ' + String(pct).replace('.', ',') + '% do frete da carga.'
        : 'Digite o percentual (0 a 100). Ex.: 2,5';
      return;
    }

    lab.textContent = tipo === 'POR_CARGA_ANUNCIADA' ? 'Valor por anúncio (R$)' : 'Valor (R$)';
    inp.setAttribute('inputmode', 'decimal');
    inp.placeholder = 'ex. 100,00';
    var cent = parseBRLToCentavos(inp.value);
    if (!Number.isFinite(cent)) {
      hint.textContent =
        tipo === 'POR_CARGA_ANUNCIADA'
          ? 'Digite em reais. Ex.: 15,00 → R$ 15,00 por anúncio.'
          : 'Digite em reais. Ex.: 100,00 → R$ 100,00.';
      return;
    }
    if (tipo === 'POR_CARGA_ANUNCIADA') {
      hint.textContent = 'Por anúncio · ' + fmtBRL(cent) + ' cada oferta publicada.';
    } else {
      hint.textContent = 'Valor fixo · ' + fmtBRL(cent) + ' na cobrança.';
    }
  }

  function compRow(grupo, data) {
    data = data || {};
    var tipoIni = String(data.TIPO || data.tipo || 'FIXO').toUpperCase();
    var valorIni = '';
    if (tipoIni === 'PERCENTUAL') {
      if (data.PERCENTUAL != null || data.percentual != null) {
        valorIni = String(data.PERCENTUAL != null ? data.PERCENTUAL : data.percentual).replace('.', ',');
      }
    } else if (data.VALOR_CENTAVOS != null || data.valorCentavos != null) {
      valorIni = formatCentavosToBRLInput(
        data.VALOR_CENTAVOS != null ? data.VALOR_CENTAVOS : data.valorCentavos
      );
    }

    var wrap = document.createElement('div');
    wrap.className = 'ap-comp-row';
    wrap.dataset.grupo = grupo;
    wrap.innerHTML =
      '<div class="ap-comp-fields">' +
      '<div><label>Tipo da regra</label><select class="form-control ap-tipo">' +
      '<option value="FIXO">Valor fixo</option>' +
      '<option value="PERCENTUAL">% do frete</option>' +
      (grupo === 'USO_PLATAFORMA' ? '<option value="POR_CARGA_ANUNCIADA">Por anúncio</option>' : '') +
      '</select></div>' +
      '<div><label class="ap-comp-valor-lab">Valor (R$)</label>' +
      '<input class="form-control ap-comp-valor" type="text" inputmode="decimal" autocomplete="off" /></div>' +
      '<div><label>&nbsp;</label><button type="button" class="btn-filtro btn-filtro-limpar ap-rm" title="Remover"><i class="bx bx-trash"></i></button></div>' +
      '</div>' +
      '<div class="ap-comp-hint"></div>';

    var tipo = wrap.querySelector('.ap-tipo');
    var inp = wrap.querySelector('.ap-comp-valor');
    tipo.value = tipoIni;
    if (valorIni !== '' && valorIni != null) inp.value = valorIni;

    var prevTipo = tipo.value;
    tipo.onchange = function () {
      var container = wrap.parentElement;
      var escolhido = tipo.value;
      if (container && tiposUsadosNoGrupo(container, wrap).indexOf(escolhido) >= 0) {
        notify('Já existe uma linha deste tipo. Tipos diferentes somam; o mesmo tipo não pode repetir.', 'warning');
        tipo.value = prevTipo;
        return;
      }
      if (prevTipo !== escolhido) inp.value = '';
      prevTipo = escolhido;
      syncCompCampo(wrap);
      atualizarBotoesAddComp();
      inp.focus();
    };
    inp.oninput = function () {
      syncCompCampo(wrap);
    };
    inp.onblur = function () {
      var t = tipo.value;
      if (t === 'PERCENTUAL') {
        var p = parsePercentualInput(inp.value);
        if (Number.isFinite(p)) inp.value = String(p).replace('.', ',');
      } else {
        var c = parseBRLToCentavos(inp.value);
        if (Number.isFinite(c)) inp.value = formatCentavosToBRLInput(c);
      }
      syncCompCampo(wrap);
    };
    wrap.querySelector('.ap-rm').onclick = function () {
      wrap.remove();
      atualizarBotoesAddComp();
    };
    syncCompCampo(wrap);
    return wrap;
  }

  function tiposPermitidosGrupo(grupo) {
    if (grupo === 'USO_PLATAFORMA') return ['FIXO', 'PERCENTUAL', 'POR_CARGA_ANUNCIADA'];
    return ['FIXO', 'PERCENTUAL'];
  }

  function tiposUsadosNoGrupo(container, exceptRow) {
    return Array.from(container.querySelectorAll('.ap-comp-row'))
      .filter(function (row) {
        return row !== exceptRow;
      })
      .map(function (row) {
        return row.querySelector('.ap-tipo').value;
      });
  }

  function proximoTipoLivre(container, grupo) {
    var usados = tiposUsadosNoGrupo(container, null);
    var livres = tiposPermitidosGrupo(grupo).filter(function (t) {
      return usados.indexOf(t) < 0;
    });
    return livres.length ? livres[0] : null;
  }

  function limparTiposDuplicadosNoGrupo(container) {
    if (!container) return;
    var vistos = {};
    Array.from(container.querySelectorAll('.ap-comp-row')).forEach(function (row) {
      var sel = row.querySelector('.ap-tipo');
      if (!sel) return;
      var t = sel.value;
      if (vistos[t]) {
        row.remove();
        return;
      }
      vistos[t] = true;
    });
  }

  function sincronizarOpcoesTipo(container) {
    if (!container) return;
    var rows = Array.from(container.querySelectorAll('.ap-comp-row'));
    rows.forEach(function (row) {
      var sel = row.querySelector('.ap-tipo');
      if (!sel) return;
      var usados = tiposUsadosNoGrupo(container, row);
      Array.from(sel.options).forEach(function (opt) {
        opt.disabled = opt.value !== sel.value && usados.indexOf(opt.value) >= 0;
      });
    });
  }

  /** Atlas (sessão default) edita Uso SaaS; agenciador só vê / republica Conexão. */
  function podeEditarUsoAtlas() {
    return !!podeOperarAgentes;
  }

  function aplicarTravaUsoPlataforma() {
    var atlas = podeEditarUsoAtlas();
    var painelB = document.querySelector('.ap-painel-b');
    var uso = document.getElementById('compsUso');
    var btnUso = document.getElementById('btnAddUso');
    var cfgRegra = document.getElementById('cfgRegra');
    var cfgPol = document.getElementById('cfgPol');
    var aviso = document.getElementById('apAvisoUsoAtlas');
    if (aviso) aviso.style.display = atlas ? 'none' : '';
    if (cfgRegra) cfgRegra.disabled = !atlas;
    if (cfgPol) cfgPol.disabled = !atlas;
    if (btnUso) {
      btnUso.style.display = atlas ? '' : 'none';
      if (!atlas) btnUso.disabled = true;
    }
    if (painelB) painelB.classList.toggle('ap-painel-readonly', !atlas);
    if (uso) {
      Array.from(uso.querySelectorAll('.ap-comp-row')).forEach(function (row) {
        var tipo = row.querySelector('.ap-tipo');
        var inp = row.querySelector('.ap-comp-valor');
        var rm = row.querySelector('.ap-rm');
        if (tipo) tipo.disabled = !atlas;
        if (inp) inp.readOnly = !atlas;
        if (rm) rm.style.display = atlas ? '' : 'none';
      });
    }
  }

  function atualizarBotoesAddComp() {
    var cx = document.getElementById('compsConexao');
    var uso = document.getElementById('compsUso');
    var btnCx = document.getElementById('btnAddConexao');
    var btnUso = document.getElementById('btnAddUso');
    limparTiposDuplicadosNoGrupo(cx);
    limparTiposDuplicadosNoGrupo(uso);
    sincronizarOpcoesTipo(cx);
    sincronizarOpcoesTipo(uso);
    if (btnCx && cx) {
      var livreCx = proximoTipoLivre(cx, 'CONEXAO');
      btnCx.disabled = !livreCx;
      btnCx.title = livreCx
        ? 'Adicionar outro tipo de regra'
        : 'Já há uma linha para cada tipo de conexão (fixo e %).';
    }
    if (btnUso && uso) {
      if (!podeEditarUsoAtlas()) {
        btnUso.disabled = true;
        btnUso.title = 'Somente a Atlas define o Uso da plataforma (SaaS).';
      } else {
        var livreUso = proximoTipoLivre(uso, 'USO_PLATAFORMA');
        btnUso.disabled = !livreUso;
        btnUso.title = livreUso
          ? 'Adicionar outro tipo de regra'
          : 'Já há uma linha para cada tipo de uso (fixo, % e por anúncio).';
      }
    }
    aplicarTravaUsoPlataforma();
  }

  function adicionarComponente(grupo) {
    if (grupo === 'USO_PLATAFORMA' && !podeEditarUsoAtlas()) {
      notify('Uso da plataforma (SaaS) só a Atlas altera.', 'error');
      return;
    }
    var id = grupo === 'USO_PLATAFORMA' ? 'compsUso' : 'compsConexao';
    var container = document.getElementById(id);
    if (!container) return;
    var livre = proximoTipoLivre(container, grupo);
    if (!livre) {
      notify(
        grupo === 'USO_PLATAFORMA'
          ? 'Uso: no máximo 1 linha por tipo (fixo, % do frete, por anúncio).'
          : 'Conexão: no máximo 1 linha por tipo (fixo e % do frete).',
        'warning'
      );
      atualizarBotoesAddComp();
      return;
    }
    container.appendChild(compRow(grupo, { TIPO: livre }));
    atualizarBotoesAddComp();
  }

  function validarComponentesSemDuplicar(comps, labelGrupo) {
    var seen = {};
    for (var i = 0; i < comps.length; i++) {
      var t = String(comps[i].tipo || '').toUpperCase();
      if (seen[t]) {
        return (
          labelGrupo +
          ': tipo "' +
          labelTipoComp(t) +
          '" repetido. Deixe só uma linha por tipo (tipos diferentes somam).'
        );
      }
      seen[t] = true;
    }
    return null;
  }

  function lerComponentes(container, grupo) {
    return Array.from(container.querySelectorAll('.ap-comp-row')).map(function (row, i) {
      var tipo = row.querySelector('.ap-tipo').value;
      var raw = row.querySelector('.ap-comp-valor').value;
      var o = { grupo: grupo, tipo: tipo, fgAtivo: 'S', ordem: i };
      if (tipo === 'PERCENTUAL') {
        o.percentual = parsePercentualInput(raw);
      } else {
        o.valorCentavos = parseBRLToCentavos(raw);
      }
      return o;
    });
  }

  function rotuloTenantResumo(row) {
    var tid = String(row.tenant_id || row.TENANT_ID || '');
    var nm = row.nm_cliente || row.NM_CLIENTE || '';
    if (tid === 'default' && !nm) return 'Instalação padrão (default)';
    if (nm && nm !== tid) return nm + ' (' + tid + ')';
    return tid || '—';
  }

  function irTenantCobrancas(tid) {
    var sel = document.getElementById('apAgenteSelect');
    if (!tid || !sel) return;
    dataTenantId = tid;
    sel.value = tid;
    try {
      sessionStorage.setItem(STORAGE_AGENTE, dataTenantId);
    } catch (e) {}
    atualizarLabelAgente();
    var tabBtn = document.querySelector(
      '.atlas-pay-container .tabs .tab-btn[data-tab="cobrancas"]'
    );
    if (tabBtn) tabBtn.click();
    else {
      recarregarAposTrocaAgente().catch(function (err) {
        notify(err.message || 'Falha ao abrir tenant.', 'error');
      });
    }
  }

  function renderTabelaResumoTenants(host, lista, emptyMsg) {
    if (!host) return;
    var rows = Array.isArray(lista) ? lista : [];
    if (!rows.length) {
      host.innerHTML =
        '<p class="empty" style="padding:16px;margin:0">' + emptyMsg + '</p>';
      return;
    }
    host.innerHTML =
      '<table class="grid-table estatisticas-table"><thead><tr>' +
      '<th>Tenant / empresa</th><th>Abertas</th><th>Em aberto</th><th>Pagas</th><th></th>' +
      '</tr></thead><tbody>' +
      rows
        .map(function (row) {
          var tid = String(row.tenant_id || row.TENANT_ID || '');
          return (
            '<tr>' +
            '<td><strong>' +
            String(rotuloTenantResumo(row)).replace(/</g, '&lt;') +
            '</strong></td>' +
            '<td>' +
            (row.abertas || 0) +
            '</td>' +
            '<td>' +
            fmtBRL(row.centavos_abertos) +
            '</td>' +
            '<td>' +
            fmtBRL(row.centavos_pagos) +
            '</td>' +
            '<td><button type="button" class="btn-filtro btn-filtro-aplicar btn-sm ap-resumo-ir-tenant" data-tenant="' +
            String(tid).replace(/"/g, '') +
            '"><i class="bx bx-right-arrow-alt"></i> Abrir</button></td>' +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>';
    host.querySelectorAll('.ap-resumo-ir-tenant').forEach(function (btn) {
      btn.onclick = function () {
        irTenantCobrancas(btn.getAttribute('data-tenant'));
      };
    });
  }

  function renderQuemDeve(lista) {
    renderTabelaResumoTenants(
      document.getElementById('apResumoDevedores'),
      lista,
      'Ninguém com cobrança de uso em aberto no momento.'
    );
  }

  function renderQuemRecebeConexao(lista) {
    renderTabelaResumoTenants(
      document.getElementById('apResumoConexao'),
      lista,
      'Nenhuma conexão em aberto no momento.'
    );
  }

  async function loadResumo() {
    var querConsolidado = String(dataTenantId) === TENANT_TODOS;
    var data = querConsolidado
      ? await api('/resumo?consolidado=1', { semTenantAlvo: true })
      : await api('/resumo');
    var consolidado = !!(querConsolidado && data && data.consolidado);
    if (querConsolidado && !consolidado) {
      notify(
        'Painel consolidado indisponível no servidor. Reinicie o backend e atualize a página.',
        'error'
      );
    }
    var r = data.resumo || {};
    var ban = document.getElementById('apInadBanner');
    var banTxt = document.getElementById('apInadTexto');
    var hint = document.getElementById('apResumoEscopoHint');
    var boxDev = document.getElementById('apResumoDevedoresBox');
    var boxCtr = document.getElementById('apContratoResumoBox');
    if (hint) {
      hint.style.display = podeOperarAgentes && !consolidado ? '' : 'none';
    }
    var boxCx = document.getElementById('apResumoConexaoBox');
    if (boxDev) boxDev.style.display = consolidado ? '' : 'none';
    if (boxCx) boxCx.style.display = consolidado ? '' : 'none';
    if (boxCtr) boxCtr.style.display = consolidado ? 'none' : '';
    if (consolidado) {
      renderQuemRecebeConexao(data.quemRecebeConexao || []);
      renderQuemDeve(data.quemDeve || []);
    }
    if (ban && banTxt) {
      if (consolidado) {
        ban.style.display = 'none';
        banTxt.textContent = '';
      } else if (data.inadimplencia && data.inadimplencia.modo === 'BLOQUEADO') {
        ban.style.display = '';
        banTxt.textContent =
          (data.warning && data.warning.message) ||
          data.inadimplencia.motivo ||
          'Operação bloqueada por inadimplência.';
        notify(banTxt.textContent, 'error');
      } else if (data.warning && data.warning.message) {
        // ALERTA: só faixa na visão geral — não toast a cada carga/baixa
        ban.style.display = '';
        banTxt.textContent = data.warning.message;
      } else {
        ban.style.display = 'none';
        banTxt.textContent = '';
      }
    }
    if (consolidado) {
      var rcx = data.resumoConexao || {};
      document.getElementById('apKpis').innerHTML =
        '<div class="dashboard-stat-card primary">' +
        '<div class="stat-card-icon"><i class="bx bx-user"></i></div>' +
        '<div class="stat-card-content"><h4>A · Conexão em aberto</h4><p class="stat-value">' +
        fmtBRL(rcx.centavos_abertos) +
        '</p><p class="stat-sub">' +
        (rcx.abertas || 0) +
        ' cobrança(s) · motorista → agenciadores</p></div></div>' +
        '<div class="dashboard-stat-card success">' +
        '<div class="stat-card-icon"><i class="bx bx-check-circle"></i></div>' +
        '<div class="stat-card-content"><h4>A · Conexão paga</h4><p class="stat-value">' +
        fmtBRL(rcx.centavos_pagos) +
        '</p></div></div>' +
        '<div class="dashboard-stat-card warning">' +
        '<div class="stat-card-icon"><i class="bx bx-buildings"></i></div>' +
        '<div class="stat-card-content"><h4>B · Uso em aberto</h4><p class="stat-value">' +
        fmtBRL(r.centavos_abertos) +
        '</p><p class="stat-sub">' +
        (r.abertas || 0) +
        ' cobrança(s) · agenciador → Atlas</p></div></div>' +
        '<div class="dashboard-stat-card info">' +
        '<div class="stat-card-icon"><i class="bx bx-wallet"></i></div>' +
        '<div class="stat-card-content"><h4>B · Uso pago</h4><p class="stat-value">' +
        fmtBRL(r.centavos_pagos) +
        '</p><p class="stat-sub">' +
        (r.canceladas || 0) +
        ' uso cancelada(s)</p></div></div>';
    } else {
      // Tenant selecionado (não confundir com a sessão default no topo).
      var nomeAg = rotuloAgenteOperando();
      document.getElementById('apKpis').innerHTML =
        '<div class="dashboard-stat-card primary">' +
        '<div class="stat-card-icon"><i class="bx bx-user"></i></div>' +
        '<div class="stat-card-content"><h4>A · Conexão a receber</h4><p class="stat-value">' +
        fmtBRL(r.centavos_abertos_conexao) +
        '</p><p class="stat-sub">' +
        (r.abertas_conexao || 0) +
        ' aberta(s) · motorista → <strong>' +
        String(nomeAg).replace(/</g, '&lt;') +
        '</strong></p></div></div>' +
        '<div class="dashboard-stat-card warning">' +
        '<div class="stat-card-icon"><i class="bx bx-buildings"></i></div>' +
        '<div class="stat-card-content"><h4>B · Uso a pagar (Atlas)</h4><p class="stat-value">' +
        fmtBRL(r.centavos_abertos_uso) +
        '</p><p class="stat-sub">' +
        (r.abertas_uso || 0) +
        ' aberta(s) · <strong>' +
        String(nomeAg).replace(/</g, '&lt;') +
        '</strong> → Atlas (default)</p></div></div>' +
        '<div class="dashboard-stat-card success">' +
        '<div class="stat-card-icon"><i class="bx bx-check-circle"></i></div>' +
        '<div class="stat-card-content"><h4>Pagas (todas)</h4><p class="stat-value">' +
        fmtBRL(r.centavos_pagos) +
        '</p></div></div>' +
        '<div class="dashboard-stat-card info">' +
        '<div class="stat-card-icon"><i class="bx bx-x-circle"></i></div>' +
        '<div class="stat-card-content"><h4>Canceladas</h4><p class="stat-value">' +
        (r.canceladas || 0) +
        '</p></div></div>';
    }

    var c = data.contratoVigente;
    var el = document.getElementById('apContratoResumo');
    if (!el) return;
    if (consolidado) {
      el.innerHTML = '';
    } else if (!c) {
      el.innerHTML =
        'Nenhum contrato vigente. <strong>A · Conexão</strong> você configura; <strong>B · Uso</strong> só a Atlas (default) publica.';
    } else {
      el.innerHTML =
        'Versão <strong>' +
        c.versao +
        '</strong> · Regra ' +
        (c.fgRegraAtiva === 'S'
          ? '<span class="ap-badge on">Ligada</span>'
          : '<span class="ap-badge off">Desligada</span>') +
        ' · Inadimplência: ' +
        (c.politicaInadimplencia === 'BLOQUEIO' ? 'bloqueio' : 'alerta') +
        '<br><span style="font-size:13px"><strong>A</strong> = preço deste tenant (conexão). <strong>B</strong> = tabela Atlas. Detalhe na aba Contratos.</span>';
    }
  }

  var contratoSelId = null;

  function resumoCell(texto, qtd) {
    var t = String(texto == null ? '' : texto).trim();
    var n = Number(qtd);
    if (!t && !(n > 0)) {
      return '<span class="ap-resumo-comp empty">Sem componente</span>';
    }
    return '<div class="ap-resumo-comp">' + (t || n + ' item(ns)') + '</div>';
  }

  function pickContratoField(row, upperKey) {
    if (!row) return undefined;
    if (row[upperKey] != null) return row[upperKey];
    var lower = String(upperKey).toLowerCase();
    if (row[lower] != null) return row[lower];
    return undefined;
  }

  function fecharContratoModal() {
    var m = document.getElementById('apContratoModal');
    if (m) m.style.display = 'none';
  }

  function bindContratoModalOnce() {
    if (bindContratoModalOnce.done) return;
    bindContratoModalOnce.done = true;
    var modal = document.getElementById('apContratoModal');
    if (!modal) return;
    var x = document.getElementById('apContratoModalX');
    var f = document.getElementById('btnFecharContratoModal');
    if (x) x.onclick = fecharContratoModal;
    if (f) f.onclick = fecharContratoModal;
    modal.querySelectorAll('[data-close-ctr-modal]').forEach(function (el) {
      el.onclick = fecharContratoModal;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && modal.style.display === 'flex') fecharContratoModal();
    });
    var btnBase = document.getElementById('btnUsarBaseContrato');
    if (btnBase) {
      btnBase.onclick = function () {
        if (!contratoSelId) return;
        aplicarContratoComoBase(contratoSelId).catch(function (e) {
          notify(e.message || 'Falha ao carregar versão.', 'error');
        });
      };
    }
  }

  function preencherEditorContrato(contrato) {
    var cx = document.getElementById('compsConexao');
    var uso = document.getElementById('compsUso');
    cx.innerHTML = '';
    uso.innerHTML = '';
    document.getElementById('cfgRegra').value = contrato.FG_REGRA_ATIVA === 'S' ? 'S' : 'N';
    document.getElementById('cfgPol').value =
      contrato.POLITICA_INADIMPLENCIA === 'BLOQUEIO' ? 'BLOQUEIO' : 'ALERTA';
    var vistos = { CONEXAO: {}, USO_PLATAFORMA: {} };
    (contrato.componentes || []).forEach(function (comp) {
      var g = String(comp.GRUPO || comp.grupo || '').toUpperCase();
      var t = String(comp.TIPO || comp.tipo || 'FIXO').toUpperCase();
      if (g !== 'CONEXAO' && g !== 'USO_PLATAFORMA') return;
      if (vistos[g][t]) return;
      vistos[g][t] = true;
      if (g === 'CONEXAO') cx.appendChild(compRow('CONEXAO', comp));
      else uso.appendChild(compRow('USO_PLATAFORMA', comp));
    });
    if (!cx.children.length) cx.appendChild(compRow('CONEXAO', { TIPO: 'FIXO', VALOR_CENTAVOS: 10000 }));
    atualizarBotoesAddComp();
  }

  async function aplicarContratoComoBase(id) {
    var d = await api('/contratos/' + id);
    preencherEditorContrato(d.contrato);
    fecharContratoModal();
    var tabBtn = document.querySelector('.atlas-pay-container .tabs .tab-btn[data-tab="contrato"]');
    if (tabBtn) tabBtn.click();
    clearInlineMsg(document.getElementById('msgContrato'));
    notify(
      'Versão ' +
        (d.contrato.VERSAO || '') +
        ' carregada no editor. Ajuste o que precisar e clique em Publicar versão (não altera o histórico antigo).',
      'success'
    );
    var editor = document.querySelector('#tab-contrato .filtros-box');
    if (editor && editor.scrollIntoView) editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function abrirContratoDetalhe(id) {
    bindContratoModalOnce();
    contratoSelId = id;
    var d = await api('/contratos/' + id);
    var c = d.contrato;
    var idEl = document.getElementById('apContratoModalId');
    if (idEl) idEl.textContent = 'v' + c.VERSAO;
    var comps = c.componentes || [];
    var cx = comps.filter(function (x) {
      return String(x.GRUPO || '').toUpperCase() === 'CONEXAO';
    });
    var uso = comps.filter(function (x) {
      return String(x.GRUPO || '').toUpperCase() === 'USO_PLATAFORMA';
    });
    function lista(arr, vazio) {
      if (!arr.length) return '<p class="atlas-pay-info">' + vazio + '</p>';
      return (
        '<ul class="ap-cob-events">' +
        arr
          .map(function (x) {
            return '<li>' + fmtCompLinha(x) + '</li>';
          })
          .join('') +
        '</ul>'
      );
    }
    document.getElementById('apContratoModalBody').innerHTML =
      '<div class="ap-cob-grid">' +
      cobField(
        'Regra',
        c.FG_REGRA_ATIVA === 'S' ? '<span class="ap-badge on">Ligada</span>' : '<span class="ap-badge off">Desligada</span>'
      ) +
      cobField('Inadimplência', c.POLITICA_INADIMPLENCIA === 'BLOQUEIO' ? 'Bloqueio' : 'Alerta') +
      cobField('Início', fmtQuando(c.DH_INICIO)) +
      cobField('Fim', c.DH_FIM ? fmtQuando(c.DH_FIM) : 'Vigente') +
      '</div>' +
      '<div class="ap-grupo" style="margin-top:8px">' +
      '<div class="ap-painel-grupo ap-painel-a"><div class="ap-painel-head"><span class="ap-painel-tag">A</span><div><h3>Conexão</h3><p>Deste tenant · motorista → agenciador</p></div></div>' +
      lista(cx, 'Nenhum componente de conexão nesta versão.') +
      '</div>' +
      '<div class="ap-painel-grupo ap-painel-b"><div class="ap-painel-head"><span class="ap-painel-tag">B</span><div><h3>Uso da plataforma</h3><p>Tabela Atlas (default) · agenciador → Atlas</p></div></div>' +
      lista(uso, 'Nenhum componente de uso nesta versão.') +
      '</div></div>' +
      '<p class="atlas-pay-info" style="margin-top:12px">A = preço deste agenciador. B = tabela comercial da Atlas (só o default altera). Versões não se editam; use como base e publique outra.</p>';
    document.getElementById('apContratoModal').style.display = 'flex';
  }

  async function loadContratos() {
    var data = await api('/contratos');
    var rowsRaw = data.contratos || [];
    contratosPorId = {};
    var rows = rowsRaw.map(function (c) {
      var id = String(c.ID);
      contratosPorId[id] = c;
      var vigente = !c.DH_FIM;
      return {
        ID: id,
        VERSAO_HTML:
          '<strong>v' +
          c.VERSAO +
          '</strong>' +
          (vigente ? ' <span class="ap-badge on">Vigente</span>' : ''),
        VERSAO_SORT: Number(c.VERSAO) || 0,
        REGRA_HTML:
          c.FG_REGRA_ATIVA === 'S'
            ? '<span class="ap-badge on">Ligada</span>'
            : '<span class="ap-badge off">Desligada</span>',
        CONEXAO: resumoCell(pickContratoField(c, 'RESUMO_CONEXAO'), pickContratoField(c, 'QTD_CONEXAO')),
        USO: resumoCell(pickContratoField(c, 'RESUMO_USO'), pickContratoField(c, 'QTD_USO')),
        INICIO: fmtQuando(c.DH_INICIO),
        FIM: c.DH_FIM ? fmtQuando(c.DH_FIM) : '—',
      };
    });
    setGridCount('contratosGridCountText', rows.length);
    var wrap = document.getElementById('contratosGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">Nenhuma versão ainda. Publique a primeira acima.</p>';
    } else if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
    } else {
      gridContratos = null;
      wrap.innerHTML = '';
      gridContratos = ensureGrid('#contratosGrid', gridContratos, function () {
        return new window.GridEditor({
          container: '#contratosGrid',
          columns: [
            { field: 'ID', header: 'ID', editable: false, isId: true, hidden: true },
            {
              field: 'VERSAO_HTML',
              header: 'Versão',
              editable: false,
              width: '120px',
              format: function (v) {
                return v;
              },
            },
            {
              field: 'REGRA_HTML',
              header: 'Regra',
              editable: false,
              width: '110px',
              format: function (v) {
                return v;
              },
            },
            { field: 'CONEXAO', header: 'A · Conexão (deste tenant)', editable: false },
            { field: 'USO', header: 'B · Uso (Atlas / default)', editable: false },
            { field: 'INICIO', header: 'Início', editable: false, width: '140px' },
            { field: 'FIM', header: 'Fim', editable: false, width: '140px' },
          ],
          canDeleteRow: function () {
            return false;
          },
          onBeforeEdit: function (id) {
            abrirContratoDetalhe(id).catch(function (e) {
              notify(e.message || 'Falha ao abrir contrato.', 'error');
            });
            return false;
          },
          onDelete: function () {},
        });
      });
      if (gridContratos) gridContratos.render(rows);
    }

    var vig = await api('/contratos/vigente');
    if (vig.contrato) {
      preencherEditorContrato(vig.contrato);
    } else {
      var cx = document.getElementById('compsConexao');
      var uso = document.getElementById('compsUso');
      cx.innerHTML = '';
      uso.innerHTML = '';
      document.getElementById('cfgRegra').value = 'S';
      document.getElementById('cfgPol').value = 'ALERTA';
      if (podeEditarUsoAtlas()) {
        cx.appendChild(compRow('CONEXAO', { TIPO: 'FIXO', VALOR_CENTAVOS: 10000 }));
      } else {
        notify(
          'Ainda não há contrato neste tenant. A Atlas precisa publicar a tabela comercial (Uso) antes.',
          'warning'
        );
      }
      atualizarBotoesAddComp();
    }
  }

  var cobSelId = null;

  function cobField(label, value) {
    return (
      '<div class="ap-cob-field"><strong>' +
      label +
      '</strong><span>' +
      value +
      '</span></div>'
    );
  }

  function labelModalidade(m) {
    var s = String(m || '').toUpperCase();
    if (s === 'USO_PLATAFORMA') return 'B · Uso (agenciador → Atlas)';
    if (s === 'CONEXAO') return 'A · Conexão (motorista → agenciador)';
    return dash(m);
  }

  function badgeModalidade(m) {
    var s = String(m || '').toUpperCase();
    if (s === 'USO_PLATAFORMA') {
      return '<span class="ap-badge-mod ap-badge-mod-b">B · Uso</span>';
    }
    if (s === 'CONEXAO') {
      return '<span class="ap-badge-mod ap-badge-mod-a">A · Conexão</span>';
    }
    return dash(m);
  }

  function direcaoCob(c) {
    var s = String((c && c.MODALIDADE) || '').toUpperCase();
    if (s === 'USO_PLATAFORMA') return 'Agenciador → Atlas';
    if (s === 'CONEXAO') return 'Motorista → agenciador';
    return '—';
  }

  function renderResumoCobrancas(rowsRaw) {
    var box = document.getElementById('cobResumoModalidade');
    if (!box) return;
    var abertas = (rowsRaw || []).filter(function (c) {
      return String(c.STATUS || '').toUpperCase() === 'ABERTA';
    });
    var cx = 0;
    var uso = 0;
    var nCx = 0;
    var nUso = 0;
    abertas.forEach(function (c) {
      var v = Number(c.VALOR_CENTAVOS) || 0;
      if (String(c.MODALIDADE || '').toUpperCase() === 'USO_PLATAFORMA') {
        uso += v;
        nUso += 1;
      } else if (String(c.MODALIDADE || '').toUpperCase() === 'CONEXAO') {
        cx += v;
        nCx += 1;
      }
    });
    var nomeAg = rotuloAgenteOperando();
    var nomeEsc = String(nomeAg).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    box.innerHTML =
      '<div class="ap-cob-chip ap-cob-chip-a">' +
      '<strong>A · Conexão aberta</strong>' +
      '<span class="ap-cob-chip-val">' +
      fmtBRL(cx) +
      '</span>' +
      '<span class="ap-cob-chip-sub">' +
      nCx +
      ' cobrança(s) · motorista → <strong>' +
      nomeEsc +
      '</strong> (agenciador da viagem)</span></div>' +
      '<div class="ap-cob-chip ap-cob-chip-b">' +
      '<strong>B · Uso aberto</strong>' +
      '<span class="ap-cob-chip-val">' +
      fmtBRL(uso) +
      '</span>' +
      '<span class="ap-cob-chip-sub">' +
      nUso +
      ' cobrança(s) · <strong>' +
      nomeEsc +
      '</strong> → Atlas (default)</span></div>';
  }

  function fecharDetalheCob() {
    var modal = document.getElementById('apCobModal');
    if (modal) modal.style.display = 'none';
    document.querySelectorAll('#cobrancasGrid tr.ap-row-sel').forEach(function (tr) {
      tr.classList.remove('ap-row-sel');
    });
  }

  function bindCobModalOnce() {
    if (bindCobModalOnce.done) return;
    bindCobModalOnce.done = true;
    var modal = document.getElementById('apCobModal');
    if (!modal) return;
    var btnX = document.getElementById('apCobModalX');
    if (btnX) btnX.onclick = fecharDetalheCob;
    modal.querySelectorAll('[data-close-cob-modal]').forEach(function (el) {
      el.onclick = fecharDetalheCob;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && modal.style.display === 'flex') fecharDetalheCob();
    });
  }

  async function loadCobrancas() {
    var qs = new URLSearchParams();
    var st = document.getElementById('filStatus').value;
    var modEl = document.getElementById('filModalidade');
    var mod = modEl ? modEl.value : '';
    var q = document.getElementById('filQ').value.trim();
    if (st) qs.set('status', st);
    if (mod) qs.set('modalidade', mod);
    if (q) qs.set('q', q);
    var data = await api('/cobrancas?' + qs.toString());
    var rowsRaw = data.cobrancas || [];
    cobrancasPorId = {};
    // Resumo das abertas: se o filtro de status esconde abertas, busca um snapshot rápido.
    if (st && st !== 'ABERTA') {
      try {
        var qsAb = new URLSearchParams();
        qsAb.set('status', 'ABERTA');
        if (mod) qsAb.set('modalidade', mod);
        var ab = await api('/cobrancas?' + qsAb.toString());
        renderResumoCobrancas(ab.cobrancas || []);
      } catch (eRes) {
        renderResumoCobrancas(rowsRaw);
      }
    } else {
      renderResumoCobrancas(rowsRaw);
    }
    var rows = rowsRaw.map(function (c) {
      var id = String(c.ID);
      cobrancasPorId[id] = c;
      return {
        ID: id,
        STATUS_HTML: badgeStatus(c.STATUS),
        STATUS_SORT: c.STATUS || '',
        TIPO_HTML: badgeModalidade(c.MODALIDADE),
        TIPO_SORT: c.MODALIDADE || '',
        DIRECAO: direcaoCob(c),
        PAGADOR: rotuloPagadorCob(c),
        BENEFICIARIO: rotuloBeneficiarioCob(c),
        VIAGEM: dash(c.IDVIAGEM),
        CONVOCACAO: dash(c.IDCONVOCACAO),
        VALOR: fmtBRL(c.VALOR_CENTAVOS),
        VALOR_SORT: Number(c.VALOR_CENTAVOS) || 0,
        QUANDO: fmtQuando(c.DH_CRIACAO),
      };
    });
    setGridCount('cobrancasGridCountText', rows.length);
    var wrap = document.getElementById('cobrancasGrid');
    if (!wrap) return;
    if (!rows.length) {
      var dica =
        st === 'ABERTA'
          ? 'Nenhuma cobrança aberta neste filtro. Troque status ou “Quem → quem”.'
          : 'Nenhuma cobrança neste filtro.';
      wrap.innerHTML = '<p class="empty">' + dica + '</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    // Recria grid quando as colunas mudam (evita cache de colunas antigas).
    gridCobrancas = null;
    wrap.innerHTML = '';
    gridCobrancas = ensureGrid('#cobrancasGrid', gridCobrancas, function () {
      return new window.GridEditor({
        container: '#cobrancasGrid',
        columns: [
          { field: 'ID', header: 'ID', editable: false, isId: true, width: '70px', align: 'right' },
          {
            field: 'TIPO_HTML',
            header: 'Tipo',
            editable: false,
            width: '110px',
            format: function (v) {
              return v;
            },
          },
          { field: 'DIRECAO', header: 'Quem → quem', editable: false, width: '160px' },
          {
            field: 'STATUS_HTML',
            header: 'Status',
            editable: false,
            width: '100px',
            format: function (v) {
              return v;
            },
          },
          { field: 'PAGADOR', header: 'Pagador', editable: false },
          { field: 'BENEFICIARIO', header: 'Beneficiário', editable: false },
          { field: 'VIAGEM', header: 'Viagem', editable: false, width: '80px' },
          { field: 'VALOR', header: 'Valor', editable: false, width: '100px', align: 'right' },
          { field: 'QUANDO', header: 'Quando', editable: false, width: '130px' },
        ],
        canDeleteRow: function () {
          return false;
        },
        onBeforeEdit: function (id) {
          var rowEl = document.querySelector('#cobrancasGrid tr[data-grid-id="' + id + '"]');
          abrirDetalhe(id, rowEl);
          return false;
        },
        onDelete: function () {},
      });
    });
    if (gridCobrancas) gridCobrancas.render(rows);
  }

  function parseMemoriaCobranca(raw) {
    if (raw == null || raw === '' || raw === 'null') return null;
    if (typeof raw === 'object') return raw;
    try {
      return JSON.parse(String(raw));
    } catch (e) {
      return null;
    }
  }

  /** Composição legível (conexão ou uso) a partir da MEMORIA_CALCULO. */
  function htmlComposicaoCobranca(c, mem) {
    if (!mem || typeof mem !== 'object') {
      return '<p class="atlas-pay-info" style="margin-top:10px">Sem composição gravada nesta cobrança.</p>';
    }
    var mod = String(c.MODALIDADE || '').toUpperCase();
    var comps = Array.isArray(mem.componentes) ? mem.componentes : [];
    var linhas = [];
    var base = mem.baseValor != null ? Number(mem.baseValor) : null;
    if (mod === 'CONEXAO') {
      if (base != null && Number.isFinite(base)) {
        linhas.push(cobField('Base frete (VLFRETE)', fmtReais(base)));
      }
      comps.forEach(function (comp) {
        var t = String(comp.tipo || '').toUpperCase();
        if (t === 'FIXO') {
          linhas.push(cobField('Fixo', fmtBRL(comp.valorCentavos)));
        } else if (t === 'PERCENTUAL') {
          var pct = Number(comp.percentual);
          var basePct = comp.baseVlFrete != null ? Number(comp.baseVlFrete) : base;
          var label =
            Number.isFinite(pct) && basePct != null && Number.isFinite(basePct)
              ? pct.toLocaleString('pt-BR', { maximumFractionDigits: 4 }) +
                '% × ' +
                fmtReais(basePct)
              : '% do frete';
          linhas.push(cobField(label, fmtBRL(comp.valorCentavos)));
        } else {
          linhas.push(cobField(t || 'Componente', fmtBRL(comp.valorCentavos)));
        }
      });
      if (mem.totalCentavos != null) {
        linhas.push(cobField('Total', fmtBRL(mem.totalCentavos)));
      }
    } else {
      var bd = mem.breakdown || {};
      var totais = mem.totais || {};
      var fixo = Number(bd.fixoCentavos);
      var pctU = Number(bd.percentualCentavos);
      var anun = Number(bd.anuncioCentavos);
      if (!Number.isFinite(fixo) || !Number.isFinite(pctU) || !Number.isFinite(anun)) {
        fixo = 0;
        pctU = 0;
        anun = 0;
        comps.forEach(function (comp) {
          var t = String(comp.tipo || '').toUpperCase();
          var v = Number(comp.valorCentavos) || 0;
          if (t === 'FIXO') fixo += v;
          else if (t === 'PERCENTUAL') pctU += v;
          else if (t === 'POR_CARGA_ANUNCIADA') anun += v;
        });
      }
      if (totais.basePercentual != null) {
        linhas.push(cobField('Base % (frete)', fmtReais(totais.basePercentual)));
      }
      if (mem.competencia) {
        linhas.push(cobField('Competência', String(mem.competencia)));
      }
      linhas.push(cobField('Fixo (rateado)', fmtBRL(fixo)));
      linhas.push(cobField('% do frete', fmtBRL(pctU)));
      linhas.push(cobField('Por anúncio', fmtBRL(anun)));
      var totalU =
        mem.totalCentavos != null
          ? Number(mem.totalCentavos)
          : totais.totalCentavos != null
            ? Number(totais.totalCentavos)
            : fixo + pctU + anun;
      if (Number.isFinite(totalU)) linhas.push(cobField('Total', fmtBRL(totalU)));
    }
    if (!linhas.length) {
      return '<p class="atlas-pay-info" style="margin-top:10px">Memória sem componentes legíveis.</p>';
    }
    return (
      '<h4 style="margin:12px 0 6px;font-size:14px">Como chegou no total</h4>' +
      '<div class="ap-cob-grid ap-cob-composicao">' +
      linhas.join('') +
      '</div>'
    );
  }

  async function abrirDetalhe(id, rowEl) {
    bindCobModalOnce();
    cobSelId = id;
    document.querySelectorAll('#cobrancasGrid tr.ap-row-sel').forEach(function (tr) {
      tr.classList.remove('ap-row-sel');
    });
    if (rowEl) rowEl.classList.add('ap-row-sel');

    var data = await api('/cobrancas/' + id);
    var c = data.cobranca;
    var modal = document.getElementById('apCobModal');
    var body = document.getElementById('apCobModalBody');
    var idEl = document.getElementById('apCobModalId');
    if (idEl) idEl.textContent = '#' + c.ID;

    var memParsed = parseMemoriaCobranca(c.MEMORIA_CALCULO);
    var memTxt = memParsed ? JSON.stringify(memParsed, null, 2) : '';
    if (!memTxt && c.MEMORIA_CALCULO != null && c.MEMORIA_CALCULO !== '' && c.MEMORIA_CALCULO !== 'null') {
      memTxt = String(c.MEMORIA_CALCULO);
    }

    var eventos = c.eventos || [];
    var evHtml = !eventos.length
      ? '<p class="atlas-pay-info">Nenhum evento registrado.</p>'
      : '<ul class="ap-cob-events">' +
        eventos
          .map(function (e) {
            return (
              '<li><strong>' +
              fmtQuando(e.DH_EVENTO) +
              '</strong> — ' +
              dash(e.TIPO) +
              (e.DETALHE ? ': ' + e.DETALHE : '') +
              '</li>'
            );
          })
          .join('') +
        '</ul>';

    body.innerHTML =
      '<div class="ap-cob-grid">' +
      cobField('Situação', badgeStatus(c.STATUS)) +
      cobField('Tipo', badgeModalidade(c.MODALIDADE) + ' · ' + direcaoCob(c)) +
      cobField('Valor', fmtBRL(c.VALOR_CENTAVOS)) +
      cobField('Criada em', fmtQuando(c.DH_CRIACAO)) +
      cobField('Pagador', rotuloPagadorCob(c)) +
      cobField('Beneficiário', rotuloBeneficiarioCob(c)) +
      cobField('Viagem', dash(c.IDVIAGEM)) +
      cobField('Convocação', dash(c.IDCONVOCACAO)) +
      cobField(
        'Contrato',
        c.ID_CONTRATO || c.VERSAO_CONTRATO
          ? 'v' + dash(c.VERSAO_CONTRATO) + ' (id ' + dash(c.ID_CONTRATO) + ')'
          : '—'
      ) +
      cobField('Ciclo', dash(c.ID_CICLO_CONFIRMACAO)) +
      '</div>' +
      '<p class="atlas-pay-info" style="margin-top:8px">' +
      (String(c.MODALIDADE || '').toUpperCase() === 'USO_PLATAFORMA'
        ? 'Esta é dívida SaaS: <strong>agenciador → Atlas (default)</strong>.'
        : 'Esta é conexão: <strong>motorista → ' +
          String(rotuloBeneficiarioCob(c) || 'agenciador').replace(/</g, '&lt;') +
          '</strong> (recebe quem opera a oferta).') +
      '</p>' +
      htmlComposicaoCobranca(c, memParsed) +
      '<h4 style="margin:12px 0 6px;font-size:14px">Eventos</h4>' +
      evHtml +
      (memTxt
        ? '<details class="ap-fech-tech" style="margin-top:12px"><summary><i class="bx bx-code-alt"></i> Memória de cálculo (técnico)</summary><pre class="ap-detalhe-pre">' +
          memTxt.replace(/</g, '&lt;') +
          '</pre></details>'
        : '<p class="atlas-pay-info" style="margin-top:12px">Sem memória de cálculo nesta cobrança.</p>');

    var modCob = String(c.MODALIDADE || '').toUpperCase();
    var sess = String(sessionTenantId || '').trim();
    var sessDefault = sess === 'default';
    var operandoOutro = sessDefault && String(dataTenantId || '') !== 'default';
    // Beneficiário baixa: Conexão = agenciador; Uso = só Atlas (default).
    var bloqueado =
      (modCob === 'CONEXAO' && operandoOutro) ||
      (modCob === 'USO_PLATAFORMA' && !sessDefault);
    var podeBaixaUi =
      c.STATUS === 'ABERTA' && hasPerm('FIN_COBRANCA_BAIXAR') && !bloqueado;
    var podeCancUi =
      (c.STATUS === 'ABERTA' || c.STATUS === 'PAGA') &&
      hasPerm('FIN_COBRANCA_CANCELAR') &&
      !bloqueado;

    var baixaBox = document.getElementById('apBaixaBox');
    if (baixaBox) {
      baixaBox.style.display = c.STATUS === 'ABERTA' || bloqueado ? 'flex' : 'none';
    }
    var btnBaixa = document.getElementById('btnBaixar');
    if (btnBaixa) {
      btnBaixa.style.display = podeBaixaUi ? '' : 'none';
      btnBaixa.disabled = !podeBaixaUi;
    }
    var btnCanc = document.getElementById('btnCancelarCob');
    if (btnCanc) {
      btnCanc.style.display = podeCancUi ? '' : 'none';
      btnCanc.disabled = !podeCancUi;
    }
    var motivoInp = document.getElementById('baixaMotivo');
    if (motivoInp) {
      motivoInp.style.display = podeBaixaUi || podeCancUi ? '' : 'none';
    }
    var msg = document.getElementById('msgBaixa');
    if (msg) {
      if (bloqueado && modCob === 'USO_PLATAFORMA') {
        msg.className = 'ap-modal-msg';
        msg.textContent =
          'Uso (você → Atlas): só consulta. Quem dá baixa é a Atlas (instalação padrão). Você pode baixar a Conexão (motorista → você).';
      } else if (bloqueado && modCob === 'CONEXAO') {
        msg.className = 'ap-modal-msg';
        msg.textContent =
          'Conexão (motorista → agenciador): a Atlas só consulta. Baixa só no login do próprio agenciador.';
      } else {
        msg.textContent = '';
        msg.className = 'ap-modal-msg';
      }
    }
    modal.style.display = 'flex';
  }

  var mePerms = [];
  var meModoGovernanca = '';
  var permUsersCache = [];
  var permAlvoLogin = null;
  var permCatalogMap = {};
  var PERM_GRUPO_LABEL = {
    CONSULTA: 'Consulta',
    CONTRATO: 'Contratos',
    COBRANCA: 'Cobranças',
    CONFIG: 'Configuração',
    ADMIN: 'Administração',
    OUTROS: 'Outros',
  };
  var PERM_OP_LABEL = {
    BOOTSTRAP_ADMIN: 'Bootstrap admin',
    PERFIL_CONCEDER: 'Perfil concedido',
    PERFIL_REVOGAR: 'Perfil revogado',
    PERM_CONCEDER: 'Permissão concedida',
    PERM_REVOGAR: 'Permissão revogada',
    NEGADO: 'Negado',
  };
  var PERM_LABEL_FALLBACK = {
    FIN_CONSULTAR: { GRUPO: 'CONSULTA', DESCRICAO: 'Visualizar contratos, cobranças e eventos' },
    FIN_CONSULTAR_RELATORIOS: { GRUPO: 'CONSULTA', DESCRICAO: 'Consultar relatórios financeiros' },
    FIN_CONTRATO_CONSULTAR: { GRUPO: 'CONTRATO', DESCRICAO: 'Consultar contratos' },
    FIN_CONTRATO_CRIAR: { GRUPO: 'CONTRATO', DESCRICAO: 'Criar contratos' },
    FIN_CONTRATO_EDITAR: { GRUPO: 'CONTRATO', DESCRICAO: 'Editar contratos' },
    FIN_CONTRATO_CANCELAR: { GRUPO: 'CONTRATO', DESCRICAO: 'Cancelar contratos' },
    FIN_CONTRATO_VERSIONAR: { GRUPO: 'CONTRATO', DESCRICAO: 'Versionar / publicar contratos' },
    FIN_COBRANCA_CONSULTAR: { GRUPO: 'COBRANCA', DESCRICAO: 'Consultar cobranças' },
    FIN_COBRANCA_GERAR: { GRUPO: 'COBRANCA', DESCRICAO: 'Gerar cobranças' },
    FIN_COBRANCA_CANCELAR: { GRUPO: 'COBRANCA', DESCRICAO: 'Cancelar cobranças' },
    FIN_COBRANCA_BAIXAR: { GRUPO: 'COBRANCA', DESCRICAO: 'Baixa manual de cobranças' },
    FIN_CONFIGURAR: { GRUPO: 'ADMIN', DESCRICAO: 'Configurar parâmetros financeiros' },
    FIN_GERENCIAR_PERMISSOES: { GRUPO: 'ADMIN', DESCRICAO: 'Administrar permissões do tenant' },
  };

  function hasPerm(code) {
    return mePerms.indexOf(code) >= 0;
  }

  function metaPerm(code) {
    return permCatalogMap[code] || PERM_LABEL_FALLBACK[code] || { GRUPO: 'OUTROS', DESCRICAO: code };
  }

  function labelPermCodigo(code) {
    return metaPerm(code).DESCRICAO || String(code || '');
  }

  function labelPermGrupo(g) {
    var k = String(g || '').toUpperCase();
    return PERM_GRUPO_LABEL[k] || k || 'Outros';
  }

  function labelPermOperacao(op) {
    var k = String(op || '').toUpperCase();
    return PERM_OP_LABEL[k] || op || '—';
  }

  function renderPermGroupsHtml(codes) {
    var list = Array.isArray(codes) ? codes.slice() : [];
    if (!list.length) {
      return '<p class="atlas-pay-info">Nenhuma permissão efetiva.</p>';
    }
    var by = {};
    list.forEach(function (code) {
      var g = metaPerm(code).GRUPO || 'OUTROS';
      if (!by[g]) by[g] = [];
      by[g].push(code);
    });
    var grupos = Object.keys(by).sort();
    var rotulos = grupos.map(labelPermGrupo);
    var detalhe = grupos
      .map(function (g) {
        return (
          '<div class="ap-perm-group"><h5>' +
          labelPermGrupo(g) +
          ' · ' +
          by[g].length +
          '</h5><ul class="ap-perm-list">' +
          by[g]
            .slice()
            .sort(function (a, b) {
              return labelPermCodigo(a).localeCompare(labelPermCodigo(b), 'pt');
            })
            .map(function (code) {
              return (
                '<li title="' + code + '">' + labelPermCodigo(code) + '</li>'
              );
            })
            .join('') +
          '</ul></div>'
        );
      })
      .join('');
    return (
      '<details class="ap-perm-fold" data-ap-perm-ui="fold-v2">' +
      '<summary>' +
      '<span class="ap-perm-fold-title"><i class="bx bx-chevron-right" aria-hidden="true"></i> ' +
      'Ver detalhe · ' +
      list.length +
      ' permissão' +
      (list.length === 1 ? '' : 'ões') +
      '</span>' +
      '<span class="ap-perm-fold-meta">' +
      rotulos.join(' · ') +
      '</span>' +
      '</summary>' +
      '<div class="ap-perm-fold-body">' +
      detalhe +
      '</div></details>'
    );
  }

  function fecharPermModal() {
    var m = document.getElementById('apPermModal');
    if (m) m.style.display = 'none';
  }

  function bindPermModalOnce() {
    if (bindPermModalOnce.done) return;
    bindPermModalOnce.done = true;
    var modal = document.getElementById('apPermModal');
    if (!modal) return;
    var x = document.getElementById('apPermModalX');
    var f = document.getElementById('btnFecharPermModal');
    if (x) x.onclick = fecharPermModal;
    if (f) f.onclick = fecharPermModal;
    modal.querySelectorAll('[data-close-perm-modal]').forEach(function (el) {
      el.onclick = fecharPermModal;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || modal.style.display !== 'flex') return;
      var g = document.getElementById('globalConfirmModal');
      if (g && g.style.display === 'flex') return;
      fecharPermModal();
    });
  }

  async function ensurePermCatalog() {
    if (Object.keys(permCatalogMap).length) return;
    try {
      var cat = await api('/permissoes/catalogo');
      (cat.catalogo || []).forEach(function (c) {
        permCatalogMap[c.CODIGO] = c;
      });
    } catch (e) {}
  }

  function applyUiGates() {
    var btnPub = document.getElementById('btnPublicar');
    if (btnPub) {
      btnPub.style.display = hasPerm('FIN_CONTRATO_VERSIONAR') || hasPerm('FIN_CONTRATO_CRIAR') ? '' : 'none';
    }
    var btnBaixa = document.getElementById('btnBaixar');
    if (btnBaixa) {
      btnBaixa.style.display = hasPerm('FIN_COBRANCA_BAIXAR') ? '' : 'none';
    }
    var btnCanc = document.getElementById('btnCancelarCob');
    if (btnCanc) {
      btnCanc.style.display = hasPerm('FIN_COBRANCA_CANCELAR') ? '' : 'none';
    }
    var tabPerm = document.getElementById('tabBtnPermissoes');
    if (tabPerm) {
      tabPerm.style.display = hasPerm('FIN_GERENCIAR_PERMISSOES') ? '' : 'none';
    }
    var tabDashAtlas = document.getElementById('tabBtnDashAtlas');
    if (tabDashAtlas) {
      tabDashAtlas.style.display = podeOperarAgentes ? '' : 'none';
    }
    var tabDashMeu = document.getElementById('tabBtnDashTenant');
    if (tabDashMeu) {
      tabDashMeu.style.display = '';
    }
    var dhWrap = document.getElementById('cfgDhInicioWrap');
    if (dhWrap) {
      dhWrap.style.display = podeOperarAgentes ? '' : 'none';
    }
    var btnBoot = document.getElementById('btnBootstrapAdmin');
    if (btnBoot) {
      var jaStrict = String(meModoGovernanca || '').toUpperCase().indexOf('STRICT') === 0;
      btnBoot.style.display = jaStrict ? 'none' : '';
    }
    aplicarTravaUsoPlataforma();
    atualizarBotoesAddComp();
  }

  function lerDhInicioForm() {
    if (!podeOperarAgentes) return '';
    var el = document.getElementById('cfgDhInicio');
    return el && el.value ? String(el.value).trim() : '';
  }

  async function loadMePerms() {
    try {
      await ensurePermCatalog();
      var data = await api('/me/permissoes', { semTenantAlvo: true });
      mePerms = data.efetivas || [];
      var u = lerUserLocal();
      sessionTenantId = String(
        data.sessionTenantId || u.tenantId || u.tenant_id || 'default'
      ).trim() || 'default';
      podeOperarAgentes = data.podeOperarAgentes === true || sessionTenantId === 'default';
      try {
        var saved = sessionStorage.getItem(STORAGE_AGENTE);
        dataTenantId = String(saved || data.dataTenantId || sessionTenantId).trim() || sessionTenantId;
      } catch (e0) {
        dataTenantId = sessionTenantId;
      }
      meModoGovernanca = String(data.modo || '').trim();
      var modoEl = document.getElementById('apMeuModo');
      if (modoEl) {
        var modo = meModoGovernanca || '—';
        var perfis = (data.perfis || []).join(', ') || '(nenhum)';
        var strictBadge = String(modo).toUpperCase().indexOf('STRICT') === 0;
        modoEl.innerHTML =
          '<span class="ap-badge ' +
          (strictBadge ? 'on' : 'off') +
          '">' +
          modo +
          '</span> · Perfis: <strong>' +
          perfis +
          '</strong>';
      }
      var box = document.getElementById('apMinhasPerms');
      if (box) box.innerHTML = renderPermGroupsHtml(mePerms);
      applyUiGates();
    } catch (e) {
      mePerms = [];
      applyUiGates();
    }
  }

  function renderPermUsers(filter) {
    var q = String(filter || '').toLowerCase();
    var rowsRaw = permUsersCache.filter(function (u) {
      return !q || String(u.login).toLowerCase().indexOf(q) >= 0;
    });
    var rows = rowsRaw.map(function (u) {
      return {
        LOGIN: String(u.login),
        NOME: u.nome || '—',
        PERFIS: (u.perfis || []).join(', ') || '—',
        QTD_PERMS: String((u.efetivas || []).length),
      };
    });
    setGridCount('permUsersGridCountText', rows.length);
    var wrap = document.getElementById('permUsersGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = '<p class="empty">Nenhum usuário neste filtro.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    gridPermUsers = ensureGrid('#permUsersGrid', gridPermUsers, function () {
      return new window.GridEditor({
        container: '#permUsersGrid',
        columns: [
          { field: 'LOGIN', header: 'Login', editable: false, isId: true, width: '140px' },
          { field: 'NOME', header: 'Nome', editable: false },
          { field: 'PERFIS', header: 'Perfis', editable: false },
          { field: 'QTD_PERMS', header: 'Permissões', editable: false, width: '110px', align: 'right' },
        ],
        canDeleteRow: function () {
          return false;
        },
        onBeforeEdit: function (id) {
          openPermEditor(id).catch(function (e) {
            notify(e.message || 'Falha ao abrir permissões.', 'error');
          });
          return false;
        },
        onDelete: function () {},
      });
    });
    if (gridPermUsers) gridPermUsers.render(rows);
  }

  async function loadPermAdmin() {
    if (!hasPerm('FIN_GERENCIAR_PERMISSOES')) return;
    await ensurePermCatalog();
    var users = await api('/permissoes/usuarios');
    permUsersCache = users.usuarios || [];
    renderPermUsers(document.getElementById('filPermUser').value);
    var perfis = await api('/permissoes/perfis');
    var selP = document.getElementById('selPerfil');
    if (selP) {
      selP.innerHTML = (perfis.perfis || [])
        .map(function (p) {
          return '<option value="' + p.CODIGO + '">' + (p.NM_PERFIL || p.CODIGO) + '</option>';
        })
        .join('');
    }
    var selO = document.getElementById('selPermOv');
    if (selO) {
      var catList = Object.keys(permCatalogMap).length
        ? Object.keys(permCatalogMap).map(function (k) {
            return permCatalogMap[k];
          })
        : [];
      if (!catList.length) {
        var cat = await api('/permissoes/catalogo');
        catList = cat.catalogo || [];
        catList.forEach(function (c) {
          permCatalogMap[c.CODIGO] = c;
        });
      }
      var byGrupo = {};
      catList.forEach(function (c) {
        var g = String(c.GRUPO || metaPerm(c.CODIGO).GRUPO || 'OUTROS').toUpperCase();
        if (!byGrupo[g]) byGrupo[g] = [];
        byGrupo[g].push(c);
      });
      var ordemG = ['ADMIN', 'CONSULTA', 'CONTRATO', 'COBRANCA', 'CONFIG', 'OUTROS'];
      var htmlOpts = '';
      ordemG.concat(
        Object.keys(byGrupo).filter(function (g) {
          return ordemG.indexOf(g) < 0;
        })
      ).forEach(function (g) {
        var list = byGrupo[g];
        if (!list || !list.length) return;
        list.sort(function (a, b) {
          return String(a.DESCRICAO || a.CODIGO).localeCompare(String(b.DESCRICAO || b.CODIGO), 'pt');
        });
        htmlOpts +=
          '<optgroup label="' +
          (PERM_GRUPO_LABEL[g] || g) +
          '">' +
          list
            .map(function (c) {
              return (
                '<option value="' +
                c.CODIGO +
                '">' +
                (c.DESCRICAO || c.CODIGO) +
                '</option>'
              );
            })
            .join('') +
          '</optgroup>';
      });
      selO.innerHTML = htmlOpts;
    }
    var aud = await api('/permissoes/audit?limit=50');
    var evs = aud.eventos || [];
    var auditRows = evs.map(function (e, idx) {
      var op = String(e.OPERACAO || '').toUpperCase();
      return {
        ID: String(idx) + '-' + String(e.DH_EVENTO || ''),
        QUANDO: fmtQuando(e.DH_EVENTO),
        OP_HTML:
          '<span class="ap-badge ' +
          op.toLowerCase() +
          '">' +
          labelPermOperacao(op) +
          '</span>',
        QUEM: e.SGUSUARIO_ATOR || '—',
        ALVO: e.SGUSUARIO_ALVO || '—',
        DETALHE: e.DETALHE || '—',
      };
    });
    setGridCount('permAuditGridCountText', auditRows.length);
    var wrapA = document.getElementById('permAuditGrid');
    if (!wrapA) return;
    if (!auditRows.length) {
      wrapA.innerHTML = '<p class="empty">Nenhuma alteração registrada.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrapA.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    gridPermAudit = ensureGrid('#permAuditGrid', gridPermAudit, function () {
      return new window.GridEditor({
        container: '#permAuditGrid',
        showActions: false,
        columns: [
          { field: 'ID', header: 'ID', editable: false, isId: true, hidden: true },
          { field: 'QUANDO', header: 'Quando', editable: false, width: '140px' },
          {
            field: 'OP_HTML',
            header: 'O que aconteceu',
            editable: false,
            width: '160px',
            format: function (v) {
              return v;
            },
          },
          { field: 'QUEM', header: 'Quem', editable: false, width: '120px' },
          { field: 'ALVO', header: 'Usuário', editable: false, width: '120px' },
          { field: 'DETALHE', header: 'Detalhe', editable: false },
        ],
      });
    });
    if (gridPermAudit) gridPermAudit.render(auditRows);
  }

  async function openPermEditor(login) {
    bindPermModalOnce();
    await ensurePermCatalog();
    permAlvoLogin = login;
    document.getElementById('apPermAlvo').textContent = login;
    var data = await api('/permissoes/usuarios/' + encodeURIComponent(login));
    var det = document.getElementById('apPermEfetivasDet');
    if (det) det.innerHTML = renderPermGroupsHtml(data.efetivas || []);
    var msg = document.getElementById('msgPerm');
    if (msg) {
      msg.textContent = '';
      msg.className = 'ap-modal-msg';
    }
    var modal = document.getElementById('apPermModal');
    if (modal) modal.style.display = 'flex';
  }

  function sincronizarTopoTenant(nomeTab) {
    document.querySelectorAll('.ap-tenant-topo-grid').forEach(function (topo) {
      var naAba =
        (nomeTab === 'fechamento' && topo.closest('#tab-fechamento')) ||
        (nomeTab === 'cobrancas' && topo.closest('#tab-cobrancas'));
      topo.classList.toggle('ap-tenant-topo-grid--sem-tenant', !podeOperarAgentes || !naAba);
    });
    var hostResumo = document.getElementById('apAgenteHostResumo');
    if (hostResumo) {
      var mostrarResumo =
        !!podeOperarAgentes &&
        (!nomeTab || nomeTab === 'resumo' || nomeTab === 'permissoes');
      hostResumo.style.display = mostrarResumo ? '' : 'none';
      if (mostrarResumo) hostResumo.style.minWidth = '280px';
    }
    ['apAgenteHostDashAtlas', 'apAgenteHostDashTenant'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      var show =
        !!podeOperarAgentes &&
        ((id === 'apAgenteHostDashAtlas' && nomeTab === 'dash-atlas') ||
          (id === 'apAgenteHostDashTenant' && nomeTab === 'dash-tenant'));
      el.style.display = show ? '' : 'none';
      if (show) el.style.minWidth = '280px';
    });
  }

  function garantirTenantOperacionalParaAba(nomeTab) {
    if (String(dataTenantId) !== TENANT_TODOS) return;
    if (nomeTab === 'resumo' || nomeTab === 'dash-atlas') return;
    var sel = document.getElementById('apAgenteSelect');
    var fallback = sessionTenantId || 'default';
    dataTenantId = fallback;
    if (sel) sel.value = fallback;
    try {
      sessionStorage.setItem(STORAGE_AGENTE, dataTenantId);
    } catch (e) {}
    atualizarLabelAgente();
  }

  function posicionarBarraTenant(nomeTab) {
    var bar = document.getElementById('apAgenteBar');
    if (!bar || !podeOperarAgentes) {
      sincronizarTopoTenant(nomeTab);
      return;
    }
    garantirTenantOperacionalParaAba(nomeTab);
    var hostId = 'apAgenteHostResumo';
    if (nomeTab === 'contrato') hostId = 'apAgenteHostContrato';
    else if (nomeTab === 'fechamento') hostId = 'apAgenteHostFechamento';
    else if (nomeTab === 'cobrancas') hostId = 'apAgenteHostCobrancas';
    else if (nomeTab === 'permissoes') hostId = 'apAgenteHostResumo';
    else if (nomeTab === 'dash-atlas') hostId = 'apAgenteHostDashAtlas';
    else if (nomeTab === 'dash-tenant') hostId = 'apAgenteHostDashTenant';
    var host = document.getElementById(hostId) || document.getElementById('apAgenteHostResumo');
    var hostContrato = document.getElementById('apAgenteHostContrato');
    if (host && bar.parentNode !== host) host.appendChild(bar);
    bar.classList.remove('ap-agente-bar--inline');
    bar.classList.add('ap-agente-bar--strip');
    var naPublicar = hostId === 'apAgenteHostContrato';
    if (hostContrato) hostContrato.style.display = naPublicar ? '' : 'none';
    sincronizarTopoTenant(nomeTab);
  }

  function initTabs() {
    document.querySelectorAll('.atlas-pay-container .tabs .tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.atlas-pay-container .tabs .tab-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        document.querySelectorAll('.atlas-pay-container .tab-content').forEach(function (p) {
          p.classList.remove('active');
        });
        btn.classList.add('active');
        var nomeTab = btn.getAttribute('data-tab');
        var tab = document.getElementById('tab-' + nomeTab);
        if (tab) tab.classList.add('active');
        posicionarBarraTenant(nomeTab);
        if (nomeTab === 'resumo') {
          loadResumo().catch(function (e) {
            notify(e.message || 'Falha ao carregar visão geral.', 'error');
          });
        }
        if (nomeTab === 'permissoes') {
          loadPermAdmin().catch(function (e) {
            notify(e.message || 'Falha ao carregar permissões.', 'error');
          });
        }
        if (nomeTab === 'fechamento') {
          Promise.all([
            preencherSelectCompetencia().catch(function () {}),
            loadFechamentos(),
          ]).catch(function (e) {
            notify(e.message || 'Falha ao carregar fechamentos de uso.', 'error');
          });
        }
        if (nomeTab === 'cobrancas') {
          loadCobrancas().catch(function (e) {
            notify(e.message || 'Falha ao carregar cobranças.', 'error');
          });
        }
        if (nomeTab === 'contrato') {
          loadContratos().catch(function (e) {
            notify(e.message || 'Falha ao carregar contratos.', 'error');
          });
        }
        if (nomeTab === 'dash-atlas') {
          loadDashAtlas().catch(function (e) {
            notify(e.message || 'Falha ao carregar Dash Atlas.', 'error');
          });
        }
        if (nomeTab === 'dash-tenant') {
          loadDashMeu().catch(function (e) {
            notify(e.message || 'Falha ao carregar Meu faturamento.', 'error');
          });
        }
      });
    });
  }

  function htmlTabelaTopMotoristas(lista) {
    var rows = Array.isArray(lista) ? lista : [];
    if (!rows.length) {
      return '<p class="empty" style="padding:16px;margin:0">Nenhum motorista com conexão neste filtro.</p>';
    }
    return (
      '<table class="grid-table estatisticas-table"><thead><tr>' +
      '<th>#</th><th>Motorista</th><th>Pago</th><th>Aberto</th><th>Qtd</th>' +
      '</tr></thead><tbody>' +
      rows
        .map(function (row, idx) {
          var cd = row.cd_cadastro != null ? row.cd_cadastro : row.CD_CADASTRO;
          var nome = row.nome || row.NOME || '';
          var label = nome
            ? String(nome).replace(/</g, '&lt;') +
              ' <span style="color:#64748b;font-weight:500">(' +
              cd +
              ')</span>'
            : 'Cadastro ' + cd;
          return (
            '<tr>' +
            '<td><strong>' +
            (idx + 1) +
            '</strong></td>' +
            '<td>' +
            label +
            '</td>' +
            '<td>' +
            fmtBRL(row.centavos_pagos) +
            '</td>' +
            '<td>' +
            fmtBRL(row.centavos_abertos) +
            '</td>' +
            '<td>' +
            (row.qtd || 0) +
            '</td>' +
            '</tr>'
          );
        })
        .join('') +
      '</tbody></table>'
    );
  }

  async function loadDashAtlas() {
    if (!podeOperarAgentes) return;
    var tenantQ =
      String(dataTenantId) === TENANT_TODOS ? '' : String(dataTenantId || '').trim();
    var q = tenantQ ? '?tenant=' + encodeURIComponent(tenantQ) : '';
    var data = await api('/dash/atlas' + q, { semTenantAlvo: true });
    var kpis = document.getElementById('apDashAtlasKpis');
    if (kpis) {
      kpis.innerHTML =
        '<div class="dashboard-stat-card primary">' +
        '<div class="stat-card-icon"><i class="bx bx-buildings"></i></div>' +
        '<div class="stat-card-content"><h4>1 · Atlas (default) recebeu</h4><p class="stat-value">' +
        fmtBRL(data.conexaoAtlas && data.conexaoAtlas.centavos_pagos) +
        '</p><p class="stat-sub">Conexão · motorista → instalação padrão · aberto ' +
        fmtBRL(data.conexaoAtlas && data.conexaoAtlas.centavos_abertos) +
        '</p></div></div>' +
        '<div class="dashboard-stat-card success">' +
        '<div class="stat-card-icon"><i class="bx bx-user"></i></div>' +
        '<div class="stat-card-content"><h4>2 · Clientes receberam</h4><p class="stat-value">' +
        fmtBRL(data.conexaoClientes && data.conexaoClientes.centavos_pagos) +
        '</p><p class="stat-sub">Conexão · motorista → agenciadores · aberto ' +
        fmtBRL(data.conexaoClientes && data.conexaoClientes.centavos_abertos) +
        '</p></div></div>' +
        '<div class="dashboard-stat-card warning">' +
        '<div class="stat-card-icon"><i class="bx bx-wallet"></i></div>' +
        '<div class="stat-card-content"><h4>3 · Uso pago à Atlas</h4><p class="stat-value">' +
        fmtBRL(data.resumoUso && data.resumoUso.centavos_pagos) +
        '</p><p class="stat-sub">Aberto ' +
        fmtBRL(data.resumoUso && data.resumoUso.centavos_abertos) +
        ' · ' +
        ((data.resumoUso && data.resumoUso.abertas) || 0) +
        ' aberta(s)</p></div></div>' +
        '<div class="dashboard-stat-card info">' +
        '<div class="stat-card-icon"><i class="bx bx-link"></i></div>' +
        '<div class="stat-card-content"><h4>Conexão paga (todas)</h4><p class="stat-value">' +
        fmtBRL(data.resumoConexao && data.resumoConexao.centavos_pagos) +
        '</p><p class="stat-sub">1 + 2 · aberto ' +
        fmtBRL(data.resumoConexao && data.resumoConexao.centavos_abertos) +
        '</p></div></div>';
    }
    var rankHost = document.getElementById('apDashAtlasRanking');
    if (rankHost) {
      var ranking = data.ranking || [];
      if (!ranking.length) {
        rankHost.innerHTML =
          '<p class="empty" style="padding:16px;margin:0">Sem cobranças para rankear.</p>';
      } else {
        rankHost.innerHTML =
          '<table class="grid-table estatisticas-table"><thead><tr>' +
          '<th>Agenciador</th><th>Conexão paga</th><th>Conexão aberta</th><th>Uso pago</th><th>Uso aberto</th><th></th>' +
          '</tr></thead><tbody>' +
          ranking
            .map(function (row) {
              var tid = String(row.tenant_id || '');
              var label = rotuloTenantResumo(row);
              return (
                '<tr>' +
                '<td><strong>' +
                String(label).replace(/</g, '&lt;') +
                '</strong></td>' +
                '<td>' +
                fmtBRL(row.cx_pagos) +
                '</td>' +
                '<td>' +
                fmtBRL(row.cx_abertos) +
                '</td>' +
                '<td>' +
                (tid === 'default' ? '—' : fmtBRL(row.uso_pagos)) +
                '</td>' +
                '<td>' +
                (tid === 'default' ? '—' : fmtBRL(row.uso_abertos)) +
                '</td>' +
                '<td><button type="button" class="btn-filtro btn-filtro-aplicar btn-sm ap-dash-ir-tenant" data-tenant="' +
                tid.replace(/"/g, '') +
                '"><i class="bx bx-right-arrow-alt"></i> Abrir</button></td>' +
                '</tr>'
              );
            })
            .join('') +
          '</tbody></table>';
        rankHost.querySelectorAll('.ap-dash-ir-tenant').forEach(function (btn) {
          btn.onclick = function () {
            irTenantCobrancas(btn.getAttribute('data-tenant'));
          };
        });
      }
    }
    var hint = document.getElementById('apDashAtlasTopHint');
    if (hint) {
      hint.textContent = tenantQ
        ? 'Top motoristas do tenant ' + tenantQ + ' (conexão).'
        : 'Top motoristas em todos os agenciadores (conexão). Escolha um tenant no seletor para filtrar.';
    }
    var topHost = document.getElementById('apDashAtlasTopMot');
    if (topHost) topHost.innerHTML = htmlTabelaTopMotoristas(data.topMotoristas || []);
  }

  async function loadDashMeu() {
    var opts = {};
    if (podeOperarAgentes && String(dataTenantId) === TENANT_TODOS) {
      // força um tenant concreto
      garantirTenantOperacionalParaAba('dash-tenant');
    }
    var data = await api('/dash/meu', opts);
    var kpis = document.getElementById('apDashMeuKpis');
    if (kpis) {
      var cx = data.conexao || {};
      var uso = data.uso || {};
      var usoBloco = data.ehDefault
        ? '<div class="dashboard-stat-card info">' +
          '<div class="stat-card-icon"><i class="bx bx-block"></i></div>' +
          '<div class="stat-card-content"><h4>B · Uso SaaS</h4><p class="stat-value">—</p>' +
          '<p class="stat-sub">Atlas não se fatura uso (default → default bloqueado)</p></div></div>'
        : '<div class="dashboard-stat-card warning">' +
          '<div class="stat-card-icon"><i class="bx bx-buildings"></i></div>' +
          '<div class="stat-card-content"><h4>B · Uso a pagar / pago</h4><p class="stat-value">' +
          fmtBRL(uso.centavos_abertos) +
          '</p><p class="stat-sub">Aberto · pago ' +
          fmtBRL(uso.centavos_pagos) +
          ' · eu → Atlas</p></div></div>';
      kpis.innerHTML =
        '<div class="dashboard-stat-card primary">' +
        '<div class="stat-card-icon"><i class="bx bx-user"></i></div>' +
        '<div class="stat-card-content"><h4>A · Conexão a receber</h4><p class="stat-value">' +
        fmtBRL(cx.centavos_abertos) +
        '</p><p class="stat-sub">' +
        (cx.abertas || 0) +
        ' aberta(s) · pago ' +
        fmtBRL(cx.centavos_pagos) +
        ' · motorista → eu</p></div></div>' +
        usoBloco +
        '<div class="dashboard-stat-card success">' +
        '<div class="stat-card-icon"><i class="bx bx-check-circle"></i></div>' +
        '<div class="stat-card-content"><h4>Conexão paga</h4><p class="stat-value">' +
        fmtBRL(cx.centavos_pagos) +
        '</p><p class="stat-sub">' +
        (cx.pagas || 0) +
        ' cobrança(s)</p></div></div>' +
        (data.ehDefault
          ? ''
          : '<div class="dashboard-stat-card info">' +
            '<div class="stat-card-icon"><i class="bx bx-wallet"></i></div>' +
            '<div class="stat-card-content"><h4>Uso pago à Atlas</h4><p class="stat-value">' +
            fmtBRL(uso.centavos_pagos) +
            '</p><p class="stat-sub">' +
            (uso.pagas || 0) +
            ' cobrança(s)</p></div></div>');
    }
    var hint = document.getElementById('apDashMeuHint');
    if (hint) {
      hint.innerHTML = data.ehDefault
        ? 'Visão da <strong>instalação padrão</strong> como agenciador: conexão que a Atlas recebe dos motoristas + top motoristas.'
        : 'Conexão que <strong>você</strong> recebe e uso que paga à Atlas. Tenant: <strong>' +
          String(data.tenantId || '').replace(/</g, '&lt;') +
          '</strong>.';
    }
    var topHost = document.getElementById('apDashMeuTopMot');
    if (topHost) topHost.innerHTML = htmlTabelaTopMotoristas(data.topMotoristas || []);
  }

  var fechSelId = null;
  var fechUltimo = null;

  var FECH_STATUS_LABEL = {
    RASCUNHO: 'Rascunho',
    COM_EXCECOES: 'Com pendências',
    AGUARDANDO_APROVACAO: 'Pronto para aprovar',
    APROVADO: 'Aprovado',
    COBRADO: 'Cobrança gerada',
  };

  var FECH_EXCECAO_MAP = {
    INTERVALO_SEM_CONTRATO: {
      titulo: 'Período sem contrato vigente',
      acao: 'Contrato publicado agora começa “de hoje em diante” e não cobre dias já passados sem contrato. Use um mês inteiro sob contrato, ou publique com início cobrindo o 1º dia (se a operação permitir). Depois Recalcular.',
    },
    EVENTO_SEM_CONTRATO: {
      titulo: 'Viagem anunciada sem contrato na data',
      acao: 'Ajuste o período do contrato ou revise a data de convocação da viagem. Depois recalcule.',
    },
    VLFRETE_INVALIDO: {
      titulo: 'Frete inválido ou zerado em viagem anunciada',
      acao: 'Corrija o valor do frete nas viagens apontadas e recalcule o fechamento.',
    },
  };

  function labelStatusFech(st) {
    var s = String(st || '').toUpperCase();
    return FECH_STATUS_LABEL[s] || s || '—';
  }

  function badgeFech(st, opts) {
    var s = String(st || '').toUpperCase();
    if (opts && opts.previa) {
      return '<span class="ap-badge warn">Prévia — calcule para gravar</span>';
    }
    var cls =
      s === 'COBRADO' || s === 'APROVADO'
        ? 'on'
        : s === 'COM_EXCECOES'
          ? 'off'
          : s === 'AGUARDANDO_APROVACAO'
            ? 'on'
            : 'warn';
    return '<span class="ap-badge ' + cls + '">' + labelStatusFech(s) + '</span>';
  }

  var MESES_PT = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  function labelCompetencia(aaaaMm) {
    var m = String(aaaaMm || '').match(/^(\d{4})-(\d{2})$/);
    if (!m) return aaaaMm || '—';
    var mi = Number(m[2]) - 1;
    return (MESES_PT[mi] || m[2]) + '/' + m[1];
  }

  function parseTsFech(v) {
    var s = String(v || '').replace('T', ' ').slice(0, 19);
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return null;
    return {
      y: Number(m[1]),
      mo: Number(m[2]),
      d: Number(m[3]),
      h: m[4] != null ? Number(m[4]) : 0,
      mi: m[5] != null ? Number(m[5]) : 0,
      s: m[6] != null ? Number(m[6]) : 0,
    };
  }

  function fmtDtFech(v) {
    if (!v) return '—';
    var p = parseTsFech(v);
    if (!p) return fmtQuando(v);
    var out =
      String(p.d).padStart(2, '0') +
      '/' +
      String(p.mo).padStart(2, '0') +
      '/' +
      p.y;
    var midnight = p.h === 0 && p.mi === 0 && p.s === 0;
    if (!midnight) out += ' ' + String(p.h).padStart(2, '0') + ':' + String(p.mi).padStart(2, '0');
    return out;
  }

  /** Fim exclusivo à meia-noite → último dia incluso (ex.: 01/12 00:00 → 30/11). */
  function fmtDtFechFimInclusivo(v) {
    var pf = parseTsFech(v);
    if (pf && pf.d === 1 && pf.h === 0 && pf.mi === 0 && pf.s === 0) {
      var last = new Date(pf.y, pf.mo - 1, 0);
      return (
        String(last.getDate()).padStart(2, '0') +
        '/' +
        String(last.getMonth() + 1).padStart(2, '0') +
        '/' +
        last.getFullYear()
      );
    }
    return fmtDtFech(v);
  }

  /** Período da competência: fim exclusivo à meia-noite vira último dia do mês. */
  function fmtPeriodoCompetencia(ini, fim, diasMes) {
    var a = fmtDtFech(ini);
    var b = fmtDtFechFimInclusivo(fim);
    var dias = diasMes != null ? ' · ' + diasMes + ' dias' : '';
    return a + ' a ' + b + dias;
  }

  function competenciaDeData(v) {
    var s = String(v || '').replace('T', ' ').slice(0, 10);
    var m = s.match(/^(\d{4})-(\d{2})/);
    return m ? m[1] + '-' + m[2] : null;
  }

  function competenciaAtual() {
    var now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }

  function mesesEntreInclusive(deKey, ateKey) {
    var out = [];
    var a = String(deKey || '').match(/^(\d{4})-(\d{2})$/);
    var b = String(ateKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!a || !b) return out;
    var y = Number(a[1]);
    var mo = Number(a[2]);
    var y2 = Number(b[1]);
    var mo2 = Number(b[2]);
    while (y < y2 || (y === y2 && mo <= mo2)) {
      out.push(y + '-' + String(mo).padStart(2, '0'));
      mo += 1;
      if (mo > 12) {
        mo = 1;
        y += 1;
      }
    }
    return out;
  }

  /**
   * Lista só competências com base em registro (sem forçar mês do calendário):
   * - competências já gravadas em fechamento
   * - meses desde o 1º contrato do tenant até o mês atual (sem inventar futuro)
   * Sem contrato e sem fechamento → lista vazia (publique contrato antes).
   */
  async function preencherSelectCompetencia(preferida) {
    var sel = document.getElementById('fechCompetencia');
    if (!sel) return;
    var prefer = String(preferida || '').match(/^\d{4}-\d{2}$/) ? preferida : null;
    var curMes = competenciaAtual();
    var set = {};
    var temContrato = false;

    try {
      var fech = await api('/fechamentos-uso?limit=120');
      (fech.fechamentos || []).forEach(function (r) {
        if (r.COMPETENCIA && /^\d{4}-\d{2}$/.test(r.COMPETENCIA)) set[r.COMPETENCIA] = true;
      });
    } catch (e1) {}

    try {
      var ctr = await api('/contratos');
      var minKey = null;
      (ctr.contratos || []).forEach(function (c) {
        var k = competenciaDeData(c.DH_INICIO);
        if (k) {
          temContrato = true;
          if (!minKey || k < minKey) minKey = k;
        }
      });
      if (minKey) {
        mesesEntreInclusive(minKey, curMes).forEach(function (k) {
          set[k] = true;
        });
      }
    } catch (e2) {}

    // Preferida só entra se já houver base (contrato/fechamento); senão seria inventar.
    if (prefer && (temContrato || Object.keys(set).length)) set[prefer] = true;

    var opts = Object.keys(set).sort(function (a, b) {
      return a < b ? 1 : a > b ? -1 : 0;
    });

    var btnPrevia = document.getElementById('btnFechPrevia');
    var btnCalc = document.getElementById('btnFechCalcular');
    var podeFech = podeOperarFechamentoUso();

    if (!opts.length) {
      sel.innerHTML =
        '<option value="">Nenhum mês — publique um contrato primeiro</option>';
      sel.value = '';
      sel.disabled = true;
      if (btnPrevia) btnPrevia.disabled = true;
      if (btnCalc) {
        btnCalc.style.display = podeFech ? '' : 'none';
        btnCalc.disabled = true;
      }
      return;
    }

    sel.disabled = false;
    if (btnPrevia) btnPrevia.disabled = false;
    if (btnCalc) {
      btnCalc.style.display = podeFech ? '' : 'none';
      btnCalc.disabled = !podeFech;
    }
    var keep = prefer && set[prefer] ? prefer : set[sel.value] ? sel.value : opts[0];
    sel.innerHTML = opts
      .map(function (k) {
        return '<option value="' + k + '">' + labelCompetencia(k) + '</option>';
      })
      .join('');
    sel.value = keep;
  }

  function lerCompetenciaFech() {
    var sel = document.getElementById('fechCompetencia');
    var v = sel ? String(sel.value || '').trim() : '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) return null;
    return v;
  }

  function setCompetenciaFech(v) {
    var sel = document.getElementById('fechCompetencia');
    if (!sel) return;
    var key = String(v || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return;
    if (![].some.call(sel.options, function (o) { return o.value === key; })) {
      var opt = document.createElement('option');
      opt.value = key;
      opt.textContent = labelCompetencia(key);
      sel.appendChild(opt);
    }
    sel.value = key;
  }

  function diasEntre(ini, fim) {
    try {
      var a = new Date(String(ini).replace(' ', 'T'));
      var b = new Date(String(fim).replace(' ', 'T'));
      if (isNaN(a) || isNaN(b)) return '—';
      var d = Math.max(0, Math.round((b - a) / 86400000));
      return d === 1 ? '1 dia' : d + ' dias';
    } catch (e) {
      return '—';
    }
  }

  function parseExcecoes(f) {
    var ex = f.excecoes || f.EXCECOES || [];
    if (typeof ex === 'string') {
      try {
        ex = JSON.parse(ex);
      } catch (e) {
        ex = [];
      }
    }
    return Array.isArray(ex) ? ex : [];
  }

  function extrairMemoria(f) {
    var mem = f.memoria || f.MEMORIA_CALCULO || null;
    if (typeof mem === 'string') {
      try {
        mem = JSON.parse(mem);
      } catch (e) {
        mem = null;
      }
    }
    if (mem && mem.memoria) mem = mem.memoria;
    return mem && typeof mem === 'object' ? mem : null;
  }

  function setFechSteps(status, opts) {
    var st = String(status || '').toUpperCase();
    var step = 1;
    if (opts && opts.previa) step = 2;
    else if (st === 'RASCUNHO' || st === 'COM_EXCECOES') step = 2;
    else if (st === 'AGUARDANDO_APROVACAO') step = 3;
    else if (st === 'APROVADO') step = 4;
    else if (st === 'COBRADO') step = 5;
    document.querySelectorAll('#fechSteps li').forEach(function (li) {
      var n = Number(li.getAttribute('data-step'));
      li.classList.remove('is-active', 'is-done', 'is-blocked');
      if (st === 'COM_EXCECOES' && !(opts && opts.previa) && n === 3) li.classList.add('is-blocked');
      else if (n < step) li.classList.add('is-done');
      else if (n === Math.min(step, 4)) li.classList.add('is-active');
    });
  }

  /** Só a Atlas (login default) calcula/aprova/gera Uso. Agenciador só consulta. */
  function podeOperarFechamentoUso() {
    if (!podeOperarAgentes) return false;
    var alvo = String(dataTenantId || '').trim();
    if (!alvo || alvo === 'default' || alvo === TENANT_TODOS) return false;
    return true;
  }

  function aplicarUiFechamentoUso() {
    var pode = podeOperarFechamentoUso();
    var atlasSess = !!podeOperarAgentes;
    var btnCalc = document.getElementById('btnFechCalcular');
    if (btnCalc) {
      btnCalc.style.display = pode ? '' : 'none';
      btnCalc.disabled = !pode;
    }
    var tabLbl = document.getElementById('apTabFechLabel');
    if (tabLbl) tabLbl.textContent = atlasSess ? 'Fechamento de uso' : 'Fatura de uso';
    var titulo = document.getElementById('apFechTitulo');
    if (titulo) {
      titulo.innerHTML = atlasSess
        ? '<i class="bx bx-calendar-check"></i> Fechamento mensal de uso'
        : '<i class="bx bx-calendar-check"></i> Minha fatura mensal de uso';
    }
    var info = document.querySelector('#tab-fechamento .ap-tenant-topo-main > .atlas-pay-info');
    if (info) {
      info.innerHTML = pode
        ? 'Só a dívida SaaS: <strong>este agenciador → Atlas (default)</strong>. Não inclui conexão (motorista → agenciador). Escolha o mês, abra a prévia e use <strong>Calcular e gravar</strong> para liberar Aprovar → Gerar.'
        : 'Consulta da dívida SaaS (<strong>você → Atlas</strong>). Calcular, aprovar e gerar cobrança são feitos pela <strong>Atlas</strong>. Aqui você só vê o valor e o histórico do mês.';
    }
    var compHint = document.getElementById('apFechCompHint');
    if (compHint) {
      compHint.textContent = atlasSess
        ? 'Só meses com contrato ou fechamento gravado. Sem contrato, a lista fica vazia.'
        : 'Só meses com fatura ou contrato. Sem contrato, a lista fica vazia.';
    }
    var gridTitulo = document.getElementById('apFechGridTitulo');
    if (gridTitulo) {
      gridTitulo.innerHTML = atlasSess
        ? '<i class="bx bx-grid-alt" aria-hidden="true"></i> Fechamentos gravados'
        : '<i class="bx bx-grid-alt" aria-hidden="true"></i> Histórico da fatura';
    }
    var hintGrid = document.getElementById('apFechGridHint');
    if (hintGrid) {
      hintGrid.textContent = pode
        ? 'Editar abre pendências, totais e aprovar/gerar — tudo na janela do fechamento.'
        : 'Abra o mês para ver o detalhe do que a Atlas cobrou (somente leitura).';
    }
  }

  function atualizarBotoesFech(f) {
    var st = String((f && (f.STATUS || f.status)) || '').toUpperCase();
    var regra = String((f && (f.FG_REGRA_SNAPSHOT || f.fgRegraSnapshot)) || 'N').toUpperCase() === 'S';
    var ex = f ? parseExcecoes(f) : [];
    var temId = !!(fechSelId || (f && (f.ID || f.id)));
    var ehPrevia = !temId && !!f;
    var pode = podeOperarFechamentoUso();
    var btnAprovar = document.getElementById('btnFechAprovar');
    var btnGerar = document.getElementById('btnFechGerar');
    var btnRecalc = document.getElementById('btnFechRecalcular');
    var btnCalcModal = document.getElementById('btnFechCalcularModal');
    if (btnCalcModal) {
      btnCalcModal.style.display = pode && ehPrevia ? '' : 'none';
      btnCalcModal.disabled = !(pode && ehPrevia);
    }
    if (btnRecalc) {
      btnRecalc.style.display = pode && !ehPrevia ? '' : 'none';
      btnRecalc.disabled = !pode || !temId || st === 'COBRADO';
    }
    if (btnAprovar) {
      btnAprovar.style.display = pode ? '' : 'none';
      btnAprovar.disabled =
        !pode ||
        !temId ||
        !!ex.length ||
        !regra ||
        (st !== 'AGUARDANDO_APROVACAO' && st !== 'RASCUNHO') ||
        st === 'APROVADO' ||
        st === 'COBRADO' ||
        st === 'COM_EXCECOES';
    }
    if (btnGerar) {
      btnGerar.style.display = pode ? '' : 'none';
      btnGerar.disabled = !pode || !temId || st !== 'APROVADO';
      if (!pode) {
        btnGerar.title = 'Só a Atlas gera a cobrança de uso. Neste login você só consulta.';
      } else {
        btnGerar.removeAttribute('title');
      }
    }
  }

  function montarDiag() {
    var el = document.getElementById('fechDiag');
    if (el) {
      el.style.display = 'none';
      el.hidden = true;
    }
  }

  function htmlProximoPasso(f, mem, ex, regraOn) {
    var st = String(f.STATUS || f.status || '').toUpperCase();
    var cls = 'ok';
    var titulo = 'Pronto para seguir';
    var texto = 'Sem bloqueios. Use Aprovar e depois Gerar cobrança.';
    var showContratos = false;
    var soConsulta = !podeOperarFechamentoUso();

    if (st === 'COBRADO') {
      titulo = 'Fechamento concluído';
      texto = soConsulta
        ? 'A Atlas já gerou a cobrança deste mês. Aqui é só consulta.'
        : 'A cobrança deste mês já foi gerada.';
    } else if (st === 'APROVADO') {
      cls = 'warn';
      titulo = soConsulta ? 'Aguardando a Atlas gerar a cobrança' : 'Próximo passo: gerar cobrança';
      texto = soConsulta
        ? 'Memória aprovada. A geração da dívida é feita pela Atlas (instalação padrão).'
        : 'A memória está aprovada. Clique em Gerar cobrança para criar a dívida do mês.';
    } else if (ex.length) {
      cls = 'err';
      titulo = 'Não dá para aprovar ainda';
      var lac = mem && mem.lacunas && mem.lacunas[0];
      var temLacuna = ex.some(function (e) {
        return e.codigo === 'INTERVALO_SEM_CONTRATO';
      });
      if (temLacuna && lac) {
        texto =
          'Há lacuna sem contrato de ' +
          fmtDtFech(lac.inicio) +
          ' até ' +
          fmtDtFech(lac.fim) +
          ' (' +
          diasEntre(lac.inicio, lac.fim) +
          '). Ter contrato vigente <em>hoje</em> com regra ligada não apaga dias do mês em que ainda não existia contrato. Publicar de novo só cobre a partir do instante da publicação. Para este mês: ou a lacuna some (contrato cobrindo o início), ou feche um mês já coberto por inteiro — depois Recalcular.';
        showContratos = true;
      } else {
        texto = 'Resolva as pendências abaixo, ajuste o contrato se precisar e use Recalcular.';
        showContratos = ex.some(function (e) {
          return e.codigo === 'INTERVALO_SEM_CONTRATO' || e.codigo === 'EVENTO_SEM_CONTRATO';
        });
      }
    } else if (!regraOn) {
      cls = 'warn';
      titulo = 'Regra desligada neste cálculo';
      texto =
        'O snapshot ficou com regra off. Para cobrar o mês, publique na aba Contratos com regra ligada e recalcule.';
      showContratos = true;
    } else if (st === 'AGUARDANDO_APROVACAO' || st === 'RASCUNHO') {
      var temIdPasso = !!(f.ID || f.id);
      if (soConsulta) {
        titulo = temIdPasso ? 'Fechamento em andamento na Atlas' : 'Prévia (somente leitura)';
        texto =
          'Sem pendências. Calcular, aprovar e gerar cobrança de uso são operações da Atlas — neste login você só consulta.';
      } else if (!temIdPasso) {
        titulo = 'Prévia ok — grave o mês';
        texto =
          'Sem pendências e regra ligada. Clique em <strong>Calcular e gravar</strong> neste painel para gravar o rascunho e liberar Aprovar.';
      } else {
        titulo = 'Pode aprovar';
        texto = 'Sem pendências e regra ligada. Aprove para congelar a memória e depois gere a cobrança.';
      }
    }

    var pendHtml = '';
    if (ex.length) {
      pendHtml =
        '<ul class="ap-fech-pend-list">' +
        ex
          .map(function (e) {
            var map = FECH_EXCECAO_MAP[e.codigo] || {};
            var tituloP = map.titulo || e.mensagem || e.codigo || 'Pendência';
            var extra = '';
            if (e.inicio || e.fim) {
              extra =
                ' · ' +
                fmtDtFech(e.inicio) +
                ' → ' +
                fmtDtFech(e.fim);
            }
            if (e.idViagem != null) extra += ' · viagem #' + e.idViagem;
            return '<li><strong>' + tituloP + '</strong>' + (map.acao || '') + extra + '</li>';
          })
          .join('') +
        '</ul>';
    }

    return {
      html:
        '<div class="ap-fech-next ' +
        cls +
        '"><div class="ap-fech-next-title"><i class="bx ' +
        (cls === 'err' ? 'bx-error-circle' : cls === 'warn' ? 'bx-info-circle' : 'bx-check-circle') +
        '"></i> ' +
        titulo +
        '</div><p>' +
        texto +
        '</p>' +
        pendHtml +
        '</div>',
      showContratos: showContratos,
    };
  }

  function fecharFechModal() {
    var m = document.getElementById('apFechModal');
    if (m) m.style.display = 'none';
  }

  function bindFechModalOnce() {
    if (bindFechModalOnce.done) return;
    bindFechModalOnce.done = true;
    var modal = document.getElementById('apFechModal');
    if (!modal) return;
    var x = document.getElementById('apFechModalX');
    var f = document.getElementById('btnFecharFechModal');
    if (x) x.onclick = fecharFechModal;
    if (f) f.onclick = fecharFechModal;
    modal.querySelectorAll('[data-close-fech-modal]').forEach(function (el) {
      el.onclick = fecharFechModal;
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && modal.style.display === 'flex') fecharFechModal();
    });
  }

  function htmlExcecoesFech(ex) {
    if (!ex.length) {
      return (
        '<p class="atlas-pay-info"><span class="ap-badge on">Nenhuma pendência</span> ' +
        'Pode aprovar se a regra estiver ligada.</p>'
      );
    }
    return (
      '<div class="estatisticas-table-wrap"><table class="estatisticas-table"><thead><tr><th>Problema</th><th>O que fazer</th></tr></thead><tbody>' +
      ex
        .map(function (e) {
          var map = FECH_EXCECAO_MAP[e.codigo] || {};
          var titulo = map.titulo || e.mensagem || e.codigo || 'Pendência';
          var acao = map.acao || 'Revise o cálculo e tente novamente.';
          var extra = e.idViagem != null ? ' Viagem #' + e.idViagem + '.' : '';
          if (e.inicio || e.fim || (e.intervalo && (e.intervalo.inicio || e.intervalo.fim))) {
            extra +=
              ' Intervalo: ' +
              fmtDtFech(e.inicio || (e.intervalo && e.intervalo.inicio)) +
              ' → ' +
              fmtDtFech(e.fim || (e.intervalo && e.intervalo.fim)) +
              '.';
          }
          return (
            '<tr><td><strong>' +
            titulo +
            '</strong><br><span style="font-size:12px;opacity:.75">' +
            (e.codigo || '') +
            '</span></td><td>' +
            acao +
            extra +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }

  function htmlLacunasFech(lacunas) {
    if (!lacunas.length) {
      return '<p class="atlas-pay-info">Nenhuma — mês coberto por contrato.</p>';
    }
    return (
      '<div class="grid-container estatisticas-table-wrap"><table class="grid-table estatisticas-table"><thead><tr><th>Período</th><th>Duração</th></tr></thead><tbody>' +
      lacunas
        .map(function (l) {
          return (
            '<tr><td>' +
            fmtDtFech(l.inicio) +
            ' → ' +
            fmtDtFechFimInclusivo(l.fim) +
            '</td><td>' +
            diasEntre(l.inicio, l.fim) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }

  function htmlIntervalosFech(intervalos) {
    if (!intervalos.length) {
      return '<p class="atlas-pay-info">Nenhum intervalo de contrato no mês.</p>';
    }
    var relevantes = [];
    var micro = 0;
    intervalos.forEach(function (it) {
      var dias = Number(it.dias) || 0;
      if (dias > 0) relevantes.push(it);
      else micro += 1;
    });
    if (!relevantes.length) relevantes = intervalos.slice(-3);
    var rows = relevantes
      .map(function (it) {
        var regra =
          String(it.fgRegra || 'N') === 'S'
            ? '<span class="ap-badge on">Ligada</span>'
            : '<span class="ap-badge off">Desligada</span>';
        var tabela =
          it.resumoUso ||
          it.RESUMO_USO ||
          (it.qtdComponentesUso != null ? it.qtdComponentesUso + ' comp.' : '—');
        var tabelaEsc = String(tabela)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/"/g, '&quot;');
        return (
          '<tr><td class="col-ctr">#' +
          (it.idContrato || '—') +
          ' <span style="opacity:.65;font-size:12px">v' +
          (it.versao != null ? it.versao : '—') +
          '</span></td><td class="col-regra">' +
          regra +
          '</td><td class="col-de">' +
          fmtDtFech(it.inicio) +
          '</td><td class="col-ate">' +
          fmtDtFechFimInclusivo(it.fim) +
          '</td><td class="col-dias">' +
          (it.dias != null ? it.dias : '—') +
          '</td><td><span class="ap-fech-tabela-uso" title="' +
          tabelaEsc +
          '">' +
          tabelaEsc +
          '</span></td></tr>'
        );
      })
      .join('');
    if (micro > 0) {
      rows +=
        '<tr><td colspan="6" class="ap-fech-micro-hint">' +
        micro +
        ' publicação(ões) no mesmo segundo (0 dias) — não entram no rateio do FIXO.</td></tr>';
    }
    return (
      '<div class="grid-container estatisticas-table-wrap ap-fech-iv-wrap">' +
      '<table class="grid-table estatisticas-table ap-fech-iv-table">' +
      '<colgroup>' +
      '<col class="col-ctr"><col class="col-regra"><col class="col-de"><col class="col-ate"><col class="col-dias"><col>' +
      '</colgroup>' +
      '<thead><tr>' +
      '<th class="col-ctr">Contrato</th><th class="col-regra">Regra</th><th class="col-de">De</th>' +
      '<th class="col-ate">Até</th><th class="col-dias">Dias</th><th>Tabela de uso</th>' +
      '</tr></thead><tbody>' +
      rows +
      '</tbody></table></div>'
    );
  }

  function htmlBreakdownFech(mem, comps) {
    var bd = (mem && mem.breakdown) || {};
    var fixo = Number(bd.fixoCentavos);
    var pct = Number(bd.percentualCentavos);
    var anun = Number(bd.anuncioCentavos);
    if (!Number.isFinite(fixo) || !Number.isFinite(pct) || !Number.isFinite(anun)) {
      fixo = 0;
      pct = 0;
      anun = 0;
      (comps || []).forEach(function (c) {
        var t = String(c.tipo || '').toUpperCase();
        var v = Number(c.valorCentavos) || 0;
        if (t === 'FIXO') fixo += v;
        else if (t === 'PERCENTUAL') pct += v;
        else if (t === 'POR_CARGA_ANUNCIADA') anun += v;
      });
    }
    var linhasFixo = (comps || [])
      .filter(function (c) {
        return String(c.tipo || '').toUpperCase() === 'FIXO' && (Number(c.valorCentavos) || 0) > 0;
      })
      .map(function (c) {
        return (
          '<li>v' +
          (c.versao != null ? c.versao : '—') +
          ' · ' +
          (c.diasIntervalo != null ? c.diasIntervalo + '/' + (c.diasCompetencia || '?') + ' dias · ' : '') +
          fmtBRL(c.valorCentavos) +
          ' <span class="ap-fech-bd-muted">(tabela ' +
          fmtBRL(c.valorContratoCentavos) +
          '/mês)</span></li>'
        );
      })
      .join('');
    return (
      '<div class="ap-fech-breakdown">' +
      '<div class="ap-fech-bd-kpis">' +
      cobField('Fixo (rateado)', fmtBRL(fixo)) +
      cobField('% do frete', fmtBRL(pct)) +
      cobField('Por anúncio', fmtBRL(anun)) +
      '</div>' +
      (linhasFixo
        ? '<ul class="ap-fech-bd-fixo"><strong>Rateio do fixo</strong>' + linhasFixo + '</ul>'
        : '') +
      '</div>'
    );
  }

  function renderFechamento(f) {
    bindFechModalOnce();
    fechUltimo = f || null;
    if (f && (f.ID || f.id)) fechSelId = f.ID || f.id;
    else fechSelId = null;
    if (!f) {
      atualizarBotoesFech(null);
      return;
    }
    if (f.COMPETENCIA || f.competencia) {
      setCompetenciaFech(f.COMPETENCIA || f.competencia);
    }

    var st = f.STATUS || f.status || '';
    var regraOn = (f.FG_REGRA_SNAPSHOT || f.fgRegraSnapshot || 'N') === 'S';
    var ex = parseExcecoes(f);
    var mem = extrairMemoria(f);
    var bounds = (mem && mem.bounds) || {};
    var intervalos = (mem && mem.intervalosContrato) || [];
    var lacunas = (mem && mem.lacunas) || [];
    var comps = (mem && mem.componentes) || [];
    var totais = (mem && mem.totais) || {};
    var comp =
      f.COMPETENCIA || f.competencia || (mem && mem.competencia) || '—';
    var total = fmtBRL(f.TOTAL_CENTAVOS != null ? f.TOTAL_CENTAVOS : f.totalCentavos);
    var anunciadas = String(f.QTD_ANUNCIADAS != null ? f.QTD_ANUNCIADAS : f.qtdAnunciadas || 0);
    var freteInv = String(
      f.QTD_FRETE_INVALIDO != null ? f.QTD_FRETE_INVALIDO : f.qtdFreteInvalido || 0
    );

    var ehPreviaUi = !(f.ID || f.id);
    setFechSteps(st, { previa: ehPreviaUi });
    atualizarBotoesFech(f);
    montarDiag();

    var idEl = document.getElementById('apFechModalId');
    if (idEl) {
      idEl.textContent = comp + (ehPreviaUi ? ' · prévia' : ' · #' + (f.ID || f.id));
    }
    var titleEl = document.getElementById('apFechModalTitle');
    if (titleEl) {
      var badgeHost = titleEl.querySelector('.ap-fech-title-badge');
      if (!badgeHost) {
        badgeHost = document.createElement('span');
        badgeHost.className = 'ap-fech-title-badge';
        badgeHost.style.marginLeft = '8px';
        titleEl.appendChild(badgeHost);
      }
      badgeHost.innerHTML = badgeFech(st, { previa: ehPreviaUi });
    }

    var next = htmlProximoPasso(f, mem, ex, regraOn);
    var btnCtr = document.getElementById('btnFechIrContratos');
    if (btnCtr) {
      btnCtr.style.display = next.showContratos ? '' : 'none';
      btnCtr.onclick = function () {
        fecharFechModal();
        var tabBtn = document.querySelector('.atlas-pay-container .tabs .tab-btn[data-tab="contrato"]');
        if (tabBtn) tabBtn.click();
      };
    }

    var diasUteis = intervalos.filter(function (iv) {
      return (Number(iv.dias) || 0) > 0;
    }).length;
    var body = document.getElementById('apFechModalBody');
    if (body) {
      body.innerHTML =
        next.html +
        '<div class="ap-fech-periodo-bar">' +
        '<strong>Período</strong>' +
        '<span class="ap-fech-periodo-val">' +
        fmtPeriodoCompetencia(bounds.inicio, bounds.fim, bounds.diasMes) +
        '</span>' +
        '<em>' +
        labelCompetencia(comp) +
        '</em>' +
        '</div>' +
        '<div class="ap-fech-kpi-mini">' +
        cobField('Total', total) +
        cobField('Anunciadas', anunciadas) +
        cobField('Frete inválido', freteInv) +
        cobField(
          'Regra',
          regraOn ? '<span class="ap-badge on">Ligada</span>' : '<span class="ap-badge off">Desligada</span>'
        ) +
        cobField(
          'Base % (frete)',
          fmtReais(totais.basePercentual != null ? totais.basePercentual : 0)
        ) +
        '</div>' +
        '<div class="ap-fech-sec">' +
        '<h4 style="margin:12px 0 8px;font-size:13px;color:#64748b">Como chegou no total</h4>' +
        htmlBreakdownFech(mem, comps) +
        '</div>' +
        '<details class="ap-fech-tech ap-fech-sec"><summary><i class="bx bx-error-circle"></i> Lacunas sem contrato (' +
        lacunas.length +
        ')</summary>' +
        htmlLacunasFech(lacunas) +
        '</details>' +
        '<details class="ap-fech-tech" open><summary><i class="bx bx-git-branch"></i> Contratos cobrados no mês (' +
        diasUteis +
        ' vigência' +
        (diasUteis === 1 ? '' : 's') +
        ' com dias)</summary>' +
        htmlIntervalosFech(intervalos) +
        '</details>';
    }

    var modal = document.getElementById('apFechModal');
    if (modal) modal.style.display = 'flex';
    var msgM = document.getElementById('msgFechamentoModal');
    if (msgM) {
      msgM.textContent = '';
      msgM.className = 'ap-modal-msg';
    }
  }

  async function loadFechamentos() {
    var data = await api('/fechamentos-uso?limit=24');
    var rowsRaw = data.fechamentos || [];
    fechamentosPorId = {};
    var rows = rowsRaw.map(function (r) {
      var id = String(r.ID);
      fechamentosPorId[id] = r;
      return {
        ID: id,
        MES: labelCompetencia(r.COMPETENCIA),
        STATUS_HTML: badgeFech(r.STATUS),
        TABELA_USO: r.RESUMO_TABELA_USO || '—',
        VERSOES: r.RESUMO_VERSOES || '—',
        TOTAL: fmtBRL(r.TOTAL_CENTAVOS),
        TOTAL_SORT: Number(r.TOTAL_CENTAVOS) || 0,
        ANUNCIADAS: String(r.QTD_ANUNCIADAS != null ? r.QTD_ANUNCIADAS : ''),
        FRETE_INV: String(r.QTD_FRETE_INVALIDO != null ? r.QTD_FRETE_INVALIDO : ''),
        COBRANCA: r.ID_COBRANCA || '—',
        _tituloTabela: r.RESUMO_TABELA_USO || '',
      };
    });
    setGridCount('fechamentosGridCountText', rows.length);
    var wrap = document.getElementById('fechamentosGrid');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML = podeOperarFechamentoUso()
        ? '<p class="empty">Nenhum fechamento gravado. Use <strong>Calcular e gravar</strong> acima.</p>'
        : '<p class="empty">Nenhuma fatura neste período. Quando a Atlas fechar o mês, o valor aparece aqui.</p>';
      return;
    }
    if (typeof window.GridEditor === 'undefined') {
      wrap.innerHTML = '<p class="empty">GridEditor não carregou. Atualize a página.</p>';
      return;
    }
    // Recria a grid (larguras novas); frete inválido fica só no modal.
    gridFechamentos = null;
    gridFechamentos = ensureGrid('#fechamentosGrid', gridFechamentos, function () {
      return new window.GridEditor({
        container: '#fechamentosGrid',
        actionsWidth: '52px',
        columns: [
          { field: 'ID', header: 'ID', editable: false, isId: true, hidden: true },
          { field: 'MES', header: 'Mês', editable: false, width: '118px' },
          {
            field: 'STATUS_HTML',
            header: 'Situação',
            editable: false,
            width: '128px',
            format: function (v) {
              return v;
            },
          },
          {
            field: 'TABELA_USO',
            header: 'Tabela de uso',
            editable: false,
            format: function (v, row) {
              var txt = String(v || '—');
              var full = String((row && row._tituloTabela) || txt);
              var esc = full.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
              return '<span class="ap-fech-tabela-uso" title="' + esc + '">' + esc + '</span>';
            },
          },
          { field: 'VERSOES', header: 'Versões', editable: false, width: '100px' },
          { field: 'TOTAL', header: 'Total', editable: false, width: '88px', align: 'right' },
          { field: 'ANUNCIADAS', header: 'Anúncios', editable: false, width: '72px', align: 'right' },
          { field: 'COBRANCA', header: 'Cob.', editable: false, width: '64px' },
        ],
        canDeleteRow: function () {
          return false;
        },
        onBeforeEdit: async function (id) {
          try {
            var d = await api('/fechamentos-uso/' + id);
            renderFechamento(d.fechamento);
          } catch (e) {
            notify(e.message || 'Falha ao abrir fechamento.', 'error');
          }
          return false;
        },
        onDelete: function () {},
      });
    });
    if (gridFechamentos) gridFechamentos.render(rows);
  }

  async function boot() {
    initTabs();
    await loadMePerms();
    await carregarSeletorAgentes();
    aplicarUiFechamentoUso();
    var tabAtiva = document.querySelector('.atlas-pay-container .tabs .tab-btn.active');
    posicionarBarraTenant(tabAtiva ? tabAtiva.getAttribute('data-tab') : 'resumo');

    document.getElementById('btnAddConexao').onclick = function () {
      adicionarComponente('CONEXAO');
    };
    document.getElementById('btnAddUso').onclick = function () {
      adicionarComponente('USO_PLATAFORMA');
    };

    document.getElementById('btnPublicar').onclick = async function () {
      var msg = document.getElementById('msgContrato');
      var btn = document.getElementById('btnPublicar');
      msg.textContent = '';
      if (!(hasPerm('FIN_CONTRATO_VERSIONAR') || hasPerm('FIN_CONTRATO_CRIAR'))) {
        clearInlineMsg(msg);
        notify('Sem permissão para publicar contrato.', 'error');
        return;
      }
      if (btn && btn.dataset.busy === '1') return;
      try {
        var compsCx = lerComponentes(document.getElementById('compsConexao'), 'CONEXAO');
        var compsUsoUi = lerComponentes(document.getElementById('compsUso'), 'USO_PLATAFORMA');
        var compsUso = podeEditarUsoAtlas() ? compsUsoUi : [];
        var dup =
          validarComponentesSemDuplicar(compsCx, 'Conexão') ||
          (podeEditarUsoAtlas()
            ? validarComponentesSemDuplicar(compsUso, 'Uso da plataforma')
            : null);
        if (dup) {
          clearInlineMsg(msg);
        notify(dup, 'error');
          return;
        }
        var fg = document.getElementById('cfgRegra').value;
        var pol = document.getElementById('cfgPol').value;
        // Agenciador: envia só Conexão; servidor mantém Uso/regra/política da vigente Atlas.
        var todos = podeEditarUsoAtlas() ? compsCx.concat(compsUso) : compsCx;
        if (fg === 'S' && !todos.length && !(compsUsoUi && compsUsoUi.length)) {
          clearInlineMsg(msg);
          notify(
            'Com a regra ligada, informe ao menos um componente em Conexão ou Uso da plataforma.',
            'error'
          );
          return;
        }
        for (var i = 0; i < todos.length; i++) {
          var c0 = todos[i];
          if (c0.tipo === 'PERCENTUAL') {
            if (!Number.isFinite(c0.percentual)) {
              clearInlineMsg(msg);
        notify('Informe o percentual em todas as linhas de % do frete.', 'error');
              return;
            }
          } else if (!Number.isFinite(c0.valorCentavos)) {
            clearInlineMsg(msg);
        notify('Informe o valor em R$ em todas as linhas de valor fixo / por anúncio.', 'error');
            return;
          }
        }
        var resumoCx = compsCx.length
          ? compsCx
              .map(function (c) {
                return c.tipo === 'PERCENTUAL'
                  ? c.percentual + '% frete'
                  : 'R$ ' + formatCentavosToBRLInput(c.valorCentavos);
              })
              .join(' + ')
          : '(nenhum)';
        var resumoUsoBase = podeEditarUsoAtlas() ? compsUso : compsUsoUi;
        var resumoUso = resumoUsoBase.length
          ? resumoUsoBase
              .map(function (c) {
                if (c.tipo === 'PERCENTUAL') return c.percentual + '% frete';
                if (c.tipo === 'POR_CARGA_ANUNCIADA')
                  return 'R$ ' + formatCentavosToBRLInput(c.valorCentavos) + '/anúncio';
                return 'R$ ' + formatCentavosToBRLInput(c.valorCentavos);
              })
              .join(' + ')
          : '(nenhum)';
        if (!podeEditarUsoAtlas()) {
          resumoUso = resumoUso + ' (somente Atlas; não alterável aqui)';
        }
        if (fg === 'N') {
          if (
            !(await confirmAp(
              'Atenção: regra DESLIGADA.\n\nTenant: ' +
                rotuloAgenteOperando() +
                '\n\nNenhuma cobrança de conexão ou uso será gerada com esta versão.\n\nConfirma publicar assim mesmo?',
              {
                title: 'Regra desligada',
                confirmText: 'Publicar desligada',
                danger: true,
              }
            ))
          )
            return;
        }
        var dhInicio = lerDhInicioForm();
        if (
          !(await confirmAp(
            'Publicar nova versão do contrato?\n\n' +
              'Tenant: ' +
              rotuloAgenteOperando() +
              '\nInício da vigência: ' +
              (dhInicio ? dhInicio + ' 00:00 (SP)' : 'agora (instante da publicação)') +
              '\nRegra: ' +
              (fg === 'S' ? 'Ligada' : 'Desligada') +
              '\nInadimplência: ' +
              (pol === 'BLOQUEIO' ? 'Bloquear' : 'Só alertar') +
              '\nA · Conexão: ' +
              resumoCx +
              '\nB · Uso: ' +
              resumoUso +
              '\n\nVersões anteriores ficam congeladas. Mesma tabela com início antecipado só ajusta a vigente (cobre lacuna).',
            { title: 'Publicar versão', confirmText: 'Publicar' }
          ))
        )
          return;

        if (btn) {
          btn.dataset.busy = '1';
          btn.disabled = true;
        }
        var body = {
          fgRegraAtiva: fg,
          politicaInadimplencia: pol,
          componentes: todos,
        };
        if (dhInicio) body.dhInicio = dhInicio;
        var pub = await api('/contratos', { method: 'POST', body: JSON.stringify(body) });
        if (msg) {
          msg.className = '';
          msg.textContent = '';
        }
        if (pub && pub.ajusteInicioVigencia) {
          notify(
            'Início da vigência antecipado para ' +
              (dhInicio || '') +
              ' (tenant ' +
              rotuloAgenteOperando() +
              '). Recalcule o fechamento do mês.',
            'success'
          );
        } else {
          notify(
            'Nova versão publicada para ' +
              rotuloAgenteOperando() +
              '. Regra ' +
              (body.fgRegraAtiva === 'S' ? 'ligada' : 'desligada') +
              (dhInicio ? '. Vigência desde ' + dhInicio : '') +
              '. Histórico antigo permanece congelado.',
            'success'
          );
        }
        await loadContratos();
        await loadResumo();
      } catch (e) {
        if (msg) {
          msg.className = '';
          msg.textContent = '';
        }
        notify(e.message || 'Falha ao publicar contrato.', 'error');
      } finally {
        if (btn) {
          btn.dataset.busy = '0';
          btn.disabled = false;
        }
      }
    };

    preencherSelectCompetencia().catch(function () {});

    function msgFech(text, ok) {
      clearInlineMsg(document.getElementById('msgFechamento'));
      clearInlineMsg(document.getElementById('msgFechamentoModal'));
      if (text) notify(text, ok ? 'success' : 'error');
    }

    document.getElementById('btnFechPrevia').onclick = async function () {
      msgFech('', true);
      var c = lerCompetenciaFech();
      if (!c) {
        msgFech('Selecione um mês válido na lista.', false);
        return;
      }
      try {
        var d = await api('/fechamentos-uso/previa?competencia=' + encodeURIComponent(c));
        renderFechamento(
          Object.assign({}, d.previa, {
            STATUS: d.previa.status,
            TOTAL_CENTAVOS: d.previa.totalCentavos,
            QTD_ANUNCIADAS: d.previa.qtdAnunciadas,
            QTD_FRETE_INVALIDO: d.previa.qtdFreteInvalido,
            FG_REGRA_SNAPSHOT: d.previa.fgRegraSnapshot,
            memoria: d.previa.memoria,
            excecoes: d.previa.excecoes,
            COMPETENCIA: c,
          })
        );
        msgFech('Prévia de ' + labelCompetencia(c) + ': ' + labelStatusFech(d.previa.status) + '.', true);
      } catch (e) {
        msgFech(e.message || 'Falha na prévia', false);
      }
    };

    async function executarCalcularFechamento() {
      msgFech('', true);
      if (!podeOperarFechamentoUso()) {
        msgFech('Só a Atlas calcula e gera cobrança de uso. Neste login você só consulta.', false);
        return;
      }
      if (!(hasPerm('FIN_COBRANCA_GERAR') || hasPerm('FIN_CONFIGURAR'))) {
        msgFech('Sem permissão para calcular.', false);
        return;
      }
      var c = lerCompetenciaFech();
      if (!c) {
        msgFech('Selecione um mês válido na lista.', false);
        return;
      }
      try {
        var d = await api('/fechamentos-uso/calcular', {
          method: 'POST',
          body: JSON.stringify({ competencia: c }),
        });
        renderFechamento(d.fechamento);
        await loadFechamentos();
        msgFech(
          'Rascunho de ' + labelCompetencia(c) + ' gravado: ' + labelStatusFech(d.fechamento.STATUS) + '.',
          true
        );
      } catch (e) {
        msgFech(e.message || 'Falha ao calcular', false);
      }
    }

    document.getElementById('btnFechCalcular').onclick = function () {
      executarCalcularFechamento();
    };
    var btnCalcModal = document.getElementById('btnFechCalcularModal');
    if (btnCalcModal) {
      btnCalcModal.onclick = function () {
        executarCalcularFechamento();
      };
    }

    document.getElementById('btnFechRecalcular').onclick = async function () {
      if (!podeOperarFechamentoUso()) {
        msgFech('Só a Atlas recalcula fechamento de uso.', false);
        return;
      }
      if (!fechSelId) {
        msgFech('Abra ou calcule um fechamento antes.', false);
        return;
      }
      if (
        !(await confirmAp('Recalcular este fechamento?', {
          title: 'Recalcular fechamento',
          confirmText: 'Recalcular',
        }))
      )
        return;
      try {
        var d = await api('/fechamentos-uso/' + fechSelId + '/recalcular', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        renderFechamento(d.fechamento);
        await loadFechamentos();
        msgFech('Recalculado.', true);
      } catch (e) {
        msgFech(e.message || 'Falha ao recalcular', false);
      }
    };

    document.getElementById('btnFechAprovar').onclick = async function () {
      if (!podeOperarFechamentoUso()) {
        msgFech('Só a Atlas aprova fechamento de uso.', false);
        return;
      }
      if (!fechSelId) {
        msgFech('Selecione um fechamento.', false);
        return;
      }
      if (!(hasPerm('FIN_CONFIGURAR') || hasPerm('FIN_COBRANCA_GERAR'))) {
        msgFech('Sem permissão para aprovar.', false);
        return;
      }
      if (
        !(await confirmAp(
          'Confirmar aprovação deste fechamento?\nA memória de cálculo ficará congelada.',
          { title: 'Aprovar fechamento', confirmText: 'Aprovar' }
        ))
      )
        return;
      try {
        var d = await api('/fechamentos-uso/' + fechSelId + '/aprovar', {
          method: 'POST',
          body: JSON.stringify({ confirmacao: 'APROVAR' }),
        });
        renderFechamento(d.fechamento);
        await loadFechamentos();
        msgFech('Aprovado.', true);
      } catch (e) {
        msgFech(e.message || 'Falha ao aprovar', false);
      }
    };

    document.getElementById('btnFechGerar').onclick = async function () {
      if (!podeOperarFechamentoUso()) {
        msgFech('Só a Atlas gera a cobrança de uso.', false);
        return;
      }
      if (!fechSelId) {
        msgFech('Selecione um fechamento aprovado.', false);
        return;
      }
      if (!hasPerm('FIN_COBRANCA_GERAR')) {
        msgFech('Sem permissão FIN_COBRANCA_GERAR.', false);
        return;
      }
      if (
        !(await confirmAp('Gerar a cobrança de uso da plataforma agora?', {
          title: 'Gerar cobrança',
          confirmText: 'Gerar',
        }))
      )
        return;
      try {
        var d = await api('/fechamentos-uso/' + fechSelId + '/gerar-cobranca', {
          method: 'POST',
          body: JSON.stringify({ confirmacao: 'GERAR_COBRANCA' }),
        });
        renderFechamento(d.fechamento);
        await loadFechamentos();
        await loadCobrancas();
        msgFech(
          (d.idempotente ? 'Cobrança já existia (idempotente). ' : 'Cobrança gerada. ') +
            (d.cobranca && d.cobranca.ID ? 'ID ' + d.cobranca.ID : ''),
          true
        );
      } catch (e) {
        msgFech(e.message || 'Falha ao gerar cobrança', false);
      }
    };

    document.getElementById('formFiltrosCob').addEventListener('submit', function (ev) {
      ev.preventDefault();
      loadCobrancas().catch(function (e) {
        notify(e.message || 'Falha ao filtrar cobranças.', 'error');
      });
    });
    document.getElementById('btnLimparCob').onclick = function () {
      // Padrão operacional: Aberta (evita lista cheia de CANCELADA de testes HML)
      document.getElementById('filStatus').value = 'ABERTA';
      var mod = document.getElementById('filModalidade');
      if (mod) mod.value = '';
      document.getElementById('filQ').value = '';
      loadCobrancas().catch(function (e) {
        notify(e.message || 'Falha ao carregar cobranças.', 'error');
      });
    };

    document.getElementById('btnBaixar').onclick = async function () {
      var msg = document.getElementById('msgBaixa');
      msg.textContent = '';
      if (!cobSelId) return;
      if (!hasPerm('FIN_COBRANCA_BAIXAR')) {
        clearInlineMsg(msg);
        notify('Sem permissão FIN_COBRANCA_BAIXAR.', 'error');
        return;
      }
      if (
        !(await confirmAp('Confirmar baixa manual desta cobrança?', {
          title: 'Baixa de cobrança',
          confirmText: 'Confirmar baixa',
        }))
      )
        return;
      try {
        await api('/cobrancas/' + cobSelId + '/baixa', {
          method: 'POST',
          body: JSON.stringify({
            confirmacao: 'BAIXAR',
            motivo: document.getElementById('baixaMotivo').value,
          }),
        });
        clearInlineMsg(msg);
        notify('Baixa registrada.', 'success');
        await loadCobrancas();
        await abrirDetalhe(cobSelId);
        await loadResumo();
      } catch (e) {
        clearInlineMsg(msg);
        notify(e.message || 'Falha na baixa', 'error');
      }
    };

    var btnFiltrarPerm = document.getElementById('btnFiltrarPerm');
    if (btnFiltrarPerm) {
      btnFiltrarPerm.onclick = function () {
        renderPermUsers(document.getElementById('filPermUser').value);
      };
      document.getElementById('btnLimparPerm').onclick = function () {
        document.getElementById('filPermUser').value = '';
        renderPermUsers('');
      };
      document.getElementById('btnBootstrapAdmin').onclick = async function () {
        var msg = document.getElementById('msgPerm');
        if (!permAlvoLogin) return;
        if (
          !(await confirmAp(
            'Atribuir o perfil Financeiro — Admin a "' +
              permAlvoLogin +
              '" e colocar este tenant em modo STRICT?\n\nUse só na primeira configuração.',
            {
              title: 'Ativar admin inicial',
              confirmText: 'Ativar admin',
              danger: true,
            }
          ))
        )
          return;
        try {
          await api('/permissoes/bootstrap-admin', {
            method: 'POST',
            body: JSON.stringify({ login: permAlvoLogin, confirmacao: 'BOOTSTRAP_ADMIN' }),
          });
          clearInlineMsg(msg);
          notify('Admin inicial ativado para ' + permAlvoLogin + '.', 'success');
          await loadMePerms();
          await loadPermAdmin();
          await openPermEditor(permAlvoLogin);
        } catch (e) {
          clearInlineMsg(msg);
          notify(e.message || 'Falha ao ativar admin inicial.', 'error');
        }
      };
      document.getElementById('btnConcederPerfil').onclick = async function () {
        var msg = document.getElementById('msgPerm');
        if (!permAlvoLogin) return;
        var perfilSel = document.getElementById('selPerfil');
        var perfilLabel =
          (perfilSel && perfilSel.options[perfilSel.selectedIndex]
            ? perfilSel.options[perfilSel.selectedIndex].text
            : '') || (perfilSel ? perfilSel.value : '');
        if (
          !(await confirmAp(
            'Conceder o perfil "' + perfilLabel + '" a "' + permAlvoLogin + '"?',
            { title: 'Conceder perfil', confirmText: 'Conceder' }
          ))
        )
          return;
        try {
          await api('/permissoes/usuarios/' + encodeURIComponent(permAlvoLogin) + '/perfis', {
            method: 'POST',
            body: JSON.stringify({
              perfil: document.getElementById('selPerfil').value,
              confirmacao: 'CONCEDER',
            }),
          });
          clearInlineMsg(msg);
          notify('Perfil concedido a ' + permAlvoLogin + '.', 'success');
          await loadMePerms();
          await loadPermAdmin();
          await openPermEditor(permAlvoLogin);
        } catch (e) {
          clearInlineMsg(msg);
          notify(e.message || 'Falha ao conceder perfil.', 'error');
        }
      };
      document.getElementById('btnAplicarOv').onclick = async function () {
        var msg = document.getElementById('msgPerm');
        if (!permAlvoLogin) return;
        var permSel = document.getElementById('selPermOv');
        var efeitoSel = document.getElementById('selEfeito');
        var permLabel =
          (permSel && permSel.options[permSel.selectedIndex]
            ? permSel.options[permSel.selectedIndex].text
            : '') || (permSel ? permSel.value : '');
        var efeitoLabel =
          efeitoSel && efeitoSel.value === 'R' ? 'revogar (bloquear)' : 'conceder extra';
        if (
          !(await confirmAp(
            'Aplicar ajuste "' + efeitoLabel + '" em "' + permLabel + '" para "' + permAlvoLogin + '"?',
            {
              title: 'Ajuste pontual',
              confirmText: 'Aplicar',
              danger: efeitoSel && efeitoSel.value === 'R',
            }
          ))
        )
          return;
        try {
          await api('/permissoes/usuarios/' + encodeURIComponent(permAlvoLogin) + '/overrides', {
            method: 'POST',
            body: JSON.stringify({
              permissao: document.getElementById('selPermOv').value,
              efeito: document.getElementById('selEfeito').value,
              confirmacao: 'APLICAR',
            }),
          });
          clearInlineMsg(msg);
          notify('Ajuste de permissão aplicado em ' + permAlvoLogin + '.', 'success');
          await loadMePerms();
          await loadPermAdmin();
          await openPermEditor(permAlvoLogin);
        } catch (e) {
          clearInlineMsg(msg);
          notify(e.message || 'Falha ao aplicar ajuste.', 'error');
        }
      };
    }

    var btnCancelarCob = document.getElementById('btnCancelarCob');
    if (btnCancelarCob) {
      btnCancelarCob.onclick = async function () {
        var msg = document.getElementById('msgBaixa');
        msg.textContent = '';
        if (!cobSelId) return;
        if (!hasPerm('FIN_COBRANCA_CANCELAR')) {
          clearInlineMsg(msg);
        notify('Sem permissão FIN_COBRANCA_CANCELAR.', 'error');
          return;
        }
        if (
          !(await confirmAp('Cancelar esta cobrança?', {
            title: 'Cancelar cobrança',
            confirmText: 'Cancelar cobrança',
            danger: true,
          }))
        )
          return;
        try {
          await api('/cobrancas/' + cobSelId + '/cancelar', {
            method: 'POST',
            body: JSON.stringify({
              confirmacao: 'CANCELAR',
              motivo: document.getElementById('baixaMotivo').value,
              origem: 'TORRE',
            }),
          });
          clearInlineMsg(msg);
        notify('Cobrança cancelada.', 'success');
          await loadCobrancas();
          await abrirDetalhe(cobSelId);
          await loadResumo();
        } catch (e) {
          clearInlineMsg(msg);
        notify(e.message || 'Falha no cancelamento', 'error');
        }
      };
    }

    try {
      if (hasPerm('FIN_CONSULTAR') || hasPerm('FIN_COBRANCA_CONSULTAR') || hasPerm('FIN_CONTRATO_CONSULTAR') || mePerms.length) {
        await loadResumo();
        await loadContratos();
        await loadCobrancas();
      }
    } catch (e) {
      notify(e.message || 'Sem permissão ou falha ao carregar Atlas Pay.', 'error');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
