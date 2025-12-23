// backend/app.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const authRoutes = require('./routes/auth.routes');
const menuRoutes = require('./routes/menu.routes');
const marcasRoutes = require('./routes/marcas.routes');
const grupoRoutes = require('./routes/grupo.routes');
const classeFrotaRoutes = require('./routes/classefrota.routes');
const tipoViagemRoutes = require('./routes/tipoviagem.routes');
const situacaoViagemRoutes = require('./routes/situacaoviagem.routes');
const tipoEquipamentoRoutes = require('./routes/tipoequipamento.routes');
const modeloEquipamentoRoutes = require('./routes/modeloequipamento.routes');
const equipamentoRoutes = require('./routes/equipamento.routes');
const cidadesRoutes = require('./routes/cidades.routes');
const roteirosRoutes = require('./routes/roteiros.routes');
const estadosRoutes = require('./routes/estados.routes');
const cadastroGeralRoutes = require('./routes/cadastrogeral.routes');
const viagemRoutes = require('./routes/viagemmestre.routes');
const tipoValidadeRoutes = require('./routes/tipovalidade.routes');
const controleValidadeRoutes = require('./routes/controlevalidade.routes');
const empresaRoutes = require('./routes/empresa.routes');
const filialRoutes = require('./routes/filial.routes');
const relatorioConvocacoesRoutes = require('./routes/relatorio-convocacoes.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const tipoAtividadeRoutes = require('./routes/tipoatividade.routes');
const motoristaAppRoutes = require('./routes/motorista-app.routes');
const usuariologacaoRoutes = require('./routes/usuariologacao.routes');
const logsAcessoRoutes = require('./routes/logs-acesso.routes');
const mapaViagemRoutes = require('./routes/mapa-viagem.routes');
const alertRoutes = require('./routes/alert.routes');
const messageRoutes = require('./routes/message.routes');
const sosRoutes = require('./routes/sos.routes');
const reputationRoutes = require('./routes/reputation.routes');

const app = express();

// Inicializar Cache Service (após criar app)
const { getCacheService } = require('./services/cache.service');
let cacheService = getCacheService();
app.set('cacheService', cacheService);

// Configurar trust proxy para capturar IP real quando há proxy reverso (nginx, etc)
// Isso permite que req.ip funcione corretamente com X-Forwarded-For
app.set('trust proxy', true);

// Middleware de segurança
// Em desenvolvimento, desabilitar headers que requerem HTTPS ou localhost
const isDevelopment = process.env.NODE_ENV !== 'production';

// ============================================
// CONSTANTES DE URL - Configuração Centralizada
// ============================================
// Todas as URLs são definidas aqui. Ao alterar estas constantes,
// todas as rotas serão atualizadas automaticamente.
const URL_CONFIG = {
  // Servidores de teste (Beta)
  BETA: {
    HTTP: 'beta.integrabrasil.com:8080',
    HTTPS: 'beta.integrabrasil.com:8443'
  },
  // Servidores de produção (App)
  APP: {
    HTTP: 'app.integrabrasil.com:8080',
    HTTPS: 'app.integrabrasil.com:8443'
  },
  // Rotas específicas (sempre terminam com /)
  ROUTES: {
    CARGAS: 'cargas/',
    NOMINATIM: 'nominatim/',
    ORS: 'ors/'
  }
};

// URLs completas para cada ambiente (exemplo de uso - não usado no CSP mas disponível)
// Nota: Estas URLs são construídas mas não são usadas no CSP diretamente,
// pois o CSP precisa de variações com protocolos (http/https/ws/wss)
const URLS = {
  BETA_HTTP: {
    base: `http://${URL_CONFIG.BETA.HTTP}/${URL_CONFIG.ROUTES.CARGAS}`,
    nominatim: `http://${URL_CONFIG.BETA.HTTP}/${URL_CONFIG.ROUTES.NOMINATIM}`,
    ors: `http://${URL_CONFIG.BETA.HTTP}/${URL_CONFIG.ROUTES.ORS}`
  },
  BETA_HTTPS: {
    base: `https://${URL_CONFIG.BETA.HTTPS}/${URL_CONFIG.ROUTES.CARGAS}`,
    nominatim: `http://${URL_CONFIG.BETA.HTTPS}/${URL_CONFIG.ROUTES.NOMINATIM}`,
    ors: `http://${URL_CONFIG.BETA.HTTPS}/${URL_CONFIG.ROUTES.ORS}`
  },
  APP_HTTP: {
    base: `http://${URL_CONFIG.APP.HTTP}/${URL_CONFIG.ROUTES.CARGAS}`,
    nominatim: `http://${URL_CONFIG.APP.HTTP}/${URL_CONFIG.ROUTES.NOMINATIM}`,
    ors: `http://${URL_CONFIG.APP.HTTP}/${URL_CONFIG.ROUTES.ORS}`
  },
  APP_HTTPS: {
    base: `https://${URL_CONFIG.APP.HTTPS}/${URL_CONFIG.ROUTES.CARGAS}`,
    nominatim: `http://${URL_CONFIG.APP.HTTPS}/${URL_CONFIG.ROUTES.NOMINATIM}`,
    ors: `http://${URL_CONFIG.APP.HTTPS}/${URL_CONFIG.ROUTES.ORS}`
  }
};

// Função para gerar todas as variações de URL para CSP (com protocolos)
const getAllCSPUrls = () => {
  const urls = [];
  
  // Beta HTTP e HTTPS
  urls.push(`http://${URL_CONFIG.BETA.HTTP}`, `https://${URL_CONFIG.BETA.HTTPS}`);
  urls.push(`ws://${URL_CONFIG.BETA.HTTP}`, `wss://${URL_CONFIG.BETA.HTTPS}`);
  
  // App HTTP e HTTPS
  urls.push(`http://${URL_CONFIG.APP.HTTP}`, `https://${URL_CONFIG.APP.HTTPS}`);
  urls.push(`ws://${URL_CONFIG.APP.HTTP}`, `wss://${URL_CONFIG.APP.HTTPS}`);
  
  // URLs com wildcard de porta para maior flexibilidade
  urls.push(`http://${URL_CONFIG.BETA.HTTP.split(':')[0]}:*`);
  urls.push(`https://${URL_CONFIG.BETA.HTTPS.split(':')[0]}:*`);
  urls.push(`ws://${URL_CONFIG.BETA.HTTP.split(':')[0]}:*`);
  urls.push(`wss://${URL_CONFIG.BETA.HTTPS.split(':')[0]}:*`);
  
  urls.push(`http://${URL_CONFIG.APP.HTTP.split(':')[0]}:*`);
  urls.push(`https://${URL_CONFIG.APP.HTTPS.split(':')[0]}:*`);
  urls.push(`ws://${URL_CONFIG.APP.HTTP.split(':')[0]}:*`);
  urls.push(`wss://${URL_CONFIG.APP.HTTPS.split(':')[0]}:*`);
  
  return urls;
};

// Função para gerar URLs de Nominatim usando as constantes
// NOTA: Nominatim e ORS estão disponíveis APENAS no servidor de produção (APP), não no beta
const getNominatimUrls = () => {
  const urls = [];
  // Nominatim: url/nominatim/ (sempre HTTP na porta 8080, apenas produção)
  urls.push(`http://${URL_CONFIG.APP.HTTP}/${URL_CONFIG.ROUTES.NOMINATIM}`);
  return urls;
};

// Função para gerar URLs de ORS usando as constantes
// NOTA: Nominatim e ORS estão disponíveis APENAS no servidor de produção (APP), não no beta
const getORSUrls = () => {
  const urls = [];
  // ORS: url/ors/ (sempre HTTP na porta 8080, apenas produção)
  urls.push(`http://${URL_CONFIG.APP.HTTP}/${URL_CONFIG.ROUTES.ORS}`);
  return urls;
};

const CSP_URLS = getAllCSPUrls();

// Configuração do Helmet - CSP mais permissivo em desenvolvimento
const helmetConfig = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com"
      ],
      styleSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://unpkg.com" // Para Leaflet CSS
      ],
      fontSrc: [
        "'self'",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net", // Para fontes do boxicons
        "https://unpkg.com", // Para fontes do boxicons
        "data:"
      ],
      scriptSrc: [
        "'self'",
        "'unsafe-inline'",
        "'unsafe-eval'",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com" // Para Leaflet JS
      ],
      scriptSrcAttr: [
        "'unsafe-inline'" // Permitir event handlers inline (onclick, onload, etc)
      ],
      imgSrc: [
        "'self'",
        "data:",
        "https:",
        "http:",
        "blob:",
        "https://*.tile.openstreetmap.org",
        "https://tile.openstreetmap.org",
        // Em desenvolvimento, permitir HTTP em localhost
        ...(isDevelopment ? [
          "http://localhost:*",
          "http://127.0.0.1:*"
        ] : [])
      ],
      connectSrc: [
        "'self'",
        // URLs locais (apenas para desenvolvimento local)
        "http://localhost:*",
        "ws://localhost:*",
        "http://127.0.0.1:*",
        // URLs geradas dinamicamente a partir de URL_CONFIG (Beta e App)
        ...CSP_URLS, // URLs base de Beta e App (HTTP/HTTPS/WS/WSS) geradas dinamicamente
        ...getNominatimUrls(), // URLs de Nominatim (app.integrabrasil.com:8080/nominatim/) - apenas produção
        ...getORSUrls(), // URLs de ORS (app.integrabrasil.com:8080/ors/) - apenas produção
        // Serviços externos/CDN
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com", // Para Leaflet source maps
        // Servidores públicos de mapas/roteamento (fallback)
        "https://router.project-osrm.org", // Para cálculo de rotas no mapa
        "https://routing.openstreetmap.de", // Servidor alternativo de roteamento
        "https://nominatim.openstreetmap.org", // Para geocodificação reversa (servidor público fallback)
        "https://a.tile.openstreetmap.org", // Para tiles do OpenStreetMap
        "https://b.tile.openstreetmap.org", // Para tiles do OpenStreetMap
        "https://c.tile.openstreetmap.org", // Para tiles do OpenStreetMap
        "https://tile.openstreetmap.org" // Para tiles do OpenStreetMap (fallback)
      ],
      formAction: [
        "'self'",
        `http://${URL_CONFIG.BETA.HTTP}`, // Servidor beta (HTTP) - gerado dinamicamente
        `https://${URL_CONFIG.BETA.HTTPS}`, // Servidor beta (HTTPS) - gerado dinamicamente
        `http://${URL_CONFIG.APP.HTTP}`, // Servidor app (HTTP) - gerado dinamicamente
        `https://${URL_CONFIG.APP.HTTPS}` // Servidor app (HTTPS) - gerado dinamicamente
      ],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"]
    }
  }
};

// Em desenvolvimento, desabilitar headers restritivos e tornar CSP mais permissivo
if (isDevelopment) {
  helmetConfig.crossOriginOpenerPolicy = false;
  helmetConfig.crossOriginEmbedderPolicy = false;
  helmetConfig.originAgentCluster = false;
  helmetConfig.strictTransportSecurity = false;
  
  // Em desenvolvimento, permitir conexões HTTP locais sem restrições
  // Nota: "*" não funciona no CSP, então usamos faixas de IP específicas
  // As faixas já foram adicionadas acima (192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12)
}

app.use(helmet(helmetConfig));

// Middleware para redirecionar HTTPS para HTTP em desenvolvimento
if (isDevelopment) {
  app.use((req, res, next) => {
    // Remover qualquer header que possa forçar HTTPS
    res.removeHeader('Strict-Transport-Security');
    res.removeHeader('Upgrade-Insecure-Requests');
    
    // Se a requisição vier via HTTPS em desenvolvimento, redirecionar para HTTP
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
      const host = req.get('host');
      const url = req.url;
      const httpUrl = `http://${host}${url}`;
      console.warn(`⚠️ [DEV] Redirecionando HTTPS → HTTP: ${req.protocol}://${host}${url} → ${httpUrl}`);
      return res.redirect(301, httpUrl);
    }
    
    // Adicionar header para indicar que estamos forçando HTTP
    res.setHeader('X-Force-HTTP', 'true');
    
    next();
  });
}

// Compressão HTTP para reduzir tamanho das respostas (JSON, HTML, CSS, JS)
app.use(compression());

// Configurar CORS para permitir acesso via IP local em desenvolvimento
const corsOptions = {
  origin: function (origin, callback) {
    // Em desenvolvimento, permitir qualquer origem (localhost, IP local, etc)
    if (isDevelopment || !origin) {
      callback(null, true);
    } else {
      // Em produção, validar origem
      callback(null, true); // Por enquanto permitir todas, ajustar depois se necessário
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
};
app.use(cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rotas de API (ANTES do express.static para garantir prioridade)
// Definir todas as rotas de API primeiro
const apiRoutes = [
  { path: '/api/auth', route: authRoutes },
  { path: '/api/menu', route: menuRoutes },
  { path: '/api', route: marcasRoutes },
  { path: '/api', route: grupoRoutes },
  { path: '/api', route: classeFrotaRoutes },
  { path: '/api', route: tipoViagemRoutes },
  { path: '/api', route: situacaoViagemRoutes },
  { path: '/api', route: tipoEquipamentoRoutes },
  { path: '/api', route: modeloEquipamentoRoutes },
  { path: '/api', route: equipamentoRoutes },
  { path: '/api', route: cidadesRoutes },
  { path: '/api', route: roteirosRoutes },
  { path: '/api', route: estadosRoutes },
  { path: '/api', route: cadastroGeralRoutes },
  { path: '/api', route: viagemRoutes },
  { path: '/api', route: tipoValidadeRoutes },
  { path: '/api', route: controleValidadeRoutes },
  { path: '/api', route: empresaRoutes },
  { path: '/api', route: filialRoutes },
  { path: '/api/relatorio-convocacoes', route: relatorioConvocacoesRoutes },
  { path: '/api', route: usuarioRoutes },
  { path: '/api', route: tipoAtividadeRoutes },
  { path: '/api/motorista', route: motoristaAppRoutes },
  { path: '/api/log', route: usuariologacaoRoutes },
  { path: '/api/logs-acesso', route: logsAcessoRoutes },
  { path: '/api/mapa-viagem', route: mapaViagemRoutes },
  { path: '/api/alerts', route: alertRoutes },
  { path: '/api/alertas', route: alertRoutes }, // Alias para módulo separado
  { path: '/api/messages', route: messageRoutes },
  { path: '/api/chat', route: messageRoutes }, // Alias para módulo separado
  { path: '/api/sos', route: sosRoutes }, // Rotas do módulo SOS
  { path: '/api/reputation', route: reputationRoutes },
  { path: '/api/ranking', route: reputationRoutes } // Alias para módulo separado
];

// Registrar rotas na raiz /api/...
apiRoutes.forEach(({ path, route }) => {
  app.use(path, route);
});

// Registrar as mesmas rotas no caminho /cargas/api/... (para quando acessado via subdiretório)
apiRoutes.forEach(({ path, route }) => {
  const cargasPath = path.replace('/api', '/cargas/api');
  app.use(cargasPath, route);
});

// Rotas específicas de páginas HTML (ANTES do express.static)
// Rota pública para motorista responder convocação
app.get('/convocacao/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'convocacao.html'));
});

// Rota para página de teste mobile
app.get('/teste-mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teste-mobile.html'));
});

// Rota para dashboard
app.get('/dashboard', (req, res) => {
  // Adicionar headers para garantir que não há cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota alternativa para dashboard.html (compatibilidade)
app.get('/dashboard.html', (req, res) => {
  // Adicionar headers para garantir que não há cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota para login: serve o index.html (login)
app.get('/login', (req, res) => {
  // Adicionar headers para garantir que não há cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota raiz: serve o index.html (login)
app.get('/', (req, res) => {
  // Adicionar headers para garantir que não há cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Servir arquivos estáticos da pasta 'public'
// IMPORTANTE: Colocado DEPOIS das rotas específicas para não interferir
// Configurar headers corretos para arquivos estáticos
const fs = require('fs');

// Função para configurar headers corretos dos arquivos estáticos
const staticHeaders = (res, filePath, stat) => {
  // Garantir que arquivos CSS tenham o Content-Type correto (crítico para produção)
  if (filePath.endsWith('.css')) {
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
  }
  // Garantir que arquivos JS tenham o Content-Type correto
  if (filePath.endsWith('.js')) {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  }
  // Garantir que arquivos HTML tenham o Content-Type correto
  if (filePath.endsWith('.html')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
  }
  
  // Cache otimizado - evita problemas de versão antiga
  if (isDevelopment) {
    // DESENVOLVIMENTO: Desabilitar cache completamente para garantir sempre a última versão
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // Adicionar ETag baseado no timestamp do arquivo para forçar validação
    if (stat && stat.mtime) {
      const etag = `"dev-${stat.mtime.getTime()}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', stat.mtime.toUTCString());
    }
  } else {
    // PRODUÇÃO: Cache inteligente com validação
    if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
      // CSS e JS: Cache curto com validação ETag
      // O cache-buster.js adiciona ?v=timestamp no frontend
      // Aqui configuramos cache curto mas com validação para garantir atualizações
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate'); // 1 hora com validação
      // Sempre adicionar ETag para validação
      if (stat && stat.mtime) {
        const etag = `"${stat.mtime.getTime()}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
      }
    } else if (filePath.endsWith('.html')) {
      // HTML: SEM cache (sempre atualizado)
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      // Adicionar ETag para validação
      if (stat && stat.mtime) {
        const etag = `"html-${stat.mtime.getTime()}"`;
        res.setHeader('ETag', etag);
        res.setHeader('Last-Modified', stat.mtime.toUTCString());
      }
    } else if (filePath.endsWith('.png') || filePath.endsWith('.jpg') || 
               filePath.endsWith('.jpeg') || filePath.endsWith('.gif') || 
               filePath.endsWith('.ico') || filePath.endsWith('.svg')) {
      // Imagens: cache longo (raramente mudam)
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable'); // 1 dia
    } else {
      // Outros arquivos: cache curto com validação
      res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate'); // 1 hora
    }
  }
};

// Servir arquivos estáticos na raiz
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: staticHeaders
}));

// Servir arquivos estáticos no caminho /cargas/ (para quando acessado via subdiretório)
// Isso permite que /cargas/css/style.css funcione corretamente
app.use('/cargas', express.static(path.join(__dirname, 'public'), {
  setHeaders: staticHeaders
}));

// Adicionar rota específica para /cargas/ (serve index.html)
app.get('/cargas', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/cargas/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Rota de teste para verificar se arquivos estáticos estão sendo servidos
app.get('/test-css', (req, res) => {
  const cssPath = path.join(__dirname, 'public', 'css', 'style.css');
  res.sendFile(cssPath, (err) => {
    if (err) {
      res.status(404).send(`CSS não encontrado: ${cssPath}`);
    }
  });
});

// Rota para servir manifest.json do motorista com caminhos corrigidos
app.get(['/motorista/manifest.json', '/cargas/motorista/manifest.json'], (req, res) => {
  const fs = require('fs');
  const manifestPath = path.join(__dirname, 'public', 'motorista', 'manifest.json');
  
  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    
    // Detectar caminho base da requisição usando originalUrl ou path
    // originalUrl inclui o caminho completo, path pode não incluir
    const requestPath = req.originalUrl || req.path || req.url;
    // Detectar se está em /cargas/motorista/manifest.json
    let pathBase = '';
    if (requestPath && requestPath.includes('/cargas/motorista/manifest.json')) {
      pathBase = '/cargas';
    }
    
    console.log('📦 [MANIFEST] Request path:', requestPath);
    console.log('📦 [MANIFEST] Detected pathBase:', pathBase || '(raiz)');
    console.log('📦 [MANIFEST] Full request object:', {
      originalUrl: req.originalUrl,
      path: req.path,
      url: req.url,
      baseUrl: req.baseUrl
    });
    
    // Corrigir start_url
    if (manifest.start_url) {
      // Se start_url já começa com /, adicionar pathBase antes
      manifest.start_url = pathBase + (manifest.start_url.startsWith('/') ? manifest.start_url : '/' + manifest.start_url);
    }
    
    // Corrigir ícones
    if (manifest.icons && Array.isArray(manifest.icons)) {
      manifest.icons = manifest.icons.map(icon => {
        // Se src começa com /, adicionar pathBase antes
        const iconSrc = icon.src.startsWith('/') ? pathBase + icon.src : pathBase + '/' + icon.src;
        return {
          ...icon,
          src: iconSrc
        };
      });
    }
    
    console.log('📦 [MANIFEST] Icons corrigidos:', manifest.icons);
    
    res.setHeader('Content-Type', 'application/manifest+json');
    res.json(manifest);
  } catch (err) {
    console.error('Erro ao ler manifest.json:', err);
    res.status(404).send('Manifest não encontrado');
  }
});

// Qualquer outra rota não encontrada → redireciona para frontend (SPA-friendly)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Inicializar Cache Service (após tudo configurado)
try {
  const { getCacheService } = require('./services/cache.service');
  cacheService = getCacheService();
  app.set('cacheService', cacheService);
  console.log('✅ Cache Service inicializado');
} catch (err) {
  console.warn('⚠️ Erro ao inicializar Cache Service:', err.message);
}

module.exports = app;
