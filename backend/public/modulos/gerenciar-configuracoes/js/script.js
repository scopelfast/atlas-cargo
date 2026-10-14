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
  const fileLogoRetangular = document.getElementById('fileLogoRetangular');
  const fileLogoQuadrada = document.getElementById('fileLogoQuadrada');
  const btnUploadLogoRetangular = document.getElementById('btnUploadLogoRetangular');
  const btnUploadLogoQuadrada = document.getElementById('btnUploadLogoQuadrada');
  let canUploadLogos = false;
  const DEFAULT_LOGO_RETANGULAR = 'logoAtlasTransparente.png';
  const DEFAULT_LOGO_QUADRADA = 'logoAtlasTransparenteQuadrada.png';

  function baseUrl() {
    const p = window.location.pathname || '';
    if (p.indexOf('/modulos/') !== -1) {
      const base = p.substring(0, p.indexOf('/modulos/'));
      return window.location.origin + (base || '');
    }
    return window.location.origin;
  }

  function getAuthJsonHeaders() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
  }

  function getAuthBearerHeaders() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    const h = {};
    if (token) h.Authorization = 'Bearer ' + token;
    return h;
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
        headers: getAuthJsonHeaders(),
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
        headers: getAuthJsonHeaders(),
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
        headers: getAuthJsonHeaders(),
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
              headers: getAuthJsonHeaders(),
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

  function setIdentidadeUploadButtonsVisible(show) {
    const disp = show ? 'inline-flex' : 'none';
    if (btnUploadLogoRetangular) btnUploadLogoRetangular.style.display = disp;
    if (btnUploadLogoQuadrada) btnUploadLogoQuadrada.style.display = disp;
  }

  async function atualizarPermissaoUploadLogo() {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
    if (!token) {
      canUploadLogos = false;
      setIdentidadeUploadButtonsVisible(false);
      return;
    }
    try {
      const res = await fetch('/api/configuracoes/identidade/upload-permissao', {
        headers: getAuthBearerHeaders()
      });
      const data = await res.json().catch(() => ({}));
      canUploadLogos = !!(res.ok && data.canUploadLogos);
      setIdentidadeUploadButtonsVisible(canUploadLogos);
    } catch (_) {
      canUploadLogos = false;
      setIdentidadeUploadButtonsVisible(false);
    }
  }

  async function enviarLogoAoServidor(tipo, inputEl) {
    const file = inputEl && inputEl.files && inputEl.files[0];
    if (!file) return;
    if (!canUploadLogos) {
      showIdentidadeMessage(t('web.modulos.configuracoes.uploadLogoNegado'), 'error');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('logo', file);
      const res = await fetch(
        '/api/configuracoes/identidade/upload-logo?tipo=' + encodeURIComponent(tipo),
        { method: 'POST', headers: getAuthBearerHeaders(), body: fd }
      );
      const data = await res.json().catch(() => ({}));
      inputEl.value = '';
      if (!res.ok) {
        showIdentidadeMessage(data.error || t('web.modulos.configuracoes.erroSalvar'), 'error');
        return;
      }
      if (tipo === 'retangular' && logoRetangularEl && data.filename) {
        logoRetangularEl.value = data.filename;
      }
      if (tipo === 'quadrada' && logoQuadradaEl && data.filename) {
        logoQuadradaEl.value = data.filename;
      }
      updatePreviews();
      showIdentidadeMessage(t('web.modulos.configuracoes.uploadLogoOk'), 'success');
    } catch (err) {
      inputEl.value = '';
      showIdentidadeMessage(t('web.modulos.configuracoes.erroSalvar'), 'error');
    }
  }

  function wireLogoUpload(btn, input, tipo) {
    if (!btn || !input) return;
    btn.addEventListener('click', function() {
      input.click();
    });
    input.addEventListener('change', function() {
      if (input.files && input.files[0]) enviarLogoAoServidor(tipo, input);
    });
  }

  async function carregarIdentidade(silent) {
    try {
      const res = await fetch('/api/configuracoes/identidade');
      const data = await res.json();
      if (res.ok) {
        if (logoRetangularEl) logoRetangularEl.value = data.logoRetangular || DEFAULT_LOGO_RETANGULAR;
        if (logoQuadradaEl) logoQuadradaEl.value = data.logoQuadrada || DEFAULT_LOGO_QUADRADA;
        updatePreviews();
        if (!silent) {
          showIdentidadeMessage(t('web.modulos.configuracoes.configuracoesCarregadas'), 'success');
        }
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
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({
          logoRetangular: logoRetangularEl?.value?.trim() || DEFAULT_LOGO_RETANGULAR,
          logoQuadrada: logoQuadradaEl?.value?.trim() || DEFAULT_LOGO_QUADRADA
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

  function restaurarNomeLogoSeCampoVazio(el, padrao) {
    if (el && !String(el.value || '').trim()) el.value = padrao;
  }

  if (btnSalvarIdentidade) btnSalvarIdentidade.addEventListener('click', salvarIdentidade);
  if (btnCarregarIdentidade) btnCarregarIdentidade.addEventListener('click', function() { carregarIdentidade(false); });
  if (logoRetangularEl) logoRetangularEl.addEventListener('change', updatePreviews);
  if (logoRetangularEl) {
    logoRetangularEl.addEventListener('blur', function() {
      restaurarNomeLogoSeCampoVazio(logoRetangularEl, DEFAULT_LOGO_RETANGULAR);
      updatePreviews();
    });
  }
  if (logoQuadradaEl) logoQuadradaEl.addEventListener('change', updatePreviews);
  if (logoQuadradaEl) {
    logoQuadradaEl.addEventListener('blur', function() {
      restaurarNomeLogoSeCampoVazio(logoQuadradaEl, DEFAULT_LOGO_QUADRADA);
      updatePreviews();
    });
  }
  wireLogoUpload(btnUploadLogoRetangular, fileLogoRetangular, 'retangular');
  wireLogoUpload(btnUploadLogoQuadrada, fileLogoQuadrada, 'quadrada');
  carregarIdentidade(true);
  atualizarPermissaoUploadLogo();

  // Alertas de viagem
  const messageAlertasEl = document.getElementById('configAlertasMessage');
  const btnCarregarAlertas = document.getElementById('btnCarregarAlertas');
  const btnSalvarAlertas = document.getElementById('btnSalvarAlertas');

  function showAlertasMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageAlertasEl) {
      messageAlertasEl.textContent = text;
      messageAlertasEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageAlertasEl.style.display = text ? 'block' : 'none';
    }
  }

  async function carregarAlertas() {
    try {
      const res = await fetch('/api/configuracoes/alertas');
      const data = await res.json();
      const setNum = (id, key, def) => {
        const el = document.getElementById(id);
        if (el) el.value = data[key] != null ? String(data[key]) : String(def);
      };
      const setCheck = (id, key, def) => {
        const el = document.getElementById(id);
        if (el) el.checked = data[key] !== undefined && data[key] !== null && data[key] !== ''
          ? (data[key] === 'S' || data[key] === true || data[key] === '1')
          : !!def;
      };
      setNum('alertOfflineMinutos', 'alert_offline_minutos', 90);
      setNum('alertParadaVelocidadeMax', 'alert_parada_velocidade_max', 5);
      setNum('alertParadaMinutosMin', 'alert_parada_minutos_min', 30);
      setNum('alertParadaJanelaPosicoes', 'alert_parada_janela_posicoes', 60);
      setNum('alertParadaRaioMetros', 'alert_parada_raio_metros', 200);
      setNum('alertDesvioMetros', 'alert_desvio_metros', 500);
      setCheck('alertDesvioSuprimirQuandoParadoAtivo', 'alert_desvio_suprimir_quando_parado_ativo', true);
      setNum('alertAtrasoInicioMargemMinutos', 'alert_atraso_inicio_margem_minutos', 15);
      setNum('alertExcessoVelocidadeKmh', 'alert_excesso_velocidade_kmh', 100);
      setNum('alertExcessoVelocidadeJanela', 'alert_excesso_velocidade_janela', 5);
      setNum('alertJobIntervaloMinutos', 'alert_job_intervalo_minutos', 5);
      ultimoIntervaloAlertasCarregado = Number(data.alert_job_intervalo_minutos != null ? data.alert_job_intervalo_minutos : 5);
      setNum('alertCooldownMinutos', 'alert_cooldown_minutos', 30);
      setNum('alertWhatsAppReenvioMinutos', 'alert_whatsapp_reenvio_minutos', 30);
      setNum('alertHeartbeatIntervaloMinutos', 'alert_heartbeat_intervalo_minutos', 15);
      setCheck('alertJobAtivo', 'alert_job_ativo', true);
      setCheck('alertHeartbeatAtivo', 'alert_heartbeat_ativo', false);
      setCheck('alertTipoParadaAtivo', 'alert_tipo_parada_ativo', true);
      setCheck('alertTipoAtrasoAtivo', 'alert_tipo_atraso_ativo', true);
      setCheck('alertTipoEtaPrazoAtivo', 'alert_tipo_eta_prazo_ativo', true);
      setCheck('alertTipoOfflineAtivo', 'alert_tipo_offline_ativo', true);
      setCheck('alertTipoDesvioAtivo', 'alert_tipo_desvio_ativo', true);
      setCheck('alertTipoAtrasoInicioAtivo', 'alert_tipo_atraso_inicio_ativo', true);
      setCheck('alertTipoExcessoVelocidadeAtivo', 'alert_tipo_excesso_velocidade_ativo', true);
      setCheck('alertWhatsAppAtivo', 'alert_whatsapp_ativo', false);
      setCheck('alertWhatsAppNotificarMotorista', 'alert_whatsapp_notificar_motorista', true);
      setCheck('alertWhatsAppNotificarProgramador', 'alert_whatsapp_notificar_programador', false);
      setCheck('alertWhatsAppNotificarCentral', 'alert_whatsapp_notificar_central', false);
      setCheck('alertWhatsAppTipoParada', 'alert_whatsapp_tipo_parada', false);
      setCheck('alertWhatsAppTipoAtraso', 'alert_whatsapp_tipo_atraso', false);
      setCheck('alertWhatsAppTipoEtaPrazo', 'alert_whatsapp_tipo_eta_prazo', false);
      setCheck('alertWhatsAppTipoOffline', 'alert_whatsapp_tipo_offline', false);
      setCheck('alertWhatsAppTipoDesvio', 'alert_whatsapp_tipo_desvio', false);
      setCheck('alertWhatsAppTipoAtrasoInicio', 'alert_whatsapp_tipo_atraso_inicio', false);
      setCheck('alertWhatsAppTipoExcessoVelocidade', 'alert_whatsapp_tipo_excesso_velocidade', false);
      const celCent = document.getElementById('alertWhatsAppCelularCentral');
      if (celCent) celCent.value = data.alert_whatsapp_celular_central != null ? String(data.alert_whatsapp_celular_central) : '';
      const heartbeatTipos = document.getElementById('alertHeartbeatTipos');
      if (heartbeatTipos) heartbeatTipos.value = data.alert_heartbeat_tipos != null ? String(data.alert_heartbeat_tipos) : 'PARADA';
      const fgsitCodes = String(data.alert_fgsitviagem != null ? data.alert_fgsitviagem : '')
        .split(',')
        .map(s => String(s || '').trim().toUpperCase())
        .filter(Boolean);
      const setFgsit = (code) => {
        const el = document.getElementById(`alertFgsitviagem${code}`);
        if (el) el.checked = fgsitCodes.includes(code);
      };
      ['P', 'D', 'T', 'A', 'F', 'C', 'E', 'M'].forEach(setFgsit);
      const avisoFgsit = document.getElementById('alertFgsitviagemAvisoExplicito');
      if (avisoFgsit) {
        if (fgsitCodes.length === 0) {
          avisoFgsit.style.display = 'block';
          avisoFgsit.textContent =
            'Modo padrão ativo: nenhum código salvo no banco — o job inclui viagens cuja situação não seja D, E, F ou C. (Os checkboxes desmarcados aqui só refletem “vazio”; ao Salvar sem marcar nenhum, continua o padrão.)';
        } else {
          avisoFgsit.style.display = 'block';
          avisoFgsit.textContent =
            'Filtro explícito: só entram viagens com FGSITVIAGEM igual a um dos códigos marcados. Se o job “não gera alertas”, confira se a viagem está em T, P, A, M, etc., conforme seu cadastro.';
        }
      }
      showAlertasMessage('Configurações de alertas carregadas.', 'success');
    } catch (err) {
      showAlertasMessage('Erro ao carregar configurações de alertas.', 'error');
    }
  }

  let salvandoAlertas = false;
  let ultimoIntervaloAlertasCarregado = null;
  async function salvarAlertas() {
    if (salvandoAlertas) return;
    salvandoAlertas = true;
    if (btnSalvarAlertas) {
      btnSalvarAlertas.disabled = true;
      btnSalvarAlertas.innerHTML = '<i class="bx bx-loader bx-spin"></i> Salvando...';
    }
    if (messageAlertasEl) { messageAlertasEl.style.display = 'none'; messageAlertasEl.textContent = ''; }
    try {
      const getNum = (id, def) => {
        const el = document.getElementById(id);
        const n = el && el.value !== '' ? parseInt(el.value, 10) : def;
        return isNaN(n) ? def : n;
      };
      const getCheck = (id) => {
        const el = document.getElementById(id);
        return el && el.checked;
      };
      const getFgsitSelecionados = () => {
        const codes = ['P', 'D', 'T', 'A', 'F', 'C', 'E', 'M'];
        return codes.filter(code => {
          const el = document.getElementById(`alertFgsitviagem${code}`);
          return !!(el && el.checked);
        }).join(',');
      };
      const payload = {
        alert_offline_minutos: getNum('alertOfflineMinutos', 90),
        alert_parada_velocidade_max: getNum('alertParadaVelocidadeMax', 5),
        alert_parada_minutos_min: getNum('alertParadaMinutosMin', 30),
        alert_parada_janela_posicoes: getNum('alertParadaJanelaPosicoes', 60),
        alert_parada_raio_metros: getNum('alertParadaRaioMetros', 200),
        alert_desvio_metros: getNum('alertDesvioMetros', 500),
        alert_desvio_suprimir_quando_parado_ativo: getCheck('alertDesvioSuprimirQuandoParadoAtivo') ? 'S' : 'N',
        alert_atraso_inicio_margem_minutos: getNum('alertAtrasoInicioMargemMinutos', 15),
        alert_excesso_velocidade_kmh: getNum('alertExcessoVelocidadeKmh', 100),
        alert_excesso_velocidade_janela: getNum('alertExcessoVelocidadeJanela', 5),
        alert_job_intervalo_minutos: getNum('alertJobIntervaloMinutos', 5),
        alert_cooldown_minutos: getNum('alertCooldownMinutos', 30),
        alert_whatsapp_reenvio_minutos: getNum('alertWhatsAppReenvioMinutos', 30),
        alert_heartbeat_intervalo_minutos: getNum('alertHeartbeatIntervaloMinutos', 15),
        alert_job_ativo: getCheck('alertJobAtivo') ? 'S' : 'N',
        alert_heartbeat_ativo: getCheck('alertHeartbeatAtivo') ? 'S' : 'N',
        alert_heartbeat_tipos: (document.getElementById('alertHeartbeatTipos') && document.getElementById('alertHeartbeatTipos').value)
          ? String(document.getElementById('alertHeartbeatTipos').value).toUpperCase().replace(/\s+/g, '')
          : 'PARADA',
        alert_tipo_parada_ativo: getCheck('alertTipoParadaAtivo') ? 'S' : 'N',
        alert_tipo_atraso_ativo: getCheck('alertTipoAtrasoAtivo') ? 'S' : 'N',
        alert_tipo_eta_prazo_ativo: getCheck('alertTipoEtaPrazoAtivo') ? 'S' : 'N',
        alert_tipo_offline_ativo: getCheck('alertTipoOfflineAtivo') ? 'S' : 'N',
        alert_tipo_desvio_ativo: getCheck('alertTipoDesvioAtivo') ? 'S' : 'N',
        alert_tipo_atraso_inicio_ativo: getCheck('alertTipoAtrasoInicioAtivo') ? 'S' : 'N',
        alert_tipo_excesso_velocidade_ativo: getCheck('alertTipoExcessoVelocidadeAtivo') ? 'S' : 'N',
        alert_fgsitviagem: getFgsitSelecionados(),
        alert_whatsapp_ativo: getCheck('alertWhatsAppAtivo') ? 'S' : 'N',
        alert_whatsapp_notificar_motorista: getCheck('alertWhatsAppNotificarMotorista') ? 'S' : 'N',
        alert_whatsapp_notificar_programador: getCheck('alertWhatsAppNotificarProgramador') ? 'S' : 'N',
        alert_whatsapp_notificar_central: getCheck('alertWhatsAppNotificarCentral') ? 'S' : 'N',
        alert_whatsapp_celular_central: (document.getElementById('alertWhatsAppCelularCentral') && document.getElementById('alertWhatsAppCelularCentral').value) ? document.getElementById('alertWhatsAppCelularCentral').value.trim() : '',
        alert_whatsapp_tipo_parada: getCheck('alertWhatsAppTipoParada') ? 'S' : 'N',
        alert_whatsapp_tipo_atraso: getCheck('alertWhatsAppTipoAtraso') ? 'S' : 'N',
        alert_whatsapp_tipo_eta_prazo: getCheck('alertWhatsAppTipoEtaPrazo') ? 'S' : 'N',
        alert_whatsapp_tipo_offline: getCheck('alertWhatsAppTipoOffline') ? 'S' : 'N',
        alert_whatsapp_tipo_desvio: getCheck('alertWhatsAppTipoDesvio') ? 'S' : 'N',
        alert_whatsapp_tipo_atraso_inicio: getCheck('alertWhatsAppTipoAtrasoInicio') ? 'S' : 'N',
        alert_whatsapp_tipo_excesso_velocidade: getCheck('alertWhatsAppTipoExcessoVelocidade') ? 'S' : 'N'
      };
      const intervaloAnterior = ultimoIntervaloAlertasCarregado;
      const res = await fetch('/api/configuracoes/alertas', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        ultimoIntervaloAlertasCarregado = Number(payload.alert_job_intervalo_minutos);
        if (
          intervaloAnterior != null &&
          Number(intervaloAnterior) !== Number(payload.alert_job_intervalo_minutos) &&
          !data.jobIntervalReiniciado
        ) {
          showAlertasMessage(
            'Configurações salvas. O intervalo do job segue o tenant padrão: entre com um utilizador desse tenant e salve de novo, ou reinicie o backend.',
            'warning'
          );
        } else {
          showAlertasMessage(data.message || 'Configurações salvas. O job de alertas usará os novos valores na próxima execução.', 'success');
        }
      } else {
        showAlertasMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      showAlertasMessage('Erro ao salvar.', 'error');
    } finally {
      salvandoAlertas = false;
      if (btnSalvarAlertas) {
        btnSalvarAlertas.disabled = false;
        btnSalvarAlertas.innerHTML = '<i class="bx bx-save"></i> Salvar';
      }
    }
  }

  if (btnCarregarAlertas) btnCarregarAlertas.addEventListener('click', carregarAlertas);
  if (btnSalvarAlertas) btnSalvarAlertas.addEventListener('click', salvarAlertas);
  carregarAlertas();

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
        headers: getAuthJsonHeaders(),
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

  // OpenAI — chave Whisper (transcrição no chat)
  const openaiApiKeyInput = document.getElementById('openaiApiKeyInput');
  const openaiApiKeyStatusEl = document.getElementById('openaiApiKeyStatus');
  const btnSalvarOpenAi = document.getElementById('btnSalvarOpenAi');
  const btnCarregarOpenAi = document.getElementById('btnCarregarOpenAi');
  const btnRemoverOpenAiBanco = document.getElementById('btnRemoverOpenAiBanco');
  const btnSalvarOpenAiText = document.getElementById('btnSalvarOpenAiText');
  const messageOpenAiEl = document.getElementById('configOpenAiMessage');

  function showOpenAiMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageOpenAiEl) {
      messageOpenAiEl.textContent = text;
      messageOpenAiEl.className =
        'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageOpenAiEl.style.display = 'block';
    }
  }

  function renderOpenAiStatus(data) {
    if (!openaiApiKeyStatusEl || !data) return;
    const mask = (data.maskedKey || '').trim();
    if (!data.configured) {
      openaiApiKeyStatusEl.textContent =
        t('web.modulos.configuracoes.openaiApiKeyOrigemNenhuma') || 'Nenhuma chave configurada.';
      return;
    }
    if (data.activeSource === 'database') {
      openaiApiKeyStatusEl.textContent =
        (t('web.modulos.configuracoes.openaiApiKeyOrigemBanco') || 'Origem: banco de dados.') +
        (mask ? ' ' + (t('web.modulos.configuracoes.openaiApiKeyMascarada') || 'Máscara:') + ' ' + mask : '');
    } else {
      openaiApiKeyStatusEl.textContent =
        (t('web.modulos.configuracoes.openaiApiKeyOrigemEnv') || 'Origem: variável OPENAI_API_KEY no servidor (.env).') +
        (mask ? ' ' + (t('web.modulos.configuracoes.openaiApiKeyMascarada') || 'Máscara:') + ' ' + mask : '');
    }
  }

  async function carregarOpenAi(silent) {
    try {
      const res = await fetch('/api/configuracoes/openai', { headers: getAuthJsonHeaders() });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        showOpenAiMessage(data.message || 'Faça login novamente para gerenciar a chave OpenAI.', 'error');
        return;
      }
      if (!res.ok) {
        showOpenAiMessage(data.error || 'Erro ao carregar.', 'error');
        return;
      }
      renderOpenAiStatus(data);
      if (openaiApiKeyInput) openaiApiKeyInput.value = '';
      if (!silent) {
        showOpenAiMessage(t('web.modulos.configuracoes.configuracoesCarregadas') || 'Configurações carregadas.', 'success');
      }
    } catch (err) {
      showOpenAiMessage('Erro ao carregar.', 'error');
    }
  }

  let salvandoOpenAi = false;
  async function salvarOpenAi() {
    if (salvandoOpenAi) return;
    const key = openaiApiKeyInput && openaiApiKeyInput.value ? openaiApiKeyInput.value.trim() : '';
    if (!key) {
      showOpenAiMessage(
        t('web.modulos.configuracoes.openaiApiKeyInformeNova') || 'Informe a nova chave no campo ou use Remover do banco.',
        'error'
      );
      return;
    }
    salvandoOpenAi = true;
    if (btnSalvarOpenAi) btnSalvarOpenAi.disabled = true;
    if (btnSalvarOpenAiText)
      btnSalvarOpenAiText.textContent =
        typeof window.tWeb === 'function' ? window.tWeb('web.common.salvando') || 'Salvando...' : 'Salvando...';
    if (messageOpenAiEl) {
      messageOpenAiEl.style.display = 'none';
      messageOpenAiEl.textContent = '';
    }
    try {
      const res = await fetch('/api/configuracoes/openai', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ apiKey: key }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        showOpenAiMessage(data.message || 'Sessão expirada.', 'error');
        return;
      }
      if (res.ok) {
        if (openaiApiKeyInput) openaiApiKeyInput.value = '';
        showOpenAiMessage(data.message || t('web.modulos.configuracoes.sucessoSalvar') || 'Salvo!', 'success');
        await carregarOpenAi(true);
      } else {
        showOpenAiMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      showOpenAiMessage('Erro ao salvar.', 'error');
    } finally {
      salvandoOpenAi = false;
      if (btnSalvarOpenAi) btnSalvarOpenAi.disabled = false;
      if (btnSalvarOpenAiText) btnSalvarOpenAiText.textContent = t('web.modulos.configuracoes.salvar') || 'Salvar';
    }
  }

  async function removerOpenAiDoBanco() {
    if (salvandoOpenAi) return;
    const msg =
      t('web.modulos.configuracoes.openaiApiKeyConfirmRemover') ||
      'Remover a chave salva no banco? Se existir OPENAI_API_KEY no .env do servidor, ela será usada.';
    const ok =
      typeof window.confirmPadrao === 'function'
        ? await window.confirmPadrao(msg, {
            title: 'Remover chave OpenAI',
            danger: true,
            confirmText: 'Remover',
            cancelText: 'Cancelar',
          })
        : window.confirm(msg);
    if (!ok) return;
    salvandoOpenAi = true;
    if (btnRemoverOpenAiBanco) btnRemoverOpenAiBanco.disabled = true;
    try {
      const res = await fetch('/api/configuracoes/openai', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ removeFromDatabase: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        showOpenAiMessage(data.message || 'Sessão expirada.', 'error');
        return;
      }
      if (res.ok) {
        showOpenAiMessage(data.message || 'Removido.', 'success');
        await carregarOpenAi(true);
      } else {
        showOpenAiMessage(data.error || 'Erro ao remover.', 'error');
      }
    } catch (err) {
      showOpenAiMessage('Erro ao remover.', 'error');
    } finally {
      salvandoOpenAi = false;
      if (btnRemoverOpenAiBanco) btnRemoverOpenAiBanco.disabled = false;
    }
  }

  if (btnSalvarOpenAi) btnSalvarOpenAi.addEventListener('click', salvarOpenAi);
  if (btnCarregarOpenAi) btnCarregarOpenAi.addEventListener('click', carregarOpenAi);
  if (btnRemoverOpenAiBanco) btnRemoverOpenAiBanco.addEventListener('click', removerOpenAiDoBanco);
  carregarOpenAi();

  // Mensagens WhatsApp – convocações (duas colunas: modelo + pré-visualização ao vivo)
  const msgConvDisparoEl = document.getElementById('msgConvDisparo');
  const divPlacasNotifSwitchEl = document.getElementById('divPlacasNotificarSwitch');
  const divPlacasNotifTorreWsEl = document.getElementById('divPlacasNotificarTorreWebsocket');
  const btnSalvarSecaoDivPlacasNotif = document.getElementById('btnSalvarSecaoDivPlacasNotif');
  const msgConvConfirmacaoSelEl = document.getElementById('msgConvConfirmacaoSel');
  const msgConvConfirmacaoNaoSelEl = document.getElementById('msgConvConfirmacaoNaoSel');
  const btnSalvarMensagensConvocacao = document.getElementById('btnSalvarMensagensConvocacao');
  const btnCarregarMensagensConvocacao = document.getElementById('btnCarregarMensagensConvocacao');
  const btnSalvarMensagensConvocacaoText = document.getElementById('btnSalvarMensagensConvocacaoText');
  const messageMensagensConvocacaoEl = document.getElementById('configMensagensConvocacaoMessage');
  const msgConvLinkAppExemploEl = document.getElementById('msgConvLinkAppExemplo');
  const msgConvPreviewDisparoEl = document.getElementById('msgConvPreviewDisparo');
  const msgConvPreviewConfirmacaoSelEl = document.getElementById('msgConvPreviewConfirmacaoSel');
  const msgConvPreviewConfirmacaoNaoSelEl = document.getElementById('msgConvPreviewConfirmacaoNaoSel');
  const btnCarregarSugestaoDisparo = document.getElementById('btnCarregarSugestaoDisparo');
  const btnCarregarSugestaoConfirmacaoSel = document.getElementById('btnCarregarSugestaoConfirmacaoSel');
  const btnCarregarSugestaoConfirmacaoNaoSel = document.getElementById('btnCarregarSugestaoConfirmacaoNaoSel');
  const btnSalvarSecaoDisparo = document.getElementById('btnSalvarSecaoDisparo');
  const btnSalvarSecaoConfirmacaoSel = document.getElementById('btnSalvarSecaoConfirmacaoSel');
  const btnSalvarSecaoConfirmacaoNaoSel = document.getElementById('btnSalvarSecaoConfirmacaoNaoSel');
  const botoesSalvarSecaoMsgConv = [
    btnSalvarSecaoDisparo,
    btnSalvarSecaoConfirmacaoSel,
    btnSalvarSecaoConfirmacaoNaoSel,
    btnSalvarSecaoDivPlacasNotif,
  ].filter(Boolean);

  const mensagensConvCache = {
    templatesSugeridos: {
      disparo: '',
      confirmacaoSelecionado: '',
      confirmacaoNaoSelecionado: '',
    },
  };

  const previewTipoApi = {
    disparo: 'disparo',
    confirmacaoSel: 'confirmacaoSel',
    confirmacaoNaoSel: 'confirmacaoNaoSel',
  };

  const previewSeq = { disparo: 0, confirmacaoSel: 0, confirmacaoNaoSel: 0 };
  const previewDebounce = { disparo: null, confirmacaoSel: null, confirmacaoNaoSel: null };

  function atualizarHintLinkAppExemplo(data) {
    if (!msgConvLinkAppExemploEl) return;
    const link = (data.linkAppUsadoNoExemplo || '').trim();
    if (link) {
      msgConvLinkAppExemploEl.textContent =
        'Na pré-visualização do motorista selecionado, {{LINK_APP_MOTORISTA}} e {{BLOCO_LINK_APP}} usam o link configurado no card acima (Link do app motorista): ' + link;
    } else {
      msgConvLinkAppExemploEl.textContent =
        'Sem link de app no card acima (Link do app motorista) nem APP_URL no servidor — na pré-visualização do selecionado o trecho de aplicativo fica vazio.';
    }
  }

  async function executarPreviewMensagemConvocacao(chaveUi) {
    const map = {
      disparo: { ta: msgConvDisparoEl, pre: msgConvPreviewDisparoEl, api: previewTipoApi.disparo },
      confirmacaoSel: { ta: msgConvConfirmacaoSelEl, pre: msgConvPreviewConfirmacaoSelEl, api: previewTipoApi.confirmacaoSel },
      confirmacaoNaoSel: { ta: msgConvConfirmacaoNaoSelEl, pre: msgConvPreviewConfirmacaoNaoSelEl, api: previewTipoApi.confirmacaoNaoSel },
    };
    const cfg = map[chaveUi];
    if (!cfg || !cfg.pre) return;
    const mySeq = ++previewSeq[chaveUi];
    cfg.pre.classList.add('msg-conv-preview-loading');
    cfg.pre.textContent = 'Atualizando…';
    try {
      const res = await fetch('/api/configuracoes/mensagens-convocacao/preview', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ tipo: cfg.api, corpo: cfg.ta ? cfg.ta.value : '' }),
      });
      const data = await res.json();
      if (previewSeq[chaveUi] !== mySeq) return;
      if (res.ok) {
        cfg.pre.textContent = data.renderizado != null ? data.renderizado : '';
      } else {
        cfg.pre.textContent = '(Erro: ' + (data.error || 'pré-visualização') + ')';
      }
    } catch (err) {
      if (previewSeq[chaveUi] !== mySeq) return;
      cfg.pre.textContent = '(Falha ao gerar pré-visualização.)';
    } finally {
      if (previewSeq[chaveUi] === mySeq) cfg.pre.classList.remove('msg-conv-preview-loading');
    }
  }

  function agendarPreviewMensagemConvocacao(chaveUi) {
    if (previewDebounce[chaveUi]) clearTimeout(previewDebounce[chaveUi]);
    previewDebounce[chaveUi] = setTimeout(() => {
      previewDebounce[chaveUi] = null;
      executarPreviewMensagemConvocacao(chaveUi);
    }, 400);
  }

  async function atualizarTodasPreviewsMensagensConvocacao() {
    await Promise.all([
      executarPreviewMensagemConvocacao('disparo'),
      executarPreviewMensagemConvocacao('confirmacaoSel'),
      executarPreviewMensagemConvocacao('confirmacaoNaoSel'),
    ]);
  }

  function showMensagensConvocacaoMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageMensagensConvocacaoEl) {
      messageMensagensConvocacaoEl.textContent = text;
      messageMensagensConvocacaoEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageMensagensConvocacaoEl.style.display = 'block';
    }
  }

  async function carregarMensagensConvocacao() {
    try {
      const res = await fetch('/api/configuracoes/mensagens-convocacao');
      const data = await res.json();
      if (res.ok) {
        if (msgConvDisparoEl) msgConvDisparoEl.value = data.disparoCorpo || '';
        if (msgConvConfirmacaoSelEl) msgConvConfirmacaoSelEl.value = data.confirmacaoSelecionadoCorpo || '';
        if (msgConvConfirmacaoNaoSelEl) msgConvConfirmacaoNaoSelEl.value = data.confirmacaoNaoSelecionadoCorpo || '';
        if (divPlacasNotifSwitchEl) divPlacasNotifSwitchEl.value = data.divergenciaPlacasNotificarSwitch === 'N' ? 'N' : 'S';
        if (divPlacasNotifTorreWsEl) divPlacasNotifTorreWsEl.value = data.divergenciaPlacasNotificarTorreWebsocket === 'N' ? 'N' : 'S';
        if (data.templatesSugeridos) {
          mensagensConvCache.templatesSugeridos.disparo = data.templatesSugeridos.disparo || '';
          mensagensConvCache.templatesSugeridos.confirmacaoSelecionado = data.templatesSugeridos.confirmacaoSelecionado || '';
          mensagensConvCache.templatesSugeridos.confirmacaoNaoSelecionado = data.templatesSugeridos.confirmacaoNaoSelecionado || '';
        }
        atualizarHintLinkAppExemplo(data);
        await atualizarTodasPreviewsMensagensConvocacao();
        showMensagensConvocacaoMessage(t('web.modulos.configuracoes.configuracoesCarregadas') || 'Configurações carregadas.', 'success');
      } else {
        showMensagensConvocacaoMessage(data.error || 'Erro ao carregar.', 'error');
      }
    } catch (err) {
      showMensagensConvocacaoMessage('Erro ao carregar.', 'error');
    }
  }

  let salvandoMensagensConvocacao = false;
  let salvandoMensagemConvocacaoParcial = false;

  async function salvarMensagemConvocacaoParcial(chave) {
    if (salvandoMensagensConvocacao || salvandoMensagemConvocacaoParcial) return;
    const payloads = {
      disparo: { disparoCorpo: msgConvDisparoEl ? msgConvDisparoEl.value : '' },
      confirmacaoSel: { confirmacaoSelecionadoCorpo: msgConvConfirmacaoSelEl ? msgConvConfirmacaoSelEl.value : '' },
      confirmacaoNaoSel: { confirmacaoNaoSelecionadoCorpo: msgConvConfirmacaoNaoSelEl ? msgConvConfirmacaoNaoSelEl.value : '' },
      divergenciaNotif: {
        divergenciaPlacasNotificarSwitch: divPlacasNotifSwitchEl ? divPlacasNotifSwitchEl.value : 'S',
        divergenciaPlacasNotificarTorreWebsocket: divPlacasNotifTorreWsEl ? divPlacasNotifTorreWsEl.value : 'S',
      },
    };
    const msgsOk = {
      disparo: 'Disparo de convocação salvo.',
      confirmacaoSel: 'Mensagem de confirmação (motorista selecionado) salva.',
      confirmacaoNaoSel: 'Mensagem para não selecionado salva.',
      divergenciaNotif: 'Notificações de divergência de placas salvas.',
    };
    const btnPorChave = {
      disparo: btnSalvarSecaoDisparo,
      confirmacaoSel: btnSalvarSecaoConfirmacaoSel,
      confirmacaoNaoSel: btnSalvarSecaoConfirmacaoNaoSel,
      divergenciaNotif: btnSalvarSecaoDivPlacasNotif,
    };
    const body = payloads[chave];
    const btnEste = btnPorChave[chave];
    if (!body) return;

    salvandoMensagemConvocacaoParcial = true;
    botoesSalvarSecaoMsgConv.forEach((b) => {
      if (b) b.disabled = true;
    });
    if (btnEste) {
      const orig = btnEste.innerHTML;
      btnEste.dataset.htmlOriginal = orig;
      btnEste.innerHTML = '<i class="bx bx-loader bx-spin"></i> Salvando…';
    }
    if (messageMensagensConvocacaoEl) {
      messageMensagensConvocacaoEl.style.display = 'none';
      messageMensagensConvocacaoEl.textContent = '';
    }
    try {
      const res = await fetch('/api/configuracoes/mensagens-convocacao', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.ok) {
        showMensagensConvocacaoMessage(msgsOk[chave], 'success');
        await atualizarTodasPreviewsMensagensConvocacao();
      } else {
        showMensagensConvocacaoMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      showMensagensConvocacaoMessage('Erro ao salvar.', 'error');
    } finally {
      salvandoMensagemConvocacaoParcial = false;
      botoesSalvarSecaoMsgConv.forEach((b) => {
        if (b) b.disabled = false;
      });
      if (btnEste && btnEste.dataset.htmlOriginal) {
        btnEste.innerHTML = btnEste.dataset.htmlOriginal;
        delete btnEste.dataset.htmlOriginal;
      }
    }
  }

  async function salvarMensagensConvocacao() {
    if (salvandoMensagensConvocacao || salvandoMensagemConvocacaoParcial) return;
    salvandoMensagensConvocacao = true;
    if (btnSalvarMensagensConvocacao) {
      btnSalvarMensagensConvocacao.disabled = true;
      if (btnSalvarMensagensConvocacaoText) {
        btnSalvarMensagensConvocacaoText.textContent =
          typeof window.tWeb === 'function' ? window.tWeb('web.common.salvando') || 'Salvando...' : 'Salvando...';
      }
    }
    botoesSalvarSecaoMsgConv.forEach((b) => {
      if (b) b.disabled = true;
    });
    if (messageMensagensConvocacaoEl) {
      messageMensagensConvocacaoEl.style.display = 'none';
      messageMensagensConvocacaoEl.textContent = '';
    }
    try {
      const res = await fetch('/api/configuracoes/mensagens-convocacao', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({
          disparoCorpo: msgConvDisparoEl ? msgConvDisparoEl.value : '',
          confirmacaoSelecionadoCorpo: msgConvConfirmacaoSelEl ? msgConvConfirmacaoSelEl.value : '',
          confirmacaoNaoSelecionadoCorpo: msgConvConfirmacaoNaoSelEl ? msgConvConfirmacaoNaoSelEl.value : '',
          divergenciaPlacasNotificarSwitch: divPlacasNotifSwitchEl ? divPlacasNotifSwitchEl.value : 'S',
          divergenciaPlacasNotificarTorreWebsocket: divPlacasNotifTorreWsEl ? divPlacasNotifTorreWsEl.value : 'S',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showMensagensConvocacaoMessage(data.message || 'As três mensagens foram salvas.', 'success');
        await atualizarTodasPreviewsMensagensConvocacao();
      } else {
        showMensagensConvocacaoMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (err) {
      showMensagensConvocacaoMessage('Erro ao salvar.', 'error');
    } finally {
      salvandoMensagensConvocacao = false;
      if (btnSalvarMensagensConvocacao) {
        btnSalvarMensagensConvocacao.disabled = false;
        if (btnSalvarMensagensConvocacaoText) {
          btnSalvarMensagensConvocacaoText.textContent = 'Salvar todas';
        }
      }
      botoesSalvarSecaoMsgConv.forEach((b) => {
        if (b) b.disabled = false;
      });
    }
  }

  if (btnSalvarMensagensConvocacao) btnSalvarMensagensConvocacao.addEventListener('click', salvarMensagensConvocacao);
  if (btnCarregarMensagensConvocacao) btnCarregarMensagensConvocacao.addEventListener('click', carregarMensagensConvocacao);

  if (btnSalvarSecaoDisparo) btnSalvarSecaoDisparo.addEventListener('click', () => salvarMensagemConvocacaoParcial('disparo'));
  if (btnSalvarSecaoConfirmacaoSel) btnSalvarSecaoConfirmacaoSel.addEventListener('click', () => salvarMensagemConvocacaoParcial('confirmacaoSel'));
  if (btnSalvarSecaoConfirmacaoNaoSel) btnSalvarSecaoConfirmacaoNaoSel.addEventListener('click', () => salvarMensagemConvocacaoParcial('confirmacaoNaoSel'));
  if (btnSalvarSecaoDivPlacasNotif) btnSalvarSecaoDivPlacasNotif.addEventListener('click', () => salvarMensagemConvocacaoParcial('divergenciaNotif'));

  if (btnCarregarSugestaoDisparo) {
    btnCarregarSugestaoDisparo.addEventListener('click', () => {
      if (msgConvDisparoEl && mensagensConvCache.templatesSugeridos.disparo) {
        msgConvDisparoEl.value = mensagensConvCache.templatesSugeridos.disparo;
        executarPreviewMensagemConvocacao('disparo');
      }
    });
  }
  if (btnCarregarSugestaoConfirmacaoSel) {
    btnCarregarSugestaoConfirmacaoSel.addEventListener('click', () => {
      if (msgConvConfirmacaoSelEl && mensagensConvCache.templatesSugeridos.confirmacaoSelecionado) {
        msgConvConfirmacaoSelEl.value = mensagensConvCache.templatesSugeridos.confirmacaoSelecionado;
        executarPreviewMensagemConvocacao('confirmacaoSel');
      }
    });
  }
  if (btnCarregarSugestaoConfirmacaoNaoSel) {
    btnCarregarSugestaoConfirmacaoNaoSel.addEventListener('click', () => {
      if (msgConvConfirmacaoNaoSelEl && mensagensConvCache.templatesSugeridos.confirmacaoNaoSelecionado) {
        msgConvConfirmacaoNaoSelEl.value = mensagensConvCache.templatesSugeridos.confirmacaoNaoSelecionado;
        executarPreviewMensagemConvocacao('confirmacaoNaoSel');
      }
    });
  }

  if (msgConvDisparoEl) msgConvDisparoEl.addEventListener('input', () => agendarPreviewMensagemConvocacao('disparo'));
  if (msgConvConfirmacaoSelEl) msgConvConfirmacaoSelEl.addEventListener('input', () => agendarPreviewMensagemConvocacao('confirmacaoSel'));
  if (msgConvConfirmacaoNaoSelEl) msgConvConfirmacaoNaoSelEl.addEventListener('input', () => agendarPreviewMensagemConvocacao('confirmacaoNaoSel'));

  // Mensagens WhatsApp – alertas automáticos (um modelo por tipo)
  const msgAlertTipoSelect = document.getElementById('msgAlertTipoSelect');
  const msgAlertCorpoEl = document.getElementById('msgAlertCorpo');
  const msgAlertPreviewEl = document.getElementById('msgAlertPreview');
  const btnMsgAlertCarregarSugerido = document.getElementById('btnMsgAlertCarregarSugerido');
  const btnMsgAlertSalvar = document.getElementById('btnMsgAlertSalvar');
  const btnMsgAlertRecarregar = document.getElementById('btnMsgAlertRecarregar');
  const messageMensagensAlertasEl = document.getElementById('configMensagensAlertasMessage');
  const msgAlertCache = {
    porTipo: {},
    templatesSugeridos: {},
    tipoAtual: 'parada',
  };
  function showMensagensAlertasMessage(text, type) {
    if (typeof window.showMessage === 'function') window.showMessage(text, type);
    if (messageMensagensAlertasEl) {
      messageMensagensAlertasEl.textContent = text;
      messageMensagensAlertasEl.className = 'message show ' + (type === 'success' ? 'success' : type === 'error' ? 'error' : 'info');
      messageMensagensAlertasEl.style.display = text ? 'block' : 'none';
    }
  }

  function commitMsgAlertCorpoParaCache() {
    const tipo = msgAlertCache.tipoAtual;
    if (msgAlertCorpoEl) msgAlertCache.porTipo[tipo] = msgAlertCorpoEl.value;
  }

  function inserirPlaceholderMsgAlert(ph) {
    if (!msgAlertCorpoEl || !ph) return;
    const el = msgAlertCorpoEl;
    const start = el.selectionStart != null ? el.selectionStart : 0;
    const end = el.selectionEnd != null ? el.selectionEnd : 0;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + ph + after;
    const pos = start + ph.length;
    el.focus();
    try {
      el.setSelectionRange(pos, pos);
    } catch (e) {
      /* ignore */
    }
    msgAlertCache.porTipo[msgAlertCache.tipoAtual] = el.value;
    agendarPreviewMsgAlert();
  }

  const msgAlertPlaceholdersEl = document.getElementById('msgAlertPlaceholders');
  if (msgAlertPlaceholdersEl) {
    msgAlertPlaceholdersEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.msg-alert-chip');
      if (!btn || !msgAlertCorpoEl) return;
      const ph = btn.getAttribute('data-ph');
      if (ph) inserirPlaceholderMsgAlert(ph);
    });
  }

  let timerPreviewMsgAlert = null;
  async function executarPreviewMsgAlert() {
    if (!msgAlertPreviewEl || !msgAlertTipoSelect) return;
    const tipo = msgAlertTipoSelect.value;
    const corpo = msgAlertCorpoEl ? msgAlertCorpoEl.value : '';
    msgAlertPreviewEl.classList.add('msg-conv-preview-loading');
    msgAlertPreviewEl.textContent = 'Gerando pré-visualização…';
    try {
      const res = await fetch('/api/configuracoes/mensagens-alertas/preview', {
        method: 'POST',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({ tipo, corpo }),
      });
      const data = await res.json();
      if (res.ok && data.renderizado != null) {
        msgAlertPreviewEl.textContent = data.renderizado;
      } else {
        msgAlertPreviewEl.textContent = data.error || 'Erro na pré-visualização.';
      }
    } catch (e) {
      msgAlertPreviewEl.textContent = 'Erro ao pré-visualizar.';
    } finally {
      msgAlertPreviewEl.classList.remove('msg-conv-preview-loading');
    }
  }

  function agendarPreviewMsgAlert() {
    if (timerPreviewMsgAlert) clearTimeout(timerPreviewMsgAlert);
    timerPreviewMsgAlert = setTimeout(executarPreviewMsgAlert, 350);
  }

  function aplicarTipoMsgAlert(novoTipo) {
    commitMsgAlertCorpoParaCache();
    msgAlertCache.tipoAtual = novoTipo;
    if (msgAlertCorpoEl) {
      msgAlertCorpoEl.value = msgAlertCache.porTipo[novoTipo] != null ? msgAlertCache.porTipo[novoTipo] : '';
    }
    agendarPreviewMsgAlert();
  }

  async function carregarMensagensAlertas(opts) {
    const silent = opts && opts.silent === true;
    try {
      const res = await fetch('/api/configuracoes/mensagens-alertas');
      const data = await res.json();
      msgAlertCache.porTipo = {
        parada: data.paradaCorpo || '',
        atraso: data.atrasoCorpo || '',
        eta_prazo: data.etaPrazoCorpo || '',
        offline: data.offlineCorpo || '',
        desvio: data.desvioCorpo || '',
        atraso_inicio: data.atrasoInicioCorpo || '',
        excesso_velocidade: data.excessoVelocidadeCorpo || '',
      };
      msgAlertCache.templatesSugeridos = data.templatesSugeridos || {};
      if (msgAlertTipoSelect) msgAlertTipoSelect.value = msgAlertCache.tipoAtual;
      if (msgAlertCorpoEl) {
        const t = msgAlertTipoSelect ? msgAlertTipoSelect.value : 'parada';
        msgAlertCorpoEl.value = msgAlertCache.porTipo[t] != null ? msgAlertCache.porTipo[t] : '';
      }
      if (!silent) {
        showMensagensAlertasMessage('Modelos de alerta carregados do servidor.', 'success');
      } else if (messageMensagensAlertasEl) {
        messageMensagensAlertasEl.style.display = 'none';
        messageMensagensAlertasEl.textContent = '';
      }
      await executarPreviewMsgAlert();
    } catch (e) {
      showMensagensAlertasMessage('Erro ao carregar modelos de alerta.', 'error');
    }
  }

  async function salvarMensagensAlertas() {
    commitMsgAlertCorpoParaCache();
    if (btnMsgAlertSalvar) btnMsgAlertSalvar.disabled = true;
    try {
      const p = msgAlertCache.porTipo;
      const res = await fetch('/api/configuracoes/mensagens-alertas', {
        method: 'PUT',
        headers: getAuthJsonHeaders(),
        body: JSON.stringify({
          paradaCorpo: p.parada != null ? p.parada : '',
          atrasoCorpo: p.atraso != null ? p.atraso : '',
          etaPrazoCorpo: p.eta_prazo != null ? p.eta_prazo : '',
          offlineCorpo: p.offline != null ? p.offline : '',
          desvioCorpo: p.desvio != null ? p.desvio : '',
          atrasoInicioCorpo: p.atraso_inicio != null ? p.atraso_inicio : '',
          excessoVelocidadeCorpo: p.excesso_velocidade != null ? p.excesso_velocidade : '',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showMensagensAlertasMessage(data.message || 'Modelos salvos.', 'success');
      } else {
        showMensagensAlertasMessage(data.error || 'Erro ao salvar.', 'error');
      }
    } catch (e) {
      showMensagensAlertasMessage('Erro ao salvar.', 'error');
    } finally {
      if (btnMsgAlertSalvar) btnMsgAlertSalvar.disabled = false;
    }
  }

  if (msgAlertTipoSelect) {
    msgAlertTipoSelect.addEventListener('change', () => aplicarTipoMsgAlert(msgAlertTipoSelect.value));
  }
  if (msgAlertCorpoEl) msgAlertCorpoEl.addEventListener('input', agendarPreviewMsgAlert);
  if (btnMsgAlertCarregarSugerido) {
    btnMsgAlertCarregarSugerido.addEventListener('click', () => {
      const tipo = msgAlertTipoSelect ? msgAlertTipoSelect.value : 'parada';
      const sug = msgAlertCache.templatesSugeridos[tipo];
      if (msgAlertCorpoEl && sug) {
        msgAlertCorpoEl.value = sug;
        agendarPreviewMsgAlert();
      }
    });
  }
  if (btnMsgAlertSalvar) btnMsgAlertSalvar.addEventListener('click', salvarMensagensAlertas);
  if (btnMsgAlertRecarregar) {
    btnMsgAlertRecarregar.addEventListener('click', () => carregarMensagensAlertas({ silent: false }));
  }

  carregarMensagensAlertas({ silent: true });

  carregarMensagensConvocacao();

  (function initConfiguracoesTabs() {
    const root = document.querySelector('.configuracoes-container');
    if (!root) return;
    const tabButtons = root.querySelectorAll('.tabs.tabs-com-icones .tab-btn[data-tab]');
    const panels = root.querySelectorAll('.tab-content[id^="tab-"]');
    const TAB_IDS = ['contexto', 'marca-mapa', 'whatsapp', 'app-ia', 'convocacoes', 'alertas'];

    function showTab(tabId) {
      const id = TAB_IDS.includes(tabId) ? tabId : 'contexto';
      tabButtons.forEach((btn) => {
        const on = btn.getAttribute('data-tab') === id;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panels.forEach((panel) => {
        const suffix = panel.id.replace(/^tab-/, '');
        panel.classList.toggle('active', suffix === id);
      });
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('tab', id);
        const next = u.pathname + u.search + u.hash;
        if (window.location.pathname + window.location.search + window.location.hash !== next) {
          window.history.replaceState({}, '', next);
        }
      } catch (_) { /* ignore */ }
    }

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => showTab(btn.getAttribute('data-tab')));
    });

    let initial = 'contexto';
    try {
      const q = new URL(window.location.href).searchParams.get('tab');
      if (q && TAB_IDS.includes(q)) initial = q;
    } catch (_) { /* ignore */ }
    showTab(initial);
  })();
})();
