import { createServer } from "node:http";
import { Server } from "socket.io";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "127.0.0.1";

const WORLD = { w: 1400, h: 900 };
const PLAYER_PADDING = 40;
const PLAYER_SPEED = 185;
const TICK_MS = 50;

const ALLOWED_EMOTES = new Set(["wave", "heart", "sparkle", "laugh"]);

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:4173",
      "http://127.0.0.1:4173"
    ]
  }
});

const players = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeIntent(ix, iy) {
  const x = Number.isFinite(ix) ? ix : 0;
  const y = Number.isFinite(iy) ? iy : 0;
  const length = Math.hypot(x, y);

  if (length <= 0.0001) {
    return { x: 0, y: 0 };
  }

  if (length <= 1) {
    return { x, y };
  }

  return { x: x / length, y: y / length };
}

function toPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    anim: player.anim
  };
}

io.on("connection", (socket) => {
  socket.on("join", (payload = {}) => {
    const existing = players.get(socket.id);

    const name =
      typeof payload.name === "string" && payload.name.trim().length > 0
        ? payload.name.trim().slice(0, 24)
        : "Guest";

    const color = typeof payload.color === "string" && payload.color.length > 0 ? payload.color : "#F4B6C2";

    const client =
      payload.client && typeof payload.client === "object"
        ? {
            platform:
              typeof payload.client.platform === "string" && payload.client.platform.length > 0
                ? payload.client.platform
                : "unknown",
            version:
              typeof payload.client.version === "string" && payload.client.version.length > 0
                ? payload.client.version
                : "unknown"
          }
        : { platform: "unknown", version: "unknown" };

    const base = existing || {
      id: socket.id,
      x: WORLD.w / 2 + Math.random() * 40 - 20,
      y: WORLD.h / 2 + Math.random() * 40 - 20,
      ix: 0,
      iy: 0,
      vx: 0,
      vy: 0,
      anim: "idle"
    };

    const player = {
      ...base,
      id: socket.id,
      name,
      color,
      client,
      joinedAt: Date.now(),
      lastIntentAt: Date.now()
    };

    players.set(socket.id, player);
    socket.join("studio");

    socket.emit("welcome", {
      selfId: socket.id,
      world: WORLD,
      players: Array.from(players.values()).map(toPublicPlayer)
    });

    socket.to("studio").emit("player_joined", toPublicPlayer(player));
  });

  socket.on("intent", ({ ix, iy } = {}) => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    const normalized = normalizeIntent(ix, iy);

    player.ix = normalized.x;
    player.iy = normalized.y;
    player.lastIntentAt = Date.now();
  });

  socket.on("emote", ({ type } = {}) => {
    const player = players.get(socket.id);
    if (!player || !ALLOWED_EMOTES.has(type)) {
      return;
    }

    io.to("studio").emit("emote", {
      id: socket.id,
      type,
      ts: Date.now()
    });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.to("studio").emit("player_left", { id: socket.id });
  });
});

setInterval(() => {
  const dt = TICK_MS / 1000;

  for (const player of players.values()) {
    player.vx = player.ix * PLAYER_SPEED;
    player.vy = player.iy * PLAYER_SPEED;

    player.x = clamp(player.x + player.vx * dt, PLAYER_PADDING, WORLD.w - PLAYER_PADDING);
    player.y = clamp(player.y + player.vy * dt, PLAYER_PADDING, WORLD.h - PLAYER_PADDING);

    player.anim = Math.hypot(player.vx, player.vy) > 8 ? "walk" : "idle";
  }

  io.to("studio").emit("state", {
    players: Array.from(players.values()).map(toPublicPlayer)
  });
}, TICK_MS);

httpServer.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});
