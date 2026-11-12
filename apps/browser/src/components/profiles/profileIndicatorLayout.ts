const PAD = 9;
const NARROW_PAD = 4;
const MIN_WIDTH = 32;

export function profileIndicatorLayout(room: number, textWidth: number | undefined, eligible: boolean) {
  const shown = eligible && room >= MIN_WIDTH;
  const pad = room < MIN_WIDTH + 2 * PAD ? NARROW_PAD : PAD;
  const width = !shown ? 0 : textWidth ? Math.min(room, textWidth + 2 * pad) : MIN_WIDTH;
  return { shown, pad, width };
}
