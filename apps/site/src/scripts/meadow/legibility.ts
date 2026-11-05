import type { Program } from "./gl";

export type Tone = "light" | "dark";

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Group {
  readonly name: string;
  readonly large: boolean;
  readonly toned: HTMLElement[];
  readonly read: () => HTMLElement[];
  boxes: Box[];
  tone: Tone;
  darkest: number;
  brightest: number;
  halo: number;
  shownHalo: string;
  changedAt: number;
}

const INK_LUMINANCE = 0.0068;
const NIGHT_INK_LUMINANCE = 0.8;
const TONE_HYSTERESIS = 1.12;
const SAMPLE_PAD = 4;
const PROBE_WIDTH = 96;
const READABLE_FLOOR = 0.3;
const READABLE_CEILING = 0.1;
const LARGE_FLOOR = 0.14;
const LARGE_CEILING = 0.2;
const PAPER_LUMINANCE = 0.84;
const HALO_COVERAGE = 0.26;
const HALO_STEP = 0.05;
const EASE_SECONDS = 0.5;
const TONE_DWELL_MS = 2500;
const MAX_HALO = 1;

const SRGB_TO_LINEAR = Float32Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

const visible = (element: HTMLElement | null): element is HTMLElement => !!element?.offsetParent && element.offsetWidth > 0;

export class TextTones {
  private readonly groups: Group[];
  private readonly header: Group;
  private readonly all: Group[];
  private decided = false;
  private readonly samples: number[] = [];

  constructor(
    private readonly hero: HTMLElement,
    private readonly bar: HTMLElement | null,
    private readonly onHeaderTone: (tone: Tone) => void,
  ) {
    const one = (selector: string) => hero.querySelector<HTMLElement>(selector);
    const all = (selector: string) => [...hero.querySelectorAll<HTMLElement>(selector)];
    const group = (name: string, toned: (HTMLElement | null)[], read: () => (HTMLElement | null)[], large = false): Group => ({
      name,
      large,
      toned: toned.filter((element): element is HTMLElement => !!element),
      read: () => read().filter(visible),
      boxes: [],
      tone: "light",
      darkest: 1,
      brightest: 0,
      halo: 0,
      shownHalo: "",
      changedAt: -Infinity,
    });
    const sendPanel = one("[data-send-panel]")?.parentElement ?? null;
    this.groups = [
      group("title", [one(".hero-title")], () => all(".hero-title .line > span"), true),
      group("lede", [one(".lede"), one(".welcome")], () => [one(".lede"), one(".welcome")]),
      group("cta", [one(".cta-row")], () => [one(".cta-row .source")]),
      group("send", [sendPanel], () => [one(".send-more")]),
      group("note", [one(".note")], () => [one(".note")]),
    ];
    this.header = group("header", bar ? [bar] : [], () => (bar ? [...bar.querySelectorAll<HTMLElement>(".mark, .links, .menu-btn")] : []));
    this.all = [...this.groups, this.header];
  }

  measure(heroDocTop: number) {
    const hero = this.hero;
    const heroRect = hero.getBoundingClientRect();
    const range = document.createRange();
    const inkExtent = (element: HTMLElement, fallback: Box): Box => {
      range.selectNodeContents(element);
      let left = Infinity;
      let right = -Infinity;
      for (const rect of range.getClientRects()) {
        if (rect.width < 1) continue;
        left = Math.min(left, rect.left - heroRect.left);
        right = Math.max(right, rect.right - heroRect.left);
      }
      return Number.isFinite(left) ? { left, top: fallback.top, right, bottom: fallback.bottom } : fallback;
    };
    const offsetBox = (element: HTMLElement): Box => {
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
    for (const group of this.groups) group.boxes = group.read().map((element) => inkExtent(element, offsetBox(element)));
    const barRect = this.bar?.getBoundingClientRect();
    this.header.boxes = barRect
      ? this.header.read().map((element) => {
          const rect = element.getBoundingClientRect();
          const top = rect.top - barRect.top - heroDocTop;
          return { left: rect.left - barRect.left, top, right: rect.right - barRect.left, bottom: top + rect.height };
        })
      : [];
  }

  fallback(tone: Tone) {
    if (this.decided) return;
    for (const group of this.all) this.apply(group, tone);
  }

  decide(pixels: Uint8Array, width: number, height: number, cssWidth: number, cssHeight: number) {
    this.decided = true;
    for (const group of this.all) {
      if (!this.measureGroup(group, pixels, width, height, cssWidth, cssHeight)) continue;
      const darkText = (group.darkest + 0.05) / (INK_LUMINANCE + 0.05);
      const lightText = (NIGHT_INK_LUMINANCE + 0.05) / (group.brightest + 0.05);
      const preferred: Tone = darkText >= lightText ? "light" : "dark";
      const margin = preferred === "light" ? darkText / lightText : lightText / darkText;
      const settled = performance.now() - group.changedAt > TONE_DWELL_MS;
      if (preferred !== group.tone && margin > TONE_HYSTERESIS && settled) this.apply(group, preferred);
    }
  }

  ease(dt: number) {
    const follow = 1 - Math.exp(-dt / EASE_SECONDS);
    for (const group of this.all) {
      const target = this.decided ? this.haloFor(group) : 0;
      group.halo += (target - group.halo) * follow;
      const shown = (Math.round(group.halo / HALO_STEP) * HALO_STEP).toFixed(2);
      if (shown === group.shownHalo) continue;
      group.shownHalo = shown;
      for (const element of group.toned) element.style.setProperty("--halo", shown);
    }
  }

  private haloFor(group: Group) {
    const needed =
      group.tone === "light"
        ? ((group.large ? LARGE_FLOOR : READABLE_FLOOR) - group.darkest) / (PAPER_LUMINANCE - group.darkest)
        : (group.brightest - (group.large ? LARGE_CEILING : READABLE_CEILING)) / Math.max(group.brightest - INK_LUMINANCE, 1e-3);
    return Math.min(MAX_HALO, Math.max(0, needed / HALO_COVERAGE));
  }

  shadeAt(x: number, y: number, reach: number) {
    let nearest = Infinity;
    for (const group of this.all) {
      for (const box of group.boxes) {
        const dx = Math.max(box.left - x, 0, x - box.right);
        const dy = Math.max(box.top - y, 0, y - box.bottom);
        nearest = Math.min(nearest, Math.hypot(dx, dy));
      }
    }
    return Math.min(1, 0.15 + (0.85 * nearest) / reach);
  }

  private measureGroup(group: Group, pixels: Uint8Array, width: number, height: number, cssWidth: number, cssHeight: number) {
    const samples = this.samples;
    samples.length = 0;
    for (const box of group.boxes) {
      const x0 = Math.max(0, Math.floor(((box.left - SAMPLE_PAD) / cssWidth) * width));
      const x1 = Math.min(width - 1, Math.ceil(((box.right + SAMPLE_PAD) / cssWidth) * width));
      const y0 = Math.max(0, Math.floor((1 - (box.bottom + SAMPLE_PAD) / cssHeight) * height));
      const y1 = Math.min(height - 1, Math.ceil((1 - (box.top - SAMPLE_PAD) / cssHeight) * height));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (y * width + x) * 4;
          samples.push(0.2126 * SRGB_TO_LINEAR[pixels[i]] + 0.7152 * SRGB_TO_LINEAR[pixels[i + 1]] + 0.0722 * SRGB_TO_LINEAR[pixels[i + 2]]);
        }
      }
    }
    if (samples.length < 2) return false;
    samples.sort((a, b) => a - b);
    group.darkest = samples[Math.floor(samples.length * 0.06)];
    group.brightest = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.94))];
    return true;
  }

  private apply(group: Group, tone: Tone) {
    if (group === this.header) {
      if (group.tone !== tone) {
        this.onHeaderTone(tone);
        if (this.decided) group.changedAt = performance.now();
      }
      group.tone = tone;
      return;
    }
    if (group.tone === tone && group.toned.every((element) => element.dataset.tone === tone)) return;
    if (group.tone !== tone && this.decided) group.changedAt = performance.now();
    group.tone = tone;
    for (const element of group.toned) element.dataset.tone = tone;
  }

  reset() {
    for (const group of this.all) {
      for (const element of group.toned) {
        delete element.dataset.tone;
        element.style.removeProperty("--halo");
      }
    }
  }
}

export class ColorProbe {
  readonly width = PROBE_WIDTH;
  readonly height: number;
  readonly pixels: Uint8Array;
  private readonly texture: WebGLTexture;
  private readonly framebuffer: WebGLFramebuffer;
  private buffer: WebGLBuffer | null = null;
  private readonly halfWidth: number;
  private readonly halfHeight: number;
  private sync: WebGLSync | null = null;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly program: Program,
    sourceWidth: number,
    sourceHeight: number,
  ) {
    this.height = Math.max(8, Math.round((PROBE_WIDTH * sourceHeight) / sourceWidth));
    this.halfWidth = Math.max(this.width, Math.round(sourceWidth / 4));
    this.halfHeight = Math.max(this.height, Math.round(sourceHeight / 4));
    this.pixels = new Uint8Array(this.width * this.height * 4);
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, this.width, this.height);
    this.framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  get pending() {
    return this.sync !== null;
  }

  capture(source: WebGLTexture) {
    const gl = this.gl;
    if (this.sync) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source);
    this.program.use().int("uSource", 0).vec2("uHalfSize", this.halfWidth, this.halfHeight).vec2("uProbeSize", this.width, this.height);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, this.pixels.byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }

  colorAt(x: number, y: number, radius: number, cssWidth: number, cssHeight: number, warmest = false) {
    const cx = (x / cssWidth) * this.width - 0.5;
    const cy = (1 - y / cssHeight) * this.height - 0.5;
    const reach = Math.max(1, Math.round((radius / cssWidth) * this.width));
    let best: [number, number, number] | null = null;
    for (let py = Math.round(cy) - reach; py <= Math.round(cy) + reach; py++) {
      for (let px = Math.round(cx) - reach; px <= Math.round(cx) + reach; px++) {
        if (px < 0 || py < 0 || px >= this.width || py >= this.height || Math.hypot(px - cx, py - cy) > reach + 0.5) continue;
        const i = (py * this.width + px) * 4;
        const pixel: [number, number, number] = [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2]];
        const score = warmest ? pixel[0] - pixel[2] : pixel[0] + pixel[1];
        if (!best || score > (warmest ? best[0] - best[2] : best[0] + best[1])) best = pixel;
      }
    }
    return best;
  }

  poll() {
    const gl = this.gl;
    if (!this.sync || gl.getSyncParameter(this.sync, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
    gl.deleteSync(this.sync);
    this.sync = null;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.buffer);
    gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.pixels);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.deleteBuffer(this.buffer);
    this.buffer = null;
    return true;
  }

  dispose() {
    const gl = this.gl;
    if (this.sync) gl.deleteSync(this.sync);
    this.sync = null;
    gl.deleteTexture(this.texture);
    gl.deleteFramebuffer(this.framebuffer);
    gl.deleteBuffer(this.buffer);
    this.buffer = null;
  }
}
