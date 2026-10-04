# Unwinnable Maze

An interactive article where each switch position is one way to enforce a rule on an AI. Code (proof) should be unbreakable; if you beat it, that is a bug: file it in Issues.

Play at https://artifacts.mohannadarbaji.com/maze/

## How your API key is handled

The "Ask Me Anything" feature needs an Anthropic API key that you paste in yourself. The page trims the key ([`src/byok.js` L41](https://github.com/marbaji/maze/blob/main/src/byok.js#L41)) and sends it only in the `x-api-key` header of a request to `https://api.anthropic.com/v1/messages` ([`src/byok.js` L49-L53](https://github.com/marbaji/maze/blob/main/src/byok.js#L49-L53)). There is no server of ours in between. The request also carries the header `anthropic-beta: server-side-fallback-2026-07-01`, which asks for Anthropic's server-side fallback: when Opus 5.5 declines a request, Anthropic answers it with an older Claude model and the page's log says so. The page keeps the key in `sessionStorage`, so it stays in that one tab until you close the tab or press "Forget key" ([`src/game.html` L2108-L2110](https://github.com/marbaji/maze/blob/main/src/game.html#L2108-L2110)), and the "Forget key" button removes it and stops any call in flight ([L2125](https://github.com/marbaji/maze/blob/main/src/game.html#L2125) and [L2130](https://github.com/marbaji/maze/blob/main/src/game.html#L2130)). The page's Content Security Policy, the first thing in the page's head, allows connections only to `https://api.anthropic.com` ([L1](https://github.com/marbaji/maze/blob/main/src/game.html#L1)).

## Bugs

Use the "File a bug" button in the game, which opens a prefilled issue here, or open an issue directly.

## Rebuild and check

The game is one file, `src/game.html`, and it is edited directly. `build/make-play-page.py` makes `index.html` from it by putting the key adapter, `src/byok.js`, where the source has a marker line, and it refuses to write a page that contradicts itself (for example a first screen that does not match the switch's table). `build/make-wip-page.py` then makes the preview, `wip.html` and `guide/wip.html`, which adds only its preview markers. After any change to the source, run both and commit the pages with it:

```
python3 build/make-play-page.py
python3 build/make-wip-page.py
node tests/byok.test.cjs
bash tests/rebuild-check.sh
python3 tests/page-checks-test.py
python3 tests/privacy-scan.py
python3 tests/readme-links-check.py
node tests/play-page-check.cjs index.html
node tests/play-behaviour.cjs
node tests/guide-check.cjs
```

CI runs every check after the build on each pull request and push to `main`; the last three are Playwright browser checks and need `playwright` installed (`PLAYWRIGHT_PATH` can point at an install elsewhere).

## Licence

Apache-2.0, see `LICENSE`. Vendored files keep their own licences: `vendor/LICENSE-ses` and `fonts/OFL-*.txt`.
