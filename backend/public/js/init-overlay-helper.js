// ============================================
// Helper Padrão para Overlay de Inicialização
// ============================================
// Função reutilizável para todos os módulos
// Mostra progresso detalhado durante execução do init.sql
// ============================================

(function() {
  'use strict';

  // Funções para controlar overlay de carregamento do init.sql
  window.showLoadingOverlayInitSQL = function(titulo = 'Processando Inicialização', texto = 'Executando scripts de inicialização...', detalhe = 'Isso pode levar alguns segundos.') {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    const loadingTitle = document.getElementById('loadingTitleInitSQL');
    const loadingText = document.getElementById('loadingTextInitSQL');
    const loadingDetail = document.getElementById('loadingDetailInitSQL');
    
    if (overlay && loadingTitle && loadingText && loadingDetail) {
      loadingTitle.textContent = titulo;
      loadingText.textContent = texto;
      loadingDetail.textContent = detalhe;
      overlay.style.display = 'flex';
    }
  };

  window.hideLoadingOverlayInitSQL = function() {
    const overlay = document.getElementById('loadingOverlayInitSQL');
    if (overlay) {
      overlay.style.display = 'none';
    }
  };

  // Função padrão para executar init.sql com progresso detalhado
  window.executarInitSQLPadrao = async function(caminhoInitSQL, endpointAPI, nomeModulo = 'módulo') {
    // Proteção: Se já foi executado, não executar novamente
    const chaveExecutado = `sqlExecutado_${nomeModulo}`;
    if (window[chaveExecutado]) {
      return;
    }
    
    // Marcar como executando IMEDIATAMENTE para evitar execuções simultâneas
    window[chaveExecutado] = true;
    
    // Mostrar overlay de carregamento
    window.showLoadingOverlayInitSQL('Processando Inicialização', 'Carregando script de inicialização...', 'Aguarde enquanto preparamos o módulo.');
    
    try {
      // Carregar o arquivo init.sql
      const response = await fetch(caminhoInitSQL);
      
      // Atualizar mensagem do overlay
      window.showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL...', 'Isso pode levar alguns segundos.');
      
      if (!response.ok) {
        // Se o arquivo não existir, não é erro - apenas não executa nada
        if (response.status === 404) {
          window.hideLoadingOverlayInitSQL();
          return;
        }
        window.hideLoadingOverlayInitSQL();
        return;
      }
      
      const sqlContent = await response.text();
      
      // Remover comentários de bloco /* */ (incluindo multilinhas) usando regex
      let sqlSemComentarios = sqlContent.replace(/\/\*[\s\S]*?\*\//g, '');
      
      // Remover apenas comentários, mas MANTER 'GO' pois o backend precisa dele para dividir comandos
      const sqlLimpo = sqlSemComentarios
        .split('\n')
        .filter(linha => {
          const linhaTrim = linha.trim();
          // Manter linhas que não são apenas comentários vazios
          // IMPORTANTE: Manter 'GO' pois o backend precisa dele para dividir comandos
          return linhaTrim.length > 0 && 
                 !linhaTrim.startsWith('--');
        })
        .join('\n')
        .trim();
      
      // Se não há SQL para executar, retornar
      if (!sqlLimpo || sqlLimpo.length === 0) {
        window.hideLoadingOverlayInitSQL();
        return;
      }
      
      // Extrair lista de stored procedures que serão executadas para mostrar progresso
      const procedures = [];
      const linhas = sqlLimpo.split('\n');
      linhas.forEach(linha => {
        const linhaUpper = linha.toUpperCase().trim();
        // Procurar por EXEC ou EXECUTE seguido de nome de procedure
        const match = linhaUpper.match(/EXEC(?:UTE)?\s+(?:\[DBO\]\.)?\[?(\w+)\]?/);
        if (match && match[1]) {
          const procName = match[1];
          // Remover prefixo SP_ se existir para melhor legibilidade
          const nomeLimpo = procName.replace(/^SP_/, '');
          if (!procedures.includes(nomeLimpo)) {
            procedures.push(nomeLimpo);
          }
        }
      });
      
      // Contar comandos GO para saber quantos comandos serão executados
      const comandosGO = sqlLimpo.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
      const totalComandos = comandosGO.length;
      
      // Atualizar mensagem: mostrar quantas procedures serão executadas
      if (procedures.length > 0) {
        window.showLoadingOverlayInitSQL(
          'Processando Inicialização', 
          `Executando ${totalComandos} comando(s) SQL...`, 
          `Procedures: ${procedures.slice(0, 5).join(', ')}${procedures.length > 5 ? ` (+${procedures.length - 5} mais)` : ''}`
        );
        
        // Iniciar simulação de progresso (atualizar a cada 2 segundos)
        let comandoAtual = 0;
        const chaveIntervalo = `intervaloInitSQL_${nomeModulo}`;
        const intervaloProgresso = setInterval(() => {
          comandoAtual++;
          if (comandoAtual <= totalComandos) {
            const procedureAtual = procedures[comandoAtual - 1] || 'Comando SQL';
            window.showLoadingOverlayInitSQL(
              'Processando Inicialização', 
              `Executando comando ${comandoAtual} de ${totalComandos}...`, 
              `Em execução: ${procedureAtual}`
            );
          }
        }, 2000); // Atualizar a cada 2 segundos
        
        // Armazenar intervalo para limpar depois
        window[chaveIntervalo] = intervaloProgresso;
      } else {
        window.showLoadingOverlayInitSQL('Processando Inicialização', 'Executando comandos SQL no banco de dados...', 'Aguarde, isso pode levar alguns segundos.');
      }
      
      // Executar o SQL via API e AGUARDAR completamente a resposta
      let execResponse;
      try {
        execResponse = await fetch(endpointAPI, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql: sqlLimpo }),
          // Aumentar timeout para scripts grandes (MERGE pode demorar)
          signal: AbortSignal.timeout(120000) // 120 segundos (2 minutos)
        });
      } catch (fetchError) {
        // Limpar intervalo de progresso se existir
        if (window[chaveIntervalo]) {
          clearInterval(window[chaveIntervalo]);
          delete window[chaveIntervalo];
        }
        
        if (fetchError.name === 'TimeoutError' || fetchError.name === 'AbortError') {
          window.hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        if (fetchError.message.includes('ERR_CONNECTION_RESET') || fetchError.message.includes('Failed to fetch')) {
          window.hideLoadingOverlayInitSQL();
          return; // Não bloquear o módulo
        }
        window.hideLoadingOverlayInitSQL();
        return;
      }
      
      // Verificar se a resposta foi bem-sucedida
      if (!execResponse.ok) {
        // Limpar intervalo de progresso se existir
        if (window[chaveIntervalo]) {
          clearInterval(window[chaveIntervalo]);
          delete window[chaveIntervalo];
        }
        window.hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Atualizar mensagem: processando resultados
      window.showLoadingOverlayInitSQL('Processando Inicialização', 'Processando resultados...', 'Quase terminando.');
      
      // Aguardar completamente a resposta JSON
      let result;
      try {
        result = await execResponse.json();
      } catch (jsonError) {
        // Limpar intervalo de progresso se existir
        if (window[chaveIntervalo]) {
          clearInterval(window[chaveIntervalo]);
          delete window[chaveIntervalo];
        }
        window.hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se todos os comandos foram executados com sucesso
      if (!result.success) {
        // Limpar intervalo de progresso se existir
        if (window[chaveIntervalo]) {
          clearInterval(window[chaveIntervalo]);
          delete window[chaveIntervalo];
        }
        window.hideLoadingOverlayInitSQL();
        return; // Não bloquear o módulo
      }
      
      // Verificar se há resultados e se todos os comandos foram executados
      if (result.resultados && Array.isArray(result.resultados)) {
        const comandosComErro = result.resultados.filter(r => r.tipo === 'ERRO');
        if (comandosComErro.length > 0) {
          // Filtrar erros "esperados" (como tabela já existe, índice já existe, etc.)
          const errosReais = comandosComErro.filter(erro => {
            const mensagem = (erro.mensagem || erro.erro || '').toLowerCase();
            // Erros esperados que não são problemas reais
            const errosEsperados = [
              'already exists',
              'já existe',
              'duplicate',
              'duplicado',
              'there is already',
              'já há'
            ];
            return !errosEsperados.some(esperado => mensagem.includes(esperado));
          });
          
          if (errosReais.length > 0) {
            // Log apenas erros reais críticos
            errosReais.forEach(erro => {
              const mensagem = erro.mensagem || erro.erro || erro.message || erro.error || 'Erro desconhecido';
              if (typeof mensagem === 'object') {
                console.error(`Erro no init.sql [${nomeModulo}]:`, JSON.stringify(mensagem));
              } else {
                console.error(`Erro no init.sql [${nomeModulo}]:`, mensagem);
              }
            });
          }
        }
      }
      
      // Limpar intervalo de progresso se existir
      if (window[chaveIntervalo]) {
        clearInterval(window[chaveIntervalo]);
        delete window[chaveIntervalo];
      }
      
      // Aguardar um pouco mais para garantir que todas as operações foram concluídas
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Esconder overlay após conclusão bem-sucedida
      window.hideLoadingOverlayInitSQL();
      
    } catch (err) {
      // Limpar intervalo de progresso se existir
      const chaveIntervalo = `intervaloInitSQL_${nomeModulo}`;
      if (window[chaveIntervalo]) {
        clearInterval(window[chaveIntervalo]);
        delete window[chaveIntervalo];
      }
      
      // Esconder overlay em caso de erro
      window.hideLoadingOverlayInitSQL();
      // Erros silenciosos - não bloquear o módulo
    }
  };

})();

