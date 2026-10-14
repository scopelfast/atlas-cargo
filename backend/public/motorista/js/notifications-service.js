// backend/public/motorista/js/notifications-service.js
// Serviço Unificado de Notificações
// Versão: 1.1 — som foreground alinhado à torre (chat ~2s / alerta·SOS ~5s)
// Data: 2026-07-20

(function() {
  'use strict';

  const NOTIFICATION_TYPES = {
    CHAT: 'chat',
    SOS: 'sos',
    ALERTA: 'alerta',
    CONVOCACAO: 'convocacao',
    VIAGEM: 'viagem',
    GPS: 'gps',
    GERAL: 'geral'
  };

  // AudioContext só após gesto do usuário (política iOS/Android WebView / Chrome)
  let globalAudioContext = null;
  let audioContextUnlocked = false;

  function obterAudioContext() {
    if (!audioContextUnlocked || !globalAudioContext) return null;
    try {
      if (globalAudioContext.state === 'suspended') {
        const pr = globalAudioContext.resume();
        if (pr && typeof pr.catch === 'function') pr.catch(() => {});
      }
      return globalAudioContext;
    } catch (err) {
      return null;
    }
  }

  function inicializarAudioContext() {
    const eventos = ['click', 'touchstart', 'keydown'];
    const unlock = () => {
      eventos.forEach((ev) => document.removeEventListener(ev, unlock));
      try {
        if (!globalAudioContext) {
          globalAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (globalAudioContext.state === 'suspended') {
          const pr = globalAudioContext.resume();
          if (pr && typeof pr.catch === 'function') pr.catch(() => {});
        }
        audioContextUnlocked = true;
      } catch (e) {
        audioContextUnlocked = false;
      }
    };
    eventos.forEach((ev) => document.addEventListener(ev, unlock, { once: true, passive: true }));
  }

  // ==========================================
  // CONFIGURAÇÕES
  // ==========================================
  function getConfig() {
    const defaultConfig = {
      push: true,
      inApp: true,
      som: true,
      vibrar: true,
      tipos: {
        chat: true,
        sos: true,
        alerta: true,
        convocacao: true,
        viagem: true,
        gps: false,
        geral: true
      }
    };

    const saved = localStorage.getItem('notificacoes_config');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaultConfig, ...parsed };
      } catch (e) {
        console.warn('Erro ao ler configurações de notificações:', e);
      }
    }

    return defaultConfig;
  }

  function saveConfig(config) {
    localStorage.setItem('notificacoes_config', JSON.stringify(config));
  }

  // ==========================================
  // PERMISSÕES
  // ==========================================
  async function solicitarPermissaoPush() {
    if (!('Notification' in window)) {
      console.warn('Navegador não suporta notificações');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      console.warn('Permissão de notificação negada pelo usuário');
      return false;
    }

    // Solicitar permissão
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  async function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('Navegador não suporta Service Worker');
      return null;
    }

    try {
      // Construir caminho do Service Worker corretamente
      // Sempre usar origin + pathname para evitar duplicação
      const origin = window.location.origin;
      const pathname = window.location.pathname;
      
      // Detectar caminho base a partir do pathname atual
      let pathBase = '/';
      if (pathname.includes('/motorista')) {
        const indexMotorista = pathname.indexOf('/motorista');
        pathBase = pathname.substring(0, indexMotorista);
        if (!pathBase || pathBase === '') pathBase = '/';
      }
      
      // Remover barra final se houver
      if (pathBase !== '/' && pathBase.endsWith('/')) {
        pathBase = pathBase.replace(/\/$/, '');
      }
      
      // Construir caminho completo do SW
      const swPath = origin + (pathBase === '/' ? '' : pathBase) + '/motorista/sw-workbox.js';
      
      // scopePath baseado no pathname já obtido acima
      let scopePath = '/motorista/';
      if (pathname.includes('/cargas')) {
        scopePath = '/cargas/motorista/';
      }
      
      console.log('📦 [SW] origin:', origin);
      console.log('📦 [SW] pathname:', pathname);
      console.log('📦 [SW] pathBase:', pathBase);
      console.log('📦 [SW] swPath:', swPath);
      console.log('📦 [SW] scopePath:', scopePath);
      
      const registration = await navigator.serviceWorker.register(swPath, {
        scope: scopePath
      });
      console.log('✅ Service Worker registrado:', registration.scope);
      return registration;
    } catch (error) {
      console.error('❌ Erro ao registrar Service Worker:', error);
      return null;
    }
  }

  // ==========================================
  // NOTIFICAÇÕES IN-APP
  // ==========================================
  function mostrarNotificacaoInApp(titulo, mensagem, tipo = NOTIFICATION_TYPES.GERAL, dados = {}) {
    const config = getConfig();

    // Verificar se tipo está habilitado
    if (!config.tipos[tipo]) {
      return;
    }

    if (!config.inApp) {
      return;
    }

    // Criar elemento de notificação
    const notification = document.createElement('div');
    notification.className = `notification-in-app notification-${tipo}`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      padding: 16px 20px;
      min-width: 300px;
      max-width: 400px;
      z-index: 10000;
      animation: slideInRight 0.3s ease-out;
      border-left: 4px solid ${getColorByType(tipo)};
    `;

    const icon = getIconByType(tipo);
    notification.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 12px;">
        <div style="font-size: 24px; flex-shrink: 0;">${icon}</div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 600; font-size: 15px; color: #333; margin-bottom: 4px;">
            ${titulo}
          </div>
          <div style="font-size: 13px; color: #666; line-height: 1.4;">
            ${mensagem}
          </div>
        </div>
        <button class="notification-close" style="
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #999;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        ">×</button>
      </div>
    `;

    // Adicionar ao DOM
    document.body.appendChild(notification);

    // Fechar ao clicar no X
    const closeBtn = notification.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => {
      fecharNotificacaoInApp(notification);
    });

    // Fechar automaticamente após 5 segundos
    setTimeout(() => {
      fecharNotificacaoInApp(notification);
    }, 5000);

    // Tocar som e vibrar
    if (config.som) {
      tocarSomNotificacao(tipo);
    }

    if (config.vibrar && 'vibrate' in navigator) {
      vibrar(tipo);
    }

    // Click para abrir ação
    if (dados.acao) {
      notification.style.cursor = 'pointer';
      notification.addEventListener('click', () => {
        if (dados.acao === 'chat') {
          window.location.href = `/chat-motorista-standalone?viagem=${dados.idViagem || ''}`;
        } else if (dados.acao === 'sos') {
          window.location.href = `/motorista/pages/sos.html`;
        } else if (dados.acao === 'viagem') {
          window.location.href = `/motorista/pages/viagens.html`;
        } else if (dados.acao === 'dashboard') {
          window.location.href = `/motorista/pages/dashboard.html`;
        }
        fecharNotificacaoInApp(notification);
      });
    }
  }

  function fecharNotificacaoInApp(notification) {
    notification.style.animation = 'slideOutRight 0.3s ease-out';
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 300);
  }

  // ==========================================
  // NOTIFICAÇÕES PUSH (Service Worker)
  // ==========================================
  async function mostrarNotificacaoPush(titulo, mensagem, tipo = NOTIFICATION_TYPES.GERAL, dados = {}) {
    const config = getConfig();

    // Verificar se tipo está habilitado
    if (!config.tipos[tipo]) {
      return;
    }

    if (!config.push) {
      return;
    }

    // Verificar se página está em foco (se estiver, usar in-app)
    if (document.hasFocus()) {
      return;
    }

    const permission = await solicitarPermissaoPush();
    if (!permission) {
      return;
    }

    const registration = await registrarServiceWorker();
    if (!registration) {
      return;
    }

    const options = {
      body: mensagem,
      icon: '/img/logoAtlasTransparente.png',
      badge: '/img/logoAtlasTransparente.png',
      tag: `notification-${tipo}-${Date.now()}`,
      requireInteraction: tipo === NOTIFICATION_TYPES.SOS,
      data: dados,
      vibrate: config.vibrar ? getVibrationPattern(tipo) : undefined,
      sound: config.som ? undefined : undefined, // Som será tocado pelo Service Worker
      actions: []
    };

    // Adicionar ações baseadas no tipo
    if (tipo === NOTIFICATION_TYPES.CHAT && dados.idViagem) {
      options.actions.push({
        action: 'abrir-chat',
        title: 'Abrir Chat'
      });
    }

    if (tipo === NOTIFICATION_TYPES.SOS) {
      options.actions.push({
        action: 'abrir-sos',
        title: 'Ver SOS'
      });
    }

    try {
      await registration.showNotification(titulo, options);
    } catch (error) {
      console.error('Erro ao mostrar notificação push:', error);
    }
  }

  // ==========================================
  // FUNÇÕES AUXILIARES
  // ==========================================
  function getIconByType(tipo) {
    const icons = {
      [NOTIFICATION_TYPES.CHAT]: '💬',
      [NOTIFICATION_TYPES.SOS]: '🆘',
      [NOTIFICATION_TYPES.ALERTA]: '⚠️',
      [NOTIFICATION_TYPES.CONVOCACAO]: '📋',
      [NOTIFICATION_TYPES.VIAGEM]: '🚛',
      [NOTIFICATION_TYPES.GPS]: '📍',
      [NOTIFICATION_TYPES.GERAL]: '🔔'
    };
    return icons[tipo] || '🔔';
  }

  function getColorByType(tipo) {
    const colors = {
      [NOTIFICATION_TYPES.CHAT]: '#43e97b',
      [NOTIFICATION_TYPES.SOS]: '#e74c3c',
      [NOTIFICATION_TYPES.ALERTA]: '#f39c12',
      [NOTIFICATION_TYPES.CONVOCACAO]: '#3498db',
      [NOTIFICATION_TYPES.VIAGEM]: '#9b59b6',
      [NOTIFICATION_TYPES.GPS]: '#1abc9c',
      [NOTIFICATION_TYPES.GERAL]: '#0ea5e9'
    };
    return colors[tipo] || '#0ea5e9';
  }

  function getVibrationPattern(tipo) {
    const patterns = {
      [NOTIFICATION_TYPES.SOS]: [200, 100, 200, 100, 200],
      [NOTIFICATION_TYPES.ALERTA]: [200, 100, 200],
      [NOTIFICATION_TYPES.CHAT]: [200],
      [NOTIFICATION_TYPES.GERAL]: [200]
    };
    return patterns[tipo] || [200];
  }

  /**
   * Som in-app (foreground). Mesma lógica da torre/dashboard.
   * Chat ~2 s; alerta / SOS / demais ~5 s em pulsos.
   * Não substitui som de notificação do SO quando o app está em background.
   */
  function tocarSomNotificacao(tipo) {
    try {
      const config = getConfig();
      if (!config.som) return;

      const audioContext = obterAudioContext();
      if (!audioContext) return;

      const frequencies = {
        [NOTIFICATION_TYPES.SOS]: 1000,
        [NOTIFICATION_TYPES.ALERTA]: 800,
        [NOTIFICATION_TYPES.CHAT]: 600,
        [NOTIFICATION_TYPES.CONVOCACAO]: 700,
        [NOTIFICATION_TYPES.VIAGEM]: 550,
        [NOTIFICATION_TYPES.GERAL]: 500
      };
      const freq = frequencies[tipo] || 500;
      const duracaoSec = tipo === NOTIFICATION_TYPES.CHAT ? 2 : 5;
      const periodoPulso = 0.4;
      const now = audioContext.currentTime;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.type = 'sine';
      oscillator.frequency.value = freq;

      gainNode.gain.setValueAtTime(0.0001, now);
      const nPulsos = Math.max(1, Math.floor(duracaoSec / periodoPulso));
      for (let i = 0; i < nPulsos; i++) {
        const t0 = now + i * periodoPulso;
        gainNode.gain.setValueAtTime(0.0001, t0);
        gainNode.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
        gainNode.gain.setValueAtTime(0.22, t0 + 0.16);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
        if (tipo === NOTIFICATION_TYPES.SOS) {
          oscillator.frequency.setValueAtTime(i % 2 === 0 ? 1000 : 750, t0);
        }
      }

      oscillator.start(now);
      oscillator.stop(now + duracaoSec + 0.05);
    } catch (err) {
      // Silencioso — sem áudio até gesto do usuário (iOS/Android WebView)
    }
  }

  function vibrar(tipo) {
    if ('vibrate' in navigator) {
      const pattern = getVibrationPattern(tipo);
      navigator.vibrate(pattern);
    }
  }

  // ==========================================
  // API PÚBLICA
  // ==========================================
  window.NotificacoesService = {
    // Mostrar notificação (escolhe automaticamente push ou in-app)
    mostrar: async function(titulo, mensagem, tipo = NOTIFICATION_TYPES.GERAL, dados = {}) {
      // Sempre mostrar in-app se página está em foco
      if (document.hasFocus()) {
        mostrarNotificacaoInApp(titulo, mensagem, tipo, dados);
      } else {
        // Se página não está em foco, mostrar push
        await mostrarNotificacaoPush(titulo, mensagem, tipo, dados);
      }
    },

    // Mostrar apenas in-app
    mostrarInApp: function(titulo, mensagem, tipo = NOTIFICATION_TYPES.GERAL, dados = {}) {
      mostrarNotificacaoInApp(titulo, mensagem, tipo, dados);
    },

    // Mostrar apenas push
    mostrarPush: async function(titulo, mensagem, tipo = NOTIFICATION_TYPES.GERAL, dados = {}) {
      await mostrarNotificacaoPush(titulo, mensagem, tipo, dados);
    },

    // Configurações
    getConfig: getConfig,
    saveConfig: saveConfig,
    solicitarPermissaoPush: solicitarPermissaoPush,
    registrarServiceWorker: registrarServiceWorker,

    // Tipos
    TIPOS: NOTIFICATION_TYPES,

    // Som foreground (útil para teste / alinhamento com a torre)
    tocarSom: tocarSomNotificacao,
    audioLiberado: function() { return audioContextUnlocked; }
  };

  // ==========================================
  // ESTILOS CSS (adicionar ao head)
  // ==========================================
  if (!document.getElementById('notification-styles')) {
    const style = document.createElement('style');
    style.id = 'notification-styles';
    style.textContent = `
      @keyframes slideInRight {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      
      @keyframes slideOutRight {
        from {
          transform: translateX(0);
          opacity: 1;
        }
        to {
          transform: translateX(100%);
          opacity: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // Inicializar Service Worker + unlock de áudio ao carregar
  function boot() {
    inicializarAudioContext();
    registrarServiceWorker();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
