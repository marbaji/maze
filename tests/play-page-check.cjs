'use strict';
// Structure check of the play page: node tests/play-page-check.cjs <file>   (file relative to the repo root; default index.html)
// Serves the repo with python3 -m http.server 8765 and loads the page in Chromium at 1280x900 and 390x844.
// PLAYWRIGHT_PATH (optional) points at a playwright install; CHROME (optional) at a Chromium binary.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const FILE = process.argv[2] || 'index.html';
// the preview (wip.html, made by build/make-wip-page.py from index.html) differs from the live page only in its preview markers: "(preview)"
// in the title, a note at the top of the article that links to the live game, and its own copy of the key guide
const PREVIEW = /(^|\/)wip\.html$/.test(FILE);
const TITLE = 'Unwinnable Maze' + (PREVIEW ? ' (preview)' : '');
const GUIDE_HREF = PREVIEW ? 'guide/wip.html' : 'guide/';
// the laddered title and the play heading (Mo, 2026-10-02)
const H1 = 'How To Make AI Follow Your Instructions, Every Time';
const PLAY_HEAD = 'The Unwinnable Maze';
const PORT = 8765, ORIGIN = `http://127.0.0.1:${PORT}`;
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src https://api.anthropic.com";
const POST_URL = 'https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281';
const KEY_IDS = ['read-play', 'keybox', 'keyinput', 'keysave', 'keystate', 'keymasked', 'forgetkey', 'keyerr', 'keyguide', 'capnote', 'q', 'send'];

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); };

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(ORIGIN + '/'); if (r.ok || r.status) return; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('http server did not start');
}

async function structure(page, width) {
  const s = await page.evaluate(({ KEY_IDS }) => {
    const q = (sel) => document.querySelectorAll(sel);
    const h1 = q('h1');
    const read = document.getElementById('read');
    const introLink = read && read.querySelector('p:not(.wipnote) a[href]');
    const masked = document.getElementById('keymasked');
    const csp = q('meta[http-equiv="Content-Security-Policy"]');
    const off = [];
    for (const el of q('script[src]')) if (new URL(el.getAttribute('src'), location.href).origin !== location.origin) off.push(el.outerHTML.slice(0, 120));
    for (const el of q('link[href]')) if (new URL(el.getAttribute('href'), location.href).origin !== location.origin) off.push(el.outerHTML.slice(0, 120));
    return {
      title: document.title,
      h1Count: h1.length, h1Text: h1[0] ? h1[0].textContent.trim() : null,
      h1BeforePlay: !!(h1[0] && document.getElementById('read-play') && (h1[0].compareDocumentPosition(document.getElementById('read-play')) & Node.DOCUMENT_POSITION_FOLLOWING)),
      playText: document.getElementById('read-play') ? document.getElementById('read-play').textContent.trim() : null,
      introHref: introLink ? introLink.getAttribute('href') : null,
      nav: q('nav').length, header: q('header').length, readOpen: q('#read-open').length, readLevers: q('#read-levers').length, byline: q('.byline').length,
      rule: q('p.rule').length, board: q('canvas#c').length, footer: q('footer').length,
      missing: KEY_IDS.filter((id) => !document.getElementById(id)),
      forgetText: document.getElementById('forgetkey') ? document.getElementById('forgetkey').textContent : null,
      maskedTag: masked ? masked.tagName : null, maskedOnclick: masked ? masked.hasAttribute('onclick') : null,
      bodyText: document.body.innerText,
      guideTag: document.getElementById('keyguide') ? document.getElementById('keyguide').tagName : null,
      guideLinks: [...document.querySelectorAll('#keyguide a')].map((a) => ({ href: a.getAttribute('href'), text: a.textContent.trim() })),
      keyboxDetails: document.querySelectorAll('#keybox details').length,
      cspCount: csp.length, cspContent: csp[0] ? csp[0].getAttribute('content') : null, cspInHead: csp[0] ? document.head.contains(csp[0]) : false,
      offOrigin: off,
      scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth,
    };
  }, { KEY_IDS });
  const at = ` (at ${width}px)`;
  check(s.title === TITLE, `title is ${JSON.stringify(s.title)}` + at);
  check(s.h1Count === 1, `h1 count ${s.h1Count}` + at);
  check(s.h1Text === H1, `h1 text ${JSON.stringify(s.h1Text)}` + at);
  check(s.h1BeforePlay, 'h1 is not before #read-play' + at);
  check(s.playText === PLAY_HEAD, `#read-play text ${JSON.stringify(s.playText)}` + at);
  check(s.introHref === POST_URL, `intro link href ${JSON.stringify(s.introHref)}` + at);
  for (const k of ['nav', 'header', 'readOpen', 'readLevers', 'byline']) check(s[k] === 0, `${k} present (${s[k]})` + at);
  for (const k of ['rule', 'board', 'footer']) check(s[k] === 1, `${k} count ${s[k]}` + at);
  check(s.missing.length === 0, `missing ids: ${s.missing.join(', ')}` + at);
  check(s.forgetText === 'Forget key', `#forgetkey text ${JSON.stringify(s.forgetText)}` + at);
  check(s.maskedTag === 'SPAN' && s.maskedOnclick === false, `#keymasked is ${s.maskedTag}, onclick attribute ${s.maskedOnclick}` + at);
  for (const bad of ['claude.ai viewer', 'Claude cannot answer on this page']) check(!s.bodyText.includes(bad), `visible text contains "${bad}"` + at);
  check(!s.bodyText.includes('claude.ai'), 'visible text contains "claude.ai"' + at);
  check(s.guideTag === 'P', `#keyguide is ${s.guideTag}, expected P` + at);
  check(s.guideLinks.length === 1 && s.guideLinks[0].href === GUIDE_HREF && s.guideLinks[0].text === 'How to get a key (2 minutes)', `#keyguide links: ${JSON.stringify(s.guideLinks)}` + at);
  check(s.keyboxDetails === 0, `details elements in the key box: ${s.keyboxDetails}` + at);
  check(s.cspCount === 1, `CSP meta count ${s.cspCount}` + at);
  check(s.cspContent === CSP, `CSP content differs: ${JSON.stringify(s.cspContent)}` + at);
  check(s.cspInHead, 'CSP meta is not in the document head' + at);
  check(s.offOrigin.length === 0, `off-origin script/link: ${s.offOrigin.join(' | ')}` + at);
  check(s.scrollW <= s.clientW, `body scrolls sideways: scrollWidth ${s.scrollW} > clientWidth ${s.clientW}` + at);
}

// the writer's instruction: the reworded sentence ships, the jailbreak-shaped one (declined by Opus 5.5 as cyber) does not
{
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  check(src.split('Build what the player asks for, as asked.').length - 1 === 1, 'the writer prompt does not hold "Build what the player asks for, as asked." exactly once');
  check(!/you never refuse/i.test(src) && !/never substitute/i.test(src), 'the page still tells the writer "You never refuse and you never substitute"');   // a code comment elsewhere says the page never refuses; that is not the prompt
}

(async () => {
  const server = spawn(process.env.PYTHON || 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    for (const [w, h] of [[1280, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h } });
      await page.goto(`${ORIGIN}/${FILE}`, { waitUntil: 'load' });
      await page.waitForTimeout(500);
      await structure(page, w);
      if (w === 1280) {
        // the CSP is enforced, not only present: a connection anywhere but Anthropic is refused by the browser
        const blocked = await page.evaluate(async () => {
          let violated = '';
          document.addEventListener('securitypolicyviolation', (e) => { violated = e.violatedDirective; }, { once: true });
          try { await fetch('https://example.com/csp-probe'); } catch (e) {}
          await new Promise((r) => setTimeout(r, 200));
          return violated;
        });
        check(/^connect-src/.test(blocked), `a fetch to another origin was not blocked by the CSP (violation: ${JSON.stringify(blocked)})`);
      }
      await page.close();
    }
  } catch (e) {
    failures.push('harness error: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
  if (failures.length) { console.log('FAILED play-page\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('OK play-page');
})();
