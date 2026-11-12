import { useRef } from "react";
import { Pressable, View } from "react-native";
import { profileNameColor, useTheme } from "../ui/theme";
import { useIsIncognito, useProfiles, useWindowId, useWindowProfile } from "../../state/browser/hooks";
import { setMeasuredWidth, useMeasuredWidth } from "../../state/windows/measuredWidths";
import { ContextMenuArea, radius, space, Symbol, Text, useHover } from "../ui";
import { openProfileItemMenu } from "./profileMenu";
import { openProfileMenu } from "../../state/browser/actions";

import { iconSymbol } from "../../lib/customIcon";
import { profileMark } from "../../lib/profileInitial";
import { SwitcherMark } from "./ProfileIcons";
import { profileIndicatorLayout } from "./profileIndicatorLayout";

const HEIGHT = 34;
export const PROFILE_INDICATOR_X = 84;

function useIndicator(room: number) {
  const theme = useTheme();
  const incognito = useIsIncognito();
  const profiles = useProfiles();
  const profile = useWindowProfile();
  const title = incognito ? "Incognito" : profile.name;
  const textWidth = useMeasuredWidth(`profile-name|${title}`);
  const { shown, pad, width } = profileIndicatorLayout(room, textWidth, incognito || profiles.length >= 2);
  const color = incognito ? theme.textPrimary : profileNameColor(profile, theme.dark);
  return { incognito, title, textWidth, shown, pad, width, color, profileId: profile.id, mark: profileMark(profile) };
}

export const useProfileIndicatorWidth = (room: number) => useIndicator(room).width;

export function ProfileIndicator({ room, expanded = false, sidebarRow = false }: { room: number; expanded?: boolean; sidebarRow?: boolean }) {
  const theme = useTheme();
  const windowId = useWindowId();
  const { hovered, hoverProps } = useHover();
  const { incognito, title, textWidth, shown, pad, width, color, profileId, mark } = useIndicator(room);
  const indicator = useRef<View>(null);
  if (!shown) return null;

  return (
    <View {...hoverProps} ref={indicator} tooltip={incognito ? undefined : title}>
      <View pointerEvents="none" style={{ position: "absolute", width: 1000, height: 0, overflow: "hidden", opacity: 0 }}>
        <Text
          numberOfLines={1}
          weight="semibold"
          style={{ alignSelf: "flex-start" }}
          onLayout={(e) => setMeasuredWidth(`profile-name|${title}`, Math.ceil(e.nativeEvent.layout.width))}
        >
          {title}
        </Text>
      </View>
      <ContextMenuArea onContextMenu={() => !incognito && void openProfileItemMenu(profileId, "sidebar", windowId, indicator.current)}>
        <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={() => !incognito && void openProfileMenu(windowId)} disabled={incognito}>
          {({ pressed }) => (
            <View
              style={{
                height: HEIGHT,
                width: expanded ? room : width,
                borderRadius: radius.chrome,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: sidebarRow ? "flex-start" : "center",
                paddingHorizontal: sidebarRow ? space.m : pad,
                gap: sidebarRow ? space.m : 0,
                backgroundColor: incognito ? undefined : pressed ? theme.tabPressed : hovered ? theme.tabHover : undefined,
              }}
            >
              {sidebarRow ? iconSymbol(mark) ? (
                <View style={{ width: 16, alignItems: "center", justifyContent: "center" }}><SwitcherMark icon={mark} color={color} scale={0.875} /></View>
              ) : (
                <Text numberOfLines={1} weight="semibold" style={{ width: 16, textAlign: "center", color }}>{mark}</Text>
              ) : null}
              {textWidth ? (
                <Text numberOfLines={1} ellipsizeMode="tail" weight="semibold" style={{ flexShrink: 1, flexGrow: sidebarRow ? 1 : 0, color }}>
                  {title}
                </Text>
              ) : null}
              {sidebarRow && !incognito ? <Symbol name="chevron.down" size={10} color={theme.textSecondary} style={{ transform: [{ translateY: -1 }] }} /> : null}
            </View>
          )}
        </Pressable>
      </ContextMenuArea>
    </View>
  );
}
