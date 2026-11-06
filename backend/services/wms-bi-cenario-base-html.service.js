'use strict';

/**
 * BI dedicado — Cenário de base Colombo/PR → Araquari/SC
 * Shell no molde do BI Volume (sidebar + main full-bleed) para aproveitar a tela.
 */
function buildBiCenarioBaseHtml() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Maranata · Cenário de Base · Colombo → SC</title>
<meta name="bi-def" content="cenario-base; pauta; v=2026-10-20-iss-colombo-3" />
<meta http-equiv="Cache-Control" content="no-store" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;1,9..40,400&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
<style>
:root{
  --verde:#0A3D2E; --verde-mid:#0f4f3b; --verde-escuro:#04140f;
  --vermelho:#E30613; --muted:#b8cec4; --line:rgba(255,255,255,.12);
  --bg:#04140f; --panel:#061a14; --card:rgba(0,0,0,.32);
  --text:#e8f5ef; --ok:#34d399; --warn:#fbbf24; --cyan:#5eead4; --amber:#f59e0b;
}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--text);font-family:"DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
#progress{position:fixed;top:0;left:0;height:3px;width:100%;z-index:60;background:linear-gradient(90deg,var(--verde),var(--vermelho));pointer-events:none}
#boot{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;background:var(--bg);z-index:50}
#boot .spin{width:42px;height:42px;border:3px solid rgba(255,255,255,.12);border-top-color:var(--vermelho);border-radius:50%;animation:sp .8s linear infinite}
@keyframes sp{to{transform:rotate(360deg)}}
#boot p{color:var(--muted);font-size:13px;margin:0}
#boot.err p{color:#fca5a5}
#app{display:none;grid-template-columns:300px 1fr;height:100vh}
aside{
  background:linear-gradient(180deg,#0a2a20 0%,#061a14 55%,#04140f 100%);
  border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0;
}
.brand-bar{
  padding:14px 14px 12px;border-bottom:1px solid var(--line);
  background:radial-gradient(700px 140px at 0% 0%,rgba(227,6,19,.22),transparent 58%);
  flex:0 0 auto;
}
.brand-pair{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
.brand-pair .slot{display:flex;align-items:center;justify-content:center;min-height:48px;padding:5px 8px;border-radius:10px}
.brand-pair .slot.atlas{background:rgba(0,0,0,.22);border:1px solid var(--line)}
.brand-pair .slot.mara{background:#fff;border:1px solid rgba(255,255,255,.2);box-shadow:0 2px 10px rgba(0,0,0,.25)}
.brand-pair img{height:34px;width:auto;max-width:100%;object-fit:contain;display:block}
.eyebrow{display:inline-flex;align-items:center;gap:8px;font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
.eyebrow i{width:20px;height:2px;background:var(--vermelho);border-radius:2px}
.brand-bar .tagline{margin:6px 0 0;font-size:11px;color:var(--muted);line-height:1.4}
.brand-bar .tagline b{color:#fff}
.live{display:inline-flex;align-items:center;gap:6px;font-size:10px;color:#86efac;text-transform:uppercase;letter-spacing:.08em;margin-top:8px}
.live i{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 0 rgba(34,197,94,.7);animation:pulse 1.6s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 8px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.side-scroll{flex:1;min-height:0;overflow:auto;padding:12px 12px 16px;display:flex;flex-direction:column;gap:12px}
.side-block h4{margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--muted)}
.side-links{display:grid;gap:6px}
.side-links a{
  display:block;text-decoration:none;color:var(--text);
  padding:9px 11px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.28);
  font-size:12px;font-weight:650;line-height:1.3;
}
.side-links a:hover{border-color:rgba(227,6,19,.45);background:rgba(10,61,46,.4)}
.side-links a small{display:block;font-size:10px;font-weight:500;color:var(--muted);margin-top:2px}
.chk{display:flex;align-items:flex-start;gap:8px;font-size:12px;color:#dceee5;margin:0 0 10px;line-height:1.35}
.chk input{accent-color:#1a7a56;width:15px;height:15px;margin-top:2px;flex:0 0 auto}
.params{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.params label{display:grid;gap:3px;font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.params label.span2{grid-column:1/-1}
.params input,.params select{
  appearance:none;-webkit-appearance:none;color-scheme:dark;width:100%;
  background:#061a14;border:1px solid var(--line);color:var(--text);
  border-radius:8px;padding:7px 8px;font-size:12px;font-weight:650;font-family:inherit;
}
.params select{
  background-image:
    linear-gradient(45deg,transparent 50%,var(--muted) 50%),
    linear-gradient(135deg,var(--muted) 50%,transparent 50%);
  background-position:calc(100% - 14px) calc(50% - 2px),calc(100% - 9px) calc(50% - 2px);
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:28px;
}
.params input:focus,.params select:focus{outline:none;border-color:rgba(227,6,19,.5)}
.side-note{font-size:11px;color:var(--muted);line-height:1.4;padding:10px;border-radius:10px;border:1px solid var(--line);background:rgba(0,0,0,.22)}
.side-note b{color:#fff}
main{
  overflow:auto;padding:16px 20px 24px;min-height:0;
  background:
    radial-gradient(900px 420px at 8% 0%,rgba(227,6,19,.12),transparent 55%),
    radial-gradient(700px 400px at 92% 100%,rgba(10,61,46,.4),transparent 50%),
    linear-gradient(165deg,#061a14 0%,#0a2a20 42%,#04140f 100%);
}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px;flex-wrap:wrap}
.top h1{
  margin:0;font-size:26px;font-weight:800;letter-spacing:-.02em;color:#fff;line-height:1.05;
}
.top h1 em{font-family:"Instrument Serif",Georgia,serif;font-style:italic;font-weight:400;color:#e8f5ef}
.top h1 .r{color:var(--vermelho)}
.top .sub{margin:6px 0 0;font-size:13px;color:var(--muted);max-width:640px;line-height:1.4}
.top .sub b{color:#fff}
.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{
  background:rgba(0,0,0,.28);border:1px solid var(--line);color:var(--text);
  border-radius:999px;padding:8px 14px;font-size:12px;font-weight:650;cursor:pointer;font-family:inherit;
  text-decoration:none;display:inline-flex;align-items:center;
}
.btn:hover{border-color:rgba(255,255,255,.22)}
.btn.prim{background:var(--verde);border-color:var(--verde);color:#fff}
.btn.prim:hover{background:var(--verde-mid)}
.pills{display:flex;gap:6px;flex-wrap:wrap}
.pill{font-size:11px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);background:rgba(0,0,0,.2)}
.pill.ok{color:#86efac;border-color:rgba(34,197,94,.35);background:rgba(20,83,45,.25)}
.verdict{
  display:grid;grid-template-columns:1.15fr 1fr;gap:12px;margin-bottom:12px;
}
.verdict .yes-box{
  padding:14px 16px;border-radius:14px;
  background:rgba(10,61,46,.65);border:1px solid rgba(52,211,153,.4);
}
.verdict .yes{font-size:16px;font-weight:800;color:var(--ok)}
.verdict .range{margin-top:6px;font-size:28px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.verdict .range small{display:block;font-size:12px;font-weight:500;color:var(--muted);margin-top:4px}
.verdict .caveat{margin-top:8px;font-size:12px;color:#fde68a;line-height:1.35}
.verdict .steps{
  display:grid;grid-template-columns:1fr 1fr;gap:8px;
}
.verdict .steps .s{padding:10px 11px;border-radius:12px;border:1px solid var(--line);background:rgba(0,0,0,.28)}
.verdict .steps .n{font-size:10px;font-weight:800;letter-spacing:.14em;color:var(--vermelho)}
.verdict .steps b{display:block;margin-top:3px;font-size:13px;color:#fff}
.verdict .steps span{font-size:11px;color:var(--muted);line-height:1.3}
.band{display:grid;grid-template-columns:1fr 1.15fr 1fr;gap:10px;margin-bottom:12px}
.band .b{border-radius:14px;padding:12px 14px;border:1px solid var(--line);background:rgba(0,0,0,.28)}
.band .b.mid{border-color:rgba(52,211,153,.45);background:rgba(10,61,46,.45)}
.band .lab{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:700}
.band .val{font-size:22px;font-weight:800;margin-top:5px;color:#fff;font-variant-numeric:tabular-nums}
.band .sub{font-size:11px;color:var(--muted);margin-top:4px;line-height:1.3}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:12px}
.kpi{
  background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px 13px;
  position:relative;overflow:hidden;backdrop-filter:blur(6px);
}
.kpi:before{content:"";position:absolute;inset:0 auto 0 0;width:3px;background:var(--verde-mid)}
.kpi.ok:before{background:var(--ok)}.kpi.w:before{background:var(--warn)}.kpi.c:before{background:var(--cyan)}.kpi.a:before{background:var(--amber)}
.kpi .k{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:650}
.kpi .v{font-size:18px;font-weight:750;margin-top:6px;color:#fff;font-variant-numeric:tabular-nums}
.kpi .d{font-size:11px;color:var(--muted);margin-top:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.grid3{display:grid;grid-template-columns:1.1fr 1fr 1fr;gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:13px 14px;backdrop-filter:blur(6px)}
.card h3{margin:0 0 2px;font-size:14px;font-weight:750;color:#fff}
.card h3 .r{color:var(--vermelho)}
.card .hint{margin:0 0 10px;font-size:11px;color:var(--muted);line-height:1.35}
.stat{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.stat .x .l{font-size:10px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.stat .x .n{font-size:18px;font-weight:750;margin-top:2px;font-variant-numeric:tabular-nums}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{padding:7px 8px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
th:first-child,td:first-child{text-align:left}
th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:650}
td.pos{color:var(--ok)} td.neg{color:#fca5a5}
tr.hl td{background:rgba(10,61,46,.35);font-weight:700}
.compare{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:stretch}
.compare .vs{display:flex;align-items:center;justify-content:center;font-weight:800;color:var(--vermelho);font-size:13px}
.compare .pill{display:inline-block;font-size:11px;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--muted);font-weight:700}
.compare .pill.ok{color:var(--ok);border-color:rgba(52,211,153,.4)}
.compare p{margin:8px 0 0;font-size:12px;color:#dceee5;line-height:1.4}
.deck-end{
  margin-top:4px;padding:12px 14px;border-radius:14px;
  border:1px solid var(--line);background:rgba(10,61,46,.45);
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  font-size:11px;color:var(--muted);line-height:1.45;
}
.deck-end b{color:#fff}
.deck-end .right{font-size:11px;font-weight:650;letter-spacing:.06em;color:#c5ddd2;text-align:right}
@media(max-width:1200px){
  #app{grid-template-columns:260px 1fr}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .verdict{grid-template-columns:1fr}
  .grid3{grid-template-columns:1fr 1fr}
}
@media(max-width:900px){
  #app{grid-template-columns:1fr;height:auto;min-height:100vh}
  aside{border-right:0;border-bottom:1px solid var(--line);max-height:42vh}
  .band,.grid2,.grid3{grid-template-columns:1fr}
  .compare{grid-template-columns:1fr}
}
@media print{
  #progress,#boot,aside .side-links,.actions{display:none!important}
  #app{display:block!important;height:auto}
  aside{display:none}
  body{background:#fff;color:#111}
}
</style>
</head>
<body>
<div id="progress"></div>
<div id="boot"><div class="spin"></div><p id="bootMsg">Carregando dados operacionais…</p></div>
<div id="app">
  <aside>
    <div class="brand-bar">
      <div class="brand-pair">
        <div class="slot atlas"><img src="/img/logoAtlasTransparente.png" alt="Atlas Cargo" /></div>
        <div class="slot mara"><img src="/img/logo_maranata.png" alt="Maranata" /></div>
      </div>
      <div class="eyebrow"><i></i> Cenário de base</div>
      <p class="tagline"><b>Colombo → SC</b> · Mana + Nutriville<br/>Ajuste premissas e veja a faixa ao vivo.</p>
      <div class="live"><i></i> Simulação · jun–set/26</div>
    </div>
    <div class="side-scroll">
      <div class="side-block">
        <h4>Abrir na sala</h4>
        <div class="side-links">
          <a href="/apresentacao-cenario-cd.html" target="_blank" rel="noopener">Deck pauta CD<small>Lâminas para Maranata × Mana/Nutriville</small></a>
          <a href="/bi-volume-pr-sc.html" target="_blank" rel="noopener">BI Volume PR/SC<small>Retrato operacional ao vivo</small></a>
          <a href="/" target="_blank" rel="noopener">Atlas Cargo<small>Login · painel · WMS</small></a>
        </div>
      </div>
      <div class="side-block">
        <h4>Premissas (sala)</h4>
        <label class="chk"><input type="checkbox" id="exHc" checked /> Excluir HC.UFPR do cenário futuro</label>
        <div class="params">
          <label>Δ km SC<input type="number" id="kmSc" value="-260" step="10" /></label>
          <label>Δ km PR<input type="number" id="kmPr" value="260" step="10" /></label>
          <label>R$ / km<input type="number" id="rsKm" value="3.5" step="0.1" min="0" /></label>
          <label>% Frete NF<input type="number" id="pctFrete" value="11" step="0.1" /></label>
          <label>% Arm. pico<input type="number" id="pctArm" value="7" step="0.1" /></label>
          <label>Pico R$/mês<input type="number" id="pico" value="0" step="1000" title="0 = NF÷meses" /></label>
          <label title="Frete PR→PR: isento (RICMS/PR — início e fim no PR)">ICMS PR int.<input type="number" id="icmsPrInt" value="0" step="0.1" /></label>
          <label>ICMS inter.<input type="number" id="icmsInter" value="12" step="0.1" /></label>
          <label class="span2">ICMS SC interno
            <select id="icmsScInt"><option value="17" selected>17% (interno SC)</option><option value="12">12% (interestadual / teste)</option></select>
          </label>
          <label title="Demonstrativo contadora — ISS 3% s/ NFS-e">ISS Colombo<input type="number" id="issCol" value="3" step="0.1" /></label>
          <label class="span2" title="Base do CD em SC (contadora)">ISS Araquari<input type="number" id="issAra" value="2" step="0.1" /></label>
        </div>
      </div>
      <div class="side-note">
        <b>Premissas fiscais:</b> PR→PR <b>isento</b> · PR↔SC <b>12%</b> · SC→SC <b>17%</b>.
        ISS: Colombo <b>3%</b> (demonstrativo) → Araquari <b>2%</b> (base do CD).
      </div>
    </div>
  </aside>

  <main>
    <div class="top">
      <div>
        <div class="eyebrow"><i></i> Pauta · recorte ao vivo</div>
        <h1>Colombo/PR → <em>Santa Catarina</em> · <span class="r">Vale migrar o CD?</span></h1>
        <p class="sub">Maranata: <b>7% pico</b> + <b>11% NF</b>. Recolhe <b>ISS</b> (município do CD) e <b>ICMS frete</b> (onde a prestação começa).</p>
      </div>
      <div class="actions">
        <button class="btn prim" type="button" id="btnRecalc">Recalcular</button>
        <button class="btn" type="button" id="btnRefresh">Atualizar agora</button>
        <div class="pills">
          <span class="pill" id="stamp">—</span>
          <span class="pill ok" id="periodPill">—</span>
        </div>
      </div>
    </div>

    <div class="verdict">
      <div class="yes-box">
        <div class="yes" id="verdictYes">SIM — migrar o CD para Santa Catarina</div>
        <div class="range" id="verdictRange">—<small id="verdictRangeSub">Faixa mensal estimada (não é garantia de caixa)</small></div>
        <div class="caveat" id="verdictCaveat">Base do CD em SC: Araquari (ISS 2%).</div>
      </div>
      <div class="steps">
        <div class="s"><div class="n">01</div><b>Volume</b><span>SC gordo · PR magro</span></div>
        <div class="s"><div class="n">02</div><b>Km</b><span>SC encurta · saldo cai</span></div>
        <div class="s"><div class="n">03</div><b>Imposto</b><span>ICMS 17% SC · ISS 2%</span></div>
        <div class="s"><div class="n">04</div><b>Local</b><span>Araquari</span></div>
      </div>
    </div>

    <div class="band" id="band"></div>
    <div class="kpis" id="kpisTopo"></div>

    <div class="grid2">
      <div class="card">
        <h3>Retrato <span class="r">SC</span> · braço gordo</h3>
        <p class="hint" id="hintSc">—</p>
        <div id="blkSc"></div>
      </div>
      <div class="card">
        <h3>Retrato <span class="r">PR</span> · braço magro</h3>
        <p class="hint" id="hintPr">—</p>
        <div id="blkPr"></div>
      </div>
    </div>

    <div class="grid3">
      <div class="card">
        <h3>Impacto <span class="r">mês a mês</span></h3>
        <p class="hint">Central (ICMS SC 17%) × se SC interno fosse 12%</p>
        <div id="blkMeses" style="overflow:auto"></div>
      </div>
      <div class="card">
        <h3>Km · ciclo</h3>
        <p class="hint">Δ km/viagem × viagens</p>
        <div id="blkKm"></div>
      </div>
      <div class="card">
        <h3>Base · <span class="r">Araquari</span></h3>
        <p class="hint">ISS 2% (contadora) · CD em SC</p>
        <div style="display:grid;gap:10px;margin-top:8px">
          <div><span class="pill ok">Araquari</span>
            <p style="margin:8px 0 0;font-size:12px;color:#dceee5;line-height:1.4">Município-base da migração. ISS 2% vs Colombo 3%.</p>
          </div>
          <div>
            <p style="margin:0;font-size:12px;color:var(--muted);line-height:1.4">ICMS: SC→SC 17% · PR↔SC 12% · PR→PR isento.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>ICMS frete</h3>
        <p class="hint">11% × NF · PR→PR isento · PR↔SC 12% · SC→SC 17% (não isento)</p>
        <div id="blkIcms"></div>
      </div>
      <div class="card">
        <h3>ISS armazenagem</h3>
        <p class="hint">Cobrança 7% pode ficar · muda o ISS municipal</p>
        <div id="blkIss"></div>
      </div>
    </div>

    <div class="deck-end">
      <div>
        <b>Reunião:</b> Araquari (ISS 2%) · ICMS SC 17% · PR→PR isento · PR↔SC 12%.
        <br/><span id="footMeta"></span>
      </div>
      <div class="right">ATLAS · MARANATA · MANA + NUTRIVILLE</div>
    </div>
  </main>
</div>
<script>
const fmtN = n => (n||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
const fmt1 = n => (n||0).toLocaleString('pt-BR',{maximumFractionDigits:1});
const fmtRs = n => 'R$ ' + (n||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
const MES_L = {6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',5:'Mai'};
let DATA = null;

function token(){
  const q = new URLSearchParams(location.search).get('token');
  if (q) return q;
  try { return localStorage.getItem('token') || ''; } catch (_) { return ''; }
}
function isHc(s){
  const n = ((s.nome||'')+' '+(s.ponto||'')).toUpperCase();
  return n.includes('HC.UFPR') || n.includes('HC UFPR') || (n.includes('UFPR') && n.includes('CURITIBA'));
}
function P(){
  return {
    kmSc: Number(document.getElementById('kmSc').value)||0,
    kmPr: Number(document.getElementById('kmPr').value)||0,
    rsKm: Number(document.getElementById('rsKm').value)||0,
    pctFrete: Number(document.getElementById('pctFrete').value)||0,
    pctArm: Number(document.getElementById('pctArm').value)||0,
    pico: Number(document.getElementById('pico').value)||0,
    icmsPrInt: Number(document.getElementById('icmsPrInt').value)||0,
    icmsInter: Number(document.getElementById('icmsInter').value)||0,
    icmsScInt: Number(document.getElementById('icmsScInt').value)||0,
    issCol: Number(document.getElementById('issCol').value)||0,
    issAra: Number(document.getElementById('issAra').value)||0,
    exHc: document.getElementById('exHc').checked,
  };
}
function aggUf(series, uf, exHc){
  const cargas = new Set();
  let peso=0, valor=0, nf=0, ent=0;
  const unids = new Set();
  let hcValor=0, hcPeso=0, hcNf=0, hcEnt=0, hcCargas=new Set();
  for (const s of series) {
    if (s.uf !== uf) continue;
    const hc = isHc(s);
    if (exHc && hc) {
      hcValor += s.valor||0; hcPeso += s.pesoKg||0; hcNf += s.qtdNf||0; hcEnt += s.qtdEntregas||0;
      for (const c of s.cargas||[]) hcCargas.add(c);
      continue;
    }
    peso += s.pesoKg||0; valor += s.valor||0; nf += s.qtdNf||0; ent += s.qtdEntregas||0;
    unids.add(s.cdEnd != null ? 'E'+s.cdEnd : (s.nome||s.ponto||Math.random()));
    for (const c of s.cargas||[]) cargas.add(c);
  }
  return { peso, valor, nf, ent, viagens: cargas.size, unids: unids.size,
    hc: { valor: hcValor, peso: hcPeso, nf: hcNf, ent: hcEnt, viagens: hcCargas.size } };
}
function seriesPeriodo(series){
  const meses = [...new Set(series.map(s=>s.mes))].sort();
  const prefer = ['2026-06','2026-07','2026-08','2026-09'];
  const use = prefer.every(m => meses.includes(m)) ? prefer : meses.slice(-4);
  return { meses: use, rows: series.filter(s => use.includes(s.mes)) };
}
function mesLabel(ym){
  const [y,m] = ym.split('-').map(Number);
  return (MES_L[m]||m) + '/' + String(y).slice(2);
}
function calcMes(rowsMes, p, icmsScOverride, nMes){
  const sc = aggUf(rowsMes, 'SC', false);
  const pr = aggUf(rowsMes, 'PR', p.exHc);
  const n = Math.max(1, nMes || 1);
  const icmsSc = icmsScOverride != null ? icmsScOverride : p.icmsScInt;
  const freteSc = sc.valor * p.pctFrete/100;
  const fretePr = pr.valor * p.pctFrete/100;
  const dKm = sc.viagens * p.kmSc + pr.viagens * p.kmPr;
  const econKm = -dKm * p.rsKm;
  const icmsHoje = freteSc * p.icmsInter/100 + fretePr * p.icmsPrInt/100;
  const icmsFut = freteSc * icmsSc/100 + fretePr * p.icmsInter/100;
  const dIcms = icmsFut - icmsHoje;
  const picoMes = p.pico > 0 ? p.pico : (sc.valor + pr.valor) / n;
  const recArmMes = picoMes * p.pctArm/100;
  const dIssMes = recArmMes * (p.issAra - p.issCol) / 100;
  const dIss = dIssMes * n;
  const caixa = econKm - dIcms - dIss;
  return { sc, pr, dKm, econKm, dIcms, dIss, dIssMes, caixa, freteSc, fretePr, icmsHoje, icmsFut, picoMes, recArmMes };
}

function render(){
  if (!DATA) return;
  const p = P();
  const { meses, rows } = seriesPeriodo(DATA.series||[]);
  const nMes = Math.max(1, meses.length);
  const sc = aggUf(rows, 'SC', false);
  const pr = aggUf(rows, 'PR', p.exHc);
  const prFull = aggUf(rows, 'PR', false);

  const central = calcMes(rows, p, p.icmsScInt, nMes);
  const conserv = calcMes(rows, Object.assign({}, p, {
    kmSc: (p.kmSc >= 0 ? 1 : -1) * 200,
    kmPr: (p.kmPr >= 0 ? 1 : -1) * 200,
    icmsScInt: 17
  }), 17, nMes);
  const otim12 = calcMes(rows, Object.assign({}, p, { icmsScInt: 12 }), 12, nMes);

  const cMes = central.caixa / nMes;
  const kMes = conserv.caixa / nMes;
  const oMes = otim12.caixa / nMes;
  const lo = Math.min(kMes, cMes);
  const hi = Math.max(oMes, cMes);

  document.getElementById('verdictYes').textContent =
    (cMes > 0 && kMes > 0) ? 'SIM — migrar o CD para Araquari/SC'
    : (cMes > 0 ? 'SIM, com ressalvas — validar premissas de km/ICMS' : 'Rever premissas antes de decidir');
  document.getElementById('verdictRange').innerHTML =
    fmtRs(Math.round(lo)) + ' a ' + fmtRs(Math.round(hi)) + '<small id="verdictRangeSub">por mês · conservador → central/otimista (ICMS SC 12%) · Araquari</small>';
  document.getElementById('verdictCaveat').textContent =
    'Base do CD: Araquari (ISS 2%). Não prometer o central ('+fmtRs(Math.round(cMes))+') como caixa fechado.';

  document.getElementById('periodPill').textContent = meses.map(mesLabel).join(' · ');
  document.getElementById('band').innerHTML =
    '<div class="b"><div class="lab">Conservador</div><div class="val">'+fmtRs(Math.round(kMes))+'<span style="font-size:12px;font-weight:500;color:var(--muted)"> /mês</span></div><div class="sub">±200 km · ICMS SC 17% · Araquari 2%</div></div>'+
    '<div class="b mid"><div class="lab">Central · Araquari</div><div class="val">'+fmtRs(Math.round(cMes))+'<span style="font-size:12px;font-weight:500;color:var(--muted)"> /mês</span></div><div class="sub">±260 km · ICMS SC '+p.icmsScInt+'% · ISS '+fmt1(p.issAra)+'%</div></div>'+
    '<div class="b"><div class="lab">Se ICMS SC 12%</div><div class="val">'+fmtRs(Math.round(oMes))+'<span style="font-size:12px;font-weight:500;color:var(--muted)"> /mês</span></div><div class="sub">Mesmo ±260 km · Araquari 2%</div></div>';

  const dKmMes = central.dKm / nMes;
  document.getElementById('kpisTopo').innerHTML =
    '<div class="kpi ok"><div class="k">Δ km / mês</div><div class="v">'+fmt1(dKmMes)+' km</div><div class="d">Saldo de ciclo</div></div>'+
    '<div class="kpi ok"><div class="k">Economia km / mês</div><div class="v">'+fmtRs(central.econKm/nMes)+'</div><div class="d">Motor principal do case</div></div>'+
    '<div class="kpi '+(central.dIcms<=0?'c':'w')+'"><div class="k">Δ ICMS frete / mês</div><div class="v">'+fmtRs(-central.dIcms/nMes)+'</div><div class="d">SC interno '+p.icmsScInt+'% · PR 0%→12%</div></div>'+
    '<div class="kpi a"><div class="k">Δ ISS arm. / mês</div><div class="v">'+fmtRs(-central.dIss/nMes)+'</div><div class="d">Colombo '+fmt1(p.issCol)+'% → Araquari '+fmt1(p.issAra)+'%</div></div>';

  document.getElementById('hintSc').textContent = nMes + ' meses · Mana+Nutriville · com CD em SC = frete interno';
  document.getElementById('hintPr').textContent = (p.exHc?'Sem HC.UFPR · ':'') + nMes + ' meses · Mana+Nutriville · com CD em SC = interestadual';
  document.getElementById('blkSc').innerHTML = mini(sc);
  document.getElementById('blkPr').innerHTML = mini(pr) +
    (p.exHc && prFull.hc.viagens ? '<p style="margin:8px 0 0;font-size:11px;color:var(--warn)">HC.UFPR fora: '+fmtN(prFull.hc.viagens)+' via. · '+fmtRs(prFull.hc.valor)+'</p>' : '');

  let mesHtml = '<table><thead><tr><th>Mês</th><th>Via SC</th><th>Via PR</th><th>Δ km</th><th>Caixa 17%</th><th>Caixa 12%</th></tr></thead><tbody>';
  for (const mes of meses) {
    const rowsM = rows.filter(s => s.mes === mes);
    const a = calcMes(rowsM, p, 17, 1);
    const b = calcMes(rowsM, p, 12, 1);
    mesHtml += '<tr><td>'+mesLabel(mes)+'</td><td>'+fmtN(a.sc.viagens)+'</td><td>'+fmtN(a.pr.viagens)+'</td>'+
      '<td class="'+(a.dKm<0?'pos':'neg')+'">'+fmtN(a.dKm)+'</td>'+
      '<td class="'+(a.caixa>0?'pos':'neg')+'">'+fmtRs(a.caixa)+'</td>'+
      '<td class="'+(b.caixa>0?'pos':'neg')+'">'+fmtRs(b.caixa)+'</td></tr>';
  }
  mesHtml += '<tr class="hl"><td>Média</td><td></td><td></td><td class="pos">'+fmt1(dKmMes)+'</td><td class="pos">'+fmtRs(calcMes(rows,p,17,nMes).caixa/nMes)+'</td><td class="pos">'+fmtRs(oMes)+'</td></tr></tbody></table>';
  document.getElementById('blkMeses').innerHTML = mesHtml;

  document.getElementById('blkKm').innerHTML =
    '<table><thead><tr><th></th><th>Via</th><th>Δ km</th><th>Δ R$</th></tr></thead><tbody>'+
    '<tr><td>SC</td><td>'+fmtN(sc.viagens)+'</td><td class="pos">'+fmtN(sc.viagens*p.kmSc)+'</td><td class="pos">'+fmtRs(-(sc.viagens*p.kmSc)*p.rsKm)+'</td></tr>'+
    '<tr><td>PR'+(p.exHc?'*':'')+'</td><td>'+fmtN(pr.viagens)+'</td><td class="neg">'+fmtN(pr.viagens*p.kmPr)+'</td><td class="neg">'+fmtRs(-(pr.viagens*p.kmPr)*p.rsKm)+'</td></tr>'+
    '<tr class="hl"><td>Saldo</td><td>'+fmtN(sc.viagens+pr.viagens)+'</td><td class="pos">'+fmtN(central.dKm)+'</td><td class="pos">'+fmtRs(central.econKm)+'</td></tr>'+
    '</tbody></table>';

  document.getElementById('blkIcms').innerHTML =
    '<table><thead><tr><th>Braço</th><th>Frete</th><th>Hoje</th><th>Futuro</th><th>Δ</th></tr></thead><tbody>'+
    rowIcms('SC', central.freteSc, central.freteSc*p.icmsInter/100, central.freteSc*p.icmsScInt/100)+
    rowIcms('PR', central.fretePr, central.fretePr*p.icmsPrInt/100, central.fretePr*p.icmsInter/100)+
    '<tr class="hl"><td>Período</td><td>'+fmtRs(central.freteSc+central.fretePr)+'</td><td>'+fmtRs(central.icmsHoje)+'</td><td>'+fmtRs(central.icmsFut)+'</td><td class="'+(central.dIcms<=0?'pos':'neg')+'">'+fmtRs(central.dIcms)+'</td></tr>'+
    '</tbody></table>';

  const issCol = central.recArmMes * p.issCol/100;
  const issAra = central.recArmMes * p.issAra/100;
  document.getElementById('blkIss').innerHTML =
    '<table><thead><tr><th></th><th>Receita/mês</th><th>%</th><th>ISS/mês</th></tr></thead><tbody>'+
    '<tr><td>Colombo</td><td>'+fmtRs(central.recArmMes)+'</td><td>'+fmt1(p.issCol)+'</td><td>'+fmtRs(issCol)+'</td></tr>'+
    '<tr><td>Araquari</td><td>'+fmtRs(central.recArmMes)+'</td><td>'+fmt1(p.issAra)+'</td><td class="pos">'+fmtRs(issAra)+'</td></tr>'+
    '<tr class="hl"><td>Δ Araquari</td><td></td><td></td><td class="pos">'+fmtRs(issAra-issCol)+'</td></tr>'+
    '</tbody></table>'+
    '<p style="margin:8px 0 0;font-size:11px;color:var(--muted)">Pico '+(p.pico>0?'informado':'estimado NF÷meses')+': '+fmtRs(central.picoMes)+'/mês · base CD = Araquari</p>';

  document.getElementById('footMeta').textContent =
    'Período '+meses.join(', ')+' · '+new Date().toLocaleString('pt-BR')+(DATA.elapsedMs!=null?' · API '+DATA.elapsedMs+'ms':'');
}
function rowIcms(nome, frete, hoje, fut){
  const d = fut - hoje;
  return '<tr><td>'+nome+'</td><td>'+fmtRs(frete)+'</td><td>'+fmtRs(hoje)+'</td><td>'+fmtRs(fut)+'</td><td class="'+(d<=0?'pos':'neg')+'">'+fmtRs(d)+'</td></tr>';
}
function mini(u){
  return '<div class="stat">'+
    '<div class="x"><div class="l">Unidades</div><div class="n">'+fmtN(u.unids)+'</div></div>'+
    '<div class="x"><div class="l">Viagens</div><div class="n">'+fmtN(u.viagens)+'</div></div>'+
    '<div class="x"><div class="l">Peso</div><div class="n">'+fmt1(u.peso/1000)+' t</div></div>'+
    '<div class="x"><div class="l">Valor NF</div><div class="n">'+fmtRs(u.valor)+'</div></div></div>'+
    '<p style="margin:8px 0 0;font-size:11px;color:var(--muted)">'+fmtN(u.ent)+' entregas · '+fmtN(u.nf)+' NFs</p>';
}

async function load(force){
  const boot = document.getElementById('boot');
  const msg = document.getElementById('bootMsg');
  boot.style.display='flex'; boot.classList.remove('err');
  document.getElementById('app').style.display='none';
  msg.textContent = force ? 'Atualizando…' : 'Carregando dados…';
  const t = token();
  if (!t) { boot.classList.add('err'); msg.innerHTML='Login necessário ou <code>?token=JWT</code>'; return; }
  try {
    const r = await fetch('/api/wms/bi/volume-pr-sc'+(force?'?refresh=1':''), { headers:{ Authorization:'Bearer '+t }});
    if (!r.ok) throw new Error('HTTP '+r.status);
    DATA = await r.json();
    document.getElementById('stamp').textContent = (DATA.cache?'cache · ':'fresco · ')+new Date().toLocaleString('pt-BR');
    boot.style.display='none';
    document.getElementById('app').style.display='grid';
    render();
  } catch (e) {
    boot.classList.add('err'); msg.textContent='Erro: '+(e.message||e);
  }
}
document.getElementById('btnRecalc').onclick = render;
document.getElementById('btnRefresh').onclick = () => load(true);
['kmSc','kmPr','rsKm','pctFrete','pctArm','pico','icmsPrInt','icmsInter','icmsScInt','issCol','issAra','exHc']
  .forEach(id => { const el=document.getElementById(id); if(el) el.addEventListener('change', render); });
load(false);
</script>
</body>
</html>`;
}

module.exports = { buildBiCenarioBaseHtml };
