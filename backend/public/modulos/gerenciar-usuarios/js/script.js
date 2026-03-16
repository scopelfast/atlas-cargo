// backend/public/modulos/gerenciar-usuarios/js/script.js
// Gerenciar Usuários - Frontend
// Versão: 1.0
// Atlas Cargo
// i18n: helper t() e chaves web.modulos.usuarios

(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const usuarioForm = document.getElementById('usuarioForm');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let gridTab = null;
  let lastUsuarios = null;
  let sqlExecutado = false;
  let initExecutado = false;
  let usuarioSelecionadoAcessos = null;
  let usuarioEmEdicao = null; // Armazena o login do usuário sendo editado
  let empresasDisponiveis = [];
  let filiaisDisponiveis = [];
  let atividadesDisponiveis = [];
  let empresasSelecionadas = [];
  let filiaisSelecionadas = [];

  // Headers de autenticação para as chamadas à API
  function getAuthHeaders(extra = {}) {
    const headers = { ...extra };
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const userStr = typeof localStorage !== 'undefined' ? localStorage.getItem('user') : null;
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        if (u && u.login) headers['user-login'] = u.login;
      } catch (e) {}
    }
    return headers;
  }

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
  window.hideLoadingOverlayInitSQL = hideLoadingOverlayInitSQL;

  // Função para carregar e executar o arquivo init.sql
  async function executarInitSQL() {
    if (sqlExecutado) return;
    sqlExecutado = true;
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const response = await fetch('/modulos/gerenciar-usuarios/sql/init.sql');
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
        execResponse = await fetch('/api/usuarios/executar-init-sql', {
          method: 'POST',
          headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
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

  // Anexar listeners após o DOM do módulo estar pronto (evita bug quando injetado pelo dashboard)
  function attachEventListeners() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        if (tabId) showTab(tabId);
      });
    });

    const formFiltro = document.getElementById('filtroForm');
    const formUsuario = document.getElementById('usuarioForm');
    if (formFiltro) {
      formFiltro.removeEventListener('submit', onFiltroSubmit);
      formFiltro.addEventListener('submit', onFiltroSubmit);
    }
    if (formUsuario) {
      formUsuario.removeEventListener('submit', salvarUsuario);
      formUsuario.addEventListener('submit', salvarUsuario);
    }
    document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
      formFiltro?.reset();
      lastUsuarios = null;
      const countEl = document.getElementById('usuariosGridCountText');
      if (countEl) countEl.textContent = t('web.modulos.usuarios.registrosEncontrados');
      const gridEl = document.getElementById('usuariosGrid');
      if (gridEl) gridEl.innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
    });
    document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
      limparFormulario();
      showTab('dados');
    });
    document.getElementById('btnVoltarGrid')?.addEventListener('click', () => showTab('filtros'));
    document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
      limparFormulario();
      showTab('dados');
    });
    document.getElementById('btnCancelar')?.addEventListener('click', () => {
      limparFormulario();
      showTab('filtros');
    });
    document.getElementById('btnBuscarCadastro')?.addEventListener('click', abrirModalBuscaCadastro);
    document.getElementById('btnLimparCadastro')?.addEventListener('click', limparCadastroSelecionado);
    document.getElementById('btnFecharBuscaCadastro')?.addEventListener('click', () => {
      const modal = document.getElementById('buscaCadastroModal');
      if (modal) modal.style.display = 'none';
    });
    document.getElementById('buscaCadastroInput')?.addEventListener('input', buscarCadastros);
    document.getElementById('buscaCadastroInput')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        buscarCadastros();
      }
    });
    document.getElementById('buscaCadastroModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'buscaCadastroModal') {
        const modal = document.getElementById('buscaCadastroModal');
        if (modal) modal.style.display = 'none';
      }
    });
    document.getElementById('toggleSenha')?.addEventListener('click', toggleSenha);
    const senhaEl = document.getElementById('usuarioSenha');
    if (senhaEl) senhaEl.addEventListener('input', verificarForcaSenha);
  }

  function onFiltroSubmit(e) {
    e.preventDefault();
    e.stopPropagation();
    applyFilters('grid');
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
    await loadEmpresasParaFiltro();
    await showTab('filtros');

    // Anexar listeners após o DOM estar pronto (corrige filtro/editar quando módulo é injetado)
    attachEventListeners();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Função para mudar abas (escopo no container do módulo para não misturar Grid/Dados)
  async function showTab(tabId) {
    try {
      const tabContent = document.getElementById(`tab-${tabId}`);
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      if (tabContent && tabBtn) {
        const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
        if (container) {
          container.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
          container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        }
        tabBtn.classList.add('active');
        tabContent.classList.add('active');
      }

      // Aguardar um frame para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));

      if (tabId === 'acessos') {
        // Limpar dados anteriores ao abrir a aba
        limparDadosAcessos();
        await carregarUsuariosParaAcessos();
        await carregarTodasAtividades();
        await carregarEmpresasParaAcessos();
      }

      // Se a aba Grid foi ativada, garantir que o GridEditor seja inicializado
      if (tabId === 'grid') {
        try {
          if (typeof window.GridEditor === 'undefined') {
            try { 
              const gridEditorPath = (typeof window.corrigirUrl === 'function') ? window.corrigirUrl('/js/grid-editor.js') : '/js/grid-editor.js';
              await loadScript(gridEditorPath);
            } catch (e) { console.warn('[Usuários] falha ao carregar GridEditor:', e); }
          }

          if (typeof window.GridEditor !== 'undefined') {
            if (!gridTab) inicializarGridTab();
            try {
              gridTab.render(lastUsuarios || []);
            } catch (e) {
              console.error('[Usuários] erro ao renderizar grid na aba:', e);
            }
          }
        } catch (gridErr) {
          console.warn('[Usuários] Erro ao processar grid:', gridErr);
        }
      }
    } catch (err) {
      console.warn('[Usuários] Erro ao mudar aba:', err);
    }
  }

  // Carregar empresas para filtro
  async function loadEmpresasParaFiltro() {
    try {
      const response = await fetch('/api/empresas', { headers: getAuthHeaders() });
      const empresas = await response.json();
      const select = document.getElementById('filtroEmpresa');
      if (select) {
        select.innerHTML = '<option value="">Todas</option>';
        empresas.forEach(e => {
          const option = document.createElement('option');
          option.value = e.CDEMPRESA;
          option.textContent = `${e.CDEMPRESA} - ${e.RZSOCIAL}`;
          select.appendChild(option);
        });
      }
    } catch (err) {
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const login = document.getElementById('filtroLogin')?.value;
    const nome = document.getElementById('filtroNome')?.value;
    const email = document.getElementById('filtroEmail')?.value;
    const cadastro = document.getElementById('filtroCadastro')?.value;
    const situacao = document.getElementById('filtroSituacao')?.value;
    const empresa = document.getElementById('filtroEmpresa')?.value;

    if (login) params.append('login', login);
    if (nome) params.append('nome', nome);
    if (email) params.append('email', email);
    if (cadastro) params.append('cadastro', cadastro);
    if (situacao) params.append('situacao', situacao);
    if (empresa) params.append('empresa', empresa);

    try {
      const response = await fetch(`/api/usuarios?${params.toString()}`, { headers: getAuthHeaders() });
      const body = await response.json();

      if (!response.ok) {
        const msg = (body && body.error) ? body.error : 'Erro ao carregar usuários.';
        showMessage(msg, 'error');
        lastUsuarios = [];
      } else {
        lastUsuarios = Array.isArray(body) ? body : [];
      }

      const usuarios = lastUsuarios;
      const countEl = document.getElementById('usuariosGridCountText');
      if (countEl) {
        countEl.textContent = usuarios.length + ' ' + (t('web.modulos.usuarios.registrosEncontrados').replace(/^0\s*/, ''));
      }

      // GridEditor já é carregado globalmente pelo dashboard.js
      if (typeof window.GridEditor === 'undefined') {
        let tentativas = 0;
        while (typeof window.GridEditor === 'undefined' && tentativas < 10) {
          await new Promise(resolve => setTimeout(resolve, 200));
          tentativas++;
        }
      }

      if (typeof window.GridEditor !== 'undefined') {
        try {
          if (!gridTab) {
            inicializarGridTab();
          }
          if (gridTab) {
            gridTab.render(usuarios);
          }
        } catch (e) {
          console.warn('⚠️ [Usuários] Erro ao renderizar grid:', e);
        }
      }

      showTab(openTab);
    } catch (err) {
      showMessage(t('web.modulos.usuarios.erroCarregarDados'), 'error');
      lastUsuarios = [];
      const countEl = document.getElementById('usuariosGridCountText');
      if (countEl) countEl.textContent = t('web.modulos.usuarios.registrosEncontrados');
      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try { gridTab.render([]); } catch (e) {}
      }
      showTab(openTab);
    }
  }

  // Inicializar grid
  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Usuários] GridEditor não está disponível');
      return;
    }
    gridTab = new window.GridEditor({
      container: '#usuariosGrid',
      columns: [
        { field: 'SGUSUARIO', header: 'Login', editable: false, isId: true, width: '120px' },
        { field: 'NMUSUARIO', header: 'Nome', editable: false },
        { field: 'ENDEMAIL', header: 'E-mail', editable: false },
        { field: 'CADASTRO_NOME', header: 'Cadastro', editable: false },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [{ value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' }],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/usuarios',
      onBeforeEdit: async (id) => {
        await loadUsuarioParaEdicao(id);
        return false;
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

  // Carregar script
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
            carregarNovoScript();
          }
        }, 100);
        return;
      }

      carregarNovoScript();
    });
  }

  // Carregar usuário para edição
  async function loadUsuarioParaEdicao(login) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (usuarioForm) {
        usuarioForm.reset();
      }
      
      const response = await fetch(`/api/usuarios/${login}`, { headers: getAuthHeaders() });
      const usuario = await response.json();

      // Mostrar aba Dados antes de preencher (padrão Filiais/Tipos Atividade)
      document.getElementById('formTitle').textContent = t('web.modulos.usuarios.editarUsuario');
      await showTab('dados');

      // Armazenar o login do usuário sendo editado
      usuarioEmEdicao = usuario.SGUSUARIO;

      document.getElementById('usuarioLoginOriginal').value = usuario.SGUSUARIO;
      document.getElementById('usuarioLogin').value = usuario.SGUSUARIO;
      document.getElementById('usuarioLogin').readOnly = true;
      document.getElementById('usuarioNome').value = usuario.NMUSUARIO;
      document.getElementById('usuarioEmail').value = usuario.ENDEMAIL;
      document.getElementById('usuarioCadastro').value = usuario.CDCADASTRO || '';
      
      // Buscar nome do cadastro se existir código
      if (usuario.CDCADASTRO) {
        try {
          const cadastroResponse = await fetch(`/api/cadastros-gerais/${usuario.CDCADASTRO}`, { headers: getAuthHeaders() });
          if (cadastroResponse.ok) {
            const cadastro = await cadastroResponse.json();
            document.getElementById('usuarioCadastroBusca').value = `${usuario.CDCADASTRO} - ${cadastro.RZSOCIAL || 'Sem nome'}`;
            document.getElementById('cadastroSelecionadoInfo').textContent = `Cadastro selecionado: ${usuario.CDCADASTRO} - ${cadastro.RZSOCIAL || 'Sem nome'}`;
          } else {
            document.getElementById('usuarioCadastroBusca').value = usuario.CDCADASTRO;
            document.getElementById('cadastroSelecionadoInfo').textContent = '';
          }
        } catch (err) {
          document.getElementById('usuarioCadastroBusca').value = usuario.CDCADASTRO;
          document.getElementById('cadastroSelecionadoInfo').textContent = '';
        }
      } else {
        limparCadastroSelecionado();
      }
      
      document.getElementById('usuarioSituacao').value = usuario.FGACTIVE || 'S';
      document.getElementById('usuarioSenha').required = false;
      document.getElementById('usuarioSenha').placeholder = 'Deixe em branco para manter a senha atual';
    } catch (err) {
      showMessage(t('web.modulos.usuarios.erroCarregarDados'), 'error');
    }
  }

  // Validar email
  function validarEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  }

  // Buscar cadastro - Abrir modal de busca
  function abrirModalBuscaCadastro() {
    const modal = document.getElementById('buscaCadastroModal');
    const input = document.getElementById('buscaCadastroInput');
    if (modal && input) {
      modal.style.display = 'flex';
      input.value = '';
      input.focus();
      document.getElementById('resultadosBuscaCadastro').innerHTML = '<p class="empty">Digite algo para buscar...</p>';
    }
  }

  // Buscar cadastros (com debounce)
  let buscaCadastroTimeout = null;
  async function buscarCadastros() {
    const termo = document.getElementById('buscaCadastroInput')?.value.trim();
    const resultadosDiv = document.getElementById('resultadosBuscaCadastro');
    
    if (!termo || termo.length < 2) {
      if (resultadosDiv) {
        resultadosDiv.innerHTML = '<p class="empty">Digite pelo menos 2 caracteres para buscar...</p>';
      }
      return;
    }

    // Limpar timeout anterior
    if (buscaCadastroTimeout) {
      clearTimeout(buscaCadastroTimeout);
    }

    // Debounce: aguardar 500ms após parar de digitar
    buscaCadastroTimeout = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        
        // Verificar se é número (código)
        if (/^\d+$/.test(termo)) {
          params.append('codigo', termo);
        } 
        // Verificar se parece CPF/CNPJ (só números)
        else if (/^\d+$/.test(termo.replace(/[^\d]/g, ''))) {
          params.append('cgccpf', termo.replace(/[^\d]/g, ''));
        } 
        // Caso contrário, buscar por nome
        else {
          params.append('razaoSocial', termo);
        }

        const response = await fetch(`/api/cadastros-gerais?${params.toString()}`, { headers: getAuthHeaders() });
        const cadastros = await response.json();

        if (!resultadosDiv) return;

        if (!cadastros || cadastros.length === 0) {
          resultadosDiv.innerHTML = '<p class="empty">Nenhum cadastro encontrado.</p>';
          return;
        }

        // Limitar a 20 resultados para não sobrecarregar
        const resultadosLimitados = cadastros.slice(0, 20);
        
        resultadosDiv.innerHTML = resultadosLimitados.map(c => {
          const cgccpfFormatado = c.CGCCPF ? formatarCPFCNPJ(c.CGCCPF) : 'Não informado';
          return `
            <div class="list-item" style="cursor: pointer; padding: 12px; border: 1px solid #dee2e6; border-radius: 4px; margin-bottom: 8px; transition: background 0.2s;" 
                 onclick="selecionarCadastro(${c.CDCADASTRO}, '${(c.RZSOCIAL || '').replace(/'/g, "\\'")}')">
              <div>
                <strong>${c.CDCADASTRO} - ${c.RZSOCIAL || 'Sem nome'}</strong>
                ${c.NMFANTASIA ? `<br><small style="color: #6c757d;">${c.NMFANTASIA}</small>` : ''}
                <br><small style="color: #6c757d;">CPF/CNPJ: ${cgccpfFormatado}</small>
                ${c.CIDADE_NOME ? `<br><small style="color: #6c757d;">${c.CIDADE_NOME} - ${c.CIDADE_ESTADO}</small>` : ''}
              </div>
            </div>
          `;
        }).join('');

        if (cadastros.length > 20) {
          resultadosDiv.innerHTML += `<p style="text-align: center; color: #6c757d; margin-top: 10px;">Mostrando 20 de ${cadastros.length} resultados. Refine sua busca para ver mais.</p>`;
        }
      } catch (err) {
        if (resultadosDiv) {
          resultadosDiv.innerHTML = '<p class="empty">Erro ao buscar cadastros.</p>';
        }
      }
    }, 500);
  }

  // Selecionar cadastro (tornar global para poder ser chamada do onclick)
  window.selecionarCadastro = function(codigo, nome) {
    document.getElementById('usuarioCadastro').value = codigo;
    document.getElementById('usuarioCadastroBusca').value = `${codigo} - ${nome}`;
    document.getElementById('cadastroSelecionadoInfo').textContent = `Cadastro selecionado: ${codigo} - ${nome}`;
    document.getElementById('buscaCadastroModal').style.display = 'none';
    showMessage(`Cadastro selecionado: ${nome}`, 'success');
  };

  // Limpar cadastro selecionado
  function limparCadastroSelecionado() {
    document.getElementById('usuarioCadastro').value = '';
    document.getElementById('usuarioCadastroBusca').value = '';
    document.getElementById('cadastroSelecionadoInfo').textContent = '';
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

  let usuarioFormSubmitting = false;
  async function salvarUsuario(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (usuarioFormSubmitting) return;
    usuarioFormSubmitting = true;
    const btnSubmit = usuarioForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> Salvando...';
    }
    const loginOriginal = document.getElementById('usuarioLoginOriginal').value;
    const login = document.getElementById('usuarioLogin').value;
    const nome = document.getElementById('usuarioNome').value;
    const email = document.getElementById('usuarioEmail').value.trim();
    const senha = document.getElementById('usuarioSenha').value;
    const cadastro = document.getElementById('usuarioCadastro').value;
    const situacao = document.getElementById('usuarioSituacao').value;

    if (!login || !nome || !email) {
      showMessage(t('web.modulos.usuarios.preenchaCampos'), 'error');
      usuarioFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    if (email && !validarEmail(email)) {
      showMessage('Email inválido.', 'error', null, 'usuarioEmail');
      usuarioFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    if (!loginOriginal && !senha) {
      showMessage('Senha é obrigatória para novos usuários.', 'error');
      usuarioFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      const url = loginOriginal ? `/api/usuarios/${loginOriginal}` : '/api/usuarios';
      const method = loginOriginal ? 'PUT' : 'POST';
      
      // Para POST, incluir SGUSUARIO; para PUT, não incluir (vem do parâmetro da URL)
      const body = loginOriginal ? {
        NMUSUARIO: nome,
        ENDEMAIL: email,
        CDCADASTRO: cadastro || null,
        FGACTIVE: situacao || 'S'
      } : {
        SGUSUARIO: login,
        NMUSUARIO: nome,
        ENDEMAIL: email,
        CDCADASTRO: cadastro || null,
        FGACTIVE: situacao || 'S'
      };

      if (senha) body.SENHA = senha;

      const response = await fetch(url, {
        method,
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (response.ok) {
        if (typeof window.showMessage !== 'undefined') {
          window.showMessage(result.message || 'Usuário salvo com sucesso!', 'success');
        } else {
          showMessage(result.message || 'Usuário salvo com sucesso!', 'success');
        }
        limparFormulario();
        showTab('grid');
        await applyFilters('grid');
      } else {
        showMessage(result.error || t('web.modulos.usuarios.erroSalvar'), 'error');
      }
    } catch (err) {
      showMessage('Erro ao salvar usuário.', 'error');
    } finally {
      setTimeout(() => {
        usuarioFormSubmitting = false;
        if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      }, 600);
    }
  }

  // Limpar formulário
  function limparFormulario() {
    usuarioEmEdicao = null; // Limpar usuário em edição
    document.getElementById('usuarioLoginOriginal').value = '';
    document.getElementById('usuarioLogin').value = '';
    document.getElementById('usuarioLogin').readOnly = false;
    document.getElementById('usuarioNome').value = '';
    document.getElementById('usuarioEmail').value = '';
    document.getElementById('usuarioSenha').value = '';
    document.getElementById('usuarioSenha').required = true;
    document.getElementById('usuarioSenha').placeholder = 'Digite a senha';
    limparCadastroSelecionado();
    document.getElementById('usuarioSituacao').value = 'S';
    document.getElementById('formTitle').textContent = t('web.modulos.usuarios.novoUsuario');
  }

  // Confirmar exclusão (padrão: modal no topo, botões Desativar/Reativar e Cancelar)
  async function confirmarExclusao(login) {
    const estaAtivo = lastUsuarios?.find(u => u.SGUSUARIO === login)?.FGACTIVE === 'S';
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    if (!modalMessage || !confirmYes || !confirmNo) {
      const msg = estaAtivo ? `Tem certeza que deseja desativar o usuário "${login}"?` : `Tem certeza que deseja reativar o usuário "${login}"?`;
      if (window.confirm(msg)) {
        const action = estaAtivo ? 'deactivate' : 'activate';
        const response = await fetch(`/api/usuarios/${login}?action=${action}`, { method: 'DELETE', headers: getAuthHeaders() });
        const result = await response.json();
        if (response.ok) { showMessage(result.message, 'success'); await applyFilters('grid'); }
        else { showMessage(result.error || 'Erro ao alterar status.', 'error'); }
      }
      return;
    }
    modalMessage.textContent = estaAtivo
      ? `Tem certeza que deseja desativar o usuário "${login}"?`
      : `Tem certeza que deseja reativar o usuário "${login}"?`;
    const btnText = estaAtivo ? 'Desativar' : 'Reativar';
    const newYes = confirmYes.cloneNode(true);
    const newNo = confirmNo.cloneNode(true);
    newYes.className = 'btn-filtro btn-filtro-danger';
    newYes.innerHTML = '<i class="bx bx-check"></i> ' + btnText;
    newNo.className = 'btn-filtro btn-filtro-limpar';
    newNo.innerHTML = '<i class="bx bx-x"></i> Cancelar';
    if (confirmYes.parentNode) confirmYes.parentNode.replaceChild(newYes, confirmYes);
    if (confirmNo.parentNode) confirmNo.parentNode.replaceChild(newNo, confirmNo);

    modal.style.display = 'block';
    return new Promise((resolve) => {
      const handlerYes = async () => {
        try {
          const action = estaAtivo ? 'deactivate' : 'activate';
          const response = await fetch(`/api/usuarios/${login}?action=${action}`, { method: 'DELETE', headers: getAuthHeaders() });
          const result = await response.json();
          if (response.ok) { showMessage(result.message, 'success'); await applyFilters('grid'); }
          else { showMessage(result.error || 'Erro ao alterar status.', 'error'); }
        } catch (err) { showMessage('Erro ao alterar status do usuário.', 'error'); }
        modal.style.display = 'none';
        resolve();
      };
      const handlerNo = () => { modal.style.display = 'none'; resolve(); };
      newYes.addEventListener('click', handlerYes, { once: true });
      newNo.addEventListener('click', handlerNo, { once: true });
    });
  }

  // Toggle senha
  function toggleSenha() {
    const senhaInput = document.getElementById('usuarioSenha');
    const toggleBtn = document.getElementById('toggleSenha');
    if (senhaInput.type === 'password') {
      senhaInput.type = 'text';
      toggleBtn.textContent = '🙈';
    } else {
      senhaInput.type = 'password';
      toggleBtn.textContent = '👁️';
    }
  }

  // Verificar força da senha
  function verificarForcaSenha() {
    const senha = document.getElementById('usuarioSenha').value;
    const strengthEl = document.getElementById('senhaStrength');
    if (!strengthEl) return;

    if (!senha) {
      strengthEl.textContent = '';
      strengthEl.className = 'senha-strength';
      return;
    }

    let strength = 0;
    if (senha.length >= 6) strength++;
    if (senha.length >= 8) strength++;
    if (/[a-z]/.test(senha) && /[A-Z]/.test(senha)) strength++;
    if (/\d/.test(senha)) strength++;
    if (/[^a-zA-Z\d]/.test(senha)) strength++;

    if (strength <= 2) {
      strengthEl.textContent = 'Senha fraca';
      strengthEl.className = 'senha-strength weak';
    } else if (strength <= 3) {
      strengthEl.textContent = 'Senha média';
      strengthEl.className = 'senha-strength medium';
    } else {
      strengthEl.textContent = 'Senha forte';
      strengthEl.className = 'senha-strength strong';
    }
  }

  // ========== FUNÇÕES DE ACESSOS ==========

  // Limpar todos os dados da aba de acessos
  function limparDadosAcessos() {
    // Limpar seleção de usuário
    const selectUsuario = document.getElementById('usuarioAcessoSelect');
    if (selectUsuario) {
      selectUsuario.value = '';
    }
    
    // Limpar título
    const acessosTitle = document.getElementById('acessosTitle');
    if (acessosTitle) {
      acessosTitle.textContent = 'Gerenciar Acessos:';
    }
    
    // Ocultar conteúdo
    const acessosContent = document.getElementById('acessosContent');
    if (acessosContent) {
      acessosContent.style.display = 'none';
    }
    
    // Limpar atividades
    const atividadesContainer = document.getElementById('atividadesContainer');
    if (atividadesContainer) {
      atividadesContainer.innerHTML = '';
    }
    
    // Limpar empresas selecionadas
    const empresasSelecionadasContainer = document.getElementById('empresasSelecionadas');
    if (empresasSelecionadasContainer) {
      empresasSelecionadasContainer.innerHTML = '<p class="empty">Nenhuma empresa selecionada</p>';
    }
    
    // Limpar filiais selecionadas
    const filiaisSelecionadasContainer = document.getElementById('filiaisSelecionadas');
    if (filiaisSelecionadasContainer) {
      filiaisSelecionadasContainer.innerHTML = '<p class="empty">Nenhuma filial selecionada</p>';
    }
    
    // Limpar selects de adicionar
    const empresaSelect = document.getElementById('empresaSelect');
    if (empresaSelect) {
      empresaSelect.value = '';
    }
    
    const empresaFilialSelect = document.getElementById('empresaFilialSelect');
    if (empresaFilialSelect) {
      empresaFilialSelect.value = '';
    }
    
    const filialSelect = document.getElementById('filialSelect');
    if (filialSelect) {
      filialSelect.innerHTML = '<option value="">-- Selecione uma empresa primeiro --</option>';
      filialSelect.disabled = true;
    }
    
    // Limpar variáveis
    usuarioSelecionadoAcessos = null;
    empresasSelecionadas = [];
    filiaisSelecionadas = [];
  }

  // Carregar usuários para aba de acessos
  async function carregarUsuariosParaAcessos() {
    try {
      // Filtrar apenas usuários ativos (FGACTIVE = 'S')
      const response = await fetch('/api/usuarios?situacao=S', { headers: getAuthHeaders() });
      const usuarios = await response.json();
      const select = document.getElementById('usuarioAcessoSelect');
      if (select) {
        // Preservar a seleção atual ou usar o usuário em edição
        const selecaoAtual = select.value || usuarioEmEdicao || usuarioSelecionadoAcessos;
        
        select.innerHTML = '<option value="">-- Selecione um usuário --</option>';
        usuarios.forEach(u => {
          const option = document.createElement('option');
          option.value = u.SGUSUARIO;
          option.textContent = `${u.SGUSUARIO} - ${u.NMUSUARIO}`;
          select.appendChild(option);
        });
        
        // Restaurar a seleção se houver
        if (selecaoAtual) {
          select.value = selecaoAtual;
          // Se o valor foi restaurado e estamos na aba de acessos, carregar os dados
          if (select.value === selecaoAtual && document.getElementById('tab-acessos')?.classList.contains('active')) {
            // Usar setTimeout para evitar chamada síncrona durante o carregamento
            setTimeout(async () => {
              await selecionarUsuarioAcessos();
            }, 100);
          }
        }
      }
    } catch (err) {
      showMessage(t('web.modulos.usuarios.erroCarregarDados'), 'error');
    }
  }

  // Carregar todas as atividades
  async function carregarTodasAtividades() {
    try {
      const response = await fetch('/api/atividades', { headers: getAuthHeaders() });
      atividadesDisponiveis = await response.json();
    } catch (err) {
      showMessage('Erro ao carregar atividades.', 'error');
    }
  }

  // Carregar empresas para acessos
  async function carregarEmpresasParaAcessos() {
    try {
      const response = await fetch('/api/empresas', { headers: getAuthHeaders() });
      empresasDisponiveis = await response.json();
      
      // Popular select de empresas (para adicionar empresas)
      const select = document.getElementById('empresaSelect');
      if (select) {
        select.innerHTML = '<option value="">-- Selecione uma empresa --</option>';
        empresasDisponiveis.forEach(e => {
          const option = document.createElement('option');
          option.value = e.CDEMPRESA;
          option.textContent = `${e.CDEMPRESA} - ${e.RZSOCIAL}`;
          select.appendChild(option);
        });
      }
      
      // Popular select de empresas para filiais (para adicionar filiais)
      const selectFilial = document.getElementById('empresaFilialSelect');
      if (selectFilial) {
        selectFilial.innerHTML = '<option value="">-- Selecione uma empresa --</option>';
        empresasDisponiveis.forEach(e => {
          const option = document.createElement('option');
          option.value = e.CDEMPRESA;
          option.textContent = `${e.CDEMPRESA} - ${e.RZSOCIAL}`;
          selectFilial.appendChild(option);
        });
      }
    } catch (err) {
      showMessage('Erro ao carregar empresas.', 'error');
    }
  }

  // Selecionar usuário para gerenciar acessos
  async function selecionarUsuarioAcessos() {
    const login = document.getElementById('usuarioAcessoSelect').value;
    if (!login) {
      // Se não há seleção, limpar tudo
      limparDadosAcessos();
      return;
    }

    // Limpar dados anteriores antes de carregar novo usuário
    // (mas manter o select de usuário)
    const selectUsuario = document.getElementById('usuarioAcessoSelect');
    const valorSelecionado = selectUsuario ? selectUsuario.value : null;
    
    // Limpar containers de dados
    const atividadesContainer = document.getElementById('atividadesContainer');
    if (atividadesContainer) {
      atividadesContainer.innerHTML = '';
    }
    
    const empresasSelecionadasContainer = document.getElementById('empresasSelecionadas');
    if (empresasSelecionadasContainer) {
      empresasSelecionadasContainer.innerHTML = '<p class="empty">Carregando...</p>';
    }
    
    const filiaisSelecionadasContainer = document.getElementById('filiaisSelecionadas');
    if (filiaisSelecionadasContainer) {
      filiaisSelecionadasContainer.innerHTML = '<p class="empty">Carregando...</p>';
    }
    
    // Limpar variáveis
    empresasSelecionadas = [];
    filiaisSelecionadas = [];

    usuarioSelecionadoAcessos = login;
    document.getElementById('acessosTitle').textContent = `Gerenciar Acessos: ${login}`;
    document.getElementById('acessosContent').style.display = 'block';

    // Garantir que as empresas estejam carregadas antes de carregar os dados do usuário
    if (empresasDisponiveis.length === 0) {
      await carregarEmpresasParaAcessos();
    }

    await carregarAtividadesUsuario(login);
    await carregarEmpresasUsuario(login);
    await carregarFiliaisUsuario(login);
  }

  // Carregar atividades do usuário (agrupadas por FGGRUPO - versão simplificada e prática)
  async function carregarAtividadesUsuario(login) {
    try {
      const response = await fetch(`/api/usuarios/${login}/atividades`, { headers: getAuthHeaders() });
      const atividadesUsuario = await response.json();
      const container = document.getElementById('atividadesContainer');
      
      if (!container) return;

      // Agrupar atividades por FGGRUPO
      const atividadesPorGrupo = {};
      atividadesDisponiveis.forEach(atividade => {
        // Garantir que o grupo existe (pode ser null, undefined ou string vazia)
        const grupo = (atividade.FGGRUPO && atividade.FGGRUPO.trim()) ? atividade.FGGRUPO.trim() : 'OUTROS';
        if (!atividadesPorGrupo[grupo]) {
          atividadesPorGrupo[grupo] = [];
        }
        atividadesPorGrupo[grupo].push(atividade);
      });

      // Ordenar grupos (CADASTROS, EQUIPAMENTOS, VIAGENS, etc.)
      const ordemGrupos = [
        'CADASTROS',
        'EQUIPAMENTOS',
        'VIAGENS & LOGÍSTICA',
        'GESTÃO & ADMINISTRAÇÃO',
        'OUTROS'
      ];
      const gruposOrdenados = Object.keys(atividadesPorGrupo).sort((a, b) => {
        const indexA = ordemGrupos.indexOf(a);
        const indexB = ordemGrupos.indexOf(b);
        if (indexA === -1 && indexB === -1) return a.localeCompare(b);
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      });

      container.innerHTML = '';

      gruposOrdenados.forEach(grupo => {
        const atividadesDoGrupo = atividadesPorGrupo[grupo];
        const grupoId = `grupo_${grupo.replace(/[^a-zA-Z0-9]/g, '_')}`;
        
        // Contar quantas estão selecionadas
        let selecionadas = 0;
        atividadesDoGrupo.forEach(atividade => {
          const temAcesso = atividadesUsuario.some(au => au.CDTIPOATIVIDADE === atividade.CDTIPOATIVIDADE && au.TEM_ACESSO === 1);
          if (temAcesso) selecionadas++;
        });

        // Criar seção do grupo (layout melhorado)
        const grupoSection = document.createElement('div');
        grupoSection.className = 'grupo-atividades-section';
        
        // Calcular percentual de seleção para cor do contador
        const percentual = atividadesDoGrupo.length > 0 ? (selecionadas / atividadesDoGrupo.length) * 100 : 0;
        const contadorClass = percentual === 100 ? 'grupo-contador completo' : percentual > 0 ? 'grupo-contador parcial' : 'grupo-contador';
        const todosSelecionados = selecionadas === atividadesDoGrupo.length;
        
        grupoSection.innerHTML = `
          <div class="grupo-atividades-titulo">
            <h4>${grupo}</h4>
            <div class="grupo-atividades-controles">
              <span class="${contadorClass}">${selecionadas}/${atividadesDoGrupo.length}</span>
              <div class="grupo-checkbox-toggle" onclick="toggleTodosGrupo('${grupoId}')" title="${todosSelecionados ? 'Desselecionar todos' : 'Selecionar todos'}">
                <input type="checkbox" id="toggle_${grupoId}" ${todosSelecionados ? 'checked' : ''} onchange="toggleTodosGrupo('${grupoId}')">
                <label for="toggle_${grupoId}">Todos</label>
              </div>
            </div>
          </div>
          <div class="grupo-atividades-lista" id="${grupoId}">
            ${atividadesDoGrupo.map(atividade => {
              const temAcesso = atividadesUsuario.some(au => au.CDTIPOATIVIDADE === atividade.CDTIPOATIVIDADE && au.TEM_ACESSO === 1);
              return `
                <div class="checkbox-item">
                  <input type="checkbox" id="atividade_${atividade.CDTIPOATIVIDADE}" 
                         value="${atividade.CDTIPOATIVIDADE}" ${temAcesso ? 'checked' : ''}
                         onchange="atualizarResumoGrupo('${grupoId}')">
                  <label for="atividade_${atividade.CDTIPOATIVIDADE}">
                    <strong>${atividade.DSTIPOATIVIDADE}</strong>
                    ${atividade.DSPROGRAMA ? `<span class="programa-nome">${atividade.DSPROGRAMA}</span>` : ''}
                  </label>
                  ${temAcesso ? '<div class="check-indicator">✓</div>' : '<div class="check-indicator">✓</div>'}
                </div>
              `;
            }).join('')}
          </div>
        `;
        container.appendChild(grupoSection);
      });

      // Se não há grupos, mostrar mensagem
      if (gruposOrdenados.length === 0) {
        container.innerHTML = '<p class="empty">Nenhuma atividade disponível.</p>';
      }
    } catch (err) {
      showMessage('Erro ao carregar atividades do usuário.', 'error');
    }
  }

  // Funções globais para interação com grupos (versão simplificada)
  window.toggleTodosGrupo = function(grupoId) {
    const grupo = document.getElementById(grupoId);
    if (!grupo) return;
    
    const toggleCheckbox = document.getElementById(`toggle_${grupoId}`);
    if (!toggleCheckbox) return;
    
    const selecionar = toggleCheckbox.checked;
    const checkboxes = grupo.querySelectorAll('input[type="checkbox"]:not(#toggle_' + grupoId + ')');
    checkboxes.forEach(cb => {
      cb.checked = selecionar;
      // Disparar evento change para atualizar indicadores
      cb.dispatchEvent(new Event('change'));
    });
    atualizarResumoGrupo(grupoId);
  };

  window.atualizarResumoGrupo = function(grupoId) {
    const grupo = document.getElementById(grupoId);
    if (!grupo) return;
    
    // Excluir o toggle checkbox da contagem
    const checkboxes = grupo.querySelectorAll('input[type="checkbox"]:not(#toggle_' + grupoId + ')');
    const total = checkboxes.length;
    const selecionadas = Array.from(checkboxes).filter(cb => cb.checked).length;
    
    // Atualizar indicadores visuais de cada checkbox
    checkboxes.forEach(cb => {
      const checkboxItem = cb.closest('.checkbox-item');
      const indicator = checkboxItem?.querySelector('.check-indicator');
      if (indicator) {
        indicator.style.display = cb.checked ? 'flex' : 'none';
      }
    });
    
    // Atualizar toggle checkbox do grupo
    const toggleCheckbox = document.getElementById(`toggle_${grupoId}`);
    if (toggleCheckbox) {
      toggleCheckbox.checked = selecionadas === total && total > 0;
      toggleCheckbox.indeterminate = selecionadas > 0 && selecionadas < total;
    }
    
    // Atualizar contador no título do grupo
    const grupoSection = grupo.closest('.grupo-atividades-section');
    if (grupoSection) {
      const contador = grupoSection.querySelector('.grupo-contador');
      if (contador) {
        contador.textContent = `${selecionadas}/${total}`;
        
        // Atualizar classe do contador baseado no percentual
        contador.classList.remove('completo', 'parcial');
        const percentual = total > 0 ? (selecionadas / total) * 100 : 0;
        if (percentual === 100) {
          contador.classList.add('completo');
        } else if (percentual > 0) {
          contador.classList.add('parcial');
        }
      }
    }
  };

  // Carregar empresas do usuário
  async function carregarEmpresasUsuario(login) {
    try {
      const response = await fetch(`/api/usuarios/${login}/empresas`, { headers: getAuthHeaders() });
      empresasSelecionadas = await response.json();
      renderizarEmpresasSelecionadas();
      atualizarSelectEmpresasExcluindoAtribuidas();
    } catch (err) {
      showMessage('Erro ao carregar empresas do usuário.', 'error');
    }
  }

  // Atualiza o select de empresas para desabilitar ou marcar as já atribuídas (evita tentativa de duplicar)
  function atualizarSelectEmpresasExcluindoAtribuidas() {
    const select = document.getElementById('empresaSelect');
    if (!select || !Array.isArray(empresasDisponiveis) || empresasDisponiveis.length === 0) return;
    const idsAtribuidos = new Set(empresasSelecionadas.map(e => String(e.CDEMPRESA)));
    select.innerHTML = '<option value="">-- Selecione uma empresa --</option>';
    empresasDisponiveis.forEach(e => {
      const option = document.createElement('option');
      option.value = e.CDEMPRESA;
      option.textContent = idsAtribuidos.has(String(e.CDEMPRESA)) ? `${e.CDEMPRESA} - ${e.RZSOCIAL} (já atribuída)` : `${e.CDEMPRESA} - ${e.RZSOCIAL}`;
      if (idsAtribuidos.has(String(e.CDEMPRESA))) option.disabled = true;
      select.appendChild(option);
    });
  }

  // Renderizar empresas selecionadas
  function renderizarEmpresasSelecionadas() {
    const container = document.getElementById('empresasSelecionadas');
    if (!container) return;

    if (empresasSelecionadas.length === 0) {
      container.innerHTML = '<p class="empty">Nenhuma empresa selecionada</p>';
      return;
    }

    container.innerHTML = empresasSelecionadas.map(e => `
      <div class="selected-item">
        <span>${e.CDEMPRESA} - ${e.RZSOCIAL}</span>
        <button class="remove-btn" data-empresa="${e.CDEMPRESA}">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const empresa = btn.dataset.empresa;
        await removerEmpresa(empresa);
      });
    });
  }

  let adicionarEmpresaSubmitting = false;

  // Adicionar empresa
  async function adicionarEmpresa() {
    if (adicionarEmpresaSubmitting) return;
    const empresaId = (document.getElementById('empresaSelect')?.value || '').trim();
    if (!empresaId || !usuarioSelecionadoAcessos) {
      showMessage('Selecione uma empresa.', 'error');
      return;
    }

    // Comparação à prova de tipo (API pode retornar number ou string)
    if (empresasSelecionadas.some(e => String(e.CDEMPRESA) === String(empresaId))) {
      showMessage('Empresa já adicionada.', 'error');
      return;
    }

    const btn = document.getElementById('btnAdicionarEmpresa');
    if (btn) { btn.disabled = true; }
    adicionarEmpresaSubmitting = true;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/empresas`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ empresa: empresaId })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Empresa adicionada com sucesso!', 'success');
        await carregarEmpresasUsuario(usuarioSelecionadoAcessos);
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
        document.getElementById('empresaSelect').value = '';
      } else if (response.status === 400 && result.error && result.error.includes('já possui acesso')) {
        // Sincronizar lista com o servidor e informar sem erro
        await carregarEmpresasUsuario(usuarioSelecionadoAcessos);
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
        showMessage('Esta empresa já está na lista.', 'success');
      } else {
        showMessage(result.error || 'Erro ao adicionar empresa.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao adicionar empresa.', 'error');
    } finally {
      adicionarEmpresaSubmitting = false;
      setTimeout(() => { if (btn) btn.disabled = false; }, 400);
    }
  }

  // Remover empresa
  async function removerEmpresa(empresaId) {
    if (!usuarioSelecionadoAcessos) return;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/empresas/${empresaId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message, 'success');
        await carregarEmpresasUsuario(usuarioSelecionadoAcessos);
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
      } else {
        showMessage(result.error || 'Erro ao remover empresa.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao remover empresa.', 'error');
    }
  }

  // Carregar filiais do usuário
  async function carregarFiliaisUsuario(login) {
    try {
      const response = await fetch(`/api/usuarios/${login}/filiais`, { headers: getAuthHeaders() });
      filiaisSelecionadas = await response.json();
      renderizarFiliaisSelecionadas();
    } catch (err) {
      showMessage('Erro ao carregar filiais do usuário.', 'error');
    }
  }

  // Renderizar filiais selecionadas
  function renderizarFiliaisSelecionadas() {
    const container = document.getElementById('filiaisSelecionadas');
    if (!container) return;

    if (filiaisSelecionadas.length === 0) {
      container.innerHTML = '<p class="empty">Nenhuma filial selecionada</p>';
      return;
    }

    container.innerHTML = filiaisSelecionadas.map(f => `
      <div class="selected-item">
        <span>${f.EMPRESA_NOME} - ${f.NMFANTASIA} (${f.SGFILIAL})</span>
        <button class="remove-btn" data-empresa="${f.CDEMPRESA}" data-filial="${f.CDFILIAL}">✕</button>
      </div>
    `).join('');

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const empresa = btn.dataset.empresa;
        const filial = btn.dataset.filial;
        await removerFilial(empresa, filial);
      });
    });
  }

  // Carregar filiais por empresa (desabilita no select as já atribuídas ao usuário)
  async function carregarFiliaisPorEmpresa() {
    const empresaId = document.getElementById('empresaFilialSelect')?.value;
    const filialSelect = document.getElementById('filialSelect');
    const btnAdicionar = document.getElementById('btnAdicionarFilial');

    if (!empresaId || !filialSelect) {
      if (filialSelect) {
        filialSelect.innerHTML = '<option value="">-- Selecione uma empresa primeiro --</option>';
        filialSelect.disabled = true;
      }
      if (btnAdicionar) btnAdicionar.disabled = true;
      return;
    }

    try {
      const response = await fetch(`/api/filiais?empresa=${empresaId}`, { headers: getAuthHeaders() });
      const filiais = await response.json();
      const idsFiliaisAtribuidas = new Set(
        filiaisSelecionadas
          .filter(f => String(f.CDEMPRESA) === String(empresaId))
          .map(f => String(f.CDFILIAL))
      );

      filialSelect.innerHTML = '<option value="">-- Selecione uma filial --</option>';
      filiais.forEach(f => {
        const option = document.createElement('option');
        option.value = f.CDFILIAL;
        const jaAtribuida = idsFiliaisAtribuidas.has(String(f.CDFILIAL));
        option.textContent = jaAtribuida ? `${f.CDFILIAL} - ${f.NMFANTASIA} (${f.SGFILIAL}) (já atribuída)` : `${f.CDFILIAL} - ${f.NMFANTASIA} (${f.SGFILIAL})`;
        if (jaAtribuida) option.disabled = true;
        filialSelect.appendChild(option);
      });

      filialSelect.disabled = false;
      if (btnAdicionar) btnAdicionar.disabled = false;
    } catch (err) {
      showMessage('Erro ao carregar filiais.', 'error');
    }
  }

  let adicionarFilialSubmitting = false;

  // Adicionar filial
  async function adicionarFilial() {
    if (adicionarFilialSubmitting) return;
    const empresaId = (document.getElementById('empresaFilialSelect')?.value || '').trim();
    const filialId = (document.getElementById('filialSelect')?.value || '').trim();
    
    if (!empresaId || !filialId || !usuarioSelecionadoAcessos) {
      showMessage('Selecione empresa e filial.', 'error');
      return;
    }

    // Comparação à prova de tipo (API pode retornar number ou string)
    if (filiaisSelecionadas.some(f => String(f.CDEMPRESA) === String(empresaId) && String(f.CDFILIAL) === String(filialId))) {
      showMessage('Filial já adicionada.', 'error');
      return;
    }

    const btn = document.getElementById('btnAdicionarFilial');
    if (btn) { btn.disabled = true; }
    adicionarFilialSubmitting = true;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/filiais`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ empresa: empresaId, filial: filialId })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Filial adicionada com sucesso!', 'success');
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
        document.getElementById('filialSelect').value = '';
        await carregarFiliaisPorEmpresa();
      } else if (response.status === 400 && result.error && result.error.includes('já possui acesso')) {
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
        showMessage('Esta filial já está na lista.', 'success');
      } else {
        showMessage(result.error || 'Erro ao adicionar filial.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao adicionar filial.', 'error');
    } finally {
      adicionarFilialSubmitting = false;
      setTimeout(() => { if (btn) btn.disabled = false; }, 400);
    }
  }

  // Remover filial
  async function removerFilial(empresaId, filialId) {
    if (!usuarioSelecionadoAcessos) return;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/filiais/${empresaId}/${filialId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message, 'success');
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
      } else {
        showMessage(result.error || 'Erro ao remover filial.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao remover filial.', 'error');
    }
  }

  let salvarAtividadesSubmitting = false;

  // Salvar atividades
  async function salvarAtividades() {
    if (salvarAtividadesSubmitting) return;
    if (!usuarioSelecionadoAcessos) {
      showMessage('Selecione um usuário primeiro.', 'error');
      return;
    }

    const checkboxes = document.querySelectorAll('#atividadesContainer input[type="checkbox"]:checked');
    const atividades = [...new Set(
      Array.from(checkboxes)
        .map(cb => parseInt(cb.value, 10))
        .filter(id => !isNaN(id) && id > 0)
    )];

    const btn = document.getElementById('btnSalvarAcessos');
    if (btn) btn.disabled = true;
    salvarAtividadesSubmitting = true;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/atividades`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ atividades })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Atividades salvas com sucesso!', 'success');
        limparDadosAcessos();
        showTab('dados');
      } else {
        showMessage(result.error || 'Erro ao salvar atividades.', 'error');
        if (result.detalhes) console.error('Erro ao salvar atividades:', result.detalhes);
      }
    } catch (err) {
      console.error('Erro ao salvar atividades:', err);
      showMessage('Erro ao salvar atividades.', 'error');
    } finally {
      salvarAtividadesSubmitting = false;
      setTimeout(() => { if (btn) btn.disabled = false; }, 400);
    }
  }

  // Event Listeners (replicados em attachEventListeners ao final de init para funcionar quando módulo é injetado)

  document.getElementById('usuarioAcessoSelect')?.addEventListener('change', selecionarUsuarioAcessos);
  document.getElementById('btnAdicionarEmpresa')?.addEventListener('click', adicionarEmpresa);
  document.getElementById('btnAdicionarFilial')?.addEventListener('click', adicionarFilial);
  document.getElementById('empresaFilialSelect')?.addEventListener('change', carregarFiliaisPorEmpresa);
  document.getElementById('btnSalvarAcessos')?.addEventListener('click', salvarAtividades);
  document.getElementById('btnCancelarAcessos')?.addEventListener('click', () => {
    limparDadosAcessos();
  });

})();

