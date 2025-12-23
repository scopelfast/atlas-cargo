/**
 * Script para aplicar correção da Stored Procedure SP_INTGRACAO_VALIDADE
 * 
 * Execute este script no console do navegador (F12) quando estiver logado no sistema.
 * 
 * Uso:
 *   1. Abra o console do navegador (F12)
 *   2. Cole e execute este código
 *   3. Aguarde a confirmação
 */

(async function aplicarCorrecaoSPValidade() {
  try {
    console.log('🔧 Aplicando correção da SP_INTGRACAO_VALIDADE...');
    
    const token = localStorage.getItem('token');
    if (!token) {
      throw new Error('Você precisa estar logado no sistema!');
    }

    // Função helper para corrigir URLs
    const corrigirUrl = (url) => {
      if (!url) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
      return baseUrl + (url.startsWith('/') ? url : '/' + url);
    };

    const response = await fetch(corrigirUrl('/api/cadastros-gerais/aplicar-correcao-sp-validade'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      }
    });

    const data = await response.json();

    if (data.success) {
      console.log('✅ Correção aplicada com sucesso!');
      console.log('📊 Resultados:', data.resultados);
      console.log('📝 Total de comandos executados:', data.totalComandos);
      alert('✅ Correção aplicada com sucesso!\n\nA stored procedure SP_INTGRACAO_VALIDADE foi corrigida.\nRecarregue a página para verificar.');
    } else {
      console.error('❌ Erro ao aplicar correção:', data);
      if (data.erros && data.erros.length > 0) {
        console.error('📋 Erros detalhados:', data.erros);
      }
      alert('❌ Erro ao aplicar correção:\n' + (data.error || 'Erro desconhecido'));
    }
  } catch (err) {
    console.error('❌ Erro:', err);
    alert('❌ Erro ao aplicar correção:\n' + err.message);
  }
})();
