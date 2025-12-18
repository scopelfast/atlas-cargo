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
const alertRoutes = require('./routes/alert.routes');
const messageRoutes = require('./routes/message.routes');
const sosRoutes = require('./routes/sos.routes');
const reputationRoutes = require('./routes/reputation.routes');

const app = express();

// Inicializar Cache Service (após criar app)
const { getCacheService } = require('./services/cache.service');
const cacheService = getCacheService();
app.set('cacheService', cacheService);

// Configurar trust proxy para capturar IP real quando há proxy reverso (nginx, etc)
// Isso permite que req.ip funcione corretamente com X-Forwarded-For
app.set('trust proxy', true);

// Middleware de segurança
// Em desenvolvimento, desabilitar headers que requerem HTTPS ou localhost
const isDevelopment = process.env.NODE_ENV !== 'production';

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
        "blob:"
      ],
      connectSrc: [
        "'self'",
        "http://localhost:*",
        "ws://localhost:*",
        "http://127.0.0.1:*",
        "http://192.168.1.173:*", // IP específico da rede local
        "ws://192.168.1.173:*", // WebSocket para IP local
        "http://192.168.0.0/16", // Permitir toda a faixa 192.168.x.x
        "ws://192.168.0.0/16", // WebSocket para toda a faixa 192.168.x.x
        "http://10.0.0.0/8", // Permitir faixa 10.x.x.x
        "ws://10.0.0.0/8", // WebSocket para faixa 10.x.x.x
        "http://172.16.0.0/12", // Permitir faixa 172.16.x.x - 172.31.x.x
        "ws://172.16.0.0/12", // WebSocket para faixa 172.16.x.x - 172.31.x.x
        "http://cargas.integrabrasil.com:*", // Servidor de produção
        "ws://cargas.integrabrasil.com:*", // WebSocket para servidor de produção
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://cdn.jsdelivr.net",
        "https://router.project-osrm.org", // Para cálculo de rotas no mapa
        "https://unpkg.com", // Para Leaflet source maps
        "https://nominatim.openstreetmap.org" // Para geocodificação reversa
      ],
      formAction: [
        "'self'",
        "http://localhost:*",
        "http://127.0.0.1:*",
        "http://192.168.1.173:*", // IP específico da rede local
        "http://192.168.0.0/16", // Permitir toda a faixa 192.168.x.x
        "http://10.0.0.0/8", // Permitir faixa 10.x.x.x
        "http://172.16.0.0/12", // Permitir faixa 172.16.x.x - 172.31.x.x
        "http://cargas.integrabrasil.com:*" // Servidor de produção
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

// Middleware para garantir que não haja upgrade para HTTPS em desenvolvimento
if (isDevelopment) {
  app.use((req, res, next) => {
    // Remover qualquer header que possa forçar HTTPS
    res.removeHeader('Strict-Transport-Security');
    res.removeHeader('Upgrade-Insecure-Requests');
    
    // Adicionar header para desabilitar upgrade automático (não padrão, mas pode ajudar)
    // Alguns navegadores respeitam isso
    res.setHeader('X-Force-HTTP', 'true');
    
    // Garantir que o protocolo seja HTTP
    if (req.secure || req.get('x-forwarded-proto') === 'https') {
      // Se vier de um proxy HTTPS mas estamos em desenvolvimento, forçar HTTP
      console.warn('⚠️ Requisição HTTPS detectada em desenvolvimento:', req.url);
    }
    
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
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api', marcasRoutes); 
app.use('/api', grupoRoutes);
app.use('/api', classeFrotaRoutes);
app.use('/api', tipoViagemRoutes);
app.use('/api', situacaoViagemRoutes);
app.use('/api', tipoEquipamentoRoutes);
app.use('/api', modeloEquipamentoRoutes);
app.use('/api', equipamentoRoutes);
app.use('/api', cidadesRoutes);
app.use('/api', roteirosRoutes);
app.use('/api', estadosRoutes);
app.use('/api', cadastroGeralRoutes);
app.use('/api', viagemRoutes);
app.use('/api', tipoValidadeRoutes);
app.use('/api', controleValidadeRoutes);
app.use('/api', empresaRoutes);
app.use('/api', filialRoutes);
app.use('/api/relatorio-convocacoes', relatorioConvocacoesRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', tipoAtividadeRoutes);
app.use('/api/motorista', motoristaAppRoutes);
app.use('/api/log', usuariologacaoRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api', sosRoutes);
app.use('/api/reputation', reputationRoutes);

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
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath, stat) => {
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
        // CSS e JS: Sem cache quando não tem query string, com validação quando tem
        // O cache-buster.js adiciona ?v=timestamp, então o navegador sempre busca nova versão
        // Se não tiver query string, não fazer cache (arquivo pode ter mudado)
        const hasQueryString = req.url.includes('?');
        if (hasQueryString) {
          // Com query string (cache busting): cache longo mas validado
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); // 1 ano (imutável com ?v=)
        } else {
          // Sem query string: sem cache (arquivo pode ter mudado)
          res.setHeader('Cache-Control', 'no-cache, must-revalidate');
        }
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
  }
}));

// Rota de teste para verificar se arquivos estáticos estão sendo servidos
app.get('/test-css', (req, res) => {
  const cssPath = path.join(__dirname, 'public', 'css', 'style.css');
  res.sendFile(cssPath, (err) => {
    if (err) {
      res.status(404).send(`CSS não encontrado: ${cssPath}`);
    }
  });
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
