/**
 * shot — boot the built game in headless Chrome and save a PNG of the frame.
 *
 * The smoke harness proves the game *runs*; it cannot tell you the frame looks
 * like a city. This exists because every quality lever (render scale, shadows,
 * composer bypass, model decimation) is invisible to tsc, to the build, and to
 * the smoke run's DOM probes — the only way to catch "technically 60 draw calls,
 * visually mush" is to look at the pixels.
 *
 * Optional overrides are applied before boot by seeding the save's graphics
 * settings, so a single build can be photographed at several quality levels.
 *
 * Usage: node scripts/shot.mjs out.png [seconds-to-wait] [renderScale] [shadows]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.cwd(), process.argv[2] ?? 'shot.png');
const WAIT_MS = Number(process.argv[3] ?? 90) * 1000;
const RENDER_SCALE = process.argv[4] ? Number(process.argv[4]) : null;
const SHADOWS = process.argv[5] ? process.argv[5] === 'true' : null;
const URL = `file://${resolve(process.cwd(), 'dist/index.html')}`;
const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
const PORT = 9700 + (process.pid % 200);

const out = (l) => process.stdout.write(`${l}\n`);
const t0 = Date.now();
const stamp = () => `${String((Date.now() - t0) / 1000).padStart(6)}s`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'shot-chrome-'));
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
    '--allow-file-access-from-files',
    '--disable-web-security',
    '--hide-scrollbars',
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
    /* gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}
process.on('exit', cleanup);

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
  throw new Error('devtools never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error('devtools websocket failed'));
});

let nextId = 1;
const waiting = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === undefined) return;
  const p = waiting.get(msg.id);
  if (!p) return;
  waiting.delete(msg.id);
  if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
  else p.res(msg.result);
};

function raw(method, params = {}, sessionId, timeout = 60000) {
  const id = nextId++;
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      waiting.delete(id);
      rej(new Error(`${method} timed out`));
    }, timeout);
    waiting.set(id, {
      res: (v) => (clearTimeout(timer), res(v)),
      rej: (e) => (clearTimeout(timer), rej(e)),
    });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

// The URL from /json/version is the *browser* endpoint, which has no Page or
// Runtime domain — those live on a page target, so attach to one and route every
// later call through its flattened session.
const { targetInfos } = await raw('Target.getTargets');
const target = targetInfos.find((t) => t.type === 'page');
if (!target) throw new Error('no page target to attach to');
const { sessionId } = await raw('Target.attachToTarget', {
  targetId: target.targetId,
  flatten: true,
});
const send = (method, params, timeout) => raw(method, params, sessionId, timeout);

await send('Page.enable');
await send('Runtime.enable');

// Seed graphics settings before any app script runs. addScriptToEvaluateOnNewDocument
// fires ahead of the page's modules, which is the only window where localStorage
// can be written early enough for SaveManager to read it at construction.
if (RENDER_SCALE !== null || SHADOWS !== null) {
  const patch = {};
  if (RENDER_SCALE !== null) patch.renderScale = RENDER_SCALE;
  if (SHADOWS !== null) patch.shadows = SHADOWS;
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (() => {
        try {
          for (const k of Object.keys(localStorage)) {
            const raw = localStorage.getItem(k);
            if (!raw || raw[0] !== '{') continue;
            const save = JSON.parse(raw);
            if (!save || !save.settings || !save.settings.graphics) continue;
            Object.assign(save.settings.graphics, ${JSON.stringify(patch)});
            localStorage.setItem(k, JSON.stringify(save));
          }
        } catch (e) { /* first run has no save; defaults apply */ }
      })();
    `,
  });
  out(`${stamp()} seeding graphics ${JSON.stringify(patch)}`);
}

out(`${stamp()} navigating to ${URL}`);
await send('Page.navigate', { url: URL });

// Wait for the loading screen to go away, then let chunks settle.
const deadline = Date.now() + WAIT_MS;
let booted = false;
while (Date.now() < deadline) {
  await sleep(3000);
  try {
    const { result } = await send(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const l = document.getElementById('loading-screen');
          const hidden = !l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none';
          return JSON.stringify({hidden, detail: (document.getElementById('loading-detail')||{}).textContent || ''});
        })()`,
        returnByValue: true,
      },
      30000
    );
    const s = JSON.parse(result.value);
    if (s.hidden) {
      out(`${stamp()} loading screen gone (${s.detail})`);
      booted = true;
      break;
    }
  } catch (err) {
    out(`${stamp()} probe stalled (${err.message})`);
  }
}
if (!booted) out(`${stamp()} never finished loading — shooting anyway`);

// A few seconds of frames so streaming settles and the camera reaches its slot.
await sleep(12000);

const { data } = await send('Page.captureScreenshot', { format: 'png' }, 120000);
writeFileSync(OUT, Buffer.from(data, 'base64'));
out(`${stamp()} wrote ${OUT}`);
process.exit(0);
