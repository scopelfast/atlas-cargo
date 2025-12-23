// backend/public/modulos/chat/js/script.js
// Módulo de Chat - Frontend Completo
// Versão: 2.0
// Data: 2025-01-18
//
// Este módulo gerencia comunicação em tempo real entre operadores e motoristas.
// Inclui integração com WebSocket para atualizações em tempo real.
// Segue o mesmo padrão visual e funcional dos módulos Alertas e SOS.

(function() {
  'use strict';

  // Estado do módulo
  let conversas = [];
  let conversaAtual = null;
  let mensagens = [];
  let socket = null;
  let estaConectado = false;
  let idUsuario = null;

  // Elementos DOM
  const conversasListEl = document.getElementById('conversasList');
  const chatPanelEl = document.getElementById('chatPanel');
  const chatEmptyEl = document.getElementById('chatEmpty');
  const chatActiveEl = document.getElementById('chatActive');
  const chatMessagesEl = document.getElementById('chatMessages');
  const chatInputEl = document.getElementById('chatInput');
  const loadingOverlay = document.getElementById('loadingOverlay');

  /**
   * Inicializar módulo
   */
  function inicializar() {
    console.log('💬 Módulo Chat inicializando...');
    
    // Obter ID do usuário
    idUsuario = getUserId();
    
    if (!idUsuario) {
      mostrarMensagem('Erro: Usuário não autenticado. Faça login novamente.', 'error');
      return;
    }
    
    // Carregar conversas
    carregarConversas();
    
    // Inicializar WebSocket
    inicializarWebSocket();
    
    // Atualizar estatísticas
    atualizarEstatisticas();
    
    // Atualizar contador no menu
    atualizarContadorMenu();
    
    // Atualizar contador a cada 30 segundos
    setInterval(() => {
      atualizarContadorMenu();
      atualizarEstatisticas();
    }, 30000);
  }

  /**
   * Obter headers de autenticação
   */
  function getAuthHeaders() {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  }

  /**
   * Obter ID do usuário logado
   */
  function getUserId() {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.cdcadastro || user.id || null;
      }
    } catch (err) {
      console.warn('Erro ao obter ID do usuário:', err);
    }
    return null;
  }

  /**
   * Carregar conversas
   */
  async function carregarConversas() {
    try {
      mostrarLoading(true);
      
      const response = await fetch('/api/chat/conversas?limit=100', {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.data) {
        conversas = data.data;
        renderizarConversas();
        atualizarEstatisticas();
      } else {
        throw new Error(data.error || 'Erro ao carregar conversas');
      }
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
      mostrarMensagem('Erro ao carregar conversas: ' + err.message, 'error');
      conversasListEl.innerHTML = '<div style="padding: 20px; text-align: center; color: #6c757d;">Erro ao carregar conversas</div>';
    } finally {
      mostrarLoading(false);
    }
  }

  /**
   * Renderizar lista de conversas
   */
  function renderizarConversas() {
    if (!conversasListEl) return;
    
    if (conversas.length === 0) {
      conversasListEl.innerHTML = `
        <div style="padding: 40px; text-align: center; color: #6c757d;">
          <i class='bx bx-message' style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
          <p>Nenhuma conversa encontrada</p>
        </div>
      `;
      return;
    }
    
    conversasListEl.innerHTML = conversas.map(conversa => {
      const isActive = conversaAtual && conversaAtual.ID === conversa.ID;
      const hasUnread = conversa.MENSAGENS_NAO_LIDAS > 0;
      const ultimaMensagem = conversa.ULTIMA_MENSAGEM || 'Sem mensagens';
      const hora = formatarHora(conversa.DH_ULTIMA_MENSAGEM || conversa.DH_CRIACAO);
      const nome = conversa.motorista_nome || `Viagem ${conversa.viagem_codigo || conversa.ID_VIAGEM || 'N/A'}`;
      
      return `
        <div 
          class="conversa-item ${isActive ? 'active' : ''} ${hasUnread ? 'nao-lida' : ''}" 
          onclick="selecionarConversa(${conversa.ID})"
        >
          <div class="conversa-header-item">
            <div class="conversa-nome">${escapeHtml(nome)}</div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${hasUnread ? `<span class="conversa-badge">${conversa.MENSAGENS_NAO_LIDAS}</span>` : ''}
              <span class="conversa-hora">${hora}</span>
            </div>
          </div>
          <div class="conversa-preview">${escapeHtml(ultimaMensagem)}</div>
          ${conversa.viagem_codigo ? `<div style="font-size: 12px; color: #6c757d; margin-top: 5px;"><i class='bx bx-map'></i> Viagem: ${conversa.viagem_codigo}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  /**
   * Selecionar conversa
   */
  window.selecionarConversa = async function(idConversa) {
    try {
      // Buscar conversa
      const conversa = conversas.find(c => c.ID === idConversa);
      if (!conversa) {
        throw new Error('Conversa não encontrada');
      }
      
      conversaAtual = conversa;
      
      // Atualizar UI
      renderizarConversas();
      mostrarChatAtivo();
      
      // Atualizar informações
      document.getElementById('chatInfoNome').textContent = conversa.motorista_nome || `Viagem ${conversa.viagem_codigo || 'N/A'}`;
      
      // Atualizar informações da viagem
      const viagemInfo = [];
      if (conversa.viagem_codigo || conversa.ID_VIAGEM) {
        viagemInfo.push(`Viagem: ${conversa.viagem_codigo || conversa.ID_VIAGEM}`);
      }
      
      // Formatar rota: "Rota: (número) - Cidade/UF → Cidade/UF"
      if (conversa.viagem_origem && conversa.viagem_destino) {
        let rotaTexto = '';
        if (conversa.viagem_rota_id || conversa.viagem_rota_descricao) {
          const rotaNumero = conversa.viagem_rota_id || conversa.viagem_rota_descricao;
          rotaTexto = `Rota: ${rotaNumero} - `;
        }
        rotaTexto += `${conversa.viagem_origem} → ${conversa.viagem_destino}`;
        viagemInfo.push(rotaTexto);
      } else if (conversa.viagem_origem) {
        viagemInfo.push(`Origem: ${conversa.viagem_origem}`);
      } else if (conversa.viagem_destino) {
        viagemInfo.push(`Destino: ${conversa.viagem_destino}`);
      }
      
      if (conversa.viagem_situacao && conversa.viagem_situacao.trim() !== '') {
        const situacaoTexto = conversa.viagem_situacao_codigo 
          ? `${conversa.viagem_situacao_codigo} - ${conversa.viagem_situacao}`
          : conversa.viagem_situacao;
        viagemInfo.push(`Situação: ${situacaoTexto}`);
      }
      
      document.getElementById('chatInfoViagem').innerHTML = viagemInfo.length > 0 
        ? viagemInfo.join(' | ') 
        : (conversa.viagem_codigo || conversa.ID_VIAGEM || 'N/A');
      
      // Formatar informações do motorista
      let motoristaInfo = conversa.motorista_nome || 'N/A';
      if (conversa.motorista_id) {
        motoristaInfo += ` (Código: ${conversa.motorista_id})`;
      }
      if (conversa.motorista_cpf) {
        // Formatar CPF: 000.000.000-00
        const cpf = conversa.motorista_cpf.toString().replace(/\D/g, '');
        const cpfFormatado = cpf.length === 11 
          ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
          : conversa.motorista_cpf;
        motoristaInfo += ` | CPF: ${cpfFormatado}`;
      }
      document.getElementById('chatInfoMotorista').textContent = motoristaInfo;
      
      // Entrar na sala WebSocket
      if (socket && socket.connected) {
        if (conversa.ID_VIAGEM) {
          socket.emit('join-viagem', conversa.ID_VIAGEM);
        }
        socket.emit('join-conversa', idConversa);
      }
      
      // Carregar mensagens
      await carregarMensagens(idConversa);
      
      // Marcar como lidas
      await marcarComoLidas(idConversa);
      
    } catch (err) {
      console.error('Erro ao selecionar conversa:', err);
      mostrarMensagem('Erro ao abrir conversa: ' + err.message, 'error');
    }
  };

  /**
   * Carregar mensagens de uma conversa
   */
  async function carregarMensagens(idConversa) {
    try {
      const response = await fetch(`/api/chat/conversas/${idConversa}?limit=100`, {
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`Erro ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.messages) {
        mensagens = data.messages;
        renderizarMensagens();
        scrollChatBottom();
      } else {
        throw new Error(data.error || 'Erro ao carregar mensagens');
      }
    } catch (err) {
      console.error('Erro ao carregar mensagens:', err);
      mostrarMensagem('Erro ao carregar mensagens: ' + err.message, 'error');
    }
  }

  /**
   * Obter nome do operador logado
   */
  function getOperadorNome() {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        return user.nome || user.NOME || user.RZSOCIAL || user.rzsocial || 'Operador';
      }
    } catch (err) {
      console.warn('Erro ao obter nome do operador:', err);
    }
    return 'Operador';
  }

  /**
   * Renderizar mensagens
   */
  function renderizarMensagens() {
    if (!chatMessagesEl) return;
    
    if (mensagens.length === 0) {
      chatMessagesEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #6c757d;">
          <i class='bx bx-message' style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
          <p>Nenhuma mensagem ainda</p>
          <p style="font-size: 14px; margin-top: 10px;">Seja o primeiro a enviar uma mensagem!</p>
        </div>
      `;
      return;
    }
    
    chatMessagesEl.innerHTML = mensagens.map(msg => {
      const isOperador = msg.SENDER_TYPE === 'OPERADOR';
      // Usar SENDER_NAME se disponível, senão usar padrão
      let nome;
      if (isOperador) {
        const nomeOperador = msg.SENDER_NAME || msg.senderName;
        if (nomeOperador && nomeOperador.trim() !== '' && nomeOperador.trim() !== 'Operador' && nomeOperador.trim() !== 'null') {
          nome = nomeOperador.trim();
        } else {
          nome = getOperadorNome();
        }
      } else {
        nome = (msg.SENDER_NAME && msg.SENDER_NAME.trim() !== '' && msg.SENDER_NAME.trim() !== 'null') 
          ? msg.SENDER_NAME.trim() 
          : 'Motorista';
      }
      const hora = formatarHora(msg.CREATED_AT);
      
      // Processar conteúdo: converter quebras de linha e URLs em links
      let conteudo = msg.CONTENT || '';
      
      // Converter quebras de linha em <br> primeiro
      conteudo = conteudo.replace(/\n/g, '<br>');
      
      // Dividir o conteúdo em partes (texto e URLs)
      const partes = [];
      let ultimoIndice = 0;
      const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
      let match;
      
      while ((match = urlRegex.exec(conteudo)) !== null) {
        // Adicionar texto antes da URL
        if (match.index > ultimoIndice) {
          const textoAntes = conteudo.substring(ultimoIndice, match.index);
          if (textoAntes) {
            partes.push({ tipo: 'texto', conteudo: escapeHtml(textoAntes) });
          }
        }
        
        // Adicionar URL como link
        const url = match[0];
        const urlEscaped = escapeHtml(url);
        partes.push({
          tipo: 'link',
          conteudo: `<a href="${urlEscaped}" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: underline; word-break: break-all; cursor: pointer;">${urlEscaped}</a>`
        });
        
        ultimoIndice = match.index + url.length;
      }
      
      // Adicionar texto restante
      if (ultimoIndice < conteudo.length) {
        const textoRestante = conteudo.substring(ultimoIndice);
        if (textoRestante) {
          partes.push({ tipo: 'texto', conteudo: escapeHtml(textoRestante) });
        }
      }
      
      // Se não encontrou URLs, escapar todo o conteúdo
      if (partes.length === 0) {
        conteudo = escapeHtml(conteudo);
      } else {
        conteudo = partes.map(p => p.conteudo).join('');
      }
      
      return `
        <div class="message-item ${isOperador ? 'operador' : 'motorista'}">
          <div class="message-bubble">
            <div class="message-header">${escapeHtml(nome)}</div>
            <div class="message-content">${conteudo}</div>
            <div class="message-time">${hora}</div>
          </div>
        </div>
      `;
    }).join('');
    
    scrollChatBottom();
  }

  /**
   * Tocar som de notificação
   */
  function tocarSomNotificacao(tipo = 'chat') {
    try {
      // Verificar se som está habilitado (localStorage)
      const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
      if (!somHabilitado) {
        return;
      }

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Frequências diferentes por tipo
      const frequencies = {
        'sos': 1000,
        'alerta': 800,
        'chat': 600,
        'geral': 500
      };

      oscillator.frequency.value = frequencies[tipo] || 600;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    } catch (err) {
      console.warn('Erro ao tocar som:', err);
    }
  }

  /**
   * Adicionar mensagem (via WebSocket)
   */
  function adicionarMensagem(mensagem) {
    // Verificar se é da conversa atual
    if (conversaAtual && mensagem.ID_CONVERSA === conversaAtual.ID) {
      // Verificar se a mensagem já existe (evitar duplicatas)
      const mensagemJaExiste = mensagens.some(m => 
        m.ID === mensagem.ID || 
        (m.CREATED_AT === mensagem.CREATED_AT && 
         m.CONTENT === mensagem.CONTENT && 
         m.SENDER_ID === mensagem.SENDER_ID)
      );
      
      if (!mensagemJaExiste) {
        mensagens.push(mensagem);
        renderizarMensagens();
        
        // Tocar som se a mensagem não foi enviada pelo operador atual
        if (mensagem.SENDER_TYPE !== 'OPERADOR' || mensagem.SENDER_ID !== idUsuario) {
          tocarSomNotificacao('chat');
        }
      }
    }
    
    // Atualizar lista de conversas
    const conversa = conversas.find(c => c.ID === mensagem.ID_CONVERSA);
    if (conversa) {
      conversa.ULTIMA_MENSAGEM = mensagem.CONTENT;
      conversa.DH_ULTIMA_MENSAGEM = mensagem.CREATED_AT;
      if (mensagem.SENDER_TYPE !== 'OPERADOR') {
        conversa.MENSAGENS_NAO_LIDAS = (conversa.MENSAGENS_NAO_LIDAS || 0) + 1;
      }
      renderizarConversas();
      atualizarEstatisticas();
    }
  }

  /**
   * Enviar mensagem
   */
  window.enviarMensagem = async function() {
    if (!conversaAtual) {
      mostrarMensagem('Selecione uma conversa primeiro', 'warning');
      return;
    }
    
    const texto = chatInputEl.value.trim();
    if (!texto) {
      return;
    }
    
    try {
      const btnEnviar = document.getElementById('btnEnviar');
      btnEnviar.disabled = true;
      
      // Obter nome real do operador
      const nomeOperador = getOperadorNome();
      
      const response = await fetch('/api/chat/mensagens', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idviagem: conversaAtual.ID_VIAGEM,
          idConversa: conversaAtual.ID,
          content: texto,
          senderType: 'OPERADOR',
          senderId: idUsuario,
          senderName: nomeOperador,
          tipo: 'TEXTO'
        })
      });
      
      const data = await response.json();
      
      if (data.success && data.message) {
        chatInputEl.value = '';
        ajustarAlturaInput();
        
        // Se WebSocket estiver conectado, não adicionar aqui
        // O WebSocket vai adicionar automaticamente via evento 'nova-mensagem'
        // Isso evita duplicação
        if (!socket || !socket.connected) {
          // Se WebSocket não estiver conectado, adicionar manualmente
          adicionarMensagem(data.message);
        } else {
          // Apenas atualizar lista de conversas se WebSocket estiver conectado
          // A mensagem será adicionada pelo WebSocket
          const conversa = conversas.find(c => c.ID === conversaAtual.ID);
          if (conversa) {
            conversa.ULTIMA_MENSAGEM = texto;
            conversa.DH_ULTIMA_MENSAGEM = data.message.CREATED_AT;
            // Reordenar (mais recente primeiro)
            conversas.sort((a, b) => {
              const dateA = new Date(a.DH_ULTIMA_MENSAGEM || a.DH_CRIACAO);
              const dateB = new Date(b.DH_ULTIMA_MENSAGEM || b.DH_CRIACAO);
              return dateB - dateA;
            });
            renderizarConversas();
          }
        }
      } else {
        throw new Error(data.error || 'Erro ao enviar mensagem');
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
      mostrarMensagem('Erro ao enviar mensagem: ' + err.message, 'error');
    } finally {
      const btnEnviar = document.getElementById('btnEnviar');
      if (btnEnviar) btnEnviar.disabled = false;
    }
  };

  /**
   * Marcar mensagens como lidas
   */
  async function marcarComoLidas(idConversa) {
    try {
      if (!conversaAtual || !conversaAtual.ID_VIAGEM) return;
      
      await fetch('/api/chat/marcar-lidas', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idviagem: conversaAtual.ID_VIAGEM,
          userId: idUsuario,
          userType: 'OPERADOR'
        })
      });
      
      // Atualizar contador local
      if (conversaAtual) {
        conversaAtual.MENSAGENS_NAO_LIDAS = 0;
        renderizarConversas();
        atualizarEstatisticas();
        atualizarContadorMenu();
      }
    } catch (err) {
      console.warn('Erro ao marcar como lidas:', err);
    }
  }

  /**
   * Buscar conversas
   */
  window.buscarConversas = async function() {
    const termo = document.getElementById('buscaConversas').value.trim();
    
    if (!termo) {
      carregarConversas();
      return;
    }
    
    try {
      const response = await fetch(`/api/chat/buscar?q=${encodeURIComponent(termo)}`, {
        headers: getAuthHeaders()
      });
      
      const data = await response.json();
      
      if (data.success && data.data) {
        conversas = data.data.conversas || [];
        renderizarConversas();
      }
    } catch (err) {
      console.error('Erro ao buscar:', err);
    }
  };

  /**
   * Inicializar WebSocket
   */
  function inicializarWebSocket() {
    try {
      if (typeof io === 'undefined') {
        console.warn('Socket.io não disponível. Tentando carregar...');
        carregarSocketIO();
        return;
      }
      
      conectarWebSocket();
    } catch (err) {
      console.warn('Erro ao inicializar WebSocket:', err);
    }
  }

  /**
   * Carregar Socket.IO
   */
  function carregarSocketIO() {
    // Verificar se já existe
    if (document.querySelector('script[src*="socket.io"]')) {
      console.log('✅ Socket.io já carregado');
      setTimeout(conectarWebSocket, 100);
      return;
    }
    
    // Verificar se Socket.io já está disponível globalmente
    if (typeof io !== 'undefined') {
      console.log('✅ Socket.io já disponível globalmente');
      conectarWebSocket();
      return;
    }
    
    // Tentar carregar do servidor local
    const script = document.createElement('script');
    script.src = (window.corrigirUrl ? window.corrigirUrl('/socket.io/socket.io.js') : '/socket.io/socket.io.js');
    script.onload = () => {
      console.log('✅ Socket.io carregado do servidor local');
      setTimeout(conectarWebSocket, 100);
    };
    script.onerror = () => {
      console.warn('⚠️ Socket.io não encontrado localmente');
      console.warn('⚠️ Chat funcionará, mas atualizações em tempo real podem não funcionar');
      // Não tentar CDN devido ao CSP
      mostrarMensagem('Aviso: Socket.io não encontrado. Chat funcionará, mas atualizações em tempo real podem estar limitadas.', 'warning');
    };
    document.head.appendChild(script);
  }

  /**
   * Conectar WebSocket
   */
  function conectarWebSocket() {
    try {
      socket = io(window.location.origin, {
        transports: ['websocket', 'polling']
      });
      
      socket.on('connect', () => {
        console.log('✅ WebSocket Chat conectado:', socket.id);
        estaConectado = true;
        
        // Entrar na sala da conversa atual
        if (conversaAtual) {
          if (conversaAtual.ID_VIAGEM) {
            socket.emit('join-viagem', conversaAtual.ID_VIAGEM);
          }
          socket.emit('join-conversa', conversaAtual.ID);
        }
      });
      
      socket.on('disconnect', () => {
        console.log('❌ WebSocket Chat desconectado');
        estaConectado = false;
      });
      
      socket.on('nova-mensagem', (mensagem) => {
        console.log('📨 Nova mensagem recebida:', mensagem);
        adicionarMensagem(mensagem);
        atualizarContadorMenu();
        
        // Tocar som se a mensagem não foi enviada pelo operador atual
        if (mensagem.SENDER_TYPE !== 'OPERADOR' || mensagem.SENDER_ID !== idUsuario) {
          tocarSomNotificacao('chat');
        }
      });
      
      socket.on('connect_error', (err) => {
        console.warn('⚠️ Erro de conexão WebSocket:', err);
        estaConectado = false;
      });
    } catch (err) {
      console.warn('⚠️ Erro ao conectar WebSocket:', err);
    }
  }

  /**
   * Mostrar chat ativo
   */
  function mostrarChatAtivo() {
    if (chatEmptyEl) chatEmptyEl.style.display = 'none';
    if (chatActiveEl) chatActiveEl.style.display = 'flex';
  }

  /**
   * Scroll para o final do chat
   */
  function scrollChatBottom() {
    if (chatMessagesEl) {
      setTimeout(() => {
        chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
      }, 100);
    }
  }

  /**
   * Ajustar altura do input
   */
  function ajustarAlturaInput() {
    if (chatInputEl) {
      chatInputEl.style.height = 'auto';
      chatInputEl.style.height = Math.min(chatInputEl.scrollHeight, 120) + 'px';
    }
  }

  /**
   * Handle tecla Enter no input
   */
  window.handleChatInputKeydown = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      enviarMensagem();
    } else {
      ajustarAlturaInput();
    }
  };

  /**
   * Atualizar estatísticas
   */
  async function atualizarEstatisticas() {
    try {
      const statConversas = document.getElementById('statConversas');
      const statNaoLidas = document.getElementById('statNaoLidas');
      const statTotal = document.getElementById('statTotal');
      
      if (statConversas) {
        statConversas.textContent = conversas.length;
      }
      
      if (statNaoLidas) {
        const totalNaoLidas = conversas.reduce((sum, c) => sum + (c.MENSAGENS_NAO_LIDAS || 0), 0);
        statNaoLidas.textContent = totalNaoLidas;
      }
      
      // Buscar contador de não lidas do servidor
      if (idUsuario) {
        const response = await fetch(`/api/chat/nao-lidas?idUsuario=${idUsuario}&userType=OPERADOR`, {
          headers: getAuthHeaders()
        });
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data) {
            if (statNaoLidas) {
              statNaoLidas.textContent = data.data.total || 0;
            }
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar estatísticas:', err);
    }
  }

  /**
   * Atualizar contador no menu
   */
  async function atualizarContadorMenu() {
    try {
      if (!idUsuario) return;
      
      const response = await fetch(`/api/chat/nao-lidas?idUsuario=${idUsuario}&userType=OPERADOR`, {
        headers: getAuthHeaders()
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data) {
          const total = data.data.total || 0;
          
          // Atualizar badge no menu
          const menuItem = document.querySelector('[data-programa="chat"]');
          if (menuItem) {
            let badge = menuItem.querySelector('.menu-badge');
            if (total > 0) {
              if (!badge) {
                badge = document.createElement('span');
                badge.className = 'menu-badge';
                menuItem.appendChild(badge);
              }
              badge.textContent = total > 99 ? '99+' : total.toString();
              badge.style.display = 'block';
              menuItem.classList.add('has-badge');
            } else {
              if (badge) {
                badge.style.display = 'none';
              }
              menuItem.classList.remove('has-badge');
            }
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao atualizar contador do menu:', err);
    }
  }

  /**
   * Recarregar chat
   */
  window.recarregarChat = function() {
    carregarConversas();
    if (conversaAtual) {
      selecionarConversa(conversaAtual.ID);
    }
    atualizarEstatisticas();
    atualizarContadorMenu();
  };

  /**
   * Mostrar ajuda
   */
  window.mostrarAjuda = function() {
    const modal = document.getElementById('modalAjuda');
    const content = document.getElementById('modalAjudaContent');
    
    if (modal && content) {
      content.innerHTML = `
        <h4>Como Funciona o Chat</h4>
        <p>O módulo de Chat permite comunicação em tempo real entre operadores e motoristas.</p>
        
        <h5 style="margin-top: 20px;">Funcionalidades:</h5>
        <ul>
          <li><strong>Lista de Conversas:</strong> Visualize todas as conversas ativas</li>
          <li><strong>Chat em Tempo Real:</strong> Mensagens são atualizadas instantaneamente via WebSocket</li>
          <li><strong>Busca:</strong> Use a barra de busca para encontrar conversas específicas</li>
          <li><strong>Contador de Não Lidas:</strong> Veja quantas mensagens não foram lidas</li>
          <li><strong>Histórico Completo:</strong> Todas as mensagens são salvas e podem ser consultadas</li>
        </ul>
        
        <h5 style="margin-top: 20px;">Como Usar:</h5>
        <ol>
          <li>Selecione uma conversa da lista à esquerda</li>
          <li>As mensagens serão carregadas automaticamente</li>
          <li>Digite sua mensagem no campo inferior e pressione Enter ou clique em Enviar</li>
          <li>Novas mensagens aparecerão automaticamente em tempo real</li>
        </ol>
        
        <h5 style="margin-top: 20px;">Dicas:</h5>
        <ul>
          <li>Use Shift+Enter para quebrar linha</li>
          <li>Mensagens não lidas aparecem destacadas na lista</li>
          <li>O contador no menu mostra o total de mensagens não lidas</li>
        </ul>
      `;
      modal.style.display = 'flex';
    }
  };

  /**
   * Fechar modal de ajuda
   */
  window.fecharModalAjuda = function() {
    const modal = document.getElementById('modalAjuda');
    if (modal) {
      modal.style.display = 'none';
    }
  };

  /**
   * Mostrar loading
   * Evita "piscar" em carregamentos rápidos
   */
  let loadingTimeout = null;
  let loadingAtivo = false;
  
  function mostrarLoading(mostrar) {
    if (!loadingOverlay) return;
    
    if (mostrar) {
      // Se já está ativo, não fazer nada
      if (loadingAtivo) return;
      
      // Aguardar 200ms antes de mostrar (evita piscar em carregamentos rápidos)
      loadingTimeout = setTimeout(() => {
        if (loadingOverlay && !loadingOverlay.classList.contains('active')) {
          loadingOverlay.classList.add('active');
          loadingAtivo = true;
        }
      }, 200);
    } else {
      // Cancelar timeout se ainda não mostrou
      if (loadingTimeout) {
        clearTimeout(loadingTimeout);
        loadingTimeout = null;
      }
      
      // Remover overlay se estiver visível
      if (loadingOverlay.classList.contains('active')) {
        loadingOverlay.classList.remove('active');
        loadingAtivo = false;
      }
    }
  }

  /**
   * Mostrar mensagem
   */
  function mostrarMensagem(texto, tipo = 'info') {
    // Usar sistema de mensagens global se disponível
    if (typeof window.showMessage === 'function') {
      window.showMessage(texto, tipo);
    } else {
      console.log(`[${tipo.toUpperCase()}] ${texto}`);
      alert(texto);
    }
  }

  /**
   * Formatar data
   */
  function formatarData(data) {
    if (!data) return '-';
    const d = new Date(data);
    return d.toLocaleDateString('pt-BR');
  }

  /**
   * Formatar hora
   */
  function formatarHora(data) {
    if (!data) return '-';
    const d = new Date(data);
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Escape HTML
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Toggle som de notificação
   */
  window.toggleSomNotificacaoChat = function() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const novoEstado = !somHabilitado;
    localStorage.setItem('notificacao_som', novoEstado.toString());
    
    const btn = document.getElementById('btnToggleSomChat');
    if (btn) {
      if (novoEstado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> Som';
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> Som';
        btn.title = 'Som desativado (clique para ativar)';
      }
    }
    
    // Tocar som de teste se ativou
    if (novoEstado) {
      tocarSomNotificacao('chat');
    }
  };

  /**
   * Atualizar estado do botão de som
   */
  function atualizarEstadoBotaoSom() {
    const somHabilitado = localStorage.getItem('notificacao_som') !== 'false';
    const btn = document.getElementById('btnToggleSomChat');
    if (btn) {
      if (somHabilitado) {
        btn.style.background = '#28a745';
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> Som';
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> Som';
        btn.title = 'Som desativado (clique para ativar)';
      }
    }
  }

  // Inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      inicializar();
      atualizarEstadoBotaoSom();
    });
  } else {
    inicializar();
    atualizarEstadoBotaoSom();
  }
})();
