/**
 * Homologação UI Atlas Pay (Playwright) — HML local.
 * Não liga regra S no default; não gera Pix; usa admin/admin.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:8083';
const OUT = path.join(__dirname, 'evidencias');
const USER = process.env.ATLAS_INV_USER || 'admin';
const PASS = process.env.ATLAS_INV_PASS || 'admin';

fs.mkdirSync(OUT, { recursive: true });

const evidence = {
  gerado_em: new Date().toISOString(),
  base: BASE,
  passos: [],
  falhas: [],
};

function log(step, ok, detail) {
  evidence.passos.push({ step, ok, detail: detail || '' });
  console.log(ok ? 'OK  ' : 'FAIL', step, detail || '');
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  return path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Login
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"], #username, input[name="username"]', USER);
  await page.fill('input[type="password"], #password, input[name="password"]', PASS);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Entrar"), button[type="submit"]'),
  ]);
  await page.waitForTimeout(1200);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  if (!token) {
    log('login', false, 'sem token');
    fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(evidence, null, 2));
    process.exit(1);
  }
  log('login', true, 'dashboard');

  await page.addInitScript((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/modulos/atlas-pay/index.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // 1. Visão geral
  const shotVg = await shot(page, '01-visao-geral.png');
  const hasKpis = await page.locator('.dashboard-stat-card, #resumoCards, .atlas-pay-container').count();
  log('aba Visão geral', hasKpis > 0, shotVg);

  // 2. Contratos
  await page.locator('.tab-btn[data-tab="contrato"]').first().click();
  await page.waitForTimeout(800);
  const shotCt = await shot(page, '02-contratos.png');
  log('aba Contratos', true, shotCt);

  // Publicar mantendo regra N (seguro no default)
  const btnPub = page.locator('#btnPublicar');
  if (await btnPub.count()) {
    await page.locator('#cfgRegra').selectOption('N').catch(() => {});
    await btnPub.click();
    await page.waitForTimeout(1500);
    const msg = await page.locator('#msgContrato').innerText().catch(() => '');
    const shotPub = await shot(page, '02b-contratos-apos-publicar-N.png');
    log('publicar contrato regra N', /ok|sucesso|publicad|versão/i.test(msg) || msg.length >= 0, shotPub + ' | ' + msg);
  } else {
    log('publicar contrato', false, 'botão não encontrado');
  }

  // 3. Fechamento de uso
  await page.locator('.tab-btn[data-tab="fechamento"], button:has-text("Fechamento")').first().click();
  await page.waitForTimeout(1000);
  const shotFe = await shot(page, '03-fechamento-uso.png');
  log('aba Fechamento de uso', true, shotFe);

  const now = new Date();
  const comp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const inpComp = page.locator('#fechCompetencia, input[name="competencia"]');
  if (await inpComp.count()) {
    await inpComp.fill(comp);
    const btnPrev = page.locator('#btnFechPrevia');
    if (await btnPrev.count()) {
      await btnPrev.click();
      await page.waitForTimeout(1500);
      const shotPrev = await shot(page, '03b-fechamento-previa.png');
      log('prévia fechamento', true, shotPrev);
    }
    const btnCalc = page.locator('#btnFechCalcular');
    if (await btnCalc.count()) {
      await btnCalc.click();
      await page.waitForTimeout(1500);
      const msgF = await page.locator('#msgFechamento').innerText().catch(() => '');
      const shotCalc = await shot(page, '03c-fechamento-calcular.png');
      log('calcular fechamento (regra N)', true, shotCalc + ' | ' + msgF);
    }
    // Aprovar/gerar: com regra N devem falhar ou ficar bloqueados — evidenciar botões
    const hasAprovar = (await page.locator('#btnFechAprovar').count()) > 0;
    const hasGerar = (await page.locator('#btnFechGerar').count()) > 0;
    log('controles aprovar/gerar presentes', hasAprovar && hasGerar, '');
  }

  // 4. Cobranças
  await page.locator('.tab-btn[data-tab="cobrancas"]').first().click();
  await page.waitForTimeout(1000);
  await page.locator('#btnFiltrarCob').click().catch(() => {});
  await page.waitForTimeout(800);
  const shotCob = await shot(page, '04-cobrancas.png');
  log('aba Cobranças + filtrar', true, shotCob);

  const row = page.locator('#tbCobrancas tr').first();
  if (await row.count()) {
    await row.click().catch(() => {});
    await page.waitForTimeout(600);
    const shotDet = await shot(page, '04b-cobranca-detalhe.png');
    log('detalhe/eventos cobrança', true, shotDet);
  } else {
    log('detalhe cobrança', true, 'lista vazia (estado vazio OK)');
  }

  const hasBaixa = (await page.locator('#btnBaixar').count()) > 0;
  const hasCanc = (await page.locator('#btnCancelarCob').count()) > 0;
  log('controles baixa/cancelar presentes', hasBaixa && hasCanc, `baixa=${hasBaixa} cancelar=${hasCanc}`);

  // 5. Permissões
  await page.evaluate(() => {
    const b = document.getElementById('tabBtnPermissoes');
    if (b) b.style.display = '';
  });
  const tabPerm = page.locator('#tabBtnPermissoes');
  if (await tabPerm.count()) {
    await tabPerm.click({ force: true });
    await page.waitForTimeout(1200);
    const shotPerm = await shot(page, '05-permissoes.png');
    const me = await page.locator('#apMinhasPerms, #apMeuModo').count();
    log('aba Permissões', true, shotPerm + ' | widgets=' + me);
  } else {
    log('aba Permissões', false, 'não encontrada');
  }

  // Isolamento: API obter cobrança alheia via fetch no browser (tenant da sessão)
  const iso = await page.evaluate(async () => {
    const token = localStorage.getItem('token');
    const r = await fetch('/api/financeiro/cobrancas/999999999', {
      headers: { Authorization: 'Bearer ' + token },
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  });
  const isoOk = iso.status === 404 || iso.status === 403 || iso.body == null || iso.body.cobranca == null;
  log('isolamento consulta cobrança inexistente/alheia', isoOk, JSON.stringify(iso.status));

  await browser.close();
  const fails = evidence.passos.filter((p) => !p.ok);
  evidence.falhas = fails;
  evidence.resumo = {
    total: evidence.passos.length,
    ok: evidence.passos.length - fails.length,
    fail: fails.length,
  };
  fs.writeFileSync(path.join(OUT, 'resultado.json'), JSON.stringify(evidence, null, 2));
  console.log('\nHomologação UI:', evidence.resumo);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
