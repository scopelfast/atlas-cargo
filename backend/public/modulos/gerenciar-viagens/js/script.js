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
        
        // Aguardar um pouco para garantir que a aba está totalmente visível
        await new Promise(resolve => setTimeout(resolve, 150));
        
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
          // Invalidar tamanho após limpar para garantir renderização
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho após limpar:', e);
          }
        }
        
        // Aguardar um pouco antes de atualizar
        await new Promise(resolve => setTimeout(resolve, 200));
        await atualizarMapa();
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
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full`;
      const response = await fetch(osrmUrl);
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
        // Verificar se o mapa está em estado válido
        if (mapa._loaded) {
          return true;
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
      
      // Limpar conteúdo anterior se houver
      mapaDiv.innerHTML = '';
      
      // Criar mapa centrado no Brasil
      mapa = L.map('mapaRota', {
        preferCanvas: false
      }).setView([-14.2350, -51.9253], 4);

      // Adicionar camada de tiles do OpenStreetMap
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      }).addTo(mapa);
      
      // Aguardar o mapa carregar completamente
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Forçar invalidateSize múltiplas vezes para garantir renderização correta
      for (let i = 0; i < 3; i++) {
        try {
          if (mapa) {
            mapa.invalidateSize();
          }
        } catch (e) {
          console.warn('Erro ao invalidar tamanho do mapa:', e);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
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

    // Inicializar mapa se ainda não foi inicializado
    if (!mapa) {
      const inicializado = await inicializarMapa();
      if (!inicializado) {
        console.error('Mapa não foi inicializado após tentativa');
        return;
      }
    }
    
    // Sempre invalidar tamanho antes de atualizar para garantir renderização correta
    try {
      if (mapa) {
        mapa.invalidateSize();
        // Aguardar um pouco após invalidar
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (e) {
      console.warn('Erro ao invalidar tamanho do mapa:', e);
    }

    try {
      // Se houver roteiro selecionado, buscar e exibir os pontos do roteiro
      if (roteiroId) {
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
              
              // Desenhar rota usando OSRM com todos os pontos
              try {
                const coordsStr = latlngs.map(c => `${c[1]},${c[0]}`).join(';');
                const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
                
                const response = await fetch(osrmUrl);
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
                // Erro ao obter rota do OSRM, usando linha reta
                // Fallback: linha reta entre pontos
                linhaRota = L.polyline(latlngs, {
                  color: '#3498db',
                  weight: 4,
                  opacity: 0.7,
                  dashArray: '10, 10'
                }).addTo(mapa);
              }
              
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
              
              return; // Sair da função após exibir pontos do roteiro
            }
          }
        } catch (err) {
          // Erro ao buscar pontos do roteiro, usando origem e destino
          // Continuar para exibir origem e destino
        }
      }
      
      // Se não houver roteiro ou se não conseguiu buscar pontos, usar origem e destino diretos
      // Buscar informações das cidades
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

      if (!origemCidade || !destinoCidade) {
        showMessage('Erro ao obter informações das cidades para o mapa.', 'error');
        return;
      }

      // Obter coordenadas
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
      ]);

      if (!coordsOrigem || !coordsDestino) {
        showMessage('Não foi possível obter as coordenadas para exibir o mapa.', 'error');
        return;
      }

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

      // Obter rota real usando OSRM (Open Source Routing Machine) via backend
      try {
        const params = new URLSearchParams({
          lon1: coordsOrigem.lon,
          lat1: coordsOrigem.lat,
          lon2: coordsDestino.lon,
          lat2: coordsDestino.lat
        });
        const rotaResponse = await fetch(`/api/cidades/rota?${params.toString()}`);
        
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
        console.error('Erro ao obter rota do OSRM:', err);
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

      // Ajustar o zoom para mostrar ambas as cidades
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

    } catch (err) {
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
  // Agora usa o utilitário de ambiente se disponível
  async function obterUrlPublica() {
    // Se a função utilitária estiver disponível, usar ela
    if (typeof window !== 'undefined' && typeof window.obterUrlBase === 'function') {
      try {
        return await window.obterUrlBase();
      } catch (err) {
        console.warn('[URL] Erro ao obter URL base do utilitário, usando fallback:', err);
      }
    }
    
    // Fallback: método original
    try {
      const response = await fetch('/api/public-url');
      const data = await response.json();
      
      return data.url || window.location.origin;
    } catch (err) {
      console.error('Erro ao obter URL pública:', err);
      return window.location.origin;
    }
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
          // Para domínios públicos (HTTPS), link clicável
          // Verificar se é ngrok (tem página de aviso)
          const isNgrok = urlBase.includes('ngrok-free.dev') || urlBase.includes('ngrok.io');
          
          if (isNgrok) {
            textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n👆 *Toque no link acima para responder*\n\n💡 *Aviso:* Na primeira vez, você verá uma página de segurança. Clique em "Visit Site" para continuar.`;
          } else {
            textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
          }
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

  // ============================================================================
  // FUNÇÕES DE ENVIO AUTOMÁTICO VIA WABOXAPP (NOVO - ISOLADO)
  // ============================================================================
  
  // Verificar se envio automático está disponível (usando endpoint específico)
  async function verificarEnvioAutomaticoDisponivel() {
    try {
      // Usar endpoint específico de verificação (não gera erros)
      // Adicionar timestamp para evitar cache
      const url = `/api/convocacoes/verificar-waboxapp?_t=${Date.now()}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        },
        cache: 'no-store'
      });
      
      if (!response.ok) {
        console.warn('[WABOXAPP] Erro ao verificar disponibilidade:', response.status, response.statusText);
        // Se der 404, tentar novamente sem cache
        if (response.status === 404) {
          console.log('[WABOXAPP] Tentando novamente sem cache...');
          const retryResponse = await fetch('/api/convocacoes/verificar-waboxapp', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store'
          });
          if (retryResponse.ok) {
            const retryResult = await retryResponse.json();
            return retryResult.configurado === true;
          }
        }
        return false;
      }
      
      const result = await response.json();
      
      // Log de debug (apenas no console)
      console.log('[WABOXAPP] Resposta da verificação:', result);
      
      if (result.debug) {
        console.log('[WABOXAPP] Status da configuração:', {
          configurado: result.configurado,
          enabled: result.debug.enabled,
          hasToken: result.debug.hasToken,
          hasUid: result.debug.hasUid,
          enabledValue: result.debug.enabledValue
        });
        
        if (!result.configurado && result.detalhes) {
          console.warn('[WABOXAPP] Detalhes do problema:', result.detalhes);
        }
      }
      
      return result.configurado === true;
    } catch (err) {
      console.error('[WABOXAPP] Erro ao verificar disponibilidade:', err);
      return false;
    }
  }

  // Enviar WhatsApp automaticamente via Waboxapp
  async function enviarWhatsAppAutomatico(linksWhatsApp) {
    if (!linksWhatsApp || linksWhatsApp.length === 0) {
      showMessage('Nenhuma convocação para enviar.', 'error');
      return;
    }

    // Filtrar apenas convocações com celular válido
    const convocacoesValidas = linksWhatsApp.filter(item => {
      if (!item.celular) return false;
      const celularLimpo = String(item.celular).replace(/\D/g, '');
      return celularLimpo.length >= 10;
    });

    if (convocacoesValidas.length === 0) {
      showMessage('Nenhuma convocação com celular válido para enviar.', 'error');
      return;
    }

    // Se houver convocações filtradas, avisar
    if (convocacoesValidas.length < linksWhatsApp.length) {
      const filtradas = linksWhatsApp.length - convocacoesValidas.length;
      const mensagem = `
        <div style="max-width: 600px;">
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 12px 15px; margin-bottom: 20px; border-radius: 4px;">
            <strong style="color: #856404;">⚠️ Atenção:</strong>
            <span style="color: #856404;"> ${filtradas} convocação(ões) sem celular válido serão ignoradas.</span>
          </div>
          
          <div style="margin-bottom: 20px;">
            <p style="margin: 10px 0; font-size: 16px;">
              <strong>Deseja enviar <span style="color: #25D366; font-size: 18px;">${convocacoesValidas.length}</span> mensagem(ns) automaticamente?</strong>
            </p>
          </div>
          
          <div style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f8f9fa;">
            <div style="padding: 10px; margin-bottom: 8px; background: #fff; border-radius: 4px; border-left: 3px solid #28a745;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">✅</span>
                <span style="color: #495057;">As mensagens serão enviadas imediatamente</span>
              </div>
            </div>
            <div style="padding: 10px; margin-bottom: 8px; background: #fff; border-radius: 4px; border-left: 3px solid #17a2b8;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">📊</span>
                <span style="color: #495057;">Você receberá um relatório de sucessos e falhas</span>
              </div>
            </div>
            <div style="padding: 10px; background: #fff; border-radius: 4px; border-left: 3px solid #6c757d;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">📝</span>
                <span style="color: #495057;">Todas as ações serão registradas para auditoria</span>
              </div>
            </div>
          </div>
        </div>
      `;
      
      const confirmar = await showConfirmModal('📱 Envio Automático via WhatsApp', mensagem);
      if (!confirmar) {
        return;
      }
    } else {
      // Confirmar ação
      const mensagem = `
        <div style="max-width: 600px;">
          <div style="margin-bottom: 20px;">
            <p style="margin: 10px 0; font-size: 16px;">
              <strong>Deseja enviar <span style="color: #25D366; font-size: 18px;">${convocacoesValidas.length}</span> mensagem(ns) automaticamente?</strong>
            </p>
          </div>
          
          <div style="max-height: 200px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 15px; background: #f8f9fa;">
            <div style="padding: 10px; margin-bottom: 8px; background: #fff; border-radius: 4px; border-left: 3px solid #28a745;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">✅</span>
                <span style="color: #495057;">As mensagens serão enviadas imediatamente</span>
              </div>
            </div>
            <div style="padding: 10px; margin-bottom: 8px; background: #fff; border-radius: 4px; border-left: 3px solid #17a2b8;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">📊</span>
                <span style="color: #495057;">Você receberá um relatório de sucessos e falhas</span>
              </div>
            </div>
            <div style="padding: 10px; background: #fff; border-radius: 4px; border-left: 3px solid #6c757d;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 18px;">📝</span>
                <span style="color: #495057;">Todas as ações serão registradas para auditoria</span>
              </div>
            </div>
          </div>
        </div>
      `;
      
      const confirmar = await showConfirmModal('📱 Envio Automático via WhatsApp', mensagem);
      if (!confirmar) {
        return;
      }
    }

    try {
      // Mostrar loading
      const btnEnviar = document.getElementById('btnEnviarAutomaticamente');
      if (btnEnviar) {
        btnEnviar.disabled = true;
        btnEnviar.textContent = '⏳ Enviando...';
      }

      showMessage('Enviando mensagens automaticamente...', 'info');

      // Extrair IDs das convocações (apenas as válidas)
      const idsConvocacoes = convocacoesValidas
        .map(item => {
          const id = item.idConvocacao;
        // Filtrar apenas IDs válidos
          return id;
        })
        .filter(id => id !== undefined && id !== null && id !== '' && !isNaN(parseInt(id)));

      if (idsConvocacoes.length === 0) {
        showMessage('Erro: Nenhum ID de convocação válido encontrado.', 'error');
        return;
      }

      // Chamar endpoint
      const response = await fetch('/api/convocacoes/enviar-whatsapp-automatico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idsConvocacoes })
      });

      let result;
      try {
        const textResponse = await response.text();
        result = JSON.parse(textResponse);
        console.log('[WABOXAPP] Resposta completa do servidor:', result);
      } catch (jsonError) {
        const textResponse = await response.text();
        console.error('[WABOXAPP] Erro ao parsear JSON:', jsonError);
        console.error('[WABOXAPP] Resposta do servidor:', textResponse);
        showMessage(`Erro ao processar resposta do servidor: ${response.status} ${response.statusText}\n\nResposta: ${textResponse.substring(0, 500)}`, 'error');
        return;
      }

      if (!response.ok) {
        // Montar mensagem de erro mais detalhada
        let mensagemErro = result.error || result.message || `Erro ${response.status}: ${response.statusText}`;
        if (result.details) {
          mensagemErro += `\n\nDetalhes: ${result.details}`;
        }
        if (result.idsInvalidos) {
          mensagemErro += `\n\nIDs inválidos: ${result.idsInvalidos.join(', ')}`;
        }
        if (result.received) {
          mensagemErro += `\n\nValor recebido: ${JSON.stringify(result.received)}`;
        }
        
        console.error('[WABOXAPP] Erro na resposta:', mensagemErro);
        showMessage(mensagemErro, 'error');
        return;
      }

      // Mostrar resultado
      console.log('[WABOXAPP] Processando resultado:', result);
      const { resumo, resultados, erros } = result;
      
      if (!resumo || !resultados) {
        console.error('[WABOXAPP] Estrutura de resposta inválida:', result);
        showMessage('Erro: Resposta do servidor em formato inválido.', 'error');
        return;
      }
      
      let mensagemResultado = '';
      if (resumo.sucessos > 0) {
        mensagemResultado += `✅ ${resumo.sucessos} mensagem(ns) enviada(s) com sucesso!\n`;
      }
      if (resumo.falhas > 0) {
        mensagemResultado += `❌ ${resumo.falhas} mensagem(ns) falharam.\n`;
      }
      if (resumo.errosValidacao > 0) {
        mensagemResultado += `⚠️ ${resumo.errosValidacao} erro(s) de validação.\n`;
      }

      // Mostrar detalhes em modal
      let detalhesHtml = `
        <div style="max-width: 600px;">
          <h3 style="color: #25D366; margin-bottom: 15px;">📊 Relatório de Envio</h3>
          <div style="margin-bottom: 20px;">
            <p><strong>Total:</strong> ${resumo.total} mensagem(ns)</p>
            <p style="color: #28a745;"><strong>✅ Sucessos:</strong> ${resumo.sucessos}</p>
            ${resumo.falhas > 0 ? `<p style="color: #dc3545;"><strong>❌ Falhas:</strong> ${resumo.falhas}</p>` : ''}
            ${resumo.errosValidacao > 0 ? `<p style="color: #ffc107;"><strong>⚠️ Erros:</strong> ${resumo.errosValidacao}</p>` : ''}
          </div>
      `;

      if (resultados.length > 0) {
        detalhesHtml += `
          <div style="max-height: 300px; overflow-y: auto; border: 1px solid #ddd; border-radius: 8px; padding: 10px;">
            <h4 style="margin-top: 0;">Detalhes:</h4>
        `;
        
        resultados.forEach(r => {
          const statusIcon = r.status === 'ENVIADO' ? '✅' : '❌';
          const statusColor = r.status === 'ENVIADO' ? '#28a745' : '#dc3545';
          detalhesHtml += `
            <div style="padding: 8px; margin-bottom: 5px; background: #f5f5f5; border-radius: 4px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 18px;">${statusIcon}</span>
                <div style="flex: 1;">
                  <strong>${r.nomeMotorista}</strong> (${r.celular})
                  ${r.mensagemErro ? `<br><small style="color: ${statusColor};">${r.mensagemErro}</small>` : ''}
                </div>
              </div>
            </div>
          `;
        });
        
        detalhesHtml += `</div>`;
      }

      // Mostrar erros de validação se houver
      if (erros && erros.length > 0) {
        detalhesHtml += `
          <div style="margin-top: 15px; padding: 15px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
            <h4 style="margin-top: 0; color: #856404;">⚠️ Erros de Validação:</h4>
            <div style="max-height: 200px; overflow-y: auto;">
        `;
        
        erros.forEach(erro => {
          detalhesHtml += `
            <div style="padding: 8px; margin-bottom: 5px; background: #fff; border-radius: 4px; border-left: 3px solid #ffc107;">
              <strong>Convocacao ${erro.idConvocacao || 'N/A'}:</strong> ${erro.erro || erro.message || 'Erro desconhecido'}
              ${erro.nomeMotorista ? `<br><small>Motorista: ${erro.nomeMotorista}</small>` : ''}
            </div>
          `;
        });
        
        detalhesHtml += `
            </div>
          </div>
        `;
      }

      detalhesHtml += `
          <div style="margin-top: 20px; text-align: center;">
            <button onclick="this.closest('.modal').style.display='none'" 
                    class="btn" 
                    style="background: #25D366; color: white; padding: 10px 30px;">
              Fechar
            </button>
          </div>
        </div>
      `;

      // Mostrar modal com resultado
      console.log('[WABOXAPP] Preparando para exibir modal de resultado...');
      let modalResultado = document.getElementById('modalResultadoEnvio');
      if (!modalResultado) {
        console.log('[WABOXAPP] Criando novo modal de resultado...');
        modalResultado = document.createElement('div');
        modalResultado.id = 'modalResultadoEnvio';
        modalResultado.className = 'modal';
        modalResultado.style.display = 'flex';
        modalResultado.style.alignItems = 'center';
        modalResultado.style.justifyContent = 'center';
        modalResultado.style.position = 'fixed';
        modalResultado.style.top = '0';
        modalResultado.style.left = '0';
        modalResultado.style.width = '100%';
        modalResultado.style.height = '100%';
        modalResultado.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        modalResultado.style.zIndex = '10000';
        document.body.appendChild(modalResultado);
      }

      modalResultado.innerHTML = `
        <div class="modal-content" style="max-width: 700px; max-height: 90vh; overflow-y: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
          ${detalhesHtml}
        </div>
      `;
      
      modalResultado.style.display = 'flex';
      console.log('[WABOXAPP] Modal de resultado exibido!');
      
      // Fechar ao clicar fora do modal
      modalResultado.onclick = (e) => {
        if (e.target === modalResultado) {
          modalResultado.style.display = 'none';
        }
      };
      
      modalResultado.style.display = 'flex';
      modalResultado.style.alignItems = 'center';
      modalResultado.style.justifyContent = 'center';
      
      // Fechar ao clicar fora
      modalResultado.onclick = (e) => {
        if (e.target === modalResultado) {
          modalResultado.style.display = 'none';
        }
      };
      modalResultado.style.display = 'flex';
      modalResultado.style.alignItems = 'center';
      modalResultado.style.justifyContent = 'center';

      // Fechar ao clicar fora
      modalResultado.onclick = (e) => {
        if (e.target === modalResultado) {
          modalResultado.style.display = 'none';
        }
      };

      // Mensagem de sucesso
      if (resumo.sucessos > 0) {
        showMessage(`✅ ${resumo.sucessos} mensagem(ns) enviada(s) automaticamente!`, 'success');
      } else {
        showMessage('Nenhuma mensagem foi enviada. Verifique os erros no relatório.', 'error');
      }

      // Fechar modal de links (opcional)
      const modalLinks = document.getElementById('modalLinksWhatsApp');
      if (modalLinks && resumo.sucessos === resumo.total) {
        // Se todos foram enviados, pode fechar o modal de links
        setTimeout(() => {
          modalLinks.style.display = 'none';
        }, 2000);
      }

    } catch (err) {
      console.error('Erro ao enviar WhatsApp automático:', err);
      showMessage('Erro ao enviar mensagens automaticamente: ' + err.message, 'error');
      
      // Mostrar mensagem de fallback
      showMessage(
        'O envio automático falhou. Use o botão "Abrir Todos" para enviar manualmente.',
        'warning'
      );
    } finally {
      // Reabilitar botão
      const btnEnviar = document.getElementById('btnEnviarAutomaticamente');
      if (btnEnviar) {
        btnEnviar.disabled = false;
        btnEnviar.textContent = '🚀 Enviar Automaticamente';
      }
    }
  }

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
        
        <!-- Separador Visual -->
        <div style="margin: 30px 0; display: flex; align-items: center; gap: 15px;">
          <div style="flex: 1; height: 2px; background: linear-gradient(to right, transparent, #dee2e6, transparent);"></div>
          <div style="padding: 8px 20px; background: #667eea; color: white; border-radius: 20px; font-weight: 600; font-size: 14px; white-space: nowrap;">
            📱 Escolha o Método de Envio
          </div>
          <div style="flex: 1; height: 2px; background: linear-gradient(to left, transparent, #dee2e6, transparent);"></div>
        </div>
        
        <div style="margin-top: 20px; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; border: 2px solid #dee2e6;">
          <p style="margin: 0 0 20px 0; font-weight: 700; color: #2c3e50; font-size: 16px; text-align: center;">
            🚀 Dois métodos disponíveis - Escolha o que melhor se adequa
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
            <div style="background: #fff; border: 3px solid #25D366; border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(37, 211, 102, 0.2);">
              <div style="text-align: center; margin-bottom: 15px;">
                <div style="font-size: 48px; margin-bottom: 5px;">🤖</div>
                <h4 style="margin: 0; color: #25D366; font-size: 18px; font-weight: 700;">Método Automático</h4>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">Via WaboxApp</p>
              </div>
              <button type="button" id="btnEnviarAutomaticamente" 
                      style="width: 100%; padding: 15px; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 16px; text-align: center; transition: all 0.3s; box-shadow: 0 4px 15px rgba(37, 211, 102, 0.3); display: none;"
                      onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(37, 211, 102, 0.5)';"
                      onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(37, 211, 102, 0.3)';">
                🚀 Enviar Automaticamente
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.9;">⚡ ${linksWhatsApp.length} mensagem(ns)</div>
              </button>
              <div id="mensagemWaboxAppNaoDisponivel" style="display: none; margin-top: 10px; padding: 15px; background: #fff3cd; border: 2px solid #ffc107; border-radius: 8px; font-size: 13px; color: #856404;">
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                  <span style="font-size: 24px;">⚠️</span>
                  <div style="flex: 1;">
                    <strong>WaboxApp não está configurado.</strong>
                    <p style="margin: 5px 0 0 0; font-size: 12px;">Use o método manual abaixo ou configure o WaboxApp para envio automático.</p>
                  </div>
                </div>
                <button type="button" id="btnComoConfigurarWaboxApp" 
                        style="width: 100%; padding: 10px; background: #ffc107; color: #856404; border: 1px solid #ffc107; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 13px; margin-top: 8px; transition: all 0.3s;"
                        onmouseover="this.style.background='#ffb300'; this.style.transform='translateY(-2px)';"
                        onmouseout="this.style.background='#ffc107'; this.style.transform='translateY(0)';">
                  📖 Como Configurar o WaboxApp
                </button>
              </div>
            </div>
            <div style="background: #fff; border: 3px solid #667eea; border-radius: 12px; padding: 20px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);">
              <div style="text-align: center; margin-bottom: 15px;">
                <div style="font-size: 48px; margin-bottom: 5px;">👤</div>
                <h4 style="margin: 0; color: #667eea; font-size: 18px; font-weight: 700;">Método Manual</h4>
                <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">Via WhatsApp Web</p>
              </div>
              <button type="button" id="btnAbrirTodosWhatsApp" 
                      style="width: 100%; padding: 15px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 700; font-size: 16px; text-align: center; transition: all 0.3s; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);"
                      onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.5)';"
                      onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(102, 126, 234, 0.3)';">
                📱 Abrir Todos os Links
                <div style="font-size: 12px; margin-top: 5px; opacity: 0.9;">✏️ ${linksWhatsApp.length} link(s)</div>
              </button>
              <p style="margin: 10px 0 0 0; font-size: 11px; color: #666; text-align: center; line-height: 1.4;">
                ✅ Sempre disponível - Não requer configuração
              </p>
            </div>
          </div>
          <!-- Guia Rápido de Como Usar -->
          <div style="margin-top: 20px; padding: 20px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border: 2px solid #2196F3; border-radius: 12px;">
            <h4 style="margin: 0 0 15px 0; color: #1565C0; font-size: 16px; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
              <span style="font-size: 24px;">📖</span>
              <span>Como Enviar as Mensagens - Passo a Passo</span>
            </h4>
            
            <!-- Processo Automático -->
            <div style="background: #fff; border: 2px solid #25D366; border-radius: 8px; padding: 15px; margin-bottom: 15px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <span style="font-size: 28px;">🤖</span>
                <h5 style="margin: 0; color: #25D366; font-size: 15px; font-weight: 700;">MÉTODO AUTOMÁTICO (WaboxApp)</h5>
              </div>
              <div id="passosAutomatico" style="display: none; padding-left: 5px;">
                <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 2;">
                  <li>Clique no botão <strong>"🚀 Enviar Automaticamente"</strong> acima</li>
                  <li>Confirme o envio no pop-up que aparecer</li>
                  <li>Aguarde alguns segundos enquanto o sistema processa</li>
                  <li>Você receberá um <strong>relatório</strong> mostrando quais foram enviadas com sucesso</li>
                  <li><strong>Pronto!</strong> Todas as mensagens foram enviadas automaticamente</li>
                </ol>
              </div>
              <div id="avisoAutomatico" style="padding: 10px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; color: #856404; font-size: 13px; margin-top: 10px;">
                ⚠️ <strong>WaboxApp não está configurado.</strong> Use o método manual abaixo.
              </div>
            </div>
            
            <!-- Processo Manual -->
            <div style="background: #fff; border: 2px solid #667eea; border-radius: 8px; padding: 15px;">
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                <span style="font-size: 28px;">👤</span>
                <h5 style="margin: 0; color: #667eea; font-size: 15px; font-weight: 700;">MÉTODO MANUAL (WhatsApp Web)</h5>
              </div>
              <div style="padding-left: 5px;">
                <p style="margin: 0; color: #333; line-height: 1.8; font-size: 14px;">
                  Para envio manual, clique no botão <strong>"📱 Abrir WhatsApp"</strong> de cada motorista na lista acima para abrir e enviar cada mensagem individualmente.
                </p>
              </div>
            </div>
            
            <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px; text-align: center;">
              <p style="margin: 0; color: #856404; font-size: 13px; line-height: 1.6;">
                💡 <strong>Dica:</strong> Se você tem <strong>muitas convocações</strong>, use o método automático (quando disponível). 
                Se precisa <strong>revisar cada mensagem</strong>, use o método manual.
              </p>
            </div>
          </div>
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
    
    // Abrir todos os links (melhorado)
    const btnAbrirTodos = document.getElementById('btnAbrirTodosWhatsApp');
    if (btnAbrirTodos) {
      btnAbrirTodos.onclick = () => {
        // Desabilitar botão durante o processo
        btnAbrirTodos.disabled = true;
        btnAbrirTodos.innerHTML = `
          <div style="font-size: 48px; margin-bottom: 10px;">⏳</div>
          <div style="font-size: 18px; margin-bottom: 5px;">Abrindo...</div>
          <div style="font-size: 12px; opacity: 0.9; font-weight: 400;">Aguarde</div>
        `;
        
        let abertos = 0;
        const total = linksWhatsApp.length;
        
        // Mostrar progresso (criar elemento de progresso personalizado)
        let elementoProgresso = null;
        const mensagemEl = document.getElementById('message');
        if (mensagemEl) {
          mensagemEl.innerHTML = `<div style="display: flex; align-items: center; gap: 10px;"><span>⏳</span><span id="progressoAbertura">Abrindo WhatsApp(s)... 0/${total}</span></div>`;
          mensagemEl.className = 'message info';
          mensagemEl.style.display = 'block';
          elementoProgresso = document.getElementById('progressoAbertura');
        }
        
        linksWhatsApp.forEach((item, index) => {
          setTimeout(() => {
            try {
              window.open(item.link, '_blank');
              abertos++;
              
              // Atualizar mensagem de progresso
              if (elementoProgresso) {
                elementoProgresso.textContent = `Abrindo WhatsApp(s)... ${abertos}/${total}`;
              }
              
              // Se foi o último, reabilitar botão
              if (abertos === total) {
                setTimeout(() => {
                  btnAbrirTodos.disabled = false;
                  btnAbrirTodos.innerHTML = `
                    <div style="font-size: 48px; margin-bottom: 10px;">👤</div>
                    <div style="font-size: 18px; margin-bottom: 5px;">Enviar Manualmente</div>
                    <div style="font-size: 12px; opacity: 0.9; font-weight: 400;">Abrir WhatsApp</div>
                    <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">✏️ ${total} link(s)</div>
                  `;
                  showMessage(`✅ ${total} WhatsApp(s) aberto(s) com sucesso!`, 'success');
                }, 500);
              }
            } catch (err) {
              console.error('Erro ao abrir WhatsApp:', err);
              abertos++;
              if (abertos === total) {
                btnAbrirTodos.disabled = false;
                btnAbrirTodos.innerHTML = `
                  <div style="font-size: 48px; margin-bottom: 10px;">👤</div>
                  <div style="font-size: 18px; margin-bottom: 5px;">Enviar Manualmente</div>
                  <div style="font-size: 12px; opacity: 0.9; font-weight: 400;">Abrir WhatsApp</div>
                  <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">✏️ ${total} link(s)</div>
                `;
              }
            }
          }, index * 1500); // Delay de 1.5 segundos entre cada abertura (mais seguro)
        });
      };
    }
    
    // Verificar se envio automático está disponível (via API) - sem gerar erros
    verificarEnvioAutomaticoDisponivel().then(disponivel => {
      const btnEnviarAutomatico = document.getElementById('btnEnviarAutomaticamente');
      const mensagemNaoDisponivel = document.getElementById('mensagemWaboxAppNaoDisponivel');
      const passosAutomatico = document.getElementById('passosAutomatico');
      const avisoAutomatico = document.getElementById('avisoAutomatico');
      const containerBotoes = btnEnviarAutomatico?.parentElement?.parentElement;
      
      if (btnEnviarAutomatico && disponivel) {
        // WaboxApp está disponível - mostrar botão automático e passos
        btnEnviarAutomatico.style.display = 'block';
        if (mensagemNaoDisponivel) mensagemNaoDisponivel.style.display = 'none';
        if (passosAutomatico) passosAutomatico.style.display = 'block';
        if (avisoAutomatico) avisoAutomatico.style.display = 'none';
        btnEnviarAutomatico.onclick = () => {
          // Fechar o modal de links do WhatsApp antes de iniciar o envio
          const modalLinks = document.getElementById('modalLinksWhatsApp');
          if (modalLinks) {
            modalLinks.style.display = 'none';
          }
          // Aguardar um pouco para o modal fechar antes de mostrar o modal de confirmação
          setTimeout(() => {
            enviarWhatsAppAutomatico(linksWhatsApp);
          }, 300);
        };
        if (containerBotoes) {
          containerBotoes.style.gridTemplateColumns = '1fr 1fr';
        }
      } else {
        // WaboxApp NÃO está disponível - ocultar botão automático e mostrar mensagem
        if (btnEnviarAutomatico) {
          btnEnviarAutomatico.style.display = 'none';
        }
        if (mensagemNaoDisponivel) {
          mensagemNaoDisponivel.style.display = 'block';
        }
        if (passosAutomatico) passosAutomatico.style.display = 'none';
        if (avisoAutomatico) avisoAutomatico.style.display = 'block';
        if (containerBotoes) {
          containerBotoes.style.gridTemplateColumns = '1fr';
        }
      }
    }).catch(() => {
      // Em caso de erro na verificação, assumir que não está disponível
      const btnEnviarAutomatico = document.getElementById('btnEnviarAutomaticamente');
      const mensagemNaoDisponivel = document.getElementById('mensagemWaboxAppNaoDisponivel');
      const passosAutomatico = document.getElementById('passosAutomatico');
      const avisoAutomatico = document.getElementById('avisoAutomatico');
      const containerBotoes = btnEnviarAutomatico?.parentElement?.parentElement;
      
      if (btnEnviarAutomatico) {
        btnEnviarAutomatico.style.display = 'none';
      }
      if (mensagemNaoDisponivel) {
        mensagemNaoDisponivel.style.display = 'block';
      }
      if (passosAutomatico) passosAutomatico.style.display = 'none';
      if (avisoAutomatico) avisoAutomatico.style.display = 'block';
      if (containerBotoes) {
        containerBotoes.style.gridTemplateColumns = '1fr';
      }
      
      // Event listener para botão de configuração (mesmo em caso de erro)
      const btnConfigWaboxApp = document.getElementById('btnComoConfigurarWaboxApp');
      if (btnConfigWaboxApp) {
        btnConfigWaboxApp.onclick = mostrarGuiaConfigWaboxApp;
      }
    });
    
    // Event listener para botão de configuração (também adicionar aqui para garantir)
    setTimeout(() => {
      const btnConfigWaboxApp = document.getElementById('btnComoConfigurarWaboxApp');
      if (btnConfigWaboxApp && !btnConfigWaboxApp.onclick) {
        btnConfigWaboxApp.onclick = mostrarGuiaConfigWaboxApp;
      }
    }, 500);

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
            <span style="font-size: 24px;">🤖</span>
            <span>Envio Automático (WaboxApp)</span>
          </h3>
          <div style="padding: 20px; background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%); border-left: 4px solid #25D366; border-radius: 8px; margin-bottom: 15px;">
            <p style="margin: 0 0 10px 0; font-weight: 600; color: #2e7d32;">Quando usar:</p>
            <ul style="margin: 0; padding-left: 20px; color: #388e3c;">
              <li>Você tem WaboxApp configurado</li>
              <li>Quer enviar várias mensagens rapidamente</li>
              <li>Não precisa personalizar cada mensagem</li>
            </ul>
          </div>
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; border: 1px solid #dee2e6;">
            <p style="margin: 0 0 10px 0; font-weight: 600;">Como fazer:</p>
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li>Crie as convocações normalmente</li>
              <li>No modal de links, clique em <strong>"🤖 Enviar Automaticamente"</strong></li>
              <li>Confirme o envio</li>
              <li>Pronto! Mensagens enviadas automaticamente</li>
            </ol>
          </div>
          <div style="margin-top: 15px; padding: 12px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 8px;">
            <p style="margin: 0; color: #856404; font-size: 13px;">
              <strong>⚡ Vantagens:</strong> Envio instantâneo • Totalmente automático • Log completo • Economiza tempo
            </p>
          </div>
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
              <li>WaboxApp não está configurado</li>
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
        
        <div style="padding: 20px; background: #f8f9fa; border-radius: 12px; border: 2px solid #6c757d;">
          <h3 style="color: #495057; margin-bottom: 15px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">⚙️</span>
            <span>Configurar WaboxApp</span>
          </h3>
          <div style="padding: 15px; background: white; border-radius: 8px;">
            <ol style="margin: 0; padding-left: 20px; color: #495057;">
              <li>Criar conta: <a href="https://www.waboxapp.com/" target="_blank" style="color: #667eea; font-weight: 600;">https://www.waboxapp.com/</a></li>
              <li>Conectar WhatsApp: Escanear QR Code</li>
              <li>Copiar credenciais: Token e UID</li>
              <li>Configurar no arquivo <code style="background: #f1f1f1; padding: 2px 6px; border-radius: 4px;">backend/.env</code></li>
              <li>Reiniciar servidor</li>
            </ol>
            <div style="margin-top: 15px; padding: 12px; background: #e9ecef; border-radius: 6px; font-family: monospace; font-size: 12px; color: #495057;">
              WABOXAPP_ENABLED=true<br>
              WABOXAPP_TOKEN=seu_token<br>
              WABOXAPP_UID=seu_uid
            </div>
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
      `Deseja realmente disparar <strong>${selecionados.length}</strong> convocação(ões) para esta viagem?<br><br><small style="color: #666;">Os motoristas receberão uma mensagem via WhatsApp com os detalhes da carga.</small>`
    );
    if (!confirmar) return;

    try {
      showMessage('Disparando convocações...', 'info');
      
      const motoristasParaEnvio = selecionados.map(m => ({
        CDCADASTRO_MOTORISTA: m.CDCADASTRO_MOTORISTA
      }));

      // Obter usuário logado do localStorage
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const userLogin = user.login || 'SYSTEM';
      
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
      showMessage(result.message || 'Convocações disparadas com sucesso!', 'success');
      
      // Limpar seleções
      motoristasCompatíveis.forEach(m => m.selecionado = false);
      renderizarMotoristasCompatíveis();
      
    } catch (err) {
      console.error('Erro ao disparar convocações:', err);
      showMessage(err.message || 'Erro ao disparar convocações.', 'error');
    }
  }

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
  
  // Função para mostrar o guia de configuração do WaboxApp
  function mostrarGuiaConfigWaboxApp() {
    const modal = document.getElementById('modalConfigurarWaboxApp');
    const conteudo = document.getElementById('conteudoConfigWaboxApp');
    
    if (!modal || !conteudo) {
      console.error('Modal de configuração WaboxApp não encontrado');
      return;
    }
    
    // Garantir que o modal fique na frente (z-index alto)
    modal.style.zIndex = '10001';
    modal.style.position = 'fixed';
    
    conteudo.innerHTML = `
      <div style="max-width: 850px; margin: 0 auto;">
        <!-- Introdução -->
        <div style="background: linear-gradient(135deg, #ffc107 0%, #ff9800 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(255, 193, 7, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 24px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 32px;">⚙️</span>
            <span>Como Configurar o WaboxApp</span>
          </h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            O WaboxApp permite enviar mensagens do WhatsApp <strong>automaticamente</strong> via API. 
            Siga os passos abaixo para configurar.
          </p>
        </div>

        <!-- Passo 1 -->
        <div style="background: #fff; border: 2px solid #2196F3; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="background: #2196F3; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px;">1</div>
            <h4 style="margin: 0; color: #2196F3; font-size: 18px;">Criar Conta no WaboxApp</h4>
          </div>
          <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 2;">
            <li>Acesse: <a href="https://www.waboxapp.com/" target="_blank" style="color: #2196F3; font-weight: 600;">https://www.waboxapp.com/</a></li>
            <li>Crie uma conta (plano gratuito: até 100 mensagens/mês)</li>
            <li>Faça login no dashboard</li>
            <li>Conecte seu número de WhatsApp:
              <ul style="margin-top: 8px; padding-left: 20px;">
                <li>No dashboard, procure por "Conectar WhatsApp"</li>
                <li>Escaneie o QR Code com seu WhatsApp</li>
                <li>Aguarde a confirmação de conexão</li>
              </ul>
            </li>
          </ol>
          <div style="margin-top: 15px; padding: 12px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px;">
            <p style="margin: 0; color: #1565C0; font-size: 13px;">
              💰 <strong>Preços:</strong> Gratuito (100 msg/mês) | $12/mês (1.000 msg) | $17/mês (10.000 msg)
            </p>
          </div>
        </div>

        <!-- Passo 2 -->
        <div style="background: #fff; border: 2px solid #4CAF50; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="background: #4CAF50; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px;">2</div>
            <h4 style="margin: 0; color: #4CAF50; font-size: 18px;">Obter TOKEN e UID</h4>
          </div>
          <p style="margin: 0 0 15px 0; color: #333; line-height: 1.8;">
            Após conectar seu WhatsApp, você encontrará suas credenciais em uma destas localizações:
          </p>
          <div style="background: #f8f9fa; border-left: 4px solid #4CAF50; padding: 15px; margin-bottom: 15px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #2e7d32; font-weight: 600;">📍 Onde encontrar:</p>
            <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
              <li><strong>Página de API/Documentação:</strong> Procure por "API" ou "Documentation"</li>
              <li><strong>Configurações da Conta:</strong> Vá em "Settings" → "API Credentials"</li>
              <li><strong>Ao criar instância:</strong> Alguns dashboards mostram logo após conectar</li>
            </ul>
          </div>
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
            <p style="margin: 0; color: #856404; font-weight: 600; margin-bottom: 8px;">📋 Você precisa copiar:</p>
            <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
              <li><strong>TOKEN:</strong> Uma string longa (ex: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">abc123def456...</code>)</li>
              <li><strong>UID:</strong> Seu ID de usuário (geralmente um número, ex: <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">554198371769</code>)</li>
            </ul>
          </div>
        </div>

        <!-- Passo 3 -->
        <div style="background: #fff; border: 2px solid #9C27B0; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="background: #9C27B0; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px;">3</div>
            <h4 style="margin: 0; color: #9C27B0; font-size: 18px;">Configurar no Sistema</h4>
          </div>
          <p style="margin: 0 0 15px 0; color: #333; line-height: 1.8;">
            Abra o arquivo <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace;">backend/.env</code> e adicione/modifique estas linhas:
          </p>
          <div style="background: #2d2d2d; color: #f8f8f2; padding: 20px; border-radius: 8px; margin-bottom: 15px; font-family: 'Courier New', monospace; font-size: 13px; overflow-x: auto;">
            <div style="color: #75715e; margin-bottom: 10px;"># Configuração WaboxApp</div>
            <div style="margin-bottom: 5px;"><span style="color: #a6e22e;">WABOXAPP_ENABLED</span>=<span style="color: #ae81ff;">true</span></div>
            <div style="margin-bottom: 5px;"><span style="color: #a6e22e;">WABOXAPP_TOKEN</span>=<span style="color: #e6db74;">cole_seu_token_aqui</span></div>
            <div><span style="color: #a6e22e;">WABOXAPP_UID</span>=<span style="color: #e6db74;">cole_seu_uid_aqui</span></div>
          </div>
          <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; border-radius: 4px;">
            <p style="margin: 0; color: #1565C0; font-size: 13px; line-height: 1.8;">
              ⚠️ <strong>Importante:</strong>
            </p>
            <ul style="margin: 10px 0 0 20px; color: #333; line-height: 1.8; font-size: 13px;">
              <li>Substitua <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">cole_seu_token_aqui</code> pelo TOKEN que você copiou</li>
              <li>Substitua <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">cole_seu_uid_aqui</code> pelo UID que você copiou</li>
              <li>Não deixe espaços antes ou depois do <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px;">=</code></li>
              <li>Não use aspas nos valores</li>
            </ul>
          </div>
        </div>

        <!-- Passo 4 -->
        <div style="background: #fff; border: 2px solid #FF9800; border-radius: 12px; padding: 25px; margin-bottom: 25px;">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 15px;">
            <div style="background: #FF9800; color: white; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 20px;">4</div>
            <h4 style="margin: 0; color: #FF9800; font-size: 18px;">Reiniciar o Servidor</h4>
          </div>
          <p style="margin: 0 0 15px 0; color: #333; line-height: 1.8;">
            Após salvar o arquivo <code style="background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-family: monospace;">.env</code>, você precisa reiniciar o servidor:
          </p>
          <div style="background: #2d2d2d; color: #f8f8f2; padding: 20px; border-radius: 8px; margin-bottom: 15px; font-family: 'Courier New', monospace; font-size: 13px;">
            <div style="color: #75715e;"># No terminal, pare o servidor (Ctrl+C) e inicie novamente:</div>
            <div style="margin-top: 10px;"><span style="color: #a6e22e;">cd</span> <span style="color: #e6db74;">backend</span></div>
            <div><span style="color: #a6e22e;">npm</span> <span style="color: #ae81ff;">run</span> <span style="color: #ae81ff;">dev</span></div>
          </div>
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 4px;">
            <p style="margin: 0; color: #856404; font-size: 13px; line-height: 1.8;">
              ✅ <strong>Pronto!</strong> Após reiniciar, o botão "🚀 Enviar Automaticamente" aparecerá na tela de links do WhatsApp.
            </p>
          </div>
        </div>

        <!-- Verificação -->
        <div style="background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%); color: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);">
          <h4 style="margin: 0 0 15px 0; font-size: 18px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 28px;">✅</span>
            <span>Como Verificar se Está Funcionando</span>
          </h4>
          <ol style="margin: 0; padding-left: 20px; line-height: 2; opacity: 0.95;">
            <li>Reinicie o servidor após configurar</li>
            <li>Vá até a tela de "Links do WhatsApp"</li>
            <li>Se o botão <strong>"🚀 Enviar Automaticamente"</strong> aparecer, está configurado! ✅</li>
            <li>Se não aparecer, verifique:
              <ul style="margin-top: 8px; padding-left: 20px;">
                <li>Se o arquivo <code style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 3px;">.env</code> está correto</li>
                <li>Se o servidor foi reiniciado</li>
                <li>Se o TOKEN e UID estão corretos (sem espaços extras)</li>
              </ul>
            </li>
          </ol>
        </div>

        <!-- Alternativas -->
        <div style="background: #f8f9fa; border: 2px solid #6c757d; border-radius: 12px; padding: 25px;">
          <h4 style="margin: 0 0 15px 0; color: #495057; font-size: 18px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 24px;">💡</span>
            <span>Não Quer Configurar Agora?</span>
          </h4>
          <p style="margin: 0; color: #333; line-height: 1.8;">
            Sem problemas! O sistema funciona <strong>perfeitamente</strong> sem o WaboxApp. 
            Você pode usar o <strong>método manual</strong> (abrir links do WhatsApp) que está sempre disponível.
          </p>
          <div style="margin-top: 15px; padding: 12px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px;">
            <p style="margin: 0; color: #1565C0; font-size: 13px; line-height: 1.6;">
              📱 <strong>Método Manual:</strong> Clique em "📱 Abrir Todos os Links" e envie cada mensagem manualmente pelo WhatsApp Web.
            </p>
          </div>
        </div>
      </div>
    `;
    
    // Garantir que o modal fique na frente de tudo (z-index maior que outros modais)
    modal.style.zIndex = '10001';
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.right = '0';
    modal.style.bottom = '0';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    modal.style.display = 'flex';
    
    // Garantir que o conteúdo também tenha z-index alto
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.position = 'relative';
      modalContent.style.zIndex = '10002';
    }
    
    // Fechar ao clicar fora
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
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
            Este guia explica os <strong>dois métodos</strong> disponíveis para enviar convocações aos motoristas: 
            <strong>Automático (WaboxApp)</strong> e <strong>Manual (WhatsApp Web)</strong>. 
            Escolha o método que melhor se adequa à sua necessidade!
          </p>
        </div>

        <!-- Método 1: Automático -->
        <div style="background: #fff; border: 3px solid #25D366; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(37, 211, 102, 0.2);">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
            <div style="font-size: 48px;">🤖</div>
            <div>
              <h3 style="margin: 0; color: #25D366; font-size: 22px;">Método 1: Envio Automático (WaboxApp)</h3>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">Envio em massa via API - Rápido e eficiente</p>
            </div>
          </div>
          
          <div style="background: #f0f9f4; border-left: 4px solid #25D366; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #2e7d32; font-weight: 600;">✅ <strong>Vantagens:</strong></p>
            <ul style="margin: 10px 0 0 20px; color: #333; line-height: 1.8;">
              <li>Envia <strong>todas as mensagens de uma vez</strong></li>
              <li>Não precisa abrir o WhatsApp manualmente</li>
              <li>Relatório automático de sucessos e falhas</li>
              <li>Ideal para <strong>grandes volumes</strong> de convocações</li>
              <li>Economiza tempo e esforço</li>
            </ul>
          </div>
          
          <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 20px; border-radius: 4px;">
            <p style="margin: 0; color: #856404; font-weight: 600;">⚠️ <strong>Requisitos:</strong></p>
            <ul style="margin: 10px 0 0 20px; color: #333; line-height: 1.8;">
              <li>WaboxApp configurado no sistema (variáveis de ambiente)</li>
              <li>Conta WaboxApp ativa e com créditos</li>
              <li>O botão "🚀 Enviar Automaticamente" aparecerá apenas se estiver configurado</li>
            </ul>
          </div>
          
          <div style="background: #e3f2fd; border-left: 4px solid #2196F3; padding: 15px; border-radius: 4px;">
            <p style="margin: 0 0 10px 0; color: #1565C0; font-weight: 600;">📋 <strong>Como usar:</strong></p>
            <ol style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
              <li>Após criar as convocações, clique em <strong>"🔗 Ver Links WhatsApp"</strong></li>
              <li>No modal que abrir, você verá o botão <strong>"🤖 Enviar Automaticamente"</strong> (se WaboxApp estiver configurado)</li>
              <li>Clique no botão e confirme o envio</li>
              <li>Aguarde o processamento (pode levar alguns segundos)</li>
              <li>Você receberá um <strong>relatório detalhado</strong> com o resultado de cada envio</li>
            </ol>
          </div>
        </div>

        <!-- Método 2: Manual -->
        <div style="background: #fff; border: 3px solid #667eea; border-radius: 12px; padding: 25px; margin-bottom: 30px; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.2);">
          <div style="display: flex; align-items: center; gap: 15px; margin-bottom: 20px;">
            <div style="font-size: 48px;">👤</div>
            <div>
              <h3 style="margin: 0; color: #667eea; font-size: 22px;">Método 2: Envio Manual (WhatsApp Web)</h3>
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
              O método manual é <strong>sempre disponível</strong>, mesmo sem WaboxApp configurado. 
              Use quando precisar de controle total sobre as mensagens ou quando o volume for pequeno.
            </p>
          </div>
        </div>

        <!-- Comparação -->
        <div style="background: #f8f9fa; border: 2px solid #dee2e6; border-radius: 12px; padding: 25px; margin-bottom: 30px;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px; text-align: center;">⚖️ Comparação Rápida</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #667eea; color: white;">
                <th style="padding: 12px; text-align: left; border-radius: 8px 0 0 0;">Característica</th>
                <th style="padding: 12px; text-align: center;">🤖 Automático</th>
                <th style="padding: 12px; text-align: center; border-radius: 0 8px 0 0;">👤 Manual</th>
              </tr>
            </thead>
            <tbody>
              <tr style="background: #fff;">
                <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: 600;">Velocidade</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">⚡ Muito Rápido</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">🐢 Mais Lento</td>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: 600;">Controle</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">📊 Automático</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">✋ Total</td>
              </tr>
              <tr style="background: #fff;">
                <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: 600;">Revisão</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">❌ Não</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">✅ Sim</td>
              </tr>
              <tr style="background: #f8f9fa;">
                <td style="padding: 12px; border-bottom: 1px solid #dee2e6; font-weight: 600;">Configuração</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">⚙️ Requer WaboxApp</td>
                <td style="padding: 12px; text-align: center; border-bottom: 1px solid #dee2e6;">✅ Sempre Disponível</td>
              </tr>
              <tr style="background: #fff;">
                <td style="padding: 12px; font-weight: 600;">Ideal para</td>
                <td style="padding: 12px; text-align: center;">📦 Grandes Volumes</td>
                <td style="padding: 12px; text-align: center;">📝 Pequenos Volumes</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Quando usar cada um -->
        <div style="background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; padding: 25px; margin-bottom: 30px;">
          <h3 style="margin: 0 0 20px 0; color: #2c3e50; font-size: 20px; text-align: center;">🎯 Quando usar cada método?</h3>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div style="background: #fff; padding: 20px; border-radius: 8px; border: 2px solid #25D366;">
              <h4 style="margin: 0 0 10px 0; color: #25D366;">🤖 Use Automático quando:</h4>
              <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
                <li>Você tem <strong>muitas convocações</strong> para enviar</li>
                <li>As mensagens estão <strong>padronizadas</strong> e não precisam de revisão</li>
                <li>Você quer <strong>economizar tempo</strong></li>
                <li>WaboxApp está <strong>configurado e funcionando</strong></li>
              </ul>
            </div>
            <div style="background: #fff; padding: 20px; border-radius: 8px; border: 2px solid #667eea;">
              <h4 style="margin: 0 0 10px 0; color: #667eea;">👤 Use Manual quando:</h4>
              <ul style="margin: 0; padding-left: 20px; color: #333; line-height: 1.8;">
                <li>Você tem <strong>poucas convocações</strong></li>
                <li>Precisa <strong>revisar ou personalizar</strong> cada mensagem</li>
                <li>WaboxApp <strong>não está configurado</strong></li>
                <li>Quer <strong>interagir diretamente</strong> com o motorista</li>
              </ul>
            </div>
          </div>
        </div>

        <!-- Conclusão -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 12px; text-align: center; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);">
          <h3 style="margin: 0 0 15px 0; font-size: 22px;">✨ Pronto para começar!</h3>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; opacity: 0.95;">
            Agora você conhece os dois métodos de envio. Escolha o que melhor se adequa à sua situação e 
            comece a enviar convocações de forma eficiente! 🚀
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
          // Verificar se é ngrok (tem página de aviso)
          const isNgrok = urlBase.includes('ngrok-free.dev') || urlBase.includes('ngrok.io');
          
          if (isNgrok) {
            textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}\n\n👆 *Toque no link acima para responder*\n\n💡 *Aviso:* Na primeira vez, você verá uma página de segurança. Clique em "Visit Site" para continuar.`;
          } else {
            textoComLink = `${mensagemPersonalizada}\n\n🔗 *Acesse o link para mais detalhes:*\n\n${linkConvocacao}`;
          }
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
      <div id="legendaGrid" style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 15px; margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">
        <div style="font-weight: 600; color: #495057; margin-right: 10px;">Legenda:</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">🔗</span>
          <span><strong>Ver Link:</strong> Clique para abrir o link da convocação</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px;">🗺️</span>
          <span><strong>Ver no Mapa:</strong> Clique para ver a localização do motorista e a rota até o ponto de carregamento (disponível apenas quando há localização e roteiro)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #28a745;">✅</span>
          <span><strong>Confirmar:</strong> Clique para confirmar a convocação (apenas para status ACEITA)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #ff9800;">🔄</span>
          <span><strong>Reativar:</strong> Clique para reativar convocação confirmada (apenas para status CONFIRMADA)</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 18px; color: #dc3545;">⚠️</span>
          <span><strong>Histórico de Reabertura:</strong> Indica que a convocação foi confirmada e depois reativada (motorista declinou após confirmação)</span>
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
      
      return `<a href="${urlWhatsApp}" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  style="color: #25D366; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; font-weight: 600;"
                  title="Abrir WhatsApp">
                  <span style="font-size: 1.2em;">📱</span>
                  <span>${celular}</span>
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
        if (conv.DSMOTIVO) {
          statusDisplay = `RECUSADA - ${conv.DSMOTIVO}`;
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
            <small style="color: #666;">${criarLinkWhatsApp(conv.CELULAR_MOTORISTA)}</small>
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
    
    // Verificar se WaboxApp está disponível
    const waboxappDisponivel = await verificarEnvioAutomaticoDisponivel();
    
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
    
    // Variável para armazenar o método de envio escolhido
    let metodoEnvioEscolhido = 'waboxapp'; // Padrão: automático quando disponível
    
    // Opção de escolha entre manual e WaboxApp - Interface mais prática e visual
    let opcaoEnvio = '';
    if (waboxappDisponivel) {
      opcaoEnvio = `
        <div style="margin-top: 25px; padding: 20px; background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%); border-radius: 12px; border: 2px solid #dee2e6;">
          <p style="margin: 0 0 15px 0; font-weight: 700; color: #2c3e50; font-size: 16px; text-align: center;">
            📱 Escolha como enviar a mensagem de confirmação
          </p>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
            <button type="button" id="btnEscolherWaboxApp" 
                    style="padding: 20px; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); color: white; border: 3px solid #25D366; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 16px; text-align: center; transition: all 0.3s; box-shadow: 0 4px 15px rgba(37, 211, 102, 0.3);"
                    onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(37, 211, 102, 0.5)';"
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(37, 211, 102, 0.3)';"
                    onclick="window.metodoEnvioEscolhidoConfirmacao = 'waboxapp'; document.querySelector('input[name=\\'metodoEnvio\\'][value=\\'waboxapp\\']').checked=true; document.getElementById('btnEscolherWaboxApp').style.border='3px solid #25D366'; document.getElementById('btnEscolherWaboxApp').style.background='linear-gradient(135deg, #25D366 0%, #128C7E 100%)'; document.getElementById('btnEscolherManual').style.border='3px solid #6c757d'; document.getElementById('btnEscolherManual').style.background='linear-gradient(135deg, #6c757d 0%, #5a6268 100%)';">
              <div style="font-size: 48px; margin-bottom: 10px;">🤖</div>
              <div style="font-size: 18px; margin-bottom: 5px;">Automático</div>
              <div style="font-size: 12px; opacity: 0.9; font-weight: 400;">Envio via WaboxApp</div>
              <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">⚡ Instantâneo</div>
            </button>
            <button type="button" id="btnEscolherManual"
                    style="padding: 20px; background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%); color: white; border: 3px solid #6c757d; border-radius: 12px; cursor: pointer; font-weight: 700; font-size: 16px; text-align: center; transition: all 0.3s; box-shadow: 0 4px 15px rgba(108, 117, 125, 0.3);"
                    onmouseover="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 6px 20px rgba(108, 117, 125, 0.5)';"
                    onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(108, 117, 125, 0.3)';"
                    onclick="window.metodoEnvioEscolhidoConfirmacao = 'manual'; document.querySelector('input[name=\\'metodoEnvio\\'][value=\\'manual\\']').checked=true; document.getElementById('btnEscolherManual').style.border='3px solid #667eea'; document.getElementById('btnEscolherManual').style.background='linear-gradient(135deg, #667eea 0%, #764ba2 100%)'; document.getElementById('btnEscolherWaboxApp').style.border='3px solid #25D366'; document.getElementById('btnEscolherWaboxApp').style.background='linear-gradient(135deg, #25D366 0%, #128C7E 100%)';">
              <div style="font-size: 48px; margin-bottom: 10px;">👤</div>
              <div style="font-size: 18px; margin-bottom: 5px;">Manual</div>
              <div style="font-size: 12px; opacity: 0.9; font-weight: 400;">Você envia pelo WhatsApp</div>
              <div style="font-size: 11px; margin-top: 8px; opacity: 0.8;">✏️ Personalize antes</div>
            </button>
          </div>
          <input type="radio" name="metodoEnvio" value="waboxapp" checked style="display: none;">
          <input type="radio" name="metodoEnvio" value="manual" style="display: none;">
          <div style="margin-top: 15px; padding: 12px; background: rgba(255, 255, 255, 0.7); border-radius: 8px; font-size: 13px; color: #495057; text-align: center;">
            <strong>💡 Dica:</strong> Automático é mais rápido, Manual permite personalizar a mensagem antes de enviar
          </div>
        </div>
      `;
    }
    
    // Inicializar variável global para armazenar método escolhido
    window.metodoEnvioEscolhidoConfirmacao = waboxappDisponivel ? 'waboxapp' : 'manual';
    
    const mensagemCompleta = `
      <div style="text-align: left; line-height: 1.8;">
        <p><strong>Viagem:</strong> ${convocacao.IDVIAGEM}</p>
        <p><strong>Motorista:</strong> ${convocacao.NOME_MOTORISTA || 'N/A'}</p>
        ${mensagemAtencao}
        ${opcaoEnvio}
      </div>
    `;
    
    const confirmado = await showConfirmModal(
      '✅ Confirmar Convocação',
      mensagemCompleta
    );

    if (!confirmado) {
      return;
    }
    
    // Obter método de envio escolhido (da variável global ou do radio button como fallback)
    let metodoEnvio = 'manual';
    if (waboxappDisponivel) {
      // Priorizar variável global (mais confiável)
      if (window.metodoEnvioEscolhidoConfirmacao) {
        metodoEnvio = window.metodoEnvioEscolhidoConfirmacao;
      } else {
        // Fallback: tentar ler do radio button
        const radioSelecionado = document.querySelector('input[name="metodoEnvio"]:checked');
        metodoEnvio = radioSelecionado ? radioSelecionado.value : 'waboxapp'; // Padrão automático se disponível
      }
      // Limpar variável global após uso
      delete window.metodoEnvioEscolhidoConfirmacao;
    }
    
    console.log('[CONFIRMAR] Método de envio escolhido:', metodoEnvio, 'WaboxApp disponível:', waboxappDisponivel);

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
      
      // Enviar mensagem de confirmação conforme método escolhido
      console.log('[CONFIRMAR] Verificando método de envio:', { metodoEnvio, waboxappDisponivel, condicao: metodoEnvio === 'waboxapp' && waboxappDisponivel });
      
      if (metodoEnvio === 'waboxapp' && waboxappDisponivel) {
        // Enviar automaticamente via WaboxApp
        console.log('[CONFIRMAR] Usando método AUTOMÁTICO (WaboxApp)');
        try {
          showMessage('Enviando mensagem de confirmação via WaboxApp...', 'info');
          
          // Preparar mensagem de confirmação
          let mensagemConfirmacao = result.mensagemConfirmacao;
          
          // Se não veio no resultado, tentar extrair do link WhatsApp
          if (!mensagemConfirmacao && result.whatsappLink) {
            try {
              const urlParams = new URL(result.whatsappLink);
              const textParam = urlParams.searchParams.get('text');
              if (textParam) {
                mensagemConfirmacao = decodeURIComponent(textParam);
              }
            } catch (e) {
              console.warn('Erro ao extrair texto do link:', e);
            }
          }
          
          if (mensagemConfirmacao && result.motorista && result.motorista.celular) {
            console.log('[CONFIRMAR] Enviando via WaboxApp para:', result.motorista.celular);
            const responseWabox = await fetch('/api/convocacoes/enviar-whatsapp-automatico', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                idsConvocacoes: [idConvocacao],
                textoPersonalizado: mensagemConfirmacao
              })
            });
            
            const resultWabox = await responseWabox.json();
            console.log('[CONFIRMAR] Resposta WaboxApp:', resultWabox);
            
            if (responseWabox.ok && resultWabox.sucessos > 0) {
              showMessage('Convocação confirmada e mensagem enviada automaticamente via WaboxApp!', 'success');
              // NÃO abrir WhatsApp quando método automático foi escolhido e funcionou
            } else {
              const erroMsg = resultWabox.error || 'Erro desconhecido';
              console.error('[CONFIRMAR] Erro ao enviar via WaboxApp:', erroMsg);
              showMessage(`Convocação confirmada, mas houve erro ao enviar via WaboxApp: ${erroMsg}. Use o método manual.`, 'error');
              // Fallback: abrir WhatsApp manualmente apenas se o usuário quiser
              // Removido: não abrir automaticamente para não confundir o usuário
            }
          } else {
            console.warn('[CONFIRMAR] Dados insuficientes para envio automático:', { 
              temMensagem: !!mensagemConfirmacao, 
              temMotorista: !!result.motorista, 
              temCelular: !!(result.motorista && result.motorista.celular) 
            });
            showMessage('Convocação confirmada, mas não foi possível enviar automaticamente. Use o método manual.', 'error');
            // Removido: não abrir WhatsApp automaticamente
          }
        } catch (err) {
          console.error('[CONFIRMAR] Erro ao enviar via WaboxApp:', err);
          showMessage('Convocação confirmada, mas houve erro ao enviar via WaboxApp. Use o método manual.', 'error');
          // Removido: não abrir WhatsApp automaticamente como fallback
        }
      } else {
        // Método manual: abrir WhatsApp
        console.log('[CONFIRMAR] Usando método MANUAL (WhatsApp Web)');
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
      }

      // Recarregar a lista de convocações
      await carregarConvocacoes();
    } catch (err) {
      console.error('Erro ao confirmar convocação:', err);
      showMessage('Erro ao confirmar convocação: ' + err.message, 'error');
    }
  };

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
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
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
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${lonMotorista},${latMotorista};${origemLon},${origemLat}?overview=full&geometries=geojson`;
          const rotaResponse = await fetch(osrmUrl);
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
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn cancel';
      btnRemover.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnRemover.innerHTML = '🗑️ Remover';
      btnRemover.onclick = () => removerVeiculoViagem(veiculo.IDVIAGEM, veiculo.IDEQUIPAMENTO);
      
      btnContainer.appendChild(btnVerDados);
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
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn cancel';
      btnRemover.style.cssText = 'padding: 8px 15px; white-space: nowrap;';
      btnRemover.innerHTML = '🗑️ Remover';
      btnRemover.onclick = () => removerMotoristaViagem(motorista.IDVIAGEM, motorista.CDMOTORISTA || motorista.CDCADASTROGERAL);
      
      btnContainer.appendChild(btnVerDados);
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
    
    // Botão fechar modal de configuração WaboxApp
    const btnFecharConfigWaboxApp = document.getElementById('btnFecharConfigWaboxApp');
    if (btnFecharConfigWaboxApp) {
      btnFecharConfigWaboxApp.addEventListener('click', () => {
        document.getElementById('modalConfigurarWaboxApp').style.display = 'none';
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

})();