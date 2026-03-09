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
})();
