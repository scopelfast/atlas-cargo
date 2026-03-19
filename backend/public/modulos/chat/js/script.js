// backend/public/modulos/chat/js/script.js
// Módulo de Chat - Frontend Completo
// Versão: 2.0
// Data: 2026-01-18
//
// Este módulo gerencia comunicação em tempo real entre operadores e motoristas.
// Inclui integração com WebSocket para atualizações em tempo real.
// Segue o mesmo padrão visual e funcional dos módulos Alertas e SOS.

(function() {
  'use strict';
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);

  // Estado do módulo
  let conversas = [];
  let conversaAtual = null;
  let mensagens = [];
  let socket = null;
  let estaConectado = false;
  let idUsuario = null;
  let mediaRecorderAudio = null;
  let chunksAudio = [];

  let contextoChat = { locale: 'pt-BR', timezone: 'America/Sao_Paulo' };
  async function loadContextoChat() {
    try {
      const r = await fetch('/api/contexto');
      const d = await r.json();
      if (d && d.locale) contextoChat.locale = d.locale;
      if (d && d.timezone) contextoChat.timezone = d.timezone;
    } catch (e) {}
  }

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
  async function inicializar() {
    console.log('💬 Módulo Chat inicializando...');
    await loadContextoChat();
    idUsuario = getUserId();
    if (!idUsuario) {
      mostrarMensagem(t('web.modulos.chat.erroConexao'), 'error');
      return;
    }
    carregarConversas();

    // Delegar clique em "Transcrever" / "Re-transcrever" áudio
    if (chatMessagesEl) {
      chatMessagesEl.addEventListener('click', async function(e) {
        const btn = e.target.closest('.btn-transcrever-audio, .btn-retranscrever-audio');
        if (!btn) return;
        e.preventDefault();
        const wrap = btn.closest('.message-transcrever-actions, .message-retranscrever-actions');
        const id = wrap && wrap.getAttribute('data-id-mensagem');
        const select = wrap && wrap.querySelector('select');
        const idioma = select ? select.value : 'pt';
        if (!id || !idioma) return;
        btn.disabled = true;
        try {
          const r = await fetch('/api/chat/transcrever-audio', { method: 'POST', headers: getAuthHeaders(), body: JSON.stringify({ idMensagem: parseInt(id, 10), idioma }) });
          const data = await r.json();
          if (data.success && data.message) {
            const idx = mensagens.findIndex(m => (m.ID || m.id) == id);
            if (idx !== -1) { mensagens[idx] = { ...mensagens[idx], CONTENT: data.message.CONTENT }; }
            renderizarMensagens();
          } else {
            mostrarMensagem(data.error || 'Erro ao transcrever', 'error');
          }
        } catch (err) {
          mostrarMensagem(err.message || 'Erro ao transcrever', 'error');
        }
        btn.disabled = false;
      });
    }

    // Botão enviar áudio (operador)
    const btnEnviarAudio = document.getElementById('btnEnviarAudio');
    if (btnEnviarAudio) {
      btnEnviarAudio.addEventListener('click', function() {
        if (!conversaAtual || (conversaAtual.ID_VIAGEM == null && conversaAtual.ID == null)) {
          mostrarMensagem(t('web.modulos.chat.selecioneConversa') || 'Selecione uma conversa.', 'warning');
          return;
        }
        const idViagem = conversaAtual.ID_VIAGEM;
        if (idViagem == null) {
          mostrarMensagem(t('web.modulos.chat.escolhaConversa') || 'Conversa sem viagem.', 'warning');
          return;
        }
        if (btnEnviarAudio.classList.contains('recording')) {
          if (mediaRecorderAudio && mediaRecorderAudio.state === 'recording') {
            mediaRecorderAudio.stop();
          }
          return;
        }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function(stream) {
          const options = { mimeType: (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4') };
          mediaRecorderAudio = new MediaRecorder(stream);
          chunksAudio = [];
          mediaRecorderAudio.ondataavailable = function(e) { if (e.data.size > 0) chunksAudio.push(e.data); };
          mediaRecorderAudio.onstop = function() {
            stream.getTracks().forEach(function(t) { t.stop(); });
            btnEnviarAudio.classList.remove('recording');
            btnEnviarAudio.querySelector('i').className = 'bx bx-microphone';
            if (chunksAudio.length === 0) {
              mostrarMensagem(t('web.modulos.chat.audioGravacaoVazia') || 'Gravação vazia. Tente novamente.', 'warning');
              btnEnviarAudio.disabled = false;
              return;
            }
            const blob = new Blob(chunksAudio, { type: mediaRecorderAudio.mimeType || 'audio/webm' });
            const ext = (mediaRecorderAudio.mimeType || '').indexOf('webm') !== -1 ? '.webm' : '.m4a';
            const form = new FormData();
            form.append('file', blob, 'audio' + ext);
            form.append('idviagem', idViagem);
            form.append('senderType', 'OPERADOR');
            form.append('senderId', idUsuario);
            form.append('senderName', getOperadorNome() || 'Operador');
            const selIdioma = document.getElementById('chatSelectIdiomaTranscricao');
            if (selIdioma && selIdioma.value) form.append('idioma', selIdioma.value);
            btnEnviarAudio.disabled = true;
            const token = localStorage.getItem('token');
            fetch('/api/chat/upload-audio', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token },
              body: form
            }).then(function(r) { return r.json(); }).then(function(data) {
              if (data.success && data.message) {
                if (conversaAtual.ID == null && data.message.ID_CONVERSA != null) {
                  conversaAtual.ID = data.message.ID_CONVERSA;
                  conversas.unshift({
                    ID: conversaAtual.ID,
                    ID_VIAGEM: conversaAtual.ID_VIAGEM,
                    motorista_nome: conversaAtual.motorista_nome,
                    viagem_codigo: conversaAtual.viagem_codigo,
                    ULTIMA_MENSAGEM: data.message.CONTENT,
                    DH_ULTIMA_MENSAGEM: data.message.CREATED_AT,
                    MENSAGENS_NAO_LIDAS: 0
                  });
                  renderizarConversas();
                }
                adicionarMensagem(data.message);
                scrollChatBottom();
              } else {
                mostrarMensagem(data.error || 'Erro ao enviar áudio.', 'error');
              }
            }).catch(function() {
              mostrarMensagem(t('web.modulos.chat.erroCarregar') || 'Erro ao enviar áudio.', 'error');
            }).finally(function() {
              btnEnviarAudio.disabled = false;
            });
          };
          mediaRecorderAudio.start();
          btnEnviarAudio.classList.add('recording');
          btnEnviarAudio.querySelector('i').className = 'bx bx-stop';
        }).catch(function(err) {
          const txt = (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
            ? (t('web.modulos.chat.microfonePermissaoNegada') || 'Permissão de microfone negada.')
            : (err.message || 'Erro ao acessar microfone.');
          mostrarMensagem(txt, 'error');
        });
      });
    }

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
   * Obter ID do usuário logado (compatível com objeto user do login e variações).
   * Se o usuário não tiver CDCADASTRO (ex.: admin sem cadastro vinculado), usa um id numérico
   * estável derivado do login para permitir uso do Chat.
   */
  function getUserId() {
    try {
      const userStr = localStorage.getItem('user');
      if (userStr) {
        const user = JSON.parse(userStr);
        const id = user.id ?? user.cdcadastro ?? user.CDCADASTRO ?? user.userId;
        if (id != null && id !== '') {
          const num = typeof id === 'number' ? id : parseFloat(id);
          if (Number.isFinite(num)) return num;
        }
        // Fallback: usuário sem cadastro vinculado (ex.: admin) — id estável a partir do login
        const login = user.login ?? user.LOGIN ?? user.SGUSUARIO ?? user.sgUsuario ?? '';
        if (login && typeof login === 'string') {
          let hash = 0;
          for (let i = 0; i < login.length; i++) {
            hash = ((hash << 5) - hash) + login.charCodeAt(i);
            hash = hash & 0x7FFFFFFF;
          }
          return hash || 1;
        }
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
        entrarEmSalasDasConversas();
      } else {
        throw new Error(data.error || 'Erro ao carregar conversas');
      }
    } catch (err) {
      console.error('Erro ao carregar conversas:', err);
      mostrarMensagem(t('web.modulos.chat.erroCarregar') + ' ' + err.message, 'error');
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
        <div style="padding: 20px; text-align: center; color: #6c757d;">
          <i class='bx bx-message' style="font-size: 48px; margin-bottom: 15px; opacity: 0.5;"></i>
          <p>Nenhuma conversa encontrada</p>
          <div style="margin-top: 20px; padding: 15px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #0d2137;">Iniciar conversa por viagem</p>
            <p style="margin: 0 0 10px 0; font-size: 12px;">Informe o código da viagem para enviar a primeira mensagem ao motorista.</p>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="number" id="inputIdViagemNovaConversa" placeholder="Ex: 1" min="1" style="width: 80px; padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 14px;">
              <button type="button" class="btn btn-primary" onclick="abrirNovaConversaPorViagem()" style="padding: 8px 16px;">
                <i class='bx bx-plus'></i> Abrir chat
              </button>
            </div>
          </div>
        </div>
      `;
      return;
    }
    
    const novaConversaRow = `
      <div style="padding: 12px 15px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
        <p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: #0d2137;">Nova conversa por viagem</p>
        <div style="display: flex; gap: 6px;">
          <input type="number" id="inputIdViagemNovaConversa" placeholder="Cód. viagem" min="1" style="flex: 1; padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px;">
          <button type="button" class="btn btn-primary" onclick="abrirNovaConversaPorViagem()" style="padding: 6px 12px; font-size: 13px;"><i class='bx bx-plus'></i></button>
        </div>
      </div>
    `;
    conversasListEl.innerHTML = novaConversaRow + conversas.map(conversa => {
      const isActive = conversaAtual && (conversaAtual.ID === conversa.ID || (conversaAtual.ID == null && conversaAtual.ID_VIAGEM === conversa.ID_VIAGEM));
      const hasUnread = conversa.MENSAGENS_NAO_LIDAS > 0;
      let ultimaMensagem = conversa.ULTIMA_MENSAGEM || 'Sem mensagens';
      if (ultimaMensagem.trim().startsWith('{') && ultimaMensagem.indexOf('"url"') !== -1) {
        ultimaMensagem = '🎙️ ' + (t('web.modulos.chat.audio') || 'Áudio');
      }
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
      
      renderizarConversas();
      mostrarChatAtivo();

      const nomeMotorista = conversa.motorista_nome || conversa.MOTORISTA_NOME || '';
      document.getElementById('chatInfoMotorista').textContent = nomeMotorista.trim() || 'Não informado';

      const viagemInfo = [];
      if (conversa.viagem_codigo || conversa.ID_VIAGEM) {
        viagemInfo.push(`Viagem: ${conversa.viagem_codigo || conversa.ID_VIAGEM}`);
      }
      if (conversa.viagem_origem && conversa.viagem_destino) {
        viagemInfo.push(`${conversa.viagem_origem} → ${conversa.viagem_destino}`);
      } else if (conversa.viagem_origem) {
        viagemInfo.push(`Origem: ${conversa.viagem_origem}`);
      } else if (conversa.viagem_destino) {
        viagemInfo.push(`Destino: ${conversa.viagem_destino}`);
      }
      document.getElementById('chatInfoViagem').textContent = viagemInfo.length > 0
        ? viagemInfo.join(' | ')
        : (conversa.viagem_codigo || conversa.ID_VIAGEM || '-');
      
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
      mostrarMensagem(t('web.modulos.chat.erroCarregar') + ' ' + err.message, 'error');
    }
  };

  /**
   * Abrir nova conversa por código da viagem (operador inicia o chat)
   */
  window.abrirNovaConversaPorViagem = async function() {
    const inputEl = document.getElementById('inputIdViagemNovaConversa');
    const raw = inputEl ? inputEl.value.trim() : '';
    const idViagem = raw ? parseInt(raw, 10) : null;
    if (!idViagem || idViagem < 1) {
      mostrarMensagem('Informe o código da viagem (número maior que 0).', 'warning');
      return;
    }
    const conversaVirtual = {
      ID: null,
      ID_VIAGEM: idViagem,
      motorista_nome: 'Viagem ' + idViagem,
      viagem_codigo: String(idViagem)
    };
    conversaAtual = conversaVirtual;
    renderizarConversas();
    mostrarChatAtivo();
    document.getElementById('chatInfoViagem').textContent = 'Viagem: ' + idViagem;
    document.getElementById('chatInfoMotorista').textContent = 'Envie a primeira mensagem para iniciar o chat.';
    if (socket && socket.connected && idViagem) {
      socket.emit('join-viagem', idViagem);
    }
    await carregarMensagensPorViagem(idViagem);
  };

  /**
   * Carregar mensagens por viagem (usado quando ainda não existe conversa)
   */
  async function carregarMensagensPorViagem(idViagem) {
    try {
      const response = await fetch(`/api/chat/viagem/${idViagem}?limit=100`, {
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Erro ${response.status}`);
      }
      const data = await response.json();
      mensagens = data.messages || [];
      renderizarMensagens();
    } catch (err) {
      console.warn('Erro ao carregar mensagens por viagem:', err);
      mensagens = [];
      renderizarMensagens();
    }
  }

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
      mostrarMensagem(t('web.modulos.chat.erroCarregar') + ' ' + err.message, 'error');
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
    
    const baseUrl = window.location.origin;
    chatMessagesEl.innerHTML = mensagens.map(msg => {
      const isOperador = msg.SENDER_TYPE === 'OPERADOR';
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
      const tipo = msg.TIPO || msg.tipo || 'TEXTO';

      let conteudo = '';
      let blocoLocalizacao = '';
      let blocoAudio = '';

      if (tipo === 'AUDIO') {
        let contentObj = {};
        try {
          contentObj = typeof msg.CONTENT === 'string' ? JSON.parse(msg.CONTENT) : (msg.CONTENT || {});
        } catch (e) {}
        const audioUrl = contentObj.url ? (baseUrl + (contentObj.url.indexOf('/') === 0 ? contentObj.url : '/' + contentObj.url)) : '';
        if (audioUrl) {
          blocoAudio = `<div class="message-audio" style="margin-top:8px;"><audio controls preload="metadata" src="${escapeHtml(audioUrl)}"></audio></div>`;
        }
        if (contentObj.transcricao) {
          const labelTransc = t('web.modulos.chat.transcricao') || 'Transcrição';
          blocoAudio += `<div class="message-transcricao" style="margin-top:10px;padding:12px 14px;background:linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 100%);border-left:4px solid #0ea5e9;border-radius:10px;font-size:14px;color:#0c4a6e;box-shadow:0 1px 3px rgba(14,165,233,0.15);"><span style="display:inline-block;font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:0.04em;color:#0369a1;margin-bottom:6px;">📝 ${escapeHtml(labelTransc)}</span><div style="margin-top:4px;line-height:1.5;">${escapeHtml(contentObj.transcricao)}</div></div>`;
          const labelRetrans = t('web.modulos.chat.retranscrever') || 'Re-transcrever em outro idioma';
          blocoAudio += `<div class="message-retranscrever-actions" style="margin-top:6px;" data-id-mensagem="${escapeHtml(String(msg.ID || msg.id))}">
            <select class="retranscrever-idioma-select" style="padding:4px 8px;border-radius:6px;margin-right:6px;">
              <option value="pt">Português</option><option value="es">Español</option><option value="en">English</option>
            </select>
            <button type="button" class="btn-retranscrever-audio" style="padding:4px 10px;border-radius:6px;background:#64748b;color:#fff;border:none;cursor:pointer;font-size:12px;">${escapeHtml(labelRetrans)}</button>
          </div>`;
        } else {
          const labelTranscrever = t('web.modulos.chat.transcrever') || 'Transcrever';
          blocoAudio += `<div class="message-transcrever-actions" style="margin-top:8px;" data-id-mensagem="${escapeHtml(String(msg.ID || msg.id))}">
            <select class="transcrever-idioma-select" style="padding:4px 8px;border-radius:6px;margin-right:6px;">
              <option value="pt">Português</option><option value="es">Español</option><option value="en">English</option>
            </select>
            <button type="button" class="btn-transcrever-audio" style="padding:4px 10px;border-radius:6px;background:#0ea5e9;color:#fff;border:none;cursor:pointer;font-size:12px;">${escapeHtml(labelTranscrever)}</button>
          </div>`;
        }
        conteudo = t('web.modulos.chat.audio') || 'Áudio';
      } else {
        let conteudoRaw = msg.CONTENT || '';
        const linkMapa = conteudoRaw.match(/https?:\/\/(www\.)?google\.com\/maps\?q=([-\d.]+),([-\d.]+)/i)?.[0] ||
          conteudoRaw.match(/https?:\/\/maps\.google\.com\/\?q=([-\d.]+),([-\d.]+)/i)?.[0] ||
          (conteudoRaw.match(/https?:\/\/[^\s<>"']+maps[^\s]*/gi) || []).find(u => /[-\d.]+\s*,\s*[-\d.]/.test(u));
        let conteudoStr = conteudoRaw.replace(/\n/g, '<br>');
        const partes = [];
        let ultimoIndice = 0;
        const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
        let match;
        while ((match = urlRegex.exec(conteudoStr)) !== null) {
          if (match.index > ultimoIndice) {
            const textoAntes = conteudoStr.substring(ultimoIndice, match.index);
            if (textoAntes) partes.push({ tipo: 'texto', conteudo: escapeHtml(textoAntes) });
          }
          const url = match[0];
          const urlEscaped = escapeHtml(url);
          const isMapLink = /google\.com\/maps|maps\.google|openstreetmap\.org\/.*#.*map=/i.test(url);
          partes.push({
            tipo: 'link',
            conteudo: isMapLink
              ? `<a href="${urlEscaped}" target="_blank" rel="noopener noreferrer" style="color: #0ea5e9; font-weight: 600; word-break: break-all;">🗺️ Ver no mapa</a>`
              : `<a href="${urlEscaped}" target="_blank" rel="noopener noreferrer" style="color: #667eea; text-decoration: underline; word-break: break-all; cursor: pointer;">${urlEscaped}</a>`
          });
          ultimoIndice = match.index + url.length;
        }
        if (ultimoIndice < conteudoStr.length) {
          const textoRestante = conteudoStr.substring(ultimoIndice);
          if (textoRestante) partes.push({ tipo: 'texto', conteudo: escapeHtml(textoRestante) });
        }
        conteudo = partes.length === 0 ? escapeHtml(conteudoStr) : partes.map(p => p.conteudo).join('');
        if (linkMapa) {
          blocoLocalizacao = `<div class="message-location" style="margin-top:10px;padding:10px;background:rgba(14,165,233,0.08);border-radius:10px;border:1px solid rgba(14,165,233,0.25);">
             <a href="${escapeHtml(linkMapa)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:8px 14px;background:#0ea5e9;color:white;border-radius:10px;text-decoration:none;font-weight:600;font-size:13px;">📍 Ver localização no mapa</a>
           </div>`;
        }
      }

      return `
        <div class="message-item ${isOperador ? 'operador' : 'motorista'}">
          <div class="message-bubble">
            <div class="message-header">${escapeHtml(nome)}</div>
            <div class="message-content">${conteudo}</div>
            ${blocoAudio}${blocoLocalizacao}
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
    if (!conversaAtual || (conversaAtual.ID_VIAGEM == null && conversaAtual.ID == null)) {
      mostrarMensagem('Selecione uma conversa ou inicie uma por viagem.', 'warning');
      return;
    }
    const idViagem = conversaAtual.ID_VIAGEM;
    if (idViagem == null) {
      mostrarMensagem('Conversa sem viagem associada.', 'warning');
      return;
    }

    const texto = chatInputEl.value.trim();
    if (!texto) {
      return;
    }

    try {
      const btnEnviar = document.getElementById('btnEnviar');
      btnEnviar.disabled = true;

      const nomeOperador = getOperadorNome();
      const body = {
        idviagem: idViagem,
        content: texto,
        senderType: 'OPERADOR',
        senderId: idUsuario,
        senderName: nomeOperador,
        tipo: 'TEXTO'
      };
      if (conversaAtual.ID != null) {
        body.idConversa = conversaAtual.ID;
      }

      const response = await fetch('/api/chat/mensagens', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(body)
      });

      const data = await response.json().catch(() => ({}));

      if (data.success && data.message) {
        chatInputEl.value = '';
        ajustarAlturaInput();

        if (conversaAtual.ID == null && data.message.ID_CONVERSA != null) {
          conversaAtual.ID = data.message.ID_CONVERSA;
          conversas.unshift({
            ID: conversaAtual.ID,
            ID_VIAGEM: conversaAtual.ID_VIAGEM,
            motorista_nome: conversaAtual.motorista_nome,
            viagem_codigo: conversaAtual.viagem_codigo,
            ULTIMA_MENSAGEM: texto,
            DH_ULTIMA_MENSAGEM: data.message.CREATED_AT,
            MENSAGENS_NAO_LIDAS: 0
          });
          renderizarConversas();
        }

        if (!socket || !socket.connected) {
          adicionarMensagem(data.message);
        } else {
          const conversa = conversas.find(c => c.ID === conversaAtual.ID);
          if (conversa) {
            conversa.ULTIMA_MENSAGEM = texto;
            conversa.DH_ULTIMA_MENSAGEM = data.message.CREATED_AT;
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
      const msg = err.message || '';
      const amigavel = (msg.includes('não cadastrada') || msg.includes('não existe') || msg.includes('não encontrada'))
        ? 'Viagem não cadastrada no sistema. Verifique o código da viagem.'
        : (t('web.modulos.chat.erroCarregar') || 'Erro') + ' ' + msg;
      mostrarMensagem(amigavel, 'error');
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
      const idViagem = conversaAtual && (conversaAtual.ID_VIAGEM ?? conversaAtual.id_viagem);
      if (!conversaAtual || idViagem == null || idViagem === '') return;
      if (idUsuario == null || idUsuario === '') return;

      const response = await fetch('/api/chat/marcar-lidas', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          idviagem: Number(idViagem),
          userId: Number(idUsuario),
          userType: 'OPERADOR'
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn('marcarComoLidas: servidor retornou', response.status, errText);
        return;
      }

      // Atualizar contador local e estatísticas só após o servidor confirmar
      if (conversaAtual) {
        conversaAtual.MENSAGENS_NAO_LIDAS = 0;
        conversaAtual.mensagens_nao_lidas = 0;
        renderizarConversas();
      }
      await atualizarEstatisticas();
      await atualizarContadorMenu();
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
   * Entrar nas salas Socket.IO de todas as conversas carregadas,
   * para receber nova-mensagem mesmo sem ter uma conversa selecionada (som + badge).
   */
  function entrarEmSalasDasConversas() {
    if (!socket || !socket.connected || !conversas.length) return;
    const viagensJaEntradas = new Set();
    conversas.forEach(function(c) {
      if (c.ID_VIAGEM != null && !viagensJaEntradas.has(Number(c.ID_VIAGEM))) {
        socket.emit('join-viagem', c.ID_VIAGEM);
        viagensJaEntradas.add(Number(c.ID_VIAGEM));
      }
      if (c.ID != null) {
        socket.emit('join-conversa', c.ID);
      }
    });
  }

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
    
    // Socket.io é sempre servido na raiz (/socket.io/), não no caminho base
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
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
        
        // Entrar na sala da conversa atual (se houver)
        if (conversaAtual) {
          if (conversaAtual.ID_VIAGEM) {
            socket.emit('join-viagem', conversaAtual.ID_VIAGEM);
          }
          if (conversaAtual.ID != null) {
            socket.emit('join-conversa', conversaAtual.ID);
          }
        }
        // Entrar em todas as salas das conversas para receber nova-mensagem (alerta + badge)
        entrarEmSalasDasConversas();
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
   * Mostrar mensagem (padrão do sistema: modal em vez de alert)
   */
  function mostrarMensagem(texto, tipo = 'info') {
    if (typeof window.showMessage === 'function') {
      window.showMessage(texto, tipo);
      return;
    }
    console.log(`[${tipo.toUpperCase()}] ${texto}`);
    const modal = document.getElementById('messageModal');
    const textEl = document.getElementById('messageModalText');
    const btnOk = document.getElementById('messageModalOk');
    if (modal && textEl && btnOk) {
      textEl.textContent = texto;
      modal.style.display = 'block';
      const fechar = function() {
        modal.style.display = 'none';
        btnOk.removeEventListener('click', fechar);
        modal.removeEventListener('click', onClickOverlay);
      };
      function onClickOverlay(e) {
        if (e.target === modal) fechar();
      }
      btnOk.addEventListener('click', fechar);
      modal.addEventListener('click', onClickOverlay);
    } else {
      alert(texto);
    }
  }

  function formatarData(data) {
    if (!data) return '-';
    const d = new Date(data);
    if (Number.isNaN(d.getTime())) return '-';
    const loc = contextoChat.locale || 'pt-BR';
    const tz = contextoChat.timezone || 'America/Sao_Paulo';
    try {
      return new Intl.DateTimeFormat(loc, { timeZone: tz, dateStyle: 'short' }).format(d);
    } catch (e) {
      return d.toLocaleDateString(loc);
    }
  }

  function formatarHora(data) {
    if (!data) return '-';
    const d = new Date(data);
    if (Number.isNaN(d.getTime())) return '-';
    if (typeof window.formatarDataHoraComFuso === 'function') {
      return window.formatarDataHoraComFuso(d, contextoChat.locale, contextoChat.timezone, { timeStyle: 'short' });
    }
    return d.toLocaleTimeString(contextoChat.locale || 'pt-BR', { timeZone: contextoChat.timezone || 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
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
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.chat.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.chat.som');
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
        btn.innerHTML = '<i class=\'bx bx-volume-full\'></i> ' + t('web.modulos.chat.som');
        btn.title = 'Som ativado (clique para desativar)';
      } else {
        btn.style.background = '#dc3545';
        btn.innerHTML = '<i class=\'bx bx-volume-mute\'></i> ' + t('web.modulos.chat.som');
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
