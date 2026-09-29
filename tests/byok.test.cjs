'use strict';
const assert = require('assert');
const path = require('path');

let unhandled = null;
process.on('unhandledRejection', (e) => { unhandled = e || new Error('unhandled rejection'); console.error('UNHANDLED REJECTION', e); process.exit(1); });

const { makeKeySample, looksLikeAnthropicKey, maskKey, parseSSE } = require(path.join(__dirname, '..', 'src', 'byok.js'));

const enc = new TextEncoder();
const KEY = 'sk-ant-api03-testQNoA';
const tick = () => new Promise((r) => setImmediate(r));

const ev = (name, obj) => `event: ${name}\ndata: ${JSON.stringify(obj)}\n\n`;
const textDelta = (t) => ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: t } });
const start = ev('message_start', { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } });
const stopDelta = (r) => ev('message_delta', { type: 'message_delta', delta: { stop_reason: r, stop_sequence: null }, usage: { output_tokens: 5 } });
const stopMsg = ev('message_stop', { type: 'message_stop' });
const thinking =
  ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }) +
  ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig' } }) +
  ev('content_block_stop', { type: 'content_block_stop', index: 0 });
const textStart = ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } });
const blockStop = ev('content_block_stop', { type: 'content_block_stop', index: 1 });
const ping = ev('ping', { type: 'ping' });

const happy = (parts) => start + thinking + textStart + parts.map(textDelta).join('') + blockStop + ping + stopDelta('end_turn') + stopMsg;
const HAPPY = happy(['Hello ', 'world']);

const streamRes = (chunks, init) =>
  new Response(new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch); c.close(); },
  }), init || { status: 200 });
const bytesOf = (s) => Array.from(enc.encode(s)).map((b) => new Uint8Array([b]));

const okFetch = (chunks) => async () => streamRes(chunks);
const run = (chunks, opts) => makeKeySample({ key: KEY, fetchImpl: okFetch(chunks) })('hi', opts);

async function rejects(p, code, extra) {
  let err;
  try { await p; } catch (e) { err = e; }
  assert(err, 'expected rejection ' + code);
  assert.strictEqual(err.code, code, 'expected ' + code + ' got ' + JSON.stringify(err));
  if (extra) extra(err);
  return err;
}

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t('1 key helpers', async () => {
  assert.strictEqual(looksLikeAnthropicKey('  sk-ant-api03-abcd1234\n'), true);
  assert.strictEqual(looksLikeAnthropicKey('sk-proj-abc'), false);
  assert.strictEqual(maskKey(' sk-ant-api03-xyzQNoA '), '····QNoA');
});

t('2 request shape', async () => {
  let seen;
  const f = async (url, init) => { seen = { url, init }; return streamRes([HAPPY]); };
  await makeKeySample({ key: '  ' + KEY + '\n', fetchImpl: f })('hi');
  assert.strictEqual(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(seen.init.method, 'POST');
  assert.deepStrictEqual(seen.init.headers, {
    'content-type': 'application/json',
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  const body = JSON.parse(seen.init.body);
  assert.strictEqual(body.model, 'claude-opus-5-5');
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.max_tokens, 16000);
  assert.deepStrictEqual(body.output_config, { effort: 'medium' });
  assert.deepStrictEqual(body.messages, [{ role: 'user', content: 'hi' }]);
  for (const k of ['thinking', 'temperature', 'budget_tokens']) assert(!(k in body), k + ' must be absent');
});

t('3 happy stream', async () => {
  const calls = [];
  const r = await run([HAPPY], { onText: (x) => calls.push(x) });
  assert.strictEqual(r.text, 'Hello world');
  assert.strictEqual(r.truncated, false);
  assert.strictEqual(r.modelTierApplied, 'complex');
  assert.deepStrictEqual(calls, [{ text: 'Hello ', delta: 'Hello ' }, { text: 'Hello world', delta: 'world' }]);
});

t('4 framing', async () => {
  const crlf = HAPPY.replace(/\n/g, '\r\n');
  assert.strictEqual((await run([crlf])).text, 'Hello world');
  assert.strictEqual((await run([HAPPY.replace(/data: /g, 'data:')])).text, 'Hello world');
  // JSON split across two data: lines
  const split = start + textStart +
    'event: content_block_delta\ndata: {\ndata: "type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello world"}}\n\n' +
    blockStop + stopDelta('end_turn') + stopMsg;
  assert.strictEqual((await run([split])).text, 'Hello world');
  // CRLF split across chunks between CR and LF, inside a multi-line data event: a spurious blank line would cut the event in two
  assert.strictEqual((await run(bytesOf(split.replace(/\n/g, '\r\n')))).text, 'Hello world');
  // boundaries everywhere: every byte its own chunk, LF and CRLF (mid-line, mid-CRLF)
  assert.strictEqual((await run(bytesOf(HAPPY))).text, 'Hello world');
  assert.strictEqual((await run(bytesOf(crlf))).text, 'Hello world');
  // bare CR line ends
  assert.strictEqual((await run([HAPPY.replace(/\n/g, '\r')])).text, 'Hello world');
  // explicit mid-line and mid-CRLF splits
  const i = crlf.indexOf('\r\n');
  assert.strictEqual((await run([crlf.slice(0, i + 1), crlf.slice(i + 1)])).text, 'Hello world');
  assert.strictEqual((await run([crlf.slice(0, i - 3), crlf.slice(i - 3)])).text, 'Hello world');
  // multi-byte character split across two chunks
  const emoji = happy(['Hi \u{1F600} there']);
  const bytes = enc.encode(emoji);
  const at = bytes.indexOf(0xf0) + 2;
  const r = await run([bytes.slice(0, at), bytes.slice(at)]);
  assert.strictEqual(r.text, 'Hi \u{1F600} there');
});

t('5 completion required', async () => {
  const noStop = start + textStart + textDelta('part') + blockStop + stopDelta('end_turn');
  await rejects(run([noStop]), 'upstream_error', (e) => assert.strictEqual(e.text, 'part'));
  const early = start + textStart + textDelta('first');
  await rejects(run([early]), 'upstream_error', (e) => assert.strictEqual(e.text, 'first'));
  await rejects(run([start + textStart + 'event: content_block_delta\ndata: {not json\n\n' + stopDelta('end_turn') + stopMsg]), 'upstream_error');
  await rejects(run([stopMsg]), 'upstream_error');
  // a stop reason and message_stop, but no message_start: not a whole answer
  await rejects(run([textStart + textDelta('x') + blockStop + stopDelta('end_turn') + stopMsg]), 'upstream_error', (e) => assert.strictEqual(e.text, 'x'));
  await rejects(run([start + textStart + blockStop + stopDelta('end_turn') + stopMsg]), 'empty_completion');
});

t('6 stop reasons', async () => {
  for (const r of ['max_tokens', 'model_context_window_exceeded']) {
    const out = await run([start + textStart + textDelta('cut') + blockStop + stopDelta(r) + stopMsg]);
    assert.strictEqual(out.truncated, true, r);
    assert.strictEqual(out.text, 'cut');
  }
  await rejects(run([start + textStart + textDelta('nope') + blockStop + stopDelta('refusal') + stopMsg]), 'refused', (e) => assert.strictEqual(e.text, 'nope'));
});

t('7 http errors', async () => {
  const errRes = (status, type, message) => async () =>
    new Response(JSON.stringify({ type: 'error', error: { type, message: message || 'm' } }), { status, headers: { 'content-type': 'application/json' } });
  const go = (f) => makeKeySample({ key: KEY, fetchImpl: f })('hi');
  await rejects(go(errRes(401, 'authentication_error')), 'bad_key');
  await rejects(go(errRes(403, 'permission_error')), 'permission');
  await rejects(go(errRes(402, 'billing_error')), 'no_credit');
  await rejects(go(errRes(400, 'invalid_request_error', 'Your credit balance is too low to access the API')), 'no_credit');
  await rejects(go(errRes(429, 'rate_limit_error')), 'rate_limited');
  await rejects(go(errRes(529, 'overloaded_error')), 'upstream_error');
  await rejects(go(errRes(500, 'api_error')), 'upstream_error');
  await rejects(go(errRes(400, 'invalid_request_error', 'bad field')), 'invalid_request');
  await rejects(go(errRes(404, 'not_found_error', 'model: claude-opus-5-5')), 'permission');
  const raw = (status) => async () => new Response('<html>gateway</html>', { status });
  await rejects(go(raw(401)), 'bad_key');
  await rejects(go(raw(429)), 'rate_limited');
  await rejects(go(raw(502)), 'upstream_error');
  await rejects(go(raw(404)), 'permission');
  await rejects(go(raw(402)), 'no_credit');
});

t('8 sse error event', async () => {
  const errEv = (type) => start + textStart + textDelta('so far') + ev('error', { type: 'error', error: { type, message: 'boom' } });
  await rejects(run([errEv('overloaded_error')]), 'upstream_error', (e) => assert.strictEqual(e.text, 'so far'));
  await rejects(run([errEv('rate_limit_error')]), 'rate_limited');
  await rejects(run([errEv('not_found_error')]), 'permission');   // the type alone, with no HTTP status behind it
});

t('9 network failure', async () => {
  const f = async () => { throw new TypeError('Failed to fetch'); };
  await rejects(makeKeySample({ key: KEY, fetchImpl: f })('hi'), 'upstream_error');
});

t('10a abort before start', async () => {
  const ac = new AbortController(); ac.abort();
  let called = false;
  const f = async () => { called = true; return streamRes([HAPPY]); };
  await rejects(makeKeySample({ key: KEY, fetchImpl: f })('hi', { signal: ac.signal }), 'cancelled');
  assert.strictEqual(called, false);
});

t('10b abort errors the body like native fetch', async () => {
  const ac = new AbortController();
  let ctrl, receivedSignal;
  const f = async (url, init) => {
    receivedSignal = init.signal;
    return new Response(new ReadableStream({
      start(c) {
        ctrl = c;
        init.signal.addEventListener('abort', () => c.error(new DOMException('Aborted', 'AbortError')));
        c.enqueue(enc.encode(start + textStart + textDelta('one')));
      },
    }));
  };
  let n = 0;
  const p = makeKeySample({ key: KEY, fetchImpl: f })('hi', { signal: ac.signal, onText: () => { n++; ac.abort(); } });
  await rejects(p, 'cancelled');
  assert.strictEqual(receivedSignal.aborted, true);
  assert.strictEqual(n, 1);
  try { ctrl.enqueue(enc.encode(textDelta('two'))); } catch (e) { /* errored body */ }
  await tick(); await tick();
  assert.strictEqual(n, 1, 'onText must not fire after abort');
});

t('10c abort resolves the pending read as EOF', async () => {
  const ac = new AbortController();
  let reads = 0;
  const f = async (url, init) => ({
    ok: true, status: 200,
    body: { getReader: () => ({
      read: () => {
        reads++;
        if (reads === 1) return Promise.resolve({ done: false, value: enc.encode(start + textStart + textDelta('one')) });
        return new Promise((resolve) => init.signal.addEventListener('abort', () => resolve({ done: true, value: undefined })));
      },
      cancel: () => Promise.resolve(),
    }) },
  });
  const p = makeKeySample({ key: KEY, fetchImpl: f })('hi', { signal: ac.signal, onText: () => setImmediate(() => ac.abort()) });
  await rejects(p, 'cancelled');
});

t('10d abort inside a chunk carrying several text deltas', async () => {
  const ac = new AbortController();
  let n = 0;
  const one = start + textStart + textDelta('a') + textDelta('b') + textDelta('c') + blockStop + stopDelta('end_turn') + stopMsg;
  const p = makeKeySample({ key: KEY, fetchImpl: okFetch([one]) })('hi', { signal: ac.signal, onText: () => { n++; ac.abort(); } });
  await rejects(p, 'cancelled');
  assert.strictEqual(n, 1, 'onText must fire exactly once, not for deltas after the abort');
});

t('12 empty chunk after a CR', async () => {
  // parser: a CR at a chunk's end, then an empty chunk, then the LF: one line end, not two
  const p = parseSSE();
  const got = [].concat(p.push('data: a\r'), p.push(''), p.push('\ndata: b\r\n\r\n'), p.end());
  assert.deepStrictEqual(got, [{ event: 'message', data: 'a\nb' }]);
  // through the adapter: a multi-line data event split at its CR, with an empty chunk between CR and LF
  const split = start + textStart +
    'event: content_block_delta\r\ndata: {\r\ndata: "type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello world"}}\r\n\r\n' +
    blockStop + stopDelta('end_turn') + stopMsg;
  const i = split.indexOf('data: {\r') + 'data: {\r'.length;
  assert.strictEqual((await run([split.slice(0, i), new Uint8Array(0), split.slice(i)])).text, 'Hello world');
});

t('13 no body', async () => {
  const f = async () => ({ ok: true, status: 200, body: null });
  await rejects(makeKeySample({ key: KEY, fetchImpl: f })('hi'), 'upstream_error');
});

t('14 a DOMException mid-stream is an upstream error, not rethrown', async () => {
  let reads = 0;
  const f = async () => ({
    ok: true, status: 200,
    body: { getReader: () => ({
      read: () => (++reads === 1 ? Promise.resolve({ done: false, value: enc.encode(start + textStart + textDelta('part')) })
        : Promise.reject(new DOMException('The network connection was lost.', 'NetworkError'))),
      cancel: () => Promise.resolve(),
    }) },
  });
  assert.strictEqual(typeof new DOMException('x', 'NetworkError').code, 'number', 'premise: a DOMException has a numeric code');
  await rejects(makeKeySample({ key: KEY, fetchImpl: f })('hi'), 'upstream_error', (e) => assert.strictEqual(e.text, 'part'));
});

t('11 json', async () => {
  const j = (s) => makeKeySample({ key: KEY, fetchImpl: okFetch([happy([s])]) }).json('hi');
  assert.deepStrictEqual(await j('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(await j('{"b":[2]}'), { b: [2] });
  await rejects(j('not json at all'), 'invalid_json');
});

(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); await tick(); await tick(); }
    catch (e) { console.error('FAIL ' + name + '\n' + (e && e.stack || e)); process.exit(1); }
    if (unhandled) { console.error('FAIL ' + name + ': unhandled rejection'); process.exit(1); }
  }
  await tick(); await tick();
  if (unhandled) process.exit(1);
  console.log('OK byok');
})();
