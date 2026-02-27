export const EMOTE_ORDER = ["wave", "heart", "sparkle", "laugh"];

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
  laugh: "Laugh"
};

export function isValidEmote(value) {
  return EMOTE_ORDER.includes(value);
}
