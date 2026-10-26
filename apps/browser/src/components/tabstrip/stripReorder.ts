import { Animated } from "react-native";
import { dragGeometry, type DragGeometry } from "./stripGroups";

export const SLIDE = { stiffness: 8100, damping: 180, mass: 1, restDisplacementThreshold: 0.25, restSpeedThreshold: 2, useNativeDriver: false } as const;

type Slot = { geometry: () => DragGeometry; index: () => number; shift: Animated.Value; to: number };
const slots = new Set<Slot>();

export function registerSlot(geometry: () => DragGeometry, index: () => number, shift: Animated.Value): () => void {
  const slot: Slot = { geometry, index, shift, to: 0 };
  slots.add(slot);
  return () => void slots.delete(slot);
}

export function reorderOffsets({ slots: row, lefts }: DragGeometry, from: number, to: number): number[] {
  const gap = row.length > 1 ? lefts[1]! - lefts[0]! - row[0]!.width - (row[0]!.marginRight ?? 0) - (row[1]!.marginLeft ?? 0) : 0;
  const order = row.map((_, i) => i).filter((i) => i !== from);
  order.splice(to, 0, from);
  const moved = dragGeometry(order.map((i) => row[i]!), gap);
  const out: number[] = [];
  order.forEach((i, k) => (out[i] = moved.lefts[k]! - lefts[i]!));
  return out;
}

export function makeRoom(geometry: DragGeometry, from: number, to: number) {
  const offsets = reorderOffsets(geometry, from, to);
  shiftRoom(geometry, (i) => offsets[i] ?? 0, from);
}

export function shiftRoom(geometry: DragGeometry, offsetOf: (index: number) => number, skip = -1) {
  for (const slot of slots) {
    const i = slot.index();
    if (slot.geometry() !== geometry || i === skip || i < 0) continue;
    const target = offsetOf(i);
    if (slot.to === target) continue;
    slot.to = target;
    Animated.spring(slot.shift, { toValue: target, ...SLIDE }).start();
  }
}

export function settleRoom(geometry: DragGeometry) {
  for (const slot of slots) {
    if (slot.geometry() !== geometry) continue;
    slot.shift.stopAnimation();
    slot.shift.setValue(0);
    slot.to = 0;
  }
}
