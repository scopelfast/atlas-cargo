// APP Motorista - Sistema Offline
// Versão: 1.0 - IndexedDB + Sincronização

(function() {
  let db = null;

  // ==========================================
  // INICIALIZAR IndexedDB
  // ==========================================
  async function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MotoristaDB', 8); // Versão 8 - adicionada store 'syncMetadata' (sincronização incremental)

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store para metadados de sincronização (timestamps)
        if (!db.objectStoreNames.contains('syncMetadata')) {
          const syncMetadata = db.createObjectStore('syncMetadata', { keyPath: 'key' });
          syncMetadata.createIndex('timestamp', 'timestamp', { unique: false });
        }

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

        // Store para fila de comprovantes de entrega
        if (!db.objectStoreNames.contains('filaComprovantes')) {
          db.createObjectStore('filaComprovantes', { keyPath: 'id', autoIncrement: true });
        }

        // Store para fila de alertas SOS (prioridade máxima)
        if (!db.objectStoreNames.contains('filaSOS')) {
          db.createObjectStore('filaSOS', { keyPath: 'id', autoIncrement: true });
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
  // CONFIGURAÇÕES DE FILA
  // ==========================================
  const FILA_CONFIG = {
    filaGPS: { maxSize: 1000, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 dias
    filaEventos: { maxSize: 500, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 dias
    filaAcoes: { maxSize: 200, maxAge: 3 * 24 * 60 * 60 * 1000 }, // 3 dias
    filaMensagens: { maxSize: 500, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 dias
    filaComprovantes: { maxSize: 200, maxAge: 7 * 24 * 60 * 60 * 1000 }, // 7 dias
    filaSOS: { maxSize: 100, maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 dias (emergência)
  };

  // ==========================================
  // VALIDAR DADOS ANTES DE ADICIONAR À FILA
  // ==========================================
  function validarDadosFila(store, data) {
    if (!data || typeof data !== 'object') {
      throw new Error('Dados inválidos: deve ser um objeto');
    }

    // Validações específicas por tipo de fila
    if (store === 'filaGPS') {
      if (!data.LATITUDE || !data.LONGITUDE || !data.IDVIAGEM) {
        throw new Error('GPS inválido: faltam campos obrigatórios (LATITUDE, LONGITUDE, IDVIAGEM)');
      }
    } else if (store === 'filaEventos') {
      if (!data.IDVIAGEM) {
        throw new Error('Evento inválido: falta IDVIAGEM');
      }
    } else if (store === 'filaMensagens') {
      if (!data.idviagem || !data.mensagem) {
        throw new Error('Mensagem inválida: faltam campos obrigatórios');
      }
    } else if (store === 'filaComprovantes') {
      if (!data.idviagem) {
        throw new Error('Comprovante inválido: falta idviagem');
      }
    } else if (store === 'filaSOS') {
      if (!data.idviagem) {
        throw new Error('SOS inválido: falta idviagem');
      }
    }

    return true;
  }

  // ==========================================
  // LIMPAR DADOS ANTIGOS DA FILA
  // ==========================================
  async function limparDadosAntigos(store) {
    if (!db) await initDB();
    
    const config = FILA_CONFIG[store];
    if (!config) return;

    const maxAge = config.maxAge;
    const agora = Date.now();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);
      const request = objectStore.openCursor();
      let removidos = 0;

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const item = cursor.value;
          const timestamp = item.timestamp ? new Date(item.timestamp).getTime() : 0;
          
          // Se item muito antigo e já foi enviado, remover
          if (timestamp > 0 && (agora - timestamp) > maxAge && item.enviado) {
            cursor.delete();
            removidos++;
          }
          
          cursor.continue();
        } else {
          if (removidos > 0) {
            console.log(`🧹 Limpeza automática: ${removidos} itens antigos removidos de ${store}`);
          }
          resolve(removidos);
        }
      };

      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // VERIFICAR E LIMITAR TAMANHO DA FILA
  // ==========================================
  async function verificarLimiteFila(store) {
    if (!db) await initDB();
    
    const config = FILA_CONFIG[store];
    if (!config) return;

    const maxSize = config.maxSize;
    const fila = await buscarFila(store);

    if (fila.length > maxSize) {
      // Remover itens mais antigos (exceto SOS que tem prioridade)
      const itensParaRemover = fila
        .filter(item => item.enviado || store === 'filaSOS' ? false : true) // Não remover SOS não enviados
        .sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeA - timeB;
        })
        .slice(0, fila.length - maxSize);

      for (const item of itensParaRemover) {
        await deletarDaFila(store, item.id);
      }

      console.warn(`⚠️ Fila ${store} excedeu limite (${fila.length} > ${maxSize}). ${itensParaRemover.length} itens antigos removidos.`);
    }
  }

  // ==========================================
  // ADICIONAR À FILA (COM VALIDAÇÃO E LIMITES)
  // ==========================================
  async function adicionarFila(store, data) {
    if (!db) await initDB();
    
    // Validar dados
    try {
      validarDadosFila(store, data);
    } catch (error) {
      console.error(`❌ Erro de validação ao adicionar à fila ${store}:`, error.message);
      throw error;
    }

    // Verificar limite antes de adicionar
    await verificarLimiteFila(store);

    // Limpar dados antigos periodicamente (apenas a cada 10 itens adicionados)
    const limpezaKey = `lastCleanup_${store}`;
    const lastCleanup = localStorage.getItem(limpezaKey);
    const agora = Date.now();
    if (!lastCleanup || (agora - parseInt(lastCleanup)) > 60000) { // A cada 1 minuto
      await limparDadosAntigos(store);
      localStorage.setItem(limpezaKey, agora.toString());
    }
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([store], 'readwrite');
      const objectStore = transaction.objectStore(store);

      data.timestamp = new Date().toISOString();
      data.enviado = false;
      data.tentativas = 0; // Contador de tentativas de envio

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
    const filaComprovantes = await buscarFila('filaComprovantes');
    const filaSOS = await buscarFila('filaSOS');
    
    const total = filaGPS.length + filaEventos.length + filaAcoes.length + filaComprovantes.length + filaSOS.length;

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
  // OBTER TIMESTAMP DA ÚLTIMA SINCRONIZAÇÃO
  // ==========================================
  async function obterUltimaSync(store) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['syncMetadata'], 'readonly');
      const objectStore = transaction.objectStore('syncMetadata');
      const request = objectStore.get(store);
      
      request.onsuccess = () => {
        const metadata = request.result;
        resolve(metadata ? metadata.timestamp : null);
      };
      
      request.onerror = () => resolve(null); // Se der erro, retornar null (sincronizar tudo)
    });
  }

  // ==========================================
  // SALVAR TIMESTAMP DA SINCRONIZAÇÃO
  // ==========================================
  async function salvarUltimaSync(store, timestamp) {
    if (!db) await initDB();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['syncMetadata'], 'readwrite');
      const objectStore = transaction.objectStore('syncMetadata');
      const request = objectStore.put({
        key: store,
        timestamp: timestamp || new Date().toISOString()
      });
      
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ==========================================
  // RETRY COM BACKOFF EXPONENCIAL
  // ==========================================
  async function tentarEnviarComRetry(url, options, maxTentativas = 3) {
    let tentativa = 0;
    
    while (tentativa < maxTentativas) {
      try {
        const response = await fetch(url, options);
        
        // Se sucesso ou erro permanente (4xx exceto 429), retornar
        if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          return { response, sucesso: response.ok, tentativas: tentativa + 1 };
        }
        
        // Se erro temporário (5xx ou 429), tentar novamente
        if (response.status >= 500 || response.status === 429) {
          tentativa++;
          if (tentativa < maxTentativas) {
            const delay = Math.min(1000 * Math.pow(2, tentativa), 30000); // Max 30s
            console.log(`⏳ Erro temporário (${response.status}). Tentando novamente em ${delay/1000}s... (${tentativa}/${maxTentativas})`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
        }
        
        return { response, sucesso: false, tentativas: tentativa + 1 };
      } catch (err) {
        tentativa++;
        if (tentativa < maxTentativas) {
          const delay = Math.min(1000 * Math.pow(2, tentativa), 30000);
          console.log(`⏳ Erro de rede. Tentando novamente em ${delay/1000}s... (${tentativa}/${maxTentativas})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw err;
        }
      }
    }
    
    throw new Error('Máximo de tentativas atingido');
  }

  // ==========================================
  // SINCRONIZAR TUDO (INCREMENTAL COM RETRY)
  // ==========================================
  async function sincronizarTudo() {
    if (!isOnline()) {
      console.log('📴 Offline - sincronização adiada');
      return;
    }

    console.log('🔄 Iniciando sincronização incremental...');

    try {
      // PRIORIDADE MÁXIMA: Sincronizar alertas SOS primeiro (emergência)
      const alertasSOS = await buscarFila('filaSOS');
      console.log(`🆘 Alertas SOS na fila: ${alertasSOS.length}`);
      
      for (const alerta of alertasSOS) {
        try {
          console.log('🆘 Enviando alerta SOS:', alerta.id);
          
          const dadosEnvio = alerta.data || alerta;
          delete dadosEnvio.id;
          delete dadosEnvio.timestamp;
          delete dadosEnvio.enviado;
          
          const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
          const { response, sucesso, tentativas } = await tentarEnviarComRetry(
            baseUrl + '/api/motorista/sos',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(dadosEnvio)
            },
            5 // SOS tem mais tentativas (emergência)
          );

          console.log('📨 Resposta SOS:', response.status, `(${tentativas} tentativas)`);

          if (sucesso) {
            await deletarDaFila('filaSOS', alerta.id);
            console.log('✅ Alerta SOS sincronizado');
          } else {
            // Atualizar contador de tentativas
            alerta.tentativas = (alerta.tentativas || 0) + tentativas;
            await atualizarTentativasFila('filaSOS', alerta.id, alerta.tentativas);
            
            const erro = await response.text();
            console.error('❌ Erro SOS:', response.status, erro);
            
            // Se muitas tentativas falharam, pode ser erro permanente
            if (alerta.tentativas >= 10) {
              console.warn('⚠️ SOS com muitas tentativas falhadas. Pode ser erro permanente.');
            }
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar SOS:', err);
        }
      }

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

      // 2. Sincronizar GPS (incremental - apenas novos desde última sync)
      const ultimaSyncGPS = await obterUltimaSync('filaGPS');
      const gps = await buscarFila('filaGPS');
      
      // Filtrar apenas GPS novos (se houver timestamp da última sync)
      let gpsParaSincronizar = gps;
      if (ultimaSyncGPS) {
        gpsParaSincronizar = gps.filter(pos => {
          const posTimestamp = pos.timestamp || pos.dataEnvio || new Date().toISOString();
          return new Date(posTimestamp) > new Date(ultimaSyncGPS);
        });
        console.log(`📍 GPS na fila: ${gps.length} (${gpsParaSincronizar.length} novos desde última sync)`);
      } else {
        console.log(`📍 GPS na fila: ${gps.length} (primeira sincronização)`);
      }
      
      let gpsSincronizados = 0;
      for (const pos of gpsParaSincronizar) {
        try {
          console.log('📤 Enviando GPS:', pos.id);
          
          const { response, sucesso, tentativas } = await tentarEnviarComRetry(
            '/api/motorista/gps',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(pos)
            }
          );

          console.log('📨 Resposta GPS:', response.status, `(${tentativas} tentativas)`);

          if (sucesso) {
            await deletarDaFila('filaGPS', pos.id);
            gpsSincronizados++;
            console.log('✅ GPS sincronizado');
          } else {
            // Atualizar contador de tentativas
            pos.tentativas = (pos.tentativas || 0) + tentativas;
            await atualizarTentativasFila('filaGPS', pos.id, pos.tentativas);
            
            const erro = await response.text();
            console.error('❌ Erro GPS:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar GPS:', err);
        }
      }
      
      // Salvar timestamp da sincronização se houve sucessos
      if (gpsSincronizados > 0) {
        await salvarUltimaSync('filaGPS', new Date().toISOString());
      }

      // 3. Sincronizar eventos (macros) - incremental
      const ultimaSyncEventos = await obterUltimaSync('filaEventos');
      const eventos = await buscarFila('filaEventos');
      
      // Filtrar apenas eventos novos
      let eventosParaSincronizar = eventos;
      if (ultimaSyncEventos) {
        eventosParaSincronizar = eventos.filter(evento => {
          const eventTimestamp = evento.timestamp || new Date().toISOString();
          return new Date(eventTimestamp) > new Date(ultimaSyncEventos);
        });
        console.log(`📝 Eventos na fila: ${eventos.length} (${eventosParaSincronizar.length} novos desde última sync)`);
      } else {
        console.log(`📝 Eventos na fila: ${eventos.length} (primeira sincronização)`);
      }
      
      let eventosSincronizados = 0;
      for (const evento of eventosParaSincronizar) {
        try {
          console.log('📤 Enviando evento:', evento);
          
          // Determinar endpoint e dados corretos
          let endpoint = '/api/motorista/macro';
          let dadosEnvio = evento;
          
          // Se o evento tem estrutura com url/data, extrair dados corretos
          if (evento.url && evento.data) {
            endpoint = evento.url;
            dadosEnvio = evento.data;
          } else if (evento.endpoint) {
            endpoint = evento.endpoint;
            dadosEnvio = evento.data || evento;
          }
          
          // Garantir que endpoint começa com /api
          if (!endpoint.startsWith('/api')) {
            endpoint = '/api/motorista/macro';
          }
          
          // Remover campos que não devem ser enviados (campos da fila)
          const { id, url, endpoint: _, tipo, timestamp, ...dadosLimpos } = dadosEnvio;
          
          // Se ainda tiver estrutura aninhada, extrair dados
          const dadosFinais = dadosLimpos.data || dadosLimpos;
          
          console.log('📦 Dados que serão enviados:', JSON.stringify(dadosFinais, null, 2));
          
          const { response, sucesso, tentativas } = await tentarEnviarComRetry(
            endpoint,
            {
              method: evento.method || 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(dadosFinais)
            }
          );

          console.log('📨 Resposta evento:', response.status, `(${tentativas} tentativas)`);

          if (sucesso) {
            await deletarDaFila('filaEventos', evento.id);
            eventosSincronizados++;
            console.log('✅ Evento sincronizado');
          } else {
            // Atualizar contador de tentativas
            evento.tentativas = (evento.tentativas || 0) + tentativas;
            await atualizarTentativasFila('filaEventos', evento.id, evento.tentativas);
            const erroTexto = await response.text();
            let erroJson;
            try {
              erroJson = JSON.parse(erroTexto);
            } catch {
              erroJson = { error: erroTexto };
            }
            console.error('❌ Erro evento:', response.status, erroJson);
            
            // Se for erro 400 (validação), remover da fila para não ficar tentando
            if (response.status === 400) {
              console.warn('⚠️ Erro de validação - removendo da fila');
              await deletarDaFila('filaEventos', evento.id);
            }
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar evento:', err);
          console.error('❌ Stack:', err.stack);
        }
      }
      
      // Salvar timestamp da sincronização se houve sucessos
      if (eventosSincronizados > 0) {
        await salvarUltimaSync('filaEventos', new Date().toISOString());
      }

      // 4. Sincronizar mensagens de chat (incremental)
      const ultimaSyncMensagens = await obterUltimaSync('filaMensagens');
      const mensagensChat = await buscarFila('filaMensagens');
      
      // Filtrar apenas mensagens novas
      let mensagensParaSincronizar = mensagensChat;
      if (ultimaSyncMensagens) {
        mensagensParaSincronizar = mensagensChat.filter(msg => {
          const msgTimestamp = msg.timestamp || new Date().toISOString();
          return new Date(msgTimestamp) > new Date(ultimaSyncMensagens);
        });
        console.log(`💬 Mensagens na fila: ${mensagensChat.length} (${mensagensParaSincronizar.length} novas desde última sync)`);
      } else {
        console.log(`💬 Mensagens na fila: ${mensagensChat.length} (primeira sincronização)`);
      }
      
      let mensagensSincronizadas = 0;
      for (const mensagem of mensagensParaSincronizar) {
        try {
          console.log('📤 Enviando mensagem:', mensagem.idviagem);
          
          const endpoint = mensagem.endpoint || '/api/messages';
          const method = mensagem.method || 'POST';
          
          // Remover campos internos antes de enviar
          const dadosEnvio = mensagem.data || mensagem;
          delete dadosEnvio.id;
          delete dadosEnvio.endpoint;
          delete dadosEnvio.method;
          delete dadosEnvio.timestamp;
          delete dadosEnvio.enviado;
          
          const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
          const { response, sucesso, tentativas } = await tentarEnviarComRetry(
            baseUrl + endpoint,
            {
              method: method,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(dadosEnvio)
            }
          );

          console.log('📨 Resposta mensagem:', response.status, `(${tentativas} tentativas)`);

          if (sucesso) {
            await deletarDaFila('filaMensagens', mensagem.id);
            mensagensSincronizadas++;
            console.log('✅ Mensagem sincronizada');
          } else {
            // Atualizar contador de tentativas
            mensagem.tentativas = (mensagem.tentativas || 0) + tentativas;
            await atualizarTentativasFila('filaMensagens', mensagem.id, mensagem.tentativas);
            
            const erro = await response.text();
            console.error('❌ Erro mensagem:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar mensagem:', err);
        }
      }
      
      // Salvar timestamp da sincronização se houve sucessos
      if (mensagensSincronizadas > 0) {
        await salvarUltimaSync('filaMensagens', new Date().toISOString());
      }

      // 5. Sincronizar comprovantes de entrega (incremental)
      const ultimaSyncComprovantes = await obterUltimaSync('filaComprovantes');
      const comprovantes = await buscarFila('filaComprovantes');
      
      // Filtrar apenas comprovantes novos
      let comprovantesParaSincronizar = comprovantes;
      if (ultimaSyncComprovantes) {
        comprovantesParaSincronizar = comprovantes.filter(comp => {
          const compTimestamp = comp.timestamp || new Date().toISOString();
          return new Date(compTimestamp) > new Date(ultimaSyncComprovantes);
        });
        console.log(`📦 Comprovantes na fila: ${comprovantes.length} (${comprovantesParaSincronizar.length} novos desde última sync)`);
      } else {
        console.log(`📦 Comprovantes na fila: ${comprovantes.length} (primeira sincronização)`);
      }
      
      let comprovantesSincronizados = 0;
      for (const comprovante of comprovantesParaSincronizar) {
        try {
          console.log('📤 Enviando comprovante:', comprovante.idviagem);
          
          // Usar endpoint e method do comprovante (se tiver), senão padrão
          const endpoint = comprovante.endpoint || '/api/motorista/delivery-proof';
          const method = comprovante.method || 'POST';
          
          // Remover campos internos antes de enviar
          const dadosEnvio = { ...comprovante };
          delete dadosEnvio.id;
          delete dadosEnvio.endpoint;
          delete dadosEnvio.method;
          
          const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
          const { response, sucesso, tentativas } = await tentarEnviarComRetry(
            baseUrl + endpoint,
            {
              method: method,
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
              },
              body: JSON.stringify(dadosEnvio)
            }
          );

          console.log('📨 Resposta comprovante:', response.status, `(${tentativas} tentativas)`);

          if (sucesso) {
            await deletarDaFila('filaComprovantes', comprovante.id);
            comprovantesSincronizados++;
            console.log('✅ Comprovante sincronizado');
          } else {
            // Atualizar contador de tentativas
            comprovante.tentativas = (comprovante.tentativas || 0) + tentativas;
            await atualizarTentativasFila('filaComprovantes', comprovante.id, comprovante.tentativas);
            
            const erro = await response.text();
            console.error('❌ Erro comprovante:', response.status, erro);
          }
        } catch (err) {
          console.error('❌ Erro ao sincronizar comprovante:', err);
        }
      }
      
      // Salvar timestamp da sincronização se houve sucessos
      if (comprovantesSincronizados > 0) {
        await salvarUltimaSync('filaComprovantes', new Date().toISOString());
      }

      await atualizarIndicador();
      console.log('✅ Sincronização incremental completa!');
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
    
    const stores = ['filaGPS', 'filaEventos', 'filaAcoes', 'filaMensagens', 'filaComprovantes'];
    
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
    limparTodasFilas,
    limparDadosAntigos,
    verificarLimiteFila,
    validarDadosFila
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

