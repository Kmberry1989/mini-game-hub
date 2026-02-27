# AGENT.md

## Project Identity

Mini Game Hub is a cozy, social, multiplayer 3D world built for:

- casual players
- family + friends
- mobile-first interaction
- expressive art-toy avatars

Core emotional direction:

> soft evening hangout energy.

---

## Technology Stack

### Client
- React
- Three.js
- @react-three/fiber
- @react-three/drei

### Server
- Node.js
- Socket.io

### Assets
- GLB avatars
- Mixamo animations (separate files)

---

## Core Design Philosophy

1. Cozy before competitive.
2. Motion should feel soft and floaty.
3. Multiplayer should feel intimate (6–10 visible players).
4. Camera must support exploration and curiosity.
5. Mobile UX is primary.

---

## Character System

- Art-toy aesthetic.
- Stylized proportions.
- Human-level animation quality.

Animations use:

- ONE shared rig.
- Separate animation files.

Never duplicate rigs per animation.

---

## Input Design Rules

Movement logic must be universal:

- Mobile: touch / pointer
- Desktop: mouse + optional keyboard

Do NOT create separate movement systems.

---

## Camera Rules

Exploration camera:

- Orbit style.
- Smooth damping.
- Mobile-friendly rotation.

Camera should feel calm, not aggressive.

---

## File Organization Standards

public/assets/

  avatars/
    base character models (.glb)

  animations/
    idle.fbx
    walk.fbx
    emotes...

---

## Performance Targets

Mobile first:

- Low poly stylization preferred.
- Minimal draw calls.
- Avoid heavy post-processing.
- Load assets progressively.

---

## Development Order (DO NOT SKIP)

1. Rendering stability
2. Character loading
3. Animation pipeline
4. Camera feel
5. Movement
6. Multiplayer sync
7. Cosmetics / unlockables
8. Events system

---

## AI Collaboration Rules

When generating code:

- provide full file replacements
- avoid partial patches
- preserve existing architecture
- prioritize clarity over cleverness

---

## Long-Term Vision

A modular social creative studio that expands through
community events and unlockable spaces.
