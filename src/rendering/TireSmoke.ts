/**
 * TireSmoke — Pooled billboarded smoke puffs emitted at the rear wheels
 * while the vehicle is drifting or handbraking at speed. Puffs expand,
 * rise and fade over ~1s, then return to the pool. Uses a procedurally
 * generated radial-gradient sprite texture (no audio or external assets).
 */

import * as THREE from 'three';
import type { VehicleTelemetry } from '../vehicle/VehicleController';

const POOL_SIZE = 60; // maximum number of live puffs
const SPAWN_RATE = 1.7; // puffs per second while active
const PUFF_LIFETIME = 1.0; // seconds a puff lives
const PUFF_START = 0.35; // start scale
const PUFF_END = 1.9; // end scale
const PUFF_MAX_OPACITY = 0.55;
const PUFF_RISE = 0.12; // m/s upward drift
const PUFF_Y_OFFSET = 0.18; // meters above the wheel contact point
const MIN_SMOKE_SPEED = 2.0; // m/s — no smoke when parked or nearly stopped
const SMOKE_COLOR = 0xc9cdd3;
const TEXTURE_SIZE = 64;
const FALLBACK_WHEEL_BASE = 1.32;
const FALLBACK_CHASSIS_HEIGHT = 0.55;

interface Puff {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  remaining: number;
  active: boolean;
  scale0: number;
  scale1: number;
  vx: number; // m/s lateral drift
  vz: number; // m/s longitudinal drift
}

export class TireSmoke {
  private scene: THREE.Scene;
  private pool: Puff[] = [];
  private cursor = 0;
  private accumulator = 0;
  private texture: THREE.CanvasTexture;
  private pos = new THREE.Vector3();
  private forward = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.texture = this.buildSmokeTexture();
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: this.texture,
        color: SMOKE_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 2;
      scene.add(sprite);
      this.pool.push({
        sprite,
        material,
        remaining: 0,
        active: false,
        scale0: PUFF_START,
        scale1: PUFF_END,
        vx: 0,
        vz: 0,
      });
    }
  }

  update(t: VehicleTelemetry, dt: number): void {
    // Age live puffs.
    for (let i = 0; i < this.pool.length; i++) {
      const puff = this.pool[i];
      if (!puff.active) continue;
      puff.remaining -= dt;
      if (puff.remaining <= 0) {
        puff.active = false;
        puff.sprite.visible = false;
        puff.material.opacity = 0;
        continue;
      }
      const p = 1 - puff.remaining / PUFF_LIFETIME; // 0..1
      const scale = puff.scale0 + p * (puff.scale1 - puff.scale0);
      puff.sprite.scale.set(scale, scale, 1);
      puff.material.opacity = PUFF_MAX_OPACITY * (1 - p) * (1 - p);
      puff.sprite.position.x += puff.vx * dt;
      puff.sprite.position.z += puff.vz * dt;
      puff.sprite.position.y += PUFF_RISE * dt;
    }

    const smoking = (t.handbrake || t.drifting) && t.speedMs > MIN_SMOKE_SPEED;
    if (!smoking) {
      this.accumulator = 0;
      return;
    }

    this.accumulator += SPAWN_RATE * dt;
    while (this.accumulator >= 1) {
      this.accumulator -= 1;
      this.spawnPuff(t);
    }
  }

  dispose(): void {
    for (let i = 0; i < this.pool.length; i++) {
      this.scene.remove(this.pool[i].sprite);
      this.pool[i].material.dispose();
    }
    this.texture.dispose();
    this.pool.length = 0;
  }

  private spawnPuff(t: VehicleTelemetry): void {
    const puff = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    puff.active = true;
    puff.remaining = PUFF_LIFETIME;
    puff.scale0 = PUFF_START * (0.85 + Math.random() * 0.3);
    puff.scale1 = PUFF_END * (0.9 + Math.random() * 0.2);
    puff.material.opacity = PUFF_MAX_OPACITY;
    puff.vx = (Math.random() - 0.5) * 0.35;
    puff.vz = (Math.random() - 0.5) * 0.35;

    if (t.wheels && t.wheels.length >= 4) {
      // Reservoir-pick a random rear wheel in contact (no per-frame allocation).
      let chosen: (typeof t.wheels)[number] | null = null;
      let count = 0;
      for (let i = 0; i < t.wheels.length; i++) {
        const w = t.wheels[i];
        if (w.isFront || !w.inContact) continue;
        count++;
        if (Math.random() * count < 1) chosen = w;
      }
      if (chosen) {
        this.pos.copy(chosen.contactPoint);
        this.pos.y += PUFF_Y_OFFSET;
        puff.sprite.position.copy(this.pos);
      } else {
        this.setFallbackSpawn(t, puff);
      }
    } else {
      this.setFallbackSpawn(t, puff);
    }
    puff.sprite.visible = true;
  }

  /** Spawn position behind the chassis along the heading when wheels are absent. */
  private setFallbackSpawn(t: VehicleTelemetry, puff: Puff): void {
    this.forward.set(1, 0, 0).applyQuaternion(t.quaternion);
    this.forward.setY(0).normalize();
    this.pos.copy(t.position).addScaledVector(this.forward, -FALLBACK_WHEEL_BASE);
    this.pos.y = t.position.y - FALLBACK_CHASSIS_HEIGHT + PUFF_Y_OFFSET;
    this.pos.x += (Math.random() - 0.5) * 0.8;
    this.pos.z += (Math.random() - 0.5) * 0.8;
    puff.sprite.position.copy(this.pos);
  }

  /** Procedural soft radial gradient used by every puff sprite. */
  private buildSmokeTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d')!;
    const half = TEXTURE_SIZE * 0.5;
    const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    return new THREE.CanvasTexture(canvas);
  }
}
