import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { calendarFixture, startFakeEds } from "../lib/calendarFixtures.mjs";
import { startBrowser } from "../lib/flows.mjs";
import { documentDirectory, sessionSeed, writeProfileSeed } from "../lib/seed.mjs";
import { js, until } from "../lib/util.mjs";

const CONSENT = JSON.stringify({ version: 1, connected: true });
const MACOS = /System Settings|Privacy & Security|Calendar app/;

const calendarState = (shell) => shell.eval("(() => { const s = ardiaLinux.calendar.state.getState(); return { access: s.access, error: s.error, calendars: s.calendars, events: s.events, lastFetch: s.lastFetch }; })()");
const titles = (state) => state.events.map((e) => e.title);
const settled = (shell, test, label, timeout = 30000) => until(async () => {
  const state = await calendarState(shell);
  return test(state) ? state : false;
}, { timeout, interval: 250, label });

async function available(path) {
  return access(path).then(() => true, () => false);
}

export default {
  id: "F14",
  issue: 24,
  title: "Calendar previews, countdowns and Join alerts read Evolution Data Server through a fake session bus",
  deadline: 360000,
  manual: [
    { name: "A real GNOME Online Accounts calendar", steps: ["Add a Google or Nextcloud account in GNOME Online Accounts with Calendar turned on.", "Settings › Calendar › Connect Calendar…: the account's calendars are listed under My Calendars with their colors.", "Pin calendar.google.com: hovering it shows today's events; a meeting with a Meet link shows the countdown badge and, a minute before it starts, the alert with Join."], reason: "needs a desktop session with Evolution Data Server and a signed-in online account" },
    { name: "Expired online account", steps: ["Revoke the account's access from the provider's security page, then refresh the preview.", "The preview shows the events it still has; GNOME Online Accounts asks to sign in again; after signing in, new events appear without restarting Ardia."], reason: "needs a real provider account" },
  ],
  async run(t) {
    if (!(await available("/usr/bin/dbus-daemon"))) {
      await t.check("dbus-daemon is installed", () => { throw new Error("dbus-daemon is missing"); });
      return;
    }
    const fixture = calendarFixture();
    const eds = await startFakeEds(await t.tempDir("bus"), fixture.config);
    try {
      const { app, shell, scratch } = await startBrowser(t, { name: "calendar", env: { DBUS_SESSION_BUS_ADDRESS: eds.address, TZ: process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone } });
      await t.check("before connecting, Ardia reports notDetermined and reads nothing", async () => {
        const status = await shell.invoke("ArdiaCalendar.status", { args: [] });
        const sources = await shell.invoke("ArdiaCalendar.sources", { args: [] });
        const state = await calendarState(shell);
        const calls = await eds.control("Calls");
        if (status.value?.status !== "notDetermined" || status.value?.available !== true) throw new Error(JSON.stringify(status));
        if (sources.ok || sources.code !== "ERR_CALENDAR_NOT_CONNECTED") throw new Error(JSON.stringify(sources));
        if (state.access !== "notDetermined" || state.events.length) throw new Error(JSON.stringify(state));
        if (calls.some((c) => c === "GetManagedObjects" || c.startsWith("OpenCalendar"))) throw new Error(JSON.stringify(calls));
        return { status: status.value, calls };
      }, { critical: true });
      await t.check("connecting lists the Evolution calendars and saves the consent", async () => {
        const granted = await shell.eval("ardiaLinux.calendar.connect()", { timeout: 60000 });
        const state = await settled(shell, (s) => s.access === "fullAccess" && s.calendars.length === 2 && s.lastFetch, "calendars after connecting");
        const work = state.calendars.find((c) => c.id === "acceptance-work");
        if (granted !== true || work?.title !== "Acceptance Work" || work.color !== "#62A0EA" || work.account !== "me@ardia.test" || work.accountType !== "calDAV") throw new Error(JSON.stringify(state.calendars));
        const consent = JSON.parse(await readFile(join(documentDirectory(scratch), "linux-calendar.json"), "utf8"));
        if (consent.connected !== true) throw new Error(JSON.stringify(consent));
        return { calendars: state.calendars.map((c) => c.title) };
      }, { critical: true });
      await t.check("recurring, time-zoned, all-day, declined and cancelled events reach the shared state", async () => {
        const state = await settled(shell, (s) => s.events.length >= 6, "today's events");
        const by = Object.fromEntries(state.events.map((e) => [e.title, e]));
        const problems = [];
        const daily = state.events.filter((e) => e.title === "Daily planning").map((e) => e.start);
        if (!daily.includes(fixture.expected.recurringToday)) problems.push(`daily planning at ${daily.join(", ")}, wanted ${fixture.expected.recurringToday}`);
        if (by["Acceptance offsite"]?.allDay !== true || by["Acceptance offsite"].start !== fixture.expected.allDayStart) problems.push("all-day offsite");
        if (by["Declined review"]?.declined !== true) problems.push("declined review");
        if (by["Cancelled sync"]?.cancelled !== true) problems.push("cancelled sync");
        if (by["Acceptance standup"]?.start !== fixture.expected.standup || by["Acceptance standup"].attendees.find((a) => a.me)?.status !== "accepted") problems.push("standup");
        if (!by.Dentist || by.Dentist.color !== "#BECEDD") problems.push("personal calendar");
        if (problems.length) throw new Error(`${problems.join("; ")}: ${JSON.stringify(state.events)}`);
        return { titles: titles(state) };
      });
      await t.check("the Join alert picks the accepted meeting, not the declined or cancelled ones", async () => {
        const alert = await until(() => shell.eval("ardiaLinux.calendar.alert.getState().event?.title ?? null"), { timeout: 90000, interval: 500, label: "the meeting alert" });
        if (alert !== "Acceptance standup") throw new Error(`alert for ${alert}`);
        return { alert };
      });
      await t.check("unchecking a calendar stops reading it", async () => {
        const reads = async () => (await eds.control("Calls")).filter((c) => c.startsWith("GetObjectList acceptance-personal ")).length;
        await shell.eval(`ardiaLinux.calendar.hide(${js("acceptance-personal")}, true)`);
        const state = await settled(shell, (s) => !s.events.some((e) => e.calendarId === "acceptance-personal") && s.events.length > 0, "events without the personal calendar");
        const before = await reads();
        await shell.eval("ardiaLinux.calendar.refresh()", { timeout: 60000 });
        const after = await reads();
        await shell.eval(`ardiaLinux.calendar.hide(${js("acceptance-personal")}, false)`);
        await settled(shell, (s) => s.events.some((e) => e.title === "Dentist"), "the personal calendar back");
        if (after !== before) throw new Error(`the hidden calendar was read ${after - before} more times`);
        return { titles: titles(state), personalReads: after };
      });
      await t.check("an Evolution change shows up without a manual refresh", async () => {
        const start = Date.now() + 90 * 60000;
        await eds.control("ReplaceObjects", "acceptance-work", JSON.stringify([...fixture.work, fixture.added("Added from Evolution", start)]));
        const state = await settled(shell, (s) => s.events.some((e) => e.title === "Added from Evolution"), "the added event", 20000);
        return { titles: titles(state) };
      });
      await t.check("when Evolution Data Server goes away the calendar turns unavailable and clears", async () => {
        await eds.stopService();
        await shell.eval("ardiaLinux.calendar.refresh()", { timeout: 60000 }).catch(() => null);
        const state = await settled(shell, (s) => s.access === "restricted" && s.events.length === 0, "the unavailable state", 45000);
        return { access: state.access };
      });
      await t.stop(app);
    } finally {
      await eds.stop();
    }

    const offline = await t.scratch("no-bus");
    await writeProfileSeed(offline, { session: sessionSeed(), documents: { "linux-calendar.json": CONSENT } });
    const { app, shell } = await startBrowser(t, { name: "no-bus", scratch: offline });
    await t.check("without a session bus a connected calendar is unavailable, not empty", async () => {
      const state = await settled(shell, (s) => s.access === "restricted", "the restricted state");
      const status = await shell.invoke("ArdiaCalendar.status", { args: [] });
      if (status.value?.status !== "restricted" || state.events.length) throw new Error(JSON.stringify({ status, state }));
      return { status: status.value };
    });
    await t.check("Settings › Calendar explains Evolution Data Server instead of macOS privacy settings", async () => {
      await shell.command("openSettings");
      const settings = await app.shell("settings", { timeout: 20000 });
      await until(async () => (await settings.text()).includes("General"), { timeout: 10000, label: "Settings navigation" });
      await settings.clickText("Calendar", { timeout: 8000 });
      const text = await until(async () => {
        const current = await settings.text();
        return current.includes("Live Calendar") ? current.slice(current.indexOf("Live Calendar")) : false;
      }, { timeout: 10000, label: "the Calendar pane" });
      await t.evidence("calendar-pane", { text });
      if (MACOS.test(text)) throw new Error(`macOS wording: ${text.match(MACOS)[0]}`);
      for (const want of ["Evolution Data Server", "Try Again"]) if (!text.includes(want)) throw new Error(`missing "${want}"`);
      await t.screenshot(settings, "calendar-pane");
      return { length: text.length };
    });
  },
};
