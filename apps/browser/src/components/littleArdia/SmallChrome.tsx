import { breadcrumb } from "@ardia/core";
import { FadeLabel, Symbol, Button, Text, useHover } from "../ui";
import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Pressable, View } from "react-native";
import { layout, useTheme } from "../ui/theme";
import { useTabLive } from "../../state/browser/hooks";
import { usePageProgress } from "../../state/tabs/pageProgress";
import type { Tab } from "../../state/browser/types";
import { usePage } from "../../state/tabs/pageState";
import { font, radius, space } from "../ui/tokens";
import { PAGE_PROGRESS_GROW } from "./tokens";
import { Favicon } from "../favicon/Favicon";
import { curve } from "../ui/motion";
import { SMALL_BAR_HEIGHT } from "../../state/windows/small";

export const SMALL_INSET = layout.cardInset;
export { SMALL_WINDOW_FRAME, SMALL_WINDOW_RADIUS } from "./tokens";
const MID = SMALL_BAR_HEIGHT / 2;
const FIELD_HEIGHT = 28;
export const SMALL_BAR_BUTTON = 28;
export const SMALL_BAR_GAP = 2;
export const SMALL_FIELD_GAP = 6;
const HOST = { flexShrink: 0, maxWidth: "60%" } as const;
const FLEX = { flex: 1 } as const;

export type SmallBarButton = { icon: string; size: number; tooltip: string; onPress: () => void; disabled?: boolean };

export function SmallBar({
  fieldLeft,
  fieldMaxWidth,
  field,
  buttons,
  trailing,
  children,
}: {
  fieldLeft: number;
  fieldMaxWidth?: number;
  field: ReactNode;
  buttons: SmallBarButton[];
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const count = buttons.length + (trailing ? 1 : 0);
  const buttonsWidth = count * SMALL_BAR_BUTTON + Math.max(0, count - 1) * SMALL_BAR_GAP;
  return (
    <View style={{ height: SMALL_BAR_HEIGHT }}>
      {children}
      <View style={{ position: "absolute", left: fieldLeft, right: SMALL_INSET + buttonsWidth + SMALL_FIELD_GAP, maxWidth: fieldMaxWidth, top: MID - FIELD_HEIGHT / 2, height: FIELD_HEIGHT }}>{field}</View>
      <View style={{ position: "absolute", right: SMALL_INSET, top: MID - SMALL_BAR_BUTTON / 2, flexDirection: "row", gap: SMALL_BAR_GAP }}>
        {buttons.map((b) => (
          <Button variant="icon" key={b.tooltip} icon={b.icon} size={b.size} box={SMALL_BAR_BUTTON} radius={radius.button} disabled={b.disabled} tooltip={b.tooltip} onPress={b.onPress} />
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
              width: SMALL_BAR_BUTTON,
              height: SMALL_BAR_BUTTON,
              borderRadius: radius.button,
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
  const insecure = usePage(tab.id, (p) => !!p.security && (p.security.level === "insecure" || p.security.level === "certificateError")) && !!tab.url;
  const isFile = tab.url.startsWith("file:");
  const host = !tab.url ? "" : isFile ? "File" : breadcrumb(tab.url).host;
  const title = tab.customTitle || tab.title;

  return (
    <View
      style={{
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        gap: space.m,
        paddingLeft: space.m,
        paddingRight: space.m,
        borderRadius: radius.l,
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
          <Text accessible={!!label} accessibilityLabel={label} lines={1} ellipsizeMode="head" weight="medium" style={HOST}>
            {host}
          </Text>
          {title && title !== host ? <FadeLabel text={`  ${title}`} fontSize={font.body.fontSize} color={theme.textSecondary} fadeWidth={14} style={{ flex: 1, height: 18 }} /> : null}
        </View>
      ) : (
        <Text lines={1} tone="placeholder" style={FLEX}>
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
    Animated.timing(width, { toValue: Math.max(progress, 0.08), duration: PAGE_PROGRESS_GROW, easing: curve.outQuad, useNativeDriver: false }).start();
  }, [progress]);
  return (
    <Animated.View
      style={{
        position: "absolute",
        left: space.m,
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
