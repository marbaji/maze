# Unwinnable Maze

An interactive article where each switch position is one way to enforce a rule on an AI. Code (proof) should be unbreakable; if you beat it, that is a bug: file it in Issues.

Play at https://artifacts.mohannadarbaji.com/maze/

## How your API key is handled

The "Ask anything" feature needs an Anthropic API key that you paste in yourself. The page trims the key ([`src/byok.js` L38](https://github.com/marbaji/maze/blob/main/src/byok.js#L38)) and sends it only in the `x-api-key` header of a request to `https://api.anthropic.com/v1/messages` ([`src/byok.js` L44-L47](https://github.com/marbaji/maze/blob/main/src/byok.js#L44-L47)). There is no server of ours in between. The page keeps the key in `sessionStorage`, so it is gone when the tab closes ([`build/make-play-page.py` L73-L75](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L73-L75)), and the "Forget key" button removes it and stops any call in flight ([L91](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L91) and [L96](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L96)). The page's Content Security Policy allows connections only to `https://api.anthropic.com` ([L20-L22](https://github.com/marbaji/maze/blob/main/build/make-play-page.py#L20-L22)).

## Bugs

Use the "File a bug" button in the game, which opens a prefilled issue here, or open an issue directly.

## Rebuild and check

`index.html` is generated from `build/input/game-public.html` and `src/byok.js`:

```
python3 build/make-play-page.py
node tests/byok.test.cjs
bash tests/rebuild-check.sh
python3 tests/privacy-scan.py
```

CI runs the last three on every pull request and push to `main`. `tests/play-page-check.cjs` and `tests/play-behaviour.cjs` are Playwright browser checks that you run by hand.

## Licence

Apache-2.0, see `LICENSE`. Vendored files keep their own licences: `vendor/LICENSE-ses` and `fonts/OFL-*.txt`.
