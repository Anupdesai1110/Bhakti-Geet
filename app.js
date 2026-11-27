/* माझी स्तोत्रे — app.js
 * Vanilla JS. Offline-first. No framework, no accounts, no analytics, no audio.
 * Reading model: text → blocks (title, front matter, verses, colophon) → rows (lines or padas,
 * meaning lines) → measured in an off-screen box → packed into pages that never clip.
 */
'use strict';
(() => {
  const APP_VERSION = '3.2.0';
  const STORE_KEY = 'bhakti.v2';
  const FONT_FAMILY = 'NotoSerifDevaSub';
  const SIZE_MIN = 20, SIZE_MAX = 56, SIZE_DEFAULT = 34;
  const SPEED_LPM = [6, 9, 12, 15, 18, 22, 26, 30, 35, 40]; // recitation: visual lines per minute, levels 1..10
  const THEME_BG = { paper: '#FBF7EF', sepia: '#F1E3C6', night: '#14110E' };
  const DIG = '०१२३४५६७८९';
  const dn = (n) => String(n).replace(/[0-9]/g, (d) => DIG[+d]);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const media = (q) => (window.matchMedia ? window.matchMedia(q) : { matches: false, addEventListener() {} });
  const reduceMQ = media('(prefers-reduced-motion: reduce)');
  const darkMQ = media('(prefers-color-scheme: dark)');

  /* ------------------------------------------------------------------ state */
  const DEFAULTS = {
    v: 2, text: null, size: SIZE_DEFAULT, theme: null, meaning: false, motion: null, mode: 'page',
    target: 11, count: {}, anchor: {}, speed: 4,
  };
  const st = loadState();

  function loadState() {
    let s = null;
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) s = JSON.parse(raw); } catch (e) { s = null; }
    if (!s || typeof s !== 'object' || s.v !== 2) s = migrateV1();
    const o = Object.assign({}, DEFAULTS, s || {});
    o.size = clamp(Math.round(+o.size) || SIZE_DEFAULT, SIZE_MIN, SIZE_MAX);
    o.target = clamp(Math.round(+o.target) || 11, 1, 100000);
    o.speed = clamp(Math.round(+o.speed) || 4, 1, 10);
    if (!o.count || typeof o.count !== 'object') o.count = {};
    if (!o.anchor || typeof o.anchor !== 'object') o.anchor = {};
    if (!['page', 'scroll'].includes(o.mode)) o.mode = 'page';
    if (![null, 'paper', 'sepia', 'night'].includes(o.theme)) o.theme = null;
    if (![null, true, false].includes(o.motion)) o.motion = null;
    o.meaning = o.meaning === true;
    return o;
  }
  function migrateV1() { // prototype key 'bhakti'
    try {
      const raw = localStorage.getItem('bhakti'); if (!raw) return null;
      const o = JSON.parse(raw) || {}; const s = {};
      if (o.text === 'ramraksha' || o.text === 'bhimrupi') s.text = o.text;
      if (+o.fs > 24) s.size = +o.fs;
      if (o.night === true) s.theme = 'night';
      if (+o.target > 0) s.target = +o.target;
      if (o.count && typeof o.count === 'object') s.count = o.count;
      if (o.pos && typeof o.pos === 'object') {
        s.anchor = {};
        if (Number.isInteger(o.pos.ramraksha)) s.anchor.ramraksha = { id: o.pos.ramraksha === 0 ? 'viniyoga' : 'v' + o.pos.ramraksha, f: 0 };
        if (Number.isInteger(o.pos.bhimrupi)) { let n = o.pos.bhimrupi + 1; if (n >= 14) n += 1; s.anchor.bhimrupi = { id: 'v' + n, f: 0 }; }
      }
      return s;
    } catch (e) { return null; }
  }
  let saveTimer = 0;
  function save(now) {
    clearTimeout(saveTimer);
    const write = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch (e) { /* storage blocked or full: keep working in memory */ } };
    if (now) write(); else saveTimer = setTimeout(write, 200);
  }

  const themeNow = () => st.theme || (darkMQ.matches ? 'night' : 'paper');
  const motionOn = () => (st.motion === null ? !reduceMQ.matches : st.motion);
  function applyTheme() {
    const t = themeNow();
    document.documentElement.dataset.theme = t;
    const m = $('#themeColor'); if (m) m.setAttribute('content', THEME_BG[t]);
    document.documentElement.dataset.motion = motionOn() ? 'on' : 'off';
  }

  /* ------------------------------------------------------- Devanagari text */
  const C = '[\\u0915-\\u0939\\u0958-\\u095F\\u0978-\\u097F]';
  const MATRA = '[\\u093A\\u093B\\u093E-\\u094C\\u094E\\u094F\\u0955-\\u0957\\u0962\\u0963]';
  const MOD = '[\\u0900-\\u0903\\u093D\\u0951-\\u0954\\u1CD0-\\u1CFF\\uA8E0-\\uA8F1]';
  const IV = '[\\u0904-\\u0914\\u0950\\u0960\\u0961\\u0972-\\u0977]';
  const J = '[\\u200C\\u200D]';
  const RE_AK = new RegExp(`(?:${C}\\u093C?${J}?\\u094D${J}?)*${C}\\u093C?(?:${MATRA}|\\u094D${J}?(?!${C}))?${MOD}*|${IV}${MATRA}?${MOD}*|[\\s\\S]`, 'gu');
  const RE_HALF_ONLY = new RegExp(`^${C}\\u093C?\\u094D${J}?$`, 'u');
  const RE_LETTER = /[ऄ-हॐक़-ॡॲ-ॿ]/u;
  const RE_PUNCT_TOKEN = /^[।॥०-९\-–]+$/u;

  /** Split a word into aksharas (orthographic syllables). A conjunct is never split. */
  function aksharas(word) {
    const out = [];
    for (const a of word.match(RE_AK) || []) {
      if (out.length && RE_HALF_ONLY.test(a)) out[out.length - 1] += a; // word-final half consonant stays with the previous akshara
      else out.push(a);
    }
    return out;
  }
  const letters = (w) => aksharas(w).filter((a) => RE_LETTER.test(a)).length;

  /** Soft hyphens between aksharas of long words, so the browser can break a long Sanskrit
   *  compound only between aksharas (with a visible hyphen) and never clips it. */
  function shy(word, min = 8) {
    const ak = aksharas(word);
    const L = ak.reduce((n, a) => n + (RE_LETTER.test(a) ? 1 : 0), 0);
    if (L < min) return word;
    let out = '', k = 0;
    for (let i = 0; i < ak.length; i++) {
      out += ak[i];
      if (RE_LETTER.test(ak[i])) k++;
      if (k >= 3 && L - k >= 3 && i + 1 < ak.length && RE_LETTER.test(ak[i + 1])) out += '­';
    }
    return out;
  }

  /** Words of a line; danda, verse number and leading punctuation are glued to a word with NBSP. */
  function words(line) {
    const out = []; let lead = '';
    for (const t of line.trim().split(/\s+/)) {
      if (!t) continue;
      if (RE_PUNCT_TOKEN.test(t)) { if (out.length) out[out.length - 1] += ' ' + t; else lead += t + ' '; }
      else { out.push(lead + t); lead = ''; }
    }
    if (lead) out.push(lead.trim());
    return out;
  }

  /** Split one printed line (usually a half-verse) at its pada / yati boundary.
   *  16 → 8+8, 22 → 11+11, 19 → 12+7, 21 → 14+7, 14 → 8+6. Falls back to an akshara break with a hyphen. */
  function splitLine(line) {
    const ws = words(line);
    if (ws.length === 0) return null;
    const syl = ws.map(letters);
    const total = syl.reduce((a, b) => a + b, 0);
    if (total < 12) return null;
    const RATIO = { 19: 12 / 19, 21: 14 / 21, 14: 8 / 14, 15: 8 / 15 };
    const target = Math.round(total * (RATIO[total] || 0.5));
    let best = -1, bestDiff = 1e9, cum = 0;
    for (let k = 0; k < ws.length - 1; k++) {
      cum += syl[k];
      const d = Math.abs(cum - target);
      if (d < bestDiff) { bestDiff = d; best = k; }
    }
    if (best >= 0 && bestDiff <= 2) return [ws.slice(0, best + 1).join(' '), ws.slice(best + 1).join(' ')];
    cum = 0;
    for (let k = 0; k < ws.length; k++) {
      const need = target - cum;
      if (need > 0 && need < syl[k] && need >= 2 && syl[k] - need >= 2) {
        const ak = aksharas(ws[k]); let n = 0, i = 0;
        for (; i < ak.length; i++) { if (RE_LETTER.test(ak[i])) { if (n === need) break; n++; } }
        const head = ak.slice(0, i).join(''), tail = ak.slice(i).join('');
        return [ws.slice(0, k).concat(head + '-').join(' '), [tail].concat(ws.slice(k + 1)).join(' ')];
      }
      cum += syl[k];
    }
    return best >= 0 ? [ws.slice(0, best + 1).join(' '), ws.slice(best + 1).join(' ')] : null;
  }

  function wordHTML(w) {
    const m = w.match(/^(.*?)((?: [^ ]+)*)$/u);
    let body = m ? m[1] : w; const tail = m ? m[2] : '';
    let lead = '';
    const lm = body.match(/^((?:[।॥]+ )+)(.*)$/u);
    if (lm) { lead = lm[1].replace(/ /g, '&nbsp;'); body = lm[2]; }
    let hy = '';
    if (body.endsWith('-')) { body = body.slice(0, -1); hy = '-'; }
    let h = lead + esc(shy(body)) + hy;
    if (tail) h += tail.split(' ').filter(Boolean).map((p) => '&nbsp;' + (/^॥[०-९]+॥$/u.test(p) ? `<span class="vn">${esc(p)}</span>` : esc(p))).join('');
    return h;
  }
  const lineHTML = (text, spans) => words(text).map((w) => (spans ? `<span class="w" data-w="${esc(w)}">${wordHTML(w)}</span>` : wordHTML(w))).join(' ');
  function meaningHTML(text, first, spans) {
    const tag = first ? '<span class="tag">मसुदा</span>' : '';
    const ws = text.trim().split(/\s+/);
    return tag + ws.map((w) => (spans ? `<span class="w" data-w="${esc(w)}">${esc(shy(w, 11))}</span>` : esc(shy(w, 11)))).join(' ');
  }

  /* ---------------------------------------------------------- catalog/data */
  let catalog = null, text = null, entry = null, blocks = [], rows = [], rowH = [], pages = [], cur = 0;
  let px = { fs: 34, mfs: 20, rgap: 10, mgap: 16, bgap: 29 };
  const textCache = {};
  async function loadJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  function buildBlocks(t) {
    const B = [{ id: 'cover', kind: 'cover' }]; // page one: the cover (not counted by the indicator)
    for (const f of t.front || []) B.push({ id: f.id, kind: f.kind === 'verse' ? 'verse' : 'prose', label: f.label, lines: f.devanagari.split('\n') });
    for (const v of t.verses) {
      B.push({ id: 'v' + v.n, kind: 'verse', n: v.n, lines: v.devanagari.split('\n'), meaning: v.meaning_mr });
      if (t.refrain && t.refrain.after === v.n) B.push({ id: 'refrain', kind: 'verse', refrain: true, label: 'ध्रुपद', lines: t.refrain.devanagari.split('\n') });
    }
    for (const b of t.back || []) B.push({ id: b.id, kind: 'prose', label: b.label, lines: b.devanagari.split('\n') });
    return B;
  }
  function rowsFor(b, split) {
    if (b.kind === 'cover') return [];
    if (b.kind === 'title') return [{ t: 'title', text: b.title }].concat(b.sub ? [{ t: 'sub', text: b.sub }] : []);
    const R = [];
    b.lines.forEach((line, li) => {
      const parts = split && b.kind === 'verse' ? splitLine(line) : null;
      if (parts) { R.push({ t: 'v', text: parts[0], gap: li > 0 }); R.push({ t: 'v', text: parts[1], gap: false }); }
      else R.push({ t: 'v', text: line, gap: split && li > 0 });
    });
    if (b.meaning && st.meaning) R.push({ t: 'm', text: b.meaning, first: true });
    return R;
  }
  function blockHTML(b, R, from, to, spans) {
    const rs = R.slice(from, to);
    // the cover is drawn by coverHTML(); here it is an empty placeholder so that measured
    // .blk elements stay index-aligned with blocks[]
    if (b.kind === 'cover') return '<div class="blk cover-ph" data-id="cover"></div>';
    if (b.kind === 'title') return `<header class="blk title" data-id="title">${rs.map((r) => `<span class="row ${r.t}">${esc(r.text)}</span>`).join('')}</header>`;
    const vr = rs.filter((r) => r.t === 'v'), mr = rs.filter((r) => r.t === 'm');
    let h = `<article class="blk ${b.kind}${b.refrain ? ' refrain' : ''}" data-id="${esc(b.id)}">`;
    if (vr.length) h += `<p class="vtext">${vr.map((r) => `<span class="row${r.gap ? ' gap' : ''}">${lineHTML(r.text, spans)}</span>`).join('')}</p>`;
    if (mr.length) h += `<div class="mean" lang="mr">${mr.map((r) => `<span class="row">${meaningHTML(r.text, r.first, spans)}</span>`).join('')}</div>`;
    return h + '</article>';
  }

  /* --------------------------------------------------------------- layout */
  function geometry() {
    const vp = $('#viewport');
    const W = vp.clientWidth || window.innerWidth, H = vp.clientHeight || window.innerHeight;
    const cs = getComputedStyle($('.page[data-slot="cur"]'));
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0;
    const side = clamp(Math.round(W * 0.055), 16, 48);
    const colW = Math.max(200, Math.floor(Math.min(W - pl - pr - 2 * side, 680)));
    const pageH = Math.max(160, Math.floor(H - pt - pb) - 6);
    return { W, H, colW, pageH };
  }
  function setTypeVars(colW) {
    const fs = st.size, mfs = Math.max(17, Math.round(fs * 0.6));
    px = { fs, mfs, rgap: Math.round(fs * 0.3), mgap: Math.round(mfs * 0.8), bgap: Math.round(fs * 1.15) };
    const r = document.documentElement.style;
    r.setProperty('--fs', fs + 'px'); r.setProperty('--mfs', mfs + 'px');
    r.setProperty('--tfs', Math.max(20, Math.round(fs * 0.66)) + 'px'); r.setProperty('--afs', Math.max(15, Math.round(fs * 0.44)) + 'px');
    r.setProperty('--rgap', px.rgap + 'px'); r.setProperty('--mgap', px.mgap + 'px'); r.setProperty('--bgap', px.bgap + 'px');
    if (colW) r.setProperty('--colW', colW + 'px');
  }

  /** Measure everything at the current size and width; fills rows[] and rowH[]. */
  function measure(g) {
    const meas = $('#measure');
    meas.style.width = g.colW + 'px';
    meas.setAttribute('lang', text.lang);
    // 1. which verses need pada-per-line layout at this size
    meas.innerHTML = '<div class="pbody">' + blocks.map((b, i) => (b.kind === 'verse'
      ? `<div class="blk verse nowrap" data-i="${i}"><p class="vtext">${b.lines.map((l) => `<span class="row">${lineHTML(l)}</span>`).join(' ')}</p></div>` : '')).join('') + '</div>';
    const split = blocks.map(() => false);
    $$('.nowrap', meas).forEach((el) => { split[+el.dataset.i] = $$('.row', el).some((r) => r.getBoundingClientRect().width > g.colW + 0.5); });
    // 2. rows; meaning paragraphs (and any row taller than a page) are cut into visual lines
    rows = blocks.map((b, i) => rowsFor(b, split[i]));
    meas.innerHTML = '<div class="pbody">' + blocks.map((b, i) => blockHTML(b, rows[i], 0, rows[i].length, true)).join('') + '</div>';
    $$('.pbody > .blk', meas).forEach((el, i) => {
      const R = rows[i], out = [];
      $$('.row', el).forEach((re, k) => {
        const r = R[k];
        if (r.t !== 'm' && re.getBoundingClientRect().height <= g.pageH) { out.push(r); return; }
        const lines = []; let top = null;
        $$('.w', re).forEach((s) => { const y = s.offsetTop; if (top === null || Math.abs(y - top) > 3) { lines.push([]); top = y; } lines[lines.length - 1].push(s.dataset.w); });
        if (!lines.length) { out.push(r); return; }
        lines.forEach((ws, li) => out.push({ t: r.t, text: ws.join(' '), gap: li === 0 ? r.gap : false, first: li === 0 && !!r.first }));
      });
      rows[i] = out;
    });
    // 3. final row heights
    meas.innerHTML = '<div class="pbody">' + blocks.map((b, i) => blockHTML(b, rows[i], 0, rows[i].length)).join('') + '</div>';
    rowH = $$('.pbody > .blk', meas).map((el) => $$('.row', el).map((re) => Math.ceil(re.getBoundingClientRect().height * 100) / 100));
    meas.innerHTML = '';
  }
  function partHeight(i, from, to) {
    let h = 0, sawV = false, sawM = false;
    for (let k = from; k < to; k++) {
      const r = rows[i][k];
      if (r.t === 'm') { if (!sawM && sawV) h += px.mgap; sawM = true; }
      else if (r.t === 'v') { if (r.gap && sawV) h += px.rgap; sawV = true; }
      h += rowH[i][k];
    }
    return h;
  }
  function pack(pageH) {
    const P = []; let curP = [], used = 0;
    const flush = () => { if (curP.length) P.push(curP); curP = []; used = 0; };
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].kind === 'cover') { flush(); P.push([{ i, from: 0, to: 0 }]); continue; } // always a page of its own
      const n = rows[i].length; if (!n) continue;
      const full = partHeight(i, 0, n), gap = curP.length ? px.bgap : 0;
      if (used + gap + full <= pageH) { curP.push({ i, from: 0, to: n }); used += gap + full; continue; }
      if (full <= pageH) { flush(); curP.push({ i, from: 0, to: n }); used = full; continue; }
      // taller than one page: flow it row by row
      if (curP.length && pageH - used - gap < pageH * 0.35) flush();
      let from = 0;
      while (from < n) {
        const lead = curP.length ? used + px.bgap : 0;
        let to = from;
        while (to < n && lead + partHeight(i, from, to + 1) <= pageH) to++;
        if (to === from) { if (curP.length) { flush(); continue; } to = from + 1; } // a single row larger than a page cannot happen after step 2, but never loop
        if (to < n && n - to === 1 && to - from >= 3 && rows[i][to].t === 'v') to--; // no lone last line
        curP.push({ i, from, to }); used = lead + partHeight(i, from, to);
        if (to < n) flush();
        from = to;
      }
    }
    flush();
    return P;
  }
  const isCover = (p) => !!(p && p.length && blocks[p[0].i] && blocks[p[0].i].kind === 'cover');
  const pageHTML = (p) => (isCover(p) ? coverHTML(false)
    : `<div class="pbody" lang="${esc(text.lang)}">${p.map((part) => blockHTML(blocks[part.i], rows[part.i], part.from, part.to)).join('')}</div>`);
  function pageLabel(p) {
    if (!p || isCover(p)) return ''; // the indicator does not count the cover
    const ns = [], labels = [];
    for (const part of p) { const b = blocks[part.i]; if (b.kind === 'verse' && b.n) { if (!ns.includes(b.n)) ns.push(b.n); } else if (b.label && !labels.includes(b.label)) labels.push(b.label); }
    const N = dn(text.verses.length);
    if (ns.length) return (ns.length === 1 ? dn(ns[0]) : `${dn(ns[0])}–${dn(ns[ns.length - 1])}`) + ' / ' + N;
    return labels.join(' · ') || text.short;
  }
  function anchorOf(pi) {
    const part = pages[pi] && (pages[pi].find((x) => blocks[x.i].kind !== 'title') || pages[pi][0]);
    if (!part) return null;
    return { id: blocks[part.i].id, f: rows[part.i].length ? part.from / rows[part.i].length : 0 };
  }
  function pageOfAnchor(a) {
    if (!a) return 0;
    const id = typeof a === 'string' ? a : a.id, f = (a && a.f) || 0;
    const bi = blocks.findIndex((b) => b.id === id);
    if (bi < 0) return 0;
    let best = -1;
    pages.forEach((p, pi) => p.forEach((part) => { if (part.i === bi) { if (best < 0) best = pi; if (part.from / rows[bi].length <= f + 1e-6) best = pi; } }));
    return Math.max(0, best);
  }

  /* ---------------------------------------------------------------- cover */
  const coverSVG = {};                       // path → inline SVG markup (our own files, precached)
  let coverRow = false;                      // side-by-side layout for short, wide screens
  const groupOf = (id) => (catalog && catalog.groups.find((g) => g.id === id)) || null;
  const kindOf = (e) => (e && e.kind) || 'stotra';
  const UNIT = { stotra: { one: 'श्लोक', many: 'श्लोक', gen: 'या स्तोत्राची', at: 'श्लोकावर' }, aarti: { one: 'कडवे', many: 'कडवी', gen: 'या आरतीची', at: 'कडव्यावर' } };
  const unit = (e, k) => (UNIT[kindOf(e)] || UNIT.stotra)[k || 'one'];
  let titleData = null; // covers/titles.json: calligraphic title lines as SVG outlines (Gotu, OFL), made at build time
  async function loadTitles() {
    if (titleData) return;
    try { const r = await fetch('covers/titles.json'); titleData = r.ok ? await r.json() : { lines: {} }; } catch (err) { titleData = { lines: {} }; }
  }
  /** One cover-title line: the outline when we have it, otherwise plain text in the reading face. */
  function titleLineHTML(line, lang) {
    const t = titleData && titleData.lines && titleData.lines[line + '|' + lang];
    if (!t) return `<span class="ln txt" aria-hidden="true">${esc(line)}</span>`;
    const [x0, x1, y0, y1, d] = t, w = x1 - x0, h = y1 - y0; // font units, 1000 per em; the box holds all the ink
    return `<svg class="ln" viewBox="${x0} ${y0} ${w} ${h}" width="${(w / 1000).toFixed(3)}em" height="${(h / 1000).toFixed(3)}em" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
  }
  const isSvgCover = (g) => !!(g && g.cover && /\.svg$/i.test(g.cover));
  async function loadCoverArt(e) {
    await loadTitles();
    const g = groupOf(e && e.deity); const path = g && g.cover;
    if (!path || coverSVG[path] !== undefined) return;
    if (!isSvgCover(g)) { coverSVG[path] = ''; return; } // a painting: the <img> loads it; the service worker has it cached
    try {
      const r = await fetch(path); const svg = await r.text();
      coverSVG[path] = r.ok && /^<svg[\s>]/.test(svg.trim()) ? svg.trim() : '';
    } catch (err) { coverSVG[path] = ''; } // offline before first cache: the cover shows text only
  }
  /** Cover plate: an inline SVG emblem, or a painting with its thumbnail for narrow screens. */
  function coverArtHTML(g) {
    if (!g || !g.cover) return '';
    if (isSvgCover(g)) {
      const svg = coverSVG[g.cover] || '';
      return svg ? `<div class="cover-art" role="img" aria-label="${esc(g.cover_label || g.name || '')}">${svg}</div>` : '';
    }
    const full = g.cover, thumb = g.cover_thumb || full, w = g.cover_w || 1200, h = g.cover_h || 1600;
    const set = thumb === full ? '' : ` srcset="${esc(thumb)} 400w, ${esc(full)} ${w}w"`;
    return `<div class="cover-art painting"><img src="${esc(full)}"${set} sizes="(min-width: 900px) 300px, 68vw" width="${w}" height="${h}" alt="${esc(g.cover_label || g.name || '')}" decoding="async"></div>`;
  }
  function markHTML(g) {
    if (!g || !g.cover) return '';
    if (isSvgCover(g)) return coverSVG[g.cover] || '';
    const src = g.cover_thumb || g.cover;
    return `<img src="${esc(src)}" alt="" width="400" height="533" decoding="async" loading="lazy">`;
  }
  /** Where "continue" should go for a text, or null (nothing read yet, or already finished). */
  function progressOf(id, total) {
    const a = st.anchor[id]; const aid = a && a.id;
    if (!aid || aid === 'cover') return null;
    const m = /^v(\d+)$/.exec(aid);
    if (m) { const n = +m[1]; return { anchor: a, n, total, done: n >= total }; }
    if (aid === 'colophon') return { anchor: a, n: total, total, done: true };
    if (aid === 'refrain') { const t = textCache[id]; const n = (t && t.refrain && t.refrain.after) || 1; return { anchor: a, n, total, done: n >= total }; } // the aarti's refrain follows its stanza
    return { anchor: a, n: 0, total, done: false };
  }
  function resumeTarget() {
    if (!text) return null;
    const p = progressOf(text.id, text.verses.length);
    if (!p || p.done) return null;
    const b = blocks.find((x) => x.id === p.anchor.id);
    const where = p.n ? `${unit(entry)} ${dn(p.n)}` : (b && b.label ? `‘${b.label}’` : '');
    return { anchor: p.anchor, label: where ? `${where} पासून पुढे वाचा` : 'जिथे थांबलात तिथून पुढे वाचा' };
  }
  function coverHTML(inScroll) {
    const e = entry || {}; const g = groupOf(e.deity) || {};
    const lines = e.cover_lines && e.cover_lines.length ? e.cover_lines : [text.title];
    const art = coverArtHTML(g);
    const slot = !inScroll && resumeTarget() ? '<span class="cover-slot" aria-hidden="true"></span>' : '';
    return `<div class="pbody cover${coverRow && !inScroll ? ' row' : ''}" data-id="cover">`
      + art
      + '<div class="cover-text">' + (coverTrim < 1 || inScroll ? '<p class="cover-shri" aria-hidden="true">॥ श्री ॥</p>' : '')
      + `<h1 class="cover-title" lang="${esc(text.lang)}" aria-label="${esc(text.title)}">${lines.map((l) => titleLineHTML(l, text.lang)).join('')}</h1>`
      + (text.subtitle ? `<p class="cover-sub">${esc(text.subtitle)}</p>` : '')
      + (text.author ? `<p class="cover-author">${esc(text.author)}</p>` : '')
      + slot
      + (inScroll || coverTrim >= 2 ? '' : '<p class="cover-hint" aria-hidden="true">›</p>')
      + '</div></div>';
  }
  /** Size the cover for this page box so nothing is ever clipped, at any text size or orientation.
   *  One scale factor for type, gaps and art is binary-searched; the decorative "॥ श्री ॥" and the
   *  hint line are dropped only if even the smallest scale does not fit. */
  let coverTrim = 0; // 0 = full cover, 1 = without ॥ श्री ॥, 2 = also without the hint
  function fitCover(g) {
    const meas = $('#measure'), r = document.documentElement.style;
    const W = g.colW, H = g.pageH;
    const grp = groupOf(entry && entry.deity) || {};
    // --cart is the art's width. A 3:4 painting is taller than the old square emblem, so the width
    // budget is the old height budget divided by height/width and the picture stays about as tall.
    const ratio = isSvgCover(grp) || !grp.cover ? 1 : (grp.cover_h || 4) / (grp.cover_w || 3);
    coverRow = g.W > g.H * 1.2 && g.H < 640;
    const T0 = clamp(Math.round(st.size * 1.3), 34, 72), S0 = clamp(Math.round(st.size * 0.6), 17, 26);
    const A0 = coverRow
      ? Math.min(Math.round(H * 0.88 / ratio), Math.round(W * 0.4), 280)
      : Math.min(Math.round(W * 0.72), Math.round(H * 0.42 / ratio), 300);
    const G0 = clamp(Math.round(H * 0.02), 6, 16);
    const resume = resumeTarget();
    const apply = (k) => {
      const title = Math.max(24, Math.round(T0 * k)), sub = Math.max(15, Math.round(S0 * Math.max(k, 0.8)));
      const art = coverRow ? Math.max(72, A0) : Math.max(72, Math.round(A0 * k));
      r.setProperty('--ctitle', title + 'px'); r.setProperty('--csub', sub + 'px'); r.setProperty('--cart', art + 'px');
      r.setProperty('--cgap', Math.max(4, Math.round(G0 * k)) + 'px'); r.setProperty('--cbtn', Math.max(17, sub - 1) + 'px'); r.setProperty('--chint', Math.max(15, sub - 3) + 'px');
      return art;
    };
    const fits = (k) => {
      const art = apply(k);
      meas.style.width = W + 'px'; meas.innerHTML = '';
      const wrap = document.createElement('div'); // CSP: sizes go through the CSSOM, never as style attributes
      wrap.style.height = H + 'px'; wrap.style.width = W + 'px'; wrap.innerHTML = coverHTML(false); meas.appendChild(wrap);
      let go = null;
      if (resume) { go = document.createElement('button'); go.className = 'cover-go'; go.style.position = 'static'; go.textContent = resume.label; meas.appendChild(go); }
      const box = $('.pbody.cover', wrap);
      if (go) { const gr = go.getBoundingClientRect(); r.setProperty('--cgo-w', Math.ceil(gr.width) + 'px'); r.setProperty('--cgo-h', Math.max(56, Math.ceil(gr.height)) + 'px'); }
      // top-align while measuring, so all overflow shows up in scrollHeight (centred overflow hides half of it)
      box.style.justifyContent = 'flex-start'; box.style.alignItems = 'flex-start';
      const tall = Math.max(box.scrollHeight, ...$$(':scope > *', box).map((c) => Math.ceil(c.getBoundingClientRect().height)));
      const textW = coverRow ? W - art - 2 * Math.max(4, Math.round(G0 * k)) : W;
      const rng = document.createRange(); // width of the words themselves, without changing the layout
      const linesFit = $$('.cover-title .ln', box).every((el) => { let w; if (el.tagName.toLowerCase() === 'svg') w = el.getBoundingClientRect().width; else { rng.selectNodeContents(el); w = rng.getBoundingClientRect().width; } return w <= textW + 0.5; });
      const goFits = !go || go.getBoundingClientRect().width <= textW + 0.5;
      return tall <= H && linesFit && goFits;
    };
    let best = null;
    for (coverTrim = 0; coverTrim <= 2 && best === null; coverTrim++) {
      if (fits(1)) { best = 1; break; }
      let lo = 0.4, hi = 1;
      if (!fits(lo)) continue;
      for (let i = 0; i < 8; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; }
      best = lo; break;
    }
    if (best === null) { coverTrim = 2; best = 0.4; }
    apply(best);
    meas.innerHTML = '';
  }
  function updateCoverGo() {
    const btn = $('#coverGo');
    const onCover = st.mode === 'page' && !reciting && !busy && pages.length && isCover(pages[cur]) && $('#viewport').hidden === false;
    const t = onCover ? resumeTarget() : null;
    const slot = t ? $('.page[data-slot="cur"] .cover-slot') : null;
    if (!slot) { btn.hidden = true; return; }
    btn.textContent = t.label;
    const vr = $('#viewport').getBoundingClientRect(), sr = slot.getBoundingClientRect();
    btn.style.left = Math.round(sr.left - vr.left) + 'px'; btn.style.top = Math.round(sr.top - vr.top) + 'px';
    btn.style.width = Math.ceil(sr.width) + 'px'; btn.style.height = Math.ceil(sr.height) + 'px';
    btn.hidden = false;
  }

  let layoutSeq = 0;
  async function relayout(anchor) {
    if (!text) return;
    const seq = ++layoutSeq;
    await fontsReady();
    if (seq !== layoutSeq || !text) return;
    if (anchor === undefined) anchor = (st.mode === 'page' && !reciting && pages.length) ? anchorOf(cur) : st.anchor[text.id];
    const g = geometry();
    lastGeom = g;
    setTypeVars(g.colW);
    measure(g);
    fitCover(g);
    if (st.mode === 'page' && !reciting) {
      pages = pack(g.pageH);
      cur = clamp(pageOfAnchor(anchor), 0, Math.max(0, pages.length - 1));
      showPageView();
      renderSlots();
    } else {
      pages = [];
      renderScroller(anchor);
      updateCoverGo();
    }
  }
  let fontOK = false;
  async function fontsReady() {
    if (fontOK || !document.fonts) return;
    const probe = `34px "${FONT_FAMILY}"`;
    try { await Promise.race([document.fonts.load(probe, 'रामरक्षा'), new Promise((r) => setTimeout(r, 3000))]); } catch (e) { /* fall back to system font */ }
    fontOK = document.fonts.check(probe, 'राम');
    if (!fontOK) document.fonts.ready.then(() => { if (!fontOK && document.fonts.check(probe, 'राम')) { fontOK = true; relayout(); } });
  }

  /* ------------------------------------------------------------ page view */
  const track = () => $('#track');
  function renderSlots() {
    const map = { prev: cur - 1, cur, next: cur + 1 };
    for (const [slot, idx] of Object.entries(map)) $(`.page[data-slot="${slot}"]`).innerHTML = (idx >= 0 && idx < pages.length) ? pageHTML(pages[idx]) : '';
    setPlace(pageLabel(pages[cur]));
    // the cover never overwrites the saved place, so "continue" survives a look at the cover
    const a = anchorOf(cur); if (a && a.id !== 'cover') { st.anchor[text.id] = a; save(); }
    if (controlsOn) prepareShare();
    updateCoverGo();
  }
  function showPageView() { $('#viewport').hidden = false; $('#scroller').hidden = true; disconnectIO(); }
  let busy = false;
  function turn(dir, viaDrag) {
    if (busy || !pages.length) return;
    const target = cur + dir;
    if (controlsOn) setControls(false);
    if (target < 0 || target >= pages.length) {
      snapBack();
      return;
    }
    const done = () => {
      cur = target;
      const tr = track(); tr.style.transition = 'none'; tr.style.transform = 'translate3d(0,0,0)';
      busy = false; renderSlots();
    };
    $('#coverGo').hidden = true; // it lives outside the sliding pages
    if (!motionOn()) { done(); return; }
    busy = true;
    const tr = track();
    tr.style.transition = `transform ${viaDrag ? 220 : 300}ms cubic-bezier(.22,.7,.25,1)`;
    tr.style.transform = `translate3d(${-dir * 100}%,0,0)`;
    let fired = false;
    const end = () => { if (fired) return; fired = true; tr.removeEventListener('transitionend', end); done(); };
    tr.addEventListener('transitionend', end);
    setTimeout(end, 420);
  }
  function snapBack() {
    const tr = track();
    if (!motionOn()) { tr.style.transition = 'none'; tr.style.transform = 'translate3d(0,0,0)'; updateCoverGo(); return; }
    tr.style.transition = 'transform 200ms ease-out'; tr.style.transform = 'translate3d(0,0,0)';
    setTimeout(updateCoverGo, 220);
  }
  function go(i) { if (!pages.length) return; cur = clamp(i, 0, pages.length - 1); renderSlots(); }

  let suppressClick = false;
  function bindGestures() {
    const vp = $('#viewport');
    let sx = 0, sy = 0, t0 = 0, down = false, decided = false, horiz = false, pid = null;
    vp.addEventListener('pointerdown', (e) => {
      if (busy || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; t0 = performance.now(); down = true; decided = false; horiz = false;
    });
    vp.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== pid) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!decided) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        decided = true; horiz = Math.abs(dx) > Math.abs(dy) * 1.2;
        if (horiz) { $('#coverGo').hidden = true; try { vp.setPointerCapture(pid); } catch (_) { /* ignore */ } }
      }
      if (!horiz || !motionOn()) return;
      let d = dx;
      if ((cur === 0 && d > 0) || (cur === pages.length - 1 && d < 0)) d *= 0.3;
      const tr = track(); tr.style.transition = 'none'; tr.style.transform = `translate3d(${d}px,0,0)`;
    });
    const finish = (e, cancelled) => {
      if (!down || e.pointerId !== pid) return;
      down = false;
      if (!horiz) return;
      suppressClick = true; setTimeout(() => { suppressClick = false; }, 350);
      if (cancelled) { snapBack(); return; }
      const dx = e.clientX - sx, v = Math.abs(dx) / Math.max(1, performance.now() - t0);
      const passed = Math.abs(dx) > vp.clientWidth * 0.18 || (v > 0.35 && Math.abs(dx) > 30);
      if (passed) turn(dx < 0 ? 1 : -1, true); // turn() itself snaps back at the first/last page
      else snapBack();
    };
    vp.addEventListener('pointerup', (e) => finish(e, false));
    vp.addEventListener('pointercancel', (e) => finish(e, true));
    // A side tap always turns the page, also while the bar is showing. Only the middle shows or hides the bar.
    $('#zPrev').addEventListener('click', () => { if (!suppressClick) turn(-1); });
    $('#zNext').addEventListener('click', () => { if (!suppressClick) turn(1); });
    $('#zMid').addEventListener('click', () => { if (!suppressClick) setControls(!controlsOn); });
    $('#coverGo').addEventListener('click', () => {
      if (suppressClick) return;
      if (controlsOn) setControls(false);
      const t = resumeTarget(); if (t) { $('#coverGo').hidden = true; go(pageOfAnchor(t.anchor)); $('#zMid').focus(); }
    });
  }

  /* -------------------------------------------------- scroll + recitation */
  let io = null, reciting = false, playing = false, rafId = 0, lastT = 0, acc = 0, wakeLock = null, lastGeom = null;
  function disconnectIO() { if (io) { io.disconnect(); io = null; } }
  function renderScroller(anchor) {
    const sc = $('#scroller');
    sc.innerHTML = `<div class="sbody" lang="${esc(text.lang)}">${blocks.map((b, i) => (b.kind === 'cover' ? coverHTML(true) : blockHTML(b, rows[i], 0, rows[i].length))).join('')}</div>`;
    $('#viewport').hidden = true; sc.hidden = false;
    const id = anchor && (anchor.id || anchor);
    const el = id ? sc.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
    sc.scrollTop = el ? Math.max(0, el.offsetTop - (reciting ? sc.clientHeight * 0.3 : 24)) : 0;
    disconnectIO();
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((ents) => {
        for (const e of ents) {
          if (!e.isIntersecting) continue;
          const b = blocks.find((x) => x.id === e.target.dataset.id); if (!b) continue;
          if (b.kind !== 'title' && b.kind !== 'cover') { st.anchor[text.id] = { id: b.id, f: 0 }; save(); }
          setPlace(b.kind === 'cover' ? '' : b.kind === 'verse' && b.n ? `${dn(b.n)} / ${dn(text.verses.length)}` : (b.label || text.short));
        }
      }, { root: sc, rootMargin: '-28% 0px -66% 0px', threshold: 0 });
      $$('.blk, .pbody.cover', sc).forEach((el2) => io.observe(el2));
    }
  }
  function bindScroller() {
    const sc = $('#scroller');
    sc.addEventListener('click', () => { if (reciting) setPlaying(!playing); else setControls(!controlsOn); });
    const userScroll = () => { if (reciting && playing) setPlaying(false); };
    sc.addEventListener('wheel', userScroll, { passive: true });
    sc.addEventListener('touchmove', userScroll, { passive: true });
  }
  async function startRecite() {
    if (!text) return;
    const anchor = (st.mode === 'page' && pages.length) ? anchorOf(cur) : st.anchor[text.id];
    reciting = true;
    setControls(false);
    document.body.classList.add('reciting');
    $('#recitebar').hidden = false;
    $('#speedLbl').textContent = dn(st.speed);
    renderScroller(anchor);
    setPlaying(false);
    await requestWake();
    $('#playBtn').focus();
  }
  function stopRecite() {
    setPlaying(false); reciting = false;
    document.body.classList.remove('reciting');
    $('#recitebar').hidden = true;
    releaseWake();
    relayout(st.anchor[text.id]);
  }
  function setPlaying(on) {
    playing = !!on;
    $('#playBtn').setAttribute('aria-pressed', String(playing));
    $('#playBtn').setAttribute('aria-label', playing ? 'थांबा' : 'सुरू करा');
    cancelAnimationFrame(rafId);
    if (playing) { lastT = 0; acc = 0; rafId = requestAnimationFrame(step); }
  }
  function step(t) {
    if (!playing) return;
    const sc = $('#scroller');
    const dt = lastT ? Math.min(100, t - lastT) : 16; lastT = t;
    acc += (SPEED_LPM[st.speed - 1] * st.size * 1.9 / 60) * dt / 1000; // time-based, independent of 60/120 Hz
    if (acc >= 1) { const d = Math.floor(acc); acc -= d; sc.scrollTop += d; }   // whole pixels: Safari ignores fractional scrollTop
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) { setPlaying(false); toast(kindOf(entry) === 'aarti' ? 'आरती पूर्ण झाली' : 'स्तोत्र पूर्ण झाले'); return; }
    rafId = requestAnimationFrame(step);
  }
  async function requestWake() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        return;
      }
    } catch (e) { /* not allowed or unsupported */ }
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

  /* ------------------------------------------------------------ controls */
  let controlsOn = false;
  function setControls(on) {
    controlsOn = !!on && !reciting && !!text;
    document.body.classList.toggle('controls', controlsOn);
    $('#zMid').setAttribute('aria-expanded', String(controlsOn));
    const rail = $('#rail'); rail.inert = !controlsOn; rail.setAttribute('aria-hidden', String(!controlsOn));
    if (controlsOn) prepareShare();
  }
  /** The place in the text: the folio in the bottom margin, and the second line of the bar's first button.
   *  The folio and the bar share the bottom margin and are never shown together, so neither covers the text. */
  function setPlace(label) {
    $('#pageno').textContent = label || '';
    $('#locPos').textContent = label || '';
    $('#locPos').hidden = !label;
  }
  function setLocName() {
    const name = text ? text.short : '';
    $('#locName').textContent = name; $('#locName').setAttribute('lang', text ? text.lang : 'mr');
    $('#libBackName').textContent = name; $('#libBackName').setAttribute('lang', text ? text.lang : 'mr');
    $('#libBack').hidden = !text; $('#library .view-foot').hidden = !text; // first visit: nothing to go back to yet
  }
  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* -------------------------------------------------------------- counter */
  function updateCount() {
    const c = text ? (st.count[text.id] || 0) : 0, s = `${dn(c)}/${dn(st.target)}`;
    $('#countLbl').textContent = s; $('#countLbl2').textContent = s;
    const al = `जप मोजा: ${dn(st.target)} पैकी ${dn(c)} पूर्ण`;
    $('#countBtn').setAttribute('aria-label', al); $('#countBtn2').setAttribute('aria-label', al);
    $('#targetVal').textContent = dn(st.target);
    $$('[data-target]').forEach((el) => el.setAttribute('aria-pressed', String(+el.dataset.target === st.target)));
    $('#countSec').hidden = !text;
    if (!resetArm) $('#countReset').textContent = resetLabel();
  }
  function bump() {
    if (!text) return;
    const c = (st.count[text.id] || 0) + 1; st.count[text.id] = c; save(true); updateCount();
    try { if (navigator.vibrate) navigator.vibrate(c === st.target ? [60, 50, 60] : 25); } catch (e) { /* ignore */ }
    toast(c === st.target ? `संकल्प पूर्ण — ${dn(c)} वेळा` : `जप: ${dn(c)} / ${dn(st.target)}`, c === st.target ? 4000 : 1500);
  }

  /* ----------------------------------------------------------------- share */
  let shareCache = null;
  function shareBlock() {
    if (!text) return null;
    const textual = (b) => b && b.kind !== 'title' && b.kind !== 'cover';
    if (st.mode === 'page' && !reciting && pages[cur]) {
      const p = pages[cur].find((x) => blocks[x.i].kind === 'verse' && blocks[x.i].n) || pages[cur].find((x) => textual(blocks[x.i]));
      return p ? blocks[p.i] : null;
    }
    const a = st.anchor[text.id]; const b = blocks.find((x) => x.id === (a && a.id));
    return textual(b) ? b : null;
  }
  function prepareShare() {
    const b = shareBlock(); $('#shareBtn').disabled = !b; if (!b) return;
    const key = text.id + ':' + b.id;
    if (shareCache && shareCache.key === key) return;
    const entry = { key, file: null }; shareCache = entry;
    makeShareFile(b).then((f) => { entry.file = f; }).catch(() => { /* will build on tap */ });
  }
  function download(file) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  async function onShare() {
    const b = shareBlock();
    if (!b) return;
    const key = text.id + ':' + b.id;
    const ready = shareCache && shareCache.key === key ? shareCache.file : null;
    const canShare = (f) => { try { return !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } };
    if (ready && canShare(ready)) { // no await before share(): keeps the tap's user activation on iOS
      navigator.share({ files: [ready], title: text.title }).catch((e) => { if (!e || e.name !== 'AbortError') { download(ready); toast('चित्र साठवले'); } });
      return;
    }
    const f = ready || await makeShareFile(b);
    if (canShare(f)) { try { await navigator.share({ files: [f], title: text.title }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    download(f); toast('चित्र साठवले');
  }
  function shareLayout(x, b, maxW, maxH) {
    const plain = b.lines.map((l) => l.replace(/\s+/g, ' ').trim());
    let F = 64, lines = [];
    const fits = (ls) => ls.every((l) => x.measureText(l).width <= maxW) && ls.length * F * 1.7 <= maxH;
    for (; F >= 28; F -= 2) {
      x.font = `${F}px "${FONT_FAMILY}", serif`;
      if (fits(plain)) { lines = plain; break; }
      const split = b.kind === 'verse' ? [].concat(...plain.map((l) => splitLine(l) || [l])) : plain;
      if (fits(split)) { lines = split; break; }
      lines = split;
    }
    return { F, lines, widest: Math.max(...lines.map((l) => x.measureText(l).width)) };
  }
  async function makeShareFile(b) {
    try { await document.fonts.load(`60px "${FONT_FAMILY}"`, 'श्री'); } catch (e) { /* fallback font */ }
    const W = 1080, H = 1350, M = 96;
    const c = document.createElement('canvas'); c.width = W; c.height = H; c.setAttribute('lang', text.lang);
    const x = c.getContext('2d'); try { x.lang = text.lang; } catch (e) { /* older engines */ }
    x.fillStyle = '#FBF7EF'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#E3D7C3'; x.lineWidth = 3; x.strokeRect(44, 44, W - 88, H - 88);
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = '#9A3A10'; x.font = `40px "${FONT_FAMILY}", serif`; x.fillText(text.title, W / 2, 160);
    const L = shareLayout(x, b, W - 2 * M, 800);
    const lh = L.F * 1.7; let y = 690 - (L.lines.length * lh) / 2 + L.F * 1.05;
    x.fillStyle = '#2A1E14'; x.font = `${L.F}px "${FONT_FAMILY}", serif`;
    for (const l of L.lines) { x.fillText(l, W / 2, y); y += lh; }
    x.fillStyle = '#9A3A10'; x.font = `34px "${FONT_FAMILY}", serif`;
    x.fillText(b.kind === 'verse' && b.n ? `${unit(entry)} ${dn(b.n)}` : (b.label || ''), W / 2, H - 196);
    x.fillStyle = '#5B4936'; x.font = `26px "${FONT_FAMILY}", serif`;
    // exact attribution for the base text: which wiki, the licence, and whether this text was corrected here
    const site = /wikibooks/.test(text.source.site) ? 'विकिबुक्स' : 'विकिस्रोत';
    x.fillText(`मूळ पाठ: ${site} · CC BY-SA 4.0${text.corrections.length ? ' · सुधारित' : ''}`, W / 2, H - 136);
    x.fillText('माझी स्तोत्रे', W / 2, H - 92);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return new File([blob], `${text.id}-${b.n || b.id}.png`, { type: 'image/png' });
  }

  /* ------------------------------------------- contents page, its pages, the sheet */
  // The contents page (#library) and its three pages (#japa, #remind, #about) fill the screen; a page
  // covers the contents page completely, so nothing is ever stacked half-visibly. The one sheet (#look,
  // letters and colour) is opened only from the reading bar and never opens anything else.
  const VIEWS = ['library', 'japa', 'remind', 'about'];
  const OVERLAYS = VIEWS.concat('look');
  const isOpen = (id) => { const el = $('#' + id); return !!el && !el.hidden; };
  const overlayOpen = () => OVERLAYS.some(isOpen);
  const topOverlay = () => ['look', 'about', 'remind', 'japa', 'library'].find(isOpen) || null;
  const opener = {};
  /* Android Back closes the open page or sheet instead of leaving the app. */
  const ovStack = []; let ignorePop = 0;
  function pushOverlay(id) { try { history.pushState({ ov: id }, ''); ovStack.push(id); } catch (e) { /* history unavailable */ } }
  function dropOverlay(id) { // closed by a button, the backdrop or Escape: remove its history entry
    const i = ovStack.lastIndexOf(id); if (i < 0) return;
    ovStack.splice(i, 1); ignorePop++;
    try { history.back(); } catch (e) { ignorePop--; }
  }
  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop--; return; }
    const id = ovStack.pop(); if (!id) return;
    closeOverlay(id, true);
  });
  /** Only the top overlay can be reached; the reader and the bar wait underneath. */
  function syncInert() {
    const top = topOverlay();
    $('#app').inert = !!top;
    for (const id of OVERLAYS) $('#' + id).inert = isOpen(id) && id !== top;
  }
  function openOverlay(id) {
    if (isOpen(id) || !catalog) return;
    opener[id] = document.activeElement;
    if (id === 'library') { setControls(false); renderLibrary(); }
    if (id === 'look') syncLook();
    if (id === 'japa') { resetArm = false; updateCount(); }
    if (id === 'remind') { $('#gcalRR').href = gcalUrl('rr'); $('#gcalBH').href = gcalUrl('bh'); }
    if (id === 'about') renderCredits();
    const el = $('#' + id);
    el.hidden = false;
    const body = $('.view-body', el); if (body) body.scrollTop = 0;
    el.classList.remove('open'); void el.offsetWidth; el.classList.add('open'); // a short rise; none with reduced motion
    pushOverlay(id);
    syncInert();
    const h = $('h1, h2', el); if (h) h.focus();
  }
  function closeOverlay(id, viaBack) {
    const el = $('#' + id); if (!el || el.hidden) return;
    if (!viaBack) dropOverlay(id);
    el.hidden = true; el.classList.remove('open');
    syncInert();
    const f = opener[id]; opener[id] = null;
    if (f && document.contains(f) && !f.closest('[inert], [hidden]') && f.offsetParent !== null) f.focus();
    else if (!overlayOpen()) $('#zMid').focus();
    if (id === 'library' && !text && catalog && catalog.texts.length) openText(catalog.texts[0].id, { cover: true });
  }
  const closeTopOverlay = () => { const t = topOverlay(); if (t) closeOverlay(t); };
  function trapFocus(e) {
    const top = topOverlay(); if (!top) return;
    const box = $('#' + top);
    const f = $$('button, a[href], input, summary, [tabindex]:not([tabindex="-1"])', box).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  /* contents page: one list per kind (स्तोत्रे, then आरत्या once one is live). Each row: the cover
     painting, the title and a progress ring. */
  const KIND_HEAD = { stotra: 'स्तोत्रे', aarti: 'आरत्या' };
  const GROUP_AT = 8; // from this many texts in one list, deity headings appear between them
  function ringSVG(p) {
    if (!p) return '';
    const R = 15, C = 2 * Math.PI * R, frac = p.done ? 1 : Math.max(0.05, p.n / Math.max(1, p.total));
    const mark = p.done ? '<path class="ring-tick" d="M13.5 20.5 18 25l8.5-9"/>' : (p.n ? `<text class="ring-n" x="20" y="20">${dn(p.n)}</text>` : '');
    return `<svg class="ring" viewBox="0 0 40 40" aria-hidden="true" focusable="false"><circle class="ring-track" cx="20" cy="20" r="${R}"/>`
      + `<circle class="ring-arc" cx="20" cy="20" r="${R}" stroke-dasharray="${(frac * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 20 20)"/>${mark}</svg>`;
  }
  function progressWords(t, p) {
    if (!p) return '';
    if (p.done) return 'पूर्ण वाचले';
    return p.n ? `${unit(t)} ${dn(p.n)} पर्यंत वाचले` : 'सुरुवात केली';
  }
  function rowHTML(t) {
    const now = text && t.id === text.id;
    const p = progressOf(t.id, t.verses);
    const g = groupOf(t.deity) || {};
    const sr = [now ? 'आता उघडे' : '', progressWords(t, p)].filter(Boolean).join(' · ');
    return `<li><button type="button" class="trow" data-id="${esc(t.id)}"${now ? ' aria-current="true"' : ''}>`
      + `<span class="mark" aria-hidden="true">${markHTML(g)}</span>`
      + `<span class="trow-text"><span class="trow-title" lang="${esc(t.lang)}">${esc(t.title)}</span></span>`
      + ringSVG(p) + (sr ? `<span class="sr"> · ${esc(sr)}</span>` : '') + '</button></li>';
  }
  function renderLibrary() {
    const deities = catalog.groups.filter((g) => g.kind === 'deity');
    const rank = (t) => { const i = deities.findIndex((g) => g.id === t.deity); return i < 0 ? deities.length : i; };
    let html = '';
    const kinds = Object.keys(KIND_HEAD).filter((k) => catalog.texts.some((t) => kindOf(t) === k));
    for (const kind of kinds) {
      const items = catalog.texts.map((t, i) => ({ t, i })).filter((x) => kindOf(x.t) === kind)
        .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
      if (!items.length) continue;
      const split = items.length >= GROUP_AT && new Set(items.map((t) => t.deity)).size > 1;
      let lists = '';
      if (split) {
        for (const g of deities) { const sub = items.filter((t) => t.deity === g.id); if (sub.length) lists += `<h3 class="shelf-sub">${esc(g.name)}</h3><ul class="rows">${sub.map(rowHTML).join('')}</ul>`; }
      } else lists = `<ul class="rows">${items.map(rowHTML).join('')}</ul>`;
      // a heading only when there is more than one kind (स्तोत्रे and आरत्या): a single list needs none
      html += kinds.length > 1 ? `<section class="shelf" aria-labelledby="shelf-${kind}"><h2 class="shelf-head" id="shelf-${kind}">${KIND_HEAD[kind]}</h2>${lists}</section>` : `<section class="shelf">${lists}</section>`;
    }
    $('#shelf').innerHTML = html;
  }

  /* -------------------------------------------------- letters and colour (sheet) */
  function setRange(v) { $('#sizeRange').value = String(v); $('#sizeRange').setAttribute('aria-valuetext', dn(v)); }
  function syncLook() {
    setRange(st.size);
    $$('[data-theme-choice]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.themeChoice === themeNow())));
    $$('[data-mode-choice]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.modeChoice === st.mode)));
    $('#meaningToggle').checked = st.meaning;
    $('#meaningSec').hidden = !(text && text.verses.some((v) => v.meaning_mr)); // aartis have no meanings
    $('#motionToggle').checked = motionOn();
  }
  let sizeTimer = 0;
  function setSize(v, soon) {
    v = clamp(Math.round(v), SIZE_MIN, SIZE_MAX);
    setRange(v);
    clearTimeout(sizeTimer);
    if (v === st.size) return;
    const apply = () => { st.size = v; save(); relayout(); };
    if (soon) sizeTimer = setTimeout(apply, 140); else apply(); // while dragging: the page follows shortly after
  }
  function bindLook() {
    const range = $('#sizeRange');
    range.addEventListener('input', () => setSize(+range.value, true));
    range.addEventListener('change', () => setSize(+range.value));
    $('#sizeDown').addEventListener('click', () => setSize(st.size - 2));
    $('#sizeUp').addEventListener('click', () => setSize(st.size + 2));
    $$('[data-theme-choice]').forEach((el) => el.addEventListener('click', () => { st.theme = el.dataset.themeChoice; save(); applyTheme(); syncLook(); }));
    $$('[data-mode-choice]').forEach((el) => el.addEventListener('click', () => {
      const m = el.dataset.modeChoice; if (m === st.mode) return;
      const a = st.mode === 'page' && pages.length ? anchorOf(cur) : st.anchor[text && text.id];
      st.mode = m; save(); syncLook(); relayout(a || null);
    }));
    $('#meaningToggle').addEventListener('change', (e) => { st.meaning = e.target.checked; save(); relayout(); });
    $('#motionToggle').addEventListener('change', (e) => { st.motion = e.target.checked; save(); applyTheme(); });
    $('#lookClose').addEventListener('click', () => closeOverlay('look'));
    $('#look').addEventListener('click', (e) => { if (e.target.id === 'look') closeOverlay('look'); }); // the dimmed page above the sheet
  }

  /* ------------------------------------------------------------- japa, reminders */
  let resetArm = false, resetTimer = 0;
  const resetLabel = () => 'शून्य करा';
  function gcalUrl(kind) {
    const now = new Date(), d = new Date(now), pad = (n) => String(n).padStart(2, '0');
    if (kind === 'bh') { d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7)); d.setHours(7, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 7); }
    else { d.setHours(19, 0, 0, 0); if (d <= now) d.setDate(d.getDate() + 1); }
    const e = new Date(d.getTime() + 15 * 60000);
    const f = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
    const p = new URLSearchParams({
      action: 'TEMPLATE',
      text: kind === 'bh' ? 'भीमरूपी स्तोत्र' : 'रामरक्षा स्तोत्र',
      details: '‘माझी स्तोत्रे’ उघडून पठण करा.',
      dates: `${f(d)}/${f(e)}`,
      recur: kind === 'bh' ? 'RRULE:FREQ=WEEKLY;BYDAY=SA' : 'RRULE:FREQ=DAILY',
    });
    return 'https://calendar.google.com/calendar/render?' + p.toString();
  }
  function bindJapa() {
    const setTarget = (v) => { st.target = clamp(Math.round(v), 1, 100000); save(); updateCount(); };
    $('#targetDown').addEventListener('click', () => setTarget(st.target - 1));
    $('#targetUp').addEventListener('click', () => setTarget(st.target + 1));
    $$('[data-target]').forEach((el) => el.addEventListener('click', () => setTarget(+el.dataset.target)));
    $('#countReset').addEventListener('click', (e) => {
      if (!text) return;
      if (!resetArm) { resetArm = true; e.currentTarget.textContent = 'खरंच शून्य करायची? पुन्हा दाबा'; clearTimeout(resetTimer); resetTimer = setTimeout(() => { resetArm = false; $('#countReset').textContent = resetLabel(); }, 5000); return; }
      resetArm = false; st.count[text.id] = 0; save(true); updateCount(); toast('मोजणी शून्य केली');
    });
  }

  /* --------------------------------------------------------------- credits */
  async function renderCredits() {
    const list = [];
    for (const e of catalog.texts) { try { list.push(textCache[e.id] || (textCache[e.id] = await loadJSON(e.file))); } catch (err) { /* offline and not cached */ } }
    const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    $('#credits').innerHTML = list.map((t) => {
      const added = t.corrections.filter((c) => c.kind === 'added');
      const second = t.second_source;
      return `<h3 class="dev" lang="${esc(t.lang)}">${esc(t.title)}</h3>`
        + `<p>मूळ पाठ: ${link(t.source.url, esc(t.source.site + ' — ' + t.source.page))} (आवृत्ती ${esc(String(t.source.rev_id))}), ${esc(t.source.credit)}. परवाना: ${link(t.source.license_url, 'CC BY-SA 4.0')}.</p>`
        + (second ? `<p>तुलनेसाठी दुसरा स्रोत: ${link(second.url, esc(second.name))}. ${esc(second.status)}.</p>` : '')
        + (t.corrections.length ? `<p>येथील पाठ सुधारित आहे: ${dn(t.corrections.length)} बदल. सुधारित पाठही CC BY-SA 4.0 अंतर्गत आहे.` : '<p>पाठात शब्दांचा बदल केलेला नाही; फक्त विरामचिन्हे एकसारखी केली आहेत. पाठ CC BY-SA 4.0 अंतर्गत आहे.')
        + (added.length ? ` मूळ आवृत्तीत नसलेला मजकूर इतर प्रकाशित पाठांवरून जोडला आहे (यादीत “जोडले”).` : '') + `</p>`
        + `<p>मराठी जाणकाराकडून पाठाची तपासणी: ${t.review && t.review.native_marathi ? esc(t.review.native_marathi) : 'अजून झालेली नाही'}.</p>`
        + (t.corrections.length ? `<details><summary>बदलांची यादी</summary><ol>${t.corrections.map((c) => `<li><span class="dev">${esc(c.where)}</span> ${c.kind === 'added' ? '(जोडले)' : ''}: <span class="dev">${esc(c.from)}</span> → <span class="dev">${esc(c.to)}</span></li>`).join('')}</ol></details>` : '');
    }).join('')
      + '<h3>चित्रे</h3><p>यादीत, मुखपृष्ठावर व माहिती पृष्ठावर दिसणारी चित्रे या ॲपसाठी तयार केलेली मूळ चित्रकृती आहेत. ती कृत्रिम बुद्धिमत्तेने (AI) काढली आहेत. देवतांची जवळची चित्रे मुद्दाम काढलेली नाहीत.</p>'
      + '<h3>बटणांवरील चिन्हे</h3><p>यादी, माळ, घंटा इत्यादी छोटी चिन्हे याच ॲपसाठी साध्या रेषांतून काढलेली मूळ चित्रे आहेत; कोणताही कॉपीराइट दावा नाही (CC0 1.0).</p>'
      + `<h3>मुखपृष्ठावरील नावाची अक्षरे</h3><p>“Gotu” अक्षरशैलीवरून तयार केलेली अक्षरांची रेखाचित्रे — Gotu © 2016 Ek Type, परवाना: ${link('fonts/OFL-Gotu.txt', 'SIL Open Font License 1.1')}. फॉन्टची फाईल ॲपमध्ये नाही; फक्त या नावांची अक्षरे आहेत.</p>`
      + '<h3>मराठी अर्थ</h3><p>अर्थ संगणकाने (AI) लिहिलेला कच्चा <strong>मसुदा</strong> आहे; जाणकारांनी तो अजून तपासलेला नाही, म्हणून तो आपोआप दिसत नाही. यावर कोणताही कॉपीराइट दावा नाही (CC0 1.0).</p>'
      + `<h3>अक्षरशैली (फॉन्ट)</h3><p>Noto Serif Devanagari — © 2022 The Noto Project Authors. परवाना: ${link('fonts/OFL.txt', 'SIL Open Font License 1.1')}. येथे नियमित (Regular) वजनाचा, देवनागरीपुरता लहान केलेला संच (WOFF2).</p>`
      + '<h3>गोपनीयता</h3><p>खाते नाही, जाहिराती नाहीत, वापराचे मोजमाप (analytics) नाही, ध्वनी नाही. तुमच्या निवडी, शेवटचे पान व जप-संख्या फक्त या फोनवर साठवल्या जातात. “Google Calendar” बटण दाबले तरच Google चे पान उघडते.</p>'
      + `<h3>इंटरनेटशिवाय वापर</h3><p id="offlineState">${offlineText()}</p>`
      + `<p class="note">आवृत्ती ${esc(APP_VERSION)}</p>`;
  }

  /* ------------------------------------------------- service worker/update */
  let swReg = null, updateWaiting = false, offlineReady = false;
  const hadController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
  const offlineText = () => (offlineReady ? 'इंटरनेटशिवाय वापरण्यासाठी तयार.' : 'पहिल्यांदा उघडल्यावर काही सेकंदांत इंटरनेटशिवाय वापरण्यासाठी तयार होते.');
  function registerSW() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      swReg = reg;
      if (reg.active) offlineReady = true;
      if (reg.waiting && navigator.serviceWorker.controller) updateWaiting = true;
      const watch = (w) => w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) updateWaiting = true;
        if (w.state === 'activated') { offlineReady = true; const el = $('#offlineState'); if (el) el.textContent = offlineText(); }
      });
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    }).catch(() => { /* offline support unavailable; the app still works online */ });
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return; // first install: nothing to reload
      reloading = true; save(true); location.reload();
    });
  }
  let lastUpdateCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      save(true);
      // apply a downloaded update while the app is in the background; the reload restores the same page
      if (updateWaiting && swReg && swReg.waiting && !reciting) swReg.waiting.postMessage('SKIP_WAITING');
    } else {
      if (reciting && !wakeLock) requestWake();
      if (swReg && navigator.onLine && Date.now() - lastUpdateCheck > 3600e3) { lastUpdateCheck = Date.now(); swReg.update().catch(() => {}); }
    }
  });

  /* ---------------------------------------------------------------- boot */
  async function openText(id, opts) {
    const e = catalog.texts.find((t) => t.id === id);
    if (!e) return;
    let t;
    try { t = textCache[id] || (textCache[id] = await loadJSON(e.file)); }
    catch (err) { toast('हे उघडता आले नाही. एकदा इंटरनेट सुरू करून पुन्हा उघडा.', 4000); return; }
    if (reciting) { setPlaying(false); reciting = false; document.body.classList.remove('reciting'); $('#recitebar').hidden = true; releaseWake(); }
    await loadCoverArt(e);
    text = t; entry = e; st.text = id; save();
    blocks = buildBlocks(t); pages = []; shareCache = null;
    $('#welcome').hidden = true;
    document.title = `${t.short} · माझी स्तोत्रे`;
    setLocName();
    updateCount();
    // from the list: start at the cover (it offers "continue"); on app start: back to the saved place
    await relayout(opts && opts.cover ? { id: 'cover', f: 0 } : (st.anchor[id] || null));
  }
  /** A row in the contents page: the text you are reading takes you back to your page; another text opens at its cover. */
  function pick(id) {
    const same = text && id === text.id;
    closeOverlay('library');
    if (!same) openText(id, { cover: true });
    $('#zMid').focus();
  }
  function bindUI() {
    bindGestures(); bindScroller(); bindLook(); bindJapa();
    $('#libBtn').addEventListener('click', () => openOverlay('library'));
    $('#lookBtn').addEventListener('click', () => openOverlay('look'));
    $('#libBack').addEventListener('click', () => closeOverlay('library'));
    $('#shelf').addEventListener('click', (e) => { const b = e.target.closest('.trow'); if (b) pick(b.dataset.id); });
    $$('[data-open]').forEach((b) => b.addEventListener('click', () => openOverlay(b.dataset.open)));
    $$('[data-back]').forEach((b) => b.addEventListener('click', () => closeOverlay(b.closest('.view').id)));
    $('#reciteBtn').addEventListener('click', startRecite);
    $('#reciteClose').addEventListener('click', stopRecite);
    $('#playBtn').addEventListener('click', () => setPlaying(!playing));
    $('#slowBtn').addEventListener('click', () => { st.speed = clamp(st.speed - 1, 1, 10); $('#speedLbl').textContent = dn(st.speed); save(); });
    $('#fastBtn').addEventListener('click', () => { st.speed = clamp(st.speed + 1, 1, 10); $('#speedLbl').textContent = dn(st.speed); save(); });
    $('#countBtn').addEventListener('click', bump);
    $('#countBtn2').addEventListener('click', bump);
    $('#shareBtn').addEventListener('click', onShare);
    document.addEventListener('keydown', (e) => {
      if (overlayOpen()) { if (e.key === 'Escape') { e.preventDefault(); closeTopOverlay(); } else if (e.key === 'Tab') trapFocus(e); return; }
      if (reciting) { if (e.key === 'Escape') stopRecite(); return; }
      const onControl = e.target && e.target.closest && e.target.closest('button, input, a, summary');
      if (st.mode !== 'page') { if (e.key === 'Escape' && controlsOn) setControls(false); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !e.shiftKey && !onControl)) { e.preventDefault(); turn(1); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === ' ' && e.shiftKey && !onControl)) { e.preventDefault(); turn(-1); }
      else if (e.key === 'Home' && !onControl) { e.preventDefault(); go(0); }
      else if (e.key === 'End' && !onControl) { e.preventDefault(); go(pages.length - 1); }
      else if (e.key === 'Escape') setControls(false);
    });
    const onSystemChange = () => { applyTheme(); };
    if (darkMQ.addEventListener) { darkMQ.addEventListener('change', onSystemChange); reduceMQ.addEventListener('change', onSystemChange); }
    let rt = 0;
    const onResize = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (!text) return;
        const g = geometry();
        if (lastGeom && Math.abs(g.colW - lastGeom.colW) < 2 && Math.abs(g.pageH - lastGeom.pageH) < 24) return;
        relayout();
      }, 200);
    };
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe($('#reader')); else window.addEventListener('resize', onResize);
  }
  async function boot() {
    applyTheme();
    setTypeVars();
    setControls(false);
    registerSW();
    try {
      const standalone = media('(display-mode: standalone)').matches || navigator.standalone === true;
      if (standalone && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) { /* ignore */ }
    try {
      catalog = await loadJSON('data/catalog.json');
      catalog.texts = catalog.texts.filter((t) => t.live !== false); // staged for a later release: not shown
    }
    catch (e) {
      $('#welcome').hidden = false;
      return;
    }
    bindUI();
    setLocName();
    // cover titles, and any SVG emblem: paintings are <img> elements and load on their own (they are precached)
    Promise.all(catalog.texts.map(loadCoverArt)).then(() => { if (isOpen('library')) renderLibrary(); });
    if (!st.text || !catalog.texts.some((t) => t.id === st.text)) openOverlay('library'); // first visit: the contents page is the start
    else await openText(st.text);
  }

  // Small read-only hook for the automated tests (no network, no side effects).
  window.__stotre = {
    version: APP_VERSION, state: () => JSON.parse(JSON.stringify(st)), pages: () => pages.length, cur: () => cur,
    label: () => pageLabel(pages[cur]), go, turn, relayout, setSize, openText, aksharas, splitLine,
    controls: () => controlsOn, top: () => topOverlay(),
    blockIds: () => blocks.map((b) => b.id),
    pageParts: () => pages.map((p) => p.map((x) => ({ id: blocks[x.i].id, from: x.from, to: x.to, n: rows[x.i].length }))),
    shareCheck: () => {
      const c = document.createElement('canvas').getContext('2d');
      return blocks.filter((b) => b.kind !== 'title').map((b) => { const L = shareLayout(c, b, 1080 - 192, 800); return { id: b.id, F: L.F, widest: Math.round(L.widest), lines: L.lines.length }; });
    },
    makeShareFile: (id) => makeShareFile(blocks.find((b) => b.id === id)),
  };
  boot();
})();
