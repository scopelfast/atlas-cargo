// Configuração do Sistema Offline
// Permite escolher entre IndexedDB nativo ou Dexie.js
// Versão: 1.0

(function() {
  'use strict';

  // ==========================================
  // CONFIGURAÇÃO
  // ==========================================
  
  // Escolha qual sistema usar:
  // - 'native': IndexedDB nativo (sistema atual, padrão)
  // - 'dexie': Dexie.js (versão melhorada, opcional)
  window.OFFLINE_MODE = window.OFFLINE_MODE || 'native';

  // Verificar se Dexie está disponível (se escolhido)
  if (window.OFFLINE_MODE === 'dexie') {
    // Tentar carregar Dexie dinamicamente
    const dexieScript = document.createElement('script');
    dexieScript.type = 'module';
    dexieScript.src = '/motorista/js/offline-dexie.js';
    dexieScript.onerror = function() {
      console.warn('⚠️ Dexie não disponível, usando IndexedDB nativo');
      window.OFFLINE_MODE = 'native';
    };
    document.head.appendChild(dexieScript);
  }

  console.log(`📦 Sistema Offline: ${window.OFFLINE_MODE === 'dexie' ? 'Dexie.js' : 'IndexedDB nativo'}`);

  // ==========================================
  // FUNÇÃO PARA ALTERNAR ENTRE SISTEMAS
  // ==========================================
  
  /**
   * Alternar entre IndexedDB nativo e Dexie.js
   * @param {string} mode - 'native' ou 'dexie'
   */
  window.switchOfflineMode = function(mode) {
    if (mode !== 'native' && mode !== 'dexie') {
      console.error('❌ Modo inválido. Use "native" ou "dexie"');
      return;
    }
    
    window.OFFLINE_MODE = mode;
    localStorage.setItem('offlineMode', mode);
    console.log(`✅ Modo offline alterado para: ${mode}`);
    console.log('⚠️ Recarregue a página para aplicar a mudança');
  };

  // Carregar preferência salva
  const savedMode = localStorage.getItem('offlineMode');
  if (savedMode && (savedMode === 'native' || savedMode === 'dexie')) {
    window.OFFLINE_MODE = savedMode;
  }

})();
