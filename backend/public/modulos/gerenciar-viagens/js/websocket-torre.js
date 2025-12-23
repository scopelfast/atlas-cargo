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

      // Carregar Socket.io do servidor
      const script = document.createElement('script');
      script.src = (window.corrigirUrl ? window.corrigirUrl('/socket.io/socket.io.js') : '/socket.io/socket.io.js');
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

  /**
   * Conectar ao servidor Socket.io
   */
  function conectar() {
    if (socket && socket.connected) {
      console.log('✅ WebSocket Torre já conectado');
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
      const host = window.location.host;
      const url = `${protocol}//${host}`;

      socket = io(url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: MAX_TENTATIVAS,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000
      });

      socket.on('connect', () => {
        console.log('✅ WebSocket Torre conectado:', socket.id);
        estaConectado = true;
        tentativasReconexao = 0;

        // Entrar na sala de todas as viagens (torre de controle)
        socket.emit('torre:join-all');

        // Reconectar às viagens que estava acompanhando
        viagensAcompanhadas.forEach(idviagem => {
          socket.emit('torre:join-viagem', idviagem);
        });
      });

      socket.on('disconnect', () => {
        console.log('📴 WebSocket Torre desconectado');
        estaConectado = false;
      });

      socket.on('connect_error', (error) => {
        console.error('❌ Erro ao conectar WebSocket Torre:', error);
        tentativasReconexao++;
        if (tentativasReconexao >= MAX_TENTATIVAS) {
          console.warn('⚠️ Máximo de tentativas de reconexão atingido');
        }
      });

      socket.on('reconnect', (attemptNumber) => {
        console.log(`🔄 WebSocket Torre reconectado (tentativa ${attemptNumber})`);
        estaConectado = true;
        tentativasReconexao = 0;
      });

      // Eventos da Torre de Controle
      socket.on('torre:joined-all', () => {
        console.log('✅ Entrou na sala de todas as viagens (Torre de Controle)');
      });

      socket.on('torre:joined', (data) => {
        console.log(`✅ Entrou na sala da viagem ${data.idviagem}`);
      });

      // Atualização de posição GPS
      socket.on('torre:gps-update', (data) => {
        console.log('📍 Atualização GPS recebida:', data.idviagem);
        atualizarPosicaoGPS(data.idviagem, data.posicao);
      });

      // Atualização de viagem
      socket.on('torre:viagem-update', (data) => {
        console.log('🔄 Atualização de viagem recebida:', data.idviagem);
        atualizarViagem(data.idviagem, data.viagem);
      });

      // Novo alerta
      socket.on('torre:novo-alerta', (data) => {
        console.log('⚠️ Novo alerta recebido:', data.alerta);
        adicionarNovoAlerta(data.alerta);
      });

      // Alerta resolvido
      socket.on('torre:alerta-resolvido', (data) => {
        console.log('✅ Alerta resolvido:', data.idAlerta);
        removerAlerta(data.idAlerta);
      });

      // Alerta SOS
      socket.on('torre:sos-alerta', (data) => {
        console.log('🆘 Alerta SOS recebido:', data.sos);
        adicionarSOS(data.sos);
      });

      // Nova mensagem
      socket.on('torre:nova-mensagem', (data) => {
        console.log('💬 Nova mensagem recebida:', data.mensagem);
        atualizarChat(data.mensagem);
      });

      // Atualização de reputação
      socket.on('torre:reputacao-update', (data) => {
        console.log('⭐ Atualização de reputação:', data.cdmotorista);
        atualizarReputacao(data.cdmotorista, data.reputacao);
      });

      // Atualização de lista de viagens
      socket.on('torre:lista-viagens-update', (data) => {
        console.log('📋 Atualização de lista de viagens:', data.count);
        atualizarListaViagens(data.viagens);
      });

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
      socket.disconnect();
      socket = null;
      estaConectado = false;
      console.log('📴 WebSocket Torre desconectado manualmente');
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
