// backend/public/js/dashboard.js
document.addEventListener('DOMContentLoaded', () => {
  const initDashboard = async () => {
    // Proteção anti-loop
    const loopCount = parseInt(sessionStorage.getItem('dashboardLoopCount') || '0');
    if (loopCount > 3) {
      console.error('❌ Loop detectado! Limpando...');
      sessionStorage.clear();
      localStorage.clear();
      alert('Erro detectado. Faça login novamente.');
      window.location.href = '/';
      return;
    }
    sessionStorage.setItem('dashboardLoopCount', (loopCount + 1).toString());
    
    const token = localStorage.getItem('token');
    const user = JSON.parse(localStorage.getItem('user'));

    if (!token || !user) {
      sessionStorage.removeItem('dashboardLoopCount');
      window.location.href = '/';
      return;
    }
    
    // Se OK, resetar contador
    setTimeout(() => sessionStorage.removeItem('dashboardLoopCount'), 1000);

    document.getElementById('userName').textContent = user.nome || 'Usuário';
    document.getElementById('userEmail').textContent = user.email || '';

    await loadUserMenu(user.login);

    // Vincula botão de logout
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    });

    // Vincula link de documentação CSS
    document.getElementById('docLink')?.addEventListener('click', () => {
      window.open('/css/documentacao-modulos.html', '_blank');
    });
  };

  const loadUserMenu = async (userLogin) => {
    try {
      const response = await fetch('/api/menu/user-menu', {
        headers: { 'user-login': userLogin }
      });

      const data = await response.json();
      const menuContainer = document.getElementById('menuContainer');

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

        document.querySelectorAll('.menu-item').forEach(el => {
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
      console.error('Erro ao carregar menu:', err);
      document.getElementById('menuContainer').innerHTML = 
        '<div class="menu-item"><span>❌ Erro de conexão</span></div>';
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

        // Carregar script de permissões primeiro (se ainda não estiver carregado)
        if (!window.Permissions) {
          const permissionsScript = document.createElement('script');
          permissionsScript.src = '/js/permissions.js';
          contentArea.appendChild(permissionsScript);
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

  initDashboard();
});