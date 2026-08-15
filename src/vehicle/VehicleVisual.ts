/**
 * VehicleVisual — Loads the car FBX, normalizes scale/orientation,
 * detects wheels, applies paint customization, headlights, and
 * syncs the model to the physics body each frame.
 */

import * as THREE from 'three';
import { AssetLoader } from '../core/AssetLoader';
import { CONFIG, kmhToMph } from '../core/Config';
import { SaveManager } from '../save/SaveManager';
import { VehicleTelemetry } from './VehicleController';

export interface PaintConfig {
  color: string;
  metallic: number;
  gloss: number;
  type: string;
}

const PAINTABLE_NAME_HINTS = ['body', 'paint', 'carosserie', 'shell', 'base_shd', 'main'];
const WHEEL_NAME_HINTS = ['wheel', 'tire', 'tyre', 'rim'];
const GLASS_NAME_HINTS = ['glass', 'window', 'windshield', 'windscreen'];
const DOOR_NAME_HINTS = ['door', 'porte', 'tuer', 'porta'];

/**
 * Per-mesh triangle floor for the load-time decimator. Small meshes (badges,
 * emissive strips) cost nothing and are the first thing you notice missing, so
 * the budget is taken out of the heavy meshes only.
 */
const DECIMATE_MIN_TRIS = 256;

/**
 * Triangle budget for the player car, by hardware tier. 0 = no decimation.
 *
 * DISABLED: a previous optimization pushed `low` to 80k (11% of the ~703k
 * source), and because `decimateModel` allocates the budget by triangle share,
 * the 229k-tri brake discs absorbed most of it while the visible body was cut
 * to shreds — a hole-punched, see-through wreck with wheels floating as loose
 * boxes. The decimation's own tolerance (matching `bake-city.mjs`'s 40% floor)
 * was 3.5× past safe. The car is the hero asset; keeping it correct is more
 * important than the frame budget it cost, and radius streaming is already the
 * laptop strategy. Car perf can be revisited separately without touching the
 * model. Per the keep-the-FBX rule decimation happens in memory; no asset is
 * rewritten, so 0 just means the cached index buffer is left untouched.
 */
export const CAR_TRIANGLE_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 0,
  medium: 0,
  high: 0,
};

/**
 * Cockpit gauge cluster — a 240° RPM arc with a redline segment, a digital
 * speed readout, current gear and a fuel bar, rendered as a bottom-center DOM
 * overlay that is only created/refreshed while the cockpit camera is active.
 */
const COCKPIT_STYLE_ID = 'cockpit-gauges-style';
const CG_RPM_R = 82; // arc radius in the 200x200 viewBox
const CG_RPM_C = 2 * Math.PI * CG_RPM_R; // full-circle path length
const CG_RPM_SWEEP = 240; // gauge sweep in degrees
const CG_RPM_ARC = CG_RPM_C * (CG_RPM_SWEEP / 360); // visible arc length
const CG_RPM_START = 150; // gauge start angle (degrees, clockwise from 3 o'clock)

const COCKPIT_CSS = `
#cockpit-gauges {
  position: fixed; left: 50%;
  bottom: calc(24px * var(--hud-scale, 1));
  transform: translateX(-50%);
  width: calc(240px * var(--hud-scale, 1));
  z-index: 14;
  pointer-events: none;
  user-select: none;
  text-align: center;
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
}
#cockpit-gauges .cg-gauge { position: relative; }
#cockpit-gauges svg { display: block; width: 100%; height: auto; filter: drop-shadow(0 4px 18px rgba(0, 0, 0, 0.6)); }
#cockpit-gauges .cg-track { fill: rgba(10, 14, 22, 0.72); stroke: rgba(255, 255, 255, 0.12); stroke-width: 1.5; }
#cockpit-gauges .cg-arc-track { fill: none; stroke: rgba(255, 255, 255, 0.08); stroke-width: 8; stroke-linecap: round; }
#cockpit-gauges .cg-arc-redline { fill: none; stroke: var(--danger, #ff4757); stroke-width: 8; stroke-linecap: butt; }
#cockpit-gauges .cg-arc-fill { fill: none; stroke: var(--accent, #2e9bff); stroke-width: 8; stroke-linecap: round; }
#cockpit-gauges .cg-rpm-label { fill: var(--text-dim, #9aa5b5); font-size: 10px; letter-spacing: 1px; }
#cockpit-gauges .cg-gear {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -62%);
  font-size: calc(30px * var(--hud-scale, 1)); font-weight: 700; color: #fff;
  text-shadow: 0 0 12px var(--accent-glow, rgba(46, 155, 255, 0.45)); line-height: 1;
}
#cockpit-gauges .cg-readout { margin-top: -8px; }
#cockpit-gauges .cg-speed { font-size: calc(30px * var(--hud-scale, 1)); font-weight: 700; color: #fff; line-height: 1; }
#cockpit-gauges .cg-unit { font-size: calc(10px * var(--hud-scale, 1)); color: var(--text-dim, #9aa5b5); letter-spacing: 2px; margin-top: 3px; }
#cockpit-gauges .cg-fuel { margin-top: calc(10px * var(--hud-scale, 1)); }
#cockpit-gauges .cg-fuel-row { display: flex; align-items: center; gap: 8px; }
#cockpit-gauges .cg-fuel-label { font-size: calc(9px * var(--hud-scale, 1)); color: var(--text-dim, #9aa5b5); text-transform: uppercase; letter-spacing: 1px; }
#cockpit-gauges .cg-fuel-track { flex: 1; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; }
#cockpit-gauges .cg-fuel-fill { height: 100%; width: 100%; background: linear-gradient(90deg, var(--accent, #2e9bff), #7cc4ff); }
@media (max-width: 640px) {
  #cockpit-gauges { width: 165px; bottom: 128px; }
}
`;

/** Inject the cockpit gauge stylesheet once (guarded, module-local). */
function injectCockpitStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(COCKPIT_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = COCKPIT_STYLE_ID;
  style.textContent = COCKPIT_CSS;
  document.head.appendChild(style);
}

/** Triangle count of a geometry, indexed or not. */
function triangleCount(geo: THREE.BufferGeometry): number {
  const index = geo.getIndex();
  if (index) return index.count / 3;
  const pos = geo.getAttribute('position');
  return pos ? pos.count / 3 : 0;
}

/**
 * Keep the `budget` largest-area triangles of `geo`, dropping the rest.
 *
 * This is the same area-ranked reduction the city baker uses for its LOD1
 * chunks: sort triangles by area, keep from the top until the budget is spent,
 * and rewrite only the index. The vertex buffer, UVs, normals and groups are
 * never touched, so materials and skinning stay valid, and silhouette survives
 * far better than a uniform stride would — the triangles that get dropped are
 * the dense clusters (brake-disc vanes, machined steel) that are sub-pixel at
 * chase-camera distance anyway.
 *
 * Non-indexed geometry gains an index rather than losing vertices; that is
 * cheaper than compacting the attributes and lets the GPU skip the dropped
 * triangles all the same.
 *
 * @returns triangles actually removed
 */
function decimateGeometry(geo: THREE.BufferGeometry, budget: number): number {
  const total = triangleCount(geo);
  if (total <= budget || total <= DECIMATE_MIN_TRIS) return 0;
  const pos = geo.getAttribute('position');
  if (!pos) return 0;
  const index = geo.getIndex();

  // Triangle areas via the cross-product magnitude, read straight out of the
  // attribute arrays — no Vector3 allocation per triangle.
  const area = new Float32Array(total);
  const vi = (t: number, corner: number): number =>
    index ? index.getX(t * 3 + corner) : t * 3 + corner;
  for (let t = 0; t < total; t++) {
    const a = vi(t, 0);
    const b = vi(t, 1);
    const c = vi(t, 2);
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const abx = pos.getX(b) - ax, aby = pos.getY(b) - ay, abz = pos.getZ(b) - az;
    const acx = pos.getX(c) - ax, acy = pos.getY(c) - ay, acz = pos.getZ(c) - az;
    const cx = aby * acz - abz * acy;
    const cy = abz * acx - abx * acz;
    const cz = abx * acy - aby * acx;
    area[t] = Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.5;
  }

  const order = new Uint32Array(total);
  for (let i = 0; i < total; i++) order[i] = i;
  // Uint32Array.sort takes a comparator, so this stays a typed-array sort.
  order.sort((a, b) => area[b] - area[a]);

  const keepCount = Math.max(DECIMATE_MIN_TRIS, Math.floor(budget));
  const keep = order.slice(0, keepCount);
  // Restore source order so the index stays cache-friendly and group ranges,
  // which are expressed in index offsets, remain monotonic.
  keep.sort();

  const vertexCount = pos.count;
  const out =
    vertexCount > 65535 ? new Uint32Array(keep.length * 3) : new Uint16Array(keep.length * 3);
  for (let i = 0; i < keep.length; i++) {
    const t = keep[i];
    out[i * 3] = vi(t, 0);
    out[i * 3 + 1] = vi(t, 1);
    out[i * 3 + 2] = vi(t, 2);
  }
  geo.setIndex(new THREE.BufferAttribute(out, 1));
  // Multi-material groups indexed the old, longer index buffer; a single group
  // spanning the new one keeps the draw valid (the FBX meshes are single-material).
  if (geo.groups.length > 1) {
    geo.clearGroups();
    geo.addGroup(0, out.length, 0);
  }
  return total - keep.length;
}

export class VehicleVisual {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheelMeshes: THREE.Object3D[] = [];
  private paintMaterials: THREE.MeshStandardMaterial[] = [];
  private glassMaterials: THREE.MeshStandardMaterial[] = [];
  private rimMaterials: THREE.MeshStandardMaterial[] = [];
  private headlightLeft!: THREE.SpotLight;
  private headlightRight!: THREE.SpotLight;
  private brakeLightMat: THREE.MeshStandardMaterial | null = null;
  private steeringWheel: THREE.Object3D | null = null;
  private doors: THREE.Object3D[] = [];
  private doorOpen = false;
  private doorAngle = 0;
  private save = SaveManager.get();
  private modelOffset = new THREE.Vector3(0, -0.32, 0);

  // Cockpit gauge cluster (lazily built, refreshed only while visible).
  private cockpitVisible = false;
  private cgRoot: HTMLElement | null = null;
  private cgFill!: SVGCircleElement;
  private cgRedline!: SVGCircleElement;
  private cgSpeed!: HTMLElement;
  private cgUnit!: HTMLElement;
  private cgGear!: HTMLElement;
  private cgFuelFill!: HTMLElement;
  private cgSpeedKey = -1;
  private cgUnitKey = '';
  private cgGearKey = '';
  private cgFuelKey = -1;
  private cgRpmKey = -1;
  private cgRpmColor = '';
  private cgBlinkKey = -1;

  private constructor() {
    this.root.add(this.body);
  }

  static async create(
    loader: AssetLoader,
    modelKey: string,
    triangleBudget = 0
  ): Promise<VehicleVisual> {
    const v = new VehicleVisual();
    const model = loader.getModel(modelKey);
    const clone = cloneWithMaterials(model);
    v.normalizeModel(clone);
    if (triangleBudget > 0) v.decimateModel(clone, triangleBudget);
    v.body.add(clone);
    v.categorizeMeshes(clone);
    v.setupLights();
    v.applyPaint(v.save.vehicle.paint);
    v.applyRimColor(v.save.vehicle.rimColor);
    v.applyWindowTint(v.save.vehicle.windowTint);
    return v;
  }

  /**
   * Cap the whole model at `budget` triangles, in memory, at load time.
   *
   * The budget is spread over meshes in proportion to their triangle share, so
   * the pass is dominated by whatever is actually heavy (on the shipped Jesko,
   * the 229k-triangle brake discs and 101k of machined steel) while light meshes
   * keep every triangle. Runs after `normalizeModel` so areas are measured in
   * the same scaled space the camera sees.
   *
   * `cloneWithMaterials` clones materials but shares geometry with the
   * AssetLoader's cached model, so this rewrites the cached index buffers too.
   * That is deliberate: the budget comes from the hardware tier and applies to
   * every instance of the car, and the pass is idempotent — a geometry already
   * under budget is skipped. It runs before the first render, so no GPU buffer
   * for the discarded index has been uploaded yet.
   */
  private decimateModel(model: THREE.Object3D, budget: number): void {
    const meshes: THREE.Mesh[] = [];
    let total = 0;
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.geometry) return;
      const tris = triangleCount(o.geometry);
      if (tris <= 0) return;
      meshes.push(o);
      total += tris;
    });
    if (total <= budget) return;

    // Proportional share, then a second pass: meshes below the floor cannot give
    // anything up, so the shortfall is redistributed over the ones that can.
    const share = budget / total;
    let fixed = 0;
    let reducibleTris = 0;
    for (const mesh of meshes) {
      const tris = triangleCount(mesh.geometry);
      if (tris * share < DECIMATE_MIN_TRIS) fixed += Math.min(tris, DECIMATE_MIN_TRIS);
      else reducibleTris += tris;
    }
    const reducibleShare = reducibleTris > 0 ? Math.max(0, budget - fixed) / reducibleTris : 1;

    let removed = 0;
    for (const mesh of meshes) {
      const tris = triangleCount(mesh.geometry);
      if (tris * share < DECIMATE_MIN_TRIS) continue;
      removed += decimateGeometry(mesh.geometry, tris * reducibleShare);
    }
    if (removed > 0) {
      console.info(
        `[VehicleVisual] decimated car ${total.toLocaleString()} → ` +
          `${(total - removed).toLocaleString()} tris (budget ${budget.toLocaleString()})`
      );
    }
  }

  /** Scale and center the model so it matches physics dimensions (~4.4m long). */
  private normalizeModel(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const targetLength = 4.4;
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim > 0.001) {
      const scale = targetLength / maxDim;
      model.scale.setScalar(scale);
    }
    // Recompute after scaling, center on origin, rest on ground plane
    const box2 = new THREE.Box3().setFromObject(model);
    const center = box2.getCenter(new THREE.Vector3());
    model.position.sub(center);
    const box3 = new THREE.Box3().setFromObject(model);
    model.position.y -= box3.min.y; // wheels touch y=0 of body space
    // FBX cars usually face +Z or -Z; assume forward is +Z after load.
    model.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
      }
    });
  }

  private categorizeMeshes(model: THREE.Object3D): void {
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const name = o.name.toLowerCase();
      const mat = o.material as THREE.MeshStandardMaterial | THREE.MeshPhongMaterial;
      const matName = (mat?.name ?? '').toLowerCase();
      const fullName = `${name} ${matName}`;

      if (WHEEL_NAME_HINTS.some((h) => fullName.includes(h))) {
        this.wheelMeshes.push(o);
        if (fullName.includes('rim')) {
          this.rimMaterials.push(ensureStandard(o));
        }
        return;
      }
      if (GLASS_NAME_HINTS.some((h) => fullName.includes(h))) {
        const m = ensureStandard(o);
        m.transparent = true;
        m.opacity = 0.35;
        m.roughness = 0.05;
        m.metalness = 0.1;
        this.glassMaterials.push(m);
        return;
      }
      if (fullName.includes('steer')) {
        this.steeringWheel = o;
      }
      if (DOOR_NAME_HINTS.some((h) => fullName.includes(h))) {
        this.doors.push(o);
      }
      if (fullName.includes('brake') && fullName.includes('light') || fullName.includes('taillight') || fullName.includes('rear_light')) {
        const m = ensureStandard(o);
        m.emissive = new THREE.Color(0xff0000);
        m.emissiveIntensity = 0;
        this.brakeLightMat = m;
      }
      if (PAINTABLE_NAME_HINTS.some((h) => fullName.includes(h))) {
        this.paintMaterials.push(ensureStandard(o));
      }
    });

    // Fallback: if no explicit body found, use the largest mesh as paintable
    if (this.paintMaterials.length === 0) {
      let largest: THREE.Mesh | null = null;
      let largestArea = 0;
      model.traverse((o) => {
        if (o instanceof THREE.Mesh && !this.wheelMeshes.includes(o)) {
          o.geometry.computeBoundingBox();
          const bb = o.geometry.boundingBox!;
          const size = bb.getSize(new THREE.Vector3());
          const area = size.x * size.y + size.x * size.z + size.y * size.z;
          if (area > largestArea) {
            largestArea = area;
            largest = o;
          }
        }
      });
      if (largest) this.paintMaterials.push(ensureStandard(largest));
    }
  }

  private setupLights(): void {
    const mkHeadlight = (x: number): THREE.SpotLight => {
      const light = new THREE.SpotLight(0xfff4d6, 0, 65, 0.5, 0.45, 1.4);
      light.position.set(x, 0.68, 1.95);
      light.target.position.set(x * 1.6, 0.1, 14);
      this.body.add(light);
      this.body.add(light.target);
      return light;
    };
    this.headlightLeft = mkHeadlight(-0.62);
    this.headlightRight = mkHeadlight(0.62);
  }

  applyPaint(paint: PaintConfig): void {
    const color = new THREE.Color(paint.color);
    for (const m of this.paintMaterials) {
      m.color.copy(color);
      m.metalness = paint.type === 'matte' ? 0.1 : paint.metallic;
      m.roughness = paint.type === 'matte' ? 0.85 : 1 - paint.gloss;
      m.envMapIntensity = paint.type === 'matte' ? 0.4 : 1.2;
      m.needsUpdate = true;
    }
    this.save.vehicle.paint = { ...paint };
  }

  applyRimColor(color: string): void {
    const c = new THREE.Color(color);
    for (const m of this.rimMaterials) {
      m.color.copy(c);
      m.needsUpdate = true;
    }
    this.save.vehicle.rimColor = color;
  }

  applyWindowTint(level: number): void {
    for (const m of this.glassMaterials) {
      m.opacity = 0.15 + level * 0.8;
      m.color.setScalar(1 - level * 0.85);
      m.needsUpdate = true;
    }
    this.save.vehicle.windowTint = level;
  }

  /** Sync visual to physics + animate wheels/lights. */
  update(telemetry: VehicleTelemetry, dt: number): void {
    this.root.position.copy(telemetry.position);
    this.root.quaternion.copy(telemetry.quaternion);
    this.root.position.add(this.modelOffset);

    // Wheels: match raycast positions and spin
    for (let i = 0; i < this.wheelMeshes.length && i < telemetry.wheels.length; i++) {
      const mesh = this.wheelMeshes[i];
      const wheel = telemetry.wheels[i];
      // Spin around local X
      mesh.rotation.x = wheel.rotation;
      if (wheel.isFront) mesh.rotation.y = wheel.steerAngle;
    }

    // Headlights
    const intensity = telemetry.headlights ? (telemetry.highBeam ? 140 : 80) : 0;
    this.headlightLeft.intensity = intensity;
    this.headlightRight.intensity = intensity;
    this.headlightLeft.angle = telemetry.highBeam ? 0.42 : 0.5;

    // Brake lights
    if (this.brakeLightMat) {
      this.brakeLightMat.emissiveIntensity = telemetry.brake > 0.05 ? 2.2 : telemetry.headlights ? 0.5 : 0;
    }

    // Steering wheel
    if (this.steeringWheel) {
      this.steeringWheel.rotation.z = -telemetry.steer * 2.4;
    }

    // Door animation (best-effort hinge; opens toward the first door's local Z)
    const doorTarget = this.doorOpen ? 1.1 : 0;
    this.doorAngle += (doorTarget - this.doorAngle) * Math.min(1, 5 * dt);
    for (const d of this.doors) d.rotation.z = this.doorAngle;

    // Cockpit gauge cluster (refreshed only while the cockpit camera is active)
    if (this.cockpitVisible) this.updateCockpit(telemetry);
  }

  /** Show or hide the cockpit gauge cluster. Called every frame by the integrator based on camera mode. */
  setCockpitVisible(v: boolean): void {
    if (this.cockpitVisible === v) return;
    this.cockpitVisible = v;
    if (v) {
      this.ensureCockpitOverlay();
      this.cgRoot!.style.display = 'block';
    } else if (this.cgRoot) {
      this.cgRoot.style.display = 'none';
    }
  }

  /** Lazily build the cockpit gauge cluster DOM (bottom-center overlay, hidden by default). */
  private ensureCockpitOverlay(): void {
    if (this.cgRoot) return;
    injectCockpitStyles();

    const redlineFrac = CONFIG.vehicle.redline / CONFIG.hud.rpmGaugeMax;
    const redlineSeg = (1 - redlineFrac) * CG_RPM_ARC;
    const trackOffset = CG_RPM_C - CG_RPM_ARC;
    const redlineOffset = redlineSeg + CG_RPM_C - (CG_RPM_ARC - redlineSeg);
    const two = (v: number): string => String(Math.round(v * 100) / 100);

    const el = document.createElement('div');
    el.id = 'cockpit-gauges';
    el.style.display = 'none';
    el.innerHTML = `
      <div class="cg-gauge">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle class="cg-track" cx="100" cy="100" r="90"/>
          <circle class="cg-arc-track" cx="100" cy="100" r="${CG_RPM_R}" stroke-dasharray="${two(CG_RPM_C)}" stroke-dashoffset="${two(trackOffset)}" transform="rotate(${CG_RPM_START} 100 100)"/>
          <circle class="cg-arc-redline" cx="100" cy="100" r="${CG_RPM_R}" stroke-dasharray="${two(redlineSeg)} ${two(CG_RPM_C)}" stroke-dashoffset="${two(redlineOffset)}" transform="rotate(${CG_RPM_START} 100 100)"/>
          <circle class="cg-arc-fill" cx="100" cy="100" r="${CG_RPM_R}" stroke-dasharray="${two(CG_RPM_C)}" stroke-dashoffset="${two(CG_RPM_C)}" transform="rotate(${CG_RPM_START} 100 100)"/>
          <circle cx="100" cy="100" r="6" fill="#10141d" stroke="rgba(255,255,255,0.2)" stroke-width="2"/>
          <text class="cg-rpm-label" x="100" y="182" text-anchor="middle">RPM ×1000</text>
        </svg>
        <div class="cg-gear">N</div>
      </div>
      <div class="cg-readout">
        <div class="cg-speed">0</div>
        <div class="cg-unit">km/h</div>
      </div>
      <div class="cg-fuel">
        <div class="cg-fuel-row">
          <span class="cg-fuel-label">Fuel</span>
          <div class="cg-fuel-track"><div class="cg-fuel-fill"></div></div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    this.cgRoot = el;
    this.cgFill = el.querySelector('.cg-arc-fill') as SVGCircleElement;
    this.cgRedline = el.querySelector('.cg-arc-redline') as SVGCircleElement;
    this.cgSpeed = el.querySelector('.cg-speed') as HTMLElement;
    this.cgUnit = el.querySelector('.cg-unit') as HTMLElement;
    this.cgGear = el.querySelector('.cg-gear') as HTMLElement;
    this.cgFuelFill = el.querySelector('.cg-fuel-fill') as HTMLElement;
  }

  /** Refresh cockpit gauges from telemetry; only touches text/attributes when values change. */
  private updateCockpit(t: VehicleTelemetry): void {
    this.ensureCockpitOverlay();
    const fill = this.cgFill;
    const redline = this.cgRedline;
    const speed = this.cgSpeed;
    const unit = this.cgUnit;
    const gearEl = this.cgGear;
    const fuelFill = this.cgFuelFill;

    // 240° RPM sweep (0..1), quantized so the attribute is only written on change
    const rpmN = t.rpm / CONFIG.hud.rpmGaugeMax;
    const f = rpmN < 0 ? 0 : rpmN > 1 ? 1 : rpmN;
    const offset = CG_RPM_C - f * CG_RPM_ARC;
    const offsetKey = Math.round(offset * 2);
    if (offsetKey !== this.cgRpmKey) {
      this.cgRpmKey = offsetKey;
      fill.setAttribute('stroke-dashoffset', String(offsetKey / 2));
    }
    const colorKey = t.rpm >= CONFIG.vehicle.redline ? 'danger' : 'accent';
    if (colorKey !== this.cgRpmColor) {
      this.cgRpmColor = colorKey;
      fill.style.stroke = colorKey === 'danger' ? 'var(--danger)' : 'var(--accent)';
    }
    // Rev limiter: blink the static redline segment
    if (t.revLimiter) {
      const blink = Math.floor(performance.now() / 90) % 2;
      if (blink !== this.cgBlinkKey) {
        this.cgBlinkKey = blink;
        redline.style.opacity = blink === 0 ? '0.35' : '1';
      }
    } else if (this.cgBlinkKey !== -1) {
      this.cgBlinkKey = -1;
      redline.style.opacity = '1';
    }

    // Digital speed readout + active unit
    const units = this.save.settings.gameplay.units;
    const speedVal = Math.round(units === 'mph' ? kmhToMph(t.speedKmh) : t.speedKmh);
    if (speedVal !== this.cgSpeedKey) {
      this.cgSpeedKey = speedVal;
      speed.textContent = String(speedVal);
    }
    if (units !== this.cgUnitKey) {
      this.cgUnitKey = units;
      unit.textContent = units === 'mph' ? 'mph' : 'km/h';
    }

    // Current gear
    if (t.gear !== this.cgGearKey) {
      this.cgGearKey = t.gear;
      gearEl.textContent = t.gear;
    }

    // Fuel bar
    const fuelPct = Math.round(Math.max(0, Math.min(1, t.fuelPercent)) * 100);
    if (fuelPct !== this.cgFuelKey) {
      this.cgFuelKey = fuelPct;
      fuelFill.style.width = `${fuelPct}%`;
      fuelFill.style.background =
        fuelPct < 15 ? 'var(--danger)' : 'linear-gradient(90deg, var(--accent), #7cc4ff)';
    }
  }

  /** Toggle the door open/closed. Returns false when the model has no door geometry. */
  toggleDoor(): boolean {
    if (this.doors.length === 0) return false;
    this.doorOpen = !this.doorOpen;
    return true;
  }

  get doorOpenState(): boolean {
    return this.doorOpen;
  }

  getPaint(): PaintConfig {
    return { ...this.save.vehicle.paint };
  }
}

/** Convert phong/lambert materials to MeshStandardMaterial in place. */
function ensureStandard(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  if (mesh.material instanceof THREE.MeshStandardMaterial) return mesh.material;
  const old = mesh.material as THREE.MeshPhongMaterial;
  const std = new THREE.MeshStandardMaterial({
    name: old?.name ?? '',
    color: old?.color?.clone() ?? new THREE.Color(0x888888),
    map: old?.map ?? null,
    normalMap: (old as unknown as { normalMap?: THREE.Texture }).normalMap ?? null,
    roughness: 0.5,
    metalness: 0.3,
  });
  mesh.material = std;
  return std;
}

/** Deep clone including materials (so customization doesn't affect the cached original). */
function cloneWithMaterials(source: THREE.Object3D): THREE.Object3D {
  const clone = source.clone(true);
  clone.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else if (o.material) o.material = o.material.clone();
    }
  });
  return clone;
}
