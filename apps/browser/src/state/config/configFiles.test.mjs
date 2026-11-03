import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { configFolder, emitConfigChange } = await import("../../test-native/shell.ts");
const { startConfigFiles, reconcileConfig, resetConfigFilesForTests } = await import("./configFiles.ts");
const { useBasePalette } = await import("./basePalette.ts");
const { useToasts } = await import("../app/toasts.ts");
const { firstWindowCommitted } = await import("../../lib/afterFirstWindow.ts");
const { colorRoles } = await import("../../components/ui/tokens.ts");

const S = () => useBrowser.getState();
const files = configFolder.files;
const warnings = [];
console.warn = (...args) => warnings.push(args.join(" "));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
const elapse = async (t, ms) => {
  await flush();
  t.mock.timers.tick(ms);
  await flush();
};
firstWindowCommitted();
const writeConfig = (doc) => files.set("config.json", typeof doc === "string" ? doc : JSON.stringify(doc));

function fresh(settings = {}) {
  resetConfigFilesForTests();
  files.clear();
  warnings.length = 0;
  S().hydrate({ settings });
}

test("at launch the file's settings apply through updateSettings, so they count as chosen and sync", () => {
  fresh({ selectedTabGlow: "off" });
  writeConfig({ settings: { selectedTabGlow: "soft", tabLayout: "top" } });
  startConfigFiles(colorRoles);
  assert.equal(S().settings.selectedTabGlow, "soft");
  assert.equal(S().settings.tabLayout, "top");
  assert.ok(S().settingsMeta.chosen.includes("tabLayout"));
});

test("a change made in the app stands until the file changes; every change event re-reads and puts the file's value back", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  fresh();
  writeConfig({ settings: { tabLayout: "top" } });
  startConfigFiles(colorRoles);
  await elapse(t, 0);
  await elapse(t, 100);
  S().updateSettings({ tabLayout: "sidebar" });
  assert.equal(S().settings.tabLayout, "sidebar");
  S().updateSettings({ tabLayout: "sidebar" }, { fromSync: true });
  await elapse(t, 150);
  assert.equal(S().settings.tabLayout, "sidebar", "a sync arrival doesn't trigger a re-apply");
  emitConfigChange();
  emitConfigChange();
  await elapse(t, 100);
  assert.equal(S().settings.tabLayout, "top", "the same file, rewritten, is applied again");
  assert.ok(configFolder.watched.at(-1).includes("config.json"));
  assert.ok(configFolder.schemaWrites.length >= 1);
});

test("a window that isn't the launch takes the theme but leaves settings and known problems alone until the file changes", async () => {
  fresh({ tabLayout: "sidebar" });
  const window = S().createWindow({ url: "https://a.com/" });
  files.set("themes/nord.json", JSON.stringify({ dark: { accent: "#88C0D0" } }));
  writeConfig({ theme: "nord", settings: { tabLayout: "top", selectedTabGlow: "bright" } });
  startConfigFiles(colorRoles, false);
  firstWindowCommitted();
  await wait(10);
  assert.equal(S().settings.tabLayout, "sidebar");
  assert.equal(useBasePalette.getState().theme, "nord");
  assert.equal(useToasts.getState().toasts[window], undefined);
  emitConfigChange();
  await settled();
  assert.equal(S().settings.tabLayout, "top");
  assert.equal(useToasts.getState().toasts[window], undefined, "a problem the launch window showed isn't shown again");
});

test("taking a key out of the file, or deleting the file, keeps the current value", () => {
  fresh();
  writeConfig({ settings: { tabLayout: "top" } });
  startConfigFiles(colorRoles);
  writeConfig({ settings: {} });
  reconcileConfig();
  assert.equal(S().settings.tabLayout, "top");
  files.delete("config.json");
  reconcileConfig();
  assert.equal(S().settings.tabLayout, "top");
});

test("a broken file changes nothing, applies what's valid in a fixable one, and reports each problem once", async () => {
  fresh();
  const window = S().createWindow({ url: "https://a.com/" });
  writeConfig('{ "settings": { "tabLayout": "top" ');
  startConfigFiles(colorRoles);
  await wait(10);
  assert.equal(S().settings.tabLayout, "sidebar");
  assert.match(useToasts.getState().toasts[window].title, /^config\.json: isn't valid JSON/);
  writeConfig({ settings: { tabLayout: "top", selectedTabGlow: "bright" } });
  reconcileConfig();
  assert.equal(S().settings.tabLayout, "top");
  assert.equal(useToasts.getState().toasts[window].title, "config.json: selectedTabGlow must be full, soft or off");
  const shown = useToasts.getState().toasts[window].id;
  reconcileConfig();
  assert.equal(useToasts.getState().toasts[window].id, shown, "the same problem isn't toasted again");
  assert.equal(warnings.filter((w) => w.includes("selectedTabGlow")).length, 1);
});

test("the theme's roles become the base palette with a new revision, and an unparseable edit keeps the last good version", () => {
  fresh();
  writeConfig({ theme: "nord" });
  files.set("themes/nord.json", JSON.stringify({ dark: { accent: "#88C0D0" } }));
  startConfigFiles(colorRoles);
  const first = useBasePalette.getState().palette;
  assert.equal(first.dark.accent, "#88C0D0");
  assert.equal(first.light.accent, colorRoles.light.accent);
  files.set("themes/nord.json", '{ "dark": { "accent": ');
  reconcileConfig();
  assert.equal(useBasePalette.getState().palette, first, "nothing changed, so no new revision");
  files.set("themes/nord.json", JSON.stringify({ dark: { accent: "#123456" } }));
  reconcileConfig();
  const second = useBasePalette.getState().palette;
  assert.equal(second.dark.accent, "#123456");
  assert.ok(second.revision > first.revision);
  writeConfig({ theme: null });
  reconcileConfig();
  assert.equal(useBasePalette.getState().palette, null);
  writeConfig({ theme: "gone" });
  reconcileConfig();
  assert.equal(useBasePalette.getState().palette, null);
  assert.ok(warnings.some((w) => w.includes("config.json: theme gone has no file themes/gone.json")));
});

test("an edit between the launch read and the watcher arming is picked up once the watcher is armed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  fresh();
  writeConfig({ settings: { selectedTabGlow: "soft" } });
  let arm;
  configFolder.arming = new Promise((resolve) => (arm = resolve));
  startConfigFiles(colorRoles);
  writeConfig({ settings: { selectedTabGlow: "off" } });
  await elapse(t, 150);
  assert.equal(S().settings.selectedTabGlow, "soft", "no event reaches an unarmed watcher");
  arm();
  await elapse(t, 100);
  assert.equal(S().settings.selectedTabGlow, "off");
  configFolder.arming = null;
});

test("restoreSession from the file decides the launch restore, both ways", async () => {
  const { flushPersistence, loadSession, startPersistence } = await import("../session/persist.ts");
  startPersistence();
  const { configRestoreSession } = await import("./configFiles.ts");
  const savedWith = (restoreSession) => {
    fresh();
    S().createWindow({ url: "https://a.com/" });
    S().updateSettings({ restoreSession });
    flushPersistence();
  };
  savedWith(false);
  writeConfig({ settings: { restoreSession: true } });
  assert.equal(configRestoreSession(), true);
  assert.ok(loadSession({ restoreSession: configRestoreSession() }).windowOrder.length > 0, "saved false, file true: the windows come back");
  savedWith(true);
  writeConfig({ settings: { restoreSession: false } });
  assert.equal(loadSession({ restoreSession: configRestoreSession() }).windowOrder.length, 0, "saved true, file false: nothing is restored");
  writeConfig({ settings: { restoreSession: "no" } });
  assert.equal(configRestoreSession(), undefined, "an invalid value leaves the saved setting in charge");
  files.delete("config.json");
  assert.equal(configRestoreSession(), undefined);
});
