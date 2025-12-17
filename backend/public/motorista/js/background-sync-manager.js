// Background Sync Manager
// Gerencia sincronização automática quando conexão volta
// Versão: 1.0

(function() {
  'use strict';

  // Verificar se Background Sync está disponível
  const isBackgroundSyncSupported = 'serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype;

  if (!isBackgroundSyncSupported) {
    console.warn('⚠️ Background Sync não suportado neste navegador');
    return;
  }

  console.log('✅ Background Sync Manager inicializado');

  // ==========================================
  // REGISTRAR SYNC TAGS
  // ==========================================

  /**
   * Registrar tag de sync para sincronização geral
   */
  async function registerSyncGeneral() {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-offline-data');
      console.log('✅ Sync "sync-offline-data" registrado');
      return true;
    } catch (error) {
      console.error('❌ Erro ao registrar sync geral:', error);
      return false;
    }
  }

  /**
   * Registrar tag de sync para fila GPS (prioridade alta)
   */
  async function registerSyncGPS() {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-gps-queue');
      console.log('✅ Sync "sync-gps-queue" registrado');
      return true;
    } catch (error) {
      console.error('❌ Erro ao registrar sync GPS:', error);
      return false;
    }
  }

  /**
   * Registrar tag de sync para fila de mensagens
   */
  async function registerSyncMessages() {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-messages-queue');
      console.log('✅ Sync "sync-messages-queue" registrado');
      return true;
    } catch (error) {
      console.error('❌ Erro ao registrar sync mensagens:', error);
      return false;
    }
  }

  /**
   * Registrar tag de sync para fila SOS (prioridade máxima)
   */
  async function registerSyncSOS() {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.sync.register('sync-sos-queue');
      console.log('✅ Sync "sync-sos-queue" registrado (prioridade máxima)');
      return true;
    } catch (error) {
      console.error('❌ Erro ao registrar sync SOS:', error);
      return false;
    }
  }

  // ==========================================
  // ESCUTAR MENSAGENS DO SERVICE WORKER
  // ==========================================

  // Escutar mensagens do service worker para acionar sincronização
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', async (event) => {
      const { type } = event.data;

      switch (type) {
        case 'SYNC_OFFLINE_DATA':
          console.log('🔄 Sincronizando todos os dados offline...');
          if (typeof window.sincronizarTudo === 'function') {
            await window.sincronizarTudo();
          }
          break;

        case 'SYNC_GPS_QUEUE':
          console.log('📍 Sincronizando fila GPS...');
          if (typeof window.sincronizarGPS === 'function') {
            await window.sincronizarGPS();
          } else if (typeof window.sincronizarTudo === 'function') {
            // Fallback para sincronização geral
            await window.sincronizarTudo();
          }
          break;

        case 'SYNC_MESSAGES_QUEUE':
          console.log('💬 Sincronizando fila de mensagens...');
          if (typeof window.sincronizarMensagens === 'function') {
            await window.sincronizarMensagens();
          } else if (typeof window.sincronizarTudo === 'function') {
            await window.sincronizarTudo();
          }
          break;

        case 'SYNC_SOS_QUEUE':
          console.log('🆘 Sincronizando fila SOS (prioridade máxima)...');
          if (typeof window.sincronizarSOS === 'function') {
            await window.sincronizarSOS();
          } else if (typeof window.sincronizarTudo === 'function') {
            await window.sincronizarTudo();
          }
          break;

        default:
          console.log('📨 Mensagem do service worker:', type);
      }
    });
  }

  // ==========================================
  // DETECTAR MUDANÇA DE CONEXÃO
  // ==========================================

  // Detectar quando a conexão volta
  window.addEventListener('online', async () => {
    console.log('🌐 Conexão restaurada! Iniciando sincronização...');
    
    // Aguardar um pouco para garantir que a conexão está estável
    setTimeout(async () => {
      // Registrar sync para sincronização automática
      await registerSyncGeneral();
      
      // Se houver fila GPS, sincronizar com prioridade
      if (typeof window.buscarFila === 'function') {
        try {
          const filaGPS = await window.buscarFila('filaGPS');
          if (filaGPS && filaGPS.length > 0) {
            await registerSyncGPS();
          }

          // Se houver mensagens, sincronizar
          const filaMensagens = await window.buscarFila('filaMensagens');
          if (filaMensagens && filaMensagens.length > 0) {
            await registerSyncMessages();
          }

          // Se houver SOS, sincronizar com máxima prioridade
          const filaSOS = await window.buscarFila('filaSOS');
          if (filaSOS && filaSOS.length > 0) {
            await registerSyncSOS();
          }
        } catch (error) {
          console.error('❌ Erro ao verificar filas:', error);
        }
      }

      // Executar sincronização geral
      if (typeof window.sincronizarTudo === 'function') {
        await window.sincronizarTudo();
      }
    }, 2000); // Aguardar 2 segundos após conexão
  });

  window.addEventListener('offline', () => {
    console.log('📴 Conexão perdida. Dados serão sincronizados automaticamente quando voltar.');
  });

  // ==========================================
  // FUNÇÕES PÚBLICAS
  // ==========================================

  // Exportar funções para uso global
  window.BackgroundSyncManager = {
    registerSyncGeneral,
    registerSyncGPS,
    registerSyncMessages,
    registerSyncSOS,
    isSupported: isBackgroundSyncSupported
  };

  // ==========================================
  // INICIALIZAÇÃO AUTOMÁTICA
  // ==========================================

  // Registrar sync quando a página carregar (se offline)
  if (!navigator.onLine) {
    console.log('📴 Sistema offline detectado. Registrando sync para quando voltar online...');
    registerSyncGeneral();
  }

  // Verificar periodicamente se há dados pendentes (a cada 5 minutos)
  setInterval(async () => {
    if (!navigator.onLine) {
      return; // Não fazer nada se offline
    }

    if (typeof window.buscarFila === 'function') {
      try {
        const filaGPS = await window.buscarFila('filaGPS');
        const filaMensagens = await window.buscarFila('filaMensagens');
        const filaSOS = await window.buscarFila('filaSOS');
        const filaComprovantes = await window.buscarFila('filaComprovantes');

        const totalPendente = 
          (filaGPS?.length || 0) +
          (filaMensagens?.length || 0) +
          (filaSOS?.length || 0) +
          (filaComprovantes?.length || 0);

        if (totalPendente > 0) {
          console.log(`🔄 ${totalPendente} item(s) pendente(s). Sincronizando...`);
          
          // Priorizar SOS
          if (filaSOS && filaSOS.length > 0) {
            await registerSyncSOS();
          }
          
          // Depois GPS
          if (filaGPS && filaGPS.length > 0) {
            await registerSyncGPS();
          }
          
          // Depois mensagens
          if (filaMensagens && filaMensagens.length > 0) {
            await registerSyncMessages();
          }
          
          // Por último, sincronização geral
          if (typeof window.sincronizarTudo === 'function') {
            await window.sincronizarTudo();
          }
        }
      } catch (error) {
        console.error('❌ Erro ao verificar pendências:', error);
      }
    }
  }, 5 * 60 * 1000); // 5 minutos

  console.log('✅ Background Sync Manager pronto');

})();
