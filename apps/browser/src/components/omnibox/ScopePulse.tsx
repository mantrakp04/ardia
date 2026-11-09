import type { SearchScope } from "@ardia/core";
import { memo, useEffect, useRef, useState } from "react";
import { Animated, StyleSheet } from "react-native";
import { reduceMotion, useTheme, withAlpha } from "../ui";
import { curve, duration } from "../ui/motion";
import { useFaviconAccent } from "../../state/favicons/faviconAccent";
import { brandColorFor, pulseInk } from "./pulseInk";
import { SCOPE_PULSE } from "./tokens";

export const ScopePulse = memo(function ScopePulse({ scope, shape, profileId }: { scope: SearchScope | null; shape: keyof typeof SCOPE_PULSE.radius; profileId: string }) {
  const theme = useTheme();
  const host = scope?.host ?? "";
  const brand = host ? brandColorFor(host) : null;
  const accent = useFaviconAccent(brand || !host ? "" : `https://${host}`, profileId);
  const colorPending = !!scope && !brand && accent === undefined;
  const [glow] = useState(() => new Animated.Value(scope ? SCOPE_PULSE.rest : 0));
  const [ink, setInk] = useState<string | null>(null);
  const seen = useRef(scope);
  const waiting = useRef<SearchScope | null>(null);
  const running = useRef<Animated.CompositeAnimation | null>(null);
  const color = pulseInk(brand ?? accent ?? null, { dark: theme.dark, neutral: theme.textPrimary, fallback: theme.powerUpColor ?? theme.accent });
  if (scope && color !== ink) setInk(color);

  const play = (to: SearchScope) => {
    if (waiting.current !== to) return;
    waiting.current = null;
    running.current?.stop();
    if (reduceMotion()) return glow.setValue(SCOPE_PULSE.rest);
    glow.setValue(0);
    running.current = Animated.sequence([
      Animated.timing(glow, { toValue: 1, ...SCOPE_PULSE.rise, useNativeDriver: true }),
      Animated.timing(glow, { toValue: SCOPE_PULSE.rest, ...SCOPE_PULSE.settle, useNativeDriver: true }),
    ]);
    running.current.start();
  };

  useEffect(() => {
    if (seen.current === scope) return;
    seen.current = scope;
    if (scope) {
      waiting.current = scope;
      const timer = setTimeout(() => play(scope), SCOPE_PULSE.waitForColor);
      return () => clearTimeout(timer);
    }
    waiting.current = null;
    running.current?.stop();
    if (reduceMotion()) return glow.setValue(0);
    running.current = Animated.timing(glow, { toValue: 0, duration: duration.base, easing: curve.exit, useNativeDriver: true });
    running.current.start();
  }, [scope]);

  useEffect(() => {
    if (scope && !colorPending) play(scope);
  }, [scope, colorPending]);

  useEffect(() => () => running.current?.stop(), []);

  if (!ink) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: SCOPE_PULSE.radius[shape],
          backgroundColor: withAlpha(ink, theme.dark ? SCOPE_PULSE.fill.dark : SCOPE_PULSE.fill.light),
          borderWidth: SCOPE_PULSE.ringWidth,
          borderColor: withAlpha(ink, theme.dark ? SCOPE_PULSE.ring.dark : SCOPE_PULSE.ring.light),
          opacity: glow,
        },
      ]}
    />
  );
});
