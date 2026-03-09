// backend/services/transcricao.service.js
// Transcrição de áudio com OpenAI Whisper (Fase 2 - Chat Áudio)
// Requer OPENAI_API_KEY no .env. Se ausente, retorna null (transcrição desabilitada).

const fs = require('fs');
const path = require('path');

const MAX_FILE_SIZE_MB = 25; // Whisper aceita até 25 MB
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Transcreve um arquivo de áudio usando OpenAI Whisper.
 * @param {string} caminhoArquivo - Caminho absoluto do arquivo no disco
 * @param {string} [idioma] - Código do idioma (pt, es, en). Opcional; Whisper pode auto-detectar
 * @returns {Promise<string|null>} Texto transcrito ou null em caso de falha/desabilitado
 */
async function transcreverAudio(caminhoArquivo, idioma) {
  const apiKey = process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim();
  if (!apiKey) {
    console.warn('[transcricao] OPENAI_API_KEY não definida no .env — transcrição desativada.');
    return null;
  }
  if (!caminhoArquivo || !fs.existsSync(caminhoArquivo)) {
    console.warn('[transcricao] Arquivo não encontrado:', caminhoArquivo);
    return null;
  }
  const stat = fs.statSync(caminhoArquivo);
  if (!stat.isFile() || stat.size === 0) {
    console.warn('[transcricao] Arquivo inválido ou vazio:', caminhoArquivo);
    return null;
  }
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    console.warn('[transcricao] Arquivo muito grande para Whisper:', stat.size, 'bytes');
    return null;
  }
  try {
    const OpenAI = require('openai').default;
    const { toFile } = require('openai');
    const openai = new OpenAI({ apiKey });
    const buffer = fs.readFileSync(caminhoArquivo);
    const filename = path.basename(caminhoArquivo);
    const file = await toFile(buffer, filename);
    const lang = idioma && idioma.trim() ? idioma.trim().substring(0, 5) : undefined;
    const transcription = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: lang,
      response_format: 'text'
    });
    let text = null;
    if (typeof transcription === 'string') {
      text = transcription.trim();
    } else if (transcription && typeof transcription.text === 'string') {
      text = transcription.text.trim();
    } else if (transcription && transcription.data && typeof transcription.data === 'string') {
      text = String(transcription.data).trim();
    }
    if (text) {
      console.log('[transcricao] OK:', text.substring(0, 60) + (text.length > 60 ? '...' : ''));
      return text;
    }
    console.warn('[transcricao] Resposta da API sem texto.');
    return null;
  } catch (err) {
    console.warn('[transcricao] Erro ao transcrever:', err.message || err);
    if (err.status || err.code) console.warn('[transcricao] Status/código:', err.status || err.code);
    return null;
  }
}

module.exports = {
  transcreverAudio
};
