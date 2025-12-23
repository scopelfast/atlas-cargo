// backend/public/modulos/gerenciar-cidades/js/script.js
// Gerenciar Cidades - Frontend
// Versão: 1.1 - Correção de edição
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

(function() {
  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const cidadeForm = document.getElementById('cidadeForm');
  const list = document.getElementById('cidadesList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let estadosCarregados = false;
  let regioesFiscaisCarregadas = false;
  let paisesCarregados = false;
  let gridTab = null;
  let lastCidades = null; // cache dos últimos resultados do filtro

  // Função de inicialização
  async function init() {
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Garantir que a aba de filtros está ativa e visível
    await showTab('filtros');
    await Promise.all([
      loadEstados(),
      loadRegioesFiscais(),
      loadPaises()
    ]);
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

      // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
      if (tabId === 'grid') {
        try {
          if (typeof window.GridEditor === 'undefined') {
            try { await loadScript('/js/grid-editor.js'); } catch (e) { console.warn('[Cidades] falha ao carregar GridEditor:', e); }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(lastCidades || []);
            } catch (e) {
              console.error('[Cidades] erro ao renderizar grid na aba:', e);
            }
          }
          // NÃO aplicar filtros automaticamente - usuário deve aplicar manualmente
        } catch (gridErr) {
          console.warn('[Cidades] Erro ao processar grid:', gridErr);
          // Continuar mesmo se houver erro - não bloquear mudança de aba
        }
      }
    } catch (err) {
      console.warn('[Cidades] Erro ao mudar aba:', err);
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
        console.error('[Cidades] Erro ao forçar mudança de aba:', forceErr);
      }
    }
  }

  // Carregar script dinamicamente
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

  // Carregar estados do Brasil
  async function loadEstados() {
    try {
      const response = await fetch('/api/estados-brasil');
      const estados = await response.json();
      
      const fillEstados = (id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = '<option value="">Selecione</option>';
        estados.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.uf;
          opt.textContent = `${e.uf} - ${e.nome}`;
          el.appendChild(opt);
        });
      };

      fillEstados('filtroEstado');
      fillEstados('cidadeEstado');
      
      estadosCarregados = true;
      
      // Carregar países no filtro
      if (paisesCarregados) {
        fillPaisesFiltro();
      }
      
      // Carregar regiões fiscais no filtro
      if (regioesFiscaisCarregadas) {
        fillRegioesFiscaisFiltro();
      }
    } catch (err) {
      console.error('Erro ao carregar estados:', err);
      showMessage('Erro ao carregar estados. Verifique a conexão.', 'error');
    }
  }

  // Carregar regiões fiscais
  async function loadRegioesFiscais() {
    try {
      const response = await fetch('/api/regioes-fiscais');
      const regioes = await response.json();
      
      // Popular combo do formulário
      const selectForm = document.getElementById('cidadeRegiaoFiscal');
      if (selectForm) {
        selectForm.innerHTML = '<option value="">Selecione</option>';
        regioes.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.CDREGIAOFISCAL;
          opt.textContent = `${r.CDREGIAOFISCAL} - ${r.DSREGIAOFISCAL}`;
          selectForm.appendChild(opt);
        });
      }
      
      // Popular combo dos filtros
      fillRegioesFiscaisFiltro(regioes);
      
      regioesFiscaisCarregadas = true;
    } catch (err) {
      console.error('Erro ao carregar regiões fiscais:', err);
    }
  }

  // Popular combo de regiões fiscais nos filtros
  function fillRegioesFiscaisFiltro(regioes) {
    const select = document.getElementById('filtroRegiaoFiscal');
    if (!select) return;
    
    if (!regioes) {
      // Se não passou a lista, buscar novamente
      fetch('/api/regioes-fiscais')
        .then(res => res.json())
        .then(data => {
          select.innerHTML = '<option value="">Todas</option>';
          data.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.CDREGIAOFISCAL;
            opt.textContent = `${r.CDREGIAOFISCAL} - ${r.DSREGIAOFISCAL}`;
            select.appendChild(opt);
          });
        })
        .catch(err => console.error('Erro ao carregar regiões fiscais para filtro:', err));
    } else {
      select.innerHTML = '<option value="">Todas</option>';
      regioes.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.CDREGIAOFISCAL;
        opt.textContent = `${r.CDREGIAOFISCAL} - ${r.DSREGIAOFISCAL}`;
        select.appendChild(opt);
      });
    }
  }

  // Carregar países
  async function loadPaises() {
    try {
      const response = await fetch('/api/paises');
      const paises = await response.json();
      
      // Popular combo do formulário
      const selectForm = document.getElementById('cidadePais');
      if (selectForm) {
        selectForm.innerHTML = '<option value="">Selecione</option>';
        paises.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.CDPAIS;
          opt.textContent = `${p.CDPAIS} - ${p.DSPAIS}`;
          selectForm.appendChild(opt);
        });
      }
      
      // Popular combo dos filtros
      fillPaisesFiltro(paises);
      
      paisesCarregados = true;
    } catch (err) {
      console.error('Erro ao carregar países:', err);
    }
  }

  // Popular combo de países nos filtros
  function fillPaisesFiltro(paises) {
    const select = document.getElementById('filtroPais');
    if (!select) return;
    
    if (!paises) {
      // Se não passou a lista, buscar novamente
      fetch('/api/paises')
        .then(res => res.json())
        .then(data => {
          select.innerHTML = '<option value="">Todos</option>';
          data.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.CDPAIS;
            opt.textContent = `${p.CDPAIS} - ${p.DSPAIS}`;
            select.appendChild(opt);
          });
        })
        .catch(err => console.error('Erro ao carregar países para filtro:', err));
    } else {
      select.innerHTML = '<option value="">Todos</option>';
      paises.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.CDPAIS;
        opt.textContent = `${p.CDPAIS} - ${p.DSPAIS}`;
        select.appendChild(opt);
      });
    }
  }

  // Carregar microrregiões por CDUF
  async function loadMicrorregioes(cduf) {
    try {
      const cdufNum = parseInt(cduf);
      if (isNaN(cdufNum) || cdufNum <= 0) {
        const select = document.getElementById('cidadeMicroregiao');
        if (select) select.innerHTML = '<option value="">Selecione</option>';
        return;
      }
      const response = await fetch(`/api/microrregioes/${cdufNum}`);
      
      if (!response.ok) {
        console.error('[Microrregiões] Erro na resposta:', response.status, response.statusText);
        const select = document.getElementById('cidadeMicroregiao');
        if (select) select.innerHTML = '<option value="">Erro ao carregar</option>';
        return;
      }
      
      const microrregioes = await response.json();
      
      const select = document.getElementById('cidadeMicroregiao');
      if (!select) {
        console.error('[Microrregiões] Select não encontrado');
        return;
      }
      
      select.innerHTML = '<option value="">Selecione</option>';
      if (microrregioes && microrregioes.length > 0) {
        microrregioes.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.CDMICROREGIAO;
          opt.textContent = `${m.CDMICROREGIAO} - ${m.DSMICROREGIAO}`;
          select.appendChild(opt);
        });
      } else {
        console.warn('[Microrregiões] Nenhum registro encontrado para CDUF:', cdufNum);
      }
    } catch (err) {
      console.error('[Microrregiões] Erro ao carregar:', err);
      const select = document.getElementById('cidadeMicroregiao');
      if (select) select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  // Carregar mesorregiões por CDUF
  async function loadMesorregioes(cduf) {
    try {
      const cdufNum = parseInt(cduf);
      if (isNaN(cdufNum) || cdufNum <= 0) {
        const select = document.getElementById('cidadeMesoregiao');
        if (select) select.innerHTML = '<option value="">Selecione</option>';
        return;
      }
      const response = await fetch(`/api/mesorregioes/${cdufNum}`);
      
      if (!response.ok) {
        console.error('[Mesorregiões] Erro na resposta:', response.status, response.statusText);
        const select = document.getElementById('cidadeMesoregiao');
        if (select) select.innerHTML = '<option value="">Erro ao carregar</option>';
        return;
      }
      
      const mesorregioes = await response.json();
      
      const select = document.getElementById('cidadeMesoregiao');
      if (!select) {
        console.error('[Mesorregiões] Select não encontrado');
        return;
      }
      
      select.innerHTML = '<option value="">Selecione</option>';
      if (mesorregioes && mesorregioes.length > 0) {
        mesorregioes.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.CDMESOREGIAO;
          opt.textContent = `${m.CDMESOREGIAO} - ${m.DSMESOREGIAO}`;
          select.appendChild(opt);
        });
      } else {
        console.warn('[Mesorregiões] Nenhum registro encontrado para CDUF:', cdufNum);
      }
    } catch (err) {
      console.error('[Mesorregiões] Erro ao carregar:', err);
      const select = document.getElementById('cidadeMesoregiao');
      if (select) select.innerHTML = '<option value="">Erro ao carregar</option>';
    }
  }

  // Buscar CDUF a partir do ESTADO (UF)
  async function buscarCDUF(estado) {
    try {
      if (!estado || estado === '') return null;
      
      const response = await fetch(`/api/estado-cduf/${estado}`);
      if (response.ok) {
        const data = await response.json();
        return data.CDUF;
      }
      return null;
    } catch (err) {
      console.error('Erro ao buscar CDUF:', err);
      return null;
    }
  }

  // Buscar DDD por código IBGE
  async function buscarDDDPorIBGE(codigoMunicipio, cduf) {
    try {
      if (!codigoMunicipio || codigoMunicipio === '' || codigoMunicipio === '0') {
        return null;
      }
      
      const codigoMunicipioNum = parseInt(codigoMunicipio);
      if (isNaN(codigoMunicipioNum) || codigoMunicipioNum <= 0) {
        return null;
      }
      
      // Se não tiver CDUF, tentar obter do estado selecionado
      let cdufNum = cduf;
      if (!cdufNum) {
        const estado = document.getElementById('cidadeEstado')?.value;
        if (estado) {
          cdufNum = await buscarCDUF(estado);
        }
      }
      
      if (!cdufNum) {
        console.warn('[DDD] CDUF não disponível para concatenar com código do município');
        return null;
      }
      
      // Concatenar CDUF (2 dígitos) + Código Município (5 dígitos) = Código IBGE completo (7 dígitos)
      const codigoIBGECompleto = parseInt(`${cdufNum}${String(codigoMunicipioNum).padStart(5, '0')}`);
      
      const response = await fetch(`/api/ddd-por-ibge/${codigoIBGECompleto}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.CDAREADDD) {
          return data.CDAREADDD;
        } else {
          return null;
        }
      }
      return null;
    } catch (err) {
      console.error('[DDD] Erro ao buscar DDD:', err);
      return null;
    }
  }

  // Carregar mesorregiões para filtro por CDUF
  async function loadMesorregioesFiltro(cduf) {
    try {
      const cdufNum = parseInt(cduf);
      if (isNaN(cdufNum) || cdufNum <= 0) {
        const select = document.getElementById('filtroMesoregiao');
        if (select) select.innerHTML = '<option value="">Todas</option>';
        return;
      }
      
      const response = await fetch(`/api/mesorregioes/${cdufNum}`);
      if (!response.ok) {
        const select = document.getElementById('filtroMesoregiao');
        if (select) select.innerHTML = '<option value="">Todas</option>';
        return;
      }
      
      const mesorregioes = await response.json();
      const select = document.getElementById('filtroMesoregiao');
      if (!select) return;
      
      select.innerHTML = '<option value="">Todas</option>';
      if (mesorregioes && mesorregioes.length > 0) {
        mesorregioes.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.CDMESOREGIAO;
          opt.textContent = `${m.CDMESOREGIAO} - ${m.DSMESOREGIAO}`;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('[Filtro] Erro ao carregar mesorregiões:', err);
    }
  }

  // Carregar microrregiões para filtro por CDUF
  async function loadMicrorregioesFiltro(cduf) {
    try {
      const cdufNum = parseInt(cduf);
      if (isNaN(cdufNum) || cdufNum <= 0) {
        const select = document.getElementById('filtroMicroregiao');
        if (select) select.innerHTML = '<option value="">Todas</option>';
        return;
      }
      
      const response = await fetch(`/api/microrregioes/${cdufNum}`);
      if (!response.ok) {
        const select = document.getElementById('filtroMicroregiao');
        if (select) select.innerHTML = '<option value="">Todas</option>';
        return;
      }
      
      const microrregioes = await response.json();
      const select = document.getElementById('filtroMicroregiao');
      if (!select) return;
      
      select.innerHTML = '<option value="">Todas</option>';
      if (microrregioes && microrregioes.length > 0) {
        microrregioes.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.CDMICROREGIAO;
          opt.textContent = `${m.CDMICROREGIAO} - ${m.DSMICROREGIAO}`;
          select.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('[Filtro] Erro ao carregar microrregiões:', err);
    }
  }

  // Funções para controlar overlay de carregamento (mesmo estilo do Gerenciar Roteiros)
  function showLoadingOverlay(titulo = 'Carregando Cidades', texto = 'Por favor, aguarde enquanto carregamos as cidades...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingText = document.getElementById('loadingText');
    if (overlay) {
      if (loadingTitle) {
        loadingTitle.textContent = titulo;
      }
      if (loadingText) {
        loadingText.textContent = texto;
      }
      overlay.style.display = 'flex';
    }
  }
  
  function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    // Mostrar overlay de carregamento (mesmo padrão do Gerenciar Roteiros)
    showLoadingOverlay('Carregando Cidades', 'Por favor, aguarde enquanto carregamos as cidades...');
    
    const params = new URLSearchParams();
    const pais = document.getElementById('filtroPais')?.value;
    const estado = document.getElementById('filtroEstado')?.value;
    const cidade = document.getElementById('filtroCidade')?.value;
    const areaDDD = document.getElementById('filtroAreaDDD')?.value;
    const mesoregiao = document.getElementById('filtroMesoregiao')?.value;
    const microregiao = document.getElementById('filtroMicroregiao')?.value;
    const regiaoFiscal = document.getElementById('filtroRegiaoFiscal')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;
    
    if (pais) params.append('pais', pais);
    if (estado) params.append('estado', estado);
    if (cidade) params.append('cidade', cidade);
    if (areaDDD) params.append('areaDDD', areaDDD);
    if (mesoregiao) params.append('mesoregiao', mesoregiao);
    if (microregiao) params.append('microregiao', microregiao);
    if (regiaoFiscal) params.append('regiaoFiscal', regiaoFiscal);
    if (situacao) params.append('situacao', situacao);
    
    try {
      const response = await fetch(`/api/cidades?${params.toString()}`);
      const cidades = await response.json();

      // Salvar cache de resultados
      lastCidades = cidades;

      // Atualizar contador
      const countEl = document.getElementById('cidadesGridCountText');
      if (countEl) {
        const count = cidades.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(cidades);
        } catch (e) {
        }
      }

      // Auto-inicializar o gridTab quando houver dados
      try {
        if (Array.isArray(cidades) && cidades.length > 0) {
          if (typeof window.GridEditor === 'undefined') {
            // Aguardar um pouco para o dashboard.js carregar
            await new Promise(resolve => setTimeout(resolve, 300));
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(cidades);
            } catch (e) {
            }
          }
        }
      } catch (autoErr) {
        console.error('[Cidades] Erro no fluxo de auto-init:', autoErr);
      }

      // Se openTab é 'grid', tentar auto-inicializar se necessário
      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try {
            await loadScript('/js/grid-editor.js');
          } catch (loadErr) {
            console.warn('[Cidades] erro ao carregar grid-editor para auto-init:', loadErr);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
            try {
              gridTab.render(cidades);
            } catch (e) {
              console.warn('[Cidades] erro ao auto-render gridTab:', e);
            }
          }
        } else {
          const scriptEl = document.querySelector('script[src="/js/grid-editor.js"]');
          if (scriptEl) {
            try {
              const oldSrc = scriptEl.src;
              scriptEl.src = oldSrc + (oldSrc.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now();
              await new Promise(resolve => setTimeout(resolve, 500));
              if (typeof window.GridEditor !== 'undefined' && !gridTab) {
                inicializarGridTab();
                try { gridTab.render(cidades); } catch (e) { console.warn('[Cidades] erro ao render após reload forçado', e); }
              }
            } catch (rbErr) {
              console.warn('[Cidades] falha no reload forçado:', rbErr);
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar cidades.', 'error');
    } finally {
      // Sempre ocultar overlay, mesmo em caso de erro
      hideLoadingOverlay();
    }
  }

  // Renderizar lista
  function renderList(cidades) {
    if (!cidades || cidades.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma cidade encontrada.</p>';
      return;
    }

    list.innerHTML = cidades.map(c => `
      <div class="list-item ${c.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${c.CDCIDADE}">
        <div>
          <strong>${c.CDCIDADE} - ${c.NMCIDADE}</strong>
          <small>
            <strong>Estado:</strong> ${c.ESTADO || 'Não informado'}<br>
            <strong>Status:</strong> ${c.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${c.CDCIDADE}">Editar</button>
          <button class="btn delete" data-id="${c.CDCIDADE}">Excluir</button>
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
          console.error('[Cidades] ID inválido:', id, 'Elemento:', e.currentTarget);
          showMessage('Erro: ID não disponível.', 'error');
          return;
        }
        
        if (e.currentTarget.classList.contains('edit')) {
          loadCidadeParaEdicao(id);
        } else {
          confirmarExclusao(id);
        }
      });
    });
  }

  // Carregar cidade para edição
  async function loadCidadeParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (cidadeForm) {
        cidadeForm.reset();
      }
      
      const response = await fetch(`/api/cidades/${id}`);
      const cidade = await response.json();

      if (cidade) {
        document.getElementById('cidadeId').value = cidade.CDCIDADE;
        document.getElementById('cidadeNome').value = cidade.NMCIDADE;
        document.getElementById('cidadeSituacao').value = cidade.FGACTIVE;
        document.getElementById('formTitle').textContent = 'Editar Cidade';

        // Campos básicos
        document.getElementById('cidadeMunicipio').value = cidade.CDMUNICIPIO || '';
        
        // Se o DDD estiver vazio mas o código IBGE estiver preenchido, tentar buscar automaticamente
        if ((!cidade.CDAREADDD || cidade.CDAREADDD === 0) && cidade.CDMUNICIPIO) {
          const ddd = await buscarDDDPorIBGE(cidade.CDMUNICIPIO, cidade.CDUF);
          if (ddd) {
            document.getElementById('cidadeAreaDDD').value = ddd;
          } else {
            document.getElementById('cidadeAreaDDD').value = '';
          }
        } else {
          document.getElementById('cidadeAreaDDD').value = cidade.CDAREADDD || '';
        }

        // Garante que os estados foram carregados
        if (!estadosCarregados) {
          await loadEstados();
        }

        // Define o valor do estado após garantir que as opções estão carregadas
        const estadoSelect = document.getElementById('cidadeEstado');
        const estadoUF = cidade.ESTADO?.trim().toUpperCase();
        estadoSelect.value = estadoUF;

        // Carrega CDUF e atualiza combos dependentes
        const cduf = cidade.CDUF;
        if (cduf) {
          await Promise.all([
            loadMicrorregioes(cduf),
            loadMesorregioes(cduf)
          ]);
          
          // Define valores dos combos após carregar
          setTimeout(() => {
            if (cidade.CDMICROREGIAO) {
              document.getElementById('cidadeMicroregiao').value = cidade.CDMICROREGIAO;
            }
            if (cidade.CDMESOREGIAO) {
              document.getElementById('cidadeMesoregiao').value = cidade.CDMESOREGIAO;
            }
          }, 300);
        }

        // Carrega regiões fiscais se necessário
        if (!regioesFiscaisCarregadas) {
          await loadRegioesFiscais();
        }
        if (cidade.CDREGIAOFISCAL) {
          document.getElementById('cidadeRegiaoFiscal').value = cidade.CDREGIAOFISCAL;
        }

        // Carrega países se necessário
        if (!paisesCarregados) {
          await loadPaises();
        }
        if (cidade.CDPAIS) {
          document.getElementById('cidadePais').value = cidade.CDPAIS;
        }

        showTab('dados');
      }
    } catch (err) {
      console.error('Erro ao carregar cidade:', err);
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  // Confirmar exclusão
  async function confirmarExclusao(id) {
    if (!id || id === 'null' || id === 'undefined' || id === '') {
      showMessage('Erro: ID não disponível.', 'error');
      return;
    }
    
    const idStr = String(id).trim();
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (!modalMessage || !confirmYes || !confirmNo || !modalEl) {
      return;
    }

    try {
      // Buscar o status atual da cidade
      const idToCheck = isNaN(idStr) ? idStr : parseInt(idStr, 10);
      const response = await fetch(`/api/cidades/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar cidade');
      }
      
      const cidade = await response.json();
      const estaAtivo = cidade.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> esta cidade?<br><br><small style="color: #666;">A cidade ficará inativa e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> esta cidade?<br><br><small style="color: #666;">A cidade voltará a aparecer nas listagens e estará disponível para uso.</small>';
        action = 'activate';
        btnText = 'Reativar';
      }
      
      modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idStr;
      modalEl.dataset.action = action;
      
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      // Atualizar texto do botão de confirmação
      newConfirmYes.textContent = btnText;
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        const idParaExcluir = modalEl.dataset.deleteId || idStr;
        const acao = modalEl.dataset.action || action;
        
        if (!idParaExcluir || idParaExcluir === 'null' || idParaExcluir === 'undefined' || idParaExcluir === '') {
          showMessage('Erro: ID não disponível.', 'error');
          modalEl.style.display = 'none';
          return;
        }
        
        try {
          const response = await fetch(`/api/cidades/${idParaExcluir}?action=${acao}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Cidade reativada com sucesso!' : 'Cidade desativada com sucesso!'), 'success');
            showTab('grid');
            await applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da cidade.', 'error');
          }
        } catch (err) {
          console.error('[Cidades] Erro ao alterar status:', err);
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
      console.error('[Cidades] Erro ao buscar status da cidade:', err);
      showMessage('Erro ao verificar status da cidade.', 'error');
    }
  }

  // Salvar formulário
  cidadeForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = document.getElementById('cidadeId')?.value; // ID da cidade para edição
    const estado = document.getElementById('cidadeEstado')?.value;
    const nome = document.getElementById('cidadeNome')?.value.trim();
    const situacao = document.getElementById('cidadeSituacao')?.value;
    
    // Novos campos
    const pais = document.getElementById('cidadePais')?.value;
    const municipio = document.getElementById('cidadeMunicipio')?.value;
    const areaDDD = document.getElementById('cidadeAreaDDD')?.value;
    const microregiao = document.getElementById('cidadeMicroregiao')?.value;
    const mesoregiao = document.getElementById('cidadeMesoregiao')?.value;
    const regiaoFiscal = document.getElementById('cidadeRegiaoFiscal')?.value;
    
    if (!estado || !nome || !situacao || !municipio) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    // Buscar CDUF do estado selecionado
    const cduf = await buscarCDUF(estado);
    if (!cduf) {
      showMessage('Erro ao buscar código do estado. Tente novamente.', 'error');
      return;
    }

    try {
      const cidadeData = { 
        ESTADO: estado, 
        NMCIDADE: nome, 
        FGACTIVE: situacao,
        CDPAIS: pais && pais !== '' ? parseInt(pais, 10) : null,
        CDUF: cduf,
        CDMUNICIPIO: parseInt(municipio, 10),
        CDAREADDD: areaDDD && areaDDD !== '' ? parseInt(areaDDD, 10) : null,
        CDMICROREGIAO: microregiao && microregiao !== '' ? parseInt(microregiao, 10) : null,
        CDMESOREGIAO: mesoregiao && mesoregiao !== '' ? parseInt(mesoregiao, 10) : null,
        CDREGIAOFISCAL: regiaoFiscal && regiaoFiscal !== '' ? parseInt(regiaoFiscal, 10) : null
      };

      let response;
      if (id) {
        // Atualização
        response = await fetch(`/api/cidades/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cidadeData)
        });
      } else {
        // Inclusão
        response = await fetch('/api/cidades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cidadeData)
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
  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await applyFilters('grid');
  });


  // Event listener para mudança de estado no filtro - carregar combos dependentes
  document.getElementById('filtroEstado')?.addEventListener('change', async (e) => {
    const estado = e.target.value;
    if (estado) {
      const cduf = await buscarCDUF(estado);
      if (cduf) {
        await Promise.all([
          loadMesorregioesFiltro(cduf),
          loadMicrorregioesFiltro(cduf)
        ]);
      } else {
        document.getElementById('filtroMesoregiao').innerHTML = '<option value="">Todas</option>';
        document.getElementById('filtroMicroregiao').innerHTML = '<option value="">Todas</option>';
      }
    } else {
      document.getElementById('filtroMesoregiao').innerHTML = '<option value="">Todas</option>';
      document.getElementById('filtroMicroregiao').innerHTML = '<option value="">Todas</option>';
    }
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.getElementById('filtroPais').value = '';
    document.getElementById('filtroEstado').value = '';
    document.getElementById('filtroCidade').value = '';
    document.getElementById('filtroAreaDDD').value = '';
    document.getElementById('filtroMesoregiao').innerHTML = '<option value="">Todas</option>';
    document.getElementById('filtroMicroregiao').innerHTML = '<option value="">Todas</option>';
    document.getElementById('filtroRegiaoFiscal').value = '';
    document.getElementById('filtroSituacao').value = '';
  });

  // Inicializar GridEditor
  function inicializarGridTab() {
    // GridEditor já é carregado globalmente pelo dashboard.js
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Cidades] GridEditor não está disponível');
      return;
    }
    
    gridTab = new window.GridEditor({
      container: '#cidadesGrid',
      columns: [
        { field: 'CDCIDADE', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'ESTADO', header: 'UF', editable: false, width: '60px' },
        { field: 'NMCIDADE', header: 'Cidade', editable: false, type: 'text' },
        { field: 'CDAREADDD', header: 'DDD', editable: false, width: '60px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '110px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/cidades',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição (mesmo comportamento da lista)
      onBeforeEdit: async (id) => {
        await loadCidadeParaEdicao(id);
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
        if (lastCidades) {
          const idx = lastCidades.findIndex(r => String(r.CDCIDADE) === String(id));
          if (idx !== -1) lastCidades[idx] = { ...lastCidades[idx], ...{} };
        }
      }
    });
  }

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    cidadeForm?.reset();
    document.getElementById('cidadeId').value = '';
    // Limpar campos
    document.getElementById('cidadeMunicipio').value = '';
    // Limpar combos
    document.getElementById('cidadeMicroregiao').innerHTML = '<option value="">Selecione</option>';
    document.getElementById('cidadeMesoregiao').innerHTML = '<option value="">Selecione</option>';
    // Recarregar regiões fiscais se necessário
    if (!regioesFiscaisCarregadas) {
      loadRegioesFiscais();
    } else {
      document.getElementById('cidadeRegiaoFiscal').value = '';
    }
    // Recarregar países se necessário
    if (!paisesCarregados) {
      loadPaises();
    } else {
      document.getElementById('cidadePais').value = '';
    }
    document.getElementById('formTitle').textContent = 'Nova Cidade';
    showTab('dados');
  });
  // Função para buscar e preencher DDD
  async function buscarEPreencherDDD() {
    const codigoMunicipio = document.getElementById('cidadeMunicipio')?.value;
    const estado = document.getElementById('cidadeEstado')?.value;
    const campoDDD = document.getElementById('cidadeAreaDDD');
    const btnBuscar = document.getElementById('btnBuscarDDD');
    
    if (!codigoMunicipio || codigoMunicipio === '0' || codigoMunicipio === '') {
      showMessage('Por favor, informe o Código IBGE primeiro.', 'error');
      return;
    }
    
    if (!estado) {
      showMessage('Por favor, selecione o Estado primeiro para buscar o DDD.', 'error');
      return;
    }
    
    if (!campoDDD) {
      console.error('[DDD] Campo DDD não encontrado');
      return;
    }
    
    // Desabilitar botão durante a busca
    if (btnBuscar) {
      btnBuscar.disabled = true;
      btnBuscar.textContent = 'Buscando...';
    }
    
    try {
      // Buscar CDUF do estado
      const cduf = await buscarCDUF(estado);
      if (!cduf) {
        showMessage('Erro ao buscar código do estado. Tente novamente.', 'error');
        return;
      }
      
      const ddd = await buscarDDDPorIBGE(codigoMunicipio, cduf);
      if (ddd) {
        campoDDD.value = ddd;
        showMessage(`DDD encontrado: ${ddd}`, 'success');
      } else {
        showMessage('DDD não encontrado para este código IBGE. Preencha manualmente.', 'error');
      }
    } catch (err) {
      console.error('[DDD] Erro ao buscar DDD:', err);
      showMessage('Erro ao buscar DDD. Tente novamente.', 'error');
    } finally {
      // Reabilitar botão
      if (btnBuscar) {
        btnBuscar.disabled = false;
        btnBuscar.textContent = '🔍 Buscar';
      }
    }
  }

  // Event listener para o botão de buscar DDD
  document.getElementById('btnBuscarDDD')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await buscarEPreencherDDD();
  });

  // Event listener para mudança de estado - carregar combos dependentes
  document.getElementById('cidadeEstado')?.addEventListener('change', async (e) => {
    const estado = e.target.value;
    if (estado) {
      const cduf = await buscarCDUF(estado);
      if (cduf) {
        await Promise.all([
          loadMicrorregioes(cduf),
          loadMesorregioes(cduf)
        ]);
      } else {
        document.getElementById('cidadeMicroregiao').innerHTML = '<option value="">Selecione</option>';
        document.getElementById('cidadeMesoregiao').innerHTML = '<option value="">Selecione</option>';
      }
    } else {
      document.getElementById('cidadeMicroregiao').innerHTML = '<option value="">Selecione</option>';
      document.getElementById('cidadeMesoregiao').innerHTML = '<option value="">Selecione</option>';
    }
  });

  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    cidadeForm?.reset();
    document.getElementById('cidadeId').value = '';
    // Limpar campos readonly
    document.getElementById('cidadeMunicipio').value = '';
    // Limpar combos
    document.getElementById('cidadeMicroregiao').innerHTML = '<option value="">Selecione</option>';
    document.getElementById('cidadeMesoregiao').innerHTML = '<option value="">Selecione</option>';
    // Recarregar regiões fiscais se necessário
    if (!regioesFiscaisCarregadas) {
      loadRegioesFiscais();
    } else {
      document.getElementById('cidadeRegiaoFiscal').value = '';
    }
    // Recarregar países se necessário
    if (!paisesCarregados) {
      loadPaises();
    } else {
      document.getElementById('cidadePais').value = '';
    }
    document.getElementById('formTitle').textContent = 'Nova Cidade';
    showTab('dados');
  });
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

  // Event listeners para os botões das abas
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      if (tabId) {
        showTab(tabId);
      }
    });
  });

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