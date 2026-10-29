import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { CALENDAR_WORDING, calendarWording, rewordCalendar } from "../calendarWording.ts";

const shared = (path) => fileURLToPath(new URL(`../../browser/src/${path}`, import.meta.url));
const MACOS = /System Settings|Privacy & Security|x-apple|Calendar app/;

test("the shared Calendar pane and preview lose their macOS permission instructions", () => {
  for (const { file } of CALENDAR_WORDING) {
    const original = readFileSync(shared(file), "utf8");
    assert.match(original, MACOS, file);
    const reworded = rewordCalendar(shared(file), original);
    assert.doesNotMatch(reworded, MACOS, file);
    assert.match(reworded, /Evolution Data Server/, file);
  }
  const pane = rewordCalendar(shared("components/settings/panes/Calendar.tsx"), readFileSync(shared("components/settings/panes/Calendar.tsx"), "utf8"));
  assert.match(pane, /<Button title="Try Again" onPress=\{\(\) => void connectCalendar\(\)\} \/>/);
  assert.match(pane, /access === "restricted" \? "Ardia reads your calendars through Evolution Data Server, which isn't running/);
  assert.match(pane, /: "Evolution Data Server refused to share your calendars/);
});

test("a shared copy change fails the Linux build instead of shipping macOS wording", () => {
  assert.throws(() => rewordCalendar(shared("components/settings/panes/Calendar.tsx"), "export const nothing = 1;"), /no longer contains/);
  assert.equal(rewordCalendar(shared("components/settings/panes/General.tsx"), "System Settings"), null);
  const context = { error(message) { throw new Error(message); } };
  const plugin = calendarWording();
  plugin.configResolved({ command: "build" });
  const pane = shared("components/settings/panes/Calendar.tsx");
  assert.throws(() => plugin.buildEnd.call({ ...context, getModuleIds: () => [pane].values() }), /never reworded components\/settings\/panes\/Calendar\.tsx/);
  plugin.transform.call(context, readFileSync(pane, "utf8"), pane);
  assert.doesNotThrow(() => plugin.buildEnd.call({ ...context, getModuleIds: () => [pane].values() }));
});

test("the Linux Vite config runs the calendar wording transform", () => {
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /import \{ calendarWording \} from "\.\/calendarWording";/);
  assert.match(config, /plugins: \[[^\]]*calendarWording\(\)/);
});
