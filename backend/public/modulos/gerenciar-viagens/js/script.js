// backend/public/modulos/gerenciar-viagens/js/script.js
// Gerenciar Viagens - Frontend
// Versão: 1.0
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

(function() {
  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const viagemForm = document.getElementById('viagemForm');
  const list = document.getElementById('viagensList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let estadosCarregados = false;
  let cidadesOrigem = [];
  let cidadesDestino = [];
  let roteirosCache = [];
  let mapa = null;
  let marcadorOrigem = null;
  let marcadorDestino = null;
  let linhaRota = null;
  let gridTab = null;
  let lastViagens = null;

  // ====================================
  // CONFIGURAÇÕES DE MAPA E ROTEAMENTO
  // ====================================
  const MAP_CONFIG = {
    // Servidor de tiles do mapa
    tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    // Alternativas:
    // 'https://tile.openstreetmap.de/{z}/{x}/{y}.png'
    // 'https://tiles.wmflabs.org/osm/{z}/{x}/{y}.png'
    
    // Servidor de roteamento OSRM
    osrmServer: 'https://router.project-osrm.org/route/v1/driving',
    // Alternativa: 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
    
    // Timeout para requisições de rota (ms)
    routeTimeout: 15000,
    
    // Atribuição
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    
    maxZoom: 19
  };

  // Função para carregar o Leaflet dinamicamente
  async function carregarLeaflet() {
    // Se já está carregado, retornar
    if (typeof L !== 'undefined') {
      return true;
    }

    // Verificar se o CSS já foi carregado
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }

    // Carregar o script do Leaflet
    return new Promise((resolve, reject) => {
      // Verificar se já existe um script do Leaflet
      if (document.querySelector('script[src*="leaflet"]')) {
        // Aguardar o script carregar
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof L !== 'undefined') {
            clearInterval(checkInterval);
            resolve(true);
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            reject(new Error('Timeout ao carregar Leaflet'));
          }
        }, 500);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      script.crossOrigin = '';
      script.onload = () => {
        // Aguardar um pouco para garantir que L está disponível
        setTimeout(() => {
          if (typeof L !== 'undefined') {
            resolve(true);
          } else {
            reject(new Error('Leaflet carregado mas L não está disponível'));
          }
        }, 100);
      };
      script.onerror = () => {
        reject(new Error('Erro ao carregar o script do Leaflet'));
      };
      document.head.appendChild(script);
    });
  }

  // Função para aguardar o Leaflet estar disponível
  async function aguardarLeaflet() {
    try {
      await carregarLeaflet();
      return true;
    } catch (err) {
      console.error('Erro ao carregar Leaflet:', err);
      return false;
    }
  }

  // Flag para controlar se o init já foi executado
  let initExecutado = false;
  // Flag para controlar se o SQL já foi executado (proteção adicional)
  let sqlExecutado = false;
  // Flag para controlar se o módulo acabou de ser carregado (primeira vez)
  let primeiraCarga = true;

  // Função de inicialização
  async function init() {
    // Se já foi executado, não executar novamente
    // IMPORTANTE: Verificar e marcar IMEDIATAMENTE para evitar execuções simultâneas
    if (initExecutado) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    // Isso previne condições de corrida onde múltiplas chamadas acontecem antes da primeira terminar
    initExecutado = true;
    
    // Aguardar um pouco para garantir que o DOM está totalmente renderizado
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // IMPORTANTE: Executar SQL de inicialização (init.sql) se existir
    // e AGUARDAR completamente antes de prosseguir
    try {
      await executarInitSQL();
      
      // O delay adicional já está dentro da função executarInitSQL()
      // Não precisamos de delay extra aqui, pois a função já aguarda tudo
    } catch (err) {
      // Erros silenciosos - não bloquear o módulo
    }
    
    // IMPORTANTE: Só mudar para a aba de filtros se for a primeira carga do módulo
    // E não estiver bloqueando mudanças (durante operações)
    // E APENAS após garantir que todo o SQL foi executado
    if (primeiraCarga && !bloqueandoMudancaAba) {
      const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
      // Só mudar se não houver aba ativa ou se já estiver em filtros
      if (!abaAtiva || abaAtiva === 'filtros') {
        // O showTab vai verificar se precisa carregar os combos e carregar automaticamente
        await showTab('filtros');
        // Preencher valores padrão dos filtros
        preencherFiltrosPadrao();
      }
      primeiraCarga = false; // Marcar que não é mais a primeira carga
    }
  }

  // Função para preencher valores padrão dos filtros
  function preencherFiltrosPadrao() {
    // Motorista Confirmado = Todos (vazio para mostrar todos)
    const filtroMotoristaConfirmado = document.getElementById('filtroMotoristaConfirmado');
    if (filtroMotoristaConfirmado) {
      filtroMotoristaConfirmado.value = '';
    }

    // Situação Viagem = Preparação (valor padrão, mas pode ser alterado ou limpo)
    const filtroSituacaoViagem = document.getElementById('filtroSituacaoViagem');
    if (filtroSituacaoViagem) {
      filtroSituacaoViagem.value = 'D'; // D = Preparação
    }

    // Data Início = hoje - 30 dias
    const filtroDataInicio = document.getElementById('filtroDataInicio');
    if (filtroDataInicio) {
      const hoje = new Date();
      const dataInicio = new Date(hoje);
      dataInicio.setDate(dataInicio.getDate() - 30);
      // Formatar como YYYY-MM-DD para input type="date"
      const dataInicioFormatada = dataInicio.toISOString().split('T')[0];
      filtroDataInicio.value = dataInicioFormatada;
    }

    // Data Fim = hoje + 30 dias
    const filtroDataFim = document.getElementById('filtroDataFim');
    if (filtroDataFim) {
      const hoje = new Date();
      const dataFim = new Date(hoje);
      dataFim.setDate(dataFim.getDate() + 30);
      // Formatar como YYYY-MM-DD para input type="date"
      const dataFimFormatada = dataFim.toISOString().split('T')[0];
      filtroDataFim.value = dataFimFormatada;
    }
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

  // Funções para controlar overlay de carregamento dos filtros
  function showLoadingOverlayFiltros(titulo = 'Aplicando Filtros', texto = 'Por favor, aguarde enquanto aplicamos os filtros...') {
    const overlay = document.getElementById('loadingOverlayFiltros');
    const loadingTitle = document.getElementById('loadingTitleFiltros');
    const loadingText = document.getElementById('loadingTextFiltros');
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
  
  function hideLoadingOverlayFiltros() {
    const overlay = document.getElementById('loadingOverlayFiltros');
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
      const response = await fetch('/modulos/gerenciar-viagens/sql/init.sql');
      
      // Atualizar mensagem do overlay
      showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          return;
        }
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
        execResponse = await fetch('/api/viagens/executar-init-sql', {
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
        // Incluir também resultados do tipo 'AVISO' (truncamentos em procedures)
        const comandosComProblema = result.resultados.filter(r => r.tipo === 'ERRO' || r.tipo === 'AVISO');
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        const comandosComAviso = result.resultados.filter(r => r.tipo === 'AVISO');
        
        // Tratar avisos primeiro (truncamentos em procedures)
        if (comandosComAviso.length > 0) {
          comandosComAviso.forEach(erro => {
            const comando = erro.comando || erro.sql || 'Comando desconhecido';
            // Extrair nome da stored procedure se possível
            const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                    comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                    comando.match(/\[?(\w+)\]?/i);
            const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
            // Log como aviso, não como erro
            console.warn(`[Init SQL] Aviso: Dados truncados na procedure ${procedureName} (isso pode ser normal em sincronizações)`);
          });
        }
        
        if (comandosComErro.length > 0) {
          // Separar erros de truncamento dos demais erros
          const errosTruncamento = [];
          const outrosErros = [];
          
          comandosComErro.forEach(erro => {
            // Capturar mensagem de todas as formas possíveis
            const mensagemRaw = erro.mensagem || erro.erro || erro.message || erro.error || '';
            const mensagem = String(mensagemRaw).toLowerCase();
            
            // Verificar se é erro de truncamento (verificar tanto a mensagem quanto o texto original)
            const isTruncamento = mensagem.includes('truncated') || 
                                  mensagem.includes('truncados') || 
                                  mensagem.includes('would be truncated') ||
                                  mensagem.includes('dados seriam truncados') ||
                                  mensagem.includes('string or binary data would be truncated') ||
                                  String(mensagemRaw).includes('truncated') ||
                                  String(mensagemRaw).includes('truncados');
            
            if (isTruncamento) {
              errosTruncamento.push(erro);
            } else {
              // Verificar se é outro erro esperado
              const errosEsperados = [
                'already exists',
                'já existe',
                'duplicate',
                'duplicado',
                'there is already',
                'já há'
              ];
              const isErroEsperado = errosEsperados.some(esperado => mensagem.includes(esperado));
              if (!isErroEsperado) {
                outrosErros.push(erro);
              }
            }
          });
          
          // Log de erros de truncamento como aviso (não como erro)
          if (errosTruncamento.length > 0) {
            errosTruncamento.forEach(erro => {
              const comando = erro.comando || erro.sql || 'Comando desconhecido';
              // Extrair nome da stored procedure se possível
              const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                      comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                      comando.match(/\[?(\w+)\]?/i);
              const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
              // Log como aviso, não como erro
              console.warn(`[Init SQL] Aviso: Dados truncados na procedure ${procedureName} (isso pode ser normal em sincronizações)`);
            });
          }
          
          // Log apenas erros reais críticos
          if (outrosErros.length > 0) {
            outrosErros.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              const comando = erro.comando || erro.sql || 'Comando desconhecido';
              // Extrair nome da stored procedure se possível
              const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                      comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                      comando.match(/\[?(\w+)\]?/i);
              const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
              
              if (typeof mensagem === 'object') {
                console.error(`Erro no init.sql [Procedure: ${procedureName}]:`, JSON.stringify(mensagem));
              } else {
                console.error(`Erro no init.sql [Procedure: ${procedureName}]:`, mensagem);
              }
            });
          }
        }
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      // Isso é importante para operações que podem ter efeitos colaterais assíncronos
      // Aumentado para 500ms para garantir que operações complexas sejam concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Esconder overlay em caso de erro
      hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
  }

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  // IMPORTANTE: Garantir que execute apenas uma vez, mesmo se o módulo for carregado múltiplas vezes
  if (!initExecutado) {
    if (document.readyState === 'loading') {
      // Se o DOM ainda está carregando, aguardar o evento
      document.addEventListener('DOMContentLoaded', () => {
        if (!initExecutado) {
          init();
        }
      }, { once: true }); // once: true garante que o listener seja removido após executar
    } else {
      // DOM já está pronto, executar imediatamente
      init();
    }
  }

  // Função para mudar abas
  async function showTab(tabId) {
    try {
      // PROTEÇÃO: Se estiver bloqueando mudanças de aba (durante operações como aplicar filtros),
      // não permitir mudar para "filtros" automaticamente
      if (bloqueandoMudancaAba && tabId === 'filtros') {
        return; // Não mudar a aba durante operações
      }
      
      // PROTEÇÃO: Se estiver tentando mudar para "filtros" mas há uma viagem sendo editada,
      // não permitir a mudança (a menos que seja explicitamente solicitado)
      if (tabId === 'filtros') {
        const viagemIdEmEdicao = document.getElementById('viagemId')?.value;
        const filtroIdViagem = document.getElementById('filtroIdViagem')?.value;
        const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
        
        // Se há uma viagem sendo editada E o campo filtroIdViagem está vazio,
        // E a aba atual é "dados", não permitir mudar para filtros
        if (viagemIdEmEdicao && viagemIdEmEdicao.trim() !== '' && 
            (!filtroIdViagem || filtroIdViagem.trim() === '') &&
            abaAtiva === 'dados') {
          return; // Não mudar a aba
        }
      }
      
      // Primeiro, mudar a aba imediatamente
      tabs.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => {
        content.classList.remove('active');
      });
      
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
      
      // Se for a aba de grid, inicializar o GridEditor
      if (tabId === 'grid') {
        try {
          if (!gridTab) {
            await loadScript('/js/grid-editor.js');
            inicializarGridTab();
          }
          // Sempre renderizar, mesmo se não houver dados (grid vazio)
          const viagensParaRenderizar = lastViagens || [];
          if (gridTab) {
            gridTab.render(viagensParaRenderizar);
          } else if (viagensParaRenderizar.length === 0) {
            // Se não há dados e grid não está inicializado, aplicar filtros para buscar
            // Mas não bloquear a mudança de aba
            setTimeout(() => {
              applyFilters('grid').catch(() => {
                // Erro silencioso ao aplicar filtros automaticamente
              });
            }, 100);
          }
        } catch (gridErr) {
          // Erro silencioso ao processar grid - não bloquear mudança de aba
        }
      }

      // Se for a aba Compatíveis, inicializar event listeners e carregar viagem em edição se houver
      if (tabId === 'compatíveis') {
        setTimeout(async () => {
          tentarInicializarListeners();
          
          // Verificar se há uma viagem em edição
          const viagemIdEmEdicao = document.getElementById('viagemId')?.value;
          if (viagemIdEmEdicao) {
            await carregarEselecionarViagem(viagemIdEmEdicao);
          }
        }, 100);
      }

      // Se for a aba Convocações, inicializar
      if (tabId === 'convocações') {
        setTimeout(async () => {
          inicializarAbaConvocacoes();
          
          // Se houver viagem selecionada, preencher filtro e carregar convocações
          if (viagemSelecionada) {
            await carregarEselecionarViagemConvocacoes(viagemSelecionada);
          } else {
            // Verificar se há uma viagem em edição
            const viagemIdEmEdicao = document.getElementById('viagemId')?.value;
            if (viagemIdEmEdicao) {
              await carregarEselecionarViagemConvocacoes(viagemIdEmEdicao);
            }
          }
        }, 100);
      }

      // Se for a aba Integração Meta, carregar logs do banco e atualizar
      if (tabId === 'integracao-meta') {
        setTimeout(() => {
          const tabContent = document.getElementById('tab-integracao-meta');
          if (tabContent && tabContent.classList.contains('active')) {
            if (typeof window.carregarLogsMeta === 'function') {
              window.carregarLogsMeta();
            }
          } else {
            setTimeout(() => {
              if (typeof window.carregarLogsMeta === 'function') {
                window.carregarLogsMeta();
              }
            }, 300);
          }
        }, 200);
      }

      // Se for a aba Histórico, inicializar
      if (tabId === 'historico') {
        setTimeout(async () => {
          inicializarAbaHistorico();
          
          // Se houver um roteiro selecionado, carregar automaticamente
          const selectRoteiro = document.getElementById('viagemRoteiro');
          if (selectRoteiro && selectRoteiro.value && selectRoteiro.value !== '') {
            await carregarHistoricoRoteiro();
          }
        }, 100);
      }
    } catch (err) {
      // Erro silencioso ao mudar aba - forçar mudança mesmo em caso de erro
      try {
        tabs.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => {
          content.classList.remove('active');
        });
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
        const tabContent = document.getElementById(`tab-${tabId}`);
        if (tabBtn) tabBtn.classList.add('active');
        if (tabContent) {
          tabContent.classList.add('active');
        }
      } catch (forceErr) {
        console.error('[Viagens] Erro ao forçar mudança de aba:', forceErr);
      }
    }
    
    // Se for a aba de filtros, garantir que os combos estão carregados
    if (tabId === 'filtros') {
      // Aguardar para garantir que a aba está visível (display: block)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Usar requestAnimationFrame para garantir que o navegador renderizou a aba
      await new Promise(resolve => requestAnimationFrame(resolve));
      
      const filtroTipo = document.getElementById('filtroTipoViagem');
      const filtroClasse = document.getElementById('filtroClasseFrota');
      const filtroContratador = document.getElementById('filtroContratador');
      const filtroOrigem = document.getElementById('filtroOrigemEstado');
      const filtroDestino = document.getElementById('filtroDestinoEstado');
      
      // Verificar se os campos estão vazios (apenas com a opção padrão)
      const precisaRecarregar = 
        (!filtroTipo || filtroTipo.options.length <= 1) ||
        (!filtroClasse || filtroClasse.options.length <= 1) ||
        (!filtroContratador || filtroContratador.options.length <= 1) ||
        (!filtroOrigem || filtroOrigem.options.length <= 1) ||
        (!filtroDestino || filtroDestino.options.length <= 1);
      
      if (precisaRecarregar) {
        await loadCombos();
        await loadEstados();
        
        // Aguardar múltiplos frames para garantir renderização completa
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verificar novamente se os campos ainda estão preenchidos
        const filtroTipoCheck = document.getElementById('filtroTipoViagem');
        const filtroClasseCheck = document.getElementById('filtroClasseFrota');
        const filtroContratadorCheck = document.getElementById('filtroContratador');
        const filtroOrigemCheck = document.getElementById('filtroOrigemEstado');
        const filtroDestinoCheck = document.getElementById('filtroDestinoEstado');
        
        const aindaPrecisaRecarregar = 
          (!filtroTipoCheck || filtroTipoCheck.options.length <= 1) ||
          (!filtroClasseCheck || filtroClasseCheck.options.length <= 1) ||
          (!filtroContratadorCheck || filtroContratadorCheck.options.length <= 1) ||
          (!filtroOrigemCheck || filtroOrigemCheck.options.length <= 1) ||
          (!filtroDestinoCheck || filtroDestinoCheck.options.length <= 1);
        
        if (aindaPrecisaRecarregar) {
          await loadCombos();
          await loadEstados();
          await loadRoteirosParaFiltro();
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // Forçar reflow múltiplas vezes para garantir renderização
        const elementos = [filtroTipo, filtroClasse, filtroContratador, filtroOrigem, filtroDestino].filter(Boolean);
        elementos.forEach(el => {
          void el.offsetHeight;
          void el.offsetWidth;
        });
        
        // Disparar evento de mudança para forçar atualização do select
        elementos.forEach(el => {
          if (el.tagName === 'SELECT') {
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
        
        // Verificação final após mais um delay
        // IMPORTANTE: Verificar se a aba ainda é 'filtros' antes de executar
        setTimeout(() => {
          // Verificar se ainda estamos na aba de filtros antes de executar
          const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
          if (abaAtiva !== 'filtros' || bloqueandoMudancaAba) {
            return; // Não executar se a aba mudou ou se está bloqueando mudanças
          }
          
          const elementosFinais = [
            document.getElementById('filtroTipoViagem'),
            document.getElementById('filtroClasseFrota'),
            document.getElementById('filtroContratador'),
            document.getElementById('filtroOrigemEstado'),
            document.getElementById('filtroDestinoEstado')
          ].filter(Boolean);
          
          elementosFinais.forEach(el => {
            if (el.options.length <= 1) {
              // Recarregar apenas este campo específico seria complexo, então vamos recarregar tudo
              loadCombos().then(() => loadEstados());
            }
          });
        }, 500);
      }
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
      console.error('[Viagens] GridEditor não está disponível');
      return;
    }

    gridTab = new GridEditor({
      container: '#viagensGrid',
      columns: [
        { field: 'IDVIAGEM', header: 'ID', editable: false, isId: true, width: '80px' },
        { field: 'FGSITVIAGEM_NOME', header: 'Situação Viagem', editable: true, type: 'select', width: '140px',
          options: [
            { value: 'Aprovada', label: 'Aprovada' },
            { value: 'Cancelada', label: 'Cancelada' },
            { value: 'Preparação', label: 'Preparação' },
            { value: 'Final de rota', label: 'Final de rota' },
            { value: 'Viagem finalizada', label: 'Viagem finalizada' },
            { value: 'Emissão documentos', label: 'Emissão documentos' },
            { value: 'Programada', label: 'Programada' },
            { value: 'Em trânsito', label: 'Em trânsito' }
          ]
        },
        { field: 'DSTIPOVIAGEM', header: 'Tipo Viagem', editable: false, width: '150px' },
        { field: 'DSROTEIRO', header: 'Roteiro', editable: false, width: '180px' },
        { field: 'CONTRATADOR_NOME', header: 'Contratador', editable: false, width: '200px' },
        { field: 'DSCLASSEFROTA', header: 'Classe Frota', editable: false, width: '150px' },
        { 
          field: 'DTPREVINICIO', 
          header: 'Data Início', 
          editable: true, 
          type: 'datetime-local', 
          width: '160px',
          format: (val) => {
            if (!val) return '';
            
            // Parsear string diretamente sem conversão de fuso horário
            let str = String(val).trim();
            str = str.replace(/\.\d{3}/, ''); // Remover milissegundos
            
            const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):?(\d{2})?/);
            if (match) {
              const [, year, month, day, hours, minutes] = match;
              return `${day}/${month}/${year} ${hours}:${minutes}`;
            }
            
            // Fallback
            const date = new Date(val);
            if (isNaN(date.getTime())) return val;
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
          }
        },
        { 
          field: 'DTPREVFINAL', 
          header: 'Data Fim', 
          editable: true, 
          type: 'datetime-local', 
          width: '160px',
          format: (val) => {
            if (!val) return '';
            
            // Parsear string diretamente sem conversão de fuso horário
            let str = String(val).trim();
            str = str.replace(/\.\d{3}/, ''); // Remover milissegundos
            
            const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):?(\d{2})?/);
            if (match) {
              const [, year, month, day, hours, minutes] = match;
              return `${day}/${month}/${year} ${hours}:${minutes}`;
            }
            
            // Fallback
            const date = new Date(val);
            if (isNaN(date.getTime())) return val;
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day}/${month}/${year} ${hours}:${minutes}`;
          }
        },
        { 
          field: 'QTD_ACIONADOS', 
          header: '📢', 
          editable: false, 
          width: '60px',
          format: (val) => val || 0
        },
        { 
          field: 'QTD_ACEITE', 
          header: '✅', 
          editable: false, 
          width: '60px',
          format: (val) => {
            const qtd = val || 0;
            return qtd > 0 ? `<span style="color: #28a745; font-weight: 600;">${qtd}</span>` : '0';
          }
        },
        { 
          field: 'QTD_RECUSA', 
          header: '❌', 
          editable: false, 
          width: '60px',
          format: (val) => {
            const qtd = val || 0;
            return qtd > 0 ? `<span style="color: #dc3545; font-weight: 600;">${qtd}</span>` : '0';
          }
        },
        { 
          field: 'TEM_CONFIRMADO', 
          header: '✓', 
          editable: false, 
          width: '60px',
          format: (val) => {
            return val === 'S' 
              ? '<span style="color: #28a745; font-weight: 700;">✓ SIM</span>' 
              : '<span style="color: #999;">NÃO</span>';
          }
        }
      ],
      apiEndpoint: '/api/viagens',
      // Ao clicar em editar dentro do Grid, abrir o formulário de edição
      onBeforeEdit: async (id) => {
        await loadViagemParaEdicao(id);
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
        if (lastViagens) {
          const idx = lastViagens.findIndex(r => String(r.IDVIAGEM) === String(id));
          if (idx !== -1) lastViagens[idx] = { ...lastViagens[idx], ...{} };
        }
      }
    });
  }

  // Carregar combos principais
  async function loadCombos() {
    try {
      // Buscar elementos sem ativar a aba de filtros
      // Os elementos existem no DOM mesmo que não estejam visíveis
      let filtroTipoEl = document.getElementById('filtroTipoViagem');
      let filtroClasseEl = document.getElementById('filtroClasseFrota');
      let filtroContratadorEl = document.getElementById('filtroContratador');
      
      // Se não encontrou, tentar buscar dentro do container de filtros OU dados
      if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
        const filtroContainer = document.getElementById('tab-filtros');
        const dadosContainer = document.getElementById('tab-dados');
        
        if (filtroContainer) {
          if (!filtroTipoEl) filtroTipoEl = filtroContainer.querySelector('#filtroTipoViagem');
          if (!filtroClasseEl) filtroClasseEl = filtroContainer.querySelector('#filtroClasseFrota');
          if (!filtroContratadorEl) filtroContratadorEl = filtroContainer.querySelector('#filtroContratador');
        }
        
        // Também tentar buscar na aba de dados (para formulário de edição)
        if (dadosContainer) {
          if (!filtroTipoEl) filtroTipoEl = dadosContainer.querySelector('#filtroTipoViagem');
          if (!filtroClasseEl) filtroClasseEl = dadosContainer.querySelector('#filtroClasseFrota');
          if (!filtroContratadorEl) filtroContratadorEl = dadosContainer.querySelector('#filtroContratador');
        }
      }
      
      if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Tentar novamente
        filtroTipoEl = document.getElementById('filtroTipoViagem');
        filtroClasseEl = document.getElementById('filtroClasseFrota');
        filtroContratadorEl = document.getElementById('filtroContratador');
        
        if (!filtroTipoEl || !filtroClasseEl || !filtroContratadorEl) {
          return;
        }
      }
      
      // Buscar dados
      const tiposResponse = await fetch('/api/tipos-viagem-combo');
      const situacoesResponse = await fetch('/api/situacoes-viagem-combo');
      const classesResponse = await fetch('/api/classes-frota-combo');
      const contratadoresResponse = await fetch('/api/contratadores-combo');
      
      if (!tiposResponse.ok || !situacoesResponse.ok || !classesResponse.ok || !contratadoresResponse.ok) {
        throw new Error('Erro ao buscar dados da API');
      }
      
      const tipos = await tiposResponse.json();
      const situacoes = await situacoesResponse.json();
      const classes = await classesResponse.json();
      const contratadores = await contratadoresResponse.json();

      const fillSelect = (id, items, valueField, labelField, defaultText = 'Selecione') => {
        let el = document.getElementById(id);
        
        // Se não encontrou, tentar buscar dentro do container
        if (!el) {
          const container = document.getElementById('tab-filtros') || document.getElementById('tab-dados');
          if (container) {
            el = container.querySelector(`#${id}`);
          }
        }
        
        if (!el) {
          return false;
        }
        
        // Limpar e preencher
        el.innerHTML = `<option value="">${defaultText}</option>`;
        
        if (items && Array.isArray(items) && items.length > 0) {
          items.forEach(item => {
            const opt = document.createElement('option');
            opt.value = String(item[valueField] || '');
            opt.textContent = String(item[labelField] || '');
            el.appendChild(opt);
          });
          
          // Forçar reflow imediatamente após preencher
          void el.offsetHeight;
          
          // Verificar se as opções foram realmente adicionadas
          const optionsCount = el.options.length;
          if (optionsCount <= 1) {
            // Tentar novamente após um pequeno delay
            setTimeout(() => {
              if (el.options.length <= 1) {
                el.innerHTML = `<option value="">${defaultText}</option>`;
                items.forEach(item => {
                  const opt = document.createElement('option');
                  opt.value = String(item[valueField] || '');
                  opt.textContent = String(item[labelField] || '');
                  el.appendChild(opt);
                });
                void el.offsetHeight;
              }
            }, 100);
          }
          
          return true;
        } else {
          return false;
        }
      };

      // Preencher campos de filtro (usam "Todos" ou "Todas")
      fillSelect('filtroTipoViagem', tipos, 'CDTIPOVIAGEM', 'DSTIPOVIAGEM', 'Todos');
      fillSelect('filtroClasseFrota', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA', 'Todas');
      fillSelect('filtroContratador', contratadores, 'CDCADASTRO', 'RZSOCIAL', 'Todos');
      
      // Verificar se os campos foram realmente preenchidos (reutilizar variáveis já declaradas)
      filtroTipoEl = document.getElementById('filtroTipoViagem');
      filtroClasseEl = document.getElementById('filtroClasseFrota');
      filtroContratadorEl = document.getElementById('filtroContratador');
      
      // Preencher campos do formulário de dados (usam "Selecione")
      fillSelect('viagemTipoViagem', tipos, 'CDTIPOVIAGEM', 'DSTIPOVIAGEM', 'Selecione');
      fillSelect('viagemSituacao', situacoes, 'CDSITUACAOVIAGEM', 'DSSITUACAOVIAGEM', 'Selecione');
      fillSelect('viagemClasseFrota', classes, 'CDCLASSEFROTA', 'DSCLASSEFROTA', 'Selecione');
      fillSelect('viagemContratador', contratadores, 'CDCADASTRO', 'RZSOCIAL', 'Selecione');
      
      // Forçar reflow para garantir renderização
      if (filtroTipoEl) void filtroTipoEl.offsetHeight;
      if (filtroClasseEl) void filtroClasseEl.offsetHeight;
      if (filtroContratadorEl) void filtroContratadorEl.offsetHeight;
    } catch (err) {
      showMessage('Erro ao carregar opções. Verifique a conexão.', 'error');
    }
  }

  // Carregar estados do Brasil
  async function loadEstados() {
    try {
      // Buscar elementos sem ativar a aba de filtros
      // Os elementos existem no DOM mesmo que não estejam visíveis
      let filtroOrigemEl = document.getElementById('filtroOrigemEstado');
      let filtroDestinoEl = document.getElementById('filtroDestinoEstado');
      
      // Se não encontrou, tentar buscar dentro do container de filtros
      if (!filtroOrigemEl || !filtroDestinoEl) {
        const filtroContainer = document.getElementById('tab-filtros');
        if (filtroContainer) {
          filtroOrigemEl = filtroContainer.querySelector('#filtroOrigemEstado');
          filtroDestinoEl = filtroContainer.querySelector('#filtroDestinoEstado');
        }
      }
      
      if (!filtroOrigemEl || !filtroDestinoEl) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Tentar novamente
        filtroOrigemEl = document.getElementById('filtroOrigemEstado');
        filtroDestinoEl = document.getElementById('filtroDestinoEstado');
        
        if (!filtroOrigemEl || !filtroDestinoEl) {
          return;
        }
      }
      
      // Buscar dados
      const response = await fetch('/api/estados-brasil');
      
      if (!response.ok) {
        throw new Error('Erro ao buscar estados da API');
      }
      
      const estados = await response.json();
      
      const fillEstados = (id, defaultText = 'Selecione') => {
        let el = document.getElementById(id);
        
        // Se não encontrou, tentar buscar dentro do container
        if (!el) {
          const container = document.getElementById('tab-filtros') || document.getElementById('tab-dados');
          if (container) {
            el = container.querySelector(`#${id}`);
          }
        }
        
        if (!el) {
          return false;
        }
        
        el.innerHTML = `<option value="">${defaultText}</option>`;
        
        if (estados && Array.isArray(estados) && estados.length > 0) {
          estados.forEach(e => {
            const opt = document.createElement('option');
            opt.value = String(e.uf || '');
            opt.textContent = `${e.uf} - ${e.nome}`;
            el.appendChild(opt);
          });
          return true;
        } else {
          return false;
        }
      };

      // Preencher campos de filtro (usam "Todos")
      fillEstados('filtroOrigemEstado', 'Todos');
      fillEstados('filtroDestinoEstado', 'Todos');
      
      // Verificar se os campos foram realmente preenchidos (reutilizar variáveis já declaradas)
      filtroOrigemEl = document.getElementById('filtroOrigemEstado');
      filtroDestinoEl = document.getElementById('filtroDestinoEstado');
      
      // Preencher campos do formulário de dados (usam "Selecione")
      fillEstados('viagemOrigemEstado', 'Selecione');
      fillEstados('viagemDestinoEstado', 'Selecione');

      // Forçar reflow para garantir renderização
      if (filtroOrigemEl) void filtroOrigemEl.offsetHeight;
      if (filtroDestinoEl) void filtroDestinoEl.offsetHeight;

      estadosCarregados = true;
    } catch (err) {
      showMessage('Erro ao carregar estados. Verifique a conexão.', 'error');
    }
  }

  // Carregar cidades por estado
  async function loadCidadesPorEstado(estado, tipo) {
    if (!estado) return;
    
    try {
      const response = await fetch(`/api/cidades-por-estado/${estado}`);
      const cidades = await response.json();
      
      if (tipo === 'origem') {
        cidadesOrigem = cidades;
        const cidadeSelect = document.getElementById('viagemOrigemCidade');
        cidadeSelect.innerHTML = '<option value="">Selecione</option>';
        cidades.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCIDADE;
          opt.textContent = c.NMCIDADE;
          cidadeSelect.appendChild(opt);
        });
      } else {
        cidadesDestino = cidades;
        const cidadeSelect = document.getElementById('viagemDestinoCidade');
        cidadeSelect.innerHTML = '<option value="">Selecione</option>';
        cidades.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.CDCIDADE;
          opt.textContent = c.NMCIDADE;
          cidadeSelect.appendChild(opt);
        });
      }
    } catch (err) {
      console.error('Erro ao carregar cidades:', err);
      showMessage('Erro ao carregar cidades. Verifique a conexão.', 'error');
    }
  }

  // Carregar roteiros baseados em origem e destino
  async function loadRoteirosPorRota(origem, destino) {
    try {
      let url = '/api/roteiros-combo';
      const params = new URLSearchParams();
      if (origem) params.append('origem', origem);
      if (destino) params.append('destino', destino);
      if (params.toString()) url += `?${params.toString()}`;
      
      const response = await fetch(url);
      const roteiros = await response.json();
      roteirosCache = roteiros;
      
      const roteiroSelect = document.getElementById('viagemRoteiro');
      roteiroSelect.innerHTML = '<option value="">Selecione</option>';
      roteiros.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.IDROTEIRO;
        opt.textContent = `${r.IDROTEIRO} - ${r.DSROTEIRO}`;
        opt.dataset.distancia = r.DISTANCIAKM;
        opt.dataset.origem = r.ORIGEM_CODIGO;
        opt.dataset.destino = r.DESTINO_CODIGO;
        roteiroSelect.appendChild(opt);
      });
    } catch (err) {
      console.error('Erro ao carregar roteiros:', err);
      showMessage('Erro ao carregar roteiros. Verifique a conexão.', 'error');
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    // Mostrar overlay de carregamento
    showLoadingOverlayFiltros('Aplicando Filtros', 'Por favor, aguarde enquanto aplicamos os filtros...');
    
    const btnAplicar = filtroForm?.querySelector('button[type="submit"]');
    if (btnAplicar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnAplicar, true);
    }

    try {
      // Marcar que estamos aplicando filtros para evitar mudanças automáticas de aba
      bloqueandoMudancaAba = true;
      
      const params = new URLSearchParams();
      const idViagem = document.getElementById('filtroIdViagem')?.value;
      const situacaoViagem = document.getElementById('filtroSituacaoViagem')?.value;
      const tipoViagem = document.getElementById('filtroTipoViagem')?.value;
      const origemEstado = document.getElementById('filtroOrigemEstado')?.value;
      const origemCidade = document.getElementById('filtroOrigemCidade')?.value;
      const destinoEstado = document.getElementById('filtroDestinoEstado')?.value;
      const destinoCidade = document.getElementById('filtroDestinoCidade')?.value;
      const roteiro = document.getElementById('filtroRoteiro')?.value;
      const classeFrota = document.getElementById('filtroClasseFrota')?.value;
      const contratador = document.getElementById('filtroContratador')?.value;
      const dataInicio = document.getElementById('filtroDataInicio')?.value;
      const dataFim = document.getElementById('filtroDataFim')?.value;
      const rastreado = document.getElementById('filtroRastreado')?.value;
      const motoristaConfirmado = document.getElementById('filtroMotoristaConfirmado')?.value;
      
      if (idViagem) params.append('idViagem', idViagem);
      if (situacaoViagem) params.append('situacaoViagem', situacaoViagem);
      if (tipoViagem) params.append('tipoViagem', tipoViagem);
      if (origemEstado) params.append('origemEstado', origemEstado);
      if (origemCidade) params.append('origemCidade', origemCidade);
      if (destinoEstado) params.append('destinoEstado', destinoEstado);
      if (destinoCidade) params.append('destinoCidade', destinoCidade);
      if (roteiro) params.append('roteiro', roteiro);
      if (classeFrota) params.append('classeFrota', classeFrota);
      if (contratador) params.append('contratador', contratador);
      if (dataInicio) params.append('dataInicio', dataInicio);
      if (dataFim) params.append('dataFim', dataFim);
      if (rastreado) params.append('rastreado', rastreado);
      if (motoristaConfirmado) params.append('motoristaConfirmado', motoristaConfirmado);
      
      const response = await fetch(`/api/viagens?${params.toString()}`);
      const viagens = await response.json();
      
      // Armazenar dados em cache
      lastViagens = viagens;
      
      // Atualizar contador
      const countEl = document.getElementById('viagensGridCountText');
      if (countEl) {
        const count = viagens.length || 0;
        countEl.textContent = `${count} registro(s) encontrado(s)`;
      }
      
      // Renderizar grid se já estiver inicializado
      if (gridTab) {
        gridTab.render(viagens);
      } else if (openTab === 'grid' && typeof GridEditor === 'undefined') {
        // Se o GridEditor não está carregado, carregar e inicializar
        await loadScript('/js/grid-editor.js');
        inicializarGridTab();
        if (gridTab) {
          gridTab.render(viagens);
        }
      }
      
      // Mudar para a aba solicitada
      await showTab(openTab);
      
      // Proteção adicional: garantir que a aba permaneça ativa por pelo menos 1 segundo
      setTimeout(() => {
        const abaAtiva = document.querySelector('.tab-btn.active')?.getAttribute('data-tab');
        if (abaAtiva !== openTab) {
          // Se a aba mudou, forçar de volta
          tabs.forEach(btn => btn.classList.remove('active'));
          tabContents.forEach(content => content.classList.remove('active'));
          const tabBtn = document.querySelector(`.tab-btn[data-tab="${openTab}"]`);
          const tabContent = document.getElementById(`tab-${openTab}`);
          if (tabBtn) tabBtn.classList.add('active');
          if (tabContent) tabContent.classList.add('active');
        }
        bloqueandoMudancaAba = false;
      }, 1000);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage('Erro ao carregar viagens.', 'error');
      bloqueandoMudancaAba = false;
    } finally {
      // Esconder overlay de filtros
      hideLoadingOverlayFiltros();
      
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    }
  }

  // Renderizar lista
  function renderList(viagens) {
    if (!viagens || viagens.length === 0) {
      list.innerHTML = '<p class="empty">Nenhuma viagem encontrada.</p>';
      return;
    }

    list.innerHTML = viagens.map(v => {
      // Garantir que o ID seja válido e convertido para string
      const viagemId = v.IDVIAGEM != null ? String(v.IDVIAGEM) : '';
      
      if (!viagemId) {
        return '';
      }
      
      return `
      <div class="list-item ${v.FGACTIVE === 'N' ? 'inactive' : ''}" data-id="${viagemId}">
        <div>
          <strong>${v.IDVIAGEM} - ${v.FGSITVIAGEM_NOME}</strong>
          <small>
            <strong>Tipo:</strong> ${v.DSTIPOVIAGEM || 'Não informado'}<br>
            <strong>Situação:</strong> ${v.DSSITUACAOVIAGEM || 'Não informado'}<br>
            <strong>Origem:</strong> ${v.ORIGEM_ESTADO} - ${v.ORIGEM_CIDADE}<br>
            <strong>Destino:</strong> ${v.DESTINO_ESTADO} - ${v.DESTINO_CIDADE}<br>
            <strong>Roteiro:</strong> ${v.DSROTEIRO || 'Não informado'}<br>
            <strong>Contratador:</strong> ${v.CONTRATADOR_NOME || 'Não informado'}<br>
            <strong>Status:</strong> ${v.FGACTIVE === 'S' ? 'Ativo' : 'Inativo'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${viagemId}">Editar</button>
          <button class="btn delete" data-id="${viagemId}">Excluir</button>
        </div>
      </div>
    `;
    }).filter(item => item !== '').join('');
  }

  // Carregar viagem para edição
  async function loadViagemParaEdicao(id) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      // Isso evita que dados de uma viagem apareçam em outra
      const viagemForm = document.getElementById('viagemForm');
      if (viagemForm) {
        viagemForm.reset();
      }
      
      // Forçar mudança para aba de dados ANTES de qualquer coisa
      await showTab('dados');
      
      // Aguardar para garantir que a mudança foi renderizada
      await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const response = await fetch(`/api/viagens/${id}`);
      const viagem = await response.json();
      
      if (viagem) {
        // Carregar combos e estados PRIMEIRO, antes de preencher
        // IMPORTANTE: Não mudar a aba durante o carregamento
        if (!estadosCarregados) {
          await loadEstados();
        }
        await loadCombos();
        
        // Garantir que a aba de dados continua ativa após carregar combos
        // Forçar novamente para evitar que algum código assíncrono mude a aba
        tabs.forEach(btn => btn.classList.remove('active'));
        tabContents.forEach(content => content.classList.remove('active'));
        const tabBtnDados = document.querySelector('.tab-btn[data-tab="dados"]');
        const tabContentDados = document.getElementById('tab-dados');
        if (tabBtnDados) tabBtnDados.classList.add('active');
        if (tabContentDados) tabContentDados.classList.add('active');
        
        // Aguardar um pouco para garantir que os selects foram renderizados
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Preencher campos básicos (não dependem de combos)
        document.getElementById('viagemId').value = viagem.IDVIAGEM || '';
        document.getElementById('viagemIdViagem').value = viagem.IDVIAGEM || '';
        document.getElementById('viagemUsuario').value = viagem.SGUSERINCLUSAO || '';
        document.getElementById('viagemDataInclusao').value = formatarDataParaInput(viagem.DHINCLUSAO);
        document.getElementById('viagemDataInicio').value = formatarDataParaInput(viagem.DTPREVINICIO);
        document.getElementById('viagemDataFim').value = formatarDataParaInput(viagem.DTPREVFINAL);
        document.getElementById('viagemDistancia').value = viagem.DISTANCIAKM || '';
        // Formatar Frete com 2 casas decimais
        const freteValue = viagem.VLFRETE ? parseFloat(viagem.VLFRETE).toFixed(2) : '';
        document.getElementById('viagemFrete').value = freteValue;
        // Formatar Peso com 3 casas decimais
        const pesoValue = viagem.PESO ? parseFloat(viagem.PESO).toFixed(3) : '';
        document.getElementById('viagemPeso').value = pesoValue;
        // Formatar Cubagem com 3 casas decimais
        const cubagemValue = viagem.CUBAGEM ? parseFloat(viagem.CUBAGEM).toFixed(3) : '';
        document.getElementById('viagemCubagem').value = cubagemValue;
        document.getElementById('viagemObserv').value = viagem.OBSERV || '';
        
        // Preencher campos de select com retry
        const preencherSelect = async (id, valor, maxTentativas = 10) => {
          if (!valor && valor !== 0) return;
          
          const valorStr = String(valor);
          for (let i = 0; i < maxTentativas; i++) {
            const select = document.getElementById(id);
            if (select && select.options.length > 1) {
              // Verificar se a opção existe
              const opcaoExiste = Array.from(select.options).some(opt => 
                String(opt.value).trim() === valorStr.trim() || 
                String(opt.value).trim() === String(valor).trim()
              );
              
              if (opcaoExiste) {
                select.value = valorStr;
                break;
              }
            }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        };
        
        // Preencher selects com valores convertidos para string
        await preencherSelect('viagemSituacaoViagem', viagem.FGSITVIAGEM);
        await preencherSelect('viagemSituacao', String(viagem.CDSITUACAOVIAGEM));
        await preencherSelect('viagemTipoViagem', String(viagem.CDTIPOVIAGEM));
        await preencherSelect('viagemContratador', viagem.CDCONTRATADOR ? String(viagem.CDCONTRATADOR) : '');
        await preencherSelect('viagemClasseFrota', viagem.CDCLASSEFROTA ? String(viagem.CDCLASSEFROTA) : '');
        await preencherSelect('viagemSituacaoAtiva', viagem.FGACTIVE);
        
        // Preencher FGRASTREADO - campo simples S/N, não precisa de retry complexo
        const rastreadoSelect = document.getElementById('viagemRastreado');
        if (rastreadoSelect && viagem.FGRASTREADO) {
          rastreadoSelect.value = String(viagem.FGRASTREADO).trim().toUpperCase();
        } else if (rastreadoSelect) {
          rastreadoSelect.value = '';
        }
        
        // Preencher origem e destino
        if (viagem.ORIGEM_ESTADO) {
          const estadoOrigem = viagem.ORIGEM_ESTADO.trim();
          await preencherSelect('viagemOrigemEstado', estadoOrigem);
          await loadCidadesPorEstado(estadoOrigem, 'origem');
          
          // Aguardar cidades carregarem e preencher
          if (viagem.ORIGEM_CODIGO) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await preencherSelect('viagemOrigemCidade', String(viagem.ORIGEM_CODIGO));
            document.getElementById('viagemOrigemCodigo').value = String(viagem.ORIGEM_CODIGO);
          }
        }
        
        if (viagem.DESTINO_ESTADO) {
          const estadoDestino = viagem.DESTINO_ESTADO.trim();
          await preencherSelect('viagemDestinoEstado', estadoDestino);
          await loadCidadesPorEstado(estadoDestino, 'destino');
          
          // Aguardar cidades carregarem e preencher
          if (viagem.DESTINO_CODIGO) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await preencherSelect('viagemDestinoCidade', String(viagem.DESTINO_CODIGO));
            document.getElementById('viagemDestinoCodigo').value = String(viagem.DESTINO_CODIGO);
          }
        }
        
        // Carregar roteiros e preencher
        if (viagem.ORIGEM_CODIGO && viagem.DESTINO_CODIGO) {
          await loadRoteirosPorRota(String(viagem.ORIGEM_CODIGO), String(viagem.DESTINO_CODIGO));
          await new Promise(resolve => setTimeout(resolve, 200));
          if (viagem.IDROTEIRO) {
            await preencherSelect('viagemRoteiro', String(viagem.IDROTEIRO));
          }
        }
        
        document.getElementById('formTitle').textContent = 'Editar Viagem';
        
        // IMPORTANTE: Preencher o campo "ID Viagem" no filtro para evitar que a aba volte para "Filtros"
        // Isso garante que quando o usuário estiver editando uma viagem, a aba permaneça em "Dados"
        const filtroIdViagem = document.getElementById('filtroIdViagem');
        if (filtroIdViagem && viagem.IDVIAGEM) {
          filtroIdViagem.value = String(viagem.IDVIAGEM);
        }
        
        // SEMPRE limpar o mapa quando uma nova viagem for carregada
        // Isso garante que não haja dados residuais de viagens anteriores
        if (mapa) {
          limparMapa();
        }
        
        // Atualizar mapa se a aba mapa estiver ativa
        const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
        if (tabMapa && tabMapa.classList.contains('active')) {
          await new Promise(resolve => setTimeout(resolve, 300));
          await atualizarMapa();
        }
        
        // PROTEÇÃO FINAL: Garantir que a aba de dados permanece ativa
        // Isso evita que algum código assíncrono mude a aba após o carregamento
        setTimeout(() => {
          const tabBtnDados = document.querySelector('.tab-btn[data-tab="dados"]');
          const tabContentDados = document.getElementById('tab-dados');
          if (tabBtnDados && !tabBtnDados.classList.contains('active')) {
            tabs.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            tabBtnDados.classList.add('active');
            if (tabContentDados) tabContentDados.classList.add('active');
          }
        }, 500);
      }
    } catch (err) {
      console.error('Erro ao carregar viagem:', err);
      showMessage('Erro ao carregar dados para edição.', 'error');
    }
  }

  // Formatar data para input datetime-local (sem conversão de fuso horário)
  function formatarDataParaInput(data) {
    if (!data) return '';
    
    // Se já está no formato correto (YYYY-MM-DDTHH:mm), retornar direto
    if (typeof data === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(data)) {
      return data.slice(0, 16);
    }
    
    // Parsear string no formato SQL Server: "2025-11-21 08:00:00" ou "2025-11-21T08:00:00"
    let str = String(data).trim();
    
    // Remover milissegundos se existirem
    str = str.replace(/\.\d{3}/, '');
    
    // Extrair componentes da data diretamente da string (sem conversão de fuso)
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      const [, ano, mes, dia, horas, minutos] = match;
      return `${ano}-${mes}-${dia}T${horas}:${minutos}`;
    }
    
    // Fallback: usar Date apenas se não conseguir parsear
    const d = new Date(data);
    if (isNaN(d.getTime())) return '';
    
    // Ajustar para fuso horário local (compensar a diferença)
    const offset = d.getTimezoneOffset(); // diferença em minutos
    const dLocal = new Date(d.getTime() - (offset * 60 * 1000));
    
    const ano = dLocal.getFullYear();
    const mes = String(dLocal.getMonth() + 1).padStart(2, '0');
    const dia = String(dLocal.getDate()).padStart(2, '0');
    const horasLocal = String(dLocal.getHours()).padStart(2, '0');
    const minutosLocal = String(dLocal.getMinutes()).padStart(2, '0');
    return `${ano}-${mes}-${dia}T${horasLocal}:${minutosLocal}`;
  }

  // Confirmar exclusão
  async function confirmarExclusao(id) {
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage('Erro: ID não disponível.', 'error');
      return;
    }
    
    idValido = String(idValido).trim();
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (!modalMessage || !confirmYes || !confirmNo || !modalEl) {
      return;
    }

    try {
      // Buscar o status atual da viagem
      const idToCheck = isNaN(idValido) ? idValido : parseFloat(idValido);
      const response = await fetch(`/api/viagens/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar viagem');
      }
      
      const viagem = await response.json();
      const estaAtivo = viagem.FGACTIVE === 'S';
      
      // Definir mensagem e ação baseado no status atual
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja <strong>desativar</strong> esta viagem?<br><br><small style="color: #666;">A viagem ficará inativa e não aparecerá nas listagens padrão.</small>';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja <strong>reativar</strong> esta viagem?<br><br><small style="color: #666;">A viagem voltará a aparecer nas listagens e estará disponível para uso.</small>';
        action = 'activate';
        btnText = 'Reativar';
      }
      
      modalMessage.innerHTML = confirmMsg;
      
      modalEl.dataset.deleteId = idValido;
      modalEl.dataset.action = action;
      
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
          const idToDelete = isNaN(idParaExcluir) ? idParaExcluir : parseFloat(idParaExcluir);
          const response = await fetch(`/api/viagens/${idToDelete}?action=${acao}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Viagem reativada com sucesso!' : 'Viagem desativada com sucesso!'), 'success');
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status da viagem.', 'error');
          }
        } catch (err) {
          console.error('[Viagens] Erro ao alterar status:', err);
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
      console.error('[Viagens] Erro ao buscar status da viagem:', err);
      showMessage('Erro ao verificar status da viagem.', 'error');
    }
  }

  // Salvar formulário
  viagemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const btnSalvar = viagemForm.querySelector('button[type="submit"]');
    if (btnSalvar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnSalvar, true);
    }
    
    const situacaoViagem = document.getElementById('viagemSituacaoViagem')?.value;
    const situacao = document.getElementById('viagemSituacao')?.value;
    const tipoViagem = document.getElementById('viagemTipoViagem')?.value;
    let dataInicio = document.getElementById('viagemDataInicio')?.value;
    let dataFim = document.getElementById('viagemDataFim')?.value;
    
    // Converter datetime-local para formato SQL Server (YYYY-MM-DD HH:mm:ss)
    // datetime-local retorna "YYYY-MM-DDTHH:mm", precisamos converter para "YYYY-MM-DD HH:mm:ss"
    if (dataInicio) {
      dataInicio = dataInicio.replace('T', ' ') + ':00';
    }
    if (dataFim) {
      dataFim = dataFim.replace('T', ' ') + ':00';
    }
    
    const rastreado = document.getElementById('viagemRastreado')?.value;
    
    if (!situacaoViagem || !situacao || !tipoViagem || !dataInicio || !dataFim || !rastreado) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      return;
    }

    try {
      const viagemData = {
        FGSITVIAGEM: situacaoViagem,
        CDSITUACAOVIAGEM: parseInt(situacao),
        CDTIPOVIAGEM: parseInt(tipoViagem),
        CDCONTRATADOR: document.getElementById('viagemContratador')?.value || null,
        CDCLASSEFROTA: document.getElementById('viagemClasseFrota')?.value || null,
        DTPREVINICIO: dataInicio,
        DTPREVFINAL: dataFim,
        IDROTEIRO: document.getElementById('viagemRoteiro')?.value || null,
        DISTANCIAKM: document.getElementById('viagemDistancia')?.value || null,
        VLFRETE: document.getElementById('viagemFrete')?.value ? parseFloat(document.getElementById('viagemFrete').value) : null,
        PESO: document.getElementById('viagemPeso')?.value ? parseFloat(document.getElementById('viagemPeso').value) : null,
        CUBAGEM: document.getElementById('viagemCubagem')?.value ? parseFloat(document.getElementById('viagemCubagem').value) : null,
        OBSERV: document.getElementById('viagemObserv')?.value.trim() || null,
        FGRASTREADO: rastreado
      };

      let response;
      const id = document.getElementById('viagemId')?.value;
      if (id) {
        viagemData.FGACTIVE = document.getElementById('viagemSituacaoAtiva')?.value;
        response = await fetch(`/api/viagens/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viagemData)
        });
      } else {
        response = await fetch('/api/viagens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(viagemData)
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

  // Eventos
  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid');
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    // Limpar campos que não têm valor padrão
    document.getElementById('filtroIdViagem').value = '';
    document.getElementById('filtroTipoViagem').value = '';
    document.getElementById('filtroClasseFrota').value = '';
    document.getElementById('filtroContratador').value = '';
    document.getElementById('filtroOrigemEstado').value = '';
    document.getElementById('filtroOrigemCidade').value = '';
    document.getElementById('filtroDestinoEstado').value = '';
    document.getElementById('filtroDestinoCidade').value = '';
    document.getElementById('filtroRoteiro').value = '';
    document.getElementById('filtroRoteiroDescricao').value = '';
    document.getElementById('filtroRastreado').value = '';
    
    // Restaurar valores padrão
    preencherFiltrosPadrao();
    
    // Limpar Situação Viagem para "Todos" (vazio) quando o botão Limpar for clicado
    const filtroSituacaoViagem = document.getElementById('filtroSituacaoViagem');
    if (filtroSituacaoViagem) {
      filtroSituacaoViagem.value = '';
    }
  });

  // Eventos de abas
  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
      
      // Se a aba mapa foi ativada, carregar o mapa
      if (tabId === 'mapa') {
        const leafletDisponivel = await aguardarLeaflet();
        if (!leafletDisponivel) {
          showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
          return;
        }
        
        // Inicializar mapa se ainda não foi inicializado
        if (!mapa) {
          const inicializado = await inicializarMapa();
          if (!inicializado) {
            console.error('Falha ao inicializar mapa');
            return;
          }
        }
        
        // SEMPRE limpar o mapa antes de atualizar quando a aba for ativada
        // Isso garante que mostre apenas os dados do registro selecionado
        if (mapa) {
          limparMapa();
          // Invalidar tamanho após limpar usando requestAnimationFrame
          requestAnimationFrame(() => {
            try {
              if (mapa) {
                mapa.invalidateSize();
                // Atualizar mapa após invalidar
                atualizarMapa();
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho após limpar:', e);
              atualizarMapa();
            }
          });
        } else {
          await atualizarMapa();
        }
      }
    });
  });

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistro')?.addEventListener('click', () => {
    viagemForm?.reset();
    document.getElementById('viagemId').value = '';
    document.getElementById('viagemUsuario').value = 'SYSTEM';
    document.getElementById('viagemDataInclusao').value = new Date().toISOString().slice(0, 16);
    document.getElementById('formTitle').textContent = 'Nova Viagem';
    showTab('dados');
  });
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));
  
  // Event listeners para botões do Grid
  document.getElementById('btnVoltarGrid')?.addEventListener('click', async () => await showTab('filtros'));
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', () => {
    viagemForm?.reset();
    document.getElementById('viagemId').value = '';
    document.getElementById('viagemUsuario').value = 'SYSTEM';
    document.getElementById('viagemDataInclusao').value = new Date().toISOString().slice(0, 16);
    document.getElementById('formTitle').textContent = 'Nova Viagem';
    showTab('dados');
  });

  // Eventos de estado para carregar cidades e roteiros
  document.getElementById('viagemOrigemEstado')?.addEventListener('change', function() {
    const estado = this.value;
    loadCidadesPorEstado(estado, 'origem');
    document.getElementById('viagemOrigemCidade').value = '';
    document.getElementById('viagemOrigemCodigo').value = '';
    
    // Atualizar roteiros se destino estiver selecionado
    const destino = document.getElementById('viagemDestinoCidade')?.value;
    if (estado && destino) {
      const origemCidade = document.getElementById('viagemOrigemCidade')?.value;
      if (origemCidade) {
        loadRoteirosPorRota(origemCidade, destino);
      }
    }
    
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemOrigemCidade')?.addEventListener('change', function() {
    const cidadeId = this.value;
    document.getElementById('viagemOrigemCodigo').value = cidadeId || '';
    
    // Atualizar roteiros
    const destino = document.getElementById('viagemDestinoCidade')?.value;
    if (cidadeId && destino) {
      loadRoteirosPorRota(cidadeId, destino);
    }
    
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemDestinoEstado')?.addEventListener('change', function() {
    const estado = this.value;
    loadCidadesPorEstado(estado, 'destino');
    document.getElementById('viagemDestinoCidade').value = '';
    document.getElementById('viagemDestinoCodigo').value = '';
    
    // Atualizar roteiros se origem estiver selecionada
    const origem = document.getElementById('viagemOrigemCidade')?.value;
    if (estado && origem) {
      loadRoteirosPorRota(origem, document.getElementById('viagemDestinoCidade')?.value);
    }
    
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemDestinoCidade')?.addEventListener('change', function() {
    const cidadeId = this.value;
    document.getElementById('viagemDestinoCodigo').value = cidadeId || '';
    
    // Atualizar roteiros
    const origem = document.getElementById('viagemOrigemCidade')?.value;
    if (origem && cidadeId) {
      loadRoteirosPorRota(origem, cidadeId);
    }
    
    // Atualizar mapa se a aba mapa estiver ativa
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      atualizarMapa();
    }
  });

  document.getElementById('viagemRoteiro')?.addEventListener('change', async function() {
    const roteiroId = this.value;
    const roteiro = roteirosCache.find(r => r.IDROTEIRO.toString() === roteiroId);
    if (roteiro) {
      document.getElementById('viagemDistancia').value = roteiro.DISTANCIAKM || '';
      document.getElementById('viagemOrigemEstado').value = roteiro.ORIGEM_ESTADO || '';
      document.getElementById('viagemDestinoEstado').value = roteiro.DESTINO_ESTADO || '';
      
      // Recarregar cidades
      if (roteiro.ORIGEM_ESTADO) {
        await loadCidadesPorEstado(roteiro.ORIGEM_ESTADO, 'origem');
        await new Promise(resolve => setTimeout(resolve, 200));
        document.getElementById('viagemOrigemCidade').value = roteiro.ORIGEM_CODIGO || '';
        document.getElementById('viagemOrigemCodigo').value = roteiro.ORIGEM_CODIGO || '';
      }
      
      if (roteiro.DESTINO_ESTADO) {
        await loadCidadesPorEstado(roteiro.DESTINO_ESTADO, 'destino');
        await new Promise(resolve => setTimeout(resolve, 200));
        document.getElementById('viagemDestinoCidade').value = roteiro.DESTINO_CODIGO || '';
        document.getElementById('viagemDestinoCodigo').value = roteiro.DESTINO_CODIGO || '';
      }
      
      // Atualizar mapa se a aba mapa estiver ativa
      const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
      if (tabMapa && tabMapa.classList.contains('active')) {
        await new Promise(resolve => setTimeout(resolve, 300));
        await atualizarMapa();
      }
    }
  });

  // Event listener para o botão calcular distância
  document.getElementById('btnCalcularDistancia')?.addEventListener('click', calcularDistancia);

  // Eventos de filtros para roteiros
  document.getElementById('filtroOrigemEstado')?.addEventListener('change', function() {
    const estado = this.value;
    if (estado) {
      // Atualizar cidades de origem no filtro
      fetch(`/api/cidades-por-estado/${estado}`)
        .then(r => r.json())
        .then(cidades => {
          const cidadeInput = document.getElementById('filtroOrigemCidade');
          // Mantém como input de texto para busca parcial
        });
    }
  });

  document.getElementById('filtroDestinoEstado')?.addEventListener('change', function() {
    const estado = this.value;
    if (estado) {
      // Atualizar cidades de destino no filtro
      fetch(`/api/cidades-por-estado/${estado}`)
        .then(r => r.json())
        .then(cidades => {
          const cidadeInput = document.getElementById('filtroDestinoCidade');
          // Mantém como input de texto para busca parcial
        });
    }
  });

  // Carregar todos os roteiros para o filtro
  async function loadRoteirosParaFiltro() {
    try {
      const response = await fetch('/api/roteiros-combo');
      if (response.ok) {
        const roteiros = await response.json();
        const filtroRoteiroSelect = document.getElementById('filtroRoteiro');
        if (filtroRoteiroSelect) {
          filtroRoteiroSelect.innerHTML = '<option value="">Todos</option>';
          roteiros.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.IDROTEIRO;
            opt.textContent = `${r.IDROTEIRO} - ${r.DSROTEIRO}`;
            filtroRoteiroSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar roteiros para filtro:', err);
    }
  }

  // Evento para atualizar descrição do roteiro no filtro
  document.getElementById('filtroRoteiro')?.addEventListener('change', function() {
    const roteiroId = this.value;
    if (roteiroId) {
      fetch(`/api/roteiros-combo?roteiro=${roteiroId}`)
        .then(r => r.json())
        .then(roteiros => {
          if (roteiros.length > 0) {
            document.getElementById('filtroRoteiroDescricao').value = roteiros[0].DSROTEIRO;
          } else {
            document.getElementById('filtroRoteiroDescricao').value = '';
          }
        });
    } else {
      document.getElementById('filtroRoteiroDescricao').value = '';
    }
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

  // Função para obter coordenadas de uma cidade usando API do backend
  async function obterCoordenadasCidade(nomeCidade, estado) {
    try {
      const params = new URLSearchParams({
        cidade: nomeCidade,
        estado: estado
      });
      
      const response = await fetch(`/api/cidades/coordenadas?${params.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error(`Erro ${response.status}:`, errorData);
        return null;
      }
      
      const data = await response.json();
      
      if (data.success && data.lat && data.lon) {
        return {
          lat: data.lat,
          lon: data.lon
        };
      }
      
      if (data.success === false) {
        console.warn('API retornou success: false:', data.error);
      }
      
      return null;
    } catch (err) {
      console.error('Erro ao obter coordenadas:', err);
      return null;
    }
  }

  // Função para calcular distância usando fórmula de Haversine (em km)
  function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distancia = R * c;
    
    return Math.round(distancia * 100) / 100; // Arredondar para 2 casas decimais
  }

  // Função para calcular distância usando OSRM (rota real)
  async function calcularDistanciaOSRM(coords) {
    try {
      const coordsStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
      const config = window.MAP_CONFIG || {};
      const osrmUrl = `${config.osrmServer || 'https://router.project-osrm.org/route/v1/driving'}/${coordsStr}?overview=full`;
      const response = await fetch(osrmUrl, { signal: AbortSignal.timeout(config.routeTimeout || 15000) });
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        return parseFloat((data.routes[0].distance / 1000).toFixed(2));
      }
      return null;
    } catch (err) {
      // Erro ao calcular distância com OSRM
      return null;
    }
  }

  // Função para calcular distância entre origem e destino
  async function calcularDistancia() {
    const origemCidadeId = document.getElementById('viagemOrigemCidade')?.value;
    const destinoCidadeId = document.getElementById('viagemDestinoCidade')?.value;
    const origemEstado = document.getElementById('viagemOrigemEstado')?.value;
    const destinoEstado = document.getElementById('viagemDestinoEstado')?.value;
    const roteiroId = document.getElementById('viagemRoteiro')?.value;
    const btnCalcular = document.getElementById('btnCalcularDistancia');
    const campoDistancia = document.getElementById('viagemDistancia');

    // Validações
    if (!origemCidadeId || !destinoCidadeId) {
      showMessage('Selecione a cidade de origem e destino antes de calcular.', 'error');
      return;
    }

    if (!origemEstado || !destinoEstado) {
      showMessage('Selecione os estados de origem e destino antes de calcular.', 'error');
      return;
    }

    if (origemCidadeId === destinoCidadeId) {
      showMessage('A cidade de origem e destino não podem ser iguais.', 'error');
      return;
    }

    // Mostrar loading
    if (btnCalcular && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnCalcular, true);
    }
    btnCalcular.disabled = true;

    try {
      let distancia = null;

      // Se houver roteiro selecionado, calcular usando os pontos do roteiro
      if (roteiroId) {
        showMessage('Calculando distância usando pontos do roteiro...', 'success');
        
        try {
          // Buscar pontos do roteiro
          const pontosResponse = await fetch(`/api/roteiros/${roteiroId}/pontos`);
          if (pontosResponse.ok) {
            const pontos = await pontosResponse.json();
            
            // Filtrar pontos com coordenadas e ordenar por ORDEM
            const pontosComCoordenadas = pontos
              .filter(p => p.LATITUDE && p.LONGITUDE)
              .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
            
            if (pontosComCoordenadas.length >= 2) {
              // Criar lista de coordenadas para OSRM
              const coords = pontosComCoordenadas.map(p => ({
                lat: parseFloat(p.LATITUDE),
                lon: parseFloat(p.LONGITUDE)
              }));
              
              // Calcular distância usando OSRM com todos os pontos
              distancia = await calcularDistanciaOSRM(coords);
              
              if (distancia) {
                if (campoDistancia) {
                  campoDistancia.value = distancia;
                  showMessage(`Distância calculada pelo roteiro: ${distancia} km`, 'success');
                }
              } else {
                // Fallback: usar Haversine se OSRM falhar
                const primeira = pontosComCoordenadas[0];
                const ultima = pontosComCoordenadas[pontosComCoordenadas.length - 1];
                distancia = calcularDistanciaHaversine(
                  primeira.LATITUDE,
                  primeira.LONGITUDE,
                  ultima.LATITUDE,
                  ultima.LONGITUDE
                );
                if (campoDistancia) {
                  campoDistancia.value = distancia;
                  showMessage(`Distância calculada (aproximada): ${distancia} km`, 'success');
                }
              }
            } else {
              showMessage('O roteiro selecionado não possui pontos suficientes com coordenadas.', 'error');
            }
          } else {
            showMessage('Erro ao buscar pontos do roteiro. Calculando entre origem e destino...', 'error');
            // Continuar para calcular entre origem e destino
          }
        } catch (err) {
          console.error('Erro ao buscar pontos do roteiro:', err);
          showMessage('Erro ao buscar pontos do roteiro. Calculando entre origem e destino...', 'error');
          // Continuar para calcular entre origem e destino
        }
      }

      // Se não calculou pelo roteiro, calcular entre origem e destino usando OSRM
      if (!distancia) {
        showMessage('Calculando distância pela rota real...', 'success');
        
        // Buscar informações das cidades
        const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
        const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

        if (!origemCidade || !destinoCidade) {
          showMessage('Erro ao obter informações das cidades selecionadas.', 'error');
          return;
        }

        // Obter coordenadas
        const [coordsOrigem, coordsDestino] = await Promise.all([
          obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
          obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
        ]);

        if (!coordsOrigem) {
          showMessage(`Não foi possível encontrar as coordenadas da cidade de origem: ${origemCidade.NMCIDADE}, ${origemEstado}. Verifique se o nome da cidade está correto.`, 'error');
          return;
        }

        if (!coordsDestino) {
          showMessage(`Não foi possível encontrar as coordenadas da cidade de destino: ${destinoCidade.NMCIDADE}, ${destinoEstado}. Verifique se o nome da cidade está correto.`, 'error');
          return;
        }

        // Calcular distância usando OSRM (rota real)
        distancia = await calcularDistanciaOSRM([coordsOrigem, coordsDestino]);
        
        if (distancia) {
          if (campoDistancia) {
            campoDistancia.value = distancia;
            showMessage(`Distância calculada pela rota real: ${distancia} km`, 'success');
          }
        } else {
          // Fallback: usar Haversine se OSRM falhar
          distancia = calcularDistanciaHaversine(
            coordsOrigem.lat,
            coordsOrigem.lon,
            coordsDestino.lat,
            coordsDestino.lon
          );
          if (campoDistancia) {
            campoDistancia.value = distancia;
            showMessage(`Distância calculada (aproximada): ${distancia} km`, 'success');
          }
        }
      }

      // Atualizar mapa se a aba mapa estiver ativa
      const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
      if (tabMapa && tabMapa.classList.contains('active')) {
        await atualizarMapa();
      }

    } catch (err) {
      console.error('Erro ao calcular distância:', err);
      showMessage('Erro ao calcular distância. Tente novamente.', 'error');
    } finally {
      // Remover loading
      if (btnCalcular && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnCalcular, false);
      }
      btnCalcular.disabled = false;
    }
  }

  // Função para inicializar o mapa
  // Flag para controlar inicialização do mapa
  let mapaInicializando = false;

  async function inicializarMapa() {
    // Verificar se Leaflet está disponível
    if (typeof L === 'undefined') {
      console.error('Leaflet não está carregado. Aguardando...');
      // Tentar carregar o Leaflet
      const leafletDisponivel = await aguardarLeaflet();
      if (!leafletDisponivel) {
        showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
        return false;
      }
    }

    const mapaDiv = document.getElementById('mapaRota');
    if (!mapaDiv) {
      console.warn('Elemento mapaRota não encontrado no DOM');
      return false;
    }
    
    // Se já está inicializado e funcionando, não fazer nada
    if (mapa) {
      try {
        // Verificar se o mapa está em estado válido e se o container ainda existe
        const container = mapa.getContainer();
        if (mapa._loaded && container && container.parentNode === mapaDiv) {
          // Mapa válido e no container correto
          return true;
        } else {
          // Mapa está em estado inválido ou container foi movido, remover
          try {
            mapa.remove();
          } catch (e2) {
            // Ignorar erro de remoção
          }
          mapa = null;
        }
      } catch (e) {
        // Se houver erro ao verificar, destruir e recriar
        try {
          mapa.remove();
        } catch (e2) {
          // Ignorar erro de remoção
        }
        mapa = null;
      }
    }

    // Proteção contra race condition
    if (mapaInicializando) {
      // Aguardar até que a inicialização termine
      let tentativas = 0;
      while (mapaInicializando && tentativas < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }
      if (mapa) return true;
    }

    mapaInicializando = true;

    try {
      // Verificar se o elemento está visível antes de inicializar
      const tabMapa = document.getElementById('tab-mapa');
      if (tabMapa) {
        // Garantir que a aba está visível
        if (tabMapa.style.display === 'none') {
          tabMapa.style.display = 'block';
        }
        // Aguardar um pouco para o elemento estar totalmente visível
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Verificar novamente se o elemento está visível
      if (mapaDiv.offsetParent === null && mapaDiv.offsetWidth === 0 && mapaDiv.offsetHeight === 0) {
        // Elemento ainda não está visível, aguardar mais um pouco
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // IMPORTANTE: Se já existe um mapa, remover corretamente antes de limpar o HTML
      if (mapa) {
        try {
          // Remover todas as camadas primeiro
          mapa.eachLayer((layer) => {
            try {
              mapa.removeLayer(layer);
            } catch (e) {
              // Ignorar erro
            }
          });
          // Remover o mapa
          mapa.remove();
        } catch (e) {
          console.warn('Erro ao remover mapa existente:', e);
        }
        mapa = null;
        // Aguardar um pouco para garantir que o Leaflet limpou tudo
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Limpar conteúdo anterior se houver (apenas se não houver mapa ativo)
      if (mapaDiv.children.length > 0) {
        // Verificar se há elementos do Leaflet antes de limpar
        const hasLeafletElements = Array.from(mapaDiv.children).some(child => 
          child.classList.contains('leaflet-container') || 
          child.classList.contains('leaflet-pane')
        );
        
        if (hasLeafletElements) {
          // Se há elementos do Leaflet, aguardar mais um pouco antes de limpar
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        mapaDiv.innerHTML = '';
        // Aguardar um frame para garantir que o DOM foi limpo
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      
      // Criar mapa centrado no Brasil
      mapa = L.map('mapaRota', {
        preferCanvas: false,
        zoomControl: true
      }).setView([-14.2350, -51.9253], 4);

      // Adicionar camada de tiles do OpenStreetMap
      const tileConfig = window.getTileLayerConfig ? window.getTileLayerConfig() : {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        updateWhenIdle: false,
        updateWhenZooming: true
      }).addTo(mapa);
      
      // Invalidar tamanho usando requestAnimationFrame (mais eficiente)
      requestAnimationFrame(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa:', e);
          }
        }
      });
      
      mapaInicializando = false;
      return true;
    } catch (err) {
      console.error('Erro ao inicializar mapa:', err);
      mapaInicializando = false;
      // Limpar referência se houver erro
      if (mapa) {
        try {
          mapa.remove();
        } catch (e) {
          // Ignorar erro
        }
        mapa = null;
      }
      showMessage('Erro ao inicializar o mapa. Verifique se a biblioteca foi carregada.', 'error');
      return false;
    }
  }

  // Função para limpar completamente o mapa (marcadores e rotas)
  function limparMapa() {
    if (!mapa || typeof L === 'undefined') return;
    
    // Remover todos os marcadores e rotas
    if (marcadorOrigem) {
      try {
        mapa.removeLayer(marcadorOrigem);
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorOrigem = null;
    }
    if (marcadorDestino) {
      try {
        mapa.removeLayer(marcadorDestino);
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorDestino = null;
    }
    if (linhaRota) {
      try {
        mapa.removeLayer(linhaRota);
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      linhaRota = null;
    }
    
    // Remover todas as camadas que não sejam os tiles base
    try {
      mapa.eachLayer((layer) => {
        if (typeof L !== 'undefined' && (layer instanceof L.Marker || layer instanceof L.Polyline)) {
          try {
            mapa.removeLayer(layer);
          } catch (e) {
            // Ignorar erro se a camada já foi removida
          }
        }
      });
    } catch (e) {
      // Ignorar erro se não conseguir iterar sobre as camadas
    }
    
    // Resetar view para o Brasil
    try {
      mapa.setView([-14.2350, -51.9253], 4);
    } catch (e) {
      // Ignorar erro se o mapa não estiver inicializado
    }
  }

  // Funções para controlar overlay de carregamento do mapa
  function showMapaLoading(titulo = 'Carregando Mapa', texto = 'Preparando visualização da rota...') {
    const overlay = document.getElementById('mapaLoadingOverlay');
    const titleEl = document.getElementById('mapaLoadingTitle');
    const textEl = document.getElementById('mapaLoadingText');
    if (overlay) {
      if (titleEl) titleEl.textContent = titulo;
      if (textEl) textEl.textContent = texto;
      overlay.style.display = 'flex';
    }
  }

  function hideMapaLoading() {
    const overlay = document.getElementById('mapaLoadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Função para atualizar o mapa com origem e destino
  async function atualizarMapa() {
    // Verificar se Leaflet está disponível
    if (typeof L === 'undefined') {
      console.error('Leaflet não está carregado.');
      showMessage('Aguarde o carregamento da biblioteca de mapas...', 'error');
      return;
    }

    // SEMPRE limpar o mapa antes de atualizar com novos dados
    limparMapa();

    const origemCidadeId = document.getElementById('viagemOrigemCidade')?.value;
    const destinoCidadeId = document.getElementById('viagemDestinoCidade')?.value;
    const origemEstado = document.getElementById('viagemOrigemEstado')?.value;
    const destinoEstado = document.getElementById('viagemDestinoEstado')?.value;
    const roteiroId = document.getElementById('viagemRoteiro')?.value;

    // Validar se há origem e destino
    // Se não houver dados válidos, apenas limpar e resetar o mapa
    if (!origemCidadeId || !destinoCidadeId || !origemEstado || !destinoEstado) {
      // Se o mapa está inicializado, apenas limpar
      if (mapa) {
        limparMapa();
      }
      // Se o mapa não está inicializado, inicializar mesmo sem dados para mostrar o mapa vazio
      // Isso garante que o usuário veja o mapa quando abrir a aba
      return;
    }

    // Mostrar overlay de carregamento
    showMapaLoading('Carregando Mapa', 'Preparando visualização...');

    // Inicializar mapa se ainda não foi inicializado
    if (!mapa) {
      const inicializado = await inicializarMapa();
      if (!inicializado) {
        hideMapaLoading();
        console.error('Mapa não foi inicializado após tentativa');
        return;
      }
    }
    
    // Invalidar tamanho antes de atualizar usando requestAnimationFrame (sem delay)
    if (mapa) {
      requestAnimationFrame(() => {
        try {
          mapa.invalidateSize();
        } catch (e) {
          console.warn('Erro ao invalidar tamanho do mapa:', e);
        }
      });
    }

    try {
      // Se houver roteiro selecionado, buscar e exibir os pontos do roteiro
      if (roteiroId) {
        showMapaLoading('Carregando Pontos', 'Buscando pontos do roteiro...');
        try {
          const pontosResponse = await fetch(`/api/roteiros/${roteiroId}/pontos`);
          if (pontosResponse.ok) {
            const pontos = await pontosResponse.json();
            
            // Filtrar pontos com coordenadas e ordenar por ORDEM
            const pontosComCoordenadas = pontos
              .filter(p => p.LATITUDE && p.LONGITUDE)
              .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
            
            if (pontosComCoordenadas.length >= 2) {
              // Criar marcadores para cada ponto
              const cores = {
                'O': '#2ecc71', // Verde - Origem
                'D': '#e74c3c', // Vermelho - Destino
                'P': '#3498db', // Azul - Passagem
                'R': '#f39c12'  // Laranja - Parada
              };
              
              const icones = {
                'O': '🏁',
                'D': '🏁',
                'P': '📍',
                'R': '⏸'
              };
              
              const tiposDescricao = {
                'O': 'Origem',
                'D': 'Destino',
                'P': 'Passagem',
                'R': 'Parada'
              };
              
              const marcadores = [];
              const latlngs = [];
              
              // Calcular distâncias acumuladas desde a origem
              let distanciaAcumulada = 0;
              
              pontosComCoordenadas.forEach((ponto, index) => {
                // Normalizar TPLOCAL - garantir que seja string e uppercase, tratar null/undefined
                let tipoLocal = '';
                if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
                  tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
                }
                
                const cor = cores[tipoLocal] || '#95a5a6';
                const icone = icones[tipoLocal] || '📍';
                const descricaoTipo = tiposDescricao[tipoLocal] || tipoLocal || 'Não definido';
                
                // Calcular distância acumulada (somar distâncias dos pontos anteriores)
                if (index > 0 && ponto.KMENTREPONTOS) {
                  distanciaAcumulada += parseFloat(ponto.KMENTREPONTOS) || 0;
                }
                
                // Criar marcador customizado
                const marcador = L.marker([ponto.LATITUDE, ponto.LONGITUDE], {
                  icon: L.divIcon({
                    className: 'custom-marker',
                    html: `<div style="
                      background: ${cor};
                      width: 30px;
                      height: 30px;
                      border-radius: 50%;
                      border: 3px solid white;
                      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      font-size: 14px;
                    ">${icone}</div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15]
                  })
                }).addTo(mapa);
                
                // Popup com informações detalhadas
                const popupContent = `
                  <div style="min-width: 200px;">
                    <strong>${ponto.DSLOCAL || 'Sem descrição'}</strong><br>
                    <small>${ponto.DSPOSICAO || 'Sem posição'}</small><br>
                    <hr style="margin: 8px 0;">
                    <strong>Tipo:</strong> ${descricaoTipo}<br>
                    <strong>Ordem:</strong> ${ponto.ORDEM || 'N/A'}<br>
                    ${ponto.KMENTREPONTOS ? `<strong>Distância do ponto anterior:</strong> ${parseFloat(ponto.KMENTREPONTOS).toFixed(2)} km<br>` : ''}
                    ${index > 0 ? `<strong>Distância da origem:</strong> ${distanciaAcumulada.toFixed(2)} km<br>` : ''}
                    <strong>Coordenadas:</strong><br>
                    <small>${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}</small>
                  </div>
                `;
                marcador.bindPopup(popupContent);
                
                marcadores.push(marcador);
                latlngs.push([ponto.LATITUDE, ponto.LONGITUDE]);
              });
              
              // Atualizar mensagem do overlay
              showMapaLoading('Traçando Rota', 'Calculando rota real entre os pontos...');
              
              // Desenhar rota usando OSRM com todos os pontos
              try {
                const coordsStr = latlngs.map(c => `${c[1]},${c[0]}`).join(';');
                const config = window.MAP_CONFIG || {};
                const osrmUrl = `${config.osrmServer || 'https://router.project-osrm.org/route/v1/driving'}/${coordsStr}?overview=full&geometries=geojson`;
                
                // Usar AbortController para timeout
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), config.routeTimeout || 10000);
                
                const response = await fetch(osrmUrl, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await response.json();
                
                if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                  const geometry = data.routes[0].geometry.coordinates;
                  const routeLatLngs = geometry.map(c => [c[1], c[0]]);
                  
                  linhaRota = L.polyline(routeLatLngs, {
                    color: '#3498db',
                    weight: 4,
                    opacity: 0.7
                  }).addTo(mapa);
                  
                  const distanciaTotal = (data.routes[0].distance / 1000).toFixed(2);
                  linhaRota.bindPopup(`<strong>Distância total da rota:</strong> ${distanciaTotal} km`);
                } else {
                  // Fallback: linha reta entre pontos
                  linhaRota = L.polyline(latlngs, {
                    color: '#3498db',
                    weight: 4,
                    opacity: 0.7,
                    dashArray: '10, 10'
                  }).addTo(mapa);
                }
              } catch (err) {
                if (err.name !== 'AbortError') {
                  console.warn('Erro ao obter rota do OSRM, usando linha reta:', err);
                }
                // Fallback: linha reta entre pontos
                linhaRota = L.polyline(latlngs, {
                  color: '#3498db',
                  weight: 4,
                  opacity: 0.7,
                  dashArray: '10, 10'
                }).addTo(mapa);
              }
              
              // Atualizar mensagem do overlay
              showMapaLoading('Ajustando Visualização', 'Ajustando zoom para mostrar toda a rota...');
              
              // Ajustar zoom para mostrar todos os pontos
              if (marcadores.length > 0) {
                const grupo = new L.featureGroup(marcadores);
                const bounds = grupo.getBounds();
                if (bounds.pad) {
                  mapa.fitBounds(bounds.pad(0.1));
                } else {
                  const sw = bounds.getSouthWest();
                  const ne = bounds.getNorthEast();
                  const latDiff = (ne.lat - sw.lat) * 0.1;
                  const lngDiff = (ne.lng - sw.lng) * 0.1;
                  const newBounds = L.latLngBounds(
                    [sw.lat - latDiff, sw.lng - lngDiff],
                    [ne.lat + latDiff, ne.lng + lngDiff]
                  );
                  mapa.fitBounds(newBounds);
                }
              }
              
              // Esconder overlay após um pequeno delay
              requestAnimationFrame(() => {
                setTimeout(() => {
                  hideMapaLoading();
                }, 300);
              });
              
              return; // Sair da função após exibir pontos do roteiro
            }
          }
        } catch (err) {
          // Erro ao buscar pontos do roteiro, usando origem e destino
          // Continuar para exibir origem e destino
        }
      }
      
      // Se não houver roteiro ou se não conseguiu buscar pontos, usar origem e destino diretos
      // Atualizar mensagem do overlay
      showMapaLoading('Buscando Coordenadas', 'Obtendo localização das cidades...');
      
      // Buscar informações das cidades
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

      if (!origemCidade || !destinoCidade) {
        hideMapaLoading();
        showMessage('Erro ao obter informações das cidades para o mapa.', 'error');
        return;
      }

      // Obter coordenadas
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
      ]);

      if (!coordsOrigem || !coordsDestino) {
        hideMapaLoading();
        showMessage('Não foi possível obter as coordenadas para exibir o mapa.', 'error');
        return;
      }
      
      // Atualizar mensagem do overlay
      showMapaLoading('Montando Rota', 'Criando marcadores e traçando rota...');

      // Criar marcador de origem (verde)
      marcadorOrigem = L.marker([coordsOrigem.lat, coordsOrigem.lon], {
        icon: L.divIcon({
          className: 'custom-marker origem',
          html: '<div style="background: #2ecc71; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">O</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapa)
        .bindPopup(`<strong>Origem:</strong><br>${origemCidade.NMCIDADE}, ${origemEstado}`);

      // Criar marcador de destino (vermelho)
      marcadorDestino = L.marker([coordsDestino.lat, coordsDestino.lon], {
        icon: L.divIcon({
          className: 'custom-marker destino',
          html: '<div style="background: #e74c3c; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">D</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapa)
        .bindPopup(`<strong>Destino:</strong><br>${destinoCidade.NMCIDADE}, ${destinoEstado}`);

      // Atualizar mensagem do overlay
      showMapaLoading('Calculando Rota', 'Obtendo rota real entre origem e destino...');
      
      // Obter rota real usando OSRM (Open Source Routing Machine) via backend
      try {
        const params = new URLSearchParams({
          lon1: coordsOrigem.lon,
          lat1: coordsOrigem.lat,
          lon2: coordsDestino.lon,
          lat2: coordsDestino.lat
        });
        
        // Usar AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 segundos de timeout
        
        const rotaResponse = await fetch(`/api/cidades/rota?${params.toString()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!rotaResponse.ok) {
          throw new Error(`Erro ${rotaResponse.status} ao obter rota`);
        }
        
        const rotaData = await rotaResponse.json();
        
        if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
          // Usar a rota real obtida do OSRM
          const coordenadasRota = rotaData.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]); // OSRM retorna [lon, lat], Leaflet precisa [lat, lon]
          
          linhaRota = L.polyline(coordenadasRota, {
            color: '#3498db',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
          }).addTo(mapa);
          
          // Calcular distância real da rota
          const distanciaRota = (rotaData.routes[0].distance / 1000).toFixed(2); // Converter metros para km
          linhaRota.bindPopup(`<strong>Distância da Rota:</strong> ${distanciaRota} km`);
        } else {
          // Fallback: usar linha reta se não conseguir obter a rota
          linhaRota = L.polyline(
            [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
            {
              color: '#3498db',
              weight: 4,
              opacity: 0.7,
              dashArray: '10, 10'
            }
          ).addTo(mapa);
          
          const distancia = calcularDistanciaHaversine(
            coordsOrigem.lat,
            coordsOrigem.lon,
            coordsDestino.lat,
            coordsDestino.lon
          );
          linhaRota.bindPopup(`<strong>Distância (linha reta):</strong> ${distancia} km`);
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Erro ao obter rota do OSRM:', err);
        }
        // Fallback: usar linha reta em caso de erro
        linhaRota = L.polyline(
          [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
          {
            color: '#3498db',
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 10'
          }
        ).addTo(mapa);
        
        const distancia = calcularDistanciaHaversine(
          coordsOrigem.lat,
          coordsOrigem.lon,
          coordsDestino.lat,
          coordsDestino.lon
        );
        linhaRota.bindPopup(`<strong>Distância (linha reta):</strong> ${distancia} km`);
      }

      // Atualizar mensagem do overlay
      showMapaLoading('Ajustando Visualização', 'Ajustando zoom para mostrar toda a rota...');
      
      // Ajustar o zoom para mostrar ambas as cidades (sem delay)
      const grupo = new L.featureGroup([marcadorOrigem, marcadorDestino]);
      const bounds = grupo.getBounds();
      // Adicionar padding manualmente se pad() não estiver disponível
      if (bounds.pad) {
        mapa.fitBounds(bounds.pad(0.2));
      } else {
        // Fallback: expandir bounds manualmente
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const latDiff = (ne.lat - sw.lat) * 0.2;
        const lngDiff = (ne.lng - sw.lng) * 0.2;
        const newBounds = L.latLngBounds(
          [sw.lat - latDiff, sw.lng - lngDiff],
          [ne.lat + latDiff, ne.lng + lngDiff]
        );
        mapa.fitBounds(newBounds);
      }
      
      // Esconder overlay após um pequeno delay
      requestAnimationFrame(() => {
        setTimeout(() => {
          hideMapaLoading();
        }, 300);
      });

    } catch (err) {
      hideMapaLoading();
      console.error('Erro ao atualizar mapa:', err);
      showMessage('Erro ao atualizar o mapa. Tente novamente.', 'error');
    }
  }

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
        loadViagemParaEdicao(id);
      } else if (btn.classList.contains('delete')) {
        confirmarExclusao(id);
      }
    });
  }

  // ========== FUNCIONALIDADES DE MOTORISTAS COMPATÍVEIS ==========
  
  let viagensPendentes = [];
  let motoristasCompatíveis = [];
  let viagemSelecionada = null;

  // Carregar viagens pendentes
  async function carregarViagensPendentes() {
    try {
      showMessage('Carregando viagens pendentes...', 'info');
      const response = await fetch('/api/viagens-pendentes');
      if (!response.ok) throw new Error('Erro ao carregar viagens pendentes');
      
      viagensPendentes = await response.json();
      const select = document.getElementById('selectViagemPendente');
      
      select.innerHTML = '<option value="">Selecione uma viagem para ver motoristas compatíveis</option>';
      
      // Ordenar por ID (decrescente - mais recentes primeiro)
      viagensPendentes.sort((a, b) => {
        const idA = parseFloat(a.IDVIAGEM) || 0;
        const idB = parseFloat(b.IDVIAGEM) || 0;
        return idB - idA; // Ordem decrescente (maior ID primeiro)
      });
      
      viagensPendentes.forEach(v => {
        const option = document.createElement('option');
        option.value = v.IDVIAGEM;
        option.textContent = `ID ${v.IDVIAGEM} - ${v.ORIGEM_CIDADE}/${v.ORIGEM_ESTADO} → ${v.DESTINO_CIDADE}/${v.DESTINO_ESTADO} - ${v.DSCLASSEFROTA || 'Sem classe'}`;
        select.appendChild(option);
      });
      
      if (viagensPendentes.length === 0) {
        showMessage('Nenhuma viagem pendente encontrada.', 'info');
      } else {
        showMessage(`${viagensPendentes.length} viagem(ns) pendente(s) carregada(s).`, 'success');
      }
    } catch (err) {
      console.error('Erro ao carregar viagens pendentes:', err);
      showMessage('Erro ao carregar viagens pendentes.', 'error');
    }
  }

  // Carregar viagens pendentes e selecionar uma viagem específica
  async function carregarEselecionarViagem(idViagem) {
    try {
      // Primeiro, carregar as viagens pendentes
      await carregarViagensPendentes();
      
      // Aguardar um pouco para garantir que o select foi preenchido
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Selecionar a viagem
      const select = document.getElementById('selectViagemPendente');
      const btnBuscar = document.getElementById('btnBuscarMotoristas');
      
      if (select && idViagem) {
        const idViagemStr = String(idViagem);
        
        // Verificar se a viagem está na lista de pendentes
        const viagemEncontrada = viagensPendentes.find(v => String(v.IDVIAGEM) === idViagemStr);
        
        // Se não estiver na lista, adicionar como opção
        if (!viagemEncontrada) {
          // Buscar dados da viagem para adicionar à lista
          try {
            const response = await fetch(`/api/viagens/${idViagem}`);
            if (response.ok) {
              const viagem = await response.json();
              const option = document.createElement('option');
              option.value = idViagemStr;
              option.textContent = `ID ${idViagemStr} - ${viagem.ORIGEM_CIDADE || 'N/A'}/${viagem.ORIGEM_ESTADO || 'N/A'} → ${viagem.DESTINO_CIDADE || 'N/A'}/${viagem.DESTINO_ESTADO || 'N/A'} - ${viagem.DSCLASSEFROTA || 'Sem classe'}`;
              option.selected = true;
              // Inserir após a primeira opção (depois do "Selecione...")
              if (select.options.length > 0) {
                select.insertBefore(option, select.options[1]);
              } else {
                select.appendChild(option);
              }
            }
          } catch (err) {
            // Erro ao buscar dados da viagem
            // Adicionar mesmo sem os dados completos
            const option = document.createElement('option');
            option.value = idViagemStr;
            option.textContent = `ID ${idViagemStr} - (Viagem em edição)`;
            option.selected = true;
            if (select.options.length > 0) {
              select.insertBefore(option, select.options[1]);
            } else {
              select.appendChild(option);
            }
          }
        } else {
          // Se estiver na lista, apenas selecionar
          select.value = idViagemStr;
        }
        
        // Habilitar o botão de buscar
        if (btnBuscar) {
          btnBuscar.disabled = false;
        }
        
        // Disparar evento change para garantir que tudo seja atualizado
        select.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Buscar automaticamente os motoristas compatíveis
        await buscarMotoristasCompatíveis(idViagem);
      }
    } catch (err) {
      console.error('Erro ao carregar e selecionar viagem:', err);
      showMessage('Erro ao carregar viagem para busca de motoristas.', 'error');
    }
  }

  // Buscar motoristas compatíveis
  async function buscarMotoristasCompatíveis(idViagemParam = null) {
    let idViagem = idViagemParam;
    
    // Se não foi passado como parâmetro, pegar do select
    if (!idViagem) {
      const select = document.getElementById('selectViagemPendente');
      idViagem = select ? select.value : null;
    }
    
    if (!idViagem) {
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    try {
      showMessage('Buscando motoristas compatíveis...', 'info');
      const response = await fetch(`/api/viagens/${idViagem}/motoristas-compativel`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erro ao buscar motoristas compatíveis');
      }
      
      motoristasCompatíveis = await response.json();
      viagemSelecionada = idViagem;
      
      renderizarMotoristasCompatíveis();
      
      if (motoristasCompatíveis.length === 0) {
        showMessage('Nenhum motorista compatível encontrado para esta viagem.', 'info');
      } else {
        showMessage(`${motoristasCompatíveis.length} motorista(s) compatível(is) encontrado(s).`, 'success');
      }
    } catch (err) {
      console.error('Erro ao buscar motoristas compatíveis:', err);
      showMessage(err.message || 'Erro ao buscar motoristas compatíveis.', 'error');
    }
  }

  // Flag para evitar mudança automática de aba durante carregamento
  let bloqueandoMudancaAba = false;

  // Variável para controlar ordenação
  let ordenacaoMotoristas = {
    campo: null,
    direcao: 'asc' // 'asc' ou 'desc'
  };

  // Função para ordenar motoristas compatíveis (tornada global para onclick)
  window.ordenarMotoristasCompatíveis = function(campo) {
    if (ordenacaoMotoristas.campo === campo) {
      // Se já está ordenando por este campo, inverte a direção
      ordenacaoMotoristas.direcao = ordenacaoMotoristas.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      // Novo campo, ordena ascendente
      ordenacaoMotoristas.campo = campo;
      ordenacaoMotoristas.direcao = 'asc';
    }

    motoristasCompatíveis.sort((a, b) => {
      let valorA, valorB;

      switch (campo) {
        case 'motorista':
          valorA = (a.NOME_MOTORISTA || '').toLowerCase();
          valorB = (b.NOME_MOTORISTA || '').toLowerCase();
          break;
        case 'cidade':
          valorA = ((a.CIDADE_NOME || '') + ' ' + (a.CIDADE_ESTADO || '')).toLowerCase();
          valorB = ((b.CIDADE_NOME || '') + ' ' + (b.CIDADE_ESTADO || '')).toLowerCase();
          break;
        case 'transportador':
          valorA = (a.TRANSPORTADOR_NOME || '').toLowerCase();
          valorB = (b.TRANSPORTADOR_NOME || '').toLowerCase();
          break;
        case 'classe':
          valorA = (a.CLASSE_FROTA_NOME || '').toLowerCase();
          valorB = (b.CLASSE_FROTA_NOME || '').toLowerCase();
          break;
        case 'viagens':
          valorA = parseInt(a.QTVIAGENS) || 0;
          valorB = parseInt(b.QTVIAGENS) || 0;
          break;
        case 'rota':
          valorA = parseInt(a.QTVIAGENS_NESTA_ROTA) || 0;
          valorB = parseInt(b.QTVIAGENS_NESTA_ROTA) || 0;
          break;
        default:
          return 0;
      }

      if (valorA < valorB) return ordenacaoMotoristas.direcao === 'asc' ? -1 : 1;
      if (valorA > valorB) return ordenacaoMotoristas.direcao === 'asc' ? 1 : -1;
      return 0;
    });

    renderizarMotoristasCompatíveis();
  }

  // Renderizar grid de motoristas compatíveis
  function renderizarMotoristasCompatíveis() {
    const container = document.getElementById('motoristasCompatíveisGrid');
    const acoesLote = document.getElementById('acoesLote');
    const countContainer = document.getElementById('motoristasCompatíveisCount');
    const countText = document.getElementById('motoristasCompatíveisCountText');
    
    // Atualizar contador
    if (countContainer && countText) {
      const count = motoristasCompatíveis.length || 0;
      countText.textContent = `${count} motorista(s) compatível(is) encontrado(s)`;
      countContainer.style.display = count > 0 ? 'block' : 'none';
    }
    
    if (motoristasCompatíveis.length === 0) {
      container.innerHTML = '<p class="empty">Nenhum motorista compatível encontrado.</p>';
      acoesLote.style.display = 'none';
      return;
    }

    // Função para obter ícone de ordenação
    const getSortIcon = (campo) => {
      if (ordenacaoMotoristas.campo !== campo) {
        return '<span style="color: #ccc; font-size: 0.8em;">⇅</span>';
      }
      return ordenacaoMotoristas.direcao === 'asc' 
        ? '<span style="color: #667eea; font-size: 0.8em;">↑</span>'
        : '<span style="color: #667eea; font-size: 0.8em;">↓</span>';
    };

    // Criar tabela
    let html = `
      <div id="legendaMotoristasCompatíveis" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">
        <div style="font-weight: 600; color: #495057; margin-right: 10px;">Legenda:</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #28a745; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
          <span><strong>Acionado:</strong> Motorista que já foi convocado para esta viagem</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #dc3545; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></span>
          <span><strong>Não Acionado:</strong> Motorista que ainda não foi convocado</span>
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <th style="padding: 12px; text-align: left; width: 40px;">
              <input type="checkbox" id="checkAll" style="cursor: pointer;">
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('motorista')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Motorista ${getSortIcon('motorista')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('cidade')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Cidade ${getSortIcon('cidade')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('transportador')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Transportador ${getSortIcon('transportador')}
            </th>
            <th style="padding: 12px; text-align: left; cursor: pointer; user-select: none;" 
                onclick="ordenarMotoristasCompatíveis('classe')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Classe Frota ${getSortIcon('classe')}
            </th>
            <th style="padding: 12px; text-align: center; cursor: pointer; user-select: none; width: 80px;" 
                onclick="ordenarMotoristasCompatíveis('viagens')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Quantidade total de viagens que o motorista já fez">
              🚛 Total ${getSortIcon('viagens')}
            </th>
            <th style="padding: 12px; text-align: center; cursor: pointer; user-select: none; width: 80px;" 
                onclick="ordenarMotoristasCompatíveis('rota')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'"
                title="Quantas vezes o motorista já fez ESTA ROTA específica">
              ⭐ Rota ${getSortIcon('rota')}
            </th>
            <th style="padding: 12px; text-align: left; width: 120px;">Ações</th>
          </tr>
        </thead>
        <tbody>
    `;

    motoristasCompatíveis.forEach((motorista, index) => {
      const isChecked = motorista.selecionado || false;
      
      // Formatar celular para WhatsApp (remover caracteres não numéricos)
      const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsApp = celularFormatado.length >= 10; // Celular válido tem pelo menos 10 dígitos
      const linkWhatsApp = temWhatsApp ? `https://wa.me/55${celularFormatado}` : '#';
      
      // Formatar celular para exibição (com parênteses e hífen)
      let celularExibicao = '';
      if (celularFormatado && celularFormatado.length >= 10) {
        if (celularFormatado.length === 11) {
          // Formato: (41) 99837-1769
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 7)}-${celularFormatado.substring(7)}`;
        } else if (celularFormatado.length === 10) {
          // Formato: (41) 9837-1769
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 6)}-${celularFormatado.substring(6)}`;
        } else {
          // Formato simples se não tiver 10 ou 11 dígitos
          celularExibicao = celularFormatado;
        }
      }
      
      html += `
        <tr style="border-bottom: 1px solid #eee; ${index % 2 === 0 ? 'background: #fafafa;' : ''}">
          <td style="padding: 12px;">
            <input type="checkbox" 
                   class="check-motorista" 
                   data-index="${index}"
                   ${isChecked ? 'checked' : ''}
                   style="cursor: pointer;">
          </td>
          <td style="padding: 12px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              ${motorista.FOI_ACIONADO === 1 
                ? '<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #28a745; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); flex-shrink: 0;" title="Motorista acionado (já foi convocado)"></span>'
                : '<span style="display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #dc3545; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2); flex-shrink: 0;" title="Motorista não acionado (ainda não foi convocado)"></span>'}
              <div>
                <strong>${motorista.NOME_MOTORISTA || 'N/A'}</strong><br>
                <small style="color: #666;">ID: ${motorista.CDCADASTRO_MOTORISTA}${celularExibicao ? '  |  ' + celularExibicao : ''}</small>
              </div>
            </div>
          </td>
          <td style="padding: 12px;">
            ${motorista.CIDADE_NOME || 'N/A'}, ${motorista.CIDADE_ESTADO || 'N/A'}<br>
            <small style="color: #666;">Micro-região: ${motorista.CDMICROREGIAO || 'N/A'}</small>
          </td>
          <td style="padding: 12px;">
            ${motorista.TRANSPORTADOR_NOME || 'N/A'}<br>
            <small style="color: #666;">${motorista.CDTRANSPORTADOR ? 'ID: ' + motorista.CDTRANSPORTADOR : ''}</small>
          </td>
          <td style="padding: 12px;">
            ${motorista.CLASSE_FROTA_NOME || 'N/A'}
          </td>
          <td style="padding: 12px; text-align: center;">
            <span style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 6px 12px; border-radius: 20px; font-weight: 600; font-size: 14px;">
              ${motorista.QTVIAGENS || 0}
            </span>
          </td>
          <td style="padding: 12px; text-align: center;">
            ${motorista.QTVIAGENS_NESTA_ROTA > 0 
              ? `<span style="display: inline-block; background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%); color: white; padding: 6px 12px; border-radius: 20px; font-weight: 600; font-size: 14px; box-shadow: 0 2px 8px rgba(255,215,0,0.4);" title="Motorista experiente nesta rota!">
                  ⭐ ${motorista.QTVIAGENS_NESTA_ROTA}
                </span>` 
              : `<span style="color: #999; font-size: 18px;" title="Nunca fez esta rota">-</span>`
            }
          </td>
          <td style="padding: 12px;">
            ${temWhatsApp ? `
              <a href="${linkWhatsApp}" 
                 target="_blank" 
                 class="btn" 
                 style="background: #25D366; color: white; padding: 8px 12px; border-radius: 4px; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; font-size: 0.9em; cursor: pointer;"
                 title="Abrir WhatsApp de ${motorista.CELULAR || ''}">
                <span style="font-size: 1.2em;">📱</span> WhatsApp
              </a>
            ` : '<span style="color: #999;">Sem celular</span>'}
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    acoesLote.style.display = 'block';
    atualizarContadorSelecionados();

    // Event listeners
    document.getElementById('checkAll').addEventListener('change', function(e) {
      const checkboxes = document.querySelectorAll('.check-motorista');
      checkboxes.forEach(cb => {
        cb.checked = e.target.checked;
        const index = parseInt(cb.getAttribute('data-index'));
        motoristasCompatíveis[index].selecionado = e.target.checked;
      });
      atualizarContadorSelecionados();
    });

    document.querySelectorAll('.check-motorista').forEach(cb => {
      cb.addEventListener('change', function() {
        const index = parseInt(this.getAttribute('data-index'));
        motoristasCompatíveis[index].selecionado = this.checked;
        atualizarContadorSelecionados();
      });
    });
  }

  // Atualizar contador de selecionados
  function atualizarContadorSelecionados() {
    const selecionados = motoristasCompatíveis.filter(m => m.selecionado).length;
    const contador = document.getElementById('contadorSelecionados');
    contador.textContent = `${selecionados} motorista(s) selecionado(s)`;
  }

  // Selecionar todos
  function selecionarTodos() {
    motoristasCompatíveis.forEach(m => m.selecionado = true);
    renderizarMotoristasCompatíveis();
  }

  // Desselecionar todos
  function desselecionarTodos() {
    motoristasCompatíveis.forEach(m => m.selecionado = false);
    renderizarMotoristasCompatíveis();
  }

  // Preparar anúncio da carga
  async function prepararAnuncioCarga() {
    if (!viagemSelecionada) {
      showMessage('Nenhuma viagem selecionada.', 'error');
      return;
    }

    try {
      showMessage('Carregando dados da viagem...', 'info');
      
      // Buscar dados completos da viagem
      const response = await fetch(`/api/viagens/${viagemSelecionada}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar dados da viagem');
      }
      
      const viagemAtual = await response.json();
      
      if (!viagemAtual) {
        showMessage('Dados da viagem não encontrados.', 'error');
        return;
      }

    // Formatar datas
    const formatarDataHora = (dataHora) => {
      if (!dataHora) return 'Não informado';
      
      // SQL Server retorna datas no formato ISO: 2025-11-21T10:39:24.123Z
      // Quando o JavaScript cria new Date(), ele interpreta como UTC e converte para o fuso local
      // Precisamos tratar a string diretamente para evitar conversão de fuso
      
      if (typeof dataHora === 'string') {
        // Remover o Z se existir e tratar como data local
        let dataStr = dataHora.replace('Z', '');
        
        // Se tem T, substituir por espaço
        if (dataStr.includes('T')) {
          dataStr = dataStr.replace('T', ' ');
        }
        
        // Extrair partes da data: 2025-11-21 10:39:24.123
        const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          // Formatar manualmente para pt-BR (sem conversão de fuso)
          const diaStr = String(day).padStart(2, '0');
          const mesStr = String(month).padStart(2, '0');
          const anoStr = year;
          const horaStr = String(hour).padStart(2, '0');
          const minutoStr = String(minute).padStart(2, '0');
          
          return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
        }
      }
      
      // Fallback: extrair componentes UTC e tratar como local (sem conversão de fuso)
      try {
        const date = new Date(dataHora);
        if (isNaN(date.getTime())) return 'Data inválida';
        
        // Extrair componentes UTC e tratar como local (sem conversão de fuso)
        const ano = date.getUTCFullYear();
        const mes = date.getUTCMonth();
        const dia = date.getUTCDate();
        const hora = date.getUTCHours();
        const minuto = date.getUTCMinutes();
        
        // Formatar manualmente para pt-BR
        const diaStr = String(dia).padStart(2, '0');
        const mesStr = String(mes + 1).padStart(2, '0');
        const anoStr = ano;
        const horaStr = String(hora).padStart(2, '0');
        const minutoStr = String(minuto).padStart(2, '0');
        
        return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
      } catch (err) {
        return 'Data inválida';
      }
    };

      // Montar o anúncio com formatação atrativa e concisa
      let anuncio = `🚚 *CARGA DISPONÍVEL*\n\n`;
      
      anuncio += `🆔 *ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
      anuncio += `📦 *Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
      anuncio += `🚛 *Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
      anuncio += `🗺️ *Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} → ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
      
      anuncio += `⏰ *HORÁRIOS*\n`;
      anuncio += `📅 *Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
      anuncio += `📅 *Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
      
      // Só mostrar requisitos se exigir rastreado
      if (viagemAtual.FGRASTREADO === 'S') {
        anuncio += `✅ *REQUISITOS*\n`;
        anuncio += `✅ *Exige Veículo Rastreado:* SIM\n\n`;
      }
      
      anuncio += `👤 *CONTRATADOR*\n`;
      anuncio += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
      
      anuncio += `💰 *VALORES*\n`;
      anuncio += `💵 *Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
      anuncio += `📊 *Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
      anuncio += `📦 *Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\ \n`;
      
      if (viagemAtual.OBSERV) {
        anuncio += `\n📝 *DETALHES DA VIAGEM*\n`;
        anuncio += `${viagemAtual.OBSERV}\n`;
      }
      
      // Adicionar nota sobre o link (será substituído pelo link real ao enviar)
      anuncio += `\n\n🔗 *Acesse para responder:*\n`;
      anuncio += `(Link único será adicionado automaticamente para cada motorista)`;
      
      anuncio = anuncio.trim();

      // Exibir no modal
      const modal = document.getElementById('modalAnuncio');
      const preview = document.getElementById('anuncioCargaPreview');
      preview.textContent = anuncio;
      modal.style.display = 'block';
      
      showMessage('Anúncio preparado com sucesso!', 'success');
    } catch (err) {
      console.error('Erro ao preparar anúncio:', err);
      showMessage('Erro ao preparar anúncio da carga.', 'error');
    }
  }

  // Copiar anúncio para área de transferência
  async function copiarAnuncio() {
    const preview = document.getElementById('anuncioCargaPreview');
    const texto = preview.textContent;
    
    try {
      await navigator.clipboard.writeText(texto);
      showMessage('Anúncio copiado para a área de transferência!', 'success');
    } catch (err) {
      // Fallback para navegadores mais antigos
      const textArea = document.createElement('textarea');
      textArea.value = texto;
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        showMessage('Anúncio copiado para a área de transferência!', 'success');
      } catch (err2) {
        showMessage('Erro ao copiar. Selecione o texto manualmente.', 'error');
      }
      document.body.removeChild(textArea);
    }
  }

  // Função para obter URL pública (para funcionar no celular)
  // USA DETECÇÃO AUTOMÁTICA: Detecta ambiente baseado na URL atual do navegador
  async function obterUrlPublica() {
    // PRIORIDADE 1: Usar o utilitário de ambiente se disponível (detecção automática)
    if (typeof window !== 'undefined' && typeof window.obterUrlBase === 'function') {
      try {
        const urlBase = await window.obterUrlBase();
        // URL base obtida automaticamente
        return urlBase;
      } catch (err) {
        console.warn('[URL] Erro ao obter URL base do utilitário, usando fallback:', err);
      }
    }
    
    // PRIORIDADE 2: Detecção manual baseada no hostname
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || 
                        hostname === '127.0.0.1' ||
                        hostname.startsWith('192.168.') ||
                        hostname.startsWith('10.') ||
                        hostname.startsWith('172.');
    
    if (isLocalhost) {
      // Ambiente LOCAL detectado
      return 'http://localhost:3000';
    }
    
    // PRIORIDADE 3: Usar origem atual (produção)
    const urlAtual = window.location.origin;
    // Ambiente PRODUÇÃO detectado
    return urlAtual;
  }

  // Enviar anúncio via WhatsApp para motoristas selecionados
  async function enviarAnuncioWhatsApp() {
    const selecionados = motoristasCompatíveis.filter(m => m.selecionado);
    
    if (selecionados.length === 0) {
      showMessage('Selecione pelo menos um motorista para enviar o anúncio.', 'error');
      return;
    }

    if (!viagemSelecionada) {
      showMessage('Nenhuma viagem selecionada.', 'error');
      return;
    }

    try {
      showMessage('Preparando convocações e links...', 'info');
      
      // Obter URL base pública (para funcionar no celular)
      const urlBase = await obterUrlPublica();
      
      // Preparar anúncio com links individuais
      const preview = document.getElementById('anuncioCargaPreview');
      if (!preview) {
        throw new Error('Preview do anúncio não encontrado. Certifique-se de preparar o anúncio primeiro.');
      }
      
      let textoBase = preview.textContent;
      
      // Remover a nota sobre link do preview (se existir)
      textoBase = textoBase.replace(/\n\n🔗 \*Acesse para responder:\*\n\(Link único será adicionado automaticamente para cada motorista\)/g, '').trim();
      
      // Preparar lista de motoristas para criar convocações
      // O backend já verifica duplicatas automaticamente
      const motoristasParaEnvio = selecionados.map(m => ({
        CDCADASTRO_MOTORISTA: m.CDCADASTRO_MOTORISTA
      }));

      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';
      
      // Criar convocações (o backend verifica duplicatas e reutiliza se existir)
      const response = await fetch('/api/convocacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        },
        body: JSON.stringify({
          idViagem: viagemSelecionada,
          motoristas: motoristasParaEnvio
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao criar convocações');
      }

      const result = await response.json();
      const todasConvocacoes = result.convocacoes || [];
      
      // Criar um mapa de motorista -> ID convocação e dados completos
      const mapaConvocacoes = {};
      todasConvocacoes.forEach(conv => {
        const motorista = selecionados.find(m => m.CDCADASTRO_MOTORISTA === conv.CDCADASTRO_MOTORISTA);
        if (motorista) {
          mapaConvocacoes[motorista.CDCADASTRO_MOTORISTA] = {
            IDCONVOCACAO: conv.IDCONVOCACAO,
            LINKCONVOCACAO: conv.LINKCONVOCACAO,
            TXTCONVOCACAO: conv.TXTCONVOCACAO,
            NRCELULAR: conv.NRCELULAR,
            EXISTENTE: conv.REUTILIZADA === true // Se foi reutilizada, significa que já existia
          };
        }
      });
      
      // Agora atualizar as convocações com texto e link
      const atualizacoesPromises = [];
      
      // Preparar links do WhatsApp para cada motorista
      const linksWhatsApp = [];
      let semCelular = 0;
      let semConvocacao = 0;
      const motoristasSemCelular = []; // Lista de nomes dos motoristas sem celular
      const motoristasSemConvocacao = []; // Lista de nomes dos motoristas sem convocação
      
      selecionados.forEach((motorista) => {
        const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
        const dadosConvocacao = mapaConvocacoes[motorista.CDCADASTRO_MOTORISTA];
        const nomeMotorista = motorista.NOME_MOTORISTA || `ID: ${motorista.CDCADASTRO_MOTORISTA}`;
        
        if (!celularFormatado || celularFormatado.length < 10) {
          // Motorista sem celular válido - ignorar
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          return;
        }
        
        if (!dadosConvocacao || !dadosConvocacao.IDCONVOCACAO) {
          // Convocação não criada para este motorista - ignorar
          semConvocacao++;
          motoristasSemConvocacao.push(nomeMotorista);
          return;
        }
        
        if (!dadosConvocacao || !dadosConvocacao.IDCONVOCACAO) {
          // Convocação não criada para este motorista - ignorar
          semConvocacao++;
          return;
        }
        
        const idConvocacao = dadosConvocacao.IDCONVOCACAO;
        const convocacaoExiste = dadosConvocacao.EXISTENTE;
        
        // Sempre gerar novo texto e link (para refletir mudanças como aumento de frete)
        // Mesmo que a convocação já exista, atualizamos com os dados mais recentes
        const linkConvocacao = `${urlBase}/convocacao/${idConvocacao}`;
        
        // Personalizar mensagem para cada motorista
        const nomeMotoristaConvocacao = motorista.NOME_MOTORISTA || 'Motorista';
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        
        let textoComLink;
        if (isLocalIP) {
          // Para IPs locais, formatar o link de forma destacada para facilitar cópia
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n💡 *Importante:*\n• Links locais não são clicáveis no WhatsApp\n• Copie o link acima (toque e segure)\n• Cole no navegador do celular\n• Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }
        
        // Sempre atualizar convocação no banco com texto e link atualizados
        // Isso garante que mudanças (como aumento de frete) sejam refletidas
        atualizacoesPromises.push(
          fetch(`/api/convocacoes/${idConvocacao}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              NRCELULAR: celularFormatado,
              TXTCONVOCACAO: textoComLink,
              LINKCONVOCACAO: linkConvocacao
            })
          }).catch(err => {
            console.error(`Erro ao atualizar convocação ${idConvocacao}:`, err);
          })
        );
        
        const textoAnuncio = encodeURIComponent(textoComLink);
        const linkWhatsApp = `https://wa.me/55${celularFormatado}?text=${textoAnuncio}`;
        
        // Armazenar link para exibir no modal
        linksWhatsApp.push({
          motorista: motorista.NOME_MOTORISTA || `ID: ${motorista.CDCADASTRO_MOTORISTA}`,
          celular: celularFormatado,
          link: linkWhatsApp,
          idConvocacao: idConvocacao,
          existente: convocacaoExiste
        });
      });
      
      // Aguardar todas as atualizações
      await Promise.all(atualizacoesPromises);
      
      // Fechar modal de anúncio
      const modal = document.getElementById('modalAnuncio');
      if (modal) {
        modal.style.display = 'none';
      }
      
      // Mostrar modal com links do WhatsApp
      if (linksWhatsApp.length > 0) {
        mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular, motoristasSemConvocacao);
      } else {
        let mensagem = 'Nenhum WhatsApp disponível. ';
        if (semCelular > 0) {
          mensagem += `${semCelular} motorista(s) sem celular válido: ${motoristasSemCelular.join(', ')}. `;
        }
        if (semConvocacao > 0) {
          mensagem += `${semConvocacao} motorista(s) sem convocação criada: ${motoristasSemConvocacao.join(', ')}.`;
        }
        showMessage(mensagem, 'error');
      }
      
      // Limpar seleções
      motoristasCompatíveis.forEach(m => m.selecionado = false);
      renderizarMotoristasCompatíveis();
      
      showMessage(`Convocações criadas com sucesso! ${linksWhatsApp.length} link(s) do WhatsApp disponível(is).`, 'success');
      
    } catch (err) {
      console.error('Erro ao enviar anúncio:', err);
      showMessage('Erro ao criar convocações: ' + err.message, 'error');
    }
  }


  // Função para mostrar modal com links do WhatsApp
  // ============================================================================
  // FIM DAS FUNÇÕES DE ENVIO AUTOMÁTICO
  // ============================================================================

  // Função para mostrar modal com links do WhatsApp
  function mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular = [], motoristasSemConvocacao = []) {
    // Criar ou obter modal
    let modal = document.getElementById('modalLinksWhatsApp');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalLinksWhatsApp';
      modal.className = 'modal';
      modal.style.display = 'none';
      document.body.appendChild(modal);
    }
    
    // Montar conteúdo do modal
    let html = `
      <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid #25D366; padding-bottom: 15px;">
          <h3 style="margin: 0; color: #25D366; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 28px;">📱</span>
            <span>Links do WhatsApp (${linksWhatsApp.length})</span>
          </h3>
          <button type="button" id="btnFecharLinksWhatsApp" class="btn cancel" style="padding: 5px 15px;">✕</button>
        </div>
        
        <div style="margin-bottom: 15px; padding: 15px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border: 2px solid #25D366; border-radius: 8px; position: relative;">
          <button type="button" id="btnAjudaEnvio" 
                  style="position: absolute; top: 10px; right: 10px; background: #25D366; color: white; border: none; border-radius: 50%; width: 30px; height: 30px; cursor: pointer; font-weight: 700; font-size: 16px; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.3s;"
                  onmouseover="this.style.transform='scale(1.1)'; this.style.background='#128C7E';"
                  onmouseout="this.style.transform='scale(1)'; this.style.background='#25D366';"
                  title="Ver guia rápido de envio">
            ?
          </button>
          <p style="margin: 0; color: #2e7d32; font-weight: 600; padding-right: 40px;">
            ✅ Convocações criadas com sucesso! Escolha como deseja enviar:
          </p>
          <p style="margin: 8px 0 0 0; color: #388e3c; font-size: 13px; padding-right: 40px;">
            💡 <strong>Dica:</strong> Clique no <strong>?</strong> acima para ver o guia rápido
          </p>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
    `;
    
    linksWhatsApp.forEach((item, index) => {
      html += `
        <div style="display: flex; align-items: center; gap: 15px; padding: 15px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 8px; transition: all 0.3s;" 
             onmouseover="this.style.background='#e8f5e9'; this.style.borderColor='#25D366';" 
             onmouseout="this.style.background='#f5f5f5'; this.style.borderColor='#ddd';">
          <div style="flex: 1;">
            <div style="font-weight: 600; color: #2c3e50; margin-bottom: 5px;">${item.motorista}</div>
            <div style="font-size: 13px; color: #666;">📱 ${item.celular}</div>
            <div style="font-size: 12px; color: #999; margin-top: 3px;">ID Convocação: ${item.idConvocacao}</div>
          </div>
          <a href="${item.link}" target="_blank" 
             style="padding: 10px 20px; background: #25D366; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; white-space: nowrap; transition: all 0.3s;"
             onmouseover="this.style.background='#128C7E'; this.style.transform='scale(1.05)';"
             onmouseout="this.style.background='#25D366'; this.style.transform='scale(1)';">
            📱 Abrir WhatsApp
          </a>
        </div>
      `;
    });
    
    html += `
        </div>
    `;
    
    if (semCelular > 0 || semConvocacao > 0) {
      html += `
        <div style="margin-top: 15px; padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; font-size: 13px; color: #856404;">
          <strong>⚠️ Atenção:</strong>
          ${semCelular > 0 ? `
            <div style="margin-top: 5px;">
              <strong>${semCelular} motorista(s) sem celular válido:</strong>
              <ul style="margin: 5px 0 0 20px; padding: 0;">
                ${motoristasSemCelular.map(nome => `<li>${nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
          ${semConvocacao > 0 ? `
            <div style="margin-top: 5px;">
              <strong>${semConvocacao} motorista(s) sem convocação criada:</strong>
              <ul style="margin: 5px 0 0 20px; padding: 0;">
                ${motoristasSemConvocacao.map(nome => `<li>${nome}</li>`).join('')}
              </ul>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    html += `
      </div>
    `;
    
    modal.innerHTML = html;
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    
    // Event listeners
    const btnFechar = document.getElementById('btnFecharLinksWhatsApp');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }
    
    // Botão de ajuda/guia rápido
    const btnAjudaEnvio = document.getElementById('btnAjudaEnvio');
    if (btnAjudaEnvio) {
      btnAjudaEnvio.onclick = () => {
        mostrarGuiaRapidoEnvio();
      };
    }
    
    // Fechar ao clicar fora
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    

  }

  // Mostrar guia rápido de envio
  function mostrarGuiaRapidoEnvio() {
    const guiaHTML = `
      <div style="max-width: 800px; max-height: 90vh; overflow-y: auto; padding: 30px; background: white; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; border-bottom: 3px solid #25D366; padding-bottom: 15px;">
          <h2 style="margin: 0; color: #25D366; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 32px;">🚀</span>
            <span>Guia Rápido - Envio de Convocações</span>
          </h2>
          <button type="button" id="btnFecharGuia" 
                  style="background: #dc3545; color: white; border: none; border-radius: 50%; width: 35px; height: 35px; cursor: pointer; font-weight: 700; font-size: 18px; display: flex; align-items: center; justify-content: center;"
                  onmouseover="this.style.background='#c82333';"
                  onmouseout="this.style.background='#dc3545';">
            ✕
          </button>
        </div>
        
        <div style="margin-bottom: 25px;">
          <h3 style="color: #2c3e50; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">👤</span>
            <span>Envio Manual</span>
          </h3>
          <div style="padding: 20px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-left: 4px solid #2196F3; border-radius: 8px; margin-bottom: 15px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #1565c0;">Quando usar:</p>
            <ul style="margin: 0; padding-left: 20px; color: #1976d2;">
              <li>Quer revisar cada mensagem antes de enviar</li>
              <li>Precisa personalizar alguma mensagem</li>
              <li>Controle total sobre o envio</li>
            </ul>
          </div>
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Como fazer:</p>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li>Crie as convocações normalmente</li>
              <li>No modal de links, clique em <strong>"👤 Enviar Manualmente"</strong></li>
              <li>WhatsApp abre com mensagem pré-formatada</li>
              <li>Revise e clique em "Enviar"</li>
            </ol>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
            <p style="margin: 0; color: #856404; font-size: 13px;">
              <strong>✏️ Vantagens:</strong> Pode personalizar • Revisa cada mensagem • Zero custo • Controle total
            </p>
          </div>
        </div>
        
        <div style="margin-bottom: 25px; padding: 20px; background: linear-gradient(135deg, #f3e5f5 0%, #e1bee7 100%); border-radius: 12px; border: 2px solid #9c27b0;">
          <h3 style="color: #7b1fa2; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">✅</span>
            <span>Confirmar Convocação</span>
          </h3>
          <div style="padding: 15px; background: white; border-radius: 8px; margin-bottom: 15px;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Passo a passo:</p>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li><strong>Motorista aceita:</strong> Status muda para "ACEITA"</li>
              <li><strong>Você confirma:</strong> Aba "Convocações" → Botão "✅ Confirmar"</li>
              <li><strong>Escolha o método:</strong> Automático ou Manual</li>
              <li><strong>Pronto!</strong> Mensagem de confirmação enviada</li>
            </ol>
          </div>
        </div>
        
        <div style="margin-top: 25px; padding: 15px; background: #e8f5e9; border-radius: 8px; border-left: 4px solid #4caf50;">
          <p style="margin: 0; color: #2e7d32; font-weight: 600; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 20px;">💡</span>
            <span>Dica:</span>
          </p>
          <p style="margin: 8px 0 0 0; color: #388e3c; font-size: 14px;">
            Primeira vez? Use Manual para ver como ficam as mensagens. Envio em massa? Use Automático para agilizar!
          </p>
        </div>
      </div>
    `;
    
    // Criar modal de guia
    let modalGuia = document.getElementById('modalGuiaRapidoEnvio');
    if (!modalGuia) {
      modalGuia = document.createElement('div');
      modalGuia.id = 'modalGuiaRapidoEnvio';
      modalGuia.className = 'modal';
      modalGuia.style.display = 'none';
      modalGuia.style.alignItems = 'center';
      modalGuia.style.justifyContent = 'center';
      modalGuia.style.zIndex = '10000';
      document.body.appendChild(modalGuia);
    }
    
    modalGuia.innerHTML = guiaHTML;
    modalGuia.style.display = 'flex';
    
    // Fechar modal
    const btnFecharGuia = document.getElementById('btnFecharGuia');
    if (btnFecharGuia) {
      btnFecharGuia.onclick = () => {
        modalGuia.style.display = 'none';
      };
    }
    
    // Fechar ao clicar fora
    modalGuia.onclick = (e) => {
      if (e.target === modalGuia) {
        modalGuia.style.display = 'none';
      }
    };
  }

  // Função para mostrar modal de confirmação
  function showConfirmModal(title, message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const modalMessage = document.getElementById('modalMessage');
      const confirmYes = document.getElementById('confirmYes');
      const confirmNo = document.getElementById('confirmNo');
      
      if (!modal || !modalMessage || !confirmYes || !confirmNo) {
        // Fallback para confirm nativo se modal não existir
        resolve(confirm(message.replace(/<[^>]*>/g, '')));
        return;
      }

      // Atualizar título e mensagem
      const modalTitle = modal.querySelector('h3');
      if (modalTitle) {
        // Se o título contém emoji, manter HTML, senão apenas texto
        if (title.includes('📱') || title.includes('📊')) {
          modalTitle.innerHTML = title;
          modalTitle.style.color = '#25D366';
          modalTitle.style.fontSize = '22px';
          modalTitle.style.fontWeight = '600';
        } else {
          modalTitle.textContent = title;
          modalTitle.style.color = '';
          modalTitle.style.fontSize = '';
          modalTitle.style.fontWeight = '';
        }
      }
      modalMessage.innerHTML = message;

      // Ajustar estilo dos botões se for modal de WhatsApp
      if (title.includes('WhatsApp') || title.includes('📱')) {
        const btnYes = modal.querySelector('#confirmYes');
        if (btnYes) {
          btnYes.style.background = '#25D366';
          btnYes.style.color = 'white';
          btnYes.style.border = 'none';
          btnYes.style.padding = '10px 30px';
          btnYes.textContent = 'Continuar';
        }
      } else {
        const btnYes = modal.querySelector('#confirmYes');
        if (btnYes) {
          btnYes.style.background = '';
          btnYes.style.color = '';
          btnYes.style.border = '';
          btnYes.style.padding = '';
          btnYes.textContent = 'Sim';
        }
      }

      // Mostrar modal
      modal.style.display = 'block';

      // Remover listeners anteriores
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);

      // Adicionar novos listeners
      newConfirmYes.onclick = () => {
        modal.style.display = 'none';
        resolve(true);
      };

      newConfirmNo.onclick = () => {
        modal.style.display = 'none';
        resolve(false);
      };

      // Fechar ao clicar fora
      const originalOnclick = modal.onclick;
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          resolve(false);
        }
      };
    });
  }

  // Disparar convocações
  async function dispararConvocacoes() {
    const selecionados = motoristasCompatíveis.filter(m => m.selecionado);
    
    if (selecionados.length === 0) {
      showMessage('Selecione pelo menos um motorista para disparar as convocações.', 'error');
      return;
    }

    if (!viagemSelecionada) {
      showMessage('Nenhuma viagem selecionada.', 'error');
      return;
    }

    // Usar modal de confirmação estilizado
    const confirmar = await showConfirmModal(
      'Confirmar Disparo de Convocações',
      `Deseja realmente disparar <strong>${selecionados.length}</strong> convocação(ões) para esta viagem?<br><br><small style="color: #666;">As convocações serão criadas e os campos de celular, texto e link serão preenchidos automaticamente.</small>`
    );
    if (!confirmar) return;

    try {
      showMessage('Disparando convocações...', 'info');
      
      // Buscar dados da viagem para gerar texto e link
      const responseViagem = await fetch(`/api/viagens/${viagemSelecionada}`);
      if (!responseViagem.ok) {
        throw new Error('Erro ao buscar dados da viagem');
      }
      const viagemAtual = await responseViagem.json();
      
      if (!viagemAtual || !viagemAtual.IDVIAGEM) {
        throw new Error('Dados da viagem não encontrados');
      }
      
      // Função para formatar data/hora
      const formatarDataHora = (dataHora) => {
        if (!dataHora) return 'Não informado';
        
        if (typeof dataHora === 'string') {
          let dataStr = dataHora.replace('Z', '');
          if (dataStr.includes('T')) {
            dataStr = dataStr.replace('T', ' ');
          }
          
          const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
          if (match) {
            const [, year, month, day, hour, minute] = match;
            const diaStr = String(day).padStart(2, '0');
            const mesStr = String(month).padStart(2, '0');
            const anoStr = year;
            const horaStr = String(hour).padStart(2, '0');
            const minutoStr = String(minute).padStart(2, '0');
            
            return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
          }
        }
        
        try {
          const date = new Date(dataHora);
          if (isNaN(date.getTime())) return 'Data inválida';
          
          const ano = date.getUTCFullYear();
          const mes = date.getUTCMonth();
          const dia = date.getUTCDate();
          const hora = date.getUTCHours();
          const minuto = date.getUTCMinutes();
          
          const diaStr = String(dia).padStart(2, '0');
          const mesStr = String(mes + 1).padStart(2, '0');
          const anoStr = ano;
          const horaStr = String(hora).padStart(2, '0');
          const minutoStr = String(minuto).padStart(2, '0');
          
          return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
        } catch (err) {
          return 'Data inválida';
        }
      };
      
      // Gerar texto base formatado
      let textoBase = `🚚 *CARGA DISPONÍVEL*\n\n`;
      textoBase += `🆔 *ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
      textoBase += `📦 *Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
      textoBase += `🚛 *Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
      textoBase += `🗺️ *Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} → ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
      textoBase += `⏰ *HORÁRIOS*\n`;
      textoBase += `📅 *Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
      textoBase += `📅 *Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
      
      if (viagemAtual.FGRASTREADO === 'S') {
        textoBase += `✅ *REQUISITOS*\n`;
        textoBase += `✅ *Exige Veículo Rastreado:* SIM\n\n`;
      }
      
      textoBase += `👤 *CONTRATADOR*\n`;
      textoBase += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
      textoBase += `💰 *VALORES*\n`;
      textoBase += `💵 *Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
      textoBase += `📊 *Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
      textoBase += `📦 *Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\ \n`;
      
      if (viagemAtual.OBSERV) {
        textoBase += `\n📝 *DETALHES DA VIAGEM*\n`;
        textoBase += `${viagemAtual.OBSERV}\n`;
      }
      
      // Obter URL base pública
      const urlBase = await obterUrlPublica();
      
      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';
      
      // Primeiro, criar as convocações para obter os IDs reais
      // Depois atualizaremos com os dados completos
      const motoristasParaCriacao = selecionados.map(m => ({
        CDCADASTRO_MOTORISTA: m.CDCADASTRO_MOTORISTA
      }));
      
      const response = await fetch('/api/convocacoes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        },
        body: JSON.stringify({
          idViagem: viagemSelecionada,
          motoristas: motoristasParaCriacao
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao criar convocações');
      }

      const result = await response.json();
      const todasConvocacoes = result.convocacoes || [];
      
      // Agora atualizar todas as convocações com os dados completos (celular, texto e link)
      // Armazenar dados gerados para reutilizar no webhook
      const dadosGeradosMap = new Map();
      const atualizacoesPromises = [];
      let atualizacoesSucesso = 0;
      let atualizacoesErro = 0;
      
      for (const motorista of selecionados) {
        const convocacao = todasConvocacoes.find(c => c.CDCADASTRO_MOTORISTA === motorista.CDCADASTRO_MOTORISTA);
        if (!convocacao || !convocacao.IDCONVOCACAO) {
          console.warn(`Convocação não encontrada para motorista ${motorista.CDCADASTRO_MOTORISTA}`);
          continue;
        }
        
        const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
        const idConvocacao = convocacao.IDCONVOCACAO;
        const linkConvocacao = `${urlBase}/convocacao/${idConvocacao}`;
        
        // Personalizar mensagem para cada motorista
        const nomeMotoristaConvocacao = motorista.NOME_MOTORISTA || 'Motorista';
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        
        let textoComLink;
        if (isLocalIP) {
          // Para IPs locais, formatar o link de forma destacada para facilitar cópia
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n💡 *Importante:*\n• Links locais não são clicáveis no WhatsApp\n• Copie o link acima (toque e segure)\n• Cole no navegador do celular\n• Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }
        
        // Formatar rota (exatamente como no textoBase linha 3999)
        const rotaFormatada = viagemAtual.DSROTEIRO 
          ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` 
          : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} → ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`;
        
        // Formatar tipo (exatamente como no textoBase linha 3997)
        const tipoFormatado = viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado';
        
        // Formatar classe (exatamente como no textoBase linha 3998)
        const classeFormatada = viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado';
        
        // Armazenar dados gerados para uso no webhook (incluindo os 11 campos solicitados)
        // Usando exatamente os mesmos dados e formatação que são usados na mensagem (textoBase)
        dadosGeradosMap.set(idConvocacao, {
          IDCONVOCACAO: idConvocacao,
          NRCELULAR: celularFormatado && celularFormatado.length >= 10 ? celularFormatado : null,
          TXTCONVOCACAO: textoComLink,
          LINKCONVOCACAO: linkConvocacao,
          // Campos adicionais (11 campos) - usando os mesmos dados que montam a mensagem
          ID: viagemAtual.IDVIAGEM || null,
          TIPO: tipoFormatado,
          CLASSE: classeFormatada,
          ROTA: rotaFormatada,
          CARREGAMENTO: formatarDataHora(viagemAtual.DTPREVINICIO),
          DESCARGA: formatarDataHora(viagemAtual.DTPREVFINAL),
          CONTRATADOR: viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado',
          FRETE: viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00',
          PESO: viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000',
          CUBAGEM: viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000',
          DETALHES: viagemAtual.OBSERV || ''
        });
        
        // Preparar dados para atualização
        // SEMPRE enviar TXTCONVOCACAO e LINKCONVOCACAO
        const dadosAtualizacao = {
          TXTCONVOCACAO: textoComLink,
          LINKCONVOCACAO: linkConvocacao
        };
        
        // Adicionar NRCELULAR apenas se houver celular válido
        // Se não houver, não enviar o campo (o controller só atualiza se o campo for fornecido)
        if (celularFormatado && celularFormatado.length >= 10) {
          dadosAtualizacao.NRCELULAR = celularFormatado;
        }
        
        // Validar que temos pelo menos texto e link
        if (!dadosAtualizacao.TXTCONVOCACAO || !dadosAtualizacao.LINKCONVOCACAO) {
          console.error(`[DISPARAR] Dados incompletos para convocação ${idConvocacao}:`, dadosAtualizacao);
          atualizacoesErro++;
          continue;
        }
        
        console.log(`[DISPARAR] Atualizando convocação ${idConvocacao} com dados:`, {
          NRCELULAR: dadosAtualizacao.NRCELULAR || 'não informado',
          TXTCONVOCACAO: dadosAtualizacao.TXTCONVOCACAO ? `${dadosAtualizacao.TXTCONVOCACAO.substring(0, 50)}...` : 'vazio',
          LINKCONVOCACAO: dadosAtualizacao.LINKCONVOCACAO || 'vazio'
        });
        
        // Atualizar convocação no banco com todos os dados
        atualizacoesPromises.push(
          fetch(`/api/convocacoes/${idConvocacao}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(dadosAtualizacao)
          }).then(async (response) => {
            const responseData = await response.json();
            if (!response.ok) {
              console.error(`[DISPARAR] Erro ao atualizar convocação ${idConvocacao}:`, responseData);
              atualizacoesErro++;
              return { success: false, id: idConvocacao, error: responseData };
            }
            console.log(`[DISPARAR] Convocação ${idConvocacao} atualizada com sucesso. Linhas afetadas:`, responseData.rowsAffected);
            atualizacoesSucesso++;
            return { success: true, id: idConvocacao, response: responseData };
          }).catch(err => {
            console.error(`[DISPARAR] Erro ao atualizar convocação ${idConvocacao}:`, err);
            atualizacoesErro++;
            return { success: false, id: idConvocacao, error: err.message };
          })
        );
      }
      
      // Aguardar todas as atualizações (não falhar se algumas derem erro)
      const resultados = await Promise.allSettled(atualizacoesPromises);
      
      // Verificar resultados
      const sucessos = resultados.filter(r => r.status === 'fulfilled' && r.value && r.value.success).length;
      const erros = resultados.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value && !r.value.success)).length;
      
      console.log(`[DISPARAR] Resultado das atualizações: ${sucessos} sucesso(s), ${erros} erro(s) de ${atualizacoesPromises.length} total`);
      
      // Preparar dados para envio ao webhook (reutilizar dados já gerados)
      // Primeiro, buscar convocações do banco para verificar DHENVIOMETA
      const convocacoesParaEnviar = [];
      
      for (const resultado of resultados) {
        if (resultado.status === 'fulfilled' && resultado.value && resultado.value.success) {
          const idConvocacao = resultado.value.id;
          const dadosGerados = dadosGeradosMap.get(idConvocacao);
          
          if (dadosGerados) {
            // Buscar convocação do banco para verificar DHENVIOMETA
            try {
              const responseConvocacao = await fetch(`/api/convocacoes/${idConvocacao}`);
              if (responseConvocacao.ok) {
                const convocacaoCompleta = await responseConvocacao.json();
                // Só adicionar se DHENVIOMETA estiver vazio/null
                if (!convocacaoCompleta.DHENVIOMETA) {
                  convocacoesParaEnviar.push(dadosGerados);
                }
              }
            } catch (err) {
              // Ignorar erro ao verificar convocação
            }
          }
        }
      }
      
      // Enviar dados para o webhook INDIVIDUALMENTE com intervalo de 1 segundo
      if (convocacoesParaEnviar.length > 0) {
        let enviadosComSucesso = 0;
        let enviadosComErro = 0;
        
        for (let i = 0; i < convocacoesParaEnviar.length; i++) {
          const dadosConvocacao = convocacoesParaEnviar[i];
          
          // Remover TXTCONVOCACAO do objeto antes de enviar ao webhook
          const { TXTCONVOCACAO, ...dadosParaWebhook } = dadosConvocacao;
          
          try {
            const inicioEnvio = Date.now();
            const timestampEnvio = new Date().toISOString();
            
            // Log detalhado de envio (F12)
            console.log('========================================');
            console.log(`[WEBHOOK ENVIO] 📤 [${i + 1}/${convocacoesParaEnviar.length}] ENVIANDO CONVOCAÇÃO`);
            console.log(`[WEBHOOK ENVIO] Timestamp: ${timestampEnvio}`);
            console.log(`[WEBHOOK ENVIO] ID Convocação: ${dadosParaWebhook.IDCONVOCACAO}`);
            console.log(`[WEBHOOK ENVIO] URL: https://ia.riochat.com.br/webhook/aviso-rota-integra`);
            console.log(`[WEBHOOK ENVIO] Método: POST`);
            console.log(`[WEBHOOK ENVIO] Headers:`, { 'Content-Type': 'application/json' });
            console.log(`[WEBHOOK ENVIO] Body completo:`, JSON.stringify(dadosParaWebhook, null, 2));
            console.log('========================================');
            
            // Adicionar log de envio na aba e salvar no banco (gera log no terminal também)
            if (typeof window.adicionarLogMeta === 'function') {
              await window.adicionarLogMeta({
                tipo: 'envio',
                titulo: `Enviando Convocação ${dadosParaWebhook.IDCONVOCACAO}`,
                mensagem: `[${i + 1}/${convocacoesParaEnviar.length}] Enviando convocação ${dadosParaWebhook.IDCONVOCACAO} para o webhook Meta`,
                detalhes: {
                  url: 'https://ia.riochat.com.br/webhook/aviso-rota-integra',
                  metodo: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: dadosParaWebhook,
                  timestamp: timestampEnvio
                }
              });
            }
            
            const webhookResponse = await fetch('https://ia.riochat.com.br/webhook/aviso-rota-integra', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(dadosParaWebhook) // Enviar objeto individual, não array (sem TXTCONVOCACAO)
            });
            
            const tempoResposta = Date.now() - inicioEnvio;
            const timestampResposta = new Date().toISOString();
            
            // Tentar ler o body da resposta
            let responseBody = null;
            const contentType = webhookResponse.headers.get('content-type');
            const responseHeaders = Object.fromEntries(webhookResponse.headers.entries());
            
            try {
              if (contentType && contentType.includes('application/json')) {
                responseBody = await webhookResponse.json();
              } else {
                responseBody = await webhookResponse.text();
              }
            } catch (bodyErr) {
              // Ignorar erro ao ler body
            }
            
            // Log detalhado de resposta (F12)
            console.log(`[WEBHOOK RESPOSTA] 📥 [${i + 1}/${convocacoesParaEnviar.length}] RESPOSTA RECEBIDA`);
            console.log(`[WEBHOOK RESPOSTA] Timestamp: ${timestampResposta}`);
            console.log(`[WEBHOOK RESPOSTA] ID Convocação: ${dadosParaWebhook.IDCONVOCACAO}`);
            console.log(`[WEBHOOK RESPOSTA] Status: ${webhookResponse.status} ${webhookResponse.statusText}`);
            console.log(`[WEBHOOK RESPOSTA] Tempo de resposta: ${tempoResposta}ms`);
            console.log(`[WEBHOOK RESPOSTA] Headers:`, JSON.stringify(responseHeaders, null, 2));
            if (contentType && contentType.includes('application/json')) {
              console.log(`[WEBHOOK RESPOSTA] Body (JSON):`, JSON.stringify(responseBody, null, 2));
            } else {
              console.log(`[WEBHOOK RESPOSTA] Body (Texto):`, responseBody);
            }
            console.log('');
            
            // Adicionar log de resposta na aba e salvar no banco (gera log no terminal também)
            if (typeof window.adicionarLogMeta === 'function') {
              await window.adicionarLogMeta({
                tipo: 'resposta',
                titulo: `Resposta - Convocação ${dadosParaWebhook.IDCONVOCACAO}`,
                mensagem: `Status: ${webhookResponse.status} ${webhookResponse.statusText} | Tempo: ${tempoResposta}ms`,
                detalhes: {
                  idConvocacao: dadosParaWebhook.IDCONVOCACAO,
                  status: webhookResponse.status,
                  statusText: webhookResponse.statusText,
                  headers: responseHeaders,
                  body: responseBody,
                  tempoResposta: `${tempoResposta}ms`,
                  timestamp: timestampResposta
                },
                status_http: webhookResponse.status,
                tempo_resposta: tempoResposta
              });
            }
            
            if (webhookResponse.ok) {
              // Adicionar log de sucesso na aba
              if (typeof window.adicionarLogMeta === 'function') {
                window.adicionarLogMeta({
                  tipo: 'sucesso',
                  titulo: `✅ Sucesso - Convocação ${dadosParaWebhook.IDCONVOCACAO}`,
                  mensagem: `Convocação ${dadosParaWebhook.IDCONVOCACAO} enviada com sucesso para o webhook Meta`,
                  detalhes: {
                    idConvocacao: dadosParaWebhook.IDCONVOCACAO,
                    resposta: responseBody,
                    tempoResposta: `${tempoResposta}ms`
                  }
                });
              }
              
              // Atualizar campo DHENVIOMETA após envio bem-sucedido
              try {
                const updateResponse = await fetch(`/api/convocacoes/${dadosParaWebhook.IDCONVOCACAO}/atualizar-envio-meta`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json'
                  }
                });
              } catch (updateErr) {
                // Ignorar erro ao atualizar DHENVIOMETA
              }
              
              enviadosComSucesso++;
            } else {
              
              // Adicionar log de erro na aba
              if (typeof window.adicionarLogMeta === 'function') {
                window.adicionarLogMeta({
                  tipo: 'erro',
                  titulo: `❌ Erro - Convocação ${dadosParaWebhook.IDCONVOCACAO}`,
                  mensagem: `Erro ao enviar convocação ${dadosParaWebhook.IDCONVOCACAO}: Status ${webhookResponse.status} ${webhookResponse.statusText}`,
                  detalhes: {
                    idConvocacao: dadosParaWebhook.IDCONVOCACAO,
                    status: webhookResponse.status,
                    statusText: webhookResponse.statusText,
                    body: responseBody,
                    tempoResposta: `${tempoResposta}ms`
                  }
                });
              }
              
              enviadosComErro++;
            }
          } catch (webhookErr) {
            console.error(`[WEBHOOK ENVIO] ❌ Erro de conexão - Convocação ${dadosParaWebhook.IDCONVOCACAO}:`, webhookErr.message);
            
            // Adicionar log de erro de conexão na aba
            if (typeof window.adicionarLogMeta === 'function') {
              window.adicionarLogMeta({
                tipo: 'erro',
                titulo: `❌ Erro de Conexão - Convocação ${dadosParaWebhook.IDCONVOCACAO}`,
                mensagem: `Erro de conexão ao enviar convocação ${dadosParaWebhook.IDCONVOCACAO}: ${webhookErr.message}`,
                detalhes: {
                  idConvocacao: dadosParaWebhook.IDCONVOCACAO,
                  tipoErro: webhookErr.name,
                  mensagem: webhookErr.message,
                  stack: webhookErr.stack
                }
              });
            }
            
            enviadosComErro++;
          }
          
          // Aguardar 1 segundo antes do próximo envio (exceto no último)
          if (i < convocacoesParaEnviar.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      if (erros > 0) {
        showMessage(`${result.message || 'Convocações criadas'} | ${sucessos} atualizada(s) com sucesso, ${erros} com erro(s). Verifique o console para detalhes.`, erros === atualizacoesPromises.length ? 'error' : 'warning');
      } else {
        showMessage(`${result.message || 'Convocações disparadas com sucesso!'} | Todos os campos foram atualizados.`, 'success');
      }
      
      // Limpar seleções
      motoristasCompatíveis.forEach(m => m.selecionado = false);
      renderizarMotoristasCompatíveis();
      
    } catch (err) {
      console.error('Erro ao disparar convocações:', err);
      showMessage(err.message || 'Erro ao disparar convocações.', 'error');
    }
  }

  // ========== FUNCIONALIDADES DE INTEGRAÇÃO META ==========
  
  let logsIntegracaoMeta = [];
  
  // Função para adicionar log à lista (definida no escopo global)
  window.adicionarLogMeta = async function(log) {
    const logCompleto = {
      ...log,
      timestamp: new Date().toISOString(),
      id: Date.now() + Math.random()
    };
    
    logsIntegracaoMeta.unshift(logCompleto);
    
    // Limitar a 100 logs em memória
    if (logsIntegracaoMeta.length > 100) {
      logsIntegracaoMeta = logsIntegracaoMeta.slice(0, 100);
    }
    
    // Salvar no banco de dados
    try {
      let idConvocacao = null;
      
      if (log.detalhes?.body?.IDCONVOCACAO) {
        idConvocacao = log.detalhes.body.IDCONVOCACAO;
      } else if (log.detalhes?.body?.idConvocacao) {
        idConvocacao = log.detalhes.body.idConvocacao;
      } else if (log.detalhes?.idConvocacao) {
        idConvocacao = log.detalhes.idConvocacao;
      } else if (log.detalhes?.IDCONVOCACAO) {
        idConvocacao = log.detalhes.IDCONVOCACAO;
      } else if (log.titulo) {
        const match = log.titulo.match(/Convocação\s+(\d+)/);
        if (match) {
          idConvocacao = parseInt(match[1]);
        }
      } else if (log.mensagem) {
        const match = log.mensagem.match(/convocação\s+(\d+)/i);
        if (match) {
          idConvocacao = parseInt(match[1]);
        }
      }
      
      const dadosParaSalvar = {
        IDCONVOCACAO: idConvocacao,
        tipo: log.tipo,
        titulo: log.titulo,
        mensagem: log.mensagem,
        detalhes: log.detalhes,
        status_http: log.detalhes?.status || null,
        tempo_resposta: log.detalhes?.tempoResposta ? parseInt(String(log.detalhes.tempoResposta).replace('ms', '')) || null : null
      };
      
      if (dadosParaSalvar.IDCONVOCACAO) {
        await fetch('/api/logs-webhook-meta', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dadosParaSalvar)
        });
      }
      } catch (err) {
        // Ignorar erro ao salvar log
      }
    
    if (typeof window.atualizarExibicaoLogsMeta === 'function') {
      window.atualizarExibicaoLogsMeta();
    }
  };
  
  // Função para atualizar a exibição dos logs (definida no escopo global)
  window.atualizarExibicaoLogsMeta = function() {
    const container = document.getElementById('logsIntegracaoMeta');
    if (!container) {
      setTimeout(() => window.atualizarExibicaoLogsMeta(), 500);
      return;
    }
    
    if (logsIntegracaoMeta.length === 0) {
      container.innerHTML = `
        <div style="color: #6c757d; text-align: center; padding: 40px;">
          Nenhum log disponível. Os logs aparecerão aqui quando houver envios para o webhook Meta.
        </div>
      `;
      return;
    }
    
    // Separar logs por tipo
    const logsEnvios = logsIntegracaoMeta.filter(l => l.tipo === 'envio').sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    const logsRespostas = logsIntegracaoMeta.filter(l => l.tipo === 'resposta' || l.tipo === 'sucesso').sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    const logsCallbacks = logsIntegracaoMeta.filter(l => l.tipo === 'callback' || l.tipo === 'retorno').sort((a, b) => {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    
    // Função auxiliar para gerar HTML de um log
    const gerarHtmlLog = (log) => {
      let dataHora = 'Data inválida';
      try {
        if (log.timestamp) {
          const date = new Date(log.timestamp);
          if (!isNaN(date.getTime())) {
            dataHora = date.toLocaleString('pt-BR');
          }
        }
      } catch (e) {
        // Ignorar erro ao formatar data
      }
      
      const tipoIcon = log.tipo === 'envio' ? '📤' : log.tipo === 'resposta' ? '📥' : log.tipo === 'callback' || log.tipo === 'retorno' ? '🔄' : log.tipo === 'sucesso' ? '✅' : log.tipo === 'erro' ? '❌' : 'ℹ️';
      const tipoCor = log.tipo === 'envio' ? '#007bff' : log.tipo === 'resposta' ? '#17a2b8' : log.tipo === 'callback' || log.tipo === 'retorno' ? '#ff9800' : log.tipo === 'sucesso' ? '#28a745' : log.tipo === 'erro' ? '#dc3545' : '#6c757d';
      
      return `
        <div style="border-left: 4px solid ${tipoCor}; padding: 12px; margin-bottom: 10px; background: #f8f9fa; border-radius: 4px; display: block; visibility: visible; min-height: 60px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 16px; display: inline-block;">${tipoIcon}</span>
              <strong style="color: ${tipoCor}; display: inline-block; font-size: 12px;">${log.titulo || log.tipo}</strong>
            </div>
            <span style="color: #6c757d; font-size: 10px; display: inline-block;">${dataHora}</span>
          </div>
          ${log.mensagem ? `<div style="color: #333; margin-bottom: 8px; display: block; min-height: 20px; font-size: 11px;">${log.mensagem}</div>` : ''}
          ${log.detalhes ? `
            <details style="margin-top: 8px; display: block;">
              <summary style="cursor: pointer; color: #007bff; font-weight: 600; user-select: none; display: block; font-size: 11px;">Ver detalhes</summary>
              <pre style="background: #fff; padding: 10px; border-radius: 4px; margin-top: 8px; overflow-x: auto; font-size: 10px; line-height: 1.4; display: block; min-height: 50px;">${JSON.stringify(log.detalhes, null, 2)}</pre>
            </details>
          ` : ''}
        </div>
      `;
    };
    
    // Gerar HTML para cada coluna
    const htmlColuna1 = logsEnvios.length > 0 
      ? logsEnvios.map(gerarHtmlLog).join('')
      : '<div style="color: #6c757d; text-align: center; padding: 20px; font-size: 12px;">Nenhum envio</div>';
    
    const htmlColuna2 = logsRespostas.length > 0
      ? logsRespostas.map(gerarHtmlLog).join('')
      : '<div style="color: #6c757d; text-align: center; padding: 20px; font-size: 12px;">Nenhuma resposta</div>';
    
    const htmlColuna3 = logsCallbacks.length > 0
      ? logsCallbacks.map(gerarHtmlLog).join('')
      : '<div style="color: #6c757d; text-align: center; padding: 20px; font-size: 12px;">Nenhum callback</div>';
    
    // Montar HTML com 3 colunas
    const html = `
      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px; width: 100%;">
        <div style="display: flex; flex-direction: column;">
          <div style="background: #007bff; color: white; padding: 10px; text-align: center; font-weight: bold; border-radius: 4px 4px 0 0; margin-bottom: 10px;">
            📤 Envios (${logsEnvios.length})
          </div>
          <div style="flex: 1; overflow-y: auto; max-height: 500px;">
            ${htmlColuna1}
          </div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div style="background: #17a2b8; color: white; padding: 10px; text-align: center; font-weight: bold; border-radius: 4px 4px 0 0; margin-bottom: 10px;">
            📥 Retornos (${logsRespostas.length})
          </div>
          <div style="flex: 1; overflow-y: auto; max-height: 500px;">
            ${htmlColuna2}
          </div>
        </div>
        <div style="display: flex; flex-direction: column;">
          <div style="background: #ff9800; color: white; padding: 10px; text-align: center; font-weight: bold; border-radius: 4px 4px 0 0; margin-bottom: 10px;">
            🔄 Callbacks (${logsCallbacks.length})
          </div>
          <div style="flex: 1; overflow-y: auto; max-height: 500px;">
            ${htmlColuna3}
          </div>
        </div>
      </div>
    `;
    
    // Verificar se a aba está ativa antes de inserir
    const tabContent = document.getElementById('tab-integracao-meta');
    if (!tabContent || !tabContent.classList.contains('active')) {
      // Se a aba não estiver ativa, tentar novamente quando estiver
      setTimeout(() => window.atualizarExibicaoLogsMeta(), 200);
      return;
    }
    
    // Inserir HTML diretamente - mesmo padrão usado nas outras abas
    container.innerHTML = html;
    
    // Forçar reflow para garantir renderização
    void container.offsetHeight;
    
    // Atualizar contadores
    const totalEnvios = logsIntegracaoMeta.filter(l => l.tipo === 'envio').length;
    const totalSucessos = logsIntegracaoMeta.filter(l => l.tipo === 'sucesso').length;
    const totalErros = logsIntegracaoMeta.filter(l => l.tipo === 'erro').length;
    // Tratar última atualização de forma segura
    let ultimaAtualizacao = '-';
    if (logsIntegracaoMeta.length > 0 && logsIntegracaoMeta[0].timestamp) {
      try {
        const date = new Date(logsIntegracaoMeta[0].timestamp);
        if (!isNaN(date.getTime())) {
          ultimaAtualizacao = date.toLocaleString('pt-BR');
        }
      } catch (e) {
        // Ignorar erro ao formatar data
      }
    }
    
    const totalEnviosEl = document.getElementById('totalEnviosMeta');
    const totalSucessosEl = document.getElementById('totalSucessosMeta');
    const totalErrosEl = document.getElementById('totalErrosMeta');
    const ultimaAtualizacaoEl = document.getElementById('ultimaAtualizacaoMeta');
    
    if (totalEnviosEl) totalEnviosEl.textContent = totalEnvios;
    if (totalSucessosEl) totalSucessosEl.textContent = totalSucessos;
    if (totalErrosEl) totalErrosEl.textContent = totalErros;
    if (ultimaAtualizacaoEl) ultimaAtualizacaoEl.textContent = ultimaAtualizacao;
  };
  
  // Função para limpar logs (definida no escopo global)
  window.limparLogsMeta = function() {
    if (confirm('Deseja realmente limpar todos os logs da integração Meta?')) {
      logsIntegracaoMeta = [];
      if (typeof window.atualizarExibicaoLogsMeta === 'function') {
        window.atualizarExibicaoLogsMeta();
      }
      showMessage('Logs limpos com sucesso!', 'success');
    }
  }
  
  // Função para exportar logs (definida no escopo global)
  window.exportarLogsMeta = function() {
    if (logsIntegracaoMeta.length === 0) {
      showMessage('Nenhum log para exportar.', 'warning');
      return;
    }
    
    const dadosExportacao = {
      dataExportacao: new Date().toISOString(),
      totalLogs: logsIntegracaoMeta.length,
      logs: logsIntegracaoMeta
    };
    
    const blob = new Blob([JSON.stringify(dadosExportacao, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-integracao-meta-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showMessage('Logs exportados com sucesso!', 'success');
  }
  
  // Função para carregar logs do banco de dados (reutilizável)
  window.carregarLogsMeta = async function() {
    try {
      // Obter ID da viagem atual
      const idViagem = document.getElementById('filtroIdViagem')?.value || 
                       document.getElementById('viagemId')?.value || 
                       null;
      
      // Montar URL com filtro de viagem se disponível
      let url = '/api/logs-webhook-meta?limite=100';
      if (idViagem && idViagem.trim() !== '') {
        url += `&idViagem=${encodeURIComponent(idViagem.trim())}`;
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: `Erro ${response.status}: ${response.statusText}` }));
        console.error('[LOGS META] Erro ao carregar logs:', errorData);
        throw new Error(errorData.error || errorData.details || `Erro ${response.status} ao carregar logs`);
      }
      
      const logsDoBanco = await response.json();
      if (!Array.isArray(logsDoBanco)) {
        console.error('[LOGS META] Resposta inválida do servidor:', logsDoBanco);
        throw new Error('Resposta do servidor não é um array');
      }
        
      // Converter logs do banco para o formato esperado
      // O controller retorna campos em maiúsculas (TIPO, TITULO, etc.) e também adiciona detalhes/timestamp
      logsIntegracaoMeta = logsDoBanco.map((log, index) => {
        try {
          // Tentar parsear detalhes se for string
          let detalhesParsed = null;
          if (log.detalhes) {
            detalhesParsed = log.detalhes; // Já vem parseado do controller
          } else if (log.DETALHES) {
            if (typeof log.DETALHES === 'string') {
              try {
                detalhesParsed = JSON.parse(log.DETALHES);
              } catch (e) {
                // Ignorar erro ao parsear detalhes
                detalhesParsed = null;
              }
            } else {
              detalhesParsed = log.DETALHES;
            }
          }
          
          // Obter timestamp
          let timestampValue = null;
          if (log.timestamp) {
            timestampValue = log.timestamp;
          } else if (log.DHLOG) {
            timestampValue = new Date(log.DHLOG).toISOString();
          } else {
            timestampValue = new Date().toISOString();
          }
          
          const logConvertido = {
            tipo: log.TIPO || log.tipo || 'desconhecido',
            titulo: log.TITULO || log.titulo || '',
            mensagem: log.MENSAGEM || log.mensagem || '',
            detalhes: detalhesParsed,
            timestamp: timestampValue,
            id: log.IDLOG || log.id || `log-${index}`
          };
          
          return logConvertido;
        } catch (parseErr) {
          return null;
        }
      }).filter(log => log !== null);
      
      if (typeof window.atualizarExibicaoLogsMeta === 'function') {
        window.atualizarExibicaoLogsMeta();
      }
    } catch (err) {
      console.error('[LOGS META] Erro ao carregar logs:', err);
      showMessage(`Erro ao carregar logs: ${err.message}`, 'error');
      if (typeof window.atualizarExibicaoLogsMeta === 'function') {
        window.atualizarExibicaoLogsMeta();
      }
    }
  };
  
  // Inicializar event listeners da aba Integração Meta
  document.addEventListener('DOMContentLoaded', () => {
    const btnAtualizarLogs = document.getElementById('btnAtualizarLogsMeta');
    const btnLimparLogs = document.getElementById('btnLimparLogsMeta');
    const btnExportarLogs = document.getElementById('btnExportarLogsMeta');
    
    if (btnAtualizarLogs) {
      btnAtualizarLogs.addEventListener('click', () => {
        window.carregarLogsMeta();
      });
    }
    
    if (btnLimparLogs) {
      btnLimparLogs.addEventListener('click', window.limparLogsMeta);
    }
    
    if (btnExportarLogs) {
      btnExportarLogs.addEventListener('click', window.exportarLogsMeta);
    }
    
    // Verificar se a aba Integração Meta já está ativa ao carregar a página
    setTimeout(() => {
      const tabIntegracaoMeta = document.getElementById('tab-integracao-meta');
      if (tabIntegracaoMeta && tabIntegracaoMeta.classList.contains('active')) {
        if (typeof window.carregarLogsMeta === 'function') {
          window.carregarLogsMeta();
        }
      }
    }, 500);
  });
  
  // Expor função globalmente para teste no console
  // O usuário pode executar: window.carregarLogsMeta() no console para testar

  // ========== FUNCIONALIDADES DE CONVOCAÇÕES ==========
  
  let convocacoes = [];
  
  // Variável para controlar ordenação de convocações
  let ordenacaoConvocacoes = {
    campo: null,
    direcao: 'asc' // 'asc' ou 'desc'
  };

  // Função para ordenar convocações (tornada global para onclick)
  window.ordenarConvocacoes = function(campo) {
    if (ordenacaoConvocacoes.campo === campo) {
      // Se já está ordenando por este campo, inverte a direção
      ordenacaoConvocacoes.direcao = ordenacaoConvocacoes.direcao === 'asc' ? 'desc' : 'asc';
    } else {
      // Novo campo, ordena ascendente
      ordenacaoConvocacoes.campo = campo;
      ordenacaoConvocacoes.direcao = 'asc';
    }

    convocacoes.sort((a, b) => {
      let valorA, valorB;

      switch (campo) {
        case 'id':
          valorA = parseInt(a.IDCONVOCACAO) || 0;
          valorB = parseInt(b.IDCONVOCACAO) || 0;
          break;
        case 'viagem':
          valorA = parseInt(a.IDVIAGEM) || 0;
          valorB = parseInt(b.IDVIAGEM) || 0;
          break;
        case 'motorista':
          valorA = (a.NOME_MOTORISTA || '').toLowerCase();
          valorB = (b.NOME_MOTORISTA || '').toLowerCase();
          break;
        case 'rota':
          valorA = ((a.ORIGEM_CIDADE || '') + ' ' + (a.DESTINO_CIDADE || '')).toLowerCase();
          valorB = ((b.ORIGEM_CIDADE || '') + ' ' + (b.DESTINO_CIDADE || '')).toLowerCase();
          break;
        case 'status':
          valorA = (a.STATUS || '').toLowerCase();
          valorB = (b.STATUS || '').toLowerCase();
          break;
        case 'dataConvocacao':
          valorA = a.DHCONVOCACAO ? new Date(a.DHCONVOCACAO).getTime() : 0;
          valorB = b.DHCONVOCACAO ? new Date(b.DHCONVOCACAO).getTime() : 0;
          break;
        case 'dataAcesso':
          valorA = a.DHACESSO ? new Date(a.DHACESSO).getTime() : 0;
          valorB = b.DHACESSO ? new Date(b.DHACESSO).getTime() : 0;
          break;
        case 'dataResposta':
          valorA = a.DHRESPOSTA ? new Date(a.DHRESPOSTA).getTime() : 0;
          valorB = b.DHRESPOSTA ? new Date(b.DHRESPOSTA).getTime() : 0;
          break;
        default:
          return 0;
      }

      if (valorA < valorB) return ordenacaoConvocacoes.direcao === 'asc' ? -1 : 1;
      if (valorA > valorB) return ordenacaoConvocacoes.direcao === 'asc' ? 1 : -1;
      return 0;
    });

    renderizarConvocacoes();
  };

  // Inicializar aba de Convocações
  function inicializarAbaConvocacoes() {
    const btnVoltar = document.getElementById('btnVoltarConvocacoes');
    const btnCarregar = document.getElementById('btnCarregarConvocacoes');
    const btnVerLinks = document.getElementById('btnVerLinksWhatsAppConvocacoes');
    const btnGuiaCompleto = document.getElementById('btnGuiaEnvioConvocacoes');
    const filtroViagem = document.getElementById('filtroConvocacaoViagem');
    const filtroStatus = document.getElementById('filtroConvocacaoStatus');

    if (btnVoltar) {
      btnVoltar.onclick = () => showTab('filtros');
    }

    if (btnCarregar) {
      btnCarregar.onclick = carregarConvocacoes;
    }

    if (btnVerLinks) {
      btnVerLinks.onclick = mostrarLinksWhatsAppDasConvocacoes;
    }

    if (btnGuiaCompleto) {
      btnGuiaCompleto.onclick = mostrarGuiaCompletoEnvio;
    }

    if (filtroViagem) {
      filtroViagem.onkeypress = (e) => {
        if (e.key === 'Enter') carregarConvocacoes();
      };
    }

    if (filtroStatus) {
      filtroStatus.onchange = carregarConvocacoes;
    }
  }
  
  // Função para mostrar o guia completo de envio
  function mostrarGuiaCompletoEnvio() {
    const modal = document.getElementById('modalGuiaCompletoEnvio');
    const conteudo = document.getElementById('conteudoGuiaCompleto');
    
    if (!modal || !conteudo) return;
    
    conteudo.innerHTML = `
      <div style="max-width: 900px; margin: 0 auto;">
        <!-- Introdução -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 24px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 32px;">📖</span>
            <span>Guia Completo: Envio de Convocações</span>
          </h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            Este guia explica como enviar convocações aos motoristas via <strong>WhatsApp Web</strong>. 
            O sistema utiliza o método manual para garantir controle total sobre cada mensagem.
          </p>
        </div>

        <!-- Método de Envio -->
        <div style="background: #fff; border: 3px solid #667eea; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
            <div style="font-size: 48px;">👤</div>
            <div>
              <h3 style="margin: 0; color: #667eea; font-size: 22px;">Envio via WhatsApp Web</h3>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Controle total sobre cada mensagem</p>
            </div>
          </div>
          
          <div style="background: #f0f9f4; border-left: 4px solid #25D366; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2e7d32; font-weight: 600;">✅ <strong>Vantagens:</strong></p>
            <ul style="margin: 10px 0 0 20px; color: #333; line-height: 1.8;">
              <li>Você <strong>revisa cada mensagem</strong> antes de enviar</li>
              <li>Pode personalizar a mensagem antes de enviar</li>
              <li>Não requer configuração adicional (funciona sempre)</li>
              <li>Ideal para <strong>pequenos volumes</strong> ou quando precisa de controle</li>
              <li>Permite interação direta com o motorista</li>
            </ul>
          </div>
          
          <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #1565C0; font-weight: 600;">📋 <strong>Envio Manual:</strong></p>
            <p style="margin: 0; color: #666; line-height: 1.6;">
              Para envio manual, clique no botão <strong>"📱 Abrir WhatsApp"</strong> de cada motorista na lista para abrir e enviar cada mensagem individualmente.
            </p>
          </div>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #856404; font-weight: 600;">💡 <strong>Dica:</strong></p>
            <p style="margin: 0; color: #333; line-height: 1.6;">
              O método manual oferece <strong>controle total</strong> sobre cada mensagem, permitindo revisar e personalizar antes de enviar.
            </p>
          </div>
        </div>


        <!-- Conclusão -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 22px;">✨ Pronto para começar!</h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            Agora você conhece como enviar convocações via WhatsApp Web. 
            Comece a enviar convocações de forma eficiente! 🚀
          </p>
        </div>
      </div>
    `;
    
    modal.style.display = 'flex';
    
    // Fechar ao clicar fora
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // Mostrar links WhatsApp das convocações carregadas
  async function mostrarLinksWhatsAppDasConvocacoes() {
    if (!convocacoes || convocacoes.length === 0) {
      showMessage('Nenhuma convocação carregada. Carregue as convocações primeiro.', 'warning');
      return;
    }

    try {
      showMessage('Preparando links com mensagens formatadas...', 'info');
      
      const urlBase = await obterUrlPublica();
      const linksWhatsApp = [];
      let semCelular = 0;
      let semConvocacao = 0;
      const motoristasSemCelular = []; // Lista de nomes dos motoristas sem celular

      // Agrupar convocações por viagem para buscar dados uma vez por viagem
      const viagensMap = new Map();
      
      for (const conv of convocacoes) {
        const nomeMotorista = conv.NOME_MOTORISTA || 'Motorista';
        
        if (!conv.CELULAR_MOTORISTA) {
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          continue;
        }

        // Limpar número
        let numeroLimpo = String(conv.CELULAR_MOTORISTA).replace(/\s+/g, '').replace(/[()\-\.]/g, '');
        if (!numeroLimpo.startsWith('55')) {
          if (numeroLimpo.startsWith('0')) {
            numeroLimpo = numeroLimpo.substring(1);
          }
          numeroLimpo = '55' + numeroLimpo;
        }

        if (numeroLimpo.length < 12) {
          semCelular++;
          motoristasSemCelular.push(nomeMotorista);
          continue;
        }

        // Buscar dados completos da viagem se ainda não tiver
        let viagemData = viagensMap.get(conv.IDVIAGEM);
        if (!viagemData) {
          try {
            const responseViagem = await fetch(`/api/viagens/${conv.IDVIAGEM}`);
            if (responseViagem.ok) {
              viagemData = await responseViagem.json();
              viagensMap.set(conv.IDVIAGEM, viagemData);
            }
          } catch (err) {
            console.error(`Erro ao buscar dados da viagem ${conv.IDVIAGEM}:`, err);
          }
        }

        // Gerar mensagem formatada completa (mesma lógica do enviarAnuncioWhatsApp)
        const linkConvocacao = `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
        const nomeMotoristaConvocacao = conv.NOME_MOTORISTA || 'Motorista';
        
        // Função para formatar data/hora (mesma lógica do prepararAnuncioCarga)
        const formatarDataHora = (dataHora) => {
          if (!dataHora) return 'Não informado';
          if (typeof dataHora === 'string') {
            let dataStr = dataHora.replace('Z', '');
            if (dataStr.includes('T')) {
              dataStr = dataStr.replace('T', ' ');
            }
            const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
              const [, year, month, day, hour, minute] = match;
              return `${day}/${month}/${year} ${hour}:${minute}`;
            }
          }
          try {
            const date = new Date(dataHora);
            if (isNaN(date.getTime())) return 'Data inválida';
            const dia = String(date.getUTCDate()).padStart(2, '0');
            const mes = String(date.getUTCMonth() + 1).padStart(2, '0');
            const ano = date.getUTCFullYear();
            const hora = String(date.getUTCHours()).padStart(2, '0');
            const minuto = String(date.getUTCMinutes()).padStart(2, '0');
            return `${dia}/${mes}/${ano} ${hora}:${minuto}`;
          } catch (err) {
            return 'Data inválida';
          }
        };

        // Gerar texto base do anúncio (mesmo formato do prepararAnuncioCarga)
        let textoBase = '';
        if (viagemData) {
          textoBase = `🚚 *CARGA DISPONÍVEL*\n\n`;
          textoBase += `🆔 *ID:* ${viagemData.IDVIAGEM || 'N/A'}\n`;
          textoBase += `📦 *Tipo:* ${viagemData.DSTIPOVIAGEM || viagemData.CDTIPOVIAGEM || 'Não informado'}\n`;
          textoBase += `🚛 *Classe:* ${viagemData.DSCLASSEFROTA || viagemData.CDCLASSEFROTA || 'Não informado'}\n`;
          textoBase += `🗺️ *Rota:* ${viagemData.DSROTEIRO ? `${viagemData.IDROTEIRO || ''} - ${viagemData.DSROTEIRO}` : (viagemData.IDROTEIRO ? `${viagemData.IDROTEIRO} - ` : '') + `${viagemData.ORIGEM_CIDADE || 'N/A'}/${viagemData.ORIGEM_ESTADO || 'N/A'} → ${viagemData.DESTINO_CIDADE || 'N/A'}/${viagemData.DESTINO_ESTADO || 'N/A'}`}\n\n`;
          textoBase += `⏰ *HORÁRIOS*\n`;
          textoBase += `📅 *Carregamento:* ${formatarDataHora(viagemData.DTPREVINICIO)}\n`;
          textoBase += `📅 *Descarga:* ${formatarDataHora(viagemData.DTPREVFINAL)}\n\n`;
          if (viagemData.FGRASTREADO === 'S') {
            textoBase += `✅ *REQUISITOS*\n`;
            textoBase += `✅ *Exige Veículo Rastreado:* SIM\n\n`;
          }
          textoBase += `👤 *CONTRATADOR*\n`;
          textoBase += `${viagemData.CONTRATADOR_NOME || viagemData.CDCONTRATADOR || 'Não informado'}\n\n`;
          textoBase += `💰 *VALORES*\n`;
          textoBase += `💵 *Frete:* R$ ${viagemData.VLFRETE ? parseFloat(viagemData.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
          textoBase += `📊 *Peso:* ${viagemData.PESO ? parseFloat(viagemData.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
          textoBase += `📦 *Cubagem:* ${viagemData.CUBAGEM ? parseFloat(viagemData.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\ \n`;
          if (viagemData.OBSERV) {
            textoBase += `\n📝 *DETALHES DA VIAGEM*\n`;
            textoBase += `${viagemData.OBSERV}\n`;
          }
        } else {
          // Fallback se não conseguir buscar dados da viagem
          textoBase = `🚚 *CARGA DISPONÍVEL*\n\n`;
          textoBase += `🆔 *ID:* ${conv.IDVIAGEM || 'N/A'}\n`;
          textoBase += `🚛 *Classe:* ${conv.DSCLASSEFROTA || 'N/A'}\n`;
          textoBase += `🗺️ *Rota:* ${conv.ORIGEM_CIDADE || 'N/A'}/${conv.ORIGEM_ESTADO || 'N/A'} → ${conv.DESTINO_CIDADE || 'N/A'}/${conv.DESTINO_ESTADO || 'N/A'}\n\n`;
        }

        // Personalizar mensagem para cada motorista
        const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
        
        // Verificar tipo de URL e adicionar instruções apropriadas
        const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
        let textoComLink;
        
        if (isLocalIP) {
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n💡 *Importante:*\n• Links locais não são clicáveis no WhatsApp\n• Copie o link acima (toque e segure)\n• Cole no navegador do celular\n• Certifique-se de estar na mesma rede Wi-Fi`;
        } else {
          // Para domínios públicos, link clicável
          textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
        }

        const linkWhatsApp = `https://wa.me/${numeroLimpo}?text=${encodeURIComponent(textoComLink)}`;

        const linkItem = {
          idConvocacao: conv.IDCONVOCACAO,
          motorista: conv.NOME_MOTORISTA || 'Motorista',
          celular: conv.CELULAR_MOTORISTA,
          link: linkWhatsApp
        };
        
        if (!linkItem.idConvocacao) {
          console.warn('Convocação sem IDCONVOCACAO:', conv);
        }
        
        linksWhatsApp.push(linkItem);
      }

      if (linksWhatsApp.length > 0) {
        mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, semConvocacao, motoristasSemCelular, []);
      } else {
        let mensagem = 'Nenhum WhatsApp disponível. ';
        if (semCelular > 0) {
          mensagem += `${semCelular} convocação(ões) sem celular válido: ${motoristasSemCelular.join(', ')}.`;
        }
        showMessage(mensagem, 'warning');
      }
    } catch (err) {
      console.error('Erro ao preparar links WhatsApp:', err);
      showMessage('Erro ao preparar links: ' + err.message, 'error');
    }
  }

  // Carregar e selecionar viagem na aba de Convocações (similar à aba Compatíveis)
  async function carregarEselecionarViagemConvocacoes(idViagem) {
    try {
      if (!idViagem) {
        return;
      }

      const filtroViagem = document.getElementById('filtroConvocacaoViagem');
      
      if (filtroViagem) {
        // Preencher o campo de filtro com o ID da viagem
        filtroViagem.value = String(idViagem);
        
        // Disparar evento para garantir que o valor foi atualizado
        filtroViagem.dispatchEvent(new Event('input', { bubbles: true }));
        filtroViagem.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Aguardar um pouco para garantir que o campo foi atualizado
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Carregar convocações automaticamente
        await carregarConvocacoes();
      }
    } catch (err) {
      console.error('Erro ao carregar viagem para convocações:', err);
      showMessage('Erro ao carregar convocações da viagem.', 'error');
    }
  }

  // Carregar convocações
  async function carregarConvocacoes() {
    try {
      showMessage('Carregando convocações...', 'info');
      
      const filtroViagem = document.getElementById('filtroConvocacaoViagem')?.value?.trim();
      const filtroStatus = document.getElementById('filtroConvocacaoStatus')?.value?.trim();
      
      let url = '/api/convocacoes';
      const params = [];
      if (filtroViagem) params.push(`idViagem=${encodeURIComponent(filtroViagem)}`);
      if (filtroStatus) params.push(`status=${encodeURIComponent(filtroStatus)}`);
      
      if (params.length > 0) {
        url += '?' + params.join('&');
      }
      
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Erro ao carregar convocações');
      }
      
      convocacoes = await response.json();
      
      await renderizarConvocacoes();
      
      if (convocacoes.length === 0) {
        let mensagem = 'Nenhuma convocação encontrada.';
        if (filtroViagem) {
          mensagem += ` (Filtro: Viagem ${filtroViagem}${filtroStatus ? `, Status: ${filtroStatus}` : ''})`;
        } else if (filtroStatus) {
          mensagem += ` (Filtro: Status ${filtroStatus})`;
        }
        showMessage(mensagem, 'warning');
      } else {
        showMessage(`${convocacoes.length} convocação(ões) encontrada(s).`, 'success');
      }
    } catch (err) {
      console.error('Erro ao carregar convocações:', err);
      showMessage('Erro ao carregar convocações: ' + err.message, 'error');
    }
  }

  // Renderizar grid de convocações
  async function renderizarConvocacoes() {
    const container = document.getElementById('convocacoesGrid');
    const btnVerLinks = document.getElementById('btnVerLinksWhatsAppConvocacoes');
    
    // Atualizar contador de registros
    const countEl = document.getElementById('convocacoesGridCountText');
    if (countEl) {
      const count = convocacoes.length || 0;
      countEl.textContent = `${count} registro(s) encontrado(s)`;
    }
    
    // Mostrar/ocultar botão "Ver Links WhatsApp"
    if (btnVerLinks) {
      if (convocacoes.length > 0) {
        btnVerLinks.style.display = 'inline-block';
      } else {
        btnVerLinks.style.display = 'none';
      }
    }
    
    if (convocacoes.length === 0) {
      container.innerHTML = '<p class="empty">Nenhuma convocação encontrada.</p>';
      return;
    }

    // Obter URL base pública (para funcionar no celular)
    const urlBase = await obterUrlPublica();
    
    // Função para obter ícone de ordenação
    const getSortIcon = (campo) => {
      if (ordenacaoConvocacoes.campo !== campo) {
        return '<span style="color: #ccc; font-size: 0.8em;">⇅</span>';
      }
      return ordenacaoConvocacoes.direcao === 'asc' 
        ? '<span style="color: #667eea; font-size: 0.8em;">↑</span>'
        : '<span style="color: #667eea; font-size: 0.8em;">↓</span>';
    };
    
    let html = `
      <div id="legendaGrid" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 15px; align-items: center;">
        <div style="font-weight: 600; color: #495057; margin-right: 10px;">Legenda:</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">🔗</span>
          <span><strong>Link da convocação</strong></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">🗺️</span>
          <span><strong>Ver Motorista no Mapa</strong></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #28a745;">✅</span>
          <span><strong>Confirmar Convocação</strong></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #ff9800;">🔄</span>
          <span><strong>Reativar Convocação</strong></span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #dc3545;">⚠️</span>
          <span><strong>Histórico de Reabertura</strong></span>
        </div>
      </div>
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <thead>
          <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
            <th style="padding: 12px; text-align: left; width: 60px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('id')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              ID ${getSortIcon('id')}
            </th>
            <th style="padding: 12px; text-align: left; width: 100px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('viagem')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Viagem ${getSortIcon('viagem')}
            </th>
            <th style="padding: 12px; text-align: left; width: 100px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('rota')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Rota ${getSortIcon('rota')}
            </th>
            <th style="padding: 12px; text-align: left; width: 120px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('status')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Status ${getSortIcon('status')}
            </th>
            <th style="padding: 12px; text-align: left; width: 180px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('motorista')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Motorista ${getSortIcon('motorista')}
            </th>
            <th style="padding: 12px; text-align: left; width: 70px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('dataConvocacao')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Convocação ${getSortIcon('dataConvocacao')}
            </th>
            <th style="padding: 12px; text-align: left; width: 70px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('dataAcesso')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Acesso ${getSortIcon('dataAcesso')}
            </th>
            <th style="padding: 12px; text-align: left; width: 70px; cursor: pointer; user-select: none;" 
                onclick="ordenarConvocacoes('dataResposta')" 
                onmouseover="this.style.background='#e8e8e8'" 
                onmouseout="this.style.background='#f5f5f5'">
              Resposta ${getSortIcon('dataResposta')}
            </th>
            <th style="padding: 12px; text-align: left; width: 110px;">Ações</th>
          </tr>
        </thead>
        <tbody>
    `;

    // Funções auxiliares (definidas uma vez, fora do loop)
    const criarIndicadorGeolocalizacao = (latitude, longitude) => {
      const temLocalizacao = latitude !== null && latitude !== undefined && 
                             longitude !== null && longitude !== undefined &&
                             !isNaN(latitude) && !isNaN(longitude);
      
      const classe = temLocalizacao ? 'has-location' : 'no-location';
      const titulo = temLocalizacao 
        ? 'Localização capturada - Motorista colaborou' 
        : 'Localização não capturada - Motorista não colaborou';
      
      return `<span class="geoloc-indicator ${classe}" title="${titulo}"></span>`;
    };

    const criarLinkWhatsApp = (celular) => {
      if (!celular) return '-';
      
      // Limpar número: remover espaços, parênteses, hífens, pontos
      let numeroLimpo = String(celular).replace(/\s+/g, '').replace(/[()\-\.]/g, '');
      
      // Se não começar com 55 (código do Brasil), adicionar
      if (!numeroLimpo.startsWith('55')) {
        // Se começar com 0, remover o 0
        if (numeroLimpo.startsWith('0')) {
          numeroLimpo = numeroLimpo.substring(1);
        }
        numeroLimpo = '55' + numeroLimpo;
      }
      
      // Validar se tem pelo menos 12 dígitos (55 + DDD + número)
      if (numeroLimpo.length < 12) {
        return celular; // Retornar número original se inválido
      }
      
      const urlWhatsApp = `https://wa.me/${numeroLimpo}`;
      
      // Formatar número para exibição (com parênteses e hífen)
      let celularFormatado = '';
      if (numeroLimpo && numeroLimpo.length >= 12) {
        // Remover código do país (55) para formatação
        let numeroParaFormatar = numeroLimpo.substring(2); // Remove o 55
        if (numeroParaFormatar.length === 11) {
          // Formato: (41) 99837-1769
          celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 7)}-${numeroParaFormatar.substring(7)}`;
        } else if (numeroParaFormatar.length === 10) {
          // Formato: (41) 9837-1769
          celularFormatado = `(${numeroParaFormatar.substring(0, 2)}) ${numeroParaFormatar.substring(2, 6)}-${numeroParaFormatar.substring(6)}`;
        } else {
          celularFormatado = numeroParaFormatar;
        }
      } else {
        celularFormatado = celular;
      }
      
      return `<a href="${urlWhatsApp}" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style="color: #25D366; text-decoration: none; font-weight: 500; font-size: 11px;"
                  title="Abrir WhatsApp">
                  ${celularFormatado}
                </a>`;
    };

    const formatarData = (data) => {
      if (!data) return '-';
      
      // SQL Server retorna datas no formato ISO: 2025-11-21T10:39:24.123Z
      // Quando o JavaScript cria new Date(), ele interpreta como UTC e converte para o fuso local
      // Precisamos tratar a string diretamente para evitar conversão de fuso
      
      if (typeof data === 'string') {
        // Remover o Z se existir e tratar como data local
        let dataStr = data.replace('Z', '');
        
        // Se tem T, substituir por espaço
        if (dataStr.includes('T')) {
          dataStr = dataStr.replace('T', ' ');
        }
        
        // Extrair partes da data: 2025-11-21 10:39:24.123
        const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          const [, year, month, day, hour, minute, second] = match;
          // Criar data no fuso local (sem conversão UTC)
          const d = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second || 0)
          );
          
          // Formatar manualmente para pt-BR (sem conversão de fuso)
          const diaStr = String(day).padStart(2, '0');
          const mesStr = String(month).padStart(2, '0');
          const anoStr = year;
          const horaStr = String(hour).padStart(2, '0');
          const minutoStr = String(minute).padStart(2, '0');
          
          return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
        }
      }
      
      // Fallback: extrair componentes UTC e tratar como local (sem conversão de fuso)
      try {
        const date = new Date(data);
        if (isNaN(date.getTime())) return '-';
        
        // Extrair componentes UTC e tratar como local (sem conversão de fuso)
        const ano = date.getUTCFullYear();
        const mes = date.getUTCMonth();
        const dia = date.getUTCDate();
        const hora = date.getUTCHours();
        const minuto = date.getUTCMinutes();
        const segundo = date.getUTCSeconds();
        
        // Formatar manualmente para pt-BR
        const diaStr = String(dia).padStart(2, '0');
        const mesStr = String(mes + 1).padStart(2, '0');
        const anoStr = ano;
        const horaStr = String(hora).padStart(2, '0');
        const minutoStr = String(minuto).padStart(2, '0');
        const segundoStr = String(segundo).padStart(2, '0');
        
        return `${diaStr}/${mesStr}/${anoStr}, ${horaStr}:${minutoStr}:${segundoStr}`;
      } catch (err) {
        return '-';
      }
    };

    // Buscar histórico de reabertura para todas as convocações (em paralelo)
    const historicosPromises = convocacoes.map(async (conv) => {
      try {
        const response = await fetch(`/api/convocacoes/${conv.IDCONVOCACAO}/historico-reabertura`);
        if (response.ok) {
          const historico = await response.json();
          return { idConvocacao: conv.IDCONVOCACAO, historico: historico.length > 0 ? historico : null };
        }
        return { idConvocacao: conv.IDCONVOCACAO, historico: null };
      } catch (err) {
        console.error(`Erro ao buscar histórico para convocação ${conv.IDCONVOCACAO}:`, err);
        return { idConvocacao: conv.IDCONVOCACAO, historico: null };
      }
    });
    
    const historicosResult = await Promise.all(historicosPromises);
    const historicosMap = {};
    historicosResult.forEach(h => {
      historicosMap[h.idConvocacao] = h.historico;
    });
    
    convocacoes.forEach((conv, index) => {
      // Verificar se tem histórico de reabertura (qualquer motivo)
      const historico = historicosMap[conv.IDCONVOCACAO];
      const temHistoricoReabertura = historico && historico.length > 0;
      // Pegar o motivo mais recente (primeiro do array, pois está ordenado DESC)
      const motivoReabertura = temHistoricoReabertura && historico[0] ? historico[0].MOTIVO_REABERTURA : null;
      
      let statusClass = '';
      let statusDisplay = conv.STATUS || 'PENDENTE';
      
      if (conv.STATUS === 'PENDENTE') {
        statusClass = 'background: #fff3cd; color: #856404;';
      } else if (conv.STATUS === 'ACEITA') {
        statusClass = 'background: #d4edda; color: #155724;';
      } else if (conv.STATUS === 'ACEITA_DESCARTADA') {
        statusClass = 'background: #ffeaa7; color: #856404;';
        statusDisplay = 'ACEITA (Não Selecionada)';
      } else if (conv.STATUS === 'RECUSADA') {
        statusClass = 'background: #f8d7da; color: #721c24;';
        // Adicionar motivo da recusa ao status se existir
        if (conv.MOTIVO_RECUSA) {
          statusDisplay = `RECUSADA - ${conv.MOTIVO_RECUSA}`;
        } else if (conv.CDMOTIVORECUSA) {
          statusDisplay = `RECUSADA (Motivo: ${conv.CDMOTIVORECUSA})`;
        }
      } else if (conv.STATUS === 'CONFIRMADA') {
        statusClass = 'background: #cce5ff; color: #004085;';
      }
      
      const linkConvocacao = `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
      
      // Verificar se tem localização para mostrar botão "Ver no Mapa"
      const temLocalizacao = conv.LATITUDE !== null && conv.LATITUDE !== undefined && 
                            conv.LONGITUDE !== null && conv.LONGITUDE !== undefined &&
                            !isNaN(conv.LATITUDE) && !isNaN(conv.LONGITUDE);
      
      // Botão de ações (apenas ícones, sem texto)
      let botoesAcoes = `
        <a href="${linkConvocacao}" target="_blank" class="btn" style="padding: 8px 10px; font-size: 1.2em; background: #2196F3; color: white; text-decoration: none; border-radius: 4px; margin-right: 5px; display: inline-flex; align-items: center; justify-content: center; min-width: 36px;" title="Ver Link">
          🔗
        </a>
      `;
      
      // Botão "Ver no Mapa" apenas se tiver localização
      if (temLocalizacao && conv.IDROTEIRO) {
        botoesAcoes += `
          <button onclick="abrirMapaMotorista(${conv.IDCONVOCACAO}, ${conv.LATITUDE}, ${conv.LONGITUDE}, ${conv.IDROTEIRO}, ${conv.IDVIAGEM})" 
                  class="btn" 
                  style="padding: 8px 10px; font-size: 1.2em; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 5px; display: inline-flex; align-items: center; justify-content: center; min-width: 36px;"
                  title="Ver no Mapa">
            🗺️
          </button>
        `;
      }
      
      // Botão "Confirmar" apenas para convocações ACEITA
      if (conv.STATUS === 'ACEITA') {
        botoesAcoes += `
          <button onclick="confirmarConvocacao(${conv.IDCONVOCACAO})" class="btn" style="padding: 8px 10px; font-size: 1.2em; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 36px;" title="Confirmar">
            ✅
          </button>
        `;
      }
      
      // Botão "Reativar" apenas para convocações CONFIRMADA
      // As ACEITA_DESCARTADA serão atualizadas automaticamente quando a CONFIRMADA for reativada
      if (conv.STATUS === 'CONFIRMADA') {
        botoesAcoes += `
          <button onclick="reativarConvocacao(${conv.IDCONVOCACAO})" class="btn" style="padding: 8px 10px; font-size: 1.2em; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; min-width: 36px; margin-left: 5px;" title="Reativar Convocação">
            🔄
          </button>
        `;
      }

      // Destacar visualmente se for PENDENTE mas viagem já foi confirmada
      const isPendenteMasConfirmada = conv.STATUS === 'PENDENTE' && conv.VIAGEM_JA_CONFIRMADA === 1;
      const rowStyle = isPendenteMasConfirmada 
        ? 'border-left: 4px solid #667eea; background: #f0f4ff !important;' 
        : (index % 2 === 0 ? 'background: #fafafa;' : '');
      
      html += `
        <tr style="border-bottom: 1px solid #eee; ${rowStyle}">
          <td style="padding: 12px;">${conv.IDCONVOCACAO}</td>
          <td style="padding: 12px;">
            <strong>${conv.IDVIAGEM}</strong><br>
            <small style="color: #666;">${conv.DSCLASSEFROTA || '-'}</small>
          </td>
          <td style="padding: 12px;">
            ${conv.ORIGEM_CIDADE || '-'}/${conv.ORIGEM_ESTADO || '-'}<br>
            <small style="color: #666;">→ ${conv.DESTINO_CIDADE || '-'}/${conv.DESTINO_ESTADO || '-'}</small>
          </td>
          <td style="padding: 12px;">
            ${criarIndicadorGeolocalizacao(conv.LATITUDE, conv.LONGITUDE)}
            <span style="padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; ${statusClass}">
              ${statusDisplay}
            </span>
            ${isPendenteMasConfirmada ? '<br><small style="color: #667eea; font-weight: 600; margin-top: 4px; display: block;">⚠️ Viagem já confirmada</small>' : ''}
            ${temHistoricoReabertura && motivoReabertura ? `<br><small style="color: #dc3545; font-weight: 600; margin-top: 4px; display: block;">⚠️ Histórico de Reabertura: ${motivoReabertura}</small>` : ''}
          </td>
          <td style="padding: 12px;">
            ${conv.NOME_MOTORISTA || '-'}<br>
            <small style="color: #666;">${conv.CELULAR_MOTORISTA && conv.CELULAR_MOTORISTA !== 'N/A' && conv.CELULAR_MOTORISTA !== '-' ? '📱 ' : ''}${criarLinkWhatsApp(conv.CELULAR_MOTORISTA)}</small>
          </td>
          <td style="padding: 12px; font-size: 12px;">${formatarData(conv.DHCONVOCACAO)}</td>
          <td style="padding: 12px; font-size: 12px;">
            ${conv.DHACESSO 
              ? `<div style="display: flex; align-items: center; gap: 6px;">
                   <span style="color: #28a745; font-size: 16px;">✅</span>
                   <div>
                     <div style="color: #28a745; font-weight: 600; font-size: 12px;">Acessou</div>
                     <small style="color: #666; font-size: 10px;">${formatarData(conv.DHACESSO)}</small>
                   </div>
                 </div>` 
              : `<div style="display: flex; align-items: center; gap: 6px;">
                   <span style="color: #dc3545; font-size: 16px;">❌</span>
                   <div>
                     <div style="color: #dc3545; font-weight: 600; font-size: 12px;">Não acessou</div>
                     <small style="color: #999; font-size: 10px;">Aguardando</small>
                   </div>
                 </div>`}
          </td>
          <td style="padding: 12px; font-size: 12px;">${formatarData(conv.DHRESPOSTA)}</td>
          <td style="padding: 12px;">
            ${botoesAcoes}
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
  }

  // Confirmar convocação (muda para CONFIRMADA e recusa outras da mesma viagem)
  window.confirmarConvocacao = async function(idConvocacao) {
    if (!idConvocacao) {
      showMessage('ID da convocação não informado.', 'error');
      return;
    }

    // Buscar dados da convocação para mostrar no modal
    const convocacao = convocacoes.find(c => c.IDCONVOCACAO === idConvocacao);
    if (!convocacao) {
      showMessage('Convocação não encontrada.', 'error');
      return;
    }

    if (convocacao.STATUS !== 'ACEITA') {
      showMessage('Apenas convocações com status ACEITA podem ser confirmadas.', 'error');
      return;
    }

    // Verificar se já existe outra convocação confirmada para a mesma viagem
    const jaConfirmada = convocacoes.find(c => 
      c.IDVIAGEM === convocacao.IDVIAGEM && 
      c.IDCONVOCACAO !== idConvocacao && 
      c.STATUS === 'CONFIRMADA'
    );

    if (jaConfirmada) {
      showMessage('Já existe uma convocação confirmada para esta viagem. Não é possível confirmar outra.', 'error');
      return;
    }

    // Contar outras convocações ACEITAS
    const outrasAceitas = convocacoes.filter(c => 
      c.IDVIAGEM === convocacao.IDVIAGEM && 
      c.IDCONVOCACAO !== idConvocacao && 
      c.STATUS === 'ACEITA'
    ).length;
    
    // Mostrar modal de confirmação personalizado
    let mensagemAtencao = '';
    if (outrasAceitas > 0) {
      mensagemAtencao = `
        <p style="color: #856404; font-weight: 600; margin-top: 15px;">
          ⚠️ ATENÇÃO:
        </p>
        <p style="color: #856404; margin-top: 10px;">
          <strong>${outrasAceitas}</strong> convocação(ões) ACEITA(S) será(ão) marcada(s) como "ACEITA (Não Selecionada)" - mantendo o histórico de que o motorista aceitou.
        </p>
        <p style="color: #666; margin-top: 10px; font-size: 13px; font-style: italic;">
          ℹ️ Convocações PENDENTE permanecerão como PENDENTE para preservar o histórico correto. Apenas convocações realmente RECUSADAS pelo motorista ficam como RECUSADA.
        </p>
      `;
    }
    
    const mensagemCompleta = `
      <div style="text-align: left; line-height: 1.8;">
        <p><strong>Viagem:</strong> ${convocacao.IDVIAGEM}</p>
        <p><strong>Motorista:</strong> ${convocacao.NOME_MOTORISTA || 'N/A'}</p>
        ${mensagemAtencao}
      </div>
    `;
    
    // Buscar e mostrar validades do motorista antes de confirmar
    const cdMotorista = convocacao.CDCADASTRO_MOTORISTA;
    if (cdMotorista) {
      try {
        await mostrarValidadesMotorista(cdMotorista, convocacao.NOME_MOTORISTA || 'Motorista');
      } catch (err) {
        console.error('Erro ao carregar validades do motorista:', err);
        // Continuar mesmo se houver erro ao carregar validades
      }
    }
    
    const confirmado = await showConfirmModal(
      '✅ Confirmar Convocação',
      mensagemCompleta
    );

    if (!confirmado) {
      return;
    }
    
    // Método de envio: sempre manual
    const metodoEnvio = 'manual';

    try {
      showMessage('Confirmando convocação...', 'info');

      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';

      const response = await fetch(`/api/convocacoes/${idConvocacao}/confirmar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        }
      });

      if (!response.ok) {
        let errorMessage = 'Erro ao confirmar convocação';
        try {
          const error = await response.json();
          errorMessage = error.error || error.message || errorMessage;
          if (error.details) {
            errorMessage += `: ${error.details}`;
          }
        } catch (e) {
          // Se não conseguir parsear JSON, usar status text
          errorMessage = `Erro ${response.status}: ${response.statusText || 'Erro ao confirmar convocação'}`;
        }
        throw new Error(errorMessage);
      }

      let result;
      try {
        result = await response.json();
      } catch (e) {
        console.error('Erro ao parsear resposta:', e);
        throw new Error('Erro ao processar resposta do servidor');
      }
      
      // Método manual: abrir WhatsApp
      // Usando método MANUAL (WhatsApp Web)
      if (result.whatsappLink) {
        showMessage(result.message || 'Convocação confirmada com sucesso! WhatsApp será aberto para o motorista selecionado.', 'success');
        
        // Aguardar um pouco antes de abrir WhatsApp
        setTimeout(() => {
          const opened = window.open(result.whatsappLink, '_blank');
          if (!opened) {
            console.warn('Falha ao abrir WhatsApp. Pode estar bloqueado pelo navegador.');
            showMessage('Convocação confirmada! Mas não foi possível abrir o WhatsApp automaticamente. Link: ' + result.whatsappLink, 'info');
          }
        }, 500);
      } else {
        showMessage(result.message || 'Convocação confirmada com sucesso!', 'success');
      }

      // Recarregar a lista de convocações
      await carregarConvocacoes();
    } catch (err) {
      console.error('Erro ao confirmar convocação:', err);
      showMessage('Erro ao confirmar convocação: ' + err.message, 'error');
    }
  };

  // Mostrar validades do motorista
  window.mostrarValidadesMotorista = async function(cdMotorista, nomeMotorista) {
    const modal = document.getElementById('modalValidadesMotorista');
    const conteudo = document.getElementById('modalValidadesMotoristaConteudo');
    const subtitulo = document.getElementById('modalValidadesMotoristaSubtitulo');
    const titulo = document.querySelector('#modalValidadesMotorista h3');
    
    if (!modal || !conteudo) {
      console.error('Modal de validades não encontrado');
      return;
    }
    
    // Configurar event listeners do botão fechar (garantir que funcione)
    const btnFechar = document.getElementById('btnFecharModalValidadesMotorista');
    if (btnFechar) {
      // Remover listeners anteriores para evitar duplicação
      const novoBtnFechar = btnFechar.cloneNode(true);
      btnFechar.parentNode.replaceChild(novoBtnFechar, btnFechar);
      
      // Adicionar novo listener
      novoBtnFechar.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    
    // Fechar ao clicar fora do modal
    const fecharAoClicarFora = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        modal.removeEventListener('click', fecharAoClicarFora);
      }
    };
    modal.addEventListener('click', fecharAoClicarFora);
    
    // Atualizar título e subtítulo
    if (titulo) {
      titulo.textContent = '📋 Validades do Motorista';
    }
    if (subtitulo) {
      subtitulo.textContent = `${nomeMotorista} • Código: ${cdMotorista}`;
    }
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    // Mostrar loading
    conteudo.innerHTML = '<div style="text-align: center; padding: 40px; color: #6c757d;">Carregando validades...</div>';
    
    try {
      // Buscar validades do motorista (tipo MOT = Motorista)
      const response = await fetch(`/api/validades/MOT/${cdMotorista}`);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar validades: ${response.status}`);
      }
      
      const validades = await response.json();
      
      // Renderizar validades
      if (!validades || validades.length === 0) {
        conteudo.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #6c757d;">
            <p style="font-size: 16px; margin-bottom: 10px;">📋 Nenhuma validade cadastrada para este motorista.</p>
            <p style="font-size: 13px; color: #95a5a6;">Este motorista não possui validades cadastradas no sistema.</p>
          </div>
        `;
        return;
      }
      
      let html = '<div style="display: grid; gap: 12px;">';
      
      validades.forEach(val => {
        const dtLib = new Date(val.DTLIBERACAO).toLocaleDateString('pt-BR');
        const dtVal = new Date(val.DTVALIDADE).toLocaleDateString('pt-BR');
        const dias = val.DIAS_RESTANTES;
        
        let corStatus = '#27ae60';
        let textoStatus = `✓ Válida (${dias} dias)`;
        
        if (val.STATUS_VALIDADE === 'VENCIDA') {
          corStatus = '#e74c3c';
          textoStatus = `✗ VENCIDA (${Math.abs(dias)} dias atrás)`;
        } else if (val.STATUS_VALIDADE === 'VENCENDO') {
          corStatus = '#f39c12';
          textoStatus = `⚠ Vencendo (${dias} dias)`;
        }
        
        html += `
          <div style="background: #fff; border: 1px solid #dee2e6; border-left: 4px solid ${corStatus}; border-radius: 6px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="flex: 1;">
                <strong style="font-size: 15px; color: #2c3e50; display: block; margin-bottom: 6px;">${val.DSTIPOVALIDADE}</strong>
                <div style="font-size: 12px; color: #6c757d;">
                  <span style="background: ${corStatus}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; margin-right: 8px;">
                    ${textoStatus}
                  </span>
                  <span>Nº <strong>${val.NRLIBERACAO}</strong></span>
                  ${val.CERTIFICADORA_NOME ? ` • Certif: <strong>${val.CERTIFICADORA_NOME}</strong>` : ''}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 20px; padding-top: 10px; border-top: 1px solid #f0f0f0; font-size: 12px;">
              <div>
                <span style="color: #95a5a6;">📅 Liberação:</span> <strong style="color: #2c3e50;">${dtLib}</strong>
              </div>
              <div>
                <span style="color: #95a5a6;">⏰ Validade:</span> <strong style="color: ${corStatus};">${dtVal}</strong>
              </div>
              ${val.DSLIBERACAO ? `<div style="flex: 1;"><span style="color: #95a5a6;">📝 Obs:</span> <strong style="color: #6c757d;">${val.DSLIBERACAO}</strong></div>` : ''}
            </div>
          </div>
        `;
      });
      
      html += '</div>';
      conteudo.innerHTML = html;
      
    } catch (err) {
      console.error('Erro ao carregar validades:', err);
      conteudo.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <p style="font-size: 16px; margin-bottom: 10px;">❌ Erro ao carregar validades</p>
          <p style="font-size: 13px; color: #95a5a6;">${err.message || 'Não foi possível carregar as validades do motorista.'}</p>
        </div>
      `;
    }
  };
  
  // Mostrar validades do veículo
  window.mostrarValidadesVeiculo = async function(idequipamento, nomeVeiculo) {
    const modal = document.getElementById('modalValidadesMotorista');
    const conteudo = document.getElementById('modalValidadesMotoristaConteudo');
    const subtitulo = document.getElementById('modalValidadesMotoristaSubtitulo');
    const titulo = document.querySelector('#modalValidadesMotorista h3');
    
    if (!modal || !conteudo) {
      console.error('Modal de validades não encontrado');
      return;
    }
    
    // Configurar event listeners do botão fechar (garantir que funcione)
    const btnFechar = document.getElementById('btnFecharModalValidadesMotorista');
    if (btnFechar) {
      // Remover listeners anteriores para evitar duplicação
      const novoBtnFechar = btnFechar.cloneNode(true);
      btnFechar.parentNode.replaceChild(novoBtnFechar, btnFechar);
      
      // Adicionar novo listener
      novoBtnFechar.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    }
    
    // Fechar ao clicar fora do modal
    const fecharAoClicarFora = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
        modal.removeEventListener('click', fecharAoClicarFora);
      }
    };
    modal.addEventListener('click', fecharAoClicarFora);
    
    // Atualizar título e subtítulo
    if (titulo) {
      titulo.textContent = '📋 Validades do Veículo';
    }
    if (subtitulo) {
      subtitulo.textContent = `${nomeVeiculo} • Código: ${idequipamento}`;
    }
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    // Mostrar loading
    conteudo.innerHTML = '<div style="text-align: center; padding: 40px; color: #6c757d;">Carregando validades...</div>';
    
    try {
      // Buscar validades do veículo (tipo EQP = Equipamento)
      const response = await fetch(`/api/validades/EQP/${idequipamento}`);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar validades: ${response.status}`);
      }
      
      const validades = await response.json();
      
      // Renderizar validades
      if (!validades || validades.length === 0) {
        conteudo.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #6c757d;">
            <p style="font-size: 16px; margin-bottom: 10px;">📋 Nenhuma validade cadastrada para este veículo.</p>
            <p style="font-size: 13px; color: #95a5a6;">Este veículo não possui validades cadastradas no sistema.</p>
          </div>
        `;
        return;
      }
      
      let html = '<div style="display: grid; gap: 12px;">';
      
      validades.forEach(val => {
        const dtLib = new Date(val.DTLIBERACAO).toLocaleDateString('pt-BR');
        const dtVal = new Date(val.DTVALIDADE).toLocaleDateString('pt-BR');
        const dias = val.DIAS_RESTANTES;
        
        let corStatus = '#27ae60';
        let textoStatus = `✓ Válida (${dias} dias)`;
        
        if (val.STATUS_VALIDADE === 'VENCIDA') {
          corStatus = '#e74c3c';
          textoStatus = `✗ VENCIDA (${Math.abs(dias)} dias atrás)`;
        } else if (val.STATUS_VALIDADE === 'VENCENDO') {
          corStatus = '#f39c12';
          textoStatus = `⚠ Vencendo (${dias} dias)`;
        }
        
        html += `
          <div style="background: #fff; border: 1px solid #dee2e6; border-left: 4px solid ${corStatus}; border-radius: 6px; padding: 14px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.06);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <div style="flex: 1;">
                <strong style="font-size: 15px; color: #2c3e50; display: block; margin-bottom: 6px;">${val.DSTIPOVALIDADE}</strong>
                <div style="font-size: 12px; color: #6c757d;">
                  <span style="background: ${corStatus}; color: white; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600; margin-right: 8px;">
                    ${textoStatus}
                  </span>
                  <span>Nº <strong>${val.NRLIBERACAO}</strong></span>
                  ${val.CERTIFICADORA_NOME ? ` • Certif: <strong>${val.CERTIFICADORA_NOME}</strong>` : ''}
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 20px; padding-top: 10px; border-top: 1px solid #f0f0f0; font-size: 12px;">
              <div>
                <span style="color: #95a5a6;">📅 Liberação:</span> <strong style="color: #2c3e50;">${dtLib}</strong>
              </div>
              <div>
                <span style="color: #95a5a6;">⏰ Validade:</span> <strong style="color: ${corStatus};">${dtVal}</strong>
              </div>
              ${val.DSLIBERACAO ? `<div style="flex: 1;"><span style="color: #95a5a6;">📝 Obs:</span> <strong style="color: #6c757d;">${val.DSLIBERACAO}</strong></div>` : ''}
            </div>
          </div>
        `;
      });
      
      html += '</div>';
      conteudo.innerHTML = html;
      
    } catch (err) {
      console.error('Erro ao carregar validades:', err);
      conteudo.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #e74c3c;">
          <p style="font-size: 16px; margin-bottom: 10px;">❌ Erro ao carregar validades</p>
          <p style="font-size: 13px; color: #95a5a6;">${err.message || 'Não foi possível carregar as validades do veículo.'}</p>
        </div>
      `;
    }
  };

  // Event listener para fechar modal de validades (backup caso o modal já exista no DOM)
  document.addEventListener('DOMContentLoaded', () => {
    const btnFechar = document.getElementById('btnFecharModalValidadesMotorista');
    const modal = document.getElementById('modalValidadesMotorista');
    
    if (btnFechar && modal) {
      btnFechar.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        modal.style.display = 'none';
      });
      
      // Fechar ao clicar fora do modal
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    }
  });

  // Reativar convocação (reverter CONFIRMADA ou ACEITA_DESCARTADA para ACEITA)
  window.reativarConvocacao = async function(idConvocacao) {
    if (!idConvocacao) {
      showMessage('ID da convocação não informado.', 'error');
      return;
    }

    // Buscar dados da convocação
    const convocacao = convocacoes.find(c => c.IDCONVOCACAO === idConvocacao);
    if (!convocacao) {
      showMessage('Convocação não encontrada.', 'error');
      return;
    }

    if (convocacao.STATUS !== 'CONFIRMADA') {
      showMessage(`Apenas convocações com status CONFIRMADA podem ser reativadas. Status atual: ${convocacao.STATUS}`, 'error');
      return;
    }

    try {
      // Carregar motivos de reabertura
      const responseMotivos = await fetch('/api/motivos-reabertura-combo');
      if (!responseMotivos.ok) {
        throw new Error('Erro ao carregar motivos de reabertura');
      }
      const motivos = await responseMotivos.json();

      if (motivos.length === 0) {
        showMessage('Nenhum motivo de reabertura cadastrado. Contate o administrador.', 'error');
        return;
      }

      // Criar opções do select
      let opcoesMotivos = '<option value="">Selecione o motivo da reabertura...</option>';
      motivos.forEach(motivo => {
        opcoesMotivos += `<option value="${motivo.CDMOTIVO}">${motivo.DSMOTIVO}</option>`;
      });

      const mensagemModal = `
        <div style="text-align: left; line-height: 1.8;">
          <p><strong>Viagem:</strong> ${convocacao.IDVIAGEM}</p>
          <p><strong>Motorista:</strong> ${convocacao.NOME_MOTORISTA || 'N/A'}</p>
          <p><strong>Status Atual:</strong> CONFIRMADA</p>
          <div style="margin-top: 20px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #856404;">
              ⚠️ ATENÇÃO:
            </p>
            <p style="margin: 0; color: #856404; font-size: 14px;">
              Esta convocação será reativada e o status voltará para <strong>ACEITA</strong>.<br>
              <strong>As outras convocações ACEITA (Não Selecionada) da mesma viagem também serão reativadas automaticamente.</strong>
            </p>
          </div>
          <div style="margin-top: 20px;">
            <label for="selectMotivoReabertura" style="display: block; margin-bottom: 10px; font-weight: 600; color: #333;">
              📋 Selecione o motivo da reabertura: *
            </label>
            <select id="selectMotivoReabertura" style="width: 100%; padding: 12px; border: 2px solid #ddd; border-radius: 8px; font-size: 16px; background: white; appearance: none; -webkit-appearance: none; -moz-appearance: none; background-image: url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23667eea%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-6.5%200-12.1%203.2-15.2%208.1-3.1%204.9-3.1%2010.8%200%2015.8l128%20128c3.2%203.2%207.1%204.7%2011.1%204.7s7.9-1.6%2011.1-4.7l128-128c3.1-5%203.1-10.9%200-15.8z%22%2F%3E%3C%2Fsvg%3E'); background-repeat: no-repeat; background-position: right 12px center; background-size: 12px; cursor: pointer; transition: border-color 0.3s, box-shadow 0.3s;">
              ${opcoesMotivos}
            </select>
            <p id="erroMotivoReabertura" style="color: #dc3545; font-size: 14px; margin-top: 5px; display: none;">
              Por favor, selecione um motivo.
            </p>
          </div>
        </div>
      `;

      const confirmado = await showConfirmModal(
        '🔄 Reativar Convocação',
        mensagemModal
      );

      if (!confirmado) {
        return;
      }

      // Validar motivo selecionado
      const selectMotivo = document.getElementById('selectMotivoReabertura');
      const erroMotivo = document.getElementById('erroMotivoReabertura');
      
      if (!selectMotivo || !selectMotivo.value || selectMotivo.value === '') {
        if (erroMotivo) erroMotivo.style.display = 'block';
        if (selectMotivo) selectMotivo.focus();
        return;
      }

      const motivoReabertura = selectMotivo.value;

      // Obter usuário logado
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';

      showMessage('Reativando convocação...', 'info');

      const response = await fetch(`/api/convocacoes/${idConvocacao}/reativar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'user-login': userLogin
        },
        body: JSON.stringify({ motivoReabertura })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao reativar convocação');
      }

      const result = await response.json();
      
      // Verificar se o motivo foi "Motorista Desistiu da Carga"
      const motivoDesistiu = result.motivo === 'Motorista Desistiu da Carga';
      
      // Buscar todas as convocações da mesma viagem para filtrar quais devem receber mensagem
      const responseConvocacoes = await fetch(`/api/convocacoes?idViagem=${result.idViagem}`);
      if (!responseConvocacoes.ok) {
        throw new Error('Erro ao buscar convocações da viagem');
      }
      const todasConvocacoes = await responseConvocacoes.json();
      
      // Filtrar convocações que devem receber mensagem novamente
      const convocacoesParaEnviar = todasConvocacoes.filter(conv => {
        // Excluir RECUSADAS
        if (conv.STATUS === 'RECUSADA') {
          return false;
        }
        
        // Se o motivo da reativação atual foi "Motorista Desistiu da Carga", 
        // excluir a convocação que foi reativada (agora está ACEITA)
        if (motivoDesistiu && conv.IDCONVOCACAO === idConvocacao && conv.STATUS === 'ACEITA') {
          return false;
        }
        
        // Incluir ACEITA_DESCARTADA (aceitaram mas não foram selecionados)
        if (conv.STATUS === 'ACEITA_DESCARTADA' || conv.STATUS === 'ACEITA') {
          return true;
        }
        
        // Incluir PENDENTE (nem viram ainda)
        if (conv.STATUS === 'PENDENTE') {
          return true;
        }
        
        // Para CONFIRMADA: verificar o motivo de reabertura individual
        if (conv.STATUS === 'CONFIRMADA') {
          // Se tem motivo de reabertura e é "Motorista Desistiu da Carga", excluir
          if (conv.MOTIVO_REABERTURA === 'Motorista Desistiu da Carga') {
            return false;
          }
          // Se não tem motivo ou o motivo é outro, incluir
          return true;
        }
        
        return false;
      });
      
      // Se houver convocações para enviar, abrir modal de links
      if (convocacoesParaEnviar.length > 0) {
        // Buscar dados completos da viagem para gerar mensagem formatada
        const responseViagem = await fetch(`/api/viagens/${result.idViagem}`);
        if (!responseViagem.ok) {
          throw new Error('Erro ao buscar dados da viagem');
        }
        const viagemAtual = await responseViagem.json();
        
        if (!viagemAtual) {
          throw new Error('Dados da viagem não encontrados');
        }
        
        // Função para formatar data/hora (mesma lógica do prepararAnuncioCarga)
        const formatarDataHora = (dataHora) => {
          if (!dataHora) return 'Não informado';
          
          if (typeof dataHora === 'string') {
            let dataStr = dataHora.replace('Z', '');
            if (dataStr.includes('T')) {
              dataStr = dataStr.replace('T', ' ');
            }
            
            const match = dataStr.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
            if (match) {
              const [, year, month, day, hour, minute] = match;
              const diaStr = String(day).padStart(2, '0');
              const mesStr = String(month).padStart(2, '0');
              const anoStr = year;
              const horaStr = String(hour).padStart(2, '0');
              const minutoStr = String(minute).padStart(2, '0');
              
              return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
            }
          }
          
          try {
            const date = new Date(dataHora);
            if (isNaN(date.getTime())) return 'Data inválida';
            
            const ano = date.getUTCFullYear();
            const mes = date.getUTCMonth();
            const dia = date.getUTCDate();
            const hora = date.getUTCHours();
            const minuto = date.getUTCMinutes();
            
            const diaStr = String(dia).padStart(2, '0');
            const mesStr = String(mes + 1).padStart(2, '0');
            const anoStr = ano;
            const horaStr = String(hora).padStart(2, '0');
            const minutoStr = String(minuto).padStart(2, '0');
            
            return `${diaStr}/${mesStr}/${anoStr} ${horaStr}:${minutoStr}`;
          } catch (err) {
            return 'Data inválida';
          }
        };
        
        // Gerar texto base formatado (mesma estrutura do prepararAnuncioCarga)
        let textoBase = `🚚 *CARGA DISPONÍVEL*\n\n`;
        textoBase += `🆔 *ID:* ${viagemAtual.IDVIAGEM || 'N/A'}\n`;
        textoBase += `📦 *Tipo:* ${viagemAtual.DSTIPOVIAGEM || viagemAtual.CDTIPOVIAGEM || 'Não informado'}\n`;
        textoBase += `🚛 *Classe:* ${viagemAtual.DSCLASSEFROTA || viagemAtual.CDCLASSEFROTA || 'Não informado'}\n`;
        textoBase += `🗺️ *Rota:* ${viagemAtual.DSROTEIRO ? `${viagemAtual.IDROTEIRO || ''} - ${viagemAtual.DSROTEIRO}` : (viagemAtual.IDROTEIRO ? `${viagemAtual.IDROTEIRO} - ` : '') + `${viagemAtual.ORIGEM_CIDADE || 'N/A'}/${viagemAtual.ORIGEM_ESTADO || 'N/A'} → ${viagemAtual.DESTINO_CIDADE || 'N/A'}/${viagemAtual.DESTINO_ESTADO || 'N/A'}`}\n\n`;
        textoBase += `⏰ *HORÁRIOS*\n`;
        textoBase += `📅 *Carregamento:* ${formatarDataHora(viagemAtual.DTPREVINICIO)}\n`;
        textoBase += `📅 *Descarga:* ${formatarDataHora(viagemAtual.DTPREVFINAL)}\n\n`;
        
        if (viagemAtual.FGRASTREADO === 'S') {
          textoBase += `✅ *REQUISITOS*\n`;
          textoBase += `✅ *Exige Veículo Rastreado:* SIM\n\n`;
        }
        
        textoBase += `👤 *CONTRATADOR*\n`;
        textoBase += `${viagemAtual.CONTRATADOR_NOME || viagemAtual.CDCONTRATADOR || 'Não informado'}\n\n`;
        textoBase += `💰 *VALORES*\n`;
        textoBase += `💵 *Frete:* R$ ${viagemAtual.VLFRETE ? parseFloat(viagemAtual.VLFRETE).toFixed(2).replace('.', ',') : '0,00'}\n`;
        textoBase += `📊 *Peso:* ${viagemAtual.PESO ? parseFloat(viagemAtual.PESO).toFixed(3).replace('.', ',') : '0,000'} ton\n`;
        textoBase += `📦 *Cubagem:* ${viagemAtual.CUBAGEM ? parseFloat(viagemAtual.CUBAGEM).toFixed(3).replace('.', ',') : '0,000'} m³\ \n`;
        
        if (viagemAtual.OBSERV) {
          textoBase += `\n📝 *DETALHES DA VIAGEM*\n`;
          textoBase += `${viagemAtual.OBSERV}\n`;
        }
        
        // Obter URL base pública
        const urlBase = await obterUrlPublica();
        const linksWhatsApp = [];
        let semCelular = 0;
        const motoristasSemCelular = [];
        
        for (const conv of convocacoesParaEnviar) {
          const nomeMotorista = conv.NOME_MOTORISTA || 'Motorista';
          
          if (!conv.CELULAR_MOTORISTA) {
            semCelular++;
            motoristasSemCelular.push(nomeMotorista);
            continue;
          }
          
          // Limpar número
          let numeroLimpo = String(conv.CELULAR_MOTORISTA).replace(/\s+/g, '').replace(/[()\-\.]/g, '');
          if (!numeroLimpo.startsWith('55')) {
            if (numeroLimpo.startsWith('0')) {
              numeroLimpo = numeroLimpo.substring(1);
            }
            numeroLimpo = '55' + numeroLimpo;
          }
          
          if (numeroLimpo.length < 12) {
            semCelular++;
            motoristasSemCelular.push(nomeMotorista);
            continue;
          }
          
          const linkConvocacao = `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
          
          // Personalizar mensagem para cada motorista (mesma lógica do enviarAnuncioWhatsApp)
          const nomeMotoristaConvocacao = conv.NOME_MOTORISTA || 'Motorista';
          const mensagemPersonalizada = `Olá *${nomeMotoristaConvocacao.toUpperCase()}*! Você foi convocado para uma viagem.\n\n${textoBase}`;
          
          // Verificar se é IP local (HTTP) - WhatsApp não torna clicável
          const isLocalIP = urlBase.includes('192.168.') || urlBase.includes('localhost') || urlBase.includes('127.0.0.1');
          
          let textoComLink;
          if (isLocalIP) {
            textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n💡 *Importante:*\n• Links locais não são clicáveis no WhatsApp\n• Copie o link acima (toque e segure)\n• Cole no navegador do celular\n• Certifique-se de estar na mesma rede Wi-Fi`;
          } else {
            // Verificar se é ngrok (tem página de aviso)
            const isNgrok = urlBase.includes('ngrok-free.dev') || urlBase.includes('ngrok.io');
            
            if (isNgrok) {
              textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n👆 *Toque no link acima para responder*\n\n💡 *Aviso:* Na primeira vez, você verá uma página de segurança. Clique em "Visit Site" para continuar.`;
            } else {
              textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
            }
          }
          
          const linkWhatsApp = `https://wa.me/${numeroLimpo}?text=${encodeURIComponent(textoComLink)}`;
          
          linksWhatsApp.push({
            idConvocacao: conv.IDCONVOCACAO,
            motorista: conv.NOME_MOTORISTA || 'Motorista',
            celular: conv.CELULAR_MOTORISTA,
            link: linkWhatsApp,
            status: conv.STATUS
          });
        }
        
        if (linksWhatsApp.length > 0) {
          // Mostrar mensagem de sucesso
          showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
          
          // Aguardar um pouco antes de abrir o modal
          setTimeout(() => {
            mostrarModalLinksWhatsApp(linksWhatsApp, semCelular, 0, motoristasSemCelular, []);
          }, 500);
        } else {
          showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
          if (semCelular > 0) {
            showMessage(`${semCelular} motorista(s) sem celular válido não receberão mensagem.`, 'warning');
          }
        }
      } else {
        showMessage(result.message || 'Convocação reativada com sucesso!', 'success');
      }

      // Recarregar a lista de convocações
      await carregarConvocacoes();
    } catch (err) {
      console.error('Erro ao reativar convocação:', err);
      showMessage('Erro ao reativar convocação: ' + err.message, 'error');
    }
  };

  // Inicializar event listeners para a aba Compatíveis
  let listenersCompatíveisInicializados = false;
  
  function inicializarEventListenersCompatíveis() {
    // Evitar inicializar múltiplas vezes
    if (listenersCompatíveisInicializados) {
      return;
    }
    
    const btnCarregarPendentes = document.getElementById('btnCarregarViagensPendentes');
    const btnBuscarMotoristas = document.getElementById('btnBuscarMotoristas');
    const btnVoltarCompatíveis = document.getElementById('btnVoltarCompatíveis');
    const selectViagem = document.getElementById('selectViagemPendente');
    const btnDispararConvocacoes = document.getElementById('btnDispararConvocacoes');

    if (btnCarregarPendentes) {
      btnCarregarPendentes.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        carregarViagensPendentes();
      };
    }

    if (btnBuscarMotoristas) {
      btnBuscarMotoristas.onclick = function(e) {
        e.preventDefault();
        e.stopPropagation();
        buscarMotoristasCompatíveis();
      };
    }

    if (selectViagem) {
      selectViagem.onchange = function() {
        const btnBuscar = document.getElementById('btnBuscarMotoristas');
        if (btnBuscar) {
          btnBuscar.disabled = !this.value;
        }
      };
    }

    if (btnVoltarCompatíveis) {
      btnVoltarCompatíveis.onclick = function() {
        showTab('filtros');
      };
    }

    if (btnDispararConvocacoes) {
      btnDispararConvocacoes.onclick = dispararConvocacoes;
    }

    // Botão preparar anúncio
    const btnPrepararAnuncio = document.getElementById('btnPrepararAnuncio');
    if (btnPrepararAnuncio) {
      btnPrepararAnuncio.onclick = prepararAnuncioCarga;
    }

    // Botões do modal de anúncio
    const btnFecharAnuncio = document.getElementById('btnFecharAnuncio');
    const btnCopiarAnuncio = document.getElementById('btnCopiarAnuncio');
    const btnEnviarWhatsApp = document.getElementById('btnEnviarWhatsApp');
    const modalAnuncio = document.getElementById('modalAnuncio');

    if (btnFecharAnuncio) {
      btnFecharAnuncio.onclick = function() {
        modalAnuncio.style.display = 'none';
      };
    }

    if (btnCopiarAnuncio) {
      btnCopiarAnuncio.onclick = copiarAnuncio;
    }

    if (btnEnviarWhatsApp) {
      btnEnviarWhatsApp.onclick = enviarAnuncioWhatsApp;
    }

    // Fechar modal ao clicar fora dele
    if (modalAnuncio) {
      modalAnuncio.onclick = function(e) {
        if (e.target === modalAnuncio) {
          modalAnuncio.style.display = 'none';
        }
      };
    }

    listenersCompatíveisInicializados = true;
  }

  // Inicializar listeners quando o DOM estiver pronto
  function tentarInicializarListeners() {
    const btnCarregarPendentes = document.getElementById('btnCarregarViagensPendentes');
    if (btnCarregarPendentes) {
      inicializarEventListenersCompatíveis();
    } else {
      // Tentar novamente após um delay
      setTimeout(tentarInicializarListeners, 200);
    }
  }

  // Inicializar imediatamente se possível
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      tentarInicializarListeners();
      inicializarModalAjuda();
    });
  } else {
    // DOM já está pronto
    tentarInicializarListeners();
    inicializarModalAjuda();
  }

  // Modal de Ajuda/Manual
  function inicializarModalAjuda() {
    const btnAjuda = document.getElementById('btnAjudaConvocacoes');
    const modalAjuda = document.getElementById('modalAjuda');
    const btnFecharAjuda = document.getElementById('btnFecharAjuda');
    const conteudoAjuda = document.getElementById('conteudoAjuda');

    if (!btnAjuda || !modalAjuda || !conteudoAjuda) return;

    // Preencher conteúdo do manual
    conteudoAjuda.innerHTML = gerarConteudoManual();

    // Abrir modal
    btnAjuda.addEventListener('click', () => {
      modalAjuda.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });

    // Fechar modal
    if (btnFecharAjuda) {
      btnFecharAjuda.addEventListener('click', () => {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      });
    }

    // Fechar ao clicar fora
    modalAjuda.addEventListener('click', (e) => {
      if (e.target === modalAjuda) {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      }
    });

    // Fechar com ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (modalAjuda.style.display === 'flex' || modalAjuda.style.display === '')) {
        modalAjuda.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  }

  function gerarConteudoManual() {
    return `
      <div style="max-width: 1000px; margin: 0 auto;">
        <!-- Visão Geral -->
        <section style="margin-bottom: 40px; padding: 25px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h2 style="margin: 0 0 15px 0; font-size: 28px; display: flex; align-items: center; gap: 10px;">
            <span>🎯</span>
            <span>Visão Geral</span>
          </h2>
          <p style="margin: 0; font-size: 16px; line-height: 1.8; opacity: 0.95;">
            O <strong>Sistema de Convocações</strong> é o coração da ferramenta DivulgaCarga, responsável por identificar motoristas compatíveis, enviar convites via WhatsApp, gerenciar respostas e confirmar atribuição de viagens.
          </p>
        </section>

        <!-- Fluxo Completo -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #28a745;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #28a745; display: flex; align-items: center; gap: 10px;">
            <span>🔄</span>
            <span>Fluxo Completo do Processo</span>
          </h2>
          
          <div style="display: grid; gap: 20px;">
            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">1️⃣ Identificação de Viagens Pendentes</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Botão "Carregar Viagens Pendentes"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Sistema busca viagens com status "Programada" ou "Preparação"</li>
                <li>Filtra apenas viagens que <strong>NÃO</strong> possuem convocação ACEITA ou CONFIRMADA</li>
                <li>Lista ordenada por ID (mais recentes primeiro)</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">2️⃣ Busca de Motoristas Compatíveis</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Selecionar viagem → Botão "Buscar Motoristas Compatíveis"</p>
              <p style="margin: 0 0 10px 0;"><strong>Critérios de Compatibilidade (TODOS devem ser verdadeiros):</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li><strong>Classe de Frota:</strong> Motorista deve ter a mesma classe de frota da viagem (ativa)</li>
                <li><strong>Veículo Rastreado:</strong> Se a viagem exige rastreador, o motorista DEVE ter rastreador</li>
                <li><strong>Localização:</strong> Motorista da mesma micro-região da origem OU destino</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">3️⃣ Preparação do Anúncio</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Compatíveis" → Selecionar motoristas → Botão "📢 Preparar Anúncio"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Sistema monta texto formatado do anúncio com todos os detalhes da viagem</li>
                <li>Exibe preview no modal</li>
                <li>Permite copiar texto ou enviar via WhatsApp</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">4️⃣ Disparo de Convocações</h3>
              <p style="margin: 0 0 10px 0;"><strong>Dois caminhos disponíveis:</strong></p>
              <div style="margin: 10px 0; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                <p style="margin: 0 0 8px 0;"><strong>📱 "Enviar via WhatsApp" (Recomendado):</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Cria convocações no banco de dados</li>
                  <li>Gera links únicos para cada motorista</li>
                  <li>Abre WhatsApp com mensagem formatada</li>
                  <li>Grava telefone, texto e link no banco</li>
                </ul>
              </div>
              <div style="margin: 10px 0; padding: 15px; background: #d1ecf1; border-radius: 8px; border-left: 4px solid #0c5460;">
                <p style="margin: 0 0 8px 0;"><strong>⚡ "Disparar Convocações" (Apenas registro):</strong></p>
                <ul style="margin: 0; padding-left: 20px;">
                  <li>Cria convocações no banco de dados</li>
                  <li>NÃO envia WhatsApp automaticamente</li>
                  <li>Útil para registro prévio</li>
                </ul>
              </div>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">5️⃣ Acompanhamento de Respostas</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Convocações"</p>
              <p style="margin: 0 0 10px 0;"><strong>O que você pode fazer:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Visualizar todas as convocações enviadas</li>
                <li>Ver status: PENDENTE, ACEITA, RECUSADA, CONFIRMADA</li>
                <li>Rastrear acesso ao link (Data Acesso)</li>
                <li>Confirmar motorista selecionado</li>
              </ul>
            </div>

            <div style="padding: 20px; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
              <h3 style="margin: 0 0 10px 0; color: #667eea; font-size: 18px;">6️⃣ Confirmação do Motorista</h3>
              <p style="margin: 0 0 10px 0;"><strong>Onde:</strong> Aba "Convocações" → Botão "Confirmar" (apenas para status ACEITA)</p>
              <p style="margin: 0 0 10px 0;"><strong>O que acontece:</strong></p>
              <ul style="margin: 0; padding-left: 20px;">
                <li>Motorista selecionado fica com status CONFIRMADA</li>
                <li>Outros motoristas ACEITAS ficam como ACEITA_DESCARTADA (histórico preservado)</li>
                <li>Motoristas PENDENTE permanecem PENDENTE (não são marcados como recusados)</li>
                <li>WhatsApp de confirmação é enviado automaticamente ao motorista selecionado</li>
              </ul>
            </div>
          </div>
        </section>

        <!-- Status das Convocações -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #17a2b8;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #17a2b8; display: flex; align-items: center; gap: 10px;">
            <span>📊</span>
            <span>Status das Convocações</span>
          </h2>
          
          <div style="display: grid; gap: 15px;">
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #ffc107;">
              <strong style="color: #856404;">⏳ PENDENTE:</strong> Convocação criada, aguardando motorista acessar o link e responder.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #28a745;">
              <strong style="color: #155724;">✅ ACEITA:</strong> Motorista acessou o link e aceitou a convocação.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #dc3545;">
              <strong style="color: #721c24;">❌ RECUSADA:</strong> Motorista acessou o link e recusou a convocação.
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #007bff;">
              <strong style="color: #004085;">✓ CONFIRMADA:</strong> Operador confirmou o motorista para a viagem (status final).
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #6c757d;">
              <strong style="color: #383d41;">💔 ACEITA_DESCARTADA:</strong> Motorista aceitou, mas outro foi selecionado (histórico preservado).
            </div>
          </div>
        </section>

        <!-- Regras de Negócio -->
        <section style="margin-bottom: 40px; padding: 25px; background: #f8f9fa; border-radius: 12px; border-left: 5px solid #dc3545;">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #dc3545; display: flex; align-items: center; gap: 10px;">
            <span>📋</span>
            <span>Regras de Negócio Importantes</span>
          </h2>
          
          <div style="display: grid; gap: 15px;">
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>1. Uma viagem = Um motorista confirmado</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Apenas um motorista pode ser confirmado por viagem. Ao confirmar um, outros ACEITAS ficam como ACEITA_DESCARTADA.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>2. Histórico preservado</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Motoristas que aceitaram mas não foram selecionados mantêm o histórico de aceite (ACEITA_DESCARTADA).</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>3. PENDENTE não vira RECUSADA automaticamente</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Motoristas que não acessaram ou não responderam permanecem PENDENTE, mesmo após confirmação de outro motorista.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>4. Compatibilidade obrigatória</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Motorista deve atender TODOS os critérios: classe de frota, rastreador (se exigido) e localização.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>5. Link único por motorista</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Cada motorista recebe um link único para responder. O acesso é rastreado automaticamente.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>6. Confirmação manual</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Apenas convocações com status ACEITA podem ser confirmadas. O botão "Confirmar" só aparece para essas.</p>
            </div>
            <div style="padding: 15px; background: white; border-radius: 8px;">
              <strong>7. WhatsApp automático na confirmação</strong>
              <p style="margin: 5px 0 0 0; color: #666;">Ao confirmar um motorista, o sistema envia automaticamente uma mensagem de parabéns via WhatsApp com contato do contratador.</p>
            </div>
          </div>
        </section>

        <!-- Dicas -->
        <section style="margin-bottom: 40px; padding: 25px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 12px; box-shadow: 0 4px 15px rgba(245, 87, 108, 0.3);">
          <h2 style="margin: 0 0 20px 0; font-size: 24px; display: flex; align-items: center; gap: 10px;">
            <span>💡</span>
            <span>Dicas de Uso</span>
          </h2>
          <ul style="margin: 0; padding-left: 20px; line-height: 2;">
            <li>Use "Preparar Anúncio" para visualizar e personalizar a mensagem antes de enviar</li>
            <li>O contador de registros no Grid mostra quantas viagens foram encontradas</li>
            <li>Filtre por "Motorista Confirmado" para ver viagens com ou sem motorista atribuído</li>
            <li>A coluna "Data Acesso" mostra quando o motorista acessou o link (✅ se acessou, ❌ se não)</li>
            <li>Links locais (IP) não são clicáveis no WhatsApp - o motorista precisa copiar e colar</li>
            <li>Configure PUBLIC_URL no .env para usar links públicos clicáveis</li>
          </ul>
        </section>

        <!-- Suporte -->
        <section style="padding: 25px; background: #e7f3ff; border-radius: 12px; border: 2px solid #2196F3;">
          <h2 style="margin: 0 0 15px 0; font-size: 24px; color: #2196F3; display: flex; align-items: center; gap: 10px;">
            <span>📞</span>
            <span>Precisa de Ajuda?</span>
          </h2>
          <p style="margin: 0; color: #666; line-height: 1.8;">
            Consulte a documentação completa em: <code style="background: white; padding: 2px 8px; border-radius: 4px;">DOCUMENTACAO_SISTEMA_CONVOCACOES.md</code>
          </p>
        </section>
      </div>
    `;
  }

  // Variável global para o mapa do motorista
  let mapaMotorista = null;
  let mapaMotoristaLayer = null;

  // Função para abrir modal com mapa do motorista
  window.abrirMapaMotorista = async function(idConvocacao, latMotorista, lonMotorista, idRoteiro, idViagem) {
    try {
      // Buscar dados da convocação
      const convocacao = convocacoes.find(c => c.IDCONVOCACAO === idConvocacao);
      if (!convocacao) {
        showMessage('Convocação não encontrada.', 'error');
        return;
      }

      // Preencher informações no modal
      document.getElementById('mapaInfoMotorista').textContent = convocacao.NOME_MOTORISTA || '-';
      document.getElementById('mapaInfoCelular').textContent = convocacao.CELULAR_MOTORISTA || '-';
      document.getElementById('mapaInfoViagem').textContent = idViagem || '-';
      document.getElementById('mapaInfoRoteiro').textContent = convocacao.DSROTEIRO || '-';
      
      // Formatar valores
      const formatarValor = (valor) => {
        if (!valor) return 'R$ 0,00';
        return `R$ ${parseFloat(valor).toFixed(2).replace('.', ',')}`;
      };
      
      const formatarPeso = (peso) => {
        if (!peso) return '-';
        return `${parseFloat(peso).toFixed(3).replace('.', ',')} ton`;
      };
      
      // Buscar dados da viagem se não estiverem na convocação
      let vlFrete = convocacao.VLFRETE;
      let peso = convocacao.PESO;
      let cubagem = convocacao.CUBAGEM;
      
      // Se não tiver na convocação, buscar da viagem
      if (!vlFrete && idViagem) {
        try {
          const viagemResponse = await fetch(`/api/viagens/${idViagem}`);
          if (viagemResponse.ok) {
            const viagem = await viagemResponse.json();
            vlFrete = viagem.VLFRETE || vlFrete;
            peso = viagem.PESO || peso;
            cubagem = viagem.CUBAGEM || cubagem;
          }
        } catch (err) {
          console.error('Erro ao buscar dados da viagem:', err);
        }
      }
      
      document.getElementById('mapaInfoFrete').textContent = formatarValor(vlFrete);
      document.getElementById('mapaInfoPeso').textContent = formatarPeso(peso);
      document.getElementById('mapaInfoDistancia').textContent = 'Calculando...';

      // Abrir modal
      const modal = document.getElementById('modalMapaMotorista');
      modal.style.display = 'block';

      // Buscar pontos do roteiro para pegar a origem
      let origemLat = null;
      let origemLon = null;
      let origemNome = 'Origem';

      try {
        const pontosResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
        if (pontosResponse.ok) {
          const pontos = await pontosResponse.json();
          // Buscar ponto de origem (ORDEM = 1 ou TPLOCAL = 'O')
          const pontoOrigem = pontos.find(p => p.ORDEM === 1 || p.TPLOCAL === 'O');
          if (pontoOrigem && pontoOrigem.LATITUDE && pontoOrigem.LONGITUDE) {
            origemLat = parseFloat(pontoOrigem.LATITUDE);
            origemLon = parseFloat(pontoOrigem.LONGITUDE);
            origemNome = pontoOrigem.DSLOCAL || 'Origem';
          }
        }
      } catch (err) {
        console.error('Erro ao buscar pontos do roteiro:', err);
      }

      // Carregar Leaflet
      await carregarLeaflet();

      // Aguardar um pouco para garantir que o DOM está pronto
      await new Promise(resolve => setTimeout(resolve, 300));

      // Verificar se o elemento do mapa existe e está visível
      const mapaDiv = document.getElementById('mapaMotorista');
      if (!mapaDiv) {
        console.error('Elemento mapaMotorista não encontrado');
        return;
      }

      // Limpar mapa anterior se existir
      if (mapaMotorista) {
        try {
          mapaMotorista.remove();
        } catch (e) {
          console.warn('Erro ao remover mapa anterior:', e);
        }
        mapaMotorista = null;
        mapaMotoristaLayer = null;
      }

      // Limpar conteúdo do elemento
      mapaDiv.innerHTML = '';

      // Aguardar um pouco para garantir que o elemento está pronto
      await new Promise(resolve => setTimeout(resolve, 100));

      // Criar mapa
      mapaMotorista = L.map('mapaMotorista').setView([latMotorista, lonMotorista], 8);
      
      // Aguardar o mapa inicializar
      await new Promise(resolve => setTimeout(resolve, 200));

      // Adicionar tile layer  
      const tileConfig = window.getTileLayerConfig ? window.getTileLayerConfig() : {
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      L.tileLayer(tileConfig.url, {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom
      }).addTo(mapaMotorista);

      // Criar ícones personalizados
      const iconeMotorista = L.divIcon({
        className: 'custom-marker-motorista',
        html: '<div style="background: #e74c3c; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">🚛</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      const iconeOrigem = L.divIcon({
        className: 'custom-marker-origem',
        html: '<div style="background: #2ecc71; width: 30px; height: 30px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 16px;">📍</div>',
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      });

      // Adicionar marcador do motorista
      const marcadorMotorista = L.marker([latMotorista, lonMotorista], { icon: iconeMotorista })
        .addTo(mapaMotorista)
        .bindPopup(`
          <div style="min-width: 200px;">
            <h3 style="margin: 0 0 10px 0; color: #e74c3c;">🚛 Motorista</h3>
            <p style="margin: 5px 0;"><strong>Nome:</strong> ${convocacao.NOME_MOTORISTA || '-'}</p>
            <p style="margin: 5px 0;"><strong>Celular:</strong> ${convocacao.CELULAR_MOTORISTA || '-'}</p>
            <p style="margin: 5px 0;"><strong>Status:</strong> ${convocacao.STATUS || '-'}</p>
            <hr style="margin: 10px 0;">
            <h4 style="margin: 10px 0 5px 0; color: #667eea;">📦 Carga</h4>
            <p style="margin: 5px 0;"><strong>ID Viagem:</strong> ${idViagem || '-'}</p>
            <p style="margin: 5px 0;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
            <p style="margin: 5px 0;"><strong>Frete:</strong> ${formatarValor(vlFrete)}</p>
            <p style="margin: 5px 0;"><strong>Peso:</strong> ${formatarPeso(peso)}</p>
            <p style="margin: 5px 0;"><strong>Classe:</strong> ${convocacao.DSCLASSEFROTA || '-'}</p>
          </div>
        `);

      // Adicionar marcador da origem se tiver coordenadas
      let marcadorOrigem = null;
      if (origemLat && origemLon) {
        marcadorOrigem = L.marker([origemLat, origemLon], { icon: iconeOrigem })
          .addTo(mapaMotorista)
          .bindPopup(`
            <div style="min-width: 200px;">
              <h3 style="margin: 0 0 10px 0; color: #2ecc71;">📍 Local de Carregamento</h3>
              <p style="margin: 5px 0;"><strong>Local:</strong> ${origemNome}</p>
              <p style="margin: 5px 0;"><strong>Roteiro:</strong> ${convocacao.DSROTEIRO || '-'}</p>
            </div>
          `);

        // Calcular e desenhar rota usando OSRM
        try {
          const config = window.MAP_CONFIG || {};
          const osrmUrl = `${config.osrmServer || 'https://router.project-osrm.org/route/v1/driving'}/${lonMotorista},${latMotorista};${origemLon},${origemLat}?overview=full&geometries=geojson`;
          const rotaResponse = await fetch(osrmUrl, { signal: AbortSignal.timeout(config.routeTimeout || 15000) });
          const rotaData = await rotaResponse.json();

          if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
            const route = rotaData.routes[0];
            const distanciaKm = (route.distance / 1000).toFixed(2);
            const duracaoMin = Math.round(route.duration / 60);

            // Atualizar informação de distância
            document.getElementById('mapaInfoDistancia').textContent = `${distanciaKm} km (aprox. ${duracaoMin} min)`;

            // Desenhar rota no mapa
            const rotaGeoJson = {
              type: 'Feature',
              geometry: route.geometry
            };

            if (mapaMotoristaLayer) {
              mapaMotorista.removeLayer(mapaMotoristaLayer);
            }

            mapaMotoristaLayer = L.geoJSON(rotaGeoJson, {
              style: {
                color: '#667eea',
                weight: 5,
                opacity: 0.7
              }
            }).addTo(mapaMotorista);

            // Ajustar zoom para mostrar ambos os pontos
            const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem]);
            mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
          } else {
            // Se OSRM falhar, usar cálculo Haversine
            const distanciaHaversine = calcularDistanciaHaversine(latMotorista, lonMotorista, origemLat, origemLon);
            document.getElementById('mapaInfoDistancia').textContent = `${distanciaHaversine.toFixed(2)} km (linha reta)`;
            
            // Ajustar zoom
            const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem]);
            mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
          }
        } catch (err) {
          console.error('Erro ao calcular rota:', err);
          // Usar cálculo Haversine como fallback
          const distanciaHaversine = calcularDistanciaHaversine(latMotorista, lonMotorista, origemLat, origemLon);
          document.getElementById('mapaInfoDistancia').textContent = `${distanciaHaversine.toFixed(2)} km (linha reta)`;
          
          // Ajustar zoom
          const grupo = L.featureGroup([marcadorMotorista, marcadorOrigem]);
          mapaMotorista.fitBounds(grupo.getBounds().pad(0.1));
        }
      } else {
        // Se não tiver origem, apenas mostrar motorista
        mapaMotorista.setView([latMotorista, lonMotorista], 12);
        document.getElementById('mapaInfoDistancia').textContent = 'Origem não encontrada no roteiro';
      }

      // Abrir popup do motorista
      marcadorMotorista.openPopup();

    } catch (err) {
      console.error('Erro ao abrir mapa do motorista:', err);
      showMessage('Erro ao carregar mapa. ' + err.message, 'error');
    }
  };

  // Função para fechar modal do mapa
  window.fecharModalMapaMotorista = function() {
    const modal = document.getElementById('modalMapaMotorista');
    modal.style.display = 'none';
    
    // Limpar mapa
    if (mapaMotorista) {
      mapaMotorista.remove();
      mapaMotorista = null;
      mapaMotoristaLayer = null;
    }
  };

  // Função auxiliar para calcular distância Haversine
  function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Fechar modal ao clicar fora
  document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modalMapaMotorista');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          fecharModalMapaMotorista();
        }
      });
    }
  });

  // ============================================================================
  // FUNÇÕES PARA ABA VEÍCULO
  // ============================================================================

  // Carregar tipos de equipamento no select
  async function carregarTiposEquipamento() {
    const select = document.getElementById('veiculoTpEquipamento');
    if (!select) return;

    // Se já foi carregado, não carregar novamente
    if (select.options.length > 1) return;

    try {
      // Tentar primeiro a rota /api/equipamentos/tipos-combo, depois /api/tipos-combo
      let response = await fetch('/api/equipamentos/tipos-combo');
      if (!response.ok) {
        // Fallback para rota alternativa
        response = await fetch('/api/tipos-combo');
      }
      
      if (response.ok) {
        const tipos = await response.json();
        if (!tipos || !Array.isArray(tipos)) {
          console.error('Resposta inválida ao carregar tipos de equipamento:', tipos);
          return;
        }
        
        // Limpar opções exceto a primeira (Selecione...)
        select.innerHTML = '<option value="">Selecione...</option>';
        
        // Adicionar tipos no formato: "Código - Descrição"
        tipos.forEach(tipo => {
          const option = document.createElement('option');
          option.value = tipo.CDTIPOEQUIPAMENTO || tipo.codigo || tipo.value;
          option.textContent = `${String(tipo.CDTIPOEQUIPAMENTO || tipo.codigo || tipo.value).padStart(2, '0')} - ${tipo.DSTIPOEQUIPAMENTO || tipo.descricao || tipo.label}`;
          select.appendChild(option);
        });
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.error('Erro ao carregar tipos de equipamento:', response.status, error);
      }
    } catch (err) {
      console.error('Erro ao carregar tipos de equipamento:', err);
    }
  }

  // Buscar equipamento por placa
  async function buscarEquipamentoPorPlaca() {
    const placa = document.getElementById('veiculoRefEquipamento')?.value.trim();
    if (!placa) {
      showMessage('Informe a placa do equipamento.', 'error');
      return;
    }

    // Garantir que o ID da viagem está definido se disponível
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
    if (idViagem) {
      document.getElementById('veiculoIdViagem').value = idViagem;
    }

    try {
      const response = await fetch(`/api/viagens/equipamentos/buscar?placa=${encodeURIComponent(placa)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar equipamento.' }));
        showMessage(error.error || 'Equipamento não encontrado.', 'error');
        return;
      }

      const equipamento = await response.json();
      if (!equipamento || !equipamento.IDEQUIPAMENTO) {
        showMessage('Equipamento não encontrado ou dados inválidos.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
      if (idViagem) {
        document.getElementById('veiculoIdViagem').value = idViagem;
      }

      preencherDadosEquipamento(equipamento);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      showMessage('Erro ao buscar equipamento: ' + err.message, 'error');
    }
  }

  // Buscar equipamento por código
  async function buscarEquipamentoPorCodigo() {
    const codigo = document.getElementById('veiculoIdEquipamento')?.value.trim();
    if (!codigo) {
      // Não mostrar erro se o campo estiver vazio - pode ser que o usuário ainda não preencheu
      return;
    }

    // Validar se é um número válido
    const codigoNum = parseFloat(codigo);
    if (isNaN(codigoNum) || codigoNum <= 0) {
      showMessage('Código do equipamento inválido.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/viagens/equipamentos/buscar?codigo=${encodeURIComponent(codigoNum)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar equipamento.' }));
        if (response.status === 404) {
          showMessage('Equipamento não encontrado.', 'error');
        } else {
          showMessage(error.error || 'Erro ao buscar equipamento.', 'error');
        }
        return;
      }

      const equipamento = await response.json();
      if (!equipamento || !equipamento.IDEQUIPAMENTO) {
        showMessage('Equipamento não encontrado ou dados inválidos.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagem = document.getElementById('viagemId')?.value || document.getElementById('veiculoIdViagem')?.value;
      if (idViagem) {
        document.getElementById('veiculoIdViagem').value = idViagem;
      }

      preencherDadosEquipamento(equipamento);
    } catch (err) {
      console.error('Erro ao buscar equipamento:', err);
      showMessage('Erro ao buscar equipamento.', 'error');
    }
  }

  // Mapear tipos de carroceria
  const TIPO_CARROCERIA = {
    '01': '01 - Não aplicável',
    '02': '02 - Aberta',
    '03': '03 - Fechada / Baú',
    '04': '04 - Graneleira',
    '05': '05 - Porta Container',
    '06': '06 - Sider'
  };

  // Mapear tipos de atuação
  const TIPO_ATUACAO = {
    'A': 'A - Agregado',
    'F': 'F - Frota Própria',
    'P': 'P - Parceiro (Terceiro Fiel)',
    'T': 'T - Terceiro'
  };

  // Formatar número decimal
  function formatarDecimal(valor, casasDecimais = 2) {
    if (valor === null || valor === undefined || valor === '') return '';
    const num = parseFloat(valor);
    if (isNaN(num)) return '';
    return num.toFixed(casasDecimais).replace('.', ',');
  }

  // Preencher dados do equipamento
  function preencherDadosEquipamento(equipamento) {
    // Campos de busca
    document.getElementById('veiculoIdEquipamento').value = equipamento.IDEQUIPAMENTO || '';
    document.getElementById('veiculoRefEquipamento').value = equipamento.REFEQUIPAMENTO || '';
    
    // Dados completos - Linha 1
    document.getElementById('veiculoIdEquipamentoDisplay').value = equipamento.IDEQUIPAMENTO || '';
    document.getElementById('veiculoRefEquipamentoDisplay').value = equipamento.REFEQUIPAMENTO || '';
    document.getElementById('veiculoDescricao').value = equipamento.DSEQUIPAMENTO || '';
    const situacao = equipamento.FGACTIVE === 'A' || equipamento.FGACTIVE === 'S' ? 'Ativo' : 'Inativo';
    document.getElementById('veiculoSituacao').value = situacao;
    
    // Linha 2
    document.getElementById('veiculoClasseFrota').value = equipamento.CLASSE_NOME || 'Não informado';
    document.getElementById('veiculoTipo').value = equipamento.TIPO_NOME || 'Não informado';
    const tipoCarroceria = TIPO_CARROCERIA[equipamento.FGTIPOCARROCERIA] || equipamento.FGTIPOCARROCERIA || 'Não informado';
    document.getElementById('veiculoTipoCarroceria').value = tipoCarroceria;
    const tipoAtuacao = TIPO_ATUACAO[equipamento.FGTIPOATUACAO] || equipamento.FGTIPOATUACAO || 'Não informado';
    document.getElementById('veiculoTipoAtuacao').value = tipoAtuacao;
    
    // Linha 3
    document.getElementById('veiculoGrupo').value = equipamento.GRUPO_NOME || 'Não informado';
    document.getElementById('veiculoMarca').value = equipamento.MARCA_NOME || 'Não informado';
    document.getElementById('veiculoModelo').value = equipamento.MODELO_NOME || 'Não informado';
    document.getElementById('veiculoAnoFabricacao').value = equipamento.ANOFABRICA || 'Não informado';
    
    // Linha 4
    document.getElementById('veiculoCapacidade').value = equipamento.CAPACIDCARGA ? formatarDecimal(equipamento.CAPACIDCARGA, 2) : 'Não informado';
    document.getElementById('veiculoAltura').value = equipamento.ALTURA ? formatarDecimal(equipamento.ALTURA, 2) : 'Não informado';
    document.getElementById('veiculoLargura').value = equipamento.LARGURA ? formatarDecimal(equipamento.LARGURA, 2) : 'Não informado';
    document.getElementById('veiculoComprimento').value = equipamento.COMPRIMENTO ? formatarDecimal(equipamento.COMPRIMENTO, 2) : 'Não informado';
    
    // Linha 5
    document.getElementById('veiculoCubico').value = equipamento.MTCUBICO ? formatarDecimal(equipamento.MTCUBICO, 2) : 'Não informado';
    document.getElementById('veiculoEixos').value = equipamento.NREIXOS || 'Não informado';
    const rastreado = equipamento.FGRASTREADO === 'S' ? 'Sim' : equipamento.FGRASTREADO === 'N' ? 'Não' : 'Não informado';
    document.getElementById('veiculoRastreado').value = rastreado;
    
    // Preencher tipo de equipamento se disponível
    if (equipamento.CDTIPOEQUIPAMENTO) {
      document.getElementById('veiculoTpEquipamento').value = equipamento.CDTIPOEQUIPAMENTO;
    } else if (!document.getElementById('veiculoTpEquipamento').value && equipamento.TPEQUIPAMENTO) {
      // Fallback: usar TPEQUIPAMENTO se CDTIPOEQUIPAMENTO não estiver disponível
      document.getElementById('veiculoTpEquipamento').value = equipamento.TPEQUIPAMENTO;
    }

    document.getElementById('veiculoDadosCompletos').style.display = 'block';
    document.getElementById('veiculoSemDados').style.display = 'none';
    showMessage('Equipamento encontrado!', 'success');
  }

  // Salvar veículo na viagem
  async function salvarVeiculo(e) {
    e.preventDefault();
    const idViagem = document.getElementById('veiculoIdViagem')?.value;
    const idequipamento = document.getElementById('veiculoIdEquipamento')?.value;
    const refequipamento = document.getElementById('veiculoRefEquipamento')?.value.trim();
    const tpequipamento = document.getElementById('veiculoTpEquipamento')?.value.trim();

    if (!idViagem) {
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    if (!idequipamento || !refequipamento || !tpequipamento) {
      showMessage('Preencha todos os campos obrigatórios.', 'error');
      return;
    }

    // Converter código numérico do tipo de equipamento para formato de 2 caracteres
    // O backend espera TPEQUIPAMENTO como Char(2), então formatamos o código
    const tpequipamentoFormatado = String(tpequipamento).padStart(2, '0').substring(0, 2).toUpperCase();

    try {
      const response = await fetch(`/api/viagens/${idViagem}/veiculo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idequipamento: parseFloat(idequipamento),
          refequipamento: refequipamento.toUpperCase(),
          tpequipamento: tpequipamentoFormatado
        })
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Veículo salvo com sucesso!', 'success');
        // Limpar formulário após salvar
        limparFormularioVeiculo();
        // Recarregar lista de veículos
        const idViagem = document.getElementById('veiculoIdViagem')?.value;
        if (idViagem) {
          await carregarVeiculoViagem(idViagem);
        }
      } else {
        showMessage(result.error || 'Erro ao salvar veículo.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar veículo:', err);
      showMessage('Erro ao salvar veículo.', 'error');
    }
  }

  // Limpar formulário de veículo completamente
  function limparFormularioVeiculo() {
    // Limpar campos de busca
    document.getElementById('veiculoIdEquipamento').value = '';
    document.getElementById('veiculoRefEquipamento').value = '';
    document.getElementById('veiculoTpEquipamento').value = '';
    
    // Limpar campos de exibição
    const camposDisplay = [
      'veiculoIdEquipamentoDisplay',
      'veiculoRefEquipamentoDisplay',
      'veiculoDescricao',
      'veiculoSituacao',
      'veiculoClasseFrota',
      'veiculoTipo',
      'veiculoTipoCarroceria',
      'veiculoTipoAtuacao',
      'veiculoGrupo',
      'veiculoMarca',
      'veiculoModelo',
      'veiculoAnoFabricacao',
      'veiculoCapacidade',
      'veiculoAltura',
      'veiculoLargura',
      'veiculoComprimento',
      'veiculoCubico',
      'veiculoEixos',
      'veiculoRastreado'
    ];
    
    camposDisplay.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    
    // Ocultar seções
    document.getElementById('veiculoDadosCompletos').style.display = 'none';
    document.getElementById('veiculoSemDados').style.display = 'none';
    document.getElementById('veiculoIdViagem').value = '';
  }

  // Carregar lista de veículos da viagem
  async function carregarVeiculoViagem(idViagem) {
    if (!idViagem) {
      limparFormularioVeiculo();
      limparListaVeiculos();
      return;
    }

    limparFormularioVeiculo();
    document.getElementById('veiculoIdViagem').value = idViagem;

    try {
      const response = await fetch(`/api/viagens/${idViagem}/veiculo`).catch(() => null);
      if (!response) {
        limparListaVeiculos();
        return;
      }
      
      if (response.ok) {
        const veiculos = await response.json();
        // Agora retorna uma LISTA (array)
        if (Array.isArray(veiculos) && veiculos.length > 0) {
          exibirListaVeiculos(veiculos);
        } else {
          limparListaVeiculos();
        }
      } else if (response.status === 404) {
        // Nenhum veículo cadastrado - normal
        limparListaVeiculos();
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro ao carregar veículos.' }));
        console.error('Erro ao carregar veículos:', error);
        limparListaVeiculos();
      }
    } catch (err) {
      if (err.message && !err.message.includes('404')) {
        console.error('Erro ao carregar veículos:', err);
      }
      limparListaVeiculos();
    }
  }

  // Exibir lista de veículos
  function exibirListaVeiculos(veiculos) {
    const listaContainer = document.getElementById('veiculoLista');
    const listaVazia = document.getElementById('veiculoListaVazia');
    
    if (!listaContainer || !listaVazia) return;

    listaVazia.style.display = 'none';
    listaContainer.innerHTML = '';

    veiculos.forEach(veiculo => {
      const card = document.createElement('div');
      card.style.cssText = 'padding: 15px; background: white; border: 1px solid #ddd; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
      
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      info.innerHTML = `
        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
          ${veiculo.REFEQUIPAMENTO || 'N/A'} - ${veiculo.DSEQUIPAMENTO || 'Sem descrição'}
        </div>
        <div style="font-size: 0.9em; color: #666;">
          ID: ${veiculo.IDEQUIPAMENTO} | Tipo: ${veiculo.TIPO_NOME || veiculo.TPEQUIPAMENTO || 'N/A'} | 
          ${veiculo.MARCA_NOME || ''} ${veiculo.MODELO_NOME || ''} ${veiculo.ANOFABRICA ? `(${veiculo.ANOFABRICA})` : ''}
        </div>
      `;
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 10px; margin-left: 15px;';
      
      const btnVerDados = document.createElement('button');
      btnVerDados.type = 'button';
      btnVerDados.className = 'btn info';
      btnVerDados.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnVerDados.innerHTML = '👁️ Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosVeiculo(veiculo);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn';
      btnValidades.style.cssText = 'padding: 8px 15px; white-space: nowrap; background: #667eea; color: white;';
      btnValidades.innerHTML = '📋 Validades';
      btnValidades.onclick = () => mostrarValidadesVeiculo(veiculo.IDEQUIPAMENTO, veiculo.REFEQUIPAMENTO || veiculo.DSEQUIPAMENTO || 'Veículo');
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn cancel';
      btnRemover.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnRemover.innerHTML = '🗑️ Remover';
      btnRemover.onclick = () => removerVeiculoViagem(veiculo.IDVIAGEM, veiculo.IDEQUIPAMENTO);
      
      btnContainer.appendChild(btnVerDados);
      btnContainer.appendChild(btnValidades);
      btnContainer.appendChild(btnRemover);
      
      card.appendChild(info);
      card.appendChild(btnContainer);
      listaContainer.appendChild(card);
    });
  }

  // Limpar lista de veículos
  function limparListaVeiculos() {
    const listaContainer = document.getElementById('veiculoLista');
    const listaVazia = document.getElementById('veiculoListaVazia');
    
    if (listaContainer) listaContainer.innerHTML = '';
    if (listaVazia) listaVazia.style.display = 'block';
  }

  // Remover veículo da viagem
  async function removerVeiculoViagem(idViagem, idequipamento) {
    if (!confirm(`Tem certeza que deseja remover este veículo da viagem?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/viagens/${idViagem}/veiculo/${idequipamento}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Veículo removido com sucesso!', 'success');
        // Recarregar lista
        await carregarVeiculoViagem(idViagem);
      } else {
        showMessage(result.error || 'Erro ao remover veículo.', 'error');
      }
    } catch (err) {
      console.error('Erro ao remover veículo:', err);
      showMessage('Erro ao remover veículo.', 'error');
    }
  }

  // Mostrar dados completos do veículo em modal
  function mostrarDadosCompletosVeiculo(veiculo) {
    const modal = document.getElementById('modalDadosVeiculo');
    const conteudo = document.getElementById('modalVeiculoConteudo');
    
    if (!modal || !conteudo) return;

    // Formatar dados
    const formatarValor = (valor, sufixo = '') => {
      if (valor === null || valor === undefined || valor === '') return 'Não informado';
      return `${valor}${sufixo}`;
    };

    const formatarSimNao = (valor) => {
      if (valor === 'S' || valor === 's' || valor === true) return 'Sim';
      if (valor === 'N' || valor === 'n' || valor === false) return 'Não';
      return formatarValor(valor);
    };

    const formatarTipoAtuacao = (valor) => {
      const tipos = {
        'F': 'F - Frota Própria',
        'T': 'T - Terceirizado',
        'A': 'A - Agregado'
      };
      return tipos[valor] || formatarValor(valor);
    };

    // Nome em destaque (Referência - Descrição)
    const nomeVeiculo = `${veiculo.REFEQUIPAMENTO || 'N/A'} - ${veiculo.DSEQUIPAMENTO || 'Sem descrição'}`;

    conteudo.innerHTML = `
      <div class="modal-dados-completos-nome">${nomeVeiculo}</div>

      <table class="modal-dados-completos-table">
        <tbody>
          <tr>
            <td>ID do Equipamento</td>
            <td>${formatarValor(veiculo.IDEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Referência</td>
            <td>${formatarValor(veiculo.REFEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Descrição</td>
            <td>${formatarValor(veiculo.DSEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Situação</td>
            <td>${formatarValor(veiculo.FGACTIVE)}</td>
          </tr>
          <tr>
            <td>Tipo de Equipamento</td>
            <td>${formatarValor(veiculo.TIPO_NOME || veiculo.TPEQUIPAMENTO)}</td>
          </tr>
          <tr>
            <td>Classe de Frota</td>
            <td>${formatarValor(veiculo.CLASSE_NOME)}</td>
          </tr>
          <tr>
            <td>Grupo</td>
            <td>${formatarValor(veiculo.GRUPO_NOME)}</td>
          </tr>
          <tr>
            <td>Tipo de Carroceria</td>
            <td>${formatarValor(veiculo.FGTIPOCARROCERIA)}</td>
          </tr>
          <tr>
            <td>Tipo de Atuação</td>
            <td>${formatarTipoAtuacao(veiculo.FGTIPOATUACAO)}</td>
          </tr>
          <tr>
            <td>Marca</td>
            <td>${formatarValor(veiculo.MARCA_NOME)}</td>
          </tr>
          <tr>
            <td>Modelo</td>
            <td>${formatarValor(veiculo.MODELO_NOME)}</td>
          </tr>
          <tr>
            <td>Ano de Fabricação</td>
            <td>${formatarValor(veiculo.ANOFABRICA)}</td>
          </tr>
          <tr>
            <td>Eixos</td>
            <td>${formatarValor(veiculo.NREIXOS)}</td>
          </tr>
          <tr>
            <td>Capacidade de Carga</td>
            <td>${formatarValor(veiculo.CAPACIDCARGA, ' ton')}</td>
          </tr>
          <tr>
            <td>Altura</td>
            <td>${formatarValor(veiculo.ALTURA, ' m')}</td>
          </tr>
          <tr>
            <td>Largura</td>
            <td>${formatarValor(veiculo.LARGURA, ' m')}</td>
          </tr>
          <tr>
            <td>Comprimento</td>
            <td>${formatarValor(veiculo.COMPRIMENTO, ' m')}</td>
          </tr>
          <tr>
            <td>M³ Cúbico</td>
            <td>${formatarValor(veiculo.MTCUBICO)}</td>
          </tr>
          <tr>
            <td>Veículo Rastreado</td>
            <td>${formatarSimNao(veiculo.FGRASTREADO)}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Mostrar modal
    modal.style.display = 'flex';
    
    // Event listener para fechar
    const btnFechar = document.getElementById('btnFecharModalVeiculo');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }

    // Fechar ao clicar fora do modal
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    
    // Fechar com ESC
    const fecharComESC = (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', fecharComESC);
      }
    };
    document.addEventListener('keydown', fecharComESC);
  }

  // ============================================================================
  // FUNÇÕES PARA ABA MOTORISTA
  // ============================================================================

  // Buscar cadastro geral por CPF
  async function buscarMotoristaPorCpf() {
    const cpf = document.getElementById('motoristaCpf')?.value.replace(/[^\d]+/g, '');
    if (!cpf || cpf.length !== 11) {
      showMessage('Informe um CPF válido.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const response = await fetch(`/api/viagens/cadastros-gerais/buscar?cpf=${encodeURIComponent(cpf)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
      if (!cadastro) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      preencherDadosMotorista(cadastro);
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
    }
  }

  // Buscar cadastro geral por nome
  async function buscarMotoristaPorNome() {
    const nome = document.getElementById('motoristaNome')?.value.trim();
    if (!nome || nome.length < 3) {
      showMessage('Informe pelo menos 3 caracteres do nome.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const response = await fetch(`/api/viagens/cadastros-gerais/buscar?nome=${encodeURIComponent(nome)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      if (Array.isArray(cadastros) && cadastros.length > 1) {
        // Se houver múltiplos resultados, mostrar o primeiro
        showMessage(`Encontrados ${cadastros.length} cadastros. Exibindo o primeiro.`, 'info');
        // Garantir que o ID da viagem está definido antes de preencher
        const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
        if (idViagem) {
          document.getElementById('motoristaIdViagem').value = idViagem;
        }
        preencherDadosMotorista(cadastros[0]);
      } else {
        const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
        if (!cadastro) {
          showMessage('Cadastro não encontrado.', 'error');
          return;
        }
        // Garantir que o ID da viagem está definido antes de preencher
        const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
        if (idViagem) {
          document.getElementById('motoristaIdViagem').value = idViagem;
        }
        preencherDadosMotorista(cadastro);
      }
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
    }
  }

  // Buscar cadastro geral por código
  async function buscarMotoristaPorCodigo() {
    const codigoInput = document.getElementById('motoristaCodigo');
    if (!codigoInput) {
      showMessage('Campo de código não encontrado.', 'error');
      return;
    }
    
    // Pegar valor e converter para número (pode vir como string do input number)
    let codigo = codigoInput.value;
    if (codigo) {
      codigo = codigo.toString().trim();
    }
    
    if (!codigo) {
      showMessage('Informe o código do cadastro.', 'error');
      return;
    }

    // Validar se é um número válido
    const codigoNum = parseFloat(codigo);
    if (isNaN(codigoNum) || codigoNum <= 0) {
      showMessage('Código inválido. Informe um número válido.', 'error');
      return;
    }

    // Definir ID da viagem se disponível (mas não obrigatório para busca)
    const idViagem = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
    if (idViagem) {
      document.getElementById('motoristaIdViagem').value = idViagem;
    }

    try {
      const url = `/api/viagens/cadastros-gerais/buscar?codigo=${encodeURIComponent(codigoNum)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Erro ao buscar cadastro.' }));
        showMessage(error.error || 'Cadastro não encontrado.', 'error');
        return;
      }

      const cadastros = await response.json();
      
      if (!cadastros || (Array.isArray(cadastros) && cadastros.length === 0)) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      const cadastro = Array.isArray(cadastros) ? cadastros[0] : cadastros;
      if (!cadastro) {
        showMessage('Cadastro não encontrado.', 'error');
        return;
      }

      // Garantir que o ID da viagem está definido antes de preencher
      const idViagemFinal = document.getElementById('viagemId')?.value || document.getElementById('motoristaIdViagem')?.value;
      if (idViagemFinal) {
        document.getElementById('motoristaIdViagem').value = idViagemFinal;
      }

      preencherDadosMotorista(cadastro);
    } catch (err) {
      console.error('Erro ao buscar motorista:', err);
      showMessage('Erro ao buscar motorista: ' + err.message, 'error');
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

  // Formatar celular
  function formatarCelular(celular) {
    if (!celular) return '';
    const value = String(celular).replace(/\D/g, '');
    if (value.length === 11) {
      return value.replace(/(\d{2})(\d{1})(\d{4})(\d{4})/, '($1) $2 $3-$4');
    }
    return value;
  }

  // Formatar CEP
  function formatarCEP(cep) {
    if (!cep) return '';
    const value = String(cep).replace(/\D/g, '');
    if (value.length === 8) {
      return value.replace(/(\d{5})(\d{3})/, '$1-$2');
    }
    return value;
  }

  // Mapear tipos
  const TIPO_PESSOA = {
    'F': 'Física',
    'J': 'Jurídica'
  };

  const TIPO_CADASTRO = {
    'O': 'Operador do Sistema',
    'M': 'Motorista',
    'A': 'Agente',
    'G': 'Grupo de Divulgação',
    'T': 'Transportador',
    'U': 'Unidade de Negócio'
  };

  // Preencher dados do motorista
  function preencherDadosMotorista(cadastro) {
    if (!cadastro) {
      console.error('Cadastro vazio ou inválido:', cadastro);
      showMessage('Erro: Dados do cadastro inválidos.', 'error');
      return;
    }

    // Usar CDCADASTROGERAL ou CDCADASTRO (compatibilidade)
    const codigo = cadastro.CDCADASTROGERAL || cadastro.CDCADASTRO || '';
    
    // Campos de busca
    const codigoEl = document.getElementById('motoristaCodigo');
    const cpfEl = document.getElementById('motoristaCpf');
    const nomeEl = document.getElementById('motoristaNome');
    
    if (codigoEl) codigoEl.value = codigo;
    if (cpfEl) cpfEl.value = formatarCPFCNPJ(cadastro.CGCCPF || '');
    if (nomeEl) nomeEl.value = cadastro.RZSOCIAL || cadastro.NMFANTASIA || '';

    // Dados completos - proteger todos os acessos
    const codigoDisplayEl = document.getElementById('motoristaCodigoDisplay');
    if (codigoDisplayEl) codigoDisplayEl.value = codigo;
    
    const cpfCnpjEl = document.getElementById('motoristaCpfCnpj');
    if (cpfCnpjEl) cpfCnpjEl.value = formatarCPFCNPJ(cadastro.CGCCPF || '');
    
    const razaoSocialEl = document.getElementById('motoristaRazaoSocial');
    if (razaoSocialEl) razaoSocialEl.value = cadastro.RZSOCIAL || cadastro.NMFANTASIA || '';
    
    // Transportador: Código - Nome
    const transportadorTexto = cadastro.CDTRANSPORTADOR 
      ? `${cadastro.CDTRANSPORTADOR} - ${cadastro.TRANSPORTADOR_NOME || 'Não informado'}`
      : 'Não informado';
    const transportadorEl = document.getElementById('motoristaTransportador');
    if (transportadorEl) transportadorEl.value = transportadorTexto;
    
    // Tipo Pessoa
    const tipoPessoa = TIPO_PESSOA[cadastro.FGFISICAJURIDICA] || cadastro.FGFISICAJURIDICA || 'Não informado';
    const tipoPessoaEl = document.getElementById('motoristaTipoPessoa');
    if (tipoPessoaEl) tipoPessoaEl.value = tipoPessoa;
    
    // Tipo Cadastro
    const tipoCadastro = TIPO_CADASTRO[cadastro.FGTIPOCADASTRO] || cadastro.FGTIPOCADASTRO || 'Não informado';
    const tipoCadastroEl = document.getElementById('motoristaTipoCadastro');
    if (tipoCadastroEl) tipoCadastroEl.value = tipoCadastro;
    
    // Possui Veículo Rastreado
    const rastreado = cadastro.FGRASTREADO === 'S' ? 'Sim' : cadastro.FGRASTREADO === 'N' ? 'Não' : 'Não informado';
    const rastreadoEl = document.getElementById('motoristaRastreado');
    if (rastreadoEl) rastreadoEl.value = rastreado;
    
    // Situação
    const situacao = cadastro.FGACTIVE === 'A' || cadastro.FGACTIVE === 'S' ? 'Ativo' : 'Inativo';
    const situacaoEl = document.getElementById('motoristaSituacao');
    if (situacaoEl) situacaoEl.value = situacao;
    
    // CEP
    const cepEl = document.getElementById('motoristaCEP');
    if (cepEl) cepEl.value = formatarCEP(cadastro.CEP || '');
    
    // Endereço
    const enderecoEl = document.getElementById('motoristaEndereco');
    if (enderecoEl) enderecoEl.value = cadastro.ENDERECO || '';
    const numeroEl = document.getElementById('motoristaNumero');
    if (numeroEl) numeroEl.value = cadastro.NRENDERECO || '';
    const bairroEl = document.getElementById('motoristaBairro');
    if (bairroEl) bairroEl.value = cadastro.BAIRRO || '';
    const complementoEl = document.getElementById('motoristaComplemento');
    if (complementoEl) complementoEl.value = cadastro.COMPLEND || '';
    
    // Cidade
    const estado = cadastro.CIDADE_ESTADO || '';
    const cidade = cadastro.CIDADE_NOME || '';
    const ufEl = document.getElementById('motoristaUf');
    if (ufEl) ufEl.value = estado || 'Não informado';
    const cidadeEl = document.getElementById('motoristaCidade');
    if (cidadeEl) cidadeEl.value = cidade || 'Não informado';
    const codigoCidadeEl = document.getElementById('motoristaCodigoCidade');
    if (codigoCidadeEl) codigoCidadeEl.value = cadastro.CDCIDADE || '';
    
    // Latitude e Longitude
    const latEl = document.getElementById('motoristaLatitude');
    if (latEl) latEl.value = cadastro.LATITUDE ? cadastro.LATITUDE.toFixed(6).replace('.', ',') : '';
    const lonEl = document.getElementById('motoristaLongitude');
    if (lonEl) lonEl.value = cadastro.LONGITUDE ? cadastro.LONGITUDE.toFixed(6).replace('.', ',') : '';
    
    // Email e Celular
    const emailEl = document.getElementById('motoristaEmail');
    if (emailEl) emailEl.value = cadastro.ENDEMAIL || '';
    const celularEl = document.getElementById('motoristaCelular');
    if (celularEl) celularEl.value = formatarCelular(cadastro.NRCELULAR || '');

    // Exibir dados completos
    const dadosCompletosEl = document.getElementById('motoristaDadosCompletos');
    const semDadosEl = document.getElementById('motoristaSemDados');
    
    if (dadosCompletosEl) {
      dadosCompletosEl.style.display = 'block';
    } else {
      console.error('Elemento motoristaDadosCompletos não encontrado!');
    }
    
    if (semDadosEl) {
      semDadosEl.style.display = 'none';
    }
    
    showMessage('Motorista encontrado!', 'success');
  }

  // Salvar motorista na viagem
  async function salvarMotorista(e) {
    e.preventDefault();
    const idViagem = document.getElementById('motoristaIdViagem')?.value;
    const cdmotorista = document.getElementById('motoristaCodigo')?.value;

    if (!idViagem) {
      showMessage('Selecione uma viagem primeiro.', 'error');
      return;
    }

    if (!cdmotorista) {
      showMessage('Informe o código do motorista.', 'error');
      return;
    }

    // Validar se são números válidos
    const idViagemNum = parseFloat(idViagem);
    const cdmotoristaNum = parseFloat(cdmotorista);
    
    if (isNaN(idViagemNum) || idViagemNum <= 0) {
      showMessage('ID da viagem inválido.', 'error');
      return;
    }
    
    if (isNaN(cdmotoristaNum) || cdmotoristaNum <= 0) {
      showMessage('Código do motorista inválido.', 'error');
      return;
    }

    try {
      const response = await fetch(`/api/viagens/${idViagemNum}/motorista`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cdmotorista: cdmotoristaNum
        })
      });

      const result = await response.json();

      if (response.ok) {
        showMessage(result.message || 'Motorista salvo com sucesso!', 'success');
        // Limpar formulário após salvar
        limparFormularioMotorista();
        // Recarregar lista de motoristas
        if (idViagemNum) {
          await carregarMotoristaViagem(idViagemNum);
        }
      } else {
        console.error('Erro ao salvar motorista:', result);
        showMessage(result.error || 'Erro ao salvar motorista.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar motorista:', err);
      showMessage('Erro ao salvar motorista: ' + err.message, 'error');
    }
  }

  // Limpar formulário de motorista completamente
  function limparFormularioMotorista() {
    // Limpar campos de busca
    document.getElementById('motoristaCodigo').value = '';
    document.getElementById('motoristaCpf').value = '';
    document.getElementById('motoristaNome').value = '';
    
    // Limpar campos de exibição
    const camposDisplay = [
      'motoristaCodigoDisplay',
      'motoristaCpfCnpj',
      'motoristaRazaoSocial',
      'motoristaTransportador',
      'motoristaTipoPessoa',
      'motoristaTipoCadastro',
      'motoristaRastreado',
      'motoristaSituacao',
      'motoristaCEP',
      'motoristaEndereco',
      'motoristaNumero',
      'motoristaBairro',
      'motoristaComplemento',
      'motoristaUf',
      'motoristaCidade',
      'motoristaCodigoCidade',
      'motoristaLatitude',
      'motoristaLongitude',
      'motoristaEmail',
      'motoristaCelular'
    ];
    
    camposDisplay.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    
    // Ocultar seções
    document.getElementById('motoristaDadosCompletos').style.display = 'none';
    document.getElementById('motoristaSemDados').style.display = 'none';
    document.getElementById('motoristaIdViagem').value = '';
  }

  // Carregar motorista da viagem
  // Carregar lista de motoristas da viagem
  async function carregarMotoristaViagem(idViagem) {
    if (!idViagem) {
      limparFormularioMotorista();
      limparListaMotoristas();
      return;
    }

    limparFormularioMotorista();
    document.getElementById('motoristaIdViagem').value = idViagem;

    try {
      const response = await fetch(`/api/viagens/${idViagem}/motorista`).catch(() => null);
      if (!response) {
        limparListaMotoristas();
        return;
      }
      
      if (response.ok) {
        const motoristas = await response.json();
        // Agora retorna uma LISTA (array)
        if (Array.isArray(motoristas) && motoristas.length > 0) {
          exibirListaMotoristas(motoristas);
        } else {
          limparListaMotoristas();
        }
      } else if (response.status === 404) {
        // Nenhum motorista cadastrado - normal
        limparListaMotoristas();
      } else {
        const error = await response.json().catch(() => ({ error: 'Erro ao carregar motoristas.' }));
        console.error('Erro ao carregar motoristas:', error);
        limparListaMotoristas();
      }
    } catch (err) {
      if (err.message && !err.message.includes('404')) {
        console.error('Erro ao carregar motoristas:', err);
      }
      limparListaMotoristas();
    }
  }

  // Exibir lista de motoristas
  function exibirListaMotoristas(motoristas) {
    const listaContainer = document.getElementById('motoristaLista');
    const listaVazia = document.getElementById('motoristaListaVazia');
    
    if (!listaContainer || !listaVazia) return;

    listaVazia.style.display = 'none';
    listaContainer.innerHTML = '';

    motoristas.forEach(motorista => {
      const card = document.createElement('div');
      card.style.cssText = 'padding: 15px; background: white; border: 1px solid #ddd; border-radius: 8px; display: flex; justify-content: space-between; align-items: center;';
      
      const info = document.createElement('div');
      info.style.cssText = 'flex: 1;';
      
      // Formatar CPF/CNPJ
      const cpfCnpj = motorista.CGCCPF || '';
      const cpfFormatado = cpfCnpj.length === 11 
        ? cpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
        : cpfCnpj.length === 14
        ? cpfCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
        : cpfCnpj;
      
      info.innerHTML = `
        <div style="font-weight: 600; color: #333; margin-bottom: 5px;">
          ${motorista.RZSOCIAL || motorista.NMFANTASIA || 'N/A'}
        </div>
        <div style="font-size: 0.9em; color: #666;">
          Código: ${motorista.CDMOTORISTA || motorista.CDCADASTROGERAL || 'N/A'} | 
          CPF/CNPJ: ${cpfFormatado || 'N/A'} | 
          ${motorista.CIDADE_NOME ? `${motorista.CIDADE_NOME} - ${motorista.CIDADE_ESTADO || ''}` : ''}
        </div>
      `;
      
      const btnContainer = document.createElement('div');
      btnContainer.style.cssText = 'display: flex; gap: 10px; margin-left: 15px;';
      
      // Botão WhatsApp (se tiver celular válido)
      const celular = motorista.NRCELULAR || '';
      const celularFormatado = celular.toString().replace(/\D/g, '');
      const temWhatsApp = celularFormatado.length >= 10;
      
      if (temWhatsApp) {
        const linkWhatsApp = `https://wa.me/55${celularFormatado}`;
        const btnWhatsApp = document.createElement('a');
        btnWhatsApp.href = linkWhatsApp;
        btnWhatsApp.target = '_blank';
        btnWhatsApp.className = 'btn';
        btnWhatsApp.style.cssText = 'background: #25D366; color: white; padding: 8px 15px; white-space: nowrap; text-decoration: none; display: inline-flex; align-items: center; gap: 5px;';
        btnWhatsApp.innerHTML = '<span style="font-size: 1.2em;">📱</span> WhatsApp';
        btnWhatsApp.title = `Abrir WhatsApp de ${celular}`;
        btnContainer.appendChild(btnWhatsApp);
      }
      
      const btnVerDados = document.createElement('button');
      btnVerDados.type = 'button';
      btnVerDados.className = 'btn info';
      btnVerDados.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnVerDados.innerHTML = '👁️ Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosMotorista(motorista);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn';
      btnValidades.style.cssText = 'padding: 8px 15px; white-space: nowrap; background: #667eea; color: white;';
      btnValidades.innerHTML = '📋 Validades';
      const cdMotorista = motorista.CDMOTORISTA || motorista.CDCADASTROGERAL;
      const nomeMotorista = motorista.RZSOCIAL || motorista.NMFANTASIA || 'Motorista';
      btnValidades.onclick = () => mostrarValidadesMotorista(cdMotorista, nomeMotorista);
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn cancel';
      btnRemover.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnRemover.innerHTML = '🗑️ Remover';
      btnRemover.onclick = () => removerMotoristaViagem(motorista.IDVIAGEM, cdMotorista);
      
      btnContainer.appendChild(btnVerDados);
      btnContainer.appendChild(btnValidades);
      btnContainer.appendChild(btnRemover);
      
      card.appendChild(info);
      card.appendChild(btnContainer);
      listaContainer.appendChild(card);
    });
  }

  // Limpar lista de motoristas
  function limparListaMotoristas() {
    const listaContainer = document.getElementById('motoristaLista');
    const listaVazia = document.getElementById('motoristaListaVazia');
    
    if (listaContainer) listaContainer.innerHTML = '';
    if (listaVazia) listaVazia.style.display = 'block';
  }

  // Remover motorista da viagem
  async function removerMotoristaViagem(idViagem, cdmotorista) {
    if (!confirm(`Tem certeza que deseja remover este motorista da viagem?`)) {
      return;
    }

    try {
      const response = await fetch(`/api/viagens/${idViagem}/motorista/${cdmotorista}`, {
        method: 'DELETE'
      });

      const result = await response.json();
      if (response.ok) {
        showMessage(result.message || 'Motorista removido com sucesso!', 'success');
        // Recarregar lista
        await carregarMotoristaViagem(idViagem);
      } else {
        showMessage(result.error || 'Erro ao remover motorista.', 'error');
      }
    } catch (err) {
      console.error('Erro ao remover motorista:', err);
      showMessage('Erro ao remover motorista.', 'error');
    }
  }

  // Mostrar dados completos do motorista em modal
  function mostrarDadosCompletosMotorista(motorista) {
    const modal = document.getElementById('modalDadosMotorista');
    const conteudo = document.getElementById('modalMotoristaConteudo');
    
    if (!modal || !conteudo) return;

    // Formatar dados
    const formatarValor = (valor, sufixo = '') => {
      if (valor === null || valor === undefined || valor === '') return 'Não informado';
      return `${valor}${sufixo}`;
    };

    const formatarSimNao = (valor) => {
      if (valor === 'S' || valor === 's' || valor === true) return 'Sim';
      if (valor === 'N' || valor === 'n' || valor === false) return 'Não';
      return formatarValor(valor);
    };

    const formatarTipoPessoa = (valor) => {
      if (valor === 'F' || valor === 'f') return 'Física';
      if (valor === 'J' || valor === 'j') return 'Jurídica';
      return formatarValor(valor);
    };

    // Formatar CPF/CNPJ
    const cpfCnpj = motorista.CGCCPF || '';
    const cpfFormatado = cpfCnpj.length === 11 
      ? cpfCnpj.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
      : cpfCnpj.length === 14
      ? cpfCnpj.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
      : cpfCnpj;

    // CEP sem formatação (como na imagem)
    const cep = motorista.CEP || '';
    const cepSemFormatacao = cep || 'Não informado';

    // Telefone sem formatação (como na imagem)
    const telefone = motorista.NRCELULAR || '';
    const telefoneSemFormatacao = telefone || 'Não informado';

    // Nome em maiúsculas (como na imagem)
    const nomeMotorista = (motorista.RZSOCIAL || motorista.NMFANTASIA || 'N/A').toUpperCase();

    conteudo.innerHTML = `
      <div class="modal-dados-completos-nome">${nomeMotorista}</div>

      <table class="modal-dados-completos-table">
        <tbody>
          <tr>
            <td>Código</td>
            <td>${formatarValor(motorista.CDMOTORISTA || motorista.CDCADASTROGERAL)}</td>
          </tr>
          <tr>
            <td>CPF/CNPJ</td>
            <td>${cpfFormatado || 'Não informado'}</td>
          </tr>
          <tr>
            <td>Tipo Pessoa</td>
            <td>${formatarTipoPessoa(motorista.FGFISICAJURIDICA)}</td>
          </tr>
          <tr>
            <td>Tipo Cadastro</td>
            <td>${formatarValor(motorista.FGTIPOCADASTRO)}</td>
          </tr>
          <tr>
            <td>Transportador</td>
            <td>${formatarValor(motorista.TRANSPORTADOR_NOME)}</td>
          </tr>
          <tr>
            <td>Situação</td>
            <td>${formatarValor(motorista.FGACTIVE)}</td>
          </tr>
          <tr>
            <td>Possui Veículo Rastreado</td>
            <td>${formatarSimNao(motorista.FGRASTREADO)}</td>
          </tr>
          <tr>
            <td>CEP</td>
            <td>${cepSemFormatacao}</td>
          </tr>
          <tr>
            <td>Endereço</td>
            <td>${formatarValor(motorista.ENDERECO)}</td>
          </tr>
          <tr>
            <td>Número</td>
            <td>${formatarValor(motorista.NRENDERECO)}</td>
          </tr>
          <tr>
            <td>Bairro</td>
            <td>${formatarValor(motorista.BAIRRO)}</td>
          </tr>
          <tr>
            <td>Complemento</td>
            <td>${formatarValor(motorista.COMPLEND)}</td>
          </tr>
          <tr>
            <td>Cidade</td>
            <td>${formatarValor(motorista.CIDADE_NOME)}</td>
          </tr>
          <tr>
            <td>Estado</td>
            <td>${formatarValor(motorista.CIDADE_ESTADO)}</td>
          </tr>
          <tr>
            <td>Email</td>
            <td>${formatarValor(motorista.ENDEMAIL)}</td>
          </tr>
          <tr>
            <td>Celular</td>
            <td>${telefoneSemFormatacao}</td>
          </tr>
        </tbody>
      </table>
    `;

    // Mostrar modal
    modal.style.display = 'flex';
    
    // Event listener para fechar
    const btnFechar = document.getElementById('btnFecharModalMotorista');
    if (btnFechar) {
      btnFechar.onclick = () => {
        modal.style.display = 'none';
      };
    }

    // Fechar ao clicar fora do modal
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    
    // Fechar com ESC
    const fecharComESC = (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', fecharComESC);
      }
    };
    document.addEventListener('keydown', fecharComESC);
  }

  // Função para registrar event listeners
  function registrarEventListeners() {
    // Botões de busca de veículo
    const btnBuscarVeiculoPorPlaca = document.getElementById('btnBuscarVeiculoPorPlaca');
    const btnBuscarVeiculoPorCodigo = document.getElementById('btnBuscarVeiculoPorCodigo');
    
    if (btnBuscarVeiculoPorPlaca) {
      // Remover listener anterior se existir
      btnBuscarVeiculoPorPlaca.replaceWith(btnBuscarVeiculoPorPlaca.cloneNode(true));
      document.getElementById('btnBuscarVeiculoPorPlaca').addEventListener('click', buscarEquipamentoPorPlaca);
    }
    
    if (btnBuscarVeiculoPorCodigo) {
      btnBuscarVeiculoPorCodigo.replaceWith(btnBuscarVeiculoPorCodigo.cloneNode(true));
      document.getElementById('btnBuscarVeiculoPorCodigo').addEventListener('click', buscarEquipamentoPorCodigo);
    }
    
    // Botões de busca de motorista
    const btnBuscarMotoristaPorCpf = document.getElementById('btnBuscarMotoristaPorCpf');
    const btnBuscarMotoristaPorNome = document.getElementById('btnBuscarMotoristaPorNome');
    const btnBuscarMotoristaPorCodigo = document.getElementById('btnBuscarMotoristaPorCodigo');
    
    if (btnBuscarMotoristaPorCpf) {
      btnBuscarMotoristaPorCpf.replaceWith(btnBuscarMotoristaPorCpf.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorCpf').addEventListener('click', buscarMotoristaPorCpf);
    }
    
    if (btnBuscarMotoristaPorNome) {
      btnBuscarMotoristaPorNome.replaceWith(btnBuscarMotoristaPorNome.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorNome').addEventListener('click', buscarMotoristaPorNome);
    }
    
    if (btnBuscarMotoristaPorCodigo) {
      btnBuscarMotoristaPorCodigo.replaceWith(btnBuscarMotoristaPorCodigo.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorCodigo').addEventListener('click', buscarMotoristaPorCodigo);
    }
    
    // Outros listeners
    document.getElementById('veiculoForm')?.addEventListener('submit', salvarVeiculo);
    document.getElementById('btnLimparVeiculo')?.addEventListener('click', limparFormularioVeiculo);
    document.getElementById('btnVoltarVeiculo')?.addEventListener('click', () => showTab('filtros'));
    document.getElementById('motoristaForm')?.addEventListener('submit', salvarMotorista);
    document.getElementById('btnLimparMotorista')?.addEventListener('click', limparFormularioMotorista);
    document.getElementById('btnVoltarMotorista')?.addEventListener('click', () => showTab('filtros'));
    
    // Botão de guia completo de envio (aba Convocações)
    const btnGuiaCompleto = document.getElementById('btnGuiaEnvioConvocacoes');
    if (btnGuiaCompleto) {
      btnGuiaCompleto.replaceWith(btnGuiaCompleto.cloneNode(true));
      document.getElementById('btnGuiaEnvioConvocacoes').addEventListener('click', mostrarGuiaCompletoEnvio);
    }
    
    // Botão fechar guia completo
    const btnFecharGuiaCompleto = document.getElementById('btnFecharGuiaCompleto');
    if (btnFecharGuiaCompleto) {
      btnFecharGuiaCompleto.addEventListener('click', () => {
        document.getElementById('modalGuiaCompletoEnvio').style.display = 'none';
      });
    }
  }

  // Registrar listeners quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registrarEventListeners);
  } else {
    // DOM já está pronto
    registrarEventListeners();
  }
  
  // Também tentar registrar após um pequeno delay (caso os elementos sejam carregados dinamicamente)
  setTimeout(registrarEventListeners, 500);
  
  // Registrar novamente quando a aba for aberta (caso os elementos sejam carregados dinamicamente)
  // Isso já é feito no showTab interceptado abaixo, então não precisa duplicar

  // Interceptar showTab para carregar dados quando necessário
  const originalShowTab = showTab;
  showTab = async function(tabId) {
    await originalShowTab(tabId);
    
    // Registrar listeners novamente quando a aba for aberta (caso os elementos sejam carregados dinamicamente)
    if (tabId === 'veiculo' || tabId === 'motorista') {
      setTimeout(registrarEventListeners, 100);
    }
    
    if (tabId === 'veiculo') {
      // Carregar tipos de equipamento quando abrir a aba
      await carregarTiposEquipamento();
      
      const idViagem = document.getElementById('viagemId')?.value;
      if (idViagem) {
        await carregarVeiculoViagem(idViagem);
      }
    } else if (tabId === 'motorista') {
      const idViagem = document.getElementById('viagemId')?.value;
      if (idViagem) {
        await carregarMotoristaViagem(idViagem);
      }
    }
  };

  // Expor funções globalmente para uso em onclick
  window.buscarEquipamentoPorPlaca = buscarEquipamentoPorPlaca;
  window.buscarEquipamentoPorCodigo = buscarEquipamentoPorCodigo;
  window.buscarMotoristaPorCpf = buscarMotoristaPorCpf;
  window.buscarMotoristaPorNome = buscarMotoristaPorNome;
  window.buscarMotoristaPorCodigo = buscarMotoristaPorCodigo;

  // =======================
  // ABA HISTÓRICO
  // =======================
  
  let historicoCarregado = false;
  let historicoViagens = [];
  
  // Inicializar aba Histórico
  function inicializarAbaHistorico() {
    const btnVoltarHistorico = document.getElementById('btnVoltarHistorico');
    const btnCarregarHistorico = document.getElementById('btnCarregarHistorico');
    
    if (btnVoltarHistorico && !btnVoltarHistorico.dataset.listenerAdded) {
      btnVoltarHistorico.dataset.listenerAdded = 'true';
      btnVoltarHistorico.addEventListener('click', () => {
        showTab('filtros');
      });
    }
    
    if (btnCarregarHistorico && !btnCarregarHistorico.dataset.listenerAdded) {
      btnCarregarHistorico.dataset.listenerAdded = 'true';
      btnCarregarHistorico.addEventListener('click', carregarHistoricoRoteiro);
    }
  }
  
  // Carregar histórico do roteiro
  async function carregarHistoricoRoteiro() {
    try {
      // Pegar o ID do roteiro da aba Dados
      const selectRoteiro = document.getElementById('viagemRoteiro');
      const idRoteiro = selectRoteiro?.value;
      
      if (!idRoteiro || idRoteiro === '') {
        showMessage('Por favor, selecione um roteiro na aba Dados primeiro.', 'error');
        return;
      }
      
      // Pegar o nome do roteiro para exibir
      const nomeRoteiro = selectRoteiro?.selectedOptions[0]?.text || 'Roteiro';
      console.log('[HISTÓRICO] Carregando histórico do roteiro:', idRoteiro, nomeRoteiro);
      
      showMessage('Carregando histórico...', 'info');
      
      const response = await fetch(`/api/viagens/historico-roteiro?idRoteiro=${idRoteiro}`);
      
      if (!response.ok) {
        throw new Error('Erro ao carregar histórico');
      }
      
      const data = await response.json();
      
      if (data.success) {
        historicoViagens = data.viagens || [];
        historicoCarregado = true;
        
        // Atualizar título com nome do roteiro
        const tituloHistorico = document.querySelector('#tab-historico h2');
        if (tituloHistorico) {
          tituloHistorico.innerHTML = `Histórico de Viagens do Roteiro <span style="color: #667eea;">${nomeRoteiro}</span>`;
        }
        
        // Atualizar contador
        const countDiv = document.getElementById('historicoCount');
        const countText = document.getElementById('historicoCountText');
        if (countDiv && countText) {
          countText.textContent = `${data.totalRegistros || 0} viagem(ns) encontrada(s) no roteiro ${nomeRoteiro}`;
          countDiv.style.display = 'block';
        }
        
        // Renderizar resumo
        renderizarResumoHistorico(data.resumo || []);
        
        // Renderizar viagens
        renderizarHistoricoViagens(historicoViagens);
        
        // Mostrar legenda
        const legenda = document.getElementById('historicoLegenda');
        if (legenda) {
          legenda.style.display = historicoViagens.length > 0 ? 'block' : 'none';
        }
        
        showMessage(`${data.totalRegistros || 0} viagem(ns) carregada(s) com sucesso!`, 'success');
      } else {
        throw new Error(data.error || 'Erro ao carregar histórico');
      }
    } catch (err) {
      console.error('Erro ao carregar histórico:', err);
      showMessage('Erro ao carregar histórico: ' + err.message, 'error');
    }
  }
  
  // Renderizar resumo por classe de frota
  function renderizarResumoHistorico(resumo) {
    const resumoDiv = document.getElementById('historicoResumo');
    const resumoContent = document.getElementById('historicoResumoContent');
    
    if (!resumoDiv || !resumoContent) return;
    
    if (!resumo || resumo.length === 0) {
      resumoDiv.style.display = 'none';
      return;
    }
    
    resumoDiv.style.display = 'block';
    
    let html = '';
    resumo.forEach(item => {
      html += `
        <div style="background: white; padding: 15px 20px; border-radius: 8px; border: 1px solid #e9ecef; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong style="color: #2c3e50; font-size: 16px;">${item.classefrota}</strong>
            <span style="background: #667eea; color: white; padding: 4px 12px; border-radius: 20px; font-size: 13px; font-weight: 600;">
              ${item.quantidade} viagem(ns)
            </span>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-top: 12px;">
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Mínimo</div>
              <div style="font-size: 15px; font-weight: 600; color: #27ae60;">R$ ${item.valorMinimo}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Máximo</div>
              <div style="font-size: 15px; font-weight: 600; color: #e74c3c;">R$ ${item.valorMaximo}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Valor Médio</div>
              <div style="font-size: 15px; font-weight: 600; color: #3498db;">R$ ${item.valorMedio}</div>
            </div>
            <div>
              <div style="font-size: 12px; color: #6c757d; margin-bottom: 4px;">Peso Total</div>
              <div style="font-size: 15px; font-weight: 600; color: #9b59b6;">${item.pesoTotal} kg</div>
            </div>
          </div>
        </div>
      `;
    });
    
    resumoContent.innerHTML = html;
  }
  
  // Renderizar viagens do histórico
  function renderizarHistoricoViagens(viagens) {
    const grid = document.getElementById('historicoViagensGrid');
    if (!grid) return;
    
    if (!viagens || viagens.length === 0) {
      grid.innerHTML = '<p class="empty">Nenhuma viagem encontrada para este roteiro.</p>';
      return;
    }
    
    let html = '<div style="display: grid; gap: 12px;">';
    
    viagens.forEach(viagem => {
      const rastreado = viagem.rastreado === 'Sim';
      const iconRastreado = rastreado 
        ? '<span style="color: #27ae60; font-size: 16px;" title="Rastreado">●</span>' 
        : '<span style="color: #e74c3c; font-size: 16px;" title="Não Rastreado">●</span>';
      
      const dtInicio = viagem.dtPrevInicio ? new Date(viagem.dtPrevInicio).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : 'Não informado';
      
      html += `
        <div style="background: #ffffff; border: 1px solid #dee2e6; border-left: 4px solid #667eea; border-radius: 6px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); transition: all 0.2s ease;" 
             onmouseover="this.style.boxShadow='0 3px 8px rgba(0,0,0,0.12)'; this.style.borderLeftColor='#764ba2'; this.style.transform='translateX(2px)';" 
             onmouseout="this.style.boxShadow='0 1px 3px rgba(0,0,0,0.08)'; this.style.borderLeftColor='#667eea'; this.style.transform='translateX(0)';">
          
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 15px;">
            <div style="display: flex; align-items: center; gap: 8px; flex: 1; flex-wrap: wrap;">
              <h3 style="margin: 0; color: #2c3e50; font-size: 16px; font-weight: 700; white-space: nowrap;">
                ${iconRastreado} #${viagem.idViagem}
              </h3>
              <span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                ${viagem.situacaoViagem || 'N/A'}
              </span>
              <span style="color: #6c757d; font-size: 12px;">
                ${viagem.tipoViagem || 'N/A'} • ${viagem.classeFrota || 'N/A'}
              </span>
            </div>
            <div style="text-align: right;">
              <div style="font-size: 20px; font-weight: 700; color: #27ae60; white-space: nowrap;">R$ ${viagem.vlFrete}</div>
              <div style="font-size: 11px; color: #6c757d; white-space: nowrap;">Peso: ${viagem.peso} kg</div>
            </div>
          </div>
          
          <div style="border-top: 1px solid #e9ecef; padding-top: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px;">
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">📅 Data Prevista</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${dtInicio}</div>
            </div>
            
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">🏢 Contratador</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${viagem.contratador || 'Não informado'}</div>
              ${viagem.celContratador ? `
                <a href="https://wa.me/55${String(viagem.celContratador).replace(/\D/g, '')}" 
                   target="_blank" 
                   style="font-size: 13px; color: #25D366; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; font-weight: 600;"
                   onmouseover="this.style.color='#20BA59'; this.style.textDecoration='underline';" 
                   onmouseout="this.style.color='#25D366'; this.style.textDecoration='none';"
                   title="Clique para abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  ${viagem.celContratador}
                </a>
              ` : ''}
            </div>
            
            <div>
              <div style="font-size: 11px; color: #6c757d; margin-bottom: 3px; font-weight: 500;">👤 Motorista</div>
              <div style="font-size: 13px; font-weight: 600; color: #2c3e50;">${viagem.motorista}</div>
              ${viagem.celMotorista ? `
                <a href="https://wa.me/55${String(viagem.celMotorista).replace(/\D/g, '')}" 
                   target="_blank" 
                   style="font-size: 13px; color: #25D366; margin-top: 4px; display: inline-flex; align-items: center; gap: 4px; text-decoration: none; font-weight: 600;"
                   onmouseover="this.style.color='#20BA59'; this.style.textDecoration='underline';" 
                   onmouseout="this.style.color='#25D366'; this.style.textDecoration='none';"
                   title="Clique para abrir WhatsApp">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
                  </svg>
                  ${viagem.celMotorista}
                </a>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
    grid.innerHTML = html;
  }

})();