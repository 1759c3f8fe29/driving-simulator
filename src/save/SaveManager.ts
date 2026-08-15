/**
 * SaveManager — LocalStorage persistence for all game state.
 * Versioned, validated, with recovery on corruption.
 */

import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';

export interface VehicleSaveData {
  fuel: number;
  bodyDamage: number;
  engineDamage: number;
  suspensionDamage: number;
  odometerKm: number;
  totalDriveTime: number;
  paint: { color: string; metallic: number; gloss: number; type: string };
  rimColor: string;
  windowTint: number;
  position: { x: number; y: number; z: number };
  rotationY: number;
}

export interface SettingsData {
  graphics: {
    preset: string;
    bloom: boolean;
    ssao: boolean;
    motionBlur: boolean;
    shadows: boolean;
    shadowQuality: number;
    renderScale: number;
    fpsLimit: number;
    // No renderer vsync control exists in three r166; frame pacing is browser-RAF bound.
    // fpsLimit is the software cap; vsync was removed. Stale 'vsync' keys in old saves are ignored.
  };
  audio: {
    master: number;
    engine: number;
    effects: number;
    ui: number;
    ambience: number;
    muted: boolean;
  };
  gameplay: {
    transmission: 'automatic' | 'manual';
    units: 'kmh' | 'mph';
    fuelConsumption: boolean;
    damageEnabled: boolean;
  };
  accessibility: {
    uiScale: number;
    hudScale: number;
    largeText: boolean;
    highContrast: boolean;
    reducedMotion: boolean;
    colorBlind: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
  };
  interface: {
    showHUD: boolean;
    showFPS: boolean;
    showClock: boolean;
    notifications: boolean;
  };
}

export const DEFAULT_SETTINGS: SettingsData = {
  graphics: {
    preset: 'high',
    bloom: true,
    ssao: false,
    motionBlur: false,
    shadows: true,
    shadowQuality: 2048,
    renderScale: 1.0,
    fpsLimit: 144,
  },
  audio: { master: 0.9, engine: 0.85, effects: 0.9, ui: 0.7, ambience: 0.6, muted: false },
  gameplay: { transmission: 'automatic', units: 'kmh', fuelConsumption: true, damageEnabled: true },
  accessibility: {
    uiScale: 1,
    hudScale: 1,
    largeText: false,
    highContrast: false,
    reducedMotion: false,
    colorBlind: 'none',
  },
  interface: { showHUD: true, showFPS: false, showClock: true, notifications: true },
};

export const DEFAULT_VEHICLE: VehicleSaveData = {
  fuel: CONFIG.vehicle.fuelCapacity,
  bodyDamage: 0,
  engineDamage: 0,
  suspensionDamage: 0,
  odometerKm: 0,
  totalDriveTime: 0,
  paint: { color: '#c8102e', metallic: 0.85, gloss: 0.9, type: 'metallic' },
  rimColor: '#8a8d91',
  windowTint: 0.2,
  position: { ...CONFIG.vehicle.spawnPosition },
  rotationY: 0,
};

function safeRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return structuredClone(fallback);
    const parsed = JSON.parse(raw) as T;
    return { ...structuredClone(fallback), ...parsed };
  } catch (err) {
    console.warn(`[SaveManager] corrupt save for ${key}, resetting`, err);
    return structuredClone(fallback);
  }
}

function safeWrite(key: string, data: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error(`[SaveManager] write failed for ${key}`, err);
    return false;
  }
}

export class SaveManager {
  private static instance: SaveManager;
  private bus = EventBus.get();
  private autosaveTimer: number | null = null;

  vehicle: VehicleSaveData;
  settings: SettingsData;

  private constructor() {
    this.vehicle = safeRead(CONFIG.save.key, DEFAULT_VEHICLE);
    this.settings = safeRead(CONFIG.save.settingsKey, DEFAULT_SETTINGS);
  }

  static get(): SaveManager {
    if (!SaveManager.instance) SaveManager.instance = new SaveManager();
    return SaveManager.instance;
  }

  saveVehicle(): void {
    const ok = safeWrite(CONFIG.save.key, this.vehicle);
    this.bus.emit(ok ? Events.SAVE_COMPLETE : Events.SAVE_FAILED, { target: 'vehicle' });
  }

  saveSettings(): void {
    const ok = safeWrite(CONFIG.save.settingsKey, this.settings);
    this.bus.emit(ok ? Events.SAVE_COMPLETE : Events.SAVE_FAILED, { target: 'settings' });
  }

  readGeneric<T>(key: string, fallback: T): T {
    return safeRead(key, fallback);
  }

  writeGeneric(key: string, data: unknown): boolean {
    return safeWrite(key, data);
  }

  startAutosave(intervalSeconds = CONFIG.save.autosaveInterval): void {
    this.stopAutosave();
    this.autosaveTimer = window.setInterval(() => {
      this.bus.emit('save:autosave-tick');
    }, intervalSeconds * 1000);
  }

  stopAutosave(): void {
    if (this.autosaveTimer !== null) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }
  }
}
