import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { View, type ViewProps } from "react-native";
import { noteFirstWindow, noteMissing } from "../missing";
import type { AnyProps } from "../views/shared";
import { pagers } from "./index";
import type { PagerArea, PagerConfig, PagerStateEvent } from "./pager";

type KeyedConfig = PagerConfig & { key: string };

const whole = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback);

function readConfig(value: unknown): KeyedConfig | null {
  if (!value || typeof value !== "object") return null;
  const config = value as Record<string, unknown>;
  if (typeof config.key !== "string" || config.key.length === 0) return null;
  const order = Array.isArray(config.order) && config.order.every((id) => typeof id === "string") ? (config.order as string[]) : undefined;
  const width = typeof config.width === "number" && Number.isFinite(config.width) ? config.width : 0;
  return { key: config.key, selected: whole(config.selected, 0), count: whole(config.count, 1), ack: whole(config.ack, 0), width, order };
}

export const SwipeArea = forwardRef<View, AnyProps>(function SwipeArea(
  {
    canSwipeBack: _canSwipeBack,
    canSwipeForward: _canSwipeForward,
    tracksUnavailableDirections: _tracksUnavailableDirections,
    allowsVerticalMotion: _allowsVerticalMotion,
    isPager: _isPager,
    onSwipe: _onSwipe,
    nativePager,
    onPagerPosition,
    onPagerState,
    pointerEvents,
    children,
    ...rest
  },
  ref,
) {
  const handlers = useRef({ onPagerPosition, onPagerState });
  handlers.current = { onPagerPosition, onPagerState };
  const area = useMemo<PagerArea>(
    () => ({
      position(position: number) {
        const handler = handlers.current.onPagerPosition;
        if (typeof handler !== "function") return false;
        handler({ nativeEvent: { position } });
        return true;
      },
      state(event: PagerStateEvent) {
        const handler = handlers.current.onPagerState;
        if (typeof handler === "function") handler({ nativeEvent: event });
      },
    }),
    [],
  );
  const config = readConfig(nativePager);
  const key = config?.key;

  useEffect(() => {
    noteFirstWindow();
    noteMissing("<ArdiaSwipe> swipe gestures");
  }, []);

  useLayoutEffect(() => {
    if (!key) return;
    const pager = pagers.named(key);
    pager.attach(area);
    return () => pager.detach(area);
  }, [key, area]);

  useLayoutEffect(() => {
    if (config) pagers.existing(config.key)?.configure(config);
  }, [key, config?.selected, config?.count, config?.ack, config?.width, config?.order]);

  return (
    <View {...(rest as ViewProps)} ref={ref} pointerEvents={(pointerEvents as ViewProps["pointerEvents"]) ?? "box-none"}>
      {children as ReactNode}
    </View>
  );
});
