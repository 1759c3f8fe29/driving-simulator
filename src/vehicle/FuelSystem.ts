/**
 * FuelSystem — Fuel capacity, consumption, range estimation.
 */

import { CONFIG, clamp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { StatisticsManager } from '../stats/StatisticsManager';

export class FuelSystem {
  private cfg = CONFIG.vehicle;
  private bus = EventBus.get();
  private liters: number;
  private lowWarned = false;
  private emptyWarned = false;
  enabled = true;

  constructor(initialLiters?: number) {
    this.liters = clamp(initialLiters ?? this.cfg.fuelCapacity, 0, this.cfg.fuelCapacity);
  }

  /** Consume fuel based on engine load. Returns false if empty. */
  consume(rpm: number, throttle: number, running: boolean, dt: number): boolean {
    if (!this.enabled || !running) return this.liters > 0;
    const load = (rpm / this.cfg.maxRPM) * (0.25 + throttle * 0.75);
    const rate = this.cfg.fuelConsumptionIdle + this.cfg.fuelConsumptionRate * load * this.cfg.maxRPM;
    const consumed = rate * dt;
    this.liters = Math.max(0, this.liters - consumed);
    StatisticsManager.get().recordFuelConsumed(consumed);

    const pct = this.percentage;
    if (pct <= 0 && !this.emptyWarned) {
      this.emptyWarned = true;
      this.bus.emit(Events.FUEL_EMPTY);
      this.bus.emit(Events.NOTIFY, { type: 'danger', message: 'Fuel empty — engine stopped', icon: 'fuel' });
    } else if (pct < 0.12 && !this.lowWarned) {
      this.lowWarned = true;
      this.bus.emit(Events.FUEL_LOW, { percent: pct });
      this.bus.emit(Events.NOTIFY, { type: 'warning', message: 'Low fuel', icon: 'fuel' });
    }
    return this.liters > 0;
  }

  refuel(liters: number): void {
    this.liters = clamp(this.liters + liters, 0, this.cfg.fuelCapacity);
    if (this.liters > 0) this.emptyWarned = false;
    if (this.percentage >= 0.12) this.lowWarned = false;
    this.bus.emit(Events.FUEL_CHANGED, { liters: this.liters, percent: this.percentage });
  }

  refuelPercent(pct: number): void {
    this.refuel(this.cfg.fuelCapacity * pct - this.liters);
  }

  get percentage(): number {
    return this.liters / this.cfg.fuelCapacity;
  }

  get remainingLiters(): number {
    return this.liters;
  }

  /** Rough range estimate in km assuming mixed driving ~9L/100km. */
  get estimatedRangeKm(): number {
    return (this.liters / 9) * 100;
  }

  get isEmpty(): boolean {
    return this.liters <= 0;
  }

  serialize(): number {
    return this.liters;
  }
}
