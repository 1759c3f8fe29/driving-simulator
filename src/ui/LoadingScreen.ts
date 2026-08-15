/**
 * LoadingScreen — Game boot screen: title, thin animated progress bar, phase
 * text, percent readout and a rotating tip line.
 *
 * Two rules drive the implementation:
 *  - the bar animates `transform: scaleX()` on a fill element (compositor only,
 *    no layout per update) instead of `width`;
 *  - every DOM write is guarded by a cached last-written value, so the streaming
 *    loader can call setProgress()/setPhase() once per chunk without touching
 *    the DOM when nothing actually changed.
 *
 * All new markup uses `ls-` classes plus a single id-guarded <style> element, so
 * the shared ui.css is untouched. The outer element keeps the old
 * `#loading-screen.screen` hooks for its background and 0.35s opacity fade.
 */

import { EventBus, Events } from '../core/EventBus';
import { LoadProgress } from '../core/AssetLoader';
import { clamp } from '../core/Config';

const TIPS = [
  'Manual transmission gives you far more control out of corners.',
  'Rain and snow cut tire grip — brake earlier than you think.',
  'The handbrake unsettles the rear: tap it to start a drift.',
  'Repair damage and fit upgrades in the Garage between drives.',
  'Press C to cycle camera views, H for high beams at night.',
  'Your progress and fuel save automatically while you drive.',
];

const TIP_INTERVAL_MS = 4000;
const FADE_MS = 350;
const STYLE_ID = 'ls-style';

const CSS = `
#loading-screen .ls-bar-track {
  position: relative;
  width: min(460px, 78vw); height: 4px;
  margin-top: 30px;
  background: rgba(255, 255, 255, 0.09);
  border-radius: 2px;
  overflow: hidden;
}
#loading-screen .ls-bar-fill {
  position: absolute; inset: 0;
  transform: scaleX(0);
  transform-origin: 0 50%;
  will-change: transform;
  transition: transform 0.28s cubic-bezier(0.22, 0.61, 0.36, 1);
  background: linear-gradient(90deg, var(--accent), #7cc4ff);
  box-shadow: 0 0 12px var(--accent-glow);
  border-radius: 2px;
}
#loading-screen .ls-bar-shine {
  position: absolute; top: 0; bottom: 0; left: 0;
  width: 34%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.5), transparent);
  will-change: transform;
  animation: ls-sweep 1.9s linear infinite;
}
@keyframes ls-sweep {
  from { transform: translate3d(-120%, 0, 0); }
  to   { transform: translate3d(400%, 0, 0); }
}
#loading-screen .ls-percent {
  font-family: var(--mono); font-variant-numeric: tabular-nums;
  font-size: 24px; margin-top: 16px; color: var(--accent);
  letter-spacing: 1px;
}
#loading-screen .ls-phase {
  color: var(--text); font-size: 12px; margin-top: 10px;
  letter-spacing: 1.6px; text-transform: uppercase;
}
#loading-screen .ls-detail {
  color: var(--text-dim); font-family: var(--mono); font-size: 11px;
  margin-top: 6px; letter-spacing: 0.6px; min-height: 14px;
}
#loading-screen .ls-tip {
  position: absolute; bottom: 44px; max-width: 500px; padding: 0 20px;
  text-align: center; color: var(--text-dim); font-size: 13px;
  transition: opacity 0.4s ease;
}
#loading-screen .ls-tip strong { color: var(--accent); }
@media (prefers-reduced-motion: reduce) {
  #loading-screen .ls-bar-shine { animation: none; opacity: 0.25; }
  #loading-screen .ls-bar-fill { transition: none; }
}
`;

/** Injects the loading-screen CSS once per document. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

export class LoadingScreen {
  private el: HTMLElement;
  private barFill: HTMLElement;
  private percentEl: HTMLElement;
  private phaseEl: HTMLElement;
  private detailEl: HTMLElement;
  private tipEl: HTMLElement;

  private tipIndex = Math.floor(Math.random() * TIPS.length);
  private tipTimer = 0;
  private hideTimer = 0;

  // Last written values — every setter early-returns when nothing changed.
  private lastPercent = -1;
  private lastPhase = '';
  private lastDetail = '';
  private lastTip = '';

  private hidden = false;
  private offProgress: (() => void) | null = null;

  constructor(root: HTMLElement) {
    ensureStyle();

    this.el = document.createElement('div');
    this.el.id = 'loading-screen';
    this.el.className = 'screen visible';
    this.el.innerHTML = `
      <h1 class="game-logo">APEX DRIVE</h1>
      <div class="game-subtitle">Open World Driving Simulator</div>
      <div class="ls-bar-track">
        <div class="ls-bar-fill"></div>
        <div class="ls-bar-shine"></div>
      </div>
      <div class="ls-percent">0%</div>
      <div class="ls-phase">Initializing</div>
      <div class="ls-detail"></div>
      <div class="ls-tip"><strong>Tip:</strong> <span></span></div>
    `;
    root.appendChild(this.el);

    const fill = this.el.querySelector<HTMLElement>('.ls-bar-fill');
    const percent = this.el.querySelector<HTMLElement>('.ls-percent');
    const phase = this.el.querySelector<HTMLElement>('.ls-phase');
    const detail = this.el.querySelector<HTMLElement>('.ls-detail');
    const tip = this.el.querySelector<HTMLElement>('.ls-tip span');
    if (!fill || !percent || !phase || !detail || !tip) {
      throw new Error('[LoadingScreen] template nodes missing');
    }
    this.barFill = fill;
    this.percentEl = percent;
    this.phaseEl = phase;
    this.detailEl = detail;
    this.tipEl = tip;

    this.lastPhase = 'Initializing';
    this.nextTip();
    this.startTipTimer();
    this.subscribe();
  }

  /**
   * Mirrors AssetLoader progress onto the *detail* line only.
   *
   * The percent and phase are owned by BootProgress, which weights every boot
   * stage; letting the asset loader also write them made the readout jump around
   * ("85% Fitting your car" then "33% Preparing vehicle") because the two sources
   * disagreed about what fraction of boot the car FBX represents.
   */
  private subscribe(): void {
    this.offProgress = EventBus.get().on(Events.LOAD_PROGRESS, (p: unknown) => {
      const prog = p as LoadProgress;
      this.setDetail(`${this.prettyAsset(prog.asset)} ${Math.round(clamp(prog.percent, 0, 100))}%`);
    });
  }

  private startTipTimer(): void {
    if (this.tipTimer !== 0) return;
    this.tipTimer = window.setInterval(() => this.nextTip(), TIP_INTERVAL_MS);
  }

  private stopTipTimer(): void {
    if (this.tipTimer === 0) return;
    window.clearInterval(this.tipTimer);
    this.tipTimer = 0;
  }

  private nextTip(): void {
    this.setTip(TIPS[this.tipIndex % TIPS.length]);
    this.tipIndex++;
  }

  private prettyAsset(key: string): string {
    const names: Record<string, string> = {
      city: 'Loading San Francisco',
      car: 'Preparing vehicle',
      engine_idle: 'Loading engine audio',
      engine_start: 'Loading engine audio',
    };
    return names[key] ?? `Loading ${key}`;
  }

  /**
   * Sets the bar and percent readout. `task`, when given, becomes the phase
   * line — this keeps the original two-argument call site working.
   */
  setProgress(percent: number, task?: string): void {
    const pct = Math.round(clamp(percent, 0, 100));
    if (pct !== this.lastPercent) {
      this.lastPercent = pct;
      // scaleX on a compositor-only property: no layout, no repaint of siblings.
      this.barFill.style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
      this.percentEl.textContent = `${pct}%`;
    }
    if (task !== undefined) this.setPhase(task);
  }

  /** Coarse stage label, e.g. 'Streaming city'. */
  setPhase(label: string): void {
    if (label === this.lastPhase) return;
    this.lastPhase = label;
    this.phaseEl.textContent = label;
  }

  /** Fine-grained line under the phase, e.g. 'Streaming city 42/96 chunks'. */
  setDetail(text: string): void {
    if (text === this.lastDetail) return;
    this.lastDetail = text;
    this.detailEl.textContent = text;
  }

  /** Replaces the rotating tip text; the 4s rotation keeps running. */
  setTip(text: string): void {
    if (text === this.lastTip) return;
    this.lastTip = text;
    this.tipEl.textContent = text;
  }

  /** Re-shows the screen (used when a reload path needs the boot screen back). */
  show(): void {
    if (this.hideTimer !== 0) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
    this.hidden = false;
    this.el.style.display = '';
    // Force a style flush so the opacity transition actually runs from 0.
    void this.el.offsetHeight;
    this.el.classList.add('visible');
    this.startTipTimer();
  }

  /** Fades out over ~350ms then removes the screen from layout. Idempotent. */
  hide(): void {
    if (this.hidden) return;
    this.hidden = true;
    this.stopTipTimer();
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.el.classList.remove('visible');
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = 0;
      this.el.style.display = 'none';
    }, FADE_MS);
  }

  /** Tears down timers, listeners and DOM. Safe to call more than once. */
  dispose(): void {
    this.stopTipTimer();
    if (this.hideTimer !== 0) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
    if (this.offProgress) {
      this.offProgress();
      this.offProgress = null;
    }
    this.hidden = true;
    this.el.remove();
  }
}
