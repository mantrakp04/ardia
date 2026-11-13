export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type Corner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export type PlayerFrame = { corner: Corner; dx: number; dy: number; width: number };
export type Handle = { x: -1 | 0 | 1; y: -1 | 0 | 1 };

export const PLAYER_INSET = 10;
export const PLAYER_MIN_WIDTH = 200;
export const PLAYER_DEFAULT_WIDTH = { fraction: 0.28, min: 240, max: 480 };
export const PLAYER_RADIUS = 6;
export const FLING_SPEED = 350;
export const FLING_ANGLE = Math.PI / 4;
export const SPRING = { response: 0.9, damping: 0.9, settle: 0.2 };
export const CORNERS: readonly Corner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const aspectOf = (width: number, height: number) => (width > 0 && height > 0 ? width / height : 16 / 9);

export function defaultWidth(area: Rect) {
  return clamp(Math.round(area.width * PLAYER_DEFAULT_WIDTH.fraction), PLAYER_DEFAULT_WIDTH.min, PLAYER_DEFAULT_WIDTH.max);
}

export function sizeFor(width: number, aspect: number, area: Rect) {
  const maxWidth = Math.max(1, area.width - 2 * PLAYER_INSET);
  const maxHeight = Math.max(1, area.height - 2 * PLAYER_INSET);
  let fitted = clamp(width, Math.min(PLAYER_MIN_WIDTH, maxWidth), maxWidth);
  let height = fitted / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    fitted = height * aspect;
  }
  return { width: Math.round(fitted), height: Math.round(height) };
}

export function clampInto(rect: Rect, area: Rect, inset = PLAYER_INSET): Rect {
  const minX = area.x + inset;
  const minY = area.y + inset;
  const maxX = Math.max(minX, area.x + area.width - inset - rect.width);
  const maxY = Math.max(minY, area.y + area.height - inset - rect.height);
  return { x: Math.round(clamp(rect.x, minX, maxX)), y: Math.round(clamp(rect.y, minY, maxY)), width: rect.width, height: rect.height };
}

export function cornerRect(corner: Corner, size: { width: number; height: number }, area: Rect): Rect {
  const x = corner.endsWith("Left") ? area.x + PLAYER_INSET : area.x + area.width - PLAYER_INSET - size.width;
  const y = corner.startsWith("top") ? area.y + PLAYER_INSET : area.y + area.height - PLAYER_INSET - size.height;
  return clampInto({ x, y, width: size.width, height: size.height }, area);
}

export function placeFrame(frame: PlayerFrame | null, area: Rect, aspect: number): Rect {
  const chosen = frame ?? { corner: "bottomRight", dx: PLAYER_INSET, dy: PLAYER_INSET, width: defaultWidth(area) };
  const size = sizeFor(chosen.width, aspect, area);
  const x = chosen.corner.endsWith("Left") ? area.x + chosen.dx : area.x + area.width - chosen.dx - size.width;
  const y = chosen.corner.startsWith("top") ? area.y + chosen.dy : area.y + area.height - chosen.dy - size.height;
  return clampInto({ x, y, ...size }, area);
}

export function frameOf(rect: Rect, area: Rect): PlayerFrame {
  const left = rect.x + rect.width / 2 < area.x + area.width / 2;
  const top = rect.y + rect.height / 2 < area.y + area.height / 2;
  const corner: Corner = top ? (left ? "topLeft" : "topRight") : left ? "bottomLeft" : "bottomRight";
  const dx = left ? rect.x - area.x : area.x + area.width - rect.x - rect.width;
  const dy = top ? rect.y - area.y : area.y + area.height - rect.y - rect.height;
  return { corner, dx: Math.round(dx), dy: Math.round(dy), width: Math.round(rect.width) };
}

export function parseFrame(text: string | null | undefined): PlayerFrame | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as Partial<PlayerFrame>;
    const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
    if (!value || !CORNERS.includes(value.corner as Corner) || !finite(value.dx) || !finite(value.dy) || !finite(value.width) || value.width <= 0) return null;
    return { corner: value.corner as Corner, dx: Math.max(0, value.dx), dy: Math.max(0, value.dy), width: value.width };
  } catch {
    return null;
  }
}

const areaCorner = (corner: Corner, area: Rect): Point => ({
  x: corner.endsWith("Left") ? area.x : area.x + area.width,
  y: corner.startsWith("top") ? area.y : area.y + area.height,
});

const angleBetween = (a: number, b: number) => {
  const diff = Math.abs(a - b) % (2 * Math.PI);
  return diff > Math.PI ? 2 * Math.PI - diff : diff;
};

export function flingTarget(rect: Rect, pointer: Point, velocity: Point, area: Rect): Rect | null {
  if (Math.hypot(velocity.x, velocity.y) <= FLING_SPEED) return null;
  const heading = Math.atan2(velocity.y, velocity.x);
  let best: { corner: Corner; off: number } | null = null;
  for (const corner of CORNERS) {
    const target = areaCorner(corner, area);
    const off = angleBetween(heading, Math.atan2(target.y - pointer.y, target.x - pointer.x));
    if (off <= FLING_ANGLE && (!best || off < best.off)) best = { corner, off };
  }
  return best ? cornerRect(best.corner, rect, area) : null;
}

export type SpringAxis = { position: number; velocity: number };

export function springStep(axis: SpringAxis, target: number, seconds: number): SpringAxis {
  const stiffness = (2 * Math.PI / SPRING.response) ** 2;
  const damping = (4 * Math.PI * SPRING.damping) / SPRING.response;
  let { position, velocity } = axis;
  const steps = Math.max(1, Math.ceil(seconds / 0.004));
  const dt = seconds / steps;
  for (let i = 0; i < steps; i++) {
    velocity += (-stiffness * (position - target) - damping * velocity) * dt;
    position += velocity * dt;
  }
  return { position, velocity };
}

export const springSettled = (axis: SpringAxis, target: number) => Math.abs(axis.position - target) < SPRING.settle && Math.abs(axis.velocity) < SPRING.settle * 10;

export function resizeFrom(start: Rect, handle: Handle, delta: Point, aspect: number, area: Rect): Rect {
  const fromX = start.width + handle.x * delta.x;
  const fromY = (start.height + handle.y * delta.y) * aspect;
  const proposed = handle.x === 0 ? fromY : handle.y === 0 ? fromX : Math.abs(fromX - start.width) >= Math.abs(fromY - start.width) ? fromX : fromY;
  const size = sizeFor(proposed, aspect, area);
  const x = handle.x < 0 ? start.x + start.width - size.width : handle.x > 0 ? start.x : start.x + (start.width - size.width) / 2;
  const y = handle.y < 0 ? start.y + start.height - size.height : handle.y > 0 ? start.y : start.y + (start.height - size.height) / 2;
  return clampInto({ x, y, ...size }, area);
}

export function handleAt(point: Point, rect: Rect, edge = 8): Handle | null {
  const inside = point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
  if (!inside) return null;
  const x = point.x - rect.x < edge ? -1 : rect.x + rect.width - point.x < edge ? 1 : 0;
  const y = point.y - rect.y < edge ? -1 : rect.y + rect.height - point.y < edge ? 1 : 0;
  return x || y ? { x, y } : null;
}

export const outside = (point: Point, viewport: { width: number; height: number }) => point.x < 0 || point.y < 0 || point.x >= viewport.width || point.y >= viewport.height;

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
