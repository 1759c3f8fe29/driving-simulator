/**
 * smoke-run — headless boot check for the streamed city.
 *
 * Launches the built game in headless Chrome (SwiftShader, so it runs over SSH
 * with no GPU), streams the page's console to stdout as it happens, and reports
 * whether the game reached driving with chunks resident. Exists because tsc and
 * `vite build` cannot catch a boot that dies in WebGL, in Rapier, or on a 404 —
 * and not crashing on weak hardware is this project's whole point.
 *
 * Default target is dist/index.html over file://, because a sandboxed CI shell
 * may have no loopback networking for the browser at all — an http:// URL then
 * hangs in navigation forever and every probe reads as "renderer busy". file://
 * needs --allow-file-access-from-files and --disable-web-security, since ES
 * module scripts and the stylesheet are cross-origin from a null origin.
 *
 * Every devtools call is time-boxed: a renderer stuck in a long synchronous
 * block (FBX parse, wasm init) cannot answer Runtime.evaluate, and a naive await
 * there hangs the harness instead of reporting the stall.
 *
 * Once the game reaches driving it dispatches synthetic KeyboardEvents (W for
 * throttle, F10 for the perf overlay) so the run also exercises input, physics
 * and chunk streaming under motion rather than just proving the first frame drew.
 *
 * Usage: node scripts/smoke-run.mjs [url] [seconds-to-reach-driving]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const DEFAULT_URL = `file://${resolve(process.cwd(), 'dist/index.html')}`;
const URL_ARG = process.argv[2] ?? DEFAULT_URL;
/** Deadline for *reaching* driving; the drive observation runs after it. */
const BUDGET_MS = Number(process.argv[3] ?? 180) * 1000;
const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
const PORT = 9333 + (process.pid % 200);

const out = (line) => process.stdout.write(`${line}\n`);
const t0 = Date.now();
const stamp = () => `${String((Date.now() - t0) / 1000).padStart(6)}s`;

const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless',
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
    // file:// only: modules and CSS are cross-origin from a null origin.
    '--allow-file-access-from-files',
    '--disable-web-security',
    '--window-size=1280,720',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
chrome.stderr.resume();

function cleanup() {
  try {
    chrome.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on('exit', cleanup);
// A devtools call that never gets a reply must not abort the run — the whole
// point is to report what the page did, including hanging.
process.on('unhandledRejection', (err) => {
  out(`${stamp()} unhandled: ${err instanceof Error ? err.message : String(err)}`);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error(`Chrome devtools never came up on port ${PORT}`);
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('devtools websocket failed'));
});

let nextId = 1;
const waiting = new Map();
const state = { errors: [], failed: [], consoleLines: 0, sessionId: null };

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id !== undefined) {
    const p = waiting.get(msg.id);
    if (!p) return;
    waiting.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
    else p.res(msg.result);
    return;
  }
  handleEvent(msg);
};

/** Fire-and-report devtools call: never hangs the harness. */
function send(method, params = {}, { timeout = 10000, sessionId } = {}) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      rej(new Error(`${method} timed out after ${timeout}ms`));
    }, timeout);
    waiting.set(id, {
      res: (v) => {
        clearTimeout(timer);
        res(v);
      },
      rej: (e) => {
        clearTimeout(timer);
        rej(e);
      },
    });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

function handleEvent(e) {
  if (e.method === 'Runtime.consoleAPICalled') {
    const text = (e.params.args ?? [])
      .map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type)))
      .join(' ');
    state.consoleLines++;
    if (e.params.type === 'error') state.errors.push(text);
    // Boot chatter is the signal here; suppress nothing, the volume is low.
    out(`${stamp()} [${e.params.type}] ${text.slice(0, 300)}`);
  } else if (e.method === 'Runtime.exceptionThrown') {
    const d = e.params.exceptionDetails;
    const text = d.exception?.description ?? d.text;
    state.errors.push(text);
    out(`${stamp()} [EXCEPTION] ${String(text).slice(0, 600)}`);
  } else if (e.method === 'Log.entryAdded') {
    const entry = e.params.entry;
    if (entry.level === 'error') {
      state.errors.push(entry.text);
      out(`${stamp()} [log:error] ${entry.text.slice(0, 300)}`);
    }
  } else if (e.method === 'Network.responseReceived') {
    const r = e.params.response;
    if (r.status >= 400) {
      state.failed.push(`${r.status} ${r.url}`);
      out(`${stamp()} [HTTP ${r.status}] ${r.url}`);
    }
  } else if (e.method === 'Network.loadingFailed' && !e.params.canceled) {
    state.failed.push(e.params.errorText);
    out(`${stamp()} [NETFAIL] ${e.params.errorText}`);
  }
}

const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
state.sessionId = sessionId;
const S = (method, params, timeout) => send(method, params, { sessionId, timeout });

await S('Runtime.enable');
await S('Log.enable');
await S('Network.enable');
await S('Page.enable');

// The HUD is #hud, not a `.screen` — it never shows up in `.screen.visible`, and
// the speed digits live in `.speedo-digital`. Querying the wrong selectors made a
// healthy boot look like a dead one, so read the real HUD nodes: its visibility
// class, the digital speed, and the trip/odo chips that only move once the car is
// actually rolling on geometry.
const PROBE = `(() => {
  const g = window.__smoke ?? {};
  const loading = document.getElementById('loading-screen');
  const txt = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
  const hud = document.getElementById('hud');
  return JSON.stringify({
    loadingVisible: loading ? loading.classList.contains('visible') : null,
    loadingPercent: txt('.ls-percent'),
    loadingPhase: txt('.ls-phase'),
    loadingDetail: txt('.ls-detail'),
    visibleScreens: [...document.querySelectorAll('.screen.visible')].map(e => e.id),
    hudPresent: !!hud,
    hudVisible: hud ? hud.classList.contains('visible') : null,
    hudClass: hud ? hud.className : null,
    controlsPresent: !!document.querySelector('#mobile-controls, .mobile-controls, .mc-root'),
    canvases: document.querySelectorAll('canvas').length,
    fatal: !!document.querySelector('#ui-root h2'),
    fatalText: document.querySelector('#ui-root h2') ? (document.querySelector('#ui-root p')||{}).textContent : null,
    speedText: txt('.speedo-digital'),
    gearText: txt('.speedo-gear'),
    tripText: txt('.hud-trip'),
    odoText: txt('.hud-odo'),
    driveTimeText: txt('.hud-dtime'),
    perfText: txt('#perf-overlay'),
    // Throttle diagnostics. The RPM arc and needle move with engine revs even
    // when the car cannot physically move, so they separate "the key never
    // reached InputManager" from "input works but the car is stuck": rpm rising
    // with speed pinned at 0 means geometry, not input. warningsHtml catches the
    // headlight/handbrake glyphs, which prove the action bus is live.
    rpmOffset: (document.querySelector('.rpm-arc') || {getAttribute: () => null}).getAttribute('stroke-dashoffset'),
    needle: (() => { const n = document.querySelector('.needle'); return n ? n.getAttribute('transform') : null; })(),
    warningsHtml: (document.querySelector('.hud-warnings') || {innerHTML: null}).innerHTML,
    // The clock/weather chips are written on every HUD.update, so a template
    // placeholder ("--:--") here means the HUD is visible but never updated —
    // i.e. the loop is not in the 'driving' branch — while a real time proves
    // HUD.update runs and the zeros are genuinely a stationary car.
    clockText: txt('.hud-clock'),
    weatherText: txt('.hud-weather'),
    cameraText: txt('.hud-camera-indicator'),
    notifications: [...document.querySelectorAll('.notification')].map(e => e.textContent).slice(0, 4),
    probeExtra: g,
  });
})()`;

out(`${stamp()} navigating to ${URL_ARG}`);
// Not awaited: Page.navigate's reply can be stuck behind the renderer's own
// main thread once the page starts parsing a 17 MB FBX, and a rejected promise
// here would kill the run even though navigation did happen.
S('Page.navigate', { url: URL_ARG }, 120000).catch((err) => {
  out(`${stamp()} navigate reply never came (${err.message}) — continuing`);
});

let snap = null;
let booted = false;
let stalls = 0;
/** Set once the car has been observed to actually move under throttle. */
let drove = false;

while (Date.now() - t0 < BUDGET_MS) {
  await sleep(2000);
  try {
    // Generous: under SwiftShader a single frame can take seconds, and a probe
    // that loses the race says nothing about whether the game is healthy.
    const { result } = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true }, 20000);
    snap = JSON.parse(result.value);
    out(
      `${stamp()} loading=${snap.loadingVisible} ${snap.loadingPercent ?? ''} ${snap.loadingPhase ?? ''} | ${snap.loadingDetail ?? ''}`
    );
    if (snap.fatal) {
      out(`${stamp()} FATAL OVERLAY: ${snap.fatalText}`);
      break;
    }
    if (snap.loadingVisible === false && snap.canvases > 0) {
      booted = true;
      out(`${stamp()} loading screen gone, canvas live -> booted`);
      break;
    }
  } catch (err) {
    // The renderer is busy in a synchronous block; that is information, not an
    // error — report it and keep waiting.
    stalls++;
    out(`${stamp()} renderer busy (${err.message})`);
  }
}

// Synthetic driving. InputManager binds `keydown`/`keyup` on window and keys off
// `event.code`, so a dispatched KeyboardEvent is indistinguishable from a real
// one — which makes it the only way to prove from a headless run that the car
// actually moves on the streamed geometry instead of merely rendering.
const holdKey = (code) =>
  `window.dispatchEvent(new KeyboardEvent('keydown', {code: ${JSON.stringify(code)}, bubbles: true}))`;
const releaseKey = (code) =>
  `window.dispatchEvent(new KeyboardEvent('keyup', {code: ${JSON.stringify(code)}, bubbles: true}))`;

/**
 * Wall-clock length of the driving observation.
 *
 * Physics is fixed-step with `maxSubSteps: 4` at 1/120 s, so a frame can only
 * ever advance 33 ms of simulation no matter how long it took to render. Under
 * SwiftShader this page runs at 4-6 FPS (250 ms frames), which means simulated
 * time accrues at roughly 13-20% of real time: 25 s of watching buys ~3-5 s of
 * driving, not long enough for a 1450 kg car to register a full km/h. The window
 * is sized so the car gets tens of seconds of *simulated* driving even on a
 * software rasterizer — the whole question being asked here is whether it moves
 * at all, and a too-short window answers "no" for the wrong reason.
 */
const DRIVE_OBSERVE_MS = 120000;

if (booted) {
  // F10 opens PerformanceManager's debug overlay: FPS, frame time, draw calls
  // and live body/collider counts — the collider count is the direct readout of
  // whether chunk streaming is adding and removing physics as the car moves.
  try {
    await S('Runtime.evaluate', { expression: holdKey('F10'), returnByValue: true }, 15000);
  } catch (err) {
    out(`${stamp()} could not toggle perf overlay (${err.message})`);
  }

  out(`${stamp()} observing ${DRIVE_OBSERVE_MS / 1000}s of gameplay (throttle held down)...`);
  // Held-key sanity check before the drive, because the rpm gauge cannot answer
  // it: with the clutch engaged Engine.update derives target rpm from wheel
  // speed, so a car that cannot move sits at idle at any throttle. Space maps to
  // `handbrake`, which HUD reads straight out of InputManager's `pressed` set and
  // renders as a 🅿️ glyph — so the glyph proves a *held* synthetic key survives
  // in exactly the channel the throttle is read from. Generous timeouts: at 4 FPS
  // a devtools evaluate waits behind 250 ms frames.
  //
  // Poll rather than sleeping once: the HUD only repaints on a frame, and honest
  // frame times on a software rasterizer run 2500-3500 ms, so any fixed wait
  // short enough to be useful reads pre-press DOM and reports a false negative.
  try {
    await S('Runtime.evaluate', { expression: holdKey('Space'), returnByValue: true }, 30000);
    const heldUntil = Date.now() + 30000;
    let reached = false;
    let lastWarnings = '';
    while (Date.now() < heldUntil) {
      await sleep(1500);
      const { result } = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true }, 30000);
      const held = JSON.parse(result.value);
      lastWarnings = held.warningsHtml ?? '';
      if (lastWarnings.includes('Handbrake')) {
        reached = true;
        break;
      }
    }
    out(`${stamp()} held keys ${reached ? 'DO' : 'do NOT'} reach InputManager (warnings=${lastWarnings || 'empty'})`);
    await S('Runtime.evaluate', { expression: releaseKey('Space'), returnByValue: true }, 30000);
  } catch (err) {
    out(`${stamp()} held-key probe inconclusive (${err.message})`);
  }

  let maxSpeed = 0;
  let maxTrip = 0;
  const until = Date.now() + DRIVE_OBSERVE_MS;
  while (Date.now() < until) {
    // Re-press every tick rather than holding one keydown: InputManager wipes
    // `pressed` on window `blur`, which a headless page can fire on its own, and
    // a single press at the start would then silently stop applying throttle.
    // `repeat` stays false so the keydown is never filtered as an auto-repeat.
    try {
      await S('Runtime.evaluate', { expression: holdKey('KeyW'), returnByValue: true }, 30000);
    } catch {
      /* the probe below reports the consequence if it mattered */
    }
    await sleep(5000);
    try {
      const { result } = await S('Runtime.evaluate', { expression: PROBE, returnByValue: true }, 30000);
      snap = JSON.parse(result.value);
      maxSpeed = Math.max(maxSpeed, Number(snap.speedText) || 0);
      maxTrip = Math.max(maxTrip, parseFloat(snap.tripText) || 0);
      out(
        `${stamp()} hud=${snap.hudVisible} speed=${snap.speedText ?? '-'} gear=${snap.gearText ?? '-'} trip=${snap.tripText ?? '-'} time=${snap.driveTimeText ?? '-'}`
      );
      if (snap.perfText) out(`${stamp()}   ${snap.perfText.replace(/\n/g, ' | ')}`);
      if (snap.notifications?.length) out(`${stamp()}   notify: ${snap.notifications.join(' / ')}`);
    } catch (err) {
      stalls++;
      out(`${stamp()} renderer busy (${err.message})`);
    }
  }

  try {
    await S('Runtime.evaluate', { expression: releaseKey('KeyW'), returnByValue: true }, 30000);
  } catch {
    /* the run is over anyway */
  }
  out(`${stamp()} peak speed ${maxSpeed} km/h, trip ${maxTrip} km`);
  drove = maxSpeed > 0 || maxTrip > 0;
}

out('\n=== final snapshot ===');
out(JSON.stringify(snap, null, 2));
out(`\nconsole lines: ${state.consoleLines}  errors: ${state.errors.length}  failed requests: ${state.failed.length}  evaluate stalls: ${stalls}`);
if (state.errors.length) {
  out('\n=== errors ===');
  out([...new Set(state.errors)].slice(0, 20).join('\n'));
}
if (state.failed.length) {
  out('\n=== failed requests ===');
  out([...new Set(state.failed)].slice(0, 20).join('\n'));
}
out(booted ? 'RESULT: BOOTED' : 'RESULT: DID NOT BOOT');
// Movement is reported but does not gate the exit code: on a software rasterizer
// the fixed-step clamp means simulated time crawls, so "did not visibly move" is
// not by itself evidence of a broken build.
if (booted) out(drove ? 'DRIVING: car moved under throttle' : 'DRIVING: car did not register movement');

cleanup();
process.exit(booted && state.errors.length === 0 && state.failed.length === 0 ? 0 : 1);
