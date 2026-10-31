import assert from "node:assert/strict";
import test from "node:test";
import { createWindowMenu, mergeableWindows, windowMenuItems, windowMenuWindows } from "./windowMenu.ts";

const settle = () => new Promise(setImmediate);

const state = {
  windowOrder: ["main", "second", "little", "w-p-own", "settings"],
  windows: {
    main: { kind: "main" },
    second: { kind: "main" },
    little: { kind: "small" },
    "w-p-own": { kind: "private" },
    settings: { kind: "main" },
  },
};
const titles = { main: "Default — Inbox", second: "Default — News & 2 Tabs", "w-p-own": "Default — Bank statement" };
const title = (_s, id) => titles[id] ?? "";
const utility = (id) => id === "settings";

function fixture({ windowId = "main", directory = [], show = async () => null, capabilities = ["engine.openTaskManager"] } = {}) {
  const invoked = [];
  const commands = [];
  const shown = [];
  const host = {
    bootstrap: { windowId, profileId: "default", capabilities },
    invoke: async (method, args) => {
      invoked.push([method, args]);
      if (method === "ArdiaShell.privateWindows") {
        if (directory instanceof Error) throw directory;
        return directory;
      }
      return null;
    },
    onEvent: () => () => {},
  };
  const menu = createWindowMenu(host, {
    state: () => state,
    title,
    utility,
    show: async (items) => { shown.push(items); return show(items); },
    command: (event) => commands.push(event),
  });
  return { menu, invoked, commands, shown };
}

const ids = (items) => items.map((item) => ("separator" in item ? "---" : item.id));

test("a regular window lists itself, the other regular windows by title and private windows by number only", () => {
  const windows = windowMenuWindows(state, "main", title, utility);
  assert.deepEqual(windows, [
    { id: "main", title: "Default — Inbox", current: true },
    { id: "second", title: "Default — News & 2 Tabs" },
  ]);
  const items = windowMenuItems({ windowId: "main", windows, privateWindows: [{ id: "w-p1", title: "Bank", url: "https://bank.test/" }, { id: "w-p2" }], taskManager: true, canMerge: true });
  assert.deepEqual(ids(items), ["minimize", "maximize", "---", "command:downloads", "command:taskManager", "command:mergeAllWindows", "---", "focus:main", "focus:second", "focus:w-p1", "focus:w-p2"]);
  const entries = items.filter((item) => "id" in item && item.id.startsWith("focus:"));
  assert.deepEqual(entries.map((item) => [item.title, item.checked === true]), [
    ["Default — Inbox", true],
    ["Default — News & 2 Tabs", false],
    ["Private Window", false],
    ["Private Window 2", false],
  ]);
  assert.ok(!JSON.stringify(items).includes("bank.test"));
  assert.ok(!JSON.stringify(items).includes("Bank"));
});

test("merge needs two regular windows and the Task Manager entry follows the host capability", () => {
  assert.equal(mergeableWindows(state, utility), true);
  assert.equal(mergeableWindows({ ...state, windowOrder: ["main", "little", "w-p-own", "settings"] }, utility), false);
  const alone = windowMenuItems({ windowId: "main", windows: [{ id: "main", title: "A", current: true }], privateWindows: [], taskManager: false, canMerge: false });
  assert.deepEqual(ids(alone), ["minimize", "maximize", "---", "command:downloads", "command:mergeAllWindows", "---", "focus:main"]);
  assert.equal(alone.find((item) => item.id === "command:mergeAllWindows").enabled, false);
});

test("a private window keeps its own title, lists regular windows and numbers the other private windows", () => {
  const windows = windowMenuWindows(state, "w-p-own", title, utility);
  assert.deepEqual(windows.map((w) => w.id), ["main", "second", "w-p-own"]);
  const items = windowMenuItems({ windowId: "w-p-own", windows, privateWindows: [{ id: "w-p-own" }, { id: "w-p9" }], taskManager: true, canMerge: true });
  const entries = items.filter((item) => "id" in item && item.id.startsWith("focus:"));
  assert.deepEqual(entries.map((item) => [item.id, item.title]), [
    ["focus:main", "Default — Inbox"],
    ["focus:second", "Default — News & 2 Tabs"],
    ["focus:w-p-own", "Default — Bank statement"],
    ["focus:w-p9", "Private Window"],
  ]);
});

test("a regular window never shows another private window's title even when its store holds one", () => {
  const leaky = { ...state, windowOrder: [...state.windowOrder, "w-p-other"], windows: { ...state.windows, "w-p-other": { kind: "private" } } };
  const windows = windowMenuWindows(leaky, "main", (s, id) => (id === "w-p-other" ? "Secret" : title(s, id)), utility);
  assert.deepEqual(windows.map((w) => w.id), ["main", "second"]);
});

test("choosing a window focuses it through the host and commands go to the shared command path", async () => {
  const picks = ["focus:w-p1", "focus:second", "command:downloads", "minimize", "maximize", "focus:unknown", null];
  const f = fixture({ directory: [{ id: "w-p1" }], show: async () => picks.shift() });
  for (let i = 0; i < 7; i += 1) await f.menu.open("main");
  await settle();
  const native = f.invoked.filter(([method]) => method !== "ArdiaShell.privateWindows");
  assert.deepEqual(native, [
    ["ArdiaShell.focusWindow", { args: ["w-p1"] }],
    ["ArdiaShell.focusWindow", { args: ["second"] }],
    ["ArdiaShell.minimizeWindow", { args: ["main"] }],
    ["ArdiaShell.toggleMaximizeWindow", { args: ["main"] }],
  ]);
  assert.deepEqual(f.commands, [{ command: "downloads", arg: null, windowId: "main" }]);
  assert.equal(f.invoked.filter(([method]) => method === "ArdiaShell.privateWindows").length, 7);
});

test("the menu still opens with the regular windows when the private directory fails", async () => {
  const f = fixture({ directory: new Error("gone") });
  await f.menu.open("main");
  assert.deepEqual(ids(f.shown[0]).filter((id) => id.startsWith("focus:")), ["focus:main", "focus:second"]);
});

test("utility windows and windows of another renderer get no menu", async () => {
  const f = fixture({ windowId: "main" });
  assert.equal(await f.menu.open("settings"), false);
  assert.equal(await f.menu.open("second"), false);
  assert.equal(f.shown.length, 0);
  assert.equal(await f.menu.open("main"), true);
});
