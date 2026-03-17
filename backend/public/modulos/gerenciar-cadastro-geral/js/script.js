// backend/public/modulos/gerenciar-cadastro-geral/js/script.js
// Gerenciar Cadastro Geral - Frontend
// Versão: 1.1 - Com Classes de Frota
// Atlas Cargo
// Data: 2026-04-05
// i18n: helper t() e chaves web.modulos.cadastroGeral
// Tudo dentro do IIFE para evitar "Identifier 't' has already been declared" ao trocar de módulo

(function() {
  console.log('[CadastroGeral] script.js IIFE iniciado');
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);

  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const cadastroForm = document.getElementById('cadastroForm');
  const list = document.getElementById('cadastrosList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let estadosCarregados = false;
  let cidades = [];
  let gridTab = null;
  let lastCadastros = null;
  let sqlExecutado = false;
  let initExecutado = false;
  let contextoCadastro = { pais: 'BR', tipoDocFisica: 'CPF', tipoDocJuridica: 'CNPJ' };

  /** Tipos de cadastro que exibem a aba "Locais preferidos" (convocações/divulgação de cargas). */
  const TIPOS_COMPATIVEIS_ENVIO = ['M'];
  function temTipoCompativelEnvio(cadastroOrFlags) {
    if (!cadastroOrFlags) return false;
    return TIPOS_COMPATIVEIS_ENVIO.some(cod => cadastroOrFlags['FGMOTORISTA'] === true || cadastroOrFlags['FGMOTORISTA'] === 'S');
  }
  function atualizarVisibilidadeLocaisPreferidos() {
    const chkM = document.getElementById('chkM');
    const ehMotorista = chkM ? chkM.checked : false;
    const tabBtn = document.getElementById('tabBtnLocaisPreferidos');
    const divDestinoPreferido = document.getElementById('divDestinoPreferido');
    if (tabBtn) tabBtn.style.display = ehMotorista ? 'inline-flex' : 'none';
    if (divDestinoPreferido) divDestinoPreferido.style.display = 'none';
  }

  async function loadContextoCadastro() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      contextoCadastro = d;
      updateLabelDocumento();
    } catch (e) {
      console.warn('[Cadastro Geral] Erro ao carregar contexto:', e);
    }
  }
  function updateLabelDocumento() {
    const lb = document.getElementById('labelCadastroCGCCPF');
    if (lb) lb.textContent = (contextoCadastro.tipoDocFisica || 'CPF') + ' / ' + (contextoCadastro.tipoDocJuridica || 'CNPJ') + ' *';
  }

  /**
   * Headers de autenticação para APIs que exigem usuário (SGUSER / user-login).
   * Evita 401 ao salvar cadastro, classes de frota, excluir, etc.
   */
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
      await window.executarInitSQLPadrao('/modulos/gerenciar-cadastro-geral/sql/init.sql', '/api/cadastros-gerais/executar-init-sql', 'cadastro-geral');
      return;
    }
    
    // Fallback: aguardar um pouco e tentar novamente (pode estar carregando)
    await new Promise(resolve => setTimeout(resolve, 500));
    if (typeof window.executarInitSQLPadrao === 'function') {
      await window.executarInitSQLPadrao('/modulos/gerenciar-cadastro-geral/sql/init.sql', '/api/cadastros-gerais/executar-init-sql', 'cadastro-geral');
      return;
    }
    
    // Se ainda não estiver disponível, log de aviso
    console.warn('[Cadastro Geral] executarInitSQLPadrao não disponível. Verifique se init-overlay-helper.js está carregado.');
  }

  // Funções para controlar overlay de carregamento (mesmo estilo do Gerenciar Roteiros)
  function showLoadingOverlay(titulo = 'Carregando Cadastros', texto = 'Por favor, aguarde enquanto carregamos os cadastros...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadingTitle = document.getElementById('loadingTitle');
    const loadingText = document.getElementById('loadingText');
    
    if (overlay && loadingTitle && loadingText) {
      loadingTitle.textContent = titulo;
      loadingText.textContent = texto;
      overlay.style.display = 'flex';
    }
  }

  function hideLoadingOverlay() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Função auxiliar para garantir que filtroEstado está preenchido
  async function garantirFiltroEstadoPreenchido() {
    const tabFiltros = document.getElementById('tab-filtros');
    if (!tabFiltros) {
      // Se a aba não existe, aguardar e tentar novamente
      await new Promise(resolve => setTimeout(resolve, 300));
      return;
    }
    
    // Garantir que a aba está visível
    tabFiltros.style.display = 'block';
    tabFiltros.classList.add('active');
    
    // Aguardar renderização múltiplas vezes
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Tentar encontrar o elemento várias vezes
    let filtroEstado = null;
    for (let i = 0; i < 5; i++) {
      filtroEstado = tabFiltros.querySelector('#filtroEstado');
      if (!filtroEstado) {
        filtroEstado = document.getElementById('filtroEstado');
      }
      if (filtroEstado) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    // Se encontrou e está vazio, preencher
    if (filtroEstado) {
      if (filtroEstado.options.length <= 1) {
        estadosCarregados = false;
        await loadEstados();
        
        // Aguardar e verificar novamente
        await new Promise(resolve => setTimeout(resolve, 400));
        await new Promise(resolve => requestAnimationFrame(resolve));
        
        const check = tabFiltros.querySelector('#filtroEstado') || document.getElementById('filtroEstado');
        if (check && check.options.length <= 1) {
          estadosCarregados = false;
          await loadEstados();
        }
      }
    } else {
      // Se não encontrou o elemento, tentar carregar mesmo assim
      estadosCarregados = false;
      await loadEstados();
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
    
    // Carregar países da tabela PAIS para os combos
    loadPaises().catch(err => console.warn('[Cadastro Geral] Erro ao carregar países:', err));
    
    // Mostrar aba de filtros primeiro
    await showTab('filtros');
    
    // Executar init.sql em background (não bloqueia)
    executarInitSQL().catch(err => {
      console.error('[Cadastro Geral] Erro ao executar init.sql:', err.message || err);
    });
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
    const tabContent = document.getElementById(`tab-${tabId}`);
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (!tabContent || !tabBtn) return;
    // Fechar modal de confirmação ao trocar de aba para não mostrar mensagem de outra aba (ex.: "excluir local" na aba Validades)
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal) confirmModal.style.display = 'none';
    const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
    if (container) {
      container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
      container.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
        content.style.display = 'none';
      });
    }
    tabBtn.classList.add('active');
    tabContent.classList.add('active');
    tabContent.style.display = 'block';
    
    // Aguardar um frame para garantir que a mudança foi renderizada
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Se for a aba de grid, inicializar o GridEditor
    if (tabId === 'grid') {
      try {
        if (typeof window.GridEditor === 'undefined') {
          try { await loadScript('/js/grid-editor.js'); } catch (e) { console.warn('[Cadastros] falha ao carregar GridEditor:', e); }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) inicializarGridTab();
          if (gridTab && lastCadastros && lastCadastros.length > 0) {
            const cadastrosComCidade = lastCadastros.map(c => {
              if (c.CIDADE) return c; // Já tem o campo
              const estado = c.CIDADE_ESTADO || '';
              const cidade = c.CIDADE_NOME || '';
              const cidadeFormatada = `${estado} - ${cidade}`.trim();
              return {
                ...c,
                CIDADE: cidadeFormatada === '-' ? 'Não informado' : cidadeFormatada,
                TIPO_E_CADASTRO: `${(c.RZSOCIAL || '').trim()} — ${(c.FGTIPOCADASTRO_NOME || '').trim()}`.replace(/^ — | — $/g, '').trim() || '-'
              };
            });
            // Garantir TIPO_E_CADASTRO em todos os itens (quando CIDADE já vinha preenchido)
            cadastrosComCidade.forEach(c => {
              if (c.TIPO_E_CADASTRO) return;
              c.TIPO_E_CADASTRO = `${(c.RZSOCIAL || '').trim()} — ${(c.FGTIPOCADASTRO_NOME || '').trim()}`.replace(/^ — | — $/g, '').trim() || '-';
            });
            try {
              gridTab.render(cadastrosComCidade);
            } catch (e) {
              console.error('[Cadastros] erro ao renderizar grid na aba:', e);
            }
          }
          // NÃO aplicar filtros automaticamente - usuário deve aplicar manualmente
        }
      } catch (gridErr) {
        console.warn('[Cadastros] Erro ao processar grid:', gridErr);
        // Continuar mesmo se houver erro - não bloquear mudança de aba
      }
    }
    
    // Se for a aba de filtros, garantir que o filtroEstado está carregado
    if (tabId === 'filtros') {
      // Aguardar para garantir que a aba está visível (display: block)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Usar requestAnimationFrame para garantir que o navegador renderizou a aba
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      const filtroEstado = document.getElementById('filtroEstado');
      const cadastroEstado = document.getElementById('cadastroEstado');
      
      // Verificar se os campos estão vazios (apenas com a opção padrão)
      const precisaRecarregar = 
        (!filtroEstado || filtroEstado.options.length <= 1) ||
        (!cadastroEstado || cadastroEstado.options.length <= 1);
      
      if (precisaRecarregar) {
        await loadEstados();
        
        // Aguardar múltiplos frames para garantir renderização completa
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar novamente se os campos ainda estão vazios
        const filtroEstadoCheck = document.getElementById('filtroEstado');
        const cadastroEstadoCheck = document.getElementById('cadastroEstado');
        
        const aindaPrecisaRecarregar = 
          (!filtroEstadoCheck || filtroEstadoCheck.options.length <= 1) ||
          (!cadastroEstadoCheck || cadastroEstadoCheck.options.length <= 1);
        
        if (aindaPrecisaRecarregar) {
          await loadEstados();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Forçar reflow múltiplas vezes para garantir renderização
        const elementos = [filtroEstado, cadastroEstado].filter(Boolean);
        elementos.forEach(el => {
          void el.offsetHeight;
          void el.offsetWidth;
        });
      }
      
      // Carregar transportadores para o filtro
      const filtroTransportador = document.getElementById('filtroTransportador');
      if (filtroTransportador && filtroTransportador.options.length <= 1) {
        await loadTransportadores();
      }
    }
    
    // Se for a aba de dados, carregar contexto (label doc por país) e aplicar máscara
    if (tabId === 'dados') {
      loadContextoCadastro();
      setTimeout(() => {
        aplicarMascaraCPFCNPJ();
      }, 100);
      // Listener do País (uma vez): atualizar label documento, DDI, estado/cidade
      const paisEl = document.getElementById('cadastroPais');
      if (paisEl && !paisEl.hasAttribute('data-pais-listener')) {
        paisEl.setAttribute('data-pais-listener', '1');
        paisEl.addEventListener('change', async function() {
          const v = (this.value || '').trim();
          let sigla = (v && !/^\d+$/.test(v)) ? v : (listaPaisesCache.find(p => String(p.CDPAIS) === v)?.SGPAIS || v);
          if (sigla && sigla.length > 2) {
            const u = sigla.toUpperCase();
            if (u === 'PARAGUAI') sigla = 'PY'; else if (u === 'BRASIL') sigla = 'BR'; else if (u === 'ARGENTINA') sigla = 'AR'; else if (u === 'URUGUAI') sigla = 'UY';
          }
          if (v) {
            contextoCadastro.pais = (sigla && sigla.length === 2) ? sigla.toUpperCase() : sigla;
            const tipos = { BR: { tipoDocFisica: 'CPF', tipoDocJuridica: 'CNPJ' }, PY: { tipoDocFisica: 'CI', tipoDocJuridica: 'RUC' }, AR: { tipoDocFisica: 'DNI', tipoDocJuridica: 'CUIT' }, UY: { tipoDocFisica: 'CI', tipoDocJuridica: 'RUT' } };
            const t = tipos[(contextoCadastro.pais || '').toUpperCase()] || tipos.BR;
            contextoCadastro.tipoDocFisica = t.tipoDocFisica;
            contextoCadastro.tipoDocJuridica = t.tipoDocJuridica;
            // País e DDI são independentes (ex.: morar no Paraguai e ter telefone Brasil). Não alterar DDI ao trocar País.
          } else {
            loadContextoCadastro();
          }
          updateLabelDocumento();
          estadosCarregados = false;
          await loadEstados(v || null);
          const estadoEl = document.getElementById('cadastroEstado');
          const cidadeEl = document.getElementById('cadastroCidade');
          if (estadoEl) estadoEl.value = '';
          if (cidadeEl) { cidadeEl.innerHTML = '<option value="">Selecione um estado primeiro</option>'; cidadeEl.value = ''; }
          document.getElementById('cadastroCodigoCidade').value = '';
        });
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

  // Inicializar GridEditor
  function inicializarGridTab() {
    // GridEditor já é carregado globalmente pelo dashboard.js
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Cadastros] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#cadastrosGrid',
      columns: [
        { field: 'CDCADASTRO', header: 'Código', editable: false, isId: true, width: '80px' },
        { field: 'TIPO_E_CADASTRO', header: 'Tipo & Cadastro', editable: false, width: '260px' },
        {
          field: 'CIDADE',
          header: 'Cidade',
          editable: false,
          width: '180px',
          format: (val) => val || 'Não informado'
        },
        {
          field: 'NRCELULAR',
          header: 'Celular',
          width: '130px',
          editable: true,
          type: 'text',
          maxlength: 15,
          format: (val) => {
            if (!val) return '-';
            const numeroLimpo = String(val).replace(/\D/g, '');
            if (!numeroLimpo || numeroLimpo.length < 10) return val;
            let numeroFormatado = numeroLimpo;
            if (numeroLimpo.length === 11) {
              numeroFormatado = `(${numeroLimpo.substring(0, 2)}) ${numeroLimpo.substring(2, 7)}-${numeroLimpo.substring(7)}`;
            } else if (numeroLimpo.length === 10) {
              numeroFormatado = `(${numeroLimpo.substring(0, 2)}) ${numeroLimpo.substring(2, 6)}-${numeroLimpo.substring(6)}`;
            }
            return numeroFormatado;
          }
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/cadastros-gerais',
      // Ações customizadas: botão do WhatsApp
      customActions: (row) => {
        const celular = row.NRCELULAR;
        if (!celular) return '';
        const numeroLimpo = String(celular).replace(/\D/g, '');
        if (!numeroLimpo || numeroLimpo.length < 10) return '';
        // NRCELULAR já é gravado com DDI (ex.: 5545999999999 ou 595981123456); usar como está
        const numWa = numeroLimpo.length >= 12 ? numeroLimpo : ('55' + numeroLimpo);
        const whatsappLink = `https://wa.me/${numWa}`;
        return `<a href="${whatsappLink}" target="_blank" rel="noopener noreferrer" class="btn grid-btn-whatsapp" title="Abrir WhatsApp">💬</a>`;
      },
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição
      onBeforeEdit: async (id) => {
        await loadCadastroParaEdicao(id);
        return false; // cancelar o modo de edição inline
      },
      // Garantir que a exclusão use o mesmo fluxo/modal da lista
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') return;
        try {
          await confirmarExclusao(id);
        } catch (err) {
          console.error('[Cadastros] Erro no onDelete da grid:', err);
          showMessage(t('web.modulos.cadastroGeral.erroConexao') || 'Erro ao abrir confirmação.', 'error');
        }
      },
      onAfterEdit: (id) => {
        showMessage('Alteração salva com sucesso!', 'success');
        // atualizar cache local mantendo sincronia
        if (lastCadastros) {
          const idx = lastCadastros.findIndex(r => String(r.CDCADASTRO) === String(id));
          if (idx !== -1) lastCadastros[idx] = { ...lastCadastros[idx], ...{} };
        }
      }
    });
  }

  // Resolver valor do combo País (sigla ou CDPAIS) para CDPAIS numérico
  function getCdPaisFromPaisValue(val) {
    if (val == null || val === '') return null;
    const v = String(val).trim();
    const n = parseInt(v, 10);
    if (!isNaN(n) && String(n) === v) return n;
    if (!listaPaisesCache || listaPaisesCache.length === 0) return null;
    const p = listaPaisesCache.find(x =>
      (String(x.SGPAIS || '').toUpperCase() === v.toUpperCase()) ||
      (String(x.CDPAIS || '') === v)
    );
    return p ? (p.CDPAIS != null ? Number(p.CDPAIS) : null) : null;
  }

  // Carregar estados pelo país selecionado (tabela ESTADO, respeitando país)
  async function loadEstados(cdpaisOuSiglaForcado) {
    try {
      const paisVal = cdpaisOuSiglaForcado != null
        ? cdpaisOuSiglaForcado
        : (document.getElementById('cadastroPais')?.value || '').trim();
      const cdpais = paisVal === '' ? 1 : (getCdPaisFromPaisValue(paisVal) ?? 1);

      const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados') + '?cdpais=' + encodeURIComponent(cdpais);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Erro ao buscar estados');
      const estados = await response.json();
      const lista = Array.isArray(estados) ? estados : [];

      const fillEstados = async (id, defaultText = 'Selecione') => {
        let el = null;
        for (let tentativa = 0; tentativa < 5; tentativa++) {
          el = document.getElementById(id);
          if (!el) {
            const tabFiltros = document.getElementById('tab-filtros');
            const tabDados = document.getElementById('tab-dados');
            if (id === 'filtroEstado' && tabFiltros) el = tabFiltros.querySelector(`#${id}`);
            else if (id === 'cadastroEstado' && tabDados) el = tabDados.querySelector(`#${id}`);
          }
          if (el) break;
          if (tentativa < 4) await new Promise(r => setTimeout(r, 150));
        }
        if (!el) return false;
        el.innerHTML = `<option value="">${defaultText}</option>`;
        if (lista.length > 0) {
          lista.forEach(e => {
            const sigla = (e.ESTADO || e.estado || e.uf || '').trim();
            const nome = (e.NMESTADO || e.nmestado || e.nome || '').trim();
            if (!sigla) return;
            const opt = document.createElement('option');
            opt.value = sigla;
            opt.textContent = nome ? `${sigla} - ${nome}` : sigla;
            el.appendChild(opt);
          });
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      };

      // Preencher campos com retry - sempre tentar preencher, mesmo que já tenha opções
      let filtroPreenchido = false;
      let cadastroPreenchido = false;
      
      // Tentar preencher várias vezes se necessário
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        // Sempre tentar preencher, não importa se já tem opções
        filtroPreenchido = await fillEstados('filtroEstado', 'Todos');
        cadastroPreenchido = await fillEstados('cadastroEstado', 'Selecione');
        
        // Verificar se realmente preencheu (tem mais de 1 opção)
        // Buscar dentro da aba de filtros primeiro
        const tabFiltros = document.getElementById('tab-filtros');
        let filtroCheck = null;
        if (tabFiltros) {
          filtroCheck = tabFiltros.querySelector('#filtroEstado');
        }
        if (!filtroCheck) {
          filtroCheck = document.getElementById('filtroEstado');
        }
        
        const cadastroCheck = document.getElementById('cadastroEstado');
        
        const filtroOk = filtroCheck && filtroCheck.options.length > 1;
        const cadastroOk = cadastroCheck && cadastroCheck.options.length > 1;
        
        if (filtroOk && cadastroOk) {
          estadosCarregados = true;
          return;
        }
        
        // Se não conseguiu, aguardar um pouco antes de tentar novamente
        if (tentativa < 4) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }
      
      // Se chegou aqui, pelo menos um não foi preenchido
      // Tentar uma última vez após mais um delay
      await new Promise(resolve => setTimeout(resolve, 500));
      await new Promise(resolve => requestAnimationFrame(resolve));
      await fillEstados('filtroEstado', 'Todos');
      await fillEstados('cadastroEstado', 'Selecione');
      
      // Verificar novamente
      const tabFiltrosFinal = document.getElementById('tab-filtros');
      let filtroFinal = null;
      if (tabFiltrosFinal) {
        filtroFinal = tabFiltrosFinal.querySelector('#filtroEstado');
      }
      if (!filtroFinal) {
        filtroFinal = document.getElementById('filtroEstado');
      }
      
      const cadastroFinal = document.getElementById('cadastroEstado');
      if (filtroFinal && filtroFinal.options.length > 1 && 
          cadastroFinal && cadastroFinal.options.length > 1) {
        estadosCarregados = true;
      }

    } catch (err) {
      showMessage('Erro ao carregar estados. Verifique a conexão.', 'error');
    }
  }


  // Carregar cidades por estado
  async function loadCidadesPorEstado(estado, tipo = 'dados') {
    if (!estado) return;
    try {
      const response = await fetch(`/api/cidades?estado=${encodeURIComponent(estado)}`);
      const data = await response.json();
      const cidadesData = Array.isArray(data) ? data : [];
      if (!response.ok) {
        console.error('Erro ao carregar cidades:', data?.error || response.status);
        if (tipo === 'dados') showMessage('Erro ao carregar cidades.', 'error');
        return;
      }
      if (tipo === 'dados') {
        cidades = cidadesData;
        const cidadeSelect = document.getElementById('cadastroCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidadesData.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE || '';
            cidadeSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar cidades:', err);
      showMessage('Erro ao carregar cidades. Verifique a conexão.', 'error');
    }
  }

  // Formatar CPF/CNPJ
  function formatarCPFCNPJ(cpfCnpj) {
    if (!cpfCnpj) return '';
    const value = String(cpfCnpj).replace(/\D/g, '');
    if (value.length === 0) return '';
    
    // CPF: 000.000.000-00 (11 dígitos)
    if (value.length <= 11) {
      if (value.length <= 3) return value;
      if (value.length <= 6) return value.replace(/(\d{3})(\d+)/, '$1.$2');
      if (value.length <= 9) return value.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');
      return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    } 
    // CNPJ: 00.000.000/0000-00 (14 dígitos)
    else {
      if (value.length <= 2) return value;
      if (value.length <= 5) return value.replace(/(\d{2})(\d+)/, '$1.$2');
      if (value.length <= 8) return value.replace(/(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
      if (value.length <= 12) return value.replace(/(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3/$4');
      return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
    }
  }

  // Aplicar máscara de documento conforme país (BR = CPF/CNPJ formatado; outros = só dígitos, max 14)
  function aplicarMascaraCPFCNPJ() {
    const campo = document.getElementById('cadastroCGCCPF');
    if (!campo || campo.hasAttribute('data-mask-applied')) return;
    campo.setAttribute('data-mask-applied', 'true');
    const isBR = () => (contextoCadastro && contextoCadastro.pais === 'BR');
    campo.addEventListener('input', function(e) {
      let value = e.target.value.replace(/\D/g, '');
      if (value.length > 14) value = value.substring(0, 14);
      e.target.value = isBR() ? formatarCPFCNPJ(value) : value;
    });
    campo.addEventListener('paste', function(e) {
      setTimeout(() => {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 14) value = value.substring(0, 14);
        e.target.value = isBR() ? formatarCPFCNPJ(value) : value;
      }, 10);
    });
  }

  // DDI conhecidos (ordem: mais longos primeiro para extrair corretamente)
  const DDI_LIST = ['595', '593', '591', '598', '58', '57', '56', '55', '54', '51'];
  function parseCelularE164(nrCelular) {
    if (!nrCelular) return { ddi: '55', numero: '' };
    const raw = String(nrCelular).replace(/\D/g, '');
    for (const ddi of DDI_LIST) {
      if (raw.startsWith(ddi) && raw.length > ddi.length) {
        return { ddi, numero: raw.substring(ddi.length) };
      }
    }
    if (raw.length >= 10) return { ddi: '55', numero: raw };
    return { ddi: '55', numero: raw };
  }
  // Máscaras de celular por país (BR, AR, PY, UY) – mesmo padrão do app motorista
  function formatarCelularPorDdi(ddi, raw) {
    const d = String(ddi || '').trim();
    let v = String(raw || '').replace(/\D/g, '');
    if (d === '55') {
      v = v.slice(0, 11);
      if (v.length <= 4) return v;
      if (v.length <= 8) return v.replace(/(\d{4})(\d+)/, '$1-$2');
      return v.replace(/(\d{2})(\d)(\d{4})(\d{4})/, '($1) $2$3-$4');
    }
    if (d === '54') {
      v = v.slice(0, 12);
      if (v.length <= 1) return v;
      if (v.length <= 4) return v.replace(/(\d)(\d{1,3})/, '$1 $2');
      if (v.length <= 7) return v.replace(/(\d)(\d{2,3})(\d{0,3})/, '$1 $2 $3');
      return v.replace(/(\d)(\d{2,3})(\d{3})(\d{0,4})/, '$1 $2 $3-$4');
    }
    if (d === '595') {
      v = v.slice(0, 9);
      if (v.length <= 3) return v;
      if (v.length <= 6) return v.replace(/(\d{3})(\d+)/, '$1 $2');
      return v.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3');
    }
    if (d === '598') {
      v = v.slice(0, 8);
      if (v.length <= 4) return v;
      return v.replace(/(\d{4})(\d+)/, '$1 $2');
    }
    v = v.slice(0, 15);
    return v;
  }
  function validarCelularPorDdi(ddi, raw) {
    const v = String(raw || '').replace(/\D/g, '');
    const d = String(ddi || '').trim();
    if (d === '55') return v.length >= 10 && v.length <= 11 && /^[1-9]\d{1,2}9\d{8}$/.test(v);
    if (d === '54') return v.length >= 10 && v.length <= 12 && v.charAt(0) === '9';
    if (d === '595') return v.length >= 8 && v.length <= 9; // Paraguai: 8 ou 9 dígitos (celular costuma começar com 9, mas aceita qualquer)
    if (d === '598') return v.length === 8 && v.charAt(0) === '9';
    return v.length >= 8;
  }
  function formatarCelular(celular, ddi) {
    const value = String(celular || '').replace(/\D/g, '');
    if (ddi) return formatarCelularPorDdi(ddi, value);
    if (value.length === 11) return value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
    if (value.length === 10) return value.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    return value;
  }

  // Validar email
  function validarEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // Buscar CEP
  async function buscarCEP() {
    const cepInput = document.getElementById('cadastroCEP');
    const cep = cepInput.value.replace(/\D/g, '');
    
    if (cep.length !== 8) {
      showMessage('CEP inválido. Digite 8 dígitos.', 'error');
      return;
    }
    
    try {
      const response = await fetch(`/api/cep/${cep}`);
      const dados = await response.json();
      
      if (response.ok) {
        document.getElementById('cadastroEndereco').value = dados.logradouro || '';
        document.getElementById('cadastroBairro').value = dados.bairro || '';
        
        if (dados.uf) {
          // Preencher estado
          document.getElementById('cadastroEstado').value = dados.uf;
          
          // Carregar cidades para o estado
          await loadCidadesPorEstado(dados.uf, 'dados');
          
          // Encontrar e preencher cidade
          if (dados.localidade) {
            setTimeout(() => {
              const cidadeSelect = document.getElementById('cadastroCidade');
              const options = Array.from(cidadeSelect.options);
              const cidadeEncontrada = options.find(opt => 
                opt.text.toLowerCase() === dados.localidade.toLowerCase()
              );
              
              if (cidadeEncontrada) {
                cidadeSelect.value = cidadeEncontrada.value;
                document.getElementById('cadastroCodigoCidade').value = cidadeEncontrada.value;
              } else {
                // Se a cidade não estiver cadastrada, limpar os campos
                cidadeSelect.value = '';
                document.getElementById('cadastroCodigoCidade').value = '';
              }
            }, 100);
          }
        } else {
          // Limpar campos se não houver UF
          document.getElementById('cadastroEstado').value = '';
          document.getElementById('cadastroCidade').innerHTML = '<option value="">Selecione um estado primeiro</option>';
          document.getElementById('cadastroCodigoCidade').value = '';
        }
        
        showMessage('CEP encontrado com sucesso!', 'success');
      } else {
        showMessage(dados.error || 'CEP não encontrado.', 'error');
      }
    } catch (err) {
      console.error('Erro ao buscar CEP:', err);
      showMessage('Erro ao buscar CEP. Tente novamente.', 'error');
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    // Garantir que o overlay do init.sql está escondido antes de mostrar o overlay dos filtros
    hideLoadingOverlayInitSQL();
    
    // Mostrar overlay de carregamento (mesmo padrão do Gerenciar Roteiros)
    showLoadingOverlay('Carregando Cadastros', 'Por favor, aguarde enquanto carregamos os cadastros...');

    try {
      const params = new URLSearchParams();
      const codigo = document.getElementById('filtroCodigo')?.value;
      const cgccpf = document.getElementById('filtroCGCCPF')?.value;
      const razaoSocial = document.getElementById('filtroRazaoSocial')?.value;
      const transportador = document.getElementById('filtroTransportador')?.value;
      const tipoPessoa = document.getElementById('filtroTipoPessoa')?.value;
      const estado = document.getElementById('filtroEstado')?.value;
      const cidade = document.getElementById('filtroCidade')?.value;
      const celular = document.getElementById('filtroCelular')?.value;
      const email = document.getElementById('filtroEmail')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      const tipoCadastro = document.getElementById('filtroTipoCadastro')?.value;
      const statusAprovacao = document.getElementById('filtroStatusAprovacao')?.value;
      
      if (codigo) params.append('codigo', codigo);
      // Aplicar padStart apenas se houver valor digitado (evita problema no filtro)
      if (cgccpf) {
        const cgccpfRaw = cgccpf.replace(/\D/g, '');
        if (cgccpfRaw && cgccpfRaw.length > 0) {
          // Completar com zeros à esquerda: CPF (11) ou CNPJ (14)
          const cgccpfCompleto = cgccpfRaw.length <= 11 
            ? cgccpfRaw.padStart(11, '0') 
            : cgccpfRaw.padStart(14, '0');
          params.append('cgccpf', cgccpfCompleto);
        }
      }
      if (razaoSocial) params.append('razaoSocial', razaoSocial);
      if (transportador) params.append('transportador', transportador);
      if (tipoPessoa) params.append('tipoPessoa', tipoPessoa);
      if (estado) params.append('cidadeEstado', estado);
      if (cidade) params.append('cidadeNome', cidade);
      if (celular) params.append('celular', celular.replace(/\D/g, ''));
      if (email) params.append('email', email);
      if (situacao) params.append('situacao', situacao);
      if (tipoCadastro) params.append('tipoCadastro', tipoCadastro);
      if (statusAprovacao) params.append('statusAprovacao', statusAprovacao);
      const rastreado = document.getElementById('filtroRastreado')?.value;
      if (rastreado) params.append('rastreado', rastreado);
      
      const queryString = params.toString();
      const url = queryString ? `/api/cadastros-gerais?${queryString}` : '/api/cadastros-gerais';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const cadastros = await response.json();
      
      // Garantir que cadastros é um array
      const cadastrosArray = Array.isArray(cadastros) ? cadastros : [];
      
      // Criar campo virtual CIDADE e TIPO_E_CADASTRO para cada cadastro
      const cadastrosComCidade = cadastrosArray.map(c => {
        const estado = c.CIDADE_ESTADO || '';
        const cidade = c.CIDADE_NOME || '';
        const cidadeFormatada = `${estado} - ${cidade}`.trim();
        const tipoECadastro = `${(c.RZSOCIAL || '').trim()} — ${(c.FGTIPOCADASTRO_NOME || '').trim()}`.replace(/^ — | — $/g, '').trim() || '-';
        return {
          ...c,
          CIDADE: cidadeFormatada === '-' ? 'Não informado' : cidadeFormatada,
          TIPO_E_CADASTRO: tipoECadastro
        };
      });
      
      // Armazenar dados em cache (mesmo se vazio)
      lastCadastros = cadastrosComCidade;
      
      // Atualizar contador
      const countEl = document.getElementById('cadastrosGridCountText');
      if (countEl) {
        const count = cadastrosComCidade.length || 0;
        countEl.textContent = count + ' ' + (t('web.modulos.cadastroGeral.registrosEncontrados').replace(/^0\s*/, ''));
      }
      
      // Se já existe uma instância do Grid na aba, atualizá-la imediatamente
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(cadastrosComCidade);
        } catch (e) {
        }
      }

      // Se Grid já existe, atualizar
      if (gridTab) {
        try {
          gridTab.render(cadastrosComCidade);
        } catch (e) {
          console.warn('[Cadastros] erro ao atualizar gridTab:', e);
        }
      }

      // Se openTab é 'grid', tentar auto-inicializar se necessário
      if (openTab === 'grid') {
        if (typeof window.GridEditor === 'undefined') {
          try {
            await loadScript('/js/grid-editor.js');
          } catch (loadErr) {
            console.warn('[Cadastros] erro ao carregar grid-editor para auto-init:', loadErr);
          }
        }

        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
            try {
              gridTab.render(cadastrosComCidade);
            } catch (e) {
              console.warn('[Cadastros] erro ao auto-render gridTab:', e);
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
                try { gridTab.render(cadastrosComCidade); } catch (e) { console.warn('[Cadastros] erro ao render após reload forçado', e); }
              }
            } catch (rbErr) {
              console.warn('[Cadastros] falha no reload forçado:', rbErr);
            }
          }
        }
      }

      showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar cadastros.', 'error');
    } finally {
      // Esconder overlay de carregamento
      hideLoadingOverlay();
    }
  }

  // Renderizar lista
  function renderList(cadastros) {
    if (!cadastros || cadastros.length === 0) {
      list.innerHTML = '<p class="empty">Nenhum cadastro encontrado.</p>';
      return;
    }

    list.innerHTML = cadastros.map(cg => {
      // Garantir que o ID seja válido e convertido para string
      const cadastroId = cg.CDCADASTRO != null ? String(cg.CDCADASTRO) : '';
      
      if (!cadastroId) {
        return '';
      }
      
      return `
      <div class="list-item ${cg.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${cadastroId}">
        <div>
          <strong>${cg.CDCADASTRO} - ${cg.RZSOCIAL}</strong>
          <small>
            <strong>CPF/CNPJ:</strong> ${formatarCPFCNPJ(cg.CGCCPF.toString())}<br>
            <strong>Tipo:</strong> ${cg.FGTIPOCADASTRO_NOME}<br>
            <strong>Localização:</strong> ${cg.CIDADE_ESTADO} - ${cg.CIDADE_NOME}<br>
            <strong>Celular:</strong> ${(function(n){ const p = parseCelularE164(n); return p.numero ? '+' + p.ddi + ' ' + formatarCelular(p.numero, p.ddi) : (n || '—'); })(cg.NRCELULAR)}<br>
            <strong>Status:</strong> ${cg.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${cadastroId}">Editar</button>
          <button class="btn delete" data-id="${cadastroId}">Excluir</button>
        </div>
      </div>
    `;
    }).filter(item => item !== '').join('');
  }

  // Carregar cadastro para edição
  async function loadCadastroParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      // Isso evita que dados de um cadastro apareçam em outro
      const cadastroForm = document.getElementById('cadastroForm');
      if (cadastroForm) {
        cadastroForm.reset();
      }
      
      const response = await fetch(`/api/cadastros-gerais/${id}`);
      const cadastro = await response.json();

      if (!response.ok || cadastro?.error || !cadastro?.CDCADASTRO) {
        const msg = cadastro?.error || 'Cadastro não encontrado.';
        if (typeof window.showToast === 'function') window.showToast(msg, 'error');
        else console.error('loadCadastroParaEdicao:', msg);
        return;
      }

      if (cadastro) {
        document.getElementById('cadastroId').value = cadastro.CDCADASTRO;
        document.getElementById('cadastroCodigo').value = cadastro.CDCADASTRO;
        const docVal = String(cadastro.CGCCPF ?? '').trim();
        document.getElementById('cadastroCGCCPF').value = (cadastro.PAIS === 'BR') ? formatarCPFCNPJ(docVal) : docVal;
        document.getElementById('cadastroRazaoSocial').value = cadastro.RZSOCIAL;
        document.getElementById('cadastroTipoPessoa').value = cadastro.FGFISICAJURIDICA;
        const paisEl = document.getElementById('cadastroPais');
        const paisVal = cadastro.PAIS != null && cadastro.PAIS !== '' ? String(cadastro.PAIS).trim() : '';
        if (paisEl) paisEl.value = paisVal;
        // Resolver PAIS (pode ser sigla BR/PY ou CDPAIS 1/5860 ou nome "Paraguai") para label do documento
        let siglaPais = paisVal;
        if (paisVal && /^\d+$/.test(paisVal)) {
          const p = listaPaisesCache.find(x => String(x.CDPAIS) === paisVal);
          siglaPais = (p && p.SGPAIS) ? String(p.SGPAIS).trim() : paisVal;
        }
        if (siglaPais && siglaPais.length > 2) {
          const u = String(siglaPais).toUpperCase();
          if (u === 'PARAGUAI') siglaPais = 'PY'; else if (u === 'BRASIL') siglaPais = 'BR'; else if (u === 'ARGENTINA') siglaPais = 'AR'; else if (u === 'URUGUAI') siglaPais = 'UY';
        }
        if (siglaPais) {
          contextoCadastro.pais = (siglaPais.length === 2) ? siglaPais.toUpperCase() : siglaPais;
          const tipos = { BR: { tipoDocFisica: 'CPF', tipoDocJuridica: 'CNPJ' }, PY: { tipoDocFisica: 'CI', tipoDocJuridica: 'RUC' }, AR: { tipoDocFisica: 'DNI', tipoDocJuridica: 'CUIT' }, UY: { tipoDocFisica: 'CI', tipoDocJuridica: 'RUT' } };
          const t = tipos[(contextoCadastro.pais || '').toUpperCase()] || tipos.BR;
          contextoCadastro.tipoDocFisica = t.tipoDocFisica;
          contextoCadastro.tipoDocJuridica = t.tipoDocJuridica;
        }
        updateLabelDocumento();
        // Aplicável para: preencher checkboxes
        const aplicavelIds = { O: 'chkO', P: 'chkP', M: 'chkM', T: 'chkT', A: 'chkA', G: 'chkG', C: 'chkC', U: 'chkU' };
        const aplicavelCols = { O: 'FGOPERADOR', P: 'FGPROGRAMADOR', M: 'FGMOTORISTA', T: 'FGTRANSPORTADOR', A: 'FGAGENTE', G: 'FGGRUPO', C: 'FGCERTIFICADORA', U: 'FGUNIDADENEGOCIO' };
        Object.keys(aplicavelIds).forEach(cod => {
          const el = document.getElementById(aplicavelIds[cod]);
          if (el) el.checked = cadastro[aplicavelCols[cod]] === true || cadastro[aplicavelCols[cod]] === 'S';
        });
        
        // Mostrar/esconder campo Transportador baseado em Motorista marcado
        const ehMotorista = cadastro.FGMOTORISTA === true || cadastro.FGMOTORISTA === 'S';
        const divTransportador = document.getElementById('divTransportador');
        const selectTransportador = document.getElementById('cadastroTransportador');
        
        if (ehMotorista) {
          // Mostrar campo Transportador
          if (divTransportador) {
            divTransportador.style.display = 'block';
          }
          // Carregar transportadores se necessário
          if (selectTransportador && selectTransportador.options.length <= 1) {
            await loadTransportadores();
          }
          // Preencher valor do Transportador se existir
          if (cadastro.CDTRANSPORTADOR && selectTransportador) {
            selectTransportador.value = cadastro.CDTRANSPORTADOR;
          }
        } else {
          // Esconder campo Transportador
          if (divTransportador) {
            divTransportador.style.display = 'none';
          }
          // Limpar seleção
          if (selectTransportador) {
            selectTransportador.value = '';
          }
        }
        
        // Destino preferido e senha do app motorista: mostrar só quando for motorista
        const divDestinoPreferido = document.getElementById('divDestinoPreferido');
        if (divDestinoPreferido) divDestinoPreferido.style.display = ehMotorista ? 'block' : 'none';
        const paisDestinoPrefEl = document.getElementById('cadastroPaisDestinoPref');
        const estadoDestinoPrefEl = document.getElementById('cadastroEstadoDestinoPref');
        const cidadeDestinoPrefEl = document.getElementById('cadastroCidadeDestinoPref');
        if (paisDestinoPrefEl) paisDestinoPrefEl.value = cadastro.PAIS_DESTINO_PREF || '';
        if (estadoDestinoPrefEl) estadoDestinoPrefEl.value = cadastro.SIGLA_ESTADO_DESTINO_PREF || '';
        if (cidadeDestinoPrefEl) cidadeDestinoPrefEl.value = cadastro.CIDADE_DESTINO_PREF || '';
        atualizarVisibilidadeLocaisPreferidos();
        const divSenhaMotorista = document.getElementById('divSenhaMotorista');
        const novaSenhaMotorista = document.getElementById('novaSenhaMotorista');
        const msgSenhaMotorista = document.getElementById('msgSenhaMotorista');
        if (divSenhaMotorista) {
          divSenhaMotorista.style.display = ehMotorista ? 'block' : 'none';
        }
        if (novaSenhaMotorista) novaSenhaMotorista.value = '';
        if (msgSenhaMotorista) {
          msgSenhaMotorista.textContent = '';
          msgSenhaMotorista.style.display = 'none';
          msgSenhaMotorista.className = 'message';
        }
        const statusAprovacaoEl = document.getElementById('statusAprovacaoMotorista');
        const msgStatusAprovacaoEl = document.getElementById('msgStatusAprovacao');
        if (statusAprovacaoEl) {
          const status = cadastro.STATUSAPROVACAO === 'A' || cadastro.STATUSAPROVACAO === 'R' || cadastro.STATUSAPROVACAO === 'P'
            ? cadastro.STATUSAPROVACAO : 'P';
          statusAprovacaoEl.value = status;
        }
        if (msgStatusAprovacaoEl) {
          msgStatusAprovacaoEl.textContent = '';
          msgStatusAprovacaoEl.style.display = 'none';
          msgStatusAprovacaoEl.className = 'message';
        }
        
        // Preencher FGRASTREADO - campo simples S/N
        const rastreadoSelect = document.getElementById('cadastroRastreado');
        if (rastreadoSelect && cadastro.FGRASTREADO) {
          rastreadoSelect.value = String(cadastro.FGRASTREADO).trim().toUpperCase();
        } else if (rastreadoSelect) {
          rastreadoSelect.value = '';
        }
        document.getElementById('cadastroSituacao').value = cadastro.FGACTIVE;
        document.getElementById('cadastroCEP').value = cadastro.CEP != null ? String(cadastro.CEP) : '';
        document.getElementById('cadastroEndereco').value = cadastro.ENDERECO;
        document.getElementById('cadastroNumero').value = cadastro.NRENDERECO;
        document.getElementById('cadastroComplemento').value = cadastro.COMPLEND;
        document.getElementById('cadastroBairro').value = cadastro.BAIRRO;
        document.getElementById('cadastroLatitude').value = cadastro.LATITUDE || '';
        document.getElementById('cadastroLongitude').value = cadastro.LONGITUDE || '';
        document.getElementById('cadastroEmail').value = cadastro.ENDEMAIL;
        const parsed = parseCelularE164(cadastro.NRCELULAR);
        const ddiEl = document.getElementById('cadastroDDI');
        if (ddiEl) ddiEl.value = parsed.ddi;
        document.getElementById('cadastroCelular').value = formatarCelular(parsed.numero, parsed.ddi);
        
        // Mudar para a aba de dados ANTES de carregar estados (para garantir que os elementos estejam visíveis)
        document.getElementById('formTitle').textContent = t('web.modulos.cadastroGeral.editarCadastro');
        showTab('dados');
        
        // Preencher Código Cidade diretamente (campo readonly)
        const codigoCidadeEl = document.getElementById('cadastroCodigoCidade');
        if (codigoCidadeEl && cadastro.CDCIDADE != null) {
          codigoCidadeEl.value = String(cadastro.CDCIDADE);
        }
        
        // Carregar estados do país do cadastro (respeitando país) e depois preencher estado/cidade
        estadosCarregados = false;
        await loadEstados(paisVal || cadastro.PAIS);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        const estadoParaPreencher = (cadastro.CIDADE_ESTADO || '').trim();
        const cidadeId = cadastro.CDCIDADE;
        
        if (estadoParaPreencher) {
          const estadoSelect = document.getElementById('cadastroEstado');
          if (estadoSelect) {
            // Verificar se o estado existe nas opções (case insensitive e com trim)
            const estadoExiste = Array.from(estadoSelect.options).some(opt => 
              opt.value.trim().toUpperCase() === estadoParaPreencher.toUpperCase()
            );
            
            if (estadoExiste) {
              // Encontrar o valor exato (pode ter diferença de case ou espaços)
              const estadoOption = Array.from(estadoSelect.options).find(opt => 
                opt.value.trim().toUpperCase() === estadoParaPreencher.toUpperCase()
              );
              
              if (estadoOption) {
                estadoSelect.value = estadoOption.value;
                
                // Chamar diretamente a função para carregar cidades
                await loadCidadesPorEstado(estadoOption.value, 'dados');
                
                // Aguardar as cidades carregarem
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Preencher Cidade (select) e garantir Código Cidade
                if (cidadeId) {
                  const cidadeSelect = document.getElementById('cadastroCidade');
                  if (cidadeSelect) {
                    // Função para preencher cidade com retry
                    const preencherCidadeComRetry = (cidadeIdParaPreencher, tentativas = 40) => {
                      if (cidadeSelect.options.length > 1) {
                        // Verificar se a cidade existe nas opções
                        const cidadeExiste = Array.from(cidadeSelect.options).some(opt => 
                          opt.value === cidadeIdParaPreencher?.toString()
                        );
                        
                        if (cidadeExiste) {
                          // Preencher Cidade
                          cidadeSelect.value = cidadeIdParaPreencher.toString();
                          
                          // Garantir que Código Cidade está preenchido
                          if (codigoCidadeEl) {
                            codigoCidadeEl.value = cidadeIdParaPreencher.toString();
                          }
                        } else {
                          if (tentativas > 0) {
                            setTimeout(() => preencherCidadeComRetry(cidadeIdParaPreencher, tentativas - 1), 250);
                          } else {
                            // Mesmo assim, garantir que o código da cidade está preenchido
                            if (codigoCidadeEl) {
                              codigoCidadeEl.value = cidadeIdParaPreencher.toString();
                            }
                          }
                        }
                      } else if (tentativas > 0) {
                        // Cidades ainda não carregaram, tentar novamente
                        setTimeout(() => preencherCidadeComRetry(cidadeIdParaPreencher, tentativas - 1), 250);
                      } else {
                        // Mesmo assim, garantir que o código da cidade está preenchido
                        if (codigoCidadeEl && cidadeIdParaPreencher) {
                          codigoCidadeEl.value = cidadeIdParaPreencher.toString();
                        }
                      }
                    };
                    
                    // Iniciar preenchimento da cidade
                    preencherCidadeComRetry(cidadeId, 40);
                  }
                }
              }
            } else {
              // Mesmo assim, garantir que o código da cidade está preenchido
              if (codigoCidadeEl && cadastro.CDCIDADE) {
                codigoCidadeEl.value = cadastro.CDCIDADE.toString();
              }
            }
          }
        } else {
          // Mesmo assim, garantir que o código da cidade está preenchido se houver
          if (codigoCidadeEl && cadastro.CDCIDADE) {
            codigoCidadeEl.value = cadastro.CDCIDADE.toString();
          }
        }
        
      }
    } catch (err) {
      console.error('Erro ao carregar cadastro:', err);
      showMessage(t('web.modulos.cadastroGeral.erroCarregarDados'), 'error');
    }
  }

  // Modal do módulo: buscar dentro do contentArea para não pegar modal de outro lugar no dashboard
  function getModalElements() {
    const root = document.getElementById('contentArea') || document.body;
    return {
      modalEl: root.querySelector ? root.querySelector('#confirmModal') : document.getElementById('confirmModal'),
      modalMessage: root.querySelector ? root.querySelector('#modalMessage') : document.getElementById('modalMessage'),
      confirmYes: root.querySelector ? root.querySelector('#confirmYes') : document.getElementById('confirmYes'),
      confirmNo: root.querySelector ? root.querySelector('#confirmNo') : document.getElementById('confirmNo')
    };
  }

  // Confirmar desativação/reativação de cadastro – mesmo padrão visual do Gerenciar Tipos de Validade (modal estilizado).
  function confirmarExclusao(id) {
    console.log('[CadastroGeral] confirmarExclusao chamada, id=', id);
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage(t('web.modulos.cadastroGeral.erroIdIndisponivel'), 'error');
      return;
    }
    idValido = String(idValido).trim();

    const modalEl = document.getElementById('confirmModal');
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    console.log('[CadastroGeral] confirmarExclusao modal elementos:', { modalEl: !!modalEl, modalMessage: !!modalMessage, confirmYes: !!confirmYes, confirmNo: !!confirmNo });

    function executarAcao() {
      fetch(`/api/cadastros-gerais/${idValido}`, { method: 'DELETE', headers: getAuthHeaders() })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ok) {
            showMessage(data.message || 'Status alterado com sucesso.', 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do cadastro.', 'error');
          }
        })
        .catch(() => showMessage(t('web.modulos.cadastroGeral.erroConexao'), 'error'))
        .finally(() => { if (modalEl) modalEl.style.display = 'none'; delete modalEl.dataset.deleteId; });
    }

    fetch(`/api/cadastros-gerais/${idValido}`, { headers: getAuthHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(function(cadastro) {
        var estaAtivo = cadastro.FGACTIVE === 'S';
        var msg = estaAtivo ? 'Tem certeza que deseja desativar este cadastro?' : 'Tem certeza que deseja reativar este cadastro?';
        var btnText = estaAtivo ? 'Desativar' : 'Reativar';
        if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
          if (window.confirm(msg)) executarAcao();
          return;
        }
        modalMessage.textContent = msg;
        modalEl.dataset.deleteId = idValido;
        confirmYes.className = 'btn-filtro btn-filtro-danger';
        confirmYes.innerHTML = '<i class=\'bx bx-check\'></i> ' + btnText;
        confirmNo.className = 'btn-filtro btn-filtro-limpar';
        confirmNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.cadastroGeral.cancelar') || 'Cancelar');
        confirmYes.onclick = () => executarAcao();
        confirmNo.onclick = () => { modalEl.style.display = 'none'; delete modalEl.dataset.deleteId; };
        if (modalEl.parentNode !== document.body) document.body.appendChild(modalEl);
        modalEl.style.display = 'block';
        modalEl.style.zIndex = '99999';
      })
      .catch(function() {
        showMessage('Erro ao verificar status do cadastro.', 'error');
      });
  }

  // Modal de confirmação para excluir local preferido – mesmo padrão do Gerenciar Tipos de Validade (layout, CSS, botões).
  function confirmarRemoverLocal(sequencia, cadastroId) {
    console.log('[CadastroGeral] confirmarRemoverLocal chamada, seq=', sequencia, 'cadastroId=', cadastroId);
    const seq = String(sequencia).trim();
    const cid = String(cadastroId).trim();
    const msg = 'Tem certeza que deseja excluir este local da lista?';
    const modalEl = document.getElementById('confirmModal');
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    console.log('[CadastroGeral] confirmarRemoverLocal modal elementos:', { modalEl: !!modalEl, modalMessage: !!modalMessage, confirmYes: !!confirmYes, confirmNo: !!confirmNo });

    function executarExcluir() {
      fetch(`/api/cadastros-gerais/${cid}/locais-preferidos/${seq}`, { method: 'DELETE', headers: getAuthHeaders() })
        .then(del => {
          if (del.ok) loadLocaisPreferidosLista(cid);
          else showMessage('Erro ao excluir.', 'error');
        })
        .catch(() => showMessage('Erro ao excluir.', 'error'))
        .finally(() => { if (modalEl) modalEl.style.display = 'none'; });
    }

    if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
      if (window.confirm(msg)) executarExcluir();
      return;
    }

    modalMessage.textContent = msg;
    confirmYes.className = 'btn-filtro btn-filtro-danger';
    confirmYes.innerHTML = '<i class=\'bx bx-check\'></i> Excluir';
    confirmNo.className = 'btn-filtro btn-filtro-limpar';
    confirmNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.cadastroGeral.cancelar') || 'Cancelar');
    confirmYes.onclick = () => executarExcluir();
    confirmNo.onclick = () => { modalEl.style.display = 'none'; };
    if (modalEl.parentNode !== document.body) document.body.appendChild(modalEl);
    modalEl.style.display = 'block';
    modalEl.style.zIndex = '99999';
  }
  window.confirmarExclusao = confirmarExclusao;
  window.confirmarRemoverLocal = confirmarRemoverLocal;
  console.log('[CadastroGeral] confirmarExclusao e confirmarRemoverLocal expostos em window');

  // Resolver sigla do país a partir do valor do select (pode ser PY, BR, "Paraguai", CDPAIS, etc.)
  function getPaisFromForm() {
    const v = (document.getElementById('cadastroPais')?.value || '').trim();
    if (!v) return (contextoCadastro && contextoCadastro.pais) || 'BR';
    if (/^\d+$/.test(v)) {
      const p = listaPaisesCache.find(x => String(x.CDPAIS) === v);
      return (p && p.SGPAIS) ? String(p.SGPAIS).trim().toUpperCase() : 'BR';
    }
    const u = v.toUpperCase();
    if (u === 'PARAGUAI' || u === 'PY') return 'PY';
    if (u === 'BRASIL' || u === 'BR') return 'BR';
    if (u === 'ARGENTINA' || u === 'AR') return 'AR';
    if (u === 'URUGUAI' || u === 'UY') return 'UY';
    return v.length === 2 ? v : (contextoCadastro && contextoCadastro.pais) || 'BR';
  }

  // Validar formulário
  function validarFormulario() {
    let cgccpf = document.getElementById('cadastroCGCCPF').value.replace(/\D/g, '');
    const tipoPessoa = document.getElementById('cadastroTipoPessoa').value;
    const email = document.getElementById('cadastroEmail').value;
    const celular = document.getElementById('cadastroCelular').value.replace(/\D/g, '');
    
    // País do formulário (select) prevalece sobre contexto global
    const pais = getPaisFromForm();
    if (cgccpf && cgccpf.length > 0 && pais === 'BR') {
      if (tipoPessoa === 'F') cgccpf = cgccpf.padStart(11, '0');
      else if (tipoPessoa === 'J') cgccpf = cgccpf.padStart(14, '0');
    }
    
    if (pais === 'BR') {
      if (tipoPessoa === 'F' && (cgccpf.length !== 11 || !validarCPF(cgccpf))) {
        showMessage(t('web.modulos.cadastroGeral.cpfInvalido') || 'CPF inválido.', 'error', null, 'cadastroCGCCPF');
        return false;
      }
      if (tipoPessoa === 'J' && (cgccpf.length !== 14 || !validarCNPJ(cgccpf))) {
        showMessage(t('web.modulos.cadastroGeral.cnpjInvalido') || 'CNPJ inválido.', 'error', null, 'cadastroCGCCPF');
        return false;
      }
    } else {
      const len = (cgccpf || '').replace(/\D/g, '').length;
      if (len < 3 || len > 14) {
        showMessage(t('web.modulos.cadastroGeral.documentoInvalido') || 'Documento inválido.', 'error', null, 'cadastroCGCCPF');
        return false;
      }
    }
    
    // Validar email
    if (email && !validarEmail(email)) {
      showMessage('Email inválido.', 'error', null, 'cadastroEmail');
      return false;
    }
    
    // Validar celular por DDI (BR, AR, PY, UY)
    const ddi = document.getElementById('cadastroDDI')?.value?.replace(/\D/g, '') || '55';
    if (!validarCelularPorDdi(ddi, celular)) {
      showMessage(t('web.modulos.cadastroGeral.celularInvalido') || 'Celular inválido. Verifique o DDI e o número (ex.: Brasil (11) 91234-5678).', 'error', null, 'cadastroCelular');
      return false;
    }
    
    return true;
  }

  // Validar CPF
  function validarCPF(cpf) {
    cpf = cpf.replace(/[^\d]+/g, '');
    if (cpf.length !== 11) return false;
    if (/^(\d)\1+$/.test(cpf)) return false;
    
    let soma = 0;
    for (let i = 0; i < 9; i++) {
      soma += parseInt(cpf.charAt(i)) * (10 - i);
    }
    let resto = 11 - (soma % 11);
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(9))) return false;
    
    soma = 0;
    for (let i = 0; i < 10; i++) {
      soma += parseInt(cpf.charAt(i)) * (11 - i);
    }
    resto = 11 - (soma % 11);
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.charAt(10))) return false;
    
    return true;
  }

  // Validar CNPJ
  function validarCNPJ(cnpj) {
    cnpj = cnpj.replace(/[^\d]+/g, '');
    if (cnpj.length !== 14) return false;
    if (/^(\d)\1+$/.test(cnpj)) return false;
    
    let tamanho = cnpj.length - 2;
    let numeros = cnpj.substring(0, tamanho);
    let digitos = cnpj.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    
    for (let i = tamanho; i >= 1; i--) {
      soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
      if (pos < 2) pos = 9;
    }
    
    let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
    if (resultado !== parseInt(digitos.charAt(0))) return false;
    
    tamanho = tamanho + 1;
    numeros = cnpj.substring(0, tamanho);
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
  
  let cadastroFormSubmitting = false;
  cadastroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (cadastroFormSubmitting) return;
    cadastroFormSubmitting = true;

    const btnSalvar = cadastroForm.querySelector('button[type="submit"]');
    if (btnSalvar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnSalvar, true);
    }

    if (!validarFormulario()) {
      cadastroFormSubmitting = false;
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }
    
    // Remover formatação e completar zeros à esquerda só no Brasil
    let cgccpfRaw = document.getElementById('cadastroCGCCPF').value.replace(/\D/g, '');
    const tipoPessoa = document.getElementById('cadastroTipoPessoa').value;
    const paisSubmit = getPaisFromForm();
    if (cgccpfRaw && paisSubmit === 'BR') {
      if (tipoPessoa === 'F') cgccpfRaw = cgccpfRaw.padStart(11, '0');
      else if (tipoPessoa === 'J') cgccpfRaw = cgccpfRaw.padStart(14, '0');
    }
    
    const ddiRaw = document.getElementById('cadastroDDI')?.value?.replace(/\D/g, '') || '55';
    const celularRaw = ddiRaw + document.getElementById('cadastroCelular').value.replace(/\D/g, '');
    const cepRaw = document.getElementById('cadastroCEP').value.replace(/\D/g, '');
    
    const id = document.getElementById('cadastroId')?.value;
    const razaoSocial = document.getElementById('cadastroRazaoSocial').value.trim();
    const cidade = document.getElementById('cadastroCidade').value;
    const endereco = document.getElementById('cadastroEndereco').value.trim();
    const numero = document.getElementById('cadastroNumero').value;
    const complemento = document.getElementById('cadastroComplemento').value.trim();
    const bairro = document.getElementById('cadastroBairro').value.trim();
    const latitude = document.getElementById('cadastroLatitude').value;
    const longitude = document.getElementById('cadastroLongitude').value;
    const email = document.getElementById('cadastroEmail').value.trim();
    const situacao = document.getElementById('cadastroSituacao').value;
    const aplicavelChecks = { O: 'chkO', P: 'chkP', M: 'chkM', T: 'chkT', A: 'chkA', G: 'chkG', C: 'chkC', U: 'chkU' };
    const aplicavelCols = { O: 'FGOPERADOR', P: 'FGPROGRAMADOR', M: 'FGMOTORISTA', T: 'FGTRANSPORTADOR', A: 'FGAGENTE', G: 'FGGRUPO', C: 'FGCERTIFICADORA', U: 'FGUNIDADENEGOCIO' };
    const flags = {};
    let algumMarcado = false;
    Object.keys(aplicavelChecks).forEach(cod => {
      const el = document.getElementById(aplicavelChecks[cod]);
      const checked = el ? el.checked : false;
      flags[aplicavelCols[cod]] = checked;
      if (checked) algumMarcado = true;
    });
    if (!algumMarcado) {
      showMessage('Marque pelo menos uma opção em "Tipo de Cadastro".', 'error');
      return;
    }
    const transportador = document.getElementById('cadastroTransportador')?.value;
    const ehMotorista = flags.FGMOTORISTA === true;
    
    try {
      const cadastroData = {
        CGCCPF: cgccpfRaw,
        RZSOCIAL: razaoSocial,
        FGFISICAJURIDICA: tipoPessoa,
        PAIS: document.getElementById('cadastroPais')?.value?.trim() || null,
        CEP: cepRaw || null,
        CDCIDADE: cidade ? parseInt(cidade) : null,
        ENDERECO: endereco,
        NRENDERECO: parseInt(numero),
        COMPLEND: complemento || null,
        BAIRRO: bairro,
        NRCELULAR: celularRaw,
        ENDEMAIL: email || null,
        LATITUDE: latitude || null,
        LONGITUDE: longitude || null,
        ...flags,
        FGRASTREADO: document.getElementById('cadastroRastreado')?.value || null,
        ...(ehMotorista && transportador ? { CDTRANSPORTADOR: parseFloat(transportador) } : !ehMotorista ? { CDTRANSPORTADOR: null } : {}),
        ...(ehMotorista ? (() => {
          const usaAbaLocais = document.getElementById('tabBtnLocaisPreferidos')?.style?.display !== 'none';
          const get = (id) => document.getElementById(id)?.value?.trim() || null;
          return {
            STATUSAPROVACAO: document.getElementById('statusAprovacaoMotorista')?.value || 'P',
            PAIS_DESTINO_PREF: usaAbaLocais ? get('locaisPaisDestinoPref') : get('cadastroPaisDestinoPref'),
            SIGLA_ESTADO_DESTINO_PREF: usaAbaLocais ? get('locaisEstadoDestinoPref') : get('cadastroEstadoDestinoPref'),
            CIDADE_DESTINO_PREF: usaAbaLocais ? get('locaisCidadeDestinoPref') : get('cadastroCidadeDestinoPref'),
            PAIS_EMBARQUE_PREF: usaAbaLocais ? get('locaisPaisEmbarquePref') : null,
            SIGLA_ESTADO_EMBARQUE_PREF: usaAbaLocais ? get('locaisEstadoEmbarquePref') : null,
            REGIAO_EMBARQUE_PREF: usaAbaLocais ? get('locaisRegiaoEmbarquePref') : null,
            CIDADE_EMBARQUE_PREF: usaAbaLocais ? get('locaisCidadeEmbarquePref') : null
          };
        })() : {})
      };

      let response;
      if (id) {
        cadastroData.FGACTIVE = situacao;
        response = await fetch(`/api/cadastros-gerais/${id}`, {
          method: 'PUT',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(cadastroData)
        });
      } else {
        response = await fetch('/api/cadastros-gerais', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(cadastroData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || 'Salvo com sucesso!', 'success');
        showTab('grid');
        applyFilters('grid');
      } else {
        showMessage(data.errorKey ? t(data.errorKey) : (data.error || t('web.modulos.cadastroGeral.erroSalvar')), 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.cadastroGeral.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        cadastroFormSubmitting = false;
        const btn = cadastroForm.querySelector('button[type="submit"]');
        if (btn && typeof window.showLoading !== 'undefined') {
          window.showLoading(btn, false);
        }
      }, 600);
    }
  });

  // Carregar classes de frota para o cadastro
  async function loadClassesFrotaParaCadastro(cadastroId) {
    try {
      const response = await fetch(`/api/cadastro-classes/${cadastroId}`, {
        headers: getAuthHeaders()
      });
      const classes = await response.json();

      const classesList = document.getElementById('classesFrotaList');
      if (!classesList) {
        console.error('Elemento classesFrotaList não encontrado');
        return;
      }

      // Garantir que existe o container .classes-grid
      let classesGrid = document.querySelector('#classesFrotaList .classes-grid');
      if (!classesGrid) {
        classesGrid = document.createElement('div');
        classesGrid.className = 'classes-grid';
        classesList.innerHTML = '';
        classesList.appendChild(classesGrid);
      }

      if (!classes || classes.length === 0) {
        classesGrid.innerHTML = '<p class="empty">Nenhuma classe de frota encontrada.</p>';
        return;
      }

      // Renderizar classes em grid de 4 colunas
      classesGrid.innerHTML = classes.map(classe => `
        <div class="classe-item">
          <input type="checkbox" 
                id="classe-${classe.CDCLASSEFROTA}" 
                data-classe-id="${classe.CDCLASSEFROTA}"
                ${classe.FGACTIVE === 'S' ? 'checked' : ''}>
          <div>
            <label for="classe-${classe.CDCLASSEFROTA}">${classe.DSCLASSEFROTA}</label>
            <div class="classe-info">
              Código: ${classe.CDCLASSEFROTA} | Status: ${classe.FGACTIVE === 'S' ? 'Ativa' : 'Inativa'}
            </div>
          </div>
        </div>
      `).join('');

      // Remover event listeners anteriores e adicionar novo
      const btnSalvar = document.getElementById('btnSalvarClasses');
      if (btnSalvar) {
        // Clonar o botão para remover listeners antigos
        const newBtn = btnSalvar.cloneNode(true);
        btnSalvar.parentNode.replaceChild(newBtn, btnSalvar);
        newBtn.addEventListener('click', () => {
          saveClassesFrota(cadastroId);
        });
      }

      // Adicionar event listeners para selecionar/desmarcar todos
      const btnSelecionarTodos = document.getElementById('btnSelecionarTodos');
      const btnDesmarcarTodos = document.getElementById('btnDesmarcarTodos');
      
      if (btnSelecionarTodos) {
        // Remover listeners anteriores
        const newBtnSelecionar = btnSelecionarTodos.cloneNode(true);
        btnSelecionarTodos.parentNode.replaceChild(newBtnSelecionar, btnSelecionarTodos);
        newBtnSelecionar.addEventListener('click', () => {
          const checkboxes = document.querySelectorAll('#classesFrotaList input[type="checkbox"]');
          checkboxes.forEach(checkbox => {
            checkbox.checked = true;
          });
          showMessage(`${checkboxes.length} classe(s) selecionada(s).`, 'success');
        });
      }
      
      if (btnDesmarcarTodos) {
        // Remover listeners anteriores
        const newBtnDesmarcar = btnDesmarcarTodos.cloneNode(true);
        btnDesmarcarTodos.parentNode.replaceChild(newBtnDesmarcar, btnDesmarcarTodos);
        newBtnDesmarcar.addEventListener('click', () => {
          const checkboxes = document.querySelectorAll('#classesFrotaList input[type="checkbox"]');
          checkboxes.forEach(checkbox => {
            checkbox.checked = false;
          });
          showMessage('Todas as classes foram desmarcadas.', 'success');
        });
      }

    } catch (err) {
      console.error('Erro ao carregar classes de frota:', err);
      showMessage('Erro ao carregar classes de frota.', 'error');
    }
  }

  // Salvar classes de frota
  async function saveClassesFrota(cadastroId) {
    try {
      const checkboxes = document.querySelectorAll('#classesFrotaList input[type="checkbox"]');
      const classesAtualizadas = [];
      
      checkboxes.forEach(checkbox => {
        classesAtualizadas.push({
          CDCLASSEFROTA: parseInt(checkbox.dataset.classeId),
          FGACTIVE: checkbox.checked ? 'S' : 'N'
        });
      });

      const response = await fetch(`/api/cadastro-classes/${cadastroId}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ classes: classesAtualizadas })
      });

      const data = await response.json();
      if (response.ok) {
        showMessage(data.message || 'Classes de frota salvas com sucesso!', 'success');
        showTab('dados');
      } else {
        showMessage(data.error || 'Erro ao salvar classes.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar classes de frota:', err);
      showMessage('Erro de conexão ao salvar classes.', 'error');
    }
  }

  // Eventos — delegação no document para o filtro funcionar mesmo quando o HTML é injetado depois (dashboard)
  document.addEventListener('submit', function handleFiltroSubmit(e) {
    if (e.target && e.target.id === 'filtroForm') {
      e.preventDefault();
      applyFilters('grid');
    }
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.getElementById('filtroCodigo').value = '';
    document.getElementById('filtroCGCCPF').value = '';
    document.getElementById('filtroRazaoSocial').value = '';
    document.getElementById('filtroTransportador').value = '';
    document.getElementById('filtroTipoPessoa').value = '';
    document.getElementById('filtroEstado').value = '';
    document.getElementById('filtroCidade').value = '';
    document.getElementById('filtroCelular').value = '';
    document.getElementById('filtroEmail').value = '';
document.getElementById('filtroRastreado').value = '';
      document.getElementById('filtroSituacao').value = '';
      document.getElementById('filtroTipoCadastro').value = '';
      const filtroStatusAprovacaoEl = document.getElementById('filtroStatusAprovacao');
      if (filtroStatusAprovacaoEl) filtroStatusAprovacaoEl.value = '';
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    cadastroForm?.reset();
    document.getElementById('cadastroId').value = '';
    document.getElementById('cadastroCodigo').value = '';
    document.getElementById('cadastroCodigoCidade').value = '';
    ['chkO','chkP','chkM','chkT','chkA','chkG','chkC','chkU'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    const divTransportador = document.getElementById('divTransportador');
    if (divTransportador) divTransportador.style.display = 'none';
    const divDestinoPreferido = document.getElementById('divDestinoPreferido');
    if (divDestinoPreferido) divDestinoPreferido.style.display = 'none';
    const divSenhaMotorista = document.getElementById('divSenhaMotorista');
    if (divSenhaMotorista) divSenhaMotorista.style.display = 'none';
    const msgSenha = document.getElementById('msgSenhaMotorista');
    if (msgSenha) { msgSenha.textContent = ''; msgSenha.style.display = 'none'; }
    const msgStatusAprovacao = document.getElementById('msgStatusAprovacao');
    if (msgStatusAprovacao) { msgStatusAprovacao.textContent = ''; msgStatusAprovacao.style.display = 'none'; }
    document.getElementById('formTitle').textContent = t('web.modulos.cadastroGeral.novoCadastro');
    showTab('dados');
  });
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));
  
  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Forçar mudança para aba de filtros DIRETAMENTE, sem depender de showTab
    const tabBtn = document.querySelector('.tab-btn[data-tab="filtros"]');
    const tabContent = document.getElementById('tab-filtros');
    if (tabContent && tabBtn) {
      const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
      if (container) {
        container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        container.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
          content.style.display = 'none';
        });
      }
      tabBtn.classList.add('active');
      tabContent.classList.add('active');
      tabContent.style.display = 'block';
    }
    
    // Carregar estados de forma assíncrona (não bloqueia a mudança de aba)
    setTimeout(async () => {
      try {
        const filtroEstado = document.getElementById('filtroEstado');
        const cadastroEstado = document.getElementById('cadastroEstado');
        if ((filtroEstado && filtroEstado.options.length <= 1) || 
            (cadastroEstado && cadastroEstado.options.length <= 1)) {
          await loadEstados();
        }
      } catch (err) {
        // Ignorar erros no carregamento de estados
        console.warn('[Cadastros] Aviso ao carregar estados:', err);
      }
    }, 100);
  });
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    cadastroForm?.reset();
    document.getElementById('cadastroId').value = '';
    document.getElementById('cadastroCodigo').value = '';
    document.getElementById('cadastroCodigoCidade').value = '';
    ['chkO','chkP','chkM','chkT','chkA','chkG','chkC','chkU'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    const divTransportador = document.getElementById('divTransportador');
    if (divTransportador) divTransportador.style.display = 'none';
    const divDestinoPreferido = document.getElementById('divDestinoPreferido');
    if (divDestinoPreferido) divDestinoPreferido.style.display = 'none';
    const divSenhaMotorista = document.getElementById('divSenhaMotorista');
    if (divSenhaMotorista) divSenhaMotorista.style.display = 'none';
    const msgSenha = document.getElementById('msgSenhaMotorista');
    if (msgSenha) { msgSenha.textContent = ''; msgSenha.style.display = 'none'; }
    const msgStatusAprovacao = document.getElementById('msgStatusAprovacao');
    if (msgStatusAprovacao) { msgStatusAprovacao.textContent = ''; msgStatusAprovacao.style.display = 'none'; }
    document.getElementById('formTitle').textContent = t('web.modulos.cadastroGeral.novoCadastro');
    showTab('dados');
  });

  // Aplicar status de aprovação do motorista (admin) — delegação no form para garantir que funcione após carregamento dinâmico
  (cadastroForm || document.body).addEventListener('click', async (e) => {
    if (e.target.id !== 'btnAplicarStatusAprovacao') return;
    e.preventDefault();
    const cdCadastro = document.getElementById('cadastroId')?.value?.trim();
    const selectStatus = document.getElementById('statusAprovacaoMotorista');
    const status = selectStatus?.value || 'P';
    const msgEl = document.getElementById('msgStatusAprovacao');
    function showMsg(text, type) {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.className = 'message ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
      msgEl.style.display = 'block';
    }
    if (!cdCadastro) {
      showMsg('Selecione um cadastro para edição antes de aplicar o status.', 'error');
      return;
    }
    try {
      const response = await fetch('/api/motorista/aprovar-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdCadastro: Number(cdCadastro), status })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        showMsg(data.message || 'Status de aprovação atualizado.', 'success');
      } else {
        showMsg(data.error || 'Erro ao atualizar status.', 'error');
      }
    } catch (err) {
      console.error('Aprovar motorista:', err);
      showMsg('Erro de conexão ao atualizar status.', 'error');
    }
  });

  // Definir senha do app motorista (admin)
  document.getElementById('btnDefinirSenhaMotorista')?.addEventListener('click', async () => {
    const cdCadastro = document.getElementById('cadastroId')?.value?.trim();
    const inputSenha = document.getElementById('novaSenhaMotorista');
    const novaSenha = inputSenha?.value?.trim() || '';
    const msgEl = document.getElementById('msgSenhaMotorista');
    function showMsg(text, type) {
      if (!msgEl) return;
      msgEl.textContent = text;
      msgEl.className = 'message ' + (type === 'error' ? 'error' : type === 'success' ? 'success' : 'info');
      msgEl.style.display = 'block';
    }
    if (!cdCadastro) {
      showMsg('Selecione um cadastro para edição antes de definir a senha.', 'error');
      return;
    }
    if (novaSenha.length < 6) {
      showMsg('A senha deve ter no mínimo 6 caracteres.', 'error');
      return;
    }
    try {
      const response = await fetch('/api/motorista/definir-senha-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cdCadastro: Number(cdCadastro), novaSenha })
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        showMsg('Senha definida com sucesso. O motorista já pode usar no app.', 'success');
        if (inputSenha) inputSenha.value = '';
      } else {
        showMsg(data.error || 'Erro ao definir senha.', 'error');
      }
    } catch (err) {
      console.error('Definir senha motorista:', err);
      showMsg('Erro de conexão ao definir senha.', 'error');
    }
  });

  // Exportar para Excel
  document.getElementById('btnExportarExcel')?.addEventListener('click', async () => {
    try {
      // Mostrar mensagem de carregamento
      showMessage('Gerando arquivo Excel...', 'info');
      
      // Coletar os mesmos filtros aplicados
      const params = new URLSearchParams();
      const codigo = document.getElementById('filtroCodigo')?.value;
      const cgccpf = document.getElementById('filtroCGCCPF')?.value;
      const razaoSocial = document.getElementById('filtroRazaoSocial')?.value;
      const transportador = document.getElementById('filtroTransportador')?.value;
      const tipoPessoa = document.getElementById('filtroTipoPessoa')?.value;
      const estado = document.getElementById('filtroEstado')?.value;
      const cidade = document.getElementById('filtroCidade')?.value;
      const celular = document.getElementById('filtroCelular')?.value;
      const email = document.getElementById('filtroEmail')?.value;
      const situacao = document.getElementById('filtroSituacao')?.value;
      const tipoCadastro = document.getElementById('filtroTipoCadastro')?.value;
      
      if (codigo) params.append('codigo', codigo);
      if (cgccpf) {
        const cgccpfRaw = cgccpf.replace(/\D/g, '');
        if (cgccpfRaw && cgccpfRaw.length > 0) {
          const cgccpfCompleto = cgccpfRaw.length <= 11 
            ? cgccpfRaw.padStart(11, '0') 
            : cgccpfRaw.padStart(14, '0');
          params.append('cgccpf', cgccpfCompleto);
        }
      }
      if (razaoSocial) params.append('razaoSocial', razaoSocial);
      if (transportador) params.append('transportador', transportador);
      if (tipoPessoa) params.append('tipoPessoa', tipoPessoa);
      if (estado) params.append('cidadeEstado', estado);
      if (cidade) params.append('cidadeNome', cidade);
      if (celular) params.append('celular', celular.replace(/\D/g, ''));
      if (email) params.append('email', email);
      if (situacao) params.append('situacao', situacao);
      if (tipoCadastro) params.append('tipoCadastro', tipoCadastro);
      const rastreado = document.getElementById('filtroRastreado')?.value;
      if (rastreado) params.append('rastreado', rastreado);
      
      // Fazer requisição para exportar
      const response = await fetch(`/api/cadastros-gerais/exportar-excel?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Erro ao gerar arquivo Excel');
      }
      
      // Obter o blob do arquivo
      const blob = await response.blob();
      
      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cadastros-gerais-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      showMessage('Arquivo Excel gerado com sucesso!', 'success');
    } catch (err) {
      console.error('Erro ao exportar para Excel:', err);
      showMessage('Erro ao exportar para Excel. Tente novamente.', 'error');
    }
  });
  
  // Eventos de abas
  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      
      // Se for a aba "classes", executar a mesma lógica do botão "Gerenciar Classes"
      if (tabId === 'classes') {
        const cadastroId = document.getElementById('cadastroId')?.value;
        if (!cadastroId) {
          showMessage('Salve o cadastro antes de gerenciar as classes.', 'error');
          return;
        }
        loadClassesFrotaParaCadastro(cadastroId);
        await showTab('classes');
      } else if (tabId === 'validades') {
        const cadastroId = document.getElementById('cadastroId')?.value;
        const tpCadastro = obterTipoCadastro();
        if (!cadastroId) {
          showMessage('Selecione um cadastro antes de gerenciar validades.', 'error');
          return;
        }
        await showTab('validades');
        setTimeout(() => {
          inicializarAbaValidades();
        }, 100);
      } else {
        await showTab(tabId);
      }
    });
  });

  document.getElementById('btnBuscarCEP')?.addEventListener('click', buscarCEP);
  document.getElementById('btnGerenciarClasses')?.addEventListener('click', () => {
    const cadastroId = document.getElementById('cadastroId')?.value;
    if (!cadastroId) {
      showMessage('Salve o cadastro antes de gerenciar as classes.', 'error');
      return;
    }
    loadClassesFrotaParaCadastro(cadastroId);
    showTab('classes');
  });
  document.getElementById('btnVoltarDados')?.addEventListener('click', () => {
    showTab('dados');
  });

  document.getElementById('btnVoltarDadosLocais')?.addEventListener('click', () => showTab('dados'));

  // --- Locais preferidos: lista registro a registro (País → Estado → Mesorregião, combo Origem/Destino) ---
  const NOME_PAIS = { BR: 'Brasil', PY: 'Paraguai', AR: 'Argentina', UY: 'Uruguai' };
  let listaPaisesCache = [];
  function getNomePais(sigla) {
    if (!sigla) return '';
    const p = listaPaisesCache.find(x => (x.SGPAIS || '').toString().toUpperCase() === (sigla || '').toString().toUpperCase());
    return (p && p.DSPAIS) ? p.DSPAIS : (NOME_PAIS[sigla] || sigla);
  }
  async function loadPaises() {
    const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/paises') : '/api/paises');
    const r = await fetch(url);
    const paises = await r.json();
    if (!Array.isArray(paises)) return;
    listaPaisesCache = paises;
    const opts = paises.map(p => ({ value: (p.SGPAIS != null && p.SGPAIS !== '') ? String(p.SGPAIS).trim() : String(p.CDPAIS), label: p.DSPAIS || p.SGPAIS || p.CDPAIS }));
    function preencher(selectId, primeiraOpcaoValor, primeiraOpcaoTexto) {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      sel.innerHTML = '';
      const opt0 = document.createElement('option');
      opt0.value = primeiraOpcaoValor != null ? primeiraOpcaoValor : '';
      opt0.textContent = primeiraOpcaoTexto != null ? primeiraOpcaoTexto : '— Selecione —';
      sel.appendChild(opt0);
      opts.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      });
    }
    preencher('cadastroPais', '', 'Padrão (Configurações)');
    preencher('cadastroPaisDestinoPref', '', '—');
    preencher('locaisPais', '', '— Selecione —');
    // DDI (país do celular): opções vindas da tabela PAIS (coluna DDI). Independente do campo País.
    const ddiSel = document.getElementById('cadastroDDI');
    if (ddiSel) {
      const fallbackDDI = { BR: '55', PY: '595', AR: '54', UY: '598' };
      ddiSel.innerHTML = '<option value="">—</option>';
      paises.forEach(p => {
        const ddi = (p.DDI != null && String(p.DDI).trim() !== '') ? String(p.DDI).trim() : fallbackDDI[(p.SGPAIS || '').toUpperCase()];
        const label = p.DSPAIS || p.SGPAIS || p.CDPAIS;
        if (ddi) {
          const opt = document.createElement('option');
          opt.value = ddi;
          opt.textContent = '+' + ddi + ' ' + label;
          ddiSel.appendChild(opt);
        }
      });
    }
  }
  async function loadLocaisPreferidosEstados() {
    const sel = document.getElementById('locaisEstado');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos</option>';
    const pais = document.getElementById('locaisPais')?.value?.trim();
    if (!pais) return;
    const url = (typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados');
    try {
      if (pais === 'BR') {
        const r = await fetch('/api/estados-brasil');
        const estados = await r.json();
        if (Array.isArray(estados)) estados.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.uf || e.UF;
          opt.textContent = e.nome || e.uf || e.UF;
          sel.appendChild(opt);
        });
      } else {
        const cdpais = getCdPaisFromPaisValue(pais);
        if (cdpais == null) return;
        const r = await fetch(url + '?cdpais=' + encodeURIComponent(cdpais));
        if (!r.ok) return;
        const lista = await r.json();
        if (Array.isArray(lista)) lista.forEach(e => {
          const cduf = e.CDUF != null ? e.CDUF : e.cduf;
          const nm = (e.NMESTADO || e.nmestado || e.ESTADO || e.estado || cduf || '').toString().trim();
          const opt = document.createElement('option');
          opt.value = cduf != null ? String(cduf) : '';
          opt.textContent = nm;
          if (opt.value) sel.appendChild(opt);
        });
      }
    } catch (err) { console.warn('Erro ao carregar estados:', err); }
  }
  async function loadLocaisPreferidosMesorregioes() {
    const sel = document.getElementById('locaisMesorregiao');
    if (!sel) return;
    sel.innerHTML = '<option value="">Todos</option>';
    const estadoVal = document.getElementById('locaisEstado')?.value?.trim();
    if (!estadoVal) return;
    let cduf = null;
    const n = parseInt(estadoVal, 10);
    if (!isNaN(n) && String(n) === estadoVal) cduf = n;
    else {
      try {
        const rCduf = await fetch(`/api/estado-cduf/${encodeURIComponent(estadoVal)}`);
        const d = await rCduf.json();
        cduf = d.CDUF;
      } catch (e) {}
    }
    if (cduf == null) return;
    try {
      const r = await fetch(`/api/mesorregioes/${cduf}`);
      const list = await r.json();
      if (Array.isArray(list)) list.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.CDMESOREGIAO ?? m.cdmesoregiao;
        opt.textContent = m.DSMESOREGIAO || m.dsmesoregiao || m.CDMESOREGIAO;
        sel.appendChild(opt);
      });
    } catch (err) { console.warn('Erro ao carregar mesorregiões:', err); }
  }
  function resetLocaisPreferidosAposPais() {
    const estadoSel = document.getElementById('locaisEstado');
    const mesoSel = document.getElementById('locaisMesorregiao');
    loadLocaisPreferidosEstados();
    if (estadoSel) estadoSel.value = '';
    if (mesoSel) {
      mesoSel.innerHTML = '<option value="">Todos</option>';
      mesoSel.value = '';
    }
  }
  function resetLocaisPreferidosAposEstado() {
    loadLocaisPreferidosMesorregioes();
    const mesoSel = document.getElementById('locaisMesorregiao');
    if (mesoSel) mesoSel.value = '';
  }
  document.getElementById('locaisTipo')?.addEventListener('change', function() {
    document.getElementById('locaisPais').value = '';
    resetLocaisPreferidosAposPais();
  });
  document.getElementById('locaisPais')?.addEventListener('change', function() {
    resetLocaisPreferidosAposPais();
  });
  document.getElementById('locaisEstado')?.addEventListener('change', function() {
    resetLocaisPreferidosAposEstado();
  });

  async function loadLocaisPreferidosLista(cadastroId) {
    const container = document.getElementById('locaisPreferidosLista');
    if (!container) return;
    if (!cadastroId) {
      container.innerHTML = '<p class="empty">Selecione um cadastro na aba Dados.</p>';
      return;
    }
    try {
      const r = await fetch(`/api/cadastros-gerais/${cadastroId}/locais-preferidos`, { headers: getAuthHeaders() });
      const lista = await r.json();
      if (!Array.isArray(lista)) throw new Error('Resposta inválida');
      renderLocaisPreferidosLista(lista, cadastroId);
    } catch (err) {
      container.innerHTML = '<p class="empty">Erro ao carregar lista. Verifique se a tabela CADASTRO_LOCAL_PREFERIDO existe.</p>';
    }
  }
  function renderLocaisPreferidosLista(lista, cadastroId) {
    const container = document.getElementById('locaisPreferidosLista');
    if (!container) return;
    if (cadastroId != null && cadastroId !== '') container.dataset.cadastroId = String(cadastroId);
    window.__lastLocaisPreferidosLista = lista || [];
    if (!lista || lista.length === 0) {
      container.innerHTML = '<p class="empty">Nenhum local cadastrado. Adicione acima.</p>';
      return;
    }
    const hasE = lista.some(x => x.TIPO === 'E');
    const hasD = lista.some(x => x.TIPO === 'D');
    const table = document.createElement('table');
    table.className = 'table-list';
    table.innerHTML = '<thead><tr><th>Tipo</th><th>País</th><th>Estado</th><th>Mesorregião</th><th></th></tr></thead><tbody></tbody>';
    const tbody = table.querySelector('tbody');
    lista.forEach(row => {
      const tr = document.createElement('tr');
      const tipoLabel = row.TIPO === 'D' ? 'Destino' : 'Origem';
      const paisLabel = getNomePais(row.PAIS);
      const estadoLabel = row.ESTADO_UF || 'Todos';
      const mesoLabel = row.DSMESOREGIAO || 'Todos';
      var seq = row.SEQUENCIA;
      var cid = String(cadastroId);
      tr.innerHTML = `<td>${tipoLabel}</td><td>${paisLabel}</td><td>${estadoLabel}</td><td>${mesoLabel}</td><td><button type="button" class="btn btn-small btn-remove" data-sequencia="${seq}" title="Excluir" onclick="event.preventDefault();event.stopPropagation();if(window.confirmarRemoverLocal)window.confirmarRemoverLocal('${seq}','${cid}')"><i class='bx bx-trash'></i></button></td>`;
      tr.querySelector('button')?.addEventListener('click', function(ev) {
        ev.preventDefault();
        ev.stopPropagation();
        confirmarRemoverLocal(seq, cid);
      });
      tbody.appendChild(tr);
    });
    container.innerHTML = '';
    if (!hasE || !hasD) {
      const warn = document.createElement('p');
      warn.className = 'message';
      warn.style.color = '#856404';
      warn.style.marginBottom = '12px';
      warn.textContent = 'É necessário pelo menos uma origem e um destino.';
      container.appendChild(warn);
    }
    container.appendChild(table);
  }

  function isLocalPreferidoDuplicado(tipo, pais, cduf, cdm, lista) {
    if (!lista || !Array.isArray(lista)) return false;
    const uf = cduf != null && cduf !== '' ? parseInt(cduf, 10) : null;
    const meso = cdm != null && cdm !== '' ? parseInt(cdm, 10) : null;
    const norm = (v) => (v != null && v !== '' ? Number(v) : null);
    return lista.some(item => {
      const itemUf = norm(item.CDUF);
      const itemMeso = norm(item.CDMESOREGIAO);
      return item.TIPO === tipo && String(item.PAIS || '').toUpperCase() === String(pais || '').toUpperCase()
        && (itemUf === uf || (itemUf == null && uf == null))
        && (itemMeso === meso || (itemMeso == null && meso == null));
    });
  }

  document.getElementById('btnAdicionarLocalPreferido')?.addEventListener('click', async () => {
    const id = document.getElementById('cadastroId')?.value?.trim();
    if (!id) {
      showMessage('Selecione um cadastro na aba Dados.', 'error');
      return;
    }
    const pais = document.getElementById('locaisPais')?.value?.trim();
    if (!pais) {
      showMessage('Informe o país.', 'error');
      return;
    }
    const tipo = document.getElementById('locaisTipo')?.value || 'E';
    let cduf = null;
    let cdm = null;
    const estadoVal = document.getElementById('locaisEstado')?.value?.trim();
    if (estadoVal) {
      const n = parseInt(estadoVal, 10);
      if (!isNaN(n) && String(n) === estadoVal) {
        cduf = n;
      } else {
        try {
          const r = await fetch(`/api/estado-cduf/${encodeURIComponent(estadoVal)}`);
          const d = await r.json();
          if (d.CDUF != null) cduf = d.CDUF;
        } catch (e) {}
      }
      const mesoVal = document.getElementById('locaisMesorregiao')?.value;
      if (mesoVal) cdm = parseInt(mesoVal, 10);
    }
    const listaAtual = window.__lastLocaisPreferidosLista || [];
    if (isLocalPreferidoDuplicado(tipo, pais, cduf, cdm, listaAtual)) {
      showMessage('Já existe um local preferido com o mesmo Tipo, País, Estado e Mesorregião.', 'error');
      return;
    }
    try {
      const r = await fetch(`/api/cadastros-gerais/${id}/locais-preferidos`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ TIPO: tipo, PAIS: pais, CDUF: cduf, CDMESOREGIAO: cdm })
      });
      const data = await r.json();
      if (r.ok && data.lista) {
        showMessage(data.message || 'Adicionado.', 'success');
        renderLocaisPreferidosLista(data.lista, id);
        const hasE = data.lista.some(x => x.TIPO === 'E');
        const hasD = data.lista.some(x => x.TIPO === 'D');
        if (!hasE || !hasD) showMessage('É necessário pelo menos uma origem e um destino.', 'error');
      } else {
        showMessage(data.error || 'Erro ao adicionar.', 'error');
      }
    } catch (err) {
      showMessage('Erro de conexão.', 'error');
    }
  });

  document.querySelector('.tab-btn[data-tab="locais-preferidos"]')?.addEventListener('click', function() {
    const id = document.getElementById('cadastroId')?.value?.trim();
    if (id) loadLocaisPreferidosLista(id);
  });

  // Aplicar máscara na inicialização se o campo já existir
  setTimeout(() => {
    aplicarMascaraCPFCNPJ();
  }, 500);

  document.getElementById('cadastroCelular')?.addEventListener('input', function(e) {
    const ddi = document.getElementById('cadastroDDI')?.value?.replace(/\D/g, '') || '55';
    const value = e.target.value.replace(/\D/g, '');
    e.target.value = formatarCelularPorDdi(ddi, value);
  });
  document.getElementById('cadastroDDI')?.addEventListener('change', function() {
    const celularEl = document.getElementById('cadastroCelular');
    if (!celularEl) return;
    const ddi = this.value?.replace(/\D/g, '') || '55';
    celularEl.value = formatarCelularPorDdi(ddi, celularEl.value.replace(/\D/g, ''));
  });

  document.getElementById('cadastroCEP')?.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 8) value = value.substring(0, 8);
    e.target.value = value.replace(/(\d{5})(\d{0,3})/, '$1-$2');
  });

  // Evento de estado para carregar cidades
  document.getElementById('cadastroEstado')?.addEventListener('change', function() {
    const estado = this.value;
    if (estado) {
      loadCidadesPorEstado(estado, 'dados');
      document.getElementById('cadastroCidade').value = '';
      document.getElementById('cadastroCodigoCidade').value = '';
    } else {
      document.getElementById('cadastroCidade').innerHTML = '<option value="">Selecione um estado primeiro</option>';
      document.getElementById('cadastroCodigoCidade').value = '';
    }
  });

  // Evento de cidade para atualizar código
  document.getElementById('cadastroCidade')?.addEventListener('change', function() {
    const cidadeId = this.value;
    document.getElementById('cadastroCodigoCidade').value = cidadeId || '';
  });

  // Event listener para mostrar/esconder campo Transportador e aba Locais preferidos quando [M] Motorista for marcado
  ['chkM', 'chkO', 'chkP', 'chkT', 'chkA', 'chkG', 'chkC', 'chkU'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', function() {
      const chkM = document.getElementById('chkM');
      const divTransportador = document.getElementById('divTransportador');
      const selectTransportador = document.getElementById('cadastroTransportador');
      const divSenhaMotorista = document.getElementById('divSenhaMotorista');
      if (chkM?.checked) {
        if (divTransportador) divTransportador.style.display = 'block';
        if (divSenhaMotorista) divSenhaMotorista.style.display = 'block';
        if (selectTransportador && selectTransportador.options.length <= 1) loadTransportadores();
      } else {
        if (divTransportador) divTransportador.style.display = 'none';
        if (divSenhaMotorista) divSenhaMotorista.style.display = 'none';
        if (selectTransportador) selectTransportador.value = '';
      }
      atualizarVisibilidadeLocaisPreferidos();
    });
  });

  // Carregar transportadores (tipo T)
  async function loadTransportadores() {
    try {
      const selectTransportador = document.getElementById('cadastroTransportador');
      const selectFiltroTransportador = document.getElementById('filtroTransportador');
      
      if (!selectTransportador && !selectFiltroTransportador) return;
      
      const response = await fetch('/api/cadastros-gerais/transportadores');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const transportadores = await response.json();
      if (!Array.isArray(transportadores)) {
        console.warn('Resposta de transportadores não é array:', transportadores);
        return;
      }

      const getCd = (t) => (t.CDCADASTRO != null ? t.CDCADASTRO : t.cdcadastro);
      const getRz = (t) => (t.RZSOCIAL != null ? t.RZSOCIAL : t.rzsocial) || '-';

      // Popular combo do formulário
      if (selectTransportador) {
        selectTransportador.innerHTML = '<option value="">Selecione</option>';
        transportadores.forEach(t => {
          const cd = getCd(t);
          if (cd == null || cd === '') return;
          const opt = document.createElement('option');
          opt.value = cd;
          opt.textContent = `${cd} - ${getRz(t)}`;
          selectTransportador.appendChild(opt);
        });
      }

      // Popular combo do filtro
      if (selectFiltroTransportador) {
        selectFiltroTransportador.innerHTML = '<option value="">Todos</option>';
        transportadores.forEach(t => {
          const cd = getCd(t);
          if (cd == null || cd === '') return;
          const opt = document.createElement('option');
          opt.value = cd;
          opt.textContent = `${cd} - ${getRz(t)}`;
          selectFiltroTransportador.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('Erro ao carregar transportadores:', err);
    }
  }

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

  // Eventos de edição e exclusão - delegação de eventos (adicionado uma vez)
  // Usar delegação de eventos para funcionar com elementos dinâmicos
  if (list) {
    list.addEventListener('click', (e) => {
      // Verificar se o clique foi em um botão de editar ou excluir
      const btn = e.target.closest('.btn.edit, .btn.delete');
      if (!btn) return;
      
      // Verificar se o botão está dentro de um list-item (não é do modal)
      const listItem = btn.closest('.list-item');
      if (!listItem) {
        return; // Ignorar se não estiver dentro de um item da lista
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      // Tentar pegar o ID de múltiplas formas
      let id = btn.getAttribute('data-id');
      if (!id || id === 'null' || id === 'undefined' || id === '') {
        id = listItem.getAttribute('data-id');
      }
      
      // Validar o ID
      if (!id || id === 'null' || id === 'undefined' || id === '' || id === 'NaN') {
        console.error('ID inválido ao clicar no botão:', {
          btnDataId: btn.getAttribute('data-id'),
          btnDatasetId: btn.dataset?.id,
          listItemDataId: listItem.getAttribute('data-id'),
          listItemDatasetId: listItem.dataset?.id,
          btnHTML: btn.outerHTML.substring(0, 100),
          listItemHTML: listItem.outerHTML.substring(0, 200)
        });
        showMessage('Erro: ID não disponível para esta ação.', 'error');
        return;
      }
      
      if (btn.classList.contains('edit')) {
        loadCadastroParaEdicao(id);
      } else if (btn.classList.contains('delete')) {
        confirmarExclusao(id);
      }
    });
  }

  // =======================
  // ABA VALIDADES
  // =======================
  
  let validadesCarregadas = false;
  let cadastroAtualValidades = null;
  
  // Inicializar aba Validades
  async function inicializarAbaValidades() {
    const btnVoltar = document.getElementById('btnVoltarDadosValidades');
    const btnNova = document.getElementById('btnNovaValidade');
    const btnCancelar = document.getElementById('btnCancelarValidade');
    const formValidade = document.getElementById('formValidade');
    
    if (btnVoltar && !btnVoltar.dataset.listenerAdded) {
      btnVoltar.dataset.listenerAdded = 'true';
      btnVoltar.addEventListener('click', () => showTab('dados'));
    }
    
    if (btnNova && !btnNova.dataset.listenerAdded) {
      btnNova.dataset.listenerAdded = 'true';
      btnNova.addEventListener('click', abrirModalNovaValidade);
    }
    
    const btnFechar = document.getElementById('btnFecharModalValidade');
    
    if (btnCancelar && !btnCancelar.dataset.listenerAdded) {
      btnCancelar.dataset.listenerAdded = 'true';
      btnCancelar.addEventListener('click', () => {
        document.getElementById('modalValidade').style.display = 'none';
      });
    }
    
    if (btnFechar && !btnFechar.dataset.listenerAdded) {
      btnFechar.dataset.listenerAdded = 'true';
      btnFechar.addEventListener('click', () => {
        document.getElementById('modalValidade').style.display = 'none';
      });
    }
    
    if (formValidade && !formValidade.dataset.listenerAdded) {
      formValidade.dataset.listenerAdded = 'true';
      formValidade.addEventListener('submit', salvarValidade);
    }
    
    // Carregar validades do cadastro atual
    const cdCadastro = document.getElementById('cadastroId')?.value || document.getElementById('cadastroCodigo')?.value;
    const tpCadastro = obterTipoCadastro();
    
    if (cdCadastro && tpCadastro) {
      await carregarValidadesCadastro(tpCadastro, cdCadastro);
    }
  }
  
  function obterTipoCadastro() {
    const ordem = ['M', 'T', 'C', 'O', 'P', 'A', 'G', 'U'];
    const chkIds = { M: 'chkM', T: 'chkT', C: 'chkC', O: 'chkO', P: 'chkP', A: 'chkA', G: 'chkG', U: 'chkU' };
    const mapeamento = { 'M': 'MOT', 'T': 'TRA', 'C': 'CLI', 'O': 'CLI', 'P': 'CLI', 'A': 'CLI', 'G': 'CLI', 'U': 'CLI' };
    for (const cod of ordem) {
      const el = document.getElementById(chkIds[cod]);
      if (el && el.checked) return mapeamento[cod] || 'MOT';
    }
    return 'MOT';
  }
  
  async function carregarValidadesCadastro(tpCadastro, cdCadastro) {
    try {
      // Atualizar info do cadastro
      const nomeCadastro = document.getElementById('cadastroRazaoSocial')?.value || 'Cadastro';
      document.getElementById('validadesNomeCadastro').textContent = nomeCadastro;
      document.getElementById('validadesCodigoCadastro').textContent = cdCadastro;
      const tipoNome = tpCadastro === 'MOT' ? 'Motorista' : tpCadastro === 'EQP' ? 'Equipamento' : 'Cadastro';
      document.getElementById('validadesTipoCadastro').textContent = tipoNome;
      document.getElementById('validadesCadastroInfo').style.display = 'block';
      
      // Buscar validades
      const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}`);
      const data = await response.json();
      const validades = response.ok && Array.isArray(data) ? data : [];
      
      if (!response.ok) {
        console.warn('API validades retornou', response.status, data?.error || data);
        showMessage(data?.error || 'Erro ao carregar validades', 'error');
      }
      
      cadastroAtualValidades = { tpCadastro, cdCadastro };
      
      // Atualizar contador
      const countText = document.getElementById('validadesCountText');
      if (countText) {
        countText.textContent = `${validades.length} validade(s) encontrada(s)`;
        document.getElementById('validadesCount').style.display = 'block';
      }
      
      renderizarValidadesGrid(validades);
      
      // Carregar combos para o modal
      await carregarCombosTiposValidade(tpCadastro);
      await carregarCombosCertificadoras();
      
      validadesCarregadas = true;
    } catch (err) {
      console.error('Erro ao carregar validades:', err);
      showMessage('Erro ao carregar validades', 'error');
    }
  }
  
  function renderizarValidadesGrid(validades) {
    const grid = document.getElementById('validadesGrid');
    if (!grid) return;
    
    if (!validades || !Array.isArray(validades) || validades.length === 0) {
      grid.innerHTML = '<p class="empty">Nenhuma validade cadastrada para este cadastro.</p>';
      return;
    }
    
    let html = '<div style="display: grid; gap: 12px;">';
    
    const loc = (contextoCadastro && contextoCadastro.locale) || 'pt-BR';
    const tz = (contextoCadastro && contextoCadastro.timezone) || 'America/Sao_Paulo';
    const fmtData = (d) => {
      if (!d) return '';
      const date = new Date(d);
      if (Number.isNaN(date.getTime())) return '';
      try {
        return new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: 'short' }).format(date);
      } catch (e) { return date.toLocaleDateString(loc); }
    };
    validades.forEach(val => {
      const dtLib = fmtData(val.DTLIBERACAO);
      const dtVal = fmtData(val.DTVALIDADE);
      const dias = val.DIAS_RESTANTES;
      const removida = val.FGATIVO === 'N' || val.FGATIVO === 'n';
      const dtRemovida = val.DHREMOVIDO ? fmtData(val.DHREMOVIDO) : '';
      const userRemovido = val.SGUSER_REMOVIDO || '—';
      
      let corStatus = '#27ae60';
      let textoStatus = `✓ Válida (${dias} dias)`;
      let statusTipo = 'valida';
      
      if (removida) {
        corStatus = '#95a5a6';
        textoStatus = 'Removida (histórico)';
        statusTipo = 'removida';
      } else if (val.STATUS_VALIDADE === 'VENCIDA') {
        corStatus = '#e74c3c';
        textoStatus = `✗ VENCIDA (${Math.abs(dias)} dias atrás)`;
        statusTipo = 'vencida';
      } else if (val.STATUS_VALIDADE === 'VENCENDO') {
        corStatus = '#f39c12';
        textoStatus = `⚠ Vencendo (${dias} dias)`;
        statusTipo = 'vencendo';
      }
      
      const cardBg = removida ? '#f8f9fa' : '#fff';
      const cardBorder = removida ? '#dee2e6' : '#e9ecef';
      
      html += `
        <div class="validade-card" style="background: ${cardBg}; border: 1px solid ${cardBorder}; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px; ${removida ? 'opacity: 0.92;' : ''}">
          <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
          <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
              <div class="validade-card-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
                <div style="flex: 1; min-width: 200px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px;">
                    <span class="validade-status-badge" data-status="${statusTipo}" style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
                <div class="validade-card-actions" style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                  <button onclick="window.verDadosValidade('${val.SEQUENCIA}')" class="btn btn-primary btn-sm">
                    <i class='bx bx-show'></i> Ver Dados
                  </button>
                  ${!removida ? `
                  <button onclick="window.excluirValidade('${val.SEQUENCIA}')" class="btn btn-secondary btn-sm" style="background: #e74c3c;">
                    <i class='bx bx-trash'></i> Remover
                  </button>
                  ` : ''}
                </div>
              </div>
            </div>
            <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
              </div>
              ${val.SGUSER_LIBERACAO ? `
              <div style="display: flex; align-items: center; gap: 6px; color: #6c757d;">
                <i class='bx bx-user-check' style="font-size: 14px;"></i>
                <span style="font-weight: 500;">Liberado por <strong>${val.SGUSER_LIBERACAO}</strong></span>
              </div>
              ` : ''}
              <div style="display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
              </div>
              ${removida && (dtRemovida || userRemovido !== '—') ? `
              <div style="display: flex; align-items: center; gap: 6px; color: #6c757d;">
                <i class='bx bx-user-x' style="font-size: 14px;"></i>
                <span style="font-weight: 500;">Removida em ${dtRemovida || '—'} por <strong>${userRemovido}</strong></span>
              </div>
              ` : ''}
              ${val.DSLIBERACAO ? `
              <div style="display: flex; align-items: center; gap: 6px; flex: 1; min-width: 200px;">
                <i class='bx bx-note' style="color: #6c757d; font-size: 14px;"></i>
                <span style="color: #6c757d; font-weight: 500;">Obs:</span>
                <strong style="color: #495057; margin-left: 4px;">${val.DSLIBERACAO}</strong>
              </div>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    grid.innerHTML = html;
  }
  
  async function carregarCombosTiposValidade(tpCadastro) {
    try {
      const response = await fetch(`/api/validades/tipos-combo/${tpCadastro}`);
      
      if (!response.ok) {
        console.error('[VALIDADES] Erro ao buscar tipos:', response.status);
        return;
      }
      
      const tipos = await response.json();
      
      const select = document.getElementById('validadeTipo');
      if (select) {
        select.innerHTML = '<option value="">Selecione...</option>';
        
        if (Array.isArray(tipos)) {
          tipos.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.CDTIPOVALIDADE;
            opt.textContent = t.DSTIPOVALIDADE;
            opt.dataset.exigeCert = t.FGEXIGECERTIFICADORA;
            select.appendChild(opt);
          });
        } else {
          console.error('[VALIDADES] Tipos não é array:', tipos);
        }
      }
    } catch (err) {
      console.error('[VALIDADES] Erro ao carregar tipos:', err);
    }
  }
  
  async function carregarCombosCertificadoras() {
    try {
      const response = await fetch('/api/validades/certificadoras-combo');
      
      if (!response.ok) {
        console.error('[VALIDADES] Erro ao buscar certificadoras:', response.status);
        return;
      }
      
      const certs = await response.json();
      
      const select = document.getElementById('validadeCertificadora');
      if (select) {
        select.innerHTML = '<option value="">Não Aplicável</option>';
        
        if (Array.isArray(certs)) {
          certs.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCADASTRO;
            opt.textContent = `${c.CDCADASTRO} - ${c.RZSOCIAL}`;
            select.appendChild(opt);
          });
        } else {
          console.error('[VALIDADES] Certificadoras não é array:', certs);
        }
      }
    } catch (err) {
      console.error('[VALIDADES] Erro ao carregar certificadoras:', err);
    }
  }
  
  function abrirModalNovaValidade() {
    const nomeCadastro = document.getElementById('cadastroRazaoSocial')?.value || 'Cadastro';
    document.getElementById('modalValidadeTitulo').innerHTML = '<i class=\'bx bx-file-blank\'></i> Nova Validade';
    document.getElementById('modalValidadeSubtitulo').textContent = `Cadastrando validade para: ${nomeCadastro}`;
    
    // Limpar formulário
    document.getElementById('formValidade').reset();
    document.getElementById('validadeSequencia').value = '';
    
    // Limpar certificadora
    document.getElementById('validadeCertificadora').value = '';
    document.getElementById('certCpfCnpj').value = '';
    document.getElementById('certCodigo').value = '';
    document.getElementById('certNome').value = '';
    const certResultado = document.getElementById('certResultado');
    certResultado.className = '';
    certResultado.innerHTML = '<i class=\'bx bx-info-circle\'></i><span id="certTexto">Nenhuma certificadora selecionada</span>';
    
    setModalValidadeSomenteLeitura(false);
    document.getElementById('modalValidade').style.display = 'flex';
  }
  
  window.editarValidade = async function(sequencia, somenteLeitura) {
    if (!cadastroAtualValidades) return;
    
    const isVerDados = !!somenteLeitura;
    
    try {
      const { tpCadastro, cdCadastro } = cadastroAtualValidades;
      
      // IMPORTANTE: Carregar combos ANTES de buscar os dados
      await carregarCombosTiposValidade(tpCadastro);
      await carregarCombosCertificadoras();
      
      // Aguardar renderização dos combos
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}`);
      const validades = await response.json();
      const val = validades.find(v => v.SEQUENCIA == sequencia);
      
      if (val) {
        const nomeCadastro = document.getElementById('cadastroRazaoSocial')?.value || 'Cadastro';
        if (isVerDados) {
          document.getElementById('modalValidadeTitulo').innerHTML = '<i class=\'bx bx-show\'></i> Ver Dados - Validade';
          setModalValidadeSomenteLeitura(true);
        } else {
          document.getElementById('modalValidadeTitulo').innerHTML = '<i class=\'bx bx-edit\'></i> Editar Validade';
          setModalValidadeSomenteLeitura(false);
        }
        document.getElementById('modalValidadeSubtitulo').textContent = `${val.DSTIPOVALIDADE} • ${nomeCadastro}`;
        document.getElementById('validadeSequencia').value = val.SEQUENCIA;
        
        // Preencher campos APÓS combos carregados
        document.getElementById('validadeTipo').value = val.CDTIPOVALIDADE;
        document.getElementById('validadeNrLiberacao').value = val.NRLIBERACAO;
        document.getElementById('validadeDtLiberacao').value = new Date(val.DTLIBERACAO).toISOString().split('T')[0];
        document.getElementById('validadeDtValidade').value = new Date(val.DTVALIDADE).toISOString().split('T')[0];
        document.getElementById('validadeDsLiberacao').value = val.DSLIBERACAO || '';
        
        // Preencher certificadora (campo hidden + mostrar nome)
        const certResultado = document.getElementById('certResultado');
        
        if (val.CDCERTIFICADORA && val.CERTIFICADORA_NOME) {
          document.getElementById('validadeCertificadora').value = val.CDCERTIFICADORA;
          certResultado.className = 'certificadora-selecionada';
          certResultado.innerHTML = '<i class=\'bx bx-check-circle\'></i><span id="certTexto"><strong>✓ ' + val.CERTIFICADORA_NOME + '</strong> (Código: ' + val.CDCERTIFICADORA + ')</span>';
        } else if (val.CDCERTIFICADORA) {
          // Tem código mas não tem nome (buscar)
          document.getElementById('validadeCertificadora').value = val.CDCERTIFICADORA;
          certResultado.className = 'certificadora-aviso';
          certResultado.innerHTML = '<i class=\'bx bx-error-circle\'></i><span id="certTexto"><strong>⚠ Certificadora código ' + val.CDCERTIFICADORA + '</strong></span>';
        } else {
          document.getElementById('validadeCertificadora').value = '';
          certResultado.className = '';
          certResultado.innerHTML = '<i class=\'bx bx-info-circle\'></i><span id="certTexto">Nenhuma certificadora selecionada</span>';
        }
        
        document.getElementById('modalValidade').style.display = 'flex';
      }
    } catch (err) {
      console.error('Erro ao editar:', err);
      showMessage('Erro ao carregar validade', 'error');
    }
  };
  
  /** Alterna o modal de validade entre modo edição e somente leitura (Ver Dados). */
  function setModalValidadeSomenteLeitura(readOnly) {
    const ids = ['validadeTipo', 'validadeNrLiberacao', 'validadeDtLiberacao', 'validadeDtValidade', 'validadeDsLiberacao', 'certCpfCnpj', 'certCodigo', 'certNome'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.disabled = readOnly;
        el.readOnly = readOnly;
      }
    });
    const btnSalvar = document.getElementById('btnSalvarValidade');
    if (btnSalvar) btnSalvar.style.display = readOnly ? 'none' : '';
    const certContainer = document.getElementById('certificadoraBuscaContainer');
    if (certContainer) {
      const grid = certContainer.querySelector('.certificadora-busca-grid');
      if (grid) grid.style.display = readOnly ? 'none' : '';
    }
    const btnCancelar = document.getElementById('btnCancelarValidade');
    if (btnCancelar) {
      btnCancelar.innerHTML = readOnly ? '<i class=\'bx bx-x\'></i> Fechar' : '<i class=\'bx bx-x\'></i> Cancelar';
    }
  }
  
  /** Abre o modal em modo "Ver Dados" (somente leitura). */
  window.verDadosValidade = function(sequencia) {
    window.editarValidade(sequencia, true);
  };
  
  window.excluirValidade = function(sequencia) {
    console.log('[CadastroGeral] excluirValidade chamada, sequencia=', sequencia);
    const modalEl = document.getElementById('confirmModal');
    const modalMsg = document.getElementById('modalMessage');
    const btnYes = document.getElementById('confirmYes');
    const btnNo = document.getElementById('confirmNo');
    console.log('[CadastroGeral] excluirValidade modal:', { modalEl: !!modalEl, modalMsg: !!modalMsg, btnYes: !!btnYes, btnNo: !!btnNo });
    if (!modalEl || !modalMsg || !btnYes || !btnNo) return;
    modalMsg.textContent = 'Desativar esta validade? Ela permanecerá no histórico com data e usuário da remoção (dados para seguro).';
    btnYes.className = 'btn-filtro btn-filtro-danger';
    btnYes.innerHTML = '<i class=\'bx bx-check\'></i> Desativar';
    btnNo.className = 'btn-filtro btn-filtro-limpar';
    btnNo.innerHTML = '<i class=\'bx bx-x\'></i> ' + (t('web.modulos.cadastroGeral.cancelar') || 'Cancelar');
    btnNo.onclick = () => { modalEl.style.display = 'none'; };
    if (modalEl.parentNode !== document.body) document.body.appendChild(modalEl);
    modalEl.style.display = 'block';
    modalEl.style.zIndex = '99999';
    btnYes.onclick = async () => {
      try {
        const { tpCadastro, cdCadastro } = cadastroAtualValidades;
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        const usuario = user.login || 'SYSTEM';
        const response = await fetch(`/api/validades/${tpCadastro}/${cdCadastro}/${sequencia}`, {
          method: 'DELETE',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ usuario })
        });
        const data = await response.json();
        if (response.ok) {
          showMessage('Validade desativada. Registro mantido para histórico.', 'success');
          await carregarValidadesCadastro(tpCadastro, cdCadastro);
        } else {
          showMessage(data.error || 'Erro ao desativar', 'error');
        }
      } catch (err) {
        showMessage('Erro ao desativar', 'error');
      } finally {
        modalEl.style.display = 'none';
      }
    };
  };

  // Funções de busca de certificadora
  window.buscarCertPorCpf = async function() {
    const cpf = document.getElementById('certCpfCnpj').value.replace(/\D/g, '');
    if (!cpf) {
      showMessage('Digite o CPF/CNPJ', 'error');
      return;
    }
    await buscarCertificadora('cgccpf', cpf);
  };
  
  window.buscarCertPorCodigo = async function() {
    const codigo = document.getElementById('certCodigo').value;
    if (!codigo) {
      showMessage('Digite o código', 'error');
      return;
    }
    await buscarCertificadora('codigo', codigo);
  };
  
  window.buscarCertPorNome = async function() {
    const nome = document.getElementById('certNome').value.trim();
    if (!nome || nome.length < 3) {
      showMessage('Digite pelo menos 3 caracteres do nome', 'error');
      return;
    }
    await buscarCertificadora('razaoSocial', nome);
  };
  
  async function buscarCertificadora(tipo, valor) {
    try {
      const params = new URLSearchParams();
      params.append(tipo, valor);
      params.append('situacao', 'S'); // Apenas ativos
      params.append('tipoCadastro', 'C'); // Somente certificadoras (FGTIPOCADASTRO = C)

      const response = await fetch(`/api/cadastros-gerais?${params.toString()}`);
      const cadastros = await response.json();

      const certResultado = document.getElementById('certResultado');

      if (cadastros && cadastros.length > 0) {
        const cert = cadastros[0];
        const cod = cert.CDCADASTRO ?? cert.cdcadastro;
        const nome = cert.RZSOCIAL ?? cert.rzsocial;
        document.getElementById('validadeCertificadora').value = cod;
        certResultado.className = 'certificadora-selecionada';
        certResultado.innerHTML = '<i class=\'bx bx-check-circle\'></i><span id="certTexto"><strong>✓ ' + (nome || '') + '</strong> (Código: ' + cod + ')</span>';
        showMessage('Certificadora encontrada!', 'success');
      } else {
        certResultado.className = 'certificadora-erro';
        certResultado.innerHTML = '<i class=\'bx bx-x-circle\'></i><span id="certTexto"><strong>✗ Nenhuma certificadora encontrada</strong></span>';
        showMessage('Certificadora não encontrada', 'error');
      }
    } catch (err) {
      console.error('Erro ao buscar certificadora:', err);
      showMessage('Erro ao buscar certificadora', 'error');
    }
  }
  
  async function salvarValidade(e) {
    e.preventDefault();
    
    if (document.getElementById('btnSalvarValidade')?.style.display === 'none') return;
    if (!cadastroAtualValidades) return;
    
    try {
      const { tpCadastro, cdCadastro } = cadastroAtualValidades;
      const sequencia = document.getElementById('validadeSequencia').value;
      
      const dados = {
        CDTIPOVALIDADE: document.getElementById('validadeTipo').value,
        NRLIBERACAO: document.getElementById('validadeNrLiberacao').value,
        DTLIBERACAO: document.getElementById('validadeDtLiberacao').value,
        DTVALIDADE: document.getElementById('validadeDtValidade').value,
        CDCERTIFICADORA: document.getElementById('validadeCertificadora').value || null,
        DSLIBERACAO: document.getElementById('validadeDsLiberacao').value
      };
      if (!sequencia) {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        if (user.login) dados.SGUSER = user.login;
      }
      
      const url = sequencia 
        ? `/api/validades/${tpCadastro}/${cdCadastro}/${sequencia}`
        : `/api/validades/${tpCadastro}/${cdCadastro}`;
      
      const method = sequencia ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      });
      
      const data = await response.json();
      
      if (response.ok) {
        showMessage(data.message || 'Validade salva!', 'success');
        document.getElementById('modalValidade').style.display = 'none';
        await carregarValidadesCadastro(tpCadastro, cdCadastro);
      } else {
        showMessage(data.error || 'Erro ao salvar', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar validade:', err);
      showMessage('Erro ao salvar validade', 'error');
    }
  }

  // Função para mostrar ajuda (PADRÃO ÚNICO)
  window.mostrarAjudaCadastroGeral = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaCadastroGeral');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaCadastroGeral';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Cadastro Geral</h3>
          <button onclick="window.fecharModalAjudaCadastroGeral()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Cadastro Geral</strong> permite gerenciar todos os cadastros do sistema, incluindo operadores, motoristas, agentes, grupos, transportadores e unidades de negócio.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar cadastros específicos por código, CPF/CNPJ, razão social, tipo, situação, etc.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar cadastros</li>
            <li><strong>Grid:</strong> Visualizar cadastros em formato de tabela</li>
            <li><strong>Dados:</strong> Criar e editar cadastros</li>
            <li><strong>Classes Frota:</strong> Gerenciar classes de frota permitidas</li>
            <li><strong>Validades:</strong> Gerenciar validades de documentos e certificações</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaCadastroGeral()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaCadastroGeral = function() {
    const modal = document.getElementById('modalAjudaCadastroGeral');
    if (modal) {
      modal.remove();
    }
  };

  // Fechar modal de ajuda ao clicar fora
  document.addEventListener('click', (e) => {
    const modal = document.getElementById('modalAjudaCadastroGeral');
    if (modal && e.target === modal) {
      window.fecharModalAjudaCadastroGeral();
    }
  });

  // Delegação de cliques: remover listener anterior (se existir) e registrar novo a cada carga do módulo.
  if (window.__cadastroGeralClickDelegate) {
    document.removeEventListener('click', window.__cadastroGeralClickDelegate, true);
    console.log('[CadastroGeral] listener antigo removido');
  }
  window.__cadastroGeralClickDelegate = function(e) {
    if (!e.target || typeof e.target.closest !== 'function') return;
    var inModule = e.target.closest('.cadastro-geral-container') || (document.getElementById('contentArea') && e.target.closest('#contentArea') && (document.getElementById('cadastrosGrid') || document.getElementById('locaisPreferidosLista')));
    if (!inModule) return;
    var isGridDelete = e.target.closest('#cadastrosGrid .grid-btn-delete');
    var isLocaisRemove = e.target.closest('#locaisPreferidosLista .btn-remove');
    if (isGridDelete || isLocaisRemove) {
      console.log('[CadastroGeral] clique no módulo em botão de ação:', isGridDelete ? 'grid-delete' : 'locais-remove', 'target=', e.target.tagName, e.target.className);
    }
    // 1) Botão Excluir da grid
    var gridBtn = e.target.closest('#cadastrosGrid .grid-btn-delete');
    if (gridBtn) {
      var row = gridBtn.closest('tr[data-grid-id]');
      if (row) {
        var id = (row.getAttribute('data-grid-id') || '').trim();
        if (id && id !== 'undefined' && id !== 'null') {
          console.log('[CadastroGeral] clique grid Excluir, id=', id);
          e.preventDefault();
          e.stopPropagation();
          confirmarExclusao(id);
          return;
        }
      }
    }
    // 2) Botão Remover da Lista de locais preferidos
    var removeBtn = e.target.closest('#locaisPreferidosLista .btn-remove');
    if (removeBtn) {
      var sequencia = (removeBtn.getAttribute('data-sequencia') || '').trim();
      var container = document.getElementById('locaisPreferidosLista');
      var cadastroIdRaw = container && container.dataset.cadastroId ? container.dataset.cadastroId : (document.getElementById('cadastroId') && document.getElementById('cadastroId').value);
      var cadastroId = (cadastroIdRaw || '').trim();
      if (sequencia && cadastroId) {
        console.log('[CadastroGeral] clique Locais Excluir, seq=', sequencia, 'cadastroId=', cadastroId);
        e.preventDefault();
        e.stopPropagation();
        confirmarRemoverLocal(sequencia, cadastroId);
      }
    }
  };
  document.addEventListener('click', window.__cadastroGeralClickDelegate, true);
  console.log('[CadastroGeral] listener de clique registrado em document (capture=true), .cadastro-geral-container no DOM:', !!document.querySelector('.cadastro-geral-container'));
})();