"""Build step for the app (stdlib only).

Run from anywhere:  python3 tools_build_data.py
  1. validates data/catalog.json and every text file it lists (counts, numbering, fields),
  2. writes CORRECTIONS.md from the `corrections` and `variants` recorded in the data files,
  3. writes the calendar reminder files in reminders/ (RFC 5545, CRLF, folded lines),
  4. writes the precache list and a content-hash VERSION into sw.js
     (index.html, app.js, style.css, manifest, the catalog and the data/cover files of texts with "live": true,
      covers/titles.json, art/**/*.webp, fonts/*.woff2|txt, icons/*.png, reminders/*.ics).

The data files are the source of truth. The v1 prototype parsed raw Wikisource dumps (raw/),
which were not in the bundle; to re-check against Wikisource, fetch the pinned revisions:
  https://sa.wikisource.org/w/index.php?oldid=403980&action=raw
  https://mr.wikisource.org/w/index.php?oldid=156943&action=raw
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DIG = '०१२३४५६७८९'
def dn(n): return ''.join(DIG[int(c)] for c in str(n))
def rel(*p): return os.path.join(ROOT, *p)
def fail(msg): sys.exit('BUILD FAILED: ' + msg)

# ------------------------------------------------------------------ 1. validate
catalog = json.load(open(rel('data', 'catalog.json'), encoding='utf-8'))
gids = {g['id'] for g in catalog['groups']}
lids = {l['id'] for l in catalog['languages']}
texts = {}
KINDS = {'stotra', 'aarti'}
titles_path = rel('covers', 'titles.json')
title_lines = json.load(open(titles_path, encoding='utf-8'))['lines'] if os.path.isfile(titles_path) else {}
warnings = []
for e in catalog['texts']:
    if e['lang'] not in lids: fail(f"{e['id']}: unknown language {e['lang']}")
    if not e.get('groups') or not set(e['groups']) <= gids: fail(f"{e['id']}: unknown or missing group")
    if e.get('kind', 'stotra') not in KINDS: fail(f"{e['id']}: kind must be one of {sorted(KINDS)}")
    g = next((g for g in catalog['groups'] if g['id'] == e.get('deity')), None)
    if not g or g.get('kind') != 'deity': fail(f"{e['id']}: 'deity' must name a deity group (it picks the cover art)")
    if not g.get('cover') or not os.path.isfile(rel(g['cover'])): fail(f"{e['id']}: cover art {g.get('cover')} missing")
    cover_path = g['cover']
    if cover_path.lower().endswith('.svg'):
        svg = open(rel(cover_path), encoding='utf-8').read().lstrip()
        if not svg.startswith('<svg') or '<script' in svg or 'href=' in svg: fail(f"{cover_path}: must be a plain inline SVG (no scripts, no links)")
    elif cover_path.lower().endswith('.webp'):
        blob = open(rel(cover_path), 'rb').read(12)
        if blob[:4] != b'RIFF' or blob[8:12] != b'WEBP': fail(f"{cover_path}: not a WebP")
        if not str(g.get('cover_label', '')).strip(): fail(f"{e['id']}: an image cover needs cover_label (alt text)")
        if not isinstance(g.get('cover_w'), int) or not isinstance(g.get('cover_h'), int): fail(f"{e['id']}: an image cover needs integer cover_w and cover_h")
        thumb = g.get('cover_thumb')
        if not thumb or not os.path.isfile(rel(thumb)): fail(f"{e['id']}: cover thumbnail {thumb} missing")
        tblob = open(rel(thumb), 'rb').read(12)
        if tblob[:4] != b'RIFF' or tblob[8:12] != b'WEBP': fail(f"{thumb}: not a WebP")
    else:
        fail(f"{cover_path}: cover must be an SVG or a WebP")
    if not e.get('cover_lines') or not all(l.strip() for l in e['cover_lines']): fail(f"{e['id']}: cover_lines missing")
    for l in e['cover_lines']:
        if f"{l}|{e['lang']}" not in title_lines:
            warnings.append(f"{e['id']}: no outline for cover line '{l}' ({e['lang']}); it will show in the reading face")
    if not isinstance(e.get('live', True), bool): fail(f"{e['id']}: 'live' must be true or false")
    d = json.load(open(rel(e['file']), encoding='utf-8'))
    if d['id'] != e['id'] or d['lang'] != e['lang']: fail(f"{e['id']}: catalog/data mismatch")
    if d.get('kind', 'stotra') != e.get('kind', 'stotra'): fail(f"{e['id']}: catalog/data kind mismatch")
    if e.get('kind') == 'aarti':
        rf = d.get('refrain')
        if not rf or not rf.get('devanagari', '').strip() or rf.get('after') not in range(1, len(d['verses']) + 1):
            fail(f"{e['id']}: an aarti needs its refrain (ध्रुपद) and the stanza it follows")
        if not d.get('second_source', {}).get('url'): fail(f"{e['id']}: an aarti needs its second source")
    ns = [v['n'] for v in d['verses']]
    if ns != list(range(1, len(ns) + 1)): fail(f"{e['id']}: verses not numbered 1..n")
    if len(ns) != e['verses']: fail(f"{e['id']}: catalog says {e['verses']} verses, data has {len(ns)}")
    for v in d['verses']:
        if not v['devanagari'].rstrip().endswith('॥' + dn(v['n']) + '॥'): fail(f"{e['id']} {v['n']}: does not end with its number")
        if e.get('kind', 'stotra') == 'stotra' and not v.get('meaning_mr', '').strip(): fail(f"{e['id']} {v['n']}: empty meaning")
    texts[e['id']] = d

# ------------------------------------------------------------------ 2. CORRECTIONS.md
out = ['# दुरुस्त्या व पाठभेद (Corrections and variants)', '',
       'Policy: the pinned wiki revision (Wikisource for the stotras, Wikibooks for the aartis) is the base text. A reading is changed only when it is a clear error',
       '(typo, broken word, grammar, metre) **and** the corrected reading is attested in at least one other source.',
       'Readings where sources merely differ are recorded as variants and left unchanged for the human reviewer.',
       'This file is generated from `data/*.json` by `tools_build_data.py`.', '']
for tid, d in texts.items():
    src = d['sources']
    out += [f"## {d['title']} ({tid})", '',
            f"Base: [{d['source']['site']} — {d['source']['page']}]({d['source']['url']}), revision {d['source']['rev_id']}, "
            f"{d['source']['credit']}, CC BY-SA 4.0. Corrected text: CC BY-SA 4.0. "
            + ('Meanings: CC0 1.0 (AI draft, unreviewed).' if d.get('kind', 'stotra') == 'stotra' else 'Meanings: none yet.'), '']
    if d.get('second_source'):
        out += [f"Second source: [{d['second_source']['name']}]({d['second_source']['url']}) — public domain; {d['second_source'].get('reading', '')}.", '']
    out += [f"Native Marathi reader review: {(d.get('review') or {}).get('native_marathi') or 'not reviewed'}.", '',
            '| # | where | before | after | kind | basis | sources | status | in |', '|---|---|---|---|---|---|---|---|---|']
    for i, c in enumerate(d['corrections'], 1):
        out.append(f"| {i} | {c['where']} | {c['from']} | {c['to']} | {c['kind']} | {c['basis']} | {', '.join(c['sources']) or '—'} | {c['status']} | {c['release']} |")
    var_rows = []
    blks = d.get('front', []) + d['verses'] + ([dict(d['refrain'], label='ध्रुपद')] if d.get('refrain') else [])
    for blk in blks:
        where = blk.get('label') or ('॥' + dn(blk['n']) + '॥')
        for v in blk.get('variants', []):
            var_rows.append(f"| {where} | {v['reading']} | {', '.join(v['sources'])} | {v['note']} |")
    if var_rows:
        out += ['', 'Variants recorded, text not changed:', '', '| where | other reading | sources | note |', '|---|---|---|---|'] + var_rows
    rv_p = rel('review', tid + '.json')   # how an aarti was checked: not downloaded by phones
    if os.path.isfile(rv_p):
        rv = json.load(open(rv_p, encoding='utf-8')); d = dict(d, discrepancies=rv['discrepancies'], typography=rv.get('typography'))
        if rv.get('author_note'): out += ['', f"Author: {d['author']} — {rv['author_note']}"]
    if d.get('discrepancies'):
        out += ['', 'Every word-level difference between the base and the second source, and how it was resolved:', '',
                '| # | where | base (Wikibooks) | 1888 print | class | resolution |', '|---|---|---|---|---|---|']
        out += [f"| {i} | {x['where']} | {x['base']} | {x['print']} | {x['class']} | {x['resolution']} |" for i, x in enumerate(d['discrepancies'], 1)]
        if d.get('typography'): out += ['', 'Typography only (no words changed): ' + '; '.join(d['typography']) + '.']
    rev = [f"| ॥{dn(v['n'])}॥ | {v['meaning_review']} |" for v in d['verses'] if v.get('meaning_review', 'unreviewed') != 'unreviewed']
    if rev:
        out += ['', 'Meaning drafts edited or flagged in v2 (all meanings remain drafts):', '', '| verse | status |', '|---|---|'] + rev
    out += ['', 'Sources:', ''] + [f"- **{k}**: [{v['name']}]({v['url']})" for k, v in src.items()] + ['']
with open(rel('CORRECTIONS.md'), 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

# ------------------------------------------------------------------ 3. reminders (.ics)
def fold(line):
    parts, cur, limit = [], '', 75
    for ch in line:
        if len((cur + ch).encode('utf-8')) > limit:
            parts.append(cur); cur = ch; limit = 74  # continuation lines start with one space
        else:
            cur += ch
    parts.append(cur)
    return '\r\n '.join(parts)

def ics(uid, start, rrule, summary, desc):
    lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Majhi Stotre//mr', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
             'BEGIN:VEVENT', f'UID:{uid}', 'DTSTAMP:20261030T000000Z', f'DTSTART:{start}', 'DURATION:PT15M',
             f'RRULE:{rrule}', f'SUMMARY:{summary}', f'DESCRIPTION:{desc}', 'TRANSP:TRANSPARENT',
             'BEGIN:VALARM', 'ACTION:DISPLAY', f'DESCRIPTION:{summary}', 'TRIGGER:PT0M', 'END:VALARM',
             'END:VEVENT', 'END:VCALENDAR']
    return '\r\n'.join(fold(l) for l in lines) + '\r\n'

os.makedirs(rel('reminders'), exist_ok=True)
# floating local times (no TZID): the phone's own time zone applies
with open(rel('reminders', 'ramraksha-daily-1900.ics'), 'w', encoding='utf-8', newline='') as f:
    f.write(ics('ramraksha-daily-1900@majhi-stotre', '20260101T190000', 'FREQ=DAILY',
                'रामरक्षा स्तोत्र', '‘माझी स्तोत्रे’ उघडून रामरक्षा पठण करा.'))
with open(rel('reminders', 'bhimrupi-saturday-0700.ics'), 'w', encoding='utf-8', newline='') as f:
    f.write(ics('bhimrupi-saturday-0700@majhi-stotre', '20260103T070000', 'FREQ=WEEKLY;BYDAY=SA',
                'भीमरूपी स्तोत्र', '‘माझी स्तोत्रे’ उघडून भीमरूपी (मारुती) स्तोत्र पठण करा.'))

# ------------------------------------------------------------------ 4. sw.js precache list + version
runtime = ['index.html', 'app.js', 'style.css', 'manifest.webmanifest']
live = [e for e in catalog['texts'] if e.get('live', True)]
staged = [e['id'] for e in catalog['texts'] if not e.get('live', True)]
used = {'data/catalog.json', 'covers/titles.json'} | {e['file'] for e in live}
for g in catalog['groups']:
    if any(e.get('deity') == g['id'] for e in live):
        used.add(g['cover'])
        if g.get('cover_thumb'): used.add(g['cover_thumb'])
for sub, pat in [('data', r'\.json$'), ('covers', r'\.(svg|json)$'), ('fonts', r'\.(woff2|txt)$'), ('icons', r'\.png$'), ('reminders', r'\.ics$')]:
    runtime += sorted(f'{sub}/{n}' for n in os.listdir(rel(sub)) if re.search(pat, n) and (sub not in ('data', 'covers') or f'{sub}/{n}' in used))
art_files = []
for dirpath, _, files in os.walk(rel('art')):
    for n in files:
        if n.lower().endswith('.webp'):
            art_files.append(os.path.relpath(os.path.join(dirpath, n), ROOT).replace(os.sep, '/'))
runtime += sorted(art_files)
page = open(rel('index.html'), encoding='utf-8').read()
for attr in re.findall(r'(?:src|srcset)="([^"]+)"', page):
    for part in attr.split(','):
        url = part.strip().split(' ')[0]
        if url.startswith('art/') and not os.path.isfile(rel(url)): fail(f'index.html references missing {url}')
        if url.startswith('art/') and url not in runtime: fail(f'{url} is referenced but not precached')
h = hashlib.sha256()
for p in runtime:
    h.update(p.encode()); h.update(open(rel(p), 'rb').read())
version = h.hexdigest()[:12]
assets = ['./'] + ['./' + p for p in runtime]
sw = open(rel('sw.js'), encoding='utf-8').read()
sw, n1 = re.subn(r"^const VERSION = '.*?';$", f"const VERSION = '{version}';", sw, flags=re.M)
sw, n2 = re.subn(r"^const ASSETS = \[.*?\];$", 'const ASSETS = ' + json.dumps(assets) + ';', sw, flags=re.M)
if n1 != 1 or n2 != 1: fail('could not update VERSION/ASSETS in sw.js')
with open(rel('sw.js'), 'w', encoding='utf-8') as f:
    f.write(sw)
for w in warnings: print('WARNING:', w)
if staged: print('staged, not shown and not precached (set "live": true in data/catalog.json to release):', ', '.join(staged))
# './' and 'index.html' are fetched separately, so index.html counts twice; sw.js is downloaded too
size = sum(os.path.getsize(rel(p)) for p in runtime) + os.path.getsize(rel('index.html')) + os.path.getsize(rel('sw.js'))
print(f'offline download (all precached responses + sw.js, uncompressed): {size:,} bytes')
print(f'ok: {len(texts)} texts ({", ".join(f"{k} {len(v["verses"])}" for k, v in texts.items())}), '
      f'{len(assets)} precached files, sw VERSION {version}')
