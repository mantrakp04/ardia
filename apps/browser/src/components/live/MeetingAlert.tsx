import { useEffect, useRef, useState } from "react";
import { Animated, Text as Span, View } from "react-native";
import { dismiss, joinEvent, useMeetingAlert } from "../../state/live/alerts";
import { useCalendar, useNow } from "../../state/live/calendar";
import { attendeesLabel, guestsLabel, joinLink, joinTitle, relatedLinks, relativeTime, timeRange, type CalendarEvent } from "../../state/live/meetings";
import { useWindow } from "../../state/browser/hooks";
import { useCalendarTabIn } from "../../state/live/hooks";
import { activate } from "../../state/tabs/actions";
import { useIsFocusedWindow } from "../../state/windows/hooks";
import { Box, Button, Panel, radius, space, Text, useTheme, weight } from "../ui";
import { measureRow, type Anchor } from "../../state/sidebar/sidebarUi";
import { OverlappingAvatars } from "./CalendarPreview";
import { liveMotion, liveShadow, useLiveColors } from "./tokens";

const WIDTH = 300;
const EDGE = space.m;
const CALENDAR_DOT = 8;
const TITLE_LINE = 18;
const PILL_HEIGHT = 30;

export function MeetingAlert({ windowId, windowWidth }: { windowId: string; windowWidth: number }) {
  const event = useMeetingAlert((s) => s.event);
  const front = useIsFocusedWindow(windowId);
  if (!event || !front) return null;
  return <AlertCard key={event.occurrence} event={event} windowId={windowId} windowWidth={windowWidth} />;
}

function AlertCard({ event, windowId, windowWidth }: { event: CalendarEvent; windowId: string; windowWidth: number }) {
  const theme = useTheme();
  const colors = useLiveColors();
  const now = useNow(15_000);
  const calendarTab = useCalendarTabIn(windowId);
  const sidebarShown = useWindow(windowId, (w) => !!w?.sidebarOpen);
  const calendarName = useCalendar((s) => s.calendars.find((c) => c.id === event.calendarId)?.title);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const appear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    if (calendarTab && sidebarShown) void measureRow(windowId, calendarTab).then((a) => !cancelled && setAnchor(a));
    else setAnchor(null);
    return () => {
      cancelled = true;
    };
  }, [calendarTab, sidebarShown, windowWidth]);
  useEffect(() => {
    Animated.spring(appear, { toValue: 1, ...liveMotion.alertSpring, useNativeDriver: true }).start();
  }, []);

  const link = joinLink(event);
  const related = relatedLinks(event);
  const running = event.start <= now;
  const people = event.attendees.filter((a) => !a.me);
  const who = attendeesLabel(event);
  const position = anchor ? { left: anchor.x + anchor.width + EDGE, top: Math.max(EDGE, anchor.y - 4) } : { left: Math.max(EDGE, windowWidth - WIDTH - 14), top: 52 };

  return (
    <Animated.View
      style={{
        position: "absolute",
        ...position,
        width: WIDTH,
        opacity: appear,
        transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }, { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }],
      }}
    >
      <Panel fill={theme.panel} radius={radius.sheet} border={theme.panelBorder} shadow={liveShadow.alert} style={CARD}>
        <Box row gap="s" style={CENTER}>
          <View style={[DOT, { backgroundColor: event.color }]} />
          <Text lines={1} size="footnote" weight="medium" style={{ flex: 1, color: running ? colors.now : theme.textSecondary }}>
            {running ? "Now" : relativeTime(event.start, now)}
            {calendarName ? <Span style={{ fontWeight: weight.regular, color: theme.textSecondary }}> · {calendarName}</Span> : null}
          </Text>
          <Button variant="icon" icon="xmark" size={9} weight="semibold" box={20} radius={radius.m} onPress={() => dismiss(event)} tooltip="Ignore" style={CLOSE} />
        </Box>
        <Box gap="xxs">
          <Text lines={2} size="title" weight="semibold" style={TITLE}>
            {event.title || "Untitled event"}
          </Text>
          <Text size="small" tone="textSecondary">
            {timeRange(event)}
          </Text>
        </Box>
        {people.length ? (
          <Box row gap="sm" style={CENTER}>
            <OverlappingAvatars people={people} size={20} />
            <Text lines={1} size="small" tone="textSecondary" style={FILL}>
              {who || guestsLabel(event)}
            </Text>
          </Box>
        ) : null}
        <Box gap="s" style={ACTIONS}>
          {link ? (
            <Button variant="pill" tone="chip" title={joinTitle(link.provider)} icon="video.fill" primary height={PILL_HEIGHT} onPress={() => joinEvent(event, false, windowId)} />
          ) : calendarTab ? (
            <Button
              variant="pill"
              tone="chip"
              title="View Event"
              icon="calendar"
              height={PILL_HEIGHT}
              onPress={() => {
                activate(calendarTab);
                dismiss(event);
              }}
            />
          ) : null}
          {link && related.length ? (
            <View tooltip={`Opens ${related.length === 1 ? "1 link" : `${related.length} links`} from the invitation, then joins`}>
              <Button variant="pill" tone="chip" title="Open All and Join" icon="square.stack" height={PILL_HEIGHT} onPress={() => joinEvent(event, true, windowId)} />
            </View>
          ) : null}
        </Box>
      </Panel>
    </Animated.View>
  );
}


const FILL = { flex: 1 } as const;
const CENTER = { alignItems: "center" } as const;
const CARD = { padding: space.l, gap: space.m } as const;
const DOT = { width: CALENDAR_DOT, height: CALENDAR_DOT, borderRadius: 2.5 } as const;
const CLOSE = { marginRight: -space.xs, marginTop: -space.xxs } as const;
const TITLE = { lineHeight: TITLE_LINE } as const;
const ACTIONS = { marginTop: space.xxs } as const;
