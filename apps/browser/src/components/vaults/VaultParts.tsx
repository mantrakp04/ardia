import { useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { brandAccent, brandOf } from "../../state/vaults/brands";
import { NEUTRAL_BRAND_ACCENT } from "../../state/vaults/tokens";
import { capsule, curve, ink, radius, reduceMotion, Symbol, useTheme, withAlpha } from "../ui";
import { VAULT_CODE, VAULT_MENU } from "./tokens";

export function BrandBadge({ provider, box = VAULT_MENU.badge.box, glyph = VAULT_MENU.badge.glyph, solid = false, tooltip }: { provider: string; box?: number; glyph?: number; solid?: boolean; tooltip?: string }) {
  const theme = useTheme();
  const accent = brandAccent(provider);
  return (
    <View
      tooltip={tooltip}
      style={{ width: box, height: box, borderRadius: box > VAULT_MENU.unlockBadge.box ? radius.tile : radius.control, backgroundColor: solid ? accent : withAlpha(accent, VAULT_MENU.badgeAlpha), alignItems: "center", justifyContent: "center" }}
    >
      <Symbol name={brandOf(provider).symbol} size={glyph} weight="semibold" color={solid ? theme.onAccent : accent} style={{ width: box, height: box }} />
    </View>
  );
}

export function VaultAppIcon({ provider, symbol, neutral }: { provider: string; symbol?: string; neutral?: boolean }) {
  const theme = useTheme();
  const { box, glyph, radius: corner } = VAULT_MENU.icon;
  const fill = neutral ? NEUTRAL_BRAND_ACCENT : brandAccent(provider);
  return (
    <View style={{ width: box, height: box, borderRadius: corner, backgroundColor: fill, alignItems: "center", justifyContent: "center" }}>
      <Symbol name={symbol ?? brandOf(provider).symbol} size={glyph} weight="semibold" color={theme.onAccent} style={{ width: box, height: box }} />
    </View>
  );
}

const HALF_SPAN = 180;
const QUARTER = 45;

export function CountdownRing({ expiresAt, period }: { expiresAt: number; period: number }) {
  const theme = useTheme();
  const size = VAULT_CODE.ring;
  const stroke = VAULT_CODE.stroke;
  const periodMs = Math.max(1, period * 1000);
  const elapsed = () => Math.min(1, Math.max(0, 1 - (expiresAt - Date.now()) / periodMs));
  const progress = useRef(new Animated.Value(elapsed())).current;
  const [expiring, setExpiring] = useState(expiresAt - Date.now() <= VAULT_CODE.expiringMs);
  useEffect(() => {
    const left = expiresAt - Date.now();
    const warn = setTimeout(() => setExpiring(true), Math.max(0, left - VAULT_CODE.expiringMs));
    if (reduceMotion()) {
      progress.setValue(elapsed());
      const tick = setInterval(() => progress.setValue(elapsed()), VAULT_CODE.tick);
      return () => (clearTimeout(warn), clearInterval(tick));
    }
    progress.setValue(elapsed());
    const run = Animated.timing(progress, { toValue: 1, duration: Math.max(0, left), easing: curve.linear, useNativeDriver: true });
    run.start();
    return () => (clearTimeout(warn), run.stop());
  }, [expiresAt]);
  const color = expiring ? theme.warning : theme.accent;
  const half = (rotateFrom: [number, number, number]) => ({
    position: "absolute" as const,
    width: size,
    height: size,
    borderRadius: capsule(size),
    borderWidth: stroke,
    borderTopColor: color,
    borderRightColor: color,
    borderBottomColor: ink.clear,
    borderLeftColor: ink.clear,
    transform: [{ rotate: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: rotateFrom.map((d) => `${d}deg`) }) }],
  });
  const clip = { position: "absolute" as const, top: 0, width: size / 2, height: size, overflow: "hidden" as const };
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: "absolute", width: size, height: size, borderRadius: capsule(size), borderWidth: stroke, borderColor: theme.divider }} />
      <View style={{ ...clip, left: size / 2 }}>
        <Animated.View style={{ ...half([QUARTER, QUARTER + HALF_SPAN, QUARTER + HALF_SPAN]), left: -size / 2 }} />
      </View>
      <View style={{ ...clip, left: 0 }}>
        <Animated.View style={{ ...half([QUARTER + HALF_SPAN, QUARTER + HALF_SPAN, QUARTER + 2 * HALF_SPAN]), left: 0 }} />
      </View>
    </View>
  );
}

export const formatCode = (code: string) => (code.length === 6 || code.length === 8 ? `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}` : code);
