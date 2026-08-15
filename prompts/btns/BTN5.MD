# BUTTONS_5.md
# Complete Button & UI Interaction Specification
## Part 5 — Settings, Graphics, Audio, Controls & Accessibility

---

# PURPOSE

This document defines every button, toggle, slider, dropdown, selector, shortcut, and interaction inside the Settings system.

The Settings Menu must be accessible from:

• Main Menu
• Pause Menu
• Garage

Every setting must immediately affect the game (unless a restart is required).

No placeholder settings.

Every control must save automatically using LocalStorage.

---

# SETTINGS MENU

Tabs

• Graphics
• Audio
• Controls
• Gameplay
• Accessibility
• Interface
• About

Top Bar

Settings

Search

Reset

Apply

Close

Bottom Bar

Version

Save Status

---

# GRAPHICS TAB

Contains

Graphics Preset

Resolution Scale

Texture Quality

Shadow Quality

Reflection Quality

Anti-Aliasing

Ambient Occlusion

Bloom

Motion Blur

Render Distance

Particle Quality

Vegetation Density (Future)

Water Quality (Future)

FPS Limit

VSync

Fullscreen

---

# GRAPHICS PRESET

Buttons

Ultra

High

Medium

Low

Custom

Selecting a preset automatically changes all related settings.

---

# ULTRA BUTTON

Enable

Maximum shadows

Maximum textures

Maximum reflections

Highest particles

Highest render distance

Maximum post-processing

---

# HIGH BUTTON

High quality

Balanced performance

---

# MEDIUM BUTTON

Medium graphics

Optimized rendering

---

# LOW BUTTON

Lowest graphics

Maximum FPS

Disable heavy effects.

---

# CUSTOM BUTTON

Unlock manual settings.

---

# RESOLUTION SCALE

Slider

50%

↓

200%

Live update.

---

# SHADOW QUALITY

Dropdown

Ultra

High

Medium

Low

Off

---

# TEXTURE QUALITY

Dropdown

Ultra

High

Medium

Low

---

# REFLECTION QUALITY

Dropdown

Ultra

High

Medium

Low

Off

---

# ANTI-ALIASING

Dropdown

Off

FXAA

MSAA 2x

MSAA 4x

MSAA 8x

---

# AMBIENT OCCLUSION

Toggle

ON

OFF

---

# BLOOM

Toggle

ON

OFF

Intensity Slider

---

# MOTION BLUR

Toggle

ON

OFF

Strength Slider

---

# PARTICLE QUALITY

Dropdown

Ultra

High

Medium

Low

---

# FPS LIMIT

Buttons

30 FPS

60 FPS

90 FPS

120 FPS

Unlimited

---

# VSYNC

Toggle

ON

OFF

---

# FULLSCREEN

Toggle

Windowed

Fullscreen

Borderless (Future)

---

# AUDIO TAB

Contains

Master Volume

Music

Engine

Vehicle

Weather

Environment

UI

Replay

Photo Mode

Mute

---

# MASTER VOLUME

Slider

0%

↓

100%

---

# MUSIC VOLUME

Slider

0%

↓

100%

---

# ENGINE VOLUME

Slider

0%

↓

100%

---

# WEATHER VOLUME

Slider

0%

↓

100%

---

# ENVIRONMENT VOLUME

Slider

0%

↓

100%

---

# UI VOLUME

Slider

0%

↓

100%

---

# MUTE BUTTON

Toggle

Mute All

Restore Previous

---

# CONTROLS TAB

Contains

Keyboard

Mouse

Touch

Future Gamepad

Sensitivity

Dead Zone

Invert Camera

Reset Controls

---

# KEYBOARD BUTTON

Display all keyboard bindings.

Supports rebinding.

---

# MOUSE BUTTON

Contains

Sensitivity

Invert Y

Scroll Speed

---

# TOUCH BUTTON

Contains

Button Size

Steering Sensitivity

Transparency

Layout

---

# CAMERA SENSITIVITY

Slider

1%

↓

100%

---

# STEERING SENSITIVITY

Slider

1%

↓

100%

---

# RESET CONTROLS

Confirmation

Restore default controls?

YES

NO

---

# GAMEPLAY TAB

Contains

Transmission

Driving Assists

Auto Start Engine

Damage Difficulty

Fuel Consumption

Units

Language

---

# TRANSMISSION

Buttons

Automatic

Manual

---

# DAMAGE DIFFICULTY

Buttons

Easy

Normal

Realistic

---

# FUEL CONSUMPTION

Buttons

Low

Normal

Realistic

---

# SPEED UNITS

Buttons

km/h

mph

---

# LANGUAGE

Dropdown

English

Future Languages

---

# ACCESSIBILITY TAB

Contains

UI Scale

Large Text

Color Blind Mode

High Contrast

Reduced Motion

HUD Scale

Subtitle Hooks

---

# UI SCALE

Slider

50%

↓

200%

---

# LARGE TEXT

Toggle

ON

OFF

---

# HIGH CONTRAST

Toggle

ON

OFF

---

# REDUCED MOTION

Toggle

ON

OFF

Disables unnecessary animations.

---

# COLOR BLIND MODE

Buttons

Off

Protanopia

Deuteranopia

Tritanopia

---

# HUD SCALE

Slider

50%

↓

200%

---

# INTERFACE TAB

Contains

HUD

Notifications

Crosshair (Future)

Mini Map (Future)

Clock

FPS Counter

Theme

---

# HUD TOGGLE

ON

OFF

---

# NOTIFICATIONS

Toggle

ON

OFF

---

# CLOCK

Toggle

24 Hour

12 Hour

---

# FPS COUNTER

Toggle

ON

OFF

Debug only.

---

# UI THEME

Buttons

Dark

Light

Auto

---

# ABOUT TAB

Display

Game Version

Engine

Three.js Version

Rapier Version

Developer

License

Credits

---

# APPLY BUTTON

Apply all changes.

Save settings.

Display

Settings Applied

---

# RESET SETTINGS

Confirmation

Reset all settings?

YES

NO

Restore defaults.

---

# CLOSE BUTTON

Exit Settings.

Auto Save.

Return to previous screen.

---

# SEARCH SETTINGS

Live search.

Highlights matching options.

---

# TOOLTIPS

Every option displays

Name

Description

Recommended Value

Performance Impact

---

# BUTTON STATES

Normal

Hover

Pressed

Selected

Disabled

Loading

Focused

---

# ANIMATIONS

Hover

Scale

Glow

Pressed

Shrink

Slide Panels

Fade

Smooth transitions.

---

# SOUND EFFECTS

Hover

Tick

Click

Apply

Confirmation

Reset

Cancel

---

# MOBILE SUPPORT

Responsive layout.

Scrollable tabs.

Large touch controls.

---

# ACCESSIBILITY SUPPORT

Keyboard Navigation

Tab Order

Large Text

High Contrast

Reduced Motion

Touch Friendly

---

# FINAL IMPLEMENTATION RULES

Every Settings control MUST

✓ Save automatically

✓ Restore on game launch

✓ Update game immediately (where possible)

✓ Support keyboard

✓ Support mouse

✓ Support touch

✓ Display tooltip

✓ Animate smoothly

✓ Play UI sounds

✓ Never be decorative

✓ Never be a placeholder

✓ Integrate with GraphicsManager

✓ Integrate with AudioManager

✓ Integrate with InputManager

✓ Integrate with SaveManager

✓ Be fully production-ready

# END OF BUTTONS_5.md