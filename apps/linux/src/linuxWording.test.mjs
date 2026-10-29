import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { LINUX_WORDING, linuxWording, rewordForLinux } from "../linuxWording.ts";
import { rewordCredentials } from "../credentialWording.ts";
import { unavailablePanes } from "./hostCapabilities.ts";
import { linuxShortcutText } from "../shortcutText.ts";
import { DEFAULT_BROWSER_ELSEWHERE, readOnboardingSystem } from "./onboardingSystem.ts";

const shared = (path) => fileURLToPath(new URL(`../../browser/src/${path}`, import.meta.url));
const MACOS = /\bMacs?\b|macOS|iCloud|Keychain|keychain/;
const SURFACES = [
  "state/extensions/actions.ts",
  "components/onboarding/SourceStep.tsx",
  "components/onboarding/LookStep.tsx",
  "components/settings/panes/Appearance.tsx",
  "components/settings/panes/Privacy.tsx",
  "state/telemetry/copy.ts",
  "components/import/steps/ChooseStep.tsx",
  "components/import/steps/SafariStep.tsx",
  "state/import/runImport.ts",
  "components/onboarding/previews/MockWindow.tsx",
  "components/onboarding/previews/scenes/LookScenes.tsx",
];
const strings = (code) => [...code.matchAll(/"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((match) => match[0]);
const linuxCopy = (path) => {
  const source = readFileSync(shared(path), "utf8");
  const reworded = rewordForLinux(shared(path), source) ?? source;
  return rewordCredentials(shared(path), reworded) ?? reworded;
};

test("onboarding, Appearance, Privacy, What's Sent and the import flow name no Mac, macOS, iCloud or Keychain on Linux", () => {
  for (const path of SURFACES) {
    const original = readFileSync(shared(path), "utf8");
    assert.ok(strings(original).some((text) => MACOS.test(text)), `${path} has no macOS copy left to reword`);
    const leftover = strings(linuxCopy(path)).filter((text) => MACOS.test(text));
    assert.deepEqual(leftover, [], path);
  }
  assert.match(linuxCopy("components/onboarding/SourceStep.tsx"), /Found on this computer/);
  assert.match(linuxCopy("components/settings/panes/Appearance.tsx"), /title: "Follow system"/);
  assert.match(linuxCopy("state/import/runImport.ts"), /system keyring/);
});

test("the rows that describe those panes are reworded too", () => {
  const general = linuxCopy("components/settings/rows/generalRows.ts");
  const section = (text, from, to) => text.slice(text.indexOf(from), text.indexOf(to, text.indexOf(from)));
  assert.match(section(readFileSync(shared("components/settings/rows/generalRows.ts"), "utf8"), "pageScrollBars: {", "keywords"), /macOS/);
  assert.doesNotMatch(section(general, "pageScrollBars: {", "keywords"), MACOS);
  assert.match(section(general, "pageScrollBars: {", "keywords"), /Follow system/);
  assert.match(section(general, "warnBeforeQuitting: {", "keywords"), /quits with Ctrl\+Shift\+Q\./);
  const privacy = linuxCopy("components/settings/rows/privacyRows.ts");
  assert.doesNotMatch(section(privacy, "whatsSent: {", "keywords"), MACOS);
});

test("a Live folder whose token sits in a locked or missing keyring says so instead of asking to sign back in", () => {
  const engine = linuxCopy("state/live/engine.ts");
  const errorText = engine.slice(engine.indexOf("export function errorText("));
  const cases = errorText.slice(0, errorText.indexOf("    default:"));
  assert.match(cases, /case "keyringLocked":\n\s+return `Unlock your keyring to refresh \$\{name\}`;/);
  assert.match(cases, /case "keyringUnavailable":\n\s+return `Start your keyring to refresh \$\{name\}`;/);
  assert.match(cases, /case "signedOut":\n\s+return `Sign back in to \$\{name\}`;/);
});

test("the Engines pane, whose passkey copy is about macOS, is not offered on Linux without WebKit", () => {
  assert.ok(unavailablePanes({ webkit: false }).has("engines"));
});

test("every replacement still matches the shared source, so a copy change fails the Linux build instead of shipping macOS wording", () => {
  for (const { file, replacements } of LINUX_WORDING) {
    const source = readFileSync(shared(file), "utf8");
    for (const [from] of replacements) {
      assert.ok(source.includes(from), `${file} no longer contains ${JSON.stringify(from.slice(0, 60))}`);
      assert.equal(source.split(from).length, 2, `${file} has more than one ${JSON.stringify(from.slice(0, 60))}`);
    }
  }
  assert.throws(() => rewordForLinux(shared("components/onboarding/SourceStep.tsx"), "export const nothing = 1;"), /no longer contains/);
  assert.equal(rewordForLinux(shared("components/settings/panes/General.tsx"), "const x = 'Mac';"), null);
});

test("the Linux Vite config runs the Linux wording transform", () => {
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /import \{ linuxWording \} from "\.\/linuxWording";/);
  assert.match(config, /plugins: \[[^\]]*linuxWording\(\)/);
});

test("removing an unpacked extension says its folder stays on this computer", () => {
  const actions = linuxCopy("state/extensions/actions.ts");
  assert.match(actions, /"The extension's folder stays on this computer\."/);
  assert.doesNotMatch(actions, /stays on your Mac/);
});

test("a production build fails when a listed file was loaded but never reworded", () => {
  const context = { error(message) { throw new Error(message); } };
  const run = (command, files, modules = files.map(shared)) => {
    const plugin = linuxWording();
    plugin.configResolved({ command });
    for (const file of files) plugin.transform.call(context, readFileSync(shared(file), "utf8"), shared(file));
    return () => plugin.buildEnd.call({ ...context, getModuleIds: () => [...modules].values() });
  };
  const all = LINUX_WORDING.map((entry) => entry.file);
  assert.doesNotThrow(run("build", all));
  assert.throws(run("build", all.filter((file) => !file.endsWith("SourceStep.tsx")), all.map(shared)), /onboarding\/SourceStep\.tsx/);
  assert.throws(run("build", [], [shared("components/import/ImportWindow.tsx")]), /never reworded/);
  assert.doesNotThrow(run("serve", []));
  assert.doesNotThrow(run("build", [], [shared("components/site/SiteControls.tsx")]));
  const failed = linuxWording();
  failed.configResolved({ command: "build" });
  assert.doesNotThrow(() => failed.buildEnd.call({ ...context, getModuleIds: () => [shared("components/import/ImportWindow.tsx")].values() }, new Error("earlier failure")));
});

const componentFiles = (dir) => readdirSync(new URL(`../../browser/src/${dir}`, import.meta.url), { recursive: true })
  .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".test.ts"))
  .map((file) => `${dir}/${file}`);
const linuxComponentCopy = (path) => {
  const source = readFileSync(shared(path), "utf8");
  const shortcuts = path.startsWith("components/") && !path.endsWith("/settings/searchMatch.ts") ? linuxShortcutText(source) : source;
  const reworded = rewordForLinux(shared(path), shortcuts) ?? shortcuts;
  return rewordCredentials(shared(path), reworded) ?? reworded;
};

test("click modifiers read Shift-click, Alt-click and Alt+Shift-click on Linux, and key combinations still read Ctrl+Z", () => {
  const tabs = linuxComponentCopy("components/settings/panes/Tabs.tsx");
  for (const title of [`title: "Shift-click"`, `title: "Alt-click"`, `title: "Alt+Shift-click"`, `"Alt-click (Peek moves to Shift-click)"`, `"Alt-click (split view moves to Alt+Shift-click)"`, `"Alt-click opens a split now: choosing it here moves split view back to Alt+Shift-click."`]) {
    assert.ok(tabs.includes(title), title);
  }
  const rows = linuxComponentCopy("components/settings/rows/generalRows.ts");
  assert.match(rows, /Ctrl\+Alt-click splits too, and so does Alt\+Shift-click when Alt-click is chosen/);
  assert.match(rows, /title: "Ctrl-clicking links creates tab groups"/);
  assert.match(linuxComponentCopy("components/settings/rows/privacyRows.ts"), /title: "Zoom with Ctrl and the mouse wheel"/);
  assert.match(rows, /Asks before \$\{APP\} quits with Ctrl\+Shift\+Q\./);
  assert.match(linuxComponentCopy("components/onboarding/LayoutSteps.tsx"), /title: "Shift-click"/);
  assert.match(linuxComponentCopy("components/tabstrip/NewTabButton.tsx"), /New Tab \(Ctrl\+T\) — Alt-click to open in Split View/);
  assert.equal(linuxShortcutText(`"⇧⌘S" "⌘Z" "⌥⌘I" "⌃⇧Tab"`), `"Shift+Ctrl+S" "Ctrl+Z" "Alt+Ctrl+I" "Super+Shift+Tab"`);
  const stray = componentFiles("components").filter((path) => (linuxComponentCopy(path).match(/\+-[a-z]/g) ?? []).length > (readFileSync(shared(path), "utf8").match(/\+-[a-z]/g) ?? []).length);
  assert.deepEqual(stray, []);
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /return \{ code: linuxShortcutText\(code\), map: null \}/);
});

test("onboarding names no Mac, macOS or Dock on Linux, and its default-browser question is Linux's own", () => {
  const config = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
  assert.match(config, /\[here\("\.\.\/browser\/src\/components\/onboarding\/HomeStep\.tsx"\), here\("\.\/src\/LinuxHomeStep\.tsx"\)\]/);
  const words = /\bMacs?\b|macOS|\bDock\b|iCloud|Keychain/;
  const leftover = componentFiles("components/onboarding")
    .filter((path) => path !== "components/onboarding/HomeStep.tsx")
    .flatMap((path) => strings(linuxComponentCopy(path)).filter((text) => words.test(text)).map((text) => `${path}: ${text}`));
  assert.deepEqual(leftover, []);
  const linuxStep = readFileSync(new URL("./LinuxHomeStep.tsx", import.meta.url), "utf8");
  assert.deepEqual(strings(linuxStep).filter((text) => words.test(text)), []);
  assert.doesNotMatch(linuxStep, /isInDock|addToDock/);
  assert.doesNotMatch(DEFAULT_BROWSER_ELSEWHERE, words);
});

test("the default-browser step settles on Linux whether or not the desktop integrations exist", async () => {
  const never = () => new Promise(() => {});
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: false, launchAtLogin: false }, { isDefaultBrowser: never, launchAtLoginStatus: never }), { isDefault: false, loginEnabled: false });
  const refused = () => Promise.reject(Object.assign(new Error("unavailable"), { code: "ERR_UNAVAILABLE" }));
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: true, launchAtLogin: true }, { isDefaultBrowser: refused, launchAtLoginStatus: refused }), { isDefault: false, loginEnabled: false });
  assert.deepEqual(await readOnboardingSystem({ defaultBrowser: true, launchAtLogin: true }, { isDefaultBrowser: async () => true, launchAtLoginStatus: async () => "enabled" }), { isDefault: true, loginEnabled: true });
});
