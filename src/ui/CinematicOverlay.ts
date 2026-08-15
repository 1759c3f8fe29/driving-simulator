/**
 * CinematicOverlay — Pure DOM layer for cinematic sequences: intro swoop
 * letterboxing, title cards and fade-to-black transitions.
 *
 * Zero three.js and zero audio assets: everything is driven by eased inline
 * styles that the game updates every frame via update(dt). The overlay is
 * intentionally pointer-transparent so it never intercepts "skip on input".
 */

import { clamp, damp } from '../core/Config';

/** Letterbox bar height as a fraction of the current viewport height. */
const BAR_VH = 0.09;
/** Default ease-out durations (seconds) when callers omit the optional one. */
const TITLE_DEFAULT_SECONDS = 0.85;
const BAR_DEFAULT_SECONDS = 0.85;
const FADE_DEFAULT_SECONDS = 0.6;
/** Snap threshold for eased values so they settle exactly on target. */
const EPS = 0.0005;

export class CinematicOverlay {
  private el: HTMLElement;
  private topBar: HTMLElement;
  private bottomBar: HTMLElement;
  private fadeEl: HTMLElement;
  private titleEl: HTMLElement;
  private titleMain: HTMLElement;
  private titleSub: HTMLElement;
  private accent: HTMLElement;

  // Letterbox bars (pixels of height, 0..~9vh).
  private barHeightCurrent = 0;
  private barHeightTarget = 0;
  private barLambda = 3 / BAR_DEFAULT_SECONDS;

  // Title block opacity (0..1), plus its horizontal accent line.
  private titleCurrent = 0;
  private titleTarget = 0;
  private titleLambda = 3 / TITLE_DEFAULT_SECONDS;

  // Full-screen black fade opacity (0..1).
  private fadeCurrent = 0;
  private fadeTarget = 0;
  private fadeLambda = 3 / FADE_DEFAULT_SECONDS;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'cinematic-overlay';
    this.el.innerHTML = `
      <div class="cin-top-bar"></div>
      <div class="cin-bottom-bar"></div>
      <div class="cin-title">
        <div class="cin-title-main"></div>
        <div class="cin-accent"></div>
        <div class="cin-title-sub"></div>
      </div>
      <div class="cin-fade"></div>
    `;
    root.appendChild(this.el);

    this.topBar = this.el.querySelector('.cin-top-bar')!;
    this.bottomBar = this.el.querySelector('.cin-bottom-bar')!;
    this.fadeEl = this.el.querySelector('.cin-fade')!;
    this.titleEl = this.el.querySelector('.cin-title')!;
    this.titleMain = this.el.querySelector('.cin-title-main')!;
    this.titleSub = this.el.querySelector('.cin-title-sub')!;
    this.accent = this.el.querySelector('.cin-accent')!;

    // Hint the compositor: opacity/transform are animated every frame.
    this.topBar.style.willChange = 'height';
    this.bottomBar.style.willChange = 'height';
    this.fadeEl.style.willChange = 'opacity';
    this.titleEl.style.willChange = 'opacity, transform';
    this.accent.style.willChange = 'opacity, transform';
  }

  /** Reveal the overlay container (adds the 'visible' class). */
  show(): void {
    this.el.classList.add('visible');
  }

  /** Remove the overlay from the DOM entirely. */
  hide(): void {
    this.el.remove();
  }

  /** Per-frame easing of bar heights, title opacity and fade opacity. */
  update(dt: number): void {
    // Keep open bars glued to the viewport so a live resize never leaves gaps.
    if (this.barHeightTarget > 0) {
      this.barHeightTarget = window.innerHeight * BAR_VH;
    }
    this.barHeightCurrent = this.step(this.barHeightCurrent, this.barHeightTarget, this.barLambda, dt);
    this.topBar.style.height = `${this.barHeightCurrent.toFixed(2)}px`;
    this.bottomBar.style.height = `${this.barHeightCurrent.toFixed(2)}px`;

    // Title rises into place as it fades in; the accent line sweeps open with it.
    this.titleCurrent = this.step(this.titleCurrent, this.titleTarget, this.titleLambda, dt);
    this.titleEl.style.opacity = this.titleCurrent.toFixed(3);
    this.titleEl.style.transform = `translateY(${((1 - this.titleCurrent) * 16).toFixed(2)}px)`;
    const accentOpacity = clamp(this.titleCurrent * 1.25, 0, 1);
    this.accent.style.opacity = accentOpacity.toFixed(3);
    this.accent.style.transform = `scaleX(${(0.5 + 0.5 * this.titleCurrent).toFixed(3)})`;

    this.fadeCurrent = this.step(this.fadeCurrent, this.fadeTarget, this.fadeLambda, dt);
    this.fadeEl.style.opacity = this.fadeCurrent.toFixed(3);
  }

  /** Ease the full-screen fade to `alpha` (0..1) over `seconds`. */
  fadeTo(alpha: number, seconds: number): void {
    this.fadeTarget = clamp(alpha, 0, 1);
    this.fadeLambda = 3 / Math.max(0.001, seconds);
  }

  /** Set the title card text. Empty subtitle hides the subtitle line. */
  setTitle(title: string, subtitle: string): void {
    this.titleMain.textContent = title;
    this.titleSub.textContent = subtitle;
    this.titleSub.style.display = subtitle ? '' : 'none';
  }

  /** Fade the title card in (true) or out (false), optional ease duration. */
  setTitleVisible(visible: boolean, seconds?: number): void {
    this.titleTarget = visible ? 1 : 0;
    this.titleLambda = 3 / Math.max(0.001, seconds ?? TITLE_DEFAULT_SECONDS);
  }

  /** Open or close the letterbox bars, optional ease duration. */
  setLetterbox(open: boolean, seconds?: number): void {
    this.barHeightTarget = open ? window.innerHeight * BAR_VH : 0;
    this.barLambda = 3 / Math.max(0.001, seconds ?? BAR_DEFAULT_SECONDS);
  }

  /** Damp toward target and snap once visually settled. */
  private step(current: number, target: number, lambda: number, dt: number): number {
    const value = damp(current, target, lambda, dt);
    return Math.abs(value - target) < EPS ? target : value;
  }
}
