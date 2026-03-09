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

const PORT = process.env.PORT || 3000; // Porta padrão: 3000 (pode ser alterada via .env)

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

// WebSocket: Gerenciar conexões de chat
io.on('connection', (socket) => {
  console.log('🔌 Cliente conectado:', socket.id);

  // Entrar em sala da viagem (chat)
  socket.on('join-viagem', (idviagem) => {
    socket.join(`viagem-${idviagem}`);
    console.log(`📱 Cliente ${socket.id} entrou na viagem ${idviagem}`);
  });

  // Sair da sala da viagem (chat)
  socket.on('leave-viagem', (idviagem) => {
    socket.leave(`viagem-${idviagem}`);
    console.log(`📱 Cliente ${socket.id} saiu da viagem ${idviagem}`);
  });

  // Entrar em sala da conversa (chat)
  socket.on('join-conversa', (idConversa) => {
    socket.join(`conversa-${idConversa}`);
    console.log(`💬 Cliente ${socket.id} entrou na conversa ${idConversa}`);
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

// Inicializar sistema de alertas (verificação periódica)
let alertCheckerInterval = null;

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

  // Inicializar job agendado de verificação de alertas (após servidor iniciar)
  iniciarJobAlertas();
  
  // Inicializar job agendado de recálculo de reputação (diário)
  iniciarJobReputacao();
});

/**
 * Iniciar job agendado para verificar alertas periodicamente
 * Verifica alertas a cada 5 minutos para viagens ativas
 */
function iniciarJobAlertas() {
  const alertService = require('./services/alert-service');
  const { poolPromise } = require('./config/db');

  const INTERVALO_MINUTOS = 5; // Verificar a cada 5 minutos
  const INTERVALO_MS = INTERVALO_MINUTOS * 60 * 1000;

  console.log(`🔄 Job de alertas iniciado (verificação a cada ${INTERVALO_MINUTOS} minutos)`);

  // Executar imediatamente na inicialização (aguardar 30 segundos para garantir que o banco está pronto)
  setTimeout(async () => {
    try {
      await verificarAlertasViagensAtivas();
    } catch (err) {
      console.error('Erro na primeira verificação de alertas:', err.message);
    }
  }, 30000); // 30 segundos

  // Agendar verificação periódica
  alertCheckerInterval = setInterval(async () => {
    try {
      await verificarAlertasViagensAtivas();
    } catch (err) {
      console.error('Erro ao verificar alertas:', err.message);
    }
  }, INTERVALO_MS);

  async function verificarAlertasViagensAtivas() {
    try {
      const pool = await poolPromise;
      // PostgreSQL: tabelas com aspas duplas (identificadores), CURRENT_TIMESTAMP, INTERVAL
      const result = await pool.query(`
        SELECT DISTINCT v."IDVIAGEM"
        FROM "VIAGEMMESTRE" v
        INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
        WHERE v."FGACTIVE" = 'A'
          AND v."CDSITUACAOVIAGEM" NOT IN (14, 15, 16, 17)
          AND (
            v."DTPREVINICIO" IS NULL
            OR v."DTPREVINICIO" >= (CURRENT_TIMESTAMP - INTERVAL '15 days')
          )
      `);

      const viagens = result.rows || [];
      
      if (viagens.length === 0) {
        console.log('ℹ️  Nenhuma viagem ativa encontrada para verificação de alertas');
        return; // Nenhuma viagem ativa
      }

      console.log(`🔍 Verificando alertas para ${viagens.length} viagem(ns) ativa(s)...`);

      let totalAlertas = 0;
      const websocketTorre = app.get('websocketTorre');
      
      for (const viagem of viagens) {
        try {
          const alertas = await alertService.verificarAlertas(viagem.IDVIAGEM ?? viagem.idviagem);
          totalAlertas += alertas.length;
          
          // Emitir eventos WebSocket para novos alertas
          if (websocketTorre && alertas.length > 0) {
            alertas.forEach(alerta => {
              websocketTorre.emitirNovoAlerta(alerta);
            });
          }
        } catch (err) {
          console.error(`Erro ao verificar alertas da viagem ${viagem.IDVIAGEM}:`, err.message);
        }
      }

      if (totalAlertas > 0) {
        console.log(`⚠️  ${totalAlertas} alerta(s) encontrado(s) em ${viagens.length} viagem(ns)`);
      } else {
        console.log(`✅ Nenhum alerta novo encontrado em ${viagens.length} viagem(ns) ativa(s)`);
      }
    } catch (err) {
      console.error('Erro ao verificar alertas de viagens ativas:', err);
    }
  }
}

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
  if (alertCheckerInterval) {
    clearInterval(alertCheckerInterval);
    console.log('🛑 Job de alertas encerrado');
  }
  if (reputationRecalcInterval) {
    clearInterval(reputationRecalcInterval);
    console.log('🛑 Job de reputação encerrado');
  }
});

process.on('SIGINT', () => {
  if (alertCheckerInterval) {
    clearInterval(alertCheckerInterval);
    console.log('🛑 Job de alertas encerrado');
  }
  if (reputationRecalcInterval) {
    clearInterval(reputationRecalcInterval);
    console.log('🛑 Job de reputação encerrado');
  }
});