export const WORLD = { w: 2800, h: 1800 };

export const PLAYER_PADDING = 40;
export const PLAYER_SPEED = 185;
export const TICK_MS = 50;
export const MAX_ROOM_PLAYERS = 12;

export const DEFAULT_ROOM_ID = "studio-1";

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
