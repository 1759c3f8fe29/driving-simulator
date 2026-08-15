export const meta = {
  name: 'radius-streaming-city',
  description: 'Radius-streamed GTA5-style city that runs on Intel HD 4000 / 1.5GB VRAM',
  phases: [
    { title: 'Streaming core' },
    { title: 'Runtime + perf' },
  ],
};

// ---------------------------------------------------------------------------
// FROZEN CONTRACT — every agent codes against this. Agents run in PARALLEL and
// cannot see each other's files, so these signatures are law. Do not rename,
// do not add required params, do not change return types.
// ---------------------------------------------------------------------------

const CONTRACT = `
## The baked asset format (ALREADY EXISTS ON DISK — do not regenerate it)

\`scripts/bake-city.mjs\` has already run. On disk right now:

    assets/city/city-manifest.json
    assets/city/chunks/c_<cx>_<cz>.bin        LOD0, 147 files, ~316KB avg
    assets/city/chunks/c_<cx>_<cz>.lod1.bin   LOD1, decimated (26% of tris)
    assets/city/tex/near/part-<0..6>.jpg      1024x1024
    assets/city/tex/far/part-<0..6>.jpg       512x512

Real numbers from the bake: world is 1876 x 171 x 1867 m, chunk grid cx -10..5 /
cz -10..5, chunkSize 125 m, city scale 250, 467k tris LOD0 / 122k tris LOD1,
45.4 MB LOD0 total / 11.9 MB LOD1 total.

The ORIGINAL assets (assets/sanfranscisco/city/*.jpg, 8192x8192, seven of them)
must NEVER be loaded at runtime again. They are ~2.4 GB of texture VRAM on a GPU
that has 1536 MB total. That is the crash we are fixing.

### city-manifest.json shape (verbatim)

    {
      "version": 1, "source": "...", "scale": 250, "chunkSize": 125,
      "grid":   { "minCx": -10, "maxCx": 5, "minCz": -10, "maxCz": 5 },
      "bounds": { "min": [x,y,z], "max": [x,y,z] },
      "textureRes": { "near": 1024, "far": 512 },
      "parts":  [ { "index": 0, "near": "tex/near/part-0.jpg", "far": "tex/far/part-0.jpg" }, ... ],
      "chunks": [ { "cx": -10, "cz": -3, "file": "chunks/c_-10_-3.bin",
                    "lod1": "chunks/c_-10_-3.lod1.bin",
                    "bytes": 12345, "lod1Bytes": 3456, "tris": 900, "lod1Tris": 300,
                    "min": [x,y,z], "max": [x,y,z], "parts": [2,4] }, ... ]
    }

All \`file\`/\`lod1\`/\`near\`/\`far\` values are RELATIVE to \`assets/city/\`.
\`lod1\` may be null. Chunk coords come from \`Math.floor(worldCoord / 125)\`.

### chunk .bin layout (little-endian)

    byte 0..3              magic ASCII 'CHK1'
    byte 4..7              headerLen: u32 (already 4-byte aligned)
    byte 8..8+headerLen    UTF-8 JSON header
    byte 8+headerLen..     payload; every array starts at a 4-byte-aligned
                           offset RELATIVE to the payload start

JSON header:

    { "cx": n, "cz": n, "min": [x,y,z], "max": [x,y,z],
      "sections": [ { "part": 0, "verts": 1234, "indices": 3600, "indexBytes": 2,
                      "pos": { "off": 0,    "len": 14808 },
                      "nor": { "off": 14808,"len": 14808 },
                      "uv":  { "off": 29616,"len": 9872  },
                      "idx": { "off": 39488,"len": 7200  } }, ... ] }

\`indexBytes\` is 2 (Uint16Array) or 4 (Uint32Array). pos/nor are 3 floats per
vertex, uv is 2 floats per vertex. Coordinates are FINAL WORLD METRES — already
scaled by 250 and transformed by the source matrixWorld. Apply no extra
transform. Each section is one draw call bound to city texture \`part\`.

## Frozen TypeScript interfaces

\`\`\`ts
// src/world/CityManifest.ts  (owned by agent A1)
export interface CityPartTex { index: number; near: string; far: string; }
export interface CityChunkEntry {
  cx: number; cz: number; file: string; lod1: string | null;
  bytes: number; lod1Bytes: number; tris: number; lod1Tris: number;
  min: [number, number, number]; max: [number, number, number]; parts: number[];
}
export interface CityManifest {
  version: number; source: string; scale: number; chunkSize: number;
  grid: { minCx: number; maxCx: number; minCz: number; maxCz: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  textureRes: { near: number; far: number };
  parts: CityPartTex[]; chunks: CityChunkEntry[];
}
export const CITY_BASE_URL = 'assets/city/';
export function chunkKey(cx: number, cz: number): string;          // \`\${cx},\${cz}\`
export function worldToChunk(x: number, z: number, chunkSize: number): { cx: number; cz: number };
export function loadCityManifest(baseUrl?: string): Promise<CityManifest>;
export class CityManifestIndex {
  constructor(manifest: CityManifest);
  readonly manifest: CityManifest;
  get(cx: number, cz: number): CityChunkEntry | undefined;
  entriesWithinRadius(cx: number, cz: number, radius: number): CityChunkEntry[];
  nearestEntry(cx: number, cz: number): CityChunkEntry | undefined;
}

// src/world/ChunkFormat.ts  (owned by agent A1)
export interface ChunkSectionData {
  part: number; position: Float32Array; normal: Float32Array;
  uv: Float32Array; index: Uint16Array | Uint32Array;
}
export interface ChunkData {
  cx: number; cz: number;
  min: [number, number, number]; max: [number, number, number];
  sections: ChunkSectionData[];
}
export function parseChunkBinary(buffer: ArrayBuffer): ChunkData;

// src/world/ChunkStore.ts  (owned by agent A2)
export type ChunkLod = 0 | 1;
export class ChunkStore {
  constructor(baseUrl: string, maxConcurrent: number);
  request(entry: CityChunkEntry, lod: ChunkLod): Promise<ChunkData>;
  cancel(entry: CityChunkEntry, lod: ChunkLod): void;
  cancelAll(): void;
  get pending(): number;
  get inFlight(): number;
  dispose(): void;
}

// src/world/CityTextures.ts  (owned by agent A4)
export class CityTextures {
  constructor(manifest: CityManifest, baseUrl: string);
  warmup(): Promise<void>;                          // far set for every part
  ensureNear(part: number): Promise<void>;
  getMaterial(part: number, lod: ChunkLod): THREE.Material;
  setLowEnd(lowEnd: boolean): void;                 // lowEnd => far textures only
  setWetness(w: number): void;
  dispose(): void;
}

// src/world/ChunkColliders.ts  (owned by agent A5)
export class ChunkColliders {
  constructor(physics: PhysicsWorld);
  build(key: string, data: ChunkData): void;        // idempotent per key
  remove(key: string): void;
  has(key: string): boolean;
  get count(): number;
  dispose(): void;
}

// src/world/StreamingWorld.ts  (owned by agent A3)
export interface StreamingStats {
  loaded: number; pending: number; colliders: number;
  tris: number; lod0: number; lod1: number; chunkCx: number; chunkCz: number;
}
export class StreamingWorld {
  readonly group: THREE.Group;
  constructor(opts: {
    physics: PhysicsWorld; manifest: CityManifest;
    textures: CityTextures; colliders: ChunkColliders; baseUrl?: string;
  });
  warmup(x: number, z: number, onProgress?: (done: number, total: number) => void): Promise<void>;
  update(x: number, z: number, dt: number): void;
  setRadii(load: number, keep: number, collider: number, lod1: number): void;
  getStats(): StreamingStats;
  dispose(): void;
}

// src/world/CityLoader.ts  (owned by agent A6 — REWRITE, keep this public API)
export class CityLoader {
  readonly group: THREE.Group;
  load(loader: AssetLoader, physics: PhysicsWorld): Promise<void>;
  update(position: THREE.Vector3, dt: number): void;
  findSpawnPoint(physics: PhysicsWorld): { x: number; y: number; z: number };
  getPropCount(): number;
  getPropBreakdown(): { cars: number; lights: number; trees: number };
  getStreamingStats(): StreamingStats;
  setLowEnd(lowEnd: boolean): void;
  dispose(): void;
}
\`\`\`

## Config you may read (already exists in src/core/Config.ts — do NOT edit it)

    CONFIG.world.cityScale          250
    CONFIG.world.cityYOffset        0
    CONFIG.streaming.enabled        true
    CONFIG.streaming.chunkSize      125
    CONFIG.streaming.loadRadius     3
    CONFIG.streaming.keepRadius     5
    CONFIG.streaming.colliderRadius 2
    CONFIG.streaming.lod1Radius     2
    CONFIG.streaming.maxLoadsPerFrame    1
    CONFIG.streaming.maxUnloadsPerFrame  2
    CONFIG.streaming.budgetMsPerFrame    4
    CONFIG.streaming.maxConcurrentFetches 3
    CONFIG.streaming.warmupRadius   2
    CONFIG.streaming.textureRes        { near: 1024, far: 512 }
    CONFIG.streaming.lowEndTextureRes  { near: 512,  far: 256 }
    CONFIG.boot.directToDriving     true
    CONFIG.boot.skipIntro           true

Helpers exported from Config: \`clamp\`, \`lerp\`, \`damp\`, \`isMobile\`.
`;

const GROUND = `
${CONTRACT}

## GROUND RULES — violating any of these breaks the build for everyone

1. You own EXACTLY the file(s) named in your task. Do not create, read-modify or
   write ANY other source file. Other agents are editing other files right now.
2. NEVER edit: src/app/Game.ts, src/main.ts, src/core/Config.ts,
   src/ui/UIManager.ts, src/save/SaveManager.ts, src/ui/ui.css, index.html,
   package.json, vite.config.ts, or anything under scripts/. The integrator
   wires everything together afterwards.
3. Do NOT run npm/npx/tsc/vite/node. Cross-module imports you depend on may not
   exist yet while agents run in parallel — a failing typecheck is expected and
   is NOT your problem. The integrator typechecks at the end.
4. Import the frozen contract types from their real paths with RELATIVE imports,
   e.g. \`import { CityManifest } from './CityManifest';\`. Assume they exist and
   match the contract exactly.
5. Target: Intel HD Graphics 4000, 1536 MB VRAM, i3-3110M (2 cores/4 threads),
   7.6 GB RAM. Every allocation matters. Reuse typed arrays and temporaries;
   never allocate THREE.Vector3/Matrix4 inside a per-frame loop.
6. Dispose properly. Every geometry/texture/material you create must be
   disposed when its chunk unloads, or the GPU leaks and the laptop dies again.
   Removing a mesh from a group does NOT free VRAM.
7. TypeScript strict mode. No \`any\` unless genuinely unavoidable (then narrow
   it immediately). No non-null \`!\` on values that can actually be null.
8. No TODO / FIXME / "implement later" / placeholder stubs. Ship complete,
   working code. If a decision is ambiguous, pick the cheapest correct option
   and note the choice in a code comment.
9. Match the house style of the existing codebase: a \`/** ... */\` header
   comment on every file explaining what the module is for, named exports, no
   default exports, tab-free 2-space indent, single quotes, semicolons.
10. Never load anything from assets/sanfranscisco/ at runtime.

## What to report back

Reply with ONLY a terse report, no prose preamble:
- each file you wrote (path + line count)
- your file's exported API, one line per export, exact signatures
- anything you had to assume about another agent's module
- anything a caller MUST do (e.g. "call update() every frame with the car position")
`;

// ---------------------------------------------------------------------------
// Phase 1 — the streaming core. Disjoint file ownership, fully parallel.
// ---------------------------------------------------------------------------

const phase1 = [
  {
    label: 'A1-manifest-format',
    prompt: `You own TWO new files: \`src/world/CityManifest.ts\` and \`src/world/ChunkFormat.ts\`.

Everyone else depends on you, so implement the frozen contract EXACTLY.

### src/world/CityManifest.ts
- The interfaces from the contract, exported verbatim.
- \`CITY_BASE_URL = 'assets/city/'\`.
- \`chunkKey(cx, cz)\` returns \`\\\`\\\${cx},\\\${cz}\\\`\`.
- \`worldToChunk(x, z, chunkSize)\` uses Math.floor.
- \`loadCityManifest(baseUrl = CITY_BASE_URL)\`: fetch \`\\\${baseUrl}city-manifest.json\`,
  throw a descriptive Error on !res.ok, validate that version === 1, chunkSize > 0
  and chunks.length > 0, then return the parsed manifest.
- \`CityManifestIndex\`: build a \`Map<string, CityChunkEntry>\` keyed by chunkKey in
  the constructor. \`get\` is a map lookup. \`entriesWithinRadius(cx, cz, radius)\`
  scans the square ring cx-radius..cx+radius / cz-radius..cz+radius (skip missing
  keys — the grid is sparse, only 147 of 256 cells exist) and returns entries
  sorted ASCENDING by Chebyshev distance from (cx,cz) so the caller naturally
  loads nearest-first. \`nearestEntry\` finds the manifest entry with the smallest
  Chebyshev distance — used as a spawn fallback when the car is off-grid.

### src/world/ChunkFormat.ts
- \`parseChunkBinary(buffer)\`: read the 4-byte magic and throw if it is not
  'CHK1'. Read headerLen as u32 at byte 4. JSON.parse the UTF-8 header from byte
  8 (use TextDecoder; the header is padded to a 4-byte boundary, so trim any
  trailing NUL bytes before parsing). payloadStart = 8 + headerLen. For each
  section create Float32Array views for pos/nor/uv and a Uint16Array or
  Uint32Array for idx per \`indexBytes\`, each at \`payloadStart + off\`.
  Prefer \`new Float32Array(buffer, byteOffset, length)\` zero-copy views; the
  bake guarantees 4-byte alignment so this is safe. Validate that every
  \`off + len\` stays inside the buffer and throw a descriptive Error otherwise.
- Also export \`chunkDataTriangles(data: ChunkData): number\` summing
  \`index.length / 3\` over sections — the stats path uses it.

Keep both files small and allocation-free at parse time beyond the views.`,
  },
  {
    label: 'A2-chunk-store',
    prompt: `You own ONE new file: \`src/world/ChunkStore.ts\`.

A bounded-concurrency, cancellable fetch+parse queue for chunk binaries.

- \`constructor(baseUrl: string, maxConcurrent: number)\`.
- \`request(entry, lod)\`: resolve the URL as \`baseUrl + (lod === 1 && entry.lod1 ? entry.lod1 : entry.file)\`
  — so a chunk with \`lod1: null\` transparently falls back to LOD0. Dedupe: two
  requests for the same (entry, lod) share one in-flight promise, keyed by
  \`\\\`\\\${chunkKey(entry.cx, entry.cz)}:\\\${lod}\\\`\`. Queue beyond maxConcurrent.
  Fetch with \`{ signal }\` from an AbortController, \`res.arrayBuffer()\`, then
  \`parseChunkBinary\`. Retry twice on network failure with 250ms then 600ms
  backoff; do NOT retry an AbortError. Reject with a descriptive Error including
  the URL after the final attempt.
- \`cancel(entry, lod)\`: abort if in flight, or drop from the queue if still
  queued; the pending promise must reject with an AbortError-shaped error so
  callers can filter it. Removing a queued item must not stall the pump.
- \`cancelAll()\` / \`dispose()\`: abort everything and clear all state. dispose()
  must make later request() calls reject rather than start new fetches.
- \`pending\` = queued count, \`inFlight\` = active fetch count.
- Drive the queue with a small private \`pump()\` that starts work while
  \`inFlight < maxConcurrent\` and the queue is non-empty, and is called again in
  a \`finally\` on each settle. No busy-waiting, no setInterval.

Import types from \`./CityManifest\` and \`./ChunkFormat\` (see contract).
Zero DOM, zero THREE — this file is pure data plumbing.`,
  },
  {
    label: 'A3-streaming-world',
    prompt: `You own ONE new file: \`src/world/StreamingWorld.ts\`. This is the heart of the feature.

Radius-based load/unload of city chunks around a moving point (the car), with a
strict per-frame budget so a 2-core i3 never hitches.

Implement the frozen \`StreamingWorld\` contract. Internals:

- Keep \`private chunks = new Map<string, LoadedChunk>()\` where LoadedChunk holds
  \`{ entry, lod, meshes: THREE.Mesh[], geometries: THREE.BufferGeometry[], tris: number, key: string }\`.
- \`update(x, z, dt)\`:
  1. \`worldToChunk\` the position. If the chunk cell is unchanged since last
     frame AND nothing is pending, return immediately — this is the common case
     and must cost nothing.
  2. Desired set = \`index.entriesWithinRadius(cx, cz, loadRadius)\` (already
     nearest-first). Issue at most \`maxLoadsPerFrame\` new \`store.request()\` calls
     per frame for entries not loaded and not already requested.
  3. Target LOD per chunk: Chebyshev distance <= \`lod1Radius\` => LOD 0, else LOD 1.
     If a loaded chunk's LOD no longer matches its target, re-request at the new
     LOD and swap on arrival (count the swap against maxLoadsPerFrame).
  4. Unload: any loaded chunk with Chebyshev distance > \`keepRadius\`, at most
     \`maxUnloadsPerFrame\` per frame, farthest first. Also \`store.cancel()\` any
     pending request that has fallen outside keepRadius.
  5. Respect \`budgetMsPerFrame\`: track \`performance.now()\` at the top of the
     mesh-building work and stop building more meshes this frame once the budget
     is spent, deferring the rest to the next frame via an internal ready queue.
- Building a chunk: for each section create a \`THREE.BufferGeometry\`, set
  position/normal/uv \`BufferAttribute\`s from the parsed typed arrays and
  \`setIndex\`, call \`computeBoundingSphere()\` (needed for frustum culling; skip
  computeVertexNormals, the bake already has normals), then one
  \`THREE.Mesh(geo, textures.getMaterial(section.part, lod))\`. Set
  \`mesh.matrixAutoUpdate = false\`, \`mesh.updateMatrix()\` once,
  \`receiveShadow = true\`, \`castShadow = false\`, \`frustumCulled = true\`. Add to
  \`this.group\`.
- Colliders: build via \`colliders.build(key, data)\` only when Chebyshev distance
  <= \`colliderRadius\`; call \`colliders.remove(key)\` when a chunk goes beyond it
  OR unloads. A chunk can be visible with no collider — that is intended and the
  car never gets there.
- Unloading MUST: remove meshes from the group, \`geometry.dispose()\` every
  geometry, \`colliders.remove(key)\`. Do NOT dispose materials — \`CityTextures\`
  owns and shares those across chunks.
- \`warmup(x, z, onProgress)\`: await every entry within \`CONFIG.streaming.warmupRadius\`
  of the given position, building meshes and colliders immediately (ignore the
  frame budget here — we are still on the loading screen), calling
  \`onProgress(done, total)\` after each. Reject only if the CENTER chunk fails;
  log a console.warn and continue for any other individual failure so one bad
  file can't block boot.
- \`setRadii(load, keep, collider, lod1)\` overrides the config radii at runtime
  (PerformanceManager shrinks them on slow hardware). Clamp so
  \`keep >= load >= collider\` and \`keep >= load >= lod1\`, minimum 1.
- \`getStats()\` fills every StreamingStats field; \`lod0\`/\`lod1\` are counts of
  currently-loaded chunks at each LOD.
- \`dispose()\`: cancelAll on the store, unload every chunk, clear the group.

Read radii/budget defaults from \`CONFIG.streaming\` (import from '../core/Config').
Reuse a module-level \`THREE.Vector3\`/\`Box3\` for any temporary math; allocate
nothing per frame. Import \`clamp\` from Config rather than writing your own.`,
  },
  {
    label: 'A4-city-textures',
    prompt: `You own ONE new file: \`src/world/CityTextures.ts\`.

Shared material/texture pool for the 7 city parts. This module is the single
reason the game stopped crashing, so be strict about VRAM.

- \`constructor(manifest: CityManifest, baseUrl: string)\`. Nothing loads in the
  constructor.
- Maintain, per part index 0..6: a far texture (512px) and optionally a near
  texture (1024px), plus ONE shared \`THREE.MeshStandardMaterial\` per part per LOD
  tier. Total steady state must be at most 7 near + 7 far textures.
- \`warmup()\`: load the FAR texture for all 7 parts in parallel via
  \`THREE.TextureLoader.loadAsync\`, set \`colorSpace = THREE.SRGBColorSpace\`,
  \`anisotropy = 4\`, \`generateMipmaps = true\`, \`minFilter = THREE.LinearMipmapLinearFilter\`,
  \`wrapS = wrapT = THREE.ClampToEdgeWrapping\`. Resolve when all 7 are in.
  This is the boot-time cost: 7 x 512² = 5.5 MB of VRAM. That is the budget.
- \`ensureNear(part)\`: lazily load the 1024px texture for one part and, once it
  arrives, point the part's LOD0 material at it (\`material.map = near;
  material.needsUpdate = true\`). Idempotent, dedupes concurrent calls, and
  resolves immediately if already loaded. 7 x 1024² = 22 MB worst case.
- \`getMaterial(part, lod)\`: return the shared material for that part. LOD0
  materials use the near texture when available and fall back to far until it
  arrives. LOD1 materials always use far. \`roughness\` around 0.85,
  \`metalness\` 0.0, \`fog: true\`, \`side: THREE.FrontSide\`, \`dithering: false\`.
  Clamp an unknown part index into range rather than throwing — a malformed
  chunk must not kill the frame.
- \`setLowEnd(true)\`: dispose every near texture, point all materials at far, and
  make subsequent \`ensureNear\` calls no-ops until \`setLowEnd(false)\`. This is
  the emergency VRAM valve the perf watchdog pulls.
- \`setWetness(w)\`: 0..1, raise \`metalness\` toward ~0.35 and drop \`roughness\`
  toward ~0.25 across all materials so rain reads on the streets. Use \`clamp\`
  and \`lerp\` from '../core/Config'.
- \`dispose()\`: dispose every texture and every material, clear all maps.

Texture URLs come from \`manifest.parts[i].near\` / \`.far\`, joined onto baseUrl.
Never construct a URL pointing at assets/sanfranscisco/.`,
  },
  {
    label: 'A5-chunk-colliders',
    prompt: `You own ONE new file: \`src/world/ChunkColliders.ts\`.

Per-chunk Rapier trimesh colliders that can be created and destroyed as the car
moves. This replaces the old approach of one giant body with ~7 decimated
trimeshes for the entire city.

- \`constructor(physics: PhysicsWorld)\`. Import \`{ PhysicsWorld, RAPIER }\` from
  '../physics/PhysicsWorld' (RAPIER is re-exported there — do NOT import
  '@dimforge/rapier3d-compat' directly).
- \`build(key, data)\`: create ONE fixed \`RAPIER.RigidBodyDesc.fixed()\` rigid body
  per chunk, then one trimesh collider per section of that chunk. Vertices in
  \`section.position\` are already final world metres, so pass them straight
  through — set NO translation on the body or collider. Rapier's trimesh wants
  \`Float32Array\` vertices and a \`Uint32Array\` index; when a section's index is a
  Uint16Array, convert with \`new Uint32Array(section.index)\`. Friction 0.95,
  restitution 0.02.
  Idempotent: if \`has(key)\` already, return immediately without rebuilding.
  Wrap each collider creation in try/catch — on failure \`console.warn\` and fall
  back to \`RAPIER.ColliderDesc.convexHull(vertices)\`; if the hull is also null,
  skip that section. One bad section must never abort the chunk.
- Skip degenerate sections: fewer than 3 vertices or fewer than 3 indices.
- \`remove(key)\`: \`physics.removeRigidBody(body)\` (this destroys its colliders
  with it) and delete the map entry. Must be safe to call for an unknown key.
- \`has(key)\`, \`count\` (number of live chunk bodies), \`dispose()\` (remove all).
- Also create ONE persistent safety floor in the constructor:
  \`RAPIER.ColliderDesc.cuboid(2000, 1, 2000).setTranslation(0, -60, 0).setFriction(1)\`
  on its own fixed body, so a car that falls through an unloaded chunk lands on
  something instead of falling forever. Expose \`readonly floorY = -59\` so callers
  can detect "fell through the world" and respawn.

Keep a \`Map<string, RAPIER.RigidBody>\`. No per-frame work in this module at all.`,
  },
  {
    label: 'A6-city-loader-rewrite',
    prompt: `You own ONE existing file, which you REWRITE COMPLETELY: \`src/world/CityLoader.ts\`.

Read it first. Today it: loads the whole 25 MB FBX at once, retextures materials
by name, decimates every mesh into ONE giant collider body, and places 30 parked
cars / 40 street lights / 12 trees as InstancedMeshes on a road grid
(ROAD_GRID_X 170, ROAD_GRID_Z 140, CITY_HALF_X 930, CITY_HALF_Z 730, seeded by
mulberry32(0x5eed5eed)). Keep the ambient-prop code — it is good and the grid
constants finally make sense now that the city is scaled to ~1876 m. Throw away
everything that touches the FBX and the monolithic collider.

The new CityLoader is a thin facade over the streaming stack, preserving the
public API in the contract so \`Game.ts\` barely changes:

- \`load(loader, physics)\`: \`loadCityManifest()\`, build a \`CityManifestIndex\`,
  construct \`CityTextures\` + \`ChunkColliders\` + \`StreamingWorld\`, \`await textures.warmup()\`,
  then \`await streaming.warmup(spawnX, spawnZ)\` centred on \`CONFIG.vehicle.spawnPosition\`
  — so the ground under the car exists before the first frame. Add
  \`streaming.group\` to \`this.group\`. Then \`buildAmbientProps(physics)\` as today.
  The \`loader: AssetLoader\` param is now unused for the city; keep it in the
  signature (Game.ts passes it) and reference it with \`void loader;\` so strict
  mode stays happy.
- \`update(position, dt)\`: forward to \`streaming.update(position.x, position.z, dt)\`.
  This is the per-frame entry point. Cheap and allocation-free.
- \`findSpawnPoint(physics)\`: keep the downward-raycast approach but make it work
  with the real 1876 m city — raycast from y=400 down 900 units at the existing
  candidate offsets, and additionally accept a hit only if \`point.y > -50\`.
  If every candidate misses (chunks near origin may be empty water), fall back to
  the centre of \`index.nearestEntry(0, 0)\`'s AABB, +2 m in Y. Return
  \`{ x, y: hit.point.y + 1.5, z }\`.
- \`getPropCount()\` / \`getPropBreakdown()\`: unchanged behaviour.
- \`getStreamingStats()\`: delegate to \`streaming.getStats()\`.
- \`setLowEnd(lowEnd)\`: forward to \`textures.setLowEnd\` AND shrink the streaming
  radii via \`streaming.setRadii(2, 3, 1, 1)\` when true, restoring the
  \`CONFIG.streaming\` values when false.
- \`dispose()\`: dispose streaming, textures, colliders, and the prop
  geometries/materials you created.

Ambient props must sit on real ground: keep the existing raycast-based Y
placement but use the same y=400 / 900-length ray as findSpawnPoint, and SKIP a
prop whose ray misses entirely rather than dropping it at y=0 where it would
float over water. Props are created once at boot (they are cheap InstancedMeshes)
— do not stream them.

Import \`CONFIG\` from '../core/Config'. Everything else comes from the sibling
modules in the contract.`,
  },
];

// ---------------------------------------------------------------------------
// Phase 2 — runtime, perf and boot-path support. Also fully parallel; these
// files do not import the phase-1 modules except through the frozen contract.
// ---------------------------------------------------------------------------

const phase2 = [
  {
    label: 'B1-low-end-detect',
    prompt: `You own ONE new file: \`src/performance/HardwareProfile.ts\`.

Detect weak hardware BEFORE the heavy loading starts, so the game can pick a
low-end profile on the first frame instead of thrashing and crashing.

\`\`\`ts
export interface HardwareInfo {
  renderer: string;         // WEBGL_debug_renderer_info UNMASKED_RENDERER_WEBGL, or ''
  vendor: string;
  maxTextureSize: number;
  cores: number;            // navigator.hardwareConcurrency || 2
  deviceMemoryGb: number;   // (navigator as any).deviceMemory || 0 (0 = unknown)
  softwareRasterized: boolean;
  integrated: boolean;
  lowEnd: boolean;
  tier: 'low' | 'medium' | 'high';
  reasons: string[];
}
export function detectHardware(renderer: THREE.WebGLRenderer): HardwareInfo;
export function describeHardware(info: HardwareInfo): string;
\`\`\`

- Read the unmasked renderer string via
  \`gl.getExtension('WEBGL_debug_renderer_info')\` on \`renderer.getContext()\`;
  handle the extension being null (privacy modes) without throwing.
- \`integrated\` if the renderer string matches /intel|hd graphics|uhd|iris|mali|adreno|apple gpu|llvmpipe|swiftshader|softpipe/i.
- \`softwareRasterized\` if it matches /llvmpipe|swiftshader|softpipe|软/i.
- \`lowEnd\` when ANY of: softwareRasterized; cores <= 4 && integrated;
  maxTextureSize <= 4096; deviceMemoryGb > 0 && deviceMemoryGb <= 4;
  /hd graphics (2|3|4)\\d{3}/i (Sandy/Ivy/Haswell-era Intel — exactly this laptop).
- \`tier\`: 'low' when lowEnd, 'high' when !integrated && cores >= 8, else 'medium'.
- \`reasons\` accumulates a short human string for each rule that fired, so the
  integrator can console.info why the game chose low-end.
- \`describeHardware\` returns a single compact line for logging.

Never throw: every getter must be wrapped so a hostile/limited WebGL context
degrades to \`tier: 'medium'\` rather than breaking boot. Import \`* as THREE from 'three'\`
for the type only.`,
  },
  {
    label: 'B2-perf-watchdog',
    prompt: `You own ONE existing file: \`src/performance/PerformanceManager.ts\`. EXTEND it — do not rewrite.

Read it first. It has: \`QUALITY_LEVELS\` (4 levels, index 0 best), rolling
\`smoothedFps\`, adaptive step-down after DOWN_SAMPLE_SECONDS of sustained slow
frames, step-up after UP_SAMPLE_SECONDS, emits 'performance:level', F10 debug
overlay, \`levelIndex\`, \`getQualityConfig()\`, \`update(fps, dt)\`, \`refreshStats()\`,
\`renderOverlay()\`, \`isOverlayVisible()\`.

KEEP every existing public member working exactly as it does now. Add:

1. \`setStreamingStatsProvider(fn: () => { loaded: number; pending: number; colliders: number; tris: number; lod0: number; lod1: number })\`
   and show those numbers in the F10 overlay as a "STREAM" row
   (\`chunks 24 (18/6 lod)  pend 2  col 9  312k tris\`). If no provider is set the
   row is omitted entirely.

2. A **panic watchdog**, because on this hardware a stall is what kills the
   laptop. Track consecutive frames whose frameTime exceeds 250 ms. After 3 such
   frames within a 2-second window, emit a new event \`'performance:panic'\` ONCE
   (re-armable only after 20 s of healthy frames) and immediately jump
   \`levelIndex\` to the worst quality level. Export the event name as
   \`export const PERF_PANIC_EVENT = 'performance:panic';\`.

3. \`startLowEnd(): void\` — force \`levelIndex\` to 2, disable step-up for the
   first 30 seconds of the session (so a slow boot doesn't immediately get
   upgraded back), and lower the internal FPS target to 30. Idempotent.

4. \`getFrameTimeP95(): number\` — 95th percentile frame time over the rolling
   window. Keep the existing ring buffer if there is one, otherwise add a small
   fixed-size Float32Array ring (120 samples) and compute the percentile by
   copying into a scratch array and sorting; never allocate per frame.

5. \`export const LOW_END_TARGET_FPS = 30;\`

Do NOT touch \`src/core/Config.ts\`. Read config only if it already imports it.`,
  },
  {
    label: 'B3-boot-direct',
    prompt: `You own ONE new file: \`src/app/BootFlow.ts\`.

The user wants the game to open DIRECTLY into driving with controls — no main
menu at all. \`Game.ts\` will call into this module (the integrator wires it), so
your job is to encapsulate the decision logic and the loading-screen phases with
zero dependency on Game internals.

\`\`\`ts
export type BootPhase = 'init' | 'physics' | 'manifest' | 'textures' | 'chunks' | 'vehicle' | 'ready';
export interface BootPhaseInfo { phase: BootPhase; label: string; weight: number; }
export const BOOT_PHASES: BootPhaseInfo[] = [...];   // weights sum to 1

export class BootProgress {
  constructor(onProgress: (percent: number, label: string) => void);
  begin(phase: BootPhase): void;
  advance(phase: BootPhase, fraction: number): void;   // fraction 0..1 within the phase
  complete(phase: BootPhase): void;
  finish(): void;                                       // clamps to 100
  get percent(): number;
}

export interface BootDecision {
  directToDriving: boolean;
  playIntro: boolean;
  lowEnd: boolean;
  reason: string;
}
export function decideBoot(opts: { lowEnd: boolean; hasSave: boolean; forceMenu?: boolean }): BootDecision;
\`\`\`

- Sensible phase weights for this game: init 0.05, physics 0.05, manifest 0.05,
  textures 0.25, chunks 0.45, vehicle 0.10, ready 0.05.
- \`BootProgress\` must be monotonic: percent NEVER goes backwards, even if a
  caller advances phases out of order. Round to a whole percent before invoking
  the callback, and skip the callback when the rounded value and label are both
  unchanged (the loading screen does DOM writes).
- \`decideBoot\`: \`directToDriving\` is \`CONFIG.boot.directToDriving && !forceMenu\`.
  \`playIntro\` is \`CONFIG.cinematics.driveIntro && !CONFIG.boot.skipIntro && !lowEnd\`
  — on this laptop the cinematic swoop is exactly the wrong thing to spend the
  first 4 seconds on. \`reason\` is a short human string explaining the choice, for
  console.info.
- Also export \`export function bootPhaseLabel(phase: BootPhase): string;\` with
  player-facing text ('Preparing physics', 'Streaming city', ...).

Import \`CONFIG\` from '../core/Config' (read only). No THREE, no DOM.`,
  },
  {
    label: 'B4-loading-screen',
    prompt: `You own ONE existing file: \`src/ui/LoadingScreen.ts\`. Read it, then upgrade it.

Requirements:
- KEEP every existing public method signature working (\`Game.ts\` and
  \`UIManager.ts\` call them; the integrator will not fix your breakage).
  Read the file and preserve the API exactly — typically \`show()\`, \`hide()\`,
  \`setProgress(percent)\` / progress-event handling, and any \`setLabel\`-like method.
- ADD \`setPhase(label: string)\` and \`setDetail(text: string)\` if they don't
  already exist, for the streaming phase text ('Streaming city 42/96 chunks').
- ADD \`setTip(text: string)\` plus an internal rotating tip list of 6 short
  driving-game tips that cycles every 4 seconds while visible (use one
  \`setInterval\`, cleared on \`hide()\` — never leak the timer).
- The bar must be GPU-cheap: animate \`transform: scaleX()\` on a fill element, not
  \`width\`, and never trigger layout per update. Guard against redundant DOM
  writes by caching the last written values.
- Make it look like a real game boot screen: title, thin animated progress bar,
  phase text, percent readout, tip line at the bottom. Build the DOM in TS as
  the file already does; classes prefixed \`ls-\` for anything new so the existing
  CSS is untouched. Include the small amount of CSS you need as a single
  injected \`<style>\` element created once (id-guarded so it is never
  double-injected) — you may NOT edit \`src/ui/ui.css\`, another agent owns it.
- \`hide()\` must fade out over ~350 ms and then set \`display: none\`, and be
  idempotent.

Do not import anything new beyond what the file already uses plus \`clamp\` from
'../core/Config'.`,
  },
  {
    label: 'B5-traffic-radius',
    prompt: `You own ONE existing file: \`src/world/Traffic.ts\`. Read it, then make it radius-aware.

Today \`update(dt, playerPos)\` drives AI cars over a road grid that assumed a
city of a certain size. The city is now a real 1876 x 1867 m district streamed in
125 m chunks, and physics colliders only exist within
\`CONFIG.streaming.colliderRadius\` chunks of the car. Traffic outside that has no
ground to drive on.

Changes, all backward compatible (\`constructor(scene, physics)\`, \`update(dt, playerPos)\`,
\`dispose()\` must keep their exact signatures):

1. Cull and recycle by distance: any AI car further than
   \`CONFIG.streaming.colliderRadius * CONFIG.streaming.chunkSize\` metres from the
   player gets recycled to a fresh spawn point on the road grid ~60-110 m ahead
   of the player instead of continuing to simulate. Never let the visible count
   exceed the existing pool size.
2. Add \`setMaxActive(n: number)\`: a runtime cap on how many AI cars simulate,
   for the low-end profile. Cars above the cap are hidden
   (\`mesh.visible = false\`) and skipped entirely in \`update\`, not destroyed.
   Also add \`getActiveCount(): number\`.
3. Add \`setEnabled(on: boolean)\`: hides and fully skips all traffic. The low-end
   path may turn traffic off completely.
4. Ground check: before placing or recycling a car, raycast down from
   \`y = position.y + 30\` for 120 units via \`physics.castRay\`; if there is no hit,
   the target chunk isn't loaded yet — skip that placement this frame and retry
   later rather than dropping a car into the void. Do not spam the ray: at most
   \`4\` placement rays per frame across all cars.
5. Per-frame allocation must be zero. Hoist any \`THREE.Vector3\`/\`Quaternion\`
   temporaries to module scope or instance fields.

Import \`CONFIG\` from '../core/Config'. Keep the existing visual style of the
cars; this is a behaviour change, not a redesign.`,
  },
  {
    label: 'B6-minimap-world',
    prompt: `You own ONE existing file: \`src/ui/Minimap.ts\`. Read it, then rescale and upgrade it.

The city is now a real 1876 x 1867 m district centred near the origin (baked
bounds roughly x -1310..566, z -1310..557 — read the true numbers at runtime, do
not hardcode mine). The minimap was written against different assumptions and now
shows the player pinned in a corner or off-map.

Changes, keeping the existing public API intact (\`update(position, headingY)\` and
whatever else \`Game.ts\`/\`UIManager.ts\` already call — read the file and preserve
every signature):

1. Add \`setWorldBounds(min: { x: number; z: number }, max: { x: number; z: number }): void\`.
   The integrator calls this once at boot with the real baked bounds. Until it is
   called, fall back to whatever the file assumes today so nothing breaks.
2. Draw a proper local view: a rotating player arrow at the centre, a
   north indicator, and a subtle grid whose spacing is
   \`CONFIG.streaming.chunkSize\` world metres so the player can see chunk
   boundaries. Keep whatever range/zoom concept the file already has.
3. Add \`setLoadedChunks(keys: ReadonlyArray<{ cx: number; cz: number }>): void\`
   — shade cells that are currently streamed in. Cheap: only redraw when the set
   actually changes (compare a joined key string or a running hash), never every
   frame.
4. Add \`setEnabled(on: boolean)\`. On low-end hardware the minimap redraw is real
   cost and gets turned off.
5. Performance: this is a 2D canvas on a 2-core i3. Redraw at most 12 times per
   second regardless of how often \`update\` is called — accumulate dt internally
   and early-return. Cache the static layer (grid + compass) into an offscreen
   canvas and blit it, redrawing that layer only when bounds/zoom change.

Import \`CONFIG\` from '../core/Config'.`,
  },
];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

log(`Radius streaming: ${phase1.length} core agents, then ${phase2.length} runtime agents.`);

phase('Streaming core');
const core = await parallel(
  phase1.map((a) => () => agent(`${GROUND}\n\n# YOUR TASK\n\n${a.prompt}`, {
    label: a.label,
    phase: 'Streaming core',
  }))
);

log(`Core done: ${core.filter(Boolean).length}/${phase1.length} ok.`);

phase('Runtime + perf');
const runtime = await parallel(
  phase2.map((a) => () => agent(`${GROUND}\n\n# YOUR TASK\n\n${a.prompt}`, {
    label: a.label,
    phase: 'Runtime + perf',
  }))
);

log(`Runtime done: ${runtime.filter(Boolean).length}/${phase2.length} ok.`);

const report = [...phase1, ...phase2].map((a, i) => {
  const r = [...core, ...runtime][i];
  return `## ${a.label}\n${r ?? '(agent returned nothing)'}`;
});

log('=== AGENT REPORTS ===');
log(report.join('\n\n'));
