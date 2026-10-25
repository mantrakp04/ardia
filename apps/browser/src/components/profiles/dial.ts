import { rubberBand } from "../layout/swipeMotion";
import { CYLINDER_PITCH, CYLINDER_RADIUS } from "./cylinder";

export const PROFILE_SWITCHER_HEIGHT = 52;
export const DIAL_PITCH = CYLINDER_PITCH;
export const DIAL_RADIUS = CYLINDER_RADIUS;
export const DIAL_BAND = 26;
export const DIAL_BAND_TOP = 18;
export const DIAL_FACE_REACH = 6;
export const DIAL_GLYPH_BOX = 24;
export const DIAL_GLYPH_Y = DIAL_GLYPH_BOX / 2;
export const DIAL_GLYPH_SIZE = 12;
export const DIAL_MAGNIFY = 0.8;
export const DIAL_MAGNIFY_SPREAD = 0.65;
export const DIAL_GLYPH_PILL = 22;
export const DIAL_MIN_ROOM = 150;
export const DIAL_NAME_TOP = 0;
export const DIAL_NAME_HEIGHT = 16;

const roundSlot = (value: number) => (value < 0 ? -Math.round(-value) : Math.round(value));

export function dialIndexAt(dx: number, index: number, count: number, pitch = DIAL_PITCH) {
  return Math.max(0, Math.min(count - 1, index - roundSlot(dx / pitch)));
}

export function dialDrag(dx: number, index: number, count: number, pitch = DIAL_PITCH) {
  const left = index * pitch;
  const right = (count - 1 - index) * pitch;
  if (dx > left) return left + rubberBand(dx - left, 0, pitch * 2);
  if (dx < -right) return -right - rubberBand(-right - dx, 0, pitch * 2);
  return dx;
}

export function moveTo(ids: string[], id: string, to: number) {
  const from = ids.indexOf(id);
  if (from < 0) return ids;
  const target = Math.max(0, Math.min(ids.length - 1, to));
  if (target === from) return ids;
  const next = ids.slice();
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}

export function reorderTarget(from: number, dx: number, count: number, pitch = DIAL_PITCH) {
  return Math.max(0, Math.min(count - 1, from + roundSlot(dx / pitch)));
}
