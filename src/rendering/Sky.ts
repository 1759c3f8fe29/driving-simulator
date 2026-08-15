/**
 * Sky — Procedural dynamic sky: sun, moon, stars, atmospheric gradient,
 * day/night cycle. Drives the directional lights.
 */

import * as THREE from 'three';
import { CONFIG, clamp, lerp } from '../core/Config';

export interface SkyState {
  timeOfDay: number; // 0..24 hours
  sunElevation: number; // -1..1
  sunDirection: THREE.Vector3;
  isNight: boolean;
  skyColorTop: THREE.Color;
  skyColorHorizon: THREE.Color;
  sunIntensity: number;
  ambientIntensity: number;
}

// Keyframe colors through the day
const SKY_KEYS: Array<{ t: number; top: THREE.Color; horizon: THREE.Color; sun: number; amb: number }> = [
  { t: 0.0, top: new THREE.Color(0x060a18), horizon: new THREE.Color(0x0d1226), sun: 0.0, amb: 0.06 },
  { t: 4.5, top: new THREE.Color(0x060a18), horizon: new THREE.Color(0x101528), sun: 0.0, amb: 0.06 },
  { t: 6.0, top: new THREE.Color(0x2a3d66), horizon: new THREE.Color(0xd97a4a), sun: 0.35, amb: 0.25 },
  { t: 7.5, top: new THREE.Color(0x4a7ec2), horizon: new THREE.Color(0xe8b98a), sun: 0.8, amb: 0.5 },
  { t: 12.0, top: new THREE.Color(0x3d7bd6), horizon: new THREE.Color(0xa8c8e8), sun: 1.25, amb: 0.75 },
  { t: 16.5, top: new THREE.Color(0x3d74c9), horizon: new THREE.Color(0xb8cfe0), sun: 1.1, amb: 0.7 },
  { t: 18.5, top: new THREE.Color(0x2a3d66), horizon: new THREE.Color(0xe07a3a), sun: 0.4, amb: 0.3 },
  { t: 20.0, top: new THREE.Color(0x0d1226), horizon: new THREE.Color(0x1a2040), sun: 0.05, amb: 0.1 },
  { t: 24.0, top: new THREE.Color(0x060a18), horizon: new THREE.Color(0x0d1226), sun: 0.0, amb: 0.06 },
];

function sampleKeys(t: number): { top: THREE.Color; horizon: THREE.Color; sun: number; amb: number } {
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    const a = SKY_KEYS[i];
    const b = SKY_KEYS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t);
      return {
        top: a.top.clone().lerp(b.top, f),
        horizon: a.horizon.clone().lerp(b.horizon, f),
        sun: lerp(a.sun, b.sun, f),
        amb: lerp(a.amb, b.amb, f),
      };
    }
  }
  const last = SKY_KEYS[SKY_KEYS.length - 1];
  return { top: last.top.clone(), horizon: last.horizon.clone(), sun: last.sun, amb: last.amb };
}

const SKY_VERT = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(worldPos.xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w; // depth = far
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 sunDirection;
uniform vec3 sunColor;
uniform float sunIntensity;
uniform float nightFactor;
uniform float cloudCover;
uniform float time;
varying vec3 vWorldDir;

// Hash & noise for stars and clouds
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
  return v;
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float h = clamp(dir.y, -0.05, 1.0);
  vec3 sky = mix(horizonColor, topColor, pow(max(h, 0.0), 0.55));

  // Sun disc + glow
  float sunDot = max(dot(dir, sunDirection), 0.0);
  vec3 sun = sunColor * (pow(sunDot, 900.0) * 4.0 + pow(sunDot, 24.0) * 0.35) * sunIntensity;
  sky += sun;

  // Stars at night
  if (nightFactor > 0.01 && dir.y > 0.0) {
    vec2 sp = dir.xz / (dir.y + 0.4) * 60.0;
    float star = step(0.9975, hash(floor(sp)));
    float twinkle = 0.6 + 0.4 * sin(time * 2.0 + hash(floor(sp)) * 40.0);
    sky += vec3(star * twinkle * nightFactor * smoothstep(0.0, 0.25, dir.y));
  }

  // Clouds
  if (cloudCover > 0.01 && dir.y > 0.02) {
    vec2 cp = dir.xz / (dir.y + 0.25) * 1.6 + vec2(time * 0.006, 0.0);
    float c = fbm(cp);
    float cloud = smoothstep(1.0 - cloudCover * 0.85, 1.25 - cloudCover * 0.5, c);
    vec3 cloudCol = mix(horizonColor * 1.15, vec3(0.95), 0.4) * (0.35 + sunIntensity * 0.55);
    cloudCol = mix(cloudCol, vec3(0.12, 0.12, 0.16), nightFactor * 0.85);
    sky = mix(sky, cloudCol, cloud * 0.85 * smoothstep(0.02, 0.2, dir.y));
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  readonly sunLight: THREE.DirectionalLight;
  readonly moonLight: THREE.DirectionalLight;
  readonly ambientLight: THREE.AmbientLight;
  readonly hemiLight: THREE.HemisphereLight;
  timeOfDay = CONFIG.weather.startTimeOfDay;
  cloudCover = 0.25;
  private state: SkyState;

  constructor(scene: THREE.Scene) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        topColor: { value: new THREE.Color(0x3d7bd6) },
        horizonColor: { value: new THREE.Color(0xa8c8e8) },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        sunColor: { value: new THREE.Color(0xfff2dd) },
        sunIntensity: { value: 1.2 },
        nightFactor: { value: 0 },
        cloudCover: { value: 0.25 },
        time: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(3000, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    this.sunLight = new THREE.DirectionalLight(0xfff2dd, 2.6);
    this.sunLight.castShadow = true;
    this.setShadowQuality(CONFIG.renderer.shadowMapSize);
    this.sunLight.shadow.camera.near = 10;
    this.sunLight.shadow.camera.far = 400;
    const s = 90;
    this.sunLight.shadow.camera.left = -s;
    this.sunLight.shadow.camera.right = s;
    this.sunLight.shadow.camera.top = s;
    this.sunLight.shadow.camera.bottom = -s;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.02;
    scene.add(this.sunLight);
    scene.add(this.sunLight.target);

    this.moonLight = new THREE.DirectionalLight(0x8fa8d6, 0);
    scene.add(this.moonLight);
    scene.add(this.moonLight.target);

    this.ambientLight = new THREE.AmbientLight(0xbdd3e8, 0.5);
    scene.add(this.ambientLight);

    this.hemiLight = new THREE.HemisphereLight(0x87b5d6, 0x3a3f35, 0.5);
    scene.add(this.hemiLight);

    this.state = this.computeState();
  }

  private computeState(): SkyState {
    // Sun path: elevation peaks at noon
    const sunAngle = ((this.timeOfDay - 6) / 12) * Math.PI; // 6h -> 0, 18h -> PI
    const elevation = Math.sin(sunAngle);
    const azimuth = Math.PI * 0.25 + ((this.timeOfDay - 12) / 12) * Math.PI * 0.7;
    const sunDir = new THREE.Vector3(
      Math.cos(azimuth) * Math.cos(Math.asin(clamp(elevation, -1, 1))),
      elevation,
      Math.sin(azimuth) * Math.cos(Math.asin(clamp(elevation, -1, 1)))
    ).normalize();
    const keys = sampleKeys(this.timeOfDay);
    return {
      timeOfDay: this.timeOfDay,
      sunElevation: elevation,
      sunDirection: sunDir,
      isNight: elevation < -0.05,
      skyColorTop: keys.top,
      skyColorHorizon: keys.horizon,
      sunIntensity: keys.sun,
      ambientIntensity: keys.amb,
    };
  }

  /** Advance the day/night cycle and update lights. */
  update(dt: number, followPosition: THREE.Vector3, weatherDimming: number, timeScale = 1): SkyState {
    this.timeOfDay = (this.timeOfDay + (dt * timeScale * 24) / CONFIG.weather.dayLengthSeconds) % 24;
    this.state = this.computeState();
    const s = this.state;

    this.mesh.position.copy(followPosition);
    const u = this.material.uniforms;
    u.topColor.value.copy(s.skyColorTop);
    u.horizonColor.value.copy(s.skyColorHorizon);
    u.sunDirection.value.copy(s.sunDirection);
    u.sunIntensity.value = s.sunIntensity * weatherDimming;
    u.nightFactor.value = clamp(-s.sunElevation * 6, 0, 1);
    u.cloudCover.value = this.cloudCover;
    u.time.value += dt;

    // Sun light follows player for stable shadows
    const sunDist = 180;
    this.sunLight.position.copy(followPosition).addScaledVector(s.sunDirection, sunDist);
    this.sunLight.target.position.copy(followPosition);
    const dayFactor = clamp(s.sunElevation * 4, 0, 1);
    this.sunLight.intensity = 2.6 * s.sunIntensity * dayFactor * weatherDimming;
    this.sunLight.color.setHSL(0.09, 0.5, lerp(0.62, 0.72, dayFactor));

    // Moon: opposite the sun
    this.moonLight.position.copy(followPosition).addScaledVector(s.sunDirection, -sunDist);
    this.moonLight.target.position.copy(followPosition);
    this.moonLight.intensity = clamp(-s.sunElevation * 3, 0, 1) * 0.35 * weatherDimming;

    this.ambientLight.intensity = s.ambientIntensity * weatherDimming;
    this.hemiLight.intensity = s.ambientIntensity * 0.9 * weatherDimming;
    this.hemiLight.color.copy(s.skyColorTop).lerp(new THREE.Color(0xffffff), 0.4);

    return s;
  }

  setTimeOfDay(hours: number): void {
    this.timeOfDay = ((hours % 24) + 24) % 24;
  }

  /** Resize the sun shadow map. Disposes + nulls the map so WebGLShadowMap re-creates it. */
  setShadowQuality(size: number): void {
    const s = Math.max(256, Math.min(4096, Math.floor(size)));
    this.sunLight.shadow.mapSize.set(s, s);
    this.sunLight.shadow.map?.dispose();
    this.sunLight.shadow.map = null; // forces re-creation at the new size next render
    this.sunLight.shadow.needsUpdate = true;
  }

  getState(): SkyState {
    return this.state;
  }
}
