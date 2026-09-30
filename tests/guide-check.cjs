'use strict';
// The picture guide to getting a key: node tests/guide-check.cjs
// Serves the repo with python3 -m http.server 8765 and loads guide/ in Chromium at 1280x900 and 390x844, light and dark.
// PLAYWRIGHT_PATH (optional) points at a playwright install; CHROME (optional) at a Chromium binary.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765, ORIGIN = `http://127.0.0.1:${PORT}`;
const GUIDE = `${ORIGIN}/guide/`;

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

const STEP2 = 'If it asks you to buy usage credits, the smallest amount of $5 is plenty, or choose Other and type $2-3. Leave Auto-reload off.';

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(ORIGIN + '/'); if (r.ok || r.status) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('http server did not start');
}

(async () => {
  const server = spawn(process.env.PYTHON || 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

    for (const scheme of ['light', 'dark']) {
      for (const [w, h] of [[1280, 900], [390, 844]]) {
        const at = ` (at ${w}px, ${scheme})`;
        const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme });
        const errors = [], external = [], imgStatus = {};
        // the browser asks for /favicon.ico on its own and the site has none: that one 404 is the only console error excused
        page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text() + ' ' + (m.location().url || '')); });
        page.on('pageerror', (e) => errors.push(String(e)));
        page.on('request', (r) => { if (!r.url().startsWith(ORIGIN)) external.push(r.url()); });
        page.on('response', (r) => { if (/\/guide\/img\//.test(r.url())) imgStatus[r.url()] = r.status(); });
        const resp = await page.goto(GUIDE, { waitUntil: 'load' });
        check(resp && resp.status() === 200, `guide/ answered ${resp && resp.status()}` + at);
        await page.waitForTimeout(300);
        const s = await page.evaluate(() => {
          const imgs = [...document.querySelectorAll('img')];
          return {
            title: document.title,
            h1: document.querySelectorAll('h1').length,
            imgs: imgs.map((i) => ({ src: i.currentSrc, alt: (i.getAttribute('alt') || '').trim(), ok: i.complete && i.naturalWidth > 0, w: i.getAttribute('width'), h: i.getAttribute('height'), shown: i.getBoundingClientRect().width })),
            steps: [...document.querySelectorAll('ol.steps > li .step')].map((p) => p.innerText.replace(/\s+/g, ' ').trim()),
            stepsWithImg: [...document.querySelectorAll('ol.steps > li')].filter((li) => li.querySelector('img')).length,
            back: [...document.querySelectorAll('a[href="../#read-play"]')].map((a) => a.innerText.trim()),
            text: document.body.innerText,
            html: document.documentElement.outerHTML,
            scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
            bg: getComputedStyle(document.body).backgroundColor,
          };
        });
        check(s.title === 'Get a key for the maze', `title ${JSON.stringify(s.title)}` + at);
        check(s.h1 === 1, `h1 count ${s.h1}` + at);
        check(s.imgs.length === 5, `img count ${s.imgs.length}` + at);
        check(s.stepsWithImg === 5, `steps with a picture: ${s.stepsWithImg}` + at);
        for (const i of s.imgs) {
          check(i.alt.length > 0, `img without alt: ${i.src}` + at);
          check(i.ok, `img did not load: ${i.src}` + at);
          check(imgStatus[i.src] === 200, `img ${i.src} answered ${imgStatus[i.src]}` + at);
          check(i.w && i.h, `img without width/height attributes: ${i.src}` + at);
          check(i.shown <= s.clientW, `img wider than the viewport: ${i.src} ${i.shown}px` + at);
        }
        check(s.steps.length === 5, `guide has ${s.steps.length} steps` + at);
        check(s.steps[1] === STEP2, `step 2 ${JSON.stringify(s.steps[1])}` + at);
        check(s.text.includes('between 5 and 20 cents'), 'intro lacks "between 5 and 20 cents"' + at);
        check(s.text.includes("All the code runs on the game's page, so you can read it with your browser's View Source"), 'closing paragraph wording' + at);
        check(s.back.includes('Back to the maze'), `no "Back to the maze" link to ../#read-play` + at);
        check(!s.html.includes('\u2014'), 'the guide contains an em dash' + at);
        check(s.text.includes('Forget key') && s.text.includes('View Source'), 'closing paragraph missing' + at);
        check(s.scrollW <= s.clientW, `page scrolls sideways: scrollWidth ${s.scrollW} > clientWidth ${s.clientW}` + at);
        check(s.bg === (scheme === 'dark' ? 'rgb(20, 24, 28)' : 'rgb(238, 241, 243)'), `body background ${s.bg} for ${scheme}` + at);
        check(errors.length === 0, `console errors: ${errors.join(' | ')}` + at);
        check(external.length === 0, `external requests: ${external.join(' | ')}` + at);
        await page.close();
      }
    }

    // the game page links to the guide from its key box
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${ORIGIN}/index.html`, { waitUntil: 'load' });
    const link = await page.evaluate(() => {
      const a = [...document.querySelectorAll('#keyguide a')].find((x) => x.getAttribute('href') === 'guide/');
      return a ? { text: a.textContent.trim(), href: a.href } : null;
    });
    check(link && link.text === 'How to get a key (2 minutes)', `game key box link to guide/: ${JSON.stringify(link)}`);
    if (link) { const r = await page.request.get(link.href); check(r.status() === 200, `game's guide link ${link.href} answered ${r.status()}`); }
    await page.close();
  } catch (e) {
    failures.push('harness error: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  if (failures.length) { console.log('FAILED guide\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('OK guide');
})();
