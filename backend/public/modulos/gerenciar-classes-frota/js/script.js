// backend/public/modulos/gerenciar-classes-frota/js/script.js
(function() {
  const t = function(k) { return typeof window.tWeb === 'function' ? window.tWeb(k) : k; };
  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const classeForm = document.getElementById('classeForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastClasses = null; // cache dos últimos resultados do filtro

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
      console.log('[Classes Frota] Usando executarInitSQLPadrao do helper');
      await window.executarInitSQLPadrao(
        '/modulos/gerenciar-classes-frota/sql/init.sql',
        '/api/classes-frota/executar-init-sql',
        'classes-frota'
      );
      sqlExecutado = true;
      return;
    }
    
    console.log('[Classes Frota] Usando implementação local do init.sql');
    // Fallback: implementação local (compatibilidade)
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      const response = await fetch('/modulos/gerenciar-classes-frota/sql/init.sql');
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
        execResponse = await fetch('/api/classes-frota/executar-init-sql', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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
      console.log('[Classes Frota] Iniciando execução do init.sql...');
      await executarInitSQL();
      console.log('[Classes Frota] Execução do init.sql concluída.');
    } catch (err) {
      console.error('[Classes Frota] Erro ao executar init.sql:', err);
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

  // Função para mudar abas (escopo no container do módulo para não misturar Grid/Dados)
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
      if (!lastClasses) {
        await applyFilters('grid');
        return;
      }

      // Carregar GridEditor se necessário
      if (typeof window.GridEditor === 'undefined') {
        try { 
          await loadScript('/js/grid-editor.js'); 
        } catch (e) {
          console.error('[Classes Frota] Erro ao carregar GridEditor:', e);
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
            gridTab.render(lastClasses || []);
          } catch (e) {
            console.error('[Grid] erro ao renderizar grid na aba:', e);
          }
        }
      } else {
        console.error('[Classes Frota] GridEditor não está disponível após aguardar');
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
      const response = await fetch(`/api/classes-frota?${params.toString()}`, { headers: getAuthHeaders() });
      const classes = await response.json();

      // salvar cache de resultados
      lastClasses = classes;

      // Atualizar contador
      const countEl = document.getElementById('classesGridCountText');
      if (countEl) {
        const count = classes.length || 0;
        countEl.textContent = (t('web.modulos.cidades.registrosEncontrados') || '{n} registro(s) encontrado(s)').replace('{n}', String(count));
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(classes);
        } catch (e) {
          console.error('[Classes Frota] Erro ao renderizar grid:', e);
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(classes) && classes.length > 0) {
          // Carregar GridEditor se necessário
          if (typeof window.GridEditor === 'undefined') {
            try { 
              await loadScript('/js/grid-editor.js'); 
            } catch (loadErr) {
              console.error('[Classes Frota] Erro ao carregar GridEditor:', loadErr);
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
                gridTab.render(classes);
              } catch (e) {
                console.error('[Classes Frota] Erro ao renderizar grid:', e);
              }
            }
          } else {
            console.error('[Classes Frota] GridEditor não está disponível após aguardar');
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
            console.error('[Classes Frota] Erro ao carregar GridEditor:', e);
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
              gridTab.render(classes); 
            } catch (err) { 
              console.error('[Grid] erro ao renderizar grid:', err); 
            }
          }
        } else {
          console.error('[Classes Frota] GridEditor não está disponível após aguardar');
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(t('web.modulos.classesFrota.erroCarregarClasses'), 'error');
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
      console.error('[Classes Frota] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#classesGrid',
      columns: [
        { field: 'CDCLASSEFROTA', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'DSCLASSEFROTA', header: 'Descrição', editable: true, type: 'text', maxlength: 40 },
        { field: 'NREIXOS', header: 'Eixos', editable: true, type: 'number' },
        { field: 'CAPACIDCARGA', header: 'Capacidade', editable: true, type: 'number' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '90px', align: 'right',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/classes-frota',
      buildFetchHeaders: () => getAuthHeaders(),
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadClasseParaEdicao(id);
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
        showMessage(t('web.modulos.classesFrota.sucessoSalvar'), 'success');
        // atualizar cache local mantendo sincronia
        if (lastClasses) {
          const idx = lastClasses.findIndex(r => String(r.CDCLASSEFROTA) === String(id));
          if (idx !== -1) lastClasses[idx] = { ...lastClasses[idx], ...{} };
        }
      }
    });
  }

  // Carregar classe para edição
  async function loadClasseParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (classeForm) {
        classeForm.reset();
      }
      
      const response = await fetch(`/api/classes-frota/${encodeURIComponent(id)}`, { headers: getAuthHeaders() });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        showMessage(errBody.error || t('web.modulos.classesFrota.erroCarregarDados'), 'error');
        return;
      }
      const classe = await response.json();
      
      if (classe) {
        document.getElementById('classeCodigo').value = classe.CDCLASSEFROTA;
        document.getElementById('classeDescricao').value = classe.DSCLASSEFROTA;
        document.getElementById('classeSituacao').value = classe.FGACTIVE;
        document.getElementById('classeEixos').value = classe.NREIXOS;
        document.getElementById('classeCapacidade').value = classe.CAPACIDCARGA || '';
        document.getElementById('formTitle').textContent = t('web.modulos.classesFrota.editarClasse');
        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar classe:', err);
      showMessage(t('web.modulos.classesFrota.erroCarregarDados'), 'error');
    }
  }

  // Confirmar exclusão
  async function confirmarExclusao(id) {
    if (!id || id === 'undefined' || id === 'null' || id === '' || String(id).trim() === '') {
      showMessage(t('web.modulos.classesFrota.erroIdIndisponivel'), 'error');
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
      // Buscar o status atual da classe
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/classes-frota/${idToCheck}`, { headers: getAuthHeaders() });
      if (!response.ok) {
        throw new Error('Erro ao buscar classe');
      }
      
      const classe = await response.json();
      const estaAtivo = classe.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = t('web.modulos.classesFrota.msgDesativar');
        action = 'deactivate';
        btnText = t('web.modulos.classesFrota.desativar');
      } else {
        confirmMsg = t('web.modulos.classesFrota.msgReativar');
        action = 'activate';
        btnText = t('web.modulos.classesFrota.reativar');
      }
      
      if (modalMessage) modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idStr;
      modalEl.dataset.action = action;
      
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      newConfirmYes.className = 'btn-filtro btn-filtro-danger';
      newConfirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
      newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
      newConfirmNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.classesFrota.cancelar') || 'Cancelar');
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        try {
          const deleteId = modalEl.dataset.deleteId || idStr;
          const acao = modalEl.dataset.action || action;
          
          if (!deleteId || deleteId === 'undefined' || deleteId === 'null' || deleteId === '') {
            showMessage(t('web.modulos.classesFrota.erroIdIndisponivel'), 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const idToDelete = isNaN(deleteId) ? deleteId : parseInt(deleteId, 10);
          const response = await fetch(`/api/classes-frota/${idToDelete}?action=${acao}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? t('web.modulos.classesFrota.sucessoReativar') : t('web.modulos.classesFrota.sucessoDesativar')), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || t('web.modulos.classesFrota.erroAlterarStatus'), 'error');
          }
        } catch (err) {
          console.error('[Classes] Erro ao alterar status:', err);
          showMessage(t('web.modulos.classesFrota.erroConexao'), 'error');
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
      console.error('[Classes] Erro ao buscar status da classe:', err);
      showMessage(t('web.modulos.classesFrota.erroVerificarStatus'), 'error');
    }
  }

  // Salvar formulário (bloqueio no início para evitar cadastro duplicado)
  let classeFormSubmitting = false;
  classeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (classeFormSubmitting) return;
    classeFormSubmitting = true;
    const btnSubmit = classeForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }

    const id = document.getElementById('classeCodigo')?.value;
    const descricao = document.getElementById('classeDescricao')?.value.trim();
    const situacao = document.getElementById('classeSituacao')?.value;
    const eixos = document.getElementById('classeEixos')?.value;
    const capacidade = document.getElementById('classeCapacidade')?.value;

    if (!descricao || !situacao || !eixos) {
      showMessage(t('web.modulos.classesFrota.preenchaCampos'), 'error');
      classeFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }
    if (eixos < 2 || eixos > 9) {
      showMessage(t('web.modulos.classesFrota.eixosEntre2e9'), 'error');
      classeFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const classeData = {
        DSCLASSEFROTA: descricao,
        NREIXOS: parseInt(eixos),
        CAPACIDCARGA: capacidade ? parseFloat(capacidade) : null
      };

      let response;
      if (id) {
        classeData.FGACTIVE = situacao;
        response = await fetch(`/api/classes-frota/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(classeData)
        });
      } else {
        response = await fetch('/api/classes-frota', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(classeData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || t('web.modulos.classesFrota.sucessoSalvar'), 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.error || t('web.modulos.classesFrota.erroSalvar'), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.classesFrota.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        classeFormSubmitting = false;
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

  function irParaNovaClasse() {
    classeForm?.reset();
    document.getElementById('classeCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.classesFrota.novaClasse');
    showTab('dados');
  }

  document.getElementById('btnNovoRegistro')?.addEventListener('click', irParaNovaClasse);

  // Grid tab buttons
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => {
    showTab('filtros');
  });

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', irParaNovaClasse);
  
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
  window.mostrarAjudaClassesFrota = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaClassesFrota');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaClassesFrota';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Classes de Frota</h3>
          <button onclick="window.fecharModalAjudaClassesFrota()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Classes de Frota</strong> permite gerenciar as classes de veículos da frota, definindo características como número de eixos e capacidade de carga.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar classes específicas por código, descrição ou situação.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar classes de frota</li>
            <li><strong>Grid:</strong> Visualizar classes em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar classes de frota</li>
          </ul>
          
          <h4>📋 Campos do Formulário</h4>
          <ul>
            <li><strong>Descrição:</strong> Nome da classe de frota (obrigatório)</li>
            <li><strong>Número de Eixos:</strong> Quantidade de eixos do veículo (obrigatório, de 2 a 9)</li>
            <li><strong>Capacidade de Carga:</strong> Capacidade máxima de carga em toneladas (opcional)</li>
            <li><strong>Situação:</strong> Ativo ou Inativo (obrigatório)</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar uma nova classe, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar uma classe existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Para desativar uma classe, edite-a e altere a situação para "Inativo" ou use o botão de exclusão</li>
            <li>Classes inativas não aparecerão em seleções de novos cadastros</li>
            <li>O número de eixos é importante para cálculos de frete e classificação de veículos</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaClassesFrota()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaClassesFrota = function() {
    const modal = document.getElementById('modalAjudaClassesFrota');
    if (modal) {
      modal.remove();
    }
  };
})();
