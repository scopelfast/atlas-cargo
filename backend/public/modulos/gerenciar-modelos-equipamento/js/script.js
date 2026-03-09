(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const modeloForm = document.getElementById('modeloForm');
  const list = document.getElementById('modelosList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastModelos = null; // cache dos últimos resultados do filtro
  let sqlExecutado = false;
  let initExecutado = false;

  let combosCarregados = false;

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    
    // Usar função padrão global se disponível
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-modelos-equipamento/sql/init.sql', '/api/modelos-equipamento/executar-init-sql', 'modelos-equipamento');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-modelos-equipamento/sql/init.sql', '/api/modelos-equipamento/executar-init-sql', 'modelos-equipamento');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Modelos Equipamento] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
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
    showTab('filtros');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function showTab(tabId) {
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    if (tabId === 'filtros' || tabId === 'dados') {
      loadCombos();
    }

    // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
    if (tabId === 'grid') {
      // Se não temos dados, forçar uma busca
      if (!lastModelos) {
        await applyFilters('grid');
        return;
      }

      // Aguardar um pouco para garantir que GridEditor está disponível (caso ainda esteja carregando)
      let tentativas = 0;
      while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }

      if (typeof window.GridEditor === 'undefined') {
        console.error('[Modelos Equipamento] GridEditor não está disponível após aguardar');
        try { await loadScript('/js/grid-editor.js'); } catch (e) {
          console.error('[Modelos Equipamento] Erro ao carregar GridEditor:', e);
        }
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        if (gridTab) {
          try {
            gridTab.render(lastModelos || []);
          } catch (e) {
            console.error('[Grid] erro ao renderizar grid na aba:', e);
          }
        }
      }
    }
  }

  async function loadCombos() {
    if (combosCarregados) return;

    try {
      const [tiposResp, marcasResp] = await Promise.all([
        fetch('/api/tipos-combo'),
        fetch('/api/marcas-combo')
      ]);

      const tiposContentType = tiposResp.headers.get('content-type');
      const marcasContentType = marcasResp.headers.get('content-type');

      if (!tiposContentType.includes('application/json') || !marcasContentType.includes('application/json')) {
        throw new Error('Resposta não é JSON');
      }

      const tiposData = await tiposResp.json();
      const marcasData = await marcasResp.json();
      const tipos = Array.isArray(tiposData) ? tiposData : (tiposResp.ok ? [] : []);
      const marcas = Array.isArray(marcasData) ? marcasData : (marcasResp.ok ? [] : []);

      const fillSelect = (id, items, valueField, labelField) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = id.startsWith('filtro') ? 'Todos' : 'Selecione';
        el.appendChild(defaultOption);
        if (!Array.isArray(items)) return;
        items.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item[valueField];
          opt.textContent = item[labelField];
          el.appendChild(opt);
        });
      };

      fillSelect('filtroTipo', tipos, 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO');
      fillSelect('filtroMarca', marcas, 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO');
      fillSelect('modeloTipo', tipos, 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO');
      fillSelect('modeloMarca', marcas, 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO');

      combosCarregados = true;
    } catch (err) {
      console.error('Erro ao carregar combos:', err);
      showMessage(t('web.modulos.modelosEquipamento.erroCarregarOpcoes'), 'error');
    }
  }

  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value;
    const descricao = document.getElementById('filtroDescricao')?.value;
    const tipo = document.getElementById('filtroTipo')?.value;
    const marca = document.getElementById('filtroMarca')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;

    if (codigo) params.append('codigo', codigo);
    if (descricao) params.append('descricao', descricao);
    if (tipo) params.append('tipo', tipo);
    if (marca) params.append('marca', marca);
    if (situacao) params.append('situacao', situacao);

    try {
      const response = await fetch(`/api/modelos-equipamento?${params.toString()}`);
      const modelos = await response.json();

      // salvar cache de resultados
      lastModelos = modelos;

      // Atualizar contador
      const countEl = document.getElementById('modelosGridCountText');
      if (countEl) {
        const count = modelos.length || 0;
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(count));
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(modelos);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(modelos) && modelos.length > 0) {
          // Aguardar GridEditor estar disponível
          let tentativas = 0;
          while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
            await new Promise(resolve => setTimeout(resolve, 100));
            tentativas++;
          }

          if (typeof window.GridEditor === 'undefined') {
            console.error('[Modelos Equipamento] GridEditor não está disponível após aguardar');
            try { await loadScript('/js/grid-editor.js'); } catch (loadErr) {
              console.error('[Modelos Equipamento] Erro ao carregar GridEditor:', loadErr);
            }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            if (gridTab) {
              try {
                gridTab.render(modelos);
              } catch (e) {
                console.error('[Modelos Equipamento] Erro ao renderizar grid:', e);
              }
            }
          }
        }
      } catch (autoErr) {
        console.error('[Grid] erro no fluxo de auto-init:', autoErr);
      }

      // Se o chamador pediu para abrir a aba grid, inicializar e renderizar lá
      if (openTab === 'grid') {
        // Aguardar GridEditor estar disponível
        let tentativas = 0;
        while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
          await new Promise(resolve => setTimeout(resolve, 100));
          tentativas++;
        }

        if (typeof window.GridEditor === 'undefined') {
          console.error('[Modelos Equipamento] GridEditor não está disponível após aguardar');
          try { await loadScript('/js/grid-editor.js'); } catch (e) {
            console.error('[Modelos Equipamento] Erro ao carregar GridEditor:', e);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          if (gridTab) {
            try { 
              gridTab.render(modelos); 
            } catch (err) { 
              console.error('[Grid] erro ao renderizar grid:', err); 
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.modelosEquipamento.erroCarregarModelos'), 'error');
    }
  }

  function renderList(modelos) {
    if (!modelos || modelos.length === 0) {
      list.innerHTML = '<p class="empty">' + t('web.modulos.modelosEquipamento.nenhumEncontrado') + '</p>';
      return;
    }

    list.innerHTML = modelos.map(m => `
      <div class="list-item ${m.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${m.CDMODELOEQUIPAMENTO}">
        <div>
          <strong>${m.CDMODELOEQUIPAMENTO} - ${m.DSMODELOEQUIPAMENTO}</strong>
          <small>
            <strong>Tipo:</strong> ${m.TIPO_NOME}<br>
            <strong>Marca:</strong> ${m.MARCA_NOME}<br>
            <strong>Status:</strong> ${m.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${m.CDMODELOEQUIPAMENTO}">Editar</button>
          <button class="btn delete" data-id="${m.CDMODELOEQUIPAMENTO}">Excluir</button>
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
          console.error('[Modelos] ID inválido:', id, 'Elemento:', e.currentTarget);
          showMessage(t('web.modulos.modelosEquipamento.erroIdIndisponivel'), 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadModeloParaEdicao(id);
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
    // GridEditor já é carregado globalmente pelo HTML
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Modelos Equipamento] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#modelosGrid',
      columns: [
        { field: 'CDMODELOEQUIPAMENTO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSMODELOEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', maxlength: 40 },
        { field: 'TIPO_NOME', header: 'Tipo', editable: false },
        { field: 'MARCA_NOME', header: 'Marca', editable: false },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/modelos-equipamento',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadModeloParaEdicao(id);
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
        showMessage(t('web.modulos.modelosEquipamento.sucessoSalvar'), 'success');
        // atualizar cache local mantendo sincronia
        if (lastModelos) {
          const idx = lastModelos.findIndex(r => String(r.CDMODELOEQUIPAMENTO) === String(id));
          if (idx !== -1) lastModelos[idx] = { ...lastModelos[idx], ...{} };
        }
      }
    });
  }

  async function loadModeloParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (modeloForm) {
        modeloForm.reset();
      }
      
      const response = await fetch(`/api/modelos-equipamento`);
      const modelos = await response.json();
      const modelo = modelos.find(m => m.CDMODELOEQUIPAMENTO.toString() === id.toString());

      if (modelo) {
        document.getElementById('modeloCodigo').value = modelo.CDMODELOEQUIPAMENTO;
        document.getElementById('modeloDescricao').value = modelo.DSMODELOEQUIPAMENTO;
        document.getElementById('modeloSituacao').value = modelo.FGACTIVE;
        document.getElementById('modeloTipo').value = modelo.CDTIPOEQUIPAMENTO;
        document.getElementById('modeloMarca').value = modelo.CDMARCAEQUIPAMENTO;
        document.getElementById('formTitle').textContent = t('web.modulos.modelosEquipamento.editarModelo');
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar modelo:', err);
      showMessage(t('web.modulos.modelosEquipamento.erroCarregarDados'), 'error');
    }
  }

  async function confirmarExclusao(id) {
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      showMessage(t('web.modulos.modelosEquipamento.erroIdIndisponivel'), 'error');
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
      // Buscar o status atual do modelo
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/modelos-equipamento/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar modelo');
      }
      
      const modelo = await response.json();
      const estaAtivo = modelo.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = t('web.modulos.modelosEquipamento.msgDesativar');
        action = 'deactivate';
        btnText = t('web.modulos.modelosEquipamento.desativar');
      } else {
        confirmMsg = t('web.modulos.modelosEquipamento.msgReativar');
        action = 'activate';
        btnText = t('web.modulos.modelosEquipamento.reativar');
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
            showMessage(t('web.modulos.modelosEquipamento.erroIdIndisponivel'), 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const idToDelete = isNaN(deleteId) ? deleteId : parseInt(deleteId, 10);
          const response = await fetch(`/api/modelos-equipamento/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? t('web.modulos.modelosEquipamento.sucessoReativar') : t('web.modulos.modelosEquipamento.sucessoDesativar')), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.modelosEquipamento.erroAlterarStatus'), 'error');
          }
        } catch (err) {
          console.error('[Modelos] Erro ao alterar status:', err);
          showMessage(t('web.modulos.modelosEquipamento.erroConexao'), 'error');
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
      console.error('[Modelos] Erro ao buscar status do modelo:', err);
      showMessage(t('web.modulos.modelosEquipamento.erroVerificarStatus'), 'error');
    }
  }

  let modeloFormSubmitting = false;
  modeloForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (modeloFormSubmitting) return;
    modeloFormSubmitting = true;
    const btnSubmit = modeloForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }

    const id = document.getElementById('modeloCodigo')?.value;
    const descricao = document.getElementById('modeloDescricao')?.value.trim();
    const situacao = document.getElementById('modeloSituacao')?.value;
    const tipo = document.getElementById('modeloTipo')?.value;
    const marca = document.getElementById('modeloMarca')?.value;

    if (!descricao || !situacao || !tipo || !marca) {
      showMessage(t('web.modulos.modelosEquipamento.preenchaCampos'), 'error');
      modeloFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const modeloData = {
        DSMODELOEQUIPAMENTO: descricao,
        CDTIPOEQUIPAMENTO: tipo,
        CDMARCAEQUIPAMENTO: marca
      };

      let response;
      if (id) {
        modeloData.FGACTIVE = situacao;
        response = await fetch(`/api/modelos-equipamento/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modeloData)
        });
      } else {
        response = await fetch('/api/modelos-equipamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(modeloData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || t('web.modulos.modelosEquipamento.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.modelosEquipamento.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.modelosEquipamento.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        modeloFormSubmitting = false;
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
    document.getElementById('filtroTipo').value = '';
    document.getElementById('filtroMarca').value = '';
    document.getElementById('filtroSituacao').value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', () => showTab('filtros'));

  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    modeloForm?.reset();
    document.getElementById('modeloCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.modelosEquipamento.novoModelo');
    showTab('dados');
  });

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    modeloForm?.reset();
    document.getElementById('modeloCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.modelosEquipamento.novoModelo');
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
  window.mostrarAjudaModelosEquipamento = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaModelosEquipamento');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaModelosEquipamento';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Modelos de Equipamento</h3>
          <button onclick="window.fecharModalAjudaModelosEquipamento()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Modelos de Equipamento</strong> permite gerenciar os modelos de equipamentos cadastrados no sistema, associando-os a tipos e marcas específicas.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar modelos específicos por código, descrição, situação, tipo de equipamento ou marca.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar modelos de equipamentos</li>
            <li><strong>Grid:</strong> Visualizar modelos em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar modelos de equipamentos</li>
          </ul>
          
          <h4>📋 Campos do Formulário</h4>
          <ul>
            <li><strong>Descrição:</strong> Nome do modelo de equipamento (obrigatório)</li>
            <li><strong>Tipo de Equipamento:</strong> Tipo ao qual o modelo pertence (obrigatório)</li>
            <li><strong>Marca:</strong> Marca do equipamento (obrigatório)</li>
            <li><strong>Situação:</strong> Ativo ou Inativo (obrigatório)</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar um novo modelo, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar um modelo existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Para desativar um modelo, edite-o e altere a situação para "Inativo" ou use o botão de exclusão</li>
            <li>Modelos inativos não aparecerão em seleções de novos cadastros</li>
            <li>Certifique-se de que o tipo e a marca já estão cadastrados antes de criar um modelo</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaModelosEquipamento()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaModelosEquipamento = function() {
    const modal = document.getElementById('modalAjudaModelosEquipamento');
    if (modal) {
      modal.remove();
    }
  };
})();
