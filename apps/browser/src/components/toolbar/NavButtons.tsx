import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, type ViewStyle } from "react-native";
import { webviews } from "../../state/tabs/webviewHandles";
import { withLivePage } from "../../state/tabs/livePage";
import { newTab } from "../../state/tabs/actions";
import type { Tab } from "../../state/browser/types";
import { Button, curve, MouseArea, reduceMotion, reduceMotionKnown, springs, Symbol, type ButtonHit } from "../ui";

export type NavPlace = { style?: ViewStyle; hit?: ButtonHit };
import type { ClickModifiers } from "../../lib/keys";
import { closeHistoryMenu, goBack, goForward, historyItems, toggleHistoryMenu } from "../../state/tabs/navigation";
import { openModeFor, openUrl } from "../../state/bookmarks/actions";
import type { ToolbarPalette } from "../ui/toolbarColors";
import { useShortcutHint, withShortcut } from "../../state/commands/commandShortcuts";
import { GLYPH, HISTORY_BUTTON_MOTION, RELOAD_BUTTON_MOTION } from "./tokens";
import { showReloadMenu } from "../../state/site/reloadMenu";

const ICON_CENTER = { width: GLYPH, height: GLYPH, alignItems: "center" as const, justifyContent: "center" as const };
const ICON_LAYER = { ...ICON_CENTER, position: "absolute" as const };

const ReloadGlyphColor = createContext("");

function ReloadSymbol({ name }: { name: "arrow.clockwise" | "xmark" }) {
  return <Symbol name={name} size={GLYPH} weight="regular" color={useContext(ReloadGlyphColor)} style={ICON_CENTER} />;
}

const ReloadGlyph = memo(function ReloadGlyph({ loading, color, press }: { loading: boolean; color: string; press: Animated.Value }) {
  const stateMotion = useRef(new Animated.Value(loading ? 1 : 0)).current;
  const returnMotion = useRef(new Animated.Value(0)).current;
  const breatheMotion = useRef(new Animated.Value(0)).current;
  const previousLoading = useRef(loading);
  const [motionReady, setMotionReady] = useState(() => reduceMotion() !== null);
  const [motionReduced, setMotionReduced] = useState(() => reduceMotion() === true);
  useEffect(() => {
    let live = true;
    void reduceMotionKnown.then((reduced) => {
      if (!live) return;
      setMotionReduced(reduced);
      setMotionReady(true);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      setMotionReduced(reduced);
      setMotionReady(true);
    });
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    const changed = previousLoading.current !== loading;
    previousLoading.current = loading;
    if (motionReduced) {
      stateMotion.stopAnimation();
      returnMotion.stopAnimation();
      stateMotion.setValue(loading ? 1 : 0);
      returnMotion.setValue(0);
      return;
    }
    if (!changed) return;
    stateMotion.stopAnimation();
    if (loading) {
      stateMotion.setValue(0);
      returnMotion.stopAnimation();
      returnMotion.setValue(0);
      Animated.timing(stateMotion, { toValue: 1, duration: RELOAD_BUTTON_MOTION.stateIn, easing: curve.enter, useNativeDriver: true }).start();
      return;
    }
    stateMotion.setValue(1);
    returnMotion.setValue(1);
    Animated.parallel([
      Animated.timing(stateMotion, { toValue: 0, duration: RELOAD_BUTTON_MOTION.stateOut, easing: curve.enter, useNativeDriver: true }),
      Animated.timing(returnMotion, { toValue: 0, duration: RELOAD_BUTTON_MOTION.stateOut, easing: curve.enter, useNativeDriver: true }),
    ]).start();
  }, [loading, motionReduced, returnMotion, stateMotion]);
  useEffect(() => {
    if (!loading || !motionReady || motionReduced) return;
    const halfCycle = RELOAD_BUTTON_MOTION.breatheCycle / 2;
    const breathe = Animated.loop(Animated.sequence([
      Animated.timing(breatheMotion, { toValue: 1, duration: halfCycle, easing: curve.pulse, useNativeDriver: true }),
      Animated.timing(breatheMotion, { toValue: 0, duration: halfCycle, easing: curve.pulse, useNativeDriver: true }),
    ]));
    breathe.start();
    return () => {
      breathe.stop();
      breatheMotion.stopAnimation();
      breatheMotion.setValue(0);
    };
  }, [breatheMotion, loading, motionReady, motionReduced]);
  const layers = useMemo(() => {
    const reload = {
      opacity: stateMotion.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      transform: [
        { scale: stateMotion.interpolate({ inputRange: [0, 1], outputRange: [1, RELOAD_BUTTON_MOTION.hiddenScale] }) },
        { rotate: returnMotion.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${RELOAD_BUTTON_MOTION.returnRotation}deg`] }) },
      ],
    };
    const stop = { opacity: stateMotion, transform: [{ scale: stateMotion.interpolate({ inputRange: [0, 1], outputRange: [RELOAD_BUTTON_MOTION.hiddenScale, 1] }) }] };
    const breathe = {
      opacity: breatheMotion.interpolate({ inputRange: [0, 1], outputRange: [...RELOAD_BUTTON_MOTION.breatheOpacity] }),
      transform: [{ scale: breatheMotion.interpolate({ inputRange: [0, 1], outputRange: [...RELOAD_BUTTON_MOTION.breatheScale] }) }],
    };
    return (
      <Animated.View style={[ICON_CENTER, { transform: [{ scale: press }] }]}>
        <Animated.View pointerEvents="none" style={[ICON_LAYER, reload]}>
          <ReloadSymbol name="arrow.clockwise" />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[ICON_LAYER, stop]}>
          <Animated.View style={[ICON_CENTER, breathe]}>
            <ReloadSymbol name="xmark" />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    );
  }, [press, stateMotion, returnMotion, breatheMotion]);
  return <ReloadGlyphColor.Provider value={color}>{layers}</ReloadGlyphColor.Provider>;
});

export const ReloadButton = memo(function ReloadButton({
  tab,
  loading,
  palette,
  place,
  onFocus,
}: {
  tab: Pick<Tab, "id" | "url" | "windowId">;
  loading: boolean;
  palette: ToolbarPalette;
  place?: NavPlace;
  onFocus: () => void;
}) {
  const web = () => webviews.get(tab.id);
  const reloadHint = useShortcutHint("reload");
  const pressMotion = useRef(new Animated.Value(1)).current;
  const animateReloadPress = () => {
    if (reduceMotion() !== false) return;
    pressMotion.stopAnimation();
    pressMotion.setValue(RELOAD_BUTTON_MOTION.pressScale);
    Animated.spring(pressMotion, { toValue: 1, ...springs.bouncy, useNativeDriver: true }).start();
  };
  return (
    <Button variant="icon" toolbar
      style={place?.style}
      palette={palette}
      glyph={GLYPH}
      hit={place?.hit}
      disabled={!tab.url}
      onPress={(m) => {
        onFocus();
        if (loading) return void web()?.stopLoading();
        if (m.metaKey) return void newTab(tab.windowId, { url: tab.url, background: true, openerId: tab.id });
        animateReloadPress();
        void withLivePage(tab.id, (page) => (m.shiftKey ? page.forceReload() : page.reload()));
      }}
      onContextMenu={() => {
        onFocus();
        void showReloadMenu(tab.id);
      }}
      tooltip={loading ? "Stop Loading This Page" : withShortcut("Refresh", reloadHint)}
    >
      <ReloadGlyph loading={loading} color={tab.url ? palette.icon : palette.iconDisabled} press={pressMotion} />
    </Button>
  );
});

export const HistoryButton = memo(function HistoryButton({
  tabId,
  windowId,
  direction,
  disabled,
  palette,
  place,
  onFocus,
}: {
  tabId: string;
  windowId: string;
  direction: -1 | 1;
  disabled: boolean;
  palette: ToolbarPalette;
  place?: NavPlace;
  onFocus: () => void;
}) {
  const handoffMotion = useRef(new Animated.Value(0)).current;
  const icon = direction < 0 ? "chevron.left" : "chevron.right";
  const iconColor = disabled ? palette.iconDisabled : palette.icon;
  const handoffFadeOut = handoffMotion.interpolate({ inputRange: [0, HISTORY_BUTTON_MOTION.duration], outputRange: [1, 0] });
  const handoffFadeIn = handoffMotion.interpolate({ inputRange: [0, HISTORY_BUTTON_MOTION.incomingDelay, HISTORY_BUTTON_MOTION.duration], outputRange: [0, 0, 1] });
  const handoffOutX = handoffMotion.interpolate({ inputRange: [0, HISTORY_BUTTON_MOTION.duration], outputRange: [0, direction * HISTORY_BUTTON_MOTION.travel] });
  const handoffInX = handoffMotion.interpolate({ inputRange: [0, HISTORY_BUTTON_MOTION.duration], outputRange: [-direction * HISTORY_BUTTON_MOTION.travel, 0] });
  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (reduced) => {
      if (!reduced) return;
      handoffMotion.stopAnimation();
      handoffMotion.setValue(0);
    });
    return () => {
      subscription.remove();
      handoffMotion.stopAnimation();
    };
  }, [handoffMotion]);
  const animateHandoff = () => {
    if (reduceMotion() !== false) return;
    handoffMotion.stopAnimation();
    handoffMotion.setValue(0);
    Animated.timing(handoffMotion, { toValue: HISTORY_BUTTON_MOTION.duration, duration: HISTORY_BUTTON_MOTION.duration, easing: curve.enter, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      handoffMotion.setValue(0);
    });
  };
  const historyHint = useShortcutHint(direction < 0 ? "back" : "forward");
  const openMenu = () => {
    onFocus();
    toggleHistoryMenu(tabId, direction);
  };
  const onPress = async (m: ClickModifiers & { middle?: boolean }) => {
    onFocus();
    animateHandoff();
    closeHistoryMenu();
    const mode = openModeFor(m);
    if (mode === "current" || mode === "split") return direction < 0 ? goBack(tabId) : goForward(tabId);
    const [target] = await historyItems(tabId, direction, 1);
    if (target?.url) openUrl(target.url, windowId, mode);
  };
  return (
    <MouseArea style={place?.style} onMiddleClick={(e) => !disabled && void onPress({ ...e, middle: true })}>
      <Button variant="icon" toolbar
        palette={palette}
        glyph={GLYPH}
        hit={place?.hit}
        disabled={disabled}
        onPress={onPress}
        onLongPress={openMenu}
        onContextMenu={openMenu}
        tooltip={withShortcut(direction < 0 ? "Go Back" : "Go Forward", historyHint)}
      >
        <Animated.View style={ICON_CENTER}>
          <Animated.View pointerEvents="none" style={[ICON_LAYER, { opacity: handoffFadeOut, transform: [{ translateX: handoffOutX }] }]}>
            <Symbol name={icon} size={GLYPH} weight="regular" color={iconColor} style={ICON_CENTER} />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[ICON_LAYER, { opacity: handoffFadeIn, transform: [{ translateX: handoffInX }] }]}>
            <Symbol name={icon} size={GLYPH} weight="regular" color={iconColor} style={ICON_CENTER} />
          </Animated.View>
        </Animated.View>
      </Button>
    </MouseArea>
  );
});
