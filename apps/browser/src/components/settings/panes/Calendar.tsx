import { type SystemCalendar, connectCalendar, setCalendarHidden, useCalendar } from "../../../state/live/calendar";
import { Linking, View } from "react-native";
import { ALERT_LEADS, COUNTDOWN_LEADS, countdownLeadTitle } from "../../../state/live/meetings";
import { updateCalendarSettings, useLive } from "../../../state/live/store";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { Box, Button, Checkbox, EmptyState, PopUp, radius, space, Text, Toggle } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

export function CalendarPane() {
  const settings = useLive((s) => s.calendar);
  const { access, calendars } = useCalendar();
  const autoGroup = useSettings((s) => s.autoGroupMeetingTabs);
  const connected = access === "fullAccess" || access === "fixture";
  const denied = access === "denied" || access === "restricted";
  const owned = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);

  return (
    <View>
      <SectionHeader
        title="Live Calendar"
        description="Pin Google Calendar, Outlook, iCloud or Notion Calendar to see your day when you hover it, a countdown to your next meeting, and alerts with a Join button before meetings start. Events come from the Calendar app's accounts."
      />
      <Group>
        <Row
          anchor="calendar.access"
          description={
            access === "fixture"
              ? "Development build: using calendar-fixture.json"
              : connected
                ? `Connected · ${calendars.length === 1 ? "1 calendar" : `${calendars.length} calendars`}`
                : denied
                  ? "Ardia isn't allowed to read your calendars. Allow it in System Settings › Privacy & Security › Calendars."
                  : "Not connected"
          }
        >
          {denied ? (
            <Button title="Open System Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")} />
          ) : !connected ? (
            <Button title="Connect Calendar…" kind="primary" onPress={() => void connectCalendar()} />
          ) : null}
        </Row>
      </Group>

      <SectionHeader title="Meeting alerts" />
      <Group>
        <Row anchor="calendar.nextAlert">
          <PopUp value={settings.alertLead} options={ALERT_LEADS.map((l) => ({ value: l.value, title: l.title, separatorBefore: l.value === "start" }))} onChange={(v) => updateCalendarSettings({ alertLead: v })} minWidth={170} />
        </Row>
        <Row anchor="calendar.alertCondition">
          <PopUp
            value={settings.alertCondition}
            options={[
              { value: "always", title: "Always" },
              { value: "activeOnly", title: "Only When Active" },
            ]}
            disabled={settings.alertLead === "never"}
            onChange={(v) => updateCalendarSettings({ alertCondition: v })}
            minWidth={170}
          />
        </Row>
      </Group>

      <SectionHeader title="Pinned calendar" />
      <Group>
        <Row anchor="calendar.preview">
          <Toggle value={settings.showPreview} onChange={(v) => updateCalendarSettings({ showPreview: v })} />
        </Row>
        <Row anchor="calendar.timeToNext">
          <Toggle value={settings.showTimeToNext} onChange={(v) => updateCalendarSettings({ showTimeToNext: v })} />
        </Row>
        <Row anchor="calendar.countdownLead">
          <PopUp
            value={String(settings.countdownLead)}
            options={COUNTDOWN_LEADS.map((m) => ({ value: String(m), title: countdownLeadTitle(m) }))}
            disabled={!settings.showTimeToNext}
            onChange={(v) => updateCalendarSettings({ countdownLead: Number(v) })}
            minWidth={170}
          />
        </Row>
      </Group>

      <SectionHeader title="Meetings" />
      <Group>
        <Row anchor="calendar.autoGroup">
          <Toggle value={autoGroup} onChange={(v) => updateSettings({ autoGroupMeetingTabs: v })} />
        </Row>
      </Group>

      {calendars.length ? (
        <>
          <SectionHeader title="Active calendars" description="Meetings from unchecked calendars don't show or alert." />
          <Group>
            {owned.length ? <CalendarList title="My Calendars" calendars={owned} hidden={settings.hiddenCalendarIds} /> : null}
            {others.length ? <CalendarList title="Other Calendars" calendars={others} hidden={settings.hiddenCalendarIds} /> : null}
          </Group>
        </>
      ) : connected ? (
        <View style={NO_CALENDARS}>
          <EmptyState symbol="calendar" title="No calendars found" subtitle="Add accounts in the Calendar app." />
        </View>
      ) : null}
    </View>
  );
}

function CalendarList({ title, calendars, hidden }: { title: string; calendars: SystemCalendar[]; hidden: string[] }) {
  return (
    <Box padY="s">
      <Text size="caption" weight="semibold" tone="textSecondary" style={LIST_TITLE}>
        {title}
      </Text>
      {calendars.map((c) => (
        <Row
          key={c.id}
          icon={<View style={[CALENDAR_COLOR, { backgroundColor: c.color }]} />}
          title={<Checkbox value={!hidden.includes(c.id)} onChange={(v) => setCalendarHidden(c.id, !v)} label={c.title} />}
          description={c.account}
        />
      ))}
    </Box>
  );
}

const NO_CALENDARS = { marginTop: space.l } as const;
const LIST_TITLE = { marginLeft: space.l, marginBottom: space.xxs } as const;
const CALENDAR_COLOR = { width: 10, height: 10, borderRadius: radius.hair } as const;
