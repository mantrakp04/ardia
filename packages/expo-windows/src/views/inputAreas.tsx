import { engineAvailable } from "../engine/host";
import { onPagePress } from "../engine/pages";
import { holdPrivateSession, privateWindowShown } from "../engine/privateWindows";
import { WindowIdContext } from "../engine/windowId";
import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { RootTagContext, TurboModuleRegistry, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import type { WindowsHostModule } from "../nativeModuleTypes";
import { noteMissing } from "../missing";
import { acceptsOf, useFileDropArea, type DropUpdate } from "./fileDropAreas";
import { claimOnce, type AnyProps } from "./shared";

type PointerLike = { nativeEvent?: Record<string, unknown> };
type KeyLike = { nativeEvent?: { key?: unknown; shiftKey?: unknown } };

const call = (handler: unknown, event: unknown) => {
  if (typeof handler === "function") (handler as (event: unknown) => void)(event);
};

const windowsEvents = (handlers: Record<string, (event: never) => void>): object => handlers;

const contextMenuClaims = new WeakSet<object>();

const contextMenuPurpose = (props: Record<string, unknown>): string => {
  for (const key of ["testID", "nativeID", "accessibilityLabel", "aria-label"]) {
    const value = props[key];
    if (typeof value === "string" && value.length > 0) return `"${value}"`;
  }
  return "an unlabelled area";
};

const noteContextMenu = (line: string) => console.info(`[ardia windows] context menu area: ${line}`);

const LEFT_DOWN = 1;
const RIGHT_DOWN = 2;
const MIDDLE_DOWN = 4;
const SHIFT_DOWN = 8;
const CONTROL_DOWN = 16;
const ALT_DOWN = 32;
const FIBER_STEPS = 400;

type ContextMenuMarker = { open(): void; capture: boolean; purpose: string };
type MiddleClickMarker = { click(state: number): void };
type FiberLike = { memoizedProps?: unknown; return?: FiberLike | null };
type Markers = { ardiaContextMenu?: ContextMenuMarker; ardiaMiddleClick?: MiddleClickMarker };
type SecondaryPress =
  | { kind: "context"; area: ContextMenuMarker | undefined; trail: string }
  | { kind: "middle"; area: MiddleClickMarker | undefined; state: number };

const pointerStates = new WeakMap<object, number>();

function pointerStateAt(event: PointerLike): number {
  const token = event.nativeEvent;
  const known = token ? pointerStates.get(token) : undefined;
  if (known !== undefined) return known;
  let state = 0;
  try {
    state = TurboModuleRegistry.get<WindowsHostModule>("ArdiaWindowsHost")?.pointerState?.() ?? 0;
  } catch {
    state = 0;
  }
  if (token) pointerStates.set(token, state);
  return state;
}

const secondaryKindOf = (state: number): SecondaryPress["kind"] | null => {
  if ((state & LEFT_DOWN) !== 0) return null;
  if ((state & RIGHT_DOWN) !== 0) return "context";
  if ((state & MIDDLE_DOWN) !== 0) return "middle";
  return null;
};

function markersUnder(event: PointerLike): Markers[] {
  const found: Markers[] = [];
  let fiber = (event as { _targetInst?: FiberLike | null })._targetInst ?? null;
  for (let step = 0; fiber && step < FIBER_STEPS; step += 1, fiber = fiber.return ?? null) {
    const props = fiber.memoizedProps;
    if (props && typeof props === "object") found.push(props as Markers);
  }
  return found;
}

const TRAIL_NAMES = 28;

function nameOf(type: unknown): string {
  if (typeof type === "string") return type;
  if (typeof type === "function") return (type as { displayName?: string; name?: string }).displayName || type.name || "fn";
  if (type && typeof type === "object") {
    const shaped = type as { displayName?: string; render?: { displayName?: string; name?: string }; type?: unknown };
    return shaped.displayName || shaped.render?.displayName || shaped.render?.name || (shaped.type ? nameOf(shaped.type) : "obj");
  }
  return "";
}

function trailUnder(event: PointerLike): string {
  const names: string[] = [];
  let fiber = (event as { _targetInst?: (FiberLike & { type?: unknown }) | null })._targetInst ?? null;
  for (let step = 0; fiber && step < FIBER_STEPS && names.length < TRAIL_NAMES; step += 1, fiber = (fiber.return ?? null) as typeof fiber) {
    const name = nameOf(fiber.type);
    if (name && names[names.length - 1] !== name) names.push(name);
  }
  return names.join(" < ");
}

function contextMenuUnder(path: Markers[]): ContextMenuMarker | undefined {
  const areas: ContextMenuMarker[] = [];
  for (const props of path) {
    const marker = props.ardiaContextMenu;
    if (marker && typeof marker.open === "function" && !areas.includes(marker)) areas.push(marker);
  }
  for (let index = areas.length - 1; index >= 0; index -= 1) if (areas[index]!.capture) return areas[index];
  return areas[0];
}

function middleClickUnder(path: Markers[]): MiddleClickMarker | undefined {
  for (const props of path) {
    const marker = props.ardiaMiddleClick;
    if (marker && typeof marker.click === "function") return marker;
  }
  return undefined;
}

function secondaryPressAt(event: PointerLike): SecondaryPress | null {
  if (!(event as { _targetInst?: unknown })._targetInst) return null;
  const state = pointerStateAt(event);
  const kind = secondaryKindOf(state);
  if (!kind) return null;
  const path = markersUnder(event);
  if (kind === "context") {
    const area = contextMenuUnder(path);
    return { kind, area, trail: area ? "" : trailUnder(event) };
  }
  return { kind, area: middleClickUnder(path), state };
}

function finishSecondaryPress(press: SecondaryPress) {
  if (press.kind === "middle") {
    press.area?.click(press.state);
    return;
  }
  if (!press.area) {
    noteContextMenu(`right press with no context menu area under it; under the pointer: ${press.trail}`);
    return;
  }
  noteContextMenu(`right press on ${press.area.purpose}, opening its menu`);
  press.area.open();
}

function dropSecondaryPress(press: SecondaryPress, why: string) {
  if (press.kind === "context") noteContextMenu(`right press on ${press.area?.purpose ?? "no context menu area"} ${why}`);
}

export const ContextMenuArea = forwardRef<View, AnyProps>(function ContextMenuArea({ onContextMenu, captureDescendants, onKeyDown, children, ...rest }, ref) {
  const purpose = contextMenuPurpose(rest);
  const latest = useRef(onContextMenu);
  latest.current = onContextMenu;
  const hasMenu = typeof onContextMenu === "function";
  const marker = useMemo<ContextMenuMarker | undefined>(
    () => (hasMenu ? { open: () => call(latest.current, { nativeEvent: {} }), capture: captureDescendants === true, purpose } : undefined),
    [hasMenu, captureDescendants, purpose],
  );
  const key = useCallback(
    (event: KeyLike) => {
      call(onKeyDown, event);
      const pressed = event.nativeEvent?.key;
      const menuKey = pressed === "ContextMenu" || (pressed === "F10" && event.nativeEvent?.shiftKey === true);
      if (!menuKey || typeof onContextMenu !== "function" || !claimOnce(contextMenuClaims, event.nativeEvent)) return;
      noteContextMenu(`menu key on ${purpose}, opening its menu`);
      call(onContextMenu, { nativeEvent: {} });
    },
    [onKeyDown, onContextMenu, purpose],
  );
  return (
    <View {...rest} ref={ref} {...windowsEvents({ onKeyDown: key })} {...({ ardiaContextMenu: marker } as object)}>
      {children as ReactNode}
    </View>
  );
});

export const MouseArea = forwardRef<View, AnyProps>(function MouseArea({ path: _path, onMiddleClick, children, ...rest }, ref) {
  const latest = useRef(onMiddleClick);
  latest.current = onMiddleClick;
  const hasClick = typeof onMiddleClick === "function";
  const marker = useMemo<MiddleClickMarker | undefined>(
    () =>
      hasClick
        ? {
            click: (state: number) =>
              call(latest.current, { nativeEvent: { shiftKey: (state & SHIFT_DOWN) !== 0, altKey: (state & ALT_DOWN) !== 0, metaKey: (state & CONTROL_DOWN) !== 0 } }),
          }
        : undefined,
    [hasClick],
  );
  return (
    <View {...rest} ref={ref} {...({ ardiaMiddleClick: marker } as object)}>
      {children as ReactNode}
    </View>
  );
});

type OutsideArea = { press: (timestamp: number) => void };
type PendingPress = { inside: Set<OutsideArea>; timestamp: number };
type OutsideRegistry = { areas: Set<OutsideArea>; pending: WeakMap<object, PendingPress> };

const OutsidePressContext = createContext<OutsideRegistry | null>(null);

const pressTimestamp = (event: GestureResponderEvent) => {
  const stamp = (event.nativeEvent as { timestamp?: unknown } | undefined)?.timestamp;
  return typeof stamp === "number" ? stamp : Date.now();
};

export function OutsidePressRoot({ children }: { children?: ReactNode }) {
  const registry = useMemo<OutsideRegistry>(() => ({ areas: new Set(), pending: new WeakMap() }), []);
  const secondary = useRef<SecondaryPress | null>(null);
  const claimSecondary = useCallback((event: GestureResponderEvent) => secondaryKindOf(pointerStateAt(event as unknown as PointerLike)) !== null, []);
  const press = useCallback(
    (event: GestureResponderEvent) => {
      const stale = secondary.current;
      if (stale) dropSecondaryPress(stale, "never ended");
      secondary.current = secondaryPressAt(event as unknown as PointerLike);
      const native = event.nativeEvent as unknown as object | undefined;
      if (!native || registry.pending.has(native)) return;
      const pending: PendingPress = { inside: new Set(), timestamp: pressTimestamp(event) };
      const openWhenPressed = [...registry.areas];
      registry.pending.set(native, pending);
      void Promise.resolve().then(() => {
        for (const area of openWhenPressed) if (!pending.inside.has(area)) area.press(pending.timestamp);
      });
    },
    [registry],
  );
  const end = useCallback(() => {
    const finished = secondary.current;
    secondary.current = null;
    if (finished) finishSecondaryPress(finished);
  }, []);
  const cancel = useCallback(() => {
    const cancelled = secondary.current;
    secondary.current = null;
    if (cancelled) dropSecondaryPress(cancelled, "was cancelled before its release");
  }, []);
  const yieldsResponder = useCallback(() => secondary.current === null, []);
  const windowId = useContext(WindowIdContext);
  useEffect(() => {
    if (!engineAvailable()) return;
    return onPagePress((pressed) => {
      if (pressed !== windowId) return;
      const timestamp = Date.now();
      for (const area of [...registry.areas]) area.press(timestamp);
    });
  }, [registry, windowId]);
  return (
    <OutsidePressContext.Provider value={registry}>
      <View
        style={{ flex: 1 }}
        {...windowsEvents({
          onStartShouldSetResponderCapture: claimSecondary,
          onResponderTerminationRequest: yieldsResponder,
          onTouchStartCapture: press,
          onTouchEndCapture: end,
          onTouchCancelCapture: cancel,
        })}
      >
        {children as ReactNode}
      </View>
    </OutsidePressContext.Provider>
  );
}

export const OutsidePressArea = forwardRef<View, AnyProps>(function OutsidePressArea({ onOutsidePress, onTouchStartCapture, children, ...rest }, ref) {
  const registry = useContext(OutsidePressContext);
  const latest = useRef(onOutsidePress);
  latest.current = onOutsidePress;
  const area = useMemo<OutsideArea>(() => ({ press: (timestamp) => call(latest.current, { nativeEvent: { timestamp } }) }), []);
  useEffect(() => {
    if (!registry) {
      noteMissing("<ArdiaOutsidePressArea> without OutsidePressRoot");
      return;
    }
    registry.areas.add(area);
    return () => void registry.areas.delete(area);
  }, [registry, area]);
  const inside = useCallback(
    (event: GestureResponderEvent) => {
      call(onTouchStartCapture, event);
      const native = event.nativeEvent as unknown as object | undefined;
      if (registry && native) registry.pending.get(native)?.inside.add(area);
    },
    [registry, area, onTouchStartCapture],
  );
  return (
    <View {...rest} ref={ref} {...windowsEvents({ onTouchStartCapture: inside })}>
      {children as ReactNode}
    </View>
  );
});

export const MagnifyArea = forwardRef<View, AnyProps>(function MagnifyArea({ enabled: _enabled, onMagnify: _onMagnify, children, ...rest }, ref) {
  useEffect(() => noteMissing("<ArdiaMagnifyArea> gestures"), []);
  return (
    <View {...rest} ref={ref}>
      {children as ReactNode}
    </View>
  );
});

const FileDropDepth = createContext(0);

export const FileDrop = forwardRef<{ nativeRef: { current: View | null } }, AnyProps>(function FileDrop({ accepts, enabled, onDropUpdate, onLayout, children, ...rest }, ref) {
  const depth = useContext(FileDropDepth) + 1;
  const rootTag = useContext(RootTagContext) as unknown as number;
  const nativeRef = useRef<View | null>(null);
  useImperativeHandle(ref, () => ({ nativeRef }), []);
  const deliver = useCallback((update: DropUpdate) => call(onDropUpdate, { nativeEvent: update }), [onDropUpdate]);
  const measure = useFileDropArea(nativeRef, rootTag, depth, acceptsOf(accepts), enabled !== false, deliver);
  const layout = useCallback(
    (event: unknown) => {
      call(onLayout, event);
      measure();
    },
    [onLayout, measure],
  );
  return (
    <FileDropDepth.Provider value={depth}>
      <View {...rest} ref={nativeRef} collapsable={false} onLayout={layout}>
        {children as ReactNode}
      </View>
    </FileDropDepth.Provider>
  );
});

export const WindowProfile = forwardRef<View, AnyProps>(function WindowProfile({ profile, selection: _selection, neighbours: _neighbours, style, children, ...rest }, ref) {
  useEffect(() => noteMissing("<ArdiaWindowProfile> profile swap"), []);
  const windowId = useContext(WindowIdContext);
  useEffect(() => {
    if (typeof profile !== "string") return undefined;
    const closed = privateWindowShown(profile);
    const released = holdPrivateSession(profile, windowId);
    return () => {
      released();
      closed();
    };
  }, [profile, windowId]);
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      {children as ReactNode}
    </View>
  );
});
