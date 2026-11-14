import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInLeft, SlideInRight, useAnimatedStyle, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { advanceOnboarding, finishOnboarding, useOnboarding } from "../../state/onboarding/hooks";
import { refreshSettings, setBlockingCategory, useBlocking } from "../../state/settings/actions";
import { ArdiaLogo, Backdrop, capsule, font, radius, settingsLayout, settingsTint, space, spring, Symbol, tabsMotion, useTheme, type SymbolName } from "../ui";
import { ToggleRow } from "../settings/SettingsKit";
import { SyncConnect } from "../sync/SyncConnect";
import { useSyncConnected } from "../../state/sync/hooks";

const welcomeSpring = spring(0.7, 0.7);
const WELCOME_DELAY_MS = 100;

export function OnboardingView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const showing = useOnboarding((s) => s.showing);
  const step = useOnboarding((s) => s.step);
  const forward = useOnboarding((s) => s.forward);
  useEffect(() => {
    if (showing) void refreshSettings();
  }, [showing]);
  if (!showing) return null;
  return (
    <Animated.View exiting={FadeOut.duration(tabsMotion.surfaceFade)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}>
      <Backdrop colors={theme.backdrop} />
      <Animated.View
        key={step}
        entering={(forward ? SlideInRight : SlideInLeft).springify().stiffness(tabsMotion.sheetIn.stiffness).damping(tabsMotion.sheetIn.damping)}
        style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        {step === "welcome" ? <Welcome /> : step === "blocking" ? <Blocking /> : step === "sync" ? <SyncStep /> : <AllSet />}
      </Animated.View>
    </Animated.View>
  );
}

function SyncStep() {
  const theme = useTheme();
  const connected = useSyncConnected();
  const [connecting, setConnecting] = useState(false);
  return (
    <>
      <Page
        title={
          <>
            Every tab, <Text style={{ color: theme.formAccent }}>anywhere</Text>.
          </>
        }
        subtitle={connected ? "Connected." : "Your Mac’s tabs, right here. End-to-end encrypted."}
        illustration={
          <View style={[styles.card, styles.syncArt, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
            <Symbol name={connected ? "checkmarkCircle" : "macAndPhone"} size={64} color={connected ? theme.switchOn : theme.formAccent} />
          </View>
        }
      >
        {connected ? (
          <Primary title="Continue" onPress={advanceOnboarding} />
        ) : (
          <>
            <Primary title="Connect to Your Mac" onPress={() => setConnecting(true)} />
            <Secondary title="Not Now" onPress={advanceOnboarding} />
          </>
        )}
      </Page>
      {connecting ? (
        <View style={StyleSheet.absoluteFill}>
          <SyncConnect closes onClose={() => setConnecting(false)} onConnected={() => setConnecting(false)} />
        </View>
      ) : null}
    </>
  );
}

function Secondary({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.secondary}>
      <Text style={[font.body, styles.bold, { color: theme.label }]}>{title}</Text>
    </Pressable>
  );
}

function Primary({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.primary, { backgroundColor: theme.label }]}>
      <Text style={[font.body, styles.bold, { color: theme.groupFill }]}>{title}</Text>
    </Pressable>
  );
}

function Welcome() {
  const theme = useTheme();
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.value = withDelay(WELCOME_DELAY_MS, withSpring(1, welcomeSpring));
  }, [appear]);
  const logo = useAnimatedStyle(() => ({
    opacity: Math.min(Math.max(appear.value, 0), 1),
    transform: [{ rotate: `${-18 + 12 * appear.value}deg` }, { scale: 0.7 + 0.3 * appear.value }],
  }));
  const words = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(appear.value, 0), 1), transform: [{ translateY: (1 - appear.value) * 16 }] }));
  return (
    <View style={styles.column}>
      <View style={styles.fill} />
      <Animated.View style={[styles.logo, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }, logo]}>
        <ArdiaLogo width={settingsLayout.onboardingIcon} />
      </Animated.View>
      <Animated.View style={[styles.words, words]}>
        <Text accessibilityRole="header" style={[font.hero, styles.heavy, { color: theme.label }]}>
          Meet your new favorite browser
        </Text>
        <Text style={[font.title3, styles.centered, { color: theme.secondaryLabel }]}>Get what you want twice as fast.</Text>
      </Animated.View>
      <View style={styles.fill} />
      <View style={styles.actions}>
        <Primary title="Get Started" onPress={advanceOnboarding} />
      </View>
    </View>
  );
}

function Page({ title, subtitle, illustration, children }: { title: ReactNode; subtitle: string; illustration: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.column}>
      <View style={styles.illustration}>{illustration}</View>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={[font.largeTitle, styles.heavy, { color: theme.label }]}>
          {title}
        </Text>
        <Text style={[font.body, styles.centered, { color: theme.secondaryLabel }]}>{subtitle}</Text>
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

function Blocking() {
  const theme = useTheme();
  const state = useBlocking((s) => s.state);
  return (
    <Page
      title={
        <>
          Never see another <Text style={{ color: theme.formAccent }}>ad</Text>.
        </>
      }
      subtitle="Trackers and cookie banners too."
      illustration={
        <View style={[styles.card, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
          <ToggleRow title="Block Ads" icon="handRaised" tint={settingsTint.ads} value={state?.blocksAds ?? true} divider onChange={(on) => setBlockingCategory("ads", on)} />
          <ToggleRow title="Block Trackers" icon="eyeglasses" tint={settingsTint.trackers} value={state?.blocksTrackers ?? true} divider onChange={(on) => setBlockingCategory("trackers", on)} />
          <ToggleRow title="Block Cookie Banners" icon="listBulletFill" tint={settingsTint.cookies} value={state?.hidesCookieBanners ?? true} onChange={(on) => setBlockingCategory("cookieBanners", on)} />
        </View>
      }
    >
      <Primary title="Continue" onPress={advanceOnboarding} />
    </Page>
  );
}

const TIPS: { icon: SymbolName; text: string }[] = [
  { icon: "plus", text: "Tap + to search." },
  { icon: "squareOnSquare", text: "Flick a tab up to close it." },
  { icon: "chevronLeft", text: "Swipe the bar to switch tabs." },
  { icon: "archivebox", text: "Old tabs archive after a day." },
];

function AllSet() {
  const theme = useTheme();
  return (
    <Page
      title="You’re all set!"
      subtitle="Happy browsing."
      illustration={
        <Animated.View entering={FadeIn.duration(tabsMotion.surfaceFade)} style={[styles.card, styles.tips, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
          {TIPS.map((tip) => (
            <View key={tip.text} style={styles.tip}>
              <View style={styles.tipIcon}>
                <Symbol name={tip.icon} size={20} color={theme.formAccent} />
              </View>
              <Text style={[font.subheadline, { color: theme.label }]}>{tip.text}</Text>
            </View>
          ))}
        </Animated.View>
      }
    >
      <Primary title="Start Browsing" onPress={finishOnboarding} />
    </Page>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, alignItems: "stretch", gap: space.xxl },
  fill: { flex: 1 },
  logo: { alignSelf: "center", padding: space.l, borderRadius: settingsLayout.onboardingIcon * 0.3, elevation: 12, shadowOpacity: 1, shadowRadius: 24 },
  words: { paddingHorizontal: space.huge, gap: space.s, alignItems: "center" },
  heavy: { fontWeight: "700", textAlign: "center" },
  centered: { textAlign: "center" },
  bold: { fontWeight: "600" },
  actions: { paddingHorizontal: space.xxl, paddingBottom: space.m, gap: space.s },
  primary: { minHeight: settingsLayout.primaryButton, borderRadius: capsule(settingsLayout.primaryButton), alignItems: "center", justifyContent: "center" },
  illustration: { flex: 1, justifyContent: "flex-end", paddingHorizontal: space.l },
  card: { borderRadius: radius.card, paddingVertical: space.xs, elevation: 8, shadowOpacity: 0.4, shadowRadius: 16 },
  syncArt: { alignSelf: "center", padding: space.huge, alignItems: "center" },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  tips: { paddingHorizontal: space.xl, paddingVertical: space.xl, gap: space.xl },
  tip: { flexDirection: "row", alignItems: "center", gap: space.m },
  tipIcon: { width: 28, alignItems: "center" },
});
