// backend/public/modulos/gerenciar-tipos-atividade/js/script.js
// Gerenciar Tipos de Atividade - Frontend
// Versão: 1.0
// Atlas Cargo

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const tipoAtividadeForm = document.getElementById('tipoAtividadeForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');
  
  let gridTab = null;
  let lastTiposAtividade = null;
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
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-atividade/sql/init.sql', '/api/tipos-atividade/executar-init-sql', 'tipos-atividade');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-tipos-atividade/sql/init.sql', '/api/tipos-atividade/executar-init-sql', 'tipos-atividade');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Tipos Atividade] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
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

  // Função para mudar abas (escopo no container do módulo para não misturar Grid/Dados)
  async function showTab(tabId) {
    const targetContent = document.getElementById(`tab-${tabId}`);
    const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (targetContent && targetBtn) {
      const container = targetContent.closest('[class*="-container"]') || targetContent.parentElement;
      if (container) {
        container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      }
      targetBtn.classList.add('active');
      targetContent.classList.add('active');
    }

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
  function showMessage(text, type = 'info', messageElement = null, fieldId = null) {
    if (typeof window.showMessage !== 'undefined') {
      window.showMessage(text, type, messageElement || message, fieldId);
    } else if (message) {
      message.textContent = text;
      message.className = `message ${type} show`;
      message.style.display = 'block';
      setTimeout(() => {
        message.className = 'message';
        message.style.display = 'none';
      }, 5000);
    }
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
      const body = await response.json();

      if (!response.ok) {
        const msg = (body && body.error) ? body.error : 'Erro ao carregar tipos de atividade.';
        showMessage(msg, 'error');
        lastTiposAtividade = [];
      } else {
        lastTiposAtividade = Array.isArray(body) ? body : [];
      }

      const tiposAtividade = lastTiposAtividade;
      const countEl = document.getElementById('tiposAtividadeGridCountText');
      if (countEl) {
        const msg = t('web.modulos.tiposAtividade.registrosEncontrados');
        countEl.textContent = tiposAtividade.length + ' ' + (msg.replace(/^0\s*/, ''));
      }

      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (loadErr) {}
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(tiposAtividade);
        } catch (e) {}
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.tiposAtividade.erroAplicarFiltros'), 'error');
      lastTiposAtividade = [];
      const countEl = document.getElementById('tiposAtividadeGridCountText');
      if (countEl) countEl.textContent = t('web.modulos.tiposAtividade.registrosEncontrados');
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try { gridTab.render([]); } catch (e) {}
      }
      showTab(openTab);
    }
  }

  // Inicializar grid
  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Tipos Atividade] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#tiposAtividadeGrid',
      columns: [
        { field: 'CDTIPOATIVIDADE', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSTIPOATIVIDADE', header: 'Descrição', editable: false },
        { field: 'DSPROGRAMA', header: 'Programa', editable: false,
          format: (val) => val || '-'
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
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
        showMessage(t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
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

      showTab('dados');
      document.getElementById('tipoAtividadeCodigoOriginal').value = tipo.CDTIPOATIVIDADE;
      document.getElementById('tipoAtividadeCodigo').value = tipo.CDTIPOATIVIDADE;
      document.getElementById('tipoAtividadeCodigo').readOnly = true;
      document.getElementById('tipoAtividadeDescricao').value = tipo.DSTIPOATIVIDADE || '';
      document.getElementById('tipoAtividadePrograma').value = tipo.DSPROGRAMA || '';
      document.getElementById('tipoAtividadeGrupo').value = tipo.FGGRUPO || '';
      document.getElementById('tipoAtividadeSituacao').value = tipo.FGACTIVE || 'S';
      document.getElementById('formTitle').textContent = t('web.modulos.tiposAtividade.editarTipo');
    } catch (err) {
      showMessage(t('web.modulos.tiposAtividade.erroCarregarDados'), 'error');
    }
  }

  let tipoAtividadeFormSubmitting = false;
  async function salvarTipoAtividade(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (tipoAtividadeFormSubmitting) return;
    tipoAtividadeFormSubmitting = true;
    const btnSubmit = tipoAtividadeForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }
    const codigoOriginal = document.getElementById('tipoAtividadeCodigoOriginal').value;
    const codigo = document.getElementById('tipoAtividadeCodigo').value;
    const descricao = document.getElementById('tipoAtividadeDescricao').value.trim();
    const programa = document.getElementById('tipoAtividadePrograma').value.trim();
    const grupo = document.getElementById('tipoAtividadeGrupo').value.trim();
    const situacao = document.getElementById('tipoAtividadeSituacao').value;

    if (!codigo || !descricao) {
      showMessage(t('web.modulos.tiposAtividade.preenchaCampos'), 'error');
      tipoAtividadeFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const url = codigoOriginal ? `/api/tipos-atividade/${codigoOriginal}` : '/api/tipos-atividade';
      const method = codigoOriginal ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          CDTIPOATIVIDADE: parseInt(codigo),
          DSTIPOATIVIDADE: descricao,
          DSPROGRAMA: programa || null,
          FGGRUPO: grupo || null,
          FGACTIVE: situacao
        })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
        showTab('grid');
        await applyFilters('grid');
      } else {
        showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
      }
    } catch (err) {
      showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
    } finally {
      setTimeout(() => {
        tipoAtividadeFormSubmitting = false;
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      }, 600);
    }
  }

  // Limpar formulário
  function limparFormulario() {
    document.getElementById('tipoAtividadeCodigoOriginal').value = '';
    document.getElementById('tipoAtividadeCodigo').value = '';
    document.getElementById('tipoAtividadeCodigo').readOnly = false;
    document.getElementById('tipoAtividadeDescricao').value = '';
    document.getElementById('tipoAtividadePrograma').value = '';
    document.getElementById('tipoAtividadeGrupo').value = '';
    document.getElementById('tipoAtividadeSituacao').value = 'S';
    document.getElementById('formTitle').textContent = t('web.modulos.tiposAtividade.novoTipo');
  }

  // Confirmar exclusão
  async function confirmarExclusao(codigo) {
    const estaAtivo = lastTiposAtividade?.find(t => t.CDTIPOATIVIDADE === codigo)?.FGACTIVE === 'S';
    const msg = estaAtivo
      ? `Tem certeza que deseja desativar o tipo de atividade "${codigo}"?`
      : `Tem certeza que deseja excluir o tipo de atividade "${codigo}"?`;
    
    const modalMsgEl = document.getElementById('modalMessage');
    if (modalMsgEl) modalMsgEl.textContent = msg;
    
    if (!modal || !confirmYes || !confirmNo) {
      if (window.confirm(msg)) {
        try {
          const response = await fetch(`/api/tipos-atividade/${codigo}`, { method: 'DELETE', headers: getAuthHeaders() });
          const result = await response.json();
          if (response.ok) {
            showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
          }
        } catch (err) {
          showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
        }
      }
      return;
    }
    const btnText = estaAtivo ? 'Desativar' : 'Excluir';
    const newYes = confirmYes.cloneNode(true);
    const newNo = confirmNo.cloneNode(true);
    newYes.className = 'btn-filtro btn-filtro-danger';
    newYes.innerHTML = '<i class="bx bx-check"></i> ' + btnText;
    newNo.className = 'btn-filtro btn-filtro-limpar';
    newNo.innerHTML = '<i class="bx bx-x"></i> ' + (t('web.modulos.tiposAtividade.cancelar') || 'Cancelar');
    if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newYes, confirmYes);
    if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newNo, confirmNo);

    modal.style.display = 'block';
    return new Promise((resolve) => {
      const handlerYes = async () => {
        modal.style.display = 'none';
        try {
          const response = await fetch(`/api/tipos-atividade/${codigo}`, { method: 'DELETE', headers: getAuthHeaders() });
          const result = await response.json();
          if (response.ok) {
            showMessage(result.message || t('web.modulos.tiposAtividade.sucessoSalvar'), 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || t('web.modulos.tiposAtividade.erroSalvar'), 'error');
          }
        } catch (err) {
          showMessage(t('web.modulos.tiposAtividade.erroSalvar'), 'error');
        }
        resolve();
      };
      const handlerNo = () => { modal.style.display = 'none'; resolve(); };
      newYes.addEventListener('click', handlerYes, { once: true });
      newNo.addEventListener('click', handlerNo, { once: true });
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
    document.getElementById('tiposAtividadeGridCountText').textContent = t('web.modulos.tiposAtividade.registrosEncontrados');
    document.getElementById('tiposAtividadeGrid').innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
  });

  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    limparFormulario();
    showTab('dados');
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

