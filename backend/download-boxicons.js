// Script para baixar o Boxicons CSS
// Execute: node backend/download-boxicons.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css';
const outputPath = path.join(__dirname, 'public', 'css', 'boxicons.min.css');

console.log('Baixando Boxicons CSS...');
console.log('URL:', url);
console.log('Destino:', outputPath);

https.get(url, (response) => {
  if (response.statusCode !== 200) {
    console.error(`Erro: Status ${response.statusCode}`);
    process.exit(1);
  }

  const fileStream = fs.createWriteStream(outputPath);
  response.pipe(fileStream);

  fileStream.on('finish', () => {
    fileStream.close();
    console.log('✅ Boxicons CSS baixado com sucesso!');
    console.log('Arquivo salvo em:', outputPath);
  });
}).on('error', (err) => {
  console.error('❌ Erro ao baixar:', err.message);
  console.log('\n💡 Solução alternativa:');
  console.log('1. Acesse: https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css');
  console.log('2. Salve o conteúdo no arquivo:', outputPath);
  process.exit(1);
});

