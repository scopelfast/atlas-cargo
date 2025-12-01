// backend/public/js/ambiente-utils.js
// Utilitário para gerenciar ambiente (Local/Produção)

/**
 * Obtém o ambiente atual (local ou producao)
 * DETECÇÃO AUTOMÁTICA: Baseada na URL atual do navegador
 * @returns {string} 'local' ou 'producao'
 */
function obterAmbiente() {
  // PRIORIDADE: Detectar baseado na URL ATUAL primeiro
  const hostname = window.location.hostname;
  const port = window.location.port;
  
  // Detectar se é ambiente local
  const isLocalhost = hostname === 'localhost' || 
                      hostname === '127.0.0.1' ||
                      hostname.startsWith('192.168.') ||
                      hostname.startsWith('10.') ||
                      hostname.startsWith('172.') ||
                      (hostname === '192.168.1.173' && port === '3000');
  
  // Se está em localhost/IP privado, SEMPRE retornar 'local'
  if (isLocalhost) {
    const ambienteSalvo = localStorage.getItem('ambiente');
    if (ambienteSalvo !== 'local') {
      console.log('[AMBIENTE] Corrigindo ambiente: estava', ambienteSalvo, 'mas está em localhost/IP privado, mudando para local');
      localStorage.setItem('ambiente', 'local');
      localStorage.removeItem('urlBaseProducao');
    }
    return 'local';
  }
  
  // Se não está em localhost, é PRODUÇÃO
  // Salvar automaticamente como produção se ainda não estiver salvo
  const ambienteSalvo = localStorage.getItem('ambiente');
  if (ambienteSalvo !== 'producao') {
    console.log('[AMBIENTE] Detectado ambiente de PRODUÇÃO:', hostname);
    localStorage.setItem('ambiente', 'producao');
    // Salvar a URL atual como URL de produção
    const urlAtual = window.location.origin;
    localStorage.setItem('urlBaseProducao', urlAtual);
  }
  
  return 'producao';
}

/**
 * Obtém a URL base do servidor baseado no ambiente
 * DETECÇÃO AUTOMÁTICA: Usa a URL atual do navegador para determinar o ambiente
 * @returns {Promise<string>} URL base do servidor
 */
async function obterUrlBase() {
  const ambiente = obterAmbiente();
  
  if (ambiente === 'local') {
    // Ambiente local: sempre usar localhost:3000
    const urlLocal = 'http://localhost:3000';
    console.log('[AMBIENTE] ✅ Ambiente LOCAL detectado:', urlLocal);
    return urlLocal;
  } else {
    // Ambiente produção: usar URL salva no localStorage ou origem atual
    const urlSalva = localStorage.getItem('urlBaseProducao');
    if (urlSalva) {
      console.log('[AMBIENTE] ✅ Ambiente PRODUÇÃO - URL salva:', urlSalva);
      return urlSalva;
    }
    
    // Se não tem URL salva, usar a origem atual (onde o usuário está acessando)
    const urlAtual = window.location.origin;
    console.log('[AMBIENTE] ✅ Ambiente PRODUÇÃO - URL atual detectada:', urlAtual);
    // Salvar para próxima vez
    localStorage.setItem('urlBaseProducao', urlAtual);
    return urlAtual;
  }
}

/**
 * Obtém a URL base de forma síncrona (usando cache ou fallback)
 * Útil quando não pode usar await
 * DETECÇÃO AUTOMÁTICA: Baseada na URL atual do navegador
 * @returns {string} URL base do servidor
 */
function obterUrlBaseSync() {
  const ambiente = obterAmbiente();
  
  if (ambiente === 'local') {
    const urlLocal = 'http://localhost:3000';
    console.log('[AMBIENTE] ✅ Ambiente LOCAL (sync):', urlLocal);
    return urlLocal;
  } else {
    // Em produção, usar URL salva no localStorage ou origem atual
    const urlSalva = localStorage.getItem('urlBaseProducao');
    if (urlSalva) {
      console.log('[AMBIENTE] ✅ Ambiente PRODUÇÃO (sync) - URL salva:', urlSalva);
      return urlSalva;
    }
    
    // Se não tem URL salva, usar a origem atual e salvar
    const urlAtual = window.location.origin;
    localStorage.setItem('urlBaseProducao', urlAtual);
    console.log('[AMBIENTE] ✅ Ambiente PRODUÇÃO (sync) - URL atual:', urlAtual);
    return urlAtual;
  }
}

/**
 * Define a URL base de produção (para cache)
 * @param {string} url - URL base de produção
 */
function definirUrlBaseProducao(url) {
  localStorage.setItem('urlBaseProducao', url);
}

// Exportar funções para uso global
if (typeof window !== 'undefined') {
  window.obterAmbiente = obterAmbiente;
  window.obterUrlBase = obterUrlBase;
  window.obterUrlBaseSync = obterUrlBaseSync;
  window.definirUrlBaseProducao = definirUrlBaseProducao;
}

