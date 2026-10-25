export const CYLINDER_PITCH = 36;
export const CYLINDER_RADIUS = 170;
export const CYLINDER_THETA = CYLINDER_PITCH / CYLINDER_RADIUS;

export type CylinderPoint = { x: number; scale: number; angle: number; opacity: number };

const FADE_START = 1.2;
const FADE_END = 1.45;
const DEFAULT_STEP = 0.25;
const DEGREES = 180 / Math.PI;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

const opacityAt = (angle: number) => clamp01((FADE_END - Math.abs(angle)) / (FADE_END - FADE_START));

const degrees = (angle: number) => `${(angle * DEGREES).toFixed(1)}deg`;

export function cylinderPoint(slot: number, position: number, radius = CYLINDER_RADIUS, pitch = CYLINDER_PITCH): CylinderPoint {
  const angle = (slot - position) * (pitch / radius);
  return {
    x: radius * Math.sin(angle),
    scale: Math.max(0, Math.cos(angle)),
    angle,
    opacity: opacityAt(angle),
  };
}

export function cylinderSamples(slot: number, from: number, to: number, step = DEFAULT_STEP) {
  const span = to - from;
  const size = Number.isFinite(step) && step > 0 ? step : DEFAULT_STEP;
  const direction = span < 0 ? -1 : 1;
  const count = Number.isFinite(span) ? Math.floor(Math.abs(span) / size + 1e-9) + 1 : 0;
  const input: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const position = from + direction * i * size;
    if (direction > 0 ? position >= to : position <= to) break;
    input.push(position);
  }
  input.push(to);
  const dx: number[] = [];
  const angle: string[] = [];
  const opacity: number[] = [];
  for (const position of input) {
    const point = cylinderPoint(slot, position);
    dx.push(point.x);
    angle.push(degrees(point.angle));
    opacity.push(point.opacity);
  }
  return { input, dx, angle, opacity };
}

export function cylinderPosition(index: number, dx: number, pitch = CYLINDER_PITCH) {
  return index - dx / pitch;
}
