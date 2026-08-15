/**
 * FXOverlay — Full-screen, pointer-transparent DOM layer that adds driving-feel
 * feedback on top of the 3D view: a red damage flash on collision, a persistent
 * red edge glow while health is low, and subtle speed streaks at high velocity.
 *
 * Zero three.js and zero assets: every layer is a CSS gradient div whose opacity
 * this class animates each frame via its own requestAnimationFrame loop. The
 * overlay never intercepts input (pointer-events: none) and is always mounted.
 */

import { CONFIG, clamp, damp } from '../core/Config';

/** Peak opacity of the low-health edge glow (spec: 0..~0.5). */
const DAMAGE_LOW_MAX = 0.5;
/** Peak opacity of the speed streaks (spec: 0..~0.35). */
const SPEEDLINES_MAX = 0.35;
/** Ease rate (1/s) for the low-health edge glow toward its target. */
const DAMAGE_LOW_LAMBDA = 4;
/** Ease rate (1/s) for the speed streaks toward their target. */
const SPEEDLINES_LAMBDA = 3;
/** Snap threshold for eased values so they settle exactly on target. */
const EPS = 0.001;
/** Upper bound on a single frame delta to avoid popping after a hidden tab. */
const MAX_DT = 0.1;

export class FXOverlay {
  private el: HTMLElement;
  private flashEl: HTMLElement;
  private lowEl: HTMLElement;
  private speedEl: HTMLElement;

  /** Damage-flash energy (0..1); decays to zero each frame. */
  private flash = 0;
  /** Low-health edge glow, current and target (0..1 before peak-opacity cap). */
  private lowCurrent = 0;
  private lowTarget = 0;
  /** Speed streaks, current and target (0..1 before peak-opacity cap). */
  private speedCurrent = 0;
  private speedTarget = 0;

  private rafId = 0;
  private lastTime = 0;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'fx-overlay';
    // Structural styles inline so the layer is functional before CSS lands.
    this.el.style.position = 'absolute';
    this.el.style.inset = '0';
    this.el.style.pointerEvents = 'none';
    this.el.style.zIndex = '30';

    this.flashEl = document.createElement('div');
    this.flashEl.className = 'fx-damage-flash';
    this.flashEl.style.opacity = '0';
    this.flashEl.style.willChange = 'opacity';

    this.lowEl = document.createElement('div');
    this.lowEl.className = 'fx-damage-low';
    this.lowEl.style.opacity = '0';
    this.lowEl.style.willChange = 'opacity';

    this.speedEl = document.createElement('div');
    this.speedEl.className = 'fx-speedlines';
    this.speedEl.style.opacity = '0';
    this.speedEl.style.willChange = 'opacity';

    this.el.append(this.flashEl, this.lowEl, this.speedEl);
    root.appendChild(this.el);

    // First frame reports dt=0 so eased values never jump on mount.
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Add damage energy (0..1) to the flash; the layer decays it out smoothly. */
  pulseDamage(intensity: number): void {
    this.flash = Math.min(1, this.flash + Math.max(0, intensity));
  }

  /**
   * Health ratio (0..1, 1 = fully damaged). The persistent edge glow fades in
   * once damage crosses ~40%.
   */
  setDamageRatio(r: number): void {
    this.lowTarget = clamp((r - 0.4) / 0.6, 0, 1);
  }

  /** Normalized speed (speed/280, 0..1). Streaks appear above ~45%. */
  setSpeedRatio(v: number): void {
    this.speedTarget = clamp((v - 0.45) / 0.55, 0, 1);
  }

  /** Stop the animation loop and remove the overlay from the DOM. */
  dispose(): void {
    cancelAnimationFrame(this.rafId);
    this.el.remove();
  }

  /** Per-frame decay/easing of the three layers, driven by performance.now(). */
  private tick = (): void => {
    const now = performance.now();
    const dt = this.lastTime === 0 ? 0 : Math.min((now - this.lastTime) / 1000, MAX_DT);
    this.lastTime = now;

    // Damage flash: decays to zero, scaled by the configured peak strength.
    this.flash = damp(this.flash, 0, CONFIG.cinematics.damagePulse.decay, dt);
    const flashOpacity = clamp(this.flash * CONFIG.cinematics.damagePulse.strength, 0, 1);
    this.flashEl.style.opacity = flashOpacity.toFixed(3);

    // Low-health edge glow eases toward its target, capped at ~50%.
    this.lowCurrent = this.ease(this.lowCurrent, this.lowTarget, DAMAGE_LOW_LAMBDA, dt);
    this.lowEl.style.opacity = (this.lowCurrent * DAMAGE_LOW_MAX).toFixed(3);

    // Speed streaks ease toward their target, capped at ~35%.
    this.speedCurrent = this.ease(this.speedCurrent, this.speedTarget, SPEEDLINES_LAMBDA, dt);
    this.speedEl.style.opacity = (this.speedCurrent * SPEEDLINES_MAX).toFixed(3);

    this.rafId = requestAnimationFrame(this.tick);
  };

  /** Damp toward target and snap once visually settled. */
  private ease(current: number, target: number, lambda: number, dt: number): number {
    const value = damp(current, target, lambda, dt);
    return Math.abs(value - target) < EPS ? target : value;
  }
}
