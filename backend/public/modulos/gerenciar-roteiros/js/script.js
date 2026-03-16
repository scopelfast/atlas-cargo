// backend/public/modulos/gerenciar-roteiros/js/script.js
// Gerenciar Roteiros - Frontend
// Versão: 1.3 - Campo RESUMOROTA e otimizações
// Atlas Cargo
// Data: 2026-01-13
// Última atualização: 
//   - Adicionado campo RESUMOROTA com geração automática
//   - Implementada função gerarResumoRota() usando OSRM e Nominatim
//   - Otimizações de performance (processamento sequencial, retry logic)
//   - Correções de bugs (sintaxe, filtros, rate limiting)
//   - i18n: helper t() e chaves web.modulos.roteiros

(function() {
  // Helper e overlay dentro do IIFE para permitir recarregar o módulo ao trocar de tela (evita "Identifier 't' has already been declared").
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  if (typeof window.overlayMostrado === 'undefined') {
    window.overlayMostrado = false;
  }
  function getOverlayMostrado() {
    if (typeof window.overlayMostrado === 'undefined') {
      window.overlayMostrado = false;
    }
    return window.overlayMostrado;
  }

  // Elementos
  const tabs = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const filtroForm = document.getElementById('filtroForm');
  const roteiroForm = document.getElementById('roteiroForm');
  const list = document.getElementById('roteirosList');
  const message = document.getElementById('message');
  const modal = document.getElementById('confirmModal');
  
  let cidadesOrigem = [];
  let cidadesDestino = [];
  let mapa = null;
  let marcadorOrigem = null;
  let marcadorDestino = null;
  let linhaRota = null;
  
  // Variáveis para pontos
  let gridPontos = null;
  let pontosRoteiro = [];
  let roteiroAtualId = null;
  let marcadoresPontos = [];
  let linhasPontos = [];
  let atualizandoMapaComPontos = false; // Flag para evitar múltiplas execuções simultâneas
  
  // Variáveis para Grid
  let gridTab = null;
  let lastRoteiros = null;
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

  // Funções genéricas para controlar overlay de loading genérico
  function showCalculandoOverlay(titulo = 'Processando...', texto = 'Por favor, aguarde...', detalhe = 'Isso pode levar alguns segundos.') {
    const overlay = document.getElementById('calculandoOverlay');
    const overlayTitulo = document.getElementById('calculandoOverlayTitulo');
    const overlayTexto = document.getElementById('calculandoOverlayTexto');
    const overlayDetalhe = document.getElementById('calculandoOverlayDetalhe');
    
    if (overlay) {
      // Atualizar textos se os elementos existirem
      if (overlayTitulo) overlayTitulo.textContent = titulo;
      if (overlayTexto) overlayTexto.textContent = texto;
      if (overlayDetalhe) overlayDetalhe.textContent = detalhe;
      
      // Garantir que o overlay está visível com z-index alto
      overlay.style.display = 'flex';
      overlay.style.zIndex = '99999';
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      
      console.log('✅ Overlay de carregamento exibido:', titulo);
    } else {
      console.warn('⚠️ Overlay calculandoOverlay não encontrado no DOM!');
    }
  }

  function hideCalculandoOverlay() {
    const overlay = document.getElementById('calculandoOverlay');
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
      const response = await fetch('/modulos/gerenciar-roteiros/sql/init.sql');
      
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
        execResponse = await fetch('/api/roteiros/executar-init-sql', {
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
              'já há',
              'duplicate key',
              'PRIMARY KEY constraint',
              'violation of primary key',
              'chave primária'
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
    await showTab('filtros');
    await loadPaises();
    
    // Adicionar event listeners após o DOM estar pronto
    // Usar delegação de eventos para garantir que funcione mesmo se o elemento for recriado
    const roteiroForm = document.getElementById('roteiroForm');
    if (roteiroForm) {
      roteiroForm.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btnGerarResumo') {
          e.preventDefault();
          e.stopPropagation();
          console.log('🔘 Botão Gerar Resumo clicado (via delegação)');
          try {
            gerarResumoRota(e);
          } catch (err) {
            console.error('❌ Erro ao chamar gerarResumoRota:', err);
          }
        }
      });
      console.log('✅ Event listener (delegação) adicionado ao formulário para btnGerarResumo');
    }
    
    // Também adicionar diretamente ao botão se existir
    const btnGerarResumo = document.getElementById('btnGerarResumo');
    if (btnGerarResumo) {
      // Verificar se a função existe
      if (typeof gerarResumoRota === 'function') {
        console.log('✅ Função gerarResumoRota está disponível');
      } else {
        console.error('❌ Função gerarResumoRota NÃO está disponível!');
      }
      
      btnGerarResumo.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('🔘 Botão Gerar Resumo clicado (direto)');
        console.log('🔍 Tipo de gerarResumoRota:', typeof gerarResumoRota);
        
        if (typeof gerarResumoRota === 'function') {
          try {
            gerarResumoRota(e);
          } catch (err) {
            console.error('❌ Erro ao chamar gerarResumoRota:', err);
          }
        } else {
          console.error('❌ gerarResumoRota não é uma função!');
          alert('Erro: Função gerarResumoRota não está disponível. Recarregue a página.');
        }
      });
      console.log('✅ Event listener (direto) adicionado ao botão Gerar Resumo');
    } else {
      console.warn('⚠️ Botão btnGerarResumo não encontrado ao inicializar');
    }
  }

  // Inicialização - tentar imediatamente e também no DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM já está pronto, executar imediatamente
    init();
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
      } else {
        carregarNovoScript();
      }
    });
  }

  // Inicializar GridEditor
  function inicializarGridTab() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Roteiros] GridEditor não está disponível');
      return;
    }

    gridTab = new window.GridEditor({
      container: '#roteirosGrid',
      columns: [
        { field: 'IDROTEIRO', header: 'Código', editable: false, isId: true, width: '100px' },
        { field: 'DSROTEIRO', header: 'Descrição', editable: true, type: 'text' },
        { field: 'ORIGEM_ESTADO', header: 'Origem UF', editable: false },
        { field: 'ORIGEM_CIDADE', header: 'Origem', editable: false },
        { field: 'DESTINO_ESTADO', header: 'Destino UF', editable: false },
        { field: 'DESTINO_CIDADE', header: 'Destino', editable: false },
        { field: 'DISTANCIAKM', header: 'Distância (km)', editable: true, type: 'number',
          format: (val) => val ? parseFloat(val).toFixed(2) : '-'
        },
        { field: 'FGACTIVE', header: 'Situação', editable: true, type: 'select', width: '120px', align: 'right',
          options: [
            { value: 'S', label: 'Ativo' },
            { value: 'N', label: 'Inativo' }
          ],
          format: (val) => val === 'S' ? '✓ Ativo' : '✗ Inativo'
        }
      ],
      apiEndpoint: '/api/roteiros',
      onBeforeEdit: async (id) => {
        // Mostrar overlay de cálculo
        mostrarCalculandoOverlay();
        try {
          await loadRoteiroParaEdicao(id);
        } finally {
          // Esconder overlay ao finalizar
          esconderCalculandoOverlay();
        }
        return false; // Cancelar edição inline, usar formulário
      },
      onDelete: async (id) => {
        await confirmarExclusao(id);
      }
    });
  }

  // Função para mudar abas
  async function showTab(tabId) {
    try {
      if (!tabId) {
        console.warn('[showTab] tabId não fornecido, usando "filtros" como padrão');
        tabId = 'filtros';
      }
      
      const tabContent = document.getElementById(`tab-${tabId}`);
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
      
      if (!tabBtn) {
        console.error(`[showTab] Botão da aba "${tabId}" não encontrado`);
        return;
      }
      if (!tabContent) {
        console.error(`[showTab] Conteúdo da aba "${tabId}" não encontrado`);
        return;
      }
      
      const container = tabContent.closest('[class*="-container"]') || tabContent.parentElement;
      if (container) {
        container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        container.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
      }
      tabBtn.classList.add('active');
      tabContent.classList.add('active');
    
    // Se for a aba de grid, inicializar o GridEditor
    if (tabId === 'grid') {
      try {
        // GridEditor já está carregado no HTML, não precisa carregar novamente
        if (typeof window.GridEditor !== 'undefined') {
          if (!gridTab) {
            inicializarGridTab();
          }
          // Sempre renderizar, mesmo se não houver dados (grid vazio)
          const roteirosParaRenderizar = lastRoteiros || [];
          if (gridTab) {
            gridTab.render(roteirosParaRenderizar);
          } else if (roteirosParaRenderizar.length === 0) {
            // Se não há dados e grid não está inicializado, aplicar filtros para buscar
            // Mas não bloquear a mudança de aba
            setTimeout(() => {
              applyFilters('grid').catch(err => {
                console.warn('[Roteiros] Erro ao aplicar filtros automaticamente:', err);
              });
            }, 100);
          }
        } else {
          console.warn('[Roteiros] GridEditor não está disponível. Recarregue a página.');
        }
      } catch (gridErr) {
        console.error('[Roteiros] Erro ao inicializar grid:', gridErr);
      }
    }
    
    // Se mudou para aba de pontos, carregar pontos se houver roteiro selecionado
    if (tabId === 'pontos') {
      // Tentar obter o ID do roteiro de diferentes fontes (prioridade: roteiroAtualId > roteiroId > roteiroCodigo)
      let idRoteiroParaCarregar = roteiroAtualId;
      
      // Se não tem roteiroAtualId, tentar obter do campo oculto (mais confiável)
      if (!idRoteiroParaCarregar) {
        const roteiroIdHidden = document.getElementById('roteiroId');
        if (roteiroIdHidden && roteiroIdHidden.value) {
          const valor = roteiroIdHidden.value.trim();
          if (valor && valor !== 'null' && valor !== 'undefined' && valor !== '') {
            idRoteiroParaCarregar = valor;
          }
        }
      }
      
      // Se ainda não tem, tentar obter do campo código (readonly)
      if (!idRoteiroParaCarregar) {
        const roteiroCodigo = document.getElementById('roteiroCodigo');
        if (roteiroCodigo && roteiroCodigo.value) {
          const valor = roteiroCodigo.value.trim();
          if (valor && valor !== 'null' && valor !== 'undefined' && valor !== '') {
            idRoteiroParaCarregar = valor;
          }
        }
      }
      
      // Se encontrou um ID, carregar os pontos
      if (idRoteiroParaCarregar) {
        // Atualizar roteiroAtualId para manter consistência
        roteiroAtualId = idRoteiroParaCarregar;
        await carregarPontos(idRoteiroParaCarregar);
      } else {
        // Se não encontrou, mostrar mensagem apropriada
        const pontosGrid = document.getElementById('pontosGrid');
        if (pontosGrid) {
          pontosGrid.innerHTML = '<p class="empty">' + t('web.modulos.roteiros.selecioneRoteiroPontos') + '</p>';
        }
        const pontosTitle = document.getElementById('pontosTitle');
        if (pontosTitle) {
          pontosTitle.textContent = t('web.modulos.roteiros.pontosDoRoteiro');
        }
        const btnNovoPonto = document.getElementById('btnNovoPonto');
        const btnVoltarPontos = document.getElementById('btnVoltarPontos');
        const btnCalcularPontos = document.getElementById('btnCalcularDistanciaPontos');
        
        if (btnNovoPonto) btnNovoPonto.style.display = 'none';
        if (btnVoltarPontos) btnVoltarPontos.style.display = 'none';
        if (btnCalcularPontos) {
          btnCalcularPontos.disabled = true;
          btnCalcularPontos.style.opacity = '0.5';
        }
        
        if (gridPontos) {
          gridPontos.render([]);
        }
      }
    }
    
    if (tabId === 'mapa' && roteiroAtualId) {
      console.log('[MAPA] Aba Mapa ativada com roteiroAtualId=', roteiroAtualId, '→ inicializando mapa e atualizarMapaComPontos()');
      if (typeof L !== 'undefined' && !mapa) {
        await inicializarMapa();
      }
      if (!atualizandoMapaComPontos && mapa) {
        await atualizarMapaComPontos();
      }
    }
    } catch (err) {
      console.error(`[showTab] Erro ao mudar para aba "${tabId}":`, err);
      // Em caso de erro, tentar voltar para a aba de filtros
      try {
        const filtrosBtn = document.querySelector('.tab-btn[data-tab="filtros"]');
        const filtrosContent = document.getElementById('tab-filtros');
        if (filtrosBtn && filtrosContent) {
          const container = filtrosContent.closest('[class*="-container"]') || filtrosContent.parentElement;
          if (container) {
            container.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
            container.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
          }
          filtrosBtn.classList.add('active');
          filtrosContent.classList.add('active');
        }
      } catch (fallbackErr) {
        console.error('[showTab] Erro ao voltar para aba de filtros:', fallbackErr);
      }
    }
  }

  // Carregar países (filtros, formulário Dados e combo ponto no mapa)
  async function loadPaises() {
    try {
      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/paises') : '/api/paises';
      const response = await fetch(base);
      if (!response.ok) throw new Error('Erro ao carregar países');
      const paises = await response.json();
      if (!Array.isArray(paises)) return;
      const fillPais = (id, useShortLabel = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        const textoPadrao = (id.startsWith('filtro')) ? 'Todos' : 'Selecione';
        el.innerHTML = `<option value="">${textoPadrao}</option>`;
        paises.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p.CDPAIS ?? p.cdpais;
          opt.textContent = useShortLabel ? (p.DSPAIS || '') : ((p.SGPAIS || p.CDPAIS) + ' - ' + (p.DSPAIS || ''));
          el.appendChild(opt);
        });
      };
      fillPais('filtroOrigemPais');
      fillPais('filtroDestinoPais');
      fillPais('origemPais');
      fillPais('destinoPais');
      fillPais('pontoPais', true);
      // Resetar combos de estado nos filtros (estados só após selecionar país)
      const filtroOrigemEstado = document.getElementById('filtroOrigemEstado');
      const filtroDestinoEstado = document.getElementById('filtroDestinoEstado');
      if (filtroOrigemEstado) filtroOrigemEstado.innerHTML = '<option value="">Todos</option>';
      if (filtroDestinoEstado) filtroDestinoEstado.innerHTML = '<option value="">Todos</option>';
    } catch (err) {
      console.error('Erro ao carregar países:', err);
      showMessage(err.message || 'Erro ao carregar países.', 'error');
    }
  }

  // Handler para mudança de país no filtro (origem ou destino) — carrega estados e limpa seleção
  async function handleFiltroPaisChange() {
    const id = this.id;
    const cdpais = this.value;
    if (id === 'filtroOrigemPais') {
      await loadEstadosParaPais(cdpais, 'filtroOrigemEstado');
      const el = document.getElementById('filtroOrigemEstado');
      if (el) el.value = '';
    } else if (id === 'filtroDestinoPais') {
      await loadEstadosParaPais(cdpais, 'filtroDestinoEstado');
      const el = document.getElementById('filtroDestinoEstado');
      if (el) el.value = '';
    }
  }

  // Carregar estados de um país e preencher um select (origem/destino ou filtro)
  async function loadEstadosParaPais(cdpais, targetSelectId) {
    const el = document.getElementById(targetSelectId);
    if (!el) return;
    const textoPadrao = (targetSelectId.startsWith('filtro')) ? 'Todos' : 'Selecione o país primeiro';
    el.innerHTML = `<option value="">${textoPadrao}</option>`;
    if (!cdpais) return;
    try {
      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/estados') : '/api/estados';
      const response = await fetch(`${base}?cdpais=${encodeURIComponent(cdpais)}`);
      if (!response.ok) return;
      const estados = await response.json();
      if (!Array.isArray(estados)) return;
      const padrao = (targetSelectId.startsWith('filtro')) ? 'Todos' : 'Selecione';
      el.innerHTML = `<option value="">${padrao}</option>`;
      estados.forEach(e => {
        const opt = document.createElement('option');
        const uf = e.ESTADO ?? e.estado ?? e.PAIS_SIGLA;
        const nome = e.NMESTADO ?? e.nmestado ?? uf;
        opt.value = uf;
        opt.textContent = `${uf} - ${nome}`;
        el.appendChild(opt);
      });
    } catch (err) {
      console.error('Erro ao carregar estados:', err);
    }
  }

  // Carregar cidades por país e estado
  async function loadCidadesPorEstado(estado, tipo) {
    if (!estado) return;
    const paisEl = tipo === 'origem' ? document.getElementById('origemPais') : document.getElementById('destinoPais');
    const cdpais = paisEl?.value;
    const params = new URLSearchParams({ estado });
    if (cdpais) params.append('pais', cdpais);
    try {
      const base = typeof window.corrigirUrl === 'function' ? window.corrigirUrl('/api/cidades') : '/api/cidades';
      const response = await fetch(`${base}?${params.toString()}`);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
      }
      
      const cidades = await response.json();
      
      // Verificar se cidades é um array válido
      if (!Array.isArray(cidades)) {
        console.error('Resposta da API não é um array:', cidades);
        showMessage('Erro: resposta inválida do servidor ao carregar cidades.', 'error');
        return;
      }
      
      if (tipo === 'origem') {
        cidadesOrigem = cidades;
        const cidadeSelect = document.getElementById('origemCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
        }
      } else {
        cidadesDestino = cidades;
        const cidadeSelect = document.getElementById('destinoCidade');
        if (cidadeSelect) {
          cidadeSelect.innerHTML = '<option value="">Selecione</option>';
          cidades.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.CDCIDADE;
            opt.textContent = c.NMCIDADE;
            cidadeSelect.appendChild(opt);
          });
        }
      }
    } catch (err) {
      console.error('Erro ao carregar cidades:', err);
      showMessage(err.message || 'Erro ao carregar cidades. Verifique a conexão.', 'error');
    }
  }

  // Funções para controlar overlay de carregamento dos filtros
  function showLoadingFiltros() {
    const overlay = document.getElementById('calculandoOverlay');
    if (overlay) {
      const titleEl = overlay.querySelector('h3');
      const textEl = overlay.querySelector('p');
      if (titleEl) titleEl.textContent = t('web.modulos.roteiros.aplicandoFiltros');
      if (textEl) textEl.textContent = t('web.modulos.roteiros.buscandoRoteiros');
      overlay.style.display = 'flex';
    }
  }

  function hideLoadingFiltros() {
    const overlay = document.getElementById('calculandoOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  // Aplicar filtros
  async function applyFilters(openTab = 'grid') {
    const params = new URLSearchParams();
    const codigo = document.getElementById('filtroCodigo')?.value;
    const descricao = document.getElementById('filtroDescricao')?.value;
    const origemPais = document.getElementById('filtroOrigemPais')?.value;
    const origemEstado = document.getElementById('filtroOrigemEstado')?.value;
    const origemCidade = document.getElementById('filtroOrigemCidade')?.value;
    const destinoPais = document.getElementById('filtroDestinoPais')?.value;
    const destinoEstado = document.getElementById('filtroDestinoEstado')?.value;
    const destinoCidade = document.getElementById('filtroDestinoCidade')?.value;
    
    if (codigo) params.append('codigo', codigo);
    if (descricao) params.append('descricao', descricao);
    if (origemPais) params.append('origemPais', origemPais);
    if (origemEstado) params.append('origemEstado', origemEstado);
    if (origemCidade) params.append('origemCidade', origemCidade);
    if (destinoPais) params.append('destinoPais', destinoPais);
    if (destinoEstado) params.append('destinoEstado', destinoEstado);
    if (destinoCidade) params.append('destinoCidade', destinoCidade);
    
    const queryString = params.toString();
    const urlFiltro = `/api/roteiros?${queryString}`;
    console.log('[FILTRO] Parâmetros enviados:', { codigo, descricao, origemPais, origemEstado, origemCidade, destinoPais, destinoEstado, destinoCidade });
    console.log('[FILTRO] URL da requisição:', urlFiltro || '(vazio = sem filtros)');
    
    showLoadingFiltros();
    
    try {
      const response = await fetch(urlFiltro);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
      }
      
      const roteiros = await response.json();

      // Verificar se roteiros é um array válido
      if (!Array.isArray(roteiros)) {
        console.error('Resposta da API não é um array:', roteiros);
        showMessage('Erro: resposta inválida do servidor.', 'error');
        hideLoadingFiltros();
        return;
      }

      // Armazenar roteiros para o Grid
      lastRoteiros = roteiros;

      // Atualizar contador
      const countEl = document.getElementById('roteirosGridCountText');
      if (countEl) {
        const count = roteiros.length || 0;
        countEl.textContent = count + ' ' + (t('web.modulos.roteiros.registrosEncontrados').replace(/^0\s*/, ''));
      }
      
      // Renderizar no Grid se estiver aberto
      if (gridTab) {
        gridTab.render(roteiros);
      } else if (openTab === 'grid') {
        // Se o GridEditor não está disponível, tentar carregar
        if (typeof window.GridEditor === 'undefined') {
          console.warn('[Roteiros] GridEditor não está disponível. Tentando carregar...');
          try {
            await loadScript('/js/grid-editor.js');
          } catch (e) {
            console.error('[Roteiros] Erro ao carregar GridEditor:', e);
          }
        }
        
        // Aguardar GridEditor estar disponível (aumentar tempo de espera)
        let tentativas = 0;
        while (typeof window.GridEditor === 'undefined' && tentativas < 30) {
          await new Promise(resolve => setTimeout(resolve, 100));
          tentativas++;
        }
        
        if (typeof window.GridEditor !== 'undefined') {
          // GridEditor está disponível, inicializar se necessário
          if (!gridTab) {
            inicializarGridTab();
          }
          if (gridTab) {
            gridTab.render(roteiros);
          }
        } else {
          console.warn('[Roteiros] GridEditor não está disponível após aguardar.');
        }
      }
      
      // IMPORTANTE: Sempre mudar para a aba solicitada, mesmo se houver problemas com o grid
      await showTab(openTab);
    } catch (err) {
      console.error('Erro ao aplicar filtros:', err);
      showMessage(err.message || 'Erro ao carregar roteiros.', 'error');
      // Mesmo em caso de erro, tentar mudar para a aba solicitada
      try {
        await showTab(openTab);
      } catch (tabErr) {
        console.error('[applyFilters] Erro ao mudar para aba após erro:', tabErr);
      }
    } finally {
      // Sempre esconder overlay ao finalizar
      hideLoadingFiltros();
    }
  }

  // Renderizar lista
  function renderList(roteiros) {
    if (!roteiros || roteiros.length === 0) {
      list.innerHTML = '<p class="empty">' + t('web.modulos.roteiros.nenhumRoteiroEncontrado') + '</p>';
      return;
    }

    list.innerHTML = roteiros.map(r => {
      const id = r.IDROTEIRO ?? r.idroteiro;
      const desc = r.DSROTEIRO ?? r.dsroteiro ?? '';
      const oEst = r.ORIGEM_ESTADO ?? r.origem_estado ?? '';
      const oCid = r.ORIGEM_CIDADE ?? r.origem_cidade ?? '';
      const dEst = r.DESTINO_ESTADO ?? r.destino_estado ?? '';
      const dCid = r.DESTINO_CIDADE ?? r.destino_cidade ?? '';
      const dist = r.DISTANCIAKM ?? r.distanciakm;
      return `
      <div class="list-item" data-id="${id}">
        <div>
          <strong>${id} - ${desc}</strong>
          <small>
            <strong>Origem:</strong> ${oEst} - ${oCid}<br>
            <strong>Destino:</strong> ${dEst} - ${dCid}<br>
            <strong>Distância:</strong> ${dist != null ? dist + ' km' : 'Não informada'}
          </small>
        </div>
        <div class="actions">
          <button class="btn edit" data-id="${id}">Editar</button>
          <button class="btn delete" data-id="${id}">Excluir</button>
        </div>
      </div>
    `;
    }).join('');

    // Eventos de edição e exclusão - apenas para botões da lista (não do modal)
    document.querySelectorAll('.list-item .btn.edit, .list-item .btn.delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        // Ignorar se o clique veio de dentro do modal
        if (e.target.closest('#confirmModal') || e.currentTarget.closest('#confirmModal')) {
          return;
        }
        
        // Ignorar se o botão está dentro do modal
        if (e.currentTarget.id === 'confirmYes' || e.currentTarget.id === 'confirmNo') {
          return;
        }
        
        // Tentar obter o ID de várias formas
        let id = e.currentTarget.dataset?.id || 
                 e.currentTarget.getAttribute('data-id') ||
                 e.target.closest('[data-id]')?.dataset?.id ||
                 e.target.closest('[data-id]')?.getAttribute('data-id');
        
        // Se ainda não encontrou, tentar do elemento pai
        if (!id) {
          const parent = e.currentTarget.closest('[data-id]');
          if (parent) {
            id = parent.dataset?.id || parent.getAttribute('data-id');
          }
        }
        
        // Validar ID
        if (id && id !== 'null' && id !== 'undefined' && id !== '' && id !== 'NaN') {
          if (e.currentTarget.classList.contains('edit')) {
            loadRoteiroParaEdicao(id);
          } else if (e.currentTarget.classList.contains('delete')) {
            confirmarExclusao(id);
          }
        } else {
          // Só logar se realmente for um botão da lista (não do modal)
          if (!e.currentTarget.id || (e.currentTarget.id !== 'confirmYes' && e.currentTarget.id !== 'confirmNo')) {
            console.warn('[Roteiros] ID inválido ao clicar no botão:', id, 'Elemento:', e.currentTarget);
          }
        }
      });
    });
  }

  // Carregar roteiro para edição
  // Funções para gerenciar overlay de cálculo
  function mostrarCalculandoOverlay() {
    const overlay = document.getElementById('calculandoOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
    }
  }

  function esconderCalculandoOverlay() {
    const overlay = document.getElementById('calculandoOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

async function loadRoteiroParaEdicao(id) {
  try {
    const roteiroForm = document.getElementById('roteiroForm');
    if (roteiroForm) {
      roteiroForm.reset();
    }
    // Garantir que os combos de país estão populados antes de setar valor (evita estado vazio ao editar)
    await loadPaises();
    
    const response = await fetch(`/api/roteiros/${id}`);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
      throw new Error(errorData.error || `Erro ${response.status}: ${response.statusText}`);
    }
    
    const roteiro = await response.json();
    // Normalizar chaves (API pode retornar minúsculas pelo PostgreSQL)
    const idRoteiro = roteiro.IDROTEIRO ?? roteiro.idroteiro;
    const dsRoteiro = roteiro.DSROTEIRO ?? roteiro.dsroteiro;
    const distanciaKm = roteiro.DISTANCIAKM ?? roteiro.distanciakm;
    const origemCdpais = roteiro.ORIGEM_CDPAIS ?? roteiro.origem_cdpais;
    const destinoCdpais = roteiro.DESTINO_CDPAIS ?? roteiro.destino_cdpais;
    const origemEstadoVal = (roteiro.ORIGEM_ESTADO ?? roteiro.origem_estado) ?? '';
    const destinoEstadoVal = (roteiro.DESTINO_ESTADO ?? roteiro.destino_estado) ?? '';
    const origemCidadeCod = roteiro.CDCIDADEORIGEM ?? roteiro.cdcidadeorigem;
    const destinoCidadeCod = roteiro.CDCIDADEDESTINO ?? roteiro.cdcidadedestino;
    const resumoRota = roteiro.RESUMOROTA ?? roteiro.resumorota;

    if (roteiro) {
      document.getElementById('roteiroId').value = idRoteiro ?? '';
      document.getElementById('roteiroCodigo').value = idRoteiro ?? '';
      document.getElementById('roteiroDescricao').value = dsRoteiro ?? '';
      document.getElementById('roteiroDistancia').value = distanciaKm ?? '';
      document.getElementById('formTitle').textContent = t('web.modulos.roteiros.editarRoteiro');
      
      const campoResumo = document.getElementById('roteiroResumoRota');
      if (campoResumo) campoResumo.value = resumoRota ?? '';
      
      const btnGerarResumo = document.getElementById('btnGerarResumo');
      if (btnGerarResumo) {
        btnGerarResumo.disabled = false;
        btnGerarResumo.style.opacity = '1';
        btnGerarResumo.style.pointerEvents = 'auto';
        btnGerarResumo.style.cursor = 'pointer';
      }

      if (origemCdpais != null && origemCdpais !== '') {
        document.getElementById('origemPais').value = String(origemCdpais);
        await loadEstadosParaPais(origemCdpais, 'origemEstado');
      }
      if (destinoCdpais != null && destinoCdpais !== '') {
        document.getElementById('destinoPais').value = String(destinoCdpais);
        await loadEstadosParaPais(destinoCdpais, 'destinoEstado');
      }

      const origemEstado = String(origemEstadoVal).trim().toUpperCase();
      const destinoEstado = String(destinoEstadoVal).trim().toUpperCase();
      const selOrigemEstado = document.getElementById('origemEstado');
      const selDestinoEstado = document.getElementById('destinoEstado');
      // Garantir que o estado atual exista no combo (ex.: Paraguai pode não ter estados na API)
      if (origemEstado && selOrigemEstado && !Array.from(selOrigemEstado.options).some(o => o.value === origemEstado)) {
        const opt = document.createElement('option');
        opt.value = origemEstado;
        opt.textContent = origemEstado;
        selOrigemEstado.appendChild(opt);
      }
      if (destinoEstado && selDestinoEstado && !Array.from(selDestinoEstado.options).some(o => o.value === destinoEstado)) {
        const opt = document.createElement('option');
        opt.value = destinoEstado;
        opt.textContent = destinoEstado;
        selDestinoEstado.appendChild(opt);
      }
      if (selOrigemEstado) selOrigemEstado.value = origemEstado;
      if (selDestinoEstado) selDestinoEstado.value = destinoEstado;

      await loadCidadesPorEstado(origemEstado, 'origem');
      await loadCidadesPorEstado(destinoEstado, 'destino');

      if (origemCidadeCod != null) {
        document.getElementById('origemCidade').value = String(origemCidadeCod);
        document.getElementById('origemCodigo').value = origemCidadeCod;
      }
      if (destinoCidadeCod != null) {
        document.getElementById('destinoCidade').value = String(destinoCidadeCod);
        document.getElementById('destinoCodigo').value = destinoCidadeCod;
      }
      
      roteiroAtualId = idRoteiro;
      
      await carregarPontos(idRoteiro, true);

      // NÃO recalcular automaticamente - só calcular quando o usuário clicar em "Calcular"
      // await recalcularTodasDistancias(roteiro.IDROTEIRO); // REMOVIDO - cálculo só manual

      // Aguardar um pouco para garantir que os selects foram atualizados
      await new Promise(resolve => setTimeout(resolve, 300));

      showTab('dados');

      // Pré-inicializar mapa em background se houver origem e destino (para carregamento rápido)
      const origemCidadeId = document.getElementById('origemCidade')?.value;
      const destinoCidadeId = document.getElementById('destinoCidade')?.value;
      if (origemCidadeId && destinoCidadeId && typeof L !== 'undefined' && !mapa) {
        inicializarMapa().catch(err => {
          console.warn('Erro ao pré-inicializar mapa:', err);
        });
      }

      // NÃO atualizar mapa automaticamente - só atualizar quando o usuário visualizar a aba Mapa
      // const mapaContainer = document.getElementById('mapaContainer');
      // if (mapaContainer && mapaContainer.style.display !== 'none') {
      //   await atualizarMapa();
      // }
    }
  } catch (err) {
    console.error('Erro ao carregar roteiro:', err);
    showMessage(t('web.modulos.roteiros.erroCarregarDados'), 'error');
  }
}

  // Confirmar exclusão/desativação (padrão do sistema)
  async function confirmarExclusao(id) {
    // Validação robusta do ID
    let idValido = id;
    if (idValido == null || idValido === 'undefined' || idValido === 'null' || idValido === '' || idValido === 'NaN') {
      showMessage(t('web.modulos.roteiros.erroIdIndisponivel'), 'error');
      return;
    }
    
    // Converter para string para garantir consistência
    idValido = String(idValido).trim();
    
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    const modalEl = document.getElementById('confirmModal');
    
    if (!modalMessage || !confirmYes || !confirmNo || !modalEl) {
      return;
    }
    
    try {
      // Buscar o status atual do roteiro
      const idToCheck = isNaN(idValido) ? idValido : parseFloat(idValido);
      const response = await fetch(`/api/roteiros/${idToCheck}`);
      if (!response.ok) {
        throw new Error('Erro ao buscar roteiro');
      }
      
      const roteiro = await response.json();
      const estaAtivo = (roteiro.FGACTIVE || 'S') === 'S';
      
      // Definir mensagem e ação baseado no status atual (padrão: só a pergunta)
      let confirmMsg, action, btnText;
      if (estaAtivo) {
        confirmMsg = 'Tem certeza que deseja desativar este roteiro?';
        action = 'deactivate';
        btnText = 'Desativar';
      } else {
        confirmMsg = 'Tem certeza que deseja reativar este roteiro?';
        action = 'activate';
        btnText = 'Reativar';
      }
      
      modalMessage.textContent = confirmMsg;
      
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
          showMessage(t('web.modulos.roteiros.erroIdIndisponivel'), 'error');
          modalEl.style.display = 'none';
          return;
        }
        
        try {
          const response = await fetch(`/api/roteiros/${idParaExcluir}?action=${acao}`, {
            method: 'DELETE'
          });
          const data = await response.json();
          
          if (response.ok) {
            showMessage(data.message || (acao === 'activate' ? 'Roteiro reativado com sucesso!' : 'Roteiro desativado com sucesso!'), 'success');
            // Garantir que está na aba Grid e recarregar dados
            showTab('grid');
            applyFilters('grid');
          } else {
            showMessage(data.error || 'Erro ao alterar status do roteiro.', 'error');
          }
        } catch (err) {
          console.error('[Roteiros] Erro ao alterar status:', err);
          showMessage(t('web.modulos.roteiros.erroConexao'), 'error');
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
      console.error('[Roteiros] Erro ao buscar status do roteiro:', err);
      showMessage('Erro ao verificar status do roteiro.', 'error');
    }
  }

  // Função para criar automaticamente pontos de origem e destino
  async function criarPontosOrigemDestino(idRoteiro, origemCidadeId, destinoCidadeId) {
    try {
      // Buscar informações das cidades
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);
      
      if (!origemCidade || !destinoCidade) {
        console.warn('Não foi possível encontrar informações das cidades');
        return false;
      }
      
      const origemEstado = document.getElementById('origemEstado')?.value;
      const destinoEstado = document.getElementById('destinoEstado')?.value;
      const origemPaisCod = document.getElementById('origemPais')?.value;
      const destinoPaisCod = document.getElementById('destinoPais')?.value;
      
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado, origemPaisCod),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado, destinoPaisCod)
      ]);
      
      await loadPaises();
      const paises = await fetch('/api/paises').then(r => r.ok ? r.json() : []);
      const brasil = paises.find(p => (p.DSPAIS || '').toLowerCase().includes('brasil')) || paises[0];
      const codigoPaisOrigem = origemPaisCod || (brasil ? brasil.CDPAIS : null);
      const codigoPaisDestino = destinoPaisCod || (brasil ? brasil.CDPAIS : null);
      
      // Validar se temos os dados necessários
      if (!origemCidade.NMCIDADE || !origemEstado || !destinoCidade.NMCIDADE || !destinoEstado) {
        console.warn('[Pontos] Dados incompletos para criar pontos:', {
          origem: { cidade: origemCidade.NMCIDADE, estado: origemEstado },
          destino: { cidade: destinoCidade.NMCIDADE, estado: destinoEstado }
        });
        return false;
      }
      
      const pontoOrigem = {
        ORDEM: 1,
        DSLOCAL: (origemCidade.NMCIDADE || 'Origem').trim(),
        DSPOSICAO: `${origemCidade.NMCIDADE}/${origemEstado}`.trim(),
        LATITUDE: coordsOrigem ? parseFloat(coordsOrigem.lat) : null,
        LONGITUDE: coordsOrigem ? parseFloat(coordsOrigem.lon) : null,
        TPLOCAL: 'O',
        KMENTREPONTOS: null,
        ESTADOPASSAGEM: (origemEstado || '').trim() || null,
        CDPAISPASSAGEM: codigoPaisOrigem
      };
      
      const pontoDestino = {
        ORDEM: 100,
        DSLOCAL: (destinoCidade.NMCIDADE || 'Destino').trim(),
        DSPOSICAO: `${destinoCidade.NMCIDADE}/${destinoEstado}`.trim(),
        LATITUDE: coordsDestino ? parseFloat(coordsDestino.lat) : null,
        LONGITUDE: coordsDestino ? parseFloat(coordsDestino.lon) : null,
        TPLOCAL: 'D',
        KMENTREPONTOS: null,
        ESTADOPASSAGEM: (destinoEstado || '').trim() || null,
        CDPAISPASSAGEM: codigoPaisDestino
      };
      
      // Validar que os campos obrigatórios estão preenchidos
      if (!pontoOrigem.DSLOCAL || !pontoOrigem.DSPOSICAO || !pontoDestino.DSLOCAL || !pontoDestino.DSPOSICAO) {
        console.error('[Pontos] Campos obrigatórios não preenchidos:', {
          origem: { local: pontoOrigem.DSLOCAL, posicao: pontoOrigem.DSPOSICAO },
          destino: { local: pontoDestino.DSLOCAL, posicao: pontoDestino.DSPOSICAO }
        });
        return false;
      }
      
      // Criar os pontos via API sequencialmente para evitar conflitos
      // Primeiro criar o ponto de origem
      const responseOrigem = await fetch(`/api/roteiros/${idRoteiro}/pontos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pontoOrigem)
      });
      
      if (!responseOrigem.ok) {
        const errorData = await responseOrigem.json().catch(() => ({}));
        console.error('[Pontos] Erro ao criar ponto de origem:', errorData, 'Dados enviados:', pontoOrigem);
        return false;
      }
      
      // Aguardar um pouco antes de criar o segundo ponto
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Depois criar o ponto de destino
      const responseDestino = await fetch(`/api/roteiros/${idRoteiro}/pontos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pontoDestino)
      });
      
      if (!responseDestino.ok) {
        const errorData = await responseDestino.json().catch(() => ({}));
        console.error('[Pontos] Erro ao criar ponto de destino:', errorData, 'Dados enviados:', pontoDestino);
        // Se o destino falhou, mas a origem foi criada, retornar false mas informar
        showMessage('Ponto de origem criado, mas houve erro ao criar o ponto de destino. Crie manualmente na aba Pontos.', 'error');
        return false;
      }
      
      return true;
    } catch (err) {
      console.error('Erro ao criar pontos de origem e destino:', err);
      return false;
    }
  }

  let roteiroFormSubmitting = false;
  roteiroForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (roteiroFormSubmitting) return;
    roteiroFormSubmitting = true;
    const btnSubmit = roteiroForm?.querySelector('button[type="submit"]');
    const labelOriginal = btnSubmit?.innerHTML ?? '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<i class=\'bx bx-loader-alt bx-spin\'></i> ' + t('web.modulos.roteiros.salvando');
    }
    const id = document.getElementById('roteiroId')?.value; // 👈 Usa o campo oculto
    const descricao = document.getElementById('roteiroDescricao')?.value.trim();
    const origemCidade = document.getElementById('origemCidade')?.value;
    const destinoCidade = document.getElementById('destinoCidade')?.value;
    const distancia = document.getElementById('roteiroDistancia')?.value;
    
    if (!descricao || !origemCidade || !destinoCidade) {
      showMessage(t('web.modulos.roteiros.preenchaCampos'), 'error');
      roteiroFormSubmitting = false;
      if (btnSubmit) { btnSubmit.disabled = false; btnSubmit.innerHTML = labelOriginal; }
      return;
    }

    try {
      // Obter resumo da rota do campo
      const resumoRota = document.getElementById('roteiroResumoRota')?.value?.trim() || null;
      
      const roteiroData = {
        DSROTEIRO: descricao,
        CDCIDADEORIGEM: parseInt(origemCidade),
        CDCIDADEDESTINO: parseInt(destinoCidade),
        DISTANCIAKM: distancia ? parseFloat(distancia) : null,
        RESUMOROTA: resumoRota
      };

      let response;
      let novoRoteiro = false;
      let idRoteiroSalvo = null;
      
      if (id) {
        // Atualizar roteiro existente
        response = await fetch(`/api/roteiros/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roteiroData)
        });
        idRoteiroSalvo = id;
      } else {
        // Criar novo roteiro
        novoRoteiro = true;
        response = await fetch('/api/roteiros', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(roteiroData)
        });
      }

      const data = await response.json();
      if (response.ok) {
        // Se for novo roteiro, obter ID da resposta da API ou por busca
        if (novoRoteiro) {
          if (data && (data.IDROTEIRO != null || data.idRoteiro != null)) {
            idRoteiroSalvo = data.IDROTEIRO ?? data.idRoteiro;
          }
          if (!idRoteiroSalvo) {
            await new Promise(resolve => setTimeout(resolve, 300));
            const roteirosResponse = await fetch(`/api/roteiros?descricao=${encodeURIComponent(descricao)}`);
            if (roteirosResponse.ok) {
              const roteiros = await roteirosResponse.json();
              const roteiroCorreto = roteiros.find(r => 
                r.CDCIDADEORIGEM === parseInt(origemCidade) && 
                r.CDCIDADEDESTINO === parseInt(destinoCidade)
              );
              if (roteiroCorreto) {
                idRoteiroSalvo = roteiroCorreto.IDROTEIRO;
              } else if (roteiros.length > 0) {
                const roteiroMaisRecente = roteiros.sort((a, b) => b.IDROTEIRO - a.IDROTEIRO)[0];
                idRoteiroSalvo = roteiroMaisRecente.IDROTEIRO;
              }
            }
          }
          
          if (idRoteiroSalvo) {
            // Verificar se já existem pontos para este roteiro
            const pontosResponse = await fetch(`/api/roteiros/${idRoteiroSalvo}/pontos`);
            const pontosExistentes = pontosResponse.ok ? await pontosResponse.json() : [];
            
            if (pontosExistentes.length === 0) {
              // Criar automaticamente pontos de origem e destino
              showMessage('Criando pontos de origem e destino automaticamente...', 'success');
              const pontosCriados = await criarPontosOrigemDestino(idRoteiroSalvo, origemCidade, destinoCidade);
              
              if (pontosCriados) {
                // Atualizar o ID no formulário e carregar o roteiro
                document.getElementById('roteiroId').value = idRoteiroSalvo;
                document.getElementById('roteiroCodigo').value = idRoteiroSalvo;
                roteiroAtualId = idRoteiroSalvo;
                
                // Carregar pontos e redirecionar para aba Pontos
                await carregarPontos(idRoteiroSalvo);
                showMessage('Roteiro salvo! Pontos de origem e destino criados automaticamente. Complete o cadastro na aba Pontos.', 'success');
                showTab('pontos');
                return;
              } else {
                showMessage('Roteiro salvo! Por favor, cadastre os pontos de origem e destino na aba Pontos.', 'success');
                // Atualizar o ID no formulário
                document.getElementById('roteiroId').value = idRoteiroSalvo;
                document.getElementById('roteiroCodigo').value = idRoteiroSalvo;
                roteiroAtualId = idRoteiroSalvo;
                showTab('pontos');
                return;
              }
            } else {
              // Já existem pontos, ir para Grid normalmente
              showMessage(data.message || 'Salvo com sucesso!', 'success');
              showTab('grid');
              applyFilters('grid');
              return;
            }
          } else {
            // Não conseguiu obter o ID, ir para Grid
            showMessage(data.message || 'Salvo com sucesso!', 'success');
            showTab('grid');
            applyFilters('grid');
            return;
          }
        } else {
          // Roteiro existente - verificar se há pontos
          const pontosResponse = await fetch(`/api/roteiros/${idRoteiroSalvo || id}/pontos`);
          const pontosExistentes = pontosResponse.ok ? await pontosResponse.json() : [];
          
          if (pontosExistentes.length === 0) {
            // Não há pontos, redirecionar para aba Pontos
            showMessage(data.message || 'Salvo com sucesso! Complete o cadastro na aba Pontos.', 'success');
            roteiroAtualId = idRoteiroSalvo || id;
            showTab('pontos');
            return;
          } else {
            // Há pontos, ir para Grid normalmente
            showMessage(data.message || 'Salvo com sucesso!', 'success');
            showTab('grid');
            applyFilters('grid');
            return;
          }
        }
      } else {
        showMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar:', err);
      showMessage(t('web.modulos.roteiros.erroConexao'), 'error');
    } finally {
      setTimeout(() => {
        roteiroFormSubmitting = false;
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = labelOriginal;
        }
      }, 600);
    }
  });

  // Eventos
  filtroForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    applyFilters('grid'); // Ir para Grid após aplicar filtros
  });
  // Delegação: ao mudar país no filtro, carregar estados (fallback se init rodar antes do DOM)
  filtroForm?.addEventListener('change', function(e) {
    const t = e.target;
    if (t && (t.id === 'filtroOrigemPais' || t.id === 'filtroDestinoPais')) {
      handleFiltroPaisChange.call(t);
    }
  });

  // Eventos de abas
  tabs.forEach(btn => {
    btn.addEventListener('click', async () => {
      const tabId = btn.getAttribute('data-tab');
      await showTab(tabId);
    });
  });

  document.getElementById('btnLimparFiltros')?.addEventListener('click', () => {
    document.getElementById('filtroCodigo').value = '';
    document.getElementById('filtroDescricao').value = '';
    document.getElementById('filtroOrigemPais').value = '';
    document.getElementById('filtroDestinoPais').value = '';
    const fe = document.getElementById('filtroOrigemEstado');
    const fd = document.getElementById('filtroDestinoEstado');
    if (fe) fe.innerHTML = '<option value="">Todos</option>';
    if (fd) fd.innerHTML = '<option value="">Todos</option>';
    document.getElementById('filtroOrigemCidade').value = '';
    document.getElementById('filtroDestinoCidade').value = '';
  });

  function irParaNovoRoteiro() {
    roteiroForm?.reset();
    document.getElementById('roteiroId').value = '';
    document.getElementById('roteiroCodigo').value = '';
    document.getElementById('formTitle').textContent = t('web.modulos.roteiros.novoRoteiro');
    roteiroAtualId = null;
    // País já preenchido por loadPaises; estado e cidade dependem da seleção
    const oP = document.getElementById('origemPais');
    const dP = document.getElementById('destinoPais');
    if (oP) oP.value = '';
    if (dP) dP.value = '';
    const oE = document.getElementById('origemEstado');
    const dE = document.getElementById('destinoEstado');
    const oC = document.getElementById('origemCidade');
    const dC = document.getElementById('destinoCidade');
    if (oE) oE.innerHTML = '<option value="">Selecione o país primeiro</option>';
    if (dE) dE.innerHTML = '<option value="">Selecione o país primeiro</option>';
    if (oC) oC.innerHTML = '<option value="">Selecione um estado primeiro</option>';
    if (dC) dC.innerHTML = '<option value="">Selecione um estado primeiro</option>';
    document.getElementById('origemCodigo').value = '';
    document.getElementById('destinoCodigo').value = '';
    const btnGerarResumo = document.getElementById('btnGerarResumo');
    if (btnGerarResumo) {
      btnGerarResumo.disabled = true;
      btnGerarResumo.style.opacity = '0.5';
    }
    const campoResumo = document.getElementById('roteiroResumoRota');
    if (campoResumo) campoResumo.value = '';
    showTab('dados');
  }
  window.irParaNovoRoteiro = irParaNovoRoteiro;

  document.getElementById('btnVoltarFiltros')?.addEventListener('click', () => showTab('filtros'));
  document.getElementById('btnVoltarGrid')?.addEventListener('click', () => showTab('filtros'));
  document.getElementById('btnNovoRoteiroFiltros')?.addEventListener('click', irParaNovoRoteiro);
  document.getElementById('btnNovoRegistro')?.addEventListener('click', irParaNovoRoteiro);
  document.getElementById('btnNovoRegistroGrid')?.addEventListener('click', irParaNovoRoteiro);
  document.getElementById('btnCancelar')?.addEventListener('click', () => showTab('grid'));

  // País: ao mudar, recarregar estados e limpar estado/cidade
  document.getElementById('origemPais')?.addEventListener('change', function() {
    const cdpais = this.value;
    loadEstadosParaPais(cdpais, 'origemEstado');
    document.getElementById('origemEstado').value = '';
    document.getElementById('origemCidade').innerHTML = '<option value="">Selecione um estado primeiro</option>';
    document.getElementById('origemCidade').value = '';
    document.getElementById('origemCodigo').value = '';
  });
  document.getElementById('destinoPais')?.addEventListener('change', function() {
    const cdpais = this.value;
    loadEstadosParaPais(cdpais, 'destinoEstado');
    document.getElementById('destinoEstado').value = '';
    document.getElementById('destinoCidade').innerHTML = '<option value="">Selecione um estado primeiro</option>';
    document.getElementById('destinoCidade').value = '';
    document.getElementById('destinoCodigo').value = '';
  });
  // Filtro país → estado: listeners atribuídos em init() após loadPaises() para garantir que o DOM está pronto
  document.getElementById('origemEstado')?.addEventListener('change', function() {
    const estado = this.value;
    loadCidadesPorEstado(estado, 'origem');
    document.getElementById('origemCidade').value = '';
    document.getElementById('origemCodigo').value = '';
  });

  document.getElementById('origemCidade')?.addEventListener('change', function() {
    const cidadeId = this.value;
    const cidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === cidadeId);
    document.getElementById('origemCodigo').value = cidade ? cidade.CDCIDADE : '';
  });

  document.getElementById('destinoEstado')?.addEventListener('change', function() {
    const estado = this.value;
    loadCidadesPorEstado(estado, 'destino');
    document.getElementById('destinoCidade').value = '';
    document.getElementById('destinoCodigo').value = '';
  });

  document.getElementById('destinoCidade')?.addEventListener('change', function() {
    const cidadeId = this.value;
    const cidade = cidadesDestino.find(c => c.CDCIDADE.toString() === cidadeId);
    document.getElementById('destinoCodigo').value = cidade ? cidade.CDCIDADE : '';
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

  // Função para obter coordenadas de uma cidade usando API do backend (aceita cidade internacional com pais opcional)
  async function obterCoordenadasCidade(nomeCidade, estado, pais) {
    const label = `${nomeCidade}, ${estado}${pais ? ', país=' + pais : ''}`;
    try {
      const params = new URLSearchParams({
        cidade: nomeCidade,
        estado: estado
      });
      if (pais) params.append('pais', pais);
      
      const url = `/api/cidades/coordenadas?${params.toString()}`;
      console.log('[MAPA] Buscando coordenadas:', label, '→', url);
      const response = await fetch(url);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        console.warn('[MAPA] Coordenadas falharam para', label, '→', response.status, errorData);
        return null;
      }
      
      const data = await response.json();
      
      if (data.success && data.lat && data.lon) {
        console.log('[MAPA] Coordenadas OK:', label, '→', data.lat, data.lon);
        return {
          lat: data.lat,
          lon: data.lon
        };
      }
      
      if (data.success === false) {
        console.warn('[MAPA] API coordenadas success: false para', label, '→', data.error);
      } else {
        console.warn('[MAPA] Resposta coordenadas sem lat/lon para', label, '→', data);
      }
      return null;
    } catch (err) {
      console.error('[MAPA] Erro ao obter coordenadas para', label, err);
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

  // Função para calcular distância total considerando todos os pontos
  async function calcularDistancia() {
    const origemCidadeId = document.getElementById('origemCidade')?.value;
    const destinoCidadeId = document.getElementById('destinoCidade')?.value;
    const origemEstado = document.getElementById('origemEstado')?.value;
    const destinoEstado = document.getElementById('destinoEstado')?.value;
    const btnCalcular = document.getElementById('btnCalcularDistancia');
    const campoDistancia = document.getElementById('roteiroDistancia');
    const roteiroId = document.getElementById('roteiroId')?.value;

    // Validações básicas
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

    // Mostrar loading e overlay
    showCalculandoOverlay('Calculando Distância', 'Calculando a distância entre origem e destino...', 'Aguarde, isso pode levar alguns segundos.');
    if (btnCalcular && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnCalcular, true);
    }
    btnCalcular.disabled = true;

    try {
      let distanciaTotal = 0;
      
      // Se houver roteiro selecionado, recalcular todas as distâncias (entre pontos e total)
      if (roteiroId) {
        // Carregar pontos do roteiro se ainda não foram carregados
        if (pontosRoteiro.length === 0) {
          await carregarPontos(roteiroId);
        }
        
        // Filtrar pontos com coordenadas e ordenar por ORDEM
        const pontosComCoordenadas = pontosRoteiro
          .filter(p => p.LATITUDE && p.LONGITUDE)
          .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
        
        if (pontosComCoordenadas.length >= 2) {
          // Recalcular todas as distâncias (entre pontos e total) usando a função dedicada
          await recalcularTodasDistancias(roteiroId, false);
          
          // Opcional: Gerar resumo automaticamente após calcular distâncias
          // (comentado para não sobrecarregar - usuário pode clicar em "Gerar Resumo" manualmente)
          // await gerarResumoRota();
          
          btnCalcular.disabled = false;
          if (btnCalcular && typeof window.showLoading !== 'undefined') {
            window.showLoading(btnCalcular, false);
          }
          
          return;
        }
      }
      
      // Se não houver pontos cadastrados ou não houver roteiro, calcular apenas origem-destino
      // Buscar informações das cidades
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

      if (!origemCidade || !destinoCidade) {
        showMessage('Erro ao obter informações das cidades selecionadas.', 'error');
        return;
      }

      showMessage('Buscando coordenadas das cidades...', 'success');
      const origemPaisVal = document.getElementById('origemPais')?.value;
      const destinoPaisVal = document.getElementById('destinoPais')?.value;
      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado, origemPaisVal),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado, destinoPaisVal)
      ]);

      if (!coordsOrigem) {
        showMessage(`Não foi possível encontrar as coordenadas da cidade de origem: ${origemCidade.NMCIDADE}, ${origemEstado}. Verifique se o nome da cidade está correto.`, 'error');
        return;
      }

      if (!coordsDestino) {
        showMessage(`Não foi possível encontrar as coordenadas da cidade de destino: ${destinoCidade.NMCIDADE}, ${destinoEstado}. Verifique se o nome da cidade está correto.`, 'error');
        return;
      }

      // Tentar usar OSRM para rota real (com steps para obter rodovias)
      try {
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}?overview=full&geometries=geojson&steps=true`;
        const response = await fetch(osrmUrl);
        const data = await response.json();
        
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          distanciaTotal = (data.routes[0].distance / 1000).toFixed(2);
          if (campoDistancia) {
            campoDistancia.value = parseFloat(distanciaTotal);
          }
          
          // Se houver roteiro selecionado, salvar a distância no banco automaticamente
          if (roteiroId) {
            const descricao = document.getElementById('roteiroDescricao')?.value;
            const origemCidade = document.getElementById('origemCidade')?.value;
            const destinoCidade = document.getElementById('destinoCidade')?.value;
            
            if (descricao && origemCidade && destinoCidade) {
              try {
                const roteiroUpdateResponse = await fetch(`/api/roteiros/${roteiroId}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    DSROTEIRO: descricao,
                    CDCIDADEORIGEM: parseInt(origemCidade),
                    CDCIDADEDESTINO: parseInt(destinoCidade),
                    DISTANCIAKM: parseFloat(distanciaTotal)
                  })
                });
                
                if (roteiroUpdateResponse.ok) {
                  showMessage(`✅ Distância calculada e salva (rota real): ${distanciaTotal} km`, 'success');
                } else {
                  const errorData = await roteiroUpdateResponse.json().catch(() => ({}));
                  console.error('[Calcular] Erro ao salvar distância no banco:', errorData);
                  showMessage(`Distância calculada (rota real): ${distanciaTotal} km, mas houve erro ao salvar no banco`, 'warning');
                }
              } catch (err) {
                console.error('[Calcular] Erro ao salvar distância:', err);
                showMessage(`Distância calculada (rota real): ${distanciaTotal} km, mas houve erro ao salvar no banco`, 'warning');
              }
            } else {
              showMessage(`Distância calculada (rota real): ${distanciaTotal} km`, 'success');
            }
          } else {
            showMessage(`Distância calculada (rota real): ${distanciaTotal} km`, 'success');
          }
          
          // Resumo da rota será gerado apenas ao visualizar o mapa ou processar pontos
          // NÃO gerar aqui para evitar chamadas desnecessárias ao Nominatim
          
          btnCalcular.disabled = false;
          if (btnCalcular && typeof window.showLoading !== 'undefined') {
            window.showLoading(btnCalcular, false);
          }
          return;
        }
      } catch (osrmErr) {
        console.warn('Erro ao calcular rota real, usando linha reta:', osrmErr);
      }

      // Fallback: calcular distância em linha reta
      distanciaTotal = calcularDistanciaHaversine(
        coordsOrigem.lat,
        coordsOrigem.lon,
        coordsDestino.lat,
        coordsDestino.lon
      );

      // Preencher campo
      if (campoDistancia) {
        campoDistancia.value = distanciaTotal;
      }
      
      // Se houver roteiro selecionado, salvar a distância no banco automaticamente
      if (roteiroId) {
        const descricao = document.getElementById('roteiroDescricao')?.value;
        const origemCidade = document.getElementById('origemCidade')?.value;
        const destinoCidade = document.getElementById('destinoCidade')?.value;
        
        if (descricao && origemCidade && destinoCidade) {
          try {
            const roteiroUpdateResponse = await fetch(`/api/roteiros/${roteiroId}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                DSROTEIRO: descricao,
                CDCIDADEORIGEM: parseInt(origemCidade),
                CDCIDADEDESTINO: parseInt(destinoCidade),
                DISTANCIAKM: distanciaTotal
              })
            });
            
            if (roteiroUpdateResponse.ok) {
              showMessage(`✅ Distância calculada e salva (linha reta): ${distanciaTotal} km`, 'success');
            } else {
              const errorData = await roteiroUpdateResponse.json().catch(() => ({}));
              console.error('[Calcular] Erro ao salvar distância no banco:', errorData);
              showMessage(`Distância calculada (linha reta): ${distanciaTotal} km, mas houve erro ao salvar no banco`, 'warning');
            }
          } catch (err) {
            console.error('[Calcular] Erro ao salvar distância:', err);
            showMessage(`Distância calculada (linha reta): ${distanciaTotal} km, mas houve erro ao salvar no banco`, 'warning');
          }
        } else {
          showMessage(`Distância calculada (linha reta): ${distanciaTotal} km`, 'success');
        }
      } else {
        showMessage(`Distância calculada (linha reta): ${distanciaTotal} km`, 'success');
      }
      
      // Tentar buscar OSRM novamente apenas para obter geometria (mesmo que tenha falhado antes)
      // Isso é necessário para identificar cidades intermediárias
      let osrmDataParaResumo = null;
      let coordenadasParaResumo = [[coordsOrigem.lat, coordsOrigem.lon], [coordsDestino.lat, coordsDestino.lon]];
      
      try {
        const osrmUrlResumo = `https://router.project-osrm.org/route/v1/driving-hgv/${coordsOrigem.lon},${coordsOrigem.lat};${coordsDestino.lon},${coordsDestino.lat}?overview=full&geometries=geojson&steps=true`;
        const responseResumo = await fetch(osrmUrlResumo);
        const dataResumo = await responseResumo.json();
        
        if (dataResumo.code === 'Ok' && dataResumo.routes && dataResumo.routes.length > 0) {
          osrmDataParaResumo = dataResumo;
          const geometry = dataResumo.routes[0].geometry;
          if (geometry && geometry.coordinates) {
            coordenadasParaResumo = geometry.coordinates.map(c => [c[1], c[0]]);
          }
        }
      } catch (err) {
        console.warn('[Roteiros] Não foi possível obter OSRM para resumo, usando apenas origem-destino');
      }
      
      // Resumo da rota removido - não será mais gerado automaticamente

      // Pré-inicializar mapa em background se houver origem e destino (para carregamento rápido)
      if (origemCidadeId && destinoCidadeId && typeof L !== 'undefined' && !mapa) {
        inicializarMapa().catch(err => {
          console.warn('Erro ao pré-inicializar mapa:', err);
        });
      }

      // Atualizar mapa se estiver visível
      const mapaContainer = document.getElementById('mapaContainer');
      if (mapaContainer && mapaContainer.style.display !== 'none') {
        await atualizarMapa();
      }

    } catch (err) {
      console.error('Erro ao calcular distância:', err);
      showMessage('Erro ao calcular distância. Tente novamente.', 'error');
    } finally {
      // Remover loading e overlay
      hideCalculandoOverlay();
      if (btnCalcular && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnCalcular, false);
      }
      btnCalcular.disabled = false;
    }
  }

  // Função para gerar resumo da rota
  async function gerarResumoRota(e) {
    console.log('🔵 [INÍCIO] Função gerarResumoRota chamada');
    
    // Declarar variáveis fora do try para serem acessíveis no finally
    const roteiroId = document.getElementById('roteiroId')?.value;
    const btnGerarResumo = document.getElementById('btnGerarResumo');
    const campoResumo = document.getElementById('roteiroResumoRota');
    
    try {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      
      console.log('📋 Roteiro ID:', roteiroId);
      console.log('🔘 Botão encontrado:', !!btnGerarResumo);
      console.log('🔘 Botão desabilitado:', btnGerarResumo?.disabled);
      console.log('📝 Campo resumo encontrado:', !!campoResumo);
      
      if (!roteiroId) {
        const msg = 'Selecione um roteiro antes de gerar o resumo.';
        console.warn('⚠️', msg);
        alert(msg);
        if (typeof showMessage !== 'undefined') {
          showMessage(msg, 'error');
        }
        return;
      }
      
      if (btnGerarResumo?.disabled) {
        console.warn('⚠️ Botão está desabilitado!');
        return;
      }
      
      console.log('✅ Validações passadas, iniciando requisição...');
      
      // Desabilitar botão primeiro para evitar múltiplos cliques
      if (btnGerarResumo) {
        btnGerarResumo.disabled = true;
        btnGerarResumo.style.opacity = '0.6';
        btnGerarResumo.style.cursor = 'not-allowed';
      }
      
      // Mostrar overlay IMEDIATAMENTE (antes de qualquer outra operação)
      showCalculandoOverlay('Gerando Resumo da Rota', 'Processando informações da rota e gerando resumo detalhado...', 'Isso pode levar alguns segundos.');
      
      // Garantir que o overlay foi exibido
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Mostrar loading no botão (se disponível)
      if (btnGerarResumo && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnGerarResumo, true);
      }
      
      if (campoResumo) {
        campoResumo.value = 'Gerando resumo da rota...\n\nAguarde, isso pode levar alguns segundos...';
      }
      
      console.log('📡 Fazendo requisição para /api/roteiros/' + roteiroId + '/gerar-resumo');
      
      const response = await fetch(`/api/roteiros/${roteiroId}/gerar-resumo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log('📥 Resposta recebida:', response.status, response.statusText);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.error || `Erro ${response.status}: ${response.statusText}`;
        console.error('❌ Erro na resposta:', errorMsg);
        throw new Error(errorMsg);
      }
      
      const data = await response.json();
      console.log('📦 Dados recebidos:', data);
      
      if (campoResumo && data.resumo) {
        campoResumo.value = data.resumo;
        console.log('✅ Resumo atualizado no campo');
      } else {
        console.warn('⚠️ Campo resumo não encontrado ou dados.resumo vazio');
      }
      
      if (typeof showMessage !== 'undefined') {
        showMessage(`✅ Resumo gerado com sucesso! Distância: ${data.distanciaTotal} km, Tempo estimado: ${data.tempoEstimado} horas`, 'success');
      } else {
        alert(`✅ Resumo gerado com sucesso! Distância: ${data.distanciaTotal} km, Tempo estimado: ${data.tempoEstimado} horas`);
      }
      
    } catch (err) {
      console.error('❌ Erro ao gerar resumo:', err);
      const errorMsg = 'Erro ao gerar resumo da rota: ' + err.message;
      
      if (typeof showMessage !== 'undefined') {
        showMessage(errorMsg, 'error');
      } else {
        alert(errorMsg);
      }
      
      if (campoResumo) {
        campoResumo.value = 'Erro ao gerar resumo. Verifique se há pontos cadastrados com coordenadas válidas.';
      }
    } finally {
      console.log('🔚 Finalizando função gerarResumoRota');
      // Remover loading e overlay
      hideCalculandoOverlay();
      if (btnGerarResumo && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnGerarResumo, false);
      }
      if (btnGerarResumo) {
        btnGerarResumo.disabled = false;
        btnGerarResumo.style.opacity = '1';
        btnGerarResumo.style.cursor = 'pointer';
      }
    }
  }
  
  // Event listener para o botão gerar resumo (movido para init() para garantir que o elemento existe)
  // document.getElementById('btnGerarResumo')?.addEventListener('click', gerarResumoRota);
  
  // Event listener para o botão calcular distância (aba Dados)
  document.getElementById('btnCalcularDistancia')?.addEventListener('click', calcularDistancia);
  
  // Event listener para o botão calcular distância (aba Pontos)
  document.getElementById('btnCalcularDistanciaPontos')?.addEventListener('click', async () => {
    const roteiroId = document.getElementById('roteiroId')?.value;
    
    if (!roteiroId) {
      showMessage('Selecione um roteiro na aba "Dados" antes de calcular as distâncias.', 'error');
      return;
    }
    
    const btnCalcular = document.getElementById('btnCalcularDistanciaPontos');
    
    // Mostrar loading e overlay
    showCalculandoOverlay('Calculando Distâncias', 'Recalculando distâncias entre todos os pontos do roteiro...', 'Isso pode levar alguns segundos dependendo do número de pontos.');
    if (btnCalcular && typeof window.showLoading !== 'undefined') {
      window.showLoading(btnCalcular, true);
    }
    btnCalcular.disabled = true;
    
    try {
      // Carregar pontos se ainda não foram carregados
      if (pontosRoteiro.length === 0) {
        await carregarPontos(roteiroId);
      }
      
      // Filtrar pontos com coordenadas
      const pontosComCoordenadas = pontosRoteiro
        .filter(p => p.LATITUDE && p.LONGITUDE)
        .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
      
      if (pontosComCoordenadas.length < 2) {
        showMessage('É necessário ter pelo menos 2 pontos com coordenadas para calcular as distâncias.', 'error');
        return;
      }
      
      // Chamar a função de recalcular todas as distâncias
      await recalcularTodasDistancias(roteiroId, false);
      
    } catch (err) {
      console.error('Erro ao calcular distâncias:', err);
      showMessage('Erro ao calcular distâncias. Tente novamente.', 'error');
    } finally {
      // Remover loading e overlay (garantir que seja removido mesmo se recalcularTodasDistancias não o fizer)
      hideCalculandoOverlay();
      if (btnCalcular && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnCalcular, false);
      }
      btnCalcular.disabled = false;
    }
  });

  // Atualizar mapa quando a aba mapa for ativada
  tabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const tabId = tab.getAttribute('data-tab');
      if (tabId === 'mapa') {
        console.log('[MAPA] Clique na aba Mapa → inicializando mapa');
        if (typeof L === 'undefined') {
          const leafletDisponivel = await aguardarLeaflet();
          if (!leafletDisponivel) {
            showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
            return;
          }
        }
        
        if (!mapa) {
          const inicializado = await inicializarMapa();
          if (!inicializado) {
            console.error('Falha ao inicializar mapa');
            return;
          }
        }
        
        if (mapa) {
          requestAnimationFrame(async () => {
            try {
              mapa.invalidateSize();
              if (roteiroAtualId) {
                await atualizarMapaComPontos();
              } else {
                await atualizarMapa();
              }
            } catch (e) {
              console.warn('Erro ao invalidar tamanho:', e);
              if (roteiroAtualId) await atualizarMapaComPontos();
              else await atualizarMapa();
            }
          });
        } else {
          if (roteiroAtualId) await atualizarMapaComPontos();
          else await atualizarMapa();
        }
      }
    });
  });

  // Flag para controlar inicialização do mapa
  let mapaInicializando = false;

  // Função para inicializar o mapa
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
      // Aguardar até que a inicialização termine (com timeout menor)
      let tentativas = 0;
      while (mapaInicializando && tentativas < 10) {
        await new Promise(resolve => setTimeout(resolve, 50));
        tentativas++;
      }
      if (mapa) return true;
    }

    mapaInicializando = true;

    try {
      // Garantir que a aba está visível (sem delay)
      const tabMapa = document.getElementById('tab-mapa');
      if (tabMapa && tabMapa.style.display === 'none') {
        tabMapa.style.display = 'block';
      }
      
      // IMPORTANTE: Verificar se o container já tem um mapa antes de criar novo
      if (mapaDiv._leaflet_id) {
        // Pode acontecer quando o script roda em mais de um contexto (ex.: cache/recarregamento)
        try {
          if (mapa) {
            // Só usar remove() quando temos a referência; não tocar no DOM depois
            mapa.remove();
            mapa = null;
          } else {
            // Mapa de outra instância (ex.: script carregado 2x): substituir o container
            // para não deixar referências órfãs que causam "offsetWidth of null" ao arrastar
            const parent = mapaDiv.parentNode;
            const newDiv = document.createElement('div');
            newDiv.id = 'mapaRota';
            newDiv.style.height = mapaDiv.style.height || '600px';
            newDiv.style.width = mapaDiv.style.width || '100%';
            newDiv.style.border = mapaDiv.style.border || '2px solid #ddd';
            newDiv.style.borderRadius = mapaDiv.style.borderRadius || '8px';
            newDiv.style.background = mapaDiv.style.background || '#f5f5f5';
            if (parent) parent.replaceChild(newDiv, mapaDiv);
          }
        } catch (e) {
          console.warn('⚠️ [ROTEIROS] Erro ao limpar mapa anterior:', e);
        }
        mapa = null;
        // Aguardar para o Leaflet liberar event handlers antes de criar novo mapa
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // Não fazer mapaDiv.innerHTML = '' aqui: após remove() o Leaflet já limpou;
      // mexer no DOM aqui causa "Cannot read properties of null (reading 'offsetWidth')" no Draggable
      
      // Criar mapa centrado no Brasil
      mapa = L.map('mapaRota', {
        preferCanvas: false, // Usar canvas pode ser mais rápido
        zoomControl: true
      }).setView([-14.2350, -51.9253], 4);

      // Adicionar camada de tiles do OpenStreetMap (com opções de performance)
      // IMPORTANTE: Usar APENAS getTileServerUrl() do map-config.js
      console.log('🗺️ [ROTEIROS] Inicializando mapa...');
      console.log('🗺️ [ROTEIROS] MAP_CONFIG disponível:', !!window.MAP_CONFIG);
      console.log('🗺️ [ROTEIROS] getTileServerUrl disponível:', typeof window.getTileServerUrl === 'function');
      
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      console.log('🗺️ [ROTEIROS] Tile server selecionado:', tileServer);
      
      const tileOptions = {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
        updateWhenIdle: false, // Atualizar enquanto move
        updateWhenZooming: true // Atualizar durante zoom
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileServer.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
        console.log('🗺️ [ROTEIROS] Adicionando subdomínios para OpenStreetMap');
      }
      
      L.tileLayer(tileServer, tileOptions).addTo(mapa);
      console.log('✅ [ROTEIROS] TileLayer adicionado ao mapa');

      // Garantir que interações estejam habilitadas (arrastar/zoom) mesmo após recriações do mapa
      try {
        mapa.dragging?.enable();
        mapa.scrollWheelZoom?.enable();
        mapa.doubleClickZoom?.enable();
        mapa.boxZoom?.enable();
        mapa.keyboard?.enable();
        mapa.touchZoom?.enable();
        mapa.tap?.enable?.();
        mapaDiv.style.cursor = 'grab';
      } catch (e) {
        // ignorar
      }
      
      // Invalidar tamanho imediatamente e após o layout (evita offsetWidth/arraste quebrado quando aba estava oculta)
      requestAnimationFrame(() => {
        if (mapa) {
          try {
            mapa.invalidateSize();
          } catch (e) {
            console.warn('Erro ao invalidar tamanho do mapa:', e);
          }
        }
        // Segunda invalidação após o navegador aplicar layout da aba visível
        setTimeout(() => {
          if (mapa && mapa.getContainer && mapa.getContainer()) {
            try {
              mapa.invalidateSize();
            } catch (e2) {}
          }
        }, 150);
      });
      
      mapaInicializando = false;
      return true;
    } catch (err) {
      console.error('Erro ao inicializar mapa:', err);
      
      // Se o erro for "Map container is already initialized", limpar e tentar novamente
      if (err.message && err.message.includes('already initialized')) {
        console.warn('⚠️ [ROTEIROS] Mapa já estava inicializado. Limpando container...');
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

    const origemCidadeId = document.getElementById('origemCidade')?.value;
    const destinoCidadeId = document.getElementById('destinoCidade')?.value;
    const origemEstado = document.getElementById('origemEstado')?.value;
    const destinoEstado = document.getElementById('destinoEstado')?.value;

    console.log('[MAPA] atualizarMapa() → origemCidadeId=', origemCidadeId, 'destinoCidadeId=', destinoCidadeId, 'origemEstado=', origemEstado, 'destinoEstado=', destinoEstado);

    if (!origemCidadeId || !destinoCidadeId || !origemEstado || !destinoEstado) {
      console.warn('[MAPA] Sem origem/destino ou estado completo. Não desenha rota.');
      if (mapa) {
        mapa.setView([-14.2350, -51.9253], 4);
      }
      return;
    }

    // SEMPRE limpar o mapa completamente antes de atualizar
    // Isso garante que não haja "resquícios" de rotas anteriores
    if (mapa) {
      limparMapa();
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
    
    // Invalidar tamanho imediatamente usando requestAnimationFrame (sem delay)
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
      // Atualizar mensagem do overlay
      showMapaLoading('Buscando Coordenadas', 'Obtendo localização das cidades...');
      
      const origemCidade = cidadesOrigem.find(c => c.CDCIDADE.toString() === origemCidadeId);
      const destinoCidade = cidadesDestino.find(c => c.CDCIDADE.toString() === destinoCidadeId);

      if (!origemCidade || !destinoCidade) {
        console.warn('[MAPA] Cidade não encontrada em cidadesOrigem/cidadesDestino. origem=', !!origemCidade, 'destino=', !!destinoCidade, 'cidadesOrigem.length=', cidadesOrigem.length, 'cidadesDestino.length=', cidadesDestino.length);
        hideMapaLoading();
        showMessage('Erro ao obter informações das cidades para o mapa.', 'error');
        return;
      }

      const origemPais = document.getElementById('origemPais')?.value;
      const destinoPais = document.getElementById('destinoPais')?.value;
      console.log('[MAPA] Origem:', origemCidade.NMCIDADE, origemEstado, 'pais=', origemPais, '| Destino:', destinoCidade.NMCIDADE, destinoEstado, 'pais=', destinoPais);

      const [coordsOrigem, coordsDestino] = await Promise.all([
        obterCoordenadasCidade(origemCidade.NMCIDADE, origemEstado, origemPais),
        obterCoordenadasCidade(destinoCidade.NMCIDADE, destinoEstado, destinoPais)
      ]);

      if (!coordsOrigem || !coordsDestino) {
        console.warn('[MAPA] Coordenadas faltando. coordsOrigem=', !!coordsOrigem, 'coordsDestino=', !!coordsDestino);
        hideMapaLoading();
        showMessage('Não foi possível obter as coordenadas para exibir o mapa.', 'error');
        return;
      }
      console.log('[MAPA] Coordenadas obtidas. Origem:', coordsOrigem, 'Destino:', coordsDestino);
      
      // Atualizar mensagem do overlay
      showMapaLoading('Montando Rota', 'Criando marcadores e traçando rota...');

      // Remover marcadores e rota anteriores (já foram removidos no início da função)

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
      
      try {
        const params = new URLSearchParams({
          lon1: coordsOrigem.lon,
          lat1: coordsOrigem.lat,
          lon2: coordsDestino.lon,
          lat2: coordsDestino.lat
        });
        const rotaUrl = `/api/cidades/rota?${params.toString()}`;
        console.log('[MAPA] Chamando API rota:', rotaUrl);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const rotaResponse = await fetch(rotaUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!rotaResponse.ok) {
          console.warn('[MAPA] API rota respondeu', rotaResponse.status, await rotaResponse.text().catch(() => ''));
          throw new Error(`Erro ${rotaResponse.status} ao obter rota`);
        }
        
        const rotaData = await rotaResponse.json();
        console.log('[MAPA] Resposta rota: code=', rotaData.code, 'routes.length=', rotaData.routes ? rotaData.routes.length : 0);
        
        if (rotaData.code === 'Ok' && rotaData.routes && rotaData.routes.length > 0) {
          const coordenadasRota = rotaData.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
          console.log('[MAPA] Desenhando rota OSRM, pontos:', coordenadasRota.length);
          
          linhaRota = L.polyline(coordenadasRota, {
            color: '#3498db',
            weight: 4,
            opacity: 0.8,
            smoothFactor: 1
          }).addTo(mapa);
          
          const distanciaRota = (rotaData.routes[0].distance / 1000).toFixed(2);
          linhaRota.bindPopup(`<strong>Distância da Rota:</strong> ${distanciaRota} km`);
        } else {
          console.log('[MAPA] Usando fallback: linha reta (code=', rotaData.code, ')');
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
          console.warn('[MAPA] Erro ao obter rota (usando linha reta):', err.message || err);
        }
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

      // A distância já foi calculada e adicionada ao popup acima

      // Se houver pontos cadastrados, usar atualizarMapaComPontos
      // (o overlay já será mostrado dentro de atualizarMapaComPontos)
      if (roteiroAtualId && pontosRoteiro.length > 0) {
        // Esconder overlay se foi mostrado anteriormente
        if (window.overlayMostrado) {
          hideMapaLoading();
        }
        await atualizarMapaComPontos();
        return;
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

  // Event listeners para atualizar o mapa quando as cidades mudarem
  const atualizarMapaSeAbaAtiva = async () => {
    const tabMapa = document.querySelector('.tab-btn[data-tab="mapa"]');
    if (tabMapa && tabMapa.classList.contains('active')) {
      await atualizarMapa();
    }
  };

  document.getElementById('origemCidade')?.addEventListener('change', atualizarMapaSeAbaAtiva);
  document.getElementById('destinoCidade')?.addEventListener('change', atualizarMapaSeAbaAtiva);
  document.getElementById('origemEstado')?.addEventListener('change', atualizarMapaSeAbaAtiva);
  document.getElementById('destinoEstado')?.addEventListener('change', atualizarMapaSeAbaAtiva);
  
  // ============================================================================
  // FUNCIONALIDADES DE PONTOS DE ROTEIRO
  // ============================================================================
  
  // Carregar script dinamicamente
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof window.GridEditor !== 'undefined') {
        resolve();
        return;
      }
      
      const carregarNovoScript = () => {
        const script = document.createElement('script');
        script.src = `${src}?t=${Date.now()}`;
        script.onload = () => {
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
      
      const existingScript = document.querySelector(`script[src*="${src}"]`);
      if (existingScript) {
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof window.GridEditor !== 'undefined') {
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
  
  // Carregar pontos do roteiro
  async function carregarPontos(idRoteiro, silencioso = false) {
    if (!idRoteiro) {
      pontosRoteiro = [];
      roteiroAtualId = null;
      
      // Atualizar título e mensagem
      document.getElementById('pontosTitle').textContent = 'Pontos do Roteiro';
      const pontosGrid = document.getElementById('pontosGrid');
      if (pontosGrid) {
        pontosGrid.innerHTML = '<p class="empty">' + t('web.modulos.roteiros.selecioneRoteiroPontos') + '</p>';
      }
      
      // Ocultar botões
      const btnNovoPonto = document.getElementById('btnNovoPonto');
      const btnVoltarPontos = document.getElementById('btnVoltarPontos');
      const btnCalcularPontos = document.getElementById('btnCalcularDistanciaPontos');
      
      if (btnNovoPonto) btnNovoPonto.style.display = 'none';
      if (btnVoltarPontos) btnVoltarPontos.style.display = 'none';
      if (btnCalcularPontos) {
        btnCalcularPontos.disabled = true;
        btnCalcularPontos.style.opacity = '0.5';
      }
      
      if (gridPontos) {
        gridPontos.render([]);
      }
      return;
    }
    
    try {
      const response = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
      if (!response.ok) {
        if (response.status === 404) {
          pontosRoteiro = [];
          roteiroAtualId = idRoteiro;
          
          // Atualizar título apenas se não for chamada silenciosa
          if (!silencioso) {
            document.getElementById('pontosTitle').textContent = `Pontos do Roteiro #${idRoteiro}`;
            
            // Mostrar botões mesmo sem pontos
            const btnNovoPonto = document.getElementById('btnNovoPonto');
            const btnVoltarPontos = document.getElementById('btnVoltarPontos');
            const btnCalcularPontos = document.getElementById('btnCalcularDistanciaPontos');
            
            if (btnNovoPonto) btnNovoPonto.style.display = 'block';
            if (btnVoltarPontos) btnVoltarPontos.style.display = 'block';
            if (btnCalcularPontos) {
              btnCalcularPontos.disabled = false;
              btnCalcularPontos.style.opacity = '1';
            }
            
            // Renderizar grid vazio
            if (typeof window.GridEditor !== 'undefined') {
              if (!gridPontos) {
                inicializarGridPontos();
              }
              if (gridPontos) {
                gridPontos.render([]);
              }
            } else {
              console.warn('[Roteiros] GridEditor não está disponível. Recarregue a página.');
            }
          }
          return;
        }
        if (!silencioso) {
          throw new Error('Erro ao carregar pontos');
        }
        return;
      }
      
      pontosRoteiro = await response.json();
      roteiroAtualId = idRoteiro;
      
      // Sempre renderizar o grid se estiver na aba de pontos (mesmo se silencioso)
      const pontosTab = document.getElementById('tab-pontos');
      const isPontosTabActive = pontosTab && pontosTab.classList.contains('active');
      
      if (isPontosTabActive || !silencioso) {
        // Atualizar título
        const pontosTitleEl = document.getElementById('pontosTitle');
        if (pontosTitleEl) {
          pontosTitleEl.textContent = `Pontos do Roteiro #${idRoteiro}`;
        }
        
        // Mostrar/ocultar botões
        const btnNovoPonto = document.getElementById('btnNovoPonto');
        const btnVoltarPontos = document.getElementById('btnVoltarPontos');
        const btnCalcularPontos = document.getElementById('btnCalcularDistanciaPontos');
        
        if (btnNovoPonto) btnNovoPonto.style.display = 'block';
        if (btnVoltarPontos) btnVoltarPontos.style.display = 'block';
        if (btnCalcularPontos) {
          btnCalcularPontos.disabled = false;
          btnCalcularPontos.style.opacity = '1';
        }
        
        // Renderizar grid
        if (typeof GridEditor !== 'undefined') {
          if (!gridPontos) {
            inicializarGridPontos();
          }
          if (gridPontos) {
            gridPontos.render(pontosRoteiro);
          }
        } else {
          console.warn('[Roteiros] GridEditor não está disponível. Recarregue a página.');
        }
        
        // Calcular e exibir soma das distâncias
        await atualizarSomaDistancias();
      }
    } catch (err) {
      console.error('Erro ao carregar pontos:', err);
      if (!silencioso) {
        showMessage('Erro ao carregar pontos do roteiro.', 'error');
      }
    }
  }
  
  // Recalcular todas as distâncias do roteiro (pontos e total)
  async function recalcularTodasDistancias(idRoteiro, silencioso = false) {
    // Mostrar overlay apenas se não for silencioso
    if (!silencioso) {
      showCalculandoOverlay('Calculando Distâncias', 'Recalculando distâncias entre todos os pontos do roteiro...', 'Isso pode levar alguns segundos dependendo do número de pontos.');
    }
    
    try {
      // Recarregar pontos do banco para garantir dados atualizados
      const pontosResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
      if (!pontosResponse.ok) {
        console.error('[Recalcular] Erro ao carregar pontos:', pontosResponse.status);
        return;
      }
      
      pontosRoteiro = await pontosResponse.json();

      // Helpers: normalizar/validar coordenadas (evita OSRM 400 por dados inválidos/outliers)
      const parseCoord = (v) => {
        if (v === null || v === undefined || v === '') return null;
        const n = parseFloat(String(v).trim().replace(',', '.'));
        return Number.isFinite(n) ? n : null;
      };
      const isValidLatLon = (lat, lon) =>
        lat !== null && lon !== null &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180;
      const getCoord = (p) => {
        const lat = parseCoord(p.LATITUDE);
        const lon = parseCoord(p.LONGITUDE);
        return isValidLatLon(lat, lon) ? { lat, lon } : null;
      };
      const coordSpanTooLarge = (pts) => {
        if (!pts || pts.length < 2) return false;
        let minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
        pts.forEach(p => {
          const c = getCoord(p);
          if (!c) return;
          minLat = Math.min(minLat, c.lat);
          maxLat = Math.max(maxLat, c.lat);
          minLon = Math.min(minLon, c.lon);
          maxLon = Math.max(maxLon, c.lon);
        });
        // Se o span é muito grande, provavelmente existe um ponto fora do país/região
        return (maxLat - minLat) > 12 || (maxLon - minLon) > 12; // ~ > 1300km (aprox)
      };
      
      // Filtrar pontos com coordenadas e ordenar por ORDEM
      const pontosComCoordenadas = pontosRoteiro
        .filter(p => getCoord(p))
        .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
      
      if (pontosComCoordenadas.length < 2) {
        return;
      }
      
      let distanciasAtualizadas = 0;
      let distanciaTotal = null;
      
      // OTIMIZAÇÃO: Para poucos pontos (≤5), fazer uma única requisição OSRM
      const totalPontos = pontosComCoordenadas.length;
      let usarOtimizacao = totalPontos <= 5;
      // Se existe um ponto muito fora da região, não use a chamada única (pode causar 400 no OSRM público)
      if (usarOtimizacao && coordSpanTooLarge(pontosComCoordenadas)) {
        usarOtimizacao = false;
      }
      
      if (usarOtimizacao) {
        // OTIMIZAÇÃO: Uma única requisição OSRM para calcular tudo
        try {
          const coordsStr = pontosComCoordenadas
            .map(p => {
              const c = getCoord(p);
              return c ? `${c.lon},${c.lat}` : null;
            })
            .filter(Boolean)
            .join(';');
          
          const osrmUrl = (window.getOSRMUrl
            ? window.getOSRMUrl(pontosComCoordenadas.map(p => getCoord(p)).filter(Boolean))
            : `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full&geometries=geojson`);
          const response = await fetch(osrmUrl);
          const data = await response.json();
          
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            distanciaTotal = parseFloat((route.distance / 1000).toFixed(2));
            
            // Extrair distâncias entre pontos consecutivos dos legs
            if (route.legs && route.legs.length > 0) {
              const distanciasSegmentos = route.legs.map(leg => parseFloat((leg.distance / 1000).toFixed(4)));
              
              // Atualizar distâncias entre pontos em paralelo
              const atualizacoes = [];
              for (let i = 1; i < pontosComCoordenadas.length; i++) {
                const pontoAtual = pontosComCoordenadas[i];
                const distanciaSegmento = distanciasSegmentos[i - 1] || 0;
                
                atualizacoes.push(
                  fetch(`/api/roteiros/${idRoteiro}/pontos/${pontoAtual.SEQUENCIA}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      ORDEM: pontoAtual.ORDEM,
                      DSLOCAL: pontoAtual.DSLOCAL,
                      DSPOSICAO: pontoAtual.DSPOSICAO,
                      LATITUDE: pontoAtual.LATITUDE,
                      LONGITUDE: pontoAtual.LONGITUDE,
                      TPLOCAL: pontoAtual.TPLOCAL,
                      KMENTREPONTOS: distanciaSegmento,
                      ESTADOPASSAGEM: pontoAtual.ESTADOPASSAGEM,
                      CDPAISPASSAGEM: pontoAtual.CDPAISPASSAGEM
                    })
                  }).then(async updateResponse => {
                    if (updateResponse.ok) {
                      pontoAtual.KMENTREPONTOS = distanciaSegmento;
                      distanciasAtualizadas++;
                      return true;
                    } else {
                      const errorData = await updateResponse.json().catch(() => ({}));
                      console.error(`[Recalcular] Erro ao atualizar ponto ${pontoAtual.SEQUENCIA}:`, errorData);
                      return false;
                    }
                  }).catch(err => {
                    console.error(`[Recalcular] Erro ao atualizar sequência ${pontoAtual.SEQUENCIA}:`, err);
                    return false;
                  })
                );
              }
              
              // Aguardar todas as atualizações em paralelo
              await Promise.all(atualizacoes);
            }
            
            // Atualizar campo na tela
            const campoDistancia = document.getElementById('roteiroDistancia');
            if (campoDistancia) {
              campoDistancia.value = distanciaTotal;
            }
            
            // Atualizar no banco de dados - GARANTIR QUE SEJA SALVO
            const descricao = document.getElementById('roteiroDescricao')?.value;
            const origemCidade = document.getElementById('origemCidade')?.value;
            const destinoCidade = document.getElementById('destinoCidade')?.value;
            
            if (descricao && origemCidade && destinoCidade) {
              const roteiroUpdateResponse = await fetch(`/api/roteiros/${idRoteiro}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  DSROTEIRO: descricao,
                  CDCIDADEORIGEM: parseInt(origemCidade),
                  CDCIDADEDESTINO: parseInt(destinoCidade),
                  DISTANCIAKM: distanciaTotal
                })
              });
              
              if (!roteiroUpdateResponse.ok) {
                const errorData = await roteiroUpdateResponse.json().catch(() => ({}));
                console.error('[Recalcular] Erro ao atualizar roteiro no banco (otimização):', errorData);
                if (!silencioso) {
                  showMessage('Erro ao salvar distância total no banco de dados', 'error');
                }
              }
            }
          }
        } catch (err) {
          console.warn('[Recalcular] Erro na otimização, usando método tradicional:', err);
          // Fallback para método tradicional se a otimização falhar
          usarOtimizacao = false;
        }
      }
      
      // MÉTODO TRADICIONAL: Para muitos pontos ou se otimização falhou
      if (!usarOtimizacao) {
        // 1. Recalcular distâncias entre pontos consecutivos
        for (let i = 1; i < pontosComCoordenadas.length; i++) {
          const pontoAtual = pontosComCoordenadas[i];
          const pontoAnterior = pontosComCoordenadas[i - 1];
          
          // Calcular distância usando OSRM
          try {
            const coordsStr = `${pontoAnterior.LONGITUDE},${pontoAnterior.LATITUDE};${pontoAtual.LONGITUDE},${pontoAtual.LATITUDE}`;
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full`;
            const response = await fetch(osrmUrl);
            const data = await response.json();
            
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
              const distancia = parseFloat((data.routes[0].distance / 1000).toFixed(4));
              
              // Atualizar no banco de dados
              const updateResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos/${pontoAtual.SEQUENCIA}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ORDEM: pontoAtual.ORDEM,
                  DSLOCAL: pontoAtual.DSLOCAL,
                  DSPOSICAO: pontoAtual.DSPOSICAO,
                  LATITUDE: pontoAtual.LATITUDE,
                  LONGITUDE: pontoAtual.LONGITUDE,
                  TPLOCAL: pontoAtual.TPLOCAL,
                  KMENTREPONTOS: distancia,
                  ESTADOPASSAGEM: pontoAtual.ESTADOPASSAGEM,
                  CDPAISPASSAGEM: pontoAtual.CDPAISPASSAGEM
                })
              });
              
              if (updateResponse.ok) {
                pontoAtual.KMENTREPONTOS = distancia;
                distanciasAtualizadas++;
              } else {
                const errorData = await updateResponse.json();
                console.error(`[Recalcular] Erro ao atualizar sequência ${pontoAtual.SEQUENCIA}:`, errorData);
              }
            }
          } catch (err) {
            console.error(`[Recalcular] Erro ao recalcular distância do ponto ${pontoAtual.SEQUENCIA}:`, err);
          }
        }
        
        // 2. Recalcular distância total do roteiro
        try {
          const coordsStr = pontosComCoordenadas
            .map(p => `${p.LONGITUDE},${p.LATITUDE}`)
            .join(';');
          
          const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full&geometries=geojson`;
          const response = await fetch(osrmUrl);
          const data = await response.json();
          
          if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
            distanciaTotal = parseFloat((data.routes[0].distance / 1000).toFixed(2));
            
            // Atualizar campo na tela
            const campoDistancia = document.getElementById('roteiroDistancia');
            if (campoDistancia) {
              campoDistancia.value = distanciaTotal;
            }
            
            // Atualizar no banco de dados - GARANTIR QUE SEJA SALVO
            const descricao = document.getElementById('roteiroDescricao')?.value;
            const origemCidade = document.getElementById('origemCidade')?.value;
            const destinoCidade = document.getElementById('destinoCidade')?.value;
            
            if (descricao && origemCidade && destinoCidade) {
              const roteiroUpdateResponse = await fetch(`/api/roteiros/${idRoteiro}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  DSROTEIRO: descricao,
                  CDCIDADEORIGEM: parseInt(origemCidade),
                  CDCIDADEDESTINO: parseInt(destinoCidade),
                  DISTANCIAKM: distanciaTotal
                })
              });
              
              if (!roteiroUpdateResponse.ok) {
                const errorData = await roteiroUpdateResponse.json().catch(() => ({}));
                console.error('[Recalcular] Erro ao atualizar roteiro no banco (método tradicional):', errorData);
                if (!silencioso) {
                  showMessage('Erro ao salvar distância total no banco de dados', 'error');
                }
              }
            }
          }
        } catch (err) {
          console.warn('Erro ao recalcular distância total:', err);
        }
      }
      
      // 3. Recarregar pontos do banco para garantir dados atualizados
      // (mas não renderizar ainda se for silencioso, será renderizado depois)
      if (!silencioso) {
        await carregarPontos(idRoteiro, false);
        // Atualizar soma das distâncias na aba de pontos
        await atualizarSomaDistancias();
      } else {
        // Se silencioso, apenas recarregar os dados sem renderizar
        const pontosResponse = await fetch(`/api/roteiros/${idRoteiro}/pontos`);
        if (pontosResponse.ok) {
          pontosRoteiro = await pontosResponse.json();
        }
      }
      
      // Mostrar mensagem de sucesso apenas se atualizou algo e não foi chamado silenciosamente
      if (!silencioso && (distanciasAtualizadas > 0 || distanciaTotal !== null)) {
        const mensagem = `✅ Distâncias calculadas e salvas no banco: ${distanciasAtualizadas} pontos atualizados${distanciaTotal ? `, total: ${distanciaTotal.toFixed(2)} km` : ''}`;
        showMessage(mensagem, 'success');
      }
    } catch (err) {
      console.error('Erro ao recalcular distâncias:', err);
      if (!silencioso) {
        showMessage('Erro ao calcular e salvar distâncias. Verifique o console para mais detalhes.', 'error');
      }
    } finally {
      // Remover overlay apenas se não for silencioso
      if (!silencioso) {
        hideCalculandoOverlay();
      }
    }
  }
  
  // Atualizar soma das distâncias entre pontos (usando OSRM - rota real)
  async function atualizarSomaDistancias() {
    const somaElement = document.getElementById('somaDistancias');
    if (!somaElement) return;
    
    if (pontosRoteiro.length === 0) {
      somaElement.textContent = '';
      return;
    }
    
    // OTIMIZAÇÃO: Para poucos pontos, usar valores já calculados (KMENTREPONTOS) se disponíveis
    // Helpers: normalizar/validar coordenadas
    const parseCoord = (v) => {
      if (v === null || v === undefined || v === '') return null;
      const n = parseFloat(String(v).trim().replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    };
    const isValidLatLon = (lat, lon) =>
      lat !== null && lon !== null &&
      lat >= -90 && lat <= 90 &&
      lon >= -180 && lon <= 180;
    const getCoord = (p) => {
      const lat = parseCoord(p.LATITUDE);
      const lon = parseCoord(p.LONGITUDE);
      return isValidLatLon(lat, lon) ? { lat, lon } : null;
    };
    const coordSpanTooLarge = (pts) => {
      if (!pts || pts.length < 2) return false;
      let minLat = 999, maxLat = -999, minLon = 999, maxLon = -999;
      pts.forEach(p => {
        const c = getCoord(p);
        if (!c) return;
        minLat = Math.min(minLat, c.lat);
        maxLat = Math.max(maxLat, c.lat);
        minLon = Math.min(minLon, c.lon);
        maxLon = Math.max(maxLon, c.lon);
      });
      return (maxLat - minLat) > 12 || (maxLon - minLon) > 12;
    };

    const pontosComCoordenadas = pontosRoteiro
      .filter(p => getCoord(p))
      .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
    
    if (pontosComCoordenadas.length <= 3) {
      // Para 3 ou menos pontos, somar KMENTREPONTOS se disponíveis (mais rápido)
      const somaKMENTREPONTOS = pontosComCoordenadas
        .slice(1) // Pular primeiro ponto (não tem distância do anterior)
        .reduce((soma, p) => soma + (parseFloat(p.KMENTREPONTOS) || 0), 0);
      
      if (somaKMENTREPONTOS > 0) {
        somaElement.textContent = `Distância total (rota real): ${somaKMENTREPONTOS.toFixed(2)} km`;
        return; // Usar valores já calculados, não precisa fazer nova requisição OSRM
      }
    }
    
    // Ordenar pontos por ORDEM
    const pontosOrdenados = [...pontosRoteiro]
      .filter(p => getCoord(p))
      .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
    
    if (pontosOrdenados.length < 2) {
      somaElement.textContent = '';
      return;
    }
    
    // Tentar calcular usando OSRM (rota real) - mesma lógica do botão Calcular
    try {
      // Se existe um outlier (ponto muito fora), não chamar OSRM público (evita 400)
      if (coordSpanTooLarge(pontosOrdenados)) {
        throw new Error('Pontos com coordenadas muito distantes entre si');
      }

      const coords = pontosOrdenados.map(p => getCoord(p)).filter(Boolean);
      const coordsStr = coords.map(c => `${c.lon},${c.lat}`).join(';');
      const osrmUrl = (window.getOSRMUrl ? window.getOSRMUrl(coords) : `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full&geometries=geojson`);
      const response = await fetch(osrmUrl);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const distanciaTotal = parseFloat((data.routes[0].distance / 1000).toFixed(2));
        somaElement.textContent = `Distância total (rota real): ${distanciaTotal.toFixed(2)} km`;
        return;
      }
    } catch (err) {
      console.warn('Erro ao calcular rota real para soma, usando valores de KMENTREPONTOS:', err);
    }
    
    // Fallback: somar os valores de KMENTREPONTOS (distâncias entre pontos consecutivos já calculadas)
    let somaTotal = 0;
    for (let i = 1; i < pontosOrdenados.length; i++) {
      // KMENTREPONTOS contém a distância do ponto anterior para o ponto atual
      const distancia = pontosOrdenados[i].KMENTREPONTOS;
      if (distancia !== null && distancia !== undefined) {
        somaTotal += parseFloat(distancia);
      }
    }
    
    if (somaTotal > 0) {
      somaElement.textContent = `Soma das distâncias entre pontos: ${somaTotal.toFixed(2)} km`;
    } else {
      // Se não houver valores de KMENTREPONTOS, calcular usando Haversine
      somaTotal = 0;
      for (let i = 0; i < pontosOrdenados.length - 1; i++) {
        const pontoAtual = pontosOrdenados[i];
        const proximoPonto = pontosOrdenados[i + 1];
        
        const distancia = calcularDistanciaHaversine(
          parseFloat(pontoAtual.LATITUDE),
          parseFloat(pontoAtual.LONGITUDE),
          parseFloat(proximoPonto.LATITUDE),
          parseFloat(proximoPonto.LONGITUDE)
        );
        
        somaTotal += distancia;
      }
      somaElement.textContent = `Distância total (linha reta): ${somaTotal.toFixed(2)} km`;
    }
  }
  
  // Inicializar Grid de Pontos
  function inicializarGridPontos() {
    if (typeof window.GridEditor === 'undefined') {
      console.error('[Pontos] GridEditor não está disponível');
      return;
    }

    gridPontos = new window.GridEditor({
      container: '#pontosGrid',
      columns: [
        { field: 'SEQUENCIA', header: 'Seq', editable: false, isId: true, width: '60px' },
        { field: 'ORDEM', header: 'Ordem', editable: true, type: 'number', width: '80px' },
        { field: 'TPLOCAL', header: 'Tipo', editable: true, type: 'select',
          options: [
            { value: 'O', label: 'Origem' },
            { value: 'D', label: 'Destino' },
            { value: 'P', label: 'Passagem' },
            { value: 'R', label: 'Parada' }
          ],
          format: (val) => {
            if (val === null || val === undefined) return 'Não definido';
            const tipoNormalizado = String(val).trim().toUpperCase();
            const tipos = { 'O': 'Origem', 'D': 'Destino', 'P': 'Passagem', 'R': 'Parada' };
            return tipos[tipoNormalizado] || tipoNormalizado || 'Não definido';
          }
        },
        { field: 'DSLOCAL', header: 'Local', editable: true, type: 'text' },
        { field: 'DSPOSICAO', header: 'Posição', editable: true, type: 'text' },
        { field: 'LATITUDE', header: 'Latitude', editable: true, type: 'number',
          format: (val) => val ? parseFloat(val).toFixed(6) : ''
        },
        { field: 'LONGITUDE', header: 'Longitude', editable: true, type: 'number',
          format: (val) => val ? parseFloat(val).toFixed(6) : ''
        },
        { field: 'KMENTREPONTOS', header: 'Dist. (km)', editable: true, type: 'number',
          format: (val) => val ? parseFloat(val).toFixed(4) : ''
        },
        { field: 'ESTADOPASSAGEM', header: 'UF', editable: true, type: 'text', width: '60px', align: 'right' }
      ],
      apiEndpoint: `/api/roteiros/${roteiroAtualId}/pontos`,
      onBeforeEdit: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          console.warn('[Pontos] ID inválido no onBeforeEdit:', id);
          return false;
        }
        await carregarPontoParaEdicao(id);
        return false; // Cancelar edição inline, usar formulário
      },
      onDelete: async (id) => {
        if (!id || id === 'undefined' || id === 'null' || id === '') {
          console.warn('[Pontos] ID inválido no onDelete:', id);
          showMessage('Erro: ID do ponto inválido.', 'error');
          return;
        }
        await confirmarExclusaoPonto(id);
      }
    });
  }
  
  // Carregar ponto para edição
  async function carregarPontoParaEdicao(sequencia) {
    try {
      // IMPORTANTE: Limpar formulário ANTES de carregar novos dados
      const pontoForm = document.getElementById('pontoForm');
      if (pontoForm) {
        pontoForm.reset();
      }
      
      // Converter sequencia para número se necessário
      const seqNum = typeof sequencia === 'string' ? parseInt(sequencia) : sequencia;
      const ponto = pontosRoteiro.find(p => {
        const pSeq = typeof p.SEQUENCIA === 'string' ? parseInt(p.SEQUENCIA) : p.SEQUENCIA;
        return pSeq === seqNum;
      });
      
      if (!ponto) {
        showMessage('Ponto não encontrado.', 'error');
        return;
      }
      
      // Garantir que os países estejam carregados antes de preencher
      const selectPais = document.getElementById('pontoPais');
      if (selectPais && selectPais.options.length <= 1) {
        // Se o select de país não está carregado, carregar primeiro
        await loadPaises();
        // Aguardar um pouco para garantir que o DOM foi atualizado
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Preencher formulário
      document.getElementById('pontoIdRoteiro').value = ponto.IDROTEIRO || '';
      document.getElementById('pontoSequencia').value = ponto.SEQUENCIA || '';
      document.getElementById('pontoSequenciaDisplay').value = ponto.SEQUENCIA || '';
      
      // Tipo Local - garantir que seja string e tratar null/undefined
      let tipoLocal = '';
      if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
        tipoLocal = String(ponto.TPLOCAL).trim();
      }
      const selectTipoLocal = document.getElementById('pontoTipoLocal');
      if (selectTipoLocal) {
        selectTipoLocal.value = tipoLocal;
        // Forçar trigger de change para garantir que o valor foi aplicado
        selectTipoLocal.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      // Ordem
      const ordemEl = document.getElementById('pontoOrdem');
      if (ordemEl) {
        ordemEl.value = ponto.ORDEM || '';
      }
      
      // Local e Posição
      document.getElementById('pontoLocal').value = String(ponto.DSLOCAL || '').trim();
      document.getElementById('pontoPosicao').value = String(ponto.DSPOSICAO || '').trim();
      
      // Coordenadas
      const latEl = document.getElementById('pontoLatitude');
      const lonEl = document.getElementById('pontoLongitude');
      if (latEl) {
        latEl.value = ponto.LATITUDE ? parseFloat(ponto.LATITUDE).toFixed(6) : '';
      }
      if (lonEl) {
        lonEl.value = ponto.LONGITUDE ? parseFloat(ponto.LONGITUDE).toFixed(6) : '';
      }
      
      // Distância
      const distEl = document.getElementById('pontoDistancia');
      if (distEl) {
        distEl.value = ponto.KMENTREPONTOS ? parseFloat(ponto.KMENTREPONTOS).toFixed(4) : '';
      }
      
      // Estado - garantir que seja string e uppercase, tratar null
      let estado = '';
      if (ponto.ESTADOPASSAGEM !== null && ponto.ESTADOPASSAGEM !== undefined) {
        estado = String(ponto.ESTADOPASSAGEM).trim().toUpperCase();
      }
      const estadoEl = document.getElementById('pontoEstado');
      if (estadoEl) {
        estadoEl.value = estado;
      }
      
      // País - garantir que seja string para comparação com options, tratar null
      let codigoPais = '';
      if (ponto.CDPAISPASSAGEM !== null && ponto.CDPAISPASSAGEM !== undefined) {
        codigoPais = String(ponto.CDPAISPASSAGEM);
      }
      
      if (selectPais) {
        if (codigoPais) {
          // Aguardar um pouco mais para garantir que o select foi populado
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Verificar se a opção existe no select
          const optionExists = Array.from(selectPais.options).some(opt => opt.value === codigoPais);
          if (optionExists) {
            selectPais.value = codigoPais;
            selectPais.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            // Se não existe, tentar novamente após um delay maior
            setTimeout(() => {
              const optionExists2 = Array.from(selectPais.options).some(opt => opt.value === codigoPais);
              if (optionExists2) {
                selectPais.value = codigoPais;
                selectPais.dispatchEvent(new Event('change', { bubbles: true }));
              } else {
                console.warn(`[Pontos] País com código ${codigoPais} não encontrado no select. Ponto:`, ponto);
              }
            }, 300);
          }
        } else {
          selectPais.value = '';
        }
      }
      
      document.getElementById('pontoFormTitle').textContent = 'Editar Ponto';
      document.getElementById('pontoFormContainer').style.display = 'block';
      
      // Scroll para o formulário
      document.getElementById('pontoFormContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Erro ao carregar ponto:', err);
      showMessage('Erro ao carregar ponto para edição.', 'error');
    }
  }
  
  // Mapear nome do estado para UF brasileira
  function mapearEstadoParaUF(nomeEstado) {
    if (!nomeEstado) return '';
    
    const estados = {
      'acre': 'AC', 'amazonas': 'AM', 'amapá': 'AP', 'amapa': 'AP',
      'pará': 'PA', 'para': 'PA', 'rondônia': 'RO', 'rondonia': 'RO',
      'roraima': 'RR', 'tocantins': 'TO',
      'alagoas': 'AL', 'bahia': 'BA', 'ceará': 'CE', 'ceara': 'CE',
      'maranhão': 'MA', 'maranhao': 'MA', 'paraíba': 'PB', 'paraiba': 'PB',
      'pernambuco': 'PE', 'piauí': 'PI', 'piaui': 'PI', 'rio grande do norte': 'RN',
      'sergipe': 'SE',
      'distrito federal': 'DF', 'goiás': 'GO', 'goias': 'GO', 'mato grosso': 'MT',
      'mato grosso do sul': 'MS',
      'espírito santo': 'ES', 'espirito santo': 'ES', 'minas gerais': 'MG',
      'rio de janeiro': 'RJ', 'são paulo': 'SP', 'sao paulo': 'SP',
      'paraná': 'PR', 'parana': 'PR', 'rio grande do sul': 'RS',
      'santa catarina': 'SC'
    };
    
    const nomeLower = nomeEstado.toLowerCase().trim();
    
    // Buscar correspondência exata
    if (estados[nomeLower]) {
      return estados[nomeLower];
    }
    
    // Buscar correspondência parcial
    for (const [key, uf] of Object.entries(estados)) {
      if (nomeLower.includes(key) || key.includes(nomeLower)) {
        return uf;
      }
    }
    
    // Se não encontrou, retornar as 2 primeiras letras em maiúscula (caso já seja UF)
    if (nomeLower.length === 2) {
      return nomeLower.toUpperCase();
    }
    
    return '';
  }
  
  // Buscar código do país pelo nome
  async function buscarCodigoPais(nomePais) {
    try {
      const response = await fetch('/api/paises');
      if (!response.ok) return null;
      
      const paises = await response.json();
      const nomeLower = nomePais.toLowerCase().trim();
      
      // Buscar correspondência exata ou parcial
      const pais = paises.find(p => {
        const nomePaisLower = p.DSPAIS.toLowerCase();
        return nomePaisLower === nomeLower || 
               nomePaisLower.includes(nomeLower) || 
               nomeLower.includes(nomePaisLower);
      });
      
      return pais ? pais.CDPAIS : null;
    } catch (err) {
      console.warn('Erro ao buscar código do país:', err);
      return null;
    }
  }
  
  // Buscar coordenadas via Nominatim
  async function buscarCoordenadas() {
    const posicao = document.getElementById('pontoPosicao')?.value.trim();
    if (!posicao) {
      showMessage('Informe a posição (endereço) para buscar coordenadas.', 'error', 'pontoPosicao');
      return;
    }
    
    try {
      const btnBuscar = document.getElementById('btnBuscarCoordenadas');
      if (btnBuscar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnBuscar, true);
      }
      
      // Usar Nominatim para geocodificação (tentar servidor configurado; em caso de falha, API pública)
      const servers = [
        (window.MAP_CONFIG?.nominatimServer || 'http://app.integrabrasil.com:8080/nominatim').replace(/\/$/, ''),
        'https://nominatim.openstreetmap.org'
      ];
      const opts = { headers: { 'User-Agent': 'AtlasCargo/2.0' } };
      let data = null;
      for (const base of servers) {
        try {
          const url = `${base}/search?format=json&q=${encodeURIComponent(posicao)}&limit=1&addressdetails=1`;
          const res = await fetch(url, opts);
          if (!res.ok) continue;
          data = await res.json();
          if (data && Array.isArray(data) && data.length > 0) break;
        } catch (err) {
          if (base === servers[servers.length - 1]) throw err;
        }
      }

      if (data && data.length > 0) {
        const resultado = data[0];
        const address = resultado.address || {};
        
        // Preencher coordenadas
        document.getElementById('pontoLatitude').value = parseFloat(resultado.lat).toFixed(6);
        document.getElementById('pontoLongitude').value = parseFloat(resultado.lon).toFixed(6);
        
        // Extrair e preencher país
        const nomePais = address.country || address.country_code || '';
        if (nomePais) {
          const codigoPais = await buscarCodigoPais(nomePais);
          if (codigoPais) {
            document.getElementById('pontoPais').value = codigoPais;
          }
        }
        
        // Extrair e preencher estado (UF)
        const estado = address.state || address.region || '';
        if (estado) {
          const uf = mapearEstadoParaUF(estado);
          if (uf) {
            document.getElementById('pontoEstado').value = uf;
          } else {
            // Se não conseguiu mapear, tentar usar diretamente se tiver 2 caracteres
            const estadoUpper = estado.toUpperCase().trim();
            if (estadoUpper.length === 2) {
              document.getElementById('pontoEstado').value = estadoUpper;
            }
          }
        }
        
        showMessage('Coordenadas, país e estado encontrados com sucesso!', 'success');
      } else {
        showMessage('Nenhuma coordenada encontrada para este endereço.', 'error');
      }
    } catch (err) {
      console.error('Erro ao buscar coordenadas:', err);
      showMessage('Erro ao buscar coordenadas. Tente novamente.', 'error');
    } finally {
      const btnBuscar = document.getElementById('btnBuscarCoordenadas');
      if (btnBuscar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnBuscar, false);
      }
    }
  }
  
  // Calcular distância do ponto anterior usando OSRM (rota real)
  async function calcularDistanciaPontoAnterior(ordemAtual, latitudeAtual, longitudeAtual, sequenciaAtual) {
    if (!latitudeAtual || !longitudeAtual) {
      return null; // Sem coordenadas, não pode calcular
    }
    
    // Buscar todos os pontos ordenados por ORDEM
    const pontosOrdenados = [...pontosRoteiro]
      .filter(p => {
        // Se estiver editando, excluir o ponto atual da lista
        if (sequenciaAtual && p.SEQUENCIA === parseInt(sequenciaAtual)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
    
    const ordemA = parseInt(ordemAtual) || 0;
    
    // Encontrar o ponto imediatamente anterior na ordem (maior ordem menor que a atual)
    const pontosAnteriores = pontosOrdenados
      .filter(p => {
        const ordemP = p.ORDEM || 0;
        return ordemP < ordemA && p.LATITUDE && p.LONGITUDE;
      })
      .sort((a, b) => (b.ORDEM || 0) - (a.ORDEM || 0)); // Ordenar por ordem decrescente
    
    if (pontosAnteriores.length > 0) {
      const pontoAnterior = pontosAnteriores[0]; // Ponto com maior ordem menor que a atual
      
      // Tentar calcular usando OSRM (rota real)
      try {
        const coordsStr = `${pontoAnterior.LONGITUDE},${pontoAnterior.LATITUDE};${longitudeAtual},${latitudeAtual}`;
        const osrmUrl = `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full`;
        const response = await fetch(osrmUrl);
        const data = await response.json();
        
        if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
          const distancia = parseFloat((data.routes[0].distance / 1000).toFixed(4)); // Converter metros para km, 4 casas decimais
          return distancia;
        }
      } catch (err) {
        console.warn('Erro ao calcular rota real com OSRM, usando Haversine:', err);
      }
      
      // Fallback: usar Haversine (linha reta) se OSRM falhar
      const distancia = calcularDistanciaHaversine(
        parseFloat(pontoAnterior.LATITUDE),
        parseFloat(pontoAnterior.LONGITUDE),
        parseFloat(latitudeAtual),
        parseFloat(longitudeAtual)
      );
      return parseFloat(distancia.toFixed(4)); // 4 casas decimais como no banco
    }
    
    return null; // Não há ponto anterior com coordenadas
  }
  
  // Salvar ponto (criar ou atualizar)
  async function salvarPonto(e) {
    e.preventDefault();
    // Evitar submit duplicado (duplo clique / listeners duplicados)
    if (window.__roteiros_salvarPontoSubmitting) return;
    window.__roteiros_salvarPontoSubmitting = true;
    if (e && typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    
    const idRoteiro = document.getElementById('pontoIdRoteiro')?.value;
    const sequencia = document.getElementById('pontoSequencia')?.value;
    const ordem = document.getElementById('pontoOrdem')?.value;
    const local = document.getElementById('pontoLocal')?.value.trim();
    const posicao = document.getElementById('pontoPosicao')?.value.trim();
    const latitude = document.getElementById('pontoLatitude')?.value;
    const longitude = document.getElementById('pontoLongitude')?.value;
    const tipoLocal = document.getElementById('pontoTipoLocal')?.value;
    // Ler distância do campo (pode ser vazio, zero ou um valor)
    let distancia = document.getElementById('pontoDistancia')?.value;
    // Converter para número se houver valor, senão null
    if (distancia !== null && distancia !== undefined && distancia !== '') {
      const distanciaNum = parseFloat(distancia);
      // Se for NaN ou menor que zero, considerar null
      if (!isNaN(distanciaNum) && distanciaNum >= 0) {
        distancia = distanciaNum;
      } else {
        distancia = null;
      }
    } else {
      distancia = null;
    }
    const estado = document.getElementById('pontoEstado')?.value.trim();
    const pais = document.getElementById('pontoPais')?.value;
    
    if (!idRoteiro || !ordem || !local || !posicao || !tipoLocal) {
      showMessage(t('web.modulos.roteiros.preenchaCampos'), 'error');
      return;
    }
    
    try {
      const btnSalvar = document.querySelector('#pontoForm button[type="submit"]');
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, true);
      }
      if (btnSalvar) btnSalvar.disabled = true;
      
      // Calcular distância do ponto anterior automaticamente se houver coordenadas
      // MAS só calcular se o usuário não informou uma distância manualmente
      const distanciaManual = distancia && parseFloat(distancia) > 0;
      
      if (latitude && longitude && !distanciaManual) {
        // Só calcular automaticamente se não houver distância manual
        const distanciaCalculada = await calcularDistanciaPontoAnterior(ordem, latitude, longitude, sequencia);
        if (distanciaCalculada !== null) {
          distancia = distanciaCalculada;
          // Atualizar o campo visualmente
          document.getElementById('pontoDistancia').value = distancia;
        } else {
          // Se não calculou, manter null ou valor manual se houver
          distancia = distanciaManual ? distancia : null;
        }
      } else if (!distanciaManual && !latitude && !longitude) {
        // Se não há coordenadas e não há distância manual, deixar null
        distancia = null;
      }
      // Se há distância manual, manter o valor informado pelo usuário
      
      const pontoData = {
        ORDEM: parseInt(ordem),
        DSLOCAL: local,
        DSPOSICAO: posicao,
        LATITUDE: latitude ? parseFloat(latitude) : null,
        LONGITUDE: longitude ? parseFloat(longitude) : null,
        TPLOCAL: tipoLocal,
        KMENTREPONTOS: distancia ? parseFloat(distancia) : null,
        ESTADOPASSAGEM: estado || null,
        CDPAISPASSAGEM: pais ? parseInt(pais) : null
      };
      
      let response;
      if (sequencia) {
        // Atualizar
        response = await fetch(`/api/roteiros/${idRoteiro}/pontos/${sequencia}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pontoData)
        });
      } else {
        // Criar
        response = await fetch(`/api/roteiros/${idRoteiro}/pontos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pontoData)
        });
      }
      
      const data = await response.json();
      
      if (response.ok) {
        showMessage(data.message || 'Ponto salvo com sucesso!', 'success');
        limparFormularioPonto();
        
        // Recalcular todas as distâncias (entre pontos e total da rota)
        showMessage('Recalculando distâncias...', 'success');
        await recalcularTodasDistancias(idRoteiro, true); // true = silencioso (não mostra mensagens intermediárias
        
        // Aguardar um pouco para garantir que todas as atualizações no banco foram concluídas
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Recarregar pontos do banco para pegar os valores atualizados
        await carregarPontos(idRoteiro);
        
        // Atualizar soma das distâncias
        await atualizarSomaDistancias();
        
        showMessage('Ponto salvo e distâncias recalculadas com sucesso!', 'success');
      } else {
        showMessage(data.error || 'Erro ao salvar ponto.', 'error');
      }
    } catch (err) {
      console.error('Erro ao salvar ponto:', err);
      showMessage('Erro ao salvar ponto. Tente novamente.', 'error');
    } finally {
      const btnSalvar = document.querySelector('#pontoForm button[type="submit"]');
      if (btnSalvar && typeof window.showLoading !== 'undefined') {
        window.showLoading(btnSalvar, false);
      }
      if (btnSalvar) btnSalvar.disabled = false;
      // Cooldown curto para absorver clicks duplos
      setTimeout(() => {
        window.__roteiros_salvarPontoSubmitting = false;
      }, 600);
    }
  }
  
  // Confirmar exclusão de ponto
  async function confirmarExclusaoPonto(sequencia) {
    // Normalizar sequencia para número
    const seqNum = typeof sequencia === 'string' ? parseInt(sequencia) : sequencia;
    
    if (isNaN(seqNum)) {
      showMessage('Erro: Sequência inválida.', 'error');
      return;
    }
    
    // Buscar ponto com comparação segura de tipos
    const ponto = pontosRoteiro.find(p => {
      const pSeq = typeof p.SEQUENCIA === 'string' ? parseInt(p.SEQUENCIA) : p.SEQUENCIA;
      return pSeq === seqNum;
    });
    
    if (!ponto) {
      showMessage('Ponto não encontrado na lista carregada.', 'error');
      return;
    }
    
    // Obter ID do roteiro do ponto ou usar roteiroAtualId
    const idRoteiroParaExclusao = ponto.IDROTEIRO || roteiroAtualId;
    
    if (!idRoteiroParaExclusao) {
      showMessage('Erro: Não foi possível identificar o roteiro. Recarregue os pontos e tente novamente.', 'error');
      return;
    }
    
    const modalEl = document.getElementById('confirmModal');
    const modalMessage = document.getElementById('modalMessage');
    const confirmYes = document.getElementById('confirmYes');
    const confirmNo = document.getElementById('confirmNo');
    
    if (!modalEl || !modalMessage || !confirmYes || !confirmNo) {
      showMessage('Erro: Elementos do modal não encontrados.', 'error');
      return;
    }
    
    modalMessage.innerHTML = `Deseja realmente excluir o ponto <strong>${ponto.DSLOCAL || 'N/A'}</strong>?`;
    modalEl.style.display = 'block';
    
    // Limpar listeners anteriores se existirem
    const limparListeners = () => {
      // Clonar e substituir os botões para remover todos os listeners
      const newConfirmYes = confirmYes.cloneNode(true);
      const newConfirmNo = confirmNo.cloneNode(true);
      confirmYes.parentNode.replaceChild(newConfirmYes, confirmYes);
      confirmNo.parentNode.replaceChild(newConfirmNo, confirmNo);
      return { newConfirmYes, newConfirmNo };
    };
    
    const { newConfirmYes, newConfirmNo } = limparListeners();
    
    // Definir função de exclusão
    const novoExcluir = async () => {
      // Fechar modal primeiro
      modalEl.style.display = 'none';
      
      // Mostrar overlay de cálculo
      mostrarCalculandoOverlay();
      
      try {
        const response = await fetch(`/api/roteiros/${idRoteiroParaExclusao}/pontos/${seqNum}`, {
          method: 'DELETE'
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Atualizar roteiroAtualId se necessário
          if (!roteiroAtualId) {
            roteiroAtualId = idRoteiroParaExclusao;
          }
          
          // Recalcular distâncias do roteiro após exclusão (silencioso para não mostrar mensagens duplicadas)
          await recalcularTodasDistancias(idRoteiroParaExclusao, true);
          
          // Aguardar um pouco mais para garantir que todas as atualizações no banco foram concluídas
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Recarregar pontos do banco para pegar os valores atualizados
          const pontosResponse = await fetch(`/api/roteiros/${idRoteiroParaExclusao}/pontos`);
          if (pontosResponse.ok) {
            const pontosAtualizados = await pontosResponse.json();
            
            pontosRoteiro = pontosAtualizados;
            roteiroAtualId = idRoteiroParaExclusao;
            
            // Atualizar título
            const pontosTitleEl = document.getElementById('pontosTitle');
            if (pontosTitleEl) {
              pontosTitleEl.textContent = `Pontos do Roteiro #${idRoteiroParaExclusao}`;
            }
            
            // Renderizar grid com dados atualizados
            if (typeof window.GridEditor !== 'undefined') {
              if (!gridPontos) {
                inicializarGridPontos();
              }
              if (gridPontos) {
                // Ordenar pontos por ORDEM antes de renderizar
                const pontosOrdenados = [...pontosRoteiro].sort((a, b) => (a.ORDEM || 0) - (b.ORDEM || 0));
                gridPontos.render(pontosOrdenados);
              }
            } else {
              console.warn('[Roteiros] GridEditor não está disponível. Recarregue a página.');
            }
            
            // Atualizar soma das distâncias
            await atualizarSomaDistancias();
          } else {
            console.error('[Pontos] Erro ao recarregar pontos:', pontosResponse.status);
          }
          
          // Mostrar mensagem de sucesso
          showMessage(data.message || 'Ponto excluído e distâncias recalculadas com sucesso!', 'success');
        } else {
          console.error('[Pontos] Erro ao excluir ponto:', data);
          showMessage(data.error || 'Erro ao excluir ponto.', 'error');
        }
      } catch (err) {
        console.error('[Pontos] Erro ao excluir ponto:', err);
        showMessage('Erro ao excluir ponto. Tente novamente.', 'error');
      } finally {
        // Esconder overlay ao finalizar
        esconderCalculandoOverlay();
      }
    };
    
    // Definir função de cancelamento
    const novoCancelar = () => {
      modalEl.style.display = 'none';
    };
    
    // Adicionar listeners aos novos botões
    newConfirmYes.addEventListener('click', novoExcluir);
    newConfirmNo.addEventListener('click', novoCancelar);
  }
  
  // Limpar formulário de ponto
  function limparFormularioPonto() {
    document.getElementById('pontoForm').reset();
    document.getElementById('pontoIdRoteiro').value = '';
    document.getElementById('pontoSequencia').value = '';
    document.getElementById('pontoSequenciaDisplay').value = '';
    document.getElementById('pontoFormTitle').textContent = 'Novo Ponto';
    document.getElementById('pontoFormContainer').style.display = 'none';
  }
  
  // Novo ponto
  function novoPonto() {
    // Se já temos pontos carregados, usar o ID do primeiro ponto como roteiro atual
    if (!roteiroAtualId && pontosRoteiro.length > 0) {
      const primeiro = pontosRoteiro[0];
      roteiroAtualId = primeiro.IDROTEIRO ?? primeiro.idroteiro ?? null;
    }
    if (!roteiroAtualId) {
      showMessage('Selecione um roteiro primeiro na aba "Dados".', 'error');
      return;
    }
    
    limparFormularioPonto();
    document.getElementById('pontoIdRoteiro').value = roteiroAtualId;
    
    // Gerar ordem padrão (última ordem + 1, ou 50 se não houver pontos, máximo 100)
    const ultimaOrdem = pontosRoteiro.length > 0 
      ? Math.min(Math.max(...pontosRoteiro.map(p => p.ORDEM || 0)) + 1, 100)
      : 50;
    document.getElementById('pontoOrdem').value = ultimaOrdem;
    
    document.getElementById('pontoFormContainer').style.display = 'block';
    document.getElementById('pontoFormContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  
  // Atualizar mapa com todos os pontos
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
      overlay.style.pointerEvents = 'auto'; // bloquear interação com o mapa enquanto carrega
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
      overlay.style.pointerEvents = 'none'; // não bloquear o mapa quando estiver oculto
      window.overlayMostrado = false;
    }
  }

  // Função para limpar completamente o mapa (marcadores e rotas)
  function limparMapa() {
    if (!mapa || typeof L === 'undefined') {
      console.warn('[Roteiros] Mapa não está disponível para limpeza');
      return;
    }

    // PRIMEIRO: Remover linha de rota se existir
    if (linhaRota) {
      try {
        mapa.removeLayer(linhaRota);
        linhaRota = null;
        console.log('🗺️ [ROTEIROS] Linha de rota removida');
      } catch (err) {
        console.warn('⚠️ [ROTEIROS] Erro ao remover linha de rota:', err);
      }
    }

    // PRIMEIRO: Coletar todas as camadas que precisam ser removidas
    const layersToRemove = [];

    // Coletar marcadores de pontos
    marcadoresPontos.forEach(m => {
      if (m) {
        layersToRemove.push(m);
      }
    });
    
    // Coletar linhas de pontos
    linhasPontos.forEach(l => {
      if (l) {
        layersToRemove.push(l);
      }
    });
    
    // Coletar marcadores de origem e destino
    if (marcadorOrigem) {
      layersToRemove.push(marcadorOrigem);
    }
    if (marcadorDestino) {
      layersToRemove.push(marcadorDestino);
    }
    
    // Coletar linha de rota
    if (linhaRota) {
      layersToRemove.push(linhaRota);
    }
    
    // SEGUNDO: Iterar sobre TODAS as camadas do mapa e coletar marcadores/linhas órfãs
    try {
      mapa.eachLayer((layer) => {
        // Manter apenas a camada de tiles (base do mapa)
        if (layer instanceof L.TileLayer) {
          return; // Não remover a camada de tiles
        }
        // Coletar todas as outras camadas (marcadores, linhas, círculos, etc.)
        if (layer instanceof L.Marker || 
            layer instanceof L.Polyline || 
            layer instanceof L.CircleMarker || 
            layer instanceof L.Circle ||
            layer instanceof L.Path) {
          // Verificar se já não está na lista
          if (!layersToRemove.includes(layer)) {
            layersToRemove.push(layer);
          }
        }
      });
    } catch (e) {
      console.warn('[Roteiros] Erro ao iterar camadas do mapa:', e);
    }
    
    // TERCEIRO: Remover todas as camadas coletadas
    let removidas = 0;
    layersToRemove.forEach(layer => {
      try {
        if (mapa.hasLayer && mapa.hasLayer(layer)) {
          mapa.removeLayer(layer);
          removidas++;
        } else {
          // Tentar remover mesmo sem verificar (pode ser que hasLayer não exista)
          try {
            mapa.removeLayer(layer);
            removidas++;
          } catch (e2) {
            // Ignorar erro
          }
        }
      } catch (e) {
        // Ignorar erro se a camada já foi removida
      }
    });
    
    // QUARTO: Limpar arrays e variáveis
    marcadoresPontos = [];
    linhasPontos = [];
    marcadorOrigem = null;
    marcadorDestino = null;
    linhaRota = null;
  }

  async function atualizarMapaComPontos() {
    if (!roteiroAtualId || !mapa) {
      console.log('[MAPA] atualizarMapaComPontos() ignorado: roteiroAtualId=', roteiroAtualId, 'mapa=', !!mapa);
      return;
    }
    if (atualizandoMapaComPontos) return;
    atualizandoMapaComPontos = true;
    console.log('[MAPA] atualizarMapaComPontos() iniciado para roteiro', roteiroAtualId);
    try {
      showMapaLoading('Carregando Rota', 'Carregando pontos e montando rota...');
      // SEMPRE limpar o mapa completamente antes de criar novos marcadores
      // Isso garante que não haja "resquícios" de rotas anteriores
      console.log('🗺️ [ROTEIROS] Limpando mapa antes de atualizar...');
      limparMapa();
      
      // Limpar também a linha de rota se existir (garantia extra)
      if (linhaRota) {
        try {
          mapa.removeLayer(linhaRota);
          console.log('🗺️ [ROTEIROS] Linha de rota removida (garantia extra)');
        } catch (err) {
          console.warn('⚠️ [ROTEIROS] Erro ao remover linha de rota (garantia extra):', err);
        }
        linhaRota = null;
      }
      
      // Aguardar um pouco para garantir que a limpeza foi concluída
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Atualizar mensagem do overlay
      showMapaLoading('Carregando Pontos', 'Buscando pontos do roteiro...');
      
      // Carregar pontos se ainda não foram carregados
      if (pontosRoteiro.length === 0) {
        await carregarPontos(roteiroAtualId, true); // silencioso = true
      }
      
      if (pontosRoteiro.length === 0) {
        console.warn('[MAPA] Roteiro sem pontos cadastrados');
        hideMapaLoading();
        showMessage('Nenhum ponto cadastrado para este roteiro.', 'error');
        return;
      }
      console.log('[MAPA] Pontos do roteiro:', pontosRoteiro.length, '→', pontosRoteiro.map(p => ({ ORDEM: p.ORDEM, DSLOCAL: p.DSLOCAL, lat: p.LATITUDE, lon: p.LONGITUDE })));
      showMapaLoading('Montando Rota', 'Criando marcadores e traçando rota...');
      
      // Filtrar pontos com coordenadas e ordenar por ORDEM (garantir ordenação numérica)
      const pontosComCoordenadas = pontosRoteiro
        .filter(p => p.LATITUDE && p.LONGITUDE)
        .sort((a, b) => {
          // Converter ORDEM para número para ordenação correta
          const ordemA = parseFloat(a.ORDEM) || 0;
          const ordemB = parseFloat(b.ORDEM) || 0;
          return ordemA - ordemB;
        });
      
      // Debug: evitar logs repetidos (variável mantida para compatibilidade)
      if (!window._roteirosDebugPontos || JSON.stringify(pontosComCoordenadas.map(p => p.ORDEM)) !== window._roteirosDebugPontos) {
        window._roteirosDebugPontos = JSON.stringify(pontosComCoordenadas.map(p => p.ORDEM));
      }
      
      if (pontosComCoordenadas.length === 0) {
        console.log('[MAPA] Nenhum ponto com coordenadas → fallback para atualizarMapa() (origem/destino do formulário)');
        hideMapaLoading();
        showMessage('Nenhum ponto com coordenadas válidas. Usando origem e destino do formulário...', 'warning');
        atualizandoMapaComPontos = false;
        await atualizarMapa();
        return;
      }
      
      if (pontosComCoordenadas.length === 1) {
        console.log('[MAPA] Apenas 1 ponto com coordenadas → fallback para atualizarMapa()');
        hideMapaLoading();
        showMessage('Apenas um ponto com coordenadas. Completando com origem/destino do formulário...', 'warning');
        atualizandoMapaComPontos = false;
        await atualizarMapa();
        return;
      }
      
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
      
      const latlngs = [];
      
      // Calcular distâncias acumuladas desde a origem
      let distanciaAcumulada = 0;
      
      pontosComCoordenadas.forEach((ponto, index) => {
        if (!ponto.LATITUDE || !ponto.LONGITUDE) return;
        
        // Normalizar TPLOCAL - garantir que seja string e uppercase, tratar null/undefined
        let tipoLocal = '';
        if (ponto.TPLOCAL !== null && ponto.TPLOCAL !== undefined) {
          tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
        }
        
        const isPrimeiro = index === 0;
        const isUltimo = index === pontosComCoordenadas.length - 1;
        const isIntermediario = !isPrimeiro && !isUltimo;
        
        // Lógica de ajuste de tipos (mesma de Gerenciar Viagens):
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
        
        // Tipo ajustado automaticamente se necessário
        
        const cor = cores[tipoLocal] || '#95a5a6';
        const icone = icones[tipoLocal] || '📍';
        const descricaoTipo = tiposDescricao[tipoLocal] || tipoLocal || 'Não definido';
        
        // Calcular distância acumulada (somar distâncias dos pontos anteriores)
        if (index > 0 && ponto.KMENTREPONTOS) {
          distanciaAcumulada += parseFloat(ponto.KMENTREPONTOS) || 0;
        }
        
        // Criar marcador customizado com tamanho ajustado para melhor visibilidade
        const tamanhoMarcador = (tipoLocal === 'O' || tipoLocal === 'D') ? 35 : 30;
        const tamanhoFonte = (tipoLocal === 'O' || tipoLocal === 'D') ? 16 : 14;
        const numeroOrdem = isIntermediario ? `<span style="font-size: 10px; font-weight: bold; position: absolute; top: -2px; right: -2px; background: white; border-radius: 50%; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; border: 2px solid ${cor};">${index + 1}</span>` : '';
        
        const marcador = L.marker([ponto.LATITUDE, ponto.LONGITUDE], {
          icon: L.divIcon({
            className: 'custom-marker',
            html: `<div style="
              background: ${cor};
              width: ${tamanhoMarcador}px;
              height: ${tamanhoMarcador}px;
              border-radius: 50%;
              border: 3px solid white;
              box-shadow: 0 2px 8px rgba(0,0,0,0.3);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: ${tamanhoFonte}px;
              position: relative;
            ">${icone}${numeroOrdem}</div>`,
            iconSize: [tamanhoMarcador, tamanhoMarcador],
            iconAnchor: [tamanhoMarcador / 2, tamanhoMarcador / 2]
          })
        }).addTo(mapa);
        
        // Popup com informações
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
        
        marcadoresPontos.push(marcador);
        latlngs.push([ponto.LATITUDE, ponto.LONGITUDE]);
      });
      
      // Atualizar mensagem do overlay
      showMapaLoading('Traçando Rota', 'Calculando rota real entre os pontos...');
      
      // DEBUG: Verificar ordem dos pontos antes de calcular rota
      console.log('🗺️ [ROTEIROS] Pontos ordenados para rota:', pontosComCoordenadas.map((p, idx) => ({
        indice: idx,
        ordem: p.ORDEM,
        sequencia: p.SEQUENCIA,
        local: p.DSLOCAL,
        coordenadas: [p.LATITUDE, p.LONGITUDE]
      })));
      
      // Desenhar linha conectando todos os pontos
      let osrmData = null; // Variável para armazenar dados do OSRM
      
      if (latlngs.length > 1) {
        // OTIMIZAÇÃO: Para poucos pontos (≤5), não precisa de steps=true (mais rápido)
        const totalPontos = latlngs.length;
        const usarSteps = totalPontos > 5; // Só usar steps para muitos pontos
        
        // Tentar obter rota do OSRM (com timeout para não travar)
        try {
          const coordsStr = latlngs.map(c => `${c[1]},${c[0]}`).join(';');
          console.log('🗺️ [ROTEIROS] Coordenadas enviadas ao OSRM:', coordsStr);
          // Para poucos pontos, remover steps=true para ser mais rápido
          const osrmUrl = usarSteps 
            ? `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full&geometries=geojson&steps=true`
            : `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?overview=full&geometries=geojson`;
          
          // Usar AbortController para timeout (reduzir timeout para poucos pontos)
          const controller = new AbortController();
          const timeout = totalPontos <= 5 ? 10000 : 30000; // 10s para poucos pontos, 30s para muitos
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          
          const response = await fetch(osrmUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          osrmData = await response.json();
          
          if (osrmData.code === 'Ok' && osrmData.routes && osrmData.routes.length > 0) {
            const geometry = osrmData.routes[0].geometry.coordinates;
            const routeLatLngs = geometry.map(c => [c[1], c[0]]);
            
            console.log('✅ [ROTEIROS] Rota OSRM calculada com sucesso:', {
              totalPontos: routeLatLngs.length,
              primeiroPonto: routeLatLngs[0],
              ultimoPonto: routeLatLngs[routeLatLngs.length - 1],
              distancia: (osrmData.routes[0].distance / 1000).toFixed(2) + ' km'
            });
            
            // IMPORTANTE: Limpar rota anterior ANTES de criar nova
            if (linhaRota) {
              try {
                mapa.removeLayer(linhaRota);
                console.log('🗺️ [ROTEIROS] Rota anterior removida antes de desenhar nova');
              } catch (err) {
                console.warn('⚠️ [ROTEIROS] Erro ao remover rota anterior:', err);
              }
              linhaRota = null;
            }
            
            // Criar nova rota
            linhaRota = L.polyline(routeLatLngs, {
              color: '#3498db',
              weight: 4,
              opacity: 0.7
            }).addTo(mapa);
            
            const distanciaTotal = (osrmData.routes[0].distance / 1000).toFixed(2);
            linhaRota.bindPopup(`<strong>Distância total da rota:</strong> ${distanciaTotal} km`);
            console.log('✅ [ROTEIROS] Nova rota desenhada no mapa');
          } else {
            // Fallback: linha reta se OSRM não retornar rota válida
            linhaRota = L.polyline(latlngs, {
              color: '#3498db',
              weight: 4,
              opacity: 0.7,
              dashArray: '10, 10'
            }).addTo(mapa);
            osrmData = null; // Limpar dados inválidos
          }
        } catch (err) {
          if (err.name !== 'AbortError') {
            console.warn('Erro ao obter rota do OSRM, usando linha reta:', err);
          }
          // Fallback: linha reta
          linhaRota = L.polyline(latlngs, {
            color: '#3498db',
            weight: 4,
            opacity: 0.7,
            dashArray: '10, 10'
          }).addTo(mapa);
          osrmData = null; // Limpar dados em caso de erro
        }
      }
      
      // Atualizar mensagem do overlay
      showMapaLoading('Ajustando Visualização', 'Ajustando zoom para mostrar toda a rota...');
      
      // Ajustar zoom para mostrar todos os pontos (sem delay)
      if (latlngs.length > 0) {
        const grupo = new L.featureGroup(marcadoresPontos);
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
      
      // Esconder overlay após um pequeno delay para garantir que tudo foi renderizado
      requestAnimationFrame(() => {
        setTimeout(() => {
          hideMapaLoading();
        }, 300);
      });
      
      // NÃO gerar resumo automaticamente - só gerar quando o usuário clicar em "Calcular"
      // O resumo será gerado apenas quando:
      // 1. Usuário clicar no botão "Calcular"
      // 2. Usuário alterar origem/destino e recalcular
      // await gerarResumoRota(osrmData, coordenadasParaResumo); // REMOVIDO - cálculo só manual
    } catch (err) {
      hideMapaLoading();
      console.error('Erro ao atualizar mapa com pontos:', err);
      showMessage('Erro ao atualizar mapa.', 'error');
    } finally {
      // SEMPRE resetar a flag, mesmo em caso de erro
      atualizandoMapaComPontos = false;
    }
  }
  
  // Função removida - resumo da rota não será mais gerado automaticamente
  // O campo RESUMOROTA pode ser preenchido manualmente pelo usuário
  // NOTA: Esta função foi removida para evitar conflito com gerarResumoRota() que chama a API
  // async function gerarResumoRotaAntiga(osrmData, coordenadas) {
  //   // Função desabilitada - não faz nada
  //   return;
  // }
  
  // Variáveis para o mapa de seleção
  let mapaSelecao = null;
  let marcadorSelecao = null;
  let posicaoSelecionada = null;
  let isDraggingModal = false;
  let modalDragOffset = { x: 0, y: 0 };

  // Função para inicializar o mapa de seleção
  async function inicializarMapaSelecao(coordenadasIniciais = null) {
    // Verificar se Leaflet está disponível
    if (typeof L === 'undefined') {
      console.log('[Mapa Seleção] Leaflet não está carregado, aguardando...');
      return null;
    }
    
    const modalMapaSelecao = document.getElementById('modalSelecionarMapa');
    if (!modalMapaSelecao) {
      console.error('[Mapa Seleção] Modal não encontrado (id: modalSelecionarMapa)');
      return null;
    }

    const mapaDiv = document.getElementById('mapaSelecao');
    if (!mapaDiv) {
      console.warn('[Mapa Seleção] Elemento mapaSelecao não encontrado no DOM');
      return null;
    }
    
    const mapaContainer = modalMapaSelecao.querySelector('#mapaSelecao');
    if (!mapaContainer) {
      console.error('[Mapa Seleção] Container do mapa não encontrado');
      return null;
    }
    
    // Inicializar mapa se ainda não foi inicializado
    if (!mapaSelecao) {
      const viewCenter = coordenadasIniciais
        ? [coordenadasIniciais.lat, coordenadasIniciais.lng]
        : [-23.5505, -46.6333];
      const viewZoom = coordenadasIniciais ? 15 : 5;
      mapaSelecao = L.map('mapaSelecao').setView(viewCenter, viewZoom);
      
      // Configurar tile layer
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      const tileOptions = {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      };
      
      if (tileServer.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileServer, tileOptions).addTo(mapaSelecao);

      // Duplo clique para selecionar posição
      mapaSelecao.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        await criarMarcadorSelecao(lat, lng);
      });

      // Se já há coordenadas (ex.: lat/lng preenchidos no formulário), centralizar e colocar marcador
      if (coordenadasIniciais) {
        mapaSelecao.setView([coordenadasIniciais.lat, coordenadasIniciais.lng], 15);
        const posicaoAtual = document.getElementById('pontoPosicao')?.value || '';
        await criarMarcadorSelecao(coordenadasIniciais.lat, coordenadasIniciais.lng, posicaoAtual);
      }
    }
    
    return mapaSelecao;
  }
  
  // Função gerarResumoRota foi desabilitada - código removido
  // O campo RESUMOROTA pode ser preenchido manualmente pelo usuário
  
  // Função para atualizar mapa de seleção quando modal é aberto
  async function atualizarMapaSelecao(coordenadasIniciais = null) {
    if (mapaSelecao) {
      // Já inicializado, apenas invalidar tamanho e atualizar view
      try {
        mapaSelecao.invalidateSize();
        if (coordenadasIniciais) {
          mapaSelecao.setView([coordenadasIniciais.lat, coordenadasIniciais.lng], 15);
        } else {
          mapaSelecao.setView([-14.2350, -51.9253], 4);
        }
      } catch (e) {
        console.warn('[Mapa Seleção] Erro ao invalidar tamanho:', e);
      }
      return;
    }

    try {
      // Verificar se o elemento está visível
      const modal = document.getElementById('modalSelecionarMapa');
      if (modal) {
        // Garantir que o modal está visível
        if (modal.style.display === 'none') {
          modal.style.display = 'block';
        }
        // Aguardar um pouco para o elemento estar totalmente visível
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Verificar novamente se o elemento está visível
      if (mapaDiv.offsetParent === null && mapaDiv.offsetWidth === 0 && mapaDiv.offsetHeight === 0) {
        // Elemento ainda não está visível, aguardar mais um pouco
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Limpar conteúdo anterior se houver
      mapaDiv.innerHTML = '';
      
      console.log('[Mapa Seleção] Inicializando mapa...');
      
      // Determinar coordenadas e zoom iniciais
      let viewLat = -14.2350;
      let viewLng = -51.9253;
      let viewZoom = 4;
      
      if (coordenadasIniciais) {
        viewLat = coordenadasIniciais.lat;
        viewLng = coordenadasIniciais.lng;
        viewZoom = 15; // Zoom próximo para ajuste fino
      }
      
      // Criar mapa
      mapaSelecao = L.map('mapaSelecao', {
        preferCanvas: false
      }).setView([viewLat, viewLng], viewZoom);

      // Adicionar camada de tiles do OpenStreetMap
      // IMPORTANTE: Forçar HTTP (não HTTPS) para evitar ERR_SSL_PROTOCOL_ERROR
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      const tileOptions = {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileServer.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileServer, tileOptions).addTo(mapaSelecao);
      
      // Aguardar o mapa carregar completamente
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('[Mapa Seleção] Mapa inicializado com sucesso');

      // Event listener para double-click
      mapaSelecao.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        await criarMarcadorSelecao(lat, lng);
      });
      
      // Se há coordenadas iniciais, criar marcador
      if (coordenadasIniciais) {
        const posicaoAtual = document.getElementById('pontoPosicao')?.value;
        await criarMarcadorSelecao(coordenadasIniciais.lat, coordenadasIniciais.lng, posicaoAtual);
      }
      
      // Forçar invalidateSize múltiplas vezes para garantir renderização correta
      for (let i = 0; i < 3; i++) {
        try {
          if (mapaSelecao) {
            mapaSelecao.invalidateSize();
          }
        } catch (e) {
          console.warn('[Mapa Seleção] Erro ao invalidar tamanho:', e);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error('[Mapa Seleção] Erro ao inicializar mapa:', err);
    }
  }
  
  // Código órfão removido - estava incorretamente dentro de atualizarMapaSelecao
  // Este código de processamento de rotas não deveria estar aqui
  
  // Função para atualizar mapa de seleção quando modal é aberto
  async function atualizarMapaSelecao(coordenadasIniciais = null) {
    if (mapaSelecao) {
      // Já inicializado, apenas invalidar tamanho e atualizar view
      try {
        mapaSelecao.invalidateSize();
        if (coordenadasIniciais) {
          mapaSelecao.setView([coordenadasIniciais.lat, coordenadasIniciais.lng], 15);
        } else {
          mapaSelecao.setView([-14.2350, -51.9253], 4);
        }
      } catch (e) {
        console.warn('[Mapa Seleção] Erro ao invalidar tamanho:', e);
      }
      return;
    }

    try {
      // Verificar se o elemento está visível
      const modal = document.getElementById('modalSelecionarMapa');
      if (modal) {
        // Garantir que o modal está visível
        if (modal.style.display === 'none') {
          modal.style.display = 'block';
        }
        // Aguardar um pouco para o elemento estar totalmente visível
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      
      // Verificar novamente se o elemento está visível
      if (mapaDiv.offsetParent === null && mapaDiv.offsetWidth === 0 && mapaDiv.offsetHeight === 0) {
        // Elemento ainda não está visível, aguardar mais um pouco
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // Limpar conteúdo anterior se houver
      mapaDiv.innerHTML = '';
      
      console.log('[Mapa Seleção] Inicializando mapa...');
      
      // Determinar coordenadas e zoom iniciais
      let viewLat = -14.2350;
      let viewLng = -51.9253;
      let viewZoom = 4;
      
      if (coordenadasIniciais) {
        viewLat = coordenadasIniciais.lat;
        viewLng = coordenadasIniciais.lng;
        viewZoom = 15; // Zoom próximo para ajuste fino
      }
      
      // Criar mapa
      mapaSelecao = L.map('mapaSelecao', {
        preferCanvas: false
      }).setView([viewLat, viewLng], viewZoom);

      // Adicionar camada de tiles do OpenStreetMap
      // IMPORTANTE: Forçar HTTP (não HTTPS) para evitar ERR_SSL_PROTOCOL_ERROR
      let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (window.MAP_CONFIG?.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
      const tileOptions = {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19
      };
      
      // Se usar servidor OpenStreetMap com {s}, adicionar subdomínios
      if (tileServer.includes('{s}')) {
        tileOptions.subdomains = ['a', 'b', 'c'];
      }
      
      L.tileLayer(tileServer, tileOptions).addTo(mapaSelecao);
      
      // Aguardar o mapa carregar completamente
      await new Promise(resolve => setTimeout(resolve, 300));
      
      console.log('[Mapa Seleção] Mapa inicializado com sucesso');

      // Event listener para double-click
      mapaSelecao.on('dblclick', async (e) => {
        const { lat, lng } = e.latlng;
        await criarMarcadorSelecao(lat, lng);
      });
      
      // Se há coordenadas iniciais, criar marcador
      if (coordenadasIniciais) {
        const posicaoAtual = document.getElementById('pontoPosicao')?.value;
        await criarMarcadorSelecao(coordenadasIniciais.lat, coordenadasIniciais.lng, posicaoAtual);
      }
      
      // Forçar invalidateSize múltiplas vezes para garantir renderização correta
      for (let i = 0; i < 3; i++) {
        try {
          if (mapaSelecao) {
            mapaSelecao.invalidateSize();
          }
        } catch (e) {
          console.warn('[Mapa Seleção] Erro ao invalidar tamanho:', e);
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err) {
      console.error('Erro ao inicializar mapa de seleção:', err);
      // Limpar referência se houver erro
      if (mapaSelecao) {
        try {
          mapaSelecao.remove();
        } catch (e) {
          // Ignorar erro
        }
        mapaSelecao = null;
      }
      showMessage('Erro ao inicializar o mapa. Verifique se a biblioteca foi carregada.', 'error');
    }
  }

  // Função para abrir modal de seleção no mapa
  async function abrirModalSelecaoMapa() {
    const modal = document.getElementById('modalSelecionarMapa');
    if (!modal) return;
    
    // Aguardar Leaflet estar disponível
    showMessage('Carregando biblioteca de mapas...', 'success');
    const leafletDisponivel = await aguardarLeaflet();
    if (!leafletDisponivel) {
      showMessage('Erro ao carregar a biblioteca de mapas. Recarregue a página.', 'error');
      return;
    }
    
    // Verificar se há coordenadas já preenchidas na tela
    const latAtual = document.getElementById('pontoLatitude')?.value;
    const lngAtual = document.getElementById('pontoLongitude')?.value;
    const posicaoAtual = document.getElementById('pontoPosicao')?.value;
    
    let coordenadasIniciais = null;
    if (latAtual && lngAtual) {
      const lat = parseFloat(latAtual);
      const lng = parseFloat(lngAtual);
      if (!isNaN(lat) && !isNaN(lng)) {
        coordenadasIniciais = { lat, lng };
        // Se já há posição preenchida, usar ela como inicial
        posicaoSelecionada = { lat, lng, endereco: posicaoAtual || '' };
      }
    }
    
    // Resetar marcador se não há coordenadas iniciais
    if (!coordenadasIniciais) {
      posicaoSelecionada = null;
      if (marcadorSelecao && mapaSelecao) {
        mapaSelecao.removeLayer(marcadorSelecao);
        marcadorSelecao = null;
      }
    }
    
    const infoPosicao = document.getElementById('infoPosicaoSelecionada');
    if (infoPosicao) {
      if (coordenadasIniciais) {
        infoPosicao.innerHTML = `
          <strong>Coordenadas atuais:</strong> ${coordenadasIniciais.lat.toFixed(6)}, ${coordenadasIniciais.lng.toFixed(6)}<br>
          <strong>Endereço:</strong> ${posicaoAtual || 'Não informado'}<br>
          <small style="color: #666;">Dê dois cliques no mapa ou arraste o marcador para ajustar a posição.</small>
        `;
      } else {
        infoPosicao.innerHTML = 'Nenhuma posição selecionada ainda. Dê dois cliques no mapa.';
      }
    }
    
    const btnConfirmar = document.getElementById('btnConfirmarPosicao');
    if (btnConfirmar) {
      btnConfirmar.disabled = !coordenadasIniciais;
    }
    
    // Resetar posição do modal para o centro
    const modalContent = modal.querySelector('.modal-content');
    if (modalContent) {
      modalContent.style.left = '50%';
      modalContent.style.top = '50%';
      modalContent.style.transform = 'translate(-50%, -50%)';
      modalContent.style.margin = '0';
      modalContent.style.position = 'absolute';
    }
    
    // Abrir modal
    modal.style.display = 'flex';
    
    // Aguardar um pouco para o modal renderizar
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Inicializar mapa se ainda não foi inicializado
    if (!mapaSelecao) {
      await inicializarMapaSelecao(coordenadasIniciais);
      // Aguardar mais um pouco para garantir inicialização completa
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      // Se o mapa já existe, apenas atualizar a view
      if (coordenadasIniciais) {
        mapaSelecao.setView([coordenadasIniciais.lat, coordenadasIniciais.lng], 15);
        // Criar marcador na posição inicial se não existir
        if (!marcadorSelecao) {
          await criarMarcadorSelecao(coordenadasIniciais.lat, coordenadasIniciais.lng, posicaoAtual);
        } else {
          // Se o marcador já existe, apenas atualizar sua posição
          marcadorSelecao.setLatLng([coordenadasIniciais.lat, coordenadasIniciais.lng]);
        }
      } else {
        mapaSelecao.setView([-14.2350, -51.9253], 4);
      }
    }
    
    // Invalidar tamanho do mapa para garantir renderização correta
    if (mapaSelecao) {
      setTimeout(() => {
        try {
          mapaSelecao.invalidateSize();
        } catch (e) {
          console.warn('[Mapa Seleção] Erro ao invalidar tamanho:', e);
        }
      }, 300);
    } else {
      console.error('[Mapa Seleção] Mapa não foi inicializado');
      showMessage('Erro ao inicializar o mapa. Tente novamente.', 'error');
    }
  }
  
  // Funções para arrastar o modal
  function iniciarArrastarModal(e) {
    const modal = document.getElementById('modalSelecionarMapa');
    if (!modal || modal.style.display === 'none') return;
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;
    
    // Não arrastar se clicar em botões ou inputs
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('button') || e.target.closest('input')) {
      return;
    }
    
    isDraggingModal = true;
    const rect = modalContent.getBoundingClientRect();
    modalDragOffset.x = e.clientX - rect.left;
    modalDragOffset.y = e.clientY - rect.top;
    
    modalContent.style.cursor = 'move';
    e.preventDefault();
  }
  
  function arrastarModal(e) {
    if (!isDraggingModal) return;
    
    const modal = document.getElementById('modalSelecionarMapa');
    if (!modal) return;
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;
    
    const x = e.clientX - modalDragOffset.x;
    const y = e.clientY - modalDragOffset.y;
    
    // Limitar movimento dentro da viewport
    const maxX = window.innerWidth - modalContent.offsetWidth;
    const maxY = window.innerHeight - modalContent.offsetHeight;
    
    const finalX = Math.max(0, Math.min(x, maxX));
    const finalY = Math.max(0, Math.min(y, maxY));
    
    modalContent.style.left = finalX + 'px';
    modalContent.style.top = finalY + 'px';
    modalContent.style.transform = 'none';
    modalContent.style.margin = '0';
  }
  
  function pararArrastarModal() {
    if (!isDraggingModal) return;
    isDraggingModal = false;
    
    const modal = document.getElementById('modalSelecionarMapa');
    if (!modal) return;
    
    const modalContent = modal.querySelector('.modal-content');
    if (!modalContent) return;
    
    modalContent.style.cursor = 'move';
  }
  
  // Função auxiliar para criar marcador de seleção
  async function criarMarcadorSelecao(lat, lng, enderecoInicial = null) {
    if (!mapaSelecao || typeof L === 'undefined') return;
    
    // Remover marcador anterior se existir
    if (marcadorSelecao) {
      mapaSelecao.removeLayer(marcadorSelecao);
    }
    
    // Criar novo marcador na posição
    marcadorSelecao = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          background: #e74c3c;
          width: 30px;
          height: 30px;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
        ">📍</div>`,
        iconSize: [30, 30],
        iconAnchor: [15, 15]
      }),
      draggable: true // Permitir arrastar o marcador
    }).addTo(mapaSelecao);
    
    // Event listener para quando o marcador for arrastado
    marcadorSelecao.on('dragend', async function(e) {
      const marker = e.target;
      const position = marker.getLatLng();
      await atualizarPosicaoSelecionada(position.lat, position.lng);
    });
    
    // Armazenar posição selecionada
    posicaoSelecionada = { lat, lng, endereco: enderecoInicial || '' };
    
    // Buscar endereço se não foi fornecido
    if (!enderecoInicial) {
      await atualizarPosicaoSelecionada(lat, lng);
    } else {
      // Atualizar informações na tela
      const infoPosicao = document.getElementById('infoPosicaoSelecionada');
      if (infoPosicao) {
        infoPosicao.innerHTML = `
          <strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
          <strong>Endereço:</strong> ${enderecoInicial}
        `;
      }
      document.getElementById('btnConfirmarPosicao').disabled = false;
    }
  }
  
  // Função auxiliar para atualizar posição selecionada
  async function atualizarPosicaoSelecionada(lat, lng) {
    posicaoSelecionada = { lat, lng };
    
    // Buscar endereço usando reverse geocoding (Nominatim)
    try {
      const nominatimServer = window.MAP_CONFIG?.nominatimServer || 'http://app.integrabrasil.com:8080/nominatim';
      const reverseUrl = `${nominatimServer}/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`;
      const reverseResponse = await fetch(reverseUrl, {
        headers: {
          'User-Agent': 'AtlasCargo/2.0'
        }
      });
      
      const reverseData = await reverseResponse.json();
      
      if (reverseData && reverseData.display_name) {
        const endereco = reverseData.display_name;
        const address = reverseData.address || {};
        
        // Atualizar informações na tela
        const infoPosicao = document.getElementById('infoPosicaoSelecionada');
        if (infoPosicao) {
          infoPosicao.innerHTML = `
            <strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
            <strong>Endereço:</strong> ${endereco}
          `;
        }
        
        // Habilitar botão de confirmar
        document.getElementById('btnConfirmarPosicao').disabled = false;
        
        // Armazenar endereço completo
        posicaoSelecionada.endereco = endereco;
        posicaoSelecionada.address = address;
      } else {
        const infoPosicao = document.getElementById('infoPosicaoSelecionada');
        if (infoPosicao) {
          infoPosicao.innerHTML = `
            <strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
            <strong>Endereço:</strong> Não foi possível obter o endereço.
          `;
        }
        posicaoSelecionada.endereco = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        document.getElementById('btnConfirmarPosicao').disabled = false;
      }
    } catch (err) {
      console.error('Erro ao buscar endereço:', err);
      const infoPosicao = document.getElementById('infoPosicaoSelecionada');
      if (infoPosicao) {
        infoPosicao.innerHTML = `
          <strong>Coordenadas:</strong> ${lat.toFixed(6)}, ${lng.toFixed(6)}<br>
          <strong>Endereço:</strong> Erro ao buscar endereço.
        `;
      }
      posicaoSelecionada.endereco = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      document.getElementById('btnConfirmarPosicao').disabled = false;
    }
  }

  // Função para confirmar posição selecionada
  function confirmarPosicaoSelecionada() {
    if (!posicaoSelecionada) {
      showMessage('Nenhuma posição foi selecionada. Dê dois cliques no mapa.', 'error');
      return;
    }
    
    // Preencher campos
    if (posicaoSelecionada.endereco) {
      document.getElementById('pontoPosicao').value = posicaoSelecionada.endereco;
    }
    if (posicaoSelecionada.lat) {
      document.getElementById('pontoLatitude').value = posicaoSelecionada.lat.toFixed(6);
    }
    if (posicaoSelecionada.lng) {
      document.getElementById('pontoLongitude').value = posicaoSelecionada.lng.toFixed(6);
    }
    
    // Preencher país e estado se disponíveis
    if (posicaoSelecionada.address) {
      const address = posicaoSelecionada.address;
      
      // País
      const nomePais = address.country || address.country_code || '';
      if (nomePais) {
        buscarCodigoPais(nomePais).then(codigoPais => {
          if (codigoPais) {
            document.getElementById('pontoPais').value = codigoPais;
          }
        });
      }
      
      // Estado (UF)
      const estado = address.state || address.region || '';
      if (estado) {
        const uf = mapearEstadoParaUF(estado);
        if (uf) {
          document.getElementById('pontoEstado').value = uf;
        } else {
          const estadoUpper = estado.toUpperCase().trim();
          if (estadoUpper.length === 2) {
            document.getElementById('pontoEstado').value = estadoUpper;
          }
        }
      }
    }
    
    // Fechar modal
    fecharModalSelecaoMapa();
    showMessage('Posição selecionada e campos preenchidos!', 'success');
  }
  
  // Função para fechar modal de seleção
  function fecharModalSelecaoMapa() {
    const modal = document.getElementById('modalSelecionarMapa');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  // Event listeners para pontos (com proteção contra registro duplicado ao recarregar o módulo)
  (function bindPontosListeners() {
    const pontoForm = document.getElementById('pontoForm');
    if (pontoForm && !pontoForm.dataset.bound) {
      pontoForm.addEventListener('submit', salvarPonto);
      pontoForm.dataset.bound = '1';
    }

    const bindClickOnce = (id, handler) => {
      const el = document.getElementById(id);
      if (!el || el.dataset.bound) return;
      el.addEventListener('click', handler);
      el.dataset.bound = '1';
    };

    bindClickOnce('btnNovoPonto', novoPonto);
    bindClickOnce('btnCancelarPonto', limparFormularioPonto);
    bindClickOnce('btnVoltarPontos', () => showTab('dados'));
    bindClickOnce('btnBuscarCoordenadas', buscarCoordenadas);
    bindClickOnce('btnSelecionarNoMapa', abrirModalSelecaoMapa);
    bindClickOnce('btnConfirmarPosicao', confirmarPosicaoSelecionada);
  })();
  
  // Fechar modal ao clicar no X ou Cancelar
  document.getElementById('btnFecharModalMapa')?.addEventListener('click', fecharModalSelecaoMapa);
  document.getElementById('btnCancelarSelecaoMapa')?.addEventListener('click', fecharModalSelecaoMapa);
  
  // Fechar modal ao clicar fora dele
  document.getElementById('modalSelecionarMapa')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalSelecionarMapa') {
      fecharModalSelecaoMapa();
    }
  });
  
  // Event listeners para arrastar o modal
  const modalSelecao = document.getElementById('modalSelecionarMapa');
  if (modalSelecao) {
    const modalHeader = modalSelecao.querySelector('.map-modal-header');
    if (modalHeader) {
      modalHeader.addEventListener('mousedown', iniciarArrastarModal);
    }
    
    document.addEventListener('mousemove', arrastarModal);
    document.addEventListener('mouseup', pararArrastarModal);
  }
  
  // Função para fechar modal de seleção
  function fecharModalSelecaoMapa() {
    const modal = document.getElementById('modalSelecionarMapa');
    if (modal) {
      modal.style.display = 'none';
    }
  }
  
  // Carregar países ao inicializar
  loadPaises();

  // Função para mostrar ajuda
  // Função de ajuda
  window.mostrarAjudaRoteiros = function() {
    // Remover qualquer modal de ajuda existente primeiro
    const modalExistente = document.getElementById('modalAjudaRoteiros');
    if (modalExistente) {
      modalExistente.remove();
    }
    
    // Criar modal de ajuda com padrão único
    const modal = document.createElement('div');
    modal.id = 'modalAjudaRoteiros';
    modal.className = 'modal-tratamento';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content-tratamento">
        <div class="modal-header-tratamento">
          <h3><i class='bx bx-help-circle'></i> Ajuda - Gerenciar Roteiros</h3>
          <button onclick="window.fecharModalAjudaRoteiros()" class="btn-close-modal" type="button">
            <i class='bx bx-x'></i>
          </button>
        </div>
        <div class="modal-body-tratamento">
          <h4>📋 Sobre o Módulo</h4>
          <p>O módulo <strong>Gerenciar Roteiros</strong> permite gerenciar os roteiros de viagem cadastrados no sistema, incluindo origem, destino, pontos intermediários e visualização no mapa.</p>
          
          <h4>🔍 Filtros</h4>
          <p>Use os filtros para buscar roteiros específicos por código, descrição, origem ou destino.</p>
          
          <h4><i class='bx bx-list-check'></i> Funcionalidades</h4>
          <ul>
            <li><strong>Filtros:</strong> Buscar e filtrar roteiros</li>
            <li><strong>Grid:</strong> Visualizar roteiros em formato de tabela com opções de edição e exclusão</li>
            <li><strong>Dados:</strong> Criar e editar roteiros, definindo origem, destino e distância</li>
            <li><strong>Pontos:</strong> Gerencie pontos intermediários do roteiro (origem, passagem, destino, parada)</li>
            <li><strong>Mapa:</strong> Visualize o roteiro completo no mapa com todos os pontos</li>
          </ul>
          
          <h4><i class='bx bx-map-pin'></i> Pontos do Roteiro</h4>
          <ul>
            <li><strong>Origem (O):</strong> Ponto inicial do roteiro (Ordem 1)</li>
            <li><strong>Destino (D):</strong> Ponto final do roteiro (Ordem 100)</li>
            <li><strong>Passagem (P):</strong> Pontos intermediários (Ordem 2-99)</li>
            <li><strong>Parada (R):</strong> Pontos de parada (Ordem 2-99)</li>
          </ul>
          
          <h4><i class='bx bx-ruler'></i> Cálculo de Distância</h4>
          <ul>
            <li>O sistema calcula automaticamente a distância total do roteiro usando rotas reais (OSRM)</li>
            <li>As distâncias entre pontos são calculadas e atualizadas automaticamente</li>
            <li>É possível recalcular as distâncias manualmente na aba "Pontos"</li>
          </ul>
          
          <h4><i class='bx bx-map-alt'></i> Resumo da Rota</h4>
          <ul>
            <li>O campo "Resumo da Rota" é gerado automaticamente com base nos pontos cadastrados</li>
            <li>O resumo mostra a sequência de cidades do roteiro de forma resumida</li>
            <li>É possível gerar o resumo manualmente clicando no botão "Gerar Resumo"</li>
          </ul>
          
          <h4><i class='bx bx-bulb'></i> Dicas</h4>
          <ul>
            <li>Para criar um novo roteiro, clique em "Novo" na aba Filtros, Grid ou Dados</li>
            <li>Para editar um roteiro existente, clique no ícone de edição na coluna Ações do grid</li>
            <li>Após criar um roteiro, adicione os pontos na aba "Pontos"</li>
            <li>Use a aba "Mapa" para visualizar o roteiro completo com todos os pontos</li>
            <li>O resumo da rota é gerado automaticamente, mas pode ser recalculado manualmente</li>
          </ul>
        </div>
        <div class="modal-footer-tratamento">
          <button onclick="window.fecharModalAjudaRoteiros()" class="btn btn-secondary">
            <i class='bx bx-x'></i> Fechar
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  };

  window.fecharModalAjudaRoteiros = function() {
    const modal = document.getElementById('modalAjudaRoteiros');
    if (modal) {
      modal.remove();
    }
  };
  
})();