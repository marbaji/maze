#!/usr/bin/env python3
"""Fail if any tracked text file carries private paths, account names, ids or keys.

Patterns are assembled from parts so this file does not match itself.
Run from anywhere: python3 tests/privacy-scan.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PATTERNS = {
    "home path": "/" + "Users" + "/",
    "account name": "mo" + r"\." + "claude",
    "account name, first form": re.escape("mohannad" + "(p)"),
    "account name, second form": re.escape("mar" + "baji" + "(p)"),
    "private artifact id": "Loee" + "TLC6FtJyoqrVYDwRJj",
    "id fragment": "Kt" + "JS",
    "anthropic key": "sk" + "-ant-" + r"[A-Za-z0-9_\-]{20,}",
    "github token": "gh" + "p_",
    "aws key id": "AK" + "IA",
    "employer domain": "@" + "chalktalk",
    "non-example email": r"[A-Za-z0-9._%+\-]+@(?!example\.com\b)[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}",
}
COMPILED = {k: re.compile(v, re.IGNORECASE if k.startswith("account name") else 0) for k, v in PATTERNS.items()}

# Upstream licence notices stay unchanged: (tracked path, exact line) pairs.
ALLOW = {
    ("fonts/OFL-patrick-hand.txt", "Copyright (c) 2010-2012 Patrick Wagesreiter (mail" + "@patrickwagesreiter.at)"),
}


def tracked_files():
    out = subprocess.run(["git", "-C", str(ROOT), "ls-files", "-z"], capture_output=True, check=True).stdout
    return [p for p in out.decode("utf-8").split("\0") if p]


def main():
    bad = []
    scanned = 0
    for rel in tracked_files():
        path = ROOT / rel
        if not path.is_file():
            continue
        raw = path.read_bytes()
        if b"\0" in raw:
            continue  # binary (fonts)
        scanned += 1
        for n, line in enumerate(raw.decode("utf-8", errors="replace").split("\n"), 1):
            if (rel, line.rstrip("\r")) in ALLOW:
                continue
            for name, rx in COMPILED.items():
                m = rx.search(line)
                if m:
                    start = max(0, m.start() - 40)
                    bad.append(f"{rel}:{n}: {name}: ...{line[start:m.end() + 40]}...")
    if scanned == 0:
        print("FAILED: no tracked text files scanned")
        return 1
    if bad:
        print("FAILED")
        print("\n".join(bad))
        return 1
    print(f"OK ({scanned} tracked text files scanned)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
