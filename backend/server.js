// backend/server.js
// Carregar variáveis de ambiente PRIMEIRO, antes de qualquer outro módulo
const path = require('path');
const dotenv = require('dotenv');

// Carregar .env do diretório atual (backend/) – override para garantir valor correto
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath, override: true });

if (result.error) {
  console.error('❌ Erro ao carregar arquivo .env:', result.error);
  console.error('📁 Tentando carregar de:', envPath);
}

// Validar variáveis de ambiente obrigatórias
const variaveisObrigatorias = [
  'DB_SERVER',
  'DB_DATABASE',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET'
];

const variaveisFaltando = variaveisObrigatorias.filter(variavel => !process.env[variavel]);

if (variaveisFaltando.length > 0) {
  console.error('❌ ERRO CRÍTICO: Variáveis de ambiente obrigatórias não encontradas:');
  variaveisFaltando.forEach(variavel => {
    console.error(`   - ${variavel}`);
  });
  console.error('\n📝 Crie um arquivo .env na pasta backend/ com as seguintes variáveis (PostgreSQL):');
  console.error('   DB_SERVER=localhost   (ou DB_HOST=localhost)');
  console.error('   DB_PORT=5432');
  console.error('   DB_DATABASE=atlas_cargo_prd');
  console.error('   DB_USER=postgres');
  console.error('   DB_PASSWORD=senha');
  console.error('   JWT_SECRET=sua-chave-secreta-jwt');
  console.error('\n💡 Veja o arquivo .env.example para um exemplo completo.\n');
  process.exit(1);
}

// Garantir JWT_SECRET com tamanho mínimo (32 caracteres) – normalizar (trim) por causa de \r no Windows
if (process.env.JWT_SECRET) {
  process.env.JWT_SECRET = process.env.JWT_SECRET.trim();
}
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️  JWT_SECRET no .env tinha menos de 32 caracteres. Usando chave de desenvolvimento.');
  process.env.JWT_SECRET = 'SysScopel-Dev-JWT-Secret-Min32Chars-AtlasCargo-2026';
}

const app = require('./app');
const { createServer } = require('http');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3001; // Padrão 3001 (evita conflito com outro serviço na 3000); override via .env PORT=

// Criar servidor HTTP e Socket.io
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Permitir todas origens (ajustar em produção)
    methods: ["GET", "POST"]
  }
});

// Disponibilizar io no app para uso nos controllers
app.set('io', io);

// Middleware para disponibilizar io no req
app.use((req, res, next) => {
  req.io = io;
  next();
});

const { poolPromise } = require('./config/db');
const { socketTenantId, torreAllViagensRoom, chatDashboardRoom } = require('./services/socket-tenant.service');

// WebSocket: Gerenciar conexões de chat
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);
  socket.join(torreAllViagensRoom(socketTenantId(socket)));

  // Entrar em sala da viagem (chat) — só se viagem pertencer ao tenant do token
  socket.on('join-viagem', async (idviagem) => {
    try {
      const id = parseFloat(idviagem);
      if (!Number.isFinite(id) || id <= 0) return;
      const tid = socketTenantId(socket);
      const pool = await poolPromise;
      const r = await pool.query(
        'SELECT 1 FROM "VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1',
        [id, tid]
      );
      if (r.rows && r.rows.length > 0) {
        socket.join(`viagem-${idviagem}`);
        console.log(`📱 Cliente ${socket.id} entrou na viagem ${idviagem} (tenant ${tid})`);
      } else {
        console.warn(`📱 [WS] join-viagem negado: viagem ${idviagem} não existe ou outro tenant (socket ${socket.id})`);
      }
    } catch (e) {
      console.warn('📱 [WS] join-viagem erro:', e.message);
    }
  });

  // Sair da sala da viagem (chat)
  socket.on('leave-viagem', (idviagem) => {
    socket.leave(`viagem-${idviagem}`);
    console.log(`📱 Cliente ${socket.id} saiu da viagem ${idviagem}`);
  });

  // Entrar em sala da conversa (chat) — só se conversa pertencer ao tenant
  socket.on('join-conversa', async (idConversa) => {
    try {
      const id = parseInt(idConversa, 10);
      if (!Number.isFinite(id) || id <= 0) return;
      const tid = socketTenantId(socket);
      const pool = await poolPromise;
      const r = await pool.query(
        'SELECT 1 FROM "CONVERSAS" WHERE "ID" = $1 AND "TENANT_ID" = $2 LIMIT 1',
        [id, tid]
      );
      if (r.rows && r.rows.length > 0) {
        socket.join(`conversa-${idConversa}`);
        console.log(`💬 Cliente ${socket.id} entrou na conversa ${idConversa} (tenant ${tid})`);
      } else {
        console.warn(`💬 [WS] join-conversa negado: conversa ${idConversa} não existe ou outro tenant (socket ${socket.id})`);
      }
    } catch (e) {
      console.warn('💬 [WS] join-conversa erro:', e.message);
    }
  });

  // Dashboard: mensagens de motoristas só na sala do tenant do token (anti-IDOR)
  socket.on('join-chat-dashboard', () => {
    socket.join(chatDashboardRoom(socketTenantId(socket)));
  });

  // Sair da sala da conversa (chat)
  socket.on('leave-conversa', (idConversa) => {
    socket.leave(`conversa-${idConversa}`);
    console.log(`💬 Cliente ${socket.id} saiu da conversa ${idConversa}`);
  });

  socket.on('disconnect', () => {
    console.log('🔌 Cliente desconectado:', socket.id);
  });
});

// Inicializar WebSocket Torre de Controle
const { getWebSocketTorreService } = require('./services/websocket-torre.service');
let websocketTorreService = null;

try {
  websocketTorreService = getWebSocketTorreService(io);
  app.set('websocketTorre', websocketTorreService);
  console.log('✅ WebSocket Torre de Controle inicializado');
} catch (error) {
  console.error('❌ Erro ao inicializar WebSocket Torre:', error);
}

const { startAlertJob, stopAlertJob, restartAlertJob } = require('./jobs/alertas-viagem-job');
const {
  startWmsRelatorioVencimentoJob,
  stopWmsRelatorioVencimentoJob,
} = require('./jobs/wms-relatorio-vencimento-job');
const {
  startWmsCategoriaSugestaoJob,
  stopWmsCategoriaSugestaoJob,
} = require('./jobs/wms-categoria-sugestao-job');
const {
  startWmsEstoqueValorSnapshotJob,
  stopWmsEstoqueValorSnapshotJob,
} = require('./jobs/wms-estoque-valor-snapshot-job');
const { agendarSincronizarLedgerExpedicaoOnStart } = require('./jobs/wms-sincronizar-ledger-expedicao-job');

// Inicializar sistema de reputação (recálculo periódico)
const reputationService = require('./services/reputation-service');
let reputationRecalcInterval = null;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('==============================================');
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  console.log('🌐 Acesse o sistema em:');
  console.log(`   http://localhost:${PORT}`);
  console.log(`   http://127.0.0.1:${PORT}`);
  console.log('');
  console.log('📱 Para acessar de outros dispositivos na mesma rede:');
  console.log(`   http://192.168.1.173:${PORT}`);
  console.log('   (Substitua pelo seu IP local)');
  console.log('==============================================');
  console.log('');

  startAlertJob(app);
  startWmsRelatorioVencimentoJob();
  startWmsCategoriaSugestaoJob();
  startWmsEstoqueValorSnapshotJob();
  agendarSincronizarLedgerExpedicaoOnStart();
  app.set('restartAlertJob', () => {
    try {
      restartAlertJob(app);
    } catch (e) {
      console.error('❌ Erro ao reiniciar job de alertas:', e.message);
    }
  });

  // Inicializar job agendado de recálculo de reputação (diário)
  iniciarJobReputacao();
});

/**
 * Iniciar job agendado para recalcular reputações periodicamente
 * Recalcula reputação diariamente (24 horas)
 */
function iniciarJobReputacao() {
  const INTERVALO_HORAS = 24; // Recalcular a cada 24 horas
  const INTERVALO_MS = INTERVALO_HORAS * 60 * 60 * 1000;

  console.log(`📊 Job de reputação iniciado (recálculo a cada ${INTERVALO_HORAS} horas)`);

  // Executar pela primeira vez após 1 hora (aguardar sistema estabilizar)
  setTimeout(async () => {
    try {
      await reputationService.recalcularTodasReputacoes();
    } catch (err) {
      console.error('Erro no primeiro recálculo de reputação:', err.message);
    }
  }, 60 * 60 * 1000); // 1 hora

  // Agendar recálculo periódico
  reputationRecalcInterval = setInterval(async () => {
    try {
      await reputationService.recalcularTodasReputacoes();
    } catch (err) {
      console.error('Erro ao recalcular reputações:', err.message);
    }
  }, INTERVALO_MS);
}

// Limpar intervals ao encerrar o servidor
process.on('SIGTERM', () => {
  stopAlertJob();
  stopWmsRelatorioVencimentoJob();
  stopWmsCategoriaSugestaoJob();
  stopWmsEstoqueValorSnapshotJob();
  console.log('🛑 Job de alertas encerrado');
  if (reputationRecalcInterval) {
    clearInterval(reputationRecalcInterval);
    console.log('🛑 Job de reputação encerrado');
  }
});

process.on('SIGINT', () => {
  stopAlertJob();
  stopWmsRelatorioVencimentoJob();
  stopWmsCategoriaSugestaoJob();
  stopWmsEstoqueValorSnapshotJob();
  console.log('🛑 Job de alertas encerrado');
  if (reputationRecalcInterval) {
    clearInterval(reputationRecalcInterval);
    console.log('🛑 Job de reputação encerrado');
  }
});