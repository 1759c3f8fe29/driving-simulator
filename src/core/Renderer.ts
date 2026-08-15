/**
 * Renderer — WebGL renderer configuration per PART_1A spec.
 */

import * as THREE from 'three';
import { CONFIG, isMobile } from './Config';

export class Renderer {
  readonly instance: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private resizeCallbacks = new Set<(w: number, h: number) => void>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true,
      stencil: false,
    });

    this.instance.outputColorSpace = THREE.SRGBColorSpace;
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = CONFIG.renderer.toneMappingExposure;
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFSoftShadowMap;
    this.instance.shadowMap.autoUpdate = true;

    this.applyPixelRatio();
    this.resize();

    window.addEventListener('resize', this.resize, { passive: true });
    window.addEventListener('orientationchange', this.resize, { passive: true });
  }

  private applyPixelRatio(): void {
    const cap = isMobile() ? CONFIG.renderer.mobileMaxPixelRatio : CONFIG.renderer.maxPixelRatio;
    this.instance.setPixelRatio(Math.min(window.devicePixelRatio, cap));
  }

  private resize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.instance.setSize(w, h, false);
    for (const cb of this.resizeCallbacks) cb(w, h);
  };

  onResize(cb: (w: number, h: number) => void): () => void {
    this.resizeCallbacks.add(cb);
    return () => this.resizeCallbacks.delete(cb);
  }

  setExposure(exposure: number): void {
    this.instance.toneMappingExposure = exposure;
  }

  setShadowQuality(size: number): void {
    CONFIG.renderer.shadowMapSize;
    this.instance.shadowMap.needsUpdate = true;
    void size;
  }

  get width(): number {
    return this.canvas.clientWidth;
  }

  get height(): number {
    return this.canvas.clientHeight;
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.instance.dispose();
  }
}
