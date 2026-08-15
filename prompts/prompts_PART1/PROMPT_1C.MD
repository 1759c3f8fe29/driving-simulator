# PART_1C.md
## Interior Systems, Audio, Input, HUD, Save System, Optimization & Production Standards

---

# OBJECTIVE

This section completes the entire driving framework by implementing the interactive cockpit, user interface, input systems, save architecture, audio simulation, and production-quality optimization. All systems must be modular, performant, and easy to extend.

---

# INTERACTIVE INTERIOR

The cockpit must be fully functional.

Implement:

- Animated steering wheel
- Digital speedometer
- Analog speedometer
- RPM gauge
- Fuel gauge
- Gear indicator
- Engine warning light
- Low fuel light
- Damage warning light
- Turn signal indicators
- High beam indicator
- Handbrake indicator
- Odometer
- Trip meter
- Clock

Dashboard updates every frame using real simulation values.

Never animate using fake values.

---

# STEERING WHEEL

The steering wheel rotates proportionally to steering input.

Features:

- Smooth interpolation
- Steering return animation
- Maximum rotation configurable
- Supports first-person camera

---

# PEDALS

Animate:

- Accelerator
- Brake
- Clutch (manual mode)

Pedals follow player input.

---

# INTERACTIVE VEHICLE PARTS

Support:

Driver Door

Passenger Door

Rear Doors

Hood

Trunk

Animations:

Open

Close

Locked state

Transition smoothing

Future-ready for key interaction.

---

# VEHICLE LIGHTING

Implement:

Low Beam

High Beam

Brake Lights

Reverse Lights

Indicators

Hazard Lights

Interior Lights

Lights must illuminate nearby surfaces when possible.

---

# ENGINE SOUND SYSTEM

Create layered audio.

Individual sound layers:

Starter

Idle

Low RPM

Mid RPM

High RPM

Rev Limiter

Gear Shift

Engine Stop

Loop sounds smoothly.

Pitch follows RPM.

Volume follows throttle.

---

# ENVIRONMENT AUDIO

Include:

Wind

Road Noise

Tire Rolling

Gravel (future-ready)

Rain (future-ready)

Collision

Suspension Impacts

Door Open

Door Close

Horn

Interior audio should be quieter than exterior.

---

# AUDIO MANAGER

Responsibilities:

Load sounds

Cache buffers

3D positional audio

Master volume

Music volume

Effects volume

Mute

Fade in/out

Prevent duplicate playback.

---

# INPUT SYSTEM

Create a centralized InputManager.

Supports:

Keyboard

Mouse

Touch

Gamepad (future-ready)

Each input is mapped to an action rather than directly controlling systems.

---

# DEFAULT KEYBOARD CONTROLS

W

Accelerate

S

Brake / Reverse

A

Steer Left

D

Steer Right

Space

Handbrake

Left Shift

Boost (future-ready)

C

Change Camera

L

Headlights

H

Horn

E

Open Door

P

Photo Mode

R

Reset Vehicle

Esc

Pause Menu

---

# MOBILE CONTROLS

Touch UI includes:

Steering Wheel

Accelerator

Brake

Reverse

Handbrake

Camera

Pause

Horn

Headlights

Large touch targets.

Responsive layout.

Landscape optimized.

---

# CAMERA INPUT

Mouse:

Rotate

Zoom

Pan (Photo Mode)

Touch:

Pinch Zoom

Drag Rotate

Two-finger Pan

---

# HUD

Display:

Current Speed

RPM

Gear

Fuel

Damage

FPS (Debug)

Current Camera

Time

Pause Button

Settings Button

---

# SPEEDOMETER

Digital:

Large numeric speed

Analog:

Animated needle

Selectable units:

km/h

mph

---

# HUD WARNINGS

Display warnings:

Low Fuel

Engine Damage

Overheating (future)

Lights On

Handbrake

Collision

Messages should fade smoothly.

---

# MENU SYSTEM

Main Menu:

Play

Garage

Settings

Controls

Credits

Exit

Pause Menu:

Resume

Garage

Settings

Restart

Main Menu

Quit

---

# SETTINGS MENU

Graphics

Audio

Controls

Gameplay

Graphics:

Ultra

High

Medium

Low

Custom

Options:

Shadow Quality

Texture Quality

Bloom

SSAO

Motion Blur

Reflection Quality

Render Distance

Dynamic Resolution

Anti-Aliasing

FPS Limit

VSync

---

# SAVE SYSTEM

Use LocalStorage.

Automatically save:

Vehicle Position

Vehicle Rotation

Fuel

Damage

Current Camera

Graphics Settings

Control Settings

Audio Settings

Garage Customization

Statistics

Achievements

Save after:

Garage

Settings changes

Repair

Ref