/**
 * CityLoader — facade over the streamed, pre-baked city.
 *
 * The city is no longer a single 25 MB FBX. `scripts/bake-city.mjs` has already
 * split it into 125 m chunks (LOD0 + a decimated LOD1) plus seven downsized
 * texture parts under assets/city/. This module owns the small amount of glue
 * Game.ts needs: load the manifest, stand up the streaming stack (textures,
 * per-chunk colliders, chunk streamer), block boot until the ground under the
 * spawn point is resident, and scatter the cheap ambient props (parked cars,
 * street lights, trees) that make the street grid feel inhabited.
 *
 * Nothing here ever touches assets/sanfranscisco/ — those seven 8192² textures
 * are ~2.4 GB of VRAM on a 1536 MB GPU, which is the crash this replaces.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { AssetLoader } from '../core/AssetLoader';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { CONFIG } from '../core/Config';
import { CITY_BASE_URL, CityManifestIndex, loadCityManifest, worldToChunk } from './CityManifest';
import { CityTextures } from './CityTextures';
import { ChunkColliders } from './ChunkColliders';
import { StreamingStats, StreamingWorld } from './StreamingWorld';

// Ambient prop tuning — visual-only, no colliders, no shadow casting.
const PROP_SEED = 0x5eed5eed; // deterministic layout for reproducible sessions
const PARKED_CAR_COUNT = 30;
const STREET_LIGHT_COUNT = 40;
const TREE_COUNT = 12;
// Props are placed once, at boot, by raycasting the chunk colliders — and only
// the chunks inside CONFIG.streaming.colliderRadius have colliders then. Casting
// across the whole 1876 m district would therefore throw away >95% of the work,
// so the prop grid is a box around the spawn point sized to the collider ring.
const PROP_RADIUS_CHUNKS = 2;
const ROAD_GRID_X = 170; // N-S road spacing (m)
const ROAD_GRID_Z = 140; // E-W road spacing (m)
const PROP_STEP = 35; // spacing between candidate slots along a road (m)
const ROAD_OFFSET = 3; // parked cars offset from the road centerline (m)
const LIGHT_OFFSET = 2.5; // street lights offset from the road centerline (m)
const LIGHT_SPACING = 60; // nominal spacing between lights along a road (m)
const SPAWN_CLEAR_RADIUS = 35; // keep props away from the player spawn area (m)
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// The baked city spans 1876 x 171 x 1867 m, so ground probes start well above
// the tallest hill and reach far below sea level. ChunkColliders keeps a safety
// floor at y = -59, and a ray that only reaches that floor means "no city here"
// (unloaded chunk or open water), so hits at or below MIN_GROUND_Y are refused.
const PROBE_ORIGIN_Y = 400;
const PROBE_LENGTH = 900;
const MIN_GROUND_Y = -50;

const CAR_COLORS = [0xcfd2d6, 0x2b2f33, 0x3a3f45, 0x9aa0a6, 0x8a2b26, 0x1f4f7a, 0x2e5e2e, 0x6b6f72];
const POLE_COLOR = 0x3d4045;
const BULB_COLOR = 0xffd27a;
const TRUNK_COLORS = [0x6b4a2f, 0x7a5a35, 0x5d4430];
const FOLIAGE_COLORS = [0x2e6b2e, 0x3a7a3a, 0x276427];

/** Deterministic PRNG so the prop layout is stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candidate prop location on the street grid, before ground is resolved. */
interface PropSpot {
  x: number;
  z: number;
  yaw: number;
}

/** Prop location with a real ground height under it. */
interface PlacedProp extends PropSpot {
  y: number;
}

const EMPTY_STATS: StreamingStats = {
  loaded: 0,
  pending: 0,
  colliders: 0,
  tris: 0,
  lod0: 0,
  lod1: 0,
  chunkCx: 0,
  chunkCz: 0,
};

export class CityLoader {
  readonly group = new THREE.Group();

  /**
   * Boot-time progress hook, set by Game before load(). `phase` is 'textures'
   * while the shared part textures warm up and 'chunks' while the spawn-area
   * chunks stream in, so the loading bar can weight them differently.
   */
  onBootProgress: ((phase: 'textures' | 'chunks', done: number, total: number) => void) | null = null;

  private index: CityManifestIndex | null = null;
  private textures: CityTextures | null = null;
  private colliders: ChunkColliders | null = null;
  private streaming: StreamingWorld | null = null;
  private lowEnd = false;

  private parkedCarCount = 0;
  private streetLightCount = 0;
  private treeCount = 0;

  /** Geometries/materials created for the ambient props, freed in dispose(). */
  private propGeometries: THREE.BufferGeometry[] = [];
  private propMaterials: THREE.Material[] = [];
  /**
   * The InstancedMeshes themselves, kept so dispose() can free their instance
   * matrix/colour buffers — those are GPU-side too, and removing the mesh from
   * the group does not release them.
   */
  private propMeshes: THREE.InstancedMesh[] = [];

  // Reused scratch — no allocation in update() or in the placement loops.
  private probeOrigin = { x: 0, y: PROBE_ORIGIN_Y, z: 0 };
  private probeDir = { x: 0, y: -1, z: 0 };
  private tmpMatrix = new THREE.Matrix4();
  private tmpQuat = new THREE.Quaternion();
  private tmpPos = new THREE.Vector3();
  private tmpScale = new THREE.Vector3(1, 1, 1);
  private tmpColor = new THREE.Color();

  /**
   * Stand the streaming city up. Resolves only once the chunks around the spawn
   * point are fully resident and collidable, so the very first frame has ground
   * under the car instead of a fall through the world.
   *
   * `loader` is kept for signature compatibility with Game.ts — the baked city
   * is fetched directly from assets/city/ and needs no AssetLoader entry.
   */
  async load(loader: AssetLoader, physics: PhysicsWorld): Promise<void> {
    void loader;

    const manifest = await loadCityManifest(CITY_BASE_URL);
    this.index = new CityManifestIndex(manifest);
    this.textures = new CityTextures(manifest, CITY_BASE_URL);
    this.colliders = new ChunkColliders(physics);
    this.streaming = new StreamingWorld({
      physics,
      manifest,
      textures: this.textures,
      colliders: this.colliders,
      baseUrl: CITY_BASE_URL,
    });
    if (this.lowEnd) this.textures.setLowEnd(true);

    // Far textures for every part first: a chunk that streams in later always
    // has something to draw with while its near texture is still downloading.
    if (this.onBootProgress) this.onBootProgress('textures', 0, 1);
    await this.textures.warmup();
    if (this.onBootProgress) this.onBootProgress('textures', 1, 1);

    const spawn = CONFIG.vehicle.spawnPosition;
    await this.streaming.warmup(spawn.x, spawn.z, (done, total) => {
      if (this.onBootProgress) this.onBootProgress('chunks', done, total);
    });
    this.group.add(this.streaming.group);

    if (this.lowEnd) this.streaming.setRadii(2, 3, 1, 1);

    // The warmup colliders were created without a physics step in between, and
    // Rapier only refreshes its scene-query structures inside step() — without
    // this, every ground probe below (and Game's spawn probe) misses and the
    // city looks like open water.
    physics.refreshQueries();

    // Ambient life: parked cars, street lights, and trees (visual only, cheap).
    this.buildAmbientProps(physics);
  }

  /** Per-frame entry point: advance chunk streaming around the car. */
  update(position: THREE.Vector3, dt: number): void {
    if (!this.streaming) return;
    this.streaming.update(position.x, position.z, dt);
  }

  /**
   * Place decorative props along the street grid using pooled InstancedMeshes.
   * Created once at boot and never streamed — three InstancedMesh draw calls of
   * a few dozen instances each are cheaper than any bookkeeping around them.
   *
   * Ground is resolved by a downward raycast against the freshly warmed-up
   * chunk colliders; a spot whose ray misses is dropped rather than pinned to
   * y=0, where it would float over the bay. Only chunks inside the collider
   * radius have colliders at boot, so the candidate grid is confined to a box of
   * that size around the spawn point — casting further out would only produce
   * misses.
   */
  private buildAmbientProps(physics: PhysicsWorld): void {
    const rand = mulberry32(PROP_SEED);
    const spawn = CONFIG.vehicle.spawnPosition;
    const reach = PROP_RADIUS_CHUNKS * CONFIG.streaming.chunkSize;
    const minX = spawn.x - reach;
    const maxX = spawn.x + reach;
    const minZ = spawn.z - reach;
    const maxZ = spawn.z + reach;
    // Road centerlines stay on the global grid so the layout does not shift when
    // the spawn point moves; only the window into it follows the car.
    const gridX = this.streetGrid(minX, maxX, ROAD_GRID_X);
    const gridZ = this.streetGrid(minZ, maxZ, ROAD_GRID_Z);

    // Parked cars along the curb, offset ~3m from each road centerline.
    const carSpots: PropSpot[] = [];
    for (const x of gridX) {
      let side = 1;
      for (let z = minZ; z <= maxZ; z += PROP_STEP) {
        if (this.isNearSpawn(x, z)) continue;
        carSpots.push({ x: x + side * ROAD_OFFSET, z, yaw: (rand() * 2 - 1) * 0.06 });
        side = -side;
      }
    }
    for (const z of gridZ) {
      let side = 1;
      for (let x = minX; x <= maxX; x += PROP_STEP) {
        if (this.isNearSpawn(x, z)) continue;
        carSpots.push({ x, z: z + side * ROAD_OFFSET, yaw: Math.PI / 2 + (rand() * 2 - 1) * 0.06 });
        side = -side;
      }
    }
    this.shuffle(carSpots, rand);
    const cars = this.placeOnGround(carSpots, PARKED_CAR_COUNT, physics);
    this.parkedCarCount = cars.length;

    const carGeo = this.buildCarGeometry();
    const carMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.35 });
    this.propGeometries.push(carGeo);
    this.propMaterials.push(carMat);
    const carMesh = new THREE.InstancedMesh(carGeo, carMat, cars.length);
    for (let i = 0; i < cars.length; i++) {
      const s = cars[i];
      this.writeInstance(carMesh, i, s.x, s.y, s.z, s.yaw, 1);
      this.tmpColor.set(CAR_COLORS[i % CAR_COLORS.length]);
      carMesh.setColorAt(i, this.tmpColor);
    }
    carMesh.castShadow = false;
    carMesh.receiveShadow = false;
    carMesh.instanceMatrix.needsUpdate = true;
    if (carMesh.instanceColor) carMesh.instanceColor.needsUpdate = true;
    this.propMeshes.push(carMesh);
    this.group.add(carMesh);

    // Street lights (pole cylinder + emissive bulb box) along the roads.
    const lightSpots: PropSpot[] = [];
    for (const x of gridX) {
      let side = 1;
      for (let z = minZ; z <= maxZ; z += LIGHT_SPACING) {
        lightSpots.push({ x: x + side * LIGHT_OFFSET, z, yaw: 0 });
        side = -side;
      }
    }
    for (const z of gridZ) {
      let side = 1;
      for (let x = minX; x <= maxX; x += LIGHT_SPACING) {
        lightSpots.push({ x, z: z + side * LIGHT_OFFSET, yaw: 0 });
        side = -side;
      }
    }
    this.shuffle(lightSpots, rand);
    const lightCandidates: PropSpot[] = [];
    for (const s of lightSpots) {
      if (this.nearAny(s.x, s.z, cars, 4)) continue;
      lightCandidates.push(s);
    }
    const lights = this.placeOnGround(lightCandidates, STREET_LIGHT_COUNT, physics);
    this.streetLightCount = lights.length;

    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6.0, 8);
    poleGeo.translate(0, 3.0, 0);
    const bulbGeo = new THREE.BoxGeometry(0.5, 0.3, 0.5);
    bulbGeo.translate(0, 6.05, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: POLE_COLOR, roughness: 0.6, metalness: 0.3 });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff2d0,
      emissive: BULB_COLOR,
      emissiveIntensity: 1.0,
      roughness: 0.3,
    });
    this.propGeometries.push(poleGeo, bulbGeo);
    this.propMaterials.push(poleMat, bulbMat);
    const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, lights.length);
    const bulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, lights.length);
    for (let i = 0; i < lights.length; i++) {
      const s = lights[i];
      this.writeInstance(poleMesh, i, s.x, s.y, s.z, 0, 1);
      this.writeInstance(bulbMesh, i, s.x, s.y, s.z, 0, 1);
    }
    poleMesh.castShadow = false;
    bulbMesh.castShadow = false;
    poleMesh.instanceMatrix.needsUpdate = true;
    bulbMesh.instanceMatrix.needsUpdate = true;
    this.propMeshes.push(poleMesh, bulbMesh);
    this.group.add(poleMesh);
    this.group.add(bulbMesh);

    // Trees in side lots: one per block interior, kept clear of roads and props.
    const treeSpots: PropSpot[] = [];
    for (let i = 0; i < gridX.length - 1; i++) {
      for (let j = 0; j < gridZ.length - 1; j++) {
        if (rand() > 0.6) continue;
        const hx = (gridX[i + 1] - gridX[i]) / 2 - 8;
        const hz = (gridZ[j + 1] - gridZ[j]) / 2 - 8;
        if (hx < 2 || hz < 2) continue;
        const x = (gridX[i] + gridX[i + 1]) / 2 + (rand() * 2 - 1) * hx;
        const z = (gridZ[j] + gridZ[j + 1]) / 2 + (rand() * 2 - 1) * hz;
        if (this.isNearSpawn(x, z)) continue;
        treeSpots.push({ x, z, yaw: rand() * Math.PI * 2 });
      }
    }
    this.shuffle(treeSpots, rand);
    const treeCandidates: PropSpot[] = [];
    for (const s of treeSpots) {
      if (this.nearAny(s.x, s.z, cars, 6) || this.nearAny(s.x, s.z, lights, 4)) continue;
      treeCandidates.push(s);
    }
    const trees = this.placeOnGround(treeCandidates, TREE_COUNT, physics);
    this.treeCount = trees.length;

    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.18, 1.6, 6);
    trunkGeo.translate(0, 0.8, 0);
    const foliageGeo = new THREE.ConeGeometry(1.5, 3.4, 8);
    foliageGeo.translate(0, 3.0, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
    this.propGeometries.push(trunkGeo, foliageGeo);
    this.propMaterials.push(trunkMat, foliageMat);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
    const foliageMesh = new THREE.InstancedMesh(foliageGeo, foliageMat, trees.length);
    for (let i = 0; i < trees.length; i++) {
      const s = trees[i];
      const scale = 0.85 + rand() * 0.5;
      this.writeInstance(trunkMesh, i, s.x, s.y, s.z, s.yaw, scale);
      this.writeInstance(foliageMesh, i, s.x, s.y, s.z, s.yaw, scale);
      this.tmpColor.set(TRUNK_COLORS[i % TRUNK_COLORS.length]);
      trunkMesh.setColorAt(i, this.tmpColor);
      this.tmpColor.set(FOLIAGE_COLORS[i % FOLIAGE_COLORS.length]);
      foliageMesh.setColorAt(i, this.tmpColor);
    }
    trunkMesh.castShadow = false;
    foliageMesh.castShadow = false;
    trunkMesh.instanceMatrix.needsUpdate = true;
    foliageMesh.instanceMatrix.needsUpdate = true;
    if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
    if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
    this.propMeshes.push(trunkMesh, foliageMesh);
    this.group.add(trunkMesh);
    this.group.add(foliageMesh);

    console.info(
      `[CityLoader] props: ${this.parkedCarCount} cars, ${this.streetLightCount} lights, ${this.treeCount} trees`
    );
  }

  /**
   * Take candidates in order until `limit` of them have solid ground beneath.
   * Candidates whose probe misses are dropped — at boot only the chunks inside
   * the collider radius are collidable, so the surviving props are exactly the
   * ones near the spawn, which is also the only place the player can see them
   * on the first frame.
   */
  private placeOnGround(spots: PropSpot[], limit: number, physics: PhysicsWorld): PlacedProp[] {
    const out: PlacedProp[] = [];
    for (const s of spots) {
      if (out.length >= limit) break;
      const y = this.groundY(s.x, s.z, physics);
      if (y === null) continue;
      out.push({ x: s.x, z: s.z, yaw: s.yaw, y });
    }
    return out;
  }

  /**
   * Street centerlines inside [min, max], snapped to global multiples of `step`
   * so the road layout is absolute — moving the window does not slide the roads.
   */
  private streetGrid(min: number, max: number, step: number): number[] {
    const out: number[] = [];
    const first = Math.ceil(min / step) * step;
    for (let v = first; v <= max + 0.001; v += step) out.push(v);
    return out;
  }

  /** Within the clear radius of the actual spawn point, not of the origin. */
  private isNearSpawn(x: number, z: number): boolean {
    const spawn = CONFIG.vehicle.spawnPosition;
    const dx = x - spawn.x;
    const dz = z - spawn.z;
    return dx * dx + dz * dz < SPAWN_CLEAR_RADIUS * SPAWN_CLEAR_RADIUS;
  }

  private nearAny(x: number, z: number, spots: PropSpot[], radius: number): boolean {
    const r2 = radius * radius;
    for (const s of spots) {
      const dx = s.x - x;
      const dz = s.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  private shuffle<T>(arr: T[], rand: () => number): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
  }

  /**
   * Ground height under (x, z) via a downward raycast against the streamed city
   * colliders, or null when there is nothing there — an unloaded chunk, open
   * water, or only the safety floor far below.
   */
  private groundY(x: number, z: number, physics: PhysicsWorld): number | null {
    this.probeOrigin.x = x;
    this.probeOrigin.y = PROBE_ORIGIN_Y;
    this.probeOrigin.z = z;
    const hit = physics.castRay(this.probeOrigin, this.probeDir, PROBE_LENGTH);
    if (hit.hit && hit.point.y > MIN_GROUND_Y) return hit.point.y;
    return null;
  }

  /** Low-poly sedan silhouette (body + cabin merged) with its base at y=0. */
  private buildCarGeometry(): THREE.BufferGeometry {
    const body = new THREE.BoxGeometry(1.8, 0.5, 4.0);
    body.translate(0, 0.25, 0);
    const cabin = new THREE.BoxGeometry(1.6, 0.55, 1.9);
    cabin.translate(0, 0.95, -0.2);
    const merged = mergeGeometries([body, cabin], false);
    body.dispose();
    cabin.dispose();
    return merged ?? new THREE.BoxGeometry(1.8, 0.5, 4.0);
  }

  /** Compose a per-instance matrix (position, yaw around Y, uniform scale). */
  private writeInstance(
    mesh: THREE.InstancedMesh,
    index: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number
  ): void {
    this.tmpPos.set(x, y, z);
    this.tmpQuat.setFromAxisAngle(UP_AXIS, yaw);
    this.tmpScale.set(scale, scale, scale);
    this.tmpMatrix.compose(this.tmpPos, this.tmpQuat, this.tmpScale);
    mesh.setMatrixAt(index, this.tmpMatrix);
  }

  /** Total number of ambient prop instances currently placed in the city. */
  getPropCount(): number {
    return this.parkedCarCount + this.streetLightCount + this.treeCount;
  }

  /** Per-type prop instance counts for stats/HUD reporting. */
  getPropBreakdown(): { cars: number; lights: number; trees: number } {
    return { cars: this.parkedCarCount, lights: this.streetLightCount, trees: this.treeCount };
  }

  /** Chunk streaming counters for the debug HUD. */
  getStreamingStats(): StreamingStats {
    return this.streaming ? this.streaming.getStats() : EMPTY_STATS;
  }

  /**
   * Baked world bounds from the manifest, for the minimap's coordinate mapping.
   * Null until load() has fetched the manifest.
   */
  getWorldBounds(): { min: { x: number; z: number }; max: { x: number; z: number } } | null {
    if (!this.index) return null;
    const b = this.index.manifest.bounds;
    return { min: { x: b.min[0], z: b.min[2] }, max: { x: b.max[0], z: b.max[2] } };
  }

  /** Resident chunk cells, written into the caller's array. Returns the count. */
  collectLoadedCells(out: { cx: number; cz: number }[]): number {
    return this.streaming ? this.streaming.collectLoadedCells(out) : 0;
  }

  /** Wet-road look during rain; forwarded to the shared part materials. */
  setWetness(wetness: number): void {
    if (this.textures) this.textures.setWetness(wetness);
  }

  /**
   * Y below which the car has fallen out of the world (through a chunk whose
   * colliders were not resident). Callers respawn when they cross it.
   */
  get voidY(): number {
    return this.colliders ? this.colliders.floorY + 2 : -50;
  }

  /**
   * Low-end mode: far textures only, and a tighter streaming footprint so the
   * GPU holds a quarter of the geometry and the fetch queue stays short. Safe to
   * call before load(); the flag is replayed once the stack exists.
   */
  setLowEnd(lowEnd: boolean): void {
    this.lowEnd = lowEnd;
    if (this.textures) this.textures.setLowEnd(lowEnd);
    if (!this.streaming) return;
    if (lowEnd) {
      this.streaming.setRadii(2, 3, 1, 1);
    } else {
      const s = CONFIG.streaming;
      this.streaming.setRadii(s.loadRadius, s.keepRadius, s.colliderRadius, s.lod1Radius);
    }
  }

  /**
   * Panic-only geometry shed: tighten the streaming radii so the resident
   * geometry and physics footprint shrink to a quarter, WITHOUT dropping the
   * 1024² near textures. `setLowEnd(true)` bundles both and erases the city's
   * identity; a genuine stall is best answered by holding fewer chunks, not by
   * blinding the chunks that remain. Safe before load().
   */
  shedRadius(): void {
    if (this.streaming) this.streaming.setRadii(2, 3, 1, 1);
  }

  /**
   * Snap the configured spawn point down onto real city geometry. Probes the
   * configured position first, then a short spiral of nearby offsets, and takes
   * the first ray that lands on the streamed colliders rather than on the safety
   * floor. If every probe misses — a spawn point over water, or chunks that
   * failed to load — it falls back to the top of the nearest baked chunk's AABB
   * so the car always starts on something solid.
   */
  findSpawnPoint(physics: PhysicsWorld): { x: number; y: number; z: number } {
    const spawn = CONFIG.vehicle.spawnPosition;
    const offsets = [
      { x: 0, z: 0 },
      { x: 8, z: 0 },
      { x: -8, z: 0 },
      { x: 0, z: 8 },
      { x: 0, z: -8 },
      { x: 18, z: 18 },
      { x: -18, z: -18 },
      { x: 40, z: 0 },
      { x: 0, z: 40 },
      { x: -40, z: -40 },
    ];
    for (const o of offsets) {
      const x = spawn.x + o.x;
      const z = spawn.z + o.z;
      const y = this.groundY(x, z, physics);
      if (y !== null) return { x, y: y + 1.5, z };
    }

    const { cx, cz } = worldToChunk(spawn.x, spawn.z, CONFIG.streaming.chunkSize);
    const nearest = this.index?.nearestEntry(cx, cz);
    if (nearest) {
      const mx = (nearest.min[0] + nearest.max[0]) * 0.5;
      const mz = (nearest.min[2] + nearest.max[2]) * 0.5;
      return { x: mx, y: nearest.max[1] + 2, z: mz };
    }
    return { x: spawn.x, y: spawn.y, z: spawn.z };
  }

  /** Free everything: streamed chunks, textures, colliders, and prop assets. */
  dispose(): void {
    if (this.streaming) {
      this.streaming.dispose();
      this.streaming = null;
    }
    if (this.textures) {
      this.textures.dispose();
      this.textures = null;
    }
    if (this.colliders) {
      this.colliders.dispose();
      this.colliders = null;
    }
    for (const mesh of this.propMeshes) mesh.dispose();
    for (const geo of this.propGeometries) geo.dispose();
    for (const mat of this.propMaterials) mat.dispose();
    this.propMeshes.length = 0;
    this.propGeometries.length = 0;
    this.propMaterials.length = 0;
    this.group.clear();
    this.index = null;
    this.parkedCarCount = 0;
    this.streetLightCount = 0;
    this.treeCount = 0;
  }
}

