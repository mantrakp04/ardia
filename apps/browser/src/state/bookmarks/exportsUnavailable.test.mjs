import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../", import.meta.url));

const ON_WINDOWS = `import { registerHooks } from "node:module";
registerHooks({ resolve(specifier, context, next) {
  const resolved = next(specifier, context);
  return resolved.url.endsWith("/lib/platformFeatures.ts") ? { ...resolved, url: resolved.url.replace(/platformFeatures\\.ts$/, "platformFeatures.windows.ts") } : resolved;
} });`;

const ENTRY_POINTS = `
const { useBrowser } = await import("./src/state/browser/store.ts");
const { UNAVAILABLE_COMMANDS } = await import("./src/state/commands/commandCatalog.ts");
const { barActions } = await import("./src/state/omnibox/barActions.ts");
const { organizeMenuItems } = await import("./src/state/bookmarks/bookmarkMenus.ts");
const { unshownSettings } = await import("./src/components/settings/settingsIndex.ts");
const { automationCommands } = await import("./src/state/automation/automationCommands.ts");
const { menuState } = await import("./src/state/commands/menuState.ts");
const S = () => useBrowser.getState();
S().hydrate({});
const w = S().createWindow({ url: "https://a.example/" });
const unshown = unshownSettings(S().settings, { top: true }).split("\\n");
console.log(JSON.stringify({
  unavailable: UNAVAILABLE_COMMANDS.has("exportBookmarks"),
  bar: barActions(S(), w).some((a) => a.id === "exportBookmarks"),
  organize: organizeMenuItems().filter((i) => !i.separator).map((i) => i.id),
  unshown: ["general.exportBookmarks", "passwords.exportPasswords"].filter((id) => unshown.includes(id)),
  cli: automationCommands().some((c) => c.id === "exportBookmarks"),
  menuDisabled: menuState(S()).disabled.includes("exportBookmarks"),
}));
`;

function entryPoints(onWindows) {
  const hooks = onWindows ? ["--import", `data:text/javascript,${encodeURIComponent(ON_WINDOWS)}`] : [];
  const run = spawnSync(process.execPath, ["--no-warnings", "--import", "./src/test-loader.mjs", ...hooks, "--input-type=module", "-e", ENTRY_POINTS], { cwd: APP, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout.trim().split("\n").at(-1));
}

const EVERY_ENTRY_POINT = {
  unavailable: false,
  bar: true,
  organize: ["bookmark", "folder", "import", "export"],
  unshown: [],
  cli: true,
  menuDisabled: false,
};

test("on Windows every export entry point is offered, now that the password export confirms over the app window", () => {
  assert.deepEqual(entryPoints(true), EVERY_ENTRY_POINT);
});

test("on the Mac every export entry point stays", () => {
  assert.deepEqual(entryPoints(false), EVERY_ENTRY_POINT);
});
