# BUTTONS_4.md
# Complete Button & UI Interaction Specification
## Part 4 — Photo Mode, Replay System, Statistics & Achievements

---

# PURPOSE

This document defines every button, slider, toggle, shortcut, interaction, and UI element for:

• Photo Mode
• Replay System
• Statistics
• Achievements

Every control must be fully functional.

No placeholders.

No fake replay.

No inactive buttons.

Every control must support:

✓ Mouse
✓ Keyboard
✓ Mobile Touch
✓ Future Gamepad
✓ Hover Animation
✓ Press Animation
✓ Sound Effects
✓ Tooltips
✓ Save System

---

# PHOTO MODE

Photo Mode pauses gameplay.

Physics paused.

Vehicle paused.

Replay paused.

HUD hidden (optional).

Free Camera enabled.

---

# PHOTO MODE UI

Display

Top Bar

Camera Settings

Bottom Bar

Capture Button

Exit Button

Right Panel

Camera Controls

Left Panel

Filters

Bottom Right

Photo Information

---

# TAKE PHOTO BUTTON

Purpose

Capture screenshot.

Requirements

Capture current frame.

Hide cursor.

Save PNG.

Future

JPEG

WEBP

Display

Photo Saved

Animation

Camera Flash

Shortcut

F12

---

# EXIT PHOTO MODE

Purpose

Return to gameplay.

Restore HUD.

Restore camera.

Resume simulation.

Shortcut

ESC

---

# HIDE HUD BUTTON

Toggle

ON

OFF

Hide

Speedometer

RPM

Fuel

Damage

Notifications

Camera Icons

Photo UI

---

# FREE CAMERA

Enable unrestricted movement.

Controls

WASD

Mouse

Touch

Shift = Fast

Ctrl = Slow

Collision disabled.

---

# CAMERA RESET

Return camera to default.

Smooth interpolation.

Shortcut

Home

---

# FIELD OF VIEW

Slider

30°

↓

120°

Live update.

---

# EXPOSURE

Slider

-5

↓

+5

Real-time preview.

---

# BRIGHTNESS

Slider

0%

↓

200%

---

# CONTRAST

Slider

0%

↓

200%

---

# SATURATION

Slider

0%

↓

200%

---

# BLOOM

Toggle

ON

OFF

Intensity Slider.

---

# DEPTH OF FIELD

Toggle

ON

OFF

Settings

Focus Distance

Blur Amount

Aperture

---

# FOCUS DISTANCE

Slider

Near

↓

Far

---

# MOTION BLUR

Toggle

ON

OFF

Preview immediately.

---

# COLOR FILTERS

Buttons

Natural

Cinema

Warm

Cold

Vintage

Black & White

Sepia

HDR

Night

Rain

Only one active.

---

# GRID OVERLAY

Toggle

Rule of Thirds

Golden Ratio

Safe Frame

OFF

---

# CAMERA ROLL

Rotate camera.

-180°

↓

180°

---

# PHOTO GALLERY

Display

Saved Photos

Date

Weather

Location

Delete

View

Future Export.

---

# DELETE PHOTO

Confirmation

Delete photo?

YES

NO

---

# REPLAY SYSTEM

Replay Browser

Replay Timeline

Replay Playback

Replay Camera

Replay Storage

Replay Controls

---

# START RECORDING

Purpose

Begin recording gameplay.

Record

Vehicle

Camera

Weather

Inputs

Physics

Replay Length

---

# STOP RECORDING

Finish recording.

Save temporary replay.

Notification

Replay Recorded.

---

# PLAY REPLAY

Load replay.

Pause gameplay.

Playback starts.

---

# PAUSE REPLAY

Pause replay.

Timeline freezes.

---

# RESTART REPLAY

Jump to beginning.

---

# SAVE REPLAY

Store replay.

Display

Replay Name

Date

Duration

Weather

Vehicle

---

# DELETE REPLAY

Confirmation

Delete replay?

YES

NO

---

# TIMELINE

Interactive.

Drag

Jump

Seek

Bookmarks

Frame Preview

---

# NEXT FRAME

Advance one frame.

---

# PREVIOUS FRAME

Go back one frame.

---

# PLAYBACK SPEED

Buttons

0.25x

0.5x

1x

2x

4x

Display current speed.

---

# REPLAY CAMERA

Buttons

Vehicle Follow

Cockpit

Drone

Orbit

Free Camera

Wheel Camera

Rear Camera

Static Camera

---

# EXPORT REPLAY

Future Ready

Placeholder API only.

---

# STATISTICS MENU

Display

Driving

Fuel

Damage

Garage

Replay

Photos

Weather

Performance

---

# STATISTICS BUTTONS

Driving

Fuel

Damage

Garage

Replay

Photo

Weather

Performance

General

Each opens dedicated page.

---

# RESET STATISTICS

Confirmation required.

Delete all statistics.

Achievements remain.

---

# EXPORT STATISTICS

Future support.

CSV

JSON

---

# ACHIEVEMENTS

Display

Locked

Unlocked

Progress

Completion %

Category

Reward

Date

---

# FILTER BUTTON

Categories

Driving

Garage

Fuel

Replay

Photo

Secret

Performance

All

---

# SEARCH BUTTON

Search achievements.

Live filtering.

---

# SORT BUTTON

Options

Newest

Oldest

Unlocked

Locked

Progress

Alphabetical

---

# ACHIEVEMENT DETAILS

Display

Icon

Title

Description

Reward

Unlock Date

Completion

---

# CLAIM REWARD

Future system.

Current

Display unlocked.

---

# NOTIFICATIONS

Examples

Photo Saved

Replay Saved

Achievement Unlocked

Statistics Updated

New Record

Fade automatically.

---

# BUTTON STATES

Normal

Hover

Pressed

Focused

Selected

Loading

Disabled

Error

---

# BUTTON ANIMATIONS

Hover

Scale

Glow

Pressed

Shrink

Release

Bounce

Loading

Spinner

---

# SOUND EFFECTS

Hover

Tick

Click

Photo

Camera Shutter

Replay

Tape Click

Achievement

Celebration

Notification

Soft Chime

---

# KEYBOARD SHORTCUTS

P

Photo Mode

F12

Capture

ESC

Exit

Space

Pause Replay

Arrow Keys

Timeline

Delete

Delete Replay

Home

Reset Camera

---

# MOBILE SUPPORT

Swipe Timeline

Pinch Zoom

Drag Camera

Large Buttons

Adaptive Layout

---

# ACCESSIBILITY

Large Text

High Contrast

Reduced Motion

Keyboard Navigation

Touch Friendly

---

# FINAL IMPLEMENTATION RULES

Every button defined in this document MUST

✓ Function correctly

✓ Save state

✓ Play sounds

✓ Animate smoothly

✓ Update UI

✓ Support Mouse

✓ Support Keyboard

✓ Support Touch

✓ Integrate with ReplayManager

✓ Integrate with PhotoManager

✓ Integrate with StatisticsManager

✓ Integrate with AchievementManager

✓ Never be decorative

✓ Never remain unfinished

✓ Be production-ready

# END OF BUTTONS_4.md