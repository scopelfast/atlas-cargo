// backend/public/modulos/gerenciar-cadastro-geral/js/script.js
// Gerenciar Cadastro Geral - Frontend
// Versão: 1.1 - Com Classes de Frota
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

(function() {
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
    // Proteção: Se já foi executado, não executar novamente
    if (sqlExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    sqlExecutado = true;
    
    // Mostrar overlay de carregamento
    showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch('/modulos/gerenciar-cadastro-geral/sql/init.sql');
      
      // Atualizar mensagem do overlay
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          hideLoadingOverlayInitSQL();
          return;
        }
        hideLoadingOverlayInitSQL();
        throw new Error(`Erro ao carregar init.sql: ${response.status}`);
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
        hideLoadingOverlayInitSQL();
        return;
      }
      
      // Atualizar mensagem: processando comandos
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      
      // Executar o SQL via API e AGUARDAR completamente a resposta
      let execResponse;
      try {
        execResponse = await fetch('/api/cadastros-gerais/executar-init-sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          // Aumentar timeout para scripts grandes (MERGE pode demorar)
          signal: AbortSignal.timeout(120000) // 120 segundos (2 minutos)
        });
      } catch (fetchError) {
        if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        if (fetchError.message.includes('ERR_CONNECTION_RESET') || fetchError.message.includes('Failed to fetch')) {
          hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        hideLoadingOverlayInitSQL();
        throw fetchError;
      }
      
      // Verificar se a resposta foi bem-sucedida
      if (!execResponse.ok) {
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
        hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se todos os comandos foram executados com sucesso
      if (!result.success) {
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
                console.error('Erro no init.sql:', JSON.stringify(mensagem));
              } else {
                console.error('Erro no init.sql:', mensagem);
              }
            });
          }
        }
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
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
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) se existir
    // e AGUARDAR completamente antes de prosseguir
    try {
      await executarInitSQL();
    } catch (err) {
      // Erros silenciosos - não bloquear o módulo
    }
    
    // Garantir que a aba de filtros está ativa e visível
    // O showTab vai verificar se precisa carregar os estados e carregar automaticamente
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
    // Primeiro, desativar todas as abas
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => {
      content.classList.remove('active');
      // Garantir que está escondido via CSS
      content.style.display = 'none';
    });
    
    // Ativar a aba desejada
    const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const tabContent = document.getElementById(`tab-${tabId}`);
    
    if (tabBtn) {
      tabBtn.classList.add('active');
    }
    if (tabContent) {
      tabContent.classList.add('active');
      tabContent.style.display = 'block';
    }
    
    // Aguardar um frame para garantir que a mudança foi renderizada
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Se for a aba de grid, inicializar o GridEditor
    if (tabId === 'grid') {
      try {
        if (!gridTab) {
          await loadScript('/js/grid-editor.js');
          inicializarGridTab();
        }
        // Sempre renderizar, mesmo se não houver dados (grid vazio)
        const cadastrosParaRenderizar = lastCadastros || [];
        const cadastrosComCidade = cadastrosParaRenderizar.map(c => {
          if (c.CIDADE) return c; // Já tem o campo
          const estado = c.CIDADE_ESTADO || '';
          const cidade = c.CIDADE_NOME || '';
          const cidadeFormatada = `${estado} - ${cidade}`.trim();
          return {
            ...c,
            CIDADE: cidadeFormatada === '-' ? 'Não informado' : cidadeFormatada
          };
        });
        if (gridTab) {
          gridTab.render(cadastrosComCidade);
        } else if (cadastrosParaRenderizar.length === 0) {
          // Se não há dados e grid não está inicializado, aplicar filtros para buscar
          // Mas não bloquear a mudança de aba
          setTimeout(() => {
            applyFilters('grid').catch(err => {
              console.warn('[Cadastros] Erro ao aplicar filtros automaticamente:', err);
            });
          }, 100);
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
    
    // Se for a aba de dados, aplicar máscara no CPF/CNPJ
    if (tabId === 'dados') {
      setTimeout(() => {
        aplicarMascaraCPFCNPJ();
      }, 100);
    }
  }

  // Carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      // Verificar se GridEditor já está disponível globalmente
      if (typeof GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      // Função para carregar novo script
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        script.src = `${src}?t=${Date.now()}`; // Cache busting
        script.onload = () => {
          // Aguardar um pouco para garantir que GridEditor está disponível
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
      
      // Verificar se o script já está sendo carregado ou já existe
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        // Se o script existe, aguardar ele carregar
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof GridEditor !== 'undefined') {
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
    if (typeof GridEditor === 'undefined') {
      console.error('[Cadastros] GridEditor não está disponível');
      return;
    }

    gridTab = new GridEditor({
      container: '#cadastrosGrid',
      columns: [
        { field: 'CDCADASTRO', header: 'Código', editable: false, isId: true, width: '90px' },
        { field: 'RZSOCIAL', header: 'Razão Social', editable: true, type: 'text', width: '280px', maxlength: 60 },
        { field: 'FGTIPOCADASTRO_NOME', header: 'Tipo Cadastro', editable: false, width: '160px' },
        { 
          field: 'CIDADE', 
          header: 'Cidade', 
          editable: false, 
          width: '220px',
          format: (val) => val || 'Não informado'
        },
        { 
          field: 'NRCELULAR', 
          header: 'Celular', 
          editable: true, 
          type: 'text', 
          width: '140px', 
          maxlength: 15,
          format: (val) => {
            if (!val) return '-';
            // Limpar o número (remover caracteres não numéricos)
            const numeroLimpo = String(val).replace(/\D/g, '');
            if (!numeroLimpo || numeroLimpo.length < 10) return val;
            
            // Formatar para exibição (se tiver 11 dígitos, formatar como (XX) XXXXX-XXXX)
            let numeroFormatado = numeroLimpo;
            if (numeroLimpo.length === 11) {
              numeroFormatado = `(${numeroLimpo.substring(0, 2)}) ${numeroLimpo.substring(2, 7)}-${numeroLimpo.substring(7)}`;
            } else if (numeroLimpo.length === 10) {
              numeroFormatado = `(${numeroLimpo.substring(0, 2)}) ${numeroLimpo.substring(2, 6)}-${numeroLimpo.substring(6)}`;
            }
            
            return numeroFormatado;
          }
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '110px',
          options: [ { value: 'S', label: 'Ativo' }, { value: 'N', label: 'Inativo' } ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/cadastros-gerais',
      // Ações customizadas: botão do WhatsApp
      customActions: (row) => {
        const celular = row.NRCELULAR;
        if (!celular) return '';
        
        // Limpar o número (remover caracteres não numéricos)
        const numeroLimpo = String(celular).replace(/\D/g, '');
        if (!numeroLimpo || numeroLimpo.length < 10) return '';
        
        // Criar link do WhatsApp (formato: https://wa.me/5511999999999)
        const whatsappLink = `https://wa.me/55${numeroLimpo}`;
        
        return `<a href="${whatsappLink}" target="_blank" rel="noopener noreferrer" class="btn grid-btn-whatsapp" title="Abrir WhatsApp">💬</a>`;
      },
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição
      onBeforeEdit: async (id) => {
        await loadCadastroParaEdicao(id);
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
        if (lastCadastros) {
          const idx = lastCadastros.findIndex(r => String(r.CDCADASTRO) === String(id));
          if (idx !== -1) lastCadastros[idx] = { ...lastCadastros[idx], ...{} };
        }
      }
    });
  }

  // Carregar estados do Brasil
  async function loadEstados() {
    try {
      // Verificar se já temos os dados e ambos os campos estão preenchidos
      // Mas sempre verificar dentro da aba de filtros também
      if (estadosCarregados) {
        // Buscar dentro da aba de filtros primeiro
        const tabFiltros = document.getElementById('tab-filtros');
        let filtroEstado = null;
        if (tabFiltros) {
          filtroEstado = tabFiltros.querySelector('#filtroEstado');
        }
        if (!filtroEstado) {
          filtroEstado = document.getElementById('filtroEstado');
        }
        
        const cadastroEstado = document.getElementById('cadastroEstado');
        
        // Se ambos existem e têm opções, não precisa recarregar
        if (filtroEstado && filtroEstado.options.length > 1 && 
            cadastroEstado && cadastroEstado.options.length > 1) {
          return;
        }
      }

      // Buscar dados da API
      const response = await fetch('/api/estados-brasil');
      if (!response.ok) {
        throw new Error('Erro ao buscar estados da API');
      }
      
      const estados = await response.json();

      const fillEstados = async (id, defaultText = 'Selecione') => {
        let el = null;
        
        // Tentar encontrar o elemento várias vezes
        for (let tentativa = 0; tentativa < 5; tentativa++) {
          // Tentar buscar diretamente
          el = document.getElementById(id);
          
          // Se não encontrou, tentar buscar dentro do container da aba
          if (!el) {
            const tabFiltros = document.getElementById('tab-filtros');
            const tabDados = document.getElementById('tab-dados');
            
            if (id === 'filtroEstado' && tabFiltros) {
              el = tabFiltros.querySelector(`#${id}`);
            } else if (id === 'cadastroEstado' && tabDados) {
              el = tabDados.querySelector(`#${id}`);
            }
          }
          
          // Se encontrou, sair do loop
          if (el) break;
          
          // Se não encontrou e ainda há tentativas, aguardar
          if (tentativa < 4) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        }
        
        if (!el) {
          return false;
        }

        // Limpar e preencher
        el.innerHTML = `<option value="">${defaultText}</option>`;
        
        if (estados && Array.isArray(estados) && estados.length > 0) {
          estados.forEach(e => {
            const opt = document.createElement('option');
            opt.value = e.uf;
            opt.textContent = `${e.uf} - ${e.nome}`;
            el.appendChild(opt);
          });
          
          // Forçar reflow múltiplas vezes
          void el.offsetHeight;
          void el.offsetWidth;
          
          // Disparar eventos para garantir renderização
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
      const response = await fetch(`/api/cidades?estado=${estado}`);
      const cidadesData = await response.json();
      
      if (tipo === 'dados') {
        cidades = cidadesData;
        const cidadeSelect = document.getElementById('cadastroCidade');
        cidadeSelect.innerHTML = '<option value="">Selecione</option>';
        cidadesData.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCIDADE;
          opt.textContent = c.NMCIDADE;
          cidadeSelect.appendChild(opt);
        });
      } else {
        // Para filtros, mantém o input de texto
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

  // Aplicar máscara de CPF/CNPJ no campo
  function aplicarMascaraCPFCNPJ() {
    const campo = document.getElementById('cadastroCGCCPF');
    if (campo && !campo.hasAttribute('data-mask-applied')) {
      campo.setAttribute('data-mask-applied', 'true');
      
      campo.addEventListener('input', function(e) {
        let value = e.target.value.replace(/\D/g, '');
        if (value.length > 14) value = value.substring(0, 14);
        e.target.value = formatarCPFCNPJ(value);
      });
      
      // Aplicar máscara também em paste
      campo.addEventListener('paste', function(e) {
        setTimeout(() => {
          let value = e.target.value.replace(/\D/g, '');
          if (value.length > 14) value = value.substring(0, 14);
          e.target.value = formatarCPFCNPJ(value);
        }, 10);
      });
    }
  }

  // Formatar celular
  function formatarCelular(celular) {
    const value = celular.replace(/\D/g, '');
    if (value.length === 11) {
      return value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
    }
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
      const rastreado = document.getElementById('filtroRastreado')?.value;
      if (rastreado) params.append('rastreado', rastreado);
      
      const response = await fetch(`/api/cadastros-gerais?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const cadastros = await response.json();
      
      // Garantir que cadastros é um array
      const cadastrosArray = Array.isArray(cadastros) ? cadastros : [];
      
      // Criar campo virtual CIDADE para cada cadastro
      const cadastrosComCidade = cadastrosArray.map(c => {
        const estado = c.CIDADE_ESTADO || '';
        const cidade = c.CIDADE_NOME || '';
        const cidadeFormatada = `${estado} - ${cidade}`.trim();
        return {
          ...c,
          CIDADE: cidadeFormatada === '-' ? 'Não informado' : cidadeFormatada
        };
      });
      
      // Armazenar dados em cache (mesmo se vazio)
      lastCadastros = cadastrosComCidade;
      
      // Atualizar contador
      const countEl = document.getElementById('cadastrosGridCountText');
      if (countEl) {
        const count = cadastrosComCidade.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Renderizar grid se já estiver inicializado
      if (gridTab) {
        try {
          gridTab.render(cadastrosComCidade);
        } catch (gridErr) {
          console.warn('[Cadastros] Erro ao renderizar grid:', gridErr);
          // Continuar mesmo se houver erro no grid
        }
      } else if (openTab === 'grid' && typeof GridEditor === 'undefined') {
        // Se o GridEditor não está carregado, carregar e inicializar
        try {
          await loadScript('/js/grid-editor.js');
          inicializarGridTab();
          if (gridTab) {
            gridTab.render(cadastrosComCidade);
          }
        } catch (gridErr) {
          console.warn('[Cadastros] Erro ao inicializar grid:', gridErr);
          // Continuar mesmo se houver erro no grid
        }
      }
      
      // Mudar para a aba solicitada (sempre, mesmo sem dados)
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
            <strong>Celular:</strong> ${formatarCelular(cg.NRCELULAR.toString())}<br>
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
      
      if (cadastro) {
        // Preencher campos básicos primeiro
        document.getElementById('cadastroId').value = cadastro.CDCADASTRO;
        document.getElementById('cadastroCodigo').value = cadastro.CDCADASTRO;
        document.getElementById('cadastroCGCCPF').value = formatarCPFCNPJ(cadastro.CGCCPF.toString());
        document.getElementById('cadastroRazaoSocial').value = cadastro.RZSOCIAL;
        document.getElementById('cadastroTipoPessoa').value = cadastro.FGFISICAJURIDICA;
        document.getElementById('cadastroTipoCadastro').value = cadastro.FGTIPOCADASTRO;
        
        // Mostrar/esconder campo Transportador baseado no tipo (ANTES de preencher o valor)
        const tipoCadastro = cadastro.FGTIPOCADASTRO;
        const divTransportador = document.getElementById('divTransportador');
        const selectTransportador = document.getElementById('cadastroTransportador');
        
        if (tipoCadastro === 'M') {
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
        
        // Preencher FGRASTREADO - campo simples S/N
        const rastreadoSelect = document.getElementById('cadastroRastreado');
        if (rastreadoSelect && cadastro.FGRASTREADO) {
          rastreadoSelect.value = String(cadastro.FGRASTREADO).trim().toUpperCase();
        } else if (rastreadoSelect) {
          rastreadoSelect.value = '';
        }
        document.getElementById('cadastroSituacao').value = cadastro.FGACTIVE;
        document.getElementById('cadastroCEP').value = cadastro.CEP ? cadastro.CEP.toString() : '';
        document.getElementById('cadastroEndereco').value = cadastro.ENDERECO;
        document.getElementById('cadastroNumero').value = cadastro.NRENDERECO;
        document.getElementById('cadastroComplemento').value = cadastro.COMPLEND;
        document.getElementById('cadastroBairro').value = cadastro.BAIRRO;
        document.getElementById('cadastroLatitude').value = cadastro.LATITUDE || '';
        document.getElementById('cadastroLongitude').value = cadastro.LONGITUDE || '';
        document.getElementById('cadastroEmail').value = cadastro.ENDEMAIL;
        document.getElementById('cadastroCelular').value = formatarCelular(cadastro.NRCELULAR.toString());
        
        // Mudar para a aba de dados ANTES de carregar estados (para garantir que os elementos estejam visíveis)
        document.getElementById('formTitle').textContent = 'Editar Cadastro Geral';
        showTab('dados');
        
        // Preencher Código Cidade diretamente (campo readonly)
        const codigoCidadeEl = document.getElementById('cadastroCodigoCidade');
        if (codigoCidadeEl && cadastro.CDCIDADE) {
          codigoCidadeEl.value = cadastro.CDCIDADE.toString();
        }
        
        // Garantir que os estados estejam carregados ANTES de preencher
        await loadEstados();
        
        // Aguardar um pouco para garantir que o DOM foi atualizado e a aba está visível
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Preencher UF - Estado
        // Fazer trim() para remover espaços em branco no início e fim
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
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  // Confirmar exclusão/reativação
  async function confirmarExclusao(id) {
    // Validação robusta do ID
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      console.error('[Cadastros] ID inválido na função confirmarExclusao:', id);
      showMessage('Erro: ID não disponível.', 'error');
      return;
    }
    
    // Converter para string para garantir consistência
    idValido = String(idValido).trim();
    
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (!modalMessage || !confirmYes || !confirmNo || !modalEl) {
      console.error('[Cadastros] Elementos do modal não encontrados');
      return;
    }
    
    try {
      // Buscar o status atual do cadastro
      const response = await fetch(`/api/cadastros-gerais/${idValido}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar cadastro');
      }
      
      const cadastro = await response.json();
      const estaAtivo = cadastro.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> este cadastro?<br><br><small style="color: #666;">O cadastro ficará inativo e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> este cadastro?<br><br><small style="color: #666;">O cadastro voltará a aparecer nas listagens e estará disponível para uso.</small>';
        action = 'activate';
        btnText = 'Reativar';
      }
      
      modalMessage.innerHTML = confirmMsg;
      
      // Armazenar ID e ação no dataset do modal
      modalEl.dataset.deleteId = idValido;
      modalEl.dataset.action = action;
      
      // Clonar botões para evitar múltiplos event listeners
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      
      // Atualizar texto do botão de confirmação
      newConfirmYes.textContent = btnText;
      
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      
      newConfirmYes.onclick = async () => {
        const idParaExcluir = modalEl.dataset.deleteId || idValido;
        const acao = modalEl.dataset.action || action;
        
        if (!idParaExcluir || idParaExcluir === 'undefined' || idParaExcluir === 'null' || idParaExcluir === '') {
          showMessage('Erro: ID não disponível.', 'error');
          modalEl.style.display = 'none';
          return;
        }
        
        try {
          const response = await fetch(`/api/cadastros-gerais/${idParaExcluir}?action=${acao}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Cadastro reativado com sucesso!' : 'Cadastro desativado com sucesso!'), 'success');
            // Garantir que está na aba Grid e recarregar dados
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do cadastro.', 'error');
          }
        } catch (err) {
          console.error('[Cadastros] Erro ao alterar status:', err);
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
      console.error('[Cadastros] Erro ao buscar status do cadastro:', err);
      showMessage('Erro ao verificar status do cadastro.', 'error');
    }
  }

  // Validar formulário
  function validarFormulario() {
    let cgccpf = document.getElementById('cadastroCGCCPF').value.replace(/\D/g, '');
    const tipoPessoa = document.getElementById('cadastroTipoPessoa').value;
    const email = document.getElementById('cadastroEmail').value;
    const celular = document.getElementById('cadastroCelular').value.replace(/\D/g, '');
    
    // Completar com zeros à esquerda antes de validar
    if (cgccpf && cgccpf.length > 0) {
      if (tipoPessoa === 'F') {
        cgccpf = cgccpf.padStart(11, '0'); // CPF: 11 dígitos
      } else if (tipoPessoa === 'J') {
        cgccpf = cgccpf.padStart(14, '0'); // CNPJ: 14 dígitos
      }
    }
    
    // Validar CPF/CNPJ
    if (tipoPessoa === 'F' && (cgccpf.length !== 11 || !validarCPF(cgccpf))) {
      showMessage('CPF inválido.', 'error', null, 'cadastroCGCCPF');
      return false;
    }
    if (tipoPessoa === 'J' && (cgccpf.length !== 14 || !validarCNPJ(cgccpf))) {
      showMessage('CNPJ inválido.', 'error', null, 'cadastroCGCCPF');
      return false;
    }
    
    // Validar email
    if (email && !validarEmail(email)) {
      showMessage('Email inválido.', 'error', null, 'cadastroEmail');
      return false;
    }
    
    // Validar celular
    if (celular.length !== 11) {
      showMessage('Celular inválido. Deve ter 11 dígitos.', 'error', null, 'cadastroCelular');
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
  
  // Salvar formulário
  cadastroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btnSalvar = cadastroForm.querySelector('button[type="submit"]');
    if (btnSalvar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnSalvar, true);
    }
    
    if (!validarFormulario()) {
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }
    
    // ✅ REMOVER FORMATAÇÃO DOS CAMPOS ANTES DE ENVIAR
    let cgccpfRaw = document.getElementById('cadastroCGCCPF').value.replace(/\D/g, '');
    const tipoPessoa = document.getElementById('cadastroTipoPessoa').value;
    
    // Completar com zeros à esquerda baseado no tipo de pessoa
    if (cgccpfRaw && cgccpfRaw.length > 0) {
      if (tipoPessoa === 'F') {
        cgccpfRaw = cgccpfRaw.padStart(11, '0'); // CPF: 11 dígitos
      } else if (tipoPessoa === 'J') {
        cgccpfRaw = cgccpfRaw.padStart(14, '0'); // CNPJ: 14 dígitos
      }
    }
    
    const celularRaw = document.getElementById('cadastroCelular').value.replace(/\D/g, '');
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
    const tipoCadastro = document.getElementById('cadastroTipoCadastro').value;
    const transportador = document.getElementById('cadastroTransportador')?.value;
    
    try {
      const cadastroData = {
        CGCCPF: cgccpfRaw, // ✅ CPF como string, preserva zeros
        RZSOCIAL: razaoSocial,
        FGFISICAJURIDICA: tipoPessoa,
        CEP: cepRaw || null,
        CDCIDADE: cidade ? parseInt(cidade) : null,
        ENDERECO: endereco,
        NRENDERECO: parseInt(numero),
        COMPLEND: complemento || null,
        BAIRRO: bairro,
        NRCELULAR: celularRaw, // ✅ também como string
        ENDEMAIL: email || null,
        LATITUDE: latitude || null,
        LONGITUDE: longitude || null,
        FGTIPOCADASTRO: tipoCadastro,
        FGRASTREADO: document.getElementById('cadastroRastreado')?.value || null,
        // CDTRANSPORTADOR: só enviar se for motorista E tiver valor selecionado
        // Se não tiver valor, não enviar (undefined) para preservar o valor atual no banco
        ...(tipoCadastro === 'M' && transportador ? { CDTRANSPORTADOR: parseFloat(transportador) } : tipoCadastro !== 'M' ? { CDTRANSPORTADOR: null } : {})
      };

      let response;
      if (id) {
        cadastroData.FGACTIVE = situacao;
        response = await fetch(`/api/cadastros-gerais/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cadastroData)
        });
      } else {
        response = await fetch('/api/cadastros-gerais', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cadastroData)
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
    } finally {
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
    }
  });

  // Carregar classes de frota para o cadastro
  async function loadClassesFrotaParaCadastro(cadastroId) {
    try {
      const response = await fetch(`/api/cadastro-classes/${cadastroId}`);
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
        headers: { 'Content-Type': 'application/json' },
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

  // Eventos
  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
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
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    cadastroForm?.reset();
    document.getElementById('cadastroId').value = '';
    document.getElementById('cadastroCodigo').value = '';
    document.getElementById('cadastroCodigoCidade').value = '';
    document.getElementById('formTitle').textContent = 'Novo Cadastro Geral';
    showTab('dados');
  });
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));
  
  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    
    // Forçar mudança para aba de filtros DIRETAMENTE, sem depender de showTab
    // Isso garante que funcione mesmo quando não há dados ou há erros
    const tabBtn = document.querySelector('.tab-btn[data-tab="filtros"]');
    const tabContent = document.getElementById('tab-filtros');
    
    // Desativar todas as abas
    tabs.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => {
      content.classList.remove('active');
      content.style.display = 'none';
    });
    
    // Ativar aba de filtros
    if (tabBtn) {
      tabBtn.classList.add('active');
    }
    if (tabContent) {
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
    document.getElementById('formTitle').textContent = 'Novo Cadastro Geral';
    showTab('dados');
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

  // Aplicar máscara na inicialização se o campo já existir
  setTimeout(() => {
    aplicarMascaraCPFCNPJ();
  }, 500);

  document.getElementById('cadastroCelular')?.addEventListener('input', function(e) {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 11) value = value.substring(0, 11);
    e.target.value = formatarCelular(value);
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

  // Event listener para mostrar/esconder campo Transportador baseado no tipo de cadastro
  document.getElementById('cadastroTipoCadastro')?.addEventListener('change', function() {
    const tipoCadastro = this.value;
    const divTransportador = document.getElementById('divTransportador');
    const selectTransportador = document.getElementById('cadastroTransportador');
    
    if (tipoCadastro === 'M') {
      // Mostrar campo Transportador
      if (divTransportador) {
        divTransportador.style.display = 'block';
      }
      // Carregar transportadores se ainda não foram carregados
      if (selectTransportador && selectTransportador.options.length <= 1) {
        loadTransportadores();
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
      
      // Popular combo do formulário
      if (selectTransportador) {
        selectTransportador.innerHTML = '<option value="">Selecione</option>';
        transportadores.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.CDCADASTRO;
          opt.textContent = `${t.CDCADASTRO} - ${t.RZSOCIAL}`;
          selectTransportador.appendChild(opt);
        });
      }
      
      // Popular combo do filtro
      if (selectFiltroTransportador) {
        selectFiltroTransportador.innerHTML = '<option value="">Todos</option>';
        transportadores.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.CDCADASTRO;
          opt.textContent = `${t.CDCADASTRO} - ${t.RZSOCIAL}`;
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
})();