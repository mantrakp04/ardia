import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { activeTabId } = await import("../browser/model.ts");
const { setSidebarUi } = await import("../sidebar/sidebarUi.ts");
const { usePages } = await import("../tabs/pageState.ts");
const { useHistoryMenu } = await import("../tabs/navigation.ts");
const { useExtensions } = await import("../extensions/store.ts");
const { showMenu } = await import("../../platform/menus.ts");
const { hoverHeld, peekHeld, toolbarHeld } = await import("./transientUi.ts");
const { setPeekShown } = await import("../windows/dockMotion.ts");
const { setToolbarPeek } = await import("../windows/toolbarAutoHide.ts");
const { cardEntered, dismissHover } = await import("../sidebar/hover.ts");

const S = () => useBrowser.getState();

function twoWindows(settings = {}) {
  S().hydrate({});
  S().updateSettings(settings);
  const w = S().createWindow({ url: "a.com" });
  const other = S().createWindow({ url: "b.com" });
  return { w, other, tab: activeTabId(S(), w) };
}

const focus = (win) => useBrowser.setState((s) => ({ ui: { ...s.ui, focusOrder: [win, ...s.ui.focusOrder.filter((id) => id !== win)] } }));
const menuClosed = () => new Promise((r) => setTimeout(r, 0));

const SURFACES = {
  menuFromSidebar: {
    open: ({ w }) => {
      focus(w);
      setPeekShown(w, true, 245);
      void showMenu([]);
    },
    close: async ({ w }) => {
      await menuClosed();
      setPeekShown(w, false);
    },
  },
  menuFromToolbar: {
    open: ({ w, tab }) => {
      focus(w);
      setToolbarPeek(tab, true);
      void showMenu([]);
    },
    close: async ({ tab }) => {
      await menuClosed();
      setToolbarPeek(tab, false);
    },
  },
  menuFromPage: { open: ({ w }) => (focus(w), void showMenu([])), close: menuClosed },
  menuElsewhere: { open: ({ other }) => (focus(other), void showMenu([])), close: menuClosed },
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

test("the floating sidebar stays out for what's anchored in it: its menus, rename, the icon picker, the hover card, Downloads and the sidebar field's popover", async () => {
  assert.deepEqual(await heldWhileOpen(({ w }) => peekHeld(w)), {
    menuFromSidebar: true, menuFromToolbar: false, menuFromPage: false, menuElsewhere: false,
    rename: true, renameElsewhere: false, iconPicker: true, iconPickerElsewhere: false, hoverCard: true, downloads: true,
    popover: false, panel: false, find: false, historyMenu: false, extensionPopup: false,
  });
});

test("a page popover holds the floating sidebar only when it hangs off the sidebar's address field", async () => {
  assert.equal((await heldWhileOpen(({ w }) => peekHeld(w), { addressBar: "sidebar" })).popover, true);
});

test("the auto-hidden toolbar stays shown for what's anchored in it: its menus, the command panel, Find, a page popover, the history menu and an extension popup", async () => {
  assert.deepEqual(await heldWhileOpen(({ w, tab }) => toolbarHeld(w, tab)), {
    menuFromSidebar: false, menuFromToolbar: true, menuFromPage: false, menuElsewhere: false,
    rename: false, renameElsewhere: false, iconPicker: false, iconPickerElsewhere: false, hoverCard: false, downloads: false,
    popover: true, panel: true, find: true, historyMenu: true, extensionPopup: true,
  });
});

test("no hover card starts in a window while anything is open in it, and something open in another window doesn't stop it", async () => {
  assert.deepEqual(await heldWhileOpen(({ w }) => hoverHeld(w)), {
    menuFromSidebar: true, menuFromToolbar: true, menuFromPage: true, menuElsewhere: false,
    rename: true, renameElsewhere: false, iconPicker: true, iconPickerElsewhere: false, hoverCard: false, downloads: true,
    popover: true, panel: true, find: true, historyMenu: true, extensionPopup: true,
  });
});
