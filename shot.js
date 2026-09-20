const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const pages = fs.readdirSync('.').filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));

(async () => {
  const browser = await chromium.launch();
  const outDir = '/tmp/qweb-shots';
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const viewports = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ];

  for (const vp of viewports) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    page.on('pageerror', err => console.log(`[${vp.name}] PAGE ERROR on a page:`, err.message));
    for (const p of pages) {
      try {
        await page.goto(`http://localhost:${process.env.PORT || 8080}/${p}`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(outDir, `${vp.name}-${p}.png`),
          fullPage: true,
        });
      } catch (e) {
        console.log(`FAIL ${vp.name} ${p}: ${e.message.split('\n')[0]}`);
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log('done');
})();