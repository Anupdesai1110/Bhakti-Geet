# माझी स्तोत्रे — v3.2 (draft)

Free, ad-free, offline PWA for reading Marathi and Sanskrit devotional texts. Vanilla HTML/CSS/JS. No accounts, analytics or audio.

Run: `python3 -m http.server 8765`, open http://localhost:8765/.
After any edit: `python3 tools_build_data.py` (validates data, regenerates `CORRECTIONS.md`, `.ics` files and `sw.js` VERSION/ASSETS; never edit those by hand).
Test: `node tests/smoke.cjs <url>` (needs `playwright-core` and Chrome): walks every screen, checks no JS errors and that the app opens offline.

| path | what |
|---|---|
| `index.html`, `style.css`, `app.js` | the app; icons are inline SVG symbols in `index.html` |
| `sw.js` | service worker (generated lists) |
| `data/catalog.json`, `data/<id>.json` | texts and their sources. `"live": false` hides a text |
| `covers/` | cover art (CC0) and title outlines (Gotu, OFL) |
| `fonts/`, `NOTICE.md` | font + licences, attribution |
| `reminders/*.ics` | calendar reminder files |
| `tools_build_data.py` | the build step |

Test hook: `window.__stotre` (read-only state, paging, share-card checks).
