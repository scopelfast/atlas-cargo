// Console Visual para Mobile - Debug em Tempo Real

(function() {
  // Criar overlay de console
  const consoleOverlay = document.createElement('div');
  consoleOverlay.id = 'mobileConsole';
  consoleOverlay.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(0,0,0,0.95);
    color: #0f0;
    font-family: monospace;
    font-size: 11px;
    max-height: 40vh;
    overflow-y: auto;
    z-index: 99999;
    display: none;
    padding: 10px;
    line-height: 1.4;
    border-top: 3px solid #667eea;
  `;

  // Botão toggle
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'consoleToggle';
  toggleBtn.textContent = '🐛';
  toggleBtn.style.cssText = `
    position: fixed;
    bottom: 10px;
    right: 10px;
    width: 50px;
    height: 50px;
    border-radius: 50%;
    background: #667eea;
    color: white;
    border: none;
    font-size: 24px;
    cursor: pointer;
    z-index: 100000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;

  toggleBtn.onclick = () => {
    const isVisible = consoleOverlay.style.display === 'block';
    consoleOverlay.style.display = isVisible ? 'none' : 'block';
    toggleBtn.textContent = isVisible ? '🐛' : '✖';
  };

  document.body.appendChild(consoleOverlay);
  document.body.appendChild(toggleBtn);

  // Interceptar console.log
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  function addToConsole(msg, tipo = 'log') {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const color = {
      log: '#0f0',
      error: '#f00',
      warn: '#ff0'
    }[tipo];

    const linha = document.createElement('div');
    linha.style.color = color;
    linha.style.marginBottom = '4px';
    linha.textContent = `[${timestamp}] ${msg}`;
    
    consoleOverlay.appendChild(linha);
    consoleOverlay.scrollTop = consoleOverlay.scrollHeight;

    // Limitar a 100 linhas
    while (consoleOverlay.children.length > 100) {
      consoleOverlay.removeChild(consoleOverlay.firstChild);
    }
  }

  console.log = function(...args) {
    originalLog.apply(console, args);
    addToConsole(args.join(' '), 'log');
  };

  console.error = function(...args) {
    originalError.apply(console, args);
    addToConsole('❌ ' + args.join(' '), 'error');
  };

  console.warn = function(...args) {
    originalWarn.apply(console, args);
    addToConsole('⚠️ ' + args.join(' '), 'warn');
  };

  // Botões de controle
  const controles = document.createElement('div');
  controles.style.cssText = `
    position: sticky;
    top: 0;
    display: flex;
    gap: 8px;
    margin-bottom: 8px;
  `;
  
  const btnLimpar = document.createElement('button');
  btnLimpar.textContent = '🗑️ Limpar';
  btnLimpar.style.cssText = `
    flex: 1;
    padding: 8px;
    background: #667eea;
    color: white;
    border: none;
    font-weight: 700;
    cursor: pointer;
    border-radius: 6px;
  `;
  btnLimpar.onclick = () => {
    consoleOverlay.innerHTML = '';
    consoleOverlay.appendChild(controles);
    addToConsole('Console limpo', 'log');
  };
  
  const btnLimparFila = document.createElement('button');
  btnLimparFila.textContent = '🧹 Limpar Fila';
  btnLimparFila.style.cssText = `
    flex: 1;
    padding: 8px;
    background: #dc3545;
    color: white;
    border: none;
    font-weight: 700;
    cursor: pointer;
    border-radius: 6px;
  `;
  btnLimparFila.onclick = async () => {
    // Usar modal styled se disponível, senão usar confirm nativo
    let confirmado = false;
    
    if (typeof mostrarModal === 'function') {
      const resposta = await mostrarModal(
        'Limpar Fila Offline',
        'Deseja limpar TODA a fila de sincronização?\n\nIsso removerá todos os dados pendentes de envio.',
        ['Cancelar', 'Limpar Tudo']
      );
      confirmado = resposta === 'Limpar Tudo';
    } else {
      const respostaConfirm = await mostrarModal(
        'Limpar Fila Offline',
        'Deseja limpar TODA a fila offline?',
        ['Cancelar', 'Limpar Tudo']
      );
      confirmado = respostaConfirm === 'Limpar Tudo';
    }
    
    if (confirmado) {
      await window.OfflineDB.limparTodasFilas();
      addToConsole('🧹 Filas limpas!', 'log');
      await window.OfflineDB.atualizarIndicador();
      
      if (typeof mostrarToast === 'function') {
        mostrarToast('Filas offline limpas com sucesso!', 'success');
      }
    }
  };
  
  controles.appendChild(btnLimpar);
  controles.appendChild(btnLimparFila);
  consoleOverlay.appendChild(controles);

  console.log('✅ Console Mobile ativado - Clique no botão 🐛 para abrir');
})();

