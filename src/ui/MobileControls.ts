/**
 * MobileControls — Full on-screen control deck (touch + desktop via pointer events).
 * Cockpit-style arcade layout: steering wheel bottom-left, pedals bottom-right,
 * labeled zone bar top-center. Everything routes through InputManager.
 * The deck is semi-transparent and pointer-events are auto only on interactive children,
 * so the canvas drag never gets blocked in the gaps.
 */

import { InputManager } from '../input/InputManager';
import { AudioManager } from '../audio/AudioManager';
import { SaveManager } from '../save/SaveManager';
import { clamp, damp, isMobile } from '../core/Config';

/** Horizontal drag distance (px) for a full steering lock. */
const STEER_SENSITIVITY_PX = 90;
/** Wheel rotation degrees at full lock. */
const MAX_STEER_DEG = 90;
/** Wheel visual return smoothing (1/s). */
const WHEEL_DAMP = 18;
/** Milliseconds without interaction before the deck fades to a faint idle state. */
const IDLE_HIDE_MS = 3500;

export class MobileControls {
  private el: HTMLElement;
  private input = InputManager.get();
  private audio = AudioManager.get();
  private visible = false;

  // Steering state
  private steerPointer: number | null = null;
  private steerOriginX = 0;
  private steerTarget = 0; // -1..1
  private steerVisual = 0; // smoothed wheel angle in degrees
  private wheelEl!: HTMLElement;

  // Auto-hide idle state
  private idleMs = 0;

  /** Integrator hooks. */
  onPause: (() => void) | null = null;
  onCamera: (() => void) | null = null;
  onRadio: (() => void) | null = null;
  onMap: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'mobile-controls';
    this.el.setAttribute('aria-label', 'Driving controls');
    this.el.innerHTML = `
      <div class="mc-steer">
        <div class="mc-wheel" id="mc-wheel">
          <div class="mc-wheel-ring"></div>
          <div class="mc-wheel-rim"></div>
          <div class="mc-wheel-spoke mc-wheel-spoke-left"></div>
          <div class="mc-wheel-spoke mc-wheel-spoke-right"></div>
          <div class="mc-wheel-spoke mc-wheel-spoke-down"></div>
          <div class="mc-wheel-cap"><div class="mc-wheel-hub"></div></div>
        </div>
        <div class="mc-steer-grip">STEER</div>
      </div>
      <div class="mc-pedals">
        <button class="mc-pedal brake" id="mc-brake" aria-label="Brake" title="Brake (hold)">
          <span class="mc-pedal-face">◉</span>
          <span class="mc-pedal-label">BRAKE</span>
        </button>
        <button class="mc-pedal gas" id="mc-gas" aria-label="Accelerate" title="Accelerate (hold)">
          <span class="mc-pedal-face">▲</span>
          <span class="mc-pedal-label">GAS</span>
        </button>
      </div>
      <div class="mc-top">
        <div class="mc-zone mc-zone-drive">
          <div class="mc-zone-label">DRIVE</div>
          <div class="mc-zone-row">
            <button class="mc-btn" id="mc-handbrake" aria-label="Handbrake" title="Handbrake (hold)"><span class="mc-btn-icon">⛔</span><span class="mc-btn-label">BRAKE</span></button>
            <button class="mc-btn" id="mc-gearup" aria-label="Gear Up" title="Gear Up"><span class="mc-btn-icon">▲</span><span class="mc-btn-label">UP</span></button>
            <button class="mc-btn" id="mc-geardown" aria-label="Gear Down" title="Gear Down"><span class="mc-btn-icon">▼</span><span class="mc-btn-label">DOWN</span></button>
            <button class="mc-btn" id="mc-horn" aria-label="Horn" title="Horn"><span class="mc-btn-icon">⌾</span><span class="mc-btn-label">HORN</span></button>
            <button class="mc-btn" id="mc-reset" aria-label="Reset Vehicle" title="Reset Vehicle"><span class="mc-btn-icon">⟲</span><span class="mc-btn-label">RESET</span></button>
          </div>
        </div>
        <div class="mc-zone mc-zone-lights">
          <div class="mc-zone-label">LIGHTS</div>
          <div class="mc-zone-row">
            <button class="mc-btn" id="mc-headlights" aria-label="Headlights" title="Headlights"><span class="mc-btn-icon">◉</span><span class="mc-btn-label">LIGHTS</span></button>
            <button class="mc-btn" id="mc-indleft" aria-label="Left Indicator" title="Left Indicator"><span class="mc-btn-icon">◀</span><span class="mc-btn-label">LEFT</span></button>
            <button class="mc-btn" id="mc-indright" aria-label="Right Indicator" title="Right Indicator"><span class="mc-btn-icon">▶</span><span class="mc-btn-label">RIGHT</span></button>
            <button class="mc-btn" id="mc-hazards" aria-label="Hazards" title="Hazards"><span class="mc-btn-icon">⚠</span><span class="mc-btn-label">HAZ</span></button>
          </div>
        </div>
        <div class="mc-zone mc-zone-system">
          <div class="mc-zone-label">SYSTEM</div>
          <div class="mc-zone-row">
            <button class="mc-btn" id="mc-engine" aria-label="Engine Toggle" title="Engine Start / Stop"><span class="mc-btn-icon">⏻</span><span class="mc-btn-label">ENGINE</span></button>
            <button class="mc-btn" id="mc-camera" aria-label="Change Camera" title="Change Camera"><span class="mc-btn-icon">◐</span><span class="mc-btn-label">CAM</span></button>
            <button class="mc-btn" id="mc-photo" aria-label="Photo Mode" title="Photo Mode"><span class="mc-btn-icon">✦</span><span class="mc-btn-label">PHOTO</span></button>
            <button class="mc-btn" id="mc-pause" aria-label="Pause" title="Pause"><span class="mc-btn-icon">‖</span><span class="mc-btn-label">PAUSE</span></button>
            <button class="mc-btn" id="mc-radio" aria-label="Radio" title="Radio"><span class="mc-btn-icon">♪</span><span class="mc-btn-label">RADIO</span></button>
            <button class="mc-btn" id="mc-map" aria-label="Map" title="Map"><span class="mc-btn-icon">⌖</span><span class="mc-btn-label">MAP</span></button>
          </div>
        </div>
      </div>
    `;
    root.appendChild(this.el);
    this.bind();
  }

  private bind(): void {
    this.wheelEl = this.el.querySelector('#mc-wheel') as HTMLElement;
    const steer = this.el.querySelector('.mc-steer') as HTMLElement;

    steer.addEventListener('pointerdown', (e) => {
      if (this.steerPointer !== null) return;
      this.steerPointer = e.pointerId;
      this.steerOriginX = e.clientX;
      this.steerTarget = 0;
      steer.setPointerCapture(e.pointerId);
    });
    steer.addEventListener('pointermove', (e) => {
      if (this.steerPointer !== e.pointerId) return;
      const dx = e.clientX - this.steerOriginX;
      this.steerTarget = clamp(dx / STEER_SENSITIVITY_PX, -1, 1);
      this.input.setTouchSteer(this.steerTarget);
    });
    const steerEnd = (e: PointerEvent) => {
      if (this.steerPointer !== e.pointerId) return;
      this.steerPointer = null;
      this.steerTarget = 0;
      this.input.setTouchSteer(0);
    };
    steer.addEventListener('pointerup', steerEnd);
    steer.addEventListener('pointercancel', steerEnd);

    // Pedals + handbrake: hold-to-pressure (set analog 1 while held, 0 on release).
    this.bindHold('#mc-gas', (v) => this.input.setTouchThrottle(v));
    this.bindHold('#mc-brake', (v) => this.input.setTouchBrake(v));
    this.bindHold('#mc-handbrake', (v) => this.input.setTouchHandbrake(v > 0));

    // Discrete actions.
    this.bindTap('#mc-gearup', () => this.input.pressAction('gearUp'));
    this.bindTap('#mc-geardown', () => this.input.pressAction('gearDown'));
    this.bindTap('#mc-horn', () => this.input.pressAction('horn'));
    this.bindTap('#mc-headlights', () => this.input.pressAction('headlights'));
    this.bindTap('#mc-indleft', () => this.input.pressAction('indicatorLeft'));
    this.bindTap('#mc-indright', () => this.input.pressAction('indicatorRight'));
    this.bindTap('#mc-hazards', () => this.input.pressAction('hazards'));
    this.bindTap('#mc-engine', () => this.input.pressAction('engineToggle'));
    this.bindTap('#mc-photo', () => this.input.pressAction('photoMode'));
    this.bindTap('#mc-reset', () => this.input.pressAction('resetVehicle'));
    this.bindTap('#mc-camera', () => {
      if (this.onCamera) this.onCamera();
      else this.input.pressAction('cameraNext');
    });
    this.bindTap('#mc-pause', () => {
      if (this.onPause) this.onPause();
      else this.input.pressAction('pause');
    });
    this.bindTap('#mc-radio', () => this.onRadio?.());
    this.bindTap('#mc-map', () => this.onMap?.());

    // Any interaction wakes the deck from its idle fade.
    this.el.addEventListener('pointerdown', () => this.wake(), { capture: true });
  }

  /** Clear the idle timer and restore full opacity. */
  private wake(): void {
    this.idleMs = 0;
    this.el.classList.remove('idle');
  }

  private bindHold(selector: string, setter: (v: number) => void): void {
    const btn = this.el.querySelector(selector) as HTMLElement;
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      btn.classList.add('held');
      setter(1);
    });
    const release = (e: PointerEvent) => {
      if (btn.hasPointerCapture(e.pointerId)) btn.releasePointerCapture(e.pointerId);
      btn.classList.remove('held');
      setter(0);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
  }

  private bindTap(selector: string, fn: () => void): void {
    const btn = this.el.querySelector(selector) as HTMLElement;
    btn.addEventListener('click', () => {
      this.audio.uiClick();
      fn();
    });
  }

  /** Per-frame smoothing for the steering wheel visual + idle fade. Call every frame with dt (s). */
  update(dt: number): void {
    if (!this.visible) return;
    const target = this.steerTarget * MAX_STEER_DEG;
    this.steerVisual = damp(this.steerVisual, target, WHEEL_DAMP, dt);
    if (Math.abs(this.steerVisual - target) < 0.05) this.steerVisual = target;
    this.wheelEl.style.transform = `rotate(${this.steerVisual.toFixed(2)}deg)`;
    if (this.idleMs < IDLE_HIDE_MS) {
      this.idleMs += dt * 1000;
      if (this.idleMs >= IDLE_HIDE_MS) this.el.classList.add('idle');
    }
  }

  show(): void {
    const save = SaveManager.get();
    const shouldShow = (save.settings.interface as { showControls?: boolean }).showControls ?? isMobile();
    this.visible = shouldShow;
    this.el.classList.toggle('visible', shouldShow);
    if (shouldShow) this.wake();
    else this.resetInputs();
  }

  hide(): void {
    this.visible = false;
    this.el.classList.remove('visible');
    this.el.classList.remove('idle');
    this.resetInputs();
  }

  private resetInputs(): void {
    this.steerPointer = null;
    this.steerTarget = 0;
    this.steerVisual = 0;
    if (this.wheelEl) this.wheelEl.style.transform = 'rotate(0deg)';
    this.input.setTouchSteer(0);
    this.input.setTouchThrottle(0);
    this.input.setTouchBrake(0);
    this.input.setTouchHandbrake(false);
    this.el.querySelectorAll('.held').forEach((b) => b.classList.remove('held'));
  }
}
