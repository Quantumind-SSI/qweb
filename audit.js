const { chromium } = require('playwright');
const fs = require('fs');

const pages = fs.readdirSync('.').filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));

function rgbToLum(r, g, b) {
  const c = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function parseColor(s) {
  if (!s || s === 'transparent') return null;
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const n = parseInt(h, 16);
    return [n >> 16 & 255, n >> 8 & 255, n & 255];
  }
  const m = s.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (m) return [parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])];
  return null;
}
function contrast(a, b) {
  const la = rgbToLum(...a), lb = rgbToLum(...b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const vp of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const consoleErrors = [];
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', e => consoleErrors.push('PAGEERROR: ' + e.message));

    for (const p of pages) {
      try {
        await page.goto(`http://localhost:${process.env.PORT || 8080}/${p}`, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(250);
        const r = await page.evaluate(({ consoleErrors }) => {
          const vw = document.documentElement.clientWidth;
          const issues = [];

          // horizontal overflow
          if (document.documentElement.scrollWidth > vw + 1) {
            issues.push(`HORIZONTAL OVERFLOW: doc ${document.documentElement.scrollWidth}px > viewport ${vw}px`);
          }
          // elements beyond right edge
          const offenders = [];
          document.querySelectorAll('main *').forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.right > vw + 2 && rect.width > 1 && getComputedStyle(el).position !== 'fixed') {
              offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(rect.right)}`);
            }
          });
          if (offenders.length) issues.push('OFFSCREEN (main): ' + [...new Set(offenders)].slice(0, 6).join(', '));

          // broken images
          const broken = [];
          document.querySelectorAll('img').forEach(img => {
            if (img.complete && img.naturalWidth === 0) broken.push(img.getAttribute('src'));
          });
          if (broken.length) issues.push('BROKEN IMAGES: ' + [...new Set(broken)].join(', '));

          // zero-size elements in main (invisible content)
          const zeros = [];
          document.querySelectorAll('main *').forEach(el => {
            const rect = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            if (rect.width < 1 && rect.height < 1 && el.textContent.trim().length > 1 && cs.visibility !== 'hidden' && cs.display !== 'none') {
              zeros.push(el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
            }
          });
          if (zeros.length) issues.push('ZERO-SIZE ELEMENTS: ' + [...new Set(zeros)].slice(0, 8).join(', '));

          // clipped text (scrollWidth > clientWidth) in main
          const clipped = [];
          document.querySelectorAll('main h1, main h2, main h3, main a, main button, main .kicker, main .eyebrow').forEach(el => {
            if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 10) {
              clipped.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().slice(0, 30)}"`);
            }
          });
          if (clipped.length) issues.push('CLIPPED TEXT: ' + clipped.slice(0, 6).join(', '));

          // HUD overlap: body padding should be >= hud rail width
          const hudRail = document.querySelector('.hud__rail--left');
          if (hudRail) {
            const railW = hudRail.getBoundingClientRect().width;
            const bodyPad = parseFloat(getComputedStyle(document.body).paddingLeft);
            if (bodyPad < railW - 1) issues.push(`HUD RAIL ${Math.round(railW)}px vs body pad ${bodyPad}px`);
          }

          // fixed elements covering interactive content at top
          const nav = document.querySelector('.site-header');
          if (nav) {
            const navRect = nav.getBoundingClientRect();
            document.querySelectorAll('main a, main button').forEach(el => {
              const rect = el.getBoundingClientRect();
              if (rect.top < navRect.bottom && rect.bottom > navRect.top) {
                // interactive under nav at scroll 0 is only an issue if it overlaps
              }
            });
          }

          // fonts actually loaded?
          const bodyFont = getComputedStyle(document.body).fontFamily;
          const monoEl = document.querySelector('.hud__readout') || document.querySelector('body');
          const monoFont = getComputedStyle(monoEl).fontFamily;

          // tokens resolving?
          const token = getComputedStyle(document.documentElement).getPropertyValue('--bg-void').trim();

          // missing alt
          const noAlt = [...document.querySelectorAll('main img')].filter(i => !i.hasAttribute('alt')).length;

          // page height
          const h = document.documentElement.scrollHeight;

          // empty sections
          const emptySections = [];
          document.querySelectorAll('main section, main .section').forEach(s => {
            if (!s.textContent.trim()) emptySections.push(String(s.className).split(' ')[0]);
          });

          return {
            issues,
            pageHeight: h,
            bodyFont: bodyFont.slice(0, 40),
            monoFont: monoFont.slice(0, 40),
            bgToken: token,
            noAlt,
            consoleErrors,
            emptySections,
            h1: document.querySelector('main h1, .page-header h1')?.textContent.trim().slice(0, 60) || 'MISSING',
          };
        }, { consoleErrors });

        results.push({ page: p, vp: vp.name, ...r, consoleErrors });
      } catch (e) {
        results.push({ page: p, vp: vp.name, error: e.message.split('\n')[0] });
      }
    }
    await ctx.close();
  }

  // contrast audit from tokens.css values (fg on bg)
  const tokensCss = fs.readFileSync('css/tokens.css', 'utf8');
  const tokenVals = {};
  const re = /--([\w-]+):\s*([^;]+);/g;
  let m;
  while ((m = re.exec(tokensCss))) tokenVals[m[1].trim()] = m[2].trim();
  const pairs = [
    ['text-primary', 'bg-void'], ['text-primary', 'bg-base'], ['text-primary', 'surface-1'], ['text-primary', 'surface-2'],
    ['text-secondary', 'bg-void'], ['text-secondary', 'bg-base'], ['text-muted', 'bg-void'], ['text-muted', 'bg-base'],
    ['text-faint', 'bg-base'], ['accent', 'bg-void'], ['accent-bright', 'bg-void'],
    ['text-inverse', 'accent'], ['signal-ok', 'bg-base'],
  ];
  const contrasts = [];
  for (const [fg, bg] of pairs) {
    const c1 = parseColor(tokenVals[fg] || (fg === 'accent' ? tokenVals.accent : null));
    const c2 = parseColor(tokenVals[bg]);
    if (c1 && c2) {
      const ratio = contrast(c1, c2);
      const pass = fg === 'text-faint' ? ratio >= 3 : ratio >= 4.5;
      contrasts.push(`${fg} on ${bg}: ${ratio.toFixed(2)}:1 ${pass ? 'PASS' : 'FAIL'}`);
    }
  }

  fs.writeFileSync('/tmp/qweb-audit.json', JSON.stringify(results, null, 2));

  // summary print
  const byPage = {};
  results.forEach(r => { (byPage[r.page] = byPage[r.page] || []).push(r); });
  console.log('=== CONTRAST ===');
  contrasts.forEach(c => console.log(c));
  console.log('\n=== ISSUES ===');
  Object.keys(byPage).forEach(p => {
    byPage[p].forEach(r => {
      const tags = [];
      if (r.error) tags.push('ERROR ' + r.error);
      r.issues?.forEach(i => tags.push(i));
      if (r.noAlt) tags.push(`${r.noAlt} imgs missing alt`);
      if (r.emptySections?.length) tags.push('empty sections: ' + r.emptySections.join(','));
      if (r.h1 === 'MISSING') tags.push('NO H1');
      if (r.consoleErrors?.length) tags.push(`console errors: ${r.consoleErrors.length}`);
      if (tags.length) console.log(`[${p} ${r.vp}] ${tags.join(' | ')}`);
      else console.log(`[${p} ${r.vp}] OK height=${r.pageHeight}`);
    });
  });
  await browser.close();
})();