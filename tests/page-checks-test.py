#!/usr/bin/env python3
"""The page checks in build/make-play-page.py can fail: python3 tests/page-checks-test.py

Each row of M breaks one thing the build promises to refuse, in a fresh copy of src/ and build/ in a temporary
folder. The build must then exit non-zero, say the expected thing, and write no output. The unchanged copy must
build, so a check that refuses everything fails here too. A mutation whose anchor is no longer in the source
stops the test (an assert), so a reworded source cannot quietly empty this list."""
import importlib.util, re, shutil, subprocess, sys, tempfile
from pathlib import Path
WT = Path(__file__).resolve().parent.parent
G, B = "src/game.html", "src/byok.js"

def sub(old, new, count=1):
    def f(t):
        assert t.count(old) == count, f"mutation anchor {old[:50]!r}: {t.count(old)} matches, wanted {count}"
        return t.replace(old, new)
    return f
def rx(pat, new, flags=0):
    def f(t):
        t2, n = re.subn(pat, new, t, flags=flags)
        assert n >= 1, f"mutation pattern {pat[:50]!r} matched nothing"
        return t2
    return f
# the build's own lists (the marker, the texts it refuses), so a text added there is exercised here without being retyped
sys.dont_write_bytecode = True
_spec = importlib.util.spec_from_file_location("make_play_page", WT / "build" / "make-play-page.py")
BUILD = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(BUILD)
MARK = BUILD.MARKER
assert MARK and len(BUILD.VIEWER_PHRASES) >= 2 and len(BUILD.HOSTED_ONLY) == 2 and len(BUILD.DEAD_NAMES) >= 2
M = [  # (name, file, mutation, text the failure must contain)
 ("adapter holds a closing script tag", B, lambda t: t + "// </script>\n", "closing script tag"),
 ("adapter's FALLBACK line gone", B, sub("const FALLBACK = false;", "const FALLBACK=false;"), "adapter FALLBACK"),
 ("marker line missing", G, sub(MARK, ""), "the line where src/byok.js goes: expected 1 match, found 0"),
 ("marker line doubled", G, sub(MARK, MARK + MARK), "the line where src/byok.js goes: expected 1 match, found 2"),
 ("marker not alone in its script element", G, sub("<script>\n" + MARK, "<script>\nvar x=1;\n" + MARK), "the adapter's own script element"),
 ("script before the policy tag", G, sub("<!doctype html><html><head><meta http-equiv", "<!doctype html><html><head><script>1</script><meta http-equiv"), "does not open with"),
 ("policy text changed", G, sub("connect-src https://api.anthropic.com\">", "connect-src https://api.anthropic.com https://example.com\">"), "does not open with"),
 ("second policy tag", G, sub("<meta charset=utf8>", "<meta charset=utf8><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\">"), "Content Security Policy tag: expected 1 match, found 2"),
 ("claude.ai named elsewhere", G, sub("<footer", "<!-- see claude.ai --><footer"), "'claude.ai' outside"),
 ("an unwinnable why line with other punctuation after its opening", G, sub("so no move ever lands on it. Gravity", "so no move ever lands on it, Gravity"), "matches neither simulated shape"),
 ("the canned changes' table not found", G, sub("const QUICK = [\n", "const QUICKS = [\n"), "QUICK table start: expected 1 match, found 0"),
 ("the repaired table not found", G, sub("const REPAIR_WHY = {\n", "const REPAIR_WHYS = {\n"), "REPAIR_WHY table start: expected 1 match, found 0"),
 ("SIM_WIN empty", G, sub('const SIM_WIN="this version can be won: ",', 'const SIM_WIN="",'), "SIM_WIN is empty"),
 ("two MODES rows share an id", G, sub(" {id:'prose',name:'Prose'", " {id:'nothing',name:'Prose'"), "MODES ids"),
 ("a MODES row without its article anchor", G, sub("art:'b22d'}", "artx:'b22d'}"), "MODES row prose has no art"),
 ("the opening row without its 'what it is' text", G, sub(",def:'\"Nothing\" means nobody", ",deff:'\"Nothing\" means nobody"), "MODES row nothing has no def"),
 ("the MODES table not found", G, sub("\nconst MODES=[\n", "\nconst MODEZ=[\n"), "MODES table: expected 1 match, found 0"),
 ("the opening position's line not found", G, sub("let mode='nothing'; let programBy=null;", "let mode = 'nothing'; let programBy=null;"), "opening position: expected 1 match, found 0"),
 ("the static switch not found", G, sub('<div class="seg" id="seg">', '<div class="seg" id="segx">'), "static switch: expected 1 match, found 0"),
 ("the title not found", G, sub('<h1 class="lad">', '<h1 class="ladder">'), "title: expected 1 match, found 0"),
 ("a row that cannot be chosen says so last in its row, and its static button can be chosen", G,
  lambda t: sub('<button class="off" disabled="" title="not choosable', '<button class="off" title="not choosable')(sub("art:'461c'},", "art:'461c',disabled:true},")(sub(",disabled:true,h:'This would mean", ",h:'This would mean")(t))),
  "the buttons that cannot be chosen differ"),
 ("why line of unknown shape", G, sub('why:"this version can be won: every inner wall', 'why:"this one can be won: every inner wall'), "matches neither simulated shape"),
 ("no unwinnable canned change left", G, rx(r"^ \{id:'(knife|noghosts|gravity)'.*\n", "", re.M), "do not include both"),
 ("no winnable canned change left", G, rx(r"^ \{id:'(pocket|nowalls|wormhole|jetpack|drill)'.*\n", "", re.M), "do not include both"),
 ("a canned change without a why line", G, sub('why:"this version can be won: every inner wall', 'whynot:"this version can be won: every inner wall'), "this one has 1 ids and 0 why lines"),
 ("repaired version reads as winnable", G, sub(' pocket: "the shy pellet is never eaten', ' pocket: "this version can be won: the shy pellet is never eaten'), "a repaired version reads as winnable"),
 ("repaired entry unreadable", G, sub(' pocket: "the shy pellet is never eaten', " pocket: 'the shy pellet is never eaten"), "could not read every entry"),
 ("repaired entry indented differently, and winnable", G, sub(' pocket: "the shy pellet is never eaten', '  pocket: "this version can be won: the shy pellet is never eaten'), "could not read every entry"),
 ("a canned change's row opens differently", G, sub(" {id:'knife', name:'", " { id:'knife', name:'"), "every line must be one entry"),
 ("a stray line in the canned changes", G, sub(" {id:'knife', name:'", " // x\n {id:'knife', name:'"), "every line must be one entry"),
 ("SIM_WIN gone", G, sub('const SIM_WIN="', 'const SIM_WINS="'), "SIM_WIN: expected 1 match"),
 ("two rows share an article anchor", G, sub("art:'b22d'}", "art:'d167'}"), "own article anchor"),
 ("MODES row unreadable", G, sub(" {id:'prose',name:'Prose'", " {ident:'prose',name:'Prose'"), "unreadable MODES row"),
 ("opens on a position that cannot be chosen", G, sub("let mode='nothing'; let programBy=null;", "let mode='weights'; let programBy=null;"), "is not a choosable MODES id"),
 ("opens on a position that is not first", G, sub("let mode='nothing'; let programBy=null;", "let mode='prose'; let programBy=null;"), "but MODES starts with"),
 ("copy names another first switch", G, sub('The first switch, "Nothing,"', 'The first switch, "Prose,"'), "the first switch"),
 ("copy miscounts the enforcers", G, sub("8 categories", "9 categories"), "enforcers or categories somewhere"),
 ("copy no longer counts", G, lambda t: sub("8 categories", "eight categories")(sub("8 enforcers", "eight enforcers", 2)(t)), "no longer says how many"),
 ("static switch out of order", G, sub("<button><span>Prose</span><small>a sentence</small></button><button class=\"off\" disabled=\"\" title=\"not choosable: nobody trained a model about this game\"><span>Weights</span></button>", "<button class=\"off\" disabled=\"\" title=\"not choosable: nobody trained a model about this game\"><span>Weights</span></button><button><span>Prose</span><small>a sentence</small></button>"), "static switch reads"),
 ("static switch holds a stray element", G, sub('<div class="seg" id="seg"><button class="on">', '<div class="seg" id="seg"><i>x</i><button class="on">'), "something other than buttons"),
 ("static switch selects another button", G, sub('<button class="on"><span>Nothing</span><small>nobody</small></button><button><span>Prose</span>', '<button><span>Nothing</span><small>nobody</small></button><button class="on"><span>Prose</span>'), "the one selected button"),
 ("static switch selects two buttons", G, sub('<button><span>Prose</span><small>a sentence</small></button>', '<button class="on"><span>Prose</span><small>a sentence</small></button>'), "the one selected button"),
 ("static Weights button can be chosen", G, sub('<button class="off" disabled="" title="not choosable', '<button class="off" title="not choosable'), "cannot be chosen differ"),
 ("static switch: a wrong line under a name", G, sub("<button><span>Prose</span><small>a sentence</small></button>", "<button><span>Prose</span><small>nobody</small></button>"), "the 'Prose' button reads"),
 ("static switch: Weights gets a line under its name", G, sub("<span>Weights</span></button>", "<span>Weights</span><small>not choosable</small></button>"), "the 'Weights' button reads"),
 ("a MODES row gives its name twice", G, sub(",art:'d167'},", ",art:'d167',name:'Changed'},"), "gives name twice"),
 ("a MODES row gives its name twice, with a space", G, sub(",art:'d167'},", ",art:'d167', name:'Changed'},"), "unreadable MODES row at"),
 ("a MODES row gives its name again in double quotes", G, sub(",art:'d167'},", ",art:'d167',name:\"Changed\"},"), "unreadable MODES row at"),
 ("static card: badge", G, sub('id="pos"><div class="top"><span class="badge">Nothing</span>', 'id="pos"><div class="top"><span class="badge">Prose</span>'), "the static card is not what"),
 ("static card: who enforces", G, sub('is enforced by nobody</div>', 'is enforced by somebody</div>'), "the static card is not what"),
 ("static card: what it is", G, sub('<b>What it is.</b> "Nothing" means nobody is checking', '<b>What it is.</b> "Nothing" means no one is checking'), "the static card is not what"),
 ("static card: in this game", G, sub('<b>In this game.</b> Ask for the wall to go and it goes', '<b>In this game.</b> Ask for a wall to go and it goes'), "the static card is not what"),
 ("static card: when to use it", G, sub('<b>When to use it.</b> When a broken rule costs you little, like a style preference. Or', '<b>When to use it.</b> When a broken rule costs you nothing, like a style preference. Or'), "the static card is not what"),
 ("static card: article link", G, sub('#d167" target="_blank" rel="noopener">Read more in the article</a>.</div></div>\n', '#b22d" target="_blank" rel="noopener">Read more in the article</a>.</div></div>\n'), "the static card is not what"),
 ("table row changed, static card left stale", G, sub("def:'\"Nothing\" means nobody is checking", "def:'\"Nothing\" means no one is checking"), "the static card is not what"),
 ("two static cards", G, sub('<div class="card pos" id="pos">', '<div class="card pos" id="pos"></div><div class="card pos" id="pos">'), "static card: expected 1 match, found 2"),
 ("result slot's badge", G, sub('id="card"><div class="top"><span class="badge">Nothing</span>', 'id="card"><div class="top"><span class="badge">Code (proof)</span>'), "static result slot's badge"),
 ("chart opens on another position", G, sub('id="flow" data-m="nothing"', 'id="flow" data-m="prose"'), "chart box opening"),
 ("a chart figure for the wrong position", G, sub('<figure class="flowfig" data-m="judge">', '<figure class="flowfig" data-m="weights">'), "the chart's figures are"),
 ("a chart figure missing", G, rx(r'<figure class="flowfig" data-m="judge">.*?</figure>', ""), "the chart's figures are"),
 ("a chart show rule missing", G, sub('#flow[data-m="judge"] .flowfig[data-m="judge"]{display:grid}\n', ""), "chart show rule for judge"),
 ("title has three lines", G, sub("<span>Instructions,</span> ", ""), "the title has 3 lines"),
 ("title's last line reworded", G, sub("<span>Every Time</span></h1>", "<span>Each Time</span></h1>"), "measure the last line"),
 ("title's measured width changed", G, sub("--last:4.78em", "--last:4.80em"), "measure the last line"),
]
M += [(f"viewer phrase back: {s}", G, sub("<footer", f"<!-- {s} --><footer"), f"{s!r} is still in the page") for s in BUILD.VIEWER_PHRASES if "claude.ai" not in s]
M += [(f"viewer phrase back: {s}", G, sub("<footer", f"<!-- {s} --><footer"), "is still in the page") for s in BUILD.VIEWER_PHRASES if "claude.ai" in s]
M += [(f"hosted-only text gone: {s[:24]}", G, sub(s, ""), "hosted-only text") for s in BUILD.HOSTED_ONLY]
M += [(f"removed code name back: {s}", G, sub("<footer", f"<!-- {s} --><footer"), f"{s!r} is on the page") for s in BUILD.DEAD_NAMES]
bad = 0
def run(d):
    out = d / "out.html"
    p = subprocess.run([sys.executable, str(d / "build/make-play-page.py"), str(out)], capture_output=True, text=True, check=False)
    return p, out
with tempfile.TemporaryDirectory() as td:
    base = Path(td) / "base"
    for sub_ in ("src", "build"): shutil.copytree(WT / sub_, base / sub_)
    p, out = run(base)
    ok = p.returncode == 0 and out.exists()
    print(("OK  " if ok else "BAD ") + "control: the unchanged copy builds and writes its output"); bad += not ok
    for i, (name, f, mut, want) in enumerate(M):
        d = Path(td) / f"m{i}"
        shutil.copytree(base, d, ignore=shutil.ignore_patterns("out.html"))
        t = (d / f).read_text(encoding="utf-8"); t2 = mut(t); assert t2 != t, name
        (d / f).write_text(t2, encoding="utf-8")
        p, out = run(d)
        msg = (p.stderr + p.stdout).strip()
        ok = p.returncode != 0 and not out.exists() and want in msg and msg.startswith("FAILED")
        print(("RED " if ok else "BAD ") + f"{name}: exit {p.returncode}, output written: {out.exists()}, said: {msg[:110]}")
        bad += not ok
if bad or not M:
    print(f"FAILED page-checks-test: {len(M)} mutations, {bad} not as expected")
    sys.exit(1)
print(f"OK page-checks-test ({len(M)} broken sources refused, the unchanged one built)")
