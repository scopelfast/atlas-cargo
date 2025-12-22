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
  
  // Obter ID do motorista corretamente
  const idMotorista = motorista?.CDCADASTRO || motorista?.id || motorista?.cdcadastro || null;

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
          Você precisa selecionar uma viagem para usar o chat.<br><br>
          <p style="font-size: 13px; color: #666; margin-top: 10px;">
            Redirecionando para a tela de viagens em <span id="countdown">3</span> segundos...
          </p>
          <button onclick="window.location.href='viagens.html'" style="
            padding: 12px 24px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            font-weight: 600;
            margin-top: 15px;
          ">
            📋 Ir para Viagens Agora
          </button>
        </div>
      `;
      
      // Desabilitar input quando não há viagem
      const input = document.getElementById('inputMensagem');
      const btn = document.querySelector('.btn-enviar');
      if (input) {
        input.disabled = true;
        input.placeholder = 'Selecione uma viagem primeiro';
      }
      if (btn) btn.disabled = true;
      
      // Countdown e redirecionamento automático
      let countdown = 3;
      const countdownEl = document.getElementById('countdown');
      const interval = setInterval(() => {
        countdown--;
        if (countdownEl) {
          countdownEl.textContent = countdown;
        }
        if (countdown <= 0) {
          clearInterval(interval);
          window.location.href = 'viagens.html';
        }
      }, 1000);
      
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
        const senderId = mensagem.SENDER_ID || mensagem.senderId;
        const senderType = mensagem.SENDER_TYPE || mensagem.senderType;
        
        if (senderId != idMotorista || senderType !== 'driver') {
          mensagens.push(mensagem);
          renderizar();
          scrollBottom();
          
          // Notificação visual e sonora
          notificarNovaMensagem(mensagem);
          
          // Marcar como lida
          marcarComoLidas();
          
          // Atualizar contador no dashboard (se estiver em outra aba)
          atualizarContadorNaoLidas();
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
    
    if (!texto) {
      console.warn('⚠️ Mensagem vazia');
      return;
    }
    
    if (!idViagem) {
      mostrarToast('Nenhuma viagem selecionada. Por favor, selecione uma viagem primeiro.', 'warning');
      setTimeout(() => {
        window.location.href = 'viagens.html';
      }, 2000);
      return;
    }
    
    if (!idMotorista) {
      mostrarToast('Erro: ID do motorista não encontrado. Faça login novamente.', 'error');
      setTimeout(() => {
        window.location.href = '../index.html';
      }, 2000);
      return;
    }

    // Criar mensagem local
    const mensagemLocal = {
      ID: Date.now(),
      IDVIAGEM: idViagem,
      SENDER_TYPE: 'driver',
      SENDER_ID: idMotorista,
      SENDER_NAME: motorista?.nome || motorista?.NOME || 'Motorista',
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
            senderId: idMotorista,
            senderName: motorista?.nome || motorista?.NOME || 'Motorista'
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
  // ENVIAR LOCALIZAÇÃO
  // ==========================================
  window.enviarLocalizacao = async function() {
    const btnLocalizacao = document.querySelector('.btn-localizacao');
    
    if (!idViagem) {
      mostrarToast('Nenhuma viagem selecionada. Por favor, selecione uma viagem primeiro.', 'warning');
      return;
    }
    
    if (!idMotorista) {
      mostrarToast('Erro: ID do motorista não encontrado. Faça login novamente.', 'error');
      return;
    }

    // Desabilitar botão enquanto busca localização
    if (btnLocalizacao) {
      btnLocalizacao.disabled = true;
      btnLocalizacao.textContent = '⏳';
    }

    try {
      // Verificar se Geolocation API está disponível
      if (!navigator.geolocation) {
        throw new Error('Geolocalização não suportada pelo navegador');
      }

      // Buscar localização atual
      const posicao = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: false, // Usar menos precisão para ser mais rápido
            timeout: 30000, // Aumentar timeout para 30 segundos
            maximumAge: 60000 // Aceitar posição com até 1 minuto de idade
          }
        );
      });

      const latitude = posicao.coords.latitude;
      const longitude = posicao.coords.longitude;
      const precisao = posicao.coords.accuracy ? Math.round(posicao.coords.accuracy) : null;
      
      // Criar mensagem com localização
      const mensagemLocalizacao = `📍 Minha localização:\n` +
        `Latitude: ${latitude.toFixed(8)}\n` +
        `Longitude: ${longitude.toFixed(8)}\n` +
        (precisao ? `Precisão: ${precisao}m\n` : '') +
        `🗺️ Ver no mapa: https://www.google.com/maps?q=${latitude},${longitude}`;

      // Criar mensagem local
      const mensagemLocal = {
        ID: Date.now(),
        IDVIAGEM: idViagem,
        SENDER_TYPE: 'driver',
        SENDER_ID: idMotorista,
        SENDER_NAME: motorista?.nome || motorista?.NOME || 'Motorista',
        CONTENT: mensagemLocalizacao,
        CREATED_AT: new Date().toISOString(),
        remetente: 'motorista',
        enviado: false
      };

      // Adicionar à lista
      mensagens.push(mensagemLocal);
      renderizar();
      scrollBottom();

      // Enviar para o servidor
      try {
        if (window.OfflineDB && window.OfflineDB.isOnline()) {
          const response = await fetch(`${baseUrl}/api/messages`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              idviagem: idViagem,
              content: mensagemLocalizacao,
              senderType: 'driver',
              senderId: idMotorista,
              senderName: motorista?.nome || motorista?.NOME || 'Motorista',
              latitude: latitude,
              longitude: longitude,
              precisao: precisao
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
            mostrarToast('Localização enviada com sucesso!', 'success');
          } else {
            // Salvar na fila offline
            await window.OfflineDB.adicionarFila('filaMensagens', {
              endpoint: '/api/messages',
              method: 'POST',
              data: {
                idviagem: idViagem,
                content: mensagemLocalizacao,
                senderType: 'driver',
                senderId: idMotorista,
                senderName: motorista?.nome || motorista?.NOME || 'Motorista',
                latitude: latitude,
                longitude: longitude,
                precisao: precisao
              }
            });
            mostrarToast('Localização salva (será enviada quando online)', 'info');
          }
        } else {
          // Offline - salvar na fila
          await window.OfflineDB.adicionarFila('filaMensagens', {
            endpoint: '/api/messages',
            method: 'POST',
            data: {
              idviagem: idViagem,
              content: mensagemLocalizacao,
              senderType: 'driver',
              senderId: idMotorista,
              senderName: motorista?.nome || motorista?.NOME || 'Motorista',
              latitude: latitude,
              longitude: longitude,
              precisao: precisao
            }
          });
          mostrarToast('Localização salva (será enviada quando online)', 'info');
        }
      } catch (err) {
        console.error('Erro ao enviar localização:', err);
        mostrarToast('Erro ao enviar localização. Tente novamente.', 'error');
      }

    } catch (err) {
      console.error('Erro ao obter localização:', err);
      
      let mensagemErro = 'Erro ao obter localização.';
      if (err.code === 1) {
        mensagemErro = 'Permissão de localização negada. Por favor, permita o acesso à localização nas configurações do navegador.';
      } else if (err.code === 2) {
        mensagemErro = 'Não foi possível determinar sua localização. Verifique se o GPS está ativo.';
      } else if (err.code === 3) {
        mensagemErro = 'Tempo esgotado ao buscar localização. Tente novamente.';
      }
      
      mostrarToast(mensagemErro, 'error');
    } finally {
      // Reabilitar botão
      if (btnLocalizacao) {
        btnLocalizacao.disabled = false;
        btnLocalizacao.textContent = '📍';
      }
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
          userId: idMotorista,
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
      
      // Usar SENDER_NAME se disponível, senão usar padrão
      let remetente;
      if (m.remetente === 'motorista' || m.SENDER_TYPE === 'driver') {
        remetente = '👤 Você';
      } else {
        // Usar nome do operador se disponível
        const nomeOperador = m.SENDER_NAME || m.senderName;
        if (nomeOperador && nomeOperador.trim() !== '' && nomeOperador.trim() !== 'Operador' && nomeOperador.trim() !== 'null') {
          remetente = `👨‍💼 ${nomeOperador.trim()}`;
        } else {
          // Se não tiver nome, tentar buscar do backend
          if (m.SENDER_ID) {
            buscarNomeOperador(m.SENDER_ID).then(nome => {
              if (nome && nome.trim() !== '' && nome.trim() !== 'Operador') {
                // Atualizar a mensagem e re-renderizar
                m.SENDER_NAME = nome.trim();
                renderizar();
              }
            });
          }
          remetente = '👨‍💼 Operador';
        }
      }
      
      const status = m.enviado !== false ? '✓✓' : '⏳';
      let conteudo = m.CONTENT || m.content || m.mensagem || '';
      
      // Converter quebras de linha em <br>
      conteudo = conteudo.replace(/\n/g, '<br>');
      
      // Converter URLs em links clicáveis
      const conteudoFormatado = conteudo.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: underline;">$1</a>'
      );

      return `
        <div class="mensagem ${classe}">
          <div class="mensagem-bubble">
            <div style="font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px;">
              ${remetente}
            </div>
            <div class="mensagem-texto">${conteudoFormatado}</div>
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
  // BUSCAR NOME DO OPERADOR
  // ==========================================
  async function buscarNomeOperador(senderId) {
    if (!senderId) return null;
    
    try {
      const response = await fetch(`${baseUrl}/api/messages/operador/${senderId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        return (data.success && data.nome) ? data.nome : null;
      }
    } catch (err) {
      console.warn('Erro ao buscar nome do operador:', err);
    }
    return null;
  }

  // ==========================================
  // NOTIFICAÇÕES
  // ==========================================
  function notificarNovaMensagem(mensagem) {
    const conteudo = mensagem.CONTENT || mensagem.content || '';
    const preview = conteudo.length > 80 ? conteudo.substring(0, 80) + '...' : conteudo;
    
    // Usar serviço unificado de notificações
    if (window.NotificacoesService) {
      window.NotificacoesService.mostrar(
        'Nova Mensagem',
        preview,
        window.NotificacoesService.TIPOS.CHAT,
        {
          acao: 'chat',
          idViagem: idViagem
        }
      );
    } else {
      // Fallback para notificação básica
      if (!document.hasFocus() && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Nova Mensagem - Chat', {
          body: preview,
          icon: '/img/logo7.png',
          tag: 'chat-mensagem',
          requireInteraction: false,
          badge: '/img/logo7.png'
        });
      }
    }
  }
  
  // Função removida - agora usa NotificacoesService
  
  // Permissões de notificação agora gerenciadas pelo NotificacoesService

  // ==========================================
  // CONTADOR DE NÃO LIDAS
  // ==========================================
  async function atualizarContadorNaoLidas() {
    try {
      // Tentar endpoint do módulo primeiro
      let response = await fetch(`${baseUrl}/api/chat/nao-lidas?idUsuario=${idMotorista}&userType=MOTORISTA`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      // Se não funcionar, tentar endpoint alternativo
      if (!response.ok) {
        response = await fetch(`${baseUrl}/api/messages/nao-lidas?idUsuario=${idMotorista}&userType=MOTORISTA`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
      
      if (response.ok) {
        const data = await response.json();
        // Estrutura: { success: true, data: { total: X, porConversa: [...] } }
        const total = (data.data && data.data.total) || data.total || 0;
        
        // Salvar no localStorage para o dashboard
        localStorage.setItem('chat_nao_lidas', total.toString());
        
        // Disparar evento para atualizar dashboard
        window.dispatchEvent(new CustomEvent('chatNaoLidasAtualizado', { detail: { total } }));
        
        return total;
      }
    } catch (err) {
      console.warn('Erro ao buscar contador de não lidas:', err);
    }
    return 0;
  }

  // ==========================================
  // STATUS BAR
  // ==========================================
  async function atualizarStatusBar() {
    if (window.OfflineDB && window.OfflineDB.atualizarIndicador) {
      await window.OfflineDB.atualizarIndicador();
    }
    
    // Atualizar contador ao carregar
    await atualizarContadorNaoLidas();
  }

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
