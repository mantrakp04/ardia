import { useEffect, useRef, type ReactNode } from "react";
import { GlassBacking, useSolidFill } from "./GlassBacking";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { PROFILE_COLORS } from "../ui/theme";
import { useTabLayout, useWindow } from "../../state/browser/hooks";
import { choosePresetColor } from "../../state/profiles/themeActions";
import { themeAccent } from "../../lib/profileLook";
import { CompactThemeEditor, CustomSwatch, useThemeDraft } from "../settings/ThemeEditor";
import { settingsInk } from "../settings/tokens";
import { toggleTabLayout } from "../../state/splits/actions";
import type { ProfileColor, ProfileTheme } from "../../state/browser/types";
import { Radio, useHover } from "../ui";
import { useOnboardingColors } from "./Parts";
import { curve } from "../ui/motion";
import { font, weight } from "../ui/tokens";
import { onboardingMotion, onboardingType } from "./tokens";

export const PERSONALIZE_COPY = {
  title: "Make it yours",
  subtitle: "Pick the theme color and layout that feel right for you.",
  layouts: "Choose how you would like to view your tabs:",
} as const;

const COLORS = Object.keys(PROFILE_COLORS) as ProfileColor[];

export function ThemeColorPicker({
  windowId,
  size = 30,
  gap = size >= 30 ? 8 : 6,
  onPick,
  onTheme,
}: {
  windowId: string;
  size?: number;
  gap?: number;
  onPick?: (color: ProfileColor) => void;
  onTheme?: (theme: ProfileTheme) => void;
}) {
  const profileId = useWindow(windowId, (w) => w?.profileId);
  const incognito = useWindow(windowId, (w) => w?.kind === "private");
  const look = useThemeDraft(profileId ?? "", (theme) => onTheme?.(theme));
  if (!profileId || incognito || !look.profile) return null;
  const { custom } = look;
  return (
    <View style={{ gap: 22 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap }} accessibilityRole="radiogroup" accessibilityLabel="Theme color">
        {COLORS.map((c) => (
          <ColorButton
            key={c}
            name={PROFILE_COLORS[c].name}
            ring={PROFILE_COLORS[c].swatch}
            fill={PROFILE_COLORS[c].swatch}
            size={size}
            selected={!custom && look.profile?.color === c}
            onPress={() => (onPick ? onPick(c) : choosePresetColor(profileId, c))}
          />
        ))}
        {onTheme ? (
          <ColorButton name="Custom" ring={custom ? themeAccent(custom) : settingsInk.customSwatch} fill={<CustomSwatch theme={custom} />} size={size} selected={!!custom} onPress={look.startCustom} />
        ) : null}
      </View>
      {onTheme && custom ? (
        <FadeIn>
          <CompactThemeEditor theme={custom} onChange={look.change} />
        </FadeIn>
      ) : null}
    </View>
  );
}

function FadeIn({ children }: { children: ReactNode }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: onboardingMotion.swatch, easing: curve.outQuad, useNativeDriver: true }).start();
  }, []);
  return <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }] }}>{children}</Animated.View>;
}

function ColorButton({ name, ring, fill, size, selected, onPress }: { name: string; ring: string; fill: string | ReactNode; size: number; selected: boolean; onPress: () => void }) {
  const { hovered, hoverProps } = useHover();
  const t = useRef(new Animated.Value(selected ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, { toValue: selected ? 1 : 0, duration: onboardingMotion.swatch, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [selected]);
  return (
    <View {...hoverProps} tooltip={name}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={name}>
        {({ pressed }) => (
          <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center", transform: [{ scale: pressed ? 0.94 : 1 }] }}>
            <Animated.View
              style={{
                position: "absolute",
                width: size,
                height: size,
                borderRadius: size / 2,
                borderWidth: 2,
                borderColor: ring,
                opacity: t,
              }}
            />
            <Animated.View
              style={{
                width: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                height: t.interpolate({ inputRange: [0, 1], outputRange: [size - (hovered ? 6 : 8), size - 12] }),
                borderRadius: size / 2,
                overflow: "hidden",
                backgroundColor: typeof fill === "string" ? fill : undefined,
                opacity: hovered || selected ? 1 : 0.85,
              }}
            >
              {typeof fill === "string" ? null : fill}
            </Animated.View>
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function TabLayoutPicker({ windowId }: { windowId: string }) {
  const layout = useTabLayout(windowId);
  const pick = (next: "sidebar" | "top") => {
    if (next !== layout) toggleTabLayout(windowId);
  };
  return (
    <View style={{ flexDirection: "row", gap: 10 }} accessibilityRole="radiogroup" accessibilityLabel="Tab layout">
      <LayoutButton kind="sidebar" title="Sidebar" subtitle="Tabs down the side" selected={layout === "sidebar"} onPress={() => pick("sidebar")} />
      <LayoutButton kind="top" title="Classic" subtitle="Tabs along the top" selected={layout === "top"} onPress={() => pick("top")} />
    </View>
  );
}

function LayoutButton({ kind, title, subtitle, selected, onPress }: { kind: "sidebar" | "top"; title: string; subtitle: string; selected: boolean; onPress: () => void }) {
  const solidFill = useSolidFill();
  const colors = useOnboardingColors();
  const { hovered, hoverProps } = useHover();
  const bar = { backgroundColor: colors.progressTrack, borderRadius: 2 };
  return (
    <View {...hoverProps} style={{ flex: 1 }}>
      <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={title}>
        {({ pressed }) => (
          <View
            mouseDownCanMoveWindow={false}
            style={{
              padding: 10,
              gap: 10,
              borderRadius: 12,
              backgroundColor: solidFill(hovered || selected ? colors.button : colors.row),
              borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth * 2,
              borderColor: selected ? colors.title : colors.rowBorder,
              transform: [{ scale: pressed ? 0.98 : 1 }],
            }}
          >
            <GlassBacking radius={12} border={selected ? 1.5 : StyleSheet.hairlineWidth * 2} raised={selected} highlight={hovered || selected ? colors.outlinedHover : null} />
            <View style={{ height: 64, borderRadius: 7, padding: 5, gap: 4, backgroundColor: colors.preview, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder, flexDirection: kind === "sidebar" ? "row" : "column" }}>
              {kind === "sidebar" ? (
                <View style={{ width: "26%", gap: 3, paddingTop: 7 }}>
                  {[1, 0.8, 0.9].map((w, i) => (
                    <View key={i} style={[bar, { height: 5, width: `${w * 100}%`, opacity: i === 0 ? 1 : 0.6 }]} />
                  ))}
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 3, height: 7, paddingLeft: 12 }}>
                  {[0, 1, 2].map((i) => (
                    <View key={i} style={[bar, { width: "22%", height: 7, opacity: i === 0 ? 1 : 0.6 }]} />
                  ))}
                </View>
              )}
              <View style={{ flex: 1, borderRadius: 4, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.previewBorder }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Radio on={selected} look="ring" />
              <View style={{ flex: 1 }}>
                <Text style={{ ...onboardingType.bodyCompact, fontWeight: weight.medium, color: colors.title }}>{title}</Text>
                <Text style={{ ...font.caption, color: colors.rowSubtitle }}>{subtitle}</Text>
              </View>
            </View>
          </View>
        )}
      </Pressable>
    </View>
  );
}
