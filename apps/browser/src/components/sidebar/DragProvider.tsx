import { devRegister } from "../dev/devRegister";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Animated, PanResponder, type View } from "react-native";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { radius } from "../ui";
import { useClipped, type ClipSource } from "./EntryMotion";
import { noDragMarks } from "../../state/sidebar/dragMarks";
import { cellKey, RESTING_TAIL, ROW_GAP, type Ghost, type ItemSpec } from "./dragModel";
import { DragController } from "./dragController";
import { onAppEvent } from "../../state/drag/dragNative";
import { WindowDropGlow } from "../tabstrip/WindowDropGlow";

const DROP_GLOW_PLACE = { left: 5, right: 5, top: 44, bottom: 6, borderRadius: radius.card } as const;

const DragContext = createContext<DragController | null>(null);

export function DragProvider({ children }: { children: (ghost: Ghost | null, controller: DragController) => ReactNode }) {
  const controller = useMemo(() => new DragController(), []);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  controller.setGhost = setGhost;
  useEffect(() => () => void (controller.active && controller.end(false)), [controller]);
  useEffect(() => devRegister("sidebarDrag", null, controller), [controller]);
  useEffect(() => {
    const sub = onAppEvent((e) => e.type === "dragEscape" && controller.active && controller.end(false));
    return () => sub.remove();
  }, [controller]);
  return (
    <DragContext.Provider value={controller}>
      {children(ghost, controller)}
      <WindowDropGlow place={DROP_GLOW_PLACE} />
    </DragContext.Provider>
  );
}

export function DragScope({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const controller = useContext(DragContext);
  return <DragContext.Provider value={enabled ? controller : null}>{children}</DragContext.Provider>;
}

export const useDragController = () => useContext(DragContext) ?? undefined;
export const useDropInto = () => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.dropInto);
export const useDropOnto = (key: string) => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.onto === key);
export const useDropPins = () => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.pins);
export const usePinSlots = (cells: string[]) =>
  useStore(
    useContext(DragContext)?.marks ?? noDragMarks,
    useShallow((m) => {
      let slot = 0;
      return cells.map((cell) => {
        const key = cellKey(cell);
        if (m.pinBefore === key) slot += m.pinCount;
        return m.sources.has(key) ? slot : slot++;
      });
    }),
  );
export const usePinnedCount = (cells: string[]) =>
  useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => cells.reduce((n, cell) => n + (m.sources.has(cellKey(cell)) ? 0 : 1), 0) + m.pinCount);
export const useFolderTarget = (key: string) => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.folderTarget === key);
export const useFolderAway = () => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.folderAway);
export const useDragFolded = (key: string) => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.folded === key);
export const useDragging = () => useStore(useContext(DragContext)?.marks ?? noDragMarks, (m) => m.sources.size > 0);

export function useDragItem(key: string, spec: ItemSpec, clip: ClipSource | null = null) {
  const controller = useContext(DragContext) ?? undefined;
  const marks = controller?.marks ?? noDragMarks;
  const item = useMemo(() => controller?.create(key), [controller, key]);
  if (item) Object.assign(item, spec);
  useEffect(() => {
    if (!controller || !item) return;
    controller.items.set(key, item);
    return () => {
      if (controller.items.get(key) === item) controller.items.delete(key);
    };
  }, [controller, item, key]);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => spec.kind !== "tail" && Math.hypot(g.dx, g.dy) > 4,
        onPanResponderGrant: (_, g) => void controller?.begin(key, g.x0, g.y0),
        onPanResponderMove: (_, g) => controller?.move(g.moveX, g.moveY),
        onPanResponderRelease: () => controller?.end(true),
        onPanResponderTerminate: () => controller?.end(false),
        onPanResponderTerminationRequest: () => false,
      }),
    [controller, key],
  );
  const ref = useCallback(
    (view: View | null) => {
      if (item) item.view = view;
    },
    [item],
  );
  const headerRef = useCallback(
    (view: View | null) => {
      if (item) item.header = view;
    },
    [item],
  );

  const source = useStore(marks, (m) => m.sources.has(key));
  const landing = useStore(marks, (m) => m.landing === key);
  const clipped = useClipped(clip);
  const horizontal = spec.kind === "tile";
  const tailOffset = useMemo(() => item && Animated.add(item.gap, -ROW_GAP), [item]);
  const style = item
    ? {
        ...(horizontal ? null : { marginTop: spec.kind === "tail" ? tailOffset! : item.gap }),
        ...(source
          ? horizontal
            ? { opacity: 0 }
            : { height: item.size, marginBottom: -ROW_GAP, opacity: 0, overflow: "hidden" as const }
          : landing
            ? { opacity: 0 }
            : {}),
        ...(clipped && !source && !landing ? { marginTop: -ROW_GAP, paddingTop: ROW_GAP, overflow: "hidden" as const } : {}),
      }
    : spec.kind === "tail"
      ? RESTING_TAIL
      : {};
  return { wrapper: { ref, style }, handle: responder.panHandlers, headerRef, dragging: source, gap: item?.gap };
}
