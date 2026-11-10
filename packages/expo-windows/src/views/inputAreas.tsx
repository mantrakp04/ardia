import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { RootTagContext, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { noteMissing } from "../missing";
import { acceptsOf, useFileDropArea, type DropUpdate } from "./fileDropAreas";
import { claimOnce, type AnyProps } from "./shared";

type PointerLike = { nativeEvent?: Record<string, unknown> };
type KeyLike = { nativeEvent?: { key?: unknown; shiftKey?: unknown } };

const SECONDARY_BUTTON = 2;
const MIDDLE_BUTTON = 1;

const call = (handler: unknown, event: unknown) => {
  if (typeof handler === "function") (handler as (event: unknown) => void)(event);
};

const windowsEvents = (handlers: Record<string, (event: never) => void>): object => handlers;

const contextMenuClaims = new WeakSet<object>();
const middleClickClaims = new WeakSet<object>();

const contextMenuPurpose = (props: Record<string, unknown>): string => {
  for (const key of ["testID", "nativeID", "accessibilityLabel", "aria-label"]) {
    const value = props[key];
    if (typeof value === "string" && value.length > 0) return `"${value}"`;
  }
  return "an unlabelled area";
};

const noteContextMenu = (line: string) => console.info(`[ardia windows] context menu area: ${line}`);

const POINTER_SAMPLES = 6;
let pointerSamples = 0;

function notePointerSample(kind: string, event: PointerLike) {
  if (pointerSamples >= POINTER_SAMPLES) return;
  pointerSamples += 1;
  const native = event.nativeEvent ?? {};
  noteContextMenu(`${kind} reached an area with button=${String(native.button)} buttons=${String(native.buttons)} pointerType=${String(native.pointerType)} fields=${Object.keys(native).sort().join(",")}`);
}

const isSecondary = (event: PointerLike) => {
  const native = event.nativeEvent;
  if (!native) return false;
  if (native.button === SECONDARY_BUTTON) return true;
  return typeof native.buttons === "number" && (native.buttons & SECONDARY_BUTTON) !== 0 && native.button !== 0;
};

export const ContextMenuArea = forwardRef<View, AnyProps>(function ContextMenuArea(
  { onContextMenu, captureDescendants, onPointerDown, onPointerDownCapture, onPointerUp, onPointerUpCapture, onPointerCancel, onAuxClick, onKeyDown, children, ...rest },
  ref,
) {
  const armed = useRef(false);
  const purpose = contextMenuPurpose(rest);
  const press = useCallback(
    (event: PointerLike) => {
      notePointerSample("a pointer down", event);
      if (!isSecondary(event) || typeof onContextMenu !== "function") return;
      if (!claimOnce(contextMenuClaims, event.nativeEvent)) return;
      armed.current = true;
      noteContextMenu(`right press on ${purpose}`);
    },
    [onContextMenu, purpose],
  );
  const release = useCallback(
    (event: PointerLike) => {
      if (!armed.current || !isSecondary(event)) return;
      armed.current = false;
      noteContextMenu(`right release on ${purpose}, opening its menu`);
      call(onContextMenu, { nativeEvent: {} });
    },
    [onContextMenu, purpose],
  );
  const downBubble = useCallback(
    (event: PointerLike) => {
      call(onPointerDown, event);
      if (captureDescendants !== true) press(event);
    },
    [onPointerDown, captureDescendants, press],
  );
  const downCapture = useCallback(
    (event: PointerLike) => {
      call(onPointerDownCapture, event);
      if (captureDescendants === true) press(event);
    },
    [onPointerDownCapture, captureDescendants, press],
  );
  const upBubble = useCallback(
    (event: PointerLike) => {
      call(onPointerUp, event);
      release(event);
    },
    [onPointerUp, release],
  );
  const upCapture = useCallback(
    (event: PointerLike) => {
      call(onPointerUpCapture, event);
      if (captureDescendants === true) release(event);
    },
    [onPointerUpCapture, captureDescendants, release],
  );
  const auxClick = useCallback(
    (event: PointerLike) => {
      call(onAuxClick, event);
      notePointerSample("an aux click", event);
      if (!armed.current && event.nativeEvent?.button === SECONDARY_BUTTON && typeof onContextMenu === "function") armed.current = claimOnce(contextMenuClaims, event.nativeEvent);
      release(event);
    },
    [onAuxClick, release],
  );
  const cancel = useCallback(
    (event: PointerLike) => {
      call(onPointerCancel, event);
      if (!armed.current) return;
      armed.current = false;
      noteContextMenu(`right press on ${purpose} was cancelled before its release`);
    },
    [onPointerCancel, purpose],
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
    <View
      {...rest}
      ref={ref}
      {...windowsEvents({
        onPointerDown: downBubble,
        onPointerDownCapture: downCapture,
        onPointerUp: upBubble,
        onPointerUpCapture: upCapture,
        onPointerCancel: cancel,
        onAuxClick: auxClick,
        onKeyDown: key,
      })}
    >
      {children as ReactNode}
    </View>
  );
});

export const MouseArea = forwardRef<View, AnyProps>(function MouseArea({ path: _path, onMiddleClick, onAuxClick, children, ...rest }, ref) {
  const aux = useCallback(
    (event: PointerLike) => {
      call(onAuxClick, event);
      const native = event.nativeEvent;
      if (native?.button !== MIDDLE_BUTTON || typeof onMiddleClick !== "function" || !claimOnce(middleClickClaims, native)) return;
      call(onMiddleClick, { nativeEvent: { shiftKey: native.shiftKey === true, altKey: native.altKey === true, metaKey: native.ctrlKey === true || native.metaKey === true } });
    },
    [onAuxClick, onMiddleClick],
  );
  return (
    <View {...rest} ref={ref} {...windowsEvents({ onAuxClick: aux })}>
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
  const press = useCallback(
    (event: GestureResponderEvent) => {
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
