import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { setInsert, setInsertResolver, useTabDrag } from "../../state/drag/tabDrag";
import { inPinnedGroup } from "../../state/tabs/topStrip";
import { curve } from "../ui/motion";
import type { DragGeometry } from "./stripGroups";
import { GAP, INCOMING_GAP_MS, TOP_STRIP_HEIGHT } from "./tokens";

export function useIncomingTab(windowId: string, current: boolean, top: DragGeometry) {
  const active = useTabDrag((d) => current && d.tabIds.length > 0 && d.windowId !== windowId);
  const point = useTabDrag((d) => (current && d.overWindow === windowId ? d.overPoint : null));
  const origin = useRef<View>(null);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => {
    if (!point) return setStart(null);
    origin.current?.measureInWindow((x) => setStart((old) => (old === x ? old : x)));
  }, [point?.[0], point?.[1]]);
  const index = incomingIndex(top, point, start);
  const beforeId = index === null ? undefined : (top.slots[index]?.tabIds[0] ?? null);
  useEffect(() => setInsert(windowId, beforeId), [beforeId, windowId]);
  const latest = useRef({ top, start });
  latest.current = { top, start };
  useEffect(() => {
    if (!current) return;
    setInsertResolver(windowId, (p) => {
      const i = incomingIndex(latest.current.top, p, latest.current.start);
      return i === null ? undefined : (latest.current.top.slots[i]?.tabIds[0] ?? null);
    });
    return () => {
      setInsertResolver(windowId, null);
      setInsert(windowId, undefined);
    };
  }, [windowId, current]);
  return { active, at: index, origin };
}

function incomingIndex(top: DragGeometry, point: [number, number] | null, start: number | null): number | null {
  if (!point || start === null || point[1] > TOP_STRIP_HEIGHT + 24) return null;
  const x = point[0] - start;
  let index = top.slots.filter((slot, i) => top.lefts[i]! + slot.width / 2 < x).length;
  while (index < top.slots.length && inPinnedGroup(top.slots[index]!.tabIds[0])) index++;
  return index;
}

export function IncomingGap({ open, width, origin }: { open: boolean; width: number; origin?: React.RefObject<View | null> }) {
  const room = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(room, { toValue: open ? 1 : 0, duration: INCOMING_GAP_MS, easing: curve.outCubic, useNativeDriver: false }).start();
  }, [open]);
  return (
    <Animated.View
      ref={origin}
      pointerEvents="none"
      style={{
        height: TOP_STRIP_HEIGHT,
        width: room.interpolate({ inputRange: [0, 1], outputRange: [0, width] }),
        marginRight: room.interpolate({ inputRange: [0, 1], outputRange: [-GAP, 0] }),
      }}
    />
  );
}
