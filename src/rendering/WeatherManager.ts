/**
 * WeatherManager — Dynamic weather states, smooth transitions,
 * fog, rain/snow particles, lightning, wind, grip modifiers.
 * Only this module controls environmental conditions.
 */

import * as THREE from 'three';
import { CONFIG, clamp, damp, lerp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { Sky } from './Sky';

export type WeatherType =
  | 'clear'
  | 'sunny'
  | 'partlyCloudy'
  | 'overcast'
  | 'rain'
  | 'heavyRain'
  | 'storm'
  | 'fog'
  | 'snow'
  | 'heavySnow';

interface WeatherProfile {
  label: string;
  cloudCover: number;
  fogDensity: number;
  fogColor: number;
  sunDimming: number; // 1 = full sun
  rainIntensity: number; // 0..1
  snowIntensity: number; // 0..1
  windSpeed: number; // m/s
  grip: number; // tire grip multiplier
  wetnessTarget: number;
  lightning: boolean;
  ambientVolume: number;
}

const PROFILES: Record<WeatherType, WeatherProfile> = {
  clear:        { label: 'Clear',         cloudCover: 0.05, fogDensity: 0.00012, fogColor: 0xa8c8e8, sunDimming: 1.0,  rainIntensity: 0,    snowIntensity: 0,    windSpeed: 2,  grip: 1.0,  wetnessTarget: 0, lightning: false, ambientVolume: 0.2 },
  sunny:        { label: 'Sunny',         cloudCover: 0.12, fogDensity: 0.00015, fogColor: 0xa8c8e8, sunDimming: 1.0,  rainIntensity: 0,    snowIntensity: 0,    windSpeed: 3,  grip: 1.0,  wetnessTarget: 0, lightning: false, ambientVolume: 0.25 },
  partlyCloudy: { label: 'Partly Cloudy', cloudCover: 0.45, fogDensity: 0.00025, fogColor: 0x9fb8d0, sunDimming: 0.85, rainIntensity: 0,    snowIntensity: 0,    windSpeed: 5,  grip: 1.0,  wetnessTarget: 0, lightning: false, ambientVolume: 0.3 },
  overcast:     { label: 'Overcast',      cloudCover: 0.9,  fogDensity: 0.00045, fogColor: 0x8a99a8, sunDimming: 0.55, rainIntensity: 0,    snowIntensity: 0,    windSpeed: 6,  grip: 0.97, wetnessTarget: 0, lightning: false, ambientVolume: 0.35 },
  rain:         { label: 'Rain',          cloudCover: 0.95, fogDensity: 0.0009,  fogColor: 0x7a8898, sunDimming: 0.4,  rainIntensity: 0.45, snowIntensity: 0,    windSpeed: 8,  grip: 0.78, wetnessTarget: 1, lightning: false, ambientVolume: 0.6 },
  heavyRain:    { label: 'Heavy Rain',    cloudCover: 1.0,  fogDensity: 0.0016,  fogColor: 0x6a7888, sunDimming: 0.3,  rainIntensity: 0.8,  snowIntensity: 0,    windSpeed: 12, grip: 0.68, wetnessTarget: 1, lightning: false, ambientVolume: 0.8 },
  storm:        { label: 'Storm',         cloudCover: 1.0,  fogDensity: 0.002,   fogColor: 0x55606e, sunDimming: 0.22, rainIntensity: 1.0,  snowIntensity: 0,    windSpeed: 18, grip: 0.62, wetnessTarget: 1, lightning: true,  ambientVolume: 1.0 },
  fog:          { label: 'Fog',           cloudCover: 0.6,  fogDensity: 0.006,   fogColor: 0x9aa5b0, sunDimming: 0.5,  rainIntensity: 0,    snowIntensity: 0,    windSpeed: 1,  grip: 0.92, wetnessTarget: 0.3, lightning: false, ambientVolume: 0.3 },
  snow:         { label: 'Snow',          cloudCover: 0.9,  fogDensity: 0.0012,  fogColor: 0xc8d0d8, sunDimming: 0.5,  rainIntensity: 0,    snowIntensity: 0.5,  windSpeed: 6,  grip: 0.55, wetnessTarget: 0, lightning: false, ambientVolume: 0.4 },
  heavySnow:    { label: 'Heavy Snow',    cloudCover: 1.0,  fogDensity: 0.003,   fogColor: 0xd0d6dc, sunDimming: 0.4,  rainIntensity: 0,    snowIntensity: 1.0,  windSpeed: 14, grip: 0.42, wetnessTarget: 0, lightning: false, ambientVolume: 0.55 },
};

const PARTICLE_COUNT = 3500;

export class WeatherManager {
  private bus = EventBus.get();
  private scene: THREE.Scene;
  private sky: Sky;
  current: WeatherType = 'clear';
  private target: WeatherType = 'clear';
  private blend = 1; // 1 = fully at target
  private transitionTime = CONFIG.weather.transitionDuration;

  // Interpolated live values
  private live = { ...PROFILES.clear };
  wetness = 0;

  private fog: THREE.FogExp2;
  private rain!: THREE.Points;
  private snow!: THREE.Points;
  private rainVelocities!: Float32Array;
  private snowVelocities!: Float32Array;
  private lightningFlash = 0;
  private nextLightning = 8;
  private windDirection = new THREE.Vector2(1, 0.3).normalize();

  constructor(scene: THREE.Scene, sky: Sky) {
    this.scene = scene;
    this.sky = sky;
    this.fog = new THREE.FogExp2(0xa8c8e8, 0.00012);
    this.scene.fog = this.fog;
    this.buildParticles();
  }

  private buildParticles(): void {
    const mkParticles = (color: number, size: number, opacity: number): { points: THREE.Points; velocities: Float32Array } => {
      const geo = new THREE.BufferGeometry();
      const positions = new Float32Array(PARTICLE_COUNT * 3);
      const velocities = new Float32Array(PARTICLE_COUNT);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 120;
        positions[i * 3 + 1] = Math.random() * 50;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 120;
        velocities[i] = 0.7 + Math.random() * 0.6;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.PointsMaterial({
        color,
        size,
        transparent: true,
        opacity,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geo, mat);
      points.frustumCulled = false;
      points.visible = false;
      this.scene.add(points);
      return { points, velocities };
    };
    const rain = mkParticles(0x9db8d6, 0.09, 0.55);
    this.rain = rain.points;
    this.rainVelocities = rain.velocities;
    const snow = mkParticles(0xffffff, 0.16, 0.85);
    this.snow = snow.points;
    this.snowVelocities = snow.velocities;
  }

  setWeather(type: WeatherType, transitionSeconds?: number): void {
    if (type === this.target && this.blend >= 1) return;
    this.current = this.target;
    this.target = type;
    this.blend = 0;
    this.transitionTime = transitionSeconds ?? CONFIG.weather.transitionDuration;
    this.bus.emit(Events.WEATHER_CHANGED, { type, label: PROFILES[type].label });
    this.bus.emit(Events.NOTIFY, { type: 'info', message: `Weather: ${PROFILES[type].label}`, icon: 'weather' });
  }

  getWeather(): WeatherType {
    return this.target;
  }

  get gripMultiplier(): number {
    return this.live.grip;
  }

  private updateParticles(
    points: THREE.Points,
    velocities: Float32Array,
    intensity: number,
    fallSpeed: number,
    center: THREE.Vector3,
    dt: number,
    drift: number
  ): void {
    points.visible = intensity > 0.02;
    if (!points.visible) return;
    (points.material as THREE.PointsMaterial).opacity = intensity * 0.8;
    const pos = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const range = 60;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      arr[i * 3 + 1] -= velocities[i] * fallSpeed * dt;
      arr[i * 3] += this.windDirection.x * drift * dt * velocities[i];
      arr[i * 3 + 2] += this.windDirection.y * drift * dt * velocities[i];
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3] = center.x + (Math.random() - 0.5) * range * 2;
        arr[i * 3 + 1] = 30 + Math.random() * 20;
        arr[i * 3 + 2] = center.z + (Math.random() - 0.5) * range * 2;
      }
      // Keep particles around the player
      if (Math.abs(arr[i * 3] - center.x) > range) arr[i * 3] = center.x + (Math.random() - 0.5) * range;
      if (Math.abs(arr[i * 3 + 2] - center.z) > range) arr[i * 3 + 2] = center.z + (Math.random() - 0.5) * range;
    }
    pos.needsUpdate = true;
  }

  update(dt: number, followPosition: THREE.Vector3): void {
    // Blend profiles
    if (this.blend < 1) {
      this.blend = clamp(this.blend + dt / this.transitionTime, 0, 1);
    }
    const a = PROFILES[this.current];
    const b = PROFILES[this.target];
    const t = this.blend * this.blend * (3 - 2 * this.blend); // smoothstep
    this.live = {
      label: b.label,
      cloudCover: lerp(a.cloudCover, b.cloudCover, t),
      fogDensity: lerp(a.fogDensity, b.fogDensity, t),
      fogColor: b.fogColor,
      sunDimming: lerp(a.sunDimming, b.sunDimming, t),
      rainIntensity: lerp(a.rainIntensity, b.rainIntensity, t),
      snowIntensity: lerp(a.snowIntensity, b.snowIntensity, t),
      windSpeed: lerp(a.windSpeed, b.windSpeed, t),
      grip: lerp(a.grip, b.grip, t),
      wetnessTarget: b.wetnessTarget,
      lightning: b.lightning,
      ambientVolume: lerp(a.ambientVolume, b.ambientVolume, t),
    };

    // Wetness rises/dries gradually
    this.wetness = damp(this.wetness, this.live.wetnessTarget, 0.05, dt);

    // Fog
    this.fog.density = this.live.fogDensity;
    this.fog.color.setHex(this.live.fogColor);
    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.fog.color);
    }

    // Sky
    this.sky.cloudCover = this.live.cloudCover;

    // Lightning
    if (this.live.lightning) {
      this.nextLightning -= dt;
      if (this.nextLightning <= 0) {
        this.lightningFlash = 1;
        this.nextLightning = 4 + Math.random() * 14;
        this.bus.emit('weather:lightning', { delay: 0.5 + Math.random() * 2.5 });
      }
    }
    this.lightningFlash = damp(this.lightningFlash, 0, 8, dt);

    // Particles
    this.updateParticles(this.rain, this.rainVelocities, this.live.rainIntensity, 38, followPosition, dt, this.live.windSpeed * 0.4);
    this.updateParticles(this.snow, this.snowVelocities, this.live.snowIntensity, 3.2, followPosition, dt, this.live.windSpeed * 0.25);
  }

  /** Exposure boost from lightning, consumed by renderer. */
  get lightningBoost(): number {
    return this.lightningFlash * 0.9;
  }

  get windSpeed(): number {
    return this.live.windSpeed;
  }

  get label(): string {
    return PROFILES[this.target].label;
  }

  get ambientVolume(): number {
    return this.live.ambientVolume;
  }

  get sunDimming(): number {
    return this.live.sunDimming;
  }
}
