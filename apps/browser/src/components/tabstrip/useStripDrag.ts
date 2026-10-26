import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, findNodeHandle, PanResponder, type View } from "react-native";
import { beginTabDrag, cancelTabDrag, endTabDrag, setDragPicture, tabDragging, updateTabDrag } from "../../state/drag/tabDrag";
import { setStripOnto, storeChangedSince, storeMark } from "../../state/tabs/topStrip";
import { curve } from "../ui/motion";
import { dropOnto, ontoKey, reorder, type DropTarget, type Landing, type StripDrag } from "./model";
import { raiseView } from "../../state/windows/nativeWindow";
import { aimDrop, dragRange, dropIndex } from "./stripGroups";
import { makeRoom, registerSlot, reorderOffsets, settleRoom, SLIDE } from "./stripReorder";
import { LIFT_MS, LIFT_SLOP, ONTO_EDGE, TOP_STRIP_HEIGHT } from "./tokens";

export function useStripDrag(item: StripDrag) {
  const dx = useRef(new Animated.Value(0)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const translateX = useRef(Animated.add(dx, shift)).current;
  const lift = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const [crossed, setCrossed] = useState(false);
  const view = useRef<View>(null);
  const latest = useRef(item);
  latest.current = item;
  const drag = useRef({ stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids: [] as string[], dx: 0, to: -1, grab: item.width / 2, crossed: false, onto: null as DropTarget | null });
  useEffect(() => registerSlot(() => latest.current.geometry, () => latest.current.from, shift), []);
  const aimAt = (dx: number) => {
    const { geometry, from, targets } = latest.current;
    if (!targets || from < 0) return null;
    return aimDrop(geometry, from, geometry.lefts[from]! + drag.current.grab + dx, (i) => !!targets[i], ONTO_EDGE);
  };
  const indexAt = (dx: number) => aimAt(dx)?.to ?? dropIndex(latest.current.geometry, latest.current.from, dx);
  const setOnto = (target: DropTarget | null) => {
    if (ontoKey(drag.current.onto) === ontoKey(target)) return;
    drag.current.onto = target;
    setStripOnto(ontoKey(target));
  };
  const setLifted = (lifted: boolean) => {
    if (drag.current.lifted === lifted) return;
    drag.current.lifted = lifted;
    Animated.timing(lift, { toValue: lifted ? 1 : 0, duration: LIFT_MS, easing: curve.outCubic, useNativeDriver: false }).start();
  };
  const makeRoomAt = (to: number) => {
    const { geometry, from } = latest.current;
    if (from < 0 || to === drag.current.to) return;
    drag.current.to = to;
    makeRoom(geometry, from, to < 0 ? from : to);
  };
  const setCross = (on: boolean) => {
    if (drag.current.crossed === on) return;
    drag.current.crossed = on;
    if (!on) {
      latest.current.cross?.clear();
      drag.current.to = NaN;
    }
    setCrossed(on);
  };
  const owns = useRef(false);
  const raised = useRef<number | null>(null);
  const raise = (on: boolean) => {
    const tag = on ? findNodeHandle(view.current) : raised.current;
    raiseView(tag, latest.current.levels ?? (latest.current.groupId ? 1 : 0), on);
    raised.current = on ? tag : null;
  };
  const reset = () => {
    owns.current = false;
    setCross(false);
    setOnto(null);
    makeRoomAt(-1);
    dx.setValue(0);
    setLifted(false);
    setDragging(false);
    raise(false);
  };
  const settle = useRef<{ land: () => void } | null>(null);
  const settleInto = (to: number | null, commit: () => boolean) => {
    const { geometry, from } = latest.current;
    if (to === null) makeRoomAt(-1);
    const landing = {
      land: () => {
        if (settle.current !== landing) return;
        settle.current = null;
        if (to !== null) {
          settleRoom(geometry);
          commit();
        }
        dx.setValue(0);
        setDragging(false);
        raise(false);
      },
    };
    settle.current = landing;
    Animated.spring(dx, { toValue: to === null ? 0 : (reorderOffsets(geometry, from, to)[from] ?? 0), ...SLIDE }).start(() => landing.land());
  };
  const settleAcross = ({ dx: toValue, commit }: Landing) => {
    const landing = {
      land: () => {
        if (settle.current !== landing) return;
        settle.current = null;
        commit();
        drag.current.crossed = false;
        setCrossed(false);
        dx.setValue(0);
        setDragging(false);
        raise(false);
      },
    };
    settle.current = landing;
    Animated.spring(dx, { toValue, ...SLIDE }).start(() => landing.land());
  };
  useEffect(
    () => () => {
      settle.current?.land();
      if (!owns.current) return;
      setOnto(null);
      if (drag.current.crossed) latest.current.cross?.clear();
      settleRoom(latest.current.geometry);
      if (!latest.current.local) cancelTabDrag();
    },
    [],
  );
  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          if (tabDragging()) return false;
          const axis = latest.current.axis;
          if (axis === "y") return Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
          if (axis === "x") return Math.abs(g.dx) > 4;
          return Math.abs(g.dx) > 4 || Math.abs(g.dy) > 6;
        },
        onPanResponderGrant: (e) => {
          const ids = latest.current.ids();
          const grab: [number, number] = [e.nativeEvent.pageX, e.nativeEvent.pageY];
          settle.current?.land();
          dx.stopAnimation();
          dx.setValue(0);
          const mine = { stripBottom: TOP_STRIP_HEIGHT, lifted: false, ids, dx: 0, to: -1, grab: latest.current.width / 2, crossed: false, onto: null };
          setOnto(null);
          drag.current = mine;
          owns.current = true;
          setDragging(true);
          if (latest.current.from >= 0) raise(true);
          if (latest.current.local) return;
          const seq = beginTabDrag(ids.length === 1 ? latest.current.tabId : null, ids);
          view.current?.measureInWindow((x, y, width, height) => {
            if (drag.current !== mine) return;
            mine.stripBottom = y + TOP_STRIP_HEIGHT;
            mine.grab = Math.max(0, Math.min(width, grab[0] - x));
            setDragPicture(seq, () => [x + mine.dx, y, width, height], [grab[0] + mine.dx, grab[1]]);
          });
        },
        onPanResponderMove: (_, g) => {
          const { geometry, from, tabId, range, local, cross } = latest.current;
          const lifted = !local && !!tabId && drag.current.ids.length === 1 && g.moveY > drag.current.stripBottom + LIFT_SLOP;
          setLifted(lifted);
          const [min, max] = (typeof range === "function" ? range(drag.current.grab) : range) ?? (from < 0 ? [0, 0] : dragRange(geometry, from));
          if (!lifted) {
            drag.current.dx = Math.max(min, Math.min(max, g.dx));
            dx.setValue(drag.current.dx);
          }
          const across = !lifted && !!cross?.at(drag.current.dx, drag.current.grab);
          setCross(across);
          const aim = across || lifted ? null : aimAt(g.dx);
          setOnto(aim?.onto != null ? (latest.current.targets?.[aim.onto] ?? null) : null);
          if (!across) makeRoomAt(lifted || from < 0 ? -1 : (aim?.to ?? dropIndex(geometry, from, g.dx)));
          if (!local) updateTabDrag(g.moveX, g.moveY, lifted);
        },
        onPanResponderRelease: (_, g) => {
          const lifted = drag.current.lifted;
          const { local, drop, from, range, geometry } = latest.current;
          owns.current = false;
          if ((!local && (endTabDrag() || lifted)) || (from < 0 && !drop)) return reset();
          const ids = drag.current.ids;
          const landing = drag.current.crossed ? latest.current.cross?.land(drag.current.dx, drag.current.grab, ids) : null;
          if (landing) return settleAcross(landing);
          setCross(false);
          const onto = drag.current.onto;
          setOnto(null);
          if (!local && onto && dropOnto(onto, ids)) {
            settleRoom(geometry);
            return reset();
          }
          const bounds = typeof range === "function" ? range(drag.current.grab) : range;
          const travelled = bounds ? Math.max(bounds[0], Math.min(bounds[1], g.dx)) : g.dx;
          if (!local) {
            const mark = storeMark();
            const moved = drop?.(travelled, ids) || (from >= 0 && ids.length > 1 && reorder(ids, latest.current, indexAt(g.dx)));
            if (moved && storeChangedSince(mark)) settleRoom(geometry);
            if (moved) return reset();
          }
          if (from < 0) return reset();
          const to = indexAt(g.dx);
          settleInto(to === from ? null : to, () => {
            const mark = storeMark();
            if (local) drop?.(travelled, ids);
            else reorder(ids, latest.current, to);
            return storeChangedSince(mark);
          });
        },
        onPanResponderTerminate: () => {
          const local = latest.current.local;
          reset();
          if (!local) cancelTabDrag();
        },
      }),
    [],
  );
  const style = {
    zIndex: dragging ? 10 : 0,
    opacity: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    marginRight: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -(item.width + item.gap)] }),
    transform: [{ translateX }],
  };
  return { ref: view, panHandlers: responder.panHandlers, style, dragging, crossed, grab: drag.current.grab, dx };
}
