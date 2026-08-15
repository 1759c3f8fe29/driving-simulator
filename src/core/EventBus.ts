/**
 * EventBus — Central publish/subscribe event system.
 * All cross-module communication flows through here.
 */

export type EventHandler<T = unknown> = (payload: T) => void;

export class EventBus {
  private static instance: EventBus;
  private handlers = new Map<string, Set<EventHandler<never>>>();

  private constructor() {}

  static get(): EventBus {
    if (!EventBus.instance) EventBus.instance = new EventBus();
    return EventBus.instance;
  }

  on<T>(event: string, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  once<T>(event: string, handler: EventHandler<T>): () => void {
    const off = this.on<T>(event, (payload: T) => {
      off();
      handler(payload);
    });
    return off;
  }

  off<T>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<T>(event: string, payload?: T): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<T>)(payload as T);
      } catch (err) {
        console.error(`[EventBus] handler error on "${event}":`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

/** Canonical game event names. */
export const Events = {
  // Loading
  LOAD_PROGRESS: 'load:progress',
  LOAD_COMPLETE: 'load:complete',
  LOAD_ERROR: 'load:error',
  // Game state
  STATE_CHANGE: 'state:change',
  PAUSE: 'game:pause',
  RESUME: 'game:resume',
  // Vehicle
  VEHICLE_SPAWNED: 'vehicle:spawned',
  VEHICLE_RESET: 'vehicle:reset',
  VEHICLE_DAMAGE: 'vehicle:damage',
  VEHICLE_REPAIRED: 'vehicle:repaired',
  FUEL_CHANGED: 'vehicle:fuel',
  FUEL_LOW: 'vehicle:fuel-low',
  FUEL_EMPTY: 'vehicle:fuel-empty',
  ENGINE_STARTED: 'vehicle:engine-started',
  ENGINE_STOPPED: 'vehicle:engine-stopped',
  GEAR_CHANGED: 'vehicle:gear',
  LIGHTS_TOGGLED: 'vehicle:lights',
  COLLISION: 'vehicle:collision',
  // Camera
  CAMERA_CHANGED: 'camera:changed',
  // Weather
  WEATHER_CHANGED: 'weather:changed',
  TIME_CHANGED: 'time:changed',
  // UI
  NOTIFY: 'ui:notify',
  SCREEN_CHANGE: 'ui:screen',
  SETTINGS_APPLIED: 'ui:settings-applied',
  // Garage
  GARAGE_ENTER: 'garage:enter',
  GARAGE_EXIT: 'garage:exit',
  PAINT_CHANGED: 'garage:paint',
  // Photo / Replay
  PHOTO_TAKEN: 'photo:taken',
  REPLAY_SAVED: 'replay:saved',
  // Stats / achievements
  STATS_UPDATED: 'stats:updated',
  ACHIEVEMENT_UNLOCKED: 'achievement:unlocked',
  // Save
  SAVE_COMPLETE: 'save:complete',
  SAVE_FAILED: 'save:failed',
} as const;
