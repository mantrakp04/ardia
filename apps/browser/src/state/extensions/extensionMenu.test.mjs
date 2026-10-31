import assert from "node:assert/strict";
import { test } from "node:test";
const { extensionMenuItems, EXTENSION_LIST_ITEMS } = await import("./actions.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items, depth = 0) =>
  items.flatMap((i) => [
    "  ".repeat(depth) + (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.swatch ? "(swatch)" : "", i.enabled === false ? "(off)" : "", i.children ? "›" : ""].filter(Boolean).join(" ")),
    ...(i.children ? render(i.children, depth + 1) : []),
  ]);

const ext = { name: "Dark Reader", enabled: true, pinned: false, optionsUrl: "chrome-extension://x/options.html", sidePanel: false, mayModify: true };

test("an extension's menu: its name, Options and Pin, Turn Off and Manage Extension, Remove Extension… last", () => {
  assert.deepEqual(render(extensionMenuItems(ext, false)), [
    "Dark Reader (off)",
    "---",
    "Options [gearshape]",
    "Pin to Toolbar [pin]",
    "---",
    "Turn Off [power]",
    "Manage Extension [puzzlepiece.extension]",
    "---",
    "Remove Extension… [trash]",
  ]);
  assert.deepEqual(render(extensionMenuItems({ ...ext, pinned: true, sidePanel: true, mayModify: false }, true)).slice(2, 5), [
    "Options [gearshape]",
    "Close Side Panel [sidebar.right]",
    "Unpin from Toolbar [pin.slash]",
  ]);
  const off = render(extensionMenuItems({ ...ext, enabled: false, sidePanel: true }, false));
  assert.deepEqual(off.slice(2, 4), ["Options [gearshape] (off)", "Pin to Toolbar [pin]"]);
  assert.equal(off[5], "Turn On [power]");
});

test("the puzzle menu and the Add Extension tile list the same three items in the menu bar's order", () => {
  assert.deepEqual(render(EXTENSION_LIST_ITEMS), ["Add Extension… [plus]", "Manage Extensions… [puzzlepiece.extension]", "Pin Extensions… [pin]"]);
});

for (const scenario of ["focused", "background", "private-reassigned"]) test(`Manage Extension keeps the menu window's Profile and detail: ${scenario}`, async (t) => {
  const { useBrowser } = await import("../browser/store.ts");
  const { useSettingsNav } = await import("../settings/settingsWindows.ts");
  const { showExtensionMenu } = await import("./actions.ts");
  const { shellNativeModules } = await import("../../test-native/index.ts");
  const S = () => useBrowser.getState();
  S().hydrate({});
  useSettingsNav.setState({ pane: "general", spaceId: null, detail: null, back: [], forward: [] });
  const profile = S().createProfile({ name: "Work" });
  const space = S().createSpace({ name: "Projects", profileId: profile });
  const source = S().createWindow({ spaceId: space, ...(scenario === "private-reassigned" ? { kind: "private" } : {}) });
  if (scenario === "private-reassigned") S().assignSpaceProfile(space, "default");
  const other = S().createWindow({ spaceId: "default" });
  S().setFocusedWindow(scenario === "focused" ? source : other);
  t.mock.method(shellNativeModules.ArdiaMenus, "showMenu", async () => "manage");
  await showExtensionMenu(source, { ...ext, id: "reader" });
  const nav = useSettingsNav.getState();
  assert.equal(nav.pane, "extensions");
  assert.equal(nav.spaceId, profile);
  assert.equal(nav.detail, "reader");
});
