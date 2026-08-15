/**
 * CameraManager — All camera modes with smooth transitions.
 * Third Person, Near/Far Chase, Cockpit, Hood, Bumper, Orbit, Free, Photo.
 */

import * as THREE from 'three';
import { CONFIG, clamp, damp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { VehicleTelemetry } from '../vehicle/VehicleController';

export type CameraMode =
  | 'chase'
  | 'nearChase'
  | 'farChase'
  | 'cockpit'
  | 'hood'
  | 'bumper'
  | 'orbit'
  | 'free';

const MODE_ORDER: CameraMode[] = ['chase', 'nearChase', 'farChase', 'cockpit', 'hood', 'bumper', 'orbit'];

const MODE_LABELS: Record<CameraMode, string> = {
  chase: 'Third Person',
  nearChase: 'Near Chase',
  farChase: 'Far Chase',
  cockpit: 'Cockpit',
  hood: 'Hood',
  bumper: 'Front Bumper',
  orbit: 'Orbit',
  free: 'Free Camera',
};

interface ChaseParams {
  distance: number;
  height: number;
  lookAhead: number;
}

const CHASE_PARAMS: Record<string, ChaseParams> = {
  chase: { distance: CONFIG.camera.chaseDistance, height: CONFIG.camera.chaseHeight, lookAhead: CONFIG.camera.chaseLookAhead },
  nearChase: { distance: 4.4, height: 1.6, lookAhead: 2.6 },
  farChase: { distance: 9.5, height: 3.2, lookAhead: 1.6 },
};

export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  private bus = EventBus.get();
  mode: CameraMode = 'chase';
  private position = new THREE.Vector3(0, 3, -8);
  private lookTarget = new THREE.Vector3();
  private smoothedLook = new THREE.Vector3();
  private orbitAngle = 0;
  private orbitPitch = 0.25;
  private orbitDistance = 7;
  private freePosition = new THREE.Vector3(0, 10, -10);
  private freeYaw = 0;
  private freePitch = -0.3;
  private shakeIntensity = 0;
  private fovKick = 0;
  private pointerDown = false;
  private lastPointer = { x: 0, y: 0 };
  private cinematic = false;
  private menuOrbit = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, aspect, 0.1, 4000);
    this.camera.position.copy(this.position);
    this.bindPointer();
    this.bus.on('input:cameraNext:down', () => this.nextMode());
  }

  private bindPointer(): void {
    const canvas = document.getElementById('game-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (e) => {
      this.pointerDown = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener('pointerup', () => (this.pointerDown = false));
    window.addEventListener('pointermove', (e) => {
      if (!this.pointerDown) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      if (this.mode === 'orbit') {
        this.orbitAngle -= dx * 0.008;
        this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, -0.1, 1.2);
      } else if (this.mode === 'free') {
        this.freeYaw -= dx * 0.004;
        this.freePitch = clamp(this.freePitch - dy * 0.004, -1.4, 1.4);
      }
    });
    canvas.addEventListener('wheel', (e) => {
      if (this.mode === 'orbit') {
        this.orbitDistance = clamp(this.orbitDistance + e.deltaY * 0.01, 3, 25);
      } else if (this.mode === 'free') {
        // Dolly along the camera's view direction (wheel up = forward)
        const dir = new THREE.Vector3(
          Math.cos(this.freeYaw) * Math.cos(this.freePitch),
          Math.sin(this.freePitch),
          Math.sin(this.freeYaw) * Math.cos(this.freePitch)
        );
        this.freePosition.addScaledVector(dir, -e.deltaY * 0.08);
      }
    }, { passive: true });
  }

  nextMode(): void {
    const idx = MODE_ORDER.indexOf(this.mode);
    this.mode = MODE_ORDER[(idx + 1) % MODE_ORDER.length];
    this.bus.emit(Events.CAMERA_CHANGED, { mode: this.mode, label: MODE_LABELS[this.mode] });
    this.bus.emit(Events.NOTIFY, { type: 'info', message: `Camera: ${MODE_LABELS[this.mode]}`, icon: 'camera' });
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.bus.emit(Events.CAMERA_CHANGED, { mode, label: MODE_LABELS[mode] });
  }

  addShake(intensity: number): void {
    this.shakeIntensity = Math.min(1, this.shakeIntensity + intensity);
  }

  /** Take control of the camera from an external cinematic director. */
  beginCinematic(): void {
    this.cinematic = true;
  }

  /** Place the camera for the current cinematic frame. */
  setCinematicPose(position: THREE.Vector3, lookAt: THREE.Vector3): void {
    this.position.copy(position);
    this.smoothedLook.copy(lookAt);
    this.camera.position.copy(position);
    this.camera.lookAt(lookAt);
    this.camera.updateProjectionMatrix();
  }

  /** Hand control back to the normal gameplay camera. */
  endCinematic(): void {
    this.cinematic = false;
  }

  get isCinematic(): boolean {
    return this.cinematic;
  }

  /** Slow, high turntable orbit used as the main-menu backdrop. */
  setMenuOrbit(active: boolean): void {
    this.menuOrbit = active;
    if (active) {
      this.orbitDistance = CONFIG.cinematics.menuOrbit.distance;
      this.orbitPitch = CONFIG.cinematics.menuOrbit.pitch;
    }
  }

  update(telemetry: VehicleTelemetry | null, dt: number): void {
    if (!telemetry) return;
    // An external director drives the camera while a cinematic is active.
    if (this.cinematic) return;
    const pos = telemetry.position;
    const quat = telemetry.quaternion;
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);

    let desired = this.position.clone();
    let look = pos.clone();
    let stiffness = CONFIG.camera.chaseStiffness;
    let targetFov = CONFIG.camera.fov;

    switch (this.mode) {
      case 'chase':
      case 'nearChase':
      case 'farChase': {
        const p = CHASE_PARAMS[this.mode];
        desired = pos.clone().addScaledVector(forward, -p.distance).addScaledVector(up, p.height);
        look = pos.clone().addScaledVector(forward, p.lookAhead).addScaledVector(up, 0.8);
        // Speed FOV kick
        this.fovKick = damp(this.fovKick, clamp(telemetry.speedKmh / 280, 0, 1) * 8, 3, dt);
        targetFov = CONFIG.camera.fov + this.fovKick;
        break;
      }
      case 'cockpit': {
        desired = pos.clone().addScaledVector(forward, 0.25).addScaledVector(up, 1.08);
        look = pos.clone().addScaledVector(forward, 10).addScaledVector(up, 0.95);
        stiffness = 30;
        targetFov = CONFIG.camera.cockpitFov;
        break;
      }
      case 'hood': {
        desired = pos.clone().addScaledVector(forward, 1.55).addScaledVector(up, 0.95);
        look = pos.clone().addScaledVector(forward, 12).addScaledVector(up, 0.6);
        stiffness = 30;
        break;
      }
      case 'bumper': {
        desired = pos.clone().addScaledVector(forward, 2.15).addScaledVector(up, 0.42);
        look = pos.clone().addScaledVector(forward, 14).addScaledVector(up, 0.35);
        stiffness = 30;
        break;
      }
      case 'orbit': {
        this.orbitAngle += dt * (this.menuOrbit ? CONFIG.cinematics.menuOrbit.speed : 0.12);
        desired = pos.clone().add(
          new THREE.Vector3(
            Math.cos(this.orbitAngle) * this.orbitDistance * Math.cos(this.orbitPitch),
            Math.sin(this.orbitPitch) * this.orbitDistance + (this.menuOrbit ? CONFIG.cinematics.menuOrbit.height : 1),
            Math.sin(this.orbitAngle) * this.orbitDistance * Math.cos(this.orbitPitch)
          )
        );
        look = pos.clone().addScaledVector(up, 0.6);
        stiffness = 8;
        break;
      }
      case 'free': {
        const dir = new THREE.Vector3(
          Math.cos(this.freeYaw) * Math.cos(this.freePitch),
          Math.sin(this.freePitch),
          Math.sin(this.freeYaw) * Math.cos(this.freePitch)
        );
        desired = this.freePosition.clone();
        look = this.freePosition.clone().add(dir);
        stiffness = 100;
        break;
      }
    }

    // Smooth position
    const t = 1 - Math.exp(-stiffness * dt);
    this.position.lerp(desired, t);
    this.smoothedLook.lerp(look, 1 - Math.exp(-stiffness * 1.4 * dt));

    // Camera shake decay
    this.shakeIntensity = damp(this.shakeIntensity, 0, 6, dt);
    const shake = this.shakeIntensity * 0.12;
    const shakeOffset = new THREE.Vector3(
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake,
      (Math.random() - 0.5) * shake
    );

    this.camera.position.copy(this.position).add(shakeOffset);
    this.camera.lookAt(this.smoothedLook);
    this.camera.fov = damp(this.camera.fov, targetFov, 4, dt);
    this.camera.updateProjectionMatrix();
  }

  /** Free camera movement (photo mode). */
  moveFreeCamera(delta: THREE.Vector3): void {
    this.freePosition.add(delta);
  }

  /** Drive the free camera from input in photo mode. */
  updateFreeCamera(move: { x: number; y: number; z: number; fast: boolean; slow: boolean }, dt: number): void {
    const cfg = CONFIG.photo.freeCamera;
    const mult = move.fast ? cfg.fastMultiplier : move.slow ? cfg.slowMultiplier : 1;
    const step = cfg.moveSpeed * mult * dt;
    const sinYaw = Math.sin(this.freeYaw);
    const cosYaw = Math.cos(this.freeYaw);
    const forward = new THREE.Vector3(cosYaw, 0, sinYaw);
    const right = new THREE.Vector3(-sinYaw, 0, cosYaw);
    const delta = new THREE.Vector3();
    delta.addScaledVector(forward, -move.z * step);
    delta.addScaledVector(right, move.x * step);
    delta.y += move.y * step;
    this.freePosition.add(delta);
  }

  getFreeCameraPose(): { position: THREE.Vector3; yaw: number; pitch: number } {
    return { position: this.freePosition.clone(), yaw: this.freeYaw, pitch: this.freePitch };
  }

  setFreeCameraTarget(target: THREE.Vector3): void {
    this.freePosition.copy(target).add(new THREE.Vector3(0, 4, -8));
  }

  getModeLabel(): string {
    return MODE_LABELS[this.mode];
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
