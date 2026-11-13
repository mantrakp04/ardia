import { hapticTick } from "../../platform/haptics";
import { useBrowser } from "../browser/store";
import { TAB_CLICK_SLOP } from "../sidebar/heldTabPress";
import { noteProfileSwitcherReorder } from "../telemetry/switcherPresses";

export const switcherDragStarts = (dx: number, dy: number) => Math.hypot(dx, dy) > TAB_CLICK_SLOP;

const leftOf = (widths: number[], i: number) => widths.slice(0, i).reduce((sum, w) => sum + w, 0);
const centreOf = (widths: number[], i: number) => leftOf(widths, i) + widths[i]! / 2;

export function switcherLift(widths: number[], from: number, dx: number): number {
  const left = leftOf(widths, from);
  const room = leftOf(widths, widths.length) - left - widths[from]!;
  return Math.max(0 - left, Math.min(room, dx));
}

export function switcherDropSlot(widths: number[], from: number, dx: number): number {
  const centre = centreOf(widths, from) + switcherLift(widths, from, dx);
  let to = from;
  for (let j = from + 1; j < widths.length && centre >= centreOf(widths, j); j++) to = j;
  for (let j = from - 1; j >= 0 && centre <= centreOf(widths, j); j--) to = j;
  return to;
}

export function switcherShift(widths: number[], from: number, to: number, j: number): number {
  if (from < j && j <= to) return -widths[from]!;
  if (to <= j && j < from) return widths[from]!;
  return 0;
}

export function switcherLanding(widths: number[], from: number, to: number): number {
  return to >= from ? leftOf(widths, to + 1) - leftOf(widths, from + 1) : leftOf(widths, to) - leftOf(widths, from);
}

export function tickSwitcherSlot() {
  if (useBrowser.getState().settings.tabReorderHaptics) hapticTick();
}

export function dropSwitcherProfile(id: string, to: number): boolean {
  const s = useBrowser.getState();
  const from = s.profileOrder.indexOf(id);
  if (from < 0 || from === to) return false;
  const order = s.profileOrder.filter((other) => other !== id);
  order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
  s.reorderProfiles(order);
  noteProfileSwitcherReorder();
  return true;
}
