# PART_2B.md
# Premium Garage, Vehicle Customization, Repair & Upgrade System

---

# OBJECTIVE

Design and implement a premium AAA-style Garage System for the browser-based 3D Open World Driving Simulator.

The Garage is the player's primary customization and maintenance hub.

It must feel modern, responsive, visually impressive, and modular.

The Garage should support future expansion while currently using only the provided **CAR.glb** model.

---

# GARAGE ARCHITECTURE

Create independent modules:

GarageManager

GarageScene

GarageUI

CustomizationManager

PaintManager

RepairManager

FuelManager

UpgradeManager

InspectionCamera

SaveManager Integration

Each module communicates through well-defined APIs.

---

# GARAGE ENTRY

The player can enter the garage from:

- Main Menu
- Pause Menu
- Dedicated Garage Button

Entering the garage should:

1. Pause gameplay.
2. Save the current vehicle state.
3. Load the garage scene.
4. Position the CAR on the display platform.
5. Enable garage camera controls.
6. Disable world physics.
7. Load the customization UI.

Exit reverses the process seamlessly.

---

# GARAGE SCENE

Requirements:

- High-quality HDR environment.
- Reflective floor.
- Soft shadows.
- Controlled lighting.
- Neutral background.
- Performance optimized.
- Smooth camera movement.

The CAR should be the visual focus.

---

# GARAGE LIGHTING

Lighting setup includes:

- HDR environment map
- Main directional light
- Rim lights
- Floor bounce light
- Ambient fill light
- Reflection probes

Lighting should clearly show paint, reflections, and body details.

---

# DISPLAY PLATFORM

Vehicle rests on a premium rotating platform.

Features:

- Slow automatic rotation
- Manual rotation
- Rotation pause
- Reset orientation
- Smooth interpolation

---

# INSPECTION CAMERA

Dedicated camera controls:

Orbit

Pan

Zoom

Rotate

Focus on:

- Front
- Rear
- Left
- Right
- Roof
- Interior
- Wheels
- Engine bay (hood open)
- Trunk

Camera movement must remain smooth.

---

# GARAGE USER INTERFACE

Panels:

Vehicle Information

Customization

Repair

Fuel

Upgrades

Settings

Exit Garage

All panels use:

- Glassmorphism
- Rounded corners
- Responsive layout
- Keyboard and touch navigation
- Animated transitions

---

# VEHICLE INFORMATION PANEL

Display:

Vehicle Name

Current Speed (0 in garage)

Current Gear

Fuel Level

Vehicle Health

Engine Health

Suspension Health

Mileage

Total Driving Time

Last Save Time

---

# CUSTOMIZATION MANAGER

Responsible for:

Body paint

Rim paint

Window tint

Interior color (future)

License plate (future)

Decals (future)

Body kits (future)

Spoilers (future)

Neon lighting (future)

Must be fully data-driven.

---

# BODY PAINT

Support paint types:

Gloss

Matte

Metallic

Pearlescent

CARbon Finish (future)

Player can choose:

Preset colors

RGB picker

Hex input

Brightness

Saturation

Metallic intensity

Clear coat intensity

Live preview updates immediately.

---

# RIM CUSTOMIZATION

Player can:

Change rim color

Adjust metallic finish

Adjust gloss

Reset to default

Save preset

---

# WINDOW TINT

Tint levels:

0%

20%

40%

60%

80%

100%

Preview updates instantly.

---

# INTERACTIVE VEHICLE PARTS

Garage allows interaction with:

Driver Door

Passenger Door

Rear Doors

Hood

Trunk

Each part supports:

Open

Close

Smooth animation

Independent control

---

# ENGINE BAY VIEW

When hood is opened:

Camera automatically focuses on engine compartment.

Display:

Engine Health

Fuel Consumption

Current RPM (engine running)

Temperature placeholder (future)

---

# TRUNK VIEW

Opening trunk:

Moves camera smoothly.

Future-ready for:

CARgo system

Spare tire

Storage

---

# REPAIR MANAGER

Supports:

Repair Engine

Repair Suspension

Repair Wheels

Repair Body

Repair All

Repair instantly restores:

Health

Performance

Handling

Visual condition

---

# DAMAGE VISUALIZATION

Garage displays:

Scratches

Dents (if supported)

Smoke effects

Broken lights

Repair animation fades visual damage.

---

# FUEL MANAGER

Display:

Fuel percentage

Fuel liters

Estimated remaining distance

Buttons:

Refuel 25%

Refuel 50%

Refuel 75%

Refuel 100%

Fuel instantly updates dashboard values.

---

# UPGRADE MANAGER

Architecture only.

Future-ready support for:

Engine Upgrade

Turbo

Transmission

Suspension

Brakes

Tires

Weight Reduction

Aerodynamics

Current implementation should expose upgrade slots without requiring additional models.

---

# PERFORMANCE PREVIEW

When an upgrade is selected, preview:

Acceleration

Top Speed

Handling

Braking

Fuel Economy

Without permanently applying changes until confirmed.

---

# SAVE CUSTOMIZATION

Automatically save:

Body Color

Rim Color

Window Tint

Fuel Level

Repair State

Garage Preferences

Vehicle Rotation

Inspection Camera Position

Use LocalStorage.

---

# RESET OPTIONS

Buttons:

Reset Paint

Reset Wheels

Reset Tint

Reset Vehicle

Reset All Customization

Confirmation dialog required before full reset.

---

# GARAGE ANIMATIONS

Smooth animations for:

Menu transitions

Panel opening

Camera movement

Door movement

Platform rotation

Button hover

Selection highlights

Avoid abrupt transitions.

---

# RESPONSIVE DESIGN

Garage must support:

Desktop

Laptop

Tablet

Mobile Landscape

Mobile Portrait

Adaptive UI scaling.

---

# ACCESSIBILITY

Support:

Keyboard navigation

Touch controls

High contrast mode

Scalable text

Readable fonts

Color-blind friendly indicators where practical.

---

# PERFORMANCE REQUIREMENTS

Garage should maintain:

Desktop:

60–120 FPS

Mobile:

30–60 FPS

Use:

Static lighting

Cached reflections

Object reuse

Minimal physics

Suspend unnecessary background systems.

---

# ERROR HANDLING

Gracefully handle:

Missing vehicle model

Missing textures

Failed customization save

Corrupted save data

Provide clear user feedback and recovery options.

---

# FUTURE EXPANSION HOOKS

Reserve APIs for:

Multiple vehicles

Vehicle marketplace

Body kits

Spoilers

Neon kits

Custom wheels

Interior customization

License plates

Garage themes

Animated mechanics

CAR wash

Maintenance scheduling

---

# FINAL REQUIREMENTS

The Garage must:

- Feel like a premium AAA vehicle showroom.
- Operate independently from gameplay.
- Use only the provided CAR.glb model.
- Support repair, refueling, inspection, and visual customization.
- Be modular and ready for future upgrades.
- Save all player changes automatically.
- Deliver a polished, responsive, production-quality user experience.

# END OF PART_2B

The next section (**PART_2C**) will implement the complete **Photo Mode, Replay System, Cinematic Cameras, UI Architecture, Menu System, Loading Screen, Notifications, and User Experience**.