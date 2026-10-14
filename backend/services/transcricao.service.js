// backend/services/transcricao.service.js
// Transcrição de áudio com OpenAI Whisper (Fase 2 - Chat Áudio)
// Chave: Configurações do Sistema (openai_api_key) ou OPENAI_API_KEY no .env.

const fs = require('fs');
const path = require('path');
const { getOpenAiApiKeyForRequest } = require('./openai-config.service');

const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const HALLUCINATION_RE =
  /amara\.org|legendas pela comunidade|subtitles by the|thanks for watching|obrigado por assistir|please subscribe|inscrito no canal|♪|\[\s*m[uú]sica\s*\]|\[\s*silence\s*\]|\[\s*sil[eê]ncio\s*\]/i;

function sanitizarTranscricao(text) {
  if (text == null) return null;
  let t = String(text).trim();
  if (!t) return null;
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (HALLUCINATION_RE.test(t) && t.length < 160) {
    console.warn('[transcricao] Texto descartado (alucinação Whisper):', t.substring(0, 80));
    return null;
  }
  return t || null;
}

function mimeFromFilename(filename) {
  const ext = (path.extname(filename || '') || '').toLowerCase();
  if (ext === '.webm') return 'audio/webm';
  if (ext === '.ogg' || ext === '.oga') return 'audio/ogg';
  if (ext === '.m4a' || ext === '.mp4') return 'audio/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  return 'application/octet-stream';
}

function extrairTextoTranscription(transcription) {
  if (typeof transcription === 'string') return transcription.trim();
  if (transcription && typeof transcription.text === 'string') return transcription.text.trim();
  if (transcription && transcription.data && typeof transcription.data === 'string') {
    return String(transcription.data).trim();
  }
  return '';
}

function criarClienteOpenAi(apiKey) {
  const OpenAIMod = require('openai');
  const OpenAI = OpenAIMod.default || OpenAIMod;
  const toFile = OpenAIMod.toFile;
  const openai = new OpenAI({ apiKey });
  return { openai, toFile };
}

function codigoIdiomaWhisper(idioma) {
  const raw = idioma && String(idioma).trim() ? String(idioma).trim().toLowerCase() : '';
  if (!raw || raw === 'auto') return undefined;
  if (raw.startsWith('pt')) return 'pt';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('en')) return 'en';
  return raw.substring(0, 2);
}

async function chamarModeloTranscricao(openai, toFile, buffer, filename, mime, model, language) {
  const file = await toFile(buffer, filename, { type: mime });
  const body = {
    file,
    model,
    response_format: 'text',
    temperature: 0,
  };
  if (language) body.language = language;
  const transcription = await openai.audio.transcriptions.create(body);
  return sanitizarTranscricao(extrairTextoTranscription(transcription));
}

/**
 * @returns {Promise<{ text: string|null, error?: string, code?: string }>}
 */
async function transcreverAudioDetalhado(caminhoArquivo, idioma, opts) {
  const apiKey = await getOpenAiApiKeyForRequest({ tenantId: opts && opts.tenantId });
  if (!apiKey) {
    console.warn('[transcricao] Chave OpenAI não configurada.');
    return {
      text: null,
      code: 'SEM_CHAVE_OPENAI',
      error:
        'Chave OpenAI não configurada. Em Configurações → App e transcrição, salve a chave Whisper.',
    };
  }
  if (!caminhoArquivo || !fs.existsSync(caminhoArquivo)) {
    return { text: null, code: 'ARQUIVO_AUSENTE', error: 'Arquivo de áudio não encontrado no servidor.' };
  }
  const stat = fs.statSync(caminhoArquivo);
  if (!stat.isFile() || stat.size === 0) {
    return { text: null, code: 'ARQUIVO_VAZIO', error: 'Arquivo de áudio vazio ou inválido.' };
  }
  if (stat.size > MAX_FILE_SIZE_BYTES) {
    return {
      text: null,
      code: 'ARQUIVO_GRANDE',
      error: `Áudio acima do limite do Whisper (${MAX_FILE_SIZE_MB} MB).`,
    };
  }

  const filename = path.basename(caminhoArquivo);
  const mime = mimeFromFilename(filename);
  const buffer = fs.readFileSync(caminhoArquivo);
  const lang = codigoIdiomaWhisper(idioma);
  console.log('[transcricao] arquivo', filename, 'bytes=', stat.size, 'mime=', mime, 'lang=', lang || 'auto');

  try {
    const { openai, toFile } = criarClienteOpenAi(apiKey);
    if (typeof toFile !== 'function') {
      return { text: null, code: 'SDK_OPENAI', error: 'SDK OpenAI sem toFile. Atualize o pacote openai no servidor.' };
    }

    const tentativas = [
      { model: 'whisper-1', language: lang },
      { model: 'whisper-1', language: undefined },
      { model: 'gpt-4o-mini-transcribe', language: lang },
    ];

    let lastErr = null;
    for (const t of tentativas) {
      try {
        const text = await chamarModeloTranscricao(
          openai,
          toFile,
          buffer,
          filename,
          mime,
          t.model,
          t.language
        );
        if (text) {
          console.log('[transcricao] OK', t.model, text.substring(0, 60) + (text.length > 60 ? '...' : ''));
          return { text };
        }
        console.warn('[transcricao] sem texto útil em', t.model, 'lang=', t.language || 'auto');
      } catch (e) {
        lastErr = e;
        const st = e && e.status;
        console.warn('[transcricao] falha', t.model, st || '', e && e.message);
        if (st === 401 || st === 429) break;
      }
    }

    if (lastErr) {
      const status = lastErr.status;
      if (status === 401) {
        return {
          text: null,
          code: 'CHAVE_INVALIDA',
          error: 'Chave OpenAI rejeitada (401). Verifique a chave em Configurações → App e transcrição.',
        };
      }
      if (status === 429) {
        return {
          text: null,
          code: 'LIMITE_OPENAI',
          error: 'Limite/cota OpenAI atingido (429). Aguarde ou verifique o billing na OpenAI.',
        };
      }
      return {
        text: null,
        code: 'ERRO_OPENAI',
        error: lastErr.message || 'Erro ao chamar a API Whisper.',
      };
    }

    return {
      text: null,
      code: 'SEM_TEXTO',
      error:
        'O Whisper não reconheceu fala neste arquivo (silêncio, ruído ou áudio muito curto). Segure o microfone, fale 2–3 segundos e solte.',
    };
  } catch (err) {
    const msg = err && (err.message || String(err));
    console.warn('[transcricao] Erro ao transcrever:', msg);
    return { text: null, code: 'ERRO_OPENAI', error: msg || 'Erro ao chamar a API Whisper.' };
  }
}

async function transcreverAudio(caminhoArquivo, idioma, opts) {
  const r = await transcreverAudioDetalhado(caminhoArquivo, idioma, opts);
  return r && r.text ? r.text : null;
}

module.exports = {
  transcreverAudio,
  transcreverAudioDetalhado,
  sanitizarTranscricao,
};
