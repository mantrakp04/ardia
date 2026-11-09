import { memo, useEffect, useRef, useState } from "react";
import { Animated } from "react-native";
import { Badge, useTheme } from "../ui";
import { useCalendar, useNow } from "../../state/live/calendar";
import { badgeText, isCalendarUrl } from "../../state/live/meetings";
import { useLive } from "../../state/live/store";
import { useTab } from "../../state/browser/hooks";
import { useSidebarTokens } from "../sidebar/tokens";
import { liveMotion, useLiveColors } from "./tokens";

export const NextMeetingBadge = memo(function NextMeetingBadge({ tabId }: { tabId: string }) {
  const pinnedUrl = useTab(tabId, (t) => (t?.pin ? (t.pinnedUrl ?? t.url) : null));
  const calendar = pinnedUrl !== null && isCalendarUrl(pinnedUrl);
  const on = useLive((s) => s.calendar.showTimeToNext);
  const lead = useLive((s) => s.calendar.countdownLead);
  const dismissed = useLive((s) => s.dismissedNow);
  const events = useCalendar((s) => s.events);
  const now = useNow(15_000, calendar && on);
  const text = calendar && on ? badgeText(events, now, lead, dismissed) : null;
  const theme = useTheme();
  const tokens = useSidebarTokens();
  const colors = useLiveColors();
  const shown = useRef(new Animated.Value(text ? 1 : 0)).current;
  const [label, setLabel] = useState(text);
  useEffect(() => {
    if (text) setLabel(text);
    Animated.spring(shown, { toValue: text ? 1 : 0, ...(text ? liveMotion.badgeSpring : liveMotion.badgeHideSpring), useNativeDriver: true }).start(({ finished }) => {
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
      {live ? <Badge text={label ?? ""} size="s" tone="now" ring={colors.badgeRing} /> : <Badge text={label ?? ""} size="s" fill={tokens.badge} color={theme.onPrimary} ring={colors.badgeRing} />}
    </Animated.View>
  );
});

