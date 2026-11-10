import { createElement, forwardRef, useContext, useRef, type ComponentType } from "react";
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

const DOUBLE_CLICK_MS = 500;
const CLICK_SLOP = 4;

const windows = () => requireNativeModule<WindowDragging>("ArdiaAppWindows");

export const WindowDragRegion = forwardRef<View, DragRegionProps>(function WindowDragRegion(
  { titleBarDoubleClick = true, onRegionDoubleClick, clickable, onRegionClick, ...rest },
  ref,
) {
  const rootTag = useContext(RootTagContext) as unknown as number;
  const lastPress = useRef(0);
  const lastPressAt = useRef<[number, number]>([0, 0]);
  const pressedAt = useRef<[number, number] | null>(null);
  const dragging = useRef(false);
  return createElement(View as ComponentType<Record<string, unknown>>, {
    ...rest,
    ref,
    onStartShouldSetResponder: () => true,
    onResponderTerminationRequest: () => true,
    onResponderGrant: (event: { nativeEvent: { pageX: number; pageY: number; timestamp: number } }) => {
      const now = Date.now();
      const at: [number, number] = [event.nativeEvent.pageX, event.nativeEvent.pageY];
      const near = Math.abs(at[0] - lastPressAt.current[0]) <= CLICK_SLOP && Math.abs(at[1] - lastPressAt.current[1]) <= CLICK_SLOP;
      const second = near && now - lastPress.current < DOUBLE_CLICK_MS;
      lastPress.current = second ? 0 : now;
      lastPressAt.current = at;
      pressedAt.current = at;
      dragging.current = false;
      if (!second) return;
      pressedAt.current = null;
      if (onRegionDoubleClick) onRegionDoubleClick();
      if (titleBarDoubleClick) void windows().toggleMaximize(rootTag);
    },
    onResponderMove: (event: { nativeEvent: { pageX: number; pageY: number } }) => {
      const start = pressedAt.current;
      if (!start || dragging.current) return;
      if (Math.abs(event.nativeEvent.pageX - start[0]) < CLICK_SLOP && Math.abs(event.nativeEvent.pageY - start[1]) < CLICK_SLOP) return;
      dragging.current = true;
      void windows().beginWindowDrag(rootTag);
    },
    onResponderRelease: () => {
      if (pressedAt.current && !dragging.current && clickable) onRegionClick?.();
      pressedAt.current = null;
    },
    onResponderTerminate: () => {
      pressedAt.current = null;
    },
  });
});
