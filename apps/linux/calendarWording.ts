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
        `<Button title="Open System Settings" onPress={() => void Linking.openURL("x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars")} />`,
        `<Button title="Try Again" onPress={() => void connectCalendar()} />`,
      ],
      ["No calendars found. Add accounts in the Calendar app.", "No calendars found. Add an account in GNOME Online Accounts, or a calendar in GNOME Calendar or Evolution."],
    ],
  },
  {
    file: "components/live/CalendarPreview.tsx",
    replacements: [
      [
        "Allow Ardia in System Settings › Privacy & Security › Calendars to see your meetings here.",
        "Ardia can't read your calendars from Evolution Data Server. Settings › Calendar shows how to fix it.",
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
