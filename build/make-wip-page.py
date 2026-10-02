#!/usr/bin/env python3
"""Build wip.html, a work-in-progress preview of the play page, from the built index.html.

Usage: build/make-wip-page.py   (reads index.html at the repo root, writes wip.html beside it)

The preview is the game-first version Mo asked for on 2026-10-01: the page stands on its own (a short intro, the article
linked as the reference), the switch runs weakest to strongest and starts on Nothing, and each enforcer's card says what
it is and when to use it. Nothing here is final. index.html, the live page, is not changed by this script.

Every edit is anchored on an exact string of index.html and must match exactly once, or the script exits non-zero and
writes nothing.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
OUT = ROOT / "wip.html"
POST_URL = "https://blog.mohannadarbaji.com/how-to-make-ai-follow-your-instructions-every-time-16a75f58f281"

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

INTRO_OLD_RE = re.compile(r'  <p><b>Welcome to the Unwinnable Maze\.</b>.*?Now comes the fun part!</p>\n')
INTRO_NEW = (
    '  <p class="wipnote">Work-in-progress preview. The live game is <a href="./">here</a>.</p>\n'
    '  <p>Have you ever written a skill file, been very detailed, told the AI "MAKE NO MISTAKES" in all caps with extra '
    'punctuation, and it still made a bunch of mistakes? If you know what you want, how do you make sure the system '
    "you're building actually does it?</p>\n"
    '  <p>It turns out it has little to do with how you phrase it, and a lot to do with what enforces it. An enforcer is '
    'the mechanism outside the model that holds a rule for it, and there are eight of them. The good news is that AI can '
    'help you with the implementation, and building has become incredibly easy, but you still have to understand the '
    'enforcers and when to use which.</p>\n'
    '  <p>This game is an easy way to learn them. If you want to read the definition of each one and when to use it, '
    f'<a href="{POST_URL}">here is the article</a>. The game is below.</p>\n')

START_OLD = ('  <p>The enforcer starts on "Code (proof)", the one you will most often meet in your own programs, but you can '
             'toggle the switch to anything else and see how it plays out.</p>\n'
             '  <p>Start with the request already in the box, "remove the walls around the one walled-in pellet to the right", '
             'and watch the log: the literal change is caught, and the AI rewrites it with your request kept whole.</p>\n')
START_NEW = ('  <p>The switch starts on "Nothing": nobody is checking, so any change you ask for goes straight into the game. '
             'Pick the canned change "Open the pocket" and the rule is broken. Then move along the switch one enforcer at a '
             'time and try the same change again. Each one is stronger than the one before it.</p>\n'
             '  <p>The canned changes work without an API key. To ask for a change in your own words, paste an Anthropic '
             'API key under "Ask anything".</p>\n')

SWNOTE_OLD = "The mechanisms that enforce it are ordered strongest to weakest. Switch between them and see if you can break the rule."
SWNOTE_NEW = "The enforcers are ordered weakest to strongest. Start at the left and work your way up."

CSS = (".wipnote{font:600 13px/1.4 var(--sans);color:var(--ink-2);border:1px dashed var(--line);border-radius:8px;padding:8px 12px}\n"
       ".card.pos .h+.h{margin-top:8px}\n")


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"make-wip-page: {what}: expected 1 match, found {n}")
    return text.replace(old, new)


def js_str(s):
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def main():
    t = SRC.read_text(encoding="utf-8")

    # the intro and the paragraph under "Now try to break the game"
    if len(INTRO_OLD_RE.findall(t)) != 1:
        sys.exit("make-wip-page: intro: expected 1 match")
    t = INTRO_OLD_RE.sub(lambda m: INTRO_NEW, t)
    t = once(t, START_OLD, START_NEW, "start paragraphs")
    t = once(t, SWNOTE_OLD, SWNOTE_NEW, "switch note")

    # the MODES table: reorder weakest first, add def and use to each row
    m = re.search(r"const MODES=\[\n(.*?)\n\];", t, re.S)
    if not m:
        sys.exit("make-wip-page: MODES table not found")
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

    # start on Nothing
    t = once(t, "let mode='proof'; let programBy=null;", "let mode='nothing'; let programBy=null;", "default mode")

    # the card: what it is, what it does in this game, when to use it, and the article
    card_old = "<div class=\"h\">${posH(m)}</div>`; }"
    card_new = ("<div class=\"h\"><b>What it is.</b> ${m.def}</div><div class=\"h\"><b>In this game.</b> ${posH(m)}</div>"
                "<div class=\"h\"><b>When to use it.</b> ${m.use} <a href=\"" + POST_URL + "\">Read more in the article</a>.</div>`; }")
    t = once(t, card_old, card_new, "card template")

    # the static first paint (before the script runs): the switch and the card, for Nothing
    seg = re.search(r'<div class="seg" id="seg">(.*?)</div>\n', t)
    if not seg:
        sys.exit("make-wip-page: static switch not found")
    buttons = re.findall(r"<button.*?</button>", seg.group(1))
    if len(buttons) != 9:
        sys.exit(f"make-wip-page: static switch has {len(buttons)} buttons")
    buttons = [b.replace('<button class="on">', "<button>") for b in reversed(buttons)]
    buttons[0] = buttons[0].replace("<button>", '<button class="on">', 1)
    t = t[:seg.start(1)] + "".join(buttons) + t[seg.end(1):]
    pos = re.search(r'<div class="card pos" id="pos">.*?</div></div>\n', t)
    if not pos:
        sys.exit("make-wip-page: static card not found")
    d, u = MODES[0][1], MODES[0][2]
    nothing_h = re.search(r"h:'(.*?)'\}", rows["nothing"]).group(1)
    static = ('<div class="card pos" id="pos"><div class="top"><span class="badge">Nothing</span></div>'
              '<div class="r">You can never win, enforced by nobody</div>'
              f'<div class="h"><b>What it is.</b> {d}</div><div class="h"><b>In this game.</b> {nothing_h}</div>'
              f'<div class="h"><b>When to use it.</b> {u} <a href="{POST_URL}">Read more in the article</a>.</div></div>\n')
    t = t[:pos.start()] + static + t[pos.end():]

    t = once(t, "<title>Unwinnable Maze</title>", '<title>Unwinnable Maze (preview)</title>\n<meta name="robots" content="noindex">', "title")
    style_end = t.find("</style>")
    if style_end < 0:
        sys.exit("make-wip-page: no style block")
    t = t[:style_end] + CSS + t[style_end:]

    OUT.write_text(t, encoding="utf-8")
    print(f"OK wip.html ({len(t)} bytes)")


if __name__ == "__main__":
    main()
