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

/** AudioContext compartilhado para feedback sonoro do operador (bip, erro de validação). */
let _operadorAudioCtx = null;

function obterAudioContextOperador() {
  try {
    if (!_operadorAudioCtx) {
      _operadorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_operadorAudioCtx.state === 'suspended') {
      const pr = _operadorAudioCtx.resume();
      if (pr && typeof pr.catch === 'function') pr.catch(() => {});
    }
    return _operadorAudioCtx;
  } catch (e) {
    return null;
  }
}

/** Desbloqueia áudio na primeira interação (política dos navegadores). */
function initFeedbackSomOperador() {
  const unlock = () => {
    document.removeEventListener('click', unlock);
    document.removeEventListener('touchstart', unlock);
    document.removeEventListener('keydown', unlock);
    obterAudioContextOperador();
  };
  document.addEventListener('click', unlock, { once: true, passive: true });
  document.addEventListener('touchstart', unlock, { once: true, passive: true });
  document.addEventListener('keydown', unlock, { once: true, passive: true });
}

/**
 * Som curto para o operador identificar erro sem olhar a tela.
 * Respeita localStorage `notificacao_som` (mesma chave das notificações do dashboard).
 * @param {'error'|'warning'} [tipo]
 */
function tocarSomOperadorFeedback(tipo = 'error') {
  try {
    if (localStorage.getItem('notificacao_som') === 'false') return;
    const ctx = obterAudioContextOperador();
    if (!ctx) return;

    const beep = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'square';
      const t0 = ctx.currentTime + startOffset;
      gain.gain.setValueAtTime(0.22, t0);
      gain.gain.exponentialRampToValueAtTime(0.01, t0 + duration);
      osc.start(t0);
      osc.stop(t0 + duration);
    };

    if (tipo === 'warning') {
      beep(520, 0, 0.1);
    } else {
      // Dois tons descendentes — padrão típico de "erro" em coletores
      beep(420, 0, 0.12);
      beep(280, 0.16, 0.18);
    }
  } catch (e) {
    /* falha silenciosa */
  }
}

/**
 * Exibe uma mensagem de feedback para o usuário
 * @param {string} text - Texto da mensagem
 * @param {string} type - Tipo: 'success', 'error' ou 'warning'
 * @param {HTMLElement} messageElement - Elemento HTML onde exibir a mensagem (opcional)
 * @param {string} fieldId - ID do campo com erro (opcional, para focar e fazer scroll)
 */
function showMessage(text, type = 'success', messageElement = null, fieldId = null) {
  const msg = text == null ? '' : String(text).trim();

  // Remover toast anterior se existir
  const existingToast = document.getElementById('toast-message');
  if (existingToast) {
    existingToast.remove();
  }

  const message = messageElement || document.getElementById('message');
  if (!msg) {
    if (message) {
      message.textContent = '';
      message.className = 'message';
      message.style.display = 'none';
    }
    return;
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
        <span>${escapeHtml(msg)}</span>
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
    tocarSomOperadorFeedback('error');
  } else if (type === 'warning') {
    toast.className = 'toast-message toast-warning';
    toast.innerHTML = `
      <div class="toast-content">
        <i class="bx bx-error-circle"></i>
        <span>${escapeHtml(msg)}</span>
        <button class="toast-close" onclick="this.parentElement.parentElement.remove()">
          <i class="bx bx-x"></i>
        </button>
      </div>
    `;
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentElement) {
          toast.remove();
        }
      }, 300);
    }, 12000);
  } else {
    // Toast verde para sucesso
    toast.className = 'toast-message toast-success';
    toast.innerHTML = `
      <div class="toast-content">
        <i class="bx bx-check-circle"></i>
        <span>${escapeHtml(msg)}</span>
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
  if (message) {
    message.textContent = msg;
    message.style.display = '';
    message.className = `message ${type} show`;
    // Auto-ocultar após o tempo correspondente
    setTimeout(() => {
      message.className = 'message';
    }, type === 'error' ? 8000 : (type === 'warning' ? 12000 : 5000));
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
 * Fuso IANA da instalação (Configurações → Contexto). Atualizado pelo dashboard e por /api/contexto nos módulos.
 */
function resolveTimezoneInstalacao(explicitTimezoneId) {
  const ex = explicitTimezoneId != null && String(explicitTimezoneId).trim();
  if (ex) return ex;
  if (typeof window !== 'undefined' && window.__ATLAS_INSTALACAO_TIMEZONE__) {
    const g = String(window.__ATLAS_INSTALACAO_TIMEZONE__).trim();
    if (g) return g;
  }
  return 'America/Sao_Paulo';
}

/**
 * Grava o fuso global (chamar após GET /api/contexto ou ao salvar contexto).
 * @param {string} timezoneId - IANA
 */
function syncAtlasTimezoneInstalacao(timezoneId) {
  if (typeof window === 'undefined') return;
  const t = timezoneId != null && String(timezoneId).trim();
  if (t) window.__ATLAS_INSTALACAO_TIMEZONE__ = t;
}

/**
 * Valor da API (ISO com Z, Date ou timestamp) → string para &lt;input type="datetime-local"&gt;.
 * Usa o fuso da instalação (America/Sao_Paulo, etc.), alinhado ao card Contexto / Multipaís.
 * Strings SQL sem Z ("2026-03-30 17:00:00") = relógio de negócio: não desloca.
 * @param {string|Date|number|null|undefined} data
 * @param {string} [timezoneId] - IANA; se omitido, usa resolveTimezoneInstalacao()
 */
function dataApiParaDatetimeLocal(data, timezoneId) {
  const tz = resolveTimezoneInstalacao(timezoneId);
  if (data === null || data === undefined || data === '') return '';

  function instantParaDatetimeLocal(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        hour12: false
      });
      const parts = fmt.formatToParts(d);
      const pick = function (type) {
        const p = parts.find(function (x) { return x.type === type; });
        return p ? p.value : '';
      };
      var y = pick('year');
      var mo = pick('month');
      var da = pick('day');
      var ho = pick('hour');
      var mi = pick('minute');
      if (!y || !mo || !da) return '';
      ho = String(ho).padStart(2, '0');
      mi = String(mi).padStart(2, '0');
      return y + '-' + mo + '-' + da + 'T' + ho + ':' + mi;
    } catch (e) {
      var ano = d.getFullYear();
      var mes = String(d.getMonth() + 1).padStart(2, '0');
      var dia = String(d.getDate()).padStart(2, '0');
      var horas = String(d.getHours()).padStart(2, '0');
      var minutos = String(d.getMinutes()).padStart(2, '0');
      return ano + '-' + mes + '-' + dia + 'T' + horas + ':' + minutos;
    }
  }

  var str = String(data).trim();
  var isIsoInstant = /Z$/i.test(str) || /[+-]\d{2}:?\d{2}$/.test(str);

  if (isIsoInstant || data instanceof Date || (typeof data === 'number' && !isNaN(data))) {
    var d0 = data instanceof Date ? data : new Date(data);
    return instantParaDatetimeLocal(d0);
  }

  var limpo = str.replace(/\.\d+/, '');
  var m = limpo.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2})/);
  if (m) {
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5];
  }

  var d1 = new Date(str);
  return instantParaDatetimeLocal(d1);
}

/**
 * API → &lt;input type="date"&gt; (YYYY-MM-DD no fuso da instalação).
 * @param {string|Date|number|null|undefined} data
 * @param {string} [timezoneId]
 */
function dataApiParaInputDate(data, timezoneId) {
  const tz = resolveTimezoneInstalacao(timezoneId);
  if (data === null || data === undefined || data === '') return '';
  var str = String(data).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  var isIsoInstant = /Z$/i.test(str) || /[+-]\d{2}:?\d{2}$/.test(str);
  var d = data instanceof Date ? data : new Date(data);
  if (isNaN(d.getTime())) return '';

  if (!isIsoInstant) {
    var m0 = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m0) return m0[1] + '-' + m0[2] + '-' + m0[3];
  }

  try {
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    var parts = fmt.formatToParts(d);
    var pick = function (type) {
      var p = parts.find(function (x) { return x.type === type; });
      return p ? p.value : '';
    };
    var y = pick('year');
    var mo = pick('month');
    var da = pick('day');
    if (!y || !mo || !da) return '';
    return y + '-' + mo + '-' + da;
  } catch (e2) {
    var ano = d.getFullYear();
    var mes = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return ano + '-' + mes + '-' + dia;
  }
}

/**
 * "Agora" no fuso da instalação → datetime-local.
 * @param {string} [timezoneId]
 */
function agoraParaDatetimeLocal(timezoneId) {
  return dataApiParaDatetimeLocal(new Date(), timezoneId);
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

/**
 * Localiza o modal de confirmação estilizado dos módulos (#confirmModal no HTML da Torre).
 * Busca primeiro dentro do root (ex.: #contentArea) para evitar colisão em cenários com vários fragmentos;
 * se o modal já tiver sido movido para document.body, faz fallback por ID global.
 * @param {{ rootId?: string }} [opts]
 * @returns {{ modalEl: HTMLElement|null, modalMessage: HTMLElement|null, confirmYes: HTMLElement|null, confirmNo: HTMLElement|null }}
 */
function getConfirmModalElements(opts) {
  const o = opts || {};
  const rootId = o.rootId != null ? o.rootId : 'contentArea';
  const root = typeof document !== 'undefined' && rootId ? document.getElementById(rootId) : null;
  let modalEl = root && root.querySelector ? root.querySelector('#confirmModal') : null;
  if (!modalEl && typeof document !== 'undefined') modalEl = document.getElementById('confirmModal');
  return {
    modalEl,
    modalMessage:
      modalEl && modalEl.querySelector ? modalEl.querySelector('#modalMessage') : document.getElementById('modalMessage'),
    confirmYes:
      modalEl && modalEl.querySelector ? modalEl.querySelector('#confirmYes') : document.getElementById('confirmYes'),
    confirmNo:
      modalEl && modalEl.querySelector ? modalEl.querySelector('#confirmNo') : document.getElementById('confirmNo')
  };
}

function ensureGlobalConfirmModal() {
  let modal = document.getElementById('globalConfirmModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'globalConfirmModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:100000;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = ''
    + '<div style="width:min(460px,94vw);background:#0f172a;border-radius:12px;padding:18px 22px;box-shadow:0 20px 45px rgba(0,0,0,.45);border:1px solid #1e293b;">'
    + '  <h3 id="globalConfirmTitle" style="margin:0 0 10px 0;color:#f8fafc;font-size:17px;font-weight:700;letter-spacing:.2px;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;"><i class="bx bx-error-circle" aria-hidden="true" style="font-size:20px;color:#fbbf24;"></i><span>Confirmar Ação</span></h3>'
    + '  <p id="globalConfirmMessage" style="margin:0 0 14px 0;color:#cbd5e1;font-size:14px;line-height:1.55;text-align:center;white-space:pre-line;"></p>'
    + '  <div style="height:1px;background:#334155;margin:10px 0 14px 0;"></div>'
    + '  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">'
    + '    <button type="button" id="globalConfirmYes" style="border:0;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#ef4444;color:#fff;"><i class="bx bx-check" style="font-size:16px;"></i> Confirmar</button>'
    + '    <button type="button" id="globalConfirmNo" style="border:1px solid #334155;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#1e293b;color:#e2e8f0;"><i class="bx bx-x" style="font-size:16px;"></i> Cancelar</button>'
    + '  </div>'
    + '</div>';
  document.body.appendChild(modal);
  return modal;
}

function confirmPadrao(message, options = {}) {
  return new Promise((resolve) => {
    const modal = ensureGlobalConfirmModal();
    const msgEl = modal.querySelector('#globalConfirmMessage');
    const yesBtn = modal.querySelector('#globalConfirmYes');
    const noBtn = modal.querySelector('#globalConfirmNo');
    const titleEl = modal.querySelector('#globalConfirmTitle span');
    if (msgEl) msgEl.textContent = message || 'Deseja continuar?';
    if (msgEl && message && String(message).indexOf('\n') >= 0) {
      msgEl.style.whiteSpace = 'pre-line';
    }
    if (titleEl) titleEl.textContent = options.title || 'Confirmar Ação';
    if (yesBtn) {
      yesBtn.style.background = options.danger ? '#ef4444' : '#0ea5e9';
      yesBtn.innerHTML = `<i class="bx bx-check"></i> ${escapeHtml(options.confirmText || 'OK')}`;
    }
    if (noBtn) noBtn.innerHTML = `<i class="bx bx-x"></i> ${escapeHtml(options.cancelText || 'Cancelar')}`;

    function close(result) {
      modal.style.display = 'none';
      if (yesBtn) yesBtn.onclick = null;
      if (noBtn) noBtn.onclick = null;
      modal.onclick = null;
      resolve(result);
    }
    if (yesBtn) yesBtn.onclick = () => close(true);
    if (noBtn) noBtn.onclick = () => close(false);
    modal.onclick = (ev) => {
      if (ev.target === modal) close(false);
    };
    modal.style.display = 'flex';
  });
}

function ensureGlobalPromptModal() {
  let modal = document.getElementById('globalPromptModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'globalPromptModal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(2,6,23,.72);z-index:100000;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = ''
    + '<div style="width:min(460px,94vw);background:#0f172a;border-radius:12px;padding:18px 22px;box-shadow:0 20px 45px rgba(0,0,0,.45);border:1px solid #1e293b;">'
    + '  <h3 id="globalPromptTitle" style="margin:0 0 10px 0;color:#f8fafc;font-size:17px;font-weight:700;letter-spacing:.2px;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;"><i class="bx bx-edit" aria-hidden="true" style="font-size:20px;color:#0ea5e9;"></i><span>Informe os dados</span></h3>'
    + '  <p id="globalPromptMessage" style="margin:0 0 12px 0;color:#cbd5e1;font-size:14px;line-height:1.5;text-align:center;"></p>'
    + '  <input type="text" id="globalPromptInput" autocomplete="off" style="width:100%;padding:9px 12px;font-size:14px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;outline:none;box-sizing:border-box;" />'
    + '  <div style="height:1px;background:#334155;margin:14px 0 14px 0;"></div>'
    + '  <div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap;">'
    + '    <button type="button" id="globalPromptYes" style="border:0;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#0ea5e9;color:#fff;"><i class="bx bx-check" style="font-size:16px;"></i> OK</button>'
    + '    <button type="button" id="globalPromptNo" style="border:1px solid #334155;border-radius:8px;padding:8px 18px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:#1e293b;color:#e2e8f0;"><i class="bx bx-x" style="font-size:16px;"></i> Cancelar</button>'
    + '  </div>'
    + '</div>';
  document.body.appendChild(modal);
  return modal;
}

function promptPadrao(message, options = {}) {
  return new Promise((resolve) => {
    const modal = ensureGlobalPromptModal();
    const msgEl = modal.querySelector('#globalPromptMessage');
    const inputEl = modal.querySelector('#globalPromptInput');
    const yesBtn = modal.querySelector('#globalPromptYes');
    const noBtn = modal.querySelector('#globalPromptNo');
    const titleEl = modal.querySelector('#globalPromptTitle span');
    if (msgEl) msgEl.textContent = message || '';
    if (titleEl) titleEl.textContent = options.title || 'Informe os dados';
    if (inputEl) {
      inputEl.value = options.initial != null ? String(options.initial) : '';
      inputEl.placeholder = options.placeholder || '';
      inputEl.type = options.type === 'number' ? 'number' : 'text';
    }
    if (yesBtn) yesBtn.innerHTML = `<i class="bx bx-check"></i> ${escapeHtml(options.confirmText || 'OK')}`;
    if (noBtn) noBtn.innerHTML = `<i class="bx bx-x"></i> ${escapeHtml(options.cancelText || 'Cancelar')}`;

    function close(result) {
      modal.style.display = 'none';
      if (yesBtn) yesBtn.onclick = null;
      if (noBtn) noBtn.onclick = null;
      if (inputEl) inputEl.onkeydown = null;
      modal.onclick = null;
      resolve(result);
    }
    if (yesBtn) yesBtn.onclick = () => close(inputEl ? inputEl.value : '');
    if (noBtn) noBtn.onclick = () => close(null);
    modal.onclick = (ev) => {
      if (ev.target === modal) close(null);
    };
    if (inputEl) {
      inputEl.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          close(inputEl.value);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          close(null);
        }
      };
    }
    modal.style.display = 'flex';
    setTimeout(() => {
      if (inputEl) {
        inputEl.focus();
        try { inputEl.select(); } catch (_) {}
      }
    }, 30);
  });
}

function resolvePanelTitleIcon(tabContentId, titleId) {
  const base = String(tabContentId || '').toLowerCase();
  const byId = String(titleId || '').toLowerCase();
  if (byId === 'formtitle') return 'bx-edit';
  if (base.includes('ficha')) return 'bx-wrench';
  if (base.includes('document') || base.includes('anexo')) return 'bx-image';
  if (base.includes('veiculo')) return 'bx-car';
  if (base.includes('class')) return 'bx-layer';
  if (base.includes('local')) return 'bx-map';
  if (base.includes('validad')) return 'bx-calendar-check';
  if (base.includes('mapa')) return 'bx-map-alt';
  if (base.includes('grid')) return 'bx-grid-alt';
  if (base.includes('ponto')) return 'bx-map-pin';
  return 'bx-info-circle';
}

function ensurePanelTitleIcons(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const headings = scope.querySelectorAll('.tab-content h2');
  headings.forEach((h2) => {
    if (!h2 || h2.closest('.modal, .modal-content, .swal2-popup')) return;
    const tabContent = h2.closest('.tab-content');
    if (!tabContent) return;
    if (h2.querySelector(':scope > i.bx')) {
      h2.classList.add('form-panel-titulo');
      return;
    }
    const iconClass = resolvePanelTitleIcon(tabContent.id, h2.id);
    const icon = document.createElement('i');
    icon.className = `bx ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    h2.prepend(icon);
    h2.classList.add('form-panel-titulo');
  });
}

function ensurePanelSubtitleIcons(root) {
  const scope = root && root.querySelectorAll ? root : document;
  const headings = scope.querySelectorAll('.tab-content h3');
  headings.forEach((h3) => {
    if (!h3 || h3.closest('.modal, .modal-content, .swal2-popup')) return;
    if (h3.closest('.form-dados-card-header')) return;
    if (h3.querySelector(':scope > i.bx')) {
      h3.classList.add('form-subtitulo-painel');
      return;
    }
    const text = (h3.textContent || '').trim();
    if (!text) return;
    const startsWithEmoji = /^[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(text);
    if (startsWithEmoji) return;

    const tabContent = h3.closest('.tab-content');
    const iconClass = resolvePanelTitleIcon(tabContent && tabContent.id, h3.id);
    const icon = document.createElement('i');
    icon.className = `bx ${iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    h3.prepend(icon);
    h3.classList.add('form-subtitulo-painel');
  });
}

var panelTitleIconObserver = window.panelTitleIconObserver || null;
function watchPanelTitleIconMutations() {
  if (typeof MutationObserver === 'undefined' || panelTitleIconObserver || !document.body) return;
  const rerender = debounce(() => {
    ensurePanelTitleIcons(document);
    ensurePanelSubtitleIcons(document);
  }, 80);
  panelTitleIconObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' || mutation.type === 'characterData') {
        rerender();
        break;
      }
    }
  });
  panelTitleIconObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });
  window.panelTitleIconObserver = panelTitleIconObserver;
}

// Exportar funções para uso global
if (typeof window !== 'undefined') {
  window.showMessage = showMessage;
  window.tocarSomOperadorFeedback = tocarSomOperadorFeedback;
  window.initFeedbackSomOperador = initFeedbackSomOperador;
  window.showLoading = showLoading;
  window.fetchWithErrorHandling = fetchWithErrorHandling;
  window.validateRequired = validateRequired;
  window.validateRequiredFields = validateRequiredFields;
  window.formatValue = formatValue;
  window.formatarMoeda = formatarMoeda;
  window.formatarDataHoraComFuso = formatarDataHoraComFuso;
  window.resolveTimezoneInstalacao = resolveTimezoneInstalacao;
  window.syncAtlasTimezoneInstalacao = syncAtlasTimezoneInstalacao;
  window.dataApiParaDatetimeLocal = dataApiParaDatetimeLocal;
  window.dataApiParaInputDate = dataApiParaInputDate;
  window.agoraParaDatetimeLocal = agoraParaDatetimeLocal;
  window.debounce = debounce;
  window.scrollToElement = scrollToElement;
  window.ensurePanelTitleIcons = ensurePanelTitleIcons;
  window.getConfirmModalElements = getConfirmModalElements;
  window.confirmPadrao = confirmPadrao;
  window.promptPadrao = promptPadrao;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initFeedbackSomOperador();
      ensurePanelTitleIcons(document);
      ensurePanelSubtitleIcons(document);
      watchPanelTitleIconMutations();
    });
  } else {
    initFeedbackSomOperador();
    ensurePanelTitleIcons(document);
    ensurePanelSubtitleIcons(document);
    watchPanelTitleIconMutations();
  }
}

