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

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-validade/sql/init.sql', '/api/tipos-validade/executar-init-sql', 'tipos-validade');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-validade/sql/init.sql', '/api/tipos-validade/executar-init-sql', 'tipos-validade');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Tipos Validade] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
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
      if (typeof window.GridEditor === 'undefined') {
        try { await loadScript('/js/grid-editor.js'); } catch (e) { console.warn('[Tipos Validade] falha ao carregar GridEditor:', e); }
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastTipos || []);
        } catch (e) {
          console.error('[Tipos Validade] erro ao renderizar grid na aba:', e);
        }
      }
      // NÃO aplicar filtros automaticamente - usuário deve aplicar manualmente
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

      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(tipos);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados (opção A)
      try {
        if (Array.isArray(tipos) && tipos.length > 0) {
          if (typeof window.GridEditor === 'undefined') {
            // Aguardar um pouco para o dashboard.js carregar
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(tipos);
            } catch (e) {
            }
          }
        }
      } catch (autoErr) {
        console.error('[Tipos Validade] Erro no fluxo de auto-init:', autoErr);
      }

      // Se openTab é 'grid', tentar auto-inicializar se necessário
      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try {
            await loadScript('/js/grid-editor.js');
          } catch (loadErr) {
            console.warn('[Tipos Validade] erro ao carregar grid-editor para auto-init:', loadErr);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
            try {
              gridTab.render(tipos);
            } catch (e) {
              console.warn('[Tipos Validade] erro ao auto-render gridTab:', e);
            }
          }
        } else {
          const scriptEl = document.querySelector('script[src="/js/grid-editor.js"]');
          if (scriptEl) {
            try {
              const oldSrc = scriptEl.src;
              scriptEl.src = oldSrc + (oldSrc.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
              await new Promise(resolve => setTimeout(resolve, 500));
              if (typeof window.GridEditor !== 'undefined' && !gridTab) {
                inicializarGridTab();
                try { gridTab.render(tipos); } catch (e) { console.warn('[Tipos Validade] erro ao render após reload forçado', e); }
              }
            } catch (rbErr) {
              console.warn('[Tipos Validade] falha no reload forçado:', rbErr);
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar tipos.', 'error');
    }
  }

  // Carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        // Usar corrigirUrl se disponível para garantir o caminho base correto
        const srcCorrigido = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl(src) : src;
        script.src = `${srcCorrigido}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
          setTimeout(() => {
            if (typeof window.GridEditor !== 'undefined') {
              resolve();
            } else {
              reject(new Error('GridEditor não foi carregado'));
            }
          }, 100);
        };
        script.onerror = () => reject(new Error(`Erro ao carregar script: ${src}`));
        document.head.appendChild(script);
      };
      
      // Verificar se o script já está sendo carregado ou já existe
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        // Se o script existe, aguardar ele carregar
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof window.GridEditor !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            // Se não carregou após 2 segundos, remover e recarregar
            existingScript.remove();
            // Continuar com o carregamento abaixo
            carregarNovoScript();
          }
        }, 100);
        return;
      }
      
      carregarNovoScript();
    });
  }

  // Inicializar Grid
  function inicializarGridTab() {
    // GridEditor já é carregado globalmente pelo dashboard.js
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Tipos Validade] GridEditor não está disponível');
      return;
    }

    const container = document.getElementById('tiposGrid');
    if (!container) return;

    gridTab = new window.GridEditor({
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

  // Função para mostrar ajuda (PADRÃO ÚNICO)
  window.mostrarAjudaTiposValidade = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaTiposValidade');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaTiposValidade';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Tipos de Validade</h3>
          <button onclick="window.fecharModalAjudaTiposValidade()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Tipos de Validade</strong> permite gerenciar os tipos de validade de documentos e certificações que podem ser aplicados aos diferentes cadastros do sistema.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar tipos de validade por código, descrição ou tipo de cadastro.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar tipos de validade</li>
            <li><strong>Grid:</strong> Visualizar tipos de validade em formato de tabela</li>
            <li><strong>Dados:</strong> Criar e editar tipos de validade</li>
            <li><strong>Aplicabilidade:</strong> Definir para quais tipos de cadastro cada validade se aplica (Veículo, Motorista, Transportador, Cliente, Fornecedor)</li>
            <li><strong>Certificadora:</strong> Definir se o tipo de validade exige certificadora</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaTiposValidade()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaTiposValidade = function() {
    const modal = document.getElementById('modalAjudaTiposValidade');
    if (modal) {
      modal.remove();
    }
  };

  // Fechar modal de ajuda ao clicar fora
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('modalAjudaTiposValidade');
    if (modal && e.target === modal) {
      window.fecharModalAjudaTiposValidade();
    }
  });
})();
