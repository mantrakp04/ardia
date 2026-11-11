import type { Plugin } from "vite";

type Wording = { file: string; replacements: [string, string][] };

const UNAVAILABLE = "Ardia reads your calendars through Evolution Data Server, which isn't running in this session. Install GNOME Calendar or Evolution, add your accounts in GNOME Online Accounts, then try again.";
const REFUSED = "Evolution Data Server refused to share your calendars with Ardia. If Ardia runs in a sandbox, let it reach Evolution Data Server on the session bus, then try again.";

export const CALENDAR_WORDING: readonly Wording[] = [
  {
    file: "components/settings/panes/Calendar.tsx",
    replacements: [
      ["Events come from the Calendar app's accounts.", "Events come from Evolution Data Server: the accounts in GNOME Online Accounts and the calendars in GNOME Calendar or Evolution."],
      [
        `"Ardia isn't allowed to read your calendars. Allow it in System Settings › Privacy & Security › Calendars."`,
        `access === "restricted" ? ${JSON.stringify(UNAVAILABLE)} : ${JSON.stringify(REFUSED)}`,
      ],
      [
        `{blocked ? (
            <Button title="Open System Settings" onPress={openCalendarPrivacy} />`,
        `{blocked ? (
            <Button title="Try Again" onPress={() => void connectCalendar()} />`,
      ],
      [`{requestError ? <Button title="Open System Settings" onPress={openCalendarPrivacy} /> : null}`, ""],
      [`subtitle="Add accounts in the Calendar app."`, `subtitle="Add an account in GNOME Online Accounts, or a calendar in GNOME Calendar or Evolution."`],
    ],
  },
  {
    file: "components/live/CalendarPreview.tsx",
    replacements: [
      [
        `<Button variant="text" look="link" title="Open System Settings" onPress={openCalendarPrivacy} />`,
        `<Button variant="text" look="link" title="Try Again" onPress={() => void connectCalendar()} />`,
      ],
      [
        "Allow Ardia in System Settings › Privacy & Security › Calendars to see your meetings here.",
        "Ardia can't read your calendars from Evolution Data Server. Settings › Calendar shows how to fix it.",
      ],
    ],
  },
  {
    file: "state/live/calendar.ts",
    replacements: [
      [`export const openCalendarPrivacy = () => void openExternalURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars");`, "export const openCalendarPrivacy = () => {};"],
      [`const CALENDARS_PRIVACY = "System Settings › Privacy & Security › Calendars";`, ""],
      [
        `  if (access === "restricted") return \`Calendar access is restricted on this Mac, by Screen Time or your organization. If you can change it, allow Ardia in \${CALENDARS_PRIVACY}.\`;
  if (access === "writeOnly") return \`Ardia can only add events to your calendars. Choose Full Access for Ardia in \${CALENDARS_PRIVACY}.\`;
  if (access === "denied") return \`Ardia isn't allowed to read your calendars. Turn on Ardia in \${CALENDARS_PRIVACY}.\`;
  const launcherHint = request?.responsible === "other" ? " macOS may have checked the app that opened Ardia instead of Ardia: quit Ardia, open it from the Dock or Finder, then connect again." : "";
  if (request?.error) return \`macOS couldn't give Ardia calendar access (\${request.error}). Check \${CALENDARS_PRIVACY}.\${launcherHint}\`;
  if (launcherHint) return \`macOS didn't ask Ardia for calendar access.\${launcherHint}\`;
  return \`macOS didn't ask for calendar access. Allow Ardia in \${CALENDARS_PRIVACY}.\`;`,
        `  if (access === "restricted") return ${JSON.stringify(UNAVAILABLE)};
  if (access === "denied" || access === "writeOnly") return ${JSON.stringify(REFUSED)};
  if (request?.error) return \`Evolution Data Server couldn't share your calendars (\${request.error}).\`;
  return "Ardia didn't get access to your calendars. Try again.";`,
      ],
    ],
  },
];

const marker = "/apps/browser/src/";

export function rewordCalendar(id: string, code: string): string | null {
  const at = id.indexOf(marker);
  if (at < 0) return null;
  const path = id.slice(at + marker.length).split("?")[0];
  const wording = CALENDAR_WORDING.find((entry) => entry.file === path);
  if (!wording) return null;
  let reworded = code;
  for (const [from, to] of wording.replacements) {
    if (!reworded.includes(from)) throw new Error(`${path} no longer contains ${JSON.stringify(from.slice(0, 80))}; update apps/linux/calendarWording.ts`);
    reworded = reworded.replace(from, () => to);
  }
  return reworded;
}

export function calendarWording(): Plugin {
  const applied = new Set<string>();
  let building = false;
  return {
    name: "ardia-linux:calendar-wording",
    enforce: "pre",
    configResolved(config) {
      building = config.command === "build";
    },
    transform(code, id) {
      const reworded = rewordCalendar(id, code);
      if (reworded === null) return null;
      applied.add(id.slice(id.indexOf(marker) + marker.length).split("?")[0] ?? "");
      return { code: reworded, map: null };
    },
    buildEnd(error) {
      if (!building || error) return;
      const ids = [...this.getModuleIds()];
      const missing = CALENDAR_WORDING.map((entry) => entry.file).filter((file) => ids.some((id) => id.includes(`${marker}${file}`)) && !applied.has(file));
      if (missing.length) this.error(`calendarWording.ts never reworded ${missing.join(", ")}; update apps/linux/calendarWording.ts`);
    },
  };
}
