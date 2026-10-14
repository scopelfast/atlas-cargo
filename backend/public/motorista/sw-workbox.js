// Service Worker - APP Motorista
// Versão: 2.2 - Suporta caminho base dinâmico (/cargas/)
// Removido Workbox para evitar problemas com CSP

const CACHE_NAME = 'motorista-v5';

// Função para detectar caminho base dinamicamente
function getBasePath() {
  try {
    // Tentar usar o scope do registration se disponível
    if (self.registration && self.registration.scope) {
      const scopeUrl = new URL(self.registration.scope);
      let pathBase = scopeUrl.pathname;
      
      // Remover /motorista/ do final se existir
      if (pathBase.endsWith('/motorista/')) {
        pathBase = pathBase.substring(0, pathBase.length - '/motorista/'.length);
      } else if (pathBase.endsWith('/motorista')) {
        pathBase = pathBase.substring(0, pathBase.length - '/motorista'.length);
      }
      
      // Garantir que pathBase termine sem barra (exceto se for root)
      if (pathBase !== '/' && pathBase.endsWith('/')) {
        pathBase = pathBase.replace(/\/$/, '');
      }
      
      return pathBase || '/';
    }
    
    // Fallback: usar a URL do próprio Service Worker
    if (self.location && self.location.href) {
      const swUrl = new URL(self.location.href);
      let pathBase = swUrl.pathname;
      
      // Remover nome do arquivo e /motorista/
      pathBase = pathBase.replace(/\/sw-workbox\.js$/, '');
      if (pathBase.endsWith('/motorista')) {
        pathBase = pathBase.substring(0, pathBase.length - '/motorista'.length);
      }
      
      if (pathBase !== '/' && pathBase.endsWith('/')) {
        pathBase = pathBase.replace(/\/$/, '');
      }
      
      return pathBase || '/';
    }
  } catch (e) {
    console.warn('⚠️ [SW] Erro ao detectar caminho base:', e);
  }
  
  // Fallback padrão: assumir root
  return '/';
}

// Detectar caminho base uma vez
const BASE_PATH = getBasePath();
const MOTORISTA_PATH = (BASE_PATH === '/' ? '' : BASE_PATH) + '/motorista';

console.log('📦 [SW] Base path detectado:', BASE_PATH);
console.log('📦 [SW] Motorista path:', MOTORISTA_PATH);

// Arquivos críticos para cache (ajustados com caminho base)
const urlsToCache = [
  `${MOTORISTA_PATH}/index.html`,
  `${MOTORISTA_PATH}/pages/dashboard.html`,
  `${MOTORISTA_PATH}/pages/perfil.html`,
  `${MOTORISTA_PATH}/js/auth.js`,
  `${MOTORISTA_PATH}/js/offline.js`,
  `${MOTORISTA_PATH}/css/style.css`
];

// Instalação: cachear arquivos críticos
self.addEventListener('install', (event) => {
  console.log('🔄 Service Worker: Instalando...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Cacheando arquivos críticos...');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker instalado!');
        return self.skipWaiting(); // Ativar imediatamente
      })
      .catch((error) => {
        console.error('❌ Erro ao instalar Service Worker:', error);
      })
  );
});

// Ativação: limpar caches antigos
self.addEventListener('activate', (event) => {
  console.log('🔄 Service Worker: Ativando...');
  
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('motorista-')) {
            console.log('🗑️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker ativado!');
      return self.clients.claim(); // Controlar todas as páginas imediatamente
    })
  );
});

// Interceptar requisições: Network First com fallback para cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // IMPORTANTE: Este Service Worker é APENAS para o APP Motorista
  // Não interceptar requisições que não são do APP Motorista
  // Apenas interceptar páginas do APP Motorista (ajustado com caminho base)
  const motoristaPathPattern = MOTORISTA_PATH + '/';
  const isMotoristaPage = url.pathname.startsWith(motoristaPathPattern);
  
  // Se não for do APP Motorista, deixar passar sem interceptar
  if (!isMotoristaPage) {
    return; // Não interceptar - deixar o navegador fazer a requisição normalmente
  }

  // Páginas HTML (navegação): sempre buscar no servidor quando online, para telas atualizarem sem F5
  const isHtmlPage = event.request.mode === 'navigate' ||
    event.request.destination === 'document' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('/');
  if (isHtmlPage) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store', redirect: 'follow' })
        .then((response) => {
          if (response.status === 200) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then((cached) => cached || caches.match(`${MOTORISTA_PATH}/pages/dashboard.html`) || caches.match(`${MOTORISTA_PATH}/index.html`));
        })
    );
    return;
  }
  
  // Para recursos compartilhados (/img/, /css/, /js/), só interceptar se vierem de uma página do motorista
  const isSharedResource = url.pathname.startsWith('/img/') || 
                          url.pathname.startsWith('/css/') || 
                          url.pathname.startsWith('/js/') ||
                          (BASE_PATH !== '/' && (url.pathname.startsWith(BASE_PATH + '/img/') || 
                                                  url.pathname.startsWith(BASE_PATH + '/css/') || 
                                                  url.pathname.startsWith(BASE_PATH + '/js/')));
  
  if (isSharedResource) {
    // Verificar se a requisição veio de uma página do motorista através do referer
    const referer = event.request.referrer || '';
    if (!referer.includes('/motorista/')) {
      return; // Não interceptar recursos compartilhados se não vierem do APP Motorista
    }
  }
  
  // IMPORTANTE: Corrigir requisições de tiles que tentam usar HTTPS
  // Se for uma requisição para o servidor de tiles via HTTPS, forçar HTTP
  if (url.hostname === '186.250.92.131' && (url.protocol === 'https:' || event.request.url.includes('https://' + url.hostname))) {
    const httpUrl = event.request.url.replace(/^https:/, 'http:');
    console.log('🔄 [SW] Convertendo HTTPS para HTTP:', event.request.url, '→', httpUrl);
    event.respondWith(
      fetch(httpUrl, {
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-cache'
      }).catch((error) => {
        console.error('❌ [SW] Erro ao buscar tile:', httpUrl, error);
        // Se falhar, retornar erro
        return new Response('', { status: 404 });
      })
    );
    return;
  }
  
  // Não cachear requisições de API
  if (url.pathname.startsWith('/api/')) {
    // APIs: sempre tentar rede, sem cache
    event.respondWith(
      fetch(event.request)
        .catch((error) => {
          console.log('📴 API offline:', event.request.url);
          // Retornar resposta vazia ou erro para APIs offline
          return new Response(
            JSON.stringify({ error: 'Offline', message: 'Sem conexão com o servidor' }),
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'application/json' }
            }
          );
        })
    );
    return;
  }
  
  // Para outros recursos: Network First (tentar rede, usar cache se falhar)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Se a resposta é válida, clonar e cachear
        if (response.status === 200) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Se a rede falhou, tentar cache
        return caches.match(event.request)
          .then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Se não há cache, retornar página offline padrão
            if (event.request.destination === 'document') {
              return caches.match(`${MOTORISTA_PATH}/index.html`);
            }
            return new Response('Recurso não disponível offline', {
              status: 404,
              statusText: 'Not Found'
            });
          });
      })
  );
});

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

// Flag para evitar múltiplas execuções simultâneas
let syncInProgress = false;
let lastSyncTime = 0;
const SYNC_COOLDOWN = 5000; // 5 segundos entre sincronizações

// Função para sincronizar dados offline
async function syncOfflineData() {
  const now = Date.now();
  
  // Evitar múltiplas execuções simultâneas ou muito próximas
  if (syncInProgress) {
    console.log('⏸️ Sincronização já em andamento. Pulando...');
    return;
  }
  
  if (now - lastSyncTime < SYNC_COOLDOWN) {
    console.log(`⏸️ Sincronização muito recente (${Math.floor((now - lastSyncTime) / 1000)}s atrás). Aguardando cooldown...`);
    return;
  }
  
  syncInProgress = true;
  lastSyncTime = now;
  console.log('🔄 Iniciando sincronização de dados offline...');
  
  try {
    // Notificar a página principal para executar sincronização
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(client => {
      client.postMessage({
        type: 'SYNC_OFFLINE_DATA',
        timestamp: now
      });
    });
    
    // Aguardar um pouco antes de permitir nova sincronização
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (error) {
    console.error('❌ Erro ao sincronizar dados offline:', error);
  } finally {
    syncInProgress = false;
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
// PUSH NOTIFICATIONS
// ==========================================

self.addEventListener('push', (event) => {
  console.log('📬 Push notification recebida');
  
  let data = {
    title: 'LogiTrack Pro',
    body: 'Nova notificação',
    icon: (BASE_PATH === '/' ? '' : BASE_PATH) + '/img/logoAtlasTransparente.png',
    tag: 'notification',
    tipo: 'geral',
    dados: {}
  };

  // Tentar parsear dados do push
  if (event.data) {
    try {
      const parsed = JSON.parse(event.data.text());
      data = { ...data, ...parsed };
    } catch (e) {
      // Se não for JSON, usar como texto
      data.body = event.data.text();
    }
  }

  const iconPath = (BASE_PATH === '/' ? '' : BASE_PATH) + '/img/logoAtlasTransparente.png';
  const options = {
    body: data.body,
    icon: data.icon || iconPath,
    badge: iconPath,
    vibrate: data.tipo === 'sos' ? [200, 100, 200, 100, 200] : [200, 100, 200],
    tag: data.tag || `notification-${Date.now()}`,
    requireInteraction: data.tipo === 'sos',
    data: data.dados || {},
    actions: []
  };

  // Adicionar ações baseadas no tipo
  if (data.tipo === 'chat' && data.dados?.idViagem) {
    options.actions.push({
      action: 'abrir-chat',
      title: 'Abrir Chat'
    });
  }

  if (data.tipo === 'sos') {
    options.actions.push({
      action: 'abrir-sos',
      title: 'Ver SOS'
    });
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'LogiTrack Pro', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('🔔 Notificação clicada:', event.notification.tag);
  
  event.notification.close();

  const action = event.action;
  const dados = event.notification.data || {};

  let url = `${MOTORISTA_PATH}/pages/dashboard.html`;

  // Determinar URL baseado na ação ou tipo
  if (action === 'abrir-chat' || dados.acao === 'chat') {
    url = `${MOTORISTA_PATH}/pages/chat.html?viagem=${dados.idViagem || ''}`;
  } else if (action === 'abrir-sos' || dados.acao === 'sos') {
    url = `${MOTORISTA_PATH}/pages/sos.html`;
  } else if (dados.acao === 'viagem') {
    url = `${MOTORISTA_PATH}/pages/viagens.html`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // Verificar se já existe uma janela aberta
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url.includes('/motorista/') && 'focus' in client) {
            return client.focus().then(() => {
              // Navegar para a URL se necessário
              if (!client.url.includes(url.split('?')[0])) {
                return client.navigate(url);
              }
            });
          }
        }
        // Se não há janela aberta, abrir nova
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

console.log('✅ Service Worker Workbox inicializado!');
