// backend/public/js/ambiente-utils.js
// Utilitário para gerenciar ambiente (Local/Produção)

/**
 * Obtém o ambiente atual (local ou producao)
 * @returns {string} 'local' ou 'producao'
 */
function obterAmbiente() {
  const ambiente = localStorage.getItem('ambiente');
  if (ambiente === 'local' || ambiente === 'producao') {
    return ambiente;
  }
  
  // Detectar automaticamente baseado no hostname
  const hostname = window.location.hostname;
  const isLocalhost = hostname === 'localhost' || 
                      hostname === '127.0.0.1' ||
                      hostname.startsWith('192.168.');
  
  return isLocalhost ? 'local' : 'producao';
}

/**
 * Obtém a URL base do servidor baseado no ambiente
 * @returns {Promise<string>} URL base do servidor
 */
async function obterUrlBase() {
  const ambiente = obterAmbiente();
  
  if (ambiente === 'local') {
    // Ambiente local: sempre usar localhost:3000
    console.log('[AMBIENTE] Usando ambiente LOCAL: http://localhost:3000');
    return 'http://localhost:3000';
  } else {
    // Ambiente produção: usar URL salva no localStorage ou origem atual
    // NÃO chamar a API para evitar usar localhost quando o usuário escolheu produção
    const urlSalva = localStorage.getItem('urlBaseProducao');
    if (urlSalva) {
      console.log('[AMBIENTE] Usando URL de PRODUÇÃO salva:', urlSalva);
      return urlSalva;
    }
    
    // Se não tem URL salva, usar a origem atual (onde o usuário está acessando)
    const urlAtual = window.location.origin;
    console.log('[AMBIENTE] Usando URL de PRODUÇÃO atual:', urlAtual);
    // Salvar para próxima vez
    localStorage.setItem('urlBaseProducao', urlAtual);
    return urlAtual;
  }
}

/**
 * Obtém a URL base de forma síncrona (usando cache ou fallback)
 * Útil quando não pode usar await
 * @returns {string} URL base do servidor
 */
function obterUrlBaseSync() {
  const ambiente = obterAmbiente();
  
  if (ambiente === 'local') {
    console.log('[AMBIENTE] Usando ambiente LOCAL (sync): http://localhost:3000');
    return 'http://localhost:3000';
  } else {
    // Em produção, usar URL salva no localStorage ou origem atual
    const urlSalva = localStorage.getItem('urlBaseProducao');
    if (urlSalva) {
      console.log('[AMBIENTE] Usando URL de PRODUÇÃO salva (sync):', urlSalva);
      return urlSalva;
    }
    
    // Se não tem URL salva, usar a origem atual e salvar
    const urlAtual = window.location.origin;
    localStorage.setItem('urlBaseProducao', urlAtual);
    console.log('[AMBIENTE] Usando URL de PRODUÇÃO atual (sync):', urlAtual);
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

