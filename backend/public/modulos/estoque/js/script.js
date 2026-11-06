(function () {
  var cards = [
    { programa: 'estoque-recebimento', icon: 'bx-download', titulo: 'Recebimento', desc: 'NF-e (XML), conferência de entrada, de-para e etiqueta de pallet.' },
    { programa: 'estoque-separacao', icon: 'bx-list-ul', titulo: 'Separação', desc: 'Pedidos OPL, picking e conferência.' },
    // bxs-truck: o subset local (/css/boxicons.min.css) não inclui bx-truck (outline).
    { programa: 'estoque-cargas', icon: 'bxs-truck', titulo: 'Cargas programadas', desc: 'Romaneio de carga, pesos/volumes e vínculo com viagens.' },
    { programa: 'estoque-expedicao', icon: 'bx-export', titulo: 'Expedição', desc: 'Saída, espelho de nota e apoio à logística.' },
    { programa: 'estoque-cadastros-wms', icon: 'bx-cog', titulo: 'Cadastros WMS', desc: 'Dono do estoque, armazém, área, doca.' },
    { programa: 'estoque-inventario', icon: 'bx-clipboard', titulo: 'Inventário', desc: 'Snapshot, planilha CSV, ajuste de saldo e manual do operador.' },
    { programa: 'estoque-baixas', icon: 'bx-minus-circle', titulo: 'Baixas / Perdas', desc: 'Retiradas de estoque — vencido, avaria, segregado, perda… Documento + ledger.' },
    { programa: 'estoque-transferencias', icon: 'bx-transfer', titulo: 'Transferências entre donos', desc: 'Mover saldo de um dono para outro com 2 movimentos no ledger e comprovante.' },
    { programa: 'estoque-relatorios', icon: 'bx-bar-chart-alt-2', titulo: 'Relatórios WMS', desc: 'Saldo, movimentação e datas críticas (shelf-life).' },
    { programa: 'estoque-valor', icon: 'bx-money', titulo: 'Valor de estoque', desc: 'Valor R$ do estoque, picos diário/semanal/mensal e cobrança % sobre valor.' },
    { programa: 'estoque-cobranca', icon: 'bx-receipt', titulo: 'Cobrança operacional', desc: 'Armazenagem (pico) e expedição (NF) por período — % por dono.' },
    {
      externo: true,
      href: '/bi-volume-pr-sc.html',
      icon: 'bx-line-chart',
      titulo: 'BI Volume PR/SC',
      desc: 'Ao vivo — peso, valor NF, % seco/frio por unidade e mês (Mana + Nutriville).',
      cardClass: 'estoque-card-bi'
    },
    {
      externo: true,
      href: '/apresentacao-maranata/Apresentacao_Maranata_21out2026.html?v=30',
      icon: 'bx-slideshow',
      titulo: 'Apresentação Maranata',
      desc: 'Deck Mana / Nutriville · 21/10 — mesma origem do Atlas (funciona no ngrok).',
      cardClass: 'estoque-card-apresentacao',
      semToken: true
    },
    {
      externo: true,
      href: '/bi-cenario-base.html',
      icon: 'bx-map-alt',
      titulo: 'Cenário Base SC',
      desc: 'Colombo → Joinville/Araquari — km, ISS, ICMS frete e veredito (pauta reunião).',
      cardClass: 'estoque-card-cenario'
    },
    {
      externo: true,
      href: '/apresentacao-cenario-cd.html',
      icon: 'bx-presentation',
      titulo: 'Deck Cenário CD',
      desc: 'Pauta visual Colombo → SC — leitura para Maranata e Mana/Nutriville + links ao vivo.',
      cardClass: 'estoque-card-cenario',
      semToken: true
    }
  ];
  var wrap = document.getElementById('estoqueHubCards');
  if (!wrap) return;
  function go(programa) {
    if (window.parent && typeof window.parent.loadModuleContent === 'function') {
      window.parent.loadModuleContent(programa);
    }
  }
  function abrirExterno(href, comToken) {
    var url = href || '/bi-volume-pr-sc.html';
    if (comToken !== false) {
      try {
        var t = localStorage.getItem('token');
        if (t) url += (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t);
      } catch (e) { /* ignore */ }
    }
    window.open(url, '_blank', 'noopener');
  }
  cards.forEach(function (c) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'estoque-card' + (c.cardClass ? ' ' + c.cardClass : '');
    btn.innerHTML = '<i class="bx ' + c.icon + '"></i><h3>' + c.titulo + '</h3><span>' + c.desc + '</span>';
    btn.addEventListener('click', function () {
      if (c.externo) abrirExterno(c.href, !c.semToken);
      else go(c.programa);
    });
    wrap.appendChild(btn);
  });

  var biHead = document.querySelector('.estoque-hub-bi');
  if (biHead) {
    biHead.addEventListener('click', function (ev) {
      ev.preventDefault();
      abrirExterno(biHead.getAttribute('href') || '/bi-volume-pr-sc.html', true);
    });
  }
  var cenHead = document.querySelector('.estoque-hub-cenario');
  if (cenHead) {
    cenHead.addEventListener('click', function (ev) {
      ev.preventDefault();
      abrirExterno(cenHead.getAttribute('href') || '/bi-cenario-base.html', true);
    });
  }
  var deckHead = document.querySelector('.estoque-hub-cenario-deck');
  if (deckHead) {
    deckHead.addEventListener('click', function (ev) {
      ev.preventDefault();
      abrirExterno(deckHead.getAttribute('href') || '/apresentacao-cenario-cd.html', false);
    });
  }
})();
