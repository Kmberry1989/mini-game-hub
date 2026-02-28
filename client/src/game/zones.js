import { WORLD_DEFAULT } from "./constants";

export const DEFAULT_ZONE_DEFS = [
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

export const LIGHTING_PRESET_ORDER = ["low", "medium", "high"];

export function normalizeLightingPreset(value) {
  if (LIGHTING_PRESET_ORDER.includes(value)) {
    return value;
  }
  return "medium";
}

export function selectInitialLightingPreset() {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const hardwareConcurrency = Number(navigator.hardwareConcurrency || 4);
  const memory = Number(navigator.deviceMemory || 4);

  if (coarse && (hardwareConcurrency <= 4 || memory <= 4)) {
    return "low";
  }

  if (coarse || hardwareConcurrency <= 6) {
    return "medium";
  }

  return "high";
}

function getWorldDimensions(world) {
  const source = world && Number.isFinite(world.w) && Number.isFinite(world.h) ? world : WORLD_DEFAULT;
  return { w: source.w, h: source.h };
}

export function getZoneIdAtPosition(zones, x, y, world = WORLD_DEFAULT) {
  const list = Array.isArray(zones) && zones.length ? zones : DEFAULT_ZONE_DEFS;
  const { w, h } = getWorldDimensions(world);

  for (const zone of list) {
    if (zone.type === "rect") {
      const bounds = zone.bounds || {};
      if (x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax) {
        return zone.id;
      }
      continue;
    }

    if (zone.type === "perimeter") {
      const inset = Number(zone.bounds?.inset || 240);
      const inPerimeter = x <= inset || y <= inset || x >= w - inset || y >= h - inset;
      if (inPerimeter) {
        return zone.id;
      }
    }
  }

  return null;
}

