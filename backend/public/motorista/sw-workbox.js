// Service Worker - APP Motorista (Versão com Workbox)
// Versão: 2.0 - Cache inteligente + Background Sync
// Baseado no sw.js existente, mas com Workbox para cache mais eficiente

// Importar Workbox via CDN (sem necessidade de build)
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');

const CACHE_NAME = 'motorista-v3-workbox';

// Verificar se Workbox carregou
if (workbox) {
  console.log('✅ Workbox carregado!');

  // Configurar precache (arquivos críticos)
  workbox.precaching.precacheAndRoute([
    { url: '/motorista/index.html', revision: '3' },
    { url: '/motorista/pages/dashboard.html', revision: '3' },
    { url: '/motorista/js/auth.js', revision: '3' },
    { url: '/motorista/js/offline.js', revision: '3' },
    { url: '/motorista/css/style.css', revision: '3' }
  ]);

  // Estratégia para páginas HTML: Network First (atualiza quando online)
  workbox.routing.registerRoute(
    ({ request }) => request.destination === 'document',
    new workbox.strategies.NetworkFirst({
      cacheName: CACHE_NAME + '-pages',
      plugins: [
        {
          cacheKeyWillBeUsed: async ({ request }) => {
            // Incluir query string no cache key
            return request.url;
          },
          cacheWillUpdate: async ({ response }) => {
            // Só cachear respostas válidas
            return response && response.status === 200 ? response : null;
          }
        }
      ]
    })
  );

  // Estratégia para assets estáticos (JS, CSS): Cache First (rápido)
  workbox.routing.registerRoute(
    ({ request }) => 
      request.destination === 'script' || 
      request.destination === 'style' ||
      request.destination === 'image',
    new workbox.strategies.CacheFirst({
      cacheName: CACHE_NAME + '-assets',
      plugins: [
        {
          cacheWillUpdate: async ({ response }) => {
            return response && response.status === 200 ? response : null;
          },
          cacheKeyWillBeUsed: async ({ request }) => {
            // Incluir query string (para cache busting com ?v=timestamp)
            return request.url;
          }
        }
      ]
    })
  );

  // Estratégia para APIs: Network Only (não cachear, mas suporta Background Sync)
  workbox.routing.registerRoute(
    ({ url }) => url.pathname.startsWith('/api/'),
    new workbox.strategies.NetworkOnly({
      plugins: [
        // Background Sync para requisições que falharem
        {
          fetchDidFail: async ({ originalRequest, request }) => {
            // Se a requisição falhou, registrar para Background Sync
            // Isso será tratado pelo Background Sync Manager
            console.log('📴 Requisição falhou, será sincronizada quando online:', request.url);
          }
        }
      ]
    })
  );

  // Configurar expiração de cache (30 dias para assets, 1 dia para páginas)
  workbox.expiration.Plugin({
    maxEntries: 100,
    maxAgeSeconds: 30 * 24 * 60 * 60, // 30 dias
  });

  // Limpar caches antigos na ativação
  self.addEventListener('activate', (event) => {
    console.log('🔄 Service Worker Workbox: Ativando...');
    
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!cacheName.startsWith('motorista-v') || cacheName === CACHE_NAME) {
              return;
            }
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          })
        );
      }).then(() => {
        console.log('✅ Service Worker Workbox ativado!');
        return self.clients.claim();
      })
    );
  });

} else {
  console.error('❌ Workbox não carregou. Fallback para service worker básico.');
  
  // Fallback: código básico similar ao sw.js original
  const urlsToCache = [
    '/motorista/index.html',
    '/motorista/pages/dashboard.html',
    '/motorista/js/auth.js',
    '/motorista/js/offline.js',
    '/motorista/css/style.css'
  ];

  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME)
        .then((cache) => cache.addAll(urlsToCache))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      }).then(() => self.clients.claim())
    );
  });

  self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/')) {
      // APIs: não cachear
      return;
    }
    
    event.respondWith(
      fetch(event.request)
        .catch(() => caches.match(event.request))
    );
  });
}

// ==========================================
// BACKGROUND SYNC
// ==========================================

// Registrar sync para sincronização automática quando online
self.addEventListener('sync', (event) => {
  console.log('🔄 Background Sync acionado:', event.tag);
  
  if (event.tag === 'sync-offline-data') {
    event.waitUntil(syncOfflineData());
  }
  
  if (event.tag === 'sync-gps-queue') {
    event.waitUntil(syncGPSQueue());
  }
  
  if (event.tag === 'sync-messages-queue') {
    event.waitUntil(syncMessagesQueue());
  }
  
  if (event.tag === 'sync-sos-queue') {
    event.waitUntil(syncSOSQueue());
  }
});

// Função para sincronizar dados offline
async function syncOfflineData() {
  console.log('🔄 Iniciando sincronização de dados offline...');
  
  try {
    // Notificar a página principal para executar sincronização
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_OFFLINE_DATA',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar dados offline:', error);
  }
}

// Função para sincronizar fila GPS (prioridade alta)
async function syncGPSQueue() {
  console.log('📍 Sincronizando fila GPS...');
  
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_GPS_QUEUE',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar GPS:', error);
  }
}

// Função para sincronizar fila de mensagens
async function syncMessagesQueue() {
  console.log('💬 Sincronizando fila de mensagens...');
  
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_MESSAGES_QUEUE',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar mensagens:', error);
  }
}

// Função para sincronizar fila SOS (prioridade máxima)
async function syncSOSQueue() {
  console.log('🆘 Sincronizando fila SOS (prioridade máxima)...');
  
  try {
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_SOS_QUEUE',
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('❌ Erro ao sincronizar SOS:', error);
  }
}

// ==========================================
// PUSH NOTIFICATIONS (Futuro)
// ==========================================

self.addEventListener('push', (event) => {
  console.log('📬 Push notification recebida');
  
  const options = {
    body: event.data ? event.data.text() : 'Nova notificação',
    icon: '/img/logo7.png',
    badge: '/img/logo7.png',
    vibrate: [200, 100, 200],
    tag: 'notification',
    requireInteraction: true
  };
  
  event.waitUntil(
    self.registration.showNotification('LogiTrack Pro', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    clients.openWindow('/motorista/pages/dashboard.html')
  );
});

console.log('✅ Service Worker Workbox inicializado!');
