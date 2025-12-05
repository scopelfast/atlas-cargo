// backend/public/modulos/gerenciar-tipos-validade/js/script.js
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoForm = document.getElementById('tipoForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastTipos = null;
  
  let sqlExecutado = false;
  let initExecutado = false;

  // Funções de overlay de loading
  function showLoadingOverlayInitSQL(titulo = 'Processando Inicialização', texto = 'Executando scripts de inicialização...', detalhe = 'Isso pode levar alguns segundos.') {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    const loadingTitle = document.getElementById('loadingTitleInitSQL');
    const loadingText = document.getElementById('loadingTextInitSQL');
    const loadingDetail = document.getElementById('loadingDetailInitSQL');
    
    if (overlay && loadingTitle && loadingText && loadingDetail) {
      loadingTitle.textContent = titulo;
      loadingText.textContent = texto;
      loadingDetail.textContent = detalhe;
      overlay.style.display = 'flex';
    }
  }

  function hideLoadingOverlayInitSQL() {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Executar init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      const response = await fetch('/modulos/gerenciar-tipos-validade/sql/init.sql');
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        if (response.status === 404) {
          hideLoadingOverlayInitSQL();
          return;
        }
        hideLoadingOverlayInitSQL();
        return;
      }
      
      const sqlContent = await response.text();
      let sqlSemComentarios = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
      const sqlLimpo = sqlSemComentarios.split('\n').filter(linha => {
        const linhaTrim = linha.trim();
        return linhaTrim.length > 0 && !linhaTrim.startsWith('--');
      }).join('\n').trim();
      
      if (!sqlLimpo || sqlLimpo.length === 0) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      let execResponse;
      try {
        execResponse = await fetch('/api/tipos-validade/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          signal: AbortSignal.timeout(120000)
        });
      } catch (fetchError) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      if (!execResponse.ok) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Processando resultados...', 'Quase terminando.');
      
      let result;
      try {
        result = await execResponse.json();
      } catch (jsonError) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
      hideLoadingOverlayInitSQL();
    } catch (err) {
      hideLoadingOverlayInitSQL();
    }
  }

  // Inicialização
  async function init() {
    if (initExecutado) return;
    initExecutado = true;
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      await executarInitSQL();
    } catch (err) {}
    await showTab('filtros');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Mudar aba
  async function showTab(tabId) {
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    if (tabId === 'grid') {
      if (!lastTipos) {
        await applyFilters('grid');
        return;
      }

      if (typeof window.GridEditor === 'undefined') {
        try { await loadScript('/js/grid-editor.js'); } catch (e) {}
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastTipos || []);
        } catch (e) {}
      }
    }
  }

  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value;
    const descricao = document.getElementById('filtroDescricao')?.value;
    const tipoCadastro = document.getElementById('filtroTipoCadastro')?.value;
    
    if (codigo) params.append('codigo', codigo);
    if (descricao) params.append('descricao', descricao);
    if (tipoCadastro) params.append('tipoCadastro', tipoCadastro);
    
    try {
      const response = await fetch(`/api/tipos-validade?${params.toString()}`);
      const tipos = await response.json();

      lastTipos = tipos;

      const countEl = document.getElementById('tiposGridCountText');
      if (countEl) {
        countEl.textContent = `${tipos.length || 0} registro(s) encontrado(s)`;
      }

      if (gridTab) {
        try { gridTab.render(tipos); } catch (e) {}
      }

      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try { await loadScript('/js/grid-editor.js'); } catch (e) {}
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
            try { gridTab.render(tipos); } catch (e) {}
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar tipos.', 'error');
    }
  }

  // Carregar script
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      const script = document.createElement('script');
      script.src = `${src}?t=${Date.now()}`;
      script.onload = () => {
        setTimeout(() => {
          if (typeof GridEditor !== 'undefined') resolve();
          else reject(new Error('GridEditor não carregado'));
        }, 100);
      };
      script.onerror = () => reject(new Error(`Erro ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }

  // Inicializar Grid
  function inicializarGridTab() {
    const container = document.getElementById('tiposGrid');
    if (!container) return;

    gridTab = new GridEditor({
      container: container,
      columns: [
        { field: 'CDTIPOVALIDADE', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOVALIDADE', header: 'Descrição', editable: true, type: 'text', maxlength: 40, width: '200px' },
        { field: 'FGVEICULO', header: 'Veículo', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '80px' },
        { field: 'FGMOTORISTA', header: 'Motorista', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '90px' },
        { field: 'FGTRANSPORTADOR', header: 'Transportador', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '120px' },
        { field: 'FGCLIENTE', header: 'Cliente', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '80px' },
        { field: 'FGFORNECEDOR', header: 'Fornecedor', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '100px' },
        { field: 'FGEXIGECERTIFICADORA', header: 'Exige Certif.', editable: true, type: 'select', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗', width: '110px' }
      ],
      apiEndpoint: '/api/tipos-validade',
      onEdit: async (id, data) => {
        await fetch(`/api/tipos-validade/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
      },
      onDelete: async (id) => {
        if (!id) return;
        await confirmarExclusao(id);
      },
      onBeforeEdit: async (id) => {
        await loadTipoParaEdicao(id);
        return false;
      }
    });
  }

  async function loadTipoParaEdicao(id) {
    try {
      tipoForm?.reset();
      
      const response = await fetch(`/api/tipos-validade/${id}`);
      const tipo = await response.json();
      
      if (tipo) {
        document.getElementById('tipoCodigo').value = tipo.CDTIPOVALIDADE;
        document.getElementById('tipoDescricao').value = tipo.DSTIPOVALIDADE;
        document.getElementById('tipoVeiculo').checked = tipo.FGVEICULO === 'S';
        document.getElementById('tipoMotorista').checked = tipo.FGMOTORISTA === 'S';
        document.getElementById('tipoTransportador').checked = tipo.FGTRANSPORTADOR === 'S';
        document.getElementById('tipoCliente').checked = tipo.FGCLIENTE === 'S';
        document.getElementById('tipoFornecedor').checked = tipo.FGFORNECEDOR === 'S';
        document.querySelector(`input[name="tipoExigeCertificadora"][value="${tipo.FGEXIGECERTIFICADORA}"]`).checked = true;
        document.getElementById('formTitle').textContent = 'Editar Tipo de Validade';
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar tipo:', err);
      showMessage('Erro ao carregar dados.', 'error');
    }
  }

  async function confirmarExclusao(id) {
    if (!id) return;
    
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');

    if (!modalEl) return;

    modalMessage.innerHTML = 'Tem certeza que deseja excluir este tipo de validade?';
    modalEl.dataset.deleteId = String(id);
    
    const newYes = confirmYes.cloneNode(true);
    const newNo = confirmNo.cloneNode(true);
    
    confirmYes.parentNode.replaceChild(newYes, confirmYes);
    confirmNo.parentNode.replaceChild(newNo, confirmNo);
    
    newYes.onclick = async () => {
      try {
        const response = await fetch(`/api/tipos-validade/${id}`, { method: 'DELETE' });
        const data = await response.json();
        
        if (response.ok) {
          showMessage('Tipo excluído com sucesso!', 'success');
          applyFilters('grid');
        } else {
          showMessage(data.error || 'Erro ao excluir', 'error');
        }
      } catch (err) {
        showMessage('Erro de conexão.', 'error');
      } finally {
        modalEl.style.display = 'none';
      }
    };
    
    newNo.onclick = () => {
      modalEl.style.display = 'none';
    };
    
    modalEl.style.display = 'block';
  }

  // Submit formulário
  tipoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('tipoCodigo')?.value;
    const descricao = document.getElementById('tipoDescricao')?.value.trim();
    
    if (!descricao) {
      showMessage('Preencha a descrição.', 'error');
      return;
    }

    try {
      const dados = {
        DSTIPOVALIDADE: descricao,
        FGVEICULO: document.getElementById('tipoVeiculo').checked ? 'S' : 'N',
        FGMOTORISTA: document.getElementById('tipoMotorista').checked ? 'S' : 'N',
        FGTRANSPORTADOR: document.getElementById('tipoTransportador').checked ? 'S' : 'N',
        FGCLIENTE: document.getElementById('tipoCliente').checked ? 'S' : 'N',
        FGFORNECEDOR: document.getElementById('tipoFornecedor').checked ? 'S' : 'N',
        FGEXIGECERTIFICADORA: document.querySelector('input[name="tipoExigeCertificadora"]:checked').value
      };
      
      let response;
      if (id) {
        response = await fetch(`/api/tipos-validade/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
      } else {
        response = await fetch('/api/tipos-validade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || 'Salvo com sucesso!', 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || 'Erro ao salvar', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage('Erro de conexão.', 'error');
    }
  });

  // Eventos
  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      await showTab(btn.getAttribute('data-tab'));
    });
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    filtroForm?.reset();
  });

  document.getElementById('btnVoltarFiltrosGrid')?.addEventListener('click', () => showTab('filtros'));
  
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    tipoForm?.reset();
    document.getElementById('formTitle').textContent = 'Novo Tipo de Validade';
    document.getElementById('tipoCodigo').value = '';
    showTab('dados');
  });
  
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

  // Mensagens
  const showMessage = (text, type) => {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, message);
    } else if (message) {
      message.textContent = text;
      message.className = `message ${type} show`;
      setTimeout(() => message.className = 'message', 5000);
    }
  };
})();
