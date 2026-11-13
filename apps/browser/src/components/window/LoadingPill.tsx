import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { useLastingLoad } from "../../state/tabs/lastingLoad";
import { notePageOverlay } from "../../state/telemetry/usage";
import { capsule, hairline, reduceMotion, useTheme } from "../ui";
import { HudPlate } from "./Hud";
import { LOADING_PILL } from "./tokens";

const { width, height, top, track, motion } = LOADING_PILL;
const FULL = 1;
const WIPED = 2;

export function LoadingPill({ tabId }: { tabId: string }) {
  const theme = useTheme();
  const loading = useLastingLoad(tabId);
  const [mounted, setMounted] = useState(loading);
  if (loading && !mounted) setMounted(true);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const cycle = useRef<{ run: Animated.CompositeAnimation; since: number } | null>(null);

  useEffect(() => {
    if (!mounted) return;
    if (loading) {
      let current = true;
      notePageOverlay("loadingPill");
      const long = setTimeout(() => notePageOverlay("loadingPillLong"), LOADING_PILL.longShowMs);
      cycle.current?.run.stop();
      scale.setValue(1);
      const grow = Animated.timing(sweep, { toValue: FULL, ...motion.sweep, useNativeDriver: true });
      const wipe = Animated.timing(sweep, { toValue: WIPED, ...motion.sweep, useNativeDriver: true });
      const run = reduceMotion() ? grow : Animated.sequence([grow, wipe, Animated.delay(motion.rest)]);
      const sweepOnce = () => {
        sweep.setValue(0);
        cycle.current = { run, since: Date.now() };
        run.start(({ finished }) => finished && current && !reduceMotion() && sweepOnce());
      };
      Animated.timing(opacity, { toValue: 1, ...motion.show, useNativeDriver: true }).start();
      sweepOnce();
      return () => {
        current = false;
        clearTimeout(long);
      };
    }
    const shrink = Animated.parallel([
      Animated.timing(opacity, { toValue: 0, ...motion.hide, useNativeDriver: true }),
      Animated.timing(scale, { toValue: LOADING_PILL.leaveScale, ...motion.hide, useNativeDriver: true }),
    ]);
    const growsFor = cycle.current ? motion.sweep.duration - (Date.now() - cycle.current.since) : 0;
    const leave = setTimeout(() => {
      cycle.current?.run.stop();
      cycle.current = null;
      sweep.setValue(FULL);
      shrink.start(({ finished }) => finished && setMounted(false));
    }, Math.max(0, growsFor));
    return () => {
      clearTimeout(leave);
      shrink.stop();
    };
  }, [loading, mounted]);

  useEffect(() => () => cycle.current?.run.stop(), []);

  if (!mounted) return null;
  const ends = capsule(track.height);
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top, alignItems: "center" }}>
      <Animated.View style={{ opacity, transform: [{ scale }] }}>
        <HudPlate
          shape="capsule"
          height={height}
          accessibilityRole="progressbar"
          accessibilityLabel="Loading page"
          style={{ width: width + 2 * hairline.panel, height: height + 2 * hairline.panel, alignItems: "center", justifyContent: "center" }}
        >
          <View style={{ width: track.width, height: track.height, borderRadius: ends, backgroundColor: theme.progressTrack, opacity: track.opacity, overflow: "hidden" }} />
          <View style={{ position: "absolute", width: track.width, height: track.height, borderRadius: ends, overflow: "hidden" }}>
            <Animated.View
              style={{
                width: track.width,
                height: track.height,
                backgroundColor: theme.textPrimary,
                opacity: track.fillOpacity,
                transform: [{ translateX: sweep.interpolate({ inputRange: [0, FULL, WIPED], outputRange: [-track.width, 0, track.width] }) }],
              }}
            />
          </View>
        </HudPlate>
      </Animated.View>
    </View>
  );
}
