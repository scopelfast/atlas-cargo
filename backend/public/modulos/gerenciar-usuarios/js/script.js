// backend/public/modulos/gerenciar-usuarios/js/script.js
// Gerenciar Usuários - Frontend
// Versão: 1.0
// Autor: Sistema DivulgaCarga

(function() {
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
    await loadEmpresasParaFiltro();
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

    if (tabId === 'acessos') {
      await carregarUsuariosParaAcessos();
      await carregarTodasAtividades();
      await carregarEmpresasParaAcessos();
    }

    if (tabId === 'grid' && lastUsuarios) {
      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(lastUsuarios);
        } catch (e) {}
      }
    }
  }

  // Carregar empresas para filtro
  async function loadEmpresasParaFiltro() {
    try {
      const response = await fetch('/api/empresas');
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
      const response = await fetch(`/api/usuarios?${params.toString()}`);
      const usuarios = await response.json();

      lastUsuarios = usuarios;
      const countEl = document.getElementById('usuariosGridCountText');
      if (countEl) {
        const count = usuarios.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }

      if (typeof window.GridEditor !== 'undefined' && gridTab) {
        try {
          gridTab.render(usuarios);
        } catch (e) {}
      }

      if (typeof window.GridEditor === 'undefined') {
        try {
          await loadScript('/js/grid-editor.js');
        } catch (loadErr) {}
      }

      if (typeof window.GridEditor !== 'undefined') {
        if (!gridTab) inicializarGridTab();
        try {
          gridTab.render(usuarios);
        } catch (e) {}
      }

      showTab(openTab);
    } catch (err) {
      showMessage('Erro ao carregar usuários.', 'error');
    }
  }

  // Inicializar grid
  function inicializarGridTab() {
    gridTab = new GridEditor({
      container: '#usuariosGrid',
      columns: [
        { field: 'SGUSUARIO', header: 'Login', editable: false, isId: true, width: '150px' },
        { field: 'NMUSUARIO', header: 'Nome', editable: false, width: '250px' },
        { field: 'ENDEMAIL', header: 'E-mail', editable: false, width: '200px' },
        { field: 'CADASTRO_NOME', header: 'Cadastro', editable: false, width: '200px' },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '100px',
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
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      const script = document.createElement('script');
      script.src = `${src}?t=${Date.now()}`;
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
    });
  }

  // Carregar usuário para edição
  async function loadUsuarioParaEdicao(login) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      if (usuarioForm) {
        usuarioForm.reset();
      }
      
      const response = await fetch(`/api/usuarios/${login}`);
      const usuario = await response.json();

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
          const cadastroResponse = await fetch(`/api/cadastros-gerais/${usuario.CDCADASTRO}`);
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

      document.getElementById('formTitle').textContent = 'Editar Usuário';
      showTab('dados');
    } catch (err) {
      showMessage('Erro ao carregar usuário.', 'error');
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

        const response = await fetch(`/api/cadastros-gerais?${params.toString()}`);
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

  // Salvar usuário
  async function salvarUsuario(e) {
    e.preventDefault();
    const loginOriginal = document.getElementById('usuarioLoginOriginal').value;
    const login = document.getElementById('usuarioLogin').value;
    const nome = document.getElementById('usuarioNome').value;
    const email = document.getElementById('usuarioEmail').value.trim();
    const senha = document.getElementById('usuarioSenha').value;
    const cadastro = document.getElementById('usuarioCadastro').value;
    const situacao = document.getElementById('usuarioSituacao').value;

    if (!login || !nome || !email) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    if (email && !validarEmail(email)) {
      showMessage('Email inválido.', 'error', null, 'usuarioEmail');
      return;
    }

    if (!loginOriginal && !senha) {
      showMessage('Senha é obrigatória para novos usuários.', 'error');
      return;
    }

    try {
      const url = loginOriginal ? `/api/usuarios/${loginOriginal}` : '/api/usuarios';
      const method = loginOriginal ? 'PUT' : 'POST';
      const body = {
        SGUSUARIO: login,
        NMUSUARIO: nome,
        ENDEMAIL: email,
        CDCADASTRO: cadastro || null,
        FGACTIVE: situacao
      };

      if (senha) body.SENHA = senha;

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const result = await response.json();

      if (response.ok) {
        showMessage(result.message || 'Usuário salvo com sucesso!', 'success');
        limparFormulario();
        await applyFilters('grid');
        showTab('grid');
      } else {
        showMessage(result.error || 'Erro ao salvar usuário.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao salvar usuário.', 'error');
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
    document.getElementById('formTitle').textContent = 'Novo Usuário';
  }

  // Confirmar exclusão
  async function confirmarExclusao(login) {
    const estaAtivo = lastUsuarios?.find(u => u.SGUSUARIO === login)?.FGACTIVE === 'S';
    document.getElementById('modalMessage').textContent = 
      estaAtivo 
        ? `Tem certeza que deseja desativar o usuário "${login}"?` 
        : `Tem certeza que deseja reativar o usuário "${login}"?`;
    
    modal.style.display = 'flex';
    
    return new Promise((resolve) => {
      const confirmYes = document.getElementById('confirmYes');
      const confirmNo = document.getElementById('confirmNo');
      
      const handlerYes = async () => {
        try {
          const action = estaAtivo ? 'deactivate' : 'activate';
          const response = await fetch(`/api/usuarios/${login}?action=${action}`, {
            method: 'DELETE'
          });
          const result = await response.json();
          
          if (response.ok) {
            showMessage(result.message, 'success');
            await applyFilters('grid');
          } else {
            showMessage(result.error || 'Erro ao alterar status.', 'error');
          }
        } catch (err) {
          showMessage('Erro ao alterar status do usuário.', 'error');
        }
        modal.style.display = 'none';
        confirmYes.removeEventListener('click', handlerYes);
        confirmNo.removeEventListener('click', handlerNo);
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

  // Carregar usuários para aba de acessos
  async function carregarUsuariosParaAcessos() {
    try {
      const response = await fetch('/api/usuarios');
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
      showMessage('Erro ao carregar usuários.', 'error');
    }
  }

  // Carregar todas as atividades
  async function carregarTodasAtividades() {
    try {
      const response = await fetch('/api/atividades');
      atividadesDisponiveis = await response.json();
    } catch (err) {
      showMessage('Erro ao carregar atividades.', 'error');
    }
  }

  // Carregar empresas para acessos
  async function carregarEmpresasParaAcessos() {
    try {
      const response = await fetch('/api/empresas');
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
      document.getElementById('acessosContent').style.display = 'none';
      usuarioSelecionadoAcessos = null;
      return;
    }

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

  // Carregar atividades do usuário
  async function carregarAtividadesUsuario(login) {
    try {
      const response = await fetch(`/api/usuarios/${login}/atividades`);
      const atividadesUsuario = await response.json();
      const container = document.getElementById('atividadesContainer');
      
      if (!container) return;

      container.innerHTML = '';
      atividadesDisponiveis.forEach(atividade => {
        const temAcesso = atividadesUsuario.some(au => au.CDTIPOATIVIDADE === atividade.CDTIPOATIVIDADE && au.TEM_ACESSO === 1);
        const div = document.createElement('div');
        div.className = 'checkbox-item';
        div.innerHTML = `
          <input type="checkbox" id="atividade_${atividade.CDTIPOATIVIDADE}" 
                 value="${atividade.CDTIPOATIVIDADE}" ${temAcesso ? 'checked' : ''}>
          <label for="atividade_${atividade.CDTIPOATIVIDADE}">
            ${atividade.DSTIPOATIVIDADE}
            ${atividade.DSPROGRAMA ? `<small style="color: #6c757d;"> (${atividade.DSPROGRAMA})</small>` : ''}
          </label>
        `;
        container.appendChild(div);
      });
    } catch (err) {
      showMessage('Erro ao carregar atividades do usuário.', 'error');
    }
  }

  // Carregar empresas do usuário
  async function carregarEmpresasUsuario(login) {
    try {
      const response = await fetch(`/api/usuarios/${login}/empresas`);
      empresasSelecionadas = await response.json();
      renderizarEmpresasSelecionadas();
    } catch (err) {
      showMessage('Erro ao carregar empresas do usuário.', 'error');
    }
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

  // Adicionar empresa
  async function adicionarEmpresa() {
    const empresaId = document.getElementById('empresaSelect').value;
    if (!empresaId || !usuarioSelecionadoAcessos) {
      showMessage('Selecione uma empresa.', 'error');
      return;
    }

    if (empresasSelecionadas.some(e => e.CDEMPRESA === parseInt(empresaId))) {
      showMessage('Empresa já adicionada.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/empresas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message, 'success');
        await carregarEmpresasUsuario(usuarioSelecionadoAcessos);
        document.getElementById('empresaSelect').value = '';
      } else {
        showMessage(result.error || 'Erro ao adicionar empresa.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao adicionar empresa.', 'error');
    }
  }

  // Remover empresa
  async function removerEmpresa(empresaId) {
    if (!usuarioSelecionadoAcessos) return;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/empresas/${empresaId}`, {
        method: 'DELETE'
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
      const response = await fetch(`/api/usuarios/${login}/filiais`);
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

  // Carregar filiais por empresa
  async function carregarFiliaisPorEmpresa() {
    const empresaId = document.getElementById('empresaFilialSelect').value;
    const filialSelect = document.getElementById('filialSelect');
    const btnAdicionar = document.getElementById('btnAdicionarFilial');

    if (!empresaId) {
      filialSelect.innerHTML = '<option value="">-- Selecione uma empresa primeiro --</option>';
      filialSelect.disabled = true;
      btnAdicionar.disabled = true;
      return;
    }

    try {
      const response = await fetch(`/api/filiais?empresa=${empresaId}`);
      const filiais = await response.json();
      
      filialSelect.innerHTML = '<option value="">-- Selecione uma filial --</option>';
      filiais.forEach(f => {
        const option = document.createElement('option');
        option.value = f.CDFILIAL;
        option.textContent = `${f.CDFILIAL} - ${f.NMFANTASIA} (${f.SGFILIAL})`;
        filialSelect.appendChild(option);
      });
      
      filialSelect.disabled = false;
      btnAdicionar.disabled = false;
    } catch (err) {
      showMessage('Erro ao carregar filiais.', 'error');
    }
  }

  // Adicionar filial
  async function adicionarFilial() {
    const empresaId = document.getElementById('empresaFilialSelect').value;
    const filialId = document.getElementById('filialSelect').value;
    
    if (!empresaId || !filialId || !usuarioSelecionadoAcessos) {
      showMessage('Selecione empresa e filial.', 'error');
      return;
    }

    if (filiaisSelecionadas.some(f => f.CDEMPRESA === parseInt(empresaId) && f.CDFILIAL === parseInt(filialId))) {
      showMessage('Filial já adicionada.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/filiais`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId, filial: filialId })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message, 'success');
        await carregarFiliaisUsuario(usuarioSelecionadoAcessos);
        // Manter a empresa selecionada, apenas limpar a filial
        document.getElementById('filialSelect').value = '';
        // Recarregar as filiais da empresa selecionada para permitir adicionar outra filial
        await carregarFiliaisPorEmpresa();
      } else {
        showMessage(result.error || 'Erro ao adicionar filial.', 'error');
      }
    } catch (err) {
      showMessage('Erro ao adicionar filial.', 'error');
    }
  }

  // Remover filial
  async function removerFilial(empresaId, filialId) {
    if (!usuarioSelecionadoAcessos) return;

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/filiais/${empresaId}/${filialId}`, {
        method: 'DELETE'
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

  // Salvar atividades
  async function salvarAtividades() {
    if (!usuarioSelecionadoAcessos) {
      showMessage('Selecione um usuário primeiro.', 'error');
      return;
    }

    const checkboxes = document.querySelectorAll('#atividadesContainer input[type="checkbox"]:checked');
    const atividades = Array.from(checkboxes)
      .map(cb => parseInt(cb.value))
      .filter(id => !isNaN(id) && id > 0);

    try {
      const response = await fetch(`/api/usuarios/${usuarioSelecionadoAcessos}/atividades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atividades })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Atividades salvas com sucesso!', 'success');
      } else {
        showMessage(result.error || 'Erro ao salvar atividades.', 'error');
        console.error('Erro ao salvar atividades:', result);
      }
    } catch (err) {
      console.error('Erro ao salvar atividades:', err);
      showMessage('Erro ao salvar atividades.', 'error');
    }
  }

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
    lastUsuarios = null;
    document.getElementById('usuariosGridCountText').textContent = '0 registro(s) encontrado(s)';
    document.getElementById('usuariosGrid').innerHTML = '<p class="empty">Aplicar filtros para carregar o grid.</p>';
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

  usuarioForm?.addEventListener('submit', salvarUsuario);

  document.getElementById('btnBuscarCadastro')?.addEventListener('click', abrirModalBuscaCadastro);
  document.getElementById('btnLimparCadastro')?.addEventListener('click', limparCadastroSelecionado);
  document.getElementById('btnFecharBuscaCadastro')?.addEventListener('click', () => {
    document.getElementById('buscaCadastroModal').style.display = 'none';
  });
  document.getElementById('buscaCadastroInput')?.addEventListener('input', buscarCadastros);
  document.getElementById('buscaCadastroInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscarCadastros();
    }
  });
  
  // Fechar modal ao clicar fora
  document.getElementById('buscaCadastroModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'buscaCadastroModal') {
      document.getElementById('buscaCadastroModal').style.display = 'none';
    }
  });

  document.getElementById('toggleSenha')?.addEventListener('click', toggleSenha);
  document.getElementById('usuarioSenha')?.addEventListener('input', verificarForcaSenha);

  document.getElementById('usuarioAcessoSelect')?.addEventListener('change', selecionarUsuarioAcessos);
  document.getElementById('btnAdicionarEmpresa')?.addEventListener('click', adicionarEmpresa);
  document.getElementById('btnAdicionarFilial')?.addEventListener('click', adicionarFilial);
  document.getElementById('empresaFilialSelect')?.addEventListener('change', carregarFiliaisPorEmpresa);
  document.getElementById('btnSalvarAcessos')?.addEventListener('click', salvarAtividades);
  document.getElementById('btnCancelarAcessos')?.addEventListener('click', () => {
    document.getElementById('usuarioAcessoSelect').value = '';
    document.getElementById('acessosContent').style.display = 'none';
    usuarioSelecionadoAcessos = null;
  });

})();

