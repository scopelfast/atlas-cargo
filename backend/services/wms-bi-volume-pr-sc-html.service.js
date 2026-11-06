'use strict';

/**
 * Shell HTML do BI — busca dados ao vivo em /api/wms/bi/volume-pr-sc
 */
function buildBiVolumePrScHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maranata · BI Operacional PR/SC (ao vivo)</title>
<meta name="bi-def" content="entrega=unidade-x-dia; nf=nota; v=2026-10-20-select-ux" />
<meta http-equiv="Cache-Control" content="no-store, no-cache, must-revalidate" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
<style>
:root{
  --verde:#0A3D2E; --verde-mid:#0f4f3b; --verde-escuro:#04140f;
  --vermelho:#E30613; --muted:#b8cec4; --line:rgba(255,255,255,.12);
  --bg:#04140f; --panel:#061a14; --card:rgba(0,0,0,.32);
  --text:#e8f5ef; --green:#0A3D2E; --green2:#1a7a56;
  --red:#E30613; --amber:#f59e0b; --cyan:#5eead4; --seco:#34d399; --frio:#7dd3fc;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:"DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
#progress{position:fixed;top:0;left:0;height:3px;width:100%;z-index:60;background:linear-gradient(90deg,var(--verde),var(--vermelho));pointer-events:none}
#boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:var(--bg);z-index:50}
#boot .spin{width:42px;height:42px;border:3px solid rgba(255,255,255,.12);border-top-color:var(--vermelho);border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
#boot p{color:var(--muted);font-size:13px;margin:0}
#boot.err p{color:#fca5a5}
#app{display:none;grid-template-columns:320px 1fr;height:100vh}
aside{
  background:linear-gradient(180deg,#0a2a20 0%,#061a14 55%,#04140f 100%);
  border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;
}
.brand-bar{
  padding:16px 16px 14px;border-bottom:1px solid var(--line);
  background:radial-gradient(700px 140px at 0% 0%,rgba(227,6,19,.22),transparent 58%);
}
/* Duas marcas: Atlas no escuro; Maranata no chip claro (logo nasce p/ fundo branco) */
.brand-pair{
  display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:stretch;
  margin-bottom:10px;
}
.brand-pair .slot{
  display:flex;align-items:center;justify-content:center;
  min-height:52px;padding:6px 8px;border-radius:10px;
}
.brand-pair .slot.atlas{
  background:rgba(0,0,0,.22);border:1px solid var(--line);
}
.brand-pair .slot.maranata{
  background:#fff;border:1px solid rgba(255,255,255,.2);
  box-shadow:0 2px 10px rgba(0,0,0,.25);
}
.brand-pair img{
  height:38px;width:auto;max-width:100%;object-fit:contain;display:block;
}
.brand-pair .slot.atlas img{filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.eyebrow i{width:22px;height:2px;background:var(--vermelho);border-radius:2px}
.brand-bar .tagline{margin:10px 0 0;font-size:11px;color:var(--muted);line-height:1.45}
.brand-bar .tagline b{color:#fff;font-weight:650}
.live{display:inline-flex;align-items:center;gap:6px;font-size:10px;color:#86efac;text-transform:uppercase;letter-spacing:.08em;margin-top:10px}
.live i{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.7);animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.filters{padding:12px 14px;border-bottom:1px solid var(--line);display:grid;gap:10px}
label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:4px}
label .lab-actions{display:flex;gap:6px;text-transform:none;letter-spacing:0}
label .lab-actions button{border:0;background:transparent;color:var(--vermelho);font-size:11px;font-weight:650;cursor:pointer;padding:0;font-family:inherit}
label .lab-actions button:hover{text-decoration:underline}
input[type=search]{
  width:100%;background:rgba(0,0,0,.35);border:1px solid var(--line);color:var(--text);
  border-radius:10px;padding:8px 10px;font-size:13px;font-family:inherit;
}
input[type=search]:focus{outline:none;border-color:rgba(227,6,19,.45)}
/* Combos: evita lista cinza/azul do Windows */
select{
  width:100%;appearance:none;-webkit-appearance:none;-moz-appearance:none;
  color-scheme:dark;
  background-color:#061a14;color:var(--text);
  border:1px solid var(--line);border-radius:10px;
  padding:9px 36px 9px 12px;font-size:13px;font-weight:600;font-family:inherit;
  cursor:pointer;
  background-image:
    linear-gradient(45deg,transparent 50%,var(--muted) 50%),
    linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:
    calc(100% - 18px) calc(50% - 2px),
    calc(100% - 12px) calc(50% - 2px);
  background-size:6px 6px,6px 6px;
  background-repeat:no-repeat;
}
select:hover{border-color:rgba(26,122,86,.65)}
select:focus{outline:none;border-color:rgba(227,6,19,.55);box-shadow:0 0 0 2px rgba(227,6,19,.15)}
select option{
  background-color:#0a2a20;color:#e8f5ef;font-weight:500;
}
select option:checked,select option:hover{
  background-color:#0A3D2E;color:#fff;
}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{
  appearance:none;border:1px solid var(--line);background:rgba(0,0,0,.28);color:var(--muted);
  border-radius:999px;padding:5px 10px;font-size:11px;font-weight:650;cursor:pointer;
  font-family:inherit;line-height:1.2;transition:border-color .15s,background .15s,color .15s;
}
.chip:hover{border-color:rgba(227,6,19,.4);color:#fff}
.chip.on{background:rgba(10,61,46,.7);border-color:rgba(26,122,86,.85);color:#fff}
.sel-bar{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:0 2px}
.sel-bar .tag{font-size:11px;color:var(--muted)}
.sel-bar .tag b{color:#fff}
.list{flex:1;overflow:auto;padding:8px;min-height:0}
.u{border:1px solid transparent;border-radius:10px;padding:9px 10px;cursor:pointer;margin-bottom:4px;display:grid;grid-template-columns:22px 1fr;gap:8px;align-items:start;transition:background .12s,border-color .12s}
.u:hover{background:rgba(0,0,0,.28);border-color:var(--line)}
.u.on{background:rgba(10,61,46,.35);border-color:rgba(26,122,86,.55);box-shadow:inset 3px 0 0 var(--vermelho)}
.u .ck{width:16px;height:16px;margin-top:2px;accent-color:var(--green2);cursor:pointer}
.u .n{font-size:13px;font-weight:650;color:#fff}
.u .m{font-size:11px;color:var(--muted);margin-top:2px}
.u .q{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px;font-size:11px;color:#dceee5}
.mix{height:3px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:6px;display:flex}
.mix .s{background:var(--seco)} .mix .f{background:var(--frio);display:block;height:100%}
.mix i{display:block;height:100%}
main{
  overflow:auto;padding:18px 22px 28px;min-height:0;
  background:
    radial-gradient(900px 420px at 8% 0%,rgba(227,6,19,.12),transparent 55%),
    radial-gradient(700px 400px at 92% 100%,rgba(10,61,46,.4),transparent 50%),
    linear-gradient(165deg,#061a14 0%,#0a2a20 42%,#04140f 100%);
}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.top .eyebrow{margin-bottom:6px}
.top h2{
  margin:0;font-size:28px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1.05;
}
.top h2 em{font-family:"Instrument Serif",Georgia,serif;font-style:italic;font-weight:400;color:#e8f5ef}
.top h2 .r{color:var(--vermelho)}
.top .sub{margin:8px 0 0;font-size:13px;color:var(--muted);max-width:520px;line-height:1.4}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{
  background:rgba(0,0,0,.28);border:1px solid var(--line);color:var(--text);
  border-radius:999px;padding:8px 14px;font-size:12px;font-weight:650;cursor:pointer;font-family:inherit;
}
.btn:hover{border-color:rgba(255,255,255,.22)}
.btn.prim{background:var(--verde);border-color:var(--verde);color:#fff}
.btn.prim:hover{background:var(--verde-mid)}
.pills{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:rgba(0,0,0,.2)}
.pill.ok{color:#86efac;border-color:rgba(34,197,94,.35);background:rgba(20,83,45,.25)}
.pill.hot{color:#fca5a5;border-color:rgba(227,6,19,.35);background:rgba(127,29,29,.2)}
.pill.info{color:#dceee5;border-color:rgba(184,206,196,.25);background:rgba(10,61,46,.35)}
.kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
.kpi{
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 13px;
  position:relative;overflow:hidden;backdrop-filter:blur(6px);
}
.kpi:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--verde-mid)}
.kpi.r:before{background:var(--vermelho)}.kpi.c:before{background:var(--cyan)}.kpi.a:before{background:var(--amber)}
.kpi.s:before{background:var(--seco)}.kpi.f:before{background:var(--frio)}
.kpi .k{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:650}
.kpi .v{font-size:18px;font-weight:750;margin-top:6px;color:#fff;font-variant-numeric:tabular-nums}
.kpi .d{font-size:11px;color:var(--muted);margin-top:4px}
.grid2{display:grid;grid-template-columns:1.2fr .8fr;gap:12px;margin-bottom:12px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px}
.card{
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;
  backdrop-filter:blur(6px);
}
.card h3{margin:0 0 2px;font-size:14px;font-weight:750;color:#fff}
.card h3 .r{color:var(--vermelho)}
.card .hint{margin:0 0 12px;font-size:11px;color:var(--muted);line-height:1.4}
.bars{display:flex;align-items:flex-end;gap:7px;height:170px}
.col{flex:1;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end}
.val{font-size:9px;color:#dceee5;margin-bottom:4px;white-space:nowrap}
.stack{width:100%;max-width:40px;display:flex;flex-direction:column-reverse;border-radius:6px 6px 2px 2px;overflow:hidden;min-height:2px}
.stack .fs{background:var(--seco)} .stack .ff{background:var(--frio)}
.lab{font-size:10px;color:var(--muted);margin-top:6px}
.donut-wrap{display:flex;align-items:center;gap:16px}
.donut{width:130px;height:130px;border-radius:50%;position:relative;flex:0 0 auto}
.donut-hole{position:absolute;inset:28px;background:#061a14;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center}
.donut-hole b{font-size:18px;color:#fff}.donut-hole span{font-size:10px;color:var(--muted)}
.legend{display:grid;gap:8px;font-size:12px}
.legend div{display:flex;justify-content:space-between;gap:10px;align-items:center}
.sw{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:6px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:8px 8px;border-bottom:1px solid var(--line)}
th{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:650;text-align:right}
th:first-child,td:first-child{text-align:left}
td{text-align:right;color:#e8f5ef;font-variant-numeric:tabular-nums}
.rank{width:22px;height:22px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:rgba(255,255,255,.06);margin-right:8px;color:var(--muted)}
.rank.t1{background:rgba(245,158,11,.2);color:#fbbf24}
.rank.t2{background:rgba(184,206,196,.12);color:#e8f5ef}
.rank.t3{background:rgba(180,83,9,.2);color:#fdba74}
.foot-note{margin-top:10px;font-size:11px;color:var(--muted)}
/* faixa final (não sticky — não tapa gráficos) */
.deck-end{
  margin-top:18px;padding:14px 16px;border-radius:14px;
  border:1px solid var(--line);background:rgba(10,61,46,.45);
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
}
.deck-end .pair{display:flex;align-items:center;gap:12px;min-width:0}
.deck-end .pair .slot{
  display:flex;align-items:center;justify-content:center;
  height:44px;padding:4px 10px;border-radius:8px;
}
.deck-end .pair .slot.atlas{background:rgba(0,0,0,.2);border:1px solid var(--line)}
.deck-end .pair .slot.maranata{background:#fff;border:1px solid rgba(255,255,255,.15)}
.deck-end .pair img{height:32px;width:auto;max-width:140px;object-fit:contain}
.deck-end .pair .sep{width:1px;height:26px;background:var(--line)}
.deck-end .right{font-size:11px;font-weight:650;letter-spacing:.08em;color:#c5ddd2;text-align:right}
#agendaCard{display:none;margin-bottom:12px}
#agendaCard.on{display:block}
#agendaCard > h3{display:flex;align-items:center;gap:8px}
#agendaCard > h3::before{content:"";width:18px;height:2px;background:var(--vermelho);border-radius:2px}
.agenda-list{display:grid;gap:6px;max-height:520px;overflow:auto;padding-right:2px}
.agenda-day{
  border:1px solid var(--line);border-radius:12px;background:rgba(0,0,0,.28);
  padding:10px 12px;transition:border-color .15s,background .15s;
}
.agenda-day:hover{border-color:rgba(26,122,86,.55)}
.agenda-day.open{border-color:rgba(227,6,19,.45);background:rgba(10,61,46,.4)}
.agenda-day .hd{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer}
.agenda-day .hd .d{font-size:14px;font-weight:750;color:#fff;display:flex;align-items:center;gap:8px}
.agenda-day .hd .d .chev{display:inline-block;width:14px;color:var(--muted);font-size:11px;transition:transform .12s}
.agenda-day.open .hd .d .chev{transform:rotate(90deg);color:var(--vermelho)}
.agenda-day .hd .d span{color:var(--muted);font-weight:500;font-size:12px}
.agenda-day .mets{display:flex;flex-wrap:wrap;gap:8px 12px;font-size:11px;color:#dceee5;margin-top:6px}
.agenda-day .mets b{color:#fff}
.agenda-day .mix3{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;margin-top:6px}
.agenda-day .mix3 span{padding:2px 8px;border-radius:999px;border:1px solid var(--line);background:rgba(0,0,0,.2)}
.agenda-day .mix3 .seco{color:var(--seco);border-color:rgba(52,211,153,.35)}
.agenda-day .mix3 .resf{color:#38bdf8;border-color:rgba(56,189,248,.35)}
.agenda-day .mix3 .cong{color:#a78bfa;border-color:rgba(167,139,250,.4)}
.agenda-day .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.agenda-day .tags i{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.04em;padding:2px 8px;border-radius:999px;border:1px solid var(--line);color:#e8f5ef}
.agenda-day .body{display:none;margin-top:10px;border-top:1px solid var(--line);padding-top:6px}
.agenda-day.open .body{display:block}
.tv{list-style:none;margin:0;padding:0}
.tv ul{list-style:none;margin:0;padding:0 0 0 14px;border-left:1px solid rgba(184,206,196,.18);margin-left:6px}
.tv-node{margin:2px 0}
.tv-row{
  display:flex;justify-content:space-between;align-items:flex-start;gap:8px;
  padding:5px 8px;border-radius:8px;cursor:pointer;font-size:12px;
}
.tv-row:hover{background:rgba(26,122,86,.18)}
.tv-row.open{background:rgba(10,61,46,.45)}
.tv-row .lab{display:flex;align-items:flex-start;gap:6px;min-width:0}
.tv-row .lab .chev{width:12px;flex:0 0 auto;color:var(--muted);font-size:10px;line-height:1.4;transition:transform .12s}
.tv-row.open .lab .chev{transform:rotate(90deg);color:var(--vermelho)}
.tv-row .lab .chev.leaf{visibility:hidden}
.tv-row .lab .ttl{font-weight:650;color:#fff}
.tv-row .lab .ttl small{display:block;font-weight:500;font-size:10px;color:var(--muted);margin-top:1px}
.tv-row .lab .badge{
  font-size:9px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
  color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 6px;margin-top:2px;flex:0 0 auto;
}
.tv-row .lab .badge.carga{color:#fbbf24;border-color:rgba(251,191,36,.35)}
.tv-row .lab .badge.rota{color:#7dd3fc;border-color:rgba(125,211,252,.35)}
.tv-row .lab .badge.cidade{color:#c4b5fd;border-color:rgba(196,181,253,.35)}
.tv-row .lab .badge.unid{color:var(--seco);border-color:rgba(52,211,153,.35)}
.tv-row .met{text-align:right;white-space:nowrap;font-size:11px;color:#dceee5;flex:0 0 auto}
.tv-row .met b{color:#fff;display:block}
.tv-kids{display:none}
.tv-node.open > .tv-kids{display:block}
@media(max-width:1200px){
  .kpis{grid-template-columns:repeat(3,1fr)}
  .grid2,.grid3{grid-template-columns:1fr}
  #app{grid-template-columns:280px 1fr}
}
</style>
</head>
<body>
<div id="progress"></div>
<div id="boot"><div class="spin"></div><p id="bootMsg">Carregando dados ao vivo da base…</p></div>
<div id="app">
<aside>
  <div class="brand-bar">
    <div class="eyebrow"><i></i> BI operacional</div>
    <div class="brand-pair">
      <div class="slot atlas"><img src="/img/logoAtlasTransparente.png" alt="Atlas Cargo" /></div>
      <div class="slot maranata"><img src="/img/logo_maranata.png" alt="Maranata Logística" /></div>
    </div>
    <p class="tagline"><b>Volume · Valor · Seco/Frio</b><br/>PR &amp; SC · Mana + Nutriville</p>
    <div class="live"><i></i> Ao vivo · visita = dia · frota = carga</div>
  </div>
  <div class="filters">
    <div>
      <label>Meses
        <span class="lab-actions">
          <button type="button" id="mesAll" title="Todos os meses">Todos</button>
          <button type="button" id="mesNone" title="Limpar meses">Limpar</button>
        </span>
      </label>
      <div class="chips" id="mesesChips"></div>
    </div>
    <div><label>Buscar unidade</label><input type="search" id="busca" placeholder="Detroit, Krona, Curitiba..." /></div>
    <div class="row2">
      <div><label>Estado</label>
        <select id="uf"><option value="ALL">PR + SC</option><option value="PR">Paraná</option><option value="SC">Santa Catarina</option></select>
      </div>
      <div><label>Dono</label>
        <select id="dono"><option value="ALL">Ambos</option><option value="Mana">Mana</option><option value="Nutriville">Nutriville</option></select>
      </div>
    </div>
    <div><label>Ordenar ranking</label>
      <select id="ord">
        <option value="peso">Peso total</option><option value="valor">Valor NF</option>
        <option value="frio">Peso frio</option><option value="seco">Peso seco</option>
        <option value="entregas">Entregas (visitas)</option>
        <option value="viagens">Viagens (cargas)</option>
        <option value="nfs">Qtd de NFs</option>
      </select>
    </div>
    <div class="sel-bar">
      <span class="tag" id="selInfo">Nenhuma unidade · visão geral</span>
      <button class="btn prim" id="btnAllVisible" type="button" title="Marca todas as unidades da lista (respeita busca, UF e dono)">Selecionar todos</button>
      <button class="btn" id="btnClear" type="button" title="Tira a seleção e volta à visão geral">Desmarcar todos</button>
    </div>
  </div>
  <div class="list" id="lista"></div>
</aside>
<main>
  <div class="top">
    <div>
      <div class="eyebrow"><i></i> Recorte ao vivo</div>
      <h2 id="titulo">Visão <em>executiva</em></h2>
      <p class="sub" id="subtitulo">Marque unidades e meses — KPIs e gráficos acompanham o recorte</p>
      <div class="pills" id="pills" style="margin-top:10px"></div>
    </div>
    <div class="actions">
      <button class="btn prim" id="btnRefresh" type="button">Atualizar agora</button>
      <span class="pill info" id="stamp">—</span>
    </div>
  </div>
  <div class="kpis" id="kpis"></div>
  <div class="card" id="agendaCard">
    <h3>Agenda do mês</h3>
    <p class="hint" id="agendaHint">Dia da visita = saída/início da expedição da carga (não emissão da NF). Árvore: dia → carga → rota → cidade → unidade.</p>
    <div class="agenda-list" id="agendaList"></div>
  </div>
  <div class="grid2">
    <div class="card"><h3 id="c1t">Evolução mensal · peso seco × frio</h3><p class="hint">Barras empilhadas · kg por mês</p><div class="bars" id="chartStack"></div></div>
    <div class="card"><h3 id="c2t">Mix de conservação</h3><p class="hint">Participação no peso do recorte</p>
      <div class="donut-wrap"><div class="donut" id="donut"></div><div class="legend" id="donutLeg"></div></div>
    </div>
  </div>
  <div class="grid2" style="margin-bottom:12px">
    <div class="card"><h3>Entregas por mês</h3><p class="hint">1 entrega = 1 unidade em 1 dia (visita), mesmo com várias NFs</p><div class="bars" id="chartNf"></div></div>
    <div class="card"><h3>Viagens por mês</h3><p class="hint" id="hintViagens">Na unidade: dias com carga. Na visão geral: cargas/rotas distintas (sem “Baixa estoque”)</p><div class="bars" id="chartViagens"></div></div>
  </div>
  <div class="grid3">
    <div class="card"><h3>Valor NF por mês</h3><p class="hint">R$ mil</p><div class="bars" id="chartValor"></div></div>
    <div class="card"><h3 id="rankTitle">Top 8 unidades</h3><p class="hint" id="rankHint">No filtro atual</p><div id="topList"></div></div>
    <div class="card"><h3>Resumo de entregas</h3><p class="hint">No recorte atual</p><div id="resumoEntregas" style="font-size:13px;line-height:1.7;color:#cbd5e1"></div></div>
  </div>
  <div class="card">
    <h3 id="tblTitle">Detalhamento mês a mês</h3>
    <p class="hint" id="tblHint">Entregas (visitas), viagens (cargas), NFs, unidades, peso e mix</p>
    <div style="overflow:auto"><table>
      <thead><tr>
        <th>Mês</th>
        <th>Entregas</th>
        <th>Viagens</th>
        <th>NFs</th>
        <th>Unidades</th>
        <th>Peso</th>
        <th>Seco</th>
        <th>Frio</th>
        <th>% Seco</th>
        <th>% Frio</th>
        <th>Valor NF</th>
      </tr></thead>
      <tbody id="tbody"></tbody>
    </table></div>
    <div class="foot-note" id="foot"></div>
  </div>
  <div class="deck-end">
    <div class="pair">
      <div class="slot atlas"><img src="/img/logoAtlasTransparente.png" alt="Atlas Cargo" /></div>
      <div class="sep"></div>
      <div class="slot maranata"><img src="/img/logo_maranata.png" alt="Maranata Logística" /></div>
    </div>
    <div class="right">ATLAS · UM SISTEMA · DOIS DONOS · ZERO MISTURA</div>
  </div>
</main>
</div>
<script>
let DATA = null;
let MESES = [];
/** Set de keys de unidade; vazio = visão geral (todas do filtro) */
let selectedKeys = new Set();
/** Set de ym 'YYYY-MM'; vazio = todos os meses */
let selectedMeses = new Set();
/** Dia expandido na agenda (YYYY-MM-DD) */
let agendaOpenDia = null;
/** Paths abertos na árvore: dia|c:ID|r:ROTA|cid:CIDADE */
let agendaOpenPaths = new Set();
let refreshTimer = null;

const fmtKg = n => (n||0).toLocaleString('pt-BR',{maximumFractionDigits:0}) + ' kg';
const fmtT = n => ((n||0)/1000).toLocaleString('pt-BR',{maximumFractionDigits:1}) + ' t';
const fmtRs = n => 'R$ ' + (n||0).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0});
const fmtRs2 = n => 'R$ ' + (n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtN = n => (n||0).toLocaleString('pt-BR');
const fmtPct = n => (n||0).toLocaleString('pt-BR',{maximumFractionDigits:1}) + '%';
const mesCurto = ym => { const [y,m]=String(ym).split('-'); return ['','Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'][+m]+'/'+String(y).slice(2); };
const mesFull = ym => { const [y,m]=String(ym).split('-'); return ['','Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'][+m]+'/'+y; };
const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function token() {
  const q = new URLSearchParams(location.search).get('token');
  if (q) return q;
  try { return localStorage.getItem('token') || ''; } catch (_) { return ''; }
}

async function carregar(force) {
  const boot = document.getElementById('boot');
  const msg = document.getElementById('bootMsg');
  boot.style.display = 'flex';
  boot.classList.remove('err');
  msg.textContent = force ? 'Atualizando da base…' : 'Carregando dados ao vivo da base…';
  const t = token();
  if (!t) {
    boot.classList.add('err');
    msg.innerHTML = 'Faça login no Atlas Cargo e abra este BI de novo.<br/>Ou use a URL com ?token=SEU_JWT';
    return;
  }
  try {
    const url = '/api/wms/bi/volume-pr-sc?v=3' + (force ? '&refresh=1' : '');
    const r = await fetch(url, {
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + t, Accept: 'application/json' }
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || ('HTTP ' + r.status));
    }
    DATA = await r.json();
    if (DATA.totais && DATA.totais.qtdEntregas == null) {
      throw new Error('API antiga sem qtdEntregas — reinicie o servidor Node e recarregue a página (Ctrl+F5).');
    }
    MESES = DATA.meses || [];
    selectedMeses = new Set([...selectedMeses].filter(m => MESES.includes(m)));
    boot.style.display = 'none';
    document.getElementById('app').style.display = 'grid';
    montarMesChips();
    render();
    const stamp = document.getElementById('stamp');
    const when = (DATA.geradoEm || '').replace('T', ' ').slice(0, 19);
    stamp.textContent = (DATA.cache ? 'cache · ' : 'fresco · ') + when +
      (DATA.elapsedMs != null ? ' · ' + DATA.elapsedMs + 'ms' : '') +
      ' · entrega=visita';
  } catch (e) {
    boot.classList.add('err');
    msg.textContent = 'Erro ao carregar: ' + (e.message || e);
  }
}

function montarMesChips() {
  const el = document.getElementById('mesesChips');
  el.innerHTML = MESES.map(ym => {
    const on = selectedMeses.size === 0 || selectedMeses.has(ym);
    return '<button type="button" class="chip'+(on?' on':'')+'" data-mes="'+ym+'">'+mesCurto(ym)+'</button>';
  }).join('');
  el.querySelectorAll('.chip').forEach(btn => {
    btn.onclick = () => {
      const ym = btn.getAttribute('data-mes');
      // 1º clique com “todos” implícitos: vira só este mês
      if (selectedMeses.size === 0) {
        selectedMeses = new Set([ym]);
      } else if (selectedMeses.has(ym)) {
        selectedMeses.delete(ym);
      } else {
        selectedMeses.add(ym);
      }
      // se marcou todos de novo, volta a “todos” (set vazio)
      if (selectedMeses.size === MESES.length) selectedMeses = new Set();
      montarMesChips();
      render();
    };
  });
}

function keyOf(s){ return s.cdEnd!=null ? 'E'+s.cdEnd : 'X|'+s.uf+'|'+(s.cidade||'')+'|'+(s.ponto||s.nome||''); }
function mesesAtivos(){
  if (!selectedMeses.size) return MESES.slice();
  return MESES.filter(m => selectedMeses.has(m));
}
function labelMeses(){
  const a = mesesAtivos();
  if (!selectedMeses.size || a.length === MESES.length) return 'Todos os meses';
  if (a.length === 1) return mesFull(a[0]);
  return a.length + ' meses';
}
function F(){
  return {
    meses: mesesAtivos(),
    mesUnico: selectedMeses.size === 1 ? [...selectedMeses][0] : null,
    uf: document.getElementById('uf').value,
    dono: document.getElementById('dono').value,
    ord: document.getElementById('ord').value,
    busca: (document.getElementById('busca').value||'').trim().toLowerCase()
  };
}
function seriesBase(f,{ignoreMes=false,onlyKeys=null}={}){
  const mesSet = !ignoreMes && f.meses && f.meses.length !== MESES.length
    ? new Set(f.meses)
    : null;
  return DATA.series.filter(s=>{
    if (onlyKeys && onlyKeys.size && !onlyKeys.has(keyOf(s))) return false;
    if (mesSet && !mesSet.has(s.mes)) return false;
    if (f.uf!=='ALL' && s.uf!==f.uf) return false;
    if (f.dono!=='ALL' && s.dono!==f.dono) return false;
    return true;
  });
}
function qtdEnt(s){ return s.qtdEntregas != null ? s.qtdEntregas : (s.qtdNf || 0); }
function mergeCargas(into, from){
  if(!into._cargas) into._cargas = new Set();
  const arr = from.cargas || [];
  for(const c of arr) into._cargas.add(c);
  if(from.qtdViagens != null && !arr.length && from.qtdViagens > 0){
    // fallback antigo sem lista de IDs
    into._cargasFallback = (into._cargasFallback||0) + from.qtdViagens;
  }
}
function finCargas(o){
  o.qtdViagens = o._cargas && o._cargas.size ? o._cargas.size : (o._cargasFallback || 0);
  delete o._cargas; delete o._cargasFallback;
}
function aggUnits(series){
  const m=new Map();
  for(const s of series){
    const k=keyOf(s);
    if(!m.has(k)) m.set(k,{key:k,cdEnd:s.cdEnd,nome:s.nome||s.ponto||'Unidade',ponto:s.ponto,cidade:s.cidade,uf:s.uf,dono:s.dono,rota:s.rota,valor:0,pesoKg:0,pesoSecoKg:0,pesoFrioKg:0,qtdNf:0,qtdEntregas:0,qtdViagens:0});
    const u=m.get(k);
    u.valor+=s.valor; u.pesoKg+=s.pesoKg; u.pesoSecoKg+=s.pesoSecoKg||0; u.pesoFrioKg+=s.pesoFrioKg||0;
    u.qtdNf+=s.qtdNf||0; u.qtdEntregas+=qtdEnt(s);
    // por unidade: viagem = dias com carga (soma meses); não unir IDs de carga
    u.qtdViagens += (s.qtdViagens != null ? s.qtdViagens : 0);
    if(s.dono) u.dono=s.dono; if(s.nome) u.nome=s.nome; if(s.rota!=null) u.rota=s.rota;
  }
  for(const u of m.values()){
    const t=u.pesoKg||0; u.pctSeco=t>0?Math.round(1000*u.pesoSecoKg/t)/10:0; u.pctFrio=t>0?Math.round(1000*u.pesoFrioKg/t)/10:0;
  }
  return [...m.values()];
}
/** porCarga=true → frota (cargas distintas); false → unidade (dias com carga) */
function aggMeses(series, porCarga, mesesList){
  const axis = mesesList && mesesList.length ? mesesList : MESES;
  const m=new Map(axis.map(mes=>[mes,{mes,valor:0,pesoKg:0,pesoSecoKg:0,pesoFrioKg:0,qtdNf:0,qtdEntregas:0,qtdViagens:0,unidades:new Set()}]));
  for(const s of series){
    if(!m.has(s.mes)) continue;
    const x=m.get(s.mes);
    x.valor+=s.valor; x.pesoKg+=s.pesoKg; x.pesoSecoKg+=s.pesoSecoKg||0; x.pesoFrioKg+=s.pesoFrioKg||0;
    x.qtdNf+=s.qtdNf||0; x.qtdEntregas+=qtdEnt(s);
    if(porCarga) mergeCargas(x, s);
    else x.qtdViagens += (s.qtdViagens != null ? s.qtdViagens : 0);
    x.unidades.add(keyOf(s));
  }
  return axis.map(mes=>{
    const x=m.get(mes);
    const t=x.pesoKg||0;
    x.pctSeco=t>0?Math.round(1000*x.pesoSecoKg/t)/10:0;
    x.pctFrio=t>0?Math.round(1000*x.pesoFrioKg/t)/10:0;
    x.qtdUnidades=x.unidades ? x.unidades.size : 0;
    delete x.unidades;
    if(porCarga) finCargas(x);
    return x;
  });
}
function ordVal(u,ord){
  if(ord==='valor') return u.valor;
  if(ord==='frio') return u.pesoFrioKg;
  if(ord==='seco') return u.pesoSecoKg;
  if(ord==='entregas') return u.qtdEntregas;
  if(ord==='viagens') return u.qtdViagens || 0;
  if(ord==='nfs') return u.qtdNf;
  return u.pesoKg;
}
function sum(arr,field){ return arr.reduce((a,x)=>a+(x[field]||0),0); }

function syncSelInfo(n){
  const el = document.getElementById('selInfo');
  if (!el) return;
  if (!n) el.innerHTML = 'Nenhuma unidade · <b>visão geral</b>';
  else if (n === 1) el.innerHTML = '<b>1</b> unidade selecionada';
  else el.innerHTML = '<b>'+n+'</b> unidades selecionadas';
}

const DOW = ['dom','seg','ter','qua','qui','sex','sáb'];
function diaLabel(iso){
  const [y,m,d] = String(iso).split('-').map(Number);
  const dt = new Date(y, m-1, d);
  return String(d).padStart(2,'0')+'/'+String(m).padStart(2,'0')+' · '+DOW[dt.getDay()];
}

function addMets(dst, src){
  dst.qtdNf = (dst.qtdNf || 0) + (src.qtdNf || 0);
  dst.valor = (dst.valor || 0) + (src.valor || 0);
  dst.pesoKg = (dst.pesoKg || 0) + (src.pesoKg || 0);
  dst.pesoSecoKg = (dst.pesoSecoKg || 0) + (src.pesoSecoKg || 0);
  dst.pesoResfriadoKg = (dst.pesoResfriadoKg || 0) + (src.pesoResfriadoKg || 0);
  dst.pesoCongeladoKg = (dst.pesoCongeladoKg || 0) + (src.pesoCongeladoKg || 0);
}

/** Dia → Carga → Rota → Cidade → Unidade */
function buildDayTree(unidades){
  const cargas = new Map();
  for (const u of unidades) {
    const pcs = (u.porCarga && u.porCarga.length)
      ? u.porCarga
      : [{
          cdCarga: (u.cargas && u.cargas[0]) != null ? u.cargas[0] : null,
          qtdNf: u.qtdNf,
          valor: u.valor,
          pesoKg: u.pesoKg,
          pesoSecoKg: u.pesoSecoKg,
          pesoResfriadoKg: u.pesoResfriadoKg,
          pesoCongeladoKg: u.pesoCongeladoKg,
        }];
    for (const pc of pcs) {
      const ck = pc.cdCarga != null ? String(pc.cdCarga) : '0';
      if (!cargas.has(ck)) {
        cargas.set(ck, {
          id: ck,
          cdCarga: pc.cdCarga,
          label: pc.cdCarga != null ? ('Carga ' + pc.cdCarga) : 'Sem carga',
          qtdNf: 0, valor: 0, pesoKg: 0, pesoSecoKg: 0, pesoResfriadoKg: 0, pesoCongeladoKg: 0,
          _unids: new Set(),
          rotas: new Map(),
        });
      }
      const cg = cargas.get(ck);
      addMets(cg, pc);
      cg._unids.add(u.key);
      const rk = (u.rota != null && String(u.rota).trim() !== '') ? String(u.rota) : '_';
      if (!cg.rotas.has(rk)) {
        cg.rotas.set(rk, {
          id: rk,
          label: rk === '_' ? 'Sem rota' : ('Rota ' + rk),
          qtdNf: 0, valor: 0, pesoKg: 0, pesoSecoKg: 0, pesoResfriadoKg: 0, pesoCongeladoKg: 0,
          _unids: new Set(),
          cidades: new Map(),
        });
      }
      const rt = cg.rotas.get(rk);
      addMets(rt, pc);
      rt._unids.add(u.key);
      const cid = (u.cidade && String(u.cidade).trim()) || 'Sem cidade';
      const cityKey = cid + '|' + (u.uf || '');
      if (!rt.cidades.has(cityKey)) {
        rt.cidades.set(cityKey, {
          id: cityKey,
          label: cid + (u.uf ? '/' + u.uf : ''),
          cidade: cid,
          uf: u.uf || '',
          qtdNf: 0, valor: 0, pesoKg: 0, pesoSecoKg: 0, pesoResfriadoKg: 0, pesoCongeladoKg: 0,
          _unids: new Set(),
          unidades: [],
        });
      }
      const ct = rt.cidades.get(cityKey);
      addMets(ct, pc);
      ct._unids.add(u.key);
      ct.unidades.push({
        key: u.key,
        nome: u.nome,
        dono: u.dono,
        qtdNf: pc.qtdNf || 0,
        valor: pc.valor || 0,
        pesoKg: pc.pesoKg || 0,
        pesoSecoKg: pc.pesoSecoKg || 0,
        pesoResfriadoKg: pc.pesoResfriadoKg || 0,
        pesoCongeladoKg: pc.pesoCongeladoKg || 0,
      });
    }
  }
  const sortMets = (a, b) => (b.pesoKg || 0) - (a.pesoKg || 0);
  return [...cargas.values()]
    .map((cg) => {
      cg.qtdEntregas = cg._unids.size;
      cg.rotas = [...cg.rotas.values()]
        .map((rt) => {
          rt.qtdEntregas = rt._unids.size;
          rt.cidades = [...rt.cidades.values()]
            .map((ct) => {
              ct.qtdEntregas = ct._unids.size;
              ct.unidades.sort(sortMets);
              delete ct._unids;
              return ct;
            })
            .sort(sortMets);
          delete rt._unids;
          return rt;
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
      delete cg._unids;
      return cg;
    })
    .sort((a, b) => {
      if (a.cdCarga == null && b.cdCarga == null) return 0;
      if (a.cdCarga == null) return 1;
      if (b.cdCarga == null) return -1;
      return a.cdCarga - b.cdCarga;
    });
}

/** Agrega series[].dias → lista por dia (recorte atual). */
function buildAgendaDays(seriesRows){
  const m = new Map();
  for (const s of seriesRows) {
    const key = keyOf(s);
    for (const d of s.dias || []) {
      if (!m.has(d.dia)) {
        m.set(d.dia, {
          dia: d.dia,
          qtdNf: 0,
          pesoKg: 0,
          pesoSecoKg: 0,
          pesoResfriadoKg: 0,
          pesoCongeladoKg: 0,
          valor: 0,
          _cargas: new Set(),
          porUf: { PR: 0, SC: 0 },
          porDono: { Mana: 0, Nutriville: 0 },
          unidades: [],
        });
      }
      const x = m.get(d.dia);
      x.qtdNf += d.qtdNf || 0;
      x.pesoKg += d.pesoKg || 0;
      x.pesoSecoKg += d.pesoSecoKg || 0;
      x.pesoResfriadoKg += d.pesoResfriadoKg || 0;
      x.pesoCongeladoKg += d.pesoCongeladoKg || 0;
      x.valor += d.valor || 0;
      for (const c of d.cargas || []) x._cargas.add(c);
      if (s.uf === 'PR' || s.uf === 'SC') x.porUf[s.uf] += 1;
      if (s.dono === 'Mana' || s.dono === 'Nutriville') x.porDono[s.dono] += 1;
      x.unidades.push({
        key,
        nome: s.nome || s.ponto || 'Unidade',
        cidade: s.cidade,
        uf: s.uf,
        dono: s.dono,
        rota: s.rota,
        qtdNf: d.qtdNf || 0,
        pesoKg: d.pesoKg || 0,
        pesoSecoKg: d.pesoSecoKg || 0,
        pesoResfriadoKg: d.pesoResfriadoKg || 0,
        pesoCongeladoKg: d.pesoCongeladoKg || 0,
        valor: d.valor || 0,
        qtdViagens: d.qtdViagens || 0,
        cargas: d.cargas || [],
        porCarga: d.porCarga || [],
      });
    }
  }
  return [...m.values()]
    .map((x) => {
      x.qtdEntregas = x.unidades.length;
      x.qtdViagens = x._cargas.size;
      x.unidades.sort((a, b) => b.pesoKg - a.pesoKg);
      x.tree = buildDayTree(x.unidades);
      delete x._cargas;
      return x;
    })
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

function tvMet(n){
  return '<div class="met"><b>'+fmtT(n.pesoKg||0)+'</b>'+fmtN(n.qtdNf||0)+' NF · '+fmtRs(n.valor||0)+'</div>';
}

function renderTreeHtml(dia, tree){
  if (!tree || !tree.length) {
    return '<div style="color:var(--muted);font-size:12px;padding:6px 0">Sem detalhe de carga neste dia.</div>';
  }
  const pathOpen = (p) => agendaOpenPaths.has(p);
  let html = '<ul class="tv">';
  for (const cg of tree) {
    const pC = dia + '|c:' + cg.id;
    const openC = pathOpen(pC);
    html += '<li class="tv-node'+(openC?' open':'')+'" data-path="'+esc(pC)+'">';
    html += '<div class="tv-row'+(openC?' open':'')+'">'+
      '<div class="lab"><span class="chev">▶</span><span class="badge carga">Carga</span>'+
      '<div class="ttl">'+esc(cg.label)+'<small>'+fmtN(cg.qtdEntregas)+' unidade(s) · '+fmtN(cg.rotas.length)+' rota(s)</small></div></div>'+
      tvMet(cg)+'</div>';
    html += '<ul class="tv-kids">';
    for (const rt of cg.rotas) {
      const pR = pC + '|r:' + rt.id;
      const openR = pathOpen(pR);
      html += '<li class="tv-node'+(openR?' open':'')+'" data-path="'+esc(pR)+'">';
      html += '<div class="tv-row'+(openR?' open':'')+'">'+
        '<div class="lab"><span class="chev">▶</span><span class="badge rota">Rota</span>'+
        '<div class="ttl">'+esc(rt.label)+'<small>'+fmtN(rt.qtdEntregas)+' unidade(s) · '+fmtN(rt.cidades.length)+' cidade(s)</small></div></div>'+
        tvMet(rt)+'</div>';
      html += '<ul class="tv-kids">';
      for (const ct of rt.cidades) {
        const pCi = pR + '|cid:' + ct.id;
        const openCi = pathOpen(pCi);
        html += '<li class="tv-node'+(openCi?' open':'')+'" data-path="'+esc(pCi)+'">';
        html += '<div class="tv-row'+(openCi?' open':'')+'">'+
          '<div class="lab"><span class="chev">▶</span><span class="badge cidade">Cidade</span>'+
          '<div class="ttl">'+esc(ct.label)+'<small>'+fmtN(ct.qtdEntregas)+' unidade(s)</small></div></div>'+
          tvMet(ct)+'</div>';
        html += '<ul class="tv-kids">';
        for (const u of ct.unidades) {
          html += '<li class="tv-node">'+
            '<div class="tv-row" style="cursor:default">'+
            '<div class="lab"><span class="chev leaf">▶</span><span class="badge unid">Unidade</span>'+
            '<div class="ttl">'+esc(u.nome)+'<small>'+esc(u.dono)+
            ' · S '+fmtT(u.pesoSecoKg||0)+' · R '+fmtT(u.pesoResfriadoKg||0)+' · C '+fmtT(u.pesoCongeladoKg||0)+
            '</small></div></div>'+tvMet(u)+'</div></li>';
        }
        html += '</ul></li>';
      }
      html += '</ul></li>';
    }
    html += '</ul></li>';
  }
  html += '</ul>';
  return html;
}

function renderAgenda(seriesRows, f){
  const card = document.getElementById('agendaCard');
  const list = document.getElementById('agendaList');
  const hint = document.getElementById('agendaHint');
  if (!card || !list) return;
  // Só com exatamente 1 mês marcado (não “todos”)
  if (selectedMeses.size !== 1) {
    card.classList.remove('on');
    list.innerHTML = '';
    agendaOpenDia = null;
    agendaOpenPaths = new Set();
    return;
  }
  const days = buildAgendaDays(seriesRows);
  card.classList.add('on');
  const escopo = selectedKeys.size
    ? (selectedKeys.size === 1 ? '1 unidade' : selectedKeys.size + ' unidades')
    : 'todas as unidades do filtro';
  if (hint) {
    hint.textContent =
      mesFull(f.mesUnico) + ' · ' + escopo +
      ' · dia = expedição (saída/início) · árvore carga → rota → cidade → unidade. Clique para expandir.';
  }
  if (!days.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:8px 0">Nenhum dia com movimento neste recorte.</div>';
    return;
  }
  if (agendaOpenDia && !days.some((d) => d.dia === agendaOpenDia)) {
    agendaOpenDia = null;
    agendaOpenPaths = new Set();
  }
  // limpa paths de outros dias
  if (agendaOpenDia) {
    agendaOpenPaths = new Set([...agendaOpenPaths].filter((p) => p.startsWith(agendaOpenDia + '|')));
  }
  list.innerHTML = days.map((d) => {
    const open = agendaOpenDia === d.dia ? ' open' : '';
    const body = open ? renderTreeHtml(d.dia, d.tree) : '';
    const ufBits = [];
    if (d.porUf.PR) ufBits.push('PR '+d.porUf.PR);
    if (d.porUf.SC) ufBits.push('SC '+d.porUf.SC);
    const donoBits = [];
    if (d.porDono.Mana) donoBits.push('Mana '+d.porDono.Mana);
    if (d.porDono.Nutriville) donoBits.push('Nutriville '+d.porDono.Nutriville);
    return '<div class="agenda-day'+open+'" data-dia="'+d.dia+'">'+
      '<div class="hd" data-role="day">'+
        '<div class="d"><span class="chev">▶</span>'+diaLabel(d.dia)+'<span>'+fmtN(d.qtdEntregas)+' visita(s)</span></div>'+
        '<div class="mets">'+
          '<span><b>'+fmtN(d.qtdViagens)+'</b> carga(s)</span>'+
          '<span><b>'+fmtN(d.qtdNf)+'</b> NF</span>'+
          '<span><b>'+fmtT(d.pesoKg)+'</b></span>'+
          '<span><b>'+fmtRs(d.valor)+'</b></span>'+
        '</div>'+
      '</div>'+
      '<div class="mix3">'+
        '<span class="seco">Seco <b>'+fmtT(d.pesoSecoKg||0)+'</b></span>'+
        '<span class="resf">Resfriado <b>'+fmtT(d.pesoResfriadoKg||0)+'</b></span>'+
        '<span class="cong">Congelado <b>'+fmtT(d.pesoCongeladoKg||0)+'</b></span>'+
      '</div>'+
      '<div class="tags">'+
        (ufBits.length ? '<i>'+esc(ufBits.join(' · '))+'</i>' : '')+
        (donoBits.length ? '<i>'+esc(donoBits.join(' · '))+'</i>' : '')+
      '</div>'+
      '<div class="body">'+body+'</div></div>';
  }).join('');
  list.querySelectorAll('.agenda-day > .hd[data-role="day"]').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const dia = el.parentElement.getAttribute('data-dia');
      if (agendaOpenDia === dia) {
        agendaOpenDia = null;
        agendaOpenPaths = new Set();
      } else {
        agendaOpenDia = dia;
        agendaOpenPaths = new Set();
      }
      renderAgenda(seriesRows, f);
    };
  });
  list.querySelectorAll('.tv-node[data-path] > .tv-row').forEach((el) => {
    el.onclick = (ev) => {
      ev.stopPropagation();
      const path = el.parentElement.getAttribute('data-path');
      if (!path) return;
      if (agendaOpenPaths.has(path)) agendaOpenPaths.delete(path);
      else agendaOpenPaths.add(path);
      renderAgenda(seriesRows, f);
    };
  });
}

function render(){
  if(!DATA) return;
  const f=F();
  const axis = f.meses;
  // remove keys que sumiram do universo (uf/dono)
  const universe = new Set(aggUnits(seriesBase({...f, meses: MESES}, {ignoreMes:true})).map(u=>u.key));
  selectedKeys = new Set([...selectedKeys].filter(k => universe.has(k)));

  let units=aggUnits(seriesBase(f));
  if(f.busca) units=units.filter(u=>((u.nome||'')+(u.ponto||'')+(u.cidade||'')+(u.uf||'')).toLowerCase().includes(f.busca));
  units.sort((a,b)=>ordVal(b,f.ord)-ordVal(a,f.ord));
  syncSelInfo(selectedKeys.size);
  renderList(units);

  let seriesAgenda = null;
  if(selectedKeys.size === 1){
    const only = selectedKeys;
    const seriesMes = seriesBase(f, { onlyKeys: only, ignoreMes: false });
    seriesAgenda = seriesMes;
    const allU = aggUnits(seriesBase({...f, meses: MESES}, { onlyKeys: only, ignoreMes: true }));
    const u = allU[0] || units.find(x=>only.has(x.key));
    paint('unidade', u, aggMeses(seriesMes, false, axis), units, f);
  } else if (selectedKeys.size > 1) {
    const seriesRank = seriesBase(f, { onlyKeys: selectedKeys });
    seriesAgenda = seriesRank;
    const fake = {
      nome: selectedKeys.size + ' unidades',
      cidade: f.uf==='ALL'?'PR + SC':f.uf,
      uf: f.uf==='ALL'?'':f.uf,
      dono: f.dono==='ALL'?'Mana + Nutriville':f.dono,
      pesoKg:sum(seriesRank,'pesoKg'), pesoSecoKg:sum(seriesRank,'pesoSecoKg'), pesoFrioKg:sum(seriesRank,'pesoFrioKg'),
      valor:sum(seriesRank,'valor'), qtdNf:sum(seriesRank,'qtdNf'),
      qtdEntregas:seriesRank.reduce((a,s)=>a+qtdEnt(s),0), qtdViagens:0, pctSeco:0, pctFrio:0
    };
    mergeCargas(fake, { cargas: seriesRank.flatMap(s => s.cargas || []) });
    finCargas(fake);
    const t=fake.pesoKg||0; fake.pctSeco=t>0?Math.round(1000*fake.pesoSecoKg/t)/10:0; fake.pctFrio=t>0?Math.round(1000*fake.pesoFrioKg/t)/10:0;
    paint('grupo', fake, aggMeses(seriesRank, true, axis), units.filter(u=>selectedKeys.has(u.key)), f);
  } else {
    const seriesRank=seriesBase(f);
    seriesAgenda = seriesRank;
    const fake={ nome:'Visão geral', cidade:f.uf==='ALL'?'PR + SC':f.uf, uf:f.uf==='ALL'?'':f.uf, dono:f.dono==='ALL'?'Mana + Nutriville':f.dono,
      pesoKg:sum(seriesRank,'pesoKg'), pesoSecoKg:sum(seriesRank,'pesoSecoKg'), pesoFrioKg:sum(seriesRank,'pesoFrioKg'),
      valor:sum(seriesRank,'valor'), qtdNf:sum(seriesRank,'qtdNf'),
      qtdEntregas:seriesRank.reduce((a,s)=>a+qtdEnt(s),0), qtdViagens:0, pctSeco:0, pctFrio:0 };
    mergeCargas(fake, { cargas: seriesRank.flatMap(s => s.cargas || []) });
    finCargas(fake);
    const t=fake.pesoKg||0; fake.pctSeco=t>0?Math.round(1000*fake.pesoSecoKg/t)/10:0; fake.pctFrio=t>0?Math.round(1000*fake.pesoFrioKg/t)/10:0;
    paint('geral', fake, aggMeses(seriesRank, true, axis), units, f);
  }
  renderAgenda(seriesAgenda || [], f);
}

function paint(mode,u,meses,units,f){
  const totP=sum(meses,'pesoKg'), totS=sum(meses,'pesoSecoKg'), totF=sum(meses,'pesoFrioKg'), totV=sum(meses,'valor');
  const totN=sum(meses,'qtdNf'), totE=sum(meses,'qtdEntregas');
  // Soma das viagens mês a mês (cada carga no mês da expedição)
  const totVig = sum(meses,'qtdViagens');
  const pctS=totP>0?Math.round(1000*totS/totP)/10:0, pctF=totP>0?Math.round(1000*totF/totP)/10:0;
  // 1 mês marcado → KPIs daquele mês; vários → soma do recorte de meses
  const mesFoco = f.mesUnico ? (meses.find(m => m.mes === f.mesUnico) || null) : null;
  const labMes = labelMeses();
  if(mode==='unidade'){
    document.getElementById('titulo').innerHTML=esc(u.nome||u.ponto||'Unidade');
    document.getElementById('subtitulo').textContent=
      (u.cidade||'')+(u.uf?'/'+u.uf:'')+(u.rota!=null?' · rota '+u.rota:'')+
      ' · '+labMes+(mesFoco?' (KPIs do mês)':'');
    document.getElementById('pills').innerHTML=
      '<span class="pill '+(u.dono==='Nutriville'?'hot':'ok')+'">'+esc(u.dono||'')+'</span>'+
      '<span class="pill '+(mesFoco||selectedMeses.size?'hot':'info')+'">'+esc(labMes)+'</span>'+
      '<span class="pill">Seco '+fmtPct(mesFoco?mesFoco.pctSeco:pctS)+'</span>'+
      '<span class="pill">Frio '+fmtPct(mesFoco?mesFoco.pctFrio:pctF)+'</span>';
    document.getElementById('c1t').textContent='Peso mensal da unidade · seco × frio';
    document.getElementById('c2t').textContent=mesFoco?('Mix · '+mesFull(f.mesUnico)):'Mix da unidade (recorte)';
    document.getElementById('tblTitle').textContent='Detalhamento mês a mês — '+(u.nome||'');
    document.getElementById('rankTitle').textContent='Contexto do ranking';
  } else if (mode==='grupo') {
    document.getElementById('titulo').innerHTML=esc(u.nome||'Grupo de unidades');
    document.getElementById('subtitulo').textContent=labMes+' · '+(f.uf==='ALL'?'PR+SC':f.uf)+' · '+(f.dono==='ALL'?'Mana+Nutriville':f.dono);
    document.getElementById('pills').innerHTML=
      '<span class="pill ok">Multi-seleção</span>'+
      '<span class="pill hot">'+esc(labMes)+'</span>'+
      '<span class="pill">Seco '+fmtPct(u.pctSeco)+'</span>'+
      '<span class="pill">Frio '+fmtPct(u.pctFrio)+'</span>'+
      '<span class="pill info">'+fmtN(units.length)+' unidades</span>';
    document.getElementById('c1t').textContent='Evolução do grupo · seco × frio';
    document.getElementById('c2t').textContent='Mix do grupo';
    document.getElementById('tblTitle').textContent='Detalhamento mês a mês — grupo';
    document.getElementById('rankTitle').textContent='Unidades do grupo';
  } else {
    document.getElementById('titulo').innerHTML='Visão <em>executiva</em>';
    document.getElementById('subtitulo').textContent=labMes+' · '+(f.uf==='ALL'?'PR+SC':f.uf)+' · '+(f.dono==='ALL'?'Mana+Nutriville':f.dono);
    document.getElementById('pills').innerHTML='<span class="pill ok">Ao vivo</span><span class="pill hot">'+esc(labMes)+'</span><span class="pill">Seco '+fmtPct(u.pctSeco)+'</span><span class="pill">Frio '+fmtPct(u.pctFrio)+'</span><span class="pill info">'+fmtN(units.length)+' unidades</span>';
    document.getElementById('c1t').textContent='Evolução mensal · peso seco × frio';
    document.getElementById('c2t').textContent='Mix do recorte (ranking)';
    document.getElementById('tblTitle').textContent='Detalhamento mês a mês — visão geral';
    document.getElementById('rankTitle').textContent='Top 8 unidades';
  }
  let showP, showS, showF, showV, showE, showN, showVig, showPS, showPF, kpiEscopo;
  if (mesFoco) {
    showP = mesFoco.pesoKg; showS = mesFoco.pesoSecoKg; showF = mesFoco.pesoFrioKg;
    showV = mesFoco.valor; showE = mesFoco.qtdEntregas || 0; showN = mesFoco.qtdNf || 0;
    showVig = mesFoco.qtdViagens || 0;
    showPS = mesFoco.pctSeco; showPF = mesFoco.pctFrio;
    kpiEscopo = mesFull(f.mesUnico);
  } else if (mode === 'unidade') {
    showP = totP; showS = totS; showF = totF; showV = totV; showE = totE; showN = totN;
    showVig = totVig; showPS = pctS; showPF = pctF; kpiEscopo = labMes;
  } else {
    // geral/grupo: u já é o recorte (meses × unidades)
    showP = u.pesoKg; showS = u.pesoSecoKg; showF = u.pesoFrioKg; showV = u.valor;
    showE = u.qtdEntregas != null ? u.qtdEntregas : totE; showN = u.qtdNf;
    showVig = u.qtdViagens != null ? u.qtdViagens : totVig;
    showPS = u.pctSeco; showPF = u.pctFrio; kpiEscopo = labMes;
  }
  const hintVig = mode==='unidade' ? 'dias com carga · '+kpiEscopo : 'cargas/rotas · '+kpiEscopo;
  const elHintV=document.getElementById('hintViagens');
  if(elHintV) elHintV.textContent = mode==='unidade'
    ? 'Na unidade: 1 viagem = 1 dia com carga operacional (2 cargas no mesmo dia = 1; exclui Baixa estoque)'
    : 'No recorte: cargas/rotas distintas (exclui Baixa estoque)';
  document.getElementById('kpis').innerHTML=
    kpi('Entregas',fmtN(showE),'visitas (unid.×dia) · '+kpiEscopo,'c')+
    kpi('Viagens',fmtN(showVig),hintVig,'a')+
    kpi('NFs',fmtN(showN),'notas · '+kpiEscopo,'')+
    kpi('Peso total',fmtT(showP),fmtKg(showP),'')+
    kpi('Valor NF',fmtRs(showV),'','r')+
    kpi('% Seco / Frio',fmtPct(showPS)+' / '+fmtPct(showPF),fmtKg(showS)+' · '+fmtKg(showF),'s');

  function colMes(m, inner){
    const on = mesFoco && m.mes === f.mesUnico;
    return '<div class="col" style="'+(on?'outline:2px solid var(--amber);outline-offset:2px;border-radius:6px;':'')+'">'+inner+'</div>';
  }
  const maxP=Math.max(1,...meses.map(m=>m.pesoKg));
  document.getElementById('chartStack').innerHTML=meses.map(m=>{
    const h=Math.max(2,Math.round(140*m.pesoKg/maxP)); const hs=m.pesoKg>0?Math.round(h*m.pesoSecoKg/m.pesoKg):0; const hf=Math.max(0,h-hs);
    return colMes(m, '<div class="val">'+fmtT(m.pesoKg)+'</div><div class="stack" style="height:'+h+'px"><i class="fs" style="height:'+hs+'px"></i><i class="ff" style="height:'+hf+'px"></i></div><div class="lab">'+mesCurto(m.mes)+'</div>');
  }).join('');
  const dS=showPS, dF=showPF;
  document.getElementById('donut').style.background='conic-gradient(var(--seco) 0 '+dS+'%, var(--frio) '+dS+'% 100%)';
  document.getElementById('donut').innerHTML='<div class="donut-hole"><b>'+fmtPct(dF)+'</b><span>frio</span></div>';
  document.getElementById('donutLeg').innerHTML='<div><span><i class="sw" style="background:var(--seco)"></i>Seco</span><b>'+fmtPct(dS)+'</b></div><div><span><i class="sw" style="background:var(--frio)"></i>Frio</span><b>'+fmtPct(dF)+'</b></div>';

  const maxV=Math.max(1,...meses.map(m=>m.valor));
  document.getElementById('chartValor').innerHTML=meses.map(m=>{
    const h=Math.max(2,Math.round(130*m.valor/maxV));
    return colMes(m, '<div class="val">'+(m.valor/1000).toLocaleString('pt-BR',{maximumFractionDigits:0})+'k</div><div class="stack" style="height:'+h+'px;background:var(--red)"></div><div class="lab">'+mesCurto(m.mes)+'</div>');
  }).join('');

  // Entregas = visitas; Viagens = cargas distintas
  const maxE=Math.max(1,...meses.map(m=>m.qtdEntregas||0));
  document.getElementById('chartNf').innerHTML=meses.map(m=>{
    const h=Math.max(2,Math.round(140*(m.qtdEntregas||0)/maxE));
    return colMes(m, '<div class="val">'+fmtN(m.qtdEntregas||0)+'</div><div class="stack" style="height:'+h+'px;background:var(--cyan)"></div><div class="lab">'+mesCurto(m.mes)+'</div>');
  }).join('');
  const elVig=document.getElementById('chartViagens');
  if(elVig){
    const maxVig=Math.max(1,...meses.map(m=>m.qtdViagens||0));
    elVig.innerHTML=meses.map(m=>{
      const h=Math.max(2,Math.round(140*(m.qtdViagens||0)/maxVig));
      return colMes(m, '<div class="val">'+fmtN(m.qtdViagens||0)+'</div><div class="stack" style="height:'+h+'px;background:var(--amber)"></div><div class="lab">'+mesCurto(m.mes)+'</div>');
    }).join('');
  }
  const elResumo=document.getElementById('resumoEntregas');
  if(elResumo){
    if(mesFoco){
      elResumo.innerHTML=
        '<div style="margin-bottom:6px"><span class="pill hot">'+mesFull(f.mesUnico)+'</span></div>'+
        '<div><b style="color:#fff">'+fmtN(mesFoco.qtdViagens||0)+'</b> viagens '+(mode==='unidade'?'(dias com carga)':'(cargas/rotas)')+'</div>'+
        '<div><b style="color:#fff">'+fmtN(mesFoco.qtdEntregas||0)+'</b> entregas (visitas unid.×dia)</div>'+
        '<div><b style="color:#fff">'+fmtN(mesFoco.qtdNf||0)+'</b> NFs</div>'+
        (mode==='unidade'?'':'<div><b style="color:#fff">'+fmtN(units.length)+'</b> unidades no ranking</div>')+
        '<div style="margin-top:10px;font-size:11px;color:var(--muted)">'+(mode==='unidade'
          ? 'Na unidade viagem = dia com carga (nunca > entregas). Cargas “Baixa estoque” não contam.'
          : 'Viagem frota = carga distinta · Entrega = unidade×dia · exclui Baixa estoque')+'</div>';
    } else {
      const pico=meses.reduce((best,m)=> (m.qtdViagens||0)>(best.qtdViagens||0)?m:best, meses[0]||{qtdViagens:0,mes:''});
      elResumo.innerHTML=
        '<div style="margin-bottom:6px"><span class="pill hot">'+esc(labMes)+'</span></div>'+
        '<div><b style="color:#fff">'+fmtN(totVig)+'</b> viagens '+(mode==='unidade'?'(dias com carga)':'(cargas/rotas)')+' no período</div>'+
        '<div><b style="color:#fff">'+fmtN(totE)+'</b> entregas (visitas)</div>'+
        '<div><b style="color:#fff">'+fmtN(totN)+'</b> NFs de saída</div>'+
        '<div><b style="color:#fff">'+fmtN(mode==='unidade'?meses.filter(m=>m.qtdEntregas>0).length:units.length)+'</b> '+(mode==='unidade'?'meses com entrega':'unidades no ranking')+'</div>'+
        (pico&&pico.mes?('<div>Pico viagens: <b style="color:#fff">'+fmtN(pico.qtdViagens)+'</b> em '+mesFull(pico.mes)+'</div>'):'')+
        '<div style="margin-top:8px;font-size:11px;color:var(--muted)">NFs em carga “Baixa estoque” não entram no BI operacional</div>';
    }
  }

  document.getElementById('topList').innerHTML=units.slice(0,8).map((x,i)=>{
    const cls=i===0?'t1':i===1?'t2':i===2?'t3':'';
    const onU = selectedKeys.has(x.key);
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);cursor:pointer'+(onU?';background:rgba(26,122,86,.12)':'')+'" data-k="'+encodeURIComponent(x.key)+'"><div style="display:flex;align-items:center;min-width:0"><span class="rank '+cls+'">'+(i+1)+'</span><div style="min-width:0"><div style="font-size:12px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px">'+esc(x.nome)+'</div><div style="font-size:10px;color:var(--muted)">'+esc(x.cidade)+'/'+x.uf+' · '+fmtN(x.qtdViagens||0)+' via. · '+fmtN(x.qtdEntregas)+' ent. · '+fmtN(x.qtdNf)+' NF</div></div></div><div style="text-align:right;font-size:11px"><div>'+fmtT(x.pesoKg)+'</div><div style="color:var(--muted)">F '+fmtPct(x.pctFrio)+'</div></div></div>';
  }).join('')||'<div style="color:var(--muted);font-size:12px">Sem dados</div>';
  document.querySelectorAll('#topList [data-k]').forEach(el=>{ el.onclick=()=>{
    const k=decodeURIComponent(el.getAttribute('data-k'));
    if(selectedKeys.has(k)) selectedKeys.delete(k); else selectedKeys.add(k);
    render();
  }; });

  document.getElementById('tbody').innerHTML=meses.map(m=>{
    const on = mesFoco && m.mes === f.mesUnico;
    return '<tr style="'+(on?'background:rgba(245,158,11,.12);font-weight:650':'')+'">'+
      '<td>'+mesFull(m.mes)+(on?' ←':'')+'</td>'+
      '<td><b>'+fmtN(m.qtdEntregas||0)+'</b></td>'+
      '<td><b>'+fmtN(m.qtdViagens||0)+'</b></td>'+
      '<td>'+fmtN(m.qtdNf||0)+'</td>'+
      '<td>'+fmtN(m.qtdUnidades||0)+'</td>'+
      '<td>'+fmtKg(m.pesoKg)+'</td>'+
      '<td>'+fmtKg(m.pesoSecoKg)+'</td>'+
      '<td>'+fmtKg(m.pesoFrioKg)+'</td>'+
      '<td style="color:var(--seco)">'+fmtPct(m.pctSeco)+'</td>'+
      '<td style="color:var(--frio)">'+fmtPct(m.pctFrio)+'</td>'+
      '<td>'+fmtRs2(m.valor)+'</td>'+
    '</tr>';
  }).join('')+
  '<tr style="font-weight:700">'+
    '<td>Total</td><td>'+fmtN(totE)+'</td><td>'+fmtN(totVig)+'</td><td>'+fmtN(totN)+'</td><td>'+(mode==='unidade'?fmtN(meses.filter(m=>m.qtdEntregas>0).length):fmtN(units.length))+'*</td>'+
    '<td>'+fmtKg(totP)+'</td><td>'+fmtKg(totS)+'</td><td>'+fmtKg(totF)+'</td>'+
    '<td style="color:var(--seco)">'+fmtPct(pctS)+'</td><td style="color:var(--frio)">'+fmtPct(pctF)+'</td>'+
    '<td>'+fmtRs2(totV)+'</td></tr>';
  document.getElementById('foot').textContent=
    'Entrega = unidade×dia · Viagem = carga programada (rota) · NF = nota · *unidades no ranking · '+
    (DATA.range&&DATA.range.nfs?DATA.range.nfs+' NFs · ':'')+
    (DATA.range&&DATA.range.entregas?DATA.range.entregas+' entregas · ':'')+
    (DATA.range&&DATA.range.viagens!=null?DATA.range.viagens+' viagens · ':'')+
    (DATA.fonte||'');
}
function kpi(k,v,d,tone){ return '<div class="kpi '+(tone||'')+'"><div class="k">'+k+'</div><div class="v">'+v+'</div><div class="d">'+esc(d||'')+'</div></div>'; }
function toggleKey(k){
  if(selectedKeys.has(k)) selectedKeys.delete(k);
  else selectedKeys.add(k);
  render();
}
function renderList(units){
  const el=document.getElementById('lista');
  if(!units.length){ el.innerHTML='<div style="padding:20px;color:var(--muted);font-size:12px;text-align:center">Nenhuma unidade</div>'; return; }
  el.innerHTML=units.map(u=>{
    const on=selectedKeys.has(u.key)?' on':'';
    const checked=selectedKeys.has(u.key)?' checked':'';
    return '<div class="u'+on+'" data-k="'+encodeURIComponent(u.key)+'">'+
      '<input class="ck" type="checkbox"'+checked+' aria-label="Selecionar '+esc(u.nome)+'" />'+
      '<div><div class="n">'+esc(u.nome)+'</div><div class="m">'+esc(u.cidade)+'/'+u.uf+' · '+u.dono+(u.rota!=null?' · r'+u.rota:'')+'</div>'+
      '<div class="q"><span>'+fmtT(u.pesoKg)+'</span><span>'+fmtRs(u.valor)+'</span><span>'+(u.qtdViagens||0)+' via.</span><span>'+(u.qtdEntregas!=null?u.qtdEntregas:u.qtdNf)+' ent.</span><span style="opacity:.75">'+u.qtdNf+' NF</span></div>'+
      '<div class="mix"><i class="s" style="width:'+u.pctSeco+'%"></i><i class="f" style="width:'+u.pctFrio+'%"></i></div></div></div>';
  }).join('');
  el.querySelectorAll('.u').forEach(node=>{
    const k=decodeURIComponent(node.getAttribute('data-k'));
    const ck=node.querySelector('.ck');
    ck.onclick=(e)=>e.stopPropagation();
    ck.onchange=()=>{
      if(ck.checked) selectedKeys.add(k); else selectedKeys.delete(k);
      render();
    };
    node.onclick=()=>toggleKey(k);
  });
}

['uf','dono','ord'].forEach(id=>document.getElementById(id).addEventListener('change',render));
document.getElementById('busca').addEventListener('input',render);
document.getElementById('btnClear').onclick=()=>{ selectedKeys=new Set(); render(); };
document.getElementById('btnAllVisible').onclick=()=>{
  const f=F();
  let units=aggUnits(seriesBase(f));
  if(f.busca) units=units.filter(u=>((u.nome||'')+(u.ponto||'')+(u.cidade||'')+(u.uf||'')).toLowerCase().includes(f.busca));
  selectedKeys=new Set(units.map(u=>u.key));
  render();
};
document.getElementById('mesAll').onclick=()=>{ selectedMeses=new Set(); montarMesChips(); render(); };
document.getElementById('mesNone').onclick=()=>{
  // limpar = nenhum chip “ligado” visualmente → força set com sentinela impossível?
  // UX: Limpar = todos (visão completa). Para “nenhum mês” não faz sentido.
  selectedMeses=new Set(); montarMesChips(); render();
};
document.getElementById('btnRefresh').onclick=()=>carregar(true);

carregar(false);
refreshTimer = setInterval(()=>carregar(true), 5*60*1000);
</script>
</body>
</html>`;
}

module.exports = { buildBiVolumePrScHtml };
