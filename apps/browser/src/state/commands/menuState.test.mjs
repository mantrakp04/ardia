import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { menuInputsChanged, menuState, trackedMenuState } = await import("./menuState.ts");

const S = () => useBrowser.getState();
const menuJson = (s) => JSON.stringify(menuState(s));

test("a store change the last menu build didn't read leaves the menu as it was, and one it read is caught", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.example/" });
  const first = model.activeTabId(S(), w);
  const steps = [
    () => S().updateLive(first, { isLoading: true, progress: 0.3 }),
    () => S().updateLive(first, { progress: 0.6 }),
    () => S().updateTab(first, { title: "A page" }),
    () => S().newTab(w, { url: "https://b.example/" }),
    () => S().updateLive(first, { isLoading: false, canGoBack: true }),
    () => useBrowser.setState({ find: { ...S().find } }),
    () => useBrowser.setState({ history: { ...S().history } }),
    () => S().updateSettings({ warnBeforeQuitting: !S().settings.warnBeforeQuitting }),
    () => S().addBookmark({ profileId: "default", url: "https://b.example/", title: "B" }),
    () => S().createWindow({ url: "https://c.example/" }),
    () => S().closeTab(first),
  ];
  let unread = 0;
  let read = 0;
  for (const step of steps) {
    const before = S();
    const { state, reads } = trackedMenuState(before);
    step();
    const after = S();
    if (menuInputsChanged(reads, after, before)) read++;
    else {
      unread++;
      assert.equal(menuJson(after), JSON.stringify(state), `${step} changed the menu without touching a field it read`);
    }
  }
  assert.ok(unread >= 2, "some steps touch only fields the menu doesn't read");
  assert.ok(read >= 5, "steps that change the menu are caught");
});

test("the reads cover every top-level field the menu used, including through its helpers", () => {
  S().hydrate({});
  S().createWindow({ url: "https://a.example/" });
  const { reads } = trackedMenuState(S());
  for (const field of ["windows", "tabs", "live", "settings", "closedTabs", "closedWindows", "closedGroups", "bookmarks", "profiles", "profileOrder", "downloads", "ui"]) {
    assert.ok(reads.has(field), field);
  }
  assert.equal(reads.has("history"), false);
});
