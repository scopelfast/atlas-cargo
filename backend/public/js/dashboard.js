// backend/public/js/dashboard.js
// Função de inicialização que funciona mesmo com scripts carregados dinamicamente
(function() {
  // Verificar se o DOM já está pronto
  const init = () => {
    // Variáveis globais para controle de timeout
    let inactivityTimer = null;
    let lastActivityTime = Date.now();
    const TIMEOUT_MINUTES = 60; // 60 minutos de inatividade
    const TIMEOUT_MS = TIMEOUT_MINUTES * 60 * 1000;

  // Função para verificar timeout e fazer logout automático
  const verificarTimeout = () => {
    const loginTimestamp = parseInt(localStorage.getItem('loginTimestamp') || '0');
    const now = Date.now();
    const tempoInativo = now - lastActivityTime;
    const tempoTotal = now - loginTimestamp;

    // Se passou mais de 60 minutos desde a última atividade OU mais de 8 horas desde o login
    if (tempoInativo > TIMEOUT_MS || tempoTotal > (8 * 60 * 60 * 1000)) {
      fazerLogout(true); // true = logout automático por timeout
      return;
    }

    // Agendar próxima verificação em 1 minuto
    inactivityTimer = setTimeout(verificarTimeout, 60000);
  };

  // Função para atualizar última atividade
  const atualizarAtividade = () => {
    lastActivityTime = Date.now();
    // Resetar timer de inatividade
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
    }
    inactivityTimer = setTimeout(verificarTimeout, 60000);
  };

  // Eventos que indicam atividade do usuário
  const eventosAtividade = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
  eventosAtividade.forEach(evento => {
    document.addEventListener(evento, atualizarAtividade, { passive: true });
  });

  // Função para fazer logout (manual ou automático)
  const fazerLogout = async (automatico = false) => {
    // Limpar timers
    if (inactivityTimer) {
      clearTimeout(inactivityTimer);
      inactivityTimer = null;
    }

    // Remover listeners de atividade
    eventosAtividade.forEach(evento => {
      document.removeEventListener(evento, atualizarAtividade);
    });

    // Registrar logout no backend
    const idLogAcesso = localStorage.getItem('idLogAcesso');
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    if (idLogAcesso || user.login) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            idLogAcesso: idLogAcesso ? parseInt(idLogAcesso) : null,
            sgUsuario: user.login || null
          })
        });
      } catch (err) {
        // Silencioso - não bloquear logout se houver erro
        console.error('Erro ao registrar logout:', err);
      }
    }

    // Limpar cache e storage
    sessionStorage.clear();
    localStorage.clear();

    // Limpar cache do navegador (forçar reload)
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }

    // Redirecionar para login
    if (automatico) {
      // Usar showMessage do padrão do sistema se disponível
      if (typeof window.showMessage === 'function') {
        showMessage('Sessão expirada por inatividade. Faça login novamente.', 'error');
        // Aguardar um pouco para o usuário ver a mensagem antes de redirecionar
        setTimeout(() => {
          // Forçar HTTP em desenvolvimento local
          const hostname = window.location.hostname;
          const isLocal = hostname === 'localhost' || 
                          hostname === '127.0.0.1' || 
                          hostname.startsWith('192.168.');
          const protocol = isLocal ? 'http:' : window.location.protocol;
          let cleanUrl = protocol + '//' + window.location.host + '/';
          // Garantir que não tenha ? no final
          cleanUrl = cleanUrl.replace(/\?+$/, '');
          // Usar replace para não adicionar ao histórico e evitar ?
          window.location.replace(cleanUrl);
        }, 2000);
        return;
      }
    }
    // Remover ? e usar replace para não adicionar ao histórico
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || 
                    hostname === '127.0.0.1' || 
                    hostname.startsWith('192.168.');
    const protocol = isLocal ? 'http:' : window.location.protocol;
    let cleanUrl = protocol + '//' + window.location.host + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
  };

  const initDashboard = async () => {
    // Proteção anti-loop melhorada
    const loopCount = parseInt(sessionStorage.getItem('dashboardLoopCount') || '0');
    if (loopCount > 5) {
      console.error('❌ Loop detectado! Limpando e parando...');
      sessionStorage.clear();
      localStorage.clear();
      // Parar completamente - não redirecionar mais
      document.body.innerHTML = '<div style="padding: 50px; text-align: center;"><h2>Erro de Loop Detectado</h2><p>Por favor, limpe o cache do navegador e faça login novamente.</p><button onclick="location.reload()" style="padding: 10px 20px; margin-top: 20px;">Recarregar Página</button></div>';
      return;
    }
    
    // Incrementar contador ANTES de qualquer verificação
    sessionStorage.setItem('dashboardLoopCount', (loopCount + 1).toString());
    
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    let user = null;
    
    try {
      user = userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      console.error('❌ Erro ao fazer parse do user:', e);
      sessionStorage.removeItem('dashboardLoopCount');
      window.__DASHBOARD_INITIALIZING__ = false;
      localStorage.clear();
      // Remover ? e usar replace para não adicionar ao histórico
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || 
                    hostname === '127.0.0.1' || 
                    hostname.startsWith('192.168.');
    const protocol = isLocal ? 'http:' : window.location.protocol;
    let cleanUrl = protocol + '//' + window.location.host + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
      return;
    }

    if (!token || !user) {
      console.warn('⚠️ Token ou user ausente, redirecionando para login');
      sessionStorage.removeItem('dashboardLoopCount');
      window.__DASHBOARD_INITIALIZING__ = false;
      localStorage.clear();
      // Remover ? e usar replace para não adicionar ao histórico
    const hostname = window.location.hostname;
    const isLocal = hostname === 'localhost' || 
                    hostname === '127.0.0.1' || 
                    hostname.startsWith('192.168.');
    const protocol = isLocal ? 'http:' : window.location.protocol;
    let cleanUrl = protocol + '//' + window.location.host + '/';
    // Garantir que não tenha ? no final
    cleanUrl = cleanUrl.replace(/\?+$/, '');
    window.location.replace(cleanUrl);
      return;
    }

    // Verificar se já passou muito tempo desde o login
    const loginTimestamp = parseInt(localStorage.getItem('loginTimestamp') || '0');
    if (!loginTimestamp || (Date.now() - loginTimestamp) > (8 * 60 * 60 * 1000)) {
      console.warn('⚠️ Sessão expirada (mais de 8 horas)');
      window.__DASHBOARD_INITIALIZING__ = false;
      fazerLogout(true);
      return;
    }
    
    // Se chegou até aqui, tudo está OK - resetar contador imediatamente
    sessionStorage.removeItem('dashboardLoopCount');
    window.__DASHBOARD_INITIALIZING__ = false;

    // Inicializar controle de atividade
    lastActivityTime = Date.now();
    atualizarAtividade();

    const userNameEl = document.getElementById('userName');
    const userEmailEl = document.getElementById('userEmail');
    
    if (userNameEl) {
      userNameEl.textContent = user.nome || 'Usuário';
    }
    
    if (userEmailEl) {
      userEmailEl.textContent = user.email || '';
    }

    await loadUserMenu(user.login);

    // Aguardar um pouco para garantir que o sistema de permissões esteja carregado
    await new Promise(resolve => setTimeout(resolve, 500));

    // Carregar tela inicial automaticamente após login
    if (typeof window.showWelcomeScreen === 'function') {
      await window.showWelcomeScreen();
    } else {
      // Aguardar um pouco se a função ainda não estiver disponível
      setTimeout(async () => {
        if (typeof window.showWelcomeScreen === 'function') {
          await window.showWelcomeScreen();
        }
      }, 300);
    }

    // Vincula botão de logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      fazerLogout(false); // false = logout manual
    });

    // Vincula link de documentação CSS
    document.getElementById('docLink')?.addEventListener('click', () => {
      window.open('/css/documentacao-modulos.html', '_blank');
    });

    // Vincula clique no logo para voltar ao início
    document.getElementById('logoDivulgaCarga')?.addEventListener('click', () => {
      if (typeof window.showWelcomeScreen === 'function') {
        window.showWelcomeScreen();
      } else {
        // Fallback se a função ainda não estiver disponível
        setTimeout(() => {
          if (typeof window.showWelcomeScreen === 'function') {
            window.showWelcomeScreen();
          }
        }, 100);
      }
    });

    // Inicializar toggle do menu
    initMenuToggle();
    
    // Inicializar AudioContext na primeira interação
    inicializarAudioContext();
    
    // Inicializar atualização automática de contadores e sons
    inicializarAtualizacaoContadores();
  };

  // AudioContext global (será criado/resumido quando necessário)
  let globalAudioContext = null;

  /**
   * Obter ou criar AudioContext (resumindo se necessário)
   */
  const obterAudioContext = async () => {
    try {
      if (!globalAudioContext) {
        globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
      }
      
      // Se o contexto estiver suspenso, tentar resumir
      if (globalAudioContext.state === 'suspended') {
        await globalAudioContext.resume();
      }
      
      return globalAudioContext;
    } catch (err) {
      // Se não conseguir criar/resumir, retornar null
      return null;
    }
  };

  /**
   * Função para tocar som de notificação (global)
   */
  const tocarSomNotificacao = async (tipo = 'geral') => {
    try {
      // Verificar se som está habilitado
      const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
      if (!somHabilitado) {
        return;
      }

      const audioContext = await obterAudioContext();
      if (!audioContext) {
        // Se não conseguir obter o contexto, silenciosamente falhar
        return;
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Frequências diferentes por tipo
      const frequencies = {
        'sos': 1000,
        'alerta': 800,
        'chat': 600,
        'geral': 500
      };

      oscillator.frequency.value = frequencies[tipo] || 500;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      // Silenciosamente falhar - não logar erro para não poluir o console
      // O som só funcionará após interação do usuário (política do navegador)
    }
  };

  /**
   * Inicializar AudioContext na primeira interação do usuário
   */
  const inicializarAudioContext = () => {
    // Tentar criar o contexto na primeira interação
    const eventos = ['click', 'touchstart', 'keydown'];
    const inicializar = async () => {
      await obterAudioContext();
      // Remover listeners após primeira inicialização
      eventos.forEach(evento => {
        document.removeEventListener(evento, inicializar, { once: true });
      });
    };
    
    eventos.forEach(evento => {
      document.addEventListener(evento, inicializar, { once: true, passive: true });
    });
  };

  /**
   * Obter headers de autenticação
   */
  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  /**
   * Atualizar contador de Chat
   */
  const atualizarContadorChat = async (ultimoContador = {}) => {
    try {
      const userStr = localStorage.getItem('user');
      if (!userStr) return;
      
      const user = JSON.parse(userStr);
      const idUsuario = user.cdcadastro || user.id;
      if (!idUsuario) return;

      const response = await fetch(`/api/chat/nao-lidas?idUsuario=${idUsuario}&userType=OPERADOR`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const total = data.data.total || 0;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="chat"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (total > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = total > 99 ? '99+' : total.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (total > (ultimoContador.chat || 0)) {
            tocarSomNotificacao('chat').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return total;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador do chat:', err);
    }
    return ultimoContador.chat || 0;
  };

  /**
   * Atualizar contador de Alertas
   */
  const atualizarContadorAlertas = async (ultimoContador = {}) => {
    try {
      const response = await fetch('/api/alertas/contador', {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const pendentes = parseInt(data.data.pendentes) || 0;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="alertas"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (pendentes > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = pendentes > 99 ? '99+' : pendentes.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (pendentes > (ultimoContador.alertas || 0)) {
            tocarSomNotificacao('alerta').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return pendentes;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador de alertas:', err);
    }
    return ultimoContador.alertas || 0;
  };

  /**
   * Atualizar contador de SOS
   */
  const atualizarContadorSOS = async (ultimoContador = {}) => {
    try {
      const response = await fetch('/api/sos/contador', {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const ativos = parseInt(data.data.ativos) || 0;
          const emTratamento = parseInt(data.data.emTratamento) || 0;
          const totalPendentes = ativos + emTratamento;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="sos"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (totalPendentes > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = totalPendentes > 99 ? '99+' : totalPendentes.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
          
          // Tocar som se aumentou (apenas se contexto de áudio estiver pronto)
          if (totalPendentes > (ultimoContador.sos || 0)) {
            tocarSomNotificacao('sos').catch(() => {
              // Silenciosamente falhar se não conseguir tocar
            });
          }
          
          return totalPendentes;
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador de SOS:', err);
    }
    return ultimoContador.sos || 0;
  };

  /**
   * Atualizar todos os contadores
   */
  const atualizarTodosContadores = async () => {
    try {
      // Obter último estado salvo
      let ultimoContador = {};
      try {
        const saved = localStorage.getItem('ultimoContador');
        if (saved) {
          ultimoContador = JSON.parse(saved);
          // Limpar se muito antigo (mais de 1 hora)
          if (ultimoContador.timestamp && (Date.now() - ultimoContador.timestamp) > 3600000) {
            ultimoContador = {};
          }
        }
      } catch (e) {
        ultimoContador = {};
      }
      
      // Atualizar todos em paralelo
      const [chat, alertas, sos] = await Promise.all([
        atualizarContadorChat(ultimoContador),
        atualizarContadorAlertas(ultimoContador),
        atualizarContadorSOS(ultimoContador)
      ]);
      
      // Salvar estado atual
      localStorage.setItem('ultimoContador', JSON.stringify({
        chat,
        alertas,
        sos,
        timestamp: Date.now()
      }));
    } catch (err) {
      console.warn('Erro ao atualizar contadores:', err);
    }
  };

  /**
   * Inicializar atualização automática de contadores
   */
  const inicializarAtualizacaoContadores = () => {
    // Atualizar imediatamente
    atualizarTodosContadores();
    
    // Atualizar a cada 30 segundos
    setInterval(() => {
      atualizarTodosContadores();
    }, 30000);
  };

  // Função para inicializar o toggle do menu
  const initMenuToggle = () => {
    const sidebar = document.querySelector('.sidebar');
    const main = document.querySelector('.main');
    const toggleBtn = document.getElementById('toggleMenuBtn');
    const toggleIcon = toggleBtn?.querySelector('i');

    // Verificar estado salvo no localStorage
    const isCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';
    if (isCollapsed) {
      sidebar?.classList.add('collapsed');
      main?.classList.add('sidebar-collapsed');
      if (toggleIcon) {
        toggleIcon.className = 'bx bx-chevron-right';
      }
    }

    // Adicionar evento de clique no botão
    toggleBtn?.addEventListener('click', () => {
      sidebar?.classList.toggle('collapsed');
      main?.classList.toggle('sidebar-collapsed');
      
      // Atualizar ícone
      if (toggleIcon) {
        if (sidebar?.classList.contains('collapsed')) {
          toggleIcon.className = 'bx bx-chevron-right';
        } else {
          toggleIcon.className = 'bx bx-chevron-left';
        }
      }

      // Salvar estado no localStorage
      localStorage.setItem('sidebarCollapsed', sidebar?.classList.contains('collapsed') ? 'true' : 'false');
    });
  };

  const loadUserMenu = async (userLogin) => {
    try {
      const token = localStorage.getItem('token');
      const baseUrl = window.__BASE_URL__ || ('http://' + window.location.host);
      const url = baseUrl + '/api/menu/user-menu';
      
      const response = await fetch(url, {
        headers: { 
          'user-login': userLogin,
          'Authorization': token ? `Bearer ${token}` : '',
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      
      const menuContainer = document.getElementById('menuContainer');
      if (!menuContainer) {
        console.error('❌ Elemento menuContainer não encontrado!');
        return;
      }

      if (response.ok && data.menu && data.menu.length > 0) {
        // Mapeamento de ícones por grupo (baseado no FGGRUPO do banco)
        const iconesPorGrupo = {
          'CADASTROS': 'bx-file-blank',
          'EQUIPAMENTOS': 'bx-package',
          'VIAGENS & LOGÍSTICA': 'bx-trip',
          'GESTÃO & ADMINISTRAÇÃO': 'bx-cog',
          'OUTROS': 'bx-grid-alt'
        };
        
        // Agrupar itens por grupo (FGGRUPO do banco de dados)
        const gruposMap = {};
        
        data.menu.forEach(item => {
          const iconName = getIcon(item.id);
          const iconClass = iconName.startsWith('bxs-') ? `bxs ${iconName}` : `bx bx-${iconName}`;
          const programa = item.programa || 'default';
          const grupo = (item.grupo || 'OUTROS').toUpperCase().trim();
          
          // Criar grupo se não existir
          if (!gruposMap[grupo]) {
            gruposMap[grupo] = {
              nome: grupo,
              icon: iconesPorGrupo[grupo] || iconesPorGrupo['OUTROS'],
              items: []
            };
          }
          
          gruposMap[grupo].items.push({ ...item, iconClass, programa });
        });
        
        // Renderizar grupos (ordenados alfabeticamente)
        const gruposOrdenados = Object.entries(gruposMap)
          .filter(([key, grupo]) => grupo.items.length > 0) // Só mostrar grupos com itens
          .sort(([keyA, grupoA], [keyB, grupoB]) => {
            // Ordenar por ordem específica (se necessário) ou alfabeticamente
            const ordem = ['CADASTROS', 'EQUIPAMENTOS', 'VIAGENS & LOGÍSTICA', 'GESTÃO & ADMINISTRAÇÃO', 'OUTROS'];
            const indexA = ordem.indexOf(keyA);
            const indexB = ordem.indexOf(keyB);
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            if (indexA !== -1) return -1;
            if (indexB !== -1) return 1;
            return grupoA.nome.localeCompare(grupoB.nome);
          });
        
        menuContainer.innerHTML = gruposOrdenados
          .map(([key, grupo]) => {
            const grupoId = `grupo-${key.replace(/\s+/g, '-').toLowerCase()}`;
            const isExpanded = localStorage.getItem(`menu-grupo-${key}`) !== 'false'; // Por padrão expandido
            
            return `
              <div class="menu-category">
                <div class="menu-category-header" data-grupo="${key}">
                  <i class='bx ${grupo.icon}'></i>
                  <span>${grupo.nome}</span>
                  <i class='bx ${isExpanded ? 'bx-chevron-down' : 'bx-chevron-right'} menu-category-toggle'></i>
                </div>
                <div class="menu-category-items" data-grupo-items="${key}" style="display: ${isExpanded ? 'block' : 'none'};">
                  ${grupo.items.map(item => `
                    <div class="menu-item" data-id="${item.id}" data-programa="${item.programa}">
                      <i class='${item.iconClass}'></i>
                      <span>${item.nome}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('');

        // Event listeners para grupos (expandir/colapsar)
        const categoryHeaders = document.querySelectorAll('.menu-category-header');
        categoryHeaders.forEach(header => {
          header.addEventListener('click', (e) => {
            e.stopPropagation();
            const grupoKey = header.getAttribute('data-grupo');
            const itemsContainer = document.querySelector(`[data-grupo-items="${grupoKey}"]`);
            const toggleIcon = header.querySelector('.menu-category-toggle');
            
            if (itemsContainer) {
              const isExpanded = itemsContainer.style.display !== 'none';
              itemsContainer.style.display = isExpanded ? 'none' : 'block';
              
              // Atualizar ícone
              if (toggleIcon) {
                toggleIcon.className = isExpanded 
                  ? 'bx bx-chevron-right menu-category-toggle'
                  : 'bx bx-chevron-down menu-category-toggle';
              }
              
              // Salvar estado
              localStorage.setItem(`menu-grupo-${grupoKey}`, !isExpanded);
            }
          });
        });
        
        // Event listeners para itens do menu
        const menuItems = document.querySelectorAll('.menu-item');

        menuItems.forEach(el => {
          el.addEventListener('click', () => {
            // Buscar por data-programa (correto) ou data-program (fallback)
            const programa = el.getAttribute('data-programa') || el.getAttribute('data-program');
            console.log('🔍 Clique no menu:', {
              elemento: el,
              dataPrograma: el.getAttribute('data-programa'),
              dataProgram: el.getAttribute('data-program'),
              programa: programa,
              nome: el.querySelector('span')?.textContent
            });
            
            if (programa && programa !== 'default') {
              console.log('✅ Carregando módulo:', programa);
              loadModuleContent(programa);
            } else {
              console.warn('⚠️ Programa não encontrado ou é default:', programa);
              document.getElementById('contentArea').innerHTML = `
                <h3>${el.querySelector('span').textContent}</h3>
                <p>Este módulo ainda não foi implementado.</p>
                <p style="font-size: 12px; color: #999; margin-top: 10px;">
                  Debug: programa="${programa || 'null'}"
                </p>
              `;
            }
          });
        });
      } else {
        menuContainer.innerHTML = '<div class="menu-item"><span>Sem permissões</span></div>';
      }
    } catch (err) {
      console.error('❌ Erro ao carregar menu:', err);
      const menuContainer = document.getElementById('menuContainer');
      if (menuContainer) {
        menuContainer.innerHTML = '<div class="menu-item"><span>❌ Erro de conexão</span></div>';
      }
    }
  };

  const getIcon = (id) => {
    // Converter ID para número inteiro (CDTIPOATIVIDADE é sempre inteiro)
    const idNum = parseInt(id);
    
    // Mapeamento de ícones por CDTIPOATIVIDADE baseado na tabela TIPOATIVIDADE
    const icons = {
      1: 'id-card',           // 1.0.Cadastro Geral
      2: 'bar-chart',         // 8.1.Relatório
      3: 'user',              // 9.1.Usuário
      4: 'bxs-truck',         // 0.2.Transportes - CORRIGIDO (usando bxs-truck que existe no CSS)
      5: 'cog',               // Tipo de atividade genérico
      10: 'purchase-tag',     // 2.1.Marca
      11: 'tag',              // 2.2.Tipo (Equipamento)
      12: 'car',              // 2.3.Modelo
      13: 'collection',       // 2.4.Grupo
      14: 'package',          // 2.0.Equipamento
      20: 'map',              // 1.1.Cidade
      21: 'tag',              // 3.1.Tipo (Viagem)
      22: 'check-circle',     // 3.2.Situação
      23: 'layer',            // 3.3.Classe Frota
      24: 'directions',       // 3.4.Roteiro - CORRIGIDO (usando directions que existe no CSS)
      25: 'trip',             // 3.0.Viagem
      30: 'upload',           // 0.3.Divulgações
      31: 'building',         // 4.0.Empresas
      32: 'store',            // 4.1.Filiais
      33: 'bar-chart-alt',    // 3.5.Relatório Convocações
      40: 'bell',             // 4.0.Alertas - NOVO (bx-bell)
      41: 'message',          // 4.1.Chat - NOVO (bx-message)
      42: 'error-circle',     // 4.2.SOS - NOVO (bx-error-circle)
      43: 'trophy'             // 4.3.Ranking - NOVO (bx-trophy)
    };
    
    // Retornar o ícone correspondente ou fallback padrão
    const icon = icons[idNum] || 'grid';
    
    return icon;
  };

  const loadModuleContent = async (programa, params = {}) => {
    // REMOVER TODOS OS MODAIS DE AJUDA DO DOM ao trocar de módulo
    // Buscar todos os modais de ajuda criados dinamicamente
    const modaisAjuda = document.querySelectorAll('[id*="modalAjuda"], [id*="ModalAjuda"], [id*="Ajuda"][class*="modal"]');
    modaisAjuda.forEach(modal => {
      modal.remove(); // Remover completamente do DOM
    });
    
    // Fechar todos os modais abertos antes de carregar novo módulo
    const modaisAbertos = document.querySelectorAll('.modal-tratamento.active, .modal.active, [class*="modal"][class*="active"]');
    modaisAbertos.forEach(modal => {
      modal.classList.remove('active');
      modal.style.display = 'none';
      // Se for modal de ajuda, remover do DOM
      if (modal.id && (modal.id.includes('Ajuda') || modal.id.includes('ajuda'))) {
        modal.remove();
      }
    });
    
    // Chamar funções de fechamento globais se existirem (padrão: fecharModal*)
    Object.keys(window).forEach(key => {
      if (typeof window[key] === 'function' && key.startsWith('fecharModal')) {
        try {
          window[key]();
        } catch (e) {
          // Ignorar erros ao chamar funções de fechamento
        }
      }
    });
    
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<p>Carregando módulo...</p>';

    try {
      // Lista de módulos que PRECISAM de map-config.js (têm mapas)
      const modulosComMapa = [
        'gerenciar-viagens',
        'gerenciar-roteiros',
        'relatorio-convocacoes'
      ];
      
      // Só carregar map-config.js se o módulo realmente precisa de mapa
      if (modulosComMapa.includes(programa)) {
        // IMPORTANTE: Garantir que map-config.js está carregado ANTES de carregar o módulo
        if (!window.MAP_CONFIG || !window.getTileServerUrl) {
          console.log('📍 [DASHBOARD] Carregando map-config.js antes do módulo...');
          await new Promise((resolve, reject) => {
            // Verificar se já está carregando
            if (document.querySelector('script[src="/js/map-config.js"]')) {
              // Aguardar até estar disponível
              const checkInterval = setInterval(() => {
                if (window.MAP_CONFIG && window.getTileServerUrl) {
                  clearInterval(checkInterval);
                  resolve();
                }
              }, 50);
              setTimeout(() => {
                clearInterval(checkInterval);
                if (!window.MAP_CONFIG) {
                  console.warn('⚠️ [DASHBOARD] map-config.js não carregou a tempo');
                }
                resolve();
              }, 2000);
            } else {
              // Carregar map-config.js
              const script = document.createElement('script');
              script.src = '/js/map-config.js';
              script.onload = () => {
                console.log('✅ [DASHBOARD] map-config.js carregado');
                resolve();
              };
              script.onerror = () => {
                console.error('❌ [DASHBOARD] Erro ao carregar map-config.js');
                resolve(); // Continuar mesmo se falhar
              };
              document.head.appendChild(script);
            }
          });
        } else {
          console.log('✅ [DASHBOARD] map-config.js já está disponível');
        }
      }

      const response = await fetch(`/modulos/${programa}/index.html`);
      if (response.ok) {
        const html = await response.text();
        contentArea.innerHTML = html;

        // IMPORTANTE: Executar scripts que estão dentro do HTML inserido
        // (innerHTML não executa scripts automaticamente)
        // Isso é CRÍTICO para map-config.js funcionar!
        const scriptsInHTML = contentArea.querySelectorAll('script[src]');
        const scriptPromises = [];
        
        scriptsInHTML.forEach(oldScript => {
          let scriptSrc = oldScript.getAttribute('src');
          
          // Converter caminhos relativos para absolutos baseados no módulo
          if (scriptSrc && !scriptSrc.startsWith('/') && !scriptSrc.startsWith('http')) {
            // Caminho relativo - converter para absoluto baseado no módulo
            scriptSrc = `/modulos/${programa}/${scriptSrc}`;
            console.log('📍 [DASHBOARD] Convertendo caminho relativo:', oldScript.getAttribute('src'), '→', scriptSrc);
          }
          
          const newScript = document.createElement('script');
          Array.from(oldScript.attributes).forEach(attr => {
            if (attr.name === 'src') {
              newScript.setAttribute('src', scriptSrc);
            } else {
              newScript.setAttribute(attr.name, attr.value);
            }
          });
          newScript.textContent = oldScript.textContent;
          
          // Criar promise para aguardar carregamento
          const scriptPromise = new Promise((resolve) => {
            newScript.onload = () => {
              console.log('✅ [DASHBOARD] Script do HTML carregado:', newScript.src);
              resolve();
            };
            newScript.onerror = () => {
              // Silenciosamente ignorar erros de scripts opcionais
              console.warn('⚠️ [DASHBOARD] Erro ao carregar script do HTML:', newScript.src);
              resolve(); // Continuar mesmo se falhar
            };
            // Se não tiver src, executar imediatamente
            if (!newScript.src) {
              resolve();
            }
          });
          
          scriptPromises.push(scriptPromise);
          oldScript.parentNode.replaceChild(newScript, oldScript);
        });
        
        // Aguardar todos os scripts do HTML carregarem (especialmente map-config.js)
        await Promise.all(scriptPromises);
        console.log('✅ [DASHBOARD] Todos os scripts do HTML carregados');

        // Armazenar módulo atual para uso no log-helper
        window.currentModule = programa;
        sessionStorage.setItem('currentModule', programa);
        
        // Registrar abertura do módulo
        if (window.logAberturaTela) {
          window.logAberturaTela(programa, `Abertura do módulo: ${programa}`);
        }

        // Carregar script de permissões primeiro (se ainda não estiver carregado)
        if (!window.Permissions) {
          const permissionsScript = document.createElement('script');
          permissionsScript.src = '/js/permissions.js';
          contentArea.appendChild(permissionsScript);
        }

        // Carregar log-helper se ainda não estiver carregado
        if (!window.logAberturaTela) {
          const logHelperScript = document.createElement('script');
          logHelperScript.src = '/js/log-helper.js';
          contentArea.appendChild(logHelperScript);
        }

        // Carrega o script do módulo, se existir
        const script = document.createElement('script');
        script.src = `/modulos/${programa}/js/script.js`;
        script.onerror = () => {
          // Script não encontrado - silencioso
        };
        script.onload = () => {
          // Verificar se MAP_CONFIG está disponível apenas para módulos que precisam de mapa
          const modulosComMapa = ['gerenciar-viagens', 'gerenciar-roteiros', 'relatorio-convocacoes'];
          if (modulosComMapa.includes(programa)) {
            if (!window.MAP_CONFIG) {
              console.warn('⚠️ [DASHBOARD] MAP_CONFIG não disponível após carregar módulo', programa);
            } else {
              console.log('✅ [DASHBOARD] MAP_CONFIG disponível após carregar módulo', programa);
            }
          }
          
          // Aplicar restrições de permissão após o módulo carregar
          setTimeout(() => {
            if (window.Permissions) {
              window.Permissions.applyPermissionRestrictions();
            }
          }, 500);
        };
        contentArea.appendChild(script);

        // Se houver parâmetros, aplicar após carregar
        if (Object.keys(params).length > 0) {
          setTimeout(() => {
            aplicarParametrosModulo(params);
          }, 1000);
        }
      } else if (response.status === 404) {
        // Módulo não encontrado - mostrar mensagem amigável
        contentArea.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
            <i class='bx bx-error-circle' style="font-size: 64px; color: #6c757d; margin-bottom: 20px;"></i>
            <h3>Módulo não disponível</h3>
            <p>O módulo "${programa}" está em desenvolvimento.</p>
            <p style="margin-top: 20px; color: #868e96; font-size: 14px;">
              Este módulo será implementado em breve.
            </p>
          </div>
        `;
      } else {
        // Outro erro HTTP
        contentArea.innerHTML = `
          <div style="text-align: center; padding: 60px 20px;">
            <i class='bx bx-error-circle' style="font-size: 64px; color: #e74c3c; margin-bottom: 20px;"></i>
            <h3>Erro ao carregar módulo</h3>
            <p>Não foi possível carregar o módulo "${programa}".</p>
            <p style="margin-top: 20px; color: #868e96; font-size: 14px;">
              Status: ${response.status} ${response.statusText}
            </p>
          </div>
        `;
      }
    } catch (err) {
      console.error('Erro ao carregar módulo:', err);
      contentArea.innerHTML = `
        <h3>Erro de carregamento</h3>
        <p>Não foi possível carregar o módulo "${programa}".</p>
      `;
    }
  };

  // Função auxiliar para aplicar parâmetros ao módulo carregado
  function aplicarParametrosModulo(params) {
    if (params.idViagem) {
      const filtroIdViagem = document.getElementById('filtroIdViagem');
      if (filtroIdViagem) {
        filtroIdViagem.value = params.idViagem;
        // Tentar submeter o formulário
        const form = document.getElementById('filtroForm');
        if (form) {
          setTimeout(() => {
            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) {
              submitBtn.click();
            }
          }, 500);
        }
      }
    }
  }

  // Tornar loadModuleContent acessível globalmente
  window.loadModuleContent = loadModuleContent;

  // Função para restaurar a tela inicial com propaganda
  const showWelcomeScreen = async () => {
    const contentArea = document.getElementById('contentArea');
    if (!contentArea) return;
    
    // Carregar estatísticas
    let stats = {
      totalViagens: 0,
      viagensPendentes: 0,
      totalEquipamentos: 0,
      totalUsuarios: 0,
      convocacoesPendentes: 0
    };
    
    try {
      // Buscar estatísticas de convocações (usa a mesma query do relatório)
      // Este endpoint retorna TOTAL_VIAGENS (COUNT DISTINCT) que é o correto
      const responseConv = await fetch('/api/relatorio-convocacoes/estatisticas');
      if (responseConv.ok) {
        const dataConv = await responseConv.json();
        // Usar dados do relatório (mesma query do Relatório de Convocações)
        stats.totalViagens = dataConv.TOTAL_VIAGENS || 0;
        stats.convocacoesPendentes = dataConv.PENDENTE || 0;
        // Viagens pendentes = Total de viagens - Viagens com pelo menos uma convocação confirmada
        // Este cálculo já vem na query do endpoint
        stats.viagensPendentes = dataConv.VIAGENS_PENDENTES || 0;
      }
    } catch (e) {
      console.warn('Erro ao carregar estatísticas de convocações:', e);
    }
    
    // Carregar permissões do usuário para validar links rápidos
    let quickLinks = [];
    
    // Definir links rápidos com suas respectivas permissões
    const availableQuickLinks = [
      { programa: 'gerenciar-viagens', nome: 'Gerenciar Viagens', icon: 'bx-trip' },
      { programa: 'relatorio-convocacoes', nome: 'Relatório de Convocações', icon: 'bx-bar-chart-alt-2' },
      { programa: 'gerenciar-equipamentos', nome: 'Gerenciar Equipamentos', icon: 'bx-package' },
      { programa: 'gerenciar-logs-acesso', nome: 'Logs de Acesso', icon: 'bx-history' }
    ];
    
    // Verificar permissões se o sistema estiver disponível
    if (typeof window.Permissions !== 'undefined' && window.Permissions.hasPermission) {
      for (const link of availableQuickLinks) {
        try {
          const hasPermission = await window.Permissions.hasPermission(link.programa);
          if (hasPermission) {
            quickLinks.push(link);
          }
        } catch (e) {
          console.warn(`Erro ao verificar permissão para ${link.programa}:`, e);
          // Em caso de erro, incluir o link (fail-open)
          quickLinks.push(link);
        }
      }
    } else {
      // Se o sistema de permissões não estiver disponível, mostrar todos
      quickLinks = availableQuickLinks;
    }
    
    contentArea.innerHTML = `
      <!-- Área de Boas-vindas -->
      <div class="welcome-section">
        <h3>Bem-vindo ao sistema!</h3>
        <p>Selecione uma opção no menu lateral para começar.</p>
      </div>

      <!-- Cards de Estatísticas -->
      <div class="dashboard-stats-grid">
        <div class="dashboard-stat-card primary">
          <div class="stat-card-icon">
            <i class='bx bx-trip'></i>
          </div>
          <div class="stat-card-content">
            <h4>Total de Viagens</h4>
            <p class="stat-value">${stats.totalViagens.toLocaleString('pt-BR')}</p>
            <span class="stat-label">Viagens cadastradas</span>
          </div>
        </div>

        <div class="dashboard-stat-card ${stats.viagensPendentes > 0 ? 'warning' : 'success'}">
          <div class="stat-card-icon">
            <i class='bx bx-time-five'></i>
          </div>
          <div class="stat-card-content">
            <h4>Viagens Pendentes</h4>
            <p class="stat-value">${stats.viagensPendentes.toLocaleString('pt-BR')}</p>
            <span class="stat-label">Aguardando ação</span>
          </div>
        </div>

        <div class="dashboard-stat-card ${stats.convocacoesPendentes > 0 ? 'warning' : 'info'}">
          <div class="stat-card-icon">
            <i class='bx bx-bell'></i>
          </div>
          <div class="stat-card-content">
            <h4>Convocações Pendentes</h4>
            <p class="stat-value">${stats.convocacoesPendentes.toLocaleString('pt-BR')}</p>
            <span class="stat-label">Aguardando resposta</span>
          </div>
        </div>

        <div class="dashboard-stat-card info">
          <div class="stat-card-icon">
            <i class='bx bx-info-circle'></i>
          </div>
          <div class="stat-card-content">
            <h4>Dica do Dia</h4>
            <p class="stat-tip">Use os filtros para encontrar informações rapidamente</p>
            <span class="stat-label">Dica útil</span>
          </div>
        </div>
      </div>

      <!-- Avisos e Alertas -->
      ${stats.viagensPendentes > 0 || stats.convocacoesPendentes > 0 ? `
      <div class="dashboard-alerts">
        <div class="alert-card ${stats.convocacoesPendentes > 0 ? 'alert-warning' : ''}">
          <i class='bx bx-error-circle'></i>
          <div>
            <strong>Atenção!</strong>
            ${stats.convocacoesPendentes > 0 ? `<p>Você tem ${stats.convocacoesPendentes} convocação(ões) pendente(s) aguardando resposta.</p>` : ''}
            ${stats.viagensPendentes > 0 ? `<p>Você tem ${stats.viagensPendentes} viagem(ns) pendente(s) que precisam de atenção.</p>` : ''}
          </div>
        </div>
      </div>
      ` : ''}

      <!-- Links Rápidos -->
      ${quickLinks.length > 0 ? `
      <div class="dashboard-quick-links">
        <h4><i class='bx bx-link'></i> Acesso Rápido</h4>
        <div class="quick-links-grid">
          ${quickLinks.map(link => `
            <button class="quick-link-btn" onclick="window.loadModuleContent('${link.programa}')">
              <i class='bx ${link.icon}'></i>
              <span>${link.nome}</span>
            </button>
          `).join('')}
        </div>
      </div>
      ` : ''}
    `;
  };
  
  // Tornar showWelcomeScreen acessível globalmente
  window.showWelcomeScreen = showWelcomeScreen;

  // Proteção contra múltiplas inicializações
  let dashboardInicializado = false;
  
  // Executar imediatamente se o DOM já estiver pronto, senão esperar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!dashboardInicializado) {
        dashboardInicializado = true;
        initDashboard();
      }
    }, { once: true }); // Garantir que só executa uma vez
  } else {
    // DOM já está pronto, executar imediatamente
    if (!dashboardInicializado) {
      dashboardInicializado = true;
      initDashboard();
    }
  }
  };

  // Executar init quando o script carregar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();