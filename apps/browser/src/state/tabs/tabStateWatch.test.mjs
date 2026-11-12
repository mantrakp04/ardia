import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const { useBrowser } = await import("../browser/store.ts");
const { watchTabState } = await import("./tabStateWatch.ts");
const { rowFlags } = await import("../sidebar/rowState.ts");
const { activeTabId } = await import("../browser/model.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();

function session(plain) {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  const ids = [S().windows[w].tabIds[0]];
  for (let i = 0; i < plain; i++) ids.push(S().newTab(w, { url: `https://site${i % 7}.com/p/${i}`, background: true }));
  return { w, ids };
}

function watching(w) {
  const woken = new Set();
  const offs = new Map();
  const sync = () => {
    for (const id of Object.keys(S().tabs)) if (!offs.has(id)) offs.set(id, watchTabState(id, () => woken.add(id)));
  };
  sync();
  const values = () => Object.fromEntries(Object.keys(S().tabs).map((id) => [id, `${rowFlags(S(), w, id)}:${activeTabId(S(), w) === id}`]));
  return {
    run(what, act) {
      sync();
      const before = values();
      woken.clear();
      act();
      const after = values();
      for (const id of Object.keys(before)) {
        if (before[id] !== after[id]) assert.ok(woken.has(id), `${what}: tab ${id} changed (${before[id]} → ${after[id]}) without waking`);
      }
      return new Set(woken);
    },
    stop: () => offs.forEach((off) => off()),
  };
}

test("every action wakes each tab whose row state it changed", () => {
  const { w, ids } = session(14);
  const watch = watching(w);
  const [a, b, c, d, e, f, g] = ids;
  watch.run("switch", () => S().activate(b));
  watch.run("select", () => S().setSelection(w, [c, d]));
  watch.run("clear selection", () => S().setSelection(w, []));
  watch.run("loading", () => S().updateLive(c, { isLoading: true }));
  watch.run("audio", () => S().updateLive(d, { playingAudio: true }));
  watch.run("mute tab", () => S().updateTab(d, { muted: true }));
  watch.run("mute site", () => S().setSiteMuted(e, true));
  watch.run("fade unloaded", () => S().updateSettings({ fadeUnloadedTabs: true }));
  watch.run("load", () => S().activate(f));
  watch.run("engine", () => S().updateTab(g, { engine: "webkit" }));
  watch.run("child of a WebKit tab", () => S().newTab(w, { url: "https://child.com/", openerId: g, background: true }));
  watch.run("pin", () => S().pinTabs([a], true));
  watch.run("pinned tab loads", () => S().activate(a));
  watch.run("group", () => S().createGroup([e, f]));
  const pinnedGroup = S().createGroup([b, c]);
  watch.run("pin a group", () => S().updateGroup(pinnedGroup, { pinned: true }));
  watch.run("collapse a group", () => S().updateGroup(pinnedGroup, { collapsed: true }));
  watch.run("unpin a group", () => S().updateGroup(pinnedGroup, { pinned: false }));
  watch.run("split", () => S().createSplit([b, c]));
  watch.run("share tabs", () => S().updateSettings({ shareTabsAcrossWindows: true }));
  watch.run("second window", () => S().createWindow({ url: "https://z.com/" }));
  watch.run("close", () => S().closeTab(d));
  watch.run("close active", () => S().closeTab(S().windows[w].activeTabIds[S().windows[w].profileId]));
  watch.stop();
});

test("closing the tab a pending duplicate copies its engine from wakes the duplicate", () => {
  const { w, ids } = session(3);
  const [source, copy, other] = ids;
  S().updateSettings({ websiteEngines: { "https://a.com": "webkit" } });
  const adopted = (adopt) => ({ url: "https://a.com/", engine: undefined, page: { kind: "adopted", adopt, nav: null } });
  useBrowser.setState((s) => ({ tabs: { ...s.tabs, [source]: { ...s.tabs[source], ...adopted("ardiacore:123") }, [copy]: { ...s.tabs[copy], ...adopted(`clone:${source}`) } } }));
  S().activate(other);
  const watch = watching(w);
  const before = rowFlags(S(), w, copy);
  const woken = watch.run("close the source", () => S().closeTab(source));
  assert.notEqual(rowFlags(S(), w, copy), before);
  assert.ok(woken.has(copy));
  watch.stop();
});

test("a switch and a new tab wake the tabs they touch, not every tab", () => {
  for (const count of [10, 120]) {
    const { w, ids } = session(count);
    const watch = watching(w);
    const switched = watch.run("switch", () => S().activate(ids[count - 3]));
    assert.ok(switched.size <= 2, `a switch woke ${switched.size} of ${count + 1} tabs`);
    const back = watch.run("switch back", () => S().activate(ids[2]));
    assert.ok(back.size <= 2, `a switch woke ${back.size} of ${count + 1} tabs`);
    const opened = watch.run("new tab", () => S().newTab(w));
    assert.ok(opened.size <= 3, `a new tab woke ${opened.size} of ${count + 2} tabs`);
    watch.stop();
  }
});
