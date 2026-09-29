#!/usr/bin/env python3
"""Check that README.md's line-number links still point at the code they describe.

Every link of the form github.com/marbaji/maze/blob/main/<path>#L<a>[-L<b>] in README.md is read from the
tracked file, and the lines must hold each token CLAIMS lists for that link, in the order the links appear.
A line number that drifts after a code change moves the range off its token and fails the check.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LINK = re.compile(r"https://github\.com/marbaji/maze/blob/main/([^\s)#]+)#L(\d+)(?:-L(\d+))?")

# (path, tokens the README's sentence claims those lines hold), in link order
CLAIMS = [
    ("src/byok.js", ["clean(key)"]),                                   # the page trims the key
    ("src/byok.js", ["doFetch(API", "'x-api-key': k"]),                 # sent only in the x-api-key header to the API
    ("build/make-play-page.py", ["sessionStorage.getItem", "sessionStorage.setItem", "sessionStorage.removeItem"]),  # kept in sessionStorage
    ("build/make-play-page.py", ["function forget()", "halt()", "drop()"]),  # Forget key removes it and stops calls in flight
    ("build/make-play-page.py", ["$('forgetkey').addEventListener"]),  # the button is wired to forget()
    ("build/make-play-page.py", ["connect-src https://api.anthropic.com"]),  # the CSP
]


def main():
    links = LINK.findall((ROOT / "README.md").read_text(encoding="utf-8"))
    failures = []
    if len(links) != len(CLAIMS):
        failures.append(f"README.md has {len(links)} line links, CLAIMS lists {len(CLAIMS)}")
    for (path, a, b), (want_path, tokens) in zip(links, CLAIMS):
        a, b = int(a), int(b or a)
        if path != want_path:
            failures.append(f"link to {path}#L{a}-L{b}: expected a link to {want_path}")
            continue
        lines = (ROOT / path).read_text(encoding="utf-8").split("\n")
        if not (1 <= a <= b <= len(lines)):
            failures.append(f"{path}#L{a}-L{b}: out of range ({len(lines)} lines)")
            continue
        chunk = "\n".join(lines[a - 1:b])
        for tok in tokens:
            if tok not in chunk:
                failures.append(f"{path}#L{a}-L{b} does not contain {tok!r}")
    if failures:
        print("FAILED readme-links-check\n  " + "\n  ".join(failures))
        return 1
    print(f"OK readme-links-check ({len(links)} links)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
