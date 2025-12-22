// backend/public/modulos/gerenciar-grupos/js/script.js
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const grupoForm = document.getElementById('grupoForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastGrupos = null; // cache dos últimos resultados do filtro
  let sqlExecutado = false;
  let initExecutado = false;

  // Funções para controlar overlay de carregamento do init.sql
  function showLoadingOverlayInitSQL(titulo = 'Processando Inicialização', texto = 'Executando scripts de inicialização...', detalhe = 'Isso pode levar alguns segundos.') {
    // Usar função global se disponível, senão usar local
    if (typeof window.showLoadingOverlayInitSQL === 'function') {
      window.showLoadingOverlayInitSQL(titulo, texto, detalhe);
      return;
    }
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
    // Usar função global se disponível, senão usar local
    if (typeof window.hideLoadingOverlayInitSQL === 'function') {
      window.hideLoadingOverlayInitSQL();
      return;
    }
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
      console.log('[Grupos] Usando executarInitSQLPadrao do helper');
      await window.executarInitSQLPadrao(
        '/modulos/gerenciar-grupos/sql/init.sql',
        '/api/grupos/executar-init-sql',
        'grupos'
      );
      sqlExecutado = true;
      return;
    }
    
    console.log('[Grupos] Usando implementação local do init.sql');
    // Fallback: implementação local (compatibilidade)
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      const response = await fetch('/modulos/gerenciar-grupos/sql/init.sql');
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
        execResponse = await fetch('/api/grupos/executar-init-sql', {
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
    if (initExecutado) return;
    initExecutado = true;
    await new Promise(resolve => setTimeout(resolve, 200));
    try {
      console.log('[Grupos] Iniciando execução do init.sql...');
      await executarInitSQL();
      console.log('[Grupos] Execução do init.sql concluída.');
    } catch (err) {
      console.error('[Grupos] Erro ao executar init.sql:', err);
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
      if (!lastGrupos) {
        await applyFilters('grid');
        return;
      }

      // Carregar GridEditor se necessário
      if (typeof window.GridEditor === 'undefined') {
        try { 
          await loadScript('/js/grid-editor.js'); 
        } catch (e) {
          console.error('[Grupos] Erro ao carregar GridEditor:', e);
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
            gridTab.render(lastGrupos || []);
          } catch (e) {
            console.error('[Grid] erro ao renderizar grid na aba:', e);
          }
        }
      } else {
        console.error('[Grupos] GridEditor não está disponível após aguardar');
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
      const response = await fetch(`/api/grupos?${params.toString()}`);
      const grupos = await response.json();

      // salvar cache de resultados
      lastGrupos = grupos;

      // Atualizar contador
      const countEl = document.getElementById('gruposGridCountText');
      if (countEl) {
        const count = grupos.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(grupos);
        } catch (e) {
          console.error('[Grupos] Erro ao renderizar grid:', e);
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(grupos) && grupos.length > 0) {
          // Carregar GridEditor se necessário
          if (typeof window.GridEditor === 'undefined') {
            try { 
              await loadScript('/js/grid-editor.js'); 
            } catch (loadErr) {
              console.error('[Grupos] Erro ao carregar GridEditor:', loadErr);
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
                gridTab.render(grupos);
              } catch (e) {
                console.error('[Grupos] Erro ao renderizar grid:', e);
              }
            }
          } else {
            console.error('[Grupos] GridEditor não está disponível após aguardar');
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
            console.error('[Grupos] Erro ao carregar GridEditor:', e);
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
              gridTab.render(grupos); 
            } catch (err) { 
              console.error('[Grid] erro ao renderizar grid:', err); 
            }
          }
        } else {
          console.error('[Grupos] GridEditor não está disponível após aguardar');
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar grupos de equipamento.', 'error');
    }
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
        script.src = `${src}?t=${Date.now()}`; // Cache busting
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
      console.error('[Grupos] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#gruposGrid',
      columns: [
        { field: 'CDGRUPOEQUIPAMENTO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSGRUPOEQUIPAMENTO', header: 'Descrição', editable: true, type: 'text', width: '360px', maxlength: 40 },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/grupos',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadGrupoParaEdicao(id);
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
        if (lastGrupos) {
          const idx = lastGrupos.findIndex(r => String(r.CDGRUPOEQUIPAMENTO) === String(id));
          if (idx !== -1) lastGrupos[idx] = { ...lastGrupos[idx], ...{} };
        }
      }
    });
  }

  async function loadGrupoParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (grupoForm) {
        grupoForm.reset();
      }
      
      const response = await fetch(`/api/grupos`);
      const grupos = await response.json();
      const grupo = grupos.find(g => g.CDGRUPOEQUIPAMENTO.toString() === id.toString());
      
      if (grupo) {
        document.getElementById('grupoCodigo').value = grupo.CDGRUPOEQUIPAMENTO;
        document.getElementById('grupoDescricao').value = grupo.DSGRUPOEQUIPAMENTO;
        document.getElementById('grupoSituacao').value = grupo.FGACTIVE;
        document.getElementById('formTitle').textContent = 'Editar Grupo de Equipamento';
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar grupo de equipamento:', err);
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
      // Buscar o status atual do grupo
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/grupos/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar grupo');
      }
      
      const grupo = await response.json();
      const estaAtivo = grupo.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> este grupo de equipamento?<br><br><small style="color: #666;">O grupo ficará inativo e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> este grupo de equipamento?<br><br><small style="color: #666;">O grupo voltará a aparecer nas listagens e estará disponível para uso.</small>';
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
          const response = await fetch(`/api/grupos/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Grupo de equipamento reativado com sucesso!' : 'Grupo de equipamento desativado com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do grupo.', 'error');
          }
        } catch (err) {
          console.error('[Grupos] Erro ao alterar status:', err);
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
      console.error('[Grupos] Erro ao buscar status do grupo:', err);
      showMessage('Erro ao verificar status do grupo.', 'error');
    }
  }

  grupoForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('grupoCodigo')?.value;
    const descricao = document.getElementById('grupoDescricao')?.value.trim();
    const situacao = document.getElementById('grupoSituacao')?.value;
    
    if (!descricao || !situacao) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    try {
      const grupoData = { DSGRUPOEQUIPAMENTO: descricao };
      let response;
      
      if (id) {
        grupoData.FGACTIVE = situacao;
        response = await fetch(`/api/grupos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(grupoData)
        });
      } else {
        response = await fetch('/api/grupos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(grupoData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message, 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error, 'error');
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
    grupoForm?.reset();
    document.getElementById('formTitle').textContent = 'Novo Grupo de Equipamento';
    showTab('dados');
  });

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    grupoForm?.reset();
    document.getElementById('formTitle').textContent = 'Novo Grupo de Equipamento';
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
  window.mostrarAjudaGruposEquipamento = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaGruposEquipamento');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaGruposEquipamento';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Grupos de Equipamento</h3>
          <button onclick="window.fecharModalAjudaGruposEquipamento()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Grupos de Equipamento</strong> permite gerenciar os grupos de equipamentos cadastrados no sistema, organizando-os de forma hierárquica.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar grupos específicos por código, descrição ou situação.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar grupos de equipamentos</li>
            <li><strong>Grid:</strong> Visualizar grupos em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar grupos de equipamentos</li>
          </ul>
          
          <h4>📋 Campos do Formulário</h4>
          <ul>
            <li><strong>Descrição:</strong> Nome do grupo de equipamento (obrigatório)</li>
            <li><strong>Situação:</strong> Ativo ou Inativo (obrigatório)</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar um novo grupo, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar um grupo existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Para desativar um grupo, edite-o e altere a situação para "Inativo" ou use o botão de exclusão</li>
            <li>Grupos inativos não aparecerão em seleções de novos cadastros</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaGruposEquipamento()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaGruposEquipamento = function() {
    const modal = document.getElementById('modalAjudaGruposEquipamento');
    if (modal) {
      modal.remove();
    }
  };
})();
