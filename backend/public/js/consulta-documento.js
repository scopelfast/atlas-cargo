(function (w) {
  function digitos(v) {
    return String(v || '').replace(/\D/g, '');
  }

  function headers() {
    var h = { Accept: 'application/json' };
    try {
      var token = localStorage.getItem('token');
      if (token) h.Authorization = 'Bearer ' + token;
    } catch (e) { /* sem sessão nesta página */ }
    return h;
  }

  function preencher(id, valor) {
    if (valor == null || String(valor).trim() === '') return;
    var el = document.getElementById(id);
    if (!el || String(el.value || '').trim()) return;
    el.value = valor;
  }

  async function consultarDocumento(doc) {
    var r = await fetch('/api/consulta/documento/' + encodeURIComponent(digitos(doc)), { headers: headers() });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'Documento não consultado.');
    return data;
  }

  async function consultarCep(cep) {
    var r = await fetch('/api/cep/' + encodeURIComponent(digitos(cep)), { headers: headers() });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || 'CEP não encontrado.');
    return data;
  }

  function ligarDocumento(input, aoResultado) {
    if (!input || input.dataset.consultaDoc) return;
    input.dataset.consultaDoc = '1';
    var timer = null;
    input.addEventListener('input', function () {
      var d = digitos(input.value);
      if (d.length !== 11 && d.length !== 14) return;
      if (input.dataset.ultimoDoc === d) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        input.dataset.ultimoDoc = d;
        consultarDocumento(d).then(aoResultado).catch(function (e) {
          if (typeof w.showMessage === 'function') w.showMessage(e.message, 'error');
        });
      }, 350);
    });
  }

  function ligarCep(input, aoResultado) {
    if (!input || input.dataset.consultaCep) return;
    input.dataset.consultaCep = '1';
    var timer = null;
    input.addEventListener('input', function () {
      var d = digitos(input.value);
      if (d.length !== 8) return;
      if (input.dataset.ultimoCep === d) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        input.dataset.ultimoCep = d;
        consultarCep(d).then(aoResultado).catch(function (e) {
          if (typeof w.showMessage === 'function') w.showMessage(e.message, 'error');
        });
      }, 350);
    });
  }

  function cortar(v, max) {
    return String(v || '').trim().slice(0, max);
  }

  w.AtlasConsulta = {
    digitos: digitos,
    preencher: preencher,
    cortar: cortar,
    consultarDocumento: consultarDocumento,
    consultarCep: consultarCep,
    ligarDocumento: ligarDocumento,
    ligarCep: ligarCep,
  };
})(window);
