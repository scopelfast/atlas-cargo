// backend/routes/message.routes.js
// Rotas para Chat Motorista ↔ Operador
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { getUsuarioLogado } = require('../middleware/auth.middleware');

const uploadAudioDir = path.join(__dirname, '..', 'public', 'uploads', 'audio');
try {
  fs.mkdirSync(uploadAudioDir, { recursive: true });
} catch (e) {
  console.warn('Pasta uploads/audio:', e.message);
}
const storageAudio = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadAudioDir),
  filename: (req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname)) || '.webm';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, name);
  }
});
const uploadAudio = multer({
  storage: storageAudio,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(webm|mp3|wav|m4a|ogg)$/i.test(file.originalname) || file.mimetype.startsWith('audio/');
    if (allowed) cb(null, true);
    else cb(new Error('Apenas arquivos de áudio (webm, mp3, wav, m4a, ogg) são permitidos.'), false);
  }
});

// Middleware opcional (não bloqueia se não autenticado para permitir offline)
router.use(getUsuarioLogado);

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/chat no app.js

// Listar conversas
router.get('/conversas', messageController.listarConversas);

// Buscar mensagens de uma conversa
router.get('/conversas/:id', messageController.buscarMensagensConversa);

// Criar nova conversa
router.post('/conversas', messageController.criarConversa);

// Atualizar conversa
router.put('/conversas/:id', messageController.atualizarConversa);

// Buscar conversas/mensagens
router.get('/buscar', messageController.buscar);

// Contador de não lidas
router.get('/nao-lidas', messageController.contadorNaoLidas);

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// ============================================

// Upload de áudio (deve vir antes de POST /)
router.post('/upload-audio', uploadAudio.single('file'), messageController.uploadAudio);

// Transcrever áudio de mensagem existente (sob demanda)
router.post('/transcrever-audio', messageController.transcreverAudioOnDemand);

// Enviar mensagem
router.post('/', messageController.enviar);
router.post('/mensagens', messageController.enviar); // Alias para módulo

// Buscar mensagens de uma viagem
router.get('/viagem/:idviagem', messageController.buscarPorViagem);

// Marcar mensagens como lidas
router.put('/marcar-lidas', messageController.marcarComoLidas);
router.put('/mensagens/:id/ler', messageController.marcarComoLidas); // Alias para módulo

// Buscar nome do operador/motorista
router.get('/operador/:id', messageController.buscarNomeOperador);

module.exports = router;
