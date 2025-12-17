// APP Motorista - Sistema Offline com Dexie.js
// Versão: 2.0 - Dexie.js para maior robustez
// Data: 2025-01-16
// NOTA: Esta é uma versão melhorada. O sistema antigo continua funcionando.

import Dexie from 'https://cdn.jsdelivr.net/npm/dexie@3.2.4/dist/dexie.mjs';

// Configuração do banco de dados
const db = new Dexie('MotoristaDB_v2');
db.version(1).stores({
  // Cache de dados
  convocacoes: 'IDCONVOCACAO, STATUS, dataCache',
  cargas: 'IDVIAGEM, dataCache',
  macros: 'key, timestamp',
  viagens: 'key, timestamp',
  
  // Filas de sincronização
  filaGPS: '++id, idviagem, timestamp, enviado',
  filaEventos: '++id, idviagem, timestamp, enviado',
  filaAcoes: '++id, timestamp, enviado',
  filaMensagens: '++id, idviagem, timestamp, enviado',
  filaComprovantes: '++id, idviagem, timestamp, enviado'
});

// Abrir banco
db.open().catch(err => {
  console.error('Erro ao abrir Dexie:', err);
});

/**
 * Salvar no cache
 */
async function salvarCache(store, data) {
  try {
    if ((store === 'viagens' || store === 'macros') && data.dados !== undefined) {
      // Formato de cache genérico
      await db[store].put({
        key: store,
        dados: data.dados,
        timestamp: data.timestamp || Date.now(),
        url: data.url || '',
        version: data.version || '2.0'
      });
    } else if (Array.isArray(data)) {
      // Múltiplos itens
      await db[store].bulkPut(data.map(item => ({
        ...item,
        dataCache: new Date().toISOString()
      })));
    } else {
      // Item único
      await db[store].put({
        ...data,
        dataCache: new Date().toISOString()
      });
    }
    return true;
  } catch (err) {
    console.error(`Erro ao salvar cache em ${store}:`, err);
    throw err;
  }
}

/**
 * Buscar do cache
 */
async function buscarCache(store, key = null) {
  try {
    if (key) {
      return await db[store].get(key);
    } else if (store === 'viagens' || store === 'macros') {
      return await db[store].get(store);
    } else {
      return await db[store].toArray();
    }
  } catch (err) {
    console.error(`Erro ao buscar cache de ${store}:`, err);
    return null;
  }
}

/**
 * Adicionar à fila
 */
async function adicionarFila(store, item) {
  try {
    const itemCompleto = {
      ...item,
      timestamp: item.timestamp || Date.now(),
      enviado: false
    };
    
    const id = await db[store].add(itemCompleto);
    console.log(`✅ Item adicionado à fila ${store}:`, id);
    return id;
  } catch (err) {
    console.error(`Erro ao adicionar à fila ${store}:`, err);
    throw err;
  }
}

/**
 * Buscar fila
 */
async function buscarFila(store) {
  try {
    return await db[store].where('enviado').equals(false).toArray();
  } catch (err) {
    console.error(`Erro ao buscar fila ${store}:`, err);
    return [];
  }
}

/**
 * Marcar como enviado
 */
async function marcarEnviado(store, id) {
  try {
    await db[store].update(id, { enviado: true, dataEnvio: new Date().toISOString() });
    return true;
  } catch (err) {
    console.error(`Erro ao marcar como enviado em ${store}:`, err);
    return false;
  }
}

/**
 * Deletar da fila
 */
async function deletarDaFila(store, id) {
  try {
    await db[store].delete(id);
    return true;
  } catch (err) {
    console.error(`Erro ao deletar da fila ${store}:`, err);
    return false;
  }
}

/**
 * Verificar se está online
 */
function isOnline() {
  return navigator.onLine;
}

/**
 * Atualizar indicador visual
 */
async function atualizarIndicador() {
  const indicador = document.getElementById('statusIndicador');
  if (!indicador) return;

  const filaGPS = await buscarFila('filaGPS');
  const filaEventos = await buscarFila('filaEventos');
  const filaAcoes = await buscarFila('filaAcoes');
  const filaMensagens = await buscarFila('filaMensagens');
  const filaComprovantes = await buscarFila('filaComprovantes');
  
  const total = filaGPS.length + filaEventos.length + filaAcoes.length + 
                filaMensagens.length + filaComprovantes.length;

  if (isOnline()) {
    if (total === 0) {
      indicador.className = 'status-bar status-online';
      indicador.textContent = '🟢 Online - Sincronizado';
    } else {
      indicador.className = 'status-bar status-syncing';
      indicador.textContent = `🟡 Sincronizando... ${total} item(ns)`;
    }
  } else {
    indicador.className = 'status-bar status-offline';
    indicador.textContent = total > 0 
      ? `🔴 Offline - ${total} item(ns) na fila`
      : '🔴 Offline';
  }
}

/**
 * Sincronizar tudo
 */
async function sincronizarTudo() {
  if (!isOnline()) {
    console.log('📴 Offline - sincronização adiada');
    return;
  }

  console.log('🔄 Iniciando sincronização Dexie...');

  const stores = [
    { name: 'filaAcoes', endpoint: null, method: 'POST' },
    { name: 'filaGPS', endpoint: '/api/motorista/gps', method: 'POST' },
    { name: 'filaEventos', endpoint: '/api/motorista/evento', method: 'POST' },
    { name: 'filaMensagens', endpoint: '/api/motorista/chat', method: 'POST' },
    { name: 'filaComprovantes', endpoint: '/api/motorista/delivery-proof', method: 'POST' }
  ];

  for (const storeInfo of stores) {
    const items = await buscarFila(storeInfo.name);
    console.log(`📋 ${storeInfo.name}: ${items.length} itens`);

    for (const item of items) {
      try {
        const endpoint = item.endpoint || storeInfo.endpoint;
        if (!endpoint) continue;

        const baseUrl = window.__BASE_URL__ || ('http://' + window.location.host);
        const url = baseUrl + endpoint;
        
        const response = await fetch(url, {
          method: item.method || storeInfo.method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify(item.data || item)
        });

        if (response.ok) {
          await deletarDaFila(storeInfo.name, item.id);
          console.log(`✅ ${storeInfo.name} sincronizado:`, item.id);
        } else {
          console.error(`❌ Erro ${storeInfo.name}:`, response.status);
        }
      } catch (err) {
        console.error(`❌ Erro ao sincronizar ${storeInfo.name}:`, err);
      }
    }
  }

  await atualizarIndicador();
  console.log('✅ Sincronização Dexie completa!');
}

/**
 * Limpar todas as filas
 */
async function limparTodasFilas() {
  const stores = ['filaGPS', 'filaEventos', 'filaAcoes', 'filaMensagens', 'filaComprovantes'];
  
  for (const store of stores) {
    try {
      await db[store].clear();
      console.log(`🧹 Fila ${store} limpa`);
    } catch (err) {
      console.error(`Erro ao limpar ${store}:`, err);
    }
  }
}

// Exportar API compatível
window.OfflineDB_Dexie = {
  db,
  init: () => db.open(),
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
db.open().then(() => {
  console.log('✅ Dexie inicializado');
  atualizarIndicador();
  
  // Sincronizar a cada 30 segundos
  setInterval(() => {
    if (isOnline()) {
      sincronizarTudo();
    }
  }, 30000);
});

// Monitorar conexão
window.addEventListener('online', () => {
  console.log('🟢 Conexão restaurada!');
  atualizarIndicador();
  sincronizarTudo();
});

window.addEventListener('offline', () => {
  console.log('🔴 Conexão perdida!');
  atualizarIndicador();
});

console.log('✅ Sistema Offline Dexie v2.0 carregado');
