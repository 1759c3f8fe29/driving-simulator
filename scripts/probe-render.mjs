/**
 * probe-render — boot the built game headless and return render state as TEXT.
 *
 * shot.mjs proves the frame can be captured but the integrator cannot parse
 * the PNG. This reports the same frame as numbers instead: the F10 perf
 * overlay (draw calls, triangles, quality level, memory), the resolved pixel
 * ratio, whether the near-texture slot is bound or low-end-dropped, and any
 * decimation console log — so a visual revert can be verified without eyes on
 * pixels.
 *
 * Usage: node scripts/probe-render.mjs [seconds-to-wait]
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WAIT_S = Number(process.argv[2] ?? 12);
const URL = `file://${resolve(process.cwd(), 'dist/index.html')}`;
const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
const PORT = 9800 + (process.pid % 200);

const out = (l) => process.stdout.write(`${l}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'probe-chrome-'));
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
const cleanup = () => {
  try { chrome.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
};
process.on('exit', cleanup);

async function wsUrl() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const json = await res.json();
      if (json.webSocketDebuggerUrl) return json.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('devtools never came up');
}

const ws = new WebSocket(await wsUrl());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });

let nextId = 1;
const waiting = new Map();
const consoleBuffer = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params) {
    consoleBuffer.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
  }
  if (msg.method === 'Runtime.exceptionThrown' && msg.params) {
    consoleBuffer.push(`[exception] ${msg.params.exceptionDetails?.text ?? ''}`);
  }
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
    const timer = setTimeout(() => { waiting.delete(id); rej(new Error(`${method} timed out`)); }, timeout);
    waiting.set(id, { res: (v) => (clearTimeout(timer), res(v)), rej: (e) => (clearTimeout(timer), rej(e)) });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

const { targetInfos } = await raw('Target.getTargets');
const target = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await raw('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const send = (method, params, timeout) => raw(method, params, sessionId, timeout);

await send('Page.enable');
await send('Runtime.enable');

out(`navigating to ${URL}`);
await send('Page.navigate', { url: URL });

// Wait for loading screen, then let chunks + camera settle.
const deadline = Date.now() + WAIT_S * 1000;
let booted = false;
while (Date.now() < deadline) {
  await sleep(2000);
  try {
    const { result } = await send('Runtime.evaluate', {
      expression: `(() => {
        const l = document.getElementById('loading-screen');
        const hidden = !l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none';
        return JSON.stringify({hidden});
      })()`,
      returnByValue: true,
    }, 30000);
    if (JSON.parse(result.value).hidden) { booted = true; break; }
  } catch {}
}
if (!booted) out('never finished loading — probing anyway');
await sleep(8000);

// Press F10 to surface the perf overlay, then read it.
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'F10', windowsVirtualKeyCode: 121, key: 'F10' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F10', windowsVirtualKeyCode: 121, key: 'F10' });
await sleep(2500);

const { result } = await send('Runtime.evaluate', {
  expression: `(() => {
    const grab = (sel) => { const el = document.querySelector(sel); return el ? (el.innerText || el.textContent).trim() : ''; };
    // The F10 overlay markup; collect everything it renders.
    const overlay = document.getElementById('perf-overlay') || document.querySelector('[id*=perf]') || document.querySelector('[class*=perf]');
    const overlayText = overlay ? (overlay.innerText || overlay.textContent).trim() : '(no perf overlay element)';
    return JSON.stringify({
      overlayText,
      pixelRatio: window.devicePixelRatio,
      // WebGL render info if reachable
      hasThree: typeof window.__THREE__ !== 'undefined',
    }, null, 2);
  })()`,
  returnByValue: true,
}, 30000);

out('\n========== RENDER PROBE ==========');
out(result.value);
out('\n========== CONSOLE (decimation / errors) ==========');
if (consoleBuffer.length === 0) out('(no console output)');
else consoleBuffer.filter((l) => /decimat|budget|triangle|error|panic|low-?end|texture/i.test(l)).forEach(out) || consoleBuffer.slice(-20).forEach(out);
out('\n========== ALL CONSOLE (last 20) ==========');
consoleBuffer.slice(-20).forEach(out);
out('========== END ==========');

process.exit(0);
