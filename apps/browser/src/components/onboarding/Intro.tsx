import { DIA_SPECTRUM, Meadow, meadowTextStyle, PowerUp, type MeadowTone } from "../ui";
import {
  playIntroMusic,
  setIntroMusicMuted,
  stopIntroMusic,
  type IntroMusicCues,
  introMusicMuted,
  saveIntroMusicMuted,
} from "../../state/onboarding/onboarding";
import { isWebDemo } from "../../state/onboarding/demoSteps";
import { useEffect, useRef, useState } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../ui/theme";
import { CircleButton, SecondaryButton } from "./Buttons";
import { useOnboardingColors } from "./Parts";
import { curve } from "../ui/motion";
import { onboardingMotion, onboardingType } from "./tokens";

const WORDMARK = "Ardia";
const ICON = require("../../../assets/app-icon.png");

const LETTER = 0.52;
const TAGLINE = 0.6;
const EXIT = 0.65;
const CUES: IntroMusicCues = (() => {
  const icon = 0.25;
  const letters = 1.15;
  const letterStep = 0.055;
  const letterCount = WORDMARK.length;
  const tagline = letters + (letterCount - 1) * letterStep + LETTER + 0.15;
  const exit = tagline + TAGLINE + 1.1;
  return { icon, letters, letterStep, letterCount, tagline, exit, end: exit + EXIT };
})();

const ms = (s: number) => Math.round(s * 1000);
const OPENING_TONE: Record<"day" | "night", MeadowTone> = { day: { tone: "light", halo: 0 }, night: { tone: "dark", halo: 0 } };

export function Intro({ onDone }: { onDone: () => void }) {
  const colors = useOnboardingColors();
  const dark = useTheme().dark;
  const icon = useRef(new Animated.Value(0)).current;
  const letters = useRef([...WORDMARK].map(() => new Animated.Value(0))).current;
  const tagline = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const [muted, setMuted] = useState(introMusicMuted);
  const [tone, setTone] = useState(() => OPENING_TONE[dark ? "night" : "day"]);
  const ink = isWebDemo ? null : meadowTextStyle(tone);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    const ease = curve.outCubic;
    const at = (s: number) => ({ delay: ms(s), useNativeDriver: true });
    const sequence = Animated.parallel([
      Animated.spring(icon, { toValue: 1, friction: 7, tension: 50, ...at(CUES.icon) }),
      ...letters.map((l, i) =>
        Animated.timing(l, { toValue: 1, duration: ms(LETTER), easing: ease, ...at(CUES.letters + i * CUES.letterStep) }),
      ),
      Animated.timing(tagline, { toValue: 1, duration: ms(TAGLINE), easing: ease, ...at(CUES.tagline) }),
      Animated.timing(exit, { toValue: 1, duration: ms(EXIT), easing: curve.inOutCubic, ...at(CUES.exit) }),
    ]);
    playIntroMusic(CUES, introMusicMuted());
    sequence.start(({ finished }) => finished && finish());
    return () => sequence.stop();
  }, []);

  const skip = () => {
    stopIntroMusic(0.35);
    Animated.timing(exit, { toValue: 1, duration: onboardingMotion.introSkip, easing: curve.outQuad, useNativeDriver: true }).start(finish);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    setIntroMusicMuted(next);
    saveIntroMusicMuted(next);
  };

  const muteLabel = muted ? "Unmute intro music" : "Mute intro music";
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          opacity: exit.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
        },
      ]}
    >
      {isWebDemo ? (
        <PowerUp palette={DIA_SPECTRUM} speed={0.8} origin={0.5} style={[StyleSheet.absoluteFill, { opacity: dark ? 0.9 : 0.6 }]} />
      ) : (
        <Meadow night={dark} onTone={setTone} style={StyleSheet.absoluteFill} />
      )}
      <Animated.View
        style={{
          alignItems: "center",
          gap: 18,
          transform: [{ scale: exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }],
        }}
      >
        <Animated.View
          style={{
            opacity: icon.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: "clamp" }),
            transform: [{ scale: icon.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}
        >
          <Image source={ICON} style={{ width: 96, height: 96 }} />
        </Animated.View>
        <View style={{ flexDirection: "row" }} accessibilityLabel={WORDMARK}>
          {[...WORDMARK].map((ch, i) => (
            <Animated.Text
              key={i}
              style={{
                ...onboardingType.wordmark,
                color: colors.title,
                ...ink,
                opacity: letters[i],
                transform: [{ translateY: letters[i]!.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
              }}
            >
              {ch}
            </Animated.Text>
          ))}
        </View>
        <Animated.View style={{ opacity: tagline, transform: [{ translateY: tagline.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}>
          <Text style={{ ...onboardingType.tagline, color: colors.subtitle, ...ink }}>Your new home on the internet</Text>
        </Animated.View>
      </Animated.View>
      <View style={{ position: "absolute", left: 28, bottom: 28 }}>
        <CircleButton
          title={muteLabel}
          tooltip={muteLabel}
          icon={muted ? "speaker.slash.fill" : "speaker.wave.3.fill"}
          size={13}
          symbolWeight="medium"
          box={20}
          onPress={toggleMute}
        />
      </View>
      <View style={{ position: "absolute", right: 28, bottom: 28 }} accessibilityHint="Button that skips the onboarding intro animation">
        <SecondaryButton title="Skip" onPress={skip} />
      </View>
    </Animated.View>
  );
}
