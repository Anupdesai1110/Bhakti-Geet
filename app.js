/* माझी स्तोत्रे — app.js
 * Vanilla JS. Offline-first. No framework, no accounts, no analytics, no audio.
 * Reading model: text → blocks (title, front matter, verses, colophon) → rows (lines or padas,
 * meaning lines) → measured in an off-screen box → packed into pages that never clip.
 */
'use strict';
(() => {
  const APP_VERSION = '2.0.0';
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
    browse: 'group', target: 11, count: {}, anchor: {}, speed: 4, hintSeen: false,
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
    if (!['group', 'lang'].includes(o.browse)) o.browse = 'group';
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
  let catalog = null, text = null, blocks = [], rows = [], rowH = [], pages = [], cur = 0;
  let px = { fs: 34, mfs: 20, rgap: 10, mgap: 16, bgap: 29 };
  const textCache = {};
  async function loadJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }
  function buildBlocks(t) {
    const B = [{ id: 'title', kind: 'title', title: t.title + (t.subtitle ? ` (${t.subtitle})` : ''), sub: t.author || '' }];
    for (const f of t.front || []) B.push({ id: f.id, kind: f.kind === 'verse' ? 'verse' : 'prose', label: f.label, lines: f.devanagari.split('\n') });
    for (const v of t.verses) B.push({ id: 'v' + v.n, kind: 'verse', n: v.n, lines: v.devanagari.split('\n'), meaning: v.meaning_mr });
    for (const b of t.back || []) B.push({ id: b.id, kind: 'prose', label: b.label, lines: b.devanagari.split('\n') });
    return B;
  }
  function rowsFor(b, split) {
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
    if (b.kind === 'title') return `<header class="blk title" data-id="title">${rs.map((r) => `<span class="row ${r.t}">${esc(r.text)}</span>`).join('')}</header>`;
    const vr = rs.filter((r) => r.t === 'v'), mr = rs.filter((r) => r.t === 'm');
    let h = `<article class="blk ${b.kind}" data-id="${esc(b.id)}">`;
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
  const pageHTML = (p) => `<div class="pbody" lang="${esc(text.lang)}">${p.map((part) => blockHTML(blocks[part.i], rows[part.i], part.from, part.to)).join('')}</div>`;
  function pageLabel(p) {
    if (!p) return '';
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
    if (st.mode === 'page' && !reciting) {
      pages = pack(g.pageH);
      cur = clamp(pageOfAnchor(anchor), 0, Math.max(0, pages.length - 1));
      showPageView();
      renderSlots();
    } else {
      pages = [];
      renderScroller(anchor);
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
    $('#pageno').textContent = pageLabel(pages[cur]);
    const a = anchorOf(cur); if (a) { st.anchor[text.id] = a; save(); }
    if (controlsOn) prepareShare();
  }
  function showPageView() { $('#viewport').hidden = false; $('#scroller').hidden = true; disconnectIO(); }
  let busy = false, edgeToastShown = false;
  function turn(dir, viaDrag) {
    if (busy || !pages.length) return;
    const target = cur + dir;
    hideHint();
    if (target < 0 || target >= pages.length) {
      snapBack();
      if (!edgeToastShown) { toast(dir > 0 ? 'हे शेवटचे पान आहे' : 'हे पहिले पान आहे'); edgeToastShown = true; }
      return;
    }
    const done = () => {
      cur = target;
      const tr = track(); tr.style.transition = 'none'; tr.style.transform = 'translate3d(0,0,0)';
      renderSlots(); busy = false;
    };
    if (controlsOn) setControls(false);
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
    if (!motionOn()) { tr.style.transition = 'none'; tr.style.transform = 'translate3d(0,0,0)'; return; }
    tr.style.transition = 'transform 200ms ease-out'; tr.style.transform = 'translate3d(0,0,0)';
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
        if (horiz) { try { vp.setPointerCapture(pid); } catch (_) { /* ignore */ } }
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
    $('#zPrev').addEventListener('click', () => { if (suppressClick) return; if (controlsOn) { setControls(false); return; } turn(-1); });
    $('#zNext').addEventListener('click', () => { if (suppressClick) return; if (controlsOn) { setControls(false); return; } turn(1); });
    $('#zMid').addEventListener('click', () => { if (suppressClick) return; hideHint(); setControls(!controlsOn); });
  }

  /* -------------------------------------------------- scroll + recitation */
  let io = null, reciting = false, playing = false, rafId = 0, lastT = 0, acc = 0, wakeLock = null, lastGeom = null;
  function disconnectIO() { if (io) { io.disconnect(); io = null; } }
  function renderScroller(anchor) {
    const sc = $('#scroller');
    sc.innerHTML = `<div class="sbody" lang="${esc(text.lang)}">${blocks.map((b, i) => blockHTML(b, rows[i], 0, rows[i].length)).join('')}</div>`;
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
          if (b.kind !== 'title') { st.anchor[text.id] = { id: b.id, f: 0 }; save(); }
          $('#pageno').textContent = b.kind === 'verse' ? `${dn(b.n)} / ${dn(text.verses.length)}` : (b.label || text.short);
        }
      }, { root: sc, rootMargin: '-28% 0px -66% 0px', threshold: 0 });
      $$('.blk', sc).forEach((el2) => io.observe(el2));
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
    $('#recitebar').hidden = true; $('#reciteNote').hidden = true;
    releaseWake();
    relayout(st.anchor[text.id]);
  }
  function setPlaying(on) {
    playing = !!on;
    $('#playBtn').setAttribute('aria-pressed', String(playing));
    $('#playLbl').textContent = playing ? 'थांबा' : 'सुरू करा';
    cancelAnimationFrame(rafId);
    if (playing) { lastT = 0; acc = 0; rafId = requestAnimationFrame(step); }
  }
  function step(t) {
    if (!playing) return;
    const sc = $('#scroller');
    const dt = lastT ? Math.min(100, t - lastT) : 16; lastT = t;
    acc += (SPEED_LPM[st.speed - 1] * st.size * 1.9 / 60) * dt / 1000; // time-based, independent of 60/120 Hz
    if (acc >= 1) { const d = Math.floor(acc); acc -= d; sc.scrollTop += d; }   // whole pixels: Safari ignores fractional scrollTop
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) { setPlaying(false); toast('स्तोत्र पूर्ण झाले'); return; }
    rafId = requestAnimationFrame(step);
  }
  async function requestWake() {
    const note = $('#reciteNote');
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        note.hidden = true; return;
      }
    } catch (e) { /* not allowed or unsupported */ }
    note.textContent = 'या फोनवर पारायणात स्क्रीन आपोआप बंद होऊ शकते.'; note.hidden = false;
    setTimeout(() => { note.hidden = true; }, 6000);
  }
  function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ } wakeLock = null; }

  /* ------------------------------------------------------------ controls */
  let controlsOn = false;
  function setControls(on) {
    controlsOn = !!on && !reciting;
    document.body.classList.toggle('controls', controlsOn);
    $('#zMid').setAttribute('aria-expanded', String(controlsOn));
    for (const id of ['topbar', 'bottombar']) { const el = $('#' + id); el.inert = !controlsOn; el.setAttribute('aria-hidden', String(!controlsOn)); }
    if (controlsOn) prepareShare();
  }
  function showHint() { if (st.mode === 'page') { $('#hint').hidden = false; setControls(true); } }
  function hideHint() { if (!$('#hint').hidden) { $('#hint').hidden = true; st.hintSeen = true; save(); } }
  let toastTimer = 0;
  function toast(msg, ms = 2600) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* -------------------------------------------------------------- counter */
  function updateCount() {
    const c = text ? (st.count[text.id] || 0) : 0, s = `${dn(c)}/${dn(st.target)}`;
    $('#countLbl').textContent = s; $('#countLbl2').textContent = s;
    const al = `जप मोजा: ${dn(c)} पैकी ${dn(st.target)} पूर्ण`;
    $('#countBtn').setAttribute('aria-label', al); $('#countBtn2').setAttribute('aria-label', al);
    $('#targetVal').textContent = dn(st.target);
    $('#countNow').textContent = text ? `${text.short}: आतापर्यंत ${dn(c)} आवर्तने` : '';
  }
  function bump() {
    if (!text) return;
    const c = (st.count[text.id] || 0) + 1; st.count[text.id] = c; save(true); updateCount();
    try { if (navigator.vibrate) navigator.vibrate(c === st.target ? [60, 50, 60] : 25); } catch (e) { /* ignore */ }
    toast(c === st.target ? `संकल्प पूर्ण — ${dn(c)} आवर्तने` : `जप: ${dn(c)} / ${dn(st.target)}`, c === st.target ? 4000 : 1500);
  }

  /* ----------------------------------------------------------------- share */
  let shareCache = null;
  function shareBlock() {
    if (!text) return null;
    if (st.mode === 'page' && !reciting && pages[cur]) {
      const p = pages[cur].find((x) => blocks[x.i].kind === 'verse' && blocks[x.i].n) || pages[cur].find((x) => blocks[x.i].kind !== 'title');
      return p ? blocks[p.i] : null;
    }
    const a = st.anchor[text.id]; const b = blocks.find((x) => x.id === (a && a.id));
    return b && b.kind !== 'title' ? b : null;
  }
  function prepareShare() {
    const b = shareBlock(); if (!b) return;
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
    const b = shareBlock(); if (!b) return;
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
    x.fillText(b.kind === 'verse' && b.n ? `श्लोक ${dn(b.n)}` : (b.label || ''), W / 2, H - 196);
    x.fillStyle = '#5B4936'; x.font = `26px "${FONT_FAMILY}", serif`;
    x.fillText('मूळ पाठ: विकिस्रोत · CC BY-SA 4.0 · सुधारित', W / 2, H - 136);
    x.fillText('माझी स्तोत्रे', W / 2, H - 92);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return new File([blob], `${text.id}-${b.n || b.id}.png`, { type: 'image/png' });
  }

  /* --------------------------------------------------------- drawer/sheets */
  let lastFocus = null;
  const overlayOpen = () => !$('#drawer').hidden || !$('#settings').hidden || !$('#about').hidden;
  function openDrawer() {
    lastFocus = document.activeElement;
    renderDrawer();
    const d = $('#drawer'), s = $('#scrim');
    d.hidden = false; s.hidden = false;
    requestAnimationFrame(() => { d.classList.add('open'); s.classList.add('show'); });
    $('#menuBtn').setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#drawerTitle').focus(), motionOn() ? 60 : 0);
  }
  function closeDrawer() {
    const d = $('#drawer'), s = $('#scrim');
    if (d.hidden) return;
    d.classList.remove('open'); s.classList.remove('show');
    $('#menuBtn').setAttribute('aria-expanded', 'false');
    setTimeout(() => { d.hidden = true; s.hidden = true; }, motionOn() ? 240 : 0);
    restoreFocus();
    if (!text && catalog && catalog.texts.length) openText(catalog.texts[0].id);
  }
  function restoreFocus() { const f = lastFocus; lastFocus = null; if (f && document.contains(f) && !f.closest('[inert]')) f.focus(); else $('#zMid').focus(); }
  function renderDrawer() {
    const view = st.browse;
    $('#browseGroup').setAttribute('aria-pressed', String(view === 'group'));
    $('#browseLang').setAttribute('aria-pressed', String(view === 'lang'));
    const langName = (id) => (catalog.languages.find((l) => l.id === id) || { name: id }).name;
    const groupName = (id) => (catalog.groups.find((g) => g.id === id) || { name: id }).name;
    const sections = view === 'group'
      ? catalog.groups.map((g) => ({ title: g.name, items: catalog.texts.filter((t) => (t.groups || []).includes(g.id)) }))
      : catalog.languages.map((l) => ({ title: l.name, items: catalog.texts.filter((t) => t.lang === l.id) }));
    $('#dlist').innerHTML = sections.filter((s) => s.items.length).map((s) => `<section class="dgroup"><h3>${esc(s.title)}</h3>${s.items.map((t) => {
      const sub = view === 'group' ? `${langName(t.lang)} · ${dn(t.verses)} श्लोक` : (t.groups || []).map(groupName).join(' · ');
      const now = text && t.id === text.id;
      return `<button type="button" class="ditem" data-id="${esc(t.id)}"${now ? ' aria-current="true"' : ''}>`
        + `<span class="t" lang="${esc(t.lang)}">${esc(t.title)}</span>`
        + `<span class="s">${t.subtitle ? esc(t.subtitle) + ' · ' : ''}${esc(sub)}${now ? ' · <span class="now">आता वाचत आहात</span>' : ''}</span></button>`;
    }).join('')}</section>`).join('');
  }
  function openSheet(id) {
    lastFocus = lastFocus || document.activeElement;
    const s = $('#' + id); s.hidden = false;
    if (id === 'settings') syncSettings();
    if (id === 'about') renderCredits();
    setTimeout(() => { const f = $('.sheet-head button', s); if (f) f.focus(); }, 0);
  }
  function closeSheet(id) { const s = $('#' + id); if (s.hidden) return; s.hidden = true; restoreFocus(); }
  function closeTopOverlay() {
    if (!$('#about').hidden) closeSheet('about');
    else if (!$('#settings').hidden) closeSheet('settings');
    else if (!$('#drawer').hidden) closeDrawer();
  }
  function trapFocus(e) {
    const box = !$('#about').hidden ? $('#about') : !$('#settings').hidden ? $('#settings') : !$('#drawer').hidden ? $('#drawer') : null;
    if (!box) return;
    const f = $$('button, a[href], input, summary, [tabindex]:not([tabindex="-1"])', box).filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !box.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !box.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }

  /* -------------------------------------------------------------- settings */
  function setPreviewSize(v) {
    $('#preview').style.setProperty('--pfs', v + 'px');
    $('#sizeVal').textContent = dn(v);
    $('#sizeRange').value = String(v);
    $('#sizeRange').setAttribute('aria-valuetext', dn(v));
  }
  function syncSettings() {
    setPreviewSize(st.size);
    const pv = $('#preview');
    const b = shareBlock();
    if (b && b.lines && text) { const first = splitLine(b.lines[0]); pv.textContent = (first ? first[0] : b.lines[0]).replace(/-$/, ''); pv.setAttribute('lang', text.lang); }
    $$('[data-theme-choice]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.themeChoice === themeNow())));
    $$('[data-mode-choice]').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.modeChoice === st.mode)));
    $('#meaningToggle').checked = st.meaning;
    $('#motionToggle').checked = motionOn();
    updateCount();
    $('#gcalRR').href = gcalUrl('rr');
    $('#gcalBH').href = gcalUrl('bh');
    resetArm = false; $('#countReset').textContent = 'या स्तोत्राची जप-संख्या शून्य करा';
  }
  function setSize(v) {
    v = clamp(Math.round(v), SIZE_MIN, SIZE_MAX);
    setPreviewSize(v);
    if (v === st.size) return;
    st.size = v; save();
    relayout();
  }
  let resetArm = false, resetTimer = 0;
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
  function bindSettings() {
    const range = $('#sizeRange');
    range.addEventListener('input', () => setPreviewSize(+range.value));
    range.addEventListener('change', () => setSize(+range.value));
    $('#sizeDown').addEventListener('click', () => setSize(st.size - 2));
    $('#sizeUp').addEventListener('click', () => setSize(st.size + 2));
    $$('[data-theme-choice]').forEach((el) => el.addEventListener('click', () => { st.theme = el.dataset.themeChoice; save(); applyTheme(); syncSettings(); }));
    $$('[data-mode-choice]').forEach((el) => el.addEventListener('click', () => {
      const m = el.dataset.modeChoice; if (m === st.mode) return;
      const a = st.mode === 'page' && pages.length ? anchorOf(cur) : st.anchor[text && text.id];
      st.mode = m; save(); syncSettings(); relayout(a || null);
    }));
    $('#meaningToggle').addEventListener('change', (e) => { st.meaning = e.target.checked; save(); relayout(); });
    $('#motionToggle').addEventListener('change', (e) => { st.motion = e.target.checked; save(); applyTheme(); });
    const setTarget = (v) => { st.target = clamp(Math.round(v), 1, 100000); save(); updateCount(); };
    $('#targetDown').addEventListener('click', () => setTarget(st.target - 1));
    $('#targetUp').addEventListener('click', () => setTarget(st.target + 1));
    $$('[data-target]').forEach((el) => el.addEventListener('click', () => setTarget(+el.dataset.target)));
    $('#countReset').addEventListener('click', (e) => {
      if (!text) return;
      if (!resetArm) { resetArm = true; e.currentTarget.textContent = 'खात्री आहे? शून्य करण्यासाठी पुन्हा दाबा'; clearTimeout(resetTimer); resetTimer = setTimeout(() => { resetArm = false; $('#countReset').textContent = 'या स्तोत्राची जप-संख्या शून्य करा'; }, 5000); return; }
      resetArm = false; st.count[text.id] = 0; save(true); updateCount(); $('#countReset').textContent = 'या स्तोत्राची जप-संख्या शून्य करा'; toast('जप-संख्या शून्य केली');
    });
  }

  /* --------------------------------------------------------------- credits */
  async function renderCredits() {
    const list = [];
    for (const e of catalog.texts) { try { list.push(textCache[e.id] || (textCache[e.id] = await loadJSON(e.file))); } catch (err) { /* offline and not cached */ } }
    const link = (href, label) => `<a href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`;
    $('#credits').innerHTML = list.map((t) => {
      const added = t.corrections.filter((c) => c.kind === 'added');
      return `<h3 class="dev" lang="${esc(t.lang)}">${esc(t.title)}</h3>`
        + `<p>मूळ पाठ: ${link(t.source.url, esc(t.source.site + ' — ' + t.source.page))} (आवृत्ती ${esc(String(t.source.rev_id))}), ${esc(t.source.credit)}. परवाना: ${link(t.source.license_url, 'CC BY-SA 4.0')}.</p>`
        + `<p>येथील पाठ सुधारित आहे: ${dn(t.corrections.length)} बदल. सुधारित पाठही CC BY-SA 4.0 अंतर्गत आहे.`
        + (added.length ? ` विकिस्रोत आवृत्तीत नसलेला मजकूर इतर प्रकाशित पाठांवरून जोडला आहे (यादीत “जोडले”).` : '') + `</p>`
        + `<details><summary>बदलांची यादी</summary><ol>${t.corrections.map((c) => `<li><span class="dev">${esc(c.where)}</span> ${c.kind === 'added' ? '(जोडले)' : ''}: <span class="dev">${esc(c.from)}</span> → <span class="dev">${esc(c.to)}</span></li>`).join('')}</ol></details>`;
    }).join('')
      + '<h3>मराठी अर्थ</h3><p>अर्थ हा संगणकाने (AI) तयार केलेला <strong>मसुदा</strong> आहे; तज्ज्ञांची तपासणी झालेली नाही, म्हणून तो आपोआप दिसत नाही. यावर कोणताही कॉपीराइट दावा नाही (CC0 1.0).</p>'
      + `<h3>अक्षरशैली (फॉन्ट)</h3><p>Noto Serif Devanagari — © 2022 The Noto Project Authors. परवाना: ${link('fonts/OFL.txt', 'SIL Open Font License 1.1')}. येथे नियमित (Regular) वजनाचा, देवनागरीपुरता लहान केलेला संच (WOFF2).</p>`
      + '<h3>गोपनीयता</h3><p>खाते नाही, जाहिराती नाहीत, वापराचे मोजमाप (analytics) नाही, ध्वनी नाही. सेटिंग्ज, शेवटचे पान व जप-संख्या फक्त या फोनवर साठवली जाते. “Google Calendar” बटण दाबले तरच Google चे पान उघडते.</p>'
      + `<h3>ऑफलाइन</h3><p id="offlineState">${offlineText()}</p>`
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
  async function openText(id) {
    const entry = catalog.texts.find((t) => t.id === id);
    if (!entry) return;
    let t;
    try { t = textCache[id] || (textCache[id] = await loadJSON(entry.file)); }
    catch (e) { toast('हे स्तोत्र उघडता आले नाही. एकदा इंटरनेट सुरू करून पुन्हा उघडा.', 4000); return; }
    if (reciting) { setPlaying(false); reciting = false; document.body.classList.remove('reciting'); $('#recitebar').hidden = true; releaseWake(); }
    text = t; st.text = id; save();
    blocks = buildBlocks(t); pages = []; shareCache = null;
    $('#welcome').hidden = true;
    document.title = `${t.short} · माझी स्तोत्रे`;
    const bt = $('#barTitle'); bt.textContent = t.title; bt.setAttribute('lang', t.lang);
    updateCount();
    await relayout(st.anchor[id] || null);
    if (!st.hintSeen && st.mode === 'page') showHint();
  }
  function bindUI() {
    bindGestures(); bindScroller(); bindSettings();
    $('#hint').addEventListener('click', hideHint);
    $('#menuBtn').addEventListener('click', openDrawer);
    $('#barTitle').addEventListener('click', openDrawer);
    $('#drawerClose').addEventListener('click', closeDrawer);
    $('#scrim').addEventListener('click', closeDrawer);
    $('#browseGroup').addEventListener('click', () => { st.browse = 'group'; save(); renderDrawer(); });
    $('#browseLang').addEventListener('click', () => { st.browse = 'lang'; save(); renderDrawer(); });
    $('#dlist').addEventListener('click', (e) => {
      const b = e.target.closest('.ditem'); if (!b) return;
      const id = b.dataset.id;
      lastFocus = null;
      $('#drawer').classList.remove('open'); $('#scrim').classList.remove('show');
      setTimeout(() => { $('#drawer').hidden = true; $('#scrim').hidden = true; }, motionOn() ? 240 : 0);
      $('#menuBtn').setAttribute('aria-expanded', 'false');
      if (!text || id !== text.id) openText(id); else setControls(false);
      $('#zMid').focus();
    });
    $('#aboutBtn').addEventListener('click', () => openSheet('about'));
    $('#settingsBtn').addEventListener('click', () => openSheet('settings'));
    $('#settingsClose').addEventListener('click', () => closeSheet('settings'));
    $('#aboutClose').addEventListener('click', () => closeSheet('about'));
    for (const id of ['settings', 'about']) $('#' + id).addEventListener('click', (e) => { if (e.target.id === id) closeSheet(id); });
    $('#reciteBtn').addEventListener('click', startRecite);
    $('#reciteClose').addEventListener('click', stopRecite);
    $('#playBtn').addEventListener('click', () => setPlaying(!playing));
    $('#slowBtn').addEventListener('click', () => { st.speed = clamp(st.speed - 1, 1, 10); $('#speedLbl').textContent = dn(st.speed); save(); });
    $('#fastBtn').addEventListener('click', () => { st.speed = clamp(st.speed + 1, 1, 10); $('#speedLbl').textContent = dn(st.speed); save(); });
    $('#countBtn').addEventListener('click', bump);
    $('#countBtn2').addEventListener('click', bump);
    $('#shareBtn').addEventListener('click', onShare);
    document.addEventListener('keydown', (e) => {
      if (!$('#hint').hidden) { hideHint(); if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); return; } }
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
    try { catalog = await loadJSON('data/catalog.json'); }
    catch (e) {
      $('#welcome').hidden = false;
      $('.welcome-sub').textContent = 'पहिल्यांदा उघडण्यासाठी इंटरनेट लागते. इंटरनेट सुरू करून पुन्हा उघडा.';
      return;
    }
    bindUI();
    if (!st.text || !catalog.texts.some((t) => t.id === st.text)) { $('#welcome').hidden = false; openDrawer(); }
    else await openText(st.text);
  }

  // Small read-only hook for the automated tests in tests/ (no network, no side effects).
  window.__stotre = {
    version: APP_VERSION, state: () => JSON.parse(JSON.stringify(st)), pages: () => pages.length, cur: () => cur,
    label: () => pageLabel(pages[cur]), go, turn, relayout, setSize, openText, aksharas, splitLine,
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
