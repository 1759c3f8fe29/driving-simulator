/**
 * MotionBlurPass — Camera-space velocity reconstruction blur for three r166
 * (which ships no MotionBlurPass). Renders scene depth, re-projects it through the
 * previous view-projection matrix to build per-pixel motion vectors, then samples
 * the input buffer along the velocity. Purely post-render; needs only scene/camera.
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

const MotionBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    inverseCurrentProjView: { value: new THREE.Matrix4() },
    previousProjView: { value: new THREE.Matrix4() },
    intensity: { value: 0.5 },
    maxSamples: { value: 8 },
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
    uniform sampler2D tDepth;
    uniform mat4 inverseCurrentProjView;
    uniform mat4 previousProjView;
    uniform float intensity;
    uniform float maxSamples;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float depth = texture2D(tDepth, vUv).x;
      if (depth >= 0.9999) { gl_FragColor = color; return; }
      vec4 clip = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      vec4 world = inverseCurrentProjView * clip;
      world /= world.w;
      vec4 prev = previousProjView * world;
      prev /= prev.w;
      vec2 velocity = (vUv * 2.0 - 1.0 - prev.xy) * intensity;
      vec4 sum = color;
      for (float i = 1.0; i <= maxSamples; i++) {
        float t = i / maxSamples;
        vec2 suv = vUv - velocity * t;
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
        sum += texture2D(tDiffuse, suv);
      }
      gl_FragColor = vec4(sum.rgb / (maxSamples + 1.0), color.a);
    }
  `,
};

export class MotionBlurPass extends Pass {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private fsQuad: FullScreenQuad;
  private depthMaterial = new THREE.MeshDepthMaterial();
  private depthRT: THREE.WebGLRenderTarget;
  private material: THREE.ShaderMaterial;
  private currentProjView = new THREE.Matrix4();
  private inverseCurrentProjView = new THREE.Matrix4();
  private previousProjView = new THREE.Matrix4();

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = true;
    this.material = new THREE.ShaderMaterial({
      ...MotionBlurShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.depthRT = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(width, height),
      depthBuffer: true,
    });
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget
  ): void {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.currentProjView.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.inverseCurrentProjView.copy(this.currentProjView).invert();

    // 1) Render scene depth
    const prevOverride = this.scene.overrideMaterial;
    renderer.setRenderTarget(this.depthRT);
    this.scene.overrideMaterial = this.depthMaterial;
    renderer.render(this.scene, cam);
    this.scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(null);

    // 2) Composite motion-blurred result
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    this.material.uniforms.tDepth.value = this.depthRT.depthTexture;
    this.material.uniforms.inverseCurrentProjView.value.copy(this.inverseCurrentProjView);
    this.material.uniforms.previousProjView.value.copy(this.previousProjView);
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsQuad.render(renderer);

    this.previousProjView.copy(this.currentProjView);
  }

  setSize(width: number, height: number): void {
    this.depthRT.setSize(width, height);
  }

  setIntensity(v: number): void {
    this.material.uniforms.intensity.value = v;
  }

  dispose(): void {
    this.material.dispose();
    this.depthMaterial.dispose();
    this.depthRT.dispose();
    this.fsQuad.dispose();
  }
}
