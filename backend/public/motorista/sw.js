// Service Worker - APP Motorista
// Permite funcionamento 100% offline

const CACHE_NAME = 'motorista-v1';
const urlsToCache = [
  '/motorista/',
  '/motorista/index.html',
  '/motorista/css/style.css',
  '/motorista/js/auth.js',
  '/motorista/js/offline.js',
  '/motorista/js/notifications.js',
  '/motorista/js/console-mobile.js',
  '/motorista/pages/dashboard.html',
  '/motorista/pages/convocacoes.html',
  '/motorista/pages/cargas.html',
  '/motorista/pages/rastreamento.html',
  '/motorista/pages/eventos.html',
  '/motorista/pages/chat.html',
  '/img/logo7.png'
];

// Install
self.addEventListener('install', (event) => {
  console.log('📦 Service Worker: Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('✅ Cache criado');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker instalado!');
        return self.skipWaiting();
      })
  );
});

// Activate
self.addEventListener('activate', (event) => {
  console.log('🔄 Service Worker: Ativando...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker ativado!');
      return self.clients.claim();
    })
  );
});

// Fetch
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Cache hit - retornar do cache
        if (response) {
          return response;
        }

        // Não está no cache - buscar da rede
        return fetch(event.request)
          .then((response) => {
            // Não cachear chamadas de API
            if (event.request.url.includes('/api/')) {
              return response;
            }

            // Verificar se é uma resposta válida
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clonar resposta
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          })
          .catch(() => {
            // Offline - retornar página offline se tiver
            return caches.match('/motorista/index.html');
          });
      })
  );
});

