// backend/public/modulos/gerenciar-filiais/js/script.js
// i18n: helper t() e chaves web.modulos.filiais
(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const filialForm = document.getElementById('filialForm');
  const list = document.getElementById('filiaisList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  let gridTab = null;
  let lastFiliais = null;
  let empresasCarregadas = false;
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
    if (window.intervaloInitSQLFiliais) {
      clearInterval(window.intervaloInitSQLFiliais);
      delete window.intervaloInitSQLFiliais;
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

  // Função para carregar e executar o arquivo init.sql
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
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch('/modulos/gerenciar-filiais/sql/init.sql');
      
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
          // Manter linhas que não são apenas comentários vazios
          // IMPORTANTE: Manter 'GO' pois o backend precisa dele para dividir comandos
          return linhaTrim.length > 0 && 
                 !linhaTrim.startsWith('--');
        })
        .join('\n')
        .trim();
      
      // Se não há SQL para executar, retornar
      if (!sqlLimpo || sqlLimpo.length === 0) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return;
      }
      
      // Atualizar mensagem: processando comandos
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      // Executar o SQL via API e AGUARDAR completamente a resposta
      let execResponse;
      try {
        execResponse = await fetch('/api/filiais/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          // Aumentar timeout para scripts grandes (MERGE pode demorar)
          signal: AbortSignal.timeout(120000) // 120 segundos (2 minutos)
        });
      } catch (fetchError) {
        clearTimeout(timeoutSeguranca);
        if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        if (fetchError.message.includes('ERR_CONNECTION_RESET') || fetchError.message.includes('Failed to fetch')) {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        hideLoadingOverlayInitSQL();
        return;
      }
      
      // Verificar se a resposta foi bem-sucedida
      if (!execResponse.ok) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Atualizar mensagem: processando resultados
      showLoadingOverlayInitSQL('Processando Inicialização', 'Processando resultados...', 'Quase terminando.');
      
      // Aguardar completamente a resposta JSON
      let result;
      try {
        result = await execResponse.json();
      } catch (jsonError) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se todos os comandos foram executados com sucesso
      if (!result.success) {
        clearTimeout(timeoutSeguranca);
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result.resultados && Array.isArray(result.resultados)) {
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        if (comandosComErro.length > 0) {
          // Filtrar erros "esperados" (como tabela já existe, índice já existe, etc.)
          const errosReais = comandosComErro.filter(erro => {
            const mensagem = (erro.mensagem || erro.erro || '').toLowerCase();
            // Erros esperados que não são problemas reais
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
            // Log apenas erros reais críticos
            errosReais.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              if (typeof mensagem === 'object') {
                console.error('[Filiais] Erro no init.sql:', JSON.stringify(mensagem));
              } else {
                console.error('[Filiais] Erro no init.sql:', mensagem);
              }
            });
          }
        }
      }
      
      // Limpar timeout de segurança
      clearTimeout(timeoutSeguranca);
      
      // Limpar intervalo ANTES de fechar overlay
      if (window.intervaloInitSQLFiliais) {
        clearInterval(window.intervaloInitSQLFiliais);
        delete window.intervaloInitSQLFiliais;
      }
      
      // Marcar como fechado ANTES de chamar hideLoadingOverlayInitSQL
      window.initSQLOverlayFechado = true;
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Limpar timeout de segurança se existir
      if (typeof timeoutSeguranca !== 'undefined') {
        clearTimeout(timeoutSeguranca);
      }
      
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQLFiliais) {
        clearInterval(window.intervaloInitSQLFiliais);
        delete window.intervaloInitSQLFiliais;
      }
      
      // Marcar como fechado
      window.initSQLOverlayFechado = true;
      
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
  }
  
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
    
    await loadEmpresas();
    await showTab('filtros');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  async function showTab(tabId) {
    try {
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
      
      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (tabId === 'grid') {
        try {
          // GridEditor já é carregado pelo dashboard.js
          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            // Sempre renderizar, mesmo se não houver dados (grid vazio)
            const filiaisParaRenderizar = lastFiliais || [];
            if (gridTab) {
              gridTab.render(filiaisParaRenderizar);
            }
            // Não aplicar filtros automaticamente - usuário deve aplicar manualmente
          }
        } catch (gridErr) {
          console.warn('[Filiais] Erro ao processar grid:', gridErr);
          // Continuar mesmo se houver erro - não bloquear mudança de aba
        }
      }
    } catch (err) {
      console.warn('[Filiais] Erro ao mudar aba:', err);
      // Forçar mudança de aba mesmo em caso de erro
      try {
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
      } catch (forceErr) {
        console.error('[Filiais] Erro ao forçar mudança de aba:', forceErr);
      }
    }
  }

  async function loadEmpresas() {
    if (empresasCarregadas) return;
    
    try {
      const response = await fetch('/api/empresas');
      const empresas = await response.json();
      
      const fillSelect = (id, items) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '';
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = id.startsWith('filtro') ? 'Todas' : 'Selecione';
        el.appendChild(defaultOption);
        items.forEach(item => {
          const opt = document.createElement('option');
          opt.value = item.CDEMPRESA;
          opt.textContent = `${item.CDEMPRESA} - ${item.RZSOCIAL}`;
          el.appendChild(opt);
        });
      };

      fillSelect('filtroEmpresa', empresas);
      fillSelect('filialEmpresa', empresas);
      empresasCarregadas = true;
    } catch (err) {
      console.error('Erro ao carregar empresas:', err);
      showMessage('Erro ao carregar empresas.', 'error');
    }
  }

  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const cdempresa = document.getElementById('filtroEmpresa')?.value;
    const cdfilial = document.getElementById('filtroFilial')?.value;
    const nomefantasia = document.getElementById('filtroNomeFantasia')?.value;
    const sigla = document.getElementById('filtroSigla')?.value;
    const cgcRaw = document.getElementById('filtroCgc')?.value.replace(/[^\d]+/g, '');
    const cgc = cgcRaw && cgcRaw.length > 0 ? cgcRaw.padStart(14, '0') : '';
    const fgparceiro = document.getElementById('filtroParceiro')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;
    
    if (cdempresa) params.append('cdempresa', cdempresa);
    if (cdfilial) params.append('cdfilial', cdfilial);
    if (nomefantasia) params.append('nomefantasia', nomefantasia);
    if (sigla) params.append('siglafilial', sigla);
    if (cgc && cgc.length === 14) params.append('cgc', cgc);
    if (fgparceiro) params.append('fgparceiro', fgparceiro);
    if (situacao) params.append('situacao', situacao);
    
    try {
      const response = await fetch(`/api/filiais?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const filiais = await response.json();
      
      if (!Array.isArray(filiais)) {
        console.error('[Filiais] Resposta não é um array:', filiais);
        showMessage('Erro ao carregar filiais. Resposta inválida.', 'error');
        return;
      }

      // Criar campo virtual combinado para chave composta
      lastFiliais = filiais.map(f => ({
        ...f,
        ID_COMPOSTO: `${f.CDEMPRESA}_${f.CDFILIAL}` // Campo virtual para chave composta
      }));
      
      // Atualizar contador
      const countEl = document.getElementById('filiaisGridCountText');
      if (countEl) {
        const count = filiais.length || 0;
        countEl.textContent = count + ' ' + (t('web.modulos.filiais.registrosEncontrados').replace(/^0\s*/, ''));
      }
      
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(lastFiliais);
        } catch (e) { }
      }

      try {
        if (Array.isArray(lastFiliais) && lastFiliais.length > 0) {
          if (typeof window.GridEditor === 'undefined') {
            try {
              await loadScript('/js/grid-editor.js');
            } catch (loadErr) { }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(lastFiliais);
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
          try { gridTab.render(lastFiliais); } catch (err) { console.error('[Grid] erro ao renderizar grid:', err); }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('[Filiais] Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar filiais: ' + (err.message || 'Erro desconhecido'), 'error');
    }
  }

  function renderList(filiais) {
    if (!filiais || filiais.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma filial encontrada.</p>';
      return;
    }

    list.innerHTML = filiais.map(f => `
      <div class="list-item ${f.FGACTIVE === 'N' ? 'inactive' : ''}" data-empresa="${f.CDEMPRESA}" data-filial="${f.CDFILIAL}">
        <div>
          <strong>${f.CDEMPRESA}/${f.CDFILIAL} - ${f.NMFANTASIA}</strong>
          <small>
            <strong>Sigla:</strong> ${f.SGFILIAL}<br>
            <strong>CNPJ:</strong> ${formatarCNPJ(f.CGC)}<br>
            <strong>Parceiro:</strong> ${f.FGPARCEIRO === 'S' ? 'Sim' : 'Não'}<br>
            <strong>Status:</strong> ${f.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-empresa="${f.CDEMPRESA}" data-filial="${f.CDFILIAL}">Editar</button>
          <button class="btn delete" data-empresa="${f.CDEMPRESA}" data-filial="${f.CDFILIAL}">Excluir</button>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.btn.edit, .btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const empresa = e.currentTarget.dataset.empresa || e.currentTarget.getAttribute('data-empresa');
        const filial = e.currentTarget.dataset.filial || e.currentTarget.getAttribute('data-filial');

        if (!empresa || !filial || empresa === 'null' || empresa === 'undefined' || filial === 'null' || filial === 'undefined') {
          console.error('[Filiais] IDs inválidos:', empresa, filial);
          showMessage(t('web.modulos.filiais.erroIdIndisponivel'), 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadFilialParaEdicao(empresa, filial);
        } else {
          confirmarExclusao(empresa, filial);
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
    
    // Criar campo virtual combinado para chave composta antes de inicializar o Grid
    if (lastFiliais) {
      lastFiliais = lastFiliais.map(f => ({
        ...f,
        ID_COMPOSTO: `${f.CDEMPRESA}_${f.CDFILIAL}` // Campo virtual para chave composta
      }));
    }
    
    gridTab = new GridEditor({
      container: '#filiaisGrid',
      columns: [
        { field: 'CDEMPRESA', header: 'Empresa', editable: false, width: '100px' },
        { field: 'CDFILIAL', header: 'Filial', editable: false, width: '100px' },
        { field: 'ID_COMPOSTO', header: '', editable: false, isId: true, hidden: true }, // Campo virtual usado como ID da linha (chave composta Empresa_Filial)
        { field: 'NMFANTASIA', header: 'Nome Fantasia', editable: true, type: 'text', maxlength: 20 },
        { field: 'SGFILIAL', header: 'Sigla', editable: true, type: 'text', maxlength: 5 },
        {
          field: 'CGC',
          header: 'CNPJ',
          editable: true,
          type: 'text',
          format: (val) => formatarCNPJ(val)
        },
        { field: 'FGPARCEIRO', header: 'Parceiro', editable: true, type: 'select',
          options: [ { value: 'S', label: 'Sim' }, { value: 'N', label: 'Não' } ],
          format: (val) => val === 'S' ? '✓ Sim' : '✗ Não'
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/filiais',
      onBeforeEdit: async (id) => {
        // Só carregar se realmente foi um clique do usuário
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return false;
        }
        // id vem como "CDEMPRESA_CDFILIAL"
        const [empresa, filial] = id.split('_');
        if (!empresa || !filial) {
          return false;
        }
        await loadFilialParaEdicao(empresa, filial);
        return false; // Impedir edição inline
      },
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          return;
        }
        const [empresa, filial] = id.split('_');
        await confirmarExclusao(empresa, filial);
      },
      onAfterEdit: (id) => {
        showMessage('Alteração salva com sucesso!', 'success');
        if (lastFiliais) {
          const [empresa, filial] = id.split('_');
          const idx = lastFiliais.findIndex(r => String(r.CDEMPRESA) === String(empresa) && String(r.CDFILIAL) === String(filial));
          if (idx !== -1) lastFiliais[idx] = { ...lastFiliais[idx], ...{} };
        }
      }
    });
  }

  async function loadFilialParaEdicao(empresa, filial) {
    try {
      // Validar IDs antes de prosseguir
      if (!empresa || !filial || empresa === 'undefined' || filial === 'undefined' || 
          empresa === 'null' || filial === 'null' || empresa === '' || filial === '') {
        console.warn('[Filiais] IDs inválidos para edição:', empresa, filial);
        return;
      }
      
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (filialForm) {
        filialForm.reset();
      }
      
      const response = await fetch(`/api/filiais/${empresa}/${filial}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const filialData = await response.json();
      
      if (filialData) {
        // Trocar para aba Dados primeiro (evita tela bagunçada com grid + form juntos)
        showTab('dados');
        document.getElementById('filialEmpresaId').value = filialData.CDEMPRESA;
        document.getElementById('filialId').value = filialData.CDFILIAL;
        document.getElementById('filialEmpresa').value = filialData.CDEMPRESA;
        document.getElementById('filialCodigo').value = filialData.CDFILIAL;
        document.getElementById('filialNomeFantasia').value = filialData.NMFANTASIA;
        document.getElementById('filialSigla').value = filialData.SGFILIAL;
        document.getElementById('filialCgc').value = formatarCNPJ(filialData.CGC);
        document.getElementById('filialCadastro').value = filialData.CDCADASTRO;
        document.getElementById('filialParceiro').value = filialData.FGPARCEIRO || 'N';
        document.getElementById('filialSituacao').value = filialData.FGACTIVE;
        document.getElementById('formTitle').textContent = t('web.modulos.filiais.editarFilial');
      }
    } catch (err) {
      console.error('[Filiais] Erro ao carregar filial:', err);
      if (typeof showMessage === 'function') {
        showMessage(t('web.modulos.filiais.erroCarregarDados'), 'error');
      }
    }
  }

  async function confirmarExclusao(empresa, filial) {
    if (!empresa || !filial || empresa === 'undefined' || empresa === 'null' || filial === 'undefined' || filial === 'null') {
      showMessage(t('web.modulos.filiais.erroIdIndisponivel'), 'error');
      return;
    }
    
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');

    try {
      const empresaNum = parseInt(empresa);
      const filialNum = parseInt(filial);
      const response = await fetch(`/api/filiais/${empresaNum}/${filialNum}`);
      if (!response.ok) throw new Error('Erro ao buscar filial');
      const filialData = await response.json();
      const estaAtivo = filialData.FGACTIVE === 'S';
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja desativar esta filial?';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja reativar esta filial?';
        action = 'activate';
        btnText = 'Reativar';
      }

      if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
        if (window.confirm(confirmMsg)) {
          const r = await fetch(`/api/filiais/${empresaNum}/${filialNum}?action=${action}`, { method: 'DELETE' });
          const data = await r.json();
          if (r.ok) { showMessage(data.message || 'Status alterado.', 'success'); showTab('grid'); applyFilters('grid'); }
          else showMessage(data.error || 'Erro ao alterar status.', 'error');
        }
        return;
      }

      modalMessage.textContent = confirmMsg;
      modalEl.dataset.deleteEmpresa = empresa;
      modalEl.dataset.deleteFilial = filial;
      modalEl.dataset.action = action;
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      newConfirmYes.className = 'btn-filtro btn-filtro-danger';
      newConfirmYes.innerHTML = '<i class="bx bx-check"></i> ' + btnText;
      newConfirmNo.className = 'btn-filtro btn-filtro-limpar';
      newConfirmNo.innerHTML = '<i class="bx bx-x"></i> ' + (t('web.modulos.filiais.cancelar') || 'Cancelar');
      if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        try {
          const deleteEmpresa = modalEl.dataset.deleteEmpresa || empresa;
          const deleteFilial = modalEl.dataset.deleteFilial || filial;
          const acao = modalEl.dataset.action || action;
          
          if (!deleteEmpresa || !deleteFilial) {
            showMessage(t('web.modulos.filiais.erroIdIndisponivel'), 'error');
            modalEl.style.display = 'none';
            return;
          }
          
          const empresaNum = parseInt(deleteEmpresa);
          const filialNum = parseInt(deleteFilial);
          const response = await fetch(`/api/filiais/${empresaNum}/${filialNum}?action=${acao}`, {
            method: 'DELETE'
          });
          
          const data = await response.json();
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Filial reativada com sucesso!' : 'Filial desativada com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da filial.', 'error');
          }
        } catch (err) {
          console.error('[Filiais] Erro ao alterar status:', err);
          showMessage(t('web.modulos.filiais.erroConexao'), 'error');
        } finally {
          modalEl.style.display = 'none';
          delete modalEl.dataset.deleteEmpresa;
          delete modalEl.dataset.deleteFilial;
          delete modalEl.dataset.action;
        }
      };
    
      newConfirmNo.onclick = () => {
        modalEl.style.display = 'none';
        delete modalEl.dataset.deleteEmpresa;
        delete modalEl.dataset.deleteFilial;
        delete modalEl.dataset.action;
      };
      modalEl.style.display = 'block';
    } catch (err) {
      console.error('[Filiais] Erro ao buscar status da filial:', err);
      showMessage('Erro ao verificar status da filial.', 'error');
    }
  }

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
  const filialCgc = document.getElementById('filialCgc');
  const filtroCgc = document.getElementById('filtroCgc');
  
  if (filialCgc) aplicarMascaraCNPJ(filialCgc);
  if (filtroCgc) aplicarMascaraCNPJ(filtroCgc);

  let filialFormSubmitting = false;
  filialForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (filialFormSubmitting) return;
    filialFormSubmitting = true;
    const btnSubmit = filialForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }

    const empresaId = document.getElementById('filialEmpresaId')?.value;
    const filialId = document.getElementById('filialId')?.value;
    const empresa = document.getElementById('filialEmpresa')?.value;
    const nomefantasia = document.getElementById('filialNomeFantasia')?.value.trim();
    const sigla = document.getElementById('filialSigla')?.value.trim();
    let cgc = document.getElementById('filialCgc')?.value.replace(/[^\d]+/g, '');
    const cadastro = document.getElementById('filialCadastro')?.value;
    const parceiro = document.getElementById('filialParceiro')?.value;
    const situacao = document.getElementById('filialSituacao')?.value;

    if (!empresa || !nomefantasia || !sigla || !cgc || !cadastro || !situacao) {
      showMessage(t('web.modulos.filiais.preenchaCampos'), 'error');
      filialFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }
    cgc = cgc.padStart(14, '0');
    if (!validarCNPJ(cgc)) {
      showMessage('CNPJ inválido.', 'error');
      filialFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const filialData = {
        CDEMPRESA: parseInt(empresa),
        NMFANTASIA: nomefantasia,
        SGFILIAL: sigla,
        CGC: cgc,
        CDCADASTRO: parseInt(cadastro),
        FGPARCEIRO: parceiro || 'N',
        FGACTIVE: situacao
      };
      
      let response;
      if (empresaId && filialId) {
        response = await fetch(`/api/filiais/${empresaId}/${filialId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filialData)
        });
      } else {
        response = await fetch('/api/filiais', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(filialData)
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
      showMessage(t('web.modulos.filiais.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        filialFormSubmitting = false;
        const btnSalvar = filialForm?.querySelector('button[type="submit"]');
        if (btnSalvar) {
          btnSalvar.disabled = false;
          if (labelOriginal) btnSalvar.innerHTML = labelOriginal;
          else if (typeof window.showLoading !== 'undefined') window.showLoading(btnSalvar, false);
        }
      }, 600);
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
    document.getElementById('filtroEmpresa').value = '';
    document.getElementById('filtroFilial').value = '';
    document.getElementById('filtroNomeFantasia').value = '';
    document.getElementById('filtroSigla').value = '';
    document.getElementById('filtroCgc').value = '';
    document.getElementById('filtroParceiro').value = '';
    document.getElementById('filtroSituacao').value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    filialForm?.reset();
    document.getElementById('filialEmpresaId').value = '';
    document.getElementById('filialId').value = '';
    document.getElementById('filialCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.filiais.novaFilial');
    showTab('dados');
  });

  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));

  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    filialForm?.reset();
    document.getElementById('filialEmpresaId').value = '';
    document.getElementById('filialId').value = '';
    document.getElementById('filialCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.filiais.novaFilial');
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

