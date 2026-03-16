// backend/public/modulos/gerenciar-tipos-equipamento/js/script.js
(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoForm = document.getElementById('tipoForm');
  const list = document.getElementById('tiposList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastTipos = null; // cache dos últimos resultados do filtro
  let sqlExecutado = false;
  let initExecutado = false;
  let tipoFormSubmitting = false; // evita duplo envio (dois registros no banco)

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-equipamento/sql/init.sql', '/api/tipos-equipamento/executar-init-sql', 'tipos-equipamento');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-equipamento/sql/init.sql', '/api/tipos-equipamento/executar-init-sql', 'tipos-equipamento');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Tipos Equipamento] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
  }
  
  // Função de inicialização
  async function init() {
    // Se já foi executado, não executar novamente
    if (initExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    initExecutado = true;
    
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) se existir
    // e AGUARDAR completamente antes de prosseguir
    try {
      await executarInitSQL();
    } catch (err) {
      // Erros silenciosos - não bloquear o módulo
    }
    
    // Garantir que a aba de filtros está ativa e visível
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
    const targetContent = document.getElementById(`tab-${tabId}`);
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!targetContent || !targetBtn) return;
    const container = targetContent.closest('[class*="-container"]') || targetContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    }
    targetBtn.classList.add('active');
    targetContent.classList.add('active');

    // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
    if (tabId === 'grid') {
      // Se não temos dados, forçar uma busca
      if (!lastTipos) {
        await applyFilters('grid');
        return;
      }

      // Carregar GridEditor se necessário
      if (typeof window.GridEditor === 'undefined') {
        try { 
          await loadScript('/js/grid-editor.js'); 
        } catch (e) {
          console.error('[Tipos Equipamento] Erro ao carregar GridEditor:', e);
        }
      }

      // Aguardar um pouco para garantir que GridEditor está disponível
      let tentativas = 0;
      while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        if (gridTab) {
          try {
            gridTab.render(lastTipos || []);
          } catch (e) {
            console.error('[Grid] erro ao renderizar grid na aba:', e);
          }
        }
      } else {
        console.error('[Tipos Equipamento] GridEditor não está disponível após aguardar');
      }
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value;
    const descricao = document.getElementById('filtroDescricao')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;
    
    if (codigo) params.append('codigo', codigo);
    if (descricao) params.append('descricao', descricao);
    if (situacao) params.append('situacao', situacao);
    
    try {
      const response = await fetch(`/api/tipos-equipamento?${params.toString()}`);
      const tipos = await response.json();

      // salvar cache de resultados
      lastTipos = tipos;

      // Atualizar contador
      const countEl = document.getElementById('tiposGridCountText');
      if (countEl) {
        const count = tipos.length || 0;
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(count));
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(tipos);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(tipos) && tipos.length > 0) {
          // Carregar GridEditor se necessário
          if (typeof window.GridEditor === 'undefined') {
            try { 
              await loadScript('/js/grid-editor.js'); 
            } catch (loadErr) {
              console.error('[Tipos Equipamento] Erro ao carregar GridEditor:', loadErr);
            }
          }

          // Aguardar GridEditor estar disponível
          let tentativas = 0;
          while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            tentativas++;
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            if (gridTab) {
              try {
                gridTab.render(tipos);
              } catch (e) {
                console.error('[Tipos Equipamento] Erro ao renderizar grid:', e);
              }
            }
          } else {
            console.error('[Tipos Equipamento] GridEditor não está disponível após aguardar');
          }
        }
      } catch (autoErr) {
        console.error('[Grid] erro no fluxo de auto-init:', autoErr);
      }

      // Se o chamador pediu para abrir a aba grid, inicializar e renderizar lá
      if (openTab === 'grid') {
        // Carregar GridEditor se necessário
        if (typeof window.GridEditor === 'undefined') {
          try { 
            await loadScript('/js/grid-editor.js'); 
          } catch (e) {
            console.error('[Tipos Equipamento] Erro ao carregar GridEditor:', e);
          }
        }

        // Aguardar GridEditor estar disponível
        let tentativas = 0;
        while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          tentativas++;
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          if (gridTab) {
            try { 
              gridTab.render(tipos); 
            } catch (err) { 
              console.error('[Grid] erro ao renderizar grid:', err); 
            }
          }
        } else {
          console.error('[Tipos Equipamento] GridEditor não está disponível após aguardar');
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.tiposEquipamento.erroCarregarTipos'), 'error');
    }
  }

  // Renderizar lista
  function renderList(tipos) {
    if (!tipos || tipos.length === 0) {
      list.innerHTML = '<p class="empty">' + t('web.modulos.tiposEquipamento.nenhumEncontrado') + '</p>';
      return;
    }

    list.innerHTML = tipos.map(t => `
      <div class="list-item ${t.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${t.CDTIPOEQUIPAMENTO}">
        <div>
          <strong>${t.CDTIPOEQUIPAMENTO} - ${t.DSTIPOEQUIPAMENTO}</strong>
          <small>
            <strong>Máscara:</strong> ${t.MASCARAIDENTIF || 'Não informada'}<br>
            <strong>Tipo de Veículo:</strong> ${t.FGTIPOVEICULO_DESC || 'Não informado'}<br>
            <strong>Status:</strong> ${t.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${t.CDTIPOEQUIPAMENTO}">Editar</button>
          <button class="btn delete" data-id="${t.CDTIPOEQUIPAMENTO}">Excluir</button>
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
          showMessage(t('web.modulos.tiposEquipamento.erroIdIndisponivel'), 'error');
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

  // Carregar script dinamicamente (fallback caso não esteja no HTML)
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Verificar se o script já está sendo carregado ou já existe
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        // Se o script existe, aguardar ele carregar
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof window.GridEditor !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 30) {
            clearInterval(checkInterval);
            // Se não carregou após 3 segundos, tentar recarregar
            existingScript.remove();
            // Continuar com o carregamento abaixo
          } else {
            return; // Continuar aguardando
          }
        }, 100);
        
        // Se já existe, aguardar um pouco mais antes de tentar recarregar
        setTimeout(() => {
          if (typeof window.GridEditor === 'undefined') {
            clearInterval(checkInterval);
            existingScript.remove();
            // Continuar com carregamento novo
          }
        }, 2000);
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
              // Tentar mais uma vez após 200ms
              setTimeout(() => {
                if (typeof window.GridEditor !== 'undefined') {
                  resolve();
                } else {
                  reject(new Error('GridEditor não foi carregado'));
                }
              }, 200);
            }
          }, 100);
        };
        script.onerror = () => reject(new Error(`Erro ao carregar script: ${src}`));
        document.head.appendChild(script);
      };
      
      carregarNovoScript();
    });
  }

  // Inicializar GridEditor
  function inicializarGridTab() {
    // GridEditor já é carregado globalmente pelo HTML
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Tipos Equipamento] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#tiposGrid',
      columns: [
        { field: 'CDTIPOEQUIPAMENTO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', maxlength: 40 },
        { field: 'MASCARAIDENTIF', header: 'Máscara', editable: true, type: 'text', maxlength: 50 },
        { field: 'FGTIPOVEICULO_DESC', header: 'Tipo Veículo', editable: false },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '90px', align: 'right',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/tipos-equipamento',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadTipoParaEdicao(id);
        return false; // cancelar o modo de edição inline
      },
      // Garantir que a exclusão use o mesmo fluxo/modal da lista
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onAfterEdit: (id) => {
        showMessage(t('web.modulos.tiposEquipamento.sucessoSalvar'), 'success');
        // atualizar cache local mantendo sincronia
        if (lastTipos) {
          const idx = lastTipos.findIndex(r => String(r.CDTIPOEQUIPAMENTO) === String(id));
          if (idx !== -1) lastTipos[idx] = { ...lastTipos[idx], ...{} };
        }
      }
    });
  }

  // Carregar tipo para edição
  async function loadTipoParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (tipoForm) {
        tipoForm.reset();
      }
      
      const response = await fetch(`/api/tipos-equipamento`);
      const tipos = await response.json();
      const tipo = tipos.find(t => t.CDTIPOEQUIPAMENTO.toString() === id.toString());
      
      if (tipo) {
        document.getElementById('tipoCodigo').value = tipo.CDTIPOEQUIPAMENTO;
        document.getElementById('tipoDescricao').value = tipo.DSTIPOEQUIPAMENTO;
        document.getElementById('tipoSituacao').value = tipo.FGACTIVE;
        document.getElementById('tipoMascara').value = tipo.MASCARAIDENTIF === 'Não informada' ? '' : tipo.MASCARAIDENTIF;
        document.getElementById('tipoVeiculo').value = tipo.FGTIPOVEICULO === 'Não informado' ? '' : tipo.FGTIPOVEICULO;
        document.getElementById('formTitle').textContent = t('web.modulos.tiposEquipamento.editarTipo');
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar tipo:', err);
      showMessage(t('web.modulos.tiposEquipamento.erroCarregarDados'), 'error');
    }
  }

  // Confirmar exclusão
  async function confirmarExclusao(id) {
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      showMessage(t('web.modulos.tiposEquipamento.erroIdIndisponivel'), 'error');
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
      const response = await fetch(`/api/tipos-equipamento/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar tipo');
      }
      
      const tipo = await response.json();
      const estaAtivo = tipo.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = t('web.modulos.tiposEquipamento.msgDesativar');
        action = 'deactivate';
        btnText = t('web.modulos.tiposEquipamento.desativar');
      } else {
        confirmMsg = t('web.modulos.tiposEquipamento.msgReativar');
        action = 'activate';
        btnText = t('web.modulos.tiposEquipamento.reativar');
      }
      
      if (modalMessage) modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idStr;
      modalEl.dataset.action = action;
      
      confirmYes.className = 'btn-filtro btn-filtro-danger';
      confirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
      confirmNo.className = 'btn-filtro btn-filtro-limpar';
      confirmNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.tiposEquipamento.cancelar') || 'Cancelar');
      
      confirmYes.onclick = async () => {
        try {
          const deleteId = modalEl.dataset.deleteId || idStr;
          const acao = modalEl.dataset.action || action;
          
          if (!deleteId || deleteId === 'undefined' || deleteId === 'null' || deleteId === '') {
            showMessage(t('web.modulos.tiposEquipamento.erroIdIndisponivel'), 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const idToDelete = isNaN(deleteId) ? deleteId : parseInt(deleteId, 10);
          const response = await fetch(`/api/tipos-equipamento/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? t('web.modulos.tiposEquipamento.sucessoReativar') : t('web.modulos.tiposEquipamento.sucessoDesativar')), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.tiposEquipamento.erroAlterarStatus'), 'error');
          }
        } catch (err) {
          console.error('[Tipos] Erro ao alterar status:', err);
          showMessage(t('web.modulos.tiposEquipamento.erroConexao'), 'error');
        } finally {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteId;
          delete modalEl.dataset.action;
        }
      };
    
      confirmNo.onclick = () => {
        modalEl.style.display = 'none';
        delete modalEl.dataset.deleteId;
        delete modalEl.dataset.action;
      };
      
      modalEl.style.display = 'block';
    } catch (err) {
      console.error('[Tipos] Erro ao buscar status do tipo:', err);
      showMessage(t('web.modulos.tiposEquipamento.erroVerificarStatus'), 'error');
    }
  }

  // Salvar formulário (bloqueio de duplo envio no início para evitar cadastro duplicado)
  tipoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (tipoFormSubmitting) return;
    tipoFormSubmitting = true;
    const submitBtn = tipoForm?.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.originalText = submitBtn.innerHTML; submitBtn.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...'; }

    const id = document.getElementById('tipoCodigo')?.value;
    const descricao = document.getElementById('tipoDescricao')?.value.trim();
    const situacao = document.getElementById('tipoSituacao')?.value;
    const mascara = document.getElementById('tipoMascara')?.value;
    const veiculo = document.getElementById('tipoVeiculo')?.value;
    
    if (!descricao || !situacao) {
      showMessage(t('web.modulos.tiposEquipamento.preenchaCampos'), 'error');
      tipoFormSubmitting = false;
      if (submitBtn) { submitBtn.disabled = false; if (submitBtn.dataset.originalText) submitBtn.innerHTML = submitBtn.dataset.originalText; }
      return;
    }

    try {
      const tipoData = {
        DSTIPOEQUIPAMENTO: descricao,
        MASCARAIDENTIF: mascara || null,
        FGTIPOVEICULO: veiculo || null
      };

      let response;
      if (id) {
        tipoData.FGACTIVE = situacao;
        response = await fetch(`/api/tipos-equipamento/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tipoData)
        });
      } else {
        response = await fetch('/api/tipos-equipamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tipoData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || t('web.modulos.tiposEquipamento.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.tiposEquipamento.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.tiposEquipamento.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        tipoFormSubmitting = false;
        if (submitBtn) { submitBtn.disabled = false; if (submitBtn.dataset.originalText) submitBtn.innerHTML = submitBtn.dataset.originalText; }
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

  function irParaNovoTipo() {
    tipoForm?.reset();
    document.getElementById('tipoCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.tiposEquipamento.novoTipo');
    showTab('dados');
  }

  document.getElementById('btnNovoRegistro')?.addEventListener('click', irParaNovoTipo);

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', irParaNovoTipo);
  
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
  window.mostrarAjudaTiposEquipamento = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaTiposEquipamento');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaTiposEquipamento';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Tipos de Equipamento</h3>
          <button onclick="window.fecharModalAjudaTiposEquipamento()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Tipos de Equipamento</strong> permite gerenciar os tipos de equipamentos cadastrados no sistema, definindo descrição, máscara de identificação e tipo de veículo.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar tipos específicos por código, descrição ou situação (Ativo/Inativo).</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar tipos de equipamentos</li>
            <li><strong>Grid:</strong> Visualizar tipos em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar tipos de equipamentos</li>
          </ul>
          
          <h4>📋 Campos do Formulário</h4>
          <ul>
            <li><strong>Descrição:</strong> Nome do tipo de equipamento (obrigatório)</li>
            <li><strong>Máscara de Identificação:</strong> Padrão de identificação do equipamento (opcional)</li>
            <li><strong>Tipo de Veículo:</strong> Classificação do veículo conforme ANTT (obrigatório)</li>
            <li><strong>Situação:</strong> Ativo ou Inativo (obrigatório)</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar um novo tipo, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar um tipo existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Para desativar um tipo, edite-o e altere a situação para "Inativo" ou use o botão de exclusão</li>
            <li>Tipos inativos não aparecerão em seleções de novos cadastros</li>
            <li>A máscara de identificação ajuda a padronizar a identificação dos equipamentos</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaTiposEquipamento()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaTiposEquipamento = function() {
    const modal = document.getElementById('modalAjudaTiposEquipamento');
    if (modal) {
      modal.remove();
    }
  };
})();