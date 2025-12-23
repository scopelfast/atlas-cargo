// =============================================
// Cache Helper - Buscar com cache e fila offline
// Versão: 2.0 - Sistema de cache melhorado
// =============================================

console.log('📦 Carregando Cache Helper v2.0...');

// Configurações de validade do cache por tipo
const CACHE_CONFIG = {
  viagens: 60000,        // 1 minuto (dados dinâmicos)
  macros: 300000,        // 5 minutos (dados estáticos)
  cargas: 60000,         // 1 minuto (dados dinâmicos)
  convocacoes: 60000,    // 1 minuto (dados dinâmicos)
  default: 180000        // 3 minutos (padrão)
};

/**
 * Busca dados com cache inteligente
 * @param {string} url - URL da API
 * @param {string} cacheKey - Chave para salvar no IndexedDB
 * @param {number} maxAge - Idade máxima do cache em ms (opcional)
 * @param {boolean} forceOnline - Forçar busca online ignorando cache
 */
async function fetchComCache(url, cacheKey, maxAge = null, forceOnline = false) {
  const token = getToken();
  
  // Usar configuração padrão se não fornecido
  if (!maxAge) {
    maxAge = CACHE_CONFIG[cacheKey] || CACHE_CONFIG.default;
  }
  
  try {
    console.log(`🌐 Buscando online: ${url}`);
    
    // Tentar buscar da API
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      cache: forceOnline ? 'no-cache' : 'default'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const dados = await response.json();
    
    // Salvar no cache com metadados
    const cacheData = {
      dados: dados,
      timestamp: Date.now(),
      url: url,
      version: '2.0'
    };
    
    await window.OfflineDB.salvarCache(cacheKey, cacheData);
    
    const qtd = Array.isArray(dados) ? dados.length : 'obj';
    console.log(`💾 Cache atualizado: ${cacheKey} (${qtd} itens)`);
    
    return {
      dados,
      fonte: 'online',
      cache: false,
      timestamp: Date.now()
    };
    
  } catch (error) {
    console.warn(`⚠️ Erro ao buscar online:`, error.message);
    
    // Tentar buscar do cache
    const cacheCompleto = await window.OfflineDB.buscarCache(cacheKey);
    
    if (cacheCompleto) {
      // Suportar formato antigo e novo
      const dadosCache = cacheCompleto.dados || cacheCompleto;
      const timestampCache = cacheCompleto.timestamp || 0;
      
      if (dadosCache && (Array.isArray(dadosCache) || typeof dadosCache === 'object')) {
        const idade = Date.now() - timestampCache;
        const idadeMin = Math.floor(idade / 60000);
        const idadeSeg = Math.floor(idade / 1000);
        
        const qtd = Array.isArray(dadosCache) ? dadosCache.length : 'obj';
        console.log(`📦 Usando cache: ${cacheKey} (${qtd} itens, ${idadeMin > 0 ? idadeMin + 'min' : idadeSeg + 's'} atrás)`);
        
        // Avisar se cache muito antigo
        if (idade > maxAge) {
          const minutos = Math.floor(idade / 60000);
          console.warn(`⚠️ Cache antigo! ${minutos} minutos (máx: ${Math.floor(maxAge / 60000)}min)`);
          
          if (!forceOnline) {
            mostrarToast(`Dados podem estar desatualizados (${minutos}min atrás)`, 'warning');
          }
        }
        
        return {
          dados: dadosCache,
          fonte: 'cache',
          cache: true,
          timestamp: timestampCache,
          idade: idadeMin
        };
      }
    }
    
    throw new Error('Sem dados disponíveis (offline e sem cache)');
  }
}

/**
 * POST com fila offline automática
 * @param {string} url - URL da API
 * @param {object} dados - Dados para enviar
 * @param {string} tipoFila - Tipo da fila (gps, macro, chat, etc)
 */
async function postComFila(url, dados, tipoFila = 'acao') {
  const token = getToken();
  
  try {
    console.log(`🌐 Enviando online: ${url}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dados)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const resultado = await response.json();
    console.log(`✅ Enviado com sucesso (online)`);
    
    return {
      success: true,
      online: true,
      dados: resultado
    };
    
  } catch (error) {
    // Se for erro de duplicata na fila, não tentar salvar novamente
    if (error.message && error.message.includes('duplicata') || error.message.includes('já está na fila')) {
      console.warn(`⚠️ Duplicata detectada na fila:`, error.message);
      mostrarToast('Esta macro já está aguardando sincronização. Aguarde alguns segundos.', 'warning');
      return {
        success: false,
        online: false,
        fila: false,
        duplicata: true
      };
    }
    
    console.warn(`⚠️ Erro ao enviar, salvando na fila:`, error.message);
    
    // Mapear tipo de fila
    const filaStore = tipoFila === 'gps' ? 'filaGPS' 
                    : tipoFila === 'macro' ? 'filaEventos'
                    : tipoFila === 'chat' ? 'filaMensagens'
                    : 'filaAcoes';
    
    try {
      await window.OfflineDB.adicionarFila(filaStore, {
        url: url,
        endpoint: url, // Para compatibilidade
        method: 'POST',
        data: dados,
        tipo: tipoFila,
        timestamp: new Date().toISOString()
      });
      
      console.log(`💾 Salvo na fila: ${filaStore}`);
      await window.OfflineDB.atualizarIndicador();
      
      mostrarToast('Salvo! Será enviado quando houver conexão', 'info');
      
      return {
        success: true,
        online: false,
        fila: true
      };
    } catch (filaError) {
      // Se falhar ao adicionar na fila (ex: duplicata), retornar erro
      console.error(`❌ Erro ao adicionar na fila:`, filaError.message);
      throw filaError;
    }
  }
}

/**
 * Limpar cache específico
 */
async function limparCache(cacheKey) {
  try {
    const db = await window.OfflineDB.db;
    const tx = db.transaction([cacheKey], 'readwrite');
    const store = tx.objectStore(cacheKey);
    await store.clear();
    
    console.log(`🧹 Cache limpo: ${cacheKey}`);
    return true;
  } catch (error) {
    console.error('Erro ao limpar cache:', error);
    return false;
  }
}

/**
 * Limpar todos os caches de dados
 */
async function limparTodosOsCaches() {
  const caches = ['viagens', 'macros', 'cargas', 'convocacoes'];
  
  for (const cache of caches) {
    await limparCache(cache);
  }
  
  console.log('🧹 Todos os caches de dados limpos!');
  mostrarToast('Cache limpo com sucesso!', 'success');
  
  return true;
}

/**
 * Verificar se está online
 */
function estaOnline() {
  return navigator.onLine && (window.OfflineDB ? window.OfflineDB.isOnline() : true);
}

/**
 * Atualizar indicador visual de status
 */
async function atualizarStatusBar() {
  const statusBar = document.getElementById('statusIndicador');
  if (!statusBar) return;

  const online = estaOnline();
  
  if (online) {
    // Verificar se tem itens na fila
    let total = 0;
    
    if (window.OfflineDB) {
      try {
        const filaGPS = await window.OfflineDB.buscarFila('filaGPS');
        const filaEventos = await window.OfflineDB.buscarFila('filaEventos');
        const filaAcoes = await window.OfflineDB.buscarFila('filaAcoes');
        total = filaGPS.length + filaEventos.length + filaAcoes.length;
      } catch (e) {
        console.warn('Erro ao verificar filas:', e);
      }
    }
    
    if (total === 0) {
      statusBar.className = 'status-bar status-online';
      statusBar.innerHTML = '🟢 Online - Sincronizado';
    } else {
      statusBar.className = 'status-bar status-syncing';
      statusBar.innerHTML = `🟡 Sincronizando... ${total} item(ns) pendente(s)`;
    }
  } else {
    statusBar.className = 'status-bar status-offline';
    statusBar.innerHTML = '🔴 Offline - Usando dados salvos';
  }
}

// Auto-invalidar cache ao voltar online
window.addEventListener('online', async () => {
  console.log('🟢 Conexão restaurada! Invalidando caches...');
  
  // Limpar caches de dados dinâmicos
  await limparCache('viagens');
  await limparCache('cargas');
  await limparCache('convocacoes');
  
  atualizarStatusBar();
  
  if (window.OfflineDB) {
    window.OfflineDB.sincronizarTudo();
  }
  
  mostrarToast('Online! Dados sendo atualizados...', 'success');
  
  // Recarregar página após 2 segundos para pegar dados frescos
  setTimeout(() => {
    if (typeof location !== 'undefined') {
      location.reload();
    }
  }, 2000);
});

window.addEventListener('offline', () => {
  console.log('🔴 Modo offline ativado');
  atualizarStatusBar();
  mostrarToast('Modo offline - Usando dados salvos', 'warning');
});

// Atualizar status a cada 5 segundos
setInterval(atualizarStatusBar, 5000);

// Inicializar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', atualizarStatusBar);
} else {
  atualizarStatusBar();
}

console.log('✅ Cache Helper v2.0 carregado');
console.log('📋 Configuração de cache:', CACHE_CONFIG);
