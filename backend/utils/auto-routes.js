// backend/utils/auto-routes.js
// Sistema automático de rotas para arquivos HTML
// Detecta automaticamente arquivos HTML e cria rotas baseadas na estrutura de pastas

const fs = require('fs');
const path = require('path');

/**
 * Escaneia recursivamente a pasta public procurando arquivos HTML
 * e retorna um mapa de rotas -> arquivos
 */
function scanHtmlFiles(publicPath, baseRoute = '') {
  const routes = {};
  
  try {
    const items = fs.readdirSync(publicPath, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(publicPath, item.name);
      const routePath = baseRoute ? `${baseRoute}/${item.name}` : `/${item.name}`;
      
      if (item.isDirectory()) {
        // Ignorar pastas específicas que não devem gerar rotas
        const ignoredDirs = ['css', 'js', 'img', 'uploads', 'sql'];
        if (!ignoredDirs.includes(item.name.toLowerCase())) {
          // Recursão para subpastas
          const subRoutes = scanHtmlFiles(fullPath, routePath);
          Object.assign(routes, subRoutes);
        }
      } else if (item.isFile() && item.name.endsWith('.html')) {
        // Remover extensão .html da rota
        const route = routePath.replace(/\.html$/, '');
        
        // Casos especiais:
        // - index.html na raiz vira '/' (já tratado separadamente)
        // - index.html em subpastas vira o nome da pasta
        if (item.name === 'index.html') {
          if (baseRoute) {
            // index.html em subpasta: /modulos/gerenciar-equipamentos/index.html -> /modulos/gerenciar-equipamentos
            routes[baseRoute] = fullPath;
          }
          // index.html na raiz é tratado separadamente (não adicionar aqui)
        } else {
          // Outros arquivos HTML: dashboard.html -> /dashboard
          routes[route] = fullPath;
        }
      }
    }
  } catch (error) {
    console.error(`Erro ao escanear ${publicPath}:`, error.message);
  }
  
  return routes;
}

/**
 * Configura rotas automáticas para arquivos HTML
 * @param {Express} app - Instância do Express
 * @param {string} publicPath - Caminho para a pasta public
 * @param {Object} specialRoutes - Rotas especiais que sobrescrevem o comportamento padrão
 */
function setupAutoRoutes(app, publicPath, specialRoutes = {}) {
  // Rotas especiais padrão
  const defaultSpecialRoutes = {
    '/': path.join(publicPath, 'index.html'),        // Raiz serve index.html
    '/login': path.join(publicPath, 'index.html'),    // /login também serve index.html
    '/convocacao/:id': path.join(publicPath, 'convocacao.html'), // Rota com parâmetro
  };
  
  // Mesclar rotas especiais padrão com as fornecidas
  const allSpecialRoutes = { ...defaultSpecialRoutes, ...specialRoutes };
  
  // Escanear arquivos HTML
  const htmlRoutes = scanHtmlFiles(publicPath);
  
  console.log('🔍 Rotas HTML detectadas automaticamente:');
  
  let routesCount = 0;
  
  // Configurar rotas especiais primeiro (têm prioridade)
  for (const [route, filePath] of Object.entries(allSpecialRoutes)) {
    // Resolver caminho absoluto
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(publicPath, filePath);
    
    if (fs.existsSync(absolutePath)) {
      // Registrar a rota
      app.get(route, (req, res) => {
        console.log(`🔍 [ROTA] ${route} chamada - servindo: ${absolutePath}`);
        // Headers para evitar cache em desenvolvimento
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(absolutePath, (err) => {
          if (err) {
            console.error(`❌ Erro ao servir ${route}:`, err.message);
            console.error(`   Caminho tentado: ${absolutePath}`);
            if (!res.headersSent) {
              res.status(500).send('Erro ao carregar página');
            }
          } else {
            console.log(`✅ ${route} servido com sucesso`);
          }
        });
      });
      console.log(`  ✅ ${route} -> ${path.relative(publicPath, absolutePath)}`);
      routesCount++;
    } else {
      console.warn(`  ⚠️  Rota especial não encontrada: ${route} -> ${absolutePath}`);
    }
  }
  
  // Configurar rotas automáticas (exceto as que já foram configuradas como especiais)
  for (const [route, filePath] of Object.entries(htmlRoutes)) {
    // Pular rotas que já foram configuradas como especiais
    if (allSpecialRoutes.hasOwnProperty(route)) {
      continue;
    }
    
    // Resolver caminho absoluto
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(publicPath, filePath);
    
    // Verificar se o arquivo existe
    if (fs.existsSync(absolutePath)) {
      app.get(route, (req, res) => {
        // Headers para evitar cache em desenvolvimento
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(absolutePath, (err) => {
          if (err) {
            console.error(`Erro ao servir ${route}:`, err.message);
            if (!res.headersSent) {
              res.status(500).send('Erro ao carregar página');
            }
          }
        });
      });
      console.log(`  ✅ ${route} -> ${path.relative(publicPath, absolutePath)}`);
      routesCount++;
    }
  }
  
  console.log(`\n📦 Total de rotas HTML configuradas: ${routesCount}\n`);
}

module.exports = {
  scanHtmlFiles,
  setupAutoRoutes
};

