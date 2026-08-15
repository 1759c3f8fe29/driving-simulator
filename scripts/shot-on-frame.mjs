/**
 * shot-on-frame — capture a screenshot the instant the perf overlay populates
 * (proving a real frame just rendered), rather than after a fixed wait.
 *
 * In SwiftShader headless rAF fires ~1.6fps, so a fixed-delay capture often
 * lands between frames or mid-raster and produces a partial/frozen still. This
 * polls the overlay's "FPS" field for a non-zero value, then captures within
 * the same frame window.
 *
 * Usage: node scripts/shot-on-frame.mjs out.png [max-wait-seconds]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(process.cwd(), process.argv[2] ?? 'shot-on-frame.png');
const MAX_WAIT_S = Number(process.argv[3] ?? 120);
const URL = `file://${resolve(process.cwd(), 'dist/index.html')}`;
const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
const PORT = 9700 + (process.pid % 200);
const out = (l) => process.stdout.write(`${l}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'sof-chrome-'));
const t0 = Date.now();
const stamp = () => `${String((Date.now() - t0) / 1000).padStart(6)}s`;
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--disable-web-security', '--hide-scrollbars', '--window-size=1280,720', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.resume();
const cleanup = () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

async function wsUrl() {
  for (let i = 0; i < 80; i++) { try { const res = await fetch(`http://127.0.0.1:${PORT}/json/version`); const j = await res.json(); if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl; } catch {} await sleep(250); }
  throw new Error('devtools down');
}
const ws = new WebSocket(await wsUrl());
await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws')); });
let nextId = 1; const waiting = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === undefined) return; const p = waiting.get(m.id); if (!p) return; waiting.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); };
function raw(method, params = {}, sid, t = 60000) { const id = nextId++; return new Promise((res, rej) => { const tm = setTimeout(() => { waiting.delete(id); rej(new Error(`${method} timed out`)); }, t); waiting.set(id, { res: (v) => (clearTimeout(tm), res(v)), rej: (e) => (clearTimeout(tm), rej(e)) }); ws.send(JSON.stringify({ id, method, params, sessionId: sid })); }); }
const { targetInfos } = await raw('Target.getTargets');
const target = targetInfos.find((t) => t.type === 'page');
const { sessionId } = await raw('Target.attachToTarget', { targetId: target.targetId, flatten: true });
const send = (method, params, t) => raw(method, params, sessionId, t);
await send('Page.enable'); await send('Runtime.enable');
out(`${stamp()} navigating`);
await send('Page.navigate', { url: URL });

// Wait for the loading screen to clear.
const bootDeadline = Date.now() + 60000;
while (Date.now() < bootDeadline) {
  await sleep(2000);
  try {
    const { result } = await send('Runtime.evaluate', { expression: `(() => { const l = document.getElementById('loading-screen'); return JSON.stringify({ hidden: !l || l.classList.contains('hidden') || getComputedStyle(l).display === 'none' }); })()`, returnByValue: true }, 30000);
    if (JSON.parse(result.value).hidden) { out(`${stamp()} loading done`); break; }
  } catch {}
}

// Press F10 to turn the overlay on, then poll for a non-zero FPS readout.
await send('Input.dispatchKeyEvent', { type: 'keyDown', code: 'F10', windowsVirtualKeyCode: 121, key: 'F10' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', code: 'F10', windowsVirtualKeyCode: 121, key: 'F10' });
out(`${stamp()} F10 pressed — polling for a real frame`);

const pollDeadline = Date.now() + MAX_WAIT_S * 1000;
let overlayText = '';
while (Date.now() < pollDeadline) {
  await sleep(3000);
  try {
    const { result } = await send('Runtime.evaluate', {
      // captureScreenshot is called inside the page right after the overlay
      // refresh, so the still reflects the same frame the numbers describe.
      expression: `(() => {
        const fpsLine = document.querySelector('#perf-overlay');
        const t = fpsLine ? (fpsLine.innerText || fpsLine.textContent) : '';
        const m = (t.match(/FPS\\s+(\\d+)/) || [])[1];
        return JSON.stringify({ fps: m ? Number(m) : -1, text: t.slice(0, 120) });
      })()`,
      returnByValue: true,
    }, 30000);
    const s = JSON.parse(result.value);
    if (s.fps >= 1) { overlayText = s.text; out(`${stamp()} frame confirmed — ${s.text.split('\\n')[0]}`); break; }
  } catch {}
}
if (!overlayText) out(`${stamp()} no confirmed frame within ${MAX_WAIT_S}s`);

const { data } = await send('Page.captureScreenshot', { format: 'png' }, 120000);
writeFileSync(OUT, Buffer.from(data, 'base64'));
out(`${stamp()} wrote ${OUT}`);
process.exit(0);
