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
const empresaRoutes = require('./routes/empresa.routes');
const filialRoutes = require('./routes/filial.routes');
const relatorioConvocacoesRoutes = require('./routes/relatorio-convocacoes.routes');
const usuarioRoutes = require('./routes/usuario.routes');
const tipoAtividadeRoutes = require('./routes/tipoatividade.routes');

const app = express();

// Middleware de segurança
// Em desenvolvimento, desabilitar headers que requerem HTTPS ou localhost
const isDevelopment = process.env.NODE_ENV !== 'production';

app.use(helmet({
  contentSecurityPolicy: false, // Desabilitado para evitar problemas com estilos em produção
  // Desabilitar headers que causam problemas com HTTP em IPs locais
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  originAgentCluster: false,
  // CRÍTICO: Desabilitar HSTS que força HTTPS
  strictTransportSecurity: false
}));

// Middleware para garantir que não haja upgrade para HTTPS em desenvolvimento
if (isDevelopment) {
  app.use((req, res, next) => {
    // Remover qualquer header que possa forçar HTTPS
    res.removeHeader('Strict-Transport-Security');
    res.removeHeader('Upgrade-Insecure-Requests');
    next();
  });
}

// Compressão HTTP para reduzir tamanho das respostas (JSON, HTML, CSS, JS)
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos da pasta 'public'
// Configurar headers corretos para arquivos estáticos
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
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
    
    // Cache em produção para melhor performance
    if (isDevelopment) {
      // Desabilitar cache em desenvolvimento para facilitar debug
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else {
      // Cache agressivo em produção para arquivos estáticos
      if (filePath.endsWith('.css') || filePath.endsWith('.js') || 
          filePath.endsWith('.png') || filePath.endsWith('.jpg') || 
          filePath.endsWith('.jpeg') || filePath.endsWith('.gif') || 
          filePath.endsWith('.ico') || filePath.endsWith('.svg')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    }
  }
}));

// Rotas de API (sempre ANTES do fallback)
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
app.use('/api', empresaRoutes);
app.use('/api', filialRoutes);
app.use('/api/relatorio-convocacoes', relatorioConvocacoesRoutes);
app.use('/api', usuarioRoutes);
app.use('/api', tipoAtividadeRoutes);

// Rota pública para motorista responder convocação
app.get('/convocacao/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'convocacao.html'));
});

// Rota para página de teste mobile
app.get('/teste-mobile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teste-mobile.html'));
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

// Rota para dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Rota raiz: serve o index.html (login)
app.get('/', (req, res) => {
  // Adicionar headers para garantir que não há cache
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Qualquer outra rota não encontrada → redireciona para frontend (SPA-friendly)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;