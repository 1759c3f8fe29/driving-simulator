/**
 * PostProcessing — EffectComposer with bloom, SMAA, vignette.
 * Each effect individually toggleable from Graphics Settings.
 * AAA additions: animated vignette strength (damage/cinematic pulses) and a
 * cheap per-frame film grain pass, both gated by adaptive quality in Game.ts.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { MotionBlurPass } from './passes/MotionBlurPass';
import { CONFIG, clamp, damp } from '../core/Config';

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0.35 },
    smoothness: { value: 0.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float smoothness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 dist = vUv - 0.5;
      float vignette = 1.0 - smoothstep(0.8 - smoothness * 0.4, 1.35, length(dist) * (1.0 + strength));
      gl_FragColor = vec4(color.rgb * vignette, color.a);
    }
  `,
};

/**
 * Film grain — cheap animated noise layered over the frame.
 * Hash of per-pixel coords + time so it flickers every frame like real stock.
 */
const GrainShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    amount: { value: CONFIG.cinematics.filmGrain.amount },
    time: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float amount;
    uniform float time;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float grain = hash(gl_FragCoord.xy + vec2(fract(time) * 731.0, fract(time * 1.37) * 491.0));
      color.rgb += (grain - 0.5) * amount;
      gl_FragColor = vec4(clamp(color.rgb, 0.0, 1.0), color.a);
    }
  `,
};

export class PostProcessing {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private ssaoPass: SSAOPass;
  private bloomPass: UnrealBloomPass;
  private motionBlurPass: MotionBlurPass;
  private smaaPass: SMAAPass;
  private vignettePass: ShaderPass;
  private grainPass: ShaderPass;
  private outputPass: OutputPass;
  private enabled = true;

  private vignetteUniforms: { [uniform: string]: THREE.IUniform };
  private grainUniforms: { [uniform: string]: THREE.IUniform };
  private vignettePulse = 0;
  /** Last pixel ratio pushed into the composer; see `syncPixelRatio`. */
  private pixelRatio: number;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.pixelRatio = renderer.getPixelRatio();
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // SSAO (before bloom: darkens HDR input before thresholding). Off by default.
    this.ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
    this.ssaoPass.enabled = false;
    this.ssaoPass.kernelRadius = 6;
    this.composer.addPass(this.ssaoPass);

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.35, // strength
      0.6, // radius
      0.85 // threshold
    );
    this.composer.addPass(this.bloomPass);

    // Motion blur (after bloom so glow blurs too, before SMAA so AA cleans it). Off by default.
    this.motionBlurPass = new MotionBlurPass(scene, camera, window.innerWidth, window.innerHeight);
    this.motionBlurPass.enabled = false;
    this.composer.addPass(this.motionBlurPass);

    this.smaaPass = new SMAAPass(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.smaaPass);

    this.vignettePass = new ShaderPass(VignetteShader);
    this.composer.addPass(this.vignettePass);
    this.vignetteUniforms = this.vignettePass.uniforms;

    // Film grain (on by default; Game.ts gates it by quality level).
    this.grainPass = new ShaderPass(GrainShader);
    this.composer.addPass(this.grainPass);
    this.grainUniforms = this.grainPass.uniforms;

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);
  }

  setCamera(camera: THREE.Camera): void {
    this.renderPass.camera = camera;
  }

  setBloom(enabled: boolean, strength = 0.35): void {
    this.bloomPass.enabled = enabled;
    this.bloomPass.strength = strength;
  }

  setSSAO(enabled: boolean, intensity = 1): void {
    this.ssaoPass.enabled = enabled;
    this.ssaoPass.kernelRadius = 6 + intensity * 8; // 0..1 scale around the default radius
  }

  setMotionBlur(enabled: boolean, intensity = 1): void {
    this.motionBlurPass.enabled = enabled;
    this.motionBlurPass.setIntensity(intensity * 0.6);
  }

  setAntialiasing(enabled: boolean): void {
    this.smaaPass.enabled = enabled;
  }

  setVignette(enabled: boolean): void {
    this.vignettePass.enabled = enabled;
  }

  /** Override the vignette strength (0..1.5); the base is re-applied by updateFx each frame. */
  setVignetteStrength(v: number): void {
    this.vignetteUniforms.strength.value = clamp(v, 0, 1.5);
  }

  /** Add a decaying vignette pulse (collision impact, damage). */
  pulseVignette(strength: number): void {
    this.vignettePulse = Math.min(1.2, this.vignettePulse + strength);
  }

  /** Toggle + set the film-grain amount. */
  setFilmGrain(enabled: boolean, amount = CONFIG.cinematics.filmGrain.amount): void {
    this.grainPass.enabled = enabled;
    this.grainUniforms.amount.value = amount;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Per-frame FX updates: decay pulses, animate grain. */
  private updateFx(dt: number): void {
    this.vignettePulse = damp(this.vignettePulse, 0, CONFIG.cinematics.damagePulse.decay, dt);
    this.setVignetteStrength(CONFIG.cinematics.vignetteBase + this.vignettePulse);
    this.grainUniforms.time.value += dt;
  }

  resize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  /**
   * Re-read the renderer's pixel ratio into the composer's render targets.
   *
   * EffectComposer samples `renderer.getPixelRatio()` once at construction and
   * again only on `reset()`, so changing the renderer's pixel ratio for the
   * adaptive render scale resizes the canvas but leaves every composer target at
   * the old resolution — the passes keep paying full price and the result is
   * downsampled on the final blit. Calling this after a scale change is what
   * makes `renderScale` actually cheaper. No-ops when the ratio is unchanged,
   * because the resize reallocates every pass's targets.
   */
  syncPixelRatio(renderer: THREE.WebGLRenderer): void {
    const ratio = renderer.getPixelRatio();
    if (ratio === this.pixelRatio) return;
    this.pixelRatio = ratio;
    this.composer.setPixelRatio(ratio);
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, dt: number): void {
    this.updateFx(dt);
    if (this.enabled) {
      this.composer.render(dt);
    } else {
      renderer.render(scene, camera);
    }
  }

  dispose(): void {
    this.composer.dispose();
    this.bloomPass.dispose();
    this.smaaPass.dispose();
    this.ssaoPass.dispose();
    this.motionBlurPass.dispose();
  }
}
