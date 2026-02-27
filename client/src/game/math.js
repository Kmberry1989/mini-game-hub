export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(from, to, alpha) {
  return from + (to - from) * alpha;
}

export function normalizeAxis(x, y) {
  const length = Math.hypot(x, y);
  if (length <= 0.0001) {
    return { x: 0, y: 0 };
  }

  if (length <= 1) {
    return { x, y };
  }

  return { x: x / length, y: y / length };
}
