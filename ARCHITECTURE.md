# Architecture Overview

## Separation of concerns

### Client
Handles:

- rendering
- animation
- camera
- input
- interpolation

### Server
Handles:

- authoritative state
- player positions
- room membership
- event triggers

Server never renders.

---

## Multiplayer Strategy

Server authoritative:

- client sends intent
- server simulates
- client interpolates

Goal:

smooth floaty motion.

---

## Animation System

AnimationMixer per avatar.

State-based transitions:

idle -> walk -> emote.

Animations loaded separately from model.

---

## Camera System

Exploration orbit camera.

Future:

- camera focus on player
- shared event focus mode
