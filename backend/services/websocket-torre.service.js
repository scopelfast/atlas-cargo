// WebSocket Service para Torre de Controle
// Emite eventos em tempo real para atualizações de viagens, GPS, alertas, etc.
// Versão: 1.0

/**
 * Classe para gerenciar eventos WebSocket da Torre de Controle
 */
class WebSocketTorreService {
  constructor(io) {
    this.io = io;
    this.setupEventHandlers();
  }

  /**
   * Configurar handlers de eventos do Socket.io
   */
  setupEventHandlers() {
    if (!this.io) {
      console.warn('⚠️ WebSocket Torre: Socket.io não disponível');
      return;
    }

    this.io.on('connection', (socket) => {
      console.log('🏢 Torre de Controle: Cliente conectado:', socket.id);

      // Cliente quer acompanhar uma viagem específica
      socket.on('torre:join-viagem', (idviagem) => {
        const room = `torre:viagem-${idviagem}`;
        socket.join(room);
        console.log(`🏢 Torre: Cliente ${socket.id} entrou na viagem ${idviagem}`);
        
        // Confirmar entrada
        socket.emit('torre:joined', { idviagem, room });
      });

      // Cliente quer sair de uma viagem
      socket.on('torre:leave-viagem', (idviagem) => {
        const room = `torre:viagem-${idviagem}`;
        socket.leave(room);
        console.log(`🏢 Torre: Cliente ${socket.id} saiu da viagem ${idviagem}`);
      });

      // Cliente quer acompanhar todas as viagens (torre de controle)
      socket.on('torre:join-all', () => {
        socket.join('torre:all-viagens');
        console.log(`🏢 Torre: Cliente ${socket.id} entrou na sala de todas as viagens`);
        
        socket.emit('torre:joined-all');
      });

      // Cliente quer sair de todas as viagens
      socket.on('torre:leave-all', () => {
        socket.leave('torre:all-viagens');
        console.log(`🏢 Torre: Cliente ${socket.id} saiu da sala de todas as viagens`);
      });

      socket.on('disconnect', () => {
        console.log('🏢 Torre de Controle: Cliente desconectado:', socket.id);
      });
    });

    console.log('✅ WebSocket Torre Service inicializado');
  }

  /**
   * Emitir atualização de posição GPS
   * @param {number} idviagem - ID da viagem
   * @param {object} posicao - Dados da posição GPS
   */
  emitirAtualizacaoGPS(idviagem, posicao) {
    if (!this.io) return;

    const room = `torre:viagem-${idviagem}`;
    const data = {
      idviagem,
      posicao,
      timestamp: new Date().toISOString()
    };

    // Emitir para sala específica da viagem
    this.io.to(room).emit('torre:gps-update', data);
    
    // Emitir para sala de todas as viagens (torre de controle)
    this.io.to('torre:all-viagens').emit('torre:gps-update', data);
  }

  /**
   * Emitir atualização de status da viagem
   * @param {number} idviagem - ID da viagem
   * @param {object} viagem - Dados atualizados da viagem
   */
  emitirAtualizacaoViagem(idviagem, viagem) {
    if (!this.io) return;

    const room = `torre:viagem-${idviagem}`;
    const data = {
      idviagem,
      viagem,
      timestamp: new Date().toISOString()
    };

    // Emitir para sala específica da viagem
    this.io.to(room).emit('torre:viagem-update', data);
    
    // Emitir para sala de todas as viagens
    this.io.to('torre:all-viagens').emit('torre:viagem-update', data);
  }

  /**
   * Emitir novo alerta
   * @param {object} alerta - Dados do alerta
   */
  emitirNovoAlerta(alerta) {
    if (!this.io) return;

    const data = {
      alerta,
      timestamp: new Date().toISOString()
    };

    // Emitir para sala de todas as viagens (alertas aparecem na torre)
    this.io.to('torre:all-viagens').emit('torre:novo-alerta', data);

    // Se o alerta é de uma viagem específica, emitir também para sua sala
    if (alerta.CDVIAGEM) {
      const room = `torre:viagem-${alerta.CDVIAGEM}`;
      this.io.to(room).emit('torre:novo-alerta', data);
    }
  }

  /**
   * Emitir alerta resolvido
   * @param {number} idAlerta - ID do alerta
   * @param {number} idviagem - ID da viagem (opcional)
   */
  emitirAlertaResolvido(idAlerta, idviagem = null) {
    if (!this.io) return;

    const data = {
      idAlerta,
      idviagem,
      timestamp: new Date().toISOString()
    };

    this.io.to('torre:all-viagens').emit('torre:alerta-resolvido', data);

    if (idviagem) {
      const room = `torre:viagem-${idviagem}`;
      this.io.to(room).emit('torre:alerta-resolvido', data);
    }
  }

  /**
   * Emitir alerta marcado como lido (módulo Alertas do Sistema)
   * @param {number} idAlerta - ID do alerta
   */
  emitirAlertaLido(idAlerta) {
    if (!this.io) return;
    this.io.emit('alerta:lido', { id: idAlerta, timestamp: new Date().toISOString() });
  }

  /**
   * Emitir alerta tratado (status alterado)
   * @param {number} idAlerta - ID do alerta
   * @param {string} status - Novo status
   */
  emitirAlertaTratado(idAlerta, status) {
    if (!this.io) return;
    this.io.emit('alerta:tratado', { id: idAlerta, status, timestamp: new Date().toISOString() });
  }

  /**
   * Emitir alerta cancelado
   * @param {number} idAlerta - ID do alerta
   */
  emitirAlertaCancelado(idAlerta) {
    if (!this.io) return;
    this.io.emit('alerta:cancelado', { id: idAlerta, timestamp: new Date().toISOString() });
  }

  /**
   * Emitir nova mensagem de chat
   * @param {object} mensagem - Dados da mensagem
   */
  emitirNovaMensagem(mensagem) {
    if (!this.io) return;

    // Isso já é tratado pelo sistema de chat existente
    // Mas podemos adicionar notificação na torre se necessário
    const data = {
      mensagem,
      timestamp: new Date().toISOString()
    };

    const idViagem = mensagem.CDVIAGEM ?? mensagem.IDVIAGEM;
    if (idViagem != null) {
      const room = `torre:viagem-${idViagem}`;
      this.io.to(room).emit('torre:nova-mensagem', data);
    }
  }

  /**
   * Emitir alerta SOS
   * @param {object} sosAlert - Dados do alerta SOS
   */
  emitirSOS(sosAlert) {
    if (!this.io) return;

    const data = {
      sos: sosAlert,
      timestamp: new Date().toISOString(),
      prioridade: 'CRITICA'
    };

    // SOS vai para todas as salas da torre (máxima prioridade)
    this.io.to('torre:all-viagens').emit('torre:sos-alerta', data);

    if (sosAlert.CDVIAGEM) {
      const room = `torre:viagem-${sosAlert.CDVIAGEM}`;
      this.io.to(room).emit('torre:sos-alerta', data);
    }
  }

  /**
   * Emitir SOS marcado como lido
   * @param {number} idSos - ID do alerta SOS
   */
  emitirSOSLido(idSos) {
    if (!this.io) return;

    const data = {
      idSos,
      timestamp: new Date().toISOString()
    };

    this.io.to('torre:all-viagens').emit('torre:sos-lido', data);
  }

  /**
   * Emitir SOS tratado (status alterado)
   * @param {number} idSos - ID do alerta SOS
   * @param {string} status - Novo status
   */
  emitirSOSTratado(idSos, status) {
    if (!this.io) return;

    const data = {
      idSos,
      status,
      timestamp: new Date().toISOString()
    };

    this.io.to('torre:all-viagens').emit('torre:sos-tratado', data);
  }

  /**
   * Emitir atualização de reputação de motorista
   * @param {number} cdmotorista - ID do motorista
   * @param {object} reputacao - Dados da reputação
   */
  emitirAtualizacaoReputacao(cdmotorista, reputacao) {
    if (!this.io) return;

    const data = {
      cdmotorista,
      reputacao,
      timestamp: new Date().toISOString()
    };

    this.io.to('torre:all-viagens').emit('torre:reputacao-update', data);
  }

  /**
   * Emitir atualização de convocação
   * @param {number} idviagem - ID da viagem
   * @param {object} convocacao - Dados da convocação
   */
  emitirAtualizacaoConvocacao(idviagem, convocacao) {
    if (!this.io) return;

    const room = `torre:viagem-${idviagem}`;
    const data = {
      idviagem,
      convocacao,
      timestamp: new Date().toISOString()
    };

    this.io.to(room).emit('torre:convocacao-update', data);
    this.io.to('torre:all-viagens').emit('torre:convocacao-update', data);
  }

  /**
   * Emitir atualização de lista de viagens (quando há filtros aplicados)
   * @param {array} viagens - Lista atualizada de viagens
   */
  emitirAtualizacaoListaViagens(viagens) {
    if (!this.io) return;

    const data = {
      viagens,
      count: viagens.length,
      timestamp: new Date().toISOString()
    };

    this.io.to('torre:all-viagens').emit('torre:lista-viagens-update', data);
  }
}

// Singleton
let instance = null;

/**
 * Obter instância do serviço
 * @param {object} io - Instância do Socket.io
 * @returns {WebSocketTorreService}
 */
function getWebSocketTorreService(io) {
  if (!instance && io) {
    instance = new WebSocketTorreService(io);
  }
  return instance;
}

module.exports = {
  WebSocketTorreService,
  getWebSocketTorreService
};
