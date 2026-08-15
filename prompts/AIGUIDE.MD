# AIGUIDE.md
# MASTER DEVELOPMENT GUIDE
## Read This File FIRST
### Highest Priority Document

------------------------------------------------------------

# PURPOSE

This file tells the AI exactly how to start building the game.

Do NOT skip this file.

Read this completely before reading any other document.

This document defines the reading order, implementation order, priorities, and development workflow.

------------------------------------------------------------

# PROJECT

AAA Open World Driving Simulator

Technology

• Three.js

• Rapier Physics

• TypeScript

• WebGL

Player Assets

• assets

Only these assets may be used.

------------------------------------------------------------

# IMPORTANT

Do NOT start coding immediately.

Before writing code,

understand the entire project.

------------------------------------------------------------

# READING ORDER

Read documents in EXACTLY this order.

STEP 1

AI_INSTRUCTIONS.md

↓

STEP 2

main.md

↓

STEP 3

prompts_PART1

Read

PROMPT_1A.md

↓

PROMPT_1B.md

↓

PROMPT_1C.md

↓

STEP 4

prompts_PART2

Read

PROMPT_2A.md

↓

PROMPT_2B.md

↓

PROMPT_2C.md

↓

PROMPT_2D.md

↓

PROMPT_2E.md

↓

STEP 5

Buttons

Read

BTN1.md

↓

BTN2.md

↓

BTN3.md

↓

BTN4.md

↓

BTN5.md

↓

BTN6.md

↓

FINAL_BUTTONS.md

↓

STEP 6

User Interface

Read

UI1.md

↓

UI2.md

↓

UI3.md

↓

UI4.md

↓

UI5.md

↓

FINAL_UI.md

------------------------------------------------------------

# AFTER READING

DO NOT WRITE CODE YET.

First understand

• Project scope

• Game systems

• Dependencies

• Folder architecture

• UI architecture

• Button logic

• Vehicle systems

• Physics systems

• Rendering pipeline

• Save system

------------------------------------------------------------

# NEXT

Design the complete architecture.

Create

Project structure

↓

Dependency graph

↓

Rendering pipeline

↓

Physics pipeline

↓

Game loop

↓

Manager hierarchy

↓

UI hierarchy

↓

Asset loading system

↓

Save system

↓

Initialization sequence

Only after everything is designed may implementation begin.

------------------------------------------------------------

# IMPLEMENTATION ORDER

Build systems only in this order.

1

Core

↓

2

Renderer

↓

3

Scene

↓

4

Physics

↓

5

Input

↓

6

Asset Loader

↓

7

Vehicle

↓

8

Vehicle Physics

↓

9

Camera

↓

10

Environment

↓

11

Lighting

↓

12

Weather

↓

13

Audio

↓

14

HUD

↓

15

Menus

↓

16

Garage

↓

17

Customization

↓

18

Fuel

↓

19

Damage

↓

20

Replay

↓

21

Photo Mode

↓

22

Statistics

↓

23

Achievements

↓

24

Save System

↓

25

Graphics Settings

↓

26

Accessibility

↓

27

Optimization

↓

28

Testing

------------------------------------------------------------

# DEVELOPMENT RULES

Never skip dependencies.

Never create placeholder code.

Never create fake UI.

Never create fake gameplay.

Never leave TODO.

Never leave FIXME.

Never leave empty methods.

Never hardcode values.

Never ignore prompt documents.

------------------------------------------------------------

# UI RULES

The complete UI is defined inside

FINAL_UI.md

Do not redesign it.

Do not simplify it.

Implement exactly.

------------------------------------------------------------

# BUTTON RULES

Every button is defined inside

FINAL_BUTTONS.md

Every button must

Exist

Animate

Work

Play sounds

Update UI

Update gameplay

Support keyboard

Support mouse

Support touch

------------------------------------------------------------

# GAME RULES

Single Player

No Multiplayer

No AI Traffic

No Police

No Wanted Level

No Pedestrians

Only

Driving

Exploration

Garage

Customization

Replay

Photo Mode

------------------------------------------------------------

# ASSET RULES

Use only

City.glb

Car.glb

Never replace them.

Never generate replacement assets.

------------------------------------------------------------

# PERFORMANCE TARGET

60 FPS

Object Pooling

LOD

Frustum Culling

Texture Optimization

Memory Optimization

Proper Disposal

------------------------------------------------------------

# BEFORE MOVING TO NEXT MODULE

Verify

✓ Code compiles

✓ Feature works

✓ UI works

✓ Physics works

✓ Audio works

✓ Save works

✓ Mobile works

✓ Performance acceptable

Only then continue.

------------------------------------------------------------

# FINAL COMPLETION RULE

The project is NOT complete until

✓ Every prompt has been implemented

✓ Every button works

✓ Every UI screen works

✓ Every gameplay system works

✓ Every weather system works

✓ Every camera works

✓ Every graphics option works

✓ Every save system works

✓ Every accessibility feature works

✓ Every replay feature works

✓ Every photo mode feature works

✓ Every garage feature works

✓ Everything is integrated

✓ Everything is tested

✓ Everything is optimized

✓ No placeholders remain

✓ No TODO remains

✓ No unfinished systems remain

------------------------------------------------------------
# IMPORTANT STARTUP RULES

This is the MASTER ENTRY DOCUMENT.

Every AI working on this project MUST start here.

Never skip this document.

Never skip document order.

Never start coding before reading ALL project documents.

Never ignore any specification file.

Treat **AIGUIDE.md** as the ONLY project entry point.

This document controls the entire development workflow.

------------------------------------------------------------

# PROJECT FOLDER STRUCTURE

assets/

    City.glb
    Car.glb

prompts/

│

├── master prompt/

│      AI.MD
│      main.md

│

├── prompts_PART1/

│      prompt_1A.MD
│      PROMPT_1B.MD
│      PROMPT_1C.MD

│

├── PROMPTS_PART2/

│      PROMPT_2A.MD
│      PROMPT_2B.MD
│      PROMPT_2C.MD
│      PROMPT_2D.MD
│      PROMPTS_2E.MD

│

├── btns/

│      btn1A.MD
│      BTN2.MD
│      BTN3.MD
│      BTN4.MD
│      BTN5.MD
│      BTN6.MD
│      FINAL_BUTTONS.md

│

└── UI/

       UI1.MD
       UI2.MD
       UI3.MD
       UI4.MD
       UI5.MD
       FINAL_UI.MD

------------------------------------------------------------

# MANDATORY READING ORDER

The AI MUST read every document in the exact order below.

STEP 1

Read

AIGUIDE.md

↓

STEP 2

Read

master prompt/

AI.MD

↓

STEP 3

Read

master prompt/

main.md

↓

STEP 4

Read

prompts_PART1/

prompt_1A.MD

↓

PROMPT_1B.MD

↓

PROMPT_1C.MD

↓

STEP 5

Read

PROMPTS_PART2/

PROMPT_2A.MD

↓

PROMPT_2B.MD

↓

PROMPT_2C.MD

↓

PROMPT_2D.MD

↓

PROMPTS_2E.MD

↓

STEP 6

Read

btns/

btn1A.MD

↓

BTN2.MD

↓

BTN3.MD

↓

BTN4.MD

↓

BTN5.MD

↓

BTN6.MD

↓

FINAL_BUTTONS.md

↓

STEP 7

Read

UI/

UI1.MD

↓

UI2.MD

↓

UI3.MD

↓

UI4.MD

↓

UI5.MD

↓

FINAL_UI.MD

------------------------------------------------------------

# AFTER READING

DO NOT START CODING YET.

The AI MUST first completely understand:

• Complete project scope

• Game architecture

• Folder architecture

• Rendering pipeline

• Physics pipeline

• Vehicle systems

• Weather systems

• Audio systems

• Save system

• UI architecture

• Every button

• Every gameplay mechanic

• Every dependency

Only after understanding the ENTIRE project may implementation begin.

------------------------------------------------------------

# ABSOLUTE RULES

❌ Never skip document order.

❌ Never start coding before reading every prompt file.

❌ Never ignore AI.MD.

❌ Never ignore main.md.

❌ Never skip FINAL_BUTTONS.md.

❌ Never skip FINAL_UI.MD.

❌ Never implement features not described by the documents unless required to support an existing feature.

❌ Never generate placeholder systems.

❌ Never generate fake UI.

❌ Never leave TODO comments.

❌ Never leave unfinished code.

❌ Never replace the provided City.glb or Car.glb.

------------------------------------------------------------

# MASTER RULE

The AI must treat all prompt files as one single specification.

The implementation is considered complete ONLY when every requirement from:

• AI.MD
• main.md
• prompt_1A.MD
• PROMPT_1B.MD
• PROMPT_1C.MD
• PROMPT_2A.MD
• PROMPT_2B.MD
• PROMPT_2C.MD
• PROMPT_2D.MD
• PROMPTS_2E.MD
• btn1A.MD
• BTN2.MD
• BTN3.MD
• BTN4.MD
• BTN5.MD
• BTN6.MD
• FINAL_BUTTONS.md
• UI1.MD
• UI2.MD
• UI3.MD
• UI4.MD
• UI5.MD
• FINAL_UI.MD

has been fully implemented, integrated, tested, optimized, and polished to a production-quality AAA standard.









