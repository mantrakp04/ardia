export const PAGER = {
  rubberLimit: 60,
  parallax: 0.3,
  recededScale: 0.92,
  recededDim: 0.32,
  edgeScale: 0.03,
  projectionTime: 0.12,
  commitFraction: 0.5,
  opposingVelocity: 240,
  maxVelocity: 4000,
  minimumDistance: 14,
} as const;

export function rubberBand(distance: number, limit: number = PAGER.rubberLimit): number {
  "worklet";
  const magnitude = Math.abs(distance);
  const banded = limit * (1 - 1 / (magnitude / limit + 1));
  return distance < 0 ? -banded : banded;
}

export function resolvedOffset(raw: number, hasLeft: boolean, hasRight: boolean, width: number): number {
  "worklet";
  if (raw > 0) return hasLeft ? Math.min(raw, width) : rubberBand(raw);
  if (raw < 0) return hasRight ? Math.max(raw, -width) : rubberBand(raw);
  return 0;
}

export function snapTarget(offset: number, velocity: number, width: number, hasLeft: boolean, hasRight: boolean): number {
  "worklet";
  if (width <= 0) return 0;
  const projected = offset + velocity * PAGER.projectionTime;
  if (hasLeft && projected > width * PAGER.commitFraction && velocity > -PAGER.opposingVelocity) return 1;
  if (hasRight && projected < -width * PAGER.commitFraction && velocity < PAGER.opposingVelocity) return -1;
  return 0;
}

export function pagerSide(offset: number, hasLeft: boolean, hasRight: boolean): number {
  "worklet";
  if (offset > 0 && hasLeft) return -1;
  if (offset < 0 && hasRight) return 1;
  return 0;
}

const progressOf = (offset: number, width: number) => {
  "worklet";
  return width <= 0 ? 0 : Math.min(Math.abs(offset) / width, 1);
};

export function outgoingPose(offset: number, width: number, hasLeft: boolean, hasRight: boolean) {
  "worklet";
  if (width <= 0) return { x: 0, scale: 1, dim: 0 };
  if (pagerSide(offset, hasLeft, hasRight) === 0) {
    const pull = Math.min(Math.abs(offset) / PAGER.rubberLimit, 1);
    return { x: offset, scale: 1 - PAGER.edgeScale * pull, dim: 0 };
  }
  const progress = progressOf(offset, width);
  return { x: offset * PAGER.parallax, scale: 1 - (1 - PAGER.recededScale) * progress, dim: PAGER.recededDim * progress };
}

export function incomingPose(cardSide: number, offset: number, width: number, hasLeft: boolean, hasRight: boolean) {
  "worklet";
  if (width <= 0 || pagerSide(offset, hasLeft, hasRight) !== cardSide) return { x: cardSide * width, opacity: 0, shadow: 0 };
  return { x: cardSide * width + offset, opacity: 1, shadow: 1 - progressOf(offset, width) };
}

export function neighbours(order: readonly string[], current: string | null): { left: string | null; right: string | null } {
  const index = current === null ? -1 : order.indexOf(current);
  if (index < 0) return { left: null, right: null };
  return { left: order[index - 1] ?? null, right: order[index + 1] ?? null };
}
