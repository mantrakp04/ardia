import { WindowDragRegion, Surface, VisualEffect } from "../ui";
import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { hex } from "../ui/theme";
import { curve } from "../ui/motion";
import { hairline } from "../ui/tokens";
import { onboardingCard, onboardingMotion } from "./tokens";
import { useWindowId } from "../../state/browser/hooks";
import { Intro } from "./Intro";
import { dismissOnboarding, goToStep, useOnboarding } from "../../state/onboarding/onboarding";
import { LayoutStep, LookStep, TabsStep } from "./LayoutSteps";
import { SearchPrivacyStep } from "./PrivacyStep";
import { SourceStep } from "./SourceStep";
import { HomeStep } from "./HomeStep";
import { OutroStep } from "./OutroStep";
import { PinnedTabsStep } from "./PinnedTabsStep";
import { SetupCodeOutro } from "./SetupCodeOutro";
import { isWebDemo } from "../../state/onboarding/demoSteps";
import { ToolTour } from "./tour/ToolTour";
import { useOnboardingColors } from "./Parts";
import { DevResetOnboarding } from "./DevResetOnboarding";

const CARD = { width: 880, height: 560, margin: 40 };

export function OnboardingOverlay() {
  const windowId = useWindowId();
  const active = useOnboarding((s) => s.windowId === windowId);
  const session = useOnboarding((s) => s.session);
  return (
    <>
      {active ? <Overlay key={session} session={session} /> : null}
      <ToolTour />
      {__DEV__ ? <DevResetOnboarding /> : null}
    </>
  );
}

function Overlay({ session }: { session: number }) {
  const colors = useOnboardingColors();
  const step = useOnboarding((s) => s.step);
  const leaving = useOnboarding((s) => s.leaving);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const presence = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(presence, { toValue: 1, duration: onboardingMotion.overlayIn, easing: curve.outQuad, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    if (step === "intro") return card.setValue(0);
    Animated.spring(card, { toValue: 1, friction: 9, tension: 60, useNativeDriver: true }).start();
  }, [step === "intro"]);

  useEffect(() => {
    if (!leaving) return;
    Animated.parallel([
      Animated.timing(presence, { toValue: 0, duration: onboardingMotion.overlayOut, easing: curve.inCubic, useNativeDriver: true }),
      Animated.timing(card, { toValue: 2, duration: onboardingMotion.overlayOut, easing: curve.inCubic, useNativeDriver: true }),
    ]).start(({ finished }) => finished && dismissOnboarding(session));
  }, [leaving]);

  const width = Math.min(CARD.width, Math.max(0, size.width - CARD.margin * 2));
  const height = Math.min(CARD.height, Math.max(0, size.height - CARD.margin * 2));

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: presence }]}
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      <VisualEffect material="fullScreenUI" blendingMode="withinWindow" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
      <WindowDragRegion style={StyleSheet.absoluteFill} />
      {step !== "intro" && width > 0 && (
        <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]} pointerEvents="box-none">
          <Animated.View
            mouseDownCanMoveWindow={false}
            style={{
              width,
              height,
              opacity: card.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] }),
              transform: [
                { translateY: card.interpolate({ inputRange: [0, 1, 2], outputRange: [24, 0, 0] }) },
                { scale: card.interpolate({ inputRange: [0, 1, 2], outputRange: [0.97, 1, 1.03] }) },
              ],
            }}
          >
            <Surface
              fill={hex(colors.card)}
              cornerRadius={onboardingCard.radius}
              borderColor={hex(colors.cardBorder)}
              borderWidth={hairline.panel}
              shadowColor={onboardingCard.shadow.color}
              shadowOpacity={onboardingCard.shadow.opacity}
              shadowRadius={onboardingCard.shadow.radius}
              shadowOffset={onboardingCard.shadow.offset}
              style={{ flex: 1, overflow: "hidden" }}
            >
              <View key={step} style={{ flex: 1 }}>
                {step === "source" && <SourceStep />}
                {step === "layout" && <LayoutStep />}
                {step === "tabs" && <TabsStep />}
                {step === "look" && <LookStep />}
                {step === "searchPrivacy" && <SearchPrivacyStep />}
                {step === "pins" && <PinnedTabsStep />}
                {step === "home" && <HomeStep />}
                {step === "outro" && (isWebDemo ? <SetupCodeOutro /> : <OutroStep />)}
              </View>
            </Surface>
          </Animated.View>
        </View>
      )}
      {step === "intro" && <Intro onDone={() => goToStep("source")} />}
    </Animated.View>
  );
}
