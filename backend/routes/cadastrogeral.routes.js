// backend/routes/cadastrogeral.routes.js
// Cadastro Geral - API
// Versão: 1.1 - Otimizada com Classes de Frota
// Atlas Cargo
// Data: 2026-04-05

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const cadastroController = require('../controllers/cadastrogeral.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

const uploadEnderecosEntrega = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const uploadMotoristasDirTorre = path.join(__dirname, '..', 'public', 'uploads', 'motoristas');
const uploadVeiculosDirTorre = path.join(__dirname, '..', 'public', 'uploads', 'veiculos');

const imgTorreFileFilter = (_req, file, cb) => {
  const mime = (file.mimetype || '').toLowerCase();
  const name = (file.originalname || '').toLowerCase();
  const ok =
    mime === 'image/jpeg' ||
    mime === 'image/png' ||
    mime === 'image/webp' ||
    /\.(jpe?g|png|webp)$/.test(name);
  if (!ok) return cb(new Error('Use imagem JPEG, PNG ou WebP (máx. 5 MB).'));
  cb(null, true);
};

const storageTorreMcAnexo = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadMotoristasDirTorre, { recursive: true });
    cb(null, uploadMotoristasDirTorre);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const idCad = String(req.params.id || '0').replace(/[^\d]/g, '').slice(0, 20) || '0';
    cb(null, `torre_mc_${idCad}_${Date.now()}${ext}`);
  },
});
const uploadTorreMcAnexo = multer({
  storage: storageTorreMcAnexo,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imgTorreFileFilter,
}).single('arquivo');

const storageTorreMvAnexo = multer.diskStorage({
  destination: (_req, _file, cb) => {
    fs.mkdirSync(uploadVeiculosDirTorre, { recursive: true });
    cb(null, uploadVeiculosDirTorre);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const idv = String(req.params.idVeiculo || '0').replace(/[^\d]/g, '').slice(0, 20) || '0';
    cb(null, `torre_mv_${idv}_${Date.now()}${ext}`);
  },
});
const uploadTorreMvAnexo = multer({
  storage: storageTorreMvAnexo,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: imgTorreFileFilter,
}).single('arquivo');

router.use(towerAuthAndTenant);

// Rotas principais
router.get('/cadastros-gerais', cadastroController.listar);
router.post('/cadastros-gerais', cadastroController.criar);

// Rotas específicas ANTES das rotas com parâmetro :id (para evitar conflito)
router.get('/cadastros-gerais/contador-motoristas-pendentes', cadastroController.contadorMotoristasPendentes);
router.get('/cadastros-gerais/contador-motorista-veiculos-pendentes', cadastroController.contadorMotoristaVeiculosPendentes);
router.get('/cadastros-gerais/motorista-veiculos-pendentes', cadastroController.listarMotoristaVeiculosPendentes);
router.post('/cadastros-gerais/motorista-veiculos/:idVeiculo/aprovar', cadastroController.aprovarMotoristaVeiculo);
router.post('/cadastros-gerais/motorista-veiculos/:idVeiculo/rejeitar', cadastroController.rejeitarMotoristaVeiculo);
router.post('/cadastros-gerais/motorista-veiculos/:idVeiculo/inativar-vinculo', cadastroController.inativarMotoristaVeiculoVinculo);
router.delete(
  '/cadastros-gerais/motorista-veiculos/:idVeiculo/anexos/:tipo',
  cadastroController.excluirAnexoMotoristaVeiculoTorre
);
router.post(
  '/cadastros-gerais/motorista-veiculos/:idVeiculo/anexos',
  (req, res, next) => {
    uploadTorreMvAnexo(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Arquivo inválido.' });
      next();
    });
  },
  cadastroController.uploadAnexoMotoristaVeiculoTorre
);
router.get('/cadastros-gerais/equipamentos-frota-combo', cadastroController.listarEquipamentosFrotaComboTorre);
router.get('/cadastros-gerais/transportadores', cadastroController.listarTransportadores);
router.get('/cadastros-gerais/exportar-excel', cadastroController.exportarExcel);
router.post(
  '/cadastros-gerais/import-enderecos-entrega',
  uploadEnderecosEntrega.single('file'),
  cadastroController.importEnderecosEntrega
);
router.post('/cadastros-gerais/aplicar-correcao-sp-validade', cadastroController.aplicarCorrecaoSPValidade);
router.post('/cadastros-gerais/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
    // Permite: SELECT, EXEC, EXECUTE, UPDATE, INSERT, DELETE (com cuidado)
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    // Verificar comandos bloqueados
    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ 
          error: `Comando não permitido: ${cmd}.` 
        });
      }
    }

    const { poolPromise } = require('../config/db');
    const pool = await poolPromise;
    
    // Dividir por GO se houver múltiplos comandos
    const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    
    const resultados = [];
    
    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;
      // Ignorar comentários e EXEC (stored procedures não existem no PostgreSQL)
      if (cmdLimpo.startsWith('--') || /^\s*EXEC(UTE)?\s+/i.test(cmdLimpo)) {
        resultados.push({ tipo: 'SKIP', message: 'Comando ignorado (PostgreSQL).' });
        continue;
      }

      try {
        // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
        const request = pool.request();
        // mssql usa requestTimeout (em milissegundos)
        request.timeout = 120000; // 120 segundos (2 minutos) para comandos grandes
        const result = await request.query(cmdLimpo);
        
        // Se retornou dados (SELECT), incluir no resultado
        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({
            tipo: 'SELECT',
            rows: rows,
            rowCount: rows.length
          });
        } else {
          // Comando executado sem retorno (EXEC, UPDATE, etc)
          resultados.push({
            tipo: 'EXEC',
            message: 'Comando executado com sucesso.',
            rowsAffected: result.rowsAffected || [0]
          });
        }
      } catch (cmdErr) {
        // Se um comando falhar, continuar com os próximos mas registrar o erro
        let mensagemErro = cmdErr.message;
        
        // Melhorar mensagem de timeout
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
          detalhes: {
            nome: cmdErr.name,
            codigo: cmdErr.code,
            numero: cmdErr.number
          }
        });
      }
    }

    res.json({
      success: true,
      resultados: resultados,
      totalComandos: comandos.length
    });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    // Garantir que a resposta seja enviada antes de encerrar
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.',
        detalhes: err.message 
      });
    }
  }
});

// Rotas com parâmetro :id (devem vir DEPOIS das rotas específicas)
router.get('/cadastros-gerais/:id/motorista-veiculos', cadastroController.listarMotoristaVeiculosDoCadastro);
router.post('/cadastros-gerais/:id/motorista-veiculos/vincular-equipamento', cadastroController.vincularEquipamentoMotoristaTorre);
router.get('/cadastros-gerais/:id/enderecos-entrega', cadastroController.listarEnderecosEntrega);
router.post('/cadastros-gerais/:id/enderecos-entrega', cadastroController.criarEnderecoEntrega);
router.put('/cadastros-gerais/:id/enderecos-entrega/:cdEndereco', cadastroController.atualizarEnderecoEntrega);
router.delete('/cadastros-gerais/:id/enderecos-entrega/:cdEndereco', cadastroController.excluirEnderecoEntrega);
router.delete('/cadastros-gerais/:id/anexos/:tipo', cadastroController.excluirAnexoMotoristaCadastroTorre);
router.post(
  '/cadastros-gerais/:id/anexos',
  (req, res, next) => {
    uploadTorreMcAnexo(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.message || 'Arquivo inválido.' });
      next();
    });
  },
  cadastroController.uploadAnexoMotoristaCadastroTorre
);
router.put('/cadastros-gerais/:id', cadastroController.atualizar);
router.delete('/cadastros-gerais/:id', cadastroController.excluir);
router.get('/cadastros-gerais/:id', cadastroController.buscarPorId);

// Locais preferidos (lista registro a registro)
router.get('/cadastros-gerais/:id/locais-preferidos', cadastroController.listarLocaisPreferidos);
router.post('/cadastros-gerais/:id/locais-preferidos', cadastroController.adicionarLocalPreferido);
router.delete('/cadastros-gerais/:id/locais-preferidos/:sequencia', cadastroController.excluirLocalPreferido);

// Rotas de classes de frota para cadastro
router.get('/cadastro-classes/:id', cadastroController.listarClassesParaCadastro);
router.put('/cadastro-classes/:id', cadastroController.atualizarClassesParaCadastro);

// Rotas de utilitários
router.get('/cep/:cep', cadastroController.buscarCEP);

// Rotas de combos
router.get('/tipos-cadastro-combo', cadastroController.listarTiposCadastro);
router.get('/tipos-pessoa-combo', cadastroController.listarTiposPessoa);

module.exports = router;