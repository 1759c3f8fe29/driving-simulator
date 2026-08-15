/**
 * BootFlow — Boot decision logic and weighted loading-screen progress.
 *
 * The game opens straight into driving on this hardware: no main menu, no
 * cinematic swoop. This module owns (a) that decision, expressed as a plain
 * data object the caller acts on, and (b) a monotonic progress reporter for the
 * loading screen so the percentage never jumps backwards while chunks stream.
 *
 * Deliberately free of THREE, DOM and Game internals so it can be wired from
 * anywhere and reasoned about on its own.
 */

import { CONFIG, clamp } from '../core/Config';

export type BootPhase =
  | 'init'
  | 'assets'
  | 'manifest'
  | 'textures'
  | 'chunks'
  | 'physics'
  | 'vehicle'
  | 'ready';

export interface BootPhaseInfo {
  phase: BootPhase;
  label: string;
  weight: number;
}

/**
 * Ordered boot phases; weights sum to exactly 1.
 *
 * The order here must match the real sequence in `Game.start()`, because
 * `BootProgress` is monotonic in both percent and label: a phase begun out of
 * order cannot move the bar backwards, so it silently strands the label on a
 * later phase's text while earlier work is still running. `assets` covers the
 * runtime manifest (car FBX + engine audio), which loads before the city.
 */
export const BOOT_PHASES: BootPhaseInfo[] = [
  { phase: 'init', label: 'Starting engine', weight: 0.03 },
  { phase: 'assets', label: 'Loading car and audio', weight: 0.12 },
  { phase: 'manifest', label: 'Reading city manifest', weight: 0.03 },
  { phase: 'textures', label: 'Loading city textures', weight: 0.22 },
  { phase: 'chunks', label: 'Streaming city', weight: 0.42 },
  { phase: 'physics', label: 'Preparing physics', weight: 0.05 },
  { phase: 'vehicle', label: 'Fitting your car', weight: 0.1 },
  { phase: 'ready', label: 'Hitting the road', weight: 0.03 },
];

/** Player-facing text for a phase. */
export function bootPhaseLabel(phase: BootPhase): string {
  for (let i = 0; i < BOOT_PHASES.length; i++) {
    if (BOOT_PHASES[i].phase === phase) return BOOT_PHASES[i].label;
  }
  return 'Loading';
}

/** Cumulative start fraction (0..1) of each phase, index-aligned to BOOT_PHASES. */
const PHASE_START: number[] = (() => {
  const starts: number[] = [];
  let acc = 0;
  for (let i = 0; i < BOOT_PHASES.length; i++) {
    starts.push(acc);
    acc += BOOT_PHASES[i].weight;
  }
  return starts;
})();

function phaseIndex(phase: BootPhase): number {
  for (let i = 0; i < BOOT_PHASES.length; i++) {
    if (BOOT_PHASES[i].phase === phase) return i;
  }
  return 0;
}

export class BootProgress {
  private readonly onProgress: (percent: number, label: string) => void;
  /** Monotonic 0..100, unrounded. */
  private value = 0;
  /** Label of the furthest phase reached so far. */
  private label = BOOT_PHASES[0].label;
  /** Furthest phase index reached; stops labels regressing on out-of-order calls. */
  private furthest = -1;
  /** Last values handed to the callback; -1 makes the first report always fire. */
  private emittedPercent = -1;
  private emittedLabel = '';

  constructor(onProgress: (percent: number, label: string) => void) {
    this.onProgress = onProgress;
  }

  /** Enter a phase: label switches, percent snaps up to the phase start. */
  begin(phase: BootPhase): void {
    this.advance(phase, 0);
  }

  /** Report progress inside a phase; `fraction` is 0..1 and clamped. */
  advance(phase: BootPhase, fraction: number): void {
    const i = phaseIndex(phase);
    const target = (PHASE_START[i] + BOOT_PHASES[i].weight * clamp(fraction, 0, 1)) * 100;
    if (target > this.value) this.value = target;
    if (i >= this.furthest) {
      this.furthest = i;
      this.label = BOOT_PHASES[i].label;
    }
    this.emit();
  }

  /** Mark a phase fully done. */
  complete(phase: BootPhase): void {
    this.advance(phase, 1);
  }

  /** Clamp to 100 with the final phase label. */
  finish(): void {
    this.value = 100;
    this.furthest = BOOT_PHASES.length - 1;
    this.label = BOOT_PHASES[BOOT_PHASES.length - 1].label;
    this.emit();
  }

  /** Whole-percent progress as shown to the player. */
  get percent(): number {
    return Math.round(this.value);
  }

  /** Report only when the player-visible values actually changed (DOM writes). */
  private emit(): void {
    const rounded = Math.round(this.value);
    if (rounded === this.emittedPercent && this.label === this.emittedLabel) return;
    this.emittedPercent = rounded;
    this.emittedLabel = this.label;
    this.onProgress(rounded, this.label);
  }
}
export interface BootDecision {
  directToDriving: boolean;
  playIntro: boolean;
  lowEnd: boolean;
  reason: string;
}

/**
 * Decide how to enter the game. `forceMenu` is the only way to reach the menu on
 * a build configured for direct driving (debug hook / explicit user request).
 * The intro swoop is suppressed on low-end hardware: four seconds of cinematic
 * is exactly the wrong thing to spend a 1536 MB GPU's first frames on.
 */
export function decideBoot(opts: {
  lowEnd: boolean;
  hasSave: boolean;
  forceMenu?: boolean;
}): BootDecision {
  const forceMenu = opts.forceMenu === true;
  const directToDriving = CONFIG.boot.directToDriving && !forceMenu;
  const playIntro = CONFIG.cinematics.driveIntro && !CONFIG.boot.skipIntro && !opts.lowEnd;

  let reason: string;
  if (!directToDriving) {
    reason = forceMenu
      ? 'Menu forced by caller; direct-to-driving boot skipped'
      : 'CONFIG.boot.directToDriving is off; booting to the main menu';
  } else {
    const entry = opts.hasSave ? 'resuming saved progress' : 'starting a fresh run';
    const intro = playIntro
      ? 'with the drive-in cinematic'
      : opts.lowEnd
        ? 'cinematic skipped (low-end hardware)'
        : 'cinematic skipped (CONFIG.boot.skipIntro)';
    reason = `Booting straight into driving, ${entry}, ${intro}`;
  }

  return { directToDriving, playIntro, lowEnd: opts.lowEnd, reason };
}
