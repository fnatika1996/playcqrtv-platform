import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('docs/admin-concepts');
const artifactDir = path.resolve('qa-artifacts/admin-concepts');
await mkdir(artifactDir,{ recursive:true });
const playwrightPackage = process.env.PLAYWRIGHT_PACKAGE;
if (!playwrightPackage) throw new Error('Set PLAYWRIGHT_PACKAGE to an isolated Playwright installation.');
const { chromium } = await import(pathToFileURL(path.join(playwrightPackage, 'index.mjs')).href);
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.svg':'image/svg+xml' };

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const rel = path.relative(root, file);
    assert(rel && !rel.startsWith('..') && !path.isAbsolute(rel), 'Path escaped preview root.');
    const info = await stat(file);
    assert(info.isFile(), 'Requested preview asset is not a file.');
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'x-content-type-options':'nosniff', 'cache-control':'no-store' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { 'content-type':'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
try {
  const contexts = [
    { name:'desktop', viewport:{ width:1440, height:1000 }, media:'desktop' },
    { name:'mobile', viewport:{ width:390, height:844 }, media:'mobile' }
  ];
  const directions = ['a','b','c'];
  const views = ['dashboard','users','site','login'];
  const page = await browser.newPage();
  page.on('pageerror', error => { throw error; });
  for (const context of contexts) for (const direction of directions) for (const view of views) {
    await page.setViewportSize(context.viewport);
    const target = `http://127.0.0.1:${port}/?direction=${direction}&view=${view}&viewport=${context.media}`;
    await page.goto(target, { waitUntil:'domcontentloaded' });
    await page.locator('#icon-grid .icon-sample').nth(0).waitFor({ state:'attached' });
    await page.waitForFunction(() => document.querySelectorAll('#icon-grid svg').length === 20 && document.querySelectorAll('#state-board svg').length === 49);
    await page.waitForFunction(() => document.querySelectorAll('#preview [data-ui-icon]').length === 0);
    await page.waitForFunction(() => Array.from(document.images).every(image=>image.complete));
    const checks = await page.evaluate(() => ({
      direction:document.querySelector('#preview').dataset.direction,
      view:document.querySelector('#preview').dataset.view,
      viewport:document.querySelector('#preview').dataset.viewport,
      broken:Array.from(document.images).filter(image => !image.complete || !image.naturalWidth).map(image=>image.src),
      unresolvedUiIcons:document.querySelectorAll('#preview [data-ui-icon]').length,
      duotoneUiIcon:Array.from(document.querySelectorAll('#preview .cq-icon-svg')).some(svg=>new Set(Array.from(svg.querySelectorAll('*')).map(node=>getComputedStyle(node).fill)).size>1),
      previewWidth:document.querySelector('#preview').clientWidth,
      previewScrollWidth:document.querySelector('#preview').scrollWidth,
      bodyWidth:document.body.scrollWidth,
      viewportWidth:innerWidth,
      fakeKpis:Array.from(document.querySelectorAll('.metric strong')).some(node => node.textContent.trim() !== '—')
    }));
    assert.equal(checks.direction,direction,`Wrong concept for ${direction}/${view}/${context.name}`);
    assert.equal(checks.view,view,`Wrong view for ${direction}/${view}/${context.name}`);
    assert.equal(checks.viewport,context.media,`Wrong viewport mode for ${direction}/${view}/${context.name}`);
    assert.deepEqual(checks.broken,[],`Broken icon image at ${direction}/${view}/${context.name}`);
    assert.equal(checks.unresolvedUiIcons,0,`Unresolved CQRTV pack icon at ${direction}/${view}/${context.name}`);
    assert.equal(checks.duotoneUiIcon,true,`Concept did not display two icon color roles at ${direction}/${view}/${context.name}`);
    assert(checks.previewScrollWidth <= checks.previewWidth,`Horizontal overflow inside preview at ${direction}/${view}/${context.name}`);
    assert(checks.bodyWidth <= checks.viewportWidth,`Horizontal page overflow at ${direction}/${view}/${context.name}`);
    assert.equal(checks.fakeKpis,false,'KPI value must not contain mock data.');
    const output = path.join(artifactDir, `${direction}-${view}-${context.name}.png`);
    await page.locator('#preview').screenshot({ path:output, animations:'disabled' });
    console.log(`PASS ${direction}/${view}/${context.name} (${checks.previewWidth}px, no horizontal overflow, icons loaded)`);
  }
  const audit = await browser.newPage({ viewport:{ width:1440, height:1100 } });
  await audit.goto(`http://127.0.0.1:${port}/`,{ waitUntil:'domcontentloaded' });
  await audit.locator('#state-board svg').nth(48).waitFor({ state:'attached' });
  await audit.locator('#icon-audit').screenshot({ path:path.join(artifactDir,'icon-audit-dark.png'), animations:'disabled' });
  await audit.locator('#toggle-light').click();
  await audit.locator('#icon-audit').screenshot({ path:path.join(artifactDir,'icon-audit-light.png'), animations:'disabled' });
  console.log('PASS icon specimen: 20 archive icons, 7 visual states, dark and light surfaces');
  await audit.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
