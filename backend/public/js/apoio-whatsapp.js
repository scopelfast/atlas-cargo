/**
 * Modal Suporte / Pedido de apoio (painel torre).
 * Envia via canal Switch do tenant default; destino só a Atlas configura.
 */
(function () {
  'use strict';

  var MODAL_ID = 'apoioWhatsappModal';
  var enviando = false;

  function corrigir(url) {
    if (typeof window.corrigirUrl === 'function') return window.corrigirUrl(url);
    return url;
  }

  function authHeaders() {
    if (typeof window.getAuthHeaders === 'function') {
      var h = window.getAuthHeaders();
      return Object.assign({ 'Content-Type': 'application/json' }, h || {});
    }
    var token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    return {
      'Content-Type': 'application/json',
      Authorization: token ? 'Bearer ' + token : ''
    };
  }

  function paginaAtual() {
    try {
      var area = document.getElementById('contentArea');
      var mod = area && area.querySelector('[data-programa]');
      if (mod) return String(mod.getAttribute('data-programa') || '').slice(0, 200);
      var active = document.querySelector('.menu-item.active[data-programa]');
      if (active) return String(active.getAttribute('data-programa') || '').slice(0, 200);
      return (location.pathname || 'dashboard').slice(0, 200);
    } catch (e) {
      return 'dashboard';
    }
  }

  function garantirModal() {
    if (document.getElementById(MODAL_ID)) return;
    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    wrap.className = 'apoio-wa-overlay';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'apoioWaTitulo');
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="apoio-wa-dialog">' +
      '  <div class="apoio-wa-header">' +
      '    <h3 id="apoioWaTitulo"><i class="bx bx-help-circle" aria-hidden="true"></i> Ajuda Atlas</h3>' +
      '    <button type="button" class="apoio-wa-close" id="apoioWaFechar" aria-label="Fechar">&times;</button>' +
      '  </div>' +
      '  <div class="apoio-wa-tabs" role="tablist">' +
      '    <button type="button" class="apoio-wa-tab active" data-tab="suporte" role="tab" aria-selected="true">Suporte</button>' +
      '    <button type="button" class="apoio-wa-tab" data-tab="apoio" role="tab" aria-selected="false">Pedido de apoio</button>' +
      '  </div>' +
      '  <p class="apoio-wa-status" id="apoioWaStatusCanal"></p>' +
      '  <div class="apoio-wa-panel" id="apoioWaPanelSuporte">' +
      '    <label for="apoioWaAssunto">Assunto</label>' +
      '    <input type="text" id="apoioWaAssunto" maxlength="120" placeholder="Resumo do problema">' +
      '    <label for="apoioWaDescSuporte">Descrição</label>' +
      '    <textarea id="apoioWaDescSuporte" maxlength="800" rows="4" placeholder="Descreva o problema (mín. 10 caracteres)"></textarea>' +
      '  </div>' +
      '  <div class="apoio-wa-panel" id="apoioWaPanelApoio" style="display:none;">' +
      '    <label for="apoioWaTipoAjuda">Tipo de ajuda</label>' +
      '    <select id="apoioWaTipoAjuda">' +
      '      <option value="OPERACIONAL">Operacional</option>' +
      '      <option value="TECNICO">Técnico</option>' +
      '      <option value="FINANCEIRO">Financeiro</option>' +
      '      <option value="OUTRO">Outro</option>' +
      '    </select>' +
      '    <label for="apoioWaDescApoio">Descrição</label>' +
      '    <textarea id="apoioWaDescApoio" maxlength="800" rows="4" placeholder="Como podemos ajudar? (mín. 10 caracteres)"></textarea>' +
      '  </div>' +
      '  <p class="apoio-wa-feedback" id="apoioWaFeedback" role="status" aria-live="polite"></p>' +
      '  <div class="apoio-wa-actions">' +
      '    <button type="button" class="btn-filtro btn-filtro-limpar" id="apoioWaCancelar">Cancelar</button>' +
      '    <button type="button" class="btn-filtro btn-filtro-aplicar" id="apoioWaEnviar"><i class="bx bx-send"></i> Enviar</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) fechar();
    });
    document.getElementById('apoioWaFechar').addEventListener('click', fechar);
    document.getElementById('apoioWaCancelar').addEventListener('click', fechar);
    document.getElementById('apoioWaEnviar').addEventListener('click', enviar);
    wrap.querySelectorAll('.apoio-wa-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tab = btn.getAttribute('data-tab');
        wrap.querySelectorAll('.apoio-wa-tab').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('active', on);
          b.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        document.getElementById('apoioWaPanelSuporte').style.display = tab === 'suporte' ? 'block' : 'none';
        document.getElementById('apoioWaPanelApoio').style.display = tab === 'apoio' ? 'block' : 'none';
        setFeedback('');
      });
    });
  }

  function setFeedback(msg, tipo) {
    var el = document.getElementById('apoioWaFeedback');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'apoio-wa-feedback' + (tipo ? ' ' + tipo : '');
  }

  function tabAtiva() {
    var t = document.querySelector('#' + MODAL_ID + ' .apoio-wa-tab.active');
    return t ? t.getAttribute('data-tab') : 'suporte';
  }

  async function carregarStatus() {
    var el = document.getElementById('apoioWaStatusCanal');
    if (!el) return;
    el.textContent = 'Verificando canal...';
    try {
      var res = await fetch(corrigir('/api/apoio/status'), { headers: authHeaders() });
      var data = await res.json().catch(function () { return {}; });
      if (data.destinoConfigurado) {
        el.textContent = 'Canal pronto' + (data.destinoMascara ? ' (destino ' + data.destinoMascara + ')' : '') + '.';
        el.className = 'apoio-wa-status ok';
      } else {
        el.textContent = 'Canal ainda não pronto: a Atlas não configurou o número de destino.';
        el.className = 'apoio-wa-status warn';
      }
    } catch (e) {
      el.textContent = 'Não foi possível verificar o canal.';
      el.className = 'apoio-wa-status warn';
    }
  }

  function abrir(tab) {
    garantirModal();
    var modal = document.getElementById(MODAL_ID);
    modal.style.display = 'flex';
    setFeedback('');
    if (tab === 'apoio') {
      var btn = modal.querySelector('.apoio-wa-tab[data-tab="apoio"]');
      if (btn) btn.click();
    } else {
      var btnS = modal.querySelector('.apoio-wa-tab[data-tab="suporte"]');
      if (btnS) btnS.click();
    }
    carregarStatus();
  }

  function fechar() {
    var modal = document.getElementById(MODAL_ID);
    if (modal) modal.style.display = 'none';
    enviando = false;
  }

  async function enviar() {
    if (enviando) return;
    var tab = tabAtiva();
    var body;
    if (tab === 'suporte') {
      body = {
        assunto: (document.getElementById('apoioWaAssunto') || {}).value || '',
        descricao: (document.getElementById('apoioWaDescSuporte') || {}).value || '',
        pagina: paginaAtual()
      };
      if (String(body.assunto).trim().length < 3) {
        setFeedback('Informe o assunto.', 'error');
        return;
      }
    } else {
      body = {
        tipoAjuda: (document.getElementById('apoioWaTipoAjuda') || {}).value || 'OPERACIONAL',
        descricao: (document.getElementById('apoioWaDescApoio') || {}).value || '',
        pagina: paginaAtual()
      };
    }
    if (String(body.descricao).trim().length < 10) {
      setFeedback('Descreva com pelo menos 10 caracteres.', 'error');
      return;
    }

    enviando = true;
    var btn = document.getElementById('apoioWaEnviar');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="bx bx-loader bx-spin"></i> Enviando...';
    }
    setFeedback('Enviando...', 'info');

    try {
      var url = corrigir(tab === 'suporte' ? '/api/apoio/suporte' : '/api/apoio/apoio');
      var res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body)
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.success) {
        setFeedback(data.message || 'Enviado.', 'success');
        if (!data.deduplicado) {
          if (tab === 'suporte') {
            var a = document.getElementById('apoioWaAssunto');
            var d = document.getElementById('apoioWaDescSuporte');
            if (a) a.value = '';
            if (d) d.value = '';
          } else {
            var da = document.getElementById('apoioWaDescApoio');
            if (da) da.value = '';
          }
        }
      } else {
        setFeedback(data.error || 'Falha no envio.', 'error');
      }
    } catch (e) {
      setFeedback('Erro de rede ao enviar.', 'error');
    } finally {
      enviando = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="bx bx-send"></i> Enviar';
      }
    }
  }

  window.abrirApoioWhatsapp = abrir;
  window.fecharApoioWhatsapp = fechar;

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('headerBtnAjuda');
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.addEventListener('click', function () {
        abrir('suporte');
      });
    }
    var shortcuts = document.getElementById('headerShortcuts');
    if (shortcuts && btn) shortcuts.style.display = 'flex';
  });
})();
