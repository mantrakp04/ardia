import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { startAutomation } = await import("./controlSocket.ts");
const { parseOps, openableUrl } = await import("./workspaceOps.ts");
const stub = await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let nextId = 0;

async function controlOn() {
  S().updateSettings({ cliControl: true });
  startAutomation();
  for (let i = 0; i < 5 && !stub.controlSocket.running; i++) await tick();
  await tick();
}

async function call(method, params) {
  const id = ++nextId;
  const before = stub.controlSocket.replies.length;
  stub.emitControlRequest({ connection: 7, generation: stub.controlSocket.generation, line: JSON.stringify({ id, method, params }) });
  for (let i = 0; i < 50 && !stub.controlSocket.replies.slice(before).some((r) => r.connection === 7); i++) await tick();
  const replies = stub.controlSocket.replies.slice(before).filter((r) => r.connection === 7);
  assert.equal(replies.length, 1, `one reply to ${method}`);
  return JSON.parse(replies[0].line);
}

const apply = async (...ops) => (await call("apply", { ops })).result;

async function setup() {
  S().hydrate({});
  await controlOn();
  const windowId = S().createWindow({ url: "https://a.example/" });
  const a = S().windows[windowId].activeTabIds[S().windows[windowId].profileId];
  const b = S().newTab(windowId, { url: "https://b.example/", background: true });
  const c = S().newTab(windowId, { url: "https://c.example/", background: true });
  return { windowId, a, b, c };
}

const order = (windowId) => S().windows[windowId].tabIds;
const activeOf = (windowId) => S().windows[windowId].activeTabIds[S().windows[windowId].profileId];

test("URLs: only what the omnibox opens, never script or app schemes", () => {
  assert.equal(openableUrl("example.com"), "https://example.com");
  assert.equal(openableUrl("https://a.example/x?y#z"), "https://a.example/x?y#z");
  assert.equal(openableUrl("about:blank"), "about:blank");
  assert.equal(openableUrl("ardia://history"), "ardia://history");
  assert.equal(openableUrl("ardia://newtab"), "");
  for (const bad of ["javascript:alert(1)", " javascript:alert(1)", "data:text/html,hi", "ardia://settings", "chrome://flags", "ardia://extensions", "mailto:a@b.c", "slack://open", "https://user:pw@a.example/", "hello world", "view-source:https://a.example/"]) {
    assert.equal(typeof openableUrl(bad), "object", bad);
  }
});

test("ops are checked before anything runs", async () => {
  const { windowId } = await setup();
  const tabs = order(windowId).length;
  const bad = await call("apply", { ops: [{ op: "open", urls: ["https://x.example/"] }, { op: "tab.move", tabs: ["t"], grop: "g" }] });
  assert.equal(bad.error.code, "bad_request");
  assert.match(bad.error.message, /Operation 1: tab\.move takes no grop/);
  assert.equal(order(windowId).length, tabs);
  const refused = await call("apply", { ops: [{ op: "open", urls: ["https://x.example/", "javascript:alert(1)"] }] });
  assert.equal(refused.error.code, "refused");
  assert.equal(order(windowId).length, tabs);
  assert.equal(parseOps([{ op: "tab.close", tabs: ["$0"] }]).code, "bad_request");
  assert.equal(parseOps([{ op: "group.update", group: "g" }]).code, "bad_request");
  assert.equal(parseOps([{ op: "group.update", group: "g", color: "mauve" }]).code, "bad_request");
  assert.equal(parseOps([{ op: "group.update", group: "g", icon: "<b>" }]).code, "bad_request");
  assert.ok(Array.isArray(parseOps([{ op: "group.update", group: "g", icon: "🚀", color: "neutral" }])));
});

test("open keeps the order given, where new tabs go, in the background", async () => {
  const { windowId, a } = await setup();
  const r = await apply({ op: "open", urls: ["https://x.example/", "https://y.example/"], window: windowId });
  assert.equal(r.ok, true);
  const [x, y] = r.results[0].tabs;
  const at = order(windowId).indexOf(x);
  assert.deepEqual(order(windowId).slice(at, at + 2), [x, y]);
  const z = (await apply({ op: "open", urls: ["https://z.example/"], before: x })).results[0].tabs[0];
  assert.equal(order(windowId).indexOf(z), order(windowId).indexOf(x) - 1);
  assert.equal(activeOf(windowId), a);
  assert.equal(S().tabs[x].url, "https://x.example/");
});

test("a nested group: create, name, icon, colour, collapse, open into it, move tabs in and out", async () => {
  const { windowId, a, b, c } = await setup();
  const r = await apply(
    { op: "group.create", tabs: [b], name: "Work", icon: "🚀", color: "blue", pinned: false },
    { op: "group.create", parent: "$0", urls: ["https://n.example/"], name: "Inner", icon: "symbol:star", collapsed: true },
    { op: "open", urls: ["https://o.example/"], group: "$1" },
    { op: "tab.move", tabs: [c], group: "$0" },
  );
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const outer = r.results[0].group;
  const inner = r.results[1].group;
  const g = S().groups[outer];
  assert.deepEqual([g.name, g.icon, g.color, g.pinned], ["Work", "🚀", "blue", false]);
  const n = S().groups[inner];
  assert.deepEqual([n.name, n.icon, n.parentId, n.collapsed], ["Inner", "symbol:star", outer, true]);
  const opened = r.results[2].tabs[0];
  assert.ok(n.tabIds.includes(opened));
  assert.ok(g.tabIds.includes(c) && g.tabIds.includes(opened) && g.tabIds.includes(b));
  assert.equal(activeOf(windowId), a);
  const tree = (await call("workspace", { window: windowId })).result;
  const space = tree.windows[0].spaces[0];
  const work = space.tabs.find((n) => n.type === "group");
  assert.equal(work.id, outer);
  assert.equal(work.icon, "🚀");
  const nested = work.items.find((n) => n.type === "group");
  assert.deepEqual([nested.id, nested.parent, nested.collapsed, nested.items.length], [inner, outer, true, 2]);

  const out = await apply({ op: "tab.move", tabs: [c], group: null });
  assert.equal(out.ok, true);
  assert.equal(S().groups[outer].tabIds.includes(c), false);
  assert.equal(S().tabs[c].windowId, windowId);
  const update = await apply({ op: "group.update", group: outer, name: "Play", color: "neutral", icon: "none" });
  assert.equal(update.ok, true);
  assert.deepEqual([S().groups[outer].name, S().groups[outer].color, update.groups[0].icon], ["Play", null, "none"]);
  assert.equal(activeOf(windowId), a);
});

test("reorder, pin, unpin, mute, rename keep the active tab", async () => {
  const { windowId, a, b, c } = await setup();
  const r = await apply(
    { op: "tab.move", tabs: [c], before: b },
    { op: "tab.pin", tabs: [b], as: "row" },
    { op: "tab.mute", tabs: [c] },
    { op: "tab.rename", tab: c, title: "Cee" },
  );
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(S().tabs[b].pin?.as, "row");
  assert.equal(S().tabs[c].muted, true);
  assert.equal(S().tabs[c].customTitle, "Cee");
  assert.equal(activeOf(windowId), a);
  const back = await apply({ op: "tab.unpin", tabs: [b] }, { op: "tab.unmute", tabs: [c] }, { op: "tab.rename", tab: c, title: null });
  assert.equal(back.ok, true);
  assert.deepEqual([S().tabs[b].pin, S().tabs[c].muted, S().tabs[c].customTitle], [null, false, null]);
  assert.equal(activeOf(windowId), a);
  const act = await apply({ op: "tab.activate", tab: c });
  assert.equal(act.ok && activeOf(windowId), c);
});

test("a failed operation stops the batch and says what ran", async () => {
  const { windowId, b } = await setup();
  const r = await apply({ op: "tab.mute", tabs: [b] }, { op: "tab.move", tabs: ["nope"], before: b }, { op: "tab.close", tabs: [b] });
  assert.equal(r.ok, false);
  assert.equal(r.applied, 1);
  assert.equal(r.error.index, 1);
  assert.equal(r.error.code, "no_window");
  assert.ok(S().tabs[b]);
  assert.equal(S().tabs[b].muted, true);
  assert.deepEqual(r.windows.map((w) => w.id), [windowId]);
});

test("private windows are never reachable", async () => {
  await setup();
  const priv = S().createWindow({ kind: "private", url: "https://p.example/" });
  const tab = S().windows[priv].tabIds[0];
  const r = await apply({ op: "tab.close", tabs: [tab] });
  assert.equal(r.error.code, "no_window");
  assert.ok(S().tabs[tab]);
  const open = await apply({ op: "open", urls: ["https://x.example/"], window: priv });
  assert.equal(open.error.code, "no_window");
  const tree = (await call("workspace", {})).result;
  assert.equal(tree.windows.some((w) => w.id === priv), false);
  assert.equal((await call("workspace", { window: priv })).error.code, "no_window");
});

test("ungroup and close a group", async () => {
  const { windowId, b, c } = await setup();
  const made = await apply({ op: "group.create", tabs: [b, c], pinned: false });
  const id = made.results[0].group;
  assert.equal((await apply({ op: "group.ungroup", group: id })).ok, true);
  assert.equal(S().groups[id], undefined);
  assert.ok(S().tabs[b] && S().tabs[c]);
  const again = await apply({ op: "group.create", tabs: [b, c], pinned: false });
  const gid = again.results[0].group;
  assert.equal((await apply({ op: "group.close", group: gid })).ok, true);
  assert.equal(S().tabs[b], undefined);
  assert.equal(S().closedGroups.at(-1).group?.id ?? S().closedGroups.at(-1).id, gid);
  assert.ok(order(windowId).length >= 1);
});

test("tabs and groups move between windows and into other groups without changing what either window shows", async () => {
  const { windowId, a, b, c } = await setup();
  const other = S().createWindow({ url: "https://other.example/" });
  const shown = activeOf(other);
  const made = await apply({ op: "group.create", tabs: [c], pinned: false, name: "Outer" }, { op: "group.create", tabs: [b], pinned: false, name: "Loose" });
  const [outer, loose] = made.results.map((r) => r.group);
  const nest = await apply({ op: "group.move", group: loose, parent: outer });
  assert.equal(nest.ok, true, JSON.stringify(nest.error));
  assert.equal(S().groups[loose].parentId, outer);
  const top = await apply({ op: "group.move", group: loose, parent: null });
  assert.equal(top.ok, true);
  assert.equal(S().groups[loose].parentId, undefined);
  assert.equal((await apply({ op: "group.move", group: outer, parent: outer })).error.code, "bad_request");
  const moved = await apply({ op: "tab.move", tabs: [a], window: other });
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.equal(S().tabs[a].windowId, other);
  assert.equal(activeOf(other), shown);
  const into = await apply({ op: "tab.move", tabs: [a], group: outer });
  assert.equal(into.ok, true, JSON.stringify(into.error));
  assert.equal(S().tabs[a].windowId, windowId);
  assert.ok(S().groups[outer].tabIds.includes(a));
  assert.equal(activeOf(other), shown);
  const gone = await apply({ op: "group.move", group: loose, window: other });
  assert.equal(gone.ok, true, JSON.stringify(gone.error));
  assert.equal(S().groups[gone.results[0].group].windowId, other);
  assert.equal(activeOf(other), shown);
});

const { keepGroupsOpen } = await import("../groups/closeGuard.ts");
const model = await import("../browser/model.ts");

test("R1: a shared folder is never removed or emptied through a child group or its members", async () => {
  const { windowId, b, c } = await setup();
  const made = await apply({ op: "group.create", tabs: [b, c], name: "Shared" }, { op: "group.create", parent: "$0", tabs: [b, c], name: "Child" });
  assert.equal(made.ok, true, JSON.stringify(made.error));
  const [shared, child] = made.results.map((r) => r.group);
  keepGroupsOpen((id) => id === shared);
  try {
    for (const op of [{ op: "group.delete", group: child }, { op: "group.close", group: child }, { op: "tab.move", tabs: [b, c], group: null }, { op: "group.create", tabs: [b, c], pinned: false }]) {
      const r = await apply(op);
      assert.equal(r.ok, false, op.op);
      assert.equal(r.error.code, "refused", op.op);
      assert.ok(S().groups[shared] && S().groups[child], op.op);
      assert.deepEqual([...S().groups[shared].tabIds].sort(), [b, c].sort(), op.op);
    }
    assert.equal((await apply({ op: "group.move", group: shared, parent: child })).ok, false);
  } finally {
    keepGroupsOpen(() => false);
  }
  assert.ok(order(windowId).includes(b));
});

test("R2: inherited object properties are never ids", async () => {
  const { windowId, b } = await setup();
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    for (const op of [
      { op: "tab.move", tabs: [b], profile: name },
      { op: "tab.move", tabs: [b], window: name },
      { op: "tab.move", tabs: [b], group: name },
      { op: "tab.close", tabs: [name] },
      { op: "open", urls: ["https://x.example/"], profile: name },
      { op: "group.update", group: name, name: "x" },
    ]) {
      const r = await apply(op);
      assert.equal(r.ok, false, `${op.op} ${name}`);
      assert.equal(r.error.code, "no_window", `${op.op} ${name}`);
    }
    assert.equal((await call("workspace", { profile: name })).error.code, "no_window");
    assert.equal((await call("workspace", { window: name })).error.code, "no_window");
  }
  assert.equal(S().tabs[b].profileId, S().windows[windowId].profileId);
  assert.equal(S().tabs[b].windowId, windowId);
});

test("R3: an operation that can't finish changes nothing", async () => {
  const { windowId, b, c } = await setup();
  const q = S().createProfile({ name: "Q" });
  S().pinTabs([c], true, false);
  const r = await apply({ op: "tab.move", tabs: [b, c], profile: q });
  assert.equal(r.ok, false);
  assert.equal(r.applied, 0);
  assert.equal(S().tabs[b].profileId, S().windows[windowId].profileId);
  const made = await apply({ op: "group.create", tabs: [b], pinned: false });
  const g = made.results[0].group;
  const priv = S().createWindow({ kind: "private", url: "https://p.example/" });
  const moved = await apply({ op: "group.move", group: g, profile: q, window: priv });
  assert.equal(moved.ok, false);
  assert.equal(moved.applied, 0);
  assert.equal(S().groups[g]?.profileId, S().windows[windowId].profileId);
});

test("R4: sleeping a background pin never unloads a page another window shows", async () => {
  S().hydrate({});
  await controlOn();
  const a = S().createWindow({ url: "https://mail.com" });
  const [mail] = S().windows[a].tabIds;
  S().newTab(a, { url: "https://a.com" });
  S().pinTabs([mail], true);
  S().activate(mail);
  const b = S().createWindow({ url: "https://b.com" });
  const other = S().windows[b].tabIds.find((id) => !S().tabs[id].pin);
  const copy = model.viewTabIds(S(), b).find((id) => S().tabs[id].pin && S().tabs[id].pinnedUrl === "https://mail.com");
  S().activate(copy);
  assert.equal(S().tabs[mail].windowId, b);
  const inA = model.activeTabId(S(), a);
  assert.equal(S().tabs[inA].page.holderId, mail);
  S().activate(other);
  const r = await apply({ op: "tab.sleep", tabs: [mail] });
  assert.equal(r.ok, true);
  assert.equal(r.results[0].outcomes[mail], "shown");
  assert.equal(model.activeTabId(S(), a), inA);
  assert.ok(S().tabs[mail].page.kind === "loaded" || S().tabs[mail].page.kind === "adopted");
});

test("R5: group null with an anchor goes to the top level next to the anchor's outermost group", async () => {
  const { windowId, b, c } = await setup();
  const g = (await apply({ op: "group.create", tabs: [b, c], pinned: false })).results[0].group;
  const r = await apply({ op: "tab.move", tabs: [c], group: null, before: b });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(S().groups[g].tabIds.includes(c), false);
  assert.equal(order(windowId).indexOf(c), order(windowId).indexOf(b) - 1);
  const after = await apply({ op: "tab.move", tabs: [c], group: null, after: b });
  assert.equal(after.ok, true);
  assert.equal(S().groups[g].tabIds.includes(c), false);
  assert.equal(order(windowId).indexOf(c), order(windowId).indexOf(S().groups[g].tabIds.at(-1)) + 1);
});

test("R6: a group and an anchor in different places is refused before anything moves", async () => {
  const { windowId, a, b } = await setup();
  const q = S().createProfile({ name: "Q" });
  const qTab = S().newTab(windowId, { url: "https://q.example/", background: true, profileId: q });
  const g = (await apply({ op: "group.create", tabs: [qTab], pinned: false })).results[0].group;
  assert.equal(S().groups[g].profileId, q);
  const before = order(windowId).slice();
  const r = await apply({ op: "tab.move", tabs: [b], group: g, before: a });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "bad_request");
  assert.equal(S().tabs[b].profileId, S().windows[windowId].profileId);
  assert.deepEqual(order(windowId), before);
  const outside = await apply({ op: "open", urls: ["https://x.example/"], group: g, before: a });
  assert.equal(outside.ok, false);
  assert.equal(outside.error.code, "bad_request");
  assert.deepEqual(order(windowId), before);
});

test("R6: a store action that quietly does nothing is reported as a failure, never success", async () => {
  const { b, c } = await setup();
  const g = (await apply({ op: "group.create", tabs: [c], pinned: false })).results[0].group;
  const real = S().placeTabs;
  useBrowser.setState({ placeTabs: () => {} });
  try {
    const r = await apply({ op: "tab.move", tabs: [b], group: g });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "failed");
    assert.equal(r.applied, 0);
  } finally {
    useBrowser.setState({ placeTabs: real });
  }
  const real2 = S().updateGroup;
  useBrowser.setState({ updateGroup: () => {} });
  try {
    const r = await apply({ op: "group.update", group: g, name: "Nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "failed");
  } finally {
    useBrowser.setState({ updateGroup: real2 });
  }
});

test("R1b: split panes count as members, so one pane can't empty a shared folder", async () => {
  const { windowId, b, c } = await setup();
  S().createSplit([b, c]);
  const shared = (await apply({ op: "group.create", tabs: [b], name: "Shared" })).results[0].group;
  assert.deepEqual([...S().groups[shared].tabIds].sort(), [b, c].sort());
  keepGroupsOpen((id) => id === shared);
  try {
    for (const op of [{ op: "tab.pin", tabs: [b], as: "row" }, { op: "tab.pin", tabs: [b] }, { op: "tab.move", tabs: [b], group: null }, { op: "group.create", tabs: [b], pinned: false }]) {
      const r = await apply(op);
      assert.equal(r.ok, false, JSON.stringify(op));
      assert.equal(r.error.code, "refused", JSON.stringify(op));
      assert.deepEqual([...(S().groups[shared]?.tabIds ?? [])].sort(), [b, c].sort(), JSON.stringify(op));
      assert.equal(S().tabs[b].windowId, windowId);
    }
    const tile = await apply({ op: "tab.pin", tabs: [c], as: "tile" });
    assert.equal(tile.error.code, "bad_request");
  } finally {
    keepGroupsOpen(() => false);
  }
});

test("R3b: an anchor in a section the tabs can't join is refused before anything opens or moves", async () => {
  const { windowId, a, b, c } = await setup();
  S().pinTabs([a], true, false);
  S().pinTabs([b], true, true);
  const g = (await apply({ op: "group.create", tabs: [c], pinned: false })).results[0].group;
  const count = () => Object.keys(S().tabs).length;
  const tabs = count();
  for (const op of [
    { op: "open", urls: ["https://new.example/"], pin: "row", before: a },
    { op: "open", urls: ["https://new.example/"], pin: "tile", before: b },
    { op: "open", urls: ["https://new.example/"], pin: "tile", after: c },
    { op: "group.move", group: g, before: a },
    { op: "group.move", group: g, before: b, pinned: false },
  ]) {
    const r = await apply(op);
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.equal(r.error.code, "bad_request", JSON.stringify(op));
    assert.equal(count(), tabs, JSON.stringify(op));
  }
  assert.equal(S().groups[g].pinned, false);
  assert.ok(order(windowId).includes(a));
});

test("R3b: tabs an open made are closed again when the store doesn't put them where asked", async () => {
  const { c } = await setup();
  const g = (await apply({ op: "group.create", tabs: [c], pinned: false })).results[0].group;
  const tabs = Object.keys(S().tabs).length;
  const real = S().placeTabs;
  useBrowser.setState({ placeTabs: () => {} });
  try {
    const r = await apply({ op: "open", urls: ["https://x.example/", "https://y.example/"], group: g });
    assert.equal(r.ok, false);
    assert.equal(r.error.code, "failed");
    assert.match(r.error.message, /closed the 2 tabs it opened/);
  } finally {
    useBrowser.setState({ placeTabs: real });
  }
  assert.equal(Object.keys(S().tabs).length, tabs);
});

test("R6b: group.move next to a pinned row joins the pinned section there, as tab.move does", async () => {
  const { windowId, a, b, c } = await setup();
  S().pinTabs([a], true, true);
  const g = (await apply({ op: "group.create", tabs: [b, c], pinned: false })).results[0].group;
  const r = await apply({ op: "group.move", group: g, before: a });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(S().groups[g].pinned, true);
  const at = (id) => order(windowId).indexOf(id);
  assert.ok(Math.max(...S().groups[g].tabIds.map(at)) < at(a));
  const back = await apply({ op: "group.move", group: g, after: a });
  assert.equal(back.ok, true, JSON.stringify(back.error));
  assert.ok(Math.min(...S().groups[g].tabIds.map(at)) > at(a));
});

test("R3b: a move the store didn't finish names what it touched", async () => {
  const { b, c } = await setup();
  const g = (await apply({ op: "group.create", tabs: [c], pinned: false })).results[0].group;
  const real = S().placeTabs;
  useBrowser.setState({ placeTabs: () => {} });
  try {
    const r = await apply({ op: "tab.move", tabs: [b], group: g });
    assert.equal(r.error.code, "failed");
    assert.deepEqual(r.error.changed, { tabs: [b] });
  } finally {
    useBrowser.setState({ placeTabs: real });
  }
});

const { setOpeningGate } = await import("../tabs/openingGate.ts");

test("R3a: group.create takes its parent and section from the anchor, and refuses contradictions before opening anything", async () => {
  const { windowId, a, b, c } = await setup();
  S().pinTabs([a], true, false);
  S().pinTabs([b], true, true);
  const count = () => Object.keys(S().tabs).length;
  const groups = () => Object.keys(S().groups).length;
  const [tabs, made] = [count(), groups()];
  for (const op of [
    { op: "group.create", urls: ["https://new.example/"], before: a },
    { op: "group.create", urls: ["https://new.example/"], after: a },
    { op: "group.create", urls: ["https://new.example/"], before: b, pinned: false },
  ]) {
    const r = await apply(op);
    assert.equal(r.ok, false, JSON.stringify(op));
    assert.equal(r.error.code, "bad_request", JSON.stringify(op));
    assert.deepEqual([count(), groups()], [tabs, made], JSON.stringify(op));
  }
  const pinnedThere = await apply({ op: "group.create", urls: ["https://p.example/"], before: b });
  assert.equal(pinnedThere.ok, true, JSON.stringify(pinnedThere.error));
  const pg = S().groups[pinnedThere.results[0].group];
  assert.equal(pg.pinned, true);
  assert.ok(Math.max(...pg.tabIds.map((id) => order(windowId).indexOf(id))) < order(windowId).indexOf(b));
  const outer = (await apply({ op: "group.create", tabs: [c], pinned: false, name: "P" })).results[0].group;
  const nested = await apply({ op: "group.create", urls: ["https://n.example/"], before: c });
  assert.equal(nested.ok, true, JSON.stringify(nested.error));
  assert.equal(S().groups[nested.results[0].group].parentId, outer);
  const wrong = await apply({ op: "group.create", urls: ["https://n.example/"], before: c, pinned: true });
  assert.equal(wrong.error.code, "bad_request");
});

test("R3b: a split moved next to a tile is refused, since its panes can only pin as rows", async () => {
  const { a, b, c } = await setup();
  S().createSplit([b, c]);
  S().pinTabs([a], true, false);
  const r = await apply({ op: "tab.move", tabs: [b], before: a });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "bad_request");
  assert.deepEqual([S().tabs[b].pin, S().tabs[c].pin], [null, null]);
});

test("R3c: a URL an opening rule cancels rolls back the tabs opened before it", async () => {
  const { windowId } = await setup();
  setOpeningGate((url) => (url.startsWith("https://blocked.example/") ? { cancel: true } : null));
  try {
    const count = Object.keys(S().tabs).length;
    const groups = Object.keys(S().groups).length;
    for (const op of [
      { op: "open", urls: ["https://good.example/", "https://blocked.example/x"], window: windowId },
      { op: "group.create", urls: ["https://good.example/", "https://blocked.example/x"], pinned: false },
    ]) {
      const r = await apply(op);
      assert.equal(r.ok, false, op.op);
      assert.equal(r.error.code, "refused", op.op);
      assert.match(r.error.message, /blocked\.example/);
      assert.equal(Object.keys(S().tabs).length, count, op.op);
      assert.equal(Object.keys(S().groups).length, groups, op.op);
    }
  } finally {
    setOpeningGate(null);
  }
});

test("names: a group field takes a group's name, case-insensitively, in the op's window; ids win; ambiguity lists ids", async () => {
  const { windowId, a, b, c } = await setup();
  const made = await apply({ op: "group.create", tabs: [b], name: "Work", icon: "💼", pinned: false });
  const work = made.results[0].group;
  assert.deepEqual([made.results[0].label, made.results[0].icon], ["Work", "💼"]);
  const moved = await apply({ op: "tab.move", tabs: [c], group: "work" });
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.ok(S().groups[work].tabIds.includes(c));
  const named = await apply({ op: "group.update", group: { name: "WORK" }, color: "blue" });
  assert.equal(named.ok, true, JSON.stringify(named.error));
  assert.equal(S().groups[work].color, "blue");
  const decoy = (await apply({ op: "group.create", tabs: [a], name: work, pinned: false })).results[0].group;
  const byId = await apply({ op: "group.update", group: work, name: "Work" });
  assert.equal(byId.results[0].group, work);
  await apply({ op: "group.update", group: decoy, name: "work " });
  const twice = await apply({ op: "group.update", group: "Work", collapsed: true });
  assert.equal(twice.ok, false);
  assert.equal(twice.error.code, "bad_request");
  assert.ok(twice.error.message.includes(work) && twice.error.message.includes(decoy), twice.error.message);
  const none = await apply({ op: "group.update", group: "Nope", collapsed: true });
  assert.equal(none.error.code, "no_window");
  const other = S().createWindow({ url: "https://o.example/" });
  const elsewhere = (await apply({ op: "group.create", tabs: [S().windows[other].tabIds[0]], name: "Elsewhere", pinned: false })).results[0].group;
  const here = S().newTab(windowId, { url: "https://h.example/", background: true });
  assert.equal((await apply({ op: "tab.move", tabs: [here], group: "Elsewhere" })).error.code, "no_window");
  const there = await apply({ op: "tab.move", tabs: [here], group: "Elsewhere", window: other });
  assert.equal(there.ok, true, JSON.stringify(there.error));
  assert.ok(S().groups[elsewhere].tabIds.includes(here));
  const gone = await apply({ op: "group.ungroup", group: decoy });
  assert.equal(gone.results[0].label, "work");
});

test("order: groups made from one group's tabs keep creation order above it, and ungrouping it leaves the rest below", async () => {
  for (const pinned of [false, true]) {
    S().hydrate({});
    await controlOn();
    const w = S().createWindow({ url: "https://0.example/" });
    const t = [1, 2, 3, 4, 5, 6].map((n) => S().newTab(w, { url: `https://${n}.example/`, background: true }));
    const imported = (await apply({ op: "group.create", tabs: t, name: "Imported", pinned: false })).results[0].group;
    const r = await apply(
      { op: "group.create", tabs: [t[0], t[1]], name: "Work", pinned },
      { op: "group.create", tabs: [t[2], t[3]], name: "Reading", pinned },
      { op: "group.create", tabs: [t[4]], name: "Shopping", pinned },
    );
    assert.equal(r.ok, true, JSON.stringify(r.error));
    const at = (id) => S().windows[w].tabIds.indexOf(id);
    const [work, reading, shopping] = r.results.map((x) => S().groups[x.group]);
    const last = (g) => Math.max(...g.tabIds.map(at));
    const first = (g) => Math.min(...g.tabIds.map(at));
    assert.ok(last(work) < first(reading) && last(reading) < first(shopping), `pinned ${pinned}: creation order`);
    assert.ok(last(shopping) < at(t[5]), `pinned ${pinned}: the rest stays below`);
    assert.equal((await apply({ op: "group.ungroup", group: imported })).ok, true);
    assert.ok(last(shopping) < at(t[5]), `pinned ${pinned}: still below after ungroup`);
  }
});
