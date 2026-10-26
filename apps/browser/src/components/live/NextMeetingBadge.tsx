import { memo, useEffect, useRef, useState } from "react";
import { Animated, View } from "react-native";
import { space, Text, useTheme } from "../ui";
import { useCalendar, useNow } from "../../state/live/calendar";
import { badgeText, isCalendarUrl } from "../../state/live/meetings";
import { useLive } from "../../state/live/store";
import { useTab } from "../../state/browser/hooks";
import { useSidebarTokens } from "../sidebar/tokens";
import { LIVE_NOW_TEXT, liveMotion, liveType, useLiveColors } from "./tokens";

export const NextMeetingBadge = memo(function NextMeetingBadge({ tabId }: { tabId: string }) {
  const pinnedUrl = useTab(tabId, (t) => (t?.pinned ? (t.pinnedUrl ?? t.url) : null));
  const calendar = pinnedUrl !== null && isCalendarUrl(pinnedUrl);
  const on = useLive((s) => s.calendar.showTimeToNext);
  const events = useCalendar((s) => s.events);
  const now = useNow(15_000, calendar && on);
  const text = calendar && on ? badgeText(events, now) : null;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const shown = useRef(new Animated.Value(text ? 1 : 0)).current;
  const [label, setLabel] = useState(text);
  useEffect(() => {
    if (text) setLabel(text);
    Animated.spring(shown, { toValue: text ? 1 : 0, speed: liveMotion.badgeSpring.speed, bounciness: text ? liveMotion.badgeSpring.bounciness : 0, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !text) setLabel(null);
    });
  }, [text]);
  if (!label) return null;
  const live = label === "Now";
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        bottom: -5,
        left: 0,
        right: 0,
        alignItems: "center",
        opacity: shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
      }}
    >
      <View style={[BADGE, { backgroundColor: live ? colors.now : tokens.badge, borderColor: colors.badgeRing }]}>
        <Text style={{ ...liveType.badge, color: live ? LIVE_NOW_TEXT : theme.onPrimary }}>{label}</Text>
      </View>
    </Animated.View>
  );
});

const BADGE_HEIGHT = 14;
const BADGE = {
  height: BADGE_HEIGHT,
  minWidth: 22,
  paddingHorizontal: space.xs,
  borderRadius: BADGE_HEIGHT / 2,
  alignItems: "center",
  justifyContent: "center",
  borderWidth: 1,
} as const;
