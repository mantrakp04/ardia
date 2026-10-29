import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { setSidebarUi } = await import("../sidebar/sidebarUi.ts");
const { usePages } = await import("../tabs/pageState.ts");
const { useHistoryMenu } = await import("../tabs/navigation.ts");
const { useExtensions } = await import("../extensions/store.ts");
const { showMenu } = await import("../../platform/menus.ts");
const { holds, peekHeld } = await import("./transientUi.ts");
const { cardEntered, dismissHover } = await import("../sidebar/hover.ts");

const S = () => useBrowser.getState();

function twoWindows(settings = {}) {
  S().hydrate({});
  S().updateSettings(settings);
  const w = S().createWindow({ url: "a.com" });
  const other = S().createWindow({ url: "b.com" });
  return { w, other, tab: activeTabId(S(), w) };
}

const SURFACES = {
  menu: { open: () => void showMenu([]), close: async () => await new Promise((r) => setTimeout(r, 0)) },
  rename: { open: ({ w }) => setSidebarUi({ renaming: { kind: "tab", id: "x", windowId: w } }), close: () => setSidebarUi({ renaming: null }) },
  renameElsewhere: { open: ({ other }) => setSidebarUi({ renaming: { kind: "tab", id: "x", windowId: other } }), close: () => setSidebarUi({ renaming: null }) },
  iconPicker: { open: ({ w }) => setSidebarUi({ iconPicker: { kind: "tab", id: "x", windowId: w, anchor: null } }), close: () => setSidebarUi({ iconPicker: null }) },
  iconPickerElsewhere: { open: ({ other }) => setSidebarUi({ iconPicker: { kind: "tab", id: "x", windowId: other, anchor: null } }), close: () => setSidebarUi({ iconPicker: null }) },
  hoverCard: {
    open: ({ w }) => {
      setSidebarUi({ hover: { kind: "tab", id: "x", windowId: w, anchor: { x: 0, y: 0, width: 10, height: 10 } } });
      cardEntered();
    },
    close: () => dismissHover(),
  },
  downloads: { open: ({ w }) => S().setDownloadsOpen(w, true), close: ({ w }) => S().setDownloadsOpen(w, false) },
  popover: { open: ({ tab }) => usePages.setState({ popover: { [tab]: "zoom" } }), close: () => usePages.setState({ popover: {} }) },
  panel: { open: ({ w }) => S().openPanel(w, ""), close: ({ w }) => S().closePanel(w) },
  find: { open: ({ tab }) => S().setFind(tab, { open: true }), close: ({ tab }) => S().setFind(tab, { open: false }) },
  historyMenu: { open: ({ tab }) => useHistoryMenu.setState({ menu: { tabId: tab } }), close: () => useHistoryMenu.setState({ menu: null }) },
  extensionPopup: { open: ({ w }) => useExtensions.setState({ popup: { windowId: w } }), close: () => useExtensions.setState({ popup: null }) },
};

async function heldWhileOpen(held, settings) {
  const out = {};
  for (const [name, surface] of Object.entries(SURFACES)) {
    const where = twoWindows(settings);
    assert.equal(held(where), false, `${name}: nothing open`);
    surface.open(where);
    out[name] = held(where);
    await surface.close(where);
    assert.equal(held(where), false, `${name}: closed again`);
  }
  return out;
}

test("the floating sidebar stays out for menus, rename, the icon picker, downloads and the sidebar field's popover", async () => {
  assert.deepEqual(await heldWhileOpen(({ w }) => peekHeld(w)), {
    menu: true, rename: true, renameElsewhere: false, iconPicker: true, iconPickerElsewhere: false, hoverCard: true, downloads: true,
    popover: false, panel: false, find: false, historyMenu: false, extensionPopup: false,
  });
});

test("a page popover or the history menu holds the floating sidebar only when it hangs off the sidebar's address field", async () => {
  const held = await heldWhileOpen(({ w }) => peekHeld(w), { addressBar: "sidebar" });
  assert.equal(held.popover, true);
  assert.equal(held.historyMenu, true);
});

test("the auto-hidden toolbar stays shown for the command panel, Find, a page popover, the history menu and an extension popup", async () => {
  assert.deepEqual(await heldWhileOpen(({ w, tab }) => holds("toolbar", w, tab)), {
    menu: false, rename: false, renameElsewhere: false, iconPicker: false, iconPickerElsewhere: false, hoverCard: false, downloads: false,
    popover: true, panel: true, find: true, historyMenu: true, extensionPopup: true,
  });
});

test("no hover card shows over the command panel, or while a row is renamed or the icon picker is open in any window", async () => {
  assert.deepEqual(await heldWhileOpen(({ w }) => holds("hoverCard", w)), {
    menu: false, rename: true, renameElsewhere: true, iconPicker: true, iconPickerElsewhere: true, hoverCard: false, downloads: false,
    popover: false, panel: true, find: false, historyMenu: false, extensionPopup: false,
  });
  assert.deepEqual(await heldWhileOpen(({ w }) => holds("hoverStart", w)), {
    menu: false, rename: false, renameElsewhere: false, iconPicker: false, iconPickerElsewhere: false, hoverCard: false, downloads: false,
    popover: false, panel: true, find: false, historyMenu: false, extensionPopup: false,
  });
});
