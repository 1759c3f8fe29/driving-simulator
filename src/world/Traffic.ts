/**
 * Traffic — Kinematic AI traffic driving a local road grid inside the streamed
 * city. Cars only simulate while they are within the physics collider ring
 * around the player (CONFIG.streaming.colliderRadius chunks); anything beyond
 * that has no ground to drive on, so it is recycled into a fresh lane slot
 * 60-110 m ahead of the player instead of being simulated over the void.
 * Placement is gated on a downward ground ray (budgeted per frame) so a car is
 * never dropped into a chunk that has not streamed in yet. The pool can be
 * capped at runtime (setMaxActive) or switched off entirely (setEnabled) for
 * the low-end profile. The per-frame path allocates nothing: every vector and
 * quaternion temporary is an instance field or module scope, and the hot loops
 * are indexed rather than iterator-based.
 */

import * as THREE from 'three';
import { PhysicsWorld, RAPIER } from '../physics/PhysicsWorld';
import { CONFIG, clamp, damp } from '../core/Config';

const CAR_COUNT = 8;
/** Road grid pitch: two roads per chunk edge, aligned to chunk boundaries. */
const ROAD_SPACING = CONFIG.streaming.chunkSize / 2;
const LANE_OFFSET = 4; // m — right-hand lane centre offset from a road centreline
/**
 * Baked district extent. The manifest grid is cx/cz -10..5 at chunkSize 125, so
 * the city spans [-1250, 750] on both world axes — it is NOT centred on the
 * origin. Traffic cannot see the manifest (its constructor signature is frozen),
 * so the span is derived from chunkSize here; the ground ray is the real gate on
 * whether a lane slot is drivable.
 */
const WORLD_MIN = -10 * CONFIG.streaming.chunkSize; // -1250 m
const WORLD_MAX = 6 * CONFIG.streaming.chunkSize; // 750 m
/** Cars outside the collider ring have no ground, so they get recycled. */
const CULL_DIST = CONFIG.streaming.colliderRadius * CONFIG.streaming.chunkSize;
const SPAWN_MIN = 60; // m ahead of the player
const SPAWN_MAX = 110; // m ahead of the player
const SPAWN_LATERAL = 80; // m — lateral spread of candidate spawn points
const SPAWN_CLEARANCE = 14; // m — keep recycled cars off each other in-lane
const PLACE_RAYS_PER_FRAME = 4; // hard cap on placement rays across all cars
const PLACE_TRIES_PER_CAR = 2; // candidate lane slots tested per car per frame
const TRACK_RAYS_PER_FRAME = 2; // ground re-samples for already-driving cars
const GROUND_RAY_UP = 30; // m above the reference height
const GROUND_RAY_MAX = 120; // m of ray length
const GROUND_MISS_LIMIT = 3; // consecutive misses before a car is recycled
const GROUND_SAMPLE_DIST = 6; // m of travel between ground re-samples
const GROUND_FOLLOW_LAMBDA = 10; // smoothing rate for the sampled ground height
const FORWARD_LAMBDA = 4; // smoothing rate for the player travel direction
const AVOID_RANGE = 35; // m — start slowing for a player ahead in lane
const AVOID_STOP = 8; // m — full stop distance to the player
const LANE_HALF_WIDTH = 5; // m — lateral tolerance for player-in-lane
const FOLLOW_DIST = 22; // m — start matching the car ahead
const FOLLOW_MIN_GAP = 10; // m — desired gap to the car ahead
const LANE_MATCH = 2.5; // m — cross tolerance for "same lane as"
const ACCEL = 3.5; // m/s^2
const DECEL = 7; // m/s^2
const UP_AXIS = new THREE.Vector3(0, 1, 0);

const CAR_COLORS = [0xcc2222, 0x2266cc, 0x22aa44, 0xddaa00, 0x8833cc, 0x22aaaa, 0xee8833, 0x446688];

/** 0 = lane runs along world X, 1 = lane runs along world Z. */
type LaneAxis = 0 | 1;
type LaneDir = 1 | -1;

interface TrafficCar {
  body: RAPIER.RigidBody | null;
  group: THREE.Group;
  bodyMat: THREE.MeshStandardMaterial;
  cabinMat: THREE.MeshStandardMaterial;
  axis: LaneAxis;
  dir: LaneDir;
  along: number; // position along the lane axis
  cross: number; // fixed lane-centre coordinate on the other axis
  groundY: number;
  groundMiss: number;
  sinceSample: number; // m travelled since the last ground ray
  speed: number;
  cruiseSpeed: number;
  active: boolean;
}

export class Traffic {
  readonly group = new THREE.Group();
  private scene: THREE.Scene;
  private physics: PhysicsWorld;
  private cars: TrafficCar[] = [];
  private bodyGeom: THREE.BoxGeometry;
  private cabinGeom: THREE.BoxGeometry;
  private enabled = true;
  private maxActive = CAR_COUNT;
  /** Per-frame ray budgets, reset at the top of update(). */
  private placeRays = 0;
  private trackRays = 0;
  /** Smoothed player travel direction, used to pick spawn slots "ahead". */
  private forwardX = 0;
  private forwardZ = 1;
  private lastPlayerX = 0;
  private lastPlayerZ = 0;
  private hasLastPlayer = false;
  /** Candidate lane slot being tested by tryPlace (scratch, no allocation). */
  private candAxis: LaneAxis = 0;
  private candAlong = 0;
  private candCross = 0;
  /** xorshift32 state — deterministic, allocation-free pseudo-randomness. */
  private rngState = 0x9e3779b9;
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private rayOrigin = { x: 0, y: 0, z: 0 };
  private rayDir = { x: 0, y: -1, z: 0 };

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    this.scene = scene;
    this.physics = physics;
    this.bodyGeom = new THREE.BoxGeometry(1.8, 0.5, 4.0);
    this.cabinGeom = new THREE.BoxGeometry(1.6, 0.55, 1.9);
    for (let i = 0; i < CAR_COUNT; i++) this.buildCar(i);
    scene.add(this.group);
  }

  private buildCar(index: number): void {
    const color = new THREE.Color(CAR_COLORS[index % CAR_COLORS.length]);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.55 });
    const cabinMat = new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.72),
      roughness: 0.15,
      metalness: 0.5,
    });
    const carGroup = new THREE.Group();
    const body = new THREE.Mesh(this.bodyGeom, bodyMat);
    body.position.set(0, 0.25, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    const cabin = new THREE.Mesh(this.cabinGeom, cabinMat);
    cabin.position.set(0, 0.95, -0.2);
    cabin.castShadow = true;
    cabin.receiveShadow = true;
    carGroup.add(body);
    carGroup.add(cabin);
    carGroup.visible = false;
    this.group.add(carGroup);
    const cruise = 8.5 + ((index * 37) % 23) * 0.36; // ~30-55 km/h spread
    this.cars.push({
      body: null,
      group: carGroup,
      bodyMat,
      cabinMat,
      axis: (index & 1) as LaneAxis,
      dir: index & 2 ? -1 : 1,
      along: 0,
      cross: 0,
      groundY: 0.4,
      groundMiss: 0,
      sinceSample: 0,
      speed: cruise,
      cruiseSpeed: cruise,
      active: false,
    });
  }

  /** xorshift32: cheap, deterministic, zero allocation. Returns [0, 1). */
  private rand(): number {
    let s = this.rngState;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.rngState = s | 0;
    return ((s >>> 0) % 100000) / 100000;
  }

  /** Snap a world coordinate to the nearest lane centreline on the road grid. */
  private snapToLane(coord: number, dir: LaneDir): number {
    const road = Math.round(coord / ROAD_SPACING) * ROAD_SPACING;
    return road + LANE_OFFSET * dir;
  }

  private laneX(car: TrafficCar): number {
    return car.axis === 0 ? car.along : car.cross;
  }

  private laneZ(car: TrafficCar): number {
    return car.axis === 0 ? car.cross : car.along;
  }

  private yawFor(axis: LaneAxis, dir: LaneDir): number {
    // Heading vector is (dir,0,0) on axis 0 and (0,0,dir) on axis 1;
    // yaw = atan2(dirX, dirZ) to match the mesh's -Z forward convention.
    if (axis === 0) return dir > 0 ? Math.PI * 0.5 : -Math.PI * 0.5;
    return dir > 0 ? 0 : Math.PI;
  }

  /**
   * Downward ground probe. Returns the hit height or NaN when nothing was hit,
   * which means the chunk under that point has no collider yet.
   */
  private probeGround(x: number, z: number, refY: number): number {
    this.rayOrigin.x = x;
    this.rayOrigin.y = refY + GROUND_RAY_UP;
    this.rayOrigin.z = z;
    const hit = this.physics.castRay(this.rayOrigin, this.rayDir, GROUND_RAY_MAX);
    if (!hit.hit) return NaN;
    return hit.point.y;
  }

  private ensureBody(car: TrafficCar, x: number, y: number, z: number, yaw: number): void {
    if (car.body) {
      this.tmpPos.set(x, y, z);
      car.body.setTranslation(this.tmpPos, true);
      this.tmpQuat.setFromAxisAngle(UP_AXIS, yaw);
      car.body.setRotation(this.tmpQuat, true);
      return;
    }
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setCcdEnabled(true)
      .setCanSleep(false);
    const body = this.physics.createRigidBody(desc);
    const collider = RAPIER.ColliderDesc.cuboid(0.9, 0.55, 2.0)
      .setTranslation(0, 0.5, 0)
      .setFriction(0.8)
      .setRestitution(0.05);
    this.physics.createCollider(collider, body);
    car.body = body;
  }

  private syncTransform(car: TrafficCar): void {
    const x = this.laneX(car);
    const z = this.laneZ(car);
    const yaw = this.yawFor(car.axis, car.dir);
    car.group.position.set(x, car.groundY, z);
    car.group.rotation.y = yaw;
    if (car.body) {
      this.tmpPos.set(x, car.groundY, z);
      car.body.setNextKinematicTranslation(this.tmpPos);
      this.tmpQuat.setFromAxisAngle(UP_AXIS, yaw);
      car.body.setNextKinematicRotation(this.tmpQuat);
    }
  }

  /** True when the candidate lane slot is clear of every other active car. */
  private candidateClear(self: TrafficCar): boolean {
    for (let i = 0; i < this.cars.length; i++) {
      const other = this.cars[i];
      if (other === self || !other.active) continue;
      if (other.axis !== this.candAxis) continue;
      if (Math.abs(other.cross - this.candCross) > LANE_MATCH) continue;
      if (Math.abs(other.along - this.candAlong) < SPAWN_CLEARANCE) return false;
    }
    return true;
  }

  /**
   * Try to (re)place a car on a lane slot 60-110 m ahead of the player. Costs at
   * most one ground ray per candidate and only runs while the frame's placement
   * ray budget is left; a ray miss means the target chunk has no collider yet, so
   * the car simply stays parked and retries on a later frame rather than being
   * dropped into the void.
   */
  private tryPlace(car: TrafficCar, playerPos: THREE.Vector3): void {
    for (let attempt = 0; attempt < PLACE_TRIES_PER_CAR; attempt++) {
      if (this.placeRays >= PLACE_RAYS_PER_FRAME) return;
      const ahead = SPAWN_MIN + this.rand() * (SPAWN_MAX - SPAWN_MIN);
      const lateral = (this.rand() * 2 - 1) * SPAWN_LATERAL;
      // Perpendicular of the smoothed player forward, in the XZ plane.
      const tx = playerPos.x + this.forwardX * ahead - this.forwardZ * lateral;
      const tz = playerPos.z + this.forwardZ * ahead + this.forwardX * lateral;
      // Drive along whichever world axis the player is more aligned with.
      const axis: LaneAxis = Math.abs(this.forwardX) >= Math.abs(this.forwardZ) ? 0 : 1;
      const dir: LaneDir = (axis === 0 ? this.forwardX : this.forwardZ) >= 0 ? 1 : -1;
      this.candAxis = axis;
      this.candAlong = clamp(axis === 0 ? tx : tz, WORLD_MIN, WORLD_MAX);
      this.candCross = clamp(this.snapToLane(axis === 0 ? tz : tx, dir), WORLD_MIN, WORLD_MAX);
      if (!this.candidateClear(car)) continue;
      const px = axis === 0 ? this.candAlong : this.candCross;
      const pz = axis === 0 ? this.candCross : this.candAlong;
      // Clamping may have pushed the slot outside the collider ring; there is no
      // ground guaranteed there, so do not even spend a ray on it.
      const rx = px - playerPos.x;
      const rz = pz - playerPos.z;
      if (rx * rx + rz * rz > CULL_DIST * CULL_DIST) continue;
      // The player height is the only one known for sure, so probe relative to it.
      this.placeRays++;
      const y = this.probeGround(px, pz, playerPos.y);
      if (Number.isNaN(y)) continue;
      car.axis = axis;
      car.dir = dir;
      car.along = this.candAlong;
      car.cross = this.candCross;
      car.groundY = y;
      car.groundMiss = 0;
      car.sinceSample = 0;
      car.speed = car.cruiseSpeed * 0.6;
      car.active = true;
      car.group.visible = true;
      this.ensureBody(car, px, y, pz, this.yawFor(axis, dir));
      this.syncTransform(car);
      return;
    }
  }

  /** Park a car: collider removed, mesh hidden, ready to be recycled. */
  private deactivate(car: TrafficCar): void {
    if (car.body) {
      this.physics.removeRigidBody(car.body);
      car.body = null;
    }
    car.group.visible = false;
    car.active = false;
    car.groundMiss = 0;
    car.sinceSample = 0;
    car.speed = car.cruiseSpeed;
  }

  private targetSpeedFor(car: TrafficCar, playerPos: THREE.Vector3): number {
    let target = car.cruiseSpeed;
    const hx = car.axis === 0 ? car.dir : 0;
    const hz = car.axis === 0 ? 0 : car.dir;
    const toPlayerX = playerPos.x - this.laneX(car);
    const toPlayerZ = playerPos.z - this.laneZ(car);
    const distSq = toPlayerX * toPlayerX + toPlayerZ * toPlayerZ;
    if (distSq < AVOID_RANGE * AVOID_RANGE && distSq > 1e-4) {
      const ahead = hx * toPlayerX + hz * toPlayerZ;
      if (ahead > 0) {
        const latSq = Math.max(0, distSq - ahead * ahead);
        if (latSq < LANE_HALF_WIDTH * LANE_HALF_WIDTH) {
          const f = clamp((ahead - AVOID_STOP) / (AVOID_RANGE - AVOID_STOP), 0, 1);
          target = Math.min(target, car.cruiseSpeed * f);
        }
      }
    }
    let gap = Infinity;
    for (let i = 0; i < this.cars.length; i++) {
      const other = this.cars[i];
      if (other === car || !other.active) continue;
      if (other.axis !== car.axis || other.dir !== car.dir) continue;
      if (Math.abs(other.cross - car.cross) > LANE_MATCH) continue;
      const g = (other.along - car.along) * car.dir;
      if (g > 1e-3 && g < gap) gap = g;
    }
    if (gap < FOLLOW_DIST) {
      const f = clamp((gap - FOLLOW_MIN_GAP) / (FOLLOW_DIST - FOLLOW_MIN_GAP), 0, 1);
      target = Math.min(target, car.cruiseSpeed * f);
    }
    return target;
  }

  /** Track the player's travel direction so spawns land ahead, not behind. */
  private updateForward(playerPos: THREE.Vector3, dt: number): void {
    if (!this.hasLastPlayer) {
      this.lastPlayerX = playerPos.x;
      this.lastPlayerZ = playerPos.z;
      this.hasLastPlayer = true;
      return;
    }
    const dx = playerPos.x - this.lastPlayerX;
    const dz = playerPos.z - this.lastPlayerZ;
    this.lastPlayerX = playerPos.x;
    this.lastPlayerZ = playerPos.z;
    const len = Math.hypot(dx, dz);
    if (len <= 1e-3) return; // stationary: keep the last known heading
    const nx = dx / len;
    const nz = dz / len;
    this.forwardX = damp(this.forwardX, nx, FORWARD_LAMBDA, dt);
    this.forwardZ = damp(this.forwardZ, nz, FORWARD_LAMBDA, dt);
    const fl = Math.hypot(this.forwardX, this.forwardZ);
    if (fl > 1e-4) {
      this.forwardX /= fl;
      this.forwardZ /= fl;
    } else {
      // Damping crossed through zero on a reversal; snap to the new heading.
      this.forwardX = nx;
      this.forwardZ = nz;
    }
  }

  /** Call every frame with the player car's world position. */
  update(dt: number, playerPos: THREE.Vector3): void {
    if (!this.enabled) return;
    const step = Math.min(dt, 0.05);
    this.placeRays = 0;
    this.trackRays = 0;
    this.updateForward(playerPos, step);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (i >= this.maxActive) {
        // Over the runtime cap: hidden and skipped, never destroyed.
        if (car.active) this.deactivate(car);
        else if (car.group.visible) car.group.visible = false;
        continue;
      }
      if (!car.active) {
        this.tryPlace(car, playerPos);
        continue;
      }
      this.updateCar(car, step, playerPos);
    }
  }

  private updateCar(car: TrafficCar, dt: number, playerPos: THREE.Vector3): void {
    const dx = this.laneX(car) - playerPos.x;
    const dz = this.laneZ(car) - playerPos.z;
    if (dx * dx + dz * dz > CULL_DIST * CULL_DIST) {
      // Outside the collider ring: no ground out here, so recycle rather than
      // keep simulating. The re-place may fail on this frame (ray budget or an
      // unloaded chunk) and simply retries next frame.
      this.deactivate(car);
      this.tryPlace(car, playerPos);
      return;
    }

    const target = this.targetSpeedFor(car, playerPos);
    if (target < car.speed) car.speed = Math.max(target, car.speed - DECEL * dt);
    else car.speed = Math.min(target, car.speed + ACCEL * dt);

    const travel = car.speed * dt;
    car.along += travel * car.dir;
    car.sinceSample += travel;
    if (car.along > WORLD_MAX || car.along < WORLD_MIN) {
      // Ran off the baked district edge.
      this.deactivate(car);
      this.tryPlace(car, playerPos);
      return;
    }

    if (car.sinceSample >= GROUND_SAMPLE_DIST && this.trackRays < TRACK_RAYS_PER_FRAME) {
      this.trackRays++;
      car.sinceSample = 0;
      const y = this.probeGround(this.laneX(car), this.laneZ(car), car.groundY);
      if (Number.isNaN(y)) {
        car.groundMiss++;
        if (car.groundMiss >= GROUND_MISS_LIMIT) {
          this.deactivate(car);
          this.tryPlace(car, playerPos);
          return;
        }
      } else {
        car.groundMiss = 0;
        car.groundY = damp(car.groundY, y, GROUND_FOLLOW_LAMBDA, dt);
      }
    }

    this.syncTransform(car);
  }

  /**
   * Runtime cap on how many cars simulate. Extras are hidden and skipped, never
   * destroyed, so raising the cap again costs nothing but a placement ray.
   */
  setMaxActive(n: number): void {
    const capped = Math.floor(clamp(n, 0, CAR_COUNT));
    if (capped === this.maxActive) return;
    this.maxActive = capped;
    for (let i = capped; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.active) this.deactivate(car);
      else car.group.visible = false;
    }
  }

  /** Number of cars currently simulating (placed, visible, driving). */
  getActiveCount(): number {
    let n = 0;
    for (let i = 0; i < this.cars.length; i++) if (this.cars[i].active) n++;
    return n;
  }

  /** Hide and fully skip all traffic — the low-end profile may disable it. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    if (on) {
      // Re-derive the player heading before spawning anything ahead of them.
      this.hasLastPlayer = false;
      return;
    }
    for (let i = 0; i < this.cars.length; i++) this.deactivate(this.cars[i]);
  }

  dispose(): void {
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      this.deactivate(car);
      car.group.clear();
      car.bodyMat.dispose();
      car.cabinMat.dispose();
    }
    this.cars.length = 0;
    this.group.clear();
    this.bodyGeom.dispose();
    this.cabinGeom.dispose();
    this.scene.remove(this.group);
  }
}
