import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LINUX_WORDING, linuxWording, rewordForLinux } from "../linuxWording.ts";
import { CREDENTIAL_WORDING, credentialWording, rewordCredentials } from "../credentialWording.ts";
import { CALENDAR_WORDING, calendarWording, rewordCalendar } from "../calendarWording.ts";
import { SYNC_WORDING, rewordSync, syncWording } from "../syncWording.ts";
import { unavailablePanes } from "./hostCapabilities.ts";
import { linuxShortcutText } from "../shortcutText.ts";
import { DEFAULT_BROWSER_ELSEWHERE, readOnboardingSystem } from "./onboardingSystem.ts";

const shared = (path) => fileURLToPath(new URL(`../../browser/src/${path}`, import.meta.url));
const read = (path) => readFileSync(shared(path), "utf8");
const strings = (code) => [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((match) => match[0]);
const whole = (code) => [code];
const PIPELINE = [rewordCredentials, rewordForLinux, rewordCalendar, rewordSync];
const linuxCopy = (path) => {
  const source = read(path);
  const start = path.startsWith("components/") && !path.endsWith("/settings/searchMatch.ts") ? linuxShortcutText(source) : source;
  return PIPELINE.reduce((code, reword) => reword(shared(path), code) ?? code, start);
};

const MODULES = [
  { name: "calendar", list: CALENDAR_WORDING, reword: rewordCalendar, plugin: calendarWording, pick: whole, macos: /System Settings|Privacy & Security|x-apple|Calendar app/, surfaces: CALENDAR_WORDING.map((entry) => entry.file), probe: "components/settings/panes/Calendar.tsx" },
  { name: "credential", list: CREDENTIAL_WORDING, reword: rewordCredentials, plugin: credentialWording, pick: whole, macos: /\bMac\b|macOS|Keychain|Touch ID|Applications folder/, surfaces: ["components/settings/panes/Passwords.tsx", "components/settings/panes/Autofill.tsx"], probe: "components/settings/panes/Passwords.tsx" },
  { name: "sync", list: SYNC_WORDING, reword: rewordSync, plugin: syncWording, pick: whole, macos: /\bMacs?\b|iCloud Drive|iCloud Settings|in Finder|iPhone|Universal Clipboard|Keychain|x-apple\.|\bUsers\b/, surfaces: ["components/settings/panes/Sync.tsx", "components/settings/panes/SyncSheets.tsx"], probe: "components/settings/panes/Sync.tsx" },
  {
    name: "linux", list: LINUX_WORDING, reword: rewordForLinux, plugin: linuxWording, pick: strings, macos: /\bMacs?\b|macOS|iCloud|Keychain|keychain/, probe: "components/onboarding/SourceStep.tsx",
    surfaces: ["state/extensions/actions.ts", "components/onboarding/SourceStep.tsx", "components/onboarding/LookStep.tsx", "components/settings/panes/Appearance.tsx", "components/settings/panes/Privacy.tsx", "state/telemetry/copy.ts", "components/import/steps/ChooseStep.tsx", "components/import/steps/SafariStep.tsx", "state/import/runImport.ts", "components/onboarding/previews/MockWindow.tsx", "components/onboarding/previews/scenes/LookScenes.tsx"],
  },
];

const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
const EXPECTED = [
  ["components/settings/panes/Calendar.tsx", ["<Button title=\"Try Again\" onPress={() => void connectCalendar()} />", "Ardia reads your calendars through Evolution Data Server, which isn't running", "Evolution Data Server refused to share your calendars"], []],
  ["components/settings/panes/Passwords.tsx", ["system password"], []],
  ["components/settings/panes/Sync.tsx", ["across your computers", "Syncthing, Nextcloud or Dropbox", "title: \"Open Sync Folder\""], ["Linking.openURL"]],
  ["components/settings/panes/SyncSheets.tsx", ["title=\"Add to This Computer\"", "system keyring", "fontFamily: \"monospace\"", "return folder.path.replace(/^\\/home\\/[^/]+(?=\\/|$)/, \"~\");", "<Button title=\"Save as Text…\" kind=\"primary\" onPress={() => void save(\"text\")} />", "<Button title=\"Copy Words\" onPress={() => void copyRecoveryPhrase()} />"], ["fontFamily: \"Menlo\"", "recoveryKitPreview(", "copyRecoveryKit()", "shareRecoveryKit()", "save(\"pdf\")", "title=\"Other Options\""]],
  ["state/sync/syncDoc.ts", ["never removes them from this computer"], []],
  ["state/sync/engine.ts", ["keep syncing on this device", "Couldn’t save the sync key in your Keychain."], []],
  ["components/onboarding/SourceStep.tsx", ["Found on this computer"], []],
  ["components/settings/panes/Appearance.tsx", ["title: \"Follow system\""], []],
  ["state/import/runImport.ts", ["system keyring"], []],
  ["state/extensions/actions.ts", ["\"The extension's folder stays on this computer.\""], ["stays on your Mac"]],
  ["state/live/engine.ts", ["case \"keyringLocked\":\n      return `Unlock your keyring to refresh ${name}`;", "case \"keyringUnavailable\":\n      return `Start your keyring to refresh ${name}`;", "case \"signedOut\":\n      return `Sign back in to ${name}`;"], []],
  ["components/settings/rows/generalRows.ts", ["quits with Ctrl+Shift+Q.", "Ctrl+Alt-click splits too, and so does Alt+Shift-click when Alt-click is chosen", "title: \"Ctrl-clicking links creates tab groups\""], []],
  ["components/settings/rows/privacyRows.ts", ["system password", "title: \"Zoom with Ctrl and the mouse wheel\""], []],
  ["components/settings/panes/Tabs.tsx", ["title: \"Shift-click\"", "title: \"Alt-click\"", "title: \"Alt+Shift-click\"", "\"Alt-click (Peek moves to Shift-click)\"", "\"Alt-click (split view moves to Alt+Shift-click)\"", "\"Alt-click opens a split now: choosing it here moves split view back to Alt+Shift-click.\""], []],
  ["components/onboarding/LayoutSteps.tsx", ["title: \"Shift-click\""], []],
  ["components/tabstrip/NewTabButton.tsx", ["New Tab (Ctrl+T) — Alt-click to open in Split View"], []],
];

test("every listed replacement matches its shared source exactly once", () => {
  for (const { name, list } of MODULES) {
    for (const { file, replacements } of list) {
      const source = read(file);
      for (const [from] of replacements) assert.equal(source.split(from).length, 2, `${name}: ${file} has ${source.split(from).length - 1} of ${JSON.stringify(from.slice(0, 60))}`);
    }
  }
});

test("every listed surface had macOS copy and loses it after the Linux pipeline", () => {
  for (const { name, macos, pick, surfaces } of MODULES) {
    for (const path of surfaces) {
      assert.ok(pick(read(path)).some((text) => macos.test(text)), `${name}: ${path} has no macOS copy left to reword`);
      assert.deepEqual(pick(linuxCopy(path)).flatMap((text) => text.match(macos) ?? []), [], `${name}: ${path}`);
    }
  }
});

test("the reworded copy says what Linux does and drops what it can't do", () => {
  for (const [path, has, lacks] of EXPECTED) {
    const copy = linuxCopy(path);
    for (const text of has) assert.ok(copy.includes(text), `${path} lacks ${text}`);
    for (const text of lacks) assert.ok(read(path).includes(text) && !copy.includes(text), `${path} keeps ${text}`);
  }
});

test("search rows describing reworded panes read as Linux too", () => {
  const general = linuxCopy("components/settings/rows/generalRows.ts");
  const rows = read("components/settings/rows/generalRows.ts");
  assert.match(section(rows, "  sync: [", "  tabs: ["), /\bMacs\b|icloud/);
  assert.doesNotMatch(section(general, "  sync: [", "  tabs: ["), /\bMacs?\b|icloud/i);
  assert.match(section(rows, "pageScrollBars: {", "keywords"), /macOS/);
  assert.doesNotMatch(section(general, "pageScrollBars: {", "keywords"), /macOS/);
  const privacy = read("components/settings/rows/privacyRows.ts");
  assert.match(section(privacy, "passwords: [", "extensions: ["), /Touch ID|keychain/);
  assert.doesNotMatch(section(linuxCopy("components/settings/rows/privacyRows.ts"), "passwords: [", "extensions: ["), /Touch ID|keychain|Keychain|\bMac\b/);
  assert.doesNotMatch(section(linuxCopy("components/settings/rows/privacyRows.ts"), "whatsSent: {", "keywords"), /\bMacs?\b|macOS|iCloud|Keychain|keychain/);
});

test("a shared copy change fails with 'no longer contains', and unlisted files pass through", () => {
  for (const { name, reword, probe } of MODULES) {
    assert.throws(() => reword(shared(probe), "export const nothing = 1;"), /no longer contains/, name);
    assert.equal(reword(shared("components/settings/panes/General.tsx"), "const x = 'Mac';"), null, name);
  }
});

test("a production build fails when a listed file was loaded but never reworded", () => {
  const context = { error(message) { throw new Error(message); } };
  for (const { name, list, plugin } of MODULES) {
    const run = (command, files, modules = files.map(shared), error) => {
      const instance = plugin();
      instance.configResolved({ command });
      for (const file of files) instance.transform.call(context, read(file), shared(file));
      return () => instance.buildEnd.call({ ...context, getModuleIds: () => [...modules].values() }, error);
    };
    const all = list.map((entry) => entry.file);
    const dropped = all.at(-1);
    assert.doesNotThrow(run("build", all), name);
    assert.throws(run("build", all.slice(0, -1), all.map(shared)), (error) => error.message.includes("never reworded") && error.message.includes(dropped), name);
    assert.doesNotThrow(run("serve", [], all.map(shared)), name);
    assert.doesNotThrow(run("build", [], [shared("components/site/SiteControls.tsx")]), name);
    assert.doesNotThrow(run("build", [], all.map(shared), new Error("earlier failure")), name);
  }
});

const componentFiles = (dir) => readdirSync(new URL(`../../browser/src/${dir}`, import.meta.url), { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
  .map((file) => `${dir}/${file}`);

test("shortcut glyphs become Linux key names without stray '+-' click modifiers", () => {
  assert.equal(linuxShortcutText(`"⇧⌘S" "⌘Z" "⌥⌘I" "⌃⇧Tab"`), `"Shift+Ctrl+S" "Ctrl+Z" "Alt+Ctrl+I" "Super+Shift+Tab"`);
  const stray = componentFiles("components").filter((path) => (linuxCopy(path).match(/\+-[a-z]/g) ?? []).length > (read(path).match(/\+-[a-z]/g) ?? []).length);
  assert.deepEqual(stray, []);
});

test("onboarding names no Mac, macOS or Dock on Linux, and the Engines pane is not offered without WebKit", () => {
  const words = /\bMacs?\b|macOS|\bDock\b|iCloud|Keychain/;
  const leftover = componentFiles("components/onboarding")
    .filter((path) => path !== "components/onboarding/HomeStep.tsx")
    .flatMap((path) => strings(linuxCopy(path)).filter((text) => words.test(text)).map((text) => `${path}: ${text}`));
  assert.deepEqual(leftover, []);
  assert.doesNotMatch(DEFAULT_BROWSER_ELSEWHERE, words);
  assert.ok(unavailablePanes({ webkit: false }).has("engines"));
});

test("the default-browser step settles on Linux whether or not the desktop integrations exist", async () => {
  const never = () => new Promise(() => {});
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: false, launchAtLogin: false }, { isDefaultBrowser: never, launchAtLoginStatus: never }), { isDefault: false, loginEnabled: false });
  const refused = () => Promise.reject(Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }));
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: true, launchAtLogin: true }, { isDefaultBrowser: refused, launchAtLoginStatus: refused }), { isDefault: false, loginEnabled: false });
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: true, launchAtLogin: true }, { isDefaultBrowser: async () => true, launchAtLoginStatus: async () => "enabled" }), { isDefault: true, loginEnabled: true });
});
