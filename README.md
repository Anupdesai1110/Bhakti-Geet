# माझी स्तोत्रे — v3

A free, ad-free, offline web app (PWA) for reading Marathi and Sanskrit devotional texts on phones, made for
older Marathi readers. Vanilla HTML/CSS/JS, no framework, no accounts, no analytics, no audio.
Live at https://anupdesai1110.github.io/Bhakti-Geet/ (GitHub Pages; all paths are relative, so the folder works
under `/Bhakti-Geet/` or at a domain root unchanged).

New in v3: a cover page for each text (original symbolic art + calligraphic title), a paper look in the
पोथी (sepia) theme, a calmer menu (continue reading, progress, groups by deity/saint or by language),
warmer Marathi wording, and support for aartis (refrain, stanzas) — staged for the next release.

## Run locally
    python3 -m http.server 8765      # then open http://localhost:8765/

## Files
| path | what |
|---|---|
| `index.html`, `style.css`, `app.js` | the app (cover + page-turn reader, scroll and recitation modes, menu, settings, share card, credits) |
| `sw.js` | service worker; `VERSION` and `ASSETS` are generated — do not edit by hand |
| `manifest.webmanifest`, `icons/` | install metadata |
| `data/catalog.json` | groups (deity or saint, with cover art), languages, texts (`kind`, `deity`, `cover_lines`, `live`) |
| `data/<id>.json` | one text: verses (or stanzas + refrain), draft meanings (stotras only), corrections, variants, sources |
| `review/<id>.json` | (aartis) how the text was checked: every difference from the second source; not downloaded by phones |
| `covers/*.svg` | original cover art, one per deity (CC0) |
| `covers/titles.json` | cover title lines as SVG outlines (Gotu, OFL) — see `fonts/README.md` |
| `fonts/` | Noto Serif Devanagari subset (WOFF2) + `OFL.txt`; `OFL-Gotu.txt` for the title outlines; notes |
| `reminders/*.ics` | calendar files for the "add to calendar" reminders |
| `CORRECTIONS.md` | every change to the base texts and every recorded variant, with sources (generated) |
| `NOTICE.md` | licences and attribution |
| `tools_build_data.py` | build step: validate, write CORRECTIONS.md, .ics files, sw.js asset list + version; prints the offline size |

## After any edit
    python3 tools_build_data.py

It validates the catalog and data, regenerates `sw.js` (so installed apps pick up the change) and prints the
offline download size and any warnings (for example a cover title line without an outline).

## Releasing a staged text (one deity group at a time)
A text with `"live": false` in `data/catalog.json` is hidden in the app and not downloaded for offline use.
To release one: have a native Marathi reader check it (record the result in the text's `review.native_marathi`
field), set `"live": true` for that text, run the build, deploy.

## Add a text
1. Add `data/<id>.json` (same shape as `bhimrupi.json` for a stotra; as `sukhkarta.json` in the release-B bundle for an aarti).
2. Add an entry to `texts` in `data/catalog.json`: `id`, `kind` (`stotra` or `aarti`), `file`, `title`, `short`, `lang`,
   `deity` (a deity group: it picks the cover art), `groups`, `author`, `verses`, `cover_lines` (the title as 1–2 lines), `live`.
3. New deity: add `{ "id", "kind": "deity", "name", "cover": "covers/<id>.svg", "cover_label" }` to `groups` and draw the
   cover as a plain SVG (no scripts, no links; colour classes `e-main`, `e-mainline`, `e-line`, `e-soft`, `e-sun`, `e-cut`).
4. Run the build, then the tests (in the dev bundle: `node test_v3.cjs <url>`, `node test_B.cjs <url>`; needs Node + Playwright).

## Hosting
Any static host works; no special headers are required (the service worker registers with `updateViaCache: 'none'`).
