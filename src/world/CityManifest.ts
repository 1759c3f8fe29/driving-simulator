/**
 * CityManifest — types and lookup index for the baked city asset set.
 * The bake step (scripts/bake-city.mjs) writes assets/city/city-manifest.json
 * describing a sparse grid of chunk meshes plus the downscaled texture atlases
 * they reference. This module loads and validates that manifest and provides a
 * cheap spatial index so streaming code can ask "what is near (cx,cz)?" without
 * ever touching the 8192x8192 originals under assets/sanfranscisco/.
 */

export interface CityPartTex {
  index: number;
  near: string;
  far: string;
}

export interface CityChunkEntry {
  cx: number;
  cz: number;
  file: string;
  lod1: string | null;
  bytes: number;
  lod1Bytes: number;
  tris: number;
  lod1Tris: number;
  min: [number, number, number];
  max: [number, number, number];
  parts: number[];
}

export interface CityManifest {
  version: number;
  source: string;
  scale: number;
  chunkSize: number;
  grid: { minCx: number; maxCx: number; minCz: number; maxCz: number };
  bounds: { min: [number, number, number]; max: [number, number, number] };
  textureRes: { near: number; far: number };
  parts: CityPartTex[];
  chunks: CityChunkEntry[];
}

export const CITY_BASE_URL = 'assets/city/';

const MANIFEST_FILE = 'city-manifest.json';
const MANIFEST_VERSION = 1;

/** Stable map key for a chunk cell. Cheap string concat — no template cache. */
export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** World metres -> chunk cell. Must match the bake exactly (floor division). */
export function worldToChunk(x: number, z: number, chunkSize: number): { cx: number; cz: number } {
  return { cx: Math.floor(x / chunkSize), cz: Math.floor(z / chunkSize) };
}

/**
 * Fetch and validate the manifest. Throws with the URL in the message so a
 * missing bake is obvious in the console instead of failing later as undefined.
 */
export async function loadCityManifest(baseUrl: string = CITY_BASE_URL): Promise<CityManifest> {
  const url = `${baseUrl}${MANIFEST_FILE}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`CityManifest: failed to fetch ${url} (${res.status} ${res.statusText})`);
  }
  const manifest = (await res.json()) as CityManifest;
  if (manifest.version !== MANIFEST_VERSION) {
    throw new Error(
      `CityManifest: unsupported version ${manifest.version} in ${url} (expected ${MANIFEST_VERSION})`
    );
  }
  if (!(manifest.chunkSize > 0)) {
    throw new Error(`CityManifest: invalid chunkSize ${manifest.chunkSize} in ${url}`);
  }
  if (!Array.isArray(manifest.chunks) || manifest.chunks.length === 0) {
    throw new Error(`CityManifest: no chunks listed in ${url}`);
  }
  if (!Array.isArray(manifest.parts) || manifest.parts.length === 0) {
    throw new Error(`CityManifest: no texture parts listed in ${url}`);
  }
  return manifest;
}

/** Chebyshev (square-ring) distance — matches how the streamer grows radii. */
function chebyshev(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx < 0 ? bx - ax : ax - bx;
  const dz = az - bz < 0 ? bz - az : az - bz;
  return dx > dz ? dx : dz;
}

/**
 * Hash index over the sparse chunk grid. The 16x16 cell range only contains 147
 * populated cells, so lookups must tolerate holes rather than assume a dense
 * 2D array.
 */
export class CityManifestIndex {
  readonly manifest: CityManifest;
  private readonly byKey = new Map<string, CityChunkEntry>();

  constructor(manifest: CityManifest) {
    this.manifest = manifest;
    for (let i = 0; i < manifest.chunks.length; i++) {
      const entry = manifest.chunks[i];
      this.byKey.set(chunkKey(entry.cx, entry.cz), entry);
    }
  }

  get(cx: number, cz: number): CityChunkEntry | undefined {
    return this.byKey.get(chunkKey(cx, cz));
  }

  /**
   * Entries inside the square ring of the given radius, nearest-first by
   * Chebyshev distance so callers can load in order and stop early on a budget.
   */
  entriesWithinRadius(cx: number, cz: number, radius: number): CityChunkEntry[] {
    const out: CityChunkEntry[] = [];
    if (radius < 0) return out;
    for (let z = cz - radius; z <= cz + radius; z++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        const entry = this.byKey.get(chunkKey(x, z));
        if (entry !== undefined) out.push(entry);
      }
    }
    out.sort(
      (a, b) => chebyshev(a.cx, a.cz, cx, cz) - chebyshev(b.cx, b.cz, cx, cz)
    );
    return out;
  }

  /** Closest populated cell to (cx,cz); undefined only for an empty manifest. */
  nearestEntry(cx: number, cz: number): CityChunkEntry | undefined {
    let best: CityChunkEntry | undefined;
    let bestDist = Infinity;
    const chunks = this.manifest.chunks;
    for (let i = 0; i < chunks.length; i++) {
      const entry = chunks[i];
      const d = chebyshev(entry.cx, entry.cz, cx, cz);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
        if (d === 0) break;
      }
    }
    return best;
  }
}
