import { SMALL_BAR_HEIGHT, SMALL_INSET } from "../littleArdia/smallMetrics";

const INSET_FRACTION = 0.055;
const MIN_INSET = 16;

export function peekFrame(width: number, height: number) {
  const x = Math.max(MIN_INSET, Math.round(width * INSET_FRACTION));
  const y = Math.max(MIN_INSET, Math.round(height * INSET_FRACTION));
  return { left: x, top: y, width: Math.max(0, width - 2 * x), height: Math.max(0, height - 2 * y) };
}

export function peekPageRect(width: number, height: number) {
  const frame = peekFrame(width, height);
  return {
    x: frame.left + SMALL_INSET,
    y: frame.top + SMALL_BAR_HEIGHT,
    width: Math.max(0, frame.width - 2 * SMALL_INSET),
    height: Math.max(0, frame.height - SMALL_BAR_HEIGHT - SMALL_INSET),
  };
}
