'use strict';
// Behaviour tests of the play page (index.html), with no real key and without ?mock.
//   node tests/play-behaviour.cjs
// Two transports: page.route() fulfils complete Anthropic answers; a small Node streaming server on 127.0.0.1:8766 holds a stream open
// (Stop, Forget, timeouts). The streaming cases load a TEST COPY of index.html written next to it, with the adapter's API constant, the CSP
// connect-src and the judge timeout pointed at the test; the shipped page is never changed and has no URL override.
// PLAYWRIGHT_PATH (optional) points at a playwright install; CHROME (optional) at a Chromium binary; PYTHON (optional) at python3.
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8765, ORIGIN = `http://127.0.0.1:${PORT}`;
const SPORT = 8766, SORIGIN = `http://127.0.0.1:${SPORT}`;
const API = 'https://api.anthropic.com/v1/messages', SAPI = `${SORIGIN}/v1/messages`;
const COPY = '.play-stream-copy.html';
const COPY_JUDGE_MS = 4000;
const KEY = 'sk-ant-api03-testQNoA', KEY2 = 'sk-ant-api03-testN3W1';   // fake, short: never a real key
const ASK_MSG = 'To use Ask anything, paste an Anthropic API key below. It stays in your browser and is only sent to Anthropic. Until then, use Canned changes: ready-made changes that run without Claude.';
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
const sseStart = ev('message_start', { type: 'message_start', message: { id: 'msg_t', role: 'assistant', content: [] } }) +
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
const sseDelta = (t) => ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const sseEnd = ev('content_block_stop', { type: 'content_block_stop', index: 0 }) +
  ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }) +
  ev('message_stop', { type: 'message_stop' });
const sse = (text) => sseStart + sseDelta(text.slice(0, 20)) + sseDelta(text.slice(20)) + sseEnd;
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
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access' };
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
  let t = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const swap = (a, b) => { const n = t.split(a).length - 1; if (n !== 1) throw new Error(`test copy: ${JSON.stringify(a)} matched ${n} times`); t = t.replace(a, b); };
  swap(`const API = '${API}'`, `const API = '${SAPI}'`);
  swap('connect-src https://api.anthropic.com"', `connect-src ${SORIGIN}"`);
  swap('const JUDGE_MS=120000;', `const JUDGE_MS=${COPY_JUDGE_MS};`);
  fs.writeFileSync(path.join(ROOT, COPY), t);
}

let browser;
async function open(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 900 } });
  if (opts.init) await context.addInitScript(opts.init);
  const page = await context.newPage();
  const file = opts.copy ? COPY : 'index.html';
  const failed = [];
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
      if (a === 'ok') return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'text/event-stream' }, cors), body: sse(OK_ANSWER[kind]) });
      const e = ERR[a];
      return route.fulfill({ status: e.status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify({ type: 'error', error: { type: e.type, message: e.message } }) });
    });
  }
  await page.goto(`${ORIGIN}/${file}${opts.hash || ''}`, { waitUntil: 'load' });
  await ready(page);
  return { context, page, failed };
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
  // the first canned change applies: the walled-in pellet is no longer out of reach
  check((await page.textContent('#unr')) === '1', 'case 1: premise: one pellet starts out of reach');
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
  check((await state(page)).send === false, 'case 4: Send is not enabled after the answer');
  await context.close();
}

// the streaming server: wait for a call of this kind to arrive, return it
const arrived = (kind, n) => until(() => stream.reqs.filter((r) => r.kind === kind).length >= n && stream.reqs.filter((r) => r.kind === kind)[n - 1], 30000, `${kind} call #${n}`);
const aborted = (failed) => failed.some((f) => f.url === SAPI && /ABORT/i.test(f.error));

async function case5() {
  stream.reqs = []; stream.plan.writer = [{ how: 'hold', first: 'SAY: first words ' }];
  const { context, page, failed } = await open({ copy: true, name: 'case 5' });
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
  await context.close();
}

async function case6() {
  // credential and billing errors in Code (typed: the writer), Judge (canned: the judge) and Prose (canned: the gate)
  for (const [mode, how, kind] of [['Code (proof)', 'ask', 'writer'], ['Judge', 'canned', 'judge'], ['Prose', 'canned', 'gate']]) {
    for (const code of ['bad_key', 'permission', 'no_credit']) {
      routed = [];
      const { context, page } = await open({ name: `case 6 ${mode} ${code}`, answers: { [kind]: [code] } });
      const at = `case 6 (${mode}, ${code})`;
      await saveKey(page, KEY);
      if (mode !== 'Code (proof)') await setMode(page, mode);
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
  // Stop and Forget while each model-call stage is active
  const stages = [['Code (proof)', 'ask', 'writer'], ['Judge', 'canned', 'judge'], ['Prose', 'canned', 'gate']];
  for (const [mode, how, kind] of stages) {
    for (const action of ['stop', 'forget']) {
      const at = `case 7 (${action} during the ${kind} call)`;
      stream.reqs = []; stream.plan = { writer: [], judge: [], gate: [] }; stream.plan[kind] = [{ how: 'hold' }];
      const { context, page, failed } = await open({ copy: true, name: at });
      await saveKey(page, KEY);
      if (mode !== 'Code (proof)') await setMode(page, mode);
      if (how === 'ask') await ask(page, 'make a small different game with a door'); else await canned(page, 0);
      const rec = await arrived(kind, 1);
      await sleep(300);
      if (how === 'canned') await page.click('#tabFree');   // Stop and the key box live on the Ask tab
      await page.click(action === 'stop' ? '#stop' : '#forgetkey');
      // well inside the copy's judge timeout (COPY_JUDGE_MS), so only Stop or Forget can have aborted it
      await until(() => aborted(failed), 1500, at).catch(() => {});
      check(aborted(failed), `${at}: the request was not aborted`);
      await until(() => rec.closed, 1500, at + ' server close').catch(() => {});
      check(rec.closed, `${at}: the server still holds the connection`);
      await idle(page);
      const s = await state(page);
      if (action === 'stop') check(/Stopped\./.test(s.card) && /stopped\./.test(s.log), `${at}: no cancelled state`);
      else {
        check(!Object.values(s.ss).some((v) => /sk-ant/.test(v)) && !s.keystate, `${at}: the key was not cleared`);
        check(s.send === true && s.capnote === ASK_MSG, `${at}: Send disabled=${s.send}, capnote ${JSON.stringify(s.capnote)}`);
      }
      await context.close();
    }
  }
  // a timeout aborts that call: Judge retries exactly once; Prose does not retry and shows its no-answer result; neither is a Stop
  {
    const at = 'case 7 (Judge timeout)';
    stream.reqs = []; stream.plan = { writer: [], judge: [{ how: 'hang' }, { how: 'ok' }], gate: [] };
    const { context, page, failed } = await open({ copy: true, name: at });
    await saveKey(page, KEY);
    await setMode(page, 'Judge');
    await canned(page, 0);
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
  {
    const at = 'case 7 (Prose timeout)';
    stream.reqs = []; stream.plan = { writer: [], judge: [], gate: [{ how: 'hang' }, { how: 'ok' }] };
    const { context, page, failed } = await open({ copy: true, name: at });
    await saveKey(page, KEY);
    await setMode(page, 'Prose');
    await canned(page, 0);
    const first = await arrived('gate', 1);
    await idle(page);
    await until(() => first.closed || aborted(failed), 3000, at + ' abort').catch(() => {});
    check(first.closed || aborted(failed), `${at}: the timed-out call was not aborted`);
    await sleep(COPY_JUDGE_MS + 500);
    const s = await state(page);
    check(stream.reqs.filter((r) => r.kind === 'gate').length === 1, `${at}: ${stream.reqs.filter((r) => r.kind === 'gate').length} gate calls, want exactly 1`);
    check(/the AI did not answer \(the request timed out\)/.test(s.log) && /did not apply the change/.test(s.card), `${at}: no no-answer result`);
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
    await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'a canned change after the key was rejected');
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
      const sample = async (input, opts) => { window.__fakeCalls++; if (opts && opts.onText) opts.onText({ text, delta: text }); return { text, truncated: false, modelTierApplied: 'complex' }; };
      sample.json = async () => { window.__fakeCalls++; return { winnable: false, reason: 'fake' }; };
      window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
    };
    routed = [];
    const { context, page } = await open({ name: 'case 7b claude.ai', init: `window.__PROGRAM__=${JSON.stringify(PROGRAM)};(${init})();` });
    const s = await state(page);
    check(!s.keybox, 'case 7b (claude.ai): the key box is shown');
    check(s.send === false, 'case 7b (claude.ai): Send is disabled');
    await ask(page, 'make a small different game with a door');
    await until(async () => /result: RULE HELD/.test(await page.textContent('#log')), 30000, 'the claude.ai ask');
    check((await page.evaluate(() => window.__fakeCalls)) >= 1, 'case 7b (claude.ai): the ask did not go through claude.use("sample")');
    check(routed.length === 0, 'case 7b (claude.ai): the ask went to the network');
    await context.close();
  }
}

async function case8() {
  const { context, page } = await open({ name: 'case 8', hash: '#read-play' });
  await sleep(500);
  const top = await page.evaluate(() => document.getElementById('read-play').getBoundingClientRect().top);
  const y = await page.evaluate(() => window.scrollY);
  check(y > 0 && top >= 0 && top <= 120, `case 8: #read-play top is ${top}px (scrollY ${y})`);
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
  const server = spawn(process.env.PYTHON || 'python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  let srv;
  try {
    writeCopy();
    srv = await startStreamServer();
    await until(async () => { try { return (await fetch(ORIGIN + '/index.html')).ok; } catch (e) { return false; } }, 10000, 'the http server');
    browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
    const only = process.env.CASES ? process.env.CASES.split(',') : null;
    const cases = [['1', case1], ['2', case2], ['3', case3], ['4', case4], ['5', case5], ['6', case6], ['7', case7], ['7b', case7b], ['8', case8], ['9', case9]];   // 9 last: it reads every request the others made
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
    try { fs.unlinkSync(path.join(ROOT, COPY)); } catch (e) {}
  }
  if (failures.length) { console.log('FAILED play-behaviour\n  ' + failures.join('\n  ')); process.exit(1); }
  console.log('OK play-behaviour');
})();
