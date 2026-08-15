/**
 * main.ts — Application entry point.
 */

import { Game } from './app/Game';

async function bootstrap(): Promise<void> {
  const game = new Game();
  try {
    await game.start();
  } catch (err) {
    console.error('[bootstrap] fatal', err);
    const root = document.getElementById('ui-root');
    if (root) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#0a0e14;color:#f2f5f9;font-family:system-ui;text-align:center;padding:20px;z-index:999';
      el.innerHTML = `<div><h2>Failed to start</h2><p style="color:#9aa5b5;margin-top:10px">${err instanceof Error ? err.message : String(err)}</p>
        <button onclick="location.reload()" style="margin-top:20px;padding:12px 28px;background:#2e9bff;border:none;border-radius:8px;color:#fff;font-size:15px;cursor:pointer">Reload</button></div>`;
      root.appendChild(el);
    }
  }
}

void bootstrap();
