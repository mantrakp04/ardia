import { useEffect, useRef } from "react";
import { Animated } from "react-native";
import { curve, space, Text, useTheme } from "../ui";
import { useNow } from "../../state/live/calendar";
import { timeRemaining, WIGGLE_MARKS_MIN } from "../../state/live/meetings";
import { useLive } from "../../state/live/store";
import { liveMotion, useLiveColors } from "./tokens";

const SHOW_WITHIN_MIN = 10;
const wiggled = new Set<string>();

export function useMeetingCountdown(groupId: string) {
  const meeting = useLive((s) => s.meetingGroups[groupId]);
  const now = useNow(5_000, !!meeting && !meeting.endedAt && meeting.end !== null);
  const wiggle = useRef(new Animated.Value(0)).current;
  const end = meeting && !meeting.endedAt ? meeting.end : null;
  const minutesLeft = end ? (end - now) / 60_000 : null;

  useEffect(() => {
    if (minutesLeft === null) return;
    const due = WIGGLE_MARKS_MIN.filter((m) => minutesLeft <= m && minutesLeft > m - 1 && !wiggled.has(`${groupId}:${m}`));
    for (const m of WIGGLE_MARKS_MIN) if (minutesLeft <= m - 1) wiggled.add(`${groupId}:${m}`);
    if (!due.length) return;
    due.forEach((m) => wiggled.add(`${groupId}:${m}`));
    wiggle.setValue(0);
    Animated.sequence(liveMotion.wiggle.map(({ to, duration }) => Animated.timing(wiggle, { toValue: to, duration, easing: curve.inOutQuad, useNativeDriver: true }))).start();
  }, [minutesLeft === null ? null : Math.ceil(minutesLeft * 12)]);

  const label = end && minutesLeft !== null && minutesLeft <= SHOW_WITHIN_MIN ? timeRemaining(end, now) : null;
  return {
    label,
    urgent: minutesLeft !== null && minutesLeft <= 2,
    rotate: wiggle.interpolate({ inputRange: [-1, 1], outputRange: ["-4deg", "4deg"] }),
  };
}

export function MeetingTimeLabel({ label, urgent }: { label: string; urgent: boolean }) {
  const theme = useTheme();
  const colors = useLiveColors();
  return (
    <Text size="caption" weight="semibold" style={{ fontVariant: TABULAR, color: urgent ? colors.now : theme.textSecondary, marginRight: space.xs }}>
      {label}
    </Text>
  );
}

const TABULAR: "tabular-nums"[] = ["tabular-nums"];
