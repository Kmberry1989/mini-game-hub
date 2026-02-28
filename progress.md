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

## 2026-02-27 - More FBX usage (mobile focused)
- Expanded animation loading to use additional FBX files (with graceful fallbacks):
  - run.fbx, happy.fbx, sparkle.fbx, laugh.fbx, bored.fbx, yawn.fbx
  - existing: idle.fbx, walk.fbx, wave.fbx
- Added animation mapping logic:
  - Movement: walk vs run based on input speed/intensity.
  - Emotes: wave/heart/sparkle/laugh now map to dedicated clips.
  - Idle variants: bored and yawn trigger after idle time.
- Updated server authoritative animation state to emit run/walk/idle.
- Improved mobile UX for action buttons:
  - Larger 2x2 emote grid near thumb zone on coarse pointers.

### Verification artifacts
- Skill smoke run: /tmp/mini-game-hub-smoke-mobile-fbx-2 (no errors-*.json).
- Mobile action screenshot: /tmp/mini-game-hub-mobile-fbx-actions.png
- Deterministic state checks (using window.advanceTime) confirmed:
  - idle -> bored -> yawn transitions
  - run, wave, heart, sparkle, laugh animation states

## 2026-02-27 - Toy base visibility + mobile readability pass
- Investigated `toy_base.glb` fit issue causing either invisible avatar or oversized geometry.
- Confirmed GLB includes an armature root with internal scale (`0.01`), so naive global fit scaling over-expanded the mesh.
- Tuned avatar render path to use calibrated model scale and grounded placement.
- Added material normalization for visibility on dark scene:
  - disabled problematic transparency blending
  - added emissive tint/intensity for local/remote readability
- Added a ground ring indicator under each avatar to improve mobile tracking.
- Retained contextual action system and mobile-specific action button layout.
- Added procedural action posing (walk/run/emotes/context actions) so movement/emote states remain visibly expressive when direct FBX retargeting is unstable for this rig.

### Verification
- Client build passes (`npm run build`).
- Desktop + mobile smoke captures show avatar visible in-scene:
  - /tmp/mini-game-hub-visibility-desktop/shot-0.png
  - /tmp/mini-game-hub-visibility-mobile/shot-0.png
- No `errors-*.json` emitted in latest smoke runs.
- Upright orientation fix: changed avatar import axis correction to `clonedModel.rotation.x = -Math.PI / 2` so `toy_base.glb` stands upright in the scene.
- Verified in fresh desktop + mobile screenshots:
  - /tmp/mini-game-hub-upright-negx/shot-0.png
  - /tmp/mini-game-hub-upright-negx-mobile/shot-0.png

## 2026-02-27 - FBX rig drive + facing correction
- Adjusted avatar facing baseline by setting model yaw offset to `0` so movement-facing no longer appears reversed.
- Replaced clip sanitization with `prepareClipForModel(...)`:
  - keeps quaternion tracks from your FBX clips
  - keeps controlled `mixamorigHips.position` Y motion (zeros X/Z root drift) so clips visibly affect the rig without network/world drift
- Added looping vs one-shot clip behavior:
  - looping: idle/walk/run/happywalk/bored/yawn
  - one-shot: wave/heart/sparkle/laugh/jump/pickup/openlid/sittingvictory
- Stabilized avatar sizing by fitting against largest model extent (not Y-only), then grounding to floor.
- Kept procedural posing as fallback only when no playable FBX rig action is available.

### Verification
- Client build passes (`npm run build`).
- Server syntax check passes (`node --check server/src/index.js`).
- Asset-level loader check confirms prepared clips are generated from FBX with hip position + quaternion tracks for idle/walk/wave/jump/pickup.

### Environment note
- The local Playwright skill client cannot reach `http://127.0.0.1:5173` from this execution environment (`ERR_CONNECTION_REFUSED`), so screenshot-based smoke verification for this patch needs to be run on the host session.

## 2026-02-27 - Avatar scale reduction
- Reduced `TARGET_AVATAR_HEIGHT` from `1.05` to `0.55` in `client/src/App.jsx` so the player avatar reads smaller relative to the lobby.
- Reduced `TARGET_AVATAR_HEIGHT` again from `0.55` to `0.24` so avatar max extent is well below wall height and no longer dominates the room.
- Switched avatar fit bounds to precise skinned bounds (`Box3.setFromObject(model, true)`), which uses bone-transformed mesh vertices. This addresses giant-avatar cases where non-precise bounds under-report size for skinned meshes.

## 2026-02-27 - Larger room + far camera pullback
- Increased authoritative world size to `2800x1800`:
  - client default world: `client/src/game/constants.js`
  - server world: `server/src/index.js`
- Moved the gameplay camera much farther back for a broad-room view:
  - updated follow camera target offsets and initial canvas camera position in `client/src/App.jsx`
  - new follow offset approx: `+8.5 x`, `+10.8 y`, `+14.2 z`

## 2026-02-27 - Character selection + multi-avatar loading
- Replaced single-avatar loading with multi-avatar support:
  - added character roster from `client/public/assets/avatars/*.glb`
  - added helper mapping from character IDs to GLB + `char select` card art
  - animation clips remain shared, avatar scene loading is now per selected model
- Added two-tap character select flow on start overlay:
  - first tap on a card magnifies the selection and opens a 3D preview
  - second tap on the same card confirms selection and enters gameplay
  - kept a confirm button (`#start-btn`) as fallback once a card is selected
- Added selection screen visuals using `char select` assets:
  - character card images from `client/public/assets/char select/*.png`
  - transparent effect overlays using `HOVERED.png` and `SELECTED.png`
- Added animated 3D preview panel for selected character in the selection screen.
- Extended multiplayer player payloads with `avatar`:
  - client sends chosen avatar ID in `join`
  - server validates/stores avatar ID and includes it in `welcome`, `player_joined`, and `state` player payloads
  - clients render local and remote players with their chosen avatar models

### Verification
- Client build passes (`npm run build`).
- Server syntax check passes (`node --check server/src/index.js`).

## 2026-02-27 - Giant avatar correction for new character GLBs
- Reduced in-world avatar target extent from `0.24` to `0.16`.
- Fixed scale fitting floor by allowing very small fit scales (`MIN_AVATAR_SCALE = 0.01`) so large avatar files can shrink correctly.
- Reworked bounds fitting to use renderable mesh bounds only (`getRenderableBounds`) before scaling and grounding, instead of full object bounds.
- Applied the same robust fit helper to character preview models.

## 2026-02-27 - Fallback-avatar robustness
- Added `loadAvatarBundleWithFallback(...)` in client avatar loader:
  - if selected avatar GLB fails, retry with default avatar GLB before showing fallback sphere.
- Updated both in-game avatars and character preview to use this fallback-aware loader.
- Fixed root package scripts so dev/build run in their actual package directories:
  - `dev:client` now runs `cd client && npm run dev`
  - `dev:server` now runs `cd server && npm run dev`
  - `build:client` now runs `cd client && npm run build`

## 2026-02-27 - Twisted non-idle pose mitigation
- Enabled a rig-safe animation mode for heterogeneous character GLBs:
  - FBX rig playback is restricted to `idle` clip only.
  - Non-idle states (walk/run/emotes/context actions) now use procedural pose fallback to avoid bone twisting artifacts.
- Added runtime check to apply procedural pose whenever the current desired state has no safe rig clip.

### Verification
- Client build passes (`npm run build:client`).
- Playwright smoke (autostart) for wave emote:
  - output dir: `/tmp/mini-game-hub-smoke-twist-wave`
  - `state-0.json` reported `self.anim = "wave"` and no `errors-*.json` file was emitted.
  - `shot-0.png` / `shot-1.png` show the local avatar upright and stable during/after emote.
- Playwright smoke (autostart) for movement pose:
  - output dir: `/tmp/mini-game-hub-smoke-twist-walk`
  - no `errors-*.json` file was emitted.
  - `shot-0.png` / `shot-1.png` show the local avatar upright with no bone-twist deformation.

## 2026-02-28 - Full FBX re-enabled + click-to-move
- Re-enabled all loaded FBX clips for runtime mixer playback by broadening safe clip keys to include all animation keys.
- Added click/tap-to-move in-world navigation:
  - new transparent pointer capture surface in the scene
  - click/tap on floor sets a move target marker
  - local intent auto-steers toward target until within stop radius
  - manual keyboard/joystick input cancels active click-move target
- Extended `render_game_to_text` payload with `moveTarget` to improve deterministic test visibility.

### Verification
- Client build passes (`npm run build:client`).
- Click-to-move smoke run:
  - output dir: `/tmp/mini-game-hub-click-move`
  - `state-0.json` -> `state-2.json` show increasing `self.x/self.y`, non-zero `vx/vy`, and populated `moveTarget`.
  - no `errors-*.json` file emitted.
- Wave emote smoke run with all-FBX mode:
  - output dir: `/tmp/mini-game-hub-all-fbx-wave`
  - `state-0.json` reports `self.anim = "wave"` and `emote = "wave"`.

### Note
- With all-FBX playback enabled, some non-idle clips can still produce visible rig twisting on current character GLBs, indicating retarget mismatch remains unresolved.

## 2026-02-28 - Environmental lighting pass
- Added a dedicated `EnvironmentalLighting` scene component in `client/src/App.jsx` with:
  - scene fog for depth separation
  - hemisphere sky/ground light for ambient environmental fill
  - warm key directional light with shadows
  - cool rim directional light
  - two corner point lights for subtle color contrast and room atmosphere
- Replaced prior minimal ambient/directional/point setup with the new environmental rig in the gameplay canvas.

### Verification
- Client build passes (`npm run build:client`).
- Playwright smoke lighting capture:
  - output dir: `/tmp/mini-game-hub-lighting-pass`
  - screenshot: `/tmp/mini-game-hub-lighting-pass/shot-0.png`
  - no `errors-*.json` file emitted.

## 2026-02-28 - Alpha backend + client integration (auth, progression, quests, voice contracts)
- Server refactor:
  - Replaced `server/src/index.js` with Express + Socket.IO unified server implementing:
    - Feature flags (`auth_v1`, `quests_v1`, `economy_v1`, `voice_v1`, `guestFallback`)
    - Auth endpoints:
      - `POST /api/auth/signup`
      - `POST /api/auth/login`
      - `POST /api/auth/refresh`
      - `POST /api/auth/logout`
    - Profile/quest/voice endpoints:
      - `GET /api/profile/me`
      - `POST /api/profile/avatar`
      - `POST /api/profile/equip`
      - `GET /api/quests/active`
      - `POST /api/voice/token` (LiveKit token when configured)
    - Extended socket contract:
      - `join` accepts `{ authToken, roomId, client, ... }`
      - `welcome` includes `{ profile, progression, quests, roomVoiceEnabled }`
      - emits `quest_progress`, `currency_grant`, `unlock_grant`, `voice_presence`
    - Room support with cap (`MAX_ROOM_PLAYERS = 12`) and room-scoped state broadcasts.
  - Added quest + unlock content model in `server/src/game/content.js`:
    - starter questline + daily rotation selection
    - unlock track tiers and rewards
  - Added persistent file-backed store in `server/src/data/store.js`:
    - users, profiles, refresh tokens, user quests, unlocks, currency ledger, idempotent grant history, abuse reports.
  - Added PostgreSQL reference migration:
    - `server/migrations/001_alpha_schema.sql`
- Server dependencies expanded in `server/package.json`:
  - `express`, `bcryptjs`, `jsonwebtoken`, `livekit-server-sdk`, `pg`, `uuid`.

- Client integration:
  - Added API utility module `client/src/game/api.js`:
    - auth/session storage + profile/avatar/voice requests.
  - Updated `client/src/App.jsx`:
    - Auth UI on character selection screen (login/signup/guest)
    - Session bootstrap from local storage with refresh flow
    - Authenticated socket join payload with `authToken` and `roomId`
    - Welcome payload handling for profile/progression/quests/voice-enabled
    - Real-time handlers for `quest_progress`, `currency_grant`, `unlock_grant`, `voice_presence`
    - In-game progression + quest panel UI
    - Voice controls UI (join/mute/deafen/PTT/talk), quick report + local block list
    - `render_game_to_text` now includes auth/progression/quests/voice snapshots.

### Verification
- Build/syntax:
  - Client build passes: `npm run build:client`
  - Server syntax passes: `node --check server/src/index.js`
- API checks (local):
  - `/api/health` returns enabled features
  - signup/login/profile/avatar/quests/refresh all return success codes
  - `/api/voice/token` returns `503 voice_not_configured` when LiveKit env vars are absent (expected)
- Playwright smoke:
  - start/auth screen: `/tmp/mini-game-hub-alpha-start`
  - gameplay screen: `/tmp/mini-game-hub-alpha-play`
  - no `errors-*.json` artifacts emitted
- Interactive browser check (Playwright MCP):
  - login with existing account succeeds
  - entering room shows authenticated identity and starter quest completion grant (`+20 stars`, `+35 xp`) reflected in UI.

### Remaining TODOs / follow-up
- Current voice path is signaling + token-ready UI; real media transport (full LiveKit client connect/publish/subscription + true distance attenuation) still needs implementation.
- Persistence currently uses file-backed store for immediate functionality; PostgreSQL adapter and migration runner are not yet wired as runtime default.
- FBX per-avatar retarget compatibility matrix from Week 1 remains unfinished.
- Added `server/data/.gitignore` so generated runtime state (`state.json`) is not committed.
- Final regression smoke reruns:
  - `/tmp/mini-game-hub-alpha-final-start`
  - `/tmp/mini-game-hub-alpha-final-play`
  - both runs produced no `errors-*.json` artifacts.

## 2026-02-28 - Runtime fix + animation stability pass
- Fixed a runtime ordering bug in `client/src/App.jsx` where the socket lifecycle effect referenced `disconnectVoiceTransport` before initialization (TDZ risk).
  - Replaced socket cleanup voice disconnect call with an inline ref-safe cleanup block.
  - Removed `disconnectVoiceTransport` from that effect dependency array.
- Added FBX stability guard in `prepareClipForModel`:
  - Root hips quaternion (`mixamorigHips`) now clamps extreme pitch/roll to avoid collapse/twist spikes during non-idle clips.
- Verification
  - `npm run build:client` passes.
  - `node --check server/src/index.js` passes.
  - Playwright smoke run: `/tmp/mini-game-hub-alpha-current-1` (pre-fix repro) and `/tmp/mini-game-hub-alpha-current-2` (post-fix).
  - Post-fix screenshot/state confirms entry to gameplay, click-to-move, and upright movement pose in previously failing path.
- Remaining TODOs
  - Implement per-avatar clip compatibility matrix (server/content + client) so unstable clips are auto-fallbacked per character instead of relying only on root clamp.
  - Add an explicit automated smoke step that triggers at least one non-idle emote clip per run and validates pose constraints in `render_game_to_text` (e.g., no NaN, no extreme root tilt markers).

## 2026-02-28 - Mini-games + studio zoning + adaptive lighting
- Implemented server-authoritative social mini-game runtime with one-room zones.
- Added zone and mini-game content definitions in `server/src/game/content.js`:
  - `STUDIO_ZONES` (stage/workshop/lounge/gallery/walkway)
  - `MINI_GAME_DEFS` for `emote_echo_circle`, `prop_relay_bench`, and `glow_trail_walk`
  - new daily quest types: `minigame_participation`, `minigame_combo`, `minigame_completion`.
- Extended `server/src/index.js`:
  - `welcome` now includes `zones` and `miniGames`
  - `state.players[]` now includes `zoneId`
  - new socket events emitted: `minigame_state`, `minigame_action_result`, `minigame_reward`, `zone_presence`
  - added room mini-game runtime, zone presence tracking, per-room cleanup, and idempotent mini-game rewards.
- Added client zone/lighting helper module: `client/src/game/zones.js`.
- Extended `client/src/App.jsx`:
  - new client state for zones, zone presence, mini-game states, and lighting presets (`low|medium|high`)
  - auto lighting preset selection + startup FPS downshift in auto mode
  - manual lighting override controls in HUD
  - scene now uses zone-aware world dressing and active mini-game lighting accents
  - `render_game_to_text()` now includes `miniGames`, `zones`, and `lightingPreset`.

### Verification
- Server syntax: `node --check server/src/index.js` passes.
- Client build: `npm run build:client` passes.
- Playwright smoke (isolated ports 3010/5176):
  - `/tmp/mini-game-hub-zones-smoke-2`
  - `/tmp/mini-game-hub-zones-smoke-3`
  - no `errors-*.json` artifacts.
- Text-state snapshots confirm new fields are present and populated:
  - `miniGames[]` (with prompt/combo/progress)
  - `zones[]`
  - `lightingPreset`.

### Remaining TODOs / follow-up
- Add richer zone props/decals/labels (current pass is geometry-first and marker-led).
- Add stricter automated smoke that drives guaranteed zone-entry + mini-game success paths (current deterministic script validates event presence/state shape and gameplay stability, but not every reward path in one run).
- Tune mini-game cadence and reward values with multiplayer QA.

## 2026-02-28 - Mini-game visual pass follow-up (avatar stability)
- Fixed oversized-avatar regression introduced by prior scaling experiments:
  - `TARGET_AVATAR_HEIGHT` raised to `1.06` and in-world multiplier normalized to `1`.
  - Added hard scale ceiling `MAX_AVATAR_SCALE = 24`.
  - Added post-fit extent guard in `fitModelToTargetExtent(...)` to re-correct extreme under/oversize mesh bounds.
- Added runtime FBX compatibility fallback path for current character roster:
  - Introduced high-risk clip blocklist (`heart`, `sparkle`, `laugh`, `jump`, `pickup`, `openlid`, `sittingvictory`, `happywalk`) for rig playback.
  - These actions still resolve to the same gameplay animation states but now use the procedural fallback path to prevent collapse/twist.
- Improved avatar instancing wiring:
  - `AvatarEntity` now receives `avatarId` explicitly and uses avatar-aware clip compatibility selection.
- Reduced zone/readout mismatch on local player:
  - Local simulation no longer overwrites an authoritative non-null `zoneId` each frame.

### Verification (post-fix)
- Build:
  - `npm run build:client` passes.
- Playwright skill client runs:
  - idle baseline: `/tmp/mini-game-hub-zones-idle-2`
  - zone entry + echo activity: `/tmp/mini-game-hub-zones-verify-zone`
  - jump/happywalk stress path: `/tmp/mini-game-hub-zones-verify-jumphappy`
  - no `errors-*.json` artifacts in these runs.
- State checks confirm:
  - `zones`, `miniGames`, and `lightingPreset` remain present in `render_game_to_text`.
  - click-to-move path sets `moveTarget` and drives stage entry (`zones.stage.players` includes local id).
  - active mini-game HUD and zone lighting continue updating during movement/action bursts.

### Remaining TODOs / follow-up
- Finish per-avatar clip compatibility matrix (instead of current conservative runtime blocklist).
- Add deterministic smoke sequence that forces successful `emote_echo_circle`, `prop_relay_bench`, and `glow_trail_walk` reward grants in one scripted run.
