import { requireNativeViewManager } from "expo-modules-core";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Animated, type NativeSyntheticEvent, type ViewProps } from "react-native";
import { nativeModule } from "./nativeModules";

export type SwipeEvent = {
  phase: "began" | "changed" | "ended" | "cancelled" | "swipe" | "wheel";
  direction: "back" | "forward";
  distance: number;
  dy: number;
  velocity: number;
  available: boolean;
  width: number;
};

export type SwipeStep = {
  phase: "began" | "changed" | "ended" | "cancelled" | "momentum" | "momentumBegan" | "momentumEnded" | "mayBegin" | "swipe" | "wheel";
  dx?: number;
  dy?: number;
  shift?: boolean;
  delayMs?: number;
};

export type NativePagerConfig = { key: string; selected: number; count: number; width?: number; ack?: number; order?: readonly string[] };

export type PagerStateEvent = {
  phase: "began" | "selected" | "settled";
  sequence: number;
  position: number;
  selected: number;
  profileId?: string | null;
  velocity: number;
};

export type PagerSnapshot = {
  sequence: number;
  selectionSequence: number;
  position: number;
  selected: number;
  phase: "idle" | "tracking" | "holding" | "settling";
  profileId?: string | null;
  velocity: number;
  count: number;
};

export type SwipeAreaProps = ViewProps & {
  canSwipeBack: boolean;
  canSwipeForward: boolean;
  tracksUnavailableDirections?: boolean;
  allowsVerticalMotion?: boolean;
  isPager?: boolean;
  onSwipe: (event: SwipeEvent) => void;
  nativePager?: NativePagerConfig;
  onPagerPosition?: (...args: never[]) => void;
  onPagerState?: (event: PagerStateEvent) => void;
};

export type SwipeAreaHandle = {
  devSimulate(steps: SwipeStep[], options?: { x?: number; y?: number; ignorePreference?: boolean }): Promise<unknown>;
};

type NativeProps = Omit<SwipeAreaProps, "onSwipe" | "onPagerState"> & {
  onSwipe: (e: NativeSyntheticEvent<SwipeEvent>) => void;
  onPagerState?: (e: NativeSyntheticEvent<PagerStateEvent>) => void;
};
type NativeHandle = { devLocate(): Promise<{ windowNumber: number; x: number; y: number; width: number; height: number } | null> };

export type SwipeModule = {
  haptic(pattern: string): void;
  switchPager(key: string, index: number, order?: readonly string[]): Promise<boolean>;
  stepPager(key: string, delta: number, wrap: boolean, order?: readonly string[]): Promise<boolean>;
  selectPager(key: string, profileId: string, order: readonly string[]): Promise<boolean>;
  pagerState(key: string): PagerSnapshot | null;
  devPagerState(key: string): Promise<unknown>;
  devSimulate(x: number, y: number, windowNumber: number, steps: SwipeStep[], ignorePreference: boolean): Promise<unknown>;
};
type NativeComponent = React.ComponentType<NativeProps & { ref?: React.Ref<NativeHandle> }>;

const Module = nativeModule("ArdiaSwipe");
const Native = requireNativeViewManager<NativeProps>("ArdiaSwipe") as unknown as NativeComponent;
let AnimatedNative: NativeComponent | undefined;
const animatedNative = () => (AnimatedNative ??= Animated.createAnimatedComponent(Native) as unknown as NativeComponent);

export const swipeHaptic = (pattern: "levelChange" | "alignment" | "generic") => Module.haptic(pattern);

export const switchPager = (key: string, index: number, order?: readonly string[]): Promise<boolean> => Module.switchPager(key, index, order);
export const stepPager = (key: string, delta: -1 | 1, wrap = false, order?: readonly string[]): Promise<boolean> =>
  Module.stepPager(key, delta, wrap, order);
export const selectPager = (key: string, profileId: string, order: readonly string[]): Promise<boolean> =>
  Module.selectPager(key, profileId, order);
export const pagerState = (key: string): PagerSnapshot | null => Module.pagerState(key);
export const devPagerState = (key: string): Promise<unknown> => Module.devPagerState(key);

export const SwipeArea = forwardRef<SwipeAreaHandle, SwipeAreaProps>(function SwipeArea({ onSwipe, onPagerState, ...props }, ref) {
  const handle = useRef<NativeHandle>(null);
  useImperativeHandle(ref, () => ({
    async devSimulate(steps, options = {}) {
      const at = await handle.current?.devLocate();
      if (!at) return { error: "area not in a window" };
      const x = at.x + (options.x ?? at.width / 2);
      const y = at.y + (options.y ?? at.height / 2);
      return Module.devSimulate(x, y, at.windowNumber, steps, options.ignorePreference ?? false);
    },
  }));
  const View = props.nativePager ? animatedNative() : Native;
  return (
    <View
      ref={handle}
      {...props}
      onSwipe={(e: NativeSyntheticEvent<SwipeEvent>) => onSwipe(e.nativeEvent)}
      onPagerState={onPagerState && ((e: NativeSyntheticEvent<PagerStateEvent>) => onPagerState(e.nativeEvent))}
    />
  );
});
