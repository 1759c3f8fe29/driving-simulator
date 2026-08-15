/**
 * probe-loop — boot headless and report whether the game loop (requestAnimationFrame)
 * is actually firing, plus document visibility. Diagnoses whether the
 * "FPS 0 / draw calls 0" probe-readout is a headless rAF-throttle artifact
 * rather than a game bug.
 *
 * Usage: node scripts/probe-loop.mjs [seconds-to-wait]
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WAIT_S = Number(process.argv[2] ?? 10);
const URL = `file://${resolve(process.cwd(), 'dist/index.html')}`;
const CHROME = process.env.CHROME_PATH ?? 'google-chrome';
const PORT = 9900 + (process.pid % 200);
const out = (l) => process.stdout.write(`${l}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'loop-chrome-'));
const chrome = spawn(CHROME, ['--headless', '--no-sandbox', '--disable-gpu-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage', '--allow-file-access-from-files', '--disable-web-security', '--hide-scrollbars', '--window-size=1280,720', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
chrome.stderr.resume();
process.on('exit', () => { try { chrome.kill('SIGKILL'); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} });

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
await send('Page.navigate', { url: URL });
await sleep(WAIT_S * 1000);

const { result } = await send('Runtime.evaluate', {
  expression: `(() => {
    // Install a rAF counter earlier? No — retroactively count via a fresh burst.
    let rafCount = 0;
    const start = performance.now();
    return new Promise((resolve) => {
      const tick = () => { rafCount++; if (performance.now() - start < 2000) requestAnimationFrame(tick); else resolve(); };
      requestAnimationFrame(tick);
    }).then(() => JSON.stringify({
      visibility: document.visibilityState,
      hidden: document.hidden,
      rafCountOver2s: rafCount,
      elapsedMs: Math.round(performance.now() - start),
      perfOverlay: (document.getElementById('perf-overlay')?.innerText || '').slice(0, 200),
    }, null, 2));
  })()`,
  returnByValue: true, awaitPromise: true,
}, 30000);
out('\n========== LOOP PROBE ==========');
out(result.value);
out('========== END ==========');
process.exit(0);
