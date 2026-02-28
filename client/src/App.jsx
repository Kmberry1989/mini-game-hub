import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { io } from "socket.io-client";
import {
  CLIENT_VERSION,
  EMOTE_DURATION_MS,
  INTENT_SEND_INTERVAL_MS,
  LOCAL_PLAYER_COLOR,
  PLAYER_SPEED,
  WORLD_DEFAULT,
  WORLD_SCALE
} from "./game/constants";
import { CONTEXT_ACTION_ORDER, EMOTE_LABELS, EMOTE_ORDER, isValidEmote } from "./game/emotes";
import { clamp, lerp, normalizeAxis } from "./game/math";
import {
  clearStoredSession,
  fetchProfile,
  fetchVoiceToken,
  loadStoredSession,
  login,
  logout,
  refreshAuth,
  saveStoredSession,
  signup,
  updateAvatar
} from "./game/api";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const DEFAULT_ROOM_ID = "studio-1";

const animationCache = {
  status: "idle",
  promise: null,
  data: null,
  error: null
};

const avatarSceneCache = new Map();

const CHARACTER_OPTIONS = [
  { id: "kyle", label: "Kyle", avatarUrl: "/assets/avatars/kyle.glb", cardImageUrl: "/assets/char select/KYLE.png" },
  { id: "bethany", label: "Bethany", avatarUrl: "/assets/avatars/bethany.glb", cardImageUrl: "/assets/char select/BETHANY.png" },
  { id: "caleb", label: "Caleb", avatarUrl: "/assets/avatars/caleb.glb", cardImageUrl: "/assets/char select/CALEB.png" },
  { id: "connie", label: "Connie", avatarUrl: "/assets/avatars/connie.glb", cardImageUrl: "/assets/char select/CONNIE.png" },
  { id: "donald", label: "Donald", avatarUrl: "/assets/avatars/donald.glb", cardImageUrl: "/assets/char select/DONALD.png" },
  { id: "eric", label: "Eric", avatarUrl: "/assets/avatars/eric.glb", cardImageUrl: "/assets/char select/ERIC.png" },
  { id: "kristen", label: "Kristen", avatarUrl: "/assets/avatars/kristen.glb", cardImageUrl: "/assets/char select/KRISTEN.png" },
  { id: "maia", label: "Maia", avatarUrl: "/assets/avatars/maia.glb", cardImageUrl: "/assets/char select/MAIA.png" },
  { id: "rochelle", label: "Rochelle", avatarUrl: "/assets/avatars/rochelle.glb", cardImageUrl: "/assets/char select/ROCHELLE.png" },
  { id: "vickie", label: "Vickie", avatarUrl: "/assets/avatars/vickie.glb", cardImageUrl: "/assets/char select/VICKIE.png" }
];

const CHARACTER_LOOKUP = new Map(CHARACTER_OPTIONS.map((character) => [character.id, character]));
const DEFAULT_CHARACTER_ID = CHARACTER_OPTIONS[0].id;
const CHAR_SELECT_EFFECTS_DIR = "/assets/char select/char select effects";
const CHAR_SELECT_HOVERED_EFFECT_URL = `${CHAR_SELECT_EFFECTS_DIR}/HOVERED.png`;
const CHAR_SELECT_SELECTED_EFFECT_URL = `${CHAR_SELECT_EFFECTS_DIR}/SELECTED.png`;
const CHAR_SELECT_HOVERED_EFFECT_FALLBACK_URL = "/assets/char select/HOVERED.png";
const CHAR_SELECT_SELECTED_EFFECT_FALLBACK_URL = "/assets/char select/SELECTED.png";

const ANIMATION_URLS = {
  idle: "/assets/animations/idle.fbx",
  walk: "/assets/animations/walk.fbx",
  run: "/assets/animations/run.fbx",
  wave: "/assets/animations/wave.fbx",
  heart: "/assets/animations/happy.fbx",
  sparkle: "/assets/animations/sparkle.fbx",
  laugh: "/assets/animations/laugh.fbx",
  jump: "/assets/animations/jump.fbx",
  pickup: "/assets/animations/pickup.fbx",
  openlid: "/assets/animations/openlid.fbx",
  sittingvictory: "/assets/animations/sittingvictory.fbx",
  happywalk: "/assets/animations/happywalk.fbx",
  bored: "/assets/animations/bored.fbx",
  yawn: "/assets/animations/yawn.fbx"
};

const EMOTE_TO_ANIMATION = {
  wave: "wave",
  heart: "heart",
  sparkle: "sparkle",
  laugh: "laugh",
  jump: "jump",
  pickup: "pickup",
  openlid: "openlid",
  sittingvictory: "sittingvictory",
  happywalk: "happywalk"
};

const CONTEXT_ACTION_RADII = {
  pickup: 96,
  openlid: 96,
  sittingvictory: 108
};

const ACTION_DURATION_MS = {
  wave: 1400,
  heart: 1700,
  sparkle: 1700,
  laugh: 1800,
  jump: 900,
  pickup: 1300,
  openlid: 1500,
  sittingvictory: 1800,
  happywalk: 1600
};

const MODEL_YAW_OFFSET = 0;
const TARGET_AVATAR_HEIGHT = 0.16;
const IN_WORLD_AVATAR_SCALE_MULTIPLIER = 40;
const MIN_AVATAR_EXTENT = 0.001;
const MIN_AVATAR_SCALE = 0.01;
const SAFE_FBX_CLIP_KEYS = new Set(Object.keys(ANIMATION_URLS));
const LOOPING_ANIMATION_KEYS = new Set(["idle", "walk", "run", "happywalk", "bored", "yawn"]);
const ROOT_MOTION_BONE = "mixamorigHips";
const CLICK_MOVE_STOP_RADIUS = 22;
const MAX_ROOT_TILT_RADIANS = Math.PI * 0.36;

function createEmptyActionsMap() {
  return {
    idle: null,
    walk: null,
    run: null,
    wave: null,
    heart: null,
    sparkle: null,
    laugh: null,
    jump: null,
    pickup: null,
    openlid: null,
    sittingvictory: null,
    happywalk: null,
    bored: null,
    yawn: null
  };
}

function normalizeCharacterId(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return CHARACTER_LOOKUP.has(normalized) ? normalized : DEFAULT_CHARACTER_ID;
}

function getCharacterById(value) {
  return CHARACTER_LOOKUP.get(normalizeCharacterId(value)) || CHARACTER_OPTIONS[0];
}

function loadAnimationClips() {
  if (animationCache.status === "loaded") {
    return Promise.resolve(animationCache.data);
  }

  if (animationCache.status === "loading") {
    return animationCache.promise;
  }

  animationCache.status = "loading";
  const fbxLoader = new FBXLoader();

  const loadClip = async (name, url) => {
    try {
      const fbx = await fbxLoader.loadAsync(url);
      return [name, fbx.animations[0] || null];
    } catch (error) {
      console.warn(`Animation load failed for ${name}:`, error);
      return [name, null];
    }
  };

  animationCache.promise = Promise.all(
    Object.entries(ANIMATION_URLS).map(([name, url]) => loadClip(name, url))
  )
    .then((clipEntries) => {
      const loadedClips = Object.fromEntries(clipEntries);
      const idle = loadedClips.idle;
      const walk = loadedClips.walk || idle;

      if (!idle || !walk) {
        throw new Error("Missing required animation clips: idle and walk must be available.");
      }

      const clips = {
        idle,
        walk,
        run: loadedClips.run || walk,
        wave: loadedClips.wave || walk,
        heart: loadedClips.heart || loadedClips.wave || idle,
        sparkle: loadedClips.sparkle || loadedClips.wave || idle,
        laugh: loadedClips.laugh || loadedClips.wave || idle,
        jump: loadedClips.jump || loadedClips.wave || walk,
        pickup: loadedClips.pickup || loadedClips.wave || idle,
        openlid: loadedClips.openlid || loadedClips.wave || idle,
        sittingvictory: loadedClips.sittingvictory || loadedClips.bored || idle,
        happywalk: loadedClips.happywalk || loadedClips.walk || walk,
        bored: loadedClips.bored || idle,
        yawn: loadedClips.yawn || loadedClips.bored || idle
      };

      animationCache.status = "loaded";
      animationCache.data = clips;
      return clips;
    })
    .catch((error) => {
      animationCache.status = "error";
      animationCache.error = error;
      throw error;
    });

  return animationCache.promise;
}

function loadAvatarScene(avatarUrl) {
  if (!avatarUrl) {
    return Promise.reject(new Error("avatarUrl is required"));
  }

  const cached = avatarSceneCache.get(avatarUrl);
  if (cached?.status === "loaded") {
    return Promise.resolve(cached.scene);
  }
  if (cached?.status === "loading") {
    return cached.promise;
  }

  const gltfLoader = new GLTFLoader();
  const nextEntry = {
    status: "loading",
    promise: null,
    scene: null,
    error: null
  };

  nextEntry.promise = gltfLoader
    .loadAsync(avatarUrl)
    .then((gltf) => {
      nextEntry.status = "loaded";
      nextEntry.scene = gltf.scene;
      return gltf.scene;
    })
    .catch((error) => {
      nextEntry.status = "error";
      nextEntry.error = error;
      throw error;
    });

  avatarSceneCache.set(avatarUrl, nextEntry);
  return nextEntry.promise;
}

function loadAvatarBundle(avatarUrl) {
  return Promise.all([loadAvatarScene(avatarUrl), loadAnimationClips()]).then(([scene, clips]) => ({
    scene,
    clips
  }));
}

function loadAvatarBundleWithFallback(avatarUrl) {
  const requestedUrl = avatarUrl || getCharacterById(DEFAULT_CHARACTER_ID).avatarUrl;
  const fallbackUrl = getCharacterById(DEFAULT_CHARACTER_ID).avatarUrl;

  return loadAvatarBundle(requestedUrl).catch((error) => {
    if (requestedUrl === fallbackUrl) {
      throw error;
    }

    console.warn(`Avatar load failed for ${requestedUrl}, falling back to ${fallbackUrl}`, error);
    return loadAvatarBundle(fallbackUrl);
  });
}

function worldToScenePosition(world, x, y) {
  return {
    x: (x - world.w / 2) * WORLD_SCALE,
    z: (y - world.h / 2) * WORLD_SCALE
  };
}

function sceneToWorldPosition(world, x, z) {
  return {
    x: x / WORLD_SCALE + world.w / 2,
    y: z / WORLD_SCALE + world.h / 2
  };
}

function createPlayerState(input, world) {
  const baseX = Number.isFinite(input?.x) ? input.x : world.w / 2;
  const baseY = Number.isFinite(input?.y) ? input.y : world.h / 2;
  const vx = Number.isFinite(input?.vx) ? input.vx : 0;
  const vy = Number.isFinite(input?.vy) ? input.vy : 0;

  return {
    id: input?.id || "",
    name: input?.name || "Guest",
    color: input?.color || LOCAL_PLAYER_COLOR,
    avatar: normalizeCharacterId(input?.avatar),
    x: baseX,
    y: baseY,
    serverX: baseX,
    serverY: baseY,
    displayX: baseX,
    displayY: baseY,
    vx,
    vy,
    anim: input?.anim || (Math.hypot(vx, vy) > 8 ? "walk" : "idle"),
    emote: null,
    emoteUntil: 0,
    activeStyle: null,
    idleForMs: 0,
    lastStateAt: performance.now()
  };
}

function getInteractionPoints(world) {
  return {
    pickup: { x: world.w * 0.63, y: world.h * 0.52 },
    openlid: { x: world.w * 0.42, y: world.h * 0.42 },
    sittingvictory: { x: world.w * 0.55, y: world.h * 0.62 }
  };
}

function distance2D(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function getActionDurationMs(action) {
  return ACTION_DURATION_MS[action] || EMOTE_DURATION_MS;
}

function resolveContextActions(player, world, input) {
  const speed = Math.hypot(player.vx || 0, player.vy || 0);
  const inputMagnitude = Math.hypot(input.moveX || 0, input.moveY || 0);
  const isMoving = speed > 14 || inputMagnitude > 0.42;
  const points = getInteractionPoints(world);
  const available = [];

  if (isMoving) {
    available.push("jump");
    available.push("happywalk");
  }

  for (const action of ["pickup", "openlid", "sittingvictory"]) {
    const point = points[action];
    const radius = CONTEXT_ACTION_RADII[action];
    if (!point || !radius) {
      continue;
    }

    if (!isMoving && distance2D(player.x, player.y, point.x, point.y) <= radius) {
      available.push(action);
    }
  }

  return available;
}

function resolveDesiredAnimation(player) {
  if (player.emote && EMOTE_TO_ANIMATION[player.emote]) {
    return EMOTE_TO_ANIMATION[player.emote];
  }

  if (player.activeStyle === "happywalk" && player.anim === "walk") {
    return "happywalk";
  }

  if (player.anim === "run") {
    return "run";
  }

  if (player.anim === "walk") {
    return "walk";
  }

  if (player.idleForMs > 6500) {
    return "yawn";
  }

  if (player.idleForMs > 2500) {
    return "bored";
  }

  return "idle";
}

function prepareClipForModel(clip, modelRoot) {
  if (!clip || !modelRoot) {
    return null;
  }

  const validNodeNames = new Set();
  modelRoot.traverse((node) => {
    if (node.name) {
      validNodeNames.add(node.name);
    }
  });

  const preparedTracks = [];
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();

  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf(".");
    if (dot <= 0) {
      continue;
    }

    const nodeName = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);

    if (!validNodeNames.has(nodeName)) {
      continue;
    }

    if (property === "quaternion") {
      if (nodeName === ROOT_MOTION_BONE && track.values?.length >= 4) {
        const values = Float32Array.from(track.values);

        for (let index = 0; index < values.length; index += 4) {
          quaternion.set(values[index], values[index + 1], values[index + 2], values[index + 3]).normalize();
          euler.setFromQuaternion(quaternion, "YXZ");
          euler.x = THREE.MathUtils.clamp(euler.x, -MAX_ROOT_TILT_RADIANS, MAX_ROOT_TILT_RADIANS);
          euler.z = THREE.MathUtils.clamp(euler.z, -MAX_ROOT_TILT_RADIANS, MAX_ROOT_TILT_RADIANS);
          quaternion.setFromEuler(euler).normalize();
          values[index] = quaternion.x;
          values[index + 1] = quaternion.y;
          values[index + 2] = quaternion.z;
          values[index + 3] = quaternion.w;
        }

        preparedTracks.push(
          new THREE.QuaternionKeyframeTrack(track.name, Float32Array.from(track.times), values)
        );
      } else {
        preparedTracks.push(track.clone());
      }
      continue;
    }

    if (property === "position" && nodeName === ROOT_MOTION_BONE && track.values?.length >= 3) {
      const values = Float32Array.from(track.values);
      const baseY = values[1];

      for (let index = 0; index < values.length; index += 3) {
        values[index] = 0;
        values[index + 1] -= baseY;
        values[index + 2] = 0;
      }

      preparedTracks.push(new THREE.VectorKeyframeTrack(track.name, Float32Array.from(track.times), values));
    }
  }

  if (!preparedTracks.length) {
    return null;
  }

  return new THREE.AnimationClip(
    clip.name,
    clip.duration,
    preparedTracks
  );
}

function getRenderableBounds(object3d) {
  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  object3d.updateMatrixWorld(true);

  object3d.traverse((node) => {
    if (!node.isMesh) {
      return;
    }

    const meshBounds = new THREE.Box3().setFromObject(node, true);
    if (!meshBounds.isEmpty()) {
      bounds.union(meshBounds);
    }
  });

  if (bounds.isEmpty()) {
    return new THREE.Box3().setFromObject(object3d, true);
  }

  return bounds;
}

function fitModelToTargetExtent(modelRoot, targetExtent) {
  const baseBounds = getRenderableBounds(modelRoot);
  const baseSize = new THREE.Vector3();
  baseBounds.getSize(baseSize);
  const measuredExtent = Math.max(baseSize.x, baseSize.y, baseSize.z, MIN_AVATAR_EXTENT);
  const fitScale = THREE.MathUtils.clamp(targetExtent / measuredExtent, MIN_AVATAR_SCALE, 180);
  modelRoot.scale.setScalar(fitScale);

  const fittedBounds = getRenderableBounds(modelRoot);
  modelRoot.position.y -= fittedBounds.min.y;
}

function applyProceduralPose(modelRoot, desiredAnimation, speed, timeSeconds, alpha = 0.18) {
  if (!modelRoot) {
    return;
  }

  let bob = 0;
  let pitch = 0;
  let roll = 0;
  let yaw = 0;
  let scale = 1;

  if (desiredAnimation === "walk" || desiredAnimation === "happywalk") {
    bob = Math.sin(timeSeconds * 9) * 0.05;
    roll = Math.sin(timeSeconds * 9) * 0.09;
    pitch = 0.07;
  } else if (desiredAnimation === "run") {
    bob = Math.sin(timeSeconds * 13) * 0.08;
    roll = Math.sin(timeSeconds * 13) * 0.13;
    pitch = 0.12;
  } else if (desiredAnimation === "wave") {
    bob = Math.sin(timeSeconds * 8) * 0.04;
    roll = Math.sin(timeSeconds * 10) * 0.24;
    pitch = 0.14;
  } else if (desiredAnimation === "heart") {
    bob = Math.sin(timeSeconds * 6) * 0.05;
    scale = 1 + 0.14 * Math.max(0, Math.sin(timeSeconds * 6));
  } else if (desiredAnimation === "sparkle") {
    bob = Math.sin(timeSeconds * 7) * 0.04;
    yaw = Math.sin(timeSeconds * 4) * 0.35;
  } else if (desiredAnimation === "laugh") {
    bob = Math.abs(Math.sin(timeSeconds * 12)) * 0.08;
    pitch = 0.08;
  } else if (desiredAnimation === "jump") {
    bob = Math.abs(Math.sin(timeSeconds * 8)) * 0.18;
    pitch = -0.05;
  } else if (desiredAnimation === "pickup") {
    bob = -0.06;
    pitch = 0.42;
  } else if (desiredAnimation === "openlid") {
    bob = -0.03;
    pitch = 0.3;
    roll = -0.12;
  } else if (desiredAnimation === "sittingvictory") {
    bob = -0.15;
    pitch = 0.45;
    yaw = 0.2;
  } else if (desiredAnimation === "bored") {
    bob = Math.sin(timeSeconds * 2) * 0.02;
    pitch = 0.2;
    roll = Math.sin(timeSeconds * 2) * 0.06;
  } else if (desiredAnimation === "yawn") {
    bob = Math.sin(timeSeconds * 2.5) * 0.03;
    pitch = 0.3;
  } else if (speed > 4) {
    bob = Math.sin(timeSeconds * 7) * 0.03;
  } else {
    bob = Math.sin(timeSeconds * 2) * 0.012;
  }

  modelRoot.position.x = THREE.MathUtils.lerp(modelRoot.position.x, 0, alpha);
  modelRoot.position.z = THREE.MathUtils.lerp(modelRoot.position.z, 0, alpha);
  modelRoot.position.y = THREE.MathUtils.lerp(modelRoot.position.y, bob, alpha);
  modelRoot.rotation.x = THREE.MathUtils.lerp(modelRoot.rotation.x, pitch, alpha);
  modelRoot.rotation.y = THREE.MathUtils.lerp(modelRoot.rotation.y, yaw, alpha);
  modelRoot.rotation.z = THREE.MathUtils.lerp(modelRoot.rotation.z, roll, alpha);
  modelRoot.scale.setScalar(THREE.MathUtils.lerp(modelRoot.scale.x, scale, alpha));
}

function StudioEnvironment({ world }) {
  const width = world.w * WORLD_SCALE;
  const height = world.h * WORLD_SCALE;

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[width + 2.2, height + 2.2]} />
        <meshStandardMaterial color="#251d33" roughness={0.96} metalness={0.05} />
      </mesh>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <planeGeometry args={[width * 0.72, height * 0.72]} />
        <meshStandardMaterial color="#352848" roughness={0.9} metalness={0.08} />
      </mesh>

      <mesh position={[0, 0.25, -height / 2 - 0.2]}>
        <boxGeometry args={[width + 1.6, 0.5, 0.4]} />
        <meshStandardMaterial color="#45305c" roughness={0.85} />
      </mesh>

      <mesh position={[0, 0.25, height / 2 + 0.2]}>
        <boxGeometry args={[width + 1.6, 0.5, 0.4]} />
        <meshStandardMaterial color="#45305c" roughness={0.85} />
      </mesh>

      <mesh position={[-width / 2 - 0.2, 0.25, 0]}>
        <boxGeometry args={[0.4, 0.5, height + 1.6]} />
        <meshStandardMaterial color="#45305c" roughness={0.85} />
      </mesh>

      <mesh position={[width / 2 + 0.2, 0.25, 0]}>
        <boxGeometry args={[0.4, 0.5, height + 1.6]} />
        <meshStandardMaterial color="#45305c" roughness={0.85} />
      </mesh>
    </>
  );
}

function EnvironmentalLighting({ world }) {
  const width = world.w * WORLD_SCALE;
  const height = world.h * WORLD_SCALE;
  const cornerX = width * 0.42;
  const cornerZ = height * 0.42;

  return (
    <>
      <fog attach="fog" args={["#161122", 10, 46]} />

      <hemisphereLight intensity={0.58} color="#6f81dd" groundColor="#2c1224" />
      <ambientLight intensity={0.24} color="#ffe6ca" />

      <directionalLight
        position={[4.4, 9.8, 3.2]}
        intensity={1.08}
        castShadow
        color="#ffd9b3"
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <directionalLight position={[-6.2, 5.4, -4.8]} intensity={0.46} color="#8ea2ff" />

      <pointLight position={[-cornerX, 2.8, -cornerZ]} intensity={0.78} color="#8a96ff" distance={34} decay={2} />
      <pointLight position={[cornerX, 2.3, cornerZ]} intensity={0.92} color="#ffaf77" distance={30} decay={2} />
    </>
  );
}

function lerpAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

function AvatarEntity({ id, isLocal, avatarUrl, playersRef, worldRef }) {
  const groupRef = useRef(null);
  const modelRootRef = useRef(null);
  const mixerRef = useRef(null);
  const actionsRef = useRef(createEmptyActionsMap());
  const activeAnimationRef = useRef("idle");
  const emoteTypeRef = useRef("");
  const assetBundleRef = useRef(null);
  const [emoteType, setEmoteType] = useState("");
  const [assetStatus, setAssetStatus] = useState("loading");

  useEffect(() => {
    let mounted = true;
    setAssetStatus("loading");
    assetBundleRef.current = null;

    loadAvatarBundleWithFallback(avatarUrl)
      .then((bundle) => {
        if (!mounted) {
          return;
        }
        assetBundleRef.current = bundle;
        setAssetStatus("loaded");
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        console.error("Avatar asset load failed:", error);
        setAssetStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [avatarUrl]);

  useEffect(() => {
    if (assetStatus !== "loaded" || !modelRootRef.current || !assetBundleRef.current) {
      return undefined;
    }
    const { scene, clips } = assetBundleRef.current;

    let clonedModel;
    try {
      clonedModel = skeletonClone(scene);
    } catch (error) {
      console.error("Avatar clone failed:", error);
      setAssetStatus("error");
      return undefined;
    }

    // Correct imported armature axis so the avatar stands upright in the Y-up scene.
    clonedModel.rotation.x = -Math.PI / 2;
    clonedModel.rotation.y = MODEL_YAW_OFFSET;

    fitModelToTargetExtent(clonedModel, TARGET_AVATAR_HEIGHT * IN_WORLD_AVATAR_SCALE_MULTIPLIER);

    clonedModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) {
            continue;
          }
          material.transparent = false;
          material.alphaTest = 0.35;
          material.depthWrite = true;
          if ("emissive" in material) {
            material.emissive = new THREE.Color(isLocal ? "#7a3f17" : "#4b3066");
            material.emissiveIntensity = isLocal ? 0.52 : 0.36;
          }
          if ("roughness" in material) {
            material.roughness = Math.min(material.roughness ?? 1, 0.82);
          }
          material.needsUpdate = true;
        }
      }
    });

    modelRootRef.current.add(clonedModel);

    const mixer = new THREE.AnimationMixer(clonedModel);
    const nextActions = createEmptyActionsMap();

    for (const [key, clip] of Object.entries(clips)) {
      if (!SAFE_FBX_CLIP_KEYS.has(key)) {
        continue;
      }

      const preparedClip = prepareClipForModel(clip, clonedModel);
      if (!preparedClip) {
        continue;
      }

      const action = mixer.clipAction(preparedClip);
      if (LOOPING_ANIMATION_KEYS.has(key)) {
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      } else {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      nextActions[key] = action;
    }

    const initialAnimation = nextActions.idle ? "idle" : nextActions.walk ? "walk" : nextActions.run ? "run" : null;
    if (initialAnimation && nextActions[initialAnimation]) {
      nextActions[initialAnimation].reset();
      nextActions[initialAnimation].play();
      mixerRef.current = mixer;
      activeAnimationRef.current = initialAnimation;
    } else {
      mixer.stopAllAction();
      mixerRef.current = null;
      activeAnimationRef.current = "idle";
    }

    actionsRef.current = nextActions;

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }

      actionsRef.current = createEmptyActionsMap();
      activeAnimationRef.current = "idle";

      if (modelRootRef.current) {
        modelRootRef.current.remove(clonedModel);
      }
    };
  }, [assetStatus, isLocal, avatarUrl]);

  useFrame((_, delta) => {
    const player = playersRef.current.get(id);
    if (!player || !groupRef.current) {
      return;
    }

    const scene = worldToScenePosition(worldRef.current, player.displayX, player.displayY);
    groupRef.current.position.x = scene.x;
    groupRef.current.position.y = 0;
    groupRef.current.position.z = scene.z;

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > 1) {
      const targetYaw = Math.atan2(player.vx, player.vy);
      groupRef.current.rotation.y = lerpAngle(groupRef.current.rotation.y, targetYaw, 0.15);
    }

    const desiredAnimation = resolveDesiredAnimation(player);
    if (desiredAnimation !== activeAnimationRef.current) {
      const previousAction = actionsRef.current[activeAnimationRef.current];
      const nextAction = actionsRef.current[desiredAnimation] || actionsRef.current.idle;

      if (previousAction) {
        previousAction.fadeOut(0.14);
      }

      if (nextAction) {
        nextAction.reset();
        nextAction.fadeIn(0.14);
        nextAction.play();
      }

      activeAnimationRef.current = desiredAnimation;
    }

    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }

    const hasRigClipForDesired = Boolean(actionsRef.current[desiredAnimation]);
    if (!mixerRef.current || !hasRigClipForDesired) {
      applyProceduralPose(modelRootRef.current, desiredAnimation, speed, performance.now() / 1000, delta * 12);
    }

    const now = performance.now();
    const nextEmoteType = player.emote && player.emoteUntil > now ? player.emote : "";

    if (nextEmoteType !== emoteTypeRef.current) {
      emoteTypeRef.current = nextEmoteType;
      setEmoteType(nextEmoteType);
    }
  });

  const fallbackColor = useMemo(() => {
    const player = playersRef.current.get(id);
    return player?.color || (isLocal ? LOCAL_PLAYER_COLOR : "#9fb0ff");
  }, [id, isLocal, playersRef]);

  return (
    <group ref={groupRef}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[0.2, 0.28, 20]} />
        <meshStandardMaterial
          color={isLocal ? "#ffd789" : "#c7c4ff"}
          emissive={isLocal ? "#7a4f18" : "#41408c"}
          emissiveIntensity={0.42}
          transparent
          opacity={0.82}
        />
      </mesh>

      <mesh position={[0, 0.58, 0]} visible={assetStatus !== "loaded"} castShadow>
        <sphereGeometry args={[0.26, 24, 24]} />
        <meshStandardMaterial color={fallbackColor} roughness={0.42} metalness={0.05} />
      </mesh>

      <group ref={modelRootRef} />

      {emoteType ? (
        <group position={[0, 1.86, 0]}>
          <mesh>
            <sphereGeometry args={[0.14, 16, 16]} />
            <meshStandardMaterial
              color={
                emoteType === "wave"
                  ? "#8bc8ff"
                  : emoteType === "heart"
                  ? "#ff9eb7"
                  : emoteType === "sparkle"
                  ? "#ffe08a"
                  : "#d6b2ff"
              }
              emissive={
                emoteType === "wave"
                  ? "#306caa"
                  : emoteType === "heart"
                  ? "#8f3355"
                  : emoteType === "sparkle"
                  ? "#8f6b1f"
                  : "#663f96"
              }
              emissiveIntensity={0.5}
            />
          </mesh>
          <mesh position={[0, -0.14, 0]}>
            <cylinderGeometry args={[0.015, 0.015, 0.1, 8]} />
            <meshStandardMaterial color="#f3e6d1" />
          </mesh>
        </group>
      ) : null}

      {isLocal ? (
        <mesh position={[0, 0.08, 0.42]}>
          <sphereGeometry args={[0.05, 12, 12]} />
          <meshStandardMaterial color="#ffecaf" emissive="#ab7a4d" emissiveIntensity={0.45} />
        </mesh>
      ) : null}
    </group>
  );
}

function CharacterPreview({ avatarUrl }) {
  const modelRootRef = useRef(null);
  const mixerRef = useRef(null);
  const assetBundleRef = useRef(null);
  const [assetStatus, setAssetStatus] = useState(avatarUrl ? "loading" : "idle");

  useEffect(() => {
    let mounted = true;

    if (!avatarUrl) {
      setAssetStatus("idle");
      assetBundleRef.current = null;
      return () => {
        mounted = false;
      };
    }

    setAssetStatus("loading");
    assetBundleRef.current = null;

    loadAvatarBundleWithFallback(avatarUrl)
      .then((bundle) => {
        if (!mounted) {
          return;
        }
        assetBundleRef.current = bundle;
        setAssetStatus("loaded");
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }
        console.error("Character preview load failed:", error);
        setAssetStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [avatarUrl]);

  useEffect(() => {
    if (assetStatus !== "loaded" || !modelRootRef.current || !assetBundleRef.current) {
      return undefined;
    }

    const { scene, clips } = assetBundleRef.current;
    let clonedModel;
    try {
      clonedModel = skeletonClone(scene);
    } catch (error) {
      console.error("Character preview clone failed:", error);
      setAssetStatus("error");
      return undefined;
    }

    clonedModel.rotation.x = -Math.PI / 2;
    clonedModel.rotation.y = MODEL_YAW_OFFSET;

    fitModelToTargetExtent(clonedModel, 0.85);

    clonedModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          if (!material) {
            continue;
          }
          material.transparent = false;
          material.depthWrite = true;
          if ("emissive" in material) {
            material.emissive = new THREE.Color("#5d3047");
            material.emissiveIntensity = 0.34;
          }
          material.needsUpdate = true;
        }
      }
    });

    modelRootRef.current.add(clonedModel);
    const mixer = new THREE.AnimationMixer(clonedModel);
    const idleClip = prepareClipForModel(clips.idle || clips.walk, clonedModel);
    if (idleClip) {
      const action = mixer.clipAction(idleClip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
      mixerRef.current = mixer;
    }

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }
      if (modelRootRef.current) {
        modelRootRef.current.remove(clonedModel);
      }
    };
  }, [assetStatus, avatarUrl]);

  useFrame((_, delta) => {
    if (modelRootRef.current) {
      modelRootRef.current.rotation.y += delta * 0.75;
    }
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  if (!avatarUrl) {
    return (
      <mesh position={[0, 0.55, 0]}>
        <sphereGeometry args={[0.24, 18, 18]} />
        <meshStandardMaterial color="#a18ead" roughness={0.56} metalness={0.08} />
      </mesh>
    );
  }

  return (
    <group>
      <group ref={modelRootRef} />
      {assetStatus !== "loaded" ? (
        <mesh position={[0, 0.55, 0]}>
          <sphereGeometry args={[0.22, 18, 18]} />
          <meshStandardMaterial color="#d5a887" roughness={0.56} metalness={0.08} />
        </mesh>
      ) : null}
    </group>
  );
}

function FollowCamera({ playersRef, selfIdRef, worldRef }) {
  const targetPosition = useRef(new THREE.Vector3(0, 11.5, 16.8));
  const lookAtPosition = useRef(new THREE.Vector3(0, 0.6, 0));

  useFrame(({ camera }) => {
    const self = playersRef.current.get(selfIdRef.current);
    if (!self) {
      return;
    }

    const scene = worldToScenePosition(worldRef.current, self.displayX, self.displayY);

    targetPosition.current.set(scene.x + 8.5, 10.8, scene.z + 14.2);
    lookAtPosition.current.set(scene.x, 0.55, scene.z + 0.18);

    camera.position.lerp(targetPosition.current, 0.1);
    camera.lookAt(lookAtPosition.current);
  });

  return null;
}

function SimulationDriver({ stepRef }) {
  useFrame((_, delta) => {
    const step = stepRef.current;
    if (typeof step === "function") {
      step(Math.min(delta, 0.05));
    }
  });

  return null;
}

function ClickMoveSurface({ world, enabled, moveTarget, onMoveCommand }) {
  const width = world.w * WORLD_SCALE;
  const height = world.h * WORLD_SCALE;
  const targetScenePos = moveTarget ? worldToScenePosition(world, moveTarget.x, moveTarget.y) : null;

  const handlePointerDown = useCallback(
    (event) => {
      if (!enabled) {
        return;
      }

      if (typeof event.button === "number" && event.button !== 0) {
        return;
      }

      event.stopPropagation();
      const worldPoint = sceneToWorldPosition(world, event.point.x, event.point.z);
      onMoveCommand(worldPoint.x, worldPoint.y);
    },
    [enabled, onMoveCommand, world]
  );

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]} onPointerDown={handlePointerDown}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>

      {targetScenePos ? (
        <group position={[targetScenePos.x, 0.05, targetScenePos.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.17, 0.23, 24]} />
            <meshBasicMaterial color="#ffe2b6" transparent opacity={0.85} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}>
            <ringGeometry args={[0.27, 0.31, 24]} />
            <meshBasicMaterial color="#ffbe7e" transparent opacity={0.5} />
          </mesh>
        </group>
      ) : null}
    </>
  );
}

function createEmptyProgression() {
  return {
    level: 1,
    xp: 0,
    stars: 0,
    unlocks: [],
    equipped: {
      ringStyle: null,
      emoteBadge: null
    }
  };
}

function normalizeQuestList(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((quest) => ({
    id: quest?.id || "",
    key: quest?.key || "",
    title: quest?.title || "Quest",
    type: quest?.type || "unknown",
    status: quest?.status || "active",
    value: Number.isFinite(quest?.value) ? quest.value : 0,
    target: Number.isFinite(quest?.target) ? quest.target : 1,
    rewards: quest?.rewards || { stars: 0, xp: 0 }
  }));
}

export default function App() {
  const [started, setStarted] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("autostart") === "1";
  });
  const [selectedCharacterId, setSelectedCharacterId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return normalizeCharacterId(params.get("character"));
  });
  const [pendingCharacterId, setPendingCharacterId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("autostart") === "1") {
      return normalizeCharacterId(params.get("character"));
    }
    return null;
  });
  const [playerIds, setPlayerIds] = useState([]);
  const [worldView, setWorldView] = useState(WORLD_DEFAULT);
  const [selfIdState, setSelfIdState] = useState("");
  const [connectionState, setConnectionState] = useState("disconnected");
  const [touchVector, setTouchVector] = useState({ x: 0, y: 0, active: false });
  const [contextActions, setContextActions] = useState([]);
  const [moveTarget, setMoveTarget] = useState(null);
  const [authTab, setAuthTab] = useState("login");
  const [authForm, setAuthForm] = useState({
    email: "",
    password: "",
    displayName: ""
  });
  const [authState, setAuthState] = useState({
    status: "loading",
    accessToken: "",
    refreshToken: "",
    profile: null,
    error: ""
  });
  const [progression, setProgression] = useState(createEmptyProgression());
  const [questList, setQuestList] = useState([]);
  const [roomVoiceEnabled, setRoomVoiceEnabled] = useState(false);
  const [voiceState, setVoiceState] = useState({
    connected: false,
    speaking: false,
    muted: false,
    deafened: false,
    pushToTalk: true,
    nearbySpeakers: []
  });
  const [voiceHint, setVoiceHint] = useState("");
  const [blockedPlayerIds, setBlockedPlayerIds] = useState([]);

  const playersRef = useRef(new Map());
  const worldRef = useRef(WORLD_DEFAULT);
  const socketRef = useRef(null);
  const selfIdRef = useRef("");
  const lastIntentAtRef = useRef(0);
  const keyboardRef = useRef({ up: false, down: false, left: false, right: false });
  const touchInputRef = useRef({ x: 0, y: 0, active: false, pointerId: null });
  const queuedEmoteRef = useRef(undefined);
  const stepRef = useRef(() => {});
  const connectionRef = useRef("disconnected");
  const startedRef = useRef(false);
  const joystickRef = useRef(null);
  const simulationTimeRef = useRef(performance.now());
  const lastInputRef = useRef({ moveX: 0, moveY: 0 });
  const contextActionsRef = useRef([]);
  const selectedCharacterIdRef = useRef(DEFAULT_CHARACTER_ID);
  const clickMoveTargetRef = useRef(null);
  const authRef = useRef(authState);
  const roomIdRef = useRef(DEFAULT_ROOM_ID);
  const blockedPlayerIdsRef = useRef(blockedPlayerIds);
  const progressionRef = useRef(progression);
  const questListRef = useRef(questList);
  const voiceRoomRef = useRef(null);
  const voiceTrackRef = useRef(null);

  const refreshPlayerIds = useCallback(() => {
    setPlayerIds(Array.from(playersRef.current.keys()));
  }, []);

  const refreshRenderState = useCallback(() => {
    const currentSelfId = selfIdRef.current;
    const mode = startedRef.current ? "play" : "start";
    const selfPlayer = currentSelfId ? playersRef.current.get(currentSelfId) : null;

    const others = Array.from(playersRef.current.values())
      .filter((player) => player.id !== currentSelfId)
      .map((player) => ({
        id: player.id,
        x: Math.round(player.displayX),
        y: Math.round(player.displayY),
        anim: resolveDesiredAnimation(player),
        emote: player.emote || null,
        avatar: player.avatar || DEFAULT_CHARACTER_ID
      }));

    return {
      mode,
      coordinateSystem: {
        origin: "top-left of world rectangle",
        xAxis: "positive right",
        yAxis: "positive down",
        scene: "mapped to Three.js XZ plane with Y-up"
      },
      world: {
        w: worldRef.current.w,
        h: worldRef.current.h
      },
      self: selfPlayer
        ? {
            id: selfPlayer.id,
            x: Math.round(selfPlayer.displayX),
            y: Math.round(selfPlayer.displayY),
            vx: Math.round(selfPlayer.vx),
            vy: Math.round(selfPlayer.vy),
            anim: resolveDesiredAnimation(selfPlayer),
            emote: selfPlayer.emote || null,
            avatar: selfPlayer.avatar || DEFAULT_CHARACTER_ID
          }
        : null,
      others,
      connection: connectionRef.current,
      input: lastInputRef.current,
      moveTarget: clickMoveTargetRef.current
        ? {
            x: Math.round(clickMoveTargetRef.current.x),
            y: Math.round(clickMoveTargetRef.current.y)
          }
        : null,
      auth: {
        status: authRef.current.status,
        userId: authRef.current.profile?.id || null
      },
      progression: {
        level: progression.level,
        xp: progression.xp,
        stars: progression.stars,
        unlockCount: Array.isArray(progression.unlocks) ? progression.unlocks.length : 0
      },
      quests: questList.map((quest) => ({
        id: quest.id,
        status: quest.status,
        value: quest.value,
        target: quest.target
      })),
      voice: {
        connected: voiceState.connected,
        speaking: voiceState.speaking,
        muted: voiceState.muted,
        deafened: voiceState.deafened,
        pushToTalk: voiceState.pushToTalk,
        nearbySpeakers: voiceState.nearbySpeakers
      },
      availableActions: contextActionsRef.current,
      selectedCharacter: selectedCharacterIdRef.current,
      pendingCharacter: pendingCharacterId
    };
  }, [pendingCharacterId, progression, questList, voiceState]);

  const emitJoinRequest = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) {
      return;
    }

    const platform = window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop";
    const currentAuth = authRef.current;

    socket.emit("join", {
      authToken: currentAuth.accessToken || undefined,
      roomId: roomIdRef.current,
      name: currentAuth.profile?.displayName || "Guest",
      color: LOCAL_PLAYER_COLOR,
      avatar: selectedCharacterIdRef.current,
      client: {
        platform,
        version: CLIENT_VERSION
      }
    });
  }, []);

  const enqueueAction = useCallback((type) => {
    if (!isValidEmote(type)) {
      return;
    }

    if (CONTEXT_ACTION_ORDER.includes(type)) {
      const self = playersRef.current.get(selfIdRef.current);
      if (!self) {
        return;
      }

      const available = resolveContextActions(self, worldRef.current, lastInputRef.current);
      if (!available.includes(type)) {
        return;
      }
    }

    queuedEmoteRef.current = type;
  }, []);

  const readInputState = useCallback(() => {
    let moveX = 0;
    let moveY = 0;

    if (touchInputRef.current.active) {
      moveX = touchInputRef.current.x;
      moveY = touchInputRef.current.y;
    } else {
      moveX = Number(keyboardRef.current.right) - Number(keyboardRef.current.left);
      moveY = Number(keyboardRef.current.down) - Number(keyboardRef.current.up);
    }

    const normalized = normalizeAxis(moveX, moveY);
    const emote = queuedEmoteRef.current;
    queuedEmoteRef.current = undefined;

    return {
      moveX: normalized.x,
      moveY: normalized.y,
      manualActive: touchInputRef.current.active || Math.hypot(moveX, moveY) > 0.001,
      emote
    };
  }, []);

  const stepSimulation = useCallback(
    (deltaSeconds) => {
      if (!startedRef.current) {
        return;
      }

      const dt = Math.min(0.05, Math.max(1 / 240, deltaSeconds));
      simulationTimeRef.current += dt * 1000;
      const now = simulationTimeRef.current;
      const input = readInputState();

      const self = playersRef.current.get(selfIdRef.current);
      let moveX = input.moveX;
      let moveY = input.moveY;

      if (input.manualActive && clickMoveTargetRef.current) {
        clickMoveTargetRef.current = null;
        setMoveTarget(null);
      } else if (self && clickMoveTargetRef.current) {
        const dx = clickMoveTargetRef.current.x - self.x;
        const dy = clickMoveTargetRef.current.y - self.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= CLICK_MOVE_STOP_RADIUS) {
          clickMoveTargetRef.current = null;
          setMoveTarget(null);
          moveX = 0;
          moveY = 0;
        } else {
          const autoMove = normalizeAxis(dx, dy);
          moveX = autoMove.x;
          moveY = autoMove.y;
        }
      }

      const normalized = normalizeAxis(moveX, moveY);
      lastInputRef.current = { moveX: normalized.x, moveY: normalized.y };

      if (self) {
        self.vx = normalized.x * PLAYER_SPEED;
        self.vy = normalized.y * PLAYER_SPEED;
        const localSpeed = Math.hypot(self.vx, self.vy);
        self.anim = localSpeed > PLAYER_SPEED * 0.72 ? "run" : localSpeed > 8 ? "walk" : "idle";

        self.x = clamp(self.x + self.vx * dt, 40, worldRef.current.w - 40);
        self.y = clamp(self.y + self.vy * dt, 40, worldRef.current.h - 40);

        const correctingAlpha = Math.hypot(self.vx, self.vy) > 8 ? 0.02 : 0.15;
        self.x = lerp(self.x, self.serverX, correctingAlpha);
        self.y = lerp(self.y, self.serverY, correctingAlpha);

        if (socketRef.current && now - lastIntentAtRef.current >= INTENT_SEND_INTERVAL_MS) {
          socketRef.current.emit("intent", {
            ix: normalized.x,
            iy: normalized.y
          });
          lastIntentAtRef.current = now;
        }

        if (input.emote && socketRef.current) {
          socketRef.current.emit("emote", { type: input.emote });
          self.emote = input.emote;
          self.emoteUntil = now + getActionDurationMs(input.emote);
          if (input.emote === "happywalk") {
            self.activeStyle = "happywalk";
          }
        }
      }

      let playerSetChanged = false;

      for (const [id, player] of playersRef.current.entries()) {
        if (id !== selfIdRef.current) {
          player.x = lerp(player.x, player.serverX, 0.28);
          player.y = lerp(player.y, player.serverY, 0.28);
        }

        const smoothing = id === selfIdRef.current ? 0.35 : 0.18;
        player.displayX = lerp(player.displayX, player.x, smoothing);
        player.displayY = lerp(player.displayY, player.y, smoothing);

        if (player.emote && player.emoteUntil <= now) {
          player.emote = null;
        }

        if (player.activeStyle && player.emote !== "happywalk" && now - player.emoteUntil > 1600) {
          player.activeStyle = null;
        }

        if (id !== selfIdRef.current && now - player.lastStateAt > 12000) {
          playersRef.current.delete(id);
          playerSetChanged = true;
        }

        if (Math.hypot(player.vx, player.vy) > 8) {
          player.idleForMs = 0;
        } else {
          player.idleForMs = (player.idleForMs || 0) + dt * 1000;
        }
      }

      const selfAfterUpdate = playersRef.current.get(selfIdRef.current);
      if (selfAfterUpdate) {
        const available = resolveContextActions(selfAfterUpdate, worldRef.current, lastInputRef.current);
        if (available.join("|") !== contextActionsRef.current.join("|")) {
          contextActionsRef.current = available;
          setContextActions(available);
        }
      } else if (contextActionsRef.current.length) {
        contextActionsRef.current = [];
        setContextActions([]);
      }

      if (playerSetChanged) {
        refreshPlayerIds();
      }
    },
    [readInputState, refreshPlayerIds]
  );

  useEffect(() => {
    stepRef.current = stepSimulation;
  }, [stepSimulation]);

  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify(refreshRenderState());

    window.advanceTime = (ms) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let index = 0; index < steps; index += 1) {
        const step = stepRef.current;
        if (typeof step === "function") {
          step(1 / 60);
        }
      }
    };

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [refreshRenderState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "w" || key === "arrowup") keyboardRef.current.up = true;
      if (key === "s" || key === "arrowdown") keyboardRef.current.down = true;
      if (key === "a" || key === "arrowleft") keyboardRef.current.left = true;
      if (key === "d" || key === "arrowright") keyboardRef.current.right = true;

      if (!event.repeat) {
        if (key === "1") enqueueAction("wave");
        if (key === "2") enqueueAction("heart");
        if (key === "3") enqueueAction("sparkle");
        if (key === "4") enqueueAction("laugh");
        if (key === "5") enqueueAction("jump");
        if (key === "6") enqueueAction("pickup");
        if (key === "7") enqueueAction("openlid");
        if (key === "8") enqueueAction("sittingvictory");
        if (key === "9") enqueueAction("happywalk");
        if (key === "enter") enqueueAction("wave");
        if (key === " ") enqueueAction("heart");

        if (key === "f") {
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(() => {});
          } else if (document.fullscreenElement && document.exitFullscreen) {
            document.exitFullscreen().catch(() => {});
          }
        }
      }

      if (
        [
          "w",
          "a",
          "s",
          "d",
          "arrowup",
          "arrowdown",
          "arrowleft",
          "arrowright",
          "1",
          "2",
          "3",
          "4",
          "5",
          "6",
          "7",
          "8",
          "9",
          "enter",
          " ",
          "f"
        ].includes(key)
      ) {
        event.preventDefault();
      }
    };

    const onKeyUp = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "w" || key === "arrowup") keyboardRef.current.up = false;
      if (key === "s" || key === "arrowdown") keyboardRef.current.down = false;
      if (key === "a" || key === "arrowleft") keyboardRef.current.left = false;
      if (key === "d" || key === "arrowright") keyboardRef.current.right = false;
    };

    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [enqueueAction]);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  useEffect(() => {
    authRef.current = authState;
  }, [authState]);

  useEffect(() => {
    blockedPlayerIdsRef.current = blockedPlayerIds;
  }, [blockedPlayerIds]);

  useEffect(() => {
    progressionRef.current = progression;
  }, [progression]);

  useEffect(() => {
    questListRef.current = questList;
  }, [questList]);

  useEffect(() => {
    selectedCharacterIdRef.current = normalizeCharacterId(selectedCharacterId);
  }, [selectedCharacterId]);

  useEffect(() => {
    if (authState.status !== "authenticated" || !authState.accessToken) {
      return;
    }
    updateAvatar(authState.accessToken, selectedCharacterIdRef.current).catch(() => {});
  }, [authState.accessToken, authState.status, selectedCharacterId]);

  const applyAuthPayload = useCallback((payload, fallbackTokens = null) => {
    const nextAccessToken = payload?.accessToken || fallbackTokens?.accessToken || "";
    const nextRefreshToken = payload?.refreshToken || fallbackTokens?.refreshToken || "";
    const nextProfile = payload?.profile || null;
    const nextProgression = payload?.progression || createEmptyProgression();
    const nextQuests = normalizeQuestList(payload?.quests);

    const nextAuthState = {
      status: nextProfile ? "authenticated" : "guest",
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      profile: nextProfile,
      error: ""
    };

    authRef.current = nextAuthState;
    setAuthState(nextAuthState);
    setProgression(nextProgression);
    setQuestList(nextQuests);

    if (nextAccessToken || nextRefreshToken) {
      saveStoredSession({ accessToken: nextAccessToken, refreshToken: nextRefreshToken });
    }
  }, []);

  const setGuestSession = useCallback((errorMessage = "") => {
    clearStoredSession();
    const nextAuthState = {
      status: "guest",
      accessToken: "",
      refreshToken: "",
      profile: null,
      error: errorMessage
    };
    authRef.current = nextAuthState;
    setAuthState(nextAuthState);
    setProgression(createEmptyProgression());
    setQuestList([]);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      const stored = loadStoredSession();
      if (!stored.accessToken && !stored.refreshToken) {
        if (mounted) {
          setGuestSession("");
        }
        return;
      }

      try {
        let accessToken = stored.accessToken;
        let refreshToken = stored.refreshToken;

        if (!accessToken && refreshToken) {
          const refreshed = await refreshAuth({ refreshToken });
          accessToken = refreshed.accessToken;
          refreshToken = refreshed.refreshToken || refreshToken;
          saveStoredSession({ accessToken, refreshToken });
        }

        if (!accessToken) {
          throw new Error("missing_access_token");
        }

        const profilePayload = await fetchProfile(accessToken);
        if (!mounted) {
          return;
        }

        applyAuthPayload(
          {
            ...profilePayload,
            accessToken,
            refreshToken
          },
          { accessToken, refreshToken }
        );
      } catch (error) {
        const message = error?.message || "auth_bootstrap_failed";
        if (mounted) {
          setGuestSession(message);
        }
      }
    }

    bootstrapAuth();

    return () => {
      mounted = false;
    };
  }, [applyAuthPayload, setGuestSession]);

  useEffect(() => {
    if (!started) {
      return undefined;
    }

    const socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnection: true
    });

    socketRef.current = socket;
    connectionRef.current = "connecting";
    setConnectionState("connecting");

    simulationTimeRef.current = performance.now();

    socket.on("connect", () => {
      connectionRef.current = "connected";
      setConnectionState("connected");
      emitJoinRequest();
    });

    socket.on("disconnect", () => {
      connectionRef.current = "disconnected";
      setConnectionState("disconnected");
    });

    socket.on("welcome", (msg) => {
      const incomingWorld =
        msg?.world && Number.isFinite(msg.world.w) && Number.isFinite(msg.world.h)
          ? msg.world
          : WORLD_DEFAULT;

      worldRef.current = incomingWorld;
      setWorldView(incomingWorld);

      const nextPlayers = new Map();
      for (const player of msg?.players || []) {
        const built = createPlayerState(player, incomingWorld);
        nextPlayers.set(built.id, built);
      }

      if (msg?.selfId && !nextPlayers.has(msg.selfId)) {
        nextPlayers.set(
          msg.selfId,
          createPlayerState(
            { id: msg.selfId, color: LOCAL_PLAYER_COLOR, avatar: selectedCharacterIdRef.current },
            incomingWorld
          )
        );
      }

      playersRef.current = nextPlayers;
      selfIdRef.current = msg?.selfId || "";
      roomIdRef.current = typeof msg?.roomId === "string" && msg.roomId ? msg.roomId : DEFAULT_ROOM_ID;
      setSelfIdState(selfIdRef.current);
      setRoomVoiceEnabled(Boolean(msg?.roomVoiceEnabled));

      if (msg?.profile || msg?.progression || msg?.quests) {
        const currentAuth = authRef.current;
        applyAuthPayload(
          {
            profile: msg.profile || currentAuth.profile,
            progression: msg.progression || progressionRef.current,
            quests: msg.quests || questListRef.current,
            accessToken: currentAuth.accessToken,
            refreshToken: currentAuth.refreshToken
          },
          currentAuth
        );
      }

      refreshPlayerIds();
    });

    socket.on("join_error", (payload) => {
      const code = payload?.code || "join_error";
      connectionRef.current = "error";
      setConnectionState(`error:${code}`);
    });

    socket.on("player_joined", (player) => {
      if (!player?.id) {
        return;
      }

      if (playersRef.current.has(player.id)) {
        return;
      }

      playersRef.current.set(player.id, createPlayerState(player, worldRef.current));
      refreshPlayerIds();
    });

    socket.on("player_left", ({ id }) => {
      if (!id || !playersRef.current.has(id)) {
        return;
      }

      playersRef.current.delete(id);

      if (id === selfIdRef.current) {
        selfIdRef.current = "";
        setSelfIdState("");
      }

      refreshPlayerIds();
    });

    socket.on("state", (msg) => {
      let changed = false;

      for (const incoming of msg?.players || []) {
        if (!incoming?.id) {
          continue;
        }

        let player = playersRef.current.get(incoming.id);
        if (!player) {
          player = createPlayerState(incoming, worldRef.current);
          playersRef.current.set(incoming.id, player);
          changed = true;
        }

        if (incoming.color) {
          player.color = incoming.color;
        }
        if (incoming.avatar) {
          player.avatar = normalizeCharacterId(incoming.avatar);
        }

        player.serverX = Number.isFinite(incoming.x) ? incoming.x : player.serverX;
        player.serverY = Number.isFinite(incoming.y) ? incoming.y : player.serverY;
        player.vx = Number.isFinite(incoming.vx) ? incoming.vx : player.vx;
        player.vy = Number.isFinite(incoming.vy) ? incoming.vy : player.vy;
        const inferredSpeed = Math.hypot(player.vx, player.vy);
        player.anim =
          incoming.anim || (inferredSpeed > PLAYER_SPEED * 0.72 ? "run" : inferredSpeed > 8 ? "walk" : "idle");
        player.lastStateAt = simulationTimeRef.current;

        if (incoming.id !== selfIdRef.current) {
          player.x = player.serverX;
          player.y = player.serverY;
        }
      }

      if (changed) {
        refreshPlayerIds();
      }
    });

    socket.on("emote", ({ id, type }) => {
      if (!id || !isValidEmote(type)) {
        return;
      }

      const player = playersRef.current.get(id);
      if (!player) {
        return;
      }

      player.emote = type;
      player.emoteUntil = simulationTimeRef.current + getActionDurationMs(type);
      if (type === "happywalk") {
        player.activeStyle = "happywalk";
      }
    });

    socket.on("quest_progress", ({ questId, value, completed }) => {
      if (!questId) {
        return;
      }

      setQuestList((previous) =>
        previous.map((quest) =>
          quest.id === questId
            ? {
                ...quest,
                value: Number.isFinite(value) ? value : quest.value,
                status: completed ? "completed" : quest.status
              }
            : quest
        )
      );
    });

    socket.on("currency_grant", ({ amount, balance }) => {
      setProgression((previous) => ({
        ...previous,
        stars: Number.isFinite(balance) ? balance : previous.stars + (Number.isFinite(amount) ? amount : 0)
      }));
    });

    socket.on("unlock_grant", ({ unlockId }) => {
      if (!unlockId) {
        return;
      }

      setProgression((previous) => {
        const nextUnlocks = Array.isArray(previous.unlocks) ? [...previous.unlocks] : [];
        if (!nextUnlocks.includes(unlockId)) {
          nextUnlocks.push(unlockId);
        }
        return {
          ...previous,
          unlocks: nextUnlocks
        };
      });
    });

    socket.on("voice_presence", ({ id, speaking, muted }) => {
      if (!id || blockedPlayerIdsRef.current.includes(id)) {
        return;
      }

      setVoiceState((previous) => {
        const nearbySpeakers = new Set(previous.nearbySpeakers || []);
        if (speaking && !muted) {
          nearbySpeakers.add(id);
        } else {
          nearbySpeakers.delete(id);
        }
        return {
          ...previous,
          nearbySpeakers: Array.from(nearbySpeakers)
        };
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      connectionRef.current = "disconnected";
      setConnectionState("disconnected");
      const localTrack = voiceTrackRef.current;
      const room = voiceRoomRef.current;
      voiceTrackRef.current = null;
      voiceRoomRef.current = null;
      try {
        localTrack?.stop?.();
      } catch {
        // no-op
      }
      room?.disconnect?.().catch(() => {});
      setVoiceState((previous) => ({ ...previous, connected: false, nearbySpeakers: [] }));
      playersRef.current = new Map();
      selfIdRef.current = "";
      setSelfIdState("");
      setPlayerIds([]);
      contextActionsRef.current = [];
      setContextActions([]);
    };
  }, [applyAuthPayload, emitJoinRequest, refreshPlayerIds, selectedCharacterId, started]);

  const confirmCharacterSelection = useCallback((characterId) => {
    const normalized = normalizeCharacterId(characterId);
    setSelectedCharacterId(normalized);
    setPendingCharacterId(normalized);
    setStarted(true);

    if (authRef.current.accessToken) {
      updateAvatar(authRef.current.accessToken, normalized).catch(() => {});
    }

    if (startedRef.current) {
      emitJoinRequest();
    }
  }, [emitJoinRequest]);

  const handleCharacterTap = useCallback(
    (characterId) => {
      const normalized = normalizeCharacterId(characterId);
      if (pendingCharacterId !== normalized) {
        setPendingCharacterId(normalized);
        return;
      }
      confirmCharacterSelection(normalized);
    },
    [confirmCharacterSelection, pendingCharacterId]
  );

  const handleStart = useCallback(() => {
    if (!pendingCharacterId) {
      return;
    }
    confirmCharacterSelection(pendingCharacterId);
  }, [confirmCharacterSelection, pendingCharacterId]);

  const handleAuthFieldChange = useCallback((field, value) => {
    setAuthForm((previous) => ({
      ...previous,
      [field]: value
    }));
  }, []);

  const handleAuthSubmit = useCallback(async () => {
    const email = authForm.email.trim();
    const password = authForm.password;
    const displayName = authForm.displayName.trim();

    if (!email || !password || (authTab === "signup" && !displayName)) {
      setAuthState((previous) => ({
        ...previous,
        error: "Provide all required auth fields."
      }));
      return;
    }

    setAuthState((previous) => ({
      ...previous,
      status: "loading",
      error: ""
    }));

    try {
      const payload =
        authTab === "signup"
          ? await signup({ email, password, displayName })
          : await login({ email, password });

      applyAuthPayload(payload);

      if (payload?.accessToken && selectedCharacterIdRef.current) {
        updateAvatar(payload.accessToken, selectedCharacterIdRef.current).catch(() => {});
      }

      if (startedRef.current) {
        emitJoinRequest();
      }
    } catch (error) {
      setAuthState((previous) => ({
        ...previous,
        status: "guest",
        error: error?.message || "Authentication failed."
      }));
    }
  }, [applyAuthPayload, authForm.displayName, authForm.email, authForm.password, authTab, emitJoinRequest]);

  const handleLogout = useCallback(async () => {
    const refreshToken = authRef.current.refreshToken;

    try {
      if (refreshToken) {
        await logout({ refreshToken });
      }
    } catch {
      // ignore network failures on logout
    }

    setGuestSession("");

    if (startedRef.current) {
      emitJoinRequest();
    }
  }, [emitJoinRequest, setGuestSession]);

  const emitVoiceState = useCallback(
    (nextVoiceState) => {
      if (!socketRef.current) {
        return;
      }
      socketRef.current.emit("voice_state", nextVoiceState);
    },
    []
  );

  const syncVoiceTrack = useCallback((nextVoiceState) => {
    const localTrack = voiceTrackRef.current;
    if (!localTrack) {
      return;
    }

    const shouldTransmit =
      nextVoiceState.connected &&
      !nextVoiceState.muted &&
      !nextVoiceState.deafened &&
      (!nextVoiceState.pushToTalk || nextVoiceState.speaking);

    if (shouldTransmit) {
      localTrack.unmute?.();
    } else {
      localTrack.mute?.();
    }
  }, []);

  const disconnectVoiceTransport = useCallback(async () => {
    const localTrack = voiceTrackRef.current;
    const room = voiceRoomRef.current;

    voiceTrackRef.current = null;
    voiceRoomRef.current = null;

    try {
      if (localTrack) {
        localTrack.stop?.();
      }
    } catch {
      // no-op
    }

    try {
      if (room) {
        await room.disconnect();
      }
    } catch {
      // no-op
    }
  }, []);

  const handleToggleVoiceConnected = useCallback(async () => {
    if (!roomVoiceEnabled) {
      setVoiceHint("Voice is unavailable in this room.");
      return;
    }

    const nextConnected = !voiceState.connected;

    if (nextConnected) {
      if (!authRef.current.accessToken) {
        setVoiceHint("Login is required to join voice.");
        return;
      }

      try {
        const tokenResponse = await fetchVoiceToken(authRef.current.accessToken, roomIdRef.current);
        if (!tokenResponse?.url || !tokenResponse?.token) {
          throw new Error("voice_not_configured");
        }

        const { Room, createLocalAudioTrack } = await import("livekit-client");
        const room = new Room({
          adaptiveStream: true,
          dynacast: true
        });

        room.on("activeSpeakersChanged", (speakers) => {
          setVoiceState((previous) => ({
            ...previous,
            nearbySpeakers: speakers.map((speaker) => speaker.identity).filter(Boolean)
          }));
        });

        room.on("disconnected", () => {
          setVoiceState((previous) => ({
            ...previous,
            connected: false,
            speaking: false,
            nearbySpeakers: []
          }));
        });

        await room.connect(tokenResponse.url, tokenResponse.token);
        const localTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        });
        await room.localParticipant.publishTrack(localTrack);

        voiceRoomRef.current = room;
        voiceTrackRef.current = localTrack;
        localTrack.mute?.();
        setVoiceHint("Voice connected.");
      } catch (error) {
        setVoiceHint(`Voice setup failed: ${error?.message || "unknown_error"}`);
        return;
      }
    } else {
      await disconnectVoiceTransport();
      setVoiceHint("Voice disconnected.");
    }

    setVoiceState((previous) => {
      const nextState = {
        ...previous,
        connected: nextConnected,
        speaking: false
      };
      syncVoiceTrack(nextState);
      emitVoiceState(nextState);
      return nextState;
    });
  }, [disconnectVoiceTransport, emitVoiceState, roomVoiceEnabled, syncVoiceTrack, voiceState.connected]);

  const handleToggleVoiceMuted = useCallback(() => {
    setVoiceState((previous) => {
      const nextState = {
        ...previous,
        muted: !previous.muted
      };
      syncVoiceTrack(nextState);
      emitVoiceState(nextState);
      return nextState;
    });
  }, [emitVoiceState, syncVoiceTrack]);

  const handleToggleVoiceDeafened = useCallback(() => {
    setVoiceState((previous) => {
      const nextState = {
        ...previous,
        deafened: !previous.deafened
      };
      syncVoiceTrack(nextState);
      emitVoiceState(nextState);
      return nextState;
    });
  }, [emitVoiceState, syncVoiceTrack]);

  const handleTogglePushToTalk = useCallback(() => {
    setVoiceState((previous) => {
      const nextState = {
        ...previous,
        pushToTalk: !previous.pushToTalk
      };
      syncVoiceTrack(nextState);
      emitVoiceState(nextState);
      return nextState;
    });
  }, [emitVoiceState, syncVoiceTrack]);

  const handleToggleSpeaking = useCallback(() => {
    setVoiceState((previous) => {
      const nextState = {
        ...previous,
        speaking: !previous.speaking
      };
      syncVoiceTrack(nextState);
      emitVoiceState(nextState);
      return nextState;
    });
  }, [emitVoiceState, syncVoiceTrack]);

  const handleQuickReport = useCallback(() => {
    const selfId = selfIdRef.current;
    const target = Array.from(playersRef.current.keys()).find((id) => id !== selfId && !blockedPlayerIdsRef.current.includes(id));
    if (!target || !socketRef.current) {
      return;
    }
    socketRef.current.emit("report_player", { targetPlayerId: target, reason: "quick_report" });
    setBlockedPlayerIds((previous) => (previous.includes(target) ? previous : [...previous, target]));
  }, []);

  const updateTouchVector = useCallback((clientX, clientY) => {
    if (!joystickRef.current) {
      return;
    }

    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const radius = rect.width * 0.38;

    const dx = clientX - centerX;
    const dy = clientY - centerY;

    const distance = Math.hypot(dx, dy);
    const limitedDistance = Math.min(distance, radius);
    const angle = Math.atan2(dy, dx);

    const knobX = Math.cos(angle) * limitedDistance;
    const knobY = Math.sin(angle) * limitedDistance;

    const normalizedX = clamp(knobX / radius, -1, 1);
    const normalizedY = clamp(knobY / radius, -1, 1);

    touchInputRef.current.x = normalizedX;
    touchInputRef.current.y = normalizedY;
    touchInputRef.current.active = true;

    setTouchVector({
      x: normalizedX,
      y: normalizedY,
      active: true
    });
  }, []);

  const clearTouchVector = useCallback(() => {
    touchInputRef.current = { x: 0, y: 0, active: false, pointerId: null };
    setTouchVector({ x: 0, y: 0, active: false });
  }, []);

  const handleJoystickPointerDown = useCallback(
    (event) => {
      if (!started) {
        return;
      }

      touchInputRef.current.pointerId = event.pointerId;
      touchInputRef.current.active = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      updateTouchVector(event.clientX, event.clientY);
    },
    [started, updateTouchVector]
  );

  const handleJoystickPointerMove = useCallback(
    (event) => {
      if (!touchInputRef.current.active || touchInputRef.current.pointerId !== event.pointerId) {
        return;
      }

      updateTouchVector(event.clientX, event.clientY);
    },
    [updateTouchVector]
  );

  const handleJoystickPointerUp = useCallback(
    (event) => {
      if (touchInputRef.current.pointerId !== event.pointerId) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      clearTouchVector();
    },
    [clearTouchVector]
  );

  const isCoarsePointer = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("touch") === "1") {
      return true;
    }
    return window.matchMedia("(pointer: coarse)").matches;
  }, []);

  const pendingCharacter = pendingCharacterId ? getCharacterById(pendingCharacterId) : null;
  const selectedCharacter = getCharacterById(selectedCharacterId);

  const handleMoveCommand = useCallback((nextX, nextY) => {
    if (!startedRef.current) {
      return;
    }

    const boundedTarget = {
      x: clamp(nextX, 40, worldRef.current.w - 40),
      y: clamp(nextY, 40, worldRef.current.h - 40)
    };

    clickMoveTargetRef.current = boundedTarget;
    setMoveTarget(boundedTarget);
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#100d17" }}>
      <Canvas shadows camera={{ position: [8.5, 10.8, 14.2], fov: 46 }}>
        <color attach="background" args={["#140f1d"]} />

        <EnvironmentalLighting world={worldView} />

        <StudioEnvironment world={worldView} />
        <ClickMoveSurface world={worldView} enabled={started} moveTarget={moveTarget} onMoveCommand={handleMoveCommand} />

        <SimulationDriver stepRef={stepRef} />
        <FollowCamera playersRef={playersRef} selfIdRef={selfIdRef} worldRef={worldRef} />

        {playerIds.map((id) => (
          <AvatarEntity
            key={id}
            id={id}
            isLocal={id === selfIdState}
            avatarUrl={
              getCharacterById(
                playersRef.current.get(id)?.avatar || (id === selfIdState ? selectedCharacter.id : DEFAULT_CHARACTER_ID)
              ).avatarUrl
            }
            playersRef={playersRef}
            worldRef={worldRef}
          />
        ))}

      </Canvas>

      {!started ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background:
              "radial-gradient(circle at 20% 10%, rgba(120, 75, 160, 0.34), transparent 45%), radial-gradient(circle at 80% 85%, rgba(255, 176, 122, 0.2), transparent 50%), rgba(10, 8, 17, 0.58)",
            color: "#f8edda",
            padding: "24px"
          }}
        >
          <div
            style={{
              width: "min(1160px, 100%)",
              backdropFilter: "blur(10px)",
              padding: isCoarsePointer ? "16px" : "24px",
              borderRadius: "18px",
              background: "rgba(26, 16, 39, 0.72)",
              border: "1px solid rgba(255, 255, 255, 0.16)"
            }}
          >
            <h1 style={{ margin: "0 0 8px", fontSize: "1.9rem", letterSpacing: "0.04em" }}>Choose Your Character</h1>
            <p style={{ margin: "0 0 16px", lineHeight: 1.5, color: "#f3d9bc" }}>
              Tap once to magnify and preview in 3D. Tap the same character again to confirm and enter the studio.
            </p>

            <div
              style={{
                marginBottom: 14,
                border: "1px solid rgba(255, 255, 255, 0.16)",
                borderRadius: 14,
                padding: isCoarsePointer ? "10px" : "12px",
                background: "rgba(21, 14, 33, 0.74)"
              }}
            >
              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setAuthTab("login")}
                  style={{
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: 9,
                    padding: "6px 10px",
                    color: "#fff7e7",
                    background: authTab === "login" ? "rgba(80, 53, 117, 0.88)" : "rgba(34,24,50,0.84)",
                    cursor: "pointer"
                  }}
                >
                  Login
                </button>
                <button
                  type="button"
                  onClick={() => setAuthTab("signup")}
                  style={{
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: 9,
                    padding: "6px 10px",
                    color: "#fff7e7",
                    background: authTab === "signup" ? "rgba(80, 53, 117, 0.88)" : "rgba(34,24,50,0.84)",
                    cursor: "pointer"
                  }}
                >
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  style={{
                    border: "1px solid rgba(255,255,255,0.16)",
                    borderRadius: 9,
                    padding: "6px 10px",
                    color: "#fff7e7",
                    background: "rgba(54, 29, 41, 0.84)",
                    cursor: "pointer"
                  }}
                >
                  Guest mode
                </button>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCoarsePointer ? "1fr" : authTab === "signup" ? "1fr 1fr 1fr auto" : "1fr 1fr auto",
                  gap: 8
                }}
              >
                <input
                  value={authForm.email}
                  onChange={(event) => handleAuthFieldChange("email", event.target.value)}
                  placeholder="Email"
                  autoCapitalize="off"
                  style={{
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(17,12,27,0.88)",
                    color: "#fff6e8",
                    padding: "8px 10px"
                  }}
                />
                <input
                  type="password"
                  value={authForm.password}
                  onChange={(event) => handleAuthFieldChange("password", event.target.value)}
                  placeholder="Password"
                  style={{
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "rgba(17,12,27,0.88)",
                    color: "#fff6e8",
                    padding: "8px 10px"
                  }}
                />
                {authTab === "signup" ? (
                  <input
                    value={authForm.displayName}
                    onChange={(event) => handleAuthFieldChange("displayName", event.target.value)}
                    placeholder="Display name"
                    style={{
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: "rgba(17,12,27,0.88)",
                      color: "#fff6e8",
                      padding: "8px 10px"
                    }}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={handleAuthSubmit}
                  style={{
                    border: "none",
                    borderRadius: 10,
                    padding: "8px 12px",
                    color: "#2d1937",
                    background: "linear-gradient(135deg, #ffcf99 0%, #ffc485 45%, #f6a5a8 100%)",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  {authTab === "signup" ? "Create" : "Login"}
                </button>
              </div>

              <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#ffd8be" }}>
                {authState.status === "authenticated"
                  ? `Signed in as ${authState.profile?.displayName || "Player"}`
                  : authState.error
                  ? `Auth: ${authState.error}`
                  : "No account required, but progression needs login."}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: isCoarsePointer ? "1fr" : "minmax(0, 1.15fr) minmax(0, 0.85fr)",
                gap: isCoarsePointer ? 14 : 18,
                alignItems: "stretch"
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isCoarsePointer ? "repeat(2, minmax(0, 1fr))" : "repeat(5, minmax(0, 1fr))",
                  gap: 10
                }}
              >
                {CHARACTER_OPTIONS.map((character) => {
                  const isPending = pendingCharacterId === character.id;
                  return (
                    <button
                      key={character.id}
                      id={`char-card-${character.id}`}
                      type="button"
                      onClick={() => handleCharacterTap(character.id)}
                      style={{
                        position: "relative",
                        border: isPending
                          ? "2px solid rgba(255, 214, 166, 0.95)"
                          : "1px solid rgba(255, 255, 255, 0.18)",
                        borderRadius: 14,
                        overflow: "hidden",
                        padding: 0,
                        background: "rgba(28, 18, 45, 0.72)",
                        cursor: "pointer",
                        transform: isPending ? "scale(1.08)" : "scale(1)",
                        boxShadow: isPending ? "0 10px 26px rgba(255, 166, 101, 0.28)" : "none",
                        transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
                        minHeight: isCoarsePointer ? 132 : 122
                      }}
                    >
                      <img
                        src={character.cardImageUrl}
                        alt={character.label}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                          filter: isPending ? "saturate(1.12) brightness(1.05)" : "saturate(0.86) brightness(0.9)"
                        }}
                      />
                      <img
                        src={CHAR_SELECT_HOVERED_EFFECT_URL}
                        alt=""
                        aria-hidden
                        onError={(event) => {
                          if (event.currentTarget.src.endsWith(CHAR_SELECT_HOVERED_EFFECT_FALLBACK_URL)) {
                            return;
                          }
                          event.currentTarget.src = CHAR_SELECT_HOVERED_EFFECT_FALLBACK_URL;
                        }}
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          opacity: isPending ? 0.26 : 0.12,
                          pointerEvents: "none"
                        }}
                      />
                      {isPending ? (
                        <img
                          src={CHAR_SELECT_SELECTED_EFFECT_URL}
                          alt=""
                          aria-hidden
                          onError={(event) => {
                            if (event.currentTarget.src.endsWith(CHAR_SELECT_SELECTED_EFFECT_FALLBACK_URL)) {
                              return;
                            }
                            event.currentTarget.src = CHAR_SELECT_SELECTED_EFFECT_FALLBACK_URL;
                          }}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            opacity: 0.18,
                            pointerEvents: "none"
                          }}
                        />
                      ) : null}
                      <div
                        style={{
                          position: "absolute",
                          left: 8,
                          right: 8,
                          bottom: 8,
                          padding: "4px 6px",
                          borderRadius: 8,
                          fontSize: "0.82rem",
                          fontWeight: 700,
                          letterSpacing: "0.02em",
                          color: "#fff5dd",
                          background: "rgba(16, 10, 26, 0.68)"
                        }}
                      >
                        {character.label}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                  background:
                    "radial-gradient(circle at 28% 18%, rgba(255, 196, 138, 0.14), transparent 52%), rgba(17, 11, 28, 0.76)",
                  padding: 12,
                  minHeight: isCoarsePointer ? 220 : 360,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10
                }}
              >
                <div style={{ fontSize: "0.78rem", opacity: 0.84, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  {pendingCharacter ? "Preview" : "Selection"}
                </div>
                <div style={{ fontSize: "1.18rem", fontWeight: 700, color: "#ffe7c6" }}>
                  {pendingCharacter ? pendingCharacter.label : "Tap any character"}
                </div>

                <div style={{ flex: 1, borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255, 255, 255, 0.12)" }}>
                  {pendingCharacter ? (
                    <Canvas camera={{ position: [1.8, 1.45, 2.2], fov: 40 }}>
                      <color attach="background" args={["#120d1f"]} />
                      <ambientLight intensity={0.68} color="#ffe7cf" />
                      <directionalLight position={[1.8, 3.4, 1.9]} intensity={1.15} color="#ffd2a3" />
                      <pointLight position={[-1.2, 1.1, -1.5]} intensity={0.46} color="#af88ff" />
                      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
                        <circleGeometry args={[1.2, 36]} />
                        <meshStandardMaterial color="#291c3f" roughness={0.9} />
                      </mesh>
                      <CharacterPreview avatarUrl={pendingCharacter.avatarUrl} />
                    </Canvas>
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        display: "grid",
                        placeItems: "center",
                        color: "#d9c6ad",
                        fontSize: "0.92rem",
                        padding: "10px",
                        textAlign: "center",
                        lineHeight: 1.4
                      }}
                    >
                      Tap a character card to magnify and load the 3D preview.
                    </div>
                  )}
                </div>

                <div style={{ color: "#ecd6bf", fontSize: "0.9rem", lineHeight: 1.45 }}>
                  {pendingCharacter
                    ? `Tap ${pendingCharacter.label} again to confirm your choice.`
                    : "After first tap, the selected card magnifies and shows this preview."}
                </div>

                <button
                  id="start-btn"
                  type="button"
                  disabled={!pendingCharacter}
                  onClick={handleStart}
                  style={{
                    border: "none",
                    borderRadius: "999px",
                    padding: "10px 18px",
                    fontSize: "0.94rem",
                    cursor: pendingCharacter ? "pointer" : "not-allowed",
                    fontWeight: 700,
                    color: pendingCharacter ? "#2d1937" : "#5a4a67",
                    background: pendingCharacter
                      ? "linear-gradient(135deg, #ffcf99 0%, #ffc485 45%, #f6a5a8 100%)"
                      : "linear-gradient(135deg, #67597c 0%, #5d4f71 100%)",
                    opacity: pendingCharacter ? 1 : 0.62
                  }}
                >
                  {pendingCharacter ? `Confirm ${pendingCharacter.label}` : "Choose a character first"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {started ? (
        <>
          <div
            style={{
              position: "absolute",
              top: 14,
              left: 14,
              padding: "10px 14px",
              borderRadius: 12,
              background: "rgba(20, 14, 31, 0.78)",
              color: "#f8efdf",
              fontSize: "0.92rem",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              lineHeight: 1.4
            }}
          >
            <div>Connection: {connectionState}</div>
            <div>Players: {playerIds.length}</div>
            <div>Auth: {authState.status === "authenticated" ? authState.profile?.displayName || "Player" : "Guest"}</div>
            <div>
              Progress: Lv {progression.level} | XP {progression.xp} | Stars {progression.stars}
            </div>
            <div style={{ marginTop: 4, fontSize: "0.78rem", opacity: 0.85 }}>
              Nearby: {contextActions.length ? contextActions.map((key) => EMOTE_LABELS[key]).join(", ") : "None"}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              top: 140,
              left: 14,
              width: isCoarsePointer ? 220 : 280,
              maxHeight: isCoarsePointer ? 190 : 260,
              overflow: "auto",
              padding: "10px 12px",
              borderRadius: 12,
              background: "rgba(20, 14, 31, 0.78)",
              color: "#f8efdf",
              fontSize: "0.82rem",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              lineHeight: 1.35
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Active Quests</div>
            {questList.length ? (
              questList.map((quest) => (
                <div key={quest.id} style={{ marginBottom: 7 }}>
                  <div style={{ color: "#ffe8c4", fontWeight: 600 }}>{quest.title}</div>
                  <div style={{ opacity: 0.9 }}>
                    {quest.value}/{quest.target} {quest.status === "completed" ? "(Complete)" : ""}
                  </div>
                  <div style={{ opacity: 0.72, fontSize: "0.75rem" }}>
                    Reward: {quest.rewards?.stars || 0} stars, {quest.rewards?.xp || 0} xp
                  </div>
                </div>
              ))
            ) : (
              <div style={{ opacity: 0.82 }}>Login to track quest progression.</div>
            )}
          </div>

          {contextActions.length ? (
            <div
              style={
                isCoarsePointer
                  ? {
                      position: "absolute",
                      bottom: 232,
                      right: 18,
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                      gap: 8,
                      width: 186
                    }
                  : {
                      position: "absolute",
                      top: 64,
                      right: 14,
                      display: "flex",
                      flexWrap: "wrap",
                      maxWidth: 316,
                      gap: 8
                    }
              }
            >
              {contextActions.map((action, index) => (
                <button
                  id={`context-btn-${action}`}
                  key={action}
                  type="button"
                  onClick={() => enqueueAction(action)}
                  style={{
                    border: "1px solid rgba(255, 201, 124, 0.42)",
                    borderRadius: isCoarsePointer ? 14 : 10,
                    padding: isCoarsePointer ? "10px 8px" : "7px 10px",
                    fontSize: isCoarsePointer ? "0.85rem" : "0.8rem",
                    lineHeight: 1.2,
                    color: "#fff5d2",
                    background: "rgba(71, 42, 34, 0.86)",
                    cursor: "pointer",
                    fontWeight: 700
                  }}
                >
                  {index + 5}. {EMOTE_LABELS[action]}
                </button>
              ))}
            </div>
          ) : null}

          <div
            style={
              isCoarsePointer
                ? {
                    position: "absolute",
                    bottom: 84,
                    right: 18,
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 10,
                    width: 186
                  }
                : {
                    position: "absolute",
                    top: 14,
                    right: 14,
                    display: "flex",
                    gap: 8
                  }
            }
          >
            {EMOTE_ORDER.map((emote, index) => (
              <button
                id={`emote-btn-${emote}`}
                key={emote}
                type="button"
                onClick={() => enqueueAction(emote)}
                style={{
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: isCoarsePointer ? 14 : 10,
                  padding: isCoarsePointer ? "12px 8px" : "8px 11px",
                  fontSize: isCoarsePointer ? "0.9rem" : "0.82rem",
                  lineHeight: 1.2,
                  color: "#fff8ec",
                  background: "rgba(35, 24, 52, 0.8)",
                  cursor: "pointer",
                  fontWeight: isCoarsePointer ? 700 : 500
                }}
              >
                {index + 1}. {EMOTE_LABELS[emote]}
              </button>
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              bottom: isCoarsePointer ? 220 : 14,
              left: isCoarsePointer ? 18 : 310,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              maxWidth: isCoarsePointer ? 186 : 380
            }}
          >
            <button
              type="button"
              onClick={handleToggleVoiceConnected}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff8ec",
                background: "rgba(35,24,52,0.8)",
                cursor: "pointer"
              }}
            >
              {voiceState.connected ? "Voice On" : "Join Voice"}
            </button>
            <button
              type="button"
              onClick={handleToggleVoiceMuted}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff8ec",
                background: voiceState.muted ? "rgba(91,34,53,0.88)" : "rgba(35,24,52,0.8)",
                cursor: "pointer"
              }}
            >
              {voiceState.muted ? "Muted" : "Mute"}
            </button>
            <button
              type="button"
              onClick={handleToggleVoiceDeafened}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff8ec",
                background: voiceState.deafened ? "rgba(91,34,53,0.88)" : "rgba(35,24,52,0.8)",
                cursor: "pointer"
              }}
            >
              {voiceState.deafened ? "Deafened" : "Deafen"}
            </button>
            <button
              type="button"
              onClick={handleTogglePushToTalk}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff8ec",
                background: voiceState.pushToTalk ? "rgba(61,39,92,0.88)" : "rgba(35,24,52,0.8)",
                cursor: "pointer"
              }}
            >
              {voiceState.pushToTalk ? "PTT On" : "PTT Off"}
            </button>
            <button
              type="button"
              onClick={handleToggleSpeaking}
              disabled={!voiceState.connected || voiceState.muted || voiceState.deafened}
              style={{
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff8ec",
                background: voiceState.speaking ? "rgba(109,77,39,0.88)" : "rgba(35,24,52,0.8)",
                cursor: "pointer",
                opacity: !voiceState.connected || voiceState.muted || voiceState.deafened ? 0.5 : 1
              }}
            >
              {voiceState.speaking ? "Talking" : "Talk"}
            </button>
            <button
              type="button"
              onClick={handleQuickReport}
              style={{
                border: "1px solid rgba(255,201,124,0.42)",
                borderRadius: 10,
                padding: "8px 10px",
                color: "#fff5d2",
                background: "rgba(71,42,34,0.86)",
                cursor: "pointer"
              }}
            >
              Quick Report
            </button>
            <div style={{ width: "100%", fontSize: "0.74rem", color: "#f4d7bf", opacity: 0.86 }}>
              Nearby voice: {voiceState.nearbySpeakers.length} {voiceHint ? `| ${voiceHint}` : ""}
            </div>
          </div>

          <div
            style={{
              position: "absolute",
              bottom: 12,
              left: 12,
              color: "#f0e4d1",
              background: "rgba(23, 17, 36, 0.78)",
              borderRadius: 12,
              border: "1px solid rgba(255, 255, 255, 0.12)",
              padding: "8px 10px",
              fontSize: "0.78rem",
              letterSpacing: "0.02em"
            }}
          >
            World: {worldView.w}x{worldView.h}
          </div>

          {isCoarsePointer ? (
            <div
              id="mobile-joystick"
              ref={joystickRef}
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
              style={{
                position: "absolute",
                bottom: 84,
                left: 18,
                width: 128,
                height: 128,
                borderRadius: "50%",
                border: "2px solid rgba(255, 255, 255, 0.24)",
                background: "radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.25), rgba(48, 34, 65, 0.55))",
                touchAction: "none",
                display: "grid",
                placeItems: "center"
              }}
            >
              <div
                style={{
                  width: 50,
                  height: 50,
                  borderRadius: "50%",
                  background: "rgba(250, 237, 210, 0.84)",
                  border: "1px solid rgba(34, 21, 42, 0.35)",
                  transform: `translate(${touchVector.x * 28}px, ${touchVector.y * 28}px)`,
                  transition: touchVector.active ? "none" : "transform 120ms ease-out"
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
