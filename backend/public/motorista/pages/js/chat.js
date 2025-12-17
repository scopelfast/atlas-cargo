// backend/public/motorista/pages/js/chat.js
// Chat Motorista ↔ Operador com WebSocket
// Versão: 2.0
// Data: 2025-01-16

(function() {
  if (!verificarAuth()) {
    window.location.href = '../index.html';
    return;
  }

  const motorista = getMotorista();
  const token = localStorage.getItem('token');
  let idViagem = null;
  let mensagens = [];
  let socket = null;
  const baseUrl = window.__BASE_URL__ || ('http://' + window.location.host);

  // ==========================================
  // INICIALIZAÇÃO
  // ==========================================
  async function init() {
    // Buscar ID da viagem da URL ou localStorage
    const params = new URLSearchParams(window.location.search);
    idViagem = params.get('viagem') || localStorage.getItem('viagemAtual');

    if (!idViagem) {
      document.getElementById('chatContainer').innerHTML = `
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <strong>Nenhuma viagem selecionada</strong><br>
          Selecione uma viagem para abrir o chat.
        </div>
      `;
      return;
    }

    // Conectar Socket.io
    conectarWebSocket();

    // Carregar mensagens
    await carregarMensagens();

    // Atualizar status bar
    await atualizarStatusBar();
  }

  // ==========================================
  // WEBSOCKET
  // ==========================================
  function conectarWebSocket() {
    try {
      socket = io(baseUrl, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      socket.on('connect', () => {
        console.log('✅ WebSocket conectado');
        atualizarStatusConexao(true);
        
        // Entrar na sala da viagem
        socket.emit('join-viagem', idViagem);
      });

      socket.on('disconnect', () => {
        console.log('❌ WebSocket desconectado');
        atualizarStatusConexao(false);
      });

      socket.on('nova-mensagem', (mensagem) => {
        console.log('📨 Nova mensagem recebida:', mensagem);
        
        // Verificar se não é mensagem própria
        if (mensagem.SENDER_ID != motorista.id || mensagem.SENDER_TYPE !== 'driver') {
          mensagens.push(mensagem);
          renderizar();
          scrollBottom();
          
          // Marcar como lida
          marcarComoLidas();
        }
      });

      socket.on('connect_error', (err) => {
        console.warn('⚠️ Erro de conexão WebSocket:', err);
        atualizarStatusConexao(false);
      });
    } catch (err) {
      console.error('Erro ao conectar WebSocket:', err);
      atualizarStatusConexao(false);
    }
  }

  function atualizarStatusConexao(online) {
    const statusEl = document.getElementById('chatStatus');
    if (statusEl) {
      statusEl.textContent = online ? 'Online' : 'Offline';
      statusEl.className = `status-indicator ${online ? 'status-online' : 'status-offline'}`;
    }
  }

  // ==========================================
  // CARREGAR MENSAGENS
  // ==========================================
  async function carregarMensagens() {
    try {
      const response = await fetch(`${baseUrl}/api/messages/viagem/${idViagem}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        mensagens = data.messages || [];
        
        // Converter para formato compatível
        mensagens = mensagens.map(m => ({
          ...m,
          remetente: m.SENDER_TYPE === 'driver' ? 'motorista' : 'operador',
          enviado: true,
          timestamp: m.CREATED_AT
        }));

        renderizar();
        scrollBottom();
        
        // Marcar como lidas
        marcarComoLidas();
      }
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
    }
  }

  // ==========================================
  // ENVIAR MENSAGEM
  // ==========================================
  window.enviarMensagem = async function() {
    const input = document.getElementById('inputMensagem');
    const texto = input.value.trim();
    
    if (!texto || !idViagem) return;

    // Criar mensagem local
    const mensagemLocal = {
      ID: Date.now(),
      IDVIAGEM: idViagem,
      SENDER_TYPE: 'driver',
      SENDER_ID: motorista.id,
      SENDER_NAME: motorista.nome || 'Motorista',
      CONTENT: texto,
      CREATED_AT: new Date().toISOString(),
      remetente: 'motorista',
      enviado: false
    };

    // Adicionar à lista
    mensagens.push(mensagemLocal);
    renderizar();
    input.value = '';
    scrollBottom();

    try {
      // Tentar enviar online
      if (window.OfflineDB && window.OfflineDB.isOnline()) {
        const response = await fetch(`${baseUrl}/api/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            idviagem: idViagem,
            content: texto,
            senderType: 'driver',
            senderId: motorista.id,
            senderName: motorista.nome || 'Motorista'
          })
        });

        if (response.ok) {
          const data = await response.json();
          // Atualizar mensagem local com dados do servidor
          const index = mensagens.findIndex(m => m.ID === mensagemLocal.ID);
          if (index !== -1) {
            mensagens[index] = {
              ...data.message,
              remetente: 'motorista',
              enviado: true,
              timestamp: data.message.CREATED_AT
            };
          }
          renderizar();
        } else {
          // Salvar na fila offline
          await window.OfflineDB.adicionarFila('filaMensagens', {
            endpoint: '/api/messages',
            method: 'POST',
            data: {
              idviagem: idViagem,
              content: texto,
              senderType: 'driver',
              senderId: motorista.id,
              senderName: motorista.nome || 'Motorista'
            }
          });
        }
      } else {
        // Offline - salvar na fila
        await window.OfflineDB.adicionarFila('filaMensagens', {
          endpoint: '/api/messages',
          method: 'POST',
          data: {
            idviagem: idViagem,
            content: texto,
            senderType: 'driver',
            senderId: motorista.id,
            senderName: motorista.nome || 'Motorista'
          }
        });
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
    }
  };

  // ==========================================
  // MARCAR COMO LIDAS
  // ==========================================
  async function marcarComoLidas() {
    try {
      if (!window.OfflineDB || !window.OfflineDB.isOnline()) return;

      await fetch(`${baseUrl}/api/messages/marcar-lidas`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          idviagem: idViagem,
          userId: motorista.id,
          userType: 'driver'
        })
      });
    } catch (err) {
      console.warn('Erro ao marcar como lidas:', err);
    }
  }

  // ==========================================
  // RENDERIZAR
  // ==========================================
  function renderizar() {
    const container = document.getElementById('chatContainer');
    
    if (mensagens.length === 0) {
      container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">💬</div>
          <strong>Nenhuma mensagem ainda</strong><br>
          Envie uma mensagem para começar a conversa!
        </div>
      `;
      return;
    }

    container.innerHTML = mensagens.map(m => {
      const hora = new Date(m.CREATED_AT || m.timestamp).toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      });
      const classe = m.remetente === 'motorista' || m.SENDER_TYPE === 'driver' ? 'motorista' : 'operador';
      const remetente = (m.remetente === 'motorista' || m.SENDER_TYPE === 'driver') ? '👤 Você' : '👨‍💼 Operador';
      const status = m.enviado !== false ? '✓✓' : '⏳';
      const conteudo = m.CONTENT || m.content || m.mensagem || '';

      return `
        <div class="mensagem ${classe}">
          <div class="mensagem-bubble">
            <div style="font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px;">
              ${remetente}
            </div>
            <div class="mensagem-texto">${conteudo}</div>
            <div class="mensagem-hora">${hora} ${status}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ==========================================
  // SCROLL
  // ==========================================
  function scrollBottom() {
    const container = document.getElementById('chatContainer');
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
  }

  // ==========================================
  // NAVEGAÇÃO
  // ==========================================
  window.voltar = function() {
    if (socket) {
      socket.emit('leave-viagem', idViagem);
      socket.disconnect();
    }
    window.location.href = 'dashboard.html';
  };

  // ==========================================
  // STATUS BAR
  // ==========================================
  async function atualizarStatusBar() {
    if (window.OfflineDB && window.OfflineDB.atualizarIndicador) {
      await window.OfflineDB.atualizarIndicador();
    }
  }

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
