/**
 * CityTextures — the shared texture/material pool for the seven baked city
 * parts, and the hard ceiling on city texture VRAM.
 *
 * The original city used seven 8192x8192 JPEGs (~2.4 GB of VRAM once uploaded)
 * on a GPU with 1536 MB total: an instant crash. Everything here exists to make
 * that impossible. Steady state is at most 7 far textures (512², ~5.5 MB) plus,
 * on demand, 7 near textures (1024², ~22 MB), and exactly one shared
 * MeshStandardMaterial per part per LOD tier — so a thousand streamed chunk
 * sections still upload one texture set and compile one shader per part.
 *
 * Materials are created lazily, on the first getMaterial() for a part, and hold
 * whichever texture has arrived: LOD0 prefers the near texture and falls back to
 * far until it lands, LOD1 is always far. setLowEnd(true) is the emergency valve
 * the perf watchdog pulls — it frees every near texture and refuses to load more
 * until it is turned back off.
 */

import * as THREE from 'three';
import { CityManifest } from './CityManifest';
import type { ChunkLod } from './ChunkStore';
import { clamp, lerp } from '../core/Config';

/** Base surface response; wetness interpolates between these and the wet pair. */
const DRY_ROUGHNESS = 0.85;
const DRY_METALNESS = 0.0;
const WET_ROUGHNESS = 0.25;
const WET_METALNESS = 0.35;

/**
 * Kept low deliberately: anisotropic filtering is per-sample work and the target
 * GPU (Intel HD 4000) is fill-rate bound long before it is bandwidth bound.
 */
const ANISOTROPY = 4;

interface PartSlot {
  far: THREE.Texture | null;
  near: THREE.Texture | null;
  lod0: THREE.MeshStandardMaterial | null;
  lod1: THREE.MeshStandardMaterial | null;
  /** In-flight near load, shared by concurrent ensureNear() callers. */
  nearPending: Promise<void> | null;
}

export class CityTextures {
  private readonly manifest: CityManifest;
  private readonly baseUrl: string;
  private readonly loader = new THREE.TextureLoader();
  private readonly slots: PartSlot[] = [];

  private warmupPromise: Promise<void> | null = null;
  private lowEnd = false;
  private wetness = 0;
  private disposed = false;
  /** Last-resort material, only reachable if the manifest lists zero parts. */
  private fallback: THREE.MeshStandardMaterial | null = null;

  constructor(manifest: CityManifest, baseUrl: string) {
    this.manifest = manifest;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    for (let i = 0; i < manifest.parts.length; i++) {
      this.slots.push({ far: null, near: null, lod0: null, lod1: null, nearPending: null });
    }
  }

  /**
   * Load the far texture for every part in parallel. This is the whole boot-time
   * texture budget (7 x 512² ~= 5.5 MB) and streaming will not show a chunk
   * before it resolves. Idempotent: repeat calls share the first promise.
   */
  warmup(): Promise<void> {
    if (this.warmupPromise) return this.warmupPromise;
    const attempt = Promise.all(this.slots.map((_, part) => this.loadFar(part)))
      .then(() => undefined)
      .catch((err: unknown) => {
        // Drop the memo so a later warmup() can retry the missing files instead
        // of replaying the same rejection forever.
        if (this.warmupPromise === attempt) this.warmupPromise = null;
        throw err;
      });
    this.warmupPromise = attempt;
    return attempt;
  }

  /**
   * Lazily upgrade one part to its 1024² texture and repoint that part's LOD0
   * material at it. Resolves immediately when the texture is already resident,
   * when low-end mode is active, or when the part index is unknown.
   */
  ensureNear(part: number): Promise<void> {
    if (this.disposed || this.lowEnd) return Promise.resolve();
    const slot = this.slots[this.clampPart(part)];
    if (!slot || slot.near) return Promise.resolve();
    if (slot.nearPending) return slot.nearPending;

    const index = this.clampPart(part);
    const pending = this.load(this.urlFor(index, 'near'))
      .then((tex) => {
        // Disposal or a low-end switch can land mid-flight; the upload is
        // already paid for, so free it immediately rather than caching it.
        if (this.disposed || this.lowEnd || slot.near) {
          tex.dispose();
          return;
        }
        slot.near = tex;
        if (slot.lod0) {
          slot.lod0.map = tex;
          slot.lod0.needsUpdate = true;
        }
      })
      .catch((err: unknown) => {
        // A missing near texture is cosmetic: the far texture stays bound.
        console.warn(`CityTextures: near texture for part ${index} failed`, err);
      })
      .finally(() => {
        if (slot.nearPending === pending) slot.nearPending = null;
      });

    slot.nearPending = pending;
    return pending;
  }

  /**
   * Shared material for a part/LOD pair, created on first use. An out-of-range
   * part index is clamped instead of throwing: a malformed chunk must degrade to
   * the wrong texture, never kill the frame.
   */
  getMaterial(part: number, lod: ChunkLod): THREE.Material {
    const slot = this.slots[this.clampPart(part)];
    if (!slot) return this.fallbackMaterial();

    if (lod === 0) {
      if (!slot.lod0) slot.lod0 = this.createMaterial(slot.near ?? slot.far);
      return slot.lod0;
    }
    if (!slot.lod1) slot.lod1 = this.createMaterial(slot.far);
    return slot.lod1;
  }

  /**
   * Emergency VRAM valve: drop every near texture, rebind all LOD0 materials to
   * far, and make ensureNear() a no-op until called with false.
   */
  setLowEnd(lowEnd: boolean): void {
    if (this.lowEnd === lowEnd) return;
    this.lowEnd = lowEnd;
    if (!lowEnd) return;

    for (const slot of this.slots) {
      if (slot.near) {
        slot.near.dispose();
        slot.near = null;
      }
      slot.nearPending = null;
      if (slot.lod0 && slot.lod0.map !== slot.far) {
        slot.lod0.map = slot.far;
        slot.lod0.needsUpdate = true;
      }
    }
  }

  /** 0..1 rain response: shinier and smoother streets as it rises. */
  setWetness(w: number): void {
    const t = clamp(w, 0, 1);
    if (t === this.wetness) return;
    this.wetness = t;
    const roughness = lerp(DRY_ROUGHNESS, WET_ROUGHNESS, t);
    const metalness = lerp(DRY_METALNESS, WET_METALNESS, t);
    for (const slot of this.slots) {
      if (slot.lod0) {
        slot.lod0.roughness = roughness;
        slot.lod0.metalness = metalness;
      }
      if (slot.lod1) {
        slot.lod1.roughness = roughness;
        slot.lod1.metalness = metalness;
      }
    }
  }

  /** Free every texture and material. The pool is unusable afterwards. */
  dispose(): void {
    this.disposed = true;
    this.warmupPromise = null;
    for (const slot of this.slots) {
      slot.near?.dispose();
      slot.far?.dispose();
      slot.lod0?.dispose();
      slot.lod1?.dispose();
      slot.near = null;
      slot.far = null;
      slot.lod0 = null;
      slot.lod1 = null;
      slot.nearPending = null;
    }
    this.slots.length = 0;
    this.fallback?.dispose();
    this.fallback = null;
  }

  // ---------------------------------------------------------------- internals

  private async loadFar(part: number): Promise<void> {
    const slot = this.slots[part];
    if (!slot || slot.far) return;
    const tex = await this.load(this.urlFor(part, 'far'));
    if (this.disposed || slot.far) {
      tex.dispose();
      return;
    }
    slot.far = tex;
    if (slot.lod1) {
      slot.lod1.map = tex;
      slot.lod1.needsUpdate = true;
    }
    if (slot.lod0 && !slot.near) {
      slot.lod0.map = tex;
      slot.lod0.needsUpdate = true;
    }
  }

  private async load(url: string): Promise<THREE.Texture> {
    const tex = await this.loader.loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = ANISOTROPY;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  private createMaterial(map: THREE.Texture | null): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map,
      roughness: lerp(DRY_ROUGHNESS, WET_ROUGHNESS, this.wetness),
      metalness: lerp(DRY_METALNESS, WET_METALNESS, this.wetness),
      fog: true,
      side: THREE.FrontSide,
      dithering: false,
    });
  }

  /** Last-resort material, only reachable if the manifest lists zero parts. */
  private fallbackMaterial(): THREE.Material {
    if (!this.fallback) this.fallback = this.createMaterial(null);
    return this.fallback;
  }

  private clampPart(part: number): number {
    if (this.slots.length === 0) return -1;
    if (!Number.isFinite(part)) return 0;
    return clamp(Math.floor(part), 0, this.slots.length - 1);
  }

  /**
   * Resolve a manifest-relative texture path against the baked base URL. Paths
   * are validated here because loading an original 8192² source would blow the
   * VRAM budget instantly — better a loud throw than a dead laptop.
   */
  private urlFor(part: number, tier: 'near' | 'far'): string {
    const entry = this.manifest.parts[part];
    if (!entry) throw new Error(`CityTextures: no manifest part ${part}`);
    const rel = tier === 'near' ? entry.near : entry.far;
    if (!rel) throw new Error(`CityTextures: part ${part} has no ${tier} texture path`);
    if (rel.includes('sanfranscisco')) {
      throw new Error(`CityTextures: refusing to load original city texture "${rel}"`);
    }
    return this.baseUrl + rel.replace(/^\/+/, '');
  }
}
