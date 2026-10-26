import { CAMERA_HEIGHT, type Framing, GRASS_FAR, HEIGHT_MIN, HEIGHT_RANGE, TERRAIN_FAR, TERRAIN_NEAR, TERRAIN_SLOPE, TERRAIN_WIDTH } from "./layout";
import { lookFrom, multiply, perspective } from "./matrix";

export const MOB_FLOATS = 24;
export const MOB_CONTACTS = 16;
export const MOB_PX = 0.75 / 16;
export const MOB_PART_LIMIT = 160;
export const MOB_CUBE_VERTICES = 36;

type Vec3 = [number, number, number];
type Temper = "villager" | "cow" | "sheep" | "chicken" | "zombie" | "skeleton" | "spider" | "creeper" | "enderman";
type Act = "rest" | "graze" | "peck" | "flap" | "look" | "stare" | "blink" | "freeze";

const STILL = 0;
const HEAD = 1;
const LEG_A = 2;
const LEG_B = 3;
const ARM_A = 4;
const ARM_B = 5;
const SPIDER_LEG = 6;
const WING = 7;

const IDLE = 0;
const WALK = 1;
const FADE_SECONDS = 0.75;
const TURN_RATE = 2.4;
const KEEP_OUT_PAD = 22;
const SCREEN_OVERLAP = 0.45;
const BAND_PX = 60;
const RESPAWN_SECONDS = 0.6;
const NARROW_MIN_SHARE = 0.85;
const NARROW_MAX_SHARE = 0.6;
const NARROW_NEAR = 0.8;
const MEADOW_EDGE = 60;
const SKY_REACH = 0.32;
const MARCH_GROWTH = 1.035;
const MARCH_LIMIT = 15000;
const SEARCH_BUDGET = 48;
const SEARCH_FRAMES = 90;
const TERRAIN_LOG = Math.log(TERRAIN_FAR / TERRAIN_NEAR);

interface Part {
  size: Vec3;
  pivot: Vec3;
  offset: Vec3;
  color: Vec3;
  role: number;
  glow: number;
  side: number;
  leg: number;
}

interface Kind {
  temper: Temper;
  night: boolean;
  parts: Part[];
  scale: number;
  speed: number;
  stride: number;
  swing: number;
  bob: number;
  armBase: number;
  armSwing: number;
  near: number;
  minShare: number;
  maxShare: number;
  height: number;
  reach: number;
}

const linear = (hex: string): Vec3 => {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255].map((c) => c ** 2.2) as Vec3;
};

function box(size: Vec3, pivot: Vec3, offset: Vec3, color: string, role = STILL, glow = 0, leg = 0): Part {
  return { size, pivot, offset, color: linear(color), role, glow, side: pivot[0] < 0 ? -1 : 1, leg };
}

function kind(spec: Omit<Kind, "height" | "reach">): Kind {
  let top = 0;
  let reach = 0;
  for (const part of spec.parts) {
    top = Math.max(top, part.pivot[1] + part.offset[1] + part.size[1] / 2);
    reach = Math.max(reach, Math.abs(part.pivot[0] + part.offset[0]) + part.size[0] / 2, Math.abs(part.pivot[2] + part.offset[2]) + part.size[2] / 2);
  }
  return { ...spec, height: top * MOB_PX * spec.scale, reach: (reach + 3) * MOB_PX * spec.scale };
}

const biped = (legColor: string, legSize: Vec3, legX: number, hip: number) => [
  box(legSize, [legX, hip, 0], [0, -hip / 2, 0], legColor, LEG_A),
  box(legSize, [-legX, hip, 0], [0, -hip / 2, 0], legColor, LEG_B),
];

const quadruped = (color: string, size: Vec3, x: number, hip: number, front: number, back: number, frontOffset = 0) => [
  box(size, [x, hip, front], [0, -hip / 2, frontOffset], color, LEG_A),
  box(size, [-x, hip, front], [0, -hip / 2, frontOffset], color, LEG_B),
  box(size, [x, hip, back], [0, -hip / 2, -frontOffset], color, LEG_B),
  box(size, [-x, hip, back], [0, -hip / 2, -frontOffset], color, LEG_A),
];

const spiderLegs = (color: string) => {
  const legs: Part[] = [];
  const rows = [2.6, 0.9, -0.9, -2.6];
  rows.forEach((z, leg) => {
    for (const side of [1, -1]) legs.push(box([15, 1.8, 1.8], [3 * side, 6, z], [7.5 * side, 0, 0], color, SPIDER_LEG, 0, leg));
  });
  return legs;
};

const VILLAGER = kind({
  temper: "villager",
  night: false,
  scale: 1,
  speed: 0.55,
  stride: 1.2,
  swing: 0.55,
  bob: 0.02,
  armBase: 0,
  armSwing: 0,
  near: 10,
  minShare: 0.03,
  maxShare: 0.2,
  parts: [
    ...biped("#4a3322", [4, 12, 4], 2, 12),
    box([8, 13, 6], [0, 11, 0], [0, 6.5, 0], "#7b5534"),
    box([10, 4, 4.4], [0, 21, 0], [0, -1.5, 4], "#9a6c46"),
    box([8, 10, 8], [0, 24, 0], [0, 5, 0], "#c9987a", HEAD),
    box([2, 4, 2], [0, 24, 0], [0, 2.5, 5], "#a87358", HEAD),
    box([8.2, 1.4, 0.6], [0, 24, 0], [0, 6.6, 4.1], "#3a2a1e", HEAD),
  ],
});

const COW = kind({
  temper: "cow",
  night: false,
  scale: 1,
  speed: 0.3,
  stride: 1.1,
  swing: 0.45,
  bob: 0.015,
  armBase: 0,
  armSwing: 0,
  near: 7,
  minShare: 0.024,
  maxShare: 0.17,
  parts: [
    ...quadruped("#2f2219", [4, 12, 4], 4, 12, 6.5, -6.5),
    box([12, 10, 18], [0, 12, 0], [0, 5, 0], "#3b2a20"),
    box([12.6, 6, 7], [0, 12, 0], [0, 6, 2.5], "#ebe5d8"),
    box([12.6, 5, 4], [0, 12, 0], [0, 3.5, -6.5], "#ebe5d8"),
    box([8, 8, 6], [0, 17, 8.5], [0, 0, 3], "#3b2a20", HEAD),
    box([6, 3.5, 1.5], [0, 17, 8.5], [0, -2, 6.6], "#d8c3b2", HEAD),
    box([11, 1.6, 1.6], [0, 17, 8.5], [0, 4.6, 2], "#e4dcc8", HEAD),
  ],
});

const SHEEP = kind({
  temper: "sheep",
  night: false,
  scale: 1,
  speed: 0.36,
  stride: 1,
  swing: 0.5,
  bob: 0.015,
  armBase: 0,
  armSwing: 0,
  near: 3.2,
  minShare: 0.022,
  maxShare: 0.17,
  parts: [
    ...quadruped("#bba996", [4, 12, 4], 3.5, 12, 6, -6),
    box([13, 12, 19], [0, 11, 0], [0, 6, 0], "#e9e3d3"),
    box([6, 6, 8], [0, 17, 9], [0, 0, 3.5], "#c5ad97", HEAD),
    box([7, 3, 5], [0, 17, 9], [0, 2.8, 2.5], "#e9e3d3", HEAD),
  ],
});

const CHICKEN = kind({
  temper: "chicken",
  night: false,
  scale: 1.3,
  speed: 0.6,
  stride: 0.38,
  swing: 0.9,
  bob: 0.02,
  armBase: 0,
  armSwing: 0,
  near: 2.3,
  minShare: 0.02,
  maxShare: 0.13,
  parts: [
    box([1.5, 5, 1.5], [1.5, 5, 0], [0, -2.5, 0], "#e2a032", LEG_A),
    box([1.5, 5, 1.5], [-1.5, 5, 0], [0, -2.5, 0], "#e2a032", LEG_B),
    box([6, 6, 8], [0, 5, 0], [0, 3, 0], "#f3f0e8"),
    box([1, 4, 6], [3.5, 10, 0], [0, -2, 0], "#e2ddd1", WING),
    box([1, 4, 6], [-3.5, 10, 0], [0, -2, 0], "#e2ddd1", WING),
    box([4, 6, 3], [0, 9, 3], [0, 3, 0.5], "#f3f0e8", HEAD),
    box([4, 2, 2], [0, 9, 3], [0, 4, 3], "#e2a032", HEAD),
    box([2, 2, 1.4], [0, 9, 3], [0, 2, 2.6], "#c63a2c", HEAD),
  ],
});

const ZOMBIE = kind({
  temper: "zombie",
  night: true,
  scale: 1,
  speed: 0.34,
  stride: 1,
  swing: 0.45,
  bob: 0.03,
  armBase: -1.45,
  armSwing: 0.08,
  near: 10,
  minShare: 0.03,
  maxShare: 0.2,
  parts: [
    ...biped("#34477e", [4, 12, 4], 2, 12),
    box([8, 12, 4], [0, 12, 0], [0, 6, 0], "#2b8a8a"),
    box([4, 12, 4], [6, 22, 0], [0, -4, 0], "#5d8a48", ARM_A),
    box([4, 12, 4], [-6, 22, 0], [0, -4, 0], "#5d8a48", ARM_B),
    box([8, 8, 8], [0, 24, 0], [0, 4, 0], "#5d8a48", HEAD),
    box([6, 1.6, 0.6], [0, 24, 0], [0, 4.2, 4.1], "#1d2a1a", HEAD),
  ],
});

const SKELETON = kind({
  temper: "skeleton",
  night: true,
  scale: 1,
  speed: 0.5,
  stride: 1.1,
  swing: 0.36,
  bob: 0.008,
  armBase: -0.12,
  armSwing: 0.22,
  near: 10,
  minShare: 0.03,
  maxShare: 0.2,
  parts: [
    ...biped("#cbc7bd", [2, 12, 2], 2, 12),
    box([8, 12, 3], [0, 12, 0], [0, 6, 0], "#b6b1a6"),
    box([2, 12, 2], [5, 22, 0], [0, -5, 0], "#cbc7bd", ARM_A),
    box([2, 12, 2], [-5, 22, 0], [0, -5, 0], "#cbc7bd", ARM_B),
    box([8, 8, 8], [0, 24, 0], [0, 4, 0], "#d9d5cb", HEAD),
    box([6, 2, 0.6], [0, 24, 0], [0, 4, 4.1], "#2b2723", HEAD),
  ],
});

const SPIDER = kind({
  temper: "spider",
  night: true,
  scale: 1.25,
  speed: 1.3,
  stride: 0.7,
  swing: 0,
  bob: 0.01,
  armBase: 0,
  armSwing: 0,
  near: 2.6,
  minShare: 0.016,
  maxShare: 0.1,
  parts: [
    box([10, 8, 12], [0, 6, 0], [0, 1.5, -7], "#2c2421"),
    box([6, 6, 6], [0, 6, 0], [0, 0, 0], "#2c2421"),
    box([8, 7, 7], [0, 6, 3], [0, 0.5, 3.5], "#372d29", HEAD),
    box([6, 2, 0.6], [0, 6, 3], [0, 1.5, 7.1], "#d4291f", HEAD, 0.9),
    ...spiderLegs("#2c2421"),
  ],
});

const CREEPER = kind({
  temper: "creeper",
  night: true,
  scale: 1,
  speed: 0.26,
  stride: 0.6,
  swing: 0.5,
  bob: 0.01,
  armBase: 0,
  armSwing: 0,
  near: 5,
  minShare: 0.026,
  maxShare: 0.16,
  parts: [
    ...quadruped("#3f8a35", [4, 6, 4], 2, 6, 2, -2, 2),
    box([8, 12, 4], [0, 6, 0], [0, 6, 0], "#4f9c40"),
    box([8, 8, 8], [0, 18, 0], [0, 4, 0], "#5aa84a", HEAD),
    box([2.2, 2.2, 0.6], [0, 18, 0], [2, 5, 4.1], "#13200f", HEAD),
    box([2.2, 2.2, 0.6], [0, 18, 0], [-2, 5, 4.1], "#13200f", HEAD),
    box([2, 1.8, 0.6], [0, 18, 0], [0, 3.1, 4.1], "#13200f", HEAD),
    box([4, 2.4, 0.6], [0, 18, 0], [0, 1.2, 4.1], "#13200f", HEAD),
  ],
});

const ENDERMAN = kind({
  temper: "enderman",
  night: true,
  scale: 1,
  speed: 0.36,
  stride: 1.8,
  swing: 0.3,
  bob: 0.02,
  armBase: 0,
  armSwing: 0.2,
  near: 14,
  minShare: 0.045,
  maxShare: 0.26,
  parts: [
    ...biped("#16131b", [2, 30, 2], 2, 30),
    box([8, 12, 4], [0, 30, 0], [0, 6, 0], "#1c1822"),
    box([2, 30, 2], [5, 41, 0], [0, -14, 0], "#16131b", ARM_A),
    box([2, 30, 2], [-5, 41, 0], [0, -14, 0], "#16131b", ARM_B),
    box([8, 8, 8], [0, 42, 0], [0, 4, 0], "#1f1b25", HEAD),
    box([6.4, 1.3, 0.6], [0, 42, 0], [0, 3.4, 4.1], "#d68af5", HEAD, 1),
  ],
});

const ROSTER: [Kind, boolean][] = [
  [COW, true],
  [VILLAGER, true],
  [SHEEP, true],
  [SHEEP, true],
  [CHICKEN, true],
  [SHEEP, false],
  [COW, false],
  [VILLAGER, false],
  [CHICKEN, false],
  [ZOMBIE, true],
  [CREEPER, true],
  [ENDERMAN, true],
  [SKELETON, true],
  [SPIDER, true],
  [ZOMBIE, false],
  [SKELETON, false],
];

export const MOB_KINDS: readonly Temper[] = ROSTER.map(([kind]) => kind.temper);

export const MOB_CUBE = (() => {
  const faces: [Vec3, Vec3, Vec3][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const corners = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
  ];
  const vertices = new Float32Array(MOB_CUBE_VERTICES * 6);
  let cursor = 0;
  for (const [normal, u, v] of faces) {
    for (const [a, b] of corners) {
      for (let axis = 0; axis < 3; axis++) vertices[cursor + axis] = (normal[axis] + a * u[axis] + b * v[axis]) * 0.5;
      for (let axis = 0; axis < 3; axis++) vertices[cursor + 3 + axis] = normal[axis];
      cursor += 6;
    }
  }
  return vertices;
})();

const fract = (value: number) => value - Math.floor(value);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smooth = (edge0: number, edge1: number, x: number) => {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const turnToward = (from: number, to: number, limit: number) => from + Math.max(-limit, Math.min(limit, angleDelta(from, to)));

function hash12(x: number, y: number) {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

function valueNoise(x: number, y: number) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const fx = x - cx;
  const fy = y - cy;
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = hash12(cx, cy);
  const b = hash12(cx + 1, cy);
  const c = hash12(cx, cy + 1);
  const d = hash12(cx + 1, cy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

function meadowHeight(x: number, z: number) {
  const near = 0.16 * valueNoise(x * 0.09, z * 0.09) + 0.07 * valueNoise(x * 0.33 + 7, z * 0.33 + 7);
  const far = smooth(30, 360, z);
  return near + far * (6 + 8 * valueNoise(x * 0.004 + 3, z * 0.004 + 3) + 2.5 * valueNoise(x * 0.018 + 1.3, z * 0.018 + 1.3));
}

class Mob {
  x = 0;
  z = 0;
  yaw = Math.PI;
  faceTo = NaN;
  tx = 0;
  tz = 0;
  mode = IDLE;
  timer = 0;
  phase = 0;
  gait = 0;
  pace = 1;
  head = 0;
  headTo = 0;
  headYaw = 0;
  headYawTo = 0;
  glance = 0;
  act: Act = "rest";
  actTime = 0;
  presence = 0;
  blink = 1;
  jumped = false;
  swell = 0;
  flap = 0;
  lift = 0;
  hold = 0;
  zig = 1;
  zigTimer = 0;
  lurch = 0;
  placed = false;
  leaving = false;
  delay: number;
  readonly threshold: number;
  readonly speedScale: number;
  readonly pauseScale: number;
  readonly gaitScale: number;
  readonly strideScale: number;
  readonly quirk: number;
  readonly band: number;
  private seed: number;

  constructor(
    readonly kind: Kind,
    readonly narrow: boolean,
    seed: number,
    order: number,
    reduced: boolean,
  ) {
    this.seed = seed >>> 0;
    this.speedScale = this.between(0.78, 1.25);
    this.pauseScale = this.between(0.7, 1.45);
    this.gaitScale = this.between(0.82, 1.18);
    this.strideScale = this.between(0.88, 1.12);
    this.quirk = this.random();
    this.band = (order * 0.618 + this.random() * 0.12) % 1;
    this.lurch = this.between(0, Math.PI * 2);
    const spread = (order * 0.37 + this.quirk * 0.2) % 1;
    this.threshold = kind.night ? 0.42 + spread * 0.42 : 0.05 + spread * 0.22;
    this.delay = reduced ? 0 : 0.2 + order * 0.25 + this.random() * 0.4;
  }

  random() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  between(low: number, high: number) {
    return low + this.random() * (high - low);
  }

  chance(odds: number) {
    return this.random() < odds;
  }
}

export interface KeepOut {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Footprint {
  kind: Temper;
  x: number;
  y: number;
  top: number;
}

export class Mobs {
  readonly data = new Float32Array(MOB_PART_LIMIT * MOB_FLOATS);
  readonly contacts = new Float32Array(MOB_CONTACTS * 4);
  readonly shadow = new Float32Array(2);
  contactCount = 0;
  private readonly mobs: Mob[];
  private readonly restProjection = new Float32Array(16);
  private readonly restView = new Float32Array(16);
  private readonly restViewProj = new Float32Array(16);
  private readonly rect: KeepOut = { left: 0, top: 0, right: 0, bottom: 0 };
  private keepOut: KeepOut[] = [];
  private column: KeepOut | null = null;
  private terrain: Uint8Array | null = null;
  private terrainWidth = 1;
  private terrainHeight = 1;
  private hillScale = 1;
  private width = 1;
  private height = 1;
  private tanHalfTall = 1;
  private tanHalfWide = 1;
  private pitchSin = 0;
  private pitchCos = 1;
  private horizonY = 0;
  private narrow = false;
  private stale = true;
  private laidOut = false;
  private budget = SEARCH_BUDGET;
  private unsettled = 0;
  private searchFrames = 0;
  private time = 0;
  private sx = 0;
  private sy = 0;
  private gx = 0;
  private gz = 0;

  constructor(private readonly reduced: boolean) {
    let day = 0;
    let night = 0;
    this.mobs = ROSTER.map(([kind, narrow], index) => {
      const order = kind.night ? night++ : day++;
      return new Mob(kind, narrow, 0x9e3779b9 ^ Math.imul(index + 1, 2654435761), order, reduced);
    });
  }

  layout(framing: Framing, aspect: number, width: number, height: number) {
    perspective(framing.verticalFov, aspect, 0.2, 40000, this.restProjection);
    lookFrom([0, CAMERA_HEIGHT, 0], framing.yaw, framing.pitch, this.restView);
    multiply(this.restProjection, this.restView, this.restViewProj);
    this.width = width;
    this.height = height;
    this.tanHalfTall = Math.tan(framing.verticalFov / 2);
    this.tanHalfWide = this.tanHalfTall * aspect;
    this.pitchSin = Math.sin(framing.pitch);
    this.pitchCos = Math.cos(framing.pitch);
    this.horizonY = (0.5 + (Math.tan(framing.pitch) / this.tanHalfTall) * 0.5) * height;
    this.hillScale = framing.hillScale;
    this.narrow = width < 700;
    this.stale = true;
    this.laidOut = true;
  }

  get searching() {
    return this.unsettled > 0 && this.searchFrames < SEARCH_FRAMES;
  }

  setKeepOut(boxes: KeepOut[], column: KeepOut | null) {
    this.keepOut = boxes;
    this.column = column;
    this.stale = true;
  }

  setTerrain(pixels: Uint8Array, width: number, height: number) {
    this.terrain = pixels;
    this.terrainWidth = width;
    this.terrainHeight = height;
    this.stale = true;
  }

  footprints(): Footprint[] {
    const list: Footprint[] = [];
    for (const mob of this.mobs) {
      if (!mob.placed || mob.presence * mob.blink < 0.5 || !this.frame(mob.kind, mob.x, mob.z)) continue;
      list.push({ kind: mob.kind.temper, x: (this.rect.left + this.rect.right) / 2, y: this.rect.bottom, top: this.rect.top });
    }
    return list;
  }

  step(dt: number, night: number) {
    if (!this.laidOut) return;
    this.time += dt;
    this.budget = SEARCH_BUDGET;
    this.unsettled = 0;
    if (this.stale) {
      this.searchFrames = 0;
      this.revalidate();
    }
    for (const mob of this.mobs) {
      mob.delay = Math.max(0, mob.delay - dt);
      const target = this.presenceFor(mob, night);
      if (mob.presence === 0) {
        if (target === 0) continue;
        if ((!this.reduced || !mob.placed) && !this.spawn(mob)) {
          if (!this.reduced) mob.delay = RESPAWN_SECONDS;
          this.unsettled++;
          continue;
        }
      }
      if (this.reduced) mob.presence = target;
      else {
        mob.presence += (target - mob.presence) * (1 - Math.exp(-dt / FADE_SECONDS));
        if (Math.abs(target - mob.presence) < 0.004) mob.presence = target;
      }
      if (this.reduced) continue;
      if (!mob.kind.night && target < mob.presence - 0.05 && !mob.leaving) {
        mob.leaving = true;
        if (this.aim(mob, 0.12, 0.3, -1)) this.walk(mob, 1.2);
      }
      this.behave(mob, dt);
    }
    this.searchFrames = this.unsettled > 0 ? this.searchFrames + 1 : 0;
  }

  fill(keyDir: ArrayLike<number>, keyStrength: number) {
    const { data, contacts } = this;
    let cursor = 0;
    let contactCount = 0;
    for (let index = 0; index < this.mobs.length; index++) {
      const mob = this.mobs[index];
      const fade = mob.presence * mob.blink;
      if (!mob.placed || fade <= 0.002) continue;
      const kind = mob.kind;
      if (cursor + kind.parts.length > MOB_PART_LIMIT) break;
      const size = this.sizeAt(kind, mob.z);
      const scale = kind.scale * size * (1 + 0.07 * mob.swell);
      const swing = Math.sin(mob.phase) * mob.gait * kind.swing * mob.gaitScale;
      const drag = kind.temper === "zombie" ? 0.55 : 1;
      const rise = kind.night ? -(1 - mob.presence) * kind.height * size * 0.45 : 0;
      const lift = (mob.lift + Math.abs(Math.cos(mob.phase)) * mob.gait * kind.bob) * size + rise;
      const chew = mob.act === "graze" ? Math.sin(this.time * (6 + mob.quirk * 3) + index) * 0.05 * smooth(0.4, 0.8, mob.head) : 0;
      const head = mob.head + chew;
      const sway = kind.temper === "zombie" ? Math.sin(this.time * (1.4 + mob.quirk) + index) * 0.08 : 0;
      const armA = kind.armBase - swing * kind.armSwing + sway;
      const armB = kind.armBase + swing * kind.armSwing - sway;
      const flash = mob.swell * 0.3;
      for (let p = 0; p < kind.parts.length; p++) {
        const part = kind.parts[p];
        let yaw = 0;
        let pitch = 0;
        let roll = 0;
        if (part.role === HEAD) {
          pitch = head;
          yaw = mob.headYaw;
        } else if (part.role === LEG_A) pitch = swing;
        else if (part.role === LEG_B) pitch = -swing * drag;
        else if (part.role === ARM_A) pitch = armA;
        else if (part.role === ARM_B) pitch = armB;
        else if (part.role === WING) roll = part.side * mob.flap;
        else if (part.role === SPIDER_LEG) {
          const stride = mob.phase + part.leg * Math.PI * 0.5 + (part.side > 0 ? 0 : Math.PI);
          yaw = -part.side * (0.65 - part.leg * 0.43 + Math.sin(stride) * 0.28 * mob.gait);
          roll = -part.side * (0.42 - Math.max(0, Math.cos(stride)) * 0.3 * mob.gait);
        }
        const o = cursor * MOB_FLOATS;
        data[o] = mob.x;
        data[o + 1] = mob.z;
        data[o + 2] = mob.yaw;
        data[o + 3] = lift;
        data[o + 4] = part.pivot[0] * scale;
        data[o + 5] = part.pivot[1] * scale;
        data[o + 6] = part.pivot[2] * scale;
        data[o + 7] = yaw;
        data[o + 8] = part.offset[0] * scale;
        data[o + 9] = part.offset[1] * scale;
        data[o + 10] = part.offset[2] * scale;
        data[o + 11] = pitch;
        data[o + 12] = part.size[0] * scale;
        data[o + 13] = part.size[1] * scale;
        data[o + 14] = part.size[2] * scale;
        data[o + 15] = roll;
        data[o + 16] = part.color[0];
        data[o + 17] = part.color[1];
        data[o + 18] = part.color[2];
        data[o + 19] = fade;
        data[o + 20] = part.glow;
        data[o + 21] = index * 7.13 + p * 1.37;
        data[o + 22] = flash;
        data[o + 23] = 0;
        cursor++;
      }
      const reach = Math.max(kind.reach * size * 1.6, 0.75);
      if (contactCount < MOB_CONTACTS && mob.z - reach < GRASS_FAR) {
        const c = contactCount * 4;
        contacts[c] = mob.x;
        contacts[c + 1] = mob.z;
        contacts[c + 2] = reach;
        contacts[c + 3] = fade;
        contactCount++;
      }
    }
    const flat = Math.hypot(keyDir[0], keyDir[2]) || 1;
    const reach = 0.45 * Math.min(1, keyStrength);
    this.shadow[0] = (-keyDir[0] / flat) * reach;
    this.shadow[1] = (-keyDir[2] / flat) * reach;
    this.contactCount = contactCount;
    return cursor;
  }

  private cast(night: boolean) {
    let count = 0;
    for (const mob of this.mobs) if (mob.kind.night === night && (mob.narrow || !this.narrow)) count++;
    return count;
  }

  private sizeAt(kind: Kind, z: number) {
    const natural = kind.height / (2 * this.tanHalfTall * Math.max(z, 0.1));
    const low = kind.minShare * (this.narrow ? NARROW_MIN_SHARE : 1);
    const high = kind.maxShare * (this.narrow ? NARROW_MAX_SHARE : 1);
    return natural < low ? low / natural : natural > high ? high / natural : 1;
  }

  private presenceFor(mob: Mob, night: number) {
    if (mob.delay > 0 || (this.narrow && !mob.narrow)) return 0;
    const t = mob.threshold;
    return mob.kind.night ? smooth(t - 0.08, t + 0.08, night) : 1 - smooth(t - 0.05, t + 0.05, night);
  }

  private revalidate() {
    this.stale = false;
    for (const mob of this.mobs) {
      if (!mob.placed || this.valid(mob.kind, mob.x, mob.z, mob, false)) continue;
      if (!this.spawn(mob)) {
        mob.placed = false;
        mob.presence = 0;
      }
    }
  }

  private ground(x: number, z: number) {
    const meadow = meadowHeight(x, z);
    if (z < MEADOW_EDGE || !this.terrain) return meadow;
    return meadow + (this.baked(x, z) - meadow) * this.hillScale;
  }

  private baked(x: number, z: number) {
    const pixels = this.terrain!;
    const columns = this.terrainWidth;
    const rows = this.terrainHeight;
    const u = (x / (TERRAIN_WIDTH + z * TERRAIN_SLOPE)) * 0.5 + 0.5;
    const v = Math.log(Math.max(z, TERRAIN_NEAR) / TERRAIN_NEAR) / TERRAIN_LOG;
    if (u < 0 || u > 1 || v > 1) return HEIGHT_MIN;
    const s = u * columns - 0.5;
    const t = v * rows - 0.5;
    const c0 = Math.max(0, Math.min(columns - 1, Math.floor(s)));
    const r0 = Math.max(0, Math.min(rows - 1, Math.floor(t)));
    const c1 = Math.min(columns - 1, c0 + 1);
    const r1 = Math.min(rows - 1, r0 + 1);
    const fs = clamp01(s - c0);
    const ft = clamp01(t - r0);
    const at = (c: number, r: number) => {
      const i = (r * columns + c) * 4;
      return ((pixels[i] * 256 + pixels[i + 1]) / 65535) * HEIGHT_RANGE + HEIGHT_MIN;
    };
    const a = at(c0, r0);
    const b = at(c1, r0);
    const c = at(c0, r1);
    const d = at(c1, r1);
    return a + (b - a) * fs + (c - a) * ft + (a - b - c + d) * fs * ft;
  }

  private spawn(mob: Mob) {
    const top = this.horizonY - this.height * SKY_REACH;
    const bottom = this.height * 0.985;
    for (let attempt = 0; attempt < 40; attempt++) {
      if (this.budget <= 0) return false;
      const jitter = (mob.random() - 0.5) * (0.22 + attempt * 0.03);
      const sy = top + (bottom - top) * clamp01(mob.band + jitter);
      const sx = mob.random() * this.width;
      if (!this.unproject(sx, sy)) continue;
      const x = this.gx;
      const z = this.gz;
      if (!this.valid(mob.kind, x, z, mob, true)) continue;
      this.settle(mob, x, z);
      return true;
    }
    return false;
  }

  private settle(mob: Mob, x: number, z: number) {
    const kind = mob.kind;
    mob.x = x;
    mob.z = z;
    mob.yaw = (mob.chance(0.5) ? -1 : 1) * Math.PI * 0.5 + mob.between(-0.8, 0.8);
    mob.placed = true;
    mob.leaving = false;
    mob.blink = 1;
    mob.swell = 0;
    mob.flap = 0;
    mob.lift = 0;
    mob.gait = 0;
    mob.hold = 0;
    mob.phase = mob.between(0, Math.PI * 2);
    this.rest(mob);
    mob.timer = mob.between(0.3, 2.5);
    if (this.reduced) {
      const grazer = kind.temper === "cow" || kind.temper === "sheep";
      mob.head = grazer && mob.chance(0.6) ? 0.9 : mob.between(-0.12, 0.1);
      mob.headYaw = mob.between(-0.4, 0.4);
      mob.act = mob.head > 0.5 ? "graze" : "rest";
    }
  }

  private valid(kind: Kind, x: number, z: number, self: Mob, crowd: boolean) {
    if (z < kind.near * (this.narrow ? NARROW_NEAR : 1) || z > MARCH_LIMIT * 0.8) return false;
    if (!this.frame(kind, x, z)) return false;
    const { left, right, top, bottom } = this.rect;
    if (left < this.width * 0.015 || right > this.width * 0.985 || bottom > this.height * 0.96 || top < this.height * 0.02) return false;
    for (const area of this.keepOut) {
      if (right > area.left - KEEP_OUT_PAD && left < area.right + KEEP_OUT_PAD && bottom > area.top - KEEP_OUT_PAD && top < area.bottom + KEEP_OUT_PAD) return false;
    }
    const column = this.narrow ? null : this.column;
    if (column && left < column.right + KEEP_OUT_PAD && bottom > column.top) return false;
    if (z > MEADOW_EDGE && !this.visible(x, z, (left + right) / 2, bottom)) return false;
    if (!crowd) return true;
    const size = this.sizeAt(kind, z);
    let sharing = 0;
    for (const other of this.mobs) {
      if (other === self || !other.placed || other.presence === 0) continue;
      if (this.frame(other.kind, other.x, other.z) && Math.abs(this.rect.bottom - bottom) <= BAND_PX) sharing++;
      else if (other.mode === WALK && this.frame(other.kind, other.tx, other.tz) && Math.abs(this.rect.bottom - bottom) <= BAND_PX) sharing++;
    }
    if (sharing + 1 > Math.floor(this.cast(kind.night) / 2)) return false;
    for (const other of this.mobs) {
      if (other === self || !other.placed || other.presence === 0) continue;
      const gap = kind.reach * size + other.kind.reach * this.sizeAt(other.kind, other.z) + 0.4;
      if (Math.hypot(x - other.x, z - other.z) < gap) return false;
      if (other.mode === WALK && Math.hypot(x - other.tx, z - other.tz) < gap) return false;
      if (this.crowds(other, left, right, top, bottom)) return false;
    }
    return true;
  }

  private visible(x: number, z: number, sx: number, sy: number) {
    if (!this.unproject(sx, sy - 1)) return false;
    return Math.abs(this.gz - z) < z * 0.06 + 1 && Math.abs(this.gx - x) < z * 0.06 + 1;
  }

  private clearPath(mob: Mob, x: number, z: number) {
    for (let i = 1; i <= 3; i++) {
      const t = i / 4;
      if (!this.valid(mob.kind, mob.x + (x - mob.x) * t, mob.z + (z - mob.z) * t, mob, false)) return false;
    }
    return true;
  }

  private frame(kind: Kind, x: number, z: number) {
    const ground = this.ground(x, z);
    const size = this.sizeAt(kind, z);
    const reach = kind.reach * size;
    if (!this.toScreen(x - reach, ground, z)) return false;
    this.rect.left = this.sx;
    this.rect.bottom = this.sy;
    if (!this.toScreen(x + reach, ground + kind.height * size, z)) return false;
    this.rect.right = this.sx;
    this.rect.top = this.sy;
    return true;
  }

  private crowds(other: Mob, left: number, right: number, top: number, bottom: number) {
    if (!this.frame(other.kind, other.x, other.z)) return false;
    const across = Math.min(right, this.rect.right) - Math.max(left, this.rect.left);
    const down = Math.min(bottom, this.rect.bottom) - Math.max(top, this.rect.top);
    const narrowest = Math.min(right - left, this.rect.right - this.rect.left);
    const shortest = Math.min(bottom - top, this.rect.bottom - this.rect.top);
    return across > SCREEN_OVERLAP * narrowest && down > SCREEN_OVERLAP * shortest;
  }

  private toScreen(x: number, y: number, z: number) {
    const m = this.restViewProj;
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w <= 0) return false;
    this.sx = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5) * this.width;
    this.sy = (0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5) * this.height;
    return true;
  }

  private unproject(sx: number, sy: number) {
    this.budget--;
    const ndcX = (sx / this.width) * 2 - 1;
    const ndcY = 1 - (sy / this.height) * 2;
    const up = ndcY * this.tanHalfTall;
    const dirX = ndcX * this.tanHalfWide;
    const dirY = up * this.pitchCos + this.pitchSin;
    const dirZ = this.pitchCos - up * this.pitchSin;
    if (dirZ <= 0) return false;
    let before = 0.3;
    let t = before;
    while (t < MARCH_LIMIT) {
      t = t * MARCH_GROWTH + 0.04;
      const z = dirZ * t;
      if (CAMERA_HEIGHT + dirY * t <= this.ground(dirX * t, z)) {
        let low = before;
        let high = t;
        for (let i = 0; i < 10; i++) {
          const mid = (low + high) / 2;
          if (CAMERA_HEIGHT + dirY * mid <= this.ground(dirX * mid, dirZ * mid)) high = mid;
          else low = mid;
        }
        this.gx = dirX * high;
        this.gz = dirZ * high;
        return true;
      }
      if (!this.terrain && dirY >= 0) return false;
      before = t;
    }
    return false;
  }

  private aim(mob: Mob, near: number, far: number, depthBias = 0) {
    if (!this.frame(mob.kind, mob.x, mob.z)) return false;
    const cx = (this.rect.left + this.rect.right) / 2;
    const cy = this.rect.bottom;
    for (let attempt = 0; attempt < 18; attempt++) {
      if (this.budget <= 0) return false;
      const angle = mob.between(0, Math.PI * 2);
      const distance = mob.between(near, far) * this.width;
      const sx = cx + Math.cos(angle) * distance;
      let sy = cy + Math.sin(angle) * distance * 0.75;
      if (depthBias !== 0 && Math.sign(sy - cy) !== Math.sign(depthBias)) sy = cy - (sy - cy);
      if (!this.unproject(sx, sy)) continue;
      const tx = this.gx;
      const tz = this.gz;
      if (!this.valid(mob.kind, tx, tz, mob, true) || !this.clearPath(mob, tx, tz)) continue;
      mob.tx = tx;
      mob.tz = tz;
      return true;
    }
    return false;
  }

  private flock(mob: Mob) {
    let x = 0;
    let z = 0;
    let count = 0;
    for (const other of this.mobs) {
      if (other === mob || other.kind !== mob.kind || !other.placed || other.presence === 0) continue;
      x += other.x;
      z += other.z;
      count++;
    }
    if (count === 0) return false;
    x /= count;
    z /= count;
    const spread = Math.max(1.4, z * 0.09);
    for (let attempt = 0; attempt < 14; attempt++) {
      const angle = mob.between(0, Math.PI * 2);
      const distance = spread * mob.between(0.6, 1.6);
      const tx = x + Math.sin(angle) * distance;
      const tz = z + Math.cos(angle) * distance;
      if (!this.valid(mob.kind, tx, tz, mob, true) || !this.clearPath(mob, tx, tz)) continue;
      mob.tx = tx;
      mob.tz = tz;
      return true;
    }
    return false;
  }

  private walk(mob: Mob, pace = 1) {
    mob.mode = WALK;
    mob.act = "rest";
    mob.pace = pace;
    mob.headTo = mob.kind.temper === "zombie" ? 0.12 : 0;
    mob.headYawTo = 0;
    mob.faceTo = NaN;
    mob.swell = 0;
    mob.hold = 0;
    mob.zigTimer = 0;
  }

  private rest(mob: Mob) {
    mob.mode = IDLE;
    mob.actTime = 0;
    mob.jumped = false;
    mob.act = "rest";
    mob.headTo = mob.between(-0.15, 0.1);
    mob.headYawTo = 0;
    mob.faceTo = NaN;
    mob.glance = 0;
    let seconds = mob.between(1.5, 3.5);
    switch (mob.kind.temper) {
      case "villager":
        mob.act = "look";
        seconds = mob.between(2.2, 5);
        if (mob.chance(0.4)) mob.faceTo = Math.atan2(-mob.x, -mob.z) + mob.between(-0.5, 0.5);
        break;
      case "cow":
        if (mob.chance(0.82)) {
          mob.act = "graze";
          mob.headTo = mob.between(0.9, 1.1);
          seconds = mob.between(7, 15);
        } else seconds = mob.between(2, 4);
        break;
      case "sheep":
        if (mob.chance(0.7)) {
          mob.act = "graze";
          mob.headTo = mob.between(0.95, 1.15);
          seconds = mob.between(3, 8);
        } else {
          mob.act = "look";
          seconds = mob.between(1.5, 3);
        }
        break;
      case "chicken": {
        const roll = mob.random();
        if (roll < 0.45) {
          mob.act = "peck";
          seconds = mob.between(0.9, 2.4);
        } else if (roll < 0.75) {
          mob.act = "flap";
          seconds = mob.between(0.7, 1.1);
        } else {
          mob.act = "look";
          seconds = mob.between(0.5, 1.4);
        }
        break;
      }
      case "zombie":
        seconds = mob.between(1.5, 4);
        mob.headTo = mob.between(0.1, 0.3);
        break;
      case "skeleton":
        mob.act = "look";
        seconds = mob.between(1.4, 2.8);
        break;
      case "spider":
        mob.act = "freeze";
        seconds = mob.between(0.9, 3.6);
        mob.gait = 0;
        break;
      case "enderman":
        seconds = mob.between(6, 14);
        mob.headTo = mob.between(-0.05, 0.2);
        if (mob.chance(0.5)) mob.faceTo = Math.atan2(-mob.x, -mob.z) + mob.between(-0.3, 0.3);
        break;
      case "creeper":
        if (mob.chance(0.45)) {
          mob.act = "stare";
          seconds = 3.6;
          mob.faceTo = Math.atan2(-mob.x, -mob.z);
        } else seconds = mob.between(1.2, 3);
        break;
    }
    mob.timer = seconds * mob.pauseScale;
  }

  private plan(mob: Mob) {
    let moved = false;
    switch (mob.kind.temper) {
      case "villager":
        moved = mob.chance(0.8) && this.aim(mob, 0.2, 0.48);
        if (moved) this.walk(mob);
        break;
      case "cow":
        moved = mob.chance(0.4) && this.aim(mob, 0.05, 0.16);
        if (moved) this.walk(mob, 0.8);
        break;
      case "sheep":
        moved = mob.chance(0.6) && (this.flock(mob) || this.aim(mob, 0.08, 0.22));
        if (moved) this.walk(mob, 0.9);
        break;
      case "chicken":
        moved = mob.chance(0.55) && this.aim(mob, 0.04, 0.14);
        if (moved) this.walk(mob, 1.8);
        break;
      case "zombie":
        moved = mob.chance(0.75) && this.aim(mob, 0.12, 0.32);
        if (moved) this.walk(mob);
        break;
      case "skeleton":
        moved = mob.chance(0.78) && this.aim(mob, 0.15, 0.38);
        if (moved) this.walk(mob);
        break;
      case "spider":
        moved = mob.chance(0.8) && this.aim(mob, 0.12, 0.36);
        if (moved) this.walk(mob);
        break;
      case "enderman":
        if (mob.chance(0.4)) {
          mob.act = "blink";
          mob.actTime = 0;
          mob.jumped = false;
          mob.timer = 1;
          return;
        }
        moved = mob.chance(0.4) && this.aim(mob, 0.05, 0.14);
        if (moved) this.walk(mob, 0.7);
        break;
      case "creeper":
        moved = mob.chance(0.75) && this.aim(mob, 0.06, 0.2, 1);
        if (moved) this.walk(mob);
        break;
    }
    if (!moved) this.rest(mob);
  }

  private behave(mob: Mob, dt: number) {
    const kind = mob.kind;
    let moving = false;
    if (mob.mode === WALK) moving = this.travel(mob, dt);
    else {
      mob.timer -= dt;
      mob.actTime += dt;
      this.perform(mob, dt);
      if (mob.timer <= 0) {
        if (mob.leaving || mob.act === "blink") this.rest(mob);
        else this.plan(mob);
      }
    }
    const settle = kind.temper === "spider" && !moving ? 30 : kind.temper === "skeleton" ? 10 : 7;
    mob.gait += ((moving ? 1 : 0) - mob.gait) * (1 - Math.exp(-dt * settle));
    mob.head += (mob.headTo - mob.head) * (1 - Math.exp(-dt * (mob.act === "peck" ? 16 : 3.5)));
    const glanceRate = kind.temper === "skeleton" ? 14 : 3;
    mob.headYaw += (mob.headYawTo - mob.headYaw) * (1 - Math.exp(-dt * glanceRate));
  }

  private travel(mob: Mob, dt: number) {
    const kind = mob.kind;
    if (mob.hold > 0) {
      mob.hold -= dt;
      if (!Number.isNaN(mob.faceTo)) mob.yaw = turnToward(mob.yaw, mob.faceTo, TURN_RATE * 0.5 * dt);
      if (mob.hold <= 0) mob.faceTo = NaN;
      return false;
    }
    const dx = mob.tx - mob.x;
    const dz = mob.tz - mob.z;
    const distance = Math.hypot(dx, dz);
    const depthPace = Math.max(1, mob.z / 22);
    if (distance < 0.07 * depthPace) {
      this.rest(mob);
      return false;
    }
    let heading = Math.atan2(dx, dz);
    let turnRate = TURN_RATE;
    let pace = kind.speed * mob.speedScale * mob.pace * depthPace;
    if (kind.temper === "spider") {
      mob.zigTimer -= dt;
      if (mob.zigTimer <= 0) {
        mob.zig = -mob.zig;
        mob.zigTimer = mob.between(0.22, 0.55);
      }
      heading += mob.zig * 0.65 * Math.min(1, distance / (1.5 * depthPace));
      turnRate = 7;
    } else if (kind.temper === "zombie") {
      mob.lurch += dt * (2 + mob.quirk * 1.2);
      pace *= 0.25 + 0.95 * Math.max(0, Math.sin(mob.lurch)) ** 0.7;
      heading += Math.sin(mob.lurch * 0.37 + mob.quirk * 6) * 0.25;
    } else if (kind.temper === "creeper") {
      if (mob.chance(dt * 0.3)) {
        mob.hold = mob.between(0.6, 1.6);
        mob.faceTo = Math.atan2(-mob.x, -mob.z);
      }
    } else if (kind.temper === "chicken") {
      mob.flap = mob.quirk > 0.4 ? 0.35 * Math.abs(Math.sin(this.time * 22 + mob.quirk * 9)) : 0;
    }
    const error = angleDelta(mob.yaw, heading);
    mob.yaw = turnToward(mob.yaw, heading, turnRate * dt);
    const step = Math.min(distance, pace * Math.max(0, 1 - Math.abs(error) / 1.1) * dt);
    mob.x += Math.sin(mob.yaw) * step;
    mob.z += Math.cos(mob.yaw) * step;
    mob.phase += (step / (kind.stride * mob.strideScale * depthPace)) * Math.PI * 2;
    return step > 0;
  }

  private perform(mob: Mob, dt: number) {
    if (!Number.isNaN(mob.faceTo)) mob.yaw = turnToward(mob.yaw, mob.faceTo, TURN_RATE * 0.6 * dt);
    const t = mob.actTime;
    mob.lift = 0;
    mob.flap = 0;
    mob.swell = 0;
    mob.blink = 1;
    if (mob.act === "look") {
      mob.glance -= dt;
      if (mob.glance <= 0) {
        const span = mob.kind.temper === "villager" ? 0.8 : 0.55;
        mob.headYawTo = mob.chance(0.3) ? 0 : mob.between(-span, span);
        mob.headTo = mob.between(-0.2, 0.15);
        mob.glance = mob.between(0.6, 1.6);
      }
    } else if (mob.act === "peck") mob.headTo = Math.sin(t * (8 + mob.quirk * 4)) > 0.3 ? 1.15 : 0.05;
    else if (mob.act === "flap") {
      const hop = t < 0.7 ? Math.sin((t / 0.7) * Math.PI) : 0;
      mob.lift = hop * 0.16;
      mob.flap = Math.abs(Math.sin(t * 24)) * 1.1 * Math.min(1, hop * 3);
    } else if (mob.act === "stare") {
      mob.swell = t > 0.9 && t < 3.3 ? 0.5 - 0.5 * Math.cos((t - 0.9) * Math.PI * 2 * 1.25) : 0;
    } else if (mob.act === "blink") this.teleport(mob, t);
  }

  private teleport(mob: Mob, t: number) {
    if (t < 0.22) {
      mob.blink = 1 - t / 0.22;
      return;
    }
    if (!mob.jumped) {
      const timer = mob.timer;
      mob.jumped = true;
      if (this.spawn(mob)) mob.yaw = Math.atan2(-mob.x, -mob.z) + mob.between(-0.6, 0.6);
      mob.act = "blink";
      mob.actTime = t;
      mob.jumped = true;
      mob.timer = timer;
    }
    mob.blink = Math.min(1, (t - 0.22) / 0.35);
  }
}
