# Unwinnable Maze

An interactive article where each switch position is one way to enforce a rule on an AI. Code (proof) should be unbreakable; if you beat it, that is a bug: file it in Issues.

Play at https://artifacts.mohannadarbaji.com/maze/

## How your API key is handled

The "Ask anything" feature needs an Anthropic API key that you paste in yourself. The page trims the key ([`src/byok.js` L41](https://github.com/marbaji/maze/blob/main/src/byok.js#L41)) and sends it only in the `x-api-key` header of a request to `https://api.anthropic.com/v1/messages` ([`src/byok.js` L49-L53](https://github.com/marbaji/maze/blob/main/src/byok.js#L49-L53)). There is no server of ours in between. The request also carries the header `anthropic-beta: server-side-fallback-2026-07-01`, which asks for Anthropic's server-side fallback: when Opus 5.5 declines a request, Anthropic answers it with an older Claude model and the page's log says so. The page keeps the key in `sessionStorage`, so it stays in that one tab until you close the tab or press "Forget key" ([`build/make-play-page.py` L97-L99](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L98-L100)), and the "Forget key" button removes it and stops any call in flight ([L122](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L115) and [L127](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L120)). The page's Content Security Policy allows connections only to `https://api.anthropic.com` ([L24-L26](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L24-L26)).

## Bugs

Use the "File a bug" button in the game, which opens a prefilled issue here, or open an issue directly.

## Rebuild and check

`index.html` is generated from `build/input/game-public.html` and `src/byok.js`:

```
python3 build/make-play-page.py
node tests/byok.test.cjs
bash tests/rebuild-check.sh
python3 tests/privacy-scan.py
python3 tests/import-check.py
python3 tests/readme-links-check.py
node tests/play-page-check.cjs index.html
node tests/play-behaviour.cjs
```

CI runs every check after the build on each pull request and push to `main`; the last two are Playwright browser checks and need `playwright` installed (`PLAYWRIGHT_PATH` can point at an install elsewhere).

## Licence

Apache-2.0, see `LICENSE`. Vendored files keep their own licences: `vendor/LICENSE-ses` and `fonts/OFL-*.txt`.
