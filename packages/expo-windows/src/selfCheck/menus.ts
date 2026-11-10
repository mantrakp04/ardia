import type { MenuShortcut, MenusNative, MenuState } from "@ardia/shell";
import { requireNativeModule } from "../modules";
import { expectEqual, expectTrue, type Check } from "./check";

type MenusOnWindows = MenusNative & { activeShortcuts(): Promise<Record<string, string[][]>> };
type SentState = Omit<MenuState, "bookmarkFolders" | "recentBookmarks" | "bookmarksBar" | "otherBookmarks">;

const menus = () => requireNativeModule<MenusOnWindows>("ArdiaMenus");

const withinSeconds = <Value>(seconds: number, what: string, promise: Promise<Value>) =>
  Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer within ${seconds}s`)), seconds * 1000))]);

const smallState = (overrides: Partial<SentState> = {}): SentState => ({
  checked: ["toggleFullUrl"],
  disabled: ["closeAllTabs"],
  titles: {},
  profiles: [
    { id: "selfcheck-home", title: "Home", current: true },
    { id: "selfcheck-work", title: "Work" },
  ],
  windows: [],
  recentlyClosed: [],
  warnBeforeQuitting: false,
  extensions: [{ id: "selfcheck-extension", title: "Self Check", enabled: true }],
  shortcuts: {},
  ...overrides,
});

const byId = (items: MenuShortcut[]) => new Map(items.map((item) => [item.id, item]));

export const checks: Check[] = [
  {
    name: "menus: menuShortcuts lists the command table with ids and paths",
    async run() {
      const items = await withinSeconds(5, "menuShortcuts", menus().menuShortcuts());
      expectTrue(Array.isArray(items) && items.length > 50, `menuShortcuts returned ${Array.isArray(items) ? items.length : typeof items} items`);
      for (const item of items) {
        expectTrue(typeof item.id === "string" && item.id.length > 0, `an entry has no id: ${JSON.stringify(item)}`);
        expectTrue(Array.isArray(item.path) && item.path.length > 0, `${item.id} has no path`);
        expectTrue(typeof item.title === "string" && item.title.length > 0, `${item.id} has no title`);
      }
      const listed = byId(items);
      const newTab = listed.get("newTab");
      expectTrue(newTab?.remappable === true, "newTab is missing or not remappable");
      expectEqual(newTab.path, ["File"], "newTab path");
      const copy = listed.get("system:Edit > Copy");
      expectTrue(copy && !copy.remappable, "system:Edit > Copy is missing or remappable");
      expectEqual({ key: copy.key, modifiers: copy.modifiers }, { key: "c", modifiers: ["control"] }, "Copy is the system's Ctrl+C");
      expectTrue(!listed.has("std:copy:") && !listed.has("std:quit:"), "editing and quit items are listed as remappable");
    },
  },
  {
    name: "menus: commands default to Ctrl-based shortcuts",
    async run() {
      await withinSeconds(5, "setMenuState", menus().setMenuState(smallState()));
      const active = await withinSeconds(5, "activeShortcuts", menus().activeShortcuts());
      expectEqual(active.newTab, [["t", "control"]], "newTab default");
      expectEqual(active["selectTab:1"], [["1", "control"]], "selectTab:1 default");
      expectEqual(active.reload, [["r", "control"], [String.fromCharCode(0xf708)]], "reload default");
      expectEqual(active["std:toggleFullScreen:"], [[String.fromCharCode(0xf70e)]], "full screen default");
      expectEqual(active["switchProfile:selfcheck-home"], [["1", "option"]], "first profile default");
    },
  },
  {
    name: "menus: setMenuState resolves and the shortcut list follows its profiles and extensions",
    async run() {
      await withinSeconds(5, "setMenuState", menus().setMenuState(smallState()));
      await withinSeconds(5, "setMenuBookmarks", menus().setMenuBookmarks({ bookmarkFolders: [], recentBookmarks: [], bookmarksBar: [], otherBookmarks: [] }));
      const listed = byId(await withinSeconds(5, "menuShortcuts", menus().menuShortcuts()));
      expectEqual(listed.get("switchProfile:selfcheck-work")?.path, ["Window", "Profiles"], "switchProfile:selfcheck-work path");
      expectEqual(listed.get("newLittleArdia:selfcheck-home")?.path, ["File", "New Little Ardia Window in Profile"], "newLittleArdia:selfcheck-home path");
      expectEqual(listed.get("openExtension:selfcheck-extension")?.path, ["Extensions"], "openExtension:selfcheck-extension path");
      expectTrue(!listed.has("newWindow:selfcheck-home"), "the profile's new-window alternate is listed");
    },
  },
  {
    name: "menus: rebinding keeps Mac defaults on their Windows keys and applies recorded keys",
    async run() {
      const shortcuts = { newTab: [["t", "command"]], closeTab: [["e", "control", "shift"]], back: [] };
      await withinSeconds(5, "setMenuState", menus().setMenuState(smallState({ shortcuts })));
      const active = await withinSeconds(5, "activeShortcuts", menus().activeShortcuts());
      await withinSeconds(5, "setMenuState", menus().setMenuState(smallState()));
      expectEqual(active.newTab, [["t", "control"]], "newTab bound to its Mac default");
      expectEqual(active.closeTab, [["e", "control", "shift"]], "closeTab rebound");
      expectEqual(active.back, [], "back unbound");
    },
  },
  {
    name: "menus: a context menu in background mode is logged and answers null",
    async run() {
      const choice = await withinSeconds(
        5,
        "showMenu",
        menus().showMenu([
          { id: "first", title: "First" },
          { separator: true },
          { id: "second", title: "Second", checked: true, enabled: false },
          { id: "more", title: "More", children: [{ id: "inner", title: "Inner" }] },
        ]),
      );
      expectEqual(choice, null, "background showMenu answer");
    },
  },
  {
    name: "menus: recording a shortcut can be cancelled",
    async run() {
      const recorded = menus().recordShortcut();
      await withinSeconds(5, "cancelRecording", menus().cancelRecording());
      expectEqual(await withinSeconds(5, "recordShortcut", recorded), null, "cancelled recording");
    },
  },
];
