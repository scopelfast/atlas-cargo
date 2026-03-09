// backend/public/modulos/gerenciar-tipos-viagem/js/script.js
(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoForm = document.getElementById('tipoForm');
  const list = document.getElementById('tiposList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let grid = null;
  let gridTab = null;
  let lastTipos = null; // cache dos últimos resultados do filtro
  
  // Define mensagem customizada para este módulo
  if (typeof window !== 'undefined' && typeof window.APP_CONFIRM_DELETE_MESSAGE === 'undefined') {
    window.APP_CONFIRM_DELETE_MESSAGE = 'Tem certeza que deseja desativar este tipo?';
  } else if (typeof window !== 'undefined') {
    window.APP_CONFIRM_DELETE_MESSAGE = 'Tem certeza que deseja desativar este tipo?';
  }
  
  let sqlExecutado = false;
  let initExecutado = false;

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-viagem/sql/init.sql', '/api/tipos-viagem/executar-init-sql', 'tipos-viagem');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-viagem/sql/init.sql', '/api/tipos-viagem/executar-init-sql', 'tipos-viagem');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Tipos] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
  }

  // Função de inicialização
  async function init() {
    if (initExecutado) return;
    initExecutado = true;
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      await executarInitSQL();
    } catch (err) {
    }
    await showTab('filtros');
  }

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM já está pronto, executar imediatamente
    init();
  }

  // Função para mudar abas
  async function showTab(tabId) {
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
    if (tabId === 'grid') {
      // Se não temos dados, forçar uma busca
      if (!lastTipos) {
        await applyFilters('grid');
        return;
      }

      if (typeof window.GridEditor === 'undefined') {
        try { await loadScript('/js/grid-editor.js'); } catch (e) { console.warn('[Tipos] falha ao carregar GridEditor:', e); }
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastTipos || []);
        } catch (e) {
          console.error('[Tipos] erro ao renderizar grid na aba:', e);
        }
      }
    }
  }

  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value;
    const descricao = document.getElementById('filtroDescricao')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;
    
    if (codigo) params.append('codigo', codigo);
    if (descricao) params.append('descricao', descricao);
    if (situacao) params.append('situacao', situacao);
    
    try {
      const response = await fetch(`/api/tipos-viagem?${params.toString()}`);
      const tipos = await response.json();

      // salvar cache de resultados
      lastTipos = tipos;

      // Atualizar contador
      const countEl = document.getElementById('tiposGridCountText');
      if (countEl) {
        const count = tipos.length || 0;
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(count));
      }

      // Se Grid já existe, atualizar
      if (gridTab) {
        try {
          gridTab.render(tipos);
        } catch (e) {
          console.warn('[Tipos] erro ao atualizar gridTab:', e);
        }
      }

      // Se openTab é 'grid', tentar auto-inicializar se necessário
      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try {
            await loadScript('/js/grid-editor.js');
          } catch (loadErr) {
            console.warn('[Tipos] erro ao carregar grid-editor para auto-init:', loadErr);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
            try {
              gridTab.render(tipos);
            } catch (e) {
              console.warn('[Tipos] erro ao auto-render gridTab:', e);
            }
          }
        } else {
          const scriptEl = document.querySelector('script[src="/js/grid-editor.js"]');

          if (scriptEl) {
            try {
              const oldSrc = scriptEl.src;
              scriptEl.src = oldSrc + (oldSrc.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
              
              // Aguardar um pouco e tentar novamente
              await new Promise(resolve => setTimeout(resolve, 500));

              if (typeof window.GridEditor !== 'undefined' && !gridTab) {
                inicializarGridTab();
                try { gridTab.render(tipos); } catch (e) { console.warn('[Tipos] erro ao render após reload forçado', e); }
              } else if (typeof window.GridEditor === 'undefined') {
                console.warn('[Tipos] após reload forçado GridEditor ainda indefinido');
              }
            } catch (rbErr) {
              console.warn('[Tipos] falha no reload forçado:', rbErr);
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.tiposViagem.erroCarregarTipos'), 'error');
    }
  }

  function renderList(tipos) {
    if (!tipos || tipos.length === 0) {
      list.innerHTML = '<p class="empty">Nenhum tipo encontrado.</p>';
      return;
    }

    list.innerHTML = tipos.map(t => `
      <div class="list-item ${t.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${t.CDTIPOVIAGEM}">
        <div>
          <strong>${t.CDTIPOVIAGEM} - ${t.DSTIPOVIAGEM}</strong>
          <small>
            <strong>Status:</strong> ${t.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${t.CDTIPOVIAGEM}">Editar</button>
          <button class="btn delete" data-id="${t.CDTIPOVIAGEM}">Excluir</button>
        </div>
      </div>
    `).join('');

    // CORREÇÃO CRÍTICA: usa currentTarget para evitar ID undefined
    document.querySelectorAll('.btn.edit, .btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Tentar obter o ID de várias formas
        const id = e.currentTarget.dataset.id || 
                   e.currentTarget.getAttribute('data-id') ||
                   e.currentTarget.closest('[data-id]')?.dataset?.id ||
                   e.currentTarget.closest('[data-id]')?.getAttribute('data-id');

        // Validar ID
        if (!id || id === 'null' || id === 'undefined' || id === '') {
          console.error('[Tipos] ID inválido:', id, 'Elemento:', e.currentTarget);
          showMessage(t('web.modulos.tiposViagem.erroIdIndisponivel'), 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadTipoParaEdicao(id);
        } else {
          confirmarExclusao(id);
        }
      });
    });
  }

  // Utilitário para carregar script com cache-bust
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

  // Inicializar GridEditor
  function inicializarGridTab() {
    const tiposGridContainer = document.getElementById('tiposGrid');
    if (!tiposGridContainer) return;

    if (typeof window.GridEditor === 'undefined') {
      console.error('[Tipos] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: tiposGridContainer,
      columns: [
        { field: 'CDTIPOVIAGEM', header: 'Código', editable: false, isId: true, width: '100px' },
        { field: 'DSTIPOVIAGEM', header: 'Descrição', editable: true, type: 'text', maxlength: 40 },
        { 
          field: 'FGACTIVE', 
          header: 'Status', 
          editable: true, 
          type: 'select', 
          options: [
            { value: 'S', label: 'Ativo' },
            { value: 'N', label: 'Inativo' }
          ], 
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo',
          width: '120px',
          align: 'right'
        }
      ],
      apiEndpoint: '/api/tipos-viagem',
      onEdit: async (id, updatedData) => {
        await fetch(`/api/tipos-viagem/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedData)
        });
      },
      // Garantir que a exclusão use o mesmo fluxo/modal da lista
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onBeforeEdit: async (id) => {
        await loadTipoParaEdicao(id);
        return false; // Não deixar modo edição no grid, usar formulário
      }
    });
  }

  async function loadTipoParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (tipoForm) {
        tipoForm.reset();
      }
      
      const response = await fetch(`/api/tipos-viagem`);
      const tipos = await response.json();
      const tipo = tipos.find(t => t.CDTIPOVIAGEM.toString() === id.toString());
      
      if (tipo) {
        document.getElementById('tipoCodigo').value = tipo.CDTIPOVIAGEM;
        document.getElementById('tipoDescricao').value = tipo.DSTIPOVIAGEM;
        document.getElementById('tipoSituacao').value = tipo.FGACTIVE;
        document.getElementById('formTitle').textContent = t('web.modulos.tiposViagem.editarTipo');
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar tipo:', err);
      showMessage(t('web.modulos.tiposViagem.erroCarregarDados'), 'error');
    }
  }

  async function confirmarExclusao(id) {
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      showMessage(t('web.modulos.tiposViagem.erroIdIndisponivel'), 'error');
      return;
    }
    
    const idStr = String(id).trim();
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');

    if (!modalEl || !confirmYes || !confirmNo) {
      return;
    }

    try {
      // Buscar o status atual do tipo
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/tipos-viagem/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar tipo');
      }
      
      const tipo = await response.json();
      const estaAtivo = tipo.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = t('web.modulos.tiposViagem.msgDesativar');
        action = 'deactivate';
        btnText = t('web.modulos.tiposViagem.desativar');
      } else {
        confirmMsg = t('web.modulos.tiposViagem.msgReativar');
        action = 'activate';
        btnText = t('web.modulos.tiposViagem.reativar');
      }
      
      if (modalMessage) modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idStr;
      modalEl.dataset.action = action;
      
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      // Atualizar texto do botão de confirmação
      newConfirmYes.textContent = btnText;
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        try {
          const deleteId = modalEl.dataset.deleteId || idStr;
          const acao = modalEl.dataset.action || action;
          
          if (!deleteId || deleteId === 'undefined' || deleteId === 'null' || deleteId === '') {
            showMessage(t('web.modulos.tiposViagem.erroIdIndisponivel'), 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const idToDelete = isNaN(deleteId) ? deleteId : parseInt(deleteId, 10);
          const response = await fetch(`/api/tipos-viagem/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? t('web.modulos.tiposViagem.sucessoReativar') : t('web.modulos.tiposViagem.sucessoDesativar')), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.tiposViagem.erroAlterarStatus'), 'error');
          }
        } catch (err) {
          console.error('[Tipos] Erro ao alterar status:', err);
          showMessage(t('web.modulos.tiposViagem.erroConexao'), 'error');
        } finally {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteId;
          delete modalEl.dataset.action;
        }
      };
    
      newConfirmNo.onclick = () => {
        modalEl.style.display = 'none';
        delete modalEl.dataset.deleteId;
        delete modalEl.dataset.action;
      };
      
      modalEl.style.display = 'block';
    } catch (err) {
      console.error('[Tipos] Erro ao buscar status do tipo:', err);
      showMessage(t('web.modulos.tiposViagem.erroVerificarStatus'), 'error');
    }
  }

  let tipoViagemFormSubmitting = false;
  tipoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (tipoViagemFormSubmitting) return;
    tipoViagemFormSubmitting = true;
    const btnSubmit = tipoForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }

    const id = document.getElementById('tipoCodigo')?.value;
    const descricao = document.getElementById('tipoDescricao')?.value.trim();
    const situacao = document.getElementById('tipoSituacao')?.value;

    if (!descricao || !situacao) {
      showMessage(t('web.modulos.tiposViagem.preenchaCampos'), 'error');
      tipoViagemFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const tipoData = { DSTIPOVIAGEM: descricao };
      let response;
      
      if (id) {
        tipoData.FGACTIVE = situacao;
        response = await fetch(`/api/tipos-viagem/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tipoData)
        });
      } else {
        response = await fetch('/api/tipos-viagem', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tipoData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || t('web.modulos.tiposViagem.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.tiposViagem.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.tiposViagem.erroConexao'), 'error');
    } finally {
      // Cooldown para evitar duplo envio (Enter + clique ou duplo clique)
      setTimeout(() => {
        tipoViagemFormSubmitting = false;
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

  // Eventos de abas
  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
    });
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.getElementById('filtroCodigo').value = '';
    document.getElementById('filtroDescricao').value = '';
    document.getElementById('filtroSituacao').value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', () => showTab('filtros'));
  document.getElementById('btnVoltarFiltorosGrid')?.addEventListener('click', () => showTab('filtros'));
  
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    tipoForm?.reset();
    document.getElementById('formTitle').textContent = t('web.modulos.tiposViagem.novoTipo');
    showTab('dados');
  });
  
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    tipoForm?.reset();
    document.getElementById('formTitle').textContent = t('web.modulos.tiposViagem.novoTipo');
    showTab('dados');
  });
  
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

  // Usar showMessage do utils.js se disponível, senão usar função local
  // Nota: utils.js é carregado globalmente no dashboard.html
  const showMessage = (text, type, messageElement = null, fieldId = null) => {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, messageElement || message, fieldId);
    } else if (message) {
      message.textContent = text;
      message.className = `message ${type} show`;
      setTimeout(() => message.className = 'message', 5000);
    }
  };

  // Função de ajuda
  window.mostrarAjudaTiposViagem = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaTiposViagem');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaTiposViagem';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Tipos de Viagem</h3>
          <button onclick="window.fecharModalAjudaTiposViagem()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Tipos de Viagem</strong> permite gerenciar os tipos de viagem cadastrados no sistema, definindo categorias para diferentes modalidades de transporte.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar tipos de viagem específicos por código, descrição ou situação (Ativo/Inativo).</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar tipos de viagem</li>
            <li><strong>Grid:</strong> Visualizar tipos de viagem em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar tipos de viagem</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar um novo tipo de viagem, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar um tipo de viagem existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Para desativar um tipo de viagem, edite-o e altere a situação para "Inativo" ou use o botão de exclusão</li>
            <li>Tipos de viagem inativos não aparecerão em seleções de novos cadastros</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaTiposViagem()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaTiposViagem = function() {
    const modal = document.getElementById('modalAjudaTiposViagem');
    if (modal) {
      modal.remove();
    }
  };
})();