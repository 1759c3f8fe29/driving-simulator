/**
 * PhysicsWorld — Rapier physics initialization and stepping.
 * Fixed timestep, CCD, sleeping, collision events.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { CONFIG } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';

export interface CollisionEvent {
  body1: number;
  body2: number;
  impulse: number;
}

export class PhysicsWorld {
  private static instance: PhysicsWorld | null = null;
  world!: RAPIER.World;
  private eventQueue!: RAPIER.EventQueue;
  private bus = EventBus.get();
  private initialized = false;
  private collisionCallbacks = new Set<(e: CollisionEvent) => void>();

  private constructor() {}

  static async get(): Promise<PhysicsWorld> {
    if (!PhysicsWorld.instance) {
      PhysicsWorld.instance = new PhysicsWorld();
      await PhysicsWorld.instance.init();
    }
    return PhysicsWorld.instance;
  }

  private async init(): Promise<void> {
    await RAPIER.init();
    this.world = new RAPIER.World({ x: 0, y: CONFIG.physics.gravity, z: 0 });
    this.world.timestep = CONFIG.physics.fixedTimestep;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.initialized = true;
  }

  step(): void {
    if (!this.initialized) return;
    this.world.step(this.eventQueue);
    this.eventQueue.drainContactForceEvents((ev) => {
      const impulse = ev.totalForceMagnitude();
      if (impulse > 8000) {
        const event: CollisionEvent = {
          body1: ev.collider1(),
          body2: ev.collider2(),
          impulse,
        };
        for (const cb of this.collisionCallbacks) cb(event);
        this.bus.emit(Events.COLLISION, event);
      }
    });
  }

  onCollision(cb: (e: CollisionEvent) => void): () => void {
    this.collisionCallbacks.add(cb);
    return () => this.collisionCallbacks.delete(cb);
  }

  createRigidBody(desc: RAPIER.RigidBodyDesc): RAPIER.RigidBody {
    return this.world.createRigidBody(desc);
  }

  createCollider(desc: RAPIER.ColliderDesc, body: RAPIER.RigidBody): RAPIER.Collider {
    return this.world.createCollider(desc, body);
  }

  removeRigidBody(body: RAPIER.RigidBody): void {
    this.world.removeRigidBody(body);
  }

  /**
   * Rebuild the scene-query acceleration structure.
   *
   * Rapier only refreshes it inside `step()`, so a collider created since the
   * last step is invisible to `castRay` — verified: a ray at a fresh trimesh
   * misses before the first step and hits after. Streaming creates colliders
   * every time a chunk enters the ring, and both the spawn probe and the ambient
   * prop placement raycast immediately afterwards, so those callers must refresh
   * explicitly or silently get zero hits.
   */
  refreshQueries(): void {
    if (!this.initialized) return;
    this.world.queryPipeline.update(this.world.colliders);
  }

  castRay(
    origin: { x: number; y: number; z: number },
    dir: { x: number; y: number; z: number },
    maxToi: number,
    excludeBody?: RAPIER.RigidBody
  ): { hit: boolean; toi: number; point: { x: number; y: number; z: number }; normal: { x: number; y: number; z: number } } {
    const ray = new RAPIER.Ray(origin, dir);
    const hit = this.world.castRayAndGetNormal(ray, maxToi, true, undefined, undefined, undefined, excludeBody);
    if (hit) {
      const point = ray.pointAt(hit.timeOfImpact);
      return {
        hit: true,
        toi: hit.timeOfImpact,
        point,
        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      };
    }
    return { hit: false, toi: maxToi, point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } };
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

export { RAPIER };
