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

type TitleBandPress = { rootTag?: unknown; button?: unknown; x?: unknown; y?: unknown; shiftKey?: unknown; ctrlKey?: unknown; altKey?: unknown };

const DOUBLE_CLICK_MS = 500;
const CLICK_SLOP = 4;
const TITLE_BAND_HEIGHT = 32;
const HOST_COMPONENT = 5;
const MOST_ANCESTORS = 512;
const RIGHT_BUTTON = 2;

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

const bands = new Map<number, { current: unknown }>();
let titleBandPresses: Subscription | null = null;

const takesPressItself = (options: DragOptions) => options.clickable === true || options.onRegionDoubleClick !== undefined || !options.titleBarDoubleClick;

export function makeDragHandlers(rootTag: number, latest: LatestOptions) {
  let lastPress = 0;
  let lastPressAt: [number, number] = [0, 0];
  let pressedAt: [number, number] | null = null;
  let dragging = false;
  return {
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
}

function useWindowDrag(options: DragOptions) {
  const rootTag = useContext(RootTagContext) as unknown as number;
  const latest = useRef(options);
  latest.current = options;
  return useMemo(() => makeDragHandlers(rootTag, latest), [rootTag]);
}

const propsOf = (fiber: HostFiber): Props => fiber.stateNode?.canonical?.currentProps ?? fiber.memoizedProps ?? {};

export function hostPath(target: HostFiber | null | undefined): HostFiber[] {
  const path: HostFiber[] = [];
  let fiber = target ?? null;
  for (let steps = 0; fiber && steps < MOST_ANCESTORS; steps++, fiber = fiber.return) {
    if (fiber.tag === HOST_COMPONENT) path.push(fiber);
  }
  return path;
}

function dispatchCapture(path: HostFiber[], name: string, nativeEvent: object) {
  let stopped = false;
  for (const fiber of [...path].reverse()) {
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
      console.warn("[ardia windows] a press on the title band could not reach the UI", error);
    }
    if (stopped) return;
  }
}

export function pressThroughTitleBand(path: HostFiber[], press: TitleBandPress) {
  const x = typeof press.x === "number" ? press.x : 0;
  const y = typeof press.y === "number" ? press.y : 0;
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
    target: path[0]?.stateNode?.canonical?.nativeTag,
  };
  dispatchCapture(path, "onTouchStartCapture", nativeEvent);
}

const fiberOf = (instance: unknown) => (instance as { __internalInstanceHandle?: HostFiber | null } | null)?.__internalInstanceHandle ?? null;

function titleBandPressed(payload: unknown) {
  const press = (payload ?? {}) as TitleBandPress;
  if (typeof press.rootTag !== "number") return;
  const band = bands.get(press.rootTag);
  if (band) pressThroughTitleBand(hostPath(fiberOf(band.current)), press);
}

function listenForTitleBandPresses() {
  titleBandPresses ??= windows().addListener("onCaptionPress", titleBandPressed);
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
  const host = useRef<unknown>(null);
  useEffect(() => {
    bands.set(rootTag, host);
    listenForTitleBandPresses();
    return () => {
      if (bands.get(rootTag) === host) bands.delete(rootTag);
    };
  }, [rootTag]);
  return createElement(
    View as ComponentType<Record<string, unknown>>,
    { style: { flex: 1 }, collapsable: false, ref: host, ...handlers, onPointerDownCapture: noteRootPointerDown },
    children,
  );
}

const ROOT_POINTER_SAMPLES = 4;
let rootPointerSamples = 0;

function noteRootPointerDown(event: { nativeEvent?: Record<string, unknown> }) {
  const native = event.nativeEvent ?? {};
  if (rootPointerSamples >= ROOT_POINTER_SAMPLES && native.button !== 2) return;
  if (rootPointerSamples >= ROOT_POINTER_SAMPLES * 3) return;
  rootPointerSamples += 1;
  console.info(`[ardia windows] window root: a pointer down with button=${String(native.button)} buttons=${String(native.buttons)} pointerType=${String(native.pointerType)}`);
}
