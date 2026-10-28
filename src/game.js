import { LEVELS } from "./levels.js";

const $ = (selector) => document.querySelector(selector);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

const AR = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
const ar = (value) => String(value).replace(/[0-9]/g, (digit) => AR[Number(digit)]);
const arTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${ar(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0").replace(/[0-9]/g, (d) => AR[Number(d)])}`;
};
const arDifficulty = (value) => {
  const whole = Math.floor(value);
  const part = Math.round((value - whole) * 10);
  return part ? `${ar(whole)}.${ar(part)}` : ar(whole);
};

const SKIES = [
  ["#05070f", "#101b3d", "#2a74a8"],
  ["#070a16", "#142147", "#3184b0"],
  ["#090d1b", "#18284f", "#398fb8"],
  ["#0b1021", "#1d2f5b", "#4198bd"],
  ["#0e1228", "#243463", "#4c9fc0"],
  ["#121530", "#2d3a6c", "#5aa6c2"],
  ["#171934", "#384176", "#74abc0"],
  ["#1d1b3c", "#44477f", "#8fa9b8"],
  ["#251f46", "#514d87", "#b2a6a8"],
  ["#2e234e", "#61538e", "#c7a390"],
  ["#392755", "#725a94", "#d6a17c"],
  ["#472b5b", "#856397", "#e5a36b"],
  ["#552f5f", "#9b6e97", "#f0a65f"],
  ["#663365", "#b67a92", "#f9b25f"],
  ["#7c3a68", "#d18a86", "#ffc978"],
];

const canvas = $("#game");
const ctx = canvas.getContext("2d", { alpha: false });
const touchQuery = window.matchMedia("(pointer: coarse)");
let W = 1;
let H = 1;
let DPR = 1;
let scale = 1;

const G = {
  mode: "menu",
  levelIndex: 0,
  level: LEVELS[0],
  player: null,
  camera: { x: 0, y: 0 },
  crumbles: [],
  movers: [],
  blinkers: [],
  doorState: new Map(),
  buttonState: new Map(),
  collected: new Set(),
  sequence: [],
  solved: false,
  freezeUntil: -1,
  levelTime: 0,
  menuTime: 0,
  levelDeaths: 0,
  runTime: 0,
  runDeaths: 0,
  shake: 0,
  flash: 0,
  particles: [],
  trail: [],
  respawn: { x: 0, y: 0 },
  checkpoint: null,
  hudAt: 0,
  ready: false,
  portalPulse: 0,
  completed: false,
  muted: false,
  hintPulse: 0,
};

const input = {
  left: false,
  right: false,
  jumpHeld: false,
  jumpBuffer: 0,
  jumpPressed: false,
};

const PHYS = {
  gravity: 2350,
  move: 318,
  accel: 2500,
  friction: 2350,
  jump: 790,
  maxFall: 1250,
  coyote: 0.1,
  buffer: 0.13,
  w: 26,
  h: 34,
};

const STAR_FIELD = (() => {
  let seed = 92731;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  return Array.from({ length: 100 }, () => ({
    x: random(),
    y: random() * 0.72,
    r: 0.5 + random() * 1.7,
    a: 0.25 + random() * 0.7,
    tw: random() * TAU,
  }));
})();

const CLOUDS = (() => {
  let seed = 44117;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  return Array.from({ length: 7 }, () => ({
    x: random(),
    y: 0.1 + random() * 0.55,
    s: 0.55 + random() * 1.2,
    a: 0.04 + random() * 0.09,
    v: 3 + random() * 8,
  }));
})();

const audio = {
  ctx: null,
  ensure() {
    if (G.muted) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      try {
        this.ctx = new Ctor();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  },
  tone(freq, duration = 0.1, type = "sine", volume = 0.06, delay = 0) {
    if (G.muted) return;
    this.ensure();
    if (!this.ctx) return;
    const start = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.03);
  },
  jump() {
    this.tone(440, 0.11, "triangle", 0.05);
    this.tone(660, 0.09, "sine", 0.035, 0.03);
  },
  land() {
    this.tone(150, 0.08, "sine", 0.035);
  },
  key() {
    this.tone(880, 0.12, "sine", 0.05);
    this.tone(1320, 0.14, "sine", 0.04, 0.06);
  },
  button(ok = true) {
    if (ok) {
      this.tone(520, 0.1, "triangle", 0.05);
      this.tone(780, 0.1, "triangle", 0.04, 0.05);
    } else {
      this.tone(190, 0.16, "sawtooth", 0.04);
      this.tone(140, 0.2, "sawtooth", 0.03, 0.08);
    }
  },
  solve() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.2, "sine", 0.045, i * 0.07));
  },
  portal() {
    [392, 523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.32, "triangle", 0.045, i * 0.08));
  },
  die() {
    this.tone(220, 0.22, "sawtooth", 0.05);
    this.tone(110, 0.3, "sine", 0.04, 0.05);
  },
};

function resize() {
  const rect = canvas.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, rect.width);
  H = Math.max(1, rect.height);
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  const base = W < 720 ? 570 : 1080;
  scale = clamp(W / base, 0.64, 1.55);
  if (G.mode !== "menu") clampCamera(true);
}

function visibleSize() {
  return { w: W / scale, h: H / scale };
}

function clampCamera(snap = false) {
  const view = visibleSize();
  const level = G.level;
  const player = G.player;
  let targetX = player ? player.x + player.facing * 55 + player.vx * 0.1 : level.width / 2;
  let targetY = player ? player.y - 80 : level.height / 2;
  if (view.w >= level.width) targetX = level.width / 2;
  else targetX = clamp(targetX, view.w / 2, level.width - view.w / 2);
  targetY = clamp(targetY, -80, level.height + 150);
  if (snap || G.mode === "menu") {
    G.camera.x = targetX;
    G.camera.y = targetY;
  } else {
    G.camera.x = lerp(G.camera.x, targetX, 0.12);
    G.camera.y = lerp(G.camera.y, targetY, 0.1);
  }
}

function activeBlink(plat) {
  if (G.freezeUntil > G.levelTime) return true;
  const cycle = ((G.levelTime + plat.phase) % plat.period + plat.period) % plat.period;
  return cycle < plat.period * 0.66;
}

function updatePlatforms() {
  for (const plat of G.movers) {
    plat.prevX = plat.x;
    plat.prevY = plat.y;
    const phase = (G.levelTime / plat.period) * TAU + plat.phase * 1.4;
    if (plat.axis === "x") {
      plat.x = plat.baseX + Math.sin(phase) * plat.amp;
      plat.y = plat.baseY;
    } else {
      plat.x = plat.baseX;
      plat.y = plat.baseY + Math.sin(phase) * plat.amp;
    }
  }
  for (const plat of G.blinkers) plat.active = activeBlink(plat);
  for (const plat of G.crumbles) {
    if (plat.breakAt && G.levelTime >= plat.breakAt) plat.broken = true;
  }
}

function openDoor(id) {
  const door = G.doorState.get(id);
  if (!door || door.open) return;
  door.open = true;
  door.anim = Math.max(door.anim, 0.01);
  burst(door.x + door.w / 2, door.y + door.h / 2, 22, "#ffd98a", 1.3);
  audio.solve();
}

function closeDoor(id) {
  const door = G.doorState.get(id);
  if (!door) return;
  door.open = false;
}

function solveLevel() {
  if (G.solved) return;
  G.solved = true;
  G.portalPulse = 1.3;
  burst(G.level.goal.x + G.level.goal.w / 2, G.level.goal.y + G.level.goal.h / 2, 30, "#7df7ff", 1.5);
}

function loadLevel(index, { runReset = false } = {}) {
  const level = LEVELS[clamp(index, 0, LEVELS.length - 1)];
  G.levelIndex = level.n - 1;
  G.level = level;
  G.mode = "playing";
  G.levelTime = 0;
  G.levelDeaths = 0;
  G.completed = false;
  G.solved = level.logic === "reach";
  G.freezeUntil = -1;
  G.sequence = [];
  G.collected = new Set();
  G.portalPulse = 0;
  G.flash = 0;
  G.shake = 0;
  G.particles = [];
  G.trail = [];
  G.hintPulse = 3;
  if (runReset) {
    G.runTime = 0;
    G.runDeaths = 0;
  }
  G.respawn = { x: level.spawn.x, y: level.spawn.y };
  G.checkpoint = null;
  G.player = {
    x: level.spawn.x,
    y: level.spawn.y,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: false,
    coyote: 0,
    groundRef: null,
    jumpHeld: false,
    anim: 0,
    squash: 1,
  };
  input.left = false;
  input.right = false;
  input.jumpHeld = false;
  input.jumpBuffer = 0;
  G.crumbles = level.crumbles.map((item) => ({
    ...item,
    kind: "crumble",
    breakAt: 0,
    broken: false,
    shake: 0,
  }));
  G.movers = level.movers.map((item) => ({
    ...item,
    kind: "mover",
    baseX: item.x,
    baseY: item.y,
    prevX: item.x,
    prevY: item.y,
    active: true,
  }));
  G.blinkers = level.blinkers.map((item) => ({
    ...item,
    kind: "blinker",
    active: true,
  }));
  G.doorState = new Map(
    level.doors.map((door) => [
      door.id,
      { ...door, open: Boolean(door.initialOpen), anim: door.initialOpen ? 1 : 0 },
    ]),
  );
  G.buttonState = new Map(
    level.buttons.map((button) => [
      button.id,
      { ...button, inside: false, pressed: false, flash: 0, pulse: 0, visits: 0 },
    ]),
  );
  const needs = Math.max(1, ...level.doors.map((door) => door.keys || 0), level.keys.length ? level.keys.length : 0);
  G.keyGoal = level.keys.length ? needs : 0;
  G.camera = { x: level.spawn.x, y: level.spawn.y - 80 };
  clampCamera(true);
  updateHud(true);
  hideAllScreens();
}

function startLevel(index, options = {}) {
  audio.ensure();
  loadLevel(index, options);
  G.runTime = 0;
  G.runDeaths = 0;
  if (options.runReset === undefined) {
    G.runTime = 0;
    G.runDeaths = 0;
  }
}

function platformRects() {
  const list = [];
  for (const plat of G.level.platforms) list.push({ ...plat, kind: "static", active: true });
  for (const plat of G.crumbles) if (!plat.broken) list.push(plat);
  for (const plat of G.movers) list.push(plat);
  for (const plat of G.blinkers) if (plat.active) list.push(plat);
  return list;
}

function solidRects() {
  const list = [];
  for (const wall of G.level.walls) list.push(wall);
  for (const door of G.doorState.values()) if (!door.open) list.push(door);
  return list;
}

function overlapBody(x, y, rect) {
  const left = x - PHYS.w / 2;
  const right = x + PHYS.w / 2;
  const top = y - PHYS.h;
  return right > rect.x + 1 && left < rect.x + rect.w - 1 && y > rect.y + 1 && top < rect.y + rect.h - 1;
}

function horizontalOverlap(x, rect) {
  return x + PHYS.w / 2 > rect.x + 2 && x - PHYS.w / 2 < rect.x + rect.w - 2;
}

function updatePlayer(dt) {
  const p = G.player;
  if (p.groundRef && p.groundRef.kind === "mover") {
    p.x += p.groundRef.x - p.groundRef.prevX;
    p.y += p.groundRef.y - p.groundRef.prevY;
  }
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) {
    p.vx += dir * PHYS.accel * dt;
    p.vx = clamp(p.vx, -PHYS.move, PHYS.move);
    p.facing = dir;
  } else {
    const drop = PHYS.friction * dt;
    if (Math.abs(p.vx) <= drop) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * drop;
  }
  if (G.level.logic !== "reach" || true) p.anim += Math.abs(p.vx) * dt * 0.04;

  input.jumpBuffer = Math.max(0, input.jumpBuffer - dt);
  if (input.jumpBuffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = -PHYS.jump;
    p.grounded = false;
    p.groundRef = null;
    p.coyote = 0;
    input.jumpBuffer = 0;
    p.squash = 0.72;
    audio.jump();
    burst(p.x, p.y, 7, "#bdf6ff", 0.7);
  }
  if (!input.jumpHeld && p.vy < -180) p.vy += PHYS.gravity * 0.85 * dt;

  p.vy = Math.min(PHYS.maxFall, p.vy + PHYS.gravity * dt);

  p.x += p.vx * dt;
  p.x = clamp(p.x, -40, G.level.width + 40);
  for (const rect of solidRects()) {
    if (!overlapBody(p.x, p.y, rect)) continue;
    if (p.vx > 0) p.x = rect.x - PHYS.w / 2 - 0.1;
    else if (p.vx < 0) p.x = rect.x + rect.w + PHYS.w / 2 + 0.1;
    else p.x = rect.x - PHYS.w / 2 - 0.1;
    p.vx = 0;
  }

  const prevFeet = p.y;
  p.y += p.vy * dt;
  p.grounded = false;
  p.groundRef = null;

  for (const rect of solidRects()) {
    if (!overlapBody(p.x, p.y, rect)) continue;
    if (p.vy > 0) {
      p.y = rect.y;
      p.vy = 0;
      p.grounded = true;
      p.groundRef = rect;
    } else if (p.vy < 0) {
      p.y = rect.y + rect.h + PHYS.h;
      p.vy = 0;
    }
  }

  if (p.vy >= 0) {
    let landing = null;
    for (const plat of platformRects()) {
      if (!horizontalOverlap(p.x, plat)) continue;
      const top = plat.y;
      if (prevFeet <= top + 8 && p.y >= top - 0.5) {
        if (!landing || top < landing.y) landing = plat;
      }
    }
    if (landing) {
      p.y = landing.y;
      const impact = p.vy;
      p.vy = 0;
      p.grounded = true;
      p.groundRef = landing;
      p.squash = impact > 700 ? 0.78 : 1;
      if (impact > 620) {
        audio.land();
        burst(p.x, p.y, 6, "#d6ecff", 0.5);
        G.shake = Math.max(G.shake, Math.min(5, impact / 280));
      }
      if (landing.kind === "crumble" && !landing.breakAt) {
        landing.breakAt = G.levelTime + 0.45;
        audio.button(false);
      }
    }
  }

  if (p.grounded) {
    p.coyote = PHYS.coyote;
    p.anim += Math.abs(p.vx) * dt * 0.02;
  } else {
    p.coyote = Math.max(0, p.coyote - dt);
  }
  p.squash = lerp(p.squash, 1, Math.min(1, dt * 10));
  if (p.vy > 200) p.jumpHeld = input.jumpHeld;

  if (Math.abs(p.vx) > 30 && p.grounded && Math.random() < 0.45) {
    G.trail.push({
      x: p.x + (Math.random() - 0.5) * 12,
      y: p.y - 2,
      vx: -p.vx * 0.08,
      vy: -20 - Math.random() * 25,
      life: 0.45,
      max: 0.45,
      size: 2 + Math.random() * 3,
      color: "#8fe8ff",
    });
  }
  if (!p.grounded && Math.random() < 0.28) {
    G.trail.push({
      x: p.x + (Math.random() - 0.5) * 8,
      y: p.y - 14 + Math.random() * 10,
      vx: -p.vx * 0.04,
      vy: 15,
      life: 0.4,
      max: 0.4,
      size: 1.5 + Math.random() * 2.5,
      color: "#ffd27a",
    });
  }

  if (p.y > G.level.height + 150) die();
}

function updateInteractions() {
  const p = G.player;
  const level = G.level;

  for (const cp of level.checkpoints) {
    if (G.checkpoint) break;
    if (Math.abs(p.x - cp.x) < 65 && Math.abs(p.y - cp.y) < 90) {
      G.checkpoint = cp;
      G.respawn = { x: cp.x, y: cp.y };
      burst(cp.x, cp.y - 20, 14, "#8dffcf", 1);
      audio.tone(660, 0.12, "sine", 0.04);
      audio.tone(990, 0.14, "sine", 0.03, 0.06);
    }
  }

  level.keys.forEach((item, index) => {
    const id = `${level.n}:${index}`;
    if (G.collected.has(id)) return;
    if (Math.abs(p.x - item.x) < 32 && Math.abs(p.y - 16 - item.y) < 46) {
      G.collected.add(id);
      burst(item.x, item.y, 18, "#ffd76a", 1.1);
      audio.key();
      const required = Math.max(0, ...level.doors.map((d) => d.keys || 0));
      const have = G.collected.size;
      if (have >= required) {
        let opened = false;
        for (const door of G.doorState.values()) {
          if (door.keys && !door.open) {
            openDoor(door.id);
            opened = true;
          }
        }
        if (opened) solveLevel();
      }
    }
  });

  for (const button of G.buttonState.values()) {
    const inside =
      p.x + PHYS.w / 2 > button.x - 2 &&
      p.x - PHYS.w / 2 < button.x + button.w + 2 &&
      p.y > button.y - 8 &&
      p.y - PHYS.h < button.y + button.h + 10;
    if (inside && !button.inside) onButton(button);
    button.inside = inside;
    if (button.flash > 0) button.flash -= 1 / 60;
    if (button.pulse > 0) button.pulse -= 1 / 60;
  }

  if (G.solved) {
    const goal = level.goal;
    if (
      p.x + PHYS.w / 2 > goal.x &&
      p.x - PHYS.w / 2 < goal.x + goal.w &&
      p.y > goal.y - goal.h &&
      p.y - PHYS.h < goal.y + 10
    ) {
      completeLevel();
    }
  }
}

function onButton(button) {
  button.pulse = 1;
  if (button.action === "latch") {
    button.pressed = true;
    button.flash = 0.4;
    for (const id of button.doors || []) openDoor(id);
    if (!G.solved && G.level.logic === "buttonDoor") solveLevel();
    audio.button(true);
    burst(button.x + button.w / 2, button.y, 16, "#ffcf77", 1);
    return;
  }

  if (button.action === "toggle") {
    button.pressed = !button.pressed;
    button.flash = 0.4;
    for (const id of button.toggle || []) {
      const door = G.doorState.get(id);
      if (!door) continue;
      if (door.open) closeDoor(id);
      else openDoor(id);
    }
    if (G.level.solveDoor) {
      const door = G.doorState.get(G.level.solveDoor);
      G.solved = Boolean(door && door.open);
      if (G.solved) {
        G.portalPulse = 1.2;
        burst(button.x + button.w / 2, button.y, 18, "#8dffe5", 1);
      }
    }
    audio.button(true);
    burst(button.x + button.w / 2, button.y, 14, "#8dffe5", 1);
    return;
  }

  if (button.action === "stabilize") {
    button.pressed = true;
    button.flash = 0.45;
    G.freezeUntil = G.levelTime + (button.duration || 9);
    G.hintPulse = 2.6;
    audio.solve();
    burst(button.x + button.w / 2, button.y, 26, "#a6f7ff", 1.3);
    solveLevel();
    return;
  }

  if (button.action === "sequence") {
    if (!G.level.sequence || G.sequence.length >= G.level.sequence.length) return;
    const expected = G.level.sequence[G.sequence.length];
    if (button.id === expected) {
      G.sequence.push(button.id);
      button.pressed = true;
      button.flash = 0.45;
      audio.button(true);
      burst(button.x + button.w / 2, button.y, 12, "#8dffe5", 0.9);
      if (G.sequence.length === G.level.sequence.length) {
        const correctDoors = G.level.sequenceDoors || (G.level.sequenceDoor ? [G.level.sequenceDoor] : []);
        const wrongDoors = G.level.wrongDoors || (G.level.wrongDoor ? [G.level.wrongDoor] : []);
        wrongDoors.forEach(closeDoor);
        correctDoors.forEach(openDoor);
        solveLevel();
      }
    } else {
      G.sequence = [];
      button.flash = 0.6;
      for (const state of G.buttonState.values()) state.pressed = false;
      audio.button(false);
      G.shake = Math.max(G.shake, 4);
      G.flash = 0.28;
      const correctDoors = G.level.sequenceDoors || (G.level.sequenceDoor ? [G.level.sequenceDoor] : []);
      const wrongDoors = G.level.wrongDoors || (G.level.wrongDoor ? [G.level.wrongDoor] : []);
      if (!G.solved) correctDoors.forEach(closeDoor);
      wrongDoors.forEach(openDoor);
    }
  }
}

function die() {
  if (G.mode !== "playing") return;
  audio.die();
  G.levelDeaths += 1;
  G.shake = 7;
  G.flash = 0.5;
  burst(G.player.x, Math.min(G.player.y, G.level.height - 20), 24, "#ff6b6b", 1.4);
  G.player.x = G.respawn.x;
  G.player.y = G.respawn.y;
  G.player.vx = 0;
  G.player.vy = 0;
  G.player.facing = 1;
  G.player.grounded = false;
  G.player.groundRef = null;
  for (const crumble of G.crumbles) {
    crumble.broken = false;
    crumble.breakAt = 0;
    crumble.shake = 0;
  }
  clampCamera(true);
}

function completeLevel() {
  if (G.mode !== "playing") return;
  G.mode = "complete";
  G.completed = true;
  G.runTime += G.levelTime;
  G.runDeaths += G.levelDeaths;
  audio.portal();
  G.portalPulse = 2;
  burst(G.level.goal.x + G.level.goal.w / 2, G.level.goal.y + G.level.goal.h / 2, 60, "#ffe9a6", 2.2);
  try {
    const saved = Number(localStorage.getItem("ga.best") || 0);
    if (G.level.n > saved) localStorage.setItem("ga.best", String(G.level.n));
  } catch {}
  if (G.levelIndex >= LEVELS.length - 1) {
    showFinal();
  } else {
    showComplete();
  }
}

function nextLevel() {
  if (G.levelIndex >= LEVELS.length - 1) {
    showFinal();
    return;
  }
  const next = G.levelIndex + 1;
  loadLevel(next);
  G.runTime = Math.max(G.runTime, 0);
}

function restartLevel() {
  loadLevel(G.levelIndex);
}

function togglePause() {
  if (G.mode === "playing") {
    G.mode = "paused";
    showPause();
  } else if (G.mode === "paused") {
    G.mode = "playing";
    hideAllScreens();
  }
}

function burst(x, y, count, color, power = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const speed = (40 + Math.random() * 180) * power;
    G.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 30,
      life: 0.5 + Math.random() * 0.7,
      max: 1.2,
      size: 1.5 + Math.random() * 3.5,
      color,
      gravity: 240,
    });
  }
}

function updateParticles(dt) {
  const all = [...G.particles, ...G.trail];
  for (let i = all.length - 1; i >= 0; i -= 1) {
    const part = all[i];
    part.life -= dt;
    if (part.life <= 0) {
      const indexP = G.particles.indexOf(part);
      if (indexP >= 0) G.particles.splice(indexP, 1);
      const indexT = G.trail.indexOf(part);
      if (indexT >= 0) G.trail.splice(indexT, 1);
      continue;
    }
    part.x += part.vx * dt;
    part.y += part.vy * dt;
    if (part.gravity) part.vy += part.gravity * dt;
  }
}

function update(dt) {
  if (G.mode !== "playing") return;
  G.levelTime += dt;
  G.hintPulse = Math.max(0, G.hintPulse - dt);
  G.shake = Math.max(0, G.shake - dt * 18);
  G.flash = Math.max(0, G.flash - dt * 2.2);
  G.portalPulse = Math.max(0, G.portalPulse - dt);
  updatePlatforms();
  updatePlayer(dt);
  updateInteractions();
  updateParticles(dt);
  for (const door of G.doorState.values()) {
    const target = door.open ? 1 : 0;
    door.anim = lerp(door.anim, target, Math.min(1, dt * 7));
    if (Math.abs(door.anim - target) < 0.002) door.anim = target;
  }
  clampCamera();
  updateHud();
  if (G.player.y > G.level.height + 150) die();
}

function drawBackground(time) {
  const idx = G.levelIndex;
  const [top, bottom, glow] = SKIES[Math.min(SKIES.length - 1, idx)];
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, top);
  grad.addColorStop(0.58, bottom);
  grad.addColorStop(1, mixHex(bottom, "#05060d", 0.35));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const sunX = W * (0.2 + (idx / 14) * 0.58);
  const sunY = H * (0.72 - (idx / 14) * 0.42);
  const sunR = Math.min(W, H) * (0.32 + (idx / 14) * 0.2);
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR);
  sun.addColorStop(0, hexAlpha(glow, 0.4));
  sun.addColorStop(0.35, hexAlpha(glow, 0.16));
  sun.addColorStop(1, hexAlpha(glow, 0));
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);

  const starAlpha = clamp(0.9 - idx / 16, 0.05, 0.9);
  for (const star of STAR_FIELD) {
    const x = modulo(star.x * W + G.camera.x * 0.025, W);
    const y = modulo(star.y * H - G.camera.y * 0.02, H * 0.85);
    const tw = 0.55 + Math.sin(time * 1.7 + star.tw) * 0.45;
    ctx.globalAlpha = star.a * starAlpha * tw;
    ctx.fillStyle = "#eaf7ff";
    ctx.beginPath();
    ctx.arc(x, y, star.r, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  for (const cloud of CLOUDS) {
    const x = modulo(cloud.x * W + time * cloud.v - G.camera.x * 0.03, W + 300) - 150;
    const y = cloud.y * H - G.camera.y * 0.05 + Math.sin(time * 0.2 + cloud.x * 8) * 8;
    ctx.globalAlpha = cloud.a;
    ctx.fillStyle = mixHex(bottom, "#ffffff", 0.55);
    ctx.beginPath();
    ctx.ellipse(x, y, 110 * cloud.s, 26 * cloud.s, 0, 0, TAU);
    ctx.ellipse(x + 70 * cloud.s, y + 8, 80 * cloud.s, 20 * cloud.s, 0, 0, TAU);
    ctx.ellipse(x - 75 * cloud.s, y + 10, 65 * cloud.s, 16 * cloud.s, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const altitude = clamp((G.level.height - G.camera.y) / Math.max(1, G.level.height), 0, 1.5);
  ridge(H * 0.58 + altitude * H * 0.1, H * 0.045, 0.0036, G.camera.x * 0.06, mixHex(bottom, "#05060f", 0.5), 0.85);
  ridge(H * 0.67 + altitude * H * 0.12, H * 0.065, 0.0027, G.camera.x * 0.12 + 240, mixHex(bottom, "#05060f", 0.68), 0.9);
  ridge(H * 0.78 + altitude * H * 0.14, H * 0.08, 0.0021, G.camera.x * 0.2 + 520, mixHex(bottom, "#03040a", 0.82), 0.95);

  ctx.fillStyle = hexAlpha(glow, 0.06);
  for (let i = 0; i < 4; i += 1) {
    const x = modulo(i * 360 + 120 - G.camera.x * 0.05, W + 240) - 120;
    ctx.fillRect(x, 0, 2, H);
  }
}

function ridge(baseY, amp, freq, offset, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W + 14; x += 14) {
    const y =
      baseY +
      Math.sin((x + offset) * freq) * amp +
      Math.sin((x + offset) * freq * 2.7 + 1.4) * amp * 0.42 +
      Math.sin((x + offset) * freq * 0.5) * amp * 0.5;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawWorld(time) {
  const level = G.level;
  ctx.save();
  const shake = G.shake > 0 ? G.shake : 0;
  const sx = (Math.random() - 0.5) * shake;
  const sy = (Math.random() - 0.5) * shake;
  ctx.translate(W / 2 + sx, H / 2 + sy);
  ctx.scale(scale, scale);
  ctx.translate(-G.camera.x, -G.camera.y);
  drawStageDecor(time);
  drawPlatforms(time);
  drawWalls();
  drawSign();
  level.checkpoints.forEach((cp) => drawCheckpoint(cp));
  level.keys.forEach((item, index) => {
    if (!G.collected.has(`${level.n}:${index}`)) drawKey(item, time);
  });
  for (const button of G.buttonState.values()) drawButton(button, time);
  for (const door of G.doorState.values()) drawDoor(door, time);
  drawGoal(time);
  drawParticles();
  drawPlayer(time);
  ctx.restore();
}

function drawStageDecor(time) {
  const level = G.level;
  const accent = levelAccent();
  const heights = [level.height * 0.28, level.height * 0.55, level.height * 0.78];
  heights.forEach((y, i) => {
    const x = level.width * (0.18 + i * 0.32);
    ctx.globalAlpha = 0.07;
    const grad = ctx.createLinearGradient(x, 0, x, level.height);
    grad.addColorStop(0, hexAlpha(accent, 0));
    grad.addColorStop(0.5, hexAlpha(accent, 0.8));
    grad.addColorStop(1, hexAlpha(accent, 0));
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, 2.5, level.height);
    ctx.globalAlpha = 0.05;
    ctx.fillRect(x - 20, y - 40, 40, 80);
  });
  ctx.globalAlpha = 1;
  const particleCount = 24;
  for (let i = 0; i < particleCount; i += 1) {
    const seed = i * 137.5;
    const x = (modulo(seed * 7.3 + time * (4 + (i % 5)), level.width) + level.width) % level.width;
    const y = modulo(seed * 13.1 - time * (6 + (i % 4)), level.height);
    ctx.globalAlpha = 0.22 + 0.16 * Math.sin(time + i);
    ctx.fillStyle = hexAlpha(accent, 0.7);
    ctx.beginPath();
    ctx.arc(x, y, 1.2 + (i % 3) * 0.7, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlatforms(time) {
  const accent = levelAccent();
  for (const plat of G.level.platforms) drawPlatform(plat, accent, "static", time);
  for (const plat of G.crumbles) {
    if (plat.broken) continue;
    drawPlatform(plat, "#ffa36a", "crumble", time, plat.breakAt ? 1 : 0);
  }
  for (const plat of G.movers) drawPlatform(plat, "#8ee7ff", "mover", time);
  for (const plat of G.blinkers) drawPlatform(plat, "#c3b3ff", "blinker", time, 0, plat.active);
}

function drawPlatform(plat, accent, kind, time, danger = 0, active = true) {
  const x = plat.x;
  const y = plat.y;
  const w = plat.w;
  const h = plat.h;
  const radius = Math.min(10, h / 2);
  ctx.save();
  if (!active) {
    ctx.globalAlpha = 0.24;
    ctx.setLineDash([8, 8]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexAlpha(accent, 0.9);
    roundRect(ctx, x, y, w, h, radius);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const shakeX = danger ? (Math.random() - 0.5) * 3 : 0;
  ctx.translate(shakeX, 0);
  ctx.shadowColor = hexAlpha(accent, 0.42);
  ctx.shadowBlur = kind === "mover" ? 22 : 14;
  const grad = ctx.createLinearGradient(0, y, 0, y + h);
  if (kind === "crumble") {
    grad.addColorStop(0, "#5a3b46");
    grad.addColorStop(1, "#241a24");
  } else if (kind === "blinker") {
    grad.addColorStop(0, "#4a4276");
    grad.addColorStop(1, "#221f3c");
  } else if (kind === "mover") {
    grad.addColorStop(0, "#27536c");
    grad.addColorStop(1, "#122735");
  } else {
    grad.addColorStop(0, mixHex("#233a5c", accent, 0.08));
    grad.addColorStop(1, "#101a2d");
  }
  ctx.fillStyle = grad;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hexAlpha(accent, kind === "mover" ? 0.85 : 0.5);
  ctx.lineWidth = 1.5;
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
  ctx.strokeStyle = hexAlpha("#ffffff", 0.36);
  ctx.beginPath();
  ctx.moveTo(x + 4, y + 1.2);
  ctx.lineTo(x + w - 4, y + 1.2);
  ctx.stroke();

  if (kind === "mover") {
    ctx.strokeStyle = hexAlpha("#c9f8ff", 0.7);
    ctx.lineWidth = 1.2;
    const dir = plat.axis === "x" ? 1 : 0;
    const midX = x + w / 2;
    const midY = y + h / 2;
    ctx.beginPath();
    if (dir) {
      ctx.moveTo(midX - 10, midY);
      ctx.lineTo(midX + 10, midY);
      ctx.moveTo(midX + 5, midY - 4);
      ctx.lineTo(midX + 10, midY);
      ctx.lineTo(midX + 5, midY + 4);
    } else {
      ctx.moveTo(midX, midY - 7);
      ctx.lineTo(midX, midY + 7);
      ctx.moveTo(midX - 4, midY + 2);
      ctx.lineTo(midX, midY + 7);
      ctx.lineTo(midX + 4, midY + 2);
    }
    ctx.stroke();
  }
  if (kind === "crumble") {
    ctx.strokeStyle = hexAlpha("#ffcaa1", 0.75);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x + w * 0.2, y + 2);
    ctx.lineTo(x + w * 0.34, y + h * 0.55);
    ctx.lineTo(x + w * 0.24, y + h - 2);
    ctx.moveTo(x + w * 0.62, y + 1);
    ctx.lineTo(x + w * 0.55, y + h * 0.5);
    ctx.lineTo(x + w * 0.72, y + h - 1);
    ctx.stroke();
  }
  if (kind === "blinker") {
    const pulse = 0.35 + 0.35 * Math.sin(time * 5 + plat.x);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = "#d9d0ff";
    ctx.beginPath();
    ctx.arc(x + w / 2, y + h / 2, 2.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawWalls() {
  for (const wall of G.level.walls) {
    ctx.save();
    ctx.fillStyle = "rgba(18, 22, 40, 0.9)";
    ctx.strokeStyle = "rgba(120, 160, 210, 0.3)";
    roundRect(ctx, wall.x, wall.y, wall.w, wall.h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawSign() {
  const level = G.level;
  const x = level.spawn.x + 40;
  const y = level.spawn.y - 205;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = "rgba(8, 15, 29, 0.78)";
  ctx.strokeStyle = hexAlpha(levelAccent(), 0.55);
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, y, 238, 60, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = hexAlpha(levelAccent(), 0.95);
  ctx.font = '600 20px "Segoe UI", Tahoma, sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(level.name, x + 222, y + 27);
  ctx.fillStyle = "rgba(224, 240, 255, 0.72)";
  ctx.font = '500 13px "Segoe UI", Tahoma, sans-serif';
  ctx.fillText("Gradual Ascent", x + 222, y + 48);
  ctx.textAlign = "left";
  ctx.fillStyle = hexAlpha(levelAccent(), 0.9);
  ctx.font = '700 22px "Segoe UI", Tahoma, sans-serif';
  ctx.fillText(ar(level.n), x + 14, y + 36);
  ctx.restore();
}

function drawCheckpoint(cp) {
  const active = G.checkpoint === cp;
  const color = active ? "#8dffcf" : "#6f87a8";
  ctx.save();
  ctx.globalAlpha = active ? 0.95 : 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cp.x, cp.y);
  ctx.lineTo(cp.x, cp.y - 54);
  ctx.stroke();
  const wave = Math.sin(performance.now() / 280) * 3;
  ctx.fillStyle = hexAlpha(color, 0.75);
  ctx.beginPath();
  ctx.moveTo(cp.x, cp.y - 54);
  ctx.quadraticCurveTo(cp.x + 20, cp.y - 60 + wave, cp.x + 34, cp.y - 48);
  ctx.lineTo(cp.x + 30, cp.y - 32);
  ctx.quadraticCurveTo(cp.x + 15, cp.y - 38 - wave, cp.x, cp.y - 32);
  ctx.closePath();
  ctx.fill();
  if (active) {
    ctx.globalAlpha = 0.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y - 16, 10, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

function drawKey(item, time) {
  const bob = Math.sin(time * 2.4 + item.x * 0.01) * 5;
  const x = item.x;
  const y = item.y + bob;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(time * 1.5) * 0.16);
  ctx.shadowColor = "rgba(255, 210, 90, 0.8)";
  ctx.shadowBlur = 20;
  ctx.strokeStyle = "#ffd76a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(-6, 0, 7, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(16, 0);
  ctx.moveTo(12, 0);
  ctx.lineTo(12, 6);
  ctx.moveTo(16, 0);
  ctx.lineTo(16, 8);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255, 244, 204, 0.9)";
  ctx.beginPath();
  ctx.arc(-6, 0, 2, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawButton(button, time) {
  const cx = button.x + button.w / 2;
  const cy = button.y + button.h / 2;
  const state = G.buttonState.get(button.id);
  const pressed = state && (state.pressed || state.inside);
  const flash = state ? state.flash : 0;
  const accent = pressed ? "#9dffd9" : "#ffd27a";
  const pulse = 0.5 + 0.5 * Math.sin(time * 4 + button.x * 0.02);
  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(8, 14, 28, 0.85)";
  ctx.strokeStyle = hexAlpha(accent, 0.75);
  ctx.lineWidth = 1.5;
  roundRect(ctx, button.x - 5, button.y + 4, button.w + 10, Math.max(10, button.h + 5), 6);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = hexAlpha(accent, 0.8);
  ctx.shadowBlur = pressed ? 26 : 12 + pulse * 8;
  ctx.fillStyle = pressed ? hexAlpha(accent, 0.85) : "rgba(22, 35, 54, 0.95)";
  ctx.beginPath();
  ctx.arc(cx, cy + 2, Math.min(13, button.w / 2 - 3), 0, TAU);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = hexAlpha(accent, 0.9);
  ctx.stroke();
  if (flash > 0) {
    ctx.globalAlpha = flash;
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.arc(cx, cy + 2, 18, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = pressed ? "#04211b" : "#ffe9b0";
  ctx.font = '700 15px "Segoe UI", Tahoma, sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(button.symbol, cx, cy + 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function drawDoor(door, time) {
  const open = door.anim;
  const accent = door.open ? "#8dffd9" : "#ff8b92";
  ctx.save();
  const frameW = door.w + 14;
  ctx.fillStyle = "rgba(7, 11, 22, 0.75)";
  ctx.strokeStyle = hexAlpha(accent, 0.55);
  ctx.lineWidth = 1.5;
  roundRect(ctx, door.x - 7, door.y - 8, frameW, door.h + 16, 7);
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = hexAlpha(accent, 0.55);
  ctx.shadowBlur = 18;
  ctx.strokeStyle = hexAlpha(accent, 0.85);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(door.x - 2, door.y - 4);
  ctx.lineTo(door.x + door.w + 2, door.y - 4);
  ctx.stroke();
  ctx.shadowBlur = 0;
  const bars = 5;
  const shift = open * (door.h + 12);
  for (let i = 0; i < bars; i += 1) {
    const y = door.y + (i + 0.5) * (door.h / bars) - 20 - shift;
    ctx.globalAlpha = 1 - open * 0.7;
    ctx.fillStyle = i % 2 ? "#26334d" : "#1d2940";
    roundRect(ctx, door.x + 3, y, door.w - 6, 7, 3);
    ctx.fill();
    ctx.strokeStyle = hexAlpha(accent, 0.4);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  if (!door.open) {
    const cx = door.x + door.w / 2;
    const cy = door.y + door.h / 2;
    ctx.fillStyle = "rgba(8, 14, 26, 0.9)";
    ctx.strokeStyle = hexAlpha("#ffd27a", 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, TAU);
    ctx.fill();
    ctx.stroke();
    if (door.keys) {
      ctx.fillStyle = "#ffd27a";
      ctx.font = '700 12px "Segoe UI", Tahoma, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ar(door.keys), cx, cy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    } else {
      ctx.fillStyle = "#ffd27a";
      ctx.fillRect(cx - 5, cy - 2, 10, 8);
      ctx.strokeStyle = "#ffd27a";
      ctx.beginPath();
      ctx.arc(cx, cy - 3, 4, Math.PI, 0);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawGoal(time) {
  const goal = G.level.goal;
  const cx = goal.x + goal.w / 2;
  const cy = goal.y + goal.h / 2;
  const active = G.solved;
  const accent = active ? "#ffe08a" : "#6c7d96";
  const pulse = 1 + Math.sin(time * 3.2) * 0.05 + G.portalPulse * 0.12;
  ctx.save();
  ctx.translate(cx, cy);
  if (active) {
    const beam = ctx.createLinearGradient(0, -260, 0, goal.h / 2);
    beam.addColorStop(0, "rgba(255, 224, 138, 0)");
    beam.addColorStop(0.7, "rgba(255, 224, 138, 0.16)");
    beam.addColorStop(1, "rgba(255, 224, 138, 0.02)");
    ctx.fillStyle = beam;
    ctx.fillRect(-22, -260, 44, goal.h / 2 + 260);
  }
  ctx.scale(pulse, pulse);
  ctx.shadowColor = hexAlpha(accent, 0.8);
  ctx.shadowBlur = active ? 34 : 10;
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = active ? 0.75 - i * 0.18 : 0.25;
    ctx.strokeStyle = hexAlpha(accent, 0.95);
    ctx.lineWidth = active ? 3 : 1.6;
    ctx.beginPath();
    ctx.ellipse(0, 0, goal.w / 2 - i * 6, goal.h / 2 - i * 10, 0, time * 0.7 + i, TAU + time * 0.7 + i);
    ctx.stroke();
  }
  ctx.globalAlpha = active ? 0.32 : 0.08;
  const core = ctx.createRadialGradient(0, 0, 0, 0, 0, goal.w * 0.8);
  core.addColorStop(0, active ? "#fff4cf" : "#8ea8c4");
  core.addColorStop(1, "rgba(255, 244, 207, 0)");
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(0, 0, goal.w * 0.8, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  if (!active) {
    ctx.fillStyle = "#cfd8e7";
    ctx.fillRect(-7, -4, 14, 12);
    ctx.strokeStyle = "#cfd8e7";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, -6, 6, Math.PI, 0);
    ctx.stroke();
  }
  ctx.restore();
  if (active) {
    for (let i = 0; i < 3; i += 1) {
      const a = time * 1.3 + i * 2.1;
      const r = goal.w * 0.45;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#ffe9a6";
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 1.2, 1.8, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  for (const part of [...G.particles, ...G.trail]) {
    const alpha = clamp(part.life / (part.max || 1), 0, 1);
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = part.color;
    if (part.gravity) {
      ctx.beginPath();
      ctx.arc(part.x, part.y, part.size, 0, TAU);
      ctx.fill();
    } else {
      ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawPlayer(time) {
  const p = G.player;
  if (!p) return;
  const x = p.x;
  const y = p.y;
  const speed = Math.abs(p.vx);
  const run = Math.min(1, speed / PHYS.move);
  const cycle = Math.sin(time * 12 + p.anim * 3);
  const body = p.squash;
  ctx.save();
  ctx.translate(x, y);
  if (p.facing < 0) ctx.scale(-1, 1);
  ctx.scale(1 / Math.sqrt(body), body);

  if (p.grounded) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    ctx.ellipse(0, 1, 16, 4.5, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.shadowColor = "rgba(110, 236, 255, 0.7)";
  ctx.shadowBlur = 16;
  const legSwing = cycle * 7 * run;
  ctx.strokeStyle = "#d9f4ff";
  ctx.lineWidth = 4.2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-2, -13);
  ctx.lineTo(-4 + legSwing, -1);
  ctx.moveTo(2, -13);
  ctx.lineTo(4 - legSwing, -1);
  ctx.stroke();

  const grad = ctx.createLinearGradient(0, -32, 0, -8);
  grad.addColorStop(0, "#a9f5ff");
  grad.addColorStop(1, "#3c9fc4");
  ctx.fillStyle = grad;
  roundRect(ctx, -8, -31, 16, 21, 7);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = "rgba(255, 190, 120, 0.9)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, -26);
  ctx.quadraticCurveTo(-18 - run * 4, -24 + Math.sin(time * 9) * 2, -25 - run * 6, -18 + Math.cos(time * 8) * 2);
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = "rgba(255, 231, 178, 0.7)";
  ctx.beginPath();
  ctx.moveTo(-6, -24);
  ctx.quadraticCurveTo(-18, -19 + Math.sin(time * 10 + 1) * 3, -23, -13 + Math.cos(time * 9) * 2);
  ctx.stroke();

  ctx.fillStyle = "#f3fbff";
  ctx.beginPath();
  ctx.arc(1, -35, 7.5, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "#173044";
  ctx.beginPath();
  ctx.arc(3.5, -36, 1.7, 0, TAU);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 190, 120, 0.85)";
  ctx.fillRect(-5, -40, 13, 2.5);

  if (!p.grounded && p.vy < -120) {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "#bff8ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -17, 19 + Math.sin(time * 14) * 2, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function levelAccent() {
  return mixHex("#54e8ff", "#ffc371", G.levelIndex / (LEVELS.length - 1));
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const value = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = parseInt(value, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mixHex(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const r = Math.round(lerp(ca.r, cb.r, t));
  const g = Math.round(lerp(ca.g, cb.g, t));
  const bl = Math.round(lerp(ca.b, cb.b, t));
  const toHex = (value) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

function hexAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function modulo(n, m) {
  return ((n % m) + m) % m;
}

function roundRect(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + w, y, x + w, y + h, radius);
  context.arcTo(x + w, y + h, x, y + h, radius);
  context.arcTo(x, y + h, x, y, radius);
  context.arcTo(x, y, x + w, y, radius);
  context.closePath();
}

function render(time) {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawBackground(time);
  if (G.mode !== "menu") drawWorld(time);
  else drawWorld(time * 0.4);
  if (G.flash > 0) {
    ctx.globalAlpha = Math.min(0.4, G.flash * 0.7);
    ctx.fillStyle = "#ff4f61";
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  if (G.mode === "menu") {
    ctx.globalAlpha = 0.38;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "rgba(3, 6, 15, 0.2)");
    grad.addColorStop(1, "rgba(3, 6, 15, 0.7)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

function updateHud(force = false) {
  if (!force && G.levelTime - G.hudAt < 0.07 && G.mode === "playing") return;
  G.hudAt = G.levelTime;
  const level = G.level;
  $("#hud-stage").textContent = `المرحلة ${ar(level.n)} من ${ar(LEVELS.length)}`;
  $("#hud-name").textContent = level.name;
  $("#hud-difficulty").textContent = `${arDifficulty(level.difficulty)} من ١٠`;
  $("#hud-difficulty-fill").style.width = `${clamp(level.difficulty, 0, 10) * 10}%`;
  $("#hud-objective").textContent = level.objective;
  $("#hud-time").textContent = arTime(G.levelTime);
  $("#hud-deaths").textContent = ar(G.levelDeaths);
  const keyWrap = $("#hud-keys");
  if (level.keys.length) {
    keyWrap.classList.remove("hidden");
    $("#hud-key-count").textContent = `${ar(G.collected.size)} / ${ar(G.keyGoal)}`;
  } else {
    keyWrap.classList.add("hidden");
  }
  const freeze = $("#hud-freeze");
  if (G.freezeUntil > G.levelTime) {
    freeze.classList.remove("hidden");
    $("#hud-freeze-time").textContent = ar(Math.ceil(G.freezeUntil - G.levelTime));
  } else {
    freeze.classList.add("hidden");
  }
  const seqLabel = $("#hud-sequence");
  if (level.sequenceHint) {
    seqLabel.classList.remove("hidden");
    $("#hud-sequence-value").textContent = level.sequenceHint;
    seqLabel.classList.toggle("done", G.solved);
  } else {
    seqLabel.classList.add("hidden");
  }
}

function buildLevelGrid() {
  const grid = $("#level-grid");
  if (!grid) return;
  grid.innerHTML = "";
  LEVELS.forEach((level) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "level-card";
    card.innerHTML = `
      <span class="level-num">${ar(level.n)}</span>
      <span class="level-info">
        <strong>${level.name}</strong>
        <small>صعوبة ${arDifficulty(level.difficulty)} من ١٠</small>
      </span>
      <span class="level-arrow">↗</span>
    `;
    card.addEventListener("click", () => {
      hideAllScreens();
      startLevel(level.n - 1);
    });
    grid.appendChild(card);
  });
}

function buildGuide() {
  const guide = $("#guide-list");
  if (!guide) return;
  guide.innerHTML = "";
  LEVELS.forEach((level) => {
    const card = document.createElement("article");
    card.className = "guide-card";
    card.innerHTML = `
      <header class="guide-head">
        <span class="guide-num">${ar(level.n)}</span>
        <div>
          <h3>${level.name}</h3>
          <p>${level.tagline}</p>
        </div>
        <span class="guide-diff">${arDifficulty(level.difficulty)} من ١٠</span>
      </header>
      <p class="guide-objective"><strong>الهدف:</strong> ${level.objective}</p>
      <div class="guide-route"><strong>المسار:</strong> ${level.route}</div>
      <div class="guide-cols">
        <div>
          <h4>ملاحظات البناء</h4>
          <ul>${level.build.map((item) => `<li>${item}</li>`).join("")}</ul>
        </div>
        <div>
          <h4>خطوات اللاعب</h4>
          <ol>${level.steps.map((item) => `<li>${item}</li>`).join("")}</ol>
        </div>
      </div>
      <button type="button" class="ghost-btn guide-play" data-level="${level.n - 1}">ابدأ هذه المرحلة</button>
    `;
    guide.appendChild(card);
  });
  guide.querySelectorAll(".guide-play").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.level);
      hideAllScreens();
      startLevel(index);
    });
  });
}

const screenIds = ["screen-start", "screen-levels", "screen-guide", "screen-pause", "screen-complete", "screen-final"];

function hideAllScreens() {
  screenIds.forEach((id) => $(`#${id}`)?.classList.add("hidden"));
  document.body.classList.remove("overlay-open");
}

function showScreen(id) {
  screenIds.forEach((screen) => $(`#${screen}`)?.classList.toggle("hidden", screen !== id));
  document.body.classList.add("overlay-open");
}

function showStart() {
  G.mode = "menu";
  if (!G.player) loadLevel(0);
  G.mode = "menu";
  hideAllScreens();
  const saved = (() => {
    try {
      return Number(localStorage.getItem("ga.best") || 1);
    } catch {
      return 1;
    }
  })();
  $("#start-progress").textContent = `أفضل تقدم: المرحلة ${ar(saved)}`;
  showScreen("screen-start");
}

function showComplete() {
  const level = G.level;
  $("#complete-stage").textContent = `المرحلة ${ar(level.n)} — ${level.name}`;
  $("#complete-time").textContent = arTime(G.levelTime);
  $("#complete-deaths").textContent = ar(G.levelDeaths);
  $("#complete-keys").textContent = level.keys.length ? `${ar(G.collected.size)} / ${ar(G.keyGoal)}` : "—";
  $("#complete-next-label").textContent = `المرحلة التالية: ${LEVELS[G.levelIndex + 1].name}`;
  showScreen("screen-complete");
}

function showFinal() {
  $("#final-time").textContent = arTime(G.runTime);
  $("#final-deaths").textContent = ar(G.runDeaths);
  const stats = $("#final-stats");
  stats.innerHTML = LEVELS.map(
    (level) => `<div class="final-stage"><span>${ar(level.n)}</span><strong>${level.name}</strong><em>${arDifficulty(level.difficulty)}</em></div>`,
  ).join("");
  showScreen("screen-final");
}

function showPause() {
  const level = G.level;
  $("#pause-title").textContent = `المرحلة ${ar(level.n)} — ${level.name}`;
  $("#pause-objective").textContent = level.objective;
  $("#pause-steps").innerHTML = level.steps.map((step) => `<li>${step}</li>`).join("");
  $("#pause-route").textContent = level.route;
  showScreen("screen-pause");
}

function setupInput() {
  const keyMap = {
    ArrowLeft: "left",
    KeyA: "left",
    ArrowRight: "right",
    KeyD: "right",
  };
  window.addEventListener("keydown", (event) => {
    if (event.repeat) return;
    if (keyMap[event.code]) {
      input[keyMap[event.code]] = true;
      event.preventDefault();
    }
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) {
      input.jumpHeld = true;
      input.jumpBuffer = PHYS.buffer;
      audio.ensure();
      if (!event.repeat) event.preventDefault();
    }
    if (event.code === "KeyP" || event.code === "Escape") {
      if (G.mode === "playing" || G.mode === "paused") {
        event.preventDefault();
        togglePause();
      }
    }
    if (event.code === "KeyR" && G.mode === "playing") {
      event.preventDefault();
      restartLevel();
    }
    if (event.code === "KeyM") {
      toggleMute();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (keyMap[event.code]) input[keyMap[event.code]] = false;
    if (["Space", "ArrowUp", "KeyW"].includes(event.code)) input.jumpHeld = false;
  });

  const bindHold = (selector, onDown, onUp) => {
    const element = $(selector);
    if (!element) return;
    const down = (event) => {
      event.preventDefault();
      element.classList.add("pressed");
      audio.ensure();
      onDown();
    };
    const up = (event) => {
      event.preventDefault();
      element.classList.remove("pressed");
      onUp();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", up);
    element.addEventListener("pointerleave", up);
  };
  bindHold("#btn-left", () => { input.left = true; }, () => { input.left = false; });
  bindHold("#btn-right", () => { input.right = true; }, () => { input.right = false; });
  bindHold("#btn-jump", () => { input.jumpHeld = true; input.jumpBuffer = PHYS.buffer; }, () => { input.jumpHeld = false; });

  canvas.addEventListener("pointerdown", () => audio.ensure());
  window.addEventListener("blur", () => {
    input.left = false;
    input.right = false;
    input.jumpHeld = false;
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
}

function toggleMute() {
  G.muted = !G.muted;
  document.body.classList.toggle("muted", G.muted);
  const button = $("#mute-btn");
  if (button) {
    button.textContent = G.muted ? "🔇" : "♪";
    button.setAttribute("aria-label", G.muted ? "تشغيل الصوت" : "كتم الصوت");
  }
  if (!G.muted) audio.tone(660, 0.1, "sine", 0.04);
}

function wireUi() {
  $("#start-btn")?.addEventListener("click", () => {
    audio.ensure();
    startLevel(0, { runReset: true });
    hideAllScreens();
  });
  $("#levels-btn")?.addEventListener("click", () => showScreen("screen-levels"));
  $("#guide-btn")?.addEventListener("click", () => showScreen("screen-guide"));
  $("#levels-close")?.addEventListener("click", () => showStart());
  $("#guide-close")?.addEventListener("click", () => showStart());
  $("#levels-back")?.addEventListener("click", () => showStart());
  $("#guide-back")?.addEventListener("click", () => showStart());
  $("#pause-btn")?.addEventListener("click", togglePause);
  $("#mute-btn")?.addEventListener("click", toggleMute);
  $("#resume-btn")?.addEventListener("click", togglePause);
  $("#pause-restart")?.addEventListener("click", () => {
    hideAllScreens();
    restartLevel();
  });
  $("#pause-menu")?.addEventListener("click", () => showStart());
  $("#complete-next")?.addEventListener("click", () => {
    hideAllScreens();
    nextLevel();
  });
  $("#complete-retry")?.addEventListener("click", () => {
    hideAllScreens();
    restartLevel();
  });
  $("#complete-menu")?.addEventListener("click", () => showStart());
  $("#final-restart")?.addEventListener("click", () => {
    startLevel(0, { runReset: true });
    hideAllScreens();
  });
  $("#final-menu")?.addEventListener("click", () => showStart());
}

function boot() {
  resize();
  buildLevelGrid();
  buildGuide();
  setupInput();
  wireUi();
  const params = new URLSearchParams(window.location.search);
  const startParam = Number(params.get("level") || 1);
  const index = clamp((Number.isFinite(startParam) ? startParam : 1) - 1, 0, LEVELS.length - 1);
  loadLevel(index);
  G.mode = "menu";
  if (params.get("play") === "1") {
    startLevel(index);
  } else {
    showStart();
  }
  window.addEventListener("resize", resize);
  touchQuery.addEventListener?.("change", resize);
  updateHud(true);
  let last = performance.now();
  let frame = 0;
  function loop(now) {
    const dt = Math.min(0.034, Math.max(0, (now - last) / 1000));
    last = now;
    G.menuTime += dt;
    if (G.mode === "playing") update(dt);
    else if (G.mode === "menu") clampCamera();
    else {
      G.shake = Math.max(0, G.shake - dt * 18);
      G.flash = Math.max(0, G.flash - dt * 2.2);
      updateParticles(dt * 0.35);
    }
    render(now / 1000);
    if (!G.ready) {
      G.ready = true;
      window.__GA_READY = true;
    }
    frame += 1;
    window.__GA_FRAMES = frame;
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

window.__GA = {
  levels: LEVELS,
  state: G,
  load: (index) => {
    hideAllScreens();
    startLevel(index);
  },
  solve: () => {
    solveLevel();
  },
  win: () => {
    G.solved = true;
    completeLevel();
  },
  jump: () => {
    input.jumpBuffer = PHYS.buffer;
    input.jumpHeld = true;
  },
  move: (dir, on = true) => {
    if (dir < 0) input.left = on;
    if (dir > 0) input.right = on;
  },
  teleport: (x, y) => {
    if (G.player) {
      G.player.x = x;
      G.player.y = y;
      G.player.vx = 0;
      G.player.vy = 0;
    }
  },
};

boot();
