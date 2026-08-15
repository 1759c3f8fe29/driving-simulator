/**
 * GarageManager — Garage scene state, rotating platform, inspection camera,
 * repair/refuel/paint operations, performance upgrades. Integrates with SaveManager.
 */

import * as THREE from 'three';
import { EventBus, Events } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';
import { VehicleController } from '../vehicle/VehicleController';
import { VehicleVisual, PaintConfig } from '../vehicle/VehicleVisual';
import { StatisticsManager } from '../stats/StatisticsManager';

export type GaragePanel = 'info' | 'paint' | 'repair' | 'fuel' | 'camera' | 'upgrades' | 'none';

/** Performance upgrade tracks available in the garage. */
export type UpgradeTrack = 'engine' | 'brakes' | 'tires';

/**
 * Performance upgrade levels (0 = stock baseline, UPGRADE_MAX_LEVEL = maxed).
 * This object is the single source of truth shared with VehiclePhysics.
 */
export interface Upgrades {
  engine: number;
  brakes: number;
  tires: number;
}

export const UPGRADE_SAVE_KEY = 'apexdrive_upgrades_v1';
export const UPGRADE_MAX_LEVEL = 3;
export const DEFAULT_UPGRADES: Upgrades = { engine: 0, brakes: 0, tires: 0 };
export const UPGRADE_LABELS: Record<UpgradeTrack, string> = {
  engine: 'Engine',
  brakes: 'Brakes',
  tires: 'Tires',
};

export class GarageManager {
  private bus = EventBus.get();
  private save = SaveManager.get();
  private upgrades: Upgrades = this.save.readGeneric<Upgrades>(UPGRADE_SAVE_KEY, DEFAULT_UPGRADES);
  active = false;
  platformAngle = 0;
  autoRotate = true;
  activePanel: GaragePanel = 'info';
  private vehicle: VehicleController | null = null;
  private visual: VehicleVisual | null = null;

  enter(vehicle: VehicleController, visual: VehicleVisual): void {
    this.vehicle = vehicle;
    this.visual = visual;
    this.active = true;
    this.platformAngle = 0;
    StatisticsManager.get(); // ensure stats exist
    this.pushUpgrades();
    this.bus.emit(Events.GARAGE_ENTER);
  }

  exit(): void {
    this.active = false;
    this.vehicle?.persist();
    this.pushUpgrades();
    this.bus.emit(Events.GARAGE_EXIT);
  }

  setPanel(panel: GaragePanel): void {
    this.activePanel = panel;
  }

  toggleAutoRotate(): void {
    this.autoRotate = !this.autoRotate;
  }

  rotatePlatform(delta: number): void {
    this.platformAngle += delta;
    this.autoRotate = false;
  }

  resetPlatform(): void {
    this.platformAngle = 0;
  }

  update(dt: number): void {
    if (!this.active) return;
    if (this.autoRotate) this.platformAngle += dt * 0.25;
  }

  // ----- Operations -----

  applyPaint(paint: PaintConfig): void {
    this.visual?.applyPaint(paint);
    this.bus.emit(Events.PAINT_CHANGED, paint);
    this.bus.emit(Events.NOTIFY, { type: 'success', message: 'Paint applied', icon: 'paint' });
  }

  applyRimColor(color: string): void {
    this.visual?.applyRimColor(color);
    this.bus.emit(Events.PAINT_CHANGED, { rim: color });
  }

  applyWindowTint(level: number): void {
    this.visual?.applyWindowTint(level);
    this.bus.emit(Events.NOTIFY, { type: 'success', message: `Window tint ${Math.round(level * 100)}%`, icon: 'paint' });
  }

  repair(component: 'engine' | 'suspension' | 'wheels' | 'body' | 'all'): void {
    if (!this.vehicle) return;
    if (component === 'all') this.vehicle.damage.repairAll();
    else this.vehicle.damage.repair(component);
    this.vehicle.persist();
    this.bus.emit(Events.NOTIFY, { type: 'success', message: component === 'all' ? 'Vehicle fully repaired' : `${component} repaired`, icon: 'repair' });
  }

  refuel(percent: 0.25 | 0.5 | 0.75 | 1): void {
    if (!this.vehicle) return;
    this.vehicle.fuel.refuelPercent(percent);
    this.vehicle.persist();
    this.bus.emit(Events.NOTIFY, { type: 'success', message: `Refueled to ${percent * 100}%`, icon: 'fuel' });
  }

  getPaint(): PaintConfig {
    return this.visual?.getPaint() ?? { ...this.save.vehicle.paint };
  }

  getRimColor(): string {
    return this.save.vehicle.rimColor;
  }

  getWindowTint(): number {
    return this.save.vehicle.windowTint;
  }

  // ----- Performance upgrades -----

  /**
   * Single source of truth for upgrade levels. VehiclePhysics reads this same
   * object (via setUpgrades), so changes propagate without re-persisting.
   */
  getUpgrades(): Upgrades {
    return this.upgrades;
  }

  getUpgradeLevel(track: UpgradeTrack): number {
    return this.upgrades[track];
  }

  /** Bind the active vehicle so saved upgrades push onto its physics layer. */
  attachVehicle(vehicle: VehicleController): void {
    this.vehicle = vehicle;
    this.pushUpgrades();
  }

  /** Purchase one upgrade level for a track. Persists and applies immediately. */
  applyUpgrade(track: UpgradeTrack): void {
    if (this.upgrades[track] >= UPGRADE_MAX_LEVEL) return;
    this.upgrades[track] += 1;
    this.save.writeGeneric(UPGRADE_SAVE_KEY, this.upgrades);
    this.pushUpgrades();
    this.bus.emit(Events.NOTIFY, {
      type: 'success',
      message: `${UPGRADE_LABELS[track]} upgraded to level ${this.upgrades[track]}`,
      icon: 'engine',
    });
  }

  private pushUpgrades(): void {
    this.vehicle?.physics.setUpgrades(this.upgrades);
  }
}
