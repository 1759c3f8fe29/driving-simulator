# PART_1B.md
## Vehicle Physics, Driving Systems, Engine Simulation & Damage Architecture

---

# OBJECTIVE

This section defines the complete vehicle simulation.

The driving experience should feel similar to professional driving simulators rather than arcade racing games.

Driving must feel:

- Heavy
- Responsive
- Predictable
- Stable
- Physically believable

Every system must interact with every other system.

---

# RAPier PHYSICS INITIALIZATION

Initialize Rapier before loading the vehicle.

Configure:

- Gravity = (0, -9.81, 0)
- Continuous Collision Detection (CCD)
- Sleeping enabled
- Broad-phase collision detection
- Narrow-phase collision detection
- Stable timestep
- Collision events
- Contact events

Use fixed physics updates.

Physics must never depend on rendering FPS.

---

# VEHICLE ARCHITECTURE

VehicleController

Responsibilities:

- Read player input
- Calculate steering
- Calculate throttle
- Calculate braking
- Calculate engine torque
- Gear shifting
- Fuel consumption
- Damage effects
- Wheel forces
- Camera hooks
- Audio hooks
- Dashboard updates

VehicleController should never directly manipulate rendering.

---

# VEHICLE COMPONENTS

The vehicle consists of independent systems:

VehicleController

↓

Engine

↓

Transmission

↓

Differential

↓

Suspension

↓

Wheel

↓

Brake

↓

Fuel

↓

Damage

↓

Dashboard

↓

Audio

Each component updates independently.

---

# RIGID BODY

Create one dynamic Rapier rigid body.

Properties:

- Dynamic
- Continuous Collision Detection
- Auto sleep
- Linear damping
- Angular damping
- Configurable center of mass

Mass:

1200–1800 kg

Center of gravity slightly below cabin.

---

# COLLISION SHAPES

Use compound colliders.

Approximate:

Front

Cabin

Rear

Roof

Avoid using one large box collider.

Compound colliders improve stability.

---

# VEHICLE SPAWN

Spawn on a valid road surface.

Verify:

- No overlap
- Stable ground
- Correct rotation

Reset veloCITY after spawning.

---

# ENGINE SIMULATION

The engine must simulate:

Idle RPM

↓

Throttle

↓

Torque

↓

Power

↓

Transmission

↓

Wheel torque

Never directly set vehicle speed.

Speed comes only from applied forces.

---

# ENGINE PARAMETERS

Configurable:

Idle RPM

Maximum RPM

Redline

Torque Curve

Horsepower

Engine Inertia

Throttle Response

Engine Braking

Rev Limiter

Stall Logic

---

# RPM CALCULATION

RPM depends on:

Wheel speed

Gear ratio

Final drive

Throttle

Clutch

Not time.

RPM must increase naturally.

---

# TORQUE CURVE

Implement a realistic torque curve.

Low RPM:

Low torque

Mid RPM:

Maximum torque

High RPM:

Torque decreases.

Acceleration should feel natural.

---

# THROTTLE

Throttle input:

0.0

↓

1.0

Smooth interpolation.

No instant full power.

Support keyboard and analog touch controls.

---

# ENGINE BRAKING

When throttle is released:

Vehicle slows naturally.

Higher RPM

↓

More engine braking

Lower RPM

↓

Less braking

---

# REV LIMITER

When redline reached:

Cut ignition

Oscillate RPM slightly

Prevent over-revving

---

# TRANSMISSION

Support:

Automatic

Manual

Neutral

Reverse

---

# AUTOMATIC MODE

Automatically:

Upshift

Downshift

Prevent over-rev

Prevent stall

Smooth transitions

---

# MANUAL MODE

Player controls:

Gear Up

Gear Down

Neutral

Reverse

Optional clutch support.

---

# GEAR RATIOS

Define realistic gear ratios.

Reverse

Gear 1

Gear 2

Gear 3

Gear 4

Gear 5

Gear 6

Final Drive

Changing ratios changes:

Acceleration

Top speed

RPM

---

# CLUTCH

Manual mode:

Clutch engagement

Slip simulation

Incorrect clutch use may stall the engine (optional realism).

---

# DIFFERENTIAL

Apply torque evenly to driven wheels.

Support future AWD/FWD/RWD expansion.

---

# STEERING SYSTEM

Steering must include:

Maximum steering angle

Speed-sensitive steering

Steering smoothing

Steering return

Counter-steering assistance

---

# HIGH SPEED STEERING

At high speed:

Reduce steering angle.

Vehicle becomes more stable.

---

# LOW SPEED STEERING

At parking speed:

Maximum steering angle.

Easy maneuverability.

---

# SUSPENSION

Every wheel has:

Spring

Damper

Travel distance

Compression

Rebound

Wheel load

---

# SUSPENSION EFFECTS

Vehicle should:

Lean

Pitch

Bounce

Absorb bumps

Transfer weight during braking and acceleration.

---

# WHEEL SYSTEM

Each wheel stores:

Radius

Width

Grip

Slip

Load

Rotation

Steering angle

Angular veloCITY

---

# WHEEL ROTATION

Wheel mesh rotates from:

Travel distance

Not animation.

Steering wheels rotate independently.

---

# TIRE MODEL

Calculate:

Longitudinal grip

Lateral grip

Slip ratio

Slip angle

Rolling resistance

Surface friction

---

# DRIFT SYSTEM

Drifting occurs naturally.

Requirements:

Rear tire slip

Weight transfer

Throttle control

Counter steering

No arcade drift button.

---

# SKID MARKS

Generate dynamically.

Fade gradually.

Do not create infinite geometry.

Reuse pooled meshes.

---

# TIRE SMOKE

Spawn when:

Wheel slip exceeds threshold.

Density depends on:

Speed

Throttle

Surface grip

---

# BRAKING SYSTEM

Support:

Normal brake

Handbrake

ABS hooks

Brake force depends on pedal input.

---

# HANDBRAKE

Locks rear wheels.

Allows controlled drifting.

Smooth release.

---

# ABS (Future Ready)

Prevent wheel lock.

Maintain steering during braking.

Hooks only if disabled initially.

---

# TRACTION CONTROL

Optional.

Reduce engine torque when excessive wheel slip detected.

---

# FUEL SYSTEM

Fuel stored in liters.

Vehicle consumes fuel during:

Idle

Driving

Acceleration

High RPM

Fuel use increases with engine load.

---

# LOW FUEL

Below threshold:

Dashboard warning.

Engine sputter effect.

---

# EMPTY TANK

Fuel = 0

Vehicle cannot accelerate.

Engine stops.

---

# REFUEL

Garage provides:

Instant refuel

Future expansion supports fuel stations.

---

# DAMAGE SYSTEM

Every collision produces:

Damage value

Impact direction

Impact speed

Affected subsystem

---

# DAMAGE TYPES

Body damage

Engine damage

Suspension damage

Wheel damage

Steering damage

Visual damage

---

# ENGINE DAMAGE

Heavy crashes reduce:

Horsepower

Acceleration

Maximum RPM

Throttle response

---

# SUSPENSION DAMAGE

Vehicle begins pulling left/right.

Reduced stability.

---

# WHEEL DAMAGE

Lower grip.

Longer braking distance.

Reduced steering precision.

---

# BODY DAMAGE

Visual scratches.

Dents (if supported).

Broken glass placeholders.

Smoke effects.

---

# DESTRUCTION

Health reaches zero:

Engine fails.

Vehicle cannot move.

Repair required.

---

# COLLISION DETECTION

Detect:

Walls

Buildings

Static meshes

Road barriers

Objects

Ground impacts

Roof impacts

---

# IMPACT CALCULATION

Damage depends on:

Mass

Relative veloCITY

Impact angle

Collision impulse

Not merely contact.

---

# REPAIR SYSTEM

Garage repairs:

Engine

Body

Fuel

Suspension

Wheels

Damage meter resets.

---

# VEHICLE RESET

Reset command:

Places vehicle upright.

Keeps fuel and damage values.

Respawns at nearest safe location if flipped beyond a timeout.

---

# END OF PART 1B

PART 1C will complete:

- Interactive dashboard
- Working cockpit
- Doors, hood, trunk animations
- Engine sound simulation
- UI and HUD
- Input system
- Save/Load
- LocalStorage
- Performance optimization
- Production coding standards
- Final implementation constraints