import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import type { Theme } from "./theme";
import { duration as durations } from "./motion";
import { colorRoles, ink, siteToolbarRoles } from "./tokens";
import { curve } from "./motion";

export type ToolbarPalette = {
  background: string | null;
  text: string;
  secondary: string;
  icon: string;
  iconDisabled: string;
  hover: string;
  pressed: string;
  pill: string;
  divider: string;
};

function channels(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})/i.exec(color.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(color: string): number {
  const c = channels(color);
  if (!c) return 0;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isLightBackground(color: string): boolean {
  const l = luminance(color);
  return 1.05 / (l + 0.05) < (l + 0.05) / 0.05;
}

const cache = new Map<string, ToolbarPalette>();

export function toolbarPalette(theme: Theme, websiteColor: string | null): ToolbarPalette {
  const key = `${theme.dark}|${theme.textPrimary}|${websiteColor ?? ""}`;
  let palette = cache.get(key);
  if (palette) return palette;
  if (!websiteColor || !channels(websiteColor)) {
    palette = {
      background: null,
      text: theme.textPrimary,
      secondary: theme.textSecondary,
      icon: theme.icon,
      iconDisabled: theme.iconDisabled,
      hover: theme.toolbarHover,
      pressed: theme.toolbarPressed,
      pill: theme.urlPill,
      divider: theme.divider,
    };
  } else {
    const roles = isLightBackground(websiteColor) ? siteToolbarRoles.onLight : siteToolbarRoles.onDark;
    palette = { background: websiteColor.slice(0, 7), ...roles };
  }
  cache.set(key, palette);
  return palette;
}

const siteThemes = new WeakMap<Theme, WeakMap<ToolbarPalette, Theme>>();

export function siteScopedTheme(theme: Theme, palette: ToolbarPalette): Theme {
  if (!palette.background) return theme;
  let byPalette = siteThemes.get(theme);
  if (!byPalette) siteThemes.set(theme, (byPalette = new WeakMap()));
  let scoped = byPalette.get(palette);
  if (scoped) return scoped;
  const light = isLightBackground(palette.background);
  scoped = {
    ...theme,
    dark: !light,
    faviconTile: (light ? colorRoles.light : colorRoles.dark).faviconTile,
    textPrimary: palette.text,
    textTab: palette.text,
    textSecondary: palette.secondary,
    textTertiary: palette.secondary,
    icon: palette.icon,
    iconDisabled: palette.iconDisabled,
    toolbarHover: palette.hover,
    toolbarPressed: palette.pressed,
    divider: palette.divider,
  };
  byPalette.set(palette, scoped);
  return scoped;
}

export function useEasedColor(color: string | null, duration: number = durations.colorEase) {
  const progress = useRef(new Animated.Value(1)).current;
  const from = useRef<string>(color ?? ink.clear);
  const to = useRef<string>(color ?? ink.clear);
  const target = color ? color.slice(0, 7) : `${to.current.slice(0, 7)}00`;
  if (target !== to.current) {
    from.current = to.current;
    to.current = target;
  }
  useEffect(() => {
    if (from.current === to.current) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [target]);
  return progress.interpolate({ inputRange: [0, 1], outputRange: [from.current, to.current] });
}
