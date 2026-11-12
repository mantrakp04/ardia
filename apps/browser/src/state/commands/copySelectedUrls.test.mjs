import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { runCommand } = await import("./commands.ts");
const { menuState } = await import("./menuState.ts");
const { useToasts } = await import("../app/toasts.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");
const { showNewTabBar } = await import("../omnibox/newTabBar.ts");
const { runBarAction } = await import("../omnibox/runBar.ts");
const { openMultiMenu } = await import("../sidebar/multiTabMenu.ts");
const { barActions } = await import("../omnibox/barActions.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const toast = (w) => useToasts.getState().toasts[w]?.title;
const copyKey = (w, markdown = false) => () => runCommand({ command: markdown ? "copyUrlAsMarkdown" : "copyUrl", arg: null, windowId: w });

function windowWith(...hosts) {
  S().hydrate({});
  const w = S().createWindow({ url: `https://${hosts[0]}.com/` });
  S().setFocusedWindow(w);
  const ids = [S().windows[w].tabIds[0]];
  for (const h of hosts.slice(1)) ids.push(S().newTab(w, { url: `https://${h}.com/` }));
  return { w, ids };
}

async function copied(run) {
  const shell = shellNativeModules.ArdiaShell;
  const real = shell.copyText;
  const texts = [];
  shell.copyText = (text) => void texts.push(text);
  try {
    await run();
  } finally {
    shell.copyText = real;
  }
  return texts;
}

test("⇧⌘C copies every tab in a sidebar multi-selection, one URL per line", async () => {
  const { w, ids: [, b, c, d] } = windowWith("a", "b", "c", "d");
  S().activate(b);
  S().setSelection(w, [b, c, d]);
  assert.deepEqual(await copied(copyKey(w)), ["https://b.com/\nhttps://c.com/\nhttps://d.com/"]);
  assert.equal(toast(w), "Copied URLs");
  assert.deepEqual(S().selection[w], [b, c, d]);
});

test("⌥⇧⌘C copies a multi-selection as a Markdown list", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().setSelection(w, [a, b]);
  const [text] = await copied(copyKey(w, true));
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- \[.*\]\(https:\/\/a\.com\/\)$/);
  assert.match(lines[1], /^- \[.*\]\(https:\/\/b\.com\/\)$/);
  assert.equal(toast(w), "Copied URLs as Markdown");
});

test("the Edit menu keeps Copy URL with a selection, as Dia does", () => {
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().setSelection(w, [a, b, c]);
  assert.equal(menuState(S()).titles.copyUrl, undefined);
  assert.equal(menuState(S()).titles.copyUrlAsMarkdown, undefined);
});

test("⇧⌘C still copies only the active tab when nothing is multi-selected", async () => {
  const { w, ids: [, b] } = windowWith("a", "b");
  S().activate(b);
  S().setSelection(w, []);
  assert.deepEqual(await copied(copyKey(w)), ["https://b.com/"]);
});

test("with a peek open, ⇧⌘C copies the peeked page, not the selection", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().setSelection(w, [a, b]);
  assert.ok(S().openPeek(a, "https://peek.example/page"));
  const texts = await copied(copyKey(w));
  assert.equal(texts.length, 1);
  assert.doesNotMatch(texts[0], /a\.com|b\.com/);
});

test("⇧⌘C copies the selection with the command bar open, as the bar's own row does", async () => {
  const { w, ids: [, b, c] } = windowWith("a", "b", "c");
  S().activate(c);
  S().setSelection(w, [b, c]);
  S().openPanel(w, "https://search.example/");
  assert.deepEqual(await copied(copyKey(w)), ["https://b.com/\nhttps://c.com/"]);
  assert.equal(menuState(S()).titles.closeTab, undefined, "⌘W still only dismisses the bar");
});

test("⇧⌘C copies the selection with the New Tab bar open", async () => {
  const { w, ids: [, b, c] } = windowWith("a", "b", "c");
  S().activate(c);
  S().setSelection(w, [b, c]);
  S().updateSettings({ newTabOpens: "commandBar" });
  try {
    assert.ok(showNewTabBar(w));
    assert.deepEqual(await copied(copyKey(w)), ["https://b.com/\nhttps://c.com/"]);
  } finally {
    S().updateSettings({ newTabOpens: "page" });
  }
});

test("the command bar's Copy URL row copies the selection, as the key and the Edit menu do", async () => {
  const { w, ids: [, b, c] } = windowWith("a", "b", "c");
  S().activate(c);
  S().setSelection(w, [b, c]);
  assert.deepEqual(await copied(() => runBarAction("copyUrl", w)), ["https://b.com/\nhttps://c.com/"]);
});

test("tabs without a page are left out of the copy", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b");
  const empty = S().newTab(w);
  S().setSelection(w, [a, b, empty]);
  assert.deepEqual(await copied(copyKey(w)), ["https://a.com/\nhttps://b.com/"]);
  assert.equal(toast(w), "Copied URLs");
  S().setSelection(w, [a, empty]);
  S().activate(empty);
  assert.deepEqual(await copied(copyKey(w)), ["https://a.com/"]);
});

test("a split in the selection copies its panes left to right, as Dia does, flipped or grouped", async () => {
  for (const grouped of [false, true]) {
    const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
    const split = S().createSplit([b, c]);
    if (grouped) S().groupTabs([a, b, c], { pinned: true });
    S().setSelection(w, [a, b, c]);
    assert.deepEqual(await copied(copyKey(w)), ["https://a.com/\nhttps://b.com/\nhttps://c.com/"]);
    S().flipSplit(split);
    S().setSelection(w, [a, b, c]);
    assert.deepEqual(await copied(copyKey(w)), ["https://a.com/\nhttps://c.com/\nhttps://b.com/"], `grouped: ${grouped}`);
  }
});

test("a split selected on its own copies only its focused pane, as Dia does", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b", "c");
  S().createSplit([a, b]);
  S().activate(b);
  S().setSelection(w, [a, b]);
  assert.deepEqual(await copied(copyKey(w)), ["https://b.com/"]);
});

test("with a blank tab active, the menu and the command bar still offer to copy the selection", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b");
  S().activate(S().newTab(w));
  S().setSelection(w, [a, b]);
  const { disabled } = menuState(S());
  assert.ok(!disabled.includes("copyUrl") && !disabled.includes("copyUrlAsMarkdown"), disabled.join());
  const rows = barActions(S(), w).map((r) => r.id);
  assert.ok(rows.includes("copyUrl") && rows.includes("copyUrlAsMarkdown"), rows.join());
  assert.deepEqual(await copied(copyKey(w)), ["https://a.com/\nhttps://b.com/"]);
  S().setSelection(w, []);
  assert.ok(menuState(S()).disabled.includes("copyUrl"));
  assert.ok(!barActions(S(), w).some((r) => r.id === "copyUrl"));
});

test("Top Apps tiles that share a split still copy as separate items", async () => {
  const { w, ids: [a, b] } = windowWith("a", "b", "c");
  S().pinTabs([a, b], true);
  S().createSplit([a, b]);
  S().setSelection(w, [a, b]);
  assert.deepEqual(await copied(copyKey(w)), ["https://a.com/\nhttps://b.com/"]);
});

test("the several-tab menu's Copy Links shows the same toast as ⇧⌘C, as Dia's does", async () => {
  const { w, ids: [, b, c] } = windowWith("a", "b", "c");
  const menus = shellNativeModules.ArdiaMenus;
  const real = menus.showMenu;
  try {
    for (const [choice, title] of [["copy", "Copied URLs"], ["copyMd", "Copied URLs as Markdown"]]) {
      useToasts.setState({ toasts: {} });
      menus.showMenu = () => Promise.resolve(choice);
      assert.equal((await copied(() => openMultiMenu(w, [b, c]))).length, 1);
      assert.equal(toast(w), title);
    }
  } finally {
    menus.showMenu = real;
  }
});

test("a copy aimed at one tab ignores the selection", async () => {
  const { w, ids: [a, b, c] } = windowWith("a", "b", "c");
  S().setSelection(w, [a, b, c]);
  assert.deepEqual(await copied(() => runCommand({ command: "copyUrl", arg: null, windowId: w }, { tabId: c })), ["https://c.com/"]);
});
