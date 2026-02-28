import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { AccessToken as LiveKitAccessToken } from "livekit-server-sdk";
import { Server } from "socket.io";
import { FileBackedStore, hashToken } from "./data/store.js";
import {
  ALLOWED_AVATARS,
  ALLOWED_EMOTES,
  DEFAULT_AVATAR,
  DEFAULT_ROOM_ID,
  MAX_ROOM_PLAYERS,
  MINI_GAME_DEFS,
  PLAYER_PADDING,
  PLAYER_SPEED,
  STUDIO_ZONES,
  TICK_MS,
  UNLOCK_TRACK,
  WORLD,
  dayStamp,
  getActiveQuestDefs,
  getZoneIdAtPosition,
  getUnlockDefById
} from "./game/content.js";

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "127.0.0.1";

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "15m";
const REFRESH_TOKEN_DAYS = Number(process.env.REFRESH_TOKEN_DAYS || 30);

const ACCESS_TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev-access-secret-change-me";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "";

function parseFeatureFlag(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const lowered = String(value).toLowerCase();
  return ["1", "true", "yes", "on"].includes(lowered);
}

const FEATURES = {
  auth_v1: parseFeatureFlag("FEATURE_AUTH_V1", true),
  quests_v1: parseFeatureFlag("FEATURE_QUESTS_V1", true),
  economy_v1: parseFeatureFlag("FEATURE_ECONOMY_V1", true),
  voice_v1: parseFeatureFlag("FEATURE_VOICE_V1", true),
  guestFallback: parseFeatureFlag("FEATURE_GUEST_FALLBACK", true)
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const store = new FileBackedStore(path.join(__dirname, "../data/state.json"));
await store.init();

const app = express();
app.use(express.json({ limit: "256kb" }));

const allowedOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173"
]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  next();
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: Array.from(allowedOrigins)
  }
});

const players = new Map();
const userSocketIds = new Map();
const roomMiniGames = new Map();

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

function normalizeRoomId(value) {
  const fallback = DEFAULT_ROOM_ID;
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) {
    return fallback;
  }
  return raw.replace(/[^a-z0-9-_]/g, "").slice(0, 40) || fallback;
}

function normalizeAvatar(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ALLOWED_AVATARS.has(normalized) ? normalized : DEFAULT_AVATAR;
}

function normalizeColor(value) {
  if (typeof value !== "string") {
    return "#F4B6C2";
  }
  const cleaned = value.trim();
  return cleaned || "#F4B6C2";
}

function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      displayName: user.displayName
    },
    ACCESS_TOKEN_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function verifyAccessToken(rawToken) {
  try {
    return jwt.verify(rawToken, ACCESS_TOKEN_SECRET);
  } catch {
    return null;
  }
}

function parseAuthBearer(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice("Bearer ".length).trim();
}

function authRequired(req, res, next) {
  if (!FEATURES.auth_v1) {
    res.status(503).json({ error: "auth_v1_disabled" });
    return;
  }

  const token = parseAuthBearer(req);
  if (!token) {
    res.status(401).json({ error: "missing_auth_token" });
    return;
  }

  const payload = verifyAccessToken(token);
  if (!payload?.sub) {
    res.status(401).json({ error: "invalid_auth_token" });
    return;
  }

  const user = store.findUserById(payload.sub);
  if (!user) {
    res.status(401).json({ error: "user_not_found" });
    return;
  }

  req.authToken = token;
  req.authPayload = payload;
  req.user = user;
  next();
}

function createRefreshTokenForUser(userId, rotatedFrom = null) {
  const refreshToken = randomBytes(48).toString("hex");
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  store.createRefreshToken({
    userId,
    tokenHash,
    expiresAt,
    rotatedFrom
  });

  return { refreshToken, expiresAt };
}

function summarizeProfile(user, profile) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatar: profile.selectedAvatar,
    createdAt: user.createdAt
  };
}

function summarizeProgression(profile, unlockRows) {
  return {
    level: profile.level,
    xp: profile.xpTotal,
    stars: profile.starsBalance,
    unlocks: unlockRows.map((row) => row.unlockId),
    equipped: profile.equipped
  };
}

function ensureActiveQuestsForUser(userId, inputDate = new Date()) {
  const cycleStamp = dayStamp(inputDate);
  const activeDefs = getActiveQuestDefs(inputDate);
  const questStates = [];

  for (const questDef of activeDefs) {
    const expectedCycle = questDef.isDaily ? cycleStamp : "static";
    const existing = store.findQuestState(userId, questDef.id);

    if (!existing) {
      const created = {
        userId,
        questId: questDef.id,
        status: "active",
        value: 0,
        target: questDef.target,
        cycle: expectedCycle,
        completedAt: null,
        claimedAt: null,
        updatedAt: new Date().toISOString()
      };
      questStates.push(store.upsertQuestState(created));
      continue;
    }

    if (existing.cycle !== expectedCycle) {
      const reset = {
        ...existing,
        status: "active",
        value: 0,
        target: questDef.target,
        cycle: expectedCycle,
        completedAt: null,
        claimedAt: null,
        updatedAt: new Date().toISOString()
      };
      questStates.push(store.upsertQuestState(reset));
      continue;
    }

    questStates.push(existing);
  }

  return activeDefs.map((questDef) => {
    const state = questStates.find((row) => row.questId === questDef.id) || store.findQuestState(userId, questDef.id);

    return {
      id: questDef.id,
      key: questDef.key,
      title: questDef.title,
      type: questDef.type,
      target: questDef.target,
      value: state?.value || 0,
      status: state?.status || "active",
      isDaily: questDef.isDaily,
      cycle: state?.cycle || (questDef.isDaily ? cycleStamp : "static"),
      rewards: questDef.rewards,
      config: questDef.config || null
    };
  });
}

function getQuestDefById(questId) {
  return getActiveQuestDefs(new Date()).find((quest) => quest.id === questId) || null;
}

function emitToUser(userId, eventName, payload) {
  const socketIds = userSocketIds.get(userId);
  if (!socketIds || !socketIds.size) {
    return;
  }

  for (const socketId of socketIds.values()) {
    io.to(socketId).emit(eventName, payload);
  }
}

function applyUnlockTrackRewards(userId) {
  const profile = store.getProfileByUserId(userId);
  if (!profile) {
    return;
  }

  for (const tier of UNLOCK_TRACK) {
    if (profile.xpTotal < tier.xpThreshold) {
      continue;
    }

    const grantKey = `unlock-track:${tier.tier}`;
    const remembered = store.rememberGrantKey(userId, grantKey);
    if (!remembered) {
      continue;
    }

    for (const reward of tier.rewards) {
      if (reward.type === "stars") {
        const result = store.appendCurrencyLedger({
          userId,
          delta: reward.amount,
          source: "unlock_track",
          sourceRef: String(tier.tier)
        });
        if (result) {
          emitToUser(userId, "currency_grant", {
            amount: reward.amount,
            source: "unlock_track",
            balance: result.balance
          });
        }
      }

      if (reward.type === "unlock") {
        const granted = store.grantUnlock(userId, reward.unlockId, "unlock_track");
        if (granted) {
          const unlockDef = getUnlockDefById(reward.unlockId);
          emitToUser(userId, "unlock_grant", {
            unlockId: reward.unlockId,
            category: unlockDef?.category || "unknown"
          });
        }
      }
    }
  }
}

function applyQuestRewardIfNeeded({ userId, questDef, questState }) {
  const grantKey = `quest:${questDef.id}:${questState.cycle}:completed`;
  const remembered = store.rememberGrantKey(userId, grantKey);
  if (!remembered) {
    return;
  }

  const stars = Number(questDef.rewards?.stars || 0);
  const xp = Number(questDef.rewards?.xp || 0);

  if (FEATURES.economy_v1 && stars > 0) {
    const result = store.appendCurrencyLedger({
      userId,
      delta: stars,
      source: "quest",
      sourceRef: questDef.id
    });
    if (result) {
      emitToUser(userId, "currency_grant", {
        amount: stars,
        source: "quest",
        balance: result.balance
      });
    }
  }

  if (xp > 0) {
    store.addXp(userId, xp);
  }

  applyUnlockTrackRewards(userId);
}

function applyQuestDelta(userId, questType, delta, options = {}) {
  if (!FEATURES.quests_v1 || !userId) {
    return;
  }

  const activeQuests = ensureActiveQuestsForUser(userId, new Date());

  for (const quest of activeQuests) {
    if (quest.type !== questType) {
      continue;
    }

    if (questType === "emote_near_player") {
      const expectedEmote = quest.config?.emote;
      if (expectedEmote && expectedEmote !== options.emote) {
        continue;
      }
      if (!options.nearbySatisfied) {
        continue;
      }
    }

    if (questType === "visit_zone") {
      const zone = quest.config?.zone;
      if (!zone || typeof options.x !== "number" || typeof options.y !== "number") {
        continue;
      }
      const distance = Math.hypot(zone.x - options.x, zone.y - options.y);
      if (distance > Number(zone.radius || 120)) {
        continue;
      }
    }

    if (questType === "minigame_participation") {
      const expectedGameId = quest.config?.gameId;
      if (expectedGameId && expectedGameId !== "any" && expectedGameId !== options.gameId) {
        continue;
      }
    }

    if (questType === "minigame_combo") {
      const expectedGameId = quest.config?.gameId;
      const minCombo = Number(quest.config?.minCombo || 0);
      if (expectedGameId && expectedGameId !== "any" && expectedGameId !== options.gameId) {
        continue;
      }
      if (minCombo > 0 && Number(options.combo || 0) < minCombo) {
        continue;
      }
    }

    if (questType === "minigame_completion") {
      const expectedGameId = quest.config?.gameId;
      if (expectedGameId && expectedGameId !== "any" && expectedGameId !== options.gameId) {
        continue;
      }
    }

    const row = store.findQuestState(userId, quest.id);
    if (!row || row.status === "completed" || row.status === "claimed") {
      continue;
    }

    const nextValue = clamp(row.value + delta, 0, quest.target);
    const completed = nextValue >= quest.target;

    const nextRow = {
      ...row,
      value: nextValue,
      status: completed ? "completed" : "active",
      completedAt: completed ? row.completedAt || new Date().toISOString() : row.completedAt,
      updatedAt: new Date().toISOString()
    };

    store.upsertQuestState(nextRow);

    emitToUser(userId, "quest_progress", {
      questId: quest.id,
      objectiveId: "primary",
      value: nextValue,
      completed
    });

    if (completed) {
      applyQuestRewardIfNeeded({ userId, questDef: quest, questState: nextRow });
    }
  }
}

function toPublicPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    avatar: player.avatar,
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    anim: player.anim,
    zoneId: player.zoneId || null
  };
}

function listPlayersByRoom(roomId) {
  const items = [];
  for (const player of players.values()) {
    if (player.roomId === roomId) {
      items.push(player);
    }
  }
  return items;
}

function registerSocketForUser(userId, socketId) {
  if (!userSocketIds.has(userId)) {
    userSocketIds.set(userId, new Set());
  }
  userSocketIds.get(userId).add(socketId);
}

function unregisterSocketForUser(userId, socketId) {
  const set = userSocketIds.get(userId);
  if (!set) {
    return;
  }
  set.delete(socketId);
  if (!set.size) {
    userSocketIds.delete(userId);
  }
}

function countPlayersInRoom(roomId) {
  return listPlayersByRoom(roomId).length;
}

function getPublicZones() {
  return STUDIO_ZONES.map((zone) => ({
    id: zone.id,
    name: zone.name,
    type: zone.type,
    miniGameId: zone.miniGameId || null,
    bounds: zone.bounds
  }));
}

function createMiniGameRuntime(gameDef, now) {
  if (gameDef.id === "emote_echo_circle") {
    return {
      id: gameDef.id,
      zoneId: gameDef.zoneId,
      phase: "active",
      promptIndex: 0,
      prompt: gameDef.promptOrder?.[0] || "wave",
      combo: 0,
      progress: 0,
      participants: new Set(),
      responded: new Set(),
      promptExpiresAt: now + Number(gameDef.responseWindowMs || 1800),
      nextPromptAt: now + Number(gameDef.promptEveryMs || 4000),
      cycle: 1,
      awardedMilestones: new Set()
    };
  }

  if (gameDef.id === "prop_relay_bench") {
    return {
      id: gameDef.id,
      zoneId: gameDef.zoneId,
      phase: "active",
      promptIndex: 0,
      prompt: gameDef.sequence?.[0] || "pickup",
      streak: 0,
      combo: 0,
      progress: 0,
      participants: new Set(),
      deadlineAt: now + Number(gameDef.stepWindowMs || 2400),
      lastSuccessAt: now,
      cycle: 1,
      awardedMilestones: new Set()
    };
  }

  if (gameDef.id === "glow_trail_walk") {
    return {
      id: gameDef.id,
      zoneId: gameDef.zoneId,
      phase: "active",
      prompt: "reach_waypoint",
      combo: 0,
      progress: 0,
      participants: new Set(),
      waypointIndex: 0,
      requiresHappywalk: false,
      cycle: 1,
      completionCount: 0,
      touchedThisCycle: new Set()
    };
  }

  return {
    id: gameDef.id,
    zoneId: gameDef.zoneId,
    phase: "active",
    prompt: null,
    combo: 0,
    progress: 0,
    participants: new Set(),
    cycle: 1
  };
}

function createRoomMiniGameState(now = Date.now()) {
  const miniGames = new Map();
  for (const gameDef of MINI_GAME_DEFS) {
    miniGames.set(gameDef.id, createMiniGameRuntime(gameDef, now));
  }

  return {
    miniGames,
    lastZonePresenceHash: new Map()
  };
}

function ensureRoomMiniGameState(roomId, now = Date.now()) {
  if (!roomMiniGames.has(roomId)) {
    roomMiniGames.set(roomId, createRoomMiniGameState(now));
  }
  return roomMiniGames.get(roomId);
}

function toPublicMiniGameState(gameState) {
  const participantIds = Array.from(gameState.participants || []);

  return {
    id: gameState.id,
    zoneId: gameState.zoneId,
    phase: gameState.phase || "active",
    prompt: gameState.prompt || null,
    combo: Number(gameState.combo || 0),
    progress: Number(gameState.progress || 0),
    participants: participantIds,
    cycle: Number(gameState.cycle || 1),
    waypointIndex: Number(gameState.waypointIndex || 0),
    requiresHappywalk: Boolean(gameState.requiresHappywalk)
  };
}

function listPublicMiniGamesForRoom(roomId, now = Date.now()) {
  const roomState = ensureRoomMiniGameState(roomId, now);
  return Array.from(roomState.miniGames.values()).map(toPublicMiniGameState);
}

function awardMiniGameReward(player, gameId, sourceRef, stars, xp) {
  if (!player?.userId) {
    return;
  }

  const grantKey = `minigame:${gameId}:${sourceRef}`;
  if (!store.rememberGrantKey(player.userId, grantKey)) {
    return;
  }

  let balance = null;

  if (FEATURES.economy_v1 && Number(stars) > 0) {
    const result = store.appendCurrencyLedger({
      userId: player.userId,
      delta: Number(stars),
      source: "minigame",
      sourceRef: `${gameId}:${sourceRef}`
    });
    if (result) {
      balance = result.balance;
      emitToUser(player.userId, "currency_grant", {
        amount: Number(stars),
        source: "minigame",
        balance: result.balance
      });
    }
  }

  if (Number(xp) > 0) {
    store.addXp(player.userId, Number(xp));
  }

  applyUnlockTrackRewards(player.userId);
  const profile = store.getProfileByUserId(player.userId);

  emitToUser(player.userId, "minigame_reward", {
    id: gameId,
    playerId: player.id,
    stars: Number(stars) || 0,
    xp: Number(xp) || 0,
    sourceRef,
    balance: Number.isFinite(balance) ? balance : profile?.starsBalance ?? null,
    level: profile?.level ?? null,
    totalXp: profile?.xpTotal ?? null
  });
}

function updateRoomZonePresence(roomId, roomPlayers) {
  const roomState = ensureRoomMiniGameState(roomId, Date.now());
  const currentPresence = new Map();

  for (const zone of STUDIO_ZONES) {
    currentPresence.set(zone.id, []);
  }

  for (const player of roomPlayers) {
    const zoneId = getZoneIdAtPosition(player.x, player.y);
    player.zoneId = zoneId;
    if (zoneId && currentPresence.has(zoneId)) {
      currentPresence.get(zoneId).push(player.id);
    }
  }

  for (const [zoneId, ids] of currentPresence.entries()) {
    ids.sort();
    const hash = ids.join("|");
    const previousHash = roomState.lastZonePresenceHash.get(zoneId) || "";
    if (hash !== previousHash) {
      roomState.lastZonePresenceHash.set(zoneId, hash);
      io.to(roomId).emit("zone_presence", {
        zoneId,
        players: ids
      });
    }
  }
}

function handleEmoteEchoAction(roomId, gameDef, gameState, player, action, now) {
  if (player.zoneId !== gameDef.zoneId) {
    return false;
  }

  if (now > gameState.promptExpiresAt || action !== gameState.prompt) {
    io.to(roomId).emit("minigame_action_result", {
      id: gameDef.id,
      playerId: player.id,
      action,
      success: false,
      scoreDelta: 0,
      combo: gameState.combo
    });
    return true;
  }

  if (gameState.responded.has(player.id)) {
    return true;
  }

  gameState.responded.add(player.id);
  gameState.participants.add(player.id);
  gameState.combo += 1;
  gameState.progress = gameState.responded.size;

  io.to(roomId).emit("minigame_action_result", {
    id: gameDef.id,
    playerId: player.id,
    action,
    success: true,
    scoreDelta: 1,
    combo: gameState.combo
  });

  applyQuestDelta(player.userId, "minigame_participation", 1, { gameId: gameDef.id });

  for (const milestone of gameDef.rewardMilestones || []) {
    const marker = Number(milestone.combo || 0);
    if (!marker || gameState.combo < marker || gameState.awardedMilestones.has(marker)) {
      continue;
    }

    gameState.awardedMilestones.add(marker);
    applyQuestDelta(player.userId, "minigame_combo", 1, { gameId: gameDef.id, combo: marker });

    const rewardPlayers = listPlayersByRoom(roomId).filter((entry) => entry.zoneId === gameDef.zoneId);
    for (const rewardPlayer of rewardPlayers) {
      awardMiniGameReward(
        rewardPlayer,
        gameDef.id,
        `cycle:${gameState.cycle}:combo:${marker}:player:${rewardPlayer.id}`,
        milestone.stars,
        milestone.xp
      );
    }
  }

  return true;
}

function handlePropRelayAction(roomId, gameDef, gameState, player, action, now) {
  if (player.zoneId !== gameDef.zoneId) {
    return false;
  }

  const sequence = gameDef.sequence || [];
  const expected = sequence[gameState.promptIndex] || sequence[0] || "pickup";

  if (now > gameState.deadlineAt || action !== expected) {
    gameState.streak = Math.max(0, gameState.streak - 1);
    gameState.combo = gameState.streak;
    gameState.promptIndex = 0;
    gameState.prompt = sequence[0] || "pickup";
    gameState.progress = 0;
    gameState.deadlineAt = now + Number(gameDef.stepWindowMs || 2400);

    io.to(roomId).emit("minigame_action_result", {
      id: gameDef.id,
      playerId: player.id,
      action,
      success: false,
      scoreDelta: 0,
      combo: gameState.combo
    });

    return true;
  }

  gameState.participants.add(player.id);
  gameState.lastSuccessAt = now;
  gameState.promptIndex += 1;
  gameState.progress = gameState.promptIndex / Math.max(1, sequence.length);
  gameState.deadlineAt = now + Number(gameDef.stepWindowMs || 2400);

  let scoreDelta = 1;
  if (gameState.promptIndex >= sequence.length) {
    gameState.promptIndex = 0;
    gameState.progress = 1;
    gameState.cycle += 1;
    gameState.streak += 1;
    gameState.combo = gameState.streak;
    scoreDelta = 2;
    applyQuestDelta(player.userId, "minigame_completion", 1, { gameId: gameDef.id });
    applyQuestDelta(player.userId, "minigame_combo", 1, { gameId: gameDef.id, combo: gameState.streak });

    for (const milestone of gameDef.rewardMilestones || []) {
      const marker = Number(milestone.streak || 0);
      if (!marker || gameState.streak < marker || gameState.awardedMilestones.has(marker)) {
        continue;
      }

      gameState.awardedMilestones.add(marker);
      const rewardPlayers = listPlayersByRoom(roomId).filter((entry) => entry.zoneId === gameDef.zoneId);
      for (const rewardPlayer of rewardPlayers) {
        awardMiniGameReward(
          rewardPlayer,
          gameDef.id,
          `cycle:${gameState.cycle}:streak:${marker}:player:${rewardPlayer.id}`,
          milestone.stars,
          milestone.xp
        );
      }
    }
  }

  gameState.prompt = sequence[gameState.promptIndex] || sequence[0] || "pickup";

  io.to(roomId).emit("minigame_action_result", {
    id: gameDef.id,
    playerId: player.id,
    action,
    success: true,
    scoreDelta,
    combo: gameState.combo
  });

  applyQuestDelta(player.userId, "minigame_participation", 1, { gameId: gameDef.id });
  return true;
}

function handleGlowTrailAction(roomId, gameDef, gameState, player, action) {
  if (player.zoneId !== gameDef.zoneId) {
    return false;
  }

  if (action !== "happywalk" || !gameState.requiresHappywalk) {
    return false;
  }

  gameState.requiresHappywalk = false;
  gameState.phase = "active";
  gameState.combo += 1;
  gameState.participants.add(player.id);

  io.to(roomId).emit("minigame_action_result", {
    id: gameDef.id,
    playerId: player.id,
    action,
    success: true,
    scoreDelta: 1,
    combo: gameState.combo
  });

  applyQuestDelta(player.userId, "minigame_participation", 1, { gameId: gameDef.id });
  return true;
}

function handleMiniGameAction(player, action, now) {
  const roomState = ensureRoomMiniGameState(player.roomId, now);

  for (const gameDef of MINI_GAME_DEFS) {
    const gameState = roomState.miniGames.get(gameDef.id);
    if (!gameState) {
      continue;
    }

    if (gameDef.id === "emote_echo_circle" && handleEmoteEchoAction(player.roomId, gameDef, gameState, player, action, now)) {
      return;
    }

    if (gameDef.id === "prop_relay_bench" && handlePropRelayAction(player.roomId, gameDef, gameState, player, action, now)) {
      return;
    }

    if (gameDef.id === "glow_trail_walk" && handleGlowTrailAction(player.roomId, gameDef, gameState, player, action)) {
      return;
    }
  }
}

function stepMiniGamesForRoom(roomId, roomPlayers, now) {
  const roomState = ensureRoomMiniGameState(roomId, now);

  for (const gameDef of MINI_GAME_DEFS) {
    const gameState = roomState.miniGames.get(gameDef.id);
    if (!gameState) {
      continue;
    }

    const zonePlayers = roomPlayers.filter((player) => player.zoneId === gameDef.zoneId);
    gameState.participants = new Set(zonePlayers.map((player) => player.id));

    if (gameDef.id === "emote_echo_circle") {
      if (now > gameState.promptExpiresAt && gameState.responded.size === 0) {
        gameState.combo = Math.max(0, gameState.combo - 1);
      }

      if (now >= gameState.nextPromptAt) {
        gameState.promptIndex = (gameState.promptIndex + 1) % Math.max(1, gameDef.promptOrder?.length || 1);
        gameState.prompt = gameDef.promptOrder?.[gameState.promptIndex] || "wave";
        gameState.responded = new Set();
        gameState.promptExpiresAt = now + Number(gameDef.responseWindowMs || 1800);
        gameState.nextPromptAt = now + Number(gameDef.promptEveryMs || 4000);
        gameState.cycle += 1;
        gameState.awardedMilestones = new Set();
      }

      gameState.phase = now <= gameState.promptExpiresAt ? "prompt" : "cooldown";
      gameState.progress = zonePlayers.length ? gameState.responded.size / zonePlayers.length : 0;
    }

    if (gameDef.id === "prop_relay_bench") {
      const sequence = gameDef.sequence || [];
      if (now > gameState.deadlineAt) {
        gameState.streak = Math.max(0, gameState.streak - 1);
        gameState.combo = gameState.streak;
        gameState.promptIndex = 0;
        gameState.progress = 0;
        gameState.deadlineAt = now + Number(gameDef.stepWindowMs || 2400);
      }

      if (now - gameState.lastSuccessAt > Number(gameDef.idleDecayMs || 5500)) {
        gameState.streak = Math.max(0, gameState.streak - 1);
        gameState.combo = gameState.streak;
        gameState.lastSuccessAt = now;
      }

      gameState.prompt = sequence[gameState.promptIndex] || sequence[0] || "pickup";
      gameState.phase = "active";
    }

    if (gameDef.id === "glow_trail_walk") {
      const waypoints = gameDef.waypoints || [];
      const waypoint = waypoints[gameState.waypointIndex];

      if (gameState.requiresHappywalk) {
        gameState.phase = "waiting_happywalk";
      } else if (waypoint) {
        for (const zonePlayer of zonePlayers) {
          const distance = Math.hypot(zonePlayer.x - waypoint.x, zonePlayer.y - waypoint.y);
          if (distance > Number(gameDef.waypointRadius || 130)) {
            continue;
          }

          gameState.touchedThisCycle.add(zonePlayer.id);
          gameState.waypointIndex += 1;
          gameState.phase = "active";

          if (zonePlayer.userId) {
            applyQuestDelta(zonePlayer.userId, "minigame_participation", 1, { gameId: gameDef.id });
          }

          if (
            Number(gameDef.happywalkEvery || 0) > 0 &&
            gameState.waypointIndex < waypoints.length &&
            gameState.waypointIndex % Number(gameDef.happywalkEvery) === 0
          ) {
            gameState.requiresHappywalk = true;
          }

          if (gameState.waypointIndex >= waypoints.length) {
            gameState.completionCount += 1;
            gameState.cycle += 1;
            gameState.waypointIndex = 0;
            gameState.requiresHappywalk = false;
            gameState.phase = "complete";
            gameState.combo += 1;

            const rewardParticipants = roomPlayers.filter((entry) => gameState.touchedThisCycle.has(entry.id));
            for (const rewardPlayer of rewardParticipants) {
              let stars = Number(gameDef.rewardPerCompletion?.stars || 0);
              let xp = Number(gameDef.rewardPerCompletion?.xp || 0);
              if (rewardParticipants.length >= Number(gameDef.coopBonus?.minParticipants || 2)) {
                stars += Number(gameDef.coopBonus?.stars || 0);
                xp += Number(gameDef.coopBonus?.xp || 0);
              }

              awardMiniGameReward(
                rewardPlayer,
                gameDef.id,
                `cycle:${gameState.cycle}:completion:${gameState.completionCount}:player:${rewardPlayer.id}`,
                stars,
                xp
              );
              applyQuestDelta(rewardPlayer.userId, "minigame_completion", 1, { gameId: gameDef.id });
            }

            gameState.touchedThisCycle = new Set();
          }

          break;
        }
      }

      gameState.progress = waypoints.length ? gameState.waypointIndex / waypoints.length : 0;
      gameState.prompt = gameState.requiresHappywalk ? "happywalk" : "reach_waypoint";
    }

    io.to(roomId).emit("minigame_state", toPublicMiniGameState(gameState));
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    features: FEATURES,
    roomVoiceEnabled: FEATURES.voice_v1 && Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL)
  });
});

app.post("/api/auth/signup", async (req, res) => {
  if (!FEATURES.auth_v1) {
    res.status(503).json({ error: "auth_v1_disabled" });
    return;
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const displayName = String(req.body?.displayName || "").trim();

  if (!email.includes("@") || password.length < 8) {
    res.status(400).json({ error: "invalid_signup_payload" });
    return;
  }

  if (store.findUserByEmail(email)) {
    res.status(409).json({ error: "email_exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { user, profile } = store.createUser({
    email,
    passwordHash,
    displayName,
    defaultAvatar: DEFAULT_AVATAR
  });

  const accessToken = signAccessToken(user);
  const { refreshToken, expiresAt } = createRefreshTokenForUser(user.id);
  const quests = ensureActiveQuestsForUser(user.id, new Date());

  res.status(201).json({
    accessToken,
    refreshToken,
    refreshExpiresAt: expiresAt,
    profile: summarizeProfile(user, profile),
    progression: summarizeProgression(profile, store.listUnlocksByUser(user.id)),
    quests
  });
});

app.post("/api/auth/login", async (req, res) => {
  if (!FEATURES.auth_v1) {
    res.status(503).json({ error: "auth_v1_disabled" });
    return;
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");

  const user = store.findUserByEmail(email);
  if (!user) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const profile = store.ensureProfile(user.id, DEFAULT_AVATAR);
  const accessToken = signAccessToken(user);
  const { refreshToken, expiresAt } = createRefreshTokenForUser(user.id);
  const quests = ensureActiveQuestsForUser(user.id, new Date());

  res.json({
    accessToken,
    refreshToken,
    refreshExpiresAt: expiresAt,
    profile: summarizeProfile(user, profile),
    progression: summarizeProgression(profile, store.listUnlocksByUser(user.id)),
    quests
  });
});

app.post("/api/auth/refresh", (req, res) => {
  if (!FEATURES.auth_v1) {
    res.status(503).json({ error: "auth_v1_disabled" });
    return;
  }

  const refreshToken = String(req.body?.refreshToken || "").trim();
  if (!refreshToken) {
    res.status(400).json({ error: "missing_refresh_token" });
    return;
  }

  const tokenHash = hashToken(refreshToken);
  const tokenRow = store.findRefreshTokenByHash(tokenHash);
  if (!tokenRow || tokenRow.revokedAt) {
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  if (new Date(tokenRow.expiresAt).getTime() <= Date.now()) {
    store.revokeRefreshToken(tokenHash);
    res.status(401).json({ error: "refresh_token_expired" });
    return;
  }

  const user = store.findUserById(tokenRow.userId);
  if (!user) {
    res.status(401).json({ error: "user_not_found" });
    return;
  }

  store.revokeRefreshToken(tokenHash);
  const next = createRefreshTokenForUser(user.id, tokenHash);
  const accessToken = signAccessToken(user);

  res.json({
    accessToken,
    refreshToken: next.refreshToken,
    refreshExpiresAt: next.expiresAt
  });
});

app.post("/api/auth/logout", (req, res) => {
  const refreshToken = String(req.body?.refreshToken || "").trim();
  if (refreshToken) {
    store.revokeRefreshToken(hashToken(refreshToken));
  }

  res.status(204).end();
});

app.get("/api/profile/me", authRequired, (req, res) => {
  const profile = store.ensureProfile(req.user.id, DEFAULT_AVATAR);
  const unlocks = store.listUnlocksByUser(req.user.id);

  res.json({
    profile: summarizeProfile(req.user, profile),
    progression: summarizeProgression(profile, unlocks),
    quests: ensureActiveQuestsForUser(req.user.id, new Date())
  });
});

app.post("/api/profile/avatar", authRequired, (req, res) => {
  const avatar = normalizeAvatar(req.body?.avatar);
  const profile = store.updateProfileAvatar(req.user.id, avatar);
  if (!profile) {
    res.status(404).json({ error: "profile_not_found" });
    return;
  }

  res.json({
    avatar: profile.selectedAvatar,
    updatedAt: profile.updatedAt
  });
});

app.post("/api/profile/equip", authRequired, (req, res) => {
  const unlockId = String(req.body?.unlockId || "").trim();
  const unlockDef = getUnlockDefById(unlockId);
  if (!unlockDef) {
    res.status(404).json({ error: "unlock_not_found" });
    return;
  }

  const profile = store.equipUnlock(req.user.id, unlockId, unlockDef.category);
  if (!profile) {
    res.status(400).json({ error: "unlock_not_owned" });
    return;
  }

  res.json({
    equipped: profile.equipped,
    updatedAt: profile.updatedAt
  });
});

app.get("/api/quests/active", authRequired, (req, res) => {
  res.json({
    quests: ensureActiveQuestsForUser(req.user.id, new Date())
  });
});

app.post("/api/voice/token", authRequired, async (req, res) => {
  if (!FEATURES.voice_v1) {
    res.status(503).json({ error: "voice_v1_disabled" });
    return;
  }

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    res.status(503).json({ error: "voice_not_configured" });
    return;
  }

  const roomId = normalizeRoomId(req.body?.roomId);

  const token = new LiveKitAccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: req.user.id,
    name: req.user.displayName,
    ttl: "10m"
  });

  token.addGrant({
    roomJoin: true,
    room: roomId,
    canPublish: true,
    canSubscribe: true
  });

  const jwtToken = await token.toJwt();

  res.json({
    roomId,
    url: LIVEKIT_URL,
    token: jwtToken
  });
});

io.on("connection", (socket) => {
  socket.on("join", (payload = {}) => {
    const roomId = normalizeRoomId(payload.roomId);

    if (countPlayersInRoom(roomId) >= MAX_ROOM_PLAYERS) {
      socket.emit("join_error", { code: "room_full", roomId, maxPlayers: MAX_ROOM_PLAYERS });
      return;
    }

    let authenticatedUser = null;
    let authenticatedProfile = null;

    const authToken = typeof payload.authToken === "string" ? payload.authToken.trim() : "";

    if (FEATURES.auth_v1 && authToken) {
      const authPayload = verifyAccessToken(authToken);
      if (authPayload?.sub) {
        authenticatedUser = store.findUserById(authPayload.sub);
        if (authenticatedUser) {
          authenticatedProfile = store.ensureProfile(authenticatedUser.id, DEFAULT_AVATAR);
        }
      }
    }

    if (FEATURES.auth_v1 && !authenticatedUser && !FEATURES.guestFallback) {
      socket.emit("join_error", { code: "auth_required" });
      return;
    }

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

    const existing = players.get(socket.id);
    const now = Date.now();

    const player = {
      id: socket.id,
      userId: authenticatedUser?.id || null,
      roomId,
      name:
        authenticatedUser?.displayName ||
        (typeof payload.name === "string" && payload.name.trim() ? payload.name.trim().slice(0, 24) : "Guest"),
      color: normalizeColor(payload.color),
      avatar: normalizeAvatar(authenticatedProfile?.selectedAvatar || payload.avatar),
      x: existing?.x ?? WORLD.w / 2 + Math.random() * 40 - 20,
      y: existing?.y ?? WORLD.h / 2 + Math.random() * 40 - 20,
      ix: 0,
      iy: 0,
      vx: 0,
      vy: 0,
      anim: "idle",
      client,
      joinedAt: now,
      lastIntentAt: now,
      lastQuestDistanceEmitAt: now,
      pendingMoveDistance: 0,
      pendingVoiceMs: 0,
      voice: {
        connected: false,
        speaking: false,
        muted: false,
        deafened: false,
        pushToTalk: true
      },
      zoneId: null
    };

    player.zoneId = getZoneIdAtPosition(player.x, player.y);

    players.set(socket.id, player);
    socket.join(roomId);
    ensureRoomMiniGameState(roomId, now);

    if (player.userId) {
      registerSocketForUser(player.userId, socket.id);
      applyQuestDelta(player.userId, "join_room", 1, {});
    }

    const roomPlayers = listPlayersByRoom(roomId).map(toPublicPlayer);
    const roomVoiceEnabled = FEATURES.voice_v1 && Boolean(LIVEKIT_API_KEY && LIVEKIT_API_SECRET && LIVEKIT_URL);

    socket.emit("welcome", {
      selfId: socket.id,
      roomId,
      world: WORLD,
      players: roomPlayers,
      zones: getPublicZones(),
      miniGames: listPublicMiniGamesForRoom(roomId, now),
      profile:
        authenticatedUser && authenticatedProfile
          ? summarizeProfile(authenticatedUser, authenticatedProfile)
          : null,
      progression:
        authenticatedProfile && authenticatedUser
          ? summarizeProgression(authenticatedProfile, store.listUnlocksByUser(authenticatedUser.id))
          : null,
      quests: authenticatedUser ? ensureActiveQuestsForUser(authenticatedUser.id, new Date()) : [],
      roomVoiceEnabled
    });

    updateRoomZonePresence(roomId, listPlayersByRoom(roomId));

    socket.to(roomId).emit("player_joined", toPublicPlayer(player));
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

    io.to(player.roomId).emit("emote", {
      id: socket.id,
      type,
      ts: Date.now()
    });

    handleMiniGameAction(player, type, Date.now());

    if (!player.userId) {
      return;
    }

    const peers = listPlayersByRoom(player.roomId).filter((entry) => entry.id !== player.id);
    const nearby = peers.some((entry) => Math.hypot(entry.x - player.x, entry.y - player.y) <= 210);
    applyQuestDelta(player.userId, "emote_near_player", 1, {
      emote: type,
      nearbySatisfied: nearby
    });
  });

  socket.on("voice_state", (payload = {}) => {
    const player = players.get(socket.id);
    if (!player) {
      return;
    }

    player.voice.connected = Boolean(payload.connected);
    player.voice.speaking = Boolean(payload.speaking);
    player.voice.muted = Boolean(payload.muted);
    player.voice.deafened = Boolean(payload.deafened);
    player.voice.pushToTalk = payload.pushToTalk === undefined ? player.voice.pushToTalk : Boolean(payload.pushToTalk);

    io.to(player.roomId).emit("voice_presence", {
      id: player.id,
      speaking: player.voice.speaking,
      muted: player.voice.muted
    });
  });

  socket.on("report_player", ({ targetPlayerId, reason } = {}) => {
    const reporter = players.get(socket.id);
    if (!reporter?.userId || !targetPlayerId) {
      return;
    }

    store.addAbuseReport({
      reporterUserId: reporter.userId,
      targetPlayerId: String(targetPlayerId),
      roomId: reporter.roomId,
      reason: typeof reason === "string" ? reason.slice(0, 280) : "unspecified"
    });
  });

  socket.on("disconnect", () => {
    const player = players.get(socket.id);
    if (player?.userId) {
      unregisterSocketForUser(player.userId, socket.id);
    }

    if (player) {
      io.to(player.roomId).emit("player_left", { id: socket.id });
    }

    players.delete(socket.id);

    if (player && countPlayersInRoom(player.roomId) === 0) {
      roomMiniGames.delete(player.roomId);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = TICK_MS / 1000;

  for (const player of players.values()) {
    player.vx = player.ix * PLAYER_SPEED;
    player.vy = player.iy * PLAYER_SPEED;

    const speed = Math.hypot(player.vx, player.vy);

    player.x = clamp(player.x + player.vx * dt, PLAYER_PADDING, WORLD.w - PLAYER_PADDING);
    player.y = clamp(player.y + player.vy * dt, PLAYER_PADDING, WORLD.h - PLAYER_PADDING);

    player.anim = speed > PLAYER_SPEED * 0.72 ? "run" : speed > 8 ? "walk" : "idle";

    if (!player.userId) {
      continue;
    }

    if (FEATURES.quests_v1) {
      player.pendingMoveDistance += speed * dt;
      if (player.pendingMoveDistance >= 35) {
        const deltaDistance = Math.floor(player.pendingMoveDistance);
        player.pendingMoveDistance -= deltaDistance;
        applyQuestDelta(player.userId, "move_distance", deltaDistance, {});
      }

      applyQuestDelta(player.userId, "visit_zone", 1, { x: player.x, y: player.y });

      if (FEATURES.voice_v1 && player.voice.connected && !player.voice.muted) {
        player.pendingVoiceMs += TICK_MS;
        if (player.pendingVoiceMs >= 60000) {
          const minutes = Math.floor(player.pendingVoiceMs / 60000);
          player.pendingVoiceMs -= minutes * 60000;
          applyQuestDelta(player.userId, "voice_minutes", minutes, {});
        }
      }
    }
  }

  const roomIds = new Set(Array.from(players.values()).map((player) => player.roomId));
  for (const roomId of roomIds) {
    const roomPlayers = listPlayersByRoom(roomId);
    updateRoomZonePresence(roomId, roomPlayers);
    stepMiniGamesForRoom(roomId, roomPlayers, now);

    io.to(roomId).emit("state", {
      players: roomPlayers.map(toPublicPlayer)
    });
  }

  for (const roomId of Array.from(roomMiniGames.keys())) {
    if (!roomIds.has(roomId)) {
      roomMiniGames.delete(roomId);
    }
  }
}, TICK_MS);

httpServer.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
  console.log(`Features: ${JSON.stringify(FEATURES)}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    try {
      await store.close();
    } catch {
      // no-op
    }
    process.exit(0);
  });
}
