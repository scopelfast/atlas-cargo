import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:8083/index.html', { waitUntil: 'networkidle' });
try {
  await page.getByRole('button', { name: /modo escuro|dark/i }).click({ timeout: 4000 });
} catch {
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
}
await page.waitForTimeout(600);
await page.screenshot({
  path: 'screenshots/00-publico/login-torre-escuro.png',
  fullPage: true,
});
console.log('OK login-torre-escuro.png');
await browser.close();
