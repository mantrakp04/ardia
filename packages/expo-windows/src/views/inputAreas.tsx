import { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import { AppRegistry, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { noteMissing } from "../missing";
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

export const ContextMenuArea = forwardRef<View, AnyProps>(function ContextMenuArea({ onContextMenu, captureDescendants, onPointerDown, onPointerDownCapture, onKeyDown, children, ...rest }, ref) {
  const open = useCallback(
    (event: PointerLike) => {
      if (event.nativeEvent?.button !== SECONDARY_BUTTON || typeof onContextMenu !== "function") return;
      if (claimOnce(contextMenuClaims, event.nativeEvent)) call(onContextMenu, { nativeEvent: {} });
    },
    [onContextMenu],
  );
  const bubble = useCallback(
    (event: PointerLike) => {
      call(onPointerDown, event);
      if (captureDescendants !== true) open(event);
    },
    [onPointerDown, captureDescendants, open],
  );
  const capture = useCallback(
    (event: PointerLike) => {
      call(onPointerDownCapture, event);
      if (captureDescendants === true) open(event);
    },
    [onPointerDownCapture, captureDescendants, open],
  );
  const key = useCallback(
    (event: KeyLike) => {
      call(onKeyDown, event);
      const pressed = event.nativeEvent?.key;
      const menuKey = pressed === "ContextMenu" || (pressed === "F10" && event.nativeEvent?.shiftKey === true);
      if (menuKey && typeof onContextMenu === "function" && claimOnce(contextMenuClaims, event.nativeEvent)) call(onContextMenu, { nativeEvent: {} });
    },
    [onKeyDown, onContextMenu],
  );
  return (
    <View {...rest} ref={ref} {...windowsEvents({ onPointerDown: bubble, onPointerDownCapture: capture, onKeyDown: key })}>
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

let rootInstalled = false;

export function installOutsidePressRoot() {
  if (rootInstalled) return;
  rootInstalled = true;
  AppRegistry.setWrapperComponentProvider(() => OutsidePressRoot);
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
  return (
    <View {...rest} ref={ref}>
      {children as ReactNode}
    </View>
  );
});

export const FileDrop = forwardRef<{ nativeRef: { current: View | null } }, AnyProps>(function FileDrop({ accepts: _accepts, enabled: _enabled, onDropUpdate: _onDropUpdate, children, ...rest }, ref) {
  const nativeRef = useRef<View | null>(null);
  useImperativeHandle(ref, () => ({ nativeRef }), []);
  return (
    <View {...rest} ref={nativeRef}>
      {children as ReactNode}
    </View>
  );
});

export const WindowProfile = forwardRef<View, AnyProps>(function WindowProfile({ profile: _profile, selection: _selection, neighbours: _neighbours, style, children, ...rest }, ref) {
  return (
    <View {...rest} ref={ref} pointerEvents="none" style={style as ViewStyle}>
      {children as ReactNode}
    </View>
  );
});
