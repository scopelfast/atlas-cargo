// backend/public/modulos/gerenciar-tipos-atividade/js/script.js
// Gerenciar Tipos de Atividade - Frontend
// Versão: 1.0
// Autor: Sistema DivulgaCarga

(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoAtividadeForm = document.getElementById('tipoAtividadeForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let gridTab = null;
  let lastTiposAtividade = null;
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
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    try {
      const response = await fetch('/modulos/gerenciar-tipos-atividade/sql/init.sql');
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
        execResponse = await fetch('/api/tipos-atividade/executar-init-sql', {
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
    await showTab('filtros');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Função para mudar abas
  async function showTab(tabId) {
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const tabContent = document.getElementById(`tab-${tabId}`);
    
    if (tabBtn) tabBtn.classList.add('active');
    if (tabContent) tabContent.classList.add('active');

    if (tabId === 'grid' && lastTiposAtividade) {
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastTiposAtividade);
        } catch (e) {}
      }
    }
  }

  // Função para exibir mensagens
  function showMessage(text, type = 'info') {
    if (!message) return;
    message.textContent = text;
    message.className = `message ${type}`;
    message.style.display = 'block';
    setTimeout(() => {
      message.style.display = 'none';
    }, 5000);
  }

  // Função para carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script (declarada como função nomeada para evitar problemas de hoisting)
      function carregarNovoScript() {
        const script = document.createElement('script');
        script.src = `${src}?t=${Date.now()}`; // Cache busting
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
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            // Se não carregou após 2 segundos, remover e recarregar
            existingScript.remove();
            carregarNovoScript();
          }
        }, 100);
        return;
      }
      
      // Carregar o script se não existe
      carregarNovoScript();
    });
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    try {
      const params = new URLSearchParams();
      const codigo = document.getElementById('filtroCodigo')?.value;
      const descricao = document.getElementById('filtroDescricao')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      
      if (codigo) params.append('codigo', codigo);
      if (descricao) params.append('descricao', descricao);
      if (situacao) params.append('situacao', situacao);

      const response = await fetch(`/api/tipos-atividade?${params.toString()}`);
      const tiposAtividade = await response.json();

      lastTiposAtividade = tiposAtividade;
      const countEl = document.getElementById('tiposAtividadeGridCountText');
      if (countEl) {
        countEl.textContent = `${tiposAtividade.length} registro(s) encontrado(s)`;
      }

      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(tiposAtividade);
        } catch (e) {}
      }

      // Carregar GridEditor se necessário
      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (loadErr) {}
      }

      // Inicializar e renderizar grid
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(tiposAtividade);
        } catch (e) {}
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao aplicar filtros.', 'error');
    }
  }

  // Inicializar grid
  function inicializarGridTab() {
    gridTab = new GridEditor({
      container: '#tiposAtividadeGrid',
      columns: [
        { field: 'CDTIPOATIVIDADE', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOATIVIDADE', header: 'Descrição', editable: false, width: '400px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '100px',
          options: [{ value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' }],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/tipos-atividade',
      onBeforeEdit: async (id) => {
        await loadTipoAtividadeParaEdicao(id);
        return false; // cancelar o modo de edição inline
      },
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onAfterEdit: (id) => {
        showMessage('Alteração salva com sucesso!', 'success');
      }
    });
  }

  // Carregar tipo de atividade para edição
  async function loadTipoAtividadeParaEdicao(codigo) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (tipoAtividadeForm) {
        tipoAtividadeForm.reset();
      }
      
      const response = await fetch(`/api/tipos-atividade/${codigo}`);
      const tipo = await response.json();

      document.getElementById('tipoAtividadeCodigoOriginal').value = tipo.CDTIPOATIVIDADE;
      document.getElementById('tipoAtividadeCodigo').value = tipo.CDTIPOATIVIDADE;
      document.getElementById('tipoAtividadeCodigo').readOnly = true;
      document.getElementById('tipoAtividadeDescricao').value = tipo.DSTIPOATIVIDADE || '';
      document.getElementById('tipoAtividadeSituacao').value = tipo.FGACTIVE || 'S';

      document.getElementById('formTitle').textContent = 'Editar Tipo de Atividade';
      showTab('dados');
    } catch (err) {
      showMessage('Erro ao carregar tipo de atividade.', 'error');
    }
  }

  // Salvar tipo de atividade
  async function salvarTipoAtividade(e) {
    e.preventDefault();
    const codigoOriginal = document.getElementById('tipoAtividadeCodigoOriginal').value;
    const codigo = document.getElementById('tipoAtividadeCodigo').value;
    const descricao = document.getElementById('tipoAtividadeDescricao').value.trim();
    const situacao = document.getElementById('tipoAtividadeSituacao').value;

    if (!codigo || !descricao) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    try {
      const url = codigoOriginal ? `/api/tipos-atividade/${codigoOriginal}` : '/api/tipos-atividade';
      const method = codigoOriginal ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          CDTIPOATIVIDADE: parseInt(codigo),
          DSTIPOATIVIDADE: descricao,
          FGACTIVE: situacao
        })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Tipo de atividade salvo com sucesso!', 'success');
        limparFormulario();
        showTab('filtros');
        if (lastTiposAtividade) {
          await applyFilters('grid');
        }
      } else {
        showMessage(result.error || 'Erro ao salvar tipo de atividade.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao salvar tipo de atividade.', 'error');
    }
  }

  // Limpar formulário
  function limparFormulario() {
    document.getElementById('tipoAtividadeCodigoOriginal').value = '';
    document.getElementById('tipoAtividadeCodigo').value = '';
    document.getElementById('tipoAtividadeCodigo').readOnly = false;
    document.getElementById('tipoAtividadeDescricao').value = '';
    document.getElementById('tipoAtividadeSituacao').value = 'S';
    document.getElementById('formTitle').textContent = 'Novo Tipo de Atividade';
  }

  // Confirmar exclusão
  async function confirmarExclusao(codigo) {
    const estaAtivo = lastTiposAtividade?.find(t => t.CDTIPOATIVIDADE === codigo)?.FGACTIVE === 'S';
    document.getElementById('modalMessage').textContent = 
      estaAtivo 
        ? `Tem certeza que deseja desativar o tipo de atividade "${codigo}"?` 
        : `Tem certeza que deseja excluir o tipo de atividade "${codigo}"?`;
    
    modal.style.display = 'flex';
    
    return new Promise((resolve) => {
      const handlerYes = async () => {
        modal.style.display = 'none';
        confirmYes.removeEventListener('click', handlerYes);
        confirmNo.removeEventListener('click', handlerNo);
        
        try {
          const response = await fetch(`/api/tipos-atividade/${codigo}`, {
            method: 'DELETE'
          });
          const result = await response.json();
          if (response.ok) {
            showMessage(result.message || 'Tipo de atividade excluído com sucesso!', 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || 'Erro ao excluir tipo de atividade.', 'error');
          }
        } catch (err) {
          showMessage('Erro ao excluir tipo de atividade.', 'error');
        }
        resolve();
      };
      
      const handlerNo = () => {
        modal.style.display = 'none';
        confirmYes.removeEventListener('click', handlerYes);
        confirmNo.removeEventListener('click', handlerNo);
        resolve();
      };
      
      confirmYes.addEventListener('click', handlerYes, { once: true });
      confirmNo.addEventListener('click', handlerNo, { once: true });
    });
  }

  // Expor funções globalmente para uso no grid
  window.editarTipoAtividade = loadTipoAtividadeParaEdicao;
  window.excluirTipoAtividade = confirmarExclusao;

  // Event Listeners
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabId = tab.dataset.tab;
      showTab(tabId);
    });
  });

  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    filtroForm.reset();
    lastTiposAtividade = null;
    document.getElementById('tiposAtividadeGridCountText').textContent = '0 registro(s) encontrado(s)';
    document.getElementById('tiposAtividadeGrid').innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
  });

  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    limparFormulario();
    showTab('dados');
  });

  document.getElementById('btnCancelar')?.addEventListener('click', () => {
    limparFormulario();
    showTab('filtros');
  });

  tipoAtividadeForm?.addEventListener('submit', salvarTipoAtividade);

  document.getElementById('confirmNo')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

})();

