// backend/public/motorista/pages/js/chat.js
// Chat Motorista ↔ Operador com WebSocket
// Versão: 2.0
// Data: 2026-01-16

(function() {
  console.log('[CHAT] script chat.js carregado');
  try {
    var ok = document.getElementById('chat-html-ok');
    if (ok) ok.textContent = '✓ chat.js carregado. Iniciando...';
  } catch (e) {}

  function escapeHtml(text) {
    if (text == null || typeof text !== 'string') return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function logStep(step) {
    console.log('[CHAT]', step);
    var el = document.getElementById('chat-debug');
    if (el) el.textContent = step;
  }

  function getChatContainer() {
    return document.getElementById('chatContainer') || document.querySelector('.chat-container');
  }

  function showChatError(message, detail) {
    var container = getChatContainer();
    var html = '<div class="empty">' +
      '<div class="empty-icon">⚠️</div>' +
      '<strong>Erro ao carregar o chat</strong><br>' +
      (message || '') + (detail ? '<br><small>' + detail + '</small>' : '') + '<br><br>' +
      '<button onclick="location.reload()" style="padding:12px 24px;background:#0ea5e9;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Recarregar página</button>' +
      '</div>';
    if (container) {
      container.innerHTML = html;
    } else {
      var fallback = document.createElement('div');
      fallback.id = 'chatContainer';
      fallback.className = 'chat-container';
      fallback.style.cssText = 'padding:20px;max-width:600px;margin:0 auto;';
      fallback.innerHTML = html;
      document.body.insertBefore(fallback, document.body.firstChild);
    }
    var statusEl = document.getElementById('chatStatus');
    if (statusEl) {
      statusEl.textContent = 'Erro';
      statusEl.className = 'status-indicator status-offline';
    }
  }

  function boot() {
    logStep('boot() iniciado');
    try {
      if (typeof verificarAuth !== 'function') {
        logStep('ERRO: verificarAuth não existe');
        showChatError('Script de autenticação não carregou.', 'Recarregue a página (F5) ou faça login novamente.');
        return;
      }
      var authOk = verificarAuth();
      logStep('verificarAuth() = ' + authOk);
      if (!authOk) {
        logStep('sem auth - mostrando mensagem e redirecionando');
        var container = getChatContainer();
        if (container) {
          container.innerHTML = '<div class="empty"><div class="empty-icon">🔐</div><strong>Você precisa fazer login</strong><br>Redirecionando para a tela de login em 2 segundos...</div>';
        }
        setTimeout(function() { window.location.href = '../index.html'; }, 2000);
        return;
      }
      if (typeof getMotorista !== 'function') {
        logStep('ERRO: getMotorista não existe');
        showChatError('Dados do motorista não disponíveis.', 'Faça login novamente.');
        return;
      }
      var motorista = getMotorista();
      if (!motorista) {
        logStep('ERRO: motorista null (localStorage)');
        showChatError('Sessão incompleta.', 'Faça login novamente.');
        return;
      }
      logStep('auth ok');
    } catch (e) {
      console.error('[CHAT] boot erro:', e);
      showChatError(e.message || 'Erro ao iniciar o chat.', 'Recarregue a página.');
      return;
    }

    try {
  const motorista = getMotorista();
  const token = localStorage.getItem('token');
  let idViagem = null;
  let mensagens = [];
  let socket = null;
  const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
  
  // Obter ID do motorista corretamente
  const idMotorista = motorista?.CDCADASTRO || motorista?.id || motorista?.cdcadastro || null;

  // ==========================================
  // INICIALIZAÇÃO
  // ==========================================
  async function init() {
    const params = new URLSearchParams(window.location.search);
    idViagem = params.get('viagem') || localStorage.getItem('viagemAtual');
    logStep('init() viagem=' + idViagem + ' baseUrl=' + baseUrl);

    if (!idViagem) {
      var container = getChatContainer();
      if (container) {
        container.innerHTML = `
        <div class="empty">
          <div class="empty-icon">⚠️</div>
          <strong>Nenhuma viagem selecionada</strong><br>
          Você precisa selecionar uma viagem para usar o chat.<br><br>
          <p style="font-size: 13px; color: #666; margin-top: 10px;">
            Redirecionando para a tela de viagens em <span id="countdown">3</span> segundos...
          </p>
          <button onclick="window.location.href='viagens.html'" style="
            padding: 12px 24px;
            background: #0ea5e9;
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
      } else {
        showChatError('Nenhuma viagem selecionada.', 'Abra o chat a partir de uma viagem.');
      }
      
      // Desabilitar input quando não há viagem
      var input = document.getElementById('inputMensagem');
      var btn = document.querySelector('.btn-enviar');
      if (input) {
        input.disabled = true;
        input.placeholder = 'Selecione uma viagem primeiro';
      }
      if (btn) btn.disabled = true;
      
      // Countdown e redirecionamento automático
      var countdown = 3;
      var countdownEl = document.getElementById('countdown');
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

    logStep('conectando WebSocket');
    conectarWebSocket();

    logStep('carregando mensagens...');
    await carregarMensagens();

    logStep('atualizando status');
    await atualizarStatusBar();
    logStep('init ok');
  }

  // ==========================================
  // WEBSOCKET
  // ==========================================
  function conectarWebSocket() {
    if (typeof io === 'undefined') {
      console.warn('Socket.io não carregou; chat em modo apenas HTTP.');
      atualizarStatusConexao(false);
      return;
    }
    try {
      atualizarStatusConexao('conectando');
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

  function atualizarStatusConexao(estado) {
    const statusEl = document.getElementById('chatStatus');
    if (!statusEl) return;
    // estado: true = Online, false = Offline, 'conectando' = Conectando...
    if (estado === true) {
      statusEl.textContent = 'Online';
      statusEl.className = 'status-indicator status-online';
    } else if (estado === false) {
      statusEl.textContent = 'Offline';
      statusEl.className = 'status-indicator status-offline';
    } else {
      statusEl.textContent = 'Conectando...';
      statusEl.className = 'status-indicator status-connecting';
    }
  }

  // ==========================================
  // CARREGAR MENSAGENS
  // ==========================================
  async function carregarMensagens() {
    var url = baseUrl + '/api/messages/viagem/' + idViagem;
    logStep('fetch ' + url);
    try {
      const response = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json().catch(function(e) {
        console.warn('[CHAT] response.json falhou', e);
        return {};
      });
      logStep('API status=' + response.status + ' msgs=' + ((data && (data.messages || data.data && data.data.messages)) ? (data.messages || data.data.messages).length : 0));
      if (response.ok && data) {
        mensagens = data.messages || (data.data && data.data.messages) || [];
        // Converter para formato compatível
        mensagens = mensagens.map(m => ({
          ...m,
          remetente: (m.SENDER_TYPE === 'driver' || m.SENDER_TYPE === 'MOTORISTA') ? 'motorista' : 'operador',
          enviado: true,
          timestamp: m.CREATED_AT
        }));
        renderizar();
        scrollBottom();
        marcarComoLidas();
        logStep('Chat pronto. ' + mensagens.length + ' mensagem(ns)');
      } else {
        mensagens = [];
        renderizar();
        logStep('API status ' + response.status);
        if (response.status === 401) {
          mostrarEstadoErroOuVazio('Sessão expirada. Faça login novamente.');
          setTimeout(function() { window.location.href = '../index.html'; }, 2500);
        } else if (!response.ok) {
          console.warn('Chat: API retornou erro', response.status, data);
          mostrarEstadoErroOuVazio('Não foi possível carregar as mensagens (status ' + response.status + '). Você já pode enviar uma mensagem.');
        } else {
          logStep('Chat pronto. 0 mensagens');
        }
      }
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
      logStep('ERRO fetch: ' + (err.message || err));
      mensagens = [];
      renderizar();
      mostrarEstadoErroOuVazio('Erro de conexão. Verifique sua internet e tente novamente.');
    }
  }

  function mostrarEstadoErroOuVazio(mensagem) {
    var container = getChatContainer();
    if (!container || mensagens.length > 0) return;
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">💬</div>
        <strong>${mensagem}</strong><br>
        Envie uma mensagem para começar a conversa.
      </div>
    `;
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
    var container = getChatContainer();
    if (!container) {
      console.warn('[CHAT] renderizar: container não encontrado');
      return;
    }
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
      conteudo = escapeHtml(conteudo);
      // Converter quebras de linha em <br>
      conteudo = conteudo.replace(/\n/g, '<br>');
      // Converter apenas http(s) URLs em links (URL já escapada)
      const conteudoFormatado = conteudo.replace(
        /(https?:\/\/[^\s<]+)/g,
        function(url) { return '<a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="color: #0ea5e9; text-decoration: underline;">' + escapeHtml(url) + '</a>'; }
      );

      return `
        <div class="mensagem ${classe}">
          <div class="mensagem-bubble">
            <div style="font-size: 11px; font-weight: 600; color: #666; margin-bottom: 4px;">
              ${escapeHtml(remetente)}
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
          icon: '/img/logoAtlasTransparente.png',
          tag: 'chat-mensagem',
          requireInteraction: false,
          badge: '/img/logoAtlasTransparente.png'
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

  // Inicializar quando DOM estiver pronto (garantir que #chatContainer exista)
  function runInit() {
    function doInit() {
      logStep('doInit()');
      init().catch(function (err) {
        console.error('Erro ao inicializar chat:', err);
        var container = getChatContainer();
        var msg = (err && err.message) ? err.message : 'Tente recarregar a página.';
        if (container) {
          container.innerHTML = '<div class="empty"><div class="empty-icon">⚠️</div><strong>Erro ao carregar o chat</strong><br>' +
            msg + '<br><br>' +
            '<button onclick="location.reload()" style="padding:10px 20px;background:#0ea5e9;color:white;border:none;border-radius:8px;cursor:pointer;">Recarregar</button></div>';
        } else {
          showChatError(msg, '');
        }
        var statusEl = document.getElementById('chatStatus');
        if (statusEl) {
          statusEl.textContent = 'Erro';
          statusEl.className = 'status-indicator status-offline';
        }
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', doInit);
    } else {
      setTimeout(doInit, 0);
    }
  }
  runInit();

    } catch (err) {
      console.error('Chat init error:', err);
      showChatError(err.message || 'Erro ao carregar o chat.', 'Recarregue a página (F5).');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
