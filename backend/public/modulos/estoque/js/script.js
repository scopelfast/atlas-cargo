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
    { programa: 'estoque-cobranca', icon: 'bx-receipt', titulo: 'Cobrança operacional', desc: 'Armazenagem (pico) e expedição (NF) por período — % por dono.' }
  ];
  var wrap = document.getElementById('estoqueHubCards');
  if (!wrap) return;
  function go(programa) {
    if (window.parent && typeof window.parent.loadModuleContent === 'function') {
      window.parent.loadModuleContent(programa);
    }
  }
  cards.forEach(function (c) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'estoque-card';
    btn.innerHTML = '<i class="bx ' + c.icon + '"></i><h3>' + c.titulo + '</h3><span>' + c.desc + '</span>';
    btn.addEventListener('click', function () { go(c.programa); });
    wrap.appendChild(btn);
  });
})();
