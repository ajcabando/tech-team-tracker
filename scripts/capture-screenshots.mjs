#!/usr/bin/env node
/**
 * Capture README screenshots from a running stack with demo data.
 *
 * Prerequisites: docker stack up, `npm run seed` + `npm run seed:shots` done.
 * Output: docs/screenshots/*.png (desktop 1440x900 + mobile 390x844).
 *
 * Usage:
 *   DASHBOARD_URL=http://localhost:5796 node scripts/capture-screenshots.mjs
 *
 * Environment:
 *   DASHBOARD_URL   default http://localhost:5788
 *   ADMIN_EMAIL     default admin@example.com
 *   ADMIN_PASSWORD  default change-this-password
 *   CHROME_PATH     override the Chrome/Chromium binary
 *   CDP_PORT        default 9223
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'screenshots');
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:5788';
// Backend port follows the frontend port (5788->5789, 5796->5797); override directly.
const API_URL = process.env.API_URL || DASHBOARD_URL.replace(/:5796$/, ':5797').replace(/:5788$/, ':5789');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-this-password';
const PORT = Number(process.env.CDP_PORT || 9223);

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
      throw new Error(`Page exception: ${(result.exceptionDetails.text || 'unknown').split('\n')[0]}`);
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

async function main() {
  mkdirSync(OUT, { recursive: true });
  const profile = mkdtempSync(join(tmpdir(), 'ttt-shots-'));
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

  const targetsRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await targetsRes.json();
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

  const shot = async (name, viewport) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.dsf || 1,
      mobile: !!viewport.mobile,
    }, sessionId);
    await sleep(1200);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId);
    writeFileSync(join(OUT, name), Buffer.from(data, 'base64'));
    console.log(`  shot  ${name}`);
  };

  const desktop = { width: 1440, height: 900 };
  const mobile = { width: 390, height: 844, dsf: 2, mobile: true };

  const goto = async (hash) => {
    await cdp.evaluate(`window.location.hash = '${hash}';`, sessionId);
    await sleep(2500);
  };

  try {
    // 01 — login (logged out).
    await cdp.evaluate(`window.location.href = '${DASHBOARD_URL}/#/login';`, sessionId);
    await cdp.waitFor(`document.querySelector('#login-email') !== null`, sessionId);
    if (process.env.SHOT_THEME === 'light' || process.env.SHOT_THEME === 'dark') {
      await cdp.evaluate(`localStorage.setItem('tracker.theme', '${process.env.SHOT_THEME}'); window.location.reload();`, sessionId);
      await cdp.waitFor(`document.querySelector('#login-email') !== null`, sessionId);
      await sleep(1500);
    }
    await shot('01-login.png', desktop);

    // Sign in through the UI (native setter so React controlled inputs update).
    await cdp.evaluate(`
      (() => {
        const fill = (sel, value) => {
          const el = document.querySelector(sel);
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        fill('#login-email', '${ADMIN_EMAIL}');
        fill('#login-password', '${ADMIN_PASSWORD}');
        document.querySelector('.login-submit')?.click();
      })();
    `, sessionId);
    await cdp.waitFor(`document.querySelector('.kpis') !== null`, sessionId, 25000);

    // Trip id for detail/replay shots (same-origin API call in page context won't
    // carry the token, so resolve it via the backend directly).
    const loginRes = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    }).catch(() => null);
    let tripId = null;
    if (loginRes?.ok) {
      const { accessToken } = await loginRes.json();
      const tripsRes = await fetch(`${API_URL}/api/trips?limit=5`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (tripsRes.ok) {
        const trips = await tripsRes.json();
        tripId = trips.find((t) => t.endedAt)?.id ?? trips[0]?.id ?? null;
      }
    }

    // 02 — dashboard.
    await goto('#/');
    await shot('02-dashboard.png', desktop);

    // 03 — live map (scroll the map card into view).
    await cdp.evaluate(`document.querySelector('.map-card, .map')?.scrollIntoView({block:'center'});`, sessionId);
    await shot('03-live-map.png', desktop);
    await cdp.evaluate(`window.scrollTo(0,0);`, sessionId);

    // 04–06 — list pages.
    await goto('#/technicians');
    await shot('04-technicians.png', desktop);
    await goto('#/devices');
    await shot('05-devices.png', desktop);
    await goto('#/trips');
    await shot('06-trip-history.png', desktop);

    // 07–08 — trip detail + replay.
    if (tripId) {
      await goto(`#/trips/${tripId}`);
      await cdp.waitFor(`document.querySelector('.transport-play') !== null`, sessionId);
      await shot('07-trip-details.png', desktop);
      await cdp.evaluate(`document.querySelector('button[aria-label="Play replay"]')?.click();`, sessionId);
      await cdp.evaluate(`document.querySelector('.map-card, .map')?.scrollIntoView({block:'center'});`, sessionId);
      await sleep(12000);
      await shot('08-route-replay.png', desktop);
    } else {
      console.log('  skip  trip detail/replay (no trips found)');
    }

    // 09 — reports.
    await goto('#/reports');
    await shot('09-daily-report.png', desktop);

    // 10 — setup guide (hosts the phone illustrations).
    await goto('#/android-setup');
    await shot('10-setup-guide.png', desktop);

    // 11 — about (APK download card).
    await goto('#/about');
    await shot('11-about.png', desktop);

    // 12 — settings.
    await goto('#/settings');
    await shot('12-settings.png', desktop);

    // 13 — superadmin, Users tab (shows the Password reset action).
    await goto('#/superadmin');
    await cdp.evaluate(`[...document.querySelectorAll('.tab')].find(b=>b.textContent.includes('Users'))?.click();`, sessionId);
    await sleep(2000);
    await shot('13-superadmin.png', desktop);

    // Mobile set.
    await goto('#/');
    await shot('mobile-dashboard.png', mobile);
    await cdp.evaluate(`document.querySelector('.map-card, .map')?.scrollIntoView({block:'center'});`, sessionId);
    await shot('mobile-live-map.png', mobile);
    await goto('#/android-setup');
    await shot('mobile-setup-guide.png', mobile);

    console.log('done.');
  } finally {
    try { ws.close(); } catch { /* ignore */ }
    chrome.kill();
    await sleep(2000);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* chrome may hold files briefly */ }
    // Leave the scratch stack running for inspection; tear down manually.
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
