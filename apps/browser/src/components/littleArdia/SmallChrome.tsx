import { breadcrumb } from "@ardia/core";
import { FadeLabel, Symbol } from "@ardia/shell";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, Text, View } from "react-native";
import { useTheme } from "../../lib/theme";
import { useTabLive } from "../../store/hooks";
import { usePageProgress } from "../../store/pageProgress";
import type { Tab } from "../../store/types";
import { usePage } from "../layout/pageState";
import { Favicon, IconButton, useHover } from "../primitives";

export const SMALL_BAR_HEIGHT = 38;
export const SMALL_INSET = 6;
export const SMALL_WINDOW_RADIUS = 16;
export const SMALL_WINDOW_FRAME = {
  dark: { outerRim: "rgba(0,0,0,0.95)", innerRim: "rgba(255,255,255,0.1)", shadowOpacity: 0.66, shadowRadius: 23, shadowOffset: [0, 21] as [number, number] },
  light: { outerRim: "rgba(0,0,0,0.15)", innerRim: "rgba(255,255,255,0)", shadowOpacity: 0.38, shadowRadius: 23, shadowOffset: [0, 21] as [number, number] },
};
const MID = SMALL_BAR_HEIGHT / 2;
const FIELD_HEIGHT = 28;
const BUTTON = 28;
const BUTTON_GAP = 2;
const FIELD_GAP = 6;

export type SmallBarButton = { icon: string; size: number; tooltip: string; onPress: () => void; disabled?: boolean };

export function SmallBar({
  fieldLeft,
  field,
  buttons,
  trailing,
  children,
}: {
  fieldLeft: number;
  field: ReactNode;
  buttons: SmallBarButton[];
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const count = buttons.length + (trailing ? 1 : 0);
  const buttonsWidth = count * BUTTON + Math.max(0, count - 1) * BUTTON_GAP;
  return (
    <View style={{ height: SMALL_BAR_HEIGHT }}>
      {children}
      <View style={{ position: "absolute", left: fieldLeft, right: SMALL_INSET + buttonsWidth + FIELD_GAP, top: MID - FIELD_HEIGHT / 2, height: FIELD_HEIGHT }}>{field}</View>
      <View style={{ position: "absolute", right: SMALL_INSET, top: MID - BUTTON / 2, flexDirection: "row", gap: BUTTON_GAP }}>
        {buttons.map((b) => (
          <IconButton key={b.tooltip} icon={b.icon} size={b.size} box={BUTTON} radius={7} disabled={b.disabled} tooltip={b.tooltip} onPress={b.onPress} />
        ))}
        {trailing}
      </View>
    </View>
  );
}

export function SmallBarBadgeButton({ tooltip, onPress, children }: { tooltip: string; onPress: () => void; children: ReactNode }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  return (
    <View tooltip={tooltip} {...hoverProps}>
      <Pressable accessibilityRole="button" accessibilityLabel={tooltip} onPress={onPress}>
        {({ pressed }) => (
          <View
            style={{
              width: BUTTON,
              height: BUTTON,
              borderRadius: 7,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.toolbarPressed : hovered ? theme.toolbarHover : undefined,
            }}
          >
            {children}
          </View>
        )}
      </Pressable>
    </View>
  );
}

export function PageLabel({ tab, hovered = false, label }: { tab: Tab; hovered?: boolean; label?: string }) {
  const theme = useTheme();
  const live = useTabLive(tab.id);
  const progress = usePageProgress(tab.id);
  const insecure = usePage(tab.id, (p) => !!p.security && (p.security.level === "insecure" || p.security.level === "certificateError"));
  const isFile = tab.url.startsWith("file:");
  const host = !tab.url ? "" : isFile ? "File" : breadcrumb(tab.url).host;
  const title = tab.customTitle || tab.title;

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 8,
        paddingRight: 8,
        borderRadius: 8,
        backgroundColor: hovered ? theme.toolbarHover : undefined,
      }}
    >
      {insecure ? (
        <Symbol name="lock.open.trianglebadge.exclamationmark.fill" size={12} color={theme.textSecondary} style={{ width: 16, height: 16 }} />
      ) : tab.url ? (
        <Favicon url={tab.url} favicon={tab.favicon} profileId={tab.profileId} />
      ) : (
        <Symbol name="magnifyingglass" size={12} color={theme.placeholder} style={{ width: 16, height: 16 }} />
      )}
      {tab.url ? (
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center" }}>
          <Text
            accessible={!!label}
            accessibilityLabel={label}
            numberOfLines={1}
            style={{ flexShrink: 0, maxWidth: "60%", fontSize: 13, fontWeight: "500", color: theme.textPrimary }}
          >
            {host}
          </Text>
          {title && title !== host ? <FadeLabel text={`  ${title}`} fontSize={13} color={theme.textSecondary} fadeWidth={14} style={{ flex: 1, height: 18 }} /> : null}
        </View>
      ) : (
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.placeholder }}>
          Search or enter address
        </Text>
      )}
      {live.isLoading ? <Progress progress={progress} color={theme.accent} /> : null}
    </View>
  );
}

function Progress({ progress, color }: { progress: number; color: string }) {
  const width = useRef(new Animated.Value(Math.max(progress, 0.08))).current;
  useEffect(() => {
    Animated.timing(width, { toValue: Math.max(progress, 0.08), duration: 200, easing: Easing.out(Easing.quad), useNativeDriver: false }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: 8,
        bottom: 0,
        height: 1.5,
        borderRadius: 1,
        width: width.interpolate({ inputRange: [0, 1], outputRange: ["0%", "96%"] }),
        backgroundColor: color,
        opacity: 0.85,
      }}
    />
  );
}
