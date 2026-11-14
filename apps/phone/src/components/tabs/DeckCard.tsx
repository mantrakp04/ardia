import { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { DECK, deckLeading, deckVisibleWidth, lerp, titleReveal, type DeckGeometry } from "../../lib/deckGeometry";
import { usePageTone } from "../../state/browse/hooks";
import { display } from "../../state/search/omnibox";
import type { BrowserTab } from "../../state/tabs/tabModels";
import { Favicon, font, Symbol, TabFace, tabsInk, tabsLayout, tabsMotion, useTheme } from "../ui";

export type DeckRole = "stay" | "expanded" | "launcher" | "slideLeft" | "slideRight";

export type DeckMotion = {
  scroll: SharedValue<number>;
  scaleProgress: SharedValue<number>;
  positionProgress: SharedValue<number>;
  dragIndex: SharedValue<number>;
  dragLift: SharedValue<number>;
  flyIndex: SharedValue<number>;
  flyLift: SharedValue<number>;
  flyVanish: SharedValue<number>;
};

type Props = {
  tab: BrowserTab;
  index: number;
  isLast: boolean;
  role: DeckRole;
  geometry: DeckGeometry;
  motion: DeckMotion;
  shift: { by: number; generation: number };
  onOpen: (index: number) => void;
  onClose: (index: number) => void;
};

type Pose = { x: number; y: number; scale: number; corner: number; opacity: number; header: number; visible: number; lift: number };

function cardPose(g: DeckGeometry, role: DeckRole, relative: number, sp: number, pp: number, lift: number, vanish: number, isLast: boolean): Pose {
  "worklet";
  const cx = deckLeading(g, relative) + g.cardWidth / 2;
  const cy = g.cardCenterY;
  let x = cx;
  let y = cy;
  let scale = 1;
  let corner: number = DECK.cardRadius;
  let opacity = 1;
  if (role === "expanded") {
    scale = lerp(g.width / Math.max(g.cardWidth, 1), 1, sp);
    x = lerp(g.width / 2, cx, pp);
    y = lerp(g.height / 2, cy, pp);
    corner = lerp(DECK.displayCornerRadius, DECK.cardRadius, sp);
  } else if (role === "launcher") {
    scale = lerp(DECK.launcherStartWidth / Math.max(g.cardWidth, 1), 1, sp);
    x = lerp(g.tabButtonX, cx, pp);
    y = lerp(g.barCenterY, cy, pp);
    corner = lerp(DECK.launcherStartRadius, DECK.cardRadius, sp);
    opacity = Math.min(1, sp * 2.5);
  } else if (role === "slideLeft") {
    x -= (1 - pp) * g.width * 0.7;
  } else if (role === "slideRight") {
    x += (1 - pp) * g.width;
  }
  const fade = Math.min(Math.max(vanish, 0), 1);
  y += lift;
  scale *= 1 - 0.28 * fade;
  opacity *= 1 - fade;
  const settle = role === "stay" ? 1 : Math.max(0, (pp - 0.7) / 0.3);
  const liftFade = Math.max(0, 1 + lift / 120);
  return { x, y, scale, corner, opacity, header: Math.min(1, settle) * Math.min(1, liftFade) * (1 - fade), visible: deckVisibleWidth(g, relative, isLast), lift };
}

export function DeckCard({ tab, index, isLast, role, geometry: g, motion, shift, onOpen, onClose }: Props) {
  const theme = useTheme();
  const tone = usePageTone(tab.id);
  const slot = useSharedValue(0);
  const shown = useRef(index);
  useEffect(() => {
    const by = shown.current - index + shift.by;
    shown.current = index;
    if (Math.abs(by) < 0.001) return;
    slot.value = by;
    slot.value = withSpring(0, tabsMotion.gapClose);
  }, [index, shift.generation, shift.by, slot]);

  const { scroll, scaleProgress, positionProgress, dragIndex, dragLift, flyIndex, flyLift, flyVanish } = motion;

  const cardStyle = useAnimatedStyle(() => {
    const flying = flyIndex.value === index;
    const lift = dragIndex.value === index ? dragLift.value : flying ? flyLift.value : 0;
    const p = cardPose(g, role, index + slot.value - scroll.value, scaleProgress.value, positionProgress.value, lift, flying ? flyVanish.value : 0, isLast);
    return {
      opacity: p.opacity,
      borderRadius: p.corner / Math.max(p.scale, 0.01),
      transform: [{ translateX: p.x - g.cardWidth / 2 }, { translateY: p.y - g.cardHeight / 2 }, { scale: p.scale }],
    };
  }, [g, role, index, isLast]);
  const headerStyle = useAnimatedStyle(() => {
    const flying = flyIndex.value === index;
    const lift = dragIndex.value === index ? dragLift.value : flying ? flyLift.value : 0;
    const p = cardPose(g, role, index + slot.value - scroll.value, scaleProgress.value, positionProgress.value, lift, flying ? flyVanish.value : 0, isLast);
    const top = p.y - (g.cardHeight * p.scale) / 2 - tabsLayout.headerGap - tabsLayout.headerHeight;
    return { opacity: p.header, width: p.visible, transform: [{ translateX: p.x - (g.cardWidth * p.scale) / 2 }, { translateY: top }] };
  }, [g, role, index, isLast]);
  const titleStyle = useAnimatedStyle(() => {
    const visible = deckVisibleWidth(g, index + slot.value - scroll.value, isLast);
    return { opacity: titleReveal(visible), maxWidth: Math.max(0, visible - tabsLayout.faviconSize - tabsLayout.headerSpacing) };
  }, [g, index, isLast]);

  const host = display(tab.url).host;
  const title = tab.title || host || "New Tab";
  const z = index * 2 + (role === "expanded" ? 100_000 : 0);
  return (
    <>
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityValue={{ text: tab.isPrivate ? `Incognito, ${host}` : host }}
        accessibilityHint="Opens the tab"
        accessibilityActions={[{ name: "activate" }, { name: "close", label: "Close Tab" }]}
        onAccessibilityAction={(event) => (event.nativeEvent.actionName === "close" ? onClose(index) : onOpen(index))}
        style={[
          styles.card,
          { width: g.cardWidth, height: g.cardHeight, zIndex: z, borderColor: theme.cardEdge, shadowColor: tabsInk.cardShadow },
          cardStyle,
        ]}
      >
        <TabFace tab={tab} title={title} host={host} tone={tone?.top ?? null} roles={theme} />
      </Animated.View>
      <Animated.View style={[styles.header, { zIndex: z + 1 }, headerStyle]} pointerEvents="none">
        <View style={styles.headerRow}>
          {tab.isPrivate ? (
            <View style={[styles.privateIcon, { backgroundColor: tabsInk.incognitoCardRaised }]}>
              <Symbol name="eyes" size={tabsLayout.faviconSize - 4} color={tabsInk.onDark} />
            </View>
          ) : (
            <Favicon url={tab.faviconUrl} size={tabsLayout.faviconSize} color={theme.headerText} />
          )}
          <Animated.Text style={[font.caption, styles.title, { color: theme.headerText }, titleStyle]} numberOfLines={1}>
            {title}
          </Animated.Text>
        </View>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute", left: 0, top: 0, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, elevation: 6 },
  header: { position: "absolute", left: 0, top: 0, height: tabsLayout.headerHeight, overflow: "hidden" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: tabsLayout.headerSpacing, height: tabsLayout.headerHeight },
  title: { fontWeight: "500", flexShrink: 1 },
  privateIcon: { width: tabsLayout.faviconSize, height: tabsLayout.faviconSize, borderRadius: tabsLayout.faviconRadius, alignItems: "center", justifyContent: "center" },
});
