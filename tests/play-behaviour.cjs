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
  await until(async () => /the AI is writing/.test(await page.textContent('#log')), 15000, 'the first delta to render');
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
    const init = () => {
      window.__fakeCalls = 0;
      const text = 'SAY: Made a small five by five game with a door.\nWHY: Nothing ever raises the key count, so the goal never holds.\nPROGRAM:\n' + window.__PROGRAM__;
      // it names claude-opus-4-8 as the serving model both ways, which the page must never report on the claude.ai-hosted path
      const sample = async (input, opts) => { window.__fakeCalls++; if (opts && opts.onModel) opts.onModel('claude-opus-4-8'); if (opts && opts.onText) opts.onText({ text, delta: text }); return { text, truncated: false, modelTierApplied: 'complex', servedModel: 'claude-opus-4-8' }; };
      sample.json = async (input, opts) => { window.__fakeCalls++; if (opts && opts.onModel) opts.onModel('claude-opus-4-8'); return { winnable: false, reason: 'fake' }; };
      window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
    };
    routed = [];
    const { context, page } = await open({ name: 'case 7b claude.ai', init: `window.__PROGRAM__=${JSON.stringify(PROGRAM)};(${init})();` });
    const s = await state(page);
    check(!s.keybox, 'case 7b (claude.ai): the key box is shown');
    check(s.send === false, 'case 7b (claude.ai): Send is disabled');
    await setMode(page, 'Code (proof)');
    await ask(page, 'make a small different game with a door');
    await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'the claude.ai ask');
    check((await page.evaluate(() => window.__fakeCalls)) >= 1, 'case 7b (claude.ai): the ask did not go through claude.use("sample")');
    check(routed.length === 0, 'case 7b (claude.ai): the ask went to the network');
    const log = (await state(page)).log;
    check(/AI: Made a small five by five game/.test(log), 'case 7b (claude.ai): premise: the writer answer is not in the log');
    check(!MODEL_LINE.test(log), 'case 7b (claude.ai): a serving-model line on the claude.ai-hosted path:\n' + log);
    await context.close();
    // and a judge call on the claude.ai-hosted path
    const j = await open({ name: 'case 7b claude.ai Judge', init: `window.__PROGRAM__=${JSON.stringify(PROGRAM)};(${init})();` });
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
    check(/AI: Made a small five by five game/.test(log), `${at}: premise: the answer is not in the log`);
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
    check(/judge: passed|AI: Applied as asked/.test(log), `${at}: premise: the ${kind} answer was not used:\n` + log);
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
    const applied = /running the new program/.test(s.log);
    check(routed.length === 0, `${at}: an Anthropic request was made with no key`);
    check(/RULE HELD/.test(s.card), `${at}: the rule did not hold:\n${s.card}`);
    check(!/\u2014/.test(s.card), `${at}: an em dash on the card`);
    if (mode === 'Judge' && e === win) {
      // the literal program is caught by the simulated verdict; the page's repaired version is then judged let through, and runs
      check(s.log.includes('the page stands in for the judge on a canned change: rejected this program. a judge that reads the program correctly says it can be won: "' + q(e.why) + '".'), `${at}: the literal program was not caught by the stand-in verdict:\n${s.log}`);
      check(/the page has a repaired version of it/.test(s.log) && applied, `${at}: the repaired version did not run:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". The literal version was caught, so the page ran its repaired version. ' + SIM.judge_keep()), `${at}: card:\n${s.card}`);
    } else if (mode === 'Judge') {
      check(applied && /the page stands in for the judge on a canned change: passed\./.test(s.log), `${at}: the change was not applied:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". ' + SIM.judge_keep()), `${at}: card:\n${s.card}`);
    } else if (e === win) {
      check(!applied && !/the program goes to the check/.test(s.log), `${at}: the change was applied:\n${s.log}`);
      check(s.card.includes('You picked "' + e.name + '". ' + SIM.prose_win(e.why)), `${at}: card:\n${s.card}`);
    } else {
      check(applied && /applied\. nobody checked it\./.test(s.log), `${at}: the change was not applied:\n${s.log}`);
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
}

async function case15() {
  // Human, canned: every canned change reaches the panel with the fixed summary and the gift; Approve from the summary holds the rule; the
  // gift swapped in and approved breaks it. No model call.
  const BAIT = pageConst('HUMAN_BAIT'), held = pageLits(/return acceptOffer\(how\+\(r\.opened\?(LIT):(LIT)\)/), swap = pageLits(/undefined, how\+(LIT)\); \}/);
  check(typeof BAIT === 'string' && held && swap, 'case 15: premise: the page has HUMAN_BAIT and the approval texts');
  if (!BAIT || !held || !swap) return;
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
    await page.locator('#opts .opt', { hasText: name }).first().click();
    await page.waitForSelector('#approve .approve', { timeout: 60000 });
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
    const cases = [['1', case1], ['2', case2], ['3', case3], ['4', case4], ['5', case5], ['6', case6], ['7', case7], ['7b', case7b], ['8', case8], ['10', case10], ['11', case11], ['12', case12], ['13', case13], ['14', case14], ['15', case15], ['16', case16], ['17', case17], ['18', case18], ['9', case9]];   // 9 last: it reads every request the others made
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
