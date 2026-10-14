// WebSocket Service para Torre de Controle
// Emite eventos em tempo real para atualizações de viagens, GPS, alertas, etc.
// Multi-tenant: salas torre:all-viagens:<TENANT_ID> + validação torre:join-viagem

const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { socketTenantId, torreAllViagensRoom } = require('./socket-tenant.service');

async function tenantFromViagem(idviagem) {
  if (idviagem == null || idviagem === '') return getDefaultTenantId();
  const id = typeof idviagem === 'number' ? idviagem : parseFloat(idviagem);
  if (!Number.isFinite(id)) return getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      'SELECT "TENANT_ID" FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 LIMIT 1',
      [id]
    );
    const row = r.rows && r.rows[0];
    const tid = row && (row.TENANT_ID ?? row.tenant_id);
    if (tid != null && String(tid).trim() !== '') return String(tid).trim();
  } catch (_) {
    /* coluna/tabela ausente */
  }
  return getDefaultTenantId();
}

async function tenantFromSosId(idSos) {
  const id = parseInt(idSos, 10);
  if (!Number.isFinite(id)) return getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      'SELECT "TENANT_ID", "CDVIAGEM" FROM public."SOS_ALERTS" WHERE "ID" = $1 LIMIT 1',
      [id]
    );
    const row = r.rows && r.rows[0];
    if (row) {
      const tid = row.TENANT_ID ?? row.tenant_id;
      if (tid != null && String(tid).trim() !== '') return String(tid).trim();
      return tenantFromViagem(row.CDVIAGEM ?? row.cdviagem);
    }
  } catch (_) {}
  return getDefaultTenantId();
}

async function tenantFromAlertId(idAlerta) {
  const id = parseInt(idAlerta, 10);
  if (!Number.isFinite(id)) return getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      'SELECT "TENANT_ID", "IDVIAGEM" FROM public."ALERTS" WHERE "ID" = $1 LIMIT 1',
      [id]
    );
    const row = r.rows && r.rows[0];
    if (row) {
      const tid = row.TENANT_ID ?? row.tenant_id;
      if (tid != null && String(tid).trim() !== '') return String(tid).trim();
      return tenantFromViagem(row.IDVIAGEM ?? row.idviagem);
    }
  } catch (_) {}
  return getDefaultTenantId();
}

async function tenantFromMotorista(cdmotorista) {
  const id = parseFloat(cdmotorista);
  if (!Number.isFinite(id)) return getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      'SELECT "TENANT_ID" FROM public."CADASTROGERAL" WHERE "CDCADASTRO" = $1 LIMIT 1',
      [id]
    );
    const row = r.rows && r.rows[0];
    const tid = row && (row.TENANT_ID ?? row.tenant_id);
    if (tid != null && String(tid).trim() !== '') return String(tid).trim();
  } catch (_) {}
  return getDefaultTenantId();
}

async function tenantFromAlertPayload(alerta) {
  if (!alerta || typeof alerta !== 'object') return getDefaultTenantId();
  const direct = alerta.TENANT_ID ?? alerta.tenant_id;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const idv = alerta.CDVIAGEM ?? alerta.IDVIAGEM ?? alerta.idviagem;
  return tenantFromViagem(idv);
}

/**
 * Classe para gerenciar eventos WebSocket da Torre de Controle
 */
class WebSocketTorreService {
  constructor(io) {
    this.io = io;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    if (!this.io) {
      console.warn('⚠️ WebSocket Torre: Socket.io não disponível');
      return;
    }

    this.io.on('connection', (socket) => {
      console.log('🏢 Torre de Controle: Cliente conectado:', socket.id);

      socket.on('torre:join-viagem', async (idviagem) => {
        try {
          const id = parseFloat(idviagem);
          if (!Number.isFinite(id) || id <= 0) return;
          const tid = socketTenantId(socket);
          const pool = await poolPromise;
          const r = await pool.query(
            'SELECT 1 FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1',
            [id, tid]
          );
          if (r.rows && r.rows.length > 0) {
            const room = `torre:viagem-${idviagem}`;
            socket.join(room);
            socket.emit('torre:joined', { idviagem, room });
            console.log(`🏢 Torre: Cliente ${socket.id} entrou na viagem ${idviagem} (tenant ${tid})`);
          } else {
            console.warn(`🏢 [WS] torre:join-viagem negado: ${idviagem} (socket ${socket.id})`);
          }
        } catch (e) {
          console.warn('🏢 [WS] torre:join-viagem erro:', e.message);
        }
      });

      socket.on('torre:leave-viagem', (idviagem) => {
        const room = `torre:viagem-${idviagem}`;
        socket.leave(room);
        console.log(`🏢 Torre: Cliente ${socket.id} saiu da viagem ${idviagem}`);
      });

      socket.on('torre:join-all', () => {
        const room = torreAllViagensRoom(socketTenantId(socket));
        socket.join(room);
        console.log(`🏢 Torre: Cliente ${socket.id} entrou em ${room}`);
        socket.emit('torre:joined-all');
      });

      socket.on('torre:leave-all', () => {
        socket.leave(torreAllViagensRoom(socketTenantId(socket)));
        socket.leave('torre:all-viagens');
        console.log(`🏢 Torre: Cliente ${socket.id} saiu da sala all-viagens`);
      });

      socket.on('disconnect', () => {
        console.log('🏢 Torre de Controle: Cliente desconectado:', socket.id);
      });
    });

    console.log('✅ WebSocket Torre Service inicializado');
  }

  emitirAtualizacaoGPS(idviagem, posicao) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromViagem(idviagem);
      const roomAll = torreAllViagensRoom(tid);
      const room = `torre:viagem-${idviagem}`;
      const data = { idviagem, posicao, timestamp: new Date().toISOString() };
      this.io.to(room).emit('torre:gps-update', data);
      this.io.to(roomAll).emit('torre:gps-update', data);
    })();
  }

  emitirAtualizacaoViagem(idviagem, viagem) {
    if (!this.io) return;
    const tidDirect = viagem && (viagem.TENANT_ID ?? viagem.tenant_id);
    void (async () => {
      const tid =
        tidDirect != null && String(tidDirect).trim() !== ''
          ? String(tidDirect).trim()
          : await tenantFromViagem(idviagem);
      const roomAll = torreAllViagensRoom(tid);
      const room = `torre:viagem-${idviagem}`;
      const data = { idviagem, viagem, timestamp: new Date().toISOString() };
      this.io.to(room).emit('torre:viagem-update', data);
      this.io.to(roomAll).emit('torre:viagem-update', data);
    })();
  }

  emitirNovoAlerta(alerta) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromAlertPayload(alerta);
      const roomAll = torreAllViagensRoom(tid);
      const data = { alerta, timestamp: new Date().toISOString() };
      this.io.to(roomAll).emit('torre:novo-alerta', data);
      const idViagem = alerta.CDVIAGEM ?? alerta.IDVIAGEM ?? alerta.idviagem;
      if (idViagem != null && idViagem !== '') {
        const room = `torre:viagem-${idViagem}`;
        this.io.to(room).emit('torre:novo-alerta', data);
      }
    })();
  }

  emitirAlertaResolvido(idAlerta, idviagem = null) {
    if (!this.io) return;
    void (async () => {
      const tid = idviagem != null && idviagem !== ''
        ? await tenantFromViagem(idviagem)
        : await tenantFromAlertId(idAlerta);
      const roomAll = torreAllViagensRoom(tid);
      const data = { idAlerta, idviagem, timestamp: new Date().toISOString() };
      this.io.to(roomAll).emit('torre:alerta-resolvido', data);
      if (idviagem) {
        const room = `torre:viagem-${idviagem}`;
        this.io.to(room).emit('torre:alerta-resolvido', data);
      }
    })();
  }

  emitirAlertaLido(idAlerta) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromAlertId(idAlerta);
      const payload = { id: idAlerta, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('alerta:lido', payload);
    })();
  }

  emitirAlertaTratado(idAlerta, status) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromAlertId(idAlerta);
      const payload = { id: idAlerta, status, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('alerta:tratado', payload);
    })();
  }

  emitirAlertaCancelado(idAlerta) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromAlertId(idAlerta);
      const payload = { id: idAlerta, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('alerta:cancelado', payload);
    })();
  }

  emitirNovaMensagem(mensagem) {
    if (!this.io) return;
    const idViagem = mensagem.CDVIAGEM ?? mensagem.IDVIAGEM;
    if (idViagem == null) return;
    const tidDirect = mensagem.TENANT_ID ?? mensagem.tenant_id;
    void (async () => {
      const tid =
        tidDirect != null && String(tidDirect).trim() !== ''
          ? String(tidDirect).trim()
          : await tenantFromViagem(idViagem);
      const roomAll = torreAllViagensRoom(tid);
      const data = { mensagem, timestamp: new Date().toISOString() };
      const room = `torre:viagem-${idViagem}`;
      this.io.to(room).emit('torre:nova-mensagem', data);
      this.io.to(roomAll).emit('torre:nova-mensagem', data);
    })();
  }

  emitirSOS(sosAlert) {
    if (!this.io) return;
    void (async () => {
      const tidDirect = sosAlert && (sosAlert.TENANT_ID ?? sosAlert.tenant_id);
      const tid =
        tidDirect != null && String(tidDirect).trim() !== ''
          ? String(tidDirect).trim()
          : await tenantFromViagem(sosAlert.CDVIAGEM ?? sosAlert.cdviagem);
      const roomAll = torreAllViagensRoom(tid);
      const data = { sos: sosAlert, timestamp: new Date().toISOString(), prioridade: 'CRITICA' };
      this.io.to(roomAll).emit('torre:sos-alerta', data);
      if (sosAlert.CDVIAGEM) {
        const room = `torre:viagem-${sosAlert.CDVIAGEM}`;
        this.io.to(room).emit('torre:sos-alerta', data);
      }
    })();
  }

  /** Divergência de placas na convocação (motorista declarou DIVERGE; aceite bloqueado). */
  emitirDivergenciaPlacasConvocacao(payload) {
    if (!this.io || !payload || typeof payload !== 'object') return;
    void (async () => {
      const tidDirect = payload.TENANT_ID ?? payload.tenant_id;
      const idv = payload.IDVIAGEM ?? payload.idviagem;
      const tid =
        tidDirect != null && String(tidDirect).trim() !== ''
          ? String(tidDirect).trim()
          : await tenantFromViagem(idv);
      const roomAll = torreAllViagensRoom(tid);
      const data = {
        ...payload,
        timestamp: new Date().toISOString(),
        prioridade: 'ALTA',
      };
      this.io.to(roomAll).emit('torre:divergencia-placas-convocacao', data);
      if (idv != null && String(idv).trim() !== '') {
        this.io.to(`torre:viagem-${idv}`).emit('torre:divergencia-placas-convocacao', data);
      }
    })();
  }

  emitirSOSLido(idSos) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromSosId(idSos);
      const data = { idSos, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('torre:sos-lido', data);
    })();
  }

  emitirSOSTratado(idSos, status) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromSosId(idSos);
      const data = { idSos, status, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('torre:sos-tratado', data);
    })();
  }

  emitirAtualizacaoReputacao(cdmotorista, reputacao) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromMotorista(cdmotorista);
      const data = { cdmotorista, reputacao, timestamp: new Date().toISOString() };
      this.io.to(torreAllViagensRoom(tid)).emit('torre:reputacao-update', data);
    })();
  }

  emitirAtualizacaoConvocacao(idviagem, convocacao) {
    if (!this.io) return;
    void (async () => {
      const tid = await tenantFromViagem(idviagem);
      const roomAll = torreAllViagensRoom(tid);
      const room = `torre:viagem-${idviagem}`;
      const data = { idviagem, convocacao, timestamp: new Date().toISOString() };
      this.io.to(room).emit('torre:convocacao-update', data);
      this.io.to(roomAll).emit('torre:convocacao-update', data);
    })();
  }

  emitirAtualizacaoListaViagens(viagens) {
    if (!this.io) return;
    const data = {
      viagens,
      count: viagens.length,
      timestamp: new Date().toISOString()
    };
    const first = viagens && viagens[0];
    const tid = first && (first.TENANT_ID ?? first.tenant_id);
    if (tid != null && String(tid).trim() !== '') {
      this.io.to(torreAllViagensRoom(tid)).emit('torre:lista-viagens-update', data);
    } else {
      this.io.emit('torre:lista-viagens-update', data);
    }
  }
}

let instance = null;

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
