export const EMOTE_ORDER = ["wave", "heart", "sparkle", "laugh"];
export const CONTEXT_ACTION_ORDER = ["jump", "pickup", "openlid", "sittingvictory", "happywalk"];
export const ALL_ACTIONS = [...EMOTE_ORDER, ...CONTEXT_ACTION_ORDER];

export const EMOTE_SYMBOLS = {
  wave: "WAVE",
  heart: "LOVE",
  sparkle: "SHINE",
  laugh: "LOL"
};

export const EMOTE_LABELS = {
  wave: "Wave",
  heart: "Heart",
  sparkle: "Sparkle",
  laugh: "Laugh",
  jump: "Jump",
  pickup: "Pick Up",
  openlid: "Open Lid",
  sittingvictory: "Sit",
  happywalk: "Happy Walk"
};

export function isValidEmote(value) {
  return ALL_ACTIONS.includes(value);
}
