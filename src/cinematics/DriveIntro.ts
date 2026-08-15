/**
 * DriveIntro — AAA "drive-start" cinematic.
 *
 * On Play the screen fades from black, the camera swoops down a spline from a
 * high wide shot of San Francisco into the chase-cam slot behind the player
 * car, with letterbox bars, a title card and an engine-rev sting, then hands
 * control over. Self-contained and deterministic (no randomness); all visual
 * DOM lives in CinematicOverlay, all audio is the WebAudio sting from
 * AudioManager, and camera control is delegated to CameraManager.
 */

import * as THREE from 'three';
import { CONFIG, clamp, damp } from '../core/Config';
import { CinematicOverlay } from '../ui/CinematicOverlay';
import { CameraManager } from '../camera/CameraManager';
import { AudioManager } from '../audio/AudioManager';

type Phase = 'fadeIn' | 'swoop' | 'hold' | 'handoff';

const TITLE_MAIN = 'SAN FRANCISCO';
const TITLE_SUB = 'FREE DRIVE';

// Local feel timings (seconds), kept next to the config-derived phase lengths.
const REVEAL_TIME = 0.6; // come back from black at the top of the swoop
const LETTERBOX_TIME = 0.6;
const TITLE_IN_TIME = 0.5;
const TITLE_OUT_TIME = 0.4;

export class DriveIntro {
  private overlay: CinematicOverlay;
  private cameraMgr: CameraManager;
  private audio: AudioManager;

  // Timeline phase lengths (seconds), derived from CONFIG.cinematics.
  private durFadeIn: number;
  private durSwoop: number;
  private durHold: number;
  private durHandoff: number;

  // Car reference frame.
  private carPos = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private up = new THREE.Vector3();

  // Key poses.
  private startPos = new THREE.Vector3();
  private startLook = new THREE.Vector3();
  private endPos = new THREE.Vector3();
  private endLook = new THREE.Vector3();

  // Swoop splines (separate curves for position and look target).
  private posCurve!: THREE.CatmullRomCurve3;
  private lookCurve!: THREE.CatmullRomCurve3;
  private posePos = new THREE.Vector3();
  private poseLook = new THREE.Vector3();

  // Timeline state.
  private active = false;
  private phase: Phase = 'fadeIn';
  private phaseTime = 0;
  private titleShown = false;
  private completeFired = false;
  private onComplete: (() => void) | null = null;

  // Hold-phase sway amplitude (damped toward 1).
  private swayAmp = 0;

  // Skip-on-any-input listeners.
  private onKeyDown: (() => void) | null = null;
  private onPointerDown: (() => void) | null = null;

  constructor(opts: { overlay: CinematicOverlay; cameraMgr: CameraManager; audio: AudioManager }) {
    this.overlay = opts.overlay;
    this.cameraMgr = opts.cameraMgr;
    this.audio = opts.audio;

    const c = CONFIG.cinematics;
    this.durFadeIn = c.fadeToBlack;
    this.durSwoop = Math.max(c.swoopDuration, 1e-4);
    // Phase C is the remainder of the total intro window.
    this.durHold = Math.max(0, c.introDuration - c.fadeToBlack - c.swoopDuration - c.handoffDuration);
    this.durHandoff = c.handoffDuration;
  }

  get isActive(): boolean {
    return this.active;
  }

  start(carPos: THREE.Vector3, carQuat: THREE.Quaternion, onComplete: () => void): void {
    if (this.active) return;
    this.active = true;
    this.onComplete = onComplete;
    this.phase = 'fadeIn';
    this.phaseTime = 0;
    this.titleShown = false;
    this.completeFired = false;
    this.swayAmp = 0;

    // Reference frame (mirrors CameraManager.chase).
    this.forward.set(0, 0, 1).applyQuaternion(carQuat);
    this.up.set(0, 1, 0).applyQuaternion(carQuat);
    this.carPos.copy(carPos);

    // Chase slot we are flying into.
    this.endPos
      .copy(carPos)
      .addScaledVector(this.forward, -CONFIG.camera.chaseDistance)
      .addScaledVector(this.up, CONFIG.camera.chaseHeight);
    this.endLook
      .copy(carPos)
      .addScaledVector(this.forward, CONFIG.camera.chaseLookAhead)
      .addScaledVector(this.up, 0.8);

    // High wide establishing shot.
    this.startPos.copy(carPos).add(new THREE.Vector3(0, 150, 80));
    this.startLook.copy(carPos);

    this.buildSplines();

    // Phase A: fade to black, hiding the upcoming camera hand-off. The reveal
    // happens at the top of the swoop (phase B).
    this.overlay.fadeTo(1, this.durFadeIn);

    this.bindSkipListeners();
  }

  /** Advance the timeline; call every frame while isActive. */
  update(dt: number): void {
    if (!this.active) return;
    this.phaseTime += dt;

    switch (this.phase) {
      case 'fadeIn':
        if (this.phaseTime >= this.durFadeIn) this.enterSwoop();
        break;
      case 'swoop': {
        this.setSplinePose(this.phaseTime / this.durSwoop);
        if (!this.titleShown && this.phaseTime >= this.durSwoop * 0.5) {
          this.overlay.setTitle(TITLE_MAIN, TITLE_SUB);
          this.overlay.setTitleVisible(true, TITLE_IN_TIME);
          this.titleShown = true;
        }
        if (this.phaseTime >= this.durSwoop) this.enterHold();
        break;
      }
      case 'hold': {
        this.swayAmp = damp(this.swayAmp, 1, 3, dt);
        this.setSwayPose();
        if (this.phaseTime >= this.durHold) this.enterHandoff();
        break;
      }
      case 'handoff':
        if (this.phaseTime >= this.durHandoff) this.finish();
        break;
    }
  }

  /** Jump straight to the handoff phase. Safe to call any time while active. */
  skip(): void {
    if (!this.active) return;
    if (this.phase !== 'handoff') this.enterHandoff();
  }

  // ---------- Phase transitions ----------

  private enterSwoop(): void {
    this.phase = 'swoop';
    this.phaseTime = 0;

    // Take the camera and snap to the high establishing shot.
    this.cameraMgr.beginCinematic();
    this.cameraMgr.setCinematicPose(this.startPos, this.startLook);

    // Phase B: letterbox opens, reveal from black, engine-rev sting.
    this.overlay.setLetterbox(true, LETTERBOX_TIME);
    this.overlay.fadeTo(0, REVEAL_TIME);
    this.audio.playIntroSting();
  }

  private enterHold(): void {
    this.phase = 'hold';
    this.phaseTime = 0;
  }

  private enterHandoff(): void {
    this.phase = 'handoff';
    this.phaseTime = 0;

    // Phase D: close out — title out, letterbox out, fade toward gameplay.
    this.overlay.setTitleVisible(false, TITLE_OUT_TIME);
    this.overlay.setLetterbox(false, LETTERBOX_TIME);
    this.overlay.fadeTo(0, this.durHandoff);
  }

  private finish(): void {
    this.cameraMgr.endCinematic();
    this.unbindSkipListeners();
    this.active = false;
    if (!this.completeFired && this.onComplete) {
      this.completeFired = true;
      const cb = this.onComplete;
      this.onComplete = null;
      cb();
    }
  }

  // ---------- Geometry ----------

  private buildSplines(): void {
    const posPoints = [
      this.startPos.clone(),
      this.carPos.clone().add(new THREE.Vector3(0, 110, 58)),
      this.carPos.clone().add(new THREE.Vector3(0, 80, 40)),
      this.carPos.clone().add(new THREE.Vector3(0, 30, 12)),
      this.endPos.clone(),
    ];
    this.posCurve = new THREE.CatmullRomCurve3(posPoints);

    const lookPoints = [
      this.startLook.clone(),
      this.carPos.clone().add(new THREE.Vector3(0, 70, 34)),
      this.carPos.clone().add(new THREE.Vector3(0, 38, 16)),
      this.carPos.clone().add(new THREE.Vector3(0, 10, 5)),
      this.endLook.clone(),
    ];
    this.lookCurve = new THREE.CatmullRomCurve3(lookPoints);
  }

  /** Camera pose along the swoop; eased for a slow start and soft landing. */
  private setSplinePose(t: number): void {
    const u = this.easeSmooth(clamp(t, 0, 1));
    this.posCurve.getPoint(u, this.posePos);
    this.lookCurve.getPoint(u, this.poseLook);
    this.cameraMgr.setCinematicPose(this.posePos, this.poseLook);
  }

  /** Gentle deterministic sway around the landing pose while the title holds. */
  private setSwayPose(): void {
    this.posePos.copy(this.endPos);
    this.posePos.x += Math.sin(this.phaseTime * 0.9) * 0.5 * this.swayAmp;
    this.posePos.y += Math.cos(this.phaseTime * 0.65) * 0.25 * this.swayAmp;
    this.posePos.z += Math.sin(this.phaseTime * 0.55 + 1.3) * 0.3 * this.swayAmp;

    this.poseLook.copy(this.endLook);
    this.poseLook.y += Math.sin(this.phaseTime * 0.7) * 0.12 * this.swayAmp;

    this.cameraMgr.setCinematicPose(this.posePos, this.poseLook);
  }

  private easeSmooth(t: number): number {
    return t * t * (3 - 2 * t);
  }

  // ---------- Skip-on-any-input ----------

  private bindSkipListeners(): void {
    if (!CONFIG.cinematics.skipOnAnyInput) return;
    const onKey = (): void => this.skip();
    const onPointer = (): void => this.skip();
    this.onKeyDown = onKey;
    this.onPointerDown = onPointer;
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
  }

  private unbindSkipListeners(): void {
    if (this.onKeyDown) window.removeEventListener('keydown', this.onKeyDown);
    if (this.onPointerDown) window.removeEventListener('pointerdown', this.onPointerDown);
    this.onKeyDown = null;
    this.onPointerDown = null;
  }
}
