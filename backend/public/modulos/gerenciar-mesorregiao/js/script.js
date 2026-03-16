// backend/public/modulos/gerenciar-mesorregiao/js/script.js
// Módulo Gerenciar Mesorregiões - padrão Gerenciar Equipamentos

(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
  const tabs = document.querySelectorAll('.mesorregiao-container .tab-btn');
  const tabContents = document.querySelectorAll('.mesorregiao-container .tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const mesorregiaoForm = document.getElementById('mesorregiaoForm');
  const message = document.getElementById('message');

  let gridTab = null;
  let lastMesorregioes = [];
  let estadosBrasil = [];
  let paisesCache = [];
  let editandoId = null; // 'CDUF-CDMESOREGIAO' quando em edição

  function showMessage(msg, type) {
    if (typeof window.showMessage === 'function') window.showMessage(msg, type);
    else if (typeof window.toast === 'function') window.toast(msg, type);
    else console.log(type || 'info', msg);
  }

  function showTab(tabId) {
    const targetContent = document.getElementById('tab-' + tabId);
    const targetBtn = document.querySelector('.mesorregiao-container .tab-btn[data-tab="' + tabId + '"]');
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

  function preencherComboPais(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const first = document.createElement('option');
    first.value = '';
    first.textContent = 'Todos';
    sel.innerHTML = '';
    sel.appendChild(first);
    paisesCache.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.CDPAIS;
      opt.textContent = (p.SGPAIS || p.CDPAIS) + ' - ' + (p.DSPAIS || '');
      sel.appendChild(opt);
    });
  }

  async function loadEstadosBrasil() {
    if (estadosBrasil.length) return estadosBrasil;
    try {
      const r = await fetch((typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados-brasil') : '/api/estados-brasil'));
      estadosBrasil = await r.json();
      return estadosBrasil;
    } catch (e) {
      console.error('Erro ao carregar estados:', e);
      return [];
    }
  }

  function preencherComboEstado(selectId, opcaoTodos) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const first = document.createElement('option');
    first.value = '';
    first.textContent = opcaoTodos ? 'Todos' : 'Selecione';
    sel.innerHTML = '';
    sel.appendChild(first);
    estadosBrasil.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.uf;
      opt.textContent = e.uf + ' - ' + e.nome;
      sel.appendChild(opt);
    });
  }

  async function ufParaCduf(uf) {
    if (!uf) return null;
    try {
      const r = await fetch((typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estado-cduf/' + encodeURIComponent(uf)) : '/api/estado-cduf/' + encodeURIComponent(uf)));
      const d = await r.json();
      return d.CDUF != null ? d.CDUF : null;
    } catch (e) {
      return null;
    }
  }

  async function applyFilters(openTab) {
    try {
      const params = new URLSearchParams();
      const cdpais = document.getElementById('filtroPais')?.value;
      const cduf = document.getElementById('filtroEstado')?.value;
      const descricao = document.getElementById('filtroDescricao')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      if (cdpais) params.append('cdpais', cdpais);
      if (cduf) {
        const cd = await ufParaCduf(cduf);
        if (cd != null) params.append('cduf', cd);
      }
      if (descricao && descricao.trim()) params.append('descricao', descricao.trim());
      if (situacao) params.append('situacao', situacao);

      const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/mesorregioes') : '/api/mesorregioes') + (params.toString() ? '?' + params.toString() : '');
      const response = await fetch(url);
      const data = await response.json();
      if (!Array.isArray(data)) {
        showMessage(data.error || 'Erro ao carregar mesorregiões.', 'error');
        return;
      }
      lastMesorregioes = data.map(r => ({
        ...r,
        id: r.CDUF + '-' + r.CDMESOREGIAO
      }));

      const countEl = document.getElementById('mesorregiaoGridCount');
      if (countEl) countEl.textContent = lastMesorregioes.length + ' registro(s) encontrado(s)';

      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        gridTab.render(lastMesorregioes);
      }
      if (openTab === 'grid') {
        if (typeof window.GridEditor !== 'undefined' && !gridTab) inicializarGrid();
        if (gridTab) gridTab.render(lastMesorregioes);
        showTab('grid');
      }
    } catch (err) {
      console.error('Erro ao filtrar:', err);
      showMessage('Erro ao carregar mesorregiões.', 'error');
    }
  }

  function executarDesativarMesorregiao(cduf, cdmesoregiao) {
    const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/mesorregioes') : '/api/mesorregioes';
    return fetch(base + '/' + encodeURIComponent(cduf) + '/' + encodeURIComponent(cdmesoregiao), { method: 'DELETE' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (ok) {
          showMessage(data.message || 'Desativada com sucesso.', 'success');
          applyFilters('grid');
        } else {
          showMessage(data.error || 'Erro ao desativar.', 'error');
        }
      })
      .catch(() => showMessage('Erro ao desativar mesorregião.', 'error'));
  }

  function confirmarExclusao(id) {
    const idStr = String(id).trim();
    const [cduf, cdmesoregiao] = idStr.split('-');
    if (!cduf || !cdmesoregiao) return;
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    const msgKey = 'web.modulos.mesorregiao.msgDesativar';
    const msg = (t(msgKey) !== msgKey ? t(msgKey) : null) || 'Tem certeza que deseja desativar esta mesorregião?';
    if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
      if (confirm(msg)) executarDesativarMesorregiao(cduf, cdmesoregiao);
      return;
    }
    modalMessage.textContent = msg;
    const newConfirmYes = confirmYes.cloneNode(true);
    const newConfirmNo = confirmNo.cloneNode(true);
    newConfirmYes.className = 'btn-filtro btn-filtro-danger';
    newConfirmYes.innerHTML = '<i class="bx bx-check"></i> Desativar';
    newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
    newConfirmNo.innerHTML = '<i class="bx bx-x"></i> Cancelar';
    confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
    confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
    newConfirmYes.onclick = () => {
      executarDesativarMesorregiao(cduf, cdmesoregiao);
      modalEl.style.display = 'none';
    };
    newConfirmNo.onclick = () => { modalEl.style.display = 'none'; };
    modalEl.style.display = 'block';
  }

  function inicializarGrid() {
    if (typeof window.GridEditor === 'undefined') return;
    gridTab = new window.GridEditor({
      container: '#mesorregiaoGrid',
      columns: [
        { field: 'id', header: 'Chave', editable: false, isId: true, width: '100px', hidden: true },
        { field: 'ESTADO_UF', header: 'UF', editable: false, width: '80px' },
        { field: 'CDMESOREGIAO', header: 'Código', editable: false, width: '90px' },
        { field: 'DSMESOREGIAO', header: 'Descrição', editable: false, width: '280px' },
        { field: 'FGACTIVE', header: 'Situação', editable: false, width: '90px', align: 'right', format: (val) => val === 'S' ? 'Ativo' : 'Inativo' }
      ],
      apiEndpoint: '/api/mesorregioes',
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
    const [cduf, cdmesoregiao] = String(id).split('-');
    if (!cduf || !cdmesoregiao) return;
    try {
      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/mesorregioes') : '/api/mesorregioes';
      const r = await fetch(base + '/' + encodeURIComponent(cduf) + '/' + encodeURIComponent(cdmesoregiao));
      const row = await r.json();
      if (!r.ok) {
        showMessage(row.error || 'Registro não encontrado.', 'error');
        return;
      }
      editandoId = id;
      document.getElementById('mesoCDUF').value = row.CDUF;
      document.getElementById('mesoCDMESOREGIAO').value = row.CDMESOREGIAO;
      document.getElementById('mesoCDMESOREGIAOInput').value = row.CDMESOREGIAO;
      document.getElementById('mesoCDMESOREGIAOInput').readOnly = true;
      document.getElementById('mesoDSMESOREGIAO').value = row.DSMESOREGIAO || '';
      document.getElementById('mesoFGACTIVE').value = row.FGACTIVE || 'S';
      document.getElementById('mesoEstado').innerHTML = '';
      const opt = document.createElement('option');
      opt.value = row.ESTADO_UF || '';
      opt.textContent = (row.ESTADO_UF || '') + (row.NMESTADO ? ' - ' + row.NMESTADO : '');
      document.getElementById('mesoEstado').appendChild(opt);
      document.getElementById('mesoEstado').disabled = true;
      document.getElementById('formTitle').textContent = 'Editar Mesorregião';
      showTab('dados');
    } catch (e) {
      showMessage('Erro ao carregar registro.', 'error');
    }
  }

  function limparFormNovo() {
    editandoId = null;
    document.getElementById('mesorregiaoForm').reset();
    document.getElementById('mesoCDUF').value = '';
    document.getElementById('mesoCDMESOREGIAO').value = '';
    document.getElementById('mesoCDMESOREGIAOInput').readOnly = false;
    document.getElementById('mesoEstado').disabled = false;
    preencherComboEstado('mesoEstado', false);
    document.getElementById('formTitle').textContent = 'Nova Mesorregião';
  }

  async function salvarForm(e) {
    e.preventDefault();
    const estadoUf = document.getElementById('mesoEstado').value;
    const cdmesoregiaoInput = document.getElementById('mesoCDMESOREGIAOInput').value;
    const dsm = document.getElementById('mesoDSMESOREGIAO').value?.trim();
    const fg = document.getElementById('mesoFGACTIVE').value;
    if (!dsm) {
      showMessage('Preencha a descrição.', 'error');
      return;
    }
    const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/mesorregioes') : '/api/mesorregioes';

    if (editandoId) {
      const cduf = document.getElementById('mesoCDUF').value;
      const cdmesoregiao = document.getElementById('mesoCDMESOREGIAO').value;
      try {
        const r = await fetch(base + '/' + encodeURIComponent(cduf) + '/' + encodeURIComponent(cdmesoregiao), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ DSMESOREGIAO: dsm, FGACTIVE: fg })
        });
        const data = await r.json();
        if (r.ok) {
          showMessage(data.message || 'Atualizada com sucesso.', 'success');
          limparFormNovo();
          applyFilters('grid');
          showTab('filtros');
        } else {
          showMessage(data.error || 'Erro ao atualizar.', 'error');
        }
      } catch (err) {
        showMessage('Erro ao atualizar mesorregião.', 'error');
      }
      return;
    }

    if (!estadoUf || !cdmesoregiaoInput) {
      showMessage('Selecione o estado e informe o código da mesorregião.', 'error');
      return;
    }
    const cduf = await ufParaCduf(estadoUf);
    if (cduf == null) {
      showMessage('Não foi possível obter o código do estado.', 'error');
      return;
    }
    try {
      const r = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CDUF: cduf,
          CDMESOREGIAO: parseInt(cdmesoregiaoInput, 10),
          DSMESOREGIAO: dsm,
          FGACTIVE: fg
        })
      });
      const data = await r.json();
      if (r.ok) {
        showMessage(data.message || 'Cadastrada com sucesso.', 'success');
        limparFormNovo();
        applyFilters('grid');
        showTab('filtros');
      } else {
        showMessage(data.error || 'Erro ao cadastrar.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao cadastrar mesorregião.', 'error');
    }
  }

  async function init() {
    await loadPaises();
    preencherComboPais('filtroPais');
    await loadEstadosBrasil();
    preencherComboEstado('filtroEstado', true);
    preencherComboEstado('mesoEstado', false);

    filtroForm?.addEventListener('submit', (e) => { e.preventDefault(); applyFilters('grid'); });
    document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
      document.getElementById('filtroPais').value = '';
      document.getElementById('filtroEstado').value = '';
      document.getElementById('filtroDescricao').value = '';
      document.getElementById('filtroSituacao').value = '';
    });
    document.getElementById('btnNovo')?.addEventListener('click', () => { limparFormNovo(); showTab('dados'); });
    document.getElementById('btnNovoGrid')?.addEventListener('click', () => { limparFormNovo(); showTab('dados'); });
    document.getElementById('btnVoltarGrid')?.addEventListener('click', () => showTab('filtros'));
    document.getElementById('btnCancelar')?.addEventListener('click', () => { limparFormNovo(); showTab('filtros'); });
    mesorregiaoForm?.addEventListener('submit', salvarForm);

    tabs.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        if (tabId === 'grid' && gridTab && lastMesorregioes.length) gridTab.render(lastMesorregioes);
        showTab(tabId);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
