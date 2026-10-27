const MAX_PENDING_QUERIES = 4;
const GPU_WINDOW = 16;
const SLOW_GPU_MS = 12;
const TARGET_GPU_MS = 9;
const FAST_GPU_MS = 4.5;
const RISE_AFTER_MS = 4000;
const LARGEST_DROP = 0.6;
const SMALLEST_DROP = 0.92;
const LARGEST_RISE = 1.25;
const MIN_SCALE = 0.5;
const FALLBACK_WINDOW = 40;
const FALLBACK_SLOW_FRAME_MS = 24;
const FALLBACK_CPU_CEILING_MS = 8;
const FALLBACK_DROP = 0.85;
const FALLBACK_MIN_SCALE = 0.6;

interface TimerQuery {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

const isNative = (fn: unknown) => typeof fn === "function" && /\[native code\]\s*\}\s*$/.test(Function.prototype.toString.call(fn));

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
};

export class GpuClock {
  private readonly ext: TimerQuery | null;
  private readonly pending: { query: WebGLQuery; busy: boolean }[] = [];
  private running: { query: WebGLQuery; busy: boolean } | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    const instrumented = !isNative(gl.drawArrays) || !isNative(gl.drawElements) || !isNative(gl.drawArraysInstanced);
    this.ext = instrumented ? null : (gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQuery | null);
  }

  get available() {
    return this.ext !== null;
  }

  start(busy: boolean) {
    const { gl, ext } = this;
    if (!ext || this.running || this.pending.length >= MAX_PENDING_QUERIES) return;
    if (gl.getQuery(ext.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) return;
    const query = gl.createQuery();
    if (!query) return;
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    this.running = { query, busy };
  }

  stop() {
    if (!this.ext || !this.running) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.running);
    this.running = null;
  }

  collect(onSample: (ms: number, busy: boolean) => void) {
    const { gl, ext } = this;
    if (!ext) return;
    while (this.pending.length) {
      const { query, busy } = this.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      this.pending.shift();
      if (!disjoint) onSample(nanoseconds / 1e6, busy);
    }
  }
}

export class Scaler {
  scale = 1;
  private ceiling = 1;
  private samples: number[] = [];
  private frames: number[] = [];
  private cpu: number[] = [];
  private changedAt = 0;
  private lastRose = false;

  gpu(ms: number, now: number) {
    this.samples.push(ms);
    if (this.samples.length < GPU_WINDOW) return false;
    const typical = median(this.samples);
    this.samples.length = 0;
    if (typical > SLOW_GPU_MS && this.scale > MIN_SCALE) {
      const drop = Math.min(SMALLEST_DROP, Math.max(LARGEST_DROP, Math.sqrt(TARGET_GPU_MS / typical)));
      const next = Math.max(MIN_SCALE, this.scale * drop);
      if (this.lastRose) this.ceiling = next;
      return this.change(next, false, now);
    }
    if (typical < FAST_GPU_MS && this.scale < this.ceiling && now - this.changedAt > RISE_AFTER_MS) {
      const rise = Math.min(LARGEST_RISE, Math.sqrt(TARGET_GPU_MS / typical));
      return this.change(Math.min(this.ceiling, this.scale * rise), true, now);
    }
    return false;
  }

  frame(frameMs: number, cpuMs: number, now: number) {
    this.frames.push(frameMs);
    this.cpu.push(cpuMs);
    if (this.frames.length < FALLBACK_WINDOW) return false;
    const slow = median(this.frames) > FALLBACK_SLOW_FRAME_MS && median(this.cpu) < FALLBACK_CPU_CEILING_MS;
    this.frames.length = 0;
    this.cpu.length = 0;
    if (!slow || this.scale <= FALLBACK_MIN_SCALE) return false;
    return this.change(Math.max(FALLBACK_MIN_SCALE, this.scale * FALLBACK_DROP), false, now);
  }

  private change(next: number, rose: boolean, now: number) {
    if (Math.abs(next - this.scale) < 0.01) return false;
    this.scale = next;
    this.lastRose = rose;
    this.changedAt = now;
    this.samples.length = 0;
    this.frames.length = 0;
    this.cpu.length = 0;
    return true;
  }
}
