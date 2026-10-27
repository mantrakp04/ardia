import { type SystemCalendar, connectCalendar, setCalendarHidden, useCalendar } from "../../../state/live/calendar";
import { Linking, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { ALERT_LEADS } from "../../../state/live/meetings";
import { updateCalendarSettings, useLive } from "../../../state/live/store";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { Button, Checkbox, font, PopUp, Toggle, weight } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";

export function CalendarPane() {
  const theme = useTheme();
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
        <Text style={{ marginTop: 12, ...font.small, color: theme.textSecondary }}>No calendars found. Add accounts in the Calendar app.</Text>
      ) : null}
    </View>
  );
}

function CalendarList({ title, calendars, hidden }: { title: string; calendars: SystemCalendar[]; hidden: string[] }) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: 6 }}>
      <Text style={{ ...font.caption, fontWeight: weight.semibold, color: theme.textSecondary, marginLeft: 12, marginBottom: 2 }}>{title}</Text>
      {calendars.map((c) => (
        <Row
          key={c.id}
          icon={<View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: c.color }} />}
          title={<Checkbox value={!hidden.includes(c.id)} onChange={(v) => setCalendarHidden(c.id, !v)} label={c.title} />}
          description={c.account}
        />
      ))}
    </View>
  );
}
