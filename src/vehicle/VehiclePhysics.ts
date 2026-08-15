/**
 * VehiclePhysics — Raycast vehicle on a Rapier rigid body.
 * Four wheel rays with spring suspension, pacejka-inspired tire forces,
 * weight transfer, aerodynamic drag and downforce.
 */

import * as THREE from 'three';
import { PhysicsWorld, RAPIER } from '../physics/PhysicsWorld';
import { CONFIG, clamp, lerp } from '../core/Config';
import type { Upgrades } from '../garage/GarageManager';

export interface WheelState {
  index: number;
  localPosition: THREE.Vector3; // attachment point (chassis local)
  isFront: boolean;
  isDriven: boolean;
  steerAngle: number;
  angularVelocity: number; // rad/s
  suspensionLength: number;
  compression: number; // 0..1
  inContact: boolean;
  contactPoint: THREE.Vector3;
  slip: number; // lateral slip magnitude 0..1+
  worldPosition: THREE.Vector3;
  rotation: number; // visual spin
}

export interface VehiclePhysicsState {
  speedMs: number;
  speedKmh: number;
  forwardSpeed: number;
  wheelRPM: number;
  groundedWheels: number;
  averageSlip: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
}

const WHEEL_DEFS = [
  { local: new THREE.Vector3(-0.82, 0, 1.32), isFront: true, isDriven: false },
  { local: new THREE.Vector3(0.82, 0, 1.32), isFront: true, isDriven: false },
  { local: new THREE.Vector3(-0.82, 0, -1.32), isFront: false, isDriven: true },
  { local: new THREE.Vector3(0.82, 0, -1.32), isFront: false, isDriven: true },
];

// Performance upgrade scaling per level, applied on top of the CONFIG.vehicle
// baseline (level 0 = stock). Kept local to the physics layer so the simulation
// owns how levels translate into forces.
const ENGINE_TORQUE_PER_LEVEL = 0.12; // +12% driven-wheel torque per level
const BRAKE_TORQUE_PER_LEVEL = 0.15; // +15% brake/handbrake torque per level
const TIRE_GRIP_PER_LEVEL = 0.08; // +8% tire grip per level

export class VehiclePhysics {
  private cfg = CONFIG.vehicle;
  private physics: PhysicsWorld;
  body!: RAPIER.RigidBody;
  wheels: WheelState[] = [];
  gripMultiplier = 1; // weather modifier
  private upgrades: Upgrades | null = null;
  private enginePowerMult = 1;
  private brakePowerMult = 1;
  private tireGripMult = 1;
  private tempVec = new THREE.Vector3();
  private tempQuat = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  private constructor(physics: PhysicsWorld) {
    this.physics = physics;
  }

  static async create(spawn: { x: number; y: number; z: number }, rotationY = 0): Promise<VehiclePhysics> {
    const physics = await PhysicsWorld.get();
    const vp = new VehiclePhysics(physics);
    vp.buildBody(spawn, rotationY);
    return vp;
  }

  private buildBody(spawn: { x: number; y: number; z: number }, rotationY: number): void {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) })
      .setLinearDamping(0.05)
      .setAngularDamping(1.2)
      .setCcdEnabled(true)
      .setCanSleep(false);

    this.body = this.physics.createRigidBody(bodyDesc);

    // Additional mass at a lowered center of mass (Rapier 0.14: setAdditionalMassProperties
    // supersedes setAdditionalMass + setAdditionalCenterOfMass). Zero principal angular
    // inertia = point-mass semantics, matching the original intent.
    this.body.setAdditionalMassProperties(
      this.cfg.mass,
      { x: 0, y: -0.25, z: 0 }, // lowered center of mass
      { x: 0, y: 0, z: 0 }, // principal angular inertia (point mass)
      { x: 1, y: 0, z: 0, w: 0 }, // identity inertia local frame
      true
    );

    // Compound colliders: front, cabin, rear (per spec — no single big box)
    const colliderDefs: Array<{ pos: [number, number, number]; size: [number, number, number] }> = [
      { pos: [0, 0.35, 1.35], size: [0.85, 0.28, 0.95] }, // front
      { pos: [0, 0.62, -0.1], size: [0.82, 0.42, 0.95] }, // cabin
      { pos: [0, 0.42, -1.45], size: [0.85, 0.32, 0.85] }, // rear
    ];
    for (const def of colliderDefs) {
      const desc = RAPIER.ColliderDesc.cuboid(def.size[0], def.size[1], def.size[2])
        .setTranslation(def.pos[0], def.pos[1], def.pos[2])
        .setFriction(0.6)
        .setRestitution(0.05)
        .setDensity(0); // mass comes from setAdditionalMass
      this.physics.createCollider(desc, this.body);
    }

    this.wheels = WHEEL_DEFS.map((def, i) => ({
      index: i,
      localPosition: def.local.clone(),
      isFront: def.isFront,
      isDriven: def.isDriven,
      steerAngle: 0,
      angularVelocity: 0,
      suspensionLength: this.cfg.suspensionRest,
      compression: 0,
      inContact: false,
      contactPoint: new THREE.Vector3(),
      slip: 0,
      worldPosition: new THREE.Vector3(),
      rotation: 0,
    }));
  }

  /**
   * Set the active performance upgrades. The object is owned by GarageManager
   * and shared by reference, so later mutations are seen on the next update.
   * Levels are clamped to 0..3; null restores the stock CONFIG.vehicle baseline.
   */
  setUpgrades(upgrades: Upgrades | null): void {
    this.upgrades = upgrades;
  }

  /**
   * Fixed-step update.
   * @param engineTorque crankshaft torque Nm
   * @param gearRatio current gear * final drive (signed)
   * @param clutch 0..1
   * @param steerInput -1..1
   * @param brakeInput 0..1
   * @param handbrake active
   * @param dt fixed timestep
   */
  update(
    engineTorque: number,
    gearRatio: number,
    clutch: number,
    steerInput: number,
    brakeInput: number,
    handbrake: boolean,
    dt: number
  ): void {
    // Upgrade multipliers from the shared upgrades object (level 0 = stock).
    const up = this.upgrades;
    this.enginePowerMult = 1 + (up ? clamp(up.engine, 0, 3) : 0) * ENGINE_TORQUE_PER_LEVEL;
    this.brakePowerMult = 1 + (up ? clamp(up.brakes, 0, 3) : 0) * BRAKE_TORQUE_PER_LEVEL;
    this.tireGripMult = 1 + (up ? clamp(up.tires, 0, 3) : 0) * TIRE_GRIP_PER_LEVEL;

    const pos = this.body.translation();
    const rot = this.body.rotation();
    this.tempQuat.set(rot.x, rot.y, rot.z, rot.w);

    // Clear last step's user forces before adding this step's.
    //
    // Rapier accumulates `addForce`/`addForceAtPoint` into a persistent buffer
    // that survives `world.step()` — it is only cleared by `resetForces`. Without
    // this the suspension springs integrate: each step re-adds a full car-weight
    // upward force on top of every previous step's, so the body accelerates into
    // the sky (y climbing without bound, all four wheels off the ground) while
    // forward speed also runs away. Both looked like a working car on the HUD,
    // because speed is |forward velocity| and rpm is derived from wheel speed.
    this.body.resetForces(false);
    this.body.resetTorques(false);

    const linvel = this.body.linvel();
    const velocity = this.tempVec.set(linvel.x, linvel.y, linvel.z).clone();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.tempQuat);
    const forwardSpeed = velocity.dot(forward);

    // Steering with speed-sensitive reduction
    const speedFactor = 1 / (1 + Math.abs(forwardSpeed) * 0.045);
    const targetSteer = steerInput * this.cfg.maxSteerAngle * speedFactor;

    // Aerodynamic drag + downforce
    const dragMag =
      0.5 * this.cfg.airDensity * this.cfg.dragCoefficient * this.cfg.frontalArea * forwardSpeed * Math.abs(forwardSpeed);
    this.body.addForce({ x: -forward.x * dragMag, y: 0, z: -forward.z * dragMag }, true);
    const downforceMag = this.cfg.downforce * forwardSpeed * Math.abs(forwardSpeed);
    this.body.addForce({ x: 0, y: -downforceMag, z: 0 }, true);

    let drivenWheelSpeedSum = 0;
    let drivenCount = 0;

    for (const wheel of this.wheels) {
      wheel.steerAngle = wheel.isFront
        ? wheel.steerAngle + (targetSteer - wheel.steerAngle) * Math.min(1, this.cfg.steerSpeed * dt)
        : 0;

      // Wheel attachment point in world space
      const attachLocal = wheel.localPosition;
      const attachWorld = attachLocal.clone().applyQuaternion(this.tempQuat).add(new THREE.Vector3(pos.x, pos.y, pos.z));

      // Suspension ray
      const rayLen = this.cfg.suspensionRest + this.cfg.suspensionTravel + this.cfg.wheelRadius;
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(this.tempQuat);
      const hit = this.physics.castRay(
        { x: attachWorld.x, y: attachWorld.y, z: attachWorld.z },
        { x: down.x, y: down.y, z: down.z },
        rayLen,
        this.body
      );

      wheel.inContact = hit.hit;
      if (hit.hit) {
        const hitDist = hit.toi;
        wheel.suspensionLength = clamp(hitDist - this.cfg.wheelRadius, 0.05, this.cfg.suspensionRest + this.cfg.suspensionTravel);
        wheel.compression = clamp(
          1 - (wheel.suspensionLength - this.cfg.suspensionRest + this.cfg.suspensionTravel) / (this.cfg.suspensionTravel * 2),
          0, 1
        );
        wheel.contactPoint.set(hit.point.x, hit.point.y, hit.point.z);
        wheel.worldPosition.copy(wheel.contactPoint).addScaledVector(this.up, this.cfg.wheelRadius);

        // Suspension spring force
        const restLen = this.cfg.suspensionRest;
        const compressionDist = restLen + this.cfg.suspensionTravel - wheel.suspensionLength;
        // Point velocity of the contact point: v = v_lin + ω × r.
        // Rapier 0.14 removed linvelAtPoint; compute it manually. Lever arm is measured
        // from the lowered COM (0, -0.25, 0) to stay consistent with the mass properties.
        const lv = this.body.linvel();
        const av = this.body.angvel();
        const rx = wheel.contactPoint.x - pos.x;
        const ry = wheel.contactPoint.y - (pos.y - 0.25);
        const rz = wheel.contactPoint.z - pos.z;
        const pointVel = {
          x: lv.x + (av.y * rz - av.z * ry),
          y: lv.y + (av.z * rx - av.x * rz),
          z: lv.z + (av.x * ry - av.y * rx),
        };
        const suspensionVel = new THREE.Vector3(pointVel.x, pointVel.y, pointVel.z).dot(down);
        // `down` points from the chassis toward the ground, so this dot product is
        // the rate at which the suspension is *compressing*: positive while the
        // wheel is being pushed up into the arch, negative while it extends.
        //
        // The damper force therefore has to be added, not subtracted. Subtracting
        // it inverts the damping: the spring weakened on the way down and
        // stiffened on the way up, feeding energy into every bounce, so the car
        // launched itself off the spawn drop and kept climbing with all four
        // wheels off the ground — which read on the HUD as a car doing 200 km/h.
        const compressionRate = suspensionVel;
        const damperForce =
          compressionRate *
          (compressionRate > 0 ? this.cfg.suspensionCompressionDamping : this.cfg.suspensionDamping);
        const springForce = compressionDist * this.cfg.suspensionStiffness + damperForce;
        const clampedSpring = clamp(springForce, 0, this.cfg.mass * 9.81 * 2.2);
        this.body.addForceAtPoint(
          { x: -down.x * clampedSpring, y: -down.y * clampedSpring, z: -down.z * clampedSpring },
          { x: wheel.contactPoint.x, y: wheel.contactPoint.y, z: wheel.contactPoint.z },
          true
        );

        // Tire forces
        const wheelDir = new THREE.Vector3(0, 0, 1)
          .applyQuaternion(this.tempQuat)
          .applyAxisAngle(this.up, wheel.steerAngle);
        const wheelRight = new THREE.Vector3().crossVectors(wheelDir, this.up).normalize().negate();

        const contactVel = new THREE.Vector3(pointVel.x, pointVel.y, pointVel.z);
        const longSpeed = contactVel.dot(wheelDir);
        const latSpeed = contactVel.dot(wheelRight);

        const load = clampedSpring;
        const grip = this.cfg.tireGripBase * this.gripMultiplier * this.tireGripMult;

        // Longitudinal force: engine + brakes
        let longForce = 0;
        if (wheel.isDriven && Math.abs(gearRatio) > 0.001) {
          const wheelTorque = engineTorque * this.enginePowerMult * Math.abs(gearRatio) * clutch * 0.5; // split between 2 driven wheels
          longForce += (wheelTorque / this.cfg.wheelRadius) * Math.sign(gearRatio);
        }
        // Rolling resistance
        longForce -= longSpeed * this.cfg.rollingResistance;

        // Brakes
        const brakeTorque = (handbrake && !wheel.isFront ? this.cfg.handbrakeTorque : brakeInput * this.cfg.brakeTorque * (wheel.isFront ? 0.6 : 0.4)) * this.brakePowerMult;
        const brakeForce = clamp(-longSpeed * 8, -brakeTorque / this.cfg.wheelRadius, brakeTorque / this.cfg.wheelRadius);
        longForce += brakeForce;

        // Lateral force (cornering) — simplified pacejka
        const slipAngle = Math.atan2(latSpeed, Math.abs(longSpeed) + 0.5);
        let latForce = -slipAngle * load * grip * 0.14;
        const maxLat = load * grip;
        latForce = clamp(latForce, -maxLat, maxLat);

        // Clamp longitudinal by friction circle
        const maxLong = Math.sqrt(Math.max(0, maxLat * maxLat - latForce * latForce));
        longForce = clamp(longForce, -maxLong, maxLong);

        wheel.slip = clamp(Math.abs(slipAngle) * 2 + Math.abs(longForce) / (maxLong + 1) * 0.3, 0, 2);

        const fx = wheelDir.x * longForce + wheelRight.x * latForce;
        const fz = wheelDir.z * longForce + wheelRight.z * latForce;
        this.body.addForceAtPoint(
          { x: fx, y: 0, z: fz },
          { x: wheel.contactPoint.x, y: wheel.contactPoint.y, z: wheel.contactPoint.z },
          true
        );

        // Wheel spin visual + RPM feedback
        wheel.angularVelocity = longSpeed / this.cfg.wheelRadius;
        if (wheel.isDriven) {
          drivenWheelSpeedSum += wheel.angularVelocity;
          drivenCount++;
        }
      } else {
        wheel.compression = 0;
        wheel.suspensionLength = this.cfg.suspensionRest + this.cfg.suspensionTravel;
        wheel.worldPosition.copy(attachWorld).addScaledVector(down, wheel.suspensionLength + this.cfg.wheelRadius);
        wheel.angularVelocity *= 0.99;
        wheel.slip = 0;
      }
      wheel.rotation += wheel.angularVelocity * dt;
    }

    this.lastWheelRadPerSec = drivenCount > 0 ? drivenWheelSpeedSum / drivenCount : 0;
  }

  private lastWheelRadPerSec = 0;

  get wheelRadPerSec(): number {
    return this.lastWheelRadPerSec;
  }

  getState(): VehiclePhysicsState {
    const pos = this.body.translation();
    const rot = this.body.rotation();
    const vel = this.body.linvel();
    const ang = this.body.angvel();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const velocity = new THREE.Vector3(vel.x, vel.y, vel.z);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const forwardSpeed = velocity.dot(forward);
    const speedMs = Math.abs(forwardSpeed);
    let grounded = 0;
    let slipSum = 0;
    for (const w of this.wheels) {
      if (w.inContact) grounded++;
      slipSum += w.slip;
    }
    return {
      speedMs,
      speedKmh: speedMs * 3.6,
      forwardSpeed,
      wheelRPM: (this.lastWheelRadPerSec * 60) / (2 * Math.PI),
      groundedWheels: grounded,
      averageSlip: slipSum / this.wheels.length,
      position: new THREE.Vector3(pos.x, pos.y, pos.z),
      quaternion: quat,
      velocity,
      angularVelocity: new THREE.Vector3(ang.x, ang.y, ang.z),
    };
  }

  resetTo(position: { x: number; y: number; z: number }, rotationY = 0): void {
    this.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(rotationY / 2), z: 0, w: Math.cos(rotationY / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  get isFlipped(): boolean {
    const rot = this.body.rotation();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
    return up.y < 0.25;
  }

  dispose(): void {
    this.physics.removeRigidBody(this.body);
  }
}
