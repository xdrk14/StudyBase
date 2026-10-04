(() => {
// StudyBase: library sidebar, landing page, PDF + HTML note viewer. No framework, no build step.
// All dynamic text goes through textContent; nothing from library.json is ever parsed as HTML.

const $ = (s) => document.querySelector(s);
const SVG_CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const MODES = ['light', 'dark', 'ultra'];
const SAFE_FILE = /^files\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\.(pdf|html)$/;
// Opened straight from disk (file://), browsers block fetch, modules and workers:
// fall back to the browser's own PDF viewer. Hosted, we use pdf.js.
const LOCAL = location.protocol === 'file:';
const PDFJS_BASE = new URL('vendor/pdfjs/', document.currentScript.src).href;
const mobile = matchMedia('(max-width: 860px)');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function fmtSize(b) {
  if (!b) return '';
  return b >= 1e6 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}

/* ── Theme ─────────────────────────────────────────────── */
function setTheme(m) {
  if (!MODES.includes(m)) m = 'light';
  document.documentElement.setAttribute('data-theme', m);
  try { localStorage.setItem('sb-theme', m); } catch {}
  document.querySelectorAll('.themes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  $('#theme-cycle').setAttribute('aria-label', `Theme: ${m}. Change theme`);
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(document.documentElement).getPropertyValue('--side').trim();
}
document.querySelectorAll('.themes button').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.mode)));
$('#theme-cycle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  setTheme(MODES[(MODES.indexOf(cur) + 1) % MODES.length]);
});
setTheme(document.documentElement.getAttribute('data-theme'));

/* ── Mobile drawer ─────────────────────────────────────── */
const menuBtn = $('#menu-btn');
function openNav() {
  document.body.classList.add('nav-open');
  $('#scrim').hidden = false;
  menuBtn.setAttribute('aria-expanded', 'true');
  // Focus the drawer itself, not the search box, so phones don't pop the keyboard.
  setTimeout(() => $('#sidebar').focus({ preventScroll: true }), 50);
}
function closeNav() {
  if (!document.body.classList.contains('nav-open')) return;
  document.body.classList.remove('nav-open');
  $('#scrim').hidden = true;
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', openNav);
$('#scrim').addEventListener('click', closeNav);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
mobile.addEventListener('change', () => { if (!mobile.matches) closeNav(); });

/* ── Library ───────────────────────────────────────────── */
let groups = [];
const byId = new Map();
let openGroups = new Set(store.get('sb-open', ['Pure Mathematics']));
let currentId = null;

async function loadLibrary() {
  const data = window.SB_LIBRARY || await (await fetch('library.json', { cache: 'no-cache' })).json();
  groups = data.groups.map((g) => ({
    name: String(g.name),
    summary: String(g.summary || ''),
    items: g.items.filter((it) => SAFE_FILE.test(it.file)).map((it) => {
      const item = {
        id: String(it.id), title: String(it.title), file: it.file, size: it.size || 0,
        topics: String(it.topics || ''), group: String(g.name),
        type: it.file.endsWith('.pdf') ? 'pdf' : 'html',
      };
      item.hay = `${item.title} ${item.topics} ${item.group}`.toLowerCase();
      byId.set(item.id, item);
      return item;
    }),
  })).filter((g) => g.items.length);
}

function badge(type) { return el('span', { class: `badge ${type}`, text: type.toUpperCase() }); }

function renderNav() {
  const q = $('#q').value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const g of groups) {
    const items = g.items.filter((it) => terms.every((t) => it.hay.includes(t)));
    if (!items.length) continue;
    const open = terms.length > 0 || openGroups.has(g.name);
    const listId = 'g-' + g.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const head = el('button', { type: 'button', class: 'group-head', 'aria-expanded': String(open), 'aria-controls': listId,
      onclick: () => {
        openGroups.has(g.name) ? openGroups.delete(g.name) : openGroups.add(g.name);
        store.set('sb-open', [...openGroups]);
        renderNav();
      } });
    head.innerHTML = SVG_CHEVRON; // static constant
    head.append(el('span', { class: 'name', text: g.name }), el('span', { class: 'count', text: String(items.length) }));
    const list = el('ul', { class: 'items', id: listId, hidden: !open },
      ...items.map((it) => el('li', {}, el('a', {
        class: 'item', href: `#/n/${it.id}`, 'aria-current': it.id === currentId ? 'page' : null,
      }, el('span', { class: 't', text: it.title }), badge(it.type)))));
    out.push(el('section', { class: 'group' + (open ? ' open' : ''), 'data-group': g.name }, head, list));
  }
  if (!out.length) out.push(el('p', { class: 'empty', text: `Nothing matches “${$('#q').value.trim()}”.` }));
  $('#groups').replaceChildren(...out);
}
$('#q').addEventListener('input', renderNav);

/* ── Home ──────────────────────────────────────────────── */
function card(it) {
  return el('a', { class: 'card', href: `#/n/${it.id}` }, badge(it.type),
    el('span', { class: 't', text: it.title }),
    el('span', { class: 'm', text: [it.group, fmtSize(it.size)].filter(Boolean).join(' · ') }));
}

function renderHome() {
  const all = [...byId.values()];
  const stat = (n, label) => el('div', {}, el('dt', { text: label }), el('dd', { text: String(n) }));
  $('#stats').replaceChildren(
    stat(all.filter((i) => i.type === 'pdf').length, 'PDF short notes'),
    stat(all.filter((i) => i.type === 'html').length, 'Interactive maths pages'),
    stat(groups.length, 'Subjects'));

  const recent = store.get('sb-recent', []).map((id) => byId.get(id)).filter(Boolean);
  const picks = recent.length ? recent : ['pure-maths-3', 'p3p4-formula-sheet', 'physics-a2-short-note'].map((id) => byId.get(id)).filter(Boolean);
  $('#recent-title').textContent = recent.length ? 'Pick up where you left off' : 'Start here';
  $('#recent').replaceChildren(...picks.slice(0, 4).map(card));

  $('#subjects').replaceChildren(...groups.map((g) => el('button', {
    type: 'button', class: 'tile',
    onclick: () => {
      openGroups = new Set([g.name]);
      store.set('sb-open', [...openGroups]);
      $('#q').value = '';
      renderNav();
      if (mobile.matches) openNav();
      const head = document.querySelector(`.group[data-group="${CSS.escape(g.name)}"] .group-head`);
      if (head) { head.scrollIntoView({ block: 'nearest' }); setTimeout(() => head.focus({ preventScroll: true }), 60); }
    },
  }, el('span', { class: 't', text: g.name }), el('span', { class: 'm', text: `${g.items.length} · ${g.summary}` }))));
}

function remember(id) {
  const r = store.get('sb-recent', []).filter((x) => x !== id);
  r.unshift(id);
  store.set('sb-recent', r.slice(0, 4));
}

/* ── PDF viewer (pdf.js, lazy pages) ───────────────────── */
const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3];
const pdf = (() => {
  const host = $('#pages');
  const status = $('#status');
  let lib = null, task = null, doc = null, pages = [], zoom = 1, cssW = 0, io = null, gen = 0, curPage = 1, rafPending = false;

  async function loadLib() {
    if (!lib) {
      lib = await import(PDFJS_BASE + 'pdf.min.mjs');
      lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + 'pdf.worker.min.mjs';
    }
    return lib;
  }

  function fitWidth() {
    const cs = getComputedStyle(host);
    const avail = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.max(200, Math.min(avail, 900));
  }

  function layout() {
    cssW = Math.round(fitWidth() * zoom);
    for (const p of pages) {
      p.el.style.width = cssW + 'px';
      p.el.style.height = Math.round(cssW * p.h / p.w) + 'px';
    }
    $('#zoom-fit').textContent = Math.round(zoom * 100) + '%';
    $('#zoom-out').disabled = zoom <= ZOOMS[0];
    $('#zoom-in').disabled = zoom >= ZOOMS[ZOOMS.length - 1];
  }

  async function render(p) {
    if (!doc || p.renderedW === cssW) return;
    const my = gen, w = cssW;
    try {
      if (!p.page) {
        p.page = await doc.getPage(p.n);
        const v = p.page.getViewport({ scale: 1 });
        if (v.width !== p.w || v.height !== p.h) { p.w = v.width; p.h = v.height; p.el.style.height = Math.round(cssW * p.h / p.w) + 'px'; }
      }
      if (my !== gen || w !== cssW) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let scale = (w / p.w) * dpr;
      const maxPx = 12e6; // keep canvases inside mobile memory limits
      if (p.w * p.h * scale * scale > maxPx) scale = Math.sqrt(maxPx / (p.w * p.h));
      const viewport = p.page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      p.task?.cancel();
      p.task = p.page.render({ canvas, viewport });
      await p.task.promise;
      p.task = null;
      if (my !== gen || w !== cssW) return;
      p.el.replaceChildren(canvas);
      p.renderedW = w;
    } catch (e) {
      if (e?.name !== 'RenderingCancelledException') console.warn('page', p.n, e);
    }
  }

  function release(p) {
    p.task?.cancel();
    p.task = null;
    if (p.renderedW) { p.el.replaceChildren(); p.renderedW = 0; p.page?.cleanup(); }
  }

  function nearViewport(p) {
    const r = p.el.getBoundingClientRect();
    return r.bottom > -1500 && r.top < innerHeight + 1500;
  }

  function trackPage() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!pages.length) return;
      const mid = innerHeight / 2;
      let n = 1;
      for (const p of pages) { if (p.el.getBoundingClientRect().top <= mid) n = p.n; else break; }
      if (n !== curPage) { curPage = n; syncPageUi(); }
    });
  }

  function syncPageUi() {
    const input = $('#page');
    if (document.activeElement !== input) input.value = curPage;
    $('#prev').disabled = curPage <= 1;
    $('#next').disabled = curPage >= pages.length;
  }

  function goTo(n) {
    n = Math.min(Math.max(1, n | 0), pages.length);
    if (!pages.length) return;
    pages[n - 1].el.scrollIntoView({ block: 'start' });
    curPage = n;
    syncPageUi();
  }

  function setZoom(z) {
    if (!pages.length) return;
    const p = pages[curPage - 1];
    const r = p.el.getBoundingClientRect();
    const frac = (innerHeight / 2 - r.top) / r.height;
    zoom = z;
    layout();
    const r2 = p.el.getBoundingClientRect();
    scrollBy(0, r2.top + frac * r2.height - innerHeight / 2);
    pages.filter(nearViewport).forEach(render);
  }

  async function open(url) {
    close();
    const my = gen;
    status.textContent = 'Loading…';
    try {
      const L = await loadLib();
      if (my !== gen) return;
      task = L.getDocument({ url, disableAutoFetch: true, disableStream: false, isEvalSupported: false, enableXfa: false });
      doc = await task.promise;
      if (my !== gen) return;
      const first = await doc.getPage(1);
      if (my !== gen) return;
      const v = first.getViewport({ scale: 1 });
      zoom = 1;
      curPage = 1;
      pages = Array.from({ length: doc.numPages }, (_, i) => ({
        n: i + 1, w: v.width, h: v.height, page: i === 0 ? first : null, task: null, renderedW: 0,
        el: el('div', { class: 'page', 'data-i': String(i), role: 'img', 'aria-label': `Page ${i + 1}` }),
      }));
      host.replaceChildren(...pages.map((p) => p.el));
      status.textContent = '';
      $('#total').textContent = String(doc.numPages);
      $('#page').max = String(doc.numPages);
      layout();
      syncPageUi();
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const p = pages[+en.target.dataset.i];
          if (!p) continue;
          if (en.isIntersecting) render(p);
          else if (pages.length > 8) release(p);
        }
      }, { rootMargin: '1500px 0px' });
      pages.forEach((p) => io.observe(p.el));
    } catch (e) {
      if (my !== gen) return;
      console.error(e);
      status.textContent = 'Could not load this PDF. Try “Open in new tab” or Download.';
    }
  }

  function close() {
    gen++;
    io?.disconnect();
    io = null;
    for (const p of pages) p.task?.cancel();
    pages = [];
    host.replaceChildren();
    status.textContent = '';
    task?.destroy();
    task = null;
    doc = null;
  }

  let resizeT;
  addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!pages.length) return;
      if (Math.round(fitWidth() * zoom) !== cssW) { layout(); pages.filter(nearViewport).forEach(render); }
    }, 150);
  });
  addEventListener('scroll', trackPage, { passive: true });

  $('#prev').addEventListener('click', () => goTo(curPage - 1));
  $('#next').addEventListener('click', () => goTo(curPage + 1));
  $('#page').addEventListener('change', (e) => goTo(+e.target.value));
  $('#page').addEventListener('keydown', (e) => { if (e.key === 'Enter') { goTo(+e.target.value); e.target.blur(); } });
  $('#zoom-in').addEventListener('click', () => setZoom(ZOOMS.find((z) => z > zoom + 1e-3) ?? zoom));
  $('#zoom-out').addEventListener('click', () => setZoom([...ZOOMS].reverse().find((z) => z < zoom - 1e-3) ?? zoom));
  $('#zoom-fit').addEventListener('click', () => setZoom(1));

  return { open, close };
})();

/* ── Router ────────────────────────────────────────────── */
const viewer = $('#viewer');
const frame = $('#frame');

function measureBar() {
  document.documentElement.style.setProperty('--bar-h', $('#bar').offsetHeight + 'px');
}
addEventListener('resize', measureBar);

function showHome() {
  currentId = null;
  pdf.close();
  frame.hidden = true;
  frame.removeAttribute('src');
  viewer.hidden = true;
  $('#home').hidden = false;
  document.title = 'StudyBase';
  renderHome();
  renderNav();
}

function showItem(it) {
  const changed = currentId !== it.id;
  currentId = it.id;
  $('#home').hidden = true;
  viewer.hidden = false;
  const inFrame = it.type === 'html' || LOCAL;
  viewer.classList.toggle('is-html', inFrame);
  const b = $('#doc-type');
  b.className = `badge ${it.type}`;
  b.textContent = it.type.toUpperCase();
  $('#doc-title').textContent = it.title;
  $('#doc-meta').textContent = [it.group, fmtSize(it.size)].filter(Boolean).join(' · ');
  $('#open-tab').href = it.file;
  $('#download').href = it.file;
  $('#pdf-ctl').hidden = inFrame;
  document.title = `${it.title} · StudyBase`;
  remember(it.id);
  if (!openGroups.has(it.group)) { openGroups.add(it.group); store.set('sb-open', [...openGroups]); }
  renderNav();
  measureBar();
  if (!changed) return;
  scrollTo(0, 0);
  if (!inFrame) {
    frame.hidden = true;
    frame.removeAttribute('src');
    pdf.open(it.file);
  } else {
    pdf.close();
    frame.title = it.title;
    frame.hidden = false;
    frame.src = it.file;
  }
}

function route() {
  const m = location.hash.match(/^#\/n\/([a-z0-9-]+)$/);
  const it = m && byId.get(m[1]);
  if (it) showItem(it); else showHome();
  closeNav();
  if (it) $('#main').focus({ preventScroll: true });
}

addEventListener('hashchange', route);

loadLibrary().then(route).catch((e) => {
  console.error(e);
  $('#groups').replaceChildren(el('p', { class: 'empty', text: 'Could not load the library. If you opened index.html straight from disk, run a local server instead (see README).' }));
});
})();
