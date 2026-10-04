'use strict';
// Behaviour tests of the play page, with no real key; ?mock only where a case says so.
//   node tests/play-behaviour.cjs [page]   (page relative to the repo root; default index.html, the live page; wip.html is the preview)
// Two transports: page.route() fulfils complete Anthropic answers; a small Node streaming server on 127.0.0.1:8766 holds a stream open
// (Stop, Forget, timeouts). The streaming cases load a TEST COPY of the page, with the adapter's API constant, the CSP connect-src and the
// judge timeout pointed at the test; the shipped page is never changed and has no URL override. The static server serves a temporary folder
// that links to the repo's files and holds the copy, so the harness never writes into the repo.
// PLAYWRIGHT_PATH (optional) points at a playwright install; CHROME (optional) at a Chromium binary; PYTHON (optional) at python3.
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const PAGE = process.argv[2] || 'index.html';
const PORT = 8765, ORIGIN = `http://127.0.0.1:${PORT}`;
const SPORT = 8766, SORIGIN = `http://127.0.0.1:${SPORT}`;
const API = 'https://api.anthropic.com/v1/messages', SAPI = `${SORIGIN}/v1/messages`;
const COPY = '.play-stream-copy.html';
const COPY_JUDGE_MS = 8000;   // a CI runner is slower than a laptop: Stop and Forget are given 3 s to act, well inside this
const KEY = 'sk-ant-api03-testQNoA', KEY2 = 'sk-ant-api03-testN3W1';   // fake, short: never a real key
// ---- constants the page itself holds, read from the page's source (the shipped text), so a test follows a reworded constant and still
// fails when the page stops using it. Each is a string literal or a + chain of them.
const SRC = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
const LIT = String.raw`(?:'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")`;
const evalLit = (s) => { if (!new RegExp(`^${LIT}(?:\\+${LIT})*$`).test(s)) throw new Error('not a string literal chain: ' + s.slice(0, 60)); return Function(`'use strict'; return (${s});`)(); };
// the value assigned to NAME (const NAME=... or , NAME=...), or null when the page has no such constant (a premise the caller checks)
function pageConst(name) {
  const found = [...SRC.matchAll(new RegExp(String.raw`(?:const |, ?)${name}=(${LIT}(?:\+${LIT})*)[,;]`, 'g'))];
  return found.length === 1 ? evalLit(found[0][1]) : null;
}
// the string literals captured by a pattern over the page source (each group a literal), or null when it does not match exactly once
function pageLits(re) {
  const found = [...SRC.matchAll(new RegExp(re.source.replace(/LIT/g, LIT), 'g'))];
  return found.length === 1 ? found[0].slice(1).map(evalLit) : null;
}
const ASK_MSG_HTML = pageConst('ASK_MSG');   // HTML (the repo address is a link); what a reader sees is its text, below
const asText = (page, h) => page.evaluate((h) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent.trim(); }, h);
const BAD_SHAPE = "This doesn't look like an Anthropic key. Anthropic keys start with sk-ant-.";
const T = {
  bad_key: 'Anthropic rejected this key. Check it was copied whole, or create a new one, then paste it again.',
  permission: "This key isn't allowed to use this model. Create a new key in the default workspace, then paste it again.",
  no_credit: 'Your Anthropic account has no credit left. Add credit at platform.claude.com/settings/billing, then ask again.',
};
const ERR = {
  bad_key: { status: 401, type: 'authentication_error', message: 'invalid x-api-key' },
  permission: { status: 403, type: 'permission_error', message: 'This key does not have permission to use the specified resource.' },
  no_credit: { status: 400, type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' },
};

// a small game the writer "sends": nothing raises keys, so goal() never holds and no reachable state wins
const PROGRAM = "const ACTIONS = ['up', 'down', 'left', 'right'];\nconst PELLETS0 = [];\nfunction init() { return { x: 0, y: 0, keys: 0 }; }\nfunction step(s, a) { const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[a]; const nx = s.x + d[0], ny = s.y + d[1]; if (nx < 0 || ny < 0 || nx > 4 || ny > 4) return null; return { ...s, x: nx, y: ny }; }\nfunction goal(s) { return s.keys >= 3; }\nfunction render(s) { const cells = []; cells[cells.length] = { x: 3, y: 3, k: 'door', color: '#8a5' }; cells[cells.length] = { x: s.x, y: s.y, k: 'player' }; return { w: 5, h: 5, cells, hud: 'keys ' + s.keys, goal: 'find three keys' }; }";
const WRITER_TEXT = 'SAY: Made a small five by five game with a door.\nWHY: Nothing ever raises the key count, so the goal never holds.\nPROGRAM:\n' + PROGRAM;
const JUDGE_TEXT = '{"winnable": false, "reason": "nothing raises the key count"}';
const GATE_TEXT = '{"apply": true, "say": "Applied as asked."}';

// ---- Anthropic's streaming format
const ev = (name, obj) => `event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`;
const sseStartAs = (model) => ev('message_start', { type: 'message_start', message: Object.assign({ id: 'msg_t', role: 'assistant', content: [] }, model ? { model } : {}) }) +
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
const sseStart = sseStartAs(null);
const sseDelta = (t) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const sseEnd = ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }) +
  ev('message_stop', { type: 'message_stop' });
const sse = (text, model) => sseStartAs(model) + sseDelta(text.slice(0, 20)) + sseDelta(text.slice(20)) + sseEnd;
const MODEL_LINE = /was answered by /;
const kindOf = (body) => { const c = (((body || {}).messages || [])[0] || {}).content || ''; return /You are a referee/.test(c) ? 'judge' : /ready-made change/.test(c) ? 'gate' : 'writer'; };
const OK_ANSWER = { writer: WRITER_TEXT, judge: JUDGE_TEXT, gate: GATE_TEXT };

const failures = [];
const check = (ok, what) => { if (!ok) failures.push(what); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what); await sleep(50); }
}

// ---- every request any page made, for case 9
const allRequests = [];
// ---- the Anthropic calls the route answered, and the calls the streaming server saw
let routed = [];
const stream = { reqs: [], plan: { writer: [], judge: [], gate: [] } };

function startStreamServer() {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access, anthropic-beta' };
  const srv = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = {}; try { body = JSON.parse(raw); } catch (e) {}
      const kind = kindOf(body), step = stream.plan[kind].shift() || { how: 'ok' };
      const rec = { kind, body, headers: req.headers, res, closed: false, ended: false };
      stream.reqs.push(rec);
      res.on('close', () => { rec.closed = true; });
      res.writeHead(200, Object.assign({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }, cors));
      if (step.how === 'ok') { res.end(sse(OK_ANSWER[kind])); rec.ended = true; return; }
      res.write(sseStart);
      if (step.how === 'hold') res.write(sseDelta(step.first || 'SAY: first words '));   // 'hang' sends no text at all
    });
  });
  return new Promise((r) => srv.listen(SPORT, '127.0.0.1', () => r(srv)));
}

function writeCopy() {
  let t = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
  const swap = (a, b) => { const n = t.split(a).length - 1; if (n !== 1) throw new Error(`test copy: ${JSON.stringify(a)} matched ${n} times`); t = t.replace(a, b); };
  swap(`const API = '${API}'`, `const API = '${SAPI}'`);
  swap('connect-src https://api.anthropic.com"', `connect-src ${SORIGIN}"`);
  swap('const JUDGE_MS=120000;', `const JUDGE_MS=${COPY_JUDGE_MS};`);
  fs.writeFileSync(path.join(SERVE, COPY), t);
}
// the folder the static server serves: a link to each top-level repo entry, plus the test copy
let SERVE = null;
function makeServeDir() {
  SERVE = fs.mkdtempSync(path.join(os.tmpdir(), 'maze-play-'));
  for (const name of fs.readdirSync(ROOT)) if (name !== '.git' && name !== COPY) fs.symlinkSync(path.join(ROOT, name), path.join(SERVE, name));
}

let browser;
async function open(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const file = opts.copy ? COPY : PAGE;
  const failed = [], consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/\/favicon\.ico$/.test(m.location().url || '')) consoleErrors.push(m.text()); });   // the static server has no favicon; nothing else may log an error
  page.on('pageerror', (e) => failures.push(`page error (${opts.name || file}): ${e.message}`));
  context.on('request', (r) => allRequests.push({ r, copy: !!opts.copy }));
  page.on('requestfailed', (r) => failed.push({ url: r.url(), error: (r.failure() || {}).errorText || '' }));
  if (!opts.copy) {
    await page.route(API, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST' } });
      let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch (e) {}
      const kind = kindOf(body), rec = { kind, body, headers: await req.allHeaders() };
      routed.push(rec);
      const a = (opts.answers && opts.answers[kind] && opts.answers[kind].shift()) || 'ok';
      const cors = { 'access-control-allow-origin': '*' };
      if (a === 'ok' || /^claude-/.test(a)) return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, cors), body: sse(OK_ANSWER[kind], a === 'ok' ? null : a) });   // a model id: message_start names it
      const e = ERR[a];
      return route.fulfill({ status: e.status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ type: 'error', error: { type: e.type, message: e.message } }) });
    });
  }
  await page.goto(`${ORIGIN}/${file}${opts.hash || ''}`, { waitUntil: 'load' });
  await ready(page);
  return { context, page, failed, consoleErrors };
}

// the page is ready once its opening check has finished: it clears the log, writes its start line and resets the switch
const ready = async (page) => {
  await until(() => page.evaluate(() => !!(window.MazeStatus && window.MazeStatus.ses)), 15000, 'the worker to report its SES state');
  await until(() => page.evaluate(() => /start: the original maze/.test(document.getElementById('log').textContent)), 20000, 'the opening check');
};
const state = (page) => page.evaluate(() => {
  const $ = (id) => document.getElementById(id);
  const ss = {}; try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); ss[k] = sessionStorage.getItem(k); } } catch (e) { ss.__throws = true; }
  const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = localStorage.getItem(k); }
  const drawn = (el) => !!el && el.getClientRects().length > 0;
  return {
    send: $('send').disabled, off: $('send').dataset.off || '', stop: $('stop').disabled,
    capnote: $('capnote').textContent.trim(), masked: $('keymasked').textContent, keystate: !$('keystate').hidden,
    inputRow: !$('keyinput').parentElement.hidden, keybox: !$('keybox').hidden && drawn($('keybox')), keyinput: $('keyinput').value,
    keyerr: $('keyerr').hidden ? '' : $('keyerr').textContent.trim(), card: $('card').innerText, log: $('log').innerText,
    ss, ls,
  };
});
const idle = (page) => until(() => page.evaluate(() => document.getElementById('stop').disabled && !document.getElementById('status').textContent), 30000, 'the request to end');
async function saveKey(page, k) { await page.fill('#keyinput', k); await page.click('#keysave'); }
async function setMode(page, name) {
  await page.click(`#seg button:has(span:text-is("${name}"))`);
  await until(() => page.evaluate((n) => { const b = [...document.querySelectorAll('#seg button.on span')]; return b.some((s) => s.textContent === n); }, name), 5000, 'mode ' + name + ' ' + JSON.stringify(await page.evaluate(() => document.getElementById('seg').outerHTML.slice(0, 600))));
}
async function ask(page, text) { await page.fill('#q', text); await page.click('#send'); }
async function canned(page, i = 0) { await page.click('#tabQuick'); await page.click(`#opts .opt >> nth=${i}`); }

// ---------------------------------------------------------------- cases
async function case1() {
  const { context, page, failed } = await open({ name: 'case 1' });
  check(typeof ASK_MSG_HTML === 'string', 'case 1: premise: the page has an ASK_MSG constant');
  const ASK_MSG = await asText(page, ASK_MSG_HTML || '');
  const fonts = [];
  page.on('response', (r) => { if (/\/fonts\//.test(r.url())) fonts.push({ url: r.url(), status: r.status() }); });
  const s = await state(page);
  check(s.send === true, 'case 1: Send is enabled with no key');
  check(s.capnote === ASK_MSG, `case 1: capnote is ${JSON.stringify(s.capnote)}`);
  const shown = (await page.evaluate(() => document.body.innerText)).split(ASK_MSG).length - 1;
  check(shown === 1, `case 1: the Ask-tab message is shown ${shown} times, want once`);
  const ses = await page.evaluate(() => window.MazeStatus.ses);
  check(/^on/.test(ses), `case 1: MazeStatus.ses is ${JSON.stringify(ses)}`);
  const loaded = await page.evaluate(async () => { const f = await document.fonts.load('16px "Patrick Hand"'); return { n: f.length, ok: document.fonts.check('16px "Patrick Hand"') }; });
  check(loaded.n > 0 && loaded.ok, `case 1: Patrick Hand did not load (${JSON.stringify(loaded)})`);
  await page.evaluate(() => document.fonts.ready);
  const fontResponses = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/fonts\//.test(e.name)).map((e) => ({ url: e.name, status: e.responseStatus })));
  check(fontResponses.some((f) => /\.woff2$/.test(f.url)), 'case 1: no font file was requested (premise)');
  for (const f of fontResponses.concat(fonts)) check(f.status === 200, `case 1: font request ${f.url} returned ${f.status}`);
  // the arrow key moves the player: pellets get eaten
  const eaten0 = await page.textContent('#eaten');
  await page.keyboard.press('ArrowLeft');
  await until(async () => Number(await page.textContent('#eaten')) > Number(eaten0), 5000, 'the player to eat a pellet after an arrow key');
  // the first canned change applies under Code (proof): the walled-in pellet is no longer out of reach
  check((await page.textContent('#unr')) === '1', 'case 1: premise: one pellet starts out of reach');
  await setMode(page, 'Code (proof)');
  await canned(page, 0);
  await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'the first canned change to finish');
  const log = await page.textContent('#log');
  check(/proof: accepted\./.test(log), 'case 1: the log does not say the canned change was accepted');
  await until(async () => (await page.textContent('#unr')) === '0', 5000, 'the truth box to update').catch(() => {});
  check((await page.textContent('#unr')) === '0', `case 1: the truth box still has ${await page.textContent('#unr')} pellet(s) out of reach after "Open the pocket"`);
  check(routed.length === 0 && failed.length === 0, 'case 1: an Anthropic request was made with no key');
  await context.close();
}

async function case2() {
  const { context, page } = await open({ name: 'case 2' });
  routed = [];
  await saveKey(page, 'sk-proj-abc');
  const s = await state(page);
  check(s.keyerr === BAD_SHAPE, `case 2: error text is ${JSON.stringify(s.keyerr)}`);
  check(routed.length === 0, `case 2: ${routed.length} request(s) sent for a non-Anthropic key`);
  check(!s.keystate && s.send === true && !Object.keys(s.ss).length, 'case 2: the non-Anthropic key was taken');
  await context.close();
}

async function case3() {
  const { context, page } = await open({ name: 'case 3' });
  await saveKey(page, ' ' + KEY + '\n');
  const s = await state(page);
  check(s.masked === '····QNoA', `case 3: masked key is ${JSON.stringify(s.masked)}`);
  check(Object.values(s.ss).includes(KEY) && Object.values(s.ss).every((v) => !/sk-ant/.test(v) || v === KEY), `case 3: sessionStorage does not hold the trimmed key: ${JSON.stringify(Object.keys(s.ss))}`);
  check(Object.values(s.ls).every((v) => !/sk-ant/.test(String(v))), 'case 3: a localStorage value contains sk-ant');
  check(s.keyinput === '', 'case 3: the key input was not cleared');
  check(s.send === false && s.keystate && !s.inputRow, `case 3: after saving, Send disabled=${s.send}, key state shown=${s.keystate}, input row shown=${s.inputRow}`);
  await page.click('#keymasked');
  const s2 = await state(page);
  check(JSON.stringify(s2.ss) === JSON.stringify(s.ss) && s2.send === s.send && s2.keystate, 'case 3: clicking the masked key changed state');
  // the adapter's own trim, straight through the controller (an input field drops a pasted newline before the page sees it)
  await page.evaluate((k) => window.MazeKey.save('  ' + k + '\n'), KEY2);
  const s3 = await state(page);
  check(s3.masked === '····N3W1' && Object.values(s3.ss).includes(KEY2), 'case 3: a key with spaces and a newline was not trimmed by save()');
  await context.close();
}

async function case4() {
  routed = [];
  const { context, page } = await open({ name: 'case 4' });
  await saveKey(page, KEY);
  await setMode(page, 'Code (proof)');
  await ask(page, 'make a small different game with a door');
  await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'the typed ask to finish');
  const log = await page.textContent('#log');
  check(/proof: accepted\./.test(log) && /goal: find three keys/.test(log), 'case 4: the log does not show the answer handled:\n' + log);
  check(routed.length === 1 && routed[0].kind === 'writer', `case 4: expected one writer call, got ${routed.map((r) => r.kind).join(',')}`);
  const r = routed[0] || { headers: {}, body: {} };
  check(r.headers['content-type'] === 'application/json', 'case 4: content-type header');
  check(r.headers['x-api-key'] === KEY, 'case 4: x-api-key header');
  check(r.headers['anthropic-version'] === '2023-06-01', 'case 4: anthropic-version header');
  check(r.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'case 4: direct browser access header');
  check(r.body.model === 'claude-opus-5-5' && r.body.stream === true, `case 4: body model ${r.body.model}, stream ${r.body.stream}`);
  const shippedFallback = await page.evaluate(() => window.MazeByok.FALLBACK);
  check(typeof shippedFallback === 'boolean', 'case 4: the page does not expose its FALLBACK value');
  check(shippedFallback ? (r.headers['anthropic-beta'] === 'server-side-fallback-2026-07-01' && r.body.fallbacks === 'default') : (!('anthropic-beta' in r.headers) && !('fallbacks' in r.body)), `case 4: the request does not match the shipped fallback (${shippedFallback}): anthropic-beta ${JSON.stringify(r.headers['anthropic-beta'])}, fallbacks ${JSON.stringify(r.body.fallbacks)}`);
  const known = ['content-type', 'x-api-key', 'anthropic-version', 'anthropic-dangerous-direct-browser-access', 'anthropic-beta'];
  const extra = Object.keys(r.headers).filter((h) => !known.includes(h.toLowerCase()) && !/^(accept|accept-encoding|accept-language|user-agent|origin|referer|content-length|host|connection|sec-.*|priority|cache-control|pragma)$/i.test(h));
  check(extra.length === 0, 'case 4: unexpected request headers: ' + extra.join(','));
  check(!MODEL_LINE.test(log), 'case 4: a serving-model line with no model named:\n' + log);
  check((await state(page)).send === false, 'case 4: Send is not enabled after the answer');
  await context.close();
}

// the streaming server: wait for a call of this kind to arrive, return it
const arrived = (kind, n) => until(() => stream.reqs.filter((r) => r.kind === kind).length >= n && stream.reqs.filter((r) => r.kind === kind)[n - 1], 30000, `${kind} call #${n}`);
const aborted = (failed) => failed.some((f) => f.url === SAPI && /ABORT/i.test(f.error));

async function case5() {
  stream.reqs = []; stream.plan.writer = [{ how: 'hold', first: 'SAY: first words ' }];
  const { context, page, failed, consoleErrors } = await open({ copy: true, name: 'case 5' });
  await saveKey(page, KEY);
  await ask(page, 'make a small different game with a door');
  const rec = await arrived('writer', 1);
  await until(async () => /the AI writer is writing/.test(await page.textContent('#log')), 15000, 'the first delta to render');
  await page.click('#stop');
  await until(() => aborted(failed), 5000, 'the writer request to fail as aborted').catch(() => {});
  check(aborted(failed), 'case 5: Stop did not abort the request');
  await sleep(300);
  const s = await state(page);
  check(/Stopped\./.test(s.card) && /stopped\./.test(s.log), 'case 5: the page does not show its cancelled state: ' + JSON.stringify({ card: s.card, log: s.log.slice(-400) }));
  const before = s.log;
  if (!rec.res.destroyed) { rec.res.write(sseDelta('MORE TEXT AFTER STOP ')); rec.res.write(sseDelta('AND MORE ')); }
  await sleep(600);
  const after = (await state(page)).log;
  check(after === before && !/MORE TEXT AFTER STOP/.test(after), 'case 5: text arrived after Stop:\nBEFORE ' + before.slice(-300) + '\nAFTER ' + after.slice(-300));
  check(consoleErrors.length === 0, 'case 5: Stop logged console errors: ' + JSON.stringify(consoleErrors));
  await context.close();
}

async function case6() {
  // credential and billing errors in Code (typed: the writer) and Judge (typed: the judge, after the writer). A canned change calls no model
  // under any switch (case 13), so there is no canned row and no Prose row: Prose's only call was the one about a canned change
  for (const [mode, how, kind] of [['Code (proof)', 'ask', 'writer'], ['Judge', 'ask', 'judge']]) {
    for (const code of ['bad_key', 'permission', 'no_credit']) {
      routed = [];
      const { context, page } = await open({ name: `case 6 ${mode} ${code}`, answers: { [kind]: [code] } });
      const at = `case 6 (${mode}, ${code})`;
      await saveKey(page, KEY);
      await setMode(page, mode);
      if (how === 'ask') await ask(page, 'make a small different game with a door'); else await canned(page, 0);
      await until(() => routed.some((r) => r.kind === kind), 30000, at + ' call');
      await idle(page);
      const s = await state(page);
      check(s.keyerr === T[code], `${at}: key error is ${JSON.stringify(s.keyerr)}`);
      check(s.card.includes(T[code]), `${at}: the card does not show the error`);
      check(routed.filter((r) => r.kind === kind).length === 1, `${at}: ${routed.filter((r) => r.kind === kind).length} ${kind} calls (a key error is not retried)`);
      check(s.send === true && s.off === '1', `${at}: Send disabled=${s.send}, off=${JSON.stringify(s.off)}`);
      check(s.inputRow, `${at}: the key input row is not back`);
      if (code === 'no_credit') check(s.keystate && Object.values(s.ss).includes(KEY), `${at}: the key was not kept`);
      else check(!s.keystate && !Object.values(s.ss).some((v) => /sk-ant/.test(v)), `${at}: the key was not forgotten`);
      await context.close();
    }
  }
  // Judge, typed: the writer call succeeds, the judge call finds no credit: the no_credit card, not a silent retry
  routed = [];
  const { context, page } = await open({ name: 'case 6 judge after writer', answers: { judge: ['no_credit'] } });
  await saveKey(page, KEY);
  await setMode(page, 'Judge');
  await ask(page, 'make a small different game with a door');
  await until(() => routed.some((r) => r.kind === 'judge'), 30000, 'the judge call');
  await idle(page);
  let s = await state(page);
  check(routed.map((r) => r.kind).join(',') === 'writer,judge', `case 6 (Judge after writer): calls were ${routed.map((r) => r.kind).join(',')}`);
  check(s.keyerr === T.no_credit && s.card.includes(T.no_credit), 'case 6 (Judge after writer): no no_credit card');
  check(!/asking it once more/.test(s.log), 'case 6 (Judge after writer): the judge was retried');
  check(s.send === true, 'case 6 (Judge after writer): Send is enabled after no credit');
  // a new key: Send is enabled again, and stays enabled after an answer
  await saveKey(page, KEY2);
  s = await state(page);
  check(s.send === false && s.off === '' && s.masked === '····N3W1', `case 6 (new key after no credit): Send disabled=${s.send}, off=${JSON.stringify(s.off)}`);
  routed = [];
  await ask(page, 'make a small different game with a door');
  await until(() => routed.length >= 2, 30000, 'the calls with the new key');
  await idle(page);
  s = await state(page);
  check(/judge: passed/.test(s.log), 'case 6 (new key after no credit): the ask did not go through');
  check(routed.every((r) => r.headers['x-api-key'] === KEY2), 'case 6 (new key after no credit): a call did not use the new key');
  check(s.send === false, 'case 6 (new key after no credit): Send is disabled after the answer');
  await context.close();
}

async function case7() {
  // Stop and Forget while each model-call stage is active (a canned change calls no model, so both stages come from a typed request)
  const stages = [['Code (proof)', 'ask', 'writer'], ['Judge', 'ask', 'judge']];
  for (const [mode, how, kind] of stages) {
    for (const action of ['stop', 'forget']) {
      const at = `case 7 (${action} during the ${kind} call)`;
      stream.reqs = []; stream.plan = { writer: [], judge: [], gate: [] }; stream.plan[kind] = [{ how: 'hold' }];
      const { context, page, failed, consoleErrors } = await open({ copy: true, name: at });
      await saveKey(page, KEY);
      await setMode(page, mode);
      if (how === 'ask') await ask(page, 'make a small different game with a door'); else await canned(page, 0);
      const rec = await arrived(kind, 1);
      await sleep(300);
      if (how === 'canned') await page.click('#tabFree');   // Stop and the key box live on the Ask tab
      await page.click(action === 'stop' ? '#stop' : '#forgetkey');
      // well inside the copy's judge timeout (COPY_JUDGE_MS), so only Stop or Forget can have aborted it
      await until(() => aborted(failed), 3000, at).catch(() => {});
      check(aborted(failed), `${at}: the request was not aborted`);
      await until(() => rec.closed, 3000, at + ' server close').catch(() => {});
      check(rec.closed, `${at}: the server still holds the connection`);
      await idle(page);
      const s = await state(page);
      await sleep(300);
      check(consoleErrors.length === 0, `${at}: console errors: ${JSON.stringify(consoleErrors)}`);
      if (action === 'stop') check(/Stopped\./.test(s.card) && /stopped\./.test(s.log), `${at}: no cancelled state`);
      else {
        check(!Object.values(s.ss).some((v) => /sk-ant/.test(v)) && !s.keystate, `${at}: the key was not cleared`);
        check(s.send === true && s.capnote === await asText(page, ASK_MSG_HTML || ''), `${at}: Send disabled=${s.send}, capnote ${JSON.stringify(s.capnote)}`);
      }
      await context.close();
    }
  }
  // a timeout aborts the judge's call and it retries exactly once; it is not a Stop
  {
    const at = 'case 7 (Judge timeout)';
    stream.reqs = []; stream.plan = { writer: [], judge: [{ how: 'hang' }, { how: 'ok' }], gate: [] };
    const { context, page, failed } = await open({ copy: true, name: at });
    await saveKey(page, KEY);
    await setMode(page, 'Judge');
    await ask(page, 'make a small different game with a door');
    const first = await arrived('judge', 1);
    await arrived('judge', 2);
    check(first.closed || aborted(failed), `${at}: the timed-out call was not aborted`);
    await idle(page);
    await sleep(COPY_JUDGE_MS + 500);
    const s = await state(page);
    check(stream.reqs.filter((r) => r.kind === 'judge').length === 2, `${at}: ${stream.reqs.filter((r) => r.kind === 'judge').length} judge calls, want exactly 2`);
    check(/asking it once more/.test(s.log) && /judge: passed/.test(s.log), `${at}: the retry did not run to a verdict`);
    check(!/stopped\./.test(s.log) && !/Stopped\./.test(s.card), `${at}: shows a cancelled state`);
    await context.close();
  }
}

// the claude.ai-hosted transport: a fake window.claude whose sample() and sample.json() count every call in window.__fakeCalls. MazeKey.init()
// selects it over the key box when it is there. It names claude-opus-4-8 as the serving model both ways, which the page must never report on
// the claude.ai-hosted path
const HOSTED_INIT = `window.__PROGRAM__=${JSON.stringify(PROGRAM)};(${(() => {
  window.__fakeCalls = 0;
  const text = 'SAY: Made a small five by five game with a door.\nWHY: Nothing ever raises the key count, so the goal never holds.\nPROGRAM:\n' + window.__PROGRAM__;
  const sample = async (input, opts) => { window.__fakeCalls++; if (opts && opts.onModel) opts.onModel('claude-opus-4-8'); if (opts && opts.onText) opts.onText({ text, delta: text }); return { text, truncated: false, modelTierApplied: 'complex', servedModel: 'claude-opus-4-8' }; };
  sample.json = async (input, opts) => { window.__fakeCalls++; if (opts && opts.onModel) opts.onModel('claude-opus-4-8'); return { winnable: false, reason: 'fake' }; };
  window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
}).toString()})();`;

async function case7b() {
  {
    const { context, page } = await open({ name: 'case 7b reload' });
    await saveKey(page, KEY);
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    const s = await state(page);
    check(s.masked === '····QNoA' && s.keystate && s.send === false, `case 7b (reload): masked ${JSON.stringify(s.masked)}, Send disabled=${s.send}`);
    // a page that loaded with a key still offers Canned changes once the key is gone: after Forget key
    await page.click('#forgetkey');
    check(await page.isVisible('#tabQuick'), 'case 7b (reload, then Forget key): the Canned changes tab is missing');
    check((await state(page)).send === true, 'case 7b (reload, then Forget key): Send is enabled');
    await context.close();
  }
  {
    // and after the key is rejected (bad_key) on a page that loaded with it
    routed = [];
    const { context, page } = await open({ name: 'case 7b reload reject', answers: { writer: ['bad_key'] } });
    await saveKey(page, KEY);
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    await ask(page, 'make a small different game with a door');
    await until(() => routed.length >= 1, 30000, 'the rejected ask');
    await idle(page);
    const s = await state(page);
    check(s.keyerr === T.bad_key, 'case 7b (reload, then bad_key): no bad_key error');
    check(await page.isVisible('#tabQuick'), 'case 7b (reload, then bad_key): the Canned changes tab is missing');
    await canned(page, 0);
    await until(async () => /result: RULE (HELD|BROKEN)/.test(await page.textContent('#log')), 30000, 'a canned change after the key was rejected');
    await context.close();
  }
  {
    const init = () => { Object.defineProperty(window, 'sessionStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError'); } }); };
    const { context, page } = await open({ name: 'case 7b no storage', init });
    routed = [];
    await saveKey(page, KEY);
    let s = await state(page);
    check(s.ss.__throws === true, 'case 7b (no storage): premise: sessionStorage does not throw');
    check(s.masked === '····QNoA' && s.send === false, `case 7b (no storage): the key does not work for the visit (Send disabled=${s.send})`);
    check(Object.values(s.ls).every((v) => !/sk-ant/.test(String(v))), 'case 7b (no storage): the key went to localStorage');
    await ask(page, 'make a small different game with a door');
    await until(() => routed.length >= 1, 30000, 'the ask with an in-memory key');
    await idle(page);
    check(routed[0] && routed[0].headers['x-api-key'] === KEY, 'case 7b (no storage): the in-memory key was not used');
    await page.reload({ waitUntil: 'load' });
    await ready(page);
    s = await state(page);
    check(!s.keystate && s.send === true, 'case 7b (no storage): the key outlived the visit');
    await context.close();
  }
  {
    routed = [];
    const { context, page } = await open({ name: 'case 7b claude.ai', init: HOSTED_INIT });
    const s = await state(page);
    check(!s.keybox, 'case 7b (claude.ai): the key box is shown');
    check(s.send === false, 'case 7b (claude.ai): Send is disabled');
    await setMode(page, 'Code (proof)');
    await ask(page, 'make a small different game with a door');
    await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'the claude.ai ask');
    check((await page.evaluate(() => window.__fakeCalls)) >= 1, 'case 7b (claude.ai): the ask did not go through claude.use("sample")');
    check(routed.length === 0, 'case 7b (claude.ai): the ask went to the network');
    const log = (await state(page)).log;
    check(/AI writer: Made a small five by five game/.test(log), 'case 7b (claude.ai): premise: the writer answer is not in the log');
    check(!MODEL_LINE.test(log), 'case 7b (claude.ai): a serving-model line on the claude.ai-hosted path:\n' + log);
    await context.close();
    // and a judge call on the claude.ai-hosted path
    const j = await open({ name: 'case 7b claude.ai Judge', init: HOSTED_INIT });
    await setMode(j.page, 'Judge');
    await ask(j.page, 'make a small different game with a door');
    await until(async () => /result: RULE HELD/.test(await j.page.textContent('#log')), 30000, 'the claude.ai Judge ask');
    const jlog = (await state(j.page)).log;
    check(/judge: passed/.test(jlog), 'case 7b (claude.ai, Judge): premise: the judge did not rule:\n' + jlog);
    check(!MODEL_LINE.test(jlog), 'case 7b (claude.ai, Judge): a serving-model line on the claude.ai-hosted path:\n' + jlog);
    await j.context.close();
  }
}

async function case11() {
  // the serving model: a writer round answered by claude-opus-4-8 gets one log line naming it; an Opus 5.5 round gets none
  for (const [model, want] of [['claude-opus-4-8', true], ['claude-opus-5-5', false]]) {
    routed = [];
    const at = `case 11 (${model})`;
    const { context, page } = await open({ name: at, answers: { writer: [model] } });
    await saveKey(page, KEY);
    await setMode(page, 'Code (proof)');
    await ask(page, 'make a small different game with a door');
    await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, at + ' ask');
    const log = (await state(page)).log;
    check(routed.length === 1 && routed[0].kind === 'writer', `${at}: premise: expected one writer call, got ${routed.map((r) => r.kind).join(',')}`);
    check(/AI writer: Made a small five by five game/.test(log), `${at}: premise: the answer is not in the log`);
    const lines = log.split('\n').filter((l) => MODEL_LINE.test(l));
    if (want) check(lines.length === 1 && lines[0] === 'this round was answered by Claude Opus 4.8, not Opus 5.5.', `${at}: model lines ${JSON.stringify(lines)}`);
    else check(lines.length === 0 && !/Claude Opus/.test(log), `${at}: model lines on an Opus 5.5 round ${JSON.stringify(lines)}`);
    check(!/\u2014/.test(lines.join('')), `${at}: an em dash in the model line`);
    await context.close();
  }
  // a judge call served by claude-opus-4-8: one line, naming the call (Prose's call on a canned change is gone: case 13)
  for (const [mode, kind, how, want] of [['Judge', 'judge', 'ask', 'the judge call was answered by Claude Opus 4.8, not Opus 5.5.']]) {
    routed = [];
    const at = `case 11 (${kind} served by claude-opus-4-8)`;
    const { context, page } = await open({ name: at, answers: { [kind]: ['claude-opus-4-8'] } });
    await saveKey(page, KEY);
    await setMode(page, mode);
    if (how === 'ask') await ask(page, 'make a small different game with a door'); else await canned(page, 0);
    await until(() => routed.some((r) => r.kind === kind), 30000, at + ' call');
    await idle(page);
    const log = (await state(page)).log;
    check(/judge: passed/.test(log), `${at}: premise: the ${kind} answer was not used:\n` + log);
    const lines = log.split('\n').filter((l) => MODEL_LINE.test(l));
    check(lines.length === 1 && lines[0] === want, `${at}: model lines ${JSON.stringify(lines)}`);
    await context.close();
  }
}

// ---- no key: the simulated Judge and Prose answers. The expected texts are Mo's approved wording (the claim itself); the why lines and the
// winnable split come from the build input, read here independently of the page's own derivation
const INPUT = fs.readFileSync(path.join(ROOT, 'build', 'input', 'game-public.html'), 'utf8');
const quickWhys = (() => {
  const a = INPUT.indexOf('const QUICK = [\n'), block = INPUT.slice(a, INPUT.indexOf('\n];', a));
  return [...block.matchAll(/\{id:'(\w+)', name:'([^']+)'[^\n]*?why:"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ id: m[1], name: m[2], why: JSON.parse('"' + m[3] + '"') }));
})();
const repairWhy = (id) => { const m = INPUT.match(new RegExp('\\n ' + id + ': "((?:[^"\\\\]|\\\\.)*)",\\n')); return m && JSON.parse('"' + m[1] + '"'); };
// a why line as the page quotes it: its closing full stop dropped, and a winnable one without its "this version can be won: " opening
const q = (why) => why.replace(/\.$/, '').replace(/^this version can be won: /, '');
const SIM = {
  judge_keep: () => `A judge that reads the program correctly lets this change through, because the maze stays unwinnable. But a judge is a model, and a model can be talked out of the right answer.`,
  prose_win: (w) => `An AI that follows the one sentence in its instructions telling it never to make a winnable game would refuse this change, because ${q(w)}. But that sentence is one line among many the AI reads, so it might miss it.`,
  prose_keep: () => `An AI that follows the one sentence in its instructions telling it never to make a winnable game would apply this change, because the maze stays unwinnable.`,
};
async function case12() {
  const win = quickWhys.find((e) => /^this version can be won/.test(e.why)), keep = quickWhys.find((e) => !/^this version can be won/.test(e.why));
  check(quickWhys.length >= 2 && win && keep && repairWhy(win.id), `case 12: premise: could not read a winnable and an unwinnable change from QUICK (${quickWhys.length} read)`);
  if (!win || !keep) return;
  // the two log lines these checks turn on, read from the page so a reworded line is followed: what the page logs when a new game is put
  // on the board, and what it logs before a canned change goes to the check
  const runLit = pageLits(/logLine\('ok',(LIT)\+\(view\.goal\|\|/), firstLit = pageLits(/ : (LIT)\);   \/\/ Human: the log does not give the repair away/);
  check(runLit && firstLit, 'case 12: premise: the page has the line it logs when a new game runs and the line before a canned change is checked');
  if (!runLit || !firstLit) return;
  const [RUNNING] = runLit, [CHECK_FIRST] = firstLit;
  const runs = [];
  for (const mode of ['Judge', 'Prose']) for (const e of [win, keep]) {
    routed = [];
    const at = `case 12 (${mode}, ${e.id})`;
    const { context, page } = await open({ name: at });
    await setMode(page, mode);
    await page.click('#tabQuick'); await page.locator('#opts .opt', { hasText: e.name }).first().click();
    await idle(page);
    const s = await state(page);
    runs.push(at);
    const applied = s.log.includes(RUNNING);
    check(routed.length === 0, `${at}: an Anthropic request was made with no key`);
    check(/RULE HELD/.test(s.card), `${at}: the rule did not hold:\n${s.card}`);
    check(!/\u2014/.test(s.card), `${at}: an em dash on the card`);
    if (mode === 'Judge' && e === win) {
      // the literal program is caught by the simulated verdict; the page's repaired version is then judged let through, and runs
      check(s.log.includes('the page stands in for the judge on a canned change: rejected this game. a judge that reads the program correctly says it can be won: "' + q(e.why) + '".'), `${at}: the literal program was not caught by the stand-in verdict:\n${s.log}`);
      check(/the page has a repaired version of it/.test(s.log) && applied, `${at}: the repaired version did not run:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". The literal version was caught, so the page ran its repaired version. ' + SIM.judge_keep()), `${at}: card:\n${s.card}`);
    } else if (mode === 'Judge') {
      check(applied && /the page stands in for the judge on a canned change: passed\./.test(s.log), `${at}: the change was not applied:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". ' + SIM.judge_keep()), `${at}: card:\n${s.card}`);
    } else if (e === win) {
      check(!applied && !s.log.includes(CHECK_FIRST), `${at}: the change was applied:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". ' + SIM.prose_win(e.why)), `${at}: card:\n${s.card}`);
    } else {
      check(applied && /applied\. nobody checked it\./.test(s.log), `${at}: the change was not applied:\n${s.log}`);
      check(s.log.includes(CHECK_FIRST), `${at}: premise: an applied canned change logs the line the refused one must not have:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". ' + SIM.prose_keep()), `${at}: card:\n${s.card}`);
    }
    await context.close();
  }
  check(runs.length === 4, `case 12: premise: ${runs.length} of 4 runs`);
}

async function case8() {
  const { context, page } = await open({ name: 'case 8', hash: '#read-play' });
  await sleep(500);
  const top = await page.evaluate(() => document.getElementById('read-play').getBoundingClientRect().top);
  const y = await page.evaluate(() => window.scrollY);
  check(y > 0 && top >= 0 && top <= 120, `case 8: #read-play top is ${top}px (scrollY ${y})`);
  await context.close();
}

async function case10() {
  // no key: canned changes under Code (proof), Judge and Prose; no card names claude.ai, and where the AI was needed the card sends the reader to the key box
  const cards = {};
  for (const mode of ['Code (proof)', 'Judge', 'Prose']) {
    routed = [];
    const { context, page } = await open({ name: `case 10 ${mode}` });
    await setMode(page, mode);
    await canned(page, 0);
    await idle(page);
    const s = await state(page);
    cards[mode] = s.card;
    check(!/claude\.ai/i.test(s.card) && !/claude\.ai/i.test(s.log), `case 10 (${mode}): the card or log names claude.ai:\n${s.card}`);
    check(!/viewer/i.test(s.card), `case 10 (${mode}): the card mentions a viewer:\n${s.card}`);
    check(routed.length === 0, `case 10 (${mode}): an Anthropic request was made with no key`);
    await context.close();
  }
  check(/caught/.test(cards['Code (proof)']) && /RULE HELD/.test(cards['Code (proof)']), 'case 10 (Code (proof)): premise: the canned change was not caught:\n' + cards['Code (proof)']);
  for (const m of ['Judge', 'Prose']) check(/But (a judge is a model|that sentence is one line among many)/.test(cards[m]), `case 10 (${m}): the card carries no stand-in answer:\n` + cards[m]);
  check(!/No judge ran|unjudged|Prose needs the AI/.test(cards.Judge + cards.Prose), 'case 10: an old no-key text is still shown');
}

// ---- the flow chart, Capability without the AI, canned changes without the AI, and Human "read to the bottom" (Mo, 2026-10-02,
// flow-chart spec). Texts the page holds as constants are read from its source (pageConst, pageLits); a case fails its premise when the
// page lacks them.
const logLines = (page) => page.evaluate(() => [...document.querySelectorAll('#log .l')].map((d) => d.textContent));
const countOf = (arr, s) => arr.filter((x) => x === s).length;
const resultCard = (page) => page.evaluate(() => { const c = document.getElementById('card'), w = c.querySelector('.why');
  return { why: w ? w.innerText.trim() : '', st: ((c.querySelector('.st') || {}).innerText || '').trim(), tags: w ? w.querySelectorAll('*').length : -1 }; });
// what the reader sees of a selector: drawn elements' innerText
const seen = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length && e.offsetParent !== null).map((e) => e.innerText.trim()), sel);
// a real mouse press on a switch button where it is on screen (as a reader taps it), else the element's own click(), which does not
// scroll; Playwright's locator click would scroll the button into view and hide a scroll the page made
async function press(page, name) {
  const h = await page.evaluateHandle((n) => [...document.querySelectorAll('#seg button')].find((b) => (b.querySelector('span') || {}).textContent === n) || null, name);
  const el = h.asElement(); if (!el) return false;
  const box = await el.boundingBox(), vh = page.viewportSize().height;
  if (box && box.y >= 0 && box.y + box.height <= vh) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  else await el.evaluate((b) => b.click());
  return true;
}
const mockReady = (page) => until(() => page.evaluate(() => !!(window.__nrp && window.__mock)), 15000, 'the ?mock test hook');

async function case13() {
  // a canned change never calls a model under Prose or Judge, with a key saved: the page's own answer is used
  const win = quickWhys.find((e) => /^this version can be won/.test(e.why)), keep = quickWhys.find((e) => !/^this version can be won/.test(e.why));
  check(win && keep, 'case 13: premise: a winnable and an unwinnable canned change');
  if (!win || !keep) return;
  for (const mode of ['Prose', 'Judge']) {
    const at = `case 13 (${mode}, key saved)`;
    routed = [];
    const { context, page } = await open({ name: at });
    await saveKey(page, KEY);
    await setMode(page, mode);
    for (const e of [win, keep]) {
      await page.evaluate(() => document.getElementById('resetTop').click());
      await idle(page);
      await page.click('#tabQuick'); await page.locator('#opts .opt', { hasText: e.name }).first().click();
      await until(async () => /result: RULE (HELD|BROKEN)/.test((await logLines(page)).slice(-1)[0] || ''), 30000, `${at} ${e.id} result`);
      await idle(page);
      check(routed.length === 0, `${at}: "${e.name}" made ${routed.length} model call(s): ${routed.map((r) => r.kind).join(',')}`);
    }
    // premise: the counter sees a call. The same page, a typed request, calls the writer
    await page.click('#tabFree');
    await ask(page, 'make a small different game with a door');
    await until(() => routed.length > 0, 30000, at + ' premise call').catch(() => {});
    await idle(page);
    check(routed.length > 0 && routed[0].kind === 'writer', `${at}: premise: a typed request with the key reaches the model (${routed.map((r) => r.kind).join(',')})`);
    await context.close();
  }
}

async function case14() {
  // Capability: the page never calls a model, canned or typed, key or no key; the Ask box works with no key; the notice is on both tabs
  const CAP_NOTE = pageConst('CAP_NOTE'), CAP_LOG = pageConst('CAP_LOG'), cardParts = pageLits(/why:(LIT)\+asked\+(LIT)/);
  check(typeof CAP_NOTE === 'string' && typeof CAP_LOG === 'string' && cardParts, 'case 14: premise: the page has CAP_NOTE, CAP_LOG and the Capability card');
  if (!CAP_NOTE || !CAP_LOG || !cardParts) return;
  const capCard = (asked) => cardParts[0] + asked + cardParts[1];
  routed = [];
  const { context, page, failed } = await open({ name: 'case 14' });
  const NOTE = await asText(page, CAP_NOTE);
  await setMode(page, 'Capability');
  const held = 'result: RULE HELD under Capability.';
  const one = async (at, run, asked) => {
    const n0 = (await logLines(page)).length;
    await run();
    await until(async () => (await resultCard(page)).why === capCard(asked), 10000, at + ' card').catch(() => {});
    const c = await resultCard(page), L = (await logLines(page)).slice(n0);
    check(c.why === capCard(asked), `${at}: the card is the fixed Capability text with the request (got ${JSON.stringify(c.why)})`);
    check(c.tags === 0, `${at}: the request is escaped on the card`);
    check(c.st === 'RULE HELD', `${at}: RULE HELD (got ${c.st})`);
    check(countOf(L, CAP_LOG) === 1 && countOf(L, held) === 1, `${at}: the no-tool line and the result line, once each (${JSON.stringify(L)})`);
    check(!L.some((x) => /asking the AI/.test(x)), `${at}: the log says "asking the AI"`);
  };
  const noticeOn = async (where, sel) => { const v = await seen(page, sel); check(v.length === 1 && v[0] === NOTE, `case 14 (${where}): the Capability notice (got ${JSON.stringify(v)})`); };
  for (const keyed of [false, true]) {
    const k = keyed ? 'key' : 'no key';
    if (keyed) await saveKey(page, KEY);
    await page.click('#tabQuick');
    await noticeOn(`canned tab, ${k}`, '.capnote');
    const opts = await page.evaluate(() => [...document.querySelectorAll('#opts .opt')].map((b) => ({ n: b.querySelector('b').textContent, off: b.disabled })));
    check(opts.length > 0 && opts.every((o) => !o.off), `case 14 (${k}): the canned changes are clickable under Capability (${JSON.stringify(opts)})`);
    await one(`case 14 (canned, ${k})`, () => page.click('#opts .opt >> nth=0'), opts[0].n);
    await page.click('#tabFree');
    await noticeOn(`Ask tab, ${k}`, '.capnote');
    check((await state(page)).send === false, `case 14 (${k}): Send is enabled under Capability`);
    for (const typed of ['open the pocket', 'give me <b>wings</b> & a "jetpack"']) {
      await one(`case 14 (typed ${JSON.stringify(typed)}, ${k})`, () => ask(page, typed), typed);
      check((await state(page)).send === false, `case 14 (${k}): Send is enabled after a typed request`);
    }
  }
  await page.click('#forgetkey');
  check((await state(page)).send === false, 'case 14: Send stays enabled under Capability after Forget key');
  check(routed.length === 0 && failed.length === 0, `case 14: Capability made ${routed.length} model call(s)`);
  // premise: the counter sees a call. Out of Capability, no key: the box is closed again; with a key a typed request calls the writer
  await setMode(page, 'Nothing');
  const s = await state(page);
  check(s.send === true && s.capnote === await asText(page, ASK_MSG_HTML || ''), `case 14: back on Nothing with no key, Send disabled=${s.send} and the key message (${JSON.stringify(s.capnote.slice(0, 60))})`);
  check((await seen(page, '.capnote')).length === 0, 'case 14: the Capability notice is gone under Nothing');
  // back into Capability with no key: the box opens again and the notice returns; then out again
  await setMode(page, 'Capability');
  check((await state(page)).send === false, 'case 14: back on Capability with no key, Send is enabled again');
  await noticeOn('Ask tab, back on Capability, no key', '.capnote');
  await setMode(page, 'Nothing');
  check((await state(page)).send === true, 'case 14: on Nothing again with no key, Send is disabled again');
  await saveKey(page, KEY);
  await ask(page, 'open the pocket');
  await until(() => routed.length > 0, 30000, 'case 14 premise call').catch(() => {});
  await idle(page);
  check(routed.length > 0, 'case 14: premise: a typed request under Nothing with a key reaches the model');
  await context.close();
  // ?mock (a key present): the model stand-in is never asked under Capability
  const m = await open({ name: 'case 14 mock', hash: '?mock' });
  await mockReady(m.page);
  await m.page.evaluate(() => window.__nrp.setMode('capability'));
  const calls0 = await m.page.evaluate(() => window.__mock.tiers.length);
  await m.page.evaluate(() => window.__nrp.quick(window.__nrp.QUICK[0]));
  await m.page.evaluate(() => window.__nrp.request('open the pocket', {}));
  check((await m.page.evaluate(() => window.__mock.tiers.length)) === calls0, 'case 14 (mock): Capability asked the model stand-in');
  await m.page.evaluate(() => window.__nrp.setMode('nothing'));
  await m.page.evaluate(() => window.__nrp.request('open the pocket', {}));
  await until(() => m.page.evaluate(() => !window.__nrp.busy()), 30000, 'case 14 mock premise');
  check((await m.page.evaluate(() => window.__mock.tiers.length)) > calls0, 'case 14 (mock): premise: under Nothing the stand-in is asked');
  await m.context.close();
  // the claude.ai-hosted transport (window.claude's sample, chosen by MazeKey.init()): Capability never calls sample() or sample.json(),
  // canned or typed; premise: under Nothing a typed request does
  routed = [];
  const h = await open({ name: 'case 14 claude.ai', init: HOSTED_INIT });
  const hcalls = () => h.page.evaluate(() => window.__fakeCalls);
  check((await state(h.page)).keybox === false, 'case 14 (claude.ai): premise: the hosted transport is in use (no key box)');
  await setMode(h.page, 'Capability');
  const hcard = async (at, asked) => {
    await until(async () => (await resultCard(h.page)).why === capCard(asked), 10000, at + ' card').catch(() => {});
    check((await resultCard(h.page)).why === capCard(asked), `${at}: the fixed Capability card (got ${JSON.stringify((await resultCard(h.page)).why)})`);
  };
  // the hosted path does not offer the Canned changes tab, so the first canned button is pressed through its own click handler, the one a
  // reader's tap runs
  const hname = await h.page.evaluate(() => { const b = document.querySelector('#opts .opt'); if (!b || b.disabled) return null; b.click(); return b.querySelector('b').textContent; });
  check(typeof hname === 'string', 'case 14 (claude.ai): premise: an enabled canned button exists');
  await hcard('case 14 (claude.ai, canned)', hname);
  await idle(h.page);
  check((await hcalls()) === 0, `case 14 (claude.ai, canned): Capability called the hosted sample ${await hcalls()} time(s)`);
  await h.page.click('#tabFree');
  await ask(h.page, 'open the pocket');
  await hcard('case 14 (claude.ai, typed)', 'open the pocket');
  await idle(h.page);
  check((await hcalls()) === 0, `case 14 (claude.ai, typed): Capability called the hosted sample ${await hcalls()} time(s)`);
  await setMode(h.page, 'Nothing');
  await ask(h.page, 'open the pocket');
  await until(async () => (await hcalls()) > 0, 30000, 'case 14 claude.ai premise').catch(() => {});
  await idle(h.page);
  check((await hcalls()) > 0, 'case 14 (claude.ai): premise: under Nothing a typed request calls the hosted sample');
  check(routed.length === 0, `case 14 (claude.ai): ${routed.length} request(s) went to the network on the hosted path`);
  await h.context.close();
}

async function case15() {
  // Human, canned: every canned change reaches the panel with the fixed summary and the gift; Approve from the summary holds the rule; the
  // gift swapped in and approved breaks it. No model call.
  const BAIT = pageConst('HUMAN_BAIT'), held = pageLits(/return acceptOffer\(fin\(r\.opened\?(LIT):(LIT)\)/), swap = pageLits(/undefined, fin\((LIT)\)\); \}/);
  const neutral = pageLits(/logLine\('think', mode==='human' \? (LIT) :/);
  check(typeof BAIT === 'string' && held && swap && neutral, 'case 15: premise: the page has HUMAN_BAIT, the approval texts and the Human log line');
  if (!BAIT || !held || !swap || !neutral) return;
  const [NEUTRAL] = neutral;
  const [OPENED, NEVER] = held, [SWAP] = swap;
  routed = [];
  const { context, page } = await open({ name: 'case 15' });
  await setMode(page, 'Human');
  await page.click('#tabQuick');
  const names = await page.evaluate(() => [...document.querySelectorAll('#opts .opt b')].map((b) => b.textContent));
  check(names.length >= 8, `case 15: premise: ${names.length} canned changes`);
  const runs = names.map((n) => [n, 'none']).concat([[names[0], 'openclose'], [names[0], 'swap']]);
  for (const [name, how] of runs) {
    const at = `case 15 ("${name}", ${how})`;
    await page.evaluate(() => document.getElementById('resetTop').click());
    await until(() => page.evaluate(() => [...document.querySelectorAll('#opts .opt')].every((b) => !b.disabled)), 15000, at + ' reset');
    const n0 = (await logLines(page)).length;
    await page.locator('#opts .opt', { hasText: name }).first().click();
    await page.waitForSelector('#approve .approve', { timeout: 60000 });
    if (how === 'none') {
      // the log does not give the repair away: it says only that the program goes to the reader (Mo, 2026-10-03)
      const L = (await logLines(page)).slice(n0);
      check(countOf(L, NEUTRAL) === 1 && !L.some((x) => /repaired version/.test(x)), `${at}: the log says only that the program goes to you (${JSON.stringify(L)})`);
    }
    const p = await page.evaluate(() => { const a = document.querySelector('#approve .approve'); return { s: a.querySelector('.s').innerText.trim(), gift: !!a.querySelector('details .gift .giftbtn') }; });
    check(p.s === BAIT, `${at}: the panel's summary is the fixed line (got ${JSON.stringify(p.s)})`);
    check(p.gift, `${at}: the folded program carries the gift (it is unwinnable)`);
    if (how !== 'none') await page.click('#approve details > summary');
    if (how === 'openclose') { await page.click('#approve details > summary'); check(!(await page.evaluate(() => document.querySelector('#approve details').open)), `${at}: premise: closed again`); }
    if (how === 'swap') await page.click('#approve .giftbtn');
    await page.click('#approve .ok');
    await until(async () => /RULE /.test((await resultCard(page)).st), 60000, at + ' verdict');
    await idle(page);
    const c = await resultCard(page), pre = `You picked "${name}".`;
    if (how === 'swap') check(c.st === 'RULE BROKEN' && c.why.startsWith(pre + SWAP), `${at}: RULE BROKEN and the swap text (got ${c.st}: ${JSON.stringify(c.why.slice(0, 200))})`);
    else check(c.st === 'RULE HELD' && c.why.startsWith(pre + (how === 'none' ? NEVER : OPENED)), `${at}: RULE HELD and the ${how === 'none' ? 'approved-from-the-summary' : 'opened'} text (got ${c.st}: ${JSON.stringify(c.why.slice(0, 200))})`);
  }
  check(routed.length === 0, `case 15: Human's canned changes made ${routed.length} model call(s)`);
  await context.close();
}

async function case16() {
  // Human, typed (?mock): the stand-in writer's literal program is winnable, so the page holds it back once and asks again; the repair
  // reaches the panel with the fixed summary and the gift
  const BAIT = pageConst('HUMAN_BAIT'), HOLD = pageConst('HUMAN_HOLD');
  check(typeof BAIT === 'string' && typeof HOLD === 'string', 'case 16: premise: the page has HUMAN_BAIT and HUMAN_HOLD');
  if (!BAIT || !HOLD) return;
  const { context, page } = await open({ name: 'case 16', hash: '?mock' });
  await mockReady(page);
  await page.evaluate(() => window.__nrp.setMode('human'));
  const writes = () => page.evaluate(() => window.__mock.tiers.filter((x) => x.kind === 'write').length);
  const w0 = await writes(), n0 = (await logLines(page)).length;
  await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
  await page.waitForSelector('#approve .approve', { timeout: 60000 });
  const L = (await logLines(page)).slice(n0);
  const p = await page.evaluate(() => { const a = document.querySelector('#approve .approve'); return { s: a.querySelector('.s').innerText.trim(), gift: !!a.querySelector('details .gift .giftbtn') }; });
  check(countOf(L, HOLD) === 1, `case 16: one held-back line before the panel (got ${countOf(L, HOLD)})`);
  check((await writes()) - w0 === 2, `case 16: two writer calls, the literal then the repair (got ${(await writes()) - w0})`);
  check(p.s === BAIT && p.gift, `case 16: the panel shows the fixed summary and the gift (${JSON.stringify(p)})`);
  await page.click('#approve .ok');
  await until(() => page.evaluate(() => !window.__nrp.busy()), 60000, 'case 16 approve');
  check((await resultCard(page)).st === 'RULE HELD', 'case 16: approved from the summary, the rule holds');
  await context.close();
}

async function case17() {
  // the flow chart: one figure per choosable switch, and the switch decides which one shows; a press while a request runs changes nothing
  const { context, page } = await open({ name: 'case 17', hash: '?mock' });
  await mockReady(page);
  const figs = await page.evaluate(() => [...document.querySelectorAll('#flow .flowfig')].map((f) => f.dataset.m));
  const buttons = await page.evaluate(() => [...document.querySelectorAll('#seg button')].map((b) => ({ n: (b.querySelector('span') || {}).textContent, off: b.disabled })));
  const choosable = buttons.filter((b) => !b.off);
  check(buttons.some((b) => b.off), 'case 17: premise: the switch has a button that cannot be chosen');
  check(figs.length === choosable.length && new Set(figs).size === figs.length, `case 17: ${figs.length} figures (distinct: ${new Set(figs).size}) for ${choosable.length} choosable switches`);
  const visited = [];
  for (const b of choosable) {
    await press(page, b.n);
    await until(async () => (await page.evaluate(() => document.querySelector('#seg button.on span').textContent)) === b.n, 5000, 'case 17 press ' + b.n);
    const s = await page.evaluate(() => ({ mode: window.__nrp.mode(), flow: document.getElementById('flow').dataset.m,
      shown: [...document.querySelectorAll('#flow .flowfig')].filter((f) => getComputedStyle(f).display !== 'none' && f.getClientRects().length).map((f) => f.dataset.m) }));
    visited.push(s.mode);
    check(s.flow === s.mode && s.shown.length === 1 && s.shown[0] === s.mode, `case 17 (${b.n}): the chart shows the switch's own figure and only it (mode ${s.mode}, chart ${s.flow}, shown ${JSON.stringify(s.shown)})`);
  }
  check(JSON.stringify([...visited].sort()) === JSON.stringify([...figs].sort()), `case 17: the figures are exactly the choosable switches (${JSON.stringify(figs)} vs ${JSON.stringify(visited)})`);
  // busy: the stand-in writer is held, the switch is disabled, and a press does not move the chart
  await press(page, choosable[0].n);
  const m0 = await page.evaluate(() => document.getElementById('flow').dataset.m);
  await page.evaluate(() => { window.__mock.delay = 3000; window.__nrp.request('open the pocket', {}); });
  await until(() => page.evaluate(() => window.__nrp.busy()), 5000, 'case 17 busy');
  check(await page.evaluate(() => [...document.querySelectorAll('#seg button')].every((b) => b.disabled)), 'case 17: premise: the switch is disabled while a request runs');
  await press(page, choosable[choosable.length - 1].n);
  await sleep(200);
  check((await page.evaluate(() => document.getElementById('flow').dataset.m)) === m0, 'case 17: a press while busy moved the chart');
  await until(() => page.evaluate(() => !window.__nrp.busy()), 60000, 'case 17 settle');
  await context.close();
}

async function case18() {
  // a switch press never moves the page, on a desktop and a phone
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const at = `case 18 (${viewport.width}px)`;
    const { context, page } = await open({ name: at, viewport });
    // the switch on screen with the page scrolled down: its top 300px below the top of the window
    const y = await page.evaluate(() => { const top = document.getElementById('seg').getBoundingClientRect().top + window.scrollY; window.scrollTo(0, Math.max(0, top - 300)); return window.scrollY; });
    await sleep(150);
    check(y > 0, `${at}: premise: the page scrolled before the press (${y})`);
    check(await press(page, 'Judge'), `${at}: premise: a Judge button`);
    await sleep(400);
    const after = await page.evaluate(() => ({ y: window.scrollY, on: document.querySelector('#seg button.on span').textContent }));
    check(after.on === 'Judge', `${at}: premise: the press selected Judge (${after.on})`);
    check(after.y === y, `${at}: the press moved the page from ${y} to ${after.y}`);
    await context.close();
  }
}

async function case19() {
  // Human, typed (?mock), the paths around the panel: the first writer prompt carries the repair brief; the reader's Reject stops the
  // request; a writer that only answers winnable gives six held-back rounds and the six-caught pause, which resumes; Stop and Reset during
  // a retry end it; a program that does not run is rejected and the writer asked again; a search that cannot finish is held back too
  const BAIT = pageConst('HUMAN_BAIT'), HOLD = pageConst('HUMAN_HOLD');
  const holdCard = pageLits(/so that the game stays unwinnable\.', (LIT), 'held'\)/), rejected = pageLits(/logLine\('no','you rejected it\.'\); now\.say=say; now\.why=(LIT);/);
  const six = pageLits(/\n    now\.say=lastSay; now\.why=(LIT); pause\(\);/), norun = pageLits(/if\(!chk\.ok\)\{ logLine\('no',(LIT)\+chk\.error\+'\.'\); return reject/);
  const brief = (SRC.match(/const HONOUR_REPAIR_A=`\n([^\n`$]+)/) || [])[1];
  check(typeof BAIT === 'string' && typeof HOLD === 'string' && holdCard && rejected && six && norun && brief, 'case 19: premise: the page has the Human texts, the six-caught card, the did-not-run line and the repair brief');
  if (!BAIT || !HOLD || !holdCard || !rejected || !six || !norun || !brief) return;
  const [HOLD_CARD] = holdCard, [REJECTED] = rejected, [SIX] = six, [NORUN] = norun;
  const { context, page } = await open({ name: 'case 19', hash: '?mock' });
  await mockReady(page);
  await page.evaluate(() => window.__nrp.setMode('human'));
  const writes = () => page.evaluate(() => window.__mock.tiers.filter((x) => x.kind === 'write').length);
  const busyEnd = (what) => until(() => page.evaluate(() => !window.__nrp.busy()), 90000, what);
  const panel = () => page.evaluate(() => { const a = document.querySelector('#approve .approve'); return a ? { s: a.querySelector('.s').innerText.trim(), gift: !!a.querySelector('details .gift .giftbtn') } : null; });
  const atDefault = () => page.evaluate(() => window.__nrp.program() === window.__nrp.DEFAULT_PROGRAM);
  const fresh = async (what) => { await page.evaluate(() => window.__nrp.resetGame()); await busyEnd(what + ' reset'); await page.evaluate(() => { const m = window.__mock; m.delay = 30; m.repairs = true; m.model = null; m.program = null; }); };
  const holdSeen = (n0) => until(() => page.evaluate(([n, h]) => [...document.querySelectorAll('#log .l')].slice(n).some((d) => d.textContent === h), [n0, HOLD]), 30000, 'a held-back line');

  // the first writer prompt under Human carries the repair brief and nothing tried yet; premise: under Nothing it does not
  const wp = await page.evaluate((B) => { const n = window.__nrp; const h = n.writerPrompt('open the pocket', [], [], 1, null); n.setMode('nothing'); const x = n.writerPrompt('open the pocket', [], [], 1, null); n.setMode('human'); return { h: h.includes(B), x: x.includes(B), tried: /TRIED ON THIS REQUEST/.test(h) }; }, brief);
  check(wp.h && !wp.tried, 'case 19: the first writer prompt under Human carries the repair brief and no TRIED marker');
  check(!wp.x, 'case 19: premise: the first writer prompt under Nothing does not carry the repair brief');

  // the reader's Reject: the game is unchanged and the writer is not asked again
  await fresh('Reject');
  check(await atDefault(), 'case 19 (Reject): premise: after Reset the game runs the original program');
  await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
  await page.waitForSelector('#approve .approve', { timeout: 60000 });
  let w0 = await writes();
  await page.click('#approve .no'); await busyEnd('Reject'); await sleep(400);
  check((await resultCard(page)).why === REJECTED, `case 19 (Reject): the card (got ${JSON.stringify((await resultCard(page)).why)})`);
  check(await atDefault(), 'case 19 (Reject): the game is unchanged');
  check((await writes()) === w0 && !(await panel()), 'case 19 (Reject): no further writer call and no panel');

  // a writer that only answers winnable: six held-back rounds, no panel, the six-caught pause; the pause resumes to the panel
  await fresh('six');
  await page.evaluate(() => { window.__mock.repairs = false; window.__panels = 0; new MutationObserver(() => { if (document.querySelector('#approve .approve')) window.__panels++; }).observe(document.getElementById('approve'), { childList: true, subtree: true }); });
  w0 = await writes(); let n0 = (await logLines(page)).length;
  await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
  await busyEnd('six held back');
  let L = (await logLines(page)).slice(n0);
  check(countOf(L, HOLD) === 6, `case 19 (six): six held-back lines (got ${countOf(L, HOLD)})`);
  check((await writes()) - w0 === 6, `case 19 (six): six writer calls (got ${(await writes()) - w0})`);
  check((await page.evaluate(() => window.__panels)) === 0, 'case 19 (six): a program reached the panel');
  check((await resultCard(page)).why.startsWith(SIX) && (await page.evaluate(() => window.__nrp.quiz())) === 'more', `case 19 (six): the six-caught pause (got ${JSON.stringify((await resultCard(page)).why.slice(0, 80))})`);
  await page.evaluate(() => { window.__mock.repairs = true; });
  w0 = await writes();
  await page.click('#card button[data-more]');
  await page.waitForSelector('#approve .approve', { timeout: 60000 });
  const p = await panel();
  check(p && p.s === BAIT && p.gift, `case 19 (six, resumed): the repair reaches the panel with the fixed summary and the gift (${JSON.stringify(p)})`);
  check((await writes()) - w0 === 1, `case 19 (six, resumed): one writer call (got ${(await writes()) - w0})`);
  await page.click('#approve .no'); await busyEnd('six resumed reject');

  // Stop during a retry: the card says the AI was asked again; then the request is over, once, with no further call and no panel
  await fresh('Stop');
  await page.evaluate(() => { window.__mock.repairs = false; window.__mock.delay = 400; });
  n0 = (await logLines(page)).length;
  await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
  await holdSeen(n0);
  check((await resultCard(page)).why.includes(HOLD_CARD), `case 19 (mid-retry): the card says the game could still be won and the AI was asked again (got ${JSON.stringify((await resultCard(page)).why)})`);
  await page.evaluate(() => window.__nrp.stopAsk());
  w0 = await writes(); await sleep(1500);
  L = (await logLines(page)).slice(n0);
  check(!(await page.evaluate(() => window.__nrp.busy())), 'case 19 (Stop during a retry): the request is still running');
  check(countOf(L, 'stopped.') === 1, `case 19 (Stop during a retry): the log says stopped, once (${countOf(L, 'stopped.')})`);
  check((await writes()) === w0 && !(await panel()), `case 19 (Stop during a retry): ${(await writes()) - w0} further writer call(s), panel ${!!(await panel())}`);
  check(await atDefault(), 'case 19 (Stop during a retry): the game changed');

  // Reset during a retry
  await fresh('Reset');
  await page.evaluate(() => { window.__mock.repairs = false; window.__mock.delay = 400; });
  n0 = (await logLines(page)).length;
  await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
  await holdSeen(n0);
  await page.evaluate(() => window.__nrp.resetGame()); await busyEnd('Reset during a retry');
  w0 = await writes(); await sleep(1500);
  check((await writes()) === w0 && !(await panel()) && !(await page.evaluate(() => window.__nrp.busy())), 'case 19 (Reset during a retry): a further writer call, a panel, or still busy');

  // a program that does not run, then one whose search cannot finish (an unbounded counter on the original game), then the repair
  await fresh('did not run');
  const repair = await page.evaluate(() => window.__nrp.REPAIRS.pocket);
  const counter = await page.evaluate(() => window.__nrp.DEFAULT_PROGRAM.replace(/function init\(\) \{ return \{/, 'function init() { return { tick: 0,').replace('return { ...s, x: nx, y: ny };', 'return { ...s, x: nx, y: ny, tick: s.tick + 1 };'));
  check(counter !== (await page.evaluate(() => window.__nrp.DEFAULT_PROGRAM)), 'case 19: premise: the unbounded-counter program differs from the original');
  const pv = await page.evaluate(async (src) => { const r = await window.__nrp.checkCandidate(src, { reqId: -1 }, window.__nrp.LATER_CAPS); return r.ok ? r.proof.status : 'error: ' + r.error; }, counter);
  check(pv === 'capped' || pv === 'unproven', `case 19: premise: the unbounded-counter program is not proven unwinnable (search: ${pv})`);
  await page.evaluate(([rep, cap]) => { const q = ['SAY: done\nWHY: walls.\nPROGRAM:\nfunction init( {', 'SAY: done\nWHY: walls.\nPROGRAM:\n' + cap, 'SAY: done\nWHY: walls.\nPROGRAM:\n' + rep]; window.__prompts = []; window.__mock.model = (input) => { window.__prompts.push(input); return q.shift() || q[0]; }; }, [repair, counter]);
  w0 = await writes(); n0 = (await logLines(page)).length;
  await page.evaluate(() => { window.__nrp.request('give me a ladder', {}); });
  await page.waitForSelector('#approve .approve', { timeout: 120000 });
  L = (await logLines(page)).slice(n0);
  const p2 = await panel();
  check(L.some((x) => x.startsWith(NORUN)), 'case 19 (did not run): no did-not-run line');
  check(countOf(L, HOLD) === 1, `case 19 (search cannot finish): held back once (got ${countOf(L, HOLD)})`);
  check((await writes()) - w0 === 3 && p2 && p2.s === BAIT && p2.gift, `case 19: the third answer reaches the panel with the fixed summary and the gift (${(await writes()) - w0} calls)`);
  const prompts = await page.evaluate(() => window.__prompts);
  check(prompts.length === 3 && prompts[0].includes(brief) && !/TRIED ON THIS REQUEST/.test(prompts[0]) && /TRIED ON THIS REQUEST/.test(prompts[1]), 'case 19: the prompts sent: the first carries the brief, the later ones what was tried');
  await page.click('#approve .no'); await busyEnd('final reject');
  await context.close();
}

async function case21() {
  // Human, typed (?mock), approval after a held-back round: (a) approving from the summary gives a final card with no "Round N." prefix,
  // which belongs only to the mid-retry card; (b) swapping in the gift and approving is RULE BROKEN with the swap text even when the
  // page's search of the swapped program runs out of budget (CAPS made tiny while the panel waits), and again no round prefix; the log's
  // result line then says the reader swapped the program in, not that a search found a win; (c) a swap that is not the page's own
  // "Open the pocket" (its id changed while the panel waits) is scored as the search returned it, so a starved search is not RULE BROKEN
  const HOLD = pageConst('HUMAN_HOLD'), holdCard = pageLits(/so that the game stays unwinnable\.', (LIT), 'held'\)/), go = pageLits(/now\.why=\(fellWhy\|\|why\)\+(LIT);/);
  const swapLit = (SRC.match(new RegExp(`(${LIT})`, 'g')) || []).filter((s) => /swapped in a winnable one, and approved it/.test(s));
  const giftLit = pageLits(/now\.gift\?(LIT):(LIT)\)/), approvedLit = pageLits(/if\(r\.ok&&r\.swap\)\{ logLine\('ok',(LIT)\+r\.swap\.name\+/);
  check(typeof HOLD === 'string' && holdCard && go && swapLit.length === 1, `case 21: premise: the page has the hold line, the hold card, the broken suffix and one swap text (${swapLit.length})`);
  check(giftLit && approvedLit, 'case 21: premise: the page has the gift result text beside the search one, and the line it logs when the gift is approved');
  if (typeof HOLD !== 'string' || !holdCard || !go || swapLit.length !== 1 || !giftLit || !approvedLit) return;
  const [GIFT_RESULT, SEARCH_RESULT] = giftLit, [APPROVED] = approvedLit;
  const FINISHED = /search|no win is reachable|winning sequence|game states/i;   // what any line reporting a search says (the lines enforce() and the longer pass write)
  const [HOLD_CARD] = holdCard, [GO] = go, SWAP = evalLit(swapLit[0]).trim();
  const ROUND = /Round \d+\./;
  const { context, page } = await open({ name: 'case 21', hash: '?mock' });
  await mockReady(page);
  await page.evaluate(() => window.__nrp.setMode('human'));
  const busyEnd = (what) => until(() => page.evaluate(() => !window.__nrp.busy()), 90000, what);
  const fresh = async (what) => { await page.evaluate(() => window.__nrp.resetGame()); await busyEnd(what + ' reset'); await page.evaluate(() => { const m = window.__mock; m.delay = 30; m.repairs = true; m.model = null; m.program = null; }); };
  // the first answer (the literal change, winnable) is held back; the second (the repair, proven unwinnable) reaches the panel
  const toPanel = async (what) => {
    const n0 = (await logLines(page)).length; let midCard = null;
    await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
    await until(async () => { const L = (await logLines(page)).slice(n0); if (!midCard && L.includes(HOLD)) midCard = (await resultCard(page)).why; return !!(await page.$('#approve .approve')); }, 60000, what + ' panel');
    const L = (await logLines(page)).slice(n0);
    check(countOf(L, HOLD) === 1, `case 21 (${what}): premise: one held-back round before the panel (got ${countOf(L, HOLD)})`);
    check(midCard && ROUND.test(midCard) && midCard.includes(HOLD_CARD), `case 21 (${what}): premise: the mid-retry card carries the round prefix and the hold text (${JSON.stringify(midCard)})`);
  };

  // (a) approve from the summary
  await fresh('summary');
  await toPanel('summary');
  await page.click('#approve .ok'); await busyEnd('summary approve'); await sleep(300);
  let c = await resultCard(page);
  check(c.st === 'RULE HELD', `case 21 (summary): premise: the badge (got ${c.st})`);
  check(!ROUND.test(c.why), `case 21 (summary): the final card carries a round prefix (${JSON.stringify(c.why.slice(0, 80))})`);

  // (b) the gift, with the search starved
  await fresh('swap');
  await toPanel('swap');
  const caps0 = await page.evaluate(() => { const C = window.__nrp.CAPS, o = { maxStates: C.maxStates, maxMs: C.maxMs }; C.maxStates = 20; return o; });
  const pocket = await page.evaluate(() => window.__nrp.QUICK.find((o) => o.id === 'pocket').src);
  const name = await page.evaluate(() => { const s = document.querySelector('#seg button.on span'); return s ? s.textContent.trim() : ''; });
  await page.click('#approve details summary');
  await page.click('#approve .giftbtn');
  check((await page.evaluate(() => document.querySelector('#approve details pre').textContent)) === pocket, 'case 21 (swap): premise: the gift the panel offers is the page\'s own "Open the pocket" program');
  const n1 = (await logLines(page)).length;
  await page.click('#approve .ok'); await busyEnd('swap approve'); await sleep(300);
  c = await resultCard(page);
  {
    const L = (await logLines(page)).slice(n1), ai = L.findIndex((x) => x.startsWith(APPROVED)), ri = L.findIndex((x) => x.startsWith('result: '));
    const want = L[ri] && L[ri].replace(GIFT_RESULT, '') + GIFT_RESULT;   // the mode name is the page's; the tail is the claim
    check(ai >= 0 && ri > ai + 1, `case 21 (swap): premise: the log has the approval line, then at least one line, then the result line (${ai}, ${ri})`);
    check(ri >= 0 && L[ri] === want && /^result: RULE BROKEN under \S+\.$/.test(L[ri].slice(0, -GIFT_RESULT.length)), `case 21 (swap): the result line says the reader swapped the program in (got ${JSON.stringify(L[ri])})`);
    check(name && ri >= 0 && L[ri] === 'result: RULE BROKEN under ' + name + '.' + GIFT_RESULT, `case 21 (swap): the result line names the switch position (${JSON.stringify(name)}; got ${JSON.stringify(L[ri])})`);
    check(SEARCH_RESULT.includes('the search found a winning sequence') && !L.some((x) => x.includes('the search found a winning sequence')), `case 21 (swap): no line claims the search found a winning sequence (${JSON.stringify(L.filter((x) => x.includes('winning sequence')))})`);
    const between = ai >= 0 && ri > ai ? L.slice(ai + 1, ri) : [];
    check(!between.some((x) => FINISHED.test(x)), `case 21 (swap): premise: between the approval and the result no line reports a finished search (${JSON.stringify(between.filter((x) => FINISHED.test(x)))})`);
  }
  const pv = await page.evaluate(async (src) => { const r = await window.__nrp.checkCandidate(src, { reqId: -1 }); return r.ok ? r.proof.status : 'error: ' + r.error; }, pocket);
  await page.evaluate((o) => Object.assign(window.__nrp.CAPS, o), caps0);
  check(pv === 'capped' || pv === 'unproven', `case 21 (swap): premise: with the starved budget the search of the gift does not finish (search: ${pv})`);
  check((await page.evaluate(() => window.__nrp.program())) === pocket, 'case 21 (swap): premise: the game runs the gift program');
  check(c.st === 'RULE BROKEN', `case 21 (swap): the badge after approving the gift (got ${c.st})`);
  check(c.why === SWAP + GO, `case 21 (swap): the card (got ${JSON.stringify(c.why)}, want ${JSON.stringify(SWAP + GO)})`);
  check(!ROUND.test(c.why), `case 21 (swap): the final card carries a round prefix (${JSON.stringify(c.why.slice(0, 80))})`);

  // (c) a swap that is not the page's own pocket program: the same clicks, with the gift's id changed before Approve and the search starved
  await fresh('other swap');
  await toPanel('other swap');
  const caps1 = await page.evaluate(() => { const C = window.__nrp.CAPS, o = { maxStates: C.maxStates, maxMs: C.maxMs }; C.maxStates = 20; return o; });
  await page.click('#approve details summary');
  await page.click('#approve .giftbtn');
  await page.evaluate(() => { window.__nrp.QUICK.find((o) => o.id === 'pocket').id = 'pocket-not-the-gift'; });
  const n2 = (await logLines(page)).length;
  await page.click('#approve .ok'); await busyEnd('other swap approve'); await sleep(300);
  await page.evaluate(() => { window.__nrp.QUICK.find((o) => o.id === 'pocket-not-the-gift').id = 'pocket'; });
  c = await resultCard(page);
  await page.evaluate((o) => Object.assign(window.__nrp.CAPS, o), caps1);
  {
    const L = (await logLines(page)).slice(n2), res = L.filter((x) => x.startsWith('result: '));
    check(L.some((x) => x.startsWith(APPROVED)) && (await page.evaluate(() => window.__nrp.program())) === pocket, 'case 21 (other swap): premise: the swap was approved and the game runs the swapped program');
    check(res.length === 1 && !res[0].startsWith('result: RULE BROKEN') && !res[0].includes(GIFT_RESULT), `case 21 (other swap): a swap that is not the page's own program is not taken as winnable (log: ${JSON.stringify(res)})`);
    check(c.st !== 'RULE BROKEN', `case 21 (other swap): the badge follows the search, which did not finish (got ${c.st})`);
  }
  await context.close();
}

async function case20() {
  // the flow chart with reduced motion: a still frame (the game at its resting place on the track, no glow, nothing running); premise: with
  // motion on, every figure animates. On phones, 320px and 390px: the sentence under the chart is body size (17px) and nothing scrolls sideways
  const tokX = (SRC.match(/\.fc-tok\{transform:translate\((-?\d+)px,0\)\}/) || [])[1], glowOp = (SRC.match(/\.fc-glow\{[^}]*opacity:([\d.]+)\}/) || [])[1];
  check(tokX !== undefined && glowOp !== undefined, 'case 20: premise: the page has the still-frame rules for the game token and the glows');
  const fig = (page) => page.evaluate(() => {
    const vis = [...document.querySelectorAll('#flow .flowfig')].filter((f) => getComputedStyle(f).display !== 'none' && f.getClientRects().length), f = vis[0];
    const tok = f && f.querySelector('.fc-tok');
    return { m: f && f.dataset.m, n: vis.length, tok: tok ? getComputedStyle(tok).transform : null, glows: f ? [...f.querySelectorAll('.fc-glow')].map((g) => getComputedStyle(g).opacity) : [],
      anims: f ? f.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length : -1,
      capFont: f && getComputedStyle(f.querySelector('figcaption')).fontSize, bodyFont: getComputedStyle(document.body).fontSize };
  });
  const choosable = (page) => page.evaluate(() => [...document.querySelectorAll('#seg button')].filter((b) => !b.disabled).map((b) => b.querySelector('span').textContent));
  let toks = 0;
  for (const reduce of [false, true]) {
    const context = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, reduce ? { reducedMotion: 'reduce' } : {}));
    const page = await context.newPage();
    page.on('pageerror', (e) => failures.push(`page error (case 20): ${e.message}`));
    await page.goto(`${ORIGIN}/${PAGE}`, { waitUntil: 'load' }); await ready(page);
    const names = await choosable(page);
    check(names.length >= 8, `case 20: premise: ${names.length} choosable switches`);
    for (const n of names) {
      await press(page, n); await sleep(150);
      const s = await fig(page), at = `case 20 (${reduce ? 'reduced motion' : 'motion'}, ${n})`;
      check(s.n === 1, `${at}: premise: one figure shown (${s.n})`);
      if (!reduce) { check(s.anims > 0, `${at}: premise: the figure animates with motion on (${s.anims})`); continue; }
      if (s.tok !== null) { toks++; check(s.tok === `matrix(1, 0, 0, 1, ${tokX}, 0)`, `${at}: the game sits ${tokX}px along the track (${s.tok})`); }
      check(s.glows.length > 0 && s.glows.every((o) => o === glowOp), `${at}: every glow at opacity ${glowOp} (${JSON.stringify(s.glows)})`);
      check(s.anims === 0, `${at}: ${s.anims} running animation(s)`);
    }
    await context.close();
  }
  check(toks > 0, 'case 20: premise: no figure with reduced motion had the travelling game');
  for (const width of [320, 390]) {
    const { context, page } = await open({ name: `case 20 ${width}px`, viewport: { width, height: 800 } });
    for (const n of ['Nothing', 'Judge']) {
      const at = `case 20 (${width}px, ${n})`;
      check(await press(page, n), `${at}: premise: a ${n} button`); await sleep(150);
      const s = await fig(page);
      check(s.capFont === s.bodyFont && s.capFont === '17px', `${at}: figcaption ${s.capFont}, body ${s.bodyFont} (want 17px both)`);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(sw <= 0, `${at}: the page scrolls sideways by ${sw}px`);
    }
    await context.close();
  }
}

// ---- the wording pass (Mo, 2026-10-04): one name for the model that writes a new game, "the AI writer", and no round label on the card a
// typed request ends on
const BARE_WRITER = /(?<!AI )\bthe writer/i;   // "the writer" that is not "the AI writer"
const BARE_WRITER_SEEN = /(?<!AI )\bwriter/i;   // in what a reader sees, the word never stands without "AI" at all ("AI writer: ..." in the log)
async function case22() {
  // "the writer" appears nowhere a reader can meet it without "AI" before it: not in the page's source outside whole-line // comments (so
  // every string the script holds, the chart and the first paint are covered), and not in what is drawn under any switch
  check(BARE_WRITER.test('goes back to the writer, up to 6 tries') && BARE_WRITER.test("The writer's note") && !BARE_WRITER.test('goes back to the AI writer') && !BARE_WRITER.test("The AI writer's note"),
    'case 22: premise: the matcher tells "the writer" from "the AI writer"');
  const hits = SRC.split('\n').map((l, i) => ({ n: i + 1, l })).filter((x) => BARE_WRITER.test(x.l) && !/^\s*\/\//.test(x.l))
    .map((x) => `line ${x.n}: ...${x.l.slice(Math.max(0, x.l.search(BARE_WRITER) - 60), x.l.search(BARE_WRITER) + 40)}...`);
  check(hits.length === 0, `case 22: "the writer" without "AI" in the page source, outside a whole-line comment:\n    ${hits.join('\n    ')}`);
  const { context, page } = await open({ name: 'case 22' });
  const names = await page.evaluate(() => [...document.querySelectorAll('#seg button')].filter((b) => !b.disabled).map((b) => b.querySelector('span').textContent));
  // premise: the name is in use, in the source at least once for every choosable switch's chart and once more for the script's own lines
  const named = (SRC.match(/the AI writer/gi) || []).length;
  check(names.length >= 8 && named > names.length, `case 22: premise: "the AI writer" appears ${named} times in the source for ${names.length} choosable switches`);
  let labelled = 0;
  for (const n of names) {
    await press(page, n); await sleep(150);
    const s = await page.evaluate(() => { const f = [...document.querySelectorAll('#flow .flowfig')].filter((x) => getComputedStyle(x).display !== 'none' && x.getClientRects().length);
      return { on: document.querySelector('#seg button.on span').textContent, figs: f.length, chart: f.map((x) => x.textContent).join('\n'), labels: f.flatMap((x) => [...x.querySelectorAll('text.fc-lbl')].map((t) => t.textContent)), body: document.body.innerText }; });
    check(s.on === n && s.figs === 1, `case 22 (${n}): premise: the switch is on ${s.on} with ${s.figs} chart(s) shown`);
    if (s.labels.includes('The AI writer')) labelled++;
    for (const [what, text] of [['the chart', s.chart], ['the page', s.body]]) {
      const at = text.search(BARE_WRITER_SEEN);
      check(at < 0, `case 22 (${n}): ${what} says "writer" without "AI": ...${text.slice(Math.max(0, at - 60), at + 40)}...`);
    }
  }
  check(labelled === names.length, `case 22: premise: the chart labels its second box "The AI writer" under ${labelled} of ${names.length} switches`);
  await context.close();
}

async function case23() {
  // the round label: a typed request's card opens with "Round N." only while the request is still being retried. The card it ends on has
  // none, under switches that ask once (Nothing, Prose, Construction: an accepted game, and a game that did not run) and under switches
  // that retry (Code (proof), Judge: the first answer is rejected and its card carries the label; the second is accepted and its card
  // does not). Premises: the label was made (the copied log names each tried game by it), and each run made the calls it should
  const ROUND = /Round \d+\./;
  const norun = pageLits(/'\. Fix that first\.', (LIT)\+chk\.error\+'\.', 'failed'\)/), rewriting = pageLits(/'round '\+label\+(LIT)\)/);
  check(norun && rewriting, 'case 23: premise: the page has the did-not-run card and the line it logs when a later try starts');
  if (!norun || !rewriting) return;
  const [NORUN_CARD] = norun, [REWRITING] = rewriting;
  const { context, page } = await open({ name: 'case 23', hash: '?mock' });
  await mockReady(page);
  const busyEnd = (what) => until(() => page.evaluate(() => !window.__nrp.busy()), 90000, what);
  const writes = () => page.evaluate(() => window.__mock.tiers.filter((x) => x.kind === 'write').length);
  const tried = () => page.evaluate(() => (window.__nrp.logText().match(/^==== program \d+ of \d+: (.*?) \[/gm) || []));
  const fresh = async (mode, what) => { await page.evaluate(() => window.__nrp.resetGame()); await busyEnd(what + ' reset');
    await page.evaluate((m) => { const k = window.__mock; k.delay = 30; k.repairs = true; k.model = null; k.program = null; k.judge = 'unwinnable'; k.judgeQueue = null; document.getElementById('clearlog').click(); window.__nrp.setMode(m); }, mode); };
  let seenText = '';
  const note = async () => { seenText += '\n' + await page.evaluate(() => document.body.innerText); };

  // switches that ask once: the card the request ends on
  for (const mode of ['nothing', 'prose', 'construction']) {
    for (const how of ['accepted', 'did not run']) {
      const at = `case 23 (${mode}, ${how})`;
      await fresh(mode, at);
      if (how === 'did not run') await page.evaluate(() => { window.__mock.program = 'function init( {'; });
      const w0 = await writes();
      await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
      await sleep(100); await busyEnd(at); await sleep(200);
      const c = await resultCard(page), t = await tried();
      await note();
      check((await writes()) - w0 === 1, `${at}: premise: one writer call (got ${(await writes()) - w0})`);
      check(t.length === 1 && ROUND.test(t[0]), `${at}: premise: the copied log names the game by its round label (${JSON.stringify(t)})`);
      if (how === 'accepted') check(/^RULE /.test(c.st) && c.why.length > 0, `${at}: premise: the request ended on a verdict with a sentence (${c.st}: ${JSON.stringify(c.why.slice(0, 80))})`);
      else check(c.why.includes(NORUN_CARD), `${at}: premise: the request ended on the did-not-run card (${JSON.stringify(c.why.slice(0, 120))})`);
      check(!ROUND.test(c.why), `${at}: the final card carries a round label (${JSON.stringify(c.why.slice(0, 120))})`);
    }
  }

  // switches that retry: the rejected first answer's card carries the label while the second try runs; the accepted second answer's does not
  for (const mode of ['proof', 'judge']) {
    const at = `case 23 (${mode}, retried)`;
    await fresh(mode, at);
    await page.evaluate((m) => { window.__mock.delay = 500; if (m === 'judge') window.__mock.judgeQueue = ['winnable', 'unwinnable']; }, mode);
    const w0 = await writes(); let mid = null;
    await page.evaluate(() => { window.__nrp.request('open the pocket', {}); });
    await until(async () => {
      const s = await page.evaluate((R) => ({ busy: window.__nrp.busy(), second: [...document.querySelectorAll('#log .l')].some((d) => /^round 2 of \d+/.test(d.textContent) && d.textContent.endsWith(R)), done: [...document.querySelectorAll('#log .l')].some((d) => /^result: /.test(d.textContent)) }), REWRITING);
      if (!mid && s.busy && s.second && !s.done) mid = (await resultCard(page)).why;
      return !s.busy && s.done;
    }, 120000, at);
    await sleep(200);
    const c = await resultCard(page), t = await tried();
    await note();
    check((await writes()) - w0 === 2, `${at}: premise: two writer calls, the rejected one and the accepted one (got ${(await writes()) - w0})`);
    check(t.length === 2 && t.every((x) => ROUND.test(x)), `${at}: premise: the copied log names both games by their round labels (${JSON.stringify(t)})`);
    check(typeof mid === 'string' && /^Round 1\. \S/.test(mid), `${at}: the card of the rejected first try, while the second runs, opens with its round label (${JSON.stringify(mid)})`);
    check(c.st === 'RULE HELD' && c.why.length > 0, `${at}: premise: the second answer was accepted (${c.st}: ${JSON.stringify(c.why.slice(0, 80))})`);
    check(!ROUND.test(c.why), `${at}: the final card carries a round label (${JSON.stringify(c.why.slice(0, 120))})`);
  }
  // what these runs put on the page (cards, log, status) never says "writer" without "AI"; premise: they did name the AI writer
  const bare = seenText.search(BARE_WRITER_SEEN);
  check(/the AI writer/.test(seenText), 'case 23: premise: the runs wrote "the AI writer" on the page');
  check(bare < 0, `case 23: the page says "writer" without "AI": ...${seenText.slice(Math.max(0, bare - 60), bare + 40)}...`);
  await context.close();
}

async function case9() {
  const keys = [KEY, KEY2];
  let apiSeen = 0;
  for (const { r, copy } of allRequests) {
    const url = r.url(), u = new URL(url);
    const api = url === API || (copy && url === SAPI);
    if (api) apiSeen++;
    check(api || u.origin === ORIGIN || (u.protocol === 'blob:' && url.startsWith('blob:' + ORIGIN)) || u.protocol === 'data:', `case 9: a request went to ${url}`);
    const headers = await r.allHeaders().catch(() => r.headers());
    const post = r.postData() || '';
    for (const k of keys) {
      check(!url.includes(k) && !post.includes(k), `case 9: the key is in the URL or body of ${url}`);
      for (const [h, v] of Object.entries(headers)) {
        if (String(v).includes(k)) check(api && h === 'x-api-key', `case 9: the key is in header ${h} of ${url}`);
      }
    }
  }
  check(apiSeen > 0, 'case 9: premise: no Anthropic request was recorded');
  check(allRequests.length > 50, `case 9: premise: only ${allRequests.length} requests were recorded`);
}

(async () => {
  makeServeDir();
  const server = spawn(process.env.PYTHON || 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: SERVE, stdio: 'ignore' });
  let srv;
  try {
    writeCopy();
    srv = await startStreamServer();
    await until(async () => { try { return (await fetch(ORIGIN + '/' + PAGE)).ok; } catch (e) { return false; } }, 10000, 'the http server');
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const only = process.env.CASES ? process.env.CASES.split(',') : null;
    const cases = [['1', case1], ['2', case2], ['3', case3], ['4', case4], ['5', case5], ['6', case6], ['7', case7], ['7b', case7b], ['8', case8], ['10', case10], ['11', case11], ['12', case12], ['13', case13], ['14', case14], ['15', case15], ['16', case16], ['17', case17], ['18', case18], ['19', case19], ['20', case20], ['21', case21], ['22', case22], ['23', case23], ['9', case9]];   // 9 last: it reads every request the others made
    for (const [n, fn] of cases) {
      if (only && !only.includes(n)) continue;
      const before = failures.length;
      try { await fn(); } catch (e) { failures.push(`case ${n}: ${e && e.message || e}`); }
      console.log(`case ${n}: ${failures.length === before ? 'ok' : 'FAILED'}`);
    }
  } catch (e) {
    failures.push('harness error: ' + (e && e.stack || e));
  } finally {
    if (browser) await browser.close();
    if (srv) { for (const r of stream.reqs) { try { r.res.destroy(); } catch (e) {} } srv.close(); }
    server.kill();
    try { fs.rmSync(SERVE, { recursive: true, force: true }); } catch (e) {}
  }
  if (failures.length) { console.log('FAILED play-behaviour\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('OK play-behaviour');
})();
