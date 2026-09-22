#!/usr/bin/env node
/**
 * Browser acceptance test for the dashboard.
 *
 * Drives a real headless Chrome over the DevTools Protocol and verifies:
 *   1. the login form signs in
 *   2. every sidebar entry navigates to the right page
 *   3. breadcrumbs reflect the current route
 *   4. the sidebar collapse/expand toggle works and persists
 *   5. deep links (#/trips) render directly
 *   6. a technician can be created and a pairing code generated through the UI
 *   7. removing a technician or device with GPS history is refused once, then confirmed
 *   8. no console errors, uncaught exceptions, or same-origin request failures
 *   9. no horizontal layout overflow at desktop (1440x900) and mobile (390x844)
 *
 * Usage:
 *   node scripts/e2e-browser.mjs
 *
 * Environment:
 *   DASHBOARD_URL   default http://localhost:5788
 *   ADMIN_EMAIL     default admin@example.com
 *   ADMIN_PASSWORD  default change-this-password
 *   CHROME_PATH     override the Chrome/Chromium binary
 *   CDP_PORT        default 9222
 *
 * Note: this test creates a technician (with a timestamped employee number) and a
 * pending device in the target database. Run it against a development stack.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5788';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const PORT = Number(process.env.CDP_PORT || 9222);
const RUN = Date.now().toString(36).toUpperCase();

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

/** Nav label -> page heading. */
const PAGES = [
  ['Live tracking', 'Live tracking'],
  ['Technicians', 'Technicians'],
  ['Devices', 'Devices'],
  ['Trips', 'Trip history'],
  ['Reports', 'Reports'],
  ['Alerts', 'Alerts'],
  ['Settings', 'Settings'],
  ['System admin', 'System administration'],
  ['About', 'About'],
];

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
};

/** Third-party hosts whose failures are not our bug (tiles, fonts, CDN). */
const THIRD_PARTY = ['tile.openstreetmap.org', 'openstreetmap.org', 'fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const failures = [];
const warnings = [];
function check(condition, label) {
  if (condition) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label}`);
    failures.push(label);
  }
}
function note(message) {
  console.log(`  warn ${message}`);
  warnings.push(message);
}

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate;
  throw new Error(`Chrome not found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

class Cdp {
  constructor(ws, onEvent) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) onEvent?.(message);
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
      const detail = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Page exception: ${String(detail).split('\n')[0]}`);
    }
    return result.result?.value;
  }

  async waitFor(expression, sessionId, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression, sessionId);
        if (last) return last;
      } catch {
        /* navigation in flight */
      }
      await sleep(120);
    }
    return last || false;
  }
}

/** Helpers injected into the page for React-compatible interaction. */
const DOM_HELPERS = `
  window.__t = {
    setInput(el, value) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    field(labelText) {
      return [...document.querySelectorAll('label')]
        .find((l) => l.textContent.trim().toLowerCase().startsWith(labelText.toLowerCase()));
    },
    /** Find an input by visible field label, aria-label, or placeholder. */
    findInput(name) {
      const label = window.__t.field(name);
      if (label) {
        const nested = label.querySelector('input, textarea, select');
        if (nested) return nested;
      }
      const lower = name.toLowerCase();
      return (
        [...document.querySelectorAll('input, textarea, select')].find(
          (el) => (el.getAttribute('aria-label') || '').toLowerCase() === lower || (el.placeholder || '').toLowerCase() === lower,
        ) || null
      );
    },
    setField(labelText, value) {
      const input = window.__t.findInput(labelText);
      if (!input) return 'missing:' + labelText;
      window.__t.setInput(input, value);
      return 'ok';
    },
    clickText(selector, text) {
      const el = [...document.querySelectorAll(selector)].find((n) => n.textContent.trim().toLowerCase().includes(text.toLowerCase()));
      if (!el) return 'missing:' + text;
      el.click();
      return 'clicked';
    },
    rowContaining(text) {
      const rows = '.tech-row, .trip-row, .device-row, table.data-table tbody tr';
      return [...document.querySelectorAll(rows)].find((r) => r.textContent.includes(text)) || null;
    },
    overflow() {
      return document.documentElement.scrollWidth - document.documentElement.clientWidth;
    },
    /**
     * Identify what is sticking out past the viewport, to make an overflow failure
     * actionable. Elements inside a deliberately scrollable strip (the phone navigation)
     * extend past the viewport on purpose, so they are not the culprit.
     */
    widest() {
      const limit = document.documentElement.clientWidth;
      const scrollableParent = (el) => {
        for (let node = el.parentElement; node; node = node.parentElement) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === 'auto' || overflowX === 'scroll') return true;
        }
        return false;
      };
      let worst = null;
      let worstRight = limit;
      for (const el of document.querySelectorAll('body *')) {
        if (scrollableParent(el)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.right > worstRight) {
          worstRight = rect.right;
          worst = el;
        }
      }
      if (!worst) return 'nothing extends past the viewport';
      const classes = (worst.className || '').toString().split(' ').filter(Boolean).slice(0, 2).join('.');
      const label = worst.tagName.toLowerCase() + (classes ? '.' + classes : '');
      return label + ' extends ' + Math.round(worstRight - limit) + 'px past the viewport';
    },
  };
  'ready'
`;

async function connect(wsUrl, onEvent) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener('open', () => resolve(new Cdp(ws, onEvent)));
    ws.addEventListener('error', () => reject(new Error(`Unable to connect to ${wsUrl}`)));
  });
}

async function waitForDevTools() {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error('Chrome DevTools endpoint did not become available');
}

async function main() {
  const chromePath = findChrome();
  const profile = mkdtempSync(join(tmpdir(), 'tracker-chrome-'));
  console.log(`Launching Chrome: ${chromePath}`);
  const chrome = spawn(
    chromePath,
    ['--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore' },
  );

  const consoleErrors = [];
  const exceptions = [];
  const failedRequests = [];
  const requestUrls = new Map();
  let context = 'startup';
  /**
   * The guarded-removal flow deliberately provokes a 409 so the operator can review what
   * history would be erased. That refusal is the expected outcome, not a runtime error, so
   * it is tolerated only while that section is running.
   */
  let expectingRefusal = false;

  const onEvent = (message) => {
    const { method, params } = message;
    if (method === 'Runtime.exceptionThrown') {
      const description = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'unknown exception';
      exceptions.push(`[${context}] ${description.split('\n')[0]}`);
    } else if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
      const text = (params.args || []).map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300);
      consoleErrors.push(`[${context}] ${text}`);
    } else if (method === 'Log.entryAdded' && params.entry?.level === 'error') {
      const entry = params.entry;
      const text = `${entry.text} ${entry.url || ''}`;
      if (THIRD_PARTY.some((host) => text.includes(host))) return;
      if (expectingRefusal && text.includes('409')) return;
      consoleErrors.push(`[${context}] ${entry.text}`);
    } else if (method === 'Network.requestWillBeSent') {
      requestUrls.set(params.requestId, params.request.url);
    } else if (method === 'Network.loadingFailed') {
      const url = requestUrls.get(params.requestId) || '';
      if (THIRD_PARTY.some((host) => url.includes(host))) return;
      // Closing the SSE stream on navigation is normal cleanup, not a failure.
      if (params.errorText === 'net::ERR_ABORTED' && url.includes('/api/dashboard/stream')) return;
      failedRequests.push(`[${context}] ${params.errorText} ${url}`);
    } else if (method === 'Network.responseReceived') {
      const url = params.response?.url || '';
      const status = params.response?.status ?? 0;
      if (THIRD_PARTY.some((host) => url.includes(host))) return;
      if (expectingRefusal && status === 409) return;
      if (status >= 400) failedRequests.push(`[${context}] HTTP ${status} ${url}`);
    }
  };

  let browser;
  let sessionId;
  try {
    browser = await connect(await waitForDevTools(), onEvent);
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true }));
    for (const domain of ['Page', 'Runtime', 'Log', 'Network']) await browser.send(`${domain}.enable`, {}, sessionId);

    const setViewport = async (viewport) => {
      await browser.send('Emulation.setDeviceMetricsOverride', viewport, sessionId);
      await sleep(200);
    };

    /** A full navigation discards injected helpers, so re-add them when missing. */
    const ensureHelpers = async () => {
      const present = await browser.evaluate(`typeof window.__t === 'object'`, sessionId).catch(() => false);
      if (!present) await browser.evaluate(DOM_HELPERS, sessionId);
    };

    const goto = async (url, readyExpression) => {
      await browser.send('Page.navigate', { url }, sessionId);
      const ready = await browser.waitFor(readyExpression, sessionId);
      await ensureHelpers();
      return ready;
    };

    /** Visit a page by clicking its sidebar entry and assert the heading. */
    const visit = async (label, heading) => {
      context = label;
      await ensureHelpers();
      const clicked = await browser.evaluate(
        `window.__t.clickText('aside nav a', ${JSON.stringify(label)})`,
        sessionId,
      );
      if (clicked !== 'clicked') return { ok: false, reason: `link ${clicked}` };
      const matched = await browser.waitFor(
        `document.querySelector('h1')?.textContent?.trim() === ${JSON.stringify(heading)}`,
        sessionId,
        8000,
      );
      const actual = await browser.evaluate(`document.querySelector('h1')?.textContent?.trim() || '(none)'`, sessionId);
      return { ok: Boolean(matched), actual };
    };

    // ---------------------------------------------------------------- 1. login
    console.log(`\n== 1. login (${DASHBOARD_URL}) ==`);
    context = 'login';
    check(await goto(DASHBOARD_URL, `document.readyState === 'complete' && !!document.querySelector('form input[type=email]')`), 'login form renders');
    check((await browser.evaluate(DOM_HELPERS, sessionId)) === 'ready', 'test helpers injected');

    const filled = await browser.evaluate(
      `(() => {
         const email = window.__t.setField('Email', ${JSON.stringify(ADMIN_EMAIL)});
         const password = window.__t.setField('Password', ${JSON.stringify(ADMIN_PASSWORD)});
         return email + '|' + password;
       })()`,
      sessionId,
    );
    check(filled === 'ok|ok', `login fields accept input (${filled})`);
    await browser.evaluate(`window.__t.clickText('form button', 'sign in')`, sessionId);
    check(await browser.waitFor(`!!document.querySelector('aside nav a')`, sessionId, 15000), 'sign-in succeeds and app shell renders');

    const navLabels = await browser.evaluate(
      `[...document.querySelectorAll('aside nav a')].map((a) => a.textContent.replace(/[^A-Za-z ]/g, '').trim())`,
      sessionId,
    );
    console.log(`  sidebar items: ${JSON.stringify(navLabels)}`);
    check(navLabels.length === PAGES.length, `sidebar shows ${PAGES.length} entries`);

    // ------------------------------------------------------------ 2. navigation
    console.log('\n== 2. sidebar navigation ==');
    const overflowByPage = [];
    for (const [label, heading] of PAGES) {
      const result = await visit(label, heading);
      check(result.ok, `${label} -> "${heading}"${result.ok ? '' : ` (saw "${result.actual}")`}`);
      const overflow = await browser.evaluate(
        `Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth)`,
        sessionId,
      );
      overflowByPage.push([label, overflow]);
      const crumb = await browser.evaluate(`document.querySelector('.breadcrumbs .crumb.current')?.textContent?.trim() || ''`, sessionId);
      if (!crumb) note(`${label}: breadcrumb missing`);
    }

    // ----------------------------------------------------------- 3. breadcrumbs
    console.log('\n== 3. breadcrumbs ==');
    await visit('Trips', 'Trip history');
    const crumbs = await browser.evaluate(
      `[...document.querySelectorAll('.breadcrumbs .crumb')].map((c) => c.textContent.trim())`,
      sessionId,
    );
    check(crumbs.length >= 2, `breadcrumb trail rendered: ${JSON.stringify(crumbs)}`);
    check(crumbs[0] === 'Dashboard', 'breadcrumb starts at Dashboard');
    check(crumbs[crumbs.length - 1] === 'Trips', 'breadcrumb ends at the current page');

    // ------------------------------------------------- 3b. settings server card
    console.log('\n== 3b. settings server status ==');
    await visit('Settings', 'Settings');
    const healthRendered = await browser.waitFor(
      `[...document.querySelectorAll('.kv')].some((row) => /ok/i.test(row.textContent))`,
      sessionId,
      8000,
    );
    check(healthRendered, 'server status card loads live health data');
    const healthText = await browser.evaluate(`[...document.querySelectorAll('.kv')].map((r) => r.textContent.trim()).join(' | ')`, sessionId);
    console.log(`  ${healthText.slice(0, 160)}`);

    // ------------------------------------------------------ 4. collapse toggle
    console.log('\n== 4. sidebar collapse toggle ==');
    const widthOf = () => browser.evaluate(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`, sessionId);
    const hasToggle = await browser.waitFor(`!!document.querySelector('.collapse-toggle')`, sessionId, 6000);
    check(hasToggle, 'collapse toggle is present');
    const expandedWidth = await widthOf();
    await browser.evaluate(`document.querySelector('.collapse-toggle').click()`, sessionId);
    check(await browser.waitFor(`document.querySelector('.app').classList.contains('sidebar-collapsed')`, sessionId, 4000), 'collapse applies the collapsed class');
    // The width animates, so wait for the transition before measuring.
    await sleep(600);
    const collapsedWidth = await widthOf();
    check(collapsedWidth < expandedWidth, `sidebar narrows (${expandedWidth}px -> ${collapsedWidth}px)`);
    check(
      await browser.evaluate(`getComputedStyle(document.querySelector('.nav-label')).display === 'none'`, sessionId),
      'labels hidden while collapsed',
    );
    await browser.evaluate(`window.location.reload()`, sessionId);
    await browser.waitFor(`!!document.querySelector('.collapse-toggle')`, sessionId, 10000);
    await ensureHelpers();
    check(
      await browser.evaluate(`document.querySelector('.app').classList.contains('sidebar-collapsed')`, sessionId),
      'collapsed state persists across reloads',
    );
    await browser.evaluate(`document.querySelector('.collapse-toggle').click()`, sessionId);
    check(
      await browser.waitFor(`!document.querySelector('.app').classList.contains('sidebar-collapsed')`, sessionId, 4000),
      'expands again',
    );

    // ------------------------------------------------------------ 5. deep link
    console.log('\n== 5. deep links ==');
    context = 'deep-link';
    await ensureHelpers();
    await browser.evaluate(`window.location.hash = '/trips'`, sessionId);
    check(await browser.waitFor(`document.querySelector('h1')?.textContent?.trim() === 'Trip history'`, sessionId, 8000), '#/trips renders trip history');
    await goto(`${DASHBOARD_URL}/#/reports`, `document.querySelector('h1')?.textContent?.trim() === 'Reports'`);
    check(
      await browser.evaluate(`document.querySelector('h1')?.textContent?.trim() === 'Reports'`, sessionId),
      'full reload on #/reports renders reports',
    );

    // ------------------------------------------------- 6. technician + pairing
    console.log('\n== 6. create technician and generate a pairing code ==');
    context = 'technician-flow';
    const employeeNumber = `E2E-UI-${RUN}`;
    const technicianName = `E2E UI Technician ${RUN}`;
    await visit('Technicians', 'Technicians');
    await ensureHelpers();
    check((await browser.evaluate(`window.__t.clickText('button', 'add technician')`, sessionId)) === 'clicked', '"Add technician" opens the form');
    await browser.waitFor(`window.__t.field('Full name') !== undefined`, sessionId, 5000);
    const nameSet = await browser.evaluate(`window.__t.setField('Full name', ${JSON.stringify(technicianName)})`, sessionId);
    const numberSet = await browser.evaluate(`window.__t.setField('Employee number', ${JSON.stringify(employeeNumber)})`, sessionId);
    check(nameSet === 'ok' && numberSet === 'ok', 'technician form fields accept input');
    await browser.evaluate(`window.__t.clickText('form button', 'create technician')`, sessionId);
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(technicianName)})`, sessionId, 12000),
      `technician ${employeeNumber} appears in the roster`,
    );

    const pairingOpened = await browser.evaluate(
      `(() => {
         const row = window.__t.rowContaining(${JSON.stringify(technicianName)});
         if (!row) return 'no-row';
         const button = [...row.querySelectorAll('button')].find((b) => /pair device/i.test(b.textContent));
         if (!button) return 'no-button';
         button.click();
         return 'clicked';
       })()`,
      sessionId,
    );
    check(pairingOpened === 'clicked', '"Pair device" opens the pairing dialog');
    await browser.evaluate(`window.__t.clickText('form button', 'generate pairing code')`, sessionId);
    const pairingCode = await browser.waitFor(`document.querySelector('.pairing-code strong')?.textContent?.trim() || ''`, sessionId, 12000);
    check(/^[0-9A-F]{4}-[0-9A-F]{4}$/.test(String(pairingCode)), `pairing code generated: ${pairingCode}`);
    await browser.evaluate(`window.__t.clickText('button', 'close')`, sessionId);

    // ------------------------------------------------- 6b. removal with history
    console.log('== 6b. remove a technician that has GPS history ==');
    context = 'removal-flow';
    expectingRefusal = true;
    const removalName = 'E2E Remove ' + RUN;
    const removalEmployee = 'E2E-RM-UI-' + RUN;

    const apiPost = async (path, body, token) =>
      fetch(DASHBOARD_URL + path, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(body),
      }).then((response) => response.json());

    const seededLogin = await apiPost('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    check(Boolean(seededLogin.accessToken), 'authenticated over HTTP to seed history');
    const seededTech = await apiPost('/api/technicians', { name: removalName, employeeNumber: removalEmployee }, seededLogin.accessToken);
    const seededPair = await apiPost('/api/devices/pairing-code', { technicianId: seededTech.id, deviceName: 'BROWSER-E2E-' + RUN }, seededLogin.accessToken);
    const seededDevice = await apiPost('/api/devices/pair', { code: seededPair.pairingCode, deviceUuid: seededPair.deviceUuid });
    const seededNow = Date.now();
    await apiPost(
      '/api/locations/batch',
      {
        points: [
          { id: crypto.randomUUID(), recordedAt: new Date(seededNow - 180000).toISOString(), latitude: 10.3157, longitude: 123.8854, speed: 12, accuracy: 5, battery: 70 },
          { id: crypto.randomUUID(), recordedAt: new Date(seededNow - 120000).toISOString(), latitude: 10.322, longitude: 123.893, speed: 14, accuracy: 5, battery: 69 },
        ],
      },
      seededDevice.deviceToken,
    );
    check(Boolean(seededTech.id) && Boolean(seededDevice.deviceToken), 'seeded a technician with real GPS history through the API');

    await browser.evaluate(`window.location.hash = '/technicians'`, sessionId);
    await browser.evaluate(`window.location.reload()`, sessionId);
    await browser.waitFor(`!!document.querySelector('h1')`, sessionId, 12000);
    await ensureHelpers();
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(removalName)})`, sessionId, 12000),
      'seeded technician appears in the roster',
    );

    const openedRemoval = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(removalName)}); if (!row) return 'no-row'; var buttons = [].slice.call(row.querySelectorAll('button')); var target = buttons.filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; if (!target) return 'no-button'; target.click(); return 'clicked'; })()`,
      sessionId,
    );
    check(openedRemoval === 'clicked', 'the row Remove action opens a confirmation dialog');
    const removalTitle = await browser.waitFor(`(document.querySelector('.modal h2') || {}).textContent || ''`, sessionId, 5000);
    check(String(removalTitle).trim() === 'Remove technician', 'dialog is titled Remove technician');

    await browser.evaluate(`window.__t.clickText('.modal button', 'remove')`, sessionId);
    check(await browser.waitFor(`!!document.querySelector('.danger-panel')`, sessionId, 10000), 'guarded refusal reveals the history warning instead of deleting');
    const warningText = await browser.evaluate(`(document.querySelector('.danger-panel') || {}).textContent || ''`, sessionId);
    check(warningText.indexOf('GPS point') >= 0, 'warning states how much history would be erased');

    await browser.evaluate(`window.__t.clickText('.modal button', 'erase history')`, sessionId);
    check(
      await browser.waitFor(`!window.__t.rowContaining(${JSON.stringify(removalName)})`, sessionId, 15000),
      'technician is removed after the operator confirms erasure',
    );

    // --------------------------------------------------- 6c. remove a device
    console.log('== 6c. remove a paired device that has GPS history ==');
    context = 'device-removal';
    const deviceLabel = 'E2E-DV-DEV-' + RUN;
    const owner = await apiPost('/api/technicians', { name: 'E2E DeviceOwner ' + RUN, employeeNumber: 'E2E-DV-UI-' + RUN }, seededLogin.accessToken);
    const ownerPair = await apiPost('/api/devices/pairing-code', { technicianId: owner.id, deviceName: deviceLabel }, seededLogin.accessToken);
    const ownerDevice = await apiPost('/api/devices/pair', { code: ownerPair.pairingCode, deviceUuid: ownerPair.deviceUuid });
    await apiPost(
      '/api/locations/batch',
      {
        points: [
          { id: crypto.randomUUID(), recordedAt: new Date(Date.now() - 200000).toISOString(), latitude: 10.317, longitude: 123.887, speed: 9, accuracy: 6, battery: 66 },
        ],
      },
      ownerDevice.deviceToken,
    );
    check(Boolean(ownerDevice.deviceToken), 'seeded a paired device with real GPS history');

    await goto(`${DASHBOARD_URL}/#/devices`, `document.querySelector('h1')?.textContent?.trim() === 'Devices'`);
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(deviceLabel)})`, sessionId, 12000),
      'seeded device appears in the device list',
    );

    const openedDeviceRemoval = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(deviceLabel)}); if (!row) return 'no-row'; var target = [].slice.call(row.querySelectorAll('button')).filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; if (!target) return 'no-button'; target.click(); return 'clicked'; })()`,
      sessionId,
    );
    check(openedDeviceRemoval === 'clicked', 'the device Remove action opens a confirmation dialog');
    const deviceDialog = await browser.waitFor(`(document.querySelector('.modal h2') || {}).textContent || ''`, sessionId, 5000);
    check(String(deviceDialog).trim() === 'Remove device', 'dialog is titled Remove device');

    await browser.evaluate(`window.__t.clickText('.modal button', 'remove')`, sessionId);
    check(await browser.waitFor(`!!document.querySelector('.danger-panel')`, sessionId, 10000), 'device removal is refused while its GPS history exists');
    await browser.evaluate(`window.__t.clickText('.modal button', 'erase history')`, sessionId);
    check(
      await browser.waitFor(`!window.__t.rowContaining(${JSON.stringify(deviceLabel)})`, sessionId, 15000),
      'device is removed after confirming erasure',
    );
    expectingRefusal = false;

    // Leave no test technicians behind.
    await fetch(`${DASHBOARD_URL}/api/technicians/${owner.id}?purge=true`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + seededLogin.accessToken },
    });

    // --------------------------------------------- 6d. remove an organization
    console.log('== 6d. remove an organization through the system admin console ==');
    context = 'organization-removal';
    expectingRefusal = true;

    const orgName = 'E2E Org ' + RUN;
    const org = await apiPost('/api/organizations', { name: orgName, slug: 'e2e-org-' + RUN.toLowerCase(), applicationName: 'E2E ORG TRACKER' }, seededLogin.accessToken);
    const orgTech = await apiPost('/api/technicians', { name: 'E2E Org Owner ' + RUN, employeeNumber: 'E2E-ORGT-' + RUN, organizationId: org.id }, seededLogin.accessToken);
    const orgPair = await apiPost('/api/devices/pairing-code', { technicianId: orgTech.id, deviceName: 'E2E-ORG-DEV-' + RUN }, seededLogin.accessToken);
    const orgDevice = await apiPost('/api/devices/pair', { code: orgPair.pairingCode, deviceUuid: orgPair.deviceUuid });
    await apiPost(
      '/api/locations/batch',
      {
        points: [{ id: crypto.randomUUID(), recordedAt: new Date(Date.now() - 90000).toISOString(), latitude: 10.33, longitude: 123.9, speed: 9, accuracy: 6, battery: 64 }],
      },
      orgDevice.deviceToken,
    );
    check(Boolean(org.id) && Boolean(orgDevice.deviceToken), 'seeded a second organization holding a technician and GPS history');

    await goto(`${DASHBOARD_URL}/#/superadmin`, `document.querySelector('h1')?.textContent?.trim() === 'System administration'`);
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(orgName)})`, sessionId, 12000),
      'seeded organization appears in the admin console',
    );

    const openedOrgRemoval = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(orgName)}); if (!row) return 'no-row'; var target = [].slice.call(row.querySelectorAll('button')).filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; if (!target) return 'no-button'; target.click(); return 'clicked'; })()`,
      sessionId,
    );
    check(openedOrgRemoval === 'clicked', 'the organization Remove action opens a confirmation dialog');
    const orgDialogTitle = await browser.waitFor(`(document.querySelector('.modal h2') || {}).textContent || ''`, sessionId, 5000);
    check(String(orgDialogTitle).trim() === 'Remove organization', 'dialog is titled Remove organization');

    await browser.evaluate(`window.__t.clickText('.modal button', 'remove')`, sessionId);
    check(await browser.waitFor(`!!document.querySelector('.danger-panel')`, sessionId, 10000), 'organization removal is refused while it still holds data');
    const orgWarning = await browser.evaluate(`(document.querySelector('.danger-panel') || {}).textContent || ''`, sessionId);
    check(orgWarning.indexOf('GPS point') >= 0 && orgWarning.indexOf('technician') >= 0, 'warning names the GPS points and technicians that would be erased');

    await browser.evaluate(`window.__t.clickText('.modal button', 'erase everything')`, sessionId);
    check(
      await browser.waitFor(`!window.__t.rowContaining(${JSON.stringify(orgName)})`, sessionId, 15000),
      'organization is removed after the operator confirms erasure',
    );
    check(
      await browser.waitFor(`document.body.textContent.includes('Your organization')`, sessionId, 5000),
      'the signed-in organization is marked as not removable',
    );

    // An organization with nothing in it removes in a single step, with no second prompt.
    expectingRefusal = false;
    const emptyOrgName = 'E2E Empty Org ' + RUN;
    await apiPost('/api/organizations', { name: emptyOrgName, slug: 'e2e-empty-' + RUN.toLowerCase() }, seededLogin.accessToken);
    await goto(`${DASHBOARD_URL}/#/superadmin`, `document.querySelector('h1')?.textContent?.trim() === 'System administration'`);
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(emptyOrgName)})`, sessionId, 12000),
      'empty organization appears in the admin console',
    );
    const emptyRemoval = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(emptyOrgName)}); if (!row) return 'no-row'; var target = [].slice.call(row.querySelectorAll('button')).filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; if (!target) return 'no-button'; target.click(); return 'clicked'; })()`,
      sessionId,
    );
    check(emptyRemoval === 'clicked', 'the empty organization offers the same Remove action');
    await browser.evaluate(`window.__t.clickText('.modal button', 'remove')`, sessionId);
    check(
      await browser.waitFor(`!window.__t.rowContaining(${JSON.stringify(emptyOrgName)})`, sessionId, 15000),
      'empty organization removes in one step',
    );

    // ------------------------------------------- 6e. remove a user account
    console.log('== 6e. remove a management account from the system admin console ==');
    context = 'account-removal';
    const accountEmail = 'e2e-ui-' + RUN.toLowerCase() + '@example.com';
    const account = await apiPost(
      '/api/users',
      { name: 'E2E Account ' + RUN, email: accountEmail, password: 'e2e-temporary-password', role: 'DISPATCHER' },
      seededLogin.accessToken,
    );
    check(Boolean(account.id), 'seeded a dispatcher account');

    await goto(`${DASHBOARD_URL}/#/superadmin`, `document.querySelector('h1')?.textContent?.trim() === 'System administration'`);
    await browser.evaluate(`window.__t.clickText('.tabs button', 'Users')`, sessionId);
    check(
      await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify(accountEmail)})`, sessionId, 12000),
      'the account appears in the users table',
    );

    const openedAccountRemoval = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(accountEmail)}); if (!row) return 'no-row'; var target = [].slice.call(row.querySelectorAll('button')).filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; if (!target) return 'no-button'; target.click(); return 'clicked'; })()`,
      sessionId,
    );
    check(openedAccountRemoval === 'clicked', 'the account Remove action opens a confirmation dialog');
    const accountDialogTitle = await browser.waitFor(`(document.querySelector('.modal h2') || {}).textContent || ''`, sessionId, 5000);
    check(String(accountDialogTitle).trim() === 'Remove account', 'dialog is titled Remove account');
    await browser.evaluate(`window.__t.clickText('.modal button', 'remove')`, sessionId);
    check(
      await browser.waitFor(`!window.__t.rowContaining(${JSON.stringify(accountEmail)})`, sessionId, 15000),
      'the account is removed from the console',
    );
    const ownRow = await browser.evaluate(
      `(function () { var row = window.__t.rowContaining(${JSON.stringify(ADMIN_EMAIL)}); if (!row) return 'no-row'; var button = [].slice.call(row.querySelectorAll('button')).filter(function (b) { return b.textContent.toLowerCase().indexOf('remove') >= 0; })[0]; return button ? 'removable' : 'protected'; })()`,
      sessionId,
    );
    check(ownRow === 'protected', `your own account is not offered for removal (${ownRow})`);

    // ------------------------------------------------------ 7. desktop overflow
    console.log('\n== 7. layout: desktop 1440x900 ==');
    await setViewport(VIEWPORTS.desktop);
    await ensureHelpers();
    for (const [label, heading] of PAGES) {
      await visit(label, heading);
      const overflow = await browser.evaluate(`window.__t.overflow()`, sessionId);
      const culprit = overflow > 1 ? await browser.evaluate(`window.__t.widest()`, sessionId) : '';
      check(overflow <= 1, `${label}: no horizontal overflow (${overflow}px)${culprit ? ` -> ${culprit}` : ''}`);
    }

    // ------------------------------------------------------- 8. mobile overflow
    console.log('\n== 8. layout: mobile 390x844 ==');
    await setViewport(VIEWPORTS.mobile);
    await ensureHelpers();
    for (const [label, heading] of PAGES) {
      await visit(label, heading);
      const overflow = await browser.evaluate(`window.__t.overflow()`, sessionId);
      const culprit = overflow > 1 ? await browser.evaluate(`window.__t.widest()`, sessionId) : '';
      check(overflow <= 1, `${label}: no horizontal overflow (${overflow}px)${culprit ? ` -> ${culprit}` : ''}`);
    }
    // A row with the widest realistic content (long name, phone, device, all four actions)
    // must still fit a phone screen. Data-dependent overflow showed up here before.
    const worstCase = await apiPost(
      '/api/technicians',
      { name: 'E2E Long Technician Name ' + RUN, employeeNumber: 'E2E-WIDE-' + RUN, phone: '+63 917 555 0123' },
      seededLogin.accessToken,
    );
    const widePair = await apiPost('/api/devices/pairing-code', { technicianId: worstCase.id, deviceName: 'E2E-WIDE-DEV-' + RUN }, seededLogin.accessToken);
    await apiPost('/api/devices/pair', { code: widePair.pairingCode, deviceUuid: widePair.deviceUuid });
    await goto(`${DASHBOARD_URL}/#/technicians`, `document.querySelector('h1')?.textContent?.trim() === 'Technicians'`);
    check(await browser.waitFor(`!!window.__t.rowContaining(${JSON.stringify('E2E-WIDE-' + RUN)})`, sessionId, 12000), 'worst-case technician row renders');
    const wideOverflow = await browser.evaluate(`window.__t.overflow()`, sessionId);
    const wideCulprit = wideOverflow > 1 ? await browser.evaluate(`window.__t.widest()`, sessionId) : '';
    check(wideOverflow <= 1, `worst-case technician row fits a phone (${wideOverflow}px)${wideCulprit ? ` -> ${wideCulprit}` : ''}`);
    await fetch(`${DASHBOARD_URL}/api/technicians/${worstCase.id}?purge=true`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + seededLogin.accessToken },
    });

    const sidebarWidth = await browser.evaluate(`Math.round(document.querySelector('aside.sidebar').getBoundingClientRect().width)`, sessionId);
    check(sidebarWidth <= 400, `mobile sidebar is full width and stacked (${sidebarWidth}px)`);

    // ------------------------------------------------- 9. errors and exceptions
    console.log('\n== 9. runtime health ==');
    console.log(`  console errors: ${consoleErrors.length}, exceptions: ${exceptions.length}, failed requests: ${failedRequests.length}`);
    check(exceptions.length === 0, `no uncaught page exceptions${exceptions.length ? ` -> ${exceptions.slice(0, 3).join(' | ')}` : ''}`);
    check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? ` -> ${consoleErrors.slice(0, 3).join(' | ')}` : ''}`);
    check(failedRequests.length === 0, `no same-origin request failures${failedRequests.length ? ` -> ${failedRequests.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    try {
      await browser?.send('Browser.close');
    } catch {
      /* ignore */
    }
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

main()
  .then(() => {
    console.log('');
    if (failures.length) {
      console.error(`Browser acceptance test FAILED (${failures.length}):\n  - ${failures.join('\n  - ')}`);
      process.exit(1);
    }
    console.log(
      'Browser acceptance test passed: login, navigation, breadcrumbs, collapse, deep links, technician + pairing flow, guarded device/technician removal, runtime health, and responsive layout.',
    );
  })
  .catch((error) => {
    console.error('Browser test error:', error.message);
    process.exit(1);
  });
