import { forwardRef, useEffect, useLayoutEffect, useRef, type ComponentType, type ForwardedRef, type ReactNode } from "react";
import { Animated as WebAnimated, Pressable as WebPressable, StyleSheet, View as WebView } from "react-native-web";
import "./sidebarEdge";
import { watchLayout } from "../mountLayout";
import { macEvent, trackHover, type MouseHandler } from "./hover";

export type { MacMouseEvent } from "./hover";

type MacProps = {
  onDoubleClick?: (e: unknown) => void;
  onMouseEnter?: MouseHandler;
  onMouseLeave?: MouseHandler;
  onLayout?: (event: unknown) => void;
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
    return trackHover({ node: () => node.current, enter: () => latest.current.onMouseEnter, leave: () => latest.current.onMouseLeave, inside: false });
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
  const layoutHandler = useRef(props.onLayout);
  layoutHandler.current = props.onLayout;
  const measured = !!props.onLayout;
  useLayoutEffect(() => (measured ? watchLayout(node.current, () => layoutHandler.current as never, window) : undefined), [measured]);
  return (
    <BaseView
      {...strip(props)}
      {...domHover}
      onLayout={undefined}
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
