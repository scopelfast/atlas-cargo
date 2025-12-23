// backend/public/js/permissions.js
// Sistema de Verificação de Permissões
// Versão: 1.0
// Autor: Sistema DivulgaCarga

(function() {
  'use strict';

  // Cache das permissões do usuário
  let userPermissions = null;
  let userLogin = null;

  // Função helper para corrigir URLs relativas para incluir o caminho base
  function corrigirUrl(url) {
    if (!url) return url;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    
    const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
    return baseUrl + (url.startsWith('/') ? url : '/' + url);
  }

  // Carregar permissões do usuário
  async function loadUserPermissions() {
    if (userPermissions !== null) {
      return userPermissions;
    }

    try {
      // Obter login do usuário do localStorage ou do header
      const login = localStorage.getItem('userLogin') || 
                    document.querySelector('[data-user-login]')?.getAttribute('data-user-login') ||
                    'Admin'; // fallback para desenvolvimento

      userLogin = login;

      const apiUrl = corrigirUrl('/api/menu/user-menu');
      const response = await fetch(apiUrl, {
        headers: { 'user-login': login }
      });

      if (response.ok) {
        const data = await response.json();
        // Criar um objeto com as permissões por CDTIPOATIVIDADE
        userPermissions = {};
        if (data.menu && Array.isArray(data.menu)) {
          data.menu.forEach(item => {
            userPermissions[item.id] = true;
            // Também permitir busca por programa
            if (item.programa) {
              userPermissions[item.programa] = true;
            }
          });
        }
        return userPermissions;
      }
    } catch (err) {
      console.error('Erro ao carregar permissões:', err);
    }

    return {};
  }

  // Verificar se o usuário tem permissão para uma atividade
  async function hasPermission(activityId) {
    const permissions = await loadUserPermissions();
    
    // Se activityId é um número, verificar diretamente
    if (typeof activityId === 'number' || /^\d+$/.test(String(activityId))) {
      return permissions[parseInt(activityId)] === true;
    }
    
    // Se activityId é uma string (programa), verificar por programa
    return permissions[activityId] === true;
  }

  // Aplicar restrições de permissão em elementos com data-permission
  async function applyPermissionRestrictions() {
    const permissions = await loadUserPermissions();
    
    // Processar elementos com data-permission
    document.querySelectorAll('[data-permission]').forEach(element => {
      const permissionAttr = element.getAttribute('data-permission');
      if (!permissionAttr) return;

      // Pode ser um ID de atividade ou múltiplos separados por vírgula
      const requiredPermissions = permissionAttr.split(',').map(p => p.trim());
      
      // Verificar se o usuário tem pelo menos uma das permissões (OR)
      // Se quiser AND, usar data-permission-all
      const requireAll = element.hasAttribute('data-permission-all');
      
      let hasAccess = false;
      if (requireAll) {
        // Todas as permissões são necessárias (AND)
        hasAccess = requiredPermissions.every(perm => {
          const permId = /^\d+$/.test(perm) ? parseInt(perm) : perm;
          return permissions[permId] === true;
        });
      } else {
        // Pelo menos uma permissão é necessária (OR)
        hasAccess = requiredPermissions.some(perm => {
          const permId = /^\d+$/.test(perm) ? parseInt(perm) : perm;
          return permissions[permId] === true;
        });
      }

      if (!hasAccess) {
        // Esconder o elemento
        element.style.display = 'none';
        // Ou desabilitar se for um botão/input
        if (element.tagName === 'BUTTON' || element.tagName === 'INPUT' || element.tagName === 'SELECT') {
          element.disabled = true;
          element.style.opacity = '0.5';
          element.style.cursor = 'not-allowed';
        }
      }
    });

    // Processar abas com data-permission-tab
    document.querySelectorAll('.tab-btn[data-permission-tab]').forEach(tab => {
      const permissionAttr = tab.getAttribute('data-permission-tab');
      if (!permissionAttr) return;

      const permId = /^\d+$/.test(permissionAttr) ? parseInt(permissionAttr) : permissionAttr;
      const hasAccess = permissions[permId] === true;

      if (!hasAccess) {
        tab.style.display = 'none';
        // Também esconder o conteúdo da aba correspondente
        const tabId = tab.getAttribute('data-tab');
        if (tabId) {
          const tabContent = document.getElementById(`tab-${tabId}`);
          if (tabContent) {
            tabContent.style.display = 'none';
          }
        }
      }
    });
  }

  // Função para recarregar permissões (útil após alterações)
  function reloadPermissions() {
    userPermissions = null;
    loadUserPermissions().then(() => {
      applyPermissionRestrictions();
    });
  }

  // Expor funções globalmente
  window.Permissions = {
    hasPermission,
    loadUserPermissions,
    applyPermissionRestrictions,
    reloadPermissions,
    getPermissions: () => userPermissions,
    getUserLogin: () => userLogin
  };

  // Aplicar restrições quando o DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(applyPermissionRestrictions, 500);
    });
  } else {
    setTimeout(applyPermissionRestrictions, 500);
  }

  // Aplicar também quando módulos são carregados dinamicamente usando MutationObserver
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Se um script de módulo foi adicionado, aplicar restrições após um delay
          if (node.tagName === 'SCRIPT' && node.src && node.src.includes('/modulos/')) {
            node.addEventListener('load', () => {
              setTimeout(applyPermissionRestrictions, 500);
            });
          }
          // Se elementos com data-permission foram adicionados, aplicar restrições
          if (node.hasAttribute && (node.hasAttribute('data-permission') || node.hasAttribute('data-permission-tab'))) {
            setTimeout(applyPermissionRestrictions, 100);
          }
        }
      });
    });
  });

  // Observar mudanças no contentArea (onde os módulos são carregados)
  const contentArea = document.getElementById('contentArea');
  if (contentArea) {
    observer.observe(contentArea, {
      childList: true,
      subtree: true
    });
  }

})();

