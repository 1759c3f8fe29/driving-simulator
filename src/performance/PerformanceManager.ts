/**
 * PerformanceManager — Rolling frame-time stats, adaptive graphics, debug overlay.
 *
 * The Optimization spec module. Monitors sustained FPS against a target
 * (60 desktop / 30 mobile). When FPS stays low it steps the graphics quality
 * level down (render scale, bloom, SSAO, motion blur); when FPS recovers it
 * steps back up. Emits `performance:level` on change so the Game can re-apply
 * renderer settings. F10 toggles a debug overlay (FPS, frame time, draw calls,
 * triangles, physics body count, memory, current quality).
 *
 * Also hosts the low-end safety net for Intel HD 4000 class hardware:
 *  - a panic watchdog that emits `performance:panic` and slams quality to the
 *    worst level when the frame loop stalls (>250 ms frames), because a stall
 *    is what actually kills this machine;
 *  - `startLowEnd()` to boot pinned at a cheap level with a 30 s step-up lock;
 *  - a 120-sample frame-time ring for `getFrameTimeP95()`;
 *  - an optional streaming-stats provider rendered as the overlay STREAM row.
 *
 * It also takes ownership of `renderer.info.autoReset`: EffectComposer issues
 * several `render()` calls per frame and each one clears the counters, so the
 * only way to report the frame's real draw-call/triangle totals is to reset once
 * per frame here. See `captureRenderInfo()`.
 */

import * as THREE from 'three';
import { isMobile, lerp } from '../core/Config';
import { EventBus } from '../core/EventBus';

export interface QualityConfig {
  renderScale: number;
  bloom: boolean;
  ssao: boolean;
  motionBlur: boolean;
  /**
   * Whether shadow maps may render at this level. A shadow map is a second full
   * scene traversal every frame, which on a software rasterizer or an old
   * integrated GPU costs more than everything the other three flags control put
   * together — so the worst level drops it outright.
   */
  shadows: boolean;
  /**
   * Whether the EffectComposer runs at all. Every composer pass is a full-screen
   * quad, so even with bloom/SSAO/blur/grain switched off the chain still costs
   * SMAA's three passes plus vignette and output — pure fill rate, which is
   * exactly what a CPU rasterizer has least of. At the worst level the frame is
   * rendered straight to the canvas instead.
   */
  postFx: boolean;
}

export interface PerformanceStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  physicsBodies: number;
  physicsColliders: number;
  memoryMB: number;
}

/** Shape of the streaming numbers surfaced in the overlay's STREAM row. */
export interface StreamingStatsSnapshot {
  loaded: number;
  pending: number;
  colliders: number;
  tris: number;
  lod0: number;
  lod1: number;
}

export type StreamingStatsProvider = () => StreamingStatsSnapshot;

/**
 * Shape of the drivetrain/contact numbers surfaced in the overlay's DRIVE row.
 *
 * These exist because the gauges cannot answer the question they most often
 * raise. `Engine` derives rpm from wheel speed, so a car with no wheel on
 * geometry idles at any throttle — indistinguishable on the HUD from a car
 * receiving no input. `grounded` and `y` separate those cases outright.
 */
export interface VehicleStatsSnapshot {
  speedKmh: number;
  gear: string;
  rpm: number;
  throttle: number;
  grounded: number;
  y: number;
  tripKm: number;
  driveSec: number;
}

export type VehicleStatsProvider = () => VehicleStatsSnapshot;

/**
 * Quality levels, highest first. Index = level. Level 0 is "no adaptive override".
 *
 * The worst level never drops `postFx` any more: setting it false routes the
 * frame to a direct `renderer.render()`, bypassing SMAA, which on a texture-
 * dependent low-poly city reads as aliasing so heavy the streets lose their
 * edges. SMAA is cheap relative to a second scene traversal, and keeping the
 * composer alive is what keeps the image legible at the bottom end. Scale also
 * stays at 0.7, not 0.5: the streamed city is identified by its baked textures,
 * and a 0.5 upscale blur turns them to mush. Shadows area single traversal and
 * the real cost — so those, not the composer, are what the worst level sheds.
 */
export const QUALITY_LEVELS: QualityConfig[] = [
  { renderScale: 1.0, bloom: true, ssao: true, motionBlur: true, shadows: true, postFx: true },
  { renderScale: 0.85, bloom: true, ssao: false, motionBlur: true, shadows: true, postFx: true },
  { renderScale: 0.75, bloom: true, ssao: false, motionBlur: false, shadows: true, postFx: true },
  { renderScale: 0.7, bloom: false, ssao: false, motionBlur: false, shadows: false, postFx: true },
];

export const DEFAULT_TARGET_FPS = 60;
export const MOBILE_TARGET_FPS = 30;
export const LOW_END_TARGET_FPS = 30;
/** Emitted once when the frame loop stalls badly enough to risk a hard hang. */
export const PERF_PANIC_EVENT = 'performance:panic';

const LOW_FPS_RATIO = 0.8; // below 80% of target counts as slow
const RECOVER_FPS_RATIO = 1.1; // above 110% of target counts as recovered
const DOWN_SAMPLE_SECONDS = 4; // sustained slow before stepping down
const UP_SAMPLE_SECONDS = 10; // sustained good before stepping up

const LOW_END_LEVEL = 2; // startLowEnd() pins here: 0.6 scale, bloom only
const LOW_END_UP_LOCK_SECONDS = 30; // no step-up during a slow boot

const PANIC_FRAME_MS = 250; // a frame this long is a stall, not a slow frame
const PANIC_FRAME_COUNT = 3; // stalls needed to trip the watchdog
const PANIC_WINDOW_SECONDS = 2; // ...within this window
const PANIC_REARM_SECONDS = 20; // healthy time before panic can fire again

const FRAME_RING_SIZE = 120; // ~2 s at 60 fps, ~4 s at 30 fps

export class PerformanceManager {
  private bus = EventBus.get();
  private renderer: THREE.WebGLRenderer;
  private getPhysicsBodies: () => { bodies: number; colliders: number };
  private overlay: HTMLDivElement | null = null;

  private targetFps: number;
  private smoothedFps: number;
  private level = 0;
  private adaptive = true;
  private lowAccum = 0;
  private highAccum = 0;
  private stats: PerformanceStats = {
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    physicsBodies: 0,
    physicsColliders: 0,
    memoryMB: 0,
  };

  private streamingProvider: StreamingStatsProvider | null = null;
  private vehicleProvider: VehicleStatsProvider | null = null;
  private lowEnd = false;
  private upLockRemaining = 0;

  // Panic watchdog. Timestamps of recent stalls, oldest-first, fixed capacity.
  private stallTimes = new Float64Array(PANIC_FRAME_COUNT);
  private stallCount = 0;
  private panicArmed = true;
  private healthyAccum = 0;
  private panicCount = 0;
  private lastPanicAt = -1;

  // Frame-time ring + reusable scratch for the p95 sort (never allocate per frame).
  private frameRing = new Float32Array(FRAME_RING_SIZE);
  private frameScratch = new Float32Array(FRAME_RING_SIZE);
  private frameRingHead = 0;
  private frameRingFilled = 0;

  /** Monotonic seconds since construction, accumulated from dt (no clock calls). */
  private elapsed = 0;

  // Last full frame's render totals, sampled before the counters are cleared.
  private capturedDrawCalls = 0;
  private capturedTriangles = 0;

  constructor(
    renderer: THREE.WebGLRenderer,
    getPhysicsBodies: () => { bodies: number; colliders: number },
    targetFps?: number
  ) {
    this.renderer = renderer;
    this.getPhysicsBodies = getPhysicsBodies;
    this.targetFps = targetFps ?? (isMobile() ? MOBILE_TARGET_FPS : DEFAULT_TARGET_FPS);
    this.smoothedFps = this.targetFps;
    // Own the render-info reset window. With the default autoReset, every
    // `render()` inside EffectComposer clears the counters, so a read after the
    // frame only ever sees the last full-screen quad — "1 draw call, 1 triangle"
    // for a whole streamed city. Resetting once per frame in update() instead
    // makes the counters the sum of all composer passes.
    renderer.info.autoReset = false;
    window.addEventListener('keydown', this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'F10') {
      e.preventDefault();
      this.toggleOverlay();
    }
  };

  /**
   * Per-frame driver.
   *
   * @param fps    the Clock's measured fps
   * @param dt     simulation delta (seconds) — drives the adaptive accumulators
   * @param rawDt  unclamped real frame delta (seconds); defaults to `dt`. The
   *   stall watchdog needs this: `dt` is clamped to a ceiling below
   *   `PANIC_FRAME_MS`, so feeding it the simulation delta makes the watchdog
   *   structurally incapable of ever tripping.
   */
  update(fps: number, dt: number, rawDt = dt): void {
    this.captureRenderInfo();
    this.stats.fps = fps;
    this.stats.frameTime = rawDt * 1000;
    this.smoothedFps = lerp(this.smoothedFps, fps, 0.08);

    this.elapsed += dt;
    // The real single-frame delta, not the 0.5 s averaged fps — that would smooth
    // a stall away, and both the watchdog and the p95 ring exist to catch stalls.
    const frameMs = rawDt * 1000;
    this.pushFrameTime(frameMs);
    this.checkPanic(frameMs, dt);

    if (this.upLockRemaining > 0) this.upLockRemaining -= dt;

    if (!this.adaptive) return;
    const target = this.targetFps;
    if (this.smoothedFps < target * LOW_FPS_RATIO) {
      this.lowAccum += dt;
      this.highAccum = 0;
    } else if (this.smoothedFps > target * RECOVER_FPS_RATIO) {
      this.highAccum += dt;
      this.lowAccum = 0;
    } else {
      this.lowAccum = 0;
      this.highAccum = 0;
    }

    if (this.lowAccum > DOWN_SAMPLE_SECONDS && this.level < QUALITY_LEVELS.length - 1) {
      this.setLevel(this.level + 1, 'low-fps');
    } else if (
      this.highAccum > UP_SAMPLE_SECONDS &&
      this.level > 0 &&
      this.upLockRemaining <= 0
    ) {
      this.setLevel(this.level - 1, 'recovered');
    }
  }

  // ---------- Render-info capture ----------

  /**
   * Take the previous frame's accumulated draw-call/triangle totals, then clear
   * the counters for the frame about to be rendered.
   *
   * `update()` runs before `PostProcessing.render()`, so what is in
   * `renderer.info` right now is last frame's complete total across every
   * composer pass — which is exactly the number worth showing. Reading it after
   * the render instead would only catch whatever ran since the last internal
   * autoReset.
   */
  private captureRenderInfo(): void {
    const info = this.renderer.info;
    this.capturedDrawCalls = info.render.calls;
    this.capturedTriangles = info.render.triangles;
    info.reset();
  }

  // ---------- Frame-time ring / percentile ----------

  private pushFrameTime(ms: number): void {
    this.frameRing[this.frameRingHead] = ms;
    this.frameRingHead = (this.frameRingHead + 1) % FRAME_RING_SIZE;
    if (this.frameRingFilled < FRAME_RING_SIZE) this.frameRingFilled++;
  }

  /** 95th percentile frame time (ms) over the rolling window. 0 until sampled. */
  getFrameTimeP95(): number {
    const n = this.frameRingFilled;
    if (n === 0) return 0;
    const scratch = this.frameScratch.subarray(0, n);
    scratch.set(this.frameRing.subarray(0, n));
    scratch.sort();
    const idx = Math.min(n - 1, Math.floor(0.95 * (n - 1)));
    return scratch[idx];
  }

  // ---------- Panic watchdog ----------

  private checkPanic(frameMs: number, dt: number): void {
    if (frameMs > PANIC_FRAME_MS) {
      this.healthyAccum = 0;
      if (this.stallCount < PANIC_FRAME_COUNT) {
        this.stallTimes[this.stallCount++] = this.elapsed;
      } else {
        // Shift left; capacity is 3 so the copy is trivially cheap.
        for (let i = 1; i < PANIC_FRAME_COUNT; i++) this.stallTimes[i - 1] = this.stallTimes[i];
        this.stallTimes[PANIC_FRAME_COUNT - 1] = this.elapsed;
      }
      const windowed =
        this.stallCount >= PANIC_FRAME_COUNT &&
        this.elapsed - this.stallTimes[0] <= PANIC_WINDOW_SECONDS;
      if (windowed && this.panicArmed) this.firePanic(frameMs);
    } else {
      this.healthyAccum += dt;
      if (this.healthyAccum >= PANIC_REARM_SECONDS) {
        this.panicArmed = true;
        this.stallCount = 0;
      }
    }
  }

  private firePanic(frameMs: number): void {
    this.panicArmed = false;
    this.healthyAccum = 0;
    this.stallCount = 0;
    this.panicCount++;
    this.lastPanicAt = this.elapsed;
    const worst = QUALITY_LEVELS.length - 1;
    // Jump straight to the worst level regardless of adaptive mode: the point of
    // the watchdog is to stop the stall, not to respect preferences.
    if (this.level !== worst) {
      this.setLevel(worst, 'panic');
    } else {
      this.lowAccum = 0;
      this.highAccum = 0;
    }
    this.bus.emit(PERF_PANIC_EVENT, {
      frameTime: frameMs,
      level: worst,
      config: QUALITY_LEVELS[worst],
      p95: this.getFrameTimeP95(),
    });
  }

  /** How many times the watchdog has tripped this session. */
  get panicTripCount(): number {
    return this.panicCount;
  }

  private setLevel(level: number, reason: string): void {
    this.level = level;
    this.lowAccum = 0;
    this.highAccum = 0;
    this.bus.emit('performance:level', {
      level,
      config: QUALITY_LEVELS[level],
      reason,
    });
  }

  /** Live-capture renderer/physics metrics for the overlay. */
  refreshStats(): void {
    this.stats.drawCalls = this.capturedDrawCalls;
    this.stats.triangles = this.capturedTriangles;
    const bodies = this.getPhysicsBodies();
    this.stats.physicsBodies = bodies.bodies;
    this.stats.physicsColliders = bodies.colliders;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
    this.stats.memoryMB = mem?.usedJSHeapSize ? mem.usedJSHeapSize / (1024 * 1024) : 0;
  }

  getStats(): PerformanceStats {
    return this.stats;
  }

  getQualityConfig(): QualityConfig {
    return QUALITY_LEVELS[this.level];
  }

  get levelIndex(): number {
    return this.level;
  }

  get adaptiveEnabled(): boolean {
    return this.adaptive;
  }

  setAdaptive(v: boolean): void {
    this.adaptive = v;
    if (!v) this.setLevel(0, 'disabled');
  }

  // ---------- Low-end mode ----------

  /**
   * Pin the session to a cheap quality level for weak GPUs: level 2, a 30 fps
   * target, and no step-up for the first 30 s so a slow boot (chunk streaming,
   * texture uploads) is not mistaken for a machine that can afford more.
   * Idempotent — calling it again does not restart the lock.
   */
  startLowEnd(): void {
    if (this.lowEnd) return;
    this.lowEnd = true;
    this.targetFps = LOW_END_TARGET_FPS;
    this.smoothedFps = LOW_END_TARGET_FPS;
    this.upLockRemaining = LOW_END_UP_LOCK_SECONDS;
    if (this.level !== LOW_END_LEVEL) this.setLevel(LOW_END_LEVEL, 'low-end');
    else {
      this.lowAccum = 0;
      this.highAccum = 0;
    }
  }

  get lowEndEnabled(): boolean {
    return this.lowEnd;
  }

  get targetFpsValue(): number {
    return this.targetFps;
  }

  // ---------- Streaming stats ----------

  /** Supply live chunk-streaming numbers for the overlay's STREAM row. */
  setStreamingStatsProvider(fn: StreamingStatsProvider): void {
    this.streamingProvider = fn;
  }

  /** Drop the provider; the STREAM row disappears again. */
  clearStreamingStatsProvider(): void {
    this.streamingProvider = null;
  }

  /** Supply live drivetrain/contact numbers for the overlay's DRIVE row. */
  setVehicleStatsProvider(fn: VehicleStatsProvider): void {
    this.vehicleProvider = fn;
  }

  /** Drop the provider; the DRIVE row disappears again. */
  clearVehicleStatsProvider(): void {
    this.vehicleProvider = null;
  }

  // ---------- Debug overlay ----------

  toggleOverlay(): void {
    if (this.overlay) this.hideOverlay();
    else this.showOverlay();
  }

  showOverlay(): void {
    if (this.overlay) return;
    const el = document.createElement('div');
    el.id = 'perf-overlay';
    el.style.cssText =
      'position:fixed;left:10px;bottom:10px;z-index:999;background:rgba(8,10,16,0.82);' +
      'color:#7fe08a;font:11px/1.6 ui-monospace,Menlo,Consolas,monospace;padding:8px 12px;' +
      'border-radius:6px;border:1px solid rgba(127,224,138,0.25);white-space:pre;pointer-events:none;';
    document.body.appendChild(el);
    this.overlay = el;
    this.refreshStats();
    this.renderOverlay();
  }

  hideOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  /** Redraw overlay text (called from the game loop while visible). */
  renderOverlay(): void {
    if (!this.overlay) return;
    const s = this.stats;
    const lvl = QUALITY_LEVELS[this.level];
    // The STREAM row is the readout for radius streaming: chunks resident, how
    // many are in flight, and how much geometry/physics that costs right now.
    // Without it the overlay cannot show that the ring follows the car.
    const stream = this.streamingProvider ? this.streamingProvider() : null;
    const streamRow = stream
      ? `\nSTREAM ${stream.loaded} loaded` +
        ` (+${stream.pending} pending)` +
        ` | ${stream.colliders} collider chunks` +
        `\n       LOD0 ${stream.lod0} / LOD1 ${stream.lod1}` +
        ` | ${stream.tris.toLocaleString()} tris`
      : '';
    // The DRIVE row is the drivetrain readout: what the car is being told to do
    // and whether it has anything to push against.
    const veh = this.vehicleProvider ? this.vehicleProvider() : null;
    const driveRow = veh
      ? `\nDRIVE ${veh.speedKmh.toFixed(1)} km/h  gear ${veh.gear}  ${Math.round(veh.rpm)} rpm` +
        `\n      thr ${veh.throttle.toFixed(2)} | grounded ${veh.grounded}/4 | y ${veh.y.toFixed(1)}` +
        `\n      trip ${veh.tripKm.toFixed(3)} km | sim ${veh.driveSec.toFixed(1)} s`
      : '';
    this.overlay.textContent =
      `FPS ${s.fps}  (target ${this.targetFps})` +
      `\nframe ${s.frameTime.toFixed(1)} ms` +
      `\ndraw calls ${s.drawCalls}` +
      `\ntriangles ${s.triangles.toLocaleString()}` +
      `\nphysics ${s.physicsBodies} bodies / ${s.physicsColliders} colliders` +
      `\nJS heap ${s.memoryMB > 0 ? s.memoryMB.toFixed(0) + ' MB' : '—'}` +
      `\nquality ${this.level}/${QUALITY_LEVELS.length - 1}` +
      ` scale ${lvl.renderScale.toFixed(2)}` +
      `\nadaptive ${this.adaptive ? 'ON' : 'OFF'}` +
      driveRow +
      streamRow;
  }

  isOverlayVisible(): boolean {
    return this.overlay !== null;
  }

  dispose(): void {
    // Hand the counters back to three.js; the renderer outlives this manager.
    this.renderer.info.autoReset = true;
    window.removeEventListener('keydown', this.onKeyDown);
    this.hideOverlay();
  }
}
