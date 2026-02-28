# Mini Game Hub

Cozy multiplayer 3D social space.

## Goals

- Exploration-based social environment
- Art-toy characters
- Mobile-first interaction
- Modular expandable world

## Tech

Client:
- React
- Three.js
- React Three Fiber

Server:
- Node
- Socket.io

## Install

### Server
cd server
npm install
npm run dev

### Client
cd client
npm install
npm run dev

## Current Stage

- 3D renderer setup
- camera exploration
- avatar pipeline (Mixamo-ready)
- auth/profile/quest backend (alpha slice)
- progression + quest UI overlays
- voice signaling/token contract (LiveKit-ready)
- one-room social mini-game zones (stage/workshop/lounge/gallery/walkway)
- server-authoritative mini-game loops (emote echo, prop relay, glow trail)
- adaptive mobile lighting presets with in-game override

## Alpha Server Environment

Optional environment variables for `server/src/index.js`:

- `ACCESS_TOKEN_SECRET` (recommended in non-dev environments)
- `ACCESS_TOKEN_TTL` (default `15m`)
- `REFRESH_TOKEN_DAYS` (default `30`)
- `FEATURE_AUTH_V1` (`true`/`false`)
- `FEATURE_QUESTS_V1` (`true`/`false`)
- `FEATURE_ECONOMY_V1` (`true`/`false`)
- `FEATURE_VOICE_V1` (`true`/`false`)
- `FEATURE_GUEST_FALLBACK` (`true`/`false`)
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `LIVEKIT_URL`

Server persistence defaults to `server/data/state.json` for local development.
PostgreSQL reference schema is provided at `server/migrations/001_alpha_schema.sql`.
