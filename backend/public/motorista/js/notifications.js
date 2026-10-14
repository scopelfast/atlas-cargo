// APP Motorista - Sistema de Notificações Profissional
// Versão: 2.0 - Toasts e Modais Bonitos

// ==========================================
// TOAST (Notificação)
// ==========================================

function mostrarToast(mensagem, tipo = 'info') {
  // Remover toast anterior se existir
  const toastAnterior = document.querySelector('.toast-notification');
  if (toastAnterior) {
    toastAnterior.remove();
  }

  // Criar toast
  const toast = document.createElement('div');
  toast.className = `toast-notification toast-${tipo}`;
  
  // Ícones por tipo
  const icones = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️'
  };
  
  toast.innerHTML = `
    <div class="toast-icon">${icones[tipo] || 'ℹ️'}</div>
    <div class="toast-message">${mensagem.replace(/\n/g, '<br>')}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;
  
  document.body.appendChild(toast);
  
  // Animar entrada
  setTimeout(() => toast.classList.add('show'), 10);
  
  // Remover após 5 segundos
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// ==========================================
// MODAL DE CONFIRMAÇÃO
// ==========================================

function mostrarModal(titulo, mensagem, botoes = ['Cancelar', 'OK']) {
  return new Promise((resolve) => {
    // Remover modal anterior se existir
    const modalAnterior = document.querySelector('.modal-overlay');
    if (modalAnterior) {
      modalAnterior.remove();
    }

    // Criar overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    // Criar modal
    const modal = document.createElement('div');
    modal.className = 'modal-dialog';
    
    modal.innerHTML = `
      <div class="modal-header">
        <div class="modal-title">${titulo}</div>
      </div>
      <div class="modal-body">
        <p>${mensagem.replace(/\n/g, '<br>')}</p>
      </div>
      <div class="modal-footer">
        ${botoes.map((btn, index) => `
          <button class="modal-btn ${index === botoes.length - 1 ? 'modal-btn-primary' : 'modal-btn-secondary'}" 
                  data-action="${btn}">
            ${btn}
          </button>
        `).join('')}
      </div>
    `;
    
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    
    // Animar entrada
    setTimeout(() => {
      overlay.classList.add('show');
      modal.classList.add('show');
    }, 10);
    
    // Event listeners nos botões
    modal.querySelectorAll('.modal-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        
        // Animar saída
        overlay.classList.remove('show');
        modal.classList.remove('show');
        
        setTimeout(() => {
          overlay.remove();
          resolve(action);
        }, 300);
      });
    });
    
    // Clicar fora fecha (retorna primeiro botão)
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.remove('show');
        modal.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(botoes[0]);
        }, 300);
      }
    });
  });
}

// ==========================================
// LOADING (Indicador de carregamento)
// ==========================================

function mostrarLoading(mensagem = 'Carregando...') {
  // Remover loading anterior
  const loadingAnterior = document.querySelector('.loading-overlay');
  if (loadingAnterior) {
    loadingAnterior.remove();
  }

  const loading = document.createElement('div');
  loading.className = 'loading-overlay';
  
  loading.innerHTML = `
    <div class="loading-spinner"></div>
    <div class="loading-text">${mensagem}</div>
  `;
  
  document.body.appendChild(loading);
  setTimeout(() => loading.classList.add('show'), 10);
  
  return loading;
}

function esconderLoading() {
  const loading = document.querySelector('.loading-overlay');
  if (loading) {
    loading.classList.remove('show');
    setTimeout(() => loading.remove(), 300);
  }
}

// ==========================================
// ESTILOS CSS (Injetados automaticamente)
// ==========================================

if (!document.getElementById('notifications-styles')) {
  const styles = document.createElement('style');
  styles.id = 'notifications-styles';
  styles.textContent = `
    /* TOAST */
    .toast-notification {
      position: fixed;
      top: 20px;
      right: 20px;
      left: 20px;
      max-width: 500px;
      margin: 0 auto;
      background: white;
      border-radius: 15px;
      padding: 15px 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 10000;
      transform: translateY(-100px);
      opacity: 0;
      transition: all 0.3s ease;
    }
    
    .toast-notification.show {
      transform: translateY(0);
      opacity: 1;
    }
    
    .toast-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    
    .toast-message {
      flex: 1;
      font-size: 14px;
      color: #333;
      line-height: 1.4;
    }
    
    .toast-close {
      background: transparent;
      border: none;
      font-size: 24px;
      color: #999;
      cursor: pointer;
      padding: 0;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
    }
    
    .toast-success { border-left: 5px solid #28a745; }
    .toast-error { border-left: 5px solid #dc3545; }
    .toast-warning { border-left: 5px solid #ffc107; }
    .toast-info { border-left: 5px solid #17a2b8; }
    
    /* MODAL */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .modal-overlay.show {
      opacity: 1;
    }
    
    .modal-dialog {
      background: white;
      border-radius: 20px;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      transform: scale(0.9);
      opacity: 0;
      transition: all 0.3s ease;
    }
    
    .modal-dialog.show {
      transform: scale(1);
      opacity: 1;
    }
    
    .modal-header {
      padding: 20px;
      border-bottom: 1px solid #f0f0f0;
    }
    
    .modal-title {
      font-size: 20px;
      font-weight: bold;
      color: #333;
    }
    
    .modal-body {
      padding: 20px;
    }
    
    .modal-body p {
      font-size: 15px;
      color: #666;
      line-height: 1.6;
      margin: 0;
    }
    
    .modal-footer {
      padding: 15px 20px;
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }
    
    .modal-btn {
      padding: 12px 24px;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    
    .modal-btn:active {
      transform: scale(0.95);
    }
    
    .modal-btn-secondary {
      background: #f0f0f0;
      color: #666;
    }
    
    .modal-btn-primary {
      background: #0ea5e9;
      color: white;
    }
    
    /* LOADING */
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.7);
      z-index: 10001;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.3s ease;
    }
    
    .loading-overlay.show {
      opacity: 1;
    }
    
    .loading-spinner {
      width: 50px;
      height: 50px;
      border: 5px solid rgba(255,255,255,0.3);
      border-top-color: white;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    .loading-text {
      margin-top: 20px;
      color: white;
      font-size: 16px;
      font-weight: 600;
    }
  `;
  
  document.head.appendChild(styles);
}

// Log só com: localStorage.setItem('motorista_debug','1')
try {
  if (localStorage.getItem('motorista_debug') === '1') {
    console.log('[notifications] carregado');
  }
} catch (e) {}
