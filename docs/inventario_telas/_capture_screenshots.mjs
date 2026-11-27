/**
 * Captura headless de telas reais do Atlas Cargo (somente leitura).
 * Uso: node _capture_screenshots.mjs
 * Não altera banco nem permissões.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'http://localhost:8083';
const OUT = path.join(__dirname, 'screenshots');
const USER = process.env.ATLAS_INV_USER || 'admin';
const PASS = process.env.ATLAS_INV_PASS || 'admin';

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

async function shot(page, relPath, opts = {}) {
  const full = path.join(OUT, relPath);
  ensureDir(path.dirname(full));
  await page.waitForTimeout(opts.wait || 800);
  await page.screenshot({ path: full, fullPage: !!opts.fullPage });
  console.log('OK', relPath);
  return relPath;
}

async function loginTorre(page) {
  await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
  await page.fill('input[name="username"], #username, input[type="text"]', USER);
  await page.fill('input[name="password"], #password, input[type="password"]', PASS);
  await Promise.all([
    page.waitForURL(/dashboard\.html/, { timeout: 20000 }).catch(() => null),
    page.click('button:has-text("Entrar"), #btnLogin, button[type="submit"]'),
  ]);
  await page.waitForTimeout(1500);
  const token = await page.evaluate(() => localStorage.getItem('token'));
  if (!token) throw new Error('Login torre falhou — sem token');
  return token;
}

async function withAuth(page, token) {
  await page.addInitScript((t) => {
    localStorage.setItem('token', t);
  }, token);
}

const PUBLIC = [
  ['00-publico/login-torre-claro.png', '/index.html', { fullPage: true }],
  ['00-publico/recuperar-senha-torre.png', '/recuperar-senha.html', { fullPage: true }],
  ['00-publico/cadastro-empresa.png', '/cadastro-empresa.html', { fullPage: true }],
  ['00-publico/convocacao-publica.png', '/convocacao.html', { fullPage: true }],
  ['00-publico/bi-cenario-base.png', '/bi-cenario-base.html', { fullPage: false }],
  ['00-publico/teste-mobile.png', '/teste-mobile.html', { fullPage: true }],
  ['08-motorista/login-motorista.png', '/motorista/index.html', { fullPage: true }],
  ['08-motorista/cadastro-motorista.png', '/motorista/pages/cadastro.html', { fullPage: true }],
  ['08-motorista/recuperar-senha.png', '/motorista/pages/recuperar-senha.html', { fullPage: true }],
];

const MODULES = [
  ['01-cadastros/cadastro-geral.png', 'gerenciar-cadastro-geral'],
  ['01-cadastros/estados.png', 'gerenciar-estados'],
  ['01-cadastros/mesorregiao.png', 'gerenciar-mesorregiao'],
  ['01-cadastros/cidades.png', 'gerenciar-cidades'],
  ['01-cadastros/tipos-validade.png', 'gerenciar-tipos-validade'],
  ['02-equipamentos/equipamentos.png', 'gerenciar-equipamentos'],
  ['02-equipamentos/marcas.png', 'gerenciar-marcas'],
  ['02-equipamentos/tipos-equipamento.png', 'gerenciar-tipos-equipamento'],
  ['02-equipamentos/modelos.png', 'gerenciar-modelos-equipamento'],
  ['02-equipamentos/grupos.png', 'gerenciar-grupos'],
  ['02-equipamentos/classes-frota.png', 'gerenciar-classes-frota'],
  ['03-logistica/viagens.png', 'gerenciar-viagens'],
  ['03-logistica/tipos-viagem.png', 'gerenciar-tipos-viagem'],
  ['03-logistica/situacoes-viagem.png', 'gerenciar-situacoes-viagem'],
  ['03-logistica/roteiros.png', 'gerenciar-roteiros'],
  ['03-logistica/tipo-ocorrencia.png', 'gerenciar-tipo-ocorrencia'],
  ['03-logistica/campanhas-oportunidades.png', 'campanhas-oportunidades'],
  ['04-gestao/relatorio-convocacoes.png', 'relatorio-convocacoes'],
  ['04-gestao/alertas.png', 'alertas'],
  ['04-gestao/chat.png', 'chat'],
  ['04-gestao/sos.png', 'sos'],
  ['04-gestao/ranking.png', 'ranking'],
  ['04-gestao/mapa-viagem.png', 'gerenciar-mapa-viagem'],
  ['04-gestao/logs-acesso.png', 'gerenciar-logs-acesso'],
  ['05-wms/painel-estoque.png', 'estoque'],
  ['05-wms/cadastros-wms.png', 'estoque-cadastros-wms'],
  ['05-wms/recebimento.png', 'estoque-recebimento'],
  ['05-wms/separacao.png', 'estoque-separacao'],
  ['05-wms/cargas.png', 'estoque-cargas'],
  ['05-wms/expedicao.png', 'estoque-expedicao'],
  ['05-wms/baixas.png', 'estoque-baixas'],
  ['05-wms/relatorios.png', 'estoque-relatorios'],
  ['05-wms/inventario.png', 'estoque-inventario'],
  ['05-wms/transferencias.png', 'estoque-transferencias'],
  ['05-wms/valor-estoque.png', 'estoque-valor'],
  ['05-wms/cobranca-wms.png', 'estoque-cobranca'],
  ['06-sistema/usuarios.png', 'gerenciar-usuarios'],
  ['06-sistema/tipos-atividade.png', 'gerenciar-tipos-atividade'],
  ['06-sistema/empresas.png', 'gerenciar-empresas'],
  ['06-sistema/filiais.png', 'gerenciar-filiais'],
  ['06-sistema/configuracoes.png', 'gerenciar-configuracoes'],
  ['06-sistema/tenants-saas.png', 'gerenciar-tenants-saas'],
  ['06-sistema/disparo-whatsapp.png', 'gerenciar-disparo-whatsapp'],
  ['07-atlas-pay/atlas-pay.png', 'atlas-pay'],
];

const MOTORISTA_PAGES = [
  'dashboard',
  'convocacoes',
  'cargas',
  'viagens',
  'detalhes-viagem',
  'macros',
  'gps',
  'rastreamento',
  'enviar-posicao',
  'gps-visualizacao',
  'ajuda-gps',
  'chat',
  'chat-standalone',
  'sos',
  'comprovar-entrega',
  'perfil',
  'configuracoes',
  'configuracoes-notificacoes',
  'oportunidades-publicas',
  'eventos',
  'diagnostico',
];

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const captured = [];
  const failed = [];

  // --- públicas ---
  for (const [rel, url, opts] of PUBLIC) {
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      captured.push(await shot(page, rel, opts));
    } catch (e) {
      failed.push({ rel, err: e.message });
      console.error('FAIL', rel, e.message);
    }
  }

  // login claro já capturado; dark login
  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    const darkBtn = page.locator('button:has-text("Modo escuro"), [data-theme-toggle], #themeToggle, .theme-toggle').first();
    if (await darkBtn.count()) {
      await darkBtn.click();
      await page.waitForTimeout(500);
      captured.push(await shot(page, '00-publico/login-torre-escuro.png', { fullPage: true }));
    }
  } catch (e) {
    failed.push({ rel: 'login-escuro', err: e.message });
  }

  // --- login torre ---
  let token;
  try {
    token = await loginTorre(page);
    captured.push(await shot(page, '00-publico/dashboard-shell.png', { fullPage: false }));
  } catch (e) {
    console.error('Login falhou:', e.message);
    failed.push({ rel: 'login', err: e.message });
    await browser.close();
    writeManifest(captured, failed);
    process.exit(1);
  }

  // mobile viewport login
  try {
    const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mp = await mobile.newPage();
    await mp.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    await mp.screenshot({ path: path.join(OUT, '00-publico/login-torre-mobile.png'), fullPage: true });
    console.log('OK 00-publico/login-torre-mobile.png');
    captured.push('00-publico/login-torre-mobile.png');
    await mp.goto(`${BASE}/motorista/index.html`, { waitUntil: 'networkidle' });
    await mp.screenshot({ path: path.join(OUT, '08-motorista/login-motorista-mobile.png'), fullPage: true });
    console.log('OK 08-motorista/login-motorista-mobile.png');
    captured.push('08-motorista/login-motorista-mobile.png');
    await mobile.close();
  } catch (e) {
    failed.push({ rel: 'mobile', err: e.message });
  }

  // --- módulos autenticados ---
  const modPage = await context.newPage();
  await withAuth(modPage, token);

  for (const [rel, prog] of MODULES) {
    try {
      await modPage.goto(`${BASE}/modulos/${prog}/index.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await modPage.waitForTimeout(1200);
      captured.push(await shot(modPage, rel, { fullPage: false }));

      // abas principais (até 4)
      const tabs = modPage.locator('.tabs .tab-btn, .tab-btn, button.tab, .nav-tabs button, [role="tab"]');
      const n = Math.min(await tabs.count(), 4);
      for (let i = 0; i < n; i++) {
        try {
          const t = tabs.nth(i);
          const label = ((await t.innerText()) || `aba${i}`).trim().slice(0, 40).replace(/[^\w\-]+/g, '_');
          await t.click();
          await modPage.waitForTimeout(600);
          const tabRel = rel.replace('.png', `-aba-${i}-${label || 'x'}.png`);
          captured.push(await shot(modPage, tabRel, { fullPage: false }));
        } catch (_) {
          /* aba opcional */
        }
      }
    } catch (e) {
      failed.push({ rel, err: e.message });
      console.error('FAIL', rel, e.message);
    }
  }

  // Atlas Pay dark (já costuma ser dark) + Configurações dark se toggle
  try {
    await modPage.goto(`${BASE}/modulos/atlas-pay/index.html`, { waitUntil: 'domcontentloaded' });
    await modPage.waitForTimeout(1000);
    captured.push(await shot(modPage, '07-atlas-pay/atlas-pay-visao-geral.png', { fullPage: false }));
  } catch (e) {
    failed.push({ rel: 'atlas-pay-vg', err: e.message });
  }

  // motorista pages (sem login motorista — captura UI pública/redirect)
  for (const name of MOTORISTA_PAGES) {
    const rel = `08-motorista/${name}.png`;
    try {
      await page.goto(`${BASE}/motorista/pages/${name}.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(700);
      captured.push(await shot(page, rel, { fullPage: false }));
    } catch (e) {
      failed.push({ rel, err: e.message });
      console.error('FAIL', rel, e.message);
    }
  }

  await browser.close();
  writeManifest(captured, failed);
  console.log(`\nCapturas: ${captured.length} ok / ${failed.length} fail`);
}

function writeManifest(captured, failed) {
  const manifest = {
    gerado_em: new Date().toISOString(),
    base: BASE,
    captured,
    failed,
  };
  fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
