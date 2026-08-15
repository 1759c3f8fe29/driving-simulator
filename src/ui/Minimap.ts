/**
 * Minimap — 2D canvas, north-up, player-centred local view of the streamed city
 * district. Shows a rotating player arrow at the centre, a north indicator, a
 * grid whose spacing is exactly CONFIG.streaming.chunkSize world metres (so
 * chunk seams are visible), shading for the chunks currently streamed in, and
 * the baked world boundary when it comes into view.
 *
 * World convention: +X is east, +Z is north, +Y is up. The map is north-up and
 * centred on the player; yawRadians is the rotation about world +Y (three.js
 * euler.y, YXZ order): yaw 0 heads toward +Z (north) and positive yaw turns the
 * arrow clockwise on screen (toward +X / east).
 *
 * Cost control on a 2-core i3: the map redraws at most REDRAW_HZ times per
 * second and only when the player actually moved/turned or the loaded chunk set
 * changed. Two offscreen layers are cached and blitted: a grid tile (periodic in
 * chunkSize, so it can be panned by a sub-cell offset instead of restroked) and
 * the fixed chrome (ring, compass, scale bar). Both are rebuilt only on
 * resize/bounds/zoom change.
 *
 * The previous version drew a hand-authored 5 km San Francisco shoreline and
 * street grid around the world origin. That geometry does not match the baked
 * 1.9 km district, so it is gone: the chunk grid plus streamed-chunk shading is
 * both accurate and cheaper.
 */

import * as THREE from 'three';
import { CONFIG } from '../core/Config';

const DEFAULT_WORLD_HALF_M = 2500; // pre-setWorldBounds fallback (old MAP_RADIUS_M)
const VIEW_RADIUS_M = 400;         // metres from the player to the map edge
const POS_EPSILON_M = 0.25;        // movement threshold (m) that marks a redraw
const YAW_EPSILON_RAD = 0.02;      // heading threshold (rad, ~1.1°) for a redraw
const IDLE_REDRAW_MS = 500;        // repaint at least 2x/second while parked
const REDRAW_HZ = 12;              // hard redraw ceiling
const MIN_REDRAW_MS = 1000 / REDRAW_HZ;
const MAX_DPR = 2;                 // cap backing-store DPR to keep the canvas cheap
const FONT = "'Cascadia Code','JetBrains Mono',Consolas,monospace";

export class Minimap {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gridCanvas: HTMLCanvasElement;
  private gridCtx: CanvasRenderingContext2D;
  private chromeCanvas: HTMLCanvasElement;
  private chromeCtx: CanvasRenderingContext2D;
  private injectedStyle: HTMLStyleElement | null = null;
  private ro: ResizeObserver | null = null;

  private onResize: () => void;
  private onKey: (e: KeyboardEvent) => void;

  private dpr = 1;
  private dev = 200;         // backing-store size in device px (square)
  private centerX = 0;
  private centerY = 0;
  private radiusDev = 0;
  private scaleDP = 0;       // device px per world metre
  private viewRadiusM = VIEW_RADIUS_M;
  private cellM = 125;       // grid spacing in world metres (chunk size)
  private cellPx = 0;        // grid spacing in device px

  private worldMinX = -DEFAULT_WORLD_HALF_M;
  private worldMinZ = -DEFAULT_WORLD_HALF_M;
  private worldMaxX = DEFAULT_WORLD_HALF_M;
  private worldMaxZ = DEFAULT_WORLD_HALF_M;

  private visible = true;
  private enabled = true;
  private lastX = 0;
  private lastZ = 0;
  private lastYaw = 0;
  private drawnX = 0;
  private drawnZ = 0;
  private drawnYaw = 0;
  private lastDrawMs = -1e9;
  private dirty = true;

  // Loaded chunk cells, flattened as [cx, cz, cx, cz, ...]; grown, never shrunk.
  private cells = new Int32Array(256);
  private cellCount = 0;
  private cellHashXor = 0;
  private cellHashSum = 0;

  constructor(container: HTMLElement) {
    this.injectStyle();
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.innerHTML = '<canvas></canvas>';
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.gridCanvas = document.createElement('canvas');
    this.gridCtx = this.gridCanvas.getContext('2d')!;
    this.chromeCanvas = document.createElement('canvas');
    this.chromeCtx = this.chromeCanvas.getContext('2d')!;
    container.appendChild(this.el);

    this.cellM = Math.max(1, CONFIG.streaming.chunkSize);

    this.onResize = () => this.rebuildLayers();
    this.onKey = (e: KeyboardEvent) => this.handleKey(e);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKey);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.rebuildLayers());
      this.ro.observe(this.el);
    }

    this.rebuildLayers();
    this.render();
  }

  show(): void {
    this.visible = true;
    this.dirty = true;
    this.applyVisibility();
    if (this.enabled) this.render();
  }

  hide(): void {
    this.visible = false;
    this.applyVisibility();
  }

  get isVisible(): boolean {
    return this.visible;
  }

  /** Master switch: low-end hardware turns the redraw off entirely. */
  setEnabled(on: boolean): void {
    if (this.enabled === on) return;
    this.enabled = on;
    this.applyVisibility();
    if (on) {
      this.dirty = true;
      if (this.visible) this.render();
    }
  }

  /** Called once at boot with the real baked world bounds. */
  setWorldBounds(min: { x: number; z: number }, max: { x: number; z: number }): void {
    const minX = Math.min(min.x, max.x);
    const maxX = Math.max(min.x, max.x);
    const minZ = Math.min(min.z, max.z);
    const maxZ = Math.max(min.z, max.z);
    if (!(maxX > minX) || !(maxZ > minZ)) return; // ignore degenerate/NaN bounds
    if (minX === this.worldMinX && maxX === this.worldMaxX &&
        minZ === this.worldMinZ && maxZ === this.worldMaxZ) return;
    this.worldMinX = minX;
    this.worldMaxX = maxX;
    this.worldMinZ = minZ;
    this.worldMaxZ = maxZ;
    this.rebuildLayers();
    this.dirty = true;
    if (this.enabled && this.visible) this.render();
  }

  /**
   * Replace the set of streamed-in chunks. Hashed order-independently so a
   * caller may hand this the same set every frame at near-zero cost.
   */
  setLoadedChunks(keys: ReadonlyArray<{ cx: number; cz: number }>): void {
    let xor = keys.length | 0;
    let sum = 0;
    for (let i = 0; i < keys.length; i++) {
      const h = ((keys[i].cx * 73856093) ^ (keys[i].cz * 19349663)) | 0;
      xor = (xor ^ h) | 0;
      sum = (sum + h) | 0;
    }
    if (xor === this.cellHashXor && sum === this.cellHashSum && keys.length === this.cellCount) return;
    this.cellHashXor = xor;
    this.cellHashSum = sum;
    if (this.cells.length < keys.length * 2) {
      this.cells = new Int32Array(Math.max(keys.length * 2, this.cells.length * 2));
    }
    for (let i = 0, o = 0; i < keys.length; i++, o += 2) {
      this.cells[o] = keys[i].cx;
      this.cells[o + 1] = keys[i].cz;
    }
    this.cellCount = keys.length;
    this.dirty = true;
  }

  /** Per-frame update: feed the player's world position and yaw (euler.y). */
  update(position: THREE.Vector3, yawRadians: number): void {
    this.lastX = position.x;
    this.lastZ = position.z;
    this.lastYaw = yawRadians;
    if (!this.enabled || !this.visible) return;

    // No dt is passed in, so the frame clock is derived from timestamps; same
    // effect as accumulating dt, with one fewer field to keep in sync.
    const now = performance.now();
    const since = now - this.lastDrawMs;
    if (since < MIN_REDRAW_MS) return;

    const dx = this.lastX - this.drawnX;
    const dz = this.lastZ - this.drawnZ;
    let dyaw = this.lastYaw - this.drawnYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw)); // wrap to [-pi, pi]
    const moved = dx * dx + dz * dz > POS_EPSILON_M * POS_EPSILON_M;
    const turned = Math.abs(dyaw) > YAW_EPSILON_RAD;
    if (moved || turned || this.dirty || since >= IDLE_REDRAW_MS) this.render();
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKey);
    this.ro?.disconnect();
    this.ro = null;
    this.el.remove();
    // Collapse the offscreen backing stores so the browser frees them promptly.
    this.gridCanvas.width = this.gridCanvas.height = 0;
    this.chromeCanvas.width = this.chromeCanvas.height = 0;
    if (this.injectedStyle) {
      this.injectedStyle.remove();
      this.injectedStyle = null;
    }
  }

  private applyVisibility(): void {
    if (this.visible && this.enabled) this.el.classList.remove('minimap-hidden');
    else this.el.classList.add('minimap-hidden');
  }

  private handleKey(e: KeyboardEvent): void {
    if (e.code !== 'KeyM') return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (this.visible) this.hide();
    else this.show();
  }

  private injectStyle(): void {
    if (document.getElementById('minimap-style')) return;
    const style = document.createElement('style');
    style.id = 'minimap-style';
    style.textContent = `
      .minimap {
        position: absolute; top: 92px; left: 16px;
        width: calc(200px * var(--hud-scale, 1));
        height: calc(200px * var(--hud-scale, 1));
        pointer-events: none !important;
        opacity: 1;
        transition: opacity 0.25s ease;
        filter: drop-shadow(0 6px 18px rgba(0, 0, 0, 0.55));
        z-index: 5;
      }
      .minimap canvas { width: 100%; height: 100%; display: block; pointer-events: none !important; }
      .minimap.minimap-hidden { opacity: 0; }
    `;
    document.head.appendChild(style);
    this.injectedStyle = style;
  }

  /** Resize for DPR and rebuild both cached layers. Bounds/zoom changes only. */
  private rebuildLayers(): void {
    const rect = this.el.getBoundingClientRect();
    const cssPx = rect.width || 200;
    this.dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const dev = Math.max(1, Math.round(cssPx * this.dpr));
    this.dev = dev;
    this.centerX = dev / 2;
    this.centerY = dev / 2;
    this.radiusDev = Math.max(1, (cssPx / 2 - 12) * this.dpr);

    // If the whole district is smaller than the default view, show all of it.
    const halfSpan = Math.max(this.worldMaxX - this.worldMinX, this.worldMaxZ - this.worldMinZ) / 2;
    this.viewRadiusM = Math.max(20, Math.min(VIEW_RADIUS_M, halfSpan));
    this.scaleDP = dev / (this.viewRadiusM * 2);
    this.cellPx = this.cellM * this.scaleDP;

    this.canvas.width = dev;
    this.canvas.height = dev;
    this.canvas.style.width = `${cssPx}px`;
    this.canvas.style.height = `${cssPx}px`;

    this.buildGridLayer();
    this.buildChromeLayer();
  }

  /**
   * Grid tile: one device-viewport plus one extra cell in each direction, with
   * lines at every multiple of cellPx starting at 0. Because the pattern is
   * periodic in cellPx it can be blitted at a sub-cell offset, so panning costs
   * one drawImage instead of restroking. All lines share one weight — emphasis
   * on, say, every fourth line would break that periodicity.
   */
  private buildGridLayer(): void {
    const cell = this.cellPx;
    const size = Math.max(1, Math.ceil(this.dev + cell * 2) + 1);
    this.gridCanvas.width = size;
    this.gridCanvas.height = size;

    const g = this.gridCtx;
    g.clearRect(0, 0, size, size);
    g.strokeStyle = 'rgba(150, 200, 255, 0.16)';
    g.lineWidth = Math.max(1, this.dpr);
    g.beginPath();
    if (cell >= 2) {
      const n = Math.ceil(size / cell);
      for (let i = 0; i <= n; i++) {
        const p = Math.round(i * cell) + 0.5;
        g.moveTo(p, 0);
        g.lineTo(p, size);
        g.moveTo(0, p);
        g.lineTo(size, p);
      }
    }
    g.stroke();
  }

  /** Fixed chrome: bezel ring, north letter, scale bar. Never pans. */
  private buildChromeLayer(): void {
    const dev = this.dev;
    this.chromeCanvas.width = dev;
    this.chromeCanvas.height = dev;
    const g = this.chromeCtx;
    const dpr = this.dpr;
    g.clearRect(0, 0, dev, dev);

    g.beginPath();
    g.arc(this.centerX, this.centerY, this.radiusDev, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    g.lineWidth = 1.5 * dpr;
    g.stroke();

    // North indicator: a tick plus an 'N' at the top of the ring. The map is
    // north-up, so both stay put and the player arrow does the rotating.
    const topY = this.centerY - this.radiusDev;
    g.beginPath();
    g.moveTo(this.centerX, topY - 2 * dpr);
    g.lineTo(this.centerX - 4.5 * dpr, topY + 7 * dpr);
    g.lineTo(this.centerX + 4.5 * dpr, topY + 7 * dpr);
    g.closePath();
    g.fillStyle = 'rgba(255, 120, 110, 0.9)';
    g.fill();

    g.fillStyle = 'rgba(255, 255, 255, 0.6)';
    g.font = `600 ${Math.round(10 * dpr)}px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', this.centerX, topY + 17 * dpr);

    // Scale bar: exactly one chunk wide, so it doubles as a grid-spacing key.
    const seg = Math.min(this.cellM * this.scaleDP, this.radiusDev * 1.2);
    const x0 = this.centerX - seg / 2;
    const y = this.centerY + this.radiusDev * 0.74;
    const h = 3 * dpr;
    g.fillStyle = 'rgba(255, 255, 255, 0.45)';
    g.fillRect(x0, y, seg, h);
    g.fillRect(x0, y - 2 * dpr, 1.5 * dpr, h + 4 * dpr);
    g.fillRect(x0 + seg, y - 2 * dpr, 1.5 * dpr, h + 4 * dpr);
    g.fillStyle = 'rgba(255, 255, 255, 0.55)';
    g.font = `${Math.round(9 * dpr)}px ${FONT}`;
    g.textBaseline = 'top';
    g.fillText(`${Math.round(this.cellM)} m`, this.centerX, y + h + 5 * dpr);
  }

  private render(): void {
    const g = this.ctx;
    const dev = this.dev;
    const dpr = this.dpr;
    const scale = this.scaleDP;
    const px = this.lastX;
    const pz = this.lastZ;
    g.clearRect(0, 0, dev, dev);

    g.save();
    g.beginPath();
    g.arc(this.centerX, this.centerY, this.radiusDev, 0, Math.PI * 2);
    g.clip();

    g.fillStyle = 'rgba(15, 20, 30, 0.82)';
    g.fillRect(0, 0, dev, dev);

    this.drawLoadedCells(g, px, pz, scale);

    // Pan the cached grid: the tile carries gridlines at every multiple of
    // cellPx from its own origin, so placing tile-local x=cellPx over the first
    // world gridline left of the viewport aligns the whole pattern. The tile is
    // one cell larger than the viewport on each side, so it always covers it.
    // Offsets are rounded to keep the 1px lines crisp (sub-pixel blit blurs).
    if (this.cellPx >= 2) {
      const cell = this.cellPx;
      const leftM = Math.floor((px - this.viewRadiusM) / this.cellM) * this.cellM;
      const topM = Math.ceil((pz + this.viewRadiusM) / this.cellM) * this.cellM;
      const ox = this.centerX + (leftM - px) * scale;
      const oy = this.centerY - (topM - pz) * scale;
      g.drawImage(this.gridCanvas, Math.round(ox - cell), Math.round(oy - cell));
    }

    this.drawWorldBorder(g, px, pz, scale);
    g.restore();

    g.drawImage(this.chromeCanvas, 0, 0);
    this.drawPlayer(g, dpr);

    this.drawnX = px;
    this.drawnZ = pz;
    this.drawnYaw = this.lastYaw;
    this.lastDrawMs = performance.now();
    this.dirty = false;
  }

  /** Shade streamed-in chunk cells, culled to the visible cell window. */
  private drawLoadedCells(g: CanvasRenderingContext2D, px: number, pz: number, scale: number): void {
    if (this.cellCount === 0) return;
    const cs = this.cellM;
    const r = this.viewRadiusM;
    const minCx = Math.floor((px - r) / cs);
    const maxCx = Math.floor((px + r) / cs);
    const minCz = Math.floor((pz - r) / cs);
    const maxCz = Math.floor((pz + r) / cs);
    const w = this.cellPx;
    g.fillStyle = 'rgba(70, 150, 235, 0.18)';
    for (let i = 0, o = 0; i < this.cellCount; i++, o += 2) {
      const cx = this.cells[o];
      const cz = this.cells[o + 1];
      if (cx < minCx || cx > maxCx || cz < minCz || cz > maxCz) continue;
      const sx = this.centerX + (cx * cs - px) * scale;
      const sy = this.centerY - ((cz + 1) * cs - pz) * scale;
      // Snap to whole device px: alpha fills on fractional edges double-blend
      // where two loaded cells meet and draw a visible seam.
      const x0 = Math.round(sx);
      const y0 = Math.round(sy);
      g.fillRect(x0, y0, Math.round(sx + w) - x0, Math.round(sy + w) - y0);
    }
  }

  /** Outline of the baked district, drawn only when an edge is in view. */
  private drawWorldBorder(g: CanvasRenderingContext2D, px: number, pz: number, scale: number): void {
    const r = this.viewRadiusM;
    if (px - r > this.worldMinX && px + r < this.worldMaxX &&
        pz - r > this.worldMinZ && pz + r < this.worldMaxZ) return;
    const x0 = this.centerX + (this.worldMinX - px) * scale;
    const x1 = this.centerX + (this.worldMaxX - px) * scale;
    const y0 = this.centerY - (this.worldMaxZ - pz) * scale;
    const y1 = this.centerY - (this.worldMinZ - pz) * scale;
    g.strokeStyle = 'rgba(255, 190, 90, 0.55)';
    g.lineWidth = 1.5 * this.dpr;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  /** Player arrow: always dead centre, rotated to the current heading. */
  private drawPlayer(g: CanvasRenderingContext2D, dpr: number): void {
    g.save();
    g.translate(this.centerX, this.centerY);
    g.rotate(this.lastYaw);
    g.beginPath();
    g.moveTo(0, -8 * dpr);
    g.lineTo(6 * dpr, 6 * dpr);
    g.lineTo(0, 2.5 * dpr);
    g.lineTo(-6 * dpr, 6 * dpr);
    g.closePath();
    g.fillStyle = '#2e9bff';
    g.fill();
    g.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    g.lineWidth = 1.2 * dpr;
    g.lineJoin = 'round';
    g.stroke();
    g.restore();
  }
}
