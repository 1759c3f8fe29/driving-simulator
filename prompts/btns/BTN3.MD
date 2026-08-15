# BUTTONS_3.md
# Complete Button & UI Interaction Specification
## Part 3 — Garage, Customization, Repair, Refueling & Vehicle Inspection

---

# PURPOSE

This document defines every Garage button, customization control, repair option, refueling action, inspection camera, interactive vehicle part, animation, shortcut, UI behavior, and gameplay interaction.

The Garage is a fully interactive vehicle management hub.

Every control must be functional.

No placeholder buttons.

No fake customization.

Every action must immediately update the vehicle.

---

# GARAGE OVERVIEW

Garage contains:

Vehicle Platform

Inspection Camera

Vehicle Information

Customization Panel

Repair Panel

Fuel Panel

Upgrade Panel

Settings

Exit

---

# GARAGE HUD

Top Left

Vehicle Name

Vehicle Class

Mileage

Top Right

Garage Settings

Help

Exit

Bottom Left

Vehicle Health

Fuel

Money (Future)

Bottom Right

Camera Controls

Rotate

Zoom

Reset

---

# EXIT GARAGE

Purpose

Return to gameplay.

Requirements

Auto Save

Restore Gameplay

Restore Camera

Enable Physics

Fade Transition

Shortcut

ESC

---

# INSPECTION MODE

Purpose

Inspect the vehicle.

Camera

Orbit

Rotate

Zoom

Pan

Focus

Supports Mouse

Keyboard

Touch

---

# ROTATE LEFT BUTTON

Rotate vehicle platform left.

Animation

Smooth.

Continuous while held.

Shortcut

Q

---

# ROTATE RIGHT BUTTON

Rotate platform right.

Shortcut

E

---

# RESET CAMERA

Return inspection camera to default.

Animation

Smooth interpolation.

Shortcut

R

---

# ZOOM IN

Increase camera zoom.

Mouse Wheel

Pinch Gesture

Button Support

---

# ZOOM OUT

Decrease camera zoom.

---

# FRONT VIEW

Move camera to front.

---

# REAR VIEW

Move camera behind vehicle.

---

# LEFT VIEW

Camera moves left.

---

# RIGHT VIEW

Camera moves right.

---

# TOP VIEW

Bird's-eye inspection.

---

# INTERIOR VIEW

Move camera inside cockpit.

Display dashboard.

---

# ENGINE BAY VIEW

Automatically opens hood.

Moves camera.

Displays engine.

---

# TRUNK VIEW

Automatically opens trunk.

Camera focuses trunk.

---

# DRIVER DOOR BUTTON

Open Driver Door.

Close Driver Door.

Smooth animation.

Door angle limited.

---

# PASSENGER DOOR BUTTON

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

# HOOD BUTTON

Open Hood.

Close Hood.

Engine visible.

---

# TRUNK BUTTON

Open Trunk.

Close Trunk.

Smooth animation.

---

# OPEN ALL BUTTON

Open:

Doors

Hood

Trunk

Sequential animation.

---

# CLOSE ALL BUTTON

Close everything.

Restore default.

---

# PAINT MENU

Contains

Body Paint

Rim Paint

Brake Calipers

Window Tint

Reset

Save

---

# BODY PAINT BUTTON

Purpose

Open paint selector.

Display

Preset Colors

RGB Picker

HEX Input

Metallic

Gloss

Matte

Live Preview

---

# COLOR PICKER

Supports

RGB

HSV

HEX

Favorites

Recent Colors

---

# APPLY COLOR

Apply immediately.

Update reflections.

Save pending changes.

---

# RESET PAINT

Restore original paint.

Confirmation required.

---

# SAVE PAINT

Store color.

Update LocalStorage.

---

# RIM COLOR BUTTON

Change rim color.

Live preview.

Supports metallic finish.

---

# BRAKE CALIPER COLOR

Future-ready.

Supports multiple colors.

---

# WINDOW TINT BUTTON

Levels

0%

20%

40%

60%

80%

100%

Updates glass immediately.

---

# REPAIR MENU

Contains

Repair Engine

Repair Body

Repair Suspension

Repair Wheels

Repair All

---

# REPAIR ENGINE

Restore

Engine Health

Power

Acceleration

Sound

Animation

Engine service.

---

# REPAIR BODY

Remove

Scratches

Body damage

Visual defects

---

# REPAIR WHEELS

Restore wheel condition.

Reset alignment.

---

# REPAIR SUSPENSION

Restore ride height.

Restore handling.

---

# REPAIR ALL

Confirmation

Repair entire vehicle?

YES

NO

YES restores

Body

Engine

Suspension

Wheels

Dashboard warnings removed.

---

# DAMAGE REPORT

Display

Engine %

Body %

Suspension %

Wheel %

Color coded.

---

# FUEL MENU

Display

Fuel %

Fuel Liters

Remaining Distance

Consumption

---

# REFUEL 25%

Fill tank to 25%.

Update dashboard.

Play fuel sound.

---

# REFUEL 50%

Fill to 50%.

---

# REFUEL 75%

Fill to 75%.

---

# REFUEL FULL

Fill 100%.

Display

Tank Full

Notification.

---

# VEHICLE INFORMATION

Display

Vehicle Name

Current Speed

Top Speed

Mileage

Engine Health

Fuel

Gear

Current Weather

Drive Time

---

# SAVE GARAGE

Purpose

Save:

Paint

Tint

Fuel

Repairs

Camera Position

Garage Settings

Customization

Display

Garage Saved

---

# RESET VEHICLE

Restore factory settings.

Confirmation required.

---

# GARAGE SETTINGS

Contains

Music Volume

Rotate Speed

Camera Sensitivity

UI Scale

Auto Save

Animations

---

# GARAGE MUSIC

Toggle

ON

OFF

Volume slider.

---

# CAMERA SPEED

Slider

0%

100%

---

# AUTO SAVE

Toggle

ON

OFF

---

# HELP BUTTON

Display Garage controls.

Shortcuts.

Tips.

---

# TOOLTIPS

Every Garage button displays

Name

Shortcut

Description

---

# NOTIFICATIONS

Examples

Paint Saved

Repair Complete

Fuel Added

Door Open

Garage Saved

Settings Updated

---

# BUTTON STATES

Normal

Hover

Pressed

Selected

Disabled

Loading

Error

Active

---

# BUTTON ANIMATIONS

Hover

Scale 1.05

Pressed

Scale 0.95

Glow

Fade

Slide

No instant transitions.

---

# AUDIO

Hover

Soft Tick

Click

Repair Sound

Fuel Pump

Door Open

Door Close

Paint Apply

Save Complete

---

# MOBILE SUPPORT

Large touch targets.

Swipe camera.

Pinch zoom.

Drag rotate.

Responsive layout.

---

# ACCESSIBILITY

Large Text

High Contrast

Keyboard Navigation

Touch Friendly

Reduced Motion

---

# FINAL IMPLEMENTATION RULES

Every Garage control must

✓ Work correctly

✓ Update the vehicle immediately

✓ Save changes

✓ Play animations

✓ Play sounds

✓ Support keyboard

✓ Support mouse

✓ Support touch

✓ Never be decorative

✓ Never contain placeholder functionality

✓ Integrate with VehicleManager, SaveManager, UIManager, CameraManager, and AudioManager

# END OF BUTTONS_3.md