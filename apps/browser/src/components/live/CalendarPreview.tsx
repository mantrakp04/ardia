import { useEffect, useRef } from "react";
import { Animated, Pressable, Text as Span, View } from "react-native";
import { FadeLabel } from "../ui/native";
import { joinEvent } from "../../state/live/alerts";
import { connectCalendar, refreshCalendar, useCalendar, useNow } from "../../state/live/calendar";
import { isCalendarUrl, isMeeting, joinLink, joinTitle, relativeTime, timeRange, type CalendarEvent } from "../../state/live/meetings";
import { useLive } from "../../state/live/store";
import { useTab } from "../../state/browser/hooks";
import { activate } from "../../state/tabs/actions";
import { Box, Button, curve, duration, font, radius, space, Text, useHover, useTheme, weight } from "../ui";
import { dismissHover } from "../../state/sidebar/hover";
import type { Anchor } from "../../state/sidebar/sidebarUi";
import { Avatar, HoverSurface } from "./LiveItemCard";
import { liveType, useLiveColors } from "./tokens";
import { UI_LOCALE } from "../../lib/uiLocale";

export function useIsCalendarTab(tabId: string | null): boolean {
  const pinnedCalendar = useTab(tabId ?? undefined, (t) => !!t?.pin && isCalendarUrl(t.pinnedUrl ?? t.url));
  const on = useLive((s) => s.calendar.showPreview);
  return pinnedCalendar && on;
}

const JOINABLE_BEFORE_MS = 10 * 60_000;

export function CalendarPreview({ tabId, windowId, anchor }: { tabId: string; windowId: string; anchor: Anchor }) {
  const now = useNow(15_000);
  const { access, events, loading, error, lastFetch } = useCalendar();
  const connected = access === "fullAccess" || access === "fixture";
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const today = events.filter((e) => !e.cancelled && !e.declined && e.start <= endOfDay.getTime() && e.end > new Date(now).setHours(0, 0, 0, 0));
  const upcoming = today.filter((e) => e.end > now);
  const allDay = upcoming.filter((e) => e.allDay);
  const timed = upcoming.filter((e) => !e.allDay);
  const date = new Date(now).toLocaleDateString(UI_LOCALE, { weekday: "short", month: "short", day: "numeric" });

  let body: React.ReactNode;
  if (!connected) body = <SignIn denied={access === "denied" || access === "restricted"} />;
  else if (!lastFetch && loading) body = <Empty text="Loading events" />;
  else if (error && !lastFetch) body = <Empty text="Couldn't load events" />;
  else if (!today.length) body = <Empty text="No events today" />;
  else if (!upcoming.length) body = <Empty text="No more events today" />;
  else
    body = (
      <Box gap="xxs">
        {allDay.map((e) => (
          <AllDayRow key={e.occurrence} event={e} />
        ))}
        {timed.map((e) => (
          <EventRow key={e.occurrence} event={e} now={now} windowId={windowId} tabId={tabId} />
        ))}
      </Box>
    );

  return (
    <HoverSurface anchor={anchor} width={300}>
      <View style={HEADER}>
        <Text size="body" weight="semibold">
          Today
        </Text>
        <Text size="small" tone="textSecondary" style={DATE}>
          {date}
        </Text>
        <View style={FILL} />
        {connected ? <Refresh spinning={loading} /> : null}
      </View>
      {body}
    </HoverSurface>
  );
}

const FILL = { flex: 1 } as const;
const HEADER = { flexDirection: "row", alignItems: "center", marginBottom: space.m, marginTop: -space.xxs } as const;
const DATE = { marginLeft: space.s } as const;

function Refresh({ spinning }: { spinning: boolean }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    turn.setValue(0);
    const loop = Animated.loop(Animated.timing(turn, { toValue: 1, duration: duration.spinnerTurn, easing: curve.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning]);
  return (
    <Animated.View style={{ marginRight: -space.s, marginVertical: -space.xs, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }] }}>
      <Button variant="icon" icon="arrow.clockwise" size={10} weight="semibold" box={22} radius={radius.m} onPress={() => void refreshCalendar()} tooltip="Refresh" />
    </Animated.View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Text tone="textSecondary" style={EMPTY}>
      {text}
    </Text>
  );
}

const EMPTY = { ...liveType.empty, paddingVertical: space.s } as const;
const NOTE = { ...liveType.detail, paddingVertical: space.xs } as const;
const NOTE_WRAP = { paddingVertical: space.xs } as const;
const UNDERLINE = { textDecorationLine: "underline" } as const;
const NO_UNDERLINE = { textDecorationLine: "none" } as const;

function SignIn({ denied }: { denied: boolean }) {
  const theme = useTheme();
  const { hovered, hoverProps } = useHover();
  if (denied) {
    return (
      <Text tone="textSecondary" style={NOTE}>
        Allow Ardia in System Settings › Privacy & Security › Calendars to see your meetings here.
      </Text>
    );
  }
  return (
    <View {...hoverProps} style={NOTE_WRAP}>
      <Text tone="textSecondary" style={liveType.detail}>
        <Span onPress={() => void connectCalendar()} style={[{ color: theme.accent }, hovered ? UNDERLINE : NO_UNDERLINE]}>
          Connect your calendar
        </Span>{" "}
        to see your meetings here and get alerts before they start.
      </Text>
    </View>
  );
}

function AllDayRow({ event }: { event: CalendarEvent }) {
  const theme = useTheme();
  return (
    <Box row gap="sm" padX="xs" style={ALL_DAY}>
      <View style={[ALL_DAY_DOT, { backgroundColor: event.color }]} />
      <FadeLabel text={event.title || "Untitled event"} fontSize={font.small.fontSize} color={theme.textSecondary} style={ALL_DAY_LABEL} />
      <Text size="caption" tone="textTertiary">
        All day
      </Text>
    </Box>
  );
}

const ALL_DAY = { height: 22, alignItems: "center" } as const;
const ALL_DAY_DOT = { width: 7, height: 7, borderRadius: 2 } as const;
const ALL_DAY_LABEL = { flex: 1, height: 16 } as const;

function EventRow({ event, now, windowId, tabId }: { event: CalendarEvent; now: number; windowId: string; tabId: string }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const { hovered, hoverProps } = useHover();
  const link = joinLink(event);
  const running = event.start <= now;
  const joinable = !!link && isMeeting(event) && now >= event.start - JOINABLE_BEFORE_MS && now < event.end;
  const others = event.attendees.filter((a) => !a.me);
  const past = event.end <= now;
  return (
    <View {...hoverProps}>
      <Pressable
        onPress={() => {
          dismissHover();
          activate(tabId);
        }}
      >
        <Box row gap="m" padY="s" padX="xs" radius="l" fill={hovered ? "rowHover" : undefined} style={past ? EVENT_PAST : EVENT}>
          <View style={[EVENT_BAR, { backgroundColor: event.color }]} />
          <Box gap="xxs" style={FILL}>
            <FadeLabel text={event.title || "Untitled event"} fontSize={font.body.fontSize} weight="medium" color={theme.textPrimary} style={EVENT_TITLE} />
            <Text lines={1} size="footnote" tone="textSecondary">
              {timeRange(event)}
              <Span style={{ fontWeight: weight.medium, color: running ? colors.now : theme.textSecondary }}> · {running ? "Now" : relativeTime(event.start, now)}</Span>
            </Text>
          </Box>
          {others.length && !joinable ? <OverlappingAvatars people={others} /> : null}
          {joinable ? (
            <View tooltip={joinTitle(link!.provider)}>
              <Button variant="pill" tone="chip" title="Join" icon="video.fill" primary onPress={() => (dismissHover(), joinEvent(event, false, windowId))} />
            </View>
          ) : null}
        </Box>
      </Pressable>
    </View>
  );
}

const EVENT = { alignItems: "center", opacity: 1 } as const;
const EVENT_PAST = { alignItems: "center", opacity: 0.5 } as const;
const EVENT_BAR = { width: 3, alignSelf: "stretch", borderRadius: 1.5 } as const;
const EVENT_TITLE = { height: 17 } as const;
const AVATAR_RING = 1.5;

export function OverlappingAvatars({ people, size = 18 }: { people: CalendarEvent["attendees"]; size?: number }) {
  const theme = useTheme();
  const shown = people.slice(0, 3);
  const more = people.length - shown.length;
  return (
    <View style={AVATARS}>
      {shown.map((p, i) => (
        <View key={p.email || i} style={{ marginLeft: i ? -size * 0.35 : 0, borderRadius: size / 2 + 1, borderWidth: AVATAR_RING, borderColor: theme.panel }}>
          <Avatar uri={null} name={p.name || p.email} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <Text tone="textSecondary" style={MORE}>
          +{more}
        </Text>
      ) : null}
    </View>
  );
}


const AVATARS = { flexDirection: "row", alignItems: "center" } as const;
const MORE = { ...liveType.more, marginLeft: 3 } as const;
