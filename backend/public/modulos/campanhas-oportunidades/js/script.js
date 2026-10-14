(function () {
  const el = (id) => document.getElementById(id);
  const TK = 'web.modulos.campanhasOportunidades.';
  function tco(suffix) {
    return typeof window.tWeb === 'function' ? window.tWeb(TK + suffix) : '';
  }
  function twReplace(suffix, map) {
    let s = tco(suffix);
    if (!s) return '';
    Object.keys(map).forEach((k) => {
      s = s.split(`{${k}}`).join(String(map[k]));
    });
    return s;
  }
  function localeDateStr() {
    return document.documentElement.getAttribute('lang') === 'es' ? 'es-PY' : 'pt-BR';
  }
  const state = {
    viagens: [],
    motoristas: [],
    campanhaSelecionada: null,
    selectedViagens: new Set(),
    selectedMotoristas: new Set(),
    motoristasPage: 1,
    motoristasLimit: 100,
    motoristasTotalPages: 1,
    motoristasTotal: 0,
    motoristasReqSeq: 0,
    refreshTimer: null,
  };

  function headersJson() {
    const t = localStorage.getItem('token');
    const h = { 'Content-Type': 'application/json' };
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  }

  function msg(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type || 'info');
    const info = el('campInfo');
    if (info) info.textContent = text;
  }

  const oportSwitchHealthBadge = el('oportSwitchHealthBadge');
  function setSwitchHealthBadgeOport(status, text) {
    if (!oportSwitchHealthBadge) return;
    oportSwitchHealthBadge.classList.remove('oport-switch-badge--ok', 'oport-switch-badge--down', 'oport-switch-badge--loading');
    if (status === 'ok') oportSwitchHealthBadge.classList.add('oport-switch-badge--ok');
    else if (status === 'down') oportSwitchHealthBadge.classList.add('oport-switch-badge--down');
    else oportSwitchHealthBadge.classList.add('oport-switch-badge--loading');
    oportSwitchHealthBadge.textContent = text || 'Sessão Switch: verificando...';
  }

  async function refreshSwitchHealthOport() {
    setSwitchHealthBadgeOport('loading', 'Sessão Switch: verificando...');
    try {
      const r = await fetch('/api/viagens/webhook/switch-digital/health', {
        method: 'POST',
        headers: headersJson(),
        body: JSON.stringify({ origem: 'campanhas-oportunidades' })
      });
      const d = await parseJsonResponse(r).catch(() => ({}));
      if (r.ok && d && d.healthy === true) {
        setSwitchHealthBadgeOport('ok', 'Sessão Switch: ativa');
      } else {
        setSwitchHealthBadgeOport('down', 'Sessão Switch: inativa');
      }
    } catch (_) {
      setSwitchHealthBadgeOport('down', 'Sessão Switch: inativa');
    }
  }

  function setBuscaStatus(tipo, texto, isErro) {
    const id = tipo === 'viagens' ? 'statusFiltroViagens' : 'statusFiltroMotoristas';
    const p = el(id);
    if (!p) return;
    p.textContent = texto || '';
    p.classList.toggle('filtro-status-erro', !!isErro);
  }

  function showConfirmModalOportunidades(titleHeadline, message) {
    return new Promise((resolve) => {
      const modal = el('oportConfirmModal');
      const titleText = el('oportConfirmTitleText');
      const msgEl = el('oportConfirmMessage');
      const btnOk = el('oportConfirmOk');
      const btnCancel = el('oportConfirmCancel');
      if (!modal || !titleText || !msgEl || !btnOk || !btnCancel) {
        if (typeof window.confirmPadrao === 'function') {
          window.confirmPadrao(String(message || ''), {
            title: titleHeadline || 'Confirmar Ação',
          }).then((ok) => resolve(!!ok));
        } else {
          resolve(window.confirm(String(message || '')));
        }
        return;
      }
      titleText.textContent = titleHeadline;
      msgEl.textContent = message;
      modal.style.display = 'flex';

      let done = false;
      const cleanup = (value) => {
        if (done) return;
        done = true;
        modal.style.display = 'none';
        document.removeEventListener('keydown', onKey);
        modal.removeEventListener('click', onOverlay);
        btnOk.removeEventListener('click', onOk);
        btnCancel.removeEventListener('click', onCancel);
        resolve(value);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') cleanup(false);
      };
      const onOverlay = (e) => {
        if (e.target === modal) cleanup(false);
      };
      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);
      document.addEventListener('keydown', onKey);
      modal.addEventListener('click', onOverlay);
      btnOk.addEventListener('click', onOk);
      btnCancel.addEventListener('click', onCancel);
      setTimeout(() => {
        try {
          btnOk.focus();
        } catch (_) {}
      }, 10);
    });
  }

  async function parseJsonResponse(r) {
    const text = await r.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(tco('erroJsonInvalido'));
    }
  }

  /** Erro de API com status HTTP (ex.: 409 → aviso amarelo no showMessage). */
  function erroApi(r, d, fallback) {
    const text = (d && (d.error || d.message || d.details)) || fallback || `HTTP ${r.status}`;
    const err = new Error(String(text));
    err.httpStatus = r.status;
    return err;
  }

  function msgErroHttp(e) {
    const t = e && e.message ? e.message : String(e || '');
    msg(t, e && e.httpStatus === 409 ? 'warning' : 'error');
  }

  function setList(containerId, items, type) {
    const box = el(containerId);
    box.innerHTML = '';
    items.forEach((it) => {
      const id = type === 'viagem' ? (it.IDVIAGEM ?? it.idviagem) : (it.CDCADASTRO ?? it.cdcadastro);
      const label = type === 'viagem'
        ? `#${id} - ${it.DSROTEIRO || it.dsroteiro || ''} (${it.ORIGEM_CIDADE || ''}/${it.ORIGEM_ESTADO || ''} -> ${it.DESTINO_CIDADE || ''}/${it.DESTINO_ESTADO || ''})`
        : `${it.RZSOCIAL || it.rzsocial || ''} (${it.NRCELULAR || it.nrcelular || tco('semTelefone')})`;
      const row = document.createElement('label');
      row.className = 'oport-item';
      row.innerHTML = `<input type="checkbox" data-type="${type}" value="${id}"><span>${label}</span>`;
      const cb = row.querySelector('input[type="checkbox"]');
      const setRef = type === 'viagem' ? state.selectedViagens : state.selectedMotoristas;
      cb.checked = setRef.has(Number(id));
      cb.addEventListener('change', () => {
        const n = Number(id);
        if (cb.checked) setRef.add(n);
        else setRef.delete(n);
        updateSelectionInfo();
        if (type === 'viagem' && regrasAtivas()) {
          state.motoristasPage = 1;
          loadMotoristas().catch((e) => msgErroHttp(e));
        }
      });
      box.appendChild(row);
    });
  }

  function selectedIds(type) {
    return Array.from(type === 'viagem' ? state.selectedViagens : state.selectedMotoristas);
  }

  function updateSelectionInfo() {
    const mi = el('motoristasInfo');
    if (mi) {
      mi.textContent = twReplace('motoristasSelecionados', {
        sel: state.selectedMotoristas.size,
        total: state.motoristasTotal,
      });
    }
  }

  function regrasAtivas() {
    return el('rgClasseFrota').checked
      || el('rgRastreamento').checked
      || el('rgLocalEmbarque').checked
      || el('rgLocalDesembarque').checked;
  }

  function regrasPayload() {
    return {
      modoRegras: (el('rgClasseFrota').checked || el('rgRastreamento').checked || el('rgLocalEmbarque').checked || el('rgLocalDesembarque').checked) ? 'FILTRAR' : 'TODOS',
      validarClasseFrota: el('rgClasseFrota').checked ? 'S' : 'N',
      validarRastreamento: el('rgRastreamento').checked ? 'S' : 'N',
      validarLocalEmbarque: el('rgLocalEmbarque').checked ? 'S' : 'N',
      validarLocalDesembarque: el('rgLocalDesembarque').checked ? 'S' : 'N',
      viagemIds: selectedIds('viagem').join(',')
    };
  }

  async function loadViagens() {
    setBuscaStatus('viagens', tco('buscandoViagens'), false);
    try {
      const qRaw = (el('qViagens').value || '').trim();
      const q = encodeURIComponent(qRaw);
      const r = await fetch(`/api/oportunidades-campanhas/elegiveis/viagens?q=${q}`, { headers: headersJson() });
      const d = await parseJsonResponse(r);
      if (!r.ok) throw erroApi(r, d, twReplace('erroHttpViagens', { s: r.status }));
      state.viagens = d.viagens || [];
      setList('listViagens', state.viagens, 'viagem');
      if (!state.viagens.length) {
        setBuscaStatus('viagens', tco('nenhumaViagemAjuda'), false);
      } else {
        const suf = qRaw ? twReplace('viagensFiltro', { q: qRaw }) : tco('viagensSemFiltro');
        setBuscaStatus('viagens', twReplace('viagensListadas', { n: state.viagens.length }) + suf, false);
      }
    } catch (e) {
      setBuscaStatus('viagens', e.message || String(e), true);
      throw e;
    }
  }

  async function loadMotoristas() {
    setBuscaStatus('motoristas', tco('buscandoMotoristas'), false);
    const reqSeq = ++state.motoristasReqSeq;
    const q = (el('qMotoristas').value || '').trim();
    const rg = regrasPayload();
    const params = new URLSearchParams({
      q,
      page: String(state.motoristasPage),
      limit: String(state.motoristasLimit),
      modoRegras: rg.modoRegras,
      validarClasseFrota: rg.validarClasseFrota,
      validarRastreamento: rg.validarRastreamento,
      validarLocalEmbarque: rg.validarLocalEmbarque,
      validarLocalDesembarque: rg.validarLocalDesembarque,
      viagemIds: rg.viagemIds
    });
    try {
      const r = await fetch(`/api/oportunidades-campanhas/elegiveis/motoristas?${params.toString()}`, { headers: headersJson() });
      const d = await parseJsonResponse(r);
      if (!r.ok) throw erroApi(r, d, twReplace('erroHttpMotoristas', { s: r.status }));
      if (reqSeq !== state.motoristasReqSeq) return;
      state.motoristas = d.motoristas || [];
      const pg = d.pagination || {};
      state.motoristasTotalPages = Number(pg.totalPages || 1);
      state.motoristasTotal = Number(pg.total || state.motoristas.length);
      state.motoristasPage = Number(pg.page || state.motoristasPage);
      const lbl = el('lblPageMotoristas');
      if (lbl) {
        lbl.textContent = twReplace('paginaDeTotal', {
          atual: state.motoristasPage,
          total: state.motoristasTotalPages,
        });
      }
      const prev = el('btnPrevMotoristas');
      const next = el('btnNextMotoristas');
      if (prev) prev.disabled = state.motoristasPage <= 1;
      if (next) next.disabled = state.motoristasPage >= state.motoristasTotalPages;
      setList('listMotoristas', state.motoristas, 'motorista');
      updateSelectionInfo();
      const regrasOn = regrasAtivas();
      const sufQ = q ? twReplace('listaAtualizadaTexto', { q }) : '';
      const sufR = regrasOn && rg.viagemIds ? tco('nenhumMotoristaRegras') : '';
      if (!state.motoristasTotal) {
        const sufQ2 = q ? twReplace('nenhumMotoristaTexto', { q }) : '';
        setBuscaStatus('motoristas', tco('nenhumMotorista') + sufQ2 + sufR, false);
      } else {
        setBuscaStatus(
          'motoristas',
          twReplace('listaAtualizadaMotoristas', {
            total: state.motoristasTotal,
            nesta: state.motoristas.length,
            atual: state.motoristasPage,
            pages: state.motoristasTotalPages,
          }) + sufQ,
          false
        );
      }
    } catch (e) {
      if (reqSeq === state.motoristasReqSeq) {
        setBuscaStatus('motoristas', e.message || String(e), true);
      }
      throw e;
    }
  }

  async function loadCampanhas() {
    const r = await fetch('/api/oportunidades-campanhas', { headers: headersJson() });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroCarregarCampanhas'));
    const tbody = el('tbodyCampanhas');
    tbody.innerHTML = '';
    (d.campanhas || []).forEach((c) => {
      const id = c.ID || c.id;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="radio" name="campSel" value="${id}"></td>
        <td>${id}</td>
        <td>${c.NOME || c.nome}</td>
        <td>${c.STATUS || c.status}</td>
        <td>${c.TOTAL_VIAGENS || c.total_viagens || 0}</td>
        <td>${c.TOTAL_DESTINATARIOS || c.total_destinatarios || 0}</td>
        <td>${c.TOTAL_ENVIADOS || c.total_enviados || 0}</td>
        <td>${c.TOTAL_FALHAS || c.total_falhas || 0}</td>
        <td>${c.PROCESSADOS || c.processados || 0}</td>
        <td>${new Date(c.CRIADO_EM || c.criado_em).toLocaleString(localeDateStr())}</td>
      `;
      tbody.appendChild(tr);
    });
    const selId = state.campanhaSelecionada;
    if (selId != null && !Number.isNaN(Number(selId))) {
      const keep = tbody.querySelector(`input[name="campSel"][value="${String(selId)}"]`);
      if (keep) keep.checked = true;
    }
  }

  async function criarCampanha() {
    const nome = (el('campNome').value || '').trim();
    const mensagemTemplate = (el('campMsg').value || '').trim();
    const expiraHoras = Number(el('campExpira').value || 48);
    const intervaloMs = Number(el('campIntervaloMs').value || 650);
    const maxPorExecucao = Number(el('campMaxExecucao').value || 5000);
    const retryMax = Number(el('campRetryMax').value || 3);
    const somenteCelularValido = el('campSomenteCelValido').checked ? 'S' : 'N';
    const viagemIds = selectedIds('viagem');
    const motoristaIds = selectedIds('motorista');
    if (!nome) throw new Error(tco('erroNomeCampanha'));
    if (!mensagemTemplate) throw new Error(tco('erroMsgCampanha'));
    if (!viagemIds.length) throw new Error(tco('erroMinViagem'));
    if (!motoristaIds.length) throw new Error(tco('erroMinMotorista'));
    const r = await fetch('/api/oportunidades-campanhas', {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({ nome, mensagemTemplate, expiraHoras, intervaloMs, maxPorExecucao, retryMax, somenteCelularValido, viagemIds, motoristaIds })
    });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroCriarCampanha'));
    state.campanhaSelecionada = Number(d.idCampanha);
    msg(twReplace('campanhaCriada', { id: state.campanhaSelecionada }), 'success');
    await loadCampanhas();
  }

  async function dispararCampanha() {
    if (!state.campanhaSelecionada) throw new Error(tco('erroSelecioneCampanha'));
    const ok = await showConfirmModalOportunidades(
      twReplace('modalDispararTitulo', { id: state.campanhaSelecionada }),
      tco('modalDispararCorpo')
    );
    if (!ok) return;
    const intervaloMs = Number(el('campIntervaloMs').value || 650);
    const maxPorExecucao = Number(el('campMaxExecucao').value || 5000);
    const retryMax = Number(el('campRetryMax').value || 3);
    const somenteCelularValido = el('campSomenteCelValido').checked ? 'S' : 'N';
    const r = await fetch(`/api/oportunidades-campanhas/${state.campanhaSelecionada}/disparar`, {
      method: 'POST',
      headers: headersJson(),
      body: JSON.stringify({ intervaloMs, maxPorExecucao, retryMax, somenteCelularValido })
    });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroDisparar'));
    msg(twReplace('disparoIniciado', { n: d.pendentes != null ? d.pendentes : '' }), 'success');
    await loadCampanhas();
    await refreshSwitchHealthOport();
  }

  async function pausarCampanha() {
    if (!state.campanhaSelecionada) throw new Error(tco('erroSelecioneCampanha'));
    const r = await fetch(`/api/oportunidades-campanhas/${state.campanhaSelecionada}/pausar`, { method: 'POST', headers: headersJson() });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroPausar'));
    msg(tco('campanhaPausada'), 'success');
    await loadCampanhas();
  }

  async function retomarCampanha() {
    if (!state.campanhaSelecionada) throw new Error(tco('erroSelecioneCampanha'));
    const r = await fetch(`/api/oportunidades-campanhas/${state.campanhaSelecionada}/retomar`, { method: 'POST', headers: headersJson() });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroRetomar'));
    msg(tco('campanhaRetomada'), 'success');
    await loadCampanhas();
  }

  async function reprocessarFalhas() {
    if (!state.campanhaSelecionada) throw new Error(tco('erroSelecioneCampanha'));
    const r = await fetch(`/api/oportunidades-campanhas/${state.campanhaSelecionada}/reprocessar-falhas`, { method: 'POST', headers: headersJson() });
    const d = await parseJsonResponse(r);
    if (!r.ok) throw erroApi(r, d, tco('erroReprocessar'));
    msg(tco('falhasReprocessar'), 'success');
    await loadCampanhas();
  }

  function markAll(type, checked) {
    const setRef = type === 'viagem' ? state.selectedViagens : state.selectedMotoristas;
    Array.from(document.querySelectorAll(`input[data-type="${type}"]`)).forEach((c) => {
      const n = Number(c.value);
      c.checked = checked;
      if (checked) setRef.add(n);
      else setRef.delete(n);
    });
    updateSelectionInfo();
    if (type === 'viagem' && regrasAtivas()) {
      state.motoristasPage = 1;
      loadMotoristas().catch((e) => msgErroHttp(e));
    }
  }

  el('btnLoadViagens').addEventListener('click', () => {
    loadViagens().catch((e) => msgErroHttp(e));
  });
  el('btnLoadMotoristas').addEventListener('click', () => {
    state.motoristasPage = 1;
    loadMotoristas().catch((e) => msgErroHttp(e));
  });
  el('btnPrevMotoristas').addEventListener('click', () => {
    if (state.motoristasPage <= 1) return;
    state.motoristasPage -= 1;
    loadMotoristas().catch((e) => msgErroHttp(e));
  });
  el('btnNextMotoristas').addEventListener('click', () => {
    if (state.motoristasPage >= state.motoristasTotalPages) return;
    state.motoristasPage += 1;
    loadMotoristas().catch((e) => msgErroHttp(e));
  });
  el('btnCriarCampanha').addEventListener('click', () => criarCampanha().catch((e) => msgErroHttp(e)));
  el('btnDispararCampanha').addEventListener('click', () => dispararCampanha().catch((e) => msgErroHttp(e)));
  el('btnPausarCampanha').addEventListener('click', () => pausarCampanha().catch((e) => msgErroHttp(e)));
  el('btnRetomarCampanha').addEventListener('click', () => retomarCampanha().catch((e) => msgErroHttp(e)));
  el('btnReprocessarFalhas').addEventListener('click', () => reprocessarFalhas().catch((e) => msgErroHttp(e)));
  el('btnCarregarCampanhas').addEventListener('click', () => loadCampanhas().catch((e) => msgErroHttp(e)));
  const tbodyCampanhas = el('tbodyCampanhas');
  if (tbodyCampanhas && !tbodyCampanhas.dataset.delegateCampSel) {
    tbodyCampanhas.dataset.delegateCampSel = '1';
    tbodyCampanhas.addEventListener('change', (ev) => {
      const t = ev.target;
      if (t && t.name === 'campSel' && t.type === 'radio') {
        state.campanhaSelecionada = Number(t.value);
      }
    });
  }
  el('btnSelViagens').addEventListener('click', () => markAll('viagem', true));
  el('btnSelMotoristas').addEventListener('click', () => markAll('motorista', true));
  el('btnDeselViagens').addEventListener('click', () => markAll('viagem', false));
  el('btnDeselMotoristas').addEventListener('click', () => markAll('motorista', false));
  ['rgClasseFrota', 'rgRastreamento', 'rgLocalEmbarque', 'rgLocalDesembarque'].forEach((id) => {
    el(id).addEventListener('change', () => {
      state.motoristasPage = 1;
      loadMotoristas().catch((e) => msgErroHttp(e));
    });
  });

  (function seedMsgTemplate() {
    const ta = el('campMsg');
    const v = tco('msgDefaultTemplate');
    if (ta && v && !v.startsWith('web.')) ta.value = v;
  })();

  Promise.all([loadViagens(), loadMotoristas(), loadCampanhas()]).catch((e) => msgErroHttp(e));
  refreshSwitchHealthOport();
  state.refreshTimer = setInterval(() => {
    loadCampanhas().catch(() => {});
  }, 5000);
})();
