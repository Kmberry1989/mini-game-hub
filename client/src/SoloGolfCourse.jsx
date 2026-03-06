import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clamp } from "./game/math";

const COURSE_WIDTH = 1600;
const COURSE_HEIGHT = 900;
const BALL_RADIUS = 11;
const CUP_RADIUS = 18;
const STOP_SPEED = 7;
const MIN_SHOT_SPEED = 170;
const MAX_SHOT_SPEED = 980;
const BASE_FRICTION = 0.988;
const SAND_FRICTION = 0.952;

const HOLES = [
  {
    name: "Opening Lane",
    par: 3,
    tee: { x: 200, y: 680 },
    cup: { x: 1360, y: 240 },
    path: [{ x: 620, y: 700 }, { x: 1020, y: 420 }],
    sand: [{ x: 880, y: 300, w: 160, h: 120 }],
    water: [{ x: 500, y: 430, w: 180, h: 110 }],
    walls: [{ x: 720, y: 520, w: 220, h: 24 }]
  },
  {
    name: "Dogleg Left",
    par: 4,
    tee: { x: 240, y: 220 },
    cup: { x: 1360, y: 690 },
    path: [{ x: 680, y: 220 }, { x: 990, y: 520 }],
    sand: [{ x: 610, y: 360, w: 180, h: 110 }, { x: 1170, y: 610, w: 150, h: 100 }],
    water: [{ x: 840, y: 280, w: 160, h: 150 }],
    walls: [{ x: 420, y: 470, w: 260, h: 26 }]
  },
  {
    name: "Twin Ponds",
    par: 3,
    tee: { x: 180, y: 500 },
    cup: { x: 1410, y: 480 },
    path: [{ x: 620, y: 470 }, { x: 980, y: 500 }],
    sand: [{ x: 1110, y: 370, w: 140, h: 110 }],
    water: [
      { x: 520, y: 320, w: 140, h: 120 },
      { x: 760, y: 520, w: 160, h: 110 }
    ],
    walls: [{ x: 980, y: 600, w: 280, h: 24 }]
  },
  {
    name: "Boardwalk Gap",
    par: 5,
    tee: { x: 200, y: 760 },
    cup: { x: 1410, y: 170 },
    path: [{ x: 520, y: 740 }, { x: 910, y: 520 }, { x: 1190, y: 270 }],
    sand: [{ x: 430, y: 600, w: 180, h: 120 }, { x: 1010, y: 230, w: 170, h: 110 }],
    water: [{ x: 720, y: 320, w: 190, h: 150 }],
    walls: [
      { x: 620, y: 650, w: 220, h: 24 },
      { x: 930, y: 430, w: 260, h: 24 }
    ]
  },
  {
    name: "Island Aim",
    par: 3,
    tee: { x: 260, y: 180 },
    cup: { x: 1330, y: 740 },
    path: [{ x: 520, y: 260 }, { x: 920, y: 560 }],
    sand: [{ x: 1080, y: 610, w: 170, h: 120 }],
    water: [{ x: 640, y: 350, w: 230, h: 170 }],
    walls: [{ x: 1000, y: 430, w: 280, h: 24 }]
  },
  {
    name: "Bunker Corridor",
    par: 4,
    tee: { x: 190, y: 430 },
    cup: { x: 1430, y: 390 },
    path: [{ x: 540, y: 440 }, { x: 980, y: 410 }],
    sand: [
      { x: 580, y: 250, w: 140, h: 100 },
      { x: 820, y: 520, w: 170, h: 120 },
      { x: 1120, y: 270, w: 150, h: 100 }
    ],
    water: [{ x: 690, y: 360, w: 120, h: 140 }],
    walls: [{ x: 1040, y: 540, w: 230, h: 24 }]
  },
  {
    name: "Crescent Bend",
    par: 5,
    tee: { x: 220, y: 710 },
    cup: { x: 1380, y: 230 },
    path: [{ x: 520, y: 760 }, { x: 900, y: 610 }, { x: 1130, y: 360 }],
    sand: [{ x: 700, y: 700, w: 170, h: 110 }, { x: 1160, y: 430, w: 180, h: 120 }],
    water: [{ x: 820, y: 430, w: 170, h: 140 }],
    walls: [
      { x: 500, y: 610, w: 210, h: 24 },
      { x: 1010, y: 290, w: 230, h: 24 }
    ]
  },
  {
    name: "Crosswind Run",
    par: 4,
    tee: { x: 210, y: 240 },
    cup: { x: 1390, y: 650 },
    path: [{ x: 640, y: 260 }, { x: 1020, y: 470 }],
    sand: [{ x: 930, y: 590, w: 150, h: 100 }, { x: 1180, y: 420, w: 160, h: 120 }],
    water: [{ x: 610, y: 350, w: 190, h: 150 }],
    walls: [{ x: 1120, y: 300, w: 230, h: 24 }]
  },
  {
    name: "Final Green",
    par: 3,
    tee: { x: 210, y: 460 },
    cup: { x: 1390, y: 450 },
    path: [{ x: 590, y: 470 }, { x: 980, y: 460 }],
    sand: [{ x: 650, y: 330, w: 180, h: 110 }, { x: 1010, y: 530, w: 190, h: 120 }],
    water: [{ x: 800, y: 390, w: 160, h: 120 }],
    walls: [{ x: 1180, y: 340, w: 180, h: 24 }]
  }
];

function makeInitialState() {
  const first = HOLES[0];
  return {
    phase: "playing",
    holeIndex: 0,
    strokesThisHole: 0,
    scorecard: [],
    ball: {
      x: first.tee.x,
      y: first.tee.y,
      vx: 0,
      vy: 0,
      r: BALL_RADIUS
    },
    lie: { x: first.tee.x, y: first.tee.y },
    aiming: {
      active: false,
      pointerX: first.tee.x,
      pointerY: first.tee.y,
      power: 0
    },
    message: "Drag opposite your shot direction, release to hit.",
    messageUntil: performance.now() + 2400
  };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function distance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function speedOf(ball) {
  return Math.hypot(ball.vx, ball.vy);
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function isMoving(state) {
  return speedOf(state.ball) > STOP_SPEED;
}

function setMessage(state, text, durationMs = 1800) {
  state.message = text;
  state.messageUntil = performance.now() + durationMs;
}

function applyWallCollision(ball, wall, restitution = 0.58) {
  const left = wall.x - ball.r;
  const right = wall.x + wall.w + ball.r;
  const top = wall.y - ball.r;
  const bottom = wall.y + wall.h + ball.r;

  if (ball.x < left || ball.x > right || ball.y < top || ball.y > bottom) {
    return false;
  }

  const penLeft = Math.abs(ball.x - left);
  const penRight = Math.abs(right - ball.x);
  const penTop = Math.abs(ball.y - top);
  const penBottom = Math.abs(bottom - ball.y);
  const minPen = Math.min(penLeft, penRight, penTop, penBottom);

  if (minPen === penLeft) {
    ball.x = left;
    ball.vx = -Math.abs(ball.vx) * restitution;
    ball.vy *= 0.92;
  } else if (minPen === penRight) {
    ball.x = right;
    ball.vx = Math.abs(ball.vx) * restitution;
    ball.vy *= 0.92;
  } else if (minPen === penTop) {
    ball.y = top;
    ball.vy = -Math.abs(ball.vy) * restitution;
    ball.vx *= 0.92;
  } else {
    ball.y = bottom;
    ball.vy = Math.abs(ball.vy) * restitution;
    ball.vx *= 0.92;
  }

  return true;
}

function scoreSummary(state) {
  const completedPar = state.scorecard.reduce((sum, entry) => sum + entry.par, 0);
  const completedStrokes = state.scorecard.reduce((sum, entry) => sum + entry.strokes, 0);
  const runningPar = completedPar + (state.phase === "finished" ? 0 : HOLES[state.holeIndex].par);
  const runningStrokes = completedStrokes + (state.phase === "finished" ? 0 : state.strokesThisHole);

  return {
    completedPar,
    completedStrokes,
    runningPar,
    runningStrokes,
    toPar: runningStrokes - runningPar
  };
}

function createTextState(state) {
  const hole = HOLES[state.holeIndex];
  const ballSpeed = speedOf(state.ball);
  const summary = scoreSummary(state);

  return {
    mode: state.phase,
    coordinateSystem: {
      origin: "top-left of solo course canvas",
      xAxis: "positive right",
      yAxis: "positive down"
    },
    course: {
      holeNumber: state.holeIndex + 1,
      totalHoles: HOLES.length,
      holeName: hole.name,
      par: hole.par
    },
    score: {
      strokesThisHole: state.strokesThisHole,
      completedHoles: state.scorecard.length,
      runningStrokes: summary.runningStrokes,
      runningPar: summary.runningPar,
      toPar: summary.toPar
    },
    ball: {
      x: round(state.ball.x),
      y: round(state.ball.y),
      vx: round(state.ball.vx),
      vy: round(state.ball.vy),
      speed: round(ballSpeed)
    },
    cup: {
      x: hole.cup.x,
      y: hole.cup.y,
      distance: round(distance(state.ball.x, state.ball.y, hole.cup.x, hole.cup.y))
    },
    aiming: {
      active: state.aiming.active,
      power: round(state.aiming.power)
    },
    hazards: {
      sandPatches: hole.sand.length,
      waterPonds: hole.water.length,
      walls: hole.walls.length
    }
  };
}

export default function SoloGolfCourse({ onExit }) {
  const canvasRef = useRef(null);
  const gameRef = useRef(makeInitialState());
  const rafRef = useRef(0);
  const prevRef = useRef(performance.now());
  const pointerRef = useRef({ active: false, id: null });
  const viewRef = useRef({ scale: 1, offsetX: 0, offsetY: 0, width: COURSE_WIDTH, height: COURSE_HEIGHT });
  const hudTickRef = useRef(0);

  const [hudState, setHudState] = useState(() => createTextState(gameRef.current));

  const syncHud = useCallback(() => {
    setHudState(createTextState(gameRef.current));
  }, []);

  const loadHole = useCallback((holeIndex) => {
    const state = gameRef.current;
    const targetIndex = clamp(holeIndex, 0, HOLES.length - 1);
    const hole = HOLES[targetIndex];
    state.holeIndex = targetIndex;
    state.strokesThisHole = 0;
    state.phase = "playing";
    state.ball.x = hole.tee.x;
    state.ball.y = hole.tee.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.lie = { x: hole.tee.x, y: hole.tee.y };
    state.aiming = {
      active: false,
      pointerX: hole.tee.x,
      pointerY: hole.tee.y,
      power: 0
    };
    setMessage(state, `Hole ${targetIndex + 1}: ${hole.name} (Par ${hole.par})`, 2200);
    syncHud();
  }, [syncHud]);

  const restartCourse = useCallback(() => {
    gameRef.current = makeInitialState();
    syncHud();
  }, [syncHud]);

  const finishHole = useCallback(() => {
    const state = gameRef.current;
    const hole = HOLES[state.holeIndex];
    const entry = {
      hole: state.holeIndex + 1,
      par: hole.par,
      strokes: state.strokesThisHole,
      toPar: state.strokesThisHole - hole.par,
      name: hole.name
    };

    state.scorecard = [...state.scorecard, entry];
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.ball.x = hole.cup.x;
    state.ball.y = hole.cup.y;

    if (state.holeIndex >= HOLES.length - 1) {
      state.phase = "finished";
      const totalStrokes = state.scorecard.reduce((sum, row) => sum + row.strokes, 0);
      const totalPar = state.scorecard.reduce((sum, row) => sum + row.par, 0);
      const delta = totalStrokes - totalPar;
      const relation = delta === 0 ? "even" : delta > 0 ? `+${delta}` : `${delta}`;
      setMessage(state, `Course complete: ${totalStrokes} strokes (${relation} vs par).`, 4200);
    } else {
      state.phase = "hole_complete";
      setMessage(state, `Hole ${state.holeIndex + 1} complete in ${state.strokesThisHole} strokes.`, 2400);
    }

    state.aiming.active = false;
    syncHud();
  }, [syncHud]);

  const takeShot = useCallback((dirX, dirY, powerNorm) => {
    const state = gameRef.current;
    if (state.phase !== "playing" || isMoving(state)) {
      return false;
    }

    const length = Math.hypot(dirX, dirY);
    if (length < 0.0001) {
      return false;
    }

    const normalizedPower = clamp(powerNorm, 0.05, 1);
    const speed = MIN_SHOT_SPEED + normalizedPower * (MAX_SHOT_SPEED - MIN_SHOT_SPEED);

    state.lie = { x: state.ball.x, y: state.ball.y };
    state.ball.vx = (dirX / length) * speed;
    state.ball.vy = (dirY / length) * speed;
    state.strokesThisHole += 1;
    state.aiming.active = false;
    state.aiming.power = normalizedPower;

    syncHud();
    return true;
  }, [syncHud]);

  const stepGame = useCallback((deltaSeconds) => {
    const state = gameRef.current;

    if (state.message && performance.now() > state.messageUntil) {
      state.message = "";
    }

    if (state.phase !== "playing") {
      return;
    }

    const hole = HOLES[state.holeIndex];
    const dt = Math.max(1 / 240, Math.min(0.05, deltaSeconds));
    const subSteps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const subDt = dt / subSteps;

    for (let stepIndex = 0; stepIndex < subSteps; stepIndex += 1) {
      const moving = speedOf(state.ball) > 0.001;
      if (!moving) {
        break;
      }

      state.ball.x += state.ball.vx * subDt;
      state.ball.y += state.ball.vy * subDt;

      if (state.ball.x < state.ball.r) {
        state.ball.x = state.ball.r;
        state.ball.vx = Math.abs(state.ball.vx) * 0.58;
      }
      if (state.ball.x > COURSE_WIDTH - state.ball.r) {
        state.ball.x = COURSE_WIDTH - state.ball.r;
        state.ball.vx = -Math.abs(state.ball.vx) * 0.58;
      }
      if (state.ball.y < state.ball.r) {
        state.ball.y = state.ball.r;
        state.ball.vy = Math.abs(state.ball.vy) * 0.58;
      }
      if (state.ball.y > COURSE_HEIGHT - state.ball.r) {
        state.ball.y = COURSE_HEIGHT - state.ball.r;
        state.ball.vy = -Math.abs(state.ball.vy) * 0.58;
      }

      for (const wall of hole.walls) {
        applyWallCollision(state.ball, wall);
      }

      let inWater = false;
      for (const pond of hole.water) {
        if (pointInRect(state.ball.x, state.ball.y, pond)) {
          inWater = true;
          break;
        }
      }

      if (inWater) {
        state.ball.x = state.lie.x;
        state.ball.y = state.lie.y;
        state.ball.vx = 0;
        state.ball.vy = 0;
        state.strokesThisHole += 1;
        setMessage(state, "Water hazard: +1 stroke.", 1700);
        syncHud();
        break;
      }

      let inSand = false;
      for (const trap of hole.sand) {
        if (pointInRect(state.ball.x, state.ball.y, trap)) {
          inSand = true;
          break;
        }
      }

      const friction = inSand ? SAND_FRICTION : BASE_FRICTION;
      const damping = Math.pow(friction, subDt * 60);
      state.ball.vx *= damping;
      state.ball.vy *= damping;

      const cupDistance = distance(state.ball.x, state.ball.y, hole.cup.x, hole.cup.y);
      const cupSpeed = speedOf(state.ball);
      if (cupDistance <= CUP_RADIUS + 4 && cupSpeed <= 250) {
        finishHole();
        return;
      }
    }

    if (speedOf(state.ball) <= STOP_SPEED) {
      state.ball.vx = 0;
      state.ball.vy = 0;
    }
  }, [finishHole, syncHud]);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const width = canvas.width;
    const height = canvas.height;
    const scale = Math.min(width / COURSE_WIDTH, height / COURSE_HEIGHT);
    const offsetX = (width - COURSE_WIDTH * scale) / 2;
    const offsetY = (height - COURSE_HEIGHT * scale) / 2;

    viewRef.current = { scale, offsetX, offsetY, width, height };

    ctx.clearRect(0, 0, width, height);

    const backdrop = ctx.createLinearGradient(0, 0, 0, height);
    backdrop.addColorStop(0, "#0f2819");
    backdrop.addColorStop(1, "#1b3c28");
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    const state = gameRef.current;
    const hole = HOLES[state.holeIndex];

    ctx.fillStyle = "#1a3a26";
    ctx.fillRect(0, 0, COURSE_WIDTH, COURSE_HEIGHT);

    const fairwayRoute = [hole.tee, ...(hole.path || []), hole.cup];
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 130;
    ctx.strokeStyle = "#4e9f5b";
    ctx.beginPath();
    fairwayRoute.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();

    ctx.fillStyle = "#5ca66a";
    ctx.beginPath();
    ctx.arc(hole.cup.x, hole.cup.y, 92, 0, Math.PI * 2);
    ctx.fill();

    for (const trap of hole.sand) {
      ctx.fillStyle = "#d6c48c";
      ctx.fillRect(trap.x, trap.y, trap.w, trap.h);
    }

    for (const pond of hole.water) {
      ctx.fillStyle = "#2e6f8f";
      ctx.fillRect(pond.x, pond.y, pond.w, pond.h);
    }

    for (const wall of hole.walls) {
      ctx.fillStyle = "#6a4b2f";
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeStyle = "#9f754a";
      ctx.lineWidth = 2;
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }

    ctx.fillStyle = "#e1f5b6";
    ctx.beginPath();
    ctx.arc(hole.tee.x, hole.tee.y, 14, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#f4f0e3";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hole.cup.x, hole.cup.y - 65);
    ctx.lineTo(hole.cup.x, hole.cup.y + 8);
    ctx.stroke();

    ctx.fillStyle = "#f08f64";
    ctx.beginPath();
    ctx.moveTo(hole.cup.x, hole.cup.y - 65);
    ctx.lineTo(hole.cup.x + 34, hole.cup.y - 52);
    ctx.lineTo(hole.cup.x, hole.cup.y - 39);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1e1c14";
    ctx.beginPath();
    ctx.arc(hole.cup.x, hole.cup.y, CUP_RADIUS - 2, 0, Math.PI * 2);
    ctx.fill();

    if (state.phase === "hole_complete" || state.phase === "finished") {
      ctx.strokeStyle = "#ffe3b3";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(hole.cup.x, hole.cup.y, 26, 0, Math.PI * 2);
      ctx.stroke();
    }

    const ball = state.ball;
    ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
    ctx.beginPath();
    ctx.ellipse(ball.x + 2, ball.y + 6, ball.r * 0.95, ball.r * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff8ed";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#d7c9ad";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (state.aiming.active && state.phase === "playing" && !isMoving(state)) {
      const dx = state.ball.x - state.aiming.pointerX;
      const dy = state.ball.y - state.aiming.pointerY;
      const drag = Math.hypot(dx, dy);
      const power = clamp(drag / 240, 0, 1);

      ctx.strokeStyle = "rgba(255, 223, 168, 0.85)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(state.ball.x, state.ball.y);
      ctx.lineTo(state.aiming.pointerX, state.aiming.pointerY);
      ctx.stroke();

      ctx.fillStyle = "rgba(18, 12, 8, 0.85)";
      ctx.fillRect(state.ball.x - 65, state.ball.y - 68, 130, 14);
      ctx.fillStyle = "#ffcc8a";
      ctx.fillRect(state.ball.x - 65, state.ball.y - 68, 130 * power, 14);
    }

    if (state.phase === "hole_complete") {
      ctx.fillStyle = "rgba(9, 10, 9, 0.62)";
      ctx.fillRect(530, 380, 540, 120);
      ctx.fillStyle = "#fff0cf";
      ctx.font = "700 36px Georgia, serif";
      ctx.fillText("Hole Complete", 660, 430);
      ctx.font = "500 20px Georgia, serif";
      ctx.fillText("Press N or tap Next Hole", 676, 468);
    }

    if (state.phase === "finished") {
      const summary = scoreSummary(state);
      ctx.fillStyle = "rgba(8, 10, 12, 0.68)";
      ctx.fillRect(500, 350, 620, 170);
      ctx.fillStyle = "#fff0cf";
      ctx.font = "700 42px Georgia, serif";
      ctx.fillText("Course Finished", 650, 410);
      ctx.font = "500 24px Georgia, serif";
      ctx.fillText(
        `Strokes ${summary.completedStrokes}  |  Par ${summary.completedPar}  |  ${summary.completedStrokes - summary.completedPar >= 0 ? "+" : ""}${summary.completedStrokes - summary.completedPar}`,
        560,
        460
      );
      ctx.fillText("Press Restart Course to play again", 616, 497);
    }

    ctx.restore();
  }, []);

  const worldPointFromClient = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const view = viewRef.current;
    const x = (localX - view.offsetX) / view.scale;
    const y = (localY - view.offsetY) / view.scale;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return {
      x: clamp(x, 0, COURSE_WIDTH),
      y: clamp(y, 0, COURSE_HEIGHT)
    };
  }, []);

  const dropToLieWithPenalty = useCallback(() => {
    const state = gameRef.current;
    if (state.phase !== "playing") {
      return;
    }
    state.ball.x = state.lie.x;
    state.ball.y = state.lie.y;
    state.ball.vx = 0;
    state.ball.vy = 0;
    state.strokesThisHole += 1;
    setMessage(state, "Ball reset to lie: +1 stroke.");
    syncHud();
  }, [syncHud]);

  const autoShotTowardCup = useCallback(() => {
    const state = gameRef.current;
    if (state.phase !== "playing" || isMoving(state)) {
      return;
    }
    const hole = HOLES[state.holeIndex];
    const nodes = [hole.tee, ...(hole.path || []), hole.cup];
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const d = distance(state.ball.x, state.ball.y, node.x, node.y);
      if (d < nearestDistance) {
        nearestDistance = d;
        nearestIndex = index;
      }
    }

    const target = nodes[Math.min(nodes.length - 1, nearestIndex + 1)];
    const dx = target.x - state.ball.x;
    const dy = target.y - state.ball.y;
    const dist = Math.hypot(dx, dy);
    const powerNorm = clamp(dist / 680, 0.42, 0.82);
    takeShot(dx, dy, powerNorm);
  }, [takeShot]);

  const concedeHole = useCallback(() => {
    const state = gameRef.current;
    if (state.phase !== "playing") {
      return;
    }
    const hole = HOLES[state.holeIndex];
    state.strokesThisHole = Math.max(state.strokesThisHole, hole.par + 2);
    setMessage(state, `Hole conceded at ${state.strokesThisHole} strokes.`, 1700);
    finishHole();
  }, [finishHole]);

  const handlePointerDown = useCallback(
    (event) => {
      const state = gameRef.current;
      if (state.phase !== "playing" || isMoving(state)) {
        return;
      }

      const world = worldPointFromClient(event.clientX, event.clientY);
      if (!world) {
        return;
      }

      pointerRef.current = { active: true, id: event.pointerId };
      state.aiming.active = true;
      state.aiming.pointerX = world.x;
      state.aiming.pointerY = world.y;
      state.aiming.power = 0;

      event.currentTarget.setPointerCapture(event.pointerId);
      syncHud();
    },
    [syncHud, worldPointFromClient]
  );

  const handlePointerMove = useCallback(
    (event) => {
      const pointer = pointerRef.current;
      const state = gameRef.current;
      if (!pointer.active || pointer.id !== event.pointerId || !state.aiming.active) {
        return;
      }

      const world = worldPointFromClient(event.clientX, event.clientY);
      if (!world) {
        return;
      }

      const dragDistance = distance(state.ball.x, state.ball.y, world.x, world.y);
      state.aiming.pointerX = world.x;
      state.aiming.pointerY = world.y;
      state.aiming.power = clamp(dragDistance / 240, 0, 1);
    },
    [worldPointFromClient]
  );

  const releaseAim = useCallback(
    (event) => {
      const pointer = pointerRef.current;
      const state = gameRef.current;
      if (!pointer.active || pointer.id !== event.pointerId) {
        return;
      }

      pointerRef.current = { active: false, id: null };
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      if (!state.aiming.active) {
        return;
      }

      const world = worldPointFromClient(event.clientX, event.clientY);
      if (!world) {
        state.aiming.active = false;
        syncHud();
        return;
      }

      const dx = state.ball.x - world.x;
      const dy = state.ball.y - world.y;
      const dragDistance = Math.hypot(dx, dy);
      const powerNorm = clamp(dragDistance / 240, 0, 1);
      state.aiming.active = false;
      state.aiming.power = powerNorm;

      if (powerNorm >= 0.05) {
        takeShot(dx, dy, powerNorm);
      } else {
        syncHud();
      }
    },
    [syncHud, takeShot, worldPointFromClient]
  );

  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        return;
      }
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      drawScene();
    };

    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
    };
  }, [drawScene]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === "input" || tagName === "textarea") {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "b") {
        autoShotTowardCup();
      }

      if (key === "r") {
        dropToLieWithPenalty();
      }

      if (key === "n") {
        const state = gameRef.current;
        if (state.phase === "hole_complete") {
          loadHole(state.holeIndex + 1);
        }
      }

      if (key === "k") {
        concedeHole();
      }

      if (key === "f") {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
      }

      if (["b", "r", "n", "k", "f"].includes(key)) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [autoShotTowardCup, concedeHole, dropToLieWithPenalty, loadHole]);

  useEffect(() => {
    let mounted = true;

    const tick = (now) => {
      const previous = prevRef.current || now;
      prevRef.current = now;
      const delta = Math.max(1 / 240, Math.min(0.05, (now - previous) / 1000));

      stepGame(delta);
      drawScene();

      hudTickRef.current += delta;
      if (hudTickRef.current >= 0.12) {
        hudTickRef.current = 0;
        if (mounted) {
          syncHud();
        }
      }

      rafRef.current = window.requestAnimationFrame(tick);
    };

    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [drawScene, stepGame, syncHud]);

  useEffect(() => {
    window.render_game_to_text = () => JSON.stringify(createTextState(gameRef.current));
    window.advanceTime = (ms) => {
      const steps = Math.max(1, Math.round(ms / (1000 / 60)));
      for (let i = 0; i < steps; i += 1) {
        stepGame(1 / 60);
      }
      drawScene();
      syncHud();
    };

    return () => {
      delete window.render_game_to_text;
      delete window.advanceTime;
    };
  }, [drawScene, stepGame, syncHud]);

  const currentHole = HOLES[hudState.course.holeNumber - 1] || HOLES[0];
  const moving = hudState.ball.speed > STOP_SPEED;
  const scoreRows = useMemo(() => gameRef.current.scorecard, [hudState.score.completedHoles, hudState.mode]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        position: "relative",
        background: "#102616",
        overflow: "hidden"
      }}
    >
      <canvas
        id="solo-golf-canvas"
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={releaseAim}
        onPointerCancel={releaseAim}
        style={{ width: "100%", height: "100%", display: "block", touchAction: "none" }}
      />

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          width: "min(360px, calc(100vw - 28px))",
          padding: "12px 14px",
          borderRadius: 14,
          background: "rgba(12, 20, 15, 0.76)",
          border: "1px solid rgba(255, 255, 255, 0.16)",
          color: "#eef6dc",
          lineHeight: 1.4
        }}
      >
        <div style={{ fontSize: "1rem", fontWeight: 700 }}>{currentHole.name}</div>
        <div style={{ opacity: 0.92 }}>Hole {hudState.course.holeNumber}/{hudState.course.totalHoles} • Par {hudState.course.par}</div>
        <div style={{ marginTop: 4 }}>Strokes (Hole): {hudState.score.strokesThisHole}</div>
        <div>
          Running: {hudState.score.runningStrokes} strokes / {hudState.score.runningPar} par ({hudState.score.toPar >= 0 ? "+" : ""}
          {hudState.score.toPar})
        </div>
        <div style={{ marginTop: 4, opacity: 0.88 }}>
          Ball: {Math.round(hudState.ball.x)}, {Math.round(hudState.ball.y)} • Speed {Math.round(hudState.ball.speed)}
        </div>
        <div style={{ opacity: 0.88 }}>Cup Distance: {Math.round(hudState.cup.distance)}</div>
        <div style={{ marginTop: 6, fontSize: "0.83rem", opacity: 0.82 }}>
          Controls: drag to shoot, `R` reset lie (+1), `N` next hole, `K` concede hole, `B` auto-shot, `F` fullscreen
        </div>
        {gameRef.current.message ? (
          <div style={{ marginTop: 8, color: "#ffdca4", fontSize: "0.84rem", fontWeight: 600 }}>{gameRef.current.message}</div>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          right: 14,
          top: 14,
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          justifyContent: "flex-end",
          width: "min(460px, calc(100vw - 28px))"
        }}
      >
        {hudState.mode === "hole_complete" ? (
          <button
            id="next-hole-btn"
            type="button"
            onClick={() => loadHole(gameRef.current.holeIndex + 1)}
            style={{
              border: "none",
              borderRadius: 10,
              padding: "9px 14px",
              color: "#1c2a16",
              background: "linear-gradient(135deg, #ffe0a6 0%, #ffc77a 100%)",
              fontWeight: 700,
              cursor: "pointer"
            }}
          >
            Next Hole
          </button>
        ) : null}

        <button
          id="restart-course-btn"
          type="button"
          onClick={restartCourse}
          style={{
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 10,
            padding: "9px 12px",
            color: "#f4f6ea",
            background: "rgba(23, 35, 27, 0.8)",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Restart Course
        </button>

        {hudState.mode === "playing" ? (
          <button
            id="concede-hole-btn"
            type="button"
            onClick={concedeHole}
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 10,
              padding: "9px 12px",
              color: "#f4f6ea",
              background: "rgba(44, 39, 24, 0.85)",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Concede Hole
          </button>
        ) : null}

        <button
          id="exit-solo-btn"
          type="button"
          onClick={onExit}
          style={{
            border: "1px solid rgba(255,255,255,0.2)",
            borderRadius: 10,
            padding: "9px 12px",
            color: "#f4f6ea",
            background: "rgba(31, 25, 24, 0.8)",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Exit To Hub
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          left: 14,
          bottom: 14,
          width: "min(420px, calc(100vw - 28px))",
          maxHeight: "36vh",
          overflow: "auto",
          padding: "10px 12px",
          borderRadius: 12,
          background: "rgba(10, 15, 11, 0.75)",
          border: "1px solid rgba(255,255,255,0.14)",
          color: "#dfead2",
          fontSize: "0.84rem"
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Scorecard</div>
        {scoreRows.length ? (
          scoreRows.map((row) => (
            <div key={`score-row-${row.hole}`} style={{ marginBottom: 4 }}>
              H{row.hole} {row.name}: {row.strokes} ({row.toPar >= 0 ? "+" : ""}
              {row.toPar})
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.82 }}>No completed holes yet.</div>
        )}
        <div style={{ marginTop: 8, opacity: 0.82 }}>
          Status: {hudState.mode} {moving ? "• ball moving" : "• ball settled"}
        </div>
      </div>
    </div>
  );
}
