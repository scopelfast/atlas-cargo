(function() {
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

  // Funções para controlar overlay de carregamento do init.sql
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

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    try {
      const response = await fetch('/modulos/gerenciar-modelos-equipamento/sql/init.sql');
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
        execResponse = await fetch('/api/modelos-equipamento/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          signal: AbortSignal.timeout(120000)
        });
      } catch (fetchError) {
        if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
          hideLoadingOverlayInitSQL();
          return;
        }
        if (fetchError.message.includes('ERR_CONNECTION_RESET') || fetchError.message.includes('Failed to fetch')) {
          hideLoadingOverlayInitSQL();
          return;
        }
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
      if (!result.success) {
        hideLoadingOverlayInitSQL();
        return;
      }
      if (result.resultados && Array.isArray(result.resultados)) {
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        if (comandosComErro.length > 0) {
          const errosReais = comandosComErro.filter(erro => {
            const mensagem = (erro.mensagem || erro.erro || '').toLowerCase();
            const errosEsperados = ['already exists', 'já existe', 'duplicate', 'duplicado', 'there is already', 'já há'];
            return !errosEsperados.some(esperado => mensagem.includes(esperado));
          });
          if (errosReais.length > 0) {
            errosReais.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              if (typeof mensagem === 'object') {
                console.error('Erro no init.sql:', JSON.stringify(mensagem));
              } else {
                console.error('Erro no init.sql:', mensagem);
              }
            });
          }
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      hideLoadingOverlayInitSQL();
    } catch (err) {
      hideLoadingOverlayInitSQL();
    }
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

      if (typeof window.GridEditor === 'undefined') {
        try { await loadScript('/js/grid-editor.js'); } catch (e) { }
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastModelos || []);
        } catch (e) {
          console.error('[Grid] erro ao renderizar grid na aba:', e);
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

      const tipos = await tiposResp.json();
      const marcas = await marcasResp.json();

      const fillSelect = (id, items, valueField, labelField) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = id.startsWith('filtro') ? 'Todos' : 'Selecione';
        el.appendChild(defaultOption);
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
      showMessage('Erro ao carregar opções. Verifique a conexão ou a resposta da API.', 'error');
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
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(modelos);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados (opção A)
      try {
        if (Array.isArray(modelos) && modelos.length > 0) {
          if (typeof window.GridEditor === 'undefined') {
            try {
              await loadScript('/js/grid-editor.js');
            } catch (loadErr) {
            }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(modelos);
            } catch (e) {
            }
          } else {
            // If the script element exists but GridEditor still undefined, try a cache-busted reload
            const scriptEl = document.querySelector('script[src="/js/grid-editor.js"]');
            if (scriptEl) {
              try {
                await new Promise((res, rej) => {
                  const s = document.createElement('script');
                  s.src = '/js/grid-editor.js?t=' + Date.now();
                  s.async = true;
                  s.onload = () => res();
                  s.onerror = (err) => rej(err);
                  document.head.appendChild(s);
                });
                if (typeof window.GridEditor !== 'undefined') {
                  if (!gridTab) inicializarGridTab();
                  try { gridTab.render(modelos); } catch (e) { }
                }
              } catch (rbErr) {
              }
            }
          }
        }
      } catch (autoErr) {
        console.error('[Grid] erro no fluxo de auto-init:', autoErr);
      }

      // Se o chamador pediu para abrir a aba grid, inicializar e renderizar lá
      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try { await loadScript('/js/grid-editor.js'); } catch (e) { }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          try { gridTab.render(modelos); } catch (err) { console.error('[Grid] erro ao renderizar grid:', err); }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar modelos.', 'error');
    }
  }

  function renderList(modelos) {
    if (!modelos || modelos.length === 0) {
      list.innerHTML = '<p class="empty">Nenhum modelo encontrado.</p>';
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
          showMessage('Erro: ID não disponível.', 'error');
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

  // Carrega um script dinamicamente e aguarda o carregamento
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        script.src = `${src}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
          setTimeout(() => {
            if (typeof GridEditor !== 'undefined') {
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
          if (typeof GridEditor !== 'undefined') {
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
    gridTab = new GridEditor({
      container: '#modelosGrid',
      columns: [
        { field: 'CDMODELOEQUIPAMENTO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSMODELOEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', width: '280px', maxlength: 40 },
        { field: 'TIPO_NOME', header: 'Tipo', editable: false, width: '200px' },
        { field: 'MARCA_NOME', header: 'Marca', editable: false, width: '200px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px',
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
        showMessage('Alteração salva com sucesso!', 'success');
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
        document.getElementById('formTitle').textContent = 'Editar Modelo de Equipamento';
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar modelo:', err);
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  async function confirmarExclusao(id) {
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      showMessage('Erro: ID não disponível.', 'error');
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
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> este modelo de equipamento?<br><br><small style="color: #666;">O modelo ficará inativo e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> este modelo de equipamento?<br><br><small style="color: #666;">O modelo voltará a aparecer nas listagens e estará disponível para uso.</small>';
        action = 'activate';
        btnText = 'Reativar';
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
            showMessage('Erro: ID não disponível.', 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const idToDelete = isNaN(deleteId) ? deleteId : parseInt(deleteId, 10);
          const response = await fetch(`/api/modelos-equipamento/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Modelo de equipamento reativado com sucesso!' : 'Modelo de equipamento desativado com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do modelo.', 'error');
          }
        } catch (err) {
          console.error('[Modelos] Erro ao alterar status:', err);
          showMessage('Erro de conexão.', 'error');
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
      showMessage('Erro ao verificar status do modelo.', 'error');
    }
  }

  modeloForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('modeloCodigo')?.value;
    const descricao = document.getElementById('modeloDescricao')?.value.trim();
    const situacao = document.getElementById('modeloSituacao')?.value;
    const tipo = document.getElementById('modeloTipo')?.value;
    const marca = document.getElementById('modeloMarca')?.value;

    if (!descricao || !situacao || !tipo || !marca) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
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
        showMessage(data.message || 'Salvo com sucesso!', 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage('Erro de conexão com o servidor.', 'error');
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
    document.getElementById('formTitle').textContent = 'Novo Modelo de Equipamento';
    showTab('dados');
  });

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    modeloForm?.reset();
    document.getElementById('modeloCodigo').value = '';
    document.getElementById('formTitle').textContent = 'Novo Modelo de Equipamento';
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
})();
