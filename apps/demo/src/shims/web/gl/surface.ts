import { fullscreenVertex } from "./sources";

export type UniformValue = number | boolean | ArrayLike<number>;
export type Uniforms = Record<string, UniformValue>;

const METAL_LAYER_COLOR_SPACE: PredefinedColorSpace = "srgb";

type Program = { program: WebGLProgram; uniforms: Map<string, { location: WebGLUniformLocation; type: number }> };

type WarmContext = { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext; programs: Map<string, Program> };

const warm: WarmContext[] = [];

function createContext(canvas: HTMLCanvasElement, preserveDrawingBuffer: boolean) {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer,
    powerPreference: "low-power",
  });
  if (gl && "drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = METAL_LAYER_COLOR_SPACE;
  return gl;
}

function parkNewContext(): WarmContext | null {
  const canvas = document.createElement("canvas");
  const gl = createContext(canvas, false);
  if (!gl) return null;
  const slot = { canvas, gl, programs: new Map<string, Program>() };
  warm.push(slot);
  return slot;
}

function takeWarm(fragment: string): WarmContext | null {
  const live = warm.filter((slot) => !slot.gl.isContextLost());
  warm.length = 0;
  warm.push(...live);
  const index = warm.findIndex((slot) => slot.programs.has(fragment));
  const pick = index >= 0 ? index : warm.findIndex((slot) => slot.programs.size === 0);
  return pick >= 0 ? (warm.splice(pick, 1)[0] ?? null) : null;
}

export const webgl2Supported = (() => {
  let cached: boolean | undefined;
  return () => {
    if (cached === undefined) {
      try {
        cached = typeof document !== "undefined" && (warm.length > 0 || !!parkNewContext());
      } catch {
        cached = false;
      }
    }
    return cached;
  };
})();

export function prewarmSurfaces(fragments: string[]) {
  if (!webgl2Supported()) return;
  for (const fragment of fragments) {
    if (warm.some((slot) => slot.programs.has(fragment))) continue;
    const slot = warm.find((candidate) => candidate.programs.size === 0 && !candidate.gl.isContextLost()) ?? parkNewContext();
    if (!slot) return;
    slot.programs.set(fragment, compile(slot.gl, fragment));
  }
}

function compile(gl: WebGL2RenderingContext, fragment: string): Program {
  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(`[ardia shaders] ${gl.getShaderInfoLog(s)}`);
    return s;
  };
  const program = gl.createProgram()!;
  const vs = shader(gl.VERTEX_SHADER, fullscreenVertex);
  const fs = shader(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(`[ardia shaders] ${gl.getProgramInfoLog(program)}`);
  const uniforms = new Map<string, { location: WebGLUniformLocation; type: number }>();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const name = info.name.replace(/\[0\]$/, "");
    const location = gl.getUniformLocation(program, info.name);
    if (location) uniforms.set(name, { location, type: info.type });
  }
  return { program, uniforms };
}

function setUniform(gl: WebGL2RenderingContext, type: number, location: WebGLUniformLocation, value: UniformValue) {
  const list = typeof value === "number" || typeof value === "boolean" ? [Number(value)] : Array.from(value);
  switch (type) {
    case gl.FLOAT: return gl.uniform1fv(location, list);
    case gl.FLOAT_VEC2: return gl.uniform2fv(location, list);
    case gl.FLOAT_VEC4: return gl.uniform4fv(location, list);
    case gl.INT: case gl.BOOL: return gl.uniform1iv(location, list.map(Math.trunc));
    default: throw new Error(`[ardia shaders] unsupported uniform type ${type}`);
  }
}

export class GLSurface {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: Program | null = null;
  private lost = false;

  constructor(private readonly fragment: string, private readonly onRestore: () => void, options: { preserveDrawingBuffer?: boolean } = {}) {
    const preserve = options.preserveDrawingBuffer ?? false;
    const slot = preserve ? null : takeWarm(fragment);
    this.canvas = slot?.canvas ?? document.createElement("canvas");
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.program = null;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.setUp();
      this.onRestore();
    });
    this.gl = slot?.gl ?? createContext(this.canvas, preserve);
    this.setUp(slot?.programs.get(this.fragment));
  }

  get ok() {
    return !!this.gl && !!this.program && !this.lost;
  }

  get context() {
    return this.gl;
  }

  private setUp(compiled?: Program) {
    const gl = this.gl;
    if (!gl) return;
    this.program = compiled ?? compile(gl, this.fragment);
    gl.disable(gl.BLEND);
    gl.disable(gl.DITHER);
  }

  resize(pixelWidth: number, pixelHeight: number) {
    const w = Math.max(1, pixelWidth), h = Math.max(1, pixelHeight);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  draw(uniforms: Uniforms) {
    const gl = this.gl, program = this.program;
    if (!gl || !program || this.lost) return;
    const width = this.canvas.width, height = this.canvas.height;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program.program);
    const all: Uniforms = { ...uniforms, pixelSize: [width, height] };
    for (const [name, value] of Object.entries(all)) {
      const u = program.uniforms.get(name);
      if (u) setUniform(gl, u.type, u.location, value);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  clear() {
    const gl = this.gl;
    if (!gl || this.lost) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  dispose() {
    const gl = this.gl;
    if (gl && this.program && !this.lost) gl.deleteProgram(this.program.program);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
    this.program = null;
  }
}
