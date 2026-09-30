#!/usr/bin/env python3
"""Build the lean play page, index.html, from the public game build.

Usage: build/make-play-page.py [output]   (default: index.html at the repo root)

Input: build/input/game-public.html and src/byok.js. Every edit is anchored on an exact
source string and must match exactly the stated number of times, or the script exits
non-zero and writes nothing. The output depends only on the two inputs, so a fresh build
of the committed inputs is byte-for-byte the committed index.html (tests/rebuild-check.sh).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "build" / "input" / "game-public.html"
BYOK = ROOT / "src" / "byok.js"

# Anthropic's server-side fallback: when True, the shipped adapter asks for it (header anthropic-beta and body fallbacks:"default"),
# so a request Opus 5.5 declines is finished by the fallback model on the same stream. The one switch; the page reports the serving model either way.
USE_FALLBACK = True

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; "
       "connect-src https://api.anthropic.com")
POST_URL = "https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281"
ASK_MSG = ("To use Ask anything, paste an Anthropic API key below. It stays in your browser and is only "
           "sent to Anthropic. Until then, use Canned changes: ready-made changes that run without Claude.")
BAD_SHAPE = "This doesn't look like an Anthropic key. Anthropic keys start with sk-ant-."

# the writer's instruction to build the request as asked; the earlier wording ("You never refuse and you never substitute: ...")
# read as a jailbreak and was declined as cyber by Opus 5.5
WRITER_OLD = "You never refuse and you never substitute: if the player asks for something, build that thing."
WRITER_NEW = "Build what the player asks for, as asked."

# no API key: a canned change under Judge or Prose gets a simulated answer, derived from the change's own why line (QUICK, or REPAIR_WHY for the
# page's repaired versions). A why line that starts SIM_WIN describes a winnable version; the canned ones that keep the maze unwinnable start SIM_KEEP.
# The game then plays out exactly as it would with that answer. {why} is the why line, its closing full stop dropped. Wording approved by Mo, 2026-09-29.
SIM_WIN = "this version can be won: "
SIM_KEEP = "the pellet walled in on the right side of the maze is closed in on all four sides, so no move ever lands on it; "
SIM_TEXT = {
    "judge_win": 'Simulated judge: there is no API key, so no AI ran. This is the verdict a judge gives when it reads the program correctly: "{why}". A real judge is a model, and a model can be talked out of the right answer.',
    "judge_keep": 'Simulated judge: there is no API key, so no AI ran. A judge that reads the program correctly lets this change through, because the maze stays unwinnable: "{why}". A real judge is a model, and a model can be talked out of the right answer.',
    "prose_win": "Simulated: there is no API key, so no AI ran. An AI that follows the rule sentence would refuse this change, because this version can be won. A real AI reads that sentence as one line among many, and a request worded the right way can get past it.",
    "prose_keep": 'Simulated: there is no API key, so no AI ran. An AI that follows the rule sentence would apply this change, because the maze stays unwinnable: "{why}". A real AI reads that sentence as one line among many, and a request worded the right way can get past it.',
}
SIM_LOG = {
    "judge_win": 'simulated judge: rejected this program. there is no API key, so no AI ran; a judge that reads the program correctly says it can be won: "{why}".',
    "judge_keep": 'simulated judge: passed. there is no API key, so no AI ran; a judge that reads the program correctly says the maze stays unwinnable: "{why}".',
    "prose_win": "simulated (no API key, so no AI ran): not applied, because this version can be won.",
    "prose_keep": "simulated (no API key, so no AI ran): applied, because the maze stays unwinnable.",
}
# the only error texts that name claude.ai: the claude.ai host raises these codes, a reader's own key never does
HOSTED_ONLY = ("capability_disabled:'This viewer cannot call Claude from a page. Open the page in the claude.ai app.',",
               "session_expired:'Your claude.ai session expired. Sign in again and ask once more.',")

INTRO = (
    '<h1>The Unwinnable Maze</h1>\n'
    '  <p><b>Welcome to the Unwinnable Maze.</b> You\'ve likely arrived here from '
    f'<a href="{POST_URL}">the blog post that explains how those enforcers work</a>. '
    'Now comes the fun part!</p>\n\n  ')

KEYBOX = '''
      <div id="keybox" class="keybox">
        <label for="keyinput">Anthropic API key</label>
        <div class="keyrow"><input id="keyinput" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…"><button id="keysave" type="button">Use key</button></div>
        <p id="keystate" class="note" hidden>Key in use: <span id="keymasked"></span> <button id="forgetkey" type="button">Forget key</button></p>
        <p id="keyerr" class="note" role="alert" hidden></p>
        <details id="keyguide"><summary>How to get a key (2 minutes)</summary>
          <ol><li>Open <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">platform.claude.com/settings/keys</a> and sign in or create an account.</li>
          <li>If it asks, add a few dollars of credit. Leave automatic top-up off.</li>
          <li>Click Create key and set it to expire in 3 hours.</li>
          <li>Copy the key and paste it above.</li></ol>
          <p>The key stays in this tab until you close the tab or press Forget key. The page sends it only to Anthropic; the code is at <a href="https://github.com/marbaji/maze#how-your-api-key-is-handled" target="_blank" rel="noopener">github.com/marbaji/maze</a>.</p>
        </details>
      </div>'''

# the key box, styled from the page's own tokens and its .btn / .note / textarea rules; no new colours
KEYBOX_CSS = (
    ".keybox{margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--card)}\n"
    ".keybox label{display:block;font:600 13px/1.3 var(--sans);color:var(--ink);margin:0 0 6px}\n"
    ".keybox .keyrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\n"
    ".keybox input{flex:1 1 180px;min-width:0;min-height:44px;font:400 14px/1.3 var(--mono);padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink)}\n"
    ".keybox input:focus-visible{outline:2px solid var(--teal);outline-offset:3px}\n"
    ".keybox button{min-height:44px;padding:10px 16px;border-radius:8px;border:1.5px solid var(--line);background:var(--card);color:var(--ink);font:600 14px/1 var(--sans);cursor:pointer}\n"
    ".keybox #keysave{background:var(--teal);border-color:var(--teal);color:#fff}\n"
    ".keybox #keystate{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0}\n"
    ".keybox #keymasked{font:600 13px/1 var(--mono);color:var(--ink)}\n"
    ".keybox #keyerr{color:var(--sucks)}\n"
    ".keybox details{margin-top:8px;font:400 13px/1.45 var(--sans);color:var(--ink-2)}\n"
    ".keybox summary{cursor:pointer;color:var(--teal);font-weight:600;padding:10px 0}\n"
    ".keybox ol{margin:4px 0 8px;padding-left:20px}\n"
    ".keybox details p{margin:0}\n")

# the reader's own key: one function per transition, each ending in sync(), which derives the key box, Send and the capnote from state alone
CONTROLLER = r'''
// ---- the reader's own Anthropic key (the play page): MazeKey owns the key; one function per transition, each ending in sync(), which sets the key box,
// Send and the capnote from state alone. init() is the one entry point: it runs after capability discovery and returns what sampleNs becomes
const ASK_MSG=__ASK_MSG__;
const MazeKey=(()=>{ const SK='maze-anthropic-key', BAD_SHAPE=__BAD_SHAPE__, $=id=>document.getElementById(id);
  let mem=null, hosted=false, blocked=false, err='';   // mem: the key when sessionStorage throws (this visit only); blocked: no credit on the key in use
  const stored=()=>{ try{ const v=sessionStorage.getItem(SK); if(v) return v; }catch(e){} return mem; };
  const keep=k=>{ mem=null; try{ sessionStorage.setItem(SK,k); }catch(e){ mem=k; } };
  const drop=()=>{ mem=null; try{ sessionStorage.removeItem(SK); }catch(e){} sampleNs=null; blocked=false; };
  const halt=()=>{ if(busy) stopAsk(); };   // the page's own Stop: it aborts the request's controller, and through it every call in flight
  function sync(){ const box=$('keybox'); box.hidden=hosted; if(hosted) return;
    const k=stored(), send=$('send'), asking=!k||blocked;
    $('keystate').hidden=!k; $('keymasked').textContent=k?MazeByok.maskKey(k):'';
    $('keyinput').parentElement.hidden=!asking; box.querySelector('label').hidden=!asking;
    $('keyerr').textContent=err; $('keyerr').hidden=!err;
    if(asking) send.dataset.off='1'; else delete send.dataset.off;
    send.disabled=busy||!!send.dataset.off;
    $('capnote').textContent=k?'':ASK_MSG;
    showCanned(); $('cannedwhy').hidden=true; }   // canned changes need no key, so with a reader's key their tab is always there; the capnote carries the Ask-tab message; the canned tab's own copy of it would say it twice
  function init(claudeSample){ if(claudeSample){ hosted=true; sync(); return claudeSample; }
    const k=stored(); sampleNs=k?MazeByok.makeKeySample({key:k}):null; sync(); return sampleNs; }
  function save(raw){ const k=String(raw||'').trim();
    if(!MazeByok.looksLikeAnthropicKey(k)){ err=BAD_SHAPE; sync(); return false; }
    halt(); keep(k); sampleNs=MazeByok.makeKeySample({key:k}); blocked=false; err=''; $('keyinput').value=''; sync(); return true; }
  function forget(){ halt(); drop(); err=''; $('keyinput').value=''; sync(); }
  function reject(code){ if(!KEY_STOP.includes(code)) return; if(ctl) ctl.abort();
    if(code==='no_credit') blocked=true; else drop(); err=failText({code}); sync(); }
  $('keysave').addEventListener('click',()=>save($('keyinput').value));
  $('keyinput').addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); save($('keyinput').value); } });
  $('forgetkey').addEventListener('click',()=>forget());
  return Object.freeze({init, save, forget, reject, sync, isHosted:()=>hosted}); })();
window.MazeKey=MazeKey;
'''.replace("__ASK_MSG__", json.dumps(ASK_MSG)).replace("__BAD_SHAPE__", json.dumps(BAD_SHAPE))

# a model call with its own controller, linked to the request's (ctl): Stop and Forget abort it through ctl; a timeout aborts only this call
TIMED_CALL = (
    "const KEY_STOP=['bad_key','permission','no_credit'];   // the key's own errors end the request from any stage; the top-level handler hands them to MazeKey.reject\n"
    "function timedCall(call, ms){ const parent=ctl, child=new AbortController(); const link=()=>child.abort();\n"
    "  if(parent){ if(parent.signal.aborted) child.abort(); else parent.signal.addEventListener('abort', link); }\n"
    "  let tm; return Promise.race([call(child.signal), new Promise((_,rej)=>{ tm=setTimeout(()=>{ rej({code:'timeout'}); child.abort(); }, ms); })])\n"
    "    .finally(()=>{ clearTimeout(tm); if(parent) parent.signal.removeEventListener('abort', link); }); }   // the timeout settles the race first, so its abort is never read as a Stop\n")

# a writer round, judge call or Prose gate call answered by a model other than Opus 5.5 (Anthropic's fallback, or its routing) gets one log line
# naming it; never on the claude.ai-hosted path, whose sample is not the key adapter
MODEL_NOTE = (
    "function modelName(id){ const p=String(id).replace(/-\\d{8}$/,'').split('-'), w=p.filter(x=>!/^\\d+$/.test(x)), n=p.filter(x=>/^\\d+$/.test(x));\n"
    "  return w.map(x=>x.charAt(0).toUpperCase()+x.slice(1)).join(' ')+(n.length?' '+n.join('.'):''); }   // claude-opus-4-8 -> Claude Opus 4.8\n"
    "function modelNote(id, who){ if(MazeKey.isHosted()||typeof id!=='string'||!id||id==='claude-opus-5-5') return;\n"
    "  logLine('think',(who||'this round')+' was answered by '+modelName(id)+', not Opus 5.5.'); }\n")

# the simulated answers (no API key): one derivation, simWinnable, from the why line
SIM_JS = (
    "const SIM_WIN=" + json.dumps(SIM_WIN) + ", SIM_TEXT=" + json.dumps(SIM_TEXT) + ", SIM_LOG=" + json.dumps(SIM_LOG) + ";\n"
    "function simWinnable(why){ return String(why||'').startsWith(SIM_WIN); }\n"
    "function simKey(kind, why){ return kind+(simWinnable(why)?'_win':'_keep'); }\n"
    "function simFill(s, why){ const q=String(why||'').replace(/\\.$/,''); return s.replace('{why}', ()=>q); }   // the why line, its closing full stop dropped\n"
    "function simText(kind, why){ return simFill(SIM_TEXT[simKey(kind, why)], why); }\n"
    "function simLog(kind, why){ return simFill(SIM_LOG[simKey(kind, why)], why); }\n")


def fail(msg):
    sys.exit(f"FAILED: {msg}")


def check_sim(t):
    """The sentinel for the simulated answers: every canned change's why line has one of the two known shapes (so a new entry
    cannot be simulated by accident), both shapes occur, and no repaired version reads as winnable."""
    a = t.index("const QUICK = [\n")
    block = t[a:t.index("\n];", a)]
    ids = re.findall(r"\{id:'(\w+)'", block)
    whys = [json.loads('"' + w + '"') for w in re.findall(r'why:"((?:[^"\\]|\\.)*)"', block)]
    if not ids or len(ids) != len(whys):
        fail(f"QUICK: {len(ids)} entries but {len(whys)} why lines")
    for i, w in zip(ids, whys):
        if w.startswith(SIM_WIN) == w.startswith(SIM_KEEP):
            fail(f"QUICK {i}: the why line matches neither simulated shape (or both): {w!r}")
    if not any(w.startswith(SIM_WIN) for w in whys) or not any(w.startswith(SIM_KEEP) for w in whys):
        fail("QUICK: the why lines do not include both a winnable and an unwinnable change")
    a = t.index("const REPAIR_WHY = {\n")
    reps = re.findall(r'^ (\w+): "((?:[^"\\]|\\.)*)",$', t[a:t.index("\n};", a)], flags=re.M)
    if len(reps) != len(re.findall(r"^ (\w+):", t[a:t.index("\n};", a)], flags=re.M)) or not reps:
        fail("REPAIR_WHY: could not read every entry")
    for i, w in reps:
        if w.startswith(SIM_WIN):
            fail(f"REPAIR_WHY {i}: a repaired version reads as winnable")


def rep(text, old, new, count, label):
    found = text.count(old)
    if found != count:
        fail(f"{label}: expected {count} match(es), found {found}")
    return text.replace(old, new)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "index.html"
    if len(sys.argv) > 2:
        fail("usage: make-play-page.py [output]")
    t = SRC.read_text(encoding="utf-8")
    byok = BYOK.read_text(encoding="utf-8")
    if "</script" in byok.lower():
        fail("src/byok.js contains a closing script tag")

    # 1. title and CSP (the CSP meta first in the document's head)
    t = rep(t, "<title>how-to-make-ai-follow-your-instructions-every-time</title>", "<title>Unwinnable Maze</title>", 1, "title")
    if not t.startswith("<!doctype html><html><head>"):
        fail("document does not open with <!doctype html><html><head>")
    t = t.replace("<!doctype html><html><head>",
                  f'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{CSP}">', 1)

    # 2. drop the article's header, the section nav, and everything in #read before h2#read-play (byline, #read-open, #read-levers, #read-fires)
    n = len(re.findall(r"<header>.*?</header>\n", t, flags=re.S))
    if n != 1:
        fail(f"header: expected 1 match, found {n}")
    t = re.sub(r"<header>.*?</header>\n", "", t, count=1, flags=re.S)
    n = len(re.findall(r'<nav class="nav"[^\n]*?</nav>\n', t))
    if n != 1:
        fail(f"nav: expected 1 match, found {n}")
    t = re.sub(r'<nav class="nav"[^\n]*?</nav>\n', "", t, count=1)
    a, h = '<article id="read" class="read">\n  ', '<h2 id="read-play">'
    for s in (a, h):
        if t.count(s) != 1:
            fail(f"{s!r}: expected 1 match, found {t.count(s)}")
    i, j = t.index(a) + len(a), t.index(h)
    if not (i < j and '<div class="byline">' in t[i:j] and 'id="read-open"' in t[i:j] and 'id="read-levers"' in t[i:j]):
        fail("the article's opening does not hold the byline, #read-open and #read-levers before #read-play")
    # 3. the h1 and the intro before h2#read-play; the section's own paragraphs from "The enforcer starts on" on
    t = t[:i] + INTRO + t[j:]
    t = rep(t, "<p>Now comes the fun part! The enforcer starts on", "<p>The enforcer starts on", 1, "first play paragraph")

    # 4. the two no-Claude strings become the Ask-tab message
    t = rep(t, "note.textContent='The AI needs the claude.ai viewer to answer. Canned changes work without it, except Prose and Judge, which ask the AI a question.'; document.getElementById('send').disabled=true; showCanned(); }",
            "note.textContent=ASK_MSG; document.getElementById('send').disabled=true; showCanned(); MazeKey.sync(); }", 1, "capnote no-Claude string")
    t = rep(t, "const CANNED_WHY='Claude cannot answer on this page for you, so the Canned changes tab is open: ready-made changes that run without it.';",
            "const CANNED_WHY=" + json.dumps(ASK_MSG) + ";", 1, "CANNED_WHY")

    # 4b. every other reader-visible string that assumed the claude.ai viewer now points at the key box
    t = rep(t, "each round is one call on your claude.ai account, about half a minute.",
            "each round is one call on your API key, about half a minute.", 2, "round cost")
    t = rep(t, "now.why+=(pre.length?' The page\\u2019s own repaired version was rejected too, and this viewer has no AI to go on with.':' This viewer has no AI.')+' Open the page in the claude.ai app and the AI keeps the request and finds another way to hold the rule.';",
            "now.why+=(pre.length?' The page\\u2019s own repaired version was rejected too, and the AI needs a key to go on.':' The AI needs a key to go on.')+' Paste an Anthropic API key in the Ask tab and the AI keeps the request and finds another way to hold the rule.';",
            1, "caught without the AI")
    t = rep(t, "const saidWinnable=!!(verdict&&verdict.winnable); const reason=String(verdict ? (verdict.reason||'(no reason given)') : 'no viewer, so no judge; the change was let through unjudged').slice(0,240);",
            "if(!verdict){ const w=ctx.whyLine;   // no key: the simulated verdict, from the change's own why line\n"
            "      if(simWinnable(w)){ logLine('no', simLog('judge', w)+stands); return reject('the judge said the game can be won: '+w, simText('judge', w), 'judge'); }\n"
            "      logLine('ok', simLog('judge', w)); const said=how+' '+simText('judge', w); return acceptOffer(said, said); }\n"
            "    const saidWinnable=!!verdict.winnable; const reason=String(verdict.reason||'(no reason given)').slice(0,240);",
            1, "Judge without a key")

    # 5. the key box under the capnote
    t = rep(t, '<div class="note" id="capnote"></div>', '<div class="note" id="capnote"></div>' + KEYBOX, 1, "capnote div")

    # 6. byok.js inline, before the game's main script
    byok = rep(byok, "const FALLBACK = false;", "const FALLBACK = " + ("true" if USE_FALLBACK else "false") + ";", 1, "adapter FALLBACK")
    t = rep(t, "</div>\n\n<script>\n(() => {\n'use strict';",
            "</div>\n\n<script>\n" + byok.rstrip("\n") + "\n</script>\n<script>\n(() => {\n'use strict';", 1, "main script start")

    # 7. the key controller, inside the game's script so it shares sampleNs, ctl, busy and stopAsk; init() is the one entry point
    t = rep(t, "let sampleNs=null, ctl=null, pendingApprove=null;\n", "let sampleNs=null, ctl=null, pendingApprove=null;" + CONTROLLER, 1, "sampleNs declaration")
    t = rep(t, "sampleNs = MOCK ? mockSample() : await use('sample');", "sampleNs = MOCK ? mockSample() : MazeKey.init(await use('sample'));", 1, "sampleNs assignment")

    # 8. the key's error texts, and the three key errors end the request from Code, Judge and Prose alike
    t = rep(t, "    invalid_request:'The page made a malformed call to Claude. That is a bug in the page: '+String(e&&e.message||'').slice(0,160),\n",
            "    invalid_request:'Anthropic refused the request. Try a shorter request.',\n"
            "    bad_key:'Anthropic rejected this key. Check it was copied whole, or create a new one, then paste it again.',\n"
            "    permission:'This key isn\\'t allowed to use this model. Create a new key in the default workspace, then paste it again.',\n"
            "    no_credit:'Your Anthropic account has no credit left. Add credit at platform.claude.com/settings/billing, then ask again.',\n",
            1, "T invalid_request")
    t = rep(t, "const GATE_PASS=['not_granted','sampling_disabled','not_declared','capability_disabled','session_expired','prompt_too_large','invalid_request'];",
            TIMED_CALL + MODEL_NOTE + SIM_JS + "const GATE_PASS=['not_granted','sampling_disabled','not_declared','capability_disabled','session_expired','prompt_too_large','invalid_request','bad_key','permission','no_credit'];",
            1, "GATE_PASS")
    # 9. Judge and Prose: each call gets a child controller linked to ctl; the timeout aborts only the child and keeps each path's own behaviour
    t = rep(t, "const askJudge=async()=>{ let tm; try{ const v=await Promise.race([sampleNs.json(judgePrompt(src, say||how), { signal: ctl?ctl.signal:undefined, cache:false, modelTier:'complex' }), new Promise((_,rej)=>{ tm=setTimeout(()=>rej({code:'timeout'}), judgeMs()); })]); return (v&&typeof v==='object'&&typeof v.winnable==='boolean') ? {v} : {err:'unreadable reply'}; }catch(e){ if(e&&e.code==='cancelled') throw e; return {err:String((e&&e.code)||'error')}; }finally{ clearTimeout(tm); } };",
            "const askJudge=async()=>{ try{ let m=null; const v=await timedCall(signal=>sampleNs.json(judgePrompt(src, say||how), { signal, cache:false, modelTier:'complex', onModel:x=>{ m=x; } }), judgeMs()); modelNote(m, 'the judge call'); return (v&&typeof v==='object'&&typeof v.winnable==='boolean') ? {v} : {err:'unreadable reply'}; }catch(e){ if(e&&(e.code==='cancelled'||KEY_STOP.includes(e.code))) throw e; return {err:String((e&&e.code)||'error')}; } };",
            1, "Judge call")
    t = rep(t, "{ let tm; try{ g=await Promise.race([sampleNs.json(proseGatePrompt(opts.gate), { signal: ctl.signal, cache:false, modelTier:'complex' }), new Promise((_,rej)=>{ tm=setTimeout(()=>rej({code:'timeout'}), judgeMs()); })]); }\n"
               "        catch(e){ if(e&&(e.code==='cancelled'||GATE_PASS.includes(e.code))) throw e; noAnswer=gateReason(e&&e.code); } finally{ clearTimeout(tm); } }",
            "{ try{ let m=null; g=await timedCall(signal=>sampleNs.json(proseGatePrompt(opts.gate), { signal, cache:false, modelTier:'complex', onModel:x=>{ m=x; } }), judgeMs()); modelNote(m, 'the call on whether to apply it'); }\n"
            "        catch(e){ if(e&&(e.code==='cancelled'||GATE_PASS.includes(e.code))) throw e; noAnswer=gateReason(e&&e.code); } }",
            1, "Prose gate call")
    t = rep(t, "send.disabled=true; send.dataset.off='1'; showCanned(); } }\n  }finally{ finishRequest(my);",
            "send.disabled=true; send.dataset.off='1'; showCanned(); }\n      if(e&&KEY_STOP.includes(e.code)) MazeKey.reject(e.code); }\n  }finally{ finishRequest(my);",
            1, "top-level error handler")

    # 9a. no key: the simulated Judge and Prose answers (the texts in SIM_TEXT); the judge's "reading" lines only when a judge is asked
    t = rep(t, "if(mode==='judge'){ status.textContent='the judge (Opus) is reading the program\\u2026'; logLine('think','the judge (Opus) is reading the program\\u2026'); costNote('ask'); let verdict=null, silent='';",
            "if(mode==='judge'){ if(sampleNs){ status.textContent='the judge (Opus) is reading the program\\u2026'; logLine('think','the judge (Opus) is reading the program\\u2026'); costNote('ask'); } let verdict=null, silent='';",
            1, "Judge reading lines")
    t = rep(t, "      status.textContent='asking the AI whether to apply it\\u2026'; logLine('think','asking Opus whether to apply it. the only thing in its way is one sentence.');\n"
               "      if(!sampleNs){ now.why='Prose needs the AI, and this viewer has none. Nothing applied.'; quizState='ask'; renderCard(); return; }\n",
            "      if(!sampleNs){ const w=opts.gate.why;   // no key: the simulated answer, from the change's own why line\n"
            "        logLine(simWinnable(w)?'no':'ok', simLog('prose', w));\n"
            "        if(simWinnable(w)){ now.say=''; now.why='You picked \"'+opts.gate.name+'\". '+simText('prose', w); quizState='ask'; renderCard(); return; }\n"
            "        pre[0].sim=simText('prose', w); }\n"
            "      else { status.textContent='asking the AI whether to apply it\\u2026'; logLine('think','asking Opus whether to apply it. the only thing in its way is one sentence.');\n",
            1, "Prose gate without a key")
    t = rep(t, "      pre[0].say=say; }\n    for(let i=0;i<pre.length;i++){",
            "      pre[0].say=say; } }\n    for(let i=0;i<pre.length;i++){", 1, "Prose gate block end")
    t = rep(t, "const r=await enforce(c.src, c.say||'', c.how, ctx(true, {whyLine:c.why, from:'page'}));",
            "const r=await enforce(c.src, c.say||'', c.how, ctx(true, {whyLine:c.why, from:'page', sim:c.sim}));", 1, "pre ctx sim")
    t = rep(t, "if(mode==='nothing'||mode==='prose'){ logLine('ok','applied. nobody checked it.'); return acceptOffer(how+(mode==='prose'?",
            "if(mode==='nothing'||mode==='prose'){ logLine('ok','applied. nobody checked it.'); if(ctx.sim) return acceptOffer(how+' '+ctx.sim, how+' '+ctx.sim); return acceptOffer(how+(mode==='prose'?",
            1, "Prose simulated accept")
    check_sim(t)

    # 9b. the writer's instruction, reworded; and the serving model reported after each writer round
    t = rep(t, WRITER_OLD, WRITER_NEW, 1, "writer instruction")
    t = rep(t, "lastSay=say; logLine('think','AI: '+say); if(reply&&reply.why) logLine('think','AI, why: '+reply.why);",
            "lastSay=say; logLine('think','AI: '+say); if(reply&&reply.why) logLine('think','AI, why: '+reply.why); modelNote(res.servedModel);", 1, "writer round model note")

    # 10. the key box's styles, at the end of the page's main stylesheet
    t = rep(t, "@media (prefers-reduced-motion:reduce){.jdg .clip,.verdict{animation:none;opacity:1;transform:none}}\n</style>",
            "@media (prefers-reduced-motion:reduce){.jdg .clip,.verdict{animation:none;opacity:1;transform:none}}\n" + KEYBOX_CSS + "</style>",
            1, "main stylesheet end")

    # 11. SES state, observable without mock mode: each worker posts SES_STATE once at start; the page keeps it in window.MazeStatus.ses
    t = rep(t, "if (IS_NODE) wt.parentPort.on('message', onMessage); else self.onmessage = function(ev) { onMessage(ev.data); };\n`;",
            "if (IS_NODE) wt.parentPort.on('message', onMessage); else self.onmessage = function(ev) { onMessage(ev.data); };\n"
            "if (!IS_NODE) post({ sesState: typeof SES_STATE === 'string' ? SES_STATE : 'off: not loaded' });\n`;",
            1, "worker message hookup")
    t = rep(t, "this.w.onmessage=(ev)=>{ const d=ev.data; const p=this.pending.get(d.id);",
            "this.w.onmessage=(ev)=>{ const d=ev.data; if(d&&typeof d.sesState==='string'){ sesState=d.sesState; return; } const p=this.pending.get(d.id);",
            1, "Box onmessage")
    t = rep(t, "const MOCK=/[?&]mock/.test(location.search);\n",
            "const MOCK=/[?&]mock/.test(location.search);\n"
            "let sesState=null; Object.defineProperty(window,'MazeStatus',{value:Object.freeze(Object.defineProperty({},'ses',{get:()=>sesState,enumerable:true}))});   // read-only: the worker's SES state, 'on' or 'off: ...'\n",
            1, "MOCK flag")

    # controller ruling: the bug-report link points at the public repo
    t = rep(t, "const BUG_REPO='https://github.com/marbaji/unwinnable-maze';", "const BUG_REPO='https://github.com/marbaji/maze';", 1, "BUG_REPO")

    for s in ("You never refuse", "claude.ai viewer", "Claude cannot answer on this page", "this viewer has", "no viewer, so no judge"):
        if s in t:
            fail(f"{s!r} is still in the page")
    # claude.ai may appear only in the two error texts that only the claude.ai-hosted page can raise; anywhere else
    # (strings, markup, and comments too, since the build cannot tell them apart reliably) fails the build
    rest = t
    for s in HOSTED_ONLY:
        if rest.count(s) != 1:
            fail(f"hosted-only text {s!r}: expected 1 match, found {rest.count(s)}")
        rest = rest.replace(s, "")
    if "claude.ai" in rest:
        k = rest.index("claude.ai")
        fail(f"'claude.ai' outside the claude.ai-hosted error texts: ...{rest[max(0, k - 80):k + 40]!r}...")
    out.write_text(t, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
