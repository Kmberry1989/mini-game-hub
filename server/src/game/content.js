export const WORLD = { w: 2800, h: 1800 };

export const PLAYER_PADDING = 40;
export const PLAYER_SPEED = 185;
export const TICK_MS = 50;
export const MAX_ROOM_PLAYERS = 12;

export const DEFAULT_ROOM_ID = "studio-1";

export const STUDIO_ZONES = [
  {
    id: "stage",
    name: "Stage",
    type: "rect",
    miniGameId: "emote_echo_circle",
    bounds: { xMin: 1840, xMax: 2760, yMin: 120, yMax: 720 }
  },
  {
    id: "workshop",
    name: "Workshop",
    type: "rect",
    miniGameId: "prop_relay_bench",
    bounds: { xMin: 120, xMax: 980, yMin: 220, yMax: 980 }
  },
  {
    id: "lounge",
    name: "Lounge",
    type: "rect",
    miniGameId: null,
    bounds: { xMin: 980, xMax: 1720, yMin: 980, yMax: 1680 }
  },
  {
    id: "gallery",
    name: "Gallery",
    type: "rect",
    miniGameId: null,
    bounds: { xMin: 1840, xMax: 2760, yMin: 840, yMax: 1700 }
  },
  {
    id: "walkway",
    name: "Walkway",
    type: "perimeter",
    miniGameId: "glow_trail_walk",
    bounds: { inset: 240 }
  }
];

export const MINI_GAME_DEFS = [
  {
    id: "emote_echo_circle",
    zoneId: "stage",
    type: "social_rhythm",
    promptEveryMs: 4000,
    responseWindowMs: 1800,
    promptOrder: ["wave", "heart", "sparkle", "laugh"],
    rewardMilestones: [
      { combo: 3, stars: 10, xp: 14 },
      { combo: 6, stars: 14, xp: 18 },
      { combo: 10, stars: 18, xp: 24 }
    ]
  },
  {
    id: "prop_relay_bench",
    zoneId: "workshop",
    type: "context_relay",
    sequence: ["pickup", "openlid", "jump"],
    stepWindowMs: 2400,
    idleDecayMs: 5500,
    rewardMilestones: [
      { streak: 2, stars: 12, xp: 16 },
      { streak: 4, stars: 16, xp: 22 },
      { streak: 6, stars: 20, xp: 28 }
    ]
  },
  {
    id: "glow_trail_walk",
    zoneId: "walkway",
    type: "path_coop",
    waypointRadius: 130,
    waypoints: [
      { x: 360, y: 300 },
      { x: 1400, y: 260 },
      { x: 2450, y: 320 },
      { x: 2520, y: 900 },
      { x: 2450, y: 1520 },
      { x: 1400, y: 1560 },
      { x: 360, y: 1500 },
      { x: 290, y: 920 }
    ],
    happywalkEvery: 3,
    rewardPerCompletion: { stars: 24, xp: 32 },
    coopBonus: { minParticipants: 2, stars: 8, xp: 10 }
  }
];

export const ALLOWED_AVATARS = new Set([
  "kyle",
  "bethany",
  "caleb",
  "connie",
  "donald",
  "eric",
  "kristen",
  "maia",
  "rochelle",
  "vickie"
]);

export const DEFAULT_AVATAR = "kyle";

export const ALLOWED_EMOTES = new Set([
  "wave",
  "heart",
  "sparkle",
  "laugh",
  "jump",
  "pickup",
  "openlid",
  "sittingvictory",
  "happywalk"
]);

export const QUEST_DEFS = [
  {
    id: "starter_join_room",
    key: "starter_join_room",
    title: "Welcome to the Lobby",
    type: "join_room",
    target: 1,
    isDaily: false,
    rewards: { stars: 20, xp: 35 }
  },
  {
    id: "starter_move_distance",
    key: "starter_move_distance",
    title: "Take Your First Steps",
    type: "move_distance",
    target: 1600,
    isDaily: false,
    rewards: { stars: 24, xp: 40 }
  },
  {
    id: "starter_visit_zone",
    key: "starter_visit_zone",
    title: "Visit The Lounge",
    type: "visit_zone",
    target: 1,
    config: {
      zone: { x: 1780, y: 980, radius: 130 }
    },
    isDaily: false,
    rewards: { stars: 28, xp: 42 }
  },
  {
    id: "daily_wave_friend",
    key: "daily_wave_friend",
    title: "Wave Nearby Friends",
    type: "emote_near_player",
    target: 3,
    config: { emote: "wave", radius: 210 },
    isDaily: true,
    rewards: { stars: 35, xp: 48 }
  },
  {
    id: "daily_sparkle_friend",
    key: "daily_sparkle_friend",
    title: "Sparkle With Others",
    type: "emote_near_player",
    target: 2,
    config: { emote: "sparkle", radius: 210 },
    isDaily: true,
    rewards: { stars: 34, xp: 47 }
  },
  {
    id: "daily_voice_minutes",
    key: "daily_voice_minutes",
    title: "Talk Nearby",
    type: "voice_minutes",
    target: 4,
    isDaily: true,
    rewards: { stars: 40, xp: 54 }
  },
  {
    id: "daily_move_distance",
    key: "daily_move_distance",
    title: "Stroll The Studio",
    type: "move_distance",
    target: 2400,
    isDaily: true,
    rewards: { stars: 30, xp: 44 }
  },
  {
    id: "daily_minigame_participation",
    key: "daily_minigame_participation",
    title: "Join Mini-Games",
    type: "minigame_participation",
    target: 6,
    config: { gameId: "any" },
    isDaily: true,
    rewards: { stars: 34, xp: 46 }
  },
  {
    id: "daily_minigame_combo",
    key: "daily_minigame_combo",
    title: "Build Team Combo",
    type: "minigame_combo",
    target: 2,
    config: { gameId: "emote_echo_circle", minCombo: 3 },
    isDaily: true,
    rewards: { stars: 38, xp: 50 }
  },
  {
    id: "daily_minigame_completion",
    key: "daily_minigame_completion",
    title: "Finish Co-op Loops",
    type: "minigame_completion",
    target: 2,
    config: { gameId: "any" },
    isDaily: true,
    rewards: { stars: 40, xp: 56 }
  }
];

const DAILY_POOL = QUEST_DEFS.filter((quest) => quest.isDaily);
const STARTER_QUESTS = QUEST_DEFS.filter((quest) => !quest.isDaily);

export const UNLOCK_DEFS = [
  {
    id: "ring_sunset",
    key: "ring_sunset",
    category: "ring_style",
    metadata: { label: "Sunset Ring", color: "#FFB376" }
  },
  {
    id: "ring_mint",
    key: "ring_mint",
    category: "ring_style",
    metadata: { label: "Mint Ring", color: "#8BFFD3" }
  },
  {
    id: "badge_wave",
    key: "badge_wave",
    category: "emote_badge",
    metadata: { label: "Wave Badge", emote: "wave" }
  },
  {
    id: "badge_social",
    key: "badge_social",
    category: "emote_badge",
    metadata: { label: "Social Star", emote: "heart" }
  }
];

export const UNLOCK_TRACK = [
  {
    tier: 1,
    xpThreshold: 120,
    rewards: [{ type: "unlock", unlockId: "ring_sunset" }, { type: "stars", amount: 30 }]
  },
  {
    tier: 2,
    xpThreshold: 280,
    rewards: [{ type: "unlock", unlockId: "badge_wave" }, { type: "stars", amount: 45 }]
  },
  {
    tier: 3,
    xpThreshold: 460,
    rewards: [{ type: "unlock", unlockId: "ring_mint" }, { type: "stars", amount: 60 }]
  },
  {
    tier: 4,
    xpThreshold: 700,
    rewards: [{ type: "unlock", unlockId: "badge_social" }, { type: "stars", amount: 75 }]
  }
];

export function dayStamp(inputDate = new Date()) {
  const date = new Date(inputDate);
  return date.toISOString().slice(0, 10);
}

export function getActiveQuestDefs(inputDate = new Date()) {
  if (!DAILY_POOL.length) {
    return STARTER_QUESTS;
  }

  const unixDay = Math.floor(new Date(inputDate).getTime() / 86400000);
  const start = Math.abs(unixDay) % DAILY_POOL.length;
  const first = DAILY_POOL[start];
  const second = DAILY_POOL[(start + 1) % DAILY_POOL.length];

  return [...STARTER_QUESTS, first, second];
}

export function getQuestDefById(questId) {
  return QUEST_DEFS.find((quest) => quest.id === questId) || null;
}

export function getUnlockDefById(unlockId) {
  return UNLOCK_DEFS.find((unlock) => unlock.id === unlockId) || null;
}

export function getZoneById(zoneId) {
  return STUDIO_ZONES.find((zone) => zone.id === zoneId) || null;
}

export function getMiniGameDefById(miniGameId) {
  return MINI_GAME_DEFS.find((game) => game.id === miniGameId) || null;
}

export function getZoneIdAtPosition(x, y) {
  for (const zone of STUDIO_ZONES) {
    if (zone.type === "rect") {
      const bounds = zone.bounds || {};
      if (x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax) {
        return zone.id;
      }
      continue;
    }

    if (zone.type === "perimeter") {
      const inset = Number(zone.bounds?.inset || 240);
      const inPerimeter =
        x <= inset ||
        y <= inset ||
        x >= WORLD.w - inset ||
        y >= WORLD.h - inset;
      if (inPerimeter) {
        return zone.id;
      }
    }
  }

  return null;
}
