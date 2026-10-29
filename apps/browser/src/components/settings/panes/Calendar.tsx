import { type SystemCalendar, connectCalendar, setCalendarHidden, useCalendar, useCalendarConnected } from "../../../state/live/calendar";
import { signInWithGoogle } from "../../../state/live/googleAuth";
import { disconnect } from "../../../state/live/sources";
import { Linking, Text, View } from "react-native";
import { useTheme } from "../../ui/theme";
import { ALERT_LEADS, COUNTDOWN_LEADS, countdownLeadTitle } from "../../../state/live/meetings";
import { isGoogleCalendarId } from "../../../state/live/googleCalendar";
import { updateCalendarSettings, useLive } from "../../../state/live/store";
import { useSettings } from "../../../state/browser/hooks";
import { updateSettings } from "../../../state/settings/actions";
import { Button, Checkbox, font, PopUp, Toggle, weight } from "../../ui";
import { Group, Row, SectionHeader } from "../Form";
import { showSettingsSheet } from "../../../state/settings/sheet";
import { ConnectSheet, GoogleConnect } from "./ConnectSheet";

export function CalendarPane() {
  const theme = useTheme();
  const settings = useLive((s) => s.calendar);
  const { access, calendars, googleError } = useCalendar();
  const google = useLive((s) => s.accounts.gcal);
  const autoGroup = useSettings((s) => s.autoGroupMeetingTabs);
  const connected = useCalendarConnected();
  const systemConnected = access === "fullAccess" || access === "fixture";
  const systemCount = calendars.filter((c) => !isGoogleCalendarId(c.id)).length;
  const googleCount = calendars.length - systemCount;
  const denied = access === "denied" || access === "restricted";
  const owned = calendars.filter((c) => c.owned);
  const others = calendars.filter((c) => !c.owned);

  return (
    <View>
      <SectionHeader
        title="Live Calendar"
        description="Pin Google Calendar, Outlook, iCloud or Notion Calendar to see your day when you hover it, a countdown to your next meeting, and alerts with a Join button before meetings start. Events come from the Calendar app's accounts, or straight from Google Calendar without access to your Mac's calendars."
      />
      <Group>
        <Row
          anchor="calendar.access"
          description={
            access === "fixture"
              ? "Development build: using calendar-fixture.json"
              : systemConnected
                ? `Connected · ${calendarCount(systemCount)}`
                : denied
                  ? "Ardia isn't allowed to read your calendars. Allow it in System Settings › Privacy & Security › Calendars."
                  : "Not connected"
          }
        >
          {denied ? (
            <Button title="Open System Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")} />
          ) : !systemConnected ? (
            <Button title="Connect Calendar…" kind={connected ? undefined : "primary"} onPress={() => void connectCalendar()} />
          ) : null}
        </Row>
        <Row anchor="calendar.google" description={google ? `Connected as ${google.login} · ${calendarCount(googleCount)}${googleError ? ` · ${googleError}` : ""}` : "Not connected"}>
          {google ? <Button title="Disconnect" onPress={() => void disconnect("gcal")} /> : <Button title="Connect Google Calendar…" onPress={() => showSettingsSheet(<GoogleCalendarSheet />)} />}
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
        <Text style={{ marginTop: 12, ...font.small, color: theme.textSecondary }}>No calendars found. Add accounts in the Calendar app.</Text>
      ) : null}
    </View>
  );
}

const calendarCount = (n: number) => (n === 1 ? "1 calendar" : `${n} calendars`);

function GoogleCalendarSheet() {
  return (
    <ConnectSheet name="Google Calendar" site="https://calendar.google.com">
      {(props) => <GoogleConnect {...props} api="Google Calendar" reads="read your calendars and events" connect={(windowId, clientId, secret) => signInWithGoogle("gcal", windowId, clientId, secret)} />}
    </ConnectSheet>
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
