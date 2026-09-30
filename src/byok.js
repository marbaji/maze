(function (root) {
  const API = 'https://api.anthropic.com/v1/messages', MODEL = 'claude-opus-5-5';
  const FALLBACK = false;   // Anthropic's server-side fallback (a declined request is finished by another model); build/make-play-page.py sets it from USE_FALLBACK
  const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
  const clean = s => String(s || '').trim();
  const looksLikeAnthropicKey = s => /^sk-ant-[A-Za-z0-9_-]{8,}$/.test(clean(s));
  const maskKey = s => '····' + clean(s).slice(-4);
  const fail = (code, message, text) => (text ? { code, message, text } : { code, message });
  const TYPE_CODE = { authentication_error: 'bad_key', permission_error: 'permission', billing_error: 'no_credit',
    not_found_error: 'permission', rate_limit_error: 'rate_limited', overloaded_error: 'upstream_error', api_error: 'upstream_error', timeout_error: 'upstream_error' };
  function codeFor(type, status, message) {
    if (type === 'invalid_request_error' || (!type && status === 400)) return /credit balance/i.test(message || '') ? 'no_credit' : 'invalid_request';
    if (TYPE_CODE[type]) return TYPE_CODE[type];
    if (status === 401) return 'bad_key'; if (status === 402) return 'no_credit'; if (status === 403 || status === 404) return 'permission'; if (status === 429) return 'rate_limited';
    if (status >= 500) return 'upstream_error'; return 'invalid_request';
  }
  function parseSSE() { // WHATWG event-stream: CR, LF or CRLF line ends; 'field:value' with one optional leading space; multi-line data joined by '\n'
    let buf = '', pendingCR = false, ev = '', data = [];
    const out = [];
    const line = l => {
      if (l === '') { if (data.length) out.push({ event: ev || 'message', data: data.join('\n') }); ev = ''; data = []; return; }
      if (l[0] === ':') return;
      const i = l.indexOf(':'); const f = i < 0 ? l : l.slice(0, i); let v = i < 0 ? '' : l.slice(i + 1); if (v[0] === ' ') v = v.slice(1);
      if (f === 'event') ev = v; else if (f === 'data') data.push(v);
    };
    return {
      push(s) {
        if (!s) return out.splice(0); // an empty chunk says nothing about a CR the last chunk ended on
        if (pendingCR && s[0] === '\n') s = s.slice(1); pendingCR = false;
        buf += s; let m;
        while ((m = /\r\n|\r|\n/.exec(buf))) {
          if (m[0] === '\r' && m.index === buf.length - 1) { line(buf.slice(0, m.index)); buf = ''; pendingCR = true; break; }
          line(buf.slice(0, m.index)); buf = buf.slice(m.index + m[0].length);
        }
        return out.splice(0);
      },
      end() { return out.splice(0); } // a trailing event without its blank line is discarded, per the spec
    };
  }
  function makeKeySample({ key, fetchImpl, fallback }) {
    const k = clean(key); const doFetch = fetchImpl || ((...a) => root.fetch(...a));
    const useFallback = fallback === undefined ? FALLBACK : !!fallback;
    async function sample(input, opts = {}) {
      const sig = opts.signal;
      if (sig && sig.aborted) throw fail('cancelled', 'Stopped.');
      const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input;
      let res;
      try {
        const headers = { 'content-type': 'application/json', 'x-api-key': k,
          'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
        const body = { model: MODEL, max_tokens: 16000, stream: true, output_config: { effort: 'medium' }, messages };
        if (useFallback) { headers['anthropic-beta'] = FALLBACK_BETA; body.fallbacks = 'default'; }
        res = await doFetch(API, { method: 'POST', signal: sig, headers, body: JSON.stringify(body) });
      } catch (e) { throw (sig && sig.aborted) ? fail('cancelled', 'Stopped.') : fail('upstream_error', 'Could not reach Anthropic.'); }
      if (!res.ok) { let t = '', m = ''; try { const j = await res.json(); t = j.error.type; m = j.error.message; } catch (e) {}
        throw fail(codeFor(t, res.status, m), m || ('HTTP ' + res.status)); }
      if (!res.body) throw fail('upstream_error', 'The answer arrived empty.');
      const reader = res.body.getReader(), dec = new TextDecoder(), sse = parseSSE();
      let text = '', stop = null, done = false, started = false, model = null;
      const served = m => { if (typeof m !== 'string' || !m || m === model) return; model = m;   // the model answering now: message_start names it, a fallback block hands over
        if (typeof opts.onModel === 'function') opts.onModel(m); };
      const handle = e => {
        let d; try { d = JSON.parse(e.data); } catch (x) { throw fail('upstream_error', 'The answer arrived garbled.', text); }
        if (d.type === 'content_block_delta' && d.delta && d.delta.type === 'text_delta') {
          if (sig && sig.aborted) return; text += d.delta.text;
          if (typeof opts.onText === 'function') opts.onText({ text, delta: d.delta.text });
        } else if (d.type === 'message_start') { started = true; served(d.message && d.message.model); }
        else if (d.type === 'content_block_start' && d.content_block && d.content_block.type === 'fallback') served(d.content_block.to && d.content_block.to.model);   // no deltas follow; the next model continues the text
        else if (d.type === 'message_delta' && d.delta) stop = d.delta.stop_reason || stop;
        else if (d.type === 'message_stop') done = true;
        else if (d.type === 'error') { const er = d.error || {}; throw fail(codeFor(er.type, 0, er.message), er.message || 'Stream error', text); }
      };
      try {
        for (;;) {
          if (sig && sig.aborted) throw fail('cancelled', 'Stopped.', text);
          const { value, done: eof } = await reader.read();
          if (sig && sig.aborted) throw fail('cancelled', 'Stopped.', text); // checked after every await, before EOF is classified
          if (eof) { for (const e of sse.push(dec.decode()).concat(sse.end())) handle(e); break; }
          for (const e of sse.push(dec.decode(value, { stream: true }))) handle(e);
        }
      } catch (e) {
        try { await reader.cancel(); } catch (x) {} // cancel() returns a promise that rejects on an errored body
        if (sig && sig.aborted) throw fail('cancelled', 'Stopped.', text);
        if (e && typeof e.code === 'string') throw e; throw fail('upstream_error', 'The answer stopped early.', text); // the adapter's own errors carry a string code; a DOMException's code is a number
      }
      if (!done || !started || !stop) throw fail('upstream_error', 'The answer stopped early.', text);
      if (!text && stop === 'end_turn') throw fail('empty_completion', 'Claude sent an empty answer.');
      if (stop === 'refusal') { const e = fail('refused', 'Claude declined this request.', text); if (model) e.servedModel = model; throw e; }
      return { text, truncated: stop === 'max_tokens' || stop === 'model_context_window_exceeded', modelTierApplied: 'complex', servedModel: model };
    }
    sample.json = async (input, opts = {}) => {
      const { text } = await sample(input, opts);
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/); const raw = (m ? m[1] : text).trim();
      try { return JSON.parse(raw); } catch (e) { throw fail('invalid_json', 'The answer was not valid JSON.', text); }
    };
    return sample;
  }
  const api = { makeKeySample, looksLikeAnthropicKey, maskKey, parseSSE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MazeByok = api;
})(typeof window !== 'undefined' ? window : globalThis);
