// pg-mobile-gate.js: mechanical backstop for the "no page-level horizontal
// scrolling, nothing clipped unreachable" mobile contract on the Proving Ground.
// Renders every bench overlay at a 390px phone viewport (headless Chromium,
// file:// URL) and fails the build if:
//   - any TABLE is wider than its own box (clipped columns, even inside an
//     inner-scroll wrapper: core content tables must fit), or
//   - any non-fixed element is wider than the 390px viewport, or
//   - the document itself scrolls horizontally.
// Usage: node pg-mobile-gate.js [benchN ...]  (no args = all benches)
// Exits 0 when clean, 1 with a violation report otherwise.
// Chrome must already listen on --remote-debugging-port=9336 (see build script).
const puppeteer = require('puppeteer-core');

const FAIL_ON = process.env.PG_GATE_FAIL ? process.env.PG_GATE_FAIL.split(',') : null;

(async () => {
  const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9336' });
  const page = await browser.newPage();
  await page.emulate({
    viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  await page.goto('file:///home/hatch/workspace/deploy/proving-ground/index.html', { waitUntil: 'load', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  const benches = await page.evaluate(() => (window.PG_BENCHES || []).map(b => b.n));
  if (!benches.length) { console.error('GATE: no PG_BENCHES found'); await browser.close(); process.exit(2); }
  const targets = process.argv.length > 2 ? process.argv.slice(2).map(Number) : benches;
  const violations = [];
  for (const n of targets) {
    await page.goto('file:///home/hatch/workspace/deploy/proving-ground/index.html#bench=' + n, { waitUntil: 'load', timeout: 60000 });
    await new Promise(r => setTimeout(r, 4000));
    const v = await page.evaluate((bn) => {
      const out = [];
      const open = document.querySelector('div[class*="-overlay"].open');
      if (!open) return [{ bench: bn, kind: 'no-overlay', detail: 'overlay did not open' }];
      document.querySelectorAll('table').forEach(t => {
        if (t.scrollWidth > t.clientWidth + 2 && t.clientWidth > 0)
          out.push({ bench: bn, kind: 'table-clipped', detail: (t.getAttribute('aria-label') || t.className || 'table').slice(0, 40) + ' ' + t.scrollWidth + 'px in ' + t.clientWidth + 'px box' });
      });
      const seen = new Set();
      document.querySelectorAll('*').forEach(el => {
        if (getComputedStyle(el).position === 'fixed') return;
        const w = el.getBoundingClientRect().width;
        if (w > 391 && w < 4000) {
          const key = el.tagName + '|' + String(el.className).slice(0, 30);
          if (!seen.has(key)) { seen.add(key); out.push({ bench: bn, kind: 'wide-element', detail: key + ' w=' + Math.round(w) }); }
        }
      });
      if (document.documentElement.scrollWidth > 390)
        out.push({ bench: bn, kind: 'doc-scroll', detail: 'document ' + document.documentElement.scrollWidth + 'px' });
      return out;
    }, n);
    violations.push(...v);
    process.stdout.write('.');
  }
  console.log('\nGATE: checked ' + targets.length + ' benches');
  await browser.close();
  const relevant = FAIL_ON ? violations.filter(v => FAIL_ON.includes(String(v.bench))) : violations;
  if (relevant.length) {
    console.log('GATE FAIL:');
    relevant.forEach(v => console.log('  bench ' + v.bench + ' [' + v.kind + '] ' + v.detail));
    process.exit(1);
  }
  console.log('GATE PASS');
})().catch(e => { console.error('GATE ERROR', e.message); process.exit(2); });
