import { createElement, forwardRef, useContext, useMemo, useRef, type ComponentType, type ReactNode } from "react";
import { RootTagContext, View, type ViewProps } from "react-native";
import { requireNativeModule } from "./modules";

type DragRegionProps = ViewProps & {
  titleBarDoubleClick?: boolean;
  onRegionDoubleClick?: () => void;
  clickable?: boolean;
  onRegionClick?: () => void;
};

type WindowDragging = {
  beginWindowDrag(rootTag: number): Promise<void>;
  toggleMaximize(rootTag: number): Promise<void>;
};

type Press = { nativeEvent: { pageX: number; pageY: number } };

type DragOptions = {
  titleBarDoubleClick: boolean;
  onRegionDoubleClick?: () => void;
  clickable?: boolean;
  onRegionClick?: () => void;
  claims?: (press: Press) => boolean;
};

const DOUBLE_CLICK_MS = 500;
const CLICK_SLOP = 4;
const TITLE_BAND_HEIGHT = 32;

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

let pressNoted = false;

function notePress(at: [number, number]) {
  if (pressNoted) return;
  pressNoted = true;
  console.info(`[ardia windows] first press on a drag area at ${Math.round(at[0])}, ${Math.round(at[1])}`);
}

function useWindowDrag(options: DragOptions) {
  const rootTag = useContext(RootTagContext) as unknown as number;
  const latest = useRef(options);
  latest.current = options;
  const lastPress = useRef(0);
  const lastPressAt = useRef<[number, number]>([0, 0]);
  const pressedAt = useRef<[number, number] | null>(null);
  const dragging = useRef(false);
  return useMemo(
    () => ({
      onStartShouldSetResponder: (event: Press) => latest.current.claims?.(event) ?? true,
      onResponderTerminationRequest: () => true,
      onResponderGrant: (event: Press) => {
        const now = Date.now();
        const at: [number, number] = [event.nativeEvent.pageX, event.nativeEvent.pageY];
        const near = Math.abs(at[0] - lastPressAt.current[0]) <= CLICK_SLOP && Math.abs(at[1] - lastPressAt.current[1]) <= CLICK_SLOP;
        const second = near && now - lastPress.current < DOUBLE_CLICK_MS;
        lastPress.current = second ? 0 : now;
        lastPressAt.current = at;
        pressedAt.current = at;
        dragging.current = false;
        notePress(at);
        if (!second) return;
        pressedAt.current = null;
        latest.current.onRegionDoubleClick?.();
        if (latest.current.titleBarDoubleClick) void windows().toggleMaximize(rootTag);
      },
      onResponderMove: (event: Press) => {
        const start = pressedAt.current;
        if (!start || dragging.current) return;
        if (Math.abs(event.nativeEvent.pageX - start[0]) < CLICK_SLOP && Math.abs(event.nativeEvent.pageY - start[1]) < CLICK_SLOP) return;
        dragging.current = true;
        console.info(`[ardia windows] window drag from ${Math.round(start[0])}, ${Math.round(start[1])}`);
        void windows().beginWindowDrag(rootTag);
      },
      onResponderRelease: () => {
        if (pressedAt.current && !dragging.current && latest.current.clickable) latest.current.onRegionClick?.();
        pressedAt.current = null;
      },
      onResponderTerminate: () => {
        pressedAt.current = null;
      },
    }),
    [rootTag],
  );
}

export const WindowDragRegion = forwardRef<View, DragRegionProps>(function WindowDragRegion(
  { titleBarDoubleClick = true, onRegionDoubleClick, clickable, onRegionClick, ...rest },
  ref,
) {
  const handlers = useWindowDrag({ titleBarDoubleClick, onRegionDoubleClick, clickable, onRegionClick });
  return createElement(View as ComponentType<Record<string, unknown>>, { ...rest, ref, ...handlers });
});

const inTitleBand = (press: Press) => press.nativeEvent.pageY <= TITLE_BAND_HEIGHT;

export function TitleBandDrag({ children }: { children?: ReactNode }) {
  const handlers = useWindowDrag({ titleBarDoubleClick: true, claims: inTitleBand });
  return createElement(View as ComponentType<Record<string, unknown>>, { style: { flex: 1 }, ...handlers }, children);
}
