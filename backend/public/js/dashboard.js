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

    // Vincula botão de logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      fazerLogout(false); // false = logout manual
    });

    // Vincula link de documentação CSS
    document.getElementById('docLink')?.addEventListener('click', () => {
      window.open('/css/documentacao-modulos.html', '_blank');
    });

    // Inicializar toggle do menu
    initMenuToggle();
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
        menuContainer.innerHTML = data.menu.map(item => {
          const iconName = getIcon(item.id);
          // Se o ícone começa com 'bxs-', usar 'bxs', senão usar 'bx bx-'
          const iconClass = iconName.startsWith('bxs-') ? `bxs ${iconName}` : `bx bx-${iconName}`;
          return `
          <div class="menu-item" data-id="${item.id}" data-program="${item.programa || 'default'}">
            <i class='${iconClass}'></i>
            <span>${item.nome}</span>
          </div>
        `;
        }).join('');

        const menuItems = document.querySelectorAll('.menu-item');

        menuItems.forEach(el => {
          el.addEventListener('click', () => {
            const programa = el.getAttribute('data-program');
            if (programa && programa !== 'default') {
              loadModuleContent(programa);
            } else {
              document.getElementById('contentArea').innerHTML = `
                <h3>${el.querySelector('span').textContent}</h3>
                <p>Este módulo ainda não foi implementado.</p>
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
      33: 'bar-chart-alt'     // 3.5.Relatório Convocações
    };
    
    // Retornar o ícone correspondente ou fallback padrão
    const icon = icons[idNum] || 'grid';
    
    return icon;
  };

  const loadModuleContent = async (programa, params = {}) => {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = '<p>Carregando módulo...</p>';

    try {
      const response = await fetch(`/modulos/${programa}/index.html`);
      if (response.ok) {
        const html = await response.text();
        contentArea.innerHTML = html;

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
      } else {
        contentArea.innerHTML = `
          <h3>Módulo não disponível</h3>
          <p>O módulo "${programa}" está em desenvolvimento.</p>
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
  const showWelcomeScreen = () => {
    const contentArea = document.getElementById('contentArea');
    contentArea.innerHTML = `
      <!-- Área de Boas-vindas -->
      <div class="welcome-section">
        <h3>Bem-vindo ao sistema!</h3>
        <p>Selecione uma opção no menu lateral para começar.</p>
      </div>

      <!-- Área de Conteúdo Customizável - Edite este bloco conforme necessário -->
      <div class="advertisement-section" id="customContentBlock">
        <!-- Adicione seu conteúdo aqui -->
      </div>
    `;
  };

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