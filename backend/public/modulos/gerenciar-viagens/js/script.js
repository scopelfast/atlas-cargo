// backend/public/modulos/gerenciar-viagens/js/script.js
// Gerenciar Viagens - Frontend
// Versão: 1.2
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05
// Última atualização: 2025-01-XX (Correção definitiva overlayMostrado)

// Flag global para controlar se o overlay está visível
// Declarada no escopo global usando window para evitar erro de redeclaração
// se o script for carregado múltiplas vezes
if (typeof window.overlayMostrado === 'undefined') {
  window.overlayMostrado = false;
}

// Função helper para obter o estado do overlay (opcional, mas útil para debug)
function getOverlayMostrado() {
  if (typeof window.overlayMostrado === 'undefined') {
    window.overlayMostrado = false;
  }
  return window.overlayMostrado;
}

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
  
  // Debug: confirmar que overlayMostrado está carregando (agora no escopo global)

  // ====================================
  // CONFIGURAÇÕES DE MAPA E ROTEAMENTO
  // ====================================
  // IMPORTANTE: Usar APENAS o MAP_CONFIG global de /js/map-config.js
  // NÃO criar configuração local - todos os módulos devem usar o mesmo arquivo!
  
  // Verificar se MAP_CONFIG foi carregado
  if (!window.MAP_CONFIG) {
    console.warn('⚠️ [VIAGENS] MAP_CONFIG não encontrado! Certifique-se de que /js/map-config.js está carregado ANTES deste script.');
  } else {
    console.log('✅ [VIAGENS] MAP_CONFIG carregado:', {
      tileServer: window.MAP_CONFIG.tileServer?.substring(0, 50) + '...',
      osrmServer: window.MAP_CONFIG.osrmServer,
      nominatimServer: window.MAP_CONFIG.nominatimServer
    });
  }
  
  // Usar referência ao MAP_CONFIG global (vem de map-config.js)
  const MAP_CONFIG = window.MAP_CONFIG || {};

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

    // Data Fim = hoje + 7 dias (getdate() + 7)
    const filtroDataFim = document.getElementById('filtroDataFim');
    if (filtroDataFim) {
      const hoje = new Date();
      const dataFim = new Date(hoje);
      dataFim.setDate(dataFim.getDate() + 7);
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
    // Proteção: Se já foi executado nesta execução do script, não executar novamente
    // (mas permite executar novamente se o módulo for recarregado)
    if (sqlExecutado) {
      console.log('ℹ️ init.sql já foi executado nesta inicialização. Pulando execução.');
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
      
      // Extrair lista de stored procedures que serão executadas para mostrar progresso
      const procedures = [];
      const linhas = sqlLimpo.split('\n');
      linhas.forEach(linha => {
        const linhaUpper = linha.toUpperCase().trim();
        // Procurar por EXEC ou EXECUTE seguido de nome de procedure
        const match = linhaUpper.match(/EXEC(?:UTE)?\s+(?:\[DBO\]\.)?\[?(\w+)\]?/);
        if (match && match[1]) {
          const procName = match[1];
          // Remover prefixo SP_ se existir para melhor legibilidade
          const nomeLimpo = procName.replace(/^SP_/, '');
          if (!procedures.includes(nomeLimpo)) {
            procedures.push(nomeLimpo);
          }
        }
      });
      
      // Contar comandos GO para saber quantos comandos serão executados
      const comandosGO = sqlLimpo.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
      const totalComandos = comandosGO.length;
      
      // Atualizar mensagem: mostrar quantas procedures serão executadas
      if (procedures.length > 0) {
        showLoadingOverlayInitSQL(
          'Processando Inicialização', 
          `Executando ${totalComandos} comando(s) SQL...`, 
          `Procedures: ${procedures.slice(0, 5).join(', ')}${procedures.length > 5 ? ` (+${procedures.length - 5} mais)` : ''}`
        );
        
        // Iniciar simulação de progresso (atualizar a cada 2 segundos)
        let comandoAtual = 0;
        const intervaloProgresso = setInterval(() => {
          comandoAtual++;
          if (comandoAtual <= totalComandos) {
            const procedureAtual = procedures[comandoAtual - 1] || 'Comando SQL';
            showLoadingOverlayInitSQL(
              'Processando Inicialização', 
              `Executando comando ${comandoAtual} de ${totalComandos}...`, 
              `Em execução: ${procedureAtual}`
            );
          }
        }, 2000); // Atualizar a cada 2 segundos
        
        // Armazenar intervalo para limpar depois
        window.intervaloInitSQL = intervaloProgresso;
      } else {
        showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      }
      
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
      
      // Verificar se result foi definido corretamente
      if (!result || typeof result !== 'object') {
        hideLoadingOverlayInitSQL();
        console.warn('[Init SQL] Resultado não definido ou inválido');
        return; // Não bloquear o módulo
      }
      
      // Verificar se todos os comandos foram executados com sucesso
      if (result.success === false || (result.success === undefined && result.error)) {
        hideLoadingOverlayInitSQL();
        console.warn('[Init SQL] Execução não foi bem-sucedida:', result.error || 'Erro desconhecido');
        return; // Não bloquear o módulo
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result && result.resultados && Array.isArray(result.resultados)) {
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
              try {
                // Capturar mensagem de forma segura
                let mensagem = 'Erro desconhecido';
                if (erro) {
                  if (typeof erro === 'string') {
                    mensagem = erro;
                  } else if (erro.error) {
                    mensagem = String(erro.error);
                  } else if (erro.mensagem) {
                    mensagem = String(erro.mensagem);
                  } else if (erro.erro) {
                    mensagem = String(erro.erro);
                  } else if (erro.message) {
                    mensagem = String(erro.message);
                  } else if (typeof erro === 'object') {
                    mensagem = JSON.stringify(erro);
                  }
                }
                
                const comando = (erro && (erro.comando || erro.sql)) ? String(erro.comando || erro.sql) : 'Comando desconhecido';
                // Extrair nome da stored procedure se possível
                const procedureMatch = comando.match(/EXEC\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) || 
                                        comando.match(/EXECUTE\s+(?:\[dbo\]\.)?\[?(\w+)\]?/i) ||
                                        comando.match(/\[?(\w+)\]?/i);
                const procedureName = procedureMatch ? procedureMatch[1] : 'N/A';
                
                // Incluir detalhes adicionais se disponíveis
                let detalhesAdicionais = '';
                if (erro && erro.detalhes) {
                  const detalhes = erro.detalhes;
                  if (detalhes.numero) {
                    detalhesAdicionais = ` (Erro SQL ${detalhes.numero})`;
                  }
                }
                
                // Verificar se mensagem está definida antes de usar
                const mensagemFinal = mensagem && mensagem !== 'Erro desconhecido' ? (mensagem + detalhesAdicionais) : ('Erro desconhecido' + detalhesAdicionais);
                
                // Verificar se é erro relacionado ao banco INTEGRA_PRD offline ou erro interno do backend
                const mensagemLower = mensagemFinal.toLowerCase();
                const isErroIntegraOffline = mensagemLower.includes('cannot be opened') || 
                                             mensagemLower.includes('is offline') || 
                                             mensagemLower.includes('está offline') ||
                                             mensagemLower.includes('database') && mensagemLower.includes('offline') ||
                                             mensagemLower.includes('banco') && mensagemLower.includes('offline');
                const isErroInternoBackend = mensagemFinal.includes('result is not defined') || 
                                            mensagemFinal.includes('Cannot read property') ||
                                            mensagemFinal.includes('undefined');
                
                if (isErroIntegraOffline || isErroInternoBackend) {
                  // Se for erro relacionado ao INTEGRA_PRD offline ou erro interno do backend
                  if (isErroIntegraOffline) {
                    console.warn(`[Init SQL] Aviso: Procedure ${procedureName} não pode ser executada porque o banco INTEGRA_PRD está offline. Execute o script verificar_ativar_integra_prd.sql para ativar o banco.`);
                  } else {
                    console.warn(`[Init SQL] Aviso: Procedure ${procedureName} retornou erro interno (pode ser normal se o banco INTEGRA_PRD estiver offline)`);
                  }
                } else {
                  // Erro real que precisa ser logado
                  // Erros esperados (não críticos) - apenas logar, não quebrar o módulo
                  const errosEsperados = [
                    'Arithmetic overflow',
                    'Violation of PRIMARY KEY',
                    'Duplicate key',
                    'UNIQUE KEY constraint'
                  ];
                  
                  const isErroEsperado = errosEsperados.some(erro => mensagemFinal.includes(erro));
                  
                  if (isErroEsperado) {
                    // Erros esperados são apenas warnings, não erros críticos
                    console.warn(`⚠️ [init.sql] Erro esperado na procedure ${procedureName}:`, mensagemFinal);
                  } else {
                    // Apenas logar como erro se não for esperado
                    console.error(`Erro no init.sql [Procedure: ${procedureName}]:`, mensagemFinal);
                  }
                }
              } catch (err) {
                // Se houver erro ao processar o erro, logar de forma simples
                console.error('Erro ao processar erro do init.sql:', err);
              }
            });
          }
        }
      }
      
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQL) {
        clearInterval(window.intervaloInitSQL);
        delete window.intervaloInitSQL;
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      // Isso é importante para operações que podem ter efeitos colaterais assíncronos
      // Aumentado para 500ms para garantir que operações complexas sejam concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Limpar intervalo de progresso se existir
      if (window.intervaloInitSQL) {
        clearInterval(window.intervaloInitSQL);
        delete window.intervaloInitSQL;
      }
      
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
            // GridEditor já está carregado no HTML, não precisa carregar novamente
            if (typeof window.GridEditor !== 'undefined') {
              inicializarGridTab();
            } else {
              console.warn('GridEditor não está disponível. Recarregue a página.');
            }
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

      // Se for a aba Rastreamento, inicializar
      if (tabId === 'rastreamento') {
        setTimeout(() => {
          inicializarAbaRastreamento();
          
          // Se houver viagem selecionada, carregar posições
          const idViagem = document.getElementById('filtroIdViagem')?.value || 
                          document.getElementById('viagemId')?.value || 
                          null;
          if (idViagem) {
            // Ativar acompanhamento WebSocket para esta viagem
            if (typeof window.WebSocketTorre !== 'undefined') {
              window.WebSocketTorre.acompanharViagem(idViagem);
            }
            carregarPosicoesRastreamento(idViagem);
          }
        }, 100);
      }

      // Abas Alertas, Chat, SOS e Ranking foram removidas - movidas para módulos separados

      // Se for a aba Integração Meta, verificar se há viagem selecionada antes de carregar logs
      if (tabId === 'integracao-meta') {
        setTimeout(() => {
          // Verificar se há viagem selecionada
          const idViagem = document.getElementById('filtroIdViagem')?.value || 
                          document.getElementById('viagemId')?.value || 
                          null;
          
          if (!idViagem || idViagem.trim() === '') {
            // Não há viagem selecionada - mostrar mensagem
            const container = document.getElementById('logsIntegracaoMeta');
            if (container) {
              container.innerHTML = `
                <div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
                  <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
                  <h3 style="color: #856404; margin-bottom: 10px;">Nenhuma viagem selecionada</h3>
                  <p style="color: #856404; margin: 0;">
                    Selecione uma viagem na aba <strong>Dados</strong> ou <strong>Grid</strong> para visualizar os logs de integração Meta.
                  </p>
                </div>
              `;
            }
            // Limpar contadores
            const totalEnviosEl = document.getElementById('totalEnviosMeta');
            const totalSucessosEl = document.getElementById('totalSucessosMeta');
            const totalErrosEl = document.getElementById('totalErrosMeta');
            const ultimaAtualizacaoEl = document.getElementById('ultimaAtualizacaoMeta');
            if (totalEnviosEl) totalEnviosEl.textContent = '0';
            if (totalSucessosEl) totalSucessosEl.textContent = '0';
            if (totalErrosEl) totalErrosEl.textContent = '0';
            if (ultimaAtualizacaoEl) ultimaAtualizacaoEl.textContent = '-';
            return;
          }
          
          // Há viagem selecionada - carregar logs
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
      if (typeof window.GridEditor !== 'undefined') {
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
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Viagens] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#viagensGrid',
      columns: [
        { field: 'IDVIAGEM', header: 'ID', editable: false, isId: true, width: '100px' },
        { field: 'FGSITVIAGEM_NOME', header: 'Situação Viagem', editable: true, type: 'select', width: '160px',
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
        { field: 'DSTIPOVIAGEM', header: 'Tipo Viagem', editable: false, width: '180px' },
        { field: 'DSROTEIRO', header: 'Roteiro', editable: false, width: '220px' },
        { field: 'CONTRATADOR_NOME', header: 'Contratador', editable: false, width: '240px' },
        { field: 'DSCLASSEFROTA', header: 'Classe Frota', editable: false, width: '180px' },
        { 
          field: 'DTPREVINICIO', 
          header: 'Data Início', 
          editable: true, 
          type: 'datetime-local', 
          width: '170px',
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
          width: '170px',
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
      console.log(`[CIDADES] Carregando cidades do estado ${estado} para ${tipo}`);
      const response = await fetch(`/api/cidades-por-estado/${estado}`);
      const cidades = await response.json();

      console.log(`[CIDADES] ${cidades.length} cidades carregadas para ${tipo} do estado ${estado}`);

      if (tipo === 'origem') {
        cidadesOrigem = cidades;
        const cidadeSelect = document.getElementById('viagemOrigemCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
          console.log(`[CIDADES] Select de origem atualizado com ${cidades.length} opções`);
        }
      } else {
        cidadesDestino = cidades;
        const cidadeSelect = document.getElementById('viagemDestinoCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
          console.log(`[CIDADES] Select de destino atualizado com ${cidades.length} opções`);
        }
      }
    } catch (err) {
      console.error(`[CIDADES] Erro ao carregar cidades do estado ${estado} para ${tipo}:`, err);
      showMessage('Erro ao carregar cidades. Verifique a conexão.', 'error');
    }
  }

  // Carregar roteiros baseados em origem e destino
  async function loadRoteirosPorRota(origem, destino, roteiroIdEsperado = null) {
    try {
      let url = '/api/roteiros-combo';
      const params = new URLSearchParams();
      if (origem) params.append('origem', origem);
      if (destino) params.append('destino', destino);
      if (params.toString()) url += `?${params.toString()}`;

      console.log('[ROTEIROS] Buscando roteiros:', { origem, destino, url });
      const response = await fetch(url);
      const roteiros = await response.json();
      console.log('[ROTEIROS] Roteiros recebidos:', roteiros.length, 'roteiros');
      roteirosCache = roteiros;

      const roteiroSelect = document.getElementById('viagemRoteiro');
      roteiroSelect.innerHTML = '<option value="">Selecione</option>';
      
      // Verificar se o roteiro esperado está na lista
      let roteiroEncontrado = false;
      if (roteiroIdEsperado) {
        roteiroEncontrado = roteiros.some(r => String(r.IDROTEIRO) === String(roteiroIdEsperado));
        if (!roteiroEncontrado) {
          console.warn('[ROTEIROS] ⚠️ Roteiro esperado não encontrado na lista filtrada:', roteiroIdEsperado);
          // Buscar roteiro específico pela API
          try {
            const roteiroResponse = await fetch(`/api/roteiros/${roteiroIdEsperado}`);
            if (roteiroResponse.ok) {
              const roteiroEspecifico = await roteiroResponse.json();
              console.log('[ROTEIROS] ✅ Roteiro específico encontrado:', roteiroEspecifico);
              roteiros.push(roteiroEspecifico);
              roteirosCache.push(roteiroEspecifico);
            }
          } catch (err) {
            console.error('[ROTEIROS] Erro ao buscar roteiro específico:', err);
          }
        }
      }
      
      roteiros.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.IDROTEIRO;
        opt.textContent = `${r.IDROTEIRO} - ${r.DSROTEIRO}`;
        opt.dataset.distancia = r.DISTANCIAKM;
        opt.dataset.origem = r.ORIGEM_CODIGO;
        opt.dataset.destino = r.DESTINO_CODIGO;
        roteiroSelect.appendChild(opt);
      });
      
      console.log('[ROTEIROS] Select preenchido com', roteiros.length, 'opções');
    } catch (err) {
      console.error('Erro ao carregar roteiros:', err);
      showMessage('Erro ao carregar roteiros. Verifique a conexão.', 'error');
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    // Mostrar overlay de carregamento
    showLoadingOverlayFiltros('Aplicando Filtros', 'Por favor, aguarde enquanto aplicamos os filtros...');
    
    // Obter referência do container uma única vez
    const gridContainer = document.getElementById('viagensGrid');
    
    // Mostrar skeleton loader no grid se existir
    if (gridContainer && typeof window.showSkeleton === 'function') {
      window.showSkeleton(gridContainer, 6, 'grid');
    }
    
    const btnAplicar = filtroForm?.querySelector('button[type="submit"]');
    if (btnAplicar && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnAplicar, true);
    }

    // Timeout de segurança: esconder loading após 30 segundos mesmo se der erro
    const timeoutSeguranca = setTimeout(() => {
      console.warn('⚠️ Timeout de segurança: escondendo loading após 30 segundos');
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    }, 30000);

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
      try {
        if (gridTab) {
          gridTab.render(viagens);
        } else if (openTab === 'grid' && typeof window.GridEditor === 'undefined') {
          // GridEditor deveria estar carregado no HTML
          console.warn('GridEditor não está disponível. Recarregue a página.');
          if (gridTab) {
            gridTab.render(viagens);
          }
        }
      } catch (renderErr) {
        console.error('Erro ao renderizar grid:', renderErr);
        // Continuar mesmo se falhar renderizar
      }
      
      // Esconder skeleton loader após renderizar (usando a referência já obtida)
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
      
      // Mudar para a aba solicitada (com timeout de segurança)
      try {
        const tabPromise = showTab(openTab);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout ao mudar aba')), 10000)
        );
        await Promise.race([tabPromise, timeoutPromise]);
      } catch (tabErr) {
        console.error('Erro ao mudar aba:', tabErr);
        // Continuar mesmo se falhar mudar aba
      }
      
      // Esconder loading após renderizar (garantir sempre)
      clearTimeout(timeoutSeguranca);
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
      
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
      clearTimeout(timeoutSeguranca);
      showMessage('Erro ao carregar viagens: ' + (err.message || 'Erro desconhecido'), 'error');
      bloqueandoMudancaAba = false;
      
      // Esconder loading imediatamente em caso de erro
      hideLoadingOverlayFiltros();
      if (btnAplicar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnAplicar, false);
      }
    } finally {
      // Esconder overlay de filtros (garantir sempre, com múltiplas tentativas)
      clearTimeout(timeoutSeguranca);
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
      console.log('[CARREGAR VIAGEM] Iniciando carregamento da viagem ID:', id);
      
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      // Isso evita que dados de uma viagem apareçam em outra
      const viagemForm = document.getElementById('viagemForm');
      if (viagemForm) {
        viagemForm.reset();
        // Limpar campos específicos que podem não ser limpos pelo reset
        document.getElementById('viagemId').value = '';
        document.getElementById('viagemOrigemCidade').value = '';
        document.getElementById('viagemDestinoCidade').value = '';
        document.getElementById('viagemOrigemEstado').value = '';
        document.getElementById('viagemDestinoEstado').value = '';
        document.getElementById('viagemRoteiro').value = '';
        document.getElementById('viagemOrigemCodigo').value = '';
        document.getElementById('viagemDestinoCodigo').value = '';
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
        console.log('[CARREGAR VIAGEM] Dados da viagem recebidos:', {
          ORIGEM_ESTADO: viagem.ORIGEM_ESTADO,
          ORIGEM_CODIGO: viagem.ORIGEM_CODIGO,
          DESTINO_ESTADO: viagem.DESTINO_ESTADO,
          DESTINO_CODIGO: viagem.DESTINO_CODIGO,
          IDROTEIRO: viagem.IDROTEIRO
        });
        
        if (viagem.ORIGEM_ESTADO) {
          const estadoOrigem = viagem.ORIGEM_ESTADO.trim();
          await preencherSelect('viagemOrigemEstado', estadoOrigem);
          await loadCidadesPorEstado(estadoOrigem, 'origem');
          
          // Aguardar cidades carregarem e preencher
          if (viagem.ORIGEM_CODIGO) {
            await new Promise(resolve => setTimeout(resolve, 300));
            await preencherSelect('viagemOrigemCidade', String(viagem.ORIGEM_CODIGO));
            document.getElementById('viagemOrigemCodigo').value = String(viagem.ORIGEM_CODIGO);
            console.log('[CARREGAR VIAGEM] Origem preenchida:', {
              estado: estadoOrigem,
              codigo: viagem.ORIGEM_CODIGO,
              cidadeSelectValue: document.getElementById('viagemOrigemCidade')?.value
            });
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
            console.log('[CARREGAR VIAGEM] Destino preenchido:', {
              estado: estadoDestino,
              codigo: viagem.DESTINO_CODIGO,
              cidadeSelectValue: document.getElementById('viagemDestinoCidade')?.value
            });
          }
        }
        
        // Carregar roteiros e preencher
        if (viagem.ORIGEM_CODIGO && viagem.DESTINO_CODIGO) {
          console.log('[CARREGAR VIAGEM] Carregando roteiros para origem:', viagem.ORIGEM_CODIGO, 'destino:', viagem.DESTINO_CODIGO, 'roteiro esperado:', viagem.IDROTEIRO);
          await loadRoteirosPorRota(String(viagem.ORIGEM_CODIGO), String(viagem.DESTINO_CODIGO), viagem.IDROTEIRO ? String(viagem.IDROTEIRO) : null);
          await new Promise(resolve => setTimeout(resolve, 300)); // Aumentar tempo de espera
          
          if (viagem.IDROTEIRO) {
            console.log('[CARREGAR VIAGEM] Tentando preencher roteiro ID:', viagem.IDROTEIRO);
            const roteiroSelect = document.getElementById('viagemRoteiro');
            
            // Verificar se o select tem opções
            if (roteiroSelect && roteiroSelect.options.length > 1) {
              const roteiroIdStr = String(viagem.IDROTEIRO);
              const opcaoExiste = Array.from(roteiroSelect.options).some(opt => 
                String(opt.value).trim() === roteiroIdStr.trim()
              );
              
              if (opcaoExiste) {
                roteiroSelect.value = roteiroIdStr;
                console.log('[CARREGAR VIAGEM] ✅ Roteiro preenchido com sucesso:', roteiroIdStr);
                // Carregar resumo da rota
                await carregarResumoRota(roteiroIdStr);
              } else {
                console.warn('[CARREGAR VIAGEM] ⚠️ Roteiro ID não encontrado no select:', roteiroIdStr);
                console.log('[CARREGAR VIAGEM] Opções disponíveis:', Array.from(roteiroSelect.options).map(opt => opt.value));
                // Tentar novamente após mais um tempo
                await new Promise(resolve => setTimeout(resolve, 200));
                await preencherSelect('viagemRoteiro', roteiroIdStr, 15); // Mais tentativas
                if (roteiroSelect.value === roteiroIdStr) {
                  console.log('[CARREGAR VIAGEM] ✅ Roteiro preenchido após retry');
                  await carregarResumoRota(roteiroIdStr);
                } else {
                  console.error('[CARREGAR VIAGEM] ❌ Falha ao preencher roteiro após retry');
                }
              }
            } else {
              console.warn('[CARREGAR VIAGEM] ⚠️ Select de roteiro ainda não tem opções. Aguardando...');
              // Aguardar mais e tentar novamente
              await new Promise(resolve => setTimeout(resolve, 500));
              await preencherSelect('viagemRoteiro', String(viagem.IDROTEIRO), 20); // Ainda mais tentativas
              if (document.getElementById('viagemRoteiro')?.value === String(viagem.IDROTEIRO)) {
                console.log('[CARREGAR VIAGEM] ✅ Roteiro preenchido após espera adicional');
                await carregarResumoRota(String(viagem.IDROTEIRO));
              }
            }
          } else {
            console.log('[CARREGAR VIAGEM] Viagem não tem IDROTEIRO definido');
          }
        } else {
          console.warn('[CARREGAR VIAGEM] ⚠️ Não foi possível carregar roteiros: origem ou destino faltando');
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
  // Função de validação de formulário
  function validarFormularioViagem() {
    const erros = [];
    
    // Validar campos obrigatórios
    const situacaoViagem = document.getElementById('viagemSituacaoViagem')?.value;
    if (!situacaoViagem) {
      erros.push('Situação Viagem é obrigatória');
      // Destacar campo
      const campo = document.getElementById('viagemSituacaoViagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const situacao = document.getElementById('viagemSituacao')?.value;
    if (!situacao) {
      erros.push('Situação é obrigatória');
      const campo = document.getElementById('viagemSituacao');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const tipoViagem = document.getElementById('viagemTipoViagem')?.value;
    if (!tipoViagem) {
      erros.push('Tipo de Viagem é obrigatório');
      const campo = document.getElementById('viagemTipoViagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const situacaoAtiva = document.getElementById('viagemSituacaoAtiva')?.value;
    if (!situacaoAtiva) {
      erros.push('Situação Ativa é obrigatória');
      const campo = document.getElementById('viagemSituacaoAtiva');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    // Validar datas (data fim deve ser maior que data início)
    const dataInicio = document.getElementById('viagemDataInicio')?.value;
    const dataFim = document.getElementById('viagemDataFim')?.value;
    if (dataInicio && dataFim) {
      const inicio = new Date(dataInicio);
      const fim = new Date(dataFim);
      if (fim < inicio) {
        erros.push('Data de término deve ser maior que data de início');
        const campoInicio = document.getElementById('viagemDataInicio');
        const campoFim = document.getElementById('viagemDataFim');
        if (campoInicio) {
          campoInicio.style.borderColor = '#dc3545';
          setTimeout(() => { campoInicio.style.borderColor = ''; }, 3000);
        }
        if (campoFim) {
          campoFim.style.borderColor = '#dc3545';
          setTimeout(() => { campoFim.style.borderColor = ''; }, 3000);
        }
      }
    }
    
    // Validar valores numéricos
    const distancia = document.getElementById('viagemDistancia')?.value;
    if (distancia && (isNaN(parseFloat(distancia)) || parseFloat(distancia) < 0)) {
      erros.push('Distância deve ser um número positivo');
      const campo = document.getElementById('viagemDistancia');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const frete = document.getElementById('viagemFrete')?.value;
    if (frete && (isNaN(parseFloat(frete)) || parseFloat(frete) < 0)) {
      erros.push('Valor do frete deve ser um número positivo');
      const campo = document.getElementById('viagemFrete');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const peso = document.getElementById('viagemPeso')?.value;
    if (peso && (isNaN(parseFloat(peso)) || parseFloat(peso) < 0)) {
      erros.push('Peso deve ser um número positivo');
      const campo = document.getElementById('viagemPeso');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    const cubagem = document.getElementById('viagemCubagem')?.value;
    if (cubagem && (isNaN(parseFloat(cubagem)) || parseFloat(cubagem) < 0)) {
      erros.push('Cubagem deve ser um número positivo');
      const campo = document.getElementById('viagemCubagem');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
      }
    }
    
    return erros;
  }

  viagemForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Validar formulário antes de enviar
    const erros = validarFormularioViagem();
    if (erros.length > 0) {
      showMessage('❌ Erros encontrados:\n\n' + erros.join('\n'), 'error');
      // Scroll para o primeiro campo com erro
      const primeiroErro = document.querySelector('input[style*="border-color: rgb(220, 53, 69)"], select[style*="border-color: rgb(220, 53, 69)"]');
      if (primeiroErro) {
        primeiroErro.scrollIntoView({ behavior: 'smooth', block: 'center' });
        primeiroErro.focus();
      }
      return;
    }
    
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
    
    // Validação já foi feita pela função validarFormularioViagem() acima
    // Apenas verificar se rastreado foi preenchido (campo obrigatório)
    if (!rastreado) {
      showMessage('Campo "Exige Veículo Rastreado?" é obrigatório.', 'error');
      const campo = document.getElementById('viagemRastreado');
      if (campo) {
        campo.style.borderColor = '#dc3545';
        setTimeout(() => { campo.style.borderColor = ''; }, 3000);
        campo.scrollIntoView({ behavior: 'smooth', block: 'center' });
        campo.focus();
      }
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
        const mensagemSucesso = data.message || 'Viagem salva com sucesso!';
        showMessage(`✅ ${mensagemSucesso}`, 'success');
        
        // Emitir evento WebSocket se for atualização
        if (id && typeof window.WebSocketTorre !== 'undefined') {
          try {
            const websocketTorre = window.WebSocketTorre;
            // Buscar dados atualizados da viagem para emitir evento
            const viagemAtualizada = await fetch(`/api/viagens/${id}`).then(r => r.json());
            if (viagemAtualizada && viagemAtualizada.IDVIAGEM) {
              // O evento será emitido automaticamente pelo controller no backend
              // Mas podemos forçar uma atualização na UI local se necessário
              if (typeof window.atualizarDadosViagem === 'function') {
                window.atualizarDadosViagem(id, viagemAtualizada);
              }
            }
          } catch (wsErr) {
            console.warn('Erro ao atualizar via WebSocket:', wsErr);
            // Não bloquear sucesso da operação
          }
        }
        
        // Aguardar um pouco antes de mudar de aba para garantir que mensagem seja vista
        await new Promise(resolve => setTimeout(resolve, 500));
        showTab('grid');
        await applyFilters('grid');
      } else {
        // Mensagem de erro mais detalhada
        let erroMsg = data.error || 'Erro ao salvar viagem.';
        if (data.details) {
          erroMsg += `\n\nDetalhes: ${data.details}`;
        }
        showMessage(`❌ ${erroMsg}`, 'error');
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
  filtroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await applyFilters('grid');
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
    }
    return false;
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
          
          // Invalidar tamanho múltiplas vezes para garantir renderização correta
          // Aguardar um pouco para o container estar totalmente visível
          setTimeout(() => {
            try {
              if (mapa) {
                mapa.invalidateSize();
                // Forçar recálculo do tamanho
                if (mapa._onResize) {
                  mapa._onResize();
                }
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho após limpar:', e);
            }
          }, 100);
          
          // Invalidar novamente após mais um delay
          setTimeout(() => {
            try {
              if (mapa) {
                mapa.invalidateSize();
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho (segunda tentativa):', e);
            }
          }, 300);
          
          // Atualizar mapa após garantir que o tamanho está correto
          setTimeout(() => {
            atualizarMapa();
          }, 400);
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
      
      // Carregar resumo da rota
      if (roteiroId) {
        await carregarResumoRota(roteiroId);
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

  // Função para carregar e exibir resumo da rota
  async function carregarResumoRota(roteiroId) {
    try {
      if (!roteiroId || roteiroId === '') {
        // Ocultar container se não houver roteiro
        const container = document.getElementById('resumoRotaContainer');
        if (container) {
          container.style.display = 'none';
        }
        return;
      }
      
      const response = await fetch(`/api/roteiros/${roteiroId}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar roteiro');
      }
      
      const roteiro = await response.json();
      const resumoRota = document.getElementById('resumoRota');
      const container = document.getElementById('resumoRotaContainer');
      
      if (roteiro.RESUMOROTA && roteiro.RESUMOROTA.trim() !== '') {
        // Exibir resumo formatado
        if (resumoRota) {
          resumoRota.textContent = roteiro.RESUMOROTA;
        }
        if (container) {
          container.style.display = 'block';
        }
        
        // Configurar botões de copiar e compartilhar
        configurarBotoesResumo(roteiro.RESUMOROTA);
      } else {
        // Ocultar se não houver resumo
        if (container) {
          container.style.display = 'none';
        }
      }
    } catch (err) {
    console.warn('Erro ao carregar resumo da rota:', err);
    const container = document.getElementById('resumoRotaContainer');
    if (container) {
      container.style.display = 'none';
    }
  }

  // Função para configurar botão de copiar resumo
  function configurarBotoesResumo(textoResumo) {
    const btnCopiar = document.getElementById('btnCopiarResumo');
    
    if (btnCopiar) {
      btnCopiar.onclick = async () => {
        try {
          // Copiar para área de transferência
          await navigator.clipboard.writeText(textoResumo);
          
          // Feedback visual
          const textoOriginal = btnCopiar.innerHTML;
          btnCopiar.innerHTML = '✅ Copiado!';
          btnCopiar.style.background = '#2ecc71';
          btnCopiar.style.borderColor = '#2ecc71';
          
          // Mostrar mensagem de sucesso
          showMessage('Resumo da rota copiado para a área de transferência!', 'success');
          
          // Restaurar botão após 2 segundos
          setTimeout(() => {
            btnCopiar.innerHTML = textoOriginal;
            btnCopiar.style.background = '';
            btnCopiar.style.borderColor = '';
          }, 2000);
        } catch (err) {
          console.error('Erro ao copiar:', err);
          // Fallback para navegadores antigos
          const textArea = document.createElement('textarea');
          textArea.value = textoResumo;
          textArea.style.position = 'fixed';
          textArea.style.left = '-999999px';
          document.body.appendChild(textArea);
          textArea.select();
          try {
            document.execCommand('copy');
            showMessage('Resumo da rota copiado!', 'success');
          } catch (e) {
            showMessage('Erro ao copiar. Tente selecionar o texto manualmente.', 'error');
          }
          document.body.removeChild(textArea);
        }
      };
    }
  }
}

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
      if (!nomeCidade || !estado) {
        console.warn('[Coordenadas] Cidade ou estado não fornecidos:', { nomeCidade, estado });
        return null;
      }
      
      const params = new URLSearchParams({
        cidade: nomeCidade.trim(),
        estado: estado.trim()
      });
      
      const url = `/api/cidades/coordenadas?${params.toString()}`;
      console.log('[Coordenadas] Buscando coordenadas para:', nomeCidade, estado);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json();
        } catch (e) {
          errorData = { error: `Erro HTTP ${response.status}: ${response.statusText}` };
        }
        console.error(`[Coordenadas] Erro ${response.status} ao buscar coordenadas de ${nomeCidade}/${estado}:`, errorData);
        return null;
      }
      
      const data = await response.json();
      
      if (data.success && data.lat && data.lon) {
        console.log(`[Coordenadas] ✅ Coordenadas encontradas para ${nomeCidade}/${estado}:`, data.lat, data.lon);
        return {
          lat: parseFloat(data.lat),
          lon: parseFloat(data.lon)
        };
      }
      
      if (data.success === false) {
        console.warn(`[Coordenadas] ⚠️ API retornou success: false para ${nomeCidade}/${estado}:`, data.error);
      } else {
        console.warn(`[Coordenadas] ⚠️ Resposta inválida para ${nomeCidade}/${estado}:`, data);
      }
      
      return null;
    } catch (err) {
      console.error(`[Coordenadas] ❌ Erro ao obter coordenadas de ${nomeCidade}/${estado}:`, err);
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
      const osrmUrl = construirUrlRota(
        config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
        coordsStr,
        'full',
        'geojson'
      );
      const response = await fetchForcandoHTTP(osrmUrl, { signal: AbortSignal.timeout(config.routeTimeout || 15000) });
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

    // Verificar se o container já tem um mapa inicializado
    if (mapaDiv._leaflet_id) {
      console.warn('⚠️ [VIAGENS] Container do mapa já tem um mapa inicializado. Removendo...');
      try {
        // Tentar obter o mapa existente e removê-lo
        const existingMap = L.Map.prototype.getContainer ? null : (window.L && window.L.map ? null : null);
        // Limpar o ID do Leaflet do container
        delete mapaDiv._leaflet_id;
        // Se houver referência ao mapa, removê-lo
        if (mapa) {
          try {
            mapa.remove();
          } catch (e) {
            // Ignorar
          }
          mapa = null;
        }
      } catch (e) {
        console.warn('⚠️ [VIAGENS] Erro ao limpar mapa existente:', e);
        // Limpar manualmente o container
        mapaDiv.innerHTML = '';
        mapaDiv._leaflet_id = undefined;
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
      if (mapaDiv.children.length > 0 || mapaDiv._leaflet_id) {
        // Verificar se há elementos do Leaflet antes de limpar
        const hasLeafletElements = Array.from(mapaDiv.children).some(child => 
          child.classList.contains('leaflet-container') || 
          child.classList.contains('leaflet-pane')
        );
        
        if (hasLeafletElements || mapaDiv._leaflet_id) {
          // Se há elementos do Leaflet, aguardar mais um pouco antes de limpar
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Limpar completamente
        mapaDiv.innerHTML = '';
        if (mapaDiv._leaflet_id) {
          delete mapaDiv._leaflet_id;
        }
        
        // Limpar qualquer referência do Leaflet
        if (typeof L !== 'undefined' && L.DomUtil) {
          try {
            L.DomUtil.empty(mapaDiv);
          } catch (e) {
            // Ignorar
          }
        }
        
        // Aguardar um frame para garantir que o DOM foi limpo
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Verificar novamente se está limpo antes de criar
      if (mapaDiv._leaflet_id) {
        console.warn('⚠️ [VIAGENS] Container ainda tem _leaflet_id após limpeza. Forçando remoção...');
        mapaDiv.innerHTML = '';
        delete mapaDiv._leaflet_id;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Criar mapa centrado no Brasil
      mapa = L.map('mapaRota', {
        preferCanvas: false,
        zoomControl: true
      }).setView([-14.2350, -51.9253], 4);

      // Adicionar camada de tiles do OpenStreetMap
      // IMPORTANTE: Usar APENAS getTileServerUrl() do map-config.js
      console.log('🗺️ [VIAGENS] Inicializando mapa...');
      console.log('🗺️ [VIAGENS] MAP_CONFIG disponível:', !!window.MAP_CONFIG);
      console.log('🗺️ [VIAGENS] getTileServerUrl disponível:', typeof window.getTileServerUrl === 'function');
      
      const tileConfig = window.getTileLayerConfig ? window.getTileLayerConfig() : {
        url: window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      
      console.log('🗺️ [VIAGENS] Tile server selecionado:', tileConfig.url);
      
      const tileOptions = {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom,
        updateWhenIdle: false,
        updateWhenZooming: true
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileConfig.url.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
        console.log('🗺️ [VIAGENS] Adicionando subdomínios para OpenStreetMap');
      }
      
      L.tileLayer(tileConfig.url, tileOptions).addTo(mapa);
      console.log('✅ [VIAGENS] TileLayer adicionado ao mapa');
      
      // Invalidar tamanho múltiplas vezes para garantir renderização correta
      // Aguardar um pouco para o container estar totalmente visível
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
            // Forçar recálculo do tamanho
            mapa._onResize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa:', e);
          }
        }
      }, 100);
      
      // Invalidar novamente após mais um delay (garantir que está visível)
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa (segunda tentativa):', e);
          }
        }
      }, 300);
      
      mapaInicializando = false;
      return true;
    } catch (err) {
      console.error('Erro ao inicializar mapa:', err);
      
      // Se o erro for "Map container is already initialized", limpar e tentar novamente
      if (err.message && err.message.includes('already initialized')) {
        console.warn('⚠️ [VIAGENS] Mapa já estava inicializado. Limpando container...');
        const mapaDiv = document.getElementById('mapaRota');
        if (mapaDiv) {
          // Limpar completamente o container
          mapaDiv.innerHTML = '';
          delete mapaDiv._leaflet_id;
          // Limpar referência do mapa
          if (mapa) {
            try {
              mapa.remove();
            } catch (e) {
              // Ignorar
            }
            mapa = null;
          }
          // Tentar novamente após limpar
          await new Promise(resolve => setTimeout(resolve, 100));
          mapaInicializando = false;
          return await inicializarMapa(); // Tentar novamente
        }
      }
      
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
  // Variável global para armazenar marcadores dos pontos do roteiro
  let marcadoresPontosRoteiro = [];
  
  function limparMapa() {
    if (!mapa || typeof L === 'undefined') return;
    
    console.log('🗺️ [LIMPAR MAPA] Iniciando limpeza completa do mapa...');
    
    // Remover todos os marcadores dos pontos do roteiro
    if (marcadoresPontosRoteiro && marcadoresPontosRoteiro.length > 0) {
      console.log(`🗺️ [LIMPAR MAPA] Removendo ${marcadoresPontosRoteiro.length} marcadores dos pontos do roteiro...`);
      marcadoresPontosRoteiro.forEach((marcador, index) => {
        try {
          if (marcador && mapa.hasLayer(marcador)) {
            mapa.removeLayer(marcador);
          }
        } catch (e) {
          console.warn(`🗺️ [LIMPAR MAPA] Erro ao remover marcador ${index}:`, e);
        }
      });
      marcadoresPontosRoteiro = []; // Limpar array
    }
    
    // Remover todos os marcadores e rotas
    if (marcadorOrigem) {
      try {
        if (mapa.hasLayer(marcadorOrigem)) {
          mapa.removeLayer(marcadorOrigem);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorOrigem = null;
    }
    if (marcadorDestino) {
      try {
        if (mapa.hasLayer(marcadorDestino)) {
          mapa.removeLayer(marcadorDestino);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      marcadorDestino = null;
    }
    if (linhaRota) {
      try {
        if (mapa.hasLayer(linhaRota)) {
          mapa.removeLayer(linhaRota);
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
      linhaRota = null;
    }
    
    // Remover TODAS as camadas que não sejam os tiles base (garantia extra)
    try {
      const layersToRemove = [];
      mapa.eachLayer((layer) => {
        // Não remover tile layers (base do mapa)
        if (!(layer instanceof L.TileLayer)) {
          layersToRemove.push(layer);
        }
      });
      
      layersToRemove.forEach((layer) => {
        try {
          mapa.removeLayer(layer);
        } catch (e) {
          // Ignorar erro
        }
      });
      
      if (layersToRemove.length > 0) {
        console.log(`🗺️ [LIMPAR MAPA] Removidas ${layersToRemove.length} camadas adicionais`);
      }
    } catch (e) {
      console.warn('🗺️ [LIMPAR MAPA] Erro ao limpar camadas:', e);
    }
    
    // Resetar view para o Brasil
    try {
      mapa.setView([-14.2350, -51.9253], 4);
    } catch (e) {
      // Ignorar erro se o mapa não estiver inicializado
    }
    
    console.log('✅ [LIMPAR MAPA] Limpeza completa finalizada');
  }

  // Funções para controlar overlay de carregamento do mapa
  function showMapaLoading(titulo = 'Carregando Mapa', texto = 'Preparando visualização da rota...') {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
    const overlay = document.getElementById('mapaLoadingOverlay');
    const titleEl = document.getElementById('mapaLoadingTitle');
    const textEl = document.getElementById('mapaLoadingText');
    if (overlay) {
      if (titleEl) titleEl.textContent = titulo;
      if (textEl) textEl.textContent = texto;
      overlay.style.display = 'flex';
      window.overlayMostrado = true;
    }
  }

  function hideMapaLoading() {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
    const overlay = document.getElementById('mapaLoadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
      window.overlayMostrado = false;
    }
  }

  // Função para atualizar o mapa com origem e destino
  async function atualizarMapa() {
    // Garantir que overlayMostrado está definida (proteção contra problemas de escopo/cache)
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    
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
    const viagemId = document.getElementById('viagemId')?.value;

    // Log para debug - verificar quais valores estão sendo usados
    console.log('[MAPA] Valores do formulário:', {
      viagemId: viagemId,
      origemCidadeId: origemCidadeId,
      destinoCidadeId: destinoCidadeId,
      origemEstado: origemEstado,
      destinoEstado: destinoEstado,
      roteiroId: roteiroId
    });

    // Validar se há origem e destino
    // Se não houver dados válidos, apenas limpar e resetar o mapa
    if (!origemCidadeId || !destinoCidadeId || !origemEstado || !destinoEstado) {
      console.warn('[MAPA] ⚠️ Dados incompletos para exibir rota. Campos faltando:', {
        origemCidadeId: !origemCidadeId,
        destinoCidadeId: !destinoCidadeId,
        origemEstado: !origemEstado,
        destinoEstado: !destinoEstado
      });
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
              .sort((a, b) => {
                // Converter ORDEM para número para ordenação correta
                const ordemA = parseFloat(a.ORDEM) || 0;
                const ordemB = parseFloat(b.ORDEM) || 0;
                return ordemA - ordemB;
              });
            
            // Log removido para reduzir verbosidade
            
            if (pontosComCoordenadas.length >= 2) {
              // Criar marcadores para cada ponto
              const cores = {
                'O': '#2ecc71', // Verde - Origem
                'D': '#e74c3c', // Vermelho - Destino
                'P': '#3498db', // Azul - Passagem
                'R': '#f39c12'  // Laranja - Parada
              };
              
              const icones = {
                'O': '🏁', // Origem mostra bandeira verde
                'D': '🏁', // Destino mostra bandeira xadrez
                'P': '📍',
                'R': '⏸'
              };
              
              const tiposDescricao = {
                'O': 'Origem',
                'D': 'Destino',
                'P': 'Passagem',
                'R': 'Parada'
              };
              
                // IMPORTANTE: Limpar marcadores anteriores antes de criar novos
                if (marcadoresPontosRoteiro && marcadoresPontosRoteiro.length > 0) {
                  console.log('🗺️ [ROTEIROS] Limpando marcadores anteriores dos pontos do roteiro...');
                  marcadoresPontosRoteiro.forEach(m => {
                    try {
                      if (m && mapa.hasLayer(m)) {
                        mapa.removeLayer(m);
                      }
                    } catch (e) {
                      // Ignorar
                    }
                  });
                  marcadoresPontosRoteiro = [];
                }
                
                const marcadores = [];
                const latlngs = [];
                
                // Calcular distâncias acumuladas desde a origem
                let distanciaAcumulada = 0;
                
                // Ajustar tipos: garantir que apenas o primeiro seja Origem e o último seja Destino
                pontosComCoordenadas.forEach((ponto, index) => {
                // Normalizar TPLOCAL - garantir que seja string e uppercase, tratar null/undefined
                let tipoLocal = '';
                if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
                  tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
                }
                
                const isPrimeiro = index === 0;
                const isUltimo = index === pontosComCoordenadas.length - 1;
                const isIntermediario = !isPrimeiro && !isUltimo;
                
                // Lógica de ajuste de tipos:
                // - Primeiro ponto SEMPRE é Origem (O)
                // - Último ponto SEMPRE é Destino (D)
                // - Pontos intermediários: manter tipo original (P ou R), mas converter O/D para P
                
                const tipoOriginal = tipoLocal; // Guardar tipo original para debug
                
                if (isPrimeiro) {
                  // Primeiro ponto sempre é Origem
                  tipoLocal = 'O';
                } else if (isUltimo) {
                  // Último ponto sempre é Destino
                  tipoLocal = 'D';
                } else if (isIntermediario) {
                  // Pontos intermediários: se for O ou D, converter para Passagem
                  // Caso contrário, manter o tipo original (P ou R)
                  if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal || tipoLocal === '') {
                    tipoLocal = 'P'; // Default para Passagem se não tiver tipo ou for O/D
                  }
                  // Se já é P ou R, manter o tipo original
                }
                
                // Debug: mostrar ajuste de tipo
                if (tipoOriginal !== tipoLocal) {
                  console.log(`Ponto ${index + 1}: Tipo ajustado de "${tipoOriginal}" para "${tipoLocal}"`);
                }
                
                const cor = cores[tipoLocal] || '#95a5a6';
                const icone = icones[tipoLocal] || '📍';
                const descricaoTipo = tiposDescricao[tipoLocal] || tipoLocal || 'Não definido';
                
                // Calcular distância acumulada (somar distâncias dos pontos anteriores)
                if (index > 0 && ponto.KMENTREPONTOS) {
                  distanciaAcumulada += parseFloat(ponto.KMENTREPONTOS) || 0;
                }
                
                // Número da ordem para exibir no marcador
                const numeroOrdem = index + 1;
                
                // Criar marcador customizado com número da ordem
                // Para Origem e Destino, mostrar apenas o ícone (sem número sobreposto)
                // Para Passagem e Parada, mostrar número + ícone
                const mostrarNumero = tipoLocal !== 'O' && tipoLocal !== 'D';
                
                const marcador = L.marker([ponto.LATITUDE, ponto.LONGITUDE], {
                  icon: L.divIcon({
                    className: 'custom-marker',
                    html: `<div style="
                      background: ${cor};
                      width: 35px;
                      height: 35px;
                      border-radius: 50%;
                      border: 3px solid white;
                      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                      display: flex;
                      align-items: center;
                      justify-content: center;
                      font-size: ${tipoLocal === 'O' ? '18px' : tipoLocal === 'D' ? '20px' : '12px'};
                      font-weight: bold;
                      color: white;
                      position: relative;
                    ">
                      ${mostrarNumero ? `<span style="position: absolute; top: -2px; left: -2px; background: rgba(0,0,0,0.7); color: white; border-radius: 50%; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold;">${numeroOrdem}</span>` : ''}
                      <span style="font-size: ${tipoLocal === 'O' ? '20px' : tipoLocal === 'D' ? '18px' : '18px'}; line-height: 1;">${icone}</span>
                    </div>`,
                    iconSize: [35, 35],
                    iconAnchor: [17, 17]
                  })
                }).addTo(mapa);
                
                // IMPORTANTE: Armazenar marcador para poder limpar depois
                marcadoresPontosRoteiro.push(marcador);
                marcadores.push(marcador);
                
                // Popup com informações detalhadas
                const popupContent = `
                  <div style="min-width: 250px;">
                    <div style="background: ${cor}; color: white; padding: 8px; border-radius: 4px 4px 0 0; margin: -10px -10px 10px -10px;">
                      <strong>Ponto ${numeroOrdem} - ${descricaoTipo}</strong>
                    </div>
                    <strong>${ponto.DSLOCAL || 'Sem descrição'}</strong><br>
                    <small style="color: #666;">${ponto.DSPOSICAO || 'Sem posição'}</small><br>
                    <hr style="margin: 8px 0;">
                    <strong>Ordem no roteiro:</strong> ${ponto.ORDEM || 'N/A'}<br>
                    ${ponto.KMENTREPONTOS ? `<strong>Distância do ponto anterior:</strong> ${parseFloat(ponto.KMENTREPONTOS).toFixed(2)} km<br>` : ''}
                    ${index > 0 ? `<strong>Distância acumulada da origem:</strong> ${distanciaAcumulada.toFixed(2)} km<br>` : ''}
                    <strong>Coordenadas:</strong><br>
                    <small style="font-family: monospace;">${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}</small>
                  </div>
                `;
                marcador.bindPopup(popupContent);
                
                marcadores.push(marcador);
                latlngs.push([ponto.LATITUDE, ponto.LONGITUDE]);
              });
              
              // Atualizar mensagem do overlay
              showMapaLoading('Traçando Rota', 'Calculando rota real entre os pontos...');
              
              // Desenhar rota usando OSRM com todos os pontos
              let data = null;
              let osrmSucesso = false;
              let routeLatLngs = [];
              
              try {
                const config = window.MAP_CONFIG || {};
                
                // Função helper para normalizar URL do OSRM (garantir HTTP para servidor próprio)
                function normalizarOSRMUrl(servidor) {
                  if (!servidor) return 'https://router.project-osrm.org/route/v1/driving-hgv';
                  // Se for servidor próprio, garantir que use HTTP (não HTTPS)
                  const servidoresProprios = ['186.250.92.131', 'app.integrabrasil.com', 'beta.integrabrasil.com'];
                  const isServidorProprio = servidoresProprios.some(s => servidor.includes(s));
                  
                  if (isServidorProprio) {
                    let normalized = servidor.replace(/^https:/, 'http:');
                    normalized = normalized.replace(/https:\/\//, 'http://');
                    
                    // Verificar se ainda está em HTTPS
                    if (normalized.startsWith('https:')) {
                      normalized = 'http:' + normalized.substring(6);
                    }
                    
                    if (normalized !== servidor) {
                      console.log('🔄 [OSRM] Normalizando URL:', servidor, '→', normalized);
                    }
                    return normalized;
                  }
                  return servidor;
                }
                
                // Se houver muitos pontos (mais de 5), calcular rota em segmentos para evitar timeout
                if (latlngs.length > 5) {
                  console.log('[MAPA] Muitos pontos detectados (' + latlngs.length + '), calculando rota em segmentos...');
                  
                  // Função auxiliar para tentar obter rota de um segmento com retry
                  async function obterRotaSegmento(segmento, servidor, tentativa = 1) {
                    const coordsStr = segmento.map(c => `${c[1]},${c[0]}`).join(';');
                    
                    // IMPORTANTE: Normalizar servidor ANTES de construir URL
                    let servidorNormalizado = servidor;
                    const servidoresProprios = ['186.250.92.131', 'app.integrabrasil.com', 'beta.integrabrasil.com'];
                    const isServidorProprio = servidoresProprios.some(s => servidor && servidor.includes(s));
                    
                    if (isServidorProprio) {
                      servidorNormalizado = servidor.replace(/^https:/, 'http:');
                      servidorNormalizado = servidorNormalizado.replace(/https:\/\//, 'http://');
                      if (servidorNormalizado !== servidor) {
                        console.log('🔄 [OSRM] Normalizando URL:', servidor, '→', servidorNormalizado);
                      }
                    }
                    
                    // IMPORTANTE: Usar construirUrlRota que já normaliza corretamente
                    const osrmUrl = construirUrlRota(servidorNormalizado, coordsStr, 'full', 'geojson');
                    
                    // Verificar e corrigir URL antes de fazer fetch
                    let urlFinal = osrmUrl;
                    // Reutilizar servidoresProprios já declarado acima
                    const isServidorProprioUrl = servidoresProprios.some(s => osrmUrl.includes(s));
                    
                    if (isServidorProprioUrl && osrmUrl.startsWith('https:')) {
                      urlFinal = osrmUrl.replace(/^https:/, 'http:');
                      console.warn('⚠️ [OSRM] URL corrigida de HTTPS para HTTP:', osrmUrl.substring(0, 80), '→', urlFinal.substring(0, 80));
                    }
                    
                    // Verificar novamente após correção
                    if (isServidorProprioUrl && urlFinal.startsWith('https:')) {
                      console.error('❌ [OSRM] ERRO CRÍTICO: URL ainda está em HTTPS após correção!', urlFinal);
                      urlFinal = 'http:' + urlFinal.substring(6); // Forçar HTTP
                    }
                    
                    try {
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 segundos
                      
                      console.log('🌐 [OSRM] Fazendo fetch para:', urlFinal.substring(0, 100) + '...');
                      const response = await fetchForcandoHTTP(urlFinal, { signal: controller.signal });
                      clearTimeout(timeoutId);
                      
                      if (response.ok) {
                        const segmentData = await response.json();
                        if (segmentData.code === 'Ok' && segmentData.routes && segmentData.routes[0]) {
                          const segmentGeometry = segmentData.routes[0].geometry.coordinates;
                          return segmentGeometry.map(c => [c[1], c[0]]); // Converter [lon, lat] para [lat, lon]
                        }
                      }
                      throw new Error(`Resposta inválida: ${response.status}`);
                    } catch (err) {
                      if (tentativa < 2 && err.name !== 'AbortError') {
                        // Tentar novamente após 1 segundo
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        return obterRotaSegmento(segmento, servidor, tentativa + 1);
                      }
                      throw err;
                    }
                  }
                  
                  // Calcular rota segmento por segmento
                  for (let i = 0; i < latlngs.length - 1; i++) {
                    const segmento = [latlngs[i], latlngs[i + 1]];
                    let segmentRoute = null;
                    
                    // Tentar primeiro com servidor principal
                    try {
                      const osrmServerOriginal = config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv';
                      const osrmServerPrincipal = normalizarOSRMUrl(osrmServerOriginal);
                      console.log(`🔄 [OSRM] Segmento ${i + 1}: usando servidor`, osrmServerPrincipal);
                      segmentRoute = await obterRotaSegmento(segmento, osrmServerPrincipal);
                      console.log(`[MAPA] Segmento ${i + 1}/${latlngs.length - 1} calculado com sucesso`);
                    } catch (err) {
                      // Se falhar, tentar com servidor alternativo (só se não for bloqueado por CSP)
                      console.warn(`[MAPA] Segmento ${i + 1} falhou no servidor principal, tentando alternativo...`);
                      try {
                        // Usar servidor público que está permitido no CSP
                        const osrmServerAlt = 'https://router.project-osrm.org/route/v1/driving-hgv';
                        segmentRoute = await obterRotaSegmento(segmento, osrmServerAlt);
                        console.log(`[MAPA] Segmento ${i + 1}/${latlngs.length - 1} calculado com servidor alternativo`);
                      } catch (err2) {
                        console.warn(`[MAPA] Segmento ${i + 1} falhou em ambos servidores, usando linha reta`);
                        // Se ambos falharem, usar linha reta para esse segmento
                        segmentRoute = segmento;
                      }
                    }
                    
                    // Adicionar segmento à rota total (evitar duplicar o último ponto)
                    if (i === 0) {
                      routeLatLngs.push(...segmentRoute);
                    } else {
                      // Se o segmento anterior tinha mais de 2 pontos, é uma rota real
                      // Se não, é linha reta e precisamos adicionar o ponto final
                      if (segmentRoute.length > 2) {
                        routeLatLngs.push(...segmentRoute.slice(1)); // Pular primeiro ponto
                      } else {
                        routeLatLngs.push(segmentRoute[segmentRoute.length - 1]); // Adicionar último ponto
                      }
                    }
                    
                    // Pequeno delay entre segmentos para não sobrecarregar o servidor
                    if (i < latlngs.length - 2) {
                      await new Promise(resolve => setTimeout(resolve, 500)); // Aumentado para 500ms
                    }
                  }
                  
                  // Verificar se conseguiu calcular pelo menos alguns segmentos
                  // Se tem mais pontos que os originais, conseguiu calcular rotas reais
                  osrmSucesso = routeLatLngs.length > latlngs.length;
                  
                  // Se não conseguiu calcular nenhuma rota real, mas tem pontos, ainda é melhor que nada
                  if (!osrmSucesso && routeLatLngs.length > 0) {
                    console.warn('[MAPA] ⚠️ Alguns segmentos falharam, mas a rota será desenhada com os segmentos disponíveis');
                    osrmSucesso = true; // Permitir desenhar mesmo com alguns segmentos em linha reta
                  }
                } else {
                  // Para poucos pontos, fazer uma única requisição
                  // Formato correto para OSRM: "lon,lat;lon,lat" (longitude primeiro!)
                  const coordsStr = latlngs.map(c => `${c[1]},${c[0]}`).join(';');
                  // IMPORTANTE: Usar construirUrlRota que já normaliza corretamente
                  const osrmUrl = construirUrlRota(
                    config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                    coordsStr,
                    'full',
                    'geojson'
                  );
                  
                  // Verificar se URL está correto antes de fazer fetch
                  if (osrmUrl.includes('186.250.92.131') && osrmUrl.startsWith('https:')) {
                    console.error('❌ [OSRM] ERRO CRÍTICO: URL ainda está em HTTPS!', osrmUrl);
                  }
                  
                  // Usar AbortController para timeout (aumentado para 30s)
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), config.routeTimeout || 30000);
                  
                      console.log('🌐 [OSRM] Fazendo fetch para:', osrmUrl.substring(0, 100) + '...');
                      const response = await fetchForcandoHTTP(osrmUrl, { signal: controller.signal });
                      clearTimeout(timeoutId);
                      
                      if (!response.ok) {
                        throw new Error(`OSRM retornou status ${response.status}: ${response.statusText}`);
                      }
                      
                      data = await response.json();
                  
                  // Log removido
                  
                  if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                    const geometry = data.routes[0].geometry.coordinates;
                    routeLatLngs = geometry.map(c => [c[1], c[0]]); // OSRM retorna [lon, lat], Leaflet precisa [lat, lon]
                    osrmSucesso = true;
                  } else {
                    throw new Error(`OSRM retornou código: ${data.code}, mensagem: ${data.message || 'N/A'}`);
                  }
                }
                
                // Desenhar rota se conseguiu calcular
                if (osrmSucesso && routeLatLngs.length > 0) {
                  // Remover linha anterior se existir
                  if (linhaRota) {
                    mapa.removeLayer(linhaRota);
                  }
                  
                  linhaRota = L.polyline(routeLatLngs, {
                    color: '#3498db',
                    weight: 4,
                    opacity: 0.7
                  }).addTo(mapa);
                  
                  // Calcular distância total se tiver dados do OSRM
                  if (data && data.routes && data.routes[0]) {
                    const distanciaTotal = (data.routes[0].distance / 1000).toFixed(2);
                    linhaRota.bindPopup(`<strong>Distância total da rota:</strong> ${distanciaTotal} km`);
                  }
                  
                  // Log removido
                } else {
                  throw new Error('Não foi possível calcular a rota');
                }
              } catch (err) {
                if (err.name === 'AbortError') {
                  console.warn('[MAPA] ⏱️ Timeout ao obter rota do OSRM');
                } else {
                  console.error('[MAPA] ❌ Erro ao obter rota do OSRM:', err);
                  console.error('[MAPA] Detalhes do erro:', {
                    name: err.name,
                    message: err.message
                  });
                }
                // Fallback: linha reta entre pontos
                if (linhaRota) {
                  mapa.removeLayer(linhaRota);
                }
                linhaRota = L.polyline(latlngs, {
                  color: '#e74c3c',
                  weight: 4,
                  opacity: 0.7,
                  dashArray: '10, 10'
                }).addTo(mapa);
                linhaRota.bindPopup('<strong>Atenção:</strong> Rota em linha reta (erro ao calcular rota real)');
              }
              
              // Processar informações detalhadas da rota (rodovias, cidades, etc.)
              let informacoesRota = await processarInformacoesRotaOSRM(data, pontosComCoordenadas, latlngs);
              
              // Calcular distância total
              let distanciaTotal = null;
              if (data && data.routes && data.routes[0]) {
                // Se OSRM funcionou, usar distância do OSRM
                distanciaTotal = (data.routes[0].distance / 1000).toFixed(2) + ' km';
              } else {
                // Se OSRM falhou, calcular somando as distâncias entre pontos do roteiro
                let distanciaAcumulada = 0;
                pontosComCoordenadas.forEach((ponto, index) => {
                  if (index > 0 && ponto.KMENTREPONTOS) {
                    distanciaAcumulada += parseFloat(ponto.KMENTREPONTOS) || 0;
                  }
                });
                // Se não tiver KMENTREPONTOS, calcular distância Haversine entre pontos consecutivos
                if (distanciaAcumulada === 0 && pontosComCoordenadas.length > 1) {
                  for (let i = 1; i < pontosComCoordenadas.length; i++) {
                    const dist = calcularDistanciaHaversine(
                      pontosComCoordenadas[i-1].LATITUDE,
                      pontosComCoordenadas[i-1].LONGITUDE,
                      pontosComCoordenadas[i].LATITUDE,
                      pontosComCoordenadas[i].LONGITUDE
                    );
                    distanciaAcumulada += dist;
                  }
                }
                distanciaTotal = distanciaAcumulada > 0 ? distanciaAcumulada.toFixed(2) + ' km' : null;
              }
              
              // Distância total calculada
              
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
              
              // Invalidar tamanho múltiplas vezes para garantir renderização correta
              setTimeout(() => {
                if (mapa) {
                  try {
                    mapa.invalidateSize();
                    if (mapa._onResize) {
                      mapa._onResize();
                    }
                  } catch (e) {
                    console.warn('Erro ao invalidar tamanho após ajustar bounds (roteiro):', e);
                  }
                }
              }, 100);
              
              setTimeout(() => {
                if (mapa) {
                  try {
                    mapa.invalidateSize();
                  } catch (e) {
                    // Ignorar erro
                  }
                }
              }, 300);
              
              // Marcadores criados
              
              // Preparar dados para exibição usando informações processadas
              // Buscar informações das cidades das variáveis globais
              const origemCidadeObj = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
              const destinoCidadeObj = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);
              
              console.log('[MAPA] Buscando informações das cidades:', {
                origemCidadeId: origemCidadeId,
                destinoCidadeId: destinoCidadeId,
                origemCidadeObj: origemCidadeObj ? `${origemCidadeObj.NMCIDADE}/${origemEstado}` : 'NÃO ENCONTRADA',
                destinoCidadeObj: destinoCidadeObj ? `${destinoCidadeObj.NMCIDADE}/${destinoEstado}` : 'NÃO ENCONTRADA',
                totalCidadesOrigem: cidadesOrigem.length,
                totalCidadesDestino: cidadesDestino.length
              });
              
              // Extrair cidade real da origem (priorizar NMCIDADE, depois DSLOCAL)
              const cidadeOrigem = origemCidadeObj?.NMCIDADE || pontosComCoordenadas[0]?.DSLOCAL?.split(',')[0]?.trim() || pontosComCoordenadas[0]?.DSLOCAL || 'N/A';
              // Extrair cidade real do destino (priorizar NMCIDADE, depois DSLOCAL)
              const cidadeDestino = destinoCidadeObj?.NMCIDADE || pontosComCoordenadas[pontosComCoordenadas.length - 1]?.DSLOCAL?.split(',')[0]?.trim() || pontosComCoordenadas[pontosComCoordenadas.length - 1]?.DSLOCAL || 'N/A';
              
              console.log('[MAPA] Cidades extraídas para exibição:', {
                cidadeOrigem: cidadeOrigem,
                cidadeDestino: cidadeDestino
              });
              
              const dadosRota = {
                origem: {
                  cidade: cidadeOrigem,
                  estado: origemEstado || ''
                },
                destino: {
                  cidade: cidadeDestino,
                  estado: destinoEstado || ''
                },
                distancia: distanciaTotal,
                tempoEstimado: data && data.routes && data.routes[0] && data.routes[0].duration 
                  ? Math.round(data.routes[0].duration / 60) + ' minutos' 
                  : null,
                pontosIntercalados: informacoesRota.pontosIntercalados || [],
                rodovias: informacoesRota.rodovias || [],
                cidadesPassagem: informacoesRota.cidadesPassagem || [],
                instrucoes: informacoesRota.instrucoes || [],
                detalhes: [
                  `Rota com ${pontosComCoordenadas.length} ponto(s) de referência`,
                  data && data.routes && data.routes[0] 
                    ? 'Distância total calculada pela rota real (OSRM)' 
                    : 'Distância total calculada pelos pontos do roteiro',
                  data && data.routes && data.routes[0] ? `Tempo estimado de viagem: ${Math.round(data.routes[0].duration / 60)} minutos` : null
                ].filter(d => d !== null)
              };
              
              
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

      // Log para debug - verificar quais cidades estão sendo buscadas
      console.log('[MAPA] Buscando coordenadas para:', {
        origem: `${origemCidade.NMCIDADE}, ${origemEstado}`,
        destino: `${destinoCidade.NMCIDADE}, ${destinoEstado}`
      });

      // Obter coordenadas
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado)
      ]);

      if (!coordsOrigem || !coordsDestino) {
        console.error('[MAPA] ❌ Erro ao obter coordenadas:', {
          origem: coordsOrigem ? 'OK' : 'FALHOU',
          destino: coordsDestino ? 'OK' : 'FALHOU'
        });
        hideMapaLoading();
        showMessage('Não foi possível obter as coordenadas para exibir o mapa.', 'error');
        return;
      }
      
      console.log('[MAPA] ✅ Coordenadas obtidas:', {
        origem: coordsOrigem,
        destino: coordsDestino
      });
      
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
      
      // Obter rota real usando OSRM (Open Source Routing Machine) com informações detalhadas
      let rotaData = null;
      let informacoesRota = { rodovias: [], cidadesPassagem: [], instrucoes: [], pontosIntercalados: [] };
      try {
        const config = window.MAP_CONFIG || {};
        // Chamada direta ao OSRM (sem steps e annotations para ser mais rápido)
        // Formato OSRM: "lon,lat;lon,lat" (longitude primeiro!)
        const coordsStr = `${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}`;
        const osrmUrl = construirUrlRota(
          config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
          coordsStr,
          'full',
          'geojson'
        );
        
        console.log('[MAPA] Tentando obter rota do OSRM (origem/destino):', osrmUrl.substring(0, 150) + '...');
        
        // Verificar se URL está correto antes de fazer fetch
        if (osrmUrl.includes('186.250.92.131') && osrmUrl.startsWith('https:')) {
          console.error('❌ [OSRM] ERRO CRÍTICO: URL ainda está em HTTPS!', osrmUrl);
        }
        
        // Usar AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000); // 20 segundos de timeout
        
        const rotaResponse = await fetchForcandoHTTP(osrmUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!rotaResponse.ok) {
          throw new Error(`OSRM retornou status ${rotaResponse.status}: ${rotaResponse.statusText}`);
        }
        
        rotaData = await rotaResponse.json();
        
        // Log removido
        
        // Processar informações detalhadas da rota
        informacoesRota = await processarInformacoesRotaOSRM(rotaData, null, null);
        
        let distanciaRota = null;
        let tempoEstimado = null;
        let rotaDataFinal = null;
        
        if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
          // Remover linha anterior se existir
          if (linhaRota) {
            mapa.removeLayer(linhaRota);
          }
          
          // Usar a rota real obtida do OSRM
          const coordenadasRota = rotaData.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]); // OSRM retorna [lon, lat], Leaflet precisa [lat, lon]
          
          linhaRota = L.polyline(coordenadasRota, {
            color: '#3498db',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
          }).addTo(mapa);
          
          // Calcular distância real da rota
          distanciaRota = (rotaData.routes[0].distance / 1000).toFixed(2); // Converter metros para km
          tempoEstimado = rotaData.routes[0].duration ? Math.round(rotaData.routes[0].duration / 60) + ' minutos' : null;
          rotaDataFinal = rotaData;
          linhaRota.bindPopup(`<strong>Distância da Rota:</strong> ${distanciaRota} km`);
          
          console.log('[MAPA] ✅ Rota OSRM desenhada com sucesso (origem/destino)!');
        } else {
          console.warn('[MAPA] ⚠️ OSRM retornou código:', rotaData.code, 'Mensagem:', rotaData.message);
          // Remover linha anterior se existir
          if (linhaRota) {
            mapa.removeLayer(linhaRota);
          }
          // Fallback: usar linha reta se não conseguir obter a rota
          linhaRota = L.polyline(
            [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
            {
              color: '#e74c3c',
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
          distanciaRota = distancia.toFixed(2);
          linhaRota.bindPopup(`<strong>Atenção: Distância (linha reta):</strong> ${distanciaRota} km`);
        }
        
        // Preparar dados para exibição usando informações processadas
        const pontosIntercalados = [
          {
            tipo: 'ponto',
            subtipo: 'O',
            ordem: 10,
            local: origemCidade.NMCIDADE || 'N/A',
            posicao: `${origemCidade.NMCIDADE}, ${origemEstado}`,
            distanciaAnterior: null,
            distanciaAcumulada: 0,
            coordenadas: `${coordsOrigem.lat.toFixed(6)}, ${coordsOrigem.lon.toFixed(6)}`
          }
        ];
        
        // Adicionar rodovias se houver
        if (informacoesRota.rodovias && informacoesRota.rodovias.length > 0) {
          informacoesRota.rodovias.forEach((rodovia, idx) => {
            pontosIntercalados.push({
              tipo: 'rodovia',
              nome: rodovia,
              ordem: 15 + idx
            });
          });
        }
        
        pontosIntercalados.push({
          tipo: 'ponto',
          subtipo: 'D',
          ordem: 20,
          local: destinoCidade.NMCIDADE || 'N/A',
          posicao: `${destinoCidade.NMCIDADE}, ${destinoEstado}`,
          distanciaAnterior: distanciaRota ? distanciaRota + ' km' : null,
          distanciaAcumulada: distanciaRota ? parseFloat(distanciaRota) : 0,
          coordenadas: `${coordsDestino.lat.toFixed(6)}, ${coordsDestino.lon.toFixed(6)}`
        });
        
        const dadosRota = {
          origem: {
            cidade: origemCidade.NMCIDADE || 'N/A',
            estado: origemEstado || ''
          },
          destino: {
            cidade: destinoCidade.NMCIDADE || 'N/A',
            estado: destinoEstado || ''
          },
          distancia: distanciaRota ? distanciaRota + ' km' : null,
          tempoEstimado: tempoEstimado,
          pontosIntercalados: pontosIntercalados,
          rodovias: informacoesRota.rodovias || [],
          cidadesPassagem: informacoesRota.cidadesPassagem || [],
          instrucoes: informacoesRota.instrucoes || [],
          pedagios: informacoesRota.pedagios || [],
          detalhes: [
            'Rota direta entre origem e destino',
            distanciaRota ? `Distância total: ${distanciaRota} km` : null,
            tempoEstimado ? `Tempo estimado: ${tempoEstimado}` : null,
            'Consulte o mapa para visualizar o trajeto completo'
          ].filter(d => d !== null)
        };
        
        // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn('[MAPA] ⏱️ Timeout ao obter rota do OSRM (mais de 20s)');
        } else {
          console.error('[MAPA] ❌ Erro ao obter rota do OSRM:', err);
          console.error('[MAPA] Detalhes do erro:', {
            name: err.name,
            message: err.message,
            stack: err.stack
          });
        }
        // Remover linha anterior se existir
        if (linhaRota) {
          mapa.removeLayer(linhaRota);
        }
        // Fallback: usar linha reta em caso de erro
        linhaRota = L.polyline(
          [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
          {
            color: '#e74c3c',
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
        const distanciaRota = distancia.toFixed(2);
        linhaRota.bindPopup(`<strong>Atenção: Distância (linha reta):</strong> ${distanciaRota} km`);
        
        // Preparar dados para exibição (fallback)
        const pontosIntercaladosFallback = [
          {
            tipo: 'ponto',
            subtipo: 'O',
            ordem: 10,
            local: origemCidade.NMCIDADE || 'N/A',
            posicao: `${origemCidade.NMCIDADE}, ${origemEstado}`,
            distanciaAnterior: null,
            distanciaAcumulada: 0,
            coordenadas: `${coordsOrigem.lat.toFixed(6)}, ${coordsOrigem.lon.toFixed(6)}`
          },
          {
            tipo: 'ponto',
            subtipo: 'D',
            ordem: 20,
            local: destinoCidade.NMCIDADE || 'N/A',
            posicao: `${destinoCidade.NMCIDADE}, ${destinoEstado}`,
            distanciaAnterior: distanciaRota + ' km',
            distanciaAcumulada: parseFloat(distanciaRota),
            coordenadas: `${coordsDestino.lat.toFixed(6)}, ${coordsDestino.lon.toFixed(6)}`
          }
        ];
        
        const dadosRota = {
          origem: {
            cidade: origemCidade.NMCIDADE || 'N/A',
            estado: origemEstado || ''
          },
          destino: {
            cidade: destinoCidade.NMCIDADE || 'N/A',
            estado: destinoEstado || ''
          },
          distancia: distanciaRota + ' km',
          tempoEstimado: null,
          pontosIntercalados: pontosIntercaladosFallback,
          rodovias: [],
          cidadesPassagem: [],
          instrucoes: [],
          pedagios: [],
          detalhes: [
            'Rota calculada em linha reta (não foi possível obter rota real)',
            `Distância: ${distanciaRota} km`,
            'Consulte o mapa para visualizar o trajeto'
          ]
        };
        
        // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
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
      
      // Invalidar tamanho do mapa múltiplas vezes para garantir renderização correta
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
            if (mapa._onResize) {
              mapa._onResize();
            }
          } catch (e) {
            console.warn('Erro ao invalidar tamanho após ajustar bounds:', e);
          }
        }
      }, 100);
      
      setTimeout(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            // Ignorar erro
          }
        }
      }, 300);
      
      // Esconder overlay após um pequeno delay
      requestAnimationFrame(() => {
        setTimeout(() => {
          hideMapaLoading();
          
          // Carregar resumo da rota se houver roteiro selecionado
          const roteiroIdFinal = document.getElementById('viagemRoteiro')?.value;
          if (roteiroIdFinal) {
            carregarResumoRota(roteiroIdFinal);
          } else {
            // Ocultar resumo se não houver roteiro
            const container = document.getElementById('resumoRotaContainer');
            if (container) {
              container.style.display = 'none';
            }
          }
        }, 300);
      });

    } catch (err) {
      hideMapaLoading();
      console.error('Erro ao atualizar mapa:', err);
      showMessage('Erro ao atualizar o mapa. Tente novamente.', 'error');
      
      // Tentar carregar resumo mesmo em caso de erro (pode ter roteiro válido)
      const roteiroIdFinal = document.getElementById('viagemRoteiro')?.value;
      if (roteiroIdFinal) {
        carregarResumoRota(roteiroIdFinal);
      }
    }
  }

  // Função para fazer geocodificação reversa e obter cidade de uma coordenada
  async function obterCidadePorCoordenada(lat, lon) {
    try {
      // Usar Nominatim para reverse geocoding
      const nominatimServer = window.MAP_CONFIG?.nominatimServer || 'http://app.integrabrasil.com:8080/nominatim';
      const url = `${nominatimServer}/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'DivulgaCarga/1.0 (contact: sistema@divulgacarga.com.br)'
        }
      });
      
      if (!response.ok) return null;
      
      const data = await response.json();
      if (data && data.address) {
        const address = data.address;
        const cidade = address.city || address.town || address.village || address.municipality || '';
        const estado = address.state || '';
        const estadoUF = address.state_code || '';
        
        return {
          cidade: cidade,
          estado: estado,
          estadoUF: estadoUF,
          displayName: data.display_name || ''
        };
      }
      return null;
    } catch (err) {
      console.warn('Erro ao fazer reverse geocoding:', err);
      return null;
    }
  }

  // Função para processar informações detalhadas da rota do OSRM
  async function processarInformacoesRotaOSRM(osrmData, pontosRoteiro, coordenadasPontos) {
    const informacoes = {
      rodovias: [],
      cidadesPassagem: [],
      instrucoes: [],
      pontosIntercalados: [],
      pedagios: []
    };
    
    // Se não houver dados do OSRM, ainda processar os pontos do roteiro
    const temOSRM = osrmData && osrmData.routes && osrmData.routes[0] && osrmData.routes[0].legs;
    
    if (!temOSRM) {
      // Processar apenas os pontos do roteiro sem dados do OSRM
      if (pontosRoteiro && pontosRoteiro.length > 0) {
        pontosRoteiro.forEach((ponto, index) => {
          let tipoLocal = '';
          if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
            tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
          }
          const isPrimeiro = index === 0;
          const isUltimo = index === pontosRoteiro.length - 1;
          if (isPrimeiro) tipoLocal = 'O';
          else if (isUltimo) tipoLocal = 'D';
          else if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal) tipoLocal = 'P';
          
          // Calcular distância acumulada
          let distanciaAcumulada = 0;
          for (let i = 1; i <= index; i++) {
            if (pontosRoteiro[i].KMENTREPONTOS) {
              distanciaAcumulada += parseFloat(pontosRoteiro[i].KMENTREPONTOS) || 0;
            }
          }
          
          informacoes.pontosIntercalados.push({
            tipo: 'ponto',
            subtipo: tipoLocal,
            ordem: (index + 1) * 10,
            local: ponto.DSLOCAL || 'N/A',
            posicao: ponto.DSPOSICAO || null,
            distanciaAnterior: ponto.KMENTREPONTOS ? parseFloat(ponto.KMENTREPONTOS).toFixed(2) + ' km' : null,
            distanciaAcumulada: parseFloat(distanciaAcumulada.toFixed(2)),
            coordenadas: `${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}`,
            lat: parseFloat(ponto.LATITUDE),
            lon: parseFloat(ponto.LONGITUDE)
          });
        });
      }
      return informacoes;
    }
    
    const route = osrmData.routes[0];
    const legs = route.legs || [];
    const rodoviasUnicas = new Set();
    const instrucoesDetalhadas = [];
    
    // Processar cada leg (trecho entre dois pontos)
    legs.forEach((leg, legIndex) => {
      const steps = leg.steps || [];
      
      steps.forEach((step, stepIndex) => {
        // Extrair nome da estrada/rodovia
        const nomeEstrada = step.name || step.ref || step.road || '';
        if (nomeEstrada && nomeEstrada.trim() !== '') {
          // Verificar se é uma rodovia (BR-xxx, rodovia, etc.)
          const isRodovia = /^(BR|Rod\.|Rodovia|Estrada|Av\.|Avenida)/i.test(nomeEstrada) || 
                           /BR-\d+/i.test(nomeEstrada);
          if (isRodovia) {
            rodoviasUnicas.add(nomeEstrada);
          }
        }
        
        // Extrair instrução de navegação (rotograma)
        if (step.maneuver) {
          const distancia = step.distance ? (step.distance / 1000).toFixed(2) + ' km' : '';
          let instrucao = step.maneuver.instruction || '';
          
          // Se não tiver instrução, criar uma baseada no tipo de manobra
          if (!instrucao && step.maneuver.type) {
            const tiposManobra = {
              'turn': 'Vire',
              'new name': 'Continue',
              'depart': 'Saia',
              'arrive': 'Chegou',
              'merge': 'Entre',
              'ramp': 'Entre na rampa',
              'fork': 'Mantenha-se',
              'end of road': 'Fim da estrada',
              'continue': 'Continue',
              'roundabout': 'Entre na rotatória',
              'roundabout turn': 'Vire na rotatória',
              'notification': 'Atenção',
              'exit roundabout': 'Saia da rotatória',
              'exit rotary': 'Saia da rotatória'
            };
            
            const tipo = tiposManobra[step.maneuver.type] || step.maneuver.type;
            const modo = step.maneuver.modifier || '';
            
            if (modo) {
              const modos = {
                'left': 'à esquerda',
                'right': 'à direita',
                'slight left': 'ligeiramente à esquerda',
                'slight right': 'ligeiramente à direita',
                'sharp left': 'fortemente à esquerda',
                'sharp right': 'fortemente à direita',
                'straight': 'em frente',
                'uturn': 'faça retorno'
              };
              instrucao = `${tipo} ${modos[modo] || modo}`;
            } else {
              instrucao = tipo;
            }
            
            // Adicionar informação da estrada se disponível
            if (nomeEstrada) {
              instrucao += ` em direção à ${nomeEstrada}`;
            }
          }
          
          if (instrucao) {
            instrucoesDetalhadas.push({
              instrucao: instrucao,
              estrada: nomeEstrada || '',
              distancia: distancia,
              tipo: step.maneuver.type || '',
              modo: step.maneuver.modifier || '',
              legIndex: legIndex,
              stepIndex: stepIndex,
              coordenadas: step.maneuver.location ? [step.maneuver.location[1], step.maneuver.location[0]] : null
            });
          }
        }
      });
    });
    
    informacoes.rodovias = Array.from(rodoviasUnicas);
    informacoes.instrucoes = instrucoesDetalhadas;
    
    // OTIMIZADO: Usar APENAS pontos do roteiro - sem geocodificação reversa para melhor performance
    const cidadesEncontradas = new Map(); // Usar Map para evitar duplicatas
    
    // Adicionar cidades dos pontos do roteiro (já temos essas informações - muito mais rápido!)
    if (pontosRoteiro && pontosRoteiro.length > 0) {
      pontosRoteiro.forEach((ponto, index) => {
        // Tentar extrair cidade e estado do DSLOCAL ou DSPOSICAO
        let local = ponto.DSLOCAL || '';
        let posicao = ponto.DSPOSICAO || '';
        
        // Se DSLOCAL contém "Origem" ou "Destino" genérico, usar DSPOSICAO
        if ((local.toLowerCase().includes('origem') || local.toLowerCase().includes('destino')) && posicao) {
          local = posicao;
        }
        
        if (local) {
          // Tentar extrair cidade e estado do local (formato comum: "Cidade, Estado" ou "Cidade/UF")
          const localTrim = local.trim();
          let cidade = localTrim;
          let estado = '';
          let estadoUF = '';
          
          // Tentar extrair estado se estiver no formato "Cidade, Estado" ou "Cidade/UF"
          const matchComma = localTrim.match(/^(.+?),\s*(.+)$/);
          const matchSlash = localTrim.match(/^(.+?)\/([A-Z]{2})$/);
          
          if (matchSlash) {
            cidade = matchSlash[1].trim();
            estadoUF = matchSlash[2].trim();
          } else if (matchComma) {
            cidade = matchComma[1].trim();
            const estadoCompleto = matchComma[2].trim();
            // Tentar extrair UF se estiver no formato "Estado (UF)" ou apenas "UF"
            const matchUF = estadoCompleto.match(/\b([A-Z]{2})\b/);
            if (matchUF) {
              estadoUF = matchUF[1];
            } else {
              estado = estadoCompleto;
            }
          } else {
            // Tentar extrair UF do final do texto
            const matchUF = localTrim.match(/\b([A-Z]{2})\b/);
            if (matchUF) {
              estadoUF = matchUF[1];
              cidade = localTrim.replace(/\b([A-Z]{2})\b/, '').trim();
            }
          }
          
          // Limpar cidade (remover palavras genéricas e descrições)
          cidade = cidade
            .replace(/^(Origem|Destino|Passagem|Rodovia|Integra|Filial|Matriz)[\s,/-]*/i, '')
            .replace(/[\s,/-]+(Integra|Filial|Matriz).*$/i, '')
            .replace(/[\s,/-]+(PR|SC|RS|SP|RJ|MG|ES|BA|GO|MT|MS|DF).*$/i, '')
            .trim();
          
          // Se ainda não tem cidade válida ou contém palavras genéricas, pular
          if (!cidade || 
              cidade.toLowerCase() === 'origem' || 
              cidade.toLowerCase() === 'destino' || 
              cidade.toLowerCase() === 'passagem' ||
              cidade.toLowerCase().includes('rodovia') ||
              cidade.toLowerCase().includes('integra') ||
              cidade.toLowerCase().includes('filial') ||
              cidade.toLowerCase().includes('matriz')) {
            return;
          }
          
          // Calcular distância acumulada
          let distanciaAcumulada = 0;
          for (let i = 1; i <= index; i++) {
            if (pontosRoteiro[i].KMENTREPONTOS) {
              distanciaAcumulada += parseFloat(pontosRoteiro[i].KMENTREPONTOS) || 0;
            }
          }
          
          const chave = `${cidade}-${estadoUF || estado}`;
          if (!cidadesEncontradas.has(chave)) {
            cidadesEncontradas.set(chave, {
              cidade: cidade,
              estado: estado,
              estadoUF: estadoUF,
              lat: parseFloat(ponto.LATITUDE),
              lon: parseFloat(ponto.LONGITUDE),
              kmAproximado: distanciaAcumulada,
              rodovias: [] // Será preenchido depois com rodovias próximas
            });
          }
        }
      });
    }
    
    // REMOVIDO: Geocodificação reversa - muito lenta! Usar apenas pontos do roteiro
    
    // Processar cada leg para associar rodovias às cidades dos pontos do roteiro (MUITO MAIS RÁPIDO!)
    const rodoviasPorIntervalo = []; // Array de {lat, lon, rodovia, distancia, legIndex}
    
    if (temOSRM) {
      legs.forEach((leg, legIndex) => {
        const steps = leg.steps || [];
        let distanciaAcumulada = 0;
        
        steps.forEach((step, stepIndex) => {
          const nomeEstrada = step.name || step.ref || step.road || '';
          const isRodovia = nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada));
          
          if (isRodovia) {
            // Usar coordenada do step para associar à cidade mais próxima
            let lat = null, lon = null;
            if (step.maneuver && step.maneuver.location) {
              [lon, lat] = step.maneuver.location;
            } else if (step.geometry && step.geometry.coordinates && step.geometry.coordinates.length > 0) {
              [lon, lat] = step.geometry.coordinates[0];
            }
            
            if (lat && lon) {
              rodoviasPorIntervalo.push({ 
                lat, 
                lon, 
                rodovia: nomeEstrada, 
                distancia: distanciaAcumulada,
                legIndex: legIndex
              });
            }
          }
          
          distanciaAcumulada += (step.distance || 0) / 1000;
        });
      });
    }
    
    // Associar rodovias às cidades dos pontos do roteiro (rápido - sem API externa!)
    if (pontosRoteiro && pontosRoteiro.length > 0 && rodoviasPorIntervalo.length > 0) {
      cidadesEncontradas.forEach((cidadeObj, chave) => {
        // Procurar rodovia mais próxima desta cidade (dentro de 10km)
        let menorDistancia = Infinity;
        let rodoviasMaisProximas = [];
        
        for (const rodoviaInfo of rodoviasPorIntervalo) {
          const distLat = Math.abs(rodoviaInfo.lat - cidadeObj.lat);
          const distLon = Math.abs(rodoviaInfo.lon - cidadeObj.lon);
          const distancia = Math.sqrt(distLat * distLat + distLon * distLon);
          
          // Aumentar raio para 0.1 graus (~10km) para pegar mais rodovias
          if (distancia < 0.1 && distancia < menorDistancia) {
            menorDistancia = distancia;
            rodoviasMaisProximas = [rodoviaInfo.rodovia];
          } else if (distancia < 0.1 && distancia === menorDistancia) {
            if (!rodoviasMaisProximas.includes(rodoviaInfo.rodovia)) {
              rodoviasMaisProximas.push(rodoviaInfo.rodovia);
            }
          }
        }
        
        if (rodoviasMaisProximas.length > 0) {
          cidadeObj.rodovias = Array.from(new Set(rodoviasMaisProximas)); // Remover duplicatas
        }
      });
    }
    
    informacoes.cidadesPassagem = Array.from(cidadesEncontradas.values())
      .sort((a, b) => a.kmAproximado - b.kmAproximado); // Ordenar por distância
    
    // Intercalar pontos do roteiro com rodovias e informações da rota
    const pontosIntercalados = [];
    
    if (pontosRoteiro && pontosRoteiro.length > 0) {
      // Calcular distâncias acumuladas usando OSRM legs se disponível
      let distanciaAcumuladaOSRM = 0;
      const distanciasAcumuladas = [0]; // Primeiro ponto sempre tem distância 0
      
      if (legs && legs.length > 0) {
        // Calcular distâncias acumuladas usando os legs do OSRM
        legs.forEach((leg, legIndex) => {
          if (leg.distance) {
            distanciaAcumuladaOSRM += leg.distance / 1000; // Converter de metros para km
            distanciasAcumuladas.push(distanciaAcumuladaOSRM);
          } else {
            // Se não tiver distância no leg, usar KMENTREPONTOS se disponível
            const pontoIndex = legIndex + 1;
            if (pontoIndex < pontosRoteiro.length && pontosRoteiro[pontoIndex].KMENTREPONTOS) {
              distanciaAcumuladaOSRM += parseFloat(pontosRoteiro[pontoIndex].KMENTREPONTOS) || 0;
              distanciasAcumuladas.push(distanciaAcumuladaOSRM);
            } else {
              distanciasAcumuladas.push(distanciaAcumuladaOSRM);
            }
          }
        });
      } else {
        // Fallback: usar KMENTREPONTOS do banco de dados
        let distanciaAcumulada = 0;
        for (let i = 1; i < pontosRoteiro.length; i++) {
          const distanciaEntrePontos = pontosRoteiro[i].KMENTREPONTOS ? parseFloat(pontosRoteiro[i].KMENTREPONTOS) : 0;
          distanciaAcumulada += distanciaEntrePontos;
          distanciasAcumuladas.push(distanciaAcumulada);
        }
      }
      
      pontosRoteiro.forEach((ponto, index) => {
        let tipoLocal = '';
        if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
          tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
        }
        const isPrimeiro = index === 0;
        const isUltimo = index === pontosRoteiro.length - 1;
        if (isPrimeiro) tipoLocal = 'O';
        else if (isUltimo) tipoLocal = 'D';
        else if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal) tipoLocal = 'P';
        
        // Extrair cidade real do DSLOCAL ou DSPOSICAO
        let localNome = ponto.DSLOCAL || 'N/A';
        let localPosicao = ponto.DSPOSICAO || '';
        
        // Se DSLOCAL contém "Origem" ou "Destino" genérico, tentar extrair de DSPOSICAO
        if ((localNome.toLowerCase().includes('origem') || localNome.toLowerCase().includes('destino')) && localPosicao) {
          // Tentar extrair cidade de DSPOSICAO (formato comum: "Cidade, Estado" ou "Cidade/UF")
          const matchComma = localPosicao.match(/^(.+?),\s*(.+)$/);
          const matchSlash = localPosicao.match(/^(.+?)\/([A-Z]{2})$/);
          
          if (matchSlash) {
            localNome = matchSlash[1].trim();
          } else if (matchComma) {
            localNome = matchComma[1].trim();
          } else {
            // Tentar extrair cidade do início de DSPOSICAO
            const partes = localPosicao.split(/[,\/]/);
            if (partes.length > 0 && partes[0].trim()) {
              localNome = partes[0].trim();
            }
          }
        } else if (localNome) {
          // Tentar limpar DSLOCAL (remover "Origem", "Destino", "Passagem" genéricos)
          localNome = localNome.replace(/^(Origem|Destino|Passagem)[\s,/-]*/i, '').trim() || localNome;
          
          // Se ainda contém "Origem" ou "Destino", tentar usar DSPOSICAO
          if ((localNome.toLowerCase().includes('origem') || localNome.toLowerCase().includes('destino')) && localPosicao) {
            const matchComma = localPosicao.match(/^(.+?),\s*(.+)$/);
            const matchSlash = localPosicao.match(/^(.+?)\/([A-Z]{2})$/);
            
            if (matchSlash) {
              localNome = matchSlash[1].trim();
            } else if (matchComma) {
              localNome = matchComma[1].trim();
            }
          }
        }
        
        // Usar distância acumulada calculada
        const distanciaAcumulada = distanciasAcumuladas[index] || 0;
        
        // Adicionar ponto do roteiro
        pontosIntercalados.push({
          tipo: 'ponto',
          subtipo: tipoLocal,
          ordem: (index + 1) * 10, // Multiplicar por 10 para ter espaço para intercalar
          local: localNome,
          posicao: localPosicao,
          distanciaAnterior: ponto.KMENTREPONTOS ? parseFloat(ponto.KMENTREPONTOS).toFixed(2) + ' km' : null,
          distanciaAcumulada: parseFloat(distanciaAcumulada.toFixed(2)),
          coordenadas: `${parseFloat(ponto.LATITUDE).toFixed(6)}, ${parseFloat(ponto.LONGITUDE).toFixed(6)}`,
          lat: parseFloat(ponto.LATITUDE),
          lon: parseFloat(ponto.LONGITUDE)
        });
        
        // Se não for o último ponto, adicionar rodovias e informações do trecho
        if (!isUltimo && legs[index]) {
          const leg = legs[index];
          const steps = leg.steps || [];
          const rodoviasTrecho = new Set();
          
          // Coletar rodovias deste trecho
          steps.forEach(step => {
            const nomeEstrada = step.name || step.ref || step.road || '';
            if (nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada))) {
              rodoviasTrecho.add(nomeEstrada);
            }
          });
          
          // Adicionar rodovias do trecho após o ponto
          let ordemRodovia = (index + 1) * 10 + 1;
          rodoviasTrecho.forEach(rodovia => {
            pontosIntercalados.push({
              tipo: 'rodovia',
              nome: rodovia,
              ordem: ordemRodovia++,
              legIndex: index
            });
          });
        } else if (!isUltimo && legs.length > index) {
          // Tentar usar o leg correspondente se disponível
          const leg = legs[index];
          if (leg && leg.steps) {
            const steps = leg.steps || [];
            const rodoviasTrecho = new Set();
            
            steps.forEach(step => {
              const nomeEstrada = step.name || step.ref || step.road || '';
              if (nomeEstrada && (/^(BR|Rod\.|Rodovia)/i.test(nomeEstrada) || /BR-\d+/i.test(nomeEstrada))) {
                rodoviasTrecho.add(nomeEstrada);
              }
            });
            
            let ordemRodovia = (index + 1) * 10 + 1;
            rodoviasTrecho.forEach(rodovia => {
              pontosIntercalados.push({
                tipo: 'rodovia',
                nome: rodovia,
                ordem: ordemRodovia++,
                legIndex: index
              });
            });
          }
        }
      });
    }
    
    // Intercalar cidades de passagem na lista de pontos intercalados
    if (informacoes.cidadesPassagem && informacoes.cidadesPassagem.length > 0 && pontosIntercalados.length > 0) {
      informacoes.cidadesPassagem.forEach((cidade, idx) => {
        // Calcular ordem aproximada baseada na distância
        // Encontrar o ponto mais próximo para intercalar
        let ordemAproximada = 0;
        let menorDistancia = Infinity;
        let pontoMaisProximo = null;
        
        pontosIntercalados.forEach(ponto => {
          if (ponto.tipo === 'ponto' && ponto.lat && ponto.lon) {
            // Calcular distância aproximada usando fórmula de Haversine simplificada
            const latDiff = Math.abs(ponto.lat - cidade.lat);
            const lonDiff = Math.abs(ponto.lon - cidade.lon);
            const distancia = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
            
            if (distancia < menorDistancia) {
              menorDistancia = distancia;
              ordemAproximada = ponto.ordem + 0.25; // Inserir antes do ponto mais próximo
              pontoMaisProximo = ponto;
            }
          }
        });
        
        // Se não encontrou ponto próximo, usar ordem baseada na distância km
        if (ordemAproximada === 0 && cidade.kmAproximado) {
          // Estimar ordem baseada na distância (assumindo que pontos estão espaçados)
          // Calcular distância total a partir dos pontos intercalados ou usar route se disponível
          let totalDistancia = 0;
          if (route && route.distance) {
            totalDistancia = route.distance / 1000; // em km
          } else if (pontosIntercalados.length > 0) {
            // Usar a maior distância acumulada dos pontos
            const ultimoPonto = pontosIntercalados[pontosIntercalados.length - 1];
            totalDistancia = ultimoPonto.distanciaAcumulada || cidade.kmAproximado;
          }
          
          if (totalDistancia > 0) {
            const proporcao = cidade.kmAproximado / totalDistancia;
            ordemAproximada = proporcao * (pontosIntercalados.length * 10) + 0.2;
          } else {
            ordemAproximada = (idx + 1) * 5;
          }
        }
        
        pontosIntercalados.push({
          tipo: 'cidade',
          nome: cidade.cidade,
          estado: cidade.estado || cidade.estadoUF || '',
          ordem: ordemAproximada || (idx + 1) * 5,
          kmAproximado: cidade.kmAproximado,
          rodovias: cidade.rodovias || []
        });
      });
    }
    
    // Ordenar por ordem
    pontosIntercalados.sort((a, b) => a.ordem - b.ordem);
    
    informacoes.pontosIntercalados = pontosIntercalados;
    
    return informacoes;
  }

  // Função renderizarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida

  // Função copiarInformacoesRota removida - seção "Informações da Rota para o Motorista" foi removida
  
  // REMOVIDO: Código antigo desnecessário foi removido completamente
  
  // Variáveis globais para a aba Compatíveis

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
    // Ativar acompanhamento WebSocket para esta viagem
    if (typeof window.WebSocketTorre !== 'undefined' && idViagem) {
      window.WebSocketTorre.acompanharViagem(idViagem);
    }
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
    // Obter referência do container uma única vez
    const gridContainer = document.getElementById('motoristasCompatíveisGrid');
    
    // Mostrar skeleton loader durante busca
    if (gridContainer && typeof window.showSkeleton === 'function') {
      window.showSkeleton(gridContainer, 5, 'list');
    }
    
    let idViagem = idViagemParam;
    
    // Se não foi passado como parâmetro, pegar do select
    if (!idViagem) {
      const select = document.getElementById('selectViagemPendente');
      idViagem = select ? select.value : null;
    }
    
    if (!idViagem) {
      // Esconder skeleton se houver erro
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
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
      
      // Esconder skeleton antes de renderizar
      if (gridContainer && typeof window.hideSkeleton === 'function') {
        window.hideSkeleton(gridContainer);
      }
      
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
          </tr>
        </thead>
        <tbody>
    `;

    motoristasCompatíveis.forEach((motorista, index) => {
      const isChecked = motorista.selecionado || false;
      
      // Formatar celular do motorista para WhatsApp (remover caracteres não numéricos)
      const celularFormatado = motorista.CELULAR ? motorista.CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppMotorista = celularFormatado.length >= 10; // Celular válido tem pelo menos 10 dígitos
      const linkWhatsAppMotorista = temWhatsAppMotorista ? `https://wa.me/55${celularFormatado}` : '#';
      
      // Formatar celular do motorista para exibição (com parênteses e hífen)
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
      
      // Formatar celular do transportador para WhatsApp
      const celularTransportadorFormatado = motorista.TRANSPORTADOR_CELULAR ? motorista.TRANSPORTADOR_CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppTransportador = celularTransportadorFormatado.length >= 10;
      const linkWhatsAppTransportador = temWhatsAppTransportador ? `https://wa.me/55${celularTransportadorFormatado}` : '#';
      
      // Formatar celular do transportador para exibição
      let celularTransportadorExibicao = '';
      if (celularTransportadorFormatado && celularTransportadorFormatado.length >= 10) {
        if (celularTransportadorFormatado.length === 11) {
          celularTransportadorExibicao = `(${celularTransportadorFormatado.substring(0, 2)}) ${celularTransportadorFormatado.substring(2, 7)}-${celularTransportadorFormatado.substring(7)}`;
        } else if (celularTransportadorFormatado.length === 10) {
          celularTransportadorExibicao = `(${celularTransportadorFormatado.substring(0, 2)}) ${celularTransportadorFormatado.substring(2, 6)}-${celularTransportadorFormatado.substring(6)}`;
        } else {
          celularTransportadorExibicao = celularTransportadorFormatado;
        }
      }
      
      // Formatar celular do contratador para WhatsApp
      const celularContratadorFormatado = motorista.CONTRATADOR_CELULAR ? motorista.CONTRATADOR_CELULAR.toString().replace(/\D/g, '') : '';
      const temWhatsAppContratador = celularContratadorFormatado.length >= 10;
      const linkWhatsAppContratador = temWhatsAppContratador ? `https://wa.me/55${celularContratadorFormatado}` : '#';
      
      // Formatar celular do contratador para exibição
      let celularContratadorExibicao = '';
      if (celularContratadorFormatado && celularContratadorFormatado.length >= 10) {
        if (celularContratadorFormatado.length === 11) {
          celularContratadorExibicao = `(${celularContratadorFormatado.substring(0, 2)}) ${celularContratadorFormatado.substring(2, 7)}-${celularContratadorFormatado.substring(7)}`;
        } else if (celularContratadorFormatado.length === 10) {
          celularContratadorExibicao = `(${celularContratadorFormatado.substring(0, 2)}) ${celularContratadorFormatado.substring(2, 6)}-${celularContratadorFormatado.substring(6)}`;
        } else {
          celularContratadorExibicao = celularContratadorFormatado;
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
                <small style="color: #666;">Código: ${motorista.CDCADASTRO_MOTORISTA}${celularExibicao ? '  |  ' : ''}</small>
                ${celularExibicao ? `
                  <small style="color: #666;">
                    ${temWhatsAppMotorista ? `<a href="${linkWhatsAppMotorista}" target="_blank" style="color: #25D366; text-decoration: none;" title="Abrir WhatsApp">📱 ${celularExibicao}</a>` : celularExibicao}
                  </small>
                ` : ''}
              </div>
            </div>
          </td>
          <td style="padding: 12px;">
            ${motorista.CIDADE_NOME || 'N/A'}, ${motorista.CIDADE_ESTADO || 'N/A'}<br>
            <small style="color: #666;">Micro-região: ${motorista.CDMICROREGIAO || 'N/A'}</small>
          </td>
          <td style="padding: 12px;">
            ${motorista.TRANSPORTADOR_NOME || 'N/A'}<br>
            <small style="color: #666;">
              ${motorista.CDTRANSPORTADOR ? 'Código: ' + motorista.CDTRANSPORTADOR : ''}
              ${celularTransportadorExibicao ? `
                ${motorista.CDTRANSPORTADOR ? ' | ' : ''}
                ${temWhatsAppTransportador ? `<a href="${linkWhatsAppTransportador}" target="_blank" style="color: #25D366; text-decoration: none;" title="Abrir WhatsApp do transportador">📱 ${celularTransportadorExibicao}</a>` : `📱 ${celularTransportadorExibicao}`}
              ` : ''}
            </small>
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
      
      // Log de acionamento e convocações criadas
      if (window.logAcionamento) {
        window.logAcionamento(viagemSelecionada, selecionados.length, {
          motoristasSelecionados: selecionados.map(m => ({
            id: m.CDCADASTRO_MOTORISTA,
            nome: m.NOME_MOTORISTA
          }))
        });
      }
      
      // Log de cada convocação criada
      todasConvocacoes.forEach(conv => {
        if (window.logConvocacao) {
          const tipo = conv.REUTILIZADA ? 'Reutilização' : 'Criação';
          window.logConvocacao(viagemSelecionada, conv.IDCONVOCACAO, conv.CDCADASTRO_MOTORISTA, tipo, {
            reutilizada: conv.REUTILIZADA || false
          });
        }
      });
      
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
      
      // Log de envio WhatsApp manual
      if (window.logWhatsAppManual && linksWhatsApp.length > 0) {
        window.logWhatsAppManual(viagemSelecionada, linksWhatsApp.length, {
          motoristasComLink: linksWhatsApp.map(l => ({
            nome: l.motorista,
            celular: l.celular,
            idConvocacao: l.idConvocacao
          })),
          semCelular: semCelular,
          semConvocacao: semConvocacao
        });
      }
      
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
      
      // Log de acionamento e convocações criadas (disparo automático)
      if (window.logAcionamento) {
        window.logAcionamento(viagemSelecionada, selecionados.length, {
          tipo: 'Disparo Automático',
          motoristasSelecionados: selecionados.map(m => ({
            id: m.CDCADASTRO_MOTORISTA,
            nome: m.NOME_MOTORISTA
          }))
        });
      }
      
      // Log de cada convocação criada
      todasConvocacoes.forEach(conv => {
        if (window.logConvocacao) {
          const tipo = conv.REUTILIZADA ? 'Reutilização' : 'Criação';
          window.logConvocacao(viagemSelecionada, conv.IDCONVOCACAO, conv.CDCADASTRO_MOTORISTA, tipo, {
            reutilizada: conv.REUTILIZADA || false,
            tipoDisparo: 'automático'
          });
        }
      });
      
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
        
        // Log de envio WhatsApp automático
        if (window.logWhatsAppAutomatico && sucessos > 0) {
          window.logWhatsAppAutomatico(viagemSelecionada, sucessos, {
            totalAtualizacoes: atualizacoesPromises.length,
            sucessos: sucessos,
            erros: erros,
            convocoesEnviadasWebhook: convocacoesParaEnviar.length
          });
        }
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
    
    // Verificar se há viagem selecionada
    const idViagem = document.getElementById('filtroIdViagem')?.value || 
                     document.getElementById('viagemId')?.value || 
                     null;
    
    if (!idViagem || idViagem.trim() === '') {
      // Não há viagem selecionada - mostrar mensagem
      container.innerHTML = `
        <div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
          <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
          <h3 style="color: #856404; margin-bottom: 10px;">Nenhuma viagem selecionada</h3>
          <p style="color: #856404; margin: 0;">
            Selecione uma viagem na aba <strong>Dados</strong> ou <strong>Grid</strong> para visualizar os logs de integração Meta.
          </p>
        </div>
      `;
      // Limpar contadores
      const totalEnviosEl = document.getElementById('totalEnviosMeta');
      const totalSucessosEl = document.getElementById('totalSucessosMeta');
      const totalErrosEl = document.getElementById('totalErrosMeta');
      const ultimaAtualizacaoEl = document.getElementById('ultimaAtualizacaoMeta');
      if (totalEnviosEl) totalEnviosEl.textContent = '0';
      if (totalSucessosEl) totalSucessosEl.textContent = '0';
      if (totalErrosEl) totalErrosEl.textContent = '0';
      if (ultimaAtualizacaoEl) ultimaAtualizacaoEl.textContent = '-';
      return;
    }
    
    if (logsIntegracaoMeta.length === 0) {
      container.innerHTML = `
        <div style="color: #6c757d; text-align: center; padding: 40px;">
          Nenhum log disponível para esta viagem. Os logs aparecerão aqui quando houver envios para o webhook Meta.
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
      
      // Verificar se há viagem selecionada
      if (!idViagem || idViagem.trim() === '') {
        // Não há viagem selecionada - mostrar mensagem
        const container = document.getElementById('logsIntegracaoMeta');
        if (container) {
          container.innerHTML = `
            <div style="color: #856404; text-align: center; padding: 40px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 8px;">
              <div style="font-size: 48px; margin-bottom: 15px;">⚠️</div>
              <h3 style="color: #856404; margin-bottom: 10px;">Nenhuma viagem selecionada</h3>
              <p style="color: #856404; margin: 0;">
                Selecione uma viagem na aba <strong>Dados</strong> ou <strong>Grid</strong> para visualizar os logs de integração Meta.
              </p>
            </div>
          `;
        }
        // Limpar contadores
        const totalEnviosEl = document.getElementById('totalEnviosMeta');
        const totalSucessosEl = document.getElementById('totalSucessosMeta');
        const totalErrosEl = document.getElementById('totalErrosMeta');
        const ultimaAtualizacaoEl = document.getElementById('ultimaAtualizacaoMeta');
        if (totalEnviosEl) totalEnviosEl.textContent = '0';
        if (totalSucessosEl) totalSucessosEl.textContent = '0';
        if (totalErrosEl) totalErrosEl.textContent = '0';
        if (ultimaAtualizacaoEl) ultimaAtualizacaoEl.textContent = '-';
        // Limpar array de logs
        logsIntegracaoMeta = [];
        return;
      }
      
      // Montar URL com filtro de viagem (obrigatório)
      const url = `/api/logs-webhook-meta?limite=100&idViagem=${encodeURIComponent(idViagem.trim())}`;
      
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
    
    // Adicionar listeners para recarregar logs quando uma viagem for selecionada
    const filtroIdViagem = document.getElementById('filtroIdViagem');
    const viagemId = document.getElementById('viagemId');
    
    const recarregarLogsSeAbaAtiva = () => {
      const tabIntegracaoMeta = document.getElementById('tab-integracao-meta');
      if (tabIntegracaoMeta && tabIntegracaoMeta.classList.contains('active')) {
        if (typeof window.carregarLogsMeta === 'function') {
          window.carregarLogsMeta();
        }
      }
    };
    
    if (filtroIdViagem) {
      filtroIdViagem.addEventListener('change', recarregarLogsSeAbaAtiva);
      filtroIdViagem.addEventListener('input', recarregarLogsSeAbaAtiva);
    }
    
    if (viagemId) {
      viagemId.addEventListener('change', recarregarLogsSeAbaAtiva);
      viagemId.addEventListener('input', recarregarLogsSeAbaAtiva);
    }
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
        // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
        const linkConvocacao = conv.LINKCONVOCACAO && conv.LINKCONVOCACAO.trim() !== '' 
          ? conv.LINKCONVOCACAO 
          : `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
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

      // Log de links WhatsApp manual (geração de links)
      if (window.logWhatsAppManual && linksWhatsApp.length > 0) {
        const viagensUnicas = [...new Set(convocacoes.map(c => c.IDVIAGEM))];
        viagensUnicas.forEach(idViagem => {
          const linksDaViagem = linksWhatsApp.filter(l => {
            const conv = convocacoes.find(c => c.IDCONVOCACAO === l.idConvocacao);
            return conv && conv.IDVIAGEM === idViagem;
          });
          if (linksDaViagem.length > 0) {
            window.logWhatsAppManual(idViagem, linksDaViagem.length, {
              tipo: 'Geração de Links',
              motoristasComLink: linksDaViagem.map(l => ({
                nome: l.motorista,
                celular: l.celular,
                idConvocacao: l.idConvocacao
              })),
              semCelular: semCelular,
              semConvocacao: semConvocacao
            });
          }
        });
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
      
      // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
      const linkConvocacao = conv.LINKCONVOCACAO && conv.LINKCONVOCACAO.trim() !== '' 
        ? conv.LINKCONVOCACAO 
        : `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
      
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
      
      // Formatar celular do motorista para WhatsApp e exibição
      const celularFormatado = conv.CELULAR_MOTORISTA ? String(conv.CELULAR_MOTORISTA).replace(/\D/g, '') : '';
      const temWhatsAppMotorista = celularFormatado.length >= 10;
      const linkWhatsAppMotorista = temWhatsAppMotorista ? `https://wa.me/55${celularFormatado}` : '#';
      
      // Formatar celular para exibição (com parênteses e hífen)
      let celularExibicao = '';
      if (celularFormatado && celularFormatado.length >= 10) {
        if (celularFormatado.length === 11) {
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 7)}-${celularFormatado.substring(7)}`;
        } else if (celularFormatado.length === 10) {
          celularExibicao = `(${celularFormatado.substring(0, 2)}) ${celularFormatado.substring(2, 6)}-${celularFormatado.substring(6)}`;
        } else {
          celularExibicao = celularFormatado;
        }
      }
      
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
            <small style="color: #666;">
              ${conv.CDCADASTRO_MOTORISTA ? `Código: ${conv.CDCADASTRO_MOTORISTA}` : ''}
              ${conv.CDCADASTRO_MOTORISTA && celularExibicao ? ' | ' : ''}
              ${celularExibicao ? (temWhatsAppMotorista ? `<a href="${linkWhatsAppMotorista}" target="_blank" style="color: #25D366; text-decoration: none;" title="Abrir WhatsApp do motorista">📱 ${celularExibicao}</a>` : `📱 ${celularExibicao}`) : ''}
            </small>
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

      // Log de confirmação
      if (window.logConfirmacao && result) {
        window.logConfirmacao(
          convocacao.IDVIAGEM,
          idConvocacao,
          convocacao.CDCADASTRO_MOTORISTA,
          {
            nomeMotorista: convocacao.NOME_MOTORISTA,
            outrasAceitas: outrasAceitas,
            whatsappLink: result.whatsappLink ? 'Sim' : 'Não'
          }
        );
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
      titulo.innerHTML = '<i class=\'bx bx-user\'></i> Validades do Motorista';
    }
    if (subtitulo) {
      subtitulo.textContent = `${nomeMotorista} • Código: ${cdMotorista}`;
    }
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalValidadesMotorista h3');
      if (tituloModal && tituloModal.textContent.includes('Motorista')) {
        tituloModal.innerHTML = '<i class=\'bx bx-user\'></i> Validades do Motorista';
      }
    }, 10);
    
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
          <div class="validade-card" style="background: #fff; border: 1px solid #e9ecef; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px;">
            <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
            <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="margin-bottom: 12px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <span style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
              </div>
              <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                  <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                  <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
                </div>
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
      titulo.innerHTML = '<i class=\'bx bx-truck\'></i> Validades do Veículo';
    }
    if (subtitulo) {
      subtitulo.textContent = `${nomeVeiculo} • Código: ${idequipamento}`;
    }
    
    // Mostrar modal
    modal.style.display = 'flex';
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalValidadesMotorista h3');
      if (tituloModal && tituloModal.textContent.includes('Veículo')) {
        tituloModal.innerHTML = '<i class=\'bx bx-truck\'></i> Validades do Veículo';
      }
    }, 10);
    
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
          <div class="validade-card" style="background: #fff; border: 1px solid #e9ecef; border-left: 5px solid ${corStatus}; border-radius: 8px; padding: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 12px; overflow: hidden; display: flex; min-height: 120px;">
            <div style="width: 5px; background: ${corStatus}; flex-shrink: 0;"></div>
            <div style="flex: 1; padding: 16px 18px; display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="margin-bottom: 12px;">
                  <strong style="font-size: 16px; color: #2c3e50; display: block; margin-bottom: 8px; font-weight: 700;">${val.DSTIPOVALIDADE}</strong>
                  <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center;">
                    <span style="background: ${corStatus}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; white-space: nowrap;">
                      ${textoStatus}
                    </span>
                    <span style="color: #6c757d; font-size: 12px; font-weight: 500;">Nº <strong style="color: #2c3e50;">${val.NRLIBERACAO}</strong></span>
                    ${val.CERTIFICADORA_NOME ? `<span style="color: #6c757d; font-size: 12px;">• Certif: <strong style="color: #495057;">${val.CERTIFICADORA_NOME}</strong></span>` : ''}
                  </div>
                </div>
              </div>
              <div class="validade-card-footer" style="display: flex; gap: 24px; padding-top: 12px; border-top: 1px solid #f0f0f0; font-size: 13px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-calendar' style="color: #6c757d; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Liberação:</span>
                  <strong style="color: #2c3e50; margin-left: 4px;">${dtLib}</strong>
                </div>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <i class='bx bx-time' style="color: ${corStatus}; font-size: 14px;"></i>
                  <span style="color: #6c757d; font-weight: 500;">Validade:</span>
                  <strong style="color: ${corStatus}; margin-left: 4px;">${dtVal}</strong>
                </div>
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
      
      // Log de reativação
      if (window.logReativacao && result) {
        window.logReativacao(
          result.idViagem || convocacao.IDVIAGEM,
          idConvocacao,
          convocacao.CDCADASTRO_MOTORISTA,
          motivoReabertura,
          {
            nomeMotorista: convocacao.NOME_MOTORISTA,
            motivoDescricao: result.motivo || motivoReabertura,
            outrasConvocacoesReativadas: result.outrasReativadas || 0
          }
        );
      }
      
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
          
          // Usar o link salvo na tabela, se existir. Caso contrário, gerar novo link
          const linkConvocacao = conv.LINKCONVOCACAO && conv.LINKCONVOCACAO.trim() !== '' 
            ? conv.LINKCONVOCACAO 
            : `${urlBase}/convocacao/${conv.IDCONVOCACAO}`;
          
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
        url: window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'),
        attribution: '© OpenStreetMap',
        maxZoom: 19
      };
      
      const tileOptions = {
        attribution: tileConfig.attribution,
        maxZoom: tileConfig.maxZoom
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileConfig.url.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileConfig.url, tileOptions).addTo(mapaMotorista);

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
          const coordsStr = `${lonMotorista},${latMotorista};${origemLon},${origemLat}`;
          const osrmUrl = construirUrlRota(
            config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
            coordsStr,
            'full',
            'geojson'
          );
          const rotaResponse = await fetchForcandoHTTP(osrmUrl, { signal: AbortSignal.timeout(config.routeTimeout || 15000) });
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
  // Função auxiliar: Debounce para evitar múltiplas chamadas
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Versão com loading state
  const buscarEquipamentoPorPlacaComLoading = async () => {
    const btn = document.getElementById('btnBuscarVeiculoPorPlaca');
    const loadingText = 'Buscando...';
    const originalText = btn?.textContent || 'Buscar';
    
    if (btn) {
      btn.disabled = true;
      btn.textContent = loadingText;
    }
    
    try {
      await buscarEquipamentoPorPlaca();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  };

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
      btnVerDados.className = 'btn btn-primary btn-sm';
      btnVerDados.style.cssText = 'white-space: nowrap;';
      btnVerDados.innerHTML = '<i class=\'bx bx-show\'></i> Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosVeiculo(veiculo);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn btn-info btn-sm';
      btnValidades.style.cssText = 'white-space: nowrap;';
      btnValidades.innerHTML = '<i class=\'bx bx-file-blank\'></i> Validades';
      btnValidades.onclick = () => mostrarValidadesVeiculo(veiculo.IDEQUIPAMENTO, veiculo.REFEQUIPAMENTO || veiculo.DSEQUIPAMENTO || 'Veículo');
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn btn-secondary btn-sm';
      btnRemover.style.cssText = 'white-space: nowrap; background: #e74c3c;';
      btnRemover.innerHTML = '<i class=\'bx bx-trash\'></i> Remover';
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
    const titulo = document.querySelector('#modalDadosVeiculo h3');
    
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
      <p style="font-size: 18px; font-weight: 700; color: #2c3e50; margin: 0 0 25px 0; padding-bottom: 15px; border-bottom: 2px solid #e9ecef; text-transform: uppercase;">${nomeVeiculo}</p>

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
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalDadosVeiculo h3');
      if (tituloModal) {
        tituloModal.innerHTML = '<i class=\'bx bx-truck\'></i> Dados Completos do Veículo';
      }
    }, 10);
    
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
        btnWhatsApp.className = 'btn btn-sm';
        btnWhatsApp.style.cssText = 'background: #25D366; color: white; white-space: nowrap; text-decoration: none;';
        btnWhatsApp.innerHTML = '<i class=\'bx bxl-whatsapp\'></i> WhatsApp';
        btnWhatsApp.title = `Abrir WhatsApp de ${celular}`;
        btnContainer.appendChild(btnWhatsApp);
      }
      
      const btnVerDados = document.createElement('button');
      btnVerDados.type = 'button';
      btnVerDados.className = 'btn btn-primary btn-sm';
      btnVerDados.style.cssText = 'white-space: nowrap;';
      btnVerDados.innerHTML = '<i class=\'bx bx-show\'></i> Ver Dados';
      btnVerDados.onclick = () => mostrarDadosCompletosMotorista(motorista);
      
      const btnValidades = document.createElement('button');
      btnValidades.type = 'button';
      btnValidades.className = 'btn btn-info btn-sm';
      btnValidades.style.cssText = 'white-space: nowrap;';
      btnValidades.innerHTML = '<i class=\'bx bx-file-blank\'></i> Validades';
      const cdMotorista = motorista.CDMOTORISTA || motorista.CDCADASTROGERAL;
      const nomeMotorista = motorista.RZSOCIAL || motorista.NMFANTASIA || 'Motorista';
      btnValidades.onclick = () => mostrarValidadesMotorista(cdMotorista, nomeMotorista);
      
      const btnRemover = document.createElement('button');
      btnRemover.type = 'button';
      btnRemover.className = 'btn btn-secondary btn-sm';
      btnRemover.style.cssText = 'white-space: nowrap; background: #e74c3c;';
      btnRemover.innerHTML = '<i class=\'bx bx-trash\'></i> Remover';
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
      <p style="font-size: 18px; font-weight: 700; color: #2c3e50; margin: 0 0 25px 0; padding-bottom: 15px; border-bottom: 2px solid #e9ecef; text-transform: uppercase;">${nomeMotorista}</p>

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
    
    // Garantir que o título tenha o ícone após mostrar o modal
    setTimeout(() => {
      const tituloModal = document.querySelector('#modalDadosMotorista h3');
      if (tituloModal) {
        tituloModal.innerHTML = '<i class=\'bx bx-user\'></i> Dados Completos do Motorista';
      }
    }, 10);
    
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
      document.getElementById('btnBuscarVeiculoPorPlaca').addEventListener('click', buscarEquipamentoPorPlacaComLoading);
      
      // Adicionar busca ao pressionar Enter no campo placa
      const inputPlaca = document.getElementById('veiculoRefEquipamento');
      if (inputPlaca) {
        inputPlaca.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarEquipamentoPorPlacaComLoading();
          }
        });
      }
    }
    
    if (btnBuscarVeiculoPorCodigo) {
      btnBuscarVeiculoPorCodigo.replaceWith(btnBuscarVeiculoPorCodigo.cloneNode(true));
      document.getElementById('btnBuscarVeiculoPorCodigo').addEventListener('click', buscarEquipamentoPorCodigo);
      
      // Adicionar debounce para busca por código (permite busca ao digitar Enter)
      const inputCodigo = document.getElementById('veiculoIdEquipamento');
      if (inputCodigo) {
        // Buscar ao pressionar Enter
        inputCodigo.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarEquipamentoPorCodigo();
          }
        });
        // Buscar com debounce ao digitar (após 1.5s de inatividade)
        const buscaComDebounce = debounce(() => {
          const codigo = inputCodigo.value.trim();
          if (codigo && !isNaN(codigo) && parseFloat(codigo) > 0) {
            buscarEquipamentoPorCodigo();
          }
        }, 1500);
        inputCodigo.addEventListener('input', buscaComDebounce);
      }
    }
    
    // Botões de busca de motorista
    const btnBuscarMotoristaPorCpf = document.getElementById('btnBuscarMotoristaPorCpf');
    const btnBuscarMotoristaPorNome = document.getElementById('btnBuscarMotoristaPorNome');
    const btnBuscarMotoristaPorCodigo = document.getElementById('btnBuscarMotoristaPorCodigo');
    
    if (btnBuscarMotoristaPorCpf) {
      btnBuscarMotoristaPorCpf.replaceWith(btnBuscarMotoristaPorCpf.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorCpf').addEventListener('click', buscarMotoristaPorCpf);
      
      // Adicionar busca ao pressionar Enter no campo CPF
      const inputCpf = document.getElementById('motoristaCpf');
      if (inputCpf) {
        inputCpf.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarMotoristaPorCpf();
          }
        });
      }
    }

    if (btnBuscarMotoristaPorNome) {
      btnBuscarMotoristaPorNome.replaceWith(btnBuscarMotoristaPorNome.cloneNode(true));
      document.getElementById('btnBuscarMotoristaPorNome').addEventListener('click', buscarMotoristaPorNome);
      
      // Adicionar busca com debounce ao digitar no campo Nome
      const inputNome = document.getElementById('motoristaNome');
      if (inputNome) {
        // Buscar ao pressionar Enter
        inputNome.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            buscarMotoristaPorNome();
          }
        });
        // Buscar com debounce ao digitar (após 1s de inatividade e mínimo 3 caracteres)
        const buscaComDebounce = debounce(() => {
          const nome = inputNome.value.trim();
          if (nome.length >= 3) {
            buscarMotoristaPorNome();
          }
        }, 1000);
        inputNome.addEventListener('input', buscaComDebounce);
      }
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

  // ==========================================
  // ABA RASTREAMENTO GPS
  // ==========================================
  
  let mapaRastreamento = null;
  let mapaRastreamentoInicializando = false; // Flag para evitar múltiplas inicializações simultâneas
  let marcadoresRastreamento = [];
  let linhaRastreamento = null;
  let marcadorOrigemRastreamento = null;
  let marcadorDestinoRastreamento = null;
  let linhaRotaPlanejada = null;
  let linhaRotaRestante = null; // Rota da última posição GPS até o destino (vermelha)

  // Função auxiliar para construir URL de roteamento (suporta OSRM e ORS) - escopo global
  function construirUrlRota(servidor, coordsStr, overview = 'simplified', geometries = 'geojson') {
    // IMPORTANTE: Normalizar URL - garantir HTTP para servidor próprio
    let servidorNormalizado = servidor;
    const servidoresProprios = ['186.250.92.131', 'app.integrabrasil.com', 'beta.integrabrasil.com'];
    const isServidorProprio = servidor && servidoresProprios.some(s => servidor.includes(s));
    
    if (isServidorProprio) {
      servidorNormalizado = servidor.replace(/^https:/, 'http:');
      servidorNormalizado = servidorNormalizado.replace(/https:\/\//, 'http://');
      
      if (servidorNormalizado !== servidor) {
        console.log('🔄 [ROTA] Normalizando URL do servidor próprio:', servidor, '→', servidorNormalizado);
      }
      
      // Verificar se ainda está em HTTPS após normalização
      if (servidorNormalizado.startsWith('https:')) {
        console.error('❌ [ROTA] ERRO: Servidor ainda está em HTTPS após normalização!', servidorNormalizado);
        servidorNormalizado = 'http:' + servidorNormalizado.substring(6); // Remove 'https:' e adiciona 'http:'
      }
    }
    
    // Detectar se é ORS (OpenRouteService) ou OSRM
    let urlFinal;
    if (servidorNormalizado.includes('/ors/')) {
      // Formato ORS: /ors/v2/directions/{profile}/{coords}?overview={overview}&geometries={geometries}
      urlFinal = `${servidorNormalizado}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    } else {
      // Formato OSRM padrão: /route/v1/{profile}/{coords}?overview={overview}&geometries={geometries}
      urlFinal = `${servidorNormalizado}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    }
    
    // Log final para debug
    if (isServidorProprio && urlFinal.startsWith('https:')) {
      console.error('❌ [ROTA] ERRO: URL ainda está em HTTPS!', urlFinal);
      // Tentar corrigir uma última vez
      urlFinal = urlFinal.replace(/^https:/, 'http:');
    }
    
    return urlFinal;
  }
  
  // Função auxiliar para fazer fetch forçando HTTP (evita conversão automática do navegador)
  async function fetchForcandoHTTP(url, options = {}) {
    // Se for servidor próprio, garantir que seja HTTP
    let fetchUrl = url;
    const servidoresProprios = ['186.250.92.131', 'app.integrabrasil.com', 'beta.integrabrasil.com'];
    const isServidorProprio = servidoresProprios.some(servidor => url.includes(servidor));
    
    if (isServidorProprio) {
      // Forçar HTTP de múltiplas formas
      fetchUrl = url.replace(/^https:/, 'http:');
      fetchUrl = fetchUrl.replace(/https:\/\//, 'http://');
      
      if (fetchUrl !== url) {
        console.warn('⚠️ [FETCH] URL convertida de HTTPS para HTTP:', url.substring(0, 80), '→', fetchUrl.substring(0, 80));
      }
      
      // Verificar se ainda está em HTTPS após normalização
      if (fetchUrl.startsWith('https:')) {
        console.error('❌ [FETCH] ERRO: URL ainda está em HTTPS após normalização!', fetchUrl.substring(0, 80));
        // Tentar uma última vez com replace mais agressivo
        fetchUrl = 'http:' + fetchUrl.substring(6); // Remove 'https:' e adiciona 'http:'
      }
    }
    
    // Criar URL object para garantir protocolo correto
    try {
      const urlObj = new URL(fetchUrl);
      if (isServidorProprio && urlObj.protocol === 'https:') {
        urlObj.protocol = 'http:';
        fetchUrl = urlObj.toString();
        console.warn('⚠️ [FETCH] Protocolo corrigido via URL object:', fetchUrl.substring(0, 80));
      }
    } catch (e) {
      // Se falhar ao criar URL object, continuar com fetchUrl original
      console.warn('⚠️ [FETCH] Erro ao criar URL object:', e);
    }
    
    // CRÍTICO: Para servidores próprios, usar XMLHttpRequest DIRETAMENTE
    // porque navegadores modernos convertem fetch() automaticamente para HTTPS
    // XMLHttpRequest não tem esse problema e respeita o protocolo especificado
    if (isServidorProprio) {
      // Garantir que a URL está em HTTP (não HTTPS)
      const httpUrl = fetchUrl.replace(/^https:/, 'http:');
      if (httpUrl !== fetchUrl) {
        console.log('🔄 [FETCH] Corrigindo URL de HTTPS para HTTP:', httpUrl.substring(0, 80));
      }
      
      console.log('🔄 [FETCH] Usando XMLHttpRequest diretamente para servidor próprio:', httpUrl.substring(0, 80));
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method || 'GET', httpUrl, true);
        xhr.responseType = 'json';
        
        // Adicionar headers se necessário
        if (options.headers) {
          Object.keys(options.headers).forEach(key => {
            xhr.setRequestHeader(key, options.headers[key]);
          });
        }
        
        // Timeout
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            xhr.abort();
            reject(new Error('Aborted'));
          });
        }
        
        // Timeout padrão de 30 segundos
        xhr.timeout = 30000;
        
        xhr.onload = function() {
          if (xhr.status >= 200 && xhr.status < 300) {
            // Criar um objeto Response-like
            const response = {
              ok: true,
              status: xhr.status,
              statusText: xhr.statusText,
              json: async () => {
                try {
                  return typeof xhr.response === 'string' ? JSON.parse(xhr.response) : xhr.response;
                } catch (e) {
                  return JSON.parse(xhr.responseText);
                }
              },
              text: async () => xhr.responseText,
              headers: new Headers(),
              url: httpUrl
            };
            resolve(response);
          } else {
            reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };
        
        xhr.onerror = function() {
          reject(new Error('Network error'));
        };
        
        xhr.ontimeout = function() {
          reject(new Error('Timeout'));
        };
        
        xhr.send(options.body || null);
      });
    }
    
    // Para servidores não-próprios, usar fetch normal
    const request = new Request(fetchUrl, {
      method: options.method || 'GET',
      mode: 'cors',
      cache: options.cache || 'no-cache',
      credentials: options.credentials || 'omit',
      signal: options.signal,
      headers: options.headers || {}
    });
    
    return fetch(request);
  }
  
  // Função auxiliar para parsear resposta (suporta OSRM e ORS) - escopo global
  function parsearRespostaRota(data) {
    // ORS retorna: { routes: [{ geometry: { coordinates: [[lon, lat], ...] } }] }
    // OSRM retorna: { code: 'Ok', routes: [{ geometry: { coordinates: [[lon, lat], ...] } }] }
    if (data.routes && data.routes[0] && data.routes[0].geometry) {
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Converter [lon, lat] para [lat, lon]
    }
    // Fallback para formato OSRM com code
    if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry) {
      return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
    }
    return null;
  }

  // Função para sincronizar rastreamento do INTEGRA_PRD
  async function sincronizarRastreamentoIntegra(idViagem) {
    if (!idViagem) {
      mostrarMensagemRastreamento('ID da viagem não encontrado.', 'error');
      return;
    }

    const btnAtualizar = document.getElementById('btnAtualizarRastreamento');
    const textoOriginal = btnAtualizar ? btnAtualizar.innerHTML : '';

    try {
      // Mostrar loading no botão
      if (btnAtualizar) {
        btnAtualizar.disabled = true;
        btnAtualizar.innerHTML = '⏳ Sincronizando...';
      }

      mostrarMensagemRastreamento('Sincronizando posições do INTEGRA_PRD...', 'info');

      const response = await fetch(`/api/motorista/sincronizar-rastreamento/${idViagem}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const resultado = await response.json();

      if (response.ok && resultado.success) {
        mostrarMensagemRastreamento(
          resultado.message || 'Sincronização concluída com sucesso!',
          'success'
        );
      } else {
        mostrarMensagemRastreamento(
          resultado.error || 'Erro ao sincronizar rastreamento.',
          'error'
        );
        console.error('❌ Erro na sincronização:', resultado);
      }
    } catch (error) {
      console.error('❌ Erro ao sincronizar rastreamento:', error);
      mostrarMensagemRastreamento(
        'Erro ao sincronizar rastreamento. Verifique a conexão com o servidor.',
        'error'
      );
    } finally {
      // Restaurar botão
      if (btnAtualizar) {
        btnAtualizar.disabled = false;
        btnAtualizar.innerHTML = textoOriginal || '🔄 Atualizar Posições';
      }
    }
  }

  // Inicializar aba de rastreamento
  function inicializarAbaRastreamento() {
    // Botão voltar
    const btnVoltar = document.getElementById('btnVoltarRastreamento');
    if (btnVoltar) {
      btnVoltar.addEventListener('click', () => {
        mudarAba('filtros');
      });
    }

    // Botão atualizar
    const btnAtualizar = document.getElementById('btnAtualizarRastreamento');
    if (btnAtualizar) {
      btnAtualizar.addEventListener('click', async () => {
        const idViagem = document.getElementById('filtroIdViagem')?.value || 
                        document.getElementById('viagemId')?.value || 
                        null;
        if (idViagem) {
          try {
            // Mostrar overlay de loading
            showRastreamentoLoading('Sincronizando Rastreamento', 'Sincronizando posições do INTEGRA_PRD...');
            
            // Primeiro sincronizar do INTEGRA_PRD, depois recarregar posições
            await sincronizarRastreamentoIntegra(idViagem);
            
            // Atualizar mensagem do overlay
            showRastreamentoLoading('Carregando Posições GPS', 'Buscando e processando posições GPS...');
            
            // Recarregar posições após sincronização
            await carregarPosicoesRastreamento(idViagem);
          } catch (err) {
            console.error('Erro ao atualizar rastreamento:', err);
            mostrarMensagemRastreamento('Erro ao atualizar posições. Tente novamente.', 'error');
          } finally {
            // Sempre esconder overlay
            hideRastreamentoLoading();
          }
        } else {
          mostrarMensagemRastreamento('Nenhuma viagem selecionada.', 'warning');
        }
      });
    }
  }

  // ==========================================
  // ALERTAS, CHAT, SOS E RANKING REMOVIDOS
  // ==========================================
  // Estas funcionalidades foram movidas para módulos separados:
  // - Alertas: backend/public/modulos/alertas/
  // - Chat: backend/public/modulos/chat/
  // - SOS: backend/public/modulos/sos/
  // - Ranking: backend/public/modulos/ranking/
  
  // Funções globais do WebSocket mantidas para compatibilidade, mas com verificações de segurança

  // Funções para overlay de loading
  function showRastreamentoLoading(titulo = 'Carregando Posições GPS', texto = 'Aguarde enquanto buscamos as posições...') {
    const overlay = document.getElementById('rastreamentoLoadingOverlay');
    const tituloEl = document.getElementById('rastreamentoLoadingTitulo');
    const textoEl = document.getElementById('rastreamentoLoadingTexto');
    
    if (overlay) {
      if (tituloEl) tituloEl.textContent = titulo;
      if (textoEl) textoEl.textContent = texto;
      overlay.style.display = 'flex';
    }
  }

  function hideRastreamentoLoading() {
    const overlay = document.getElementById('rastreamentoLoadingOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Carregar posições GPS da viagem
  async function carregarPosicoesRastreamento(idViagem) {
    if (!idViagem) {
      mostrarMensagemRastreamento('Nenhuma viagem selecionada.', 'warning');
      return;
    }

    const container = document.getElementById('rastreamentoContainer');
    const semViagem = document.getElementById('rastreamentoSemViagem');
    const infoViagem = document.getElementById('rastreamentoInfoViagem');
    const listaPosicoes = document.getElementById('listaPosicoes');

    try {
      // Mostrar overlay de loading
      showRastreamentoLoading('Carregando Posições GPS', 'Buscando posições GPS da viagem...');
      
      // Mostrar loading na lista também
      if (listaPosicoes) {
        listaPosicoes.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Carregando posições...</p>';
      }

      // Buscar motorista da viagem (mesmo que não tenha posições GPS)
      let motorista = null;
      try {
        const motoristaResponse = await fetch(`/api/motorista/motorista-viagem/${idViagem}`);
        if (motoristaResponse.ok) {
          motorista = await motoristaResponse.json();
        }
      } catch (err) {
        console.warn('Erro ao buscar motorista:', err);
      }

      // Buscar dados da viagem (origem e destino)
      let dadosViagem = null;
      try {
        const viagemResponse = await fetch(`/api/viagens/${idViagem}`);
        if (viagemResponse.ok) {
          dadosViagem = await viagemResponse.json();
          console.log(`🔍 [RASTREAMENTO] Dados da viagem recebidos:`, {
            ORIGEM_CIDADE: dadosViagem.ORIGEM_CIDADE,
            ORIGEM_ESTADO: dadosViagem.ORIGEM_ESTADO,
            DESTINO_CIDADE: dadosViagem.DESTINO_CIDADE,
            DESTINO_ESTADO: dadosViagem.DESTINO_ESTADO
          });
        } else {
          console.warn(`⚠️ [RASTREAMENTO] Erro ao buscar dados da viagem: ${viagemResponse.status}`);
        }
      } catch (err) {
        console.warn('Erro ao buscar dados da viagem:', err);
      }

      // Buscar posições
      const response = await fetch(`/api/motorista/posicoes/${idViagem}`);
      
      if (!response.ok) {
        throw new Error(`Erro ao buscar posições: ${response.status}`);
      }

      const posicoesData = await response.json();
      
      console.log(`📊 [RASTREAMENTO] Resposta da API recebida:`, {
        tipo: Array.isArray(posicoesData) ? 'array' : 'objeto',
        tamanho: Array.isArray(posicoesData) ? posicoesData.length : (posicoesData.posicoes?.length || 0)
      });
      
      // A resposta pode ser um array direto (compatibilidade) ou um objeto com posicoes e ultimaPosicaoGeral
      let posicoes, ultimaPosicaoGeral;
      if (Array.isArray(posicoesData)) {
        // Formato antigo (array direto) - compatibilidade
        posicoes = posicoesData;
        ultimaPosicaoGeral = null;
        console.log(`📊 [RASTREAMENTO] Formato antigo (array): ${posicoes.length} posições`);
      } else {
        // Formato novo (objeto com posicoes e ultimaPosicaoGeral)
        posicoes = posicoesData.posicoes || [];
        ultimaPosicaoGeral = posicoesData.ultimaPosicaoGeral || null;
        console.log(`📊 [RASTREAMENTO] Formato novo (objeto): ${posicoes.length} posições`);
      }
      
      if (posicoes.length > 0) {
        console.log(`✅ [RASTREAMENTO] ${posicoes.length} posições GPS carregadas para viagem ${idViagem}`);
        console.log(`📍 [RASTREAMENTO] Primeira posição:`, posicoes[0]);
        console.log(`📍 [RASTREAMENTO] Última posição:`, posicoes[posicoes.length - 1]);
      } else {
        console.warn(`⚠️ [RASTREAMENTO] Nenhuma posição encontrada na resposta da API para viagem ${idViagem}`);
      }
      
      if (ultimaPosicaoGeral) {
        console.log(`📅 [RASTREAMENTO] Última atualização geral:`, ultimaPosicaoGeral.DHREGISTRO);
      }

      // Esconder mensagem "sem viagem" e mostrar container
      if (semViagem) semViagem.style.display = 'none';
      if (container) container.style.display = 'block';
      if (infoViagem) infoViagem.style.display = 'block';

      // Atualizar informações da viagem
      document.getElementById('rastreamentoIdViagem').textContent = idViagem;
      
      // Atualizar motorista (usar das posições ou buscar separadamente)
      const nomeMotorista = (posicoes && posicoes.length > 0 && posicoes[0].NOME_MOTORISTA) 
        ? posicoes[0].NOME_MOTORISTA 
        : (motorista ? motorista.NOME_MOTORISTA : 'Não informado');
      document.getElementById('rastreamentoMotorista').textContent = nomeMotorista;

      // Atualizar informações
      if (posicoes && posicoes.length > 0) {
        document.getElementById('rastreamentoTotalPosicoes').textContent = posicoes.length;
        
        // Usar última posição geral (sem filtro) se disponível, senão usar última do array filtrado
        let ultimaDataParaExibir = null;
        if (ultimaPosicaoGeral && ultimaPosicaoGeral.DHREGISTRO) {
          // Tratar data do SQL Server
          // A data vem como string no formato local (sem timezone)
          // Precisamos interpretar como horário local do Brasil, não UTC
          const dataStr = ultimaPosicaoGeral.DHREGISTRO;
          if (typeof dataStr === 'string') {
            // Se a string não tem timezone (não termina com Z ou +/-), 
            // interpretar como horário local do Brasil
            // Formato esperado: "2025-12-15T17:56:00" ou "2025-12-15T17:56:00.000"
            // Vamos criar um Date interpretando como horário local
            const partes = dataStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (partes) {
              // Criar Date usando componentes (ano, mês-1, dia, hora, minuto, segundo)
              // Isso cria a data no horário local do navegador
              ultimaDataParaExibir = new Date(
                parseInt(partes[1]), // ano
                parseInt(partes[2]) - 1, // mês (0-11)
                parseInt(partes[3]), // dia
                parseInt(partes[4]), // hora
                parseInt(partes[5]), // minuto
                parseInt(partes[6])  // segundo
              );
            } else {
              ultimaDataParaExibir = new Date(dataStr);
            }
          } else {
            ultimaDataParaExibir = new Date(dataStr);
          }
        } else {
          const ultima = posicoes[posicoes.length - 1];
          if (ultima && ultima.DHREGISTRO) {
            ultimaDataParaExibir = new Date(ultima.DHREGISTRO);
          }
        }
        
        if (ultimaDataParaExibir && !isNaN(ultimaDataParaExibir.getTime())) {
          // Formatar no horário local (já está no horário local após a conversão acima)
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = 
            ultimaDataParaExibir.toLocaleString('pt-BR', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
        } else {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = '-';
        }

        // Exibir no mapa (com origem e destino se disponível)
        await exibirMapaRastreamento(posicoes, dadosViagem);

        // Exibir na lista (sempre mostrar todas as posições na lista, não apenas as amostradas)
        exibirListaPosicoes(posicoes);
        
        // Esconder overlay após exibir tudo
        hideRastreamentoLoading();
      } else {
        // Nenhuma posição encontrada, mas mostrar informações da viagem
        document.getElementById('rastreamentoTotalPosicoes').textContent = '0';
        
        // Mesmo sem posições filtradas, pode haver uma última posição geral
        let ultimaDataParaExibir = null;
        if (ultimaPosicaoGeral && ultimaPosicaoGeral.DHREGISTRO) {
          // Tratar data do SQL Server - interpretar como horário local
          const dataStr = ultimaPosicaoGeral.DHREGISTRO;
          if (typeof dataStr === 'string') {
            const partes = dataStr.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
            if (partes) {
              ultimaDataParaExibir = new Date(
                parseInt(partes[1]), // ano
                parseInt(partes[2]) - 1, // mês (0-11)
                parseInt(partes[3]), // dia
                parseInt(partes[4]), // hora
                parseInt(partes[5]), // minuto
                parseInt(partes[6])  // segundo
              );
            } else {
              ultimaDataParaExibir = new Date(dataStr);
            }
          } else {
            ultimaDataParaExibir = new Date(dataStr);
          }
        }
        
        if (ultimaDataParaExibir && !isNaN(ultimaDataParaExibir.getTime())) {
          // Formatar no horário local
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = 
            ultimaDataParaExibir.toLocaleString('pt-BR', { 
              day: '2-digit', 
              month: '2-digit', 
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });
        } else {
          document.getElementById('rastreamentoUltimaAtualizacao').textContent = '-';
        }
        
        if (listaPosicoes) {
          listaPosicoes.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Nenhuma posição GPS registrada para esta viagem.</p>';
        }
        
        // Exibir no mapa apenas origem e destino (sem posições GPS)
        if (dadosViagem) {
          await exibirMapaRastreamento([], dadosViagem);
        } else {
          // Limpar mapa se existir
          if (mapaRastreamento) {
            mapaRastreamento.remove();
            mapaRastreamento = null;
          }
        }
        
        // Esconder overlay
        hideRastreamentoLoading();
      }
    } catch (err) {
      console.error('Erro ao carregar posições:', err);
      mostrarMensagemRastreamento('Erro ao carregar posições GPS. Tente novamente.', 'error');
      if (listaPosicoes) {
        listaPosicoes.innerHTML = '<p style="text-align: center; color: #e74c3c; padding: 20px;">Erro ao carregar posições.</p>';
      }
      // Esconder overlay em caso de erro
      hideRastreamentoLoading();
    }
  }

  // Exibir posições no mapa
  async function exibirMapaRastreamento(posicoes, dadosViagem = null) {
    // Evitar múltiplas inicializações simultâneas
    if (mapaRastreamentoInicializando) {
      console.warn('⚠️ [RASTREAMENTO] Mapa já está sendo inicializado. Aguardando...');
      // Aguardar até que a inicialização anterior termine
      let tentativas = 0;
      while (mapaRastreamentoInicializando && tentativas < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        tentativas++;
      }
      if (mapaRastreamentoInicializando) {
        console.error('❌ [RASTREAMENTO] Timeout aguardando inicialização anterior. Cancelando.');
        return;
      }
    }
    
    mapaRastreamentoInicializando = true;
    
    try {
      console.log(`🗺️ [MAPA RASTREAMENTO] Exibindo mapa com ${posicoes?.length || 0} posições e dados da viagem:`, dadosViagem ? 'SIM' : 'NÃO');
      
      // Se não há posições e não há dados da viagem, não exibir mapa
      if ((!posicoes || posicoes.length === 0) && !dadosViagem) {
        console.warn(`⚠️ [MAPA RASTREAMENTO] Não há posições nem dados da viagem. Não exibindo mapa.`);
        return;
      }

    // Obter configuração do mapa
    // Usar APENAS MAP_CONFIG global de /js/map-config.js
    // Se não estiver disponível, usar fallback mínimo (não criar config completo)
    const config = window.MAP_CONFIG || {
      tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      osrmServer: 'https://router.project-osrm.org/route/v1/driving-hgv',
      nominatimServer: window.MAP_CONFIG?.nominatimServer || 'http://app.integrabrasil.com:8080/nominatim',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    };
    
    if (!window.MAP_CONFIG) {
      console.warn('⚠️ [RASTREAMENTO] MAP_CONFIG não encontrado! Usando fallback mínimo.');
    }

    // Carregar Leaflet se necessário
    await carregarLeaflet();

    // CRÍTICO: Garantir que a aba está visível antes de buscar o elemento
    const tabRastreamento = document.getElementById('tab-rastreamento');
    if (!tabRastreamento) {
      console.error('❌ [RASTREAMENTO] Aba tab-rastreamento não encontrada no DOM!');
      mapaRastreamentoInicializando = false;
      return;
    }
    
    // Verificar se a aba está visível (display não é 'none' e não está oculta)
    const isTabVisible = tabRastreamento.style.display !== 'none' && 
                         tabRastreamento.offsetParent !== null &&
                         window.getComputedStyle(tabRastreamento).display !== 'none';
    
    if (!isTabVisible) {
      console.warn('⚠️ [RASTREAMENTO] Aba não está visível. Tentando mostrar...');
      tabRastreamento.style.display = 'block';
      // Aguardar o DOM atualizar
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Agora buscar o elemento
    let mapaDiv = document.getElementById('mapaRastreamento');
    if (!mapaDiv) {
      console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento não encontrado após mostrar aba!');
      // Tentar mais uma vez após um delay maior
      await new Promise(resolve => setTimeout(resolve, 500));
      mapaDiv = document.getElementById('mapaRastreamento');
      if (!mapaDiv) {
        console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento ainda não encontrado após múltiplas tentativas!');
        mapaRastreamentoInicializando = false;
        return;
      }
    }

    // Limpar mapa anterior - com proteção robusta
    if (mapaRastreamento) {
      try {
        // Remover layers antes de remover o mapa
        if (linhaRastreamento) {
          try {
            mapaRastreamento.removeLayer(linhaRastreamento);
          } catch (e) {
            // Ignorar erro se layer já foi removido
          }
          linhaRastreamento = null;
        }
        if (marcadorOrigemRastreamento) {
          try {
            mapaRastreamento.removeLayer(marcadorOrigemRastreamento);
          } catch (e) {
            // Ignorar
          }
          marcadorOrigemRastreamento = null;
        }
        if (marcadorDestinoRastreamento) {
          try {
            mapaRastreamento.removeLayer(marcadorDestinoRastreamento);
          } catch (e) {
            // Ignorar
          }
          marcadorDestinoRastreamento = null;
        }
        if (linhaRotaPlanejada) {
          try {
            mapaRastreamento.removeLayer(linhaRotaPlanejada);
          } catch (e) {
            // Ignorar
          }
          linhaRotaPlanejada = null;
        }
        if (linhaRotaRestante) {
          try {
            mapaRastreamento.removeLayer(linhaRotaRestante);
          } catch (e) {
            // Ignorar
          }
          linhaRotaRestante = null;
        }
        marcadoresRastreamento.forEach(m => {
          try {
            mapaRastreamento.removeLayer(m);
          } catch (e) {
            // Ignorar
          }
        });
        
        // Remover o mapa
        try {
          mapaRastreamento.remove();
        } catch (e) {
          // Se der erro ao remover, forçar limpeza do container
          console.warn('⚠️ [RASTREAMENTO] Erro ao remover mapa. Forçando limpeza do container...');
          const mapaDiv = document.getElementById('mapaRastreamento');
          if (mapaDiv) {
            mapaDiv.innerHTML = '';
            if (mapaDiv._leaflet_id) {
              delete mapaDiv._leaflet_id;
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ [RASTREAMENTO] Erro ao limpar mapa anterior:', e);
        // Forçar limpeza do container em caso de erro
        const mapaDiv = document.getElementById('mapaRastreamento');
        if (mapaDiv) {
          mapaDiv.innerHTML = '';
          if (mapaDiv._leaflet_id) {
            delete mapaDiv._leaflet_id;
          }
        }
      }
      mapaRastreamento = null;
    }
    marcadoresRastreamento = [];

    // IMPORTANTE: Verificar se o container já tem um mapa antes de criar novo
    const mapaRastreamentoDiv = document.getElementById('mapaRastreamento');
    if (mapaRastreamentoDiv) {
      // Verificar se há um mapa Leaflet existente no container
      if (mapaRastreamentoDiv._leaflet_id || (typeof L !== 'undefined' && L.DomUtil.get(mapaRastreamentoDiv))) {
        console.warn('⚠️ [RASTREAMENTO] Container já tem mapa. Limpando antes de criar novo...');
        try {
          // Tentar obter o mapa existente do Leaflet
          if (typeof L !== 'undefined') {
            const mapaExistente = L.DomUtil.get(mapaRastreamentoDiv);
            if (mapaExistente && mapaExistente._leaflet_id) {
              const mapaInstance = L.Map.prototype.getContainer ? L.Map.prototype.getContainer.call({ _container: mapaRastreamentoDiv }) : null;
              if (mapaInstance && typeof mapaInstance.remove === 'function') {
                mapaInstance.remove();
              }
            }
          }
          
          // Remover mapa global se existir
          if (mapaRastreamento && typeof mapaRastreamento.remove === 'function') {
            try {
              mapaRastreamento.remove();
            } catch (e) {
              console.warn('⚠️ [RASTREAMENTO] Erro ao remover mapa global:', e);
            }
          }
        } catch (e) {
          console.warn('⚠️ [RASTREAMENTO] Erro ao limpar mapa existente:', e);
        }
        
        // Limpar completamente o container
        mapaRastreamentoDiv.innerHTML = '';
        if (mapaRastreamentoDiv._leaflet_id) {
          delete mapaRastreamentoDiv._leaflet_id;
        }
        
        // Aguardar um pouco para garantir que a limpeza foi concluída
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // Criar mapa - com proteção adicional contra reutilização
    try {
      // Verificar se o elemento existe e está visível
      const mapaDivCheck = document.getElementById('mapaRastreamento');
      if (!mapaDivCheck) {
        console.error('❌ [RASTREAMENTO] Elemento mapaRastreamento não encontrado no DOM!');
        throw new Error('Map container not found');
      }
      
      // Verificar se a aba está visível
      const tabRastreamento = document.getElementById('tab-rastreamento');
      if (!tabRastreamento || tabRastreamento.style.display === 'none') {
        console.warn('⚠️ [RASTREAMENTO] Aba de rastreamento não está visível. Aguardando...');
        // Aguardar um pouco e verificar novamente
        await new Promise(resolve => setTimeout(resolve, 300));
        const tabCheck = document.getElementById('tab-rastreamento');
        if (!tabCheck || tabCheck.style.display === 'none') {
          console.error('❌ [RASTREAMENTO] Aba de rastreamento ainda não está visível após espera!');
          throw new Error('Rastreamento tab not visible');
        }
      }
      
      // Verificar novamente se o container está limpo antes de criar
      if (mapaDivCheck._leaflet_id) {
        console.warn('⚠️ [RASTREAMENTO] Container ainda tem _leaflet_id. Forçando limpeza...');
        mapaDivCheck.innerHTML = '';
        delete mapaDivCheck._leaflet_id;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Garantir que o elemento tem dimensões antes de criar o mapa
      if (mapaDivCheck.offsetWidth === 0 || mapaDivCheck.offsetHeight === 0) {
        console.warn('⚠️ [RASTREAMENTO] Container não tem dimensões. Aguardando renderização...');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      mapaRastreamento = L.map('mapaRastreamento', {
        zoomControl: true
      });
    } catch (err) {
      if (err.message && (err.message.includes('already initialized') || err.message.includes('being reused'))) {
        console.warn('⚠️ [RASTREAMENTO] Erro ao inicializar mapa. Limpando e tentando novamente...');
        const mapaDiv = document.getElementById('mapaRastreamento');
        if (mapaDiv) {
          // Limpar completamente
          mapaDiv.innerHTML = '';
          if (mapaDiv._leaflet_id) {
            delete mapaDiv._leaflet_id;
          }
          
          // Limpar referências do Leaflet
          if (typeof L !== 'undefined' && L.DomUtil) {
            try {
              L.DomUtil.empty(mapaDiv);
            } catch (e) {
              // Ignorar
            }
          }
          
          await new Promise(resolve => setTimeout(resolve, 150));
          
          // Verificar novamente se está limpo
          if (mapaDiv._leaflet_id) {
            console.warn('⚠️ [RASTREAMENTO] Container ainda não está limpo. Tentando novamente...');
            mapaDiv.innerHTML = '';
            delete mapaDiv._leaflet_id;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          // Tentar criar o mapa novamente
          try {
            mapaRastreamento = L.map('mapaRastreamento', {
              zoomControl: true
            });
          } catch (retryErr) {
            console.error('❌ [RASTREAMENTO] Erro ao criar mapa após limpeza:', retryErr);
            throw retryErr;
          }
        }
      } else {
        throw err;
      }
    }

    // Adicionar tiles
    const tileOptions = {
      attribution: config.attribution,
      maxZoom: config.maxZoom
    };
    
    // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
    if (config.tileServer && config.tileServer.includes('{s}')) {
      tileOptions.subdomains = ['a', 'b', 'c'];
    }
    
    L.tileLayer(config.tileServer, tileOptions).addTo(mapaRastreamento);

    // Ordenar posições por data/hora (garantir ordem cronológica)
    const posicoesOrdenadas = [...posicoes].sort((a, b) => {
      const dataA = new Date(a.DHREGISTRO || a.DHPOSICAO || 0);
      const dataB = new Date(b.DHREGISTRO || b.DHPOSICAO || 0);
      return dataA - dataB; // ASC: mais antiga primeiro
    });

    console.log(`📍 [MAPA RASTREAMENTO] ${posicoesOrdenadas.length} posições ordenadas para desenhar no mapa`);

    // Preparar coordenadas das posições GPS (já ordenadas)
    let coordenadas = posicoesOrdenadas
      .filter(p => p.LATITUDE && p.LONGITUDE && !isNaN(parseFloat(p.LATITUDE)) && !isNaN(parseFloat(p.LONGITUDE)))
      .map(p => [parseFloat(p.LATITUDE), parseFloat(p.LONGITUDE)]);
    
    console.log(`📍 [MAPA RASTREAMENTO] ${coordenadas.length} coordenadas válidas preparadas para rota`);
    
    if (coordenadas.length === 0 && posicoesOrdenadas.length > 0) {
      console.error(`❌ [MAPA RASTREAMENTO] ERRO: ${posicoesOrdenadas.length} posições mas nenhuma coordenada válida!`);
      console.error(`❌ [MAPA RASTREAMENTO] Primeira posição:`, posicoesOrdenadas[0]);
    }
    
    // LIMITAR PONTOS PARA MELHORAR PERFORMANCE
    // Se houver muitos pontos, fazer amostragem inteligente mantendo início, fim e pontos estratégicos
    const MAX_PONTOS_MAPA = 80; // Limite máximo de pontos para desenhar no mapa (reduzido para melhor performance)
    const totalOriginal = coordenadas.length; // Guardar total original para log
    if (coordenadas.length > MAX_PONTOS_MAPA) {
      console.log(`⚠️ [MAPA RASTREAMENTO] Muitos pontos (${totalOriginal}). Aplicando amostragem inteligente para ${MAX_PONTOS_MAPA} pontos...`);
      
      const coordenadasAmostradas = [];
      const total = coordenadas.length;
      
      // Sempre incluir primeiro ponto
      coordenadasAmostradas.push(coordenadas[0]);
      
      // Calcular intervalo para amostragem uniforme
      // Usar deciles (10 partes) para distribuição mais uniforme
      const numPontosIntermediarios = MAX_PONTOS_MAPA - 2; // -2 porque já incluímos primeiro e último
      const intervalo = Math.max(1, Math.floor((total - 2) / numPontosIntermediarios));
      
      // Incluir pontos intermediários em intervalos regulares
      for (let i = intervalo; i < total - 1; i += intervalo) {
        if (coordenadasAmostradas.length < MAX_PONTOS_MAPA - 1) {
          coordenadasAmostradas.push(coordenadas[i]);
        }
      }
      
      // Sempre incluir último ponto
      if (coordenadasAmostradas[coordenadasAmostradas.length - 1] !== coordenadas[total - 1]) {
        coordenadasAmostradas.push(coordenadas[total - 1]);
      }
      
      coordenadas = coordenadasAmostradas;
      const reducaoPercentual = ((1 - coordenadas.length/totalOriginal) * 100).toFixed(1);
      console.log(`✅ [MAPA RASTREAMENTO] Amostragem aplicada: ${coordenadas.length} pontos selecionados de ${totalOriginal} totais (redução de ${reducaoPercentual}%)`);
      
      // Atualizar overlay com informação de amostragem
      showRastreamentoLoading('Processando Rota', `Amostragem aplicada: ${coordenadas.length} de ${totalOriginal} pontos. Calculando rota...`);
    }

    // Calcular rota real usando OSRM/ORS conectando TODOS os pontos GPS consecutivos
    if (coordenadas.length > 0) {
      try {
        const config = window.MAP_CONFIG || {};
        console.log(`🛣️  Calculando rota usando servidor: ${config.osrmServer || 'padrão'}...`);
        
        // Atualizar overlay para mostrar progresso do cálculo de rota
        showRastreamentoLoading('Calculando Rota', `Processando ${coordenadas.length} pontos GPS e calculando rota real...`);
        
        // Função auxiliar para construir URL de roteamento (suporta OSRM e ORS)
        // Usar a função global construirUrlRota (definida acima no escopo)
        
        // Usar a função global parsearRespostaRota (definida acima no escopo)
        
        // Função para calcular distância entre dois pontos
        function calcularDistancia(coord1, coord2) {
          const R = 6371e3; // Raio da Terra em metros
          const φ1 = coord1[0] * Math.PI / 180;
          const φ2 = coord2[0] * Math.PI / 180;
          const Δφ = (coord2[0] - coord1[0]) * Math.PI / 180;
          const Δλ = (coord2[1] - coord1[1]) * Math.PI / 180;
          const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                    Math.cos(φ1) * Math.cos(φ2) *
                    Math.sin(Δλ/2) * Math.sin(Δλ/2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          return R * c; // Distância em metros
        }
        
        // Filtrar pontos muito próximos e fazer amostragem inteligente para performance
        let pontosFiltrados = [coordenadas[0]];
        for (let i = 1; i < coordenadas.length; i++) {
          const distancia = calcularDistancia(pontosFiltrados[pontosFiltrados.length - 1], coordenadas[i]);
          if (distancia >= 200) { // Aumentar para 200 metros (mais agressivo)
            pontosFiltrados.push(coordenadas[i]);
          }
        }
        // Sempre incluir último ponto
        if (pontosFiltrados[pontosFiltrados.length - 1] !== coordenadas[coordenadas.length - 1]) {
          pontosFiltrados.push(coordenadas[coordenadas.length - 1]);
        }
        
        // Logs removidos para reduzir verbosidade
        
        // NÃO fazer amostragem - usar TODOS os pontos filtrados para garantir rota completa
        let pontosParaRota = pontosFiltrados;
        
        // Calcular rota conectando pontos consecutivos em pares (mais preciso)
        // Para muitos pontos, processar em segmentos maiores para ser mais rápido
        let routeLatLngs = [];
        const maxPontosPorSegmento = 15; // Aumentar para 15 pontos por segmento (mais rápido)
        
        if (pontosParaRota.length > maxPontosPorSegmento) {
          console.log(`   📊 Calculando rota em segmentos de ${maxPontosPorSegmento} pontos (total: ${pontosParaRota.length})...`);
          
          // Função auxiliar para obter rota de um segmento (com retry e servidor alternativo)
          async function obterRotaSegmento(segmento, servidorPrincipal, servidorAlternativo = null) {
            // IMPORTANTE: segmento já está na ordem correta (primeiro → último)
            // Formato OSRM: lon,lat;lon,lat;...
            const coordsStr = segmento.map(c => `${c[1]},${c[0]}`).join(';');
            // Log removido
            
            // Tentar primeiro com servidor principal
            for (const servidor of [servidorPrincipal, servidorAlternativo].filter(s => s)) {
              const rotaUrl = construirUrlRota(servidor, coordsStr, 'simplified', 'geojson');
              
              // Verificar se URL está correto antes de fazer fetch
              if ((rotaUrl.includes('186.250.92.131') || rotaUrl.includes('app.integrabrasil.com')) && rotaUrl.startsWith('https:')) {
                console.error('❌ [RASTREAMENTO] ERRO CRÍTICO: URL ainda está em HTTPS!', rotaUrl);
                continue; // Pular este servidor e tentar próximo
              }
              
              try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 25000); // 25 segundos
                
                console.log('🌐 [RASTREAMENTO] Fazendo fetch para:', rotaUrl.substring(0, 100) + '...');
                
                // Usar função helper que força HTTP
                const response = await fetchForcandoHTTP(rotaUrl, {
                  signal: controller.signal
                });
                clearTimeout(timeoutId);
                
                if (response.ok) {
                  const segmentData = await response.json();
                  const segmentGeometry = parsearRespostaRota(segmentData);
                  if (segmentGeometry && segmentGeometry.length > 0) {
                    // Verificar se a rota está na ordem correta (primeiro ponto do segmento deve ser próximo ao primeiro ponto da rota)
                    const primeiroPontoSegmento = segmento[0];
                    const primeiroPontoRota = segmentGeometry[0];
                    const ultimoPontoSegmento = segmento[segmento.length - 1];
                    const ultimoPontoRota = segmentGeometry[segmentGeometry.length - 1];
                    
                    const distInicio = Math.sqrt(
                      Math.pow(primeiroPontoRota[0] - primeiroPontoSegmento[0], 2) + 
                      Math.pow(primeiroPontoRota[1] - primeiroPontoSegmento[1], 2)
                    );
                    const distFim = Math.sqrt(
                      Math.pow(ultimoPontoRota[0] - ultimoPontoSegmento[0], 2) + 
                      Math.pow(ultimoPontoRota[1] - ultimoPontoSegmento[1], 2)
                    );
                    
                    // Se a rota está invertida (último ponto da rota está próximo ao primeiro ponto do segmento)
                    if (distInicio > 0.01 && distFim < 0.01) {
                      console.warn(`   ⚠️  Rota invertida detectada! Revertendo ordem...`);
                      return segmentGeometry.reverse();
                    }
                    
                    console.log(`   ✅ Rota segmento OK: primeiro [${primeiroPontoRota[0]}, ${primeiroPontoRota[1]}], último [${ultimoPontoRota[0]}, ${ultimoPontoRota[1]}]`);
                    return segmentGeometry;
                  }
                }
              } catch (err) {
                if (err.name === 'AbortError') {
                  console.warn(`   ⏱️  Timeout no servidor ${servidor === servidorPrincipal ? 'principal' : 'alternativo'}`);
                } else {
                  console.warn(`   Erro no servidor ${servidor === servidorPrincipal ? 'principal' : 'alternativo'}:`, err.message);
                }
                // Continuar para tentar próximo servidor ou método
              }
            }
            
            // Se ambos falharem, tentar calcular em pares menores (2 pontos por vez)
            if (segmento.length > 2) {
              console.log(`   🔄 Tentando calcular em pares menores (${segmento.length} pontos → pares de 2)...`);
              let rotaPares = [];
              
              for (let i = 0; i < segmento.length - 1; i++) {
                const par = [segmento[i], segmento[i + 1]];
                const parCoordsStr = par.map(c => `${c[1]},${c[0]}`).join(';');
                
                // Tentar ambos servidores para cada par
                let parRota = null;
                for (const servidor of [servidorPrincipal, servidorAlternativo].filter(s => s)) {
                  try {
                    const parUrl = construirUrlRota(servidor, parCoordsStr, 'simplified', 'geojson');
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s para pares
                    
                    const parResponse = await fetch(parUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (parResponse.ok) {
                      const parData = await parResponse.json();
                      parRota = parsearRespostaRota(parData);
                      if (parRota && parRota.length > 0) {
                        break; // Sucesso, sair do loop de servidores
                      }
                    }
                  } catch (err) {
                    // Continuar para próximo servidor
                  }
                }
                
                if (parRota && parRota.length > 0) {
                  if (i === 0) {
                    rotaPares.push(...parRota);
                  } else {
                    rotaPares.push(...parRota.slice(1)); // Pular primeiro para não duplicar
                  }
                  await new Promise(resolve => setTimeout(resolve, 50)); // Pequeno delay
                } else {
                  // Se falhar, adicionar linha reta para este par
                  if (i === 0) {
                    rotaPares.push(...par);
                  } else {
                    rotaPares.push(par[1]);
                  }
                }
              }
              
              if (rotaPares.length > 0) {
                console.log(`   ✅ Rota calculada em pares (${rotaPares.length} pontos)`);
                return rotaPares;
              }
            }
            
            return null;
          }
          
          // Calcular rota segmento por segmento (conectar pontos consecutivos)
          for (let i = 0; i < pontosParaRota.length - 1; i += maxPontosPorSegmento - 1) {
            let segmento = pontosParaRota.slice(i, Math.min(i + maxPontosPorSegmento, pontosParaRota.length));
            
            // Verificar se há pontos muito distantes no segmento e dividir se necessário
            let segmentoProcessado = false;
            for (let j = 0; j < segmento.length - 1; j++) {
              const dist = calcularDistancia(segmento[j], segmento[j + 1]);
              if (dist > 100000) { // Mais de 100km entre pontos consecutivos = erro de dados
                console.warn(`   ⚠️  Pontos muito distantes detectados (${(dist/1000).toFixed(1)}km) entre posições ${i+j} e ${i+j+1}`);
                console.log(`   🔄 Dividindo segmento em partes menores...`);
                
                // Processar primeira parte (até o ponto problemático)
                if (j > 0) {
                  const parte1 = segmento.slice(0, j + 1);
                  if (parte1.length >= 2) {
                    const parte1Route = await obterRotaSegmento(
                      parte1,
                      config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                      config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                    );
                    
                    if (parte1Route && parte1Route.length > 0) {
                      if (i === 0 && routeLatLngs.length === 0) {
                        routeLatLngs.push(...parte1Route);
                      } else {
                        routeLatLngs.push(...parte1Route.slice(1));
                      }
                      console.log(`   ✅ Primeira parte do segmento processada (${parte1Route.length} pontos)`);
                    } else {
                      // Se falhar, calcular ponto a ponto para a primeira parte
                      console.log(`   🔄 Calculando primeira parte ponto a ponto...`);
                        for (let k = 0; k < parte1.length - 1; k++) {
                        const par = [parte1[k], parte1[k + 1]];
                        const parCoordsStr = par.map(c => `${c[1]},${c[0]}`).join(';');
                        
                        let parRota = null;
                        for (const servidor of [
                          config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                          config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                        ].filter(s => s)) {
                          try {
                            const parUrl = construirUrlRota(servidor, parCoordsStr, 'simplified', 'geojson');
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 8000);
                            
                            const parResponse = await fetch(parUrl, { signal: controller.signal });
                            clearTimeout(timeoutId);
                            
                            if (parResponse.ok) {
                              const parData = await parResponse.json();
                              parRota = parsearRespostaRota(parData);
                              if (parRota && parRota.length > 0) {
                                break;
                              }
                            }
                          } catch (err) {
                            // Continuar para próximo servidor
                          }
                        }
                        
                        if (parRota && parRota.length > 0) {
                          if (i === 0 && routeLatLngs.length === 0 && k === 0) {
                            routeLatLngs.push(...parRota);
                          } else {
                            routeLatLngs.push(...parRota.slice(1));
                          }
                        } else {
                          // Linha reta apenas para este par
                          if (i === 0 && routeLatLngs.length === 0 && k === 0) {
                            routeLatLngs.push(...par);
                          } else {
                            routeLatLngs.push(par[1]);
                          }
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 30));
                      }
                      console.log(`   ✅ Primeira parte calculada ponto a ponto`);
                    }
                  } else if (parte1.length === 1) {
                    // Apenas um ponto, adicionar
                    if (i === 0 && routeLatLngs.length === 0) {
                      routeLatLngs.push(parte1[0]);
                    }
                  }
                } else {
                  // j === 0, então o primeiro ponto do segmento já está na rota ou precisa ser adicionado
                  if (i === 0 && routeLatLngs.length === 0) {
                    routeLatLngs.push(segmento[0]);
                  }
                }
                
                // Tentar calcular rota OSRM mesmo para saltos grandes (pode ser viagem longa)
                console.log(`   🔄 Tentando calcular rota OSRM para salto de ${(dist/1000).toFixed(1)}km...`);
                const saltoPar = [segmento[j], segmento[j + 1]];
                const saltoCoordsStr = saltoPar.map(c => `${c[1]},${c[0]}`).join(';');
                
                let saltoRota = null;
                for (const servidor of [
                  config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                  config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                ].filter(s => s)) {
                  try {
                    const saltoUrl = construirUrlRota(servidor, saltoCoordsStr, 'full', 'geojson');
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s para saltos grandes
                    
                    const saltoResponse = await fetch(saltoUrl, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    
                    if (saltoResponse.ok) {
                      const saltoData = await saltoResponse.json();
                      saltoRota = parsearRespostaRota(saltoData);
                      if (saltoRota && saltoRota.length > 0) {
                        routeLatLngs.push(...saltoRota.slice(1)); // Adicionar rota completa
                        console.log(`   ✅ Rota calculada para salto de ${(dist/1000).toFixed(1)}km (${saltoRota.length} pontos)`);
                        break;
                      }
                    }
                  } catch (err) {
                    // Continuar para próximo servidor
                  }
                }
                
                // Se falhar, apenas logar - NÃO adicionar linha reta
                if (!saltoRota) {
                  console.error(`   ❌ ERRO: Não foi possível calcular rota para salto de ${(dist/1000).toFixed(1)}km`);
                  // Pular este salto e continuar
                }
                
                // Processar segunda parte (após o ponto problemático)
                if (j + 1 < segmento.length - 1) {
                  const parte2 = segmento.slice(j + 1);
                  if (parte2.length >= 2) {
                    const parte2Route = await obterRotaSegmento(
                      parte2,
                      config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                      config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                    );
                    
                    if (parte2Route && parte2Route.length > 0) {
                      routeLatLngs.push(...parte2Route.slice(1));
                      console.log(`   ✅ Segunda parte do segmento processada (${parte2Route.length} pontos)`);
                    } else {
                      // Se falhar, calcular ponto a ponto para a segunda parte
                      console.log(`   🔄 Calculando segunda parte ponto a ponto...`);
                      for (let k = 0; k < parte2.length - 1; k++) {
                        const par = [parte2[k], parte2[k + 1]];
                        const parCoordsStr = par.map(c => `${c[1]},${c[0]}`).join(';');
                        
                        let parRota = null;
                        for (const servidor of [
                          config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                          config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                        ].filter(s => s)) {
                          try {
                            const parUrl = construirUrlRota(servidor, parCoordsStr, 'simplified', 'geojson');
                            const controller = new AbortController();
                            const timeoutId = setTimeout(() => controller.abort(), 8000);
                            
                            const parResponse = await fetch(parUrl, { signal: controller.signal });
                            clearTimeout(timeoutId);
                            
                            if (parResponse.ok) {
                              const parData = await parResponse.json();
                              parRota = parsearRespostaRota(parData);
                              if (parRota && parRota.length > 0) {
                                break;
                              }
                            }
                          } catch (err) {
                            // Continuar para próximo servidor
                          }
                        }
                        
                        if (parRota && parRota.length > 0) {
                          routeLatLngs.push(...parRota.slice(1));
                        } else {
                          // Linha reta apenas para este par
                          routeLatLngs.push(par[1]);
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 30));
                      }
                      console.log(`   ✅ Segunda parte calculada ponto a ponto`);
                    }
                  } else if (parte2.length === 1) {
                    // Apenas um ponto restante, adicionar
                    routeLatLngs.push(parte2[0]);
                  }
                }
                
                segmentoProcessado = true;
                break;
              }
            }
            
            // Se não houve problema de distância, processar segmento normalmente
            if (!segmentoProcessado && segmento.length >= 2) {
              const segmentRoute = await obterRotaSegmento(
                segmento, 
                config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
              );
              
              if (segmentRoute && segmentRoute.length > 0) {
                if (i === 0) {
                  routeLatLngs.push(...segmentRoute);
                } else {
                  // Pular primeiro ponto para não duplicar na junção
                  routeLatLngs.push(...segmentRoute.slice(1));
                }
                console.log(`   ✅ Segmento ${Math.floor(i / (maxPontosPorSegmento - 1)) + 1} processado (${segmentRoute.length} pontos na rota)`);
              } else {
                // Se OSRM falhar completamente, calcular ponto a ponto (mais lento mas garante rota)
                console.warn(`   ⚠️  Segmento ${Math.floor(i / (maxPontosPorSegmento - 1)) + 1} falhou, calculando ponto a ponto...`);
                let rotaPontoAPonto = [];
                
                for (let j = 0; j < segmento.length - 1; j++) {
                  const par = [segmento[j], segmento[j + 1]];
                  const parCoordsStr = par.map(c => `${c[1]},${c[0]}`).join(';');
                  
                  // Tentar ambos servidores para cada par
                  let parRota = null;
                  for (const servidor of [
                    config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                    config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                  ].filter(s => s)) {
                    try {
                      const parUrl = construirUrlRota(servidor, parCoordsStr, 'simplified', 'geojson');
                      const controller = new AbortController();
                      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s para pares
                      
                      const parResponse = await fetch(parUrl, { signal: controller.signal });
                      clearTimeout(timeoutId);
                      
                      if (parResponse.ok) {
                        const parData = await parResponse.json();
                        parRota = parsearRespostaRota(parData);
                        if (parRota && parRota.length > 0) {
                          break; // Sucesso, sair do loop
                        }
                      }
                    } catch (err) {
                      // Continuar para próximo servidor
                    }
                  }
                  
                  if (parRota && parRota.length > 0) {
                    if (j === 0 && i === 0) {
                      rotaPontoAPonto.push(...parRota);
                    } else {
                      rotaPontoAPonto.push(...parRota.slice(1));
                    }
                  } else {
                    // Tentar com overview=full como último recurso
                    console.warn(`   ⚠️  Tentando par ${j + 1} com overview=full...`);
                    for (const servidor of [
                      config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                      config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
                    ].filter(s => s)) {
                      try {
                        const parUrlFull = construirUrlRota(servidor, parCoordsStr, 'full', 'geojson');
                        const controllerFull = new AbortController();
                        const timeoutIdFull = setTimeout(() => controllerFull.abort(), 20000);
                        
                        const parResponseFull = await fetch(parUrlFull, { signal: controllerFull.signal });
                        clearTimeout(timeoutIdFull);
                        
                        if (parResponseFull.ok) {
                          const parDataFull = await parResponseFull.json();
                          parRota = parsearRespostaRota(parDataFull);
                          if (parRota && parRota.length > 0) {
                            break;
                          }
                        }
                      } catch (err) {
                        // Continuar
                      }
                    }
                    
                    if (parRota && parRota.length > 0) {
                      if (j === 0 && i === 0) {
                        rotaPontoAPonto.push(...parRota);
                      } else {
                        rotaPontoAPonto.push(...parRota.slice(1));
                      }
                    } else {
                      console.error(`   ❌ ERRO: Não foi possível calcular rota para par ${j + 1} após todas tentativas`);
                      // NÃO adicionar linha reta - pular este par
                    }
                  }
                  
                  await new Promise(resolve => setTimeout(resolve, 30)); // Delay menor
                }
                
                if (rotaPontoAPonto.length > 0) {
                  if (i === 0) {
                    routeLatLngs.push(...rotaPontoAPonto);
                  } else {
                    routeLatLngs.push(...rotaPontoAPonto.slice(1));
                  }
                  console.log(`   ✅ Segmento ${Math.floor(i / (maxPontosPorSegmento - 1)) + 1} calculado ponto a ponto (${rotaPontoAPonto.length} pontos)`);
                }
              }
            } else if (!segmentoProcessado && segmento.length >= 1) {
              // Segmento válido mas com apenas 1 ponto ou não processado, adicionar o ponto
              if (i === 0) {
                routeLatLngs.push(...segmento);
              } else {
                routeLatLngs.push(...segmento.slice(1));
              }
            }
            
            // Delay menor entre segmentos (mais rápido)
            if (i + maxPontosPorSegmento < pontosParaRota.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 50)); // Reduzir delay
              // Mostrar progresso
              const progresso = Math.min(Math.round(((i + maxPontosPorSegmento) / pontosParaRota.length) * 100), 100);
              // Log removido
            }
          }
          
          // Adicionar linha da rota seguindo as estradas
          if (routeLatLngs.length > 0) {
            // Remover linha anterior se existir
            if (linhaRastreamento) {
              mapaRastreamento.removeLayer(linhaRastreamento);
            }
            
            // VERIFICAR SE A ROTA ESTÁ NA ORDEM CORRETA (primeiro → último)
            const primeiraPosicaoGPS = coordenadas[0];
            const ultimaPosicaoGPS = coordenadas[coordenadas.length - 1];
            const primeiroPontoRota = routeLatLngs[0];
            const ultimoPontoRota = routeLatLngs[routeLatLngs.length - 1];
            
            const distInicio = Math.sqrt(
              Math.pow(primeiroPontoRota[0] - primeiraPosicaoGPS[0], 2) + 
              Math.pow(primeiroPontoRota[1] - primeiraPosicaoGPS[1], 2)
            );
            const distFim = Math.sqrt(
              Math.pow(ultimoPontoRota[0] - ultimaPosicaoGPS[0], 2) + 
              Math.pow(ultimoPontoRota[1] - ultimaPosicaoGPS[1], 2)
            );
            
            // Se a rota está invertida (último ponto da rota está próximo ao primeiro GPS)
            if (distInicio > 0.01 && distFim < 0.01) {
              console.warn(`⚠️  ROTA INVERTIDA DETECTADA! Revertendo ordem da rota completa...`);
              routeLatLngs.reverse();
              // Recalcular após inverter
              const primeiroPontoRotaApos = routeLatLngs[0];
              const ultimoPontoRotaApos = routeLatLngs[routeLatLngs.length - 1];
              console.log(`✅ Rota revertida: primeiro [${primeiroPontoRotaApos[0]}, ${primeiroPontoRotaApos[1]}], último [${ultimoPontoRotaApos[0]}, ${ultimoPontoRotaApos[1]}]`);
            }
            
            // Garantir que a linha verde termine EXATAMENTE na última posição GPS
            const distanciaFinal = Math.sqrt(
              Math.pow(routeLatLngs[routeLatLngs.length - 1][0] - ultimaPosicaoGPS[0], 2) + 
              Math.pow(routeLatLngs[routeLatLngs.length - 1][1] - ultimaPosicaoGPS[1], 2)
            );
            
            // Se não estiver exatamente na última posição, adicionar/ajustar
            if (distanciaFinal > 0.0001) { // ~11 metros de diferença
              routeLatLngs[routeLatLngs.length - 1] = ultimaPosicaoGPS;
              console.log(`🟢 Ajustando fim da rota verde para última posição GPS exata`);
            }
            
            // Adicionar rota OSRM (VERDE - pontos já percorridos)
            linhaRastreamento = L.polyline(routeLatLngs, {
              color: '#27ae60', // Verde para pontos já percorridos
              weight: 4,
              opacity: 0.8
            }).addTo(mapaRastreamento);
            console.log(`✅ Rota OSRM calculada (verde - pontos já percorridos)! (${routeLatLngs.length} pontos conectando ${pontosParaRota.length} posições GPS)`);
            console.log(`📍 Primeiro ponto da rota verde: [${routeLatLngs[0][0]}, ${routeLatLngs[0][1]}]`);
            console.log(`📍 Último ponto da rota verde: [${routeLatLngs[routeLatLngs.length - 1][0]}, ${routeLatLngs[routeLatLngs.length - 1][1]}]`);
            
            // Atualizar overlay para mostrar que rota foi calculada
            showRastreamentoLoading('Finalizando', 'Rota calculada! Ajustando visualização do mapa...');
          } else {
            // Se não conseguiu calcular rota, tentar calcular ponto a ponto como último recurso
            console.warn('⚠️  Rota em segmentos falhou, tentando calcular ponto a ponto...');
            let rotaPontoAPonto = [];
            
            for (let i = 0; i < pontosParaRota.length - 1; i++) {
              const par = [pontosParaRota[i], pontosParaRota[i + 1]];
              const parCoordsStr = par.map(c => `${c[1]},${c[0]}`).join(';');
              
              let parRota = null;
              for (const servidor of [
                config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv'
              ].filter(s => s)) {
                try {
                  const parUrl = construirUrlRota(servidor, parCoordsStr, 'simplified', 'geojson');
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 15000);
                  
                  const parResponse = await fetch(parUrl, { signal: controller.signal });
                  clearTimeout(timeoutId);
                  
                  if (parResponse.ok) {
                    const parData = await parResponse.json();
                    parRota = parsearRespostaRota(parData);
                    if (parRota && parRota.length > 0) {
                      break;
                    }
                  }
                } catch (err) {
                  // Continuar
                }
              }
              
              if (parRota && parRota.length > 0) {
                if (i === 0) {
                  rotaPontoAPonto.push(...parRota);
                } else {
                  rotaPontoAPonto.push(...parRota.slice(1));
                }
              } else {
                console.error(`   ❌ Não foi possível calcular rota para par ${i + 1}/${pontosParaRota.length - 1}`);
              }
              
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (rotaPontoAPonto.length > 0) {
              // VERIFICAR SE A ROTA ESTÁ NA ORDEM CORRETA (primeiro → último)
              const primeiraPosicaoGPS = coordenadas[0];
              const ultimaPosicaoGPS = coordenadas[coordenadas.length - 1];
              const primeiroPontoRota = rotaPontoAPonto[0];
              const ultimoPontoRota = rotaPontoAPonto[rotaPontoAPonto.length - 1];
              
              const distInicio = Math.sqrt(
                Math.pow(primeiroPontoRota[0] - primeiraPosicaoGPS[0], 2) + 
                Math.pow(primeiroPontoRota[1] - primeiraPosicaoGPS[1], 2)
              );
              const distFim = Math.sqrt(
                Math.pow(ultimoPontoRota[0] - ultimaPosicaoGPS[0], 2) + 
                Math.pow(ultimoPontoRota[1] - ultimaPosicaoGPS[1], 2)
              );
              
              // Se a rota está invertida, reverter
              if (distInicio > 0.01 && distFim < 0.01) {
                console.warn(`⚠️  ROTA INVERTIDA DETECTADA (ponto a ponto)! Revertendo ordem...`);
                rotaPontoAPonto.reverse();
              }
              
              // Garantir que a linha verde termine EXATAMENTE na última posição GPS
              const distanciaFinal = Math.sqrt(
                Math.pow(rotaPontoAPonto[rotaPontoAPonto.length - 1][0] - ultimaPosicaoGPS[0], 2) + 
                Math.pow(rotaPontoAPonto[rotaPontoAPonto.length - 1][1] - ultimaPosicaoGPS[1], 2)
              );
              
              if (distanciaFinal > 0.0001) {
                rotaPontoAPonto[rotaPontoAPonto.length - 1] = ultimaPosicaoGPS;
                console.log(`🟢 Ajustando fim da rota verde (ponto a ponto) para última posição GPS exata`);
              }
              
              linhaRastreamento = L.polyline(rotaPontoAPonto, {
                color: '#27ae60', // Verde para pontos já percorridos
                weight: 4,
                opacity: 0.8
              }).addTo(mapaRastreamento);
              console.log(`✅ Rota calculada ponto a ponto (verde - pontos já percorridos)! (${rotaPontoAPonto.length} pontos)`);
            } else {
              console.error('❌ ERRO: Não foi possível calcular rota pelas estradas. Verifique conexão com servidor OSRM/ORS.');
            }
          }
        } else {
          // Poucos pontos: calcular rota completa de uma vez conectando todos os pontos
          const coordsStr = pontosParaRota.map(c => `${c[1]},${c[0]}`).join(';');
          const rotaUrl = construirUrlRota(
            config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
            coordsStr,
            'simplified',
            'geojson'
          );
          
          console.log(`   🛣️  Calculando rota completa para ${pontosParaRota.length} pontos...`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
            const osrmResponse = await fetchForcandoHTTP(rotaUrl, {
              signal: controller.signal
            });
          
          clearTimeout(timeoutId);

          if (osrmResponse.ok) {
            const osrmData = await osrmResponse.json();
            const routeGeometry = parsearRespostaRota(osrmData);
            if (routeGeometry && routeGeometry.length > 0) {
              // routeGeometry já está no formato [lat, lon] da função parsearRespostaRota
              let routeCoords = routeGeometry;

              // VERIFICAR SE A ROTA ESTÁ NA ORDEM CORRETA (primeiro → último)
              const primeiraPosicaoGPS = coordenadas[0];
              const ultimaPosicaoGPS = coordenadas[coordenadas.length - 1];
              const primeiroPontoRota = routeCoords[0];
              const ultimoPontoRota = routeCoords[routeCoords.length - 1];
              
              const distInicio = Math.sqrt(
                Math.pow(primeiroPontoRota[0] - primeiraPosicaoGPS[0], 2) + 
                Math.pow(primeiroPontoRota[1] - primeiraPosicaoGPS[1], 2)
              );
              const distFim = Math.sqrt(
                Math.pow(ultimoPontoRota[0] - ultimaPosicaoGPS[0], 2) + 
                Math.pow(ultimoPontoRota[1] - ultimaPosicaoGPS[1], 2)
              );
              
              // Se a rota está invertida, reverter
              if (distInicio > 0.01 && distFim < 0.01) {
                console.warn(`⚠️  ROTA INVERTIDA DETECTADA (poucos pontos)! Revertendo ordem...`);
                routeCoords = routeCoords.reverse();
              }
              
              // Garantir que a linha verde termine EXATAMENTE na última posição GPS
              const distanciaFinal = Math.sqrt(
                Math.pow(routeCoords[routeCoords.length - 1][0] - ultimaPosicaoGPS[0], 2) + 
                Math.pow(routeCoords[routeCoords.length - 1][1] - ultimaPosicaoGPS[1], 2)
              );
              
              if (distanciaFinal > 0.0001) {
                routeCoords[routeCoords.length - 1] = ultimaPosicaoGPS;
                console.log(`🟢 Ajustando fim da rota verde (poucos pontos) para última posição GPS exata`);
              }

              // Adicionar linha da rota seguindo as estradas
              if (linhaRastreamento) {
                mapaRastreamento.removeLayer(linhaRastreamento);
              }
              linhaRastreamento = L.polyline(routeCoords, {
                color: '#27ae60', // Verde para pontos já percorridos
                weight: 4,
                opacity: 0.8
              }).addTo(mapaRastreamento);
              
              console.log(`✅ Rota OSRM calculada! (${routeCoords.length} pontos conectando ${pontosParaRota.length} posições GPS)`);
            } else {
              // Tentar com servidor alternativo ou overview=full
              console.warn('⚠️  OSRM não retornou rota, tentando servidor alternativo...');
              const rotaUrlAlt = construirUrlRota(
                config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
                coordsStr,
                'full',
                'geojson'
              );
              
              try {
                const controllerAlt = new AbortController();
                const timeoutIdAlt = setTimeout(() => controllerAlt.abort(), 30000);
                const osrmResponseAlt = await fetchForcandoHTTP(rotaUrlAlt, { signal: controllerAlt.signal });
                clearTimeout(timeoutIdAlt);
                
                if (osrmResponseAlt.ok) {
                  const osrmDataAlt = await osrmResponseAlt.json();
                  const routeGeometryAlt = parsearRespostaRota(osrmDataAlt);
                  if (routeGeometryAlt && routeGeometryAlt.length > 0) {
                    // Garantir que a linha verde termine EXATAMENTE na última posição GPS
                    const ultimaPosicaoGPS = coordenadas[coordenadas.length - 1];
                    const ultimoPontoRota = routeGeometryAlt[routeGeometryAlt.length - 1];
                    
                    const distanciaFinal = Math.sqrt(
                      Math.pow(ultimoPontoRota[0] - ultimaPosicaoGPS[0], 2) + 
                      Math.pow(ultimoPontoRota[1] - ultimaPosicaoGPS[1], 2)
                    );
                    
                    if (distanciaFinal > 0.0001) {
                      routeGeometryAlt[routeGeometryAlt.length - 1] = ultimaPosicaoGPS;
                      console.log(`🟢 Ajustando fim da rota verde (servidor alt) para última posição GPS exata`);
                    }
                    
                    linhaRastreamento = L.polyline(routeGeometryAlt, {
                      color: '#27ae60', // Verde para pontos já percorridos
                      weight: 4,
                      opacity: 0.8
                    }).addTo(mapaRastreamento);
                    console.log(`✅ Rota calculada com servidor alternativo (verde - pontos já percorridos)! (${routeGeometryAlt.length} pontos)`);
                  } else {
                    console.error('❌ ERRO: Servidor alternativo também não retornou rota válida');
                  }
                } else {
                  console.error('❌ ERRO: Servidor alternativo retornou erro');
                }
              } catch (err) {
                console.error('❌ ERRO: Falha ao tentar servidor alternativo:', err);
              }
            }
          } else {
            // Tentar servidor alternativo se o principal falhou
            console.warn('⚠️  Erro ao calcular rota OSRM, tentando servidor alternativo...');
            const rotaUrlAlt = construirUrlRota(
              config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
              coordsStr,
              'full',
              'geojson'
            );
            
            try {
              const controllerAlt = new AbortController();
              const timeoutIdAlt = setTimeout(() => controllerAlt.abort(), 30000);
              const osrmResponseAlt = await fetchForcandoHTTP(rotaUrlAlt, { signal: controllerAlt.signal });
              clearTimeout(timeoutIdAlt);
              
              if (osrmResponseAlt.ok) {
                const osrmDataAlt = await osrmResponseAlt.json();
              const routeGeometryAlt = parsearRespostaRota(osrmDataAlt);
              if (routeGeometryAlt && routeGeometryAlt.length > 0) {
                let routeCoordsAltCatch = routeGeometryAlt;
                
                // VERIFICAR SE A ROTA ESTÁ NA ORDEM CORRETA (primeiro → último)
                const primeiraPosicaoGPS = coordenadas[0];
                const ultimaPosicaoGPS = coordenadas[coordenadas.length - 1];
                const primeiroPontoRota = routeCoordsAltCatch[0];
                const ultimoPontoRota = routeCoordsAltCatch[routeCoordsAltCatch.length - 1];
                
                const distInicio = Math.sqrt(
                  Math.pow(primeiroPontoRota[0] - primeiraPosicaoGPS[0], 2) + 
                  Math.pow(primeiroPontoRota[1] - primeiraPosicaoGPS[1], 2)
                );
                const distFim = Math.sqrt(
                  Math.pow(ultimoPontoRota[0] - ultimaPosicaoGPS[0], 2) + 
                  Math.pow(ultimoPontoRota[1] - ultimaPosicaoGPS[1], 2)
                );
                
                // Se a rota está invertida, reverter
                if (distInicio > 0.01 && distFim < 0.01) {
                  console.warn(`⚠️  ROTA INVERTIDA DETECTADA (servidor alt - catch)! Revertendo ordem...`);
                  routeCoordsAltCatch = routeCoordsAltCatch.reverse();
                }
                
                // Garantir que a linha verde termine EXATAMENTE na última posição GPS
                const distanciaFinal = Math.sqrt(
                  Math.pow(routeCoordsAltCatch[routeCoordsAltCatch.length - 1][0] - ultimaPosicaoGPS[0], 2) + 
                  Math.pow(routeCoordsAltCatch[routeCoordsAltCatch.length - 1][1] - ultimaPosicaoGPS[1], 2)
                );
                
                if (distanciaFinal > 0.0001) {
                  routeCoordsAltCatch[routeCoordsAltCatch.length - 1] = ultimaPosicaoGPS;
                  console.log(`🟢 Ajustando fim da rota verde (servidor alt - catch) para última posição GPS exata`);
                }
                
                linhaRastreamento = L.polyline(routeCoordsAltCatch, {
                  color: '#27ae60', // Verde para pontos já percorridos
                  weight: 4,
                  opacity: 0.8
                }).addTo(mapaRastreamento);
                console.log(`✅ Rota calculada com servidor alternativo (verde - pontos já percorridos)! (${routeCoordsAltCatch.length} pontos)`);
                } else {
                  console.error('❌ ERRO: Servidor alternativo não retornou rota válida');
                }
              } else {
                console.error('❌ ERRO: Servidor alternativo retornou erro HTTP');
              }
            } catch (err) {
              console.error('❌ ERRO: Falha ao tentar servidor alternativo:', err);
            }
          }
        }
      } catch (osrmErr) {
        console.error('❌ ERRO CRÍTICO ao calcular rota OSRM:', osrmErr);
        console.error('   Verifique se o servidor de roteamento está acessível');
      }
    }

    // Buscar e exibir origem/destino e rota planejada
    let coordsOrigem = null;
    let coordsDestino = null;
    let todasCoordenadas = [...coordenadas];

    if (dadosViagem && dadosViagem.ORIGEM_CIDADE && dadosViagem.DESTINO_CIDADE) {
      try {
        // Limpar espaços dos estados (pode vir "PR " em vez de "PR")
        const origemEstado = (dadosViagem.ORIGEM_ESTADO || '').trim();
        const destinoEstado = (dadosViagem.DESTINO_ESTADO || '').trim();
        const origemCidade = (dadosViagem.ORIGEM_CIDADE || '').trim();
        const destinoCidade = (dadosViagem.DESTINO_CIDADE || '').trim();
        
        console.log(`🗺️ [MAPA RASTREAMENTO] Valores limpos:`, {
          origem: `${origemCidade}/${origemEstado}`,
          destino: `${destinoCidade}/${destinoEstado}`
        });
        
        // Obter coordenadas de origem e destino
        const [coordsOrigemTemp, coordsDestinoTemp] = await Promise.all([
          obterCoordenadasCidade(origemCidade, origemEstado),
          obterCoordenadasCidade(destinoCidade, destinoEstado)
        ]);

        if (coordsOrigemTemp && coordsDestinoTemp) {
          coordsOrigem = coordsOrigemTemp;
          coordsDestino = coordsDestinoTemp;

          // Adicionar origem e destino às coordenadas para ajustar o zoom
          todasCoordenadas.push([coordsOrigem.lat, coordsOrigem.lon]);
          todasCoordenadas.push([coordsDestino.lat, coordsDestino.lon]);

          // Calcular rota real usando OSRM/ORS
          try {
            const coordsStr = `${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}`;
            const rotaUrl = construirUrlRota(
              config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
              coordsStr,
              'full',
              'geojson'
            );
            const osrmResponse = await fetchForcandoHTTP(rotaUrl, {
              signal: AbortSignal.timeout(15000)
            });

            if (osrmResponse.ok) {
              const osrmData = await osrmResponse.json();
              const routeCoords = parsearRespostaRota(osrmData);
              if (routeCoords && routeCoords.length > 0) {
                console.log(`✅ [MAPA RASTREAMENTO] Rota planejada calculada com ${routeCoords.length} pontos`);

                // Adicionar linha da rota planejada (origem -> destino)
                linhaRotaPlanejada = L.polyline(routeCoords, {
                  color: '#95a5a6',
                  weight: 3,
                  opacity: 0.6,
                  dashArray: '10, 10'
                }).addTo(mapaRastreamento);
                console.log(`✅ [MAPA RASTREAMENTO] Linha da rota planejada adicionada ao mapa`);
              } else {
                console.warn(`⚠️ [MAPA RASTREAMENTO] Rota OSRM retornou 0 pontos`);
              }
            } else {
              console.warn(`⚠️ [MAPA RASTREAMENTO] Erro ao calcular rota OSRM: ${osrmResponse.status}`);
            }
          } catch (osrmErr) {
            console.warn('⚠️ [MAPA RASTREAMENTO] Erro ao calcular rota OSRM:', osrmErr);
            // Se OSRM falhar, desenhar linha reta como fallback
            console.log(`🔄 [MAPA RASTREAMENTO] Desenhando linha reta como fallback`);
            linhaRotaPlanejada = L.polyline(
              [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]],
              {
                color: '#95a5a6',
                weight: 3,
                opacity: 0.6,
                dashArray: '10, 10'
              }
            ).addTo(mapaRastreamento);
            console.log(`✅ [MAPA RASTREAMENTO] Linha reta (fallback) adicionada ao mapa`);
          }
        } else {
          console.warn(`⚠️ [MAPA RASTREAMENTO] Coordenadas inválidas! Origem: ${coordsOrigemTemp ? 'OK' : 'FALHOU'}, Destino: ${coordsDestinoTemp ? 'OK' : 'FALHOU'}`);
        }
      } catch (err) {
        console.error('❌ [MAPA RASTREAMENTO] Erro ao obter coordenadas:', err);
      }
    } else {
      console.warn(`⚠️ [MAPA RASTREAMENTO] Dados da viagem incompletos:`, {
        temDadosViagem: !!dadosViagem,
        temOrigem: !!(dadosViagem && dadosViagem.ORIGEM_CIDADE),
        temDestino: !!(dadosViagem && dadosViagem.DESTINO_CIDADE)
      });
    }

    // Calcular e desenhar rota da última posição GPS até o destino (VERMELHA)
    // Isso deve ser feito independentemente de ter dados completos da viagem, desde que tenha posições GPS e destino
    if (posicoesOrdenadas && posicoesOrdenadas.length > 0 && coordsDestino) {
      const ultimaPosicao = posicoesOrdenadas[posicoesOrdenadas.length - 1];
      const ultimaLat = parseFloat(ultimaPosicao.LATITUDE);
      const ultimaLon = parseFloat(ultimaPosicao.LONGITUDE);
      
      console.log(`🔴 Calculando rota restante: última posição GPS → destino...`);
      
      try {
              const coordsStrRestante = `${ultimaLon},${ultimaLat};${coordsDestino.lon},${coordsDestino.lat}`;
              const rotaUrlRestante = construirUrlRota(
                config.osrmServer || 'https://router.project-osrm.org/route/v1/driving-hgv',
                coordsStrRestante,
                'full',
                'geojson'
              );
              
        const osrmResponseRestante = await fetchForcandoHTTP(rotaUrlRestante, {
          signal: AbortSignal.timeout(20000)
        });
        
        if (osrmResponseRestante.ok) {
          const osrmDataRestante = await osrmResponseRestante.json();
          const routeCoordsRestante = parsearRespostaRota(osrmDataRestante);
          
          if (routeCoordsRestante && routeCoordsRestante.length > 0) {
            // Garantir que a linha vermelha comece EXATAMENTE na última posição GPS
            // O OSRM pode retornar uma rota que começa antes da última posição GPS (ex: na origem)
            // Precisamos encontrar o ponto mais próximo da última posição GPS e remover tudo antes dele
            let routeCoordsRestanteFinal = [...routeCoordsRestante];
            
            // Encontrar o índice do ponto mais próximo da última posição GPS
            let indiceInicio = 0;
            let menorDistancia = Infinity;
            
            for (let i = 0; i < routeCoordsRestanteFinal.length; i++) {
              const ponto = routeCoordsRestanteFinal[i];
              const distancia = Math.sqrt(
                Math.pow(ponto[0] - ultimaLat, 2) + 
                Math.pow(ponto[1] - ultimaLon, 2)
              );
              if (distancia < menorDistancia) {
                menorDistancia = distancia;
                indiceInicio = i;
              }
            }
            
            // Se encontrou um ponto próximo (dentro de ~100 metros), usar a partir dele
            // Caso contrário, usar toda a rota mas garantir que comece na última posição GPS
            if (menorDistancia < 0.001) { // ~111 metros
              // Remover todos os pontos antes do ponto mais próximo
              routeCoordsRestanteFinal = routeCoordsRestanteFinal.slice(indiceInicio);
              console.log(`🔴 Removendo ${indiceInicio} pontos anteriores à última posição GPS`);
            }
            
            // Garantir que o primeiro ponto seja EXATAMENTE a última posição GPS
            if (routeCoordsRestanteFinal.length > 0) {
              routeCoordsRestanteFinal[0] = [ultimaLat, ultimaLon];
              console.log(`🔴 Garantindo que a rota vermelha comece na última posição GPS exata: [${ultimaLat}, ${ultimaLon}]`);
            }
            
            // Adicionar linha da rota restante (última posição → destino) em VERMELHO
            linhaRotaRestante = L.polyline(routeCoordsRestanteFinal, {
              color: '#e74c3c', // Vermelho
              weight: 4,
              opacity: 0.8,
              dashArray: '5, 5' // Linha tracejada para diferenciar
            }).addTo(mapaRastreamento);
            
            linhaRotaRestante.bindPopup(`
              <div style="min-width: 200px;">
                <strong>🔴 Rota Restante</strong><br>
                <strong>Última Posição GPS → Destino</strong><br>
                <strong>Distância restante:</strong> Calculando...
              </div>
            `);
            
            console.log(`✅ Rota restante calculada! (${routeCoordsRestante.length} pontos)`);
          } else {
            console.warn('⚠️  OSRM não retornou rota restante válida');
          }
        } else {
          // Tentar servidor alternativo
          console.warn('⚠️  Tentando servidor alternativo para rota restante...');
          const rotaUrlRestanteAlt = construirUrlRota(
            config.osrmServerAlt || 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
            coordsStrRestante,
            'full',
            'geojson'
          );
          
          try {
            const osrmResponseRestanteAlt = await fetchForcandoHTTP(rotaUrlRestanteAlt, {
              signal: AbortSignal.timeout(20000)
            });
            
            if (osrmResponseRestanteAlt.ok) {
              const osrmDataRestanteAlt = await osrmResponseRestanteAlt.json();
              const routeCoordsRestanteAlt = parsearRespostaRota(osrmDataRestanteAlt);
              
              if (routeCoordsRestanteAlt && routeCoordsRestanteAlt.length > 0) {
                // Garantir que a linha vermelha comece EXATAMENTE na última posição GPS
                // O OSRM pode retornar uma rota que começa antes da última posição GPS (ex: na origem)
                // Precisamos encontrar o ponto mais próximo da última posição GPS e remover tudo antes dele
                let routeCoordsRestanteAltFinal = [...routeCoordsRestanteAlt];
                
                // Encontrar o índice do ponto mais próximo da última posição GPS
                let indiceInicioAlt = 0;
                let menorDistanciaAlt = Infinity;
                
                for (let i = 0; i < routeCoordsRestanteAltFinal.length; i++) {
                  const ponto = routeCoordsRestanteAltFinal[i];
                  const distancia = Math.sqrt(
                    Math.pow(ponto[0] - ultimaLat, 2) + 
                    Math.pow(ponto[1] - ultimaLon, 2)
                  );
                  if (distancia < menorDistanciaAlt) {
                    menorDistanciaAlt = distancia;
                    indiceInicioAlt = i;
                  }
                }
                
                // Se encontrou um ponto próximo (dentro de ~100 metros), usar a partir dele
                // Caso contrário, usar toda a rota mas garantir que comece na última posição GPS
                if (menorDistanciaAlt < 0.001) { // ~111 metros
                  // Remover todos os pontos antes do ponto mais próximo
                  routeCoordsRestanteAltFinal = routeCoordsRestanteAltFinal.slice(indiceInicioAlt);
                  console.log(`🔴 Removendo ${indiceInicioAlt} pontos anteriores à última posição GPS (alt)`);
                }
                
                // Garantir que o primeiro ponto seja EXATAMENTE a última posição GPS
                if (routeCoordsRestanteAltFinal.length > 0) {
                  routeCoordsRestanteAltFinal[0] = [ultimaLat, ultimaLon];
                  console.log(`🔴 Garantindo que a rota vermelha (alt) comece na última posição GPS exata: [${ultimaLat}, ${ultimaLon}]`);
                }
                
                linhaRotaRestante = L.polyline(routeCoordsRestanteAltFinal, {
                  color: '#e74c3c',
                  weight: 4,
                  opacity: 0.8,
                  dashArray: '5, 5'
                }).addTo(mapaRastreamento);
                
                linhaRotaRestante.bindPopup(`
                  <div style="min-width: 200px;">
                    <strong>🔴 Rota Restante</strong><br>
                    <strong>Última Posição GPS → Destino</strong>
                  </div>
                `);
                
                console.log(`✅ Rota restante calculada com servidor alternativo!`);
              }
            }
          } catch (err) {
            console.warn('Erro ao calcular rota restante com servidor alternativo:', err);
          }
        }
      } catch (osrmErr) {
        console.warn('Erro ao calcular rota restante:', osrmErr);
      }
    }

    // Adicionar marcadores de origem e destino (se coordenadas foram obtidas)
    if (coordsOrigem && coordsDestino && dadosViagem) {
      // Adicionar marcador de origem
      marcadorOrigemRastreamento = L.marker([coordsOrigem.lat, coordsOrigem.lon], {
        icon: L.divIcon({
          className: 'custom-marker origem-rastreamento',
          html: '<div style="background: #2ecc71; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🏁</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapaRastreamento)
        .bindPopup(`
          <div style="min-width: 200px;">
            <strong>🏁 Origem</strong><br>
            <strong>Cidade:</strong> ${dadosViagem.ORIGEM_CIDADE}, ${dadosViagem.ORIGEM_ESTADO}<br>
            <strong>Coordenadas:</strong> ${coordsOrigem.lat.toFixed(6)}, ${coordsOrigem.lon.toFixed(6)}
          </div>
        `);

      // Adicionar marcador de destino
      marcadorDestinoRastreamento = L.marker([coordsDestino.lat, coordsDestino.lon], {
        icon: L.divIcon({
          className: 'custom-marker destino-rastreamento',
          html: '<div style="background: #e74c3c; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">🏁</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(mapaRastreamento)
        .bindPopup(`
          <div style="min-width: 200px;">
            <strong>🏁 Destino</strong><br>
            <strong>Cidade:</strong> ${dadosViagem.DESTINO_CIDADE}, ${dadosViagem.DESTINO_ESTADO}<br>
            <strong>Coordenadas:</strong> ${coordsDestino.lat.toFixed(6)}, ${coordsDestino.lon.toFixed(6)}
          </div>
        `);
    }

    // Adicionar marcadores (usar posicoesOrdenadas para garantir ordem cronológica)
    posicoesOrdenadas.forEach((pos, index) => {
      const lat = parseFloat(pos.LATITUDE);
      const lng = parseFloat(pos.LONGITUDE);
      const data = new Date(pos.DHREGISTRO);
      const velocidade = pos.VELOCIDADE ? `${parseFloat(pos.VELOCIDADE).toFixed(0)} km/h` : 'N/A';

      // Ícone diferente para primeira e última posição
      let iconColor = '#667eea';
      let iconSize = [12, 12];
      if (index === 0) {
        iconColor = '#27ae60'; // Verde para início
        iconSize = [16, 16];
      } else if (index === posicoesOrdenadas.length - 1) {
        iconColor = '#e74c3c'; // Vermelho para posição atual
        iconSize = [16, 16];
      }

      const icon = L.divIcon({
        className: 'marcador-rastreamento',
        html: `<div style="background: ${iconColor}; width: ${iconSize[0]}px; height: ${iconSize[1]}px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: iconSize,
        iconAnchor: [iconSize[0]/2, iconSize[1]/2]
      });

      const marcador = L.marker([lat, lng], { icon }).addTo(mapaRastreamento);
      
      marcador.bindPopup(`
        <div style="min-width: 200px;">
          <strong>${index === 0 ? '📍 Início' : index === posicoesOrdenadas.length - 1 ? '📍 Posição Atual' : `📍 Posição ${index + 1}`}</strong><br>
          <strong>Data/Hora:</strong> ${data.toLocaleString('pt-BR')}<br>
          <strong>Velocidade:</strong> ${velocidade}<br>
          <strong>Precisão:</strong> ${pos.PRECISAO ? pos.PRECISAO + 'm' : 'N/A'}<br>
          <strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}
        </div>
      `);

      marcadoresRastreamento.push(marcador);
    });

    // Ajustar zoom para mostrar toda a rota (GPS + origem/destino)
    if (todasCoordenadas.length > 0) {
      mapaRastreamento.fitBounds(todasCoordenadas, { padding: [50, 50] });
      
      // Invalidar tamanho do mapa para garantir renderização correta
      setTimeout(() => {
        if (mapaRastreamento) {
          mapaRastreamento.invalidateSize();
        }
      }, 100);
    }
    
    // Esconder overlay após finalizar mapa (com pequeno delay para garantir que tudo foi renderizado)
    setTimeout(() => {
      hideRastreamentoLoading();
    }, 300);
    } catch (err) {
      console.error('❌ [RASTREAMENTO] Erro ao exibir mapa:', err);
      // Esconder overlay em caso de erro
      hideRastreamentoLoading();
    } finally {
      // Sempre resetar a flag, mesmo em caso de erro
      mapaRastreamentoInicializando = false;
    }
  }

  // Exibir lista de posições
  function exibirListaPosicoes(posicoes) {
    const lista = document.getElementById('listaPosicoes');
    if (!lista) return;

    if (!posicoes || posicoes.length === 0) {
      lista.innerHTML = '<p style="text-align: center; color: #6c757d; padding: 20px;">Nenhuma posição encontrada.</p>';
      return;
    }

    let html = '<div style="display: flex; flex-direction: column; gap: 8px;">';
    
    // Ordenar do mais recente para o mais antigo
    const posicoesOrdenadas = [...posicoes].reverse();

    posicoesOrdenadas.forEach((pos, index) => {
      const data = new Date(pos.DHREGISTRO);
      const velocidade = pos.VELOCIDADE ? parseFloat(pos.VELOCIDADE).toFixed(0) : '0';
      const isUltima = index === 0;
      const isPrimeira = index === posicoesOrdenadas.length - 1;

      let corBorda = '#dee2e6';
      let corFundo = '#ffffff';
      if (isUltima) {
        corBorda = '#e74c3c';
        corFundo = '#fff5f5';
      } else if (isPrimeira) {
        corBorda = '#27ae60';
        corFundo = '#f0fff4';
      }

      html += `
        <div style="background: ${corFundo}; border: 1px solid ${corBorda}; border-left: 4px solid ${corBorda}; border-radius: 6px; padding: 12px; cursor: pointer; transition: all 0.2s;"
             onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'; this.style.transform='translateX(2px)';"
             onmouseout="this.style.boxShadow='none'; this.style.transform='translateX(0)';"
             onclick="if(window.mapaRastreamento && window.marcadoresRastreamento && window.marcadoresRastreamento[${posicoes.length - 1 - index}]) { window.marcadoresRastreamento[${posicoes.length - 1 - index}].openPopup(); window.mapaRastreamento.setView([${pos.LATITUDE}, ${pos.LONGITUDE}], 15); }">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
            <div style="flex: 1;">
              <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">
                ${isUltima ? '🏁 Última' : isPrimeira ? '📍 Primeira' : `📍 #${posicoes.length - index}`}
              </div>
              <div style="font-size: 12px; color: #6c757d;">
                ${data.toLocaleString('pt-BR', { 
                  day: '2-digit', 
                  month: '2-digit', 
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit'
                })}
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-weight: 600; color: #667eea; font-size: 14px;">${velocidade} km/h</div>
            </div>
          </div>
          <div style="font-size: 11px; color: #95a5a6; margin-top: 4px;">
            ${parseFloat(pos.LATITUDE).toFixed(6)}, ${parseFloat(pos.LONGITUDE).toFixed(6)}
            ${pos.PRECISAO ? ` • ${pos.PRECISAO}m` : ''}
          </div>
        </div>
      `;
    });

    html += '</div>';
    lista.innerHTML = html;

    // Expor variáveis globalmente para uso no onclick
    window.mapaRastreamento = mapaRastreamento;
    window.marcadoresRastreamento = marcadoresRastreamento;
  }

  // Mostrar mensagem na aba de rastreamento
  function mostrarMensagemRastreamento(mensagem, tipo = 'info') {
    if (message) {
      message.textContent = mensagem;
      message.className = `message ${tipo}`;
      message.style.display = 'block';
      setTimeout(() => {
        message.style.display = 'none';
      }, 5000);
    }
  }

  // ==========================================
  // FUNÇÕES GLOBAIS PARA WEBSOCKET TORRE
  // Mapear eventos WebSocket para atualizações de UI
  // ==========================================

  /**
   * Atualizar posição GPS no mapa quando evento WebSocket chega
   * @param {number} idviagem - ID da viagem
   * @param {object} posicao - Dados da posição GPS
   */
  window.atualizarPosicaoGPS = async function(idviagem, posicao) {
    try {
      // Se estivermos na aba de rastreamento e a viagem for a mesma
      const abaAtiva = document.querySelector('.tab-content.active');
      if (abaAtiva && abaAtiva.id === 'rastreamento') {
        const viagemSelecionada = abaAtiva.getAttribute('data-idviagem') || 
                                 document.getElementById('rastreamentoIdViagem')?.textContent;
        
        if (viagemSelecionada && parseInt(viagemSelecionada) === parseInt(idviagem)) {
          // Recarregar posições para atualizar o mapa
          await carregarPosicoesRastreamento(idviagem);
          console.log('📍 Posição GPS atualizada via WebSocket');
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar posição GPS:', err);
    }
  };

  /**
   * Atualizar dados da viagem quando evento WebSocket chega
   * @param {number} idviagem - ID da viagem
   * @param {object} viagem - Dados atualizados da viagem
   */
  window.atualizarDadosViagem = async function(idviagem, viagem) {
    try {
      // Se estivermos vendo esta viagem, recarregar detalhes
      const viagemSelecionada = lastViagens?.find(v => v.IDVIAGEM == idviagem);
      
      if (viagemSelecionada) {
        // Atualizar dados no objeto lastViagens
        Object.assign(viagemSelecionada, viagem);
        
        // Se estivermos na aba de detalhes desta viagem, recarregar
      const abaAtiva = document.querySelector('.tab-content.active');
      if (abaAtiva && abaAtiva.id === 'detalhes') {
        const idViagemAtual = abaAtiva.getAttribute('data-idviagem') || 
                              document.getElementById('viagemId')?.value;
        if (idViagemAtual && parseInt(idViagemAtual) === parseInt(idviagem)) {
          // Recarregar detalhes da viagem
          if (typeof carregarDetalhesViagem === 'function') {
            await carregarDetalhesViagem(idviagem);
          } else {
            // Fallback: recarregar via fetch
            try {
              const response = await fetch(`/api/viagens/${idviagem}`);
              if (response.ok) {
                const dados = await response.json();
                // Atualizar campos do formulário se estiver aberto
                if (dados.IDVIAGEM) {
                  Object.keys(dados).forEach(key => {
                    const field = document.getElementById(key);
                    if (field) {
                      field.value = dados[key] || '';
                    }
                  });
                }
              }
            } catch (err) {
              console.warn('Erro ao recarregar detalhes:', err);
            }
          }
          console.log('🔄 Dados da viagem atualizados via WebSocket');
        }
      }
        
        // Se estivermos no grid, atualizar o card da viagem
        if (gridTab && typeof window.GridEditor !== 'undefined') {
          atualizarCardViagemNoGrid(idviagem, viagem);
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar dados da viagem:', err);
    }
  };

  /**
   * Atualizar card da viagem no grid
   */
  function atualizarCardViagemNoGrid(idviagem, novosDados) {
    if (!gridTab || typeof window.GridEditor === 'undefined') return;
    
    try {
      // Usar o método updateRow da instância do grid (método público do GridEditor)
      if (gridTab.updateRow && typeof gridTab.updateRow === 'function') {
        // Atualizar dados no grid usando o método da instância
        gridTab.updateRow(idviagem, novosDados);
        
        // Adicionar indicador visual de atualização recente
        const rowElement = gridTab.container?.querySelector(`[data-grid-id="${idviagem}"]`);
        if (rowElement) {
          rowElement.style.backgroundColor = '#e8f5e9';
          setTimeout(() => {
            rowElement.style.backgroundColor = '';
          }, 2000);
        }
      } else {
        // Fallback: encontrar linha manualmente e atualizar células
        const rowElement = gridTab.container?.querySelector(`[data-grid-id="${idviagem}"]`);
        if (rowElement) {
          // Atualizar células relevantes manualmente
          Object.keys(novosDados).forEach(key => {
            const cell = rowElement.querySelector(`[data-field="${key}"]`);
            if (cell) {
              // Atualizar conteúdo da célula usando formatação do grid
              const col = gridTab.columns?.find(c => c.field === key);
              if (col && gridTab.formatCellValue) {
                const formattedValue = gridTab.formatCellValue(novosDados[key], col);
                const cellValue = cell.querySelector('.cell-value');
                if (cellValue) {
                  cellValue.textContent = formattedValue;
                } else {
                  cell.textContent = formattedValue;
                }
              } else {
                const cellValue = cell.querySelector('.cell-value');
                if (cellValue) {
                  cellValue.textContent = String(novosDados[key] || '');
                } else {
                  cell.textContent = String(novosDados[key] || '');
                }
              }
            }
          });
          
          // Adicionar indicador visual
          rowElement.style.backgroundColor = '#e8f5e9';
          setTimeout(() => {
            rowElement.style.backgroundColor = '';
          }, 2000);
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar card no grid:', err);
    }
  }

  /**
   * Adicionar novo alerta quando evento WebSocket chega
   * @param {object} alerta - Dados do alerta
   */
  window.adicionarAlerta = async function(alerta) {
    try {
      // Aba de alertas foi removida - apenas mostrar notificação
      if (alerta.SEVERITY === 'high') {
        showMessage(`⚠️ Novo alerta crítico: ${alerta.MESSAGE || 'Alerta importante'}`, 'warning');
      }
      console.log('⚠️ Novo alerta recebido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar alerta:', err);
    }
  };

  /**
   * Remover alerta resolvido quando evento WebSocket chega
   * @param {number} idAlerta - ID do alerta resolvido
   */
  window.removerAlerta = async function(idAlerta) {
    try {
      // Aba de alertas foi removida - apenas log
      console.log('✅ Alerta resolvido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar remoção de alerta:', err);
    }
  };

  /**
   * Notificar SOS quando evento WebSocket chega
   * @param {object} sos - Dados do alerta SOS
   */
  window.notificarSOS = function(sos) {
    try {
      // Mostrar notificação urgente
      showMessage(`🆘 ALERTA SOS: ${sos.NOME_MOTORISTA || 'Motorista'} - Viagem ${sos.CDVIAGEM || ''}`, 'error');
      
      // Tocar som de alerta (se permitido)
      try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBzSL0fPTgjMGHm7A7+OZURA');
        audio.volume = 0.5;
        audio.play().catch(() => {
          // Ignorar erro se autoplay não for permitido
        });
      } catch (e) {
        // Ignorar erro de áudio
      }
      
      console.log('🆘 Alerta SOS recebido via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao notificar SOS:', err);
    }
  };

  /**
   * Atualizar reputação do motorista quando evento WebSocket chega
   * @param {number} cdmotorista - ID do motorista
   * @param {object} reputacao - Dados da reputação
   */
  window.atualizarReputacaoMotorista = async function(cdmotorista, reputacao) {
    try {
      // Aba de ranking foi removida - apenas log
      console.log('⭐ Reputação atualizada via WebSocket (aba removida - usar módulo separado)');
    } catch (err) {
      console.error('Erro ao processar atualização de reputação:', err);
    }
  };

  /**
   * Atualizar grid de viagens quando evento WebSocket chega
   * @param {array} viagens - Lista atualizada de viagens
   */
  window.atualizarGridViagens = function(viagens) {
    try {
      // Se estivermos no grid, atualizar dados
      const abaAtiva = document.querySelector('.tab-content.active');
      if (abaAtiva && abaAtiva.id === 'grid') {
        // Atualizar lastViagens
        lastViagens = viagens;
        
        // Atualizar grid se estiver visível
        if (gridTab && typeof window.GridEditor !== 'undefined') {
          // Recarregar grid (pode ser custoso, então apenas se necessário)
          console.log('📋 Grid de viagens atualizado via WebSocket');
        }
      }
    } catch (err) {
      console.error('Erro ao atualizar grid:', err);
    }
  };

  /**
   * Acompanhar viagem automaticamente quando abrir detalhes/mapa
   * Chamar esta função quando uma viagem for selecionada
   */
  window.ativarAcompanhamentoViagem = function(idviagem) {
    if (typeof window.WebSocketTorre !== 'undefined' && idviagem) {
      window.WebSocketTorre.acompanharViagem(idviagem);
    }
  };

  /**
   * Parar de acompanhar viagem
   * Chamar esta função quando sair da viagem
   */
  window.desativarAcompanhamentoViagem = function(idviagem) {
    if (typeof window.WebSocketTorre !== 'undefined' && idviagem) {
      window.WebSocketTorre.pararAcompanharViagem(idviagem);
    }
  };

  // Funções globais de atualização UI (WebSocket Torre) carregadas

  // Função para mostrar ajuda
  // Função de ajuda
  window.mostrarAjudaViagens = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaViagens');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaViagens';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Viagens</h3>
          <button onclick="window.fecharModalAjudaViagens()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Viagens</strong> permite gerenciar todas as viagens do sistema, incluindo criação, edição, convocações, rastreamento e integração com plataformas externas.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar viagens específicas por ID, tipo, situação, classe de frota, contratador, origem, destino, datas e status.</p>
          
          <h4>📝 Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar viagens por diversos critérios</li>
            <li><strong>Grid:</strong> Visualizar todas as viagens em formato de tabela editável com ordenação e filtros</li>
            <li><strong>Dados:</strong> Criar ou editar viagens, definindo origem, destino, roteiro, distância, valores e configurações</li>
            <li><strong>Histórico:</strong> Consultar o histórico completo de viagens com filtros avançados</li>
            <li><strong>Mapa:</strong> Visualizar a rota da viagem no mapa com pontos de origem e destino</li>
            <li><strong>Compatíveis:</strong> Encontrar motoristas compatíveis para a viagem selecionada</li>
            <li><strong>Convocações:</strong> Criar e gerenciar convocações para motoristas, com envio via WhatsApp</li>
            <li><strong>Veículo:</strong> Associar veículos às viagens com busca por placa ou código</li>
            <li><strong>Motorista:</strong> Associar motoristas às viagens com busca por CPF, nome ou código</li>
            <li><strong>Rastreamento:</strong> Acompanhar a localização em tempo real do veículo/motorista</li>
            <li><strong>Integração Meta:</strong> Gerenciar integrações com plataformas Meta (Facebook/Instagram)</li>
          </ul>
          
          <h4>🚛 Convocações</h4>
          <ul>
            <li>Selecione uma viagem e encontre motoristas compatíveis</li>
            <li>Crie convocações e envie automaticamente via WhatsApp</li>
            <li>Acompanhe o status das convocações (Pendente, Aceita, Confirmada, etc.)</li>
            <li>Confirme convocações aceitas e reative quando necessário</li>
          </ul>
          
          <h4>📏 Cálculo de Distância</h4>
          <ul>
            <li>O sistema calcula automaticamente a distância usando pontos do roteiro ou rota real (OSRM)</li>
            <li>É possível recalcular manualmente clicando no botão "Calcular Distância"</li>
            <li>A distância pode ser calculada pela rota real ou aproximada (linha reta)</li>
          </ul>
          
          <h4>🗺️ Visualização no Mapa</h4>
          <ul>
            <li>Visualize a rota completa da viagem no mapa</li>
            <li>Veja pontos de origem e destino marcados</li>
            <li>Calcule distâncias e visualize o percurso</li>
          </ul>
          
          <h4>⚡ Rastreamento em Tempo Real</h4>
          <ul>
            <li>O sistema utiliza WebSocket para atualizações em tempo real</li>
            <li>Acompanhe a localização do veículo/motorista durante a viagem</li>
            <li>Receba alertas e notificações automáticas</li>
          </ul>
          
          <h4>✨ Dicas</h4>
          <ul>
            <li>Para criar uma nova viagem, clique em "Novo Registro" na aba Grid ou Dados</li>
            <li>Para editar uma viagem existente, clique no botão de editar (✎) na coluna Ações do grid</li>
            <li>Após criar uma viagem, use a aba "Compatíveis" para encontrar motoristas adequados</li>
            <li>Use a aba "Convocações" para enviar convites aos motoristas via WhatsApp</li>
            <li>A aba "Rastreamento" permite acompanhar a viagem em tempo real</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaViagens()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaViagens = function() {
    const modal = document.getElementById('modalAjudaViagens');
    if (modal) {
      modal.remove();
    }
  };

})();