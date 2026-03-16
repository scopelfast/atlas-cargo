(function() {
  const t = (k) => (typeof window.tWeb === 'function' ? window.tWeb(k) : k);
  const nominatimEl = document.getElementById('nominatimServer');
  const osrmEl = document.getElementById('osrmServer');
  const btnSalvar = document.getElementById('btnSalvar');
  const btnCarregar = document.getElementById('btnCarregar');
  const btnSalvarText = document.getElementById('btnSalvarText');
  const messageEl = document.getElementById('configMapaMessage');

  const contextoPais = document.getElementById('contextoPais');
  const contextoMoeda = document.getElementById('contextoMoeda');
  const contextoIdioma = document.getElementById('contextoIdioma');
  const contextoTimezone = document.getElementById('contextoTimezone');
  const contextoTipoDocFisica = document.getElementById('contextoTipoDocFisica');
  const contextoTipoDocJuridica = document.getElementById('contextoTipoDocJuridica');
  const btnSalvarContexto = document.getElementById('btnSalvarContexto');
  const btnCarregarContexto = document.getElementById('btnCarregarContexto');
  const btnSalvarContextoText = document.getElementById('btnSalvarContextoText');
  const messageContextoEl = document.getElementById('configContextoMessage');

  const logoRetangularEl = document.getElementById('logoRetangular');
  const logoQuadradaEl = document.getElementById('logoQuadrada');
  const btnSalvarIdentidade = document.getElementById('btnSalvarIdentidade');
  const btnCarregarIdentidade = document.getElementById('btnCarregarIdentidade');
  const btnSalvarIdentidadeText = document.getElementById('btnSalvarIdentidadeText');
  const messageIdentidadeEl = document.getElementById('configIdentidadeMessage');
  const previewRetangular = document.getElementById('previewRetangular');
  const previewQuadrada = document.getElementById('previewQuadrada');

  function baseUrl() {
    const p = window.location.pathname || '';
    if (p.indexOf('/modulos/') !== -1) {
      const base = p.substring(0, p.indexOf('/modulos/'));
      return window.location.origin + (base || '');
    }
    return window.location.origin;
  }

  function showMessage(text, type) {
    // Padrão do sistema: toast no topo (como Gerenciar Usuários)
    if (typeof window.showMessage === 'function') {
      window.showMessage(text, type);
    }
    // Banner local abaixo dos botões (sempre visível)
    if (messageEl) {
      messageEl.textContent = text;
      messageEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageEl.style.display = 'block';
      messageEl.setAttribute('aria-live', 'polite');
    }
  }

  async function carregar() {
    try {
      const res = await fetch('/api/configuracoes/mapa');
      const data = await res.json();
      if (res.ok) {
        if (nominatimEl) nominatimEl.value = data.nominatimServer || '';
        if (osrmEl) osrmEl.value = data.osrmServer || '';
        showMessage(t('web.modulos.configuracoes.configuracoesCarregadas'), 'success');
      } else {
        showMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
      }
    } catch (err) {
      showMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    }
  }

  let salvando = false;
  async function salvar() {
    if (salvando) return;
    salvando = true;
    if (btnSalvar) {
      btnSalvar.disabled = true;
      if (btnSalvarText) btnSalvarText.textContent = (typeof window.tWeb === 'function' ? (window.tWeb('web.common.salvando') || 'Salvando...') : 'Salvando...');
    }
    if (messageEl) {
      messageEl.textContent = '';
      messageEl.className = 'message';
      messageEl.style.display = 'none';
    }
    try {
      const res = await fetch('/api/configuracoes/mapa', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nominatimServer: nominatimEl?.value?.trim() || '',
          osrmServer: osrmEl?.value?.trim() || ''
        })
      });
      const data = await res.json();
      if (res.ok) {
        showMessage(data.message || t('web.modulos.configuracoes.sucessoSalvar'), 'success');
        if (window.MAP_CONFIG) {
          if (nominatimEl?.value?.trim()) window.MAP_CONFIG.nominatimServer = nominatimEl.value.trim();
          if (osrmEl?.value?.trim()) window.MAP_CONFIG.osrmServer = osrmEl.value.trim();
        }
      } else {
        showMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
      }
    } catch (err) {
      showMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    } finally {
      salvando = false;
      if (btnSalvar) {
        btnSalvar.disabled = false;
        if (btnSalvarText) btnSalvarText.textContent = t('web.modulos.configuracoes.salvar');
      }
    }
  }

  if (btnSalvar) btnSalvar.addEventListener('click', salvar);
  if (btnCarregar) btnCarregar.addEventListener('click', carregar);
  carregar();

  function showContextoMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageContextoEl) {
      messageContextoEl.textContent = text;
      messageContextoEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageContextoEl.style.display = 'block';
      messageContextoEl.setAttribute('aria-live', 'polite');
    }
  }
  async function carregarContexto() {
    try {
      const res = await fetch('/api/contexto');
      const data = await res.json();
      if (contextoPais) contextoPais.value = data.pais || 'BR';
      if (contextoMoeda) contextoMoeda.value = data.moeda || 'BRL';
      if (contextoIdioma) contextoIdioma.value = data.locale || 'pt-BR';
      if (contextoTimezone) contextoTimezone.value = data.timezone || 'America/Sao_Paulo';
      if (contextoTipoDocFisica) contextoTipoDocFisica.value = data.tipoDocFisica || 'CPF';
      if (contextoTipoDocJuridica) contextoTipoDocJuridica.value = data.tipoDocJuridica || 'CNPJ';
      showContextoMessage(t('web.modulos.configuracoes.configuracoesCarregadas'), 'success');
    } catch (err) {
      showContextoMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    }
  }
  let salvandoContexto = false;
  async function salvarContexto() {
    if (salvandoContexto) return;
    salvandoContexto = true;
    if (btnSalvarContexto) {
      btnSalvarContexto.disabled = true;
      if (btnSalvarContextoText) btnSalvarContextoText.textContent = (typeof window.tWeb === 'function' ? (window.tWeb('web.common.salvando') || 'Salvando...') : 'Salvando...');
    }
    if (messageContextoEl) { messageContextoEl.style.display = 'none'; messageContextoEl.textContent = ''; }
    try {
      const res = await fetch('/api/configuracoes/contexto', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pais: contextoPais?.value || 'BR',
          locale: contextoIdioma?.value || 'pt-BR',
          moeda: contextoMoeda?.value || 'BRL',
          tipoDocFisica: (contextoTipoDocFisica?.value || 'CPF').trim(),
          tipoDocJuridica: (contextoTipoDocJuridica?.value || 'CNPJ').trim(),
          timezone: (contextoTimezone?.value || 'America/Sao_Paulo').trim()
        })
      });
      const data = await res.json();
      if (res.ok) {
        showContextoMessage(data.message || t('web.modulos.configuracoes.sucessoSalvar'), 'success');
      } else {
        showContextoMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
      }
    } catch (err) {
      showContextoMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    } finally {
      salvandoContexto = false;
      if (btnSalvarContexto) {
        btnSalvarContexto.disabled = false;
        if (btnSalvarContextoText) btnSalvarContextoText.textContent = t('web.modulos.configuracoes.salvarContexto');
      }
    }
  }
  if (btnSalvarContexto) btnSalvarContexto.addEventListener('click', salvarContexto);
  if (btnCarregarContexto) btnCarregarContexto.addEventListener('click', carregarContexto);
  carregarContexto();

  // Switch Digital
  const switchEndpointEl = document.getElementById('switchEndpoint');
  const switchMetodoEl = document.getElementById('switchMetodo');
  const switchContentTypeEl = document.getElementById('switchContentType');
  const switchTokenEl = document.getElementById('switchToken');
  const switchUserIdEl = document.getElementById('switchUserId');
  const switchQueueIdEl = document.getElementById('switchQueueId');
  const switchSendSignatureEl = document.getElementById('switchSendSignature');
  const switchCloseTicketEl = document.getElementById('switchCloseTicket');
  
  const btnSalvarSwitch = document.getElementById('btnSalvarSwitch');
  const btnCarregarSwitch = document.getElementById('btnCarregarSwitch');
  const messageSwitchEl = document.getElementById('configSwitchMessage');

  const btnTestarSwitch = document.getElementById('btnTestarSwitch');
  const switchTestNumberEl = document.getElementById('switchTestNumber');
  const testResultMessageEl = document.getElementById('testResultMessage');

  function showSwitchMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageSwitchEl) {
      messageSwitchEl.textContent = text;
      messageSwitchEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageSwitchEl.style.display = 'block';
    }
  }

  function showTestMessage(text, type) {
    if (testResultMessageEl) {
      testResultMessageEl.textContent = text;
      testResultMessageEl.style.display = 'block';
      if (type === 'success') {
        testResultMessageEl.style.backgroundColor = '#d1e7dd';
        testResultMessageEl.style.color = '#0f5132';
        testResultMessageEl.style.border = '1px solid #badbcc';
      } else if (type === 'error') {
        testResultMessageEl.style.backgroundColor = '#f8d7da';
        testResultMessageEl.style.color = '#842029';
        testResultMessageEl.style.border = '1px solid #f5c2c7';
      } else {
        testResultMessageEl.style.backgroundColor = '#cff4fc';
        testResultMessageEl.style.color = '#055160';
        testResultMessageEl.style.border = '1px solid #b6effb';
      }
    }
  }

  async function carregarSwitch() {
    try {
      const res = await fetch('/api/configuracoes/switch-digital');
      const data = await res.json();
      if (res.ok) {
        if (switchEndpointEl) switchEndpointEl.value = data.switchEndpoint || 'https://api.switchdigital.com.br/api/messages/send';
        if (switchMetodoEl) switchMetodoEl.value = data.switchMetodo || 'POST';
        if (switchContentTypeEl) switchContentTypeEl.value = data.switchContentType || 'application/json';
        if (switchTokenEl) switchTokenEl.value = data.switchToken || '';
        if (switchUserIdEl) switchUserIdEl.value = data.switchUserId || '';
        if (switchQueueIdEl) switchQueueIdEl.value = data.switchQueueId || '';
        if (switchSendSignatureEl) switchSendSignatureEl.checked = data.switchSendSignature === 'S';
        if (switchCloseTicketEl) switchCloseTicketEl.checked = data.switchCloseTicket !== 'N'; // Padrão S (true)
      } else {
        showSwitchMessage(data.error || 'Erro ao carregar Switch Digital', 'error');
      }
    } catch (err) {
      showSwitchMessage('Erro ao carregar Switch Digital', 'error');
    }
  }

  let salvandoSwitch = false;
  async function salvarSwitch() {
    if (salvandoSwitch) return;
    salvandoSwitch = true;
    if (btnSalvarSwitch) {
        btnSalvarSwitch.disabled = true;
        btnSalvarSwitch.innerHTML = '<i class="bx bx-loader bx-spin"></i> Salvando...';
    }
    
    try {
      const res = await fetch('/api/configuracoes/switch-digital', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          switchEndpoint: switchEndpointEl?.value?.trim() || '',
          switchMetodo: switchMetodoEl?.value || 'POST',
          switchContentType: switchContentTypeEl?.value?.trim() || 'application/json',
          switchToken: switchTokenEl?.value?.trim() || '',
          switchUserId: switchUserIdEl?.value?.trim() || '',
          switchQueueId: switchQueueIdEl?.value?.trim() || '',
          switchSendSignature: switchSendSignatureEl?.checked ? 'S' : 'N',
          switchCloseTicket: switchCloseTicketEl?.checked ? 'S' : 'N'
        })
      });
      const data = await res.json();
      if (res.ok) {
        showSwitchMessage('Configurações Switch Digital salvas com sucesso', 'success');
      } else {
        showSwitchMessage(data.error || 'Erro ao salvar', 'error');
      }
    } catch (err) {
      showSwitchMessage('Erro ao salvar', 'error');
    } finally {
      salvandoSwitch = false;
      if (btnSalvarSwitch) {
          btnSalvarSwitch.disabled = false;
          btnSalvarSwitch.innerHTML = '<i class="bx bx-save"></i> <span id="btnSalvarSwitchText">Salvar Configurações</span>';
      }
    }
  }

  let testandoSwitch = false;
  async function testarSwitch() {
      if (testandoSwitch) return;
      
      const numero = switchTestNumberEl?.value?.replace(/\D/g, '');
      if (!numero || numero.length < 10) {
          showTestMessage('Digite um número de WhatsApp válido (ex: 558599999999)', 'error');
          return;
      }

      // Validar se as configurações da tela estão preenchidas
      if (!switchEndpointEl?.value?.trim() || !switchTokenEl?.value?.trim()) {
          showTestMessage('Preencha o Endpoint e o Token antes de testar.', 'error');
          return;
      }

      testandoSwitch = true;
      if (btnTestarSwitch) {
          btnTestarSwitch.disabled = true;
          btnTestarSwitch.innerHTML = '<i class="bx bx-loader bx-spin"></i> Enviando...';
      }
      showTestMessage('Enviando requisição de teste...', 'info');

      try {
          // Vamos mandar os dados que estão NA TELA, assim o usuário testa antes de precisar salvar no banco
          const payload = {
              numero: numero,
              config: {
                endpoint: switchEndpointEl.value.trim(),
                metodo: switchMetodoEl.value,
                contentType: switchContentTypeEl.value.trim(),
                token: switchTokenEl.value.trim(),
                userId: switchUserIdEl.value.trim(),
                queueId: switchQueueIdEl.value.trim(),
                sendSignature: switchSendSignatureEl.checked,
                closeTicket: switchCloseTicketEl.checked
              }
          };

          const res = await fetch('/api/configuracoes/switch-digital/teste', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          
          const data = await res.json();
          
          if (res.ok && data.success) {
              showTestMessage('✅ Mensagem enviada com sucesso! Resposta da API: ' + (data.apiResponse ? JSON.stringify(data.apiResponse) : 'OK'), 'success');
          } else {
              showTestMessage('❌ Falha ao enviar. Erro: ' + (data.error || 'Desconhecido') + (data.details ? ' - ' + JSON.stringify(data.details) : ''), 'error');
          }
      } catch (err) {
          showTestMessage('❌ Erro de rede ou servidor ao tentar testar: ' + err.message, 'error');
      } finally {
          testandoSwitch = false;
          if (btnTestarSwitch) {
              btnTestarSwitch.disabled = false;
              btnTestarSwitch.innerHTML = '<i class="bx bx-send"></i> Enviar Mensagem Teste';
          }
      }
  }

  if (btnSalvarSwitch) btnSalvarSwitch.addEventListener('click', salvarSwitch);
  if (btnCarregarSwitch) btnCarregarSwitch.addEventListener('click', carregarSwitch);
  if (btnTestarSwitch) btnTestarSwitch.addEventListener('click', testarSwitch);
  
  carregarSwitch();

  function showIdentidadeMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageIdentidadeEl) {
      messageIdentidadeEl.textContent = text;
      messageIdentidadeEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageIdentidadeEl.style.display = 'block';
      messageIdentidadeEl.setAttribute('aria-live', 'polite');
    }
  }

  function updatePreviews() {
    const base = baseUrl();
    if (previewRetangular && logoRetangularEl && logoRetangularEl.value.trim()) {
      const nome = logoRetangularEl.value.trim();
      previewRetangular.src = base + '/img/' + nome;
      previewRetangular.style.display = 'block';
      previewRetangular.onerror = function() { this.style.display = 'none'; };
    } else if (previewRetangular) previewRetangular.style.display = 'none';
    if (previewQuadrada && logoQuadradaEl && logoQuadradaEl.value.trim()) {
      const nome = logoQuadradaEl.value.trim();
      previewQuadrada.src = base + '/img/' + nome;
      previewQuadrada.style.display = 'block';
      previewQuadrada.onerror = function() { this.style.display = 'none'; };
    } else if (previewQuadrada) previewQuadrada.style.display = 'none';
  }

  async function carregarIdentidade() {
    try {
      const res = await fetch('/api/configuracoes/identidade');
      const data = await res.json();
      if (res.ok) {
        if (logoRetangularEl) logoRetangularEl.value = data.logoRetangular || 'logoAtlasTransparente.png';
        if (logoQuadradaEl) logoQuadradaEl.value = data.logoQuadrada || 'logoAtlasTransparenteQuadrada.png';
        updatePreviews();
        showIdentidadeMessage(t('web.modulos.configuracoes.sucessoSalvar'), 'success');
      } else {
        showIdentidadeMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
      }
    } catch (err) {
      showIdentidadeMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    }
  }

  let salvandoIdentidade = false;
  async function salvarIdentidade() {
    if (salvandoIdentidade) return;
    salvandoIdentidade = true;
    if (btnSalvarIdentidade) {
      btnSalvarIdentidade.disabled = true;
      if (btnSalvarIdentidadeText) btnSalvarIdentidadeText.textContent = (typeof window.tWeb === 'function' ? (window.tWeb('web.common.salvando') || 'Salvando...') : 'Salvando...');
    }
    if (messageIdentidadeEl) {
      messageIdentidadeEl.textContent = '';
      messageIdentidadeEl.className = 'message';
      messageIdentidadeEl.style.display = 'none';
    }
    try {
      const res = await fetch('/api/configuracoes/identidade', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          logoRetangular: logoRetangularEl?.value?.trim() || 'logoAtlasTransparente.png',
          logoQuadrada: logoQuadradaEl?.value?.trim() || 'logoAtlasTransparenteQuadrada.png'
        })
      });
      const data = await res.json();
      if (res.ok) {
        showIdentidadeMessage(data.message || t('web.modulos.configuracoes.sucessoSalvar'), 'success');
        updatePreviews();
      } else {
        showIdentidadeMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
      }
    } catch (err) {
      showIdentidadeMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    } finally {
      salvandoIdentidade = false;
      if (btnSalvarIdentidade) {
        btnSalvarIdentidade.disabled = false;
        if (btnSalvarIdentidadeText) btnSalvarIdentidadeText.textContent = t('web.modulos.configuracoes.salvarIdentidade');
      }
    }
  }

  if (btnSalvarIdentidade) btnSalvarIdentidade.addEventListener('click', salvarIdentidade);
  if (btnCarregarIdentidade) btnCarregarIdentidade.addEventListener('click', carregarIdentidade);
  if (logoRetangularEl) logoRetangularEl.addEventListener('change', updatePreviews);
  if (logoRetangularEl) logoRetangularEl.addEventListener('blur', updatePreviews);
  if (logoQuadradaEl) logoQuadradaEl.addEventListener('change', updatePreviews);
  if (logoQuadradaEl) logoQuadradaEl.addEventListener('blur', updatePreviews);
  carregarIdentidade();

  // Link do app motorista (mensagem de confirmação da convocação)
  const linkAppMotoristaEl = document.getElementById('linkAppMotorista');
  const btnSalvarAppMotorista = document.getElementById('btnSalvarAppMotorista');
  const btnCarregarAppMotorista = document.getElementById('btnCarregarAppMotorista');
  const btnSalvarAppMotoristaText = document.getElementById('btnSalvarAppMotoristaText');
  const messageAppMotoristaEl = document.getElementById('configAppMotoristaMessage');

  function showAppMotoristaMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageAppMotoristaEl) {
      messageAppMotoristaEl.textContent = text;
      messageAppMotoristaEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageAppMotoristaEl.style.display = 'block';
    }
  }

  async function carregarAppMotorista() {
    try {
      const res = await fetch('/api/configuracoes/app-motorista');
      const data = await res.json();
      if (linkAppMotoristaEl) linkAppMotoristaEl.value = data.linkAppMotorista || '';
      if (res.ok) showAppMotoristaMessage(t('web.modulos.configuracoes.configuracoesCarregadas') || 'Configurações carregadas.', 'success');
    } catch (err) {
      showAppMotoristaMessage('Erro ao carregar.', 'error');
    }
  }

  let salvandoAppMotorista = false;
  async function salvarAppMotorista() {
    if (salvandoAppMotorista) return;
    salvandoAppMotorista = true;
    if (btnSalvarAppMotorista) {
      btnSalvarAppMotorista.disabled = true;
      if (btnSalvarAppMotoristaText) btnSalvarAppMotoristaText.textContent = (typeof window.tWeb === 'function' ? (window.tWeb('web.common.salvando') || 'Salvando...') : 'Salvando...');
    }
    if (messageAppMotoristaEl) { messageAppMotoristaEl.style.display = 'none'; messageAppMotoristaEl.textContent = ''; }
    try {
      const res = await fetch('/api/configuracoes/app-motorista', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkAppMotorista: linkAppMotoristaEl?.value?.trim() || '' })
      });
      const data = await res.json();
      if (res.ok) {
        showAppMotoristaMessage(data.message || (t('web.modulos.configuracoes.sucessoSalvar') || 'Salvo com sucesso!'), 'success');
      } else {
        showAppMotoristaMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      showAppMotoristaMessage('Erro ao salvar.', 'error');
    } finally {
      salvandoAppMotorista = false;
      if (btnSalvarAppMotorista) {
        btnSalvarAppMotorista.disabled = false;
        if (btnSalvarAppMotoristaText) btnSalvarAppMotoristaText.textContent = t('web.modulos.configuracoes.salvar') || 'Salvar';
      }
    }
  }

  if (btnSalvarAppMotorista) btnSalvarAppMotorista.addEventListener('click', salvarAppMotorista);
  if (btnCarregarAppMotorista) btnCarregarAppMotorista.addEventListener('click', carregarAppMotorista);
  carregarAppMotorista();
})();
