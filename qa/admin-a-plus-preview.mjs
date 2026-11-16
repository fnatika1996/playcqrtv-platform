import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { once } from 'node:events';

const root = process.cwd();
const site = join(root, 'docs', 'admin-a-plus');
const output = join(site, 'qa', 'output');
await mkdir(output, { recursive: true });
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png' };
const server = createServer((req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/docs/admin-a-plus/index.html';
  const target = normalize(join(root, pathname));
  if (!target.startsWith(root) || !target.startsWith(site)) { res.writeHead(403).end(); return; }
  res.setHeader('content-type', mime[extname(target)] || 'application/octet-stream');
  createReadStream(target).on('error', () => { res.writeHead(404).end(); }).pipe(res);
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}/docs/admin-a-plus/`;
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => failures.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') failures.push(`console: ${message.text()}`); });
  const apiCalls = [];
  page.on('request', request => { if (/\/api\/|graphql|auth\/login/i.test(request.url())) apiCalls.push(request.url()); });
  for (const [screen, label] of [['dashboard','dashboard'],['users','users'],['site','site'],['login','admin-login']]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}?view=${screen}&viewport=desktop`, { waitUntil: 'networkidle' });
    await page.locator('#app').screenshot({ path: join(output, `${label}-desktop-1440.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}?view=${screen}&viewport=mobile`, { waitUntil: 'networkidle' });
    await page.locator('#app').screenshot({ path: join(output, `${label}-mobile-390.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}?view=icons&viewport=desktop`, { waitUntil: 'networkidle' });
  await page.locator('#icon-proof').screenshot({ path: join(output, 'icons-before-after-dark.png') });
  await page.getByRole('button', { name: 'Проверить светлый фон' }).click();
  await page.locator('#icon-proof').screenshot({ path: join(output, 'icons-before-after-light.png') });

  await page.goto(`${base}?view=users&viewport=desktop`, { waitUntil: 'networkidle' });
  await page.locator('#user-search').fill('test-user-02@example.invalid');
  if (await page.locator('[data-user-row]:visible,[data-user-card]:visible').count() !== 1) failures.push('user search did not isolate one demo record');
  await page.goto(`${base}?view=site&viewport=desktop`, { waitUntil: 'networkidle' });
  await page.getByRole('radio', { name: /Техработы/ }).check();
  if (!(await page.locator('#mode-description').textContent()).includes('локальное превью')) failures.push('site mode selector did not disclose local-only behavior');
  await page.goto(`${base}?view=login&viewport=desktop`, { waitUntil: 'networkidle' });
  const password = page.locator('#admin-password');
  await page.getByRole('button', { name: 'Показать пароль' }).click();
  if (await password.getAttribute('type') !== 'text') failures.push('password reveal control failed');
  await page.getByRole('button', { name: 'Скрыть пароль' }).click();
  if (await password.getAttribute('type') !== 'password') failures.push('password hide control failed');
  await page.locator('input[type=email]').fill('owner@example.invalid');
  await password.fill('demo-only');
  await page.getByRole('button', { name: /Войти в CQRTV Admin/ }).click();
  if (!(await page.locator('#toast').textContent()).includes('Авторизация не подключена')) failures.push('login form did not remain a demo action');
  if (apiCalls.length) failures.push(`preview made API/auth requests: ${apiCalls.join(', ')}`);
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('PASS: eight desktop/mobile screen captures, dark/light icon proof, local interactions, and zero API/auth requests.');
} finally {
  await browser.close();
  server.close();
}
