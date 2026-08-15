/**
 * StreamingWorld — the city streamer: keeps a ring of baked chunks resident
 * around a moving point (the car) and nothing else.
 *
 * It decides which chunks should exist for the current cell, asks ChunkStore for
 * them, turns arrivals into THREE meshes inside a strict per-frame millisecond
 * budget, hands the close ones to ChunkColliders, and disposes everything the
 * moment it leaves the keep ring. Two CPU cores and 1536 MB of VRAM mean the
 * work must be spread across frames instead of done in one burst, so every stage
 * is capped: `maxLoadsPerFrame` fetches, `maxUnloadsPerFrame` disposals and
 * `budgetMsPerFrame` of mesh/collider building, with the remainder deferred to
 * the next frame via an internal ready queue.
 *
 * The steady state — car still inside the same cell with nothing outstanding —
 * short-circuits on the second line of update() and costs nothing.
 */

import * as THREE from 'three';
import { CONFIG, clamp } from '../core/Config';
import {
  CITY_BASE_URL,
  CityChunkEntry,
  CityManifest,
  CityManifestIndex,
  chunkKey,
  worldToChunk,
} from './CityManifest';
import { ChunkData } from './ChunkFormat';
import { ChunkLod, ChunkStore } from './ChunkStore';
import { CityTextures } from './CityTextures';
import { ChunkColliders } from './ChunkColliders';
import { PhysicsWorld } from '../physics/PhysicsWorld';

export interface StreamingStats {
  loaded: number;
  pending: number;
  colliders: number;
  tris: number;
  lod0: number;
  lod1: number;
  chunkCx: number;
  chunkCz: number;
}

export interface StreamingWorldOptions {
  physics: PhysicsWorld;
  manifest: CityManifest;
  textures: CityTextures;
  colliders: ChunkColliders;
  baseUrl?: string;
}

interface LoadedChunk {
  entry: CityChunkEntry;
  lod: ChunkLod;
  key: string;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  tris: number;
  /**
   * Parsed source data, kept so a collider can still be built later if the car
   * turns back towards an already-visible chunk. This costs no extra RAM: the
   * BufferAttributes below are views onto the very same ArrayBuffer, so it is
   * alive for as long as the geometries are either way.
   */
  data: ChunkData;
}

interface ReadyChunk {
  entry: CityChunkEntry;
  lod: ChunkLod;
  data: ChunkData;
}

interface PendingChunk {
  entry: CityChunkEntry;
  lod: ChunkLod;
}

/**
 * The per-frame path is deliberately scalar-only — cell distances are integer
 * Chebyshev maths and chunk vertices are already in world space — so there are
 * no Vector3/Matrix4 temporaries to reuse and nothing is allocated per frame
 * beyond the geometries of a chunk actually being built.
 */

/** Chebyshev (square-ring) distance in chunk cells. */
function cheb(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax > bx ? ax - bx : bx - ax;
  const dz = az > bz ? az - bz : bz - az;
  return dx > dz ? dx : dz;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class StreamingWorld {
  readonly group = new THREE.Group();

  private readonly index: CityManifestIndex;
  private readonly store: ChunkStore;
  private readonly textures: CityTextures;
  private readonly colliders: ChunkColliders;
  /** Held only so the streamer owns the same world its colliders live in. */
  private readonly physics: PhysicsWorld;
  private readonly chunkSize: number;

  private readonly chunks = new Map<string, LoadedChunk>();
  /** One outstanding request per chunk cell, with the entry+LOD it was asked for. */
  private readonly pending = new Map<string, PendingChunk>();
  /** Parsed chunks awaiting mesh construction; drained nearest-first. */
  private readonly ready: ReadyChunk[] = [];
  /**
   * `cx,cz:lod` pairs that rejected. ChunkStore already exhausts its own network
   * retries before rejecting, so a failure here means the file is missing or
   * corrupt — without this set the entry is neither loaded nor pending and
   * issueRequests would re-fetch it on literally every frame.
   */
  private readonly failed = new Set<string>();
  /**
   * The load ring for the current cell, cached because `entriesWithinRadius`
   * allocates and sorts. Streaming frames would otherwise rebuild a ~40-entry
   * array every frame for no new information.
   */
  private desired: CityChunkEntry[] = [];
  private desiredValid = false;

  private loadRadius = CONFIG.streaming.loadRadius;
  private keepRadius = CONFIG.streaming.keepRadius;
  private colliderRadius = CONFIG.streaming.colliderRadius;
  private lod1Radius = CONFIG.streaming.lod1Radius;

  private cellCx = 0;
  private cellCz = 0;
  private hasCell = false;
  /** Set when a pass ran out of budget so the next frame resumes the work. */
  private dirty = false;
  private totalTris = 0;
  private lod0Count = 0;
  private lod1Count = 0;
  private disposed = false;

  constructor(opts: StreamingWorldOptions) {
    this.physics = opts.physics;
    this.textures = opts.textures;
    this.colliders = opts.colliders;
    this.index = new CityManifestIndex(opts.manifest);
    this.chunkSize = opts.manifest.chunkSize;
    this.store = new ChunkStore(
      opts.baseUrl ?? CITY_BASE_URL,
      CONFIG.streaming.maxConcurrentFetches
    );
    this.group.name = 'CityStreaming';
    // Chunk meshes carry final world coordinates, so the group never moves and
    // three can skip its matrix update every frame.
    this.group.matrixAutoUpdate = false;
    this.group.updateMatrix();
  }

  /**
   * Load every chunk inside `warmupRadius` before the first frame is shown.
   * Runs off the frame budget on purpose — we are still behind the loading
   * screen, and a fully resident centre means the first second of driving never
   * pops geometry. A failure anywhere but the centre cell is logged and skipped
   * so one truncated .bin cannot block boot.
   */
  async warmup(
    x: number,
    z: number,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const { cx, cz } = worldToChunk(x, z, this.chunkSize);
    const entries = this.index.entriesWithinRadius(cx, cz, CONFIG.streaming.warmupRadius);
    const total = entries.length;

    // Kick every fetch off up front so the store's three-way concurrency is
    // actually used, then consume them nearest-first. Awaiting one at a time
    // would serialise ~25 downloads and triple the loading screen. Failures are
    // folded into the result so a rejection cannot go unhandled when an earlier
    // chunk aborts the loop.
    const lods: ChunkLod[] = [];
    const dists: number[] = [];
    const results: Promise<{ data: ChunkData | null; err: unknown }>[] = [];
    for (let i = 0; i < entries.length; i++) {
      const dist = cheb(entries[i].cx, entries[i].cz, cx, cz);
      const lod: ChunkLod = dist <= this.lod1Radius ? 0 : 1;
      dists.push(dist);
      lods.push(lod);
      results.push(
        this.store.request(entries[i], lod).then(
          (data) => ({ data, err: null }),
          (err: unknown) => ({ data: null, err })
        )
      );
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const { data, err } = await results[i];
      if (this.disposed) return;
      if (data !== null) {
        this.build(entry, lods[i], data, dists[i]);
      } else if (dists[i] === 0) {
        throw new Error(`StreamingWorld: centre chunk failed to load: ${describe(err)}`);
      } else {
        // Remember the failure so the first update() does not immediately try
        // the same broken file again.
        this.failed.add(`${chunkKey(entry.cx, entry.cz)}:${lods[i]}`);
        console.warn(
          `StreamingWorld: skipping chunk ${chunkKey(entry.cx, entry.cz)} at LOD${lods[i]}: ${describe(err)}`
        );
      }
      if (onProgress) onProgress(i + 1, total);
    }

    this.cellCx = cx;
    this.cellCz = cz;
    this.hasCell = true;
    // The load ring is wider than the warmup ring, so the first update() still
    // has requests to issue even though the cell has not changed.
    this.dirty = true;
  }

  /**
   * Per-frame tick. Cheap and early-returning while the car stays in one cell
   * with no outstanding work; otherwise it does one bounded slice of
   * request/build/unload and leaves the rest for the next frame.
   */
  update(x: number, z: number, _dt: number): void {
    if (this.disposed) return;
    const { cx, cz } = worldToChunk(x, z, this.chunkSize);
    const moved = !this.hasCell || cx !== this.cellCx || cz !== this.cellCz;
    if (!moved && !this.dirty && this.ready.length === 0 && this.pending.size === 0) return;

    this.cellCx = cx;
    this.cellCz = cz;
    this.hasCell = true;
    if (moved) this.desiredValid = false;

    const start = performance.now();
    const budget = CONFIG.streaming.budgetMsPerFrame;
    const revisionBefore = this.colliders.revision;

    // Arrivals first: they are already paid for, and turning them into meshes is
    // what actually makes the city appear. Always build at least one so a frame
    // that is already over budget still makes progress instead of starving.
    // Nearest-first, so a queue that outlives a cell change still fills in the
    // chunks under the car before the horizon.
    if (moved && this.ready.length > 1) {
      this.ready.sort(
        (a, b) =>
          cheb(a.entry.cx, a.entry.cz, cx, cz) - cheb(b.entry.cx, b.entry.cz, cx, cz)
      );
    }
    let builds = 0;
    while (this.ready.length > 0) {
      if (builds > 0 && performance.now() - start >= budget) break;
      const next = this.ready.shift();
      if (next === undefined) break;
      const dist = cheb(next.entry.cx, next.entry.cz, cx, cz);
      if (dist > this.keepRadius) continue; // drifted out while queued
      const existing = this.chunks.get(chunkKey(next.entry.cx, next.entry.cz));
      if (existing !== undefined) {
        if (existing.lod === next.lod) continue; // duplicate arrival
        this.unload(existing); // LOD swap: drop the old build first
      }
      this.build(next.entry, next.lod, next.data, dist);
      builds++;
    }

    const collidersDone = this.reconcileColliders(cx, cz, start, budget);
    const requestsDone = this.issueRequests(cx, cz);
    const unloadsDone = this.unloadFar(cx, cz);

    // A chunk that just gained (or lost) colliders is invisible to raycasts until
    // the query structures are rebuilt, and Rapier only does that inside step() —
    // which for this frame already ran. Traffic placement and the void check
    // raycast later in the same frame, so refresh now. Gated on the revision so
    // the QBVH rebuild only happens on the few frames that changed the world.
    if (this.colliders.revision !== revisionBefore) this.physics.refreshQueries();

    this.dirty =
      !collidersDone ||
      !requestsDone ||
      !unloadsDone ||
      this.ready.length > 0 ||
      this.pending.size > 0;
  }

  /**
   * Runtime radius override (PerformanceManager shrinks these on slow GPUs).
   * Clamped so keep >= load >= collider and keep >= load >= lod1, minimum 1.
   */
  setRadii(load: number, keep: number, collider: number, lod1: number): void {
    const nextLoad = Math.max(1, Math.floor(load));
    this.loadRadius = nextLoad;
    this.keepRadius = Math.max(nextLoad, Math.floor(keep));
    this.colliderRadius = clamp(Math.floor(collider), 1, nextLoad);
    this.lod1Radius = clamp(Math.floor(lod1), 1, nextLoad);
    // Radii changed: make the next update() do a full pass even though the car
    // has not crossed a cell boundary.
    this.dirty = true;
    this.desiredValid = false;
  }

  getStats(): StreamingStats {
    return {
      loaded: this.chunks.size,
      pending: this.pending.size,
      colliders: this.colliders.count,
      tris: this.totalTris,
      lod0: this.lod0Count,
      lod1: this.lod1Count,
      chunkCx: this.cellCx,
      chunkCz: this.cellCz,
    };
  }

  /**
   * Copy the currently-resident chunk cells into `out` and return how many were
   * written. Takes a caller-owned array so the per-frame minimap path allocates
   * nothing; entries beyond the returned count are stale and must be ignored.
   */
  collectLoadedCells(out: { cx: number; cz: number }[]): number {
    let n = 0;
    for (const chunk of this.chunks.values()) {
      if (n < out.length) {
        out[n].cx = chunk.entry.cx;
        out[n].cz = chunk.entry.cz;
      } else {
        out.push({ cx: chunk.entry.cx, cz: chunk.entry.cz });
      }
      n++;
    }
    return n;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.store.cancelAll();
    this.store.dispose();
    this.pending.clear();
    this.ready.length = 0;
    this.failed.clear();
    this.desired = [];
    this.desiredValid = false;
    for (const chunk of Array.from(this.chunks.values())) this.unload(chunk);
    this.chunks.clear();
    this.group.clear();
    this.totalTris = 0;
    this.lod0Count = 0;
    this.lod1Count = 0;
  }

  /**
   * Ask the store for what is missing, at most `maxLoadsPerFrame` per call.
   * Entries arrive nearest-first from the index, so the cap always spends itself
   * on the chunks closest to the car. Returns true when nothing is left to ask
   * for, so update() knows whether to run again next frame.
   */
  private issueRequests(cx: number, cz: number): boolean {
    let budget = CONFIG.streaming.maxLoadsPerFrame;
    if (!this.desiredValid) {
      this.desired = this.index.entriesWithinRadius(cx, cz, this.loadRadius);
      this.desiredValid = true;
    }
    const desired = this.desired;

    for (let i = 0; i < desired.length; i++) {
      const entry = desired[i];
      const key = chunkKey(entry.cx, entry.cz);
      const dist = cheb(entry.cx, entry.cz, cx, cz);
      const target: ChunkLod = dist <= this.lod1Radius ? 0 : 1;

      const pending = this.pending.get(key);
      if (pending !== undefined) {
        if (pending.lod === target) continue;
        // Target LOD changed mid-flight. Only worth swapping if the new LOD's
        // file is actually loadable; otherwise let the in-flight one finish.
        if (this.failed.has(`${key}:${target}`)) continue;
        // Drop the stale fetch and re-ask.
        if (budget <= 0) return false;
        this.pending.delete(key);
        this.store.cancel(entry, pending.lod);
        budget--;
        this.request(entry, target, key);
        continue;
      }

      const loaded = this.chunks.get(key);
      if (loaded !== undefined && loaded.lod === target) continue;
      if (this.failed.has(`${key}:${target}`)) continue; // known-bad file, never retry
      // Either absent, or resident at the wrong LOD and due for a swap. Both
      // cost one fetch; the swap only removes the old meshes once the new data
      // lands, so the city never flickers a hole.
      if (budget <= 0) return false;
      budget--;
      this.request(entry, target, key);
    }

    // Anything still pending but now beyond the keep ring is wasted bandwidth.
    for (const [key, task] of Array.from(this.pending.entries())) {
      if (cheb(task.entry.cx, task.entry.cz, cx, cz) <= this.keepRadius) continue;
      this.pending.delete(key);
      this.store.cancel(task.entry, task.lod);
    }

    return true;
  }

  /** Fire one store request and route its result into the ready queue. */
  private request(entry: CityChunkEntry, lod: ChunkLod, key: string): void {
    this.pending.set(key, { entry, lod });
    this.store
      .request(entry, lod)
      .then((data) => {
        // A newer request for the same cell (or a cancel) already superseded us.
        const task = this.pending.get(key);
        if (this.disposed || task === undefined || task.lod !== lod) return;
        this.pending.delete(key);
        this.ready.push({ entry, lod, data });
        this.dirty = true;
      })
      .catch((err: unknown) => {
        const task = this.pending.get(key);
        if (task !== undefined && task.lod === lod) this.pending.delete(key);
        if (this.disposed) return;
        // A cancel is our own doing and must stay retryable; anything else means
        // the store already exhausted its retries, so blacklist the file.
        if (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError') return;
        this.failed.add(`${key}:${lod}`);
        this.dirty = true;
        console.warn(`StreamingWorld: chunk ${key} LOD${lod} failed: ${describe(err)}`);
      });
  }

  /**
   * Add colliders for chunks that came inside the collider ring and drop the
   * ones that left it. Removals are free; a Rapier trimesh build is the most
   * expensive per-chunk operation there is, so builds share the frame budget —
   * except for the cell the car is standing in, which is never deferred or the
   * car would fall through the road.
   */
  private reconcileColliders(cx: number, cz: number, start: number, budget: number): boolean {
    let complete = true;
    for (const chunk of this.chunks.values()) {
      const dist = cheb(chunk.entry.cx, chunk.entry.cz, cx, cz);
      const inside = dist <= this.colliderRadius;
      const has = this.colliders.has(chunk.key);
      if (inside === has) continue;
      if (!inside) {
        this.colliders.remove(chunk.key);
        continue;
      }
      if (dist > 0 && performance.now() - start >= budget) {
        complete = false;
        continue;
      }
      this.colliders.build(chunk.key, chunk.data);
    }
    return complete;
  }

  /**
   * Unload chunks past the keep ring, farthest first, capped per frame. Sorting
   * only happens on frames that actually have something to drop.
   */
  private unloadFar(cx: number, cz: number): boolean {
    const cap = CONFIG.streaming.maxUnloadsPerFrame;
    let stale: LoadedChunk[] | null = null;
    for (const chunk of this.chunks.values()) {
      if (cheb(chunk.entry.cx, chunk.entry.cz, cx, cz) <= this.keepRadius) continue;
      if (stale === null) stale = [];
      stale.push(chunk);
    }
    if (stale === null) return true;
    if (stale.length > 1) {
      stale.sort(
        (a, b) =>
          cheb(b.entry.cx, b.entry.cz, cx, cz) - cheb(a.entry.cx, a.entry.cz, cx, cz)
      );
    }
    const n = stale.length < cap ? stale.length : cap;
    for (let i = 0; i < n; i++) this.unload(stale[i]);
    return n === stale.length;
  }

  /**
   * Turn one parsed chunk into meshes (one draw call per texture part) and, if
   * it is close enough, a collider. `dist` is passed in because every caller has
   * already computed it.
   */
  private build(entry: CityChunkEntry, lod: ChunkLod, data: ChunkData, dist: number): void {
    const key = chunkKey(entry.cx, entry.cz);
    const sections = data.sections;
    const meshes: THREE.Mesh[] = [];
    const geometries: THREE.BufferGeometry[] = [];
    let tris = 0;

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const geometry = new THREE.BufferGeometry();
      // The typed arrays are views onto the fetched ArrayBuffer — no copy here,
      // three uploads straight from them.
      geometry.setAttribute('position', new THREE.BufferAttribute(section.position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(section.normal, 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(section.uv, 2));
      geometry.setIndex(new THREE.BufferAttribute(section.index, 1));
      // Frustum culling needs the sphere; normals are already baked, so
      // computeVertexNormals would only burn CPU. three's own implementation
      // reuses module-level temporaries, so this allocates just the Sphere.
      geometry.computeBoundingSphere();

      // A chunk built at LOD0 is close enough to deserve the 1024² texture.
      // Fire-and-forget: ensureNear dedupes, no-ops on low-end, and repoints the
      // shared LOD0 material itself when the upload lands.
      if (lod === 0) void this.textures.ensureNear(section.part);

      const mesh = new THREE.Mesh(geometry, this.textures.getMaterial(section.part, lod));
      mesh.name = `city_${key}_p${section.part}_l${lod}`;
      // Vertices are final world metres: identity transform, computed once.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = true;
      this.group.add(mesh);

      meshes.push(mesh);
      geometries.push(geometry);
      tris += section.index.length / 3;
    }

    const chunk: LoadedChunk = { entry, lod, key, meshes, geometries, tris, data };
    this.chunks.set(key, chunk);
    this.totalTris += tris;
    if (lod === 0) this.lod0Count++;
    else this.lod1Count++;

    // Visible without a collider is intended beyond colliderRadius: the car
    // cannot reach those chunks before they come inside the ring.
    if (dist <= this.colliderRadius) this.colliders.build(key, data);
  }

  /**
   * Free one chunk. Materials belong to CityTextures and are shared across
   * chunks, so they are deliberately left alone — only geometries are ours.
   */
  private unload(chunk: LoadedChunk): void {
    for (let i = 0; i < chunk.meshes.length; i++) this.group.remove(chunk.meshes[i]);
    for (let i = 0; i < chunk.geometries.length; i++) chunk.geometries[i].dispose();
    chunk.meshes.length = 0;
    chunk.geometries.length = 0;
    this.colliders.remove(chunk.key);
    if (this.chunks.get(chunk.key) === chunk) this.chunks.delete(chunk.key);
    this.totalTris -= chunk.tris;
    if (this.totalTris < 0) this.totalTris = 0;
    if (chunk.lod === 0) {
      if (this.lod0Count > 0) this.lod0Count--;
    } else if (this.lod1Count > 0) {
      this.lod1Count--;
    }
  }
}
