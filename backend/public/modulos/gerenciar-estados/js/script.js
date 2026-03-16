// backend/public/modulos/gerenciar-estados/js/script.js
// Módulo Gerenciar Estados - cadastro de estados (BR, PY, AR, UY)

(function() {
  const tabs = document.querySelectorAll('.estados-container .tab-btn');
  const tabContents = document.querySelectorAll('.estados-container .tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const estadoForm = document.getElementById('estadoForm');

  let gridTab = null;
  let lastEstados = [];
  let paisesCache = [];
  let editandoId = null;

  function showMessage(msg, type) {
    if (typeof window.showMessage === 'function') window.showMessage(msg, type);
    else if (typeof window.toast === 'function') window.toast(msg, type);
    else console.log(type || 'info', msg);
  }

  function showTab(tabId) {
    const targetContent = document.getElementById('tab-' + tabId);
    const targetBtn = document.querySelector('.estados-container .tab-btn[data-tab="' + tabId + '"]');
    if (!targetContent || !targetBtn) return;
    tabContents.forEach(c => c.classList.remove('active'));
    tabs.forEach(b => b.classList.remove('active'));
    targetBtn.classList.add('active');
    targetContent.classList.add('active');
  }

  async function loadPaises() {
    if (paisesCache.length) return paisesCache;
    try {
      const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/paises') : '/api/paises');
      const r = await fetch(url);
      paisesCache = await r.json();
      return Array.isArray(paisesCache) ? paisesCache : [];
    } catch (e) {
      console.error('Erro ao carregar países:', e);
      return [];
    }
  }

  function preencherComboPais(selectId, opcaoTodos) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const first = document.createElement('option');
    first.value = '';
    first.textContent = opcaoTodos ? 'Todos' : 'Selecione';
    sel.innerHTML = '';
    sel.appendChild(first);
    paisesCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.CDPAIS;
      opt.textContent = (p.SGPAIS || p.CDPAIS) + ' - ' + (p.DSPAIS || '');
      sel.appendChild(opt);
    });
  }

  async function applyFilters(openTab) {
    try {
      const params = new URLSearchParams();
      const cdpais = document.getElementById('filtroPais')?.value;
      const nome = document.getElementById('filtroNome')?.value;
      const sigla = document.getElementById('filtroSigla')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      if (cdpais) params.append('cdpais', cdpais);
      if (nome && nome.trim()) params.append('nome', nome.trim());
      if (sigla && sigla.trim()) params.append('sigla', sigla.trim());
      if (situacao) params.append('situacao', situacao);

      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados';
      const response = await fetch(base + (params.toString() ? '?' + params.toString() : ''));
      const data = await response.json();
      if (!Array.isArray(data)) {
        showMessage(data.error || 'Erro ao carregar estados.', 'error');
        return;
      }
      lastEstados = data.map(r => ({
        ...r,
        id: r.CDPAIS + '-' + r.CDUF
      }));

      const countEl = document.getElementById('estadosGridCount');
      if (countEl) countEl.textContent = lastEstados.length + ' registro(s) encontrado(s)';

      if (typeof window.GridEditor !== 'undefined' && gridTab) gridTab.render(lastEstados);
      if (openTab === 'grid') {
        if (typeof window.GridEditor !== 'undefined' && !gridTab) inicializarGrid();
        if (gridTab) gridTab.render(lastEstados);
        showTab('grid');
      }
    } catch (err) {
      console.error('Erro ao filtrar:', err);
      showMessage('Erro ao carregar estados.', 'error');
    }
  }

  function executarDesativarEstado(cdpais, cduf) {
    const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados';
    return fetch(base + '/' + encodeURIComponent(cdpais) + '/' + encodeURIComponent(cduf), { method: 'DELETE' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          showMessage(data.message || 'Desativado com sucesso.', 'success');
          applyFilters('grid');
        } else {
          showMessage(data.error || 'Erro ao desativar.', 'error');
        }
      })
      .catch(() => showMessage('Erro ao desativar estado.', 'error'));
  }

  function confirmarExclusao(id) {
    const idStr = String(id).trim();
    const [cdpais, cduf] = idStr.split('-');
    if (!cdpais || !cduf) {
      console.warn('[Estados] confirmarExclusao: ID inválido', id);
      return;
    }
    const msg = 'Tem certeza que deseja desativar este estado?';
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    const modalOk = modalEl && modalMessage && confirmYes && confirmNo &&
      document.body.contains(confirmYes) && confirmYes.parentNode;
    if (!modalOk) {
      if (window.confirm(msg)) executarDesativarEstado(cdpais, cduf);
      return;
    }
    modalMessage.textContent = msg;
    const newConfirmYes = confirmYes.cloneNode(true);
    const newConfirmNo = confirmNo.cloneNode(true);
    newConfirmYes.className = 'btn-filtro btn-filtro-danger';
    newConfirmYes.innerHTML = '<i class="bx bx-check"></i> Desativar';
    newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
    newConfirmNo.innerHTML = '<i class="bx bx-x"></i> Cancelar';
    if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
    if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
    newConfirmYes.onclick = () => {
      executarDesativarEstado(cdpais, cduf);
      modalEl.style.display = 'none';
    };
    newConfirmNo.onclick = () => { modalEl.style.display = 'none'; };
    modalEl.style.display = 'block';
  }

  function inicializarGrid() {
    if (typeof window.GridEditor === 'undefined') return;
    gridTab = new window.GridEditor({
      container: '#estadosGrid',
      columns: [
        { field: 'id', header: 'Chave', editable: false, isId: true, width: '80px', hidden: true },
        { field: 'PAIS_SIGLA', header: 'País', editable: false, width: '70px' },
        { field: 'ESTADO', header: 'Sigla', editable: false, width: '80px' },
        { field: 'CDUF', header: 'CDUF', editable: false, width: '80px' },
        { field: 'NMESTADO', header: 'Nome', editable: false, width: '220px' },
        { field: 'FGACTIVE', header: 'Situação', editable: false, width: '90px', align: 'right', format: (val) => val === 'S' ? 'Ativo' : 'Inativo' }
      ],
      apiEndpoint: '/api/estados',
      onBeforeEdit: async (id) => {
        await carregarParaEdicao(id);
        return false;
      },
      onDelete: async (id) => {
        if (!id) return;
        confirmarExclusao(id);
      }
    });
  }

  async function carregarParaEdicao(id) {
    const [cdpais, cduf] = String(id).split('-');
    if (!cdpais || !cduf) return;
    try {
      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados';
      const r = await fetch(base + '/' + encodeURIComponent(cdpais) + '/' + encodeURIComponent(cduf));
      const row = await r.json();
      if (!r.ok) {
        showMessage(row.error || 'Registro não encontrado.', 'error');
        return;
      }
      editandoId = id;
      document.getElementById('estadoCDPAIS').value = row.CDPAIS;
      document.getElementById('estadoCDUF').value = row.CDUF;
      document.getElementById('estadoCDUFInput').value = row.CDUF;
      document.getElementById('estadoCDUFInput').readOnly = true;
      document.getElementById('estadoSigla').value = row.ESTADO || '';
      document.getElementById('estadoNMESTADO').value = row.NMESTADO || '';
      document.getElementById('estadoFGACTIVE').value = row.FGACTIVE || 'S';
      document.getElementById('estadoPais').innerHTML = '';
      const opt = document.createElement('option');
      opt.value = row.CDPAIS;
      opt.textContent = (row.PAIS_SIGLA || row.CDPAIS) + ' - ' + (row.DSPAIS || '');
      document.getElementById('estadoPais').appendChild(opt);
      document.getElementById('estadoPais').disabled = true;
      document.getElementById('formTitle').textContent = 'Editar Estado';
      showTab('dados');
    } catch (e) {
      showMessage('Erro ao carregar registro.', 'error');
    }
  }

  function limparFormNovo() {
    editandoId = null;
    estadoForm.reset();
    document.getElementById('estadoCDPAIS').value = '';
    document.getElementById('estadoCDUF').value = '';
    document.getElementById('estadoCDUFInput').readOnly = false;
    document.getElementById('estadoPais').disabled = false;
    preencherComboPais('estadoPais', false);
    document.getElementById('formTitle').textContent = 'Novo Estado';
  }

  async function salvarForm(e) {
    e.preventDefault();
    const cdpaisVal = document.getElementById('estadoCDPAIS').value;
    const cdufVal = document.getElementById('estadoCDUF').value;
    const cdufInput = document.getElementById('estadoCDUFInput').value;
    const sigla = document.getElementById('estadoSigla').value?.trim();
    const nm = document.getElementById('estadoNMESTADO').value?.trim();
    const fg = document.getElementById('estadoFGACTIVE').value;
    if (!nm) {
      showMessage('Preencha o nome do estado.', 'error');
      return;
    }
    const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados';

    if (editandoId) {
      try {
        const r = await fetch(base + '/' + encodeURIComponent(cdpaisVal) + '/' + encodeURIComponent(cdufVal), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ESTADO: sigla || null, NMESTADO: nm, FGACTIVE: fg })
        });
        const data = await r.json();
        if (r.ok) {
          showMessage(data.message || 'Atualizado com sucesso.', 'success');
          limparFormNovo();
          applyFilters('grid');
          showTab('filtros');
        } else {
          showMessage(data.error || 'Erro ao atualizar.', 'error');
        }
      } catch (err) {
        showMessage('Erro ao atualizar estado.', 'error');
      }
      return;
    }

    const paisSel = document.getElementById('estadoPais').value;
    if (!paisSel || !cdufInput) {
      showMessage('Selecione o país e informe o código (CDUF).', 'error');
      return;
    }
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CDPAIS: Number(paisSel),
          CDUF: parseInt(cdufInput, 10),
          ESTADO: sigla || null,
          NMESTADO: nm,
          FGACTIVE: fg
        })
      });
      const data = await r.json();
      if (r.ok) {
        showMessage(data.message || 'Cadastrado com sucesso.', 'success');
        limparFormNovo();
        applyFilters('grid');
        showTab('filtros');
      } else {
        showMessage(data.error || 'Erro ao cadastrar.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao cadastrar estado.', 'error');
    }
  }

  async function init() {
    await loadPaises();
    preencherComboPais('filtroPais', true);
    preencherComboPais('estadoPais', false);

    filtroForm?.addEventListener('submit', (e) => { e.preventDefault(); applyFilters('grid'); });
    document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
      document.getElementById('filtroPais').value = '';
      document.getElementById('filtroNome').value = '';
      document.getElementById('filtroSigla').value = '';
      document.getElementById('filtroSituacao').value = '';
    });
    document.getElementById('btnNovo')?.addEventListener('click', () => { limparFormNovo(); showTab('dados'); });
    document.getElementById('btnNovoGrid')?.addEventListener('click', () => { limparFormNovo(); showTab('dados'); });
    document.getElementById('btnVoltarGrid')?.addEventListener('click', () => showTab('filtros'));
    document.getElementById('btnCancelar')?.addEventListener('click', () => { limparFormNovo(); showTab('filtros'); });
    estadoForm?.addEventListener('submit', salvarForm);

    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (tabId === 'grid' && gridTab && lastEstados.length) gridTab.render(lastEstados);
        showTab(tabId);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Delegação: botão Excluir da grid sempre funciona (dashboard substitui HTML e o GridEditor perde o listener)
  const rootEstados = document.getElementById('contentArea') || document;
  rootEstados.addEventListener('click', (e) => {
    const btn = e.target.closest('#estadosGrid .grid-btn-delete');
    if (!btn) return;
    const row = btn.closest('tr[data-grid-id]');
    if (!row) return;
    const id = row.getAttribute('data-grid-id');
    if (!id || id === 'undefined' || id === 'null' || id === '') return;
    e.preventDefault();
    e.stopPropagation();
    console.log('[Estados] Clique Excluir delegado, id=', id);
    confirmarExclusao(id);
  }, true);
})();
