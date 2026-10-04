#!/usr/bin/env python3
"""Build wip.html, a work-in-progress preview of the play page, from the built index.html.

Usage: build/make-wip-page.py [output folder]   (reads index.html and guide/index.html at the repo root; writes
wip.html and guide/wip.html there, or under the output folder when one is given, which is how
tests/rebuild-check.sh compares a fresh preview with the committed one)

The preview is the live page plus what marks it as a preview: "(preview)" in the page's title and the guide's, a
noindex meta on both, the note at the top of the article (which links to the live game and gives the word count of
the text above the game), and the preview's own copy of the key guide, linked from the key box and linking back to
wip.html. A change that should be seen before it goes live starts here as one more edit and moves into
src/game.html when it goes live. index.html, the live page, is not changed by this script.

Every edit is anchored on an exact string or pattern of index.html (or guide/index.html) and must match exactly once,
or the script exits non-zero and writes nothing (the previous wip.html, if any, is left as it was, so gate a commit on
the exit code).
"""
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "index.html"
GUIDE_SRC = ROOT / "guide" / "index.html"

# main() counts the words a reader meets before the game and writes the number where this token sits (Mo, 2026-10-01:
# "what's the word count on the pre-game intro? print that on the page")
WORDS_TOKEN = "@@WORDS@@"
WIPNOTE = ('  <p class="wipnote">Work-in-progress preview. The live game is <a href="./">here</a>. The text above the game is '
           f'{WORDS_TOKEN} words, title and headings included.</p>\n')
# the note sits at the top of the article, before the intro's first paragraph
WIPNOTE_BEFORE = "  <p>We've all been there."
WIPNOTE_CSS = ".wipnote{font:600 13px/1.4 var(--sans);color:var(--ink-2);border:1px dashed var(--line);border-radius:8px;padding:8px 12px}\n"
# the note's style goes just before this line of the page's stylesheet (src/game.html; the key box's styles follow it);
# if the line is moved or reworded this script stops (once(), below)
WIPNOTE_CSS_BEFORE = "@media (prefers-reduced-motion:reduce){.jdg .clip,.verdict{animation:none;opacity:1;transform:none}}\n"


def once(text, old, new, what):
    n = text.count(old)
    if n != 1:
        sys.exit(f"make-wip-page: {what}: expected 1 match, found {n}")
    return text.replace(old, new)


def main():
    if len(sys.argv) > 2:
        sys.exit("usage: make-wip-page.py [output folder]")
    out_root = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT
    out, guide_out = out_root / "wip.html", out_root / "guide" / "wip.html"
    t = SRC.read_text(encoding="utf-8")

    # the words a reader meets before the game: the article's text, before the preview note that reports the number
    m = re.findall(r'<article id="read" class="read">\n(.*?)</article>', t, re.S)
    if len(m) != 1:
        sys.exit(f"make-wip-page: article: expected 1 match, found {len(m)}")
    art = m[0]
    if 'class="wipnote"' in art:
        sys.exit("make-wip-page: index.html already holds the preview note")
    # a line break or the end of a block separates words; an inline tag does not ("</a>." is one word with its link text)
    art = re.sub(r"<br>|</(?:p|h1|h2|li)>", " ", art)
    words = len(html.unescape(re.sub(r"<[^>]+>", "", art)).split())

    # the preview's markers
    t = once(t, WIPNOTE_BEFORE, WIPNOTE.replace(WORDS_TOKEN, str(words)) + WIPNOTE_BEFORE, "preview note")
    t = once(t, WIPNOTE_CSS_BEFORE, WIPNOTE_CSS + WIPNOTE_CSS_BEFORE, "preview note's style")
    t = once(t, "<title>Unwinnable Maze</title>", "<title>Unwinnable Maze (preview)</title>", "page title")
    t = once(t, "<head><meta http-equiv=", '<head><meta name="robots" content="noindex"><meta http-equiv=', "outer head")
    t = once(t, '<a href="guide/">How to get a key (2 minutes)</a>', '<a href="guide/wip.html">How to get a key (2 minutes)</a>',
             "link to the guide")

    # the preview's copy of the picture guide, linked from the preview's key box
    g = GUIDE_SRC.read_text(encoding="utf-8")
    g = once(g, "<title>Get a key for the maze</title>",
             '<title>Get a key for the maze (preview)</title>\n<meta name="robots" content="noindex">', "guide: title")
    back_links = g.count('href="../#read-play"')
    if back_links != 2:
        sys.exit(f"make-wip-page: guide: expected 2 links back to the maze, found {back_links}")
    g = g.replace('href="../#read-play"', 'href="../wip.html#read-play"')

    guide_out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(t, encoding="utf-8")
    guide_out.write_text(g, encoding="utf-8")
    print(f"OK wip.html ({len(t.encode('utf-8'))} bytes, {words} words above the game) and guide/wip.html ({len(g.encode('utf-8'))} bytes)")


if __name__ == "__main__":
    main()
