/**
 * Engine — Realistic engine simulation.
 * RPM derives from wheel speed through the drivetrain, never from time.
 * Torque curve: low at low RPM, peak mid-range, falling at high RPM.
 */

import { CONFIG, clamp, damp, lerp } from '../core/Config';

export interface EngineState {
  rpm: number;
  torque: number;
  throttle: number;
  running: boolean;
  revLimiterActive: boolean;
  stalled: boolean;
}

export class Engine {
  private cfg = CONFIG.vehicle;
  rpm = 0;
  throttle = 0; // smoothed 0..1
  running = false;
  private revLimiterCut = false;
  private damageFactor = 1; // 1 = healthy, 0 = destroyed

  start(): void {
    if (this.running) return;
    this.running = true;
    this.rpm = this.cfg.idleRPM;
  }

  stop(): void {
    this.running = false;
    this.rpm = 0;
    this.throttle = 0;
  }

  setDamage(damage01: number): void {
    this.damageFactor = clamp(1 - damage01 * 0.75, 0.25, 1);
  }

  /** Normalized torque curve: 0 at 0 rpm, peak at peakTorqueRPM, falling to redline. */
  private torqueCurve(rpm: number): number {
    const n = clamp(rpm / this.cfg.redline, 0, 1.1);
    const peak = this.cfg.peakTorqueRPM / this.cfg.redline;
    // Smooth asymmetric curve
    const rise = Math.pow(clamp(n / peak, 0, 1), 0.75);
    const fall = n > peak ? 1 - Math.pow((n - peak) / (1.05 - peak), 1.6) * 0.35 : 1;
    const lowEnd = lerp(0.35, 1, rise);
    return clamp(lowEnd * fall, 0, 1);
  }

  /**
   * Update engine state.
   * @param rawThrottle driver input 0..1
   * @param wheelRPM RPM fed back through drivetrain (0 when clutch disengaged / neutral)
   * @param clutchEngaged 0..1
   * @param dt seconds
   * @returns output torque in Nm at the crankshaft
   */
  update(rawThrottle: number, wheelRPM: number, clutchEngaged: number, dt: number): number {
    if (!this.running) {
      this.rpm = damp(this.rpm, 0, 2, dt);
      this.throttle = 0;
      return 0;
    }

    // Smooth throttle response
    this.throttle = damp(this.throttle, clamp(rawThrottle, 0, 1), this.cfg.throttleResponse, dt);

    // Target RPM from drivetrain when clutch engaged, free-rev otherwise
    const loadRPM = lerp(this.cfg.idleRPM + this.throttle * (this.cfg.maxRPM - this.cfg.idleRPM), wheelRPM, clutchEngaged);
    const targetRPM = Math.max(this.cfg.idleRPM, loadRPM);
    this.rpm = damp(this.rpm, targetRPM, 8 / Math.max(this.cfg.engineInertia * 10, 1), dt);

    // Rev limiter with oscillation
    if (this.rpm >= this.cfg.redline) {
      this.revLimiterCut = !this.revLimiterCut || Math.random() < 0.5;
      this.rpm = this.cfg.redline - Math.random() * 150;
    } else if (this.rpm < this.cfg.redline - 400) {
      this.revLimiterCut = false;
    }

    if (this.revLimiterCut) return 0;

    const torque =
      this.cfg.peakTorque * this.torqueCurve(this.rpm) * this.throttle * this.damageFactor;
    return torque;
  }

  /** Engine braking torque (Nm, opposing motion) when throttle released. */
  getEngineBrakingTorque(): number {
    if (!this.running) return 0;
    const rpmFactor = clamp((this.rpm - this.cfg.idleRPM) / (this.cfg.redline - this.cfg.idleRPM), 0, 1);
    return this.cfg.engineBraking * this.cfg.peakTorque * rpmFactor * (1 - this.throttle);
  }

  getState(): EngineState {
    return {
      rpm: this.rpm,
      torque: this.cfg.peakTorque * this.torqueCurve(this.rpm) * this.throttle,
      throttle: this.throttle,
      running: this.running,
      revLimiterActive: this.revLimiterCut,
      stalled: false,
    };
  }
}
