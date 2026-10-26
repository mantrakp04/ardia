import { showMenu, Symbol } from "@ardia/shell";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleSheet, View, type ViewStyle } from "react-native";
import { useBrowser } from "../../store/browser";
import { useSidebarOnRight } from "../sidebar/tokens";
import { ToolbarButton, type ButtonHit } from "./controls";
import { SidebarMoveHandle } from "./SidebarMoveDrag";
import { chooseSidebarToggleMenuItem, sidebarGlyph, sidebarToggleMenuItems } from "./sidebarMove";
import type { ToolbarPalette } from "./toolbarColors";

const GLYPH_SWAP_MS = 180;
const GLYPH_SLIDE = 3;
const REMOUNT_MS = 1000;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then(
  (on) => (reduceMotion = on),
  () => {},
);
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

async function showToggleMenu(windowId: string) {
  const items = sidebarToggleMenuItems(useBrowser.getState(), windowId);
  if (items.length) chooseSidebarToggleMenuItem(await showMenu(items));
}

const devGlyphs = new Set<Animated.Value>();
const devGlyphLog: [string, boolean | null, boolean, number][] = [];
if (__DEV__) Object.assign(globalThis, { acSidebarToggleMenu: showToggleMenu, acSidebarGlyphs: devGlyphs, acSidebarGlyphLog: devGlyphLog });

export function SidebarToggleButton({
  windowId,
  style,
  hit,
  palette,
  size,
}: {
  windowId: string;
  style: ViewStyle;
  hit?: ButtonHit;
  palette: ToolbarPalette;
  size: number;
}) {
  const right = useSidebarOnRight(windowId);
  return (
    <SidebarMoveHandle windowId={windowId} style={style}>
      <ToolbarButton
        hit={hit}
        palette={palette}
        icon={sidebarGlyph(right)}
        glyph={<SidebarGlyph windowId={windowId} right={right} size={size} color={palette.icon} />}
        size={size}
        onPress={(m) => !m.ctrlKey && useBrowser.getState().toggleSidebar(windowId)}
        onContextMenu={() => void showToggleMenu(windowId)}
        tooltip="Auto-Hide Tabs (⌘S)"
      />
    </SidebarMoveHandle>
  );
}

type LeftGlyph = { right: boolean; at: number };
const leftGlyphs = new Map<string, LeftGlyph>();
const mountedGlyphs = new Map<string, boolean>();

function initialGlyphs(windowId: string, right: boolean): { from: boolean | null; to: boolean } {
  const before = mountedGlyphs.get(windowId) ?? leftGlyphs.get(windowId)?.right;
  return { from: before !== undefined && before !== right && !reduceMotion ? before : null, to: right };
}

function SidebarGlyph({ windowId, right, size, color }: { windowId: string; right: boolean; size: number; color: string }) {
  const [glyphs, setGlyphs] = useState(() => initialGlyphs(windowId, right));
  const swap = useRef(new Animated.Value(glyphs.from === null ? 1 : 0)).current;
  useEffect(() => {
    mountedGlyphs.set(windowId, glyphs.to);
    leftGlyphs.delete(windowId);
    return () => {
      if (mountedGlyphs.get(windowId) === glyphs.to) mountedGlyphs.delete(windowId);
      const left = { right: glyphs.to, at: Date.now() };
      leftGlyphs.set(windowId, left);
      setTimeout(() => leftGlyphs.get(windowId) === left && leftGlyphs.delete(windowId), REMOUNT_MS);
    };
  }, [windowId, glyphs.to]);
  useEffect(() => {
    if (!__DEV__) return;
    devGlyphs.add(swap);
    return () => void devGlyphs.delete(swap);
  }, []);
  useEffect(() => {
    if (right === glyphs.to) return;
    swap.stopAnimation();
    setGlyphs({ from: reduceMotion ? null : glyphs.to, to: right });
  }, [right]);
  useEffect(() => {
    if (glyphs.from === null) return swap.setValue(1);
    swap.setValue(0);
    const to = glyphs.to;
    if (__DEV__) devGlyphLog.push(["start", glyphs.from, to, Date.now()]);
    Animated.timing(swap, { toValue: 1, duration: GLYPH_SWAP_MS, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (__DEV__) devGlyphLog.push([finished ? "end" : "stopped", null, to, Date.now()]);
      if (finished) setGlyphs((g) => (g.to === to ? { from: null, to } : g));
    });
  }, [glyphs]);
  const shift = glyphs.to ? GLYPH_SLIDE : -GLYPH_SLIDE;
  const glyph = (name: boolean) => <Symbol name={sidebarGlyph(name)} size={size} color={color} style={StyleSheet.absoluteFill} />;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {glyphs.from !== null && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { opacity: swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ translateX: swap.interpolate({ inputRange: [0, 1], outputRange: [0, shift] }) }] },
          ]}
        >
          {glyph(glyphs.from)}
        </Animated.View>
      )}
      <Animated.View
        style={[StyleSheet.absoluteFill, glyphs.from !== null && { opacity: swap, transform: [{ translateX: swap.interpolate({ inputRange: [0, 1], outputRange: [-shift, 0] }) }] }]}
      >
        {glyph(glyphs.to)}
      </Animated.View>
    </View>
  );
}
