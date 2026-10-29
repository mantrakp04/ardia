import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "../ui/theme";
import { pageHostLabel } from "../../lib/url";
import { useSettings, useTab, useTabLive } from "../../state/browser/hooks";
import { useBrowserWhile, useStoreWhile } from "../../state/tabs/tabWatch";
import type { ToolbarGeometry } from "../window/geometry";
import { toolbarPalette, useEasedColor } from "../ui/toolbarColors";
import { useToolbarHeld } from "../../state/app/transientUi";
import { revealToolbar, setToolbarPeek, STRIP_HEIGHT, toolbarMode, useToolbarAutoHide, type ToolbarMode } from "../../state/windows/toolbarAutoHide";
import { Toolbar } from "./Toolbar";
import { curve } from "../ui/motion";
import { font, reduceMotion, weight } from "../ui";
import { TOOLBAR_MOTION } from "./tokens";
import { motionStep, tallPage, type MotionValue, type TallPage } from "./toolbarMotion";
import { useToolbarRow } from "./useToolbarRow";

const HIDE_MS = TOOLBAR_MOTION.hide;
const HIDE_EASING = curve.outQuad;
const SHOW_MS = TOOLBAR_MOTION.show;
const SHOW_EASING = curve.outCubic;
const PEEK_DELAY = 150;
const UNPEEK_DELAY = 250;
const SHRINK = 0.94;

export function useToolbarMode(tabId: string, windowId: string, enabled: boolean): ToolbarMode {
  const scrolledDown = useStoreWhile(useToolbarAutoHide, enabled, (s) => !!s.scrolledDown[tabId]);
  const down = enabled && scrolledDown;
  const peek = useStoreWhile(useToolbarAutoHide, down, (s) => !!s.peek[tabId]);
  const hasPage = useBrowserWhile(down, (s) => !!s.tabs[tabId]?.url);
  const held = useToolbarHeld(windowId, tabId, down);
  return toolbarMode({ enabled, hasPage, scrolledDown, peek, needsBar: held });
}

type ToolbarMotion = {
  bar: Animated.Value;
  fade: Animated.Value;
  groupStyle: Animated.WithAnimatedValue<ViewStyle>;
  pageHeight: number;
  bottomStyle: Animated.WithAnimatedValue<ViewStyle>;
};

export function useToolbarMotion({
  enabled,
  mode,
  height,
  extra,
  doc,
}: {
  enabled: boolean;
  mode: ToolbarMode;
  height: number;
  extra: number;
  doc: string;
}): ToolbarMotion {
  const collapsed = mode !== "shown";
  const shownTop = useToolbarRow().height + extra;
  const room = shownTop - STRIP_HEIGHT;
  const [tallState, setTall] = useState<TallPage>({ on: collapsed, doc });
  const tall = tallPage(tallState, { enabled, collapsed, doc });
  if (tall !== tallState) setTall(tall);
  const latest = useRef({ collapsed, doc });
  latest.current = { collapsed, doc };
  const fitShownPage = () => {
    if (!latest.current.collapsed) setTall({ on: false, doc: latest.current.doc });
  };

  const values = useRef<Record<MotionValue, Animated.Value>>(null as never);
  const initial = useRef({ page: collapsed ? 1 : 0, bar: mode === "collapsed" ? 1 : 0 }).current;
  if (!values.current) {
    values.current = {
      page: new Animated.Value(initial.page),
      laid: new Animated.Value(initial.page),
      bar: new Animated.Value(initial.bar),
      fade: new Animated.Value(initial.bar),
    };
    const { page, bar, fade } = values.current;
    for (const a of [page, bar, fade]) a.addListener(() => {});
  }
  const v = values.current;
  const translateY = useMemo(() => Animated.multiply(Animated.subtract(v.laid, v.page), room), [room]);
  const bottomShift = useMemo(() => (tall.on ? Animated.multiply(Animated.subtract(v.page, 1), room) : 0), [tall.on, room]);
  useEffect(() => {
    const keep = (a: Animated.Value, value: number) => Animated.timing(a, { toValue: value, duration: TOOLBAR_MOTION.settle, useNativeDriver: true });
    Animated.parallel([keep(v.page, initial.page), keep(v.laid, initial.page), keep(v.bar, initial.bar), keep(v.fade, initial.bar)]).start();
  }, []);
  const was = useRef(mode);
  useLayoutEffect(() => {
    const step = motionStep(was.current, mode, reduceMotion() === true);
    was.current = mode;
    if (!step) return;
    for (const [name, value] of Object.entries(step.set)) v[name as MotionValue].setValue(value);
    const glides = Object.entries(step.glide).map(([name, value]) =>
      Animated.timing(v[name as MotionValue], { toValue: value, duration: step.show ? SHOW_MS : HIDE_MS, easing: step.show ? SHOW_EASING : HIDE_EASING, useNativeDriver: true }),
    );
    if (glides.length) Animated.parallel(glides).start(({ finished }) => finished && step.fit === "afterGlide" && fitShownPage());
    if (step.fit === "now") fitShownPage();
  }, [mode]);

  return {
    bar: v.bar,
    fade: v.fade,
    groupStyle: {
      position: "absolute",
      left: 0,
      right: 0,
      top: (collapsed ? STRIP_HEIGHT : shownTop) - extra,
      transform: [{ translateY }],
    },
    pageHeight: height - (tall.on ? STRIP_HEIGHT : shownTop),
    bottomStyle: { transform: [{ translateY: bottomShift }] },
  };
}

function useMovedOnce(mode: ToolbarMode) {
  const [moved, setMoved] = useState(mode !== "shown");
  if (!moved && mode !== "shown") setMoved(true);
  return moved;
}

export function AutoHideBackdrop({ tabId, mode, motion }: { tabId: string; mode: ToolbarMode; motion: Pick<ToolbarMotion, "bar"> }) {
  const theme = useTheme();
  const url = useTab(tabId, (t) => t?.url ?? "");
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const palette = toolbarPalette(theme, extendColor && url ? themeColor : null);
  const band = useEasedColor(palette.background);
  const { bar } = motion;
  const H = useToolbarRow().height;
  const moved = useMovedOnce(mode);
  const anim = useMemo(
    () =>
      moved && {
        bandScale: bar.interpolate({ inputRange: [0, 1], outputRange: [1, STRIP_HEIGHT / H] }),
        bandLift: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -(H - STRIP_HEIGHT) / 2] }),
        dividerTop: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -(H - STRIP_HEIGHT)] }),
      },
    [moved, bar, H],
  );
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: H }}>
      <Animated.View
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: H, backgroundColor: theme.card, transform: anim ? [{ translateY: anim.bandLift }, { scaleY: anim.bandScale }] : undefined }}
      >
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: band }]} />
      </Animated.View>
      {url ? (
        <Animated.View
          style={{ position: "absolute", left: 0, right: 0, top: H - 1, height: 1, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.divider, transform: anim ? [{ translateY: anim.dividerTop }] : undefined }}
        />
      ) : null}
    </View>
  );
}

export function AutoHideToolbar({
  tabId,
  windowId,
  geometry,
  inSplit,
  focused,
  mode,
  motion,
}: {
  tabId: string;
  windowId: string;
  geometry: ToolbarGeometry;
  inSplit: boolean;
  focused: boolean;
  mode: ToolbarMode;
  motion: Pick<ToolbarMotion, "bar" | "fade">;
}) {
  const theme = useTheme();
  const url = useTab(tabId, (t) => t?.url ?? "");
  const themeColor = useTabLive(tabId, (l) => l.themeColor);
  const extendColor = useSettings((s) => s.extendWebsiteColor);
  const palette = toolbarPalette(theme, extendColor && url ? themeColor : null);
  const collapsed = mode === "collapsed";
  const modeNow = useRef(mode);
  modeNow.current = mode;

  const peekTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(peekTimer.current), [tabId]);
  const peekLater = (on: boolean, ms: number) => {
    clearTimeout(peekTimer.current);
    peekTimer.current = setTimeout(() => setToolbarPeek(tabId, on), ms);
  };

  const { bar, fade } = motion;
  const H = useToolbarRow().height;
  const moved = useMovedOnce(mode);
  const anim = useMemo(
    () =>
      moved && {
        controls: fade.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 1], outputRange: [1, 0.45, 0.15, 0, 0] }),
        label: fade.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, 0, 1] }),
        shrink: [
          { translateY: bar.interpolate({ inputRange: [0, 1], outputRange: [0, -((1 - SHRINK) * H) / 2 - 3] }) },
          { scale: bar.interpolate({ inputRange: [0, 1], outputRange: [1, SHRINK] }) },
        ],
      },
    [moved, bar, fade, H],
  );
  const host = pageHostLabel(url);

  return (
    <View pointerEvents="box-none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: H }}>
      <Animated.View
        pointerEvents={collapsed ? "none" : "box-none"}
        onMouseEnter={() => modeNow.current === "peek" && clearTimeout(peekTimer.current)}
        onMouseLeave={() => modeNow.current === "peek" && peekLater(false, UNPEEK_DELAY)}
        style={{ position: "absolute", left: 0, right: 0, top: 0, height: H, opacity: anim ? anim.controls : 1, transform: anim ? anim.shrink : undefined }}
      >
        <Toolbar tabId={tabId} geometry={geometry} windowId={windowId} inSplit={inSplit} focused={focused} bare />
      </Animated.View>
      {anim && (
        <Animated.View pointerEvents={collapsed ? "auto" : "none"} style={{ position: "absolute", left: 0, right: 0, top: 0, height: STRIP_HEIGHT, opacity: anim.label }}>
          <Pressable
            onPress={() => {
              clearTimeout(peekTimer.current);
              revealToolbar(tabId);
            }}
            onMouseEnter={() => modeNow.current === "collapsed" && peekLater(true, PEEK_DELAY)}
            onMouseLeave={() => modeNow.current === "collapsed" && clearTimeout(peekTimer.current)}
            tooltip="Show Toolbar"
            style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 }}
          >
            <Text numberOfLines={1} ellipsizeMode="head" style={{ ...font.caption, fontWeight: weight.medium, color: palette.secondary }}>
              {host}
            </Text>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}
