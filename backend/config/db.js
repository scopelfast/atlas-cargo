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

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    return pool;
  })
  .catch(err => {
    console.error('❌ Erro na conexão com SQL Server:', err);
    console.warn('⚠️ Servidor continuará rodando, mas funcionalidades do banco não estarão disponíveis.');
    console.warn('⚠️ Verifique se o servidor SQL está acessível e as credenciais estão corretas.');
    // Não matar o servidor - permitir que continue para testar interface
    // Em produção, você pode querer process.exit(1) aqui
    // Por enquanto, retornamos uma promise rejeitada que pode ser tratada
    return Promise.reject(err);
  });

module.exports = {
  sql,
  poolPromise
};