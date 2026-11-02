import { GpuClock, Scaler } from "./budget";
import { GrassBrush } from "./brush";
import { ColorProbe, TextTones } from "./legibility";
import { DAY_MOVE_MS, easeInOutSine, SUNRISE_HOLD_MS, sunriseElapsed, sunriseProgress } from "./clock";
import { CYCLE_SECONDS, CYCLE_STOPS, cycleDelta, dayAt, MOON_RANGE, SUN_RANGE, SUNRISE_FROM, SUNRISE_TO, wrapCycle } from "./cycle";
import { type Daylight, daylightAt } from "./daylight";
import { bindTexture, createFramebuffer, createTexture, type Program, ProgramBatch } from "./gl";
import {
  CAMERA_HEIGHT,
  directionFrom,
  framingFor,
  type Framing,
  GRASS_FAR,
  GRASS_NEAR,
  GRASS_ROOT_WIDTH,
  GRASS_SEGMENTS,
  moonPath,
  SHADOW_AZIMUTHS,
  sunPath,
} from "./layout";
import { invert, lookFrom, type Mat4, multiply, perspective, transformPoint } from "./matrix";
import { type KeepOut, MOB_CUBE, MOB_CUBE_VERTICES, MOB_FLOATS, MOB_PART_LIMIT, MOB_PX, Mobs } from "./mobs";
import { PARTICLE_STRIDE, Particles } from "./particles";
import { SHADERS } from "./shaders";
import { WetPaint } from "./smear";

export interface MeadowOptions {
  canvas: HTMLCanvasElement;
  hero: HTMLElement;
  hint: HTMLElement | null;
  reducedMotion: boolean;
  onFirstFrame: () => void;
  opening?: [from: number, to: number];
}

export interface Meadow {
  dispose(): void;
  travelTo(cycle: number): void;
}

interface Tier {
  phone: boolean;
  dprCap: number;
  pixelBudget: number;
  blades: number;
  bakeSize: [number, number];
  gridSize: [number, number];
  brushRadius: number;
}

type ProgramName = "bakeHeight" | "bakeAux" | "terrain" | "sky" | "grass" | "paint" | "final" | "particles" | "probe" | "cells";
type Phase = "compile" | "bake" | "live" | "failed";
type DayMode = "sunrise" | "cycle" | "drag" | "settle" | "rest";
type Body = "sun" | "moon";

interface Gpu {
  programs: Record<ProgramName, Program>;
  emptyVao: WebGLVertexArrayObject;
  grassVao: WebGLVertexArrayObject;
  terrainVao: WebGLVertexArrayObject;
  particleVao: WebGLVertexArrayObject;
  particleBuffer: WebGLBuffer;
  terrainIndexCount: number;
  heightTex: WebGLTexture;
  materialTex: WebGLTexture;
  auxTex: WebGLTexture;
  horizonTex: WebGLTexture;
  bakeFramebuffer: WebGLFramebuffer;
  auxFramebuffer: WebGLFramebuffer;
  brushTex: WebGLTexture;
  smearTex: WebGLTexture;
}

interface MobGpu {
  program: Program;
  vao: WebGLVertexArrayObject;
  buffer: WebGLBuffer;
}

interface TerrainRead {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  buffer: WebGLBuffer;
  sync: WebGLSync;
}

interface CellTable {
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  columns: number;
  rows: number;
  shape: WebGLTexture;
  stroke: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

interface Targets {
  width: number;
  height: number;
  sceneColor: WebGLTexture;
  sceneFlow: WebGLTexture;
  depth: WebGLRenderbuffer;
  sceneFramebuffer: WebGLFramebuffer;
  paint: WebGLTexture;
  paintFramebuffer: WebGLFramebuffer;
}

const BAKE_STRIPS = 4;
const BRUSH_COLUMNS = 84;
const BRUSH_ROWS = 30;
const SMEAR_COLUMNS = 64;
const SMEAR_ROWS = 40;
const PAINT_SCALE = 0.62;
const WIND_DIR = normalize2(1, 0.32);
const STACKED_HORIZON_SCREEN = 0.69;
const SHARE_ROW_SLACK = 8;
const TAP_PX = 10;
const AMBIENT_FRAME_MS = 1000 / 30;
const AMBIENT_EARLY_MS = 4;
const MAX_HELD_FRAMES = 2;
const ACTIVE_HOLD_MS = 700;
const CYCLE_RAMP_SECONDS = 2.5;
const DRAG_FOLLOW = 18;
const BODY_HIT_PX = 46;
const BODY_UP = degrees(-1.5);
const CONTINUITY_PX = 120;
const DRAG_SAMPLES = 360;
const SKY_DARK_NIGHT = 0.4;
const PROBE_INTERVAL_MS = 1000;
const MOVING_PROBE_INTERVAL_MS = 400;
const FIREFLY_TEXT_REACH = 48;
const SUN_MIN_RED = 200;
const SUN_MAX_BLUE_SHARE = 0.45;
const MOON_MIN_SUM = 520;
const MOB_COMPILE_AFTER_FRAMES = 2;
const STROKE_CELL_PX = 16;
const CELL_MARGIN = 7;
const KEEP_OUT_TITLE = '[data-meadow-keep-out="title"]';
const KEEP_OUT_COPY = '[data-meadow-keep-out="copy"], [data-meadow-keep-out="row"] > *';
const TERRAIN_READ_SIZE: [number, number] = [384, 768];
const INTERACTIVE = "a, button, input, textarea, select, label, summary, [data-send-panel]";
const SLIVER_PX = 48;
function degrees(value: number) {
  return (value * Math.PI) / 180;
}
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function normalize2(x: number, y: number): [number, number] {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

function pickTier(): Tier {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const phone = coarse && Math.min(screen.width, screen.height) < 700;
  if (phone) return { phone, dprCap: 2, pixelBudget: 1.1e6, blades: 30000, bakeSize: [512, 1024], gridSize: [300, 380], brushRadius: 96 };
  return { phone, dprCap: 1.6, pixelBudget: 2.4e6, blades: 80000, bakeSize: [768, 1536], gridSize: [520, 600], brushRadius: 130 };
}

export function createMeadow(options: MeadowOptions): Meadow | null {
  const { canvas, hero, hint, reducedMotion } = options;
  const gl = canvas.getContext("webgl2", {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  const tier = pickTier();
  const brush = new GrassBrush(BRUSH_COLUMNS, BRUSH_ROWS);
  const wet = new WetPaint(SMEAR_COLUMNS, SMEAR_ROWS);
  const particles = new Particles();
  const pointer = { x: 0, y: 0, active: false, touch: false, downX: 0, downY: 0, downAt: 0, down: false, drag: null as Body | null, lastX: 0, lastY: 0 };
  const windOn = !reducedMotion;
  const look = { x: 0, y: 0, settled: true };
  const [openFrom, openTo] = options.opening ?? [SUNRISE_FROM, SUNRISE_TO];
  const startCycle = reducedMotion ? openTo : openFrom;
  const day = { c: startCycle, target: startCycle, mode: (reducedMotion ? "rest" : "sunrise") as DayMode, from: 0, to: 0, start: 0, ramp: 0 };
  const bodies = { sun: { x: -999, y: -999, up: false }, moon: { x: -999, y: -999, up: false }, radius: 40 };
  const projection: Mat4 = new Float32Array(16);
  const view: Mat4 = new Float32Array(16);
  const viewProjection: Mat4 = new Float32Array(16);
  const inverseViewProjection: Mat4 = new Float32Array(16);
  let phase: Phase = "compile";
  let batch: ProgramBatch<ProgramName> | null = null;
  let gpu: Gpu | null = null;
  let targets: Targets | null = null;
  let cellTable: CellTable | null = null;
  let cellTablesOff = !gl.getExtension("EXT_color_buffer_float");
  let bakeStrip = 0;
  let raf = 0;
  let ambientTimer = 0;
  let paused = false;
  let lastRenderAt = 0;
  let activeUntil = 0;
  let previousFrameBusy = false;
  let lost = false;
  let heroVisible = true;
  let firstFrameSent = false;
  let lastNow = 0;
  let windTime = 0;
  let clock = new GpuClock(gl);
  const scaler = new Scaler();
  let inFlight: WebGLSync | null = null;
  let heldFrames = 0;
  let brushUploaded = false;
  let smearUploaded = false;
  let needsRender = true;
  let framing: Framing = framingFor(1.6);
  const veil = { left: 0, top: 0, right: 0, bottom: 0 };
  const bar = document.querySelector<HTMLElement>("[data-bar]");
  const tones = new TextTones(hero, bar, (tone) => {
    hero.dataset.sky = tone;
  });
  let probe: ColorProbe | null = null;
  let tonesFromScene = false;
  let lastProbeAt = -Infinity;
  let probedCycle = -1;
  let sunSeen = true;
  let moonSeen = true;
  let stack = { clear: 0, horizon: 0 };
  let cssWidth = 1;
  let cssHeight = 1;
  let heroDocLeft = 0;
  let heroDocTop = 0;
  let scrollTop = window.scrollY;
  let scrollLeft = window.scrollX;
  let scrollStale = false;
  let viewProj: Mat4 | null = null;
  let eye: [number, number, number] = [0, CAMERA_HEIGHT, 0];
  let grassTopCss = 0;
  let hasDragged = false;
  let cursor = "";
  let hintBody: Body | null = null;
  let hintWidth = 0;
  let hintTransform = "";
  const mobs = new Mobs(reducedMotion);
  let mobBatch: ProgramBatch<"mob"> | null = null;
  let mobGpu: MobGpu | null = null;
  let mobsOff = false;
  let mobFraming: Framing | null = null;
  let mobWidth = 0;
  let framesSinceFirst = 0;
  let terrainRead: TerrainRead | null = null;
  let terrainReady = false;
  if (import.meta.env.DEV) Object.assign(window, { __meadowMobs: mobs });

  const fail = (error: unknown) => {
    phase = "failed";
    canvas.dataset.meadow = "failed";
    console.warn(error);
  };

  const startCompile = () => {
    try {
      batch = new ProgramBatch<ProgramName>(gl, {
        bakeHeight: [SHADERS.fullscreenVs, SHADERS.bakeHeightFs],
        bakeAux: [SHADERS.fullscreenVs, SHADERS.bakeAuxFs],
        terrain: [SHADERS.terrainVs, SHADERS.terrainFs],
        sky: [SHADERS.fullscreenVs, SHADERS.skyFs],
        grass: [SHADERS.grassVs, SHADERS.grassFs],
        paint: [SHADERS.fullscreenVs, SHADERS.paintFs],
        final: [SHADERS.fullscreenVs, SHADERS.finalFs],
        particles: [SHADERS.particleVs, SHADERS.particleFs],
        probe: [SHADERS.fullscreenVs, SHADERS.probeFs],
        cells: [SHADERS.fullscreenVs, SHADERS.cellFs],
      });
      phase = "compile";
    } catch (error) {
      fail(error);
    }
  };

  const buildGpu = (programs: Record<ProgramName, Program>): Gpu => {
    const emptyVao = gl.createVertexArray()!;

    const bladeVertices: number[] = [];
    for (let segment = 0; segment < GRASS_SEGMENTS; segment++) bladeVertices.push(segment, -1, segment, 1);
    bladeVertices.push(GRASS_SEGMENTS, 0);
    const grassVao = gl.createVertexArray()!;
    gl.bindVertexArray(grassVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bladeVertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const [columns, rows] = tier.gridSize;
    const uv = new Float32Array((columns + 1) * (rows + 1) * 2);
    for (let row = 0; row <= rows; row++) {
      const v = 1 - (1 - row / rows) ** 1.5;
      for (let col = 0; col <= columns; col++) {
        const index = (row * (columns + 1) + col) * 2;
        uv[index] = col / columns;
        uv[index + 1] = v;
      }
    }
    const indices = new Uint32Array(rows * ((columns + 1) * 2 + 1));
    let cursorIndex = 0;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col <= columns; col++) {
        indices[cursorIndex++] = (row + 1) * (columns + 1) + col;
        indices[cursorIndex++] = row * (columns + 1) + col;
      }
      indices[cursorIndex++] = 0xffffffff;
    }
    const terrainVao = gl.createVertexArray()!;
    gl.bindVertexArray(terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const particleVao = gl.createVertexArray()!;
    gl.bindVertexArray(particleVao);
    const particleBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, particleBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, particles.data.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, PARTICLE_STRIDE, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, PARTICLE_STRIDE, 16);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, PARTICLE_STRIDE, 32);
    gl.bindVertexArray(null);

    const [bakeWidth, bakeHeight] = tier.bakeSize;
    const heightTex = createTexture(gl, bakeWidth, bakeHeight);
    const materialTex = createTexture(gl, bakeWidth, bakeHeight);
    const auxTex = createTexture(gl, bakeWidth, bakeHeight);
    const horizonTex = createTexture(gl, bakeWidth, bakeHeight);
    const bakeFramebuffer = createFramebuffer(gl, [heightTex, materialTex]);
    const auxFramebuffer = createFramebuffer(gl, [auxTex, horizonTex]);
    const brushTex = createTexture(gl, BRUSH_COLUMNS, BRUSH_ROWS, gl.RGBA16F, gl.RGBA, gl.FLOAT);
    const smearTex = createTexture(gl, SMEAR_COLUMNS, SMEAR_ROWS, gl.RG16F, gl.RG, gl.FLOAT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return {
      programs,
      emptyVao,
      grassVao,
      terrainVao,
      particleVao,
      particleBuffer,
      terrainIndexCount: indices.length,
      heightTex,
      materialTex,
      auxTex,
      horizonTex,
      bakeFramebuffer,
      auxFramebuffer,
      brushTex,
      smearTex,
    };
  };

  const startMobs = () => {
    try {
      mobBatch = new ProgramBatch<"mob">(gl, { mob: [SHADERS.mobVs, SHADERS.mobFs] });
    } catch (error) {
      mobsOff = true;
      console.warn(error);
    }
  };

  const startTerrainRead = (g: Gpu) => {
    const [width, height] = TERRAIN_READ_SIZE;
    const [bakeWidth, bakeHeight] = tier.bakeSize;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.bakeFramebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.blitFramebuffer(0, 0, bakeWidth, bakeHeight, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, framebuffer);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    terrainRead = { texture, framebuffer, buffer, sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)! };
    gl.flush();
  };

  const pollTerrainRead = (read: TerrainRead) => {
    if (gl.getSyncParameter(read.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return;
    const [width, height] = TERRAIN_READ_SIZE;
    const pixels = new Uint8Array(width * height * 4);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, read.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteSync(read.sync);
    gl.deleteTexture(read.texture);
    gl.deleteFramebuffer(read.framebuffer);
    gl.deleteBuffer(read.buffer);
    terrainRead = null;
    terrainReady = true;
    mobs.setTerrain(pixels, width, height);
    needsRender = true;
  };

  const finishMobs = (pending: ProgramBatch<"mob">) => {
    mobBatch = null;
    try {
      const program = pending.finish().mob;
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, MOB_CUBE, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      const buffer = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, mobs.data.byteLength, gl.DYNAMIC_DRAW);
      for (let slot = 0; slot < MOB_FLOATS / 4; slot++) {
        gl.enableVertexAttribArray(2 + slot);
        gl.vertexAttribPointer(2 + slot, 4, gl.FLOAT, false, MOB_FLOATS * 4, slot * 16);
        gl.vertexAttribDivisor(2 + slot, 1);
      }
      gl.bindVertexArray(null);
      mobGpu = { program, vao, buffer };
      needsRender = true;
    } catch (error) {
      mobsOff = true;
      console.warn(error);
    }
  };

  const bakeStep = (g: Gpu) => {
    const [width, height] = tier.bakeSize;
    const stripHeight = Math.ceil(height / BAKE_STRIPS);
    const strip = bakeStrip % BAKE_STRIPS;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(g.emptyVao);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, strip * stripHeight, width, stripHeight);
    if (bakeStrip < BAKE_STRIPS) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.bakeFramebuffer);
      g.programs.bakeHeight.use().vec2("uBakeSize", width, height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, g.auxFramebuffer);
      bindTexture(gl, 0, g.heightTex);
      g.programs.bakeAux
        .use()
        .int("uHeightTex", 0)
        .vec4("uAzimuths", SHADOW_AZIMUTHS[0], SHADOW_AZIMUTHS[1], SHADOW_AZIMUTHS[2], SHADOW_AZIMUTHS[3]);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    bakeStrip++;
    return bakeStrip >= BAKE_STRIPS * 2;
  };

  const releaseTargets = () => {
    probe?.dispose();
    probe = null;
    if (!targets) return;
    gl.deleteTexture(targets.sceneColor);
    gl.deleteTexture(targets.sceneFlow);
    gl.deleteTexture(targets.paint);
    gl.deleteRenderbuffer(targets.depth);
    gl.deleteFramebuffer(targets.sceneFramebuffer);
    gl.deleteFramebuffer(targets.paintFramebuffer);
    targets = null;
  };

  const ensureSize = () => {
    const budgetDpr = Math.sqrt(tier.pixelBudget / Math.max(1, cssWidth * cssHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap, budgetDpr) * scaler.scale;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      framing = framingFor(width / height, stack.clear, stack.horizon);
      particles.resize(cssWidth, cssHeight);
      needsRender = true;
    }
    const paintWidth = Math.max(1, Math.round(width * PAINT_SCALE));
    const paintHeight = Math.max(1, Math.round(height * PAINT_SCALE));
    if (targets && targets.width === paintWidth && targets.height === paintHeight) return;
    releaseTargets();
    const sceneColor = createTexture(gl, paintWidth, paintHeight);
    const sceneFlow = createTexture(gl, paintWidth, paintHeight);
    const sceneFramebuffer = createFramebuffer(gl, [sceneColor, sceneFlow]);
    const depth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, paintWidth, paintHeight);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const paint = createTexture(gl, paintWidth, paintHeight);
    const paintFramebuffer = createFramebuffer(gl, [paint]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    targets = { width: paintWidth, height: paintHeight, sceneColor, sceneFlow, depth, sceneFramebuffer, paint, paintFramebuffer };
    if (gpu) probe = new ColorProbe(gl, gpu.programs.probe, paintWidth, paintHeight);
    probedCycle = -1;
  };

  const releaseCellTable = () => {
    if (!cellTable) return;
    gl.deleteTexture(cellTable.shape);
    gl.deleteTexture(cellTable.stroke);
    gl.deleteFramebuffer(cellTable.framebuffer);
    cellTable = null;
  };

  const floatTarget = (width: number, height: number) => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  };

  const ensureCellTable = (dpr: number) => {
    if (cellTablesOff) return null;
    const { width, height } = canvas;
    if (cellTable && cellTable.canvasWidth === width && cellTable.canvasHeight === height && cellTable.dpr === dpr) return cellTable;
    releaseCellTable();
    const cellSize = STROKE_CELL_PX * dpr;
    const columns = Math.ceil(width / cellSize) + CELL_MARGIN * 2 + 1;
    const rows = Math.ceil(height / cellSize) + CELL_MARGIN * 2 + 1;
    const shape = floatTarget(columns, rows);
    const stroke = floatTarget(columns, rows);
    const framebuffer = createFramebuffer(gl, [shape, stroke]);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    cellTable = { canvasWidth: width, canvasHeight: height, dpr, columns, rows, shape, stroke, framebuffer };
    if (complete) return cellTable;
    releaseCellTable();
    cellTablesOff = true;
    return null;
  };

  const grassArea = (aspect: number) => {
    const tanHalfH = Math.tan(framing.verticalFov / 2) * aspect;
    return { near: GRASS_NEAR, far: GRASS_FAR, rootWidth: GRASS_ROOT_WIDTH, slope: tanHalfH * 1.08 + 0.1 };
  };

  const project = (x: number, y: number, z: number) => {
    if (!viewProj) return null;
    const w = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
    if (w <= 0) return null;
    const ndcX = (viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12]) / w;
    const ndcY = (viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13]) / w;
    return { x: (ndcX * 0.5 + 0.5) * cssWidth, y: (0.5 - ndcY * 0.5) * cssHeight, ndcX, ndcY };
  };

  const projectDirection = (dir: [number, number, number]) => project(eye[0] + dir[0] * 1e4, eye[1] + dir[1] * 1e4, eye[2] + dir[2] * 1e4);

  const bodyPoint = (cycle: number, body: Body) => {
    const { p, moon } = dayAt(cycle);
    if (body === "sun") {
      const sun = sunPath(p, framing.sunPeak, framing.sunCeiling, framing.sunSweep);
      return projectDirection(directionFrom(sun.azimuth, sun.elevation));
    }
    const path = moonPath(moon, framing);
    return projectDirection(directionFrom(path.azimuth, path.elevation));
  };

  const nearestCycle = (x: number, y: number, body: Body) => {
    const [from, to] = body === "sun" ? SUN_RANGE : MOON_RANGE;
    let best = day.target;
    let bestScore = Infinity;
    for (let i = 0; i <= DRAG_SAMPLES; i++) {
      const cycle = from + ((to - from) * i) / DRAG_SAMPLES;
      const point = bodyPoint(cycle, body);
      if (!point) continue;
      const score = Math.hypot(point.x - x, point.y - y) + Math.abs(cycleDelta(day.target, cycle)) * CONTINUITY_PX;
      if (score < bestScore) {
        bestScore = score;
        best = wrapCycle(cycle);
      }
    }
    return best;
  };

  const hitBody = (x: number, y: number): Body | null => {
    let hit: Body | null = null;
    let nearest = Math.max(BODY_HIT_PX, bodies.radius * 1.7);
    for (const name of ["sun", "moon"] as const) {
      const body = bodies[name];
      if (!body.up) continue;
      const distance = Math.hypot(x - body.x, y - body.y);
      if (distance < nearest) {
        nearest = distance;
        hit = name;
      }
    }
    return hit;
  };

  const setCursor = (next: string) => {
    if (next === cursor) return;
    cursor = next;
    if (next) hero.dataset.cursor = next;
    else delete hero.dataset.cursor;
  };

  const startDrag = (body: Body) => {
    pointer.drag = body;
    day.mode = "drag";
    day.target = day.c;
    hasDragged = true;
    hint?.classList.remove("is-shown");
    setCursor("grabbing");
    wake();
  };

  const resumeCycle = () => {
    day.mode = reducedMotion ? "rest" : "cycle";
    day.ramp = 0;
  };

  const advanceToNextStop = () => {
    let delta = 1;
    for (const stop of CYCLE_STOPS) {
      const ahead = wrapCycle(stop - day.c);
      if (ahead > 0.01 && ahead < delta) delta = ahead;
    }
    if (reducedMotion) {
      day.c = day.target = wrapCycle(day.c + delta);
      day.mode = "rest";
      needsRender = true;
      return;
    }
    day.mode = "settle";
    day.from = day.c;
    day.to = day.c + delta;
    day.start = performance.now();
  };

  const travelTo = (cycle: number) => {
    const delta = wrapCycle(cycle - day.c);
    if (reducedMotion) {
      day.c = day.target = wrapCycle(cycle);
      day.mode = "rest";
      needsRender = true;
    } else if (delta > 1e-4) {
      day.mode = "settle";
      day.from = day.c;
      day.to = day.c + delta;
      day.start = performance.now();
    }
    wake();
  };

  const release = (x: number, y: number) => {
    pointer.drag = null;
    if (Math.hypot(x - pointer.downX, y - pointer.downY) < TAP_PX) advanceToNextStop();
    else resumeCycle();
    setCursor(hitBody(x, y) ? "grab" : "");
    wake();
  };

  const updateDay = (now: number, dt: number) => {
    if (day.mode === "sunrise") {
      const elapsed = sunriseElapsed(now);
      day.c = day.target = mix(openFrom, openTo, sunriseProgress(elapsed));
      if (elapsed > SUNRISE_HOLD_MS + DAY_MOVE_MS) resumeCycle();
      return;
    }
    if (day.mode === "settle") {
      const t = (now - day.start) / DAY_MOVE_MS;
      day.c = day.target = wrapCycle(mix(day.from, day.to, easeInOutSine(t)));
      if (t >= 1) resumeCycle();
      return;
    }
    if (day.mode === "cycle") {
      day.ramp = Math.min(1, day.ramp + dt / CYCLE_RAMP_SECONDS);
      const advance = (easeInOutSine(day.ramp) * dt) / CYCLE_SECONDS;
      day.target = wrapCycle(day.target + advance);
      day.c = wrapCycle(day.c + advance);
    }
    const lag = cycleDelta(day.c, day.target);
    day.c = Math.abs(lag) < 1e-5 ? day.target : wrapCycle(day.c + lag * (1 - Math.exp(-dt * DRAG_FOLLOW)));
  };

  const isBusy = (now: number) => {
    if (needsRender || (!mobGpu && !mobsOff) || terrainRead || day.mode === "sunrise" || day.mode === "drag" || day.mode === "settle") return true;
    if (Math.abs(cycleDelta(day.c, day.target)) > 1e-4) return true;
    if (mobGpu && mobs.searching) return true;
    if (reducedMotion) return !!probe && (probe.pending || probedCycle !== day.c);
    return now < activeUntil || !look.settled || !brush.settled || !wet.settled || particles.busy;
  };

  const fireflyShade = (x: number, y: number) => tones.shadeAt(x, y, FIREFLY_TEXT_REACH);

  const captureProbe = (now: number, t: Targets) => {
    if (!probe || probe.pending) return;
    const moving = day.mode === "drag" || day.mode === "settle" || day.mode === "sunrise";
    if (reducedMotion ? probedCycle === day.c : now - lastProbeAt < (moving ? MOVING_PROBE_INTERVAL_MS : PROBE_INTERVAL_MS)) return;
    probe.capture(t.paint);
    lastProbeAt = now;
    probedCycle = day.c;
  };

  const readProbe = () => {
    if (!probe?.poll()) return;
    tones.decide(probe.pixels, probe.width, probe.height, cssWidth, cssHeight);
    if (!tonesFromScene) {
      tonesFromScene = true;
      tones.ease(Infinity);
    }
    const sun = probe.colorAt(bodies.sun.x, bodies.sun.y, bodies.radius * 0.45, cssWidth, cssHeight, true);
    const moon = probe.colorAt(bodies.moon.x, bodies.moon.y, bodies.radius * 0.8, cssWidth, cssHeight);
    sunSeen = !!sun && sun[0] >= SUN_MIN_RED && sun[2] <= sun[0] * SUN_MAX_BLUE_SHARE;
    moonSeen = !!moon && moon[0] + moon[1] + moon[2] >= MOON_MIN_SUM;
  };

  function readScroll() {
    if (!scrollStale) return;
    scrollStale = false;
    scrollTop = window.scrollY;
    scrollLeft = window.scrollX;
  }

  const applyShared = (program: Program, light: Daylight, skySpan: number) => {
    const padX = 24;
    const padY = 10;
    const feather = 64;
    return program
      .vec4("uVeil", (veil.left - padX) / cssWidth, 1 - (veil.bottom + padY) / cssHeight, (veil.right + padX) / cssWidth, 1 - (veil.top - padY) / cssHeight)
      .vec2("uVeilFeather", feather / cssWidth, feather / cssHeight)
      .vec2("uTargetSize", targets?.width ?? 1, targets?.height ?? 1)
      .vec3("uSunDir", light.sunDir)
      .vec3("uKeyDir", light.keyDir)
      .vec3("uKeyColor", light.keyColor)
      .float("uKeyElev", light.keyElevation)
      .vec4("uShadowMix", ...light.shadowMix)
      .vec3("uMoonDir", light.moonDir)
      .vec3("uCamPos", eye)
      .vec3("uSkyHorizon", light.skyHorizon)
      .vec3("uSkyLow", light.skyLow)
      .vec3("uSkyMid", light.skyMid)
      .vec3("uSkyTop", light.skyTop)
      .vec3("uGlow", light.glow)
      .float("uSkySpan", skySpan)
      .float("uAmbient", light.ambient)
      .float("uHaze", light.haze)
      .float("uMist", light.mist)
      .float("uNight", light.night)
      .float("uTime", windTime);
  };

  const render = (now: number, dt: number, busy: boolean) => {
    if (!gpu || !targets) return;
    const g = gpu;
    const t = targets;
    const { programs } = g;
    const { width, height } = canvas;
    const aspect = width / height;
    const dpr = width / cssWidth;
    updateDay(now, dt);
    readScroll();
    const scroll = reducedMotion ? 0 : Math.min(1, Math.max(0, scrollTop / cssHeight));

    if (!pointer.drag) {
      const follow = 1 - Math.exp(-dt * 2.4);
      const hovering = !reducedMotion && pointer.active && !pointer.touch;
      const targetX = Math.max(-1, Math.min(1, hovering ? (pointer.x / cssWidth) * 2 - 1 : 0));
      const targetY = Math.max(-1, Math.min(1, hovering ? 1 - (pointer.y / cssHeight) * 2 : 0));
      look.x += (targetX - look.x) * follow;
      look.y += (targetY - look.y) * follow;
      look.settled = Math.abs(targetX - look.x) + Math.abs(targetY - look.y) < 0.03;
    }

    eye = [look.x * 0.34, CAMERA_HEIGHT + look.y * 0.07 + scroll * 0.85, -scroll * 0.6];
    const yaw = framing.yaw - look.x * degrees(1.1);
    const pitch = framing.pitch + look.y * degrees(0.7) - scroll * degrees(4);
    perspective(framing.verticalFov, aspect, 0.2, 40000, projection);
    viewProj = multiply(projection, lookFrom(eye, yaw, pitch, view), viewProjection);
    const inverseViewProj = invert(viewProj, inverseViewProjection);
    const tanHalfV = Math.tan(framing.verticalFov / 2);
    const area = grassArea(aspect);
    const { p, moon } = dayAt(day.c);
    const light = daylightAt(p, framing, moon);
    const skySpan = Math.max(0.15, Math.sin(pitch + framing.verticalFov / 2));
    const pixelAngle = (2 * tanHalfV) / t.height;

    const sunPoint = projectDirection(light.sunDir);
    const moonPoint = projectDirection(light.moonDir);
    bodies.radius = ((framing.sunRadius / tanHalfV) * cssHeight) / 2;
    bodies.sun.x = sunPoint ? sunPoint.x : -999;
    bodies.sun.y = sunPoint ? sunPoint.y : -999;
    bodies.sun.up = !!sunPoint && sunSeen && light.sunElevation > BODY_UP && light.night < 0.6;
    bodies.moon.x = moonPoint ? moonPoint.x : -999;
    bodies.moon.y = moonPoint ? moonPoint.y : -999;
    bodies.moon.up = !!moonPoint && moonSeen && light.moonElevation > BODY_UP && light.night > 0.3;
    let mobParts = 0;
    if (mobGpu) {
      if (framing !== mobFraming || cssWidth !== mobWidth) {
        mobs.layout(framing, aspect, cssWidth, cssHeight);
        mobFraming = framing;
        mobWidth = cssWidth;
      }
      mobs.step(reducedMotion ? 0 : dt, light.night);
      mobParts = Math.min(MOB_PART_LIMIT, mobs.fill(light.keyDir, Math.max(light.keyColor[0], light.keyColor[1], light.keyColor[2])));
    }
    const grassEdge = project(0, 0, GRASS_FAR * 0.75);
    grassTopCss = grassEdge ? grassEdge.y : cssHeight * 0.7;

    if (tonesFromScene) {
      tones.fallback(light.night > SKY_DARK_NIGHT ? "dark" : "light");
      tones.ease(reducedMotion ? Infinity : dt);
    }

    if (hint) placeHint(now);

    if (!reducedMotion) {
      const touch = { u: 0, v: 0, active: false };
      if (pointer.active && !pointer.drag) {
        const ndcX = (pointer.x / cssWidth) * 2 - 1;
        const ndcY = 1 - (pointer.y / cssHeight) * 2;
        const near = transformPoint(inverseViewProj, ndcX, ndcY, -1);
        const far = transformPoint(inverseViewProj, ndcX, ndcY, 1);
        const dirY = far[1] - near[1];
        if (dirY < 0) {
          const along = (0.24 - near[1]) / dirY;
          const hitX = near[0] + (far[0] - near[0]) * along;
          const hitZ = near[2] + (far[2] - near[2]) * along;
          if (hitZ > area.near * 0.6 && hitZ < area.far) {
            touch.u = (hitX / (area.rootWidth + hitZ * area.slope) + 1) / 2;
            touch.v = (1 / hitZ - 1 / area.near) / (1 / area.far - 1 / area.near);
            touch.active = touch.u > -0.2 && touch.u < 1.2;
          }
        }
      }
      const focal = cssHeight / 2 / tanHalfV;
      const pointerSpeed = dt > 0 ? Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY) / dt : 0;
      pointer.lastX = pointer.x;
      pointer.lastY = pointer.y;
      if (touch.active) particles.sparkle(Math.min(dt, 1 / 30), pointer.x, pointer.y, pointerSpeed, light.night);
      const brushWidth = (cssWidth * area.slope) / (tanHalfV * aspect);
      const brushHeight = focal * (CAMERA_HEIGHT - 0.24) * (1 / area.near - 1 / area.far);
      const step = Math.min(dt, 1 / 30);
      const substeps = Math.min(4, Math.max(1, Math.ceil(dt * 60 - 0.01)));
      if (touch.active || !brush.resting) {
        for (let i = 0; i < substeps; i++) brush.step(Math.min(dt, 1 / 15) / substeps, touch, brushWidth, brushHeight, tier.brushRadius);
      }
      if (!brush.resting || !brushUploaded) {
        gl.bindTexture(gl.TEXTURE_2D, g.brushTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BRUSH_COLUMNS, BRUSH_ROWS, gl.RGBA, gl.FLOAT, brush.field);
        brushUploaded = brush.resting;
      }
      const smearing = pointer.active && !pointer.drag;
      if (smearing || !wet.settled) wet.step(step, { x: pointer.x, y: pointer.y, active: smearing }, cssWidth, cssHeight, tier.phone ? 70 : 90);
      if (!wet.settled || !smearUploaded) {
        gl.bindTexture(gl.TEXTURE_2D, g.smearTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SMEAR_COLUMNS, SMEAR_ROWS, gl.RG, gl.FLOAT, wet.field);
        smearUploaded = wet.settled;
      }
      particles.step(step, light.night, { x: pointer.x, y: pointer.y, active: pointer.active });
    } else if (!brushUploaded) {
      gl.bindTexture(gl.TEXTURE_2D, g.brushTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BRUSH_COLUMNS, BRUSH_ROWS, gl.RGBA, gl.FLOAT, brush.field);
      gl.bindTexture(gl.TEXTURE_2D, g.smearTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SMEAR_COLUMNS, SMEAR_ROWS, gl.RG, gl.FLOAT, wet.field);
      brushUploaded = true;
    }

    clock.start(busy);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFramebuffer);
    gl.viewport(0, 0, t.width, t.height);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    const bandHeight = Math.min(t.height * 0.7, (t.height / 2 / tanHalfV) * CAMERA_HEIGHT * (1 / area.near - 1 / area.far) * 0.45);
    const columns = Math.max(8, Math.round(Math.sqrt((tier.blades * t.width) / Math.max(1, bandHeight))));
    const bladeCount = tier.phone ? tier.blades : tier.blades * Math.min(1.3, Math.max(0.5, (cssWidth * cssHeight) / (1440 * 900)));
    const rows = Math.max(8, Math.round(bladeCount / columns));
    bindTexture(gl, 0, g.brushTex);
    bindTexture(gl, 1, g.horizonTex);
    applyShared(programs.grass.use(), light, skySpan)
      .mat4("uViewProj", viewProj)
      .vec2("uGrid", columns, rows)
      .vec4("uGrassArea", area.near, area.far, area.rootWidth, area.slope)
      .float("uWind", windOn ? 1 : 0)
      .vec2("uWindDir", WIND_DIR[0], WIND_DIR[1])
      .float("uPixelAngle", pixelAngle)
      .int("uBrushTex", 0)
      .int("uHorizonTex", 1)
      .vec4s("uMobs", mobs.contacts, mobs.contactCount)
      .int("uMobCount", mobGpu ? mobs.contactCount : 0)
      .vec2("uMobShadow", mobs.shadow[0], mobs.shadow[1]);
    gl.bindVertexArray(g.grassVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, GRASS_SEGMENTS * 2 + 1, columns * rows);

    if (mobGpu && mobParts > 0) {
      bindTexture(gl, 2, g.heightTex);
      applyShared(mobGpu.program.use(), light, skySpan)
        .mat4("uViewProj", viewProj)
        .int("uHorizonTex", 1)
        .int("uHeightTex", 2)
        .float("uHillScale", framing.hillScale)
        .float("uPx", MOB_PX);
      gl.bindVertexArray(mobGpu.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, mobGpu.buffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, mobs.data, 0, mobParts * MOB_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, MOB_CUBE_VERTICES, mobParts);
    }

    bindTexture(gl, 0, g.heightTex);
    bindTexture(gl, 1, g.materialTex);
    bindTexture(gl, 2, g.auxTex);
    bindTexture(gl, 3, g.horizonTex);
    applyShared(programs.terrain.use(), light, skySpan)
      .mat4("uViewProj", viewProj)
      .int("uHeightTex", 0)
      .int("uMaterialTex", 1)
      .int("uAuxTex", 2)
      .int("uHorizonTex", 3)
      .float("uGrassFar", area.far)
      .float("uHillScale", framing.hillScale);
    gl.bindVertexArray(g.terrainVao);
    gl.drawElements(gl.TRIANGLE_STRIP, g.terrainIndexCount, gl.UNSIGNED_INT, 0);

    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.bindVertexArray(g.emptyVao);
    applyShared(programs.sky.use(), light, skySpan)
      .mat4("uInvViewProj", inverseViewProj)
      .float("uSunRadius", framing.sunRadius)
      .vec2("uSunNdc", sunPoint ? sunPoint.ndcX : 0, sunPoint ? sunPoint.ndcY : 2)
      .float("uSunDiscNdc", bodies.radius / (cssHeight / 2))
      .float("uAspect", aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.depthMask(true);
    gl.disable(gl.DEPTH_TEST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.paintFramebuffer);
    bindTexture(gl, 0, t.sceneColor);
    bindTexture(gl, 1, t.sceneFlow);
    programs.paint
      .use()
      .int("uScene", 0)
      .int("uFlow", 1)
      .vec2("uTexel", 1 / t.width, 1 / t.height)
      .float("uRadius", 2.3 * (t.width / cssWidth));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    captureProbe(now, t);

    const cells = ensureCellTable(dpr);
    if (cells) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, cells.framebuffer);
      gl.viewport(0, 0, cells.columns, cells.rows);
      bindTexture(gl, 1, t.sceneFlow);
      programs.cells
        .use()
        .int("uFlow", 1)
        .vec2("uResolution", width, height)
        .float("uDpr", dpr)
        .vec2("uCellOrigin", -CELL_MARGIN, -CELL_MARGIN);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      bindTexture(gl, 4, cells.shape);
      bindTexture(gl, 5, cells.stroke);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    bindTexture(gl, 0, t.paint);
    bindTexture(gl, 1, t.sceneFlow);
    bindTexture(gl, 2, g.smearTex);
    bindTexture(gl, 3, g.horizonTex);
    const moonShare = Math.min(1, Math.max(0, (light.night - 0.35) / 0.3));
    const handover = moonShare * moonShare * (3 - 2 * moonShare);
    const angleToward = (point: { x: number; y: number } | null) => (point ? Math.atan2(cssHeight / 2 - point.y, point.x - cssWidth / 2) : Math.PI / 2);
    const sunAngle = angleToward(sunPoint);
    const turn = Math.atan2(Math.sin(angleToward(moonPoint) - sunAngle), Math.cos(angleToward(moonPoint) - sunAngle));
    const lightAngle = sunAngle + turn * handover;
    const lightDir = [Math.cos(lightAngle) * 0.62, Math.sin(lightAngle) * 0.62, 0.78];
    const specColor = [mix(1, 0.45, handover), mix(0.9, 0.55, handover), mix(0.72, 0.75, handover)];
    applyShared(programs.final.use(), light, skySpan)
      .int("uPaint", 0)
      .int("uFlow", 1)
      .int("uSmear", 2)
      .int("uHorizonTex", 3)
      .vec2("uResolution", width, height)
      .float("uDpr", dpr)
      .vec3("uLight", lightDir)
      .vec3("uSpecColor", specColor)
      .vec2("uSunPx", bodies.sun.x * dpr, (cssHeight - bodies.sun.y) * dpr)
      .vec2("uMoonPx", moonPoint ? moonPoint.x * dpr : -9999, moonPoint ? (cssHeight - moonPoint.y) * dpr : -9999)
      .float("uSunRadiusPx", bodies.radius * dpr)
      .float("uRelief", 1.5 * Math.min(1, Math.max(0.55, dpr / 2)))
      .int("uCellShape", 4)
      .int("uCellStroke", 5)
      .int("uCellTable", cells ? 1 : 0)
      .vec2("uCellOrigin", -CELL_MARGIN, -CELL_MARGIN)
      .ivec2("uCellCount", cells?.columns ?? 0, cells?.rows ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!reducedMotion) {
      const count = particles.fill(dpr, light.night, fireflyShade);
      if (count > 0) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(g.particleVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, g.particleBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, particles.data, 0, (count * PARTICLE_STRIDE) / 4);
        programs.particles.use().vec2("uResolution", width, height);
        gl.drawArrays(gl.POINTS, 0, count);
        gl.disable(gl.BLEND);
      }
    }
    clock.stop();
    gl.bindVertexArray(null);

    if (!firstFrameSent) {
      firstFrameSent = true;
      canvas.dataset.meadow = "ready";
      options.onFirstFrame();
    }
  };

  const frame = (now: number) => {
    raf = 0;
    if (lost || phase === "failed") return;
    try {
      if (phase === "compile") {
        if (batch?.ready) {
          const programs = batch.finish();
          batch = null;
          gpu = buildGpu(programs);
          phase = "bake";
          bakeStrip = 0;
        }
      } else if (phase === "bake" && gpu) {
        if (bakeStep(gpu)) {
          phase = "live";
          lastNow = now;
        }
      } else if (phase === "live") {
        readProbe();
        const busy = isBusy(now);
        if ((busy || now - lastRenderAt >= AMBIENT_FRAME_MS - AMBIENT_EARLY_MS) && !gpuBehind()) renderLive(now, busy);
      }
    } catch (error) {
      fail(error);
      return;
    }
    schedule();
  };

  const renderLive = (now: number, busy: boolean) => {
    const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    if (windOn && firstFrameSent) windTime += dt;
    ensureSize();
    const started = performance.now();
    render(now, dt, busy);
    needsRender = false;
    lastRenderAt = now;
    if (terrainRead) pollTerrainRead(terrainRead);
    if (mobBatch?.ready) finishMobs(mobBatch);
    else if (!mobBatch && !mobGpu && !mobsOff && firstFrameSent && ++framesSinceFirst > MOB_COMPILE_AFTER_FRAMES) {
      startMobs();
      if (gpu && !terrainRead && !terrainReady) startTerrainRead(gpu);
    }
    inFlight = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!reducedMotion) {
      if (clock.available) clock.collect((ms, busyFrame) => busyFrame && scaler.gpu(ms, now));
      else if (busy && previousFrameBusy && dt > 0) scaler.frame(dt * 1000, performance.now() - started, now);
    }
    previousFrameBusy = busy;
  };

  const gpuBehind = () => {
    if (!inFlight) return false;
    if (gl.getSyncParameter(inFlight, gl.SYNC_STATUS) !== gl.SIGNALED && heldFrames < MAX_HELD_FRAMES) {
      heldFrames++;
      return true;
    }
    gl.deleteSync(inFlight);
    inFlight = null;
    heldFrames = 0;
    return false;
  };

  const pause = () => {
    paused = true;
    previousFrameBusy = false;
  };

  const schedule = () => {
    if (raf || ambientTimer || lost || phase === "failed") return;
    if (document.hidden) return pause();
    if (phase === "live") {
      if (!heroVisible) return pause();
      const now = performance.now();
      if (!isBusy(now)) {
        if (reducedMotion) return pause();
        const wait = lastRenderAt + AMBIENT_FRAME_MS - now - 6;
        if (wait > 0) {
          previousFrameBusy = false;
          ambientTimer = window.setTimeout(() => {
            ambientTimer = 0;
            schedule();
          }, wait);
          return;
        }
      }
    }
    raf = requestAnimationFrame(frame);
  };

  function wake() {
    if (paused) {
      paused = false;
      lastNow = performance.now();
    }
    if (ambientTimer) {
      clearTimeout(ambientTimer);
      ambientTimer = 0;
    }
    schedule();
  }

  const markActive = () => {
    activeUntil = performance.now() + ACTIVE_HOLD_MS;
    wake();
  };

  const placeHint = (now: number) => {
    if (!hint) return;
    const body: Body | null = bodies.sun.up ? "sun" : bodies.moon.up ? "moon" : null;
    const settledIn = reducedMotion || sunriseElapsed(now) > SUNRISE_HOLD_MS + DAY_MOVE_MS + 500;
    const ready = !hasDragged && body !== null && (day.mode === "cycle" || day.mode === "rest") && settledIn;
    if (ready && body !== hintBody) {
      hintBody = body;
      hint.textContent = `Drag the ${body}`;
      hintWidth = hint.offsetWidth;
    }
    const point = body ? bodies[body] : null;
    const show = ready && !!point && point.x > 0 && point.x < cssWidth;
    hint.classList.toggle("is-shown", show);
    if (!show || !point) return;
    const radius = body === "moon" ? bodies.radius * 0.8 : bodies.radius;
    const roomRight = point.x + radius + 24 + hintWidth < cssWidth;
    const hintX = roomRight ? point.x + radius + 14 : point.x - radius - 14 - hintWidth;
    const side = roomRight ? "right" : "left";
    const transform = `translate(${Math.round(hintX)}px, ${Math.round(point.y - 7)}px)`;
    if (hint.dataset.side !== side) hint.dataset.side = side;
    if (transform !== hintTransform) {
      hintTransform = transform;
      hint.style.transform = transform;
    }
  };

  const localPoint = (clientX: number, clientY: number) => {
    readScroll();
    return { x: clientX - (heroDocLeft - scrollLeft), y: clientY - (heroDocTop - scrollTop) };
  };
  const isInteractive = (target: EventTarget | null) => target instanceof Element && !!target.closest(INTERACTIVE);
  const isTap = (x: number, y: number) => Math.hypot(x - pointer.downX, y - pointer.downY) < 10 && performance.now() - pointer.downAt < 400;
  const nightNow = () => {
    const { p, moon } = dayAt(day.c);
    return daylightAt(p, framing, moon).night;
  };
  const inHero = (x: number, y: number) => y >= 0 && y <= cssHeight && x >= 0 && x <= cssWidth;

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "touch" || event.button !== 0 || isInteractive(event.target)) return;
    const { x, y } = localPoint(event.clientX, event.clientY);
    if (!inHero(x, y)) return;
    Object.assign(pointer, { x, y, active: true, touch: false, down: true, downX: x, downY: y, downAt: performance.now() });
    const body = hitBody(x, y);
    if (body) {
      event.preventDefault();
      startDrag(body);
    }
    markActive();
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const { x, y } = localPoint(event.clientX, event.clientY);
    const inside = inHero(x, y);
    const wasActive = pointer.active;
    Object.assign(pointer, { x, y, active: inside, touch: false });
    if (pointer.drag) {
      day.target = nearestCycle(x, y, pointer.drag);
      markActive();
      return;
    }
    if (inside || wasActive) markActive();
    if (!inside || isInteractive(event.target)) setCursor("");
    else if (hitBody(x, y)) setCursor("grab");
    else if (!reducedMotion && y > grassTopCss) setCursor("brush");
    else setCursor("");
  };
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const { x, y } = localPoint(event.clientX, event.clientY);
    if (pointer.drag) release(x, y);
    else if (!reducedMotion && pointer.down && isTap(x, y) && !isInteractive(event.target)) particles.burst(x, y, nightNow());
    pointer.down = false;
    markActive();
  };
  const onPointerLeave = () => {
    pointer.active = false;
    if (pointer.drag) release(pointer.x, pointer.y);
    setCursor("");
    markActive();
  };
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch || event.touches.length > 1) return;
    const { x, y } = localPoint(touch.clientX, touch.clientY);
    Object.assign(pointer, { x, y, active: true, touch: true, down: true, downX: x, downY: y, downAt: performance.now() });
    markActive();
    if (isInteractive(event.target)) return;
    const body = hitBody(x, y);
    if (body) {
      event.preventDefault();
      startDrag(body);
    } else if (!reducedMotion && y > grassTopCss) {
      hero.dataset.brushing = "";
    }
  };
  const onTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!touch) return;
    const { x, y } = localPoint(touch.clientX, touch.clientY);
    Object.assign(pointer, { x, y, active: true, touch: true });
    markActive();
    if (pointer.drag) {
      event.preventDefault();
      day.target = nearestCycle(x, y, pointer.drag);
    }
  };
  const onTouchEnd = (event: TouchEvent) => {
    delete hero.dataset.brushing;
    if (pointer.drag) release(pointer.x, pointer.y);
    else if (!reducedMotion && pointer.down && isTap(pointer.x, pointer.y) && !isInteractive(event.target)) particles.burst(pointer.x, pointer.y, nightNow());
    pointer.down = false;
    pointer.active = false;
    markActive();
  };
  const onScroll = () => {
    scrollStale = true;
    if (!reducedMotion && heroVisible) markActive();
  };
  const onVisibility = () => {
    if (!document.hidden) return wake();
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(ambientTimer);
    ambientTimer = 0;
    pause();
  };
  const onLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(raf);
    raf = 0;
    clearTimeout(ambientTimer);
    ambientTimer = 0;
    gpu = null;
    targets = null;
    cellTable = null;
    probe = null;
    batch = null;
    mobGpu = null;
    mobBatch = null;
    terrainRead = null;
    terrainReady = false;
    framesSinceFirst = 0;
    inFlight = null;
    heldFrames = 0;
  };
  const onRestored = () => {
    lost = false;
    cellTablesOff = !gl.getExtension("EXT_color_buffer_float");
    clock = new GpuClock(gl);
    bakeStrip = 0;
    brushUploaded = false;
    smearUploaded = false;
    needsRender = true;
    startCompile();
    wake();
  };

  const textBlock = hero.querySelector<HTMLElement>(".hero-text");
  const lede = hero.querySelector<HTMLElement>(".lede");
  const untransformedBox = (element: HTMLElement) => {
    let left = 0;
    let top = 0;
    let node: HTMLElement | null = element;
    while (node && node !== hero) {
      left += node.offsetLeft;
      top += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
  };
  const measureHero = () => {
    const rect = hero.getBoundingClientRect();
    scrollTop = window.scrollY;
    scrollLeft = window.scrollX;
    heroDocTop = rect.top + scrollTop;
    heroDocLeft = rect.left + scrollLeft;
    cssWidth = Math.max(1, canvas.clientWidth);
    cssHeight = Math.max(1, canvas.clientHeight);
  };
  const measureText = () => {
    const heroHeight = canvas.offsetHeight;
    if (!textBlock || heroHeight <= 0) return;
    const veiled = [lede].filter((element): element is HTMLElement => !!element?.offsetParent).map(untransformedBox);
    if (veiled.length) {
      veil.left = Math.min(...veiled.map((box) => box.left));
      veil.top = Math.min(...veiled.map((box) => box.top));
      veil.right = Math.max(...veiled.map((box) => box.right));
      veil.bottom = Math.max(...veiled.map((box) => box.bottom));
    }
    tones.measure(heroDocTop);
    const boxesOf = (selector: string): KeepOut[] =>
      [...hero.querySelectorAll<HTMLElement>(selector)].filter((element) => !!element.offsetParent && element.offsetWidth > 0).map(untransformedBox);
    const copy = boxesOf(KEEP_OUT_COPY);
    const column = copy.length ? { left: 0, top: Math.min(...copy.map((box) => box.top)), right: Math.max(...copy.map((box) => box.right)), bottom: heroHeight } : null;
    const shareRow = textBlock.querySelector<HTMLElement>(".send-more");
    const clearEdge = shareRow?.offsetParent ? untransformedBox(shareRow).bottom - SHARE_ROW_SLACK : untransformedBox(textBlock).bottom;
    const firstScreen = Math.min(heroHeight, window.innerHeight - Math.max(0, heroDocTop));
    const fold = { left: -Infinity, top: firstScreen, right: Infinity, bottom: Infinity };
    mobs.setKeepOut([...boxesOf(KEEP_OUT_TITLE), ...copy, fold], column);
    const next = { clear: clearEdge / heroHeight, horizon: (firstScreen * STACKED_HORIZON_SCREEN) / heroHeight };
    if (Math.abs(next.clear - stack.clear) < 0.002 && Math.abs(next.horizon - stack.horizon) < 0.002) return;
    stack = next;
    framing = framingFor(canvas.width / Math.max(1, canvas.height), stack.clear, stack.horizon);
  };
  let visibilityObserver: IntersectionObserver | null = null;
  let coveredTop = -1;
  const observeVisibility = () => {
    const covered = Math.round((bar?.offsetHeight ?? 0) + SLIVER_PX);
    if (covered === coveredTop) return;
    coveredTop = covered;
    visibilityObserver?.disconnect();
    visibilityObserver = new IntersectionObserver(
      (entries) => {
        heroVisible = entries[entries.length - 1].isIntersecting;
        if (heroVisible) wake();
      },
      { rootMargin: `-${covered}px 0px 0px 0px` },
    );
    visibilityObserver.observe(hero);
  };
  const resizeObserver = new ResizeObserver(() => {
    measureHero();
    measureText();
    observeVisibility();
    needsRender = true;
    wake();
  });

  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  document.addEventListener("visibilitychange", onVisibility);
  resizeObserver.observe(canvas);
  if (textBlock) resizeObserver.observe(textBlock);
  observeVisibility();
  const listeners: [EventTarget, string, EventListener, AddEventListenerOptions][] = [
    [window, "scroll", onScroll, { passive: true }],
    [window, "pointerdown", onPointerDown as EventListener, { passive: false }],
    [window, "pointermove", onPointerMove as EventListener, { passive: true }],
    [window, "pointerup", onPointerUp as EventListener, { passive: true }],
    [window, "blur", onPointerLeave, { passive: true }],
    [document.documentElement, "pointerleave", onPointerLeave, { passive: true }],
    [hero, "touchstart", onTouchStart as EventListener, { passive: false }],
    [hero, "touchmove", onTouchMove as EventListener, { passive: false }],
    [hero, "touchend", onTouchEnd as EventListener, { passive: true }],
    [hero, "touchcancel", onTouchEnd as EventListener, { passive: true }],
  ];
  for (const [target, type, listener, opts] of listeners) target.addEventListener(type, listener, opts);

  measureHero();
  startCompile();
  wake();

  return {
    travelTo,
    dispose() {
      cancelAnimationFrame(raf);
      raf = 0;
      clearTimeout(ambientTimer);
      ambientTimer = 0;
      phase = "failed";
      resizeObserver.disconnect();
      visibilityObserver?.disconnect();
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const [target, type, listener] of listeners) target.removeEventListener(type, listener);
      delete hero.dataset.brushing;
      tones.reset();
      releaseTargets();
      releaseCellTable();
      if (inFlight) gl.deleteSync(inFlight);
      inFlight = null;
    },
  };
}
