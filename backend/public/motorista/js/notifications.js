// Sistema de Notificações Profissional
// Toast + Modais Estilizados

(function() {
  // ==========================================
  // ESTILOS (Injetados automaticamente)
  // ==========================================
  const styles = `
    /* TOAST */
    .toast-container {
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 10px;
      pointer-events: none;
    }
    
    .toast {
      background: white;
      padding: 16px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 300px;
      max-width: 90vw;
      pointer-events: all;
      animation: slideIn 0.3s ease-out;
      border-left: 4px solid #667eea;
    }
    
    @keyframes slideIn {
      from { transform: translateX(400px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    
    .toast.saindo {
      animation: slideOut 0.3s ease-in forwards;
    }
    
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(400px); opacity: 0; }
    }
    
    .toast-icon {
      font-size: 24px;
      flex-shrink: 0;
    }
    
    .toast-conteudo {
      flex: 1;
    }
    
    .toast-titulo {
      font-weight: 700;
      font-size: 14px;
      margin-bottom: 4px;
      color: #333;
    }
    
    .toast-mensagem {
      font-size: 13px;
      color: #666;
    }
    
    .toast.success { border-left-color: #28a745; }
    .toast.error { border-left-color: #dc3545; }
    .toast.warning { border-left-color: #ffc107; }
    .toast.info { border-left-color: #17a2b8; }
    
    /* MODAL */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: none;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s;
    }
    
    .modal-overlay.ativo {
      display: flex;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    .modal {
      background: white;
      border-radius: 20px;
      padding: 24px;
      max-width: 400px;
      width: 90%;
      box-shadow: 0 10px 40px rgba(0,0,0,0.3);
      animation: scaleIn 0.3s ease-out;
    }
    
    @keyframes scaleIn {
      from { transform: scale(0.8); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    
    .modal-icone {
      font-size: 56px;
      text-align: center;
      margin-bottom: 16px;
    }
    
    .modal-titulo {
      font-size: 20px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 12px;
      color: #333;
    }
    
    .modal-mensagem {
      font-size: 15px;
      text-align: center;
      color: #666;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    
    .modal-botoes {
      display: flex;
      gap: 12px;
    }
    
    .modal-btn {
      flex: 1;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: transform 0.1s;
    }
    
    .modal-btn:active {
      transform: scale(0.95);
    }
    
    .modal-btn-confirmar {
      background: #28a745;
      color: white;
    }
    
    .modal-btn-cancelar {
      background: #e9ecef;
      color: #666;
    }
    
    @media (max-width: 480px) {
      .toast-container {
        top: 10px;
        right: 10px;
        left: 10px;
      }
      
      .toast {
        min-width: auto;
      }
    }
  `;

  // Injetar estilos
  const styleSheet = document.createElement('style');
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);

  // Criar containers
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  document.body.appendChild(modalOverlay);

  // ==========================================
  // TOAST
  // ==========================================
  function mostrarToast(mensagem, tipo = 'info', duracao = 3000) {
    const icones = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };

    const titulos = {
      success: 'Sucesso',
      error: 'Erro',
      warning: 'Atenção',
      info: 'Informação'
    };

    const toast = document.createElement('div');
    toast.className = `toast ${tipo}`;
    toast.innerHTML = `
      <div class="toast-icon">${icones[tipo]}</div>
      <div class="toast-conteudo">
        <div class="toast-titulo">${titulos[tipo]}</div>
        <div class="toast-mensagem">${mensagem}</div>
      </div>
    `;

    toastContainer.appendChild(toast);

    // Auto-remover
    setTimeout(() => {
      toast.classList.add('saindo');
      setTimeout(() => toast.remove(), 300);
    }, duracao);
  }

  // ==========================================
  // MODAL DE CONFIRMAÇÃO
  // ==========================================
  function mostrarConfirmacao(opcoes) {
    return new Promise((resolve) => {
      const {
        titulo = 'Confirmar',
        mensagem = 'Deseja continuar?',
        icone = '❓',
        confirmar = 'Confirmar',
        cancelar = 'Cancelar'
      } = opcoes;

      modalOverlay.innerHTML = `
        <div class="modal">
          <div class="modal-icone">${icone}</div>
          <div class="modal-titulo">${titulo}</div>
          <div class="modal-mensagem">${mensagem}</div>
          <div class="modal-botoes">
            <button class="modal-btn modal-btn-cancelar" onclick="window.Notificacoes.fecharModal(false)">
              ${cancelar}
            </button>
            <button class="modal-btn modal-btn-confirmar" onclick="window.Notificacoes.fecharModal(true)">
              ${confirmar}
            </button>
          </div>
        </div>
      `;

      modalOverlay.classList.add('ativo');

      // Guardar resolve
      modalOverlay.dataset.resolve = 'pending';
      window._modalResolve = resolve;
    });
  }

  function fecharModal(resultado) {
    modalOverlay.classList.remove('ativo');
    if (window._modalResolve) {
      window._modalResolve(resultado);
      window._modalResolve = null;
    }
  }

  // Fechar modal clicando fora
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) {
      fecharModal(false);
    }
  });

  // ==========================================
  // EXPORTAR
  // ==========================================
  window.Notificacoes = {
    toast: mostrarToast,
    confirmar: mostrarConfirmacao,
    fecharModal,
    
    // Atalhos
    sucesso: (msg, duracao) => mostrarToast(msg, 'success', duracao),
    erro: (msg, duracao) => mostrarToast(msg, 'error', duracao),
    aviso: (msg, duracao) => mostrarToast(msg, 'warning', duracao),
    info: (msg, duracao) => mostrarToast(msg, 'info', duracao)
  };

  console.log('✅ Sistema de notificações carregado');
})();

