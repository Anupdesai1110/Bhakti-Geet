# माझी स्तोत्रे — v2 (rebuild of the Bhakti Scroll prototype; local only, not published)

A free, ad-free, offline web app (PWA) for reading Shri Ramaraksha Stotram (Sanskrit) and the Bhimrupi
Maruti Stotra by Samarth Ramdas (Marathi), for older Marathi readers on phones. Vanilla HTML/CSS/JS,
no framework, no accounts, no analytics, no audio.

## Run locally
    node tests/serve.cjs . 8765          # or: python3 -m http.server 8765
    open http://localhost:8765/

## Files
| path | what |
|---|---|
| `index.html`, `style.css`, `app.js` | the app (page-turn reader, scroll and recitation modes, drawer, settings, share card, credits) |
| `sw.js` | service worker; `VERSION` and `ASSETS` are generated — do not edit by hand |
| `manifest.webmanifest`, `icons/` | install metadata; `icon-maskable-512.png` for Android, `apple-touch-icon.png` for iOS |
| `data/catalog.json` | the catalog: groups (deity or saint), languages, texts |
| `data/ramraksha.json`, `data/bhimrupi.json` | text, draft meanings, corrections, variants, sources |
| `fonts/` | Noto Serif Devanagari subset (WOFF2, 54 KB) + `OFL.txt` + notes |
| `reminders/*.ics` | calendar files for the "add to calendar" reminders |
| `CORRECTIONS.md` | every change to the Wikisource text, with sources (generated) |
| `NOTICE.md` | licences and attribution |
| `tools_build_data.py` | build step: validate data, write CORRECTIONS.md, .ics files, sw.js asset list + version |
| `tests/` | static tests, browser tests, screenshot script, before/after screenshots |

Upgrading the v1 folder in place: delete `fonts/NotoSerifDevanagari.ttf` (replaced by the WOFF2). The v1 build read `raw/`, which was never in the bundle; v2 treats `data/*.json` as the source.

## After any edit
    python3 tools_build_data.py      # updates sw.js VERSION so installed apps pick up the change

## Tests
    sh tests/run_all.sh              # python3 static checks, then Chromium tests and screenshots (Node + playwright)

## Add a text, a group or a language
1. Add the text file `data/<id>.json` (same shape as `bhimrupi.json`: `id`, `title`, `lang`, `source`, `front`, `verses`, `back`, `corrections`, `sources`).
2. Add one entry to `texts` in `data/catalog.json`: `id`, `file`, `title`, `short`, `lang`, `groups` (one or more group ids), `author`, `verses`.
3. New deity or saint: add `{ "id", "kind": "deity" | "saint", "name" }` to `groups`. New language: add `{ "id", "name" }` to `languages`.
   Order in the arrays is the order in the drawer. Empty groups and languages are hidden automatically.
4. Run `python3 tools_build_data.py` (it validates the catalog and adds the file to the offline cache), then the tests.
The font subset covers the whole Devanagari block, so Marathi, Sanskrit and Hindi texts need no font change.

## Hosting
Any static host works; no special headers are required (the service worker registers with `updateViaCache: 'none'`).
See the findings report, section C, for the recommendation.
