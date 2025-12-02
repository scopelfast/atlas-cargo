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

  // Botão limpar
  const btnLimpar = document.createElement('button');
  btnLimpar.textContent = '🗑️ Limpar';
  btnLimpar.style.cssText = `
    position: sticky;
    top: 0;
    width: 100%;
    padding: 8px;
    background: #667eea;
    color: white;
    border: none;
    font-weight: 700;
    cursor: pointer;
    margin-bottom: 8px;
  `;
  btnLimpar.onclick = () => {
    consoleOverlay.innerHTML = '';
    consoleOverlay.appendChild(btnLimpar);
    addToConsole('Console limpo', 'log');
  };
  
  consoleOverlay.appendChild(btnLimpar);

  console.log('✅ Console Mobile ativado - Clique no botão 🐛 para abrir');
})();

