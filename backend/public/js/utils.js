// backend/public/js/utils.js
// Utilitários compartilhados para todos os módulos
// Versão: 1.0
// Atlas Cargo

/**
 * Escapa HTML para evitar XSS ao inserir texto em innerHTML
 * @param {string} text - Texto que pode conter < > " ' &
 * @returns {string}
 */
function escapeHtml(text) {
  if (text == null || typeof text !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Exibe uma mensagem de feedback para o usuário
 * @param {string} text - Texto da mensagem
 * @param {string} type - Tipo: 'success' ou 'error'
 * @param {HTMLElement} messageElement - Elemento HTML onde exibir a mensagem (opcional)
 * @param {string} fieldId - ID do campo com erro (opcional, para focar e fazer scroll)
 */
function showMessage(text, type = 'success', messageElement = null, fieldId = null) {
  // Remover toast anterior se existir
  const existingToast = document.getElementById('toast-message');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Criar toast fixo no topo (para erro e sucesso)
  const toast = document.createElement('div');
  toast.id = 'toast-message';
  
  if (type === 'error') {
    // Toast vermelho para erros
    toast.className = 'toast-message toast-error';
    toast.innerHTML = `
      <div class="toast-content">
        <i class="bx bx-error-circle"></i>
        <span>${escapeHtml(text)}</span>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
          <i class="bx bx-x"></i>
        </button>
      </div>
    `;
    
    // Focar e fazer scroll para o campo com erro se fornecido
    if (fieldId) {
      const field = document.getElementById(fieldId);
      if (field) {
        setTimeout(() => {
          field.focus();
          field.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Destacar o campo com erro
          field.style.borderColor = '#e74c3c';
          field.style.boxShadow = '0 0 0 3px rgba(231, 76, 60, 0.2)';
          setTimeout(() => {
            field.style.borderColor = '';
            field.style.boxShadow = '';
          }, 3000);
        }, 100);
      }
    }
    
    // Auto-ocultar após 8 segundos (mais tempo para erros)
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 300);
    }, 8000);
  } else {
    // Toast verde para sucesso
    toast.className = 'toast-message toast-success';
    toast.innerHTML = `
      <div class="toast-content">
        <i class="bx bx-check-circle"></i>
        <span>${escapeHtml(text)}</span>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
          <i class="bx bx-x"></i>
        </button>
      </div>
    `;
    
    // Auto-ocultar após 5 segundos (sucesso)
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 300);
    }, 5000);
  }
  
  document.body.appendChild(toast);
  
  // Animar entrada
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);
  
  // Também exibir no elemento message padrão se existir (para compatibilidade)
  const message = messageElement || document.getElementById('message');
  if (message) {
    message.textContent = text;
    message.className = `message ${type} show`;
    // Auto-ocultar após o tempo correspondente
    setTimeout(() => {
      message.className = 'message';
    }, type === 'error' ? 8000 : 5000);
  }
}

/**
 * Exibe um estado de loading em um elemento
 * @param {HTMLElement|string} element - Elemento ou ID do elemento
 * @param {boolean} show - Mostrar ou ocultar loading
 */
function showLoading(element, show = true) {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (!el) return;

  if (show) {
    el.classList.add('loading');
    el.disabled = true;
    
    // Adicionar spinner se não existir
    if (!el.querySelector('.spinner')) {
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      spinner.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i>';
      el.appendChild(spinner);
    }
  } else {
    el.classList.remove('loading');
    el.disabled = false;
    const spinner = el.querySelector('.spinner');
    if (spinner) spinner.remove();
  }
}

/**
 * Faz uma requisição fetch com tratamento de erros padronizado
 * @param {string} url - URL da requisição
 * @param {object} options - Opções do fetch
 * @returns {Promise<object>} Resposta parseada ou erro
 */
async function fetchWithErrorHandling(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Erro na requisição');
    }

    return { success: true, data };
  } catch (error) {
    return { 
      success: false, 
      error: error.message || 'Erro de conexão com o servidor' 
    };
  }
}

/**
 * Valida se um campo obrigatório está preenchido
 * @param {string} fieldId - ID do campo
 * @param {string} fieldName - Nome do campo para mensagem de erro
 * @returns {boolean} true se válido
 */
function validateRequired(fieldId, fieldName) {
  const field = document.getElementById(fieldId);
  if (!field) {
    showMessage(`Campo ${fieldName} não encontrado.`, 'error');
    return false;
  }

  if (!field.value || !field.value.trim()) {
    showMessage(`Campo ${fieldName} é obrigatório.`, 'error');
    field.focus();
    return false;
  }

  return true;
}

/**
 * Valida múltiplos campos obrigatórios
 * @param {Array<{id: string, name: string}>} fields - Array de objetos {id, name}
 * @returns {boolean} true se todos válidos
 */
function validateRequiredFields(fields) {
  for (const field of fields) {
    if (!validateRequired(field.id, field.name)) {
      return false;
    }
  }
  return true;
}

/**
 * Formata valor monetário (Fase 2 multimoeda). Usa locale pt-BR; moeda configurável.
 * @param {number} valor - Valor numérico
 * @param {string} codigoMoeda - Código ISO 4217 (ex: BRL, PYG). Default BRL.
 * @param {string} locale - Locale para formatação (ex: pt-BR, es-PY). Default pt-BR.
 * @returns {string}
 */
function formatarMoeda(valor, codigoMoeda = 'BRL', locale = 'pt-BR') {
  if (valor === null || valor === undefined) return '';
  const num = Number(valor);
  if (Number.isNaN(num)) return '';
  const moeda = (codigoMoeda && String(codigoMoeda).trim()) || 'BRL';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: moeda
  }).format(num);
}

/**
 * Formata um valor para exibição (remove espaços, formata números, etc)
 * @param {any} value - Valor a formatar
 * @param {string} type - Tipo: 'text', 'number', 'currency', 'date'
 * @param {string} currency - Opcional. Para type 'currency', código da moeda (BRL, PYG...). Default BRL.
 * @returns {string} Valor formatado
 */
function formatValue(value, type = 'text', currency = 'BRL') {
  if (value === null || value === undefined) return '';

  switch (type) {
    case 'number':
      return String(value).replace(/\D/g, '');
    case 'currency':
      return formatarMoeda(value, currency || 'BRL', 'pt-BR');
    case 'date':
      if (value instanceof Date) {
        return value.toLocaleDateString('pt-BR');
      }
      return value;
    default:
      return String(value).trim();
  }
}

/**
 * Formata data/hora com locale e fuso (Plano multimoeda Fase 4).
 * @param {string|Date|number} data - Data (ISO, Date ou timestamp)
 * @param {string} locale - pt-BR, es-PY. Default pt-BR
 * @param {string} timezoneId - IANA (America/Sao_Paulo, America/Asuncion). Default America/Sao_Paulo
 * @param {object} opts - dateStyle, timeStyle. Default short/short
 */
function formatarDataHoraComFuso(data, locale, timezoneId, opts) {
  if (data === null || data === undefined) return '';
  var d = data instanceof Date ? data : new Date(data);
  if (Number.isNaN(d.getTime())) return '';
  var loc = locale || 'pt-BR';
  var tz = timezoneId || 'America/Sao_Paulo';
  var o = opts || {};
  return new Intl.DateTimeFormat(loc, {
    timeZone: tz,
    dateStyle: o.dateStyle || 'short',
    timeStyle: o.timeStyle || 'short'
  }).format(d);
}

/**
 * Debounce para funções (útil para filtros)
 * @param {Function} func - Função a executar
 * @param {number} wait - Tempo de espera em ms
 * @returns {Function} Função com debounce
 */
function debounce(func, wait = 300) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Scroll suave para um elemento
 * @param {string|HTMLElement} element - Elemento ou ID
 * @param {object} options - Opções do scroll
 */
function scrollToElement(element, options = {}) {
  const el = typeof element === 'string' ? document.getElementById(element) : element;
  if (el) {
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      ...options
    });
  }
}

// Exportar funções para uso global
if (typeof window !== 'undefined') {
  window.showMessage = showMessage;
  window.showLoading = showLoading;
  window.fetchWithErrorHandling = fetchWithErrorHandling;
  window.validateRequired = validateRequired;
  window.validateRequiredFields = validateRequiredFields;
  window.formatValue = formatValue;
  window.formatarMoeda = formatarMoeda;
  window.formatarDataHoraComFuso = formatarDataHoraComFuso;
  window.debounce = debounce;
  window.scrollToElement = scrollToElement;
}

