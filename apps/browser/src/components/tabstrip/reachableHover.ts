import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { markHoverProps } from "../../lib/hoverMarks";
import { useOffstage } from "../ui";

export type ChipHover = ReturnType<typeof chipHover>;

function chipHover(reachable: boolean) {
  let inside = false;
  let live = reachable;
  let shown = false;
  const listeners = new Set<() => void>();
  const update = () => {
    const next = inside && live;
    if (next === shown) return;
    shown = next;
    for (const listener of listeners) listener();
  };
  return {
    hoverProps: markHoverProps({
      onMouseEnter: () => {
        inside = true;
        update();
      },
      onMouseLeave: () => {
        inside = false;
        update();
      },
    }),
    setReachable(next: boolean) {
      live = next;
      update();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hovered: () => shown,
  };
}

export function useChipHover(): ChipHover {
  const reachable = !useOffstage();
  const [hover] = useState(() => chipHover(reachable));
  useLayoutEffect(() => hover.setReachable(reachable), [hover, reachable]);
  return hover;
}

export function useOwnChipHover(): ChipHover {
  return useState(() => chipHover(true))[0];
}

export const useChipHovered = (hover: ChipHover) => useSyncExternalStore(hover.subscribe, hover.hovered);
