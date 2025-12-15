// backend/config/db.js
const sql = require('mssql');
require('dotenv').config();

// Debug: verificar se as variáveis estão sendo carregadas
if (!process.env.DB_SERVER) {
  console.error('⚠️ AVISO: DB_SERVER não encontrado nas variáveis de ambiente');
  console.error('Variáveis carregadas:', {
    DB_SERVER: process.env.DB_SERVER,
    DB_PORT: process.env.DB_PORT,
    DB_DATABASE: process.env.DB_DATABASE,
    DB_USER: process.env.DB_USER ? '***' : undefined,
    DB_PASSWORD: process.env.DB_PASSWORD ? '***' : undefined
  });
}

// Configuração do banco principal DIVULGACARGA_PRD
const config = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  port: parseInt(process.env.DB_PORT, 10) || 1433,
  database: process.env.DB_DATABASE,
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 600000,      // 10 minutos (600 segundos) para requests longos
    connectionTimeout: 30000     // 30 segundos para estabelecer conexão
  },
  pool: {
    max: 50,                    // Aumentado de 15 para 50 conexões simultâneas
    min: 5,                      // Manter 5 conexões sempre abertas (evita latência)
    idleTimeoutMillis: 30000,   // 30 segundos de timeout para conexões ociosas
    acquireTimeoutMillis: 60000, // 60 segundos para adquirir conexão do pool
    createTimeoutMillis: 30000  // 30 segundos para criar nova conexão
  }
};

// Configuração do banco INTEGRA_PRD (banco de migração)
const configIntegra = {
  user: process.env.INTEGRA_DB_USER || 'sa',
  password: process.env.INTEGRA_DB_PASSWORD || 'SistMSQLServer2025&*',
  server: process.env.INTEGRA_DB_SERVER || '186.250.92.131',
  port: parseInt(process.env.INTEGRA_DB_PORT, 10) || 35987,
  database: process.env.INTEGRA_DB_DATABASE || 'INTEGRA_PRD',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    requestTimeout: 600000,
    connectionTimeout: 30000
  },
  pool: {
    max: 20,
    min: 2,
    idleTimeoutMillis: 30000,
    acquireTimeoutMillis: 60000,
    createTimeoutMillis: 30000
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('✅ Conexão com DIVULGACARGA_PRD estabelecida');
    return pool;
  })
  .catch(err => {
    console.error('❌ Erro na conexão com SQL Server (DIVULGACARGA_PRD):', err);
    console.warn('⚠️ Servidor continuará rodando, mas funcionalidades do banco não estarão disponíveis.');
    console.warn('⚠️ Verifique se o servidor SQL está acessível e as credenciais estão corretas.');
    return Promise.reject(err);
  });

// Pool para INTEGRA_PRD (conexão separada)
const poolIntegraPromise = new sql.ConnectionPool(configIntegra)
  .connect()
  .then(pool => {
    console.log('✅ Conexão com INTEGRA_PRD estabelecida');
    return pool;
  })
  .catch(err => {
    console.warn('⚠️ Aviso: Não foi possível conectar ao INTEGRA_PRD:', err.message);
    console.warn('⚠️ Funcionalidades que dependem do INTEGRA_PRD podem não funcionar.');
    // Não rejeitar completamente - permitir que o sistema continue funcionando
    // A conexão será tentada novamente quando necessário
    return null;
  });

module.exports = {
  sql,
  poolPromise,
  poolIntegraPromise
};