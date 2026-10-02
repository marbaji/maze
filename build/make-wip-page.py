#!/usr/bin/env python3
"""Build wip.html, a work-in-progress preview of the play page, from the built index.html.

Usage: build/make-wip-page.py   (reads index.html at the repo root, writes wip.html beside it; also reads
guide/index.html and writes the preview's copy of the picture guide, guide/wip.html)

The preview is the game-first version Mo asked for on 2026-10-01: the page stands on its own (a short intro, the article
linked as the reference), the switch runs weakest to strongest and starts on Nothing, and each enforcer's card says what
it is and when to use it. Nothing here is final. index.html, the live page, is not changed by this script.

Every edit is anchored on an exact string or pattern of index.html and must match exactly once, or the script exits
non-zero and writes nothing (the previous wip.html, if any, is left as it was, so gate a commit on the exit code).

The opening position is START, and the switch order is the order of MODES below. The script's own table, the starting
mode, and the static first paint (the switch, the enforcer's card and the result slot shown before the page's script
runs) are all derived from those two. The copy above the switch is hand-written (Mo's words): the build fails unless
it calls the opening position the first switch and that position is first in MODES, and unless every number the copy
gives for the enforcers ("8 enforcers", "8 categories") equals the rows of MODES after the first. The copy also says each enforcer is stronger than the one before it, which no build check
can test, so a change of order still means rereading that copy by hand.
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
OUT = ROOT / "wip.html"
POST_URL = "https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281"
# opens in a new tab, like the page's other outside links, so a click mid-game does not lose the game
ARTICLE_LINK = f'<a href="{POST_URL}" target="_blank" rel="noopener">Read more in the article</a>'

START = "nothing"   # the position the page opens on; must be an id in MODES and not a disabled one

# weakest to strongest; def and use are shortened from the article's own sentences
MODES = [
    ("nothing", "Nothing means nobody is checking anything. It is the baseline every other enforcer is measured against.",
     "When a broken rule costs you little, like a style preference. Write it down anyway, so others know it is unenforced."),
    ("prose", "Prose is a sentence in the prompt, and nothing checks the result.",
     "For preferences, not rules. Anything you can live with being ignored one time in twenty."),
    ("weights", "Weights means the model was trained to follow the rule, so the rule comes out of the model itself.",
     "You mostly cannot, without fine-tuning. You inherit weights from whichever lab trained the model."),
    ("human", "The human enforcer is a person approving every change before it happens.",
     "When a wrong yes is expensive and the volume is low. Use it for things you cannot take back, or while you are still building out your automation."),
    ("judge", "A judge is a second model that reads the output and decides.",
     "When the rule is a judgement call no program can check, like tone or relevance, and you can afford to be wrong sometimes."),
    ("test", "Tests are a program that checks some of the cases instead of all of them.",
     "Almost everywhere. It is the default engineering answer, cheap, and usually the right trade."),
    ("proof", "Proof is a program that checks every case, so it leaves no room for doubt.",
     "When the state space is small enough to search, or the property is one you can definitively prove."),
    ("construction", "Construction means the thing you are trying to prevent cannot be written down at all.",
     'When you control the format the output has to fit, like a label with exactly two options and no "Other".'),
    ("capability", "Capability means not giving the AI the tool or permission that lets it take the action.",
     "When the agent doesn't need the power. An agent that drafts emails does not need the send button."),
]

# The copy below is Mo's own: his text from the editable copy page (2026-10-01), with the cuts he reviewed on the
# comparison page and the three changes he left as comments there ("a dollar or a few", "the same way for every player
# every time", and the sentence about agentic workflows and packaged products). "key field" replaces his first
# "encrypted field": the field is masked, not encrypted (the key sits in the tab's session storage and goes only to
# Anthropic).
# main() counts the words a reader meets before the game and writes the number where this token sits (Mo, 2026-10-01:
# "what's the word count on the pre-game intro? print that on the page")
WORDS_TOKEN = "@@WORDS@@"

TITLE_OLD = "  <h1>The Unwinnable Maze</h1>\n"
TITLE_NEW = "  <h1>How To Make AI Follow Your Instructions, Every Time</h1>\n"

INTRO_OLD_RE = re.compile(r'  <p><b>Welcome to the Unwinnable Maze\.</b>.*?Now comes the fun part!</p>\n')
INTRO_NEW = (
    '  <p class="wipnote">Work-in-progress preview. The live game is <a href="./">here</a>. The text above the game is '
    f'{WORDS_TOKEN} words, title and headings included.</p>\n'
    "  <p>We've all been there. You wrote a thoughtful prompt or skill file and were incredibly detailed and organized, "
    "but the AI skipped an important step or didn't give you <i>exactly</i> what you were looking for. You even "
    'included the iconic "MAKE NO MISTAKES" in all caps with not one, not two, but <b><i>three </i></b>exclamation '
    'marks. Yet alas, mistakes were made. This same problem could arise in sophisticated AI agentic workflows or '
    'packaged products as well. If you know what you want, how do you make sure the AI actually does it?</p>\n'
    '  <p>It turns out it has little to do with how you phrase your ask, and a lot to do with what enforces it. An '
    'enforcer is the mechanism outside the model that makes sure the instruction or rule you give it is followed, and '
    'through my work I was able to bucket them into exactly 8 categories. AI can help you implement them, as building '
    'has become incredibly easy, but you still have to understand the 8 enforcers and when to use each.</p>\n'
    '  <p>I coded a game as a fun way to learn them. If you want to read the definition of each enforcer and when to '
    f'use it, <a href="{POST_URL}">I also wrote the article</a>.</p>\n')

HEAD_OLD = '<h2 id="read-play">Now try to break the game&nbsp;</h2>'
HEAD_NEW = '<h2 id="read-play">The Unwinnable Maze</h2>'

RULE = ('The rule: you can never win, whatever winning means in the current game. The game starts with winning defined '
        'as eating every pellet.')
START_OLD = ('  <p>The enforcer starts on "Code (proof)", the one you will most often meet in your own programs, but you can '
             'toggle the switch to anything else and see how it plays out.</p>\n'
             '  <p>Start with the request already in the box, "remove the walls around the one walled-in pellet to the right", '
             'and watch the log: the literal change is caught, and the AI rewrites it with your request kept whole.</p>\n'
             f'  <p class="rule">{RULE}</p>\n')
# calls the opening position the first switch and counts 8 enforcers, so main() checks both against START and MODES
START_NEW = ("  <p>You're a round chomper trying to eat all the pellets in a maze while running away from the spooky "
             'monsters. The problem is that the maze starts with one pellet boxed in with walls on all four sides, '
             'preventing you from reaching it. The game has a chat box where you can ask for anything you want and watch '
             'it materialize (or become anything). The game has one rule and one rule only:</p>\n'
             f'  <p class="rule"><i>{RULE}</i></p>\n'
             '  <p>That rule, like any other rule, can be enforced by one of the 8 enforcers. The game encodes each '
             'enforcer as a switch and lets you switch between them. The first switch, "Nothing," is the only one that '
             "isn't an enforcer; any change you ask for goes straight into the game, because nothing reads our "
             '"you can never win" rule. It\'s our baseline for all the other switches. Each one is stronger than the '
             'one before it, so I would recommend progressing through them in order.<br><br>The entire program is code '
             'that runs live on this page, except for the AI that takes in your ask and rebuilds that program. That is a '
             'light Opus call to your account, so to ask for changes in your own words you can put a dollar or a few on '
             "an expiring API key and paste it in the key field below (there's a guide if you don't know how).</p>\n"
             '  <p>There are also a few canned changes, like "remove the walls" or "give me a jetpack," that I\'ve run '
             'from my account and saved, so you can play without a key. Because they are canned, they behave the same '
             'way for every player every time.</p>\n')

SWNOTE_OLD = "The mechanisms that enforce it are ordered strongest to weakest. Switch between them and see if you can break the rule."
SWNOTE_NEW = ("The enforcers are ordered weakest to strongest. Weights is on the switch but cannot be chosen, because "
              "nobody has trained an LLM specifically to make this game unwinnable.")
# Mo folded the Weights sentence into the switch note, so the separate note under the switch goes. The page's flip()
# scrolled to that note for a disabled position; it now scrolls to the switch note (no link on the page calls flip()
# today, only the test hook, but it would throw on a missing element)
WNOTE_OLD = ('  <div class="wnote">Weights is on the switch but cannot be chosen: nobody trained a model never to make '
             'this game winnable.</div>\n')
WNOTE_JS_OLD = "target.parentElement.querySelector('.wnote').scrollIntoView("
WNOTE_JS_NEW = "target.parentElement.querySelector('.swnote').scrollIntoView("

# The message under the key box on the "Ask anything" tab (Mo, 2026-10-01): the repo address is a link, and the points
# of the paragraph that sat above the ask box ("An Opus-class model writes the program...") are folded into it, at the
# message's own size and place; that paragraph is removed. The page keeps the same text in two constants (the Ask tab's
# and the canned tab's copy), so both change, and the three places that wrote it as plain text now write it as HTML
# (the message is a constant of this page, never reader input).
ASKP_OLD = ('      <p id="askp">An Opus-class model writes the program. Everything else, including the checking of the '
            'program, the search and the game itself, is code that runs on the page.</p>\n')
ASK_MSG_OLD = ('"To use Ask anything, paste an Anthropic API key below. It stays in this tab until you close it or press '
               'Forget key, and it goes only to Anthropic, nowhere else. All the code runs on this page, so you can read it '
               'with View Source; the same code is published at github.com/marbaji/maze. Until then, you can use the '
               '\\"Canned changes\\" mode, which are saved ready-made changes that run without an API key.";')
ASK_MSG_NEW = ('"To use Ask anything, paste an Anthropic API key below. It stays in this tab until you close it or press '
               'Forget key, and it goes only to Anthropic, nowhere else. An Opus-class model writes the program. Everything '
               'else, including the checking of the program, the search and the game itself, is code that runs on this '
               "page, so you can inspect this page's source and read it, or read the same code at "
               "<a href='https://github.com/marbaji/maze' target='_blank' rel='noopener'>github.com/marbaji/maze</a>. "
               'Until then, you can use the \\"Canned changes\\" mode, which are saved ready-made changes that run '
               'without an API key.";')
ASK_SINKS = [("n.textContent=CANNED_WHY;", "n.innerHTML=CANNED_WHY;"),
             ("$('capnote').textContent=k?'':ASK_MSG;", "$('capnote').innerHTML=k?'':ASK_MSG;"),
             ("note.textContent=ASK_MSG;", "note.innerHTML=ASK_MSG;")]

# The footer's sentence about Bend, in Mo's words (2026-10-01). The sentence after it, which says the page's proof
# enforcer does not use Bend, is left as it was.
FOOT_OLD = 'a programming language that makes an AI prove its code still keeps the rules you declare. This page\'s'
FOOT_NEW = ('a programming language that makes an AI prove its code still keeps the rules you declare, which is the '
            '"Code (proof)" enforcer in our game. This page\'s')

# The canned changes (Mo, 2026-10-01): "Two squares a step" is removed; the last row of cards is centred; and the
# wormhole's two mouths are drawn in the plain version too (the page's repaired version already drew them, the plain one
# drew nothing, so the ride was invisible). Behaviour is unchanged: only the program's render() gains the two rings.
STEP2_BUTTON = '<button class="opt"><b>Two squares a step</b><small>every move goes two squares</small></button>'
WORM_HEAD_OLD = "const WORMHOLE_MAP = (s) => rep2(rep2(s, "
WORM_HEAD_NEW = "const WORMHOLE_MAP = (s) => rep2(rep2(rep2(s, "
WORM_TAIL_OLD = r'if (nx === 1 && ny === 1) return { ...s, x: 16, y: 7 };\n  return { ...s, x: nx, y: ny };");'
PLAYER_LINE = "  cells[cells.length] = { x: s.x, y: s.y, k: 'player' };"
PORTAL_LINE = ("  cells[cells.length] = { x: 1, y: 1, k: 'portal' }; cells[cells.length] = { x: 16, y: 7, k: 'portal' };"
               "   // both mouths drawn, so the player sees the ride")
WORM_TAIL_NEW = (r'if (nx === 1 && ny === 1) return { ...s, x: 16, y: 7 };\n  return { ...s, x: nx, y: ny };"), '
                 + '"' + PLAYER_LINE + '", "' + PORTAL_LINE + r"\n" + PLAYER_LINE + '");')
# the repaired wormhole is built on the plain one, which now draws the mouths, so its own copy of that line goes
WORM_FIX_OLD = r"k: 'pellet' }; }\n" + PORTAL_LINE + r"\n" + PLAYER_LINE + '"),'
WORM_FIX_NEW = r"k: 'pellet' }; }\n" + PLAYER_LINE + '"),'

# The preview's own copy of the picture guide (guide/wip.html, built from guide/index.html, which is the live guide and
# is not changed). Mo, 2026-10-02, on the step about buying credits: "Remember even if you put money on your API key
# what you don't use will stay in your account. We're just putting a little bit of money on it so you can play wihtout
# interruption ... or some version of that". He then cut "Remember," and "for up to a year" from my version of it
# (Anthropic's credits do expire a year after purchase; leaving that out is his call).
GUIDE_SRC = ROOT / "guide" / "index.html"
GUIDE_OUT = ROOT / "guide" / "wip.html"
GUIDE_STEP_OLD = ("If it asks you to buy usage credits, the smallest amount of $5 is plenty, or choose Other and type "
                  "$2-3. Leave Auto-reload off.")
GUIDE_STEP_NEW = ("If it asks you to buy usage credits, the smallest amount of $5 is plenty, or choose Other and type "
                  "$2-3. Whatever you don't use stays in your account. You're just putting "
                  "a little money on it so you can play without interruption. Leave Auto-reload off.")

CSS = (".wipnote{font:600 13px/1.4 var(--sans);color:var(--ink-2);border:1px dashed var(--line);border-radius:8px;padding:8px 12px}\n"
       ".card.pos .h+.h{margin-top:8px}\n"
       # the long title uses the whole reading column (the live page caps its three-word title at 14ch)
       ".read h1{max-width:none}\n"
       # the switch note at 12px, the largest size at which its two sentences fit on two lines in the desktop column
       # (measured: 14, 13 and 12.5px give three; Mo, 2026-10-01: "a little smaller so it fits on 2 lines instead of 3").
       # One size at every width (Mo, 2026-10-02: "it shoul keep the current size now and not save two sizes").
       ".sw .swnote{font-size:12px}\n"
       # the footer runs under both columns (Mo, 2026-10-01); the live page stops it at 80ch
       "footer{max-width:none}\n"
       # the canned-change cards: a wrapping row instead of a grid, so a short last row sits in the middle. Each card is
       # a third of the row where three fit (466px and up) and half of it below that, never wider, so every card in
       # every row has the same width; the block itself stops at three across.
       ".opts{display:flex;flex-wrap:wrap;justify-content:center;max-width:623px;margin-inline:auto}\n"
       ".opt{flex:1 1 150px;max-width:max(calc((100% - 16px)/3),min(calc((100% - 8px)/2),calc((466px - 100%)*9999)))}\n")


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"make-wip-page: {what}: expected 1 match, found {n}")
    return text.replace(old, new)


def js_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def js_unstr(s):
    """The text of a single-quoted JavaScript string body as the page would show it."""
    return re.sub(r"\\(.)", r"\1", s)


def one(pattern, text, what, flags=0):
    found = list(re.finditer(pattern, text, flags))
    if len(found) != 1:
        sys.exit(f"make-wip-page: {what}: expected 1 match, found {len(found)}")
    return found[0]


def field(row, name, mid):
    m = re.search(name + r":'((?:[^'\\]|\\.)*)'", row)
    if not m:
        sys.exit(f"make-wip-page: MODES row {mid} has no {name}")
    return js_unstr(m.group(1))


def main():
    t = SRC.read_text(encoding="utf-8")

    # the title, the intro, and the copy between the play heading and the switch
    if len(INTRO_OLD_RE.findall(t)) != 1:
        sys.exit("make-wip-page: intro: expected 1 match")
    t = INTRO_OLD_RE.sub(lambda m: INTRO_NEW, t)
    t = once(t, TITLE_OLD, TITLE_NEW, "title")
    t = once(t, HEAD_OLD, HEAD_NEW, "play heading")
    t = once(t, START_OLD, START_NEW, "start paragraphs and the rule")
    t = once(t, SWNOTE_OLD, SWNOTE_NEW, "switch note")
    t = once(t, WNOTE_OLD, "", "weights note")
    t = once(t, WNOTE_JS_OLD, WNOTE_JS_NEW, "weights click target")

    # the Ask-tab message and the footer
    t = once(t, ASKP_OLD, "", "paragraph above the ask box")
    for const in ("CANNED_WHY", "ASK_MSG"):
        t = once(t, f"const {const}=" + ASK_MSG_OLD, f"const {const}=" + ASK_MSG_NEW, f"{const} text")
    for old, new in ASK_SINKS:
        t = once(t, old, new, f"message sink {old}")
    t = once(t, FOOT_OLD, FOOT_NEW, "footer sentence")

    # the canned changes
    step2 = one(r"^ \{id:'step2', name:'Two squares a step',.*\n", t, "step2 row", re.M)
    t = t[:step2.start()] + t[step2.end():]
    t = once(t, STEP2_BUTTON, "", "static step2 card")
    t = once(t, WORM_HEAD_OLD, WORM_HEAD_NEW, "wormhole map head")
    t = once(t, WORM_TAIL_OLD, WORM_TAIL_NEW, "wormhole map tail")
    t = once(t, WORM_FIX_OLD, WORM_FIX_NEW, "repaired wormhole portal line")

    # the MODES table: reorder weakest first, add def and use to each row
    m = one(r"const MODES=\[\n(.*?)\n\];", t, "MODES table", re.S)
    rows = {}
    for line in m.group(1).split("\n"):
        rid = re.match(r" \{id:'([a-z]+)',", line)
        if not rid:
            sys.exit(f"make-wip-page: unreadable MODES row: {line[:60]}")
        rows[rid.group(1)] = line
    if set(rows) != {k for k, _, _ in MODES}:
        sys.exit(f"make-wip-page: MODES ids differ: {sorted(rows)}")
    new_rows = []
    for mid, d, u in MODES:
        row = rows[mid]
        if not row.endswith("},"):
            sys.exit(f"make-wip-page: MODES row shape: {mid}")
        new_rows.append(row[:-2] + f",def:{js_str(d)},use:{js_str(u)}" + "},")
    t = t[:m.start(1)] + "\n".join(new_rows) + t[m.end(1):]

    # the opening position
    if START not in rows or "disabled:true" in rows[START]:
        sys.exit(f"make-wip-page: START {START!r} is not a choosable MODES id")
    t = once(t, "let mode='proof'; let programBy=null;", f"let mode='{START}'; let programBy=null;", "default mode")
    # the copy above the switch is hand-written and states three things the tables above decide: the opening position
    # by name, that it is the first position on the switch, and how many enforcers follow it; fail rather than ship it stale
    start_name = field(rows[START], "name", START)
    if f'The first switch, "{start_name},"' not in START_NEW:
        sys.exit(f'make-wip-page: the copy above the switch does not call "{start_name}" (START) the first switch')
    if MODES[0][0] != START:
        sys.exit(f'make-wip-page: the copy above the switch calls "{start_name}" the first switch, but MODES starts with {MODES[0][0]}')
    counts = re.findall(r"\b(\d+) (?:enforcers|categories)\b", INTRO_NEW + START_NEW)
    if not counts:
        sys.exit("make-wip-page: the copy above the switch no longer says how many enforcers there are; drop this check if that is meant")
    if any(int(c) != len(MODES) - 1 for c in counts):
        sys.exit(f"make-wip-page: the copy above the switch counts {sorted(set(counts))} enforcers; MODES holds {len(MODES) - 1} after the first position")

    # the card: what it is, what it does in this game, when to use it, and the article
    card_old = "<div class=\"h\">${posH(m)}</div>`; }"
    card_new = ("<div class=\"h\"><b>What it is.</b> ${m.def}</div><div class=\"h\"><b>In this game.</b> ${posH(m)}</div>"
                "<div class=\"h\"><b>When to use it.</b> ${m.use} " + ARTICLE_LINK + ".</div>`; }")
    t = once(t, card_old, card_new, "card template")

    # the static first paint (before the page's script runs): the switch in MODES order with START selected, START's
    # card, and the result slot's badge
    seg = one(r'<div class="seg" id="seg">(.*?)</div>\n', t, "static switch")
    by_name = {}
    for b in re.findall(r"<button.*?</button>", seg.group(1)):
        name = re.search(r"<span>(.*?)</span>", b)
        if not name:
            sys.exit(f"make-wip-page: static switch button has no name: {b[:60]}")
        by_name[name.group(1)] = b.replace('<button class="on">', "<button>")
    names = {mid: field(rows[mid], "name", mid) for mid, _, _ in MODES}
    if set(by_name) != set(names.values()):
        sys.exit(f"make-wip-page: static switch names differ from MODES: {sorted(by_name)}")
    buttons = [by_name[names[mid]] for mid, _, _ in MODES]
    at = [mid for mid, _, _ in MODES].index(START)
    if not buttons[at].startswith("<button>"):
        sys.exit(f"make-wip-page: the static button for {START} cannot be selected: {buttons[at][:60]}")
    buttons[at] = '<button class="on">' + buttons[at][len("<button>"):]
    if "".join(buttons).count('class="on"') != 1:
        sys.exit("make-wip-page: static switch does not have exactly one selected button")
    t = t[:seg.start(1)] + "".join(buttons) + t[seg.end(1):]

    pos = one(r'<div class="card pos" id="pos">.*?</div></div>\n', t, "static card")
    d, u = next((d, u) for mid, d, u in MODES if mid == START)
    # the page's posH() drops these two clauses while the canned changes are hidden; the static card matches index.html's
    h = field(rows[START], "h", START).replace("the canned changes are disabled and ", "").replace("a canned change runs its repaired version, ", "")
    static = (f'<div class="card pos" id="pos"><div class="top"><span class="badge">{names[START]}</span></div>'
              f'<div class="r">You can never win, enforced by {field(rows[START], "sub", START)}</div>'
              f'<div class="h"><b>What it is.</b> {d}</div><div class="h"><b>In this game.</b> {h}</div>'
              f'<div class="h"><b>When to use it.</b> {u} {ARTICLE_LINK}.</div></div>\n')
    t = t[:pos.start()] + static + t[pos.end():]
    t = once(t, '<div class="card slot" id="card"><div class="top"><span class="badge">Code (proof)</span></div>',
             f'<div class="card slot" id="card"><div class="top"><span class="badge">{names[START]}</span></div>', "static result slot")

    # the title, a noindex meta in the outer head, and the CSS lines in the page's own stylesheet
    t = once(t, "<title>Unwinnable Maze</title>", "<title>Unwinnable Maze (preview)</title>", "page title")
    t = once(t, "<head><meta http-equiv=", '<head><meta name="robots" content="noindex"><meta http-equiv=', "outer head")
    sheet = '<link rel="stylesheet" href="fonts/fonts.css">\n<style>\n'
    if t.count(sheet) != 1:
        sys.exit(f"make-wip-page: page stylesheet: expected 1 match, found {t.count(sheet)}")
    style_end = t.find("</style>", t.index(sheet))
    if style_end < 0:
        sys.exit("make-wip-page: page stylesheet has no end")
    t = t[:style_end] + CSS + t[style_end:]

    # the words a reader meets before the game: the article's text, without the preview note that reports the number
    art = one(r'<article id="read" class="read">\n(.*?)</article>', t, "article", re.S).group(1)
    art = re.sub(r'  <p class="wipnote">.*?</p>\n', "", art, count=1)
    if WORDS_TOKEN in art:
        sys.exit("make-wip-page: the preview note was not removed before counting")
    # a line break or the end of a block separates words; an inline tag does not ("</a>." is one word with its link text)
    art = re.sub(r"<br>|</(?:p|h1|h2)>", " ", art)
    words = len(html.unescape(re.sub(r"<[^>]+>", "", art)).split())
    t = once(t, WORDS_TOKEN, str(words), "word count")

    # the preview's copy of the picture guide, linked from the preview's key box
    g = GUIDE_SRC.read_text(encoding="utf-8")
    g = once(g, GUIDE_STEP_OLD, GUIDE_STEP_NEW, "guide: credits step")
    g = once(g, "<title>Get a key for the maze</title>",
             '<title>Get a key for the maze (preview)</title>\n<meta name="robots" content="noindex">', "guide: title")
    if g.count('href="../#read-play"') != 2:
        sys.exit(f"make-wip-page: guide: expected 2 links back to the maze, found {g.count('href=\"../#read-play\"')}")
    g = g.replace('href="../#read-play"', 'href="../wip.html#read-play"')
    t = once(t, '<a href="guide/">How to get a key (2 minutes)</a>', '<a href="guide/wip.html">How to get a key (2 minutes)</a>',
             "link to the guide")

    OUT.write_text(t, encoding="utf-8")
    GUIDE_OUT.write_text(g, encoding="utf-8")
    print(f"OK wip.html ({len(t.encode('utf-8'))} bytes, {words} words above the game) and guide/wip.html ({len(g.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
