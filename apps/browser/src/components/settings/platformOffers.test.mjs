import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../", import.meta.url));

const ON_WINDOWS = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  const swapped = resolved.url.match(/\\/lib\\/(platformFeatures|platformTerms)\\.ts$/) || resolved.url.match(/\\/state\\/commands\\/(keyText)\\.ts$/);
  return swapped ? { ...resolved, url: resolved.url.replace(/\\.ts$/, ".windows.ts") } : resolved;
} });`;

const OFFERS = `
const { useBrowser } = await import("./src/state/browser/store.ts");
const { PANES, SETTINGS, unshownSettings } = await import("./src/components/settings/settingsIndex.ts");
const { UNAVAILABLE_COMMANDS } = await import("./src/state/commands/commandCatalog.ts");
const { canSwitchEngine } = await import("./src/state/engines/engines.ts");
const S = () => useBrowser.getState();
S().hydrate({});
const unshown = new Set(unshownSettings(S().settings, { top: false }).split("\\n"));
const watched = ["sync.sync", "calendar.access", "engines.defaultEngine", "privacy.blockAds", "privacy.filterLists", "general.littleWindowGestures", "tabs.videoUpscaling", "tabs.tabReorderHaptics", "appearance.pageScrollBars"];
const shownCopy = SETTINGS.filter((e) => !unshown.has(e.id)).map((e) => [e.id, [e.title, e.description ?? ""].join(" ")]);
console.log(JSON.stringify({
  panes: PANES.map((p) => p.id).filter((id) => ["sync", "calendar", "engines"].includes(id)),
  hidden: watched.filter((id) => unshown.has(id)),
  engineCommand: UNAVAILABLE_COMMANDS.has("togglePageEngine"),
  switchesEngine: canSwitchEngine("https://example.com/"),
  macWords: shownCopy.filter(([, text]) => /macOS|Touch ID|Keychain|this Mac|View ›|Apple silicon/.test(text)).map(([id]) => id),
}));
`;

function offers(onWindows) {
  const hooks = onWindows ? ["--import", `data:text/javascript,${encodeURIComponent(ON_WINDOWS)}`] : [];
  const run = spawnSync(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", ...hooks, "--input-type=module", "-e", OFFERS], { cwd: APP, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").at(-1));
}

test("Windows offers no Sync, Calendar or WebKit pane, no blocker, gesture, upscaling, haptics or scroll bar row, and no Settings copy that names the Mac", () => {
  assert.deepEqual(offers(true), {
    panes: [],
    hidden: ["sync.sync", "calendar.access", "engines.defaultEngine", "privacy.blockAds", "privacy.filterLists", "general.littleWindowGestures", "tabs.videoUpscaling", "tabs.tabReorderHaptics", "appearance.pageScrollBars"],
    engineCommand: true,
    switchesEngine: false,
    macWords: [],
  });
});

test("the Mac keeps every pane, row and the engine switch", () => {
  const mac = offers(false);
  assert.deepEqual(mac.panes, ["sync", "engines", "calendar"]);
  assert.deepEqual(mac.hidden, []);
  assert.equal(mac.engineCommand, false);
  assert.equal(mac.switchesEngine, true);
});
