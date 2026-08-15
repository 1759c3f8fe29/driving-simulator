# BUTTONS_1.md
# Complete Button & UI Interaction Specification
## Part 1 — Main Menu, Loading Screen & Pause Menu

---

# PURPOSE

This document defines every button, interactive element, shortcut, animation, state, dependency, and function for the Main Menu, Loading Screen, and Pause Menu.

Every button defined here MUST be fully implemented.

No placeholder buttons.

No inactive UI.

No fake interactions.

Every button must:

• Respond to Mouse
• Respond to Keyboard
• Respond to Touch (Mobile)
• Display Hover State
• Display Press State
• Display Disabled State
• Play UI Sound
• Animate Smoothly
• Execute Assigned Function
• Support Future Gamepad Input

---

# MAIN MENU

When the game launches, display the Main Menu.

Background:

• Animated City Camera
• Dynamic Lighting
• Day/Night Depending on Last Save
• Weather Animation
• Animated Logo
• Version Number
• FPS Hidden
• Copyright Text

Buttons:

Play

Continue

Garage

Settings

Controls

Statistics

Achievements

Credits

Exit

---

# PLAY BUTTON

Purpose

Starts a completely new gameplay session.

Requirements

If no save exists:

• Create default save
• Load City.glb
• Load Car.glb
• Initialize Rapier Physics
• Spawn vehicle
• Start game

If save exists:

Ask confirmation

Start New Game?

YES

NO

Selecting YES deletes current progress after confirmation.

Animation

Button grows slightly.

Glow animation.

Click sound.

Fade to loading screen.

Disabled State

Disabled while loading.

---

# CONTINUE BUTTON

Purpose

Continue previous save.

Requirements

Validate save.

If valid:

Restore

Vehicle Position

Vehicle Rotation

Fuel

Damage

Garage Data

Statistics

Achievements

Weather

Graphics Settings

Camera Mode

Resume gameplay.

If save missing:

Disable button.

Tooltip:

"No saved game found."

---

# GARAGE BUTTON

Purpose

Open Garage Scene.

Requirements

Pause gameplay.

Load garage.

Spawn vehicle.

Enable inspection camera.

Display customization UI.

Disable world simulation.

Exit Garage returns to previous screen.

---

# SETTINGS BUTTON

Purpose

Open Settings Menu.

Animation

Slide Panel.

Blur Background.

Display Tabs:

Graphics

Audio

Controls

Gameplay

Accessibility

About

Changes apply immediately unless restart required.

---

# CONTROLS BUTTON

Purpose

Display every control.

Desktop

Keyboard

Mouse

Touch

Future:

Gamepad

Contents

Movement

Driving

Garage

Replay

Photo Mode

Camera

Menus

---

# STATISTICS BUTTON

Purpose

Open player statistics.

Display

Distance Driven

Driving Time

Top Speed

Fuel Used

Damage

Longest Drift

Garage Visits

Photos Taken

Replay Count

Achievements

Support scrolling.

---

# ACHIEVEMENTS BUTTON

Purpose

Open achievement screen.

Display

Locked

Unlocked

Progress

Completion %

Unlock Date

Search

Filter

Categories

Driving

Garage

Replay

Photo

Fuel

Damage

Secret

---

# CREDITS BUTTON

Purpose

Display:

Game Name

Developer

Engine

Libraries

Three.js

Rapier Physics

Open Source Licenses

Special Thanks

Scrollable.

---

# EXIT BUTTON

Desktop

Display dialog.

Exit Game?

YES

NO

YES closes application.

Browser version:

Return to blank page or close if browser allows.

---

# BUTTON STATES

Every button supports:

Normal

Hover

Pressed

Focused

Selected

Disabled

Loading

Active

Visual feedback required.

---

# BUTTON ANIMATIONS

Hover

Scale 1.05

Pressed

Scale 0.96

Release

Spring animation

Disabled

Reduced opacity

Loading

Spinner

Glow pulse

Never use abrupt transitions.

---

# BUTTON SOUND EFFECTS

Hover

Soft Tick

Press

Click

Accept

Positive sound

Cancel

Soft Back sound

Disabled

Muted click

Volume controlled by UI audio.

---

# LOADING SCREEN

Appears after Play or Continue.

Display

Game Logo

Loading Bar

Loading %

Current Loading Step

Tips

Background Animation

Estimated Time Remaining

---

# LOADING BAR

Progress updates from:

Asset Loader

Physics

Shaders

Textures

Environment

Vehicle

Audio

UI

Never use fake loading percentages.

Reflect actual progress.

---

# LOADING TIPS

Random examples

"Manual transmission gives better control."

"Rain reduces tire grip."

"Repair damaged vehicles in the garage."

"Photo Mode can hide the HUD."

"Fuel affects total driving distance."

No immediate repetition.

---

# LOADING COMPLETE

Fade Out

Fade In Gameplay

Spawn Vehicle

Enable Input

Start Audio

Initialize HUD

---

# PAUSE MENU

Pause immediately freezes gameplay.

Physics paused.

Vehicle paused.

Replay paused.

Timers paused.

Weather continues only if configured.

Buttons

Resume

Restart Drive

Garage

Photo Mode

Replay

Settings

Controls

Statistics

Achievements

Main Menu

Exit Game

---

# RESUME BUTTON

Close pause menu.

Restore gameplay.

Resume audio.

Restore input.

---

# RESTART DRIVE BUTTON

Confirmation

Restart current drive?

YES

NO

YES

Respawn vehicle.

Restore default fuel.

Restore default damage.

Keep statistics.

---

# PHOTO MODE BUTTON

Pause gameplay.

Hide HUD.

Enable free camera.

Open Photo Mode UI.

---

# REPLAY BUTTON

Pause gameplay.

Open Replay Browser.

Player chooses replay.

Playback begins.

---

# MAIN MENU BUTTON

Confirmation required.

Return to Main Menu?

YES

NO

YES

Save current progress.

Unload gameplay.

Load Main Menu.

---

# EXIT GAME BUTTON

Confirmation required.

Save progress.

Release resources.

Dispose physics.

Dispose renderer.

Stop audio.

Exit safely.

---

# CONFIRMATION DIALOGS

Every destructive action requires confirmation.

Examples

Delete Save

Restart

Exit

Reset Settings

Repair All

Dialogs include

Title

Description

YES

NO

Keyboard Support

ESC closes dialog.

ENTER confirms.

---

# KEYBOARD NAVIGATION

Arrow Keys

Move Selection

TAB

Next Control

SHIFT + TAB

Previous Control

ENTER

Activate

ESC

Back

Fully accessible.

---

# MOBILE SUPPORT

Large touch buttons.

Minimum touch size:

48x48 pixels

Landscape optimized.

Portrait supported.

No accidental presses.

---

# ACCESSIBILITY

Support

High Contrast

Large Text

Reduced Motion

Keyboard Only

Future Screen Reader Hooks

---

# FINAL IMPLEMENTATION RULES

Every button defined in this document MUST:

• Be fully functional.
• Trigger the correct gameplay system.
• Have proper animations.
• Have sound feedback.
• Support keyboard, mouse, and touch input.
• Respect enabled/disabled states.
• Display tooltips where appropriate.
• Never exist as a placeholder.
• Never perform fake actions.
• Integrate with the save system, UI manager, and game state manager.

# END OF BUTTONS_1.md