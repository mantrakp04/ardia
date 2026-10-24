import { PowerUp } from "@ardia/shaders";
import { useEffect, useState } from "react";
import { Surface } from "@ardia/shell";
import { AccessibilityInfo, Animated, StyleSheet, View } from "react-native";
import { hex, layout, useTheme } from "../lib/theme";
import { useWindowId } from "../store/hooks";
import { useCardAnchors } from "./layout/windowLayout";
import { springParams } from "./layout/swipeMotion";
import { NewTabExtras } from "./ntp";
import { useOnboarding } from "./onboarding/state";
import { Omnibox } from "./Omnibox";

const BAR_HEIGHT = 112;
const BAR_BORDER = 0.5;
const MARKS = {
  green: { back: require("../../assets/ntp-mark-back.png"), front: require("../../assets/ntp-mark-front.png"), sun: require("../../assets/ntp-mark-sun.png") },
  plum: { back: require("../../assets/ntp-mark-plum-back.png"), front: require("../../assets/ntp-mark-plum-front.png"), sun: require("../../assets/ntp-mark-plum-sun.png") },
  blue: { back: require("../../assets/ntp-mark-blue-back.png"), front: require("../../assets/ntp-mark-blue-front.png"), sun: require("../../assets/ntp-mark-blue-sun.png") },
  purple: { back: require("../../assets/ntp-mark-purple-back.png"), front: require("../../assets/ntp-mark-purple-front.png"), sun: require("../../assets/ntp-mark-purple-sun.png") },
  pink: { back: require("../../assets/ntp-mark-pink-back.png"), front: require("../../assets/ntp-mark-pink-front.png"), sun: require("../../assets/ntp-mark-pink-sun.png") },
  red: { back: require("../../assets/ntp-mark-red-back.png"), front: require("../../assets/ntp-mark-red-front.png"), sun: require("../../assets/ntp-mark-red-sun.png") },
  orange: { back: require("../../assets/ntp-mark-orange-back.png"), front: require("../../assets/ntp-mark-orange-front.png"), sun: require("../../assets/ntp-mark-orange-sun.png") },
  yellow: { back: require("../../assets/ntp-mark-yellow-back.png"), front: require("../../assets/ntp-mark-yellow-front.png"), sun: require("../../assets/ntp-mark-yellow-sun.png") },
  neutral: { back: require("../../assets/ntp-mark-neutral-back.png"), front: require("../../assets/ntp-mark-neutral-front.png"), sun: require("../../assets/ntp-mark-neutral-sun.png") },
};
const MARK_SIZE = 100;
const MARK_ABOVE_BAR = 84.1;
const SUN_DELAY = 250;
const MARK_LAYERS = [
  { name: "sun", hidden: 56, delay: SUN_DELAY, spring: springParams(0.56, 0.9) },
  { name: "back", hidden: 40.5, delay: 170, spring: springParams(0.46, 0.84) },
  { name: "front", hidden: 34, delay: 80, spring: springParams(0.42, 0.76) },
] as const;
const SUN_DRIFT = 6;
const SUN_DRIFT_SPRING = springParams(0.6, 1);
const DIA_OFFSET = 1;

type Size = { width: number; height: number };
let lastSize: { card: Size; size: Size } | null = null;
const introPlayed = new Set<string>();

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((on) => (reduceMotion = on), () => {});
AccessibilityInfo.addEventListener("reduceMotionChanged", (on) => (reduceMotion = on));

function sameSize(a: Size, b: Size) {
  return a.width === b.width && a.height === b.height;
}

export function barWidth(viewWidth: number) {
  const content = viewWidth < 708 ? (viewWidth <= 636 ? viewWidth - 20 : 616) : viewWidth < 1700 ? 652 : 774;
  return Math.min(content, viewWidth - 28);
}

export function NewTabPage({ tabId, toolbar = true }: { tabId: string; toolbar?: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const onboarding = useOnboarding((s) => s.windowId === windowId);
  const card = useCardAnchors((s) => s[windowId]);
  const [size, setSizeState] = useState<Size | null>(() => (lastSize && (!card || sameSize(lastSize.card, card)) ? lastSize.size : null));
  const setSize = (next: Size) => setSizeState((prev) => (prev && sameSize(prev, next) ? prev : next));
  useEffect(() => {
    if (size && card) lastSize = { card: { width: card.width, height: card.height }, size };
  }, [size, card?.width, card?.height]);
  const [panelHeight, setPanelHeight] = useState(BAR_HEIGHT);
  const [playIntro] = useState(() => !introPlayed.has(tabId));
  const [rise] = useState(() => {
    const intro = playIntro && !reduceMotion;
    const layers = MARK_LAYERS.map((l) => ({ ...l, y: new Animated.Value(intro ? l.hidden : 0) }));
    return { layers, drift: new Animated.Value(intro ? SUN_DRIFT : 0) };
  });
  useEffect(() => {
    introPlayed.add(tabId);
  }, [tabId]);
  useEffect(() => {
    if (!playIntro || reduceMotion) return;
    const spring = (value: Animated.Value, delay: number, params: ReturnType<typeof springParams>) =>
      Animated.spring(value, { toValue: 0, delay, ...params, useNativeDriver: true });
    const intro = Animated.parallel([
      ...rise.layers.map((l) => spring(l.y, l.delay, l.spring)),
      spring(rise.drift, SUN_DELAY, SUN_DRIFT_SPRING),
    ]);
    intro.start();
    return () => intro.stop();
  }, [playIntro, rise]);

  if (!size) return <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)} />;

  const width = barWidth(size.width);
  const x = Math.max(size.width / 2 - width / 2, 14) + DIA_OFFSET;
  const under = toolbar ? 0 : layout.toolbarHeight;
  const top = Math.max((size.height - under) / 2 - 158, 100) + 38 + DIA_OFFSET + under;

  const bar = { x, y: top, width, height: panelHeight };

  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize(e.nativeEvent.layout)}>
      {playIntro && theme.powerUpPalette && (
        <PowerUp
          style={StyleSheet.absoluteFill}
          palette={theme.powerUpPalette}
          speed={1}
          origin={0.5}
          cornerRadius={20}
          halo={bar}
        />
      )}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: size.width / 2 + DIA_OFFSET - MARK_SIZE / 2,
          top: top - MARK_ABOVE_BAR,
          width: MARK_SIZE,
          height: MARK_ABOVE_BAR,
          overflow: "hidden",
        }}
      >
        {rise.layers.map((l) => (
          <Animated.Image
            key={l.name}
            source={(MARKS[theme.profileColor === "incognito" ? "neutral" : theme.profileColor] ?? MARKS.green)[l.name]}
            style={{
              position: "absolute",
              width: MARK_SIZE,
              height: MARK_SIZE,
              transform: [{ translateX: l.name === "sun" ? rise.drift : 0 }, { translateY: l.y }],
            }}
          />
        ))}
      </View>
      <View onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)} style={{ position: "absolute", left: x, top, width }}>
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.08} shadowRadius={2} shadowOffset={[0, 0.5]} />
        <Surface style={StyleSheet.absoluteFill} fill="#00000000" cornerRadius={20} shadowColor="#000000" shadowOpacity={0.04} shadowRadius={1} shadowOffset={[0, 2]} />
        <Surface
          fill={hex(theme.ntpBarSolid)}
          cornerRadius={20}
          borderColor={hex(theme.ntpBarBorder)}
          borderWidth={BAR_BORDER}
        >
          {onboarding ? <View style={{ height: BAR_HEIGHT - 2 * BAR_BORDER }} /> : <Omnibox variant="hero" tabId={tabId} />}
        </Surface>
      </View>
      <NewTabExtras size={size} bar={bar} />
    </View>
  );
}
