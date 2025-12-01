// backend/server.js
// Carregar variáveis de ambiente PRIMEIRO, antes de qualquer outro módulo
const path = require('path');
const dotenv = require('dotenv');

// Carregar .env do diretório atual (backend/)
const envPath = path.join(__dirname, '.env');
const result = dotenv.config({ path: envPath });

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
  console.error('\n📝 Crie um arquivo .env na pasta backend/ com as seguintes variáveis:');
  console.error('   DB_SERVER=seu-servidor-sql');
  console.error('   DB_DATABASE=nome-do-banco');
  console.error('   DB_USER=usuario');
  console.error('   DB_PASSWORD=senha');
  console.error('   JWT_SECRET=sua-chave-secreta-jwt');
  console.error('\n💡 Veja o arquivo .env.example para um exemplo completo.\n');
  process.exit(1);
}

// Validar JWT_SECRET tem tamanho mínimo
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.warn('⚠️  AVISO: JWT_SECRET deve ter pelo menos 32 caracteres para segurança.');
  console.warn('   Recomendado: Use uma string aleatória de pelo menos 32 caracteres.');
}

const app = require('./app');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
  console.log(`📊 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  
});