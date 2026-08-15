/**
 * ChunkColliders — per-chunk static Rapier trimesh colliders for the streamed
 * city. One fixed rigid body per chunk key, one trimesh collider per baked
 * section, created when a chunk enters the collider radius and destroyed when it
 * leaves. This replaces the old single-body / whole-city approach so the solver
 * only ever sees the few hundred triangles the car can actually touch.
 *
 * Chunk vertices are baked in final world metres, so no body or collider
 * translation is ever applied. A single persistent safety floor sits far below
 * the city so a car that drives off an unloaded edge lands instead of falling
 * forever; callers compare against `floorY` to detect that and respawn.
 *
 * No per-frame work happens in this module — build/remove are the only entry
 * points and both are driven by StreamingWorld's chunk bookkeeping.
 */

import { PhysicsWorld, RAPIER } from '../physics/PhysicsWorld';
import { ChunkData, ChunkSectionData } from './ChunkFormat';

const FRICTION = 0.95;
const RESTITUTION = 0.02;

/** Half-extents / depth of the persistent catch floor under the whole city. */
const FLOOR_HALF_X = 2000;
const FLOOR_HALF_Y = 1;
const FLOOR_HALF_Z = 2000;
const FLOOR_CENTER_Y = -60;

export class ChunkColliders {
  /** Top surface of the safety floor: a car below this fell through the world. */
  readonly floorY = FLOOR_CENTER_Y + FLOOR_HALF_Y;

  /**
   * Bumped on every build/remove that changed the world. Rapier only refreshes
   * its scene-query structures inside `step()`, so a caller that raycasts in the
   * same frame a chunk streamed in has to know something changed and refresh —
   * see PhysicsWorld.refreshQueries.
   */
  private revisionCounter = 0;

  private physics: PhysicsWorld;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private floorBody: RAPIER.RigidBody | null = null;

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
    this.floorBody = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    physics.createCollider(
      RAPIER.ColliderDesc.cuboid(FLOOR_HALF_X, FLOOR_HALF_Y, FLOOR_HALF_Z)
        .setTranslation(0, FLOOR_CENTER_Y, 0)
        .setFriction(1),
      this.floorBody
    );
  }

  /**
   * Build the collider body for `key` from already-parsed chunk geometry.
   * Idempotent: an existing key is left untouched. Degenerate sections are
   * skipped and a section that Rapier rejects falls back to a convex hull, so a
   * single bad mesh can never abort the rest of the chunk.
   */
  build(key: string, data: ChunkData): void {
    if (this.bodies.has(key)) return;

    const body = this.physics.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    let built = 0;

    for (let i = 0; i < data.sections.length; i++) {
      const section = data.sections[i];
      if (section.position.length < 9 || section.index.length < 3) continue;
      if (this.buildSection(body, section, key, i)) built++;
    }

    // A body with zero usable colliders is pure overhead in the broad phase.
    if (built === 0) {
      this.physics.removeRigidBody(body);
      return;
    }
    this.bodies.set(key, body);
    this.revisionCounter++;
  }

  /** Remove a chunk's body; its colliders die with it. Safe for unknown keys. */
  remove(key: string): void {
    const body = this.bodies.get(key);
    if (!body) return;
    this.bodies.delete(key);
    this.physics.removeRigidBody(body);
    this.revisionCounter++;
  }

  /** Monotonic counter of collider-set changes; see `revisionCounter`. */
  get revision(): number {
    return this.revisionCounter;
  }

  has(key: string): boolean {
    return this.bodies.has(key);
  }

  /** Number of live chunk bodies (the safety floor is not counted). */
  get count(): number {
    return this.bodies.size;
  }

  /** Drop every chunk body and the safety floor. */
  dispose(): void {
    for (const body of this.bodies.values()) this.physics.removeRigidBody(body);
    this.bodies.clear();
    if (this.floorBody) {
      this.physics.removeRigidBody(this.floorBody);
      this.floorBody = null;
    }
  }

  /**
   * Attach one section to `body`. Returns false only if neither the trimesh nor
   * the convex-hull fallback could be created.
   */
  private buildSection(
    body: RAPIER.RigidBody,
    section: ChunkSectionData,
    key: string,
    sectionIndex: number
  ): boolean {
    // Rapier needs an owned Float32Array of positions and 32-bit indices; the
    // parsed views are zero-copy over the fetched buffer, so slice()/widen only
    // where the wasm boundary forces it.
    const vertices =
      section.position.byteOffset === 0 && section.position.length * 4 === section.position.buffer.byteLength
        ? section.position
        : section.position.slice();
    const indices =
      section.index instanceof Uint32Array && section.index.byteOffset === 0
        ? section.index
        : new Uint32Array(section.index);

    try {
      const desc = RAPIER.ColliderDesc.trimesh(vertices, indices)
        .setFriction(FRICTION)
        .setRestitution(RESTITUTION);
      this.physics.createCollider(desc, body);
      return true;
    } catch (err) {
      console.warn(`[ChunkColliders] trimesh failed for chunk ${key} section ${sectionIndex}, trying hull`, err);
    }

    try {
      const hull = RAPIER.ColliderDesc.convexHull(vertices);
      if (!hull) {
        console.warn(`[ChunkColliders] convex hull null for chunk ${key} section ${sectionIndex}, skipping`);
        return false;
      }
      this.physics.createCollider(hull.setFriction(FRICTION).setRestitution(RESTITUTION), body);
      return true;
    } catch (err) {
      console.warn(`[ChunkColliders] convex hull failed for chunk ${key} section ${sectionIndex}, skipping`, err);
      return false;
    }
  }
}
