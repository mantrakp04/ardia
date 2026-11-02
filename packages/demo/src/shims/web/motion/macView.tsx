import { forwardRef, useEffect, useRef, type ComponentType, type ForwardedRef, type ReactNode } from "react";
import { Animated as WebAnimated, Pressable as WebPressable, StyleSheet, View as WebView } from "react-native-web";
import "./leftEdge";
import { currentPointer, watchPointer, type PointerSample } from "./pointer";

type MouseHandler = (e: MacMouseEvent) => void;

export type MacMouseEvent = {
  nativeEvent: { clientX: number; clientY: number; screenX: number; screenY: number; shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean };
  stopPropagation: () => void;
  preventDefault: () => void;
};

type MacProps = {
  onDoubleClick?: (e: unknown) => void;
  onMouseEnter?: MouseHandler;
  onMouseLeave?: MouseHandler;
  tooltip?: string;
  pointerEvents?: string;
  focusable?: boolean;
  enableFocusRing?: boolean;
  mouseDownCanMoveWindow?: boolean;
  acceptsFirstMouse?: boolean;
  allowsVibrancy?: boolean;
  validKeysDown?: unknown;
  validKeysUp?: unknown;
  draggedTypes?: unknown;
  onDragEnter?: unknown;
  onDragLeave?: unknown;
  onDrop?: unknown;
  children?: ReactNode;
  style?: unknown;
  tabIndex?: number;
};

const WINDOW_SELECTOR = ".ardia-window";

function macEvent(node: HTMLElement, e: PointerSample): MacMouseEvent {
  const r = node.getBoundingClientRect();
  const frame = node.closest(WINDOW_SELECTOR)?.getBoundingClientRect();
  const windowX = frame ? e.clientX - frame.left : e.clientX;
  const windowY = frame ? frame.bottom - e.clientY : window.innerHeight - e.clientY;
  return {
    nativeEvent: {
      clientX: e.clientX - r.left,
      clientY: e.clientY - r.top,
      screenX: windowX,
      screenY: windowY,
      ...(e.shiftKey && { shiftKey: true }),
      ...(e.ctrlKey && { ctrlKey: true }),
      ...(e.altKey && { altKey: true }),
      ...(e.metaKey && { metaKey: true }),
    },
    stopPropagation: () => {},
    preventDefault: () => {},
  };
}

type Tracked = { node: () => HTMLElement | null; enter: () => MouseHandler | undefined; leave: () => MouseHandler | undefined; inside: boolean };

const tracked = new Set<Tracked>();
const OUTSIDE: PointerSample = { clientX: -1e5, clientY: -1e5, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
let stopTracking: (() => void) | null = null;

function contains(node: HTMLElement, p: PointerSample) {
  if (!node.isConnected) return false;
  const r = node.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && p.clientX >= r.left && p.clientX < r.right && p.clientY >= r.top && p.clientY < r.bottom;
}

function updateTracked(p: PointerSample | null) {
  for (const t of [...tracked]) {
    const node = t.node();
    if (!node) continue;
    const inside = !!p && contains(node, p);
    if (inside === t.inside) continue;
    t.inside = inside;
    const handler = inside ? t.enter() : t.leave();
    if (handler) handler(macEvent(node, p ?? OUTSIDE));
  }
}

function track(entry: Tracked) {
  tracked.add(entry);
  stopTracking ??= watchPointer(updateTracked);
  return () => {
    tracked.delete(entry);
    if (tracked.size || !stopTracking) return;
    stopTracking();
    stopTracking = null;
  };
}

function assign<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

const GEOMETRIC = new Set(["none", "box-none"]);

function useMacBehaviour(props: MacProps) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const geometric = GEOMETRIC.has(props.pointerEvents ?? "") && !!(props.onMouseEnter || props.onMouseLeave);

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    if (props.tooltip) el.title = props.tooltip;
    else el.removeAttribute("title");
  }, [props.tooltip]);

  const wantsDouble = !!props.onDoubleClick;
  useEffect(() => {
    const el = node.current;
    if (!el || !wantsDouble) return;
    const up = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail !== 2) return;
      e.stopPropagation();
      latest.current.onDoubleClick?.({ nativeEvent: {} });
    };
    el.addEventListener("mouseup", up);
    return () => el.removeEventListener("mouseup", up);
  }, [wantsDouble]);

  useEffect(() => {
    if (!geometric) return;
    const entry: Tracked = { node: () => node.current, enter: () => latest.current.onMouseEnter, leave: () => latest.current.onMouseLeave, inside: false };
    const el = node.current;
    const p = currentPointer();
    if (el && p) entry.inside = contains(el, p);
    return track(entry);
  }, [geometric]);

  const domHover = geometric
    ? {}
    : {
        onMouseEnter: props.onMouseEnter && ((e: { nativeEvent: MouseEvent }) => node.current && latest.current.onMouseEnter?.(macEvent(node.current, e.nativeEvent))),
        onMouseLeave: props.onMouseLeave && ((e: { nativeEvent: MouseEvent }) => node.current && latest.current.onMouseLeave?.(macEvent(node.current, e.nativeEvent))),
      };
  return { node, domHover };
}

function strip(props: MacProps) {
  const {
    onDoubleClick: _double,
    onMouseEnter: _enter,
    onMouseLeave: _leave,
    tooltip: _tooltip,
    enableFocusRing: _ring,
    mouseDownCanMoveWindow: _move,
    acceptsFirstMouse: _first,
    allowsVibrancy: _vibrancy,
    validKeysDown: _down,
    validKeysUp: _up,
    draggedTypes: _types,
    onDragEnter: _dragEnter,
    onDragLeave: _dragLeave,
    onDrop: _drop,
    ...rest
  } = props;
  return rest;
}

const BaseView = WebView as unknown as ComponentType<Record<string, unknown>>;

type ClipStyle = { overflow?: string; borderWidth?: number; borderTopWidth?: number; borderRightWidth?: number; borderBottomWidth?: number; borderLeftWidth?: number };

const BORDER_BOX_CLIP = { overflow: "clip", overflowClipMargin: "border-box" };

function clipAtBorderBox(style: unknown) {
  if (!style) return style;
  const flat = StyleSheet.flatten(style as never) as ClipStyle | undefined;
  if (flat?.overflow !== "hidden") return style;
  const bordered = [flat.borderWidth, flat.borderTopWidth, flat.borderRightWidth, flat.borderBottomWidth, flat.borderLeftWidth].some((w) => (w ?? 0) > 0);
  if (!bordered) return style;
  return [style, BORDER_BOX_CLIP];
}

export const MacView = forwardRef<unknown, MacProps>(function MacView(props, ref) {
  const { node, domHover } = useMacBehaviour(props);
  return (
    <BaseView
      {...strip(props)}
      {...domHover}
      style={clipAtBorderBox(props.style)}
      ref={(value: HTMLElement | null) => {
        node.current = value;
        assign(ref, value);
      }}
    />
  );
}) as unknown as typeof WebView;

const BasePressable = WebPressable as unknown as ComponentType<Record<string, unknown>>;
const ARROW = { cursor: "default" };
const TEXT_ENTRY = "input, textarea, [contenteditable='true']";

type PressableStyle = unknown | ((state: unknown) => unknown);

export const MacPressable = forwardRef<unknown, MacProps & { style?: PressableStyle; onMouseDown?: (e: MouseEvent) => void }>(function MacPressable(props, ref) {
  const { node, domHover } = useMacBehaviour(props);
  const focusable = props.focusable === true;
  const style = props.style;
  return (
    <BasePressable
      {...strip(props)}
      {...domHover}
      tabIndex={props.tabIndex ?? (focusable ? 0 : -1)}
      style={typeof style === "function" ? (state: unknown) => [ARROW, (style as (s: unknown) => unknown)(state)] : [ARROW, style]}
      onMouseDown={(e: { nativeEvent: MouseEvent; target: EventTarget; preventDefault: () => void }) => {
        props.onMouseDown?.(e.nativeEvent);
        if (!focusable && !(e.target instanceof Element && e.target.closest(TEXT_ENTRY))) e.preventDefault();
      }}
      ref={(value: HTMLElement | null) => {
        node.current = value;
        assign(ref, value);
      }}
    />
  );
}) as unknown as typeof WebPressable;

const animated = WebAnimated as unknown as { View: unknown; createAnimatedComponent: (c: unknown) => unknown };
animated.View = animated.createAnimatedComponent(MacView);
