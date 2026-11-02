import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { View } from "react-native";
import type { PagerSnapshot, SwipeAreaHandle, SwipeAreaProps } from "@ardia-real/ardiacore";
import { Pager, type PagerArea } from "./motion/pager";
import { addSwipeTarget, simulate, type SwipeTarget } from "./motion/swipe";

export const switchPager = async (key: string, index: number, order?: readonly string[]) => Pager.existing(key)?.switchTo(index, order) ?? false;

export const stepPager = async (key: string, delta: -1 | 1, wrap = false, order?: readonly string[]) => Pager.existing(key)?.step(delta, wrap, order) ?? false;

export const selectPager = async (key: string, profileId: string, order: readonly string[]) => Pager.existing(key)?.select(profileId, order) ?? false;

export const pagerState = (key: string): PagerSnapshot | null => Pager.existing(key)?.snapshot() ?? null;

export const devPagerState = async (key: string) => Pager.existing(key)?.debug() ?? null;

export const SwipeArea = forwardRef<SwipeAreaHandle, SwipeAreaProps>(function SwipeArea(
  { onSwipe, onPagerState, onPagerPosition, nativePager, canSwipeBack, canSwipeForward, tracksUnavailableDirections, allowsVerticalMotion, isPager, ...props },
  ref,
) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef({ onSwipe, onPagerState, onPagerPosition, nativePager, canSwipeBack, canSwipeForward, tracksUnavailableDirections, allowsVerticalMotion, isPager });
  latest.current = { onSwipe, onPagerState, onPagerPosition, nativePager, canSwipeBack, canSwipeForward, tracksUnavailableDirections, allowsVerticalMotion, isPager };
  const pager = useRef<Pager | null>(null);

  const area = useRef<PagerArea>({
    pageWidth: () => latest.current.nativePager?.width || node.current?.getBoundingClientRect().width || 0,
    attached: () => !!node.current?.isConnected,
    onPosition: (position) => (latest.current.onPagerPosition as ((e: unknown) => void) | undefined)?.({ nativeEvent: { position } }),
    onState: (event) => latest.current.onPagerState?.(event),
  }).current;

  const target = useRef<SwipeTarget>({
    node: () => node.current,
    canSwipeBack: () => !!latest.current.canSwipeBack,
    canSwipeForward: () => !!latest.current.canSwipeForward,
    tracksUnavailableDirections: () => !!latest.current.tracksUnavailableDirections,
    allowsVerticalMotion: () => !!latest.current.allowsVerticalMotion,
    isPager: () => !!latest.current.isPager,
    pager: () => (pager.current ? { pager: pager.current, area } : null),
    onSwipe: (event) => latest.current.onSwipe?.(event),
  }).current;

  useImperativeHandle(ref, () => ({ devSimulate: (steps, options) => simulate(target, steps, options) }), [target]);

  useEffect(() => addSwipeTarget(target), [target]);

  const key = nativePager?.key;
  useEffect(() => {
    if (!key) return;
    const named = Pager.named(key);
    pager.current = named;
    named.attach(area);
    return () => {
      if (pager.current === named) pager.current = null;
      named.detach(area);
    };
  }, [key, area]);

  useEffect(() => {
    if (nativePager && pager.current?.key === nativePager.key) pager.current.configure(nativePager);
  }, [nativePager?.key, nativePager?.selected, nativePager?.count, nativePager?.ack, nativePager?.order, nativePager?.width]);

  return <View pointerEvents="box-none" ref={(view) => void (node.current = view as unknown as HTMLElement | null)} {...props} />;
});
