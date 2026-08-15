/**
 * InputManager — Centralized action-based input.
 * Keyboard, mouse, touch. Gamepad-ready architecture.
 * Systems subscribe to actions, never raw keys.
 */

import { EventBus, Events } from '../core/EventBus';

export type InputAction =
  | 'accelerate'
  | 'brake'
  | 'steerLeft'
  | 'steerRight'
  | 'handbrake'
  | 'gearUp'
  | 'gearDown'
  | 'engineToggle'
  | 'horn'
  | 'headlights'
  | 'cameraNext'
  | 'photoMode'
  | 'resetVehicle'
  | 'pause'
  | 'indicatorLeft'
  | 'indicatorRight'
  | 'hazards'
  | 'doorToggle';

export interface InputState {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (left negative)
  handbrake: boolean;
}

export interface FreeCameraMove {
  x: number; // strafe -1..1 (left negative)
  y: number; // vertical -1..1 (down negative)
  z: number; // forward/back -1..1 (forward negative, matches driving W)
  fast: boolean;
  slow: boolean;
}

// Free-camera movement keys (photo mode). Overlaps KEY_MAP deliberately —
// the free-cam channel consumes them *before* drive actions so they never
// double-fire, and it stays live even when `enabled` is false.
const FREECAM_KEYS = new Set([
  'KeyW', 'ArrowUp', 'KeyS', 'ArrowDown',
  'KeyA', 'ArrowLeft', 'KeyD', 'ArrowRight',
  'KeyE', 'KeyQ', 'Space',
]);
const FREECAM_FAST_KEYS = new Set(['ShiftLeft', 'ShiftRight']);
const FREECAM_SLOW_KEYS = new Set(['ControlLeft', 'ControlRight']);
// Keys that must still reach the action bus while in free cam (exit photo mode).
const FREECAM_PASSTHROUGH = new Set(['KeyP', 'Escape']);

const KEY_MAP: Record<string, InputAction> = {
  KeyW: 'accelerate',
  ArrowUp: 'accelerate',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'steerLeft',
  ArrowLeft: 'steerLeft',
  KeyD: 'steerRight',
  ArrowRight: 'steerRight',
  Space: 'handbrake',
  KeyE: 'gearUp',
  KeyQ: 'gearDown',
  KeyL: 'headlights',
  KeyH: 'horn',
  KeyC: 'cameraNext',
  KeyP: 'photoMode',
  KeyR: 'resetVehicle',
  Escape: 'pause',
  KeyI: 'engineToggle',
  KeyO: 'doorToggle',
  KeyZ: 'indicatorLeft',
  KeyX: 'indicatorRight',
  KeyV: 'hazards',
};

// Gamepad input — standard gamepad mapping (button indices per the W3C
// Gamepad spec). Analog triggers (LT=6, RT=7) drive the analog touch channels
// via their 0..1 `value`, so they are intentionally NOT listed as hold actions
// here. Hold buttons maintain `pressed` state; everything else is edge-fired.
const GAMEPAD_DEADZONE = 0.15;
const GAMEPAD_STEER_SMOOTH = 0.3;
const GAMEPAD_TRIGGER_SMOOTH = 0.35;
const GAMEPAD_DISCRETE_UP_MS = 80;

const GAMEPAD_BUTTONS: Record<number, { action: InputAction; hold?: boolean }> = {
  0: { action: 'accelerate', hold: true }, // A
  1: { action: 'brake', hold: true }, // B
  2: { action: 'handbrake', hold: true }, // X
  3: { action: 'engineToggle' }, // Y
  4: { action: 'gearDown' }, // LB
  5: { action: 'gearUp' }, // RB
  8: { action: 'hazards' }, // Select / Back
  9: { action: 'pause' }, // Start
  10: { action: 'cameraNext' }, // Left stick click (L3)
  11: { action: 'photoMode' }, // Right stick click (R3)
  12: { action: 'gearUp' }, // D-pad up
  13: { action: 'gearDown' }, // D-pad down
  14: { action: 'indicatorLeft' }, // D-pad left
  15: { action: 'indicatorRight' }, // D-pad right
};

export class InputManager {
  private static instance: InputManager;
  private bus = EventBus.get();
  private pressed = new Set<InputAction>();
  private touchState: InputState = { throttle: 0, brake: 0, steer: 0, handbrake: false };
  private touchActive = { throttle: false, brake: false, handbrake: false };
  private enabled = true;
  private freeCameraEnabled = false;
  private freeCamKeys = new Set<string>();
  private gamepadConnected = false;
  private gamepadId: string | null = null;
  private gamepadPrevButtons: boolean[] = [];
  private gamepadHeld = new Set<InputAction>();
  private gamepadSteer = 0;
  private gamepadThrottle = 0;
  private gamepadBrake = 0;

  private constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearAll);
  }

  static get(): InputManager {
    if (!InputManager.instance) InputManager.instance = new InputManager();
    return InputManager.instance;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clearAll();
  }

  /** Toggle the independent free-camera channel (photo mode). */
  setFreeCameraEnabled(v: boolean): void {
    this.freeCameraEnabled = v;
    if (!v) this.freeCamKeys.clear();
  }

  /** Raw free-camera movement, independent of drive input. Null when idle. */
  getFreeCameraMove(): FreeCameraMove | null {
    if (!this.freeCameraEnabled) return null;
    let x = 0;
    let y = 0;
    let z = 0;
    if (this.freeCamKeys.has('KeyA') || this.freeCamKeys.has('ArrowLeft')) x -= 1;
    if (this.freeCamKeys.has('KeyD') || this.freeCamKeys.has('ArrowRight')) x += 1;
    if (this.freeCamKeys.has('KeyW') || this.freeCamKeys.has('ArrowUp')) z -= 1;
    if (this.freeCamKeys.has('KeyS') || this.freeCamKeys.has('ArrowDown')) z += 1;
    if (this.freeCamKeys.has('KeyE') || this.freeCamKeys.has('Space')) y += 1;
    if (this.freeCamKeys.has('KeyQ')) y -= 1;
    const fast = this.freeCamKeys.has('ShiftLeft') || this.freeCamKeys.has('ShiftRight');
    const slow = this.freeCamKeys.has('ControlLeft') || this.freeCamKeys.has('ControlRight');
    if (x === 0 && y === 0 && z === 0 && !fast && !slow) return null;
    return { x, y, z, fast, slow };
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

    // Free-cam channel first — lives on regardless of `enabled` (photo mode
    // disables drive input). Passthrough keys still reach the action bus so
    // photo mode stays escapable.
    if (this.freeCameraEnabled) {
      if (FREECAM_KEYS.has(e.code) || FREECAM_FAST_KEYS.has(e.code) || FREECAM_SLOW_KEYS.has(e.code)) {
        if (e.code === 'Space') e.preventDefault();
        this.freeCamKeys.add(e.code);
        return;
      }
      if (FREECAM_PASSTHROUGH.has(e.code)) {
        const passthrough = KEY_MAP[e.code];
        if (passthrough) {
          if (e.repeat) return;
          this.pressed.add(passthrough);
          this.bus.emit(`input:${passthrough}:down`);
        }
        return;
      }
    }

    if (!this.enabled) return;
    const action = KEY_MAP[e.code];
    if (!action) return;
    if (action === 'handbrake' || action === 'accelerate' || action === 'brake') e.preventDefault();
    if (e.repeat) return;
    this.pressed.add(action);
    this.bus.emit(`input:${action}:down`);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.freeCameraEnabled) {
      if (FREECAM_KEYS.has(e.code) || FREECAM_FAST_KEYS.has(e.code) || FREECAM_SLOW_KEYS.has(e.code)) {
        this.freeCamKeys.delete(e.code);
        return;
      }
      if (FREECAM_PASSTHROUGH.has(e.code)) {
        const passthrough = KEY_MAP[e.code];
        if (passthrough) {
          this.pressed.delete(passthrough);
          this.bus.emit(`input:${passthrough}:up`);
        }
        return;
      }
    }
    const action = KEY_MAP[e.code];
    if (!action) return;
    this.pressed.delete(action);
    this.bus.emit(`input:${action}:up`);
  };

  private clearAll = (): void => {
    this.pressed.clear();
    this.freeCamKeys.clear();
    this.touchActive.throttle = false;
    this.touchActive.brake = false;
    this.touchActive.handbrake = false;
    this.touchState.throttle = 0;
    this.touchState.brake = 0;
    this.touchState.steer = 0;
    this.touchState.handbrake = false;
  };

  /** Touch UI hooks */
  setTouchThrottle(v: number): void {
    this.touchState.throttle = Math.min(1, Math.max(0, v));
    this.touchActive.throttle = v > 0.01;
  }
  setTouchBrake(v: number): void {
    this.touchState.brake = Math.min(1, Math.max(0, v));
    this.touchActive.brake = v > 0.01;
  }
  setTouchSteer(v: number): void {
    this.touchState.steer = Math.min(1, Math.max(-1, v));
  }
  setTouchHandbrake(active: boolean): void {
    this.touchState.handbrake = active;
    this.touchActive.handbrake = active;
  }
  /** Simulate a discrete action press from touch UI. */
  pressAction(action: InputAction): void {
    if (!this.enabled) return;
    this.bus.emit(`input:${action}:down`);
    setTimeout(() => this.bus.emit(`input:${action}:up`), 80);
  }

  isDown(action: InputAction): boolean {
    return this.pressed.has(action);
  }

  /** Aggregated analog state consumed by the vehicle controller. */
  getState(): InputState {
    const throttle = this.pressed.has('accelerate') ? 1 : this.touchState.throttle;
    const brake = this.pressed.has('brake') ? 1 : this.touchState.brake;
    let steer = 0;
    if (this.pressed.has('steerLeft')) steer -= 1;
    if (this.pressed.has('steerRight')) steer += 1;
    if (steer === 0) steer = this.touchState.steer;
    const handbrake = this.pressed.has('handbrake') || this.touchState.handbrake;
    return { throttle, brake, steer, handbrake };
  }

  /**
   * Poll the active gamepad once per frame while driving. Reads the standard
   * analog channels (left stick X, LT/RT triggers) into the shared touch state
   * and converts discrete buttons into input:<action>:down/up bus events.
   * Hold buttons (accelerate/brake/handbrake) maintain `pressed` state. No-op
   * when input is disabled.
   */
  pollGamepad(): void {
    if (!this.enabled) return;
    const gp = this.getGamepad();
    if (!gp) {
      if (this.gamepadConnected) this.onGamepadDisconnected();
      this.gamepadConnected = false;
      return;
    }
    if (gp.id !== this.gamepadId) {
      this.gamepadId = gp.id;
      this.gamepadPrevButtons = [];
      this.gamepadHeld.clear();
    }
    this.gamepadConnected = true;

    const buttons = gp.buttons;
    const prevLen = this.gamepadPrevButtons.length;
    const len = Math.max(buttons.length, prevLen);
    for (let i = 0; i < len; i++) {
      const btn = buttons[i];
      const pressed = btn ? btn.pressed || btn.value > 0.5 : false;
      const prev = i < prevLen ? this.gamepadPrevButtons[i] : false;
      const entry = GAMEPAD_BUTTONS[i];
      if (entry) {
        if (entry.hold) {
          if (pressed) {
            this.pressed.add(entry.action);
            this.gamepadHeld.add(entry.action);
          } else if (prev) {
            this.pressed.delete(entry.action);
            this.gamepadHeld.delete(entry.action);
            this.bus.emit(`input:${entry.action}:up`);
          }
        } else if (pressed && !prev) {
          this.bus.emit(`input:${entry.action}:down`);
          window.setTimeout(() => this.bus.emit(`input:${entry.action}:up`), GAMEPAD_DISCRETE_UP_MS);
        }
      }
      this.gamepadPrevButtons[i] = pressed;
    }

    // Left stick X -> steer (-1..1), dead-zoned and smoothed into touchState.
    const axes = gp.axes;
    this.gamepadSteer = this.smoothAxis(this.gamepadSteer, this.deadzone(axes[0] ?? 0), GAMEPAD_STEER_SMOOTH);
    this.touchState.steer = Math.min(1, Math.max(-1, this.gamepadSteer));

    // RT (button 7) -> throttle, LT (button 6) -> brake (0..1 each).
    this.gamepadThrottle = this.smoothAxis(
      this.gamepadThrottle,
      this.deadzone(this.triggerValue(buttons, axes, 7, 2)),
      GAMEPAD_TRIGGER_SMOOTH,
    );
    this.touchState.throttle = Math.min(1, Math.max(0, this.gamepadThrottle));
    this.gamepadBrake = this.smoothAxis(
      this.gamepadBrake,
      this.deadzone(this.triggerValue(buttons, axes, 6, 3)),
      GAMEPAD_TRIGGER_SMOOTH,
    );
    this.touchState.brake = Math.min(1, Math.max(0, this.gamepadBrake));
  }

  /** True while a connected gamepad is present and being polled. */
  getGamepadConnected(): boolean {
    return this.gamepadConnected;
  }

  private getGamepad(): Gamepad | null {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const primary = pads[0];
    if (primary && primary.connected) return primary;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (pad && pad.connected) return pad;
    }
    return null;
  }

  private onGamepadDisconnected(): void {
    this.gamepadId = null;
    this.gamepadPrevButtons = [];
    for (const action of this.gamepadHeld) {
      this.pressed.delete(action);
      this.bus.emit(`input:${action}:up`);
    }
    this.gamepadHeld.clear();
    this.gamepadSteer = 0;
    this.gamepadThrottle = 0;
    this.gamepadBrake = 0;
    this.touchState.steer = 0;
    this.touchState.throttle = 0;
    this.touchState.brake = 0;
  }

  private deadzone(v: number): number {
    return Math.abs(v) < GAMEPAD_DEADZONE ? 0 : v;
  }

  private smoothAxis(from: number, to: number, alpha: number): number {
    return from + (to - from) * alpha;
  }

  private triggerValue(buttons: readonly GamepadButton[], axes: readonly number[], buttonIdx: number, axisIdx: number): number {
    const btnVal = buttons[buttonIdx] ? buttons[buttonIdx].value : 0;
    const axisVal = axisIdx < axes.length && axes[axisIdx] > 0 ? axes[axisIdx] : 0;
    return Math.max(btnVal, axisVal);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clearAll);
  }
}

export { Events };
