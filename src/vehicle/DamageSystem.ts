/**
 * DamageSystem — Body, engine, suspension damage with performance effects.
 */

import { clamp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';

export interface DamageState {
  body: number; // 0..1
  engine: number;
  suspension: number;
  wheels: number;
}

export class DamageSystem {
  private bus = EventBus.get();
  private state: DamageState;
  enabled = true;

  constructor(initial?: Partial<DamageState>) {
    this.state = { body: 0, engine: 0, suspension: 0, wheels: 0, ...initial };
  }

  /** Apply collision impulse (Ns). Distributes damage across components. */
  applyImpact(impulse: number): void {
    if (!this.enabled) return;
    const severity = clamp((impulse - 8000) / 120000, 0, 0.35);
    if (severity <= 0) return;
    this.state.body = clamp(this.state.body + severity, 0, 1);
    this.state.engine = clamp(this.state.engine + severity * 0.55, 0, 1);
    this.state.suspension = clamp(this.state.suspension + severity * 0.4, 0, 1);
    this.state.wheels = clamp(this.state.wheels + severity * 0.3, 0, 1);
    this.bus.emit(Events.VEHICLE_DAMAGE, { ...this.state, severity });
    if (severity > 0.08) {
      this.bus.emit(Events.NOTIFY, { type: 'warning', message: 'Vehicle damaged', icon: 'damage' });
    }
  }

  repairAll(): void {
    this.state = { body: 0, engine: 0, suspension: 0, wheels: 0 };
    this.bus.emit(Events.VEHICLE_REPAIRED, { ...this.state });
  }

  repair(component: keyof DamageState): void {
    this.state[component] = 0;
    this.bus.emit(Events.VEHICLE_REPAIRED, { ...this.state });
  }

  /** Overall health 0..1 (1 = pristine). */
  get health(): number {
    return 1 - (this.state.body * 0.3 + this.state.engine * 0.4 + this.state.suspension * 0.2 + this.state.wheels * 0.1);
  }

  /** Grip multiplier penalty from wheel/suspension damage. */
  get gripPenalty(): number {
    return 1 - (this.state.wheels * 0.25 + this.state.suspension * 0.2);
  }

  getState(): DamageState {
    return { ...this.state };
  }

  get isCritical(): boolean {
    return this.state.engine > 0.8 || this.health < 0.25;
  }
}
