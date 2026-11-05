import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

class FakeChrome {
  rev = 0;
  strips = new Map();
  outbox = [];
  commands = [];
  sent = 0;
  lastGroup = 0;
  nextBrowser = 1;
  listen(listener) {
    this.listener = listener;
    return { remove() {} };
  }
  snapshot() {
    return Promise.resolve({ rev: this.rev, cmd: null, strips: [...this.strips.keys()].map((id) => this.state(id)) });
  }
  command(command, id) {
    this.sent++;
    this.commands.push({ id, command });
  }
  state(id) {
    const s = this.strips.get(id);
    return {
      strip: id,
      window: id,
      ...(s.appWindow ? { appWindow: s.appWindow } : {}),
      activePickedOnClose: !!s.pickedOnClose,
      profile: "",
      tabs: s.tabs.map((t, index) => ({ key: t.key, browser: t.browser, index, active: t.browser === s.active, pinned: t.pinned, group: t.group ?? null })),
      groups: [...s.groups].filter(([id]) => s.tabs.some((t) => t.group === id)).map(([id, g]) => ({ id, ...g })),
    };
  }
  emit(id, cmd, ...more) {
    this.outbox.push({ rev: ++this.rev, cmd, strips: [id, ...more].map((x) => this.state(x)) });
  }
  strip(id) {
    if (!this.strips.has(id)) this.strips.set(id, { tabs: [], active: 0, groups: new Map() });
    return this.strips.get(id);
  }
  find(key) {
    for (const [id, s] of this.strips) {
      const i = s.tabs.findIndex((t) => t.key === key);
      if (i >= 0) return { id, s, i, tab: s.tabs[i] };
    }
    return null;
  }
  create(stripId, key) {
    const s = this.strip(stripId);
    const browser = this.nextBrowser++;
    s.tabs.push({ key, browser, pinned: false });
    if (!s.active) s.active = browser;
    this.emit(stripId, -1);
  }
  made(stripId, active) {
    const s = this.strip(stripId);
    const browser = this.nextBrowser++;
    s.tabs.push({ key: null, browser, pinned: false });
    if (active) {
      s.active = browser;
      s.pickedOnClose = false;
    }
    this.emit(stripId, null);
    return browser;
  }
  adopted(browser, key) {
    for (const [id, s] of this.strips) {
      const t = s.tabs.find((t) => t.browser === browser);
      if (t) (t.key = key), this.emit(id, null);
    }
  }
  parked(key) {
    const f = this.find(key);
    f.tab.key = null;
    this.emit(f.id, null);
  }
  remove(key) {
    const f = this.find(key);
    if (!f) return;
    this.drop(f);
    this.emit(f.id, null);
  }
  drop(f) {
    f.s.tabs.splice(f.i, 1);
    if (f.s.active === f.tab.browser) {
      f.s.active = (f.s.tabs[f.i] ?? f.s.tabs[f.i - 1])?.browser ?? 0;
      f.s.pickedOnClose = true;
    }
  }
  removeAndActivate(key, other) {
    const f = this.find(key);
    this.drop(f);
    f.s.active = this.find(other).tab.browser;
    f.s.pickedOnClose = false;
    this.emit(f.id, null);
  }
  moveTo(key, stripId) {
    const f = this.find(key);
    this.drop(f);
    const to = this.strip(stripId);
    to.tabs.push(f.tab);
    to.active = f.tab.browser;
    to.pickedOnClose = false;
    this.emit(f.id, null, stripId);
  }
  move(key, index) {
    const f = this.find(key);
    f.s.tabs.splice(f.i, 1);
    f.s.tabs.splice(index, 0, f.tab);
    const [prev, next] = [f.s.tabs[index - 1]?.group, f.s.tabs[index + 1]?.group];
    f.tab.group = prev && prev === next ? prev : f.tab.group && [prev, next].includes(f.tab.group) ? f.tab.group : null;
    this.emit(f.id, null);
  }
  reorder(stripId, keys) {
    const s = this.strips.get(stripId);
    s.tabs.sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));
    this.emit(stripId, null);
  }
  group(keys, title, color = "blue") {
    const f = this.find(keys[0]);
    const id = `g${++this.lastGroup}`;
    f.s.groups.set(id, { title, color, collapsed: false });
    this.regroup(f.s, keys, id);
    this.emit(f.id, null);
    return id;
  }
  regroup(s, keys, id) {
    const moving = s.tabs.filter((t) => keys.includes(t.key) && !t.pinned);
    const at = s.tabs.indexOf(moving[0]);
    for (const t of moving) t.group = id;
    s.tabs = s.tabs.filter((t) => !moving.includes(t));
    s.tabs.splice(Math.min(at, s.tabs.length), 0, ...moving);
  }
  collapse(id, collapsed) {
    for (const [sid, s] of this.strips) if (s.groups.has(id)) { s.groups.get(id).collapsed = collapsed; this.emit(sid, null); }
  }
  retitle(id, title) {
    for (const [sid, s] of this.strips) if (s.groups.has(id)) { s.groups.get(id).title = title; this.emit(sid, null); }
  }
  pin(key, pinned) {
    const f = this.find(key);
    f.tab.pinned = pinned;
    f.s.tabs.splice(f.i, 1);
    const at = pinned ? f.s.tabs.filter((t) => t.pinned).length : f.s.tabs.length;
    f.s.tabs.splice(at, 0, f.tab);
    this.emit(f.id, null);
  }
  activate(key, cmd = null) {
    const f = this.find(key);
    f.s.active = f.tab.browser;
    f.s.pickedOnClose = false;
    this.emit(f.id, cmd);
  }
  runOne() {
    const next = this.commands.shift();
    if (!next) return false;
    const { id, command } = next;
    const s = this.strips.get(command.strip);
    const has = (key) => s?.tabs.some((t) => t.key === key);
    if (command.op === "activate" && has(command.key)) {
      s.active = s.tabs.find((t) => t.key === command.key).browser;
      s.pickedOnClose = false;
      this.emit(command.strip, id);
    } else if (command.op === "group" && command.keys.some(has)) {
      const keys = command.keys.filter(has);
      let token = command.group;
      if (token === "new") s.groups.set((token = `g${++this.lastGroup}`), { title: command.title ?? "", color: command.color ?? "grey", collapsed: false });
      if (token) {
        if (command.title !== undefined) Object.assign(s.groups.get(token), { title: command.title, color: command.color });
        if (command.collapsed !== undefined) s.groups.get(token).collapsed = command.collapsed;
        this.regroup(s, keys, token);
      } else
        for (const t of s.tabs.filter((t) => keys.includes(t.key) && t.group)) {
          const rest = s.tabs.filter((x) => x !== t);
          const last = rest.findLastIndex((x) => x.group === t.group);
          t.group = null;
          if (last >= 0) (s.tabs = rest).splice(last + 1, 0, t);
        }
      this.emit(command.strip, null);
      this.emit(command.strip, id);
    } else if (command.op === "arrange" && command.keys.some(has)) {
      const listed = command.keys.filter(has).map((key) => s.tabs.find((t) => t.key === key));
      listed.forEach((t, i) => {
        t.pinned = i < command.pinned;
        const from = s.tabs.indexOf(t);
        if (from === i) return;
        const [left, right] = (i > from ? [s.tabs[i], s.tabs[i + 1]] : [s.tabs[i - 1], s.tabs[i]]).map((x) => x?.group ?? null);
        let group = t.group ?? null;
        if (group !== left && group !== right) {
          if (left && left === right) group = left;
          else if (group && s.tabs.filter((x) => x.group === group).length > 1) group = null;
        }
        s.tabs.splice(from, 1);
        s.tabs.splice(i, 0, t);
        t.group = group;
      });
      this.emit(command.strip, id);
    } else {
      this.outbox.push({ rev: ++this.rev, cmd: id, strips: [], rejected: true });
    }
    return true;
  }
  deliver() {
    const out = this.outbox;
    this.outbox = [];
    for (const tx of out) this.listener(tx);
    return out.length;
  }
}

const chrome = new FakeChrome();
globalThis.acTestTabStrip = chrome;
const { useBrowser } = await import("../browser/store.ts");
const model = await import("../browser/model.ts");
const { startChromeTabs } = await import("./chromeTabs.ts");
const { splitTabIdsOf } = await import("../splits/splits.ts");
startChromeTabs();

const S = () => useBrowser.getState();
const tick = () => new Promise((r) => setImmediate(r));
const urlOf = (id) => S().tabs[id].url.replace(/^https:\/\/|\.com\/?$/g, "");
const shown = (w) => urlOf(model.activeTabId(S(), w));
const shownIn = (w) => urlOf(S().windows[w].activeTabIds[S().windows[w].profileId]);
const order = (w) => S().windows[w].tabIds.map(urlOf);
const chromeOrder = (strip) => chrome.strips.get(strip).tabs.map((t) => urlOf(t.key));
const chromeGroupOf = (strip, url) => chrome.strips.get(strip).tabs.find((t) => urlOf(t.key) === url)?.group ?? null;
const chromeShown = (strip) => urlOf(chrome.strips.get(strip).tabs.find((t) => t.browser === chrome.strips.get(strip).active).key);

let nextStrip = 1;
function windowWith(...urls) {
  S().hydrate({});
  S().updateSettings({ cmdClickCreatesTabGroup: false, newTabPosition: "bottom" });
  return anotherWindow(...urls);
}
function anotherWindow(...urls) {
  const w = S().createWindow({ url: urls[0] ? `${urls[0]}.com` : undefined });
  for (const u of urls.slice(1)) S().newTab(w, { url: `${u}.com`, background: true });
  const strip = nextStrip++;
  chrome.strip(strip).appWindow = w;
  return { w, strip };
}
function mountViews({ w, strip }) {
  for (const id of S().windows[w]?.tabIds ?? []) {
    const t = S().tabs[id];
    if ((t.page.nav || t.page.adopt) && !chrome.find(id)) chrome.create(strip, id);
  }
  for (const s of chrome.strips.values()) for (const t of [...s.tabs]) if (!S().tabs[t.key]) chrome.remove(t.key);
}
async function settle(win) {
  let crossed = 0;
  for (let i = 0; i < 200; i++) {
    await tick();
    if (win) mountViews(win);
    const delivered = chrome.deliver();
    crossed += delivered;
    await tick();
    const ran = chrome.runOne();
    if (!delivered && !ran && !chrome.outbox.length && !chrome.commands.length) return crossed;
  }
  throw new Error("never settled: commands and transactions kept coming");
}

await settle();

test("the app's own switches never come back as switches, however late Chrome reports them", async () => {
  const win = windowWith("a");
  await settle(win);
  let switches = 0;
  const stop = useBrowser.subscribe((s, prev) => {
    const a = s.windows[win.w]?.activeTabIds[s.windows[win.w].profileId];
    const b = prev.windows[win.w]?.activeTabIds[prev.windows[win.w].profileId];
    if (a !== b) switches++;
  });
  for (let i = 0; i < 20; i++) {
    S().newTab(win.w, { url: `t${i}.com` });
    mountViews(win);
    chrome.deliver();
    await tick();
    if (i % 4 === 3) chrome.runOne();
  }
  const crossed = await settle(win);
  stop();
  assert.equal(switches, 20, "one switch per tab opened, none back");
  assert.equal(shown(win.w), "t19");
  assert.equal(chromeShown(win.strip), "t19", "Chrome shows what the app shows");
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.ok(crossed < 80, `bounded traffic (${crossed} transactions)`);
});

test("an extension's move, pin and activation reach the sidebar", async () => {
  const win = windowWith("a", "b", "c", "d");
  await settle(win);
  const [a, , c, d] = S().windows[win.w].tabIds;
  chrome.move(d, 0);
  await settle(win);
  assert.deepEqual(order(win.w), ["d", "a", "b", "c"]);
  chrome.pin(c, true);
  await settle(win);
  assert.equal(!!S().tabs[c].pin, true);
  assert.deepEqual(order(win.w), ["c", "d", "a", "b"]);
  chrome.activate(d);
  await settle(win);
  assert.equal(shown(win.w), "d");
  assert.deepEqual(chromeOrder(win.strip), order(win.w), "Chrome and the sidebar agree");
  assert.equal(!!S().tabs[a].pin, false);
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const g = S().groupTabs([id("a"), id("b")], { pinned: false });
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "d", "a", "b"]);
  chrome.move(d, 2);
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "a", "d", "b"]);
  assert.deepEqual(S().groups[g].tabIds.map(urlOf), ["a", "d", "b"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  chrome.reorder(win.strip, ["c", "b", "d", "a"].map(id));
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "b", "d", "a"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
});

test("the tab Chrome shows after a close doesn't override the app's successor rule", async () => {
  const win = windowWith("a", "b");
  const [a] = S().windows[win.w].tabIds;
  const c = S().newTab(win.w, { url: "c.com", openerId: a, background: true });
  await settle(win);
  assert.deepEqual(order(win.w), ["a", "c", "b"]);
  S().activate(c);
  await settle(win);
  S().closeTab(c);
  await settle(win);
  assert.equal(shown(win.w), "a", "the store's pick stands");
  assert.equal(chromeShown(win.strip), "a", "and Chrome shows it too");
});

test("a command on its way wins over Chrome's earlier change; stale transactions are dropped", async () => {
  const win = windowWith("a", "b", "c");
  await settle(win);
  const [a, b, c] = S().windows[win.w].tabIds;
  S().activate(c);
  await settle(win);
  S().activate(b);
  await tick();
  chrome.activate(a);
  await settle(win);
  assert.equal(shown(win.w), "b");
  assert.equal(chromeShown(win.strip), "b");
  const before = S().windows[win.w];
  chrome.listener({ rev: chrome.rev - 1, cmd: null, strips: [{ ...chrome.state(win.strip), tabs: [] }] });
  assert.equal(S().windows[win.w], before);
});

test("an extension's tab groups reach the sidebar, and the sidebar's groups reach Chrome", async () => {
  const win = windowWith("a", "b", "c", "d");
  await settle(win);
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const ext = chrome.group([id("b"), id("c")], "Reading");
  await settle(win);
  const made = Object.values(S().groups).find((g) => g.windowId === win.w);
  assert.ok(made, "the store made the group");
  assert.deepEqual(made.tabIds.map(urlOf), ["b", "c"]);
  assert.equal(made.name, "Reading");
  assert.equal(made.color, "blue");
  chrome.retitle(ext, "Later");
  await settle(win);
  assert.equal(S().groups[made.id].name, "Later");
  const mine = S().groupTabs([id("d"), id("a")], { pinned: false, name: "Mine" });
  await settle(win);
  const strip = chrome.strips.get(win.strip);
  const tokens = new Set(strip.tabs.filter((t) => [id("a"), id("d")].includes(t.key)).map((t) => t.group));
  assert.equal(tokens.size, 1);
  const token = [...tokens][0];
  assert.ok(token && token !== ext);
  assert.equal(strip.groups.get(token).title, "Mine");
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.ok(S().groups[mine]);
  const before = order(win.w);
  const groupKeys = S().groups[made.id].tabIds;
  chrome.reorder(win.strip, [...groupKeys, ...S().windows[win.w].tabIds.filter((t) => !groupKeys.includes(t))]);
  await settle(win);
  assert.notDeepEqual(order(win.w), before);
  assert.deepEqual(S().groups[made.id].tabIds, groupKeys);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  S().updateGroup(mine, { name: "Renamed" });
  await settle(win);
  assert.equal(chrome.strips.get(win.strip).groups.get(token).title, "Renamed");
  S().updateGroup(mine, { color: "none" });
  await settle(win);
  assert.equal(chrome.strips.get(win.strip).groups.get(token).color, "grey");
  assert.equal(S().groups[mine].color, "none");
  chrome.retitle(token, "From Chrome");
  await settle(win);
  assert.equal(S().groups[mine].name, "From Chrome");
  assert.equal(S().groups[mine].color, "none");
  S().updateGroup(mine, { color: "magenta" });
  await settle(win);
  assert.equal(chrome.strips.get(win.strip).groups.get(token).color, "grey");
  assert.equal(S().groups[mine].color, "magenta");
});

test("an extension that closes the shown tab and shows another in one go is obeyed", async () => {
  const win = windowWith("a", "b");
  const [a, b] = S().windows[win.w].tabIds;
  const c = S().newTab(win.w, { url: "c.com", openerId: a, background: true });
  await settle(win);
  S().activate(c);
  await settle(win);
  chrome.removeAndActivate(c, b);
  S().closeTab(c);
  await settle(win);
  assert.equal(shown(win.w), "b", "the extension's tab, not the opener rule's");
  assert.equal(chromeShown(win.strip), "b");
  assert.ok(S().tabs[a]);
});

test("an extension moving a tab into a window of New Tab pages, or into a one-tab window, moves it there", async () => {
  const one = windowWith("a", "b");
  await settle(one);
  const empty = anotherWindow();
  await settle(one);
  const [, b] = S().windows[one.w].tabIds;
  chrome.moveTo(b, empty.strip);
  await settle(one);
  assert.equal(S().tabs[b].windowId, empty.w, "the window the engine named");
  assert.equal(shownIn(empty.w), "b");
  const lone = anotherWindow("c");
  await settle(lone);
  const [a] = S().windows[one.w].tabIds;
  chrome.moveTo(a, lone.strip);
  await settle(lone);
  assert.equal(S().tabs[a].windowId, lone.w);
  assert.deepEqual(S().windows[lone.w].tabIds.map(urlOf), ["c", "a"]);
});

test("as in Dia: an extension pinning one pane of a split leaves the split; collapsing goes both ways", async () => {
  const win = windowWith("a", "b", "c");
  const [a, b, c] = S().windows[win.w].tabIds;
  S().createSplit([a, b]);
  await settle(win);
  chrome.pin(b, true);
  await settle(win);
  assert.equal(!!S().tabs[b].pin, false, "the pane isn't pinned");
  assert.ok(Object.values(S().splits).some((v) => splitTabIdsOf(v).includes(a) && splitTabIdsOf(v).includes(b)), "the split stays");
  assert.equal(chrome.find(b).tab.pinned, false, "Chrome is put back");
  S().activate(c);
  const g = S().groupTabs([c], { pinned: false, name: "C" });
  await settle(win);
  S().updateGroup(g, { collapsed: true });
  await settle(win);
  const token = chrome.find(c).tab.group;
  assert.equal(chrome.find(c).s.groups.get(token).collapsed, true);
  assert.equal(chromeShown(win.strip), "c");
  chrome.collapse(token, false);
  await settle(win);
  assert.equal(S().groups[g].collapsed, false);
  assert.equal(shown(win.w), "c");
});

test("an extension's new tab is shown when Chrome made it in front, and stays behind when Chrome made it behind", async () => {
  const win = windowWith("a");
  await settle(win);
  const [a] = S().windows[win.w].tabIds;
  for (const [active, url, expected] of [[true, "e", "e"], [false, "f", "e"]]) {
    const browser = chrome.made(win.strip, active);
    await settle();
    const id = S().newTab(win.w, { url: `${url}.com`, adoptId: `tab:${browser}`, openerId: a });
    await settle();
    chrome.adopted(browser, id);
    await settle(win);
    assert.equal(shown(win.w), expected, `tabs.create({ active: ${active} })`);
    assert.equal(chromeShown(win.strip), expected, "Chrome shows what the app shows");
    assert.deepEqual(chromeOrder(win.strip), order(win.w));
  }
});

test("a switch while Chrome's new tab waits for the app wins; a parked tab Chrome still shows doesn't hold the strip", async () => {
  const win = windowWith("a", "b");
  await settle(win);
  const [a, b] = S().windows[win.w].tabIds;
  const browser = chrome.made(win.strip, true);
  await settle();
  const id = S().newTab(win.w, { url: "g.com", adoptId: `tab:${browser}`, openerId: a });
  await settle();
  S().activate(b);
  await settle();
  assert.equal(chromeShown(win.strip), "b", "the switch reaches Chrome before the adoption");
  chrome.adopted(browser, id);
  await settle(win);
  assert.equal(shown(win.w), "b");
  assert.equal(chromeShown(win.strip), "b");
  chrome.parked(b);
  await settle();
  S().activate(a);
  await settle();
  assert.equal(chromeShown(win.strip), "a");
});

test("a tab dropped onto a tab groups the two; a member dragged out leaves only its group, in Chrome too", async () => {
  const win = windowWith("a", "b", "c", "d", "e");
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  for (const u of ["a", "b", "c", "d", "e"]) S().activate(id(u));
  await settle(win);
  const chromeGroups = () => {
    const strip = chrome.strips.get(win.strip);
    const out = {};
    for (const t of strip.tabs) if (t.group) (out[t.group] ??= []).push(urlOf(t.key));
    return Object.values(out).sort();
  };
  const groups = () => Object.values(S().groups).map((g) => g.tabIds.map(urlOf)).sort();
  const g = S().groupOnto([id("a")], id("d"));
  await settle(win);
  assert.deepEqual(order(win.w), ["b", "c", "d", "a", "e"]);
  assert.deepEqual(groups(), [["d", "a"]]);
  assert.equal(S().groups[g].pinned, false);
  assert.deepEqual(chromeGroups(), [["d", "a"]]);
  assert.equal(S().groupOnto([id("b")], id("a")), "");
  S().groupOnto([id("b")], id("c"));
  await settle(win);
  assert.deepEqual(groups(), [["c", "b"], ["d", "a"]]);
  S().placeTabs([id("a")], { pinned: false, beforeId: null });
  await settle(win);
  assert.deepEqual(order(win.w), ["c", "b", "d", "e", "a"]);
  assert.deepEqual(groups(), [["c", "b"], ["d"]]);
  assert.deepEqual(chromeGroups(), [["c", "b"], ["d"]]);
  S().placeTabs([id("d")], { pinned: false, beforeId: id("c") });
  S().groupOnto([id("b")], id("e"));
  await settle(win);
  assert.deepEqual(order(win.w), ["d", "c", "e", "b", "a"]);
  assert.deepEqual(groups(), [["c"], ["e", "b"]]);
  assert.deepEqual(chromeGroups(), [["c"], ["e", "b"]]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
});

test("a member dragged out of a pinned group, or onto a tab, reaches Chrome without the strip going round in circles", async () => {
  const win = windowWith("a", "b", "g1", "g2", "g3");
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  for (const u of ["a", "b", "g1", "g2", "g3"]) S().activate(id(u));
  S().groupTabs([id("g1"), id("g2"), id("g3")]);
  await settle(win);
  const groups = () => Object.values(S().groups).map((g) => g.tabIds.map(urlOf)).sort();
  const chromeGroups = () => {
    const out = {};
    for (const t of chrome.strips.get(win.strip).tabs) if (t.group) (out[t.group] ??= []).push(urlOf(t.key));
    return Object.values(out).sort();
  };
  assert.deepEqual(chromeOrder(win.strip), ["g1", "g2", "g3", "a", "b"]);
  S().placeTabs([id("g2")], { pinned: false, beforeId: id("b") });
  await settle(win);
  assert.deepEqual(order(win.w), ["g1", "g3", "a", "g2", "b"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.deepEqual(chromeGroups(), groups());
  S().groupOnto([id("g1")], id("a"));
  await settle(win);
  assert.deepEqual(groups(), [["a", "g1"], ["g3"]]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.deepEqual(chromeGroups(), groups());
});

test("Chrome's own pin or move of a group's tab while a rename of the group is on its way stands", async () => {
  for (const change of ["move", "pin"]) {
    const win = windowWith("x", "a", "b");
    const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
    for (const u of ["x", "a", "b"]) S().activate(id(u));
    const g = S().groupTabs([id("a"), id("b")], { pinned: false, name: "G" });
    await settle(win);
    S().updateGroup(g, { name: "Renamed" });
    await tick();
    assert.ok(chrome.commands.some((c) => c.command.op === "group"), "the rename is on its way");
    if (change === "pin") chrome.pin(id("b"), true);
    else chrome.reorder(win.strip, [id("x"), id("b"), id("a")]);
    await settle(win);
    if (change === "pin") assert.equal(!!S().tabs[id("b")].pin, true, "Chrome's pin stands");
    else assert.deepEqual(order(win.w), ["x", "b", "a"], "Chrome's move stands");
    assert.deepEqual(chromeOrder(win.strip), order(win.w));
    assert.equal(chrome.strips.get(win.strip).groups.get([...chrome.strips.get(win.strip).groups.keys()].at(-1)).title, "Renamed");
  }
});

test("a nested group projects as its root's one Chrome group, and Chrome's moves inside it keep the nesting", async () => {
  const win = windowWith("a", "b", "c", "d", "e");
  await settle(win);
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const outer = S().groupTabs([id("a"), id("b"), id("c"), id("d")], { pinned: false, name: "Outer" });
  const inner = S().groupTabs([id("b"), id("c")], { name: "Inner" });
  assert.equal(S().groups[inner].parentId, outer);
  await settle(win);
  const strip = chrome.strips.get(win.strip);
  const tokens = new Set(strip.tabs.filter((t) => ["a", "b", "c", "d"].includes(urlOf(t.key))).map((t) => t.group));
  assert.equal(tokens.size, 1, "one Chrome group for the whole tree");
  const token = [...tokens][0];
  assert.ok(token);
  assert.equal(strip.tabs.find((t) => urlOf(t.key) === "e").group ?? null, null);
  assert.equal(strip.groups.get(token).title, "Outer", "Chrome shows the root's look");
  assert.equal(chrome.strips.get(win.strip).groups.size, 1, "the nested group makes no Chrome group of its own");
  chrome.retitle(token, "Renamed");
  await settle(win);
  assert.equal(S().groups[outer].name, "Renamed");
  assert.equal(S().groups[inner].name, "Inner");
  chrome.move(id("d"), 1);
  await settle(win);
  assert.deepEqual(order(win.w), ["a", "d", "b", "c", "e"]);
  assert.equal(S().groups[inner]?.parentId, outer, "still nested");
  assert.deepEqual(S().groups[inner].tabIds.map(urlOf), ["b", "c"]);
  assert.deepEqual(S().groups[outer].tabIds.map(urlOf).sort(), ["a", "b", "c", "d"]);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.equal(chromeGroupOf(win.strip, "d"), token, "the moved tab keeps the root's Chrome group");
  chrome.move(id("c"), 2);
  await settle(win);
  assert.deepEqual(order(win.w), ["a", "d", "c", "b", "e"]);
  assert.deepEqual(S().groups[inner].tabIds.map(urlOf), ["c", "b"], "a nested member moved inside its group stays in it");
  assert.equal(S().groups[inner]?.parentId, outer);
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  assert.deepEqual(["a", "b", "c", "d"].map((u) => chromeGroupOf(win.strip, u)), [token, token, token, token]);
  assert.equal(chrome.strips.get(win.strip).groups.size, 1);
});

test("a nested group's tab moved by Chrome to the end of the strip, still in its root's Chrome group, stays in the tree", async () => {
  const win = windowWith("a", "b", "c", "d", "e");
  await settle(win);
  const id = (u) => S().windows[win.w].tabIds.find((t) => urlOf(t) === u);
  const outer = S().groupTabs([id("b"), id("c"), id("d"), id("e")], { pinned: false, name: "Outer" });
  const inner = S().groupTabs([id("d"), id("e")], { name: "Inner" });
  await settle(win);
  chrome.move(id("d"), 4);
  await settle(win);
  assert.deepEqual(order(win.w), ["a", "b", "c", "e", "d"]);
  assert.deepEqual(S().groups[outer].tabIds.map(urlOf), ["b", "c", "e", "d"], "still in the root");
  assert.deepEqual(S().groups[inner].tabIds.map(urlOf), ["e", "d"], "and in its own group");
  assert.deepEqual(chromeOrder(win.strip), order(win.w));
  const token = chromeGroupOf(win.strip, "b");
  assert.ok(token);
  assert.deepEqual(["c", "e", "d"].map((u) => chromeGroupOf(win.strip, u)), [token, token, token], "the moved tab keeps the root's Chrome group");
});

test("Chrome selecting a Peek's source dismisses the Peek instead of bouncing back to it", async () => {
  const win = windowWith("a", "b");
  await settle(win);
  const [a] = S().windows[win.w].tabIds;
  const peek = S().openPeek(a, "https://p.com/");
  chrome.create(win.strip, peek);
  await settle(win);
  assert.equal(chromeShown(win.strip), "p");
  chrome.activate(a);
  await settle(win);
  assert.equal(S().peeks[win.w], undefined);
  assert.equal(S().tabs[peek], undefined);
  assert.equal(shown(win.w), "a");
  assert.equal(chromeShown(win.strip), "a");
});
