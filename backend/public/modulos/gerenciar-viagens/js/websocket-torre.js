// WebSocket Client para Torre de Controle
// Conecta ao Socket.io e recebe atualizações em tempo real
// Versão: 1.0

(function() {
  'use strict';

  let socket = null;
  let viagensAcompanhadas = new Set();
  let estaConectado = false;
  let tentativasReconexao = 0;
  const MAX_TENTATIVAS = 5;

  /**
   * Inicializar conexão WebSocket
   */
  function inicializar() {
    if (typeof io === 'undefined') {
      console.warn('⚠️ Socket.io não disponível. Carregando...');
      carregarSocketIO().then(() => {
        conectar();
      }).catch(err => {
        console.error('❌ Erro ao carregar Socket.io:', err);
      });
      return;
    }

    conectar();
  }

  /**
   * Carregar Socket.io dinamicamente
   */
  function carregarSocketIO() {
    return new Promise((resolve, reject) => {
      // Verificar se já está carregado
      if (typeof io !== 'undefined') {
        resolve();
        return;
      }

      // Verificar se já existe script carregando
      if (document.querySelector('script[src*="socket.io"]')) {
        // Aguardar carregamento
        let tentativas = 0;
        const checkInterval = setInterval(() => {
          if (typeof io !== 'undefined') {
            clearInterval(checkInterval);
            resolve();
          } else if (tentativas++ > 20) {
            clearInterval(checkInterval);
            reject(new Error('Timeout ao carregar Socket.io'));
          }
        }, 500);
        return;
      }

      // Socket.io é sempre servido na raiz (/socket.io/), não no caminho base
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = () => {
        setTimeout(() => {
          if (typeof io !== 'undefined') {
            resolve();
          } else {
            reject(new Error('Socket.io carregado mas io não está disponível'));
          }
        }, 100);
      };
      script.onerror = () => {
        reject(new Error('Erro ao carregar Socket.io'));
      };
      document.head.appendChild(script);
    });
  }

  function executarJoinTorreAposConectar() {
    if (!socket || !socket.connected) return;
    estaConectado = true;
    tentativasReconexao = 0;
    socket.emit('torre:join-all');
    viagensAcompanhadas.forEach(idviagem => {
      socket.emit('torre:join-viagem', idviagem);
    });
  }

  /**
   * Liga um listener substituindo apenas a referência anterior deste módulo (não remove handlers do dashboard).
   */
  function bindTorreModulo(s, eventName, storageKey, fn) {
    const prev = s[storageKey];
    if (typeof prev === 'function') {
      try {
        s.off(eventName, prev);
      } catch (_) {}
    }
    s[storageKey] = fn;
    s.on(eventName, fn);
  }

  /**
   * Listeners do módulo Gerenciar Viagens (substitui só os callbacks deste módulo ao reabrir a tela).
   */
  function instalarListenersTorreModulo(s) {
    if (!s) return;

    bindTorreModulo(s, 'connect', '_atlasTorreCb_connect', () => {
      console.log('✅ WebSocket Torre conectado:', s.id);
      executarJoinTorreAposConectar();
    });

    bindTorreModulo(s, 'disconnect', '_atlasTorreCb_disconnect', () => {
      console.log('📴 WebSocket Torre desconectado');
      estaConectado = false;
    });

    bindTorreModulo(s, 'connect_error', '_atlasTorreCb_connect_error', error => {
      console.error('❌ Erro ao conectar WebSocket Torre:', error);
      tentativasReconexao++;
      if (tentativasReconexao >= MAX_TENTATIVAS) {
        console.warn('⚠️ Máximo de tentativas de reconexão atingido');
      }
    });

    bindTorreModulo(s, 'reconnect', '_atlasTorreCb_reconnect', attemptNumber => {
      console.log(`🔄 WebSocket Torre reconectado (tentativa ${attemptNumber})`);
      estaConectado = true;
      tentativasReconexao = 0;
    });

    bindTorreModulo(s, 'torre:joined-all', '_atlasTorreCb_joined_all', () => {
      console.log('✅ Entrou na sala de todas as viagens (Torre de Controle)');
    });

    bindTorreModulo(s, 'torre:joined', '_atlasTorreCb_joined', data => {
      console.log(`✅ Entrou na sala da viagem ${data.idviagem}`);
    });

    bindTorreModulo(s, 'torre:gps-update', '_atlasTorreCb_gps', data => {
      console.log('📍 Atualização GPS recebida:', data.idviagem);
      atualizarPosicaoGPS(data.idviagem, data.posicao);
    });

    bindTorreModulo(s, 'torre:viagem-update', '_atlasTorreCb_viagem', data => {
      console.log('🔄 Atualização de viagem recebida:', data.idviagem);
      atualizarViagem(data.idviagem, data.viagem);
    });

    bindTorreModulo(s, 'torre:novo-alerta', '_atlasTorreCb_novo_alerta', data => {
      console.log('⚠️ Novo alerta recebido:', data.alerta);
      adicionarNovoAlerta(data.alerta);
    });

    bindTorreModulo(s, 'torre:alerta-resolvido', '_atlasTorreCb_alerta_resolvido', data => {
      console.log('✅ Alerta resolvido:', data.idAlerta);
      removerAlerta(data.idAlerta);
    });

    bindTorreModulo(s, 'torre:sos-alerta', '_atlasTorreCb_sos', data => {
      console.log('🆘 Alerta SOS recebido:', data.sos);
      adicionarSOS(data.sos);
    });

    bindTorreModulo(s, 'torre:nova-mensagem', '_atlasTorreCb_msg', data => {
      console.log('💬 Nova mensagem recebida:', data.mensagem);
      atualizarChat(data.mensagem);
    });

    bindTorreModulo(s, 'torre:reputacao-update', '_atlasTorreCb_rep', data => {
      console.log('⭐ Atualização de reputação:', data.cdmotorista);
      atualizarReputacao(data.cdmotorista, data.reputacao);
    });

    bindTorreModulo(s, 'torre:lista-viagens-update', '_atlasTorreCb_lista', data => {
      console.log('📋 Atualização de lista de viagens:', data.count);
      atualizarListaViagens(data.viagens);
    });
  }

  /**
   * Conectar ao servidor Socket.io (reutiliza o mesmo socket do dashboard quando existir).
   */
  function conectar() {
    const shared = typeof window !== 'undefined' ? window.__atlasIoShared : null;

    if (shared) {
      socket = shared;
      instalarListenersTorreModulo(socket);
      if (socket.connected) {
        console.log('✅ WebSocket Torre reutiliza conexão do dashboard:', socket.id);
        executarJoinTorreAposConectar();
      }
      return;
    }

    if (socket && socket.connected) {
      console.log('✅ WebSocket Torre já conectado');
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const host = window.location.host;
      const url = `${protocol}//${host}`;
      const pathFn = typeof window.__atlasGetSocketIoPath === 'function' ? window.__atlasGetSocketIoPath : null;
      const path = pathFn ? pathFn() : '/socket.io';
      const ioOpts = {
        transports: ['polling', 'websocket'],
        reconnection: true,
        reconnectionAttempts: MAX_TENTATIVAS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        auth: { token: (typeof localStorage !== 'undefined' && localStorage.getItem('token')) || '' }
      };
      if (path !== '/socket.io') ioOpts.path = path;

      socket = io(url, ioOpts);
      if (typeof window !== 'undefined') {
        window.__atlasIoShared = socket;
      }
      instalarListenersTorreModulo(socket);
    } catch (error) {
      console.error('❌ Erro ao conectar WebSocket Torre:', error);
    }
  }

  /**
   * Acompanhar uma viagem específica
   * @param {number} idviagem - ID da viagem
   */
  function acompanharViagem(idviagem) {
    if (!socket || !socket.connected) {
      console.warn('⚠️ WebSocket não conectado. Reconectando...');
      inicializar();
      // Aguardar conexão e então acompanhar
      setTimeout(() => acompanharViagem(idviagem), 1000);
      return;
    }

    if (!viagensAcompanhadas.has(idviagem)) {
      viagensAcompanhadas.add(idviagem);
      socket.emit('torre:join-viagem', idviagem);
      console.log(`📡 Acompanhando viagem ${idviagem}`);
    }
  }

  /**
   * Parar de acompanhar uma viagem
   * @param {number} idviagem - ID da viagem
   */
  function pararAcompanharViagem(idviagem) {
    if (!socket || !socket.connected) return;

    if (viagensAcompanhadas.has(idviagem)) {
      viagensAcompanhadas.delete(idviagem);
      socket.emit('torre:leave-viagem', idviagem);
      console.log(`📴 Parou de acompanhar viagem ${idviagem}`);
    }
  }

  /**
   * Atualizar posição GPS no mapa
   */
  function atualizarPosicaoGPS(idviagem, posicao) {
    // Chamar função global se existir
    if (typeof window.atualizarPosicaoGPS === 'function') {
      window.atualizarPosicaoGPS(idviagem, posicao);
    } else if (typeof atualizarMapa === 'function') {
      // Fallback para função existente
      atualizarMapa(idviagem);
    }
  }

  /**
   * Atualizar dados da viagem
   */
  function atualizarViagem(idviagem, viagem) {
    // Chamar função global se existir
    if (typeof window.atualizarDadosViagem === 'function') {
      window.atualizarDadosViagem(idviagem, viagem);
    } else {
      // Recarregar dados da viagem
      if (typeof carregarDetalhesViagem === 'function') {
        carregarDetalhesViagem(idviagem);
      }
    }
  }

  /**
   * Adicionar novo alerta
   */
  function adicionarNovoAlerta(alerta) {
    // Se estamos na aba de alertas, adicionar à lista
    if (typeof window.adicionarAlerta === 'function') {
      window.adicionarAlerta(alerta);
    } else if (typeof carregarAlertas === 'function') {
      carregarAlertas();
    }
  }

  /**
   * Remover alerta resolvido
   */
  function removerAlerta(idAlerta) {
    if (typeof window.removerAlerta === 'function') {
      window.removerAlerta(idAlerta);
    } else if (typeof carregarAlertas === 'function') {
      carregarAlertas();
    }
  }

  /**
   * Adicionar alerta SOS
   */
  function adicionarSOS(sos) {
    // Mostrar notificação
    if (typeof window.notificarSOS === 'function') {
      window.notificarSOS(sos);
    }
    
    // Atualizar lista de SOS
    if (typeof window.carregarAlertasSOS === 'function') {
      window.carregarAlertasSOS();
    }
  }

  /**
   * Atualizar chat
   */
  function atualizarChat(mensagem) {
    if (typeof window.adicionarMensagemChat === 'function') {
      window.adicionarMensagemChat(mensagem);
    }
  }

  /**
   * Atualizar reputação
   */
  function atualizarReputacao(cdmotorista, reputacao) {
    if (typeof window.atualizarReputacaoMotorista === 'function') {
      window.atualizarReputacaoMotorista(cdmotorista, reputacao);
    }
  }

  /**
   * Atualizar lista de viagens
   */
  function atualizarListaViagens(viagens) {
    // Atualizar grid se estiver visível
    if (typeof window.atualizarGridViagens === 'function') {
      window.atualizarGridViagens(viagens);
    }
  }

  /**
   * Verificar se está conectado
   */
  function estaConectadoWebSocket() {
    return estaConectado && socket && socket.connected;
  }

  /**
   * Desconectar
   */
  function desconectar() {
    if (socket) {
      socket.emit('torre:leave-all');
      viagensAcompanhadas.forEach(idviagem => {
        socket.emit('torre:leave-viagem', idviagem);
      });
      viagensAcompanhadas.clear();
      const shared = typeof window !== 'undefined' ? window.__atlasIoShared : null;
      if (socket === shared) {
        socket = null;
        estaConectado = false;
        console.log('📴 WebSocket Torre: saiu das salas (conexão compartilhada mantida para o dashboard).');
      } else {
        socket.disconnect();
        socket = null;
        estaConectado = false;
        console.log('📴 WebSocket Torre desconectado manualmente');
      }
    }
  }

  // Exportar API global
  window.WebSocketTorre = {
    inicializar,
    conectar,
    desconectar,
    acompanharViagem,
    pararAcompanharViagem,
    estaConectado: estaConectadoWebSocket,
    getViagensAcompanhadas: () => Array.from(viagensAcompanhadas)
  };

  // Auto-inicializar quando DOM estiver pronto
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializar);
  } else {
    inicializar();
  }

  console.log('✅ WebSocket Torre Client carregado');

})();
