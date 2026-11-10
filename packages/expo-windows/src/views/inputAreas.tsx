import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { RootTagContext, TurboModuleRegistry, View, type GestureResponderEvent, type TurboModule, type ViewStyle } from "react-native";
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

type PointerHost = TurboModule & { pointerState?(): number };
type ContextMenuMarker = { open(): void; capture: boolean; purpose: string };
type FiberLike = { memoizedProps?: unknown; return?: FiberLike | null };

const pointerStates = new WeakMap<object, number>();

function pointerStateAt(event: PointerLike): number {
  const token = event.nativeEvent;
  const known = token ? pointerStates.get(token) : undefined;
  if (known !== undefined) return known;
  let state = 0;
  try {
    state = TurboModuleRegistry.get<PointerHost>("ArdiaWindowsHost")?.pointerState?.() ?? 0;
  } catch {
    state = 0;
  }
  if (token) pointerStates.set(token, state);
  return state;
}

const PRESS_STATE_SAMPLES = 8;
let pressStateSamples = 0;

function notePressState(state: number) {
  if (pressStateSamples >= PRESS_STATE_SAMPLES) return;
  pressStateSamples += 1;
  noteContextMenu(`a press began with pointer state ${state}`);
}

function contextMenuUnder(event: PointerLike): ContextMenuMarker | undefined {
  const found: ContextMenuMarker[] = [];
  let fiber = (event as { _targetInst?: FiberLike | null })._targetInst ?? null;
  for (let step = 0; fiber && step < FIBER_STEPS; step += 1, fiber = fiber.return ?? null) {
    const props = fiber.memoizedProps;
    const marker = props && typeof props === "object" ? (props as { ardiaContextMenu?: ContextMenuMarker }).ardiaContextMenu : undefined;
    if (marker && typeof marker.open === "function" && !found.includes(marker)) found.push(marker);
  }
  for (let index = found.length - 1; index >= 0; index -= 1) if (found[index]!.capture) return found[index];
  return found[0];
}

export const ContextMenuArea = forwardRef<View, AnyProps>(function ContextMenuArea({ onContextMenu, captureDescendants, onKeyDown, children, ...rest }, ref) {
  const purpose = contextMenuPurpose(rest);
  const latest = useRef(onContextMenu);
  latest.current = onContextMenu;
  const pending = useRef<ContextMenuMarker | null>(null);
  const marker = useMemo<ContextMenuMarker | undefined>(
    () => (typeof onContextMenu === "function" ? { open: () => call(latest.current, { nativeEvent: {} }), capture: captureDescendants === true, purpose } : undefined),
    [typeof onContextMenu === "function", captureDescendants, purpose],
  );
  const claim = useCallback(
    (event: PointerLike) => {
      const state = pointerStateAt(event);
      notePressState(state);
      if ((state & RIGHT_DOWN) === 0 || (state & LEFT_DOWN) !== 0) return false;
      const chosen = contextMenuUnder(event) ?? marker;
      if (!chosen) return false;
      pending.current = chosen;
      noteContextMenu(`right press on ${chosen.purpose}`);
      return true;
    },
    [marker],
  );
  const release = useCallback(() => {
    const chosen = pending.current;
    pending.current = null;
    if (!chosen) return;
    noteContextMenu(`right release on ${chosen.purpose}, opening its menu`);
    chosen.open();
  }, []);
  const terminate = useCallback(() => {
    if (pending.current) noteContextMenu(`right press on ${pending.current.purpose} was cancelled before its release`);
    pending.current = null;
  }, []);
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
    <View
      {...rest}
      ref={ref}
      {...windowsEvents({
        onStartShouldSetResponderCapture: claim,
        onResponderRelease: release,
        onResponderTerminate: terminate,
        onResponderTerminationRequest: () => false,
        onKeyDown: key,
      })}
      {...({ ardiaContextMenu: marker } as object)}
    >
      {children as ReactNode}
    </View>
  );
});

export const MouseArea = forwardRef<View, AnyProps>(function MouseArea({ path: _path, onMiddleClick, children, ...rest }, ref) {
  const held = useRef<number | null>(null);
  const claim = useCallback(
    (event: PointerLike) => {
      if (typeof onMiddleClick !== "function") return false;
      const state = pointerStateAt(event);
      if ((state & MIDDLE_DOWN) === 0 || (state & (LEFT_DOWN | RIGHT_DOWN)) !== 0) return false;
      held.current = state;
      return true;
    },
    [onMiddleClick],
  );
  const release = useCallback(() => {
    const state = held.current;
    held.current = null;
    if (state === null) return;
    call(onMiddleClick, { nativeEvent: { shiftKey: (state & SHIFT_DOWN) !== 0, altKey: (state & ALT_DOWN) !== 0, metaKey: (state & CONTROL_DOWN) !== 0 } });
  }, [onMiddleClick]);
  const terminate = useCallback(() => {
    held.current = null;
  }, []);
  return (
    <View
      {...rest}
      ref={ref}
      {...windowsEvents({ onStartShouldSetResponderCapture: claim, onResponderRelease: release, onResponderTerminate: terminate, onResponderTerminationRequest: () => false })}
    >
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

const ROOT_TOUCH_SAMPLES = 12;
let rootTouchSamples = 0;

function noteRootTouch(event: PointerLike) {
  if (rootTouchSamples >= ROOT_TOUCH_SAMPLES) return;
  rootTouchSamples += 1;
  console.info(`[ardia windows] window root: a touch began with pointer state ${pointerStateAt(event)}`);
}

export function OutsidePressRoot({ children }: { children?: ReactNode }) {
  const registry = useMemo<OutsideRegistry>(() => ({ areas: new Set(), pending: new WeakMap() }), []);
  const press = useCallback(
    (event: GestureResponderEvent) => {
      noteRootTouch(event as unknown as PointerLike);
      const native = event.nativeEvent as unknown as object | undefined;
      if (!native || registry.pending.has(native)) return;
      const pending: PendingPress = { inside: new Set(), timestamp: pressTimestamp(event) };
      registry.pending.set(native, pending);
      void Promise.resolve().then(() => {
        for (const area of [...registry.areas]) if (!pending.inside.has(area)) area.press(pending.timestamp);
      });
    },
    [registry],
  );
  return (
    <OutsidePressContext.Provider value={registry}>
      <View style={{ flex: 1 }} {...windowsEvents({ onTouchStartCapture: press })}>
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

export const WindowProfile = forwardRef<View, AnyProps>(function WindowProfile({ profile: _profile, selection: _selection, neighbours: _neighbours, style, children, ...rest }, ref) {
  useEffect(() => noteMissing("<ArdiaWindowProfile> profile swap"), []);
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      {children as ReactNode}
    </View>
  );
});
