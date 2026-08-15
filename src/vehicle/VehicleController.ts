/**
 * VehicleController — Orchestrates engine, transmission, fuel, damage,
 * physics and input. Never touches rendering directly.
 */

import * as THREE from 'three';
import { CONFIG, clamp } from '../core/Config';
import { EventBus, Events } from '../core/EventBus';
import { InputManager } from '../input/InputManager';
import { Engine } from './Engine';
import { Transmission } from './Transmission';
import { FuelSystem } from './FuelSystem';
import { DamageSystem } from './DamageSystem';
import { VehiclePhysics, VehiclePhysicsState } from './VehiclePhysics';
import { SaveManager } from '../save/SaveManager';

export interface VehicleTelemetry {
  speedKmh: number;
  speedMs: number;
  rpm: number;
  gear: string;
  gearIndex: number;
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
  fuelPercent: number;
  fuelLiters: number;
  fuelRangeKm: number;
  damage: { body: number; engine: number; suspension: number; wheels: number };
  health: number;
  engineRunning: boolean;
  revLimiter: boolean;
  slip: number;
  drifting: boolean;
  /** Wheels touching geometry this step, 0..4. Zero means airborne (or a hole). */
  groundedWheels: number;
  headlights: boolean;
  highBeam: boolean;
  indicatorLeft: boolean;
  indicatorRight: boolean;
  hazards: boolean;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  wheels: import('./VehiclePhysics').WheelState[];
  /**
   * Cumulative distance (km) and moving time (s) accumulated in `fixedUpdate`.
   *
   * These are integrated against the fixed timestep, so they measure *simulated*
   * travel. Anything showing the player a distance or a timer must derive it
   * from these rather than integrating speed against a render delta: with
   * `maxSubSteps` capping one frame at 33 ms of simulation, wall-clock
   * integration over-reports badly the moment the renderer falls behind.
   */
  odometerKm: number;
  driveTimeSec: number;
}

export class VehicleController {
  private cfg = CONFIG.vehicle;
  private bus = EventBus.get();
  private input = InputManager.get();
  private save = SaveManager.get();

  physics!: VehiclePhysics;
  engine = new Engine();
  transmission = new Transmission();
  fuel: FuelSystem;
  damage: DamageSystem;

  headlights = false;
  highBeam = false;
  indicatorLeft = false;
  indicatorRight = false;
  hazards = false;

  private odometerKm: number;
  private driveTime: number;
  private flipTimer = 0;
  private spawnPoint = { ...CONFIG.vehicle.spawnPosition };
  private spawnRotY = 0;
  private telemetry: VehicleTelemetry | null = null;

  private constructor() {
    const saved = this.save.vehicle;
    this.fuel = new FuelSystem(saved.fuel);
    this.damage = new DamageSystem({
      body: saved.bodyDamage,
      engine: saved.engineDamage,
      suspension: saved.suspensionDamage,
    });
    this.odometerKm = saved.odometerKm;
    this.driveTime = saved.totalDriveTime;
    this.spawnPoint = { ...saved.position };
    this.spawnRotY = saved.rotationY;
    this.transmission.setMode(this.save.settings.gameplay.transmission);
    this.fuel.enabled = this.save.settings.gameplay.fuelConsumption;
    this.damage.enabled = this.save.settings.gameplay.damageEnabled;
    this.bindInput();
  }

  static async create(): Promise<VehicleController> {
    const vc = new VehicleController();
    vc.physics = await VehiclePhysics.create(vc.spawnPoint, vc.spawnRotY);
    vc.engine.start();
    vc.bus.emit(Events.VEHICLE_SPAWNED);
    vc.bus.emit(Events.ENGINE_STARTED);
    return vc;
  }

  private bindInput(): void {
    this.bus.on('input:gearUp:down', () => {
      if (this.transmission.mode === 'manual') this.transmission.shiftUp();
    });
    this.bus.on('input:gearDown:down', () => {
      if (this.transmission.mode === 'manual') this.transmission.shiftDown();
    });
    this.bus.on('input:headlights:down', () => this.toggleHeadlights());
    this.bus.on('input:engineToggle:down', () => this.toggleEngine());
    this.bus.on('input:resetVehicle:down', () => this.resetVehicle());
    this.bus.on('input:indicatorLeft:down', () => {
      this.indicatorLeft = !this.indicatorLeft;
      if (this.indicatorLeft) this.indicatorRight = false;
    });
    this.bus.on('input:indicatorRight:down', () => {
      this.indicatorRight = !this.indicatorRight;
      if (this.indicatorRight) this.indicatorLeft = false;
    });
    this.bus.on('input:hazards:down', () => {
      this.hazards = !this.hazards;
    });
    this.bus.on(Events.COLLISION, (e: unknown) => {
      const ev = e as { impulse: number };
      this.damage.applyImpact(ev.impulse);
    });
  }

  toggleEngine(): void {
    if (this.engine.running) {
      this.engine.stop();
      this.bus.emit(Events.ENGINE_STOPPED);
      this.bus.emit(Events.NOTIFY, { type: 'info', message: 'Engine stopped', icon: 'engine' });
    } else if (!this.fuel.isEmpty) {
      this.engine.start();
      this.bus.emit(Events.ENGINE_STARTED);
      this.bus.emit(Events.NOTIFY, { type: 'info', message: 'Engine started', icon: 'engine' });
    }
  }

  toggleHeadlights(): void {
    if (!this.headlights) {
      this.headlights = true;
      this.highBeam = false;
    } else if (!this.highBeam) {
      this.highBeam = true;
    } else {
      this.headlights = false;
      this.highBeam = false;
    }
    this.bus.emit(Events.LIGHTS_TOGGLED, { on: this.headlights, highBeam: this.highBeam });
    this.bus.emit(Events.NOTIFY, {
      type: 'info',
      message: this.headlights ? (this.highBeam ? 'High beam' : 'Headlights on') : 'Lights off',
      icon: 'lights',
    });
  }

  resetVehicle(): void {
    const state = this.physics.getState();
    // Reset in place, upright, keeping heading
    const euler = new THREE.Euler().setFromQuaternion(state.quaternion, 'YXZ');
    this.physics.resetTo(
      { x: state.position.x, y: state.position.y + 1.2, z: state.position.z },
      euler.y
    );
    this.bus.emit(Events.VEHICLE_RESET);
    this.bus.emit(Events.NOTIFY, { type: 'info', message: 'Vehicle reset', icon: 'reset' });
  }

  respawnAtStart(): void {
    this.physics.resetTo(this.spawnPoint, this.spawnRotY);
    this.bus.emit(Events.VEHICLE_RESET);
  }

  /** Fixed-step physics update. */
  fixedUpdate(dt: number): void {
    const input = this.input.getState();
    const state = this.physics.getState();

    // Reverse handling: brake input while stopped -> reverse gear (automatic)
    if (this.transmission.mode === 'automatic') {
      if (input.brake > 0.1 && state.forwardSpeed < 0.5 && this.transmission.gear >= 0) {
        if (this.transmission.gear !== -1 && state.forwardSpeed < 0.3) this.transmission.toggleReverse();
      } else if (input.throttle > 0.1 && this.transmission.gear === -1) {
        this.transmission.toggleReverse();
        this.transmission.shiftUp();
      } else if (this.transmission.gear === 0 && (input.throttle > 0.1 || input.brake > 0.1)) {
        this.transmission.shiftUp();
      }
    }

    // Fuel
    const hasFuel = this.fuel.consume(this.engine.rpm, this.engine.throttle, this.engine.running, dt);
    if (!hasFuel && this.engine.running) {
      this.engine.stop();
      this.bus.emit(Events.ENGINE_STOPPED);
    }

    // Engine
    const wheelRadPerSec = this.physics.wheelRadPerSec;
    const drivetrainRPM = this.transmission.wheelToEngineRPM(Math.abs(wheelRadPerSec));
    const engineTorque = this.engine.update(
      this.transmission.gear === -1 ? input.brake : input.throttle,
      drivetrainRPM,
      this.transmission.clutchEngagement,
      dt
    );
    this.engine.setDamage(this.damage.getState().engine);

    // Transmission
    this.transmission.update(dt, this.engine.rpm, state.speedMs, input.throttle);

    // Physics
    const gearRatio = this.transmission.ratio * this.cfg.finalDrive;
    const engineBraking = this.engine.getEngineBrakingTorque();
    const totalTorque = this.transmission.isShifting ? 0 : engineTorque - Math.sign(state.forwardSpeed) * engineBraking * 0.1;
    this.physics.gripMultiplier = this.currentGrip * this.damage.gripPenalty;
    this.physics.update(
      Math.max(0, totalTorque),
      gearRatio,
      this.transmission.clutchEngagement,
      input.steer,
      this.transmission.gear === -1 ? 0 : input.brake,
      input.handbrake,
      dt
    );

    // Odometer & drive time
    const dist = state.speedMs * dt;
    this.odometerKm += dist / 1000;
    if (state.speedMs > 0.5) this.driveTime += dt;

    // Flip detection -> auto reset prompt
    if (this.physics.isFlipped) {
      this.flipTimer += dt;
      if (this.flipTimer > 3) {
        this.resetVehicle();
        this.flipTimer = 0;
      }
    } else {
      this.flipTimer = 0;
    }
  }

  /** Weather grip modifier, set by WeatherManager. */
  currentGrip = 1;

  /** Per-frame telemetry refresh. */
  updateTelemetry(): VehicleTelemetry {
    const state = this.physics.getState();
    const input = this.input.getState();
    const eng = this.engine.getState();
    const dmg = this.damage.getState();
    this.telemetry = {
      speedKmh: state.speedKmh,
      speedMs: state.speedMs,
      rpm: eng.rpm,
      gear: this.transmission.getGearLabel(),
      gearIndex: this.transmission.gear,
      throttle: eng.throttle,
      brake: input.brake,
      steer: input.steer,
      handbrake: input.handbrake,
      fuelPercent: this.fuel.percentage,
      fuelLiters: this.fuel.remainingLiters,
      fuelRangeKm: this.fuel.estimatedRangeKm,
      damage: dmg,
      health: this.damage.health,
      engineRunning: eng.running,
      revLimiter: eng.revLimiterActive,
      slip: state.averageSlip,
      drifting: state.averageSlip > 0.55 && state.speedKmh > 25,
      groundedWheels: state.groundedWheels,
      headlights: this.headlights,
      highBeam: this.highBeam,
      indicatorLeft: this.indicatorLeft,
      indicatorRight: this.indicatorRight,
      hazards: this.hazards,
      position: state.position,
      quaternion: state.quaternion,
      wheels: this.physics.wheels,
      odometerKm: this.odometerKm,
      driveTimeSec: this.driveTime,
    };
    return this.telemetry;
  }

  getTelemetry(): VehicleTelemetry {
    return this.telemetry ?? this.updateTelemetry();
  }

  get odometer(): number {
    return this.odometerKm;
  }

  get totalDriveTime(): number {
    return this.driveTime;
  }

  persist(): void {
    const state = this.physics.getState();
    const euler = new THREE.Euler().setFromQuaternion(state.quaternion, 'YXZ');
    this.save.vehicle.fuel = this.fuel.serialize();
    this.save.vehicle.bodyDamage = this.damage.getState().body;
    this.save.vehicle.engineDamage = this.damage.getState().engine;
    this.save.vehicle.suspensionDamage = this.damage.getState().suspension;
    this.save.vehicle.odometerKm = this.odometerKm;
    this.save.vehicle.totalDriveTime = this.driveTime;
    this.save.vehicle.position = { x: state.position.x, y: state.position.y, z: state.position.z };
    this.save.vehicle.rotationY = euler.y;
    this.save.saveVehicle();
  }

  setTransmissionMode(mode: 'automatic' | 'manual'): void {
    this.transmission.setMode(mode);
  }
}
