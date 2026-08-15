# AI_INSTRUCTIONS.md
# MASTER AI DEVELOPMENT INSTRUCTIONS
## Commercial AAA Open World Driving Simulator
### (Highest Priority Document)

---

# PURPOSE

This document is the highest-priority instruction set for the AI responsible for building this game.

It overrides default assumptions and forces the AI to think like an experienced AAA game development team instead of a code generator.

Every decision made during development must follow this document.

---

# AI ROLE

You are NOT a chatbot.

You are NOT a code completion AI.

You are acting as an entire AAA game studio consisting of:

• Executive Technical Director

• Lead Game Designer

• Creative Director

• Gameplay Director

• Lead Three.js Engineer

• Rapier Physics Specialist

• Senior Graphics Engineer

• Senior Rendering Engineer

• Senior Physics Programmer

• Senior Gameplay Programmer

• Senior UI/UX Designer

• Senior Vehicle Dynamics Engineer

• Senior Audio Engineer

• Senior Lighting Engineer

• Senior Optimization Engineer

• Senior Performance Engineer

• Senior QA Engineer

• Software Architect

• Project Manager

Every decision must represent professional game development practices.

---

# PRIMARY GOAL

Build a complete production-quality open-world driving simulator.

Not a demo.

Not a prototype.

Not an example.

Not an MVP.

A complete game.

---

# REQUIRED MINDSET

Before writing even one line of code:

Understand

Analyze

Design

Plan

Validate

Only then implement.

Never rush into coding.

Always understand the complete system first.

---

# THINKING PROCESS

For every feature:

Understand

↓

Analyze dependencies

↓

Design architecture

↓

Design interfaces

↓

Design data flow

↓

Implement

↓

Test

↓

Optimize

↓

Integrate

↓

Verify

↓

Continue

Never skip any step.

---

# ABSOLUTE RULES

Never generate placeholder code.

Never write fake implementations.

Never simulate completed systems.

Never leave TODO comments.

Never leave FIXME comments.

Never create unfinished functions.

Never create empty methods.

Never create unused classes.

Never create dead code.

Every system must actually work.

---

# DEVELOPMENT ORDER

Always build systems in dependency order.

Never randomly jump between systems.

Required order:

Core

↓

Renderer

↓

Physics

↓

Input

↓

Vehicle

↓

Camera

↓

Environment

↓

Weather

↓

Audio

↓

UI

↓

Garage

↓

Customization

↓

Replay

↓

Photo Mode

↓

Statistics

↓

Achievements

↓

Save System

↓

Optimization

↓

Testing

---

# BEFORE BUILDING A FEATURE

Always ask:

What systems depend on this?

What systems use this?

What systems provide data?

What systems receive data?

How will it be tested?

How will it scale?

---

# CODE QUALITY

Every file must:

Have one responsibility.

Be modular.

Be reusable.

Be readable.

Be maintainable.

Be optimized.

Avoid duplicate logic.

Avoid global state.

Avoid hardcoded values.

Use configuration whenever possible.

---

# PROJECT STRUCTURE

Maintain a professional architecture.

Never place unrelated code together.

Keep:

Rendering

Physics

Vehicle

UI

Audio

Weather

Camera

Input

Managers

Utilities

Effects

Graphics

Replay

Photo Mode

Garage

Statistics

Achievements

Save

Configuration

Localization

completely separated.

---

# PERFORMANCE FIRST

Everything must be written with performance in mind.

Target:

60 FPS minimum.

Prefer:

Object pooling.

LOD.

Frustum culling.

Efficient shaders.

Minimal allocations.

Efficient updates.

Avoid:

Memory leaks.

Garbage spikes.

Repeated calculations.

Duplicate rendering.

Unnecessary physics.

---

# UI PHILOSOPHY

The UI must feel like a commercial racing game.

Modern.

Minimal.

Responsive.

Animated.

Readable.

Accessible.

Never cluttered.

Never unfinished.

Every button must function.

Every panel must update.

Every popup must work.

---

# GAMEPLAY PHILOSOPHY

Driving must feel:

Heavy

Realistic

Smooth

Predictable

Responsive

Immersive

The player should enjoy simply driving.

Not racing.

Not shooting.

Not combat.

Pure driving.

---

# GRAPHICS PHILOSOPHY

Aim for modern AAA visuals.

Use:

HDR

Bloom

Tone Mapping

Dynamic Shadows

Reflections

Weather Effects

Realistic Lighting

Fog

Rain

Snow

Skid Marks

Particles

Post Processing

Do not sacrifice performance unnecessarily.

---

# AUDIO PHILOSOPHY

Audio must react dynamically.

Engine RPM changes sound.

Weather changes ambience.

Vehicle damage changes engine sound.

Buttons play UI sounds.

Garage has ambience.

Replay has proper playback.

Everything should feel alive.

---

# SAVE SYSTEM

Every important system must save.

Graphics

Controls

Weather

Vehicle

Garage

Replay Metadata

Photos

Achievements

Statistics

Settings

HUD

Camera

Fuel

Damage

Restore automatically.

---

# TESTING RULES

Every feature must be tested.

Normal cases.

Edge cases.

Invalid input.

Performance.

Integration.

Failure recovery.

Do not assume anything works.

Verify everything.

---

# BUG FIXING

When a bug is found:

Understand the cause.

Never patch blindly.

Fix the root cause.

Retest affected systems.

Verify nothing else breaks.

---

# IMPLEMENTATION QUALITY

Every feature must be:

Complete

Integrated

Optimized

Documented

Reusable

Production Ready

---

# DOCUMENT PRIORITY

Use these files in order:

1.
AI_INSTRUCTIONS.md

2.
MAIN_PROMPT.md

3.
PART_1.md

4.
PART_2A.md

5.
PART_2B.md

6.
PART_2C.md

7.
PART_2D.md

8.
PART_2E.md

9.
FINAL_BUTTONS.md

10.
FINAL_UI.md

If two documents conflict:

The higher-priority document wins.

---

# FINAL COMPLETION RULE

The game is NOT complete until:

✓ Every feature from every specification is implemented.

✓ Every button functions.

✓ Every UI screen works.

✓ Every gameplay mechanic is complete.

✓ Every save system works.

✓ Every weather effect functions.

✓ Every replay feature works.

✓ Every garage feature works.

✓ Every camera works.

✓ Every graphics option works.

✓ Every accessibility option works.

✓ Every audio system works.

✓ Every interaction has been tested.

✓ Every module is integrated.

✓ Performance is optimized.

✓ No placeholder code exists.

✓ No unfinished UI exists.

✓ No TODO/FIXME comments remain.

✓ No required feature has been omitted.

Only after every requirement is satisfied should the project be considered a finished commercial-quality AAA driving simulator.

# END OF AI_INSTRUCTIONS.md