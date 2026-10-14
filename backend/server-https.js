// =============================================
// Servidor HTTPS - SysScopel Backend
// Usar APENAS quando tiver certificados SSL
// =============================================

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Importar app Express existente
const app = require('./app');

const PORT_HTTP = process.env.PORT || 3001;
const PORT_HTTPS = process.env.PORT_HTTPS || 3443;

// =============================================
// HTTPS (se certificados existirem)
// =============================================
const sslKeyPath = path.join(__dirname, '..', 'ssl', 'key.pem');
const sslCertPath = path.join(__dirname, '..', 'ssl', 'cert.pem');

if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
  try {
    const sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };

    https.createServer(sslOptions, app).listen(PORT_HTTPS, () => {
      console.log('');
      console.log('==============================================');
      console.log(`✅ Servidor HTTPS rodando na porta ${PORT_HTTPS}`);
      console.log(`🔒 Acesse: https://localhost:${PORT_HTTPS}`);
      console.log(`🔒 Ou: https://192.168.1.173:${PORT_HTTPS}`);
      console.log('📊 Ambiente:', process.env.NODE_ENV || 'development');
      console.log('🔐 SSL ativo!');
      console.log('==============================================');
      console.log('');
      try {
        const { startAlertJob, restartAlertJob } = require('./jobs/alertas-viagem-job');
        const { startWmsRelatorioVencimentoJob } = require('./jobs/wms-relatorio-vencimento-job');
        const { startWmsCategoriaSugestaoJob } = require('./jobs/wms-categoria-sugestao-job');
        const { startWmsEstoqueValorSnapshotJob } = require('./jobs/wms-estoque-valor-snapshot-job');
        const { agendarSincronizarLedgerExpedicaoOnStart } = require('./jobs/wms-sincronizar-ledger-expedicao-job');
        startAlertJob(app);
        startWmsRelatorioVencimentoJob();
        startWmsCategoriaSugestaoJob();
        startWmsEstoqueValorSnapshotJob();
        agendarSincronizarLedgerExpedicaoOnStart();
        app.set('restartAlertJob', () => {
          try {
            restartAlertJob(app);
          } catch (e2) {
            console.error('❌ Erro ao reiniciar job de alertas:', e2.message);
          }
        });
      } catch (e) {
        console.error('❌ Não foi possível iniciar o job de alertas:', e.message);
      }
    });

    console.log('✅ Certificados SSL encontrados e carregados!');
  } catch (error) {
    console.error('❌ Erro ao carregar certificados SSL:', error.message);
    process.exit(1);
  }
} else {
  console.log('');
  console.log('⚠️  ATENÇÃO: Certificados SSL não encontrados!');
  console.log('');
  console.log('📁 Esperado em:');
  console.log(`   - ${sslKeyPath}`);
  console.log(`   - ${sslCertPath}`);
  console.log('');
  console.log('💡 Para gerar certificados auto-assinados, execute:');
  console.log('');
  console.log('   mkdir ssl');
  console.log('   cd ssl');
  console.log('   openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes');
  console.log('');
  console.log('🚨 Servidor HTTPS NÃO foi iniciado!');
  console.log('');
  process.exit(1);
}

// =============================================
// HTTP (Opcional - Redirecionar para HTTPS)
// =============================================
http.createServer((req, res) => {
  const host = req.headers.host.split(':')[0];
  const httpsUrl = `https://${host}:${PORT_HTTPS}${req.url}`;
  
  console.log(`🔀 Redirecionando HTTP → HTTPS: ${req.url}`);
  
  res.writeHead(301, { 'Location': httpsUrl });
  res.end();
}).listen(PORT_HTTP, () => {
  console.log(`🔀 Servidor HTTP rodando na porta ${PORT_HTTP} (redireciona para HTTPS)`);
  console.log('');
});

// =============================================
// Encerramento — job de alertas (mesmo módulo do server.js)
// =============================================
const { stopAlertJob } = require('./jobs/alertas-viagem-job');
const { stopWmsRelatorioVencimentoJob } = require('./jobs/wms-relatorio-vencimento-job');
const { stopWmsCategoriaSugestaoJob } = require('./jobs/wms-categoria-sugestao-job');
const { stopWmsEstoqueValorSnapshotJob } = require('./jobs/wms-estoque-valor-snapshot-job');
function encerrarJobAlertasHttps() {
  stopAlertJob();
  stopWmsRelatorioVencimentoJob();
  stopWmsCategoriaSugestaoJob();
  stopWmsEstoqueValorSnapshotJob();
  console.log('🛑 Job de alertas encerrado');
}
process.on('SIGTERM', encerrarJobAlertasHttps);
process.on('SIGINT', encerrarJobAlertasHttps);

// =============================================
// Tratamento de Erros
// =============================================
process.on('uncaughtException', (error) => {
  console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Promise rejeitada não tratada:', reason);
});

