#!/usr/bin/env python3
"""Build the play page, index.html, from its source.

Usage: build/make-play-page.py [output]   (default: index.html at the repo root)

The source is src/game.html: the whole page, edited directly. The build makes one change to it: the line MARKER
is replaced by the key adapter, src/byok.js, which stays a module of its own so tests/byok.test.cjs can test it.
Then check_page() reads the assembled page and refuses to write it if the page contradicts itself (the list is in
its docstring). A failed build exits non-zero and writes nothing. The output depends only on the two source files
and this script, so a fresh build is byte for byte the committed index.html (tests/rebuild-check.sh).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "game.html"
BYOK = ROOT / "src" / "byok.js"
MARKER = "/*@@ build/make-play-page.py puts src/byok.js here @@*/\n"

# Anthropic's server-side fallback: when True, the shipped adapter asks for it (header anthropic-beta and body fallbacks:"default"),
# so a request Opus 5.5 declines is finished by the fallback model on the same stream. The one switch; the page reports the serving model either way.
USE_FALLBACK = True

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src 'self' blob:; "
       "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; "
       "connect-src https://api.anthropic.com")
# the page opens with exactly this, so the policy is in force before anything else in the head is read
HEAD = f'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="{CSP}">'
POST_URL = "https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281"

# texts written for the claude.ai-hosted original, which a reader of this page must never meet
VIEWER_PHRASES = ("You never refuse", "claude.ai viewer", "Claude cannot answer on this page", "this viewer has", "no viewer, so no judge")
# the only error texts that name claude.ai: the claude.ai host raises these codes, a reader's own key never does
HOSTED_ONLY = ("capability_disabled:'This viewer cannot call Claude from a page. Open the page in the claude.ai app.',",
               "session_expired:'Your claude.ai session expired. Sign in again and ask once more.',")
# code no reader can reach, removed on 2026-10-04; none of it may come back by a paste
DEAD_NAMES = ("gateNoAnswer", "proseGatePrompt", "gateReason", "GATE_UNCLEAR", "GATE_PASS", "asking the AI whether to apply it")
# a canned change that keeps the maze unwinnable opens its why line with this, then a semicolon or a full stop; one
# that makes it winnable opens with the page's own SIM_WIN. The simulated answers (no API key) are told apart by that opening.
SIM_KEEP = "the pellet walled in on the right side of the maze is closed in on all four sides, so no move ever lands on it"
# the title is laid out as a ladder by a width measured in the title's own type for its last line: (last line, width)
LADDER = ("Every Time", "4.78em")
# the title the page's renderSeg() gives a switch that cannot be chosen
OFF_TITLE = "not choosable: nobody trained a model about this game"
# the first paint's card leaves out the clauses the page's posH() drops while the canned changes are hidden
POSH_DROPS = ("the canned changes are disabled and ", "a canned change runs its repaired version, ")


def fail(msg):
    sys.exit(f"FAILED: {msg}")


def one(pattern, text, what, flags=0):
    found = list(re.finditer(pattern, text, flags))
    if len(found) != 1:
        fail(f"{what}: expected 1 match, found {len(found)}")
    return found[0]


def once(text, s, what):
    if text.count(s) != 1:
        fail(f"{what}: expected 1 match, found {text.count(s)}")


def field(row, name, mid, required=True):
    """The text of a single-quoted field of a MODES row, as the page would show it."""
    found = re.findall(r"[{,]" + name + r":'((?:[^'\\]|\\.)*)'", row)
    if len(found) > 1:
        fail(f"MODES row {mid} has {name} {len(found)} times; the page's script would use the last")
    if not found:
        if required:
            fail(f"MODES row {mid} has no {name}")
        return None
    return re.sub(r"\\(.)", r"\1", found[0])


def check_sim(t):
    """Every canned change's why line has one of the two known shapes (so a new entry cannot be simulated by
    accident), both shapes occur, and no repaired version reads as winnable."""
    sim_win = json.loads(one(r'const SIM_WIN=("(?:[^"\\]|\\.)*"),', t, "SIM_WIN").group(1))
    if not sim_win:
        fail("SIM_WIN is empty")
    once(t, "const QUICK = [\n", "QUICK table start")
    a = t.index("const QUICK = [\n")
    block = t[a:t.index("\n];", a)]
    ids, whys = [], []
    for line in (x for x in block.split("\n")[1:] if x.strip()):   # one canned change a line: its id and its one why line
        i, w = re.findall(r"^ \{id:'(\w+)'", line), re.findall(r'[{,]\s*why:"((?:[^"\\]|\\.)*)"', line)
        if len(i) != 1 or len(w) != 1:
            fail(f"QUICK: every line must be one entry with its why line; this one has {len(i)} ids and {len(w)} why lines: {line[:60]}")
        ids.append(i[0])
        whys.append(json.loads('"' + w[0] + '"'))
    if len(ids) < 2 or len(set(ids)) != len(ids):
        fail(f"QUICK ids: {ids}")
    keeps = lambda w: w.startswith(SIM_KEEP + "; ") or w.startswith(SIM_KEEP + ". ")
    for i, w in zip(ids, whys):
        if w.startswith(sim_win) == keeps(w):
            fail(f"QUICK {i}: the why line matches neither simulated shape (or both): {w!r}")
    if not any(w.startswith(sim_win) for w in whys) or not any(keeps(w) for w in whys):
        fail("QUICK: the why lines do not include both a winnable and an unwinnable change")
    once(t, "const REPAIR_WHY = {\n", "REPAIR_WHY table start")
    a = t.index("const REPAIR_WHY = {\n")
    body = t[a:t.index("\n};", a)]
    reps = re.findall(r'^ (\w+): "((?:[^"\\]|\\.)*)",$', body, flags=re.M)
    lines = [x for x in body.split("\n")[1:] if x.strip()]   # one repaired version a line, counted apart from the read
    if not reps or len(reps) != len(lines):
        fail(f"REPAIR_WHY: could not read every entry ({len(lines)} lines, {len(reps)} read)")
    for i, w in reps:
        if json.loads('"' + w + '"').startswith(sim_win):
            fail(f"REPAIR_WHY {i}: a repaired version reads as winnable")


def check_switch(t):
    """The script's MODES table, the opening position, the copy above the switch and the first paint (what the page
    shows before its script runs) all say the same thing. The first paint and the copy are hand-written."""
    m = one(r"^const MODES=\[\n(.*?)\n\];", t, "MODES table", re.S | re.M)
    rows = []
    for line in m.group(1).split("\n"):
        rid = re.match(r" \{id:'([a-z]+)',", line)
        if not rid or not line.endswith("},"):
            fail(f"unreadable MODES row: {line[:60]}")
        rows.append((rid.group(1), line))
    ids = [mid for mid, _ in rows]
    if len(rows) < 2 or len(set(ids)) != len(ids):
        fail(f"MODES ids: {ids}")
    names = {mid: field(row, "name", mid) for mid, row in rows}
    off = {mid for mid, row in rows if re.search(r",disabled:true[,}]", row)}
    arts = [field(row, "art", mid) for mid, row in rows]
    if len(set(arts)) != len(rows):
        fail(f"MODES rows must each have their own article anchor: {arts}")

    # the opening position: a choosable row, and the first one
    start = one(r"^let mode='(\w+)'; let programBy=null;", t, "opening position", re.M).group(1)
    if start not in ids or start in off:
        fail(f"the opening position {start!r} is not a choosable MODES id")
    if ids[0] != start:
        fail(f"the page opens on {start!r}, but MODES starts with {ids[0]!r}")
    srow = dict(rows)[start]

    # the copy above the switch names the opening position and counts the enforcers after it
    if f'The first switch, "{names[start]},"' not in t:
        fail(f'the copy above the switch does not call "{names[start]}" the first switch')
    counts = re.findall(r"\b(\d+) (?:enforcers|categories)\b", t)
    if not counts:
        fail("the copy no longer says how many enforcers there are; drop this check if that is meant")
    if any(int(c) != len(rows) - 1 for c in counts):
        fail(f"the page says {sorted(set(counts))} enforcers or categories somewhere (copy or script); MODES holds {len(rows) - 1} after the first position")

    # the first paint of the switch: the rows' names in table order, one selected, the opening one
    seg = one(r'<div class="seg" id="seg">(.*?)</div>\n', t, "static switch").group(1)
    buttons = re.findall(r"<button.*?</button>", seg)
    if "".join(buttons) != seg:
        fail("static switch holds something other than buttons")
    shown = [(re.search(r"<span>(.*?)</span>", b) or [None, None])[1] for b in buttons]
    if shown != [names[mid] for mid in ids]:
        fail(f"static switch reads {shown}; MODES reads {[names[mid] for mid in ids]}")
    on = [i for i, b in enumerate(buttons) if b.startswith('<button class="on">')]
    if on != [ids.index(start)] or seg.count('class="on"') != 1:
        fail(f"static switch: the one selected button must be {names[start]!r}")
    if {ids[i] for i, b in enumerate(buttons) if ' disabled=""' in b.split(">", 1)[0]} != off:
        fail("static switch: the buttons that cannot be chosen differ from MODES")
    # each button whole, as the page's renderSeg() draws it: a row that cannot be chosen has its title and no line under its name
    for (mid, row), b in zip(rows, buttons):
        tag = (f'<button class="off" disabled="" title="{OFF_TITLE}">' if mid in off
               else '<button class="on">' if mid == start else "<button>")
        want = tag + f"<span>{names[mid]}</span>" + ("" if mid in off else f"<small>{field(row, 'sub', mid)}</small>") + "</button>"
        if b != want:
            fail(f"static switch: the {names[mid]!r} button reads {b}; MODES says {want}")

    # the first paint of the card, rebuilt from the opening row, and the result slot's badge
    h = field(srow, "h", start)
    for drop in POSH_DROPS:
        h = h.replace(drop, "")
    by = field(srow, "by", start, required=False) or field(srow, "sub", start)
    link = f'<a href="{POST_URL}#{field(srow, "art", start)}" target="_blank" rel="noopener">Read more in the article</a>'
    card = (f'<div class="card pos" id="pos"><div class="top"><span class="badge">{names[start]}</span></div>'
            f'<div class="r">The rule "You can never win" is enforced by {by}</div>'
            f'<div class="h"><b>What it is.</b> {field(srow, "def", start)}</div><div class="h"><b>In this game.</b> {h}</div>'
            f'<div class="h"><b>When to use it.</b> {field(srow, "use", start)} {link}.</div></div>\n')
    once(t, '<div class="card pos" id="pos">', "static card")
    if card not in t:
        fail(f"the static card is not what the {start!r} row of MODES says; it should read: {card}")
    once(t, f'<div class="card slot" id="card"><div class="top"><span class="badge">{names[start]}</span></div>', "static result slot's badge")

    # the chart: opens on the opening position, one figure for each choosable row, in order, each with its show rule
    once(t, f'<div class="flowbox" id="flow" data-m="{start}">', "chart box opening on the opening position")
    figs = re.findall(r'<figure class="flowfig" data-m="(\w+)">', t)
    want = [mid for mid in ids if mid not in off]
    if figs != want:
        fail(f"the chart's figures are {figs}; the choosable rows are {want}")
    for mid in want:
        once(t, f'#flow[data-m="{mid}"] .flowfig[data-m="{mid}"]{{display:grid}}\n', f"chart show rule for {mid}")


def check_page(t):
    """What the page must not contradict:
    it opens with HEAD (the Content Security Policy first in the head); no text written for the claude.ai viewer is
    left, and claude.ai is named only in the two hosted-only error texts; the removed unreachable code is absent;
    the canned changes' why lines have the shapes the simulated answers rely on (check_sim); the switch table, the
    opening position, the copy and the first paint agree (check_switch); the title has the four lines its stylesheet
    places, the last being the one its width was measured for."""
    if not t.startswith(HEAD):
        fail("the page does not open with the doctype, <html><head> and the Content Security Policy")
    once(t, 'http-equiv="Content-Security-Policy"', "Content Security Policy tag")
    for s in VIEWER_PHRASES:
        if s in t:
            fail(f"{s!r} is still in the page")
    # claude.ai anywhere else (strings, markup, and comments too, since the build cannot tell them apart reliably) fails
    rest = t
    for s in HOSTED_ONLY:
        once(rest, s, f"hosted-only text {s!r}")
        rest = rest.replace(s, "")
    if "claude.ai" in rest:
        k = rest.index("claude.ai")
        fail(f"'claude.ai' outside the claude.ai-hosted error texts: ...{rest[max(0, k - 80):k + 40]!r}...")
    for name in DEAD_NAMES:
        if name in t:
            fail(f"{name!r} is on the page; it was removed as unreachable code")
    check_sim(t)
    check_switch(t)
    lines = re.findall(r"<span>(.*?)</span>", one(r'<h1 class="lad">(.*?)</h1>', t, "title").group(1))
    if len(lines) != 4:
        fail(f"the title has {len(lines)} lines; the stylesheet places four")
    if lines[-1] != LADDER[0] or t.count(f".read h1.lad{{text-wrap:nowrap;--last:{LADDER[1]}}}") != 1:
        fail("the title's last line or its width changed; measure the last line's width in em in the title's type "
             "and update --last in the stylesheet and LADDER here")


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "index.html"
    if len(sys.argv) > 2:
        fail("usage: make-play-page.py [output]")
    t = SRC.read_text(encoding="utf-8")
    byok = BYOK.read_text(encoding="utf-8")
    if "</script" in byok.lower():
        fail("src/byok.js contains a closing script tag")
    old = "const FALLBACK = false;"
    once(byok, old, "adapter FALLBACK")
    byok = byok.replace(old, "const FALLBACK = " + ("true" if USE_FALLBACK else "false") + ";")
    once(t, MARKER, "the line where src/byok.js goes")
    once(t, "<script>\n" + MARKER + "</script>\n", "the adapter's own script element around that line")
    t = t.replace(MARKER, byok.rstrip("\n") + "\n")
    check_page(t)
    out.write_text(t, encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
