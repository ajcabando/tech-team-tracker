#!/usr/bin/env node
/**
 * Mobile layout auditor: prove that no text overlaps, overflows, or is hidden
 * behind the sticky header, at real phone widths.
 *
 * Unlike `capture-screenshots.mjs` (which produces README art), this script is
 * a gate. It walks every route at several phone viewports in both themes, at
 * every scroll offset, and reports three classes of defect:
 *
 *   overlap   two visible text runs paint over each other
 *   overflow  an element's content is wider than its box, or past the viewport
 *   occluded  a visible element sits underneath the sticky `.mobile-header`
 *   tap       an interactive control is smaller than the 44px target
 *
 * Leaflet internals are excluded: map tiles and panes overlap by design, and the
 * map is a `position: relative` island with `overflow: hidden`.
 *
 * Usage:
 *   DASHBOARD_URL=http://localhost:5788 ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node scripts/audit-mobile.mjs
 *
 * Environment:
 *   DASHBOARD_URL   default http://localhost:5788
 *   ADMIN_EMAIL     default admin@example.com
 *   ADMIN_PASSWORD  default change-this-password
 *   CHROME_PATH     override the Chrome/Chromium binary
 *   CDP_PORT        default 9224
 *   AUDIT_OUT       default docs/audit-mobile.md
 *   AUDIT_SHOTS     default docs/screenshots/audit
 *   AUDIT_WIDTHS    default 390,360,430   (comma separated, mobile flags on)
 *   AUDIT_THEMES    default light,dark
 *   AUDIT_ROUTES    default the full route list (see ROUTES below)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.AUDIT_OUT || join(ROOT, 'docs', 'audit-mobile.md');
const SHOTS = process.env.AUDIT_SHOTS || join(ROOT, 'docs', 'screenshots', 'audit');
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5788';
const API_URL = process.env.API_URL || DASHBOARD_URL.replace(/:5796$/, ':5797').replace(/:5788$/, ':5789');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const PORT = Number(process.env.CDP_PORT || 9224);

const WIDTHS = (process.env.AUDIT_WIDTHS || '390,360,430').split(',').map((n) => Number(n.trim())).filter(Boolean);
const THEMES = (process.env.AUDIT_THEMES || 'light,dark').split(',').map((t) => t.trim()).filter(Boolean);

const ROUTES = [
  { name: 'dashboard', hash: '#/' },
  { name: 'technicians', hash: '#/technicians' },
  { name: 'technician-detail', hash: '#/technicians/ADV-TECH-0001', needs: 'adversarial' },
  { name: 'devices', hash: '#/devices' },
  { name: 'trips', hash: '#/trips' },
  { name: 'trip-detail', hash: '#/trips/ADV-TRIP-0001', needs: 'adversarial' },
  { name: 'reports', hash: '#/reports' },
  { name: 'alerts', hash: '#/alerts' },
  { name: 'settings', hash: '#/settings' },
  { name: 'superadmin', hash: '#/superadmin' },
  { name: 'about', hash: '#/about' },
  { name: 'android-setup', hash: '#/android-setup' },
];

const TAP_MIN = 40;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error(`Chrome not found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async evaluate(expression, sessionId, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, sessionId);
    if (result.exceptionDetails) {
      const text = (result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'unknown').split('\n')[0];
      throw new Error(`Page exception: ${text}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, sessionId, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    do {
      try {
        last = await this.evaluate(expression, sessionId);
        if (last) return last;
      } catch { /* retry */ }
      await sleep(400);
    } while (Date.now() < deadline);
    throw new Error(`waitFor timeout: ${expression}`);
  }
}

/**
 * Injected page function. Returns one flat list of defects for the current
 * scroll position. Written as a string so it can run through Runtime.evaluate
 * without depending on bundling.
 *
 * Two deliberate suppressions, because both are correct behaviour and would
 * otherwise drown the real findings:
 *   - content scrolling *under* the opaque sticky header is what a sticky
 *     header is for, so `occluded` is only raised for sticky elements
 *   - a wide table inside .table-wrap { overflow-x: auto } is a scroll
 *     container doing its job, so descendants are exempt from `viewport`
 *     overflow and the container is reported separately as `scroll-clip`
 *
 * @param {number} minTap
 */
const MEASURE = (minTap) => `(() => {
  const minTap = ${minTap};
  const out = [];
  const vw = window.innerWidth;

  // Leaflet paints its tiles, panes and markers as overlapping absolute layers.
  // That is the map working, not a layout defect, so it is out of scope.
  const inLeaflet = (el) => !!(el.closest && el.closest('.leaflet-container'));

  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    if (el.classList.contains('sr-only')) return false;
    if (el.hasAttribute('hidden')) return false;
    // Closed mobile drawer: translated off-canvas and visibility:hidden already
    // covers it, but an ancestor visibility is the common case.
    for (let p = el; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.visibility === 'hidden' || pcs.display === 'none') return false;
    }
    return true;
  };

  const label = (el) => {
    const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '';
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 46);
    return el.tagName.toLowerCase() + cls + (text ? ' — "' + text + '"' : '');
  };

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
  };

  // Range rects are LAYOUT rects: they ignore ancestor clipping, so a run that
  // is ellipsised or scrolled out of an overflow:hidden box still reports its
  // full width. Clipping each line box to every clipping ancestor on its way up
  // means only genuinely painted pixels get compared.
  const clipRectsOf = (el) => {
    const rects = [];
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const r = p.getBoundingClientRect();
        rects.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
      }
    }
    return rects;
  };
  const clipTo = (rect, clips) => {
    let out = rect;
    for (const c of clips) {
      const l = Math.max(out.l, c.l);
      const t = Math.max(out.t, c.t);
      const r = Math.min(out.r, c.r);
      const b = Math.min(out.b, c.b);
      if (r <= l || b <= t) return null; // entirely clipped away
      out = { l, t, r, b, w: r - l, h: b - t };
    }
    return out;
  };

  const intersects = (a, b) => {
    const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
    const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    return x > 1 && y > 1 ? Math.round(x * y) : 0;
  };

  // true when the element (or an ancestor) deliberately clips/scrolls horizontally
  const scrollClipsX = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };
  const isScrollContainer = (el) => {
    const ox = getComputedStyle(el).overflowX;
    return ox === 'auto' || ox === 'scroll';
  };

  // Ellipsis truncation is deliberate: the content really is wider than the box,
  // and it is meant to be. scrollWidth still reports the full run.
  const isEllipsised = (el) => {
    const cs = getComputedStyle(el);
    return cs.textOverflow === 'ellipsis' && (cs.overflowX === 'hidden' || cs.overflowX === 'clip');
  };

  // A sticky/fixed opaque chrome layer is SUPPOSED to paint over the content
  // that scrolls beneath it. Comparing its own text against that hidden content
  // reports a collision the user cannot see. Only two elements in the SAME layer
  // can actually overlap each other.
  const stickyLayer = (el) => {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const pos = getComputedStyle(p).position;
      if (pos === 'sticky' || pos === 'fixed') return p;
    }
    return null;
  };

  /* ---------- 1. text overlap ---------- */
  // Leaf text = an element whose own direct child text nodes are non-blank.
  //
  // Rects are per LINE BOX (getClientRects), not the element's bounding box.
  // An inline run that wraps to two lines has one bounding box covering both,
  // which would falsely "overlap" whatever shares the first line. Line boxes
  // are what actually get painted, so they are what must be compared.
  const textRuns = [];
  for (const el of document.querySelectorAll('body *')) {
    if (inLeaflet(el) || !isVisible(el)) continue;
    const own = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.nodeValue.trim())
      .join(' ')
      .trim();
    if (!own) continue;
    const box = rectOf(el);
    if (box.w < 2 || box.h < 2) continue;
    // Range over the element's text so the browser reports one rect per line.
    const clips = clipRectsOf(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => clipTo({ l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }, clips))
      .filter(Boolean)
      .filter((r) => r.w > 1 && r.h > 1);
    range.detach && range.detach();
    if (!lines.length) continue;
    textRuns.push({ el, r: box, lines, own, layer: stickyLayer(el) });
  }

  for (let i = 0; i < textRuns.length; i += 1) {
    for (let j = i + 1; j < textRuns.length; j += 1) {
      const a = textRuns[i];
      const b = textRuns[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue; // ancestor/descendant
      if (a.el === b.el) continue;
      // Different chrome layers: one simply covers the other.
      if (a.layer !== b.layer) continue;
      let area = 0;
      for (const la of a.lines) for (const lb of b.lines) area = Math.max(area, intersects(la, lb));
      if (!area) continue;
      out.push({
        kind: 'overlap',
        el: label(a.el),
        other: label(b.el),
        area,
        at: { x: Math.round(Math.max(a.r.l, b.r.l)), y: Math.round(Math.max(a.r.t, b.r.t)) },
      });
    }
  }

  /* ---------- 2. overflow ---------- */
  // First pass: which elements overflow their own box. Reporting only the
  // outermost offender per subtree keeps the root cause, not the 8 ancestors
  // it drags off-screen with it.
  const selfOverflow = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (inLeaflet(el) || !isVisible(el)) continue;
    if (isScrollContainer(el)) continue; // it is meant to scroll
    // A long value in an <input> scrolls inside the field by design; the field
    // itself is not overflowing anything.
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') continue;
    if (isEllipsised(el)) continue;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 2 && el.clientWidth > 0) {
      // scrollWidth over-reports by a few px under fractional layout, so
      // corroborate with the geometry that actually gets painted. A Range over
      // the subtree returns one rect per line box, which is the only way to see
      // an unwrapped token: the text sticks out of a box that still measures
      // correct, and no element rect shows it.
      const box = el.getBoundingClientRect();
      const limit = box.left + el.clientWidth + parseFloat(getComputedStyle(el).paddingLeft || 0) + 2;
      const range = document.createRange();
      range.selectNodeContents(el);
      let sticksOut = false;
      for (const r of range.getClientRects()) {
        if (r.right > limit) { sticksOut = true; break; }
      }
      if (!sticksOut) continue;
      selfOverflow.add(el);
      const hasOffender = el.parentElement
        ? Array.from(el.children).some((child) => selfOverflow.has(child))
        : false;
      if (hasOffender) continue;
      out.push({
        kind: 'overflow',
        why: 'content',
        el: label(el),
        box: el.clientWidth,
        content: el.scrollWidth,
        overflowBy: over,
      });
    }
  }

  for (const el of document.querySelectorAll('body *')) {
    if (inLeaflet(el) || !isVisible(el)) continue;
    const r = rectOf(el);
    if (r.w <= 0) continue;
    if (getComputedStyle(el).position === 'fixed') continue; // full-bleed layers
    if (scrollClipsX(el)) continue; // a scroll container is scrolling it, by design
    if (r.r > vw + 1 || r.l < -1) {
      out.push({
        kind: 'overflow',
        why: 'viewport',
        el: label(el),
        left: Math.round(r.l),
        right: Math.round(r.r),
        viewport: vw,
        overflowBy: Math.round(Math.max(r.r - vw, -r.l)),
      });
    }
  }

  // Wide content parked in a horizontal scroller is a real mobile failure
  // (actions land off-screen with no affordance), but it is not an overflow.
  for (const el of document.querySelectorAll('body *')) {
    if (inLeaflet(el) || !isVisible(el) || !isScrollContainer(el)) continue;
    const over = el.scrollWidth - el.clientWidth;
    if (over > 2) {
      out.push({
        kind: 'scroll-clip',
        el: label(el),
        box: el.clientWidth,
        content: el.scrollWidth,
        overflowBy: over,
      });
    }
  }

  /* ---------- 3. occluded by the sticky mobile header ---------- */
  // Content sliding under a sticky header is intended. The defect is a *sticky*
  // bar being swallowed by another sticky bar: unreadable and untappable.
  const header = document.querySelector('.mobile-header');
  if (header && isVisible(header)) {
    const hr = rectOf(header);
    for (const el of document.querySelectorAll('body *')) {
      if (inLeaflet(el) || el === header || header.contains(el) || el.contains(header)) continue;
      if (!isVisible(el)) continue;
      if (getComputedStyle(el).position !== 'sticky') continue;
      const r = rectOf(el);
      const area = intersects(r, hr);
      if (area > 4) {
        out.push({
          kind: 'occluded',
          el: label(el),
          area,
          hidden: area / Math.max(r.w * r.h, 1) > 0.5,
        });
      }
    }
  }

  /* ---------- 4. tap targets ---------- */
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea, [role="link"], [role="button"]')) {
    if (inLeaflet(el) || !isVisible(el)) continue;
    if (el.classList.contains('sr-only')) continue;
    const r = rectOf(el);
    if (r.w < 2 || r.h < 2) continue;
    if (Math.round(r.h) < minTap || Math.round(r.w) < minTap) {
      out.push({
        kind: 'tap',
        el: label(el),
        w: Math.round(r.w),
        h: Math.round(r.h),
      });
    }
  }

  return out;
})()`;

function groupKey(defect) {
  return [defect.kind, defect.el].join(' :: ');
}

function summarise(defects) {
  const map = new Map();
  for (const defect of defects) {
    const key = groupKey(defect);
    if (!map.has(key)) map.set(key, { ...defect, count: 0, routes: new Set(), widths: new Set() });
    const entry = map.get(key);
    entry.count += 1;
    if (defect.kind === 'occluded' && defect.hidden) entry.hidden = true;
  }
  return map;
}

const SEVERITY = { overlap: 1, occluded: 2, overflow: 3, 'scroll-clip': 4, tap: 5 };

function describe(d, worst) {
  if (d.kind === 'overlap') return `overlaps by ${worst}px² with \`${d.other}\``;
  if (d.kind === 'occluded') return `${d.hidden ? '**fully hidden behind**' : 'partly hidden behind'} \`.mobile-header\` (${worst}px²)`;
  if (d.kind === 'scroll-clip') return `scrolls horizontally, ${d.content}px of content in a ${d.box}px box (+${d.overflowBy}px)`;
  if (d.kind === 'overflow' && d.why === 'content') return `content ${d.content}px in ${d.box}px box (+${d.overflowBy}px)`;
  if (d.kind === 'overflow') return `box ${d.left}→${d.right} in ${d.viewport}px viewport (+${d.overflowBy}px)`;
  return `${d.w}×${d.h}px, minimum ${TAP_MIN}px`;
}

function renderReport(results, meta) {
  const rows = [];
  for (const { route, width, theme, defects } of results) {
    for (const defect of defects) {
      rows.push({ route, width, theme, ...defect });
    }
  }

  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.kind} :: ${row.el}`;
    if (!grouped.has(key)) {
      grouped.set(key, { kind: row.kind, el: row.el, worst: 0, hidden: false, where: new Set(), detail: row });
    }
    const entry = grouped.get(key);
    entry.hidden = entry.hidden || Boolean(row.hidden);
    if (row.kind === 'overlap' || row.kind === 'occluded') entry.worst = Math.max(entry.worst, row.area || 0);
    else if (row.kind === 'tap') entry.worst = Math.max(entry.worst, Math.min(row.w, row.h));
    else entry.worst = Math.max(entry.worst, row.overflowBy || 0);
    entry.where.add(`${row.route} @${row.width}/${row.theme}`);
  }

  const sorted = [...grouped.values()].sort((a, b) => {
    if (SEVERITY[a.kind] !== SEVERITY[b.kind]) return SEVERITY[a.kind] - SEVERITY[b.kind];
    return b.worst - a.worst;
  });

  const lines = [];
  lines.push('# Mobile layout audit');
  lines.push('');
  lines.push(`Generated by \`scripts/audit-mobile.mjs\` against \`${meta.dashboardUrl}\`.`);
  lines.push('');
  lines.push(`- Viewports: ${meta.widths.map((w) => `${w}px`).join(', ')}`);
  lines.push(`- Themes: ${meta.themes.join(', ')}`);
  lines.push(`- Routes: ${meta.routes}`);
  lines.push(`- Login: \`${meta.adminEmail}\``);
  lines.push(`- ${rows.length ? '**FAIL**' : '**PASS**'} — ${sorted.length} distinct defect${sorted.length === 1 ? '' : 's'}`);
  lines.push('');
  lines.push('Kinds, in severity order: `overlap` (text painted over text), `occluded` (a sticky bar swallowed by the sticky header),');
  lines.push('`overflow` (content wider than its box or past the viewport), `scroll-clip` (content parked in a horizontal');
  lines.push('scroller), `tap` (control under 40px).');
  lines.push('');
  lines.push('| # | Severity | Element | Where | Detail |');
  lines.push('| --- | --- | --- | --- | --- |');
  sorted.forEach((entry, index) => {
    const where = [...entry.where].slice(0, 4).join('<br>') + (entry.where.size > 4 ? `<br>+${entry.where.size - 4} more` : '');
    const severity = entry.hidden ? '**hidden**' : entry.kind;
    lines.push(`| ${index + 1} | ${severity} | \`${entry.el}\` | ${where} | ${describe(entry.detail, entry.worst)} |`);
  });
  lines.push('');
  lines.push('## Raw counts by kind');
  lines.push('');
  const byKind = {};
  for (const row of rows) byKind[row.kind] = (byKind[row.kind] || 0) + 1;
  for (const kind of Object.keys(byKind).sort((a, b) => SEVERITY[a] - SEVERITY[b])) {
    lines.push(`- ${kind}: ${byKind[kind]}`);
  }
  lines.push('');
  lines.push(`Screenshots: \`${meta.shots}\``);
  lines.push('');
  return { markdown: lines.join('\n'), total: sorted.length };
}

async function main() {
  mkdirSync(dirname(OUT), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'ttt-audit-'));
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--hide-scrollbars',
  ], { stdio: 'ignore' });

  console.log('waiting for chrome…');
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) break;
    } catch { /* not ready yet */ }
    if (Date.now() > deadline) throw new Error('Chrome DevTools port never opened');
    await sleep(1000);
  }

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('No page target found');
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 20000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', (event) => { clearTimeout(timer); reject(new Error(`CDP connect failed: ${event.message || 'refused'}`)); });
  });
  console.log('connected.');

  const cdp = new Cdp(ws);
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: pageTarget.id, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  const results = [];
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    writeFileSync(join(SHOTS, name), Buffer.from(data, 'base64'));
  };

  const setViewport = async (width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
    }, sessionId);
  };

  const setTheme = async (theme) => {
    await cdp.evaluate(`localStorage.setItem('tracker.theme', '${theme}');`, sessionId);
  };

  const goto = async (hash, settle = 2000) => {
    await cdp.evaluate(`window.location.hash = '${hash}'; window.scrollTo(0,0);`, sessionId);
    await sleep(settle);
  };

  /** Measure at the top and at every ~80vh step down, then back to the top. */
  const sweep = async () => {
    const found = await cdp.evaluate(MEASURE(TAP_MIN), sessionId);
    const height = await cdp.evaluate(`document.documentElement.scrollHeight`, sessionId);
    const viewport = await cdp.evaluate(`window.innerHeight`, sessionId);
    const step = Math.max(Math.floor(viewport * 0.8), 200);
    for (let y = step; y < height; y += step) {
      await cdp.evaluate(`window.scrollTo(0, ${y});`, sessionId);
      await sleep(220);
      const more = await cdp.evaluate(MEASURE(TAP_MIN), sessionId);
      found.push(...more);
    }
    await cdp.evaluate(`window.scrollTo(0,0);`, sessionId);
    await sleep(220);
    return found;
  };

  try {
    /* ---------- logged out: the login screen ---------- */
    await cdp.evaluate(`window.location.href = '${DASHBOARD_URL}/#/';`, sessionId);
    await cdp.waitFor(`document.querySelector('#login-email') !== null || document.querySelector('.kpis') !== null`, sessionId, 25000);
    await sleep(1200);
    for (const theme of THEMES) {
      await setTheme(theme);
      await cdp.evaluate('window.location.reload();', sessionId);
      await cdp.waitFor(`document.querySelector('#login-email') !== null || document.querySelector('.kpis') !== null`, sessionId, 25000);
      await sleep(1200);
      for (const width of WIDTHS) {
        await setViewport(width, 844);
        await sleep(900);
        const defects = await sweep();
        results.push({ route: 'login', width, theme, defects });
        await shot(`login-${width}-${theme}.png`);
        console.log(`  ${results.length}  login @${width}/${theme}: ${defects.length}`);
      }
    }

    /* ---------- sign in ---------- */
    await cdp.evaluate(`
      (() => {
        const fill = (sel, value) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        fill('#login-email', ${JSON.stringify(ADMIN_EMAIL)});
        fill('#login-password', ${JSON.stringify(ADMIN_PASSWORD)});
        document.querySelector('.login-submit')?.click();
      })();
    `, sessionId);
    await cdp.waitFor(`document.querySelector('.kpis') !== null`, sessionId, 30000);
    console.log('signed in.');

    /* ---------- which adversarial routes exist ---------- */
    let routes = ROUTES;
    if (!ROUTES.some((r) => r.needs === 'adversarial')) routes = ROUTES;
    const hasAdversarial = await fetch(`${API_URL}/api/trips?limit=50`, {
      headers: { Authorization: `Bearer ${(await (await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
      })).json()).accessToken}` },
    }).then((r) => (r.ok ? r.json() : [])).then((trips) => trips.some((t) => t.id === 'ADV-TRIP-0001')).catch(() => false);
    if (!hasAdversarial) {
      console.log('  no adversarial trip found — falling back to the first real trip for detail routes');
      const real = await fetch(`${API_URL}/api/trips?limit=1`, {
        headers: { Authorization: `Bearer ${(await (await fetch(`${API_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
        })).json()).accessToken}` },
      }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
      const first = real[0] && real[0].id;
      if (!first) throw new Error('no trips at all; run the seed first');
      routes = routes.map((r) => (r.hash === '#/trips/ADV-TRIP-0001' ? { ...r, hash: `#/trips/${first}` } : r));
    }

    /* ---------- every route, every width, every theme ---------- */
    for (const theme of THEMES) {
      await setTheme(theme);
      await goto('#/', 2500);
      for (const width of WIDTHS) {
        await setViewport(width, 844);
        await sleep(600);
        for (const route of routes) {
          await goto(route.hash);
          const defects = await sweep();
          results.push({ route: route.name, width, theme, defects });
          await shot(`${route.name}-${width}-${theme}.png`);
          const worst = defects.filter((d) => d.kind === 'overlap' || d.kind === 'occluded' || d.kind === 'overflow').length;
          console.log(`  ${results.length}  ${route.name} @${width}/${theme}: ${defects.length} defects (${worst} layout)`);
        }
      }
    }

    const { markdown, total } = renderReport(results, {
      dashboardUrl: DASHBOARD_URL,
      widths: WIDTHS,
      themes: THEMES,
      routes: routes.length + 1,
      adminEmail: ADMIN_EMAIL,
      shots: SHOTS.replace(ROOT + '/', ''),
    });
    writeFileSync(OUT, markdown);
    console.log(`\n${total === 0 ? 'PASS' : 'FAIL'}: ${total} distinct defects → ${OUT}`);
    process.exitCode = total === 0 ? 0 : 1;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill();
    await sleep(1500);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may hold files briefly */ }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
