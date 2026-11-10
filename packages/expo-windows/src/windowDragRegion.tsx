import { createElement, forwardRef, useContext, useEffect, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { RootTagContext, View, type ViewProps } from "react-native";
import { requireNativeModule } from "./modules";

type DragRegionProps = ViewProps & {
  titleBarDoubleClick?: boolean;
  onRegionDoubleClick?: () => void;
  clickable?: boolean;
  onRegionClick?: () => void;
};

type Subscription = { remove(): void };

type WindowDragging = {
  beginWindowDrag(rootTag: number): Promise<void>;
  pressDragArea(rootTag: number): Promise<void>;
  toggleMaximize(rootTag: number): Promise<void>;
  setDragCaption(rootTag: number, point: [number, number] | null, menu: boolean): Promise<void>;
  addListener(event: string, listener: (payload: unknown) => void): Subscription;
};

type Press = { nativeEvent: { pageX: number; pageY: number } };

export type DragOptions = {
  titleBarDoubleClick: boolean;
  onRegionDoubleClick?: () => void;
  clickable?: boolean;
  onRegionClick?: () => void;
  claims?: (press: Press) => boolean;
};

type LatestOptions = { current: DragOptions };

type Props = Record<string, unknown>;

export type HostFiber = {
  tag: number;
  type: unknown;
  return: HostFiber | null;
  memoizedProps?: Props | null;
  stateNode?: { canonical?: { currentProps?: Props | null; nativeTag?: number; publicInstance?: unknown } | null } | null;
};

type Hover = {
  nativeEvent: { pageX?: unknown; pageY?: unknown; buttons?: unknown; pointerType?: unknown };
  _targetInst?: HostFiber | null;
};

type Caption = { point: [number, number]; menu: boolean; path: HostFiber[] };

type CaptionPress = { rootTag?: unknown; button?: unknown; x?: unknown; y?: unknown; shiftKey?: unknown; ctrlKey?: unknown; altKey?: unknown };

const DOUBLE_CLICK_MS = 500;
const CLICK_SLOP = 4;
const TITLE_BAND_HEIGHT = 32;
const CAPTION_PRESS_SLOP = 1;
const HOST_COMPONENT = 5;
const MOST_ANCESTORS = 512;
const RIGHT_BUTTON = 2;

const PASSIVE_HOSTS = new Set(["RCTView", "RCTText", "RCTVirtualText", "RCTImageView", "ArdiaVectorIcon"]);
const PRESS_HANDLERS = [
  "onStartShouldSetResponder",
  "onMoveShouldSetResponder",
  "onResponderGrant",
  "onResponderStart",
  "onResponderRelease",
  "onPress",
  "onPressIn",
  "onPressOut",
  "onLongPress",
  "onClick",
  "onPointerUp",
  "onTouchEnd",
  "onAuxClick",
];
const CAPTURING_HANDLERS = ["onStartShouldSetResponderCapture", "onMoveShouldSetResponderCapture"];
const MENU_HANDLERS = ["onPointerDown", "onPointerDownCapture"];

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

const regions = new WeakMap<object, LatestOptions>();
const captions = new Map<number, Caption>();
let captionPresses: Subscription | null = null;

export function makeDragHandlers(rootTag: number, latest: LatestOptions) {
  let lastPress = 0;
  let lastPressAt: [number, number] = [0, 0];
  let pressedAt: [number, number] | null = null;
  let dragging = false;
  const handlers = {
    onStartShouldSetResponder: (event: Press) => latest.current.claims?.(event) ?? true,
    onResponderTerminationRequest: () => true,
    onResponderGrant: (event: Press) => {
      if (!takesPressItself(latest.current)) {
        pressedAt = null;
        dragging = true;
        void windows().pressDragArea(rootTag);
        return;
      }
      const now = Date.now();
      const at: [number, number] = [event.nativeEvent.pageX, event.nativeEvent.pageY];
      const near = Math.abs(at[0] - lastPressAt[0]) <= CLICK_SLOP && Math.abs(at[1] - lastPressAt[1]) <= CLICK_SLOP;
      const second = near && now - lastPress < DOUBLE_CLICK_MS;
      lastPress = second ? 0 : now;
      lastPressAt = at;
      pressedAt = at;
      dragging = false;
      if (second) {
        pressedAt = null;
        latest.current.onRegionDoubleClick?.();
        if (latest.current.titleBarDoubleClick) void windows().toggleMaximize(rootTag);
        return;
      }
      if (latest.current.clickable) return;
      dragging = true;
      void windows().beginWindowDrag(rootTag);
    },
    onResponderMove: (event: Press) => {
      const start = pressedAt;
      if (!start || dragging) return;
      if (Math.abs(event.nativeEvent.pageX - start[0]) < CLICK_SLOP && Math.abs(event.nativeEvent.pageY - start[1]) < CLICK_SLOP) return;
      dragging = true;
      void windows().beginWindowDrag(rootTag);
    },
    onResponderRelease: () => {
      if (pressedAt && !dragging && latest.current.clickable) latest.current.onRegionClick?.();
      pressedAt = null;
    },
    onResponderTerminate: () => {
      pressedAt = null;
    },
  };
  regions.set(handlers.onStartShouldSetResponder, latest);
  return handlers;
}

function useWindowDrag(options: DragOptions) {
  const rootTag = useContext(RootTagContext) as unknown as number;
  const latest = useRef(options);
  latest.current = options;
  return useMemo(() => makeDragHandlers(rootTag, latest), [rootTag]);
}

const propsOf = (fiber: HostFiber): Props => fiber.stateNode?.canonical?.currentProps ?? fiber.memoizedProps ?? {};
const hasHandler = (props: Props, names: readonly string[]) => names.some((name) => typeof props[name] === "function");

export function hostPath(target: HostFiber | null | undefined): HostFiber[] {
  const path: HostFiber[] = [];
  let fiber = target ?? null;
  for (let steps = 0; fiber && steps < MOST_ANCESTORS; steps++, fiber = fiber.return) {
    if (fiber.tag === HOST_COMPONENT) path.push(fiber);
  }
  return path;
}

const regionOf = (props: Props) => {
  const handler = props.onStartShouldSetResponder;
  return typeof handler === "function" ? regions.get(handler) : undefined;
};

const takesPressItself = (options: DragOptions) => options.clickable === true || options.onRegionDoubleClick !== undefined || !options.titleBarDoubleClick;

export function captionAt(path: HostFiber[], pageX: number, pageY: number): { menu: boolean } | null {
  if (path.some((fiber) => hasHandler(propsOf(fiber), CAPTURING_HANDLERS))) return null;
  const press: Press = { nativeEvent: { pageX, pageY } };
  for (const fiber of path) {
    const props = propsOf(fiber);
    const region = regionOf(props);
    if (region) {
      const options = region.current;
      if (options.claims && !options.claims(press)) continue;
      if (takesPressItself(options)) return null;
      return { menu: path.some((each) => hasHandler(propsOf(each), MENU_HANDLERS)) };
    }
    if (hasHandler(props, PRESS_HANDLERS)) return null;
    if (typeof fiber.type !== "string" || !PASSIVE_HOSTS.has(fiber.type)) return null;
  }
  return null;
}

const near = (point: readonly [number, number], x: number, y: number) => Math.abs(point[0] - x) <= CAPTION_PRESS_SLOP && Math.abs(point[1] - y) <= CAPTION_PRESS_SLOP;

function clearCaption(rootTag: number) {
  if (!captions.delete(rootTag)) return;
  void windows().setDragCaption(rootTag, null, false);
}

function hoverOver(rootTag: number, event: Hover) {
  const native = event.nativeEvent;
  const x = native.pageX;
  const y = native.pageY;
  const buttons = typeof native.buttons === "number" ? native.buttons : 0;
  const mouse = native.pointerType === undefined || native.pointerType === "mouse";
  if (buttons !== 0 || !mouse || typeof x !== "number" || typeof y !== "number") return;
  const path = hostPath(event._targetInst);
  const found = path.length ? captionAt(path, x, y) : null;
  if (!found) return clearCaption(rootTag);
  const point: [number, number] = [x, y];
  captions.set(rootTag, { point, menu: found.menu, path });
  listenForCaptionPresses();
  void windows().setDragCaption(rootTag, point, found.menu);
}

function dispatchAlong(path: HostFiber[], name: string, nativeEvent: object, capture: boolean) {
  let stopped = false;
  const order = capture ? [...path].reverse() : path;
  for (const fiber of order) {
    const handler = propsOf(fiber)[name];
    if (typeof handler !== "function") continue;
    const event = {
      type: name,
      nativeEvent,
      target: path[0]?.stateNode?.canonical?.publicInstance,
      currentTarget: fiber.stateNode?.canonical?.publicInstance,
      stopPropagation: () => {
        stopped = true;
      },
      isPropagationStopped: () => stopped,
      preventDefault: () => {},
      isDefaultPrevented: () => false,
      persist: () => {},
    };
    try {
      (handler as (event: unknown) => void)(event);
    } catch (error) {
      console.warn("[ardia windows] a press on a title bar area could not reach the UI", error);
    }
    if (stopped) return;
  }
}

function forwardCaptionPress(payload: unknown) {
  const press = (payload ?? {}) as CaptionPress;
  const { rootTag, x, y } = press;
  if (typeof rootTag !== "number" || typeof x !== "number" || typeof y !== "number") return;
  const caption = captions.get(rootTag);
  if (!caption || !near(caption.point, x, y)) return;
  const button = press.button === RIGHT_BUTTON ? RIGHT_BUTTON : 0;
  const nativeEvent = {
    button,
    buttons: button === RIGHT_BUTTON ? 2 : 1,
    pointerType: "mouse",
    isPrimary: true,
    pageX: x,
    pageY: y,
    clientX: x,
    clientY: y,
    locationX: x,
    locationY: y,
    timestamp: Date.now(),
    identifier: 0,
    touches: [],
    changedTouches: [],
    shiftKey: press.shiftKey === true,
    ctrlKey: press.ctrlKey === true,
    altKey: press.altKey === true,
    metaKey: false,
    target: caption.path[0]?.stateNode?.canonical?.nativeTag,
  };
  dispatchAlong(caption.path, "onTouchStartCapture", nativeEvent, true);
  dispatchAlong(caption.path, "onTouchStart", nativeEvent, false);
  dispatchAlong(caption.path, "onPointerDownCapture", nativeEvent, true);
  dispatchAlong(caption.path, "onPointerDown", nativeEvent, false);
}

function listenForCaptionPresses() {
  if (captionPresses) return;
  captionPresses = windows().addListener("onCaptionPress", forwardCaptionPress);
}

export const WindowDragRegion = forwardRef<View, DragRegionProps>(function WindowDragRegion(
  { titleBarDoubleClick = true, onRegionDoubleClick, clickable, onRegionClick, ...rest },
  ref,
) {
  const handlers = useWindowDrag({ titleBarDoubleClick, onRegionDoubleClick, clickable, onRegionClick });
  return createElement(View as ComponentType<Record<string, unknown>>, { ...rest, ref, ...handlers });
});

export const inTitleBand = (press: Press) => press.nativeEvent.pageY <= TITLE_BAND_HEIGHT;

export function TitleBandDrag({ children }: { children?: ReactNode }) {
  const rootTag = useContext(RootTagContext) as unknown as number;
  const handlers = useWindowDrag({ titleBarDoubleClick: true, claims: inTitleBand });
  const onPointerMove = useMemo(() => (event: Hover) => hoverOver(rootTag, event), [rootTag]);
  useEffect(() => () => clearCaption(rootTag), [rootTag]);
  return createElement(View as ComponentType<Record<string, unknown>>, { style: { flex: 1 }, collapsable: false, ...handlers, onPointerMove }, children);
}
