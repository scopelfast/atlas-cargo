(function () {
  const TK = 'web.modulos.disparoWhatsappOportunidades.';
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

  const dwRoot = document.getElementById('dwRoot');
  const tabFiltrosEl = document.getElementById('dw-tab-filtros');
  const tabGridEl = document.getElementById('dw-tab-grid');
  const tabBtns = document.querySelectorAll('[data-dw-tab]');
  const btnVoltarFiltros = document.getElementById('btnVoltarFiltros');
  const dwGridEmpty = document.getElementById('dwGridEmpty');

  const templateMsg = document.getElementById('templateMsg');
  const listaLinhas = document.getElementById('listaLinhas');
  const delayMs = document.getElementById('delayMs');
  const maxLinhas = document.getElementById('maxLinhas');
  const btnPreview = document.getElementById('btnPreview');
  const btnEnviar = document.getElementById('btnEnviar');
  const btnLimpar = document.getElementById('btnLimpar');
  const previewArea = document.getElementById('previewArea');
  const previewTable = document.getElementById('previewTable');
  const previewStats = document.getElementById('previewStats');
  const dwMessage = document.getElementById('dwMessage');
  const overlay = document.getElementById('dwOverlay');
  const overlayTitle = document.getElementById('dwOverlayTitle');
  const overlayText = document.getElementById('dwOverlayText');
  const overlayDetalhe = document.getElementById('dwOverlayDetalhe');

  let ultimaPrevia = null;

  function applyI18nDwRoot() {
    if (typeof window.applyI18nWeb === 'function' && dwRoot) {
      window.applyI18nWeb(dwRoot);
    }
  }

  function setDwTab(name) {
    tabBtns.forEach((b) => {
      const on = b.getAttribute('data-dw-tab') === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (tabFiltrosEl) tabFiltrosEl.classList.toggle('active', name === 'filtros');
    if (tabGridEl) tabGridEl.classList.toggle('active', name === 'grid');
  }

  function getAuthJsonHeaders() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(tco('erroJsonInvalido'));
    }
  }

  function showLocalMessage(text, type) {
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type);
    }
    if (dwMessage) {
      dwMessage.textContent = text;
      dwMessage.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info');
      dwMessage.style.display = 'block';
    }
  }

  function showLoading(titleKey, textKey, detalheText) {
    if (overlayTitle) {
      overlayTitle.textContent = titleKey ? tco(titleKey) : tco('overlayProcessando');
    }
    if (overlayText) {
      overlayText.textContent = textKey ? tco(textKey) : tco('overlayAguarde');
    }
    if (overlayDetalhe) overlayDetalhe.textContent = detalheText || '';
    if (overlay) {
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  function hideLoading() {
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function showConfirmModalDw(titleText, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('dwConfirmModal');
      const titleEl = document.getElementById('dwConfirmTitleText');
      const msgEl = document.getElementById('dwConfirmMessage');
      const btnOk = document.getElementById('dwConfirmOk');
      const btnCancel = document.getElementById('dwConfirmCancel');
      if (!modal || !msgEl || !btnOk || !btnCancel) {
        resolve(window.confirm(String(message || '')));
        return;
      }
      if (titleEl) titleEl.textContent = titleText;
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

  function renderPreview(data) {
    if (!previewTable) return;
    const tbody = previewTable.querySelector('tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const okLabel = tco('statusOk');
    const invLabel = tco('statusInvalido');
    (data.linhas || []).forEach((row) => {
      const tr = document.createElement('tr');
      const st = row.erro
        ? '<span class="dw-err">' + escapeHtml(invLabel) + '</span>'
        : '<span class="dw-ok">' + escapeHtml(okLabel) + '</span>';
      const inicio = (row.previewCorpo || '').slice(0, 80).replace(/\s+/g, ' ');
      tr.innerHTML =
        '<td>' +
        escapeHtml(row.nome) +
        '</td><td>' +
        escapeHtml(row.telefoneE164 || '—') +
        '</td><td>' +
        escapeHtml((row.uf || '') + (row.cidade ? ' / ' + row.cidade : '')) +
        '</td><td>' +
        escapeHtml(row.dddFonte || '—') +
        '</td><td>' +
        st +
        (row.erro ? '<div style="font-size:0.75rem;margin-top:4px;color:#b91c1c;">' + escapeHtml(row.erro) + '</div>' : '') +
        (row.aviso && !row.erro
          ? '<div style="font-size:0.75rem;margin-top:4px;color:#a16207;">' + escapeHtml(row.aviso) + '</div>'
          : '') +
        '</td><td style="max-width:240px;">' +
        escapeHtml(inicio) +
        (inicio.length >= 80 ? '…' : '') +
        '</td>';
      tbody.appendChild(tr);
    });
    const total = data.total || 0;
    const validos =
      data.validos != null
        ? data.validos
        : (data.linhas || []).filter((l) => !l.erro && l.telefoneE164).length;
    const erros =
      data.invalidos != null
        ? data.invalidos
        : (data.linhas || []).filter((l) => l.erro || !l.telefoneE164).length;
    previewStats.textContent = twReplace('statsPreview', { total, validos, erros });
    if (previewArea) previewArea.style.display = 'block';
    if (dwGridEmpty) dwGridEmpty.style.display = 'none';
    setDwTab('grid');
    applyI18nDwRoot();
  }

  async function doPreview() {
    const template = (templateMsg && templateMsg.value) || '';
    const linhas = (listaLinhas && listaLinhas.value) || '';
    if (!String(template).trim()) {
      showLocalMessage(tco('erroTemplateVazio'), 'error');
      return;
    }
    showLoading('overlayPreviewTitle', 'overlayPreviewText', '');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const res = await fetch('/api/configuracoes/switch-digital/disparo-oportunidade/preview', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ template, linhasTexto: linhas })
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || data.details || tco('erroPrevia'));
      }
      ultimaPrevia = data;
      renderPreview(data);
      showLocalMessage(tco('msgPreviewAtualizada'), 'success');
    } catch (e) {
      showLocalMessage(e.message || tco('erroPreviaHttp'), 'error');
    } finally {
      hideLoading();
    }
  }

  async function doEnviar() {
    const template = (templateMsg && templateMsg.value) || '';
    const linhas = (listaLinhas && listaLinhas.value) || '';
    if (!String(template).trim()) {
      showLocalMessage(tco('erroTemplateVazio'), 'error');
      return;
    }
    const validos =
      ultimaPrevia && ultimaPrevia.linhas
        ? ultimaPrevia.linhas.filter((l) => !l.erro && l.telefoneE164).length
        : null;
    if (validos === 0) {
      showLocalMessage(tco('erroNenhumaValida'), 'error');
      return;
    }
    let bodyMsg;
    if (validos != null && validos > 0) {
      const maxN = Math.min(validos, parseInt(maxLinhas.value, 10) || 200);
      bodyMsg = twReplace('confirmarEnvioComPrevia', { n: maxN });
    } else {
      bodyMsg = tco('confirmarEnvioSemPrevia');
    }
    const ok = await showConfirmModalDw(tco('modalConfirmTitulo'), bodyMsg);
    if (!ok) return;

    showLoading('overlaySendTitle', 'overlaySendText', tco('overlaySendDetalhe'));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const res = await fetch('/api/configuracoes/switch-digital/disparo-oportunidade/enviar', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({
          template,
          linhasTexto: linhas,
          delayMs: parseInt(delayMs.value, 10) || 650,
          maxLinhas: parseInt(maxLinhas.value, 10) || 200
        })
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        throw new Error(data.error || data.details || tco('erroEnvio'));
      }
      const dup =
        data.ignoradosDuplicata != null && data.ignoradosDuplicata > 0
          ? twReplace('msgDupIgnoradas', { n: data.ignoradosDuplicata })
          : '';
      const msgDone = twReplace('msgConcluido', {
        enviados: data.enviadosCount || 0,
        falhas: data.falhasCount || 0,
        dup: dup
      });
      showLocalMessage(msgDone, data.falhasCount > 0 ? 'warning' : 'success');
      await doPreview();
    } catch (e) {
      showLocalMessage(e.message || tco('erroEnvioMsg'), 'error');
    } finally {
      hideLoading();
    }
  }

  function limpar() {
    if (listaLinhas) listaLinhas.value = '';
    if (previewArea) previewArea.style.display = 'none';
    if (dwGridEmpty) dwGridEmpty.style.display = 'block';
    if (previewTable) {
      const tb = previewTable.querySelector('tbody');
      if (tb) tb.innerHTML = '';
    }
    if (previewStats) previewStats.textContent = '';
    ultimaPrevia = null;
    setDwTab('filtros');
    showLocalMessage(tco('msgListaLimpa'), 'success');
  }

  (function seedDefaults() {
    if (templateMsg) {
      const v = tco('placeholderTemplate');
      if (v && !v.startsWith('web.')) templateMsg.placeholder = v;
    }
    if (listaLinhas) {
      const v = tco('placeholderLista');
      if (v && !v.startsWith('web.')) listaLinhas.placeholder = v;
    }
  })();

  tabBtns.forEach((b) => {
    b.addEventListener('click', () => setDwTab(b.getAttribute('data-dw-tab') || 'filtros'));
  });
  if (btnVoltarFiltros) btnVoltarFiltros.addEventListener('click', () => setDwTab('filtros'));

  if (btnPreview) btnPreview.addEventListener('click', () => doPreview());
  if (btnEnviar) btnEnviar.addEventListener('click', () => doEnviar());
  if (btnLimpar) btnLimpar.addEventListener('click', () => limpar());

  applyI18nDwRoot();
})();
