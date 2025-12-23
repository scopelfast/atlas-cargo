// ============================================
// Log Helper - Sistema de Rastreamento de Ações
// ============================================
// Helper para registrar todas as ações dos usuários no sistema
// ============================================

(function() {
  'use strict';

  // Cache do token e usuário
  let cachedToken = null;
  let cachedUser = null;

  // Função para obter dados do usuário
  function getUsuario() {
    if (!cachedUser) {
      try {
        const userStr = localStorage.getItem('user');
        if (userStr) {
          cachedUser = JSON.parse(userStr);
        }
      } catch (e) {
        console.error('Erro ao obter usuário:', e);
      }
    }
    return cachedUser;
  }

  // Função para obter token
  function getToken() {
    if (!cachedToken) {
      cachedToken = localStorage.getItem('token');
    }
    return cachedToken;
  }

  // Função para obter IP (aproximado via API pública)
  async function getIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (e) {
      return null;
    }
  }

  // Função principal para registrar ação
  async function registrarAcao(tipoAcao, modulo, descricao, detalhes = null, idRegistro = null, tabela = null) {
    try {
      const user = getUsuario();
      const token = getToken();

      if (!user || !token) {
        // Silencioso - não registrar se não houver usuário logado
        return;
      }

      // Preparar dados
      const dados = {
        tipoAcao: tipoAcao,
        modulo: modulo || window.location.pathname.split('/').pop() || 'desconhecido',
        descricao: descricao || `${tipoAcao} em ${modulo || 'sistema'}`,
        detalhes: detalhes,
        idRegistro: idRegistro,
        tabela: tabela,
        userAgent: navigator.userAgent
      };

      // Registrar no backend (assíncrono, não bloquear)
      // Usar corrigirUrl global se disponível, senão usar função local
      const corrigirUrlLog = (typeof window.corrigirUrl === 'function') 
        ? window.corrigirUrl 
        : (url) => {
            if (!url) return url;
            if (url.startsWith('http://') || url.startsWith('https://')) return url;
            const baseUrl = window.__BASE_URL__ || (window.location.protocol + '//' + window.location.host);
            return baseUrl + (url.startsWith('/') ? url : '/' + url);
          };
      
      fetch(corrigirUrlLog('/api/log/registrar'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'user-login': user.login || ''
        },
        body: JSON.stringify(dados)
      }).catch(err => {
        // Silencioso - não mostrar erro ao usuário
        console.error('[LOG] Erro ao registrar log:', err);
      });

    } catch (err) {
      // Mostrar erro para debug
      console.error('[LOG] Erro no log-helper:', err);
    }
  }

  // ============================================
  // Funções auxiliares para tipos de ação
  // ============================================

  /**
   * Registrar abertura de tela/módulo
   */
  window.logAberturaTela = function(modulo, descricao = null) {
    registrarAcao(
      'Abertura de Tela',
      modulo,
      descricao || `Abertura do módulo: ${modulo}`
    );
  };

  /**
   * Registrar inclusão de registro
   */
  window.logInclusao = function(modulo, tabela, idRegistro, detalhes = null) {
    registrarAcao(
      'Inclusão',
      modulo,
      `Inclusão de registro em ${tabela}`,
      detalhes,
      idRegistro,
      tabela
    );
  };

  /**
   * Registrar alteração de registro
   */
  window.logAlteracao = function(modulo, tabela, idRegistro, detalhes = null) {
    registrarAcao(
      'Alteração',
      modulo,
      `Alteração de registro em ${tabela}`,
      detalhes,
      idRegistro,
      tabela
    );
  };

  /**
   * Registrar exclusão de registro
   */
  window.logExclusao = function(modulo, tabela, idRegistro, detalhes = null) {
    registrarAcao(
      'Exclusão',
      modulo,
      `Exclusão de registro em ${tabela}`,
      detalhes,
      idRegistro,
      tabela
    );
  };

  /**
   * Registrar pesquisa/filtro
   */
  window.logPesquisa = function(modulo, filtros, descricao = null) {
    registrarAcao(
      'Pesquisa',
      modulo,
      descricao || `Pesquisa realizada em ${modulo}`,
      { filtros: filtros }
    );
  };

  /**
   * Registrar exportação
   */
  window.logExportacao = function(modulo, formato, quantidade) {
    registrarAcao(
      'Exportação',
      modulo,
      `Exportação de ${quantidade || 'dados'} em formato ${formato}`,
      { formato, quantidade }
    );
  };

  /**
   * Registrar impressão
   */
  window.logImpressao = function(modulo, descricao = null) {
    registrarAcao(
      'Impressão',
      modulo,
      descricao || `Impressão realizada em ${modulo}`
    );
  };

  /**
   * Registrar ação genérica
   */
  window.logAcao = function(tipoAcao, modulo, descricao, detalhes = null, idRegistro = null, tabela = null) {
    registrarAcao(tipoAcao, modulo, descricao, detalhes, idRegistro, tabela);
  };

  // ============================================
  // Funções específicas para Gerenciar Viagens
  // ============================================

  /**
   * Registrar acionamento de motoristas
   */
  window.logAcionamento = function(idViagem, quantidadeMotoristas, detalhes = null) {
    registrarAcao(
      'Acionamento',
      'gerenciar-viagens',
      `Acionamento de ${quantidadeMotoristas} motorista(s) para viagem ${idViagem}`,
      { idViagem, quantidadeMotoristas, ...detalhes },
      idViagem,
      'VIAGEM'
    );
  };

  /**
   * Registrar criação de convocação
   */
  window.logConvocacao = function(idViagem, idConvocacao, idMotorista, tipo = 'Criação', detalhes = null) {
    registrarAcao(
      `Convocação - ${tipo}`,
      'gerenciar-viagens',
      `Convocação ${tipo.toLowerCase()} para viagem ${idViagem}`,
      { idViagem, idConvocacao, idMotorista, tipo, ...detalhes },
      idConvocacao,
      'CONVOCACAO'
    );
  };

  /**
   * Registrar envio de WhatsApp manual
   */
  window.logWhatsAppManual = function(idViagem, quantidade, detalhes = null) {
    registrarAcao(
      'Envio WhatsApp Manual',
      'gerenciar-viagens',
      `Envio manual de WhatsApp para ${quantidade} motorista(s) - Viagem ${idViagem}`,
      { idViagem, quantidade, tipo: 'manual', ...detalhes },
      idViagem,
      'VIAGEM'
    );
  };

  /**
   * Registrar envio de WhatsApp automático
   */
  window.logWhatsAppAutomatico = function(idViagem, quantidade, detalhes = null) {
    registrarAcao(
      'Envio WhatsApp Automático',
      'gerenciar-viagens',
      `Envio automático de WhatsApp para ${quantidade} motorista(s) - Viagem ${idViagem}`,
      { idViagem, quantidade, tipo: 'automatico', ...detalhes },
      idViagem,
      'VIAGEM'
    );
  };

  /**
   * Registrar confirmação de convocação
   */
  window.logConfirmacao = function(idViagem, idConvocacao, idMotorista, detalhes = null) {
    registrarAcao(
      'Confirmação de Convocação',
      'gerenciar-viagens',
      `Convocação ${idConvocacao} confirmada para viagem ${idViagem}`,
      { idViagem, idConvocacao, idMotorista, ...detalhes },
      idConvocacao,
      'CONVOCACAO'
    );
  };

  /**
   * Registrar reativação de convocação
   */
  window.logReativacao = function(idViagem, idConvocacao, idMotorista, motivo, detalhes = null) {
    registrarAcao(
      'Reativação de Convocação',
      'gerenciar-viagens',
      `Convocação ${idConvocacao} reativada para viagem ${idViagem}`,
      { idViagem, idConvocacao, idMotorista, motivo, ...detalhes },
      idConvocacao,
      'CONVOCACAO'
    );
  };

  // ============================================
  // Interceptação automática de eventos
  // ============================================

  // Interceptar cliques em TODOS os botões e links de ação
  document.addEventListener('click', function(e) {
    const target = e.target;
    
    // Verificar se é um botão (incluindo ícones dentro de botões)
    let button = null;
    if (target.tagName === 'BUTTON') {
      button = target;
    } else if (target.closest('button')) {
      button = target.closest('button');
    } else if (target.tagName === 'A') {
      // Links que são botões ou links de ação específicos
      const linkText = target.textContent.trim().toLowerCase();
      const linkHref = target.href || '';
      const linkClass = target.className || '';
      
      // Capturar links que são claramente ações do usuário
      if (linkClass.includes('btn') || 
          linkText.match(/manual|documentação|documentacao|guia|carregar|salvar|editar|excluir|novo|calcular|filtrar|pesquisar|limpar|cancelar|ver.*dados|remover|nova.*validade/i) ||
          linkHref.match(/javascript:|#/)) {
        button = target;
      }
    }
    
    if (!button) return;
    
    // Obter texto do botão (remover espaços e quebras de linha)
    let text = button.textContent.trim().replace(/\s+/g, ' ');
    const id = button.id || '';
    const className = button.className || '';
    
    // Obter módulo atual
    // Prioridade: 1. Módulo atual do dashboard (sessionStorage ou window.currentModule)
    //             2. Extrair do pathname se estiver em /modulos/
    //             3. Usar pathname como fallback
    let modulo = 'desconhecido';
    
    // Verificar se há módulo ativo no dashboard
    if (window.currentModule) {
      modulo = window.currentModule;
    } else if (sessionStorage.getItem('currentModule')) {
      modulo = sessionStorage.getItem('currentModule');
    } else {
      const path = window.location.pathname;
      if (path.includes('/modulos/')) {
        const match = path.match(/\/modulos\/([^\/]+)/);
        modulo = match ? match[1] : path.split('/').pop() || 'desconhecido';
      } else {
        modulo = path.split('/').pop() || 'desconhecido';
      }
    }
    
    // Detectar tipo de ação baseado no texto, ID ou classe
    let tipoAcao = 'Ação: Botão';
    let descricao = `Botão clicado: ${text || id || 'Sem texto'}`;
    
    // Salvar/Incluir/Adicionar/Novo/Gravar (inclui: Salvar, Novo Registro, Novo Ponto, Nova Validade, Salvar Veículo, Salvar Motorista)
    if (text.match(/salvar.*veículo|salvar.*veiculo|salvar.*motorista/i)) {
      // Detecção específica para Salvar Veículo e Salvar Motorista
      if (text.match(/salvar.*veículo|salvar.*veiculo/i)) {
        tipoAcao = 'Ação: Salvar Veículo';
      } else if (text.match(/salvar.*motorista/i)) {
        tipoAcao = 'Ação: Salvar Motorista';
      }
    } else if (text.match(/salvar|incluir|adicionar|novo|gravar|nova.*validade/i) || 
        id.match(/salvar|incluir|adicionar|novo|gravar|btnSalvar|btnNovo/i) ||
        className.match(/save|btn-save/i)) {
      tipoAcao = 'Ação: Salvar/Incluir';
    }
    // Cancelar/Limpar/Voltar/Fechar
    else if (text.match(/cancelar|limpar|voltar|fechar/i) || 
             id.match(/cancelar|limpar|voltar|fechar|btnCancelar|btnLimpar/i) ||
             className.match(/cancel|btn-cancel/i)) {
      tipoAcao = 'Ação: Cancelar/Limpar';
    }
    // Calcular
    else if (text.match(/calcular|calculo/i) || 
             id.match(/calcular|calculo|btnCalcular/i)) {
      tipoAcao = 'Ação: Calcular';
    }
    // Excluir/Deletar/Remover
    else if (text.match(/excluir|deletar|remover/i) || 
             id.match(/excluir|deletar|remover|btnExcluir/i)) {
      tipoAcao = 'Ação: Exclusão';
    }
    // Pesquisar/Filtrar/Buscar/Aplicar Filtro
    else if (text.match(/pesquisar|filtrar|buscar|aplicar.*filtro/i) || 
             id.match(/pesquisar|filtrar|buscar|aplicar|btnFiltrar|btnPesquisar/i)) {
      tipoAcao = 'Ação: Pesquisa/Filtro';
    }
    // Editar/Alterar/Modificar
    else if (text.match(/editar|alterar|modificar/i) || 
             id.match(/editar|alterar|modificar|btnEditar/i)) {
      tipoAcao = 'Ação: Edição';
    }
    // Exportar/Imprimir/Download
    else if (text.match(/exportar|imprimir|download/i) || 
             id.match(/exportar|imprimir|download/i)) {
      tipoAcao = 'Ação: Exportação/Impressão';
    }
    // Carregar/Atualizar/Recarregar (inclui: Carregar Viagens Pendentes, Carregar Convocações)
    else if (text.match(/carregar|atualizar|recarregar|refresh/i) || 
             id.match(/carregar|atualizar|recarregar|btnCarregar/i)) {
      tipoAcao = 'Ação: Carregar/Atualizar';
    }
    // Visualizar/Ver/Ver Dados
    else if (text.match(/visualizar|ver.*dados|ver|detalhes/i) || 
             id.match(/visualizar|ver|detalhes|btnVer/i)) {
      tipoAcao = 'Ação: Visualização';
    }
    // Documentação/Manual/Guia (inclui: Manual do Sistema, Documentação CSS, Guia de Envio de Convocações)
    else if (text.match(/manual|documentação|documentacao|guia|ajuda|help/i) || 
             id.match(/manual|documentacao|guia|ajuda|help/i)) {
      tipoAcao = 'Ação: Documentação/Manual';
    }
    // WhatsApp/Envio WhatsApp (inclui: Enviar via WhatsApp, Abrir WhatsApp, Copiar Texto para WhatsApp)
    else if (text.match(/whatsapp|enviar.*whatsapp|abrir.*whatsapp|via.*whatsapp/i) || 
             id.match(/whatsapp|btnWhatsApp|btnEnviarWhatsApp|btnAbrirWhatsApp/i) ||
             className.match(/whatsapp/i)) {
      tipoAcao = 'Ação: WhatsApp';
    }
    // Copiar Texto/Copiar (inclui: Copiar Texto)
    else if (text.match(/copiar.*texto|copiar/i) || 
             id.match(/copiar|btnCopiar|copy/i)) {
      tipoAcao = 'Ação: Copiar';
    }
    // Preparar Anúncio
    else if (text.match(/preparar.*anúncio|preparar.*anuncio/i) || 
             id.match(/preparar|btnPreparar/i)) {
      tipoAcao = 'Ação: Preparar Anúncio';
    }
    // Disparar Convocações
    else if (text.match(/disparar.*convoc|disparar.*convocacao/i) || 
             id.match(/disparar|btnDisparar/i)) {
      tipoAcao = 'Ação: Disparar Convocações';
    }
    // Alterar Senha
    else if (text.match(/alterar.*senha/i) || 
             id.match(/alterar.*senha|linkAlterarSenha|btnAlterarSenha/i)) {
      tipoAcao = 'Ação: Alterar Senha';
    }
    // Sair/Logout
    else if (text.match(/sair|logout|log.*out/i) || 
             id.match(/sair|logout|btnSair|logoutBtn/i) ||
             className.match(/logout/i)) {
      tipoAcao = 'Ação: Logout';
    }
    // Entrar/Login
    else if (text.match(/entrar|login|log.*in/i) || 
             id.match(/entrar|login|btnLogin|btnEntrar/i)) {
      tipoAcao = 'Ação: Login';
    }
    // Confirmar/Aceitar
    else if (text.match(/confirmar|aceitar/i) || 
             id.match(/confirmar|aceitar|btnConfirmar/i)) {
      tipoAcao = 'Ação: Confirmar/Aceitar';
    }
    // Reativar
    else if (text.match(/reativar/i) || 
             id.match(/reativar|btnReativar/i)) {
      tipoAcao = 'Ação: Reativar';
    }
    // Recusar
    else if (text.match(/recusar/i) || 
             id.match(/recusar|btnRecusar/i)) {
      tipoAcao = 'Ação: Recusar';
    }
    
    // Registrar log
    logAcao(tipoAcao, modulo, descricao, {
      botaoTexto: text,
      botaoId: id,
      botaoClasse: className
    });
  }, true);

  // Interceptar submissão de formulários
  document.addEventListener('submit', function(e) {
    const form = e.target;
    if (form.tagName === 'FORM') {
      // Obter módulo atual (mesma lógica dos botões)
      let modulo = 'desconhecido';
      if (window.currentModule) {
        modulo = window.currentModule;
      } else if (sessionStorage.getItem('currentModule')) {
        modulo = sessionStorage.getItem('currentModule');
      } else {
        const path = window.location.pathname;
        if (path.includes('/modulos/')) {
          const match = path.match(/\/modulos\/([^\/]+)/);
          modulo = match ? match[1] : path.split('/').pop() || 'desconhecido';
        } else {
          modulo = path.split('/').pop() || 'desconhecido';
        }
      }
      
      const action = form.action || '';
      const method = form.method || 'POST';
      
      logAcao('Submissão de Formulário', modulo, `Formulário submetido: ${action} (${method})`, {
        action: action,
        method: method
      });
    }
  }, true);

  // Log de abertura de página (quando o DOM estiver pronto)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      // Obter módulo atual (mesma lógica dos botões)
      let modulo = 'index';
      if (window.currentModule) {
        modulo = window.currentModule;
      } else if (sessionStorage.getItem('currentModule')) {
        modulo = sessionStorage.getItem('currentModule');
      } else {
        const path = window.location.pathname;
        if (path.includes('/modulos/')) {
          const match = path.match(/\/modulos\/([^\/]+)/);
          modulo = match ? match[1] : path.split('/').pop() || 'index';
        } else {
          modulo = path.split('/').pop() || 'index';
        }
      }
      
      // Não registrar abertura da página de login ou dashboard
      const path = window.location.pathname;
      if (!path.includes('index.html') && !path.includes('dashboard.html') && modulo !== 'index') {
        setTimeout(() => {
          logAberturaTela(modulo, `Abertura do módulo: ${modulo}`);
        }, 500);
      }
    });
  } else {
    // DOM já está pronto
    // Obter módulo atual (mesma lógica dos botões)
    let modulo = 'index';
    if (window.currentModule) {
      modulo = window.currentModule;
    } else if (sessionStorage.getItem('currentModule')) {
      modulo = sessionStorage.getItem('currentModule');
    } else {
      const path = window.location.pathname;
      if (path.includes('/modulos/')) {
        const match = path.match(/\/modulos\/([^\/]+)/);
        modulo = match ? match[1] : path.split('/').pop() || 'index';
      } else {
        modulo = path.split('/').pop() || 'index';
      }
    }
    
    const path = window.location.pathname;
    if (!path.includes('index.html') && !path.includes('dashboard.html') && modulo !== 'index') {
      setTimeout(() => {
        logAberturaTela(modulo, `Abertura do módulo: ${modulo}`);
      }, 500);
    }
  }

  // Expor função principal globalmente
  window.registrarAcao = registrarAcao;

  // Sistema de log carregado e pronto

})();

