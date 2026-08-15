/**
 * WeatherScheduler — Policy over WeatherManager: changes weather automatically
 * while driving. Picks random target states (warm states common, storms/snow rare)
 * with a severity-coherence penalty so transitions feel natural rather than chaotic.
 */

import { CONFIG } from '../core/Config';
import { WeatherManager, WeatherType } from './WeatherManager';

const SEVERITY: Record<WeatherType, number> = {
  clear: 0,
  sunny: 0,
  partlyCloudy: 1,
  overcast: 2,
  fog: 2,
  rain: 3,
  heavyRain: 4,
  snow: 3,
  heavySnow: 4,
  storm: 5,
};

// Warm/dry states dominate; storms and heavy snow are rare.
const WEIGHTS: Record<WeatherType, number> = {
  clear: 12,
  sunny: 14,
  partlyCloudy: 20,
  overcast: 16,
  fog: 8,
  rain: 10,
  heavyRain: 5,
  storm: 3,
  snow: 4,
  heavySnow: 2,
};

export class WeatherScheduler {
  private weather: WeatherManager;
  private elapsed = 0;
  private nextChangeAt = 0;
  private enabled = CONFIG.weatherScheduler.enabled;

  constructor(weather: WeatherManager) {
    this.weather = weather;
    this.schedule();
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
  }

  /** Re-arm the countdown. Does NOT force a weather change. */
  reset(): void {
    this.elapsed = 0;
    this.schedule();
  }

  private schedule(): void {
    const { minInterval, maxInterval } = CONFIG.weatherScheduler;
    this.nextChangeAt = minInterval + Math.random() * (maxInterval - minInterval);
  }

  private pickNext(current: WeatherType): WeatherType {
    // Weighted pick with a coherence penalty: large severity jumps are heavily
    // discounted, so sunny->storm is nearly impossible while sunny->partlyCloudy is common.
    let total = 0;
    const effective: Partial<Record<WeatherType, number>> = {};
    for (const t of Object.keys(WEIGHTS) as WeatherType[]) {
      if (t === current) continue;
      const w = WEIGHTS[t] / (1 + Math.abs(SEVERITY[t] - SEVERITY[current]) * 1.5);
      effective[t] = w;
      total += w;
    }
    let r = Math.random() * total;
    for (const [t, w] of Object.entries(effective) as Array<[WeatherType, number]>) {
      if ((r -= w) <= 0) return t;
    }
    return 'partlyCloudy';
  }

  update(dt: number): void {
    if (!this.enabled) return;
    this.elapsed += dt;
    if (this.elapsed < this.nextChangeAt) return;
    this.weather.setWeather(this.pickNext(this.weather.getWeather()), CONFIG.weatherScheduler.transitionSeconds);
    this.elapsed = 0;
    this.schedule();
  }
}
