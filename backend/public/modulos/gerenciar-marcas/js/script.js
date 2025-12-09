// backend/public/modulos/gerenciar-marcas/js/script.js
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const marcaForm = document.getElementById('marcaForm');
  const list = document.getElementById('marcasList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastMarcas = null; // cache dos últimos resultados do filtro
  let sqlExecutado = false;
  let initExecutado = false;

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
  // Usa a função padrão do helper se disponível, senão usa implementação local
  async function executarInitSQL() {
    // Proteção: Se já foi executado, não executar novamente
    if (sqlExecutado) {
      return;
    }
    
    // Se a função padrão estiver disponível, usar ela
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao(
        '/modulos/gerenciar-marcas/sql/init.sql',
        '/api/marcas/executar-init-sql',
        'marcas'
      );
      sqlExecutado = true;
      return;
    }
    
    // Fallback: implementação local (compatibilidade)
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      const response = await fetch('/modulos/gerenciar-marcas/sql/init.sql');
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
      const sqlLimpo = sqlSemComentarios
        .split('\n')
        .filter(linha => {
          const linhaTrim = linha.trim();
          return linhaTrim.length > 0 && !linhaTrim.startsWith('--');
        })
        .join('\n')
        .trim();
      
      if (!sqlLimpo || sqlLimpo.length === 0) {
        hideLoadingOverlayInitSQL();
        return;
      }
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      let execResponse;
      try {
        execResponse = await fetch('/api/marcas/executar-init-sql', {
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
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    document.querySelector(`.tab-btn[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
    if (tabId === 'grid') {
      // Se não temos dados, forçar uma busca
      if (!lastMarcas) {
        await applyFilters('grid');
        return;
      }

      if (typeof window.GridEditor === 'undefined') {
        try { await loadScript('/js/grid-editor.js'); } catch (e) { }
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastMarcas || []);
        } catch (e) {
          console.error('[Grid] erro ao renderizar grid na aba:', e);
        }
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
      const response = await fetch(`/api/marcas?${params.toString()}`);
      const marcas = await response.json();

      // salvar cache de resultados
      lastMarcas = marcas;

      // Atualizar contador
      const countEl = document.getElementById('marcasGridCountText');
      if (countEl) {
        const count = marcas.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(marcas);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados (opção A)
      try {
        if (Array.isArray(marcas) && marcas.length > 0) {
          if (typeof window.GridEditor === 'undefined') {
            try {
              await loadScript('/js/grid-editor.js');
            } catch (loadErr) {
            }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(marcas);
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
                  try { gridTab.render(marcas); } catch (e) { }
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
          try { gridTab.render(marcas); } catch (err) { console.error('[Grid] erro ao renderizar grid:', err); }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar marcas.', 'error');
    }
  }

  // Renderizar lista
  function renderList(marcas) {
    if (!marcas || marcas.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma marca de equipamento encontrada.</p>';
      return;
    }

    list.innerHTML = marcas.map(m => `
      <div class="list-item ${m.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${m.CDMARCAEQUIPAMENTO}">
        <div>
          <strong>${m.CDMARCAEQUIPAMENTO} - ${m.DSMARCAEQUIPAMENTO}</strong>
          <small>
            <strong>Status:</strong> ${m.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${m.CDMARCAEQUIPAMENTO}">Editar</button>
          <button class="btn delete" data-id="${m.CDMARCAEQUIPAMENTO}">Excluir</button>
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
          console.error('[Marcas] ID inválido:', id, 'Elemento:', e.currentTarget);
          showMessage('Erro: ID não disponível.', 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadMarcaParaEdicao(id);
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
      container: '#marcasGrid',
      columns: [
        { field: 'CDMARCAEQUIPAMENTO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSMARCAEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', width: '360px', maxlength: 40 },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/marcas',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadMarcaParaEdicao(id);
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
        if (lastMarcas) {
          const idx = lastMarcas.findIndex(r => String(r.CDMARCAEQUIPAMENTO) === String(id));
          if (idx !== -1) lastMarcas[idx] = { ...lastMarcas[idx], ...{} };
        }
      }
    });
  }

  // Carregar marca para edição
  async function loadMarcaParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (marcaForm) {
        marcaForm.reset();
      }
      
      const response = await fetch(`/api/marcas`);
      const marcas = await response.json();
      const marca = marcas.find(m => m.CDMARCAEQUIPAMENTO.toString() === id.toString());
      
      if (marca) {
        document.getElementById('marcaCodigo').value = marca.CDMARCAEQUIPAMENTO;
        document.getElementById('marcaDescricao').value = marca.DSMARCAEQUIPAMENTO;
        document.getElementById('marcaSituacao').value = marca.FGACTIVE;
        document.getElementById('formTitle').textContent = 'Editar Marca de Equipamento';
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar marca:', err);
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  // Confirmar exclusão
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
      // Buscar o status atual da marca
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/marcas/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar marca');
      }
      
      const marca = await response.json();
      const estaAtivo = marca.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> esta marca?<br><br><small style="color: #666;">A marca ficará inativa e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> esta marca?<br><br><small style="color: #666;">A marca voltará a aparecer nas listagens e estará disponível para uso.</small>';
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
          const response = await fetch(`/api/marcas/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Marca reativada com sucesso!' : 'Marca desativada com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da marca.', 'error');
          }
        } catch (err) {
          console.error('[Marcas] Erro ao alterar status:', err);
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
      console.error('[Marcas] Erro ao buscar status da marca:', err);
      showMessage('Erro ao verificar status da marca.', 'error');
    }
  }

  // Salvar formulário
  marcaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('marcaCodigo')?.value;
    const descricao = document.getElementById('marcaDescricao')?.value.trim();
    const situacao = document.getElementById('marcaSituacao')?.value;
    
    if (!descricao || !situacao) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    try {
      const marcaData = {
        DSMARCAEQUIPAMENTO: descricao
      };

      let response;
      if (id) {
        marcaData.FGACTIVE = situacao;
        response = await fetch(`/api/marcas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(marcaData)
        });
      } else {
        response = await fetch('/api/marcas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(marcaData)
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
      console.error('Erro ao salvar marca:', err);
      showMessage('Erro de conexão com o servidor.', 'error');
    }
  });

  // Eventos de formulário
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
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    marcaForm?.reset();
    document.getElementById('formTitle').textContent = 'Nova Marca de Equipamento';
    showTab('dados');
  });

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    marcaForm?.reset();
    document.getElementById('formTitle').textContent = 'Nova Marca de Equipamento';
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