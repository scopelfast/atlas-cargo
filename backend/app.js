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
const tipoOcorrenciaRoutes = require('./routes/tipoocorrencia.routes');
const tipoEquipamentoRoutes = require('./routes/tipoequipamento.routes');
const modeloEquipamentoRoutes = require('./routes/modeloequipamento.routes');
const equipamentoRoutes = require('./routes/equipamento.routes');
const mesorregiaoRoutes = require('./routes/mesorregiao.routes');
const cidadesRoutes = require('./routes/cidades.routes');
const roteirosRoutes = require('./routes/roteiros.routes');
const estadoRoutes = require('./routes/estado.routes');
const estadosRoutes = require('./routes/estados.routes');
const cadastroGeralRoutes = require('./routes/cadastrogeral.routes');
const viagemRoutes = require('./routes/viagemmestre.routes');
const viagemPublicRoutes = require('./routes/viagem-public.routes');
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
const configRoutes = require('./routes/config.routes');
const saasAdminRoutes = require('./routes/saas-admin.routes');
const oportunidadesCampanhasRoutes = require('./routes/oportunidades-campanhas.routes');
const wmsCadastroRoutes = require('./routes/wms-cadastro.routes');
const wmsRecebimentoRoutes = require('./routes/wms-recebimento.routes');
const wmsSeparacaoRoutes = require('./routes/wms-separacao.routes');
const wmsCargaRoutes = require('./routes/wms-carga.routes');
const wmsExpedicaoRoutes = require('./routes/wms-expedicao.routes');
const wmsRelatoriosRoutes = require('./routes/wms-relatorios.routes');
const wmsInventarioRoutes = require('./routes/wms-inventario.routes');
const wmsDashboardRoutes = require('./routes/wms-dashboard.routes');
const wmsTransferenciaRoutes = require('./routes/wms-transferencia-dono.routes');
const wmsBaixaEstoqueRoutes = require('./routes/wms-baixa-estoque.routes');
const wmsDiagnosticoSkuRoutes = require('./routes/wms-diagnostico-sku.routes');
const wmsAuditoriaSaudeRoutes = require('./routes/wms-auditoria-saude.routes');
const wmsReservasOplRoutes = require('./routes/wms-reservas-opl.routes');

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

// Nominatim/ORS no front vêm de Configurações (DB); CSP cobre ...CSP_URLS e mirrors públicos.

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
        "blob:", // Scripts carregados via fetch+blob no dashboard (ex.: gerenciar-viagens)
        "https://cdn.jsdelivr.net",
        "https://unpkg.com", // Para Leaflet JS
        "https://static.cloudflareinsights.com" // Beacon do Cloudflare (analytics)
      ],
      scriptSrcElem: [
        "'self'",
        "'unsafe-inline'",
        "blob:",
        "https://cdn.jsdelivr.net",
        "https://unpkg.com",
        "https://static.cloudflareinsights.com" // Beacon do Cloudflare (carregado como <script src="...">)
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
        "http://186.250.92.131:*", // stack de mapas próprio (Nominatim/ORS em outro host)
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
        "https://tile.openstreetmap.org", // Para tiles do OpenStreetMap (fallback)
        // Tesseract.js OCR (cadastro motorista - foto documento)
        "data:",
        "blob:",
        "https://tessdata.projectnaptha.com",
        "https://cdn.jsdelivr.net/npm/tesseract.js@4/"
      ],
      formAction: [
        "'self'",
        `http://${URL_CONFIG.BETA.HTTP}`, // Servidor beta (HTTP) - gerado dinamicamente
        `https://${URL_CONFIG.BETA.HTTPS}`, // Servidor beta (HTTPS) - gerado dinamicamente
        `http://${URL_CONFIG.APP.HTTP}`, // Servidor app (HTTP) - gerado dinamicamente
        `https://${URL_CONFIG.APP.HTTPS}` // Servidor app (HTTPS) - gerado dinamicamente
      ],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      // Helmet (useDefaults) inclui upgrade-insecure-requests nos defaults; isso faz o
      // navegador reescrever TODO pedido para https:// mesmo com página em http://IP:porta.
      // Servidor só em HTTP → net::ERR_SSL_PROTOCOL_ERROR. Desabilitar sempre aqui;
      // em produção com HTTPS real o site já é servido em TLS (não depende desta diretiva).
      upgradeInsecureRequests: null
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

// Interceptar setHeader para injetar Cloudflare no CSP (antes do Helmet definir o header)
app.use((req, res, next) => {
  const origSetHeader = res.setHeader.bind(res);
  res.setHeader = function (name, value) {
    if (name.toLowerCase() === 'content-security-policy' && typeof value === 'string' && !/static\.cloudflareinsights\.com/i.test(value)) {
      value = value
        .replace(/(\bscript-src\s+)([^;]+)(;)/gi, (_, p, list, s) => p + list.trim() + ' https://static.cloudflareinsights.com' + s)
        .replace(/(\bscript-src-elem\s+)([^;]+)(;)/gi, (_, p, list, s) => p + list.trim() + ' https://static.cloudflareinsights.com' + s);
    }
    return origSetHeader(name, value);
  };
  next();
});

app.use(helmet(helmetConfig));

// Middleware para redirecionar HTTPS para HTTP em desenvolvimento (apenas quando NÃO há proxy)
// Com Cloudflare/proxy: NÃO redirecionar quando x-forwarded-proto existe, senão causa ERR_TOO_MANY_REDIRECTS
if (isDevelopment) {
  app.use((req, res, next) => {
    res.removeHeader('Strict-Transport-Security');
    res.removeHeader('Upgrade-Insecure-Requests');
    const viaProxy = req.get('x-forwarded-proto');
    // Só redirecionar se a conexão direta com o Node for HTTPS (req.secure), não quando o proxy disse que o cliente usou HTTPS
    if (!viaProxy && req.secure) {
      const host = req.get('host');
      const url = req.url;
      const httpUrl = `http://${host}${url}`;
      console.warn(`⚠️ [DEV] Redirecionando HTTPS → HTTP: ${req.protocol}://${host}${url} → ${httpUrl}`);
      return res.redirect(301, httpUrl);
    }
    if (!viaProxy) res.setHeader('X-Force-HTTP', 'true');
    next();
  });
}

// Compressão HTTP para reduzir tamanho das respostas (JSON, HTML, CSS, JS)
app.use(compression());

// CORS: em produção, defina CORS_ORIGINS (lista separada por vírgula) para restringir.
const corsAllowedList = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
let corsProdWarned = false;
const corsOptions = {
  origin: function (origin, callback) {
    if (isDevelopment || !origin) {
      callback(null, true);
      return;
    }
    if (corsAllowedList.length === 0) {
      if (!corsProdWarned) {
        corsProdWarned = true;
        console.warn(
          '⚠️ Produção: CORS_ORIGINS vazio — qualquer origem com credenciais ainda é aceita. Defina CORS_ORIGINS no .env para restringir.'
        );
      }
      callback(null, true);
      return;
    }
    if (corsAllowedList.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'user-login']
};
app.use(cors(corsOptions));

const { blockExecutarInitSqlInProduction } = require('./middleware/security-hardening.middleware');
app.use(blockExecutarInitSqlInProduction);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Popular req.user a partir do JWT quando Authorization: Bearer <token> estiver presente
const { getUsuarioLogado, verifyTowerSessionNotRevoked } = require('./middleware/auth.middleware');
const { attachTenantContext } = require('./middleware/tenant.middleware');
app.use('/api', getUsuarioLogado);
app.use('/api', attachTenantContext);
app.use('/api', verifyTowerSessionNotRevoked);
app.use('/cargas/api', getUsuarioLogado);
app.use('/cargas/api', attachTenantContext);
app.use('/cargas/api', verifyTowerSessionNotRevoked);

// Rotas de API (ANTES do express.static para garantir prioridade)
// Ordem importa: prefixos específicos e rotas SEM router.use(towerAuth) global devem vir
// ANTES de qualquer app.use('/api', router) que aplique auth em todo o router — senão
// /api/motorista/login, /api/contexto e /api/configuracoes/* recebem 401 do primeiro /api genérico.
const apiRoutes = [
  // Convocação pública + combo motivos recusa + public-url — sem JWT torre (antes de routers com towerAuth em paths genéricos).
  { path: '/api', route: viagemPublicRoutes },
  { path: '/api/auth', route: authRoutes },
  { path: '/api/menu', route: menuRoutes },
  { path: '/api/saas', route: saasAdminRoutes },
  { path: '/api/motorista', route: motoristaAppRoutes },
  { path: '/api/log', route: usuariologacaoRoutes },
  // Config (GET /contexto, /configuracoes/mapa, identidade, etc.) ANTES de cidades/estado/viagem:
  // cidades e estado aplicam towerAuth em qualquer path que não tenha rota pública explícita; o i18n do app motorista
  // chama GET /api/contexto sem Bearer e recebia 401 antes de chegar em config.routes.
  { path: '/api', route: configRoutes },
  // Cidades + estado: rotas públicas (/paises, /estados-brasil, /estado-cduf, /mesorregioes, GET /estados?…).
  // DEVEM vir ANTES de viagemRoutes: o router de viagem aplica towerAuth em tudo que não passar no viagemPublicSkip;
  // se req.path variar (proxy/versão Express), GET /api/estados?pais=AR caía em 401 e o cadastro motorista só carregava UF para o Brasil (estados-brasil).
  { path: '/api', route: cidadesRoutes },
  { path: '/api', route: estadoRoutes },
  // Viagens: convocação pública, combos, etc. (viagemPublicSkip para alguns GET).
  { path: '/api', route: viagemRoutes },
  { path: '/api', route: oportunidadesCampanhasRoutes },
  { path: '/api', route: wmsCadastroRoutes },
  { path: '/api', route: wmsRecebimentoRoutes },
  { path: '/api', route: wmsSeparacaoRoutes },
  { path: '/api', route: wmsCargaRoutes },
  { path: '/api', route: wmsExpedicaoRoutes },
  { path: '/api', route: wmsRelatoriosRoutes },
  { path: '/api', route: wmsInventarioRoutes },
  { path: '/api', route: wmsDashboardRoutes },
  { path: '/api', route: wmsTransferenciaRoutes },
  { path: '/api', route: wmsBaixaEstoqueRoutes },
  { path: '/api', route: wmsDiagnosticoSkuRoutes },
  { path: '/api', route: wmsAuditoriaSaudeRoutes },
  { path: '/api', route: wmsReservasOplRoutes },
  { path: '/api/relatorio-convocacoes', route: relatorioConvocacoesRoutes },
  { path: '/api/logs-acesso', route: logsAcessoRoutes },
  { path: '/api/mapa-viagem', route: mapaViagemRoutes },
  { path: '/api/alerts', route: alertRoutes },
  { path: '/api/alertas', route: alertRoutes }, // Alias para módulo separado
  { path: '/api/messages', route: messageRoutes },
  { path: '/api/chat', route: messageRoutes }, // Alias para módulo separado
  { path: '/api/sos', route: sosRoutes }, // Rotas do módulo SOS
  { path: '/api/reputation', route: reputationRoutes },
  { path: '/api/ranking', route: reputationRoutes }, // Alias para módulo separado
  { path: '/api', route: tipoOcorrenciaRoutes },
  { path: '/api', route: marcasRoutes },
  { path: '/api', route: grupoRoutes },
  { path: '/api', route: classeFrotaRoutes },
  { path: '/api', route: tipoViagemRoutes },
  { path: '/api', route: situacaoViagemRoutes },
  { path: '/api', route: tipoEquipamentoRoutes },
  { path: '/api', route: modeloEquipamentoRoutes },
  { path: '/api', route: equipamentoRoutes },
  { path: '/api', route: mesorregiaoRoutes },
  { path: '/api', route: roteirosRoutes },
  { path: '/api', route: estadosRoutes },
  { path: '/api', route: cadastroGeralRoutes },
  { path: '/api', route: tipoValidadeRoutes },
  { path: '/api', route: controleValidadeRoutes },
  { path: '/api', route: empresaRoutes },
  { path: '/api', route: filialRoutes },
  { path: '/api', route: usuarioRoutes },
  { path: '/api', route: tipoAtividadeRoutes }
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

// Página de chat do motorista (rotas explícitas para evitar cache/SW retornando página em branco)
const chatHtmlPath = path.join(__dirname, 'public', 'motorista', 'pages', 'chat.html');
const noCacheHeaders = (res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
};
app.get('/motorista/pages/chat.html', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(chatHtmlPath);
});
// URL alternativa para o chat (não costuma estar em cache do SW)
app.get('/motorista/chat', (req, res) => {
  noCacheHeaders(res);
  res.sendFile(chatHtmlPath);
});
// Chat fora de /motorista/ — Service Worker NÃO intercepta; use se a tela continuar em branco
app.get('/chat-motorista', (req, res) => {
  console.log('💬 [ROTA] GET /chat-motorista — enviando chat.html');
  noCacheHeaders(res);
  res.sendFile(chatHtmlPath);
});
// Página mínima de teste (sem CSS/JS externos) — confirma se a rota responde
app.get('/chat-motorista-minimal', (req, res) => {
  console.log('💬 [ROTA] GET /chat-motorista-minimal');
  noCacheHeaders(res);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chat Teste</title></head><body style="padding:20px;font-family:sans-serif;background:#e0f2fe;">
<h1>Chat (página mínima)</h1>
<p>Se você vê isto, a rota do servidor está OK.</p>
<p><a href="/chat-motorista-standalone?viagem=1">Abrir chat standalone</a></p>
</body></html>`);
});
// Chat standalone: uma única página, sem CSS/JS externos, sem SW (URL fora de /motorista/)
app.get('/chat-motorista-standalone', (req, res) => {
  console.log('💬 [ROTA] GET /chat-motorista-standalone');
  noCacheHeaders(res);
  res.sendFile(path.join(__dirname, 'public', 'motorista', 'pages', 'chat-standalone.html'));
});

// Atalho /m e /m/ -> redireciona para /motorista/ (app motorista no celular)
app.get(['/m', '/m/'], (req, res) => {
  res.redirect(302, '/motorista/');
});

// Manifest do motorista ANTES do express.static para evitar 403 (proxy/static)
const manifestPath = path.join(__dirname, 'public', 'motorista', 'manifest.json');
app.get(['/motorista/manifest.json', '/cargas/motorista/manifest.json'], (req, res) => {
  const fs = require('fs');
  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent);
    const requestPath = req.originalUrl || req.path || req.url;
    const pathBase = (requestPath && (requestPath.includes('/cargas/motorista/manifest.json') || requestPath.includes('/cargas/'))) ? '/cargas' : '';
    if (manifest.start_url) {
      manifest.start_url = pathBase + (manifest.start_url.startsWith('/') ? manifest.start_url : '/' + manifest.start_url);
    }
    if (manifest.icons && Array.isArray(manifest.icons)) {
      manifest.icons = manifest.icons.map(icon => {
        let iconSrc = icon.src;
        iconSrc = iconSrc.startsWith('/') ? pathBase + iconSrc : pathBase + '/' + iconSrc;
        return { ...icon, src: iconSrc };
      });
    }
    res.setHeader('Content-Type', 'application/manifest+json');
    res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    res.status(200).json(manifest);
  } catch (err) {
    console.error('Erro ao ler manifest.json:', err);
    res.status(404).send('Manifest não encontrado');
  }
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
  
  // Scripts de módulos: sempre no-cache para evitar "Identifier already been declared" ao trocar de tela
  if (filePath.includes('modulos') && filePath.endsWith('.js')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
    const isDashboardOrModuleHtml = filePath.includes('dashboard.js') || (filePath.includes('modulos') && filePath.endsWith('index.html'));
    if (isDashboardOrModuleHtml) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
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

// APIs sem rota → JSON 404 (nunca index.html: o front faria JSON.parse e mostraria "<!DOCTYPE").
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Rota de API não encontrada.', path: req.originalUrl });
});
app.use('/cargas/api', (req, res) => {
  res.status(404).json({ error: 'Rota de API não encontrada.', path: req.originalUrl });
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
