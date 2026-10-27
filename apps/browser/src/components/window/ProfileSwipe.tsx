import { SwipeArea, type SwipeAreaHandle, type SwipeEvent, WindowBackdrop } from "../ui";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { spaceLookSource } from "../../lib/profileLook";
import { profileTheme } from "../ui/theme";
import { currentWindow } from "../../state/browser/current";
import { useProfileLooks } from "../../state/profiles/hooks";
import { useProfileNeighbours } from "../../state/windows/hooks";
import { useWindowId } from "../../state/browser/hooks";
import { pagerFor, useNativePagerPosition, usePagerNativeConfig, usePagerPages, usePagerSurface } from "../../state/windows/profilePager";


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
  const [previous, next, multiple] = useProfileNeighbours(windowId);
  const area = useRef<SwipeAreaHandle>(null);
  const pager = pagerFor(windowId);
  const nativePager = usePagerNativeConfig(windowId, pageWidth);
  const onPagerPosition = useMemo(() => Animated.event([{ nativeEvent: { position: pager.pos } }], { useNativeDriver: true }), [pager]);

  const onSwipe = (event: SwipeEvent) => {
    if (__DEV__) {
      if (received.length >= 4096) received.shift();
      received.push({ at: performance.now(), surface, profile: currentWindow(windowId)?.profileId, ...event });
    }
    const e = pageWidth ? { ...event, width: pageWidth } : event;
    if (e.phase === "swipe") return pager.step(e.direction === "back" ? -1 : 1);
    if (e.phase === "wheel") pager.wheel(e);
  };

  useEffect(() => {
    if (!__DEV__) return;
    const key = `${surface}:${windowId}`;
    devAreas.set(key, area);
    return () => void (devAreas.get(key) === area && devAreas.delete(key));
  }, [windowId, surface]);

  if (!multiple && !nativePager) return null;
  return (
    <SwipeArea
      ref={area}
      style={style}
      canSwipeBack={previous}
      canSwipeForward={next}
      tracksUnavailableDirections={multiple}
      isPager={multiple}
      onSwipe={onSwipe}
      nativePager={nativePager}
      onPagerPosition={nativePager && onPagerPosition}
      onPagerState={nativePager && pager.onNativeState}
    />
  );
}

export function ProfileTint() {
  const windowId = useWindowId();
  const { pages, paging, pager } = usePagerPages(windowId);
  useNativePagerPosition(windowId);
  const themes = useProfileLooks(pages, (profile, appDark, settings) => profileTheme(profile, appDark, spaceLookSource(settings)));
  const opacities = useMemo(
    () => pages.map((page, k) => (k === 0 ? 1 : pager.pos.interpolate({ inputRange: [pages[k - 1]!.slot, page.slot], outputRange: [0, 1], extrapolate: "clamp" }))),
    [pages, pager],
  );
  if (!paging) return null;
  return (
    <>
      {pages.map((page, k) => {
        const theme = themes[k]!;
        const opacity = opacities[k]!;
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
