// backend/public/modulos/gerenciar-tipos-validade/js/script.js
(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
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

  function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = localStorage.getItem('token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && (user.login || user.SGUSUARIO)) headers['user-login'] = user.login || user.SGUSUARIO;
    } catch (e) {}
    return headers;
  }

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

  // Mudar aba (sempre no container do módulo para não misturar com Grid/Dados de outros contextos)
  async function showTab(tabId) {
    const targetContent = document.getElementById(`tab-${tabId}`);
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!targetContent || !targetBtn) return;
    const container = targetContent.closest('.tipos-validade-container') || targetContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    }
    targetBtn.classList.add('active');
    targetContent.classList.add('active');

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
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(tipos.length || 0));
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
      showMessage(t('web.modulos.tiposValidade.erroCarregarTipos'), 'error');
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
        { field: 'DSTIPOVALIDADE', header: 'Descrição', editable: true, type: 'text', maxlength: 40 },
        { field: 'FGVEICULO', header: 'Veículo', editable: true, type: 'select', width: '85px', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗' },
        { field: 'FGMOTORISTA', header: 'Motorista', editable: true, type: 'select', width: '90px', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗' },
        { field: 'FGTRANSPORTADOR', header: 'Transportador', editable: true, type: 'select', width: '110px', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗' },
        { field: 'FGEXIGECERTIFICADORA', header: 'Exige Certif.', editable: true, type: 'select', width: '110px', align: 'right', options: [{value:'S',label:'Sim'},{value:'N',label:'Não'}], format: (v) => v==='S'?'✓':'✗' }
      ],
      apiEndpoint: '/api/tipos-validade',
      onEdit: async (id, data) => {
        await fetch(`/api/tipos-validade/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
        document.querySelector(`input[name="tipoExigeCertificadora"][value="${tipo.FGEXIGECERTIFICADORA}"]`).checked = true;
        document.getElementById('formTitle').textContent = t('web.modulos.tiposValidade.editarTipo');
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar tipo:', err);
      showMessage(t('web.modulos.tiposValidade.erroCarregarDados'), 'error');
    }
  }

  async function confirmarExclusao(id) {
    if (!id) return;
    const idStr = String(id).trim();
    const msg = t('web.modulos.tiposValidade.confirmarExcluir') || 'Tem certeza que deseja desativar este tipo de validade?';
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');

    function executarDesativar() {
      fetch(`/api/tipos-validade/${idStr}`, { method: 'DELETE', headers: getAuthHeaders() })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ok) {
            showMessage(t('web.modulos.tiposValidade.sucessoExcluir'), 'success');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.tiposValidade.erroExcluir'), 'error');
          }
        })
        .catch(() => showMessage(t('web.modulos.tiposValidade.erroConexao'), 'error'))
        .finally(() => { if (modalEl) modalEl.style.display = 'none'; });
    }

    if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
      if (confirm(msg)) executarDesativar();
      return;
    }

    modalMessage.textContent = msg;
    modalEl.dataset.deleteId = idStr;
    const newYes = confirmYes.cloneNode(true);
    const newNo = confirmNo.cloneNode(true);
    newYes.className = 'btn-filtro btn-filtro-danger';
    newYes.innerHTML = '<i class="bx bx-check"></i> Desativar';
    newNo.className = 'btn-filtro btn-filtro-limpar';
    newNo.innerHTML = '<i class="bx bx-x"></i> ' + (t('web.modulos.tiposValidade.cancelar') || 'Cancelar');
    confirmYes.parentNode.replaceChild(newYes, confirmYes);
    confirmNo.parentNode.replaceChild(newNo, confirmNo);
    newYes.onclick = () => executarDesativar();
    newNo.onclick = () => { modalEl.style.display = 'none'; delete modalEl.dataset.deleteId; };
    modalEl.style.display = 'block';
  }

  // Submit formulário (bloqueio no início para evitar cadastro duplicado)
  let tipoValidadeFormSubmitting = false;
  tipoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (tipoValidadeFormSubmitting) return;
    tipoValidadeFormSubmitting = true;
    const btnSubmit = tipoForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }

    const id = document.getElementById('tipoCodigo')?.value;
    const descricao = document.getElementById('tipoDescricao')?.value.trim();

    if (!descricao) {
      showMessage(t('web.modulos.tiposValidade.preenchaDescricao'), 'error');
      tipoValidadeFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const dados = {
        DSTIPOVALIDADE: descricao,
        FGVEICULO: document.getElementById('tipoVeiculo').checked ? 'S' : 'N',
        FGMOTORISTA: document.getElementById('tipoMotorista').checked ? 'S' : 'N',
        FGTRANSPORTADOR: document.getElementById('tipoTransportador').checked ? 'S' : 'N',
        FGCLIENTE: 'N',
        FGFORNECEDOR: 'N',
        FGEXIGECERTIFICADORA: document.querySelector('input[name="tipoExigeCertificadora"]:checked').value
      };
      
      let response;
      if (id) {
        response = await fetch(`/api/tipos-validade/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(dados)
        });
      } else {
        response = await fetch('/api/tipos-validade', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(dados)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || t('web.modulos.tiposValidade.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.tiposValidade.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.tiposValidade.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        tipoValidadeFormSubmitting = false;
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = labelOriginal;
        }
      }, 600);
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
  
  function irParaNovoTipo() {
    tipoForm?.reset();
    document.getElementById('formTitle').textContent = t('web.modulos.tiposValidade.novoRegistro') || t('web.modulos.tiposValidade.novoTipo') || 'Novo Tipo de Validade';
    document.getElementById('tipoCodigo').value = '';
    const exigeN = document.querySelector('input[name="tipoExigeCertificadora"][value="N"]');
    if (exigeN) exigeN.checked = true;
    document.getElementById('tipoVeiculo').checked = false;
    document.getElementById('tipoMotorista').checked = false;
    document.getElementById('tipoTransportador').checked = false;
    showTab('dados');
  }
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', irParaNovoTipo);
  document.getElementById('btnNovoRegistro')?.addEventListener('click', irParaNovoTipo);
  
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
            <li><strong>Aplicabilidade:</strong> Definir para quais tipos de cadastro cada validade se aplica (Veículo, Motorista, Transportador)</li>
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
