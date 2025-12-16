// APP Motorista - Sistema Offline
// Versão: 1.0 - IndexedDB + Sincronização

(function() {
  let db = null;

  // ==========================================
  // INICIALIZAR IndexedDB
  // ==========================================
  async function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MotoristaDB', 5); // Versão 5 - ajustado 'viagens' e 'macros' para cache genérico

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store para convocações (cache)
        if (!db.objectStoreNames.contains('convocacoes')) {
          const convocacoes = db.createObjectStore('convocacoes', { keyPath: 'IDCONVOCACAO' });
          convocacoes.createIndex('status', 'STATUS', { unique: false });
          convocacoes.createIndex('dataCache', 'dataCache', { unique: false });
        }

        // Store para cargas disponíveis (cache)
        if (!db.objectStoreNames.contains('cargas')) {
          const cargas = db.createObjectStore('cargas', { keyPath: 'IDVIAGEM' });
          cargas.createIndex('dataCache', 'dataCache', { unique: false });
        }

        // Store para macros (cache) - formato genérico para cache-helper
        // Se já existe com schema antigo, deletar e recriar
        if (db.objectStoreNames.contains('macros')) {
          db.deleteObjectStore('macros');
        }
        // Criar com novo schema (keyPath 'key' para cache genérico)
        const macros = db.createObjectStore('macros', { keyPath: 'key' });
        macros.createIndex('timestamp', 'timestamp', { unique: false });

        // Store para viagens (cache) - formato genérico para cache-helper
        // Se já existe com schema antigo, deletar e recriar
        if (db.objectStoreNames.contains('viagens')) {
          db.deleteObjectStore('viagens');
        }
        // Criar com novo schema (keyPath 'key' para cache genérico)
        const viagens = db.createObjectStore('viagens', { keyPath: 'key' });
        viagens.createIndex('timestamp', 'timestamp', { unique: false });

        // Store para fila de GPS
        if (!db.objectStoreNames.contains('filaGPS')) {
          db.createObjectStore('filaGPS', { keyPath: 'id', autoIncrement: true });
        }

        // Store para fila de eventos
        if (!db.objectStoreNames.contains('filaEventos')) {
          db.createObjectStore('filaEventos', { keyPath: 'id', autoIncrement: true });
        }

        // Store para fila de ações (aceitar/recusar)
        if (!db.objectStoreNames.contains('filaAcoes')) {
          db.createObjectStore('filaAcoes', { keyPath: 'id', autoIncrement: true });
        }

        // Store para fila de mensagens (chat)
        if (!db.objectStoreNames.contains('filaMensagens')) {
          db.createObjectStore('filaMensagens', { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  // ==========================================
  // SALVAR NO CACHE
  // ==========================================
  async function salvarCache(store, data) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);

      // Se o store é 'viagens' ou 'macros' e o data tem estrutura de cache (com 'dados', 'timestamp', etc)
      // Salvar como cache genérico com key fixa
      if ((store === 'viagens' || store === 'macros') && data.dados !== undefined) {
        // Formato de cache genérico do cache-helper
        const cacheItem = {
          key: store, // Chave fixa para o cache deste store
          dados: data.dados,
          timestamp: data.timestamp || Date.now(),
          url: data.url || '',
          version: data.version || '2.0'
        };
        objectStore.put(cacheItem);
      } else if (Array.isArray(data)) {
        // Salvar múltiplos (formato antigo)
        data.forEach(item => {
          item.dataCache = new Date().toISOString();
          objectStore.put(item);
        });
      } else {
        // Salvar único (formato antigo)
        data.dataCache = new Date().toISOString();
        objectStore.put(data);
      }

      transaction.oncomplete = () => resolve(true);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // ==========================================
  // BUSCAR DO CACHE
  // ==========================================
  async function buscarCache(store, key = null) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readonly');
      const objectStore = transaction.objectStore(store);

      let request;
      if (key) {
        request = objectStore.get(key);
      } else if (store === 'viagens' || store === 'macros') {
        // Para viagens e macros, buscar pelo key fixo do cache genérico
        request = objectStore.get(store);
      } else {
        request = objectStore.getAll();
      }

      request.onsuccess = () => {
        const result = request.result;
        // Se for cache genérico (tem estrutura com 'dados'), retornar o objeto completo
        // Se for formato antigo (array), retornar diretamente
        resolve(result);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // ADICIONAR À FILA
  // ==========================================
  async function adicionarFila(store, data) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);

      data.timestamp = new Date().toISOString();
      data.enviado = false;

      const request = objectStore.add(data);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // BUSCAR FILA
  // ==========================================
  async function buscarFila(store) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readonly');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.getAll();

      request.onsuccess = () => {
        const items = request.result.filter(item => !item.enviado);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // MARCAR COMO ENVIADO
  // ==========================================
  async function marcarEnviado(store, id) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      
      const getRequest = objectStore.get(id);
      
      getRequest.onsuccess = () => {
        const item = getRequest.result;
        if (item) {
          item.enviado = true;
          item.dataEnvio = new Date().toISOString();
          objectStore.put(item);
        }
        resolve(true);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  // ==========================================
  // DELETAR DA FILA
  // ==========================================
  async function deletarDaFila(store, id) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // VERIFICAR STATUS ONLINE/OFFLINE
  // ==========================================
  function isOnline() {
    return navigator.onLine;
  }

  // ==========================================
  // ATUALIZAR INDICADOR VISUAL
  // ==========================================
  async function atualizarIndicador() {
    const indicador = document.getElementById('statusIndicador');
    if (!indicador) return;

    const filaGPS = await buscarFila('filaGPS');
    const filaEventos = await buscarFila('filaEventos');
    const filaAcoes = await buscarFila('filaAcoes');
    
    const total = filaGPS.length + filaEventos.length + filaAcoes.length;

    if (isOnline()) {
      if (total === 0) {
        indicador.className = 'status-online';
        indicador.innerHTML = '🟢 Online - Sincronizado';
      } else {
        indicador.className = 'status-syncing';
        indicador.innerHTML = `🟡 Sincronizando... ${total} item(ns)`;
      }
    } else {
      indicador.className = 'status-offline';
      indicador.innerHTML = total > 0 
        ? `🔴 Offline - ${total} item(ns) na fila`
        : '🔴 Offline';
    }
  }

  // ==========================================
  // SINCRONIZAR TUDO
  // ==========================================
  async function sincronizarTudo() {
    if (!isOnline()) {
      console.log('📴 Offline - sincronização adiada');
      return;
    }

    console.log('🔄 Iniciando sincronização...');

    try {
      // 1. Sincronizar ações (aceitar/recusar)
      const acoes = await buscarFila('filaAcoes');
      console.log(`📋 Ações na fila: ${acoes.length}`);
      
      for (const acao of acoes) {
        try {
          console.log('📤 Enviando ação:', acao.tipo, acao.url);
          
          const response = await fetch(acao.url, {
            method: acao.method,
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(acao.data)
          });

          console.log('📨 Resposta ação:', response.status);

          if (response.ok) {
            await deletarDaFila('filaAcoes', acao.id);
            console.log('✅ Ação sincronizada:', acao.tipo);
          } else {
            const erro = await response.text();
            console.error('❌ Erro servidor:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar ação:', err);
        }
      }

      // 2. Sincronizar GPS
      const gps = await buscarFila('filaGPS');
      console.log(`📍 GPS na fila: ${gps.length}`);
      
      for (const pos of gps) {
        try {
          console.log('📤 Enviando GPS:', pos);
          
          const response = await fetch('/api/motorista/gps', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(pos)
          });

          console.log('📨 Resposta GPS:', response.status);

          if (response.ok) {
            await deletarDaFila('filaGPS', pos.id);
            console.log('✅ GPS sincronizado');
          } else {
            const erro = await response.text();
            console.error('❌ Erro GPS:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar GPS:', err);
        }
      }

      // 3. Sincronizar eventos
      const eventos = await buscarFila('filaEventos');
      console.log(`📝 Eventos na fila: ${eventos.length}`);
      
      for (const evento of eventos) {
        try {
          console.log('📤 Enviando evento:', evento);
          
          const response = await fetch('/api/motorista/evento', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(evento)
          });

          console.log('📨 Resposta evento:', response.status);

          if (response.ok) {
            await deletarDaFila('filaEventos', evento.id);
            console.log('✅ Evento sincronizado');
          } else {
            const erro = await response.text();
            console.error('❌ Erro evento:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar evento:', err);
        }
      }

      await atualizarIndicador();
      console.log('✅ Sincronização completa!');
    } catch (err) {
      console.error('Erro na sincronização:', err);
    }
  }

  // ==========================================
  // MONITORAR CONEXÃO
  // ==========================================
  window.addEventListener('online', () => {
    console.log('🟢 Conexão restaurada!');
    atualizarIndicador();
    sincronizarTudo();
  });

  window.addEventListener('offline', () => {
    console.log('🔴 Conexão perdida!');
    atualizarIndicador();
  });

  // ==========================================
  // LIMPAR TODAS AS FILAS
  // ==========================================
  async function limparTodasFilas() {
    if (!db) await initDB();
    
    const stores = ['filaGPS', 'filaEventos', 'filaAcoes', 'filaMensagens'];
    
    for (const store of stores) {
      try {
        const transaction = db.transaction([store], 'readwrite');
        const objectStore = transaction.objectStore(store);
        await objectStore.clear();
        console.log(`🧹 Fila ${store} limpa`);
      } catch (err) {
        console.error(`Erro ao limpar ${store}:`, err);
      }
    }
  }

  // ==========================================
  // EXPORTAR FUNÇÕES
  // ==========================================
  window.OfflineDB = {
    init: initDB,
    salvarCache,
    buscarCache,
    adicionarFila,
    buscarFila,
    marcarEnviado,
    deletarDaFila,
    isOnline,
    atualizarIndicador,
    sincronizarTudo,
    limparTodasFilas
  };

  // Inicializar automaticamente
  initDB().then(() => {
    console.log('✅ IndexedDB inicializado');
    atualizarIndicador();
    
    // Tentar sincronizar a cada 30 segundos
    setInterval(() => {
      if (isOnline()) {
        sincronizarTudo();
      }
    }, 30000);
  });
})();

