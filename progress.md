Original prompt: Create a plan to... develop this game further

## 2026-02-27 - Foundation kickoff
- Confirmed active entrypoint is client/src/main.jsx -> App.jsx.
- Confirmed server already exposes join/intent/state/emote/player_left channels.
- Started implementation of 3D mobile-first multiplayer vertical slice.
- Next: replace App.jsx with unified local controls, networked players, emotes, and test hooks.

## 2026-02-27 - Core implementation
- Replaced client/src/App.jsx with a 3D multiplayer lobby implementation.
- Added unified input flow (keyboard + touch joystick) and start screen UX.
- Added quick emote controls (desktop keys 1-4 + mobile buttons).
- Added deterministic test hooks: window.render_game_to_text and window.advanceTime.
- Added reusable shared modules: client/src/game/constants.js, emotes.js, math.js.
- Updated server authoritative loop with richer state payloads: vx, vy, anim.
- Extended join payload handling with client metadata and emote timestamp support.
- Converted StudioGame into a lightweight legacy reference module to avoid split runtime paths.

## 2026-02-27 - Validation and hardening
- Fixed runtime boot failure caused by React/@react-three version mismatch by aligning local client node_modules to React 18 + @react-three/fiber 8.
- Removed @react-three/drei usage from App to avoid missing transitive dependencies in offline environment.
- Added testability aids:
  - start button id: #start-btn
  - emote button ids: #emote-btn-*
  - touch test override query flag: ?touch=1
  - mobile joystick id: #mobile-joystick
- Improved deterministic stepping behavior by introducing a simulation clock so advanceTime-based tests drive intent timing consistently.

### Smoke artifacts
- Playwright skill client run: /tmp/mini-game-hub-smoke1
  - screenshots: shot-0.png, shot-1.png, shot-2.png
  - state dumps: state-0.json, state-1.json, state-2.json
  - no errors-*.json generated after fixes.

### Focused checks (Playwright one-off diagnostics)
- Desktop keyboard movement: self x position increased under ArrowRight hold.
- Two-client multiplayer: each client sees the other in others[] list.
- Cross-client emote propagation: client B observed client A emote = wave.
- Mobile touch drag simulation (?touch=1): self x position increased after joystick drag.

### Remaining TODOs
- Client lockfile is still stale vs package.json because offline install could not fetch uncached packages.
- Replace temporary node_modules alignment with a clean install when network access is available.
- Improve scene readability (currently very dark) and add stronger visual differentiation for remote avatars/emote badges.

### Additional acceptance checks completed
- Reconnect/resilience check: refreshing one client preserved exactly one remote entry on the other client (no duplicate players).
- Keyboard movement and animation check: ArrowRight produced increased x, non-zero vx during movement, and anim='walk'.
- Emote UI check: number-key emote from client A propagated to client B others[].emote.

## 2026-02-27 - Asset wiring request
- Confirmed avatar asset pipeline now explicitly loads these files:
  - /assets/avatars/toy_base.glb
  - /assets/animations/idle.fbx
  - /assets/animations/walk.fbx
  - /assets/animations/wave.fbx
- Added wave clip loading and bound it to the in-game wave emote animation state.
- Wave emote now overrides locomotion animation state while active (render_game_to_text anim reports "wave").
- Added clip guards for missing idle/walk/wave animation data.

### Verification
- Client build passes after asset changes (`npm run build`).
- Playwright skill smoke run completed: /tmp/mini-game-hub-smoke-wave (no errors-*.json).
- Focused emote check via `#emote-btn-wave` showed state transition:
  - before: anim=idle
  - during: anim=wave, emote=wave
- Browser error capture during load + wave trigger returned no errors.
