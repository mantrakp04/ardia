import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { toggleMute, toggleSiteMute } = await import("../browser/actions.ts");
const { isSilenced, muteState, sessionWithOwnTabMutes } = await import("./mute.ts");
const { tabMenuItems } = await import("../sidebar/tabMenu.ts");

const S = () => useBrowser.getState();
const state = (id) => muteState(S(), S().tabs[id]);
const silent = (id) => isSilenced(S(), S().tabs[id]);

const setup = () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://video.example/a" });
  const a = S().windows[w].tabIds[0];
  const b = S().newTab(w, { url: "https://video.example/b", background: true });
  return { w, a, b };
};

test("muting a tab leaves another tab on the same site playing", () => {
  const { a, b } = setup();
  toggleMute(a);
  assert.equal(state(a), "tab");
  assert.equal(state(b), null);
  assert.deepEqual(S().settings.mutedSites, []);
  toggleMute(a);
  assert.equal(state(a), null);
});

test("a tab's mute stays with it across navigation, to another site and back", () => {
  const { a } = setup();
  toggleMute(a);
  S().updateTab(a, { url: "https://other.example/", title: "" }, {});
  assert.equal(state(a), "tab");
  S().updateTab(a, { url: "https://video.example/c", title: "" }, {});
  assert.equal(state(a), "tab");
});

test("Mute Site silences every tab on the site, new ones included, and only there", () => {
  const { w, a, b } = setup();
  toggleSiteMute(a);
  assert.deepEqual(S().settings.mutedSites, ["video.example"]);
  assert.ok(silent(a) && silent(b));
  assert.equal(S().tabs[b].muted, false, "the site's mute isn't copied into the tab");
  const c = S().newTab(w, { url: "https://video.example/c", background: true });
  assert.equal(state(c), "site");
  S().updateTab(c, { url: "https://other.example/", title: "" }, {});
  assert.equal(state(c), null, "leaving the site leaves its mute behind");
  toggleSiteMute(a);
  assert.ok(!silent(a) && !silent(b));
});

test("unmuting a tab whose site is muted unmutes the site, so the tab plays", () => {
  const { a, b } = setup();
  toggleMute(b);
  toggleSiteMute(a);
  toggleMute(a);
  assert.deepEqual(S().settings.mutedSites, []);
  assert.equal(state(a), null);
  assert.equal(state(b), "tab", "another tab's own mute stays");
});

test("the tab menu: Mute Tab with Mute Site under ⌥, and one Unmute Site while the site is muted", () => {
  const { w, a } = setup();
  const mute = () =>
    tabMenuItems(S(), w, S().tabs[a])
      .filter((i) => i.id === "mute" || i.id === "muteSite")
      .map((i) => `${i.id} ${i.title}${i.alternate ? " (alt)" : ""}`);
  assert.deepEqual(mute(), ["mute Mute Tab", "muteSite Mute Site (alt)"]);
  toggleMute(a);
  assert.deepEqual(mute(), ["mute Unmute Tab", "muteSite Mute Site (alt)"]);
  toggleSiteMute(a);
  assert.deepEqual(mute(), ["mute Unmute Site"]);
});

test("a private window's site mutes stay in that window", () => {
  S().hydrate({});
  const w = S().createWindow({ kind: "private", url: "https://video.example/a" });
  const a = S().windows[w].tabIds[0];
  toggleSiteMute(a);
  assert.equal(state(a), "site");
  assert.deepEqual(S().settings.mutedSites, []);
});

test("a saved session's site-wide mutes stop being tab mutes, other tab mutes stay", () => {
  const doc = {
    settings: { mutedSites: ["video.example"] },
    tabs: [
      { id: "a", url: "https://video.example/a", profileId: "default", muted: true },
      { id: "b", url: "https://music.example/", profileId: "default", muted: true },
      { id: "c", url: "https://video.example/c", profileId: "default", muted: false },
    ],
  };
  const migrated = sessionWithOwnTabMutes({
    ...doc,
    closedTabs: [{ kind: "tab", tab: doc.tabs[0] }],
    closedWindows: [{ kind: "window", tabs: [doc.tabs[0], doc.tabs[1]] }],
    parkedPins: { default: { tabs: [doc.tabs[0]], groups: [] } },
  });
  assert.deepEqual(migrated.tabs.map((t) => t.muted), [false, true, false]);
  assert.equal(migrated.closedTabs[0].tab.muted, false, "a closed tab");
  assert.deepEqual(migrated.closedWindows[0].tabs.map((t) => t.muted), [false, true], "a closed window");
  assert.equal(migrated.parkedPins.default.tabs[0].muted, false, "a parked pin");
  assert.equal(sessionWithOwnTabMutes({ settings: {}, tabs: doc.tabs }).tabs, doc.tabs);
});
