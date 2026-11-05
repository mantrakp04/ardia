import assert from "node:assert/strict";
import { test } from "node:test";
const { barMenuItems } = await import("./barMenus.ts");
const { bookmarkRowMenuItems, rowMenuTarget } = await import("./bookmarkMenus.ts");
const { historyRowMenuItems } = await import("../history/historyMenus.ts");

const G = { control: "⌃", option: "⌥", shift: "⇧", command: "⌘" };
const keys = (i) => (i.key ? ["control", "option", "shift", "command"].filter((m) => i.modifiers?.includes(m)).map((m) => G[m]).join("") + i.key.toUpperCase() : "");
const render = (items) =>
  items.map((i) => (i.separator ? "---" : [i.checked ? "✓" : "", i.title, keys(i), i.symbol ? `[${i.symbol}]` : "", i.enabled === false ? "(off)" : "", i.alternate ? "(alt)" : ""].filter(Boolean).join(" ")));

const OPEN_ONE = ["Open in New Tab [plus.app]", "Open in New Window [macwindow.badge.plus]", "Open in Incognito Window [eyeglasses]", "Open in Split View [rectangle.split.2x1]"];
const COPY_ONE = ["Copy Link [link]", "Copy Link as Markdown [link] (alt)"];
const OPEN_ALL = ["Open All in New Tabs [plus.app]", "Open All in New Window [macwindow.badge.plus]", "Open All in Incognito Window [eyeglasses]"];

test("a bookmarks bar link: opens, Copy Link, Edit…, and Delete last, with no bar settings mixed in", () => {
  assert.deepEqual(render(barMenuItems({ kind: "url" }, { barShown: true })), [...OPEN_ONE, "---", ...COPY_ONE, "---", "Edit… [pencil]", "---", "Delete [trash]"]);
});

test("a bookmarks bar folder: Open All in each place, group, Rename… and New Folder…, Delete Folder last", () => {
  assert.deepEqual(render(barMenuItems({ kind: "folder", links: 2, makesGroup: true, restoresArc: false }, { barShown: true })), [
    ...OPEN_ALL,
    "---",
    "Add to Sidebar as Group [sidebar.left]",
    "---",
    "Rename… [pencil]",
    "New Folder… [folder.badge.plus]",
    "---",
    "Delete Folder [trash]",
  ]);
  const empty = render(barMenuItems({ kind: "folder", links: 0, makesGroup: false, restoresArc: true }, { barShown: true }));
  assert.deepEqual(empty.slice(0, 6), [...OPEN_ALL.map((t) => `${t} (off)`), "---", "Add to Sidebar as Group [sidebar.left] (off)", "Restore Arc Folders as Groups"]);
});

test("the bookmarks bar background: Add Page…, New Folder…, then Manage Bookmarks and the bar toggle with their real keys", () => {
  assert.deepEqual(render(barMenuItems(null, { barShown: true })), [
    "Add Page… [bookmark]",
    "New Folder… [folder.badge.plus]",
    "---",
    "Manage Bookmarks ⌥⌘B [book]",
    "✓ Show Bookmarks Bar ⇧⌘B",
    "Bookmarks Bar Size",
  ]);
  assert.deepEqual(render(barMenuItems(null, { barShown: false, keys: () => ({}) })).slice(3), ["Manage Bookmarks [book]", "Show Bookmarks Bar", "Bookmarks Bar Size"]);
  const sizes = (size) => render(barMenuItems(null, { barShown: true, size }).at(-1).children);
  assert.deepEqual(sizes("default"), ["✓ Default", "Large"]);
  assert.deepEqual(sizes("large"), ["Default", "✓ Large"]);
});

test("a Bookmarks page row matches the bar, adds Show in Folder for a search result, and a selection acts on all of it", () => {
  assert.deepEqual(render(bookmarkRowMenuItems({ kind: "url", showPath: true })), [...OPEN_ONE, "Show in Folder [folder]", "---", ...COPY_ONE, "---", "Edit… [pencil]", "---", "Delete [trash]"]);
  assert.deepEqual(render(bookmarkRowMenuItems({ kind: "folder", links: 3, makesGroup: false, restoresArc: false, showPath: false })), [
    ...OPEN_ALL,
    "---",
    "Add to Sidebar as Group [sidebar.left] (off)",
    "---",
    "Rename… [pencil]",
    "New Folder… [folder.badge.plus]",
    "---",
    "Delete Folder [trash]",
  ]);
  assert.deepEqual(render(bookmarkRowMenuItems({ kind: "several", links: 3, items: 2, noun: "Items" })), [
    "Open 3 in New Tabs [plus.app]",
    "Open 3 in New Window [macwindow.badge.plus]",
    "Open 3 in Incognito Window [eyeglasses]",
    "---",
    "Copy 3 Links [link]",
    "Copy 3 Links as Markdown [link] (alt)",
    "---",
    "Delete 2 Items [trash]",
  ]);
});

test("a selection's target counts the links inside folders and names what it deletes", () => {
  const b = {
    nodes: {
      f: { kind: "folder", id: "f", parentId: "bar", title: "F", children: ["x", "y"] },
      x: { kind: "url", id: "x", parentId: "f", title: "X", url: "https://x.com/" },
      y: { kind: "url", id: "y", parentId: "f", title: "Y", url: "https://y.com/" },
      z: { kind: "url", id: "z", parentId: "bar", title: "Z", url: "https://z.com/" },
    },
  };
  const s = { bookmarks: b, profiles: {}, profileOrder: [] };
  assert.deepEqual(rowMenuTarget(s, [b.nodes.f, b.nodes.z], false), { kind: "several", links: 3, items: 2, noun: "Items" });
  assert.deepEqual(rowMenuTarget(s, [b.nodes.x, b.nodes.z], false), { kind: "several", links: 2, items: 2, noun: "Bookmarks" });
  assert.deepEqual(rowMenuTarget(s, [b.nodes.z], true), { kind: "url", showPath: true });
});

test("a History row gets the same verbs plus Open in Split View; several selected rows act together and confirm the removal", () => {
  assert.deepEqual(render(historyRowMenuItems(1)), [...OPEN_ONE, "---", ...COPY_ONE, "More from This Site [magnifyingglass]", "---", "Remove from History [trash]"]);
  assert.deepEqual(render(historyRowMenuItems(4)), [
    "Open 4 in New Tabs [plus.app]",
    "Open 4 in New Window [macwindow.badge.plus]",
    "Open 4 in Incognito Window [eyeglasses]",
    "---",
    "Copy 4 Links [link]",
    "Copy 4 Links as Markdown [link] (alt)",
    "---",
    "Remove 4 Pages from History… [trash]",
  ]);
});
