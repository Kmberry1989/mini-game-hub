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
import { EMOTE_LABELS, EMOTE_ORDER, isValidEmote } from "./game/emotes";
import { clamp, lerp, normalizeAxis } from "./game/math";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";

const avatarCache = {
  status: "idle",
  promise: null,
  data: null,
  error: null
};

function loadAvatarAssets() {
  if (avatarCache.status === "loaded") {
    return Promise.resolve(avatarCache.data);
  }

  if (avatarCache.status === "loading") {
    return avatarCache.promise;
  }

  avatarCache.status = "loading";

  const gltfLoader = new GLTFLoader();
  const fbxLoader = new FBXLoader();

  avatarCache.promise = Promise.all([
    gltfLoader.loadAsync("/assets/avatars/toy_base.glb"),
    fbxLoader.loadAsync("/assets/animations/idle.fbx"),
    fbxLoader.loadAsync("/assets/animations/walk.fbx"),
    fbxLoader.loadAsync("/assets/animations/wave.fbx")
  ])
    .then(([gltf, idleFBX, walkFBX, waveFBX]) => {
      const idleClip = idleFBX.animations[0];
      const walkClip = walkFBX.animations[0];
      const waveClip = waveFBX.animations[0] || walkClip || idleClip;

      if (!idleClip || !walkClip || !waveClip) {
        throw new Error("Missing one or more required animation clips (idle/walk/wave).");
      }

      avatarCache.status = "loaded";
      avatarCache.data = {
        scene: gltf.scene,
        idleClip,
        walkClip,
        waveClip
      };

      return avatarCache.data;
    })
    .catch((error) => {
      avatarCache.status = "error";
      avatarCache.error = error;
      throw error;
    });

  return avatarCache.promise;
}

function worldToScenePosition(world, x, y) {
  return {
    x: (x - world.w / 2) * WORLD_SCALE,
    z: (y - world.h / 2) * WORLD_SCALE
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
    lastStateAt: performance.now()
  };
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

function lerpAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

function AvatarEntity({ id, isLocal, playersRef, worldRef }) {
  const groupRef = useRef(null);
  const modelRootRef = useRef(null);
  const mixerRef = useRef(null);
  const actionsRef = useRef({ idle: null, walk: null, wave: null });
  const activeAnimationRef = useRef("idle");
  const emoteTypeRef = useRef("");
  const [emoteType, setEmoteType] = useState("");
  const [assetStatus, setAssetStatus] = useState(() =>
    avatarCache.status === "loaded" ? "loaded" : avatarCache.status === "error" ? "error" : "loading"
  );

  useEffect(() => {
    let mounted = true;

    loadAvatarAssets()
      .then(() => {
        if (!mounted) {
          return;
        }
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
  }, []);

  useEffect(() => {
    if (assetStatus !== "loaded" || !modelRootRef.current || !avatarCache.data) {
      return undefined;
    }

    let clonedModel;
    try {
      clonedModel = skeletonClone(avatarCache.data.scene);
    } catch (error) {
      console.error("Avatar clone failed:", error);
      setAssetStatus("error");
      return undefined;
    }
    clonedModel.scale.setScalar(0.0115);

    clonedModel.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    modelRootRef.current.add(clonedModel);

    const mixer = new THREE.AnimationMixer(clonedModel);
    mixerRef.current = mixer;

    const idleAction = mixer.clipAction(avatarCache.data.idleClip);
    const walkAction = mixer.clipAction(avatarCache.data.walkClip);
    const waveAction = mixer.clipAction(avatarCache.data.waveClip);

    waveAction.setLoop(THREE.LoopRepeat, Infinity);

    idleAction.play();

    actionsRef.current = {
      idle: idleAction,
      walk: walkAction,
      wave: waveAction
    };

    activeAnimationRef.current = "idle";

    return () => {
      if (mixerRef.current) {
        mixerRef.current.stopAllAction();
        mixerRef.current = null;
      }

      actionsRef.current = { idle: null, walk: null, wave: null };
      activeAnimationRef.current = "idle";

      if (modelRootRef.current) {
        modelRootRef.current.remove(clonedModel);
      }
    };
  }, [assetStatus]);

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

    const desiredAnimation =
      player.emote === "wave" ? "wave" : player.anim === "walk" ? "walk" : "idle";
    if (desiredAnimation !== activeAnimationRef.current) {
      const previousAction = actionsRef.current[activeAnimationRef.current];
      const nextAction = actionsRef.current[desiredAnimation];

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

function FollowCamera({ playersRef, selfIdRef, worldRef }) {
  const targetPosition = useRef(new THREE.Vector3(0, 5.2, 6.6));
  const lookAtPosition = useRef(new THREE.Vector3(0, 1.2, 0));

  useFrame(({ camera }) => {
    const self = playersRef.current.get(selfIdRef.current);
    if (!self) {
      return;
    }

    const scene = worldToScenePosition(worldRef.current, self.displayX, self.displayY);

    targetPosition.current.set(scene.x + 3.1, 4.8, scene.z + 5.6);
    lookAtPosition.current.set(scene.x, 1.0, scene.z + 0.2);

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

export default function App() {
  const [started, setStarted] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("autostart") === "1";
  });
  const [playerIds, setPlayerIds] = useState([]);
  const [worldView, setWorldView] = useState(WORLD_DEFAULT);
  const [selfIdState, setSelfIdState] = useState("");
  const [connectionState, setConnectionState] = useState("disconnected");
  const [touchVector, setTouchVector] = useState({ x: 0, y: 0, active: false });

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
        anim: player.emote === "wave" ? "wave" : player.anim,
        emote: player.emote || null
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
            anim: selfPlayer.emote === "wave" ? "wave" : selfPlayer.anim,
            emote: selfPlayer.emote || null
          }
        : null,
      others,
      connection: connectionRef.current,
      input: lastInputRef.current
    };
  }, []);

  const enqueueEmote = useCallback((type) => {
    if (!isValidEmote(type)) {
      return;
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
      lastInputRef.current = { moveX: input.moveX, moveY: input.moveY };

      const self = playersRef.current.get(selfIdRef.current);
      if (self) {
        const normalized = normalizeAxis(input.moveX, input.moveY);

        self.vx = normalized.x * PLAYER_SPEED;
        self.vy = normalized.y * PLAYER_SPEED;
        self.anim = Math.hypot(self.vx, self.vy) > 8 ? "walk" : "idle";

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
          self.emoteUntil = now + EMOTE_DURATION_MS;
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

        if (id !== selfIdRef.current && now - player.lastStateAt > 12000) {
          playersRef.current.delete(id);
          playerSetChanged = true;
        }
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
      const key = event.key.toLowerCase();

      if (key === "w" || key === "arrowup") keyboardRef.current.up = true;
      if (key === "s" || key === "arrowdown") keyboardRef.current.down = true;
      if (key === "a" || key === "arrowleft") keyboardRef.current.left = true;
      if (key === "d" || key === "arrowright") keyboardRef.current.right = true;

      if (!event.repeat) {
        if (key === "1") enqueueEmote("wave");
        if (key === "2") enqueueEmote("heart");
        if (key === "3") enqueueEmote("sparkle");
        if (key === "4") enqueueEmote("laugh");
        if (key === "enter") enqueueEmote("wave");
        if (key === " ") enqueueEmote("heart");

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
          "enter",
          " ",
          "f"
        ].includes(key)
      ) {
        event.preventDefault();
      }
    };

    const onKeyUp = (event) => {
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
  }, [enqueueEmote]);

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

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

    const platform = window.matchMedia("(pointer: coarse)").matches ? "mobile" : "desktop";
    simulationTimeRef.current = performance.now();

    socket.on("connect", () => {
      connectionRef.current = "connected";
      setConnectionState("connected");

      socket.emit("join", {
        name: "Guest",
        color: LOCAL_PLAYER_COLOR,
        client: {
          platform,
          version: CLIENT_VERSION
        }
      });
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
        nextPlayers.set(msg.selfId, createPlayerState({ id: msg.selfId, color: LOCAL_PLAYER_COLOR }, incomingWorld));
      }

      playersRef.current = nextPlayers;
      selfIdRef.current = msg?.selfId || "";
      setSelfIdState(selfIdRef.current);
      refreshPlayerIds();
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

        player.serverX = Number.isFinite(incoming.x) ? incoming.x : player.serverX;
        player.serverY = Number.isFinite(incoming.y) ? incoming.y : player.serverY;
        player.vx = Number.isFinite(incoming.vx) ? incoming.vx : player.vx;
        player.vy = Number.isFinite(incoming.vy) ? incoming.vy : player.vy;
        player.anim = incoming.anim || (Math.hypot(player.vx, player.vy) > 8 ? "walk" : "idle");
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
      player.emoteUntil = simulationTimeRef.current + EMOTE_DURATION_MS;
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      connectionRef.current = "disconnected";
      setConnectionState("disconnected");
      playersRef.current = new Map();
      selfIdRef.current = "";
      setSelfIdState("");
      setPlayerIds([]);
    };
  }, [refreshPlayerIds, started]);

  const handleStart = useCallback(() => {
    setStarted(true);
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

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#100d17" }}>
      <Canvas shadows camera={{ position: [3.1, 4.8, 5.6], fov: 48 }}>
        <color attach="background" args={["#140f1d"]} />

        <ambientLight intensity={0.52} color="#ffd9b8" />

        <directionalLight
          position={[3.8, 8.4, 2.2]}
          intensity={1.05}
          castShadow
          color="#ffd3a2"
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />

        <pointLight position={[-2.2, 2.2, -1.8]} intensity={0.6} color="#c89eff" />

        <StudioEnvironment world={worldView} />

        <SimulationDriver stepRef={stepRef} />
        <FollowCamera playersRef={playersRef} selfIdRef={selfIdRef} worldRef={worldRef} />

        {playerIds.map((id) => (
          <AvatarEntity
            key={id}
            id={id}
            isLocal={id === selfIdState}
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
            display: "grid",
            placeItems: "center",
            background:
              "radial-gradient(circle at 20% 10%, rgba(120, 75, 160, 0.4), transparent 45%), radial-gradient(circle at 80% 85%, rgba(255, 176, 122, 0.25), transparent 50%), rgba(10, 8, 17, 0.55)",
            color: "#f8edda",
            textAlign: "center",
            padding: "24px"
          }}
        >
          <div style={{ maxWidth: "560px", backdropFilter: "blur(8px)", padding: "28px", borderRadius: "18px", background: "rgba(26, 16, 39, 0.7)", border: "1px solid rgba(255, 255, 255, 0.14)" }}>
            <h1 style={{ margin: "0 0 10px", fontSize: "2rem", letterSpacing: "0.04em" }}>Cozy Studio Lobby</h1>
            <p style={{ margin: "0 0 18px", lineHeight: 1.5, color: "#f3d9bc" }}>
              Move around, meet nearby players, and trigger quick emotes.
            </p>
            <p style={{ margin: "0 0 20px", lineHeight: 1.5, color: "#dcc7b4" }}>
              Desktop: WASD or arrows, emotes 1-4, fullscreen with F. Mobile: drag the joystick and tap emote buttons.
            </p>
            <button
              id="start-btn"
              type="button"
              onClick={handleStart}
              style={{
                border: "none",
                borderRadius: "999px",
                padding: "12px 24px",
                fontSize: "1rem",
                cursor: "pointer",
                fontWeight: 700,
                color: "#2d1937",
                background: "linear-gradient(135deg, #ffcf99 0%, #ffc485 45%, #f6a5a8 100%)"
              }}
            >
              Enter Studio
            </button>
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
          </div>

          <div
            style={{
              position: "absolute",
              top: 14,
              right: 14,
              display: "flex",
              gap: 8
            }}
          >
            {EMOTE_ORDER.map((emote, index) => (
              <button
                id={`emote-btn-${emote}`}
                key={emote}
                type="button"
                onClick={() => enqueueEmote(emote)}
                style={{
                  border: "1px solid rgba(255, 255, 255, 0.2)",
                  borderRadius: 10,
                  padding: "8px 11px",
                  fontSize: "0.82rem",
                  color: "#fff8ec",
                  background: "rgba(35, 24, 52, 0.8)",
                  cursor: "pointer"
                }}
              >
                {index + 1}. {EMOTE_LABELS[emote]}
              </button>
            ))}
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
