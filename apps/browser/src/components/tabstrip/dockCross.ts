import { Animated } from "react-native";
import { dropAt, type Cross, type Dock, type Strip } from "./model";
import { CELL_STEP, type DragGeometry } from "./stripGroups";
import { settleRoom, shiftRoom, SLIDE } from "./stripReorder";
import { DOCK_GAP, GAP, PINNED_CELL } from "./tokens";

const growTargets = new WeakMap<Animated.Value, number>();
function growDock(grow: Animated.Value, to: number) {
  if ((growTargets.get(grow) ?? 0) === to) return;
  growTargets.set(grow, to);
  Animated.spring(grow, { toValue: to, ...SLIDE }).start();
}

function settleStrip({ top, dock, grow }: Strip) {
  settleRoom(top);
  if (dock) settleRoom(dock.geometry);
  grow.stopAnimation();
  grow.setValue(0);
  growTargets.set(grow, 0);
}

const slotStart = ({ slots, lefts }: DragGeometry, k: number) =>
  k < slots.length ? lefts[k]! - (slots[k]!.marginLeft ?? 0) : slots.length ? lefts.at(-1)! + slots.at(-1)!.width + (slots.at(-1)!.marginRight ?? 0) + GAP : 0;

const dockShrink = (dock: Dock) => (dock.ids.length > 1 ? CELL_STEP : PINNED_CELL + DOCK_GAP);

function pinOutIndex({ dock, top }: Strip, from: number, dx: number): number | null {
  if (!dock) return null;
  const left = dock.left + dock.geometry.lefts[from]! + dx;
  if (left < -DOCK_GAP) return null;
  const shrink = dockShrink(dock);
  return top.slots.filter((slot, i) => top.lefts[i]! - shrink + slot.width / 2 < left).length;
}

export function pinOut(strip: () => Strip | null, from: number): Cross {
  return {
    at: (dx) => {
      const s = strip();
      const k = s ? pinOutIndex(s, from, dx) : null;
      if (!s?.dock || k === null) return false;
      const shrink = dockShrink(s.dock);
      shiftRoom(s.dock.geometry, (i) => (i > from ? -CELL_STEP : 0), from);
      shiftRoom(s.top, (i) => -shrink + (i >= k ? s.chip + GAP : 0));
      growDock(s.grow, s.dock.ids.length > 1 ? -CELL_STEP : -PINNED_CELL);
      return true;
    },
    land: (dx, _, ids) => {
      const s = strip();
      const k = s ? pinOutIndex(s, from, dx) : null;
      if (!s?.dock || k === null) return null;
      const target = slotStart(s.top, k) - dockShrink(s.dock);
      return {
        dx: target - (s.dock.left + s.dock.geometry.lefts[from]!),
        commit: () => {
          settleStrip(s);
          dropAt(ids, { zone: "list", beforeId: s.top.slots[k]?.tabIds[0] ?? null });
        },
      };
    },
    clear: () => {
      const s = strip();
      if (!s) return;
      shiftRoom(s.top, () => 0);
      growDock(s.grow, 0);
    },
  };
}

const dockCellLeft = ({ lefts }: DragGeometry, j: number) => (j < lefts.length ? lefts[j]! : (lefts.at(-1) ?? -CELL_STEP) + CELL_STEP);

function tabInIndex({ dock, top }: Strip, from: number, dx: number, grab: number): number | null {
  if (!dock || from < 0) return null;
  const left = top.lefts[from]! + dx;
  if (left >= -DOCK_GAP) return null;
  const tile = Math.min(left + grab - PINNED_CELL / 2, dock.left + dock.ids.length * CELL_STEP);
  return dock.ids.filter((_, i) => dock.left + dock.geometry.lefts[i]! + PINNED_CELL / 2 < tile).length;
}

export function tabIn(strip: () => Strip | null, from: number, width: number): Cross {
  return {
    at: (dx, grab) => {
      const s = strip();
      const j = s ? tabInIndex(s, from, dx, grab) : null;
      if (!s?.dock || j === null) return false;
      shiftRoom(s.dock.geometry, (i) => (i >= j ? CELL_STEP : 0));
      shiftRoom(s.top, (i) => CELL_STEP - (i > from ? width + GAP : 0), from);
      growDock(s.grow, CELL_STEP);
      return true;
    },
    land: (dx, grab, ids) => {
      const s = strip();
      const j = s ? tabInIndex(s, from, dx, grab) : null;
      if (!s?.dock || j === null) return null;
      const target = s.dock.left + dockCellLeft(s.dock.geometry, j);
      return {
        dx: target - (s.top.lefts[from]! + grab - PINNED_CELL / 2),
        commit: () => {
          settleStrip(s);
          dropAt(ids, { zone: "pins", beforeId: s.dock!.geometry.slots[j]?.tabIds[0] ?? null });
        },
      };
    },
    clear: () => {
      const s = strip();
      if (!s?.dock) return;
      shiftRoom(s.dock.geometry, () => 0);
      growDock(s.grow, 0);
    },
  };
}

export const tileHold = (dx: Animated.Value, limit: number) =>
  dx.interpolate({ inputRange: [limit, limit + 1], outputRange: [0, -1], extrapolateLeft: "clamp", extrapolateRight: "extend" });
