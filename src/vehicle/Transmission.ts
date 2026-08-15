/**
 * Transmission — Automatic & manual gearbox with realistic ratios.
 * Gear index: -1 = reverse, 0 = neutral, 1..6 = forward gears.
 */

import { CONFIG, clamp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';

export type TransmissionMode = 'automatic' | 'manual';

export class Transmission {
  private cfg = CONFIG.vehicle;
  private bus = EventBus.get();
  gear = 1; // start in 1st
  mode: TransmissionMode = 'automatic';
  private shiftTimer = 0; // >0 while shifting (torque interrupted)
  private clutch = 1; // 0 = disengaged, 1 = engaged

  setMode(mode: TransmissionMode): void {
    this.mode = mode;
  }

  get ratio(): number {
    const idx = this.gear + 1; // -1 -> 0 (reverse), 0 -> 1 (neutral), 1 -> 2 ...
    return this.cfg.gearRatios[idx] ?? 0;
  }

  get isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  get clutchEngagement(): number {
    return this.clutch;
  }

  shiftUp(): void {
    if (this.gear < 6 && this.gear >= 1) this.beginShift(this.gear + 1);
    else if (this.gear === 0) this.beginShift(1);
  }

  shiftDown(): void {
    if (this.gear > 1) this.beginShift(this.gear - 1);
    else if (this.gear === 1) this.beginShift(0);
  }

  toggleReverse(): void {
    if (this.gear === -1) this.beginShift(0);
    else if (this.gear <= 0) this.beginShift(-1);
  }

  private beginShift(target: number): void {
    if (this.shiftTimer > 0) return;
    this.shiftTimer = this.cfg.shiftTime;
    this.gear = target;
    this.bus.emit(Events.GEAR_CHANGED, { gear: this.gear });
  }

  /**
   * Automatic shift logic based on RPM and speed.
   */
  private autoShift(rpm: number, speedMs: number, throttle: number): void {
    if (this.shiftTimer > 0 || this.gear < 1) return;
    if (rpm >= this.cfg.shiftUpRPM && this.gear < 6) {
      this.beginShift(this.gear + 1);
    } else if (rpm <= this.cfg.shiftDownRPM && this.gear > 1 && speedMs > 1) {
      // Don't downshift under heavy throttle unless really needed
      if (throttle < 0.85 || rpm < this.cfg.shiftDownRPM * 0.7) {
        this.beginShift(this.gear - 1);
      }
    }
  }

  update(dt: number, rpm: number, speedMs: number, throttle: number): void {
    if (this.shiftTimer > 0) {
      this.shiftTimer -= dt;
      // Clutch disengages then re-engages during shift
      const half = this.cfg.shiftTime / 2;
      const t = this.cfg.shiftTime - this.shiftTimer;
      this.clutch = t < half ? clamp(1 - t / this.cfg.clutchEngageTime, 0, 1) : clamp((t - half) / this.cfg.clutchEngageTime, 0, 1);
    } else {
      this.clutch = clamp(this.clutch + dt / this.cfg.clutchEngageTime, 0, 1);
    }

    if (this.mode === 'automatic') {
      this.autoShift(rpm, speedMs, throttle);
    }
  }

  /** Wheel RPM -> engine RPM through current gear + final drive. */
  wheelToEngineRPM(wheelRadPerSec: number): number {
    const ratio = Math.abs(this.ratio) * this.cfg.finalDrive;
    if (ratio === 0) return 0;
    const wheelRPM = (wheelRadPerSec * 60) / (2 * Math.PI);
    return wheelRPM * ratio;
  }

  getGearLabel(): string {
    if (this.gear === -1) return 'R';
    if (this.gear === 0) return 'N';
    return String(this.gear);
  }
}
