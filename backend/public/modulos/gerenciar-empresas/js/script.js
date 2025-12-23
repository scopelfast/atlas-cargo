// backend/public/modulos/gerenciar-empresas/js/script.js
(function() {
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const empresaForm = document.getElementById('empresaForm');
  const list = document.getElementById('empresasList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastEmpresas = null;
  
  let sqlExecutado = false;
  let initExecutado = false;

  // Funções para controlar overlay de carregamento do init.sql (padrão Gerenciar Equipamentos)
  function showLoadingOverlayInitSQL(titulo = 'Processando Inicialização', texto = 'Executando scripts de inicialização...', detalhe = 'Isso pode levar alguns segundos.') {
    // Se o overlay foi fechado, não reabrir
    if (window.initSQLOverlayFechado) {
      return;
    }
    
    const overlay = document.getElementById('loadingOverlayInitSQL');
    if (!overlay) return;
    
    // Verificar se já está visível para evitar logs desnecessários
    const isVisible = window.getComputedStyle(overlay).display !== 'none';
    
    const loadingTitle = document.getElementById('loadingTitleInitSQL');
    const loadingText = document.getElementById('loadingTextInitSQL');
    const loadingDetail = document.getElementById('loadingDetailInitSQL');
    
    if (loadingTitle && loadingText && loadingDetail) {
      loadingTitle.textContent = titulo;
      loadingText.textContent = texto;
      loadingDetail.textContent = detalhe;
      
      // Só mostrar se ainda não estiver visível
      if (!isVisible) {
        overlay.style.setProperty('display', 'flex', 'important');
        overlay.style.visibility = 'visible';
        overlay.style.opacity = '1';
        overlay.style.pointerEvents = 'auto';
        overlay.style.zIndex = '10000';
        overlay.removeAttribute('hidden');
      }
    }
  }

  function hideLoadingOverlayInitSQL() {
    // IMPORTANTE: Limpar intervalo de progresso PRIMEIRO para evitar que ele reabra o overlay
    if (window.intervaloInitSQLEmpresas) {
      clearInterval(window.intervaloInitSQLEmpresas);
      delete window.intervaloInitSQLEmpresas;
    }
    
    // Marcar flag para evitar que showLoadingOverlayInitSQL reabra
    window.initSQLOverlayFechado = true;
    
    // Tentar encontrar o overlay de várias formas
    let overlay = document.getElementById('loadingOverlayInitSQL');
    
    if (!overlay) {
      overlay = document.querySelector('.calculando-overlay#loadingOverlayInitSQL');
    }
    
    if (overlay) {
      const wasVisible = window.getComputedStyle(overlay).display !== 'none';
      
      // Múltiplas tentativas de fechar
      overlay.style.display = 'none';
      overlay.style.setProperty('display', 'none', 'important');
      overlay.classList.remove('active');
      overlay.setAttribute('style', 'display: none !important;');
      overlay.style.visibility = 'hidden';
      overlay.style.opacity = '0';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '-1';
      
      // Verificar se realmente fechou
      const computedDisplay = window.getComputedStyle(overlay).display;
      
      if (computedDisplay !== 'none') {
        overlay.removeAttribute('class');
        overlay.setAttribute('hidden', 'true');
      }
    }
  }
  
  // Tornar função global para o botão de cancelar
  window.hideLoadingOverlayInitSQL = hideLoadingOverlayInitSQL;

  // Função para carregar e executar o arquivo init.sql (padrão Gerenciar Equipamentos)
  async function executarInitSQL() {
    // Proteção: Se já foi executado, não executar novamente
    if (sqlExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    sqlExecutado = true;
    
    // Resetar flag de fechamento
    window.initSQLOverlayFechado = false;
    
    // Timeout de segurança: fechar overlay após 90 segundos mesmo se não terminar
    let timeoutSeguranca = setTimeout(() => {
      window.initSQLOverlayFechado = true;
      hideLoadingOverlayInitSQL();
    }, 90000); // 90 segundos
    
    // Mostrar overlay de carregamento APENAS se ainda não estiver visível
    const overlay = document.getElementById('loadingOverlayInitSQL');
    if (overlay && window.getComputedStyle(overlay).display === 'none') {
      showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    }
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch('/modulos/gerenciar-empresas/sql/init.sql');
      
      // Atualizar mensagem do overlay
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          clearTimeout(timeoutSeguranca);
          hideLoadingOverlayInitSQL();
          return;
        }
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      const sqlContent = await response.text();
      
      // Remover comentários de bloco /* */ (incluindo multilinhas) usando regex
      let sqlSemComentarios = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
      
      // Remover apenas comentários, mas MANTER 'GO' pois o backend precisa dele para dividir comandos
      const sqlLimpo = sqlSemComentarios
        .split('\n')
        .filter(linha => {
          const linhaTrim = linha.trim();
          return linhaTrim.length > 0 && !linhaTrim.startsWith('--');
        })
        .join('\n')
        .trim();
      
      if (!sqlLimpo || sqlLimpo.length === 0) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      let execResponse;
      try {
        execResponse = await fetch('/api/empresas/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          signal: AbortSignal.timeout(120000) // 120 segundos (2 minutos)
        });
      } catch (fetchError) {
        clearTimeout(timeoutSeguranca);
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
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      
      showLoadingOverlayInitSQL('Processando Inicialização', 'Processando resultados...', 'Quase terminando.');
      
      let result;
      try {
        result = await execResponse.json();
      } catch (jsonError) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      
      if (!result.success) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result.resultados && Array.isArray(result.resultados)) {
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        if (comandosComErro.length > 0) {
          // Filtrar erros "esperados" (como tabela já existe, índice já existe, etc.)
          const errosReais = comandosComErro.filter(erro => {
            const mensagem = (erro.mensagem || erro.erro || '').toLowerCase();
            const errosEsperados = [
              'already exists',
              'já existe',
              'duplicate',
              'duplicado',
              'there is already',
              'já há'
            ];
            return !errosEsperados.some(esperado => mensagem.includes(esperado));
          });
          
          if (errosReais.length > 0) {
            errosReais.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              if (typeof mensagem === 'object') {
                console.error('[Empresas] Erro no init.sql:', JSON.stringify(mensagem));
              } else {
                console.error('[Empresas] Erro no init.sql:', mensagem);
              }
            });
          }
        }
      }
      
      // Limpar timeout de segurança
      clearTimeout(timeoutSeguranca);
      
      // Limpar intervalo ANTES de fechar overlay
      if (window.intervaloInitSQLEmpresas) {
        clearInterval(window.intervaloInitSQLEmpresas);
        delete window.intervaloInitSQLEmpresas;
      }
      
      // Marcar como fechado ANTES de chamar hideLoadingOverlayInitSQL
      window.initSQLOverlayFechado = true;
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
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
      // Limpar timeout de segurança se existir
      if (typeof timeoutSeguranca !== 'undefined') {
        clearTimeout(timeoutSeguranca);
      }
      
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQLEmpresas) {
        clearInterval(window.intervaloInitSQLEmpresas);
        delete window.intervaloInitSQLEmpresas;
      }
      
      // Marcar como fechado
      window.initSQLOverlayFechado = true;
      
      // Esconder overlay em caso de erro
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
    try {
      // Primeiro, mudar a aba imediatamente
      tabs.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      const tabContent = document.getElementById(`tab-${tabId}`);
      
      if (tabBtn) {
        tabBtn.classList.add('active');
      }
      if (tabContent) {
        tabContent.classList.add('active');
      }
      
      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (tabId === 'grid') {
        try {
          // GridEditor já é carregado pelo dashboard.js
          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            // Sempre renderizar, mesmo se não houver dados (grid vazio)
            const empresasParaRenderizar = lastEmpresas || [];
            if (gridTab) {
              gridTab.render(empresasParaRenderizar);
            }
            // Não aplicar filtros automaticamente - usuário deve aplicar manualmente
          }
        } catch (gridErr) {
          console.warn('[Empresas] Erro ao processar grid:', gridErr);
          // Continuar mesmo se houver erro - não bloquear mudança de aba
        }
      }
    } catch (err) {
      console.warn('[Empresas] Erro ao mudar aba:', err);
      // Forçar mudança de aba mesmo em caso de erro
      try {
        tabs.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        const tabContent = document.getElementById(`tab-${tabId}`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) {
          tabContent.classList.add('active');
        }
      } catch (forceErr) {
        console.error('[Empresas] Erro ao forçar mudança de aba:', forceErr);
      }
    }
  }

  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value?.trim();
    const razaosocial = document.getElementById('filtroRazaoSocial')?.value?.trim();
    const nomereduzido = document.getElementById('filtroNomeReduzido')?.value?.trim();
    const situacao = document.getElementById('filtroSituacao')?.value;
    const cgcRaw = document.getElementById('filtroCgc')?.value?.replace(/[^\d]+/g, '') || '';
    const cgc = cgcRaw && cgcRaw.length > 0 ? cgcRaw.padStart(14, '0') : '';
    
    if (codigo) params.append('codigo', codigo);
    if (razaosocial) params.append('razaosocial', razaosocial);
    if (nomereduzido) params.append('nomereduzido', nomereduzido);
    if (situacao) params.append('situacao', situacao);
    if (cgc && cgc.length === 14 && cgc !== '00000000000000') params.append('cgcmatriz', cgc);
    
    try {
      const response = await fetch(`/api/empresas?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const empresas = await response.json();
      
      if (!Array.isArray(empresas)) {
        console.error('[Empresas] Resposta não é um array:', empresas);
        if (typeof showMessage === 'function') {
          showMessage('Erro ao carregar empresas. Resposta inválida.', 'error');
        } else {
          console.error('Erro ao carregar empresas. Resposta inválida.');
        }
        return;
      }

      lastEmpresas = empresas;
      // Atualizar contador
      const countEl = document.getElementById('empresasGridCountText');
      if (countEl) {
        const count = empresas.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(empresas);
        } catch (e) { }
      }

      try {
        if (Array.isArray(empresas) && empresas.length > 0) {
          // GridEditor já é carregado pelo dashboard.js
          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(empresas);
            } catch (e) { }
          }
        }
      } catch (autoErr) {
        console.error('[Grid] erro no fluxo de auto-init:', autoErr);
      }

      if (openTab === 'grid') {
        // GridEditor já é carregado pelo dashboard.js
        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          try { gridTab.render(empresas); } catch (err) { console.error('[Grid] erro ao renderizar grid:', err); }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('[Empresas] Erro ao aplicar filtros:', err);
      if (typeof showMessage === 'function') {
        showMessage('Erro ao carregar empresas: ' + (err.message || 'Erro desconhecido'), 'error');
      } else {
        console.error('Erro ao carregar empresas:', err);
      }
    }
  }

  function renderList(empresas) {
    if (!empresas || empresas.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma empresa encontrada.</p>';
      return;
    }

    list.innerHTML = empresas.map(e => `
      <div class="list-item ${e.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${e.CDEMPRESA}">
        <div>
          <strong>${e.CDEMPRESA} - ${e.RZSOCIAL}</strong>
          <small>
            <strong>Nome Reduzido:</strong> ${e.NMREDUZIDO}<br>
            <strong>CNPJ:</strong> ${formatarCNPJ(e.CGCMATRIZ)}<br>
            <strong>Status:</strong> ${e.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${e.CDEMPRESA}">Editar</button>
          <button class="btn delete" data-id="${e.CDEMPRESA}">Excluir</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.btn.edit, .btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id || 
                   e.currentTarget.getAttribute('data-id') ||
                   e.currentTarget.closest('[data-id]')?.dataset?.id ||
                   e.currentTarget.closest('[data-id]')?.getAttribute('data-id');

        if (!id || id === 'null' || id === 'undefined' || id === '') {
          console.error('[Empresas] ID inválido:', id);
          showMessage('Erro: ID não disponível.', 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadEmpresaParaEdicao(id);
        } else {
          confirmarExclusao(id);
        }
      });
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        // Usar corrigirUrl se disponível para garantir o caminho base correto
        const srcCorrigido = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl(src) : src;
        script.src = `${srcCorrigido}?t=${Date.now()}`;
        script.onload = () => {
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
      
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof GridEditor !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            existingScript.remove();
            carregarNovoScript();
          }
        }, 100);
        return;
      }
      
      carregarNovoScript();
    });
  }

  function inicializarGridTab() {
    // Se já existe, destruir antes de criar novo
    if (gridTab && typeof gridTab.destroy === 'function') {
      try {
        gridTab.destroy();
      } catch (e) {
        // Ignorar erros ao destruir
      }
    }
    
    gridTab = new GridEditor({
      container: '#empresasGrid',
      columns: [
        { field: 'CDEMPRESA', header: 'Código', editable: false, isId: true, width: '100px' },
        { field: 'RZSOCIAL', header: 'Razão Social', editable: true, type: 'text', width: '350px', maxlength: 40 },
        { field: 'NMREDUZIDO', header: 'Nome Reduzido', editable: true, type: 'text', width: '220px', maxlength: 20 },
        { 
          field: 'CGCMATRIZ', 
          header: 'CNPJ Matriz', 
          editable: true, 
          type: 'text', 
          width: '180px',
          format: (val) => formatarCNPJ(val)
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/empresas',
      onBeforeEdit: async (id) => {
        // Só carregar se realmente foi um clique do usuário
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return false;
        }
        await loadEmpresaParaEdicao(id);
        return false; // Impedir edição inline
      },
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        await confirmarExclusao(id);
      },
      onAfterEdit: (id) => {
        showMessage('Alteração salva com sucesso!', 'success');
        if (lastEmpresas) {
          const idx = lastEmpresas.findIndex(r => String(r.CDEMPRESA) === String(id));
          if (idx !== -1) lastEmpresas[idx] = { ...lastEmpresas[idx], ...{} };
        }
      }
    });
  }

  async function loadEmpresaParaEdicao(id) {
    try {
      // Validar ID antes de prosseguir
      if (!id || id === 'undefined' || id === 'null' || id === '') {
        console.warn('[Empresas] ID inválido para edição:', id);
        return;
      }
      
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (empresaForm) {
        empresaForm.reset();
      }
      
      const response = await fetch(`/api/empresas/${id}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const empresa = await response.json();
      
      if (empresa) {
        document.getElementById('empresaId').value = empresa.CDEMPRESA;
        document.getElementById('empresaCodigo').value = empresa.CDEMPRESA;
        document.getElementById('empresaRazaoSocial').value = empresa.RZSOCIAL;
        document.getElementById('empresaNomeReduzido').value = empresa.NMREDUZIDO;
        document.getElementById('empresaCgcMatriz').value = formatarCNPJ(empresa.CGCMATRIZ);
        document.getElementById('empresaSituacao').value = empresa.FGACTIVE;
        document.getElementById('formTitle').textContent = 'Editar Empresa';
        showTab('dados');
      }
    } catch (err) {
      console.error('[Empresas] Erro ao carregar empresa:', err);
      if (typeof showMessage === 'function') {
        showMessage('Erro ao carregar dados para edição.', 'error');
      }
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
      // Buscar o status atual da empresa
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/empresas/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar empresa');
      }
      
      const empresa = await response.json();
      const estaAtivo = empresa.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> esta empresa?<br><br><small style="color: #666;">A empresa ficará inativa e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> esta empresa?<br><br><small style="color: #666;">A empresa voltará a aparecer nas listagens e estará disponível para uso.</small>';
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
          const response = await fetch(`/api/empresas/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Empresa reativada com sucesso!' : 'Empresa desativada com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da empresa.', 'error');
          }
        } catch (err) {
          console.error('[Empresas] Erro ao alterar status:', err);
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
      console.error('[Empresas] Erro ao buscar status da empresa:', err);
      showMessage('Erro ao verificar status da empresa.', 'error');
    }
  }

  // Função para formatar CNPJ
  function formatarCNPJ(cnpj) {
    if (!cnpj) return '';
    let cnpjStr = cnpj.toString().replace(/[^\d]+/g, '');
    // Completar com zeros à esquerda se necessário
    if (cnpjStr.length < 14) {
      cnpjStr = cnpjStr.padStart(14, '0');
    }
    if (cnpjStr.length !== 14) return cnpjStr;
    return cnpjStr.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  // Função para validar CNPJ
  function validarCNPJ(cnpj) {
    let cnpjStr = cnpj.toString().replace(/[^\d]+/g, '');
    // Completar com zeros à esquerda se necessário
    if (cnpjStr.length < 14) {
      cnpjStr = cnpjStr.padStart(14, '0');
    }
    if (cnpjStr.length !== 14) return false;
    if (/^(\d)\1+$/.test(cnpjStr)) return false;
    
    let tamanho = cnpjStr.length - 2;
    let numeros = cnpjStr.substring(0, tamanho);
    let digitos = cnpjStr.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(0))) return false;
    
    tamanho = tamanho + 1;
    numeros = cnpjStr.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    
    resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(1))) return false;
    
    return true;
  }

  // Função para aplicar máscara e validação em tempo real
  function aplicarMascaraCNPJ(input) {
    input.addEventListener('input', function(e) {
      let value = e.target.value.replace(/[^\d]+/g, '');
      
      // Limitar a 14 dígitos
      if (value.length > 14) {
        value = value.substring(0, 14);
      }
      
      // Aplicar máscara progressiva
      let formatted = '';
      if (value.length > 0) {
        if (value.length <= 2) {
          formatted = value;
        } else if (value.length <= 5) {
          formatted = value.replace(/^(\d{2})(\d+)$/, '$1.$2');
        } else if (value.length <= 8) {
          formatted = value.replace(/^(\d{2})(\d{3})(\d+)$/, '$1.$2.$3');
        } else if (value.length <= 12) {
          formatted = value.replace(/^(\d{2})(\d{3})(\d{3})(\d+)$/, '$1.$2.$3/$4');
        } else {
          formatted = value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d+)$/, '$1.$2.$3/$4-$5');
        }
      }
      
      e.target.value = formatted;
      
      // Validar em tempo real (apenas quando completo)
      if (value.length === 14) {
        const cnpjCompleto = value.padStart(14, '0');
        if (validarCNPJ(cnpjCompleto)) {
          e.target.setCustomValidity('');
          e.target.style.borderColor = '';
        } else {
          e.target.setCustomValidity('CNPJ inválido');
          e.target.style.borderColor = '#dc3545';
        }
      } else {
        e.target.setCustomValidity('');
        e.target.style.borderColor = '';
      }
    });

    input.addEventListener('blur', function(e) {
      let value = e.target.value.replace(/[^\d]+/g, '');
      if (value.length > 0 && value.length < 14) {
        // Completar com zeros à esquerda
        value = value.padStart(14, '0');
        e.target.value = formatarCNPJ(value);
      }
    });
  }

  // Aplicar máscara nos campos de CNPJ (Dados e Filtro)
  const empresaCgcMatriz = document.getElementById('empresaCgcMatriz');
  const filtroCgc = document.getElementById('filtroCgc');
  
  if (empresaCgcMatriz) aplicarMascaraCNPJ(empresaCgcMatriz);
  if (filtroCgc) aplicarMascaraCNPJ(filtroCgc);

  empresaForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('empresaId')?.value;
    const razaosocial = document.getElementById('empresaRazaoSocial')?.value.trim();
    const nomereduzido = document.getElementById('empresaNomeReduzido')?.value.trim();
    let cgcmatriz = document.getElementById('empresaCgcMatriz')?.value.replace(/[^\d]+/g, '');
    const situacao = document.getElementById('empresaSituacao')?.value;
    
    if (!razaosocial || !nomereduzido || !cgcmatriz || !situacao) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    // Completar CNPJ com zeros à esquerda
    cgcmatriz = cgcmatriz.padStart(14, '0');

    // Validar CNPJ
    if (!validarCNPJ(cgcmatriz)) {
      showMessage('CNPJ Matriz inválido.', 'error');
      return;
    }
    
    try {
      const empresaData = {
        RZSOCIAL: razaosocial,
        NMREDUZIDO: nomereduzido,
        CGCMATRIZ: cgcmatriz,
        FGACTIVE: situacao
      };
      
      let response;
      if (id) {
        response = await fetch(`/api/empresas/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(empresaData)
        });
      } else {
        response = await fetch('/api/empresas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(empresaData)
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
    } finally {
      const btnSalvar = empresaForm.querySelector('button[type="submit"]');
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
    }
  });

  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
    });
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.getElementById('filtroCodigo').value = '';
    document.getElementById('filtroRazaoSocial').value = '';
    document.getElementById('filtroNomeReduzido').value = '';
    document.getElementById('filtroCgc').value = '';
    document.getElementById('filtroSituacao').value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    empresaForm?.reset();
    document.getElementById('empresaId').value = '';
    document.getElementById('empresaCodigo').value = '';
    document.getElementById('formTitle').textContent = 'Nova Empresa';
    showTab('dados');
  });

  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    empresaForm?.reset();
    document.getElementById('empresaId').value = '';
    document.getElementById('empresaCodigo').value = '';
    document.getElementById('formTitle').textContent = 'Nova Empresa';
    showTab('dados');
  });
  
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

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

