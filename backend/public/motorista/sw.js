// Service Worker - APP Motorista
// Permite funcionamento 100% offline

const CACHE_NAME = 'motorista-v2';
const urlsToCache = [
  // Páginas principais
  '/motorista/',
  '/motorista/index.html',
  '/motorista/pages/dashboard.html',
  '/motorista/pages/gps.html',
  '/motorista/pages/enviar-posicao.html',
  '/motorista/pages/macros.html',
  '/motorista/pages/viagens.html',
  '/motorista/pages/convocacoes.html',
  '/motorista/pages/cargas.html',
  '/motorista/pages/chat.html',
  '/motorista/pages/rastreamento.html',
  '/motorista/pages/eventos.html',
  '/motorista/pages/recuperar-senha.html',
  '/motorista/pages/cadastro.html',
  '/motorista/pages/diagnostico.html',
  
  // Scripts JS
  '/motorista/js/auth.js',
  '/motorista/js/offline.js',
  '/motorista/js/notifications.js',
  '/motorista/js/cache-helper.js',
  '/motorista/js/gps-auto.js',
  '/motorista/js/console-mobile.js',
  
  // CSS
  '/motorista/css/style.css',
  '/motorista/css/padrao-telas.css',
  
  // Assets
  '/motorista/manifest.json',
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

// Fetch - Estratégia: Network First para HTML, Cache First para assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Não cachear chamadas de API
  if (url.pathname.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'Offline - Dados não disponíveis' }),
          { headers: { 'Content-Type': 'application/json' }, status: 503 }
        );
      })
    );
    return;
  }
  
  // Estratégia para páginas HTML: Network First (tenta online, fallback cache)
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Salvar no cache
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(() => {
          // Offline - buscar do cache
          return caches.match(event.request).then((cached) => {
            if (cached) {
              console.log('📦 Servindo do cache:', url.pathname);
              return cached;
            }
            // Fallback para dashboard
            return caches.match('/motorista/pages/dashboard.html');
          });
        })
    );
    return;
  }
  
  // Estratégia para assets (JS, CSS, imagens): Cache First
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          return response;
        }
        
        return fetch(event.request)
          .then((response) => {
            // Cachear asset
            if (response && response.status === 200) {
              const responseToCache = response.clone();
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache);
              });
            }
            return response;
          });
      })
  );
});

