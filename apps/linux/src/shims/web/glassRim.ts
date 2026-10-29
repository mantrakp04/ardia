const CORNER_FIT: { radius: number; scale: number; k: number; round: number }[] = [
  { radius: 8, scale: 1.3414, k: 1.4255, round: 1.07 },
  { radius: 10, scale: 1.2233, k: 1.3213, round: 1.035 },
];

export function cornerFit(radius: number, superellipse = sliceMasks) {
  const [a, b] = CORNER_FIT as [(typeof CORNER_FIT)[0], (typeof CORNER_FIT)[0]];
  const f = Math.max(0, Math.min(1, (radius - a.radius) / (b.radius - a.radius)));
  const mix = (x: number, y: number) => x + (y - x) * f;
  const scale = superellipse ? mix(a.scale, b.scale) : mix(a.round, b.round);
  return { R: radius * scale, scale, exponent: superellipse ? 2 ** mix(a.k, b.k) : 2 };
}

export type RimCurve = [number, number][];

export type RimProfile = {
  angles: number[];
  depths: number[];
  gains: number[][];
  glow: RimCurve;
  glowByAngle: RimCurve;
};

export type ShadeProfile = {
  line: RimCurve;
  byAngle: RimCurve;
};

const MASK_SCALE = 4;
const STRAIGHT_RAMP = 2.5;
const MIDDLE = 1;

export const sliceMasks = typeof CSS !== "undefined" && !!CSS.supports?.("-webkit-mask-box-image", "none");

export function fallbackRadius(radius: number) {
  return radius * cornerFit(radius, false).scale;
}

function interpolate(curve: RimCurve, x: number) {
  if (x <= curve[0]![0]) return curve[0]![1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]!;
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]!;
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return curve[curve.length - 1]![1];
}

type Corner = { R: number; exponent: number };
type Boundary = { x: Float64Array; y: Float64Array; angle: Float64Array };

function quadrantBoundary({ R, exponent }: Corner, extent: number): Boundary {
  const curve = 720;
  const straight = Math.max(2, Math.ceil((extent - R) * MASK_SCALE * 2));
  const n = curve + 2 * straight;
  const b: Boundary = { x: new Float64Array(n), y: new Float64Array(n), angle: new Float64Array(n) };
  let k = 0;
  const push = (x: number, y: number, nx: number, ny: number, angle?: number) => {
    b.x[k] = x;
    b.y[k] = y;
    b.angle[k] = angle ?? Math.max(1, Math.min(89, (Math.atan2(Math.abs(nx), Math.abs(ny)) * 180) / Math.PI));
    k++;
  };
  const ramp = (along: number) => Math.max(0, 1 - along / STRAIGHT_RAMP);
  for (let i = 0; i < straight; i++) {
    const along = ((extent - R) * i) / (straight - 1);
    push(R + along, 0, 0, 1, ramp(along));
  }
  for (let i = 0; i < curve; i++) {
    const t = ((i + 0.5) / curve) * (Math.PI / 2);
    const c = Math.cos(t);
    const s = Math.sin(t);
    const u = c ** (2 / exponent);
    const v = s ** (2 / exponent);
    const du = (-2 / exponent) * c ** (2 / exponent - 1) * s;
    const dv = (2 / exponent) * s ** (2 / exponent - 1) * c;
    push(R - R * u, R - R * v, -R * dv, R * du);
  }
  for (let i = 0; i < straight; i++) {
    const along = ((extent - R) * i) / (straight - 1);
    push(0, R + along, 1, 0, 90 - ramp(along));
  }
  return b;
}

function insideQuadrant(x: number, y: number, { R, exponent }: Corner) {
  if (x < 0 || y < 0) return false;
  if (x >= R || y >= R) return true;
  return ((R - x) / R) ** exponent + ((R - y) / R) ** exponent <= 1;
}

export type SliceMask = { image: string; slice: number; width: number };

const masks = new Map<string, SliceMask | null>();

const COVERAGE_SAMPLES = 4;

function coverage(x: number, y: number, corner: Corner) {
  let inside = 0;
  const step = 1 / MASK_SCALE / COVERAGE_SAMPLES;
  for (let j = 0; j < COVERAGE_SAMPLES; j++)
    for (let i = 0; i < COVERAGE_SAMPLES; i++) if (insideQuadrant(x + (i + 0.5) * step - 0.5 / MASK_SCALE, y + (j + 0.5) * step - 0.5 / MASK_SCALE, corner)) inside++;
  return inside / (COVERAGE_SAMPLES * COVERAGE_SAMPLES);
}

function sliceMask(key: string, cornerRadius: number, extent: number, inset: number, alphaAt: (inward: number, angle: number, covered: number, y: number) => number): SliceMask | null {
  const cached = masks.get(key);
  if (cached !== undefined) return cached;
  if (!sliceMasks || typeof document === "undefined") {
    masks.set(key, null);
    return null;
  }
  const C = Math.ceil(extent);
  const sizeCss = 2 * C + MIDDLE;
  const size = sizeCss * MASK_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    masks.set(key, null);
    return null;
  }
  const corner = cornerFit(cornerRadius);
  const boundary = quadrantBoundary(corner, C + MIDDLE - inset);
  const quadrant = C * MASK_SCALE + (MIDDLE * MASK_SCALE) / 2;
  const values = new Float32Array(quadrant * quadrant);
  for (let py = 0; py < quadrant; py++) {
    for (let px = 0; px < quadrant; px++) {
      const x = (px + 0.5) / MASK_SCALE - inset;
      const y = (py + 0.5) / MASK_SCALE - inset;
      let best = Infinity;
      let index = 0;
      for (let i = 0; i < boundary.x.length; i++) {
        const dx = x - boundary.x[i]!;
        const dy = y - boundary.y[i]!;
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          index = i;
        }
      }
      const distance = Math.sqrt(best);
      const inward = insideQuadrant(x, y, corner) ? distance : -distance;
      values[py * quadrant + px] = Math.max(0, Math.min(1, alphaAt(inward, boundary.angle[index]!, coverage(x, y, corner), y)));
    }
  }
  const image = context.createImageData(size, size);
  for (let py = 0; py < size; py++) {
    const qy = py < size / 2 ? py : size - 1 - py;
    for (let px = 0; px < size; px++) {
      const qx = px < size / 2 ? px : size - 1 - px;
      const v = values[Math.min(qy, quadrant - 1) * quadrant + Math.min(qx, quadrant - 1)]!;
      const o = (py * size + px) * 4;
      image.data[o + 3] = Math.round(v * 255);
    }
  }
  context.putImageData(image, 0, 0);
  const mask = { image: canvas.toDataURL("image/png"), slice: C * MASK_SCALE, width: C };
  masks.set(key, mask);
  return mask;
}

function rimGain(profile: RimProfile, inward: number, angle: number) {
  const rows = profile.angles.map((a, i) => [a, interpolate(profile.depths.map((d, j) => [d, profile.gains[i]![j]!] as [number, number]), inward)] as [number, number]);
  return interpolate(rows, angle);
}

export function edgeGain(profile: RimProfile, inward: number) {
  return rimGain(profile, inward, 0) + interpolate(profile.glow, inward);
}

export function peakGain(profile: RimProfile) {
  return edgeGain(profile, 0);
}

export function highlightMask(cornerRadius: number, profile: RimProfile, key: string) {
  const reach = profile.glow[profile.glow.length - 1]![0];
  const extent = Math.max(cornerFit(cornerRadius).R + 2, reach);
  const peak = peakGain(profile);
  return sliceMask(`h|${key}|${cornerRadius}|${sliceMasks}`, cornerRadius, extent, 0, (inward, angle, covered, y) => (covered * (rimGain(profile, Math.max(0, inward), angle) + interpolate(profile.glowByAngle, angle) * interpolate(profile.glow, Math.max(0, y)))) / peak);
}

export function shapeMask(cornerRadius: number) {
  return sliceMask(`c|${cornerRadius}|${sliceMasks}`, cornerRadius, cornerFit(cornerRadius).R + 1, 0, (_inward, _angle, covered) => covered);
}

export const SHADE_OUTSET = 1;

export function shadeMask(cornerRadius: number, profile: ShadeProfile, key: string) {
  const extent = cornerFit(cornerRadius).R + 2 * SHADE_OUTSET;
  return sliceMask(`s|${key}|${cornerRadius}|${sliceMasks}`, cornerRadius, extent, SHADE_OUTSET, (inward, angle, covered) =>
    inward > 0.5 ? 0 : (1 - covered) * interpolate(profile.byAngle, angle) * interpolate(profile.line, Math.max(0, -inward)),
  );
}

export function maskStyle(mask: SliceMask): Record<string, string> {
  return { WebkitMaskBoxImage: `url(${mask.image}) ${mask.slice} / ${mask.width}px stretch` };
}
