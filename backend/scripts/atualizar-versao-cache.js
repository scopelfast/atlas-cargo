// ============================================
// Script para Atualizar Versão do Cache Buster
// ============================================
// Execute este script antes de fazer deploy para atualizar a versão
// Isso força o navegador a buscar novas versões dos arquivos
// ============================================

const fs = require('fs');
const path = require('path');

// Gerar versão baseada em timestamp atual
const agora = new Date();
const versao = agora.getFullYear().toString() +
               String(agora.getMonth() + 1).padStart(2, '0') +
               String(agora.getDate()).padStart(2, '0') +
               String(agora.getHours()).padStart(2, '0') +
               String(agora.getMinutes()).padStart(2, '0');

console.log('============================================');
console.log('Atualizando versão do Cache Buster...');
console.log('============================================');
console.log(`Nova versão: ${versao}`);
console.log(`Data/Hora: ${agora.toLocaleString('pt-BR')}`);
console.log('');

// Caminho do arquivo cache-buster.js
const cacheBusterPath = path.join(__dirname, '../public/js/cache-buster.js');

try {
  // Ler o arquivo
  let conteudo = fs.readFileSync(cacheBusterPath, 'utf8');
  
  // Substituir a versão
  const regex = /const APP_VERSION = '(\d+)';/;
  const novoConteudo = conteudo.replace(regex, `const APP_VERSION = '${versao}';`);
  
  // Salvar o arquivo
  fs.writeFileSync(cacheBusterPath, novoConteudo, 'utf8');
  
  console.log('✅ Arquivo cache-buster.js atualizado com sucesso!');
  console.log('');
  console.log('📋 Próximos passos:');
  console.log('1. Faça commit das alterações');
  console.log('2. Faça deploy para o servidor');
  console.log('3. Os usuários receberão automaticamente a nova versão');
  console.log('');
  
} catch (err) {
  console.error('❌ Erro ao atualizar versão:', err.message);
  process.exit(1);
}

