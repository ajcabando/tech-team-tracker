#!/usr/bin/env node
/**
 * Self-test for scripts/audit-mobile.mjs.
 *
 * An audit that reports zero defects is only meaningful if it can still fail.
 * This injects each bug the mobile layout is supposed to be free of — straight
 * back into the page as a stylesheet, with no rebuild — and asserts the audit's
 * detectors still fire. If a detector is accidentally weakened into silence,
 * this fails instead of the layout audit quietly passing forever.
 *
 * Usage:
 *   DASHBOARD_URL=http://localhost:5788 ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *     node scripts/audit-mobile-selftest.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5788';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const PORT = Number(process.env.CDP_PORT || 9336);
const ROUTE = process.env.SELFTEST_ROUTE || '#/technicians';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const findChrome = () => {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error('Chrome not found. Set CHROME_PATH.');
};

/**
 * Pull the whole `const MEASURE = …;` declaration out of the audit script,
 * verbatim — including the template literal, so the page can rebuild the exact
 * same detector rather than a re-implementation that could drift from it.
 */
function measureSource() {
  const src = readFileSync(join(ROOT, 'scripts', 'audit-mobile.mjs'), 'utf8');
  const START = 'const MEASURE = (minTap) => `';
  const END = '`;\n\nfunction groupKey';
  const from = src.indexOf(START);
  const to = src.indexOf(END);
  if (from < 0 || to < 0) throw new Error('could not locate MEASURE in audit-mobile.mjs');
  return src.slice(from, to + 2);
}

/**
 * Each case re-introduces one real historical bug as an injected stylesheet and
 * names the detector kind it must trip. `kind` accepts several because a broken
 * value usually shows up in more than one way — an unwrapped token in a narrow
 * flex sibling is reported both as `overflow` and as `overlap`, and either is a
 * correct catch. `route` is per-case because the bug needs the right host
 * element: a wide heading only exists on a detail page, a `cards-mobile` table
 * only on /devices.
 */
const CASES = [
  {
    name: 'topbar stuck under the sticky mobile header',
    route: '#/technicians',
    kind: ['occluded'],
    css: '.topbar{position:sticky!important;top:0!important;z-index:700!important;}',
  },
  {
    name: 'unbreakable heading widens the page past the viewport',
    route: '#/technicians/ADV-TECH-0001',
    kind: ['overflow'],
    css: 'h1,h2,.eyebrow{overflow-wrap:normal!important;}',
  },
  {
    name: 'no-wrap list row pushes its actions off-screen',
    route: '#/technicians',
    kind: ['overflow'],
    css: '.tech-row{flex-wrap:nowrap!important}.tech-row .row-actions{flex-shrink:0!important;width:auto!important;}',
  },
  {
    name: 'long unbroken value collides with its neighbour',
    route: '#/technicians',
    kind: ['overflow', 'overlap'],
    css: '.tech-info,.tech-row .row-actions{overflow-wrap:normal!important;}',
  },
  {
    name: 'wide content parked in a horizontal scroller',
    route: '#/devices',
    kind: ['scroll-clip'],
    css: '.cards-mobile .data-table tr{display:flex!important;width:900px}.cards-mobile .table-wrap{overflow-x:auto!important}',
  },
  {
    name: 'undersized tap targets',
    route: '#/technicians',
    kind: ['tap'],
    css: '.link{min-height:23px!important;min-width:auto!important;display:inline-block!important;}',
  },
  {
    name: 'two text runs forced onto the same pixels',
    route: '#/technicians',
    kind: ['overlap'],
    css: '.tech-info strong{position:absolute!important;left:120px!important;top:0!important;background:#fff!important;}',
  },
];

async function main() {
  const measureDecl = measureSource();
  const profile = mkdtempSync(join(tmpdir(), 'ttt-selftest-'));
  const chrome = spawn(findChrome(), [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--hide-scrollbars',
  ], { stdio: 'ignore' });

  console.log('waiting for chrome…');
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      if (res.ok) break;
    } catch { /* not ready */ }
    if (Date.now() > deadline) throw new Error('Chrome DevTools port never opened');
    await sleep(1000);
  }

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP connect timeout')), 20000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
    ws.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(e.message || 'refused')); });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message.result);
      pending.delete(message.id);
    }
  });
  const send = (method, params = {}, sessionId) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve) => pending.set(id, resolve));
  };
  const { sessionId } = await send('Target.attachToTarget', { targetId: page.id, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true }, sessionId);
    if (res.exceptionDetails) {
      const detail = res.exceptionDetails.exception?.description
        || res.exceptionDetails.exception?.value
        || res.exceptionDetails.text;
      throw new Error(`page exception: ${String(detail).split('\n')[0]}`);
    }
    return res.result?.value;
  };
  const waitFor = async (expression, timeoutMs = 25000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (await evaluate(expression)) return;
      if (Date.now() > deadline) throw new Error(`waitFor timeout: ${expression}`);
      await sleep(400);
    }
  };
  const setCss = async (css) => {
    await evaluate(`(() => {
      let style = document.getElementById('selftest');
      if (!style) { style = document.createElement('style'); style.id = 'selftest'; document.head.appendChild(style); }
      style.textContent = ${JSON.stringify(css)};
      return true;
    })()`);
  };

  try {
    /**
     * Rebuild the audit's own detector inside the page and run it mid-scroll.
     *
     * MEASURE(40) yields the *source* of an IIFE, so evaluating that source runs
     * the measurement and yields the defect list — there is no extra call to make.
     * Reusing the declaration verbatim means this self-test can never drift from
     * the detector it is validating.
     */
    const runDetector = `(() => {
      const MEASURE = new Function(${JSON.stringify(`${measureDecl}\nreturn MEASURE;`)})();
      const measureSource = MEASURE(${40});
      window.scrollTo(0, 600);
      const hits = new Function('return ' + measureSource)();
      window.scrollTo(0, 0);
      return hits.map((hit) => hit.kind);
    })()`;

    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }, sessionId);
    await evaluate(`window.location.href = ${JSON.stringify(`${DASHBOARD_URL}/${ROUTE}`)}`);
    await waitFor(`document.querySelector('#login-email') !== null || document.querySelector('.tech-row') !== null`);
    await evaluate(`(() => {
      const fill = (sel, value) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      };
      if (!fill('#login-email', ${JSON.stringify(ADMIN_EMAIL)})) return 'no-email-field';
      if (!fill('#login-password', ${JSON.stringify(ADMIN_PASSWORD)})) return 'no-password-field';
      document.querySelector('.login-submit')?.click();
      return 'submitted';
    })()`).then((status) => {
      if (status !== 'submitted') throw new Error(`login form not ready: ${status}`);
    });
    await waitFor(`document.querySelector('.mobile-header') !== null`);
    await sleep(1200);

    /** Navigate the SPA and wait for the route's own content to render. */
    const goTo = async (hash) => {
      await setCss('');
      await evaluate(`window.location.hash = ${JSON.stringify(hash)}`);
      await waitFor(`document.querySelector('.content') !== null`);
      await sleep(1400);
    };

    // Baseline: every route used below must be clean before injection, or the
    // assertions would pass for the wrong reason.
    const routes = [...new Set([ROUTE, ...CASES.map((c) => c.route)])];
    for (const route of routes) {
      await goTo(route);
      const dirty = await evaluate(runDetector);
      if (dirty.length > 0) {
        console.error(`  BASELINE DIRTY  ${route} reports ${dirty.length} defects before injection: ${[...new Set(dirty)].join(', ')}`);
        console.error('  Fix the layout first — otherwise these assertions are meaningless.');
        process.exitCode = 1;
        return;
      }
      console.log(`  baseline clean  ${route} @390px`);
    }
    console.log('');

    let pass = 0;
    let fail = 0;
    for (const testCase of CASES) {
      await goTo(testCase.route);
      await setCss(testCase.css);
      await sleep(500);
      const kinds = await evaluate(runDetector);
      const want = Array.isArray(testCase.kind) ? testCase.kind : [testCase.kind];
      const hit = want.filter((kind) => kinds.includes(kind));
      if (hit.length > 0) {
        pass += 1;
        console.log(`  detected  ${testCase.name}  →  ${hit.join('/')}`);
      } else {
        fail += 1;
        console.log(`  MISSED    ${testCase.name}  →  expected ${want.join('/')}, saw [${[...new Set(kinds)].join(', ')}]`);
      }
    }

    console.log(`\nself-test: ${pass} detected, ${fail} missed`);
    process.exitCode = fail === 0 ? 0 : 1;
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill();
    await sleep(1200);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may hold files */ }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
