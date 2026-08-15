/**
 * Clock — Fixed-timestep game clock with interpolation support.
 * Physics never depends on render FPS.
 *
 * Two deltas are kept deliberately separate. `tick()` returns the *simulation*
 * delta, clamped so a long frame cannot spiral the fixed-step loop. `frameTime`
 * and `fps` report the *measured* delta, unclamped — clamping before measuring
 * made both saturate (a 900 ms frame read as "250 ms / 4 FPS"), which hid real
 * stalls from the perf watchdog and from anything gating on frame duration.
 */

import { CONFIG } from './Config';

/** Simulation delta ceiling (s). Longer real frames still advance only this far. */
const MAX_SIM_DELTA = 0.25;

export class Clock {
  private lastTime = 0;
  private accumulator = 0;
  private elapsed = 0;
  private frameCount = 0;
  private fpsTime = 0;
  private currentFPS = 0;
  private frameTimeMs = 0;
  private rawDeltaSec = 0;
  private running = false;

  readonly fixedDelta = CONFIG.physics.fixedTimestep;

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
  }

  stop(): void {
    this.running = false;
  }

  /** Advance the clock; returns the clamped simulation delta in seconds (0 when stopped). */
  tick(): number {
    if (!this.running) return 0;
    const now = performance.now();
    const raw = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Measure first, clamp second.
    this.rawDeltaSec = raw;
    this.frameTimeMs = raw * 1000;
    this.frameCount++;
    this.fpsTime += raw;
    if (this.fpsTime >= 0.5) {
      this.currentFPS = Math.round(this.frameCount / this.fpsTime);
      this.frameCount = 0;
      this.fpsTime = 0;
    }

    const delta = raw > MAX_SIM_DELTA ? MAX_SIM_DELTA : raw;
    this.elapsed += delta;
    this.accumulator += delta;
    return delta;
  }

  /** Consume one fixed step if available. */
  consumeFixedStep(): boolean {
    if (this.accumulator >= this.fixedDelta) {
      this.accumulator -= this.fixedDelta;
      return true;
    }
    return false;
  }

  /** Cap accumulator to avoid excessive catch-up. */
  clampAccumulator(): void {
    const max = this.fixedDelta * CONFIG.physics.maxSubSteps;
    if (this.accumulator > max) this.accumulator = max;
  }

  get fps(): number {
    return this.currentFPS;
  }

  get frameTime(): number {
    return this.frameTimeMs;
  }

  /** Unclamped real frame delta in seconds — what the wall clock actually saw. */
  get rawDelta(): number {
    return this.rawDeltaSec;
  }

  get time(): number {
    return this.elapsed;
  }

  get interpolationAlpha(): number {
    return this.accumulator / this.fixedDelta;
  }
}
