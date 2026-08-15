/**
 * AchievementManager — Data-driven achievements with progress tracking.
 */

import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { SaveManager } from '../save/SaveManager';
import { Statistics } from '../stats/StatisticsManager';

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  difficulty: 'bronze' | 'silver' | 'gold' | 'platinum';
  secret?: boolean;
  check: (s: Statistics) => boolean;
  progress: (s: Statistics) => { current: number; target: number };
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_drive', name: 'First Drive', description: 'Drive your first kilometer', category: 'Driving', icon: '🚗', difficulty: 'bronze',
    check: (s) => s.totalDistanceKm >= 1, progress: (s) => ({ current: s.totalDistanceKm, target: 1 }) },
  { id: 'drive_10', name: 'Sunday Driver', description: 'Drive 10 km total', category: 'Driving', icon: '🛣️', difficulty: 'bronze',
    check: (s) => s.totalDistanceKm >= 10, progress: (s) => ({ current: s.totalDistanceKm, target: 10 }) },
  { id: 'drive_100', name: 'Road Tripper', description: 'Drive 100 km total', category: 'Driving', icon: '🗺️', difficulty: 'silver',
    check: (s) => s.totalDistanceKm >= 100, progress: (s) => ({ current: s.totalDistanceKm, target: 100 }) },
  { id: 'drive_1000', name: 'Long Hauler', description: 'Drive 1,000 km total', category: 'Driving', icon: '🏁', difficulty: 'gold',
    check: (s) => s.totalDistanceKm >= 1000, progress: (s) => ({ current: s.totalDistanceKm, target: 1000 }) },
  { id: 'speed_100', name: 'Triple Digits', description: 'Reach 100 km/h', category: 'Speed', icon: '💨', difficulty: 'bronze',
    check: (s) => s.topSpeedKmh >= 100, progress: (s) => ({ current: s.topSpeedKmh, target: 100 }) },
  { id: 'speed_200', name: 'Speed Demon', description: 'Reach 200 km/h', category: 'Speed', icon: '⚡', difficulty: 'silver',
    check: (s) => s.topSpeedKmh >= 200, progress: (s) => ({ current: s.topSpeedKmh, target: 200 }) },
  { id: 'speed_300', name: 'Terminal Velocity', description: 'Reach 300 km/h', category: 'Speed', icon: '🚀', difficulty: 'gold',
    check: (s) => s.topSpeedKmh >= 300, progress: (s) => ({ current: s.topSpeedKmh, target: 300 }) },
  { id: 'drift_first', name: 'Sideways', description: 'Complete a 50 m drift', category: 'Drift', icon: '🌀', difficulty: 'bronze',
    check: (s) => s.longestDriftM >= 50, progress: (s) => ({ current: s.longestDriftM, target: 50 }) },
  { id: 'drift_500', name: 'Drift King', description: 'Complete a 500 m drift', category: 'Drift', icon: '👑', difficulty: 'gold',
    check: (s) => s.longestDriftM >= 500, progress: (s) => ({ current: s.longestDriftM, target: 500 }) },
  { id: 'refuel_first', name: 'Fill Er Up', description: 'Refuel your vehicle', category: 'Fuel', icon: '⛽', difficulty: 'bronze',
    check: (s) => s.refuelCount >= 1, progress: (s) => ({ current: s.refuelCount, target: 1 }) },
  { id: 'garage_first', name: 'Welcome Home', description: 'Visit the garage', category: 'Garage', icon: '🔧', difficulty: 'bronze',
    check: (s) => s.garageVisits >= 1, progress: (s) => ({ current: s.garageVisits, target: 1 }) },
  { id: 'paint_first', name: 'Fresh Coat', description: 'Change your paint', category: 'Garage', icon: '🎨', difficulty: 'bronze',
    check: (s) => s.paintChanges >= 1, progress: (s) => ({ current: s.paintChanges, target: 1 }) },
  { id: 'photo_first', name: 'Shutterbug', description: 'Take a photo', category: 'Photo', icon: '📸', difficulty: 'bronze',
    check: (s) => s.photosTaken >= 1, progress: (s) => ({ current: s.photosTaken, target: 1 }) },
  { id: 'photo_25', name: 'Photographer', description: 'Take 25 photos', category: 'Photo', icon: '📷', difficulty: 'silver',
    check: (s) => s.photosTaken >= 25, progress: (s) => ({ current: s.photosTaken, target: 25 }) },
  { id: 'crash_first', name: 'Ouch', description: 'Survive your first crash', category: 'Damage', icon: '💥', difficulty: 'bronze', secret: true,
    check: (s) => s.collisionCount >= 1, progress: (s) => ({ current: s.collisionCount, target: 1 }) },
  { id: 'repair_first', name: 'Good As New', description: 'Repair your vehicle', category: 'Damage', icon: '🛠️', difficulty: 'bronze',
    check: (s) => s.repairCount >= 1, progress: (s) => ({ current: s.repairCount, target: 1 }) },
  { id: 'time_1h', name: 'Behind The Wheel', description: 'Drive for 1 hour total', category: 'Milestone', icon: '⏱️', difficulty: 'silver',
    check: (s) => s.totalDriveTimeSec >= 3600, progress: (s) => ({ current: s.totalDriveTimeSec, target: 3600 }) },
];

export class AchievementManager {
  private static instance: AchievementManager;
  private save = SaveManager.get();
  private bus = EventBus.get();
  private unlocked: Record<string, string> = {}; // id -> ISO date

  private constructor() {
    this.unlocked = this.save.readGeneric(CONFIG.save.achievementsKey, {});
  }

  static get(): AchievementManager {
    if (!AchievementManager.instance) AchievementManager.instance = new AchievementManager();
    return AchievementManager.instance;
  }

  /** Evaluate all achievements against current stats. */
  evaluate(stats: Statistics): void {
    for (const a of ACHIEVEMENTS) {
      if (this.unlocked[a.id]) continue;
      if (a.check(stats)) {
        this.unlocked[a.id] = new Date().toISOString();
        this.save.writeGeneric(CONFIG.save.achievementsKey, this.unlocked);
        this.bus.emit(Events.ACHIEVEMENT_UNLOCKED, a);
        this.bus.emit(Events.NOTIFY, {
          type: 'achievement',
          message: `Achievement: ${a.name}`,
          icon: 'achievement',
          detail: a.description,
        });
      }
    }
  }

  isUnlocked(id: string): boolean {
    return !!this.unlocked[id];
  }

  getUnlockDate(id: string): string | null {
    return this.unlocked[id] ?? null;
  }

  getAll(): Array<Achievement & { unlocked: boolean; unlockDate: string | null }> {
    return ACHIEVEMENTS.map((a) => ({
      ...a,
      unlocked: this.isUnlocked(a.id),
      unlockDate: this.getUnlockDate(a.id),
    }));
  }

  get completion(): { unlocked: number; total: number } {
    return { unlocked: Object.keys(this.unlocked).length, total: ACHIEVEMENTS.length };
  }
}
