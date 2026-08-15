# BUTTONS_2.md
# Complete Button & UI Interaction Specification
## Part 2 — Driving HUD, Vehicle Controls, Dashboard & Camera System

---

# PURPOSE

This document defines every in-game driving button, HUD element, dashboard control, camera function, keyboard shortcut, mobile control, interaction, animation, dependency, and gameplay behavior.

Every button MUST be completely functional.

No placeholder UI.

No fake functionality.

Every button must:

• Mouse Support
• Keyboard Support
• Mobile Touch Support
• Future Gamepad Ready
• Hover Animation
• Press Animation
• Sound Feedback
• Tooltip
• State Management
• Event Handling
• Save State Support

---

# DRIVING HUD

The HUD appears immediately after gameplay starts.

Display:

Top Left

Current Time

Weather

FPS (Debug)

Compass

Top Right

Pause

Camera

Photo Mode

Settings

Center

Speedometer

RPM

Gear

Bottom Left

Mini Notifications

Bottom Right

Fuel

Damage

Driving Mode

---

# PAUSE BUTTON

Purpose

Pause gameplay.

Function

Freeze physics.

Freeze vehicle.

Pause audio.

Pause replay.

Pause timers.

Open Pause Menu.

Shortcut

ESC

Mobile

Pause Icon

Animation

Scale

Blur Background

Fade Menu

---

# SETTINGS BUTTON

Purpose

Open settings without leaving gameplay.

Supports

Graphics

Audio

Gameplay

Controls

Accessibility

Apply instantly.

---

# CAMERA BUTTON

Purpose

Cycle camera modes.

Order

Third Person

↓

Far Chase

↓

Near Chase

↓

Cockpit

↓

Dashboard

↓

Hood

↓

Front Bumper

↓

Rear Camera

↓

Orbit Camera

↓

Return Third Person

Animation

Smooth interpolation.

Never instantly teleport.

---

# PHOTO MODE BUTTON

Purpose

Enter Photo Mode.

Actions

Pause gameplay.

Hide HUD.

Enable free camera.

Display photo controls.

Shortcut

P

---

# REPLAY BUTTON

Purpose

Open replay browser.

Gameplay pauses.

Player selects replay.

Playback begins.

---

# SPEEDOMETER

Display

Digital

Analog Needle

Units

km/h

mph

Needle animation

Smooth interpolation.

No jumping.

---

# RPM GAUGE

Display

Idle

Working Range

Redline

Shift Indicator

Update every frame.

---

# GEAR DISPLAY

Show

R

N

1

2

3

4

5

6

Automatic updates.

---

# FUEL GAUGE

Display

Percentage

Remaining Liters

Estimated Distance

Warnings

25%

10%

5%

0%

Low fuel flashes.

---

# DAMAGE INDICATOR

Display

Body Damage

Engine Damage

Wheel Damage

Suspension Damage

Color States

Green

Yellow

Orange

Red

Blink when critical.

---

# ENGINE START BUTTON

Purpose

Start engine.

Requirements

Fuel available.

Battery simulation future-ready.

Animation

Dashboard lights.

Starter sound.

Engine idle.

Second press

Turn engine off.

Shortcut

E

---

# ACCELERATOR

Desktop

W

Up Arrow

Mobile

Large pedal.

Gamepad future.

Function

Increase throttle.

Increase RPM.

Increase speed.

---

# BRAKE

Desktop

S

Down Arrow

Mobile

Brake pedal.

Function

Apply braking force.

Brake lights.

ABS hooks future.

---

# REVERSE

Function

Move backward.

Automatic

Select reverse.

Manual

Requires Reverse Gear.

---

# STEER LEFT

Desktop

A

Left Arrow

Mobile

Steering wheel.

Animation

Wheel rotates.

Driver hands future-ready.

---

# STEER RIGHT

Desktop

D

Right Arrow

---

# HANDBRAKE

Shortcut

Space

Mobile Button

Function

Lock rear wheels.

Enable drifting.

Show dashboard icon.

Release restores grip.

---

# CLUTCH

Manual only.

Shortcut

Left Shift

Required

Gear changes.

Prevents stalling.

---

# GEAR UP

Shortcut

E

Increase gear.

Display animation.

Play shift sound.

---

# GEAR DOWN

Shortcut

Q

Decrease gear.

Automatic rev matching future.

---

# TRANSMISSION TOGGLE

Purpose

Switch

Automatic

Manual

Display notification.

Save preference.

---

# HORN BUTTON

Desktop

H

Mobile

Horn Icon

Hold

Continuous sound.

Release

Stop horn.

---

# LOW BEAM BUTTON

Shortcut

L

Cycle

Off

↓

Low Beam

Dashboard indicator updates.

---

# HIGH BEAM BUTTON

Shortcut

K

Function

Toggle High Beam.

Increase light distance.

Dashboard icon.

---

# FLASH HEADLIGHTS

Shortcut

F

Temporary high beam.

Release returns previous state.

---

# LEFT INDICATOR

Shortcut

Z

Blink every 500ms.

Dashboard indicator.

Exterior lights.

Audio tick.

---

# RIGHT INDICATOR

Shortcut

X

Same behavior.

---

# HAZARD LIGHTS

Shortcut

C

Both indicators flash.

Dashboard icon.

Audio ticking.

---

# INTERIOR LIGHT

Toggle

Interior cabin light.

Only visible at night.

---

# DRIVER DOOR

Toggle

Open

Close

Smooth animation.

Cannot drive away if open warning enabled.

---

# PASSENGER DOOR

Same behavior.

---

# REAR LEFT DOOR

Open

Close

---

# REAR RIGHT DOOR

Open

Close

---

# HOOD

Open

Close

Display warning.

---

# TRUNK

Open

Close

Display warning.

---

# LOCK BUTTON

Lock all doors.

Unlock all doors.

Animation

Indicator flash.

---

# RESET VEHICLE BUTTON

Purpose

Recover flipped vehicle.

Requirements

Vehicle stationary.

Countdown

3

2

1

Respawn nearby.

Shortcut

R

---

# REPAIR BUTTON

Instant repair.

Restore

Body

Engine

Suspension

Wheel damage

Notification

Vehicle repaired.

---

# REFUEL BUTTON

Instantly opens refuel dialog.

Options

25%

50%

75%

100%

Updates dashboard.

---

# CAMERA LOOK LEFT

Shortcut

,

Temporary.

Returns after release.

---

# CAMERA LOOK RIGHT

Shortcut

.

---

# LOOK BACK

Shortcut

B

Rear camera while held.

---

# CAMERA ZOOM

Mouse Wheel

Pinch Gesture

Zoom limits enforced.

---

# CAMERA RESET

Shortcut

Home

Return default view.

---

# NOTIFICATIONS

Appear for

Low Fuel

Engine Started

Engine Stopped

Lights On

Gear Changed

Weather Changed

Damage

Repair

Refuel

Camera Changed

Photo Saved

Replay Saved

Fade automatically.

---

# TOOLTIPS

Every button displays

Name

Shortcut

Description

Example

Horn

(H)

Sound vehicle horn.

---

# BUTTON STATES

Normal

Hover

Pressed

Active

Disabled

Selected

Loading

Error

Visual feedback required.

---

# MOBILE HUD

Buttons

Accelerate

Brake

Reverse

Steering

Horn

Lights

Camera

Pause

Photo Mode

Reset Vehicle

Gear Up

Gear Down

Handbrake

Large touch areas.

Adaptive scaling.

---

# ACCESSIBILITY

Large Buttons

High Contrast

Color Blind Friendly Icons

Scalable HUD

Reduced Motion

---

# FINAL IMPLEMENTATION RULES

Every driving button must:

✓ Trigger correct gameplay logic

✓ Update HUD

✓ Play audio

✓ Animate

✓ Save state if required

✓ Support desktop

✓ Support mobile

✓ Integrate with vehicle physics

✓ Never be decorative

✓ Never remain unfinished

✓ Work with Three.js rendering

✓ Work with Rapier Physics

✓ Be production-ready

# END OF BUTTONS_2.md