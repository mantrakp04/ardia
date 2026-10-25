import { SwipeArea, type SwipeAreaHandle, type SwipeEvent } from "@ardia/ardiacore";
import { attachPagerPull, endLibraryPull, endPagerPull, notePagerPull, pullLibrary, stopPagerPull } from "../library/pull";
import { openLibrary, useLibrary } from "../library/state";
import { WindowBackdrop } from "@ardia/shaders";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useShallow } from "zustand/react/shallow";
import { profileTheme } from "../../lib/theme";
import { useBrowser } from "../../store/browser";
import { useWindowId } from "../../store/hooks";
import { pagerFor, usePagerNativeConfig, usePagerPages, usePagerSurface } from "./profilePager";


const LIBRARY_PULL_SPAN = 0.9;

export function ProfileSwipe({ children }: { children: ReactNode }) {
  return (
    <View style={{ height: "100%" }}>
      {children}
      <ProfileSwipeArea surface="sidebar" style={StyleSheet.absoluteFill} />
    </View>
  );
}

export function ProfileSwipeArea({ surface, style, pageWidth }: { surface: "sidebar" | "strip"; style: StyleProp<ViewStyle>; pageWidth?: number }) {
  const windowId = useWindowId();
  usePagerSurface(windowId);
  const [previous, next, multiple] = useBrowser(
    useShallow((s) => {
      const w = s.windows[windowId];
      const i = w && !w.incognito ? s.profileOrder.indexOf(w.profileId) : -1;
      return i < 0 ? [false, false, false] : [i > 0, i < s.profileOrder.length - 1, s.profileOrder.length > 1];
    }),
  );
  const libraryReachable = useBrowser((s) => !s.windows[windowId]?.incognito);
  const libraryOpen = useLibrary((s) => !!s.open[windowId]);
  const area = useRef<SwipeAreaHandle>(null);
  const pager = pagerFor(windowId);
  const nativePager = usePagerNativeConfig(windowId, pageWidth);
  const onPagerPosition = useMemo(() => Animated.event([{ nativeEvent: { position: pager.pos } }], { useNativeDriver: true }), [pager]);

  const onSwipe = (event: SwipeEvent) => {
    if (__DEV__) {
      if (received.length >= 4096) received.shift();
      received.push({ at: performance.now(), surface, profile: useBrowser.getState().windows[windowId]?.profileId, ...event });
    }
    const e = pageWidth ? { ...event, width: pageWidth } : event;
    const pullsLibrary = !nativePager && !previous && surface === "sidebar" && libraryReachable;
    if (pullsLibrary && (e.phase === "began" || e.phase === "changed")) return pullLibrary(windowId, e.direction === "back" ? e.distance / (Math.max(e.width, 1) * LIBRARY_PULL_SPAN) : 0);
    if (pullsLibrary && (e.phase === "ended" || e.phase === "cancelled")) return endLibraryPull(windowId, e.phase === "ended" ? undefined : false);
    if (e.phase === "swipe" && e.direction === "back" && !previous && libraryReachable) return openLibrary(windowId, "spaces");
    if (e.phase === "swipe") return pager.step(e.direction === "back" ? -1 : 1);
    if (e.phase === "wheel") pager.wheel(e);
  };

  const pullsFromPager = !!nativePager && !previous && surface === "sidebar" && libraryReachable;
  useEffect(() => {
    if (!pullsFromPager) return;
    const detach = attachPagerPull(windowId, pager.pos);
    const id = pager.pos.addListener(({ value }) => notePagerPull(windowId, value));
    return () => {
      pager.pos.removeListener(id);
      detach();
      stopPagerPull(windowId);
    };
  }, [pullsFromPager, pager, windowId]);
  const onPagerState = useMemo(
    () =>
      nativePager
        ? (event: Parameters<typeof pager.onNativeState>[0]) => {
            if (event.phase === "leading") return endPagerPull(windowId, event.phase, () => pager.returnHome());
            pager.onNativeState(event);
            if (pullsFromPager) endPagerPull(windowId, event.phase, () => pager.returnHome());
          }
        : undefined,
    [nativePager, pager, pullsFromPager, windowId],
  );

  useEffect(() => {
    if (!__DEV__) return;
    const key = `${surface}:${windowId}`;
    devAreas.set(key, area);
    return () => void (devAreas.get(key) === area && devAreas.delete(key));
  }, [windowId, surface]);

  if (libraryOpen) return null;
  if (!multiple && !nativePager && !(surface === "sidebar" && libraryReachable)) return null;
  return (
    <SwipeArea
      ref={area}
      style={style}
      canSwipeBack={previous || (surface === "sidebar" && libraryReachable)}
      canSwipeForward={next}
      tracksUnavailableDirections={multiple}
      isPager={multiple}
      onSwipe={onSwipe}
      nativePager={nativePager}
      onPagerPosition={nativePager && onPagerPosition}
      onPagerState={onPagerState}
    />
  );
}

export function ProfileTint() {
  const windowId = useWindowId();
  const { pages, paging, pager } = usePagerPages(windowId);
  const themes = useBrowser(useShallow((s) => pages.map((p) => profileTheme(s.profiles[p.id], s.ui.appDark))));
  if (!paging) return null;
  return (
    <>
      {pages.map((page, k) => {
        const theme = themes[k]!;
        const opacity = k === 0 ? 1 : pager.pos.interpolate({ inputRange: [pages[k - 1]!.slot, page.slot], outputRange: [0, 1], extrapolate: "clamp" });
        return (
          <Animated.View key={page.id} pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
            <WindowBackdrop vibrancy {...theme.backdrop} colors={theme.windowTint} grainOpacity={theme.grain} style={StyleSheet.absoluteFill} />
          </Animated.View>
        );
      })}
    </>
  );
}

const devAreas = new Map<string, React.RefObject<SwipeAreaHandle | null>>();
const received: object[] = [];
if (__DEV__) {
  const g = globalThis as { acSwipe?: Record<string, unknown> };
  g.acSwipe = {
    ...g.acSwipe,
    received: () => received.splice(0),
    sidebar: (windowId: string) => devAreas.get(`sidebar:${windowId}`)?.current ?? null,
    strip: (windowId: string) => devAreas.get(`strip:${windowId}`)?.current ?? null,
  };
}
