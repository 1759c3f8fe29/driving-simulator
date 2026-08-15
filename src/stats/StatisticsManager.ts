/**
 * StatisticsManager — Tracks all player statistics, session history.
 * Data-driven, event-fed, persisted via SaveManager.
 */

import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';

export interface Statistics {
  totalDistanceKm: number;
  totalDriveTimeSec: number;
  topSpeedKmh: number;
  totalAccelerationTime: number;
  totalBrakingTime: number;
  trips: number;
  engineStarts: number;
  maxRPM: number;
  fuelConsumedL: number;
  refuelCount: number;
  collisionCount: number;
  repairCount: number;
  longestDriftM: number;
  totalDriftM: number;
  garageVisits: number;
  paintChanges: number;
  photosTaken: number;
  replaysSaved: number;
  sessions: Array<{ date: string; distanceKm: number; topSpeed: number; durationSec: number }>;
}

const DEFAULT_STATS: Statistics = {
  totalDistanceKm: 0,
  totalDriveTimeSec: 0,
  topSpeedKmh: 0,
  totalAccelerationTime: 0,
  totalBrakingTime: 0,
  trips: 0,
  engineStarts: 0,
  maxRPM: 0,
  fuelConsumedL: 0,
  refuelCount: 0,
  collisionCount: 0,
  repairCount: 0,
  longestDriftM: 0,
  totalDriftM: 0,
  garageVisits: 0,
  paintChanges: 0,
  photosTaken: 0,
  replaysSaved: 0,
  sessions: [],
};

export class StatisticsManager {
  private static instance: StatisticsManager;
  private save = SaveManager.get();
  private bus = EventBus.get();
  stats: Statistics;
  private sessionStart = Date.now();
  private sessionDistance = 0;
  private sessionTopSpeed = 0;
  private currentDriftM = 0;
  private lastFuel = -1;

  private constructor() {
    this.stats = this.save.readGeneric(CONFIG.save.statsKey, DEFAULT_STATS);
    this.bindEvents();
  }

  static get(): StatisticsManager {
    if (!StatisticsManager.instance) StatisticsManager.instance = new StatisticsManager();
    return StatisticsManager.instance;
  }

  private bindEvents(): void {
    this.bus.on(Events.ENGINE_STARTED, () => this.stats.engineStarts++);
    this.bus.on(Events.COLLISION, () => this.stats.collisionCount++);
    this.bus.on(Events.VEHICLE_REPAIRED, () => this.stats.repairCount++);
    this.bus.on(Events.GARAGE_ENTER, () => this.stats.garageVisits++);
    this.bus.on(Events.PAINT_CHANGED, () => this.stats.paintChanges++);
    this.bus.on(Events.PHOTO_TAKEN, () => this.stats.photosTaken++);
    this.bus.on(Events.REPLAY_SAVED, () => this.stats.replaysSaved++);
    this.bus.on(Events.FUEL_CHANGED, (p: unknown) => {
      const { liters } = p as { liters: number };
      if (this.lastFuel >= 0 && liters > this.lastFuel + 0.5) this.stats.refuelCount++;
      this.lastFuel = liters;
    });
  }

  /** Per-frame driving telemetry feed. */
  feed(speedKmh: number, rpm: number, throttle: number, brake: number, drifting: boolean, dt: number): void {
    const distKm = (speedKmh / 3.6) * dt / 1000;
    this.stats.totalDistanceKm += distKm;
    this.sessionDistance += distKm;
    if (speedKmh > 0.5) this.stats.totalDriveTimeSec += dt;
    if (speedKmh > this.stats.topSpeedKmh) this.stats.topSpeedKmh = speedKmh;
    if (speedKmh > this.sessionTopSpeed) this.sessionTopSpeed = speedKmh;
    if (rpm > this.stats.maxRPM) this.stats.maxRPM = rpm;
    if (throttle > 0.3) this.stats.totalAccelerationTime += dt;
    if (brake > 0.3) this.stats.totalBrakingTime += dt;
    if (drifting) {
      const driftM = (speedKmh / 3.6) * dt;
      this.currentDriftM += driftM;
      this.stats.totalDriftM += driftM;
    } else {
      if (this.currentDriftM > this.stats.longestDriftM) this.stats.longestDriftM = this.currentDriftM;
      this.currentDriftM = 0;
    }
  }

  recordFuelConsumed(liters: number): void {
    this.stats.fuelConsumedL += liters;
  }

  endSession(): void {
    const durationSec = (Date.now() - this.sessionStart) / 1000;
    this.stats.sessions.unshift({
      date: new Date().toISOString(),
      distanceKm: Math.round(this.sessionDistance * 100) / 100,
      topSpeed: Math.round(this.sessionTopSpeed),
      durationSec: Math.round(durationSec),
    });
    this.stats.sessions = this.stats.sessions.slice(0, 20);
    this.persist();
  }

  persist(): void {
    this.save.writeGeneric(CONFIG.save.statsKey, this.stats);
    this.bus.emit(Events.STATS_UPDATED, this.stats);
  }

  reset(): void {
    this.stats = structuredClone(DEFAULT_STATS);
    this.persist();
  }
}
