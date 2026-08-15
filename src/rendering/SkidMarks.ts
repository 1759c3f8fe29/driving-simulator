/**
 * SkidMarks — Pooled, fading tire skid marks laid under the rear wheels
 * while the vehicle is handbraking or drifting. Short strips stretch between
 * successive wheel contact points to form continuous lines, stay opaque while
 * the skid is active, fade out over ~8s once it stops, then are reused.
 */

import * as THREE from 'three';
import type { VehicleTelemetry } from '../vehicle/VehicleController';

const POOL_SIZE = 200; // maximum number of active strips
const MARK_WIDTH = 0.26; // meters — approximate tire contact patch width
const LAY_DISTANCE = 0.5; // meters — spacing between consecutive strips
const MARK_COLOR = 0x0b0b10;
const MAX_OPACITY = 0.85;
const FADE_TIME = 8.0; // seconds a strip takes to fade out once skid stops
const MAX_LIFE = 12.0; // seconds a strip can live while skidding (bounds churn)
const GROUND_Y_OFFSET = 0.02; // above terrain, avoids z-fighting
const MIN_SKID_SPEED = 1.5; // m/s — ignore skids while parked
const FALLBACK_WHEEL_BASE = 1.32; // rear axle distance behind chassis origin
const FALLBACK_TRACK_WIDTH = 1.64; // full rear track width for the fallback band
const FALLBACK_CHASSIS_HEIGHT = 0.55; // chassis origin height above ground

interface Strip {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  remaining: number; // seconds left in the fade window
  age: number; // seconds since the strip was laid
  fading: boolean;
  active: boolean;
}

export class SkidMarks {
  private scene: THREE.Scene;
  private pool: Strip[] = [];
  private cursor = 0;
  private geometry: THREE.BufferGeometry;
  private skidding = false;
  private prevWheels: (THREE.Vector3 | null)[] = [null, null, null, null];
  private fallbackPrev: THREE.Vector3 | null = null;
  private v1 = new THREE.Vector3();
  private v2 = new THREE.Vector3();
  private forward = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.geometry = this.buildUnitQuad();
    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: MARK_COLOR,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      scene.add(mesh);
      this.pool.push({ mesh, material, remaining: 0, age: 0, fading: false, active: false });
    }
  }

  update(t: VehicleTelemetry, dt: number): void {
    const nowSkidding = (t.handbrake || t.drifting) && t.speedMs > MIN_SKID_SPEED;

    // Skid just stopped — start the ~8s fade on every active strip.
    if (this.skidding && !nowSkidding) {
      for (let i = 0; i < this.pool.length; i++) {
        const strip = this.pool[i];
        if (!strip.active || strip.fading) continue;
        strip.fading = true;
        strip.remaining = FADE_TIME;
      }
    }
    this.skidding = nowSkidding;

    // Age active strips.
    for (let i = 0; i < this.pool.length; i++) {
      const strip = this.pool[i];
      if (!strip.active) continue;
      if (strip.fading) {
        strip.remaining -= dt;
        if (strip.remaining <= 0) {
          strip.active = false;
          strip.mesh.visible = false;
          strip.material.opacity = 0;
          continue;
        }
        strip.material.opacity = MAX_OPACITY * Math.min(1, Math.max(0, strip.remaining / FADE_TIME));
      } else {
        strip.age += dt;
        // Bounds the pool during long continuous skids.
        if (strip.age >= MAX_LIFE) {
          strip.fading = true;
          strip.remaining = FADE_TIME;
        }
      }
    }

    if (!nowSkidding) {
      for (let i = 0; i < this.prevWheels.length; i++) this.prevWheels[i] = null;
      this.fallbackPrev = null;
      return;
    }

    if (t.wheels && t.wheels.length >= 4) {
      for (let i = 0; i < t.wheels.length; i++) {
        const wheel = t.wheels[i];
        if (wheel.isFront || !wheel.inContact) {
          this.prevWheels[i] = null;
          continue;
        }
        const p = wheel.contactPoint;
        const prev = this.prevWheels[i];
        if (!prev) {
          this.prevWheels[i] = p.clone();
          continue;
        }
        this.v1.set(p.x - prev.x, 0, p.z - prev.z);
        if (this.v1.length() >= LAY_DISTANCE) {
          this.layStrip(prev, p, MARK_WIDTH);
          this.prevWheels[i] = p.clone();
        }
      }
    } else {
      // Fallback: a single wide band laid behind the car along the heading.
      this.forward.set(1, 0, 0).applyQuaternion(t.quaternion);
      this.forward.setY(0).normalize();
      this.v1.copy(t.position).addScaledVector(this.forward, -FALLBACK_WHEEL_BASE);
      this.v1.y = t.position.y - FALLBACK_CHASSIS_HEIGHT;
      const prev = this.fallbackPrev;
      if (!prev) {
        this.fallbackPrev = this.v1.clone();
      } else {
        this.v2.copy(this.v1).sub(prev);
        this.v2.y = 0;
        if (this.v2.length() >= LAY_DISTANCE) {
          this.layStrip(prev, this.v1, FALLBACK_TRACK_WIDTH);
          this.fallbackPrev = this.v1.clone();
        }
      }
    }
  }

  dispose(): void {
    for (let i = 0; i < this.pool.length; i++) {
      this.scene.remove(this.pool[i].mesh);
      this.pool[i].material.dispose();
    }
    this.geometry.dispose();
    this.pool.length = 0;
  }

  /** Positions a strip spanning a -> b on the ground plane. */
  private layStrip(a: THREE.Vector3, b: THREE.Vector3, width: number): void {
    const strip = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % POOL_SIZE;
    strip.active = true;
    strip.fading = false;
    strip.age = 0;
    strip.remaining = FADE_TIME;
    strip.material.opacity = MAX_OPACITY;

    // Midpoint and horizontal direction.
    this.v1.set(b.x + a.x, 0, b.z + a.z).multiplyScalar(0.5);
    this.v2.set(b.x - a.x, 0, b.z - a.z);
    const len = this.v2.length();
    this.v2.set(len > 1e-4 ? this.v2.x / len : 1, 0, len > 1e-4 ? this.v2.z / len : 0);

    const mesh = strip.mesh;
    mesh.position.set(this.v1.x, (a.y + b.y) * 0.5 + GROUND_Y_OFFSET, this.v1.z);
    mesh.rotation.y = Math.atan2(this.v2.x, this.v2.z);
    mesh.scale.set(width, 1, len);
    mesh.visible = true;
  }

  /** Shared unit quad lying flat on the XZ plane (local X = width, Z = length). */
  private buildUnitQuad(): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -0.5, 0, -0.5,
       0.5, 0, -0.5,
       0.5, 0,  0.5,
      -0.5, 0,  0.5,
    ]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const normals = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    return geo;
  }
}
